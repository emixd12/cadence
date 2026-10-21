import { Temporal } from "@js-temporal/polyfill";

import type {
  ExternalEventDetailCompleteness,
  ExternalEventFieldAvailability,
  ExternalEventOriginalStart,
  ExternalEventRevision,
  ExternalEventSource,
  NormalizedExternalEvent,
} from "../types/day-progress";
import {
  EXTERNAL_EVENT_ADAPTER_VERSION,
  EXTERNAL_EVENT_CAPABILITIES,
  EXTERNAL_EVENT_MAX_CALENDARS,
  EXTERNAL_EVENT_MAX_RANGE_DAYS,
  EXTERNAL_EVENT_SCHEMA_VERSION,
  EXTERNAL_EVENT_SOURCE_VERSIONS,
  type ExternalEventCancellationTombstone,
  type ExternalEventSnapshotScope,
  type ExternalEventSnapshotV1,
  type VersionedExternalEventSnapshot,
} from "../types/external-event";

const FIELD_AVAILABILITY = new Set<ExternalEventFieldAvailability>([
  "not_provided",
  "restricted",
  "provider_omitted",
  "unsupported",
  "unknown",
]);
const DETAIL_COMPLETENESS = new Set<ExternalEventDetailCompleteness>([
  "complete",
  "provider_omitted",
  "client_truncated",
  "restricted",
  "unsupported",
  "unknown",
]);
const EVENT_FIELDS = new Set([
  "title",
  "description",
  "location",
  "source_url",
  "organizer",
  "attendees",
  "conference",
  "recurrence",
  "attachments",
]);
const DETAIL_FIELDS = new Set([
  "attendees",
  "conference_entry_points",
  "attachments",
]);
const EVENT_BASE_KEYS = [
  "id", "providerEventId", "logicalInstanceId", "calendarId", "source",
  "calendarName", "sourceTimezone", "sourceTimezoneFallback", "state",
  "availability", "currentUserResponse", "revision", "title", "description",
  "location", "sourceUrl", "fieldAvailability", "detailCompleteness",
  "organizer", "attendees", "attendeesOmitted", "conference", "recurrence",
  "attachments",
] as const;

export type ExternalEventValidationErrorCode =
  | "unsupported_schema_version"
  | "malformed_provider_response";

export class ExternalEventValidationError extends Error {
  constructor(
    public readonly path: string,
    message: string,
    public readonly code: ExternalEventValidationErrorCode = "malformed_provider_response",
  ) {
    super(`${path}: ${message}`);
    this.name = "ExternalEventValidationError";
  }
}

const V1_1_SOURCES = new Set<ExternalEventSource>(["outlook_calendar", "icloud_calendar"]);
const V1_1_UNSUPPORTED_DETAILS = [
  "description", "location", "organizer", "attendees", "conference", "attachments",
] as const;

/**
 * Exact Google `1.0.0` entry point. Older desktop caches and every existing
 * Google route keep using it; it rejects `1.1.0` snapshots.
 */
export function validateExternalEventSnapshot(
  value: unknown,
): ExternalEventSnapshotV1 {
  return validateSnapshot(value, "google_only") as ExternalEventSnapshotV1;
}

/**
 * Accepts `1.0.0` only with Google literals and `1.1.0` only with Outlook or
 * iCloud literals. Every other combination fails as `unsupported_schema_version`.
 */
export function validateVersionedExternalEventSnapshot(
  value: unknown,
): VersionedExternalEventSnapshot {
  return validateSnapshot(value, "versioned");
}

/** Source-namespaced normalized identity, matching the Google `source/part/part` form. */
export function externalEventNormalizedId(
  source: ExternalEventSource,
  parts: readonly [string, ...string[]],
): string {
  if (parts.some((part) => part.length === 0)) {
    throw new ExternalEventValidationError("id", "identity parts must not be empty");
  }
  return [source, ...parts.map((part) => encodeURIComponent(part))].join("/");
}

