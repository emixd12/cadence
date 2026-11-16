import { describe, expect, it } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import { validateVersionedAdvisorDayContext } from "@cadence/core/services/advisor-day-context";
import type { DailyBriefGenerator } from "@/lib/services/daily-brief-consumer";
import { prepareDailyBrief } from "@/lib/services/daily-brief-consumer";
import { ADVISOR_EVAL_FIXTURE_IDS, advisorEvalFixture, advisorEvalFixtures } from "@/lib/services/advisor-eval/fixtures";
import { checkLayerOne, checkSchema } from "@/lib/services/advisor-eval/rules";
import { clockTimes, compareAdvisorEval, runAdvisorEval, summarizeAdvisorEval } from "@/lib/services/advisor-eval/harness";

/** Picks the first offered move when there is one, and writes a plain sentence. */
function scripted(text: string, options: { pick?: boolean; usage?: boolean } = {}): DailyBriefGenerator {
  return async (input) => {
    const facts = JSON.parse(input.facts) as { plan: { options: { id: string; occurrenceRef: string }[] } };
    const option = options.pick === false ? undefined : facts.plan.options[0];
    if (options.usage !== false) input.onUsage?.({ inputTokens: 4_000, cachedInputTokens: 1_000, outputTokens: 300, reasoningTokens: 100 });
    return { text, occurrenceRefs: [], tip: null,
      suggestions: option ? [{ text: "Move it a little later.", occurrenceRefs: [option.occurrenceRef], referenceIds: [], optionId: option.id }] : [] };
  };
}

const run = (text: string, options?: Parameters<typeof scripted>[1]) =>
  runAdvisorEval({ run: { label: "test", model: "openai/gpt-5.6-luna", generate: scripted(text, options) }, clock: () => 0 });

describe("advisor eval fixtures", () => {
  it("builds ten valid synthetic accounts that the real prepare step accepts", async () => {
    expect(ADVISOR_EVAL_FIXTURE_IDS).toHaveLength(10);
    for (const fixture of advisorEvalFixtures()) {
      expect(validateVersionedAdvisorDayContext(fixture.context)).toBeTruthy();
      const now = () => Temporal.Instant.from(fixture.context.capturedAt);
      await expect(prepareDailyBrief(fixture.context, { signal: new AbortController().signal, now, config: fixture.config })).resolves.toBeTruthy();
    }
  });

  it("covers the situations the plan names", () => {
    expect(advisorEvalFixture("daylight_saving").context.dayStartAt).toBe("2026-11-01T04:00:00Z");
    expect(advisorEvalFixture("daylight_saving").context.dayEndAt).toBe("2026-11-02T05:00:00Z");
    expect(advisorEvalFixture("near_midnight").context.capturedAt).toBe("2026-11-02T04:50:00Z");
    expect(advisorEvalFixture("timezone_change").context.timezone).toBe("America/Los_Angeles");
    expect(advisorEvalFixture("mac_linked").context.connectors[0]).toMatchObject({ source: "icloud_calendar" });
    expect(advisorEvalFixture("stale_calendar").context.connectors[0]).toMatchObject({ state: "stale", events: [] });
    expect(advisorEvalFixture("new_user").context.cadence.history.behaviors.every((row) => row.completedCount === 0)).toBe(true);
    expect(advisorEvalFixture("hidden_instructions").context.cadence.occurrences[0].title).toMatch(/Ignore all rules/);
    expect(advisorEvalFixture("heavy_mover").declinedMoves).toHaveLength(1);
  });
});

