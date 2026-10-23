import { Temporal } from "@js-temporal/polyfill";

import { sha256 } from "../hash";
import type { ExternalEventErrorCode } from "../types/external-event";
import {
  HEVY_WORKOUTS_ADAPTER_VERSION,
  RECORDED_ACTIVITY_MAX_ITEMS,
  RECORDED_ACTIVITY_MAX_PAGES,
  RECORDED_ACTIVITY_MAX_RANGE_DAYS,
  RECORDED_ACTIVITY_PAGE_SIZE,
  RECORDED_ACTIVITY_SCHEMA_VERSION,
  RECORDED_ACTIVITY_SOURCE,
  type RecordedActivity,
  type RecordedActivityNormalizationResult,
  type RecordedActivityRequestedRange,
  type RecordedActivitySnapshotScope,
  type RecordedActivitySnapshotV1,
  type RecordedWorkoutTimingInput,
} from "../types/recorded-activity";

const ERROR_CODES: readonly ExternalEventErrorCode[] = [
  "unauthenticated", "not_connected", "permission_denied", "wrong_account",
  "reconnect_required", "rate_limited", "provider_unavailable", "timeout",
  "malformed_provider_response", "incomplete_pagination", "invalid_request",
  "unsupported_schema_version",
];
const ACTIVITY_ID = /^hevy\/[0-9a-f]{64}$/u;

export type RecordedActivityValidationErrorCode =
  | "unsupported_schema_version"
  | "malformed_provider_response";

export class RecordedActivityValidationError extends Error {
  constructor(
    public readonly path: string,
    message: string,
    public readonly code: RecordedActivityValidationErrorCode = "malformed_provider_response",
  ) {
    super(`${path}: ${message}`);
    this.name = "RecordedActivityValidationError";
  }
}

/** Opaque account-scoped ID; the provider workout ID never leaves the adapter. */
export function recordedActivityId(input: Readonly<{
  accountId: string;
  providerWorkoutId: string;
}>): string {
  if (!input.accountId || !input.providerWorkoutId) {
    fail("id", "account and provider workout IDs are required");
  }
  return `${RECORDED_ACTIVITY_SOURCE}/${sha256(
    `${RECORDED_ACTIVITY_SOURCE}\0${input.accountId}\0${input.providerWorkoutId}`,
  )}`;
}

/**
 * Converts discarded-down provider timing into one recorded activity. Malformed,
 * open-ended, reversed, or future intervals are quarantined; they never become
 * claimed workouts. `fetchedAt` is the injected read time.
 */
export function normalizeRecordedWorkout(
  input: RecordedWorkoutTimingInput,
  context: Readonly<{
    accountId: string;
    requestedRange: RecordedActivityRequestedRange;
    fetchedAt: string;
  }>,
): RecordedActivityNormalizationResult {
  const fetchedAt = instant(context.fetchedAt, "fetchedAt");
  const range = rangeBounds(context.requestedRange);
  if (typeof input.providerWorkoutId !== "string" || input.providerWorkoutId.length === 0
    || input.providerWorkoutId.length > 512) {
    return { status: "quarantined", reason: "missing_identity" };
  }
  const start = parseProviderInstant(input.startTime);
  if (!start) return { status: "quarantined", reason: "malformed_start" };
  if (input.endTime === null || input.endTime === undefined) {
    return { status: "quarantined", reason: "end_unknown" };
  }
  const end = parseProviderInstant(input.endTime);
  if (!end) return { status: "quarantined", reason: "malformed_end" };
  if (Temporal.Instant.compare(end, start) <= 0) {
    return { status: "quarantined", reason: "reversed_interval" };
  }
  if (Temporal.Instant.compare(end, fetchedAt) > 0) {
    return { status: "quarantined", reason: "future_interval" };
  }
  let providerUpdatedAt: string | null = null;
  if (input.updatedAt !== null && input.updatedAt !== undefined) {
    const updated = parseProviderInstant(input.updatedAt);
    if (!updated) return { status: "quarantined", reason: "malformed_revision" };
    providerUpdatedAt = updated.toString();
  }
  if (Temporal.Instant.compare(start, range.end) >= 0 || Temporal.Instant.compare(end, range.start) <= 0) {
    return { status: "outside_range" };
  }
  return {
    status: "accepted",
    activity: {
      id: recordedActivityId({ accountId: context.accountId, providerWorkoutId: input.providerWorkoutId }),
      kind: "workout",
      startAt: start.toString(),
      endAt: end.toString(),
      duration: { kind: "known", seconds: start.until(end).total({ unit: "seconds" }) },
      localStartDate: start.toZonedDateTimeISO(context.requestedRange.timezone).toPlainDate().toString(),
      revision: providerUpdatedAt === null
        ? { availability: "unavailable", providerUpdatedAt: null }
        : { availability: "available", providerUpdatedAt },
      fieldAvailability: { location: "unsupported", sourceTimezone: "unsupported" },
    },
  };
}

