import { createCipheriv, createDecipheriv } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { User } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Synthetic credentials only. The fake mirrors the compare-and-swap rules in
// 20261019040000_connector_lifecycle.sql; tests/sql/context-connectors-contract.sql
// proves the same rules against Postgres.
type Row = { user_id: string; provider: string; account_digest: string | null; attempt_hash: string | null; generation: number; status: string };
type Pref = { user_id: string; provider: string; selection_revision: number; selected_source_ids: string[]; hidden_source_ids: string[]; visible: boolean; show_all_day: boolean };
type Cred = { account_digest: string; generation: number; sealed_credential: string };
type Attempt = { state_hash: string; user_id: string; provider: string; generation: number; sealed_verifier: string; target: string; client_state: string; expires_at: string };
const db = vi.hoisted(() => ({
  users: new Set<string>(),
  connections: new Map<string, Row>(),
  preferences: new Map<string, Pref>(),
  credentials: new Map<string, Cred>(),
  attempts: new Map<string, Attempt>(),
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  rpcFailure: null as null | { message: string },
}));
const key = (user: string, provider: string) => `${user}/${provider}`;
function fail(message: string) { return { data: null, error: { message } }; }
function ensureRow(user: string, provider: string): Row {
  const existing = db.connections.get(key(user, provider));
  if (existing) return existing;
  const row = { user_id: user, provider, account_digest: null, attempt_hash: null, generation: 0, status: "disconnected" };
  db.connections.set(key(user, provider), row);
  return row;
}
function ensurePref(user: string, provider: string) {
  if (!db.preferences.has(key(user, provider))) db.preferences.set(key(user, provider), { user_id: user, provider, selection_revision: 0,
    selected_source_ids: [], hidden_source_ids: [], visible: true, show_all_day: true });
}
const rpc = vi.hoisted(() => vi.fn());
function runRpc(name: string, a: Record<string, unknown>) {
  db.rpcCalls.push({ name, args: a });
  if (db.rpcFailure) return fail(db.rpcFailure.message);
  const owner = a.owner_id as string; const provider = a.provider_key as string;
  if (name === "connector_begin_attempt") {
    if (provider !== "outlook_calendar") return fail("connector_provider_unsupported");
    if (!db.users.has(owner)) return fail("connector_owner_missing");
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
    if (!db.users.has(owner)) return fail("connector_owner_missing");
    if (provider !== "outlook_calendar") { if (a.expected_state_hash !== null) return fail("connector_connection_changed"); ensureRow(owner, provider); }
    const row = db.connections.get(key(owner, provider));
    if (!row || row.generation !== a.expected_generation) return fail("connector_connection_changed");
    if (provider === "outlook_calendar" && (!a.expected_state_hash || row.attempt_hash !== a.expected_state_hash)) return fail("connector_connection_changed");
    if (row.account_digest && row.account_digest !== a.provider_account_digest) return fail("connector_wrong_account");
    Object.assign(row, { generation: row.generation + 1, status: "connected", account_digest: a.provider_account_digest, attempt_hash: null });
    db.credentials.set(key(owner, provider), { account_digest: row.account_digest!, generation: row.generation, sealed_credential: a.credential_ciphertext as string });
    ensurePref(owner, provider);
    return { data: row.generation, error: null };
  }
  if (name === "connector_read_credential") {
    const row = db.connections.get(key(owner, provider)); const credential = db.credentials.get(key(owner, provider));
    const ok = row && credential && row.status === "connected" && row.generation === a.expected_generation && credential.generation === row.generation &&
      credential.account_digest === a.expected_account_digest && row.account_digest === credential.account_digest;
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
vi.mock("@/lib/supabase/admin", () => ({ createServiceRoleClient: () => ({ rpc }) }));

// Owner-scoped RLS: the fake user client sees only rows whose user_id equals its JWT subject.
function userClient(subject: string) {
  return { from(table: string) {
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

import { readCalendarOAuthConfig, sealCalendarSecret, openCalendarSecret } from "@/lib/services/google-calendar-oauth";
import {
  beginConnectorOAuthAttempt, completeConnectorOAuthAttempt, connectDirectCredential, connectorAccountDigest, consumeConnectorOAuthAttempt,
  disconnectConnector, getConnectorConnection, getConnectorConnections, openConnectorCredential, readConnectorCredentialConfig,
  rotateConnectorCredential, sealConnectorCredential, withConnectorCredential, type ConnectorCaller, type ConnectorSecretBinding,
} from "@/lib/services/connector-credentials";
import { readConnectorCredentialBody, runConnectorRequest } from "@/lib/services/connector-request";
import { ConnectorError, type ConnectorConnection, type ConnectorCredential } from "@/lib/types/connectors";
import { readConnectorCredential } from "@/lib/db/connectors.repo";

const OWNER = "22200000-0000-4000-8000-000000000001";
const OTHER = "22200000-0000-4000-8000-000000000002";
const HEVY_KEY = "synthetic-hevy-key-0001";
const APPLE = { appleId: "synthetic@example.invalid", appPassword: "abcd-efgh-ijkl-mnop" };
const KEY = Buffer.alloc(32, 7).toString("base64");
const caller = (id: string): ConnectorCaller => ({ client: userClient(id) as unknown as ConnectorCaller["client"], user: { id } as User });
const hevy = (apiKey = HEVY_KEY): ConnectorCredential & { provider: "hevy" } => ({ provider: "hevy", apiKey });
const icloud = (): ConnectorCredential & { provider: "icloud_calendar" } => ({ provider: "icloud_calendar", ...APPLE });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }

beforeEach(() => {
  db.users = new Set([OWNER, OTHER]); db.connections.clear(); db.preferences.clear(); db.credentials.clear(); db.attempts.clear();
  db.rpcCalls = []; db.rpcFailure = null;
  rpc.mockReset(); rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => runRpc(name, args));
  vi.stubEnv("CONNECTOR_CREDENTIAL_ENCRYPTION_KEY", KEY); vi.stubEnv("CONNECTOR_CREDENTIAL_KEY_ID", "c1");
  vi.stubEnv("CONNECTOR_CREDENTIAL_DECRYPTION_KEYS", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("connector credential configuration and sealing", () => {
  it("requires a canonical 32-byte key and distinct retired key IDs", () => {
    expect(readConnectorCredentialConfig({})).toBeNull();
    expect(readConnectorCredentialConfig({ CONNECTOR_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(16).toString("base64"), CONNECTOR_CREDENTIAL_KEY_ID: "c1" })).toBeNull();
    expect(readConnectorCredentialConfig({ CONNECTOR_CREDENTIAL_ENCRYPTION_KEY: KEY, CONNECTOR_CREDENTIAL_KEY_ID: "bad id" })).toBeNull();
    expect(readConnectorCredentialConfig({ CONNECTOR_CREDENTIAL_ENCRYPTION_KEY: KEY, CONNECTOR_CREDENTIAL_KEY_ID: "c1", CONNECTOR_CREDENTIAL_DECRYPTION_KEYS: JSON.stringify({ c1: KEY }) })).toBeNull();
    expect(readConnectorCredentialConfig({ CONNECTOR_CREDENTIAL_ENCRYPTION_KEY: KEY, CONNECTOR_CREDENTIAL_KEY_ID: "c2", CONNECTOR_CREDENTIAL_DECRYPTION_KEYS: JSON.stringify({ c1: KEY }) })?.decryptionKeys.c1).toHaveLength(32);
  });

  it("binds ciphertext to owner, provider, identity, generation, purpose, and attempt", () => {
    const config = readConnectorCredentialConfig()!;
    const binding: ConnectorSecretBinding = { purpose: "credential", userId: OWNER, provider: "hevy", accountDigest: connectorAccountDigest("hevy", ["42"]), generation: 1 };
    const sealed = sealConnectorCredential(config, hevy(), binding);
    expect(sealed).not.toContain(HEVY_KEY);
    expect(sealed.startsWith("c1.")).toBe(true);
    expect(openConnectorCredential(config, sealed, binding)).toEqual(hevy());
    for (const changed of [{ userId: OTHER }, { provider: "icloud_calendar" as const }, { accountDigest: connectorAccountDigest("hevy", ["43"]) },
      { generation: 2 }, { purpose: "verifier" as const }, { stateHash: "a".repeat(64) }]) {
      expect(() => openConnectorCredential(config, sealed, { ...binding, ...changed })).toThrow(ConnectorError);
    }
    const tampered = sealed.slice(0, -2) + (sealed.endsWith("A") ? "BB" : "AA");
    expect(() => openConnectorCredential(config, tampered, binding)).toThrow("reconnect_required");
    expect(() => sealConnectorCredential(config, icloud(), binding)).toThrow("invalid_request");
    expect(() => sealConnectorCredential(config, { provider: "hevy", apiKey: HEVY_KEY, extra: "x" } as unknown as ConnectorCredential, binding)).toThrow("invalid_request");
    expect(() => sealConnectorCredential(config, hevy(" padded "), binding)).toThrow("invalid_request");
  });

  it("namespaces account digests by provider and never accepts empty identity", () => {
    expect(connectorAccountDigest("hevy", ["same"])).not.toBe(connectorAccountDigest("icloud_calendar", ["same"]));
    expect(connectorAccountDigest("outlook_calendar", ["tid", "sub"])).not.toBe(connectorAccountDigest("outlook_calendar", ["tidsub"]));
    expect(connectorAccountDigest("hevy", ["42"])).toMatch(/^[a-f0-9]{64}$/);
    expect(() => connectorAccountDigest("hevy", [""])).toThrow("malformed_provider_response");
    expect(() => connectorAccountDigest("hevy", [])).toThrow("malformed_provider_response");
  });

  it("keeps Google ciphertext format and associated data unchanged and separate", () => {
    const google = readCalendarOAuthConfig({ GOOGLE_CALENDAR_CLIENT_ID: "id", GOOGLE_CALENDAR_CLIENT_SECRET: "secret",
      GOOGLE_CALENDAR_CALLBACK_URL: "https://cadence.example/auth/google-calendar/callback", GOOGLE_CALENDAR_ENCRYPTION_KEY: KEY, GOOGLE_CALENDAR_KEY_ID: "c1" })!;
    const binding = { purpose: "refresh" as const, userId: OWNER, googleSubject: "subject", generation: 1 };
    const sealed = sealCalendarSecret(google, "synthetic-refresh", binding);
    const [, iv, tag, body] = sealed.split(".");
    const decipher = createDecipheriv("aes-256-gcm", google.key, Buffer.from(iv!, "base64url"));
    decipher.setAAD(Buffer.from(JSON.stringify(["cadence-calendar-v1", "refresh", OWNER, "subject", 1, null])));
    decipher.setAuthTag(Buffer.from(tag!, "base64url"));
    expect(Buffer.concat([decipher.update(Buffer.from(body!, "base64url")), decipher.final()]).toString()).toBe("synthetic-refresh");
    expect(openCalendarSecret(google, sealed, binding)).toBe("synthetic-refresh");
    // Even with the same key bytes, neither format opens the other's ciphertext.
    const connector = readConnectorCredentialConfig()!;
    const connectorBinding: ConnectorSecretBinding = { purpose: "credential", userId: OWNER, provider: "outlook_calendar", accountDigest: "a".repeat(64), generation: 1 };
    expect(() => openConnectorCredential(connector, sealed, connectorBinding)).toThrow("reconnect_required");
    const connectorSealed = sealConnectorCredential(connector, { provider: "outlook_calendar", refreshToken: "synthetic-refresh" }, connectorBinding);
    expect(() => openCalendarSecret(google, connectorSealed, binding)).toThrow("reconnect_required");
  });
});

describe("direct-intake lifecycle (Hevy and iCloud)", () => {
  it("connects with owner metadata and never returns the credential or identity", async () => {
    const view = await connectDirectCredential(caller(OWNER), hevy(), async () => ["hevy-user-42"]);
    expect(view).toMatchObject({ accountId: OWNER, provider: "hevy", status: "connected", generation: 1 });
    const serialized = JSON.stringify([view, await getConnectorConnections(caller(OWNER))]);
    expect(serialized).not.toContain(HEVY_KEY);
    expect(serialized).not.toContain(connectorAccountDigest("hevy", ["hevy-user-42"]));
    expect(serialized).not.toContain("hevy-user-42");
    const install = db.rpcCalls.find((call) => call.name === "connector_install_credential")!;
    expect(install.args).toMatchObject({ owner_id: OWNER, provider_key: "hevy", expected_generation: 0, expected_state_hash: null });
    expect(JSON.stringify(install.args)).not.toContain(HEVY_KEY);
  });

  it("reads credentials only for the authenticated owner and provider", async () => {
    await connectDirectCredential(caller(OWNER), hevy(), async () => ["42"]);
    const run = vi.fn(async (credential: ConnectorCredential) => credential.provider);
    await expect(withConnectorCredential(caller(OWNER), "hevy", run)).resolves.toBe("hevy");
    expect(run.mock.calls[0]![0]).toEqual(hevy());
    await expect(withConnectorCredential(caller(OTHER), "hevy", run)).rejects.toThrow("not_connected");
    await expect(withConnectorCredential(caller(OWNER), "icloud_calendar", run)).rejects.toThrow("not_connected");
    expect(run).toHaveBeenCalledOnce();
  });

  it("does not let a service-role read cross owners even with a valid generation and identity", async () => {
    await connectDirectCredential(caller(OWNER), hevy(), async () => ["42"]);
    const forged: ConnectorConnection = { userId: OTHER, provider: "hevy", accountDigest: connectorAccountDigest("hevy", ["42"]), generation: 1,
      status: "connected", selectionRevision: 0, preferences: { selectedSourceIds: [], hiddenSourceIds: [], visible: true, showAllDay: true } };
    await expect(readConnectorCredential(forged)).rejects.toThrow("reconnect_required");
    // A copied ciphertext still fails to open under another owner's binding.
    const sealed = db.credentials.get(`${OWNER}/hevy`)!.sealed_credential;
    expect(() => openConnectorCredential(readConnectorCredentialConfig()!, sealed, { purpose: "credential", userId: OTHER, provider: "hevy",
      accountDigest: forged.accountDigest, generation: 1 })).toThrow("reconnect_required");
  });

  it("lets only one concurrent or replayed intake win a generation", async () => {
    const gate = deferred<readonly string[]>();
    const first = connectDirectCredential(caller(OWNER), hevy(), () => gate.promise);
    const second = connectDirectCredential(caller(OWNER), hevy("synthetic-hevy-key-0002"), () => gate.promise);
    await Promise.resolve();
    gate.resolve(["42"]);
    const results = await Promise.allSettled([first, second]);
    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({ reason: { code: "connection_changed" } });
    expect(db.connections.get(`${OWNER}/hevy`)!.generation).toBe(1);
  });

  it("requires disconnect before another provider account, and isolates providers", async () => {
    await connectDirectCredential(caller(OWNER), hevy(), async () => ["42"]);
    await connectDirectCredential(caller(OWNER), icloud(), async () => ["/123/principal/"]);
    await expect(connectDirectCredential(caller(OWNER), hevy(), async () => ["99"])).rejects.toMatchObject({ code: "wrong_account" });
    const disconnected = await disconnectConnector(caller(OWNER), "hevy");
    expect(disconnected).toMatchObject({ status: "disconnected", generation: 2, revocation: "hevy_api_key" });
    expect(db.credentials.has(`${OWNER}/hevy`)).toBe(false);
    await expect(withConnectorCredential(caller(OWNER), "icloud_calendar", async (credential) => credential)).resolves.toEqual(icloud());
    await expect(connectDirectCredential(caller(OWNER), hevy(), async () => ["99"])).resolves.toMatchObject({ status: "connected", generation: 3 });
    expect((await disconnectConnector(caller(OWNER), "icloud_calendar")).revocation).toBe("apple_app_specific_password");
    expect((await disconnectConnector(caller(OWNER), "outlook_calendar")).revocation).toBe("microsoft_account_permissions");
  });

  it("fences a provider response when disconnect or reconnect lands mid-read", async () => {
    await connectDirectCredential(caller(OWNER), hevy(), async () => ["42"]);
    await expect(withConnectorCredential(caller(OWNER), "hevy", async () => { await disconnectConnector(caller(OWNER), "hevy"); return "stale"; }))
      .rejects.toThrow("not_connected");
    await connectDirectCredential(caller(OWNER), hevy(), async () => ["42"]);
    await expect(withConnectorCredential(caller(OWNER), "hevy", async () => {
      await disconnectConnector(caller(OWNER), "hevy");
      await connectDirectCredential(caller(OWNER), hevy(), async () => ["42"]);
      return "stale";
    })).rejects.toThrow("connection_changed");
    expect(db.connections.get(`${OWNER}/hevy`)).toMatchObject({ status: "connected", generation: 5 });
  });

  it("marks only the affected provider reconnect_required when its key is retired", async () => {
    await connectDirectCredential(caller(OWNER), hevy(), async () => ["42"]);
    await connectDirectCredential(caller(OWNER), icloud(), async () => ["/p/"]);
    vi.stubEnv("CONNECTOR_CREDENTIAL_KEY_ID", "c2");
    await expect(withConnectorCredential(caller(OWNER), "hevy", async () => "never")).rejects.toThrow("reconnect_required");
    expect(db.connections.get(`${OWNER}/hevy`)).toMatchObject({ status: "reconnect_required", generation: 2 });
    expect(db.connections.get(`${OWNER}/icloud_calendar`)).toMatchObject({ status: "connected", generation: 1 });
    expect(db.credentials.has(`${OWNER}/hevy`)).toBe(false);
  });

  it("does not demote a connection on a transient database failure", async () => {
    await connectDirectCredential(caller(OWNER), hevy(), async () => ["42"]);
    db.rpcFailure = { message: `boom ${HEVY_KEY}` };
    const failure = await withConnectorCredential(caller(OWNER), "hevy", async () => "never").catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: "provider_unavailable", message: "provider_unavailable" });
    expect(String((failure as Error).stack)).not.toContain(HEVY_KEY);
    db.rpcFailure = null;
    expect(db.connections.get(`${OWNER}/hevy`)!.status).toBe("connected");
  });

  it("reports not_configured without keys and never seals with a missing key", async () => {
    vi.stubEnv("CONNECTOR_CREDENTIAL_ENCRYPTION_KEY", "");
    expect((await getConnectorConnections(caller(OWNER))).map((view) => view.status)).toEqual(["not_configured", "not_configured", "not_configured"]);
    const verify = vi.fn();
    await expect(connectDirectCredential(caller(OWNER), hevy(), verify)).rejects.toThrow("not_configured");
    expect(verify).not.toHaveBeenCalled();
    expect(db.rpcCalls).toHaveLength(0);
  });
});

describe("Outlook attempt and refresh lifecycle", () => {
  const state = "s".repeat(43);
  const outlook = (refreshToken: string): ConnectorCredential => ({ provider: "outlook_calendar", refreshToken });

  it("consumes an attempt once and refuses late or replayed completion", async () => {
    await beginConnectorOAuthAttempt(caller(OWNER), { provider: "outlook_calendar", state, verifier: "v".repeat(43), target: "web", clientState: "" });
    expect(JSON.stringify(db.rpcCalls)).not.toContain("v".repeat(43));
    const consumed = await consumeConnectorOAuthAttempt("outlook_calendar", state);
    expect(consumed?.verifier).toBe("v".repeat(43));
    expect(await consumeConnectorOAuthAttempt("outlook_calendar", state)).toBeNull();
    await completeConnectorOAuthAttempt(consumed!.attempt, ["tenant", "subject"], outlook("synthetic-refresh-1"));
    expect(await getConnectorConnection(caller(OWNER), "outlook_calendar")).toMatchObject({ status: "connected", generation: 1 });
    await expect(completeConnectorOAuthAttempt(consumed!.attempt, ["tenant", "subject"], outlook("late"))).rejects.toThrow("connection_changed");
    await expect(beginConnectorOAuthAttempt(caller(OWNER), { provider: "outlook_calendar", state, verifier: "v".repeat(43), target: "desktop", clientState: "short" }))
      .rejects.toThrow("invalid_request");
  });

  it("cancels a pending attempt on disconnect, even before first connection", async () => {
    await beginConnectorOAuthAttempt(caller(OWNER), { provider: "outlook_calendar", state, verifier: "v".repeat(43), target: "web", clientState: "" });
    await disconnectConnector(caller(OWNER), "outlook_calendar");
    expect(await consumeConnectorOAuthAttempt("outlook_calendar", state)).toBeNull();
  });

  it("rejects a callback for a different Microsoft account until disconnect", async () => {
    for (const subject of ["subject", "other-subject"]) {
      await beginConnectorOAuthAttempt(caller(OWNER), { provider: "outlook_calendar", state: subject.padEnd(43, "x"), verifier: "v".repeat(43), target: "web", clientState: "" });
      const consumed = await consumeConnectorOAuthAttempt("outlook_calendar", subject.padEnd(43, "x"));
      const completion = completeConnectorOAuthAttempt(consumed!.attempt, ["tenant", subject], outlook("synthetic-refresh"));
      if (subject === "subject") await completion; else await expect(completion).rejects.toThrow("wrong_account");
    }
  });

  it("rotates refresh credentials only inside the live generation", async () => {
    await beginConnectorOAuthAttempt(caller(OWNER), { provider: "outlook_calendar", state, verifier: "v".repeat(43), target: "web", clientState: "" });
    const consumed = await consumeConnectorOAuthAttempt("outlook_calendar", state);
    await completeConnectorOAuthAttempt(consumed!.attempt, ["tenant", "subject"], outlook("synthetic-refresh-1"));
    await withConnectorCredential(caller(OWNER), "outlook_calendar", async (_credential, connection) => {
      await rotateConnectorCredential(connection, outlook("synthetic-refresh-2"));
    });
    await expect(withConnectorCredential(caller(OWNER), "outlook_calendar", async (credential) => credential)).resolves.toEqual(outlook("synthetic-refresh-2"));
    // A refresh racing a disconnect cannot resurrect the revoked generation.
    await expect(withConnectorCredential(caller(OWNER), "outlook_calendar", async (_credential, connection) => {
      await disconnectConnector(caller(OWNER), "outlook_calendar");
      await rotateConnectorCredential(connection, outlook("synthetic-refresh-3"));
    })).rejects.toThrow("connection_changed");
    expect(db.credentials.has(`${OWNER}/outlook_calendar`)).toBe(false);
    expect(db.connections.get(`${OWNER}/outlook_calendar`)).toMatchObject({ status: "disconnected", account_digest: null });
  });
});

describe("connector request boundary", () => {
  it("returns only a stable code and never echoes thrown details", async () => {
    const request = new Request("https://cadence.example/api/hevy/connection", { method: "GET", headers: { authorization: "Bearer synthetic" } });
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.example"); vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable");
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ id: OWNER, aud: "authenticated" }));
    const response = await runConnectorRequest(request, async () => { throw new Error(`database said ${HEVY_KEY}`); });
    expect(fetcher).toHaveBeenCalled();
    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe(JSON.stringify({ error: "provider_unavailable" }));
    const typed = await runConnectorRequest(request, async () => { throw new ConnectorError("wrong_account"); });
    expect(await typed.json()).toEqual({ error: "wrong_account" });
    fetcher.mockRestore();
  });

  it("rejects cross-origin credential writes before authentication", async () => {
    const request = new NextRequest("https://cadence.example/api/hevy/connection", { method: "POST", headers: { origin: "https://attacker.invalid" },
      body: JSON.stringify({ apiKey: HEVY_KEY }) });
    const run = vi.fn();
    const response = await runConnectorRequest(request, run);
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain(HEVY_KEY);
    expect(run).not.toHaveBeenCalled();
  });

  it("caps credential bodies at 8 KB", async () => {
    const small = new Request("https://cadence.example/x", { method: "POST", body: JSON.stringify({ apiKey: HEVY_KEY }) });
    await expect(readConnectorCredentialBody(small)).resolves.toEqual({ apiKey: HEVY_KEY });
    const large = new Request("https://cadence.example/x", { method: "POST", body: JSON.stringify({ apiKey: "x".repeat(9000) }) });
    await expect(readConnectorCredentialBody(large)).rejects.toMatchObject({ code: "invalid_request" });
  });
});

