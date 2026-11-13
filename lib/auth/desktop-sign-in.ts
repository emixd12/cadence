import { normalizeEmailAddress } from "@/lib/auth/email-sign-in";

// Ticket 336 (D31.2): the contract between Cadence for Mac and the hosted app for
// sign-in. Both sides import it, so the paths and the callback cannot drift apart.

/** Public list of the methods this deployment has on. */
export const SIGN_IN_METHODS_ROUTE = "/api/auth/sign-in-methods";
/** The page the Mac opens in the system browser to send the email code. */
export const DESKTOP_EMAIL_PAGE = "/login/email/mac";
/** Where that page sends the address and the bot-check token. */
export const DESKTOP_EMAIL_REQUEST_ROUTE = "/auth/email/mac";
/** Where the Mac hands over Apple's refresh token after an Apple sign-in. */
export const DESKTOP_APPLE_TOKEN_ROUTE = "/api/auth/apple-sign-in-token";

export const DESKTOP_AUTH_CALLBACK = "cadence://auth/callback";
/** Marks the callback that only brings the Mac forward after the code was sent. */
export const EMAIL_CODE_SENT_PARAM = "email_code";

const MAX_STATE_LENGTH = 128;

export type DesktopEmailFragment = Readonly<{ state: string; email: string }>;

/** The address and the flow state travel in the fragment, so no server or log sees them. */
export function desktopEmailPageUrl(origin: string, flow: DesktopEmailFragment): string {
  return `${origin}${DESKTOP_EMAIL_PAGE}#${new URLSearchParams({ state: flow.state, email: flow.email })}`;
}

export function parseDesktopEmailFragment(hash: string): DesktopEmailFragment | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const state = params.get("state") ?? "";
  const email = normalizeEmailAddress(params.get("email"));
  if (!email || !state || state.length > MAX_STATE_LENGTH || !/^[A-Za-z0-9-]+$/.test(state)) return null;
  return { state, email };
}

export function desktopEmailSentCallback(state: string): string {
  return `${DESKTOP_AUTH_CALLBACK}?${new URLSearchParams({ state, [EMAIL_CODE_SENT_PARAM]: "sent" })}`;
}
