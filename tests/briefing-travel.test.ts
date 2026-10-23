import { describe, expect, it, vi } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import { validateAdvisorDayContext } from "@cadence/core/services/advisor-day-context";
import { DEFAULT_BRIEFING_CONFIG, projectBriefingContext, scopeBriefingContext } from "@cadence/core/services/briefing-config";
import type { BriefingConfig } from "@cadence/core/types/briefing-config";
import type { AdvisorDayContextV1 } from "@cadence/core/types/advisor-day-context";
import { briefingFixture } from "@/lib/services/briefing-fixtures";
import { prepareBriefing } from "@/lib/services/briefing-pipeline";
import { DAILY_BRIEF_TRAVEL_INSTRUCTIONS, generateDailyBrief } from "@/lib/services/daily-brief-consumer";

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
        { destinationRef: "occurrence_travel_stretch", role: "onward", mode: "cycling", estimate: "current" },
        { destinationRef: null, role: "return", mode: "cycling", estimate: "current" },
      ] } },
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
    expect(noCalendar.facts.travel?.behaviors).toHaveLength(4);
    expect(noCalendar.contextControls.travel).toEqual({ route: "calendar_not_included" });

    const narrowed = withScope({ behaviorRefs: ["behavior_fixture"] });
    // The onward trip goes to a Behavior outside the selection, so no conclusion is partial.
    expect(projectBriefingContext(briefingFixture("travel_day", narrowed), narrowed).facts.travel?.route)
      .toEqual({ state: "unavailable", reason: "scope_narrowed" });
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

    for (const [{ facts, instructions }] of generate.mock.calls.slice(0, 2)) {
      expect(instructions).toContain(DAILY_BRIEF_TRAVEL_INSTRUCTIONS);
      const payload = JSON.parse(facts);
      expect(payload.context.travel.route.state).toBe("available");
      // The travel block holds enums and refs only.
      expect(numbers(payload.context.travel)).toEqual([]);
      for (const value of numbers(payload)) expect(ROUTE_SECONDS.flatMap((seconds) => [seconds, roundTo(seconds, 60), Math.ceil(seconds / 60) * 60])).not.toContain(value);
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
    if (!route) throw new Error("Route conclusions are unavailable.");
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
      { ...travel, habits: { getReadyMinutes: 10.5, placeModes: [] } },
      { ...travel, weather: { source: "open_meteo", conditions: [{ tripDestinationRef: null, condition: "precipitation", marginMinutes: 61, suggestedMode: null }] } },
      { ...travel, weather: { source: "open_meteo", conditions: [{ tripDestinationRef: null, condition: "precipitation", marginMinutes: 10, suggestedMode: null, temperature: 3 }] } },
      { ...travel, placeLabels: [{ behaviorRef: "behavior_fixture", home: 9, savedPlace: 0, elsewhere: 1, latitude: 40.7 }] },
    ];
    for (const value of invalid) expect(() => validateAdvisorDayContext({ ...context, travel: value })).toThrow();
  });

  it("carries later-stage habit, weather and label slots through the same visibility rules", () => {
    const context: AdvisorDayContextV1 = validateAdvisorDayContext({ ...briefingFixture("travel_day", config), travel: {
      ...briefingFixture("travel_day", config).travel!,
      habits: { getReadyMinutes: 10, placeModes: [{ behaviorRef: "behavior_travel_read", mode: "transit" }] },
      weather: { source: "open_meteo", conditions: [
        { tripDestinationRef: "event_travel_dentist", condition: "precipitation", marginMinutes: 10, suggestedMode: "transit" },
        { tripDestinationRef: null, condition: "extreme_heat", marginMinutes: 5, suggestedMode: null },
      ] },
      placeLabels: [{ behaviorRef: "behavior_fixture", home: 9, savedPlace: 0, elsewhere: 1 }],
    } });
    expect(projectBriefingContext(context, config).facts.travel).toMatchObject({
      habits: { getReadyMinutes: 10, placeModes: [{ behaviorRef: "behavior_travel_read", mode: "transit" }] },
      weather: { conditions: [{ tripDestinationRef: "event_travel_dentist" }, { tripDestinationRef: null }] },
      placeLabels: [{ behaviorRef: "behavior_fixture", home: 9 }],
    });
    const narrowed = withScope({ includeCalendar: false, behaviorRefs: ["behavior_fixture"] });
    expect(projectBriefingContext(context, narrowed).facts.travel).toMatchObject({
      habits: { placeModes: [] },
      weather: { conditions: [{ tripDestinationRef: null, condition: "extreme_heat" }] },
      placeLabels: [{ behaviorRef: "behavior_fixture" }],
    });
  });
});

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
