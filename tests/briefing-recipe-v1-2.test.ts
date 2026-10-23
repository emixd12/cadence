import { describe, expect, it, vi } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import { validateAdvisorDayContext } from "@cadence/core/services/advisor-day-context";
import { BRIEFING_PRESETS, DEFAULT_BRIEFING_CONFIG, parseBriefingConfig, serializeBriefingConfig } from "@cadence/core/services/briefing-config";
import {
  briefingBehaviorNames, briefingMoveText, briefingSuggestionLabel, briefingTextSegments, isEmptyBriefing, isLaneBriefing, isPlainBriefing, visibleDailyBriefText,
} from "@cadence/core/services/daily-brief-presentation";
import type { BriefingAnalysisOccurrence, BriefingAnalysisSource } from "@cadence/core/types/briefing-analysis";
import type { BriefingPlanOption } from "@cadence/core/types/briefing-plan";
import fixture from "./fixtures/advisor-day-context.valid.json";
import { briefingSetupTip } from "@cadence/core/services/briefing-setup-tip";
import { briefingMoveOverview } from "@cadence/core/services/briefing-move-overview";
import { parseDescriptionEstimates, selectDescriptionEstimateItems } from "@cadence/core/services/description-duration";
import { briefingTipLabel } from "@cadence/core/services/daily-brief-presentation";
import { DAILY_BRIEF_V1_1_INSTRUCTIONS, DAILY_BRIEF_V1_2_INSTRUCTIONS, generateDailyBrief } from "@/lib/services/daily-brief-consumer";
import { briefingConfigurationRevision, movableOccurrences } from "@/lib/services/briefing-pipeline";

// Fixture day: Sunday 2026-11-01; "Walk" is Unresolved at 12:30 and overlaps a 12:00–1:00 PM event.
const context = validateAdvisorDayContext(fixture);
const now = () => Temporal.Instant.from(context.capturedAt);
const signal = () => new AbortController().signal;
const walk = context.cadence.occurrences[0]!;
const preset = (id: string) => BRIEFING_PRESETS.find((item) => item.id === id)!.config;
const v11 = preset("advisor-analysis-2");
const v12 = preset("advisor-analysis-3");

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
const debtConfig = () => parseBriefingConfig({ ...v12, analysis: { lanes: ["decision-debt"], maxTips: 1, cooldownDays: 14 } });

describe("recipe 1.2 configuration", () => {
  it("adds the advisor-analysis-3 candidate without changing existing presets or the production default", () => {
    expect(v12.recipe).toEqual({ id: "daily_brief", version: "1.2" });
    expect(v11.recipe.version).toBe("1.1");
    expect([v11.alternatives, v12.alternatives]).toEqual([1, 3]);
    for (const id of ["cadence-default", "warm-priorities", "advisor-analysis"]) expect(preset(id).recipe.version).toBe("1.0");
    expect(DEFAULT_BRIEFING_CONFIG.recipe.version).toBe("1.0");
    expect(parseBriefingConfig(JSON.parse(serializeBriefingConfig(v12))).recipe.version).toBe("1.2");
    expect(briefingConfigurationRevision(v12)).not.toBe(briefingConfigurationRevision(v11));
    expect(() => parseBriefingConfig({ ...preset("cadence-default"), version: "1.2", recipe: { id: "daily_brief", version: "1.2" } })).toThrow(/recipe/);
  });

  it("keeps recipe 1.1 movability and description estimates", () => {
    expect(movableOccurrences(v12, context).map((item) => item.ref)).toEqual([walk.ref]);
    expect(v12.context.duration.includeDescriptionEstimate).toBe(true);
  });
});

