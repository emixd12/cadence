import { Temporal } from "@js-temporal/polyfill";
import { sanitizeGoogleCalendarText } from "@/lib/services/google-calendar-provider";
import { ProviderCallTimeoutError, runProviderCallWithTimeout } from "@/lib/services/provider-call-timeout";
import { OUTLOOK_WINDOWS_ZONES } from "@/lib/services/outlook-calendar-windows-zones";
import {
  externalEventNormalizedId,
  validateVersionedExternalEventSnapshot,
} from "@cadence/core/services/external-event-validation";
import type {
  ExternalEventAvailability,
  ExternalEventField,
  ExternalEventFieldAvailability,
  ExternalEventOriginalStart,
  ExternalEventResponseStatus,
  ExternalEventRevision,
  NormalizedExternalEvent,
} from "@cadence/core/types/day-progress";
import {
  EXTERNAL_EVENT_MAX_CALENDARS,
  EXTERNAL_EVENT_MAX_RANGE_DAYS,
  EXTERNAL_EVENT_SCHEMA_VERSION_1_1,
  OUTLOOK_CALENDAR_ADAPTER_VERSION,
  type ExternalEventCancellationTombstoneV1_1,
  type ExternalEventCapabilities,
  type ExternalEventCoverage,
  type ExternalEventErrorCode,
  type ExternalEventFailure,
  type ExternalEventRequestedRange,
  type ExternalEventSnapshotV1_1,
} from "@cadence/core/types/external-event";

// Ticket 237 Microsoft Graph adapter. It exposes exactly two read-only
// operations: list the signed-in user's calendars and read one calendar's
// calendarView. Every request is GET to https://graph.microsoft.com/v1.0/me/calendars...
// and every @odata.nextLink is checked against that origin and path before the
// bearer token is attached. One absolute deadline spans every page and retry.
const GRAPH_ORIGIN = "https://graph.microsoft.com";
const CALENDARS_PATH = "/v1.0/me/calendars";
const MAX_PAGES = 20;
const MAX_RETRIES = 2;
const ATTEMPT_TIMEOUT_MS = 10_000;
export const OUTLOOK_READ_DEADLINE_MS = 25_000;
const MAX_EVENT_PAGE_BYTES = 5_000_000;
const MAX_CALENDAR_PAGE_BYTES = 1_000_000;
const MAX_TEXT = 1_024;
// Graph documents that lastModifiedDateTime does not support $select on calendarView,
// so the revision normally comes from changeKey; a returned lastModifiedDateTime is still used.
const CALENDAR_SELECT = "id,name,isDefaultCalendar";
const EVENT_SELECT = "id,subject,isAllDay,isCancelled,showAs,type,seriesMasterId,originalStart,originalStartTimeZone,responseStatus,changeKey,webLink,start,end";
/** Outlook on the web hosts that Graph returns in `webLink`. Any other host is dropped. */
const WEB_LINK_HOSTS = new Set(["outlook.office365.com", "outlook.office.com", "outlook.live.com"]);
const UNSUPPORTED_DETAILS = ["description", "location", "organizer", "attendees", "conference", "attachments"] as const;

export type OutlookCalendar = Readonly<{ id: string; name: string; isDefault: boolean }>;
export type OutlookGraphFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;
export type OutlookQuarantineReason = "timezone_unresolved" | "not_midnight" | "invalid_interval" | "unexpected_response_timezone" | "series_master" | "malformed_item";

/** Shared request controls. `deadlineAt` is an absolute clock value from `now`. */
export type OutlookGraphRequestOptions = Readonly<{
  accessToken: string;
  deadlineAt: number;
  now?: () => number;
  fetch?: OutlookGraphFetch;
  signal?: AbortSignal;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
}>;

export type OutlookCalendarReadInput = OutlookGraphRequestOptions & Readonly<{
  accountId: string;
  connectionGeneration: number;
  calendars: readonly OutlookCalendar[];
  range: ExternalEventRequestedRange;
  fetchedAt: string;
}>;

export type OutlookCalendarReadResult =
  | Readonly<{ ok: true; snapshot: ExternalEventSnapshotV1_1 }>
  | Readonly<{ ok: false; error: ExternalEventFailure; partialSnapshot: ExternalEventSnapshotV1_1 }>;

