import type { Metadata } from "next";

import {
  EMAIL_SIGN_IN_CODE_LENGTH,
  turnstileSiteKey,
} from "@/lib/auth/email-sign-in";
import { findEnabledSignInMethod } from "@/lib/auth/sign-in-methods";
import { AuthPageShell } from "../../AuthPageShell";
import { MacEmailCodeRequest } from "./MacEmailCodeRequest";

export const metadata: Metadata = {
  title: "Sign in to Cadence for Mac",
  referrer: "no-referrer",
};

// Ticket 336: Cadence for Mac opens this page to send the email code. The address
// arrives in the URL fragment, which never reaches the server.
export default function MacEmailCodePage() {
  const enabled = findEnabledSignInMethod("email")?.start?.kind === "email";
  return (
    <AuthPageShell>
      {enabled ? (
        <MacEmailCodeRequest
          codeLength={EMAIL_SIGN_IN_CODE_LENGTH}
          turnstileSiteKey={turnstileSiteKey()}
        />
      ) : (
        <p role="alert" className="mt-6 text-sm leading-6 text-accent">
          Email sign-in is not available right now. Choose another way to sign in
          in Cadence for Mac.
        </p>
      )}
    </AuthPageShell>
  );
}
