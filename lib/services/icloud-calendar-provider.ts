import { createHash } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import { sanitizeGoogleCalendarText } from "@/lib/services/google-calendar-provider";
import {
  CALDAV_NS,
  DAV_NS,
  ICLOUD_CALDAV_ENDPOINT,
  IcloudCalendarProviderError,
  IcloudXmlError,
  davProp,
  icloudCalDavRequest,
  icloudCalDavUrlAllowed,
  icloudFailure,
  icloudUrlKey,
  parseIcloudMultistatus,
  xmlChild,
  xmlChildren,
  type DavResponse,
  type IcloudRequestOptions,
} from "@/lib/services/icloud-calendar-request";
import {
  externalEventNormalizedId,
  validateVersionedExternalEventSnapshot,
} from "@cadence/core/services/external-event-validation";
import type {
  ExternalEventAvailability,
  ExternalEventField,
  ExternalEventFieldAvailability,
  ExternalEventOriginalStart,
  ExternalEventRevision,
  ExternalEventState,
  NormalizedExternalEvent,
} from "@cadence/core/types/day-progress";
import {
  EXTERNAL_EVENT_MAX_CALENDARS,
  EXTERNAL_EVENT_MAX_RANGE_DAYS,
  EXTERNAL_EVENT_SCHEMA_VERSION_1_1,
  ICLOUD_CALENDAR_ADAPTER_VERSION,
  type ExternalEventCancellationTombstoneV1_1,
  type ExternalEventCapabilities,
  type ExternalEventCoverage,
  type ExternalEventFailure,
  type ExternalEventRequestedRange,
  type ExternalEventSnapshotV1_1,
} from "@cadence/core/types/external-event";

// Ticket 227 iCloud Calendar adapter over CalDAV. Exactly three read-only
// operations: discover the principal and calendar home, list VEVENT calendars,
// and read selected calendars with a server-expanded calendar-query. The first
// slice keeps only identity, interval, state, availability, revision, and the
// SUMMARY text. It never expands RRULE locally: an unexpanded series marks that
// calendar incomplete. All transport rules live in icloud-calendar-request.ts.

export {
  IcloudCalendarProviderError,
  ICLOUD_READ_DEADLINE_MS,
  type IcloudFetch,
  type IcloudLogin,
  type IcloudRequestOptions,
} from "@/lib/services/icloud-calendar-request";

const MAX_TEXT = 1_024;
const MAX_UID = 1_024;
const MAX_HOME_RESPONSES = 256;
const MAX_EVENT_RESPONSES = 5_000;
const MAX_ICAL_LINES = 50_000;
const MAX_ICAL_DEPTH = 8;
const UNSUPPORTED_DETAILS = ["description", "location", "organizer", "attendees", "conference", "attachments", "source_url"] as const;

export type IcloudCalendar = Readonly<{ id: string; name: string; isDefault: boolean }>;
/** Server-only calendar facts; the href and timezone never leave the service. */
export type IcloudCalendarCollection = IcloudCalendar & Readonly<{ href: string; timezone: string | null }>;
export type IcloudDiscovery = Readonly<{ principal: string; home: URL }>;
export type IcloudQuarantineReason = "timezone_unresolved" | "invalid_interval" | "unexpanded_recurrence" | "malformed_item" | "unavailable_item";

export type IcloudCalendarReadInput = IcloudRequestOptions & Readonly<{
  accountId: string;
  connectionGeneration: number;
  calendars: readonly IcloudCalendarCollection[];
  range: ExternalEventRequestedRange;
  fetchedAt: string;
}>;

export type IcloudCalendarReadResult =
  | Readonly<{ ok: true; snapshot: ExternalEventSnapshotV1_1 }>
  | Readonly<{ ok: false; error: ExternalEventFailure; partialSnapshot: ExternalEventSnapshotV1_1 }>;

class ItemError extends Error {}

function malformed(calendarId: string | null, message: string): IcloudCalendarProviderError {
  return new IcloudCalendarProviderError(icloudFailure("malformed_provider_response", calendarId, false, null, message));
}

function multistatus(body: string, calendarId: string | null, maxResponses: number): DavResponse[] {
  let parsed: ReturnType<typeof parseIcloudMultistatus>;
  try { parsed = parseIcloudMultistatus(body, maxResponses); }
  catch (error) {
    if (error instanceof IcloudXmlError && error.kind === "truncated") {
      throw new IcloudCalendarProviderError(icloudFailure("incomplete_pagination", calendarId, false, null, "iCloud Calendar returned a truncated multistatus."));
    }
    throw malformed(calendarId, "iCloud Calendar returned malformed XML.");
  }
  if (parsed.truncated) throw new IcloudCalendarProviderError(icloudFailure("incomplete_pagination", calendarId, false, null, "iCloud Calendar truncated the results."));
  return parsed.responses;
}