export class OutlookCalendarProviderError extends Error {
  constructor(public readonly failure: ExternalEventFailure) {
    super(failure.message);
    this.name = "OutlookCalendarProviderError";
  }
}

class ItemError extends Error {}

function failure(code: ExternalEventErrorCode, calendarId: string | null, retryable: boolean, retryAfterSeconds: number | null, message: string): ExternalEventFailure {
  return { code, calendarId, retryable, retryAfterSeconds, message };
}

/**
 * Accepts only an HTTPS Graph v1.0 URL on the default port under the user's own
 * calendars. Callers validate every provider-supplied next link with this
 * before any credential is sent.
 */
export function outlookGraphUrlAllowed(value: string, kind: "calendars" | "calendarView"): URL | null {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.origin !== GRAPH_ORIGIN || url.protocol !== "https:" || url.port || url.username || url.password || url.hash) return null;
  const path = url.pathname.toLowerCase();
  if (kind === "calendars") return path === CALENDARS_PATH.toLowerCase() ? minimalSelect(url, CALENDAR_SELECT) : null;
  const prefix = `${CALENDARS_PATH.toLowerCase()}/`;
  if (!path.startsWith(prefix) || !path.endsWith("/calendarview")) return null;
  const middle = path.slice(prefix.length, -"/calendarview".length);
  return middle && !middle.includes("/") ? minimalSelect(url, EVENT_SELECT) : null;
}

/**
 * Ticket 242: Calendars.Read lets Graph return bodies, attachments, and
 * extensions, so every request, including provider-supplied next links, must
 * select only contract fields. A next link that expands or selects anything
 * else is refused; one without `$select` gets the contract list appended.
 */
function minimalSelect(url: URL, select: string): URL | null {
  const allowed = new Set(select.split(","));
  for (const [key, value] of url.searchParams) {
    const name = key.toLowerCase();
    if (name === "$expand" || name === "expand") return null;
    if ((name === "$select" || name === "select") && (key !== "$select" || !value.split(",").every((field) => allowed.has(field)))) return null;
  }
  if (url.searchParams.getAll("$select").length > 1) return null;
  // Append rather than re-serialize, so an opaque skip token keeps its exact encoding.
  if (!url.searchParams.has("$select")) url.search = `${url.search ? `${url.search}&` : "?"}$select=${select}`;
  return url;
}

/**
 * The decoded calendar ID in an allowed calendarView URL. Graph may return the
 * segment raw (`AAMk=`) or encoded (`AAMk%3D`); both decode to the same ID.
 * Malformed escapes return null.
 */
export function outlookCalendarIdFromViewUrl(url: URL): string | null {
  const raw = url.pathname.slice(`${CALENDARS_PATH}/`.length, -"/calendarView".length);
  try { return decodeURIComponent(raw); } catch { return null; }
}

async function readBoundedJson(response: Response, limit: number, signal: AbortSignal): Promise<unknown> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) throw new ItemError("too_large");
  const reader = response.body?.getReader();
  if (!reader) throw new ItemError("empty");
  // Release a stalled stream once the attempt ends.
  signal.addEventListener("abort", () => { void reader.cancel().catch(() => undefined); }, { once: true });
  const chunks: Uint8Array[] = []; let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > limit) { await reader.cancel().catch(() => undefined); throw new ItemError("too_large"); }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function retryAfter(value: string | null): number | null {
  return value && /^\d{1,6}$/.test(value) ? Number(value) : null;
}

function httpFailure(status: number, calendarId: string | null, seconds: number | null): ExternalEventFailure {
  if (status === 401) return failure("reconnect_required", calendarId, false, null, "Outlook Calendar requires reconnection.");
  if (status === 403) return failure("permission_denied", calendarId, false, null, "Outlook Calendar denied the read.");
  if (status === 429) return failure("rate_limited", calendarId, true, seconds, "Outlook Calendar rate limited the read.");
  if (status >= 500) return failure("provider_unavailable", calendarId, true, seconds, "Outlook Calendar is unavailable.");
  if (status === 400) return failure("invalid_request", calendarId, false, null, "Outlook Calendar rejected the bounded read.");
  return failure("provider_unavailable", calendarId, false, null, "Outlook Calendar could not read this calendar.");
}

