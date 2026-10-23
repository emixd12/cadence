import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  OUTLOOK_PERSONAL_TENANT_ID,
  createOutlookAuthorizationUrl,
  createOutlookState,
  createOutlookVerifier,
  exchangeOutlookCode,
  outlookConsentFailure,
  outlookNonce,
  parseOutlookState,
  readOutlookCalendarOAuthConfig,
  refreshOutlookToken,
  validateOutlookIdToken,
  type OutlookOAuthConfig,
} from "@/lib/services/outlook-calendar-oauth";

// Synthetic registration and tokens only. No Microsoft app, tenant, or account is contacted.
const CLIENT_ID = "11111111-2222-4333-8444-555555555555";
const WORK_TENANT = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ENV = { OUTLOOK_CALENDAR_CLIENT_ID: CLIENT_ID, OUTLOOK_CALENDAR_CLIENT_SECRET: "synthetic-secret", OUTLOOK_CALENDAR_CALLBACK_URL: "https://cadence.example/auth/outlook-calendar/callback" };
const CONFIG = readOutlookCalendarOAuthConfig(ENV) as OutlookOAuthConfig;
const NOW = 1_800_000_000;

function idToken(claims: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "RS256", typ: "JWT" })}.${encode(claims)}.signature`;
}
function claims(verifier: string, overrides: Record<string, unknown> = {}) {
  const tid = (overrides.tid as string | undefined) ?? OUTLOOK_PERSONAL_TENANT_ID;
  return { aud: CLIENT_ID, iss: `https://login.microsoftonline.com/${tid}/v2.0`, tid, sub: "pairwise-subject-1", ver: "2.0",
    nonce: outlookNonce(verifier), iat: NOW - 10, exp: NOW + 3600, email: "changeable@example.invalid", preferred_username: "changeable@example.invalid", ...overrides };
}
function tokenResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("Outlook OAuth configuration", () => {
  it("requires a GUID client, a server secret, and the exact HTTPS callback", () => {
    expect(CONFIG).toEqual({ clientId: CLIENT_ID, clientSecret: "synthetic-secret", callbackUrl: ENV.OUTLOOK_CALENDAR_CALLBACK_URL });
    expect(readOutlookCalendarOAuthConfig({})).toBeNull();
    expect(readOutlookCalendarOAuthConfig({ ...ENV, OUTLOOK_CALENDAR_CLIENT_ID: "not-a-guid" })).toBeNull();
    expect(readOutlookCalendarOAuthConfig({ ...ENV, OUTLOOK_CALENDAR_CLIENT_SECRET: "" })).toBeNull();
    for (const url of ["http://cadence.example/auth/outlook-calendar/callback", "https://cadence.example/auth/google-calendar/callback",
      "https://cadence.example/auth/outlook-calendar/callback?x=1", "https://u:p@cadence.example/auth/outlook-calendar/callback", "not a url"]) {
      expect(readOutlookCalendarOAuthConfig({ ...ENV, OUTLOOK_CALENDAR_CALLBACK_URL: url })).toBeNull();
    }
    expect(readOutlookCalendarOAuthConfig(ENV, "https://cadence.example")).not.toBeNull();
    expect(readOutlookCalendarOAuthConfig(ENV, "https://other.example")).toBeNull();
  });
});

