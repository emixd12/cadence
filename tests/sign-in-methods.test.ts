import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { readFileSync } from "node:fs";

import {
  GET as startByMethod,
  POST as postByMethod,
} from "../app/auth/sign-in/[method]/route";
import { POST as confirmLink } from "../app/auth/confirm/route";
import { POST as verifyCode } from "../app/auth/email/verify/route";
import { crossSitePost } from "@/lib/auth/email-sign-in-server";
import {
  decodePendingEmailSignIn,
  EMAIL_SIGN_IN_CODE_LENGTH,
  emailRequestErrorKey,
  encodePendingEmailSignIn,
  normalizeEmailAddress,
  normalizeEmailCode,
} from "@/lib/auth/email-sign-in";
import {
  enabledSignInMethods,
  findEnabledSignInMethod,
  SIGN_IN_METHODS,
  signInStartHref,
  type SignInMethod,
} from "@/lib/auth/sign-in-methods";
import { startSignIn } from "@/lib/auth/sign-in-start";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

// Ticket 331 (D31.6). What can go wrong:
// 1. A flag shows a method that has no start yet, so the page offers a dead control.
// 2. A flag value other than exactly "on" turns a method on.
// 3. The start route starts a method whose flag is off, or an unknown id.
// 4. An id such as "__proto__" or "constructor" crashes the lookup.
// 5. The `next` value leaves the site.
// 6. Google's own start changes.

const FLAGGED_OAUTH: SignInMethod = {
  id: "apple",
  label: "Continue with Apple",
  flag: "CADENCE_SIGN_IN_APPLE",
  start: { kind: "oauth", provider: "apple" },
  startPath: "/auth/sign-in/apple",
};
const GOOGLE = SIGN_IN_METHODS.find((method) => method.id === "google")!;
const BUILT: readonly SignInMethod[] = [GOOGLE, FLAGGED_OAUTH];

describe("sign-in methods", () => {
  it("offers only Google with every new flag off", () => {
    expect(enabledSignInMethods({}).map((method) => method.id)).toEqual([
      "google",
    ]);
    expect(GOOGLE.flag).toBeNull();
    expect(signInStartHref(GOOGLE, "/settings")).toBe(
      "/auth/google?next=%2Fsettings",
    );
  });

  it("gives every method except Google its own flag", () => {
    const flags = SIGN_IN_METHODS.filter((method) => method.id !== "google").map(
      (method) => method.flag,
    );

    expect(flags).toEqual(["CADENCE_SIGN_IN_APPLE", "CADENCE_SIGN_IN_EMAIL"]);
  });

  it("keeps a method without a start hidden when its flag is on", () => {
    const env = { CADENCE_SIGN_IN_APPLE: "on", CADENCE_SIGN_IN_EMAIL: "on" };
    const unbuilt = SIGN_IN_METHODS.filter((method) => method.start === null);

    expect(
      enabledSignInMethods(env).filter((method) => unbuilt.includes(method)),
    ).toEqual([]);
  });

  it.each(["1", "true", "ON", " on", "on ", ""])(
    "treats the flag value %j as off",
    (value) => {
      expect(
        enabledSignInMethods({ CADENCE_SIGN_IN_APPLE: value }, BUILT),
      ).toEqual([GOOGLE]);
    },
  );

  it("lists a built method in registry order once its flag is exactly on", () => {
    expect(
      enabledSignInMethods({ CADENCE_SIGN_IN_APPLE: "on" }, BUILT),
    ).toEqual([GOOGLE, FLAGGED_OAUTH]);
    expect(signInStartHref(FLAGGED_OAUTH, "/timeline")).toBe(
      "/auth/sign-in/apple?next=%2Ftimeline",
    );
  });

  it.each(["__proto__", "constructor", "toString", "", "GOOGLE", "github"])(
    "finds no method for the id %j",
    (id) => {
      expect(
        findEnabledSignInMethod(id, { CADENCE_SIGN_IN_APPLE: "on" }, BUILT),
      ).toBeNull();
    },
  );
});

