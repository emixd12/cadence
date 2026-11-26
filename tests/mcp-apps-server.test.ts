// Ticket 376: MCP Apps on the `/mcp` route, through the SDK's own client and raw requests,
// on the 2026-07-28 path and the legacy path, with `CADENCE_MCP_APPS` on and off.
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { listIntegrationToolDescriptors, validateAgainstSchema } from "@cadence/core/integration";
import { POST } from "@/app/mcp/route";
import { recordIntegrationActivity } from "@/lib/db/integration.repo";
import { executeMcpOperation } from "@/lib/integrations/operations/execute";
import { createIntegrationContext } from "@/lib/integrations/request-context";
import { DAY_VIEW_URI, GRANTED_SCOPES_META_KEY, MCP_APP_MIME_TYPE, MCP_APPS_EXTENSION, MCP_APPS_READ_LABELS, SHOW_DAY_TOOL_NAME } from "@/lib/mcp/apps/config";
import { DAY_VIEW_HTML } from "@/lib/mcp/apps/day-view-html";
import { SHOW_DAY_OUTPUT_SCHEMA } from "@/lib/mcp/apps/show-day";
import { mcpCapabilities, mcpListedTools, mcpTools } from "@/lib/mcp/server";
import { getIntegrationDay } from "@/lib/services/integration-day.service";
import { consumeMcpRateLimit, verifyMcpAccessToken } from "@/lib/services/oauth/server";

vi.mock("@/lib/services/oauth/server", () => ({ verifyMcpAccessToken: vi.fn(), consumeMcpRateLimit: vi.fn() }));
vi.mock("@/lib/integrations/request-context", () => ({ createIntegrationContext: vi.fn() }));
vi.mock("@/lib/integrations/operations/execute", () => ({ executeMcpOperation: vi.fn() }));
vi.mock("@/lib/db/integration.repo", () => ({ recordIntegrationActivity: vi.fn() }));
vi.mock("@/lib/services/integration-day.service", () => ({ getIntegrationDay: vi.fn() }));
vi.mock("@/lib/services/integration-read.service", () => ({ IntegrationReadError: class extends Error {} }));

// sha256 of JSON.stringify(mcpTools()) for published contract 1.7.0, as tests/integration-alongside-contract.test.ts pins it.
const PUBLISHED_TOOLS_SHA256 = "bd602a832060c6c7c18c55a0fe6a50ddc547404eea030d0f24004020b6be80b8";
const sha256 = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const token = "a".repeat(43);
const url = "http://127.0.0.1:4321/mcp";
const NOTE = "Private note: knee hurt after the run";
const grant = { userId: "user-a", grantId: "grant-a", clientId: "client", clientLabel: "Test", channel: "mcp" as const,
  scopes: ["cadence.read", "cadence.occurrences.write"] as const };
const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const occurrence = (n: number, status: string, connector: boolean) => ({
  id: id(n), behavior_id: id(9), behavior_title: `Behavior ${n}`, category_name: null, local_date: "2026-11-25", timezone: "America/New_York",
  scheduled_for: "2026-11-25T13:00:00Z", effective_start_at: "2026-11-25T13:00:00Z", move: null,
  schedule: { kind: "exact", preset: null, start_time: "08:00", end_time: null, label: "8:00 AM" },
  status, status_label: status === "completed" ? "Completed" : "Unresolved", needs_decision: false, origin: "scheduled", added_by: null,
  completed_at: null, status_marked_at: null, note: n === 1 ? NOTE : null, parent_behavior_id: null, parent_title: null,
  updated_at: "2026-11-25T12:00:00Z", revision: "r1", connector_completion: connector ? { source: "hevy", source_label: "Hevy" } : null,
});
const day = { local_date: "2026-11-25", is_today: true, timezone: "America/New_York", today_local_date: "2026-11-25", day_note: "Rest day",
  occurrences: [occurrence(1, "completed", true), occurrence(2, "unresolved", false)], parent_groups: [],
  needs_decision: { count: 4, truncated: false }, freshness: { as_of: "2026-11-25T15:00:00Z", occurrences_generated_through: "2026-12-25" } };

