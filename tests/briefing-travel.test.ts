import { describe, expect, it, vi } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import { validateAdvisorDayContext } from "@cadence/core/services/advisor-day-context";
import { DEFAULT_BRIEFING_CONFIG, projectBriefingContext, scopeBriefingContext } from "@cadence/core/services/briefing-config";
import type { BriefingConfig } from "@cadence/core/types/briefing-config";
import { briefingFixture } from "@/lib/services/briefing-fixtures";
import { prepareBriefing } from "@/lib/services/briefing-pipeline";
import { DAILY_BRIEF_TRAVEL_INSTRUCTIONS, generateDailyBrief } from "@/lib/services/daily-brief-consumer";
import { resolveTravelEvidence, resolveTravelPlan } from "@cadence/core/resolvers/travel.resolver";
import { advisorTravelHabits, advisorWeatherOutlook } from "@cadence/core/services/briefing-travel";
import { travelHabitBuffers } from "@cadence/core/services/travel-habits";
import type { TravelWeatherInput } from "@cadence/core/types/weather";

// Ticket 219: travel facts in Daily Brief model input (docs/LEGAL.md L-001).
// The fixtures invent routes of 37 min 17 s to the dentist and 23 min 41 s home.
const ROUTE_SECONDS = [2_237, 1_421];
const ROUTE_INSTANTS = ["2026-11-01T18:22:43Z", "2026-11-01T20:23:41Z"];
const ROUTE_LABELS = ["1:22 PM", "3:23 PM"];
const config = DEFAULT_BRIEFING_CONFIG;
const withScope = (scope: Partial<BriefingConfig["scope"]>): BriefingConfig => ({ ...config, scope: { ...config.scope, ...scope } });
const fit = (facts: ReturnType<typeof projectBriefingContext>["facts"]) => {
  const route = facts.travel?.route;
  if (route?.state !== "available") throw new Error("Route conclusions are unavailable.");
  return Object.fromEntries(route.conclusions.fits.map((item) => [item.ref, [item.conclusion, item.basis, item.trip?.destinationRef ?? null, item.trip?.role ?? null, item.position]]));
};

