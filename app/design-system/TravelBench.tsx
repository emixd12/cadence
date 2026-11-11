"use client";

import { useState } from "react";
import { DevelopmentBuildProvider } from "@cadence/ui/runtime";
import { DailyBriefBubble } from "@/components/briefing/DailyBriefBubble";
import { renderTravelTiming } from "@/components/timeline/ExternalEventDetails";
import { resolveTravelPlan, resolveTravelEvidence } from "@cadence/core/resolvers/travel.resolver";
import { resolveDepartureModel } from "@cadence/core/resolvers/departure.resolver";
import { projectBriefTravelGuidance } from "@cadence/core/services/brief-travel-guidance";
import { planTravelHabitChange } from "@cadence/core/services/travel-habits";
import { travelPlaceKey } from "@cadence/core/services/travel-place-key";
import { TravelHabitsSection } from "@/components/settings/TravelHabitsSection";
import { LeaveReminderSetting } from "@/components/settings/LeaveReminderSetting";
import type { LeaveReminderClient } from "@/lib/ui/leave-reminders";
import type { HomeLookupClient } from "@/lib/ui/home-lookup";
import { TravelSettingsPanel } from "@/components/settings/TravelSettingsPanel";
import { TravelLeaveQuestion } from "@/components/timeline/TravelLeaveQuestion";
import { TravelModeChoice } from "@/components/timeline/TravelModeChoice";
import type { TravelSettings } from "@cadence/core/types/travel";
import type { TravelWeatherInput } from "@cadence/core/types/weather";
import type { TravelSettingsClient } from "@/lib/ui/travel-settings";
import { PlaceLabelBench } from "./PlaceLabelBench";

const BENCH_NOW = "2026-10-22T15:00:00.000000Z";
const homeKey = travelPlaceKey("10 Bench Road");
const initial: TravelSettings = { enabled: false, baseLocationText: "10 Bench Road", mode: "walking",
  navigationPreference: "google_maps", routingConsentAt: null, onboardingCompletedAt: null,
  updatedAt: "2026-09-21T12:00:00Z",
  habits: { preparationMinutes: 15, arrivalBufferMinutes: null, leaveFeedback: [], updatedAt: "2026-10-20T12:00:00.000000Z",
    placeModes: [{ placeKey: homeKey, mode: "transit", chosenAt: "2026-10-20T12:00:00.000000Z" }] } };
// Bench-only memory: habit changes stay in this page and never reach an account.
let benchSettings = initial;
const client: TravelSettingsClient = {
  load: async () => benchSettings,
  save: async (value) => (benchSettings = { ...benchSettings, ...value, routingConsentAt: value.enabled ? initial.updatedAt : null }),
  saveHabits: async (input) => (benchSettings = { ...benchSettings, habits: planTravelHabitChange(benchSettings.habits, input, BENCH_NOW) }),
  placeLabels: async () => ({ [homeKey]: "Home" }),
};
const denied = async () => ({ state: "denied" as const });
// Ticket 165 guidance: travel on, device location not yet allowed, desktop Settings button.
const enabled: TravelSettings = { ...initial, enabled: true, mode: "walking", routingConsentAt: initial.updatedAt };
const enabledClient: TravelSettingsClient = { load: async () => enabled, save: async () => enabled };
const notAllowed = async (requestPermission: boolean) => requestPermission
  ? { state: "unavailable" as const, reason: "timeout" } : { state: "prompt" as const };
const benchOnly = async () => {};
/** Ticket 279: bench-only memory for the leave reminder switch; nothing reaches the hosted endpoint. */
function benchReminderClient(initialEnabled: boolean): LeaveReminderClient {
  let enabled = initialEnabled;
  return { load: async () => ({ enabled }), save: async (next) => ({ enabled: (enabled = next) }) };
}
const panelReminders = benchReminderClient(false);
/** Ticket 308: a bench-only Home lookup; no position or request leaves this page. */
const benchHomeLookup: HomeLookupClient = { lookup: async () => ({ kind: "address", address: "10 Bench Road, Springfield" }) };
export function TravelSettingsBench() {
  return <div className="grid gap-8">
    {/* The complete panel: setup, How you travel with the leave reminder switch, and Completion places (Tickets 215–217, 279). */}
    <PlaceLabelBench><TravelSettingsPanel client={client} readLocation={denied} readPermission={async () => "denied"}
      leaveReminderClient={panelReminders} readDeviceNotifications={async () => "blocked"} homeLookupClient={benchHomeLookup} /></PlaceLabelBench>
    <TravelSettingsPanel client={enabledClient} readLocation={notAllowed} readPermission={async () => "prompt"} openLocationSettings={benchOnly} desktop homeLookupClient={benchHomeLookup} />
  </div>;
}

