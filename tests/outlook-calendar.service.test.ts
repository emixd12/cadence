import { createHash } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Synthetic credentials, identities, and Graph data only. The fake database
// mirrors the Ticket 235 RPC rules (tests/connector-lifecycle.test.ts and
// tests/sql/context-connectors-contract.sql prove them against the real code and Postgres).
type Row = { user_id: string; provider: string; account_digest: string | null; attempt_hash: string | null; generation: number; status: string };
type Pref = { user_id: string; provider: string; selection_revision: number; selected_source_ids: string[]; hidden_source_ids: string[]; visible: boolean; show_all_day: boolean };
type Attempt = { state_hash: string; user_id: string; provider: string; generation: number; sealed_verifier: string; target: string; client_state: string; expires_at: string };
const db = vi.hoisted(() => ({
  users: new Set<string>(),
  connections: new Map<string, Row>(),
  preferences: new Map<string, Pref>(),
  credentials: new Map<string, { account_digest: string; generation: number; sealed_credential: string }>(),
  attempts: new Map<string, Attempt>(),
  rpcCalls: [] as string[],
}));
const key = (user: string, provider: string) => `${user}/${provider}`;
const fail = (message: string) => ({ data: null, error: { message } });
function ensureRow(user: string, provider: string): Row {
  const existing = db.connections.get(key(user, provider));
  if (existing) return existing;
  const row = { user_id: user, provider, account_digest: null, attempt_hash: null, generation: 0, status: "disconnected" };
  db.connections.set(key(user, provider), row);
  return row;
}
function ensurePref(user: string, provider: string) {
  if (!db.preferences.has(key(user, provider))) db.preferences.set(key(user, provider), { user_id: user, provider, selection_revision: 0, selected_source_ids: [], hidden_source_ids: [], visible: true, show_all_day: true });
}
function runRpc(name: string, a: Record<string, unknown>) {
  db.rpcCalls.push(name);
  const owner = a.owner_id as string; const provider = a.provider_key as string;
  if (name === "connector_begin_attempt") {
    const row = ensureRow(owner, provider);
    if (row.generation !== a.expected_generation) return fail("connector_connection_changed");
    row.attempt_hash = a.state_digest as string; ensurePref(owner, provider);
    for (const [hash, attempt] of db.attempts) if (attempt.user_id === owner && attempt.provider === provider) db.attempts.delete(hash);
    db.attempts.set(a.state_digest as string, { state_hash: a.state_digest as string, user_id: owner, provider, generation: row.generation,
      sealed_verifier: a.verifier_ciphertext as string, target: a.return_target as string, client_state: a.client_nonce as string, expires_at: "2099-01-01T00:00:00Z" });
    return { data: row.generation, error: null };
  }
  if (name === "connector_consume_attempt") {
    const attempt = db.attempts.get(a.state_digest as string);
    if (!attempt || attempt.provider !== provider) return { data: null, error: null };
    db.attempts.delete(attempt.state_hash);
    return { data: { ...attempt }, error: null };
  }
  if (name === "connector_install_credential") {
    const row = db.connections.get(key(owner, provider));
    if (!row || row.generation !== a.expected_generation || !a.expected_state_hash || row.attempt_hash !== a.expected_state_hash) return fail("connector_connection_changed");
    if (row.account_digest && row.account_digest !== a.provider_account_digest) return fail("connector_wrong_account");
    Object.assign(row, { generation: row.generation + 1, status: "connected", account_digest: a.provider_account_digest, attempt_hash: null });
    db.credentials.set(key(owner, provider), { account_digest: row.account_digest!, generation: row.generation, sealed_credential: a.credential_ciphertext as string });
    return { data: row.generation, error: null };
  }
  if (name === "connector_read_credential") {
    const row = db.connections.get(key(owner, provider)); const credential = db.credentials.get(key(owner, provider));
    const ok = row && credential && row.status === "connected" && row.generation === a.expected_generation && credential.generation === row.generation &&
      credential.account_digest === a.expected_account_digest;
    return { data: ok ? credential.sealed_credential : null, error: null };
  }
  if (name === "connector_replace_credential") {
    const row = db.connections.get(key(owner, provider)); const credential = db.credentials.get(key(owner, provider));
    if (!row || !credential || row.status !== "connected" || row.generation !== a.expected_generation || row.account_digest !== a.expected_account_digest) return { data: false, error: null };
    credential.sealed_credential = a.credential_ciphertext as string;
    return { data: true, error: null };
  }
  if (name === "connector_disconnect") {
    const row = db.connections.get(key(owner, provider));
    if (!row || row.generation !== a.expected_generation || (a.next_status === "reconnect_required" && row.status !== "connected")) return fail("connector_connection_changed");
    Object.assign(row, { generation: row.generation + 1, status: a.next_status, attempt_hash: null, account_digest: a.next_status === "disconnected" ? null : row.account_digest });
    for (const [hash, attempt] of db.attempts) if (attempt.user_id === owner && attempt.provider === provider) db.attempts.delete(hash);
    db.credentials.delete(key(owner, provider));
    const pref = db.preferences.get(key(owner, provider));
    if (pref) Object.assign(pref, { selected_source_ids: [], hidden_source_ids: [], selection_revision: pref.selection_revision + 1 });
    return { data: row.generation, error: null };
  }
  return fail("unknown rpc");
}
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), cookieUser: null as null | { id: string }, auth: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createServiceRoleClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: mocks.cookieUser }, error: null }) } }) }));
vi.mock("@/lib/services/google-calendar-request", async (importOriginal) => ({ ...await importOriginal<object>(), authenticateCalendarRequest: mocks.auth }));

