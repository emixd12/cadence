import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DesktopAuth, DESKTOP_AUTH_CALLBACK, createKeychainStorage, fetchDesktopSignInMethods, GOOGLE_ONLY_SIGN_IN,
  parseDesktopSignInMethods, type DesktopAccountState,
} from "../apps/desktop/src/account/auth";
import { desktopEmailSentCallback, parseDesktopEmailFragment } from "../lib/auth/desktop-sign-in";
import { clientSignInMethods } from "../lib/services/desktop-sign-in.service";

const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  callback: null as ((urls: string[]) => void) | null,
  secrets: new Map<string, string>(),
  metadata: { hostedUserId: "hosted-one", localProfileId: "local-profile" },
  baseline: { hostedUserId: "hosted-one", fingerprint: "saved-baseline" },
  outbox: [{ mutationId: "pending-local-write" }],
  exchangeUserId: "hosted-one",
  oauthProviders: [] as string[],
  opened: [] as string[],
  // Codes the fake Auth server accepts once; a used code fails like a wrong one.
  validCodes: new Set<string>(),
  verified: [] as { email: string; token: string }[],
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
    signInWithOAuth: async ({ provider }: { provider: string }) => {
      native.oauthProviders.push(provider);
      return { data: { url: `https://example.test/oauth/${provider}` }, error: null };
    },
    exchangeCodeForSession: async () => {
      const apple = native.oauthProviders.at(-1) === "apple";
      const session = { access_token: "synthetic-access", user: { id: native.exchangeUserId, email: "owner@example.test", user_metadata: {} },
        ...(apple ? { provider_refresh_token: "synthetic-apple-refresh" } : {}) };
      native.secrets.set("supabase-session", JSON.stringify({ ...session, provider_refresh_token: undefined }));
      return { data: { session }, error: null };
    },
    verifyOtp: async ({ email, token }: { email: string; token: string }) => {
      native.verified.push({ email, token });
      if (!native.validCodes.delete(token)) return { data: { session: null, user: null }, error: { code: "otp_expired", status: 403 } };
      const session = { access_token: "synthetic-access", user: { id: native.exchangeUserId, email, user_metadata: {} } };
      native.secrets.set("supabase-session", JSON.stringify(session));
      return { data: { session, user: session.user }, error: null };
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
    if (command === "auth_open_url") { native.opened.push((args as { url: string }).url); return; }
    if (command === "calendar_cache_clear" || command === "connector_cache_clear") return;
    throw new Error(`Unexpected native command: ${command}`);
  });
  native.callback = null;
  native.secrets.clear(); // The production Keychain cannot read the preview service.
  native.exchangeUserId = "hosted-one";
  native.oauthProviders = [];
  native.opened = [];
  native.validCodes = new Set();
  native.verified = [];
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
  expect(states.at(-1)).toEqual({ status: "local" });
  await auth.begin("google");
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

const ORIGIN = "https://cadence.example.test";

async function startAuth(options: { fetcher?: typeof fetch } = {}) {
  const states: DesktopAccountState[] = [];
  const auth = new DesktopAuth({ url: "https://example.test", key: "synthetic-public-key" }, (state) => states.push(state),
    async () => undefined, ORIGIN, options.fetcher);
  const stop = await auth.initialize();
  return { auth, states, finish: async () => { stop(); await auth.dispose(); } };
}

function pendingFlow() {
  return JSON.parse(native.secrets.get("pending-state")!) as { state: string; createdAt: number; method?: string; email?: string };
}

