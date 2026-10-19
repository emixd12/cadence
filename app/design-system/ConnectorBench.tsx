"use client";

import { useState } from "react";
import { Temporal } from "@js-temporal/polyfill";
import { validateVersionedExternalEventSnapshot } from "@cadence/core/services/external-event-validation";
import { projectRecordedActivityDay } from "@cadence/core/services/recorded-activity-refresh";
import { validateRecordedActivitySnapshot } from "@cadence/core/services/recorded-activity-validation";
import type { ExternalEventSnapshotV1_1 } from "@cadence/core/types/external-event";
import { ConnectorLibrary, ConnectorUnavailable, connectorUnavailableReason } from "@/components/settings/ConnectorLibrary";
import { GoogleCalendarPanel } from "@/components/settings/GoogleCalendarPanel";
import { HevyPanel } from "@/components/settings/HevyPanel";
import { OutlookCalendarPanel } from "@/components/settings/OutlookCalendarPanel";
import { RecordedActivityList } from "@/components/timeline/RecordedActivityList";
import type { ConnectorConnectionView } from "@/lib/types/connectors";
import type { GoogleCalendarCoordinator } from "@/lib/ui/google-calendar";
import { ConnectorClientError, type HevyCoordinator, type HevyTimelineState, type OutlookCalendarCoordinator } from "@/lib/ui/connectors";
import outlookFixture from "@/tests/fixtures/external-event-snapshot.outlook.valid.json";
import hevyFixture from "@/tests/fixtures/recorded-activity-snapshot.valid.json";

// Ticket 225 deterministic connector bench. Synthetic coordinators only: no
// provider, account, network, Keychain, or cache access.

export const benchOutlookSnapshot = validateVersionedExternalEventSnapshot(outlookFixture) as ExternalEventSnapshotV1_1;
const hevySnapshot = validateRecordedActivitySnapshot(hevyFixture, { now: Temporal.Instant.from("2026-11-01T15:00:00Z") });
const hevyDay = projectRecordedActivityDay({ snapshot: hevySnapshot, localDate: "2026-11-01", now: Temporal.Instant.from("2026-11-01T15:05:00Z") });
export const benchRecordedActivity: Readonly<Record<"ready" | "stale" | "incomplete" | "error", HevyTimelineState>> = {
  ready: { state: "ready", day: hevyDay, error: null },
  stale: { state: "stale", day: { ...hevyDay, state: "stale" }, error: null },
  incomplete: { state: "incomplete", day: { ...hevyDay, state: "incomplete" }, error: null },
  error: { state: "error", day: { ...hevyDay, state: "stale" }, error: "timeout" },
};

type Scenario = "connected" | "disconnected" | "not_configured" | "reconnect_required" | "status_error" | "desktop_local";
const SCENARIOS: Readonly<Record<Scenario, string>> = {
  connected: "Connected",
  disconnected: "Not connected",
  not_configured: "Not configured",
  reconnect_required: "Needs reconnection",
  status_error: "Status unavailable",
  desktop_local: "Desktop local mode",
};

const range = { startLocalDate: "2026-11-01", endLocalDate: "2026-11-03", timezone: "America/New_York" };
function connection(provider: "hevy" | "outlook_calendar", status: ConnectorConnectionView["status"]): ConnectorConnectionView {
  return { accountId: "bench-account", provider, status, generation: 2, selectionRevision: 1,
    preferences: { selectedSourceIds: ["calendar-1"], hiddenSourceIds: [], visible: true, showAllDay: true } };
}
function statusFor(scenario: Scenario): ConnectorConnectionView["status"] {
  return scenario === "connected" ? "connected" : scenario === "not_configured" ? "not_configured" : scenario === "reconnect_required" ? "reconnect_required" : "disconnected";
}
function outlookCoordinator(scenario: Scenario): OutlookCalendarCoordinator {
  return {
    getConnection: async () => { if (scenario === "status_error") throw new ConnectorClientError("provider_unavailable"); return connection("outlook_calendar", statusFor(scenario)); },
    beginConnect: async () => undefined,
    listCalendars: async () => [{ id: "calendar-1", name: "Personal", isDefault: true }, { id: "calendar-2", name: "Team schedule with a long shared calendar name that wraps", isDefault: false }],
    savePreferences: async (preferences) => ({ ...connection("outlook_calendar", "connected"), preferences }),
    refreshEvents: async () => benchOutlookSnapshot,
    disconnect: async () => ({ view: connection("outlook_calendar", "disconnected"), revocation: "microsoft_account_permissions" }),
  };
}
function hevyCoordinator(scenario: Scenario): HevyCoordinator {
  return {
    getConnection: async () => { if (scenario === "status_error") throw new ConnectorClientError("provider_unavailable"); return connection("hevy", statusFor(scenario)); },
    connect: async () => { throw new ConnectorClientError("permission_denied"); },
    refreshActivities: async () => ({ snapshot: hevySnapshot, replaced: true, refreshFailures: [] }),
    disconnect: async () => ({ view: connection("hevy", "disconnected"), revocation: "hevy_api_key" }),
  };
}
const googleCoordinator: GoogleCalendarCoordinator = {
  getConnection: async () => ({ accountId: "bench-account", status: "disconnected", generation: 0, selectionRevision: 0,
    preferences: { selectedCalendarIds: [], hiddenCalendarIds: [], visible: true, showAllDay: true } }),
  beginConnect: async () => undefined,
  listCalendars: async () => [],
  savePreferences: async () => { throw new Error("Synthetic bench"); },
  refreshEvents: async () => { throw new Error("Synthetic bench"); },
  disconnect: async () => { throw new Error("Synthetic bench"); },
};

export function ConnectorLibraryBench() {
  const [scenario, setScenario] = useState<Scenario>("connected");
  const local = scenario === "desktop_local";
  return <>
    <label className="mb-4 grid max-w-sm gap-2 text-sm">Connector state
      <select className="min-h-11 border border-line bg-background px-2" value={scenario} onChange={(event) => setScenario(event.target.value as Scenario)}>
        {Object.entries(SCENARIOS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </label>
    <ConnectorLibrary key={scenario} sources={[
      { id: "google_calendar", content: local ? <ConnectorUnavailable id="google_calendar" reason="Calendar requires a linked account." />
        : <GoogleCalendarPanel coordinator={googleCoordinator} refreshRange={range} nested /> },
      { id: "outlook_calendar", content: local ? <ConnectorUnavailable id="outlook_calendar" reason={connectorUnavailableReason("Outlook Calendar", "local")} />
        : <OutlookCalendarPanel coordinator={outlookCoordinator(scenario)} refreshRange={range} /> },
      { id: "icloud_calendar" },
      { id: "hevy", content: local ? <ConnectorUnavailable id="hevy" reason={connectorUnavailableReason("Hevy", "local")} />
        : <HevyPanel coordinator={hevyCoordinator(scenario)} localDate="2026-11-01" timezone="America/New_York" /> },
    ]} />
  </>;
}

export function OutlookCalendarPanelBench() {
  return <OutlookCalendarPanel coordinator={outlookCoordinator("connected")} refreshRange={range} />;
}

export function HevyPanelBench() {
  return <HevyPanel coordinator={hevyCoordinator("disconnected")} localDate="2026-11-01" timezone="America/New_York" />;
}

export function RecordedActivityBench() {
  return <div className="grid gap-4">
    {(Object.keys(benchRecordedActivity) as (keyof typeof benchRecordedActivity)[]).map((state) =>
      <RecordedActivityList key={state} activity={benchRecordedActivity[state]} timezone="America/New_York" label={`Sunday (${state})`} />)}
  </div>;
}
