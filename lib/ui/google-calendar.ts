"use client";

import { Temporal } from "@js-temporal/polyfill";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { validateExternalEventSnapshot } from "@cadence/core/services/external-event-validation";
import type { ExternalEventSnapshotV1 } from "@cadence/core/types/external-event";

import type {
  CalendarConnectionView,
  CalendarListEntry,
  CalendarPreferences,
} from "@/lib/types/google-calendar";

export type CalendarEventRange = Readonly<{
  startLocalDate: string;
  endLocalDate: string;
  timezone?: string;
}>;

export type GoogleCalendarCoordinator = Readonly<{
  getConnection: () => Promise<CalendarConnectionView>;
  beginConnect: () => Promise<void>;
  listCalendars: () => Promise<readonly CalendarListEntry[]>;
  savePreferences: (preferences: CalendarPreferences) => Promise<CalendarConnectionView>;
  refreshEvents: (range: CalendarEventRange, options?: Readonly<{ force?: boolean }>) => Promise<ExternalEventSnapshotV1>;
  disconnect: () => Promise<Readonly<{ view: CalendarConnectionView; revocationFailed: boolean }>>;
}>;

export type WebCalendarTimelineState = Readonly<{
  state: "not_loaded" | "not_configured" | "disconnected" | "no_selected_calendars" | "empty" | "ready" | "stale" | "error";
  snapshot: ExternalEventSnapshotV1 | null;
  error: string | null;
  hiddenCalendarIds: readonly string[];
  showAllDay: boolean;
}>;

const EVENT_CACHE = new Map<string, ExternalEventSnapshotV1>();
type PendingEvents = Readonly<{ accountId: string; epoch: number; promise: Promise<ExternalEventSnapshotV1> }>;

const PENDING_EVENTS = new Map<string, PendingEvents>();
const ACCOUNT_EPOCHS = new Map<string, number>();
const TIMELINE_RELOADS = new Set<() => Promise<boolean>>();
const EVENT_REFRESH_MS = 15 * 60_000;
let activeAccountId: string | null = null;

export async function reloadWebTimelineConnectors(): Promise<boolean> {
  const results = await Promise.all([...TIMELINE_RELOADS].map((reload) => reload()));
  return results.every(Boolean);
}

export const webGoogleCalendarCoordinator: GoogleCalendarCoordinator = {
  async getConnection() {
    return request<CalendarConnectionView>("/api/google-calendar/connection");
  },
  async beginConnect() {
    const result = await request<{ url: string }>("/api/google-calendar/connection", {
      method: "POST",
      body: JSON.stringify({ target: "web" }),
    });
    window.location.assign(result.url);
  },
  async listCalendars() {
    const result = await request<{ calendars: CalendarListEntry[] }>("/api/google-calendar/calendars");
    return result.calendars;
  },
  async savePreferences(preferences) {
    const view = await request<CalendarConnectionView>("/api/google-calendar/calendars", {
      method: "PUT",
      body: JSON.stringify(preferences),
    });
    clearAccount(view.accountId);
    return view;
  },
  async refreshEvents(range, options) {
    const connection = await webGoogleCalendarCoordinator.getConnection();
    noteConnection(connection);
    if (connection.status !== "connected") {
      clearAccount(connection.accountId);
      throw new CalendarClientError(connection.status);
    }
    const key = eventKey(connection, range);
    evictSuperseded(connection, key);
    const epoch = accountEpoch(connection.accountId);
    const cached = EVENT_CACHE.get(key);
    if (!options?.force && cached && elapsedSince(cached.fetchedAt) < EVENT_REFRESH_MS) return cached;
    const pending = PENDING_EVENTS.get(key);
    if (pending) return pending.promise;
    const requestPromise = request<unknown>(`/api/google-calendar/events?${new URLSearchParams({ start: range.startLocalDate, end: range.endLocalDate })}`)
      .then((value) => {
        const snapshot = validateExternalEventSnapshot(value);
        if (!matchesRequest(snapshot, connection, range) || accountEpoch(connection.accountId) !== epoch) {
          throw new CalendarClientError("connection_changed");
        }
        EVENT_CACHE.set(key, snapshot);
        return snapshot;
      })
      .finally(() => {
        if (PENDING_EVENTS.get(key)?.epoch === epoch) PENDING_EVENTS.delete(key);
      });
    PENDING_EVENTS.set(key, { accountId: connection.accountId, epoch, promise: requestPromise });
    return requestPromise;
  },
  async disconnect() {
    const result = await request<CalendarConnectionView & { revocationFailed: boolean }>("/api/google-calendar/connection", { method: "DELETE" });
    clearAccount(result.accountId);
    return { view: result, revocationFailed: result.revocationFailed };
  },
};

