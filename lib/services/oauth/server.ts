import { createClient } from "@supabase/supabase-js";
import { isIP } from "node:net";
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/db/database.types";
import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import * as repo from "@/lib/db/oauth.repo";
import { getSupabaseServiceRoleConfig } from "@/lib/supabase/env";
import type { VerifiedIntegrationGrant } from "@/lib/integrations/request-context";
import { fetchClientMetadata, validateClientMetadata } from "./clients";
import {
  authorizationRedirect, boundedBody, hashToken, OAuthError, oauthConfig, oauthHeaders,
  oauthJson, opaqueToken, OAUTH_SCOPES, parseScopes, redirectAllowed, required,
  requireOAuthEnabled, uniqueParameters,
} from "./protocol";

export type OAuthEndpoint = "authorize" | "token" | "register" | "revoke";

function tokenEndpointClient(): AppSupabaseClient {
  const { url, serviceRoleKey } = getSupabaseServiceRoleConfig();
  const signal = AbortSignal.timeout(8000);
  return createClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal }) },
  });
}

export function oauthDiscovery(kind: "authorization" | "resource") {
  try {
    const { issuer, resource } = requireOAuthEnabled();
    return oauthJson(kind === "resource" ? {
      resource, authorization_servers: [issuer], scopes_supported: OAUTH_SCOPES.filter((s) => s !== "offline_access"),
      bearer_methods_supported: ["header"], resource_name: "Cadence",
    } : {
      issuer, authorization_endpoint: `${issuer}/oauth/authorize`, token_endpoint: `${issuer}/oauth/token`,
      registration_endpoint: `${issuer}/oauth/register`, revocation_endpoint: `${issuer}/oauth/revoke`,
      response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"],
      revocation_endpoint_auth_methods_supported: ["none"], client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true, scopes_supported: OAUTH_SCOPES,
    });
  } catch { return oauthJson({ error: "temporarily_unavailable" }, 503); }
}

export function oauthOptions() {
  try { requireOAuthEnabled(); return new Response(null, { status: 204, headers: oauthHeaders() }); }
  catch { return oauthJson({ error: "temporarily_unavailable" }, 503); }
}

async function limitRequest(client: AppSupabaseClient, request: Request, action: OAuthEndpoint) {
  // Only Vercel's overwritten forwarding header is trusted; other hosts share a bucket.
  const address = process.env.VERCEL === "1" ? request.headers.get("x-vercel-forwarded-for")?.trim() : null;
  const source = address && isIP(address) ? address : "unattributed";
  const decisions = await Promise.all([
    repo.consumeOAuthRateLimit(client, { action: "oauth_global", sourceHash: hashToken("oauth-global") }),
    repo.consumeOAuthRateLimit(client, { action: "oauth_request", sourceHash: hashToken(`oauth:${source}`) }),
    ...(action === "register" ? [repo.consumeOAuthRateLimit(client, { action: "client_registration", sourceHash: hashToken(`registration:${source}`) })] : []),
  ]);
  const denied = decisions.find((d) => !d.allowed);
  if (denied) {
    const response = oauthJson({ error: "temporarily_unavailable" }, 429, action !== "authorize");
    response.headers.set("Retry-After", String(denied.retryAfterSeconds));
    return response;
  }
  return null;
}

async function resolveClient(client: AppSupabaseClient, clientId: string) {
  const existing = await repo.readOAuthClient(client, clientId);
  if (existing && !existing.metadataStale) return existing;
  if (!clientId.startsWith("https://")) throw new OAuthError("invalid_client");
  return repo.registerOAuthClient(client, await fetchClientMetadata(clientId));
}

/** Refresh metadata before consent as well, so short cache lifetimes do not invalidate the UI wait. */
export async function getOAuthClient(clientId: string) {
  requireOAuthEnabled();
  return resolveClient(tokenEndpointClient(), clientId);
}

export const pendingCookieName = (id: string) => `cadence_oauth_${id}`;

async function authorize(request: Request, client: AppSupabaseClient) {
  const { issuer, resource } = oauthConfig();
  const params = uniqueParameters(new URL(request.url).searchParams);
  const clientId = required(params, "client_id");
  const registered = await resolveClient(client, clientId);
  const redirectUri = required(params, "redirect_uri");
  if (!redirectAllowed(registered.redirectUris, redirectUri)) throw new OAuthError("invalid_request");
  let state: string | null = null;
  try {
    if (params.has("state")) state = required(params, "state", 1024);
    if (params.get("response_type") !== "code") throw new OAuthError("unsupported_response_type");
    if (params.has("response_mode") && params.get("response_mode") !== "query") throw new OAuthError("invalid_request");
    if (params.get("resource") !== resource) throw new OAuthError("invalid_target");
    const challenge = required(params, "code_challenge", 43);
    if (!/^[A-Za-z0-9_-]{43}$/.test(challenge) || params.get("code_challenge_method") !== "S256") throw new OAuthError("invalid_request");
    const { scopes, offlineAccess } = parseScopes(params.get("scope"));
    const browserSecret = opaqueToken();
    const id = await repo.createPendingAuthorization(client, {
      browserHash: hashToken(browserSecret), clientId, redirectUri, codeChallenge: challenge, resource, scopes, offlineAccess, state,
    });
    return new Response(null, { status: 302, headers: {
      ...oauthHeaders(false), Location: `${issuer}/oauth/consent?request=${id}`,
      "Set-Cookie": `${pendingCookieName(id)}=${browserSecret}; Path=/oauth; HttpOnly; SameSite=Lax; Max-Age=600${issuer.startsWith("https:") ? "; Secure" : ""}`,
    } });
  } catch (error) {
    return authorizationRedirect(redirectUri, state, { error: error instanceof OAuthError ? error.code : "server_error" });
  }
}

