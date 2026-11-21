/**
 * Shared Cadence domain schemas for integration inputs and outputs.
 *
 * Conventions: snake_case fields; entity ids are UUIDs; calendar days are
 * `local_date` values in the account timezone; instants are UTC. Editable
 * records carry an opaque `revision`. Needs decision is derived and never
 * stored. Account identity appears only as a per-client pairwise id.
 */
import { NOT_DONE_REASONS } from "../resolvers/status.resolver";
import { WEEKDAYS } from "../types/recurrence";
import { INTEGRATION_LIMITS, INTEGRATION_REMINDER_OFFSETS } from "./limits";
import {
  array,
  boolean,
  enumOf,
  integer,
  integerEnum,
  literal,
  nullable,
  number,
  object,
  oneOf,
  optional,
  string,
  type Infer,
} from "./schema";

const L = INTEGRATION_LIMITS;

// Text patterns. Single-line text forbids control characters; multi-line
// text allows tab and newline only. Required text must contain a non-space.
const SINGLE_LINE = "^[^\\u0000-\\u001f\\u007f]*$";
const SINGLE_LINE_NON_BLANK = "^(?=.*\\S)[^\\u0000-\\u001f\\u007f]*$";
const MULTI_LINE = "^[^\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f]*$";

export const OCCURRENCE_STATUSES = ["unresolved", "completed", "not_completed"] as const;
export type IntegrationOccurrenceStatus = (typeof OCCURRENCE_STATUSES)[number];

export const OCCURRENCE_STATUS_LABELS = Object.freeze({
  unresolved: "Unresolved",
  completed: "Completed",
  not_completed: "Not Completed",
} as const satisfies Record<IntegrationOccurrenceStatus, string>);

export const STATUS_LABEL_VALUES = ["Unresolved", "Completed", "Not Completed"] as const;
export const BEHAVIOR_STATES = ["active", "archived"] as const;
/** Whether a Behavior schedules Occurrences right now. Archive wins; an end that has passed wins over a pause. */
export const BEHAVIOR_RUN_STATES = ["running", "ended", "paused", "archived"] as const;
export const SCHEDULE_KINDS = ["exact", "range"] as const;
export const TIME_RANGE_PRESET_NAMES = ["morning", "afternoon", "evening", "night"] as const;
/** Where an Occurrence came from (contract 1.6.0): a schedule, or an opportunity Behavior added to a day. */
export const OCCURRENCE_ORIGINS = ["scheduled", "opportunity"] as const;
/** Who added an opportunity Occurrence: the person, the Daily Brief, Cadence's chat, or an outside client. */
export const OPPORTUNITY_ADDED_BY_VALUES = ["user", "daily_brief", "chat", "mcp"] as const;
export const STATUS_SEMANTICS = [
  "explicit_user_mark",
  "explicit_user_correction",
  "imported_explicit",
  "system_rule_declared",
  "ambiguous_import",
] as const;
export const CAPTURE_METHODS = [
  "manual_tap",
  "manual_text",
  "system_generated",
  "imported",
  "inferred",
  "derived",
  "ai_generated",
  "unknown",
] as const;

export const ADHERENCE_DEFINITION =
  "Adherence is Completed divided by Completed plus Not Completed. Unresolved Occurrences, including Needs decision, are excluded. It is null when nothing is resolved.";

// ---------------------------------------------------------------- primitives

export const uuid = (description?: string) => string({ format: "uuid", description });

export const localDate = (description = "Calendar date (YYYY-MM-DD) in the account timezone.") =>
  string({ format: "date", description, examples: ["2026-10-18"] });

/** UTC instant in outputs, always ending in `Z`. */
export const utcInstant = (description?: string) =>
  string({ format: "date-time", pattern: "[Zz]$", description });

/** RFC 3339 instant in inputs; any offset is accepted. */
export const inputInstant = (description?: string) => string({ format: "date-time", description });

export const timezone = () =>
  string({
    minLength: 1,
    maxLength: 64,
    pattern: "^[A-Za-z0-9_+\\-/]+$",
    description: "IANA timezone name.",
    examples: ["America/New_York"],
  });

