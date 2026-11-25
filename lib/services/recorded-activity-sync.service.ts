import { Temporal } from "@js-temporal/polyfill";
import {
  HEVY_WORKOUTS_ADAPTER_VERSION,
  RECORDED_ACTIVITY_SCHEMA_VERSION,
  RECORDED_ACTIVITY_SOURCE,
  type RecordedActivity,
  type RecordedActivitySnapshotV1,
  type RecordedActivitySourceV1_1,
  type RecordedActivityV1_1,
} from "@cadence/core/types/recorded-activity";
import {
  isUnlinkedAccountInactive,
  resolveUnlinkedDailySyncSchedule,
} from "@cadence/core/resolvers/completion-check-schedule.resolver";
import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import { readConnectorConnection } from "@/lib/db/connectors.repo";
import {
  deleteRecordedActivitiesForSource,
  listRecordedActivitiesInRange,
  markRecordedActivitiesRemoved,
  toRecordedActivity,
  upsertRecordedActivities,
  type UpsertRecordedActivityInput,
} from "@/lib/db/recordedActivities.repo";
import { listSourceLinks } from "@/lib/db/sourceLinks.repo";
import { reportMonitoringEvent } from "@/lib/monitoring/privacy-safe-events";
import { ConnectorError } from "@/lib/types/connectors";
import { DEFAULT_TIMEZONE } from "@/lib/types/recurrence";
import {
  formatCompletionCursor,
  parseCompletionCursor,
  type CompletionSourceEvidence,
} from "./completion-sources";
import {
  markConnectorReconnectRequired,
  withConnectorCredential,
  type ConnectorCaller,
} from "./connector-credentials";
import {
  assertConnectorReadActive,
  withConnectorReadDeadline,
} from "./connector-read-deadline";
import {
  HEVY_READ_DEADLINE_MS,
  HevyProviderError,
  readHevyLedgerBackfill,
  readHevyMatchChanges,
  type HevyRequestOptions,
} from "./hevy-provider";

// Tickets 352 & 353 (decision 2026-11-24): persisted recorded-activity ledger,
// incremental sync, bounded connect backfill, 15-minute on-demand freshness,
// unlinked daily background sync, and non-PII telemetry.

export const RECORDED_ACTIVITY_FRESHNESS_SECONDS = 15 * 60;
const CURSOR_MARGIN_MINUTES = 5;
const HEX_64 = /^[a-f0-9]{64}$/u;

export type HevyReadSurface = "daily_brief" | "chat" | "timeline";
export type HevyAccountMode = "linked" | "unlinked";
export type HevySyncOutcome =
  | "fresh_cache_hit"
  | "incremental_sync"
  | "full_fallback"
  | "failed"
  | "timeout";

export type LedgerSyncResult = Readonly<{
  outcome: HevySyncOutcome;
  pagesFetched: number;
  durationMs: number;
  upsertedCount: number;
  removedCount: number;
  connectionGeneration: number | null;
}>;

export type RecordedActivityReadResult = Readonly<{
  activities: RecordedActivity[];
  completeness: "complete" | "incomplete";
  fetchedAt: string;
  connectionGeneration: number;
  sync: LedgerSyncResult;
  accountMode: HevyAccountMode;
}>;

type SyncOptions = Pick<HevyRequestOptions, "fetch" | "clock" | "sleep" | "random" | "signal" | "deadlineMs"> &
  Readonly<{
    expectedConnectionGeneration?: number;
    freshnessSeconds?: number;
    touchUserActivity?: boolean;
  }>;

export function toUpsertInput(
  source: RecordedActivitySourceV1_1,
  activity: RecordedActivityV1_1,
  accountDigest: string,
  connectionGeneration: number,
  syncedAt: string,
): UpsertRecordedActivityInput {
  return {
    source,
    activity_ref: activity.id,
    kind: activity.kind,
    start_at: activity.startAt,
    end_at: activity.endAt,
    local_start_date: activity.localStartDate,
    duration_seconds: activity.duration.seconds,
    selector_digest: activity.selectorKeys && activity.selectorKeys.length > 0 ? activity.selectorKeys[0] : null,
    provider_updated_at: activity.revision.providerUpdatedAt,
    state: "active",
    account_digest: accountDigest,
    connection_generation: connectionGeneration,
    synced_at: syncedAt,
  };
}