function userClient(subject: string) {
  return { from(table: string) {
    if (table === "profiles") return { select: () => ({ eq: () => ({ single: async () => ({ data: { timezone: "America/New_York" }, error: null }) }) }) };
    const filters: Record<string, unknown> = {}; let patch: Record<string, unknown> | null = null;
    const rows = () => [...(table === "connector_connections" ? db.connections.values() : db.preferences.values())]
      .filter((row) => row.user_id === subject && Object.entries(filters).every(([column, value]) => (row as Record<string, unknown>)[column] === value))
      .map((row) => ({ ...row, attempt_hash: undefined }));
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

import { connectorAccountDigest, readConnectorCredentialConfig, openConnectorCredential, type ConnectorCaller } from "@/lib/services/connector-credentials";
import { OUTLOOK_PERSONAL_TENANT_ID, outlookNonce } from "@/lib/services/outlook-calendar-oauth";
import {
  completeOutlookCalendarDesktopConnection, disconnectOutlookCalendar, finishOutlookCalendarCallback, getOutlookCalendarConnection,
  getOutlookCalendarEvents, listOutlookCalendarsForCaller, startOutlookCalendarConnection, updateOutlookCalendarPreferences,
  type OutlookServiceOptions,
} from "@/lib/services/outlook-calendar.service";
import { ConnectorError } from "@/lib/types/connectors";
import * as connectorRepo from "@/lib/db/connectors.repo";
import * as connectionRoute from "@/app/api/outlook-calendar/connection/route";
import * as eventsRoute from "@/app/api/outlook-calendar/events/route";
import * as callbackRoute from "@/app/auth/outlook-calendar/callback/route";

const OWNER = "22400000-0000-4000-8000-000000000001";
const ATTACKER = "22400000-0000-4000-8000-000000000002";
const CLIENT_ID = "11111111-2222-4333-8444-555555555555";
const WORK_TENANT = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ORIGIN = "https://cadence.example";
const NOW_MS = Date.parse("2026-11-01T13:00:00Z");
const CLIENT_STATE = "desktop-keychain-state-0123456789abcdef";
const caller = (id: string): ConnectorCaller => ({ client: userClient(id) as unknown as ConnectorCaller["client"], user: { id } as User });

// Fake Microsoft identity platform and Graph.
const ms = {
  identity: { tid: OUTLOOK_PERSONAL_TENANT_ID, sub: "subject-a" },
  validRefresh: new Set<string>(),
  rotateTo: null as string | null,
  calls: [] as Array<{ url: URL; body: URLSearchParams | null; auth: string | null }>,
  graph: null as null | ((url: URL) => Response),
  stepMs: 0,
  time: NOW_MS,
  onView: null as null | (() => void),
  refreshScope: null as string | null,
};
function idToken(nonce: string) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const seconds = Math.floor(ms.time / 1000);
  return `${encode({ alg: "RS256" })}.${encode({ aud: CLIENT_ID, iss: `https://login.microsoftonline.com/${ms.identity.tid}/v2.0`, tid: ms.identity.tid,
    sub: ms.identity.sub, ver: "2.0", nonce, iat: seconds, exp: seconds + 3600 })}.sig`;
}
const SCOPE = "openid offline_access Calendars.Read";
const fetcher = vi.fn(async (input: string | URL, init?: RequestInit) => {
  const url = new URL(input.toString());
  const body = init?.body ? new URLSearchParams(init.body as URLSearchParams) : null;
  const headers = (init?.headers ?? {}) as Record<string, string>;
  ms.calls.push({ url, body, auth: headers.Authorization ?? null });
  ms.time += ms.stepMs;
  if (url.hostname === "login.microsoftonline.com") {
    if (body!.get("grant_type") === "authorization_code") {
      const refresh = `refresh-${ms.identity.sub}`;
      ms.validRefresh.add(refresh);
      return Response.json({ access_token: "access-1", token_type: "Bearer", scope: SCOPE, refresh_token: refresh, id_token: idToken(outlookNonce(body!.get("code_verifier")!)) });
    }
    const presented = body!.get("refresh_token")!;
    if (!ms.validRefresh.has(presented)) return Response.json({ error: "invalid_grant" }, { status: 400 });
    const next = ms.rotateTo;
    if (next) { ms.validRefresh.add(next); ms.rotateTo = null; }
    return Response.json({ access_token: `access-for-${presented}`, token_type: "Bearer", scope: ms.refreshScope ?? SCOPE, ...(next ? { refresh_token: next } : {}) });
  }
  if (url.hostname === "graph.microsoft.com") {
    if (ms.graph) return ms.graph(url);
    if (url.pathname === "/v1.0/me/calendars") return Response.json({ value: [{ id: "calendar-1", name: "Personal", isDefaultCalendar: true }, { id: "calendar-2", name: "Work" }] });
    ms.onView?.();
    return Response.json({ value: [{ id: "evt-1", subject: "Standup", isAllDay: false, isCancelled: false, showAs: "busy", type: "singleInstance",
      originalStartTimeZone: "Eastern Standard Time", start: { dateTime: "2026-11-01T14:00:00.0000000", timeZone: "UTC" },
      end: { dateTime: "2026-11-01T14:15:00.0000000", timeZone: "UTC" }, changeKey: "ck", lastModifiedDateTime: "2026-10-30T12:00:00Z" }] });
  }
  throw new Error(`unexpected ${url}`);
});
const options: OutlookServiceOptions = { fetch: fetcher, clock: () => ms.time, sleep: async () => undefined };
const tokenCalls = () => ms.calls.filter((call) => call.url.hostname === "login.microsoftonline.com").length;

beforeEach(() => {
  db.users = new Set([OWNER, ATTACKER]); db.connections.clear(); db.preferences.clear(); db.credentials.clear(); db.attempts.clear(); db.rpcCalls = [];
  mocks.rpc.mockReset(); mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => runRpc(name, args));
  mocks.cookieUser = null;
  mocks.auth.mockReset(); mocks.auth.mockImplementation(async (request: Request) => {
    const header = request.headers.get("authorization");
    if (!header?.startsWith("Bearer ")) throw new ConnectorError("unauthenticated");
    return caller(header.slice(7));
  });
  Object.assign(ms, { identity: { tid: OUTLOOK_PERSONAL_TENANT_ID, sub: "subject-a" }, rotateTo: null, calls: [], graph: null, stepMs: 0, time: NOW_MS, onView: null, refreshScope: null });
  ms.validRefresh.clear(); fetcher.mockClear();
  vi.stubEnv("CONNECTOR_CREDENTIAL_ENCRYPTION_KEY", Buffer.alloc(32, 9).toString("base64")); vi.stubEnv("CONNECTOR_CREDENTIAL_KEY_ID", "c1");
  vi.stubEnv("CONNECTOR_CREDENTIAL_DECRYPTION_KEYS", "");
  vi.stubEnv("OUTLOOK_CALENDAR_CLIENT_ID", CLIENT_ID); vi.stubEnv("OUTLOOK_CALENDAR_CLIENT_SECRET", "synthetic-client-secret");
  vi.stubEnv("OUTLOOK_CALENDAR_CALLBACK_URL", `${ORIGIN}/auth/outlook-calendar/callback`);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

async function startWeb(owner = OWNER) {
  const { url } = await startOutlookCalendarConnection(caller(owner), { target: "web" }, ORIGIN);
  return new URL(url).searchParams.get("state")!;
}
async function connectWeb(owner = OWNER) {
  const state = await startWeb(owner);
  mocks.cookieUser = { id: owner };
  return finishOutlookCalendarCallback({ state, code: "code-1", error: null, errorDescription: null, cookieUser: { id: owner } as User, requestOrigin: ORIGIN }, options);
}

describe("consent start", () => {
  it("stores a hashed one-use web attempt and returns the Microsoft URL", async () => {
    const state = await startWeb();
    expect(state).toMatch(/^w[A-Za-z0-9_-]{43}$/);
    const attempt = [...db.attempts.values()][0]!;
    expect(attempt).toMatchObject({ user_id: OWNER, target: "web", client_state: "", state_hash: createHash("sha256").update(state).digest("hex") });
    expect(attempt.sealed_verifier).not.toContain(state);
  });

  it("validates targets, desktop client state, and configuration", async () => {
    await expect(startOutlookCalendarConnection(caller(OWNER), { target: "desktop" }, ORIGIN)).rejects.toThrow("invalid_request");
    await expect(startOutlookCalendarConnection(caller(OWNER), { target: "web", clientState: CLIENT_STATE }, ORIGIN)).rejects.toThrow("invalid_request");
    await expect(startOutlookCalendarConnection(caller(OWNER), { target: "web", extra: 1 }, ORIGIN)).rejects.toThrow("invalid_request");
    await expect(startOutlookCalendarConnection(caller(OWNER), { target: "web" }, "https://other.example")).rejects.toThrow("not_configured");
    vi.stubEnv("OUTLOOK_CALENDAR_CLIENT_SECRET", "");
    await expect(startOutlookCalendarConnection(caller(OWNER), { target: "web" }, ORIGIN)).rejects.toThrow("not_configured");
    expect(await getOutlookCalendarConnection(caller(OWNER))).toMatchObject({ status: "not_configured", provider: "outlook_calendar" });
    expect(db.attempts.size).toBe(0);
  });
});

describe("web callback", () => {
  it("installs a sealed credential bound to the cookie user and tid/sub", async () => {
    expect(await connectWeb()).toBe(`${ORIGIN}/settings?outlook_calendar=connected`);
    const row = db.connections.get(key(OWNER, "outlook_calendar"))!;
    expect(row).toMatchObject({ status: "connected", generation: 1, account_digest: connectorAccountDigest("outlook_calendar", [OUTLOOK_PERSONAL_TENANT_ID, "subject-a"]) });
    const sealed = db.credentials.get(key(OWNER, "outlook_calendar"))!.sealed_credential;
    expect(sealed).not.toContain("refresh-subject-a");
    expect(openConnectorCredential(readConnectorCredentialConfig()!, sealed, { purpose: "credential", userId: OWNER, provider: "outlook_calendar",
      accountDigest: row.account_digest, generation: 1 })).toEqual({ provider: "outlook_calendar", refreshToken: "refresh-subject-a" });
    expect(tokenCalls()).toBe(1);
  });

  it("rejects a different signed-in Cadence user without exchanging the code", async () => {
    const state = await startWeb(ATTACKER);
    const location = await finishOutlookCalendarCallback({ state, code: "code", error: null, errorDescription: null, cookieUser: { id: OWNER } as User, requestOrigin: ORIGIN }, options);
    expect(location).toBe(`${ORIGIN}/settings?outlook_calendar=unauthenticated`);
    const anonymous = await startWeb(ATTACKER);
    expect(await finishOutlookCalendarCallback({ state: anonymous, code: "code", error: null, errorDescription: null, cookieUser: null, requestOrigin: ORIGIN }, options))
      .toBe(`${ORIGIN}/settings?outlook_calendar=unauthenticated`);
    expect(tokenCalls()).toBe(0);
    expect(db.connections.get(key(OWNER, "outlook_calendar"))).toBeUndefined();
  });

  it("refuses replayed, expired, and malformed state", async () => {
    const state = await startWeb();
    const input = { state, code: "code", error: null, errorDescription: null, cookieUser: { id: OWNER } as User, requestOrigin: ORIGIN };
    expect(await finishOutlookCalendarCallback(input, options)).toContain("=connected");
    expect(await finishOutlookCalendarCallback(input, options)).toBe(`${ORIGIN}/settings?outlook_calendar=expired_attempt`);
    const expired = await startWeb();
    db.attempts.clear();
    expect(await finishOutlookCalendarCallback({ ...input, state: expired }, options)).toContain("=expired_attempt");
    const calls = db.rpcCalls.length;
    expect(await finishOutlookCalendarCallback({ ...input, state: "short" }, options)).toBe(`${ORIGIN}/settings?outlook_calendar=error`);
    expect(db.rpcCalls.length).toBe(calls);
    expect(tokenCalls()).toBe(1);
  });

  it("maps consent denial and tenant admin approval without exchanging tokens", async () => {
    const base = { code: null, cookieUser: { id: OWNER } as User, requestOrigin: ORIGIN };
    expect(await finishOutlookCalendarCallback({ ...base, state: await startWeb(), error: "access_denied", errorDescription: "AADSTS65004" }, options)).toContain("=cancelled");
    expect(await finishOutlookCalendarCallback({ ...base, state: await startWeb(), error: "access_denied", errorDescription: "AADSTS90094 admin" }, options)).toContain("=admin_approval_required");
    expect(tokenCalls()).toBe(0);
    expect(db.attempts.size).toBe(0);
  });

  it("returns wrong_account when a different Microsoft account reconnects a bound connection", async () => {
    await connectWeb();
    ms.validRefresh.clear();
    await expect(listOutlookCalendarsForCaller(caller(OWNER), options)).rejects.toThrow("reconnect_required");
    expect(db.connections.get(key(OWNER, "outlook_calendar"))!.status).toBe("reconnect_required");
    ms.identity = { tid: WORK_TENANT, sub: "subject-b" };
    expect(await connectWeb()).toContain("=wrong_account");
    expect(db.connections.get(key(OWNER, "outlook_calendar"))).toMatchObject({ status: "reconnect_required",
      account_digest: connectorAccountDigest("outlook_calendar", [OUTLOOK_PERSONAL_TENANT_ID, "subject-a"]) });
    // The same tenant but a different subject is also a different account.
    ms.identity = { tid: OUTLOOK_PERSONAL_TENANT_ID, sub: "subject-c" };
    expect(await connectWeb()).toContain("=wrong_account");
    ms.identity = { tid: OUTLOOK_PERSONAL_TENANT_ID, sub: "subject-a" };
    expect(await connectWeb()).toContain("=connected");
  });
});

describe("desktop completion", () => {
  async function startDesktop(owner = OWNER) {
    const { url } = await startOutlookCalendarConnection(caller(owner), { target: "desktop", clientState: CLIENT_STATE });
    return new URL(url).searchParams.get("state")!;
  }

  it("forwards the code to the app without consuming the attempt and completes only for the initiating session", async () => {
    const state = await startDesktop();
    const location = await finishOutlookCalendarCallback({ state, code: "desktop-code", error: null, errorDescription: null, cookieUser: null, requestOrigin: ORIGIN }, options);
    const deepLink = new URL(location);
    expect(deepLink.protocol + deepLink.host + deepLink.pathname).toBe("cadence:outlook-calendar/callback");
    expect(Object.fromEntries(deepLink.searchParams)).toEqual({ state, code: "desktop-code" });
    expect(db.attempts.size).toBe(1);
    expect(tokenCalls()).toBe(0);
    const result = await completeOutlookCalendarDesktopConnection(caller(OWNER), { state, clientState: CLIENT_STATE, code: "desktop-code" }, options);
    expect(result).toMatchObject({ status: "connected", result: "connected", generation: 1 });
    await expect(completeOutlookCalendarDesktopConnection(caller(OWNER), { state, clientState: CLIENT_STATE, code: "desktop-code" }, options)).rejects.toThrow("expired_attempt");
  });

  it("does not let an attacker-started attempt link a victim's Microsoft account, or accept the wrong Keychain state", async () => {
    const attackerState = await startDesktop(ATTACKER);
    await expect(completeOutlookCalendarDesktopConnection(caller(OWNER), { state: attackerState, clientState: CLIENT_STATE, code: "victim-code" }, options)).rejects.toThrow("expired_attempt");
    const state = await startDesktop();
    await expect(completeOutlookCalendarDesktopConnection(caller(OWNER), { state, clientState: `${CLIENT_STATE}x`, code: "c" }, options)).rejects.toThrow("expired_attempt");
    expect(tokenCalls()).toBe(0);
    expect(db.credentials.size).toBe(0);
  });

  it("refuses web state on the desktop path and desktop state on the web path", async () => {
    const webState = await startWeb();
    await expect(completeOutlookCalendarDesktopConnection(caller(OWNER), { state: webState, clientState: CLIENT_STATE, code: "c" }, options)).rejects.toThrow("invalid_request");
    const desktopState = await startDesktop();
    // Changing the target marker changes the hash, so no attempt is found.
    const swapped = `w${desktopState.slice(1)}`;
    expect(await finishOutlookCalendarCallback({ state: swapped, code: "c", error: null, errorDescription: null, cookieUser: { id: OWNER } as User, requestOrigin: ORIGIN }, options)).toContain("=expired_attempt");
  });

  it("forwards consent denial as a fixed result and clears the attempt on completion", async () => {
    const state = await startDesktop();
    const location = await finishOutlookCalendarCallback({ state, code: null, error: "access_denied", errorDescription: "AADSTS90095", cookieUser: null, requestOrigin: ORIGIN }, options);
    expect(new URL(location).searchParams.get("result")).toBe("admin_approval_required");
    expect(await completeOutlookCalendarDesktopConnection(caller(OWNER), { state, clientState: CLIENT_STATE, result: "admin_approval_required" }, options))
      .toMatchObject({ result: "admin_approval_required", status: "disconnected" });
    expect(db.attempts.size).toBe(0);
  });
});

describe("reads, rotation, and fences", () => {
  async function connectAndSelect() {
    await connectWeb();
    await updateOutlookCalendarPreferences(caller(OWNER), { selectedSourceIds: ["calendar-1"], hiddenSourceIds: [], visible: true, showAllDay: true }, options);
  }

  it("rotates a replacement refresh token inside the live generation", async () => {
    await connectWeb();
    ms.rotateTo = "refresh-rotated";
    await listOutlookCalendarsForCaller(caller(OWNER), options);
    await listOutlookCalendarsForCaller(caller(OWNER), options);
    const refreshes = ms.calls.filter((call) => call.body?.get("grant_type") === "refresh_token").map((call) => call.body!.get("refresh_token"));
    expect(refreshes).toEqual(["refresh-subject-a", "refresh-rotated"]);
    expect(db.connections.get(key(OWNER, "outlook_calendar"))!.generation).toBe(1);
  });

  it("returns a validated 1.1.0 snapshot for the saved selection and sends the token only to Graph", async () => {
    await connectAndSelect();
    const snapshot = await getOutlookCalendarEvents(caller(OWNER), "2026-11-01", "2026-11-03", options);
    expect(snapshot).toMatchObject({ schemaVersion: "1.1.0", source: "outlook_calendar", accountId: OWNER, connectionGeneration: 1, completeness: "complete",
      requestedRange: { selectedCalendarIds: ["calendar-1"], timezone: "America/New_York" } });
    expect(snapshot.events.map((event) => event.id)).toEqual(["outlook_calendar/calendar-1/evt-1"]);
    for (const call of ms.calls.filter((entry) => entry.auth)) expect(call.url.origin).toBe("https://graph.microsoft.com");
  });

  it("validates the range and selection before provider reads", async () => {
    await connectWeb();
    const before = ms.calls.length;
    await expect(getOutlookCalendarEvents(caller(OWNER), "2026-11-02", "2026-11-03", options)).rejects.toThrow("invalid_request");
    await expect(getOutlookCalendarEvents(caller(OWNER), "2026-11-01", "2026-12-02", options)).rejects.toThrow("invalid_request");
    await expect(getOutlookCalendarEvents(caller(OWNER), "2026-11-1", "2026-11-03", options)).rejects.toThrow("invalid_request");
    expect(ms.calls.length).toBe(before);
    await expect(getOutlookCalendarEvents(caller(OWNER), "2026-11-01", "2026-11-03", options)).rejects.toThrow("invalid_request");
  });

  it("fences a read whose connection changed in flight or whose expected generation is stale", async () => {
    await connectAndSelect();
    await expect(getOutlookCalendarEvents(caller(OWNER), "2026-11-01", "2026-11-01", { ...options, expectedConnectionGeneration: 9 })).rejects.toThrow("connection_changed");
    ms.onView = () => { const pref = db.preferences.get(key(OWNER, "outlook_calendar"))!; pref.selection_revision += 1; };
    await expect(getOutlookCalendarEvents(caller(OWNER), "2026-11-01", "2026-11-01", options)).rejects.toThrow("connection_changed");
  });

  it("marks only Outlook reconnect_required on a revoked grant or Graph 401", async () => {
    await connectAndSelect();
    db.connections.set(key(OWNER, "hevy"), { user_id: OWNER, provider: "hevy", account_digest: "a".repeat(64), attempt_hash: null, generation: 3, status: "connected" });
    ms.graph = (url) => url.pathname === "/v1.0/me/calendars" ? Response.json({ value: [{ id: "calendar-1", name: "Personal" }] }) : new Response("{}", { status: 401 });
    await expect(getOutlookCalendarEvents(caller(OWNER), "2026-11-01", "2026-11-01", options)).rejects.toThrow("reconnect_required");
    expect(db.connections.get(key(OWNER, "outlook_calendar"))!.status).toBe("reconnect_required");
    expect(db.credentials.has(key(OWNER, "outlook_calendar"))).toBe(false);
    expect(db.connections.get(key(OWNER, "hevy"))).toMatchObject({ status: "connected", generation: 3 });
  });

  it("moves an existing Calendars.ReadBasic-only connection to reconnect_required on its next read without a Graph call", async () => {
    await connectAndSelect();
    ms.refreshScope = "https://graph.microsoft.com/Calendars.ReadBasic offline_access";
    const graphCalls = () => ms.calls.filter((call) => call.url.hostname === "graph.microsoft.com").length;
    const before = graphCalls();
    await expect(getOutlookCalendarEvents(caller(OWNER), "2026-11-01", "2026-11-01", options)).rejects.toThrow("reconnect_required");
    expect(graphCalls()).toBe(before);
    expect(db.connections.get(key(OWNER, "outlook_calendar"))!.status).toBe("reconnect_required");
    expect(db.credentials.has(key(OWNER, "outlook_calendar"))).toBe(false);
    await expect(listOutlookCalendarsForCaller(caller(OWNER), options)).rejects.toThrow("reconnect_required");
  });

  it("spends one 25-second deadline across token refresh, listing, and calendar reads", async () => {
    await connectAndSelect();
    ms.stepMs = 13_000;
    const before = ms.calls.length;
    await expect(getOutlookCalendarEvents(caller(OWNER), "2026-11-01", "2026-11-01", options)).rejects.toThrow("timeout");
    // Refresh (0-13 s) and listing (13-26 s) run; calendarView never starts.
    expect(ms.calls.slice(before).map((call) => call.url.pathname)).toEqual(["/common/oauth2/v2.0/token", "/v1.0/me/calendars"]);
  });

  it("ends an unresponsive refresh at the deadline and discards a refresh that completes late", async () => {
    await connectAndSelect();
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (input, init) => new URL(input.toString()).hostname === "login.microsoftonline.com" ? new Promise<Response>(() => undefined) : original(input, init));
    const started = Date.now();
    await expect(getOutlookCalendarEvents(caller(OWNER), "2026-11-01", "2026-11-01", { ...options, deadlineMs: 50 })).rejects.toThrow("timeout");
    expect(Date.now() - started).toBeLessThan(2_000);
    fetcher.mockImplementation(original);
    // The refresh returns a rotated token, but only after the 25 s deadline: no Graph call and no rotation.
    ms.rotateTo = "refresh-late"; ms.stepMs = 26_000;
    const before = ms.calls.length;
    const sealed = db.credentials.get(key(OWNER, "outlook_calendar"))!.sealed_credential;
    await expect(getOutlookCalendarEvents(caller(OWNER), "2026-11-01", "2026-11-01", options)).rejects.toThrow("timeout");
    expect(ms.calls.slice(before).map((call) => call.url.hostname)).toEqual(["login.microsoftonline.com"]);
    expect(db.credentials.get(key(OWNER, "outlook_calendar"))!.sealed_credential).toBe(sealed);
  });

  it("saves only readable selections with an exact body", async () => {
    await connectWeb();
    const bad = [
      { selectedSourceIds: ["missing"], hiddenSourceIds: [], visible: true, showAllDay: true },
      { selectedSourceIds: ["calendar-1"], hiddenSourceIds: ["calendar-2"], visible: true, showAllDay: true },
      { selectedSourceIds: ["calendar-1", "calendar-1"], hiddenSourceIds: [], visible: true, showAllDay: true },
      { selectedSourceIds: ["calendar-1"], hiddenSourceIds: [], visible: true, showAllDay: true, extra: true },
      { selectedCalendarIds: ["calendar-1"], hiddenCalendarIds: [], visible: true, showAllDay: true },
    ];
    for (const body of bad) await expect(updateOutlookCalendarPreferences(caller(OWNER), body, options)).rejects.toThrow("invalid_request");
    const view = await updateOutlookCalendarPreferences(caller(OWNER), { selectedSourceIds: ["calendar-2", "calendar-1"], hiddenSourceIds: ["calendar-2"], visible: false, showAllDay: true }, options);
    expect(view.preferences).toEqual({ selectedSourceIds: ["calendar-2", "calendar-1"], hiddenSourceIds: ["calendar-2"], visible: false, showAllDay: true });
  });

  it("cannot restore a selection after disconnect wins the write race", async () => {
    await connectAndSelect();
    const original = connectorRepo.saveConnectorPreferences;
    vi.spyOn(connectorRepo, "saveConnectorPreferences").mockImplementationOnce(async (...args) => {
      await disconnectOutlookCalendar(caller(OWNER));
      return original(...args);
    });
    await expect(updateOutlookCalendarPreferences(caller(OWNER), {
      selectedSourceIds: ["calendar-2"], hiddenSourceIds: [], visible: true, showAllDay: true,
    }, options)).rejects.toMatchObject({ code: "connection_changed" });
    expect(db.preferences.get(key(OWNER, "outlook_calendar"))!.selected_source_ids).toEqual([]);
  });

  it.each(["credential", "final fence"])("bounds a stalled %s read and discards late completion", async (stage) => {
    await connectAndSelect();
    ms.calls = [];
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    if (stage === "credential") {
      const original = connectorRepo.readConnectorCredential;
      vi.spyOn(connectorRepo, "readConnectorCredential").mockImplementation(async (connection) => {
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
    const result = getOutlookCalendarEvents(caller(OWNER), "2026-11-01", "2026-11-01", { ...options, deadlineMs: 20 });
    await expect(result).rejects.toMatchObject({ code: "timeout" });
    const calls = ms.calls.length;
    expect(calls).toBe(stage === "credential" ? 0 : 3);
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ms.calls).toHaveLength(calls);
    await expect(result).rejects.toMatchObject({ code: "timeout" });
  });
});

describe("disconnect and routes", () => {
  it("deletes the credential, fences reads, and returns the Microsoft removal instruction without claiming revocation", async () => {
    await connectWeb();
    const before = ms.calls.length;
    const view = await disconnectOutlookCalendar(caller(OWNER));
    expect(view).toMatchObject({ status: "disconnected", revocation: "microsoft_account_permissions", generation: 2 });
    expect(view).not.toHaveProperty("revoked");
    expect(ms.calls.length).toBe(before);
    expect(db.credentials.size).toBe(0);
    await expect(listOutlookCalendarsForCaller(caller(OWNER), options)).rejects.toThrow("not_connected");
  });

  it("serves stable error codes only and binds desktop completion to the bearer session", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => fetcher(input instanceof Request ? input.url : input, init));
    await connectWeb();
    ms.validRefresh.clear();
    const events = await eventsRoute.GET(new Request(`${ORIGIN}/api/outlook-calendar/events?start=2026-11-01&end=2026-11-01`, { headers: { authorization: `Bearer ${OWNER}` } }));
    // No selection yet: rejected before the token endpoint.
    expect(events.status).toBe(400);
    expect(await events.json()).toEqual({ error: "invalid_request" });

    const started = await connectionRoute.POST(new Request(`${ORIGIN}/api/outlook-calendar/connection`, { method: "POST", headers: { authorization: `Bearer ${ATTACKER}` },
      body: JSON.stringify({ target: "desktop", clientState: CLIENT_STATE }) }));
    const state = new URL((await started.json()).url).searchParams.get("state");
    const hijack = await connectionRoute.PUT(new Request(`${ORIGIN}/api/outlook-calendar/connection`, { method: "PUT", headers: { authorization: `Bearer ${OWNER}` },
      body: JSON.stringify({ state, clientState: CLIENT_STATE, code: "victim-code" }) }));
    expect(hijack.status).toBe(409);
    expect(await hijack.text()).toBe(JSON.stringify({ error: "expired_attempt" }));
    expect(hijack.headers.get("cache-control")).toBe("no-store");
    const unauthenticated = await connectionRoute.GET(new Request(`${ORIGIN}/api/outlook-calendar/connection`));
    expect(unauthenticated.status).toBe(401);
  });

  it("redirects the browser callback with fixed results and never echoes provider text", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => fetcher(input instanceof Request ? input.url : input, init));
    // The route uses the system clock, so the synthetic ID token must be current.
    ms.time = Date.now();
    const state = await startWeb();
    mocks.cookieUser = { id: OWNER };
    const ok = await callbackRoute.GET(new Request(`${ORIGIN}/auth/outlook-calendar/callback?state=${state}&code=code-1`));
    expect(ok.status).toBe(302);
    expect(ok.headers.get("location")).toBe(`${ORIGIN}/settings?outlook_calendar=connected`);
    expect(ok.headers.get("referrer-policy")).toBe("no-referrer");
    const denied = await callbackRoute.GET(new Request(`${ORIGIN}/auth/outlook-calendar/callback?state=${await startWeb()}&error=access_denied&error_description=${encodeURIComponent("<script>x</script>")}`));
    expect(denied.headers.get("location")).toBe(`${ORIGIN}/settings?outlook_calendar=cancelled`);
    vi.stubEnv("OUTLOOK_CALENDAR_CLIENT_ID", "");
    const unconfigured = await callbackRoute.GET(new Request(`${ORIGIN}/auth/outlook-calendar/callback?state=${state}&code=x`));
    expect(unconfigured.status).toBe(400);
    expect(await unconfigured.text()).not.toContain("script");
  });
});
