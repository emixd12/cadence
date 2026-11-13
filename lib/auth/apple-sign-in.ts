import type { User, UserIdentity } from "@supabase/supabase-js";

// Ticket 333 (D31.2): Apple-specific rules for the shared OAuth callback.
// Supabase Auth talks to Apple; Cadence sees only the session and the user.

/** The Apple start adds `via=apple` to the callback URL; Google's stays unchanged. */
export const APPLE_CALLBACK_PARAM = "via";
export const APPLE_CALLBACK_VALUE = "apple";

export const APPLE_EMAIL_MISSING_ERROR = "apple_email_missing";

/** Hide My Email addresses end in this domain. */
export const APPLE_RELAY_DOMAIN = "privaterelay.appleid.com";

export function isAppleRelayAddress(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.trim().toLowerCase().endsWith(`@${APPLE_RELAY_DOMAIN}`);
}

/**
 * Supabase Auth refuses a provider sign-in that carries no email address and
 * redirects with an `error_description` that names the email. Every other
 * provider error keeps the generic message.
 */
export function appleCallbackErrorCode(description: string | null): string {
  return description && /\bemail\b/i.test(description)
    ? APPLE_EMAIL_MISSING_ERROR
    : "auth_callback_failed";
}

/**
 * The Apple identity this sign-in used, or null. `via=apple` comes from the
 * browser, so the Apple identity must also be the one signed in most recently.
 */
export function appleIdentityOfThisSignIn(
  user: Pick<User, "identities">,
): UserIdentity | null {
  const identities = user.identities ?? [];
  const apple = identities.find((identity) => identity.provider === "apple");
  const appleAt = Date.parse(apple?.last_sign_in_at ?? "");
  if (!apple || Number.isNaN(appleAt)) return null;

  const newest = Math.max(
    ...identities.map((identity) => Date.parse(identity.last_sign_in_at ?? "") || 0),
  );
  return appleAt >= newest ? apple : null;
}

/** Apple's stable user id (`sub`) for the identity. */
export function appleSubject(identity: UserIdentity): string | null {
  const sub = identity.identity_data?.sub;
  if (typeof sub === "string" && sub.length > 0) return sub;
  return identity.id || null;
}
