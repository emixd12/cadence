import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { invoke } from "@tauri-apps/api/core";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { clearTravelSession } from "@/lib/ui/travel";
import {
  DESKTOP_APPLE_TOKEN_ROUTE, DESKTOP_AUTH_CALLBACK, EMAIL_CODE_SENT_PARAM, desktopEmailPageUrl,
} from "@/lib/auth/desktop-sign-in";
import { EMAIL_SIGN_IN_CODE_LENGTH, EMAIL_SIGN_IN_TTL_SECONDS, normalizeEmailAddress, normalizeEmailCode } from "@/lib/auth/email-sign-in";
import type { DesktopSignInMethodId } from "./sign-in-methods";
export * from "./sign-in-methods";

declare global {
  interface ImportMetaEnv {
    readonly VITE_SUPABASE_URL?: string;
    readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
    readonly VITE_SUPABASE_ANON_KEY?: string;
  }
}

export { DESKTOP_AUTH_CALLBACK };
const MAX_FLOW_AGE_MS = 5 * 60_000;
const MAX_EMAIL_FLOW_AGE_MS = EMAIL_SIGN_IN_TTL_SECONDS * 1000;
const STATE_KEY = "pending-state";
/** `method` is absent in flows saved by builds before Ticket 336; they were Google. */
type Pending = { state: string; createdAt: number; method?: DesktopSignInMethodId; email?: string };

export type DesktopAccountState =
  | { status: "local" }
  | { status: "waiting"; method?: "google" | "apple" }
  | { status: "code"; email: string; error?: string; notice?: string }
  | { status: "linked"; userId: string; email: string | null; name?: string | null; notice?: string }
  | { status: "error"; message: string };

const DIFFERENT_ACCOUNT = "Disconnect the current account before signing in with a different account.";
const CODE_REJECTED = "That code did not work. It may be mistyped, used or more than an hour old. Check it, or send a new code.";

type SecureStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

const STORAGE_KEY = "cadence-desktop-auth";
// Supabase Auth 2.118 also writes a verifier slot per PKCE flow and an index of those slots.
// Cadence's redirect carries no flow id, so the code exchange reads only the fixed verifier key.
// The slots and index stay in this process's memory and never reach the Keychain.
const PKCE_FLOW_KEY = new RegExp(`^${STORAGE_KEY}-(?:flow-[A-Za-z0-9_-]{8,64}|flows)-code-verifier$`);
export function createKeychainStorage(): SecureStorage {
  const flowSlots = new Map<string, string>();
  const name = (key: string) => {
    if (key === STORAGE_KEY) return "supabase-session";
    if (key === `${STORAGE_KEY}-code-verifier`) return "supabase-pkce";
    throw new Error("Supabase requested an unknown secure storage key.");
  };
  return {
    getItem: (key) => PKCE_FLOW_KEY.test(key) ? Promise.resolve(flowSlots.get(key) ?? null) : invoke("auth_secret_get", { name: name(key) }),
    setItem: (key, value) => {
      if (!PKCE_FLOW_KEY.test(key)) return invoke("auth_secret_set", { name: name(key), value: key === STORAGE_KEY ? withoutProviderTokens(value) : value });
      flowSlots.set(key, value);
      return Promise.resolve();
    },
    removeItem: (key) => {
      if (!PKCE_FLOW_KEY.test(key)) return invoke("auth_secret_remove", { name: name(key) });
      flowSlots.delete(key);
      return Promise.resolve();
    },
  };
}

/**
 * Ticket 336: the session Supabase returns after Google or Apple carries the provider's own
 * tokens. Cadence never uses them on the Mac, so the Keychain copy leaves them out. Apple's
 * refresh token goes to the hosted app once, for revocation on account deletion.
 */
export function withoutProviderTokens(value: string): string {
  try {
    const session: unknown = JSON.parse(value);
    if (!session || typeof session !== "object" || Array.isArray(session)) return value;
    const rest: Record<string, unknown> = { ...session };
    delete rest.provider_token;
    delete rest.provider_refresh_token;
    return JSON.stringify(rest);
  } catch { return value; }
}

