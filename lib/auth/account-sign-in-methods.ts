import type { SignInEnv, SignInMethod, SignInMethodId } from "@/lib/auth/sign-in-methods";

// Ticket 334 (D31.3): the sign-in methods of one account, and the rules for
// adding and removing them. Pure: the service passes in the account's Supabase
// identities and the enabled methods from `lib/auth/sign-in-methods.ts`.
//
// What Supabase Auth does, measured on the local stack (CLI 2.105.0):
// - An email code to the account's confirmed address signs in to that account,
//   with or without an "email" identity. So email is a method of every account
//   with a confirmed address while email sign-in is on, and it cannot be removed:
//   unlinking the email identity only moves the address back to another identity.
// - `unlinkIdentity` refuses the last identity (`single_identity_not_deletable`).
// - A confirmed address change adds an "email" identity.

/** Turns the Settings row, the add, change and remove routes and the login hint on. */
export const SIGN_IN_LINKING_FLAG = "CADENCE_SIGN_IN_LINKING";

export function signInLinkingEnabled(env: SignInEnv = process.env): boolean {
  return env[SIGN_IN_LINKING_FLAG] === "on";
}

export const SIGN_IN_METHODS_ANCHOR = "sign-in-methods";
export const SIGN_IN_METHODS_RESULT_PARAM = "sign_in_method";
export const SIGN_IN_METHODS_METHOD_PARAM = "method";
export const SETTINGS_SIGN_IN_METHODS_PATH = "/settings";

const METHOD_NAMES: Record<SignInMethodId, string> = {
  google: "Google",
  apple: "Apple",
  email: "Email",
};

export function signInMethodName(id: SignInMethodId): string {
  return METHOD_NAMES[id];
}

export function isSignInMethodId(value: unknown): value is SignInMethodId {
  return typeof value === "string" && Object.hasOwn(METHOD_NAMES, value);
}

/** The fields Cadence reads from a Supabase `UserIdentity`. */
export type AccountIdentity = Readonly<{
  identityId: string;
  provider: string;
  email: string | null;
}>;

export type AccountSignInState = Readonly<{
  identities: readonly AccountIdentity[];
  /** `auth.users.email`; email codes go here. */
  email: string | null;
  emailConfirmed: boolean;
}>;

export type SignInMethodRow = Readonly<{
  /** The identity to remove; `null` for the email row, which has none or cannot be removed. */
  identityId: string | null;
  methodId: SignInMethodId;
  name: string;
  detail: string | null;
  removable: boolean;
}>;

export type SignInMethodsView = Readonly<{
  rows: readonly SignInMethodRow[];
  /** OAuth methods the account can add: enabled and not yet on the account. */
  addable: readonly SignInMethodId[];
  /** Email sign-in is on: the address form shows ("Add email" or "Change address"). */
  emailEnabled: boolean;
  email: string | null;
}>;

function methodOf(provider: string): SignInMethodId | null {
  return isSignInMethodId(provider) ? provider : null;
}

/**
 * An identity can be removed only when another identity whose method is enabled
 * remains. Otherwise the person could lose every way in (D31.3: an account keeps
 * at least one method).
 */
function canRemoveIdentity(
  identity: AccountIdentity,
  identities: readonly AccountIdentity[],
  enabled: ReadonlySet<SignInMethodId>,
): boolean {
  if (identity.provider === "email") return false;
  return identities.some((other) => {
    if (other.identityId === identity.identityId) return false;
    const method = methodOf(other.provider);
    return method !== null && enabled.has(method);
  });
}

export function buildSignInMethodsView(
  account: AccountSignInState,
  enabledMethods: readonly SignInMethod[],
): SignInMethodsView {
  const enabled = new Set(enabledMethods.map((method) => method.id));
  const rows: SignInMethodRow[] = [];

  for (const identity of account.identities) {
    const methodId = methodOf(identity.provider);
    if (!methodId || methodId === "email") continue;
    rows.push({
      identityId: identity.identityId,
      methodId,
      name: signInMethodName(methodId),
      detail: identity.email,
      removable: canRemoveIdentity(identity, account.identities, enabled),
    });
  }

  const hasEmailIdentity = account.identities.some((identity) => identity.provider === "email");
  const emailWorks = enabled.has("email") && account.emailConfirmed && account.email !== null;
  if (hasEmailIdentity || emailWorks) {
    rows.push({
      identityId: null,
      methodId: "email",
      name: signInMethodName("email"),
      detail: account.email,
      removable: false,
    });
  }

  const present = new Set(rows.map((row) => row.methodId));
  const addable = enabledMethods
    .filter((method) => method.start?.kind === "oauth" && !present.has(method.id))
    .map((method) => method.id);

  return { rows, addable, emailEnabled: enabled.has("email"), email: account.email };
}

export type RemovePlan =
  | Readonly<{ kind: "remove"; identity: AccountIdentity; methodId: SignInMethodId }>
  | Readonly<{ kind: "refused"; result: "last_method" | "not_removable" | "not_found" }>;

