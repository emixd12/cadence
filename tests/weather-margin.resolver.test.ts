import { describe, expect, it } from "vitest";

import { resolveTravelEvidence, resolveTravelPlan } from "../packages/core/src/resolvers/travel.resolver";
import {
  OPEN_METEO_ATTRIBUTION,
  WEATHER_MARGIN_TABLE,
  resolveWeatherArea,
  resolveWeatherConditions,
  resolveWeatherMargin,
  weatherCacheHour,
  weatherDeparturePeriod,
} from "../packages/core/src/resolvers/weather-margin.resolver";
import type {
  TravelEndpoint,
  TravelEvidenceInput,
  TravelMode,
  TravelPlanningInput,
  TravelRouteEstimate,
} from "../packages/core/src/types/travel";
import { travelHabitBuffers } from "../packages/core/src/services/travel-habits";
import type { WeatherForecastHour, WeatherForecastSnapshot } from "../packages/core/src/types/weather";
import { WEATHER_MARGIN_TABLE_VERSION } from "../packages/core/src/types/weather";

const NOW = "2026-10-22T14:10:00Z";

function hour(time: string, values: Partial<Omit<WeatherForecastHour, "time">> = {}): WeatherForecastHour {
  return {
    time,
    weatherCode: 1,
    rainMillimeters: 0,
    snowfallCentimeters: 0,
    precipitationProbabilityPercent: 0,
    apparentTemperatureCelsius: 15,
    windGustsKilometersPerHour: 10,
    ...values,
  };
}

const conditions = (values: Partial<Omit<WeatherForecastHour, "time">>) =>
  resolveWeatherConditions(hour("2026-10-22T15:00:00Z", values));

const PERIOD = { startAt: "2026-10-22T14:00:00Z", endAt: "2026-10-22T15:00:00Z" };
const margin = (values: Partial<Omit<WeatherForecastHour, "time">>, mode: TravelMode = "cycling") =>
  resolveWeatherMargin({ hours: [hour("2026-10-22T15:00:00Z", values)], period: PERIOD, mode });

describe("weather-margin@1 table", () => {
  it("records the owner's starting values in severity order", () => {
    expect(WEATHER_MARGIN_TABLE.map((rule) => [rule.id, rule.marginMinutes])).toEqual([
      ["thunderstorm", 15], ["snow", 15], ["freezing_precipitation", 15], ["heavy_rain", 15],
      ["rain", 10], ["extreme_heat", 5], ["strong_wind", 5],
    ]);
    expect(WEATHER_MARGIN_TABLE_VERSION).toBe("weather-margin@1");
  });

  it("matches thunderstorms on WMO 95–99 only", () => {
    for (const code of [95, 96, 97, 98, 99]) expect(conditions({ weatherCode: code })).toContain("thunderstorm");
    for (const code of [94, 82, 3]) expect(conditions({ weatherCode: code })).not.toContain("thunderstorm");
  });

  it("matches snow above zero snowfall or on WMO 71–77 and 85–86", () => {
    expect(conditions({ snowfallCentimeters: 0 })).not.toContain("snow");
    expect(conditions({ snowfallCentimeters: 0.01 })).toContain("snow");
    for (const code of [71, 73, 75, 77, 85, 86]) expect(conditions({ weatherCode: code })).toContain("snow");
    for (const code of [70, 78, 84, 87]) expect(conditions({ weatherCode: code })).not.toContain("snow");
  });

  it("matches freezing rain or drizzle on WMO 56–57 and 66–67", () => {
    for (const code of [56, 57, 66, 67]) expect(conditions({ weatherCode: code })).toEqual(["freezing_precipitation"]);
    for (const code of [55, 58, 65, 68]) expect(conditions({ weatherCode: code })).not.toContain("freezing_precipitation");
  });

  it("matches heavy rain at 4 mm/h or on WMO 65 and 82", () => {
    expect(conditions({ rainMillimeters: 3.99 })).not.toContain("heavy_rain");
    expect(conditions({ rainMillimeters: 4 })).toEqual(["heavy_rain", "rain"]);
    expect(conditions({ weatherCode: 65 })).toEqual(["heavy_rain"]);
    expect(conditions({ weatherCode: 82 })).toEqual(["heavy_rain"]);
    for (const code of [63, 64, 81]) expect(conditions({ weatherCode: code })).not.toContain("heavy_rain");
  });

  it("matches rain at 0.5 mm/h or a 60% probability", () => {
    expect(conditions({ rainMillimeters: 0.49 })).toEqual([]);
    expect(conditions({ rainMillimeters: 0.5 })).toEqual(["rain"]);
    expect(conditions({ precipitationProbabilityPercent: 59 })).toEqual([]);
    expect(conditions({ precipitationProbabilityPercent: 60 })).toEqual(["rain"]);
  });

  it("matches extreme heat at an apparent 35 °C", () => {
    expect(conditions({ apparentTemperatureCelsius: 34.9 })).toEqual([]);
    expect(conditions({ apparentTemperatureCelsius: 35 })).toEqual(["extreme_heat"]);
  });

  it("matches strong wind at 60 km/h gusts", () => {
    expect(conditions({ windGustsKilometersPerHour: 59.9 })).toEqual([]);
    expect(conditions({ windGustsKilometersPerHour: 60 })).toEqual(["strong_wind"]);
  });

  it("never treats a missing value as a match", () => {
    expect(resolveWeatherConditions({ time: "2026-10-22T15:00:00Z", weatherCode: null, rainMillimeters: null,
      snowfallCentimeters: null, precipitationProbabilityPercent: null, apparentTemperatureCelsius: null,
      windGustsKilometersPerHour: null })).toEqual([]);
  });
});