// Ticket 336 (D31.2): every enabled method links the Mac, through the same guard.
describe("sign-in methods on the Mac", () => {
  it("signs in with Apple through the system browser and hands Apple's token to the hosted app once", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ result: "kept" })));
    const { auth, states, finish } = await startAuth({ fetcher: fetcher as unknown as typeof fetch });
    await auth.begin("apple");
    expect(native.oauthProviders).toEqual(["apple"]);
    expect(native.opened).toEqual(["https://example.test/oauth/apple"]);
    expect(states.at(-1)).toEqual({ status: "waiting", method: "apple" });
    const flow = pendingFlow();
    expect(flow.method).toBe("apple");
    native.callback!([`${DESKTOP_AUTH_CALLBACK}?code=synthetic-code&state=${flow.state}`]);
    await vi.waitFor(() => expect(states.at(-1)).toMatchObject({ status: "linked", userId: "hosted-one" }));
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${ORIGIN}/api/auth/apple-sign-in-token`);
    expect(init.headers).toMatchObject({ Authorization: "Bearer synthetic-access" });
    expect(JSON.parse(init.body as string)).toEqual({ refreshToken: "synthetic-apple-refresh" });
    expect(native.secrets.get("supabase-session")).not.toContain("synthetic-apple-refresh");
    await finish();
  });

  it("does not send a Google sign-in's session to the Apple token route", async () => {
    const fetcher = vi.fn();
    const { auth, states, finish } = await startAuth({ fetcher: fetcher as unknown as typeof fetch });
    await auth.begin("google");
    native.callback!([`${DESKTOP_AUTH_CALLBACK}?code=synthetic-code&state=${pendingFlow().state}`]);
    await vi.waitFor(() => expect(states.at(-1)).toMatchObject({ status: "linked" }));
    expect(fetcher).not.toHaveBeenCalled();
    await finish();
  });

  it("keeps provider tokens out of the Keychain copy of the session", async () => {
    await createKeychainStorage().setItem("cadence-desktop-auth",
      JSON.stringify({ access_token: "a", refresh_token: "r", provider_token: "p", provider_refresh_token: "pr", user: { id: "u" } }));
    expect(JSON.parse(native.secrets.get("supabase-session")!)).toEqual({ access_token: "a", refresh_token: "r", user: { id: "u" } });
  });

  it("links by email when the typed code is right, and keeps the address out of the server's view", async () => {
    const { auth, states, finish } = await startAuth();
    await auth.beginEmail("  Owner@Example.test ");
    const flow = pendingFlow();
    expect(flow).toMatchObject({ method: "email", email: "owner@example.test" });
    expect(native.opened).toHaveLength(1);
    const opened = new URL(native.opened[0]!);
    expect(`${opened.origin}${opened.pathname}`).toBe(`${ORIGIN}/login/email/mac`);
    expect(opened.search).toBe("");
    expect(parseDesktopEmailFragment(opened.hash)).toEqual({ state: flow.state, email: "owner@example.test" });
    expect(states.at(-1)).toEqual({ status: "code", email: "owner@example.test" });

    native.callback!([desktopEmailSentCallback(flow.state)]);
    await Promise.resolve();
    expect(states.at(-1)).toEqual({ status: "code", email: "owner@example.test" });
    expect(native.secrets.has("pending-state")).toBe(true);

    native.validCodes.add("123456");
    await auth.verifyEmailCode("123 456");
    expect(native.verified).toEqual([{ email: "owner@example.test", token: "123456" }]);
    expect(states.at(-1)).toMatchObject({ status: "linked", userId: "hosted-one", email: "owner@example.test" });
    expect(native.secrets.has("pending-state")).toBe(false);
    expect(native.invoke).toHaveBeenCalledWith("auth_record_account_metadata", expect.objectContaining({ hostedUserId: "hosted-one" }));
    await finish();
  });

  it("keeps the request after a wrong code, so a typo can be corrected", async () => {
    const { auth, states, finish } = await startAuth();
    await auth.beginEmail("owner@example.test");
    native.validCodes.add("123456");
    await auth.verifyEmailCode("654321");
    expect(states.at(-1)).toMatchObject({ status: "code", email: "owner@example.test", error: expect.stringContaining("did not work") });
    expect(native.secrets.has("pending-state")).toBe(true);
    expect(native.secrets.has("supabase-session")).toBe(false);
    await auth.verifyEmailCode("12345");
    expect(states.at(-1)).toMatchObject({ status: "code", error: "Enter the 6-digit code from the email." });
    expect(native.verified).toHaveLength(1);
    await auth.verifyEmailCode("123456");
    expect(states.at(-1)).toMatchObject({ status: "linked" });
    await finish();
  });

  it("refuses an email code after an hour without asking the server", async () => {
    const { auth, states, finish } = await startAuth();
    await auth.beginEmail("owner@example.test");
    native.secrets.set("pending-state", JSON.stringify({ ...pendingFlow(), createdAt: Date.now() - 61 * 60_000 }));
    native.validCodes.add("123456");
    await auth.verifyEmailCode("123456");
    expect(states.at(-1)).toEqual({ status: "error", message: "This code is more than an hour old. Start again to get a new one." });
    expect(native.verified).toEqual([]);
    expect(native.secrets.has("pending-state")).toBe(false);
    await finish();
  });

  it("refuses a used code: a second entry finds no request, and the server refuses it too", async () => {
    const { auth, states, finish } = await startAuth();
    await auth.beginEmail("owner@example.test");
    native.validCodes.add("123456");
    await auth.verifyEmailCode("123456");
    expect(states.at(-1)).toMatchObject({ status: "linked" });
    await auth.verifyEmailCode("123456");
    expect(states.at(-1)).toEqual({ status: "error", message: "This code request was already used or cancelled. Start again." });
    expect(native.verified).toHaveLength(1);
    await finish();
  });

  it("refuses an email sign-in to a different account on a linked Mac and removes only its session", async () => {
    const metadata = native.metadata, baseline = native.baseline, outbox = native.outbox;
    native.exchangeUserId = "hosted-two";
    const { auth, states, finish } = await startAuth();
    await auth.beginEmail("other@example.test");
    native.validCodes.add("123456");
    await auth.verifyEmailCode("123456");
    expect(states.at(-1)).toEqual({ status: "error", message: expect.stringContaining("different account") });
    expect(native.secrets.has("supabase-session")).toBe(false);
    expect(native.metadata).toBe(metadata);
    expect(native.baseline).toBe(baseline);
    expect(native.outbox).toBe(outbox);
    expect(native.invoke.mock.calls.map(([command]) => command)).not.toContain("auth_record_account_metadata");
    await finish();
  });

  it("ignores a stray or replayed callback during an email request and keeps the request", async () => {
    const { auth, states, finish } = await startAuth();
    await auth.beginEmail("owner@example.test");
    const flow = pendingFlow();
    native.callback!([`${DESKTOP_AUTH_CALLBACK}?code=stolen&state=${flow.state}`, desktopEmailSentCallback("another-flow")]);
    await vi.waitFor(() => expect(states.at(-1)).toMatchObject({ status: "code", notice: "Cadence ignored a sign-in callback it did not start." }));
    expect(pendingFlow()).toEqual(flow);
    expect(native.secrets.has("supabase-session")).toBe(false);
    await finish();
  });

  it("brings back the code entry after a restart while the code is valid", async () => {
    native.secrets.set("pending-state", JSON.stringify({ state: "s-1", createdAt: Date.now() - 60_000, method: "email", email: "owner@example.test" }));
    const { states, finish } = await startAuth();
    expect(states.at(-1)).toEqual({ status: "code", email: "owner@example.test" });
    await finish();
  });

  it("sends a new code to the same address, replacing the request", async () => {
    const { auth, finish } = await startAuth();
    await auth.beginEmail("owner@example.test");
    const first = pendingFlow();
    await auth.resendEmail();
    expect(pendingFlow()).toMatchObject({ method: "email", email: "owner@example.test" });
    expect(pendingFlow().state).not.toBe(first.state);
    expect(native.opened).toHaveLength(2);
    await finish();
  });

  it("does not start email sign-in without a hosted origin or with an invalid address", async () => {
    const states: DesktopAccountState[] = [];
    const auth = new DesktopAuth({ url: "https://example.test", key: "synthetic-public-key" }, (state) => states.push(state));
    await expect(auth.beginEmail("owner@example.test")).rejects.toThrow("cannot sign in with email");
    const withOrigin = await startAuth();
    await expect(withOrigin.auth.beginEmail("not-an-address")).rejects.toThrow("Enter an email address");
    expect(native.opened).toEqual([]);
    await withOrigin.finish();
    await auth.dispose();
  });
});

describe("which methods the Mac offers", () => {
  it("offers what the hosted app reports as on, in its order", () => {
    expect(parseDesktopSignInMethods(clientSignInMethods({}))).toEqual(GOOGLE_ONLY_SIGN_IN);
    expect(parseDesktopSignInMethods(clientSignInMethods({ CADENCE_SIGN_IN_EMAIL: "on", CADENCE_SIGN_IN_APPLE: "on" })).methods.map((method) => method.id))
      .toEqual(["google", "apple", "email"]);
    expect(parseDesktopSignInMethods(clientSignInMethods({ CADENCE_SIGN_IN_EMAIL: "true" })).methods.map((method) => method.id)).toEqual(["google"]);
  });

  it("falls back to Google alone when the list cannot be read", async () => {
    expect(await fetchDesktopSignInMethods(null)).toEqual(GOOGLE_ONLY_SIGN_IN);
    expect(await fetchDesktopSignInMethods(ORIGIN, (async () => { throw new Error("offline"); }) as unknown as typeof fetch)).toEqual(GOOGLE_ONLY_SIGN_IN);
    expect(await fetchDesktopSignInMethods(ORIGIN, (async () => new Response("", { status: 500 })) as unknown as typeof fetch)).toEqual(GOOGLE_ONLY_SIGN_IN);
    expect(parseDesktopSignInMethods({ methods: [{ id: "chatgpt", label: "Continue with ChatGPT" }], emailCodeLength: 6 })).toEqual(GOOGLE_ONLY_SIGN_IN);
  });

  it("hides email when the hosted code length differs from the one this build accepts", () => {
    expect(parseDesktopSignInMethods({ methods: [{ id: "google", label: "Continue with Google" }, { id: "email", label: "Continue with email" }], emailCodeLength: 8 })
      .methods.map((method) => method.id)).toEqual(["google"]);
  });
});
