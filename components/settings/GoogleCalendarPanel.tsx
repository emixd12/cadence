"use client";

import { useEffect, useId, useRef, useState } from "react";

import { SettingsPanel } from "@/components/settings/SettingsPanels";
import { useReportSettingsSection } from "@/components/settings/SettingsSections";
import { SettingsDisconnect } from "@/components/settings/SettingsDisconnect";
import { SETTINGS_SAVED, SETTINGS_SAVING, SettingsLiveLine, settingsSaveFailed, useAutosave } from "@/components/settings/settings-result";
import { DesktopDraftGuard } from "@/lib/desktop-draft";
import { googleCalendarDualSectionState, googleCalendarSectionState, settingsSectionLoad } from "@/lib/ui/settings-sections";
import type {
  CalendarConnectionView,
  CalendarListEntry,
  CalendarPreferences,
} from "@/lib/types/google-calendar";
import type {
  CalendarEventRange,
  GoogleCalendarAiConnectionView,
  GoogleCalendarCoordinator,
} from "@/lib/ui/google-calendar";

export type { CalendarEventRange, GoogleCalendarCoordinator } from "@/lib/ui/google-calendar";

type GoogleCalendarPanelProps = Readonly<{
  coordinator: GoogleCalendarCoordinator;
  refreshRange: CalendarEventRange;
  callbackMessage?: string;
  aiCallbackMessage?: string;
  aiHiddenSkipped?: number;
  aiEnabled?: boolean;
  onAiConnectionChange?: () => void;
  wrongAccount?: boolean;
  openExternalUrl?: (url: string) => Promise<void>;
  refreshVersion?: number;
  /** Renders as one source inside ConnectorLibrary. */
  nested?: boolean;
}>;

