import { readFileSync } from "node:fs";
import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it, vi } from "vitest";
import {
  OUTLOOK_READ_DEADLINE_MS,
  OutlookCalendarProviderError,
  adaptOutlookEvent,
  listOutlookCalendars,
  outlookCalendarViewUrl,
  outlookGraphUrlAllowed,
  readOutlookCalendarEvents,
  resolveOutlookTimezone,
  type OutlookCalendar,
  type OutlookCalendarReadInput,
} from "@/lib/services/outlook-calendar-provider";
import { OUTLOOK_WINDOWS_ZONES, OUTLOOK_WINDOWS_ZONES_CLDR_RELEASE } from "@/lib/services/outlook-calendar-windows-zones";
import { validateVersionedExternalEventSnapshot } from "@cadence/core/services/external-event-validation";

// Synthetic Microsoft Graph responses only. No live tenant, account, or token.
const TOKEN = "synthetic-graph-access-token";
const CAL: OutlookCalendar = { id: "calendar-1", name: "Personal", isDefault: true };
const RANGE = { startLocalDate: "2026-11-01", endLocalDate: "2026-11-03", timezone: "America/New_York", selectedCalendarIds: ["calendar-1"] };
const VIEW_PATH = "/v1.0/me/calendars/calendar-1/calendarView";

type Call = { url: string; init: RequestInit };
function clock(start = 0) { let now = start; return { now: () => now, advance: (ms: number) => { now += ms; } }; }
function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}
function harness(responses: Array<Response | ((call: Call) => Response | Promise<Response>)>, options: { stepMs?: number } = {}) {
  const time = clock();
  const calls: Call[] = [];
  const sleeps: number[] = [];
  const fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const call = { url: url.toString(), init: init ?? {} };
    calls.push(call);
    time.advance(options.stepMs ?? 0);
    const next = responses.shift();
    if (!next) throw new Error("unexpected request");
    return typeof next === "function" ? next(call) : next;
  });
  const sleep = vi.fn(async (ms: number) => { sleeps.push(ms); time.advance(ms); });
  return { time, calls, sleeps, fetch, sleep };
}
function input(h: ReturnType<typeof harness>, overrides: Partial<OutlookCalendarReadInput> = {}): OutlookCalendarReadInput {
  return { accessToken: TOKEN, accountId: "account-1", connectionGeneration: 2, calendars: [CAL], range: RANGE, fetchedAt: "2026-11-01T13:00:00Z",
    deadlineAt: h.time.now() + OUTLOOK_READ_DEADLINE_MS, now: h.time.now, fetch: h.fetch, sleep: h.sleep, random: () => 0, ...overrides };
}
function utc(dateTime: string) { return { dateTime, timeZone: "UTC" }; }
function timed(id: string, start: string, end: string, extra: Record<string, unknown> = {}) {
  return { id, subject: `Event ${id}`, isAllDay: false, isCancelled: false, showAs: "busy", type: "singleInstance", originalStartTimeZone: "Eastern Standard Time",
    responseStatus: { response: "organizer", time: "0001-01-01T00:00:00Z" }, changeKey: `ck-${id}`, lastModifiedDateTime: "2026-10-30T12:00:00.1230000Z",
    webLink: `https://outlook.live.com/calendar/item/${id}`, start: utc(start), end: utc(end), ...extra };
}
function allDay(id: string, start: string, end: string, zone: string, extra: Record<string, unknown> = {}) {
  return timed(id, start, end, { isAllDay: true, originalStartTimeZone: zone, showAs: "free", ...extra });
}
function page(value: unknown[], nextLink?: string) { return json(nextLink ? { value, "@odata.nextLink": nextLink } : { value }); }

