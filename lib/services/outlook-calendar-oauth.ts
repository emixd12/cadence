import { createHash, randomBytes } from "node:crypto";
import { ConnectorError } from "@/lib/types/connectors";

// Ticket 224 Microsoft identity platform client for Outlook Calendar.
// Microsoft linking is separate from Cadence's Google sign-in: no Google identity,
// login hint, or Supabase provider session is used. The connection binds to the
// Cadence account that started the attempt and to the validated ID-token
// `tid` plus `sub` pair. Email and preferred_username never identify.
export const OUTLOOK_CALENDAR_SCOPES = ["openid", "offline_access", "Calendars.ReadBasic"] as const;
/** The only Graph permission the access token may carry. */
const GRAPH_SCOPE = "calendars.readbasic";
/** OpenID Connect scopes Microsoft may echo; they grant no Graph access. */
const OIDC_SCOPES = new Set(["openid", "offline_access", "profile", "email"]);
const AUTHORITY = "https://login.microsoftonline.com/common/oauth2/v2.0";
const ISSUER = /^https:\/\/login\.microsoftonline\.com\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/v2\.0$/;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const OUTLOOK_PERSONAL_TENANT_ID = "9188040d-6c67-4c5b-b112-36a304b66dad";
export const OUTLOOK_CALLBACK_PATH = "/auth/outlook-calendar/callback";
const TOKEN_BODY_LIMIT = 65_536;
const ID_TOKEN_LIMIT = 16_384;
const CLOCK_SKEW_SECONDS = 300;

export type OutlookOAuthConfig = Readonly<{ clientId: string; clientSecret: string; callbackUrl: string }>;
export type OutlookFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;
export type OutlookTarget = "web" | "desktop";

/**
 * Server-only registration values. The callback must be the exact HTTPS
 * `/auth/outlook-calendar/callback` URL; when a request origin is given it must
 * match so the host-only web session cookie is available on return.
 */
export function readOutlookCalendarOAuthConfig(env: Record<string, string | undefined> = process.env, requestOrigin?: string): OutlookOAuthConfig | null {
  const { OUTLOOK_CALENDAR_CLIENT_ID: clientId, OUTLOOK_CALENDAR_CLIENT_SECRET: clientSecret, OUTLOOK_CALENDAR_CALLBACK_URL: callbackUrl } = env;
  if (!clientId || !GUID.test(clientId) || !clientSecret || clientSecret.length > 1024 || !callbackUrl) return null;
  try {
    const url = new URL(callbackUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== OUTLOOK_CALLBACK_PATH) return null;
    if (requestOrigin !== undefined && url.origin !== requestOrigin) return null;
    return { clientId: clientId.toLowerCase(), clientSecret, callbackUrl: url.toString() };
  } catch { return null; }
}

/**
 * Opaque state: a one-character return-target marker plus 32 random bytes in
 * base64url. The marker lets the callback forward a desktop attempt without
 * consuming it; it is covered by the stored state hash, so changing it finds no
 * attempt, and the consumed attempt's target is checked again.
 */
const STATE = /^([wd])([A-Za-z0-9_-]{43})$/;
export function createOutlookState(target: OutlookTarget): string {
  return `${target === "web" ? "w" : "d"}${randomBytes(32).toString("base64url")}`;
}
export function parseOutlookState(value: unknown): OutlookTarget | null {
  if (typeof value !== "string") return null;
  const match = STATE.exec(value);
  if (!match) return null;
  // Only canonical 32-byte encodings are accepted.
  if (Buffer.from(match[2]!, "base64url").toString("base64url") !== match[2]) return null;
  return match[1] === "w" ? "web" : "desktop";
}
export function createOutlookVerifier(): string { return randomBytes(32).toString("base64url"); }
/** The nonce is derived from the sealed PKCE verifier, so it needs no extra storage and is unknown outside the server. */
export function outlookNonce(verifier: string): string {
  return createHash("sha256").update(`cadence-outlook-nonce-v1:${verifier}`).digest("base64url");
}

export function createOutlookAuthorizationUrl(config: OutlookOAuthConfig, state: string, verifier: string): string {
  const url = new URL(`${AUTHORITY}/authorize`);
  url.search = new URLSearchParams({
    client_id: config.clientId, response_type: "code", redirect_uri: config.callbackUrl, response_mode: "query",
    scope: OUTLOOK_CALENDAR_SCOPES.join(" "), state, nonce: outlookNonce(verifier),
    code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256",
    // The user chooses the Microsoft account explicitly; Cadence never hints it.
    prompt: "select_account",
  }).toString();
  return url.toString();
}

/** Callback `error` values. AADSTS codes are matched only to choose a fixed result; the text is never stored or echoed. */
export type OutlookConsentResult = "cancelled" | "admin_approval_required";
export function outlookConsentFailure(error: string | null, description: string | null): OutlookConsentResult {
  const text = (description ?? "").slice(0, 2048);
  if (error === "consent_required" || /AADSTS(?:65001|90094|90095|900941|900971)\b/.test(text)) return "admin_approval_required";
  return "cancelled";
}

export type OutlookIdentity = Readonly<{ tenantId: string; subject: string }>;
export type OutlookTokens = Readonly<{ accessToken: string; refreshToken: string | null; identity: OutlookIdentity | null }>;

