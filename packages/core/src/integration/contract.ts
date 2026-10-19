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
import type { IntegrationScope } from "./scopes";
import { validateAgainstSchema, type ValidationIssue } from "./validate";

export type IntegrationContractResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: IntegrationError; issues: ValidationIssue[] };

/**
 * Validates tool input against the operation's JSON Schema, then applies the
 * cross-field rules JSON Schema cannot express (date-range order and caps,
 * custom time ranges with distinct ends).
 */
export function validateOperationInput<N extends IntegrationOperationName>(
  name: N,
  value: unknown,
): IntegrationContractResult<IntegrationOperationInput<N>> {
  const operation: IntegrationOperation = INTEGRATION_OPERATIONS[name];
  const result = validateAgainstSchema<IntegrationOperationInput<N>>(operation.input.schema, value);
  if (!result.ok) return { ok: false, error: invalidInputError(result.issues), issues: result.issues };

  const record = value as Record<string, unknown>;
  const issues: ValidationIssue[] = [];
  checkTimeRanges(record.schedules, issues);
  if (issues.length) return { ok: false, error: invalidInputError(issues), issues };

  const maxRange = name === "list_occurrences"
    ? INTEGRATION_LIMITS.maxOccurrenceRangeDays
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
): IntegrationContractResult<IntegrationOperationOutput<N>> {
  const operation: IntegrationOperation = INTEGRATION_OPERATIONS[name];
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
  return grantedScopes.includes(required) ? null : insufficientScopeError(required, name);
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

function checkTimeRanges(schedules: unknown, issues: ValidationIssue[]): void {
  if (!Array.isArray(schedules)) return;
  schedules.forEach((schedule, scheduleIndex) => {
    const entries = (schedule as { time_entries?: unknown }).time_entries;
    if (!Array.isArray(entries)) return;
    entries.forEach((entry, entryIndex) => {
      const value = entry as { kind?: unknown; start_time?: unknown; end_time?: unknown };
      if (value.kind === "range" && typeof value.end_time === "string" && value.end_time === value.start_time) {
        issues.push({
          path: `$.schedules[${scheduleIndex}].time_entries[${entryIndex}].end_time`,
          keyword: "timeRange",
          message: "must differ from start_time",
        });
      }
    });
  });
}

function utf8Length(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}
