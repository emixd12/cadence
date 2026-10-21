import { createHash } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import {
  ADHERENCE_DEFINITION, INTEGRATION_CONTRACT_VERSION, INTEGRATION_LIMITS as L,
  createIntegrationError, type IntegrationError, type IntegrationErrorCode,
  type IntegrationOperationInput, type IntegrationOperationOutput,
  type OccurrenceDetailOutput,
} from "@cadence/core/integration";
import { resolvePersistedTimeline } from "@cadence/core/services/timeline.service";
import { resolveAdherenceCounts } from "@cadence/core/resolvers/analytics.resolver";
import { resolveOccurrenceTimeTracking } from "@cadence/core/resolvers/time-tracking.resolver";
import { normalizeOccurrenceStatus } from "@cadence/core/services/occurrence.service";
import { TIMELINE_MAX_FUTURE_DAYS } from "@cadence/core/resolvers/timeline.resolver";
import { DEFAULT_TIMEZONE } from "@cadence/core/types/recurrence";
import type { IntegrationContext } from "@/lib/integrations/request-context";
import type { BehaviorWithCategory } from "@/lib/db/behaviors.repo";
import { getOccurrenceById } from "@/lib/db/occurrences.repo";
import { listOccurrenceStatusEventsByOccurrenceIds } from "@/lib/db/occurrenceStatusEvents.repo";
import { listTimeSessionsForOccurrence } from "@/lib/db/timeSessions.repo";
import { listExternalReferences } from "@/lib/db/integration.repo";
import { readIntegrationCategories, readIntegrationOccurrences } from "@/lib/db/integration-read.repo";
import { getBehaviorReadDataForUser } from "./behavior.service";
import { ensureUserOccurrencesFresh } from "./occurrence.service";
import { readOccurrenceSyncState } from "./occurrence-sync-state.service";
import { integrationInstant, serializeIntegrationBehavior, serializeIntegrationOccurrence } from "./integration-read-serialization";
import type { Occurrence } from "@/lib/types/database";

export class IntegrationReadError extends Error {
  readonly error: IntegrationError;
  constructor(code: IntegrationErrorCode, message: string) {
    super(message);
    this.error = createIntegrationError(code, message);
  }
}

async function readAccount(context: IntegrationContext, maintain = false) {
  const { behaviors, profileTimezone } = await getBehaviorReadDataForUser(context.supabase, context.userId);
  const timezone = profileTimezone ?? DEFAULT_TIMEZONE;
  const now = Temporal.Instant.from(context.now.toISOString());
  const local = now.toZonedDateTimeISO(timezone);
  let generatedThrough: string | null = null;
  if (maintain) {
    await ensureUserOccurrencesFresh(context.supabase, context.userId, {
      behaviors, timezone, now, horizonDays: TIMELINE_MAX_FUTURE_DAYS,
      planReminderDeliveries: false,
    });
    // A concurrent configuration change may fence sync completion. Never claim stale coverage.
    const state = await readOccurrenceSyncState(context.supabase, context.userId);
    if (state && !state.stale && state.timezone === timezone && state.last_synced_local_date === local.toPlainDate().toString()) {
      generatedThrough = state.synced_through_local_date;
    }
  }
  return {
    behaviors, timezone, now, today: local.toPlainDate().toString(),
    localTime: local.toPlainTime().toString({ smallestUnit: "minute" }),
    freshness: { as_of: now.toString(), occurrences_generated_through: generatedThrough },
  };
}

type Account = Awaited<ReturnType<typeof readAccount>>;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("base64url");
const changedSince = (updatedAt: string, since?: string) => !since || Temporal.Instant.compare(Temporal.Instant.from(updatedAt), Temporal.Instant.from(since)) >= 0;
const occurrenceKey = (row: Occurrence) => `${row.local_date}/${Temporal.Instant.from(row.scheduled_for).toString({ fractionalSecondDigits: 9 })}/${row.id}`;

function page<T>(context: IntegrationContext, rows: T[], input: { cursor?: string; page_size?: number }, binding: unknown, key: (row: T) => string) {
  const scope = digest([context.userId, context.actor.clientId, binding]);
  let after = "";
  if (input.cursor) {
    try {
      const parsed: unknown = JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8"));
      if (!Array.isArray(parsed) || parsed.length !== 2 || parsed[0] !== scope || typeof parsed[1] !== "string") throw new Error();
      after = parsed[1];
    } catch {
      throw new IntegrationReadError("invalid_input", "The cursor does not match this account or query. Start a new first page.");
    }
  }
  const sorted = rows.map((row) => ({ row, key: key(row) })).sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  const remaining = sorted.filter((entry) => entry.key > after);
  const selected = remaining.slice(0, input.page_size ?? L.defaultPageSize);
  const last = selected.at(-1);
  return {
    rows: selected.map((entry) => entry.row),
    next_cursor: last && remaining.length > selected.length ? Buffer.from(JSON.stringify([scope, last.key])).toString("base64url") : null,
  };
}

