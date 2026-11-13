
import {
  appleIdentityOfThisSignIn,
  appleSubject,
} from "@/lib/auth/apple-sign-in";
import {
  EMAIL_SIGN_IN_CODE_LENGTH,
  emailRequestErrorKey,
  emailSignInErrorMessage,
  normalizeEmailAddress,
  type EmailSignInError,
} from "@/lib/auth/email-sign-in";
import { crossSitePost, sendEmailSignIn } from "@/lib/auth/email-sign-in-server";
import {
  enabledSignInMethods,
  findEnabledSignInMethod,
  SIGN_IN_METHODS,
  type SignInEnv,
  type SignInMethod,
} from "@/lib/auth/sign-in-methods";
import { reportMonitoringEvent } from "@/lib/monitoring/privacy-safe-events";
import { readSupabaseRuntimeConfig } from "@/lib/supabase/env";
import { keepAppleRefreshToken } from "./apple-sign-in.service";
import { authenticateCalendarRequest, calendarResponse } from "./google-calendar-request";

// Ticket 336 (D31.2): the hosted side of sign-in in Cadence for Mac. The Mac reads the
// enabled methods from here, so it never offers a method that this deployment has off.

export type ClientSignInMethods = Readonly<{
  methods: readonly Readonly<{ id: SignInMethod["id"]; label: string }>[];
  emailCodeLength: number;
}>;

export function clientSignInMethods(
  env: SignInEnv = process.env,
  methods: readonly SignInMethod[] = SIGN_IN_METHODS,
): ClientSignInMethods {
  return {
    methods: enabledSignInMethods(env, methods).map(({ id, label }) => ({ id, label })),
    emailCodeLength: EMAIL_SIGN_IN_CODE_LENGTH,
  };
}

const JSON_HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: JSON_HEADERS });
}

async function readSmallJson(request: Request, maxBytes: number): Promise<Record<string, unknown> | null> {
  try {
    const text = await request.text();
    if (text.length > maxBytes) return null;
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export type DesktopEmailCodeResult =
  | { ok: true }
  | { ok: false; error: EmailSignInError | "sign_in_method_unavailable"; message: string };

function failure(error: EmailSignInError): DesktopEmailCodeResult {
  return { ok: false, error, message: emailSignInErrorMessage(error) ?? "" };
}

/**
 * POST /auth/email/mac: the page that Cadence for Mac opens in the system browser
 * sends the address here with the Turnstile token. The page runs on Cadence's own
 * site, so the bot check works as it does on the web, and no secret reaches the Mac.
 * The Mac then verifies the code itself.
 */
export async function requestDesktopEmailCode(
  request: Request,
  methods: readonly SignInMethod[] = SIGN_IN_METHODS,
): Promise<Response> {
  if (findEnabledSignInMethod("email", process.env, methods)?.start?.kind !== "email") {
    return json({ ok: false, error: "sign_in_method_unavailable", message: "Email sign-in is not available right now." }, 404);
  }
  if (crossSitePost(request)) return new Response(null, { status: 403 });

  const body = await readSmallJson(request, 8192);
  const email = normalizeEmailAddress(body?.email);
  if (!email) return json(failure("email_invalid"), 400);
  const captchaToken = typeof body?.captchaToken === "string" && body.captchaToken.trim()
    ? body.captchaToken.trim()
    : undefined;

  const config = readSupabaseRuntimeConfig();
  if (!config) return json(failure("email_unavailable"), 503);

  // The Mac verifies the code with its own client, from the person's own address.
  const { error } = await sendEmailSignIn({ request, config, email, captchaToken });
  if (error) {
    const key = emailRequestErrorKey(error);
    reportMonitoringEvent({
      name: "auth_email_request_failed",
      severity: key === "email_send_failed" ? "error" : "warning",
      context: { route: "/auth/email/mac", method: "POST", reason: key },
    });
    return json(failure(key), key === "email_rate_limited" ? 429 : 400);
  }
  return json({ ok: true } satisfies DesktopEmailCodeResult);
}

/**
 * POST /api/auth/apple-sign-in-token: after an Apple sign-in, the Mac hands Apple's
 * refresh token to Cadence's server, which seals it for revocation on account
 * deletion (Ticket 333, L-025). The Mac keeps no copy.
 */
export async function keepDesktopAppleToken(request: Request): Promise<Response> {
  let caller;
  try {
    caller = await authenticateCalendarRequest(request);
  } catch {
    return calendarResponse(request, { error: "unauthenticated" }, 401);
  }
  const body = await readSmallJson(request, 20_000);
  const refreshToken = typeof body?.refreshToken === "string" ? body.refreshToken : "";
  const identity = appleIdentityOfThisSignIn(caller.user);
  const subject = identity ? appleSubject(identity) : null;
  if (!refreshToken || !subject) return calendarResponse(request, { result: "invalid" }, 400);

  const result = await keepAppleRefreshToken({ userId: caller.user.id, subject, refreshToken });
  if (result !== "kept") {
    reportMonitoringEvent({
      name: "apple_sign_in_token_not_kept",
      severity: "warning",
      context: { route: "/api/auth/apple-sign-in-token", method: "POST", result },
    });
  }
  return calendarResponse(request, { result }, result === "kept" ? 200 : result === "invalid" ? 400 : 503);
}