export function externalEventSnapshotScope(
  snapshot: VersionedExternalEventSnapshot,
): ExternalEventSnapshotScope {
  return {
    source: snapshot.source,
    accountId: snapshot.accountId,
    connectionGeneration: snapshot.connectionGeneration,
    startLocalDate: snapshot.requestedRange.startLocalDate,
    endLocalDate: snapshot.requestedRange.endLocalDate,
    timezone: snapshot.requestedRange.timezone,
    selectedCalendarIds: snapshot.requestedRange.selectedCalendarIds,
  };
}

/** Cache key: one source's snapshot can never satisfy or clear another source's cache. */
export function externalEventSnapshotScopeKey(scope: ExternalEventSnapshotScope): string {
  return JSON.stringify([
    scope.source,
    scope.accountId,
    scope.connectionGeneration,
    scope.startLocalDate,
    scope.endLocalDate,
    scope.timezone,
    [...scope.selectedCalendarIds].sort(),
  ]);
}

export function externalEventSnapshotMatchesScope(
  snapshot: VersionedExternalEventSnapshot,
  scope: ExternalEventSnapshotScope,
): boolean {
  return externalEventSnapshotScopeKey(externalEventSnapshotScope(snapshot))
    === externalEventSnapshotScopeKey(scope);
}

function validateSnapshot(
  value: unknown,
  mode: "google_only" | "versioned",
): VersionedExternalEventSnapshot {
  const snapshot = object(value, "$snapshot");
  exactKeys(snapshot, "$snapshot", [
    "schemaVersion", "adapterVersion", "accountId", "connectionGeneration",
    "source", "requestedRange", "fetchedAt", "completeness", "freshness",
    "capabilities", "coverage", "failures", "events", "tombstones",
  ]);
  const source = mode === "google_only"
    ? validateGoogleVersion(snapshot)
    : validateSourceVersion(snapshot);
  nonEmptyString(snapshot.accountId, "accountId");
  integer(snapshot.connectionGeneration, "connectionGeneration", 1);

  const requestedRange = object(snapshot.requestedRange, "requestedRange");
  exactKeys(requestedRange, "requestedRange", [
    "startLocalDate", "endLocalDate", "timezone", "selectedCalendarIds",
  ]);
  const rangeStart = date(requestedRange.startLocalDate, "requestedRange.startLocalDate");
  const rangeEnd = date(requestedRange.endLocalDate, "requestedRange.endLocalDate");
  if (Temporal.PlainDate.compare(rangeEnd, rangeStart) < 0) {
    fail("requestedRange.endLocalDate", "must be on or after startLocalDate");
  }
  if (rangeStart.until(rangeEnd).days + 1 > EXTERNAL_EVENT_MAX_RANGE_DAYS) {
    fail("requestedRange", `cannot exceed ${EXTERNAL_EVENT_MAX_RANGE_DAYS} days`);
  }
  timezone(requestedRange.timezone, "requestedRange.timezone");
  const selectedCalendarIds = stringArray(
    requestedRange.selectedCalendarIds,
    "requestedRange.selectedCalendarIds",
    EXTERNAL_EVENT_MAX_CALENDARS,
  );
  unique(selectedCalendarIds, "requestedRange.selectedCalendarIds");
  if (selectedCalendarIds.length === 0) {
    fail("requestedRange.selectedCalendarIds", "must contain at least one calendar");
  }

  instant(snapshot.fetchedAt, "fetchedAt");
  oneOf(snapshot.completeness, ["complete", "incomplete"], "completeness");
  validateFreshness(snapshot.freshness, snapshot.completeness);
  validateCapabilities(snapshot.capabilities);

  const coverage = array(snapshot.coverage, "coverage");
  const coveredCalendars = new Set<string>();
  for (let index = 0; index < coverage.length; index += 1) {
    const item = object(coverage[index], `coverage[${index}]`);
    exactKeys(item, `coverage[${index}]`, [
      "calendarId", "startLocalDate", "endLocalDate", "paginationComplete", "itemCount",
    ]);
    const calendarId = nonEmptyString(item.calendarId, `coverage[${index}].calendarId`);
    if (!selectedCalendarIds.includes(calendarId) || coveredCalendars.has(calendarId)) {
      fail(`coverage[${index}].calendarId`, "must identify one selected calendar exactly once");
    }
    coveredCalendars.add(calendarId);
    literal(item.startLocalDate, rangeStart.toString(), `coverage[${index}].startLocalDate`);
    literal(item.endLocalDate, rangeEnd.toString(), `coverage[${index}].endLocalDate`);
    boolean(item.paginationComplete, `coverage[${index}].paginationComplete`);
    integer(item.itemCount, `coverage[${index}].itemCount`, 0);
  }

  const failures = array(snapshot.failures, "failures");
  failures.forEach((value, index) => validateFailure(value, `failures[${index}]`));
  if (snapshot.completeness === "complete") {
    if (failures.length > 0 || coveredCalendars.size !== selectedCalendarIds.length) {
      fail("completeness", "complete snapshots require complete coverage and no failures");
    }
    if (coverage.some((value) => !object(value, "coverage item").paginationComplete)) {
      fail("coverage", "complete snapshots require complete pagination");
    }
  }

  const events = array(snapshot.events, "events");
  const eventIds = new Set<string>();
  for (let index = 0; index < events.length; index += 1) {
    const event = validateEvent(events[index], `events[${index}]`, source);
    if (!selectedCalendarIds.includes(event.calendarId) || eventIds.has(event.id)) {
      fail(`events[${index}].id`, "must be unique and belong to a selected calendar");
    }
    eventIds.add(event.id);
  }

  const tombstones = array(snapshot.tombstones, "tombstones");
  const tombstoneIds = new Set<string>();
  for (let index = 0; index < tombstones.length; index += 1) {
    const tombstone = validateTombstone(tombstones[index], `tombstones[${index}]`, source);
    if (!selectedCalendarIds.includes(tombstone.calendarId) || tombstoneIds.has(tombstone.id)) {
      fail(`tombstones[${index}].id`, "must be unique and belong to a selected calendar");
    }
    tombstoneIds.add(tombstone.id);
  }

  return value as VersionedExternalEventSnapshot;
}