/**
 * Ticket 352: share connector-completion reconcile evidence with `recorded_activities`
 * so completion and the ledger share one sync pass. Best-effort; never throws.
 */
export async function persistCompletionEvidenceToLedger(
  client: AppSupabaseClient,
  userId: string,
  source: RecordedActivitySourceV1_1,
  evidence: CompletionSourceEvidence,
  syncedAt: string,
): Promise<void> {
  if (!HEX_64.test(evidence.accountDigest) || !Number.isSafeInteger(evidence.connectionGeneration) || evidence.connectionGeneration < 1) {
    return;
  }
  try {
    const rows = evidence.activities.map((activity) =>
      toUpsertInput(source, activity, evidence.accountDigest, evidence.connectionGeneration, syncedAt),
    );
    if (rows.length > 0) await upsertRecordedActivities(client, userId, rows);
    if (evidence.deletedActivityRefs.length > 0) {
      await markRecordedActivitiesRemoved(client, userId, source, evidence.deletedActivityRefs, syncedAt);
    }
    await client
      .from("connector_completion_state")
      .update({ last_synced_at: syncedAt })
      .eq("user_id", userId)
      .eq("source", source);
  } catch {
    // Best-effort ledger sharing; never fails reconcile.
  }
}

/** Ticket 352: hard-delete all persisted recorded activities on disconnect. Best-effort. */
export async function clearRecordedActivitiesOnDisconnect(
  client: AppSupabaseClient,
  userId: string,
  source: RecordedActivitySourceV1_1,
): Promise<void> {
  try {
    await deleteRecordedActivitiesForSource(client, userId, source);
  } catch {
    // Best-effort cleanup; never blocks disconnect.
  }
  try {
    await client
      .from("connector_completion_state")
      .update({
        next_check_at: null,
        read_cursor: null,
        last_synced_at: null,
        backfilled_at: null,
        paused_for_inactivity: false,
      })
      .eq("user_id", userId)
      .eq("source", source);
  } catch {
    // Best-effort state reset.
  }
}

/**
 * Ticket 352 & 353: bounded initial backfill on Hevy connect + initialize
 * daily background sync schedule for unlinked accounts. Best-effort.
 */
export async function backfillHevyOnConnect(
  caller: ConnectorCaller,
  options: SyncOptions = {},
): Promise<LedgerSyncResult> {
  const clock = options.clock ?? Date.now;
  const startedMs = clock();
  try {
    const connection = await readConnectorConnection(caller.client, caller.user.id, "hevy");
    if (!connection || connection.status !== "connected" || !connection.accountDigest || !HEX_64.test(connection.accountDigest)) {
      return { outcome: "failed", pagesFetched: 0, durationMs: Math.max(0, clock() - startedMs), upsertedCount: 0, removedCount: 0, connectionGeneration: null };
    }
    return await syncHevyLedger(caller, { ...options, touchUserActivity: true, freshnessSeconds: 0 });
  } catch {
    return { outcome: "failed", pagesFetched: 0, durationMs: Math.max(0, clock() - startedMs), upsertedCount: 0, removedCount: 0, connectionGeneration: null };
  }
}

/**
 * Ticket 352 & 353: incremental sync (or bounded full fallback when no valid cursor
 * exists) for one connected Hevy account. Updates `recorded_activities` and
 * `connector_completion_state`.
 */
