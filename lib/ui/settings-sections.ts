import { DAILY_BRIEF_CONNECTED_SOURCES, type DailyBriefSettings } from "@cadence/core/types/daily-brief";
import type { TravelMode, TravelSettings } from "@cadence/core/types/travel";
import type { ConnectorConnectionView } from "@/lib/types/connectors";
import type { CalendarConnectionView } from "@/lib/types/google-calendar";

// Ticket 301. Each Settings row or drawer shows one line of state while it is
// closed. These pure functions map a panel's loaded state to that line. They
// read no browser API and keep no state; panels report the result upward.

/**
 * `text` is the visible state. `attention` marks a state the person must act on;
 * its row or drawer opens by itself. `on` marks a connected or enabled section.
 */
export type SettingsSectionState = Readonly<{ text: string; attention: boolean; on: boolean }>;

/** A panel's read: still loading, failed, or loaded with a value. */
export type SettingsSectionLoad<T> =
  | Readonly<{ phase: "loading" }>
  | Readonly<{ phase: "failed" }>
  | Readonly<{ phase: "loaded"; value: T }>;

export const SETTINGS_SECTION_CHECKING: SettingsSectionState = Object.freeze({ text: "Checking…", attention: false, on: false });
export const SETTINGS_SECTION_UNAVAILABLE: SettingsSectionState = Object.freeze({ text: "Status unavailable", attention: true, on: false });

/** Builds the load value a panel reports from its own fields. */
export function settingsSectionLoad<T>(value: T | null | undefined, failed: boolean): SettingsSectionLoad<T> {
  if (value !== null && value !== undefined) return { phase: "loaded", value };
  return failed ? { phase: "failed" } : { phase: "loading" };
}

export function isSettingsSectionChecking(state: SettingsSectionState): boolean {
  return state.text === SETTINGS_SECTION_CHECKING.text && !state.attention;
}

const state = (text: string, on: boolean, attention = false): SettingsSectionState => ({ text, attention, on });
const NOT_CONNECTED = state("Not connected", false);
const NEEDS_RECONNECTION = state("Needs reconnection", true, true);
const NOT_AVAILABLE = state("Not available here", false);

function calendarCount(count: number): SettingsSectionState {
  if (count === 0) return state("Connected · No calendars chosen", true, true);
  return state(`Connected · ${count} ${count === 1 ? "calendar" : "calendars"}`, true);
}

/** Google Calendar for Timeline. A server that cannot read the connection counts as a failed read. */
export function googleCalendarSectionState(load: SettingsSectionLoad<CalendarConnectionView>): SettingsSectionState {
  if (load.phase === "loading") return SETTINGS_SECTION_CHECKING;
  if (load.phase === "failed") return SETTINGS_SECTION_UNAVAILABLE;
  const view = load.value;
  switch (view.status) {
    case "connected": return calendarCount(view.preferences.selectedCalendarIds.length);
    case "reconnect_required": return NEEDS_RECONNECTION;
    case "disconnected": return NOT_CONNECTED;
    case "not_configured": return NOT_AVAILABLE;
    case "unavailable": return SETTINGS_SECTION_UNAVAILABLE;
  }
}

/** Outlook Calendar, iCloud Calendar and Hevy. Hevy is recorded activity, so it counts no calendars. */
export function connectorSectionState(load: SettingsSectionLoad<ConnectorConnectionView>): SettingsSectionState {
  if (load.phase === "loading") return SETTINGS_SECTION_CHECKING;
  if (load.phase === "failed") return SETTINGS_SECTION_UNAVAILABLE;
  const view = load.value;
  switch (view.status) {
    case "connected": return view.provider === "hevy" ? state("Connected", true) : calendarCount(view.preferences.selectedSourceIds.length);
    case "reconnect_required": return NEEDS_RECONNECTION;
    case "disconnected": return NOT_CONNECTED;
    case "not_configured": return NOT_AVAILABLE;
  }
}

const TRAVEL_MODE_LABELS: Readonly<Record<TravelMode, string>> = {
  walking: "Walking", cycling: "Cycling", transit: "Transit", driving: "Driving",
};

export function travelSectionState(load: SettingsSectionLoad<TravelSettings>): SettingsSectionState {
  if (load.phase === "loading") return SETTINGS_SECTION_CHECKING;
  if (load.phase === "failed") return SETTINGS_SECTION_UNAVAILABLE;
  const settings = load.value;
  if (!settings.enabled) return state("Off", false);
  const mode = settings.mode ? TRAVEL_MODE_LABELS[settings.mode] : null;
  const home = settings.baseLocationText ? "from Home" : null;
  const detail = [mode, home].filter(Boolean).join(" ");
  return state(detail ? `On · ${detail}` : "On", true);
}

const DAILY_BRIEF_SOURCES = [
  { include: "includeOutlookCalendar", offer: "outlookCalendar" },
  { include: "includeIcloudCalendar", offer: "icloudCalendar" },
  { include: "includeHevy", offer: "hevy" },
] as const;

/**
 * Ticket 306: one choice covers every connected source, so a covered source follows its
 * current connection and needs no new choice; the state counts the sources the brief uses.
 * A server from before the one choice (no `useConnectedSources`) keeps the earlier rule:
 * action is needed when an allowed source cannot be used now.
 */
export function dailyBriefSectionState(load: SettingsSectionLoad<DailyBriefSettings>): SettingsSectionState {
  if (load.phase === "loading") return SETTINGS_SECTION_CHECKING;
  if (load.phase === "failed") return SETTINGS_SECTION_UNAVAILABLE;
  const settings = load.value;
  if (!settings.available) return state("Unavailable", false);
  if (!settings.enabled) return state("Off", false);
  if (settings.useConnectedSources !== undefined) {
    if (!settings.useConnectedSources || !settings.sourceStatus) return state("On", true);
    const used = DAILY_BRIEF_CONNECTED_SOURCES.filter((source) =>
      settings.sourceStatus?.[source] === "ready" && settings.excludedSources?.[source] !== true).length;
    return state(used === 0 ? "On" : `On · Plans around ${used} ${used === 1 ? "source" : "sources"}`, true);
  }
  const attention = DAILY_BRIEF_SOURCES.some((source) => {
    if (settings[source.include] !== true) return false;
    const reported = settings.connectorAttention?.[source.offer];
    return reported !== undefined ? reported !== null : settings.connectorSources?.[source.offer] !== true;
  });
  return attention ? state("On · A source needs your choice", true, true) : state("On", true);
}

/** Categories load with the page, so their count is always known. */
export function categoriesSectionState(count: number): SettingsSectionState {
  if (count === 0) return state("No categories", false);
  return state(`${count} ${count === 1 ? "category" : "categories"}`, true);
}
