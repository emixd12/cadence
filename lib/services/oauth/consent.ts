import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import { finishPendingAuthorization, readPendingAuthorization, type OAuthScope } from "@/lib/db/oauth.repo";
import { authorizationRedirect, hashToken, OAuthError, opaqueToken, redirectAllowed, requireOAuthEnabled } from "./protocol";
import { getOAuthClient, pendingCookieName } from "./server";

function browserHash(request: Request, id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new OAuthError("invalid_request");
  const prefix = `${pendingCookieName(id)}=`;
  const cookies = (request.headers.get("cookie") ?? "").split(";").map((c) => c.trim()).filter((c) => c.startsWith(prefix));
  const secret = cookies[0]?.slice(prefix.length);
  if (cookies.length !== 1 || !secret || !/^[A-Za-z0-9_-]{43}$/.test(secret)) throw new OAuthError("invalid_request");
  return hashToken(secret);
}

/** Ticket 227 supplies the signed-in user's client; never a service-role client. */
export async function getOAuthConsent(request: Request, id: string, userClient: AppSupabaseClient) {
  const { resource } = requireOAuthEnabled();
  const pending = await readPendingAuthorization(userClient, id, browserHash(request, id));
  if (!pending || pending.resource !== resource) throw new OAuthError("invalid_request");
  const client = await getOAuthClient(pending.clientId);
  if (!redirectAllowed(client.redirectUris, pending.redirectUri)) throw new OAuthError("invalid_request");
  return { ...pending, clientName: client.clientName, logoUri: client.logoUri, verifiedClient: client.verifiedClient };
}

/** Call on explicit Allow/Deny POST only. null scopes means Deny. */
export async function completeOAuthConsent(request: Request, id: string, scopes: OAuthScope[] | null, userClient: AppSupabaseClient) {
  const { issuer } = requireOAuthEnabled();
  if (request.method !== "POST" || request.headers.get("origin") !== issuer) throw new OAuthError("invalid_request", 403);
  await getOAuthConsent(request, id, userClient);
  const code = opaqueToken();
  const finished = await finishPendingAuthorization(userClient, {
    id, browserHash: browserHash(request, id), scopes, codeHash: scopes ? hashToken(code) : null,
  });
  if (!finished) throw new OAuthError("invalid_request");
  const response = authorizationRedirect(finished.redirectUri, finished.state,
    finished.approved ? { code } : { error: "access_denied" });
  response.headers.set("Set-Cookie", `${pendingCookieName(id)}=; Path=/oauth; HttpOnly; SameSite=Lax; Max-Age=0${issuer.startsWith("https:") ? "; Secure" : ""}`);
  return response;
}