async function pending(action: "get" | "remove", value?: Pending): Promise<Pending | null> {
  if (action === "remove") {
    await invoke("auth_secret_remove", { name: STATE_KEY });
    return null;
  }
  if (value) {
    await invoke("auth_secret_set", { name: STATE_KEY, value: JSON.stringify(value) });
    return value;
  }
  const stored = await invoke<string | null>("auth_secret_get", { name: STATE_KEY });
  if (!stored) return null;
  try { return JSON.parse(stored) as Pending; } catch { await pending("remove"); return null; }
}

export type DesktopAuthEnv = { VITE_SUPABASE_URL?: string; VITE_SUPABASE_PUBLISHABLE_KEY?: string; VITE_SUPABASE_ANON_KEY?: string };
export function readDesktopAuthConfig(env: DesktopAuthEnv = {
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
  VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
}): { url: string; key: string } | null {
  const url = env.VITE_SUPABASE_URL?.trim();
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) return null;
  try { if (new URL(url).protocol !== "https:") return null; } catch { return null; }
  return { url: url.replace(/\/$/, ""), key };
}

export function parseDesktopAuthCallback(value: string, expectedState: string, now: number, createdAt: number, maxAgeMs = MAX_FLOW_AGE_MS):
  { code: string } | { error: string } {
  let url: URL;
  try { url = new URL(value); } catch { return { error: "Cadence received an invalid authentication callback." }; }
  if (`${url.protocol}//${url.host}${url.pathname}` !== DESKTOP_AUTH_CALLBACK) return { error: "Cadence ignored an unknown authentication callback." };
  if (now - createdAt > maxAgeMs || now < createdAt) return { error: "This sign-in request expired. Start again." };
  if (url.searchParams.get("state") !== expectedState) return { error: "Cadence rejected an authentication callback with the wrong state." };
  const providerError = url.searchParams.get("error_description") || url.searchParams.get("error");
  if (providerError) return { error: providerError === "access_denied" ? "Sign-in was cancelled or denied." : "Sign-in did not complete." };
  const code = url.searchParams.get("code");
  return code ? { code } : { error: "The authentication callback did not contain a code." };
}

function emailFlowExpired(flow: Pending, now: number): boolean {
  return now - flow.createdAt > MAX_EMAIL_FLOW_AGE_MS || now < flow.createdAt;
}

export function isEmailCodeSentCallback(value: string, expectedState: string): boolean {
  try {
    const url = new URL(value);
    return url.searchParams.get(EMAIL_CODE_SENT_PARAM) === "sent" && url.searchParams.get("state") === expectedState
      && !url.searchParams.has("code");
  } catch { return false; }
}

export function isDesktopAuthCallback(value: string): boolean {
  try { const url = new URL(value); return `${url.protocol}//${url.host}${url.pathname}` === DESKTOP_AUTH_CALLBACK; }
  catch { return false; }
}

export function desktopAuthRedirect(state: string): string {
  return `${DESKTOP_AUTH_CALLBACK}?state=${encodeURIComponent(state)}`;
}

function client(config: { url: string; key: string }): SupabaseClient {
  return createClient(config.url, config.key, { auth: {
    flowType: "pkce", detectSessionInUrl: false, persistSession: true,
    // Actual account requests refresh expired sessions through getSession().
    autoRefreshToken: false, storageKey: STORAGE_KEY, storage: createKeychainStorage(),
  } });
}

export class DesktopAuth {
  private readonly supabase: SupabaseClient;
  private readonly changed: (state: DesktopAccountState) => void;
  private current: DesktopAccountState | null = null;
  constructor(config: { url: string; key: string }, changed: (state: DesktopAccountState) => void,
    private readonly disconnectChatGpt: () => Promise<unknown> = () => invoke("chatgpt_disconnect"),
    /** The hosted Cadence origin. Email sign-in and Apple's token handoff need it. */
    private readonly hostedOrigin: string | null = null,
    private readonly fetcher: typeof fetch = (input, init) => fetch(input, init)) {
    this.supabase = client(config);
    this.changed = (state) => { this.current = state; changed(state); };
  }