export function useWebGoogleCalendarTimeline(input: Readonly<{
  enabled: boolean;
  localDates: readonly string[];
  timezone: string;
}>): WebCalendarTimelineState {
  const localDatesKey = input.localDates.join("|");
  const range = useMemo(() => timelineRange(localDatesKey, input.timezone), [input.timezone, localDatesKey]);
  const [state, setState] = useState<WebCalendarTimelineState>({ state: "not_loaded", snapshot: null, error: null, hiddenCalendarIds: [], showAllDay: false });
  const lastSnapshot = useRef<ExternalEventSnapshotV1 | null>(null);
  const accountId = useRef<string | null>(null);
  const display = useRef<Pick<WebCalendarTimelineState, "hiddenCalendarIds" | "showAllDay">>({ hiddenCalendarIds: [], showAllDay: false });
  const requestSequence = useRef(0);
  const refresh = useCallback(async (force = false): Promise<boolean> => {
    const request = ++requestSequence.current;
    const isCurrent = () => request === requestSequence.current && !document.hidden;
    if (!input.enabled || !range || document.hidden) return false;
    try {
      const connection = await webGoogleCalendarCoordinator.getConnection();
      if (!isCurrent()) return false;
      if (accountId.current && accountId.current !== connection.accountId) lastSnapshot.current = null;
      accountId.current = connection.accountId;
      if (lastSnapshot.current && !matchesRequest(lastSnapshot.current, connection, range)) lastSnapshot.current = null;
      display.current = {
        hiddenCalendarIds: connection.preferences.hiddenCalendarIds,
        showAllDay: connection.preferences.showAllDay,
      };
      if (connection.status === "not_configured") {
        clearAccount(connection.accountId);
        setState({ state: "not_configured", snapshot: null, error: null, hiddenCalendarIds: [], showAllDay: false });
        return true;
      }
      if (connection.status !== "connected") {
        clearAccount(connection.accountId);
        lastSnapshot.current = null;
        setState({ state: "disconnected", snapshot: null, error: null, hiddenCalendarIds: [], showAllDay: false });
        return connection.status === "disconnected";
      }
      if (!connection.preferences.visible || connection.preferences.selectedCalendarIds.length === 0) {
        setState({ state: "no_selected_calendars", snapshot: null, error: null, hiddenCalendarIds: connection.preferences.hiddenCalendarIds, showAllDay: connection.preferences.showAllDay });
        return true;
      }
      const snapshot = await webGoogleCalendarCoordinator.refreshEvents(range, { force });
      if (!isCurrent()) return false;
      const retained = snapshot.freshness.state === "stale" || snapshot.freshness.state === "incomplete"
        ? staleSnapshot(snapshot)
        : snapshot;
      lastSnapshot.current = retained;
      setState({
        state: retained.freshness.state === "stale" ? "stale" : retained.events.length ? "ready" : "empty",
        snapshot: retained,
        error: null,
        hiddenCalendarIds: connection.preferences.hiddenCalendarIds,
        showAllDay: connection.preferences.showAllDay,
      });
      return snapshot.completeness === "complete" && snapshot.freshness.state === "current";
    } catch (error) {
      if (!isCurrent()) return false;
      const code = calendarError(error);
      if (code === "unauthenticated" || code === "wrong_account" || code === "not_connected" || code === "reconnect_required" || code === "same_account_required" || code === "connection_changed") {
        if (accountId.current) clearAccount(accountId.current);
        accountId.current = null;
        lastSnapshot.current = null;
      }
      const retained = lastSnapshot.current ? staleSnapshot(lastSnapshot.current) : null;
      lastSnapshot.current = retained;
      setState({ state: "error", snapshot: retained, error: code, ...display.current });
      return false;
    }
  }, [input.enabled, range]);

  useEffect(() => {
    if (!input.enabled || !range) return;
    const reload = () => refresh(true);
    TIMELINE_RELOADS.add(reload);
    return () => { TIMELINE_RELOADS.delete(reload); };
  }, [input.enabled, range, refresh]);

  useEffect(() => {
    if (!input.enabled || !range) return;
    let timer: number | undefined;
    const schedule = () => {
      if (timer !== undefined) window.clearInterval(timer);
      timer = document.hidden ? undefined : window.setInterval(() => void refresh(), EVENT_REFRESH_MS);
    };
    const onVisibilityChange = () => {
      if (document.hidden) requestSequence.current += 1;
      schedule();
      if (!document.hidden) void refresh();
    };
    const initial = window.setTimeout(() => void refresh(), 0);
    schedule();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      requestSequence.current += 1;
      if (timer !== undefined) window.clearInterval(timer);
      window.clearTimeout(initial);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [input.enabled, range, refresh]);

  const snapshot = state.snapshot;
  const matchesRange = !snapshot || (snapshot.requestedRange.startLocalDate === range?.startLocalDate
    && snapshot.requestedRange.endLocalDate === range?.endLocalDate && snapshot.requestedRange.timezone === range?.timezone);
  return matchesRange ? state : { ...state, snapshot: null };
}

export function calendarRangeForToday(timezone: string, days = 8): CalendarEventRange {
  const start = Temporal.Now.zonedDateTimeISO(timezone).toPlainDate();
  return { startLocalDate: start.toString(), endLocalDate: start.add({ days: days - 1 }).toString(), timezone };
}

class CalendarClientError extends Error {
  constructor(readonly code: string) { super(code); }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
    credentials: "same-origin",
  });
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok || !value || typeof value !== "object" || Array.isArray(value)) {
    const code = value && typeof value === "object" && "error" in value && typeof value.error === "string" ? value.error : "provider_unavailable";
    throw new CalendarClientError(code);
  }
  if ("error" in value) throw new CalendarClientError(typeof value.error === "string" ? value.error : "provider_unavailable");
  return value as T;
}

