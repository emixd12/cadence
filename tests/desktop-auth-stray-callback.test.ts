import { beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopAuth, DESKTOP_AUTH_CALLBACK, type DesktopAccountState } from "../apps/desktop/src/account/auth";

// Ticket 178 replay acceptance: a stray, replayed or expired sign-in callback must be
// rejected without replacing a working linked session.
const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  callback: null as ((urls: string[]) => void) | null,
  secrets: new Map<string, string>(),
  exchanged: 0,
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke, isTauri: () => true }));
vi.mock("@tauri-apps/plugin-deep-link", () => ({
  onOpenUrl: async (callback: (urls: string[]) => void) => { native.callback = callback; return () => { native.callback = null; }; },
  getCurrent: async () => [],
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: {
    getSession: async () => ({ data: { session: native.secrets.has("supabase-session")
      ? JSON.parse(native.secrets.get("supabase-session")!) : null }, error: null }),
    exchangeCodeForSession: async () => { native.exchanged += 1; return { data: { session: null }, error: new Error("not expected") }; },
    signOut: async () => { native.secrets.delete("supabase-session"); },
    dispose: async () => {},
  } }),
}));

const STRAY = `${DESKTOP_AUTH_CALLBACK}?state=qa-replay&code=qa-replay`;

beforeEach(() => {
  native.invoke.mockReset().mockImplementation(async (command: string, args?: { name?: string; value?: string }) => {
    if (command === "auth_secret_get") return native.secrets.get(args!.name!) ?? null;
    if (command === "auth_secret_set") { native.secrets.set(args!.name!, args!.value!); return; }
    if (command === "auth_secret_remove") { native.secrets.delete(args!.name!); return; }
    if (command === "auth_account_metadata") return { hostedUserId: "hosted-one", localProfileId: "local-profile" };
    if (command === "auth_record_account_metadata" || command === "calendar_cache_clear") return;
    throw new Error(`Unexpected native command: ${command}`);
  });
  native.callback = null;
  native.secrets.clear();
  native.exchanged = 0;
});

async function start(signedIn: boolean) {
  if (signedIn) native.secrets.set("supabase-session", JSON.stringify({ user: { id: "hosted-one", email: "owner@example.test", user_metadata: {} } }));
  const states: DesktopAccountState[] = [];
  const auth = new DesktopAuth({ url: "https://example.test", key: "synthetic-public-key" }, (state) => states.push(state));
  const stop = await auth.initialize();
  return { states, finish: async () => { stop(); await auth.dispose(); } };
}

describe("stray desktop sign-in callbacks", () => {
  it("keeps a linked session and shows a notice for a replayed callback", async () => {
    const { states, finish } = await start(true);
    expect(states.at(-1)).toMatchObject({ status: "linked", userId: "hosted-one" });
    native.callback!([STRAY]);
    await vi.waitFor(() => expect(states.at(-1)).toMatchObject({ status: "linked", userId: "hosted-one",
      notice: "This sign-in callback was already used or cancelled." }));
    expect(native.secrets.has("supabase-session")).toBe(true);
    expect(native.exchanged).toBe(0);
    await finish();
  });

  it("keeps a linked session when an expired sign-in callback arrives", async () => {
    const { states, finish } = await start(true);
    native.secrets.set("pending-state", JSON.stringify({ state: "old-flow", createdAt: Date.now() - 10 * 60_000 }));
    native.secrets.set("supabase-pkce", "synthetic-verifier");
    native.callback!([`${DESKTOP_AUTH_CALLBACK}?state=old-flow&code=old-code`]);
    await vi.waitFor(() => expect(states.at(-1)).toMatchObject({ status: "linked", notice: "This sign-in request expired. Start again." }));
    expect(native.secrets.has("pending-state")).toBe(false);
    expect(native.secrets.has("supabase-pkce")).toBe(false);
    expect(native.secrets.has("supabase-session")).toBe(true);
    expect(native.exchanged).toBe(0);
    await finish();
  });

  it("still reports a stray callback as an error when no account is linked", async () => {
    const { states, finish } = await start(false);
    expect(states.at(-1)).toEqual({ status: "local" });
    native.callback!([STRAY]);
    await vi.waitFor(() => expect(states.at(-1)).toEqual({ status: "error", message: "This sign-in callback was already used or cancelled." }));
    expect(native.exchanged).toBe(0);
    await finish();
  });

  it("keeps the linked session when a pending callback arrives after sign-in", async () => {
    const { states, finish } = await start(true);
    native.secrets.set("pending-state", JSON.stringify({ state: "late-flow", createdAt: Date.now() }));
    native.secrets.set("supabase-pkce", "synthetic-verifier");
    native.callback!([`${DESKTOP_AUTH_CALLBACK}?state=late-flow&code=late-code`]);
    await vi.waitFor(() => expect(states.at(-1)).toMatchObject({ status: "linked", userId: "hosted-one",
      notice: "Disconnect the current account before signing in with a different account." }));
    expect(native.secrets.has("pending-state")).toBe(false);
    expect(native.secrets.has("supabase-pkce")).toBe(false);
    expect(native.secrets.has("supabase-session")).toBe(true);
    expect(native.exchanged).toBe(0);
    await finish();
  });
});