async function readBoundedText(response: Response, limit: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = []; let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > limit) { await reader.cancel().catch(() => undefined); throw new ConnectorError("malformed_provider_response"); }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function grantedScopesOk(value: unknown): boolean {
  if (typeof value !== "string" || value.length > 4096) return false;
  const scopes = value.split(" ").filter(Boolean).map((scope) => scope.toLowerCase().replace(/^https:\/\/graph\.microsoft\.com\//, ""));
  // Exactly one Graph permission, Calendars.ReadBasic. Broader grants (for example
  // Calendars.Read or User.Read from a misconfigured registration) are refused.
  return scopes.includes(GRAPH_SCOPE) && scopes.every((scope) => scope === GRAPH_SCOPE || OIDC_SCOPES.has(scope));
}

/**
 * Validates the ID token returned directly by the token endpoint over TLS
 * (OpenID Connect Core 3.1.3.7: TLS server validation may replace signature
 * checks for this channel). Audience, per-tenant issuer, nonce, expiry, and the
 * `tid`/`sub` pair are checked; email claims are ignored.
 */
export function validateOutlookIdToken(idToken: unknown, config: OutlookOAuthConfig, nonce: string, nowSeconds: number): OutlookIdentity {
  if (typeof idToken !== "string" || idToken.length > ID_TOKEN_LIMIT) throw new ConnectorError("malformed_provider_response");
  const parts = idToken.split(".");
  if (parts.length !== 3 || !parts[1]) throw new ConnectorError("malformed_provider_response");
  let claims: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    claims = parsed as Record<string, unknown>;
  } catch { throw new ConnectorError("malformed_provider_response"); }
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const issuer = typeof claims.iss === "string" ? ISSUER.exec(claims.iss) : null;
  if (audience.length !== 1 || typeof audience[0] !== "string" || audience[0].toLowerCase() !== config.clientId) throw new ConnectorError("malformed_provider_response");
  if (!issuer || claims.tid !== issuer[1] || claims.ver !== "2.0") throw new ConnectorError("malformed_provider_response");
  if (claims.nonce !== nonce) throw new ConnectorError("expired_attempt");
  if (typeof claims.exp !== "number" || claims.exp + CLOCK_SKEW_SECONDS < nowSeconds) throw new ConnectorError("expired_attempt");
  if (typeof claims.iat !== "number" || claims.iat - CLOCK_SKEW_SECONDS > nowSeconds) throw new ConnectorError("expired_attempt");
  if (typeof claims.sub !== "string" || !claims.sub || claims.sub.length > 256) throw new ConnectorError("malformed_provider_response");
  return { tenantId: issuer[1]!, subject: claims.sub };
}

async function tokenRequest(config: OutlookOAuthConfig, fields: Record<string, string>, options: { fetch?: OutlookFetch; signal?: AbortSignal }): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(`${AUTHORITY}/token`, { method: "POST", cache: "no-store", redirect: "error",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      signal: options.signal ?? AbortSignal.timeout(10_000),
      body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...fields }) });
  } catch { throw new ConnectorError(options.signal?.aborted ? "timeout" : "provider_unavailable"); }
  let body: unknown;
  try { body = JSON.parse(await readBoundedText(response, TOKEN_BODY_LIMIT)); }
  catch { throw new ConnectorError(response.status === 429 ? "rate_limited" : response.status >= 500 ? "provider_unavailable" : "malformed_provider_response"); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ConnectorError("malformed_provider_response");
  const token = body as Record<string, unknown>;
  if (!response.ok) {
    // Revoked, expired, or consent-withdrawn grants need a new consent.
    if (token.error === "invalid_grant" || token.error === "interaction_required" || token.error === "consent_required") throw new ConnectorError("reconnect_required");
    if (response.status === 429) throw new ConnectorError("rate_limited");
    throw new ConnectorError("provider_unavailable");
  }
  if (typeof token.access_token !== "string" || !token.access_token || token.access_token.length > 16_384 ||
    typeof token.token_type !== "string" || token.token_type.toLowerCase() !== "bearer") throw new ConnectorError("malformed_provider_response");
  if (!grantedScopesOk(token.scope)) throw new ConnectorError("consent_denied");
  if (token.refresh_token !== undefined && (typeof token.refresh_token !== "string" || !token.refresh_token || token.refresh_token.length > 16_384)) {
    throw new ConnectorError("malformed_provider_response");
  }
  return token;
}

/** Authorization-code redemption with the attempt's PKCE verifier and nonce. */
export async function exchangeOutlookCode(config: OutlookOAuthConfig, code: string, verifier: string,
  options: { fetch?: OutlookFetch; signal?: AbortSignal; nowSeconds?: number } = {}): Promise<OutlookTokens & { refreshToken: string; identity: OutlookIdentity }> {
  if (!code || code.length > 8192) throw new ConnectorError("invalid_request");
  const token = await tokenRequest(config, { grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: config.callbackUrl,
    scope: OUTLOOK_CALENDAR_SCOPES.join(" ") }, options);
  const identity = validateOutlookIdToken(token.id_token, config, outlookNonce(verifier), options.nowSeconds ?? Math.floor(Date.now() / 1000));
  if (typeof token.refresh_token !== "string") throw new ConnectorError("consent_denied");
  return { accessToken: token.access_token as string, refreshToken: token.refresh_token, identity };
}

/** Refresh redemption. Microsoft may return a replacement refresh token, which the caller must rotate. */
export async function refreshOutlookToken(config: OutlookOAuthConfig, refreshToken: string,
  options: { fetch?: OutlookFetch; signal?: AbortSignal } = {}): Promise<OutlookTokens> {
  const token = await tokenRequest(config, { grant_type: "refresh_token", refresh_token: refreshToken,
    scope: "offline_access Calendars.ReadBasic" }, options);
  return { accessToken: token.access_token as string, refreshToken: typeof token.refresh_token === "string" ? token.refresh_token : null, identity: null };
}
