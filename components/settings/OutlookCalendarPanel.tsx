"use client";

import { useEffect, useState } from "react";

import { CalendarSelector } from "@/components/settings/GoogleCalendarPanel";
import { SettingsPanel } from "@/components/settings/SettingsPanels";
import type { ConnectorConnectionView, ConnectorPreferences } from "@/lib/types/connectors";
import type { CalendarPreferences } from "@/lib/types/google-calendar";
import {
  CONNECTOR_REVOCATION_COPY,
  connectorErrorCode,
  outlookCallbackMessage,
  type ConnectorCalendarEntry,
  type ConnectorEventRange,
  type OutlookCalendarCoordinator,
} from "@/lib/ui/connectors";

type OutlookCalendarPanelProps = Readonly<{
  coordinator: OutlookCalendarCoordinator;
  refreshRange: ConnectorEventRange;
  callbackMessage?: string;
  refreshVersion?: number;
}>;

// Ticket 238. Same scheduled-event semantics and selection field as Google
// Calendar; Outlook keeps its own status, errors, and saved selection.
export function OutlookCalendarPanel({ coordinator, refreshRange, callbackMessage, refreshVersion = 0 }: OutlookCalendarPanelProps) {
  const [connection, setConnection] = useState<ConnectorConnectionView | null>(null);
  const [calendars, setCalendars] = useState<readonly ConnectorCalendarEntry[] | null>(null);
  const [preferences, setPreferences] = useState<ConnectorPreferences | null>(null);
  const [pending, setPending] = useState<"connect" | "save" | "refresh" | "disconnect" | null>(null);
  const [message, setMessage] = useState<string | null>(() => callbackMessage ?? null);

  useEffect(() => {
    let active = true;
    void coordinator.getConnection().then(async (view) => {
      if (!active) return;
      // A "connected" callback no longer applies once the server reports another state.
      setMessage(view.status !== "connected" && callbackMessage === outlookCallbackMessage("connected") ? null : callbackMessage ?? null);
      setConnection(view);
      setPreferences(view.preferences);
      if (view.status === "connected") {
        try { const list = await coordinator.listCalendars(); if (active) setCalendars(list); }
        catch (error) { if (active) { markReconnectIfNeeded(error); setMessage(outlookErrorMessage(connectorErrorCode(error), "Outlook calendar list could not load.")); } }
      } else setCalendars([]);
    }).catch(() => { if (active) setMessage("Outlook Calendar status is unavailable. Other sources and tracking are unaffected."); });
    return () => { active = false; };
  }, [callbackMessage, coordinator, refreshVersion]);

  // A failed list or refresh that needs new consent moves the row to its reconnect state, as the iCloud panel does.
  function markReconnectIfNeeded(error: unknown) {
    if (!["reconnect_required", "permission_denied"].includes(connectorErrorCode(error))) return;
    setConnection((view) => view ? { ...view, status: "reconnect_required" } : view);
    setCalendars([]);
  }
  const connect = async () => {
    setPending("connect"); setMessage(null);
    try { await coordinator.beginConnect(); setMessage("Continue in the browser to connect Outlook Calendar."); }
    catch (error) { setMessage(outlookErrorMessage(connectorErrorCode(error), "Outlook Calendar connection could not start.")); }
    finally { setPending(null); }
  };
  const save = async () => {
    if (!preferences) return;
    setPending("save"); setMessage(null);
    try {
      const view = await coordinator.savePreferences(preferences);
      setConnection(view); setPreferences(view.preferences);
      try { setCalendars(await coordinator.listCalendars()); setMessage("Outlook Calendar preferences saved."); }
      catch { setMessage("Outlook Calendar preferences saved. The calendar list could not reload; try Refresh Outlook Calendar."); }
    } catch (error) { setMessage(outlookErrorMessage(connectorErrorCode(error), "Outlook Calendar preferences could not be saved.")); }
    finally { setPending(null); }
  };
  const refresh = async () => {
    setPending("refresh"); setMessage(null);
    try {
      setCalendars(await coordinator.listCalendars());
      if (!connection?.preferences.selectedSourceIds.length) {
        setMessage("Outlook calendar list refreshed. Select calendars and save to show events.");
        return;
      }
      const snapshot = await coordinator.refreshEvents(refreshRange, { force: true });
      setMessage(snapshot.completeness !== "complete"
        ? "Outlook Calendar refresh was incomplete. Some events may be missing from the Timeline."
        : snapshot.freshness.state === "stale" ? "Outlook Calendar refresh was incomplete. The Timeline keeps the last complete read."
        : snapshot.events.length ? "Outlook Calendar refreshed." : "No Outlook Calendar events in this range.");
    } catch (error) {
      markReconnectIfNeeded(error);
      setMessage(outlookErrorMessage(connectorErrorCode(error), "Outlook Calendar refresh did not finish. Try again; saved settings, other sources, and tracking are unchanged."));
    } finally { setPending(null); }
  };
  const disconnect = async () => {
    setPending("disconnect"); setMessage(null);
    try {
      const result = await coordinator.disconnect();
      setConnection(result.view); setPreferences(result.view.preferences); setCalendars([]);
      setMessage(`Outlook Calendar disconnected. Cadence deleted its saved Microsoft access. ${CONNECTOR_REVOCATION_COPY[result.revocation]}`);
    } catch (error) { setMessage(outlookErrorMessage(connectorErrorCode(error), "Outlook Calendar disconnect could not finish.")); }
    finally { setPending(null); }
  };

  const status = connection?.status ?? "loading";
  const canManage = status === "connected" && preferences !== null;
  const shared: CalendarPreferences | null = preferences ? { selectedCalendarIds: preferences.selectedSourceIds, hiddenCalendarIds: preferences.hiddenSourceIds,
    visible: preferences.visible, showAllDay: preferences.showAllDay } : null;
  const updateShared = (next: CalendarPreferences) => setPreferences({ selectedSourceIds: next.selectedCalendarIds, hiddenSourceIds: next.hiddenCalendarIds,
    visible: next.visible, showAllDay: next.showAllDay });

  return (
    <SettingsPanel id="connector-outlook_calendar" headingLevel={3} title="Outlook Calendar"
      description="Read-only calendar context from a personal, work, or school Microsoft account. Events never change Behavior status or schedules.">
      <div className="grid max-w-2xl gap-4 text-sm leading-6">
        <p role={message ? "status" : undefined} className="text-muted-readable">{message ?? outlookStatusLabel(status)}</p>
        {status === "not_configured" ? <p className="text-muted-readable">Outlook Calendar connection is not configured for this Cadence deployment.</p> : null}
        {status === "connected" ? <p className="text-muted-readable">Cadence reads selected calendars only. Disconnecting deletes Cadence&apos;s saved Microsoft access; Microsoft keeps the permission until you remove it there.</p> : null}
        {status === "disconnected" || status === "reconnect_required" ? <button type="button" onClick={connect} disabled={pending !== null} className="product-action product-action-primary min-h-11 w-fit px-3 py-2 text-sm font-bold">
          {pending === "connect" ? "Opening Outlook connection…" : status === "reconnect_required" ? "Reconnect Outlook Calendar" : "Connect Outlook Calendar"}
        </button> : null}
        {status === "reconnect_required" ? <button type="button" onClick={disconnect} disabled={pending !== null}
          className="product-action product-action-secondary min-h-11 w-fit px-3 py-2 text-sm font-bold">{pending === "disconnect" ? "Disconnecting Outlook…" : "Disconnect Outlook Calendar"}</button> : null}
        {canManage && shared ? <>
          <fieldset disabled={pending !== null} className="grid gap-3 border-t border-line pt-4">
            <legend className="font-bold text-foreground">Outlook display</legend>
            <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={shared.visible} onChange={(event) => updateShared({ ...shared, visible: event.target.checked })} />Show Outlook context on Timeline</label>
            <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={shared.showAllDay} onChange={(event) => updateShared({ ...shared, showAllDay: event.target.checked })} />Show all-day Outlook events</label>
          </fieldset>
          <CalendarSelector calendars={calendars?.map((calendar) => ({ id: calendar.id, name: calendar.name, primary: calendar.isDefault })) ?? null}
            preferences={shared} onChange={updateShared} disabled={pending !== null} refreshLabel="Refresh Outlook Calendar" />
          <div className="flex flex-wrap gap-3 border-t border-line pt-4">
            <button type="button" onClick={save} disabled={pending !== null} className="product-action product-action-primary min-h-11 px-3 py-2 text-sm font-bold">{pending === "save" ? "Saving Outlook…" : "Save Outlook settings"}</button>
            <button type="button" onClick={refresh} disabled={pending !== null} className="product-action product-action-secondary min-h-11 px-3 py-2 text-sm font-bold">{pending === "refresh" ? "Refreshing Outlook…" : "Refresh Outlook Calendar"}</button>
            <button type="button" onClick={disconnect} disabled={pending !== null} className="product-action product-action-secondary min-h-11 px-3 py-2 text-sm font-bold">{pending === "disconnect" ? "Disconnecting Outlook…" : "Disconnect Outlook Calendar"}</button>
          </div>
        </> : null}
      </div>
    </SettingsPanel>
  );
}

function outlookStatusLabel(status: ConnectorConnectionView["status"] | "loading"): string {
  if (status === "loading") return "Loading Outlook Calendar connection.";
  if (status === "connected") return "Outlook Calendar connected.";
  if (status === "reconnect_required") return "Outlook Calendar needs reconnection.";
  if (status === "disconnected") return "Outlook Calendar is not connected.";
  return "Outlook Calendar connection is not configured.";
}

export function outlookErrorMessage(code: string, fallback: string): string {
  if (code === "reconnect_required") return "Outlook Calendar needs reconnection. Reconnect to continue.";
  if (code === "wrong_account") return "Another Microsoft account is still connected. Disconnect Outlook Calendar first.";
  if (code === "timeout") return "Outlook did not respond in time. Try again; other sources and tracking are unchanged.";
  if (code === "rate_limited") return "Microsoft asked Cadence to wait before reading again. Try again later.";
  if (code === "not_configured") return "Outlook Calendar connection is not configured for this Cadence deployment.";
  if (code === "unauthenticated") return "Sign in to Cadence again to manage Outlook Calendar.";
  return fallback;
}
