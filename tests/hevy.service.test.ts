import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Temporal } from "@js-temporal/polyfill";
import type { User } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecordedActivitySnapshotV1 } from "@cadence/core/types/recorded-activity";
import { ConnectorError, type ConnectorConnection, type ConnectorCredential } from "@/lib/types/connectors";

// Synthetic credentials and provider responses only. The lifecycle fake keeps the
// Ticket 222 contract: verify before install, generation fencing after a read,
// and reconnect_required marking. tests/connector-lifecycle.test.ts covers the
// real lifecycle against its repository fake.
const KEY = "00000000-0000-4000-8000-00000000hevy";
const OWNER = "22300000-0000-4000-8000-000000000001";
const NOW = Date.parse("2026-10-18T16:00:00Z");
const life = vi.hoisted(() => ({
  connection: null as null | { generation: number; status: string; accountDigest: string | null },
  credential: null as null | ConnectorCredential,
  marked: 0,
  verifyResult: null as null | readonly string[],
  onRead: null as null | (() => void),
}));
vi.mock("@/lib/services/connector-credentials", () => {
  const view = () => ({ accountId: OWNER, provider: "hevy", status: life.connection?.status ?? "disconnected",
    generation: life.connection?.generation ?? 0, selectionRevision: 0, preferences: { selectedSourceIds: [], hiddenSourceIds: [], visible: true, showAllDay: true } });
  const current = (): ConnectorConnection => ({ userId: OWNER, provider: "hevy", accountDigest: life.connection!.accountDigest,
    generation: life.connection!.generation, status: life.connection!.status as ConnectorConnection["status"], selectionRevision: 0,
    preferences: { selectedSourceIds: [], hiddenSourceIds: [], visible: true, showAllDay: true } });
  return {
    getConnectorConnection: async () => view(),
    disconnectConnector: async () => {
      if (life.connection) life.connection = { generation: life.connection.generation + 1, status: "disconnected", accountDigest: null };
      life.credential = null;
      return { ...view(), revocation: "hevy_api_key" };
    },
    connectDirectCredential: async (_caller: unknown, credential: ConnectorCredential, verify: (value: ConnectorCredential) => Promise<readonly string[]>) => {
      const before = life.connection?.generation ?? 0;
      life.verifyResult = await verify(credential);
      const digest = `digest:${life.verifyResult.join("/")}`;
      if (life.connection?.accountDigest && life.connection.accountDigest !== digest) throw new ConnectorError("wrong_account");
      life.connection = { generation: before + 1, status: "connected", accountDigest: digest };
      life.credential = credential;
      return view();
    },
    withConnectorCredential: async <T,>(_caller: unknown, _provider: string, run: (credential: ConnectorCredential, connection: ConnectorConnection) => Promise<T>) => {
      if (!life.connection || life.connection.status === "disconnected") throw new ConnectorError("not_connected");
      if (life.connection.status !== "connected" || !life.credential) throw new ConnectorError("reconnect_required");
      const before = current();
      const result = await run(life.credential, before);
      const after = current();
      if (after.status !== "connected") throw new ConnectorError("reconnect_required");
      if (after.generation !== before.generation || after.accountDigest !== before.accountDigest) throw new ConnectorError("connection_changed");
      return result;
    },
    markConnectorReconnectRequired: async () => { life.marked += 1; if (life.connection) life.connection.status = "reconnect_required"; },
  };
});

import { applyHevyActivityRefresh, connectHevy, disconnectHevy, getHevyActivities, getHevyConnection } from "@/lib/services/hevy.service";
import type { HevyFetch } from "@/lib/services/hevy-provider";
import { GET as activitiesRoute } from "@/app/api/hevy/activities/route";
import { DELETE as disconnectRoute, GET as connectionRoute, POST as connectRoute } from "@/app/api/hevy/connection/route";

