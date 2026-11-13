import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { readFileSync } from "node:fs";

import {
  GET as startByMethod,
  POST as postByMethod,
} from "../app/auth/sign-in/[method]/route";
import { EMAIL_SIGN_IN_CODE_LENGTH } from "@/lib/auth/email-sign-in";
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
        redirectTo: "http://localhost:3000/auth/callback?next=%2Fbehaviors",
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
    ["apple", "CADENCE_SIGN_IN_APPLE"],
    ["__proto__", "CADENCE_SIGN_IN_APPLE"],
    ["github", "CADENCE_SIGN_IN_APPLE"],
  ])(
    "the method route refuses %s today, with its flag on or off",
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