async function token(params: URLSearchParams, client: AppSupabaseClient) {
  const clientId = required(params, "client_id");
  const resource = required(params, "resource");
  if (resource !== oauthConfig().resource) throw new OAuthError("invalid_grant");
  if (params.has("client_secret")) throw new OAuthError("invalid_client");
  const accessToken = opaqueToken();
  const refreshToken = opaqueToken();
  let result: repo.OAuthTokenResult;
  const grantType = params.get("grant_type");
  if (grantType === "authorization_code") {
    const verifier = required(params, "code_verifier", 128);
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) throw new OAuthError("invalid_grant");
    result = await repo.exchangeAuthorizationCode(client, {
      codeHash: hashToken(required(params, "code")), clientId, redirectUri: required(params, "redirect_uri"),
      resource, codeVerifier: verifier, accessTokenHash: hashToken(accessToken), refreshTokenHash: hashToken(refreshToken),
    });
  } else if (grantType === "refresh_token") {
    const scopes = params.has("scope") ? parseScopes(params.get("scope")).scopes : null;
    result = await repo.rotateRefreshToken(client, {
      refreshTokenHash: hashToken(required(params, "refresh_token")), clientId, resource, scopes,
      accessTokenHash: hashToken(accessToken), nextRefreshTokenHash: hashToken(refreshToken),
    });
  } else throw new OAuthError("unsupported_grant_type");
  if (!result.ok) throw new OAuthError(result.error);
  return oauthJson({
    access_token: accessToken, token_type: "Bearer", expires_in: Math.max(0, Math.floor((Date.parse(result.accessTokenExpiresAt) - Date.now()) / 1000)),
    refresh_token: refreshToken, scope: [...result.scopes, ...(result.offlineAccess ? ["offline_access"] : [])].join(" "),
  });
}

async function register(request: Request, client: AppSupabaseClient) {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw new OAuthError("invalid_request", 415);
  let document: unknown;
  try { document = JSON.parse(await boundedBody(request)); } catch (error) {
    if (error instanceof OAuthError) throw error;
    throw new OAuthError("invalid_client_metadata");
  }
  const input = validateClientMetadata(document, randomUUID(), "dcr");
  const record = await repo.registerOAuthClient(client, input);
  return oauthJson({ client_id: record.clientId, client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: record.clientName, redirect_uris: record.redirectUris, application_type: record.applicationType,
    token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
  }, 201);
}

/** Routes remain thin; no tracking data is read by this service-role path. */
export async function handleOAuth(request: Request, endpoint: OAuthEndpoint) {
  let issuer: string | undefined;
  try {
    const config = oauthConfig(); issuer = config.issuer;
    requireOAuthEnabled();
    const expectedMethod = endpoint === "authorize" ? "GET" : "POST";
    if (request.method !== expectedMethod) throw new OAuthError("invalid_request", 405);
    if (request.url.length > 8192) throw new OAuthError("invalid_request", 414);
    if (request.headers.has("authorization")) throw new OAuthError("invalid_client");
    const client = tokenEndpointClient();
    const limited = await limitRequest(client, request, endpoint);
    if (limited) {
      if (endpoint === "authorize") return oauthJson({ error: "temporarily_unavailable", iss: issuer }, 429, false);
      return limited;
    }
    if (endpoint === "authorize") return await authorize(request, client);
    if (endpoint === "register") return await register(request, client);
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/x-www-form-urlencoded") throw new OAuthError("invalid_request", 415);
    const params = uniqueParameters(new URLSearchParams(await boundedBody(request)));
    if (endpoint === "token") return await token(params, client);
    if (params.has("client_secret")) throw new OAuthError("invalid_client");
    await repo.revokeOAuthToken(client, { clientId: required(params, "client_id"), tokenHash: hashToken(required(params, "token")) });
    return new Response(null, { status: 200, headers: oauthHeaders() });
  } catch (error) {
    const code = error instanceof OAuthError ? error.code : "server_error";
    const status = error instanceof OAuthError ? error.status : 503;
    return oauthJson({ error: code, ...(endpoint === "authorize" && issuer ? { iss: issuer } : {}) }, status, endpoint !== "authorize");
  }
}

/** Ticket 228 calls this before creating the RLS-scoped integration context. */
export async function verifyMcpAccessToken(accessToken: string, requiredScopes: readonly repo.OAuthScope[] = []): Promise<VerifiedIntegrationGrant | null> {
  const { resource } = requireOAuthEnabled();
  if (!/^[A-Za-z0-9_-]{43}$/.test(accessToken)) return null;
  const verified = await repo.verifyAccessToken(tokenEndpointClient(), { accessTokenHash: hashToken(accessToken), resource });
  if (!verified || verified.resource !== resource || Date.parse(verified.expiresAt) <= Date.now()) return null;
  if (requiredScopes.some((scope) => !verified.scopes.includes(scope))) throw new OAuthError("insufficient_scope", 403);
  return {
    userId: verified.userId, grantId: verified.grantId, clientId: verified.clientId,
    clientLabel: verified.verifiedClient ? ({ claude: "Claude", claude_code: "Claude Code", chatgpt: "ChatGPT" } as const)[verified.verifiedClient] : `${verified.clientName} (unverified)`,
    channel: "mcp", scopes: verified.scopes,
  };
}

/** Admission uses only the private OAuth counter RPC, never tracking tables. */
export async function consumeMcpRateLimit(grantId: string, access: "read" | "write") {
  requireOAuthEnabled();
  return repo.consumeOAuthRateLimit(tokenEndpointClient(), { action: access === "read" ? "mcp_read" : "mcp_write", grantId });
}