describe("recipe 1.2 prompt and model input", () => {
  it("appends the 1.2 rules after the 1.1 rules, only for recipe 1.2", async () => {
    const reply = { text: "Walk overlaps your meeting by 20 minutes.", occurrenceRefs: [walk.ref], suggestions: [], tip: null };
    const older = vi.fn().mockResolvedValue(reply);
    await generateDailyBrief(context, { generate: older, now, signal: signal(), config: v11, analysis: { source } });
    expect(older.mock.calls[0]![0].instructions).not.toContain(DAILY_BRIEF_V1_2_INSTRUCTIONS);
    const candidate = vi.fn().mockResolvedValue(reply);
    await generateDailyBrief(context, { generate: candidate, now, signal: signal(), config: v12, analysis: { source } });
    const { instructions } = candidate.mock.calls[0]![0];
    expect(instructions.indexOf(DAILY_BRIEF_V1_2_INSTRUCTIONS)).toBeGreaterThan(instructions.indexOf(DAILY_BRIEF_V1_1_INSTRUCTIONS));
    expect(instructions).toMatch(/New suggested time/);
  });

  it("sends overlap lengths in minutes and no openings to the model", async () => {
    const generate = vi.fn().mockResolvedValue({ text: "Walk overlaps your meeting by 20 minutes.", occurrenceRefs: [], suggestions: [], tip: null });
    await generateDailyBrief(context, { generate, now, signal: signal(), config: v12, analysis: { source } });
    const findings = JSON.parse(generate.mock.calls[0]![0].facts).plan.dayEvidence.findings as Array<Record<string, unknown>>;
    expect(findings.some((finding) => finding.kind === "feasible_opportunity")).toBe(false);
    const overlap = findings.find((finding) => finding.kind === "known_overlap") as { overlapMinutes: number; participants: Array<{ ref: string; part: string }> };
    expect(overlap.overlapMinutes).toBe(20);
    // Walk (12:30–12:50) falls entirely inside the 12:00–1:00 PM event.
    expect(overlap.participants.map((item) => item.part)).toEqual(["all", "middle"]);
    expect(overlap.participants[0]!.ref).toBe(walk.ref);
  });

  it("keeps overlap participants out of recipe 1.1 model input", async () => {
    const generate = vi.fn().mockResolvedValue({ text: "Walk overlaps your meeting.", occurrenceRefs: [], suggestions: [], tip: null });
    await generateDailyBrief(context, { generate, now, signal: signal(), config: v11, analysis: { source } });
    const findings = JSON.parse(generate.mock.calls[0]![0].facts).plan.dayEvidence.findings as Array<Record<string, unknown>>;
    expect(findings.find((finding) => finding.kind === "known_overlap")).not.toHaveProperty("participants");
  });

  it("tells the model the tip's category", async () => {
    const generate = vi.fn().mockResolvedValue({ text: "", occurrenceRefs: [], suggestions: [], tip: null });
    await generateDailyBrief(context, { generate, now, signal: signal(), config: debtConfig(), analysis: { source } });
    expect(JSON.parse(generate.mock.calls[0]![0].facts).analysis.tip.category).toBe("logging");
  });
});

describe("recipe 1.2 output", () => {
  it("names the moved Behavior on its suggestion and lists names found in the text", async () => {
    const generate = vi.fn().mockImplementation(async ({ facts }: { facts: string }) => ({
      text: "Walk overlaps your meeting by 20 minutes.", occurrenceRefs: [walk.ref], tip: null,
      suggestions: [{ text: "This clears your meeting.", occurrenceRefs: [walk.ref], referenceIds: [], optionId: JSON.parse(facts).plan.options[0].id }],
    }));
    const briefing = await generateDailyBrief(context, { generate, now, signal: signal(), config: v12, analysis: { source } });
    expect(briefing.versions?.recipe).toBe("daily_brief@1.2");
    expect(briefing.suggestions?.[0]?.behavior).toBe("Walk");
    expect(briefing.behaviorNames).toEqual(["Walk"]);
    const visible = visibleDailyBriefText(briefing);
    expect(visible).toMatch(/New suggested time\nWalk: 12:30 PM–12:50 PM → [^\n]+\nGenerated/);
    // Move blocks carry no reason text, even when the model writes one.
    expect(briefing.suggestions?.[0]?.text).toBe("");
    expect(visible).not.toContain("Suggested time:");
  });

  it("accepts an empty move text under recipe 1.2 and still rejects it under recipe 1.1", async () => {
    const reply = (optionId: string) => ({ text: "Walk overlaps your meeting by 20 minutes.", occurrenceRefs: [walk.ref], tip: null,
      suggestions: [{ text: "", occurrenceRefs: [walk.ref], referenceIds: [], optionId }] });
    const generate = vi.fn().mockImplementation(async ({ facts }: { facts: string }) => reply(JSON.parse(facts).plan.options[0].id));
    expect((await generateDailyBrief(context, { generate, now, signal: signal(), config: v12, analysis: { source } })).suggestions?.[0]?.behavior).toBe("Walk");
    await expect(generateDailyBrief(context, { generate, now, signal: signal(), config: v11, analysis: { source } })).rejects.toThrow("advisor_unavailable");
  });

  it("accepts a tip-only quiet day and an empty brief, but only under recipe 1.2", async () => {
    const tipOnly = vi.fn().mockResolvedValue({ text: "", occurrenceRefs: [], suggestions: [],
      tip: { findingId: "tip", text: "Record a decision for Walk tonight.", noteRefs: [] } });
    const quietDebt = parseBriefingConfig({ ...debtConfig(), allowedSuggestionTypes: ["recap"] });
    const briefing = await generateDailyBrief(context, { generate: tipOnly, now, signal: signal(), config: quietDebt, analysis: { source } });
    expect(briefing.text).toBe("");
    expect(briefing.tip?.category).toBe("logging");
    expect(isEmptyBriefing(briefing)).toBe(false);

    const empty = vi.fn().mockResolvedValue({ text: "", occurrenceRefs: [], suggestions: [], tip: null });
    // With moves allowed, Cadence would add the Walk move itself; a recap-only day has nothing to show.
    const recapOnly = parseBriefingConfig({ ...v12, allowedSuggestionTypes: ["recap"] });
    expect(isEmptyBriefing(await generateDailyBrief(context, { generate: empty, now, signal: signal(), config: recapOnly, analysis: { source } }))).toBe(true);
    await expect(generateDailyBrief(context, { generate: empty, now, signal: signal(), config: v11, analysis: { source } })).rejects.toThrow("advisor_unavailable");
  });
});

