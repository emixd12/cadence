/**
 * Cadence integration operation registry: the single source of truth for every
 * MCP tool's name, scope, description, annotations, and input and output
 * schemas. Transports, handlers, plugins, and docs read from here.
 */
import {
  OCCURRENCE_STATUSES,
  ADHERENCE_DEFINITION,
  BEHAVIOR_STATES,
  adherenceCounts,
  archiveNoteInput,
  dayNoteInput,
  behaviorDescriptionInput,
  behaviorOutput,
  behaviorTitleInput,
  categoryOutput,
  cursor,
  defaultDurationInput,
  externalRef,
  freshnessOutput,
  httpsUrl,
  idempotencyKey,
  localDate,
  localTime,
  locationTextInput,
  MOVE_REFUSAL_REASON_VALUES,
  OPPORTUNITY_ADD_REFUSAL_VALUES,
  OPPORTUNITY_REMOVE_REFUSAL_VALUES,
  TIME_RANGE_PRESET_NAMES,
  occurrenceMoveRecordOutput,
  nextCursor,
  occurrenceDetailOutput,
  occurrenceNoteInput,
  occurrenceOutput,
  occurrenceStatus,
  pageSize,
  parentGroupOutput,
  periodLabelInput,
  periodNoteInput,
  periodOutput,
  periodSummaryOutput,
  subBehaviorSortOrder,
  remindersInput,
  revision,
  schedulesInput,
  timezone,
  updatedSince,
  utcInstant,
  uuid,
  inputInstant,
} from "./domain";
import type { IntegrationErrorCode } from "./errors";
import { INTEGRATION_LIMITS } from "./limits";
import {
  array,
  boolean,
  enumOf,
  integer,
  literal,
  nullable,
  object,
  optional,
  root,
  string,
  type Infer,
  type SchemaNode,
} from "./schema";
import { INTEGRATION_SCOPES, INTEGRATION_SCOPE_LIST, type IntegrationScope } from "./scopes";
import { INTEGRATION_CONTRACT_VERSION } from "./version";

const L = INTEGRATION_LIMITS;

export type IntegrationToolAnnotations = {
  title: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: false;
};

export type IntegrationOperationDefinition<I, O> = {
  name: string;
  title: string;
  description: string;
  access: "read" | "write";
  scope: IntegrationScope;
  input: SchemaNode<I>;
  output: SchemaNode<O>;
  annotations: IntegrationToolAnnotations;
  /** Why the annotation hints are set this way, against Claude and OpenAI guidance. */
  annotationRationale: string;
  /** Error codes this operation can return, besides transport-level codes. */
  errors: readonly IntegrationErrorCode[];
  since: string;
};

/** Errors every tool can return from the transport or pipeline. */
export const COMMON_ERROR_CODES: readonly IntegrationErrorCode[] = Object.freeze([
  "invalid_input",
  "authentication_required",
  "rate_limited",
  "service_unavailable",
  "internal_error",
]);

const READ_RATIONALE =
  "Reads account data and changes nothing, so readOnlyHint is true. Claude runs read-only tools without per-call confirmation, and OpenAI asks for readOnlyHint on every read. openWorldHint is false because the tool reaches only the user's own Cadence account.";

type ReadSpec<I, O> = {
  name: string;
  /** Contract version that introduced the tool. Defaults to 1.0.0. */
  since?: string;
  title: string;
  description: string;
  input: SchemaNode<I>;
  output: SchemaNode<O>;
  errors?: readonly IntegrationErrorCode[];
};

function readOperation<I, O>(spec: ReadSpec<I, O>): IntegrationOperationDefinition<I, O> {
  return Object.freeze({
    name: spec.name,
    title: spec.title,
    description: spec.description,
    access: "read",
    scope: INTEGRATION_SCOPES.read,
    input: root(spec.input),
    output: root(spec.output),
    annotations: Object.freeze({
      title: spec.title,
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    }),
    annotationRationale: READ_RATIONALE,
    errors: Object.freeze([...COMMON_ERROR_CODES, ...(spec.errors ?? [])]),
    since: spec.since ?? "1.0.0",
  });
}

type WriteSpec<I, O> = ReadSpec<I, O> & {
  scope: IntegrationScope;
  destructiveHint: boolean;
  idempotentHint: boolean;
  annotationRationale: string;
};

function writeOperation<I, O>(spec: WriteSpec<I, O>): IntegrationOperationDefinition<I, O> {
  return Object.freeze({
    name: spec.name,
    title: spec.title,
    description: spec.description,
    access: "write",
    scope: spec.scope,
    input: root(spec.input),
    output: root(spec.output),
    annotations: Object.freeze({
      title: spec.title,
      readOnlyHint: false,
      destructiveHint: spec.destructiveHint,
      idempotentHint: spec.idempotentHint,
      openWorldHint: false,
    }),
    annotationRationale: spec.annotationRationale,
    errors: Object.freeze<IntegrationErrorCode[]>([...COMMON_ERROR_CODES, "insufficient_scope", ...(spec.errors ?? [])]),
    since: spec.since ?? "1.0.0",
  });
}

const behaviorIdInput = () => uuid("Behavior id.");
const occurrenceIdInput = () => uuid("Occurrence id.");
const searchId = () =>
  string({
    pattern: "^(behavior|occurrence|day_note|period):[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
    maxLength: 64,
    description: "Result id from `search`: `behavior:<uuid>`, `occurrence:<uuid>`, `day_note:<uuid>`, or `period:<uuid>`.",
  });
const behaviorIdsFilter = () =>
  array(uuid(), { minItems: 1, maxItems: L.maxBehaviorFilterIds, uniqueItems: true, description: "Only these Behaviors." });

/**
 * What a Period is, stated once and repeated in every Period tool description
 * (Ticket 370, D35). It describes the record; it gives a client no instruction.
 */
export const PERIOD_MEANING =
  "A Period is a date range the user labeled to say something affected those days, such as illness or travel. It never changes a status, adherence, a reminder or a schedule, and it is not a reason to mark an Occurrence Not Completed. Pausing a Behavior is pause_behavior. A Period is created or changed only when the user states it.";

/** Agents create, edit and end a Period; removing one stays in the app (D35). */
const PERIOD_NO_REMOVE = "No tool removes a Period: the user removes one in the Cadence app.";

const periodIdInput = () => uuid("Period id from list_periods, get_account_context `active_periods`, or a get_timeline day.");
const periodSummaries = (description: string) => array(periodSummaryOutput, { maxItems: L.maxEmbeddedPeriods, description });

// ------------------------------------------------------------------ reads

