import { beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopAuth, DESKTOP_AUTH_CALLBACK, type DesktopAccountState } from "../apps/desktop/src/account/auth";

const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  callback: null as ((urls: string[]) => void) | null,
  secrets: new Map<string, string>(),
  metadata: { hostedUserId: "hosted-one", localProfileId: "local-profile" },
  baseline: { hostedUserId: "hosted-one", fingerprint: "saved-baseline" },
  outbox: [{ mutationId: "pending-local-write" }],
  exchangeUserId: "hosted-one",
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
    signInWithOAuth: async () => ({ data: { url: "https://example.test/oauth" }, error: null }),
    exchangeCodeForSession: async () => {
      const session = { user: { id: native.exchangeUserId, email: "owner@example.test", user_metadata: {} } };
      native.secrets.set("supabase-session", JSON.stringify(session));
      return { data: { session }, error: null };
    },
    signOut: async () => { native.secrets.delete("supabase-session"); },
    dispose: async () => {},
  } }),
}));

beforeEach(() => {
  native.invoke.mockReset().mockImplementation(async (command: string, args?: { name?: string; value?: string; hostedUserId?: string }) => {
    if (command === "auth_secret_get") return native.secrets.get(args!.name!) ?? null;
    if (command === "auth_secret_set") { native.secrets.set(args!.name!, args!.value!); return; }
    if (command === "auth_secret_remove") { native.secrets.delete(args!.name!); return; }
    if (command === "auth_account_metadata") return native.metadata;
    if (command === "auth_record_account_metadata") {
      if (args!.hostedUserId !== native.metadata.hostedUserId) throw new Error("Account mismatch");
      return;
    }
    if (command === "auth_first_link_baseline") return native.baseline;
    if (command === "calendar_cache_clear" || command === "auth_open_url") return;
    throw new Error(`Unexpected native command: ${command}`);
  });
  native.callback = null;
  native.secrets.clear(); // The production Keychain cannot read the preview service.
  native.exchangeUserId = "hosted-one";
});

async function reconnectAs(userId: string) {
  const states: DesktopAccountState[] = [];
  const auth = new DesktopAuth({ url: "https://example.test", key: "synthetic-public-key" }, (state) => states.push(state));
  const stop = await auth.initialize();
  expect(states.at(-1)).toEqual({ status: "local" });
  expect(native.secrets.has("supabase-session")).toBe(false);
  expect(await native.invoke("auth_first_link_baseline")).toBe(native.baseline);

  native.exchangeUserId = userId;
  await auth.reconnect();
  const flow = JSON.parse(native.secrets.get("pending-state")!) as { state: string };
  native.callback!([`${DESKTOP_AUTH_CALLBACK}?code=synthetic-code&state=${flow.state}`]);
  await vi.waitFor(() => expect(states.at(-1)?.status).toBe(userId === "hosted-one" ? "linked" : "error"));
  stop();
  await auth.dispose();
  return states.at(-1);
}

describe("preview to production account reconnection", () => {
  it("preserves the linked SQLite profile, baseline, and pending write for the same account", async () => {
    const metadata = native.metadata, baseline = native.baseline, outbox = native.outbox;
    expect(await reconnectAs("hosted-one")).toMatchObject({ status: "linked", userId: "hosted-one" });
    expect(native.metadata).toBe(metadata);
    expect(native.baseline).toBe(baseline);
    expect(native.outbox).toBe(outbox);
    expect(native.secrets.has("supabase-session")).toBe(true);
    expect(native.invoke).toHaveBeenCalledWith("auth_record_account_metadata", expect.objectContaining({ hostedUserId: "hosted-one" }));
    expect(native.invoke.mock.calls.map(([command]) => command)).not.toContain("auth_clear_account_metadata");
  });

  it("rejects another account and removes only its new session", async () => {
    const metadata = native.metadata, baseline = native.baseline, outbox = native.outbox;
    expect(await reconnectAs("hosted-two")).toMatchObject({ status: "error", message: expect.stringContaining("different account") });
    expect(native.secrets.has("supabase-session")).toBe(false);
    expect(native.metadata).toBe(metadata);
    expect(native.baseline).toBe(baseline);
    expect(native.outbox).toBe(outbox);
    expect(native.invoke.mock.calls.map(([command]) => command)).not.toContain("auth_record_account_metadata");
    expect(native.invoke.mock.calls.map(([command]) => command)).not.toContain("auth_clear_account_metadata");
  });
});