export async function syncHevyLedger(
  caller: ConnectorCaller,
  options: SyncOptions = {},
): Promise<LedgerSyncResult> {
  const clock = options.clock ?? Date.now;
  const startedMs = clock();
  const freshnessSeconds = options.freshnessSeconds ?? RECORDED_ACTIVITY_FRESHNESS_SECONDS;

  return withConnectorReadDeadline(options, HEVY_READ_DEADLINE_MS, async (bounded, deadlineAt) => {
    const nowInstant = Temporal.Instant.fromEpochMilliseconds(clock());
    const nowIso = nowInstant.toString();
    const [timezone, stateRow, links] = await Promise.all([
      readProfileTimezone(caller, bounded.signal),
      readSyncState(caller.client, caller.user.id, "hevy"),
      listSourceLinks(caller.client, caller.user.id, "hevy").catch(() => []),
    ]);
    assertConnectorReadActive(bounded, deadlineAt);
    const isLinked = links.some((link) => link.enabled);

    // Touch user activity & re-arm paused unlinked accounts on foreground open.
    if (options.touchUserActivity) {
      await touchUserActivityAndRearm(caller.client, caller.user.id, "hevy", nowInstant, timezone, isLinked, stateRow);
    }

    // Check freshness window if we already have a completed backfill/sync.
    const lastSyncedAt = stateRow?.last_synced_at ?? stateRow?.last_reconciled_at ?? null;
    if (
      freshnessSeconds > 0 &&
      lastSyncedAt &&
      stateRow?.backfilled_at &&
      nowInstant.since(Temporal.Instant.from(lastSyncedAt)).total({ unit: "seconds" }) < freshnessSeconds
    ) {
      const connection = await readConnectorConnection(caller.client, caller.user.id, "hevy");
      if (connection && connection.status === "connected") {
        if (options.expectedConnectionGeneration !== undefined && options.expectedConnectionGeneration !== connection.generation) {
          throw new ConnectorError("connection_changed");
        }
        return {
          outcome: "fresh_cache_hit",
          pagesFetched: 0,
          durationMs: Math.max(0, clock() - startedMs),
          upsertedCount: 0,
          removedCount: 0,
          connectionGeneration: connection.generation,
        };
      }
    }

    try {
      return await withConnectorCredential(caller, "hevy", async (credential, connection) => {
        assertConnectorReadActive(bounded, deadlineAt);
        if (credential.provider !== "hevy" || !connection.accountDigest || !HEX_64.test(connection.accountDigest)) {
          throw new ConnectorError("reconnect_required");
        }
        if (options.expectedConnectionGeneration !== undefined && options.expectedConnectionGeneration !== connection.generation) {
          throw new ConnectorError("connection_changed");
        }

        const cursor = parseCompletionCursor(stateRow?.read_cursor ?? null);
        const canIncremental = Boolean(cursor && cursor.generation === connection.generation && stateRow?.backfilled_at);
        const today = Temporal.Instant.fromEpochMilliseconds(clock()).toZonedDateTimeISO(timezone).toPlainDate();

        let pagesFetched = 0;
        let upsertedCount = 0;
        let removedCount = 0;
        let nextCursor: string | null = stateRow?.read_cursor ?? null;
        let outcome: HevySyncOutcome = "full_fallback";
        let backfilledAt = stateRow?.backfilled_at ?? null;

        if (canIncremental && cursor) {
          const changes = await readHevyMatchChanges({
            ...bounded,
            clock,
            deadlineMs: deadlineAt - clock(),
            apiKey: credential.apiKey,
            accountId: caller.user.id,
            connectionGeneration: connection.generation,
            accountDigest: connection.accountDigest,
            range: { startLocalDate: "2000-01-01", endLocalDate: today.toString(), timezone },
            since: cursor.since,
          });
          pagesFetched += changes.pagesFetched;
          if (changes.complete) {
            outcome = "incremental_sync";
            const finishedIso = Temporal.Instant.fromEpochMilliseconds(clock()).toString();
            const rows = changes.activities.map((activity) =>
              toUpsertInput("hevy", activity, connection.accountDigest!, connection.generation, finishedIso),
            );
            upsertedCount = await upsertRecordedActivities(caller.client, caller.user.id, rows);
            removedCount = await markRecordedActivitiesRemoved(caller.client, caller.user.id, "hevy", changes.deletedActivityRefs, finishedIso);
            const margin = Temporal.Instant.from(changes.fetchedAt).subtract({ minutes: CURSOR_MARGIN_MINUTES }).toString();
            const advanced = Temporal.Instant.compare(Temporal.Instant.from(cursor.since), Temporal.Instant.from(margin)) >= 0
              ? cursor.since
              : margin;
            nextCursor = formatCompletionCursor(connection.generation, advanced);
          }
        }

        if (outcome === "full_fallback") {
          const full = await readHevyLedgerBackfill({
            ...bounded,
            clock,
            deadlineMs: deadlineAt - clock(),
            apiKey: credential.apiKey,
            accountId: caller.user.id,
            connectionGeneration: connection.generation,
            accountDigest: connection.accountDigest,
            timezone,
          });
          pagesFetched += full.pagesFetched;
          const finishedIso = Temporal.Instant.fromEpochMilliseconds(clock()).toString();
          const rows = full.activities.map((activity) =>
            toUpsertInput("hevy", activity, connection.accountDigest!, connection.generation, finishedIso),
          );
          upsertedCount = await upsertRecordedActivities(caller.client, caller.user.id, rows);
          backfilledAt = finishedIso;
          const margin = Temporal.Instant.from(full.fetchedAt).subtract({ minutes: CURSOR_MARGIN_MINUTES }).toString();
          nextCursor = formatCompletionCursor(connection.generation, margin);
        }

        const finishedInstant = Temporal.Instant.fromEpochMilliseconds(clock());
        const finishedIso = finishedInstant.toString();
        const schedule = !isLinked
          ? resolveUnlinkedDailySyncSchedule({
            now: finishedInstant,
            timezone,
            consecutiveFailures: 0,
            lastAttemptAt: finishedIso,
            lastUserActivityAt: options.touchUserActivity ? nowIso : (stateRow?.last_user_activity_at ?? nowIso),
            reconnectRequired: false,
          })
          : null;

        await upsertSyncState(caller.client, caller.user.id, "hevy", {
          read_cursor: nextCursor,
          last_synced_at: finishedIso,
          last_attempted_at: finishedIso,
          backfilled_at: backfilledAt,
          consecutive_failures: 0,
          sync_priority: isLinked ? 1 : 2,
          ...(options.touchUserActivity ? { last_user_activity_at: nowIso, paused_for_inactivity: false } : {}),
          ...(schedule ? { next_check_at: schedule.nextCheckAt, paused_for_inactivity: schedule.pausedForInactivity } : {}),
        });

        return {
          outcome,
          pagesFetched,
          durationMs: Math.max(0, clock() - startedMs),
          upsertedCount,
          removedCount,
          connectionGeneration: connection.generation,
        };
      });
    } catch (error) {
      const mapped = mapSyncError(error);
      if (mapped.code === "reconnect_required") {
        const connection = await readConnectorConnection(caller.client, caller.user.id, "hevy").catch(() => null);
        if (connection) await markConnectorReconnectRequired(connection).catch(() => undefined);
      }
      if (mapped.code === "connection_changed" || mapped.code === "not_connected" || mapped.code === "reconnect_required") {
        throw mapped;
      }
      const outcome: HevySyncOutcome = mapped.code === "timeout" ? "timeout" : "failed";
      await recordSyncFailure(caller.client, caller.user.id, "hevy", clock(), stateRow?.consecutive_failures ?? 0).catch(() => undefined);
      return {
        outcome,
        pagesFetched: 0,
        durationMs: Math.max(0, clock() - startedMs),
        upsertedCount: 0,
        removedCount: 0,
        connectionGeneration: null,
      };
    }
  });
}