function validateGoogleVersion(snapshot: Record<string, unknown>): ExternalEventSource {
  literal(snapshot.schemaVersion, EXTERNAL_EVENT_SCHEMA_VERSION, "schemaVersion", "unsupported_schema_version");
  literal(snapshot.adapterVersion, EXTERNAL_EVENT_ADAPTER_VERSION, "adapterVersion", "unsupported_schema_version");
  literal(snapshot.source, "google_calendar", "source", "unsupported_schema_version");
  return "google_calendar";
}

function validateSourceVersion(snapshot: Record<string, unknown>): ExternalEventSource {
  const versions = EXTERNAL_EVENT_SOURCE_VERSIONS as Readonly<Record<string, Readonly<{
    schemaVersion: string;
    adapterVersion: string;
  }>>>;
  const source = typeof snapshot.source === "string" && Object.hasOwn(versions, snapshot.source)
    ? snapshot.source as ExternalEventSource
    : null;
  const expected = source ? versions[source] : null;
  if (!source || !expected || snapshot.schemaVersion !== expected.schemaVersion) {
    fail("schemaVersion", "is unsupported for this source", "unsupported_schema_version");
  }
  if (snapshot.adapterVersion !== expected.adapterVersion) {
    fail("adapterVersion", `must equal ${expected.adapterVersion} for ${source}`, "unsupported_schema_version");
  }
  return source;
}

function validateV1_1Identity(value: unknown, source: ExternalEventSource, path: string): void {
  if (!(value as string).startsWith(`${source}/`)) {
    fail(path, `must be namespaced by ${source}/`);
  }
}

