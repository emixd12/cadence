import { Temporal } from "@js-temporal/polyfill";

import {
  createIntegrationError,
  insufficientScopeError,
  invalidInputError,
  responseTooLargeError,
  type IntegrationError,
} from "./errors";
import { INTEGRATION_LIMITS } from "./limits";
import {
  INTEGRATION_OPERATIONS,
  isIntegrationOperationName,
  type IntegrationOperation,
  type IntegrationOperationInput,
  type IntegrationOperationName,
  type IntegrationOperationOutput,
} from "./operations";
import { INTEGRATION_AGENT_SCOPES, type IntegrationScope } from "./scopes";
import { integrationOperationFor, type IntegrationContractOptions } from "./editions";

/** Operations that also accept the agent-only move scope. */
const MOVE_OPERATIONS: ReadonlySet<string> = new Set(["move_occurrence_for_day", "revert_occurrence_move"]);
import { validateAgainstSchema, type ValidationIssue } from "./validate";

export type IntegrationContractResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: IntegrationError; issues: ValidationIssue[] };

/**
 * Validates tool input against the operation's JSON Schema, then applies the
 * cross-field rules JSON Schema cannot express (date-range order and caps,
 * custom time ranges with distinct ends). `options` selects the contract edition
 * (`editions.ts`); without them the published contract applies.
 */
export function validateOperationInput<N extends IntegrationOperationName>(
  name: N,
  value: unknown,
  options: IntegrationContractOptions = {},
): IntegrationContractResult<IntegrationOperationInput<N>> {
  const operation: IntegrationOperation = integrationOperationFor(name, options);
  const result = validateAgainstSchema<IntegrationOperationInput<N>>(operation.input.schema, value);
  if (!result.ok) return { ok: false, error: invalidInputError(result.issues), issues: result.issues };

  const record = value as Record<string, unknown>;
  const issues: ValidationIssue[] = [];
  checkTimeRanges(record.schedules, issues);
  if (name === "create_behavior" || name === "update_behavior") checkEmptySchedules(name, record, issues);
  if (name === "add_opportunity_occurrence") checkOpportunityPlacement(record, issues);
  if (Array.isArray(record.sub_behaviors)) {
    record.sub_behaviors.forEach((item, index) =>
      checkTimeRanges((item as { schedules?: unknown }).schedules, issues, `$.sub_behaviors[${index}]`));
  }
  checkSubBehaviorRules(name, record, issues);
  if (issues.length) return { ok: false, error: invalidInputError(issues), issues };

  const maxRange = name === "list_occurrences"
    ? INTEGRATION_LIMITS.maxOccurrenceRangeDays
    : name === "list_day_notes"
      ? INTEGRATION_LIMITS.maxDayNoteRangeDays
    : name === "get_adherence_summary"
      ? INTEGRATION_LIMITS.maxAdherenceRangeDays
      : null;
  if (maxRange !== null) {
    const rangeError = checkDateRange(record.start_local_date as string, record.end_local_date as string, maxRange);
    if (rangeError) return rangeError;
  }
  return { ok: true, value: result.value };
}

/** Validates a handler result. A failure is a server bug and maps to `internal_error`. */
export function validateOperationOutput<N extends IntegrationOperationName>(
  name: N,
  value: unknown,
  options: IntegrationContractOptions = {},
): IntegrationContractResult<IntegrationOperationOutput<N>> {
  const operation: IntegrationOperation = integrationOperationFor(name, options);
  const result = validateAgainstSchema<IntegrationOperationOutput<N>>(operation.output.schema, value);
  if (!result.ok) {
    return {
      ok: false,
      error: createIntegrationError("internal_error", "Cadence produced a result that does not match the tool's output schema. Nothing is assumed to have changed."),
      issues: result.issues,
    };
  }
  const bytes = utf8Length(JSON.stringify(value));
  if (bytes > INTEGRATION_LIMITS.maxResponseBytes) {
    return {
      ok: false,
      error: responseTooLargeError(),
      issues: [{ path: "$", keyword: "maxResponseBytes", message: `is ${bytes} bytes` }],
    };
  }
  return { ok: true, value: result.value };
}

export function requiredScopeFor(name: IntegrationOperationName): IntegrationScope {
  return INTEGRATION_OPERATIONS[name].scope;
}