const PRINCIPAL_BODY = `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`;
const HOME_BODY = `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="${CALDAV_NS}"><d:prop><c:calendar-home-set/></d:prop></d:propfind>`;
const LIST_BODY = `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="${CALDAV_NS}"><d:prop><d:resourcetype/><d:displayname/><c:supported-calendar-component-set/><c:calendar-timezone/><d:getetag/></d:prop></d:propfind>`;

/** The single href inside a 200 property, vetted against `base`. */
function hrefProperty(response: DavResponse, ns: string, name: string, base: URL): URL {
  const property = davProp(response, ns, name);
  if (!property || property.status !== 200) throw new ItemError(`${name} is missing`);
  const hrefs = xmlChildren(property.element, DAV_NS, "href");
  if (hrefs.length !== 1) throw new ItemError(`${name} needs one href`);
  const url = icloudCalDavUrlAllowed(hrefs[0].text.trim(), base);
  if (!url) throw new ItemError(`${name} is outside icloud.com`);
  return url;
}

/** Exactly one response for the requested resource, never another one. */
function selfResponse(responses: DavResponse[], requested: URL): DavResponse {
  const matching = responses.filter((response) => {
    const url = icloudCalDavUrlAllowed(response.href, requested);
    return url !== null && icloudUrlKey(url) === icloudUrlKey(requested);
  });
  if (matching.length !== 1 || responses.length !== 1) throw new ItemError("discovery must describe exactly the requested resource");
  if (matching[0].status !== null && matching[0].status !== 200) throw new ItemError("discovery resource is unavailable");
  return matching[0];
}

/**
 * Discovers the `current-user-principal` (the identity binding) and the
 * calendar home. Credentials are sent only to the fixed endpoint and vetted
 * icloud.com hosts.
 */
export async function discoverIcloudCalendar(options: IcloudRequestOptions): Promise<IcloudDiscovery> {
  const endpoint = new URL(ICLOUD_CALDAV_ENDPOINT);
  const first = await icloudCalDavRequest({ method: "PROPFIND", url: endpoint, depth: "0", body: PRINCIPAL_BODY, calendarId: null }, options);
  let principal: URL;
  try { principal = hrefProperty(selfResponse(multistatus(first.body, null, 4), first.url), DAV_NS, "current-user-principal", first.url); }
  catch (error) { if (error instanceof IcloudCalendarProviderError) throw error; throw malformed(null, "iCloud Calendar returned no usable principal."); }
  const second = await icloudCalDavRequest({ method: "PROPFIND", url: principal, depth: "0", body: HOME_BODY, calendarId: null }, options);
  let home: URL;
  try { home = hrefProperty(selfResponse(multistatus(second.body, null, 4), second.url), CALDAV_NS, "calendar-home-set", second.url); }
  catch (error) { if (error instanceof IcloudCalendarProviderError) throw error; throw malformed(null, "iCloud Calendar returned no usable calendar home."); }
  if (!home.pathname.endsWith("/")) home.pathname = `${home.pathname}/`;
  // The principal path binds the account; partition hosts may change between sessions.
  return { principal: principal.pathname, home };
}

/** Opaque, stable client identifier for a calendar collection; the href stays on the server. */
export function icloudCalendarId(href: string): string {
  return `ic_${createHash("sha256").update(JSON.stringify(["cadence-icloud-calendar-v1", href])).digest("base64url").slice(0, 32)}`;
}

/** TZID of a calendar-timezone VTIMEZONE, only when Temporal accepts it as IANA. */
export function icloudTimezone(value: string | null | undefined): string | null {
  if (!value || value.length > 128 || !/^(?:UTC|[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)+)$/.test(value)) return null;
  try { Temporal.Instant.from("2026-01-01T00:00:00Z").toZonedDateTimeISO(value); return value; }
  catch { return null; }
}

function collectionTimezone(text: string): string | null {
  try {
    const parsed = parseIcalendar(text);
    const zone = parsed.components.find((component) => component.name === "VTIMEZONE");
    return icloudTimezone(zone?.properties.find((property) => property.name === "TZID")?.value);
  } catch { return null; }
}