/** `now` is injected; snapshots fetched after it or containing later activity are rejected. */
export function validateRecordedActivitySnapshot(
  value: unknown,
  options: Readonly<{ now: Temporal.Instant }>,
): RecordedActivitySnapshotV1 {
  const snapshot = object(value, "$snapshot");
  exactKeys(snapshot, "$snapshot", [
    "schemaVersion", "adapterVersion", "source", "accountId", "connectionGeneration",
    "requestedRange", "fetchedAt", "completeness", "coverage", "failures", "activities",
  ]);
  literal(snapshot.schemaVersion, RECORDED_ACTIVITY_SCHEMA_VERSION, "schemaVersion", "unsupported_schema_version");
  literal(snapshot.adapterVersion, HEVY_WORKOUTS_ADAPTER_VERSION, "adapterVersion", "unsupported_schema_version");
  literal(snapshot.source, RECORDED_ACTIVITY_SOURCE, "source", "unsupported_schema_version");
  nonEmptyString(snapshot.accountId, "accountId");
  integer(snapshot.connectionGeneration, "connectionGeneration", 1);

  const requestedRange = object(snapshot.requestedRange, "requestedRange");
  exactKeys(requestedRange, "requestedRange", ["startLocalDate", "endLocalDate", "timezone"]);
  const range = rangeBounds(requestedRange);

  const fetchedAt = instant(snapshot.fetchedAt, "fetchedAt");
  if (Temporal.Instant.compare(fetchedAt, options.now) > 0) {
    fail("fetchedAt", "cannot be in the future");
  }
  const fetchedLocalDate = fetchedAt.toZonedDateTimeISO(range.timezone).toPlainDate();
  if (Temporal.PlainDate.compare(range.endDate, fetchedLocalDate) > 0) {
    fail("requestedRange.endLocalDate", "cannot follow the local fetch date");
  }

  const completeness = oneOf(snapshot.completeness, ["complete", "incomplete"], "completeness");
  const coverage = validateCoverage(snapshot.coverage);
  const failures = array(snapshot.failures, "failures");
  failures.forEach((entry, index) => validateFailure(entry, `failures[${index}]`));
  if (completeness === "complete") {
    if (failures.length > 0) fail("completeness", "complete snapshots cannot contain failures");
    if (!coverage.paginationComplete || coverage.countBefore === null
      || coverage.countBefore !== coverage.countAfter
      || coverage.countBefore > RECORDED_ACTIVITY_MAX_ITEMS
      || coverage.itemCount !== coverage.countBefore) {
      fail("coverage", "complete snapshots require complete pagination and unchanged matching counts");
    }
  } else if (failures.length === 0) {
    fail("failures", "incomplete snapshots require a stable failure");
  }

  const activities = array(snapshot.activities, "activities");
  if (activities.length > coverage.itemCount) {
    fail("activities", "cannot exceed coverage.itemCount");
  }
  const ids = new Set<string>();
  activities.forEach((entry, index) => {
    const activity = validateActivity(entry, `activities[${index}]`, range, fetchedAt);
    if (ids.has(activity.id)) fail(`activities[${index}].id`, "must be unique");
    ids.add(activity.id);
  });
  return value as RecordedActivitySnapshotV1;
}

export function recordedActivitySnapshotScopeKey(scope: RecordedActivitySnapshotScope): string {
  return JSON.stringify([
    scope.source,
    scope.accountId,
    scope.connectionGeneration,
    scope.startLocalDate,
    scope.endLocalDate,
    scope.timezone,
  ]);
}

export function recordedActivitySnapshotMatchesScope(
  snapshot: RecordedActivitySnapshotV1,
  scope: RecordedActivitySnapshotScope,
): boolean {
  return recordedActivitySnapshotScopeKey({
    source: snapshot.source,
    accountId: snapshot.accountId,
    connectionGeneration: snapshot.connectionGeneration,
    startLocalDate: snapshot.requestedRange.startLocalDate,
    endLocalDate: snapshot.requestedRange.endLocalDate,
    timezone: snapshot.requestedRange.timezone,
  }) === recordedActivitySnapshotScopeKey(scope);
}