function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, milliseconds);
    signal?.addEventListener("abort", () => { clearTimeout(timeout); reject(signal.reason); }, { once: true });
  });
}

/**
 * One GET with the shared deadline rule: each attempt times out at 10 s or the
 * remaining time; at most two retries; `Retry-After` is honored only when the
 * wait plus one second fits before the deadline, otherwise the read stops with
 * `retryAfterSeconds`.
 */
async function graphGet(url: URL, options: OutlookGraphRequestOptions, calendarId: string | null, limit: number, prefer: boolean): Promise<unknown> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? wait;
  const random = options.random ?? Math.random;
  const timeout = (retryAfterSeconds: number | null = null) =>
    new OutlookCalendarProviderError(failure("timeout", calendarId, true, retryAfterSeconds, "Outlook Calendar read deadline ended."));
  let last: ExternalEventFailure = failure("timeout", calendarId, true, null, "Outlook Calendar read deadline ended.");
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const remaining = options.deadlineAt - now();
    if (remaining <= 0 || options.signal?.aborted) throw timeout(last.retryAfterSeconds);
    const attemptMs = Math.min(ATTEMPT_TIMEOUT_MS, remaining);
    const signal = AbortSignal.any([AbortSignal.timeout(attemptMs), ...(options.signal ? [options.signal] : [])]);
    let outcome: Readonly<{ ok: true; body: unknown }> | Readonly<{ ok: false; status: number; retryAfter: number | null }> | null = null;
    try {
      // The fetch and the bounded body read share one attempt budget. The wrapper
      // settles on abort even if a fetch implementation or body stream ignores it.
      outcome = await runProviderCallWithTimeout(async (attemptSignal) => {
        const response = await (options.fetch ?? fetch)(url, { method: "GET", cache: "no-store", redirect: "error", signal: attemptSignal,
          headers: { Authorization: `Bearer ${options.accessToken}`, Accept: "application/json", ...(prefer ? { Prefer: "IdType=\"ImmutableId\"" } : {}) } });
        if (!response.ok) {
          void response.body?.cancel().catch(() => undefined);
          return { ok: false as const, status: response.status, retryAfter: retryAfter(response.headers.get("retry-after")) };
        }
        return { ok: true as const, body: await readBoundedJson(response, limit, attemptSignal) };
      }, { timeoutMs: attemptMs, signal });
    } catch (error) {
      if (error instanceof ItemError && error.message === "too_large") throw new OutlookCalendarProviderError(failure("incomplete_pagination", calendarId, false, null, "Outlook Calendar response exceeded the size limit."));
      if (error instanceof ProviderCallTimeoutError || signal.aborted) last = failure("timeout", calendarId, true, null, "Outlook Calendar request timed out.");
      else if (error instanceof ItemError || error instanceof SyntaxError) throw new OutlookCalendarProviderError(failure("malformed_provider_response", calendarId, false, null, "Outlook Calendar returned invalid JSON."));
      else last = failure("provider_unavailable", calendarId, true, null, "Outlook Calendar request failed.");
    }
    // A response that completes after the absolute deadline is discarded.
    if (now() >= options.deadlineAt) throw timeout(outcome && !outcome.ok ? outcome.retryAfter : null);
    if (outcome?.ok) return outcome.body;
    if (outcome) last = httpFailure(outcome.status, calendarId, outcome.retryAfter);
    if (!last.retryable || attempt === MAX_RETRIES) break;
    const delay = last.retryAfterSeconds !== null ? last.retryAfterSeconds * 1_000 + 1_000
      : Math.min(5_000, 250 * (2 ** attempt) + Math.floor(random() * 100));
    if (now() + delay >= options.deadlineAt) break;
    try { await sleep(last.retryAfterSeconds !== null ? last.retryAfterSeconds * 1_000 : delay, options.signal); }
    catch { throw timeout(); }
  }
  throw new OutlookCalendarProviderError(last);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ItemError(`${path} must be an object`);
  return value as Record<string, unknown>;
}
function boundedId(value: unknown, path: string): string {
  if (typeof value !== "string" || !value || value.length > MAX_TEXT) throw new ItemError(`${path} must be a bounded identifier`);
  return value;
}
function nextLinkOf(page: Record<string, unknown>): string | null {
  const link = page["@odata.nextLink"];
  if (link === undefined || link === null) return null;
  if (typeof link !== "string" || link.length > 8_192) throw new ItemError("page.@odata.nextLink must be a string");
  return link;
}

