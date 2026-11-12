import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { ChatGptConnectionError, createChatGptAccountScope, createChatGptConnection, readChatGptCatalog, readChatGptStatus, type ChatGptConnectionChange } from "../apps/desktop/src/chatgpt/connection";

// Ticket 297: the webview client sees state, email and catalog rows, never a token.
const native = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string) => {
    native.calls.push(command);
    if (command === "chatgpt_status") return { state: "connectedWithPlanUsage", email: "person@example.test", accessToken: "at-SECRET" };
    if (command === "chatgpt_models") return [{ slug: "gpt-5.5-mini", visibility: "list", token: "at-SECRET" }, { slug: "" }, { visibility: "list" }, "x"];
    if (command === "chatgpt_disconnect") return { outcome: "revoked" };
    if (command === "chatgpt_cancel_connect") return null;
    if (command === "chatgpt_access_token") return { accessToken: "at-SECRET-memory-only", refreshToken: "rt-SECRET" };
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

  it("returns only the access token for one model call (Ticket 299)", async () => {
    await expect(createChatGptConnection().accessToken()).resolves.toBe("at-SECRET-memory-only");
    await expect(createChatGptConnection(async () => ({ accessToken: "" })).accessToken()).rejects.toBeInstanceOf(ChatGptConnectionError);
  });

  it("shares pending sign-in and lifecycle events, and rejects a duplicate sign-in", async () => {
    let finish!: (value: unknown) => void;
    const call = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const connection = createChatGptConnection(call);
    const events: ChatGptConnectionChange[] = [];
    const stop = connection.subscribe((event) => events.push(event));
    const pending = connection.connect();
    expect(connection.isConnecting()).toBe(true);
    expect(connection.isChanging()).toBe(true);
    expect(events).toEqual([{ kind: "start", operation: "connect" }]);
    await expect(connection.connect()).rejects.toThrow("The ChatGPT connection is changing.");
    expect(call).toHaveBeenCalledOnce();
    finish({ state: "connectedWithPlanUsage", email: "a@example.test" });
    await pending;
    expect(connection.isChanging()).toBe(false);
    expect(events).toEqual([{ kind: "start", operation: "connect" }, { kind: "settled", operation: "connect" }]);
    stop();
  });

  it("blocks a new sign-in while Disconnect is clearing the session", async () => {
    let finish!: (value: unknown) => void;
    const call = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const connection = createChatGptConnection(call);
    const pending = connection.disconnect();
    expect(connection.isConnecting()).toBe(false);
    expect(connection.isChanging()).toBe(true);
    await expect(connection.connect()).rejects.toThrow("The ChatGPT connection is changing.");
    expect(call).toHaveBeenCalledOnce();
    finish({ outcome: "revocationFailed" });
    await expect(pending).resolves.toBe("revocationFailed");
    expect(connection.isChanging()).toBe(false);
  });

  it("does not let an observer failure block native cleanup or strand the operation", async () => {
    const call = vi.fn(async () => ({ outcome: "revoked" }));
    const connection = createChatGptConnection(call);
    connection.subscribe(() => { throw new Error("Observer failed"); });
    const observed = vi.fn();
    connection.subscribe(observed);
    await expect(connection.disconnect()).resolves.toBe("revoked");
    expect(call).toHaveBeenCalledWith("chatgpt_disconnect");
    expect(observed).toHaveBeenCalledTimes(2);
    expect(connection.isChanging()).toBe(false);
  });

  it("rejects stale account controls and teardown calls before native work, including late connect results", async () => {
    const scope = createChatGptAccountScope();
    scope.setAccount("a");
    expect(scope.beginTransition()).toBe(true);
    expect(scope.beginTransition()).toBe(false);
    let finish!: (value: unknown) => void;
    const call = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const connection = scope.forAccount(createChatGptConnection(call), "a");
    for (const action of [connection.status, connection.models, connection.connect, connection.disconnect, connection.cancelConnect, connection.accessToken]) {
      await expect(action()).rejects.toThrow("The Cadence account changed.");
    }
    expect(call).not.toHaveBeenCalled();
    scope.endTransition();
    const pending = connection.connect();
    scope.setAccount("b");
    finish({ state: "connectedWithPlanUsage", email: "a@example.test" });
    await expect(pending).rejects.toThrow("The Cadence account changed.");
    await expect(connection.connect()).rejects.toThrow("The Cadence account changed.");
    expect(call).toHaveBeenCalledOnce();
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
    for (const command of ["chatgpt_status", "chatgpt_connect", "chatgpt_cancel_connect", "chatgpt_disconnect", "chatgpt_models", "chatgpt_access_token"]) {
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
