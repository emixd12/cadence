"use client";

import { useEffect, useId, useState } from "react";

import { SettingsPanel } from "@/components/settings/SettingsPanels";
import type {
  CalendarConnectionView,
  CalendarListEntry,
  CalendarPreferences,
} from "@/lib/types/google-calendar";
import type { CalendarEventRange, GoogleCalendarCoordinator } from "@/lib/ui/google-calendar";

export type { CalendarEventRange, GoogleCalendarCoordinator } from "@/lib/ui/google-calendar";

type GoogleCalendarPanelProps = Readonly<{
  coordinator: GoogleCalendarCoordinator;
  refreshRange: CalendarEventRange;
  callbackMessage?: string;
  wrongAccount?: boolean;
  openExternalUrl?: (url: string) => Promise<void>;
  refreshVersion?: number;
  /** Renders as one source inside ConnectorLibrary. */
  nested?: boolean;
}>;

export function GoogleCalendarPanel({ coordinator, refreshRange, callbackMessage, wrongAccount = false, openExternalUrl, refreshVersion = 0, nested = false }: GoogleCalendarPanelProps) {
  const [connection, setConnection] = useState<CalendarConnectionView | null>(null);
  const [calendars, setCalendars] = useState<readonly CalendarListEntry[] | null>(null);
  const [preferences, setPreferences] = useState<CalendarPreferences | null>(null);
  const [pending, setPending] = useState<"connect" | "save" | "refresh" | "disconnect" | null>(null);
  const [message, setMessage] = useState<string | null>(() => callbackMessage ?? null);

  useEffect(() => {
    let active = true;
    void coordinator.getConnection().then(async (view) => {
      if (!active) return;
      setMessage(callbackMessage ?? null);
      setConnection(view);
      setPreferences(view.preferences);
      if (view.status === "connected") {
        try { const list = await coordinator.listCalendars(); if (active) setCalendars(list); }
        catch { if (active) setMessage("Calendar list could not load."); }
      } else setCalendars([]);
    }).catch(() => active && setMessage("Calendar status is unavailable."));
    return () => { active = false; };
  }, [callbackMessage, coordinator, refreshVersion]);

  const connect = async () => {
    setPending("connect"); setMessage(null);
    try { await coordinator.beginConnect(); setMessage("Continue in the browser to connect Calendar."); }
    catch { setMessage("Calendar connection could not start."); }
    finally { setPending(null); }
  };
  const save = async () => {
    if (!preferences) return;
    setPending("save"); setMessage(null);
    try {
      const view = await coordinator.savePreferences(preferences);
      setConnection(view); setPreferences(view.preferences);
      try {
        setCalendars(await coordinator.listCalendars());
        setMessage("Calendar preferences saved.");
      } catch { setMessage("Calendar preferences saved. Calendar list could not reload; try Refresh Calendar."); }
    } catch { setMessage("Calendar preferences could not be saved."); }
    finally { setPending(null); }
  };
  const refresh = async () => {
    setPending("refresh"); setMessage(null);
    try {
      setCalendars(await coordinator.listCalendars());
      if (!connection?.preferences.selectedCalendarIds.length) {
        setMessage("Calendar list refreshed. Select calendars and save to show events.");
        return;
      }
      const snapshot = await coordinator.refreshEvents(refreshRange, { force: true });
      setMessage(snapshot.events.length ? `Calendar refreshed. ${snapshot.freshness.label}.` : `No Calendar events in this range. ${snapshot.freshness.label}.`);
    } catch { setMessage("Calendar refresh did not finish. Try again; saved settings and existing timeline context are unchanged."); }
    finally { setPending(null); }
  };
  const disconnect = async () => {
    setPending("disconnect"); setMessage(null);
    try {
      const result = await coordinator.disconnect();
      setConnection(result.view); setPreferences(result.view.preferences); setCalendars([]);
      setMessage(result.revocationFailed
        ? "Calendar disconnected here. Google could not confirm grant revocation; remove Cadence in Google account permissions if needed."
        : "Calendar disconnected here. Other devices stop refreshing after they receive this account change.");
    } catch { setMessage("Calendar disconnect could not finish."); }
    finally { setPending(null); }
  };

  const status = connection?.status ?? "loading";
  const canManage = status === "connected" && preferences !== null;
  const connectLabel = status === "reconnect_required" ? "Reconnect Google Calendar" : "Connect Google Calendar";

  return (
    <SettingsPanel title="Google Calendar" headingLevel={nested ? 3 : 2} id={nested ? "connector-google_calendar" : undefined} description="Read-only context from the Google account used for Cadence. Calendar events never change Behavior status or schedules.">
      <div className="grid max-w-2xl gap-4 text-sm leading-6">
        <p role={message ? "status" : undefined} className="text-muted-readable">{message ?? statusLabel(status)}</p>
        {wrongAccount ? <p role="status" className="text-muted-readable">
          Use the same Google account as your Cadence account. To remove the unused grant, open{" "}
          <a href="https://myaccount.google.com/connections" target="_blank" rel="noopener noreferrer" className="underline" onClick={openExternalUrl ? (event) => { event.preventDefault(); void openExternalUrl(event.currentTarget.href).catch(() => setMessage("Google Account connections could not open. Try again.")); } : undefined}>Google Account connections</a>.
          {" "}Removing Cadence Calendar access there affects the entire Calendar project and can disconnect other Cadence accounts or devices using that Google account.
          {" "}Cadence does not revoke a wrong-account grant automatically.
        </p> : null}
        {status === "not_configured" ? <p className="text-muted-readable">Calendar connection is not configured for this Cadence deployment.</p> : null}
        {status === "connected" ? <p className="text-muted-readable">Cadence reads selected calendars only. Disconnecting removes Calendar access for this Cadence account. Other devices stop refreshing after they receive this account change.</p> : null}
        {status !== "connected" && status !== "not_configured" ? <button type="button" onClick={connect} disabled={pending !== null} className="product-action product-action-primary min-h-11 w-fit px-3 py-2 text-sm font-bold">{pending === "connect" ? "Opening Calendar connection…" : connectLabel}</button> : null}
        {canManage ? <>
          <fieldset disabled={pending !== null} className="grid gap-3 border-t border-line pt-4">
            <legend className="font-bold text-foreground">Calendar display</legend>
            <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={preferences.visible} onChange={(event) => setPreferences({ ...preferences, visible: event.target.checked })} />Show Calendar context on Timeline</label>
            <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={preferences.showAllDay} onChange={(event) => setPreferences({ ...preferences, showAllDay: event.target.checked })} />Show all-day events</label>
          </fieldset>
          <CalendarSelector calendars={calendars} preferences={preferences} onChange={setPreferences} disabled={pending !== null} />
          <div className="flex flex-wrap gap-3 border-t border-line pt-4">
            <button type="button" onClick={save} disabled={pending !== null} className="product-action product-action-primary min-h-11 px-3 py-2 text-sm font-bold">{pending === "save" ? "Saving Calendar…" : "Save Calendar settings"}</button>
            <button type="button" onClick={refresh} disabled={pending !== null} className="product-action product-action-secondary min-h-11 px-3 py-2 text-sm font-bold">{pending === "refresh" ? "Refreshing Calendar…" : "Refresh Calendar"}</button>
            <button type="button" onClick={disconnect} disabled={pending !== null} className="product-action product-action-secondary min-h-11 px-3 py-2 text-sm font-bold">{pending === "disconnect" ? "Disconnecting Calendar…" : "Disconnect Google Calendar"}</button>
          </div>
        </> : null}
      </div>
    </SettingsPanel>
  );
}