/** Outlook and iCloud first slices read the subject only; every other detail is unsupported. */
function validateV1_1Event(event: Record<string, unknown>, source: ExternalEventSource, path: string): void {
  validateV1_1Identity(event.id, source, `${path}.id`);
  validateV1_1Identity(event.logicalInstanceId, source, `${path}.logicalInstanceId`);
  literal(event.description, "", `${path}.description`);
  literal(event.location, "", `${path}.location`);
  for (const key of ["organizer", "attendees", "conference", "attachments"] as const) {
    if (event[key] !== null) fail(`${path}.${key}`, "is unsupported for this source");
  }
  if (event.attendeesOmitted !== false) fail(`${path}.attendeesOmitted`, "must be false for this source");
  const availability = event.fieldAvailability as Record<string, unknown>;
  for (const field of V1_1_UNSUPPORTED_DETAILS) {
    literal(availability[field], "unsupported", `${path}.fieldAvailability.${field}`);
  }
  if (source === "outlook_calendar") {
    literal(event.state, "unknown", `${path}.state`);
  }
  if (source === "icloud_calendar") {
    if (event.sourceUrl !== null) fail(`${path}.sourceUrl`, "is unsupported for this source");
    if (event.currentUserResponse !== null) fail(`${path}.currentUserResponse`, "is unsupported for this source");
    literal(availability.source_url, "unsupported", `${path}.fieldAvailability.source_url`);
  }
}

function validateFreshness(value: unknown, completeness: unknown): void {
  const freshness = object(value, "freshness");
  exactKeys(freshness, "freshness", ["state", "refreshedAt", "label", "canAssertNoOverlap"]);
  oneOf(freshness.state, ["current", "stale", "incomplete", "unavailable"], "freshness.state");
  nullableInstant(freshness.refreshedAt, "freshness.refreshedAt");
  nonEmptyString(freshness.label, "freshness.label");
  boolean(freshness.canAssertNoOverlap, "freshness.canAssertNoOverlap");
  if (completeness === "incomplete" && freshness.state !== "incomplete") {
    fail("freshness.state", "incomplete snapshots require incomplete freshness");
  }
  if (freshness.canAssertNoOverlap !== (completeness === "complete" && freshness.state === "current")) {
    fail("freshness.canAssertNoOverlap", "is true only for complete current snapshots");
  }
}

function validateCapabilities(value: unknown): void {
  const capabilities = object(value, "capabilities");
  exactKeys(capabilities, "capabilities", EXTERNAL_EVENT_CAPABILITIES);
  for (const name of EXTERNAL_EVENT_CAPABILITIES) {
    const capability = object(capabilities[name], `capabilities.${name}`);
    exactKeys(capability, `capabilities.${name}`, ["support", "permission", "availability"]);
    oneOf(capability.support, ["supported", "unsupported", "unknown"], `capabilities.${name}.support`);
    oneOf(capability.permission, ["granted", "denied", "unknown"], `capabilities.${name}.permission`);
    oneOf(capability.availability, ["available", "degraded", "unavailable", "unknown"], `capabilities.${name}.availability`);
  }
}

function validateFailure(value: unknown, path: string): void {
  const failure = object(value, path);
  exactKeys(failure, path, ["code", "calendarId", "retryable", "retryAfterSeconds", "message"]);
  oneOf(failure.code, [
    "unauthenticated", "not_connected", "permission_denied", "wrong_account",
    "reconnect_required", "rate_limited", "provider_unavailable", "timeout",
    "malformed_provider_response", "incomplete_pagination", "invalid_request",
    "unsupported_schema_version",
  ], `${path}.code`);
  nullableString(failure.calendarId, `${path}.calendarId`);
  boolean(failure.retryable, `${path}.retryable`);
  if (failure.retryAfterSeconds !== null) {
    integer(failure.retryAfterSeconds, `${path}.retryAfterSeconds`, 0);
  }
  nonEmptyString(failure.message, `${path}.message`);
}

