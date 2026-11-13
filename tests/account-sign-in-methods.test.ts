import { describe, expect, it } from "vitest";

import {
  accountDeletionConfirmationText,
  buildSignInMethodsView,
  linkCallbackResult,
  planRemoveSignInMethod,
  signInMethodResultMessage,
  type AccountIdentity,
} from "@/lib/auth/account-sign-in-methods";
import { SIGN_IN_METHODS, type SignInMethod } from "@/lib/auth/sign-in-methods";

// Ticket 334. The local-integration test drives Google and email end to end; Apple
// cannot run locally until Ticket 333 gives it a start, so its branches are here.

const google: AccountIdentity = { identityId: "g", provider: "google", email: "a@gmail.com" };
const apple: AccountIdentity = { identityId: "a", provider: "apple", email: "x@privaterelay.appleid.com" };
const email: AccountIdentity = { identityId: "e", provider: "email", email: "a@example.com" };

const withApple: SignInMethod[] = SIGN_IN_METHODS.map((method) =>
  method.id === "apple" ? { ...method, start: { kind: "oauth", provider: "apple" } } : method,
);
const googleOnly = SIGN_IN_METHODS.filter((method) => method.id === "google");

describe("account sign-in methods", () => {
  it("offers Apple once its flag and start exist, and lists email for a confirmed address", () => {
    const view = buildSignInMethodsView(
      { identities: [google], email: "a@gmail.com", emailConfirmed: true },
      withApple,
    );
    expect(view.rows.map((row) => [row.methodId, row.removable])).toEqual([["google", false], ["email", false]]);
    expect(view.addable).toEqual(["apple"]);
    expect(buildSignInMethodsView({ identities: [google], email: "a@gmail.com", emailConfirmed: false }, withApple).rows)
      .toHaveLength(1);
  });

  it("lets Google go only while another enabled identity remains", () => {
    expect(planRemoveSignInMethod([google, apple], "g", withApple)).toMatchObject({ kind: "remove", methodId: "google" });
    expect(planRemoveSignInMethod([google, apple], "g", googleOnly)).toEqual({ kind: "refused", result: "last_method" });
    expect(planRemoveSignInMethod([google, email], "e", withApple)).toEqual({ kind: "refused", result: "not_removable" });
    expect(planRemoveSignInMethod([google], "missing", withApple)).toEqual({ kind: "refused", result: "not_found" });
  });

  it("maps Supabase returns from an add or address change", () => {
    const base = { error: null, errorCode: null, code: "c", exchanged: true };
    expect(linkCallbackResult({ ...base, link: "apple" })).toBe("added");
    expect(linkCallbackResult({ ...base, link: "apple", exchanged: false })).toBe("add_failed");
    expect(linkCallbackResult({ ...base, link: "apple", error: "server_error", errorCode: "identity_already_exists" })).toBe("taken");
    expect(linkCallbackResult({ ...base, link: "email", code: null })).toBe("email_confirm_other");
    expect(linkCallbackResult({ ...base, link: "email", exchanged: false })).toBe("email_confirmed");
    expect(linkCallbackResult({ ...base, link: "email", error: "access_denied", errorCode: "otp_expired" })).toBe("email_link_failed");
    expect(signInMethodResultMessage("taken", "apple")?.text).toMatch(/^That Apple account already signs in to a different Cadence account/);
    expect(signInMethodResultMessage("unknown", "apple")).toBeNull();
  });

  it("asks for DELETE when the address is missing or an Apple relay", () => {
    expect(accountDeletionConfirmationText("a@example.com")).toBe("a@example.com");
    expect(accountDeletionConfirmationText("X@PrivateRelay.AppleID.com")).toBe("DELETE");
    expect(accountDeletionConfirmationText(" ")).toBe("DELETE");
    expect(accountDeletionConfirmationText(null)).toBe("DELETE");
  });
});
