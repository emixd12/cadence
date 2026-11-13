import { NextResponse, type NextRequest } from "next/server";

import {
  isSignInMethodId,
  REAUTH_REQUIRED_ERROR,
  SETTINGS_SIGN_IN_METHODS_PATH,
  SIGN_IN_METHODS_ANCHOR,
  signInMethodReturnPath,
  type SignInMethodResult,
} from "@/lib/auth/account-sign-in-methods";
import { crossSitePost } from "@/lib/auth/email-sign-in-server";
import { authRequestUrl, buildLoginPath } from "@/lib/auth/redirects";
import type { SignInMethodId } from "@/lib/auth/sign-in-methods";
import {
  changeSignInEmail,
  endSessionForRecentSignIn,
  removeSignInMethod,
  startAddSignInMethod,
} from "@/lib/services/sign-in-methods.service";

export const dynamic = "force-dynamic";

// Ticket 334: the Settings Sign-in methods forms post here. 303 so the browser
// follows with GET; the result rides in the query and the page shows it.

const RETURN_PATH = `${SETTINGS_SIGN_IN_METHODS_PATH}#${SIGN_IN_METHODS_ANCHOR}`;

async function backToSettings(requestUrl: URL, result: SignInMethodResult, methodId?: SignInMethodId) {
  if (result === "reauth_required") {
    await endSessionForRecentSignIn();
    return NextResponse.redirect(new URL(buildLoginPath(RETURN_PATH, REAUTH_REQUIRED_ERROR), requestUrl), 303);
  }
  return NextResponse.redirect(
    new URL(signInMethodReturnPath(RETURN_PATH, result, methodId), requestUrl),
    303,
  );
}

async function readForm(request: NextRequest): Promise<FormData | null> {
  try {
    return await request.formData();
  } catch {
    return null;
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ action: string }> },
) {
  if (crossSitePost(request)) return new NextResponse(null, { status: 403 });
  const requestUrl = authRequestUrl(request);
  const { action } = await params;
  const form = await readForm(request);

  if (action === "add") {
    const method = form?.get("method");
    if (!isSignInMethodId(method)) return backToSettings(requestUrl, "unavailable");
    const outcome = await startAddSignInMethod({
      origin: requestUrl,
      methodId: method,
      returnPath: RETURN_PATH,
    });
    if (outcome.kind === "redirect") return NextResponse.redirect(outcome.url, 303);
    return backToSettings(requestUrl, outcome.result, method);
  }

  if (action === "email") {
    const result = await changeSignInEmail({
      origin: requestUrl,
      email: form?.get("email"),
      returnPath: RETURN_PATH,
    });
    return backToSettings(requestUrl, result, "email");
  }

  if (action === "remove") {
    const { result, methodId } = await removeSignInMethod(form?.get("identity_id"));
    return backToSettings(requestUrl, result, methodId);
  }

  return new NextResponse(null, { status: 404 });
}