/** Ticket 217: learned habits on their own, with bench-only saves. */
export function TravelHabitsBench() {
  const [settings, setSettings] = useState<TravelSettings>(initial);
  return <TravelHabitsSection settings={settings} onSaved={setSettings} client={{ ...client,
    saveHabits: async (input) => ({ ...settings, habits: planTravelHabitChange(settings.habits, input, BENCH_NOW) }) }} />;
}

/** Ticket 279: the leave reminder switch and its readiness list in each state. Saves stay in this page. */
const readyReminders = benchReminderClient(true);
const blockedReminders = benchReminderClient(false);
const macReminders = benchReminderClient(true);
export function LeaveReminderSettingBench() {
  return <div className="grid gap-6">
    <section aria-label="Web, ready" className="grid gap-2"><h3 className="text-sm font-bold">Web, ready and on</h3>
      <LeaveReminderSetting client={readyReminders} readDeviceNotifications={async () => "enabled"} homeSaved travelEnabled /></section>
    <section aria-label="Web, needs setup" className="grid gap-2"><h3 className="text-sm font-bold">Web, Travel estimates off, notifications not enabled, no Home</h3>
      <LeaveReminderSetting client={blockedReminders} readDeviceNotifications={async () => "not_enabled"} homeSaved={false} travelEnabled={false} /></section>
    <section aria-label="Linked Mac" className="grid gap-2"><h3 className="text-sm font-bold">Linked Mac, notifications blocked</h3>
      <LeaveReminderSetting client={macReminders} readDeviceNotifications={async () => "blocked"} homeSaved travelEnabled desktop /></section>
  </div>;
}

/** Ticket 217: the journey mode choice with a synthetic place key. No provider call. */
export function TravelModeChoiceBench() {
  const [settings, setSettings] = useState<TravelSettings>(initial);
  const evidence = travelBenchEvidence("bench-event", true, undefined, homeKey);
  return <TravelModeChoice eventId="bench-event" travel={evidence} usualMode="walking" habits={{ settings,
    save: async (change) => {
      const next = { ...settings, habits: planTravelHabitChange(settings.habits, { expectedUpdatedAt: settings.habits?.updatedAt ?? null, change }, BENCH_NOW) };
      setSettings(next);
      return next;
    } }} />;
}

/** Ticket 217: the once-a-day leave-time question. Answers stay in this page. */
export function TravelLeaveQuestionBench() {
  const [dismissed, setDismissed] = useState(false);
  return dismissed ? <p role="status">Not now records nothing.</p>
    : <TravelLeaveQuestion title="Dentist" onAnswer={async (answer) => answer === "about_right"
      ? "Saved. Cadence keeps planning to arrive 5 minutes early." : "Saved. Cadence now plans to arrive 10 minutes early."}
      onDismiss={() => setDismissed(true)} />;
}

export type TravelBenchWeather = "thunderstorm" | "no_position";

/** Synthetic Ticket 218 forecast. No weather provider or location read runs in this bench. */
function travelBenchWeather(weather: TravelBenchWeather | undefined): TravelWeatherInput | null {
  if (!weather) return null;
  if (weather === "no_position") return { state: "no_position" };
  const start = Date.parse("2026-11-01T13:00:00Z");
  return { state: "forecast", forecast: { provider: "open-meteo", areaKey: "fixture", hourStart: "2026-11-01T13:00:00Z",
    fetchedAt: "2026-11-01T13:00:00Z", expiresAt: "2026-11-01T14:00:00Z",
    hours: Array.from({ length: 48 }, (_, index) => ({ time: new Date(start + index * 3_600_000).toISOString(),
      weatherCode: 95, rainMillimeters: 6, snowfallCentimeters: 0, precipitationProbabilityPercent: 90,
      apparentTemperatureCelsius: 18, windGustsKilometersPerHour: 45 })) } };
}

