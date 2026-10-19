"use client";

import { Temporal } from "@js-temporal/polyfill";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  externalEventSnapshotMatchesScope,
  externalEventSnapshotScopeKey,
  validateVersionedExternalEventSnapshot,
} from "@cadence/core/services/external-event-validation";
import {
  applyScopedRecordedActivityRefresh,
  projectRecordedActivityDay,
  RECORDED_ACTIVITY_REFRESH_SECONDS,
  type RecordedActivityDayView,
  type RecordedActivityRefresh,
} from "@cadence/core/services/recorded-activity-refresh";
import { recordedActivitySnapshotScopeKey, validateRecordedActivitySnapshot } from "@cadence/core/services/recorded-activity-validation";
import type { ExternalEventSnapshotScope, ExternalEventSnapshotV1_1 } from "@cadence/core/types/external-event";
import type { RecordedActivitySnapshotScope, RecordedActivitySnapshotV1 } from "@cadence/core/types/recorded-activity";

import type {
  ConnectorConnectionView,
  ConnectorPreferences,
  ConnectorProvider,
  ConnectorRevocationInstruction,
} from "@/lib/types/connectors";
import { registerTimelineConnectorReload } from "./timeline-connector-reloads";

// Ticket 225 client coordinators for Outlook Calendar and Hevy, plus the Ticket
// 227 iCloud Calendar coordinator. They call only
// the hosted routes and carry no credential. Each source keeps its own cache,
// pending requests, and account epoch, so one source failing or clearing never
// changes another source's state.

export type ConnectorCalendarEntry = Readonly<{ id: string; name: string; isDefault: boolean }>;
export type ConnectorEventRange = Readonly<{ startLocalDate: string; endLocalDate: string; timezone: string }>;
export type ConnectorDisconnectResult = Readonly<{ view: ConnectorConnectionView; revocation: ConnectorRevocationInstruction }>;
export type OutlookConnectResult = "started" | "connected" | "cancelled" | "admin_approval_required" | "error" | "expired_attempt" | "ignored";

/** Shared calendar-source operations for Outlook and iCloud. */
export type CalendarConnectorCoordinator = Readonly<{
  getConnection(): Promise<ConnectorConnectionView>;
  listCalendars(): Promise<readonly ConnectorCalendarEntry[]>;
  savePreferences(preferences: ConnectorPreferences): Promise<ConnectorConnectionView>;
  refreshEvents(range: ConnectorEventRange, options?: Readonly<{ force?: boolean }>): Promise<ExternalEventSnapshotV1_1>;
  disconnect(): Promise<ConnectorDisconnectResult>;
}>;

export type OutlookCalendarCoordinator = CalendarConnectorCoordinator & Readonly<{
  beginConnect(): Promise<void>;
}>;

export type IcloudCalendarCoordinator = CalendarConnectorCoordinator & Readonly<{
  /** The caller passes the Apple Account email and app-specific password once; coordinators never store them. */
  connect(appleId: string, appPassword: string): Promise<ConnectorConnectionView>;
}>;

export type CalendarConnectorSource = "outlook_calendar" | "icloud_calendar";

export type HevyCoordinator = Readonly<{
  getConnection(): Promise<ConnectorConnectionView>;
  /** The caller passes the key once; coordinators never store it. */
  connect(apiKey: string): Promise<ConnectorConnectionView>;
  refreshActivities(localDate: string, timezone: string, options?: Readonly<{ force?: boolean }>): Promise<RecordedActivityRefresh>;
  disconnect(): Promise<ConnectorDisconnectResult>;
}>;

/** Client clocks can trail the server; snapshots fetched within this window still validate. */
export const CONNECTOR_CLOCK_SKEW_MS = 5 * 60_000;
const REFRESH_MS = RECORDED_ACTIVITY_REFRESH_SECONDS * 1000;
const OUTLOOK_MAX_SPAN_DAYS = 30;

export class ConnectorClientError extends Error {
  constructor(readonly code: string) { super(code); this.name = "ConnectorClientError"; }
}

export function connectorErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") return error.code;
  return "provider_unavailable";
}