const fixture = (name: string) => JSON.parse(readFileSync(join(__dirname, "fixtures/hevy", name), "utf8")) as Record<string, unknown>;
function profileClient(timezone = "America/New_York") {
  return { from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { timezone }, error: null }) }) }) }) };
}
const caller = (timezone?: string) => ({ client: profileClient(timezone) as never, user: { id: OWNER } as User });

function hevyFetch(page: unknown, options: { userInfo?: unknown; onPage?: () => void; count?: number } = {}): { fetch: HevyFetch; calls: string[] } {
  const calls: string[] = [];
  const fetch: HevyFetch = async (url, init) => {
    calls.push(`${init.method} ${url}`);
    const path = new URL(url).pathname;
    if (path === "/v1/user/info") return Response.json(options.userInfo ?? fixture("user-info.json"));
    if (path === "/v1/workouts/count") return Response.json({ workout_count: options.count ?? ((page as { workouts: unknown[] }).workouts.length) });
    options.onPage?.();
    return Response.json(page);
  };
  return { fetch, calls };
}
const clock = () => NOW;
const fast = { clock, sleep: async () => undefined, random: () => 0 };

beforeEach(() => {
  life.connection = null; life.credential = null; life.marked = 0; life.verifyResult = null;
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("Hevy connection", () => {
  it("accepts exactly { apiKey }, verifies it, and never returns it", async () => {
    const { fetch, calls } = hevyFetch({ page: 1, page_count: 0, workouts: [] });
    const view = await connectHevy(caller(), { apiKey: KEY }, { fetch, ...fast });
    expect(view).toMatchObject({ provider: "hevy", status: "connected", generation: 1 });
    expect(JSON.stringify(view)).not.toContain(KEY);
    expect(life.verifyResult).toEqual(["synthetic-hevy-user-0001"]);
    expect(JSON.stringify(await getHevyConnection(caller()))).not.toContain(KEY);
    expect(calls).toEqual(["GET https://api.hevyapp.com/v1/user/info"]);
    for (const body of [null, [], "key", { apiKey: 7 }, { apiKey: KEY, provider: "hevy" }, { key: KEY }, {}]) {
      await expect(connectHevy(caller(), body, { fetch })).rejects.toMatchObject({ code: "invalid_request" });
    }
  });

  it("reports the Hevy Pro requirement and rejected keys truthfully", async () => {
    const nonPro = hevyFetch({}, { userInfo: { data: { id: "synthetic", is_pro: false } } });
    await expect(connectHevy(caller(), { apiKey: KEY }, { fetch: nonPro.fetch, ...fast })).rejects.toMatchObject({ code: "permission_denied" });
    const rejected: HevyFetch = async () => new Response("", { status: 401 });
    await expect(connectHevy(caller(), { apiKey: KEY }, { fetch: rejected, ...fast })).rejects.toMatchObject({ code: "reconnect_required" });
    expect(life.connection).toBeNull();
  });

  it("refuses a different Hevy account until disconnect, then allows reconnect", async () => {
    await connectHevy(caller(), { apiKey: KEY }, { fetch: hevyFetch({}).fetch, ...fast });
    const other = hevyFetch({}, { userInfo: { data: { id: "synthetic-other", is_pro: true } } });
    await expect(connectHevy(caller(), { apiKey: KEY }, { fetch: other.fetch, ...fast })).rejects.toMatchObject({ code: "wrong_account" });
    const disconnected = await disconnectHevy(caller());
    expect(disconnected).toMatchObject({ status: "disconnected", revocation: "hevy_api_key" });
    await expect(connectHevy(caller(), { apiKey: KEY }, { fetch: other.fetch, ...fast })).resolves.toMatchObject({ status: "connected", generation: 3 });
  });

  it("exposes no workout-writing operation", async () => {
    const service = await import("@/lib/services/hevy.service");
    expect(Object.keys(service).sort()).toEqual(["applyHevyActivityRefresh", "connectHevy", "disconnectHevy", "getHevyActivities", "getHevyConnection"]);
    const connection = await import("@/app/api/hevy/connection/route");
    const activities = await import("@/app/api/hevy/activities/route");
    expect(Object.keys(connection).sort()).toEqual(["DELETE", "GET", "OPTIONS", "POST"]);
    expect(Object.keys(activities).sort()).toEqual(["GET", "OPTIONS"]);
  });
});

describe("Hevy activity reads", () => {
  beforeEach(async () => { await connectHevy(caller(), { apiKey: KEY }, { fetch: hevyFetch({}).fetch, ...fast }); });

  it("returns a minimized snapshot for the requested local days", async () => {
    const { fetch } = hevyFetch(fixture("workouts-page.json"));
    const snapshot = await getHevyActivities(caller(), "2026-09-18", "2026-10-18", { fetch, ...fast });
    expect(snapshot).toMatchObject({ source: "hevy", accountId: OWNER, connectionGeneration: 1, completeness: "complete",
      requestedRange: { startLocalDate: "2026-09-18", endLocalDate: "2026-10-18", timezone: "America/New_York" } });
    expect(snapshot.activities).toHaveLength(2);
    const serialized = JSON.stringify(snapshot);
    for (const forbidden of ["SECRET", "Bench", "synthetic-workout", "137.5", "exercise", KEY]) expect(serialized).not.toContain(forbidden);
  });

  it("bounds the range to today and up to 30 prior local days", async () => {
    const { fetch, calls } = hevyFetch(fixture("workouts-page.json"));
    for (const [start, end] of [["2026-09-17", "2026-10-18"], ["2026-10-18", "2026-10-19"], ["2026-10-18", "2026-10-17"],
      ["2026-10-1", "2026-10-18"], ["", ""], ["2026-10-18T00:00", "2026-10-18"]]) {
      await expect(getHevyActivities(caller(), start, end, { fetch, ...fast }), `${start}..${end}`).rejects.toMatchObject({ code: "invalid_request" });
    }
    expect(calls).toHaveLength(0);
    // 16:00Z is still Oct 18 in New York but already Oct 19 in Kiritimati.
    await expect(getHevyActivities(caller("Pacific/Kiritimati"), "2026-09-19", "2026-10-19", { fetch, ...fast })).resolves.toMatchObject({ completeness: "complete" });
  });

  it("marks reconnect_required when Hevy rejects the stored key", async () => {
    const revoked: HevyFetch = async () => new Response("", { status: 403 });
    await expect(getHevyActivities(caller(), "2026-10-18", "2026-10-18", { fetch: revoked, ...fast })).rejects.toMatchObject({ code: "reconnect_required" });
    expect(life.marked).toBe(1);
    expect(life.connection?.status).toBe("reconnect_required");
  });

  it("discards a late response after disconnect or reconnect", async () => {
    const { fetch } = hevyFetch(fixture("workouts-page.json"), { onPage: () => { life.connection!.generation += 1; } });
    await expect(getHevyActivities(caller(), "2026-10-01", "2026-10-18", { fetch, ...fast })).rejects.toMatchObject({ code: "connection_changed" });
  });

  it("refuses a read authorized for an earlier connection", async () => {
    const { fetch, calls } = hevyFetch(fixture("workouts-page.json"));
    await expect(getHevyActivities(caller(), "2026-10-18", "2026-10-18", { fetch, ...fast, expectedConnectionGeneration: 0 }))
      .rejects.toMatchObject({ code: "connection_changed" });
    expect(calls).toHaveLength(0);
  });

  it("returns an incomplete snapshot with a stable failure instead of guessing", async () => {
    const { fetch } = hevyFetch(fixture("workouts-page.json"), { count: 3 });
    const snapshot = await getHevyActivities(caller(), "2026-10-01", "2026-10-18", { fetch, ...fast });
    expect(snapshot).toMatchObject({ completeness: "incomplete", failures: [{ code: "incomplete_pagination" }] });
  });

  it("requires a connection", async () => {
    await disconnectHevy(caller());
    await expect(getHevyActivities(caller(), "2026-10-18", "2026-10-18", { fetch: hevyFetch({}).fetch, ...fast })).rejects.toMatchObject({ code: "not_connected" });
  });
});

describe("Hevy snapshot replacement", () => {
  const workout = (id: string, end: string, updated: string) => ({ id, title: "SECRET", start_time: "2026-10-10T12:00:00Z", end_time: end, updated_at: updated, exercises: [] });
  async function snapshotOf(workouts: unknown[], options: { count?: number; at?: number } = {}): Promise<RecordedActivitySnapshotV1> {
    const { fetch } = hevyFetch({ page: 1, page_count: workouts.length ? 1 : 0, workouts }, { count: options.count ?? workouts.length });
    return getHevyActivities(caller(), "2026-10-01", "2026-10-18", { fetch, ...fast, clock: () => options.at ?? NOW });
  }
  beforeEach(async () => { await connectHevy(caller(), { apiKey: KEY }, { fetch: hevyFetch({}).fetch, ...fast }); });

  it("proves an edit through a complete refresh", async () => {
    const first = await snapshotOf([workout("a", "2026-10-10T13:00:00Z", "2026-10-10T13:00:00Z")]);
    const edited = await snapshotOf([workout("a", "2026-10-10T13:30:00Z", "2026-10-11T08:00:00Z")], { at: NOW + 1_000 });
    const result = applyHevyActivityRefresh(first, edited);
    expect(result.replaced).toBe(true);
    expect(result.snapshot.activities[0]).toMatchObject({ endAt: "2026-10-10T13:30:00Z", revision: { providerUpdatedAt: "2026-10-11T08:00:00Z" } });
    expect(result.snapshot.activities[0].id).toBe(first.activities[0].id);
  });

  it("proves a deletion through a complete refresh", async () => {
    const first = await snapshotOf([workout("a", "2026-10-10T13:00:00Z", "2026-10-10T13:00:00Z"), workout("b", "2026-10-10T14:00:00Z", "2026-10-10T14:00:00Z")]);
    const deleted = await snapshotOf([workout("b", "2026-10-10T14:00:00Z", "2026-10-10T14:00:00Z")], { at: NOW + 1_000 });
    const result = applyHevyActivityRefresh(first, deleted);
    expect(result.snapshot.activities).toHaveLength(1);
    expect(result.replaced).toBe(true);
  });

  it("never lets a partial read erase known records", async () => {
    const first = await snapshotOf([workout("a", "2026-10-10T13:00:00Z", "2026-10-10T13:00:00Z"), workout("b", "2026-10-10T14:00:00Z", "2026-10-10T14:00:00Z")]);
    const partial = await snapshotOf([workout("b", "2026-10-10T14:00:00Z", "2026-10-10T14:00:00Z")], { count: 2, at: NOW + 1_000 });
    expect(partial.completeness).toBe("incomplete");
    const result = applyHevyActivityRefresh(first, partial);
    expect(result).toMatchObject({ replaced: false, refreshFailures: [{ code: "incomplete_pagination" }] });
    expect(result.snapshot).toBe(first);
  });

  it("ignores late responses and never reuses another generation's records", async () => {
    const early = await snapshotOf([workout("a", "2026-10-10T13:00:00Z", "2026-10-10T13:00:00Z")]);
    const later = await snapshotOf([], { at: NOW + 5_000 });
    expect(applyHevyActivityRefresh(later, early)).toMatchObject({ replaced: false, snapshot: later });
    await disconnectHevy(caller());
    await connectHevy(caller(), { apiKey: KEY }, { fetch: hevyFetch({}).fetch, ...fast });
    const reconnected = await snapshotOf([], { at: NOW + 6_000 });
    expect(reconnected.connectionGeneration).toBeGreaterThan(later.connectionGeneration);
    expect(applyHevyActivityRefresh(later, reconnected)).toMatchObject({ replaced: true, snapshot: reconnected });
    expect(applyHevyActivityRefresh(reconnected, later)).toMatchObject({ replaced: false, snapshot: reconnected });
  });
});

describe("Hevy routes", () => {
  function stubSupabase() {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.example");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable");
    return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith("https://supabase.example/auth/v1/user")) return Response.json({ id: OWNER, aud: "authenticated" });
      if (url.startsWith("https://supabase.example/rest/v1/profiles")) return Response.json({ timezone: "America/New_York" });
      if (url === "https://api.hevyapp.com/v1/user/info") return Response.json(fixture("user-info.json"));
      if (url === "https://api.hevyapp.com/v1/workouts/count") return Response.json({ workout_count: 2 });
      if (url.startsWith("https://api.hevyapp.com/v1/workouts?")) return Response.json(fixture("workouts-page.json"));
      return new Response("unexpected", { status: 500 });
    });
  }

  it("rejects cross-origin key submission before authentication or Hevy", async () => {
    const fetcher = stubSupabase();
    const request = new NextRequest("https://cadence.example/api/hevy/connection", { method: "POST", headers: { origin: "https://attacker.invalid" },
      body: JSON.stringify({ apiKey: KEY }) });
    const response = await connectRoute(request);
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain(KEY);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("accepts a bounded key submission, returns no key, and stores nothing on the client", async () => {
    stubSupabase();
    const request = new Request("https://cadence.example/api/hevy/connection", { method: "POST", headers: { authorization: "Bearer synthetic" },
      body: JSON.stringify({ apiKey: KEY }) });
    const response = await connectRoute(request);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const text = await response.text();
    expect(text).not.toContain(KEY);
    expect(JSON.parse(text)).toMatchObject({ provider: "hevy", status: "connected" });
    const status = await connectionRoute(new Request("https://cadence.example/api/hevy/connection", { headers: { authorization: "Bearer synthetic" } }));
    expect(await status.json()).toMatchObject({ status: "connected" });
  });

  it("rejects oversized and malformed bodies with only a code", async () => {
    stubSupabase();
    for (const body of [JSON.stringify({ apiKey: "x".repeat(9_000) }), "{not json", JSON.stringify({ apiKey: KEY, extra: true })]) {
      const response = await connectRoute(new Request("https://cadence.example/api/hevy/connection", { method: "POST",
        headers: { authorization: "Bearer synthetic" }, body }));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_request" });
    }
  });

  it("serves activities and disconnect with stable shapes", async () => {
    stubSupabase();
    const headers = { authorization: "Bearer synthetic" };
    await connectRoute(new Request("https://cadence.example/api/hevy/connection", { method: "POST", headers, body: JSON.stringify({ apiKey: KEY }) }));
    const today = Temporal.Now.instant().toZonedDateTimeISO("America/New_York").toPlainDate();
    const response = await activitiesRoute(new Request(`https://cadence.example/api/hevy/activities?start=${today.subtract({ days: 30 })}&end=${today}`, { headers }));
    expect(response.status).toBe(200);
    const text = await response.text();
    for (const forbidden of ["SECRET", "synthetic-workout", KEY]) expect(text).not.toContain(forbidden);
    expect(JSON.parse(text)).toMatchObject({ source: "hevy", adapterVersion: "hevy-workouts-v1" });
    const invalid = await activitiesRoute(new Request("https://cadence.example/api/hevy/activities?start=2020-01-01&end=2020-03-01", { headers }));
    expect(invalid.status).toBe(400);
    const removed = await disconnectRoute(new Request("https://cadence.example/api/hevy/connection", { method: "DELETE", headers }));
    expect(await removed.json()).toMatchObject({ status: "disconnected", revocation: "hevy_api_key" });
    const after = await activitiesRoute(new Request(`https://cadence.example/api/hevy/activities?start=${today}&end=${today}`, { headers }));
    expect(after.status).toBe(409);
    expect(await after.json()).toEqual({ error: "not_connected" });
  });

  it("requires authentication for status reads", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.example");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable");
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ message: "bad jwt" }), { status: 401 }));
    const response = await connectionRoute(new Request("https://cadence.example/api/hevy/connection", { headers: { authorization: "Bearer forged" } }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthenticated" });
  });
});
