import { describe, expect, it, vi } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import { validateAdvisorDayContext } from "@cadence/core/services/advisor-day-context";
import { BRIEFING_PRESETS, DEFAULT_BRIEFING_CONFIG, parseBriefingConfig, serializeBriefingConfig } from "@cadence/core/services/briefing-config";
import { briefingTipCategory, describeBriefingLimitation } from "@cadence/core/services/briefing-analysis";
import { briefingOptionText, briefingTipLabel, isPlainBriefing, visibleDailyBriefText } from "@cadence/core/services/daily-brief-presentation";
import type { BriefingAnalysisOccurrence, BriefingAnalysisSource } from "@cadence/core/types/briefing-analysis";
import type { BriefingPlanOption } from "@cadence/core/types/briefing-plan";
import fixture from "./fixtures/advisor-day-context.valid.json";
import { DAILY_BRIEF_V1_1_INSTRUCTIONS, generateDailyBrief } from "@/lib/services/daily-brief-consumer";
import { briefingConfigurationRevision, movableOccurrences, prepareBriefing } from "@/lib/services/briefing-pipeline";

// Fixture day: Sunday 2026-11-01; "Walk" is Unresolved at 12:30 and overlaps a 12:00–1:00 PM event.
const context = validateAdvisorDayContext(fixture);
const now = () => Temporal.Instant.from(context.capturedAt);
const signal = () => new AbortController().signal;
const walk = context.cadence.occurrences[0]!;
const preset = (id: string) => BRIEFING_PRESETS.find((item) => item.id === id)!.config;
const v11 = preset("advisor-analysis-2");

function day(offset: number) { return Temporal.PlainDate.from(context.localDate).subtract({ days: offset }).toString(); }
function row(localDate: string, status: BriefingAnalysisOccurrence["status"], index: number): BriefingAnalysisOccurrence {
  return { ref: `occurrence_history_${index}`, behaviorRef: walk.behaviorRef, localDate, scheduledFor: `${localDate}T16:30:00Z`,
    scheduleKind: "exact", startTime: "12:30", endTime: null, status, statusMarkedAt: null, configurationRef: null };
}
const history = Array.from({ length: 15 }, (_, index) => row(day(15 - index), index % 5 < 2 ? "unresolved" : "completed", index));
const source: BriefingAnalysisSource = {
  version: "1.0", observedAt: context.capturedAt, revision: "analysis_revision_fixture", timezone: context.timezone,
  localDate: context.localDate, startLocalDate: day(90), lookbackDays: 90, completeness: "complete", occurrences: history,
  statusEvents: { state: "not_requested" }, configurationPeriods: { state: "available", records: [] },
  reminders: { state: "not_requested" }, notes: { state: "not_requested" },
  today: { scheduledCount: 1, unresolved: [{ ref: walk.ref, behaviorRef: walk.behaviorRef, startTime: "12:30" }] },
};

describe("recipe 1.1 configuration", () => {
  it("adds the advisor-analysis-2 candidate without changing existing presets or the production default", () => {
    expect(v11.recipe).toEqual({ id: "daily_brief", version: "1.1" });
    for (const id of ["cadence-default", "warm-priorities", "advisor-analysis"]) expect(preset(id).recipe.version).toBe("1.0");
    expect(DEFAULT_BRIEFING_CONFIG.recipe.version).toBe("1.0");
    expect(parseBriefingConfig(JSON.parse(serializeBriefingConfig(v11))).recipe.version).toBe("1.1");
    expect(briefingConfigurationRevision(v11)).not.toBe(briefingConfigurationRevision(preset("advisor-analysis")));
  });

  it("rejects recipe 1.1 on configurations older than 1.3", () => {
    const old = preset("cadence-default");
    expect(() => parseBriefingConfig({ ...old, version: "1.2", recipe: { id: "daily_brief", version: "1.1" } })).toThrow(/recipe/);
    expect(() => parseBriefingConfig({ ...v11, recipe: { id: "daily_brief", version: "9.9" } })).toThrow(/recipe/);
  });
});

describe("recipe 1.1 movability", () => {
  it("makes every unresolved occurrence movable today without listing it; recipe 1.0 still needs explicit refs", () => {
    expect(movableOccurrences(preset("advisor-analysis"), context)).toEqual([]);
    expect(movableOccurrences(v11, context).map((item) => item.ref)).toEqual(context.cadence.occurrences.filter((item) => item.status === "unresolved").map((item) => item.ref));
  });

  it("excludes resolved occurrences and caps the planner input at its limit", () => {
    const many = { ...context, cadence: { ...context.cadence, occurrences: [
      { ...walk, ref: "occurrence_done", status: "completed" as const },
      ...Array.from({ length: 40 }, (_, index) => ({ ...walk, ref: `occurrence_${String(index).padStart(2, "0")}` })),
    ] } };
    const movable = movableOccurrences(v11, many);
    expect(movable).toHaveLength(32);
    expect(movable.some((item) => item.ref === "occurrence_done")).toBe(false);
  });

  it("produces a scheduling option for the conflicting walk only under recipe 1.1", () => {
    expect(prepareBriefing(context, preset("advisor-analysis"), context.capturedAt).plan.options).toEqual([]);
    const plan = prepareBriefing(context, v11, context.capturedAt).plan;
    expect(plan.options.length).toBeGreaterThan(0);
    expect(plan.options.every((option) => option.occurrenceRef === walk.ref)).toBe(true);
  });
});

