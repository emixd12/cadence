import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  ICLOUD_READ_DEADLINE_MS,
  IcloudCalendarProviderError,
  discoverIcloudCalendar,
  icloudCalendarQueryBody,
  listIcloudCalendars,
  parseIcalDuration,
  readIcloudCalendarEvents,
  type IcloudCalendarCollection,
  type IcloudCalendarReadInput,
  type IcloudRequestOptions,
} from "@/lib/services/icloud-calendar-provider";
import {
  ICLOUD_CALDAV_ENDPOINT,
  assertIcloudCalDavMethod,
  icloudCalDavRequest,
  icloudCalDavUrlAllowed,
  parseIcloudXml,
} from "@/lib/services/icloud-calendar-request";
import { validateVersionedExternalEventSnapshot } from "@cadence/core/services/external-event-validation";
import type { NormalizedTimedExternalEvent } from "@cadence/core/types/day-progress";

// Synthetic CalDAV multistatus bodies only (tests/fixtures/icloud-calendar).
// No real Apple Account, app-specific password, or iCloud response is used.
const LOGIN = { appleId: "synthetic@example.invalid", appPassword: "abcd-efgh-ijkl-mnop" };
const BASIC = `Basic ${Buffer.from(`${LOGIN.appleId}:${LOGIN.appPassword}`).toString("base64")}`;
const RANGE = { startLocalDate: "2026-11-01", endLocalDate: "2026-11-03", timezone: "America/New_York", selectedCalendarIds: ["ic_home"] };
const HOME: IcloudCalendarCollection = { id: "ic_home", name: "Home", isDefault: false, href: "https://p42-caldav.icloud.com/1234567/calendars/home/", timezone: null };
const fixture = (name: string) => readFileSync(join(__dirname, "fixtures/icloud-calendar", name), "utf8");

type Call = { method: string; url: string; auth: string | null; depth: string | null; body: string; redirect: RequestRedirect | undefined };
function xml(body: string, status = 207, headers: Record<string, string> = {}) {
  return new Response(body, { status, headers: { "content-type": "application/xml; charset=utf-8", ...headers } });
}
function harness(responses: Array<Response | ((call: Call) => Response | Promise<Response>)>, options: { stepMs?: number } = {}) {
  let now = 0;
  const calls: Call[] = [];
  const sleeps: number[] = [];
  const fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const call = { method: init?.method ?? "GET", url: url.toString(), auth: headers.get("authorization"), depth: headers.get("depth"),
      body: String(init?.body ?? ""), redirect: init?.redirect };
    calls.push(call);
    now += options.stepMs ?? 0;
    const next = responses.shift();
    if (!next) throw new Error("unexpected request");
    return typeof next === "function" ? next(call) : next;
  });
  const sleep = vi.fn(async (ms: number) => { sleeps.push(ms); now += ms; });
  return { now: () => now, advance: (ms: number) => { now += ms; }, calls, sleeps, fetch, sleep };
}
function options(h: ReturnType<typeof harness>, overrides: Partial<IcloudRequestOptions> = {}): IcloudRequestOptions {
  return { login: LOGIN, deadlineAt: h.now() + ICLOUD_READ_DEADLINE_MS, now: h.now, fetch: h.fetch, sleep: h.sleep, random: () => 0, ...overrides };
}
function readInput(h: ReturnType<typeof harness>, overrides: Partial<IcloudCalendarReadInput> = {}): IcloudCalendarReadInput {
  return { ...options(h), accountId: "account-1", connectionGeneration: 2, calendars: [HOME], range: RANGE, fetchedAt: "2026-11-01T13:00:00Z", ...overrides };
}
async function failure(promise: Promise<unknown>) {
  try { await promise; } catch (error) { if (error instanceof IcloudCalendarProviderError) return error.failure; throw error; }
  throw new Error("expected a provider failure");
}

