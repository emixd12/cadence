"use client";
import { TRAVEL_BENCH_NOW, TravelBenchCaption, travelBenchDeparture, travelBenchEvidence } from "./TravelBench";
import { Temporal } from "@js-temporal/polyfill";
import { DayProgressTimeline } from "@/components/timeline/DayProgressTimeline";
import { resolveTimeline } from "@cadence/core/resolvers/timeline.resolver";
import { useMemo, useState } from "react";
import { DevelopmentBuildProvider } from "@cadence/ui/runtime";
import type { NormalizedExternalEvent } from "@cadence/core/types/day-progress";
import { GoogleCalendarPanel } from "@/components/settings/GoogleCalendarPanel";
import { ExternalEventDetails, ExternalEventPreview } from "@/components/timeline/ExternalEventDetails";
import type { GoogleCalendarCoordinator } from "@/lib/ui/google-calendar";
import type { CalendarConnectionView } from "@/lib/types/google-calendar";
import { validateExternalEventSnapshot, validateVersionedExternalEventSnapshot } from "@cadence/core/services/external-event-validation";
import fixture from "@/tests/fixtures/external-event-snapshot.valid.json";
import icloudFixture from "@/tests/fixtures/external-event-snapshot.icloud.valid.json";
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
  const [status, setStatus] = useState<CalendarConnectionView["status"]>("connected");
  const fixtureCoordinator = useMemo(() => ({ ...coordinator, getConnection: async () => ({ ...connection, status }) }), [status]);
  return <><label className="mb-4 grid gap-2 text-sm">Connection state<select className="min-h-11 border border-line bg-background" value={status} onChange={event => setStatus(event.target.value as CalendarConnectionView["status"])}><option value="connected">Connected</option><option value="disconnected">Disconnected</option><option value="not_configured">Not configured</option><option value="reconnect_required">Reconnect required</option></select></label>
    <GoogleCalendarPanel key={status} coordinator={fixtureCoordinator} refreshRange={snapshot.requestedRange} /></>;
}
const googleTimed = snapshot.events[0]!;
const googleFull: NormalizedExternalEvent = { ...googleTimed, title: "Afternoon appointment", location: "Synthetic destination",
  kind: "timed", startAt: "2026-11-01T19:30:00Z", endAt: "2026-11-01T21:30:00Z", endUnspecified: false, duration: { kind: "known", seconds: 7200 },
  organizer: { displayName: "Synthetic organizer", email: "organizer@example.com", self: false },
  conference: { name: "Synthetic Meet", notes: null, entryPoints: [{ type: "video", uri: "https://meet.example.com/synthetic", label: "Join video" }] },
  attachments: [{ title: "Agenda", url: "https://example.com/agenda", mimeType: null }] };
const googleSparse: NormalizedExternalEvent = { ...googleTimed, title: "Restricted event", description: "", attendees: null,
  fieldAvailability: { description: "restricted", location: "provider_omitted", organizer: "not_provided", attendees: "restricted", conference: "provider_omitted", attachments: "not_provided" },
  detailCompleteness: { attendees: "restricted" } };