describe("recipe 1.2 alongside Behaviors and moves", () => {
  const overlapReply = (suggestions: unknown[] = []) => ({ text: "All of Walk (12:30–12:50 PM) falls during your meeting, a 20-minute overlap.", occurrenceRefs: [walk.ref], suggestions, tip: null });

  it("asks about every unresolved Behavior and parses alongside only for recipe 1.2", () => {
    expect(selectDescriptionEstimateItems(context, v12, {}).map((item) => item.behaviorRef)).toEqual([walk.behaviorRef]);
    expect(selectDescriptionEstimateItems(context, v11, { [walk.behaviorRef]: "A walk." })).toEqual([]);
    const items = [{ behaviorRef: walk.behaviorRef, title: "Walk", description: "" }];
    const row = { behaviorRef: walk.behaviorRef, minutes: 20, basis: "inferred", alongside: true };
    expect(parseDescriptionEstimates({ estimates: [row] }, items, { alongside: true })).toEqual([row]);
    expect(parseDescriptionEstimates({ estimates: [row] }, items)).toEqual([]);
  });

  it("gives an alongside Behavior no move and keeps its overlap out of the model input", async () => {
    const estimate = vi.fn().mockResolvedValue({ estimates: [{ behaviorRef: walk.behaviorRef, minutes: 20, basis: "inferred", alongside: true }] });
    const generate = vi.fn().mockResolvedValue({ text: "", occurrenceRefs: [], suggestions: [], tip: null });
    const briefing = await generateDailyBrief(context, { generate, estimate, descriptions: {}, now, signal: signal(), config: v12, analysis: { source } });
    expect(estimate.mock.calls[0]![0].estimateVariant).toBe("alongside");
    const plan = JSON.parse(generate.mock.calls[0]![0].facts).plan;
    expect(plan.options).toEqual([]);
    expect(plan.dayEvidence.findings.some((finding: { kind: string }) => finding.kind === "known_overlap")).toBe(false);
    expect(briefing.suggestions).toEqual([]);
  });

  it("states why each move exists and shows a move the model skipped", async () => {
    const generate = vi.fn().mockResolvedValue(overlapReply());
    const briefing = await generateDailyBrief(context, { generate, now, signal: signal(), config: v12, analysis: { source } });
    const options = JSON.parse(generate.mock.calls[0]![0].facts).plan.options as Array<{ why: string }>;
    expect(options[0]!.why).toBe("overlap");
    expect(briefing.suggestions?.map((item) => [item.behavior, item.text])).toEqual([["Walk", ""]]);
  });

  it("writes the overview from each move's reason when the model leaves it empty", async () => {
    const generate = vi.fn().mockResolvedValue({ text: "", occurrenceRefs: [], suggestions: [], tip: null });
    const briefing = await generateDailyBrief(context, { generate, now, signal: signal(), config: v12, analysis: { source } });
    expect(briefing.text).toBe("Walk overlaps your 12:00 PM–1:00 PM calendar event by 20 minutes.");
    expect(briefing.behaviorNames).toEqual(["Walk"]);
  });
});

describe("recipe 1.2 fallback overview", () => {
  const move = (ref: string, startAt: string) => ({ id: ref, occurrenceRef: ref, intervals: {
    current: { startAt, endAt: startAt }, proposed: { startAt: "2026-11-01T18:00:00Z", endAt: "2026-11-01T18:10:00Z" },
  } }) as unknown as BriefingPlanOption;
  const titles: Record<string, string> = { a: "Daily Injections", b: "Physical Therapy", c: "Clean Invisalign", d: "Read" };
  const overview = (options: BriefingPlanOption[]) => briefingMoveOverview({ options, plan: { dayEvidence: { findings: [] } } as never,
    planningNow: "2026-11-01T17:25:00Z", timezone: "America/New_York", titleOf: (ref) => titles[ref] ?? null });

  it("combines moves whose time has passed into one sentence", () => {
    expect(overview([move("a", "2026-11-01T05:00:00Z"), move("b", "2026-11-01T14:00:00Z"), move("c", "2026-11-01T15:00:00Z")]))
      .toBe("Daily Injections, Physical Therapy and Clean Invisalign are still open from this morning.");
    expect(overview([move("b", "2026-11-01T14:00:00Z"), move("d", "2026-11-01T17:00:00Z")])).toBe("Physical Therapy and Read are still open from earlier today.");
    expect(overview([move("b", "2026-11-01T14:00:00Z")])).toBe("Physical Therapy was due at 9:00 AM and is still open.");
  });
});