function validateEvent(value: unknown, path: string, source: ExternalEventSource): NormalizedExternalEvent {
  const event = object(value, path);
  nonEmptyString(event.id, `${path}.id`);
  nonEmptyString(event.providerEventId, `${path}.providerEventId`);
  nonEmptyString(event.logicalInstanceId, `${path}.logicalInstanceId`);
  nonEmptyString(event.calendarId, `${path}.calendarId`);
  literal(event.source, source, `${path}.source`);
  nonEmptyString(event.calendarName, `${path}.calendarName`);
  timezone(event.sourceTimezone, `${path}.sourceTimezone`);
  oneOf(event.sourceTimezoneFallback, ["none", "calendar", "request"], `${path}.sourceTimezoneFallback`);
  oneOf(event.state, ["confirmed", "tentative", "unknown"], `${path}.state`);
  oneOf(event.availability, ["busy", "free", "unknown"], `${path}.availability`);
  if (event.currentUserResponse !== null) {
    responseStatus(event.currentUserResponse, `${path}.currentUserResponse`);
  }
  validateRevision(event.revision, `${path}.revision`);
  string(event.title, `${path}.title`);
  string(event.description, `${path}.description`);
  string(event.location, `${path}.location`);
  nullableHttpsUrl(event.sourceUrl, `${path}.sourceUrl`);
  enumRecord(event.fieldAvailability, FIELD_AVAILABILITY, EVENT_FIELDS, `${path}.fieldAvailability`);
  enumRecord(event.detailCompleteness, DETAIL_COMPLETENESS, DETAIL_FIELDS, `${path}.detailCompleteness`);
  validateOrganizer(event.organizer, `${path}.organizer`);
  validateAttendees(event.attendees, `${path}.attendees`);
  boolean(event.attendeesOmitted, `${path}.attendeesOmitted`);
  validateConference(event.conference, `${path}.conference`);
  validateRecurrence(event.recurrence, `${path}.recurrence`);
  validateAttachments(event.attachments, `${path}.attachments`);
  if (V1_1_SOURCES.has(source)) validateV1_1Event(event, source, path);

  if (event.kind === "timed") {
    exactKeys(event, path, [...EVENT_BASE_KEYS, "kind", "startAt", "endAt", "endUnspecified", "duration"]);
    const start = instant(event.startAt, `${path}.startAt`);
    const end = instant(event.endAt, `${path}.endAt`);
    if (Temporal.Instant.compare(end, start) <= 0) {
      fail(`${path}.endAt`, "must be after startAt");
    }
    boolean(event.endUnspecified, `${path}.endUnspecified`);
    const duration = object(event.duration, `${path}.duration`);
    if (event.endUnspecified) {
      exactKeys(duration, `${path}.duration`, ["kind", "reason"]);
      literal(duration.kind, "unknown", `${path}.duration.kind`);
      literal(duration.reason, "end_unspecified", `${path}.duration.reason`);
    } else {
      exactKeys(duration, `${path}.duration`, ["kind", "seconds"]);
      literal(duration.kind, "known", `${path}.duration.kind`);
      const seconds = finitePositive(duration.seconds, `${path}.duration.seconds`);
      if (seconds !== start.until(end).total({ unit: "seconds" })) {
        fail(`${path}.duration.seconds`, "must equal endAt minus startAt");
      }
    }
  } else if (event.kind === "all_day") {
    exactKeys(event, path, [...EVENT_BASE_KEYS, "kind", "startLocalDate", "endLocalDate", "duration"]);
    const start = date(event.startLocalDate, `${path}.startLocalDate`);
    const end = date(event.endLocalDate, `${path}.endLocalDate`);
    if (Temporal.PlainDate.compare(end, start) <= 0) {
      fail(`${path}.endLocalDate`, "must be after startLocalDate");
    }
    const duration = object(event.duration, `${path}.duration`);
    exactKeys(duration, `${path}.duration`, ["kind", "days"]);
    literal(duration.kind, "calendar_days", `${path}.duration.kind`);
    literal(duration.days, start.until(end).days, `${path}.duration.days`);
  } else {
    fail(`${path}.kind`, "must be timed or all_day");
  }
  return value as NormalizedExternalEvent;
}

function validateRevision(value: unknown, path: string): ExternalEventRevision {
  const revision = object(value, path);
  exactKeys(revision, path, ["availability", "providerUpdatedAt", "providerEtag"]);
  oneOf(revision.availability, ["available", "unavailable"], `${path}.availability`);
  nullableInstant(revision.providerUpdatedAt, `${path}.providerUpdatedAt`);
  nullableString(revision.providerEtag, `${path}.providerEtag`);
  const hasRevision = revision.providerUpdatedAt !== null || revision.providerEtag !== null;
  if (hasRevision !== (revision.availability === "available")) {
    fail(`${path}.availability`, "must match revision metadata presence");
  }
  return value as ExternalEventRevision;
}

