import type { OAuthActivityEntry, OAuthGrantSummary, OAuthScope } from "@/lib/db/oauth.repo";

export const OAUTH_PERMISSION_LABELS: Record<OAuthScope, string> = {
  "cadence.read": "Read tracking data",
  "cadence.occurrences.write": "Change Occurrence statuses and notes",
  "cadence.behaviors.write": "Create, edit, archive, and restore Behaviors",
};

/**
 * Referrer policy of the consent page, sent as a header and as a meta tag (Ticket 379).
 * The page URL carries the request ID, so nothing may reach another origin: not the
 * client's logo host and not the client's redirect target. It must not be
 * "no-referrer": under that policy a browser sends `Origin: null` on a plain form
 * post, even to its own site. Allow or Deny pressed before the page hydrates is such
 * a post, and the same-origin check refuses it.
 */
export const CONSENT_REFERRER_POLICY = "same-origin";

export type OAuthActionState = { status: "idle" | "error" | "success"; message: string };
export type OAuthFormAction = (state: OAuthActionState, form: FormData) => Promise<OAuthActionState>;
export type ConsentView = {
  requestId: string;
  accountId: string;
  email: string;
  clientName: string;
  logoUri: string | null;
  verified: boolean;
  redirectHost: string;
  /** Every advertised scope, in canonical order (Ticket 259), whatever the client requested. */
  scopes: OAuthScope[];
  /** Scopes the caller already granted this client for this resource. */
  grantedScopes: OAuthScope[];
  offlineAccess: boolean;
};
export type ConnectedAppsView = {
  grants: OAuthGrantSummary[];
  activity: OAuthActivityEntry[];
  error: string | null;
};
