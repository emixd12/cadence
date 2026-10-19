import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Temporal } from "@js-temporal/polyfill";
import { invoke } from "@tauri-apps/api/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { projectRecordedActivityDay } from "@cadence/core/services/recorded-activity-refresh";
import type { ExternalEventSnapshotV1_1 } from "@cadence/core/types/external-event";
import type { RecordedActivitySnapshotV1 } from "@cadence/core/types/recorded-activity";
import {
  connectorCriticalError,
  connectorErrorCode,
  outlookCallbackMessage,
  outlookTimelineRange,
  type ConnectorTimelineState,
  type HevyTimelineState,
  type OutlookTimelineState,
} from "@/lib/ui/connectors";
import { DesktopConnectorBroker } from "./connector-broker";
import { DesktopConnectorCache } from "./connector-cache";
import { DesktopConnectorSnapshots } from "./connector-coordinator";
import type { CalendarRefreshTrigger } from "./coordinator";
import { createDesktopCalendarBroker } from "./google-calendar";
import { DesktopIcloudCalendarCoordinator, icloudScopeKey, icloudSourceRules, icloudCacheScopeFromKey } from "./icloud-calendar";
import { DesktopHevyCoordinator, hevyScopeFromKey, hevyScopeKey, hevySourceRules } from "./hevy";
import { DesktopOutlookCalendarPanelCoordinator, DesktopOutlookConnection, isDesktopOutlookCallback, OUTLOOK_ATTEMPT_KEY,
  outlookScopeKey, outlookSourceRules, scopeFromKey } from "./outlook-calendar";

// Ticket 225: Outlook and Hevy on linked desktop. Each source has its own cache,
// epoch, lease, and failure state. Local mode shows connectors as requiring a
// linked account; tracking never waits on them.

export type DesktopConnectorsOptions = Readonly<{
  client: SupabaseClient | null;
  accountId: string | null;
  timezone: string;
  todayLocalDate: string;
  lastLocalDate: string;
  enabled: boolean;
  screen: "timeline" | "settings" | null;
}>;

export type DesktopConnectorsResult = Readonly<{
  outlookCoordinator: DesktopOutlookCalendarPanelCoordinator | null;
  icloudCoordinator: DesktopIcloudCalendarCoordinator | null;
  hevyCoordinator: DesktopHevyCoordinator | null;
  outlookMessage: string | undefined;
  panelVersion: number;
  outlook: OutlookTimelineState;
  icloud: OutlookTimelineState;
  hevy: HevyTimelineState;
  /** Why connectors cannot be managed here, or null when they can. */
  unavailableReason: "local" | "build" | null;
  refresh(trigger?: CalendarRefreshTrigger): Promise<boolean>;
}>;

const OUTLOOK_EMPTY: OutlookTimelineState = { state: "not_loaded", snapshot: null, error: null, hiddenCalendarIds: [], showAllDay: true };
const HEVY_EMPTY: HevyTimelineState = { state: "not_loaded", day: null, error: null };