/** Lists VEVENT calendar collections under the home, sorted by name. */
export async function listIcloudCalendars(options: IcloudRequestOptions, discovery: IcloudDiscovery): Promise<IcloudCalendarCollection[]> {
  const { body, url } = await icloudCalDavRequest({ method: "PROPFIND", url: discovery.home, depth: "1", body: LIST_BODY, calendarId: null }, options);
  const responses = multistatus(body, null, MAX_HOME_RESPONSES);
  const calendars = new Map<string, IcloudCalendarCollection>();
  const homePath = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
  try {
    for (const response of responses) {
      const href = icloudCalDavUrlAllowed(response.href, url);
      if (!href || href.origin !== url.origin || !`${href.pathname}/`.startsWith(homePath)) throw new ItemError("collection is outside the calendar home");
      if (href.pathname === homePath || `${href.pathname}/` === homePath) continue;
      if (response.status !== null && response.status !== 200) continue;
      const type = davProp(response, DAV_NS, "resourcetype");
      if (!type || type.status !== 200) throw new ItemError("resourcetype is missing");
      if (!xmlChild(type.element, CALDAV_NS, "calendar")) continue;
      const components = davProp(response, CALDAV_NS, "supported-calendar-component-set");
      if (components && components.status === 200) {
        if (!xmlChildren(components.element, CALDAV_NS, "comp").some((comp) => comp.attributes.name?.toUpperCase() === "VEVENT")) continue;
      } else if (components && components.status !== 404) throw new ItemError("supported-calendar-component-set is unreadable");
      const name = davProp(response, DAV_NS, "displayname");
      const label = name && name.status === 200 ? sanitizeGoogleCalendarText(name.element.text, MAX_TEXT, false) : "";
      const zone = davProp(response, CALDAV_NS, "calendar-timezone");
      const path = href.pathname.endsWith("/") ? href.pathname : `${href.pathname}/`;
      const id = icloudCalendarId(path);
      calendars.set(id, { id, name: label || "Untitled iCloud calendar", isDefault: false, href: new URL(path, href).toString(),
        timezone: zone && zone.status === 200 ? collectionTimezone(zone.element.text) : null });
    }
  } catch (error) {
    throw malformed(null, error instanceof ItemError ? `iCloud Calendar listing: ${error.message}.` : "iCloud Calendar returned a malformed calendar list.");
  }
  return [...calendars.values()].sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

// ---------------------------------------------------------------------------
// iCalendar (RFC 5545) subset
// ---------------------------------------------------------------------------

type IcalProperty = Readonly<{ name: string; params: Readonly<Record<string, string>>; value: string }>;
type IcalComponent = Readonly<{ name: string; properties: IcalProperty[]; components: IcalComponent[] }>;

function parseContentLine(line: string): IcalProperty {
  let index = 0;
  const nameMatch = /^[A-Za-z0-9-]+/.exec(line);
  if (!nameMatch) throw new ItemError("invalid content line");
  const name = nameMatch[0].toUpperCase();
  index = nameMatch[0].length;
  const params: Record<string, string> = {};
  while (line[index] === ";") {
    const paramMatch = /^;([A-Za-z0-9-]+)=/.exec(line.slice(index));
    if (!paramMatch) throw new ItemError("invalid parameter");
    index += paramMatch[0].length;
    let value: string;
    if (line[index] === "\"") {
      const end = line.indexOf("\"", index + 1);
      if (end < 0) throw new ItemError("unterminated quoted parameter");
      value = line.slice(index + 1, end);
      index = end + 1;
    } else {
      const end = line.slice(index).search(/[;:,]/);
      value = end < 0 ? line.slice(index) : line.slice(index, index + end);
      index += value.length;
    }
    // Multi-valued parameters keep only their first value; none used here is multi-valued.
    while (line[index] === ",") {
      const end = line.slice(index + 1).search(/[;:]/);
      index = end < 0 ? line.length : index + 1 + end;
    }
    params[paramMatch[1].toUpperCase()] = value;
  }
  if (line[index] !== ":") throw new ItemError("content line has no value");
  return { name, params, value: line.slice(index + 1) };
}

/** Parses one VCALENDAR object. Nested components are kept; unknown properties are ignored by callers. */
export function parseIcalendar(text: string): IcalComponent {
  const lines = text.replace(/\r\n|\r/g, "\n").replace(/\n[ \t]/g, "").split("\n").filter((line) => line.length > 0);
  if (lines.length > MAX_ICAL_LINES) throw new ItemError("calendar data is too long");
  const stack: { name: string; properties: IcalProperty[]; components: IcalComponent[] }[] = [];
  let root: IcalComponent | null = null;
  for (const line of lines) {
    if (/[\u0000-\u0008\u000b-\u001f\u007f]/.test(line)) throw new ItemError("control character in calendar data");
    const property = parseContentLine(line);
    if (property.name === "BEGIN") {
      if (root || stack.length >= MAX_ICAL_DEPTH || !/^[A-Za-z0-9-]+$/.test(property.value)) throw new ItemError("invalid BEGIN");
      stack.push({ name: property.value.toUpperCase(), properties: [], components: [] });
    } else if (property.name === "END") {
      const open = stack.pop();
      if (!open || open.name !== property.value.toUpperCase()) throw new ItemError("mismatched END");
      if (stack.length) stack[stack.length - 1].components.push(open); else root = open;
    } else {
      if (!stack.length) throw new ItemError("property outside a component");
      stack[stack.length - 1].properties.push(property);
    }
  }
  if (stack.length || !root || root.name !== "VCALENDAR") throw new ItemError("calendar data must be one VCALENDAR");
  return root;
}

function unescapeText(value: string): string {
  return value.replace(/\\([\\;,nN])/g, (_, character: string) => character === "n" || character === "N" ? "\n" : character);
}

function single(component: IcalComponent, name: string): IcalProperty | undefined {
  const matches = component.properties.filter((property) => property.name === name);
  if (matches.length > 1) throw new ItemError(`${name} appears more than once`);
  return matches[0];
}

type IcalTime =
  | Readonly<{ kind: "date"; date: Temporal.PlainDate }>
  | Readonly<{ kind: "utc"; instant: Temporal.Instant }>
  | Readonly<{ kind: "zoned"; dateTime: Temporal.PlainDateTime; zone: string | null }>
  | Readonly<{ kind: "floating"; dateTime: Temporal.PlainDateTime }>;

function icalTime(property: IcalProperty): IcalTime {
  const value = property.value;
  const valueType = property.params.VALUE?.toUpperCase();
  const date = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (date) {
    if (valueType && valueType !== "DATE") throw new ItemError("DATE value type mismatch");
    return { kind: "date", date: Temporal.PlainDate.from({ year: Number(date[1]), month: Number(date[2]), day: Number(date[3]) }, { overflow: "reject" }) };
  }
  const dateTime = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value);
  if (!dateTime || (valueType && valueType !== "DATE-TIME")) throw new ItemError("invalid DATE-TIME");
  const plain = Temporal.PlainDateTime.from({ year: Number(dateTime[1]), month: Number(dateTime[2]), day: Number(dateTime[3]),
    hour: Number(dateTime[4]), minute: Number(dateTime[5]), second: Math.min(59, Number(dateTime[6])) }, { overflow: "reject" });
  if (dateTime[7] === "Z") return { kind: "utc", instant: plain.toZonedDateTime("UTC").toInstant() };
  if (property.params.TZID !== undefined) return { kind: "zoned", dateTime: plain, zone: icloudTimezone(property.params.TZID) };
  return { kind: "floating", dateTime: plain };
}