  async initialize(): Promise<() => void> {
    const { data, error } = await this.supabase.auth.getSession();
    let session = data.session;
    if (session) {
      try {
        const metadata = await this.metadata();
        if (metadata && metadata.hostedUserId !== session.user.id) throw new Error("account mismatch");
        await this.record(session);
      } catch {
        await this.clearLocalSession();
        session = null;
        this.changed({ status: "error", message: "The saved account session does not match this local profile. Disconnect before using another account." });
      }
    }
    if (!session || error) {
      await clearDesktopCalendarClientState();
      const flow = error ? null : await pending("get");
      // A code request survives a restart for as long as the emailed code is valid.
      if (flow?.method === "email" && flow.email && !emailFlowExpired(flow, Date.now())) this.changed({ status: "code", email: flow.email });
      else this.changed(error ? { status: "error", message: "The saved account session could not be read." } : { status: "local" });
    }
    else this.changed(accountStateFromSession(session));
    const stop = await onOpenUrl((urls) => void this.completeCallbacks(urls));
    await this.completeCallbacks((await getCurrent()) ?? []);
    return stop;
  }

  /** Google and Apple: the system browser, then the PKCE callback. */
  async begin(method: "google" | "apple" = "google"): Promise<void> {
    const { data: current } = await this.supabase.auth.getSession();
    if (current.session) { this.changed(accountStateFromSession(current.session)); return; }
    const state = crypto.randomUUID();
    await pending("get", { state, createdAt: Date.now(), method });
    const redirectTo = desktopAuthRedirect(state);
    const { data, error } = await this.supabase.auth.signInWithOAuth({ provider: method, options: { redirectTo, skipBrowserRedirect: true } });
    if (error || !data.url) { await this.cancel(); throw new Error("Sign-in could not start."); }
    await invoke("auth_open_url", { url: data.url });
    this.changed({ status: "waiting", method });
  }

  /**
   * Email: the system browser opens Cadence's page, which passes the bot check and
   * sends the code. The person types the code here; no link or secret reaches the Mac.
   */
  async beginEmail(address: string): Promise<void> {
    const email = normalizeEmailAddress(address);
    if (!email) throw new Error("Enter an email address, like name@example.com.");
    if (!this.hostedOrigin) throw new Error("This version of Cadence cannot sign in with email.");
    const { data: current } = await this.supabase.auth.getSession();
    if (current.session) { this.changed(accountStateFromSession(current.session)); return; }
    const state = crypto.randomUUID();
    await Promise.all([pending("get", { state, createdAt: Date.now(), method: "email", email }),
      invoke("auth_secret_remove", { name: "supabase-pkce" })]);
    await invoke("auth_open_url", { url: desktopEmailPageUrl(this.hostedOrigin, { state, email }) });
    this.changed({ status: "code", email });
  }

  /** Sends a new code to the same address. The code from the previous email stops working. */
  async resendEmail(): Promise<void> {
    const flow = await pending("get");
    if (flow?.method !== "email" || !flow.email) { this.changed({ status: "error", message: "Enter your email address again to get a new code." }); return; }
    await this.beginEmail(flow.email);
  }

  async verifyEmailCode(input: string): Promise<void> {
    const flow = await pending("get");
    if (flow?.method !== "email" || !flow.email) {
      this.changed({ status: "error", message: "This code request was already used or cancelled. Start again." });
      return;
    }
    const email = flow.email;
    if (emailFlowExpired(flow, Date.now())) {
      await pending("remove");
      this.changed({ status: "error", message: "This code is more than an hour old. Start again to get a new one." });
      return;
    }
    const token = normalizeEmailCode(input);
    if (!token) { this.changed({ status: "code", email, error: `Enter the ${EMAIL_SIGN_IN_CODE_LENGTH}-digit code from the email.` }); return; }
    const current = await this.supabase.auth.getSession();
    if (current.data.session) {
      await pending("remove");
      this.changed(accountStateFromSession(current.data.session, DIFFERENT_ACCOUNT));
      return;
    }
    const metadata = await this.metadata();
    const { data, error } = await this.supabase.auth.verifyOtp({ email, token, type: "email" });
    // A wrong code keeps the request, so the person can correct a typo. Supabase Auth
    // limits verify attempts, and a used or expired code fails the same way.
    if (error || !data.session) { this.changed({ status: "code", email, error: CODE_REJECTED }); return; }
    await pending("remove");
    await this.finishSignIn(data.session, metadata);
  }

