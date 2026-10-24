import { describe, expect, it } from "vitest";

import { resolveTravelEvidence, resolveTravelPlan } from "../packages/core/src/resolvers/travel.resolver";
import { projectWeatherOutlook } from "../packages/core/src/services/weather-outlook";
import type { TravelEndpoint, TravelEvidenceInput, TravelRouteEstimate } from "../packages/core/src/types/travel";
import type { WeatherForecastSnapshot } from "../packages/core/src/types/weather";

const NOW = "2026-10-22T14:10:00Z";

describe("projectWeatherOutlook", () => {
  it("names commitments, conditions, fixed margins and suggestions only", () => {
    const outlook = projectWeatherOutlook(evidence({ state: "forecast", forecast: forecast(2) }, 1800));
    expect(outlook).toEqual({
      version: "weather-outlook@1",
      tableVersion: "weather-margin@1",
      state: "applied",
      attribution: "Weather data by Open-Meteo.com (CC BY 4.0)",
      commitments: [
        { commitmentRef: "event-1", role: "outbound", mode: "cycling", state: "margin", conditions: ["rain"], marginMinutes: 10,
          suggestion: { instead: "cycling", alternatives: ["transit"] } },
        { commitmentRef: "event-1", role: "return", mode: "cycling", state: "margin", conditions: ["rain"], marginMinutes: 10,
          suggestion: { instead: "cycling", alternatives: ["transit"] } },
      ],
    });
  });

  it("carries no times, durations, area or coordinates, and does not change with route duration", () => {
    const weather = { state: "forecast" as const, forecast: forecast(2) };
    const short = projectWeatherOutlook(evidence(weather, 600));
    const long = projectWeatherOutlook(evidence(weather, 5400));
    expect(short).toEqual(long);
    const text = JSON.stringify(short);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(text).not.toMatch(/departure|arrival|duration|seconds|latitude|longitude|areaKey|41\.9/i);
  });

  it("keeps unknown weather unknown and reports a missing position plainly", () => {
    const beyond = projectWeatherOutlook(evidence({ state: "forecast", forecast: { ...forecast(2), hours: [] } }, 1800));
    expect(beyond?.commitments.map((item) => [item.state, item.marginMinutes])).toEqual([["unknown", 0], ["unknown", 0]]);
    expect(projectWeatherOutlook(evidence({ state: "no_position" }, 1800))).toEqual({
      version: "weather-outlook@1", tableVersion: "weather-margin@1", state: "no_position", attribution: null, commitments: [],
    });
    expect(projectWeatherOutlook(evidence(null, 1800))).toBeNull();
    expect(projectWeatherOutlook(null)).toBeNull();
  });
});

function forecast(rainMillimeters: number): WeatherForecastSnapshot {
  return {
    provider: "open-meteo", areaKey: "41.9,-87.6", hourStart: "2026-10-22T14:00:00Z",
    fetchedAt: "2026-10-22T14:05:00Z", expiresAt: "2026-10-22T15:00:00Z",
    hours: Array.from({ length: 48 }, (_, index) => ({
      time: new Date(Date.parse("2026-10-22T14:00:00Z") + index * 3_600_000).toISOString(),
      weatherCode: 61, rainMillimeters, snowfallCentimeters: 0, precipitationProbabilityPercent: 70,
      apparentTemperatureCelsius: 12, windGustsKilometersPerHour: 20,
    })),
  };
}

function evidence(weather: TravelEvidenceInput["weather"], outboundSeconds: number) {
  const endpoint = (ref: string, source: TravelEndpoint["source"], coordinate: number, extra: Partial<TravelEndpoint> = {}): TravelEndpoint =>
    ({ ref, source, sourceRevision: `${ref}-r1`, point: { kind: "coordinates", latitude: coordinate, longitude: coordinate }, ...extra });
  const plan = resolveTravelPlan({
    journeyRef: "journey-1", journeyRevision: "journey-r1", now: NOW, grantRevision: "grant-1", defaultMode: "cycling",
    base: endpoint("base", "saved_base", 9),
    device: endpoint("device", "device", 1, { observedAt: NOW, accuracyMeters: 10, grantRevision: "grant-1" }),
    predictedOrigin: null, corrections: [],
    commitments: [{ ref: "event-1", revision: "event-1-r1", kind: "calendar", startAt: "2026-10-22T18:00:00Z",
      endAt: "2026-10-22T19:00:00Z", attendance: "physical", endpoint: endpoint("event-1-place", "calendar", 2), mode: null }],
    buffers: { arrivalSeconds: 0, exitSeconds: 0, settlingSeconds: 0 },
  });
  const estimate = (departureAt: string, seconds: number): TravelRouteEstimate => ({
    departureAt, arrivalAt: new Date(Date.parse(departureAt) + seconds * 1000).toISOString(), durationSeconds: seconds,
    warnings: [], fallback: false, attribution: "Synthetic provider", observedAt: "2026-10-22T14:05:00Z", expiresAt: "2026-10-22T18:00:00Z",
  });
  return resolveTravelEvidence({
    plan,
    results: plan.legs.map((leg) => ({ legId: leg.id, provenance: leg.provenance, estimate: leg.role === "return"
      ? estimate("2026-10-22T19:00:00Z", outboundSeconds)
      : estimate(new Date(Date.parse("2026-10-22T18:00:00Z") - outboundSeconds * 1000).toISOString(), outboundSeconds) })),
    collisionCandidates: [], buffers: { arrivalSeconds: 0, exitSeconds: 0, settlingSeconds: 0 }, weather, now: NOW,
    expectedJourneyRevision: plan.journeyRevision, expectedGrantRevision: plan.grantRevision, modelProjection: "disabled",
  });
}