export const localTime = (description = "Local wall-clock time, 24-hour HH:MM.") =>
  string({ pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$", description, examples: ["07:30"] });

export const revision = (description = "Opaque version token of this record. Send it back as `expected_revision` to avoid overwriting a newer change.") =>
  string({ minLength: 1, maxLength: L.maxRevisionLength, pattern: "^[A-Za-z0-9._:-]+$", description });

export const cursor = () =>
  string({
    minLength: 1,
    maxLength: L.maxCursorLength,
    pattern: "^[A-Za-z0-9_-]+$",
    description: "Opaque `next_cursor` from the previous page.",
  });

export const nextCursor = () =>
  nullable(cursor(), { description: "Cursor for the next page, or null when this is the last page." });

export const pageSize = () =>
  integer({ minimum: 1, maximum: L.maxPageSize, default: L.defaultPageSize, description: "Items per page." });

export const updatedSince = () =>
  inputInstant("Return only records changed at or after this instant. Use it for incremental reads.");

export const idempotencyKey = () =>
  string({
    minLength: L.minIdempotencyKeyLength,
    maxLength: L.maxIdempotencyKeyLength,
    pattern: "^[A-Za-z0-9._:-]+$",
    description: `Optional client-chosen key. Repeating a call with the same key and input within ${L.idempotencyWindowSeconds / 3600} hours returns the first result and changes nothing.`,
  });

export const externalRef = (description: string) =>
  string({ minLength: 1, maxLength: L.maxExternalRefLength, pattern: "^[\\x21-\\x7e]+$", description });

export const httpsUrl = (description: string) =>
  string({ format: "uri", pattern: "^https://", maxLength: 2048, description });

export const occurrenceStatus = (description?: string) => enumOf(OCCURRENCE_STATUSES, { description });

// ---------------------------------------------------------------- recurrence

function recurrence(maxInterval: number | undefined) {
  const interval = (description: string) => integer({ minimum: 1, maximum: maxInterval, description });
  return oneOf([
    object({
      frequency: literal("daily"),
      interval: interval("Repeat every N days. 1 means every day."),
    }, { title: "Daily" }),
    object({
      frequency: literal("interval_days"),
      interval_days: interval("Repeat every N days counted from the start date."),
    }, { title: "Every N days" }),
    object({
      frequency: literal("weekly"),
      interval: interval("Repeat every N weeks. 1 means every week."),
      days_of_week: array(enumOf(WEEKDAYS), { minItems: 1, maxItems: 7, uniqueItems: true }),
    }, { title: "Weekly on selected weekdays" }),
    object({
      frequency: literal("monthly"),
      interval: interval("Repeat every N months."),
      day_of_month: integer({
        minimum: 1,
        maximum: 31,
        description: "Day of the month. In months without this day, the last day of the month is used.",
      }),
    }, { title: "Monthly on day N" }),
  ], { description: "Structured recurrence rule. Natural-language rules and cron syntax are not accepted." });
}

export const recurrenceInput = recurrence(L.maxRecurrenceInterval);
export const recurrenceOutput = recurrence(undefined);

// -------------------------------------------------------------- time entries

const timeEntryId = () => optional(uuid("Existing time entry id. Omit for a new entry."));

export const timeEntryInput = oneOf([
  object({
    id: timeEntryId(),
    kind: literal("exact"),
    start_time: localTime("Exact time of day."),
  }, { title: "Exact time" }),
  object({
    id: timeEntryId(),
    kind: literal("range"),
    preset: enumOf(TIME_RANGE_PRESET_NAMES, {
      description: "Morning 06:00-12:00, Afternoon 12:00-18:00, Evening 18:00-00:00, Night 00:00-06:00.",
    }),
  }, { title: "Preset time range" }),
  object({
    id: timeEntryId(),
    kind: literal("range"),
    start_time: localTime("Range start."),
    end_time: localTime("Range end. A range may end after midnight, for example 22:00-01:00."),
  }, { title: "Custom time range" }),
]);

export const timeEntryOutput = object({
  id: uuid(),
  kind: enumOf(SCHEDULE_KINDS),
  preset: nullable(enumOf(TIME_RANGE_PRESET_NAMES)),
  start_time: localTime(),
  end_time: nullable(localTime()),
  label: string({ description: "Display label, for example `7:30 AM` or `Morning`." }),
});

export const scheduleInput = object({
  id: optional(uuid("Existing schedule id. Omit for a new schedule.")),
  recurrence: recurrenceInput,
  time_entries: array(timeEntryInput, { minItems: 1, maxItems: L.maxTimeEntriesPerSchedule }),
});

export const schedulesInput = array(scheduleInput, {
  maxItems: L.maxSchedulesPerBehavior,
  description: "Complete list of schedules. Each schedule has one recurrence rule and one or more time entries. It may be empty only for a Behavior available as an opportunity.",
});

export const scheduleOutput = object({
  id: uuid(),
  recurrence: recurrenceOutput,
  recurrence_summary: string({ description: "Plain-language recurrence, for example `Weekly on Monday and Thursday`." }),
  time_entries: array(timeEntryOutput),
  time_summary: string(),
});

// ----------------------------------------------------------------- reminders

export const remindersInput = object({
  browser_enabled: optional(boolean({ description: "Browser reminders. On by default." })),
  email_enabled: optional(boolean({ description: "Email reminders. Off by default." })),
  offset_minutes: optional(integerEnum(INTEGRATION_REMINDER_OFFSETS, {
    description: "Minutes before the scheduled time: 0, 15, 60, 1440 (1 day), or 4320 (3 days). Default 0.",
  })),
}, { description: "Per-Behavior reminder settings. Omitted fields keep their current or default value." });

export const remindersOutput = object({
  browser_enabled: boolean(),
  email_enabled: boolean(),
  offset_minutes: integer({ minimum: 0 }),
  summary: string(),
});

// ---------------------------------------------------------- user-entered text

export const behaviorTitleInput = () =>
  string({ minLength: 1, maxLength: L.maxBehaviorTitleLength, pattern: SINGLE_LINE_NON_BLANK, description: "Behavior name." });

export const behaviorDescriptionInput = () =>
  string({ maxLength: L.maxBehaviorDescriptionLength, pattern: MULTI_LINE, description: "Optional description." });

export const locationTextInput = () =>
  string({ maxLength: L.maxLocationTextLength, pattern: SINGLE_LINE, description: "Optional place where the Behavior happens, as plain text." });

export const occurrenceNoteInput = () =>
  string({ maxLength: L.maxOccurrenceNoteLength, pattern: MULTI_LINE, description: "Note text. An empty string clears the note." });

export const dayNoteInput = () =>
  string({ maxLength: L.maxDayNoteLength, pattern: MULTI_LINE, description: "Day note text. An empty string clears the day note." });

export const archiveNoteInput = () =>
  string({ maxLength: L.maxArchiveNoteLength, pattern: MULTI_LINE, description: "Optional reason or context for archiving." });

export const defaultDurationInput = () =>
  integer({ minimum: 1, maximum: L.maxDefaultDurationMinutes, description: "Planned duration in minutes for Timeline planning." });

// ------------------------------------------------------------------ outputs

export const categoryRef = object({ id: uuid(), name: string() });

export const categoryOutput = object({
  id: uuid(),
  name: string(),
  description: nullable(string()),
  sort_order: integer(),
  created_at: utcInstant(),
  updated_at: utcInstant(),
});

export const archiveNoteOutput = object({
  id: uuid(),
  archived_at: utcInstant(),
  note: nullable(string()),
  updated_at: utcInstant(),
});

export const behaviorPauseOutput = object({
  from_on: localDate("First paused local day."),
  from_time: nullable(localTime("Local time on from_on when the pause starts. Null means the start of that day.")),
  back_on: localDate("Local day the Behavior runs again by itself, from the start of the day."),
}, { description: "A pause: no Occurrences from from_on (at from_time) until the start of back_on." });

export const behaviorOutput = object({
  id: uuid(),
  title: string(),
  description: nullable(string()),
  location_text: nullable(string()),
  category: nullable(categoryRef),
  state: enumOf(BEHAVIOR_STATES, { description: "Archived Behaviors keep their history but schedule no new Occurrences." }),
  archived_at: nullable(utcInstant()),
  auto_archived_at: nullable(utcInstant(), { description: "Set on Behaviors that an end date archived automatically before Cadence stopped archiving on an end. New ends never set it." }),
  run_state: enumOf(BEHAVIOR_RUN_STATES, { description: "running schedules Occurrences; ended has passed its end and paused is inside a pause, both still active and shown under Not running; archived is archived." }),
  is_opportunity: boolean({ description: "True when the Behavior is available as an opportunity: the person can add it to today when there is room, with or without a schedule (contract 1.6.0)." }),
  end_on: nullable(localDate("Last local day the Behavior runs. Null when it has no end.")),
  end_time: nullable(localTime("Local time on end_on when it stops. Null means it stops at the end of that day.")),
  pause: nullable(behaviorPauseOutput, { description: "The current or upcoming pause. Null when none is set or the pause is over." }),
  end_date: nullable(localDate("Deprecated: read end_on. The day after end_on, kept for one minor version.")),
  default_duration_minutes: nullable(integer({ minimum: 1 })),
  timezone: timezone(),
  schedules: array(scheduleOutput),
  schedule_summary: string(),
  reminders: remindersOutput,
  archive_notes: array(archiveNoteOutput),
  external_ref: nullable(string(), { description: "This client's external record id, when it set one at creation." }),
  created_at: utcInstant(),
  updated_at: utcInstant(),
  revision: revision(),
}, { description: "A Behavior: a recurring thing the user tracks (a habit, routine, or recurring task)." });

export const occurrenceScheduleOutput = object({
  kind: enumOf(SCHEDULE_KINDS),
  preset: nullable(enumOf(TIME_RANGE_PRESET_NAMES)),
  start_time: localTime(),
  end_time: nullable(localTime()),
  label: string(),
});

/**
 * Why a move or Undo was refused. Kept equal to `MOVE_REFUSAL_REASONS` in
 * `resolvers/move.resolver.ts` (tests/move.resolver.test.ts checks it).
 */
export const MOVE_REFUSAL_REASON_VALUES = [
  "occurrence_resolved", "not_today", "revision_changed", "range_behavior", "start_not_on_day", "time_passed",
  "no_change", "nothing_to_undo", "not_latest_move", "slot_taken", "calendar_busy",
] as const;

/** Why an opportunity add was refused (contract 1.6.0). */
export const OPPORTUNITY_ADD_REFUSAL_VALUES = [
  "not_available", "not_running", "not_today", "invalid_time", "slot_taken", "calendar_busy",
] as const;
/** Why an opportunity Remove was refused (contract 1.6.0). */
export const OPPORTUNITY_REMOVE_REFUSAL_VALUES = ["scheduled", "marked", "kept", "revision_changed"] as const;

export const MOVE_SOURCE_VALUES = ["daily_brief", "coach", "chat", "mcp", "person"] as const;

/** One record of an Occurrence's per-day move history (a move or an Undo). */
export const occurrenceMoveRecordOutput = object({
  id: uuid(),
  kind: enumOf(["move", "revert"] as const, { description: "`revert` is an Undo of the latest move." }),
  from_start_at: utcInstant("Start before this record."),
  to_start_at: utcInstant("Start after this record."),
  to_end_at: utcInstant("End after this record."),
  to_planned: boolean({ description: "True when this record put the Occurrence back at its planned time." }),
  chain_position: integer({ minimum: 1, description: "1 for the day's first move or Undo, then 2, 3, and so on." }),
  source: enumOf(MOVE_SOURCE_VALUES, { description: "Who made it: the person, Cadence's advisor, or an outside client." }),
  created_at: utcInstant(),
});

/** A per-day move as an Occurrence shows it (contract 1.3.0). */
export const occurrenceMoveSummary = object({
  planned_start_at: utcInstant("The planned start. It does not change when the item moves."),
  start_at: utcInstant("The moved start."),
  end_at: utcInstant("The moved end. A move keeps the item's length."),
});

export const occurrenceShape = {
  id: uuid(),
  behavior_id: uuid(),
  behavior_title: string(),
  category_name: nullable(string()),
  local_date: localDate(),
  timezone: timezone(),
  scheduled_for: utcInstant("Planned start as a UTC instant. It never changes when the Occurrence is moved for the day."),
  effective_start_at: utcInstant("Where the Occurrence sits today: its moved start when `move` is set, otherwise the planned start. Show, remind and match by this time."),
  move: nullable(occurrenceMoveSummary, { description: "Set while a per-day move places the Occurrence away from its planned time. Null otherwise." }),
  schedule: occurrenceScheduleOutput,
  status: occurrenceStatus("Stored status."),
  status_label: enumOf(STATUS_LABEL_VALUES),
  needs_decision: boolean({ description: "Derived: true when the status is unresolved and local_date is before today. Never stored." }),
  origin: enumOf(OCCURRENCE_ORIGINS, { description: "scheduled comes from the Behavior's schedule; opportunity was added to its day from the person's opportunities (contract 1.6.0)." }),
  added_by: nullable(enumOf(OPPORTUNITY_ADDED_BY_VALUES), { description: "Who added an opportunity Occurrence: user, daily_brief, chat or mcp. Null for scheduled Occurrences." }),
  completed_at: nullable(utcInstant()),
  status_marked_at: nullable(utcInstant()),
  note: nullable(string()),
  updated_at: utcInstant(),
  revision: revision(),
} as const;

export const occurrenceOutput = object(occurrenceShape, {
  description: "An Occurrence: one scheduled instance of a Behavior on one local date.",
});

export const statusHistoryEntry = object({
  id: uuid(),
  previous_status: nullable(occurrenceStatus()),
  status: occurrenceStatus(),
  semantics: enumOf(STATUS_SEMANTICS),
  capture_method: enumOf(CAPTURE_METHODS),
  recorded_at: utcInstant(),
  effective_at: nullable(utcInstant(), { description: "When it really happened. For Completed it can be earlier than recorded_at when the person said when they did it (contract 1.4.0)." }),
  not_done_reason: nullable(enumOf(NOT_DONE_REASONS), { description: "The optional one-tap reason the person gave on a Not Completed mark. Null otherwise (contract 1.4.0)." }),
  local_date: localDate(),
  timezone: timezone(),
});

export const timeSessionOutput = object({
  id: uuid(),
  started_at: utcInstant(),
  stopped_at: nullable(utcInstant(), { description: "Null while the session is running." }),
  duration_seconds: nullable(integer({ minimum: 0 }), { description: "Null while the session is running." }),
});

export const occurrenceDetailOutput = object({
  ...occurrenceShape,
  status_history: array(statusHistoryEntry, { description: "Append-only status changes, oldest first." }),
  time_sessions: array(timeSessionOutput),
}, { description: "One Occurrence with its note, status history, and measured time sessions." });

export const freshnessOutput = object({
  as_of: utcInstant("When Cadence read this data."),
  occurrences_generated_through: nullable(localDate("Last local date for which Occurrences exist. Later dates have none yet.")),
});

export const adherenceCounts = {
  completed: integer({ minimum: 0 }),
  not_completed: integer({ minimum: 0 }),
  unresolved: integer({ minimum: 0, description: "Includes Needs decision. Excluded from adherence." }),
  needs_decision: integer({ minimum: 0, description: "Unresolved Occurrences before today." }),
  adherence_rate: nullable(number({ minimum: 0, maximum: 1 }), { description: ADHERENCE_DEFINITION }),
  opportunity_completed_count: integer({ minimum: 0, description: "Completed opportunity Occurrences, the ones added to a day. Counted apart: the other counts and adherence_rate cover scheduled Occurrences only (contract 1.6.0)." }),
} as const;

export type BehaviorOutput = Infer<typeof behaviorOutput>;
export type OccurrenceOutput = Infer<typeof occurrenceOutput>;
export type OccurrenceDetailOutput = Infer<typeof occurrenceDetailOutput>;
export type CategoryOutput = Infer<typeof categoryOutput>;
export type RecurrenceInput = Infer<typeof recurrenceInput>;
export type TimeEntryInput = Infer<typeof timeEntryInput>;
export type ScheduleInput = Infer<typeof scheduleInput>;