const PATHS = [["2026-07-28", "2026-07-28"], ["legacy", "legacy"]] as const;

function sdkClient(pin: string, authorization: string | null = `Bearer ${token}`) {
  const made = new Client({ name: "cadence-apps-test", version: "1" }, { versionNegotiation: { mode: pin === "legacy" ? "legacy" : { pin } } } as never);
  const posts: Array<{ method: string; protocol: string | null }> = [];
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: authorization ? { Authorization: authorization } : {} },
    fetch: async (input, init) => {
      const request = new Request(input, init);
      if (request.method !== "POST") return new Response(null, { status: 405 });
      posts.push({ method: JSON.parse(await request.clone().text()).method, protocol: request.headers.get("mcp-protocol-version") });
      return POST(request);
    },
  });
  return { made, transport, posts };
}

/** One raw JSON-RPC request, so a test can see the HTTP status, headers and whole body. */
function raw(pin: string, method: string, params: Record<string, unknown> = {}, headers: Record<string, string | null> = {}) {
  const modern = pin !== "legacy";
  const name = method === "tools/call" ? String(params.name) : method === "resources/read" ? String(params.uri) : null;
  const all: Record<string, string | null> = { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": modern ? pin : "2025-11-25", ...(modern ? { "Mcp-Method": method, ...(name ? { "Mcp-Name": name } : {}) } : {}), ...headers };
  const sent = new Headers();
  for (const [key, value] of Object.entries(all)) if (value !== null) sent.set(key, value);
  return POST(new Request(url, { method: "POST", headers: sent, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: modern ? { ...params,
    _meta: { "io.modelcontextprotocol/protocolVersion": pin, "io.modelcontextprotocol/clientCapabilities": {} } } : params }) }));
}
/** The JSON-RPC message of a response, whether it came as JSON or as one SSE event. */
async function message(response: Response): Promise<{ result?: Record<string, unknown>; error?: { code: number; message: string; data?: unknown } }> {
  const text = await response.text();
  if (!text) return {};
  const data = text.trimStart().startsWith("{") ? text : text.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5)).join("");
  return JSON.parse(data);
}
const logs = () => vi.mocked(console.info).mock.calls.filter((call) => call[0] === "cadence_mcp").map((call) => call[1] as Record<string, unknown>);
const allowed = { allowed: true as const, limit: 120, remaining: 119, resetAt: "", retryAfterSeconds: 1 };
const refused = { allowed: false as const, limit: 120, remaining: 0, resetAt: "", retryAfterSeconds: 17 };