describe("resolveWeatherMargin", () => {
  it("uses the single largest matching margin; margins never stack", () => {
    expect(margin({ rainMillimeters: 1, apparentTemperatureCelsius: 36, windGustsKilometersPerHour: 70 })).toMatchObject({
      state: "margin", conditions: ["rain", "extreme_heat", "strong_wind"], marginSeconds: 600,
    });
    expect(margin({ weatherCode: 95, rainMillimeters: 5 }).marginSeconds).toBe(900);
    expect(margin({ apparentTemperatureCelsius: 36, windGustsKilometersPerHour: 70 }).marginSeconds).toBe(300);
  });

  it("returns each row's margin and records the table version", () => {
    const cases: [Partial<Omit<WeatherForecastHour, "time">>, number][] = [
      [{ weatherCode: 95 }, 900], [{ weatherCode: 71 }, 900], [{ weatherCode: 66 }, 900], [{ weatherCode: 65 }, 900],
      [{ rainMillimeters: 0.5 }, 600], [{ apparentTemperatureCelsius: 35 }, 300], [{ windGustsKilometersPerHour: 60 }, 300],
    ];
    for (const [values, seconds] of cases) {
      expect(margin(values)).toMatchObject({ marginSeconds: seconds, tableVersion: "weather-margin@1" });
    }
    expect(margin({})).toEqual({ tableVersion: "weather-margin@1", state: "clear", conditions: [], marginSeconds: 0, suggestion: null });
  });

  it("suggests another mode only for the modes each row names", () => {
    expect(margin({ weatherCode: 95 }, "walking").suggestion).toEqual({ instead: "walking", alternatives: ["transit", "driving"] });
    expect(margin({ weatherCode: 95 }, "cycling").suggestion).toEqual({ instead: "cycling", alternatives: ["transit", "driving"] });
    expect(margin({ weatherCode: 71 }, "cycling").suggestion).toEqual({ instead: "cycling", alternatives: ["transit", "driving"] });
    expect(margin({ weatherCode: 71 }, "walking").suggestion).toBeNull();
    expect(margin({ weatherCode: 57 }, "cycling").suggestion).toEqual({ instead: "cycling", alternatives: ["transit", "driving"] });
    expect(margin({ weatherCode: 65 }, "walking").suggestion).toEqual({ instead: "walking", alternatives: ["transit"] });
    expect(margin({ rainMillimeters: 1 }, "cycling").suggestion).toEqual({ instead: "cycling", alternatives: ["transit"] });
    expect(margin({ rainMillimeters: 1 }, "walking").suggestion).toBeNull();
    expect(margin({ apparentTemperatureCelsius: 40 }, "cycling").suggestion).toEqual({ instead: "cycling", alternatives: ["transit"] });
    expect(margin({ windGustsKilometersPerHour: 80 }, "cycling").suggestion).toEqual({ instead: "cycling", alternatives: ["transit"] });
    for (const mode of ["transit", "driving"] as const) {
      expect(margin({ weatherCode: 99, snowfallCentimeters: 2 }, mode)).toMatchObject({ marginSeconds: 900, suggestion: null });
    }
  });

  it("takes the suggestion from the first matching row that covers the mode", () => {
    // Snow comes first but names only cycling; heavy rain also covers walking.
    expect(margin({ snowfallCentimeters: 1, rainMillimeters: 5 }, "walking")).toMatchObject({
      conditions: ["snow", "heavy_rain", "rain"], marginSeconds: 900,
      suggestion: { instead: "walking", alternatives: ["transit"] },
    });
  });

  it("counts forecast hours that overlap the departure period and ignores the rest", () => {
    const period = { startAt: "2026-10-22T16:00:00Z", endAt: "2026-10-22T18:00:00Z" };
    const resolve = (time: string) => resolveWeatherMargin({ hours: [hour(time, { rainMillimeters: 2 })], period, mode: "cycling" });
    expect(resolve("2026-10-22T16:00:00Z").state).toBe("unknown");
    expect(resolve("2026-10-22T17:00:00Z").state).toBe("margin");
    expect(resolve("2026-10-22T18:00:00Z").state).toBe("margin");
    expect(resolve("2026-10-22T19:00:00Z").state).toBe("unknown");
  });

  it("says unknown when no overlapping hour reports any value", () => {
    const empty = hour("2026-10-22T15:00:00Z", { weatherCode: null, rainMillimeters: null, snowfallCentimeters: null,
      precipitationProbabilityPercent: null, apparentTemperatureCelsius: null, windGustsKilometersPerHour: null });
    expect(resolveWeatherMargin({ hours: [empty], period: PERIOD, mode: "cycling" }).state).toBe("unknown");
    expect(resolveWeatherMargin({ hours: [], period: PERIOD, mode: "cycling" }).state).toBe("unknown");
  });

  it("rejects an empty period", () => {
    expect(() => resolveWeatherMargin({ hours: [], period: { startAt: PERIOD.startAt, endAt: PERIOD.startAt }, mode: "walking" }))
      .toThrow("Weather period end must follow its start.");
  });

  it("requires complete coverage and measurements before reporting clear", () => {
    const period = { startAt: "2026-10-22T14:30:00Z", endAt: "2026-10-22T16:30:00Z" };
    const hours = [15, 16, 17].map((value) => hour(`2026-10-22T${value}:00:00Z`));
    const resolve = (values: WeatherForecastHour[]) => resolveWeatherMargin({ hours: values, period, mode: "cycling" });
    expect(resolve(hours).state).toBe("clear");
    expect(resolve([hours[2], hours[0], hours[1]]).state).toBe("clear");
    expect(resolve(hours.slice(0, 2)).state).toBe("unknown");
    expect(resolve([hours[0], hours[2]]).state).toBe("unknown");
    expect(resolve([hours[1], hours[2]]).state).toBe("unknown");
    for (const field of ["weatherCode", "rainMillimeters", "snowfallCentimeters", "precipitationProbabilityPercent",
      "apparentTemperatureCelsius", "windGustsKilometersPerHour"] as const) {
      expect(resolve([hours[0], { ...hours[1], [field]: null }, hours[2]]).state).toBe("unknown");
    }
    expect(resolve([{ ...hours[0], rainMillimeters: 5 }])).toMatchObject({ state: "margin", marginSeconds: 900 });
  });
});