describe("state, PKCE, and authorization URL", () => {
  it("generates 32 random bytes plus a target marker and validates the exact format", () => {
    const web = createOutlookState("web"); const desktop = createOutlookState("desktop");
    expect(web).toMatch(/^w[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(web.slice(1), "base64url")).toHaveLength(32);
    expect(parseOutlookState(web)).toBe("web");
    expect(parseOutlookState(desktop)).toBe("desktop");
    expect(createOutlookState("web")).not.toBe(web);
    // The final base64url character of 32 bytes carries only four data bits; a non-canonical value is refused.
    const nonCanonical = `w${web.slice(1, -1)}${web.endsWith("B") ? "A" : "B"}`;
    const canonical = Buffer.from(nonCanonical.slice(1), "base64url").toString("base64url") === nonCanonical.slice(1);
    expect(parseOutlookState(nonCanonical)).toBe(canonical ? "web" : null);
    for (const bad of ["", web.slice(1), `x${web.slice(1)}`, `${web}A`, web.slice(0, -1), `w${"!".repeat(43)}`, 42, null]) expect(parseOutlookState(bad)).toBeNull();
  });

  it("requests only openid, offline_access, and Calendars.Read with S256 PKCE and a derived nonce", () => {
    const verifier = createOutlookVerifier();
    const state = createOutlookState("web");
    const url = new URL(createOutlookAuthorizationUrl(CONFIG, state, verifier));
    expect(url.origin + url.pathname).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    expect(url.searchParams.get("scope")).toBe("openid offline_access Calendars.Read");
    expect(url.searchParams.get("code_challenge")).toBe(createHash("sha256").update(verifier).digest("base64url"));
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("nonce")).toBe(outlookNonce(verifier));
    expect(url.searchParams.get("state")).toBe(state);
    expect(url.searchParams.get("redirect_uri")).toBe(ENV.OUTLOOK_CALENDAR_CALLBACK_URL);
    expect(url.searchParams.get("response_mode")).toBe("query");
    // Microsoft linking is independent of the Google sign-in: no login hint, no verifier in the URL.
    expect(url.searchParams.has("login_hint")).toBe(false);
    expect(url.toString()).not.toContain(verifier);
    expect(outlookNonce(verifier)).not.toBe(outlookNonce(createOutlookVerifier()));
  });

  it("maps consent errors to fixed results without keeping provider text", () => {
    expect(outlookConsentFailure("access_denied", "AADSTS65004: User declined to consent")).toBe("cancelled");
    expect(outlookConsentFailure("access_denied", "AADSTS90094: Admin approval required")).toBe("admin_approval_required");
    expect(outlookConsentFailure("consent_required", null)).toBe("admin_approval_required");
    expect(outlookConsentFailure("server_error", null)).toBe("cancelled");
  });
});

describe("ID token validation", () => {
  const verifier = createOutlookVerifier();
  it("binds personal and work/school accounts by tid and sub, never email", () => {
    expect(validateOutlookIdToken(idToken(claims(verifier)), CONFIG, outlookNonce(verifier), NOW))
      .toEqual({ tenantId: OUTLOOK_PERSONAL_TENANT_ID, subject: "pairwise-subject-1" });
    expect(validateOutlookIdToken(idToken(claims(verifier, { tid: WORK_TENANT, sub: "work-subject" })), CONFIG, outlookNonce(verifier), NOW))
      .toEqual({ tenantId: WORK_TENANT, subject: "work-subject" });
  });

  it.each([
    [{ aud: "99999999-2222-4333-8444-555555555555" }, "malformed_provider_response"],
    [{ aud: [CLIENT_ID, "other"] }, "malformed_provider_response"],
    [{ iss: `https://login.microsoftonline.com/${WORK_TENANT}/v2.0` }, "malformed_provider_response"],
    [{ iss: "https://evil.example/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0" }, "malformed_provider_response"],
    [{ ver: "1.0" }, "malformed_provider_response"],
    [{ nonce: "replayed-nonce" }, "expired_attempt"],
    [{ exp: NOW - 301 }, "expired_attempt"],
    [{ iat: NOW + 301 }, "expired_attempt"],
    [{ sub: "" }, "malformed_provider_response"],
  ])("rejects %j", (override, code) => {
    expect(() => validateOutlookIdToken(idToken(claims(verifier, override)), CONFIG, outlookNonce(verifier), NOW)).toThrow(code);
  });

  it("rejects malformed and oversized tokens", () => {
    for (const token of [undefined, "a.b", "a.!!!.c", `x.${"a".repeat(20_000)}.y`, `x.${Buffer.from("[]").toString("base64url")}.y`]) {
      expect(() => validateOutlookIdToken(token, CONFIG, outlookNonce(verifier), NOW)).toThrow("malformed_provider_response");
    }
  });
});