describe("sign-in start", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("starts a flagged OAuth method with its own provider and the shared callback", async () => {
    stubConfiguredSupabase();
    vi.stubEnv("CADENCE_SIGN_IN_APPLE", "on");
    const signInWithOAuth = mockOAuthStart();

    const response = await startSignIn(
      new NextRequest(
        "http://localhost:3000/auth/sign-in/apple?next=%2Fbehaviors",
      ),
      "apple",
      BUILT,
    );

    expect(response.headers.get("location")).toBe(
      "https://accounts.example/authorize",
    );
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "apple",
      options: {
        redirectTo:
          "http://localhost:3000/auth/callback?next=%2Fbehaviors&via=apple",
      },
    });
  });

  it("refuses a built method whose flag is off", async () => {
    stubConfiguredSupabase();

    const response = await startSignIn(
      new NextRequest(
        "http://localhost:3000/auth/sign-in/apple?next=%2Fbehaviors",
      ),
      "apple",
      BUILT,
    );

    expect(createClient).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/login?next=%2Fbehaviors&error=sign_in_method_unavailable",
    );
  });

  it("returns to login when the provider start fails", async () => {
    stubConfiguredSupabase();
    vi.mocked(createClient).mockResolvedValue({
      auth: {
        signInWithOAuth: vi
          .fn()
          .mockResolvedValue({ data: { url: null }, error: new Error("no") }),
      },
    } as never);

    const response = await startSignIn(
      new NextRequest("http://localhost:3000/auth/google?next=%2Fsettings"),
      "google",
    );

    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/login?next=%2Fsettings&error=oauth_start_failed",
    );
  });

  it.each([
    ["__proto__", "CADENCE_SIGN_IN_APPLE"],
    ["github", "CADENCE_SIGN_IN_APPLE"],
  ])(
    "the method route refuses %s, with the Apple flag on or off",
    async (id, flag) => {
      stubConfiguredSupabase();

      for (const value of [undefined, "on"]) {
        vi.stubEnv(flag, value);
        const response = await startByMethod(
          new NextRequest(
            `http://localhost:3000/auth/sign-in/${id}?next=https%3A%2F%2Fevil.example`,
          ),
          { params: Promise.resolve({ method: id }) },
        );

        expect(response.headers.get("location")).toBe(
          "http://localhost:3000/login?next=%2Ftimeline&error=sign_in_method_unavailable",
        );
      }
      expect(createClient).not.toHaveBeenCalled();
    },
  );

  it("the method route starts Google the same way /auth/google does", async () => {
    stubConfiguredSupabase();
    const signInWithOAuth = mockOAuthStart();

    await startByMethod(
      new NextRequest(
        "http://localhost:3000/auth/sign-in/google?next=%2Fsettings",
      ),
      { params: Promise.resolve({ method: "google" }) },
    );

    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: "http://localhost:3000/auth/callback?next=%2Fsettings",
      },
    });
  });
});