/** Lists the signed-in user's calendars, at most 20 pages. */
export async function listOutlookCalendars(options: OutlookGraphRequestOptions): Promise<OutlookCalendar[]> {
  if (!options.accessToken) throw new TypeError("Outlook Calendar listing requires an access token.");
  const first = new URL(`${GRAPH_ORIGIN}${CALENDARS_PATH}`);
  first.searchParams.set("$select", CALENDAR_SELECT);
  let url: URL | null = first;
  const seen = new Set<string>();
  const calendars = new Map<string, OutlookCalendar>();
  for (let page = 0; page < MAX_PAGES && url; page += 1) {
    if (seen.has(url.toString())) throw new OutlookCalendarProviderError(failure("incomplete_pagination", null, false, null, "Outlook Calendar repeated a calendar-list page."));
    seen.add(url.toString());
    const body = await graphGet(url, options, null, MAX_CALENDAR_PAGE_BYTES, false);
    let link: string | null;
    try {
      const value = record(body, "calendars");
      const items = value.value;
      if (!Array.isArray(items)) throw new ItemError("calendars.value must be an array");
      items.forEach((item, index) => {
        const entry = record(item, `calendars.value[${index}]`);
        const id = boundedId(entry.id, `calendars.value[${index}].id`);
        const name = typeof entry.name === "string" ? sanitizeGoogleCalendarText(entry.name, MAX_TEXT, false) : "";
        if (!name) throw new ItemError(`calendars.value[${index}].name is empty`);
        calendars.set(id, { id, name, isDefault: entry.isDefaultCalendar === true });
      });
      link = nextLinkOf(value);
    } catch (error) {
      throw new OutlookCalendarProviderError(failure("malformed_provider_response", null, false, null,
        error instanceof ItemError ? error.message : "Outlook Calendar returned a malformed calendar list."));
    }
    if (!link) return [...calendars.values()].sort((left, right) => Number(right.isDefault) - Number(left.isDefault) || left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
    url = outlookGraphUrlAllowed(link, "calendars");
    if (!url) throw new OutlookCalendarProviderError(failure("malformed_provider_response", null, false, null, "Outlook Calendar returned a next page outside Microsoft Graph."));
  }
  throw new OutlookCalendarProviderError(failure("incomplete_pagination", null, false, null, `Outlook Calendar exceeded the ${MAX_PAGES}-page calendar-list limit.`));
}

/**
 * Resolves `originalStartTimeZone`: a Windows name only through the pinned CLDR
 * table, otherwise an IANA name that Temporal accepts. Custom, missing, and
 * unmapped values return null.
 */
export function resolveOutlookTimezone(value: unknown): string | null {
  if (typeof value !== "string" || !value || value.length > 128 || value.startsWith("tzone://")) return null;
  const mapped = OUTLOOK_WINDOWS_ZONES.get(value);
  const candidate = mapped ?? (/^(?:UTC|[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)+)$/.test(value) ? value : null);
  if (!candidate) return null;
  try { Temporal.Instant.from("2026-01-01T00:00:00Z").toZonedDateTimeISO(candidate); return candidate; }
  catch { return null; }
}

/** Graph returns `dateTimeTimeZone` in UTC because Cadence sends no `Prefer: outlook.timezone`. */
function utcInstant(value: unknown, path: string): Temporal.Instant | "not_utc" {
  const entry = record(value, path);
  if (entry.timeZone !== "UTC") return "not_utc";
  if (typeof entry.dateTime !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?$/.test(entry.dateTime)) {
    throw new ItemError(`${path}.dateTime is invalid`);
  }
  return Temporal.PlainDateTime.from(entry.dateTime).toZonedDateTime("UTC").toInstant();
}
function offsetInstant(value: unknown, path: string): Temporal.Instant {
  if (typeof value !== "string" || value.length > 64) throw new ItemError(`${path} is invalid`);
  try { return Temporal.Instant.from(value); } catch { throw new ItemError(`${path} is invalid`); }
}
function isMidnight(value: Temporal.ZonedDateTime): boolean {
  return value.hour === 0 && value.minute === 0 && value.second === 0 && value.millisecond === 0 && value.microsecond === 0 && value.nanosecond === 0;
}

function availability(showAs: unknown): ExternalEventAvailability {
  if (showAs === "free") return "free";
  if (showAs === "busy" || showAs === "oof") return "busy";
  return "unknown";
}
function userResponse(value: unknown): ExternalEventResponseStatus | null {
  if (value === undefined || value === null) return null;
  const response = record(value, "event.responseStatus").response;
  if (response === undefined || response === null || response === "none") return null;
  if (response === "accepted" || response === "organizer") return "accepted";
  if (response === "declined") return "declined";
  if (response === "tentativelyAccepted") return "tentative";
  if (response === "notResponded") return "needs_action";
  return "unknown";
}
function revision(item: Record<string, unknown>): ExternalEventRevision {
  const updated = item.lastModifiedDateTime === undefined || item.lastModifiedDateTime === null ? null : offsetInstant(item.lastModifiedDateTime, "event.lastModifiedDateTime").toString();
  const etag = typeof item.changeKey === "string" && item.changeKey && item.changeKey.length <= MAX_TEXT ? item.changeKey : null;
  return { availability: updated !== null || etag !== null ? "available" : "unavailable", providerUpdatedAt: updated, providerEtag: etag };
}
function webLink(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && WEB_LINK_HOSTS.has(url.hostname) && !url.username && !url.password && !url.port && !/\s/.test(value) ? url.toString() : null;
  } catch { return null; }
}