const getAccountContext = readOperation({
  name: "get_account_context",
  title: "Get Cadence account context",
  description:
    "Returns the account's timezone, today's local date and time, the Periods that cover today, the permissions this connection has, and how fresh the data is. Use it first to learn what \"today\" means for this user and which Cadence tools the connection may call. A Period in `active_periods` is the user's own label for these days; it changes no status, adherence, reminder or schedule.",
  input: object({}),
  output: object({
    account_ref: string({
      minLength: 16,
      maxLength: 128,
      pattern: "^[A-Za-z0-9_-]+$",
      description: "Stable account id for this client only. Other clients see a different value.",
    }),
    timezone: timezone(),
    today_local_date: localDate("Today's date in the account timezone."),
    local_time: localTime("Current local time in the account timezone."),
    now: utcInstant("Current instant."),
    granted_scopes: array(enumOf(INTEGRATION_SCOPE_LIST), { minItems: 1, uniqueItems: true }),
    contract_version: literal(INTEGRATION_CONTRACT_VERSION),
    active_periods: periodSummaries(`Periods that cover today, earliest first, at most ${L.maxEmbeddedPeriods}. Empty when none does (contract 1.8.0).`),
    more_active_periods: boolean({ description: "True when more Periods cover today than `active_periods` returns. list_periods returns them all." }),
    freshness: freshnessOutput,
  }),
});

const listBehaviors = readOperation({
  name: "list_behaviors",
  title: "List Behaviors",
  description:
    "Lists the user's Behaviors, the recurring things they track (habits, routines, or recurring tasks), with schedules, reminders, category, run state, archive notes, and sub-behavior links. A parent Behavior lists its sub-behaviors (one level deep). Use it to find a Behavior id or review what the user tracks. Includes archived Behaviors unless filtered.",
  input: object({
    state: optional(enumOf(["active", "archived", "running", "not_running", "all"] as const, {
      default: "all",
      description: "Which Behaviors to include. running is active and scheduling; not_running is active but ended or paused; active is both.",
    })),
    category_id: optional(uuid("Only Behaviors in this category.")),
    is_opportunity: optional(boolean({ description: "true: only Behaviors available as opportunities; false: only the others. Omit for both (contract 1.6.0)." })),
    parent_behavior_id: optional(uuid("Only the sub-behaviors of this parent Behavior (contract 1.7.0).")),
    hierarchy: optional(enumOf(["all", "top_level", "sub_behaviors"] as const, {
      default: "all",
      description: "top_level returns parents and standalone Behaviors; sub_behaviors returns only sub-behaviors (contract 1.7.0).",
    })),
    updated_since: optional(updatedSince()),
    page_size: optional(pageSize()),
    cursor: optional(cursor()),
  }),
  output: object({
    behaviors: array(behaviorOutput),
    next_cursor: nextCursor(),
  }),
});

const getBehavior = readOperation({
  name: "get_behavior",
  title: "Get Behavior",
  description:
    "Returns one Behavior's full definition: schedules and time entries, reminder settings, category, description, location, default duration, run state, end, pause, archive notes, parent link, sub-behaviors, and revision. Use it before editing a Behavior.",
  input: object({ behavior_id: behaviorIdInput() }),
  output: object({ behavior: behaviorOutput }),
  errors: ["not_found"],
});

const listCategories = readOperation({
  name: "list_categories",
  title: "List categories",
  description: "Lists the user's Behavior categories in display order. Use it to choose a category id when creating or editing a Behavior.",
  input: object({
    updated_since: optional(updatedSince()),
    page_size: optional(pageSize()),
    cursor: optional(cursor()),
  }),
  output: object({
    categories: array(categoryOutput),
    next_cursor: nextCursor(),
  }),
});

const DAY_NOTE_MEANING =
  "A day note is the user's one note about a whole calendar date (for example \"Travel day\" or \"Sick\"). It is not an Occurrence note, has no status, and never changes Completed, Not Completed, Unresolved, Needs decision, adherence, or reminders.";

const dayNoteOutput = object({
  id: uuid(),
  local_date: localDate(),
  note: nullable(string({ description: "Day note text. Null after the user cleared it." })),
  revision: revision(),
  updated_at: utcInstant(),
});

const timelineDay = object({
  local_date: localDate(),
  is_today: boolean(),
  day_note: optional(nullable(string({ description: "The user's day note for this date, or null. Separate from Occurrence notes and statuses." }))),
  occurrences: array(occurrenceOutput, { description: "Every Occurrence of the day, sub-behavior Occurrences included." }),
  parent_groups: optional(array(parentGroupOutput, { description: "The day's parent Behavior slots in time order. Their Occurrences also appear in `occurrences` (contract 1.7.0)." })),
  periods: periodSummaries(`Periods that cover this date, earliest first, at most ${L.maxEmbeddedPeriods}. Empty when none does (contract 1.8.0).`),
  more_periods: boolean({ description: "True when more Periods cover this date than `periods` returns. list_periods returns them all." }),
});

const getTimeline = readOperation({
  name: "get_timeline",
  title: "Get Timeline",
  description:
    `Returns the Timeline as the Cadence web app groups it: Needs decision (Unresolved Occurrences from before today) plus each day's Occurrences, with parent Behavior slots and their derived progress in \`parent_groups\`. Use it for questions such as "what's on today" or "what still needs a decision". Covers up to ${L.maxTimelineDays} days from the start date. Each day also lists the Periods that cover it, the user's own labels for those days; a Period changes no status.`,
  input: object({
    start_local_date: optional(localDate("First day to return. Defaults to today in the account timezone.")),
    days: optional(integer({ minimum: 1, maximum: L.maxTimelineDays, default: 1, description: "Number of days to return." })),
    include_needs_decision: optional(boolean({ default: true, description: "Include the Needs decision group." })),
  }),
  output: object({
    timezone: timezone(),
    today_local_date: localDate(),
    needs_decision: nullable(object({
      occurrences: array(occurrenceOutput, { maxItems: L.maxNeedsDecisionItems }),
      total_count: integer({ minimum: 0 }),
      truncated: boolean({ description: "True when more Needs decision Occurrences exist than are returned." }),
      lookback_start_local_date: localDate(`Earliest date searched (${L.needsDecisionLookbackDays} days back). Use list_occurrences for older history.`),
      parent_groups: optional(array(parentGroupOutput, { description: "Parent Behavior slots with a Needs decision Occurrence (contract 1.7.0)." })),
    }), { description: "Null when include_needs_decision is false." }),
    days: array(timelineDay, { maxItems: L.maxTimelineDays }),
    freshness: freshnessOutput,
  }),
});