describe("token endpoint", () => {
  const verifier = createOutlookVerifier();
  const good = { access_token: "synthetic-access", token_type: "Bearer", refresh_token: "synthetic-refresh-1", scope: "openid profile email offline_access https://graph.microsoft.com/Calendars.Read" };

  it("redeems the code with the verifier and returns the validated identity", async () => {
    const fetch = vi.fn(async () => tokenResponse({ ...good, id_token: idToken(claims(verifier)) }));
    const result = await exchangeOutlookCode(CONFIG, "synthetic-code", verifier, { fetch, nowSeconds: NOW });
    expect(result).toEqual({ accessToken: "synthetic-access", refreshToken: "synthetic-refresh-1", identity: { tenantId: OUTLOOK_PERSONAL_TENANT_ID, subject: "pairwise-subject-1" } });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/token");
    expect(init).toMatchObject({ method: "POST", redirect: "error", cache: "no-store" });
    const body = new URLSearchParams(init.body as URLSearchParams);
    expect(Object.fromEntries(body)).toMatchObject({ grant_type: "authorization_code", code: "synthetic-code", code_verifier: verifier,
      redirect_uri: ENV.OUTLOOK_CALENDAR_CALLBACK_URL, client_id: CLIENT_ID });
  });

  it.each([
    ["Calendars.ReadBasic openid offline_access", "consent_denied"],
    ["https://graph.microsoft.com/Calendars.ReadBasic", "consent_denied"],
    ["Calendars.Read Calendars.ReadWrite openid", "consent_denied"],
    ["Calendars.Read Calendars.Read.Shared openid", "consent_denied"],
    ["Calendars.Read User.Read openid", "consent_denied"],
    ["Calendars.Read Mail.Read", "consent_denied"],
    ["Calendars.Read Calendars.ReadBasic Calendars.ReadWrite", "consent_denied"],
    ["openid offline_access", "consent_denied"],
    [null, "consent_denied"],
    ["", "consent_denied"],
  ])("refuses granted scopes %s", async (scope, code) => {
    const fetch = vi.fn(async () => tokenResponse({ ...good, scope, id_token: idToken(claims(verifier)) }));
    await expect(exchangeOutlookCode(CONFIG, "synthetic-code", verifier, { fetch, nowSeconds: NOW })).rejects.toThrow(code);
  });

  it.each([
    "Calendars.Read",
    "https://graph.microsoft.com/Calendars.Read offline_access",
    "openid profile email offline_access https://graph.microsoft.com/calendars.read",
    // Live Ticket 242: Microsoft echoes an earlier ReadBasic consent next to Calendars.Read.
    "openid Calendars.Read Calendars.ReadBasic",
  ])("accepts the single Graph data permission Calendars.Read (%s)", async (scope) => {
    const fetch = vi.fn(async () => tokenResponse({ ...good, scope, id_token: idToken(claims(verifier)) }));
    await expect(exchangeOutlookCode(CONFIG, "synthetic-code", verifier, { fetch, nowSeconds: NOW })).resolves.toMatchObject({ accessToken: "synthetic-access" });
    const refresh = vi.fn(async () => tokenResponse({ access_token: "synthetic-access", token_type: "Bearer", scope }));
    await expect(refreshOutlookToken(CONFIG, "synthetic-refresh-1", { fetch: refresh })).resolves.toMatchObject({ accessToken: "synthetic-access" });
  });

  it("refuses a refresh that still carries only the earlier Calendars.ReadBasic grant", async () => {
    const stale = vi.fn(async () => tokenResponse({ access_token: "a", token_type: "Bearer", scope: "https://graph.microsoft.com/Calendars.ReadBasic offline_access" }));
    await expect(refreshOutlookToken(CONFIG, "synthetic-refresh-1", { fetch: stale })).rejects.toThrow("consent_denied");
    const unconsented = vi.fn(async () => tokenResponse({ error: "invalid_grant", error_description: "AADSTS65001 consent required" }, 400));
    await expect(refreshOutlookToken(CONFIG, "synthetic-refresh-1", { fetch: unconsented })).rejects.toThrow("reconnect_required");
    const consentRequired = vi.fn(async () => tokenResponse({ error: "consent_required" }, 400));
    await expect(refreshOutlookToken(CONFIG, "synthetic-refresh-1", { fetch: consentRequired })).rejects.toThrow("reconnect_required");
  });

  it("treats an omitted scope as the requested scopes on connect and refresh (Microsoft v2 auth-code flow)", async () => {
    const connect = vi.fn(async () => tokenResponse({ ...good, scope: undefined, id_token: idToken(claims(verifier)) }));
    await expect(exchangeOutlookCode(CONFIG, "synthetic-code", verifier, { fetch: connect, nowSeconds: NOW }))
      .resolves.toMatchObject({ refreshToken: "synthetic-refresh-1", identity: { subject: "pairwise-subject-1" } });
    const refresh = vi.fn(async () => tokenResponse({ access_token: "synthetic-access", token_type: "Bearer" }));
    await expect(refreshOutlookToken(CONFIG, "synthetic-refresh-1", { fetch: refresh })).resolves.toMatchObject({ accessToken: "synthetic-access", refreshToken: null });
    const broadened = vi.fn(async () => tokenResponse({ access_token: "a", token_type: "Bearer", scope: "https://graph.microsoft.com/Calendars.Read https://graph.microsoft.com/User.Read" }));
    await expect(refreshOutlookToken(CONFIG, "synthetic-refresh-1", { fetch: broadened })).rejects.toThrow("consent_denied");
  });

  it("ends an unresponsive or stalled token request as timeout at the caller's deadline", async () => {
    const never = vi.fn(() => new Promise<Response>(() => undefined));
    const started = Date.now();
    await expect(refreshOutlookToken(CONFIG, "synthetic-refresh-1", { fetch: never, signal: AbortSignal.timeout(50) })).rejects.toThrow("timeout");
    const stalled = vi.fn(async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("{\"access_token\":")); } }), { status: 200 }));
    await expect(refreshOutlookToken(CONFIG, "synthetic-refresh-1", { fetch: stalled, signal: AbortSignal.timeout(50) })).rejects.toThrow("timeout");
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("requires a refresh token and a valid nonce on the code exchange", async () => {
    const noRefresh = vi.fn(async () => tokenResponse({ ...good, refresh_token: undefined, id_token: idToken(claims(verifier)) }));
    await expect(exchangeOutlookCode(CONFIG, "code", verifier, { fetch: noRefresh, nowSeconds: NOW })).rejects.toThrow("consent_denied");
    const otherAttempt = vi.fn(async () => tokenResponse({ ...good, id_token: idToken(claims(createOutlookVerifier())) }));
    await expect(exchangeOutlookCode(CONFIG, "code", verifier, { fetch: otherAttempt, nowSeconds: NOW })).rejects.toThrow("expired_attempt");
    await expect(exchangeOutlookCode(CONFIG, "", verifier, { fetch: noRefresh })).rejects.toThrow("invalid_request");
  });

  it("maps revoked, throttled, unavailable, and oversized responses without echoing secrets", async () => {
    const cases: Array<[Response | Error, string]> = [
      [tokenResponse({ error: "invalid_grant", error_description: "AADSTS70000 synthetic-refresh-1 revoked" }, 400), "reconnect_required"],
      [tokenResponse({ error: "interaction_required" }, 400), "reconnect_required"],
      [tokenResponse({ error: "invalid_client" }, 401), "provider_unavailable"],
      [tokenResponse({ error: "throttled" }, 429), "rate_limited"],
      [new Response("<html>busy</html>", { status: 503 }), "provider_unavailable"],
      [new Response("x".repeat(70_000), { status: 200 }), "malformed_provider_response"],
      [tokenResponse({ access_token: "a", token_type: "mac", scope: good.scope }), "malformed_provider_response"],
      [new TypeError("socket synthetic-secret"), "provider_unavailable"],
    ];
    for (const [response, code] of cases) {
      const fetch = vi.fn(async () => { if (response instanceof Error) throw response; return response; });
      const error = await refreshOutlookToken(CONFIG, "synthetic-refresh-1", { fetch }).catch((value: unknown) => value as Error);
      expect(error).toMatchObject({ code });
      expect(String((error as Error).message)).not.toMatch(/synthetic-(refresh|secret)/);
    }
  });

  it("returns a rotated refresh token when Microsoft replaces it", async () => {
    const rotated = vi.fn(async () => tokenResponse({ ...good, refresh_token: "synthetic-refresh-2" }));
    expect(await refreshOutlookToken(CONFIG, "synthetic-refresh-1", { fetch: rotated })).toMatchObject({ accessToken: "synthetic-access", refreshToken: "synthetic-refresh-2" });
    const kept = vi.fn(async () => tokenResponse({ ...good, refresh_token: undefined }));
    expect(await refreshOutlookToken(CONFIG, "synthetic-refresh-1", { fetch: kept })).toMatchObject({ refreshToken: null });
    const body = new URLSearchParams((rotated.mock.calls[0] as unknown as [string, RequestInit])[1].body as URLSearchParams);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("scope")).toBe("offline_access Calendars.Read");
  });
});
