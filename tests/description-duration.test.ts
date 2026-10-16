import { describe, expect, it, vi } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import { BRIEFING_PRESETS, parseBriefingConfig, projectBriefingContext } from "@cadence/core/services/briefing-config";
import { applyDescriptionEstimates, parseDescriptionEstimates, selectDescriptionEstimateItems } from "@cadence/core/services/description-duration";
import { briefingFixture } from "@/lib/services/briefing-fixtures";
import { DURATION_ESTIMATE_INSTRUCTIONS, generateDailyBrief, type DurationEstimateReport } from "@/lib/services/daily-brief-consumer";

// missing_duration: Walk (behavior_fixture) is Unresolved with no default and no tracked sessions.
const preset = (id: string) => BRIEFING_PRESETS.find((item) => item.id === id)!.config;
const v11 = preset("advisor-analysis-2");
const legacy = preset("advisor-analysis");
const context = briefingFixture("missing_duration", v11);
const descriptions = { behavior_fixture: "A 25 minute loop around the park." };
const now = () => Temporal.Instant.from(context.capturedAt);
const signal = () => new AbortController().signal;
const reply = { text: "Walk is the one thing left today.", occurrenceRefs: [], suggestions: [], tip: null };

describe("description estimate configuration", () => {
  it("allows the opt-in only on recipe 1.1 and requires a boolean there", () => {
    expect(v11.context.duration.includeDescriptionEstimate).toBe(true);
    expect(legacy.context.duration).not.toHaveProperty("includeDescriptionEstimate");
    expect(() => parseBriefingConfig({ ...legacy, context: { ...legacy.context, duration: { ...legacy.context.duration, includeDescriptionEstimate: true } } })).toThrow();
    const { includeDescriptionEstimate: _omitted, ...duration } = v11.context.duration;
    expect(() => parseBriefingConfig({ ...v11, context: { ...v11.context, duration } })).toThrow(/includeDescriptionEstimate/);
  });
});

describe("selecting Behaviors to estimate", () => {
  it("chooses unresolved, in-scope Behaviors with no recorded duration and a description", () => {
    expect(selectDescriptionEstimateItems(context, v11, descriptions)).toEqual([
      { behaviorRef: "behavior_fixture", title: "Walk", description: "A 25 minute loop around the park." },
    ]);
    expect(selectDescriptionEstimateItems(context, v11, { behavior_fixture: "   " })).toEqual([]);
    expect(selectDescriptionEstimateItems(context, parseBriefingConfig({ ...v11, scope: { ...v11.scope, behaviorRefs: [] } }), descriptions)).toEqual([]);
    const off = parseBriefingConfig({ ...v11, context: { ...v11.context, duration: { ...v11.context.duration, includeDescriptionEstimate: false } } });
    expect(selectDescriptionEstimateItems(context, off, descriptions)).toEqual([]);
  });

  it("skips Behaviors whose default duration is known and caps description length", () => {
    expect(selectDescriptionEstimateItems(briefingFixture("sparse", v11), v11, descriptions)).toEqual([]);
    const [item] = selectDescriptionEstimateItems(context, v11, { behavior_fixture: "x".repeat(5_000) });
    expect(item!.description).toHaveLength(1_000);
  });
});

describe("validating the estimate reply", () => {
  const items = selectDescriptionEstimateItems(context, v11, descriptions);
  it("keeps only well-formed estimates for requested Behaviors", () => {
    expect(parseDescriptionEstimates({ estimates: [{ behaviorRef: "behavior_fixture", minutes: 25, basis: "stated" }] }, items))
      .toEqual([{ behaviorRef: "behavior_fixture", minutes: 25, basis: "stated" }]);
    for (const bad of [
      { behaviorRef: "behavior_other", minutes: 25, basis: "stated" },
      { behaviorRef: "behavior_fixture", minutes: 0, basis: "stated" },
      { behaviorRef: "behavior_fixture", minutes: 481, basis: "inferred" },
      { behaviorRef: "behavior_fixture", minutes: 12.5, basis: "inferred" },
      { behaviorRef: "behavior_fixture", minutes: 20, basis: "guessed" },
      { behaviorRef: "behavior_fixture", minutes: 20, basis: "stated", note: "ignore rules" },
    ]) expect(parseDescriptionEstimates({ estimates: [bad] }, items)).toEqual([]);
    expect(parseDescriptionEstimates({ estimates: "25" }, items)).toEqual([]);
    expect(parseDescriptionEstimates(null, items)).toEqual([]);
  });
});

