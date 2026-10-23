import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { User } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Synthetic Apple login values and CalDAV bodies only. The fake database mirrors
// the Ticket 235 RPC rules for direct intake (tests/connector-lifecycle.test.ts and
// tests/sql/context-connectors-contract.sql prove them against the real code and Postgres).
type Row = { user_id: string; provider: string; account_digest: string | null; generation: number; status: string };
type Pref = { user_id: string; provider: string; selection_revision: number; selected_source_ids: string[]; hidden_source_ids: string[]; visible: boolean; show_all_day: boolean };
const db = vi.hoisted(() => ({
  connections: new Map<string, Row>(),
  preferences: new Map<string, Pref>(),
  credentials: new Map<string, { account_digest: string; generation: number; sealed_credential: string }>(),
}));
const key = (user: string, provider: string) => `${user}/${provider}`;
const fail = (message: string) => ({ data: null, error: { message } });
function runRpc(name: string, a: Record<string, unknown>) {
  const owner = a.owner_id as string; const provider = a.provider_key as string;
  if (name === "connector_install_credential") {
    if (a.expected_state_hash !== null) return fail("connector_connection_changed");
    const row = db.connections.get(key(owner, provider)) ?? { user_id: owner, provider, account_digest: null, generation: 0, status: "disconnected" };
    db.connections.set(key(owner, provider), row);
    if (row.generation !== a.expected_generation) return fail("connector_connection_changed");
    if (row.account_digest && row.account_digest !== a.provider_account_digest) return fail("connector_wrong_account");
    Object.assign(row, { generation: row.generation + 1, status: "connected", account_digest: a.provider_account_digest });
    db.credentials.set(key(owner, provider), { account_digest: row.account_digest!, generation: row.generation, sealed_credential: a.credential_ciphertext as string });
    if (!db.preferences.has(key(owner, provider))) db.preferences.set(key(owner, provider), { user_id: owner, provider, selection_revision: 0, selected_source_ids: [], hidden_source_ids: [], visible: true, show_all_day: true });
    return { data: row.generation, error: null };
  }
  if (name === "connector_read_credential") {
    const row = db.connections.get(key(owner, provider)); const credential = db.credentials.get(key(owner, provider));
    const ok = row && credential && row.status === "connected" && row.generation === a.expected_generation && credential.generation === row.generation &&
      credential.account_digest === a.expected_account_digest;
    return { data: ok ? credential.sealed_credential : null, error: null };
  }
  if (name === "connector_disconnect") {
    const row = db.connections.get(key(owner, provider));
    if (!row || row.generation !== a.expected_generation || (a.next_status === "reconnect_required" && row.status !== "connected")) return fail("connector_connection_changed");
    Object.assign(row, { generation: row.generation + 1, status: a.next_status, account_digest: a.next_status === "disconnected" ? null : row.account_digest });
    db.credentials.delete(key(owner, provider));
    const pref = db.preferences.get(key(owner, provider));
    if (pref) Object.assign(pref, { selected_source_ids: [], hidden_source_ids: [], selection_revision: pref.selection_revision + 1 });
    return { data: row.generation, error: null };
  }
  return fail("unknown rpc");
}
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), auth: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createServiceRoleClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/services/google-calendar-request", async (importOriginal) => ({ ...await importOriginal<object>(), authenticateCalendarRequest: mocks.auth }));

function userClient(subject: string) {
  return { from(table: string) {
    if (table === "profiles") return { select: () => ({ eq: () => ({ single: async () => ({ data: { timezone: "America/New_York" }, error: null }) }) }) };
    const filters: Record<string, unknown> = {}; let patch: Record<string, unknown> | null = null;
    const rows = () => [...(table === "connector_connections" ? db.connections.values() : db.preferences.values())]
      .filter((row) => row.user_id === subject && Object.entries(filters).every(([column, value]) => (row as Record<string, unknown>)[column] === value));
    const builder = {
      select() { return builder; },
      update(values: Record<string, unknown>) { patch = values; return builder; },
      eq(column: string, value: unknown) { filters[column] = value; return builder; },
      async maybeSingle() {
        const found = rows()[0] ?? null;
        if (patch && found) { const pref = db.preferences.get(key(found.user_id, found.provider as string))!; Object.assign(pref, patch, { selection_revision: pref.selection_revision + 1 }); }
        return { data: found, error: null };
      },
      then(resolve: (value: unknown) => void) { resolve({ data: rows(), error: null }); },
    };
    return builder;
  } };
}