/** The server-side check before `unlinkIdentity`; the Settings row only mirrors it. */
export function planRemoveSignInMethod(
  identities: readonly AccountIdentity[],
  identityId: string,
  enabledMethods: readonly SignInMethod[],
): RemovePlan {
  const identity = identities.find((item) => item.identityId === identityId);
  const methodId = identity ? methodOf(identity.provider) : null;
  if (!identity || !methodId) return { kind: "refused", result: "not_found" };
  if (methodId === "email") return { kind: "refused", result: "not_removable" };
  const enabled = new Set(enabledMethods.map((method) => method.id));
  if (!canRemoveIdentity(identity, identities, enabled)) {
    return { kind: "refused", result: "last_method" };
  }
  return { kind: "remove", identity, methodId };
}

export type SignInMethodResult =
  | "added"
  | "add_failed"
  | "taken"
  | "removed"
  | "remove_failed"
  | "last_method"
  | "not_removable"
  | "not_found"
  | "unavailable"
  | "email_sent"
  | "email_same"
  | "email_invalid"
  | "email_taken"
  | "email_rate_limited"
  | "email_failed"
  | "email_confirm_other"
  | "email_confirmed"
  | "email_link_failed";

function messages(name: string): Record<SignInMethodResult, string> {
  return {
    added: `${name} added. You can sign in with it now.`,
    add_failed: `${name} was not added. Try again.`,
    taken: `That ${name} account already signs in to a different Cadence account, so it cannot be added here. Cadence does not merge accounts. Choose another ${name} account.`,
    removed: `${name} removed. It no longer signs in to this account.`,
    remove_failed: `${name} was not removed. Try again.`,
    last_method: "Add another way to sign in before removing this one.",
    not_removable: "Email stays while this account has an address. You can change the address.",
    not_found: "That sign-in method is no longer on this account. Reload Settings.",
    unavailable: "Sign-in methods cannot be changed right now.",
    email_sent:
      "Cadence sent a confirmation link to the new address. Open it to finish. If an email also reaches your current address, open that link too.",
    email_same: "That is already this account's address.",
    email_invalid: "Enter an email address, like name@example.com.",
    email_taken:
      "That address already signs in to a different Cadence account, so it cannot be added here. Choose another address.",
    email_rate_limited: "Cadence sent an email a moment ago. Wait a minute, then try again.",
    email_failed: "The confirmation email could not be sent. Try again.",
    email_confirm_other: "One link confirmed. Open the link sent to the other address to finish.",
    email_confirmed: "Address confirmed. Email codes now go to the address shown here.",
    email_link_failed:
      "That link did not work. It may be used or more than an hour old. Change the address again for a new link.",
  };
}

export function signInMethodResultMessage(
  result: string | string[] | null | undefined,
  method: string | string[] | null | undefined,
): { text: string; error: boolean } | null {
  const key = Array.isArray(result) ? result[0] : result;
  const methodValue = Array.isArray(method) ? method[0] : method;
  if (!key) return null;
  const table = messages(isSignInMethodId(methodValue) ? signInMethodName(methodValue) : "That method");
  if (!Object.hasOwn(table, key)) return null;
  const success = key === "added" || key === "removed" || key === "email_sent" || key === "email_confirmed" || key === "email_confirm_other";
  return { text: table[key as SignInMethodResult], error: !success };
}

/** `returnPath` with the result in its query and the Settings anchor kept. */
export function signInMethodReturnPath(
  returnPath: string,
  result: SignInMethodResult,
  methodId?: SignInMethodId,
): string {
  const url = new URL(returnPath, "http://local.invalid");
  url.searchParams.set(SIGN_IN_METHODS_RESULT_PARAM, result);
  if (methodId) url.searchParams.set(SIGN_IN_METHODS_METHOD_PARAM, methodId);
  else url.searchParams.delete(SIGN_IN_METHODS_METHOD_PARAM);
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Marks an `/auth/callback` return from an add or an address change. */
export const LINK_CALLBACK_PARAM = "link";

/**
 * Where `/auth/callback` sends a person back from adding a method or confirming an
 * address. Supabase Auth puts `error_code` on the return when the identity belongs to
 * another user. The message never says whose account it is.
 */
export function linkCallbackResult(input: Readonly<{
  link: SignInMethodId;
  error: string | null;
  errorCode: string | null;
  code: string | null;
  exchanged: boolean | null;
}>): SignInMethodResult {
  const email = input.link === "email";
  if (input.error || input.errorCode) {
    if (input.errorCode === "identity_already_exists") return "taken";
    if (input.errorCode === "email_exists") return "email_taken";
    return email ? "email_link_failed" : "add_failed";
  }
  if (!input.code) return email ? "email_confirm_other" : "add_failed";
  if (email) return "email_confirmed";
  return input.exchanged ? "added" : "add_failed";
}

const APPLE_RELAY_DOMAIN = "@privaterelay.appleid.com";

/**
 * The text a person types to delete the account (Ticket 334). The address when it
 * is one they would know; `DELETE` for an account with no address or an Apple
 * Hide My Email relay address, which nobody types from memory.
 */
export function accountDeletionConfirmationText(email: string | null | undefined): string {
  const address = email?.trim();
  if (!address || address.toLowerCase().endsWith(APPLE_RELAY_DOMAIN)) return "DELETE";
  return address;
}