const icloudSnapshot = validateVersionedExternalEventSnapshot(icloudFixture);
const DETAIL_CASES: readonly Readonly<{ id: string; label: string; event: NormalizedExternalEvent; travel?: boolean }>[] = [
  { id: "google-full", label: "Google: every row and travel", event: googleFull, travel: true },
  { id: "google-sparse", label: "Google: restricted and omitted fields", event: googleSparse },
  { id: "google-all-day", label: "Google: all-day", event: snapshot.events[1]! },
  { id: "outlook-timed", label: "Outlook: overnight, fields unavailable", event: benchOutlookSnapshot.events[0]! },
  { id: "outlook-all-day", label: "Outlook: all-day, no source link", event: benchOutlookSnapshot.events[1]! },
  { id: "icloud-recurring", label: "iCloud: recurring", event: icloudSnapshot.events[0]! },
  { id: "icloud-open-ended", label: "iCloud: end unknown", event: icloudSnapshot.events[1]! },
];
export function CalendarDetailsBench({ preview = false }: { preview?: boolean }) {
  const [open, setOpen] = useState(false);
  const [caseId, setCaseId] = useState(DETAIL_CASES[0]!.id);
  const [development, setDevelopment] = useState(false);
  const event = snapshot.events[0];
  if (!event) return null;
  if (preview) return <><button type="button" onClick={() => setOpen(true)}>Open synthetic Calendar preview</button>
    {open ? <ExternalEventPreview id="bench-calendar-preview" events={[event]} timezone={snapshot.requestedRange.timezone} onDismiss={() => setOpen(false)} onOpen={() => setOpen(false)} /> : null}</>;
  const selected = DETAIL_CASES.find((item) => item.id === caseId) ?? DETAIL_CASES[0]!;
  return <div className="grid gap-3">
    <label className="grid gap-2 text-sm">Event<select className="min-h-11 border border-line bg-background" value={caseId} onChange={(change) => setCaseId(change.target.value)}>{DETAIL_CASES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
    <label className="grid gap-2 text-sm">Build<select className="min-h-11 border border-line bg-background" value={development ? "development" : "production"} onChange={(change) => setDevelopment(change.target.value === "development")}><option value="production">Production</option><option value="development">Development</option></select></label>
    <button type="button" className="w-fit" onClick={() => setOpen(true)}>Open synthetic Calendar details</button>
    <DevelopmentBuildProvider value={development}>
      <ExternalEventDetails event={open ? selected.event : null} timezone={snapshot.requestedRange.timezone} onClose={() => setOpen(false)} onDismissAllDay={() => setOpen(false)} onTravelCorrection={() => undefined}
        {...benchDialogTravel(selected.travel ? selected.event.id : null)} travelMode="walking" />
    </DevelopmentBuildProvider>
  </div>;
}

/** Synthetic travel for the dialog, with its departure model. No provider call. */
function benchDialogTravel(eventId: string | null) {
  if (!eventId) return { travel: null };
  const travel = travelBenchEvidence(eventId, true, "thunderstorm");
  return { travel, departure: travelBenchDeparture(eventId, travel), now: TRAVEL_BENCH_NOW };
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
  const weather = scenario === "travel-weather" ? "thunderstorm" as const : scenario === "travel-no-position" ? "no_position" as const : undefined;
  const travel = scenario === "calendar" || connectors ? null : travelBenchEvidence(first.id, scenario !== "no-base", weather);
  // Weather scenarios show the shared travel status line; the bench never refreshes.
  const travelStatus = travel && weather ? { view: { accountId: "bench", mode: "walking" as const, navigationPreference: null, settingsRevision: "fixture",
    expiresAt: "2026-11-01T13:05:00Z", evidence: travel }, message: null, stale: false, pending: false, observedAt: snapshot.fetchedAt, resumesAt: null,
    refresh: () => undefined } : null;
  const events = connectors ? [...snapshot.events, ...benchOutlookSnapshot.events] : scenario === "calendar" ? snapshot.events : [{ ...first, kind: "timed" as const, title: "Afternoon appointment", location: "Synthetic destination", startAt: "2026-11-01T19:30:00Z", endAt: "2026-11-01T21:30:00Z", endUnspecified: false, duration: { kind: "known" as const, seconds: 7200 } }];
  return <><label className="mb-4 grid gap-2 text-sm">Fixture<select className="min-h-11 border border-line bg-background" value={scenario} onChange={(event) => setScenario(event.target.value)}><option value="calendar">Calendar</option><option value="connectors">Google, Outlook, and Hevy</option><option value="connectors-offline">Outlook incomplete, Hevy offline</option><option value="travel">Complete trip: 1:30–6:30 PM</option><option value="travel-weather">Thunderstorms: 15 min weather margin</option><option value="travel-no-position">No device location: no weather margin</option><option value="no-base">No base: keep outbound</option></select></label>
    {travel ? <div className="mb-4"><TravelBenchCaption /></div> : null}
    <DayProgressTimeline timeline={timeline} context={{ events, freshness: snapshot.freshness, now: snapshot.fetchedAt,
      durationEstimates: { "calendar-bench-behavior": { kind: "known", seconds: 1800, durationLabel: "30 minutes", sampleCount: 0, lookbackDays: 30, provenance: "behavior_default" } },
      travel, travelStatus, travelMode: "walking",
      recordedActivity: scenario === "connectors" ? benchRecordedActivity.ready : scenario === "connectors-offline" ? benchRecordedActivity.error : null,
      sourceMessages: scenario === "connectors-offline" ? ["Outlook Calendar context is incomplete; some events may be missing."] : [] }}
    statusAction={idleAction} noteAction={idleAction} startTimeTrackingAction={idleAction} stopTimeTrackingAction={idleAction} resetTimeTrackingAction={idleAction} /></>;
}