/** Shared calendar choice field; Outlook reuses it with its own selection keys mapped in. */
export type CalendarChoiceEntry = Pick<CalendarListEntry, "id" | "name" | "primary">;

export function CalendarSelector({ calendars, preferences, onChange, disabled, refreshLabel = "Refresh Calendar" }: Readonly<{
  calendars: readonly CalendarChoiceEntry[] | null;
  refreshLabel?: string;
  preferences: CalendarPreferences;
  onChange: (preferences: CalendarPreferences) => void;
  disabled: boolean;
}>) {
  const [query, setQuery] = useState("");
  const searchId = useId();
  const selected = calendars?.filter((calendar) => preferences.selectedCalendarIds.includes(calendar.id)) ?? [];
  const matches = calendars?.filter((calendar) => calendar.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) ?? [];
  return <fieldset disabled={disabled} className="min-w-0 border-t border-line pt-4">
    <legend className="font-bold text-foreground">Calendars</legend>
    <details className="min-w-0 border border-line" onKeyDown={(event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.currentTarget.open = false;
        event.currentTarget.querySelector("summary")?.focus();
      }
    }}>
      <summary className="min-h-11 cursor-pointer p-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground">
        <span className="ml-2">Choose calendars{selected.length ? ` (${selected.length})` : ""}</span>
        {selected.length ? <span className="mt-2 flex flex-wrap gap-2">
          {selected.map((calendar) => <span key={calendar.id} className="min-w-0 max-w-full bg-timeline-row-hover px-2 py-1 [overflow-wrap:anywhere]">
            {calendar.name}{preferences.hiddenCalendarIds.includes(calendar.id) ? " (hidden)" : ""}
          </span>)}
        </span> : null}
      </summary>
      <div className="grid gap-2 border-t border-line p-3">
        <label htmlFor={searchId}>Search calendars</label>
        <input id={searchId} type="search" value={query} onChange={(event) => setQuery(event.target.value)} className="min-h-11 min-w-0 w-full border border-line bg-background px-3 py-2" />
        <div className="max-h-64 overflow-y-auto overscroll-contain divide-y divide-line">
          {calendars === null ? <p className="text-muted-readable">Calendar list is not loaded. Try {refreshLabel}.</p>
            : calendars.length === 0 ? <p className="text-muted-readable">No readable calendars are available.</p>
            : matches.length === 0 ? <p className="text-muted-readable">No calendars match your search.</p>
            : matches.map((calendar) => <CalendarChoice key={calendar.id} calendar={calendar} preferences={preferences} onChange={onChange} />)}
        </div>
      </div>
    </details>
  </fieldset>;
}