const listOccurrences = readOperation({
  name: "list_occurrences",
  title: "List Occurrences",
  description:
    `Lists Occurrences (single scheduled instances of a Behavior, such as one day's habit check-in) over a date range of up to ${L.maxOccurrenceRangeDays} days, filtered by status or Behavior. Use it for history questions or to find an Occurrence id. Results are ordered by date and time.`,
  input: object({
    start_local_date: localDate("First local date, inclusive."),
    end_local_date: localDate("Last local date, inclusive."),
    statuses: optional(array(occurrenceStatus(), { minItems: 1, maxItems: OCCURRENCE_STATUSES.length, uniqueItems: true, description: "Only these stored statuses." })),
    needs_decision_only: optional(boolean({ default: false, description: "Only Unresolved Occurrences before today." })),
    behavior_ids: optional(behaviorIdsFilter()),
    updated_since: optional(updatedSince()),
    page_size: optional(pageSize()),
    cursor: optional(cursor()),
  }),
  output: object({
    timezone: timezone(),
    occurrences: array(occurrenceOutput),
    next_cursor: nextCursor(),
    freshness: freshnessOutput,
  }),
  errors: ["limit_exceeded"],
});

const listDayNotes = readOperation({
  name: "list_day_notes",
  since: "1.1.0",
  title: "List day notes",
  description:
    `Lists the user's day notes for a date range of up to ${L.maxDayNoteRangeDays} days. ${DAY_NOTE_MEANING} Use it for questions about how a day went overall. Only dates with a saved note are returned.`,
  input: object({
    start_local_date: localDate("First local date, inclusive."),
    end_local_date: localDate("Last local date, inclusive."),
  }),
  output: object({
    timezone: timezone(),
    day_notes: array(dayNoteOutput, { maxItems: L.maxDayNoteRangeDays }),
  }),
  errors: ["limit_exceeded"],
});

const listPeriods = readOperation({
  name: "list_periods",
  since: "1.8.0",
  title: "List Periods",
  description:
    `Lists the user's Periods that overlap a date range of up to ${L.maxPeriodRangeDays} days, earliest first, up to ${L.maxPeriodsPerPage} per page, each with its note and revision. ${PERIOD_MEANING} ${PERIOD_NO_REMOVE}`,
  input: object({
    start_local_date: localDate("First local date, inclusive."),
    end_local_date: localDate("Last local date, inclusive."),
    cursor: optional(cursor()),
  }),
  output: object({
    timezone: timezone(),
    today_local_date: localDate("Today's date in the account timezone."),
    periods: array(periodOutput, { maxItems: L.maxPeriodsPerPage, description: "Periods with at least one day in the range. An ongoing Period overlaps every range that reaches its first day." }),
    next_cursor: nextCursor(),
  }),
  errors: ["limit_exceeded"],
});

const getOccurrence = readOperation({
  name: "get_occurrence",
  title: "Get Occurrence",
  description:
    "Returns one Occurrence with its note, full status history, measured time sessions, and revision. Use it before changing an Occurrence's status or note.",
  input: object({ occurrence_id: occurrenceIdInput() }),
  output: object({ occurrence: occurrenceDetailOutput }),
  errors: ["not_found"],
});

const getAdherenceSummary = readOperation({
  name: "get_adherence_summary",
  title: "Get adherence summary",
  description:
    `Returns Completed, Not Completed, and Unresolved counts and the adherence rate, overall and per Behavior, for a date range of up to ${L.maxAdherenceRangeDays} days. ${ADHERENCE_DEFINITION} Counts and the rate cover scheduled Occurrences; opportunity_completed_count counts added opportunities apart. \`period_split\` gives the same counts for days inside and outside the user's Periods. Use it for "how am I doing" questions. Cadence does not compute streaks.`,
  input: object({
    start_local_date: localDate("First local date, inclusive."),
    end_local_date: localDate("Last local date, inclusive."),
    behavior_ids: optional(behaviorIdsFilter()),
  }),
  output: object({
    start_local_date: localDate(),
    end_local_date: localDate(),
    timezone: timezone(),
    adherence_definition: literal(ADHERENCE_DEFINITION),
    overall: object(adherenceCounts),
    behaviors: array(object({
      behavior_id: uuid(),
      behavior_title: string(),
      state: enumOf(BEHAVIOR_STATES),
      ...adherenceCounts,
    })),
    period_split: nullable(object({
      periods: periodSummaries(`Periods that overlap the range, earliest first, at most ${L.maxEmbeddedPeriods}.`),
      more_periods: boolean({ description: "True when more Periods overlap the range than `periods` returns. `inside` and `outside` still count every Period." }),
      inside: object(adherenceCounts, { description: "Counts for Occurrences on dates that at least one Period covers. A date covered by several Periods counts once." }),
      outside: object(adherenceCounts, { description: "Counts for Occurrences on every other date in the range." }),
    }), {
      description: "The overall counts split by the user's Periods, after the `behavior_ids` filter. Null when no Period overlaps the range. `overall`, `behaviors` and the adherence definition do not change: a Period excludes nothing (contract 1.8.0).",
    }),
  }),
  errors: ["limit_exceeded"],
});

const search = readOperation({
  name: "search",
  title: "Search Cadence",
  description:
    `Searches the user's Behaviors (titles, descriptions, archive notes), Occurrence notes, day notes, and Period labels by text. Returns ids for \`fetch\` and links into the Cadence web app. Use it to find a habit, routine, or note by keyword. A Period's note is not searched. ${DAY_NOTE_MEANING}`,
  input: object({
    query: string({ minLength: 1, maxLength: L.maxSearchQueryLength, pattern: "\\S", description: "Search text." }),
  }),
  output: object({
    results: array(object({
      id: searchId(),
      title: string(),
      url: httpsUrl("Link to the record in the Cadence web app."),
    }), { maxItems: L.maxSearchResults }),
  }),
});

const fetchRecord = readOperation({
  name: "fetch",
  title: "Fetch Cadence record",
  description:
    `Returns the full text of one \`search\` result: a Behavior's definition, an Occurrence and its note, a day note, or a Period's label and dates (list_periods returns a Period's note). Use it after \`search\` to read a result. ${DAY_NOTE_MEANING}`,
  input: object({ id: searchId() }),
  output: object({
    id: searchId(),
    title: string(),
    text: string({ description: "Plain-text rendering of the record. User-entered text is quoted as data." }),
    url: httpsUrl("Link to the record in the Cadence web app."),
    metadata: object({
      kind: enumOf(["behavior", "occurrence", "day_note", "period"] as const),
      behavior_id: optional(uuid("Present for Behavior and Occurrence results. Absent for day notes and Periods.")),
      local_date: optional(localDate()),
      status: optional(occurrenceStatus()),
    }),
  }),
  errors: ["not_found"],
});

// ----------------------------------------------------------------- writes

