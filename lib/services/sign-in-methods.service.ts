import type { UserIdentity } from "@supabase/supabase-js";

import {
  buildSignInMethodsView,
  LINK_CALLBACK_PARAM,
  planRemoveSignInMethod,
  signInLinkingEnabled,
  type AccountIdentity,
  type SignInMethodResult,
  type SignInMethodsView,
} from "@/lib/auth/account-sign-in-methods";
import { emailRequestErrorKey, normalizeEmailAddress } from "@/lib/auth/email-sign-in";
import { AUTH_CALLBACK_ROUTE, normalizeRedirectPath } from "@/lib/auth/redirects";
import {
  enabledSignInMethods,
  findEnabledSignInMethod,
  type SignInMethodId,
} from "@/lib/auth/sign-in-methods";
import { reportMonitoringEvent } from "@/lib/monitoring/privacy-safe-events";
import { createClient } from "@/lib/supabase/server";

// Ticket 334 (D31.3): list, add and remove the sign-in methods of the signed-in
// account through Supabase manual identity linking. Every call acts as the user
// with their own session; nothing here uses the service role.

type ServerClient = Awaited<ReturnType<typeof createClient>>;

function toAccountIdentity(identity: UserIdentity): AccountIdentity {
  const email = identity.identity_data?.email;
  return {
    identityId: identity.identity_id,
    provider: identity.provider,
    email: typeof email === "string" && email ? email : null,
  };
}

async function readAccount(supabase: ServerClient) {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  const identities = data.user.identities ?? [];
  return {
    identities,
    state: {
      identities: identities.map(toAccountIdentity),
      email: data.user.email?.trim() || null,
      emailConfirmed: Boolean(data.user.email_confirmed_at),
    },
  };
}

/** The Settings row's data; `null` while the flag is off or nobody is signed in. */
export async function getSignInMethodsView(): Promise<SignInMethodsView | null> {
  if (!signInLinkingEnabled()) return null;
  const account = await readAccount(await createClient());
  if (!account) return null;
  return buildSignInMethodsView(account.state, enabledSignInMethods());
}

export type AddSignInMethodOutcome =
  | Readonly<{ kind: "redirect"; url: string }>
  | Readonly<{ kind: "refused"; result: SignInMethodResult }>;

/**
 * The one server-side entry point for adding an OAuth sign-in method to the
 * signed-in account. It starts Supabase manual identity linking and returns the
 * provider URL to redirect to. The provider returns through `/auth/callback`,
 * which sends the person to `returnPath` with `sign_in_method` set to `added`,
 * `taken` (the identity belongs to another Cadence account) or `add_failed`.
 *
 * Ticket 335 (D31.5) calls this for Google Calendar with the Calendar `scopes`
 * and its own `returnPath`. It is refused while `CADENCE_SIGN_IN_LINKING` is off,
 * because hosted manual linking is off until that flag turns on.
 */
export async function startAddSignInMethod(input: Readonly<{
  origin: URL;
  methodId: SignInMethodId;
  returnPath: string;
  scopes?: string;
  queryParams?: Readonly<Record<string, string>>;
}>): Promise<AddSignInMethodOutcome> {
  if (!signInLinkingEnabled()) return { kind: "refused", result: "unavailable" };
  const method = findEnabledSignInMethod(input.methodId);
  if (method?.start?.kind !== "oauth") return { kind: "refused", result: "unavailable" };

  const redirectTo = new URL(AUTH_CALLBACK_ROUTE, input.origin);
  redirectTo.searchParams.set("next", normalizeRedirectPath(input.returnPath));
  redirectTo.searchParams.set(LINK_CALLBACK_PARAM, method.id);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.linkIdentity({
    provider: method.start.provider,
    options: {
      redirectTo: redirectTo.toString(),
      scopes: input.scopes,
      queryParams: input.queryParams ? { ...input.queryParams } : undefined,
      skipBrowserRedirect: true,
    },
  });

  if (error || !data?.url) {
    reportMonitoringEvent({
      name: "auth_link_start_failed",
      severity: "warning",
      context: { route: "/auth/sign-in-methods/add", method: "POST", reason: error?.code ?? "no_url" },
    });
    return { kind: "refused", result: "add_failed" };
  }
  return { kind: "redirect", url: data.url };
}

/**
 * Adds email as a method, or moves email sign-in to another address. Supabase Auth
 * sends a confirmation link; the address changes only after it is opened, so an
 * unconfirmed address never reaches the account (D31.3). No password is involved.
 */
export async function changeSignInEmail(input: Readonly<{
  origin: URL;
  email: unknown;
  returnPath: string;
}>): Promise<SignInMethodResult> {
  if (!signInLinkingEnabled() || !findEnabledSignInMethod("email")) return "unavailable";
  const email = normalizeEmailAddress(input.email);
  if (!email) return "email_invalid";

  const supabase = await createClient();
  const account = await readAccount(supabase);
  if (!account) return "unavailable";
  if (account.state.email?.toLowerCase() === email) return "email_same";

  const redirectTo = new URL(AUTH_CALLBACK_ROUTE, input.origin);
  redirectTo.searchParams.set("next", normalizeRedirectPath(input.returnPath));
  redirectTo.searchParams.set(LINK_CALLBACK_PARAM, "email");

  const { error } = await supabase.auth.updateUser(
    { email },
    { emailRedirectTo: redirectTo.toString() },
  );
  if (!error) return "email_sent";
  if (error.code === "email_exists") return "email_taken";
  const key = emailRequestErrorKey(error);
  reportMonitoringEvent({
    name: "auth_email_change_failed",
    severity: key === "email_send_failed" ? "error" : "warning",
    context: { route: "/auth/sign-in-methods/email", method: "POST", reason: error.code ?? key },
  });
  if (key === "email_rate_limited") return "email_rate_limited";
  if (key === "email_invalid") return "email_invalid";
  return "email_failed";
}

/** Removes one Google or Apple identity. Refused on the server when it is the last way in. */
export async function removeSignInMethod(identityId: unknown): Promise<
  Readonly<{ result: SignInMethodResult; methodId?: SignInMethodId }>
> {
  if (!signInLinkingEnabled()) return { result: "unavailable" };
  if (typeof identityId !== "string" || !identityId) return { result: "not_found" };

  const supabase = await createClient();
  const account = await readAccount(supabase);
  if (!account) return { result: "unavailable" };

  const plan = planRemoveSignInMethod(account.state.identities, identityId, enabledSignInMethods());
  if (plan.kind === "refused") return { result: plan.result };

  const identity = account.identities.find((item) => item.identity_id === plan.identity.identityId)!;
  const { error } = await supabase.auth.unlinkIdentity(identity);
  if (error) {
    if (error.code === "single_identity_not_deletable") return { result: "last_method", methodId: plan.methodId };
    reportMonitoringEvent({
      name: "auth_unlink_failed",
      severity: "warning",
      context: { route: "/auth/sign-in-methods/remove", method: "POST", reason: error.code ?? "unknown" },
    });
    return { result: "remove_failed", methodId: plan.methodId };
  }
  return { result: "removed", methodId: plan.methodId };
}
