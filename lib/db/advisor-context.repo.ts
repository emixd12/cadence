import {
  ADVISOR_DAY_CONTEXT_LIMITS,
} from "@cadence/core/types/advisor-day-context";
import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";

export type AdvisorCadenceSnapshot = Readonly<{
  timezone: string;
  profileUpdatedAt: string;
  observedAt: string;
  revision: string;
  behaviors: AdvisorBehaviorRow[];
  occurrences: AdvisorOccurrenceRow[];
  historyOccurrences: AdvisorHistoryOccurrenceRow[];
  historySessions: AdvisorHistorySessionRow[];
  syncState: AdvisorSyncStateRow | null;
  staleConfigurationCount: number;
  /** Phase 3A1: today's answered brief lines and open schedule-edit notices. Absent before that migration. */
  moveAnswers?: readonly Readonly<{ occurrenceId: string; kind: string }>[];
  moveConflicts?: readonly Readonly<{ occurrenceId: string; conflictingOccurrenceId: string | null }>[];
}>;

export type AdvisorBehaviorRow = Readonly<{
  id: string;
  title: string;
  defaultDurationMinutes: number | null;
  currentConfigurationEventId: string | null;
  updatedAt: string;
  /** End and pause (docs/RECURRENCE_RULES.md, "Behavior end and pause"); times are HH:MM:SS. */
  endOn: string | null;
  endTime: string | null;
  pauseFromOn: string | null;
  pauseFromTime: string | null;
  pauseBackOn: string | null;
  timezone: string;
}>;

export type AdvisorOccurrenceRow = Readonly<{
  id: string;
  behaviorId: string;
  behaviorConfigurationEventId: string | null;
  scheduledFor: string;
  localDate: string;
  scheduleKind: string;
  scheduleStartTime: string;
  scheduleEndTime: string | null;
  status: string;
  updatedAt: string;
  /** Phase 3A1: the time the item sits at when moved for today, and who moved it. Absent before that migration. */
  effectiveStartAt?: string | null;
  effectiveEndAt?: string | null;
  movedBy?: string | null;
}>;

export type AdvisorHistoryOccurrenceRow = Readonly<{
  /** Absent until the snapshot migration is deployed. Never substitute updatedAt. */
  statusMarkedAt?: string | null;
  id: string;
  behaviorId: string;
  localDate: string;
  status: string;
}>;

export type AdvisorHistorySessionRow = Readonly<{
  id: string;
  occurrenceId: string;
  behaviorId: string;
  startedAt: string;
  stoppedAt: string | null;
}>;

export type AdvisorSyncStateRow = Readonly<{
  timezone: string;
  last_synced_local_date: string | null;
  synced_through_local_date: string | null;
  last_successful_sync_at: string | null;
  stale: boolean;
  stale_reason: string | null;
  state_version: number;
  updated_at: string;
}>;

export async function readAdvisorCadenceSnapshot(
  client: AppSupabaseClient,
  input: Readonly<{
    localDate: string;
    historyStartLocalDate: string;
    behaviorIds: string[];
    signal?: AbortSignal;
  }>,
): Promise<AdvisorCadenceSnapshot> {
  const request = client.rpc("read_advisor_cadence_snapshot", args(input));
  const { data, error } = await (input.signal ? request.abortSignal(input.signal) : request);
  if (error) throw error;
  return parseSnapshot(data);
}

export async function readAdvisorProfileTimezone(
  client: AppSupabaseClient,
  userId: string,
): Promise<string> {
  const { data, error } = await client
    .from("profiles")
    .select("timezone")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.timezone) throw new TypeError("Advisor profile is unavailable.");
  return data.timezone;
}

export async function readAdvisorCadenceRevision(
  client: AppSupabaseClient,
  input: Readonly<{
    localDate: string;
    historyStartLocalDate: string;
    behaviorIds: string[];
    signal?: AbortSignal;
  }>,
): Promise<string> {
  const request = client.rpc("read_advisor_cadence_revision", args(input));
  const { data, error } = await (input.signal ? request.abortSignal(input.signal) : request);
  if (error) throw error;
  return string(data, "revision");
}


function args(input: Readonly<{ localDate: string; historyStartLocalDate: string; behaviorIds: string[] }>) {
  return {
    target_local_date: input.localDate,
    history_start_local_date: input.historyStartLocalDate,
    selected_behavior_ids: input.behaviorIds,
    history_occurrence_limit: ADVISOR_DAY_CONTEXT_LIMITS.historyOccurrences,
    history_session_limit: ADVISOR_DAY_CONTEXT_LIMITS.historySessions,
  };
}

