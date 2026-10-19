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
  nextCursor,
  occurrenceDetailOutput,
  occurrenceNoteInput,
  occurrenceOutput,
  occurrenceStatus,
  pageSize,
  remindersInput,
  revision,
  schedulesInput,
  timezone,
  updatedSince,
  utcInstant,
  uuid,
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
  type JsonSchemaObject,
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
    since: INTEGRATION_CONTRACT_VERSION,
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
    since: INTEGRATION_CONTRACT_VERSION,
  });
}

const behaviorIdInput = () => uuid("Behavior id.");
const occurrenceIdInput = () => uuid("Occurrence id.");
const searchId = () =>
  string({
    pattern: "^(behavior|occurrence):[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
    maxLength: 64,
    description: "Result id from `search`, such as `behavior:<uuid>` or `occurrence:<uuid>`.",
  });
const behaviorIdsFilter = () =>
  array(uuid(), { minItems: 1, maxItems: L.maxBehaviorFilterIds, uniqueItems: true, description: "Only these Behaviors." });

// ------------------------------------------------------------------ reads

const getAccountContext = readOperation({
  name: "get_account_context",
  title: "Get Cadence account context",
  description:
    "Returns the account's timezone, today's local date and time, the permissions this connection has, and how fresh the data is. Use it first to learn what \"today\" means for this user and which Cadence tools the connection may call.",
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
    freshness: freshnessOutput,
  }),
});