/** Returns an `insufficient_scope` error when the granted scopes do not cover the operation. */
export function checkOperationScope(
  name: IntegrationOperationName,
  grantedScopes: readonly string[],
): IntegrationError | null {
  const required = requiredScopeFor(name);
  if (grantedScopes.includes(required)) return null;
  // Per-day moves also run for agents that hold only the move scope.
  if (MOVE_OPERATIONS.has(name) && grantedScopes.includes(INTEGRATION_AGENT_SCOPES.occurrencesMove)) return null;
  return insufficientScopeError(required, name);
}

/** Validates an operation name from an untrusted request. */
export function resolveOperationName(value: unknown): IntegrationContractResult<IntegrationOperationName> {
  if (isIntegrationOperationName(value)) return { ok: true, value };
  const issues = [{ path: "$.name", keyword: "enum", message: "is not a Cadence tool" }];
  return { ok: false, error: createIntegrationError("invalid_input", "Unknown Cadence tool name.", { fieldErrors: issues }), issues };
}

function checkDateRange(
  start: string,
  end: string,
  maxDays: number,
): { ok: false; error: IntegrationError; issues: ValidationIssue[] } | null {
  const startDate = Temporal.PlainDate.from(start, { overflow: "reject" });
  const endDate = Temporal.PlainDate.from(end, { overflow: "reject" });
  if (Temporal.PlainDate.compare(endDate, startDate) < 0) {
    const issues = [{ path: "$.end_local_date", keyword: "dateRange", message: "must be on or after start_local_date" }];
    return { ok: false, error: invalidInputError(issues), issues };
  }
  const days = startDate.until(endDate, { largestUnit: "days" }).days + 1;
  if (days > maxDays) {
    const issues = [{ path: "$.end_local_date", keyword: "maxRangeDays", message: `range covers ${days} days; the limit is ${maxDays}` }];
    return {
      ok: false,
      error: createIntegrationError("limit_exceeded", `The date range covers ${days} days. Request at most ${maxDays} days at a time.`, {
        fieldErrors: issues,
      }),
      issues,
    };
  }
  return null;
}

/**
 * Sub-behavior rules (contract 1.7.0): one level deep, and a sub-behavior either follows
 * its parent's schedule (no `schedules`) or has its own (`inherit_parent_schedule` false).
 */
function checkSubBehaviorRules(name: IntegrationOperationName, record: Record<string, unknown>, issues: ValidationIssue[]): void {
  const issue = (path: string, keyword: string, message: string) => issues.push({ path, keyword, message });
  const checkSchedules = (item: Record<string, unknown>, at: string) => {
    const inherits = item.inherit_parent_schedule !== false;
    if (inherits && item.schedules !== undefined) {
      issue(`${at}.schedules`, "inheritParentSchedule", "must be omitted while the sub-behavior follows its parent's schedule; set inherit_parent_schedule to false to give it its own");
    }
    if (!inherits && item.schedules === undefined) {
      issue(`${at}.schedules`, "required", "is required when inherit_parent_schedule is false");
    }
  };
  if (name === "create_behavior") {
    const hasParent = typeof record.parent_behavior_id === "string";
    if (hasParent && record.sub_behaviors !== undefined) {
      issue("$.sub_behaviors", "maxDepth", "is not allowed with parent_behavior_id: a sub-behavior can't have sub-behaviors");
    }
    if (hasParent) checkSchedules(record, "$");
    for (const key of ["inherit_parent_schedule", "sub_behavior_sort_order"] as const) {
      if (!hasParent && record[key] !== undefined) issue(`$.${key}`, "requiresParent", "needs parent_behavior_id");
    }
    if (Array.isArray(record.sub_behaviors)) {
      const refs = new Set<string>(typeof record.external_ref === "string" ? [record.external_ref] : []);
      record.sub_behaviors.forEach((item, index) => {
        const value = item as Record<string, unknown>;
        checkSchedules(value, `$.sub_behaviors[${index}]`);
        if (typeof value.external_ref === "string") {
          if (refs.has(value.external_ref)) issue(`$.sub_behaviors[${index}].external_ref`, "uniqueItems", "repeats another external_ref in this call");
          refs.add(value.external_ref);
        }
      });
    }
  }
  // Behaviors of Opportunity: an opportunity Behavior is never part of a routine.
  if ((name === "create_behavior" || name === "update_behavior") && record.is_opportunity === true) {
    if (typeof record.parent_behavior_id === "string") {
      issue("$.is_opportunity", "opportunityRoutine", "is not allowed with parent_behavior_id: an opportunity Behavior can't be part of a routine");
    }
    if (record.sub_behaviors !== undefined) {
      issue("$.is_opportunity", "opportunityRoutine", "is not allowed with sub_behaviors: an opportunity Behavior can't be part of a routine");
    }
  }
  if (name === "update_behavior") {
    if (record.parent_behavior_id !== undefined && record.parent_behavior_id === record.behavior_id) {
      issue("$.parent_behavior_id", "selfParent", "must name another Behavior");
    }
    if (record.inherit_parent_schedule === true && record.schedules !== undefined) {
      issue("$.schedules", "inheritParentSchedule", "must be omitted when inherit_parent_schedule is true");
    }
    if (record.parent_behavior_id === null && (record.inherit_parent_schedule !== undefined || record.sub_behavior_sort_order !== undefined)) {
      issue("$.parent_behavior_id", "requiresParent", "is null, so inherit_parent_schedule and sub_behavior_sort_order do not apply");
    }
  }
  if (name === "set_parent_occurrence_status") {
    if (record.slot_key !== undefined && record.local_date === undefined) {
      issue("$.slot_key", "requiresLocalDate", "needs local_date");
    }
    if (Array.isArray(record.expected_statuses)) {
      const seen = new Set<unknown>();
      record.expected_statuses.forEach((entry, index) => {
        const id = (entry as { occurrence_id?: unknown }).occurrence_id;
        if (seen.has(id)) issue(`$.expected_statuses[${index}].occurrence_id`, "uniqueItems", "repeats another expected status");
        seen.add(id);
      });
    }
  }
}