export function useDesktopConnectors(options: DesktopConnectorsOptions): DesktopConnectorsResult {
  const { client, accountId, timezone, todayLocalDate, lastLocalDate, enabled, screen } = options;
  const cache = useMemo(() => new DesktopConnectorCache(), []);
  const outlookSnapshots = useMemo(() => new DesktopConnectorSnapshots<ExternalEventSnapshotV1_1>(outlookSourceRules(), cache), [cache]);
  const icloudSnapshots = useMemo(() => new DesktopConnectorSnapshots<ExternalEventSnapshotV1_1>(icloudSourceRules(), cache), [cache]);
  const hevySnapshots = useMemo(() => new DesktopConnectorSnapshots<RecordedActivitySnapshotV1>(hevySourceRules(), cache), [cache]);
  const broker = useMemo(() => {
    const transport = client ? createDesktopCalendarBroker(client) : null;
    return transport ? new DesktopConnectorBroker(transport) : null;
  }, [client]);
  const connection = useMemo(() => broker ? new DesktopOutlookConnection(broker) : null, [broker]);
  const [outlook, setOutlook] = useState<OutlookTimelineState>(OUTLOOK_EMPTY);
  const [icloud, setIcloud] = useState<OutlookTimelineState>(OUTLOOK_EMPTY);
  const [hevy, setHevy] = useState<HevyTimelineState>(HEVY_EMPTY);
  const [outlookMessage, setOutlookMessage] = useState<string | undefined>(undefined);
  const [panelVersion, setPanelVersion] = useState(0);
  const outlookLease = useRef(0);
  const icloudLease = useRef(0);
  const hevyLease = useRef(0);
  const changedOutlook = useCallback(() => { outlookLease.current += 1; setOutlook(OUTLOOK_EMPTY); }, []);
  const changedIcloud = useCallback(() => { icloudLease.current += 1; setIcloud(OUTLOOK_EMPTY); }, []);
  const changedHevy = useCallback(() => { hevyLease.current += 1; setHevy(HEVY_EMPTY); }, []);
  /* eslint-disable react-hooks/refs -- The change callbacks run only from Settings event handlers, never during render. */
  const outlookCoordinator = useMemo(() => broker && connection && accountId
    ? new DesktopOutlookCalendarPanelCoordinator(broker, outlookSnapshots, connection, changedOutlook) : null, [accountId, broker, changedOutlook, connection, outlookSnapshots]);
  const icloudCoordinator = useMemo(() => broker && accountId ? new DesktopIcloudCalendarCoordinator(broker, icloudSnapshots, changedIcloud) : null,
    [accountId, broker, changedIcloud, icloudSnapshots]);
  const hevyCoordinator = useMemo(() => broker && accountId ? new DesktopHevyCoordinator(broker, hevySnapshots, changedHevy) : null,
    [accountId, broker, changedHevy, hevySnapshots]);
  /* eslint-enable react-hooks/refs */

  // Account switch or sign-out deletes both source caches and any pending Outlook attempt before new content shows.
  const previousAccount = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const previous = previousAccount.current;
    previousAccount.current = accountId;
    if (previous === undefined || previous === accountId) return;
    outlookLease.current += 1; icloudLease.current += 1; hevyLease.current += 1;
    setOutlook(OUTLOOK_EMPTY); setIcloud(OUTLOOK_EMPTY); setHevy(HEVY_EMPTY); setOutlookMessage(undefined);
    void Promise.all([outlookSnapshots.clear(), icloudSnapshots.clear(), hevySnapshots.clear(),
      invoke("auth_secret_remove", { name: OUTLOOK_ATTEMPT_KEY })]).catch(() => undefined);
  }, [accountId, hevySnapshots, outlookSnapshots, icloudSnapshots]);

  const refreshOutlook = useCallback(async (trigger: CalendarRefreshTrigger): Promise<boolean> => {
    const lease = ++outlookLease.current;
    const current = () => lease === outlookLease.current;
    if (!enabled || !broker || !accountId) return true;
    const range = outlookTimelineRange(todayLocalDate, lastLocalDate, timezone);
    let display = { hiddenCalendarIds: [] as readonly string[], showAllDay: true };
    let offline: ExternalEventSnapshotV1_1 | null = null;
    try {
      offline = await outlookSnapshots.readCurrent(accountId, (key) => {
        const saved = scopeFromKey(key);
        return saved.startLocalDate === range.startLocalDate && saved.endLocalDate === range.endLocalDate && saved.timezone === range.timezone;
      });
      if (!current()) return false;
      if (offline) setOutlook({ ...OUTLOOK_EMPTY, state: "stale", snapshot: offline });
    } catch { /* The network read below decides the state. */ }
    try {
      const view = await broker.outlookConnection();
      if (!current()) return false;
      if (view.accountId !== accountId || view.status !== "connected") {
        await outlookSnapshots.clear();
        if (current()) setOutlook({ ...OUTLOOK_EMPTY, state: statusState(view.status) });
        return view.accountId === accountId && view.status !== "reconnect_required";
      }
      display = { hiddenCalendarIds: view.preferences.hiddenSourceIds, showAllDay: view.preferences.showAllDay };
      if (!view.preferences.visible || view.preferences.selectedSourceIds.length === 0) {
        await outlookSnapshots.clear();
        if (current()) setOutlook({ ...OUTLOOK_EMPTY, ...display, state: view.preferences.visible ? "no_selected_calendars" : "hidden" });
        return current();
      }
      const result = await outlookSnapshots.refresh(accountId, outlookScopeKey(view, range), () => broker.outlookEvents(range), trigger);
      if (!current()) return false;
      if (connectorCriticalError(result.refreshError) || result.refreshError === "cleared") {
        if (result.refreshError !== "cleared") await outlookSnapshots.clear();
        if (current()) setOutlook({ ...OUTLOOK_EMPTY, ...display, state: "error", error: result.refreshError });
        return false;
      }
      const snapshot = result.snapshot;
      const state: ConnectorTimelineState = !snapshot ? "error" : snapshot.completeness !== "complete" ? "incomplete"
        : result.refreshError ? "error" : snapshot.events.length ? "ready" : "empty";
      setOutlook({ ...display, snapshot, state, error: result.refreshError });
      return state === "ready" || state === "empty";
    } catch (error) {
      if (!current()) return false;
      const code = connectorErrorCode(error);
      if (connectorCriticalError(code)) await outlookSnapshots.clear();
      else outlookSnapshots.recordFailure(accountId, code);
      if (current()) setOutlook({ ...OUTLOOK_EMPTY, ...display, state: "error", error: code, snapshot: connectorCriticalError(code) ? null : offline });
      return false;
    }
  }, [accountId, broker, enabled, lastLocalDate, outlookSnapshots, timezone, todayLocalDate]);

  const refreshIcloud = useCallback(async (trigger: CalendarRefreshTrigger): Promise<boolean> => {
    const lease = ++icloudLease.current;
    const current = () => lease === icloudLease.current;
    if (!enabled || !broker || !accountId) return true;
    const range = outlookTimelineRange(todayLocalDate, lastLocalDate, timezone);
    let display = { hiddenCalendarIds: [] as readonly string[], showAllDay: true };
    let offline: ExternalEventSnapshotV1_1 | null = null;
    try {
      offline = await icloudSnapshots.readCurrent(accountId, (key) => {
        const cachedScope = icloudCacheScopeFromKey(key);
        display = { hiddenCalendarIds: cachedScope.hiddenCalendarIds, showAllDay: cachedScope.showAllDay };
        const saved = cachedScope.scope;
        return saved.startLocalDate === range.startLocalDate && saved.endLocalDate === range.endLocalDate && saved.timezone === range.timezone;
      });
      if (!current()) return false;
      if (offline) setIcloud({ ...OUTLOOK_EMPTY, ...display, state: "stale", snapshot: offline });
    } catch { /* The network read below decides the state. */ }
    try {
      const view = await broker.icloudConnection();
      if (!current()) return false;
      if (view.accountId !== accountId || view.status !== "connected") {
        await icloudSnapshots.clear();
        if (current()) setIcloud({ ...OUTLOOK_EMPTY, state: statusState(view.status) });
        return view.accountId === accountId && view.status !== "reconnect_required";
      }
      display = { hiddenCalendarIds: view.preferences.hiddenSourceIds, showAllDay: view.preferences.showAllDay };
      if (!view.preferences.visible || view.preferences.selectedSourceIds.length === 0) {
        await icloudSnapshots.clear();
        if (current()) setIcloud({ ...OUTLOOK_EMPTY, ...display, state: view.preferences.visible ? "no_selected_calendars" : "hidden" });
        return current();
      }
      const result = await icloudSnapshots.refresh(accountId, icloudScopeKey(view, range), () => broker.icloudEvents(range), trigger);
      if (!current()) return false;
      if (connectorCriticalError(result.refreshError) || result.refreshError === "cleared") {
        if (result.refreshError !== "cleared") await icloudSnapshots.clear();
        if (current()) setIcloud({ ...OUTLOOK_EMPTY, ...display, state: "error", error: result.refreshError });
        return false;
      }
      const snapshot = result.snapshot;
      const state: ConnectorTimelineState = !snapshot ? "error" : snapshot.completeness !== "complete" ? "incomplete"
        : result.refreshError ? "error" : snapshot.events.length ? "ready" : "empty";
      setIcloud({ ...display, snapshot, state, error: result.refreshError });
      return state === "ready" || state === "empty";
    } catch (error) {
      if (!current()) return false;
      const code = connectorErrorCode(error);
      if (connectorCriticalError(code)) await icloudSnapshots.clear();
      else icloudSnapshots.recordFailure(accountId, code);
      if (current()) setIcloud({ ...OUTLOOK_EMPTY, ...display, state: "error", error: code, snapshot: connectorCriticalError(code) ? null : offline });
      return false;
    }
  }, [accountId, broker, enabled, lastLocalDate, icloudSnapshots, timezone, todayLocalDate]);

  const refreshHevy = useCallback(async (trigger: CalendarRefreshTrigger): Promise<boolean> => {
    const lease = ++hevyLease.current;
    const current = () => lease === hevyLease.current;
    if (!enabled || !broker || !accountId) return true;
    const day = (snapshot: RecordedActivitySnapshotV1, refreshFailed: boolean) =>
      projectRecordedActivityDay({ snapshot, localDate: todayLocalDate, now: Temporal.Now.instant(), refreshFailed });
    let offline: RecordedActivitySnapshotV1 | null = null;
    try {
      offline = await hevySnapshots.readCurrent(accountId, (key) => {
        const saved = hevyScopeFromKey(key);
        return saved.startLocalDate === todayLocalDate && saved.endLocalDate === todayLocalDate && saved.timezone === timezone;
      });
      if (!current()) return false;
      if (offline) setHevy({ state: "stale", day: day(offline, true), error: null });
    } catch { /* The network read below decides the state. */ }
    try {
      const view = await broker.hevyConnection();
      if (!current()) return false;
      if (view.accountId !== accountId || view.status !== "connected") {
        await hevySnapshots.clear();
        if (current()) setHevy({ ...HEVY_EMPTY, state: statusState(view.status) });
        return view.accountId === accountId && view.status !== "reconnect_required";
      }
      const result = await hevySnapshots.refresh(accountId, hevyScopeKey(view, todayLocalDate, timezone), () => broker.hevyActivities(todayLocalDate), trigger);
      if (!current()) return false;
      if (!result.snapshot || connectorCriticalError(result.refreshError) || result.refreshError === "cleared") {
        if (connectorCriticalError(result.refreshError)) await hevySnapshots.clear();
        if (current()) setHevy({ state: "error", day: null, error: result.refreshError ?? "provider_unavailable" });
        return false;
      }
      const projected = day(result.snapshot, Boolean(result.refreshError) && result.source === "cache");
      setHevy({ state: projected.state === "incomplete" ? "incomplete" : projected.state === "stale" ? (result.refreshError ? "error" : "stale") : projected.items.length ? "ready" : "empty",
        day: projected, error: result.refreshError });
      return projected.state === "current" && !result.refreshError;
    } catch (error) {
      if (!current()) return false;
      const code = connectorErrorCode(error);
      if (connectorCriticalError(code)) await hevySnapshots.clear();
      else hevySnapshots.recordFailure(accountId, code);
      if (current()) setHevy({ state: "error", day: offline && !connectorCriticalError(code) ? day(offline, true) : null, error: code });
      return false;
    }
  }, [accountId, broker, enabled, hevySnapshots, timezone, todayLocalDate]);

  const refresh = useCallback(async (trigger: CalendarRefreshTrigger = "manual") => {
    if (trigger !== "manual" && !desktopVisible()) return false;
    const [outlookCurrent, icloudCurrent, hevyCurrent] = await Promise.all([refreshOutlook(trigger), refreshIcloud(trigger), refreshHevy(trigger)]);
    return outlookCurrent && icloudCurrent && hevyCurrent;
  }, [refreshHevy, refreshOutlook, refreshIcloud]);

  useEffect(() => {
    const initial = broker && accountId && enabled ? setTimeout(() => void refresh("open"), 0) : undefined;
    return () => { clearTimeout(initial); outlookLease.current += 1; icloudLease.current += 1; hevyLease.current += 1; };
  }, [accountId, broker, enabled, refresh, screen]);

  const latestRefresh = useRef(refreshOutlook);
  useEffect(() => { latestRefresh.current = refreshOutlook; }, [refreshOutlook]);
  useEffect(() => {
    if (!enabled || !connection || !accountId) return;
    let active = true;
    let stop: (() => void) | undefined;
    const seen = new Set<string>();
    const complete = async (urls: string[]) => {
      for (const value of urls) {
        if (!active || seen.has(value) || !isDesktopOutlookCallback(value)) continue;
        seen.add(value);
        try {
          const result = await connection.complete(value, accountId);
          if (!active || result === null || result === "ignored") continue;
          setOutlookMessage(outlookCallbackMessage(result));
        } catch (error) {
          if (active) setOutlookMessage(outlookCallbackMessage(connectorErrorCode(error)) ?? outlookCallbackMessage("error"));
        }
        if (active) { setPanelVersion((version) => version + 1); await latestRefresh.current("manual"); }
      }
    };
    void (async () => {
      stop = await onOpenUrl((urls) => void complete(urls));
      await complete((await getCurrent()) ?? []);
      if (!active) stop();
    })().catch(() => undefined);
    return () => { active = false; stop?.(); };
  }, [accountId, connection, enabled]);

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout>;
    let active = true;
    const schedule = () => {
      clearTimeout(timer);
      if (!active || !desktopVisible()) return;
      timer = setTimeout(() => { if (active && desktopVisible()) void refresh("visible").finally(schedule); }, 15 * 60_000);
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

  const ownedOutlook = outlook.snapshot && (outlook.snapshot.accountId !== accountId || outlook.snapshot.requestedRange.timezone !== timezone
    || outlook.snapshot.requestedRange.startLocalDate !== todayLocalDate) ? { ...outlook, snapshot: null } : outlook;
  const ownedIcloud = icloud.snapshot && (icloud.snapshot.accountId !== accountId || icloud.snapshot.requestedRange.timezone !== timezone
    || icloud.snapshot.requestedRange.startLocalDate !== todayLocalDate) ? { ...icloud, snapshot: null } : icloud;
  const ownedHevy = hevy.day && hevy.day.localDate !== todayLocalDate ? { ...hevy, day: null } : hevy;
  const linked = Boolean(broker && accountId);
  return { outlookCoordinator, icloudCoordinator, hevyCoordinator, outlookMessage, panelVersion, outlook: linked ? ownedOutlook : OUTLOOK_EMPTY, icloud: linked ? ownedIcloud : OUTLOOK_EMPTY, hevy: linked ? ownedHevy : HEVY_EMPTY,
    unavailableReason: !broker && client ? "build" : !accountId || !client ? "local" : null, refresh };
}

function statusState(status: string): ConnectorTimelineState {
  return status === "not_configured" ? "not_configured" : status === "reconnect_required" ? "reconnect_required" : "disconnected";
}

function desktopVisible(): boolean {
  // WKWebView can remain visibilityState=visible while its native window is minimized.
  return document.visibilityState === "visible" && document.hasFocus();
}
