import { invoke } from "@tauri-apps/api/core";
import type { ExternalEventSnapshotV1 } from "@cadence/core/types/external-event";
import type { CalendarConnectionView, CalendarListEntry, CalendarPreferences } from "@/lib/types/google-calendar";
import type { CalendarCacheRequest } from "./cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DesktopCalendarCoordinator } from "./coordinator";

declare global { interface ImportMetaEnv { readonly VITE_CALENDAR_BROKER_ORIGIN?: string; } }

export const DESKTOP_CALENDAR_CALLBACK = "cadence://calendar/callback";
const PENDING_KEY = "pending-calendar-state";
const MAX_CALLBACK_AGE_MS = 5 * 60_000;
type PendingCalendarConnection = Readonly<{ accountId: string; state: string; createdAt: number }>;

export function readDesktopCalendarBrokerOrigin(value = import.meta.env.VITE_CALENDAR_BROKER_ORIGIN): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return url.toString().replace(/\/$/, "");
  } catch { return null; }
}

export class CalendarBrokerError extends Error {
  constructor(public readonly code: string, public readonly status: number) { super(code); this.name = "CalendarBrokerError"; }
}

export class DesktopCalendarBroker {
  constructor(
    private readonly origin: string,
    private readonly accessToken: () => Promise<string | null>,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    if (!readDesktopCalendarBrokerOrigin(origin)) throw new Error("Calendar broker origin must use HTTPS.");
    this.origin = origin.replace(/\/$/, "");
  }

  connection(): Promise<CalendarConnectionView> { return this.request("/api/google-calendar/connection"); }
  calendars(): Promise<CalendarListEntry[]> {
    return this.request<{ calendars: CalendarListEntry[] }>("/api/google-calendar/calendars").then((value) => value.calendars);
  }
  connect(clientState: string): Promise<{ url: string }> {
    return this.request("/api/google-calendar/connection", { method: "POST", body: JSON.stringify({ target: "desktop", clientState }) });
  }
  async disconnect(): Promise<{ view: CalendarConnectionView; revocationFailed: boolean }> {
    const result = await this.request<CalendarConnectionView & { revocationFailed: boolean }>("/api/google-calendar/connection", { method: "DELETE" });
    const { revocationFailed, ...view } = result;
    return { view, revocationFailed };
  }
  updatePreferences(preferences: CalendarPreferences): Promise<CalendarConnectionView> {
    return this.request("/api/google-calendar/calendars", { method: "PUT", body: JSON.stringify(preferences) });
  }
  events(request: CalendarCacheRequest): Promise<ExternalEventSnapshotV1> {
    const query = new URLSearchParams({ start: request.startLocalDate, end: request.endLocalDate });
    return this.request(`/api/google-calendar/events?${query}`);
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await this.accessToken();
    if (!token) throw new CalendarBrokerError("unauthenticated", 401);
    let response: Response;
    try {
      response = await this.fetcher.call(globalThis, `${this.origin}${path}`, { ...init, cache: "no-store", redirect: "error",
        signal: init.signal ?? AbortSignal.timeout(30_000),
        headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers } });
    } catch { throw new CalendarBrokerError("provider_unavailable", 0); }
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const code = body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : "provider_unavailable";
      throw new CalendarBrokerError(code, response.status);
    }
    return body as T;
  }
}

export function createDesktopCalendarBroker(client: SupabaseClient, origin = readDesktopCalendarBrokerOrigin()): DesktopCalendarBroker | null {
  return origin ? new DesktopCalendarBroker(origin, async () => (await client.auth.getSession()).data.session?.access_token ?? null) : null;
}

export type CalendarEventRange = Readonly<{ startLocalDate: string; endLocalDate: string }>;

export class DesktopGoogleCalendarPanelCoordinator {
  constructor(
    private readonly broker: DesktopCalendarBroker,
    private readonly timezone: () => string,
    private readonly snapshots = new DesktopCalendarCoordinator(broker),
    private readonly connectionFlow = new DesktopCalendarConnection(broker),
    private readonly changed?: (view: CalendarConnectionView | null, snapshot?: ExternalEventSnapshotV1) => void,
  ) {}

  getConnection(): Promise<CalendarConnectionView> { return this.broker.connection(); }
  listCalendars(): Promise<readonly CalendarListEntry[]> { return this.broker.calendars(); }
  async savePreferences(preferences: CalendarPreferences): Promise<CalendarConnectionView> {
    const view = await this.broker.updatePreferences(preferences);
    await this.snapshots.clear();
    this.changed?.(view);
    return view;
  }
  async disconnect(): Promise<{ view: CalendarConnectionView; revocationFailed: boolean }> {
    await Promise.all([this.snapshots.clear(), this.connectionFlow.cancel()]);
    this.changed?.(null);
    const result = await this.broker.disconnect();
    this.changed?.(result.view);
    return result;
  }

