"use client";

import type { ComponentProps, ReactNode } from "react";
import { travelPlaceKey } from "@cadence/core/services/travel-place-key";
import type { DailyBriefSettings } from "@cadence/core/types/daily-brief";
import type { PlaceLabelState } from "@cadence/core/types/place-labels";
import type { TravelSettings } from "@cadence/core/types/travel";
import { DailyBriefSettingsPanel } from "@/components/briefing/DailyBriefSettingsPanel";
import { GlobalNoteShortcutControl } from "@/components/note-shortcuts/NoteShortcutControls";
import { AccountDeletionPanel } from "@/components/settings/AccountDeletionPanel";
import { CategoryPanel } from "@/components/settings/CategoryPanel";
import { ConnectedAppsPanel } from "@/components/settings/ConnectedAppsPanel";
import { GoogleCalendarPanel } from "@/components/settings/GoogleCalendarPanel";
import { HevyPanel } from "@/components/settings/HevyPanel";
import { IcloudCalendarPanel } from "@/components/settings/IcloudCalendarPanel";
import { NotificationPermissionPanel } from "@/components/settings/NotificationPermissionPanel";
import { OutlookCalendarPanel } from "@/components/settings/OutlookCalendarPanel";
import { SettingsProfile, TrustAndLegalPanel } from "@/components/settings/SettingsPanels";
import { TimezonePanel } from "@/components/settings/TimezonePanel";
import { TravelSettingsPanel } from "@/components/settings/TravelSettingsPanel";
import { PlaceLabelProvider } from "@/components/travel/PlaceLabels";
import type { CalendarConnectionView } from "@/lib/types/google-calendar";
import type { ConnectorConnectionView } from "@/lib/types/connectors";
import type { DailyBriefClient } from "@/lib/ui/daily-brief";
import type { HevyCoordinator, IcloudCalendarCoordinator, OutlookCalendarCoordinator } from "@/lib/ui/connectors";
import type { GoogleCalendarCoordinator } from "@/lib/ui/google-calendar";
import type { PlaceLabelClient } from "@/lib/ui/place-labels";
import type { TravelSettingsClient } from "@/lib/ui/travel-settings";
import type { SettingsSectionState } from "@/lib/ui/settings-sections";

// Synthetic Settings data for the regroup proposal bench. Every client answers from
// memory and refuses to save: no provider, account, network or location read.

/** `fresh`: a new account. `connected`: every source and feature on. `attention`: connected, Outlook needs reconnection. */
export type SettingsFixtureState = "fresh" | "connected" | "attention";

export type SettingsFixturePanels = Readonly<Record<
  "profile" | "timezone" | "notifications" | "google" | "outlook" | "icloud" | "hevy" | "travel"
  | "dailyBrief" | "connectedApps" | "categories" | "noteShortcuts" | "trust" | "deleteAccount", ReactNode>>;

const range = { startLocalDate: "2026-11-09", endLocalDate: "2026-11-16", timezone: "America/New_York" };
const refuse = async (): Promise<never> => { throw new Error("Bench preview: nothing is saved."); };
const idle = async () => ({ status: "idle" as const, message: "" });

function googleCoordinator(connected: boolean, agent: boolean): GoogleCalendarCoordinator {
  const selected = connected ? (agent ? ["g-1"] : ["g-1", "g-2", "g-3"]) : [];
  const view: CalendarConnectionView = { accountId: "bench-account", status: connected ? "connected" : "disconnected", generation: 1, selectionRevision: 1,
    preferences: { selectedCalendarIds: selected, hiddenCalendarIds: [], visible: true, showAllDay: true } };
  const names = ["Personal", "Work meetings", "Family", "Community events", "Holidays in United States", "Birthdays"];
  return {
    getConnection: async () => view,
    beginConnect: async () => undefined,
    listCalendars: async () => names.map((name, index) => ({ id: `g-${index + 1}`, name, timezone: "America/New_York", accessRole: "reader" as const,
      primary: index === 0, selected: selected.includes(`g-${index + 1}`) })),
    savePreferences: refuse, refreshEvents: refuse, disconnect: refuse,
  };
}