/** Codes that mean the cached view belongs to a connection that no longer applies. */
export function connectorCriticalError(code: string | null): boolean {
  return code === "unauthenticated" || code === "permission_denied" || code === "reconnect_required" || code === "wrong_account"
    || code === "not_connected" || code === "connection_changed" || code === "disconnected" || code === "not_configured";
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { ...init, cache: "no-store", credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...init.headers } });
  } catch { throw new ConnectorClientError("provider_unavailable"); }
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok || !value || typeof value !== "object" || Array.isArray(value)) {
    throw new ConnectorClientError(value && typeof value === "object" && "error" in value && typeof value.error === "string" ? value.error : "provider_unavailable");
  }
  if ("error" in value) throw new ConnectorClientError(typeof value.error === "string" ? value.error : "provider_unavailable");
  return value as T;
}

/** Per-source in-memory state; keys always start with the provider. */
class SourceMemory<T> {
  private readonly cache = new Map<string, T>();
  private readonly pending = new Map<string, Readonly<{ epoch: number; promise: Promise<T> }>>();
  private readonly epochs = new Map<string, number>();
  private activeAccountId: string | null = null;

  epoch(accountId: string): number { return this.epochs.get(accountId) ?? 0; }
  get(key: string): T | undefined { return this.cache.get(key); }
  updateCached(update: (value: T) => T): void {
    for (const [key, value] of this.cache) this.cache.set(key, update(value));
  }
  set(key: string, accountId: string, epoch: number, value: T): boolean {
    if (this.epoch(accountId) !== epoch) return false;
    this.cache.set(key, value);
    return true;
  }
  pendingFor(key: string): Promise<T> | undefined { return this.pending.get(key)?.promise; }
  track(key: string, epoch: number, promise: Promise<T>): Promise<T> {
    this.pending.set(key, { epoch, promise });
    void promise.catch(() => undefined).finally(() => { if (this.pending.get(key)?.epoch === epoch) this.pending.delete(key); });
    return promise;
  }
  /** A different account or a cleared connection invalidates every key for it and advances its epoch. */
  note(accountId: string): void {
    if (this.activeAccountId && this.activeAccountId !== accountId) { this.clear(this.activeAccountId); this.clear(accountId); }
    this.activeAccountId = accountId;
  }
  /** Keeps only the current scope for an account. */
  retainOnly(accountId: string, key: string): void {
    let superseded = false;
    for (const existing of [...this.cache.keys(), ...this.pending.keys()]) {
      if (owner(existing) === accountId && existing !== key) { this.cache.delete(existing); this.pending.delete(existing); superseded = true; }
    }
    if (superseded) this.epochs.set(accountId, this.epoch(accountId) + 1);
  }
  clear(accountId: string): void {
    for (const key of [...this.cache.keys()]) if (owner(key) === accountId) this.cache.delete(key);
    for (const key of [...this.pending.keys()]) if (owner(key) === accountId) this.pending.delete(key);
    this.epochs.set(accountId, this.epoch(accountId) + 1);
  }
}

function owner(key: string): string {
  try { const parsed: unknown = JSON.parse(key); return Array.isArray(parsed) && typeof parsed[1] === "string" ? parsed[1] : ""; }
  catch { return ""; }
}

const OUTLOOK = new SourceMemory<ExternalEventSnapshotV1_1>();
const ICLOUD = new SourceMemory<ExternalEventSnapshotV1_1>();
const HEVY = new SourceMemory<RecordedActivitySnapshotV1>();
const MEMORY: Readonly<Record<ConnectorProvider, { clear(accountId: string): void }>> = { outlook_calendar: OUTLOOK, icloud_calendar: ICLOUD, hevy: HEVY };

/** Clears one source's in-memory web state for an account (disconnect, account change). */
export function clearWebConnectorSource(provider: ConnectorProvider, accountId: string): void {
  MEMORY[provider].clear(accountId);
}

/** Cache scope for one calendar source: source, account, generation, range, timezone, and selection. */
export function calendarEventScope(source: CalendarConnectorSource, connection: ConnectorConnectionView, range: ConnectorEventRange): ExternalEventSnapshotScope {
  return { source, accountId: connection.accountId, connectionGeneration: connection.generation,
    startLocalDate: range.startLocalDate, endLocalDate: range.endLocalDate, timezone: range.timezone,
    selectedCalendarIds: [...connection.preferences.selectedSourceIds] };
}

export function outlookEventScope(connection: ConnectorConnectionView, range: ConnectorEventRange): ExternalEventSnapshotScope {
  return calendarEventScope("outlook_calendar", connection, range);
}

