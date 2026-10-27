import { describe, expect, it, vi } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import { validateAdvisorDayContext } from "@cadence/core/services/advisor-day-context";
import { BRIEFING_PRESETS } from "@cadence/core/services/briefing-config";
import type { TravelFitConclusion } from "@cadence/core/types/travel";
import { generateDailyBrief } from "@/lib/services/daily-brief-consumer";
import { prepareBriefing } from "@/lib/services/briefing-pipeline";
import fixture from "./fixtures/advisor-day-context.valid.json";

const config = BRIEFING_PRESETS.find(({ id }) => id === "advisor-analysis-3")!.config;
const base = validateAdvisorDayContext(fixture);
const walk = base.cadence.occurrences[0]!;
const signal = () => new AbortController().signal;
const now = () => Temporal.Instant.from(base.capturedAt);
const reply = { text: "", occurrenceRefs: [], suggestions: [], tip: null };

function travelContext(conclusion: TravelFitConclusion) {
  return validateAdvisorDayContext({ ...base, travel: {
    version: "1.0", routing: "on", usualMode: "walking",
    behaviors: [{ behaviorRef: walk.behaviorRef, where: "anywhere" }],
    route: { state: "available", conclusions: {
      version: "2.0", travelDay: "yes", calendarEvents: true,
      trips: [{ destinationRef: "event_fixture", role: "outbound", mode: "walking", estimate: "current" }],
      fits: [{ ref: walk.ref, conclusion,
        basis: conclusion === "does_not_fit" ? "travel_overlap" : conclusion === "fits" ? "travel_known" : "travel_unknown",
        trip: { destinationRef: "event_fixture", role: "outbound" }, position: null }],
    } },
  } });
}

describe("recipe 1.2 suggestions with projected travel facts", () => {
  it("does not restore an omitted move that conflicts with travel", async () => {
    const context = travelContext("does_not_fit");
    const { travel, ...withoutTravel } = context;
    expect(travel?.route.state).toBe("available");
    // The planner remains travel-free; eligibility is checked only after projection.
    const prepared = prepareBriefing(context, config, context.capturedAt);
    expect(prepared.plan).toEqual(prepareBriefing(withoutTravel, config, context.capturedAt).plan);
    expect(prepared.plan.options.length).toBeGreaterThan(0);
    const generate = vi.fn().mockResolvedValue(reply);
    const briefing = await generateDailyBrief(context, { generate, config, signal: signal(), now });
    expect(briefing.suggestions).toEqual([]);
    expect(JSON.parse(generate.mock.calls[0]![0].facts).plan.options).toEqual([]);
  });

  it("does not treat an unknown travel fit as permission to add a fallback move", async () => {
    const generate = vi.fn().mockResolvedValue(reply);
    const briefing = await generateDailyBrief(travelContext("unknown"), { generate, config, signal: signal(), now });
    const payload = JSON.parse(generate.mock.calls[0]![0].facts);
    expect(payload.context.travel.route.conclusions.fits[0].conclusion).toBe("unknown");
    expect(payload.plan.options.length).toBeGreaterThan(0);
    expect(briefing.suggestions).toEqual([]);
  });

  it("retains the candidate fallback when the projected travel conclusion permits it", async () => {
    const generate = vi.fn().mockResolvedValue(reply);
    const briefing = await generateDailyBrief(travelContext("fits"), { generate, config, signal: signal(), now });
    expect(briefing.suggestions).toHaveLength(1);
    expect(briefing.suggestions?.[0]?.occurrenceRefs).toEqual([walk.ref]);
  });

  it("rejects a model-selected move excluded by the projected travel conclusion", async () => {
    const context = travelContext("does_not_fit");
    const option = prepareBriefing(context, config, context.capturedAt).plan.options[0]!;
    const generate = vi.fn().mockResolvedValue({ ...reply, suggestions: [
      { text: "", occurrenceRefs: [walk.ref], referenceIds: [], optionId: option.id },
    ] });
    await expect(generateDailyBrief(context, { generate, config, signal: signal(), now }))
      .rejects.toThrow("advisor_unavailable");
  });

  it("uses projected travel rather than a conclusion withheld by the selected scope", async () => {
    const raw = travelContext("does_not_fit");
    const route = raw.travel!.route;
    if (route.state !== "available") throw new Error("Expected fixture route conclusions.");
    const destinationRef = "occurrence_completed";
    const context = validateAdvisorDayContext({ ...raw,
      cadence: { ...raw.cadence, occurrences: [...raw.cadence.occurrences,
        { ...walk, ref: destinationRef, status: "completed", scheduledFor: "2026-11-01T20:00:00Z",
          schedule: { kind: "exact", startTime: "15:00:00", endTime: null } },
      ] },
      travel: { ...raw.travel, route: { ...route, conclusions: { ...route.conclusions,
        trips: [{ destinationRef, role: "onward", mode: "walking", estimate: "current" }],
        fits: route.conclusions.fits.map((fit) => ({ ...fit, trip: { destinationRef, role: "onward" } })),
      } } },
    });
    const prepared = prepareBriefing(context, config, context.capturedAt);
    expect(prepared.facts.travel?.route).toEqual({ state: "unavailable", reason: "scope_narrowed" });
    expect(prepared.plan.options.length).toBeGreaterThan(0);
    const generate = vi.fn().mockImplementation(async ({ facts }: { facts: string }) => {
      const payload = JSON.parse(facts);
      expect(payload.context.travel.route).toEqual({ state: "unavailable", reason: "scope_narrowed" });
      expect(payload.plan.options.length).toBeGreaterThan(0);
      return { ...reply, text: "Walk overlaps your meeting; travel timing is unavailable.", suggestions: [
        { text: "", occurrenceRefs: [walk.ref], referenceIds: [], optionId: payload.plan.options[0].id },
      ] };
    });
    const briefing = await generateDailyBrief(context, { generate, config, signal: signal(), now });
    expect(briefing.suggestions).toHaveLength(1);
    const omitted = await generateDailyBrief(context, { generate: vi.fn().mockResolvedValue(reply), config, signal: signal(), now });
    expect(omitted.suggestions).toEqual([]);
  });
});
