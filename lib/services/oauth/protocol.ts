import { createHash, randomBytes } from "node:crypto";
import { INTEGRATION_SCOPE_LIST } from "@cadence/core/integration";
import type { OAuthScope } from "@/lib/db/oauth.repo";

export class OAuthError extends Error {
  constructor(readonly code: string, readonly status = 400) {
    super(code);
  }
}

export const OAUTH_SCOPES = [...INTEGRATION_SCOPE_LIST, "offline_access"];
export const opaqueToken = () => randomBytes(32).toString("base64url");
export const hashToken = (value: string) => createHash("sha256").update(value).digest("hex");

export function oauthConfig() {
  const issuer = process.env.CADENCE_OAUTH_ISSUER ?? "https://app.cadence-me.com";
  const url = new URL(issuer);
  const local = process.env.NODE_ENV !== "production" &&
    url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname) &&
    /^432[1-9]$|^4330$/.test(url.port);
  if ((!local && url.protocol !== "https:") || url.origin !== issuer || url.username || url.password) {
    throw new OAuthError("server_error", 503);
  }
  return { issuer, resource: `${issuer}/mcp`, enabled: process.env.CADENCE_MCP_ENABLED === "true" };
}

export function requireOAuthEnabled() {
  const config = oauthConfig();
  if (!config.enabled) throw new OAuthError("temporarily_unavailable", 503);
  return config;
}

export const oauthHeaders = (cors = true): Record<string, string> => ({
  "Cache-Control": "no-store",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  ...(cors ? {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  } : {}),
});

export function oauthJson(body: unknown, status = 200, cors = true) {
  return Response.json(body, { status, headers: oauthHeaders(cors) });
}

export function parseScopes(value: string | null): { scopes: OAuthScope[]; offlineAccess: boolean } {
  const list = (value ?? "cadence.read").split(" ");
  if (!list.includes("cadence.read") || list.some((s) => !OAUTH_SCOPES.includes(s)) ||
      new Set(list).size !== list.length) throw new OAuthError("invalid_scope");
  return { scopes: list.filter((s): s is OAuthScope => s !== "offline_access"), offlineAccess: list.includes("offline_access") };
}

export function uniqueParameters(params: URLSearchParams) {
  for (const key of params.keys()) {
    if (params.getAll(key).length !== 1) throw new OAuthError("invalid_request");
  }
  return params;
}

export function required(params: URLSearchParams, key: string, max = 2048): string {
  const value = params.get(key);
  if (!value || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new OAuthError("invalid_request");
  return value;
}

export function validRedirect(uri: unknown, applicationType: "web" | "native"): uri is string {
  if (typeof uri !== "string" || uri.length > 2048 || /[\s#\\]/.test(uri)) return false;
  try {
    const u = new URL(uri);
    if (u.username || u.password) return false;
    return u.protocol === "https:" || (applicationType === "native" &&
      /^http:\/\/(localhost|127\.0\.0\.1)(:[0-9]{1,5})?(\/|\?|$)/.test(uri));
  } catch { return false; }
}

export function redirectAllowed(registered: readonly string[], candidate: string) {
  if (!validRedirect(candidate, "native")) return false;
  const loopback = (value: string) => /^http:\/\/(localhost|127\.0\.0\.1)(:[0-9]{1,5})?(\/|\?|$)/.test(value)
    ? value.replace(/^(http:\/\/(?:localhost|127\.0\.0\.1))(?::[0-9]{1,5})?/, "$1") : null;
  return registered.some((uri) => uri === candidate || (loopback(candidate) !== null && loopback(uri) === loopback(candidate)));
}

export async function boundedBody(request: Request, max = 16_384): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) throw new OAuthError("invalid_request");
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; void reader.cancel(); }, 2000);
  let complete = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) { complete = true; break; }
      size += value.length;
      if (size > max) throw new OAuthError("invalid_request", 413);
      chunks.push(value);
    }
    if (timedOut) throw new OAuthError("invalid_request", 408);
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    clearTimeout(timer);
    if (!complete) await reader.cancel();
    reader.releaseLock();
  }
}

export function authorizationRedirect(redirectUri: string, state: string | null, values: Record<string, string>) {
  const target = new URL(redirectUri);
  for (const key of ["code", "error", "error_description", "iss", "state"]) target.searchParams.delete(key);
  for (const [key, value] of Object.entries({ ...values, iss: oauthConfig().issuer })) target.searchParams.set(key, value);
  if (state !== null) target.searchParams.set("state", state);
  return new Response(null, { status: 302, headers: { ...oauthHeaders(false), Location: target.href } });
}