/** RFC 5545 dur-value without sign or with "+"; negative durations are refused. */
export function parseIcalDuration(value: string): Readonly<{ weeks: number; days: number; hours: number; minutes: number; seconds: number }> {
  const match = /^\+?P(?:(\d{1,5})W|(?:(\d{1,5})D)?(?:T(?:(\d{1,6})H)?(?:(\d{1,7})M)?(?:(\d{1,8})S)?)?)$/.exec(value);
  if (!match || value.endsWith("T") || value === "P" || value === "+P") throw new ItemError("invalid DURATION");
  return { weeks: Number(match[1] ?? 0), days: Number(match[2] ?? 0), hours: Number(match[3] ?? 0), minutes: Number(match[4] ?? 0), seconds: Number(match[5] ?? 0) };
}

export type IcloudAdapterContext = Readonly<{
  accountId: string;
  calendar: IcloudCalendarCollection;
  range: ExternalEventRequestedRange;
  etag: string | null;
}>;
export type IcloudAdaptedItem =
  | Readonly<{ kind: "event"; event: NormalizedExternalEvent }>
  | Readonly<{ kind: "tombstone"; tombstone: ExternalEventCancellationTombstoneV1_1 }>
  | Readonly<{ kind: "quarantine"; reason: IcloudQuarantineReason }>
  | Readonly<{ kind: "outside_range" }>;

function recurrenceKey(time: IcalTime, zone: string): ExternalEventOriginalStart {
  if (time.kind === "date") return { kind: "all_day", startLocalDate: time.date.toString() };
  if (time.kind === "utc") return { kind: "timed", startAt: time.instant.toString() };
  return { kind: "timed", startAt: time.dateTime.toZonedDateTime(time.kind === "zoned" && time.zone ? time.zone : zone, { disambiguation: "compatible" }).toInstant().toString() };
}