export type OutlookAdapterContext = Readonly<{ calendar: OutlookCalendar; range: ExternalEventRequestedRange }>;
export type OutlookAdaptedItem =
  | Readonly<{ kind: "event"; event: NormalizedExternalEvent }>
  | Readonly<{ kind: "tombstone"; tombstone: ExternalEventCancellationTombstoneV1_1 }>
  | Readonly<{ kind: "quarantine"; reason: OutlookQuarantineReason }>
  | Readonly<{ kind: "outside_range" }>;

/** Maps one calendarView item. Unknown enum values become `unknown`; unknown properties are ignored. */
export function adaptOutlookEvent(value: unknown, context: OutlookAdapterContext): OutlookAdaptedItem {
  let item: Record<string, unknown>;
  try { item = record(value, "event"); } catch { return { kind: "quarantine", reason: "malformed_item" }; }
  // Shape errors and out-of-range dates (Temporal RangeError) quarantine only this item.
  try { return adaptRecord(item, context); }
  catch { return { kind: "quarantine", reason: "malformed_item" }; }
}

function adaptRecord(item: Record<string, unknown>, context: OutlookAdapterContext): OutlookAdaptedItem {
  const { calendar, range } = context;
  const providerEventId = boundedId(item.id, "event.id");
  if (item.type === "seriesMaster") return { kind: "quarantine", reason: "series_master" };
  if (typeof item.isAllDay !== "boolean") throw new ItemError("event.isAllDay must be boolean");
  const zone = resolveOutlookTimezone(item.originalStartTimeZone);
  const rangeStart = Temporal.PlainDate.from(range.startLocalDate);
  const rangeEndExclusive = Temporal.PlainDate.from(range.endLocalDate).add({ days: 1 });
  const windowStart = rangeStart.toZonedDateTime(range.timezone).toInstant();
  const windowEnd = rangeEndExclusive.toZonedDateTime(range.timezone).toInstant();
  const start = utcInstant(item.start, "event.start");
  const end = utcInstant(item.end, "event.end");
  if (start === "not_utc" || end === "not_utc") return { kind: "quarantine", reason: "unexpected_response_timezone" };
  if (Temporal.Instant.compare(end, start) <= 0) return { kind: "quarantine", reason: "invalid_interval" };

  // Recurrence identity: series master plus original start, never iCalUId alone.
  let recurrence: NormalizedExternalEvent["recurrence"] = null;
  if (item.type === "occurrence" || item.type === "exception") {
    const seriesId = boundedId(item.seriesMasterId, "event.seriesMasterId");
    const original = offsetInstant(item.originalStart, "event.originalStart");
    let originalStart: ExternalEventOriginalStart;
    if (item.isAllDay) {
      if (!zone) return { kind: "quarantine", reason: "timezone_unresolved" };
      originalStart = { kind: "all_day", startLocalDate: original.toZonedDateTimeISO(zone).toPlainDate().toString() };
    } else originalStart = { kind: "timed", startAt: original.toString() };
    recurrence = { seriesId, originalStart };
  }
  const id = externalEventNormalizedId("outlook_calendar", [calendar.id, providerEventId]);
  const logicalInstanceId = recurrence
    ? externalEventNormalizedId("outlook_calendar", [calendar.id, recurrence.seriesId,
        recurrence.originalStart.kind === "timed" ? recurrence.originalStart.startAt : recurrence.originalStart.startLocalDate])
    : id;
  const eventRevision = revision(item);

  type Interval = { kind: "timed"; startAt: string; endAt: string; seconds: number } | { kind: "all_day"; startLocalDate: string; endLocalDate: string; days: number };
  let interval: Interval;
  if (item.isAllDay) {
    // All-day bounds are midnight in the event's own zone; never re-date them into the profile zone.
    if (!zone) return { kind: "quarantine", reason: "timezone_unresolved" };
    const localStart = start.toZonedDateTimeISO(zone);
    const localEnd = end.toZonedDateTimeISO(zone);
    if (!isMidnight(localStart) || !isMidnight(localEnd)) return { kind: "quarantine", reason: "not_midnight" };
    const first = localStart.toPlainDate(); const last = localEnd.toPlainDate();
    if (Temporal.PlainDate.compare(last, first) <= 0) return { kind: "quarantine", reason: "invalid_interval" };
    if (Temporal.PlainDate.compare(last, rangeStart) <= 0 || Temporal.PlainDate.compare(first, rangeEndExclusive) >= 0) return { kind: "outside_range" };
    interval = { kind: "all_day", startLocalDate: first.toString(), endLocalDate: last.toString(), days: first.until(last).days };
  } else {
    if (Temporal.Instant.compare(end, windowStart) <= 0 || Temporal.Instant.compare(start, windowEnd) >= 0) return { kind: "outside_range" };
    interval = { kind: "timed", startAt: start.toString(), endAt: end.toString(), seconds: start.until(end).total({ unit: "seconds" }) };
  }

  if (item.isCancelled === true) {
    return { kind: "tombstone", tombstone: { id, providerEventId, logicalInstanceId, calendarId: calendar.id, source: "outlook_calendar", recurrence, revision: eventRevision } };
  }
  const title = typeof item.subject === "string" ? sanitizeGoogleCalendarText(item.subject, MAX_TEXT, false) : "";
  const sourceUrl = webLink(item.webLink);
  const fieldAvailability: Partial<Record<ExternalEventField, ExternalEventFieldAvailability>> = {};
  for (const field of UNSUPPORTED_DETAILS) fieldAvailability[field] = "unsupported";
  if (!title) fieldAvailability.title = "not_provided";
  if (!sourceUrl) fieldAvailability.source_url = "not_provided";
  const base = {
    id, providerEventId, logicalInstanceId, calendarId: calendar.id, source: "outlook_calendar" as const, calendarName: calendar.name,
    sourceTimezone: zone ?? range.timezone, sourceTimezoneFallback: zone ? "none" as const : "request" as const,
    // Graph has no confirmed/tentative event status.
    state: "unknown" as const, availability: availability(item.showAs), currentUserResponse: userResponse(item.responseStatus),
    revision: eventRevision, title, description: "", location: "", sourceUrl, fieldAvailability, detailCompleteness: {},
    organizer: null, attendees: null, attendeesOmitted: false, conference: null, recurrence, attachments: null,
  };
  const event: NormalizedExternalEvent = interval.kind === "timed"
    ? { ...base, kind: "timed", startAt: interval.startAt, endAt: interval.endAt, endUnspecified: false, duration: { kind: "known", seconds: interval.seconds } }
    : { ...base, kind: "all_day", startLocalDate: interval.startLocalDate, endLocalDate: interval.endLocalDate, duration: { kind: "calendar_days", days: interval.days } };
  return { kind: "event", event };
}