function findBehavior(account: Account, id: string): BehaviorWithCategory {
  const behavior = account.behaviors.find((row) => row.id === id);
  if (!behavior) throw new IntegrationReadError("not_found", "No Behavior with that id exists for this account.");
  return behavior;
}

function serializeOccurrences(account: Account, occurrences: Occurrence[]) {
  const behaviors = new Map(account.behaviors.map((row) => [row.id, row]));
  return occurrences.map((row) => {
    const behavior = behaviors.get(row.behavior_id);
    if (!behavior) throw new IntegrationReadError("service_unavailable", "Tracking data changed during this read. Retry the request.");
    return serializeIntegrationOccurrence(row, behavior, account.now, account.timezone);
  });
}

async function behaviorResult(context: IntegrationContext, behavior: BehaviorWithCategory) {
  const refs = await listExternalReferences(context.supabase, { entityType: "behavior", entityIds: [behavior.id] });
  return serializeIntegrationBehavior(behavior, refs.get(behavior.id) ?? null);
}

async function occurrenceDetail(context: IntegrationContext, account: Account, id: string): Promise<OccurrenceDetailOutput> {
  const row = await getOccurrenceById(context.supabase, context.userId, id);
  if (!row) throw new IntegrationReadError("not_found", "No Occurrence with that id exists for this account.");
  const [events, sessions] = await Promise.all([
    listOccurrenceStatusEventsByOccurrenceIds(context.supabase, context.userId, [id]),
    listTimeSessionsForOccurrence(context.supabase, { userId: context.userId, occurrenceId: id }),
  ]);
  return {
    ...serializeIntegrationOccurrence(row, findBehavior(account, row.behavior_id), account.now, account.timezone),
    status_history: events.map((event) => ({
      id: event.id, previous_status: event.previous_status === null ? null : normalizeOccurrenceStatus(event.previous_status),
      status: normalizeOccurrenceStatus(event.status),
      semantics: event.status_semantics as OccurrenceDetailOutput["status_history"][number]["semantics"],
      capture_method: event.source_capture_method as OccurrenceDetailOutput["status_history"][number]["capture_method"],
      recorded_at: integrationInstant(event.recorded_at),
      effective_at: event.effective_at === null ? null : integrationInstant(event.effective_at),
      local_date: event.local_date, timezone: event.timezone,
    })),
    time_sessions: sessions.map((session) => ({
      id: session.id, started_at: integrationInstant(session.started_at),
      stopped_at: session.stopped_at === null ? null : integrationInstant(session.stopped_at),
      duration_seconds: session.stopped_at === null ? null : Math.floor(resolveOccurrenceTimeTracking([{
        id: session.id, userId: context.userId, occurrenceId: id, behaviorId: row.behavior_id,
        startedAt: session.started_at, stoppedAt: session.stopped_at,
      }]).recordedSeconds),
    })),
  };
}

export async function getIntegrationAccountContext(context: IntegrationContext): Promise<IntegrationOperationOutput<"get_account_context">> {
  const account = await readAccount(context, true);
  return {
    account_ref: digest(["cadence-account-v1", context.actor.clientId, context.userId]),
    timezone: account.timezone, today_local_date: account.today, local_time: account.localTime,
    now: account.now.toString(), granted_scopes: [...context.actor.grantedScopes],
    contract_version: INTEGRATION_CONTRACT_VERSION, freshness: account.freshness,
  };
}

export async function listIntegrationBehaviors(context: IntegrationContext, input: IntegrationOperationInput<"list_behaviors">): Promise<IntegrationOperationOutput<"list_behaviors">> {
  const account = await readAccount(context);
  const rows = account.behaviors.filter((row) =>
    (!input.state || input.state === "all" || row.active === (input.state === "active")) &&
    (!input.category_id || row.category_id === input.category_id) && changedSince(row.updated_at, input.updated_since),
  );
  const selected = page(context, rows, input, ["behaviors", input.state ?? "all", input.category_id, input.updated_since], (row) => row.id);
  const refs = await listExternalReferences(context.supabase, { entityType: "behavior", entityIds: selected.rows.map((row) => row.id) });
  return { behaviors: selected.rows.map((row) => serializeIntegrationBehavior(row, refs.get(row.id) ?? null)), next_cursor: selected.next_cursor };
}

