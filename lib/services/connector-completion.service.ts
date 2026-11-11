import { Temporal } from "@js-temporal/polyfill";
import {
  resolveActivityMatches,
  type ActivityMatchBehavior,
  type ActivityMatchOccurrence,
  type ActivityMatchPlan,
  type ActivityMatchRecord,
} from "@cadence/core/resolvers/activity-match.resolver";
import type { RecordedActivitySourceV1_1 } from "@cadence/core/types/recorded-activity";

import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import { readConnectorConnection } from "@/lib/db/connectors.repo";
import { listOccurrencesBetweenLocalDates } from "@/lib/db/occurrences.repo";
import { listOccurrenceStatusEventsByOccurrenceIds } from "@/lib/db/occurrenceStatusEvents.repo";
import { listSourceLinks, toActivityMatchLink, type SourceLinkRow } from "@/lib/db/sourceLinks.repo";
import {
  applyConnectorCompletion,
  attachSourceActivity,
  listSourceMatchesForActivities,
  listSourceMatchesForOccurrences,
  removeSourceMatch,
  toActivityMatchRecord,
  type ConnectorWriteResult,
} from "@/lib/db/sourceMatches.repo";
import { ConnectorError } from "@/lib/types/connectors";
import type { Occurrence } from "@/lib/types/database";
import { DEFAULT_TIMEZONE } from "@/lib/types/recurrence";
import { completionSource, parseCompletionCursor, type CompletionSourceEvidence, type CompletionSourcePort } from "./completion-sources";
import type { ConnectorCaller } from "./connector-credentials";

// Ticket 316 (D28): one reconcile = read, match and apply for one account and one
// source. The foreground POST and the background job (Ticket 321) both call it.
// It reads evidence on the server, never from a client. Logs and results carry
// counts and stable codes only: no titles, provider identifiers or credentials.

/** Invariant 9: reconcile does nothing unless this is exactly `on`. Default: off. */
export const CONNECTOR_COMPLETION_FLAG = "CADENCE_CONNECTOR_COMPLETION";
export const RECONCILE_MIN_INTERVAL_SECONDS = 5 * 60;
/** Invariant 8: removals, completions and attachments combined, per run. */
export const RECONCILE_MAX_WRITES = 100;
const WINDOW_DAYS = 31;

export function connectorCompletionEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env[CONNECTOR_COMPLETION_FLAG] === "on";
}

export type ReconcileStatus =
  | "disabled"
  | "throttled"
  | "no_links"
  | "not_connected"
  | "provider_failed"
  | "connection_changed"
  | "reconciled";

export type ReconcileCounts = Readonly<{
  completed: number;
  attached: number;
  removed: number;
  reverted: number;
  skipped: number;
  refused: number;
  deferred: number;
}>;

export type ReconcileResult = Readonly<{
  status: ReconcileStatus;
  source: RecordedActivitySourceV1_1;
  counts: ReconcileCounts;
  /** Stable codes: resolver skip reasons and database refusal reasons. */
  codes: readonly string[];
  /** The last successful check, for the Hevy panel (safety rule 6). */
  lastReconciledAt: string | null;
}>;

export type CompletionState = Readonly<{
  lastReconciledAt: string | null;
  lastAttemptedAt: string | null;
  consecutiveFailures: number;
  /** Ticket 311 strategy A: where the next change read starts. Null reads in full. */
  readCursor?: string | null;
}>;

type ConnectionFence = Readonly<{ status: string; accountDigest: string | null; generation: number }>;

/** Everything reconcile reads or writes, so tests can run without a database. */
export type ConnectorCompletionStore = Readonly<{
  readState(source: RecordedActivitySourceV1_1): Promise<CompletionState | null>;
  recordAttempt(source: RecordedActivitySourceV1_1, at: string): Promise<void>;
  /** `readCursor` is written only when given: undefined keeps the stored cursor. */
  recordOutcome(source: RecordedActivitySourceV1_1, outcome: Readonly<{ at: string; succeeded: boolean; readCursor?: string | null }>): Promise<void>;
  readConnection(source: RecordedActivitySourceV1_1): Promise<ConnectionFence | null>;
  listLinks(source: RecordedActivitySourceV1_1): Promise<SourceLinkRow[]>;
  listBehaviors(ids: readonly string[]): Promise<ActivityMatchBehavior[]>;
  listOccurrences(behaviorIds: readonly string[], startLocalDate: string, endLocalDate: string): Promise<Occurrence[]>;
  latestStatusEventIds(occurrenceIds: readonly string[]): Promise<Map<string, string>>;
  listMatches(source: RecordedActivitySourceV1_1, occurrenceIds: readonly string[], activityRefs: readonly string[]): Promise<ActivityMatchRecord[]>;
  applyCompletion(input: Parameters<typeof applyConnectorCompletion>[1]): Promise<ConnectorWriteResult>;
  attach(input: Parameters<typeof attachSourceActivity>[1]): Promise<ConnectorWriteResult>;
  remove(input: Parameters<typeof removeSourceMatch>[1]): Promise<ConnectorWriteResult>;
  repairReminders(occurrenceIds: readonly string[], now: Temporal.Instant): Promise<void>;
  revalidate(): void;
}>;

