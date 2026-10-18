import type { OAuthActivityEntry, OAuthGrantSummary, OAuthScope } from "@/lib/db/oauth.repo";

export const OAUTH_PERMISSION_LABELS: Record<OAuthScope, string> = {
  "cadence.read": "Read tracking data",
  "cadence.occurrences.write": "Change Occurrence statuses and notes",
  "cadence.behaviors.write": "Create, edit, archive, and restore Behaviors",
};

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
  scopes: OAuthScope[];
  offlineAccess: boolean;
};
export type ConnectedAppsView = {
  grants: OAuthGrantSummary[];
  activity: OAuthActivityEntry[];
  error: string | null;
};
