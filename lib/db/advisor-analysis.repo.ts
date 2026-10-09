import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";

/** Row limits enforced by `read_advisor_analysis_snapshot`; one extra row signals a cap. */
export const ADVISOR_ANALYSIS_LIMITS = Object.freeze({
  occurrences: 10_000,
  statusEvents: 20_000,
  configurationEvents: 2_000,
  reminders: 10_000,
  notes: 200,
});

export type AdvisorAnalysisOptional<T> = "not_requested" | "not_permitted" | readonly T[];

export type AdvisorAnalysisSnapshot = Readonly<{
  timezone: string;
  observedAt: string;
  revision: string;
  occurrences: readonly Readonly<{
    id: string; behaviorId: string; localDate: string; scheduledFor: string;
    scheduleKind: string; scheduleStartTime: string; scheduleEndTime: string | null;
    status: string; statusMarkedAt: string | null; configurationEventId: string | null;
  }>[];
  statusEvents: readonly Readonly<{
    id: string; occurrenceId: string; previousStatus: string | null; status: string;
    semantics: string; recordedAt: string; revisesEventId: string | null;
  }>[];
  configurationEvents: readonly Readonly<{
    id: string; behaviorId: string; eventKind: string; effectiveAt: string; effectiveLocalDate: string;
    changedFields: readonly string[]; source: string; reasonCode: string;
    browserReminderEnabled: boolean; emailReminderEnabled: boolean;
  }>[];
  reminders: AdvisorAnalysisOptional<Readonly<{ occurrenceId: string; channel: string; status: string; scheduledSendAt: string }>>;
  notes: AdvisorAnalysisOptional<Readonly<{ occurrenceId: string; behaviorId: string; localDate: string; text: string }>>;
}>;

type AnalysisRequest = Readonly<{
  localDate: string;
  historyStartLocalDate: string;
  behaviorIds: string[];
  includeReminders: boolean;
  includeNotes: boolean;
  signal?: AbortSignal;
}>;

/** Owner-scoped, read-only analysis records. The database enforces optional-source disclosure. */
export async function readAdvisorAnalysisSnapshot(client: AppSupabaseClient, input: AnalysisRequest): Promise<AdvisorAnalysisSnapshot> {
  const request = client.rpc("read_advisor_analysis_snapshot", args(input, false));
  const { data, error } = await (input.signal ? request.abortSignal(input.signal) : request);
  if (error) throw error;
  return parseSnapshot(data);
}

export async function readAdvisorAnalysisRevision(client: AppSupabaseClient, input: AnalysisRequest): Promise<string> {
  const request = client.rpc("read_advisor_analysis_snapshot", args(input, true));
  const { data, error } = await (input.signal ? request.abortSignal(input.signal) : request);
  if (error) throw error;
  return string(record(data, "revision").revision, "revision");
}

function args(input: AnalysisRequest, revisionOnly: boolean) {
  return {
    target_local_date: input.localDate,
    history_start_local_date: input.historyStartLocalDate,
    selected_behavior_ids: input.behaviorIds,
    include_reminders: input.includeReminders,
    include_notes: input.includeNotes,
    revision_only: revisionOnly,
  };
}

function parseSnapshot(value: unknown): AdvisorAnalysisSnapshot {
  const row = record(value, "analysis");
  return {
    timezone: string(row.timezone, "timezone"),
    observedAt: string(row.observedAt, "observedAt"),
    revision: string(row.revision, "revision"),
    occurrences: list(row.occurrences, "occurrences").map((item) => {
      const occurrence = record(item, "occurrence");
      return {
        id: string(occurrence.id, "occurrence.id"),
        behaviorId: string(occurrence.behaviorId, "occurrence.behaviorId"),
        localDate: string(occurrence.localDate, "occurrence.localDate"),
        scheduledFor: string(occurrence.scheduledFor, "occurrence.scheduledFor"),
        scheduleKind: string(occurrence.scheduleKind, "occurrence.scheduleKind"),
        scheduleStartTime: string(occurrence.scheduleStartTime, "occurrence.scheduleStartTime"),
        scheduleEndTime: nullableString(occurrence.scheduleEndTime, "occurrence.scheduleEndTime"),
        status: string(occurrence.status, "occurrence.status"),
        statusMarkedAt: nullableString(occurrence.statusMarkedAt, "occurrence.statusMarkedAt"),
        configurationEventId: nullableString(occurrence.configurationEventId, "occurrence.configurationEventId"),
      };
    }),
    statusEvents: list(row.statusEvents, "statusEvents").map((item) => {
      const event = record(item, "statusEvent");
      return {
        id: string(event.id, "statusEvent.id"),
        occurrenceId: string(event.occurrenceId, "statusEvent.occurrenceId"),
        previousStatus: nullableString(event.previousStatus, "statusEvent.previousStatus"),
        status: string(event.status, "statusEvent.status"),
        semantics: string(event.semantics, "statusEvent.semantics"),
        recordedAt: string(event.recordedAt, "statusEvent.recordedAt"),
        revisesEventId: nullableString(event.revisesEventId, "statusEvent.revisesEventId"),
      };
    }),
    configurationEvents: list(row.configurationEvents, "configurationEvents").map((item) => {
      const event = record(item, "configurationEvent");
      return {
        id: string(event.id, "configurationEvent.id"),
        behaviorId: string(event.behaviorId, "configurationEvent.behaviorId"),
        eventKind: string(event.eventKind, "configurationEvent.eventKind"),
        effectiveAt: string(event.effectiveAt, "configurationEvent.effectiveAt"),
        effectiveLocalDate: string(event.effectiveLocalDate, "configurationEvent.effectiveLocalDate"),
        changedFields: list(event.changedFields, "configurationEvent.changedFields").map((field) => string(field, "configurationEvent.changedField")),
        source: string(event.source, "configurationEvent.source"),
        reasonCode: string(event.reasonCode, "configurationEvent.reasonCode"),
        browserReminderEnabled: boolean(event.browserReminderEnabled, "configurationEvent.browserReminderEnabled"),
        emailReminderEnabled: boolean(event.emailReminderEnabled, "configurationEvent.emailReminderEnabled"),
      };
    }),
    reminders: optional(row.reminders, "reminders", (item) => {
      const delivery = record(item, "reminder");
      return {
        occurrenceId: string(delivery.occurrenceId, "reminder.occurrenceId"),
        channel: string(delivery.channel, "reminder.channel"),
        status: string(delivery.status, "reminder.status"),
        scheduledSendAt: string(delivery.scheduledSendAt, "reminder.scheduledSendAt"),
      };
    }),
    notes: optional(row.notes, "notes", (item) => {
      const note = record(item, "note");
      return {
        occurrenceId: string(note.occurrenceId, "note.occurrenceId"),
        behaviorId: string(note.behaviorId, "note.behaviorId"),
        localDate: string(note.localDate, "note.localDate"),
        text: string(note.text, "note.text"),
      };
    }),
  };
}

function optional<T>(value: unknown, label: string, parse: (item: unknown) => T): AdvisorAnalysisOptional<T> {
  if (value === "not_requested" || value === "not_permitted") return value;
  return list(value, label).map(parse);
}
function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`Invalid advisor ${label}.`);
  return value as Record<string, unknown>;
}
function list(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`Invalid advisor ${label}.`);
  return value;
}
function string(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new TypeError(`Invalid advisor ${label}.`);
  return value;
}
function nullableString(value: unknown, label: string): string | null {
  return value === null ? null : string(value, label);
}
function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new TypeError(`Invalid advisor ${label}.`);
  return value;
}