/** Query bounds carry explicit offsets and are widened by one day on each side for all-day events in distant zones. */
export function outlookCalendarViewUrl(calendarId: string, range: ExternalEventRequestedRange): URL {
  const start = Temporal.PlainDate.from(range.startLocalDate).subtract({ days: 1 }).toZonedDateTime(range.timezone);
  const end = Temporal.PlainDate.from(range.endLocalDate).add({ days: 2 }).toZonedDateTime(range.timezone);
  const url = new URL(`${GRAPH_ORIGIN}${CALENDARS_PATH}/${encodeURIComponent(calendarId)}/calendarView`);
  url.searchParams.set("startDateTime", start.toString({ timeZoneName: "never" }));
  url.searchParams.set("endDateTime", end.toString({ timeZoneName: "never" }));
  url.searchParams.set("$top", "1000");
  url.searchParams.set("$select", EVENT_SELECT);
  return url;
}

function validateReadInput(input: OutlookCalendarReadInput): void {
  if (!input.accessToken || !input.accountId || !Number.isSafeInteger(input.connectionGeneration) || input.connectionGeneration < 1) {
    throw new TypeError("Outlook Calendar reads require a token, account, and positive connection generation.");
  }
  Temporal.Instant.from(input.fetchedAt);
  const start = Temporal.PlainDate.from(input.range.startLocalDate);
  const end = Temporal.PlainDate.from(input.range.endLocalDate);
  start.toZonedDateTime(input.range.timezone);
  if (start.until(end).days < 0 || start.until(end).days + 1 > EXTERNAL_EVENT_MAX_RANGE_DAYS) throw new RangeError("Outlook Calendar reads must cover 1-31 days.");
  const ids = input.calendars.map((calendar) => calendar.id);
  if (ids.length < 1 || ids.length > EXTERNAL_EVENT_MAX_CALENDARS || ids.some((id) => !id) || new Set(ids).size !== ids.length ||
    ids.length !== input.range.selectedCalendarIds.length || ids.some((id) => !input.range.selectedCalendarIds.includes(id))) {
    throw new TypeError("Outlook Calendar input must match 1-32 unique selected calendars.");
  }
}