describe("CalDAV request boundary", () => {
  it("allows only PROPFIND and REPORT", async () => {
    expect(() => assertIcloudCalDavMethod("PROPFIND")).not.toThrow();
    expect(() => assertIcloudCalDavMethod("REPORT")).not.toThrow();
    const h = harness([]);
    for (const method of ["PUT", "DELETE", "MKCALENDAR", "PROPPATCH", "MOVE", "COPY", "POST", "GET", "propfind"]) {
      expect(() => assertIcloudCalDavMethod(method)).toThrow(TypeError);
      await expect(icloudCalDavRequest({ method, url: new URL(ICLOUD_CALDAV_ENDPOINT), depth: "0", body: "", calendarId: null }, options(h))).rejects.toThrow(TypeError);
    }
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("vets hosts, ports, userinfo, protocol, and hrefs before credentials are forwarded", () => {
    expect(icloudCalDavUrlAllowed("/1234567/principal/")?.toString()).toBe("https://caldav.icloud.com/1234567/principal/");
    expect(icloudCalDavUrlAllowed("https://p42-caldav.icloud.com:443/x/")?.toString()).toBe("https://p42-caldav.icloud.com/x/");
    for (const value of ["http://caldav.icloud.com/", "https://icloud.com.attacker.invalid/", "https://attacker.invalid/", "https://user:pw@caldav.icloud.com/",
      "https://caldav.icloud.com:8443/", "https://caldav.icloud.com./", "https://caldav.icloud.com/x#frag", "https://caldav.icloud.com/x?y=1",
      "//attacker.invalid/x", "https://caldav.icloud.com/a b", "https://caldav.icloud.com/\\x", "https://127.0.0.1/", "javascript:alert(1)", "", "x".repeat(3000)]) {
      expect(icloudCalDavUrlAllowed(value), value).toBeNull();
    }
  });

  it("sends Basic credentials only to vetted hosts and follows at most three same-domain HTTPS redirects", async () => {
    const h = harness([
      new Response(null, { status: 301, headers: { location: "https://p01-caldav.icloud.com/" } }),
      new Response(null, { status: 307, headers: { location: "/next/" } }),
      xml(fixture("principal.xml")),
    ]);
    const result = await icloudCalDavRequest({ method: "PROPFIND", url: new URL(ICLOUD_CALDAV_ENDPOINT), depth: "0", body: "<x/>", calendarId: null }, options(h));
    expect(result.url.toString()).toBe("https://p01-caldav.icloud.com/next/");
    expect(h.calls.map((call) => [call.method, call.url, call.auth, call.redirect])).toEqual([
      ["PROPFIND", "https://caldav.icloud.com/", BASIC, "manual"],
      ["PROPFIND", "https://p01-caldav.icloud.com/", BASIC, "manual"],
      ["PROPFIND", "https://p01-caldav.icloud.com/next/", BASIC, "manual"],
    ]);
  });

  it("refuses off-domain, downgrade, userinfo, loop, method-changing, and excessive redirects without following them", async () => {
    const run = async (responses: Response[]) => {
      const h = harness(responses);
      const result = await failure(icloudCalDavRequest({ method: "PROPFIND", url: new URL(ICLOUD_CALDAV_ENDPOINT), depth: "0", body: "", calendarId: null }, options(h)));
      return { result, urls: h.calls.map((call) => call.url) };
    };
    for (const location of ["https://attacker.invalid/", "http://caldav.icloud.com/", "https://me:pw@caldav.icloud.com/"]) {
      const { result, urls } = await run([new Response(null, { status: 302, headers: { location } })]);
      expect(result.code).toBe("malformed_provider_response");
      expect(urls).toEqual(["https://caldav.icloud.com/"]);
    }
    const loop = await run([new Response(null, { status: 302, headers: { location: "https://p1-caldav.icloud.com/" } }),
      new Response(null, { status: 302, headers: { location: "https://caldav.icloud.com/" } })]);
    expect(loop.result).toMatchObject({ code: "provider_unavailable", retryable: false });
    const changed = await run([new Response(null, { status: 303, headers: { location: "/x/" } })]);
    expect(changed.result).toMatchObject({ code: "provider_unavailable", retryable: false });
    const many = await run([1, 2, 3, 4].map((hop) => new Response(null, { status: 302, headers: { location: `https://p${hop}-caldav.icloud.com/` } })));
    expect(many.result).toMatchObject({ code: "provider_unavailable" });
    expect(many.urls).toHaveLength(4);
  });

  it("maps 401, 403, 404, 507, and other failures to stable codes", async () => {
    const cases: Array<[number, string, boolean]> = [[401, "reconnect_required", false], [403, "permission_denied", false], [404, "provider_unavailable", false],
      [507, "incomplete_pagination", false], [400, "invalid_request", false]];
    for (const [status, code, retryable] of cases) {
      const h = harness([new Response("<html>provider text</html>", { status })]);
      const result = await failure(icloudCalDavRequest({ method: "REPORT", url: new URL(HOME.href), depth: "1", body: "", calendarId: "ic_home" }, options(h)));
      expect(result).toMatchObject({ code, retryable, calendarId: "ic_home" });
      expect(result.message).not.toContain("provider text");
      expect(h.calls).toHaveLength(1);
    }
  });

  it("retries 503 and 429 twice under the deadline and honors a fitting Retry-After", async () => {
    const h = harness([new Response("", { status: 503 }), new Response("", { status: 429, headers: { "retry-after": "2" } }), xml(fixture("principal.xml"))]);
    await icloudCalDavRequest({ method: "PROPFIND", url: new URL(ICLOUD_CALDAV_ENDPOINT), depth: "0", body: "", calendarId: null }, options(h));
    expect(h.sleeps).toEqual([250, 2000]);
    const exhausted = harness([0, 1, 2].map(() => new Response("", { status: 503 })));
    expect(await failure(icloudCalDavRequest({ method: "PROPFIND", url: new URL(ICLOUD_CALDAV_ENDPOINT), depth: "0", body: "", calendarId: null }, options(exhausted))))
      .toMatchObject({ code: "provider_unavailable", retryable: true });
    expect(exhausted.calls).toHaveLength(3);
  });

  it("stops at once with retryAfterSeconds when Retry-After does not fit before the deadline", async () => {
    const h = harness([new Response("", { status: 429, headers: { "retry-after": "30" } })]);
    const result = await failure(icloudCalDavRequest({ method: "PROPFIND", url: new URL(ICLOUD_CALDAV_ENDPOINT), depth: "0", body: "", calendarId: null }, options(h)));
    expect(result).toMatchObject({ code: "rate_limited", retryAfterSeconds: 30 });
    expect(h.sleeps).toEqual([]);
  });

  it("ends an unresponsive fetch at the attempt budget and discards a response finishing after the deadline", async () => {
    // A fetch that never settles and ignores abort still ends at the absolute deadline (real clock, 60 ms budget).
    const hanging = vi.fn(() => new Promise<Response>(() => undefined));
    const started = Date.now();
    expect(await failure(icloudCalDavRequest({ method: "PROPFIND", url: new URL(ICLOUD_CALDAV_ENDPOINT), depth: "0", body: "", calendarId: null },
      { login: LOGIN, deadlineAt: started + 60, fetch: hanging, random: () => 0 }))).toMatchObject({ code: "timeout" });
    expect(Date.now() - started).toBeLessThan(2_000);
    const late = harness([xml(fixture("principal.xml"))], { stepMs: 30_000 });
    expect(await failure(icloudCalDavRequest({ method: "PROPFIND", url: new URL(ICLOUD_CALDAV_ENDPOINT), depth: "0", body: "", calendarId: null }, options(late))))
      .toMatchObject({ code: "timeout" });
    const spent = harness([]);
    expect(await failure(icloudCalDavRequest({ method: "PROPFIND", url: new URL(ICLOUD_CALDAV_ENDPOINT), depth: "0", body: "", calendarId: null }, options(spent, { deadlineAt: 0 }))))
      .toMatchObject({ code: "timeout" });
    expect(spent.fetch).not.toHaveBeenCalled();
  });

  it("caps bodies at 5 MB by header and by stream", async () => {
    const declared = harness([xml("<x/>", 207, { "content-length": "5000001" })]);
    expect(await failure(icloudCalDavRequest({ method: "REPORT", url: new URL(HOME.href), depth: "1", body: "", calendarId: "ic_home" }, options(declared))))
      .toMatchObject({ code: "incomplete_pagination" });
    const big = "<d:multistatus xmlns:d=\"DAV:\">" + " ".repeat(5_000_001) + "</d:multistatus>";
    const streamed = harness([new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(big)); controller.close(); } }),
      { status: 207, headers: { "content-type": "application/xml" } })]);
    expect(await failure(icloudCalDavRequest({ method: "REPORT", url: new URL(HOME.href), depth: "1", body: "", calendarId: "ic_home" }, options(streamed))))
      .toMatchObject({ code: "incomplete_pagination" });
  });
});

