import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";
import { validateRecordedActivitySnapshot } from "@cadence/core/services/recorded-activity-validation";
import {
  HEVY_API_ORIGIN,
  HevyProviderError,
  hevyRequestUrl,
  isAllowedHevyRequest,
  readHevyWorkouts,
  verifyHevyApiKey,
  type HevyFetch,
} from "@/lib/services/hevy-provider";

// Synthetic Hevy responses only. No live Hevy account or key is used.
const KEY = "00000000-0000-4000-8000-00000000hevy";
const ACCOUNT = "22300000-0000-4000-8000-000000000001";
const NOW = Date.parse("2026-10-18T16:00:00Z");
const RANGE = { startLocalDate: "2026-09-18", endLocalDate: "2026-10-18", timezone: "America/New_York" };
const fixture = (name: string) => JSON.parse(readFileSync(join(__dirname, "fixtures/hevy", name), "utf8")) as Record<string, unknown>;

type Reply = Response | ((call: { url: string; init: RequestInit }) => Response | Promise<Response>);
type Calls = Array<{ url: string; init: RequestInit }>;

function workout(index: number, overrides: Record<string, unknown> = {}) {
  const start = Temporal.Instant.from("2026-10-01T12:00:00Z").add({ hours: index * 2 });
  return { id: `synthetic-workout-${index}`, title: `SECRET-TITLE-${index}`, routine_id: "SECRET-ROUTINE", description: "SECRET-DESCRIPTION",
    start_time: start.toString(), end_time: start.add({ minutes: 45 }).toString(), updated_at: start.add({ hours: 1 }).toString(),
    created_at: start.toString(), exercises: [{ title: "SECRET-EXERCISE", notes: "SECRET-NOTE", sets: [{ weight_kg: 999, reps: 99 }] }], ...overrides };
}
function pages(workouts: unknown[]): Record<number, unknown> {
  const pageCount = Math.ceil(workouts.length / 10);
  const result: Record<number, unknown> = {};
  for (let page = 1; page <= Math.max(1, pageCount); page += 1) {
    result[page] = { page, page_count: pageCount, workouts: workouts.slice((page - 1) * 10, page * 10) };
  }
  return result;
}

/** A fake Hevy API with a fake clock. `counts` are served in order; the last repeats. */
function fakeHevy(options: { counts?: number[]; pages?: Record<number, unknown>; overrides?: Record<string, Reply[]>; latencyMs?: number } = {}) {
  let clock = NOW;
  const calls: Calls = [];
  const counts = [...(options.counts ?? [0])];
  const fetch: HevyFetch = async (url, init) => {
    calls.push({ url, init });
    clock += options.latencyMs ?? 100;
    const path = new URL(url).pathname + new URL(url).search;
    const queued = options.overrides?.[path]?.shift();
    if (queued) return typeof queued === "function" ? queued({ url, init }) : queued;
    if (path === "/v1/workouts/count") return Response.json({ workout_count: counts.length > 1 ? counts.shift() : counts[0] });
    if (path === "/v1/user/info") return Response.json(fixture("user-info.json"));
    const page = Number(new URL(url).searchParams.get("page"));
    const body = options.pages?.[page];
    return body ? Response.json(body) : new Response("not found", { status: 404 });
  };
  return {
    calls,
    fetch,
    clock: () => clock,
    sleep: async (milliseconds: number) => { clock += milliseconds; },
    random: () => 0,
  };
}
function read(fake: ReturnType<typeof fakeHevy>, extra: Record<string, unknown> = {}) {
  return readHevyWorkouts({ apiKey: KEY, accountId: ACCOUNT, connectionGeneration: 3, range: RANGE, fetch: fake.fetch, clock: fake.clock,
    sleep: fake.sleep, random: fake.random, ...extra });
}
const workoutPaths = (calls: Calls) => calls.map((call) => new URL(call.url).pathname + new URL(call.url).search);