describe("pinned CLDR Windows zone mapping", () => {
  it("is the complete territory-001 table from CLDR 48.2 and every target is a valid IANA zone", () => {
    expect(OUTLOOK_WINDOWS_ZONES_CLDR_RELEASE).toBe("48.2");
    expect(OUTLOOK_WINDOWS_ZONES.size).toBe(139);
    for (const zone of OUTLOOK_WINDOWS_ZONES.values()) expect(() => Temporal.Instant.from("2026-01-01T00:00:00Z").toZonedDateTimeISO(zone)).not.toThrow();
    expect(OUTLOOK_WINDOWS_ZONES.get("Pacific Standard Time")).toBe("America/Los_Angeles");
    expect(OUTLOOK_WINDOWS_ZONES.get("Eastern Standard Time")).toBe("America/New_York");
    expect(OUTLOOK_WINDOWS_ZONES.get("Romance Standard Time")).toBe("Europe/Paris");
  });

  it("resolves Windows names only through the table, accepts IANA names, and refuses custom or unknown zones", () => {
    expect(resolveOutlookTimezone("Pacific Standard Time")).toBe("America/Los_Angeles");
    expect(resolveOutlookTimezone("Europe/Madrid")).toBe("Europe/Madrid");
    expect(resolveOutlookTimezone("America/Toronto")).toBe("America/Toronto");
    for (const value of ["tzone://Microsoft/Custom", "Customized Time Zone", "Pacific Time", "", undefined, null, "+05:00", "constructor", "__proto__", "x".repeat(200)]) {
      expect(resolveOutlookTimezone(value)).toBeNull();
    }
  });
});

describe("Graph request boundary", () => {
  it("builds widened offset-bearing calendarView bounds without a timezone preference", () => {
    const url = outlookCalendarViewUrl("calendar-1", RANGE);
    expect(url.origin + url.pathname).toBe(`https://graph.microsoft.com${VIEW_PATH}`);
    expect(url.searchParams.get("startDateTime")).toBe("2026-10-31T00:00:00-04:00");
    // Widened to the second midnight after the inclusive end date (EST after the November 1 transition).
    expect(url.searchParams.get("endDateTime")).toBe("2026-11-05T00:00:00-05:00");
    expect(url.searchParams.get("$top")).toBe("1000");
    expect(url.searchParams.get("$select")).not.toMatch(/body|attendees|organizer|location|onlineMeeting/);
    // Graph documents that lastModifiedDateTime does not support $select on calendarView.
    expect(url.searchParams.get("$select")!.split(",")).not.toContain("lastModifiedDateTime");
    expect(url.searchParams.get("$select")!.split(",")).toContain("changeKey");
  });

  it("sends only GET requests with immutable IDs and no outlook.timezone header", async () => {
    const h = harness([page([])]);
    const result = await readOutlookCalendarEvents(input(h));
    expect(result.ok).toBe(true);
    const [call] = h.calls;
    expect(call!.init.method).toBe("GET");
    expect(call!.init.redirect).toBe("error");
    const headers = call!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(headers.Prefer).toBe("IdType=\"ImmutableId\"");
    expect(JSON.stringify(headers)).not.toContain("outlook.timezone");
  });

  it("allows next links only on the Graph origin, default port, and the same calendar path", () => {
    const ok = `https://graph.microsoft.com${VIEW_PATH}?$skiptoken=abc`;
    expect(outlookGraphUrlAllowed(ok, "calendarView")).not.toBeNull();
    expect(outlookGraphUrlAllowed("https://graph.microsoft.com/v1.0/me/calendars?$skiptoken=x", "calendars")).not.toBeNull();
    for (const bad of [
      "https://graph.microsoft.com.evil.example/v1.0/me/calendars/calendar-1/calendarView",
      "https://evil.example/v1.0/me/calendars/calendar-1/calendarView",
      "http://graph.microsoft.com/v1.0/me/calendars/calendar-1/calendarView",
      "https://graph.microsoft.com:8443/v1.0/me/calendars/calendar-1/calendarView",
      "https://user:pw@graph.microsoft.com/v1.0/me/calendars/calendar-1/calendarView",
      "https://graph.microsoft.com/v1.0/users/victim/calendars/calendar-1/calendarView",
      "https://graph.microsoft.com/v1.0/me/messages",
      "https://graph.microsoft.com/beta/me/calendars/calendar-1/calendarView",
      "https://graph.microsoft.com/v1.0/me/calendars/calendar-1/events",
      "https://graph.microsoft.com/v1.0/me/calendars/a/b/calendarView",
      "not a url",
    ]) expect(outlookGraphUrlAllowed(bad, "calendarView")).toBeNull();
  });
});