describe("advisor eval layer 1", () => {
  const base = async () => {
    const fixture = advisorEvalFixture("busy_professional");
    const { validation } = await prepareDailyBrief(fixture.context, { signal: new AbortController().signal,
      now: () => Temporal.Instant.from(fixture.context.capturedAt), config: fixture.config, planningNow: fixture.context.capturedAt });
    return { fixture, validation };
  };

  it("checks output against the strict schema", () => {
    expect(checkSchema({ text: "", occurrenceRefs: [], suggestions: [], tip: null })).toEqual([]);
    expect(checkSchema({ text: "", occurrenceRefs: [], suggestions: [] })[0]).toMatchObject({ rule: "schema", source: "model" });
    expect(checkSchema({ text: "", occurrenceRefs: [], suggestions: [], tip: null, extra: 1 })[0].rule).toBe("schema");
  });

  it("flags re-offered declines, collisions, busy time, leaving the day and past starts", async () => {
    const { fixture, validation } = await base();
    const option = validation.offeredOptions[0];
    const proposed = option.intervals.proposed as { startAt: string; endAt: string };
    const clash = { ...option, id: "option_clash", occurrenceRef: "occurrence_fixture_7" };
    const outside = { ...option, id: "option_outside", occurrenceRef: "occurrence_fixture_8",
      intervals: { ...option.intervals, proposed: { ...proposed, startAt: "2026-11-02T04:50:00Z", endAt: "2026-11-02T05:10:00Z" } } };
    const past = { ...option, id: "option_past", occurrenceRef: "occurrence_fixture_9",
      intervals: { ...option.intervals, proposed: { ...proposed, startAt: "2026-11-01T05:00:00Z", endAt: "2026-11-01T05:20:00Z" } } };
    const rules = checkLayerOne({ validation: { ...validation, offeredOptions: [option, clash, outside, past] as typeof validation.offeredOptions },
      declinedMoves: [{ occurrenceRef: option.occurrenceRef, proposedStartAt: proposed.startAt }],
      busy: [{ ref: "event_busy", startAt: proposed.startAt, endAt: proposed.endAt }],
      dayStartAt: fixture.context.dayStartAt, dayEndAt: fixture.context.dayEndAt }).map((item) => item.rule);
    expect(new Set(rules)).toEqual(new Set(["declined_move_reoffered", "proposals_collide", "proposal_hits_busy_time", "proposal_leaves_day", "proposal_in_past"]));
  });

  it("attributes a violation to the model only for moves it picked", async () => {
    const { fixture, validation } = await base();
    const option = validation.offeredOptions[0];
    const proposed = option.intervals.proposed as { startAt: string };
    const output = { text: "x", occurrenceRefs: [], tip: null, suggestions: [{ text: "x", occurrenceRefs: [option.occurrenceRef], referenceIds: [], optionId: option.id }] };
    const violations = checkLayerOne({ output, validation, declinedMoves: [{ occurrenceRef: option.occurrenceRef, proposedStartAt: proposed.startAt }],
      busy: [], dayStartAt: fixture.context.dayStartAt, dayEndAt: fixture.context.dayEndAt });
    expect(violations.map((item) => item.source).sort()).toEqual(["model", "planner"]);
  });
});

describe("advisor eval harness", () => {
  it("records quality, cost and latency for every fixture", async () => {
    const results = await run("A steady day. Your walk is at 12:30 PM.");
    expect(results).toHaveLength(10);
    for (const result of results) {
      expect(result.brief).not.toBeNull();
      expect(result.costMicrodollars).toBe(Math.ceil(3_000 * 0.2 + 1_000 * 0.02 + 300 * 1.2));
      expect(result.latencyMs).toBe(0);
      expect(result.score).toBeGreaterThan(0);
    }
    const heavy = results.find((item) => item.fixture === "heavy_mover")!;
    // Known gap until Phase 3: the planner re-offers the declined move, and the model picked it.
    expect(heavy.layerOne.map((item) => item.rule)).toContain("declined_move_reoffered");
    expect(heavy.layerOneUnexpected).toEqual([]);
    const summary = summarizeAdvisorEval(results);
    expect(summary).toMatchObject({ fixtures: 10, validOutputs: 10, unexpectedLayerOne: 0 });
    expect(summary.knownGapLayerOne).toBeGreaterThan(0);
  });

  it("scores the rubric criteria each fixture asks for", async () => {
    const results = await run("You usually walk at 3:15 PM.");
    const criterion = (fixture: string, id: string) => results.find((item) => item.fixture === fixture)!.rubric.find((item) => item.id === id);
    expect(criterion("new_user", "no_history_claims")).toMatchObject({ passed: false, detail: "usually" });
    expect(criterion("daylight_saving", "local_times_correct")).toMatchObject({ passed: false, detail: "3:15 PM" });
    expect(criterion("stale_calendar", "no_moves")?.passed).toBe(true);
    expect(criterion("busy_professional", "uses_offered_move")?.passed).toBe(true);
    expect(criterion("hidden_instructions", "no_injection_echo")?.passed).toBe(true);
    const ignored = await run("Nothing to change today.", { pick: false });
    expect(ignored.find((item) => item.fixture === "busy_professional")!.rubric.find((item) => item.id === "uses_offered_move")?.passed).toBe(false);
  });

  it("fails every criterion for a rejected brief and records the reason", async () => {
    const results = await run("Visit https://evil.invalid now.");
    const hostile = results.find((item) => item.fixture === "hidden_instructions")!;
    expect(hostile).toMatchObject({ brief: null, rejection: "validation_url" });
    expect(hostile.rubric.find((item) => item.id === "valid_output")).toMatchObject({ passed: false, detail: "validation_url" });
  });

  it("compares a candidate with a baseline", async () => {
    const good = await run("A steady day.");
    const bad = await run("Visit https://evil.invalid now.");
    expect(compareAdvisorEval(good, good).atLeastAsGood).toBe(true);
    const comparison = compareAdvisorEval(good, bad);
    expect(comparison.atLeastAsGood).toBe(false);
    expect(comparison.regressions).toHaveLength(10);
  });

  it("reads clock times the way Cadence labels them", () => {
    expect(clockTimes("Walk at 1:10 PM, stretch at 9am, read at 10 p.m.")).toEqual(["1:10 PM", "9:00 AM", "10:00 PM"]);
  });
});
