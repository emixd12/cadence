import { beforeEach, describe, expect, it, vi } from "vitest";
const lookup = vi.hoisted(() => vi.fn());
const httpsRequest = vi.hoisted(() => vi.fn());
vi.mock("node:dns/promises", () => ({ lookup }));
vi.mock("node:https", () => ({ request: httpsRequest }));
import { EventEmitter } from "node:events";
import { fetchClientMetadata, fetchMetadataHop, isPublicAddress, validateClientMetadata } from "@/lib/services/oauth/clients";
import { boundedBody, oauthConfig, redirectAllowed } from "@/lib/services/oauth/protocol";

const url = "https://client.example/metadata.json";
const metadata = { client_id: url, client_name: "Client", redirect_uris: ["https://client.example/callback"] };
const response = (value: unknown = metadata) => ({ status: 200, body: JSON.stringify(value) });
beforeEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

describe("CIMD SSRF protection", () => {
  it.each(["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fe80::1", "fc00::1", "::ffff:127.0.0.1", "2002:7f00:1::", "2001:db8::1"])("rejects non-public address %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });
  it.each(["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"])("accepts public address %s", (address) => expect(isPublicAddress(address)).toBe(true));
  it.each(["http://client.example/metadata", "https://user:password@client.example/metadata", "https://client.example:8443/metadata", `${url}#fragment`])("rejects invalid metadata URL %s before fetching", async (id) => {
    const hop = vi.fn(); await expect(fetchClientMetadata(id, hop)).rejects.toThrow(); expect(hop).not.toHaveBeenCalled();
  });
  it("rejects private DNS answers, including mixed public/private records", async () => {
    for (const addresses of [[{ address: "127.0.0.1", family: 4 }], [{ address: "8.8.8.8", family: 4 }, { address: "10.0.0.1", family: 4 }]]) {
      lookup.mockResolvedValue(addresses);
      await expect(fetchMetadataHop(new URL(url), AbortSignal.timeout(100))).rejects.toThrow();
      expect(httpsRequest).not.toHaveBeenCalled();
    }
  });
  it("pins TLS lookup to the vetted address, preserving the hostname", async () => {
    lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
    httpsRequest.mockImplementation((target, options, callback) => {
      expect(target.hostname).toBe("client.example"); expect(options.family).toBe(4);
      const answer = vi.fn(); options.lookup("client.example", {}, answer); expect(answer).toHaveBeenCalledWith(null, "8.8.8.8", 4);
      const req = new EventEmitter() as EventEmitter & { end: () => void };
      req.end = () => {
        const res = new EventEmitter() as EventEmitter & { headers: object; statusCode: number };
        res.headers = { "content-type": "application/json" }; res.statusCode = 200;
        callback(res); res.emit("data", Buffer.from(JSON.stringify(metadata))); res.emit("end");
      };
      return req;
    });
    expect((await fetchMetadataHop(new URL(url), AbortSignal.timeout(100))).status).toBe(200);
    expect(lookup).toHaveBeenCalledTimes(1);
  });
  it("bounds DNS time, redirect count, and revalidates redirected URLs", async () => {
    lookup.mockImplementation(() => new Promise(() => {}));
    await expect(fetchMetadataHop(new URL(url), AbortSignal.timeout(10))).rejects.toThrow();
    const hop = vi.fn().mockResolvedValue({ status: 302, location: "/again", body: "" });
    await expect(fetchClientMetadata(url, hop)).rejects.toThrow(); expect(hop).toHaveBeenCalledTimes(3);
    await expect(fetchClientMetadata(url, vi.fn().mockResolvedValue({ status: 302, location: "http://127.0.0.1/internal", body: "" }))).rejects.toThrow();
    lookup.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);
    await expect(fetchClientMetadata(url, async (target, signal) => target.href === url ? { status: 302, location: "https://metadata.internal/data", body: "" } : fetchMetadataHop(target, signal))).rejects.toThrow();
  });
  it("caps response bytes and rejects non-JSON responses", async () => {
    lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
    for (const contentType of ["text/html", "application/json"]) {
      httpsRequest.mockImplementation((_target, _options, callback) => {
        const req = new EventEmitter() as EventEmitter & { end: () => void };
        req.end = () => {
          const res = new EventEmitter() as EventEmitter & { headers: object; statusCode: number; destroy: () => void };
          res.headers = { "content-type": contentType }; res.statusCode = 200; res.destroy = vi.fn();
          callback(res); res.emit("data", Buffer.alloc(16_385));
        };
        return req;
      });
      await expect(fetchMetadataHop(new URL(url), AbortSignal.timeout(100))).rejects.toThrow();
    }
  });
});

