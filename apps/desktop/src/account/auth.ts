import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { invoke } from "@tauri-apps/api/core";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";

declare global {
  interface ImportMetaEnv {
    readonly VITE_SUPABASE_URL?: string;
    readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
    readonly VITE_SUPABASE_ANON_KEY?: string;
  }
}

export const DESKTOP_AUTH_CALLBACK = "cadence://auth/callback";
const MAX_FLOW_AGE_MS = 5 * 60_000;
const STATE_KEY = "pending-state";
type Pending = { state: string; createdAt: number };

export type DesktopAccountState =
  | { status: "local" }
  | { status: "waiting" }
  | { status: "linked"; userId: string; email: string | null; name?: string | null }
  | { status: "error"; message: string };

type SecureStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

const STORAGE_KEY = "cadence-desktop-auth";
export function createKeychainStorage(): SecureStorage {
  const name = (key: string) => {
    if (key === STORAGE_KEY) return "supabase-session";
    if (key === `${STORAGE_KEY}-code-verifier`) return "supabase-pkce";
    throw new Error("Supabase requested an unknown secure storage key.");
  };
  return {
    getItem: (key) => invoke("auth_secret_get", { name: name(key) }),
    setItem: (key, value) => invoke("auth_secret_set", { name: name(key), value }),
    removeItem: (key) => invoke("auth_secret_remove", { name: name(key) }),
  };
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

export function parseDesktopAuthCallback(value: string, expectedState: string, now: number, createdAt: number):
  { code: string } | { error: string } {
  let url: URL;
  try { url = new URL(value); } catch { return { error: "Cadence received an invalid authentication callback." }; }
  if (`${url.protocol}//${url.host}${url.pathname}` !== DESKTOP_AUTH_CALLBACK) return { error: "Cadence ignored an unknown authentication callback." };
  if (now - createdAt > MAX_FLOW_AGE_MS || now < createdAt) return { error: "This sign-in request expired. Start again." };
  if (url.searchParams.get("state") !== expectedState) return { error: "Cadence rejected an authentication callback with the wrong state." };
  const providerError = url.searchParams.get("error_description") || url.searchParams.get("error");
  if (providerError) return { error: providerError === "access_denied" ? "Google sign-in was cancelled or denied." : "Google sign-in did not complete." };
  const code = url.searchParams.get("code");
  return code ? { code } : { error: "The authentication callback did not contain a code." };
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
  constructor(config: { url: string; key: string }, private readonly changed: (state: DesktopAccountState) => void) {
    this.supabase = client(config);
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
      this.changed(error ? { status: "error", message: "The saved account session could not be read." } : { status: "local" });
    }
    else this.changed(accountStateFromSession(session));
    const stop = await onOpenUrl((urls) => void this.completeCallbacks(urls));
    await this.completeCallbacks((await getCurrent()) ?? []);
    return stop;
  }

  async begin(): Promise<void> {
    const { data: current } = await this.supabase.auth.getSession();
    if (current.session) { this.changed(accountStateFromSession(current.session)); return; }
    const state = crypto.randomUUID();
    await pending("get", { state, createdAt: Date.now() });
    const redirectTo = desktopAuthRedirect(state);
    const { data, error } = await this.supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo, skipBrowserRedirect: true } });
    if (error || !data.url) { await this.cancel(); throw new Error("Google sign-in could not start."); }
    await invoke("auth_open_url", { url: data.url });
    this.changed({ status: "waiting" });
  }

  async cancel(): Promise<void> {
    await Promise.all([pending("remove"), invoke("auth_secret_remove", { name: "supabase-pkce" })]);
    this.changed({ status: "local" });
  }

  async cancelLink(): Promise<void> {
    await this.clearLocalSession();
    await invoke("auth_clear_account_metadata");
    this.changed({ status: "local" });
  }

  async reconnect(): Promise<void> {
    await reconnectDesktopAccount(() => this.clearLocalSession(), () => this.begin());
  }

  async disconnect(mode: "keep" | "remove"): Promise<{ backupPath: string | null; databasePath: string }> {
    const result = await disconnectDesktopAccount(mode, () => this.clearLocalSession(), () => pending("remove"),
      (command) => invoke<{ backupPath: string | null; path: string }>(command));
    this.changed({ status: "local" });
    return { backupPath: result.backupPath, databasePath: result.path };
  }

  accountClient(): SupabaseClient { return this.supabase; }

  dispose(): Promise<void> { return this.supabase.auth.dispose(); }

  firstLinkBaseline(): Promise<{ hostedUserId: string; idempotencyKey: string; baselineFingerprint: string } | null> {
    return invoke("auth_first_link_baseline");
  }

  private async completeCallbacks(urls: string[]): Promise<void> {
    for (const value of urls) if (isDesktopAuthCallback(value)) await this.complete(value);
  }

  private async complete(value: string): Promise<void> {
    const flow = await pending("get");
    if (!flow) { this.changed({ status: "error", message: "This sign-in callback was already used or cancelled." }); return; }
    const result = parseDesktopAuthCallback(value, flow.state, Date.now(), flow.createdAt);
    await pending("remove"); // Consume before exchange. Supabase authorization codes are single-use.
    if ("error" in result) { await invoke("auth_secret_remove", { name: "supabase-pkce" }); this.changed({ status: "error", message: result.error }); return; }
    const current = await this.supabase.auth.getSession();
    if (current.data.session) { await invoke("auth_secret_remove", { name: "supabase-pkce" }); this.changed({ status: "error", message: "Disconnect the current account before signing in with a different account." }); return; }
    const metadata = await this.metadata();
    const { data, error } = await this.supabase.auth.exchangeCodeForSession(result.code);
    if (error || !data.session) { this.changed({ status: "error", message: "Google sign-in could not be completed. Start again." }); return; }
    if (metadata && metadata.hostedUserId !== data.session.user.id) {
      await this.clearLocalSession();
      this.changed({ status: "error", message: "Disconnect the current account before signing in with a different account." });
      return;
    }
    try { await this.record(data.session); }
    catch { await this.clearLocalSession(); this.changed({ status: "error", message: "The account session could not be linked to this local profile." }); return; }
    this.changed(accountStateFromSession(data.session));
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
    call("calendar_cache_clear"),
  ]);
}

export async function disconnectDesktopAccount(mode: "keep" | "remove", clearSecrets: () => Promise<void>, clearPending: () => Promise<unknown>,
  disconnectNative: (command: "disconnect_keep_local_copy" | "disconnect_remove_account_data") => Promise<{ backupPath: string | null; path: string }>) {
  await clearSecrets();
  await clearPending();
  return disconnectNative(mode === "keep" ? "disconnect_keep_local_copy" : "disconnect_remove_account_data");
}

export async function reconnectDesktopAccount(clearLocalSession: () => Promise<void>, beginOAuth: () => Promise<void>) {
  await clearLocalSession();
  await beginOAuth();
}

export function accountStateFromSession(session: Session | null): DesktopAccountState {
  const metadata = session?.user.user_metadata;
  const name = [metadata?.full_name, metadata?.name].find((value) => typeof value === "string" && value.trim());
  return session ? { status: "linked", userId: session.user.id, email: session.user.email ?? null, name: name?.trim() ?? null } : { status: "local" };
}