beforeEach(() => {
  vi.stubEnv("CADENCE_MCP_ENABLED", "true"); vi.stubEnv("CADENCE_OAUTH_ISSUER", "http://127.0.0.1:4321");
  vi.stubEnv("CADENCE_MCP_APPS", "true"); vi.stubEnv("CADENCE_ALONGSIDE", "");
  vi.mocked(verifyMcpAccessToken).mockResolvedValue(grant as never);
  vi.mocked(createIntegrationContext).mockImplementation((verified) => ({ userId: verified.userId, now: new Date(), tokenExpiresAt: new Date(),
    supabase: {}, actor: { ...verified, grantedScopes: verified.scopes } }) as never);
  vi.mocked(consumeMcpRateLimit).mockResolvedValue(allowed);
  vi.mocked(recordIntegrationActivity).mockResolvedValue();
  vi.mocked(getIntegrationDay).mockResolvedValue(day as never);
  vi.mocked(executeMcpOperation).mockResolvedValue({ ok: true, value: { categories: [], next_cursor: null } } as never);
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe.each(PATHS)("MCP Apps with the flag on, %s path", (label, pin) => {
  it("declares resources and the MCP Apps extension, and serves the view through the SDK client", async () => {
    const { made, transport, posts } = sdkClient(pin);
    await made.connect(transport);
    expect(made.getServerCapabilities()).toMatchObject({ tools: {}, resources: {}, extensions: { [MCP_APPS_EXTENSION]: {} } });
    expect(made.getServerCapabilities()?.prompts).toBeUndefined();

    const listed = await made.listResources();
    expect(listed.resources).toEqual([{ uri: "ui://cadence/day/v1.html", name: "cadence-day", title: "Cadence day", description: expect.any(String),
      mimeType: "text/html;profile=mcp-app", _meta: { ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } } } }]);
    expect(JSON.stringify(listed)).not.toContain("<html");

    const read = await made.readResource({ uri: DAY_VIEW_URI });
    expect(read.contents).toEqual([{ uri: DAY_VIEW_URI, mimeType: MCP_APP_MIME_TYPE, text: DAY_VIEW_HTML,
      _meta: { ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } } } }]);
    await expect(made.readResource({ uri: "ui://cadence/day/v2.html" })).rejects.toThrow();
    await made.close();
    // Every request of the run used the path under test.
    expect(new Set(posts.map((post) => post.protocol ?? "none")).has(pin === "legacy" ? "2025-11-25" : pin)).toBe(true);
    if (pin !== "legacy") expect(posts.every((post) => post.protocol === pin)).toBe(true);
    else expect(posts[0]).toEqual({ method: "initialize", protocol: null });
  });

  it("lists show_day after the registry, whatever the client declares", async () => {
    const { made, transport } = sdkClient(pin);
    await made.connect(transport);
    const tools = (await made.listTools()).tools;
    expect(tools.map((tool) => tool.name)).toEqual([...listIntegrationToolDescriptors().map((tool) => tool.name), "show_day"]);
    expect(tools.at(-1)).toMatchObject({ name: "show_day", title: "Show day", _meta: { ui: { resourceUri: DAY_VIEW_URI } },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } });
    // The registry tools are the published ones, unchanged by the flag.
    expect(sha256(mcpListedTools().slice(0, -1))).toBe(PUBLISHED_TOOLS_SHA256);
    await made.close();
  });

  it("returns the day as structured content, the same JSON as text, and scopes in _meta", async () => {
    const { made, transport } = sdkClient(pin);
    await made.connect(transport);
    const called = await made.callTool({ name: "show_day", arguments: { date: "2026-11-25" } });
    expect(called.isError).not.toBe(true);
    expect(validateAgainstSchema(SHOW_DAY_OUTPUT_SCHEMA, called.structuredContent).ok).toBe(true);
    expect(called.structuredContent).toMatchObject({ local_date: "2026-11-25", day_note: "Rest day", needs_decision: { count: 4, truncated: false },
      occurrences: [{ connector_completion: { source: "hevy", source_label: "Hevy" } }, { connector_completion: null }] });
    expect(called.content).toEqual([{ type: "text", text: JSON.stringify(called.structuredContent) }]);
    expect(called._meta).toMatchObject({ [GRANTED_SCOPES_META_KEY]: ["cadence.read", "cadence.occurrences.write"] });
    expect(JSON.stringify(called.structuredContent)).not.toContain("cadence.read");
    expect(getIntegrationDay).toHaveBeenCalledExactlyOnceWith(expect.anything(), { date: "2026-11-25" });
    // The registry executor never sees the transport tool.
    expect(executeMcpOperation).not.toHaveBeenCalled();
    await made.close();
  });

  it("counts resource reads against the read limit and answers 429 with Retry-After past it", async () => {
    vi.mocked(consumeMcpRateLimit).mockResolvedValueOnce(allowed).mockResolvedValueOnce(allowed).mockResolvedValue(refused);
    expect((await raw(pin, "resources/read", { uri: DAY_VIEW_URI })).status).toBe(200);
    expect((await raw(pin, "resources/list")).status).toBe(200);
    for (const [method, params] of [["resources/read", { uri: DAY_VIEW_URI }], ["resources/list", {}]] as const) {
      const response = await raw(pin, method, params);
      expect(response.status).toBe(429);
      expect(response.headers.get("retry-after")).toBe("17");
      const text = await response.clone().text();
      expect(text).not.toContain("<html");
      const body = await message(response);
      expect(body.result).toBeUndefined();
      expect(body.error).toMatchObject({ code: -32000, data: { isError: true, structuredContent: { error: { code: "rate_limited", retry_after_seconds: 17 } } } });
    }
    expect(vi.mocked(consumeMcpRateLimit).mock.calls).toEqual([["grant-a", "read"], ["grant-a", "read"], ["grant-a", "read"], ["grant-a", "read"]]);
    expect(logs().map((line) => [line.operation, line.status, line.code])).toEqual([
      ["read_view_resource", 200, "ok"], ["list_view_resources", 200, "ok"], ["read_view_resource", 429, "rate_limited"], ["list_view_resources", 429, "rate_limited"]]);
  });

  it("answers 429 for show_day past the read limit, as a registry tool does", async () => {
    vi.mocked(consumeMcpRateLimit).mockResolvedValue(refused);
    const response = await raw(pin, "tools/call", { name: "show_day", arguments: {} });
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("17");
    expect((await message(response)).result).toMatchObject({ isError: true, structuredContent: { error: { code: "rate_limited" } } });
    expect(getIntegrationDay).not.toHaveBeenCalled();
  });

  it("fails a resource read without a valid grant, before any read is counted", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [["resources/read", { uri: DAY_VIEW_URI }], ["resources/list", {}], ["tools/call", { name: "show_day", arguments: {} }]];
    for (const [method, params] of calls) {
      // No token, then a malformed one.
      for (const authorization of [null, "Bearer short", `Basic ${token}`]) {
        const response = await raw(pin, method, params, { Authorization: authorization });
        expect(response.status).toBe(401);
        expect(response.headers.get("www-authenticate")).toContain('error="invalid_token"');
        expect(await response.text()).not.toContain("<html");
      }
    }
    // An expired, revoked or wrong-resource token: verification returns no grant.
    vi.mocked(verifyMcpAccessToken).mockResolvedValue(null);
    for (const [method, params] of calls) expect((await raw(pin, method, params)).status).toBe(401);
    // A grant without cadence.read.
    vi.mocked(verifyMcpAccessToken).mockResolvedValue({ ...grant, scopes: ["cadence.occurrences.write"] } as never);
    for (const [method, params] of calls) {
      const response = await raw(pin, method, params);
      expect(response.status).toBe(403);
      expect(response.headers.get("www-authenticate")).toContain('scope="cadence.read"');
      expect(await response.text()).not.toContain("<html");
    }
    expect(consumeMcpRateLimit).not.toHaveBeenCalled();
    expect(getIntegrationDay).not.toHaveBeenCalled();
    expect(recordIntegrationActivity).not.toHaveBeenCalled();
  });

  it("answers an unknown resource URI with the protocol's not-found error and no HTML", async () => {
    const response = await raw(pin, "resources/read", { uri: "ui://cadence/day/v2.html" });
    const text = await response.clone().text();
    expect(text).not.toContain("<html");
    const body = await message(response);
    expect(body.result).toBeUndefined();
    expect(body.error?.code).toBe(-32602);
    expect(logs().at(-1)).toMatchObject({ operation: "read_view_resource", code: "not_found" });
    expect(consumeMcpRateLimit).toHaveBeenCalledExactlyOnceWith("grant-a", "read");
  });

  it("does not serve resource templates, prompts or subscriptions", async () => {
    for (const method of ["resources/templates/list", "prompts/list", "resources/subscribe"]) {
      const body = await message(await raw(pin, method, method === "resources/subscribe" ? { uri: DAY_VIEW_URI } : {}));
      expect(body.result, method).toBeUndefined();
      expect(body.error, method).toBeDefined();
    }
    expect(consumeMcpRateLimit).not.toHaveBeenCalled();
  });

  it("keeps the 403 step-up for a write tool unchanged", async () => {
    vi.mocked(executeMcpOperation).mockResolvedValue({ ok: false, error: { code: "insufficient_scope", message: "Reconnect.", retryable: false,
      contract_version: "1.7.0", required_scopes: ["cadence.occurrences.write"] } } as never);
    const response = await raw(pin, "tools/call", { name: "set_occurrence_status", arguments: {} });
    expect(response.status).toBe(403);
    expect(response.headers.get("www-authenticate")).toContain('error="insufficient_scope", scope="cadence.read cadence.occurrences.write"');
    expect((await message(response)).result).toMatchObject({ isError: true, structuredContent: { error: { code: "insufficient_scope" } } });
  });

  it("logs fixed labels only: no token, note text, HTML or URI", async () => {
    await raw(pin, "tools/call", { name: "show_day", arguments: { date: "2026-11-25" } });
    await raw(pin, "resources/read", { uri: DAY_VIEW_URI });
    await raw(pin, "resources/list");
    await raw(pin, "resources/read", { uri: "ui://cadence/secret-looking-uri.html" });
    const lines = logs();
    expect(lines.map((line) => line.operation)).toEqual(["show_day", "read_view_resource", "list_view_resources", "read_view_resource"]);
    for (const line of lines) {
      expect(Object.keys(line).sort()).toEqual(["code", "durationMs", "operation", "status"]);
      expect(typeof line.durationMs).toBe("number");
    }
    const everything = JSON.stringify(vi.mocked(console.info).mock.calls);
    for (const secret of [token, NOTE, "Rest day", "<html", "<!doctype", "not built yet", "ui://", "secret-looking", "Behavior 1"]) {
      expect(everything).not.toContain(secret);
    }
  });
});