function eventState(value: string | undefined): ExternalEventState | "cancelled" {
  const status = value?.toUpperCase();
  if (status === "CANCELLED") return "cancelled";
  if (status === "CONFIRMED") return "confirmed";
  if (status === "TENTATIVE") return "tentative";
  return "unknown";
}

function eventAvailability(value: string | undefined): ExternalEventAvailability {
  const transparency = value?.toUpperCase();
  if (transparency === "OPAQUE") return "busy";
  if (transparency === "TRANSPARENT") return "free";
  return "unknown";
}

function eventRevision(component: IcalComponent, etag: string | null): ExternalEventRevision {
  const modified = single(component, "LAST-MODIFIED");
  let updated: string | null = null;
  if (modified) {
    const time = icalTime(modified);
    if (time.kind !== "utc") throw new ItemError("LAST-MODIFIED must be UTC");
    updated = time.instant.toString();
  }
  return { availability: updated !== null || etag !== null ? "available" : "unavailable", providerUpdatedAt: updated, providerEtag: etag };
}

/** Maps one VEVENT. Unknown properties are ignored; malformed required values quarantine the item. */
export function adaptIcloudEvent(component: IcalComponent, context: IcloudAdapterContext): IcloudAdaptedItem {
  try { return adaptComponent(component, context); }
  catch { return { kind: "quarantine", reason: "malformed_item" }; }
}