describe("weather area and cache hour", () => {
  const sample = (latitude: number, longitude: number, extra: Partial<{ accuracyMeters: number; sampledAt: string }> = {}) =>
    ({ latitude, longitude, accuracyMeters: 30, sampledAt: NOW, ...extra });

  it("rounds a device position to the 0.1° grid", () => {
    // Synthetic coordinates near a public landmark (Chicago's Willis Tower).
    expect(resolveWeatherArea(sample(41.8789, -87.6359), NOW)).toEqual({ key: "41.9,-87.6", latitude: 41.9, longitude: -87.6, gridDegrees: 0.1 });
    expect(resolveWeatherArea(sample(-0.04, -0.04), NOW)?.key).toBe("0.0,0.0");
    expect(resolveWeatherArea(sample(51.5007, -0.1246), NOW)?.key).toBe("51.5,-0.1");
    expect(resolveWeatherArea(sample(89.99, 179.99), NOW)?.key).toBe("90.0,180.0");
  });

  it("gives no area without a usable device position", () => {
    expect(resolveWeatherArea(null, NOW)).toBeNull();
    expect(resolveWeatherArea(sample(41.88, -87.63, { accuracyMeters: 5_001 }), NOW)).toBeNull();
    expect(resolveWeatherArea(sample(41.88, -87.63, { accuracyMeters: 5_000 }), NOW)).not.toBeNull();
    expect(resolveWeatherArea(sample(41.88, -87.63, { sampledAt: "2026-10-22T13:55:00Z" }), NOW)).not.toBeNull();
    expect(resolveWeatherArea(sample(41.88, -87.63, { sampledAt: "2026-10-22T13:54:59Z" }), NOW)).toBeNull();
    expect(resolveWeatherArea(sample(41.88, -87.63, { sampledAt: "2026-10-22T14:15:01Z" }), NOW)).toBeNull();
    expect(resolveWeatherArea(sample(91, 0), NOW)).toBeNull();
    expect(resolveWeatherArea(sample(0, 0, { sampledAt: "not an instant" }), NOW)).toBeNull();
  });

  it("keys the shared cache by the UTC clock hour", () => {
    expect(weatherCacheHour("2026-10-22T14:59:59.999Z")).toEqual({ hourStart: "2026-10-22T14:00:00Z", expiresAt: "2026-10-22T15:00:00Z" });
    expect(weatherCacheHour("2026-10-22T15:00:00Z").hourStart).toBe("2026-10-22T15:00:00Z");
  });
});