function connectorView(provider: ConnectorConnectionView["provider"], status: ConnectorConnectionView["status"]): ConnectorConnectionView {
  return { accountId: "bench-account", provider, status, generation: 1, selectionRevision: 1,
    preferences: { selectedSourceIds: status === "disconnected" ? [] : ["c-1"], hiddenSourceIds: [], visible: true, showAllDay: true } };
}
function outlookCoordinator(status: ConnectorConnectionView["status"]): OutlookCalendarCoordinator {
  return { getConnection: async () => connectorView("outlook_calendar", status), beginConnect: async () => undefined,
    listCalendars: async () => [{ id: "c-1", name: "Calendar", isDefault: true }, { id: "c-2", name: "Team schedule", isDefault: false }],
    savePreferences: refuse, refreshEvents: refuse, disconnect: refuse };
}
function icloudCoordinator(status: ConnectorConnectionView["status"]): IcloudCalendarCoordinator {
  return { getConnection: async () => connectorView("icloud_calendar", status), connect: refuse,
    listCalendars: async () => [{ id: "c-1", name: "Home", isDefault: true }, { id: "c-2", name: "Family", isDefault: false }],
    savePreferences: refuse, refreshEvents: refuse, disconnect: refuse };
}
function hevyCoordinator(status: ConnectorConnectionView["status"]): HevyCoordinator {
  return { getConnection: async () => connectorView("hevy", status), connect: refuse, refreshActivities: refuse, disconnect: refuse };
}

const homeText = "10 Example Road, Springfield";
const gymKey = travelPlaceKey("2 Example Gym");
function travelClient(connected: boolean): TravelSettingsClient {
  const settings: TravelSettings = connected
    ? { enabled: true, baseLocationText: homeText, mode: "transit", navigationPreference: "google_maps", routingConsentAt: "2026-10-01T12:00:00Z",
      onboardingCompletedAt: "2026-10-01T12:00:00Z", updatedAt: "2026-10-20T12:00:00Z",
      habits: { preparationMinutes: 15, arrivalBufferMinutes: null, leaveFeedback: [], updatedAt: "2026-10-20T12:00:00.000000Z",
        placeModes: [{ placeKey: gymKey, mode: "walking", chosenAt: "2026-10-20T12:00:00.000000Z" }] } }
    : { enabled: false, baseLocationText: null, mode: null, navigationPreference: null, routingConsentAt: null, onboardingCompletedAt: null,
      updatedAt: "2026-11-01T12:00:00Z" };
  return { load: async () => settings, save: refuse, saveHabits: refuse, placeLabels: async () => ({ [gymKey]: "Example Gym" }) };
}
function placeLabelClient(connected: boolean): PlaceLabelClient {
  const state: PlaceLabelState = {
    settings: { enabled: connected, retention: "90_days", enabledAt: connected ? "2026-10-01T12:00:00Z" : null, markerPromptDismissedAt: null, updatedAt: "2026-10-01T12:00:00Z" },
    homePlaceKey: connected ? travelPlaceKey(homeText) : null, homeMarker: null,
    placeMarkers: connected ? [{ placeKey: gymKey, recordedAt: "2026-10-02T12:00:00Z" }] : [], labelCount: connected ? 14 : 0, behaviors: [] };
  return { load: async () => state, saveSettings: refuse, recordMarker: refuse, removeMarkers: refuse, deleteLabels: refuse, dismissSuggestion: refuse,
    capturePlan: async () => null, recordLabel: async () => undefined, locationAllowed: async () => false, readLocation: async () => ({ state: "denied" as const }) };
}
function dailyBriefClient(connected: boolean): DailyBriefClient {
  const settings: DailyBriefSettings = { accountRef: "bench-account", available: true, enabled: connected, includeCalendar: connected,
    includeReminderHistory: false, includeNotes: false, optionalSources: { reminders: true, notes: true },
    includeOutlookCalendar: false, includeIcloudCalendar: false, includeHevy: false,
    connectorSources: { outlookCalendar: connected, icloudCalendar: connected, hevy: connected },
    connectorAttention: { outlookCalendar: null, icloudCalendar: null, hevy: null }, revision: 1, localDate: "2026-11-09", timezone: "America/New_York" };
  return { preferences: async () => settings, updatePreferences: refuse, requestBrief: async () => ({ state: "already_attempted" }) };
}