function CalendarChoice({ calendar, preferences, onChange }: Readonly<{
  calendar: CalendarChoiceEntry;
  preferences: CalendarPreferences;
  onChange: (preferences: CalendarPreferences) => void;
}>) {
  const selected = preferences.selectedCalendarIds.includes(calendar.id);
  const hidden = preferences.hiddenCalendarIds.includes(calendar.id);
  const update = (nextSelected: boolean, nextHidden: boolean) => onChange({
    ...preferences,
    selectedCalendarIds: nextSelected ? [...new Set([...preferences.selectedCalendarIds, calendar.id])] : preferences.selectedCalendarIds.filter((id) => id !== calendar.id),
    hiddenCalendarIds: nextSelected && nextHidden ? [...preferences.hiddenCalendarIds.filter((id) => id !== calendar.id), calendar.id] : preferences.hiddenCalendarIds.filter((id) => id !== calendar.id),
  });
  return <div className="grid gap-1 py-1 [overflow-wrap:anywhere]">
    <label className="flex min-h-11 items-center gap-2 font-bold"><input type="checkbox" checked={selected} onChange={(event) => update(event.target.checked, hidden)} />{calendar.name}{calendar.primary ? " (primary)" : ""}</label>
    {selected ? <label className="flex min-h-11 items-center gap-2 text-muted-readable"><input type="checkbox" checked={!hidden} aria-label={`Visible on Timeline: ${calendar.name}`} onChange={(event) => update(true, !event.target.checked)} />Visible on Timeline</label> : null}
  </div>;
}

function statusLabel(status: CalendarConnectionView["status"] | "loading"): string {
  if (status === "loading") return "Loading Calendar connection.";
  if (status === "connected") return "Google Calendar connected.";
  if (status === "reconnect_required") return "Google Calendar needs reconnection.";
  if (status === "disconnected") return "Google Calendar is not connected.";
  if (status === "unavailable") return "Calendar is unavailable.";
  return "Calendar connection is not configured.";
}
