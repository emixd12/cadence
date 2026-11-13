import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ otp: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: { signInWithOtp: auth.otp } }) }));
vi.mock("@/lib/supabase/env", () => ({ readSupabaseRuntimeConfig: () => ({ url: "https://example.supabase.co", publishableKey: "public" }) }));
vi.mock("@/lib/monitoring/privacy-safe-events", () => ({ reportMonitoringEvent: vi.fn() }));
const apple = vi.hoisted(() => ({ caller: null as null | { user: { id: string; identities: unknown[] } }, kept: [] as unknown[] }));
vi.mock("@/lib/services/google-calendar-request", () => ({
  authenticateCalendarRequest: async () => { if (!apple.caller) throw new Error("unauthenticated"); return apple.caller; },
  calendarResponse: (_request: Request, body: unknown, status = 200) => Response.json(body, { status }),
}));
vi.mock("@/lib/services/apple-sign-in.service", () => ({
  keepAppleRefreshToken: async (input: unknown) => { apple.kept.push(input); return "kept"; },
}));

import { keepDesktopAppleToken, requestDesktopEmailCode } from "@/lib/services/desktop-sign-in.service";

const ORIGIN = "https://app.example.test";
function post(body: unknown, headers: Record<string, string> = { "sec-fetch-site": "same-origin" }) {
  return new Request(`${ORIGIN}/auth/email/mac`, { method: "POST", headers: { "content-type": "application/json", host: "app.example.test", ...headers }, body: JSON.stringify(body) });
}

// Ticket 336: the page the Mac opens sends the code here, with the bot-check token.
describe("POST /auth/email/mac", () => {
  beforeEach(() => {
    vi.stubEnv("CADENCE_SIGN_IN_EMAIL", "on");
    auth.otp.mockReset().mockResolvedValue({ data: {}, error: null });
  });

  it("sends one code with the Turnstile token and creates no session", async () => {
    const response = await requestDesktopEmailCode(post({ email: " Owner@Example.test", captchaToken: "turnstile-token" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(auth.otp).toHaveBeenCalledWith({ email: "owner@example.test", options: { captchaToken: "turnstile-token", shouldCreateUser: true } });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("is off while the email flag is off", async () => {
    vi.stubEnv("CADENCE_SIGN_IN_EMAIL", "");
    expect((await requestDesktopEmailCode(post({ email: "owner@example.test" }))).status).toBe(404);
    expect(auth.otp).not.toHaveBeenCalled();
  });

  it("refuses a post from another site", async () => {
    expect((await requestDesktopEmailCode(post({ email: "owner@example.test" }, { "sec-fetch-site": "cross-site" }))).status).toBe(403);
    expect(auth.otp).not.toHaveBeenCalled();
  });

  it("maps a failed bot check and a rate limit to the web's messages", async () => {
    auth.otp.mockResolvedValueOnce({ data: {}, error: { code: "captcha_failed", status: 400 } });
    const failed = await requestDesktopEmailCode(post({ email: "owner@example.test" }));
    expect(await failed.json()).toMatchObject({ ok: false, error: "email_check_failed" });
    auth.otp.mockResolvedValueOnce({ data: {}, error: { code: "over_email_send_rate_limit", status: 429 } });
    const limited = await requestDesktopEmailCode(post({ email: "owner@example.test" }));
    expect(limited.status).toBe(429);
    expect((await requestDesktopEmailCode(post({ email: "nope" }))).status).toBe(400);
  });
});

// Ticket 336: the token route keeps only a token for the caller's own Apple identity.
describe("POST /api/auth/apple-sign-in-token", () => {
  const identity = (provider: string, at: string, sub: string) => ({ provider, last_sign_in_at: at, identity_data: { sub }, id: `${provider}-id` });
  function postToken(body: unknown) {
    return new Request(`${ORIGIN}/api/auth/apple-sign-in-token`, { method: "POST", headers: { authorization: "Bearer synthetic", "content-type": "application/json" }, body: JSON.stringify(body) });
  }
  beforeEach(() => { apple.caller = null; apple.kept = []; });

  it("refuses a caller without a session", async () => {
    expect((await keepDesktopAppleToken(postToken({ refreshToken: "r" }))).status).toBe(401);
    expect(apple.kept).toEqual([]);
  });

  it("keeps the token under the caller's own id and Apple subject", async () => {
    apple.caller = { user: { id: "user-1", identities: [identity("apple", "2026-11-13T10:00:00Z", "apple-sub-1")] } };
    expect((await keepDesktopAppleToken(postToken({ refreshToken: "r", userId: "user-2", subject: "other" }))).status).toBe(200);
    expect(apple.kept).toEqual([{ userId: "user-1", subject: "apple-sub-1", refreshToken: "r" }]);
  });

  it("refuses a caller whose latest sign-in was not Apple, or who has no Apple identity", async () => {
    apple.caller = { user: { id: "user-1", identities: [identity("apple", "2026-11-13T10:00:00Z", "a"), identity("google", "2026-11-13T11:00:00Z", "g")] } };
    expect((await keepDesktopAppleToken(postToken({ refreshToken: "r" }))).status).toBe(400);
    apple.caller = { user: { id: "user-1", identities: [identity("google", "2026-11-13T11:00:00Z", "g")] } };
    expect((await keepDesktopAppleToken(postToken({ refreshToken: "r" }))).status).toBe(400);
    expect(apple.kept).toEqual([]);
  });
});