export type ReconcileOptions = Readonly<{
  now?: () => Temporal.Instant;
  env?: Readonly<Record<string, string | undefined>>;
  store?: ConnectorCompletionStore;
  port?: CompletionSourcePort;
  deadlineMs?: number;
  signal?: AbortSignal;
}>;

const ZERO: ReconcileCounts = { completed: 0, attached: 0, removed: 0, reverted: 0, skipped: 0, refused: 0, deferred: 0 };

export type ConnectorCompletionStatus = Readonly<{ available: boolean; lastReconciledAt: string | null }>;

/** Safety rule 6: the Hevy panel shows the last successful check beside the connection state. */
export async function getConnectorCompletionStatus(
  caller: ConnectorCaller,
  source: unknown,
  options: Readonly<{ env?: Readonly<Record<string, string | undefined>>; store?: Pick<ConnectorCompletionStore, "readState"> }> = {},
): Promise<ConnectorCompletionStatus> {
  const port = completionSource(source);
  if (!connectorCompletionEnabled(options.env)) return { available: false, lastReconciledAt: null };
  const state = await (options.store ?? createConnectorCompletionStore(caller)).readState(port.source);
  return { available: true, lastReconciledAt: state?.lastReconciledAt ?? null };
}

/** `POST /api/connectors/completions/reconcile` accepts exactly `{ source }`. */
export function parseReconcileBody(body: unknown): RecordedActivitySourceV1_1 {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ConnectorError("invalid_request");
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== "source") throw new ConnectorError("invalid_request");
  return completionSource((body as { source: unknown }).source).source;
}