const setOccurrenceStatus = writeOperation({
  name: "set_occurrence_status",
  title: "Set Occurrence status",
  description:
    "Marks one Occurrence Completed or Not Completed, or returns it to Unresolved. Use it when the user says they did, or did not do, a scheduled habit, routine, or task. Setting the current status again changes nothing. Each change is kept in the status history.",
  scope: INTEGRATION_SCOPES.occurrencesWrite,
  input: object({
    occurrence_id: occurrenceIdInput(),
    status: occurrenceStatus("New status."),
    expected_status: optional(occurrenceStatus("Status the client last read. If the stored status differs, the call fails with `conflict` and changes nothing.")),
    idempotency_key: optional(idempotencyKey()),
  }),
  output: object({
    occurrence: occurrenceOutput,
    previous_status: occurrenceStatus(),
    changed: boolean({ description: "False when the Occurrence already had this status." }),
  }),
  errors: ["not_found", "conflict", "idempotency_key_reused", "invalid_state"],
  destructiveHint: true,
  idempotentHint: true,
  annotationRationale:
    "Changes stored data, so readOnlyHint is false. Claude's review criteria ask for destructiveHint true on tools that modify data, so Claude confirms each call; OpenAI reserves it for hard-to-reverse outcomes, and a status can be set back, so the hint is conservative for ChatGPT. The same arguments always produce the same end state, so idempotentHint is true. openWorldHint is false: only the user's own Cadence account is touched.",
});

const parentSlotStatus = enumOf(["completed", "not_completed"] as const, { description: "New status for each sub-behavior Occurrence in the slot." });

const setParentOccurrenceStatus = writeOperation({
  name: "set_parent_occurrence_status",
  since: "1.7.0",
  title: "Set parent Behavior slot status",
  description:
    `Marks every sub-behavior Occurrence in one parent Behavior slot Completed or Not Completed in one change, such as a whole skin routine one morning. Name the slot with \`local_date\`, plus \`slot_key\` from get_timeline \`parent_groups\` when the parent has several times that day, or list \`occurrence_ids\`. Occurrences that already have the status do not change. To mark one step, use set_occurrence_status.`,
  scope: INTEGRATION_SCOPES.occurrencesWrite,
  input: object({
    parent_behavior_id: behaviorIdInput(),
    status: parentSlotStatus,
    local_date: optional(localDate("Day of the slot, in the account timezone.")),
    slot_key: optional(inputInstant("`slot_key` of one parent group from get_timeline. Needs local_date.")),
    occurrence_ids: optional(array(uuid(), {
      minItems: 1, maxItems: L.maxParentSlotOccurrences, uniqueItems: true,
      description: "The sub-behavior Occurrences to mark. All must belong to sub-behaviors of this parent on one day.",
    })),
    expected_statuses: optional(array(object({
      occurrence_id: occurrenceIdInput(),
      status: occurrenceStatus("Status the client last read."),
    }), {
      minItems: 1, maxItems: L.maxParentSlotOccurrences,
      description: "Statuses the client last read. If any stored status differs, the call fails with `conflict` and changes nothing.",
    })),
    idempotency_key: optional(idempotencyKey()),
  }, { requireOneOf: ["local_date", "occurrence_ids"] }),
  output: object({
    parent_behavior_id: uuid(),
    status: parentSlotStatus,
    occurrences: array(occurrenceOutput, { maxItems: L.maxParentSlotOccurrences, description: "The marked Occurrences after the change, in sub-behavior order." }),
    changed_occurrence_ids: array(uuid(), { description: "Occurrences whose status changed. Empty when all already had the status." }),
    parent_groups: array(parentGroupOutput, { description: "The derived rollup of each slot the marked Occurrences belong to." }),
    changed: boolean({ description: "False when every Occurrence already had this status." }),
  }),
  errors: ["not_found", "conflict", "idempotency_key_reused", "invalid_state"],
  destructiveHint: true,
  idempotentHint: true,
  annotationRationale:
    "Changes stored statuses of several Occurrences at once, so readOnlyHint is false and destructiveHint is true under Claude's review criteria, which ask for it on tools that modify data; each status can be set back, so the hint is conservative for ChatGPT. The same arguments always leave the same statuses, so idempotentHint is true. openWorldHint is false: only the user's own Cadence account is touched.",
});

const updateOccurrenceNote = writeOperation({
  name: "update_occurrence_note",
  title: "Update Occurrence note",
  description:
    "Adds, replaces, or clears the note on one Occurrence. Use it when the user wants to record context about a specific scheduled instance, such as how a workout went.",
  scope: INTEGRATION_SCOPES.occurrencesWrite,
  input: object({
    occurrence_id: occurrenceIdInput(),
    note: occurrenceNoteInput(),
    expected_revision: optional(revision("Revision the client last read. If the Occurrence changed since, the call fails with `conflict`.")),
    idempotency_key: optional(idempotencyKey()),
  }),
  output: object({
    occurrence: occurrenceOutput,
    changed: boolean({ description: "False when the note already had this text." }),
  }),
  errors: ["not_found", "conflict", "idempotency_key_reused"],
  destructiveHint: true,
  idempotentHint: true,
  annotationRationale:
    "Replaces the previous note text, which Cadence does not keep in history, so destructiveHint is true under both Claude's and OpenAI's guidance. The same arguments produce the same note, so idempotentHint is true. openWorldHint is false.",
});

const moveRefusal = nullable(object({
  reason: enumOf(MOVE_REFUSAL_REASON_VALUES),
  message: string({ description: "Plain-language reason to show the user." }),
  alternatives: array(object({
    start_at: utcInstant(),
    start_time: localTime("Local start time in the Behavior's timezone."),
  }), { maxItems: 3, description: "Up to three free start times today, nearest the requested time first. Empty for Undo." }),
}), { description: "Set when nothing changed because a rule refused the request. Null when the move or Undo was applied." });

const moveResultOutput = (applied: string) => object({
  outcome: enumOf([applied, "refused"] as const),
  occurrence: occurrenceOutput,
  move: nullable(occurrenceMoveRecordOutput, { description: "The record this call added, or the first call's record on a replay. Null when refused." }),
  refusal: moveRefusal,
});

const MOVE_RATIONALE =
  "Changes where today's Occurrence sits, so readOnlyHint is false. The planned time and the Behavior's schedule never change and revert_occurrence_move undoes a move, but Claude's review criteria ask for destructiveHint true on tools that modify data, so it is set. The same idempotency key returns the first result, but a call without one makes a new move each time, so idempotentHint is false. openWorldHint is false: only the user's own Cadence account is touched.";

const moveOccurrenceForDay = writeOperation({
  name: "move_occurrence_for_day",
  since: "1.3.0",
  title: "Move Occurrence for today",
  description:
    "Moves one of today's Unresolved Occurrences to another start time today. Only that day changes: the Behavior's schedule and the planned time stay the same, and `effective_start_at` shows the new time. The item keeps its length. Reminders follow the new time. Send the `revision` you last read as `expected_revision`. When a rule stops the move (the time has passed, something else is already there, the item changed since you read it), nothing changes and `refusal` explains why and offers up to three free times. Use revert_occurrence_move to undo it.",
  scope: INTEGRATION_SCOPES.occurrencesWrite,
  input: object({
    occurrence_id: occurrenceIdInput(),
    start_time: localTime("New start: a local time on the Occurrence's `local_date` in its Behavior's timezone."),
    expected_revision: revision("Revision the client last read. If the Occurrence changed since, the move is refused with `revision_changed`."),
    idempotency_key: optional(idempotencyKey()),
  }),
  output: moveResultOutput("moved"),
  errors: ["not_found", "idempotency_key_reused"],
  destructiveHint: true,
  idempotentHint: false,
  annotationRationale: MOVE_RATIONALE,
});