// Synthetic 2:30–4:30 attendance, 1:30 departure and 6:30 availability.
// No provider or location adapter runs in this bench.
export function travelBenchEvidence(eventId: string, withBase: boolean, weather?: TravelBenchWeather, placeKey?: string) {
  const point = { kind: "coordinates" as const, latitude: 0, longitude: 0 };
  const base = { ref: "base", point, source: "saved_base" as const, sourceRevision: "fixture" };
  const buffers = { arrivalSeconds: 600, exitSeconds: 600, settlingSeconds: 600 };
  const now = "2026-11-01T13:00:00Z";
  const plan = resolveTravelPlan({ journeyRef: "fixture", journeyRevision: "fixture", grantRevision: "fixture", now,
    defaultMode: "walking", base: withBase ? base : null,
    device: { ref: "device", point, source: "device", sourceRevision: "fixture", observedAt: now, accuracyMeters: 5, grantRevision: "fixture" },
    predictedOrigin: null, corrections: [], buffers,
    commitments: [{ ref: eventId, revision: "fixture", kind: "calendar", attendance: "physical", startAt: "2026-11-01T19:30:00Z", endAt: "2026-11-01T21:30:00Z",
      endpoint: { ref: eventId, point, source: "calendar", sourceRevision: "fixture" }, mode: null,
      ...(placeKey ? { placeKey } : {}) }] });
  return resolveTravelEvidence({ plan, buffers, now, expectedJourneyRevision: "fixture", expectedGrantRevision: "fixture", modelProjection: "disabled", collisionCandidates: [],
    weather: travelBenchWeather(weather),
    results: plan.legs.map((leg) => ({ legId: leg.id, provenance: leg.provenance, estimate: { durationSeconds: leg.role === "return" ? 6000 : 3000,
      departureAt: leg.role === "return" ? "2026-11-01T21:40:00Z" : "2026-11-01T18:30:00Z",
      arrivalAt: leg.role === "return" ? "2026-11-01T23:20:00Z" : "2026-11-01T19:20:00Z",
      observedAt: now, expiresAt: "2026-11-01T13:05:00Z", fallback: false, warnings: [], attribution: "Google Maps" } })) });
}

export const TRAVEL_BENCH_NOW = "2026-11-01T13:00:00Z";

/** The departure model for bench evidence: one stop at the synthetic 2:30–4:30 PM attendance. */
export function travelBenchDeparture(eventId: string, evidence: ReturnType<typeof travelBenchEvidence> | null, label = "Afternoon appointment", now = TRAVEL_BENCH_NOW) {
  return resolveDepartureModel({ evidence, now, timezone: "America/New_York", arrivalBufferSeconds: 600, preparationSeconds: 0, pausedUntil: null,
    stops: [{ ref: eventId, label, startAt: "2026-11-01T19:30:00Z", endAt: "2026-11-01T21:30:00Z" }] });
}

/** Bench-only caption. It never travels in a fixture's warnings. */
export function TravelBenchCaption() {
  return <p className="text-xs leading-5 text-muted-readable">Synthetic route. No provider call. The clock stays at 8:00 AM, when the route was checked, on purpose; estimates expire 5 minutes later. Every state on a moving clock: <a className="underline" href="/design-system?preview=departure-states">Travel timing states</a>.</p>;
}

/** Ticket 260: the same evidence in both build modes, side by side. */
export function TravelDevelopmentTextBench() {
  const evidence = travelBenchEvidence("bench-event", true, "thunderstorm");
  const travel = { ...evidence, legs: evidence.legs.map((entry) => entry.leg.role === "outbound" && entry.estimate ? { ...entry, late: true,
    estimate: { ...entry.estimate, warnings: ["Estimated arrival is after the planned arrival time.", "This route includes a toll road."] } } : entry) };
  const briefing = { text: "Dentist anchors the afternoon.", localDate: "2026-11-01", timezone: "America/New_York",
    generatedAt: "2026-11-01T12:00:00Z", expiresAt: "2026-11-02T05:00:00Z", coverage: "complete" as const, warnings: [] };
  // Ticket 272: the brief block's real projection from the same evidence and departure model.
  const guidance = projectBriefTravelGuidance({ evidence: travel, departure: travelBenchDeparture("bench-event", travel, "Dentist"),
    localDate: "2026-11-01", now: TRAVEL_BENCH_NOW, timezone: "America/New_York", labels: new Map([["bench-event", "Dentist"]]), behaviorRefs: new Set() });
  return <div className="mt-4 grid gap-4 border-t border-line pt-4">
    <TravelBenchCaption />
    <div className="grid gap-6 lg:grid-cols-2">
      {[{ name: "Production build", value: false }, { name: "Development build", value: true }].map((build) => <section key={build.name} className="grid min-w-0 content-start gap-3" data-travel-bench-build={build.value ? "development" : "production"}>
        <h4 className="text-sm font-bold">{build.name}</h4>
        <DevelopmentBuildProvider value={build.value}>
          {renderTravelTiming({ eventId: "bench-event", travel, departure: travelBenchDeparture("bench-event", travel, "Dentist"), now: TRAVEL_BENCH_NOW, timezone: "America/New_York" })}
          <div className="pt-8"><DailyBriefBubble state="ready" briefing={briefing} travel={guidance} onDismiss={() => undefined} /></div>
        </DevelopmentBuildProvider>
      </section>)}
    </div>
  </div>;
}
