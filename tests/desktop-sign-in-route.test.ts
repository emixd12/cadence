import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ otp: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: { signInWithOtp: auth.otp } }) }));
vi.mock("@/lib/supabase/env", () => ({ readSupabaseRuntimeConfig: () => ({ url: "https://example.supabase.co", publishableKey: "public" }) }));
vi.mock("@/lib/monitoring/privacy-safe-events", () => ({ reportMonitoringEvent: vi.fn() }));

import { requestDesktopEmailCode } from "@/lib/services/desktop-sign-in.service";

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
