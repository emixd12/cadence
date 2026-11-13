import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Ticket 338: per-person Auth limits for email sign-in. These cases run in
// `npm run test`; the two-person run against a local Auth copy is
// tests/email-sign-in-rate-limit.local-integration.test.ts.
//
// What can go wrong:
// 1. Forwarding turns on with only one secret, or with a key that is not a secret key.
// 2. A malformed address is forwarded to Auth.
// 3. The Turnstile check passes on a missing token, a refusal, an HTTP error, a
//    network error or a malformed answer.
// 4. With forwarding, the email is requested without a passing check, without the
//    person's address, or with the publishable key; without it, the request changes.

const supabase = vi.hoisted(() => ({ calls: [] as Array<{ key: string; options: unknown }>, otp: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: (_url: string, key: string, options: unknown) => {
    supabase.calls.push({ key, options });
    return { auth: { signInWithOtp: supabase.otp } };
  },
}));

import {
  authForwardingFor,
  clientAddressOf,
  turnstilePasses,
  type AuthForwarding,
} from "@/lib/auth/auth-forwarding";
import { sendEmailSignIn } from "@/lib/auth/email-sign-in-server";

const SECRET = "sb_secret_test-key";
const TURNSTILE = "turnstile-secret";
const both = { SUPABASE_SECRET_KEY: SECRET, CADENCE_TURNSTILE_SECRET_KEY: TURNSTILE };
const headers = (values: Record<string, string>) => new Headers(values);
const forwarding: AuthForwarding = { secretKey: SECRET, turnstileSecret: TURNSTILE, clientAddress: "198.51.100.7" };
const answer = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("clientAddressOf", () => {
  it("prefers x-real-ip, then the first x-forwarded-for value", () => {
    expect(clientAddressOf(headers({ "x-real-ip": "198.51.100.1", "x-forwarded-for": "198.51.100.2" }))).toBe("198.51.100.1");
    expect(clientAddressOf(headers({ "x-forwarded-for": " 2001:db8::1 , 10.0.0.1" }))).toBe("2001:db8::1");
  });

  it("skips values that are not an IP address", () => {
    expect(clientAddressOf(headers({ "x-real-ip": "evil", "x-forwarded-for": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientAddressOf(headers({ "x-real-ip": "198.51.100.1, 198.51.100.2", "x-forwarded-for": "unknown" }))).toBeNull();
    expect(clientAddressOf(headers({}))).toBeNull();
  });
});

describe("authForwardingFor", () => {
  const withAddress = headers({ "x-real-ip": "198.51.100.7" });

  it("is on only with both secrets, a secret key and a valid address", () => {
    expect(authForwardingFor(withAddress, both)).toEqual(forwarding);
    expect(authForwardingFor(withAddress, {})).toBeNull();
    expect(authForwardingFor(withAddress, { SUPABASE_SECRET_KEY: SECRET })).toBeNull();
    expect(authForwardingFor(withAddress, { CADENCE_TURNSTILE_SECRET_KEY: TURNSTILE })).toBeNull();
    expect(authForwardingFor(withAddress, { ...both, SUPABASE_SECRET_KEY: "eyJhbGciOi.service-role" })).toBeNull();
    expect(authForwardingFor(withAddress, { ...both, CADENCE_TURNSTILE_SECRET_KEY: "  " })).toBeNull();
    expect(authForwardingFor(headers({}), both)).toBeNull();
  });
});

describe("turnstilePasses", () => {
  it("passes only on success true from Cloudflare, sending the secret and address", async () => {
    const fetchImpl = answer({ success: true });
    expect(await turnstilePasses("token", forwarding, fetchImpl)).toBe(true);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    const body = new URLSearchParams(String(init.body));
    expect(Object.fromEntries(body)).toEqual({ secret: TURNSTILE, response: "token", remoteip: "198.51.100.7" });
  });

  it("refuses a missing token without calling Cloudflare", async () => {
    const fetchImpl = answer({ success: true });
    expect(await turnstilePasses(undefined, forwarding, fetchImpl)).toBe(false);
    expect(await turnstilePasses("", forwarding, fetchImpl)).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails closed on a refusal, an HTTP error, a network error or a malformed answer", async () => {
    expect(await turnstilePasses("t", forwarding, answer({ success: false, "error-codes": ["timeout-or-duplicate"] }))).toBe(false);
    expect(await turnstilePasses("t", forwarding, answer({ success: true }, 500))).toBe(false);
    expect(await turnstilePasses("t", forwarding, answer({ success: "true" }))).toBe(false);
    expect(await turnstilePasses("t", forwarding, answer("not json"))).toBe(false);
    const offline = vi.fn(async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    expect(await turnstilePasses("t", forwarding, offline)).toBe(false);
    const html = vi.fn(async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch;
    expect(await turnstilePasses("t", forwarding, html)).toBe(false);
  });
});

describe("sendEmailSignIn", () => {
  const config = { url: "https://example.supabase.co", publishableKey: "sb_publishable_test" };
  const request = { headers: headers({ "x-real-ip": "198.51.100.7" }) };
  let cloudflare: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    supabase.calls = [];
    supabase.otp.mockReset().mockResolvedValue({ data: {}, error: null });
    cloudflare = vi.fn(async () => new Response(JSON.stringify({ success: true })));
    vi.stubGlobal("fetch", cloudflare);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("without both secrets, calls Auth exactly as before: publishable key, Auth's CAPTCHA", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    vi.stubEnv("CADENCE_TURNSTILE_SECRET_KEY", "");
    const result = await sendEmailSignIn({ request, config, email: "a@example.test", captchaToken: "tok" });
    expect(result.error).toBeNull();
    expect(cloudflare).not.toHaveBeenCalled();
    expect(supabase.calls).toEqual([
      { key: "sb_publishable_test", options: { auth: { autoRefreshToken: false, flowType: "implicit", persistSession: false } } },
    ]);
    expect(supabase.otp).toHaveBeenCalledWith({ email: "a@example.test", options: { captchaToken: "tok", shouldCreateUser: true } });
  });

  it("with forwarding, checks Turnstile first, then asks Auth with the secret key and the address", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", SECRET);
    vi.stubEnv("CADENCE_TURNSTILE_SECRET_KEY", TURNSTILE);
    await sendEmailSignIn({ request, config, email: "a@example.test", captchaToken: "tok" });
    expect(cloudflare).toHaveBeenCalledTimes(1);
    expect(supabase.calls).toEqual([
      {
        key: SECRET,
        options: {
          auth: { autoRefreshToken: false, flowType: "implicit", persistSession: false },
          global: { headers: { "sb-forwarded-for": "198.51.100.7" } },
        },
      },
    ]);
    expect(supabase.otp).toHaveBeenCalledWith({ email: "a@example.test", options: { captchaToken: undefined, shouldCreateUser: true } });
  });

  it("with forwarding, a missing or failed check sends nothing", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", SECRET);
    vi.stubEnv("CADENCE_TURNSTILE_SECRET_KEY", TURNSTILE);
    expect(await sendEmailSignIn({ request, config, email: "a@example.test", captchaToken: undefined })).toEqual({
      error: { code: "captcha_failed", status: 400 },
    });
    cloudflare.mockResolvedValueOnce(new Response(JSON.stringify({ success: false })));
    expect((await sendEmailSignIn({ request, config, email: "a@example.test", captchaToken: "used" })).error?.code).toBe("captcha_failed");
    cloudflare.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect((await sendEmailSignIn({ request, config, email: "a@example.test", captchaToken: "tok" })).error?.code).toBe("captcha_failed");
    expect(supabase.calls).toEqual([]);
    expect(supabase.otp).not.toHaveBeenCalled();
  });
});