export function hevyActivityScope(connection: ConnectorConnectionView, localDate: string, timezone: string): RecordedActivitySnapshotScope {
  return { source: "hevy", accountId: connection.accountId, connectionGeneration: connection.generation,
    startLocalDate: localDate, endLocalDate: localDate, timezone };
}

/** Validates an Outlook or iCloud 1.1.0 response against the exact requested scope, including its source. */
export function validateCalendarSnapshotForScope(value: unknown, scope: ExternalEventSnapshotScope): ExternalEventSnapshotV1_1 {
  let snapshot: ReturnType<typeof validateVersionedExternalEventSnapshot>;
  try { snapshot = validateVersionedExternalEventSnapshot(value); }
  catch { throw new ConnectorClientError("malformed_provider_response"); }
  if (snapshot.source === "google_calendar" || snapshot.source !== scope.source || !externalEventSnapshotMatchesScope(snapshot, scope)) {
    throw new ConnectorClientError("connection_changed");
  }
  return snapshot as ExternalEventSnapshotV1_1;
}

/** Validates an Outlook 1.1.0 response against the exact requested scope. */
export function validateOutlookSnapshotForScope(value: unknown, scope: ExternalEventSnapshotScope): ExternalEventSnapshotV1_1 {
  if (scope.source !== "outlook_calendar") throw new ConnectorClientError("connection_changed");
  return validateCalendarSnapshotForScope(value, scope);
}

export function validateHevySnapshot(value: unknown, now = Temporal.Now.instant()): RecordedActivitySnapshotV1 {
  try { return validateRecordedActivitySnapshot(value, { now: now.add({ milliseconds: CONNECTOR_CLOCK_SKEW_MS }) }); }
  catch { throw new ConnectorClientError("malformed_provider_response"); }
}

function fetchedRecently(fetchedAt: string): boolean {
  try { const age = Date.now() - Temporal.Instant.from(fetchedAt).epochMilliseconds; return age >= -CONNECTOR_CLOCK_SKEW_MS && age < REFRESH_MS; }
  catch { return false; }
}

/**
 * Ticket 225 web Outlook cache rule, matching desktop and Hevy: a complete read
 * replaces the same-scope entry; an incomplete read never replaces a complete
 * one and is never stored. When a complete entry is kept, it is returned with
 * its original fetch time and a stale freshness, so a failed refresh never
 * claims fresh complete context. `cached` must be the entry for the same scope.
 */
export function applyOutlookCalendarRefresh(cached: ExternalEventSnapshotV1_1 | null, next: ExternalEventSnapshotV1_1): Readonly<{
  snapshot: ExternalEventSnapshotV1_1;
  store: boolean;
}> {
  return applyCalendarConnectorRefresh(cached, next);
}

/** Same cache rule for Outlook and iCloud; the stale label names the snapshot's own source. */
export function applyCalendarConnectorRefresh(cached: ExternalEventSnapshotV1_1 | null, next: ExternalEventSnapshotV1_1): Readonly<{
  snapshot: ExternalEventSnapshotV1_1;
  store: boolean;
}> {
  if (next.completeness === "complete") return { snapshot: next, store: true };
  if (!cached || cached.completeness !== "complete") return { snapshot: next, store: false };
  return { snapshot: { ...cached, freshness: { ...cached.freshness, state: "stale", label: `${CONNECTOR_PROVIDER_NAMES[cached.source]} refresh was incomplete; showing the last complete read`,
    canAssertNoOverlap: false } }, store: false };
}