function validateOrganizer(value: unknown, path: string): void {
  if (value === null) return;
  const organizer = object(value, path);
  exactKeys(organizer, path, ["displayName", "email", "self"]);
  nullableString(organizer.displayName, `${path}.displayName`);
  nullableString(organizer.email, `${path}.email`);
  boolean(organizer.self, `${path}.self`);
}

function validateAttendees(value: unknown, path: string): void {
  if (value === null) return;
  const attendees = array(value, path);
  if (attendees.length > 100) fail(path, "cannot contain more than 100 attendees");
  attendees.forEach((value, index) => {
    const attendee = object(value, `${path}[${index}]`);
    exactKeys(attendee, `${path}[${index}]`, [
      "displayName", "email", "responseStatus", "optional", "organizer", "self",
    ]);
    nullableString(attendee.displayName, `${path}[${index}].displayName`);
    nullableString(attendee.email, `${path}[${index}].email`);
    responseStatus(attendee.responseStatus, `${path}[${index}].responseStatus`);
    boolean(attendee.optional, `${path}[${index}].optional`);
    boolean(attendee.organizer, `${path}[${index}].organizer`);
    boolean(attendee.self, `${path}[${index}].self`);
  });
}

function validateConference(value: unknown, path: string): void {
  if (value === null) return;
  const conference = object(value, path);
  exactKeys(conference, path, ["name", "entryPoints", "notes"]);
  nullableString(conference.name, `${path}.name`);
  nullableString(conference.notes, `${path}.notes`);
  const entryPoints = array(conference.entryPoints, `${path}.entryPoints`);
  if (entryPoints.length > 10) fail(`${path}.entryPoints`, "cannot contain more than 10 entries");
  entryPoints.forEach((value, index) => {
    const entry = object(value, `${path}.entryPoints[${index}]`);
    exactKeys(entry, `${path}.entryPoints[${index}]`, ["type", "uri", "label"]);
    const type = oneOf(entry.type, ["video", "phone", "sip", "more", "unknown"], `${path}.entryPoints[${index}].type`);
    const uri = nonEmptyString(entry.uri, `${path}.entryPoints[${index}].uri`);
    const allowed = type === "phone" ? ["tel:"] : type === "sip" ? ["sip:"] : ["https:"];
    if (!allowed.some((prefix) => uri.startsWith(prefix))) {
      fail(`${path}.entryPoints[${index}].uri`, `must use ${allowed.join(" or ")}`);
    }
    nullableString(entry.label, `${path}.entryPoints[${index}].label`);
  });
}

function validateRecurrence(value: unknown, path: string): void {
  if (value === null) return;
  const recurrence = object(value, path);
  exactKeys(recurrence, path, ["seriesId", "originalStart"]);
  nonEmptyString(recurrence.seriesId, `${path}.seriesId`);
  validateOriginalStart(recurrence.originalStart, `${path}.originalStart`);
}

function validateOriginalStart(value: unknown, path: string): ExternalEventOriginalStart {
  const original = object(value, path);
  if (original.kind === "timed") {
    exactKeys(original, path, ["kind", "startAt"]);
    instant(original.startAt, `${path}.startAt`);
  } else if (original.kind === "all_day") {
    exactKeys(original, path, ["kind", "startLocalDate"]);
    date(original.startLocalDate, `${path}.startLocalDate`);
  } else fail(`${path}.kind`, "must be timed or all_day");
  return value as ExternalEventOriginalStart;
}

function validateAttachments(value: unknown, path: string): void {
  if (value === null) return;
  const attachments = array(value, path);
  if (attachments.length > 25) fail(path, "cannot contain more than 25 attachments");
  attachments.forEach((value, index) => {
    const attachment = object(value, `${path}[${index}]`);
    exactKeys(attachment, `${path}[${index}]`, ["title", "mimeType", "url"]);
    nullableString(attachment.title, `${path}[${index}].title`);
    nullableString(attachment.mimeType, `${path}[${index}].mimeType`);
    httpsUrl(attachment.url, `${path}[${index}].url`);
  });
}