describe("Daily Brief travel facts", () => {
  it("projects Where, usual travel and Cadence's fit conclusions", () => {
    const { facts, contextControls } = projectBriefingContext(briefingFixture("travel_day", config), config);
    expect(facts.travel).toMatchObject({
      version: "1.0", routing: "on", usualMode: "cycling",
      behaviors: [
        { behaviorRef: "behavior_fixture", where: "anywhere" },
        { behaviorRef: "behavior_travel_read", where: "not_set" },
        { behaviorRef: "behavior_travel_stretch", where: "home" },
        { behaviorRef: "behavior_travel_journal", where: "anywhere" },
      ],
      route: { state: "available", conclusions: { version: "2.0", travelDay: "yes", calendarEvents: true, trips: [
        { destinationRef: "event_travel_dentist", role: "outbound", mode: "cycling", estimate: "current" },
        // Stage 2: the remembered mode for Home (Ticket 217) shapes the trips there and back.
        { destinationRef: "occurrence_travel_stretch", role: "onward", mode: "walking", estimate: "current" },
        { destinationRef: null, role: "return", mode: "walking", estimate: "current" },
      ] } },
      habits: { rulesVersion: "travel-habit-defaults@1", getReadyMinutes: 15, getReadySource: "learned",
        placeModes: [{ behaviorRef: "behavior_travel_stretch", mode: "walking" }] },
      weather: { source: "open_meteo", tableVersion: "weather-margin@1", state: "applied", calendarEvents: true, trips: [
        { destinationRef: "event_travel_dentist", role: "outbound", mode: "cycling", state: "margin", conditions: ["rain"], marginMinutes: 10,
          suggestion: { instead: "cycling", alternatives: ["transit"] } },
        { destinationRef: "occurrence_travel_stretch", role: "onward", mode: "walking", state: "margin", conditions: ["rain"], marginMinutes: 10, suggestion: null },
        { destinationRef: null, role: "return", mode: "walking", state: "clear", conditions: [], marginMinutes: 0, suggestion: null },
      ] },
      placeLabels: { rulesVersion: "where-suggestion-rules@1", periodDays: 60, behaviors: [
        { behaviorRef: "behavior_fixture", total: 10, home: 2, wherePlace: 0, otherSavedPlace: 1, elsewhere: 7 },
        { behaviorRef: "behavior_travel_stretch", total: 10, home: 9, wherePlace: 0, otherSavedPlace: 0, elsewhere: 1 },
      ] },
    });
    expect(fit(facts)).toEqual({
      occurrence_travel_run: ["fits", "travel_known", "event_travel_dentist", "outbound", "before"],
      occurrence_travel_read: ["does_not_fit", "travel_overlap", "event_travel_dentist", "outbound", null],
      occurrence_travel_stretch: ["does_not_fit", "late_arrival", "occurrence_travel_stretch", "onward", null],
      occurrence_travel_journal: ["fits", "travel_known", null, "return", "after"],
    });
    expect(contextControls.travel).toEqual({ route: "available" });
  });

  it("keeps the trip home unknown without Home and never treats it as free", () => {
    const { facts } = projectBriefingContext(briefingFixture("travel_unknown", config), config);
    const route = facts.travel?.route;
    expect(route?.state === "available" && route.conclusions.trips.at(-1)).toEqual({ destinationRef: null, role: "return", mode: null, estimate: "unknown" });
    // An unread forecast stays unavailable; it never becomes clear weather.
    expect(facts.travel?.weather).toEqual({ source: "open_meteo", tableVersion: "weather-margin@1", state: "unavailable", calendarEvents: true, trips: [] });
    expect(fit(facts)).toEqual({
      occurrence_travel_run: ["fits", "travel_known", "event_travel_dentist", "outbound", "before"],
      occurrence_travel_read: ["does_not_fit", "travel_overlap", "event_travel_dentist", "outbound", null],
      occurrence_travel_stretch: ["unknown", "travel_unknown", null, "return", "after"],
      occurrence_travel_journal: ["unknown", "travel_unknown", null, "return", "after"],
    });
  });

  it("withholds conclusions that depend on an excluded Calendar or stop", () => {
    const noCalendar = projectBriefingContext(briefingFixture("travel_day", config), withScope({ includeCalendar: false }));
    expect(noCalendar.facts.travel?.route).toEqual({ state: "unavailable", reason: "calendar_not_included" });
    expect(noCalendar.facts.travel?.weather).toMatchObject({ state: "calendar_not_included", trips: [] });
    expect(noCalendar.facts.travel?.behaviors).toHaveLength(4);
    expect(noCalendar.contextControls.travel).toEqual({ route: "calendar_not_included" });

    const narrowed = withScope({ behaviorRefs: ["behavior_fixture"] });
    // The onward trip goes to a Behavior outside the selection, so no conclusion is partial.
    const narrowedDay = projectBriefingContext(briefingFixture("travel_day", narrowed), narrowed).facts.travel;
    expect(narrowedDay?.route).toEqual({ state: "unavailable", reason: "scope_narrowed" });
    expect(narrowedDay?.weather).toMatchObject({ state: "scope_narrowed", trips: [] });
    expect(narrowedDay?.habits?.placeModes).toEqual([]);
    expect(narrowedDay?.placeLabels?.behaviors.map(({ behaviorRef }) => behaviorRef)).toEqual(["behavior_fixture"]);
    const unknown = projectBriefingContext(briefingFixture("travel_unknown", narrowed), narrowed).facts;
    expect(unknown.travel?.behaviors).toEqual([{ behaviorRef: "behavior_fixture", where: "anywhere" }]);
    expect(Object.keys(fit(unknown))).toEqual(["occurrence_travel_run"]);
  });

  it("keeps travel out of the planner and out of contexts without it", () => {
    const context = briefingFixture("travel_day", config);
    expect(scopeBriefingContext(context, config)).not.toHaveProperty("travel");
    const { travel, ...withoutTravel } = context;
    expect(travel?.route.state).toBe("available");
    const at = context.capturedAt;
    expect(prepareBriefing(context, config, at).plan).toEqual(prepareBriefing(withoutTravel, config, at).plan);

    const sparse = projectBriefingContext(briefingFixture("sparse", config), config);
    expect(sparse.facts).not.toHaveProperty("travel");
    expect(sparse.contextControls).not.toHaveProperty("travel");
  });

  it("sends no route duration, departure, arrival or time pair that reveals one", async () => {
    const generate = vi.fn().mockResolvedValue({ text: "Run before the dentist.", occurrenceRefs: [], suggestions: [] });
    for (const id of ["travel_day", "travel_unknown"] as const) {
      const context = briefingFixture(id, config);
      await generateDailyBrief(context, { generate, config, signal: new AbortController().signal,
        now: () => Temporal.Instant.from(context.capturedAt).add({ seconds: 1 }) });
    }
    const quiet = briefingFixture("sparse", config);
    await generateDailyBrief(quiet, { generate, config, signal: new AbortController().signal, now: () => Temporal.Instant.from(quiet.capturedAt) });
    expect(generate.mock.calls[2][0].instructions).not.toContain(DAILY_BRIEF_TRAVEL_INSTRUCTIONS);

    for (const [index, [{ facts, instructions }]] of generate.mock.calls.slice(0, 2).entries()) {
      const id = index === 0 ? "travel_day" : "travel_unknown";
      expect(instructions).toContain(DAILY_BRIEF_TRAVEL_INSTRUCTIONS);
      const payload = JSON.parse(facts);
      expect(payload.context.travel.route.state).toBe("available");
      // The travel block holds enums and refs, plus only the user's get-ready minutes,
      // fixed weather-table margins and label counts (stage 2).
      expect([...new Set(numberKeys(payload.context.travel))].sort()).toEqual(
        id === "travel_day" ? ["elsewhere", "getReadyMinutes", "home", "marginMinutes", "otherSavedPlace", "periodDays", "total", "wherePlace"]
          : ["elsewhere", "getReadyMinutes", "home", "otherSavedPlace", "periodDays", "total", "wherePlace"]);
      const routeForms = ROUTE_SECONDS.flatMap((seconds) => [seconds, roundTo(seconds, 60), Math.ceil(seconds / 60) * 60,
        Math.floor(seconds / 60), Math.round(seconds / 60), Math.ceil(seconds / 60)]);
      for (const value of numbers(payload.context.travel)) expect(routeForms).not.toContain(value);
      for (const value of numbers(payload)) expect(ROUTE_SECONDS.flatMap((seconds) => [seconds, roundTo(seconds, 60), Math.ceil(seconds / 60) * 60])).not.toContain(value);
      expect(payload.context.travel.weather.trips.every((trip: { marginMinutes: number }) => [0, 5, 10, 15].includes(trip.marginMinutes))).toBe(true);
      for (const leaked of [...ROUTE_INSTANTS, ...ROUTE_LABELS, "synthetic_home", "synthetic_dentist", "synthetic_device", "Synthetic routes", "placeId", "durationSeconds", "departureAt", "arrivalAt", "occupiedSpans", "finalAvailabilityAt"]) {
        expect(facts).not.toContain(leaked);
      }
      // No two instants in the payload differ by a route duration.
      const instants = [...new Set(strings(payload).filter((value) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(value)))]
        .map((value) => Temporal.Instant.from(value).epochMilliseconds / 1000);
      expect(instants.length).toBeGreaterThan(5);
      for (const left of instants) for (const right of instants) expect(ROUTE_SECONDS).not.toContain(Math.abs(left - right));
    }
  });

  it("rejects a travel block that could carry timing, places or unknown refs", () => {
    const context = briefingFixture("travel_day", config);
    const travel = context.travel!;
    const route = travel.route.state === "available" ? travel.route.conclusions : null;
    const { habits, weather, placeLabels: labels } = travel;
    if (!route || !habits || !weather || !labels) throw new Error("Travel facts are incomplete.");
    expect(() => validateAdvisorDayContext(context)).not.toThrow();
    const invalid: unknown[] = [
      { ...travel, homeText: "1 Main Street" },
      { ...travel, routing: "off" },
      { ...travel, routing: "off", usualMode: null },
      { ...travel, behaviors: [{ behaviorRef: "behavior_fixture", where: "office" }] },
      { ...travel, behaviors: [{ behaviorRef: "behavior_missing", where: "home" }] },
      { ...travel, route: { state: "available", conclusions: { ...route, leaveBy: "2026-11-01T18:22:43Z" } } },
      { ...travel, route: { state: "available", conclusions: { ...route, trips: [{ ...route.trips[0], durationSeconds: 2237 }] } } },
      { ...travel, route: { state: "available", conclusions: { ...route, trips: [{ ...route.trips[0], destinationRef: "event_missing" }] } } },
      { ...travel, route: { state: "available", conclusions: { ...route, fits: [{ ...route.fits[0], departureAt: "2026-11-01T18:22:43Z" }] } } },
      { ...travel, route: { state: "available", conclusions: { ...route, fits: [{ ...route.fits[0], ref: "occurrence_missing" }] } } },
      { ...travel, route: { state: "unavailable", reason: "provider_said_so" } },
      // Stage 2 habits: steps, bounds, source and rules version come from travel-habit-defaults@1.
      { ...travel, habits: { ...habits, getReadyMinutes: 12 } },
      { ...travel, habits: { ...habits, getReadyMinutes: 65 } },
      { ...travel, habits: { ...habits, getReadySource: "default" } },
      { ...travel, habits: { ...habits, rulesVersion: "travel-habit-defaults@2" } },
      { ...travel, habits: { ...habits, arrivalBufferMinutes: 5 } },
      { ...travel, habits: { ...habits, placeModes: [{ behaviorRef: "behavior_travel_stretch", mode: "walking", placeKey: "k".repeat(43) }] } },
      { ...travel, routing: "off", usualMode: null, route: { state: "unavailable", reason: "routing_off" } },
      // Stage 2 weather: margins are the fixed table value for the conditions, never a route-derived number.
      { ...travel, weather: { ...weather, trips: [{ ...weather.trips[0], marginMinutes: 37 }] } },
      { ...travel, weather: { ...weather, trips: [{ ...weather.trips[0], marginMinutes: 15 }] } },
      { ...travel, weather: { ...weather, trips: [{ ...weather.trips[0], conditions: ["rain", "drizzle"] }] } },
      { ...travel, weather: { ...weather, trips: [{ ...weather.trips[0], departureAt: "2026-11-01T18:12:43Z" }] } },
      { ...travel, weather: { ...weather, trips: [{ ...weather.trips[0], state: "clear" }] } },
      { ...travel, weather: { ...weather, trips: [{ ...weather.trips[2], state: "unknown", conditions: ["rain"], marginMinutes: 10 }] } },
      { ...travel, weather: { ...weather, trips: [{ ...weather.trips[0], suggestion: { instead: "transit", alternatives: ["cycling"] } }] } },
      { ...travel, weather: { ...weather, trips: [{ ...weather.trips[2], destinationRef: "event_travel_dentist" }] } },
      { ...travel, weather: { ...weather, state: "unavailable" } },
      { ...travel, weather: { ...weather, temperatureCelsius: 3 } },
      { ...travel, weather: { ...weather, tableVersion: "weather-margin@2" } },
      // Stage 2 labels: whole counts that add up, in the fixed rule window, with no place data.
      { ...travel, placeLabels: { ...labels, behaviors: [{ ...labels.behaviors[0], total: 11 }] } },
      { ...travel, placeLabels: { ...labels, behaviors: [{ ...labels.behaviors[0], latitude: 40.7 }] } },
      { ...travel, placeLabels: { ...labels, periodDays: 365 } },
      { ...travel, placeLabels: { ...labels, behaviors: [{ ...labels.behaviors[0], behaviorRef: "behavior_missing" }] } },
    ];
    for (const value of invalid) expect(() => validateAdvisorDayContext({ ...context, travel: value })).toThrow();
  });

  it("keeps weather and habit facts identical for any route duration (Tickets 217 and 218, L-001)", () => {
    // The same plan with very different invented routes: the stage 2 facts must not move.
    const facts = (outboundSeconds: number) => {
      const plan = resolveTravelPlan(durationPlan());
      const evidence = resolveTravelEvidence({ plan, collisionCandidates: [], buffers: travelHabitBuffers(null), now: DURATION_NOW,
        weather: durationForecast(), expectedJourneyRevision: plan.journeyRevision, expectedGrantRevision: plan.grantRevision, modelProjection: "enabled",
        results: plan.legs.map((leg) => {
          const seconds = leg.role === "outbound" ? outboundSeconds : 1_421;
          const departureAt = leg.role === "outbound" ? Temporal.Instant.from(leg.request.timing.at).subtract({ seconds }).toString() : leg.readyAt;
          return { legId: leg.id, provenance: leg.provenance, estimate: { departureAt, arrivalAt: Temporal.Instant.from(departureAt).add({ seconds }).toString(),
            durationSeconds: seconds, warnings: [], fallback: false, attribution: "Synthetic routes", observedAt: DURATION_NOW, expiresAt: "2026-11-01T20:00:00Z" } };
        }) });
      expect(evidence.legs.every((entry) => entry.state === "current")).toBe(true);
      return { weather: advisorWeatherOutlook(evidence), habits: advisorTravelHabits(null, [], null), conclusions: evidence.modelProjection };
    };
    const short = facts(301), long = facts(5_399);
    expect(short.weather).toMatchObject({ state: "applied", trips: [
      { role: "outbound", state: "margin", marginMinutes: 15, conditions: ["thunderstorm"] },
      { role: "return", state: "clear", marginMinutes: 0 },
    ] });
    expect(long).toEqual(short);
    expect(JSON.stringify(short)).not.toMatch(/301|5399|5_399|90|\d{4}-\d{2}-\d{2}T/);
  });

  it("credits Open-Meteo whenever weather facts reach the model", async () => {
    const generate = vi.fn().mockResolvedValue({ text: "Rain before the dentist.", occurrenceRefs: [], suggestions: [] });
    const run = async (id: "travel_day" | "travel_unknown", scope = config) => {
      const context = briefingFixture(id, scope);
      return generateDailyBrief(context, { generate, config: scope, signal: new AbortController().signal,
        now: () => Temporal.Instant.from(context.capturedAt).add({ seconds: 1 }) });
    };
    expect((await run("travel_day")).attributions).toEqual(["open_meteo"]);
    expect(await run("travel_unknown")).not.toHaveProperty("attributions");
    // Without the Calendar source the trips are withheld, so no weather fact reaches the model.
    expect(await run("travel_day", withScope({ includeCalendar: false }))).not.toHaveProperty("attributions");
  });

  it("states the stage 2 facts in the travel instructions without inviting times", () => {
    for (const phrase of ["getReadyMinutes", "unknown is not clear weather", "never a share of the trip", "never a departure time", "logged at Home 9 of 10 times"]) {
      expect(DAILY_BRIEF_TRAVEL_INSTRUCTIONS).toContain(phrase);
    }
  });
});

