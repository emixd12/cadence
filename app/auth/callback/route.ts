import { NextResponse, type NextRequest } from "next/server";
import type { Session, User } from "@supabase/supabase-js";
import {
  APPLE_CALLBACK_PARAM,
  APPLE_CALLBACK_VALUE,
  appleCallbackErrorCode,
  appleIdentityOfThisSignIn,
  appleSubject,
} from "@/lib/auth/apple-sign-in";
import {
  isSignInMethodId,
  LINK_CALLBACK_PARAM,
  linkCallbackResult,
  signInMethodReturnPath,
} from "@/lib/auth/account-sign-in-methods";
import {
  authRequestUrl,
  buildLoginPath,
  MISSING_CONFIG_ERROR,
  normalizeRedirectPath,
} from "@/lib/auth/redirects";
import {
  reportMonitoringError,
  reportMonitoringEvent,
} from "@/lib/monitoring/privacy-safe-events";
import { keepAppleRefreshToken } from "@/lib/services/apple-sign-in.service";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const requestUrl = authRequestUrl(request);
  const callbackError = requestUrl.searchParams.get("error");
  const code = requestUrl.searchParams.get("code");
  const nextPath = normalizeRedirectPath(requestUrl.searchParams.get("next"));
  const viaApple =
    requestUrl.searchParams.get(APPLE_CALLBACK_PARAM) === APPLE_CALLBACK_VALUE;
  const link = requestUrl.searchParams.get(LINK_CALLBACK_PARAM);

  if (isSignInMethodId(link)) {
    return finishLink(requestUrl, link, nextPath);
  }

  if (callbackError) {
    reportMonitoringEvent({
      name: "auth_callback_provider_error",
      severity: "warning",
      context: routeContext(),
    });
    const loginError = viaApple
      ? appleCallbackErrorCode(requestUrl.searchParams.get("error_description"))
      : "auth_callback_failed";
    return NextResponse.redirect(
      new URL(buildLoginPath(nextPath, loginError), requestUrl),
    );
  }

  if (!code) {
    reportMonitoringEvent({
      name: "auth_callback_missing_code",
      severity: "warning",
      context: routeContext(),
    });
    return NextResponse.redirect(
      new URL(buildLoginPath(nextPath, "missing_auth_code"), requestUrl),
    );
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      reportMonitoringEvent({
        name: "auth_callback_exchange_failed",
        severity: "warning",
        context: routeContext(),
      });
      return NextResponse.redirect(
        new URL(buildLoginPath(nextPath, "auth_callback_failed"), requestUrl),
      );
    }

    if (viaApple) await keepAppleToken(data.session, data.user);
  } catch (error) {
    reportMonitoringError("auth_callback_config_failed", error, routeContext());
    return NextResponse.redirect(
      new URL(buildLoginPath(nextPath, MISSING_CONFIG_ERROR), requestUrl),
    );
  }

  return NextResponse.redirect(new URL(nextPath, requestUrl));
}

// Ticket 333 (L-025): keep Apple's refresh token for revocation on account
// deletion. A failure here never blocks the sign-in.
async function keepAppleToken(session: Session | null, user: User | null) {
  const identity = user ? appleIdentityOfThisSignIn(user) : null;
  const subject = identity ? appleSubject(identity) : null;
  const refreshToken = session?.provider_refresh_token;

  if (!user || !subject) return;
  if (!refreshToken) {
    reportMonitoringEvent({
      name: "apple_sign_in_token_missing",
      severity: "warning",
      context: routeContext(),
    });
    return;
  }

  try {
    const result = await keepAppleRefreshToken({
      userId: user.id,
      subject,
      refreshToken,
    });
    if (result !== "kept") {
      reportMonitoringEvent({
        name: "apple_sign_in_token_not_kept",
        severity: "warning",
        context: { ...routeContext(), result },
      });
    }
  } catch (error) {
    reportMonitoringError("apple_sign_in_token_store_failed", error, routeContext());
  }
}

// Ticket 334: a return from adding a sign-in method or confirming a new address
// goes back to `next` with the result, never to the login page. A refusal from
// Supabase Auth (`identity_already_exists`) names no account.
async function finishLink(
  requestUrl: URL,
  link: Parameters<typeof linkCallbackResult>[0]["link"],
  nextPath: string,
) {
  const params = requestUrl.searchParams;
  const error = params.get("error");
  const errorCode = params.get("error_code");
  const code = params.get("code");
  let exchanged: boolean | null = null;

  if (!error && !errorCode && code) {
    try {
      const supabase = await createClient();
      const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
      exchanged = !exchangeError;
      // Ticket 333 (L-025): an Apple account added here keeps its token for revocation too.
      if (exchanged && link === "apple") await keepAppleToken(data.session, data.user);
    } catch {
      exchanged = false;
    }
  }

  const result = linkCallbackResult({ link, error, errorCode, code, exchanged });
  if (result !== "added" && result !== "email_confirmed" && result !== "email_confirm_other") {
    reportMonitoringEvent({
      name: "auth_link_callback_refused",
      severity: "warning",
      context: { ...routeContext(), reason: result },
    });
  }
  return NextResponse.redirect(
    new URL(signInMethodReturnPath(nextPath, result, link), requestUrl),
  );
}

function routeContext() {
  return {
    route: "/auth/callback",
    method: "GET",
  };
}
