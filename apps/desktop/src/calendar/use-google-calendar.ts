import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExternalEventSnapshotV1 } from "@cadence/core/types/external-event";
import type { CalendarPreferences } from "@/lib/types/google-calendar";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { DesktopCalendarCache, type CalendarCacheRequest } from "./cache";
import { DesktopCalendarCoordinator, type CalendarRefreshTrigger } from "./coordinator";
import { CalendarBrokerError, createDesktopCalendarBroker, DesktopCalendarConnection,
  DesktopAgentCalendarPanelCoordinator, DesktopGoogleCalendarPanelCoordinator, isDesktopCalendarCallback, type CalendarEventRange } from "./google-calendar";

export type DesktopGoogleCalendarHookOptions = Readonly<{
  client: SupabaseClient | null;
  accountId: string | null;
  timezone: string;
  range: CalendarEventRange;
  enabled: boolean;
  screen: "timeline" | "settings" | null;
}>;

export type DesktopGoogleCalendarHookResult = Readonly<{
  coordinator: DesktopGoogleCalendarPanelCoordinator | null;
  agentCoordinator: DesktopAgentCalendarPanelCoordinator | null;
  panelVersion: number;
  wrongAccount: boolean;
  agentWrongAccount: boolean;
  agentCallbackMessage?: string;
  snapshot: ExternalEventSnapshotV1 | null;
  preferences: CalendarPreferences | null;
  stale: boolean;
  label: string;
  error: string | null;
  refresh(trigger?: CalendarRefreshTrigger): Promise<boolean>;
}>;

