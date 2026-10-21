"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { submitOAuthConsent } from "@/lib/services/oauth-ui.service";
import { pendingCookieName } from "@/lib/services/oauth/server";
import { oauthConfig } from "@/lib/services/oauth/protocol";
import type { OAuthActionState } from "@/lib/types/oauth-ui";

export async function consentAction(_previous: OAuthActionState, form: FormData): Promise<OAuthActionState> {
  let result: Awaited<ReturnType<typeof submitOAuthConsent>>;
  try {
    result = await submitOAuthConsent(form);
  } catch {
    return { status: "error", message: "This connection request could not be completed. Start again from the app you want to connect." };
  }
  (await cookies()).set(pendingCookieName(result.requestId), "", {
    path: "/oauth", httpOnly: true, sameSite: "lax", maxAge: 0, secure: oauthConfig().issuer.startsWith("https:"),
  });
  redirect(result.location);
}