function sameCalendarSelection(a: readonly string[], b: readonly string[]): boolean {
  const left = [...new Set(a)].sort();
  const right = [...new Set(b)].sort();
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

export function GoogleCalendarPanel({
  coordinator,
  refreshRange,
  callbackMessage,
  aiCallbackMessage,
  aiHiddenSkipped = 0,
  aiEnabled = false,
  onAiConnectionChange,
  wrongAccount = false,
  openExternalUrl,
  refreshVersion = 0,
  nested = false,
}: GoogleCalendarPanelProps) {
  const [connection, setConnection] = useState<CalendarConnectionView | null>(null);
  const [calendars, setCalendars] = useState<readonly CalendarListEntry[] | null>(null);
  const [preferences, setPreferences] = useState<CalendarPreferences | null>(null);
  const [pending, setPending] = useState<"connect" | "refresh" | "disconnect" | null>(null);
  const [message, setMessage] = useState<string | null>(() => callbackMessage ?? null);
  const [loadFailed, setLoadFailed] = useState(false);

  const aiCoordinator = coordinator.ai;
  const [aiConnection, setAiConnection] = useState<GoogleCalendarAiConnectionView | null>(null);
  const [aiCalendars, setAiCalendars] = useState<readonly CalendarListEntry[] | null>(null);
  const [aiPreferences, setAiPreferences] = useState<CalendarPreferences | null>(null);
  const [aiPending, setAiPending] = useState<"connect" | "sync" | "disconnect" | null>(null);
  const [aiMessage, setAiMessage] = useState<string | null>(() => aiCallbackMessage ?? null);
  const [aiLoadFailed, setAiLoadFailed] = useState(false);
  const [hiddenSkipped, setHiddenSkipped] = useState<number>(aiHiddenSkipped);

  // Q6: single status pill for Connected sources → Google Calendar.
  const sectionState = aiCoordinator
    ? googleCalendarDualSectionState(
        settingsSectionLoad(connection, loadFailed),
        settingsSectionLoad(aiConnection, aiLoadFailed),
      )
    : googleCalendarSectionState(settingsSectionLoad(connection, loadFailed));
  useReportSettingsSection(sectionState);

  // Ticket 303: display and selection choices save as they change, then the calendar list reloads.
  const savedPreferences = useRef<CalendarPreferences | null>(null);
  const autosave = useAutosave((next: CalendarPreferences) => coordinator.savePreferences(next), {
    saved: (view, latest) => { savedPreferences.current = view.preferences; setConnection(view); if (latest) setPreferences(view.preferences); },
    failed: () => { setPreferences(savedPreferences.current); setMessage(settingsSaveFailed("Google Calendar settings could not save. Try again.")); },
    settled: async () => {
      try { setCalendars(await coordinator.listCalendars()); setMessage(SETTINGS_SAVED); }
      catch { setMessage(`${SETTINGS_SAVED}. The calendar list did not reload. Try Refresh Google Calendar.`); }
    },
  });
  const cancelAutosave = autosave.cancel;

  const savedAiPreferences = useRef<CalendarPreferences | null>(null);
  const aiAutosave = useAutosave(
    (next: CalendarPreferences) => {
      if (!aiCoordinator) return Promise.reject(new Error("unavailable"));
      return aiCoordinator.savePreferences(next);
    },
    {
      saved: (view, latest) => {
        savedAiPreferences.current = view.preferences;
        setAiConnection((prev) => ({ ...prev, ...view }));
        if (latest) setAiPreferences(view.preferences);
        onAiConnectionChange?.();
      },
      failed: () => {
        setAiPreferences(savedAiPreferences.current);
        setAiMessage(settingsSaveFailed("AI Google Calendar settings could not save. Try again."));
      },
      settled: async () => {
        if (!aiCoordinator) return;
        try { setAiCalendars(await aiCoordinator.listCalendars()); setAiMessage(SETTINGS_SAVED); }
        catch { setAiMessage(`${SETTINGS_SAVED}. The AI calendar list did not reload.`); }
      },
    },
  );
  const cancelAiAutosave = aiAutosave.cancel;

  useEffect(() => {
    setHiddenSkipped(aiHiddenSkipped);
  }, [aiHiddenSkipped]);

  useEffect(() => {
    let active = true;
    cancelAutosave();
    void coordinator.getConnection().then(async (view) => {
      if (!active) return;
      setMessage(callbackMessage ?? null);
      setLoadFailed(false);
      setConnection(view);
      setPreferences(view.preferences);
      savedPreferences.current = view.preferences;
      if (view.status === "connected") {
        try { const list = await coordinator.listCalendars(); if (active) setCalendars(list); }
        catch { if (active) setMessage("Your Google calendars could not load. Try Refresh Google Calendar."); }
      } else setCalendars([]);
    }).catch(() => { if (active) { setLoadFailed(true); setMessage("Cadence could not check Google Calendar. Reload Settings to try again."); } });
    return () => { active = false; };
  }, [callbackMessage, cancelAutosave, coordinator, refreshVersion]);

  useEffect(() => {
    if (!aiCoordinator) return;
    let active = true;
    cancelAiAutosave();
    void aiCoordinator.getConnection().then(async (view) => {
      if (!active) return;
      setAiMessage(aiCallbackMessage ?? null);
      setAiLoadFailed(false);
      setAiConnection(view);
      setAiPreferences(view.preferences);
      savedAiPreferences.current = view.preferences;
      if (view.hiddenCalendarsSkipped && view.hiddenCalendarsSkipped > 0) {
        setHiddenSkipped(view.hiddenCalendarsSkipped);
      }
      if (view.status === "connected") {
        try { const list = await aiCoordinator.listCalendars(); if (active) setAiCalendars(list); }
        catch { if (active) setAiMessage("Your AI Google calendars could not load. Try again later."); }
      } else setAiCalendars([]);
    }).catch(() => {
      if (active) {
        setAiLoadFailed(true);
        setAiMessage("Cadence could not check Google Calendar for AI. Reload Settings to try again.");
      }
    });
    return () => { active = false; };
  }, [aiCallbackMessage, aiCoordinator, cancelAiAutosave, refreshVersion]);

  const connect = async () => {
    setPending("connect"); setMessage(null);
    try { await coordinator.beginConnect(); setMessage("Continue in your browser to connect Google Calendar."); }
    catch { setMessage("Google Calendar could not start connecting. Try again."); }
    finally { setPending(null); }
  };
  const change = (next: CalendarPreferences) => {
    setPreferences(next); setMessage(SETTINGS_SAVING);
    autosave.change(next);
  };
  const refresh = async () => {
    setPending("refresh"); setMessage(null);
    try {
      setCalendars(await coordinator.listCalendars());
      if (!connection?.preferences.selectedCalendarIds.length) {
        setMessage("Calendar list updated. Choose calendars to show their events.");
        return;
      }
      const snapshot = await coordinator.refreshEvents(refreshRange, { force: true });
      setMessage(snapshot.events.length ? `Google Calendar refreshed. ${snapshot.freshness.label}.` : `No Google Calendar events to show. ${snapshot.freshness.label}.`);
    } catch { setMessage("Google Calendar did not refresh. Try again. Your settings and Timeline are unchanged."); }
    finally { setPending(null); }
  };
  const disconnect = async () => {
    setPending("disconnect"); setMessage(null);
    try {
      const result = await coordinator.disconnect();
      setConnection(result.view); setPreferences(result.view.preferences); setCalendars([]);
      savedPreferences.current = result.view.preferences;
      setMessage(result.revocationFailed
        ? "Calendar disconnected here. Google could not confirm grant revocation; remove Cadence in Google account permissions if needed."
        : "Calendar disconnected here. Other devices stop refreshing after they receive this account change.");
    } catch { setMessage("Google Calendar did not disconnect. Try again."); }
    finally { setPending(null); }
  };

  const connectAi = async () => {
    if (!aiCoordinator) return;
    setAiPending("connect"); setAiMessage(null);
    try { await aiCoordinator.beginConnect(); setAiMessage("Continue in your browser to connect Google Calendar for AI."); }
    catch { setAiMessage("Google Calendar for AI could not start connecting. Try again."); }
    finally { setAiPending(null); }
  };
  const changeAi = (next: CalendarPreferences) => {
    setAiPreferences(next); setAiMessage(SETTINGS_SAVING);
    aiAutosave.change(next);
  };
  const syncToAi = async () => {
    if (!aiCoordinator) return;
    setAiPending("sync"); setAiMessage(null);
    try {
      const result = await aiCoordinator.syncFromTimeline();
      setAiConnection((prev) => ({ ...prev, ...result.view }));
      setAiPreferences(result.view.preferences);
      savedAiPreferences.current = result.view.preferences;
      setHiddenSkipped(result.hiddenCalendarsSkipped);
      setAiMessage("AI calendar selection synced from Timeline.");
      onAiConnectionChange?.();
    } catch {
      setAiMessage("Could not sync Timeline calendars to AI. Try again.");
    } finally {
      setAiPending(null);
    }
  };
  const disconnectAi = async () => {
    if (!aiCoordinator) return;
    setAiPending("disconnect"); setAiMessage(null);
    try {
      const result = await aiCoordinator.disconnect();
      setAiConnection({ ...result.view, affectedChatCount: 0 });
      setAiPreferences(result.view.preferences);
      setAiCalendars([]);
      savedAiPreferences.current = result.view.preferences;
      setHiddenSkipped(0);
      setAiMessage(result.revocationFailed
        ? "Google Calendar for AI disconnected. Google could not confirm grant revocation; remove Cadence in Google account permissions if needed."
        : "Google Calendar for AI disconnected. Timeline stays connected.");
      onAiConnectionChange?.();
    } catch {
      setAiMessage("Google Calendar for AI did not disconnect. Try again.");
    } finally {
      setAiPending(null);
    }
  };

  const status = connection?.status ?? "loading";
  const canManage = status === "connected" && preferences !== null;
  const connectLabel = status === "reconnect_required" ? "Reconnect Google Calendar" : "Connect Google Calendar";
  // Ticket 335: an account without exactly one Google sign-in.
  const googleSignIn = status === "connected" ? undefined : connection?.googleSignIn;
  const canConnect = status !== "connected" && status !== "not_configured" && (!googleSignIn || googleSignIn === "add");
  const busy = pending !== null || autosave.saving;

  const aiStatus = aiConnection?.status ?? "loading";
  const canManageAi = Boolean(aiCoordinator) && aiStatus === "connected" && aiPreferences !== null;
  const aiGoogleSignIn = aiStatus === "connected" ? undefined : aiConnection?.googleSignIn;
  const canConnectAi = Boolean(aiCoordinator) && aiStatus !== "connected" && aiStatus !== "not_configured" && (!aiGoogleSignIn || aiGoogleSignIn === "add");
  const aiBusy = aiPending !== null || aiAutosave.saving;
  const affectedChatCount = aiConnection?.affectedChatCount ?? 0;

  // Q3: Chained Step 2 onboarding when Timeline just connected while AI is enabled and AI grant is not connected.
  const timelineJustConnected = Boolean(callbackMessage && callbackMessage.toLowerCase().includes("connected"));
  const showStep2Prompt = Boolean(aiCoordinator && aiEnabled && timelineJustConnected && canConnectAi);

  // Q6: Quiet drift hint when both grants are connected and their selected calendar sets differ.
  const selectionsDiffer = Boolean(
    canManage && canManageAi && preferences && aiPreferences &&
    !sameCalendarSelection(preferences.selectedCalendarIds, aiPreferences.selectedCalendarIds),
  );
  const aiSelectedCount = aiPreferences?.selectedCalendarIds.length ?? 0;

  const aiDisconnectQuestion = affectedChatCount > 0
    ? `Disconnecting removes ${affectedChatCount} ${affectedChatCount === 1 ? "conversation" : "conversations"} that used Google Calendar and clears Undo for changes made in them; your completed schedule changes stay.`
    : "Disconnecting clears AI Google Calendar data and derived summaries. Your Timeline connection stays connected.";

  return (
    <SettingsPanel title="Google Calendar" headingLevel={nested ? 3 : 2} id={nested ? "connector-google_calendar" : undefined} description="Read-only context from the Google account used for Cadence. Calendar events never change Behavior status or schedules.">
      <div className="grid max-w-2xl gap-4 text-sm leading-6">
        <DesktopDraftGuard pending={autosave.saving || aiAutosave.saving} />
        {aiCoordinator ? <h4 className="font-bold text-foreground">Timeline &amp; Travel</h4> : null}
        <SettingsLiveLine text={message} className="text-muted-readable" />
        {message ? null : <p className="text-muted-readable">{statusLabel(status)}</p>}
        {wrongAccount ? <p className="text-muted-readable">
          Use the same Google account as your Cadence account. To remove the unused grant, open{" "}
          <a href="https://myaccount.google.com/connections" target="_blank" rel="noopener noreferrer" className="underline" onClick={openExternalUrl ? (event) => { event.preventDefault(); void openExternalUrl(event.currentTarget.href).catch(() => setMessage("Google Account connections could not open. Try again.")); } : undefined}>Google Account connections</a>.
          {" "}Removing Cadence Calendar access there affects the entire Calendar project and can disconnect other Cadence accounts or devices using that Google account.
          {" "}Cadence does not revoke a wrong-account grant automatically.
        </p> : null}
        {status === "not_configured" ? <p className="text-muted-readable">This Cadence server cannot connect Google Calendar.</p> : null}
        {status === "connected" ? <p className="text-muted-readable">Cadence reads selected calendars only. Disconnecting removes this Calendar connection for this Cadence account. Other devices stop refreshing after they receive this account change.</p> : null}
        {googleSignIn && status !== "not_configured" ? <p className="text-muted-readable">{googleSignInHint(googleSignIn)}</p> : null}
        {canConnect ? <button type="button" onClick={connect} disabled={pending !== null} className="product-action product-action-primary min-h-11 w-fit px-3 py-2 text-sm font-bold">{pending === "connect" ? "Opening Google Calendar…" : connectLabel}</button> : null}
        {showStep2Prompt ? (
          <div className="grid gap-2 border border-line p-3" data-testid="google-calendar-step2-prompt">
            <p className="text-muted-readable">Step 2: Connect Google Calendar for AI features (Daily Brief and Chat).</p>
            <button type="button" onClick={connectAi} disabled={aiBusy} className="product-action product-action-primary min-h-11 w-fit px-3 py-2 text-sm font-bold">
              {aiPending === "connect" ? "Opening Google Calendar for AI…" : "Connect Google Calendar for AI"}
            </button>
          </div>
        ) : null}
        {canManage ? <>
          <fieldset disabled={pending !== null} className="grid gap-3 border-t border-line pt-4">
            <legend className="font-bold text-foreground">Timeline display</legend>
            <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={preferences.visible} onChange={(event) => change({ ...preferences, visible: event.target.checked })} />Show Google Calendar events on Timeline</label>
            <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={preferences.showAllDay} onChange={(event) => change({ ...preferences, showAllDay: event.target.checked })} />Show all-day Google Calendar events</label>
          </fieldset>
          <CalendarSelector calendars={calendars} preferences={preferences} onChange={change} disabled={pending !== null} />
          {selectionsDiffer ? (
            <div className="flex flex-wrap items-center gap-3 text-muted-readable" data-testid="google-calendar-drift-hint">
              <span>AI features use a separate selection ({aiSelectedCount} {aiSelectedCount === 1 ? "calendar" : "calendars"}).</span>
              <button type="button" onClick={syncToAi} disabled={aiBusy} className="product-action product-action-secondary min-h-11 px-3 py-2 text-sm font-bold">
                {aiPending === "sync" ? "Syncing…" : "Sync to AI"}
              </button>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-3 border-t border-line pt-4">
            <button type="button" onClick={refresh} disabled={busy} className="product-action product-action-secondary min-h-11 px-3 py-2 text-sm font-bold">{pending === "refresh" ? "Refreshing Google Calendar…" : "Refresh Google Calendar"}</button>
            <SettingsDisconnect label="Disconnect Google Calendar" question="Disconnect Google Calendar?" pendingLabel="Disconnecting Google Calendar…"
              pending={pending === "disconnect"} disabled={busy} onConfirm={() => { void disconnect(); }} />
          </div>
        </> : null}

        {aiCoordinator ? (
          <div className="grid gap-4 border-t border-line pt-4" data-testid="google-calendar-ai-section">
            <h4 className="font-bold text-foreground">AI features (Daily Brief &amp; Chat)</h4>
            <SettingsLiveLine text={aiMessage} className="text-muted-readable" />
            {aiMessage ? null : <p className="text-muted-readable">{aiStatusLabel(aiStatus)}</p>}
            {aiStatus === "not_configured" ? <p className="text-muted-readable">This Cadence server cannot connect Google Calendar for AI.</p> : null}
            {aiGoogleSignIn && aiStatus !== "not_configured" ? <p className="text-muted-readable">{googleSignInHint(aiGoogleSignIn)}</p> : null}
            {hiddenSkipped > 0 ? (
              <p className="text-muted-readable" data-testid="google-calendar-hidden-skipped-note">
                {hiddenSkipped} hidden Google {hiddenSkipped === 1 ? "calendar" : "calendars"} could not be copied automatically.
              </p>
            ) : null}
            {canConnectAi ? (
              <button type="button" onClick={connectAi} disabled={aiPending !== null} className="product-action product-action-primary min-h-11 w-fit px-3 py-2 text-sm font-bold">
                {aiPending === "connect" ? "Opening Google Calendar for AI…" : aiStatus === "reconnect_required" ? "Reconnect Google Calendar for AI" : "Connect Google Calendar for AI"}
              </button>
            ) : null}
            {canManageAi && aiPreferences ? <>
              <AiCalendarPicker calendars={aiCalendars} preferences={aiPreferences} onChange={changeAi} disabled={aiPending !== null} />
              <div className="flex flex-wrap gap-3">
                <SettingsDisconnect
                  label="Disconnect Google Calendar for AI"
                  question={aiDisconnectQuestion}
                  pendingLabel="Disconnecting Google Calendar for AI…"
                  pending={aiPending === "disconnect"}
                  disabled={aiBusy}
                  onConfirm={() => { void disconnectAi(); }}
                />
              </div>
            </> : null}
          </div>
        ) : null}
      </div>
    </SettingsPanel>
  );
}

/** Q6: Lightweight AI calendar picker — collapsed pills by default, simple checkboxes only (no "Visible on Timeline"). */
function AiCalendarPicker({ calendars, preferences, onChange, disabled }: Readonly<{
  calendars: readonly CalendarChoiceEntry[] | null;
  preferences: CalendarPreferences;
  onChange: (preferences: CalendarPreferences) => void;
  disabled: boolean;
}>) {
  const [expanded, setExpanded] = useState(false);
  const selected = calendars?.filter((calendar) => preferences.selectedCalendarIds.includes(calendar.id)) ?? [];

  const toggle = (calendarId: string, checked: boolean) => {
    const nextIds = checked
      ? [...new Set([...preferences.selectedCalendarIds, calendarId])]
      : preferences.selectedCalendarIds.filter((id) => id !== calendarId);
    onChange({
      ...preferences,
      selectedCalendarIds: nextIds,
      hiddenCalendarIds: [],
    });
  };

  return (
    <fieldset disabled={disabled} className="grid min-w-0 gap-2" data-testid="ai-calendar-picker">
      <legend className="font-bold text-foreground">AI calendars</legend>
      <div className="flex flex-wrap items-center gap-2">
        {selected.length > 0 ? selected.map((calendar) => (
          <span key={calendar.id} className="min-w-0 max-w-full bg-timeline-row-hover px-2 py-1 [overflow-wrap:anywhere]">
            {calendar.name}
          </span>
        )) : <span className="text-muted-readable">No calendars selected for AI.</span>}
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          className="product-action product-action-secondary min-h-11 px-3 py-2 text-sm font-bold"
        >
          {expanded ? "Done" : "Change calendars"}
        </button>
      </div>
      {expanded ? (
        <div className="grid max-h-64 gap-1 overflow-y-auto overscroll-contain border border-line p-3">
          {calendars === null ? <p className="text-muted-readable">AI calendar list is not loaded.</p>
            : calendars.length === 0 ? <p className="text-muted-readable">This account has no calendars to show.</p>
            : calendars.map((calendar) => {
              const checked = preferences.selectedCalendarIds.includes(calendar.id);
              return (
                <label key={calendar.id} className="flex min-h-11 items-center gap-2 font-bold">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => toggle(calendar.id, event.target.checked)}
                  />
                  {calendar.name}{calendar.primary ? " (primary)" : ""}
                </label>
              );
            })}
        </div>
      ) : null}
    </fieldset>
  );
}

/** Shared calendar choice field; Outlook reuses it with its own selection keys mapped in. */
export type CalendarChoiceEntry = Pick<CalendarListEntry, "id" | "name" | "primary">;

export function CalendarSelector({ calendars, preferences, onChange, disabled, refreshLabel = "Refresh Google Calendar" }: Readonly<{
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
            : calendars.length === 0 ? <p className="text-muted-readable">This account has no calendars to show.</p>
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

function googleSignInHint(value: NonNullable<CalendarConnectionView["googleSignIn"]>): string {
  if (value === "add") return "Connecting adds the Google account you choose as a way to sign in to Cadence.";
  if (value === "add_on_web") return "Google Calendar connects through a Google sign-in. Add Google under Sign-in methods in Cadence on the web, then connect here.";
  if (value === "multiple") return "This account signs in with more than one Google account, so Google Calendar cannot choose one. Remove one under Sign-in methods, then connect.";
  return "Google Calendar connects only through the Google account you sign in with, and this account does not sign in with Google.";
}

function statusLabel(status: CalendarConnectionView["status"] | "loading"): string {
  if (status === "loading") return "Checking Google Calendar…";
  if (status === "connected") return "Google Calendar connected.";
  if (status === "reconnect_required") return "Google Calendar needs reconnection.";
  if (status === "disconnected") return "Google Calendar is not connected.";
  if (status === "unavailable") return "Google Calendar is not available right now.";
  return "This Cadence server cannot connect Google Calendar.";
}

function aiStatusLabel(status: CalendarConnectionView["status"] | "loading"): string {
  if (status === "loading") return "Checking Google Calendar for AI…";
  if (status === "connected") return "Google Calendar connected for AI features.";
  if (status === "reconnect_required") return "Google Calendar for AI needs reconnection.";
  if (status === "disconnected") return "Google Calendar is not connected for AI features.";
  if (status === "unavailable") return "Google Calendar for AI is not available right now.";
  return "This Cadence server cannot connect Google Calendar for AI.";
}
