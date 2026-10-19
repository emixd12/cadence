import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc }) }));
vi.mock("@/lib/supabase/env", () => ({ getSupabaseServiceRoleConfig: () => ({ url: "https://db.example", serviceRoleKey: "fixture" }) }));
vi.mock("@/lib/services/oauth/clients", async (original) => ({ ...await original<typeof import("@/lib/services/oauth/clients")>(), fetchClientMetadata: vi.fn() }));
import { GET as discovery } from "@/app/.well-known/oauth-authorization-server/route";
import { GET as resource } from "@/app/.well-known/oauth-protected-resource/route";
import { GET as resourceMcp } from "@/app/.well-known/oauth-protected-resource/mcp/route";
import { GET as authorize } from "@/app/oauth/authorize/route";
import { POST as token, OPTIONS } from "@/app/oauth/token/route";
import { POST as register } from "@/app/oauth/register/route";
import { POST as revoke } from "@/app/oauth/revoke/route";
import { completeOAuthConsent, getOAuthConsent } from "@/lib/services/oauth/consent";
import { verifyMcpAccessToken } from "@/lib/services/oauth/server";
import { hashToken } from "@/lib/services/oauth/protocol";
import { fetchClientMetadata } from "@/lib/services/oauth/clients";

const issuer = "https://app.cadence-me.com";
const client = { client_id: "fixture-client", registration_type: "dcr", client_name: "Fixture", application_type: "native", redirect_uris: ["http://localhost/callback"], metadata_stale: false };
const requestId = "00000000-0000-4000-8000-000000000226";
const fixture = (overrides: Record<string, string> = {}) => ({ response_type: "code", client_id: "fixture-client", redirect_uri: "http://localhost:1234/callback", resource: `${issuer}/mcp`, code_challenge: "c".repeat(43), code_challenge_method: "S256", scope: "cadence.read offline_access", state: "fixture-state", ...overrides });
const authRequest = (overrides = {}) => new Request(`${issuer}/oauth/authorize?${new URLSearchParams(fixture(overrides))}`);
const formRequest = (endpoint: string, body: Record<string, string>) => new Request(`${issuer}/oauth/${endpoint}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) });
const exchange = (overrides = {}) => formRequest("token", { grant_type: "authorization_code", code: "code", code_verifier: "v".repeat(43), client_id: "fixture-client", redirect_uri: "http://localhost:1234/callback", resource: `${issuer}/mcp`, ...overrides });
const refresh = (overrides = {}) => formRequest("token", { grant_type: "refresh_token", refresh_token: "refresh", client_id: "fixture-client", resource: `${issuer}/mcp`, ...overrides });
const issue = { ok: true, grant_id: "grant", user_id: "user", client_id: "fixture-client", resource: `${issuer}/mcp`, scopes: ["cadence.read"], offline_access: true, access_token_expires_at: new Date(Date.now() + 3600_000).toISOString(), refresh_token_expires_at: new Date(Date.now() + 30 * 86400_000).toISOString() };
let overrides: Record<string, unknown>;

beforeEach(() => {
  vi.stubEnv("CADENCE_MCP_ENABLED", "true"); vi.stubEnv("CADENCE_OAUTH_ISSUER", issuer);
  overrides = {};
  rpc.mockReset().mockImplementation(async (name: string, input: Record<string, unknown>) => ({ data: Object.hasOwn(overrides, name) ? overrides[name] : ({
    oauth_consume_rate_limit: { allowed: true, limit_count: 60, remaining: 59, reset_at: new Date().toISOString(), retry_after_seconds: 60 },
    oauth_get_client: client, oauth_create_pending: requestId,
    oauth_register_client: { ...client, client_id: input.p_client_id, application_type: input.p_application_type, redirect_uris: input.p_redirect_uris },
    oauth_exchange_authorization_code: issue, oauth_rotate_refresh_token: issue, oauth_revoke_token: true,
  } as Record<string, unknown>)[name], error: null }));
});

describe("OAuth HTTP routes", () => {
  it("advertises interoperable discovery with no offline scope on the resource", async () => {
    const body = await discovery().json();
    expect(body).toMatchObject({ issuer, code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"], response_types_supported: ["code"], authorization_response_iss_parameter_supported: true, client_id_metadata_document_supported: true });
    expect(body.scopes_supported).toContain("offline_access");
    for (const response of [resource(), resourceMcp()]) {
      expect(await response.json()).toMatchObject({ resource: `${issuer}/mcp`, authorization_servers: [issuer], scopes_supported: ["cadence.read", "cadence.occurrences.write", "cadence.behaviors.write"] });
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      expect(response.headers.has("access-control-allow-credentials")).toBe(false);
    }
    expect(OPTIONS().status).toBe(204);
  });
  it("disables every endpoint before touching the database", async () => {
    vi.stubEnv("CADENCE_MCP_ENABLED", "false");
    for (const response of [discovery(), resource(), resourceMcp(), OPTIONS(), await authorize(authRequest()), await token(exchange()), await register(new Request(`${issuer}/oauth/register`, { method: "POST" })), await revoke(formRequest("revoke", {}))]) expect(response.status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("stores a browser-bound request and redirects only its ID to consent", async () => {
    const response = await authorize(authRequest());
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`${issuer}/oauth/consent?request=${requestId}`);
    expect(response.headers.get("set-cookie")).toMatch(/HttpOnly; SameSite=Lax; Max-Age=600; Secure/);
    const call = rpc.mock.calls.find(([name]) => name === "oauth_create_pending")![1];
    expect(call).toMatchObject({ p_client_id: "fixture-client", p_offline_access: true, p_scopes: ["cadence.read"], p_state: "fixture-state" });
    expect(call.p_browser_hash).toMatch(/^[a-f0-9]{64}$/);
  });
  it.each([
    [{ code_challenge_method: "plain" }, "invalid_request"], [{ code_challenge: "short" }, "invalid_request"],
    [{ response_type: "token" }, "unsupported_response_type"], [{ response_mode: "fragment" }, "invalid_request"],
    [{ resource: `${issuer}/wrong` }, "invalid_target"], [{ scope: "cadence.read unknown" }, "invalid_scope"],
    [{ scope: "cadence.behaviors.write" }, "invalid_scope"], [{ state: "x".repeat(1025) }, "invalid_request"],
  ])("returns safe authorization errors with iss: %j", async (input, error) => {
    const response = await authorize(authRequest(input));
    const url = new URL(response.headers.get("location")!);
    expect(url.searchParams.get("iss")).toBe(issuer); expect(url.searchParams.get("error")).toBe(error);
    expect(rpc.mock.calls.some(([name]) => name === "oauth_create_pending")).toBe(false);
  });
  it("never redirects to a mismatched redirect URI or an unknown client", async () => {
    for (const request of [authRequest({ redirect_uri: "https://evil.example/callback" }), new Request(`${authRequest().url}&client_id=other`)]) {
      const response = await authorize(request); expect(response.status).toBe(400); expect(response.headers.has("location")).toBe(false); expect(await response.json()).toMatchObject({ iss: issuer });
    }
    overrides.oauth_get_client = null;
    expect((await authorize(authRequest())).status).toBe(400);
  });
  it("refreshes stale CIMD metadata before accepting its redirect", async () => {
    overrides.oauth_get_client = { ...client, metadata_stale: true };
    vi.mocked(fetchClientMetadata).mockResolvedValue({ clientId: "https://client.example/metadata", registrationType: "cimd", clientName: "Fixture", redirectUris: client.redirect_uris, applicationType: "native", clientUri: null, logoUri: null, metadata: {}, metadataExpiresAt: new Date(Date.now() + 60_000).toISOString(), verifiedClient: null });
    expect((await authorize(authRequest({ client_id: "https://client.example/metadata" }))).status).toBe(302);
    expect(fetchClientMetadata).toHaveBeenCalledWith("https://client.example/metadata");
  });
  it("returns opaque tokens and granted scopes; sends hashes to persistence", async () => {
    const response = await token(exchange()); const body = await response.json();
    expect(body).toMatchObject({ token_type: "Bearer", scope: "cadence.read offline_access" });
    expect(body.access_token).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(body.refresh_token).not.toBe(body.access_token);
    expect(body.expires_in).toBeGreaterThan(3500);
    expect(rpc).toHaveBeenCalledWith("oauth_exchange_authorization_code", expect.objectContaining({ p_code_hash: hashToken("code"), p_access_token_hash: hashToken(body.access_token) }));
  });
  it.each(["pkce mismatch", "expired code", "reused code", "wrong redirect", "revoked grant"])("maps %s to invalid_grant", async () => {
    overrides.oauth_exchange_authorization_code = { ok: false, error: "invalid_grant" };
    expect(await (await token(exchange())).json()).toEqual({ error: "invalid_grant" });
  });
  it("rejects wrong resource, bad PKCE, unsupported grant, duplicate fields and JSON bodies", async () => {
    expect(await (await token(exchange({ resource: "https://wrong.example/mcp" }))).json()).toEqual({ error: "invalid_grant" });
    expect(await (await token(exchange({ code_verifier: "bad" }))).json()).toEqual({ error: "invalid_grant" });
    expect(await (await token(exchange({ grant_type: "password" }))).json()).toEqual({ error: "unsupported_grant_type" });
    const duplicate = new Request(`${issuer}/oauth/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "client_id=a&client_id=b" });
    expect((await token(duplicate)).status).toBe(400);
    expect((await token(new Request(`${issuer}/oauth/token`, { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } }))).status).toBe(415);
  });
  it("rotates refresh tokens, returns invalid_grant for bad/reused refresh, and preserves narrowed scope", async () => {
    expect((await token(refresh())).status).toBe(200);
    overrides.oauth_rotate_refresh_token = { ...issue, scopes: ["cadence.read"] };
    expect((await token(refresh({ scope: "cadence.read" }))).status).toBe(200);
    expect(rpc).toHaveBeenLastCalledWith("oauth_rotate_refresh_token", expect.objectContaining({ p_scopes: ["cadence.read"], p_refresh_token_hash: hashToken("refresh") }));
    overrides.oauth_rotate_refresh_token = { ok: false, error: "invalid_grant", reuse_detected: true };
    expect(await (await token(refresh())).json()).toEqual({ error: "invalid_grant" });
  });
  it("returns the database-capped refresh lifetime and rejects an expired family", async () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      overrides.oauth_rotate_refresh_token = { ...issue, access_token_expires_at: new Date(now + 30 * 60_000).toISOString() };
      expect(await (await token(refresh())).json()).toMatchObject({ expires_in: 1800 });
      overrides.oauth_rotate_refresh_token = { ok: false, error: "invalid_grant" };
      const rejected = await token(refresh());
      expect(rejected.status).toBe(400);
      expect(await rejected.json()).toEqual({ error: "invalid_grant" });
    } finally { vi.restoreAllMocks(); }
  });
  it("requires the canonical resource on refresh under the MCP authorization profile", async () => {
    const request = refresh();
    const body = new URLSearchParams(await request.text());
    body.delete("resource");
    expect(await (await token(formRequest("token", Object.fromEntries(body)))).json()).toEqual({ error: "invalid_request" });
    expect(await (await token(refresh({ resource: "https://wrong.example/mcp" }))).json()).toEqual({ error: "invalid_grant" });
    expect(rpc.mock.calls.some(([name]) => name === "oauth_rotate_refresh_token")).toBe(false);
  });
  it("registers public native clients and rejects unsupported client metadata", async () => {
    const send = (body: unknown) => register(new Request(`${issuer}/oauth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
    const response = await send({ client_name: "Native", application_type: "native", redirect_uris: ["http://localhost/callback"] });
    expect(response.status).toBe(201); expect(await response.json()).toMatchObject({ application_type: "native", token_endpoint_auth_method: "none" });
    expect((await send({ redirect_uris: ["http://localhost/callback"] })).status).toBe(400);
    expect((await send({ redirect_uris: ["https://client.example/callback"], token_endpoint_auth_method: "client_secret_basic" })).status).toBe(400);
  });
  it("enforces registration and protocol limits before mutations", async () => {
    overrides.oauth_consume_rate_limit = { allowed: false, limit_count: 10, remaining: 0, reset_at: new Date().toISOString(), retry_after_seconds: 60 };
    const response = await register(new Request(`${issuer}/oauth/register`, { method: "POST" }));
    expect(response.status).toBe(429); expect(response.headers.get("retry-after")).toBe("60");
    expect(rpc.mock.calls.some(([name]) => name === "oauth_register_client")).toBe(false);
  });
  it("revoke never reveals whether a token existed", async () => {
    for (const found of [true, false]) {
      overrides.oauth_revoke_token = found;
      const response = await revoke(formRequest("revoke", { client_id: "fixture-client", token: "secret" }));
      expect(response.status).toBe(200); expect(await response.text()).toBe("");
    }
  });
  it("sanitizes database exceptions", async () => {
    rpc.mockRejectedValue(new Error("fixture-secret"));
    const response = await token(exchange()); expect(response.status).toBe(503); expect(await response.text()).not.toContain("fixture-secret");
  });
});

describe("MCP token verification", () => {
  it("rejects expired families and uses the effective database expiry at the exact boundary", async () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      overrides.oauth_verify_access_token = { active: false };
      expect(await verifyMcpAccessToken("a".repeat(43))).toBeNull();
      for (const offset of [-1, 0, 1]) {
        overrides.oauth_verify_access_token = { active: true, user_id: "user", grant_id: "grant", client_id: "client", client_name: "Fixture", scopes: ["cadence.read"], resource: `${issuer}/mcp`, expires_at: new Date(now + offset).toISOString() };
        expect((await verifyMcpAccessToken("a".repeat(43))) !== null).toBe(offset > 0);
      }
    } finally { vi.restoreAllMocks(); }
  });
  it("checks expiry, resource, scopes and labels unknown clients unverified", async () => {
    overrides.oauth_verify_access_token = { active: true, user_id: "user", grant_id: "grant", client_id: "client", client_name: "Fixture", scopes: ["cadence.read"], resource: `${issuer}/mcp`, expires_at: issue.access_token_expires_at };
    expect(await verifyMcpAccessToken("a".repeat(43))).toMatchObject({ userId: "user", clientLabel: "Fixture (unverified)", channel: "mcp" });
    await expect(verifyMcpAccessToken("a".repeat(43), ["cadence.behaviors.write"])).rejects.toMatchObject({ code: "insufficient_scope" });
    overrides.oauth_verify_access_token = null;
    expect(await verifyMcpAccessToken("a".repeat(43))).toBeNull();
    expect(await verifyMcpAccessToken("invalid")).toBeNull();
  });
});

describe("consent handoff", () => {
  const request = (method = "POST", origin = issuer, cookie = true) => new Request(`${issuer}/oauth/consent`, { method, headers: { Origin: origin, ...(cookie ? { Cookie: `cadence_oauth_${requestId}=${"a".repeat(43)}` } : {}) } });
  beforeEach(() => {
    overrides.oauth_read_pending = { id: requestId, client_id: "client", client_name: "Fixture", scopes: ["cadence.read"], redirect_uri: "http://localhost/callback", resource: `${issuer}/mcp`, state: "state", expires_at: new Date(Date.now() + 600_000).toISOString() };
    overrides.oauth_finish_pending = { approved: true, redirect_uri: "http://localhost/callback", state: "state" };
  });
  it("requires browser binding and same-origin POST", async () => {
    await expect(getOAuthConsent(request("GET", issuer, false), requestId, { rpc } as never)).rejects.toThrow();
    await expect(completeOAuthConsent(request("POST", "https://evil.example"), requestId, ["cadence.read"], { rpc } as never)).rejects.toMatchObject({ status: 403 });
  });
  it("rejects consent when refreshed client metadata removes the redirect", async () => {
    overrides.oauth_get_client = { ...client, redirect_uris: ["https://client.example/new-callback"] };
    await expect(completeOAuthConsent(request(), requestId, ["cadence.read"], { rpc } as never)).rejects.toMatchObject({ code: "invalid_request" });
    expect(rpc.mock.calls.some(([name]) => name === "oauth_finish_pending")).toBe(false);
  });
  it("returns code or denial with issuer and state; clears the browser secret", async () => {
    const response = await completeOAuthConsent(request(), requestId, ["cadence.read"], { rpc } as never);
    const redirect = new URL(response.headers.get("location")!);
    expect(redirect.searchParams.get("code")).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(redirect.searchParams.get("iss")).toBe(issuer); expect(redirect.searchParams.get("state")).toBe("state");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    overrides.oauth_finish_pending = { approved: false, redirect_uri: "http://localhost/callback", state: "state" };
    expect(new URL((await completeOAuthConsent(request(), requestId, null, { rpc } as never)).headers.get("location")!).searchParams.get("error")).toBe("access_denied");
    overrides.oauth_finish_pending = null;
    await expect(completeOAuthConsent(request(), requestId, null, { rpc } as never)).rejects.toThrow();
  });
});