type ConnectedAppsView = ComponentProps<typeof ConnectedAppsPanel>["view"];
function connectedApps(connected: boolean): ConnectedAppsView {
  if (!connected) return { error: null, grants: [], activity: [] };
  type Grant = ConnectedAppsView["grants"][number];
  const grant = (grantId: string, clientName: string, scopes: Grant["scopes"], lastUsedAt: string | null): Grant => ({
    grantId, clientId: grantId, clientName, clientUri: null, logoUri: null, verifiedClient: null, scopes, createdAt: "2026-10-30T15:00:00Z", lastUsedAt });
  return { error: null,
    grants: [grant("bench-client-1", "Example AI client", ["cadence.read", "cadence.occurrences.write", "cadence.behaviors.write"], "2026-11-08T14:10:00Z"),
      grant("bench-client-2", "Second example client", ["cadence.read"], null)],
    activity: [{ activityId: 1, grantId: "bench-client-1", clientName: "Example AI client", operation: "get_timeline", outcome: "success", errorCode: null, occurredAt: "2026-11-08T14:10:00Z" }] };
}

export const settingsFixtureCategories = ["Medical", "Grooming", "Fitness", "Food / Drink", "Home", "Measurements", "Admin", "Other"]
  .map((name, index) => ({ id: `category-${index}`, name, description: null, sort_order: index, updated_at: "2026-09-05T00:00:00Z" }));

/** The Daily Brief sketch's state line. The real panel reports its own through `dailyBriefSectionState`. */
export function settingsFixtureDailyBriefState(state: SettingsFixtureState): SettingsSectionState {
  return state === "fresh" ? { text: "Off", attention: false, on: false } : { text: "On · using your connected sources", attention: false, on: true };
}

/** The real Settings panels, each fed by a synthetic client for the given account state. */
export function settingsFixturePanels(state: SettingsFixtureState): SettingsFixturePanels {
  const connected = state !== "fresh";
  const sourceStatus = connected ? "connected" : "disconnected";
  return {
    profile: <SettingsProfile email="reader@example.test" />,
    timezone: <TimezonePanel currentTimezone="America/New_York" updateTimezoneAction={async (previous) => previous} />,
    notifications: <NotificationPermissionPanel vapidPublicKey="" />,
    google: <GoogleCalendarPanel coordinator={googleCoordinator(connected, false)} refreshRange={range} nested />,
    outlook: <OutlookCalendarPanel coordinator={outlookCoordinator(state === "attention" ? "reconnect_required" : sourceStatus)} refreshRange={range} />,
    icloud: <IcloudCalendarPanel coordinator={icloudCoordinator(sourceStatus)} refreshRange={range} />,
    hevy: <HevyPanel coordinator={hevyCoordinator(sourceStatus)} localDate="2026-11-09" timezone="America/New_York" />,
    travel: <PlaceLabelProvider client={placeLabelClient(connected)}>
      <TravelSettingsPanel client={travelClient(connected)} readLocation={async () => ({ state: "denied" as const })}
        readPermission={async () => (connected ? "granted" : "prompt")}
        leaveReminderClient={{ load: async () => ({ enabled: connected }), save: refuse }}
        readDeviceNotifications={async () => (connected ? "enabled" : "not_enabled")} />
    </PlaceLabelProvider>,
    dailyBrief: <DailyBriefSettingsPanel client={dailyBriefClient(connected)} />,
    connectedApps: <ConnectedAppsPanel view={connectedApps(connected)} timezone="America/New_York" action={async () => ({ status: "error", message: "Preview only. No account access changed." })} />,
    categories: <CategoryPanel categories={settingsFixtureCategories} assignments={[]} action={idle} />,
    noteShortcuts: <GlobalNoteShortcutControl view={{ state: null, globalEnabled: true, available: true, entries: [] }} action={idle} />,
    trust: <TrustAndLegalPanel />,
    deleteAccount: <AccountDeletionPanel headingLevel={null} confirmationLabel="reader@example.test" deleteAccountAction={idle} />,
  };
}