describe("client metadata and redirect validation", () => {
  it("requires matching client_id and validates JSON metadata", async () => {
    for (const value of [null, [], {}, { ...metadata, client_id: "https://other.example/client" }, { ...metadata, redirect_uris: ["javascript:alert(1)"] }]) await expect(fetchClientMetadata(url, async () => response(value))).rejects.toThrow();
    await expect(fetchClientMetadata(url, async () => ({ status: 200, body: "invalid JSON" }))).rejects.toThrow();
  });
  it("caps cache freshness and leaves unknown clients unverified", async () => {
    const now = Date.now();
    const result = await fetchClientMetadata(url, async () => ({ ...response(), cacheControl: "max-age=9999999" }));
    expect(Date.parse(result.metadataExpiresAt!) - now).toBeLessThanOrEqual(3_601_000); expect(result.verifiedClient).toBeNull();
  });
  it("recognizes known identities only from exact CIMD or every DCR redirect", () => {
    const known = "https://claude.ai/oauth/claude-code-client-metadata";
    expect(validateClientMetadata({ ...metadata, application_type: "native", redirect_uris: ["http://127.0.0.1/callback"] }, known, "cimd").verifiedClient).toBe("claude_code");
    expect(validateClientMetadata({ ...metadata, redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] }, "random", "dcr").verifiedClient).toBe("claude");
    expect(validateClientMetadata({ ...metadata, redirect_uris: ["https://chatgpt.com/connector/oauth/callback_123"] }, "random", "dcr").verifiedClient).toBe("chatgpt");
    expect(validateClientMetadata({ ...metadata, redirect_uris: ["https://claude.ai/api/mcp/auth_callback", "https://evil.example/callback"] }, "random", "dcr").verifiedClient).toBeNull();
  });
  it("selects public authentication from ChatGPT's advertised alternatives", () => {
    const chatgpt = { ...metadata, token_endpoint_auth_method: "private_key_jwt", token_endpoint_auth_methods_supported: ["none", "private_key_jwt"] };
    expect(validateClientMetadata(chatgpt, "https://chatgpt.com/oauth/client.json", "cimd").verifiedClient).toBe("chatgpt");
    expect(() => validateClientMetadata(chatgpt, "random", "dcr")).toThrow();
    expect(() => validateClientMetadata({ ...chatgpt, token_endpoint_auth_methods_supported: ["private_key_jwt"] }, url, "cimd")).toThrow();
  });
  it("accepts Claude Code CIMD without application_type, while honoring explicit web", () => {
    const claude = { ...metadata, redirect_uris: ["http://localhost/callback", "http://127.0.0.1/callback"] };
    expect(validateClientMetadata(claude, "https://claude.ai/oauth/claude-code-client-metadata", "cimd").applicationType).toBe("native");
    expect(() => validateClientMetadata({ ...claude, application_type: "web" }, url, "cimd")).toThrow();
  });
  it("accepts Claude's CIMD, which also advertises the JWT-bearer grant, without granting it", () => {
    const claudeWeb = { client_id: "https://claude.ai/oauth/mcp-oauth-client-metadata", client_name: "Claude",
      grant_types: ["authorization_code", "refresh_token", "urn:ietf:params:oauth:grant-type:jwt-bearer"], response_types: ["code"],
      token_endpoint_auth_method: "none", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] };
    const registration = validateClientMetadata(claudeWeb, claudeWeb.client_id, "cimd");
    expect(registration).toMatchObject({ applicationType: "web", verifiedClient: "claude", redirectUris: ["https://claude.ai/api/mcp/auth_callback"] });
    expect(JSON.stringify(registration)).not.toContain("jwt-bearer");
    expect(validateClientMetadata(claudeWeb, "https://example.com/claude-lookalike", "cimd").verifiedClient).toBeNull();
    expect(() => validateClientMetadata({ ...claudeWeb, grant_types: ["urn:ietf:params:oauth:grant-type:jwt-bearer"] }, claudeWeb.client_id, "cimd")).toThrow();
    expect(() => validateClientMetadata({ ...claudeWeb, grant_types: ["refresh_token", "client_credentials"] }, claudeWeb.client_id, "cimd")).toThrow();
    expect(() => validateClientMetadata({ ...claudeWeb, grant_types: ["authorization_code", 7] }, claudeWeb.client_id, "cimd")).toThrow();
    expect(() => validateClientMetadata({ ...claudeWeb, grant_types: [] }, claudeWeb.client_id, "cimd")).toThrow();
    expect(() => validateClientMetadata({ ...claudeWeb, grant_types: "authorization_code" }, claudeWeb.client_id, "cimd")).toThrow();
    expect(() => validateClientMetadata({ ...claudeWeb, response_types: ["code", "token"] }, claudeWeb.client_id, "cimd")).toThrow();
  });

  it("matches only exact redirects, except loopback port", () => {
    expect(redirectAllowed(["http://localhost/callback"], "http://localhost:12345/callback")).toBe(true);
    expect(redirectAllowed(["http://127.0.0.1/callback"], "http://127.0.0.1:4321/callback")).toBe(true);
    for (const candidate of ["http://localhost:1234/other", "http://127.0.0.1/callback", "http://localhost.evil.example/callback", "http://localhost/callback#fragment"]) expect(redirectAllowed(["http://localhost/callback"], candidate)).toBe(false);
    expect(redirectAllowed(["https://client.example/callback"], "https://client.example:443/callback")).toBe(false);
  });
  it("bounds streaming request bodies", async () => {
    await expect(boundedBody(new Request(url, { method: "POST", body: "a".repeat(16_385) }))).rejects.toMatchObject({ status: 413 });
  });
  it("allows only explicit development loopback issuers", () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("CADENCE_OAUTH_ISSUER", "http://127.0.0.1:4321"); expect(oauthConfig().issuer).toBe("http://127.0.0.1:4321");
    vi.stubEnv("NODE_ENV", "production"); expect(() => oauthConfig()).toThrow();
    vi.stubEnv("CADENCE_OAUTH_ISSUER", "https://example.com/path"); expect(() => oauthConfig()).toThrow();
  });
});