export async function reconcileConnectorCompletions(
  caller: ConnectorCaller,
  source: RecordedActivitySourceV1_1,
  options: ReconcileOptions = {},
): Promise<ReconcileResult> {
  const result = (status: ReconcileStatus, counts = ZERO, codes: string[] = [], lastReconciledAt: string | null = null): ReconcileResult =>
    ({ status, source, counts, codes: [...new Set(codes)].sort(), lastReconciledAt });
  if (!connectorCompletionEnabled(options.env)) return result("disabled");
  const clock = options.now ?? (() => Temporal.Now.instant());
  const store = options.store ?? createConnectorCompletionStore(caller);
  const port = options.port ?? completionSource(source);
  const startedAt = clock();

  const state = await store.readState(source);
  if (state?.lastAttemptedAt
    && startedAt.since(Temporal.Instant.from(state.lastAttemptedAt)).total({ unit: "seconds" }) < RECONCILE_MIN_INTERVAL_SECONDS) {
    return result("throttled", ZERO, [], state.lastReconciledAt);
  }
  const links = await store.listLinks(source);
  if (!links.some((link) => link.enabled)) return result("no_links", ZERO, [], state?.lastReconciledAt ?? null);
  const before = await store.readConnection(source);
  if (!before || before.status !== "connected" || !before.accountDigest) {
    return result("not_connected", ZERO, [], state?.lastReconciledAt ?? null);
  }
  await store.recordAttempt(source, startedAt.toString());

  let evidence: CompletionSourceEvidence;
  try {
    evidence = await port.readEvidence(caller, { deadlineMs: options.deadlineMs, signal: options.signal, cursor: readCursorFor(state, links) });
  } catch (error) {
    // A provider failure writes nothing but the failure count.
    await store.recordOutcome(source, { at: clock().toString(), succeeded: false });
    const code = error instanceof ConnectorError ? error.code : "provider_unavailable";
    return result(code === "connection_changed" ? "connection_changed" : "provider_failed", ZERO, [code], state?.lastReconciledAt ?? null);
  }

  // A connection that changed during the run discards the result.
  const after = await store.readConnection(source);
  if (!after || after.status !== "connected" || after.accountDigest !== before.accountDigest
    || after.generation !== before.generation || evidence.accountDigest !== after.accountDigest
    || evidence.connectionGeneration !== after.generation) {
    return result("connection_changed", ZERO, ["connection_changed"], state?.lastReconciledAt ?? null);
  }

  const now = clock();
  const enabledLinks = links.filter((link) => link.enabled);
  const behaviorIds = [...new Set(enabledLinks.map((link) => link.behavior_id))];
  const behaviors = await store.listBehaviors(behaviorIds);
  const window = matchWindow(now, behaviors);
  const occurrences = (await store.listOccurrences(behaviorIds, window.start, window.end))
    .filter((occurrence) => behaviorIds.includes(occurrence.behavior_id));
  const occurrenceIds = occurrences.map((occurrence) => occurrence.id);
  const [latest, matches] = await Promise.all([
    store.latestStatusEventIds(occurrenceIds),
    store.listMatches(source, occurrenceIds, evidence.activities.map((activity) => activity.id)),
  ]);
  const timezones = new Map(behaviors.map((behavior) => [behavior.id, behavior.timezone]));
  const plan = resolveActivityMatches({
    source,
    accountDigest: after.accountDigest,
    now,
    minimumDurationSeconds: port.minimumDurationSeconds,
    links: enabledLinks.map(toActivityMatchLink),
    behaviors,
    occurrences: occurrences.map((occurrence) => toMatchOccurrence(occurrence, timezones.get(occurrence.behavior_id) ?? DEFAULT_TIMEZONE,
      latest.get(occurrence.id) ?? null)),
    evidence: {
      activities: evidence.activities,
      complete: evidence.complete,
      coverageStartAt: evidence.coverageStartAt,
      coverageEndAt: evidence.coverageEndAt,
      deletedActivityRefs: evidence.deletedActivityRefs,
    },
    matches: dedupe(matches),
  });

  const applied = await applyPlan(store, plan, clock);
  if (applied.reverted.length > 0) await store.repairReminders(applied.reverted, clock());
  const finishedAt = clock().toString();
  // A run that deferred writes keeps its cursor, so the next run reads those changes again.
  await store.recordOutcome(source, applied.counts.deferred === 0
    ? { at: finishedAt, succeeded: true, readCursor: evidence.nextCursor }
    : { at: finishedAt, succeeded: true });
  if (applied.counts.completed + applied.counts.attached + applied.counts.removed > 0) store.revalidate();
  return result("reconciled", applied.counts, [...plan.skip.map((entry) => entry.reason), ...applied.codes], finishedAt);
}

/**
 * A link saved after the cursor needs its 30-day history, which a change read does not
 * carry, so that run reads in full and starts a new cursor.
 */
function readCursorFor(state: CompletionState | null, links: readonly SourceLinkRow[]): string | null {
  const cursor = parseCompletionCursor(state?.readCursor ?? null);
  if (!cursor) return null;
  const since = Temporal.Instant.from(cursor.since);
  const changed = links.some((link) => link.enabled && Temporal.Instant.compare(Temporal.Instant.from(link.updated_at), since) >= 0);
  return changed ? null : state!.readCursor!;
}

async function applyPlan(store: ConnectorCompletionStore, plan: ActivityMatchPlan, clock: () => Temporal.Instant) {
  const counts = { ...ZERO, skipped: plan.skip.length };
  const codes: string[] = [];
  const reverted: string[] = [];
  let writes = 0;
  const budget = () => writes < RECONCILE_MAX_WRITES;
  const refuse = (outcome: ConnectorWriteResult) => { counts.refused += 1; codes.push(outcome.reason); };

  // Rule 8: removals first, then completions before the attachments they enable.
  for (const entry of plan.remove) {
    if (!budget()) { counts.deferred += 1; continue; }
    writes += 1;
    const outcome = await store.remove({ matchId: entry.matchId, recordedAt: clock().toString() });
    if (!outcome.ok) { refuse(outcome); continue; }
    counts.removed += 1;
    if (outcome.reverted) { counts.reverted += 1; reverted.push(entry.occurrenceId); }
  }
  for (const entry of plan.complete) {
    if (!budget()) { counts.deferred += 1; continue; }
    writes += 1;
    const outcome = await store.applyCompletion({
      linkId: entry.linkId,
      occurrenceId: entry.occurrenceId,
      activityRef: entry.activityRef,
      activityStartAt: entry.activityStartAt,
      activityEndAt: entry.activityEndAt,
      activityRevision: entry.activityRevision,
      expectedLatestEventId: entry.expectedLatestEventId,
      recordedAt: clock().toString(),
    });
    if (outcome.ok) counts.completed += 1;
    else refuse(outcome);
  }
  for (const entry of plan.attach) {
    if (!budget()) { counts.deferred += 1; continue; }
    writes += 1;
    const outcome = await store.attach({
      linkId: entry.linkId,
      occurrenceId: entry.occurrenceId,
      activityRef: entry.activityRef,
      activityStartAt: entry.activityStartAt,
      activityEndAt: entry.activityEndAt,
      activityRevision: entry.activityRevision,
      recordedAt: clock().toString(),
    });
    if (outcome.ok) counts.attached += 1;
    else refuse(outcome);
  }
  return { counts, codes, reverted };
}