describe("Hevy call allowlist", () => {
  it("builds only the three documented GET URLs", () => {
    expect(hevyRequestUrl({ kind: "user_info" })).toBe(`${HEVY_API_ORIGIN}/v1/user/info`);
    expect(hevyRequestUrl({ kind: "workout_count" })).toBe(`${HEVY_API_ORIGIN}/v1/workouts/count`);
    expect(hevyRequestUrl({ kind: "workouts", page: 50 })).toBe(`${HEVY_API_ORIGIN}/v1/workouts?page=50&pageSize=10`);
    expect(() => hevyRequestUrl({ kind: "workouts", page: 51 })).toThrow(RangeError);
    expect(() => hevyRequestUrl({ kind: "workouts", page: 0 })).toThrow(RangeError);
  });

  it("rejects writes, other paths, other origins, and altered queries before a key is attached", () => {
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) expect(isAllowedHevyRequest(method, `${HEVY_API_ORIGIN}/v1/workouts?page=1&pageSize=10`)).toBe(false);
    for (const url of [
      `${HEVY_API_ORIGIN}/v1/workouts/events?since=2026-01-01T00:00:00Z`,
      `${HEVY_API_ORIGIN}/v1/routines`,
      `${HEVY_API_ORIGIN}/v1/body_measurements`,
      `${HEVY_API_ORIGIN}/v1/workouts?page=1&pageSize=10&extra=1`,
      `${HEVY_API_ORIGIN}/v1/workouts?pageSize=10&page=1`,
      `${HEVY_API_ORIGIN}/v1/workouts?page=51&pageSize=10`,
      `${HEVY_API_ORIGIN}/v1/workouts?page=1&pageSize=100`,
      `${HEVY_API_ORIGIN}/v1/user/info?x=1`,
      "https://api.hevyapp.com.evil.example/v1/user/info",
      "http://api.hevyapp.com/v1/user/info",
      "https://user:pass@api.hevyapp.com/v1/user/info",
      "not a url",
    ]) expect(isAllowedHevyRequest("GET", url), url).toBe(false);
    expect(isAllowedHevyRequest("GET", `${HEVY_API_ORIGIN}/v1/workouts?page=7&pageSize=10`)).toBe(true);
  });

  it("sends the key only as a GET header to Hevy and refuses redirects", async () => {
    const fake = fakeHevy({ counts: [2], pages: pages([workout(1), workout(2)]) });
    await read(fake);
    expect(fake.calls.length).toBeGreaterThan(0);
    for (const call of fake.calls) {
      expect(call.init.method).toBe("GET");
      expect(isAllowedHevyRequest("GET", call.url)).toBe(true);
      expect(call.init.redirect).toBe("error");
      expect(call.init.body).toBeUndefined();
      expect(call.init.headers).toEqual({ "api-key": KEY, accept: "application/json" });
    }
  });

  it("refuses a key that is not a header-safe token without calling Hevy", async () => {
    const fake = fakeHevy();
    await expect(verifyHevyApiKey("bad key\r\nx-evil: 1", { fetch: fake.fetch })).rejects.toMatchObject({ failure: { code: "invalid_request" } });
    expect(fake.calls).toHaveLength(0);
  });
});

describe("Hevy key verification", () => {
  it("returns only the Hevy user ID", async () => {
    const fake = fakeHevy();
    const identity = await verifyHevyApiKey(KEY, { fetch: fake.fetch, clock: fake.clock, sleep: fake.sleep });
    expect(identity).toEqual(["synthetic-hevy-user-0001"]);
    expect(JSON.stringify(identity)).not.toContain("SECRET");
    expect(workoutPaths(fake.calls)).toEqual(["/v1/user/info"]);
  });

  it("maps non-Pro, rejected, missing, and drifted identities to stable codes", async () => {
    const nonPro = fakeHevy({ overrides: { "/v1/user/info": [Response.json({ data: { id: "u", is_pro: false } })] } });
    await expect(verifyHevyApiKey(KEY, { fetch: nonPro.fetch })).rejects.toMatchObject({ failure: { code: "permission_denied", retryable: false } });
    for (const [status, code] of [[401, "reconnect_required"], [403, "reconnect_required"], [404, "reconnect_required"], [400, "invalid_request"]] as const) {
      const fake = fakeHevy({ overrides: { "/v1/user/info": [new Response(`{"error":"${KEY}"}`, { status })] } });
      const error = await verifyHevyApiKey(KEY, { fetch: fake.fetch }).catch((value: unknown) => value);
      expect(error).toBeInstanceOf(HevyProviderError);
      expect((error as HevyProviderError).failure.code).toBe(code);
      expect(JSON.stringify((error as HevyProviderError).failure)).not.toContain(KEY);
      expect(fake.calls).toHaveLength(1);
    }
    for (const body of [{}, { data: { id: "", is_pro: true } }, { data: { id: "u" } }, { data: { id: 7, is_pro: true } }]) {
      const fake = fakeHevy({ overrides: { "/v1/user/info": [Response.json(body)] } });
      await expect(verifyHevyApiKey(KEY, { fetch: fake.fetch })).rejects.toMatchObject({ failure: { code: "malformed_provider_response" } });
    }
  });
});