/**
 * Ticket 353: primary read entrypoint for Daily Brief, Chat (`list_workouts`, no
 * 31-day cap), and Timeline (`countableWorkouts`). Checks 15-minute freshness,
 * syncs incrementally if stale, reads from `recorded_activities`, and emits
 * non-PII telemetry via `reportMonitoringEvent`.
 */
export async function getPersistedHevyActivities(
  caller: ConnectorCaller,
  startLocalDate: string,
  endLocalDate: string,
  surface: HevyReadSurface,
  options: SyncOptions = {},
): Promise<RecordedActivityReadResult> {
  const clock = options.clock ?? Date.now;
  const timezone = await readProfileTimezone(caller, options.signal);
  const today = Temporal.Instant.fromEpochMilliseconds(clock()).toZonedDateTimeISO(timezone).toPlainDate();
  validateLedgerReadRange(startLocalDate, endLocalDate, today);

  const links = await listSourceLinks(caller.client, caller.user.id, "hevy").catch(() => []);
  const accountMode: HevyAccountMode = links.some((link) => link.enabled) ? "linked" : "unlinked";

  const sync = await syncHevyLedger(caller, {
    ...options,
    touchUserActivity: true,
  });

  reportMonitoringEvent({
    name: "hevy_recorded_activity_read",
    severity: sync.outcome === "failed" || sync.outcome === "timeout" ? "warning" : "info",
    context: {
      surface,
      account_mode: accountMode,
      sync_outcome: sync.outcome,
      sync_duration_ms: sync.durationMs,
      pages_fetched: sync.pagesFetched,
    },
  });

  const connection = await readConnectorConnection(caller.client, caller.user.id, "hevy");
  if (!connection || connection.status !== "connected") {
    throw new ConnectorError(connection?.status === "reconnect_required" ? "reconnect_required" : "not_connected");
  }
  if (options.expectedConnectionGeneration !== undefined && options.expectedConnectionGeneration !== connection.generation) {
    throw new ConnectorError("connection_changed");
  }

  const rows = await listRecordedActivitiesInRange(
    caller.client,
    caller.user.id,
    "hevy",
    startLocalDate,
    endLocalDate,
    { signal: options.signal, connectionGeneration: connection.generation },
  );
  const completeness: "complete" | "incomplete" =
    sync.outcome === "failed" || sync.outcome === "timeout" ? "incomplete" : "complete";

  return {
    activities: rows.map(toRecordedActivity),
    completeness,
    fetchedAt: Temporal.Instant.fromEpochMilliseconds(clock()).toString(),
    connectionGeneration: connection.generation,
    sync,
    accountMode,
  };
}

