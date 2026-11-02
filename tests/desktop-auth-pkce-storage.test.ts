import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { DesktopAuth } from "../apps/desktop/src/account/auth";

// A Keychain stand-in that accepts only the item names the native layer stores.
const native = vi.hoisted(() => ({ items: new Map<string, string>(), names: [] as string[], opened: [] as string[] }));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: vi.fn(async (command: string, args: { name?: string; value?: string; url?: string }) => {
    if (command === "auth_open_url") { native.opened.push(args.url!); return; }
    if (!["supabase-session", "supabase-pkce", "pending-state"].includes(args.name ?? "")) throw new Error("Unexpected secure key");
    native.names.push(args.name!);
    if (command === "auth_secret_get") return native.items.get(args.name!) ?? null;
    if (command === "auth_secret_set") { native.items.set(args.name!, args.value!); return; }
    if (command === "auth_secret_remove") { native.items.delete(args.name!); return; }
    throw new Error("Unexpected native command");
  }),
}));

afterEach(() => { vi.unstubAllGlobals(); native.items.clear(); native.names = []; native.opened = []; });

it("starts Google sign-in and exchanges the code with Supabase Auth's per-flow PKCE storage", async () => {
  const exchanged: { code_verifier?: string }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(String(input)).toContain("/auth/v1/token?grant_type=pkce");
    exchanged.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ error: "invalid_grant", error_description: "synthetic" }),
      { status: 400, headers: { "Content-Type": "application/json" } });
  }));
  const auth = new DesktopAuth({ url: "https://example.invalid", key: "synthetic-public-key" }, () => {});
  try {
    await auth.begin();
    expect(native.opened).toHaveLength(1);
    const authorize = new URL(native.opened[0]);
    expect(authorize.pathname).toBe("/auth/v1/authorize");
    expect(authorize.searchParams.get("redirect_to")).toMatch(/^cadence:\/\/auth\/callback\?state=/);
    // The fixed verifier stays in the Keychain; the per-flow slot and index never reach it.
    const verifier = JSON.parse(native.items.get("supabase-pkce")!);
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    expect(authorize.searchParams.get("code_challenge")).toBe(challenge);
    expect(new Set(native.names)).toEqual(new Set(["supabase-session", "supabase-pkce", "pending-state"]));

    await auth.accountClient().auth.exchangeCodeForSession("synthetic-code");
    expect(exchanged).toEqual([expect.objectContaining({ auth_code: "synthetic-code", code_verifier: verifier })]);
    expect(native.items.has("supabase-pkce")).toBe(false);
  } finally {
    await auth.dispose();
  }
});
