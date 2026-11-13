import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  decodePendingEmailSignIn,
  EMAIL_CODE_VERIFY_ROUTE,
  EMAIL_SIGN_IN_CODE_LENGTH,
  EMAIL_SIGN_IN_COOKIE,
  EMAIL_SIGN_IN_REQUEST_ROUTE,
  emailSignInErrorMessage,
  emailSignInPagePath,
  turnstileSiteKey,
} from "@/lib/auth/email-sign-in";
import { buildLoginPath, normalizeRedirectPath } from "@/lib/auth/redirects";
import {
  findEnabledSignInMethod,
  SIGN_IN_METHOD_UNAVAILABLE_ERROR,
} from "@/lib/auth/sign-in-methods";
import { DEFAULT_APP_ROUTE } from "@/lib/navigation";
import { AuthPageShell } from "../AuthPageShell";
import { EmailCodeStep, EmailAddressStep } from "./EmailSignInSteps";

export const metadata: Metadata = {
  title: "Sign in with email",
};

type EmailSignInPageProps = Readonly<{
  searchParams: Promise<{
    change?: string | string[];
    error?: string | string[];
    next?: string | string[];
    sent?: string | string[];
  }>;
}>;

// Ticket 332 (D31.2): the address step, then the code step.
export default async function EmailSignInPage({
  searchParams,
}: EmailSignInPageProps) {
  const params = await searchParams;
  const nextPath = normalizeRedirectPath(params.next, DEFAULT_APP_ROUTE);

  if (findEnabledSignInMethod("email")?.start?.kind !== "email") {
    redirect(buildLoginPath(nextPath, SIGN_IN_METHOD_UNAVAILABLE_ERROR));
  }

  const pending = decodePendingEmailSignIn(
    (await cookies()).get(EMAIL_SIGN_IN_COOKIE)?.value,
  );
  const showCode = Boolean(pending) && params.sent === "1" && params.change !== "1";

  return (
    <AuthPageShell>
      {showCode && pending ? (
        <EmailCodeStep
          codeLength={EMAIL_SIGN_IN_CODE_LENGTH}
          email={pending.email}
          errorMessage={emailSignInErrorMessage(params.error)}
          changeHref={emailSignInPagePath(nextPath, { change: "1" })}
          nextPath={nextPath}
          requestAction={EMAIL_SIGN_IN_REQUEST_ROUTE}
          turnstileSiteKey={turnstileSiteKey()}
          verifyAction={EMAIL_CODE_VERIFY_ROUTE}
        />
      ) : (
        <EmailAddressStep
          codeLength={EMAIL_SIGN_IN_CODE_LENGTH}
          defaultEmail={pending?.email ?? ""}
          errorMessage={emailSignInErrorMessage(params.error)}
          loginHref={buildLoginPath(nextPath)}
          nextPath={nextPath}
          requestAction={EMAIL_SIGN_IN_REQUEST_ROUTE}
          turnstileSiteKey={turnstileSiteKey()}
        />
      )}
    </AuthPageShell>
  );
}