  async cancel(): Promise<void> {
    await Promise.all([pending("remove"), invoke("auth_secret_remove", { name: "supabase-pkce" })]);
    this.changed({ status: "local" });
  }

  async cancelLink(): Promise<void> {
    await cancelDesktopAccountLink(() => this.clearLocalSession(), () => invoke("auth_clear_account_metadata"),
      this.disconnectChatGpt);
    this.changed({ status: "local" });
  }

  /** After a revoked session: clear it and let the person choose a method again. */
  async reconnect(): Promise<void> {
    await reconnectDesktopAccount(() => this.clearLocalSession(), async () => { this.changed({ status: "local" }); });
  }

  async disconnect(mode: "keep" | "remove"): Promise<{ backupPath: string | null; databasePath: string }> {
    const result = await disconnectDesktopAccount(mode, () => this.clearLocalSession(), () => pending("remove"),
      (command) => invoke<{ backupPath: string | null; path: string }>(command), this.disconnectChatGpt);
    this.changed({ status: "local" });
    return { backupPath: result.backupPath, databasePath: result.path };
  }

  accountClient(): SupabaseClient { return this.supabase; }

  dispose(): Promise<void> { return this.supabase.auth.dispose(); }

  firstLinkBaseline(): Promise<{ hostedUserId: string; idempotencyKey: string; baselineFingerprint: string } | null> {
    return invoke("auth_first_link_baseline");
  }

  // A stray, replayed or expired callback is rejected without replacing a working linked state.
  private rejectCallback(message: string): void {
    const current = this.current;
    this.changed(current?.status === "linked" ? { ...current, notice: message }
      : current?.status === "code" ? { ...current, notice: message } : { status: "error", message });
  }

  private async completeCallbacks(urls: string[]): Promise<void> {
    for (const value of urls) if (isDesktopAuthCallback(value)) await this.complete(value);
  }

  private async complete(value: string): Promise<void> {
    const flow = await pending("get");
    if (!flow) { this.rejectCallback("This sign-in callback was already used or cancelled."); return; }
    if (flow.method === "email") {
      // An email flow ends only with a typed code. Its page's "Return to Cadence" link only
      // brings the app forward; any other callback is stray and leaves the request alone.
      if (!isEmailCodeSentCallback(value, flow.state)) this.rejectCallback("Cadence ignored a sign-in callback it did not start.");
      return;
    }
    const result = parseDesktopAuthCallback(value, flow.state, Date.now(), flow.createdAt);
    await pending("remove"); // Consume before exchange. Supabase authorization codes are single-use.
    if ("error" in result) { await invoke("auth_secret_remove", { name: "supabase-pkce" }); this.rejectCallback(result.error); return; }
    const current = await this.supabase.auth.getSession();
    if (current.data.session) {
      await invoke("auth_secret_remove", { name: "supabase-pkce" });
      this.changed(accountStateFromSession(current.data.session, DIFFERENT_ACCOUNT));
      return;
    }
    const metadata = await this.metadata();
    const { data, error } = await this.supabase.auth.exchangeCodeForSession(result.code);
    if (error || !data.session) { this.changed({ status: "error", message: "Sign-in could not be completed. Start again." }); return; }
    if (!(await this.finishSignIn(data.session, metadata))) return;
    if (flow.method === "apple") await this.handOverAppleToken(data.session);
  }

  /** The different-account guard, then the Keychain session and local metadata. */
  private async finishSignIn(session: Session, metadata: { hostedUserId: string } | null): Promise<boolean> {
    if (metadata && metadata.hostedUserId !== session.user.id) {
      await this.clearLocalSession();
      this.changed({ status: "error", message: DIFFERENT_ACCOUNT });
      return false;
    }
    try { await this.record(session); }
    catch { await this.clearLocalSession(); this.changed({ status: "error", message: "The account session could not be linked to this local profile." }); return false; }
    this.changed(accountStateFromSession(session));
    return true;
  }

