import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import {
  decodePendingEmailSignIn,
  EMAIL_SIGN_IN_COOKIE,
  EMAIL_SIGN_IN_TTL_SECONDS,
  emailRequestErrorKey,
  emailSignInPagePath,
  encodePendingEmailSignIn,
  normalizeEmailAddress,
  normalizeEmailCode,
  TURNSTILE_RESPONSE_FIELD,
  type EmailSignInError,
  type PendingEmailSignIn,
} from "@/lib/auth/email-sign-in";
import {
  authRequestUrl,
  buildLoginPath,
  MISSING_CONFIG_ERROR,
  normalizeRedirectPath,
} from "@/lib/auth/redirects";
import {
  findEnabledSignInMethod,
  SIGN_IN_METHOD_UNAVAILABLE_ERROR,
  SIGN_IN_METHODS,
  type SignInMethod,
} from "@/lib/auth/sign-in-methods";
import { reportMonitoringEvent } from "@/lib/monitoring/privacy-safe-events";
import { DEFAULT_APP_ROUTE } from "@/lib/navigation";
import { readSupabaseRuntimeConfig } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

// Ticket 332 (D31.2): request, code and link handlers for email sign-in.
// Responses to form posts use 303 so the browser follows with GET.

const SEE_OTHER = 303;

function seeOther(path: string, requestUrl: URL) {
  return NextResponse.redirect(new URL(path, requestUrl), SEE_OTHER);
}

/**
 * Refuses a form post that another site sent. Without it, a page elsewhere could
 * post its own token hash to /auth/confirm and sign a visitor in to the wrong
 * account (login CSRF). Current browsers send Sec-Fetch-Site, which is decisive.
 * Older ones send only Origin, which must then be this site. A request with neither
 * is not from a browser form. Origin alone is not enough: a page with a
 * no-referrer policy posts `Origin: null` even to its own site.
 */
export function crossSitePost(request: { url: string; headers: Headers }): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite) return fetchSite !== "same-origin";
  const origin = request.headers.get("origin");
  return origin !== null && origin !== authRequestUrl(request).origin;
}

function forbidden() {
  return new NextResponse(null, { status: 403 });
}

function emailEnabled(methods: readonly SignInMethod[]) {
  return findEnabledSignInMethod("email", process.env, methods)?.start?.kind === "email";
}

async function readPending(): Promise<PendingEmailSignIn | null> {
  const store = await cookies();
  return decodePendingEmailSignIn(store.get(EMAIL_SIGN_IN_COOKIE)?.value);
}