export async function getIntegrationBehavior(context: IntegrationContext, input: IntegrationOperationInput<"get_behavior">): Promise<IntegrationOperationOutput<"get_behavior">> {
  return { behavior: await behaviorResult(context, findBehavior(await readAccount(context), input.behavior_id)) };
}

export async function listIntegrationCategories(context: IntegrationContext, input: IntegrationOperationInput<"list_categories">): Promise<IntegrationOperationOutput<"list_categories">> {
  const rows = (await readIntegrationCategories(context.supabase, context.userId)).filter((row) => changedSince(row.updated_at, input.updated_since));
  const selected = page(context, rows, input, ["categories", input.updated_since], (row) => `${String(row.sort_order + 2147483648).padStart(10, "0")}/${row.id}`);
  return { categories: selected.rows.map((row) => ({
    id: row.id, name: row.name, description: row.description, sort_order: row.sort_order,
    created_at: integrationInstant(row.created_at), updated_at: integrationInstant(row.updated_at),
  })), next_cursor: selected.next_cursor };
}

export async function getIntegrationTimeline(context: IntegrationContext, input: IntegrationOperationInput<"get_timeline">): Promise<IntegrationOperationOutput<"get_timeline">> {
  const account = await readAccount(context, true);
  const start = input.start_local_date ?? account.today;
  const days = input.days ?? 1;
  const end = Temporal.PlainDate.from(start).add({ days: days - 1 }).toString();
  const lookback = Temporal.PlainDate.from(account.today).subtract({ days: L.needsDecisionLookbackDays }).toString();
  const includeNeedsDecision = input.include_needs_decision !== false;
  const [range, backlog] = await Promise.all([
    readIntegrationOccurrences(context.supabase, context.userId, { startLocalDate: start, endLocalDate: end }),
    includeNeedsDecision ? readIntegrationOccurrences(context.supabase, context.userId, {
      startLocalDate: lookback, endLocalDate: Temporal.PlainDate.from(account.today).subtract({ days: 1 }).toString(),
    }) : Promise.resolve([]),
  ]);
  const rows = [...new Map([...range, ...backlog].map((row) => [row.id, row])).values()];
  const timeline = resolvePersistedTimeline({
    behaviors: account.behaviors, occurrences: rows, timeSessions: [], now: account.now,
    timezone: account.timezone, startLocalDate: start, futureDays: days - 1,
  });
  const serialized = new Map(serializeOccurrences(account, rows).map((row) => [row.id, row]));
  const needs = timeline.needsDecision.daySections.flatMap((day) => day.occurrences).filter((row) => row.localDate >= lookback).map((row) => serialized.get(row.id)!);
  if (includeNeedsDecision && needs.length > L.maxNeedsDecisionItems) {
    throw new IntegrationReadError("limit_exceeded", "Needs decision exceeds 100 Occurrences. Set include_needs_decision to false and use list_occurrences with needs_decision_only.");
  }
  return {
    timezone: account.timezone, today_local_date: account.today,
    needs_decision: includeNeedsDecision ? { occurrences: needs, total_count: needs.length, truncated: false, lookback_start_local_date: lookback } : null,
    days: timeline.daySections.map((day) => ({
      local_date: day.localDate, is_today: day.localDate === account.today,
      occurrences: day.occurrences.map((row) => serialized.get(row.id)!),
    })), freshness: account.freshness,
  };
}

export async function listIntegrationOccurrences(context: IntegrationContext, input: IntegrationOperationInput<"list_occurrences">): Promise<IntegrationOperationOutput<"list_occurrences">> {
  const account = await readAccount(context, true);
  const rows = await readIntegrationOccurrences(context.supabase, context.userId, { startLocalDate: input.start_local_date, endLocalDate: input.end_local_date });
  const serialized = new Map(serializeOccurrences(account, rows).map((row) => [row.id, row]));
  const filtered = rows.filter((row) => (!input.behavior_ids || input.behavior_ids.includes(row.behavior_id)) &&
    (!input.statuses || input.statuses.includes(normalizeOccurrenceStatus(row.status))) &&
    (!input.needs_decision_only || serialized.get(row.id)!.needs_decision) && changedSince(row.updated_at, input.updated_since));
  const selected = page(context, filtered, input, ["occurrences", input.start_local_date, input.end_local_date,
    input.behavior_ids?.slice().sort(), input.statuses?.slice().sort(), input.needs_decision_only ?? false,
    input.updated_since, input.needs_decision_only ? account.today : null], occurrenceKey);
  return { timezone: account.timezone, occurrences: selected.rows.map((row) => serialized.get(row.id)!), next_cursor: selected.next_cursor, freshness: account.freshness };
}