/**
 * Formats persisted Hevy activities as a `RecordedActivitySnapshotV1` for
 * Timeline (`app/api/hevy/activities/route.ts`) and Daily Brief
 * (`advisor-day-context.service.ts`) so existing consumers keep their exact contract.
 */
export async function getPersistedHevySnapshotV1(
  caller: ConnectorCaller,
  startLocalDate: string,
  endLocalDate: string,
  surface: HevyReadSurface,
  options: SyncOptions = {},
): Promise<RecordedActivitySnapshotV1> {
  const connection = await readConnectorConnection(caller.client, caller.user.id, "hevy").catch(() => null);
  if (!connection || (connection.status === "connected" && (!connection.accountDigest || !HEX_64.test(connection.accountDigest)))) {
    const { getHevyActivities } = await import("./hevy.service");
    return getHevyActivities(caller, startLocalDate, endLocalDate, options);
  }
  const timezone = await readProfileTimezone(caller, options.signal);
  if (surface === "timeline") {
    const today = Temporal.Instant.fromEpochMilliseconds((options.clock ?? Date.now)()).toZonedDateTimeISO(timezone).toPlainDate();
    validateTimelineRange(startLocalDate, endLocalDate, today);
  }
  const read = await getPersistedHevyActivities(caller, startLocalDate, endLocalDate, surface, options);
  return {
    schemaVersion: RECORDED_ACTIVITY_SCHEMA_VERSION,
    adapterVersion: HEVY_WORKOUTS_ADAPTER_VERSION,
    source: RECORDED_ACTIVITY_SOURCE,
    accountId: caller.user.id,
    connectionGeneration: read.connectionGeneration,
    requestedRange: { startLocalDate, endLocalDate, timezone },
    fetchedAt: read.fetchedAt,
    completeness: read.completeness,
    coverage: {
      pagesRead: read.sync.pagesFetched,
      pageCount: read.sync.pagesFetched,
      countBefore: read.activities.length,
      countAfter: read.activities.length,
      itemCount: read.activities.length,
      duplicatesRemoved: 0,
      paginationComplete: read.completeness === "complete",
    },
    failures: read.completeness === "complete"
      ? []
      : [{
        code: read.sync.outcome === "timeout" ? "timeout" : "provider_unavailable",
        retryable: true,
        retryAfterSeconds: null,
        message: "Hevy sync did not complete; showing last synced workouts.",
      }],
    activities: read.activities,
  };
}

type SyncStateRow = Readonly<{
  read_cursor: string | null;
  last_reconciled_at: string | null;
  last_synced_at: string | null;
  last_attempted_at: string | null;
  last_user_activity_at: string | null;
  backfilled_at: string | null;
  paused_for_inactivity: boolean;
  sync_priority: number;
  consecutive_failures: number;
}>;

async function readSyncState(
  client: AppSupabaseClient,
  userId: string,
  source: RecordedActivitySourceV1_1,
): Promise<SyncStateRow | null> {
  const { data, error } = await client
    .from("connector_completion_state")
    .select("read_cursor,last_reconciled_at,last_synced_at,last_attempted_at,last_user_activity_at,backfilled_at,paused_for_inactivity,sync_priority,consecutive_failures")
    .eq("user_id", userId)
    .eq("source", source)
    .maybeSingle();
  if (error || !data) return null;
  return data as SyncStateRow;
}