const revertOccurrenceMove = writeOperation({
  name: "revert_occurrence_move",
  since: "1.3.0",
  title: "Undo Occurrence move",
  description:
    "Undoes the latest move of one of today's Unresolved Occurrences, putting it back where it was before that move: its planned time, or an earlier move. Only the latest move can be undone. When there is nothing to undo or the item changed since you read it, nothing changes and `refusal` explains why.",
  scope: INTEGRATION_SCOPES.occurrencesWrite,
  input: object({
    occurrence_id: occurrenceIdInput(),
    expected_revision: revision("Revision the client last read. If the Occurrence changed since, the Undo is refused with `revision_changed`."),
    idempotency_key: optional(idempotencyKey()),
  }),
  output: moveResultOutput("undone"),
  errors: ["not_found", "idempotency_key_reused"],
  destructiveHint: true,
  idempotentHint: false,
  annotationRationale: MOVE_RATIONALE.replace("revert_occurrence_move undoes a move", "a later move can redo it"),
});

const updateDayNote = writeOperation({
  name: "update_day_note",
  since: "1.1.0",
  title: "Update day note",
  description:
    `Adds, replaces, or clears the user's one note for a calendar date. ${DAY_NOTE_MEANING} Use update_occurrence_note for one scheduled instance and set_occurrence_status for Completed or Not Completed. Future dates are allowed.`,
  scope: INTEGRATION_SCOPES.occurrencesWrite,
  input: object({
    local_date: localDate("Calendar date the note is about, in the account timezone."),
    note: dayNoteInput(),
    expected_revision: optional(revision("Revision the client last read. If the day note changed since, or does not exist, the call fails with `conflict`.")),
    idempotency_key: optional(idempotencyKey()),
  }),
  output: object({
    local_date: localDate(),
    day_note: nullable(dayNoteOutput, { description: "Null when the date never had a note and the request cleared it." }),
    changed: boolean({ description: "False when the day note already had this text." }),
  }),
  errors: ["conflict", "idempotency_key_reused"],
  destructiveHint: true,
  idempotentHint: true,
  annotationRationale:
    "Replaces the previous day note text, which Cadence does not keep in history, so destructiveHint is true under both Claude's and OpenAI's guidance. The same arguments produce the same day note, so idempotentHint is true. openWorldHint is false.",
});

const createPeriod = writeOperation({
  name: "create_period",
  since: "1.8.0",
  title: "Create Period",
  description:
    `Adds a Period from start_local_date through end_local_date, or an ongoing one when no end is sent. Past, current and future dates are allowed, and Periods may overlap. ${PERIOD_MEANING} ${PERIOD_NO_REMOVE}`,
  scope: INTEGRATION_SCOPES.occurrencesWrite,
  input: object({
    label: periodLabelInput(),
    start_local_date: localDate("First day of the Period, inclusive, in the account timezone."),
    end_local_date: optional(nullable(localDate(), { description: "Last day, inclusive, on or after start_local_date. Omit or send null for an ongoing Period." })),
    note: optional(nullable(periodNoteInput(), { description: "Optional note about the Period. Omit, or send null or an empty string, for none." })),
    idempotency_key: optional(idempotencyKey()),
  }),
  output: object({ period: periodOutput }),
  errors: ["limit_exceeded", "idempotency_key_reused"],
  destructiveHint: false,
  idempotentHint: false,
  annotationRationale:
    "Adds a new Period and changes no existing record, like create_behavior, so destructiveHint is false under both Claude's and OpenAI's guidance; readOnlyHint is false, so clients still treat it as a write. Calling it twice without an idempotency_key adds two Periods, and no tool removes one, so idempotentHint is false. openWorldHint is false: only the user's own Cadence account is touched.",
});

const periodChangeFields = ["label", "start_local_date", "end_local_date", "note"] as const;

const updatePeriod = writeOperation({
  name: "update_period",
  since: "1.8.0",
  title: "Update Period",
  description:
    `Edits a Period's label, dates or note. Only the fields sent change: end_local_date null makes it ongoing, and note null clears the note. The revision comes from list_periods. ${PERIOD_MEANING} ${PERIOD_NO_REMOVE}`,
  scope: INTEGRATION_SCOPES.occurrencesWrite,
  input: object({
    period_id: periodIdInput(),
    expected_revision: revision("Revision from list_periods. If the Period changed since, the call fails with `conflict` and changes nothing."),
    label: optional(periodLabelInput("New label. Omit to keep it.")),
    start_local_date: optional(localDate("New first day, inclusive. Omit to keep it.")),
    end_local_date: optional(nullable(localDate(), { description: "New last day, inclusive, or null to make the Period ongoing. Omit to keep it." })),
    note: optional(nullable(periodNoteInput(), { description: "New note, or null (or an empty string) to clear it. Omit to keep it." })),
    idempotency_key: optional(idempotencyKey()),
  }, { requireOneOf: periodChangeFields }),
  output: object({
    period: periodOutput,
    changed: boolean({ description: "False when the sent values matched the stored ones." }),
  }),
  errors: ["not_found", "conflict", "idempotency_key_reused"],
  destructiveHint: true,
  idempotentHint: true,
  annotationRationale:
    "Overwrites the Period's label, dates or note, and Cadence keeps no history of the earlier values, so destructiveHint is true under both Claude's and OpenAI's guidance. The same arguments leave the same Period, so idempotentHint is true. openWorldHint is false.",
});

const endPeriod = writeOperation({
  name: "end_period",
  since: "1.8.0",
  title: "End Period today",
  description:
    `Ends a Period today: its last day becomes today in the account timezone. It takes no date. A Period that has not started, or has already ended, fails with invalid_state; update_period changes its dates. ${PERIOD_MEANING} ${PERIOD_NO_REMOVE}`,
  scope: INTEGRATION_SCOPES.occurrencesWrite,
  input: object({
    period_id: periodIdInput(),
    expected_revision: revision("Revision from list_periods. If the Period changed since, the call fails with `conflict` and changes nothing."),
    idempotency_key: optional(idempotencyKey()),
  }),
  output: object({
    period: periodOutput,
    changed: boolean({ description: "True when the last day was set to today." }),
  }),
  errors: ["not_found", "conflict", "idempotency_key_reused", "invalid_state"],
  destructiveHint: false,
  idempotentHint: true,
  annotationRationale:
    "Sets one field, the Period's last day, to today, and only when the Period has started and has not ended. update_period sets any other last day or makes the Period ongoing again, so the change is easy to reverse and destructiveHint is false, as OpenAI's guidance reads it; Claude's stricter reading would set it, and readOnlyHint false still marks the tool as a write. Repeating it leaves the same Period, ended today, so idempotentHint is true. openWorldHint is false: only the user's own Cadence account is touched.",
});

