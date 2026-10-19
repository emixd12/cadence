import { headers } from "next/headers";
import { getCurrentUser, requireCurrentUser } from "@/lib/auth/current-user";
import { listOAuthActivity, listOAuthGrants, revokeOAuthGrant, type OAuthScope } from "@/lib/db/oauth.repo";
import { createClient } from "@/lib/supabase/server";
import { completeOAuthConsent, getOAuthConsent } from "@/lib/services/oauth/consent";
import { oauthConfig, OAuthError } from "@/lib/services/oauth/protocol";
import type { ConnectedAppsView, ConsentView } from "@/lib/types/oauth-ui";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function consentRequest(method: "GET" | "POST") {
  return new Request(`${oauthConfig().issuer}/oauth/consent`, { method, headers: await headers() });
}

export async function getConsentPageData(requestId: string): Promise<ConsentView | null> {
  const { user, error } = await getCurrentUser();
  if (error || !user) return null;
  const consent = await getOAuthConsent(await consentRequest("GET"), requestId, await createClient());
  return {
    requestId, accountId: user.id, email: user.email ?? "Signed-in account",
    clientName: consent.clientName, logoUri: consent.logoUri,
    verified: consent.verifiedClient !== null, redirectHost: new URL(consent.redirectUri).host,
    scopes: consent.scopes, offlineAccess: consent.offlineAccess,
  };
}

export async function submitOAuthConsent(form: FormData) {
  const user = await requireCurrentUser("Sign in again before connecting an app.");
  const id = form.get("request_id");
  const decision = form.get("decision");
  if (typeof id !== "string" || !UUID.test(id) || form.get("account_id") !== user.id ||
      !["allow", "deny"].includes(String(decision))) throw new OAuthError("invalid_request");
  const values = form.getAll("scope");
  const allowed: OAuthScope[] = ["cadence.read", "cadence.occurrences.write", "cadence.behaviors.write"];
  if (decision === "allow" && (values.some((value) => !allowed.includes(value as OAuthScope)) ||
      !values.includes("cadence.read") || new Set(values).size !== values.length)) throw new OAuthError("invalid_scope");
  const response = await completeOAuthConsent(
    await consentRequest("POST"), id, decision === "deny" ? null : values as OAuthScope[], await createClient(),
  );
  const location = response.headers.get("Location");
  if (!location) throw new OAuthError("server_error");
  return { requestId: id, location };
}

export async function getConnectedApps(): Promise<ConnectedAppsView> {
  try {
    await requireCurrentUser("Sign in again before opening Connected apps.");
    const client = await createClient();
    const [grants, activity] = await Promise.all([listOAuthGrants(client), listOAuthActivity(client, { limit: 20 })]);
    return { grants, activity, error: null };
  } catch {
    return { grants: [], activity: [], error: "Connected apps could not load. Reload Settings to try again." };
  }
}

export async function disconnectOAuthApp(form: FormData) {
  await requireCurrentUser("Sign in again before disconnecting an app.");
  const id = form.get("grant_id");
  if (typeof id !== "string" || !UUID.test(id)) throw new OAuthError("invalid_request");
  if ((await headers()).get("origin") !== oauthConfig().issuer) throw new OAuthError("invalid_request", 403);
  if (!await revokeOAuthGrant(await createClient(), id)) throw new OAuthError("invalid_request");
}