describe("Hevy workout reads", () => {
  it("reads an empty account as complete", async () => {
    const fake = fakeHevy({ counts: [0], pages: { 1: { page: 1, page_count: 0, workouts: [] } } });
    const snapshot = await read(fake);
    expect(snapshot).toMatchObject({ completeness: "complete", activities: [], failures: [],
      coverage: { pagesRead: 0, pageCount: 0, countBefore: 0, countAfter: 0, itemCount: 0, paginationComplete: true } });
    expect(workoutPaths(fake.calls)).toEqual(["/v1/workouts/count", "/v1/workouts?page=1&pageSize=10", "/v1/workouts/count"]);
  });

  it("projects only identity, timing, and revision from a populated page", async () => {
    const fake = fakeHevy({ counts: [2], pages: { 1: fixture("workouts-page.json") } });
    const snapshot = await read(fake);
    expect(snapshot.completeness).toBe("complete");
    expect(snapshot.activities).toHaveLength(2);
    expect(snapshot.activities[0]).toMatchObject({ kind: "workout", startAt: "2026-10-17T12:00:00Z", endAt: "2026-10-17T13:05:30Z",
      duration: { kind: "known", seconds: 3930 }, localStartDate: "2026-10-17",
      revision: { availability: "available", providerUpdatedAt: "2026-10-17T13:10:00Z" },
      fieldAvailability: { location: "unsupported", sourceTimezone: "unsupported" } });
    // 03:30Z on Oct 18 is Oct 17 in New York.
    expect(snapshot.activities[1].localStartDate).toBe("2026-10-17");
    for (const activity of snapshot.activities) {
      expect(Object.keys(activity).sort()).toEqual(["duration", "endAt", "fieldAvailability", "id", "kind", "localStartDate", "revision", "startAt"]);
      expect(activity.id).toMatch(/^hevy\/[0-9a-f]{64}$/);
    }
    const serialized = JSON.stringify(snapshot);
    for (const forbidden of ["SECRET", "synthetic-workout", "Bench", "137.5", "weight", "reps", "title", "exercise", "routine", "notes", "description", KEY]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(validateRecordedActivitySnapshot(snapshot, { now: Temporal.Instant.fromEpochMilliseconds(NOW + 60_000) })).toBe(snapshot);
  });

  it("reads every page of a multi-page account and confirms counts afterwards", async () => {
    const all = Array.from({ length: 25 }, (_, index) => workout(index));
    const fake = fakeHevy({ counts: [25], pages: pages(all) });
    const snapshot = await read(fake);
    expect(workoutPaths(fake.calls)).toEqual(["/v1/workouts/count", "/v1/workouts?page=1&pageSize=10", "/v1/workouts?page=2&pageSize=10",
      "/v1/workouts?page=3&pageSize=10", "/v1/workouts/count"]);
    expect(snapshot).toMatchObject({ completeness: "complete", coverage: { pagesRead: 3, pageCount: 3, countBefore: 25, countAfter: 25, itemCount: 25 } });
    expect(snapshot.activities).toHaveLength(25);
  });

  it("counts workouts outside the requested range without returning them", async () => {
    const old = workout(1, { start_time: "2026-01-01T10:00:00Z", end_time: "2026-01-01T11:00:00Z", updated_at: "2026-01-01T11:00:00Z" });
    const fake = fakeHevy({ counts: [2], pages: pages([old, workout(2)]) });
    const snapshot = await read(fake);
    expect(snapshot).toMatchObject({ completeness: "complete", coverage: { itemCount: 2 } });
    expect(snapshot.activities).toHaveLength(1);
  });

  it("returns incomplete_pagination above 500 workouts without reading pages", async () => {
    const fake = fakeHevy({ counts: [501], pages: pages([workout(1)]) });
    const snapshot = await read(fake);
    expect(workoutPaths(fake.calls)).toEqual(["/v1/workouts/count"]);
    expect(snapshot).toMatchObject({ completeness: "incomplete", activities: [], failures: [{ code: "incomplete_pagination" }],
      coverage: { pagesRead: 0, pageCount: null, countBefore: 501, countAfter: null } });
  });

  it("accepts exactly 500 workouts across 50 pages", async () => {
    const all = Array.from({ length: 500 }, (_, index) => workout(index % 100, { id: `synthetic-workout-${index}` }));
    const fake = fakeHevy({ counts: [500], pages: pages(all), latencyMs: 10 });
    const snapshot = await read(fake);
    expect(snapshot).toMatchObject({ completeness: "complete", coverage: { pagesRead: 50, pageCount: 50, itemCount: 500 } });
  });

  it("removes duplicates across pages and keeps the latest update", async () => {
    const first = Array.from({ length: 10 }, (_, index) => workout(index));
    const edited = workout(3, { end_time: "2026-10-01T19:00:00Z", updated_at: "2026-10-02T00:00:00Z" });
    const fake = fakeHevy({ counts: [11], pages: pages([...first, edited, workout(10)]) });
    const snapshot = await read(fake);
    expect(snapshot).toMatchObject({ completeness: "complete", coverage: { itemCount: 11, duplicatesRemoved: 1 } });
    expect(snapshot.activities.find((activity) => activity.endAt === "2026-10-01T19:00:00Z")?.revision.providerUpdatedAt).toBe("2026-10-02T00:00:00Z");
  });

  it("marks a repeated page incomplete because a workout may have been skipped", async () => {
    const all = Array.from({ length: 20 }, (_, index) => workout(index));
    const repeated = pages(all);
    repeated[2] = { ...(repeated[1] as Record<string, unknown>), page: 2 };
    const fake = fakeHevy({ counts: [20], pages: repeated });
    const snapshot = await read(fake);
    expect(snapshot).toMatchObject({ completeness: "incomplete", failures: [{ code: "incomplete_pagination" }],
      coverage: { itemCount: 10, duplicatesRemoved: 10, paginationComplete: true } });
  });

  it("marks a count change during the read incomplete", async () => {
    const fake = fakeHevy({ counts: [2, 3], pages: pages([workout(1), workout(2)]) });
    const snapshot = await read(fake);
    expect(snapshot).toMatchObject({ completeness: "incomplete", failures: [{ code: "incomplete_pagination" }], coverage: { countBefore: 2, countAfter: 3 } });
  });

  it("stops when page_count changes between pages", async () => {
    const all = Array.from({ length: 20 }, (_, index) => workout(index));
    const shifted = pages(all);
    shifted[2] = { ...(shifted[2] as Record<string, unknown>), page_count: 3 };
    const fake = fakeHevy({ counts: [20], pages: shifted });
    const snapshot = await read(fake);
    expect(snapshot).toMatchObject({ completeness: "incomplete", failures: [{ code: "incomplete_pagination" }], coverage: { pagesRead: 1 } });
    expect(workoutPaths(fake.calls).filter((path) => path === "/v1/workouts/count")).toHaveLength(1);
  });

  it("quarantines malformed and reversed times and keeps usable workouts", async () => {
    const fake = fakeHevy({ counts: [5], pages: pages([
      workout(1, { start_time: "yesterday" }),
      workout(2, { end_time: "2026-10-01T15:00:00" }),
      workout(3, { end_time: "2026-10-01T17:00:00Z" }),
      workout(4, { end_time: { title: "SECRET-NESTED" } }),
      workout(5),
    ]) });
    const snapshot = await read(fake);
    expect(snapshot).toMatchObject({ completeness: "incomplete", failures: [{ code: "malformed_provider_response" }], coverage: { itemCount: 5 } });
    expect(snapshot.activities).toHaveLength(1);
    expect(JSON.stringify(snapshot)).not.toContain("SECRET");
  });

  it("treats schema drift as malformed_provider_response", async () => {
    for (const body of [{ page: 1, page_count: 1 }, { page: 2, page_count: 1, workouts: [] }, { page: 1, page_count: "1", workouts: [] },
      { page: 1, page_count: 0, workouts: [workout(1)] }, { page: 1, page_count: 1, workouts: Array.from({ length: 11 }, (_, i) => workout(i)) }]) {
      const fake = fakeHevy({ counts: [1], pages: { 1: body } });
      const snapshot = await read(fake);
      expect(snapshot).toMatchObject({ completeness: "incomplete", failures: [{ code: "malformed_provider_response" }] });
    }
    const badCount = fakeHevy({ overrides: { "/v1/workouts/count": [Response.json({ workout_count: -1 })] } });
    expect((await read(badCount)).failures[0].code).toBe("malformed_provider_response");
    const notJson = fakeHevy({ overrides: { "/v1/workouts/count": [new Response("<html>")] } });
    expect((await read(notJson)).failures[0].code).toBe("malformed_provider_response");
  });

  it("caps response size before parsing", async () => {
    const huge = new Response("x".repeat(10), { headers: { "content-length": "5000000" } });
    const fake = fakeHevy({ overrides: { "/v1/workouts/count": [huge] } });
    expect((await read(fake)).failures[0].code).toBe("malformed_provider_response");
    const streamed = new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(1_000_000)); } }));
    const endless = fakeHevy({ overrides: { "/v1/workouts/count": [streamed] } });
    expect((await read(endless)).failures[0].code).toBe("malformed_provider_response");
  });

  it("marks a revoked key reconnect_required", async () => {
    const fake = fakeHevy({ counts: [1], overrides: { "/v1/workouts?page=1&pageSize=10": [new Response("", { status: 401 })] } });
    const snapshot = await read(fake);
    expect(snapshot).toMatchObject({ completeness: "incomplete", failures: [{ code: "reconnect_required", retryable: false }] });
  });
});