function parseSnapshot(value: unknown): AdvisorCadenceSnapshot {
  const row = record(value, "snapshot");
  return {
    timezone: string(row.timezone, "timezone"),
    profileUpdatedAt: string(row.profileUpdatedAt, "profileUpdatedAt"),
    observedAt: string(row.observedAt, "observedAt"),
    revision: string(row.revision, "revision"),
    behaviors: list(row.behaviors, "behaviors").map((item) => {
      const behavior = record(item, "behavior");
      return {
        id: string(behavior.id, "behavior.id"),
        title: text(behavior.title, "behavior.title"),
        defaultDurationMinutes: nullableInteger(behavior.defaultDurationMinutes, "behavior.defaultDurationMinutes"),
        currentConfigurationEventId: nullableString(behavior.currentConfigurationEventId, "behavior.currentConfigurationEventId"),
        updatedAt: string(behavior.updatedAt, "behavior.updatedAt"),
        endOn: nullableString(behavior.endOn, "behavior.endOn"),
        endTime: nullableString(behavior.endTime, "behavior.endTime"),
        pauseFromOn: nullableString(behavior.pauseFromOn, "behavior.pauseFromOn"),
        pauseFromTime: nullableString(behavior.pauseFromTime, "behavior.pauseFromTime"),
        pauseBackOn: nullableString(behavior.pauseBackOn, "behavior.pauseBackOn"),
        timezone: string(behavior.timezone, "behavior.timezone"),
      };
    }),
    occurrences: list(row.occurrences, "occurrences").map((item) => {
      const occurrence = record(item, "occurrence");
      return {
        id: string(occurrence.id, "occurrence.id"),
        behaviorId: string(occurrence.behaviorId, "occurrence.behaviorId"),
        behaviorConfigurationEventId: nullableString(occurrence.behaviorConfigurationEventId, "occurrence.behaviorConfigurationEventId"),
        scheduledFor: string(occurrence.scheduledFor, "occurrence.scheduledFor"),
        localDate: string(occurrence.localDate, "occurrence.localDate"),
        scheduleKind: string(occurrence.scheduleKind, "occurrence.scheduleKind"),
        scheduleStartTime: string(occurrence.scheduleStartTime, "occurrence.scheduleStartTime"),
        scheduleEndTime: nullableString(occurrence.scheduleEndTime, "occurrence.scheduleEndTime"),
        status: string(occurrence.status, "occurrence.status"),
        updatedAt: string(occurrence.updatedAt, "occurrence.updatedAt"),
        ...("effectiveStartAt" in occurrence ? {
          effectiveStartAt: nullableString(occurrence.effectiveStartAt, "occurrence.effectiveStartAt"),
          effectiveEndAt: nullableString(occurrence.effectiveEndAt, "occurrence.effectiveEndAt"),
          movedBy: nullableString(occurrence.movedBy, "occurrence.movedBy"),
        } : {}),
      };
    }),
    historyOccurrences: list(row.historyOccurrences, "historyOccurrences").map((item) => {
      const occurrence = record(item, "historyOccurrence");
      return {
        id: string(occurrence.id, "historyOccurrence.id"),
        behaviorId: string(occurrence.behaviorId, "historyOccurrence.behaviorId"),
        localDate: string(occurrence.localDate, "historyOccurrence.localDate"),
        status: string(occurrence.status, "historyOccurrence.status"),
        ...("statusMarkedAt" in occurrence ? { statusMarkedAt: nullableString(occurrence.statusMarkedAt, "historyOccurrence.statusMarkedAt") } : {}),
      };
    }),
    historySessions: list(row.historySessions, "historySessions").map((item) => {
      const session = record(item, "historySession");
      return {
        id: string(session.id, "historySession.id"),
        occurrenceId: string(session.occurrenceId, "historySession.occurrenceId"),
        behaviorId: string(session.behaviorId, "historySession.behaviorId"),
        startedAt: string(session.startedAt, "historySession.startedAt"),
        stoppedAt: nullableString(session.stoppedAt, "historySession.stoppedAt"),
      };
    }),
    ...("moveAnswers" in row ? {
      moveAnswers: list(row.moveAnswers, "moveAnswers").map((item) => {
        const answer = record(item, "moveAnswer");
        return { occurrenceId: string(answer.occurrenceId, "moveAnswer.occurrenceId"), kind: string(answer.kind, "moveAnswer.kind") };
      }),
      moveConflicts: list(row.moveConflicts, "moveConflicts").map((item) => {
        const conflict = record(item, "moveConflict");
        return { occurrenceId: string(conflict.occurrenceId, "moveConflict.occurrenceId"),
          conflictingOccurrenceId: nullableString(conflict.conflictingOccurrenceId, "moveConflict.conflictingOccurrenceId") };
      }),
    } : {}),
    syncState: row.syncState === null ? null : parseSyncState(row.syncState),
    staleConfigurationCount: integer(row.staleConfigurationCount, "staleConfigurationCount"),
  };
}

function parseSyncState(value: unknown): AdvisorSyncStateRow {
  const row = record(value, "syncState");
  return {
    timezone: string(row.timezone, "syncState.timezone"),
    last_synced_local_date: nullableString(row.last_synced_local_date, "syncState.last_synced_local_date"),
    synced_through_local_date: nullableString(row.synced_through_local_date, "syncState.synced_through_local_date"),
    last_successful_sync_at: nullableString(row.last_successful_sync_at, "syncState.last_successful_sync_at"),
    stale: boolean(row.stale, "syncState.stale"),
    stale_reason: nullableString(row.stale_reason, "syncState.stale_reason"),
    state_version: integer(row.state_version, "syncState.state_version"),
    updated_at: string(row.updated_at, "syncState.updated_at"),
  };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`Invalid advisor ${label}.`);
  return value as Record<string, unknown>;
}
function list(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`Invalid advisor ${label}.`);
  return value;
}
function text(value: unknown, label: string): string {
  if (typeof value !== "string") throw new TypeError(`Invalid advisor ${label}.`);
  return value;
}
function string(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new TypeError(`Invalid advisor ${label}.`);
  return value;
}
function nullableString(value: unknown, label: string): string | null {
  return value === null ? null : string(value, label);
}
function integer(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) throw new TypeError(`Invalid advisor ${label}.`);
  return value as number;
}
function nullableInteger(value: unknown, label: string): number | null {
  return value === null ? null : integer(value, label);
}
function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new TypeError(`Invalid advisor ${label}.`);
  return value;
}
