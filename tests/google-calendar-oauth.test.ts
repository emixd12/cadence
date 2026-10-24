import { describe, expect, it, vi } from "vitest";
import { createCalendarAuthorization, exchangeCalendarCode, GOOGLE_CALENDAR_SCOPES, openCalendarSecret, readCalendarOAuthConfig, sealCalendarSecret } from "@/lib/services/google-calendar-oauth";
const config = { clientId: "synthetic-client", clientSecret: "synthetic-secret", callbackUrl: "https://cadence.example/auth/google-calendar/callback", key: Buffer.alloc(32, 7), keyId: "v1" };
const binding = { purpose: "refresh" as const, userId: "owner", googleSubject: "subject", generation: 1 };
describe("Calendar consent and custody", () => {
  it("fails closed for an absent agent client and rejects a shared client or project", () => {
    const env = { GOOGLE_CALENDAR_CLIENT_ID: "standard", GOOGLE_CALENDAR_PROJECT_ID: "standard-project",
      GOOGLE_CALENDAR_CLIENT_SECRET: "synthetic", GOOGLE_CALENDAR_CALLBACK_URL: config.callbackUrl,
      GOOGLE_CALENDAR_ENCRYPTION_KEY: config.key.toString("base64"), GOOGLE_CALENDAR_KEY_ID: "v1" };
    expect(readCalendarOAuthConfig(env, undefined, "agent")).toBeNull();
    const agent = { ...env, GOOGLE_CALENDAR_AGENT_CLIENT_ID: "agent", GOOGLE_CALENDAR_AGENT_CLIENT_SECRET: "synthetic-agent",
      GOOGLE_CALENDAR_AGENT_PROJECT_ID: "agent-project" };
    expect(readCalendarOAuthConfig(agent, undefined, "agent")?.clientId).toBe("agent");
    expect(readCalendarOAuthConfig({ ...agent, GOOGLE_CALENDAR_AGENT_CLIENT_ID: "standard" }, undefined, "agent")).toBeNull();
    expect(readCalendarOAuthConfig({ ...agent, GOOGLE_CALENDAR_AGENT_PROJECT_ID: "standard-project" }, undefined, "agent")).toBeNull();
  });
  it("binds agent ciphertext to its client and cannot open standard ciphertext", () => {
    const agent = { ...config, grantPurpose: "agent" as const, clientId: "agent-client" };
    const sealed = sealCalendarSecret(agent, "synthetic-agent-refresh", binding);
    expect(openCalendarSecret(agent, sealed, binding)).toBe("synthetic-agent-refresh");
    expect(() => openCalendarSecret(config, sealed, binding)).toThrow("reconnect_required");
    expect(() => openCalendarSecret({ ...agent, clientId: "replacement" }, sealed, binding)).toThrow("reconnect_required");
    expect(() => openCalendarSecret(agent, sealCalendarSecret(config, "standard", binding), binding)).toThrow("reconnect_required");
  });
  it("authenticates ciphertext and binds it to the account and purpose", () => {
    const sealed = sealCalendarSecret(config, "synthetic-refresh", binding);
    expect(sealed).not.toContain("synthetic-refresh");
    expect(openCalendarSecret(config, sealed, binding)).toBe("synthetic-refresh");
    expect(() => openCalendarSecret(config, sealed, { ...binding, userId: "other" })).toThrow("reconnect_required");
    expect(() => openCalendarSecret({ ...config, keyId: "v2" }, sealed, binding)).toThrow();
  });
  it("uses PKCE, unique states, exact scopes and same-account hint", () => {
    const first = createCalendarAuthorization(config, "google-sub");
    const url = new URL(first.url);
    expect(first.state).not.toBe(createCalendarAuthorization(config, "google-sub").state);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toBe(GOOGLE_CALENDAR_SCOPES.join(" "));
    expect(url.searchParams.get("login_hint")).toBe("google-sub");
    expect(url.searchParams.has("client_secret")).toBe(false);
  });
  it("rejects partial consent and a different Google subject before saving", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ access_token: "a", token_type: "Bearer", scope: "openid", refresh_token: "r" }));
    await expect(exchangeCalendarCode(config, "code", "verifier", "expected", fetcher)).rejects.toThrow("consent_denied");
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockResolvedValueOnce(Response.json({ access_token: "a", token_type: "Bearer", scope: GOOGLE_CALENDAR_SCOPES.join(" "), refresh_token: "r" }))
      .mockResolvedValueOnce(Response.json({ sub: "different" }));
    await expect(exchangeCalendarCode(config, "code", "verifier", "expected", fetcher)).rejects.toThrow("same_account_required");
    expect(fetcher.mock.calls.some(([url]) => String(url).includes("revoke"))).toBe(false);
  });
  it("accepts only complete server configuration", () => {
    expect(readCalendarOAuthConfig({})).toBeNull();
    expect(readCalendarOAuthConfig({ GOOGLE_CALENDAR_CLIENT_ID: "id", GOOGLE_CALENDAR_CLIENT_SECRET: "secret", GOOGLE_CALENDAR_CALLBACK_URL: "http://bad.example/auth/google-calendar/callback", GOOGLE_CALENDAR_ENCRYPTION_KEY: config.key.toString("base64"), GOOGLE_CALENDAR_KEY_ID: "v1" })).toBeNull();
  });
  it("allows only the exact configured primary and legacy callback origins", () => {
    const env = { GOOGLE_CALENDAR_CLIENT_ID: "id", GOOGLE_CALENDAR_CLIENT_SECRET: "secret",
      GOOGLE_CALENDAR_CALLBACK_URL: "https://app.cadence.example/auth/google-calendar/callback",
      GOOGLE_CALENDAR_LEGACY_CALLBACK_URL: config.callbackUrl,
      GOOGLE_CALENDAR_ENCRYPTION_KEY: config.key.toString("base64"), GOOGLE_CALENDAR_KEY_ID: "v1" };
    expect(readCalendarOAuthConfig(env)?.callbackUrl).toBe(env.GOOGLE_CALENDAR_CALLBACK_URL);
    expect(readCalendarOAuthConfig(env, "https://app.cadence.example")?.callbackUrl).toBe(env.GOOGLE_CALENDAR_CALLBACK_URL);
    expect(readCalendarOAuthConfig(env, "https://cadence.example")?.callbackUrl).toBe(config.callbackUrl);
    for (const origin of ["http://cadence.example", "https://cadence.example.evil.test", "https://cadence.example:444", "https://unknown.example"]) {
      expect(readCalendarOAuthConfig(env, origin)).toBeNull();
    }
    for (const legacy of ["http://cadence.example/auth/google-calendar/callback", "https://user:pass@cadence.example/auth/google-calendar/callback",
      "https://cadence.example/wrong", `${config.callbackUrl}?next=evil`, `${config.callbackUrl}#fragment`]) {
      expect(readCalendarOAuthConfig({ ...env, GOOGLE_CALENDAR_LEGACY_CALLBACK_URL: legacy })).toBeNull();
    }
    expect(readCalendarOAuthConfig({ ...env, GOOGLE_CALENDAR_LEGACY_CALLBACK_URL: "" }, "https://cadence.example")).toBeNull();
  });
});
