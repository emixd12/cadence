import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { ExternalEventErrorCode } from "@cadence/core/types/external-event";
import type { User } from "@supabase/supabase-js";

import type { CalendarPurpose } from "@/lib/types/google-calendar";

export const GOOGLE_CALENDAR_SCOPES = ["openid", "https://www.googleapis.com/auth/calendar.calendarlist.readonly", "https://www.googleapis.com/auth/calendar.events.readonly"] as const;
export type CalendarOAuthConfig = { grantPurpose?: CalendarPurpose; clientId: string; clientSecret: string; callbackUrl: string; key: Buffer; keyId: string; decryptionKeys?: Record<string, Buffer> };
export class CalendarConnectionError extends Error {
  constructor(public readonly code: ExternalEventErrorCode | "not_configured" | "same_account_required" | "consent_denied" | "expired_attempt" | "connection_changed") {
    super(code); this.name = "CalendarConnectionError";
  }
}
export function readCalendarOAuthConfig(env: Record<string, string | undefined> = process.env, requestOrigin?: string, grantPurpose: CalendarPurpose = "standard"): CalendarOAuthConfig | null {
  const clientId = grantPurpose === "agent" ? env.GOOGLE_CALENDAR_AGENT_CLIENT_ID : env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = grantPurpose === "agent" ? env.GOOGLE_CALENDAR_AGENT_CLIENT_SECRET : env.GOOGLE_CALENDAR_CLIENT_SECRET;
  // Separate projects keep agent revocation from invalidating ordinary Calendar grants.
  if (grantPurpose === "agent" && (!env.GOOGLE_CALENDAR_PROJECT_ID || !env.GOOGLE_CALENDAR_AGENT_PROJECT_ID ||
      env.GOOGLE_CALENDAR_AGENT_PROJECT_ID === env.GOOGLE_CALENDAR_PROJECT_ID || clientId === env.GOOGLE_CALENDAR_CLIENT_ID)) return null;
  const {
    GOOGLE_CALENDAR_CALLBACK_URL: callbackUrl, GOOGLE_CALENDAR_ENCRYPTION_KEY: encoded,
    GOOGLE_CALENDAR_KEY_ID: keyId } = env;
  if (!clientId || !clientSecret || !callbackUrl || !encoded || !keyId) return null;
  try {
    const callbacks = [callbackUrl, env.GOOGLE_CALENDAR_LEGACY_CALLBACK_URL].filter((value): value is string => Boolean(value));
    const urls = callbacks.map((value) => new URL(value));
    if (urls.some((url) => url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      url.pathname !== "/auth/google-calendar/callback")) return null;
    // Keep the host-only web session on its initiating origin during domain migration.
    const selectedCallback = requestOrigin === undefined ? callbackUrl : callbacks.find((_, index) => urls[index].origin === requestOrigin);
    if (!selectedCallback) return null;
    const key = Buffer.from(encoded, "base64");
    if (key.toString("base64") !== encoded) return null;
    const oldKeys: unknown = JSON.parse(env.GOOGLE_CALENDAR_DECRYPTION_KEYS ?? "{}");
    if (!oldKeys || typeof oldKeys !== "object" || Array.isArray(oldKeys)) return null;
    const decryptionKeys: Record<string, Buffer> = {};
    for (const [id, value] of Object.entries(oldKeys)) {
      if (!/^[a-zA-Z0-9_-]{1,32}$/.test(id) || typeof value !== "string") return null;
      const decoded = Buffer.from(value, "base64");
      if (decoded.length !== 32 || decoded.toString("base64") !== value || id === keyId) return null;
      decryptionKeys[id] = decoded;
    }
    if (key.length !== 32 || !/^[a-zA-Z0-9_-]{1,32}$/.test(keyId)) return null;
    return { ...(grantPurpose === "agent" ? { grantPurpose } : {}), clientId, clientSecret, callbackUrl: selectedCallback, key, keyId, decryptionKeys };
  } catch { return null; }
}
export function calendarGoogleSubject(user: User): string {
  const subjects = user.identities?.filter((identity) => identity.provider === "google").map((identity) => "provider_id" in identity && typeof identity.provider_id === "string" ? identity.provider_id : identity.identity_data?.sub);
  if (!subjects || subjects.length !== 1 || typeof subjects[0] !== "string" || !subjects[0]) throw new CalendarConnectionError("same_account_required");
  return subjects[0];
}
export type CalendarSecretBinding = Readonly<{ purpose: "refresh" | "verifier"; userId: string; googleSubject: string; generation: number; stateHash?: string }>;
function associatedData(binding: CalendarSecretBinding, config: CalendarOAuthConfig): Buffer {
  if (config.grantPurpose === "agent") return Buffer.from(JSON.stringify(["cadence-calendar-agent-v1", config.clientId, binding.purpose, binding.userId, binding.googleSubject, binding.generation, binding.stateHash ?? null]));
  return Buffer.from(JSON.stringify(["cadence-calendar-v1", binding.purpose, binding.userId, binding.googleSubject, binding.generation, binding.stateHash ?? null]));
}
export function sealCalendarSecret(config: CalendarOAuthConfig, value: string, owner: CalendarSecretBinding): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", config.key, iv);
  cipher.setAAD(associatedData(owner, config));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [config.keyId, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}