describe("Calendars.Read data minimization (Ticket 242)", () => {
  const EVENT_FIELDS = ["id", "subject", "isAllDay", "isCancelled", "showAs", "type", "seriesMasterId", "originalStart", "originalStartTimeZone",
    "responseStatus", "changeKey", "webLink", "start", "end"];
  const FORBIDDEN = /^(body|bodyPreview|attachments|hasAttachments|extensions|singleValueExtendedProperties|multiValueExtendedProperties|uniqueBody)$/i;
  function assertMinimal(raw: string, allowed: readonly string[]) {
    const url = new URL(raw);
    expect(url.searchParams.has("$expand")).toBe(false);
    const select = url.searchParams.get("$select");
    expect(select).not.toBeNull();
    const fields = select!.split(",");
    expect(fields.some((field) => FORBIDDEN.test(field))).toBe(false);
    expect(fields.every((field) => allowed.includes(field))).toBe(true);
  }

  it("selects only contract fields on calendarView and calendar listing", () => {
    expect(outlookCalendarViewUrl("calendar-1", RANGE).searchParams.get("$select")!.split(",").sort()).toEqual([...EVENT_FIELDS].sort());
    assertMinimal(outlookCalendarViewUrl("calendar-1", RANGE).toString(), EVENT_FIELDS);
  });

  it("keeps every paged request minimal and adds the select list when a next link omits it", async () => {
    const next = `https://graph.microsoft.com${VIEW_PATH}?$skip=1000`;
    const h = harness([page([], next), page([])]);
    const result = await readOutlookCalendarEvents(input(h));
    expect(result.ok).toBe(true);
    expect(h.calls).toHaveLength(2);
    for (const call of h.calls) assertMinimal(call.url, EVENT_FIELDS);
    const listNext = "https://graph.microsoft.com/v1.0/me/calendars?$skip=10";
    const l = harness([json({ value: [{ id: "b", name: "Work" }], "@odata.nextLink": listNext }), json({ value: [] })]);
    await listOutlookCalendars({ accessToken: TOKEN, deadlineAt: 25_000, now: l.time.now, fetch: l.fetch, sleep: l.sleep });
    for (const call of l.calls) assertMinimal(call.url, ["id", "name", "isDefaultCalendar"]);
  });

  it.each([
    `$select=id,subject,body&$skip=1000`,
    `$select=id,bodyPreview&$skip=1000`,
    `$select=id,subject&$expand=attachments`,
    `$expand=extensions&$skip=1000`,
    `%24expand=attachments&$skip=1000`,
    `$select=id,location&$skip=1000`,
  ])("refuses a calendarView next link that broadens the request (%s) before sending the token", async (query) => {
    const h = harness([page([], `https://graph.microsoft.com${VIEW_PATH}?${query}`)]);
    const result = await readOutlookCalendarEvents(input(h));
    expect(result.ok).toBe(false);
    expect(h.calls).toHaveLength(1);
    expect(outlookGraphUrlAllowed(`https://graph.microsoft.com${VIEW_PATH}?${query}`, "calendarView")).toBeNull();
  });

  it("keeps an opaque skip token byte-for-byte when appending the select list", () => {
    const raw = `https://graph.microsoft.com${VIEW_PATH}?%24skiptoken=a%2Bb+c%3D%3D`;
    expect(outlookGraphUrlAllowed(raw, "calendarView")!.toString().startsWith(`${raw}&$select=id,`)).toBe(true);
    const selected = `https://graph.microsoft.com${VIEW_PATH}?$select=id,subject&$skip=1000`;
    expect(outlookGraphUrlAllowed(selected, "calendarView")!.toString()).toBe(selected);
  });

  it("refuses a calendar-list next link that broadens the request", () => {
    expect(outlookGraphUrlAllowed("https://graph.microsoft.com/v1.0/me/calendars?$select=id,name,owner", "calendars")).toBeNull();
    expect(outlookGraphUrlAllowed("https://graph.microsoft.com/v1.0/me/calendars?$expand=events", "calendars")).toBeNull();
  });

  it("drops unexpected response fields before the validated snapshot", async () => {
    const marker = "SYNTHETIC-PRIVATE-DETAIL";
    const h = harness([page([timed("evt-1", "2026-11-01T14:00:00.0000000", "2026-11-01T15:00:00.0000000", {
      body: { contentType: "html", content: marker }, bodyPreview: marker, hasAttachments: true, attachments: [{ name: marker }],
      extensions: [{ id: marker }], location: { displayName: marker }, attendees: [{ emailAddress: { address: `${marker}@example.invalid` } }],
      organizer: { emailAddress: { name: marker } }, onlineMeeting: { joinUrl: `https://example.invalid/${marker}` }, categories: [marker], iCalUId: marker,
    })])]);
    const result = await readOutlookCalendarEvents(input(h));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.stringify(result.snapshot)).not.toContain(marker);
    expect(() => validateVersionedExternalEventSnapshot(result.snapshot)).not.toThrow();
    const [event] = result.snapshot.events;
    expect(event).toMatchObject({ title: "Event evt-1", description: "", location: "", organizer: null, attendees: null, conference: null, attachments: null });
  });
});