describe("connector data stays out of tracking surfaces", () => {
  const roots = ["lib", "app", "components", "apps/desktop/src", "apps/desktop/src-tauri/src", "packages", "supabase/migrations"];
  // Ticket 239's Daily Brief fence reads only connection status, generation, and selection revision.
  const disclosureFence = "supabase/migrations/20261019041000_daily_brief_connector_disclosure.sql";
  const allowed = new Set(["lib/db/connectors.repo.ts", "lib/db/database.types.ts", "supabase/migrations/20261019040000_connector_lifecycle.sql", disclosureFence]);
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (name === "node_modules" || name === "target" || name === "dist") return [];
      return statSync(path).isDirectory() ? files(path) : [path];
    });
  }
  it("exposes connector tables and RPCs only to the connector repository", () => {
    const offenders = roots.flatMap(files).filter((path) => /\.(ts|tsx|mjs|rs|sql)$/.test(path) && !allowed.has(path))
      .filter((path) => /connector_(connections|preferences|credentials|attempts)|connector_(begin|consume|install|read|replace)_|connector_disconnect/.test(readFileSync(path, "utf8")));
    expect(offenders).toEqual([]);
    const fence = readFileSync(disclosureFence, "utf8");
    expect(fence).not.toMatch(/connector_(credentials|attempts)|sealed_|account_digest\s*[,=)]|connector_(begin|consume|install|read|replace)_|connector_disconnect/);
  });
  it("does not log from connector lifecycle modules", () => {
    for (const path of ["lib/services/connector-credentials.ts", "lib/services/connector-request.ts", "lib/db/connectors.repo.ts", "lib/types/connectors.ts"]) {
      expect(readFileSync(path, "utf8")).not.toMatch(/console\.|logger|captureException/);
    }
  });
  it("uses AES-256-GCM with a fresh 96-bit IV per seal", () => {
    const config = readConnectorCredentialConfig()!;
    const binding: ConnectorSecretBinding = { purpose: "credential", userId: OWNER, provider: "hevy", accountDigest: "a".repeat(64), generation: 1 };
    const [first, second] = [sealConnectorCredential(config, hevy(), binding), sealConnectorCredential(config, hevy(), binding)];
    expect(first).not.toBe(second);
    expect(Buffer.from(first.split(".")[1]!, "base64url")).toHaveLength(12);
    expect(() => createCipheriv("aes-256-gcm", config.key, Buffer.alloc(12))).not.toThrow();
  });
});