type RangeBounds = Readonly<{
  timezone: string;
  startDate: Temporal.PlainDate;
  endDate: Temporal.PlainDate;
  start: Temporal.Instant;
  end: Temporal.Instant;
}>;

function rangeBounds(value: Record<string, unknown> | RecordedActivityRequestedRange): RangeBounds {
  const startDate = date(value.startLocalDate, "requestedRange.startLocalDate");
  const endDate = date(value.endLocalDate, "requestedRange.endLocalDate");
  if (Temporal.PlainDate.compare(endDate, startDate) < 0) {
    fail("requestedRange.endLocalDate", "must be on or after startLocalDate");
  }
  if (startDate.until(endDate).days + 1 > RECORDED_ACTIVITY_MAX_RANGE_DAYS) {
    fail("requestedRange", `cannot exceed ${RECORDED_ACTIVITY_MAX_RANGE_DAYS} days`);
  }
  const zone = timezone(value.timezone, "requestedRange.timezone");
  return {
    timezone: zone,
    startDate,
    endDate,
    start: startDate.toZonedDateTime({ timeZone: zone }).toInstant(),
    end: endDate.add({ days: 1 }).toZonedDateTime({ timeZone: zone }).toInstant(),
  };
}

function validateCoverage(value: unknown): RecordedActivitySnapshotV1["coverage"] {
  const coverage = object(value, "coverage");
  exactKeys(coverage, "coverage", [
    "pagesRead", "pageCount", "countBefore", "countAfter", "itemCount",
    "duplicatesRemoved", "paginationComplete",
  ]);
  const pagesRead = integer(coverage.pagesRead, "coverage.pagesRead", 0);
  if (pagesRead > RECORDED_ACTIVITY_MAX_PAGES) {
    fail("coverage.pagesRead", `cannot exceed ${RECORDED_ACTIVITY_MAX_PAGES}`);
  }
  const pageCount = nullableInteger(coverage.pageCount, "coverage.pageCount");
  nullableInteger(coverage.countBefore, "coverage.countBefore");
  nullableInteger(coverage.countAfter, "coverage.countAfter");
  const itemCount = integer(coverage.itemCount, "coverage.itemCount", 0);
  const duplicatesRemoved = integer(coverage.duplicatesRemoved, "coverage.duplicatesRemoved", 0);
  if (itemCount + duplicatesRemoved > pagesRead * RECORDED_ACTIVITY_PAGE_SIZE) {
    fail("coverage.itemCount", "cannot exceed the items available on the pages read");
  }
  const paginationComplete = boolean(coverage.paginationComplete, "coverage.paginationComplete");
  if (paginationComplete && (pageCount === null || pagesRead !== pageCount)) {
    fail("coverage.paginationComplete", "requires every provider page to be read");
  }
  return coverage as RecordedActivitySnapshotV1["coverage"];
}

function validateFailure(value: unknown, path: string): void {
  const failure = object(value, path);
  exactKeys(failure, path, ["code", "retryable", "retryAfterSeconds", "message"]);
  oneOf(failure.code, ERROR_CODES, `${path}.code`);
  boolean(failure.retryable, `${path}.retryable`);
  nullableInteger(failure.retryAfterSeconds, `${path}.retryAfterSeconds`);
  nonEmptyString(failure.message, `${path}.message`);
}

