import { Temporal } from "@js-temporal/polyfill";
import {
  resolveCompletionCheckSchedule,
  type CompletionCheckOccurrence,
  type CompletionReadStrategy,
} from "@cadence/core/resolvers/completion-check-schedule.resolver";
import type { RecordedActivitySourceV1_1 } from "@cadence/core/types/recorded-activity";

import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import { getProfileTimezone } from "@/lib/db/behaviors.repo";
import { readConnectorConnection } from "@/lib/db/connectors.repo";
import { listSourceLinks } from "@/lib/db/sourceLinks.repo";
import { createConnectorCompletionCaller } from "@/lib/integrations/connector-completion-caller";
import { DEFAULT_TIMEZONE } from "@/lib/types/recurrence";
import {
  connectorCompletionEnabled,
  reconcileConnectorCompletions,
  type ReconcileResult,
} from "./connector-completion.service";
import type { ConnectorCaller } from "./connector-credentials";

// Ticket 321 (D28.5): the background connector completion job, modeled on the leave
// reminder job (Tickets 276 and 277). The service role selects due accounts from
// `connector_completion_state` and reads nothing else. Every other read and write
// runs as the account's user through a minted five-minute token on the
// `connector_completion` channel. Results carry counts only.

export const CONNECTOR_COMPLETION_JOB_DEFAULT_BATCH = 20;
export const CONNECTOR_COMPLETION_JOB_BATCH_MAX = 100;
const RUN_BUDGET_MS = 50_000;
const ACCOUNT_CONCURRENCY = 4;
/**
 * Ticket 311 decides the read strategy. Until it records a cheap read (strategy A
 * or B), the job keeps only the check before a reminder and the nightly check.
 */
export const CONNECTOR_COMPLETION_READ_STRATEGY: CompletionReadStrategy = "full_scan";

export type DueCompletionAccount = Readonly<{ userId: string; source: RecordedActivitySourceV1_1; nextCheckAt: string }>;

export type CompletionScheduleContext = Readonly<{
  timezone: string;
  occurrences: readonly CompletionCheckOccurrence[];
  checkCountDate: string | null;
  checkCount: number;
  consecutiveFailures: number;
  lastAttemptedAt: string | null;
  reconnectRequired: boolean;
}>;

export type CompletionJobAccountPort = Readonly<{
  reconcile(now: Temporal.Instant): Promise<ReconcileResult>;
  readScheduleContext(now: Temporal.Instant): Promise<CompletionScheduleContext>;
  writeSchedule(input: Readonly<{ nextCheckAt: string | null; checkCountDate: string; checkCount: number }>): Promise<void>;
}>;

export type ConnectorCompletionJobResult = {
  enabled: boolean;
  selected: number;
  visited: number;
  skipped: number;
  failed: number;
  completed: number;
  attached: number;
  removed: number;
};

export type ProcessConnectorCompletionsOptions = Readonly<{
  limit?: number;
  now?: () => Temporal.Instant;
  env?: Readonly<Record<string, string | undefined>>;
  runBudgetMs?: number;
  strategy?: CompletionReadStrategy;
  selectDueAccounts(input: Readonly<{ dueBy: Date; limit: number }>): Promise<DueCompletionAccount[]>;
  openAccount(account: DueCompletionAccount, now: Temporal.Instant): Promise<CompletionJobAccountPort> | CompletionJobAccountPort;
}>;

export async function processConnectorCompletions(options: ProcessConnectorCompletionsOptions): Promise<ConnectorCompletionJobResult> {
  const total: ConnectorCompletionJobResult = { enabled: false, selected: 0, visited: 0, skipped: 0, failed: 0, completed: 0, attached: 0, removed: 0 };
  if (!connectorCompletionEnabled(options.env)) return total;
  total.enabled = true;
  const clock = options.now ?? (() => Temporal.Now.instant());
  const started = clock();
  const limit = Math.min(Math.max(1, Math.trunc(options.limit ?? CONNECTOR_COMPLETION_JOB_DEFAULT_BATCH)), CONNECTOR_COMPLETION_JOB_BATCH_MAX);
  const accounts = await options.selectDueAccounts({ dueBy: new Date(started.epochMilliseconds), limit });
  total.selected = accounts.length;
  const budgetEndsAt = started.epochMilliseconds + (options.runBudgetMs ?? RUN_BUDGET_MS);
  let index = 0;
  const worker = async () => {
    while (index < accounts.length) {
      const account = accounts[index++]!;
      if (clock().epochMilliseconds >= budgetEndsAt) { total.skipped += 1; continue; }
      // A failed account never stops the batch.
      try {
        const port = await options.openAccount(account, clock());
        const outcome = await visitAccount(port, clock, options.strategy ?? CONNECTOR_COMPLETION_READ_STRATEGY);
        total.visited += 1;
        if (outcome.failed) total.failed += 1;
        total.completed += outcome.result?.counts.completed ?? 0;
        total.attached += outcome.result?.counts.attached ?? 0;
        total.removed += outcome.result?.counts.removed ?? 0;
      } catch {
        total.failed += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(ACCOUNT_CONCURRENCY, accounts.length) }, worker));
  return total;
}

