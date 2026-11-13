import type { Metadata } from "next";
import { redirect } from "next/navigation";

import {
  EMAIL_LINK_CONFIRM_ROUTE,
  emailSignInPagePath,
} from "@/lib/auth/email-sign-in";
import { buildLoginPath } from "@/lib/auth/redirects";
import {
  findEnabledSignInMethod,
  SIGN_IN_METHOD_UNAVAILABLE_ERROR,
} from "@/lib/auth/sign-in-methods";
import { DEFAULT_APP_ROUTE } from "@/lib/navigation";
import { AuthPageShell } from "../AuthPageShell";

export const metadata: Metadata = {
  title: "Sign in",
  referrer: "no-referrer",
};

type ConfirmPageProps = Readonly<{
  searchParams: Promise<{ token_hash?: string | string[] }>;
}>;

// Ticket 332: the emailed link opens this page. The button posts the token, so a
// mail scanner that follows the link does not use it up. Works in any browser.
export default async function ConfirmEmailLinkPage({
  searchParams,
}: ConfirmPageProps) {
  const params = await searchParams;
  const tokenHash = Array.isArray(params.token_hash)
    ? params.token_hash[0]
    : params.token_hash;

  if (findEnabledSignInMethod("email")?.start?.kind !== "email") {
    redirect(buildLoginPath(undefined, SIGN_IN_METHOD_UNAVAILABLE_ERROR));
  }

  if (!tokenHash) {
    redirect(emailSignInPagePath(DEFAULT_APP_ROUTE, { error: "link_rejected" }));
  }

  return (
    <AuthPageShell>
      <p className="mt-3 text-lg leading-6 text-muted-readable">
        Sign in from your email.
      </p>
      <form method="post" action={EMAIL_LINK_CONFIRM_ROUTE} className="mt-6">
        <input type="hidden" name="token_hash" value={tokenHash} />
        <button
          type="submit"
          autoFocus
          className="product-action product-action-primary min-h-11 py-2 text-base font-bold"
        >
          Sign in
        </button>
      </form>
    </AuthPageShell>
  );
}