  async beginConnect(): Promise<void> {
    const view = await this.broker.connection();
    await this.snapshots.clear();
    this.changed?.(null);
    await this.connectionFlow.begin(view.accountId);
  }

  async refreshEvents(range: CalendarEventRange): Promise<ExternalEventSnapshotV1> {
    const view = await this.broker.connection();
    const request: CalendarCacheRequest = {
      accountId: view.accountId,
      connectionGeneration: view.generation,
      selectionRevision: view.selectionRevision,
      startLocalDate: range.startLocalDate,
      endLocalDate: range.endLocalDate,
      timezone: this.timezone(),
      selectedCalendarIds: [...view.preferences.selectedCalendarIds],
      hiddenCalendarIds: [...view.preferences.hiddenCalendarIds],
      visible: view.preferences.visible,
      showAllDay: view.preferences.showAllDay,
    };
    const result = await this.snapshots.refresh(request, "manual");
    if (result.refreshError) throw new CalendarBrokerError(result.refreshError, 0);
    if (!result.snapshot) throw new CalendarBrokerError("provider_unavailable", 0);
    this.changed?.(view, result.snapshot);
    return result.snapshot;
  }
}

type CalendarConnectionNative = Readonly<{
  get(name: string): Promise<string | null>;
  set(name: string, value: string): Promise<void>;
  remove(name: string): Promise<void>;
  open(url: string): Promise<void>;
}>;

const native: CalendarConnectionNative = {
  get: (name) => invoke("auth_secret_get", { name }),
  set: (name, value) => invoke("auth_secret_set", { name, value }),
  remove: (name) => invoke("auth_secret_remove", { name }),
  open: (url) => invoke("auth_open_url", { url }),
};

export class DesktopCalendarConnection {
  constructor(private readonly broker: DesktopCalendarBroker, private readonly io: CalendarConnectionNative = native) {}

  async begin(accountId: string): Promise<void> {
    const state = randomState();
    const pending: PendingCalendarConnection = { accountId, state, createdAt: Date.now() };
    await this.io.set(PENDING_KEY, JSON.stringify(pending));
    try {
      const { url } = await this.broker.connect(state);
      await this.io.open(url);
    } catch (error) { await this.io.remove(PENDING_KEY); throw error; }
  }

  async complete(value: string, accountId: string, now = Date.now()): Promise<{ result: "connected" | "cancelled" | "error" | "same_account_required"; connection: CalendarConnectionView } | null> {
    if (!isDesktopCalendarCallback(value)) return null;
    const stored = await this.io.get(PENDING_KEY);
    if (!stored) throw new Error("This Calendar connection callback was already used or cancelled.");
    await this.io.remove(PENDING_KEY);
    let pending: PendingCalendarConnection;
    try { pending = JSON.parse(stored) as PendingCalendarConnection; } catch { throw new Error("The pending Calendar connection is invalid."); }
    const result = parseDesktopCalendarCallback(value, pending, accountId, now);
    return { result, connection: await this.broker.connection() };
  }

  cancel(): Promise<void> { return this.io.remove(PENDING_KEY); }
}

export function isDesktopCalendarCallback(value: string): boolean {
  try { const url = new URL(value); return `${url.protocol}//${url.host}${url.pathname}` === DESKTOP_CALENDAR_CALLBACK; }
  catch { return false; }
}

export function parseDesktopCalendarCallback(value: string, pending: PendingCalendarConnection, accountId: string, now: number): "connected" | "cancelled" | "error" | "same_account_required" {
  const url = new URL(value);
  if (!isDesktopCalendarCallback(value) || !pending || pending.accountId !== accountId
    || typeof pending.state !== "string" || !pending.state || !Number.isFinite(pending.createdAt)
    || now < pending.createdAt || now - pending.createdAt > MAX_CALLBACK_AGE_MS
    || url.searchParams.get("state") !== pending.state) throw new Error("Cadence rejected an invalid Calendar connection callback.");
  const result = url.searchParams.get("result");
  if (result !== "connected" && result !== "cancelled" && result !== "error" && result !== "same_account_required") throw new Error("Cadence rejected an invalid Calendar connection result.");
  return result;
}

export function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function openCalendarSourceUrl(url: string): Promise<void> {
  return invoke("auth_open_url", { url });
}