function checkTimeRanges(schedules: unknown, issues: ValidationIssue[], at = "$"): void {
  if (!Array.isArray(schedules)) return;
  schedules.forEach((schedule, scheduleIndex) => {
    const entries = (schedule as { time_entries?: unknown }).time_entries;
    if (!Array.isArray(entries)) return;
    entries.forEach((entry, entryIndex) => {
      const value = entry as { kind?: unknown; start_time?: unknown; end_time?: unknown };
      if (value.kind === "range" && typeof value.end_time === "string" && value.end_time === value.start_time) {
        issues.push({
          path: `${at}.schedules[${scheduleIndex}].time_entries[${entryIndex}].end_time`,
          keyword: "timeRange",
          message: "must differ from start_time",
        });
      }
    });
  });
}

/**
 * Empty schedules are allowed only for a Behavior available as an opportunity. An
 * update that leaves out is_opportunity is checked against the stored flag later.
 */
function checkEmptySchedules(name: "create_behavior" | "update_behavior", record: Record<string, unknown>, issues: ValidationIssue[]): void {
  if (!Array.isArray(record.schedules) || record.schedules.length > 0) return;
  const refused = name === "create_behavior" ? record.is_opportunity !== true : record.is_opportunity === false;
  if (refused) issues.push({ path: "$.schedules", keyword: "minItems", message: "must contain at least 1 item unless is_opportunity is true" });
}

/** One placement: start_time (with an optional end_time), a preset, or mark_completed alone. */
function checkOpportunityPlacement(record: Record<string, unknown>, issues: ValidationIssue[]): void {
  const start = typeof record.start_time === "string" ? record.start_time : null;
  const end = typeof record.end_time === "string" ? record.end_time : null;
  const preset = typeof record.preset === "string";
  if (record.mark_completed === true) {
    if (start || end || preset) issues.push({ path: "$.mark_completed", keyword: "placement", message: "takes no start_time, end_time or preset" });
    return;
  }
  if (preset && (start || end)) {
    issues.push({ path: "$.preset", keyword: "placement", message: "cannot be sent with start_time or end_time" });
    return;
  }
  if (end && !start) issues.push({ path: "$.end_time", keyword: "placement", message: "needs start_time" });
  else if (end && end === start) issues.push({ path: "$.end_time", keyword: "timeRange", message: "must differ from start_time" });
  else if (!start && !preset) issues.push({ path: "$.start_time", keyword: "placement", message: "send start_time, preset or mark_completed" });
}

function utf8Length(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}
