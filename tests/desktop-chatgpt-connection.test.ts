import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { ChatGptConnectionError, createChatGptConnection, readChatGptCatalog, readChatGptStatus } from "../apps/desktop/src/chatgpt/connection";

// Ticket 297: the webview client sees state, email and catalog rows, never a token.
const native = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string) => {
    native.calls.push(command);
    if (command === "chatgpt_status") return { state: "connectedWithPlanUsage", email: "person@example.test", accessToken: "at-SECRET" };
    if (command === "chatgpt_models") return [{ slug: "gpt-5.5-mini", visibility: "list", token: "at-SECRET" }, { slug: "" }, { visibility: "list" }, "x"];
    if (command === "chatgpt_disconnect") return { outcome: "revoked" };
    if (command === "chatgpt_cancel_connect") return null;
    throw "ChatGPT is not connected.";
  }),
}));

describe("desktop ChatGPT connection client", () => {
  it("calls the native commands and copies only known fields", async () => {
    const connection = createChatGptConnection();
    await expect(connection.status()).resolves.toEqual({ state: "connectedWithPlanUsage", email: "person@example.test" });
    await expect(connection.models()).resolves.toEqual([{ slug: "gpt-5.5-mini", visibility: "list" }]);
    await expect(connection.disconnect()).resolves.toBe("revoked");
    await expect(connection.cancelConnect()).resolves.toBeUndefined();
    await expect(connection.connect()).rejects.toEqual(new ChatGptConnectionError("ChatGPT is not connected."));
    expect(native.calls).toEqual(["chatgpt_status", "chatgpt_models", "chatgpt_disconnect", "chatgpt_cancel_connect", "chatgpt_connect"]);
    expect(JSON.stringify(await connection.status())).not.toContain("SECRET");
  });

  it("accepts each connection state and rejects anything else", () => {
    for (const state of ["disconnected", "connectedWithoutPlanUsage", "connectedWithPlanUsage", "needsReconnect"]) {
      expect(readChatGptStatus({ state, email: null }).state).toBe(state);
    }
    expect(() => readChatGptStatus({ state: "connected" })).toThrow(ChatGptConnectionError);
    expect(() => readChatGptStatus(null)).toThrow(ChatGptConnectionError);
    expect(readChatGptStatus({ state: "disconnected", email: 42 }).email).toBeNull();
    expect(() => readChatGptCatalog({ models: [] })).toThrow(ChatGptConnectionError);
  });

  it("replaces a non-string native error with a fixed sentence", async () => {
    const connection = createChatGptConnection(async () => { throw new Error("Bearer at-SECRET leaked"); });
    await expect(connection.models()).rejects.toThrow("The ChatGPT connection did not respond.");
  });

  it("keeps the client out of frontend storage and away from token endpoints", () => {
    const source = readFileSync(new URL("../apps/desktop/src/chatgpt/connection.ts", import.meta.url), "utf8");
    for (const forbidden of ["localStorage", "sessionStorage", "indexedDB", "document.cookie", "fetch(", "console.", "auth_secret_", "refresh_token", "auth.openai.com"]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it("registers the native commands and keeps the ChatGPT Keychain items native-only", () => {
    const lib = readFileSync(new URL("../apps/desktop/src-tauri/src/lib.rs", import.meta.url), "utf8");
    for (const command of ["chatgpt_status", "chatgpt_connect", "chatgpt_cancel_connect", "chatgpt_disconnect", "chatgpt_models"]) {
      expect(lib).toContain(`chatgpt::${command}`);
    }
    const auth = readFileSync(new URL("../apps/desktop/src-tauri/src/auth.rs", import.meta.url), "utf8");
    const webviewKeys = /const ALLOWED_KEYS: &\[&str\] = &\[([^\]]*)\]/u.exec(auth)?.[1] ?? "";
    expect(webviewKeys).not.toContain("chatgpt");
    expect(auth).toContain('NATIVE_ONLY_KEYS: &[&str] = &["chatgpt-installation", "chatgpt-session"]');
  });

  it("opens the desktop CSP to exactly https://api.openai.com for the plan model call (Ticket 299); sign-in stays in Rust", () => {
    const config = JSON.parse(readFileSync(new URL("../apps/desktop/src-tauri/tauri.conf.json", import.meta.url), "utf8"));
    for (const policy of [config.app.security.csp, config.app.security.devCsp]) {
      const connect = (policy as string).match(/connect-src ([^;]+)/u)?.[1]?.split(" ") ?? [];
      expect(connect.filter((source) => source.includes("openai"))).toEqual(["https://api.openai.com"]);
      expect(policy).not.toContain("auth.openai.com");
      expect(policy).not.toContain("chatgpt.com");
    }
  });
});