  // Ticket 333 (L-025): the hosted app seals Apple's refresh token for revocation on account
  // deletion. A failure never blocks the sign-in, as on the web.
  private async handOverAppleToken(session: Session): Promise<void> {
    const refreshToken = session.provider_refresh_token;
    if (!this.hostedOrigin || !refreshToken) return;
    await this.fetcher(`${this.hostedOrigin}${DESKTOP_APPLE_TOKEN_ROUTE}`, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    }).catch(() => undefined);
  }

  private record(session: Session): Promise<void> {
    return invoke("auth_record_account_metadata", {
      hostedUserId: session.user.id,
      email: session.user.email ?? null,
      authenticatedAt: new Date().toISOString(),
    });
  }

  private metadata(): Promise<{ hostedUserId: string } | null> {
    return invoke("auth_account_metadata");
  }

  private async clearLocalSession(): Promise<void> {
    // Ticket 268: today's travel display is session memory only; it leaves with the account.
    clearTravelSession();
    await this.supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    await Promise.all([
      invoke("auth_secret_remove", { name: "supabase-session" }),
      invoke("auth_secret_remove", { name: "supabase-pkce" }),
      clearDesktopCalendarClientState(),
    ]);
  }
}

export async function clearDesktopCalendarClientState(
  call: (command: string, args?: Record<string, unknown>) => Promise<unknown> = (command, args) => invoke(command, args),
): Promise<void> {
  await Promise.all([
    call("auth_secret_remove", { name: "pending-calendar-state" }),
    call("auth_secret_remove", { name: "pending-calendar-agent-state" }),
    call("calendar_cache_clear"),
    // Ticket 238: connector source caches and any pending Outlook attempt.
    call("auth_secret_remove", { name: "pending-outlook-calendar-attempt" }),
    call("connector_cache_clear", { provider: null }),
  ]);
}

/**
 * Owner decision, November 12, 2026: disconnecting the Cadence account also disconnects
 * ChatGPT. Rust revokes the refresh token at OpenAI, then clears the `chatgpt-session`
 * Keychain item; the installation item stays. A failed revocation returns a normal outcome
 * after clearing local tokens. A storage failure must stop the account change, so another
 * Cadence account cannot inherit the previous account's ChatGPT session.
 */
export async function disconnectDesktopAccount(mode: "keep" | "remove", clearSecrets: () => Promise<void>, clearPending: () => Promise<unknown>,
  disconnectNative: (command: "disconnect_keep_local_copy" | "disconnect_remove_account_data") => Promise<{ backupPath: string | null; path: string }>,
  disconnectChatGpt: () => Promise<unknown> = async () => undefined) {
  await disconnectChatGpt();
  await clearSecrets();
  await clearPending();
  return disconnectNative(mode === "keep" ? "disconnect_keep_local_copy" : "disconnect_remove_account_data");
}

/** Cancelling the first account link also ends the ChatGPT session before another account can sign in. */
export async function cancelDesktopAccountLink(clearSecrets: () => Promise<void>, clearMetadata: () => Promise<unknown>,
  disconnectChatGpt: () => Promise<unknown>) {
  await disconnectChatGpt();
  await clearSecrets();
  await clearMetadata();
}

export async function reconnectDesktopAccount(clearLocalSession: () => Promise<void>, beginOAuth: () => Promise<void>) {
  await clearLocalSession();
  await beginOAuth();
}

export function accountStateFromSession(session: Session | null, notice?: string): DesktopAccountState {
  const metadata = session?.user.user_metadata;
  const name = [metadata?.full_name, metadata?.name].find((value) => typeof value === "string" && value.trim());
  return session ? { status: "linked", userId: session.user.id, email: session.user.email ?? null, name: name?.trim() ?? null,
    ...(notice ? { notice } : {}) } : { status: "local" };
}