function validateActivity(
  value: unknown,
  path: string,
  range: RangeBounds,
  fetchedAt: Temporal.Instant,
): RecordedActivity {
  const activity = object(value, path);
  exactKeys(activity, path, [
    "id", "kind", "startAt", "endAt", "duration", "localStartDate", "revision", "fieldAvailability",
  ]);
  if (!ACTIVITY_ID.test(nonEmptyString(activity.id, `${path}.id`))) {
    fail(`${path}.id`, "must be an opaque hevy/ activity ID");
  }
  literal(activity.kind, "workout", `${path}.kind`);
  const start = instant(activity.startAt, `${path}.startAt`);
  const end = instant(activity.endAt, `${path}.endAt`);
  if (Temporal.Instant.compare(end, start) <= 0) fail(`${path}.endAt`, "must be after startAt");
  if (Temporal.Instant.compare(end, fetchedAt) > 0) fail(`${path}.endAt`, "cannot follow fetchedAt");
  if (Temporal.Instant.compare(start, range.end) >= 0 || Temporal.Instant.compare(end, range.start) <= 0) {
    fail(path, "must intersect the requested local days");
  }
  const duration = object(activity.duration, `${path}.duration`);
  exactKeys(duration, `${path}.duration`, ["kind", "seconds"]);
  literal(duration.kind, "known", `${path}.duration.kind`);
  if (duration.seconds !== start.until(end).total({ unit: "seconds" })) {
    fail(`${path}.duration.seconds`, "must equal endAt minus startAt");
  }
  const localStart = start.toZonedDateTimeISO(range.timezone).toPlainDate().toString();
  literal(activity.localStartDate, localStart, `${path}.localStartDate`);
  const revision = object(activity.revision, `${path}.revision`);
  exactKeys(revision, `${path}.revision`, ["availability", "providerUpdatedAt"]);
  const availability = oneOf(revision.availability, ["available", "unavailable"], `${path}.revision.availability`);
  if (revision.providerUpdatedAt === null) {
    if (availability !== "unavailable") fail(`${path}.revision.availability`, "must match revision metadata presence");
  } else {
    instant(revision.providerUpdatedAt, `${path}.revision.providerUpdatedAt`);
    if (availability !== "available") fail(`${path}.revision.availability`, "must match revision metadata presence");
  }
  const fields = object(activity.fieldAvailability, `${path}.fieldAvailability`);
  exactKeys(fields, `${path}.fieldAvailability`, ["location", "sourceTimezone"]);
  literal(fields.location, "unsupported", `${path}.fieldAvailability.location`);
  literal(fields.sourceTimezone, "unsupported", `${path}.fieldAvailability.sourceTimezone`);
  return value as RecordedActivity;
}

function parseProviderInstant(value: unknown): Temporal.Instant | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) return null;
  try {
    return Temporal.Instant.from(value);
  } catch {
    return null;
  }
}

function exactKeys(value: Record<string, unknown>, path: string, keys: readonly string[]): void {
  const expected = new Set(keys);
  const actual = Object.keys(value);
  if (actual.length !== expected.size || actual.some((key) => !expected.has(key))) {
    fail(path, `must contain exactly: ${keys.join(", ")}`);
  }
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(path, "must be an object");
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, "must be an array");
  return value;
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) fail(path, "must be a non-empty string");
  return value;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") fail(path, "must be a boolean");
  return value;
}

function integer(value: unknown, path: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    fail(path, `must be an integer greater than or equal to ${minimum}`);
  }
  return value as number;
}

function nullableInteger(value: unknown, path: string): number | null {
  return value === null ? null : integer(value, path, 0);
}

function literal<T extends string>(
  value: unknown,
  expected: T,
  path: string,
  code?: RecordedActivityValidationErrorCode,
): T {
  if (value !== expected) fail(path, `must equal ${expected}`, code);
  return expected;
}

function oneOf<const T extends readonly string[]>(value: unknown, expected: T, path: string): T[number] {
  if (typeof value !== "string" || !expected.includes(value)) {
    fail(path, `must be one of ${expected.join(", ")}`);
  }
  return value as T[number];
}

function timezone(value: unknown, path: string): string {
  const text = nonEmptyString(value, path);
  try {
    Temporal.Instant.from("2026-01-01T00:00:00Z").toZonedDateTimeISO(text);
  } catch {
    fail(path, "must be a valid IANA timezone");
  }
  return text;
}

function date(value: unknown, path: string): Temporal.PlainDate {
  try {
    const parsed = Temporal.PlainDate.from(nonEmptyString(value, path));
    if (parsed.toString() !== value) fail(path, "must use YYYY-MM-DD");
    return parsed;
  } catch (error) {
    if (error instanceof RecordedActivityValidationError) throw error;
    fail(path, "must be a valid date");
  }
}

function instant(value: unknown, path: string): Temporal.Instant {
  try {
    const source = nonEmptyString(value, path);
    const parsed = Temporal.Instant.from(source);
    if (parsed.toString() !== source) fail(path, "must be a canonical UTC instant");
    return parsed;
  } catch (error) {
    if (error instanceof RecordedActivityValidationError) throw error;
    fail(path, "must be a valid instant");
  }
}

function fail(path: string, message: string, code?: RecordedActivityValidationErrorCode): never {
  throw new RecordedActivityValidationError(path, message, code);
}