function adaptComponent(component: IcalComponent, context: IcloudAdapterContext): IcloudAdaptedItem {
  const { calendar, range } = context;
  // A server that returned a series master did not expand it; Cadence never expands locally.
  if (component.properties.some((property) => property.name === "RRULE" || property.name === "RDATE")) return { kind: "quarantine", reason: "unexpanded_recurrence" };
  const uidProperty = single(component, "UID");
  const uid = uidProperty?.value ?? "";
  if (!uid || uid.length > MAX_UID) throw new ItemError("UID is required");
  const startProperty = single(component, "DTSTART");
  if (!startProperty) throw new ItemError("DTSTART is required");
  const start = icalTime(startProperty);
  const endProperty = single(component, "DTEND");
  const durationProperty = single(component, "DURATION");
  if (endProperty && durationProperty) throw new ItemError("DTEND and DURATION are exclusive");
  const fallbackZone = calendar.timezone ?? range.timezone;
  const fallbackKind = calendar.timezone ? "calendar" as const : "request" as const;
  if (start.kind === "zoned" && !start.zone) return { kind: "quarantine", reason: "timezone_unresolved" };
  const zone = start.kind === "zoned" && start.zone ? start.zone : fallbackZone;
  const timezoneFallback = start.kind === "zoned" ? "none" as const : fallbackKind;

  const recurrenceProperty = single(component, "RECURRENCE-ID");
  const recurrenceTime = recurrenceProperty ? icalTime(recurrenceProperty) : null;
  if (recurrenceTime?.kind === "zoned" && !recurrenceTime.zone) return { kind: "quarantine", reason: "timezone_unresolved" };
  const recurrence = recurrenceTime ? { seriesId: uid, originalStart: recurrenceKey(recurrenceTime, zone) } : null;
  const instanceKey = recurrence ? (recurrence.originalStart.kind === "timed" ? recurrence.originalStart.startAt : recurrence.originalStart.startLocalDate) : null;
  const id = externalEventNormalizedId("icloud_calendar", instanceKey ? [context.accountId, calendar.id, uid, instanceKey] : [context.accountId, calendar.id, uid]);
  const revision = eventRevision(component, context.etag);

  const rangeStart = Temporal.PlainDate.from(range.startLocalDate);
  const rangeEndExclusive = Temporal.PlainDate.from(range.endLocalDate).add({ days: 1 });
  type Interval = { kind: "timed"; startAt: Temporal.Instant; endAt: Temporal.Instant; unspecified: boolean } | { kind: "all_day"; first: Temporal.PlainDate; last: Temporal.PlainDate };
  let interval: Interval;
  if (start.kind === "date") {
    let last = start.date.add({ days: 1 });
    if (endProperty) {
      const end = icalTime(endProperty);
      if (end.kind !== "date") throw new ItemError("all-day DTEND must be a DATE");
      last = end.date;
    } else if (durationProperty) {
      const duration = parseIcalDuration(durationProperty.value);
      if (duration.hours || duration.minutes || duration.seconds) throw new ItemError("all-day DURATION must be whole days");
      last = start.date.add({ days: duration.weeks * 7 + duration.days });
    }
    if (Temporal.PlainDate.compare(last, start.date) <= 0) return { kind: "quarantine", reason: "invalid_interval" };
    if (Temporal.PlainDate.compare(last, rangeStart) <= 0 || Temporal.PlainDate.compare(start.date, rangeEndExclusive) >= 0) return { kind: "outside_range" };
    interval = { kind: "all_day", first: start.date, last };
  } else {
    const zoned = start.kind === "utc" ? start.instant.toZonedDateTimeISO(zone)
      : start.dateTime.toZonedDateTime(zone, { disambiguation: "compatible" });
    let endAt: Temporal.Instant; let unspecified = false;
    if (endProperty) {
      const end = icalTime(endProperty);
      if (end.kind === "date") throw new ItemError("timed DTEND must be a DATE-TIME");
      if (end.kind === "zoned" && !end.zone) return { kind: "quarantine", reason: "timezone_unresolved" };
      endAt = end.kind === "utc" ? end.instant : end.dateTime.toZonedDateTime(end.kind === "zoned" && end.zone ? end.zone : zone, { disambiguation: "compatible" }).toInstant();
    } else if (durationProperty) {
      const duration = parseIcalDuration(durationProperty.value);
      // Days and weeks are nominal (same wall time across DST); hours and smaller are exact.
      endAt = zoned.add({ days: duration.weeks * 7 + duration.days }).add({ hours: duration.hours, minutes: duration.minutes, seconds: duration.seconds }).toInstant();
    } else {
      // RFC 5545 allows a DATE-TIME start with no end; Cadence never asserts a duration from it.
      endAt = zoned.toInstant().add({ seconds: 1 }); unspecified = true;
    }
    const startAt = zoned.toInstant();
    if (Temporal.Instant.compare(endAt, startAt) <= 0) return { kind: "quarantine", reason: "invalid_interval" };
    const windowStart = rangeStart.toZonedDateTime(range.timezone).toInstant();
    const windowEnd = rangeEndExclusive.toZonedDateTime(range.timezone).toInstant();
    const overlaps = unspecified ? Temporal.Instant.compare(startAt, windowStart) >= 0 && Temporal.Instant.compare(startAt, windowEnd) < 0
      : Temporal.Instant.compare(endAt, windowStart) > 0 && Temporal.Instant.compare(startAt, windowEnd) < 0;
    if (!overlaps) return { kind: "outside_range" };
    interval = { kind: "timed", startAt, endAt, unspecified };
  }

  const state = eventState(single(component, "STATUS")?.value);
  if (state === "cancelled") {
    return { kind: "tombstone", tombstone: { id, providerEventId: uid, logicalInstanceId: id, calendarId: calendar.id, source: "icloud_calendar", recurrence, revision } };
  }
  const summary = single(component, "SUMMARY");
  const title = summary ? sanitizeGoogleCalendarText(unescapeText(summary.value), MAX_TEXT, false) : "";
  const fieldAvailability: Partial<Record<ExternalEventField, ExternalEventFieldAvailability>> = {};
  for (const field of UNSUPPORTED_DETAILS) fieldAvailability[field] = "unsupported";
  if (!title) fieldAvailability.title = "not_provided";
  const base = {
    id, providerEventId: uid, logicalInstanceId: id, calendarId: calendar.id, source: "icloud_calendar" as const, calendarName: calendar.name,
    sourceTimezone: zone, sourceTimezoneFallback: timezoneFallback,
    state, availability: eventAvailability(single(component, "TRANSP")?.value), currentUserResponse: null,
    revision, title, description: "", location: "", sourceUrl: null, fieldAvailability, detailCompleteness: {},
    organizer: null, attendees: null, attendeesOmitted: false, conference: null, recurrence, attachments: null,
  };
  const event: NormalizedExternalEvent = interval.kind === "timed"
    ? { ...base, kind: "timed", startAt: interval.startAt.toString(), endAt: interval.endAt.toString(), endUnspecified: interval.unspecified,
      duration: interval.unspecified ? { kind: "unknown", reason: "end_unspecified" } : { kind: "known", seconds: interval.startAt.until(interval.endAt).total({ unit: "seconds" }) } }
    : { ...base, kind: "all_day", startLocalDate: interval.first.toString(), endLocalDate: interval.last.toString(), duration: { kind: "calendar_days", days: interval.first.until(interval.last).days } };
  return { kind: "event", event };
}

function utcStamp(instant: Temporal.Instant): string {
  return instant.toString({ smallestUnit: "second" }).replace(/[-:]/g, "");
}

/** UTC bounds widened by one day on each side so floating and all-day events in other zones are returned; the adapter filters exactly. */
export function icloudQueryBounds(range: ExternalEventRequestedRange): Readonly<{ start: string; end: string }> {
  const start = Temporal.PlainDate.from(range.startLocalDate).subtract({ days: 1 }).toZonedDateTime(range.timezone).toInstant();
  const end = Temporal.PlainDate.from(range.endLocalDate).add({ days: 2 }).toZonedDateTime(range.timezone).toInstant();
  return { start: utcStamp(start), end: utcStamp(end) };
}