describe("travel evidence with the weather margin", () => {
  const forecastHours = (values: Partial<Omit<WeatherForecastHour, "time">>) => Array.from({ length: 48 }, (_, index) =>
    hour(new Date(Date.parse("2026-10-22T14:00:00Z") + index * 3_600_000).toISOString().replace(".000Z", "Z"), values));
  const forecast = (values: Partial<Omit<WeatherForecastHour, "time">>): WeatherForecastSnapshot => ({
    provider: "open-meteo", areaKey: "41.9,-87.6", hourStart: "2026-10-22T14:00:00Z",
    fetchedAt: "2026-10-22T14:05:00Z", expiresAt: "2026-10-22T15:00:00Z", hours: forecastHours(values),
  });

  it("moves an arrive-by departure earlier by the margin and leaves the estimate untouched", () => {
    const plan = resolveTravelPlan(planningInput("cycling"));
    const evidence = resolveTravelEvidence(evidenceInput(plan, { state: "forecast", forecast: forecast({ rainMillimeters: 1 }) }));
    const outbound = evidence.legs.find((entry) => entry.leg.role === "outbound")!;
    expect(outbound.estimate).toMatchObject({ departureAt: "2026-10-22T17:20:00Z", arrivalAt: "2026-10-22T17:50:00Z", durationSeconds: 1800 });
    expect(outbound.weather).toEqual({
      tableVersion: "weather-margin@1", state: "margin", conditions: ["rain"], marginSeconds: 600,
      suggestion: { instead: "cycling", alternatives: ["transit"] },
      departureAt: "2026-10-22T17:10:00Z", arrivalAt: "2026-10-22T17:50:00Z",
    });
    expect(evidence.segments.find((segment) => segment.id === `weather:${outbound.leg.id}`)).toEqual({
      id: `weather:${outbound.leg.id}`, kind: "weather_margin", startAt: "2026-10-22T17:10:00Z", endAt: "2026-10-22T17:20:00Z",
      sourceRefs: ["event-1"], legId: outbound.leg.id,
    });
    expect(evidence.weather).toEqual({ tableVersion: "weather-margin@1", state: "applied", forecastAt: "2026-10-22T14:05:00Z", attribution: OPEN_METEO_ATTRIBUTION });
  });

  it("adds the margin after a fixed return departure and to final availability", () => {
    const plan = resolveTravelPlan(planningInput("driving"));
    const clear = resolveTravelEvidence(evidenceInput(plan, { state: "forecast", forecast: forecast({}) }));
    const stormy = resolveTravelEvidence(evidenceInput(plan, { state: "forecast", forecast: forecast({ weatherCode: 95 }) }));
    const back = stormy.legs.find((entry) => entry.leg.role === "return")!;
    expect(back.weather).toMatchObject({ marginSeconds: 900, suggestion: null,
      departureAt: "2026-10-22T20:30:00Z", arrivalAt: "2026-10-22T21:15:00Z" });
    expect(clear.finalAvailabilityAt).toBe("2026-10-22T21:00:00Z");
    expect(stormy.finalAvailabilityAt).toBe("2026-10-22T21:15:00Z");
    expect(stormy.segments.find((segment) => segment.id === `weather:${back.leg.id}`)).toMatchObject({
      kind: "weather_margin", startAt: "2026-10-22T21:00:00Z", endAt: "2026-10-22T21:15:00Z",
    });
    expect(clear.segments.some((segment) => segment.kind === "weather_margin")).toBe(false);
  });

  it("never depends on route duration", () => {
    const plan = resolveTravelPlan(planningInput("cycling"));
    const weather = { state: "forecast" as const, forecast: forecast({ rainMillimeters: 1 }) };
    const short = resolveTravelEvidence(evidenceInput(plan, weather, 600));
    const long = resolveTravelEvidence(evidenceInput(plan, weather, 5400));
    const facts = (value: typeof short) => value.legs.map((entry) => [entry.weather?.state, entry.weather?.conditions, entry.weather?.marginSeconds, entry.weather?.suggestion]);
    expect(facts(short)).toEqual(facts(long));
    expect(weatherDeparturePeriod(plan.legs[0]!)).toEqual({ startAt: "2026-10-22T16:00:00Z", endAt: "2026-10-22T18:00:00Z" });
  });

  it("computes the margin for legs without a current estimate but adjusts no timing", () => {
    const plan = resolveTravelPlan(planningInput("cycling"));
    const evidence = resolveTravelEvidence({ ...evidenceInput(plan, { state: "forecast", forecast: forecast({ rainMillimeters: 1 }) }),
      results: plan.legs.map((leg) => ({ legId: leg.id, provenance: leg.provenance, estimate: null, unavailableReason: "outside_window" })) });
    expect(evidence.legs.map((entry) => [entry.state, entry.weather?.marginSeconds, entry.weather?.departureAt])).toEqual([
      ["unavailable", 600, null], ["unavailable", 600, null],
    ]);
    expect(evidence.segments.some((segment) => segment.kind === "weather_margin")).toBe(false);
  });

  it("says plainly when there is no position or no forecast, and adds nothing", () => {
    const plan = resolveTravelPlan(planningInput("cycling"));
    for (const state of ["no_position", "unavailable"] as const) {
      const evidence = resolveTravelEvidence(evidenceInput(plan, { state }));
      expect(evidence.weather).toEqual({ tableVersion: "weather-margin@1", state, forecastAt: null, attribution: null });
      expect(evidence.legs.every((entry) => entry.weather === undefined)).toBe(true);
    }
    const expired = resolveTravelEvidence({ ...evidenceInput(plan, { state: "forecast", forecast: forecast({ weatherCode: 95 }) }), now: "2026-10-22T15:00:00Z" });
    expect(expired.weather?.state).toBe("unavailable");
    const off = resolveTravelEvidence(evidenceInput(plan, null));
    expect("weather" in off).toBe(false);
    expect(off.legs.every((entry) => !("weather" in entry))).toBe(true);
  });

  it("ends get-ready time at the weather-adjusted departure (Tickets 217 and 218)", () => {
    const plan = resolveTravelPlan(planningInput("cycling"));
    const buffers = { arrivalSeconds: 0, exitSeconds: 0, settlingSeconds: 0, preparationSeconds: 900 };
    const evidence = resolveTravelEvidence({ ...evidenceInput(plan, { state: "forecast", forecast: forecast({ rainMillimeters: 1 }) }), buffers });
    const outbound = evidence.legs.find((entry) => entry.leg.role === "outbound")!;
    const span = (kind: string) => evidence.segments.filter((segment) => segment.kind === kind && segment.legId === outbound.leg.id)
      .map((segment) => [segment.startAt, segment.endAt]);
    expect(span("weather_margin")).toEqual([["2026-10-22T17:10:00Z", "2026-10-22T17:20:00Z"]]);
    expect(span("preparation_buffer")).toEqual([["2026-10-22T16:55:00Z", "2026-10-22T17:10:00Z"]]);
    expect(span("route")).toEqual([["2026-10-22T17:20:00Z", "2026-10-22T17:50:00Z"]]);
  });

  it("composes learned habit buffers with the weather margin without moving the estimate (Tickets 217 and 218)", () => {
    const buffers = travelHabitBuffers(null);
    expect(buffers).toEqual({ arrivalSeconds: 300, exitSeconds: 0, settlingSeconds: 0, preparationSeconds: 600 });
    const plan = resolveTravelPlan({ ...planningInput("cycling"), buffers });
    const withoutGetReady = resolveTravelPlan({ ...planningInput("cycling"), buffers: { ...buffers, preparationSeconds: 0 } });
    // Get-ready time never changes a leg or its route request.
    expect(plan.legs).toEqual(withoutGetReady.legs);
    const evidence = resolveTravelEvidence({ ...evidenceInput(plan, { state: "forecast", forecast: forecast({ weatherCode: 95 }) }), buffers });
    const outbound = evidence.legs.find((entry) => entry.leg.role === "outbound")!;
    expect(outbound.estimate).toMatchObject({ departureAt: "2026-10-22T17:20:00Z", arrivalAt: "2026-10-22T17:50:00Z" });
    expect(outbound.weather).toMatchObject({ marginSeconds: 900, departureAt: "2026-10-22T17:05:00Z" });
    const spans = evidence.segments.filter((segment) => segment.legId === outbound.leg.id && segment.kind !== "commitment")
      .map((segment) => [segment.kind, segment.startAt, segment.endAt])
      .sort((left, right) => String(left[1]).localeCompare(String(right[1])));
    expect(spans).toEqual([
      ["preparation_buffer", "2026-10-22T16:55:00Z", "2026-10-22T17:05:00Z"],
      ["weather_margin", "2026-10-22T17:05:00Z", "2026-10-22T17:20:00Z"],
      ["route", "2026-10-22T17:20:00Z", "2026-10-22T17:50:00Z"],
      ["arrival_buffer", "2026-10-22T17:55:00Z", "2026-10-22T18:00:00Z"],
    ]);
    const back = evidence.legs.find((entry) => entry.leg.role === "return")!;
    expect(evidence.segments.some((segment) => segment.kind === "preparation_buffer" && segment.legId === back.leg.id)).toBe(false);
  });

  it("moves the get-ready overlap earlier when weather adds a margin (Tickets 217 and 218)", () => {
    const plan = resolveTravelPlan(planningInput("cycling"));
    const buffers = { arrivalSeconds: 0, exitSeconds: 0, settlingSeconds: 0, preparationSeconds: 900 };
    const behavior = { ref: "behavior-1", kind: "behavior" as const, startAt: "2026-10-22T16:50:00Z", endAt: "2026-10-22T17:00:00Z" };
    const clear = resolveTravelEvidence({ ...evidenceInput(plan, { state: "forecast", forecast: forecast({}) }), buffers, collisionCandidates: [behavior] });
    const rainy = resolveTravelEvidence({ ...evidenceInput(plan, { state: "forecast", forecast: forecast({ rainMillimeters: 1 }) }), buffers, collisionCandidates: [behavior] });
    const outbound = rainy.legs.find((entry) => entry.leg.role === "outbound")!;
    expect(clear.collisions).toEqual([]);
    expect(rainy.collisions).toEqual([{ candidateRef: "behavior-1", segmentIds: [`preparation:${outbound.leg.id}`], travelCreated: true }]);
  });

  it("withholds weather from legs whose journey revision changed", () => {
    const plan = resolveTravelPlan(planningInput("cycling"));
    const evidence = resolveTravelEvidence({ ...evidenceInput(plan, { state: "forecast", forecast: forecast({ rainMillimeters: 1 }) }), expectedJourneyRevision: "other" });
    expect(evidence.weather?.state).toBe("unavailable");
    expect(evidence.legs.every((entry) => entry.state === "rejected_revision" && entry.weather === undefined)).toBe(true);
  });
});

