"use client";

import { useEffect, useId, useState, type FormEvent } from "react";

import { CalendarSelector } from "@/components/settings/GoogleCalendarPanel";
import { SettingsPanel } from "@/components/settings/SettingsPanels";
import type { ConnectorConnectionView, ConnectorPreferences } from "@/lib/types/connectors";
import type { CalendarPreferences } from "@/lib/types/google-calendar";
import {
  CONNECTOR_REVOCATION_COPY,
  connectorErrorCode,
  type ConnectorCalendarEntry,
  type ConnectorEventRange,
  type IcloudCalendarCoordinator,
} from "@/lib/ui/connectors";

type IcloudCalendarPanelProps = Readonly<{
  coordinator: IcloudCalendarCoordinator;
  refreshRange: ConnectorEventRange;
  refreshVersion?: number;
}>;

/** Custody disclosure shown before intake. Apple does not scope app-specific passwords to Calendar. */
export const ICLOUD_CUSTODY_COPY = "This connection uses an app-specific password, which Apple does not limit to Calendar. To connect, create an app-specific password at account.apple.com and enter it here with your Apple Account email. Apple does not limit that password to Calendar: it can also reach iCloud Mail, Contacts, and other iCloud data. Cadence stores both values encrypted on its server and does not save them on this device, and uses them only to read the calendars you select.";