import { connectorAccountDigest, openConnectorCredential, readConnectorCredentialConfig, type ConnectorCaller } from "@/lib/services/connector-credentials";
import {
  connectIcloudCalendar, disconnectIcloudCalendar, getIcloudCalendarConnection, getIcloudCalendarEvents, getIcloudCalendarEventsForCaller,
  listIcloudCalendarsForCaller, normalizeIcloudLogin, updateIcloudCalendarPreferences, type IcloudServiceOptions,
} from "@/lib/services/icloud-calendar.service";
import * as connectorRepo from "@/lib/db/connectors.repo";
import { ConnectorError } from "@/lib/types/connectors";
import * as connectionRoute from "@/app/api/icloud-calendar/connection/route";
import * as calendarsRoute from "@/app/api/icloud-calendar/calendars/route";
import * as eventsRoute from "@/app/api/icloud-calendar/events/route";

const OWNER = "22700000-0000-4000-8000-000000000001";
const OTHER = "22700000-0000-4000-8000-000000000002";
const ORIGIN = "https://cadence.example";
const NOW_MS = Date.parse("2026-11-01T13:00:00Z");
const LOGIN = { appleId: "Synthetic@Example.invalid", appPassword: "ABCD EFGH" };
const VALID = { appleId: "synthetic@example.invalid", appPassword: "abcdefghijklmnop" };
const caller = (id: string): ConnectorCaller => ({ client: userClient(id) as unknown as ConnectorCaller["client"], user: { id } as User });
const fixture = (name: string) => readFileSync(join(__dirname, "fixtures/icloud-calendar", name), "utf8");
const xml = (body: string, status = 207) => new Response(body, { status, headers: { "content-type": "application/xml" } });

const apple = {
  principal: "/1234567/principal/",
  password: "abcd-efgh-ijkl-mnop",
  events: () => xml(fixture("events.xml")),
  calls: [] as Array<{ method: string; url: string; auth: string | null }>,
  stepMs: 0,
  time: NOW_MS,
  onReport: null as null | (() => void),
};
const fetcher = vi.fn(async (input: string | URL, init?: RequestInit) => {
  const url = new URL(input.toString());
  const auth = new Headers(init?.headers).get("authorization");
  apple.calls.push({ method: init?.method ?? "GET", url: url.toString(), auth });
  apple.time += apple.stepMs;
  const expected = `Basic ${Buffer.from(`synthetic@example.invalid:${apple.password}`).toString("base64")}`;
  if (auth !== expected) return new Response("", { status: 401 });
  if (init?.method === "PROPFIND" && url.pathname === "/") return xml(fixture("principal.xml").replace("/1234567/principal/", apple.principal));
  if (init?.method === "PROPFIND" && url.pathname === apple.principal) return xml(fixture("home-set.xml").replace("/1234567/principal/", apple.principal));
  if (init?.method === "PROPFIND" && url.pathname === "/1234567/calendars/") return xml(fixture("calendars.xml"));
  if (init?.method === "REPORT") { apple.onReport?.(); return apple.events(); }
  throw new Error(`unexpected ${init?.method} ${url}`);
});
const options: IcloudServiceOptions = { fetch: fetcher, clock: () => apple.time, sleep: async () => undefined, random: () => 0 };

beforeEach(() => {
  db.connections.clear(); db.preferences.clear(); db.credentials.clear();
  mocks.rpc.mockReset(); mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => runRpc(name, args));
  mocks.auth.mockReset(); mocks.auth.mockImplementation(async (request: Request) => {
    const header = request.headers.get("authorization");
    if (!header?.startsWith("Bearer ")) throw new ConnectorError("unauthenticated");
    return caller(header.slice(7));
  });
  Object.assign(apple, { principal: "/1234567/principal/", password: "abcd-efgh-ijkl-mnop", events: () => xml(fixture("events.xml")), calls: [], stepMs: 0, time: NOW_MS, onReport: null });
  fetcher.mockClear();
  vi.stubEnv("CONNECTOR_CREDENTIAL_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64")); vi.stubEnv("CONNECTOR_CREDENTIAL_KEY_ID", "c1");
  vi.stubEnv("CONNECTOR_CREDENTIAL_DECRYPTION_KEYS", "");
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