const REFUSED_DESCRIPTION = "Set when nothing changed because a rule refused the request. Null when the change was made.";

const opportunityAddRefusal = nullable(object({
  reason: enumOf(OPPORTUNITY_ADD_REFUSAL_VALUES),
  message: string({ description: "Plain-language reason to show the user." }),
  alternatives: array(object({
    start_at: utcInstant(),
    start_time: localTime("Local start time in the Behavior's timezone."),
  }), { maxItems: 3, description: "Up to three free start times today, nearest the requested time first. Empty unless the time was taken." }),
}), { description: REFUSED_DESCRIPTION });

const opportunityRemoveRefusal = nullable(object({
  reason: enumOf(OPPORTUNITY_REMOVE_REFUSAL_VALUES),
  message: string({ description: "Plain-language reason to show the user." }),
}), { description: REFUSED_DESCRIPTION });

const addOpportunityOccurrence = writeOperation({
  name: "add_opportunity_occurrence",
  since: "1.6.0",
  title: "Add opportunity to today",
  description:
    "Adds one of the user's opportunity Behaviors (is_opportunity true, running, not archived) to today: at an exact start_time, in a time range (start_time and end_time, or a preset), or, with mark_completed, as done now, marked Completed at the current minute. It adds a new Occurrence and changes no schedule. When a rule stops it, nothing changes and `refusal` says why. remove_opportunity_occurrence takes back an item added by mistake.",
  scope: INTEGRATION_SCOPES.occurrencesWrite,
  input: object({
    behavior_id: behaviorIdInput(),
    start_time: optional(localTime("Start today in the Behavior's timezone. Alone it is an exact time; with end_time it starts a range.")),
    end_time: optional(localTime("End of a custom range today. Needs start_time and must differ from it; an earlier end runs past midnight.")),
    preset: optional(enumOf(TIME_RANGE_PRESET_NAMES, {
      description: "A time-of-day range instead of start_time: Morning 06:00-12:00, Afternoon 12:00-18:00, Evening 18:00-00:00, Night 00:00-06:00.",
    })),
    mark_completed: optional(boolean({ default: false, description: "Done now: add it at the current minute and mark it Completed. Send no time with it." })),
    idempotency_key: optional(idempotencyKey()),
  }),
  output: object({
    outcome: enumOf(["added", "logged", "refused"] as const, { description: "added placed it on today; logged added it and marked it Completed; refused changed nothing." }),
    occurrence: nullable(occurrenceOutput, { description: "The added Occurrence. Null when refused." }),
    refusal: opportunityAddRefusal,
  }),
  errors: ["not_found", "idempotency_key_reused"],
  destructiveHint: false,
  idempotentHint: false,
  annotationRationale:
    "Adds a new Occurrence and changes no existing record, like create_behavior, so destructiveHint is false under both Claude's and OpenAI's guidance; readOnlyHint is false, so clients still treat it as a write. Calling it twice without an idempotency_key adds two items, so idempotentHint is false. openWorldHint is false: only the user's own Cadence account is touched.",
});

const removeOpportunityOccurrence = writeOperation({
  name: "remove_opportunity_occurrence",
  since: "1.6.0",
  title: "Remove added opportunity",
  description:
    "Removes an opportunity Occurrence that was added to a day, today or still in Needs decision, and cancels its pending reminders. The Behavior stays available as an opportunity. Only a clean item can be removed: Unresolved, never marked, with no note, tracked time or connected activity. A scheduled Occurrence is never removed. When a rule stops it, nothing changes and `refusal` says why.",
  scope: INTEGRATION_SCOPES.occurrencesWrite,
  input: object({
    occurrence_id: occurrenceIdInput(),
    expected_revision: optional(revision("Revision the client last read. If the Occurrence changed since, the call is refused with `revision_changed`.")),
    idempotency_key: optional(idempotencyKey()),
  }),
  output: object({
    outcome: enumOf(["removed", "refused"] as const),
    occurrence: occurrenceOutput,
    refusal: opportunityRemoveRefusal,
  }),
  errors: ["not_found", "idempotency_key_reused"],
  destructiveHint: true,
  idempotentHint: true,
  annotationRationale:
    "Deletes an added Occurrence, so destructiveHint is true under both Claude's and OpenAI's guidance; the rules allow it only for a clean, unmarked item, and add_opportunity_occurrence can add it again. Repeating it leaves the same end state, the item gone, so idempotentHint is true. openWorldHint is false.",
});

const subBehaviorInput = object({
  title: behaviorTitleInput(),
  description: optional(behaviorDescriptionInput()),
  inherit_parent_schedule: optional(boolean({ description: "True (the default) follows the parent's schedule and takes no `schedules`; false needs `schedules`." })),
  schedules: optional(schedulesInput),
  sub_behavior_sort_order: optional(subBehaviorSortOrder("Position among the sub-behaviors. Defaults to the list order.")),
  external_ref: optional(externalRef("Optional id of the matching record in the calling app. Stored for this client only.")),
}, { description: "One sub-behavior to create under the new parent." });