// Ticket 240. Same scheduled-event semantics and selection field as Google and
// Outlook. The Apple Account email and app-specific password live in component
// state only until submit, then are cleared before the request resolves.
export function IcloudCalendarPanel({ coordinator, refreshRange, refreshVersion = 0 }: IcloudCalendarPanelProps) {
  const appleIdField = useId();
  const passwordField = useId();
  const custodyId = useId();
  const [connection, setConnection] = useState<ConnectorConnectionView | null>(null);
  const [calendars, setCalendars] = useState<readonly ConnectorCalendarEntry[] | null>(null);
  const [preferences, setPreferences] = useState<ConnectorPreferences | null>(null);
  const [appleId, setAppleId] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [pending, setPending] = useState<"connect" | "save" | "refresh" | "disconnect" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void coordinator.getConnection().then(async (view) => {
      if (!active) return;
      setMessage(null);
      setConnection(view);
      setPreferences(view.preferences);
      if (view.status === "connected") {
        try { const list = await coordinator.listCalendars(); if (active) setCalendars(list); }
        catch (error) { if (active) setMessage(icloudErrorMessage(connectorErrorCode(error), "iCloud calendar list could not load.")); }
      } else setCalendars([]);
    }).catch(() => { if (active) setMessage("iCloud Calendar status is unavailable. Other sources and tracking are unaffected."); });
    return () => { active = false; };
  }, [coordinator, refreshVersion]);


  const connect = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submittedId = appleId.trim();
    const submittedPassword = appPassword.trim();
    setAppleId(""); setAppPassword("");
    if (!submittedId || !submittedPassword) { setMessage("Enter your Apple Account email and an app-specific password."); return; }
    setPending("connect"); setMessage(null);
    try {
      const view = await coordinator.connect(submittedId, submittedPassword);
      setConnection(view); setPreferences(view.preferences);
      try { setCalendars(await coordinator.listCalendars()); setMessage("iCloud Calendar connected. Choose the calendars Cadence can show."); }
      catch { setCalendars([]); setMessage("iCloud Calendar connected. The calendar list could not load; try Refresh iCloud Calendar."); }
    } catch (error) { setMessage(icloudErrorMessage(connectorErrorCode(error), "iCloud Calendar could not connect. Try again.")); }
    finally { setPending(null); }
  };
  const save = async () => {
    if (!preferences) return;
    setPending("save"); setMessage(null);
    try {
      const view = await coordinator.savePreferences(preferences);
      setConnection(view); setPreferences(view.preferences);
      try { setCalendars(await coordinator.listCalendars()); setMessage("iCloud Calendar preferences saved."); }
      catch { setMessage("iCloud Calendar preferences saved. The calendar list could not reload; try Refresh iCloud Calendar."); }
    } catch (error) { setMessage(icloudErrorMessage(connectorErrorCode(error), "iCloud Calendar preferences could not be saved.")); }
    finally { setPending(null); }
  };
  const refresh = async () => {
    setPending("refresh"); setMessage(null);
    try {
      setCalendars(await coordinator.listCalendars());
      if (!connection?.preferences.selectedSourceIds.length) {
        setMessage("iCloud calendar list refreshed. Select calendars and save to show events.");
        return;
      }
      const snapshot = await coordinator.refreshEvents(refreshRange, { force: true });
      setMessage(snapshot.completeness !== "complete"
        ? "iCloud Calendar refresh was incomplete. Some events may be missing from the Timeline."
        : snapshot.freshness.state === "stale" ? "iCloud Calendar refresh was incomplete. The Timeline keeps the last complete read."
        : snapshot.events.length ? "iCloud Calendar refreshed." : "No iCloud Calendar events in this range.");
    } catch (error) {
      if (["reconnect_required", "permission_denied"].includes(connectorErrorCode(error))) {
        setConnection((view) => view ? { ...view, status: "reconnect_required" } : view);
        setCalendars([]);
      }
      setMessage(icloudErrorMessage(connectorErrorCode(error), "iCloud Calendar refresh did not finish. Try again; saved settings, other sources, and tracking are unchanged."));
    } finally { setPending(null); }
  };
  const disconnect = async () => {
    setPending("disconnect"); setMessage(null);
    try {
      const result = await coordinator.disconnect();
      setConnection(result.view); setPreferences(result.view.preferences); setCalendars([]);
      setMessage(`iCloud Calendar disconnected. Cadence deleted its saved Apple Account email and app-specific password. ${CONNECTOR_REVOCATION_COPY[result.revocation]}`);
    } catch (error) { setMessage(icloudErrorMessage(connectorErrorCode(error), "iCloud Calendar disconnect could not finish.")); }
    finally { setPending(null); }
  };

  const status = connection?.status ?? "loading";
  const needsLogin = status === "disconnected" || status === "reconnect_required";
  const canManage = status === "connected" && preferences !== null;
  const shared: CalendarPreferences | null = preferences ? { selectedCalendarIds: preferences.selectedSourceIds, hiddenCalendarIds: preferences.hiddenSourceIds,
    visible: preferences.visible, showAllDay: preferences.showAllDay } : null;
  const updateShared = (next: CalendarPreferences) => setPreferences({ selectedSourceIds: next.selectedCalendarIds, hiddenSourceIds: next.hiddenCalendarIds,
    visible: next.visible, showAllDay: next.showAllDay });

  return (
    <SettingsPanel id="connector-icloud_calendar" headingLevel={3} title="iCloud Calendar"
      description="Read-only calendar context from your Apple Account. Events never change Behavior status or schedules.">
      <div className="grid max-w-2xl gap-4 text-sm leading-6">
        <p role={message ? "status" : undefined} className="text-muted-readable">{message ?? icloudStatusLabel(status)}</p>
        {status === "not_configured" ? <p className="text-muted-readable">iCloud Calendar connection is not configured for this Cadence deployment.</p> : null}
        {needsLogin ? <form onSubmit={connect} className="grid gap-3 border-t border-line pt-4" aria-describedby={custodyId}>
          <p id={custodyId} className="text-muted-readable">{ICLOUD_CUSTODY_COPY}</p>
          <p className="font-bold text-foreground">Never enter your Apple Account password here.</p>
          <label htmlFor={appleIdField} className="font-bold text-foreground">Apple Account email</label>
          <input id={appleIdField} type="email" inputMode="email" autoComplete="off" spellCheck={false} autoCapitalize="none" value={appleId}
            onChange={(event) => setAppleId(event.target.value)} disabled={pending !== null}
            className="min-h-11 min-w-0 w-full max-w-md border border-line bg-background px-3 py-2" />
          <label htmlFor={passwordField} className="font-bold text-foreground">App-specific password</label>
          <input id={passwordField} type="password" autoComplete="off" spellCheck={false} autoCapitalize="none" placeholder="xxxx-xxxx-xxxx-xxxx" value={appPassword}
            onChange={(event) => setAppPassword(event.target.value)} disabled={pending !== null}
            className="min-h-11 min-w-0 w-full max-w-md border border-line bg-background px-3 py-2" />
          <button type="submit" disabled={pending !== null} className="product-action product-action-primary min-h-11 w-fit px-3 py-2 text-sm font-bold">
            {pending === "connect" ? "Connecting iCloud…" : status === "reconnect_required" ? "Reconnect iCloud Calendar" : "Connect iCloud Calendar"}
          </button>
        </form> : null}
        {status === "connected" ? <p className="text-muted-readable">Cadence reads selected calendars only. Disconnecting deletes Cadence&apos;s saved copy; Apple keeps the app-specific password active until you remove it at account.apple.com.</p> : null}
        {status === "reconnect_required" ? <button type="button" onClick={disconnect} disabled={pending !== null}
          className="product-action product-action-secondary min-h-11 w-fit px-3 py-2 text-sm font-bold">Disconnect iCloud Calendar</button> : null}
        {canManage && shared ? <>
          <fieldset disabled={pending !== null} className="grid gap-3 border-t border-line pt-4">
            <legend className="font-bold text-foreground">iCloud display</legend>
            <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={shared.visible} onChange={(event) => updateShared({ ...shared, visible: event.target.checked })} />Show iCloud context on Timeline</label>
            <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={shared.showAllDay} onChange={(event) => updateShared({ ...shared, showAllDay: event.target.checked })} />Show all-day iCloud events</label>
          </fieldset>
          <CalendarSelector calendars={calendars?.map((calendar) => ({ id: calendar.id, name: calendar.name, primary: calendar.isDefault })) ?? null}
            preferences={shared} onChange={updateShared} disabled={pending !== null} refreshLabel="Refresh iCloud Calendar" />
          <div className="flex flex-wrap gap-3 border-t border-line pt-4">
            <button type="button" onClick={save} disabled={pending !== null} className="product-action product-action-primary min-h-11 px-3 py-2 text-sm font-bold">{pending === "save" ? "Saving iCloud…" : "Save iCloud settings"}</button>
            <button type="button" onClick={refresh} disabled={pending !== null} className="product-action product-action-secondary min-h-11 px-3 py-2 text-sm font-bold">{pending === "refresh" ? "Refreshing iCloud…" : "Refresh iCloud Calendar"}</button>
            <button type="button" onClick={disconnect} disabled={pending !== null} className="product-action product-action-secondary min-h-11 px-3 py-2 text-sm font-bold">{pending === "disconnect" ? "Disconnecting iCloud…" : "Disconnect iCloud Calendar"}</button>
          </div>
        </> : null}
      </div>
    </SettingsPanel>
  );
}