describe("calendarView mapping", () => {
  it("reproduces the approved Outlook 1.1.0 fixture, including a Pacific all-day event read by a New York profile", async () => {
    const fixture = JSON.parse(readFileSync("tests/fixtures/external-event-snapshot.outlook.valid.json", "utf8"));
    const h = harness([page([
      timed("timed-1", "2026-11-01T03:00:00.0000000", "2026-11-01T07:00:00.0000000", { subject: "Overnight shift",
        responseStatus: { response: "accepted" }, lastModifiedDateTime: "2026-10-30T12:00:00Z", changeKey: "change-key-1" }),
      // Pacific midnight on November 2 is 08:00Z; the date stays November 2 in New York.
      allDay("all-day-pacific", "2026-11-02T08:00:00.0000000", "2026-11-03T08:00:00.0000000", "Pacific Standard Time", { subject: "Pacific holiday",
        responseStatus: { response: "none" }, lastModifiedDateTime: "2026-10-29T08:00:00Z", changeKey: "change-key-2", webLink: undefined }),
    ])]);
    const result = await readOutlookCalendarEvents(input(h));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The adapter orders by provider ID; the fixture lists the same events in authoring order.
    const byId = (left: { id: string }, right: { id: string }) => left.id.localeCompare(right.id);
    expect({ ...result.snapshot, events: [...result.snapshot.events].sort(byId) }).toEqual({ ...fixture, events: [...fixture.events].sort(byId) });
  });

  it("maps overnight and DST spans by instant and keeps all-day dates across the DST change", async () => {
    const h = harness([page([
      timed("fallback", "2026-11-01T05:30:00", "2026-11-01T06:30:00"),
      allDay("dst-day", "2026-11-01T04:00:00", "2026-11-02T05:00:00", "Eastern Standard Time"),
      timed("before-window", "2026-10-31T02:00:00", "2026-11-01T05:00:00"),
      timed("ends-at-start", "2026-10-31T20:00:00", "2026-11-01T04:00:00", { id: "ends-at-start" }),
    ])]);
    const result = await readOutlookCalendarEvents(input(h));
    if (!result.ok) throw new Error("expected success");
    const byId = Object.fromEntries(result.snapshot.events.map((event) => [event.providerEventId, event]));
    expect(byId.fallback).toMatchObject({ kind: "timed", duration: { kind: "known", seconds: 3600 } });
    expect(byId["dst-day"]).toMatchObject({ kind: "all_day", startLocalDate: "2026-11-01", endLocalDate: "2026-11-02", duration: { days: 1 } });
    // An overnight event overlapping local midnight is kept; one ending exactly at the window start is not.
    expect(byId["before-window"]).toBeDefined();
    expect(byId["ends-at-start"]).toBeUndefined();
    expect(result.snapshot.completeness).toBe("complete");
  });

  it("keeps recurrence identity for occurrences and moved exceptions and tombstones cancelled instances", async () => {
    const series = { seriesMasterId: "series-1", originalStartTimeZone: "Eastern Standard Time" };
    const h = harness([page([
      timed("occ-1", "2026-11-01T14:00:00", "2026-11-01T15:00:00", { ...series, type: "occurrence", originalStart: "2026-11-01T14:00:00Z" }),
      timed("exc-2", "2026-11-02T18:00:00", "2026-11-02T19:00:00", { ...series, type: "exception", originalStart: "2026-11-02T15:00:00Z" }),
      timed("occ-3", "2026-11-03T15:00:00", "2026-11-03T16:00:00", { ...series, type: "occurrence", originalStart: "2026-11-03T15:00:00Z", isCancelled: true }),
      { ...timed("master", "2026-11-01T14:00:00", "2026-11-01T15:00:00"), type: "seriesMaster" },
    ])]);
    const result = await readOutlookCalendarEvents(input(h));
    if (!result.ok) throw new Error("expected success");
    const exception = result.snapshot.events.find((event) => event.providerEventId === "exc-2")!;
    expect(exception.recurrence).toEqual({ seriesId: "series-1", originalStart: { kind: "timed", startAt: "2026-11-02T15:00:00Z" } });
    expect(exception.logicalInstanceId).toBe("outlook_calendar/calendar-1/series-1/2026-11-02T15%3A00%3A00Z");
    expect(exception.id).toBe("outlook_calendar/calendar-1/exc-2");
    expect(result.snapshot.events.map((event) => event.providerEventId)).toEqual(["exc-2", "occ-1"]);
    expect(result.snapshot.tombstones).toEqual([expect.objectContaining({ providerEventId: "occ-3", source: "outlook_calendar",
      recurrence: { seriesId: "series-1", originalStart: { kind: "timed", startAt: "2026-11-03T15:00:00Z" } } })]);
    // A series master is never expanded client-side; it is quarantined with a reason.
    expect(result.snapshot.completeness).toBe("incomplete");
    expect(result.snapshot.failures[0]!.message).toContain("series_master=1");
  });

  it("quarantines unresolved and custom all-day zones and non-midnight bounds with recorded reasons", async () => {
    const h = harness([page([
      allDay("custom", "2026-11-02T08:00:00", "2026-11-03T08:00:00", "tzone://Microsoft/Custom"),
      allDay("missing", "2026-11-02T08:00:00", "2026-11-03T08:00:00", ""),
      allDay("offset", "2026-11-02T09:00:00", "2026-11-03T09:00:00", "Pacific Standard Time"),
      timed("timed-custom", "2026-11-02T15:00:00", "2026-11-02T16:00:00", { originalStartTimeZone: "tzone://Microsoft/Custom" }),
    ])]);
    const result = await readOutlookCalendarEvents(input(h));
    if (!result.ok) throw new Error("quarantine keeps the read going");
    const snapshot = result.snapshot;
    expect(snapshot.completeness).toBe("incomplete");
    expect(snapshot.freshness).toMatchObject({ state: "incomplete", canAssertNoOverlap: false });
    expect(snapshot.coverage).toEqual([expect.objectContaining({ calendarId: "calendar-1", paginationComplete: false, itemCount: 4 })]);
    expect(snapshot.failures).toEqual([expect.objectContaining({ code: "malformed_provider_response", calendarId: "calendar-1",
      message: "Outlook Calendar quarantined events: not_midnight=1, timezone_unresolved=2." })]);
    // A timed event with an unresolved zone keeps its instants and records the request-timezone fallback.
    expect(snapshot.events).toEqual([expect.objectContaining({ providerEventId: "timed-custom", sourceTimezone: "America/New_York", sourceTimezoneFallback: "request" })]);
    expect(() => validateVersionedExternalEventSnapshot(snapshot)).not.toThrow();
  });

  it("quarantines a response that is not in UTC instead of guessing its zone", () => {
    const item = { ...timed("x", "2026-11-02T10:00:00", "2026-11-02T11:00:00"), start: { dateTime: "2026-11-02T10:00:00", timeZone: "Pacific Standard Time" } };
    expect(adaptOutlookEvent(item, { calendar: CAL, range: RANGE })).toEqual({ kind: "quarantine", reason: "unexpected_response_timezone" });
    expect(adaptOutlookEvent({ ...timed("y", "2026-11-02T10:00:00", "2026-11-02T10:00:00") }, { calendar: CAL, range: RANGE })).toEqual({ kind: "quarantine", reason: "invalid_interval" });
    expect(adaptOutlookEvent({ ...timed("z", "2026-02-30T10:00:00", "2026-11-02T10:00:00") }, { calendar: CAL, range: RANGE })).toEqual({ kind: "quarantine", reason: "malformed_item" });
    expect(adaptOutlookEvent("not an object", { calendar: CAL, range: RANGE })).toEqual({ kind: "quarantine", reason: "malformed_item" });
  });

  it("maps unknown provider values honestly, drops unknown fields, and accepts only Outlook HTTPS links", () => {
    const adapted = adaptOutlookEvent(timed("u", "2026-11-02T10:00:00", "2026-11-02T11:00:00", { showAs: "workingElsewhere",
      responseStatus: { response: "futureValue" }, webLink: "https://phish.example/calendar/item/u", body: { content: "<b>secret</b>" },
      subject: " <b>Plan</b>\u0007 ", attendees: [{ emailAddress: { address: "person@example.invalid" } }] }), { calendar: CAL, range: RANGE });
    if (adapted.kind !== "event") throw new Error("expected event");
    expect(adapted.event).toMatchObject({ availability: "unknown", currentUserResponse: "unknown", sourceUrl: null, state: "unknown",
      title: "<b>Plan</b>", description: "", attendees: null, organizer: null });
    expect(adapted.event.fieldAvailability).toMatchObject({ source_url: "not_provided", attendees: "unsupported", description: "unsupported" });
    expect(JSON.stringify(adapted.event)).not.toContain("person@example.invalid");
    expect(JSON.stringify(adapted.event)).not.toContain("secret");
  });
});