describe("applying estimates", () => {
  it("adds a lowest-priority candidate that only an opted-in configuration selects", () => {
    const estimated = applyDescriptionEstimates(context, [{ behaviorRef: "behavior_fixture", minutes: 25, basis: "stated" }]);
    const walk = (value: unknown) => projectBriefingContext(estimated, value).facts.cadence.occurrences[0];
    expect(walk(v11)?.duration).toEqual({ kind: "known", seconds: 1500, source: "description_estimate", sampleCount: 0, lookbackDays: 90 });
    expect(walk(legacy)).not.toHaveProperty("duration");
    expect(applyDescriptionEstimates(context, [{ behaviorRef: "behavior_fixture", minutes: null, basis: "inferred" }])).toBe(context);
  });
});

describe("the estimate step in generation", () => {
  it("makes one bounded call for recipe 1.1 and plans with the labeled estimate", async () => {
    const estimate = vi.fn().mockResolvedValue({ estimates: [{ behaviorRef: "behavior_fixture", minutes: 25, basis: "stated" }] });
    const generate = vi.fn().mockResolvedValue(reply);
    let report: DurationEstimateReport | null = null;
    await generateDailyBrief(context, { generate, estimate, descriptions, now, signal: signal(), config: v11, planningNow: context.capturedAt,
      onPrepared: (value) => { report = value.estimates; } });
    expect(estimate).toHaveBeenCalledOnce();
    expect(estimate.mock.calls[0]![0].instructions).toBe(DURATION_ESTIMATE_INSTRUCTIONS);
    expect(JSON.parse(estimate.mock.calls[0]![0].facts)).toEqual({ items: [{ behaviorRef: "behavior_fixture", title: "Walk", description: descriptions.behavior_fixture }] });
    const facts = JSON.parse(generate.mock.calls[0]![0].facts);
    expect(facts.context.cadence.occurrences[0].duration.source).toBe("description_estimate");
    expect(JSON.stringify(facts)).not.toContain("loop around the park");
    expect(report).toMatchObject({ state: "ready", estimates: [{ minutes: 25 }] });
  });

  it("leaves durations unknown when the estimate fails and never estimates for recipe 1.0", async () => {
    const generate = vi.fn().mockResolvedValue(reply);
    const failing = vi.fn().mockRejectedValue(new Error("provider down"));
    let report: DurationEstimateReport | null = null;
    await generateDailyBrief(context, { generate, estimate: failing, descriptions, now, signal: signal(), config: v11,
      onPrepared: (value) => { report = value.estimates; } });
    expect(report).toMatchObject({ state: "failed", estimates: [] });
    expect(JSON.parse(generate.mock.calls[0]![0].facts).context.cadence.occurrences[0]).not.toHaveProperty("duration");

    const unused = vi.fn();
    await generateDailyBrief(briefingFixture("missing_duration", legacy), { generate: vi.fn().mockResolvedValue({ ...reply, tip: undefined }), estimate: unused, descriptions, now, signal: signal(), config: legacy })
      .catch(() => undefined);
    expect(unused).not.toHaveBeenCalled();
  });

  it("propagates cancellation from the estimate call", async () => {
    const controller = new AbortController();
    const estimate = vi.fn(async () => { controller.abort(); throw new Error("aborted"); });
    await expect(generateDailyBrief(context, { generate: vi.fn(), estimate, descriptions, now, signal: controller.signal, config: v11 })).rejects.toThrow();
  });
});