function planningInput(mode: TravelMode): TravelPlanningInput {
  const endpoint = (ref: string, source: TravelEndpoint["source"], coordinate: number, extra: Partial<TravelEndpoint> = {}): TravelEndpoint =>
    ({ ref, source, sourceRevision: `${ref}-r1`, point: { kind: "coordinates", latitude: coordinate, longitude: coordinate }, ...extra });
  return {
    journeyRef: "journey-1", journeyRevision: "journey-r1", now: NOW, grantRevision: "grant-1", defaultMode: mode,
    base: endpoint("base", "saved_base", 9),
    device: endpoint("device", "device", 1, { observedAt: NOW, accuracyMeters: 10, grantRevision: "grant-1" }),
    predictedOrigin: null, corrections: [],
    commitments: [{ ref: "event-1", revision: "event-1-r1", kind: "calendar", startAt: "2026-10-22T18:00:00Z",
      endAt: "2026-10-22T20:30:00Z", attendance: "physical", endpoint: endpoint("event-1-place", "calendar", 2), mode: null }],
    buffers: { arrivalSeconds: 0, exitSeconds: 0, settlingSeconds: 0 },
  };
}

function evidenceInput(plan: ReturnType<typeof resolveTravelPlan>, weather: TravelEvidenceInput["weather"], outboundSeconds = 1800): TravelEvidenceInput {
  const routeEstimate = (departureAt: string, seconds: number): TravelRouteEstimate => ({
    departureAt, arrivalAt: new Date(Date.parse(departureAt) + seconds * 1000).toISOString().replace(".000Z", "Z"),
    durationSeconds: seconds, warnings: [], fallback: false, attribution: "Synthetic provider",
    observedAt: "2026-10-22T14:05:00Z", expiresAt: "2026-10-22T18:00:00Z",
  });
  return {
    plan,
    results: plan.legs.map((leg) => ({ legId: leg.id, provenance: leg.provenance,
      estimate: leg.role === "return"
        ? routeEstimate("2026-10-22T20:30:00Z", 1800)
        : routeEstimate(new Date(Date.parse("2026-10-22T17:50:00Z") - outboundSeconds * 1000).toISOString().replace(".000Z", "Z"), outboundSeconds) })),
    collisionCandidates: [],
    buffers: { arrivalSeconds: 0, exitSeconds: 0, settlingSeconds: 0 },
    weather,
    now: "2026-10-22T14:10:00Z",
    expectedJourneyRevision: plan.journeyRevision,
    expectedGrantRevision: plan.grantRevision,
    modelProjection: "disabled",
  };
}