async function writePending(pending: PendingEmailSignIn) {
  const store = await cookies();
  store.set(EMAIL_SIGN_IN_COOKIE, encodePendingEmailSignIn(pending), {
    httpOnly: true,
    maxAge: EMAIL_SIGN_IN_TTL_SECONDS,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

async function clearPending() {
  const store = await cookies();
  store.set(EMAIL_SIGN_IN_COOKIE, "", { maxAge: 0, path: "/" });
}

function formText(form: FormData, name: string): string | null {
  const value = form.get(name);
  return typeof value === "string" ? value : null;
}

async function readForm(request: NextRequest): Promise<FormData | null> {
  try {
    return await request.formData();
  } catch {
    return null;
  }
}

/**
 * POST /auth/sign-in/email: sends one email with a link and a code. A new address
 * creates the account. `resend=1` reuses the address from the pending cookie.
 */
export async function requestEmailSignIn(
  request: NextRequest,
  methods: readonly SignInMethod[] = SIGN_IN_METHODS,
): Promise<NextResponse> {
  const requestUrl = authRequestUrl(request);
  const form = await readForm(request);
  const formNext = form ? formText(form, "next") : null;

  if (!emailEnabled(methods)) {
    return seeOther(
      buildLoginPath(normalizeRedirectPath(formNext, DEFAULT_APP_ROUTE), SIGN_IN_METHOD_UNAVAILABLE_ERROR),
      requestUrl,
    );
  }
  if (crossSitePost(request)) return forbidden();

  const pending = await readPending();
  const resend = form ? formText(form, "resend") === "1" : false;
  const nextPath = normalizeRedirectPath(formNext ?? pending?.next, DEFAULT_APP_ROUTE);
  const back = (error: EmailSignInError, extra: Record<string, string> = {}) =>
    seeOther(emailSignInPagePath(nextPath, { error, ...extra }), requestUrl);

  const config = readSupabaseRuntimeConfig();
  if (!config) {
    return seeOther(buildLoginPath(nextPath, MISSING_CONFIG_ERROR), requestUrl);
  }

  if (!form) return back("email_invalid");

  const email = resend
    ? pending?.email ?? null
    : normalizeEmailAddress(formText(form, "email"));
  if (!email) return back(resend ? "email_missing" : "email_invalid");

  const captchaToken = formText(form, TURNSTILE_RESPONSE_FIELD)?.trim() || undefined;

  // A plain client: no session to keep, and no PKCE verifier, so the emailed link
  // and code work in any browser.
  const supabase = createSupabaseClient(config.url, config.publishableKey, {
    auth: { autoRefreshToken: false, flowType: "implicit", persistSession: false },
  });
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { captchaToken, shouldCreateUser: true },
  });

  if (error) {
    const key = emailRequestErrorKey(error);
    reportMonitoringEvent({
      name: "auth_email_request_failed",
      severity: key === "email_send_failed" ? "error" : "warning",
      context: { route: "/auth/sign-in/email", method: "POST", reason: key },
    });
    if (key === "email_rate_limited") {
      await writePending({ email, next: nextPath });
      return back(key, { sent: "1" });
    }
    return back(key);
  }

  await writePending({ email, next: nextPath });
  return seeOther(emailSignInPagePath(nextPath, { sent: "1" }), requestUrl);
}

/** POST /auth/email/verify: the code from the email signs the person in. */
export async function verifyEmailCode(
  request: NextRequest,
  methods: readonly SignInMethod[] = SIGN_IN_METHODS,
): Promise<NextResponse> {
  const requestUrl = authRequestUrl(request);
  if (!emailEnabled(methods)) {
    return seeOther(buildLoginPath(undefined, SIGN_IN_METHOD_UNAVAILABLE_ERROR), requestUrl);
  }
  if (crossSitePost(request)) return forbidden();

  const form = await readForm(request);
  const pending = await readPending();
  const nextPath = pending?.next ?? DEFAULT_APP_ROUTE;

  if (!pending) {
    return seeOther(emailSignInPagePath(nextPath, { error: "email_missing" }), requestUrl);
  }

  const token = form ? normalizeEmailCode(formText(form, "code")) : null;
  if (!token) {
    return seeOther(emailSignInPagePath(nextPath, { error: "code_invalid", sent: "1" }), requestUrl);
  }

  if (!readSupabaseRuntimeConfig()) {
    return seeOther(buildLoginPath(nextPath, MISSING_CONFIG_ERROR), requestUrl);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    email: pending.email,
    token,
    type: "email",
  });

  if (error) {
    reportMonitoringEvent({
      name: "auth_email_code_rejected",
      severity: "warning",
      context: { route: "/auth/email/verify", method: "POST" },
    });
    return seeOther(emailSignInPagePath(nextPath, { error: "code_rejected", sent: "1" }), requestUrl);
  }

  await clearPending();
  return seeOther(nextPath, requestUrl);
}

/**
 * POST /auth/confirm: the emailed link opens `/login/confirm`, whose button posts
 * the token hash here. Verifying on a post keeps mail scanners, which follow
 * links, from using up the link. Works in any browser: nothing from the request
 * is needed.
 */
export async function confirmEmailLink(
  request: NextRequest,
  methods: readonly SignInMethod[] = SIGN_IN_METHODS,
): Promise<NextResponse> {
  const requestUrl = authRequestUrl(request);
  if (!emailEnabled(methods)) {
    return seeOther(buildLoginPath(undefined, SIGN_IN_METHOD_UNAVAILABLE_ERROR), requestUrl);
  }
  if (crossSitePost(request)) return forbidden();

  const form = await readForm(request);
  const pending = await readPending();
  const nextPath = pending?.next ?? DEFAULT_APP_ROUTE;
  const tokenHash = form ? formText(form, "token_hash")?.trim() : null;

  if (!tokenHash) {
    return seeOther(emailSignInPagePath(nextPath, { error: "link_rejected" }), requestUrl);
  }

  if (!readSupabaseRuntimeConfig()) {
    return seeOther(buildLoginPath(nextPath, MISSING_CONFIG_ERROR), requestUrl);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: "email",
  });

  if (error) {
    reportMonitoringEvent({
      name: "auth_email_link_rejected",
      severity: "warning",
      context: { route: "/auth/confirm", method: "POST" },
    });
    return seeOther(emailSignInPagePath(nextPath, { error: "link_rejected" }), requestUrl);
  }

  await clearPending();
  return seeOther(nextPath, requestUrl);
}