/** The local dates any linked Behavior's 31-day window can cover. */
function matchWindow(now: Temporal.Instant, behaviors: readonly ActivityMatchBehavior[]): { start: string; end: string } {
  const todays = (behaviors.length ? behaviors : [{ id: "", timezone: DEFAULT_TIMEZONE }])
    .map((behavior) => now.toZonedDateTimeISO(behavior.timezone).toPlainDate());
  const sorted = [...todays].sort(Temporal.PlainDate.compare);
  return {
    start: sorted[0].subtract({ days: WINDOW_DAYS - 1 }).toString(),
    end: sorted[sorted.length - 1].toString(),
  };
}

export function toMatchOccurrence(occurrence: Occurrence, timezone: string, latestStatusEventId: string | null): ActivityMatchOccurrence {
  return {
    id: occurrence.id,
    behaviorId: occurrence.behavior_id,
    localDate: occurrence.local_date,
    scheduledStartAt: Temporal.Instant.from(occurrence.scheduled_for).toString(),
    scheduledEndAt: scheduledEnd(occurrence, timezone),
    status: occurrence.status as ActivityMatchOccurrence["status"],
    latestStatusEventId,
  };
}

/** Mirrors `cadence_private.connector_scheduled_end`: a range ending at or before its start ends the next day. */
function scheduledEnd(occurrence: Occurrence, timezone: string): string | null {
  if (occurrence.schedule_kind !== "range" || !occurrence.schedule_end_time) return null;
  const date = Temporal.PlainDate.from(occurrence.local_date);
  const end = Temporal.PlainTime.from(occurrence.schedule_end_time);
  const start = Temporal.PlainTime.from(occurrence.schedule_start_time);
  const endDate = Temporal.PlainTime.compare(end, start) <= 0 ? date.add({ days: 1 }) : date;
  return endDate.toZonedDateTime({ timeZone: timezone, plainTime: end }).toInstant().toString();
}

function dedupe(matches: readonly ActivityMatchRecord[]): ActivityMatchRecord[] {
  return [...new Map(matches.map((match) => [match.id, match])).values()];
}