function validateTombstone(
  value: unknown,
  path: string,
  source: ExternalEventSource,
): ExternalEventCancellationTombstone {
  const tombstone = object(value, path);
  exactKeys(tombstone, path, [
    "id", "providerEventId", "logicalInstanceId", "calendarId", "source",
    "recurrence", "revision",
  ]);
  nonEmptyString(tombstone.id, `${path}.id`);
  nonEmptyString(tombstone.providerEventId, `${path}.providerEventId`);
  nonEmptyString(tombstone.logicalInstanceId, `${path}.logicalInstanceId`);
  nonEmptyString(tombstone.calendarId, `${path}.calendarId`);
  literal(tombstone.source, source, `${path}.source`);
  if (V1_1_SOURCES.has(source)) {
    validateV1_1Identity(tombstone.id, source, `${path}.id`);
    validateV1_1Identity(tombstone.logicalInstanceId, source, `${path}.logicalInstanceId`);
  }
  validateRecurrence(tombstone.recurrence, `${path}.recurrence`);
  validateRevision(tombstone.revision, `${path}.revision`);
  return value as ExternalEventCancellationTombstone;
}

function enumRecord(
  value: unknown,
  values: ReadonlySet<string>,
  fields: ReadonlySet<string>,
  path: string,
): void {
  const record = object(value, path);
  for (const [key, entry] of Object.entries(record)) {
    if (!fields.has(key) || typeof entry !== "string" || !values.has(entry)) {
      fail(`${path}.${key}`, "contains an unsupported field or value");
    }
  }
}

function exactKeys(
  value: Record<string, unknown>,
  path: string,
  keys: readonly string[],
): void {
  const expected = new Set(keys);
  const actual = Object.keys(value);
  if (actual.length !== expected.size || actual.some((key) => !expected.has(key))) {
    fail(path, `must contain exactly: ${keys.join(", ")}`);
  }
}

function responseStatus(value: unknown, path: string): void {
  oneOf(value, ["needs_action", "declined", "tentative", "accepted", "unknown"], path);
}

function nullableHttpsUrl(value: unknown, path: string): void {
  if (value !== null) httpsUrl(value, path);
}

function httpsUrl(value: unknown, path: string): string {
  const text = nonEmptyString(value, path);
  if (!/^https:\/\/[^\s/?#]+(?:[/?#][^\s]*)?$/u.test(text)) {
    fail(path, "must be a valid HTTPS URL");
  }
  return text;
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
    if (error instanceof ExternalEventValidationError) throw error;
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
    if (error instanceof ExternalEventValidationError) throw error;
    fail(path, "must be a valid instant");
  }
}

function nullableInstant(value: unknown, path: string): void {
  if (value !== null) instant(value, path);
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(path, "must be an object");
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, "must be an array");
  return value;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string") fail(path, "must be a string");
  return value;
}

function nonEmptyString(value: unknown, path: string): string {
  const text = string(value, path);
  if (text.length === 0) fail(path, "must not be empty");
  return text;
}

function nullableString(value: unknown, path: string): void {
  if (value !== null) string(value, path);
}

function stringArray(value: unknown, path: string, maximum: number): string[] {
  const values = array(value, path);
  if (values.length > maximum) fail(path, `cannot contain more than ${maximum} entries`);
  return values.map((entry, index) => nonEmptyString(entry, `${path}[${index}]`));
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

function finitePositive(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    fail(path, "must be a positive finite number");
  }
  return value;
}

function literal<T extends string | number>(
  value: unknown,
  expected: T,
  path: string,
  code?: ExternalEventValidationErrorCode,
): T {
  if (value !== expected) fail(path, `must equal ${String(expected)}`, code);
  return expected;
}

function oneOf<const T extends readonly string[]>(
  value: unknown,
  expected: T,
  path: string,
): T[number] {
  if (typeof value !== "string" || !expected.includes(value)) {
    fail(path, `must be one of ${expected.join(", ")}`);
  }
  return value as T[number];
}

function unique(values: string[], path: string): void {
  if (new Set(values).size !== values.length) fail(path, "must contain unique values");
}

function fail(path: string, message: string, code?: ExternalEventValidationErrorCode): never {
  throw new ExternalEventValidationError(path, message, code);
}
