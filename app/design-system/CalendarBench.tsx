"use client";
import { travelBenchEvidence } from "./TravelBench";
import { Temporal } from "@js-temporal/polyfill";
import { DayProgressTimeline } from "@/components/timeline/DayProgressTimeline";
import { resolveTimeline } from "@cadence/core/resolvers/timeline.resolver";
import { useMemo, useState } from "react";
import { GoogleCalendarPanel } from "@/components/settings/GoogleCalendarPanel";
import { ExternalEventDetails, ExternalEventPreview } from "@/components/timeline/ExternalEventDetails";
import type { GoogleCalendarCoordinator } from "@/lib/ui/google-calendar";
import type { CalendarConnectionView } from "@/lib/types/google-calendar";
import { validateExternalEventSnapshot } from "@cadence/core/services/external-event-validation";
import fixture from "@/tests/fixtures/external-event-snapshot.valid.json";
import { benchOutlookSnapshot, benchRecordedActivity } from "./ConnectorBench";
const snapshot = validateExternalEventSnapshot(fixture);
const connection: CalendarConnectionView = { accountId: snapshot.accountId, status: "connected", generation: 1, selectionRevision: 0,
  preferences: { selectedCalendarIds: [...snapshot.requestedRange.selectedCalendarIds], hiddenCalendarIds: [], visible: true, showAllDay: true } };
const coordinator: GoogleCalendarCoordinator = {
  getConnection: async () => connection,
  beginConnect: async () => undefined,
  listCalendars: async () => [
    ...snapshot.requestedRange.selectedCalendarIds.map((id) => ({ id, name: "Personal calendar", timezone: snapshot.requestedRange.timezone, accessRole: "reader" as const, primary: true, selected: true })),
    ...["Work meetings", "Community events", "A subscribed calendar with a very long name that wraps on narrow screens", ...Array.from({ length: 12 }, (_, i) => `Shared calendar ${i + 1}`)].map((name, i) => ({ id: `choice-${i}`, name, timezone: "UTC", accessRole: "reader" as const, primary: false, selected: false })),
  ],
  savePreferences: async (preferences) => ({ ...connection, preferences }),
  refreshEvents: async () => snapshot,
  disconnect: async () => ({ view: { ...connection, status: "disconnected" }, revocationFailed: false }),
};
export function CalendarSettingsBench() {
  const [mode, setMode] = useState("standard");
  const [status, setStatus] = useState<CalendarConnectionView["status"]>("connected");
  const fixtureCoordinator = useMemo(() => ({ ...coordinator, getConnection: async () => ({ ...connection, status }) }), [status]);
  return <><label className="mb-4 grid gap-2 text-sm">Connection purpose<select className="min-h-11 border border-line bg-background" value={mode} onChange={event => setMode(event.target.value)}><option value="standard">Timeline</option><option value="agent">Daily Brief</option></select></label>
    <label className="mb-4 grid gap-2 text-sm">Connection state<select className="min-h-11 border border-line bg-background" value={status} onChange={event => setStatus(event.target.value as CalendarConnectionView["status"])}><option value="connected">Connected</option><option value="disconnected">Disconnected</option><option value="not_configured">Not configured</option><option value="reconnect_required">Reconnect required</option></select></label>
    <GoogleCalendarPanel key={`${mode}-${status}`} agent={mode === "agent"} coordinator={fixtureCoordinator} refreshRange={snapshot.requestedRange} /></>;
}
export function CalendarDetailsBench({ preview = false }: { preview?: boolean }) {
  const [open, setOpen] = useState(false);
  const event = snapshot.events[0];
  if (!event) return null;
  return <><button type="button" onClick={() => setOpen(true)}>Open synthetic Calendar {preview ? "preview" : "details"}</button>
    {preview && open ? <ExternalEventPreview id="bench-calendar-preview" events={[event]} timezone={snapshot.requestedRange.timezone} onDismiss={() => setOpen(false)} onOpen={() => setOpen(false)} /> : null}
    {!preview ? <ExternalEventDetails event={open ? event : null} timezone={snapshot.requestedRange.timezone} onClose={() => setOpen(false)} onDismissAllDay={() => setOpen(false)} /> : null}</>;
}

const timeline = resolveTimeline({ timezone: snapshot.requestedRange.timezone, now: Temporal.Instant.from(snapshot.fetchedAt), futureDays: 7,
  occurrences: ["05:45:00", "13:00:00", "22:00:00"].map((time, index) => ({
    id: `calendar-bench-${index}`, behaviorId: "calendar-bench-behavior", title: index ? "Drink water" : "Review notes",
    description: "Synthetic occurrence for shared Timeline verification.", categoryName: "Routine", scheduleSummary: "Daily",
    scheduledFor: `2026-11-01T${time}Z`, scheduledTimeLabel: index ? (index === 1 ? "8:00 AM" : "5:00 PM") : "1:45 AM",
    localDate: "2026-11-01", status: "unresolved", statusMarkedAt: null, note: "", canStartTimeTracking: true,
    timeTracking: { recordedSeconds: 0, runningStartedAt: null },
  })),
});
const idleAction = async () => ({ status: "idle" as const, message: "Synthetic preview only." });
export function CalendarTimelineBench() {
  const [scenario, setScenario] = useState("calendar");
  const first = snapshot.events[0]!;
  const connectors = scenario === "connectors" || scenario === "connectors-offline";
  const events = connectors ? [...snapshot.events, ...benchOutlookSnapshot.events] : scenario === "calendar" ? snapshot.events : [{ ...first, kind: "timed" as const, title: "Afternoon appointment", location: "Synthetic destination", startAt: "2026-11-01T19:30:00Z", endAt: "2026-11-01T21:30:00Z", endUnspecified: false, duration: { kind: "known" as const, seconds: 7200 } }];
  return <><label className="mb-4 grid gap-2 text-sm">Fixture<select className="min-h-11 border border-line bg-background" value={scenario} onChange={(event) => setScenario(event.target.value)}><option value="calendar">Calendar</option><option value="connectors">Google, Outlook, and Hevy</option><option value="connectors-offline">Outlook incomplete, Hevy offline</option><option value="travel">Complete trip: 1:30–6:30 PM</option><option value="no-base">No base: keep outbound</option></select></label>
    <DayProgressTimeline timeline={timeline} context={{ events, freshness: snapshot.freshness, now: snapshot.fetchedAt,
      durationEstimates: { "calendar-bench-behavior": { kind: "known", seconds: 1800, durationLabel: "30 minutes", sampleCount: 0, lookbackDays: 30, provenance: "behavior_default" } },
      travel: scenario === "calendar" || connectors ? null : travelBenchEvidence(first.id, scenario === "travel"), travelMode: "walking",
      recordedActivity: scenario === "connectors" ? benchRecordedActivity.ready : scenario === "connectors-offline" ? benchRecordedActivity.error : null,
      sourceMessages: scenario === "connectors-offline" ? ["Outlook Calendar context is incomplete; some events may be missing."] : [] }}
    statusAction={idleAction} noteAction={idleAction} startTimeTrackingAction={idleAction} stopTimeTrackingAction={idleAction} resetTimeTrackingAction={idleAction} /></>;
}