describe("pagination and failures", () => {
  it("follows validated Graph next links and sends the token to each page", async () => {
    const next = `https://graph.microsoft.com${VIEW_PATH}?$skiptoken=page2`;
    const h = harness([page([timed("a", "2026-11-01T14:00:00", "2026-11-01T15:00:00")], next), page([timed("b", "2026-11-02T14:00:00", "2026-11-02T15:00:00")])]);
    const result = await readOutlookCalendarEvents(input(h));
    if (!result.ok) throw new Error("expected success");
    // A next link without $select keeps its exact query and gets the contract list appended.
    expect(h.calls.map((call) => call.url)).toEqual([outlookCalendarViewUrl("calendar-1", RANGE).toString(),
      `${next}&$select=${outlookCalendarViewUrl("calendar-1", RANGE).searchParams.get("$select")}`]);
    expect(result.snapshot.coverage[0]).toMatchObject({ paginationComplete: true, itemCount: 2 });
  });

  it.each([
    "https://evil.example/v1.0/me/calendars/calendar-1/calendarView?$skiptoken=x",
    "https://graph.microsoft.com/v1.0/me/calendars/other-calendar/calendarView?$skiptoken=x",
    "http://graph.microsoft.com/v1.0/me/calendars/calendar-1/calendarView?$skiptoken=x",
  ])("refuses foreign next page %s before sending credentials", async (link) => {
    const h = harness([page([timed("a", "2026-11-01T14:00:00", "2026-11-01T15:00:00")], link)]);
    const result = await readOutlookCalendarEvents(input(h));
    expect(h.calls).toHaveLength(1);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toMatchObject({ code: "malformed_provider_response", calendarId: "calendar-1" });
    expect(result.partialSnapshot.completeness).toBe("incomplete");
    expect(result.partialSnapshot.events).toHaveLength(1);
  });

  it("stops repeated or endless pagination at the 20-page bound", async () => {
    const link = `https://graph.microsoft.com${VIEW_PATH}?$skiptoken=same`;
    const repeated = harness([page([], link), page([], link)]);
    const first = await readOutlookCalendarEvents(input(repeated));
    expect(first.ok ? null : first.error.code).toBe("incomplete_pagination");
    const endless = harness(Array.from({ length: 25 }, (_, index) => page([], `https://graph.microsoft.com${VIEW_PATH}?$skiptoken=${index}`)));
    const second = await readOutlookCalendarEvents(input(endless));
    expect(second.ok ? null : second.error.code).toBe("incomplete_pagination");
    expect(endless.calls).toHaveLength(20);
  });

  it("maps 401, 403, 400, and malformed bodies without retrying", async () => {
    for (const [response, code] of [[json({}, 401), "reconnect_required"], [json({}, 403), "permission_denied"], [json({}, 400), "invalid_request"],
      [new Response("{not json", { status: 200 }), "malformed_provider_response"], [json({ value: "x" }), "malformed_provider_response"]] as const) {
      const h = harness([response]);
      const result = await readOutlookCalendarEvents(input(h));
      expect(result.ok ? null : result.error.code).toBe(code);
      expect(h.calls).toHaveLength(1);
    }
  });

  it("honors a Retry-After that fits and stops at once when it does not", async () => {
    const fits = harness([json({}, 429, { "retry-after": "2" }), page([])]);
    expect((await readOutlookCalendarEvents(input(fits))).ok).toBe(true);
    expect(fits.sleeps).toEqual([2000]);

    const beyond = harness([json({}, 429, { "retry-after": "60" })]);
    const result = await readOutlookCalendarEvents(input(beyond));
    expect(beyond.calls).toHaveLength(1);
    expect(beyond.sleeps).toEqual([]);
    expect(result.ok ? null : result.error).toMatchObject({ code: "rate_limited", retryable: true, retryAfterSeconds: 60 });

    // The wait plus one second must fit: 24 s + 1 s reaches the 25 s deadline exactly.
    const edge = harness([json({}, 429, { "retry-after": "24" })]);
    const edgeResult = await readOutlookCalendarEvents(input(edge));
    expect(edgeResult.ok ? null : edgeResult.error.retryAfterSeconds).toBe(24);
    expect(edge.sleeps).toEqual([]);
  });

  it("distinguishes 503 from 429 and stops after two retries", async () => {
    const h = harness([json({}, 503), json({}, 503), json({}, 503, { "retry-after": "1" })]);
    const result = await readOutlookCalendarEvents(input(h));
    expect(h.calls).toHaveLength(3);
    expect(h.sleeps).toEqual([250, 500]);
    expect(result.ok ? null : result.error).toMatchObject({ code: "provider_unavailable", retryable: true, retryAfterSeconds: 1 });
  });

  it("applies one absolute deadline across calendars, pages, and retries", async () => {
    const calendars = [CAL, { id: "calendar-2", name: "Work", isDefault: false }, { id: "calendar-3", name: "Team", isDefault: false }];
    const h = harness([page([]), json({}, 503), page([]), page([])], { stepMs: 9_000 });
    const result = await readOutlookCalendarEvents(input(h, { calendars, range: { ...RANGE, selectedCalendarIds: calendars.map((calendar) => calendar.id) } }));
    // 9 s + 9 s (503) + backoff; the retry starts at 18.25 s and completes at 27.25 s,
    // after the deadline, so its page is discarded and calendar-3 never starts.
    expect(h.calls).toHaveLength(3);
    if (result.ok) throw new Error("expected timeout");
    expect(result.error).toMatchObject({ code: "timeout", calendarId: "calendar-2" });
    expect(result.partialSnapshot.coverage.map((item) => [item.calendarId, item.paginationComplete])).toEqual([["calendar-1", true], ["calendar-2", false]]);
    expect(result.partialSnapshot.completeness).toBe("incomplete");
  });

  it("ends an unresponsive fetch, a stalled body, and a late response as timeout", async () => {
    const started = Date.now();
    const unresponsive = await readOutlookCalendarEvents({ ...input(harness([])), now: Date.now, deadlineAt: Date.now() + 50,
      fetch: () => new Promise<Response>(() => undefined) });
    expect(unresponsive.ok ? null : unresponsive.error.code).toBe("timeout");
    const stalled = await readOutlookCalendarEvents({ ...input(harness([])), now: Date.now, deadlineAt: Date.now() + 50,
      fetch: async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("{\"value\":[")); } }), { status: 200 }) });
    expect(stalled.ok ? null : stalled.error.code).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(2_000);
    // The response arrives after the absolute deadline (the clock moves 26 s during the call): discarded, never complete.
    const late = harness([page([timed("a", "2026-11-01T14:00:00", "2026-11-01T15:00:00")])], { stepMs: 26_000 });
    const lateResult = await readOutlookCalendarEvents(input(late));
    if (lateResult.ok) throw new Error("late page must not be accepted");
    expect(lateResult.error.code).toBe("timeout");
    expect(lateResult.partialSnapshot.events).toEqual([]);
  });

  it("matches raw and encoded forms of the same calendar ID in next links, and nothing else", async () => {
    const calendar = { id: "AAMkAD=", name: "Personal", isDefault: true };
    const range = { ...RANGE, selectedCalendarIds: [calendar.id] };
    expect(outlookCalendarViewUrl(calendar.id, range).pathname).toBe("/v1.0/me/calendars/AAMkAD%3D/calendarView");
    for (const link of ["https://graph.microsoft.com/v1.0/me/calendars/AAMkAD=/calendarView?$skip=10", "https://graph.microsoft.com/v1.0/me/calendars/AAMkAD%3D/calendarview?$skip=10"]) {
      const h = harness([page([], link), page([])]);
      const result = await readOutlookCalendarEvents(input(h, { calendars: [calendar], range }));
      expect(result.ok).toBe(true);
      expect(h.calls).toHaveLength(2);
    }
    for (const link of ["https://graph.microsoft.com/v1.0/me/calendars/AAMkAD/calendarView?$skip=10", "https://graph.microsoft.com/v1.0/me/calendars/aamkad%3D/calendarView?$skip=10",
      "https://graph.microsoft.com/v1.0/me/calendars/%2e%2e/calendarView", "https://graph.microsoft.com/v1.0/me/calendars/%E0%A4%A/calendarView",
      "https://evil.example/v1.0/me/calendars/AAMkAD=/calendarView"]) {
      const h = harness([page([], link)]);
      const result = await readOutlookCalendarEvents(input(h, { calendars: [calendar], range }));
      expect(result.ok ? null : result.error.code).toBe("malformed_provider_response");
      expect(h.calls).toHaveLength(1);
    }
  });

  it("times out an exhausted deadline before any request and on a network failure at the deadline", async () => {
    const h = harness([]);
    const result = await readOutlookCalendarEvents(input(h, { deadlineAt: h.time.now() }));
    expect(h.calls).toHaveLength(0);
    expect(result.ok ? null : result.error.code).toBe("timeout");
    const failing = harness([() => { throw new TypeError("network"); }, () => { throw new TypeError("network"); }, () => { throw new TypeError("network"); }]);
    const network = await readOutlookCalendarEvents(input(failing));
    expect(network.ok ? null : network.error.code).toBe("provider_unavailable");
  });

  it("rejects oversized responses by declared length or streamed bytes", async () => {
    const declared = harness([new Response("{}", { status: 200, headers: { "content-length": "6000000" } })]);
    const first = await readOutlookCalendarEvents(input(declared));
    expect(first.ok ? null : first.error.code).toBe("incomplete_pagination");
    const chunk = new Uint8Array(1_000_000).fill(32);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { sent += 1; controller.enqueue(chunk); if (sent > 50) controller.close(); } });
    const streamed = harness([new Response(stream, { status: 200 })]);
    const second = await readOutlookCalendarEvents(input(streamed));
    expect(second.ok ? null : second.error.code).toBe("incomplete_pagination");
    expect(sent).toBeLessThan(10);
  });
});