type SyncStatePatch = Readonly<{
  read_cursor?: string | null;
  last_synced_at?: string | null;
  last_attempted_at?: string | null;
  last_user_activity_at?: string | null;
  backfilled_at?: string | null;
  paused_for_inactivity?: boolean;
  sync_priority?: number;
  consecutive_failures?: number;
  next_check_at?: string | null;
}>;

async function upsertSyncState(
  client: AppSupabaseClient,
  userId: string,
  source: RecordedActivitySourceV1_1,
  patch: SyncStatePatch,
): Promise<void> {
  const existing = await readSyncState(client, userId, source);
  if (existing) {
    await client
      .from("connector_completion_state")
      .update(patch)
      .eq("user_id", userId)
      .eq("source", source);
  } else {
    await client
      .from("connector_completion_state")
      .insert({ user_id: userId, source, ...patch });
  }
}

async function touchUserActivityAndRearm(
  client: AppSupabaseClient,
  userId: string,
  source: RecordedActivitySourceV1_1,
  now: Temporal.Instant,
  timezone: string,
  isLinked: boolean,
  stateRow: SyncStateRow | null,
): Promise<void> {
  const nowIso = now.toString();
  const shouldRearm = !isLinked && Boolean(stateRow?.paused_for_inactivity || isUnlinkedAccountInactive(now, stateRow?.last_user_activity_at ?? null));
  const nextSchedule = shouldRearm
    ? resolveUnlinkedDailySyncSchedule({
      now,
      timezone,
      consecutiveFailures: 0,
      lastAttemptAt: stateRow?.last_attempted_at ?? null,
      lastUserActivityAt: nowIso,
      reconnectRequired: false,
    })
    : null;
  await upsertSyncState(client, userId, source, {
    last_user_activity_at: nowIso,
    paused_for_inactivity: false,
    sync_priority: isLinked ? 1 : 2,
    ...(nextSchedule ? { next_check_at: nextSchedule.nextCheckAt } : {}),
  }).catch(() => undefined);
}

async function recordSyncFailure(
  client: AppSupabaseClient,
  userId: string,
  source: RecordedActivitySourceV1_1,
  nowMs: number,
  previousFailures: number,
): Promise<void> {
  const nowIso = Temporal.Instant.fromEpochMilliseconds(nowMs).toString();
  await upsertSyncState(client, userId, source, {
    last_attempted_at: nowIso,
    consecutive_failures: Math.min(1000, previousFailures + 1),
  });
}

async function readProfileTimezone(caller: ConnectorCaller, signal?: AbortSignal): Promise<string> {
  const query = caller.client.from("profiles").select("timezone").eq("id", caller.user.id);
  const { data, error } = await (signal && query.abortSignal ? query.abortSignal(signal) : query).single();
  if (error || !data || typeof data.timezone !== "string") return DEFAULT_TIMEZONE;
  return data.timezone;
}

function validateTimelineRange(start: string, end: string, today: Temporal.PlainDate): void {
  validateLedgerReadRange(start, end, today);
  const first = Temporal.PlainDate.from(start);
  if (Temporal.PlainDate.compare(first, today.subtract({ days: 30 })) < 0) {
    throw new ConnectorError("invalid_request");
  }
}

function validateLedgerReadRange(start: string, end: string, today: Temporal.PlainDate): void {
  let first: Temporal.PlainDate;
  let last: Temporal.PlainDate;
  try {
    first = Temporal.PlainDate.from(start);
    last = Temporal.PlainDate.from(end);
  } catch {
    throw new ConnectorError("invalid_request");
  }
  if (
    first.toString() !== start ||
    last.toString() !== end ||
    Temporal.PlainDate.compare(first, last) > 0 ||
    Temporal.PlainDate.compare(last, today) > 0
  ) {
    throw new ConnectorError("invalid_request");
  }
}

function mapSyncError(error: unknown): ConnectorError {
  if (error instanceof ConnectorError) return error;
  if (error instanceof HevyProviderError) return new ConnectorError(error.failure.code);
  return new ConnectorError("provider_unavailable");
}