describe("recipe 1.1 prompt", () => {
  it("appends the owner rules only for recipe 1.1", async () => {
    const reply = { text: "Walk overlaps your noon meeting.", occurrenceRefs: [walk.ref], suggestions: [] };
    const baseline = vi.fn().mockResolvedValue(reply);
    await generateDailyBrief(context, { generate: baseline, now, signal: signal(), config: DEFAULT_BRIEFING_CONFIG });
    expect(baseline.mock.calls[0]![0].instructions).not.toContain(DAILY_BRIEF_V1_1_INSTRUCTIONS);

    const candidate = vi.fn().mockImplementation(async ({ facts }: { facts: string }) => {
      const option = JSON.parse(facts).plan.options[0];
      return { ...reply, suggestions: [{ text: "Move Walk earlier so it clears your meeting.", occurrenceRefs: [walk.ref], referenceIds: [], optionId: option.id }], tip: null };
    });
    const briefing = await generateDailyBrief(context, { generate: candidate, now, signal: signal(), config: v11, analysis: { source } });
    const { instructions } = candidate.mock.calls[0]![0];
    expect(instructions).toContain(DAILY_BRIEF_V1_1_INSTRUCTIONS);
    expect(instructions).toMatch(/never say that nothing stands out/i);
    expect(briefing.versions?.recipe).toBe("daily_brief@1.1");
    expect(briefing.suggestions?.[0]?.option?.occurrenceRef).toBe(walk.ref);
  });

  it("keeps move-only openings out of the model plan unless an option backs them", async () => {
    const generate = vi.fn().mockResolvedValue({ text: "Walk overlaps your noon meeting.", occurrenceRefs: [], suggestions: [], tip: null });
    await generateDailyBrief(context, { generate, now, signal: signal(), config: v11, analysis: { source } });
    const plan = JSON.parse(generate.mock.calls[0]![0].facts).plan;
    const optionRefs = new Set(plan.options.map((option: BriefingPlanOption) => option.occurrenceRef));
    for (const finding of plan.dayEvidence.findings) {
      if (finding.kind === "feasible_opportunity" && finding.hypotheticalMoveRequired) expect(optionRefs.has(finding.occurrenceRef)).toBe(true);
    }
  });
});

describe("recipe 1.1 tips", () => {
  it("labels logging lanes, writes plain evidence and drops the association disclaimer", async () => {
    const config = parseBriefingConfig({ ...v11, analysis: { lanes: ["decision-debt"], maxTips: 1, cooldownDays: 14 } });
    const generate = vi.fn().mockResolvedValue({ text: "Walk overlaps your noon meeting.", occurrenceRefs: [walk.ref], suggestions: [],
      tip: { findingId: "tip", text: "Try recording a decision for Walk tonight.", noteRefs: [] } });
    const briefing = await generateDailyBrief(context, { generate, now, signal: signal(), config, analysis: { source } });
    expect(briefing.tip).toMatchObject({ category: "logging", basis: "Walk: 6 of 15 past times still have no decision; the oldest is 15 days old." });
    expect(briefingTipLabel(briefing.tip!)).toBe("Logging tip");
    expect(visibleDailyBriefText(briefing)).toContain("Logging tip");
  });

  it("categorizes lanes deterministically", () => {
    expect(briefingTipCategory({ laneId: "schedule-load", limitations: ["association_not_cause"] })).toBe("pattern");
    expect(briefingTipCategory({ laneId: "realistic-timing", limitations: ["marking_time_not_performance_time"] })).toBe("logging");
    expect(briefingTipCategory({ laneId: "logging-chronology", limitations: [] })).toBe("logging");
    expect(describeBriefingLimitation(["association_not_cause"])).toBe("A pattern, not proof of a cause.");
    expect(describeBriefingLimitation(["association_not_cause"], { plain: true })).toBeNull();
    expect(describeBriefingLimitation(["marking_time_not_performance_time"], { plain: true })).toMatch(/^Marks show/);
  });
});

describe("recipe 1.1 presentation", () => {
  it("shows a plain suggested time only for recipe 1.1 briefs", () => {
    const option = { intervals: { proposed: { startAt: "2026-11-01T12:00:00Z", endAt: "2026-11-01T12:20:00Z" } } } as BriefingPlanOption;
    expect(briefingOptionText(option, "America/New_York", false, true)).toBe("Suggested time: 7:00 AM–7:20 AM.");
    expect(briefingOptionText(option, "America/New_York")).toMatch(/^Hypothetical option: .*No change applied\.$/);
    expect(isPlainBriefing({ versions: { configuration: "", references: "", planner: "", pipeline: "", recipe: "daily_brief@1.1" } })).toBe(true);
    expect(isPlainBriefing({ versions: { configuration: "", references: "", planner: "", pipeline: "", recipe: "daily_brief@1.0" } })).toBe(false);
  });
});