/** Web calendar-source refresh: one complete-only, per-scope memory per source, fenced by account epoch. */
async function refreshWebCalendarEvents(source: CalendarConnectorSource, memory: SourceMemory<ExternalEventSnapshotV1_1>, basePath: string,
  getConnection: () => Promise<ConnectorConnectionView>, range: ConnectorEventRange, options?: Readonly<{ force?: boolean }>): Promise<ExternalEventSnapshotV1_1> {
  const connection = await getConnection();
  memory.note(connection.accountId);
  if (connection.status !== "connected") { memory.clear(connection.accountId); throw new ConnectorClientError(connection.status); }
  if (connection.preferences.selectedSourceIds.length === 0) throw new ConnectorClientError("no_selected_calendars");
  const scope = calendarEventScope(source, connection, range);
  const key = JSON.stringify([source, connection.accountId, externalEventSnapshotScopeKey(scope), connection.selectionRevision]);
  memory.retainOnly(connection.accountId, key);
  const epoch = memory.epoch(connection.accountId);
  const cached = memory.get(key);
  // Retained complete data keeps its stale warning until a complete refresh succeeds.
  if (!options?.force && cached && fetchedRecently(cached.fetchedAt)) return cached;
  const running = memory.pendingFor(key);
  if (running) return running;
  return memory.track(key, epoch, request<unknown>(`${basePath}/events?${new URLSearchParams({ start: range.startLocalDate, end: range.endLocalDate })}`)
    .then((value) => {
      const applied = applyCalendarConnectorRefresh(memory.get(key) ?? null, validateCalendarSnapshotForScope(value, scope));
      if (memory.epoch(connection.accountId) !== epoch) throw new ConnectorClientError("connection_changed");
      if ((applied.store || cached?.completeness === "complete") && !memory.set(key, connection.accountId, epoch, applied.snapshot)) throw new ConnectorClientError("connection_changed");
      return applied.snapshot;
    }).catch((error: unknown) => {
      if (connectorCriticalError(connectorErrorCode(error))) memory.clear(connection.accountId);
      else if (cached) memory.set(key, connection.accountId, epoch, { ...cached, freshness: { ...cached.freshness,
        state: "stale", canAssertNoOverlap: false, label: `${CONNECTOR_PROVIDER_NAMES[source]} refresh failed; showing the last complete read` } });
      throw error;
    }));
}

async function disconnectWebSource(path: string, memory: { clear(accountId: string): void }): Promise<ConnectorDisconnectResult> {
  const result = await request<ConnectorConnectionView & { revocation: ConnectorRevocationInstruction }>(path, { method: "DELETE" });
  memory.clear(result.accountId);
  const { revocation, ...view } = result;
  return { view, revocation };
}

async function webCalendarConnection(memory: SourceMemory<ExternalEventSnapshotV1_1>, path: string): Promise<ConnectorConnectionView> {
  try { return await request<ConnectorConnectionView>(path); }
  catch (error) {
    memory.updateCached(snapshot => ({ ...snapshot, freshness: { ...snapshot.freshness, state: "stale", canAssertNoOverlap: false,
      label: `${CONNECTOR_PROVIDER_NAMES[snapshot.source]} connection could not refresh; showing the last complete read` } }));
    throw error;
  }
}

export const webOutlookCalendarCoordinator: OutlookCalendarCoordinator = {
  getConnection() { return webCalendarConnection(OUTLOOK, "/api/outlook-calendar/connection"); },
  async beginConnect() {
    const result = await request<{ url: string }>("/api/outlook-calendar/connection", { method: "POST", body: JSON.stringify({ target: "web" }) });
    window.location.assign(result.url);
  },
  async listCalendars() { return (await request<{ calendars: ConnectorCalendarEntry[] }>("/api/outlook-calendar/calendars")).calendars; },
  async savePreferences(preferences) {
    const view = await request<ConnectorConnectionView>("/api/outlook-calendar/calendars", { method: "PUT", body: JSON.stringify(preferences) });
    OUTLOOK.clear(view.accountId);
    return view;
  },
  refreshEvents(range, options) {
    return refreshWebCalendarEvents("outlook_calendar", OUTLOOK, "/api/outlook-calendar", webOutlookCalendarCoordinator.getConnection, range, options);
  },
  disconnect() { return disconnectWebSource("/api/outlook-calendar/connection", OUTLOOK); },
};

/** Ticket 227. Apple login values cross this boundary once, in the POST body, and are never stored on the client. */
export const webIcloudCalendarCoordinator: IcloudCalendarCoordinator = {
  getConnection() { return webCalendarConnection(ICLOUD, "/api/icloud-calendar/connection"); },
  async connect(appleId, appPassword) {
    const view = await request<ConnectorConnectionView>("/api/icloud-calendar/connection", { method: "POST", body: JSON.stringify({ appleId, appPassword }) });
    ICLOUD.clear(view.accountId);
    return view;
  },
  async listCalendars() { return (await request<{ calendars: ConnectorCalendarEntry[] }>("/api/icloud-calendar/calendars")).calendars; },
  async savePreferences(preferences) {
    const view = await request<ConnectorConnectionView>("/api/icloud-calendar/calendars", { method: "PUT", body: JSON.stringify(preferences) });
    ICLOUD.clear(view.accountId);
    return view;
  },
  refreshEvents(range, options) {
    return refreshWebCalendarEvents("icloud_calendar", ICLOUD, "/api/icloud-calendar", webIcloudCalendarCoordinator.getConnection, range, options);
  },
  disconnect() { return disconnectWebSource("/api/icloud-calendar/connection", ICLOUD); },
};