const DURATION_NOW = "2026-11-01T12:00:00Z";

function durationPlan(): Parameters<typeof resolveTravelPlan>[0] {
  const point = (latitude: number) => ({ kind: "coordinates" as const, latitude, longitude: latitude });
  return { journeyRef: "duration", journeyRevision: "duration-r1", grantRevision: "grant", now: DURATION_NOW, defaultMode: "cycling",
    base: { ref: "base", point: point(1), source: "saved_base", sourceRevision: "base-r1" }, device: null, predictedOrigin: null, corrections: [],
    buffers: travelHabitBuffers(null),
    commitments: [{ ref: "event-1", revision: "event-r1", kind: "calendar", startAt: "2026-11-01T18:00:00Z", endAt: "2026-11-01T19:00:00Z",
      attendance: "physical", endpoint: { ref: "event-1-place", point: point(2), source: "calendar", sourceRevision: "event-r1" }, mode: null }] };
}

function durationForecast(): TravelWeatherInput {
  const hourStart = Temporal.Instant.from(DURATION_NOW);
  return { state: "forecast", forecast: { provider: "open-meteo", areaKey: "synthetic", hourStart: DURATION_NOW, fetchedAt: DURATION_NOW,
    expiresAt: hourStart.add({ hours: 1 }).toString(), hours: Array.from({ length: 48 }, (_, index) => ({
      time: hourStart.add({ hours: index + 1 }).toString(), weatherCode: index < 7 ? 95 : 1, rainMillimeters: 0, snowfallCentimeters: 0,
      precipitationProbabilityPercent: 10, apparentTemperatureCelsius: 15, windGustsKilometersPerHour: 10 })) } };
}

function numberKeys(value: unknown, key = ""): string[] {
  if (typeof value === "number") return [key];
  if (Array.isArray(value)) return value.flatMap((item) => numberKeys(item, key));
  return value && typeof value === "object" ? Object.entries(value).flatMap(([name, item]) => numberKeys(item, name)) : [];
}

function numbers(value: unknown): number[] {
  if (typeof value === "number") return [value];
  if (Array.isArray(value)) return value.flatMap(numbers);
  return value && typeof value === "object" ? Object.values(value).flatMap(numbers) : [];
}

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  return value && typeof value === "object" ? [...Object.keys(value), ...Object.values(value).flatMap(strings)] : [];
}

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}
