import { randomBytes, randomUUID, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { INTEGRATION_OPERATION_NAMES, validateOperationOutput, type IntegrationOperationName, type IntegrationOperationOutput } from "@cadence/core/integration";
import type { Database } from "@/lib/db/database.types";
import { registerOAuthClient, approveOAuthConsent, exchangeAuthorizationCode, revokeOAuthToken } from "@/lib/db/oauth.repo";
import { POST } from "@/app/mcp/route";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const api = process.env.CADENCE_LOCAL_SUPABASE_URL;
const enabled = api && process.env.CADENCE_LOCAL_SUPABASE_SERVICE_KEY && process.env.CADENCE_LOCAL_INTEGRATION_SIGNING_KEY;
const origin = "http://127.0.0.1:4321";
const endpoint = `${origin}/mcp`;
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
const opaque = () => randomBytes(32).toString("base64url");
type Actor = { client: Client; token: string; grantId: string; userId: string };
const sql = (statement: string) => execFileSync("psql", ["-X", "-qAt", "-v", "ON_ERROR_STOP=1"], {
  input: statement, encoding: "utf8", env: { ...process.env, PGHOST: "127.0.0.1", PGPORT: "56922", PGUSER: "postgres", PGPASSWORD: "postgres", PGDATABASE: "postgres" },
  stdio: ["pipe", "pipe", "pipe"],
});
(enabled ? describe : describe.skip).each(["auto", "legacy"] as const)("authenticated MCP route on isolated Supabase (%s)", mode => {
  let admin: ReturnType<typeof createClient<Database>>;
  const users: string[] = [];
  const actors: Actor[] = [];
  const clientId = `mcp228-${randomUUID()}`;
  let a: Actor, b: Actor, readOnly: Actor;
  let behaviorId: string, occurrenceId: string, today: string;
  const called = new Set<string>();
  async function connect(token: string) {
    const client = new Client({ name: "cadence-local-e2e", version: "1" }, { versionNegotiation: { mode } });
    await client.connect(new StreamableHTTPClientTransport(new URL(endpoint), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
      fetch: (input, init) => POST(new Request(input, init)),
    }));
    return client;
  }
  async function call<N extends IntegrationOperationName>(actor: Actor, name: N, args: Record<string, unknown> = {}): Promise<IntegrationOperationOutput<N>> {
    const result = await actor.client.callTool({ name, arguments: args });
    expect(result.isError, `${name}: ${JSON.stringify(result.content)}`).not.toBe(true);
    const checked = validateOperationOutput(name, result.structuredContent);
    expect(checked.ok, name).toBe(true); called.add(name);
    if (!checked.ok) throw new Error(`Invalid ${name} output`);
    return checked.value;
  }
  async function raw(actor: Actor, name: string, args: Record<string, unknown> = {}) {
    return POST(new Request(endpoint, { method: "POST", headers: { Authorization: `Bearer ${actor.token}`,
      "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": "tools/call", "Mcp-Name": name },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args,
      _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} } } }) }));
  }
  beforeAll(async () => {
    if (api !== "http://127.0.0.1:56921") throw new Error("MCP tests require assigned disposable cadence-mcp-228 stack.");
    vi.stubEnv("CADENCE_MCP_ENABLED", "true"); vi.stubEnv("CADENCE_OAUTH_ISSUER", origin);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", api);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", process.env.CADENCE_LOCAL_SUPABASE_PUBLISHABLE_KEY!);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", process.env.CADENCE_LOCAL_SUPABASE_SERVICE_KEY!);
    vi.stubEnv("CADENCE_INTEGRATION_JWT_SIGNING_KEY", process.env.CADENCE_LOCAL_INTEGRATION_SIGNING_KEY!);
    admin = createClient<Database>(api, process.env.CADENCE_LOCAL_SUPABASE_SERVICE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    await registerOAuthClient(admin, { clientId, registrationType: "dcr", clientName: "MCP 228 synthetic", clientUri: null, logoUri: null,
      redirectUris: ["http://localhost/callback"], applicationType: "native", metadata: {}, verifiedClient: null, metadataExpiresAt: null });
    for (let i = 0; i < 3; i++) {
      const email = `mcp228-${randomUUID()}@example.test`, password = opaque();
      const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (created.error || !created.data.user) throw new Error("Cannot create fixture user");
      const userId = created.data.user.id; users.push(userId);
      const user = createClient<Database>(api, process.env.CADENCE_LOCAL_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
      if ((await user.auth.signInWithPassword({ email, password })).error) throw new Error("Cannot sign in fixture user");
      const verifier = opaque(), code = opaque(), token = opaque();
      const consent = await approveOAuthConsent(user, { clientId, redirectUri: "http://localhost/callback", resource: endpoint,
        codeChallenge: createHash("sha256").update(verifier).digest("base64url"), codeHash: hash(code),
        scopes: i === 2 ? ["cadence.read"] : ["cadence.read", "cadence.behaviors.write", "cadence.occurrences.write"] });
      const exchanged = await exchangeAuthorizationCode(admin, { clientId, redirectUri: "http://localhost/callback", resource: endpoint,
        codeHash: hash(code), codeVerifier: verifier, accessTokenHash: hash(token), refreshTokenHash: hash(opaque()) });
      if (!exchanged.ok) throw new Error("Cannot exchange fixture authorization code");
      actors.push({ client: await connect(token), token, grantId: consent.grantId, userId });
    }
    [a, b, readOnly] = actors;
  }, 30_000);
  afterAll(async () => {
    for (const actor of actors) await actor.client.close();
    for (const userId of users) expect((await admin.auth.admin.deleteUser(userId)).error).toBeNull();
    if (admin) sql(`delete from cadence_oauth_private.clients where client_id='${clientId}';`);
    vi.unstubAllEnvs();
  });

  it("calls all sixteen tools through the official SDK and preserves one write activity per attempt", async () => {
    expect((await a.client.listTools()).tools.map(t => t.name)).toEqual(INTEGRATION_OPERATION_NAMES);
    today = (await call(a, "get_account_context")).today_local_date;
    await call(a, "list_categories");
    const input = { title: "MCP synthetic walk", idempotency_key: "mcp228-create", schedules: [{ recurrence: { frequency: "daily", interval: 1 }, time_entries: [{ kind: "exact", start_time: "09:00" }] }] };
    const created = await call(a, "create_behavior", input); behaviorId = created.behavior.id;
    expect(await call(a, "create_behavior", input)).toEqual(created);
    const list = await call(a, "list_behaviors"); expect(list.behaviors).toHaveLength(1);
    await call(a, "get_behavior", { behavior_id: behaviorId });
    await call(a, "get_timeline");
    const occurrences = await call(a, "list_occurrences", { start_local_date: today, end_local_date: today });
    occurrenceId = occurrences.occurrences[0].id;
    await call(a, "get_occurrence", { occurrence_id: occurrenceId });
    await call(a, "set_occurrence_status", { occurrence_id: occurrenceId, status: "completed", expected_status: "unresolved", idempotency_key: "mcp228-status" });
    await call(a, "update_occurrence_note", { occurrence_id: occurrenceId, note: "Synthetic note", idempotency_key: "mcp228-note" });
    await call(a, "get_adherence_summary", { start_local_date: today, end_local_date: today });
    const search = await call(a, "search", { query: "synthetic" }); expect(search.results.length).toBeGreaterThan(0);
    await call(a, "fetch", { id: search.results[0].id });
    await call(a, "update_behavior", { behavior_id: behaviorId, title: "MCP synthetic walk updated", expected_revision: created.behavior.revision, idempotency_key: "mcp228-update" });
    await call(a, "archive_behavior", { behavior_id: behaviorId, idempotency_key: "mcp228-archive" });
    await call(a, "restore_behavior", { behavior_id: behaviorId, idempotency_key: "mcp228-restore" });
    expect([...called].sort()).toEqual([...INTEGRATION_OPERATION_NAMES].sort());
    const count = sql(`select count(*) from cadence_oauth_private.activity where grant_id='${a.grantId}' and operation='create_behavior';`).trim();
    expect(count).toBe("2");
  }, 60_000);

  it("isolates the second user's reads and every target-taking write", async () => {
    const revision = (await call(a, "get_behavior", { behavior_id: behaviorId })).behavior.revision;
    expect((await call(b, "get_account_context")).account_ref).not.toBe((await call(a, "get_account_context")).account_ref);
    expect((await call(b, "list_behaviors")).behaviors).toHaveLength(0);
    const aCategories = (await call(a, "list_categories")).categories.map(row => row.id);
    expect((await call(b, "list_categories")).categories.every(row => !aCategories.includes(row.id))).toBe(true);
    expect((await call(b, "get_timeline")).days.flatMap(day => day.occurrences)).toHaveLength(0);
    expect((await call(b, "list_occurrences", { start_local_date: today, end_local_date: today })).occurrences).toHaveLength(0);
    expect((await call(b, "get_adherence_summary", { start_local_date: today, end_local_date: today })).behaviors).toHaveLength(0);
    expect((await call(b, "search", { query: "synthetic" })).results).toHaveLength(0);
    for (const [name, args] of [
      ["get_behavior", { behavior_id: behaviorId }], ["get_occurrence", { occurrence_id: occurrenceId }], ["fetch", { id: `behavior:${behaviorId}` }],
      ["set_occurrence_status", { occurrence_id: occurrenceId, status: "not_completed" }], ["update_occurrence_note", { occurrence_id: occurrenceId, note: "foreign" }],
      ["update_behavior", { behavior_id: behaviorId, title: "foreign", expected_revision: revision }], ["archive_behavior", { behavior_id: behaviorId }], ["restore_behavior", { behavior_id: behaviorId }],
    ] as const) {
      const response = await raw(b, name, args);
      expect(await response.json(), name).toMatchObject({ result: { isError: true, structuredContent: { error: { code: "not_found" } } } });
    }
    for (const name of ["get_behavior", "archive_behavior"] as const) {
      expect(await b.client.callTool({ name, arguments: { behavior_id: behaviorId } }))
        .toMatchObject({ isError: true, structuredContent: { error: { code: "not_found" } } });
    }
    const own = await call(b, "create_behavior", { title: "Second account", schedules: [{ recurrence: { frequency: "daily", interval: 1 }, time_entries: [{ kind: "exact", start_time: "09:00" }] }] });
    expect((await call(a, "list_behaviors")).behaviors.map(row => row.id)).not.toContain(own.behavior.id);
    expect((await call(a, "get_occurrence", { occurrence_id: occurrenceId })).occurrence).toMatchObject({ status: "completed", note: "Synthetic note" });
  }, 60_000);

  it("rejects missing write scope with HTTP403 and step-up metadata", async () => {
    const response = await raw(readOnly, "archive_behavior", { behavior_id: behaviorId });
    expect(response.status).toBe(403); expect(response.headers.get("www-authenticate")).toContain("cadence.behaviors.write");
    expect(await response.json()).toMatchObject({ result: { isError: true, _meta: { "mcp/www_authenticate": expect.any(Array) }, structuredContent: { error: { code: "insufficient_scope" } } } });
  });

  it("enforces durable read and write rate limits independently", async () => {
    for (const [action, limit, name, args] of [
      ["mcp_read", 120, "list_categories", {}], ["mcp_write", 30, "archive_behavior", { behavior_id: behaviorId }],
    ] as const) {
      sql(`update cadence_oauth_private.rate_limit_counters set attempt_count=${limit},window_started_at=now() where grant_id='${a.grantId}' and action='${action}';`);
      const response = await raw(a, name, args); expect(response.status).toBe(429);
      expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(await response.json()).toMatchObject({ result: { structuredContent: { error: { code: "rate_limited" } } } });
      sql(`delete from cadence_oauth_private.rate_limit_counters where grant_id='${a.grantId}' and action='${action}';`);
    }
  });

  it("rejects oversize write output before mutation and returns an actionable error", async () => {
    sql(`update public.occurrences set note=repeat('x',100000) where id='${occurrenceId}';`);
    const response = await raw(a, "set_occurrence_status", { occurrence_id: occurrenceId, status: "not_completed", idempotency_key: "mcp228-too-large" });
    expect(await response.json()).toMatchObject({ result: { isError: true, structuredContent: { error: { code: "limit_exceeded" } } } });
    expect(sql(`select status from public.occurrences where id='${occurrenceId}';`).trim()).toBe("completed");
    sql(`update public.occurrences set note='Synthetic note' where id='${occurrenceId}';`);
  });

  it("rejects expired, wrong-resource and revoked tokens on the next request", async () => {
    sql(`update cadence_oauth_private.tokens set expires_at=now()-interval '1 second',created_at=now()-interval '2 hours' where token_hash='${hash(readOnly.token)}';`);
    expect((await raw(readOnly, "list_categories")).status).toBe(401);
    sql(`update cadence_oauth_private.tokens set resource='https://other.example/mcp' where token_hash='${hash(b.token)}';`);
    expect((await raw(b, "list_categories")).status).toBe(401);
    await revokeOAuthToken(admin, { clientId, tokenHash: hash(a.token) });
    expect((await raw(a, "list_categories")).status).toBe(401);
  });
});
