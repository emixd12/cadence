"use client";

import { resolveTravelPlan, resolveTravelEvidence } from "@cadence/core/resolvers/travel.resolver";
import { TravelSettingsPanel } from "@/components/settings/TravelSettingsPanel";
import type { TravelSettings } from "@cadence/core/types/travel";
import type { TravelSettingsClient } from "@/lib/ui/travel-settings";

const initial: TravelSettings = { enabled: false, baseLocationText: null, mode: null,
  navigationPreference: "google_maps", routingConsentAt: null, onboardingCompletedAt: null,
  updatedAt: "2026-09-21T12:00:00Z" };
const client: TravelSettingsClient = {
  load: async () => initial,
  save: async (value) => ({ ...initial, ...value, routingConsentAt: value.enabled ? initial.updatedAt : null }),
};
const denied = async () => ({ state: "denied" as const });
// Ticket 165 guidance: travel on, device location not yet allowed, desktop Settings button.
const enabled: TravelSettings = { ...initial, enabled: true, mode: "walking", routingConsentAt: initial.updatedAt };
const enabledClient: TravelSettingsClient = { load: async () => enabled, save: async () => enabled };
const notAllowed = async (requestPermission: boolean) => requestPermission
  ? { state: "unavailable" as const, reason: "timeout" } : { state: "prompt" as const };
const benchOnly = async () => {};
export function TravelSettingsBench() {
  return <div className="grid gap-8">
    <TravelSettingsPanel client={client} readLocation={denied} readPermission={async () => "denied"} />
    <TravelSettingsPanel client={enabledClient} readLocation={notAllowed} readPermission={async () => "prompt"} openLocationSettings={benchOnly} desktop />
  </div>;
}

// Synthetic 2:30–4:30 attendance, 1:30 departure and 6:30 availability.
// No provider or location adapter runs in this bench.
export function travelBenchEvidence(eventId: string, withBase: boolean) {
  const point = { kind: "coordinates" as const, latitude: 0, longitude: 0 };
  const base = { ref: "base", point, source: "saved_base" as const, sourceRevision: "fixture" };
  const buffers = { arrivalSeconds: 600, exitSeconds: 600, settlingSeconds: 600 };
  const now = "2026-11-01T13:00:00Z";
  const plan = resolveTravelPlan({ journeyRef: "fixture", journeyRevision: "fixture", grantRevision: "fixture", now,
    defaultMode: "walking", base: withBase ? base : null,
    device: { ref: "device", point, source: "device", sourceRevision: "fixture", observedAt: now, accuracyMeters: 5, grantRevision: "fixture" },
    predictedOrigin: null, corrections: [], buffers,
    commitments: [{ ref: eventId, revision: "fixture", kind: "calendar", attendance: "physical", startAt: "2026-11-01T19:30:00Z", endAt: "2026-11-01T21:30:00Z",
      endpoint: { ref: eventId, point, source: "calendar", sourceRevision: "fixture" }, mode: null }] });
  return resolveTravelEvidence({ plan, buffers, now, expectedJourneyRevision: "fixture", expectedGrantRevision: "fixture", modelProjection: "disabled", collisionCandidates: [],
    results: plan.legs.map((leg) => ({ legId: leg.id, provenance: leg.provenance, estimate: { durationSeconds: leg.role === "return" ? 6000 : 3000,
      departureAt: leg.role === "return" ? "2026-11-01T21:40:00Z" : "2026-11-01T18:30:00Z",
      arrivalAt: leg.role === "return" ? "2026-11-01T23:20:00Z" : "2026-11-01T19:20:00Z",
      observedAt: now, expiresAt: "2026-11-01T13:05:00Z", fallback: false, warnings: ["Synthetic route. No provider call."], attribution: "Google Maps" } })) });
}