describe("strict XML subset", () => {
  it("refuses DOCTYPE, entity declarations, processing instructions, and undeclared entities", () => {
    expect(() => parseIcloudXml(fixture("events-doctype.xml"))).toThrow(/DOCTYPE/);
    expect(() => parseIcloudXml("<a><?php x ?></a>")).toThrow(/processing/);
    expect(() => parseIcloudXml("<a>&xxe;</a>")).toThrow(/entity/);
    expect(() => parseIcloudXml("<p:a/>")).toThrow(/prefix/);
    expect(() => parseIcloudXml("<a></b>")).toThrow(/mismatched/);
    expect(() => parseIcloudXml("<a/><b/>")).toThrow(/after the root/);
  });

  it("reports truncation separately from malformed syntax and resolves namespaces", () => {
    expect(() => parseIcloudXml("<a><b>")).toThrow(expect.objectContaining({ kind: "truncated" }));
    expect(() => parseIcloudXml("<a><b")).toThrow(expect.objectContaining({ kind: "truncated" }));
    const root = parseIcloudXml("<?xml version=\"1.0\"?><x:a xmlns:x=\"DAV:\" xmlns=\"urn:y\"><b name=\"v\">t&amp;&#x41;<![CDATA[<raw>]]></b></x:a>");
    expect(root).toMatchObject({ ns: "DAV:", name: "a" });
    expect(root.children[0]).toMatchObject({ ns: "urn:y", name: "b", attributes: { name: "v" }, text: "t&A<raw>" });
  });
});