const connect = (owner = OWNER, body: unknown = VALID) => connectIcloudCalendar(caller(owner), body, options);
async function connectAndSelect() {
  await connect();
  const { calendars } = await listIcloudCalendarsForCaller(caller(OWNER), options);
  const home = calendars.find((calendar) => calendar.name === "Home & Errands")!;
  await updateIcloudCalendarPreferences(caller(OWNER), { selectedSourceIds: [home.id], hiddenSourceIds: [], visible: true, showAllDay: true }, options);
  return home.id;
}

describe("intake and sealing", () => {
  it("accepts only an Apple Account email and an app-specific-password shape, and normalizes both", () => {
    expect(normalizeIcloudLogin({ appleId: " Synthetic@Example.invalid ", appPassword: "ABCD-efgh-IJKL-mnop" })).toEqual({ appleId: "synthetic@example.invalid", appPassword: "abcd-efgh-ijkl-mnop" });
    expect(normalizeIcloudLogin(VALID).appPassword).toBe("abcd-efgh-ijkl-mnop");
    for (const body of [null, [], LOGIN, { appleId: "a@b.c" }, { ...VALID, extra: 1 }, { appleId: "no-at-sign", appPassword: VALID.appPassword },
      { appleId: "a:b@c.d", appPassword: VALID.appPassword }, { appleId: VALID.appleId, appPassword: "MyPrimaryPassword1!" },
      { appleId: VALID.appleId, appPassword: "abcd-efgh-ijkl-mno1" }, { appleId: VALID.appleId, appPassword: 7 }]) {
      expect(() => normalizeIcloudLogin(body)).toThrow("invalid_request");
    }
  });

  it("verifies discovery, seals both values bound to the principal, and never returns them", async () => {
    const view = await connect();
    expect(view).toMatchObject({ provider: "icloud_calendar", status: "connected", generation: 1, accountId: OWNER });
    expect(JSON.stringify(view)).not.toMatch(/synthetic@|abcd|1234567/);
    expect(apple.calls.map((call) => [call.method, new URL(call.url).pathname])).toEqual([["PROPFIND", "/"], ["PROPFIND", "/1234567/principal/"]]);
    const row = db.connections.get(key(OWNER, "icloud_calendar"))!;
    expect(row.account_digest).toBe(connectorAccountDigest("icloud_calendar", ["/1234567/principal/"]));
    const sealed = db.credentials.get(key(OWNER, "icloud_calendar"))!.sealed_credential;
    expect(sealed).not.toMatch(/synthetic|abcd/);
    expect(openConnectorCredential(readConnectorCredentialConfig()!, sealed, { purpose: "credential", userId: OWNER, provider: "icloud_calendar",
      accountDigest: row.account_digest, generation: 1 })).toEqual({ provider: "icloud_calendar", appleId: "synthetic@example.invalid", appPassword: "abcd-efgh-ijkl-mnop" });
  });

  it("does not install anything when Apple refuses the password or the deadline ends", async () => {
    apple.password = "zzzz-zzzz-zzzz-zzzz";
    await expect(connect()).rejects.toMatchObject({ code: "reconnect_required" });
    apple.password = "abcd-efgh-ijkl-mnop"; apple.stepMs = 26_000;
    await expect(connect()).rejects.toMatchObject({ code: "timeout" });
    expect(db.connections.size).toBe(0);
    expect(db.credentials.size).toBe(0);
  });

  it("requires disconnect before a different principal can connect", async () => {
    await connect();
    apple.principal = "/7654321/principal/";
    await expect(connect()).rejects.toMatchObject({ code: "wrong_account" });
    expect(db.connections.get(key(OWNER, "icloud_calendar"))).toMatchObject({ generation: 1, status: "connected" });
    const disconnected = await disconnectIcloudCalendar(caller(OWNER));
    expect(disconnected).toMatchObject({ status: "disconnected", revocation: "apple_app_specific_password", generation: 2 });
    await expect(connect()).resolves.toMatchObject({ status: "connected", generation: 3 });
  });

  it("keeps a reconnect_required binding to the same principal", async () => {
    await connect();
    const row = db.connections.get(key(OWNER, "icloud_calendar"))!;
    row.status = "reconnect_required"; row.generation += 1; db.credentials.delete(key(OWNER, "icloud_calendar"));
    apple.principal = "/7654321/principal/";
    await expect(connect()).rejects.toMatchObject({ code: "wrong_account" });
    apple.principal = "/1234567/principal/";
    await expect(connect()).resolves.toMatchObject({ status: "connected", generation: 3 });
  });
});