describe("recipe 1.2 setup tip", () => {
  const unknownWalk = { ...walk, duration: { kind: "unknown" as const, reason: "insufficient_samples" as const, sampleCount: 0, lookbackDays: 90 as const } };
  const missing = { ...context, cadence: { ...context.cadence, occurrences: [unknownWalk] } };
  const quiet = () => vi.fn().mockResolvedValue({ text: "", occurrenceRefs: [], suggestions: [], tip: null });

  it("nudges for a missing length when no other tip is shown, only under recipe 1.2", async () => {
    const briefing = await generateDailyBrief(missing, { generate: quiet(), now, signal: signal(), config: v12, analysis: { source } });
    expect(briefing.tip).toMatchObject({ category: "setup", laneId: "setup-duration", text: "Add a typical length to Walk so Cadence can suggest times around it." });
    expect(briefingTipLabel(briefing.tip!)).toBe("Setup tip");
    expect(briefing.behaviorNames).toEqual(["Walk"]);
    const older = await generateDailyBrief(missing, { generate: vi.fn().mockResolvedValue({ text: "Walk is today.", occurrenceRefs: [], suggestions: [], tip: null }), now, signal: signal(), config: v11, analysis: { source } });
    expect(older.tip).toBeUndefined();
  });

  it("gives way to a model tip and skips Behaviors that have a length", async () => {
    const withTip = vi.fn().mockResolvedValue({ text: "", occurrenceRefs: [], suggestions: [], tip: { findingId: "tip", text: "Record a decision for Walk right after it.", noteRefs: [] } });
    expect((await generateDailyBrief(missing, { generate: withTip, now, signal: signal(), config: debtConfig(), analysis: { source } })).tip?.category).toBe("logging");
    expect(briefingSetupTip(context)).toBeNull();
    const later = { ...unknownWalk, ref: "occurrence_later", title: "Read", scheduledFor: "2026-11-01T20:00:00Z" };
    expect(briefingSetupTip({ ...missing, cadence: { ...missing.cadence, occurrences: [later, unknownWalk] } })?.text).toContain("Walk");
  });
});

describe("recipe 1.2 presentation", () => {
  const option = {
    intervals: {
      current: { startAt: "2026-11-01T17:30:00Z", endAt: "2026-11-01T17:50:00Z" },
      proposed: { startAt: "2026-11-01T18:10:00Z", endAt: "2026-11-01T18:30:00Z" },
    },
  } as BriefingPlanOption;

  it("shows the current and new times on one line", () => {
    expect(briefingMoveText(option, "America/New_York")).toBe("12:30 PM–12:50 PM → 1:10 PM–1:30 PM");
    expect(briefingMoveText(option, "America/New_York", true)).toMatch(/overlaps planned travel\.$/);
    expect(briefingSuggestionLabel({ text: "", occurrenceRefs: [], referenceIds: [], optionId: "o", option })).toBe("New suggested time");
    expect(briefingSuggestionLabel({ text: "", occurrenceRefs: [], referenceIds: [], optionId: null })).toBe("Suggestion");
  });

  it("finds whole-word Behavior names, longest first", () => {
    const titles = ["Read", "Read Book", "Walk", "Shower", ""];
    expect(briefingBehaviorNames(titles, ["Read Book after your Walk.", "Ready?"])).toEqual(["Read Book", "Walk"]);
    expect(briefingTextSegments("Read Book, then Read.", ["Read", "Read Book"])).toEqual([
      { text: "Read Book", behavior: true }, { text: ", then ", behavior: false }, { text: "Read", behavior: true }, { text: ".", behavior: false },
    ]);
    expect(briefingTextSegments("Walkway", ["Walk"])).toEqual([{ text: "Walkway", behavior: false }]);
    expect(briefingTextSegments("No names.", undefined)).toEqual([{ text: "No names.", behavior: false }]);
  });

  it("recognizes recipe 1.2 briefs as plain and laned", () => {
    const versions = (recipe: string) => ({ versions: { configuration: "", references: "", planner: "", pipeline: "", recipe } });
    expect(isPlainBriefing(versions("daily_brief@1.2"))).toBe(true);
    expect(isLaneBriefing(versions("daily_brief@1.2"))).toBe(true);
    expect(isLaneBriefing(versions("daily_brief@1.1"))).toBe(false);
  });
});