describe("discovery and listing", () => {
  it("binds the principal href and lists only VEVENT calendars under the vetted home", async () => {
    const h = harness([xml(fixture("principal.xml")), xml(fixture("home-set.xml")), xml(fixture("calendars.xml"))]);
    const discovery = await discoverIcloudCalendar(options(h));
    expect(discovery.principal).toBe("/1234567/principal/");
    expect(discovery.home.toString()).toBe("https://p42-caldav.icloud.com/1234567/calendars/");
    const calendars = await listIcloudCalendars(options(h), discovery);
    expect(calendars.map((calendar) => [calendar.name, calendar.timezone])).toEqual([["Home & Errands", null], ["Work", "Europe/Madrid"]]);
    for (const calendar of calendars) expect(calendar.id).toMatch(/^ic_[A-Za-z0-9_-]{32}$/);
    expect(JSON.stringify(calendars.map(({ id, name }) => ({ id, name })))).not.toContain("1234567");
    expect(h.calls.map((call) => [call.method, call.url, call.depth])).toEqual([
      ["PROPFIND", "https://caldav.icloud.com/", "0"],
      ["PROPFIND", "https://caldav.icloud.com/1234567/principal/", "0"],
      ["PROPFIND", "https://p42-caldav.icloud.com/1234567/calendars/", "1"],
    ]);
    expect(h.calls.every((call) => call.auth === BASIC)).toBe(true);
  });

  it("refuses principals and homes outside icloud.com and collections outside the home", async () => {
    const offPrincipal = fixture("principal.xml").replace("/1234567/principal/", "https://attacker.invalid/p/");
    const h1 = harness([xml(offPrincipal)]);
    expect(await failure(discoverIcloudCalendar(options(h1)))).toMatchObject({ code: "malformed_provider_response" });
    expect(h1.calls).toHaveLength(1);
    const offHome = fixture("home-set.xml").replace("https://p42-caldav.icloud.com:443", "http://p42-caldav.icloud.com");
    const h2 = harness([xml(fixture("principal.xml")), xml(offHome)]);
    expect(await failure(discoverIcloudCalendar(options(h2)))).toMatchObject({ code: "malformed_provider_response" });
    expect(h2.calls).toHaveLength(2);
    const outside = fixture("calendars.xml").replace("/1234567/calendars/work/", "/7654321/calendars/work/");
    const h3 = harness([xml(fixture("principal.xml")), xml(fixture("home-set.xml")), xml(outside)]);
    expect(await failure(listIcloudCalendars(options(h3), await discoverIcloudCalendar(options(h3))))).toMatchObject({ code: "malformed_provider_response" });
  });

  it("validates discovery multistatus and propstat statuses", async () => {
    const denied = fixture("principal.xml").replace("HTTP/1.1 200 OK", "HTTP/1.1 403 Forbidden");
    expect(await failure(discoverIcloudCalendar(options(harness([xml(denied)]))))).toMatchObject({ code: "malformed_provider_response" });
    const other = fixture("principal.xml").replace("<href>/</href>", "<href>/someone-else/</href>");
    expect(await failure(discoverIcloudCalendar(options(harness([xml(other)]))))).toMatchObject({ code: "malformed_provider_response" });
    expect(await failure(discoverIcloudCalendar(options(harness([xml("<d:prop xmlns:d=\"DAV:\"/>")]))))).toMatchObject({ code: "malformed_provider_response" });
    expect(await failure(discoverIcloudCalendar(options(harness([new Response("{}", { status: 207, headers: { "content-type": "application/json" } })])))))
      .toMatchObject({ code: "malformed_provider_response" });
    expect(await failure(discoverIcloudCalendar(options(harness([new Response("", { status: 401 })]))))).toMatchObject({ code: "reconnect_required" });
  });
});