describe.each(PATHS)("MCP Apps with the flag off, %s path", (label, pin) => {
  beforeEach(() => { vi.stubEnv("CADENCE_MCP_APPS", ""); });

  it("declares tools only and lists exactly the registry", async () => {
    const { made, transport } = sdkClient(pin);
    await made.connect(transport);
    expect(made.getServerCapabilities()).toMatchObject({ tools: {} });
    expect(made.getServerCapabilities()?.resources).toBeUndefined();
    expect(made.getServerCapabilities()?.extensions).toBeUndefined();
    expect((await made.listTools()).tools.map((tool) => tool.name)).toEqual(listIntegrationToolDescriptors().map((tool) => tool.name));
    // The SDK client sends no resources/list to a server without the capability. The raw test below covers the server.
    expect(await made.listResources()).toEqual({ resources: [] });
    await made.close();
  });

  it("serves tools/list byte for byte as before the trial", async () => {
    expect(sha256(mcpListedTools())).toBe(PUBLISHED_TOOLS_SHA256);
    expect(JSON.stringify(mcpListedTools())).toBe(JSON.stringify(mcpTools()));
    const body = await message(await raw(pin, "tools/list"));
    expect(sha256(body.result?.tools)).toBe(PUBLISHED_TOOLS_SHA256);
    expect(JSON.stringify(body)).not.toContain("show_day");
    expect(JSON.stringify(body)).not.toContain("ui://");
  });

  it("answers the resource methods with method-not-found and no HTML", async () => {
    for (const [method, params] of [["resources/read", { uri: DAY_VIEW_URI }], ["resources/list", {}]] as const) {
      const response = await raw(pin, method, params);
      const text = await response.clone().text();
      expect(text).not.toContain("<html");
      const body = await message(response);
      expect(body.result).toBeUndefined();
      expect(body.error?.code).toBe(-32601);
    }
    expect(consumeMcpRateLimit).not.toHaveBeenCalled();
    expect(recordIntegrationActivity).not.toHaveBeenCalled();
  });

  it("gives a host holding a stale show_day descriptor a stable tool error, not a crash", async () => {
    const { made, transport } = sdkClient(pin);
    await made.connect(transport);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const stale = await made.callTool({ name: "show_day", arguments: { date: "2026-11-25" } });
      expect(stale.isError).toBe(true);
      expect(stale.structuredContent).toMatchObject({ error: { code: "invalid_input", message: "Unknown Cadence tool name." } });
      expect(stale.content).toEqual([{ type: "text", text: "Unknown Cadence tool name." }]);
    }
    await made.close();
    const response = await raw(pin, "tools/call", { name: "show_day", arguments: {} });
    expect(response.status).toBe(200);
    expect((await message(response)).result).toMatchObject({ isError: true, structuredContent: { error: { code: "invalid_input" } } });
    expect(getIntegrationDay).not.toHaveBeenCalled();
    expect(executeMcpOperation).not.toHaveBeenCalled();
    expect(consumeMcpRateLimit).not.toHaveBeenCalled();
    // The registry tools still work for that host.
    const { made: again, transport: next } = sdkClient(pin);
    await again.connect(next);
    expect(await again.callTool({ name: "list_categories", arguments: {} })).toMatchObject({ structuredContent: { categories: [] } });
    await again.close();
  });
});

