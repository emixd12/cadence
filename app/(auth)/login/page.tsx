import type { Metadata } from "next";
import Image from "next/image";
import {
  getAuthErrorMessage,
  normalizeRedirectPath,
} from "@/lib/auth/redirects";
import { MARKETING_SITE_URL } from "@/lib/marketing-site";
import { enabledSignInMethods } from "@/lib/auth/sign-in-methods";
import { DEFAULT_APP_ROUTE } from "@/lib/navigation";
import { readSupabaseRuntimeConfig } from "@/lib/supabase/env";
import { shouldShowTestLogin } from "@/lib/auth/test-login";
import { AccountDeletedNotice } from "./AccountDeletedNotice";
import { SignedOutNotice } from "./SignedOutNotice";
import { SignInMethods } from "./SignInMethods";

export const metadata: Metadata = {
  title: "Sign in",
};

type LoginPageProps = Readonly<{
  searchParams: Promise<{
    account_deleted?: string | string[];
    error?: string | string[];
    next?: string | string[];
    signedout?: string | string[];
  }>;
}>;

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const nextPath = normalizeRedirectPath(params.next, DEFAULT_APP_ROUTE);
  const authErrorMessage = getAuthErrorMessage(params.error);
  const accountDeleted = params.account_deleted === "1";
  const signedOut = !accountDeleted && params.signedout === "1";
  const isConfigured = readSupabaseRuntimeConfig() !== null;
  const testLoginEnabled = shouldShowTestLogin();

  return (
    <main className="min-h-dvh bg-background px-6 pb-16 pt-[22dvh] text-foreground">
      <section className="mx-auto w-full max-w-[22rem]">
        <h1 className="flex items-center gap-3 text-5xl leading-none">
          <Image
            src="/brand/cadence-logo.png"
            alt=""
            aria-hidden="true"
            width={48}
            height={48}
            className="h-12 w-12 shrink-0 object-contain"
            priority
          />
          <span>Cadence</span>
        </h1>

        <p className="mt-3 text-lg leading-6 text-muted-readable">
          Decide your days. Own every record.
        </p>

        {authErrorMessage || accountDeleted || signedOut || !isConfigured ? (
          <div className="mt-6 grid gap-4 [&>p]:max-w-none">
            {authErrorMessage ? (
              <p className="text-sm leading-6 text-accent">
                {authErrorMessage}
              </p>
            ) : null}

            {accountDeleted ? <AccountDeletedNotice /> : null}
            {signedOut ? <SignedOutNotice /> : null}

            {!isConfigured ? (
              <p className="text-sm leading-6 text-accent">
                Add Supabase runtime values before signing in locally.
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="mt-6">
          <SignInMethods
            disabled={!isConfigured}
            methods={enabledSignInMethods()}
            nextPath={nextPath}
          />
        </div>

        <p className="mt-6 text-[0.8rem] leading-5 text-muted-readable">
          By continuing you agree to the{" "}
          <a className="text-link" href="/terms">
            Terms
          </a>{" "}
          and acknowledge the{" "}
          <a className="text-link" href="/privacy">
            Privacy Policy
          </a>
          .
        </p>

        <div className="mt-10 border-t border-line pt-6">
          <ul className="grid list-none gap-2 text-sm leading-6 text-muted-readable">
            <li>
              <span className="text-foreground">Single-player and private.</span>{" "}
              No feed, no sharing, no coaching layer.
            </li>
            <li>
              <span className="text-foreground">Yours to take.</span> Export
              everything as plain files, anytime.
            </li>
          </ul>
        </div>

        <nav
          aria-label="Public product information"
          className="mt-8 flex flex-wrap items-center gap-x-6 text-sm leading-5 text-foreground"
        >
          <a
            className="text-link inline-flex min-h-10 items-center py-1"
            href="/trust"
          >
            Trust
          </a>
          <a
            className="text-link inline-flex min-h-10 items-center py-1"
            href={MARKETING_SITE_URL}
          >
            How Cadence works →
          </a>
        </nav>

        {testLoginEnabled ? (
          <div className="mt-4 grid gap-1 text-sm leading-6 text-foreground">
            <p>Local QA only.</p>
            <a
              href={`/auth/test-login?next=${encodeURIComponent(nextPath)}`}
              className="product-action product-action-primary min-h-10 justify-self-start py-2"
            >
              Continue as temporary test user
            </a>
          </div>
        ) : null}
      </section>
    </main>
  );
}