function capabilities(complete: boolean, failures: readonly ExternalEventFailure[]): ExternalEventCapabilities {
  const permission = failures.some((item) => item.code === "permission_denied") ? "denied" as const
    : failures.some((item) => item.code === "reconnect_required") ? "unknown" as const : "granted" as const;
  const capability = { support: "supported" as const, permission, availability: complete ? "available" as const : "degraded" as const };
  return { calendar_listing: capability, timed_events: capability, all_day_events: capability, recurrence: capability, details: capability, source_links: capability };
}

function compareIdentity(left: { calendarId: string; providerEventId: string }, right: { calendarId: string; providerEventId: string }): number {
  return left.calendarId.localeCompare(right.calendarId) || left.providerEventId.localeCompare(right.providerEventId);
}

function snapshot(input: OutlookCalendarReadInput, coverage: ExternalEventCoverage[], failures: ExternalEventFailure[],
  events: NormalizedExternalEvent[], tombstones: ExternalEventCancellationTombstoneV1_1[]): ExternalEventSnapshotV1_1 {
  const complete = failures.length === 0 && coverage.length === input.calendars.length && coverage.every((item) => item.paginationComplete);
  return validateVersionedExternalEventSnapshot({
    schemaVersion: EXTERNAL_EVENT_SCHEMA_VERSION_1_1,
    adapterVersion: OUTLOOK_CALENDAR_ADAPTER_VERSION,
    accountId: input.accountId,
    connectionGeneration: input.connectionGeneration,
    source: "outlook_calendar",
    requestedRange: input.range,
    fetchedAt: input.fetchedAt,
    completeness: complete ? "complete" : "incomplete",
    freshness: { state: complete ? "current" : "incomplete", refreshedAt: complete ? input.fetchedAt : null,
      label: complete ? "Calendar current" : "Calendar data incomplete", canAssertNoOverlap: complete },
    capabilities: capabilities(complete, failures),
    coverage,
    failures,
    events: events.sort(compareIdentity),
    tombstones: tombstones.sort(compareIdentity),
  }) as ExternalEventSnapshotV1_1;
}