describe("Hevy retries and the absolute deadline", () => {
  it("retries a 429 with a Retry-After that fits", async () => {
    const limited = () => new Response("", { status: 429, headers: { "retry-after": "2" } });
    const fake = fakeHevy({ counts: [0], pages: { 1: { page: 1, page_count: 0, workouts: [] } }, overrides: { "/v1/workouts/count": [limited] } });
    const snapshot = await read(fake);
    expect(snapshot.completeness).toBe("complete");
    expect(workoutPaths(fake.calls).filter((path) => path === "/v1/workouts/count")).toHaveLength(3);
  });

  it("fails at once as rate_limited when Retry-After does not fit the deadline", async () => {
    const fake = fakeHevy({ overrides: { "/v1/workouts/count": [new Response("", { status: 429, headers: { "retry-after": "60" } })] } });
    const snapshot = await read(fake);
    expect(snapshot.failures).toEqual([expect.objectContaining({ code: "rate_limited", retryable: true, retryAfterSeconds: 60 })]);
    expect(fake.calls).toHaveLength(1);
  });

  it("stops after two retries of a 503", async () => {
    const down = () => new Response("", { status: 503 });
    const fake = fakeHevy({ overrides: { "/v1/workouts/count": [down, down, down, down] } });
    const snapshot = await read(fake);
    expect(snapshot.failures[0]).toMatchObject({ code: "provider_unavailable", retryable: true });
    expect(fake.calls).toHaveLength(3);
  });

  it("returns timeout when slow pages exhaust the 25-second deadline", async () => {
    const all = Array.from({ length: 50 }, (_, index) => workout(index));
    const fake = fakeHevy({ counts: [50], pages: pages(all), latencyMs: 6_000 });
    const snapshot = await read(fake);
    expect(snapshot).toMatchObject({ completeness: "incomplete", failures: [{ code: "timeout" }] });
    expect(snapshot.coverage.pagesRead).toBeLessThan(5);
    expect(fake.clock() - NOW).toBeLessThanOrEqual(31_000);
  });

  it("spends retries and pages from one shared deadline", async () => {
    const slowDown = () => new Response("", { status: 503 });
    const fake = fakeHevy({ counts: [20], pages: pages(Array.from({ length: 20 }, (_, i) => workout(i))), latencyMs: 5_000,
      overrides: { "/v1/workouts?page=2&pageSize=10": [slowDown, slowDown] } });
    const snapshot = await read(fake);
    // 5 s count + 5 s page 1 + three 5 s attempts at page 2 with backoff passes 25 s.
    expect(snapshot.failures[0].code).toBe("timeout");
    expect(snapshot.coverage.pagesRead).toBe(1);
  });

  it("discards a response that arrives after the deadline", async () => {
    let lateResolved = false;
    const fetch: HevyFetch = (_url, init) => new Promise((resolve) => {
      setTimeout(() => { lateResolved = true; resolve(Response.json({ workout_count: 0 })); }, 120);
      init.signal?.addEventListener("abort", () => undefined);
    });
    const snapshot = await readHevyWorkouts({ apiKey: KEY, accountId: ACCOUNT, connectionGeneration: 1, range: { ...RANGE, startLocalDate: todayInNewYork(-30), endLocalDate: todayInNewYork(0) },
      fetch, deadlineMs: 30, sleep: async () => undefined });
    expect(snapshot).toMatchObject({ completeness: "incomplete", failures: [{ code: "timeout" }], coverage: { countBefore: null } });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(lateResolved).toBe(true);
  });

  it("honors caller cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    const fake = fakeHevy();
    const snapshot = await read(fake, { signal: controller.signal });
    expect(snapshot.failures[0].code).toBe("timeout");
    expect(fake.calls).toHaveLength(0);
  });

  it("rejects deadlines longer than 25 seconds", async () => {
    await expect(read(fakeHevy(), { deadlineMs: 25_001 })).rejects.toThrow(RangeError);
  });
});

function todayInNewYork(offsetDays: number): string {
  return Temporal.Now.instant().toZonedDateTimeISO("America/New_York").toPlainDate().add({ days: offsetDays }).toString();
}
