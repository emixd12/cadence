import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { readFileSync } from "node:fs";
import type { Session } from "@supabase/supabase-js";
import { accountStateFromSession, createKeychainStorage, DESKTOP_AUTH_CALLBACK, desktopAuthRedirect, disconnectDesktopAccount, parseDesktopAuthCallback, readDesktopAuthConfig, reconnectDesktopAccount } from "../apps/desktop/src/account/auth";
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
});
