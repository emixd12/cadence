"use client";

import { useState } from "react";
import { resolveTravelPlan, resolveTravelEvidence } from "@cadence/core/resolvers/travel.resolver";
import { planTravelHabitChange } from "@cadence/core/services/travel-habits";
import { travelPlaceKey } from "@cadence/core/services/travel-place-key";
import { TravelHabitsSection } from "@/components/settings/TravelHabitsSection";
import { TravelSettingsPanel } from "@/components/settings/TravelSettingsPanel";
import { TravelLeaveQuestion } from "@/components/timeline/TravelLeaveQuestion";
import { TravelModeChoice } from "@/components/timeline/TravelModeChoice";
import type { TravelSettings } from "@cadence/core/types/travel";
import type { TravelSettingsClient } from "@/lib/ui/travel-settings";

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
export function TravelSettingsBench() {
  return <TravelSettingsPanel client={client} readLocation={denied} />;
}

/** Ticket 217: learned habits on their own, with bench-only saves. */
export function TravelHabitsBench() {
  const [settings, setSettings] = useState<TravelSettings>(initial);
  return <TravelHabitsSection settings={settings} onSaved={setSettings} client={{ ...client,
    saveHabits: async (input) => ({ ...settings, habits: planTravelHabitChange(settings.habits, input, BENCH_NOW) }) }} />;
}

/** Ticket 217: the journey mode choice with a synthetic place key. No provider call. */
export function TravelModeChoiceBench() {
  const [settings, setSettings] = useState<TravelSettings>(initial);
  const evidence = travelBenchEvidence("bench-event", true, homeKey);
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

// Synthetic 2:30–4:30 attendance, 1:30 departure and 6:30 availability.
// No provider or location adapter runs in this bench.
export function travelBenchEvidence(eventId: string, withBase: boolean, placeKey?: string) {
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
    results: plan.legs.map((leg) => ({ legId: leg.id, provenance: leg.provenance, estimate: { durationSeconds: leg.role === "return" ? 6000 : 3000,
      departureAt: leg.role === "return" ? "2026-11-01T21:40:00Z" : "2026-11-01T18:30:00Z",
      arrivalAt: leg.role === "return" ? "2026-11-01T23:20:00Z" : "2026-11-01T19:20:00Z",
      observedAt: now, expiresAt: "2026-11-01T13:05:00Z", fallback: false, warnings: ["Synthetic route. No provider call."], attribution: "Google Maps" } })) });
}