export function icloudCalendarQueryBody(range: ExternalEventRequestedRange): string {
  const { start, end } = icloudQueryBounds(range);
  return `<?xml version="1.0" encoding="utf-8"?><c:calendar-query xmlns:d="DAV:" xmlns:c="${CALDAV_NS}"><d:prop><d:getetag/>` +
    `<c:calendar-data><c:expand start="${start}" end="${end}"/></c:calendar-data></d:prop>` +
    `<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${start}" end="${end}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
}

function validateReadInput(input: IcloudCalendarReadInput): void {
  if (!input.login.appleId || !input.login.appPassword || !input.accountId || !Number.isSafeInteger(input.connectionGeneration) || input.connectionGeneration < 1) {
    throw new TypeError("iCloud Calendar reads require login values, an account, and a positive connection generation.");
  }
  Temporal.Instant.from(input.fetchedAt);
  const start = Temporal.PlainDate.from(input.range.startLocalDate);
  const end = Temporal.PlainDate.from(input.range.endLocalDate);
  start.toZonedDateTime(input.range.timezone);
  if (start.until(end).days < 0 || start.until(end).days + 1 > EXTERNAL_EVENT_MAX_RANGE_DAYS) throw new RangeError("iCloud Calendar reads must cover 1-31 days.");
  const ids = input.calendars.map((calendar) => calendar.id);
  if (ids.length < 1 || ids.length > EXTERNAL_EVENT_MAX_CALENDARS || new Set(ids).size !== ids.length ||
    ids.length !== input.range.selectedCalendarIds.length || ids.some((id) => !input.range.selectedCalendarIds.includes(id))) {
    throw new TypeError("iCloud Calendar input must match 1-32 unique selected calendars.");
  }
}

function capabilities(complete: boolean, failures: readonly ExternalEventFailure[], unexpanded: boolean): ExternalEventCapabilities {
  const permission = failures.some((item) => item.code === "permission_denied") ? "denied" as const
    : failures.some((item) => item.code === "reconnect_required") ? "unknown" as const : "granted" as const;
  const capability = { support: "supported" as const, permission, availability: complete ? "available" as const : "degraded" as const };
  return { calendar_listing: capability, timed_events: capability, all_day_events: capability,
    recurrence: unexpanded ? { support: "unsupported", permission, availability: "unavailable" } : capability, details: capability,
    source_links: { support: "unsupported", permission: "unknown", availability: "unavailable" } };
}

function compareIdentity(left: { calendarId: string; id: string }, right: { calendarId: string; id: string }): number {
  return left.calendarId.localeCompare(right.calendarId) || left.id.localeCompare(right.id);
}

function snapshot(input: IcloudCalendarReadInput, coverage: ExternalEventCoverage[], failures: ExternalEventFailure[],
  events: NormalizedExternalEvent[], tombstones: ExternalEventCancellationTombstoneV1_1[], unexpanded: boolean): ExternalEventSnapshotV1_1 {
  const complete = failures.length === 0 && coverage.length === input.calendars.length && coverage.every((item) => item.paginationComplete);
  return validateVersionedExternalEventSnapshot({
    schemaVersion: EXTERNAL_EVENT_SCHEMA_VERSION_1_1,
    adapterVersion: ICLOUD_CALENDAR_ADAPTER_VERSION,
    accountId: input.accountId,
    connectionGeneration: input.connectionGeneration,
    source: "icloud_calendar",
    requestedRange: input.range,
    fetchedAt: input.fetchedAt,
    completeness: complete ? "complete" : "incomplete",
    freshness: { state: complete ? "current" : "incomplete", refreshedAt: complete ? input.fetchedAt : null,
      label: complete ? "Calendar current" : "Calendar data incomplete", canAssertNoOverlap: complete },
    capabilities: capabilities(complete, failures, unexpanded),
    coverage,
    failures,
    events: events.sort(compareIdentity),
    tombstones: tombstones.sort(compareIdentity),
  }) as ExternalEventSnapshotV1_1;
}

/**
 * Reads each selected calendar sequentially with one calendar-query REPORT.
 * CalDAV has no page token: a 507 or a truncated multistatus is
 * `incomplete_pagination`. Quarantined items and unexpanded series keep the
 * read going but mark that calendar incomplete with recorded reasons. A request
 * failure stops the read and returns the partial snapshot. A failed calendar is
 * never reported as complete and empty.
 */
export async function readIcloudCalendarEvents(input: IcloudCalendarReadInput): Promise<IcloudCalendarReadResult> {
  validateReadInput(input);
  const events = new Map<string, NormalizedExternalEvent>();
  const tombstones = new Map<string, ExternalEventCancellationTombstoneV1_1>();
  const coverage: ExternalEventCoverage[] = [];
  const failures: ExternalEventFailure[] = [];
  let unexpanded = false;
  const body = icloudCalendarQueryBody(input.range);
  for (const calendar of input.calendars) {
    const calendarUrl = icloudCalDavUrlAllowed(calendar.href);
    let itemCount = 0;
    const quarantined = new Map<IcloudQuarantineReason, number>();
    try {
      if (!calendarUrl) throw malformed(calendar.id, "iCloud Calendar collection is outside icloud.com.");
      const response = await icloudCalDavRequest({ method: "REPORT", url: calendarUrl, depth: "1", body, calendarId: calendar.id }, input);
      const responses = multistatus(response.body, calendar.id, MAX_EVENT_RESPONSES);
      itemCount = responses.length;
      const count = (reason: IcloudQuarantineReason) => quarantined.set(reason, (quarantined.get(reason) ?? 0) + 1);
      for (const item of responses) {
        const href = icloudCalDavUrlAllowed(item.href, response.url);
        if (!href || href.origin !== response.url.origin || !href.pathname.startsWith(response.url.pathname.endsWith("/") ? response.url.pathname : `${response.url.pathname}/`)) {
          throw malformed(calendar.id, "iCloud Calendar returned an event outside this calendar.");
        }
        if (item.status !== null && item.status !== 200) { count("unavailable_item"); continue; }
        const data = davProp(item, CALDAV_NS, "calendar-data");
        if (!data || data.status !== 200) { count("unavailable_item"); continue; }
        const etagProperty = davProp(item, DAV_NS, "getetag");
        const etagText = etagProperty?.status === 200 ? etagProperty.element.text.trim() : "";
        const etag = etagText && etagText.length <= MAX_TEXT ? etagText : null;
        let vcalendar: IcalComponent;
        try { vcalendar = parseIcalendar(data.element.text); } catch { count("malformed_item"); continue; }
        const vevents = vcalendar.components.filter((component) => component.name === "VEVENT");
        const uids = new Set(vevents.map((component) => component.properties.find((property) => property.name === "UID")?.value ?? ""));
        if (vevents.length === 0 || uids.size !== 1) { count("malformed_item"); continue; }
        for (const vevent of vevents) {
          const adapted = adaptIcloudEvent(vevent, { accountId: input.accountId, calendar, range: input.range, etag });
          if (adapted.kind === "event") { events.set(adapted.event.id, adapted.event); tombstones.delete(adapted.event.id); }
          else if (adapted.kind === "tombstone") { tombstones.set(adapted.tombstone.id, adapted.tombstone); events.delete(adapted.tombstone.id); }
          else if (adapted.kind === "quarantine") { count(adapted.reason); if (adapted.reason === "unexpanded_recurrence") unexpanded = true; }
        }
      }
    } catch (error) {
      // Programming errors such as a refused method are never reported as provider state.
      if (error instanceof TypeError) throw error;
      const readFailure = error instanceof IcloudCalendarProviderError ? error.failure
        : icloudFailure(input.signal?.aborted ? "timeout" : "provider_unavailable", calendar.id, !input.signal?.aborted, null, "iCloud Calendar event retrieval failed.");
      coverage.push({ calendarId: calendar.id, startLocalDate: input.range.startLocalDate, endLocalDate: input.range.endLocalDate, paginationComplete: false, itemCount });
      failures.push(readFailure);
      return { ok: false, error: readFailure, partialSnapshot: snapshot(input, coverage, failures, [...events.values()], [...tombstones.values()], unexpanded) };
    }
    const reasons = [...quarantined.entries()].sort(([left], [right]) => left.localeCompare(right));
    if (reasons.length > 0) {
      failures.push(icloudFailure(quarantined.has("unexpanded_recurrence") ? "incomplete_pagination" : "malformed_provider_response", calendar.id, false, null,
        `iCloud Calendar quarantined events: ${reasons.map(([reason, total]) => `${reason}=${total}`).join(", ")}.`));
    }
    coverage.push({ calendarId: calendar.id, startLocalDate: input.range.startLocalDate, endLocalDate: input.range.endLocalDate,
      paginationComplete: reasons.length === 0, itemCount });
  }
  return { ok: true, snapshot: snapshot(input, coverage, failures, [...events.values()], [...tombstones.values()], unexpanded) };
}
