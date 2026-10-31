import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Registers Claude web's exact client-ID metadata document through the real
// authorize path and database (oauth_register_client and the clients check) on
// an isolated loopback stack. Only the network fetch of the document is stubbed.
const api = process.env.CADENCE_LOCAL_SUPABASE_URL;
const serviceKey = process.env.CADENCE_LOCAL_SUPABASE_SERVICE_KEY;
const dbPort = process.env.CADENCE_LOCAL_SUPABASE_DB_PORT;
const enabled = Boolean(api && serviceKey && dbPort && /^http:\/\/127\.0\.0\.1:\d+$/.test(api));
const issuer = "http://127.0.0.1:4321";
const claudeWebId = "https://claude.ai/oauth/mcp-oauth-client-metadata";
const lookalikeId = "https://claude-lookalike.example/oauth/mcp-oauth-client-metadata";
const callback = "https://claude.ai/api/mcp/auth_callback";
const documents: Record<string, unknown> = {
  // Claude web's live document, read October 31, 2026.
  [claudeWebId]: { client_id: claudeWebId, client_name: "Claude", redirect_uris: [callback],
    grant_types: ["authorization_code", "refresh_token", "urn:ietf:params:oauth:grant-type:jwt-bearer"],
    response_types: ["code"], token_endpoint_auth_method: "none" },
  [lookalikeId]: { client_id: lookalikeId, client_name: "Claude", redirect_uris: [callback],
    grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" },
};

vi.mock("@/lib/services/oauth/clients", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services/oauth/clients")>();
  return { ...actual, fetchClientMetadata: (clientId: string) => actual.fetchClientMetadata(clientId, async (url) => {
    const doc = documents[url.href];
    if (!doc) throw new Error("Unexpected metadata fetch");
    return { status: 200, cacheControl: "max-age=300", body: JSON.stringify(doc) };
  }) };
});

const sql = (statement: string) => execFileSync("psql", ["-X", "-qAt", "-v", "ON_ERROR_STOP=1"], {
  input: statement, encoding: "utf8",
  env: { ...process.env, PGHOST: "127.0.0.1", PGPORT: dbPort, PGUSER: "postgres", PGPASSWORD: "postgres", PGDATABASE: "postgres" },
  stdio: ["pipe", "pipe", "pipe"],
}).trim();
const cleanup = () => sql(`delete from cadence_oauth_private.pending_authorizations where client_id in ('${claudeWebId}', '${lookalikeId}');
  delete from cadence_oauth_private.clients where client_id in ('${claudeWebId}', '${lookalikeId}');`);
const authorizeUrl = (clientId: string) => `${issuer}/oauth/authorize?${new URLSearchParams({
  response_type: "code", client_id: clientId, redirect_uri: callback, resource: `${issuer}/mcp`,
  code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", code_challenge_method: "S256",
  scope: "cadence.read cadence.occurrences.write cadence.behaviors.write offline_access", state: "fixture-state",
})}`;

(enabled ? describe : describe.skip)("Claude web CIMD registration on isolated Supabase", () => {
  beforeAll(() => {
    vi.stubEnv("CADENCE_MCP_ENABLED", "true");
    vi.stubEnv("CADENCE_OAUTH_ISSUER", issuer);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", api!);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", serviceKey!);
    cleanup();
  });
  afterAll(() => { cleanup(); vi.unstubAllEnvs(); });

  it("registers Claude web's exact document as verified and redirects to consent", async () => {
    const { handleOAuth } = await import("@/lib/services/oauth/server");
    const response = await handleOAuth(new Request(authorizeUrl(claudeWebId)), "authorize");
    expect(response.status, await response.clone().text()).toBe(302);
    expect(response.headers.get("location")).toMatch(new RegExp(`^${issuer}/oauth/consent\\?request=[0-9a-f-]{36}$`));
    expect(sql(`select registration_type || ' ' || coalesce(verified_client, 'none') || ' ' || array_to_string(redirect_uris, ',')
      from cadence_oauth_private.clients where client_id = '${claudeWebId}'`)).toBe(`cimd claude ${callback}`);
  });

  it("registers a lookalike document unverified", async () => {
    const { handleOAuth } = await import("@/lib/services/oauth/server");
    const response = await handleOAuth(new Request(authorizeUrl(lookalikeId)), "authorize");
    expect(response.status).toBe(302);
    expect(sql(`select coalesce(verified_client, 'none') from cadence_oauth_private.clients where client_id = '${lookalikeId}'`)).toBe("none");
  });
});