export function createConnectorCompletionStore(caller: ConnectorCaller, client: AppSupabaseClient = caller.client): ConnectorCompletionStore {
  const userId = caller.user.id;
  return {
    async readState(source) {
      const { data, error } = await client.from("connector_completion_state")
        .select("last_reconciled_at,last_attempted_at,consecutive_failures,read_cursor")
        .eq("user_id", userId).eq("source", source).maybeSingle();
      if (error) throw new ConnectorError("provider_unavailable");
      return data ? { lastReconciledAt: data.last_reconciled_at, lastAttemptedAt: data.last_attempted_at,
        consecutiveFailures: data.consecutive_failures, readCursor: data.read_cursor } : null;
    },
    async recordAttempt(source, at) {
      const existing = await this.readState(source);
      const { error } = existing
        ? await client.from("connector_completion_state").update({ last_attempted_at: at }).eq("user_id", userId).eq("source", source)
        : await client.from("connector_completion_state").insert({ user_id: userId, source, last_attempted_at: at });
      if (error) throw new ConnectorError("provider_unavailable");
    },
    async recordOutcome(source, outcome) {
      const current = await this.readState(source);
      const { error } = await client.from("connector_completion_state")
        .update(outcome.succeeded
          ? { last_reconciled_at: outcome.at, consecutive_failures: 0, ...(outcome.readCursor === undefined ? {} : { read_cursor: outcome.readCursor }) }
          : { consecutive_failures: Math.min(1000, (current?.consecutiveFailures ?? 0) + 1) })
        .eq("user_id", userId).eq("source", source);
      if (error) throw new ConnectorError("provider_unavailable");
      // A successful read re-arms background checks that a disconnect stopped.
      if (outcome.succeeded) await rearmConnectorCompletionChecks(client, userId, source, outcome.at);
    },
    async readConnection(source) {
      const connection = await readConnectorConnection(client, userId, source);
      return connection ? { status: connection.status, accountDigest: connection.accountDigest, generation: connection.generation } : null;
    },
    listLinks: (source) => listSourceLinks(client, userId, source),
    async listBehaviors(ids) {
      if (ids.length === 0) return [];
      const { data, error } = await client.from("behaviors").select("id,timezone,active,archived_at").eq("user_id", userId).in("id", [...ids]);
      if (error) throw new ConnectorError("provider_unavailable");
      return (data ?? []).filter((row) => row.active && !row.archived_at)
        .map((row) => ({ id: row.id, timezone: row.timezone ?? DEFAULT_TIMEZONE }));
    },
    listOccurrences: (_behaviorIds, start, end) => listOccurrencesBetweenLocalDates(client, userId, start, end),
    async latestStatusEventIds(occurrenceIds) {
      const events = await listOccurrenceStatusEventsByOccurrenceIds(client, userId, [...occurrenceIds]);
      const latest = new Map<string, { id: string; recorded_at: string; created_at: string }>();
      for (const event of events) {
        const previous = latest.get(event.occurrence_id);
        if (!previous || compareEvents(event, previous) > 0) latest.set(event.occurrence_id, event);
      }
      return new Map([...latest].map(([occurrenceId, event]) => [occurrenceId, event.id]));
    },
    async listMatches(source, occurrenceIds, activityRefs) {
      const [byOccurrence, byActivity] = await Promise.all([
        listSourceMatchesForOccurrences(client, userId, occurrenceIds),
        listSourceMatchesForActivities(client, userId, source, activityRefs),
      ]);
      return [...byOccurrence, ...byActivity].map(toActivityMatchRecord);
    },
    applyCompletion: (input) => applyConnectorCompletion(client, input),
    attach: (input) => attachSourceActivity(client, input),
    remove: (input) => removeSourceMatch(client, input),
    async repairReminders(occurrenceIds, now) {
      const { repairClearedDecisionReminderCoverage } = await import("./occurrence.service");
      const { getOccurrenceWithBehaviorTimezoneById } = await import("@/lib/db/occurrences.repo");
      for (const occurrenceId of occurrenceIds) {
        const occurrence = await getOccurrenceWithBehaviorTimezoneById(client, userId, occurrenceId);
        if (!occurrence) continue;
        await repairClearedDecisionReminderCoverage(client, userId, {
          occurrence,
          timezone: occurrence.behavior?.timezone ?? DEFAULT_TIMEZONE,
          now,
        });
      }
    },
    revalidate() {
      void import("next/cache").then(({ revalidatePath }) => {
        try { revalidatePath("/timeline"); } catch { /* outside a request: nothing to revalidate */ }
      }).catch(() => undefined);
    },
  };
}

/**
 * Ticket 321: background checks stop (`next_check_at` null) while a source is
 * disconnected. A reconnect or a successful reconcile schedules the next visit now,
 * only when no visit is scheduled. Writes nothing when the account has no state row.
 */
export async function rearmConnectorCompletionChecks(
  client: AppSupabaseClient,
  userId: string,
  source: RecordedActivitySourceV1_1,
  at: string,
): Promise<void> {
  const { error } = await client.from("connector_completion_state")
    .update({ next_check_at: at })
    .eq("user_id", userId).eq("source", source).is("next_check_at", null);
  if (error) throw new ConnectorError("provider_unavailable");
}

function compareEvents(left: { recorded_at: string; created_at: string; id: string }, right: { recorded_at: string; created_at: string; id: string }): number {
  return Temporal.Instant.compare(Temporal.Instant.from(left.recorded_at), Temporal.Instant.from(right.recorded_at))
    || Temporal.Instant.compare(Temporal.Instant.from(left.created_at), Temporal.Instant.from(right.created_at))
    || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}