function icloudStatusLabel(status: ConnectorConnectionView["status"] | "loading"): string {
  if (status === "loading") return "Loading iCloud Calendar connection.";
  if (status === "connected") return "iCloud Calendar connected.";
  if (status === "reconnect_required") return "iCloud Calendar needs a current app-specific password.";
  if (status === "disconnected") return "iCloud Calendar is not connected.";
  return "iCloud Calendar connection is not configured.";
}

export function icloudErrorMessage(code: string, fallback: string): string {
  if (code === "invalid_request") return "Enter your Apple Account email and an app-specific password shaped like xxxx-xxxx-xxxx-xxxx. Cadence does not accept your Apple Account password.";
  if (code === "reconnect_required") return "Apple did not accept these values. Check the email, create a new app-specific password at account.apple.com, and enter it again.";
  if (code === "wrong_account") return "This is a different Apple Account from the connected one. Disconnect iCloud Calendar first, then connect the other account.";
  if (code === "permission_denied") return "Apple refused access to iCloud Calendar for this account.";
  if (code === "timeout") return "iCloud did not respond in time. Try again; other sources and tracking are unchanged.";
  if (code === "rate_limited") return "Apple asked Cadence to wait before reading again. Try again later.";
  if (code === "incomplete_pagination") return "iCloud returned only part of a calendar, so Cadence did not treat it as complete.";
  if (code === "not_configured") return "iCloud Calendar connection is not configured for this Cadence deployment.";
  if (code === "unauthenticated") return "Sign in to Cadence again to manage iCloud Calendar.";
  return fallback;
}