const listBehaviors = readOperation({
  name: "list_behaviors",
  title: "List Behaviors",
  description:
    "Lists the user's Behaviors, the recurring things they track (habits, routines, or recurring tasks), with schedules, reminders, category, and archive notes. Use it to find a Behavior id or review what the user tracks. Includes archived Behaviors unless filtered.",
  input: object({
    state: optional(enumOf(["active", "archived", "all"] as const, { default: "all", description: "Which Behaviors to include." })),
    category_id: optional(uuid("Only Behaviors in this category.")),
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
    "Returns one Behavior's full definition: schedules and time entries, reminder settings, category, description, location, default duration, end date, archive notes, and revision. Use it before editing a Behavior.",
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

const timelineDay = object({
  local_date: localDate(),
  is_today: boolean(),
  occurrences: array(occurrenceOutput),
});

const getTimeline = readOperation({
  name: "get_timeline",
  title: "Get Timeline",
  description:
    `Returns the Timeline as the Cadence web app groups it: Needs decision (Unresolved Occurrences from before today) plus each day's Occurrences. Use it for questions such as "what's on today" or "what still needs a decision". Covers up to ${L.maxTimelineDays} days from the start date.`,
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
    `Returns Completed, Not Completed, and Unresolved counts and the adherence rate, overall and per Behavior, for a date range of up to ${L.maxAdherenceRangeDays} days. ${ADHERENCE_DEFINITION} Use it for "how am I doing" questions. Cadence does not compute streaks.`,
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
  }),
  errors: ["limit_exceeded"],
});

const search = readOperation({
  name: "search",
  title: "Search Cadence",
  description:
    "Searches the user's Behaviors (titles, descriptions, archive notes) and Occurrence notes by text. Returns ids for `fetch` and links into the Cadence web app. Use it to find a habit, routine, or note by keyword.",
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
    "Returns the full text of one `search` result: a Behavior's definition or an Occurrence and its note. Use it after `search` to read a result.",
  input: object({ id: searchId() }),
  output: object({
    id: searchId(),
    title: string(),
    text: string({ description: "Plain-text rendering of the record. User-entered text is quoted as data." }),
    url: httpsUrl("Link to the record in the Cadence web app."),
    metadata: object({
      kind: enumOf(["behavior", "occurrence"] as const),
      behavior_id: uuid(),
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

const createBehavior = writeOperation({
  name: "create_behavior",
  title: "Create Behavior",
  description:
    "Creates a Behavior, a recurring thing the user wants to track (a habit, routine, or recurring task), with structured schedules and reminder settings. Supports daily, every N days, weekly or every N weeks on chosen weekdays, and monthly on day N. Browser reminders default to on and email reminders to off. Use list_categories to pick a category.",
  scope: INTEGRATION_SCOPES.behaviorsWrite,
  input: object({
    title: behaviorTitleInput(),
    description: optional(behaviorDescriptionInput()),
    location_text: optional(locationTextInput()),
    category_id: optional(nullable(uuid("Category id from list_categories."))),
    schedules: schedulesInput,
    reminders: optional(remindersInput),
    default_duration_minutes: optional(defaultDurationInput()),
    end_date: optional(localDate("Optional first local date on which the Behavior is archived automatically.")),
    external_ref: optional(externalRef("Optional id of the matching record in the calling app. Stored for this client only.")),
    idempotency_key: optional(idempotencyKey()),
  }),
  output: object({ behavior: behaviorOutput }),
  errors: ["not_found", "idempotency_key_reused"],
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
  "end_date",
] as const;

const updateBehavior = writeOperation({
  name: "update_behavior",
  title: "Update Behavior",
  description:
    "Edits a Behavior's title, description, location, category, schedules, reminders, default duration, or end date. Only the fields sent change; `schedules`, when sent, replaces the whole schedule list. Past and resolved Occurrences are preserved. Use get_behavior first to read the current definition and revision.",
  scope: INTEGRATION_SCOPES.behaviorsWrite,
  input: object({
    behavior_id: behaviorIdInput(),
    expected_revision: revision("Revision from get_behavior. If the Behavior changed since, the call fails with `conflict` and changes nothing."),
    title: optional(behaviorTitleInput()),
    description: optional(nullable(behaviorDescriptionInput(), { description: "New description, or null to clear it." })),
    location_text: optional(nullable(locationTextInput(), { description: "New location, or null to clear it." })),
    category_id: optional(nullable(uuid(), { description: "New category id, or null for no category." })),
    schedules: optional(schedulesInput),
    reminders: optional(remindersInput),
    default_duration_minutes: optional(nullable(defaultDurationInput(), { description: "New duration in minutes, or null to clear it." })),
    end_date: optional(nullable(localDate(), { description: "New end date, or null to clear it." })),
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
    "Archives a Behavior so it schedules no new Occurrences, with an optional archive note. History, notes, and past Occurrences are kept, and restore_behavior reverses it. Nothing is deleted. Archiving an archived Behavior changes nothing.",
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
    "Restores an archived Behavior so it schedules Occurrences again from today. Archive notes are kept. Restoring an active Behavior changes nothing.",
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

/** Every operation, keyed by its published tool name. Insertion order is the `tools/list` order. */
export const INTEGRATION_OPERATIONS = Object.freeze({
  get_account_context: getAccountContext,
  list_behaviors: listBehaviors,
  get_behavior: getBehavior,
  list_categories: listCategories,
  get_timeline: getTimeline,
  list_occurrences: listOccurrences,
  get_occurrence: getOccurrence,
  get_adherence_summary: getAdherenceSummary,
  search,
  "fetch": fetchRecord,
  set_occurrence_status: setOccurrenceStatus,
  update_occurrence_note: updateOccurrenceNote,
  create_behavior: createBehavior,
  update_behavior: updateBehavior,
  archive_behavior: archiveBehavior,
  restore_behavior: restoreBehavior,
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

/** Tool descriptor in the shape MCP `tools/list` uses. Transport-specific `_meta` is added by the endpoint. */
export type IntegrationToolDescriptor = {
  name: IntegrationOperationName;
  title: string;
  description: string;
  inputSchema: JsonSchemaObject;
  outputSchema: JsonSchemaObject;
  annotations: IntegrationToolAnnotations;
};

export function listIntegrationToolDescriptors(): IntegrationToolDescriptor[] {
  return INTEGRATION_OPERATION_NAMES.map((name) => {
    const operation: IntegrationOperation = INTEGRATION_OPERATIONS[name];
    return {
      name,
      title: operation.title,
      description: operation.description,
      inputSchema: operation.input.schema,
      outputSchema: operation.output.schema,
      annotations: { ...operation.annotations },
    };
  });
}