describe("MCP Apps flag and names", () => {
  it("reads the flag per request, so turning it off takes effect without a restart", async () => {
    expect(mcpCapabilities()).toEqual({ tools: {}, resources: {}, extensions: { "io.modelcontextprotocol/ui": {} } });
    expect((await message(await raw("2026-07-28", "tools/list"))).result?.tools).toHaveLength(mcpTools().length + 1);
    vi.stubEnv("CADENCE_MCP_APPS", "false");
    expect(mcpCapabilities()).toEqual({ tools: {} });
    expect((await message(await raw("2026-07-28", "tools/list"))).result?.tools).toHaveLength(mcpTools().length);
    // Only the exact value enables it.
    vi.stubEnv("CADENCE_MCP_APPS", "on");
    expect(mcpCapabilities()).toEqual({ tools: {} });
  });

  it("keeps the registry edition independent: the alongside edition and show_day list together", async () => {
    vi.stubEnv("CADENCE_ALONGSIDE", "on");
    const names = mcpListedTools().map((tool) => tool.name);
    expect(names.at(-1)).toBe("show_day");
    expect(names.slice(0, -1)).toEqual(mcpTools().map((tool) => tool.name));
    expect(sha256(mcpListedTools().slice(0, -1))).not.toBe(PUBLISHED_TOOLS_SHA256);
  });

  it("keeps the protocol acceptance suite's transport names equal to the server's", async () => {
    // A plain-JavaScript module with no type declarations, loaded as tests/behavior-store-supabase.contract.test.ts loads one.
    const modulePath = "../scripts/acceptance/protocol.mjs";
    const protocol = await import(modulePath) as { TRANSPORT_TOOLS: readonly string[]; MCP_APPS_EXTENSION: string; expectedTools: (apps: boolean) => string[] };
    expect([...protocol.TRANSPORT_TOOLS]).toEqual([SHOW_DAY_TOOL_NAME]);
    expect(protocol.MCP_APPS_EXTENSION).toBe(MCP_APPS_EXTENSION);
    expect(protocol.expectedTools(true)).toEqual(mcpListedTools().map((tool) => tool.name));
    vi.stubEnv("CADENCE_MCP_APPS", "");
    expect(protocol.expectedTools(false)).toEqual(mcpListedTools().map((tool) => tool.name));
    // The watcher classifies the transport reads' activity rows as reads.
    const watchPath = "../scripts/acceptance/watch.mjs";
    const watch = await import(watchPath) as { TRANSPORT_OPERATION_ACCESS: Record<string, string>; OPERATION_ACCESS: Record<string, string> };
    expect(watch.TRANSPORT_OPERATION_ACCESS).toEqual(Object.fromEntries(Object.values(MCP_APPS_READ_LABELS).map((label) => [label, "read"])));
    for (const label of Object.values(MCP_APPS_READ_LABELS)) expect(watch.OPERATION_ACCESS[label]).toBeUndefined();
  });
});