describe("listing, selection, and reads", () => {
  it("cannot restore a selection after disconnect wins the write race", async () => {
    const homeId = await connectAndSelect();
    const original = connectorRepo.saveConnectorPreferences;
    vi.spyOn(connectorRepo, "saveConnectorPreferences").mockImplementationOnce(async (...args) => {
      await disconnectIcloudCalendar(caller(OWNER));
      return original(...args);
    });
    await expect(updateIcloudCalendarPreferences(caller(OWNER), {
      selectedSourceIds: [homeId], hiddenSourceIds: [], visible: true, showAllDay: true,
    }, options)).rejects.toMatchObject({ code: "connection_changed" });
    expect(db.preferences.get(key(OWNER, "icloud_calendar"))!.selected_source_ids).toEqual([]);
  });

  it("lists opaque calendar IDs and saves only current VEVENT selections with an exact body", async () => {
    await connect();
    const { calendars } = await listIcloudCalendarsForCaller(caller(OWNER), options);
    expect(calendars.map((calendar) => calendar.name)).toEqual(["Home & Errands", "Work"]);
    expect(JSON.stringify(calendars)).not.toContain("/1234567/");
    const [home, work] = calendars;
    for (const body of [
      { selectedSourceIds: ["ic_missing00000000000000000000000000"], hiddenSourceIds: [], visible: true, showAllDay: true },
      { selectedSourceIds: ["/1234567/calendars/home/"], hiddenSourceIds: [], visible: true, showAllDay: true },
      { selectedSourceIds: [home.id], hiddenSourceIds: [work.id], visible: true, showAllDay: true },
      { selectedSourceIds: [home.id, home.id], hiddenSourceIds: [], visible: true, showAllDay: true },
      { selectedSourceIds: [home.id], hiddenSourceIds: [], visible: true, showAllDay: true, extra: true },
    ]) await expect(updateIcloudCalendarPreferences(caller(OWNER), body, options)).rejects.toThrow("invalid_request");
    const view = await updateIcloudCalendarPreferences(caller(OWNER), { selectedSourceIds: [work.id, home.id], hiddenSourceIds: [work.id], visible: true, showAllDay: false }, options);
    expect(view.preferences).toEqual({ selectedSourceIds: [work.id, home.id], hiddenSourceIds: [work.id], visible: true, showAllDay: false });
  });

  it("returns a validated 1.1.0 snapshot and sends credentials only to vetted icloud.com hosts", async () => {
    const homeId = await connectAndSelect();
    const snapshot = await getIcloudCalendarEvents(caller(OWNER), "2026-11-01", "2026-11-03", options);
    expect(snapshot).toMatchObject({ schemaVersion: "1.1.0", source: "icloud_calendar", accountId: OWNER, connectionGeneration: 1, completeness: "complete",
      requestedRange: { selectedCalendarIds: [homeId], timezone: "America/New_York" } });
    expect(snapshot.events.length).toBeGreaterThan(0);
    for (const call of apple.calls) expect(new URL(call.url).hostname).toMatch(/(^|\.)icloud\.com$/);
    expect(apple.calls.every((call) => call.method === "PROPFIND" || call.method === "REPORT")).toBe(true);
  });

  it("validates the range and selection before provider reads", async () => {
    await connect();
    const before = apple.calls.length;
    await expect(getIcloudCalendarEvents(caller(OWNER), "2026-11-02", "2026-11-03", options)).rejects.toThrow("invalid_request");
    await expect(getIcloudCalendarEvents(caller(OWNER), "2026-11-01", "2026-12-02", options)).rejects.toThrow("invalid_request");
    expect(apple.calls.length).toBe(before);
    // No selection: refused after discovery, before any REPORT.
    await expect(getIcloudCalendarEvents(caller(OWNER), "2026-11-01", "2026-11-03", options)).rejects.toThrow("invalid_request");
    expect(apple.calls.some((call) => call.method === "REPORT")).toBe(false);
  });

  it("fences reads on generation, selection, and principal changes", async () => {
    await connectAndSelect();
    await expect(getIcloudCalendarEvents(caller(OWNER), "2026-11-01", "2026-11-01", { ...options, expectedConnectionGeneration: 9 })).rejects.toThrow("connection_changed");
    await expect(getIcloudCalendarEvents(caller(OWNER), "2026-11-01", "2026-11-01", { ...options, expectedSelectionRevision: 99 })).rejects.toThrow("connection_changed");
    apple.onReport = () => { db.preferences.get(key(OWNER, "icloud_calendar"))!.selection_revision += 1; };
    await expect(getIcloudCalendarEvents(caller(OWNER), "2026-11-01", "2026-11-01", options)).rejects.toThrow("connection_changed");
    apple.onReport = null; apple.principal = "/7654321/principal/";
    await expect(getIcloudCalendarEvents(caller(OWNER), "2026-11-01", "2026-11-01", options)).rejects.toThrow("wrong_account");
    expect(apple.calls.filter((call) => call.method === "REPORT")).toHaveLength(1);
  });

  it("marks only iCloud reconnect_required when Apple refuses the saved password", async () => {
    await connectAndSelect();
    db.connections.set(key(OWNER, "hevy"), { user_id: OWNER, provider: "hevy", account_digest: "a".repeat(64), generation: 3, status: "connected" });
    apple.password = "zzzz-zzzz-zzzz-zzzz";
    await expect(getIcloudCalendarEvents(caller(OWNER), "2026-11-01", "2026-11-01", options)).rejects.toThrow("reconnect_required");
    expect(db.connections.get(key(OWNER, "icloud_calendar"))!.status).toBe("reconnect_required");
    expect(db.credentials.has(key(OWNER, "icloud_calendar"))).toBe(false);
    expect(db.connections.get(key(OWNER, "hevy"))).toMatchObject({ status: "connected", generation: 3 });
  });

  it("spends one 25-second deadline across credential discovery, listing, and REPORT, and honors a smaller caller budget", async () => {
    await connectAndSelect();
    apple.stepMs = 7_000;
    const before = apple.calls.length;
    await expect(getIcloudCalendarEvents(caller(OWNER), "2026-11-01", "2026-11-01", options)).rejects.toThrow("timeout");
    expect(apple.calls.slice(before).map((call) => call.method)).toEqual(["PROPFIND", "PROPFIND", "PROPFIND", "REPORT"]);
    const read = await getIcloudCalendarEventsForCaller(caller(OWNER), "2026-11-01", "2026-11-01", { ...options, deadlineMs: 15_000 }).catch((error: unknown) => error);
    expect(read).toMatchObject({ code: "timeout" });
    await expect(getIcloudCalendarEventsForCaller(caller(OWNER), "2026-11-01", "2026-11-01", { ...options, deadlineMs: 0 })).rejects.toMatchObject({ code: "timeout" });
  });

  it("ends an unresponsive provider at the caller budget", async () => {
    await connectAndSelect();
    fetcher.mockImplementationOnce(() => new Promise<Response>(() => undefined));
    const started = Date.now();
    const clock = () => NOW_MS + (Date.now() - started);
    await expect(getIcloudCalendarEvents(caller(OWNER), "2026-11-01", "2026-11-01", { ...options, clock, deadlineMs: 60 })).rejects.toThrow("timeout");
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("returns an incomplete result, never a complete empty one, when the calendar read fails", async () => {
    await connectAndSelect();
    apple.events = () => new Response("", { status: 507 });
    const read = await getIcloudCalendarEventsForCaller(caller(OWNER), "2026-11-01", "2026-11-01", options);
    expect(read.result).toMatchObject({ ok: false, error: { code: "incomplete_pagination" }, partialSnapshot: { completeness: "incomplete" } });
    await expect(getIcloudCalendarEvents(caller(OWNER), "2026-11-01", "2026-11-01", options)).rejects.toThrow("incomplete_pagination");
  });
});

describe("disconnect and routes", () => {
  it("deletes the sealed login, fences reads, and returns the Apple removal step without a provider call", async () => {
    await connectAndSelect();
    const before = apple.calls.length;
    const view = await disconnectIcloudCalendar(caller(OWNER));
    expect(view).toMatchObject({ status: "disconnected", revocation: "apple_app_specific_password", preferences: { selectedSourceIds: [] } });
    expect(view).not.toHaveProperty("revoked");
    expect(apple.calls.length).toBe(before);
    expect(db.credentials.size).toBe(0);
    await expect(listIcloudCalendarsForCaller(caller(OWNER), options)).rejects.toThrow("not_connected");
    await expect(getIcloudCalendarConnection(caller(OWNER))).resolves.toMatchObject({ status: "disconnected" });
  });

  it("exposes only read routes plus intake and disconnect, with stable error bodies", async () => {
    expect(Object.keys(connectionRoute).sort()).toEqual(["DELETE", "GET", "OPTIONS", "POST"]);
    expect(Object.keys(calendarsRoute).sort()).toEqual(["GET", "OPTIONS", "PUT"]);
    expect(Object.keys(eventsRoute).sort()).toEqual(["GET", "OPTIONS"]);
    const service = await import("@/lib/services/icloud-calendar.service");
    expect(Object.keys(service).sort()).toEqual(["connectIcloudCalendar", "disconnectIcloudCalendar", "getIcloudCalendarConnection", "getIcloudCalendarEvents",
      "getIcloudCalendarEventsForCaller", "listIcloudCalendarsForCaller", "normalizeIcloudLogin", "updateIcloudCalendarPreferences"]);
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => fetcher(input instanceof Request ? input.url : input, init));
    const refused = await connectionRoute.POST(new Request(`${ORIGIN}/api/icloud-calendar/connection`, { method: "POST", headers: { authorization: `Bearer ${OWNER}` },
      body: JSON.stringify({ appleId: VALID.appleId, appPassword: "zzzz-zzzz-zzzz-zzzz" }) }));
    expect(refused.status).toBe(409);
    expect(await refused.text()).toBe(JSON.stringify({ error: "reconnect_required" }));
    expect(refused.headers.get("cache-control")).toBe("no-store");
    const ok = await connectionRoute.POST(new Request(`${ORIGIN}/api/icloud-calendar/connection`, { method: "POST", headers: { authorization: `Bearer ${OTHER}` },
      body: JSON.stringify(VALID) }));
    const text = await ok.text();
    expect(ok.status).toBe(200);
    expect(text).not.toMatch(/synthetic@|abcd|principal/);
    const unauthenticated = await eventsRoute.GET(new Request(`${ORIGIN}/api/icloud-calendar/events?start=2026-11-01&end=2026-11-01`));
    expect(unauthenticated.status).toBe(401);
  });
});


describe("whole service deadline", () => {
  it.each(["credential", "final fence"])("settles a stalled %s read and discards late completion", async stage => {
    await connectAndSelect();
    apple.calls = [];
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    if (stage === "credential") {
      const original = connectorRepo.readConnectorCredential;
      vi.spyOn(connectorRepo, "readConnectorCredential").mockImplementation(async connection => {
        await pending;
        return original(connection);
      });
    } else {
      const original = connectorRepo.readConnectorConnection;
      let reads = 0;
      vi.spyOn(connectorRepo, "readConnectorConnection").mockImplementation(async (...args) => {
        if (++reads === 2) await pending;
        return original(...args);
      });
    }
    const result = getIcloudCalendarEventsForCaller(caller(OWNER), "2026-11-01", "2026-11-01", { ...options, deadlineMs: 20 });
    await expect(result).rejects.toMatchObject({ code: "timeout" });
    const calls = apple.calls.length;
    expect(calls).toBe(stage === "credential" ? 0 : 4);
    release();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(apple.calls).toHaveLength(calls);
    await expect(result).rejects.toMatchObject({ code: "timeout" });
  });
});