export const webHevyCoordinator: HevyCoordinator = {
  getConnection() { return request<ConnectorConnectionView>("/api/hevy/connection"); },
  async connect(apiKey) {
    const view = await request<ConnectorConnectionView>("/api/hevy/connection", { method: "POST", body: JSON.stringify({ apiKey }) });
    HEVY.clear(view.accountId);
    return view;
  },
  async refreshActivities(localDate, timezone, options) {
    const connection = await webHevyCoordinator.getConnection();
    HEVY.note(connection.accountId);
    if (connection.status !== "connected") { HEVY.clear(connection.accountId); throw new ConnectorClientError(connection.status); }
    const scope = hevyActivityScope(connection, localDate, timezone);
    const key = recordedActivitySnapshotScopeKey(scope);
    HEVY.retainOnly(connection.accountId, key);
    const epoch = HEVY.epoch(connection.accountId);
    const cached = HEVY.get(key) ?? null;
    if (!options?.force && cached && fetchedRecently(cached.fetchedAt)) return { snapshot: cached, replaced: false, refreshFailures: [] };
    const next = await request<unknown>(`/api/hevy/activities?${new URLSearchParams({ start: localDate, end: localDate })}`).then((value) => validateHevySnapshot(value));
    if (HEVY.epoch(connection.accountId) !== epoch) throw new ConnectorClientError("connection_changed");
    const applied = applyScopedRecordedActivityRefresh({ activeScope: scope, cached: HEVY.get(key) ?? null, next });
    if (!applied) throw new ConnectorClientError("connection_changed");
    HEVY.set(key, connection.accountId, epoch, applied.snapshot);
    return applied;
  },
  disconnect() { return disconnectWebSource("/api/hevy/connection", HEVY); },
};

export function outlookCallbackMessage(code: string | null | undefined): string | undefined {
  if (code === "connected") return "Outlook Calendar connected. Choose the calendars Cadence can show.";
  if (code === "cancelled" || code === "consent_denied") return "Outlook Calendar permission was not granted. You can try again.";
  if (code === "admin_approval_required") return "Your organization must approve Cadence before Outlook Calendar can connect.";
  if (code === "wrong_account") return "Another Microsoft account is still connected. Disconnect Outlook Calendar first, then connect the other account.";
  if (code === "expired_attempt") return "That Outlook Calendar connection expired. Start the connection again.";
  if (code === "unauthenticated") return "Sign in to the same Cadence account and connect Outlook Calendar again.";
  if (code === "not_configured") return "Outlook Calendar connection is not configured for this Cadence deployment.";
  if (code === "error" || code === "invalid_request" || code === "provider_unavailable") return "Outlook Calendar connection could not complete. Try connecting again.";
  return undefined;
}

/** Provider-side removal steps. Cadence deletes its own saved access; it never claims the provider revoked it. */
export const CONNECTOR_REVOCATION_COPY: Readonly<Record<ConnectorRevocationInstruction, string>> = {
  microsoft_account_permissions: "To remove Cadence's Microsoft permission too, open Microsoft account privacy app permissions for a personal account, or My Apps for a work or school account, and remove Cadence.",
  hevy_api_key: "To stop this key working anywhere, remove or regenerate it in Hevy settings.",
  apple_app_specific_password: "Apple keeps the app-specific password active, and it can reach more than Calendar, until you remove it. Sign in at account.apple.com, open Sign-In and Security, choose App-Specific Passwords, and remove the Cadence password, or use Revoke All. Changing your Apple Account password also revokes all of them.",
};

export const CONNECTOR_PROVIDER_NAMES: Readonly<Record<ConnectorProvider | "google_calendar", string>> = {
  google_calendar: "Google Calendar",
  outlook_calendar: "Outlook Calendar",
  icloud_calendar: "iCloud Calendar",
  hevy: "Hevy",
};

export type ConnectorTimelineState = "not_loaded" | "not_configured" | "disconnected" | "reconnect_required" | "no_selected_calendars" | "hidden" | "empty" | "ready" | "stale" | "incomplete" | "error";