export function useDesktopGoogleCalendar(options: DesktopGoogleCalendarHookOptions): DesktopGoogleCalendarHookResult {
  const { client, accountId, timezone, range, enabled, screen } = options;
  const cache = useMemo(() => new DesktopCalendarCache(), []);
  const broker = useMemo(() => client ? createDesktopCalendarBroker(client) : null, [client]);
  const agentBroker = useMemo(() => client ? createDesktopCalendarBroker(client, undefined, "agent") : null, [client]);
  const agentConnection = useMemo(() => agentBroker ? new DesktopCalendarConnection(agentBroker) : null, [agentBroker]);
  const agentCoordinator = useMemo(() => agentBroker && agentConnection ? new DesktopAgentCalendarPanelCoordinator(agentBroker, agentConnection) : null, [agentBroker, agentConnection]);
  const snapshots = useMemo(() => broker ? new DesktopCalendarCoordinator(broker, cache) : null, [broker, cache]);
  const connection = useMemo(() => broker ? new DesktopCalendarConnection(broker) : null, [broker]);
  const lease = useRef(0);
  const [panelVersion, setPanelVersion] = useState(0);
  const [wrongAccountOwner, setWrongAccountOwner] = useState<string | null>(null);
  const [agentCallback, setAgentCallback] = useState<{ accountId: string; wrongAccount: boolean; message?: string } | null>(null);
  const scope = JSON.stringify([accountId, timezone, range.startLocalDate, range.endLocalDate]);
  const scopeRef = useRef(scope);
  const timezoneRef = useRef(timezone);
  timezoneRef.current = timezone;
  if (scopeRef.current !== scope) { scopeRef.current = scope; lease.current += 1; }
  const [state, setState] = useState<Omit<DesktopGoogleCalendarHookResult, "coordinator" | "agentCoordinator" | "refresh" | "panelVersion" | "wrongAccount" | "agentWrongAccount" | "agentCallbackMessage">>({
    snapshot: null, preferences: null, stale: true, label: broker ? "Calendar has not loaded." : "Calendar is unavailable in this build.", error: null,
  });
  const panelChanged = useCallback((view: Awaited<ReturnType<DesktopGoogleCalendarPanelCoordinator["getConnection"]>> | null, snapshot?: ExternalEventSnapshotV1) => {
    lease.current += 1;
    setWrongAccountOwner(null);
    setState({ snapshot: snapshot ?? null, preferences: view?.preferences ?? null, stale: !snapshot,
      label: snapshot ? freshnessLabel(snapshot, false) : view?.status === "connected" ? "Calendar refresh required." : "Google Calendar is not connected.", error: null });
  }, []);
  const panel = useMemo(() => broker && snapshots && connection
    ? new DesktopGoogleCalendarPanelCoordinator(broker, () => timezoneRef.current, snapshots, connection, (view, snapshot) => {
      if (scopeRef.current === scope) panelChanged(view, snapshot);
    }) : null,
  [broker, connection, panelChanged, snapshots, scope]);

  const refresh = useCallback(async (trigger: CalendarRefreshTrigger = "manual") => {
    if (trigger !== "manual" && !desktopVisible()) return false;
    const currentLease = ++lease.current;
    if (!enabled || !broker || !snapshots || !accountId) return true;
    let offline: Awaited<ReturnType<DesktopCalendarCache["readCurrent"]>> = null;
    try {
      offline = await cache.readCurrent({ accountId, startLocalDate: range.startLocalDate, endLocalDate: range.endLocalDate, timezone });
      if (currentLease !== lease.current) return false;
      if (offline?.request.visible) setState({ snapshot: offline.snapshot, preferences: preferences(offline.request), stale: true, label: freshnessLabel(offline.snapshot, true), error: null });
    } catch (error) {
      if (currentLease === lease.current) setState({ snapshot: null, preferences: null, stale: true, label: "Calendar cache is unavailable.", error: code(error) });
    }

    try {
      const view = await broker.connection();
      if (currentLease !== lease.current) return false;
      if (view.accountId !== accountId || view.status !== "connected") {
        await snapshots.clear();
        if (currentLease !== lease.current) return false;
        setState({ snapshot: null, preferences: null, stale: true, label: view.status === "reconnect_required" ? "Reconnect Google Calendar." : "Google Calendar is not connected.", error: null });
        return view.accountId === accountId && (view.status === "disconnected" || view.status === "not_configured");
      }
      if (!view.preferences.visible || view.preferences.selectedCalendarIds.length === 0) {
        await snapshots.clear();
        if (currentLease === lease.current) setState({ snapshot: null, preferences: view.preferences, stale: false,
          label: view.preferences.visible ? "No calendars are selected." : "Calendar context is hidden.", error: null });
        return currentLease === lease.current;
      }
      const request: CalendarCacheRequest = { accountId, connectionGeneration: view.generation,
        selectionRevision: view.selectionRevision, startLocalDate: range.startLocalDate, endLocalDate: range.endLocalDate,
        timezone, selectedCalendarIds: [...view.preferences.selectedCalendarIds], hiddenCalendarIds: [...view.preferences.hiddenCalendarIds],
        visible: view.preferences.visible, showAllDay: view.preferences.showAllDay };
      const result = await snapshots.refresh(request, trigger);
      if (currentLease !== lease.current) return false;
      if (critical(result.refreshError)) {
        await snapshots.clear();
        if (currentLease !== lease.current) return false;
        setState({ snapshot: null, preferences: null, stale: true, label: "Reconnect Google Calendar.", error: result.refreshError });
        return false;
      }
      setState({ snapshot: result.snapshot, preferences: view.preferences, stale: result.stale,
        label: result.snapshot ? freshnessLabel(result.snapshot, result.stale) : "Calendar data is unavailable.",
        error: result.refreshError });
      return Boolean(result.snapshot && !result.stale && !result.refreshError && result.snapshot.freshness.state === "current");
    } catch (error) {
      if (currentLease !== lease.current) return false;
      const errorCode = code(error);
      if (critical(errorCode)) {
        await snapshots.clear();
        if (currentLease !== lease.current) return false;
        setState({ snapshot: null, preferences: null, stale: true, label: "Reconnect Google Calendar.", error: errorCode });
      } else {
        setState((current) => ({ ...current, stale: true, label: current.snapshot ? freshnessLabel(current.snapshot, true) : "Calendar data is unavailable.", error: errorCode }));
      }
      return false;
    }
  }, [accountId, broker, cache, enabled, range.endLocalDate, range.startLocalDate, snapshots, timezone]);

  useEffect(() => {
    lease.current += 1;
    if (!broker || !accountId) setState({ snapshot: null, preferences: null, stale: true,
      label: broker ? "Calendar requires a linked account." : "Calendar is unavailable in this build.", error: null });
    else if (enabled) void refresh("open");
    return () => { lease.current += 1; };
  }, [accountId, broker, enabled, refresh, screen]);

  const callbackRefresh = useRef(refresh);
  callbackRefresh.current = refresh;

  useEffect(() => {
    if (!enabled || !connection || !accountId) return;
    let active = true;
    let stop: (() => void) | undefined;
    const seen = new Set<string>();
    const complete = async (urls: string[]) => {
      for (const value of urls) {
        if (!active || seen.has(value) || !isDesktopCalendarCallback(value)) continue;
        seen.add(value);
        const agent = new URL(value).searchParams.get("purpose") === "agent";
        try {
          const callback = await (agent ? agentConnection : connection)?.complete(value, accountId);
          if (active && callback) {
            if (agent) setAgentCallback({ accountId, wrongAccount: callback.result === "same_account_required",
              message: callback.result === "connected" ? "Google Calendar for Daily Brief connected. Select calendars, then enable Calendar in Daily Brief settings." : "Calendar connection did not finish." });
            else setWrongAccountOwner(callback.result === "same_account_required" ? accountId : null);
            setPanelVersion((version) => version + 1);
            if (!agent) await callbackRefresh.current("manual");
          }
        }
        catch (error) {
          if (active) {
            if (agent) setAgentCallback({ accountId, wrongAccount: false, message: "Calendar connection did not finish. Try connecting again." });
            else setState((current) => ({ ...current, error: code(error) }));
            setPanelVersion((version) => version + 1);
            if (!agent) await callbackRefresh.current("manual");
          }
        }
      }
    };
    void (async () => {
      stop = await onOpenUrl((urls) => void complete(urls));
      await complete((await getCurrent()) ?? []);
      if (!active) stop();
    })().catch((error) => { if (active) setState((current) => ({ ...current, error: code(error) })); });
    return () => { active = false; stop?.(); };
  }, [accountId, connection, agentConnection, enabled]);

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout>;
    let active = true;
    const schedule = () => {
      clearTimeout(timer);
      if (!active || !desktopVisible()) return;
      timer = setTimeout(() => {
        if (!active || !desktopVisible()) return;
        void refresh("visible").finally(schedule);
      }, 15 * 60_000);
    };
    const visible = () => { clearTimeout(timer); if (desktopVisible()) { void refresh("visible"); schedule(); } };
    const resume = () => { if (desktopVisible()) { void refresh("resume"); schedule(); } };
    const inactive = () => { clearTimeout(timer); };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("focus", resume);
    window.addEventListener("blur", inactive);
    schedule();
    return () => { active = false; clearTimeout(timer); document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("focus", resume); window.removeEventListener("blur", inactive); };
  }, [enabled, refresh]);

  const owned = state.snapshot?.accountId === accountId
    && state.snapshot.requestedRange.timezone === timezone
    && state.snapshot.requestedRange.startLocalDate === range.startLocalDate
    && state.snapshot.requestedRange.endLocalDate === range.endLocalDate;
  return { coordinator: panel, agentCoordinator, panelVersion, agentWrongAccount: agentCallback?.accountId === accountId && agentCallback?.wrongAccount === true,
    agentCallbackMessage: agentCallback?.accountId === accountId ? agentCallback?.message : undefined, wrongAccount: accountId !== null && wrongAccountOwner === accountId, ...state, snapshot: owned ? state.snapshot : null,
    preferences: owned || !state.snapshot ? state.preferences : null, refresh };
}

function preferences(request: CalendarCacheRequest): CalendarPreferences {
  return { selectedCalendarIds: request.selectedCalendarIds, hiddenCalendarIds: request.hiddenCalendarIds,
    visible: request.visible, showAllDay: request.showAllDay };
}

function freshnessLabel(snapshot: ExternalEventSnapshotV1, stale: boolean): string {
  return stale ? `Saved Calendar data from ${snapshot.fetchedAt}; it may be stale.` : `Calendar refreshed ${snapshot.fetchedAt}.`;
}

function desktopVisible(): boolean {
  // WKWebView can remain visibilityState=visible while its native window is minimized.
  return document.visibilityState === "visible" && document.hasFocus();
}

function code(error: unknown): string {
  return error instanceof CalendarBrokerError ? error.code : error instanceof Error ? error.message : "provider_unavailable";
}

function critical(value: string | null): boolean {
  return value === "unauthenticated" || value === "reconnect_required" || value === "wrong_account"
    || value === "same_account_required" || value === "connection_changed";
}
