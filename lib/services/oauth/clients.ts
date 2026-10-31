import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";
import type { OAuthClientRegistration, OAuthVerifiedClient } from "@/lib/db/oauth.repo";
import { OAuthError, validRedirect } from "./protocol";

const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.168.0.0", 16], ["192.88.99.0", 24], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 3],
] as const) blocked.addSubnet(address, prefix, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
for (const [address, prefix] of [["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]] as const) {
  blocked.addSubnet(address, prefix, "ipv6");
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, "ipv4");
  return family === 6 && globalV6.check(address, "ipv6") && !blocked.check(address, "ipv6");
}

function metadataUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new OAuthError("invalid_client"); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash ||
      (url.port && url.port !== "443") || value.length > 2048) throw new OAuthError("invalid_client");
  return url;
}

export type MetadataResponse = { status: number; location?: string; cacheControl?: string; body: string };

/** Pin the actual TLS connection to an approved DNS answer; never resolve it again. */
export async function fetchMetadataHop(url: URL, signal: AbortSignal): Promise<MetadataResponse> {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = await Promise.race([
    lookup(hostname, { all: true, verbatim: true }),
    new Promise<never>((_, reject) => {
      if (signal.aborted) reject(new OAuthError("invalid_client"));
      else signal.addEventListener("abort", () => reject(new OAuthError("invalid_client")), { once: true });
    }),
  ]);
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) throw new OAuthError("invalid_client");
  const address = addresses[0];
  return new Promise((resolve, reject) => {
    const req = request(url, {
      signal, agent: false, family: address.family,
      headers: { Accept: "application/json", "Accept-Encoding": "identity" },
      lookup: (_host, _options, callback) => callback(null, address.address, address.family),
    }, (res) => {
      const status = res.statusCode ?? 0;
      if ([301, 302, 303, 307, 308].includes(status)) {
        res.destroy();
        resolve({ status, location: res.headers.location, body: "" });
        return;
      }
      if (status !== 200 || !/^application\/(?:[a-z0-9.+-]+\+)?json(?:\s*;|$)/i.test(res.headers["content-type"] ?? "") ||
          (res.headers["content-encoding"] && res.headers["content-encoding"] !== "identity")) {
        res.destroy(); reject(new OAuthError("invalid_client")); return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 16_384) { res.destroy(); reject(new OAuthError("invalid_client")); }
        else chunks.push(chunk);
      });
      res.on("error", () => reject(new OAuthError("invalid_client")));
      res.on("end", () => resolve({ status, cacheControl: res.headers["cache-control"], body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", () => reject(new OAuthError("invalid_client")));
    req.end();
  });
}

export async function fetchClientMetadata(clientId: string, hop = fetchMetadataHop) {
  let url = metadataUrl(clientId);
  const signal = AbortSignal.timeout(5000);
  for (let redirects = 0; redirects <= 2; redirects++) {
    const response = await hop(url, signal);
    if (response.status === 200) {
      let body: unknown;
      try { body = JSON.parse(response.body); } catch { throw new OAuthError("invalid_client"); }
      if (!body || typeof body !== "object" || !("client_id" in body) || body.client_id !== clientId) throw new OAuthError("invalid_client");
      const registration = validateClientMetadata(body, clientId, "cimd");
      const age = Number(/(?:^|,)\s*max-age=(\d+)/i.exec(response.cacheControl ?? "")?.[1] ?? 300);
      const cacheSeconds = /no-store|no-cache/i.test(response.cacheControl ?? "") ? 1 : Math.max(1, Math.min(age, 3600));
      registration.metadataExpiresAt = new Date(Date.now() + cacheSeconds * 1000).toISOString();
      return registration;
    }
    if (!response.location || redirects === 2) throw new OAuthError("invalid_client");
    url = metadataUrl(new URL(response.location, url).href);
  }
  throw new OAuthError("invalid_client");
}

function verifiedClient(clientId: string, type: "cimd" | "dcr", redirects: string[]): OAuthVerifiedClient | null {
  if (type === "cimd") {
    if (clientId === "https://claude.ai/oauth/claude-code-client-metadata") return "claude_code";
    // Mirrors cadence_oauth_private.verified_client_matches: Claude web's CIMD is
    // verified only with exactly its callback; otherwise it registers unverified.
    if (clientId === "https://claude.ai/oauth/mcp-oauth-client-metadata") {
      return redirects.length === 1 && redirects[0] === "https://claude.ai/api/mcp/auth_callback" ? "claude" : null;
    }
    if (clientId === "https://chatgpt.com/oauth/client.json") return "chatgpt";
    return null;
  }
  if (redirects.every((uri) => ["https://claude.ai/api/mcp/auth_callback", "https://claude.com/api/mcp/auth_callback"].includes(uri))) return "claude";
  if (redirects.every((uri) => /^https:\/\/chatgpt\.com\/(connector_platform_oauth_redirect|connector\/oauth\/[A-Za-z0-9_-]{1,128})$/.test(uri))) return "chatgpt";
  return null;
}

export function validateClientMetadata(value: unknown, clientId: string, type: "cimd" | "dcr"): OAuthClientRegistration {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new OAuthError("invalid_client_metadata");
  const doc = value as Record<string, unknown>;
  const nativeMetadata = type === "cimd" && Array.isArray(doc.redirect_uris) &&
    doc.redirect_uris.some((uri) => typeof uri === "string" && uri.startsWith("http:") && validRedirect(uri, "native"));
  const applicationType = doc.application_type ?? (nativeMetadata ? "native" : "web");
  if (applicationType !== "web" && applicationType !== "native") throw new OAuthError("invalid_client_metadata");
  const redirects = doc.redirect_uris;
  if (!Array.isArray(redirects) || !redirects.length || redirects.length > 10 ||
      !redirects.every((uri) => validRedirect(uri, applicationType))) throw new OAuthError("invalid_redirect_uri");
  // ChatGPT publishes private_key_jwt as its preference and none as a supported alternative.
  const publicAlternative = type === "cimd" && Array.isArray(doc.token_endpoint_auth_methods_supported) &&
    doc.token_endpoint_auth_methods_supported.every((method) => typeof method === "string") &&
    doc.token_endpoint_auth_methods_supported.includes("none");
  if (doc.token_endpoint_auth_method !== undefined && doc.token_endpoint_auth_method !== "none" && !publicAlternative) throw new OAuthError("invalid_client_metadata");
  // Claude's CIMD also advertises the JWT-bearer grant. Unsupported grant types are
  // ignored, never granted: the token endpoint accepts only authorization_code and
  // refresh_token. The client must still support the authorization-code flow.
  const grants = doc.grant_types;
  if (grants !== undefined && (!Array.isArray(grants) || !grants.length || grants.length > 10 ||
      grants.some((v) => typeof v !== "string" || !v || v.length > 200) || !grants.includes("authorization_code"))) throw new OAuthError("invalid_client_metadata");
  const responses = doc.response_types;
  if (responses !== undefined && (!Array.isArray(responses) || !responses.length || responses.some((v) => v !== "code"))) throw new OAuthError("invalid_client_metadata");
  const name = doc.client_name ?? (type === "dcr" ? "Unverified app" : null);
  if (typeof name !== "string" || !name.trim() || name.length > 200 || /[\u0000-\u001f\u007f]/.test(name)) throw new OAuthError("invalid_client_metadata");
  const uri = (key: string) => {
    if (doc[key] === undefined) return null;
    if (typeof doc[key] !== "string" || !validRedirect(doc[key], "web")) throw new OAuthError("invalid_client_metadata");
    return doc[key] as string;
  };
  return {
    clientId, registrationType: type, clientName: name, clientUri: uri("client_uri"), logoUri: uri("logo_uri"),
    redirectUris: redirects, applicationType, verifiedClient: verifiedClient(clientId, type, redirects),
    metadata: {}, metadataExpiresAt: null,
  };
}
