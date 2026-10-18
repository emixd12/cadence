import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createIntegrationError, listIntegrationToolDescriptors } from "@cadence/core/integration";
import { POST, GET, OPTIONS } from "@/app/mcp/route";
import { verifyMcpAccessToken } from "@/lib/services/oauth/server";
import { createIntegrationContext } from "@/lib/integrations/request-context";
import { executeMcpOperation } from "@/lib/integrations/operations/execute";
import { mcpTools } from "@/lib/mcp/server";

vi.mock("@/lib/services/oauth/server", () => ({ verifyMcpAccessToken: vi.fn() }));
vi.mock("@/lib/integrations/request-context", () => ({ createIntegrationContext: vi.fn() }));
vi.mock("@/lib/integrations/operations/execute", () => ({ executeMcpOperation: vi.fn() }));
const token = "a".repeat(43);
const url = "http://127.0.0.1:4321/mcp";
const grant = { userId: "user-a", grantId: "grant-a", clientId: "client", clientLabel: "Test", channel: "mcp" as const,
  scopes: ["cadence.read", "cadence.behaviors.write", "cadence.occurrences.write"] as const };
function request(method: string, params = {}, extra: Record<string, string> = {}) {
  return new Request(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json",
    Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": method, ...(method === "tools/call" ? { "Mcp-Name": "list_categories" } : {}), ...extra },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: { ...params,
    _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} } } }) });
}
beforeEach(() => {
  vi.stubEnv("CADENCE_MCP_ENABLED", "true"); vi.stubEnv("CADENCE_OAUTH_ISSUER", "http://127.0.0.1:4321");
  vi.mocked(verifyMcpAccessToken).mockResolvedValue(grant);
  vi.mocked(createIntegrationContext).mockReturnValue({ userId: grant.userId, now: new Date(), tokenExpiresAt: new Date(),
    supabase: {} as ReturnType<typeof createIntegrationContext>["supabase"], actor: { ...grant, grantedScopes: grant.scopes } });
  vi.mocked(executeMcpOperation).mockResolvedValue({ ok: true, value: { categories: [], next_cursor: null } } as Awaited<ReturnType<typeof executeMcpOperation>>);
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("MCP route with official SDK", () => {
  it("discovers the modern server and lists exactly the registry through the SDK client", async () => {
    const client = new Client({ name: "cadence-test", version: "1" }, { versionNegotiation: { mode: { pin: "2026-07-28" } } });
    const transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
      fetch: async (input, init) => POST(new Request(input, init)),
    });
    await client.connect(transport);
    const listed = await client.listTools();
    expect(listed.tools).toEqual(mcpTools().map(tool => { const copy = { ...tool }; delete (copy as Record<string, unknown>).securitySchemes; return copy; }));
    expect(listed.tools.map(tool => tool.name)).toEqual(listIntegrationToolDescriptors().map(tool => tool.name));
    expect(await client.callTool({ name: "list_categories", arguments: {} })).toMatchObject({ structuredContent: { categories: [] } });
    await client.close();
  });
  it("advertises private cache hints and OAuth metadata without an incompatible profile marker", async () => {
    const response = await POST(request("tools/list"));
    expect(response.status).toBe(200);
    const { result } = await response.json();
    expect(result).toMatchObject({ resultType: "complete", ttlMs: 300_000, cacheScope: "private" });
    expect(result.tools.every((tool: { _meta: Record<string, unknown> }) => !("openai/profile" in tool._meta))).toBe(true);
    expect(result.tools.every((tool: { securitySchemes: unknown }) => !!tool.securitySchemes)).toBe(true);
  });
  it("discovers tool-only server capabilities and cross-tool instructions", async () => {
    const response = await POST(request("server/discover"));
    expect(response.status).toBe(200);
    const { result } = await response.json();
    expect(result).toMatchObject({ _meta: { "io.modelcontextprotocol/serverInfo": { name: "cadence" } }, supportedVersions: ["2026-07-28"], capabilities: { tools: {} } });
    expect(result.capabilities.resources).toBeUndefined();
    expect(result.capabilities.prompts).toBeUndefined();
    expect(result.instructions).toContain("idempotency key");
    expect(result.instructions.length).toBeLessThanOrEqual(512);
  });
  it.each(["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05", "2024-10-07"])("negotiates legacy %s without a session", async version => {
    const response = await POST(new Request(url, { method: "POST", headers: { Authorization: `Bearer ${token}`,
      "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: version, capabilities: {}, clientInfo: { name: "legacy", version: "1" } } }) }));
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain(`"protocolVersion":"${version}"`);
    expect(response.headers.has("mcp-session-id")).toBe(false);
  });
  it.each([undefined, "Bearer invalid", `Basic ${token}`])("requires bearer authentication: %s", async authorization => {
    const response = await GET(new Request(url, { headers: authorization ? { authorization } : {} }));
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain('resource_metadata="http://127.0.0.1:4321/.well-known/oauth-protected-resource/mcp"');
    expect(response.headers.get("www-authenticate")).toContain('scope="cadence.read"');
    expect(executeMcpOperation).not.toHaveBeenCalled();
  });
  it("rejects expired, revoked and wrong-resource credentials returned by verification", async () => {
    vi.mocked(verifyMcpAccessToken).mockResolvedValue(null);
    expect((await POST(request("tools/list"))).status).toBe(401);
    expect(createIntegrationContext).not.toHaveBeenCalled();
  });
  it("returns HTTP 403 and ChatGPT step-up metadata for missing scope", async () => {
    vi.mocked(executeMcpOperation).mockResolvedValue({ ok: false, error: createIntegrationError("insufficient_scope", "Reconnect and grant permission.", { requiredScopes: ["cadence.behaviors.write"] }) });
    const response = await POST(request("tools/call", { name: "list_categories", arguments: {} }));
    expect(response.status).toBe(403);
    const { result } = await response.json();
    expect(result.isError).toBe(true);
    expect(result._meta["mcp/www_authenticate"][0]).toContain('scope="cadence.behaviors.write"');
    expect(response.headers.get("www-authenticate")).toContain('error="insufficient_scope"');
  });
  it("returns HTTP 429 with stable error and Retry-After", async () => {
    vi.mocked(executeMcpOperation).mockResolvedValue({ ok: false, error: createIntegrationError("rate_limited", "Retry later.", { retryAfterSeconds: 12 }) });
    const response = await POST(request("tools/call", { name: "list_categories", arguments: {} }));
    expect(response.status).toBe(429); expect(response.headers.get("retry-after")).toBe("12");
    expect(await response.json()).toMatchObject({ result: { isError: true, structuredContent: { error: { code: "rate_limited" } } } });
  });
  it("returns an output-validation failure as an actionable tool error", async () => {
    vi.mocked(executeMcpOperation).mockResolvedValue({ ok: false, error: createIntegrationError("internal_error", "Cadence produced a result that does not match the tool's output schema.") });
    expect(await (await POST(request("tools/call", { name: "list_categories", arguments: {} }))).json())
      .toMatchObject({ result: { isError: true, structuredContent: { error: { code: "internal_error" } } } });
  });
  it("rejects unsupported modern versions and mismatched method headers before handlers", async () => {
    expect((await POST(request("tools/list", {}, { "Mcp-Method": "tools/call" }))).status).toBe(400);
    const original = request("tools/list");
    const body = (await original.text()).replaceAll("2026-07-28", "2099-01-01");
    const response = await POST(new Request(url, { method: "POST", headers: original.headers, body }));
    expect(response.status).toBe(400);
    expect(executeMcpOperation).not.toHaveBeenCalled();
  });
  it("fails closed when disabled and rejects untrusted browser origins", async () => {
    expect((await POST(request("tools/list", {}, { Origin: "https://evil.example" }))).status).toBe(403);
    vi.stubEnv("CADENCE_MCP_ENABLED", "false");
    expect((await POST(request("tools/list"))).status).toBe(503);
    expect((await OPTIONS(new Request(url, { method: "OPTIONS" }))).status).toBe(503);
    expect(verifyMcpAccessToken).not.toHaveBeenCalled();
  });
  it("permits Inspector CORS preflight without credentials", async () => {
    const response = await OPTIONS(new Request(url, { method: "OPTIONS", headers: { Origin: "http://127.0.0.1:4322" } }));
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-headers")).toContain("Authorization");
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
  });
  it("bounds body size and sanitizes unexpected errors", async () => {
    const response = await POST(new Request(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "x".repeat(65_537) }));
    expect(response.status).toBe(413);
    vi.mocked(verifyMcpAccessToken).mockRejectedValue(new Error("secret token or database payload"));
    const failed = await POST(request("tools/list"));
    expect(failed.status).toBe(503); expect(await failed.text()).not.toContain("secret token");
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain(token);
  });
});