const createBehavior = writeOperation({
  name: "create_behavior",
  title: "Create Behavior",
  description:
    `Creates a Behavior, a recurring thing the user wants to track (a habit, routine or recurring task), with schedules (daily, every N days, weekly or every N weeks on chosen weekdays, monthly on day N) and reminders. With is_opportunity true it can be added to today when there is room, and schedules may be empty. \`sub_behaviors\` creates a parent and up to ${L.maxInlineSubBehaviors} sub-behaviors in one change; \`parent_behavior_id\` adds one sub-behavior to an existing parent, and one that follows the parent's schedule needs no \`schedules\`. An opportunity Behavior is never in a routine. list_categories lists categories.`,
  scope: INTEGRATION_SCOPES.behaviorsWrite,
  input: object({
    title: behaviorTitleInput(),
    description: optional(behaviorDescriptionInput()),
    location_text: optional(locationTextInput()),
    category_id: optional(nullable(uuid("Category id from list_categories."))),
    schedules: optional(schedulesInput),
    is_opportunity: optional(boolean({ default: false, description: "Available as an opportunity: the person can add it to today when there is room. Required true for empty schedules (contract 1.6.0). An opportunity Behavior cannot be a parent or a sub-behavior (contract 1.7.0)." })),
    reminders: optional(remindersInput),
    default_duration_minutes: optional(defaultDurationInput()),
    parent_behavior_id: optional(uuid("Optional parent Behavior: the new Behavior becomes its sub-behavior. The parent must be active and top-level (contract 1.7.0).")),
    inherit_parent_schedule: optional(boolean({ description: "With parent_behavior_id: true (the default) follows the parent's schedule and takes no `schedules`; false needs `schedules`." })),
    sub_behavior_sort_order: optional(subBehaviorSortOrder("With parent_behavior_id: position among the parent's sub-behaviors. Defaults to last.")),
    sub_behaviors: optional(array(subBehaviorInput, {
      minItems: 1, maxItems: L.maxInlineSubBehaviors,
      description: "Sub-behaviors to create with this Behavior in the same change, in display order. Not allowed with parent_behavior_id: a sub-behavior can't have sub-behaviors.",
    })),
    end_on: optional(localDate("Optional last local day the Behavior runs. It stays active and moves to Not running after it.")),
    end_time: optional(localTime("Optional local time on end_on when it stops. Needs end_on. Without it the Behavior stops at the end of end_on.")),
    end_date: optional(localDate("Deprecated: send end_on. The first day without the Behavior; Cadence stores end_on as the day before.")),
    external_ref: optional(externalRef("Optional id of the matching record in the calling app. Stored for this client only.")),
    idempotency_key: optional(idempotencyKey()),
  }, { requireOneOf: ["schedules", "parent_behavior_id"] }),
  output: object({
    behavior: behaviorOutput,
    sub_behaviors: optional(array(behaviorOutput, { description: "The created sub-behaviors in order, when the call sent `sub_behaviors` (contract 1.7.0)." })),
  }),
  errors: ["not_found", "idempotency_key_reused", "invalid_state"],
  destructiveHint: false,
  idempotentHint: false,
  annotationRationale:
    "Adds a new Behavior and changes no existing record, so destructiveHint is false under both Claude's and OpenAI's guidance; readOnlyHint is false, so clients still treat it as a write. Calling it twice without an idempotency_key creates two Behaviors, so idempotentHint is false. openWorldHint is false.",
});

const behaviorChangeFields = [
  "title",
  "description",
  "location_text",
  "category_id",
  "schedules",
  "reminders",
  "default_duration_minutes",
  "end_on",
  "end_time",
  "end_date",
  "is_opportunity",
  "parent_behavior_id",
  "inherit_parent_schedule",
  "sub_behavior_sort_order",
] as const;

const updateBehavior = writeOperation({
  name: "update_behavior",
  title: "Update Behavior",
  description:
    `Edits a Behavior's title, description, place, category, schedules, reminders, length, end, opportunity flag or sub-behavior link. Only the fields sent change; \`schedules\` replaces the whole list and may be empty only for an opportunity Behavior. \`parent_behavior_id\` groups it under a parent, or null makes it top-level; \`sub_behavior_sort_order\` moves it among its siblings. An opportunity Behavior is never part of a routine. A parent's schedule change also reaches the sub-behaviors that follow it. Past and resolved Occurrences are kept. Read get_behavior first for the revision.`,
  scope: INTEGRATION_SCOPES.behaviorsWrite,
  input: object({
    behavior_id: behaviorIdInput(),
    expected_revision: revision("Revision from get_behavior. If the Behavior changed since, the call fails with `conflict` and changes nothing."),
    title: optional(behaviorTitleInput()),
    description: optional(nullable(behaviorDescriptionInput(), { description: "New description, or null to clear it." })),
    location_text: optional(nullable(locationTextInput(), { description: "New location, or null to clear it." })),
    category_id: optional(nullable(uuid(), { description: "New category id, or null for no category." })),
    schedules: optional(schedulesInput),
    is_opportunity: optional(boolean({ description: "Available as an opportunity, or not. Turning it off needs at least one schedule (contract 1.6.0)." })),
    reminders: optional(remindersInput),
    default_duration_minutes: optional(nullable(defaultDurationInput(), { description: "New duration in minutes, or null to clear it." })),
    end_on: optional(nullable(localDate(), { description: "New last local day, or null to clear the end. It must be later than now. To stop right away, use end_behavior." })),
    end_time: optional(nullable(localTime(), { description: "New local stop time on end_on, or null to stop at the end of that day." })),
    end_date: optional(nullable(localDate(), { description: "Deprecated: send end_on. The first day without the Behavior, or null to clear the end." })),
    parent_behavior_id: optional(nullable(uuid(), { description: "New parent Behavior, or null to make this a top-level Behavior. The parent must be active and top-level, and a Behavior with sub-behaviors can't get a parent (contract 1.7.0)." })),
    inherit_parent_schedule: optional(boolean({ description: "For a sub-behavior: true follows the parent's schedule and takes no `schedules`; false keeps its current schedules unless `schedules` is sent. A Behavior newly given a parent follows it unless this is false." })),
    sub_behavior_sort_order: optional(subBehaviorSortOrder("For a sub-behavior: new position among its siblings, 0 first. The other sub-behaviors shift to make room.")),
    idempotency_key: optional(idempotencyKey()),
  }, { requireOneOf: behaviorChangeFields }),
  output: object({
    behavior: behaviorOutput,
    changed: boolean({ description: "False when the sent values matched the stored ones." }),
  }),
  errors: ["not_found", "conflict", "idempotency_key_reused", "invalid_state"],
  destructiveHint: true,
  idempotentHint: true,
  annotationRationale:
    "Overwrites Behavior fields, and a schedule change can remove future Unresolved Occurrences, so destructiveHint is true under both Claude's and OpenAI's guidance. Repeating the same arguments leaves the same definition, so idempotentHint is true. openWorldHint is false.",
});

const archiveBehavior = writeOperation({
  name: "archive_behavior",
  title: "Archive Behavior",
  description:
    "Archives a Behavior so it schedules no new Occurrences, with an optional archive note. History, notes, and past Occurrences are kept, and restore_behavior reverses it. Archiving a parent Behavior also archives its active sub-behaviors. Nothing is deleted. Archiving an archived Behavior changes nothing.",
  scope: INTEGRATION_SCOPES.behaviorsWrite,
  input: object({
    behavior_id: behaviorIdInput(),
    archive_note: optional(archiveNoteInput()),
    expected_revision: optional(revision()),
    idempotency_key: optional(idempotencyKey()),
  }),
  output: object({
    behavior: behaviorOutput,
    changed: boolean({ description: "False when the Behavior was already archived." }),
  }),
  errors: ["not_found", "conflict", "idempotency_key_reused"],
  destructiveHint: true,
  idempotentHint: true,
  annotationRationale:
    "Modifies the Behavior and stops future scheduling, which Claude's review criteria treat as destructive, so destructiveHint is true. It is reversible with restore_behavior, so OpenAI's stricter reading would allow false; the conservative value keeps confirmation in both clients. Repeating it changes nothing, so idempotentHint is true. openWorldHint is false.",
});

