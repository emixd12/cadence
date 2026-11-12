import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { readFileSync } from "node:fs";
import type { Session } from "@supabase/supabase-js";
import { accountStateFromSession, cancelDesktopAccountLink, createKeychainStorage, DESKTOP_AUTH_CALLBACK, desktopAuthRedirect, disconnectDesktopAccount, parseDesktopAuthCallback, readDesktopAuthConfig, reconnectDesktopAccount } from "../apps/desktop/src/account/auth";
import { localErrorMessage } from "../apps/desktop/src/local-actions";
import { AccountPanel } from "../apps/desktop/src/account/account-panel";

describe("desktop authentication", () => {
  it("reads the account name from session metadata with safe fallbacks", () => {
    for (const [metadata, name] of [
      [{ full_name: " Cadence User ", name: "Other" }, "Cadence User"],
      [{ full_name: " ", name: " Display Name " }, "Display Name"],
      [{ full_name: 42, name: {} }, null],
      [{}, null],
    ] as const) {
      const session = { user: { id: "hosted", email: "owner@example.test", user_metadata: metadata } } as unknown as Session;
      expect(accountStateFromSession(session)).toEqual({ status: "linked", userId: "hosted", email: "owner@example.test", name });
    }
    expect(accountStateFromSession(null)).toEqual({ status: "local" });
  });

  it("preserves sanitized native command errors", () => {
    expect(localErrorMessage("macOS Keychain did not save the authentication session.")).toBe("macOS Keychain did not save the authentication session.");
  });
  it("shows the message of a plain-object Supabase error", () => {
    expect(localErrorMessage({ message: "canceling statement due to statement timeout", code: "57014", details: null, hint: null }))
      .toBe("canceling statement due to statement timeout");
    expect(localErrorMessage({ message: "  ", code: "57014" })).toBe("Unable to save the local change. Try again.");
    expect(localErrorMessage({ code: "57014" })).toBe("Unable to save the local change. Try again.");
    expect(localErrorMessage(null)).toBe("Unable to save the local change. Try again.");
  });
  it("uses the official Tauri deep-link plugin for only the cadence scheme", () => {
    const config = JSON.parse(readFileSync("apps/desktop/src-tauri/tauri.conf.json", "utf8"));
    const native = readFileSync("apps/desktop/src-tauri/native/auth.m", "utf8");
    expect(config.plugins["deep-link"].desktop.schemes).toEqual(["cadence"]);
    expect(native).not.toContain("NSAppleEventManager");
    expect(native).not.toContain("cadence_auth_urls");
  });

  it("accepts the exact current callback once its state matches", () => {
    expect(parseDesktopAuthCallback(`${DESKTOP_AUTH_CALLBACK}?code=one-time&state=expected`, "expected", 20_000, 10_000))
      .toEqual({ code: "one-time" });
  });

  it("places the unmodified state in Supabase's redirectTo value", () => {
    expect(desktopAuthRedirect("state with / punctuation"))
      .toBe("cadence://auth/callback?state=state%20with%20%2F%20punctuation");
  });

  it.each([
    [`${DESKTOP_AUTH_CALLBACK}?code=value&state=wrong`, "wrong state"],
    [`${DESKTOP_AUTH_CALLBACK}?error=access_denied&state=expected`, "cancelled or denied"],
    ["cadence://unknown/callback?code=value&state=expected", "unknown authentication callback"],
  ])("rejects unsafe callback %s", (value, message) => {
    expect(parseDesktopAuthCallback(value, "expected", 20_000, 10_000)).toEqual({ error: expect.stringContaining(message) });
  });

  it("rejects a callback after the five-minute PKCE lifetime", () => {
    expect(parseDesktopAuthCallback(`${DESKTOP_AUTH_CALLBACK}?code=value&state=expected`, "expected", 310_001, 10_000))
      .toEqual({ error: "This sign-in request expired. Start again." });
  });

  it.each([
    `${DESKTOP_AUTH_CALLBACK}?code=value`,
    `${DESKTOP_AUTH_CALLBACK}?code=value#state=expected`,
  ])("rejects missing query state in %s", (value) => {
    expect(parseDesktopAuthCallback(value, "expected", 20_000, 10_000))
      .toEqual({ error: "Cadence rejected an authentication callback with the wrong state." });
  });

  it("accepts only public HTTPS runtime configuration", () => {
    expect(readDesktopAuthConfig({ VITE_SUPABASE_URL: "https://example.supabase.co/", VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" }))
      .toEqual({ url: "https://example.supabase.co", key: "sb_publishable_test" });
    expect(readDesktopAuthConfig({ VITE_SUPABASE_URL: "http://example.test", VITE_SUPABASE_PUBLISHABLE_KEY: "key" })).toBeNull();
    expect(readDesktopAuthConfig({ VITE_SUPABASE_URL: "https://example.test" })).toBeNull();
  });

  it("refuses unexpected Supabase storage keys instead of collapsing them", () => {
    const storage = createKeychainStorage();
    expect(() => storage.getItem("unexpected-auth-key")).toThrow("unknown secure storage key");
  });

  it("keeps local mode visible and hands a successful session to the next step", () => {
    const local = renderToStaticMarkup(<AccountPanel state={{ status: "local" }} configured connected={false} busy={false} onSignIn={() => {}} onCancel={() => {}} />);
    expect(local).toContain("Tracking works without an account");
    const linked = renderToStaticMarkup(<AccountPanel state={{ status: "linked", userId: "hosted", email: "owner@example.test" }} configured connected={false} busy={false} onSignIn={() => {}} onCancel={() => {}} />);
    expect(linked).toContain("Your local data has not been uploaded or replaced");
  });

  it("shows the account working-copy contract only after the baseline is connected", () => {
    const html = renderToStaticMarkup(<AccountPanel state={{ status: "error", message: "Session revoked." }} configured connected busy={false} onSignIn={() => {}} onCancel={() => {}} />);
    expect(html).toContain("This Mac is linked to your Cadence account.");
    expect(html).toContain("offline working copy");
    expect(html).not.toContain("No cloud account");
  });

  it("clears only the local session before starting account reconnection", async () => {
    const order: string[] = [];
    await reconnectDesktopAccount(async () => { order.push("local-session"); }, async () => { order.push("oauth"); });
    expect(order).toEqual(["local-session", "oauth"]);
  });

  it("removes secrets before mutating native account state", async () => {
    const order: string[] = [];
    await disconnectDesktopAccount("remove", async () => { order.push("secrets"); }, async () => { order.push("pending"); }, async (command) => {
      order.push(command); return { backupPath: "/backup", path: "/live" };
    });
    expect(order).toEqual(["secrets", "pending", "disconnect_remove_account_data"]);
    await expect(disconnectDesktopAccount("keep", async () => { throw new Error("Keychain failed"); }, async () => undefined, async () => {
      throw new Error("native command must not run");
    })).rejects.toThrow("Keychain failed");
  });

  it("disconnects ChatGPT before the Cadence account, including an unconfirmed provider revocation", async () => {
    const order: string[] = [];
    const native = async (command: string) => { order.push(command); return { backupPath: null, path: "/live" }; };
    await disconnectDesktopAccount("keep", async () => { order.push("secrets"); }, async () => { order.push("pending"); }, native,
      async () => { order.push("chatgpt"); return { outcome: "revocationFailed" }; });
    expect(order).toEqual(["chatgpt", "secrets", "pending", "disconnect_keep_local_copy"]);
    order.length = 0;
    await expect(disconnectDesktopAccount("keep", async () => { order.push("secrets"); }, async () => undefined, native,
      async () => { throw new Error("macOS Keychain could not save the ChatGPT connection."); }))
      .rejects.toThrow("macOS Keychain could not save the ChatGPT connection.");
    expect(order).toEqual([]);
    // DesktopAuth calls the Rust command, which revokes, then clears only the session item.
    const source = readFileSync("apps/desktop/src/account/auth.ts", "utf8");
    expect(source).toContain('() => invoke("chatgpt_disconnect")');
  });

  it("clears ChatGPT before cancelling an unfinished account link and blocks account switching on storage failure", async () => {
    const order: string[] = [];
    const clearSecrets = async () => { order.push("secrets"); };
    const clearMetadata = async () => { order.push("metadata"); };
    await cancelDesktopAccountLink(clearSecrets, clearMetadata, async () => { order.push("chatgpt"); });
    expect(order).toEqual(["chatgpt", "secrets", "metadata"]);
    order.length = 0;
    await expect(cancelDesktopAccountLink(clearSecrets, clearMetadata, async () => { throw new Error("Keychain unavailable"); }))
      .rejects.toThrow("Keychain unavailable");
    expect(order).toEqual([]);
  });
});