/**
 * Reads each selected calendar sequentially (Outlook allows four concurrent
 * requests per app and mailbox). Quarantined items keep the read going but mark
 * that calendar's coverage incomplete with a recorded reason. A request failure
 * stops the read and returns the partial snapshot.
 */
export async function readOutlookCalendarEvents(input: OutlookCalendarReadInput): Promise<OutlookCalendarReadResult> {
  validateReadInput(input);
  const events = new Map<string, NormalizedExternalEvent>();
  const tombstones = new Map<string, ExternalEventCancellationTombstoneV1_1>();
  const coverage: ExternalEventCoverage[] = [];
  const failures: ExternalEventFailure[] = [];
  for (const calendar of input.calendars) {
    let itemCount = 0;
    const quarantined = new Map<OutlookQuarantineReason, number>();
    let url: URL | null = outlookCalendarViewUrl(calendar.id, input.range);
    const seen = new Set<string>();
    try {
      for (let page = 0; ; page += 1) {
        if (page >= MAX_PAGES) throw new OutlookCalendarProviderError(failure("incomplete_pagination", calendar.id, false, null, `Outlook Calendar exceeded the ${MAX_PAGES}-page read limit.`));
        if (seen.has(url.toString())) throw new OutlookCalendarProviderError(failure("incomplete_pagination", calendar.id, false, null, "Outlook Calendar repeated a page."));
        seen.add(url.toString());
        const body = await graphGet(url, input, calendar.id, MAX_EVENT_PAGE_BYTES, true);
        let items: unknown[]; let link: string | null;
        try {
          const page = record(body, "calendarView");
          if (!Array.isArray(page.value)) throw new ItemError("calendarView.value must be an array");
          items = page.value; link = nextLinkOf(page);
        } catch (error) {
          throw new OutlookCalendarProviderError(failure("malformed_provider_response", calendar.id, false, null,
            error instanceof ItemError ? error.message : "Outlook Calendar returned a malformed page."));
        }
        itemCount += items.length;
        for (const raw of items) {
          const adapted = adaptOutlookEvent(raw, { calendar, range: input.range });
          if (adapted.kind === "event") { events.set(adapted.event.id, adapted.event); tombstones.delete(adapted.event.id); }
          else if (adapted.kind === "tombstone") { tombstones.set(adapted.tombstone.id, adapted.tombstone); events.delete(adapted.tombstone.id); }
          else if (adapted.kind === "quarantine") quarantined.set(adapted.reason, (quarantined.get(adapted.reason) ?? 0) + 1);
        }
        if (!link) break;
        // Validate the provider-supplied destination before the bearer token is attached.
        url = outlookGraphUrlAllowed(link, "calendarView");
        if (!url || outlookCalendarIdFromViewUrl(url) !== calendar.id) {
          throw new OutlookCalendarProviderError(failure("malformed_provider_response", calendar.id, false, null, "Outlook Calendar returned a next page outside this calendar."));
        }
      }
    } catch (error) {
      const readFailure = error instanceof OutlookCalendarProviderError ? error.failure
        : failure(input.signal?.aborted ? "timeout" : "provider_unavailable", calendar.id, !input.signal?.aborted, null, "Outlook Calendar event retrieval failed.");
      coverage.push({ calendarId: calendar.id, startLocalDate: input.range.startLocalDate, endLocalDate: input.range.endLocalDate, paginationComplete: false, itemCount });
      failures.push(readFailure);
      return { ok: false, error: readFailure, partialSnapshot: snapshot(input, coverage, failures, [...events.values()], [...tombstones.values()]) };
    }
    const reasons = [...quarantined.entries()].sort(([left], [right]) => left.localeCompare(right));
    if (reasons.length > 0) {
      failures.push(failure("malformed_provider_response", calendar.id, false, null,
        `Outlook Calendar quarantined events: ${reasons.map(([reason, count]) => `${reason}=${count}`).join(", ")}.`));
    }
    coverage.push({ calendarId: calendar.id, startLocalDate: input.range.startLocalDate, endLocalDate: input.range.endLocalDate,
      paginationComplete: reasons.length === 0, itemCount });
  }
  return { ok: true, snapshot: snapshot(input, coverage, failures, [...events.values()], [...tombstones.values()]) };
}