describe("calendar-query events", () => {
  it("sends one bounded REPORT with a VEVENT comp-filter, UTC time-range, and expand over the same range", async () => {
    const body = icloudCalendarQueryBody(RANGE);
    expect(body).toContain("<c:comp-filter name=\"VCALENDAR\"><c:comp-filter name=\"VEVENT\">");
    expect(body).toContain("<c:time-range start=\"20261031T040000Z\" end=\"20261105T050000Z\"/>");
    expect(body).toContain("<c:expand start=\"20261031T040000Z\" end=\"20261105T050000Z\"/>");
    const h = harness([xml(fixture("events.xml"))]);
    await readIcloudCalendarEvents(readInput(h));
    expect(h.calls.map((call) => [call.method, call.url, call.depth, call.auth])).toEqual([["REPORT", HOME.href, "1", BASIC]]);
  });

  it("maps timed, all-day missing end, DURATION, unspecified end, floating, expanded, moved, and cancelled instances", async () => {
    const h = harness([xml(fixture("events.xml"))]);
    const result = await readIcloudCalendarEvents(readInput(h));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const snapshot = result.snapshot;
    expect(validateVersionedExternalEventSnapshot(snapshot)).toEqual(snapshot);
    expect(snapshot).toMatchObject({ source: "icloud_calendar", adapterVersion: "icloud-calendar-v1", schemaVersion: "1.1.0", completeness: "complete" });
    const byUid = (uid: string) => snapshot.events.filter((event) => event.providerEventId === uid);
    expect(byUid("timed-1")[0]).toMatchObject({ kind: "timed", startAt: "2026-11-01T13:00:00Z", endAt: "2026-11-01T13:45:00Z", duration: { kind: "known", seconds: 2700 },
      title: "Gym, then lunch", state: "confirmed", availability: "busy", sourceUrl: null, currentUserResponse: null, description: "", location: "",
      sourceTimezone: "America/New_York", sourceTimezoneFallback: "request",
      revision: { availability: "available", providerUpdatedAt: "2026-10-28T10:00:00Z", providerEtag: "\"e-timed\"" } });
    expect(byUid("allday-1")[0]).toMatchObject({ kind: "all_day", startLocalDate: "2026-11-02", endLocalDate: "2026-11-03", duration: { kind: "calendar_days", days: 1 }, availability: "free", state: "unknown" });
    expect(byUid("duration-1")[0]).toMatchObject({ endAt: "2026-11-01T16:30:00Z", duration: { seconds: 5400 }, state: "tentative" });
    expect(byUid("open-1")[0]).toMatchObject({ endUnspecified: true, duration: { kind: "unknown", reason: "end_unspecified" } });
    expect(byUid("floating-1")[0]).toMatchObject({ startAt: "2026-11-01T14:00:00Z", endAt: "2026-11-01T15:00:00Z", sourceTimezoneFallback: "request" });
    expect(byUid("folded-1")[0]).toMatchObject({ title: "A very long folded title" });
    const series = byUid("series-1") as NormalizedTimedExternalEvent[];
    expect(series.map((event) => [event.recurrence?.originalStart, event.startAt])).toEqual([
      [{ kind: "timed", startAt: "2026-11-01T12:00:00Z" }, "2026-11-01T12:00:00Z"],
      [{ kind: "timed", startAt: "2026-11-02T12:00:00Z" }, "2026-11-02T16:00:00Z"],
    ]);
    expect(snapshot.tombstones).toEqual([expect.objectContaining({ providerEventId: "series-1", recurrence: { seriesId: "series-1", originalStart: { kind: "timed", startAt: "2026-11-03T12:00:00Z" } } })]);
    for (const event of snapshot.events) {
      expect(event.id.startsWith("icloud_calendar/account-1/ic_home/")).toBe(true);
      expect(event.fieldAvailability).toMatchObject({ description: "unsupported", location: "unsupported", attendees: "unsupported", source_url: "unsupported" });
    }
    const serialized = JSON.stringify(snapshot);
    for (const secret of ["Private notes", "Secret place", "friend@example", "example.invalid/event", "Alarm text", "1234567", LOGIN.appPassword]) expect(serialized).not.toContain(secret);
  });

  it("interprets floating times in the collection timezone and DURATION days across DST by wall time", async () => {
    const madrid = { ...HOME, timezone: "Europe/Madrid" };
    const floating = await readIcloudCalendarEvents(readInput(harness([xml(fixture("events.xml"))]), { calendars: [madrid] }));
    if (!floating.ok) throw new Error("expected ok");
    expect(floating.snapshot.events.find((event) => event.providerEventId === "floating-1")).toMatchObject({ startAt: "2026-11-01T08:00:00Z", sourceTimezone: "Europe/Madrid", sourceTimezoneFallback: "calendar" });
    const dst = await readIcloudCalendarEvents(readInput(harness([xml(fixture("events-dst.xml"))]), { range: { ...RANGE, startLocalDate: "2026-10-31" } }));
    if (!dst.ok) throw new Error("expected ok");
    // 2026-11-01 is the US DST end: one nominal day from 09:00 EDT is 25 elapsed hours.
    expect(dst.snapshot.events[0]).toMatchObject({ startAt: "2026-10-31T13:00:00Z", endAt: "2026-11-01T14:00:00Z", duration: { seconds: 90_000 }, sourceTimezone: "America/New_York", sourceTimezoneFallback: "none" });
  });

  it("marks a calendar incomplete when the server returns an unexpanded RRULE and never expands it locally", async () => {
    const result = await readIcloudCalendarEvents(readInput(harness([xml(fixture("events-unexpanded.xml"))])));
    if (!result.ok) throw new Error("expected ok");
    expect(result.snapshot).toMatchObject({ completeness: "incomplete", coverage: [{ paginationComplete: false }],
      capabilities: { recurrence: { support: "unsupported" } }, freshness: { canAssertNoOverlap: false } });
    expect(result.snapshot.events.map((event) => event.providerEventId)).toEqual(["timed-1"]);
    expect(result.snapshot.failures[0].message).toContain("unexpanded_recurrence=1");
  });

  it("quarantines malformed items, reversed intervals, and unresolved zones without claiming completeness", async () => {
    const result = await readIcloudCalendarEvents(readInput(harness([xml(fixture("events-malformed-item.xml"))])));
    if (!result.ok) throw new Error("expected ok");
    expect(result.snapshot.completeness).toBe("incomplete");
    expect(result.snapshot.failures[0]).toMatchObject({ code: "malformed_provider_response", calendarId: "ic_home" });
    expect(result.snapshot.failures[0].message).toContain("invalid_interval=1");
    expect(result.snapshot.failures[0].message).toContain("malformed_item=1");
    expect(result.snapshot.failures[0].message).toContain("timezone_unresolved=1");
  });

  it("returns a complete empty snapshot only for a successful empty multistatus", async () => {
    const empty = await readIcloudCalendarEvents(readInput(harness([xml(fixture("events-empty.xml"))])));
    expect(empty).toMatchObject({ ok: true, snapshot: { completeness: "complete", events: [], coverage: [{ paginationComplete: true, itemCount: 0 }] } });
  });

  it("never infers an empty calendar from 507, truncated, malformed, DOCTYPE, off-calendar, or failed responses", async () => {
    const cases: Array<[Response, string]> = [
      [xml(fixture("events-507.xml")), "incomplete_pagination"],
      [new Response("", { status: 507 }), "incomplete_pagination"],
      [xml(fixture("events-truncated.xml")), "incomplete_pagination"],
      [xml(fixture("events-malformed.xml")), "malformed_provider_response"],
      [xml(fixture("events-doctype.xml")), "malformed_provider_response"],
      [xml(fixture("events-offcalendar.xml")), "malformed_provider_response"],
      [new Response("", { status: 403 }), "permission_denied"],
      [new Response("", { status: 401 }), "reconnect_required"],
    ];
    for (const [response, code] of cases) {
      const result = await readIcloudCalendarEvents(readInput(harness([response])));
      expect(result.ok, code).toBe(false);
      if (result.ok) continue;
      expect(result.error.code).toBe(code);
      expect(result.partialSnapshot).toMatchObject({ completeness: "incomplete", freshness: { refreshedAt: null, canAssertNoOverlap: false }, coverage: [{ paginationComplete: false }] });
    }
  });

  it("rejects out-of-bounds input before any request", async () => {
    const h = harness([]);
    await expect(readIcloudCalendarEvents(readInput(h, { range: { ...RANGE, endLocalDate: "2026-12-15" } }))).rejects.toThrow(RangeError);
    await expect(readIcloudCalendarEvents(readInput(h, { calendars: [] }))).rejects.toThrow(TypeError);
    await expect(readIcloudCalendarEvents(readInput(h, { connectionGeneration: 0 }))).rejects.toThrow(TypeError);
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("parses RFC 5545 durations and refuses negative or empty ones", () => {
    expect(parseIcalDuration("PT1H30M")).toMatchObject({ hours: 1, minutes: 30 });
    expect(parseIcalDuration("P2W")).toMatchObject({ weeks: 2 });
    expect(parseIcalDuration("P1DT2H")).toMatchObject({ days: 1, hours: 2 });
    for (const value of ["-PT1H", "P", "PT", "P1H", "1H", "P1W2D"]) expect(() => parseIcalDuration(value), value).toThrow();
  });
});