export function openCalendarSecret(config: CalendarOAuthConfig, sealed: string, owner: CalendarSecretBinding): string {
  try {
    const [version, iv, tag, ciphertext, extra] = sealed.split(".");
    if (!version || !iv || !tag || !ciphertext || extra) throw new Error();
    const key = version === config.keyId ? config.key : config.decryptionKeys?.[version];
    if (!key) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAAD(associatedData(owner, config)); decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
  } catch { throw new CalendarConnectionError("reconnect_required"); }
}
export function hashCalendarState(value: string): string { return createHash("sha256").update(value).digest("hex"); }
export function createCalendarAuthorization(config: CalendarOAuthConfig, subject: string) {
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.callbackUrl, response_type: "code",
    scope: GOOGLE_CALENDAR_SCOPES.join(" "), state, code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256", access_type: "offline", include_granted_scopes: "true", prompt: "consent", login_hint: subject }).toString();
  return { state, verifier, url: url.toString() };
}
async function tokenRequest(config: CalendarOAuthConfig, fields: Record<string, string>, fetcher: typeof fetch) {
  let response: Response;
  try { response = await fetcher("https://oauth2.googleapis.com/token", { method: "POST", cache: "no-store", redirect: "error",
    headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(15_000),
    body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...fields }) }); }
  catch { throw new CalendarConnectionError("provider_unavailable"); }
  const body: unknown = await response.json().catch(() => null);
  if (!body || typeof body !== "object") throw new CalendarConnectionError("provider_unavailable");
  const token = body as Record<string, unknown>;
  if (token.error === "invalid_grant") throw new CalendarConnectionError("reconnect_required");
  if (!response.ok || typeof token.access_token !== "string" || token.token_type !== "Bearer") throw new CalendarConnectionError("provider_unavailable");
  return token as Record<string, unknown> & { access_token: string };
}
export async function exchangeCalendarCode(config: CalendarOAuthConfig, code: string, verifier: string, expectedSubject: string, fetcher = fetch) {
  const token = await tokenRequest(config, { grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: config.callbackUrl }, fetcher);
  const scopes = typeof token.scope === "string" ? token.scope.split(" ") : [];
  if (!GOOGLE_CALENDAR_SCOPES.every((scope) => scopes.includes(scope)) || scopes.some((scope) => !(GOOGLE_CALENDAR_SCOPES as readonly string[]).includes(scope))) throw new CalendarConnectionError("consent_denied");
  // UserInfo is fetched directly from Google's fixed TLS endpoint using this grant.
  const response = await fetcher("https://openidconnect.googleapis.com/v1/userinfo", { cache: "no-store", redirect: "error",
    headers: { Authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(15_000) });
  const identity: unknown = await response.json().catch(() => null);
  if (!response.ok || !identity || typeof identity !== "object" || !("sub" in identity)) throw new CalendarConnectionError("provider_unavailable");
  if (identity.sub !== expectedSubject) throw new CalendarConnectionError("same_account_required");
  if (typeof token.refresh_token !== "string" || !token.refresh_token) throw new CalendarConnectionError("reconnect_required");
  return { refreshToken: token.refresh_token, accessToken: token.access_token };
}
export async function refreshCalendarToken(config: CalendarOAuthConfig, refreshToken: string, fetcher = fetch): Promise<string> {
  return (await tokenRequest(config, { grant_type: "refresh_token", refresh_token: refreshToken }, fetcher)).access_token;
}
export async function revokeCalendarToken(token: string, fetcher = fetch): Promise<void> {
  const response = await fetcher("https://oauth2.googleapis.com/revoke", { method: "POST", cache: "no-store", redirect: "error",
    headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token }), signal: AbortSignal.timeout(15_000) });
  if (!response.ok && response.status !== 400) throw new CalendarConnectionError("provider_unavailable");
}
