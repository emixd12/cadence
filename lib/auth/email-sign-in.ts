import { normalizeRedirectPath } from "@/lib/auth/redirects";
import { DEFAULT_APP_ROUTE } from "@/lib/navigation";

// Ticket 332 (D31.2): email sign-in with a link or a code, no password.

/**
 * The one code-length setting. It must equal `otp_length` in
 * `supabase/config.toml` and the hosted Auth setting. D31 says 6; hosted Auth
 * sends 8 today. The owner decides (docs/qa/2026-11-13-ticket-332-hosted-auth-changes.md).
 */
export const EMAIL_SIGN_IN_CODE_LENGTH = 6;

/** Matches `otp_expiry` (3600 s) locally and on hosted Auth. */
export const EMAIL_SIGN_IN_TTL_SECONDS = 3600;

export const EMAIL_SIGN_IN_PAGE = "/login/email";
export const EMAIL_SIGN_IN_REQUEST_ROUTE = "/auth/sign-in/email";
export const EMAIL_CODE_VERIFY_ROUTE = "/auth/email/verify";
export const EMAIL_LINK_CONFIRM_ROUTE = "/auth/confirm";

/** Holds the address and return path between the request and the code entry. */
export const EMAIL_SIGN_IN_COOKIE = "cadence_email_sign_in";

/** Form field that Cloudflare Turnstile fills inside a form. */
export const TURNSTILE_RESPONSE_FIELD = "cf-turnstile-response";

const MAX_EMAIL_LENGTH = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export type PendingEmailSignIn = Readonly<{ email: string; next: string }>;

export type EmailSignInError =
  | "email_invalid"
  | "email_rate_limited"
  | "email_check_failed"
  | "email_unavailable"
  | "email_send_failed"
  | "code_invalid"
  | "code_rejected"
  | "link_rejected"
  | "email_missing";

const MESSAGES: Record<EmailSignInError, string> = {
  email_invalid: "Enter an email address, like name@example.com.",
  email_rate_limited:
    "Cadence sent an email to this address a moment ago. Wait a minute, then send another.",
  email_check_failed: "The check that you are a person did not finish. Try again.",
  email_unavailable: "Email sign-in is not available right now. Choose another way to sign in.",
  email_send_failed: "The email could not be sent. Try again.",
  code_invalid: `Enter the ${EMAIL_SIGN_IN_CODE_LENGTH}-digit code from the email.`,
  code_rejected:
    "That code did not work. It may be mistyped, used or more than an hour old. Check it, or send a new email.",
  link_rejected:
    "That sign-in link was already used or is more than an hour old. Send a new email.",
  email_missing: "Enter your email address again to get a new email.",
};

export function emailSignInErrorMessage(
  value: string | string[] | null | undefined,
): string | null {
  const error = Array.isArray(value) ? value[0] : value;
  if (!error || !Object.hasOwn(MESSAGES, error)) return null;
  return MESSAGES[error as EmailSignInError];
}

export function normalizeEmailAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) return null;
  return email;
}

/** Accepts the code with spaces or a hyphen, as people copy it. */
export function normalizeEmailCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.replace(/[\s-]/g, "");
  return new RegExp(`^\\d{${EMAIL_SIGN_IN_CODE_LENGTH}}$`).test(code) ? code : null;
}

/**
 * Maps a Supabase Auth error from the email request to a message key. Codes from
 * Supabase Auth's error-code list; anything unknown is a send failure.
 */
export function emailRequestErrorKey(
  error: { code?: string; status?: number } | null | undefined,
): EmailSignInError {
  switch (error?.code) {
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return "email_rate_limited";
    case "captcha_failed":
      return "email_check_failed";
    case "email_address_invalid":
    case "validation_failed":
      return "email_invalid";
    case "signup_disabled":
    case "email_provider_disabled":
    case "otp_disabled":
      return "email_unavailable";
    default:
      return error?.status === 429 ? "email_rate_limited" : "email_send_failed";
  }
}

export function encodePendingEmailSignIn(pending: PendingEmailSignIn): string {
  return Buffer.from(JSON.stringify(pending), "utf8").toString("base64url");
}

export function decodePendingEmailSignIn(
  value: string | null | undefined,
): PendingEmailSignIn | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    );
    if (!parsed || typeof parsed !== "object") return null;
    const { email, next } = parsed as Record<string, unknown>;
    const normalized = normalizeEmailAddress(email);
    if (!normalized) return null;
    return {
      email: normalized,
      next: normalizeRedirectPath(
        typeof next === "string" ? next : null,
        DEFAULT_APP_ROUTE,
      ),
    };
  } catch {
    return null;
  }
}

export function emailSignInPagePath(
  nextPath: string,
  params: Readonly<Record<string, string>> = {},
): string {
  const search = new URLSearchParams({ next: nextPath, ...params });
  return `${EMAIL_SIGN_IN_PAGE}?${search.toString()}`;
}

/** Turnstile site key; unset means no bot check is shown or sent. */
export function turnstileSiteKey(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  const key = env.CADENCE_TURNSTILE_SITE_KEY?.trim();
  return key ? key : null;
}