function timelineRange(localDatesKey: string, timezone: string): CalendarEventRange | null {
  const localDates = localDatesKey.split("|").filter(Boolean);
  const first = localDates[0];
  const last = localDates.at(-1);
  return first && last ? { startLocalDate: first, endLocalDate: last, timezone } : null;
}

function eventKey(connection: CalendarConnectionView, range: CalendarEventRange): string {
  return JSON.stringify([connection.accountId, connection.generation, connection.selectionRevision, range.timezone ?? "", range.startLocalDate, range.endLocalDate]);
}

function elapsedSince(instant: string): number {
  try { return Date.now() - Temporal.Instant.from(instant).epochMilliseconds; }
  catch { return Number.POSITIVE_INFINITY; }
}

function clearAccount(accountId: string): void {
  for (const key of EVENT_CACHE.keys()) {
    if (JSON.parse(key)[0] === accountId) EVENT_CACHE.delete(key);
  }
  for (const [key, pending] of PENDING_EVENTS) {
    if (pending.accountId === accountId) PENDING_EVENTS.delete(key);
  }
  ACCOUNT_EPOCHS.set(accountId, accountEpoch(accountId) + 1);
}

function noteConnection(connection: CalendarConnectionView): void {
  if (activeAccountId && activeAccountId !== connection.accountId) {
    clearAccount(activeAccountId);
    clearAccount(connection.accountId);
  }
  activeAccountId = connection.accountId;
}

function evictSuperseded(connection: CalendarConnectionView, currentKey: string): void {
  let superseded = false;
  for (const key of EVENT_CACHE.keys()) {
    if (JSON.parse(key)[0] === connection.accountId && key !== currentKey) {
      EVENT_CACHE.delete(key);
      superseded = true;
    }
  }
  for (const [key, pending] of PENDING_EVENTS) {
    if (pending.accountId === connection.accountId && key !== currentKey) {
      PENDING_EVENTS.delete(key);
      superseded = true;
    }
  }
  if (superseded) ACCOUNT_EPOCHS.set(connection.accountId, accountEpoch(connection.accountId) + 1);
}

function accountEpoch(accountId: string): number {
  return ACCOUNT_EPOCHS.get(accountId) ?? 0;
}

function matchesRequest(
  snapshot: ExternalEventSnapshotV1,
  connection: CalendarConnectionView,
  range: CalendarEventRange,
): boolean {
  const selected = [...connection.preferences.selectedCalendarIds].sort();
  return snapshot.accountId === connection.accountId
    && snapshot.connectionGeneration === connection.generation
    && snapshot.requestedRange.startLocalDate === range.startLocalDate
    && snapshot.requestedRange.endLocalDate === range.endLocalDate
    && (!range.timezone || snapshot.requestedRange.timezone === range.timezone)
    && [...snapshot.requestedRange.selectedCalendarIds].sort().join("\u0000") === selected.join("\u0000");
}

function staleSnapshot(snapshot: ExternalEventSnapshotV1): ExternalEventSnapshotV1 {
  return {
    ...snapshot,
    freshness: {
      ...snapshot.freshness,
      state: "stale",
      label: "Calendar context may be out of date",
      canAssertNoOverlap: false,
    },
  };
}

function calendarError(error: unknown): string {
  if (!(error instanceof CalendarClientError)) return "provider_unavailable";
  return error.code;
}

/** Agent Settings never read or populate the ordinary Timeline event cache. */
export const webAgentGoogleCalendarCoordinator: GoogleCalendarCoordinator = {
  getConnection: () => request<CalendarConnectionView>("/api/google-calendar/connection?purpose=agent"),
  async beginConnect() {
    const result = await request<{ url: string }>("/api/google-calendar/connection?purpose=agent", { method: "POST", body: JSON.stringify({ target: "web" }) });
    window.location.assign(result.url);
  },
  async listCalendars() { return (await request<{ calendars: CalendarListEntry[] }>("/api/google-calendar/calendars?purpose=agent")).calendars; },
  savePreferences: (preferences) => request<CalendarConnectionView>("/api/google-calendar/calendars?purpose=agent", { method: "PUT", body: JSON.stringify(preferences) }),
  async disconnect() {
    const { revocationFailed, ...view } = await request<CalendarConnectionView & { revocationFailed: boolean }>("/api/google-calendar/connection?purpose=agent", { method: "DELETE" });
    return { view, revocationFailed };
  },
  async refreshEvents() { throw new CalendarClientError("permission_denied"); },
};