describe("calendar listing", () => {
  it("lists bounded calendars across validated pages and sorts the default first", async () => {
    const next = "https://graph.microsoft.com/v1.0/me/calendars?$skiptoken=2";
    const h = harness([json({ value: [{ id: "b", name: "Work" }], "@odata.nextLink": next }), json({ value: [{ id: "a", name: "Calendar", isDefaultCalendar: true, owner: { address: "x@example.invalid" } }] })]);
    const calendars = await listOutlookCalendars({ accessToken: TOKEN, deadlineAt: 25_000, now: h.time.now, fetch: h.fetch, sleep: h.sleep });
    expect(calendars).toEqual([{ id: "a", name: "Calendar", isDefault: true }, { id: "b", name: "Work", isDefault: false }]);
    expect(new URL(h.calls[0]!.url).searchParams.get("$select")).toBe("id,name,isDefaultCalendar");
  });

  it("refuses a foreign calendar-list next link and malformed entries", async () => {
    const foreign = harness([json({ value: [], "@odata.nextLink": "https://evil.example/v1.0/me/calendars" })]);
    await expect(listOutlookCalendars({ accessToken: TOKEN, deadlineAt: 25_000, now: foreign.time.now, fetch: foreign.fetch }))
      .rejects.toSatisfy((error: unknown) => error instanceof OutlookCalendarProviderError && error.failure.code === "malformed_provider_response");
    expect(foreign.calls).toHaveLength(1);
    const malformed = harness([json({ value: [{ id: "", name: "x" }] })]);
    await expect(listOutlookCalendars({ accessToken: TOKEN, deadlineAt: 25_000, now: malformed.time.now, fetch: malformed.fetch }))
      .rejects.toMatchObject({ failure: { code: "malformed_provider_response" } });
  });
});