export async function getIntegrationOccurrence(context: IntegrationContext, input: IntegrationOperationInput<"get_occurrence">): Promise<IntegrationOperationOutput<"get_occurrence">> {
  return { occurrence: await occurrenceDetail(context, await readAccount(context, true), input.occurrence_id) };
}

export async function getIntegrationAdherenceSummary(context: IntegrationContext, input: IntegrationOperationInput<"get_adherence_summary">): Promise<IntegrationOperationOutput<"get_adherence_summary">> {
  const account = await readAccount(context, true);
  const rows = (await readIntegrationOccurrences(context.supabase, context.userId, { startLocalDate: input.start_local_date, endLocalDate: input.end_local_date }))
    .filter((row) => !input.behavior_ids || input.behavior_ids.includes(row.behavior_id));
  const counts = (occurrences: Occurrence[]) => {
    const summary = resolveAdherenceCounts({ todayLocalDate: account.today,
      occurrences: occurrences.map((row) => ({ status: normalizeOccurrenceStatus(row.status), localDate: row.local_date })),
    });
    return { completed: summary.completedCount, not_completed: summary.notCompletedCount,
      unresolved: summary.unresolvedCount, needs_decision: summary.needsDecisionCount, adherence_rate: summary.rate };
  };
  return {
    start_local_date: input.start_local_date, end_local_date: input.end_local_date,
    timezone: account.timezone, adherence_definition: ADHERENCE_DEFINITION, overall: counts(rows),
    behaviors: account.behaviors.filter((row) => !input.behavior_ids || input.behavior_ids.includes(row.id)).map((behavior) => ({
      behavior_id: behavior.id, behavior_title: behavior.title, state: behavior.active ? "active" : "archived",
      ...counts(rows.filter((row) => row.behavior_id === behavior.id)),
    })),
  };
}

const behaviorUrl = (id: string) => `https://app.cadence-me.com/behaviors?behavior=${id}`;
const occurrenceUrl = (row: { behavior_id: string; local_date: string }) => `https://app.cadence-me.com/behaviors?behavior=${row.behavior_id}&day=${row.local_date}&range=90`;

export async function searchIntegrationRecords(context: IntegrationContext, input: IntegrationOperationInput<"search">): Promise<IntegrationOperationOutput<"search">> {
  const account = await readAccount(context, true);
  const query = input.query.trim().toLocaleLowerCase("en-US");
  const matches = (text: string | null) => text?.toLocaleLowerCase("en-US").includes(query) ?? false;
  const behaviors = account.behaviors.filter((row) => matches(row.title) || matches(row.description) ||
    serializeIntegrationBehavior(row, null).archive_notes.some((note) => matches(note.note)));
  const occurrences = (await readIntegrationOccurrences(context.supabase, context.userId)).filter((row) => matches(row.note));
  if (behaviors.length + occurrences.length > L.maxSearchResults) throw new IntegrationReadError("limit_exceeded", "More than 20 records match. Use more specific search text.");
  return { results: [
    ...behaviors.map((row) => ({ id: `behavior:${row.id}`, title: row.title, url: behaviorUrl(row.id) })),
    ...occurrences.map((row) => ({ id: `occurrence:${row.id}`, title: `${findBehavior(account, row.behavior_id).title} — ${row.local_date}`, url: occurrenceUrl(row) })),
  ].sort((a, b) => a.id.localeCompare(b.id)) };
}

export async function fetchIntegrationRecord(context: IntegrationContext, input: IntegrationOperationInput<"fetch">): Promise<IntegrationOperationOutput<"fetch">> {
  const [kind, id] = input.id.split(":");
  const account = await readAccount(context, kind === "occurrence");
  if (kind === "behavior") {
    const behavior = await behaviorResult(context, findBehavior(account, id));
    return { id: input.id, title: behavior.title, text: JSON.stringify(behavior, null, 2), url: behaviorUrl(id), metadata: { kind, behavior_id: id } };
  }
  const occurrence = await occurrenceDetail(context, account, id);
  return { id: input.id, title: `${occurrence.behavior_title} — ${occurrence.local_date}`, text: JSON.stringify(occurrence, null, 2), url: occurrenceUrl(occurrence),
    metadata: { kind: "occurrence", behavior_id: occurrence.behavior_id, local_date: occurrence.local_date, status: occurrence.status } };
}