export type CalendarConnectorTimelineState = Readonly<{
  state: ConnectorTimelineState;
  snapshot: ExternalEventSnapshotV1_1 | null;
  error: string | null;
  hiddenCalendarIds: readonly string[];
  showAllDay: boolean;
}>;
export type OutlookTimelineState = CalendarConnectorTimelineState;
export type IcloudTimelineState = CalendarConnectorTimelineState;

export type HevyTimelineState = Readonly<{
  state: ConnectorTimelineState;
  day: RecordedActivityDayView | null;
  error: string | null;
}>;

/** Outlook range for a Timeline: today through the last visible day, at most 30 days later. */
export function outlookTimelineRange(todayLocalDate: string, lastLocalDate: string | undefined, timezone: string): ConnectorEventRange {
  const today = Temporal.PlainDate.from(todayLocalDate);
  let last = lastLocalDate ? Temporal.PlainDate.from(lastLocalDate) : today;
  if (Temporal.PlainDate.compare(last, today) < 0) last = today;
  const max = today.add({ days: OUTLOOK_MAX_SPAN_DAYS });
  if (Temporal.PlainDate.compare(last, max) > 0) last = max;
  return { startLocalDate: today.toString(), endLocalDate: last.toString(), timezone };
}

function useConnectorPolling(enabled: boolean, refresh: (force?: boolean) => Promise<boolean>, sequence: { current: number }) {
  useEffect(() => {
    if (!enabled) return;
    return registerTimelineConnectorReload(() => refresh(true));
  }, [enabled, refresh]);
  useEffect(() => {
    if (!enabled) return;
    let timer: number | undefined;
    const schedule = () => {
      if (timer !== undefined) window.clearInterval(timer);
      timer = document.hidden ? undefined : window.setInterval(() => void refresh(), REFRESH_MS);
    };
    const onVisibilityChange = () => {
      if (document.hidden) sequence.current += 1;
      schedule();
      if (!document.hidden) void refresh();
    };
    const initial = window.setTimeout(() => void refresh(), 0);
    schedule();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      sequence.current += 1;
      if (timer !== undefined) window.clearInterval(timer);
      window.clearTimeout(initial);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [enabled, refresh, sequence]);
}

function statusState(status: ConnectorConnectionView["status"]): ConnectorTimelineState {
  return status === "not_configured" ? "not_configured" : status === "reconnect_required" ? "reconnect_required" : "disconnected";
}

type CalendarTimelineInput = Readonly<{
  enabled: boolean;
  todayLocalDate: string;
  lastLocalDate: string | undefined;
  timezone: string;
}>;

/** Live Outlook context for the web Timeline. Failures stay inside this source. */
export function useWebOutlookCalendarTimeline(input: CalendarTimelineInput & Readonly<{ coordinator?: OutlookCalendarCoordinator }>): OutlookTimelineState {
  return useWebCalendarConnectorTimeline({ ...input, coordinator: input.coordinator ?? webOutlookCalendarCoordinator });
}

/** Ticket 227: live iCloud context for the web Timeline, with its own cache and failures. */
export function useWebIcloudCalendarTimeline(input: CalendarTimelineInput & Readonly<{ coordinator?: IcloudCalendarCoordinator }>): IcloudTimelineState {
  return useWebCalendarConnectorTimeline({ ...input, coordinator: input.coordinator ?? webIcloudCalendarCoordinator });
}

function useWebCalendarConnectorTimeline(input: CalendarTimelineInput & Readonly<{ coordinator: CalendarConnectorCoordinator }>): CalendarConnectorTimelineState {
  const coordinator = input.coordinator;
  const range = useMemo(() => outlookTimelineRange(input.todayLocalDate, input.lastLocalDate, input.timezone), [input.lastLocalDate, input.timezone, input.todayLocalDate]);
  const empty: CalendarConnectorTimelineState = { state: "not_loaded", snapshot: null, error: null, hiddenCalendarIds: [], showAllDay: true };
  const [state, setState] = useState<CalendarConnectorTimelineState>(empty);
  const sequence = useRef(0);
  const last = useRef<ExternalEventSnapshotV1_1 | null>(null);
  const refresh = useCallback(async (force = false): Promise<boolean> => {
    const current = ++sequence.current;
    const isCurrent = () => current === sequence.current && !document.hidden;
    if (!input.enabled || document.hidden) return false;
    let display = { hiddenCalendarIds: [] as readonly string[], showAllDay: true };
    try {
      const connection = await coordinator.getConnection();
      if (!isCurrent()) return false;
      if (last.current && !externalEventSnapshotMatchesScope(last.current, calendarEventScope(
        last.current.source, connection, range))) last.current = null;
      if (connection.status !== "connected") {
        last.current = null;
        setState({ ...empty, state: statusState(connection.status) });
        return connection.status !== "reconnect_required";
      }
      display = { hiddenCalendarIds: connection.preferences.hiddenSourceIds, showAllDay: connection.preferences.showAllDay };
      if (!connection.preferences.visible || connection.preferences.selectedSourceIds.length === 0) {
        last.current = null;
        setState({ ...empty, ...display, state: connection.preferences.visible ? "no_selected_calendars" : "hidden" });
        return true;
      }
      const snapshot = await coordinator.refreshEvents(range, { force });
      if (!isCurrent()) return false;
      if (snapshot.completeness === "complete") last.current = snapshot;
      const shown = snapshot.completeness === "complete" ? snapshot : last.current ?? snapshot;
      setState({ ...display, snapshot: shown, error: null,
        state: snapshot.completeness !== "complete" ? "incomplete" : shown.freshness.state === "stale" ? "stale" : shown.events.length ? "ready" : "empty" });
      return snapshot.completeness === "complete" && snapshot.freshness.state === "current";
    } catch (error) {
      if (!isCurrent()) return false;
      const code = connectorErrorCode(error);
      if (connectorCriticalError(code)) last.current = null;
      setState({ ...display, state: "error", error: code, snapshot: last.current });
      return false;
    }
  // `empty` is a constant shape rebuilt each render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coordinator, input.enabled, range]);
  useConnectorPolling(input.enabled, refresh, sequence);
  const snapshot = state.snapshot;
  const owned = !snapshot || (snapshot.requestedRange.startLocalDate === range.startLocalDate
    && snapshot.requestedRange.endLocalDate === range.endLocalDate && snapshot.requestedRange.timezone === range.timezone);
  return owned ? state : { ...state, snapshot: null };
}

/** Live recorded Hevy workouts for the current local day on the web Timeline. */
export function useWebHevyActivityTimeline(input: Readonly<{
  enabled: boolean;
  todayLocalDate: string;
  timezone: string;
  coordinator?: HevyCoordinator;
}>): HevyTimelineState {
  const coordinator = input.coordinator ?? webHevyCoordinator;
  const [state, setState] = useState<HevyTimelineState>({ state: "not_loaded", day: null, error: null });
  const sequence = useRef(0);
  const last = useRef<RecordedActivitySnapshotV1 | null>(null);
  const { todayLocalDate, timezone } = input;
  const refresh = useCallback(async (force = false): Promise<boolean> => {
    const current = ++sequence.current;
    const isCurrent = () => current === sequence.current && !document.hidden;
    if (!input.enabled || document.hidden) return false;
    try {
      const result = await coordinator.refreshActivities(todayLocalDate, timezone, { force });
      if (!isCurrent()) return false;
      last.current = result.snapshot;
      const day = projectRecordedActivityDay({ snapshot: result.snapshot, localDate: todayLocalDate, now: Temporal.Now.instant(), refreshFailed: result.refreshFailures.length > 0 });
      setState({ state: day.state === "incomplete" ? "incomplete" : day.state === "stale" ? "stale" : day.items.length ? "ready" : "empty", day, error: result.refreshFailures[0]?.code ?? null });
      return day.state === "current";
    } catch (error) {
      if (!isCurrent()) return false;
      const code = connectorErrorCode(error);
      if (code === "disconnected" || code === "not_configured" || code === "reconnect_required") {
        last.current = null;
        setState({ state: code === "not_configured" ? "not_configured" : code === "reconnect_required" ? "reconnect_required" : "disconnected", day: null, error: null });
        return code !== "reconnect_required";
      }
      if (connectorCriticalError(code)) last.current = null;
      const day = last.current && last.current.requestedRange.startLocalDate === todayLocalDate && last.current.requestedRange.timezone === timezone
        ? projectRecordedActivityDay({ snapshot: last.current, localDate: todayLocalDate, now: Temporal.Now.instant(), refreshFailed: true }) : null;
      setState({ state: "error", day, error: code });
      return false;
    }
  }, [coordinator, input.enabled, timezone, todayLocalDate]);
  useConnectorPolling(input.enabled, refresh, sequence);
  return state.day && state.day.localDate !== todayLocalDate ? { ...state, day: null } : state;
}