async function visitAccount(port: CompletionJobAccountPort, clock: () => Temporal.Instant, strategy: CompletionReadStrategy) {
  let result: ReconcileResult | null = null;
  let failed = false;
  try {
    result = await port.reconcile(clock());
    failed = result.status === "provider_failed";
  } catch {
    failed = true;
  }
  const now = clock();
  const context = await port.readScheduleContext(now);
  const today = now.toZonedDateTimeISO(context.timezone).toPlainDate().toString();
  const checkCount = (context.checkCountDate === today ? context.checkCount : 0) + 1;
  const schedule = resolveCompletionCheckSchedule({
    now,
    timezone: context.timezone,
    strategy,
    occurrences: context.occurrences,
    checksToday: checkCount,
    consecutiveFailures: context.consecutiveFailures,
    lastAttemptAt: context.lastAttemptedAt,
    reconnectRequired: context.reconnectRequired || result?.status === "not_connected" || result?.status === "no_links",
  });
  await port.writeSchedule({ nextCheckAt: schedule.nextCheckAt, checkCountDate: today, checkCount });
  return { result, failed };
}

/** Service role: due accounts only, reading `user_id`, `source` and `next_check_at`. */
export function hostedDueCompletionAccountSelection(serviceRole: AppSupabaseClient) {
  return async (input: Readonly<{ dueBy: Date; limit: number }>): Promise<DueCompletionAccount[]> => {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > CONNECTOR_COMPLETION_JOB_BATCH_MAX) {
      throw new RangeError(`Connector completion batch must be 1–${CONNECTOR_COMPLETION_JOB_BATCH_MAX} accounts.`);
    }
    const { data, error } = await serviceRole
      .from("connector_completion_state")
      .select("user_id, source, next_check_at")
      .lte("next_check_at", input.dueBy.toISOString())
      .order("next_check_at", { ascending: true })
      .limit(input.limit);
    if (error) throw error;
    return (data ?? []).flatMap((row) => row.next_check_at && row.source === "hevy"
      ? [{ userId: row.user_id, source: row.source, nextCheckAt: row.next_check_at }] : []);
  };
}

export function createHostedCompletionAccountPort(account: DueCompletionAccount, now: Temporal.Instant): CompletionJobAccountPort {
  const caller = createConnectorCompletionCaller(account.userId, { now: new Date(now.epochMilliseconds) });
  return createCompletionAccountPort(caller, account.source);
}

export function createCompletionAccountPort(caller: ConnectorCaller, source: RecordedActivitySourceV1_1): CompletionJobAccountPort {
  const client = caller.client;
  const userId = caller.user.id;
  return {
    reconcile: () => reconcileConnectorCompletions(caller, source, { deadlineMs: 20_000 }),
    async readScheduleContext(now) {
      const [timezone, links, connection, state] = await Promise.all([
        getProfileTimezone(client, userId),
        listSourceLinks(client, userId, source),
        readConnectorConnection(client, userId, source),
        client.from("connector_completion_state")
          .select("check_count_date,check_count,consecutive_failures,last_attempted_at")
          .eq("user_id", userId).eq("source", source).maybeSingle(),
      ]);
      if (state.error) throw state.error;
      const behaviorIds = [...new Set(links.filter((link) => link.enabled).map((link) => link.behavior_id))];
      const occurrences = await todaysUnresolved(client, userId, behaviorIds, now);
      return {
        timezone: timezone ?? DEFAULT_TIMEZONE,
        occurrences,
        checkCountDate: state.data?.check_count_date ?? null,
        checkCount: state.data?.check_count ?? 0,
        consecutiveFailures: state.data?.consecutive_failures ?? 0,
        lastAttemptedAt: state.data?.last_attempted_at ?? null,
        reconnectRequired: connection?.status !== "connected",
      };
    },
    async writeSchedule(input) {
      const { error } = await client.from("connector_completion_state")
        .update({ next_check_at: input.nextCheckAt, check_count_date: input.checkCountDate, check_count: input.checkCount })
        .eq("user_id", userId).eq("source", source);
      if (error) throw error;
    },
  };
}

/** Today's Unresolved Occurrences of linked Behaviors, each with its pending reminder times. */
async function todaysUnresolved(client: AppSupabaseClient, userId: string, behaviorIds: readonly string[], now: Temporal.Instant): Promise<CompletionCheckOccurrence[]> {
  if (behaviorIds.length === 0) return [];
  const behaviors = await client.from("behaviors").select("id,timezone").eq("user_id", userId).in("id", [...behaviorIds]);
  if (behaviors.error) throw behaviors.error;
  const dates = [...new Set((behaviors.data ?? []).map((row) => now.toZonedDateTimeISO(row.timezone ?? DEFAULT_TIMEZONE).toPlainDate().toString()))];
  if (dates.length === 0) return [];
  const occurrences = await client.from("occurrences").select("id,behavior_id,local_date,scheduled_for")
    .eq("user_id", userId).eq("status", "unresolved").in("behavior_id", [...behaviorIds]).in("local_date", dates);
  if (occurrences.error) throw occurrences.error;
  const rows = occurrences.data ?? [];
  if (rows.length === 0) return [];
  const reminders = await client.from("reminder_deliveries").select("occurrence_id,scheduled_send_at")
    .eq("user_id", userId).eq("status", "pending").in("occurrence_id", rows.map((row) => row.id));
  if (reminders.error) throw reminders.error;
  return rows.map((row) => ({
    scheduledStartAt: Temporal.Instant.from(row.scheduled_for).toString(),
    reminderAt: (reminders.data ?? []).filter((reminder) => reminder.occurrence_id === row.id)
      .map((reminder) => Temporal.Instant.from(reminder.scheduled_send_at).toString()),
  }));
}