const restoreBehavior = writeOperation({
  name: "restore_behavior",
  title: "Restore Behavior",
  description:
    "Restores an archived Behavior so it schedules Occurrences again from today. Archive notes are kept. Restoring a parent Behavior also restores the sub-behaviors archived with it; a sub-behavior of an archived parent can't be restored on its own. Restoring an active Behavior changes nothing.",
  scope: INTEGRATION_SCOPES.behaviorsWrite,
  input: object({
    behavior_id: behaviorIdInput(),
    expected_revision: optional(revision()),
    idempotency_key: optional(idempotencyKey()),
  }),
  output: object({
    behavior: behaviorOutput,
    changed: boolean({ description: "False when the Behavior was already active." }),
  }),
  errors: ["not_found", "conflict", "idempotency_key_reused"],
  destructiveHint: true,
  idempotentHint: true,
  annotationRationale:
    "Modifies an existing Behavior's state and resumes scheduling, which Claude's review criteria treat as a data modification, so destructiveHint is true. Under OpenAI's guidance the change is easy to reverse, so the value is conservative there. Repeating it changes nothing, so idempotentHint is true. openWorldHint is false.",
});

const runActionErrors = ["not_found", "conflict", "idempotency_key_reused", "invalid_state"] as const;

const endBehavior = writeOperation({
  name: "end_behavior",
  since: "1.4.0",
  title: "End Behavior now",
  description:
    "Ends a Behavior this minute. It stays active, moves to Not running, and schedules nothing more; its Unresolved Occurrences later today, including a window still open, are removed. Marked, noted, and timed Occurrences stay. To end on a later day, use update_behavior with end_on. resume_behavior starts it again. Ending an ended Behavior changes nothing.",
  scope: INTEGRATION_SCOPES.behaviorsWrite,
  input: object({
    behavior_id: behaviorIdInput(),
    expected_revision: optional(revision()),
    idempotency_key: optional(idempotencyKey()),
  }),
  output: object({
    behavior: behaviorOutput,
    changed: boolean({ description: "False when the Behavior had already ended." }),
  }),
  errors: [...runActionErrors],
  destructiveHint: true,
  idempotentHint: true,
  annotationRationale:
    "Stops scheduling and removes the rest of today's Unresolved Occurrences, so destructiveHint is true under both Claude's and OpenAI's guidance. Repeating it changes nothing, so idempotentHint is true. openWorldHint is false.",
});

const pauseBehavior = writeOperation({
  name: "pause_behavior",
  since: "1.4.0",
  title: "Pause Behavior",
  description:
    "Pauses a Behavior from from_on until back_on, when it runs again by itself from the start of that day. A pause can start today or later; today starts now unless from_time is later. A Behavior has one pause at a time: a new pause replaces the old one. No Occurrences are scheduled while paused, and Unresolved ones inside the pause are removed. Marked, noted, and timed Occurrences stay.",
  scope: INTEGRATION_SCOPES.behaviorsWrite,
  input: object({
    behavior_id: behaviorIdInput(),
    from_on: localDate("First paused local day. Today or later."),
    from_time: optional(nullable(localTime("Optional local time on from_on when the pause starts."))),
    back_on: localDate("Local day it runs again. After from_on and after today."),
    expected_revision: optional(revision()),
    idempotency_key: optional(idempotencyKey()),
  }),
  output: object({
    behavior: behaviorOutput,
    changed: boolean({ description: "False when the Behavior already had this pause." }),
  }),
  errors: [...runActionErrors],
  destructiveHint: true,
  idempotentHint: true,
  annotationRationale:
    "Replaces any earlier pause and removes Unresolved Occurrences inside the pause, so destructiveHint is true under both Claude's and OpenAI's guidance. The same arguments leave the same pause, so idempotentHint is true. openWorldHint is false.",
});

const resumeBehavior = writeOperation({
  name: "resume_behavior",
  since: "1.4.0",
  title: "Resume Behavior",
  description:
    "Runs a paused or ended Behavior again from now: it clears the pause, and an end that has passed. An end still to come stays. Resuming a running Behavior changes nothing. Use restore_behavior for an archived Behavior.",
  scope: INTEGRATION_SCOPES.behaviorsWrite,
  input: object({
    behavior_id: behaviorIdInput(),
    expected_revision: optional(revision()),
    idempotency_key: optional(idempotencyKey()),
  }),
  output: object({
    behavior: behaviorOutput,
    changed: boolean({ description: "False when the Behavior was already running with no pause set." }),
  }),
  errors: [...runActionErrors],
  destructiveHint: true,
  idempotentHint: true,
  annotationRationale:
    "Modifies the Behavior's end or pause and resumes scheduling, which Claude's review criteria treat as a data modification, so destructiveHint is true. Repeating it changes nothing, so idempotentHint is true. openWorldHint is false.",
});

/** Every operation, keyed by its published tool name. Insertion order is the `tools/list` order. */
export const INTEGRATION_OPERATIONS = Object.freeze({
  get_account_context: getAccountContext,
  list_behaviors: listBehaviors,
  get_behavior: getBehavior,
  list_categories: listCategories,
  get_timeline: getTimeline,
  list_occurrences: listOccurrences,
  get_occurrence: getOccurrence,
  list_day_notes: listDayNotes,
  list_periods: listPeriods,
  get_adherence_summary: getAdherenceSummary,
  search,
  "fetch": fetchRecord,
  set_occurrence_status: setOccurrenceStatus,
  set_parent_occurrence_status: setParentOccurrenceStatus,
  update_occurrence_note: updateOccurrenceNote,
  move_occurrence_for_day: moveOccurrenceForDay,
  revert_occurrence_move: revertOccurrenceMove,
  update_day_note: updateDayNote,
  create_period: createPeriod,
  update_period: updatePeriod,
  end_period: endPeriod,
  add_opportunity_occurrence: addOpportunityOccurrence,
  remove_opportunity_occurrence: removeOpportunityOccurrence,
  create_behavior: createBehavior,
  update_behavior: updateBehavior,
  archive_behavior: archiveBehavior,
  restore_behavior: restoreBehavior,
  end_behavior: endBehavior,
  pause_behavior: pauseBehavior,
  resume_behavior: resumeBehavior,
});

type Operations = typeof INTEGRATION_OPERATIONS;
export type IntegrationOperationName = keyof Operations;
export type IntegrationOperationInput<N extends IntegrationOperationName> = Infer<Operations[N]["input"]>;
export type IntegrationOperationOutput<N extends IntegrationOperationName> = Infer<Operations[N]["output"]>;
export type IntegrationOperation = Operations[IntegrationOperationName];

export const INTEGRATION_OPERATION_NAMES = Object.freeze(
  Object.keys(INTEGRATION_OPERATIONS) as IntegrationOperationName[],
);

export function isIntegrationOperationName(value: unknown): value is IntegrationOperationName {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(INTEGRATION_OPERATIONS, value);
}

export function getIntegrationOperation<N extends IntegrationOperationName>(name: N): Operations[N] {
  return INTEGRATION_OPERATIONS[name];
}
