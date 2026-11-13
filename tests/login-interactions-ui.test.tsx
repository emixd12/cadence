import { renderToStaticMarkup } from "react-dom/server";

import { afterEach, describe, expect, it, vi } from "vitest";

import LoginPage from "../app/(auth)/login/page";
import { SignInMethods } from "../app/(auth)/login/SignInMethods";
import { getAuthErrorMessage } from "@/lib/auth/redirects";
import { SIGN_IN_METHODS } from "@/lib/auth/sign-in-methods";

// The markup of the Google control on origin/main 07ce9a03, before Ticket 331.
const GOOGLE_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-log-in shrink-0" aria-hidden="true"><path d="m10 17 5-5-5-5"></path><path d="M15 12H3"></path><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path></svg>';
const GOOGLE_LINK = `<div class="mt-6"><a href="/auth/google?next=%2Fsettings" class="product-action product-action-primary min-h-11 py-2 text-base font-bold">${GOOGLE_ICON}Continue with Google</a></div>`;
const GOOGLE_DISABLED = `<div class="mt-6"><button type="button" disabled="" class="product-action product-action-primary min-h-11 py-2 text-base font-bold">${GOOGLE_ICON}Continue with Google</button></div>`;

describe("login interaction controls", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("renders Google sign-in and the public account-information links", async () => {
    stubConfiguredSupabase();

    const html = await renderLogin({ next: "/settings" });

    expect(html).toContain("Continue with Google");
    expect(html).toContain('href="/auth/google?next=%2Fsettings"');
    expect(html).toContain('width="1em"');
    expect(html).toContain('height="1em"');
    expect(html).toContain('stroke-width="1.5"');
    expect(html).not.toContain("Google sign-in only.");
    expect(html).not.toContain("Cadence never sees or stores a password.");
    expect(html).toContain('href="/terms"');
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/trust"');
    expect(html).toContain("How Cadence works →");
  });

  it("keeps the pre-Ticket-331 sign-in markup with every new flag off", async () => {
    stubConfiguredSupabase();

    const html = await renderLogin({ next: "/settings" });

    expect(html).toContain(GOOGLE_LINK);
    expect(html.match(/\/auth\//g)).toHaveLength(1);
    expect(html).not.toContain("Continue with Apple");
    expect(html).not.toContain("Continue with email");
  });

  it("keeps the disabled Google control when Supabase is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");

    expect(await renderLogin({ next: "/settings" })).toContain(GOOGLE_DISABLED);
  });

  it("adds Continue with Apple after Google when the Apple flag is on (Ticket 333)", async () => {
    stubConfiguredSupabase();
    vi.stubEnv("CADENCE_SIGN_IN_APPLE", "on");
    const html = await renderLogin({ next: "/settings" });

    expect(html).toContain(
      '<a href="/auth/sign-in/apple?next=%2Fsettings" class="apple-sign-in-action">',
    );
    expect(html.indexOf("Continue with Google")).toBeLessThan(
      html.indexOf("Continue with Apple"),
    );
  });

  it("adds Continue with email after Google when the email flag is on (Ticket 332)", async () => {
    stubConfiguredSupabase();
    vi.stubEnv("CADENCE_SIGN_IN_EMAIL", "on");
    const html = await renderLogin({ next: "/settings" });

    expect(html).toContain('href="/auth/sign-in/email?next=%2Fsettings"');
    expect(html.indexOf("Continue with Google")).toBeLessThan(
      html.indexOf("Continue with email"),
    );
  });

  it("lists every method it is given, in order, each with its own start link", () => {
    const html = renderToStaticMarkup(
      <SignInMethods methods={SIGN_IN_METHODS} nextPath="/settings" />,
    );

    expect(html.match(/<li>/g)).toHaveLength(SIGN_IN_METHODS.length);
    expect(html.indexOf("Continue with Google")).toBeLessThan(
      html.indexOf("Continue with Apple"),
    );
    expect(html.indexOf("Continue with Apple")).toBeLessThan(
      html.indexOf("Continue with email"),
    );
    expect(html).toContain('href="/auth/google?next=%2Fsettings"');
    expect(html).toContain('href="/auth/sign-in/apple?next=%2Fsettings"');
    expect(html).toContain('href="/auth/sign-in/email?next=%2Fsettings"');
  });

  it("renders nothing when no method is enabled", () => {
    expect(
      renderToStaticMarkup(<SignInMethods methods={[]} nextPath="/" />),
    ).toBe("");
  });

  it("names no provider in a sign-in error", () => {
    for (const code of [
      "missing_auth_code",
      "auth_callback_failed",
      "oauth_start_failed",
      "sign_in_method_unavailable",
      "anything_else",
    ]) {
      expect(getAuthErrorMessage(code)).not.toMatch(/Google|Apple|OAuth/i);
    }
    expect(getAuthErrorMessage("sign_in_method_unavailable")).toBe(
      "That sign-in method is not available. Choose another.",
    );
  });

  it("renders the temporary-user interaction only when its local QA gate is enabled", async () => {
    stubConfiguredSupabase();
    vi.stubEnv("CADENCE_ENABLE_TEST_LOGIN", "1");

    const html = await renderLogin({ next: "/timeline" });

    expect(html).toContain("Continue as temporary test user");
    expect(html).toContain('href="/auth/test-login?next=%2Ftimeline"');
  });
});

async function renderLogin(searchParams: { next: string }) {
  return renderToStaticMarkup(
    await LoginPage({ searchParams: Promise.resolve(searchParams) }),
  );
}

function stubConfiguredSupabase() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key");
}