// Ticket 332: email starts at its own form; the flag still decides.
describe("email sign-in start", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("opens the email form with a safe next only when the flag is exactly on", async () => {
    stubConfiguredSupabase();
    const start = (next: string) =>
      startByMethod(
        new NextRequest(`http://localhost:3000/auth/sign-in/email?next=${next}`),
        { params: Promise.resolve({ method: "email" }) },
      );

    for (const value of [undefined, "1", "ON"]) {
      vi.stubEnv("CADENCE_SIGN_IN_EMAIL", value);
      expect((await start("%2Fsettings")).headers.get("location")).toBe(
        "http://localhost:3000/login?next=%2Fsettings&error=sign_in_method_unavailable",
      );
    }

    vi.stubEnv("CADENCE_SIGN_IN_EMAIL", "on");
    expect((await start("%2Fsettings")).headers.get("location")).toBe(
      "http://localhost:3000/login/email?next=%2Fsettings",
    );
    expect((await start("https%3A%2F%2Fevil.example")).headers.get("location")).toBe(
      "http://localhost:3000/login/email?next=%2Ftimeline",
    );
    expect(createClient).not.toHaveBeenCalled();
  });

  it.each([
    ["email", undefined],
    ["google", "on"],
    ["apple", "on"],
  ])("refuses a post for %s with the email flag %s", async (method, flag) => {
    stubConfiguredSupabase();
    vi.stubEnv("CADENCE_SIGN_IN_EMAIL", flag);
    const form = new URLSearchParams({ email: "person@example.com", next: "/settings" });
    const response = await postByMethod(
      new NextRequest(`http://localhost:3000/auth/sign-in/${method}`, {
        method: "POST",
        body: form,
        headers: { "content-type": "application/x-www-form-urlencoded" },
      }),
      { params: Promise.resolve({ method }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toMatch(
      /^http:\/\/localhost:3000\/login\?(next=%2Fsettings&)?error=sign_in_method_unavailable$/,
    );
  });

  it("keeps the code length, the local Auth config and the email template in step", () => {
    const config = readFileSync("supabase/config.toml", "utf8");
    const template = readFileSync("supabase/templates/sign-in.html", "utf8");

    expect(config).toMatch(new RegExp(`^otp_length = ${EMAIL_SIGN_IN_CODE_LENGTH}$`, "m"));
    expect(config).toMatch(/^enable_confirmations = true$/m);
    for (const kind of ["confirmation", "magic_link"]) {
      expect(config).toContain(
        `[auth.email.template.${kind}]\nsubject = "Sign in to Cadence"\ncontent_path = "./supabase/templates/sign-in.html"`,
      );
    }
    expect(template).toContain(
      "{{ .SiteURL }}/login/confirm?token_hash={{ .TokenHash }}&amp;type=email",
    );
    expect(template).toContain("{{ .Token }}");
    expect(template).not.toContain("ConfirmationURL");
  });
});

// Ticket 332 verification: a page on another site must not post to the email
// routes. Posting its own token hash to /auth/confirm would sign a visitor in to
// the other person's account (login CSRF).
describe("email sign-in posts from another site", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  const post = (path: string, headers: Record<string, string>, form: Record<string, string>) =>
    new NextRequest(`http://localhost:3000${path}`, {
      method: "POST",
      body: new URLSearchParams(form),
      headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    });

  const routes = [
    ["/auth/sign-in/email", { email: "person@example.com" }],
    ["/auth/email/verify", { code: "123456" }],
    ["/auth/confirm", { token_hash: "attacker-token-hash" }],
  ] as const;

  const call = (path: string, request: NextRequest) =>
    path === "/auth/confirm"
      ? confirmLink(request)
      : path === "/auth/email/verify"
        ? verifyCode(request)
        : postByMethod(request, { params: Promise.resolve({ method: "email" }) });

  it.each(routes)("refuses %s while the email flag is off, before reading Auth", async (path, form) => {
    stubConfiguredSupabase();
    vi.stubEnv("CADENCE_SIGN_IN_EMAIL", undefined);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const response = await call(path, post(path, {}, form));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toMatch(
      /^http:\/\/localhost:3000\/login\?(next=%2Ftimeline&)?error=sign_in_method_unavailable$/,
    );
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it.each(
    routes.flatMap(([path, form]) => [
      [path, form, { origin: "https://evil.example" }],
      [path, form, { "sec-fetch-site": "cross-site" }],
      [path, form, { "sec-fetch-site": "same-site", origin: "http://localhost:3000" }],
      [path, form, { origin: "null" }],
    ]),
  )("refuses %s with %j", async (path, form, headers) => {
    stubConfiguredSupabase();
    vi.stubEnv("CADENCE_SIGN_IN_EMAIL", "on");
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const response = await call(path, post(path, headers as Record<string, string>, form));

    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

// Ticket 332 verification: the confirm page posts from its own origin. A browser
// that sends Sec-Fetch-Site: same-origin passes even with Origin: null, which a
// no-referrer page sends; a real browser was refused before this rule.
describe("email sign-in cross-site rule", () => {
  const request = (headers: Record<string, string>) => ({
    url: "https://app.cadence-me.com/auth/confirm",
    headers: new Headers(headers),
  });

  it.each([
    [{ "sec-fetch-site": "same-origin", origin: "https://app.cadence-me.com" }, false],
    [{ "sec-fetch-site": "same-origin", origin: "null" }, false],
    [{ origin: "https://app.cadence-me.com" }, false],
    [{}, false],
    [{ "sec-fetch-site": "cross-site", origin: "https://evil.example" }, true],
    [{ "sec-fetch-site": "same-site", origin: "https://app.cadence-me.com" }, true],
    [{ "sec-fetch-site": "none" }, true],
    [{ origin: "https://evil.example" }, true],
    [{ origin: "null" }, true],
  ])("headers %j are cross-site: %s", (headers, expected) => {
    expect(crossSitePost(request(headers))).toBe(expected);
  });
});

// Ticket 332 verification: the pure email helpers run in CI, not only in the
// opt-in local-integration test.
describe("email sign-in helpers", () => {
  it("accepts only a code of the configured length, with spaces or a hyphen", () => {
    const code = "1".repeat(EMAIL_SIGN_IN_CODE_LENGTH);
    expect(normalizeEmailCode(code)).toBe(code);
    expect(normalizeEmailCode(` ${code.slice(0, 3)} ${code.slice(3)}`)).toBe(code);
    expect(normalizeEmailCode(`${code.slice(0, 3)}-${code.slice(3)}`)).toBe(code);
    for (const value of [`${code}1`, code.slice(1), "abcdef", "", null, 123456]) {
      expect(normalizeEmailCode(value)).toBeNull();
    }
  });

  it("normalizes an address and refuses malformed ones", () => {
    expect(normalizeEmailAddress("  Person@Example.COM ")).toBe("person@example.com");
    for (const value of ["person", "person@", "@example.com", "a b@example.com", "person@localhost", `${"a".repeat(250)}@x.co`, undefined]) {
      expect(normalizeEmailAddress(value)).toBeNull();
    }
  });

  it("reads back only a valid pending cookie and keeps next on this site", () => {
    const value = encodePendingEmailSignIn({ email: "person@example.com", next: "/settings" });
    expect(decodePendingEmailSignIn(value)).toEqual({ email: "person@example.com", next: "/settings" });
    const outside = encodePendingEmailSignIn({ email: "person@example.com", next: "//evil.example" });
    expect(decodePendingEmailSignIn(outside)?.next).toBe("/timeline");
    const badAddress = Buffer.from(JSON.stringify({ email: "nope", next: "/" })).toString("base64url");
    for (const bad of [badAddress, "%%%", "", undefined]) {
      expect(decodePendingEmailSignIn(bad)).toBeNull();
    }
  });

  it("maps Auth errors to messages, treating unknown ones as a send failure", () => {
    expect(emailRequestErrorKey({ code: "over_email_send_rate_limit" })).toBe("email_rate_limited");
    expect(emailRequestErrorKey({ status: 429 })).toBe("email_rate_limited");
    expect(emailRequestErrorKey({ code: "captcha_failed" })).toBe("email_check_failed");
    expect(emailRequestErrorKey({ code: "signup_disabled" })).toBe("email_unavailable");
    expect(emailRequestErrorKey({ code: "something_new", status: 500 })).toBe("email_send_failed");
  });
});

function mockOAuthStart() {
  const signInWithOAuth = vi.fn().mockResolvedValue({
    data: { url: "https://accounts.example/authorize" },
    error: null,
  });
  vi.mocked(createClient).mockResolvedValue({
    auth: { signInWithOAuth },
  } as never);
  return signInWithOAuth;
}

function stubConfiguredSupabase() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.example");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key");
}
