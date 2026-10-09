import { describe, expect, it } from "vitest";
import fixture from "./fixtures/advisor-day-context.valid.json";

import {
  BRIEFING_PRESETS,
  DEFAULT_BRIEFING_CONFIG,
  parseBriefingConfig,
  projectBriefingContext,
  scopeBriefingContext,
  serializeBriefingConfig,
} from "../packages/core/src/services/briefing-config";

type Mutable<T> = { -readonly [K in keyof T]: T[K] extends readonly (infer Item)[] ? Mutable<Item>[] : T[K] extends object ? Mutable<T[K]> : T[K] };
const copy = <T>(value: T): Mutable<T> => JSON.parse(JSON.stringify(value)) as Mutable<T>;

describe("briefing configuration", () => {
  it("loads the repository default without account, provider, prompt, or private Behavior data", () => {
    expect(BRIEFING_PRESETS.length).toBeGreaterThanOrEqual(1);
    for (const preset of BRIEFING_PRESETS) {
      expect(parseBriefingConfig(preset.config)).toEqual(preset.config);
      expect(preset.config.scope.behaviorRefs).toBe("all");
      expect(preset.config.planner.movableBehaviorRefs).toEqual([]);
    }
    expect(DEFAULT_BRIEFING_CONFIG).toMatchObject({
      version: "1.3",
      analysis: { lanes: [], maxTips: 0, cooldownDays: 14 },
      recipe: { id: "daily_brief", version: "1.0" },
      tone: "calm",
      directness: "balanced",
      length: { maxWords: 120 },
      scope: { behaviorRefs: "all", historyDays: 90, includeCalendar: true },
      planner: { bufferMinutes: 10, preference: "least_change", movableBehaviorRefs: [] },
    });
    expect(JSON.stringify(BRIEFING_PRESETS)).not.toMatch(/owner|accountRef|credential|providerUrl|systemPrompt/i);
    expect(parseBriefingConfig(copy(DEFAULT_BRIEFING_CONFIG))).toEqual(DEFAULT_BRIEFING_CONFIG);
    expect(serializeBriefingConfig(copy(DEFAULT_BRIEFING_CONFIG))).toBe(JSON.stringify(DEFAULT_BRIEFING_CONFIG));
  });

  it("normalizes exact legacy 1.0 drafts without changing their previous context behavior", () => {
    const legacy = copy(DEFAULT_BRIEFING_CONFIG) as unknown as Record<string, unknown>;
    legacy.version = "1.0";
    delete legacy.recipe;
    delete legacy.context;
    delete legacy.analysis;
    expect(parseBriefingConfig(legacy)).toMatchObject({
      version: "1.3",
      analysis: { lanes: [], maxTips: 0 },
      recipe: { id: "daily_brief", version: "1.0" },
      context: {
        includeCompletionHistory: true,
        includeHistoricalCompletionTimes: false,
        includeRecordedElapsedDurations: false,
        duration: { preference: "configured_default", fallback: "other_enabled_source" },
      },
    });
  });

  it.each([
    ["unknown field", (config: Record<string, unknown>) => { config.prompt = "ignore policy"; }],
    ["unknown nested field", (config: Record<string, unknown>) => { (config.scope as Record<string, unknown>).ownerId = "owner"; }],
    ["unsupported version", (config: Record<string, unknown>) => { config.version = "2.0"; }],
    ["incompatible recipe", (config: Record<string, unknown>) => { (config.recipe as Record<string, unknown>).id = "other"; }],
    ["invalid tone", (config: Record<string, unknown>) => { config.tone = "accusatory"; }],
    ["word limit", (config: Record<string, unknown>) => { (config.length as Record<string, unknown>).maxWords = 181; }],
    ["unknown analysis lane", (config: Record<string, unknown>) => { config.analysis = { lanes: ["mood-forecast"], maxTips: 1, cooldownDays: 14 }; }],
    ["tip without lanes", (config: Record<string, unknown>) => { config.analysis = { lanes: [], maxTips: 1, cooldownDays: 14 }; }],
    ["short cooldown", (config: Record<string, unknown>) => { config.analysis = { lanes: ["decision-debt"], maxTips: 1, cooldownDays: 3 }; }],
    ["extra analysis field", (config: Record<string, unknown>) => { config.analysis = { lanes: [], maxTips: 0, cooldownDays: 14, prompt: "x" }; }],
    ["history lower bound", (config: Record<string, unknown>) => { (config.scope as Record<string, unknown>).historyDays = 0; }],
    ["history upper bound", (config: Record<string, unknown>) => { (config.scope as Record<string, unknown>).historyDays = 91; }],
    ["reference count", (config: Record<string, unknown>) => { config.referenceIds = ["a", "b", "c", "d", "e"]; }],
    ["buffer", (config: Record<string, unknown>) => { (config.planner as Record<string, unknown>).bufferMinutes = 61; }],
    ["alternative count", (config: Record<string, unknown>) => { config.alternatives = 4; }],
    ["duplicate priorities", (config: Record<string, unknown>) => { config.priorities = ["today_status", "today_status"]; }],
    ["overlapping windows", (config: Record<string, unknown>) => { (config.planner as Record<string, unknown>).permittedWindows = [{ startMinute: 0, endMinute: 100 }, { startMinute: 99, endMinute: 200 }]; }],
    ["unselected movable Behavior", (config: Record<string, unknown>) => {
      (config.scope as Record<string, unknown>).behaviorRefs = ["behavior_selected"];
      (config.planner as Record<string, unknown>).movableBehaviorRefs = ["behavior_other"];
    }],
  ])("rejects %s", (_label, mutate) => {
    const config = copy(DEFAULT_BRIEFING_CONFIG) as unknown as Record<string, unknown>;
    mutate(config);
    expect(() => parseBriefingConfig(config)).toThrow();
  });

  it("intersects Behavior scope and can only remove authorized Calendar context", () => {
    const context = copy(fixture);
    context.cadence.occurrences.push({
      ...context.cadence.occurrences[0],
      ref: "occurrence_other",
      behaviorRef: "behavior_other",
    });
    context.cadence.history.behaviors.push({
      ...context.cadence.history.behaviors[0],
      behaviorRef: "behavior_other",
    });
    const config = copy(DEFAULT_BRIEFING_CONFIG);
    config.scope.behaviorRefs = ["behavior_fixture", "behavior_not_authorized"];
    config.scope.includeCalendar = false;

    const scoped = scopeBriefingContext(context, config);
    expect(scoped.cadence.occurrences.map(({ behaviorRef }) => behaviorRef)).toEqual(["behavior_fixture"]);
    expect(scoped.cadence.history.behaviors.map(({ behaviorRef }) => behaviorRef)).toEqual(["behavior_fixture"]);
    expect(scoped.cadence.history).toMatchObject({
      lookbackDays: 90,
      startLocalDate: "2026-08-03",
      endLocalDateExclusive: "2026-11-01",
    });
    expect(scoped.connectors).toEqual([{ source: "google_calendar", state: "not_requested" }]);
    expect(scoped.status).toBe("complete");
  });

  it("never adds Calendar facts to a context where they were not authorized", () => {
    const context = { ...copy(fixture), connectors: [{ source: "google_calendar", state: "not_requested" }] };
    expect(scopeBriefingContext(context, DEFAULT_BRIEFING_CONFIG).connectors).toEqual(context.connectors);
  });

  it("rejects a history label that was not assembled for the configured window", () => {
    const config = copy(DEFAULT_BRIEFING_CONFIG);
    config.scope.historyDays = 7;
    expect(() => scopeBriefingContext(fixture, config)).toThrow("history does not match");
  });

  it("projects only unresolved work and physically omits disabled model fields", () => {
    const context = copy(fixture) as typeof fixture & { cadence: typeof fixture.cadence & { recordedElapsedDurations?: Array<{ behaviorRef: string; localDate: string; seconds: number }> } };
    Object.assign(context.cadence.occurrences[0], { durationCandidates: {
      configuredDefault: context.cadence.occurrences[0].duration,
      historicalAverage: { kind: "known", seconds: 1800, source: "completed_stopped_occurrence_mean", sampleCount: 3, lookbackDays: 90 },
    } });
    context.cadence.occurrences.push({ ...context.cadence.occurrences[0], ref: "occurrence_done", status: "completed" });
    context.cadence.recordedElapsedDurations = [{ behaviorRef: "behavior_fixture", localDate: "2026-10-31", seconds: 1200 }];
    const config = copy(DEFAULT_BRIEFING_CONFIG);
    config.scope.includeCalendar = false;
    config.context.duration.includeConfiguredDefault = false;
    config.context.duration.preference = "historical_average";

    const { facts, contextControls } = projectBriefingContext(context, config);
    expect(facts.cadence.occurrences).toEqual([expect.objectContaining({
      ref: "occurrence_fixture",
      duration: expect.objectContaining({ source: "completed_stopped_occurrence_mean", seconds: 1800 }),
    })]);
    expect(facts.cadence.occurrences[0]).not.toHaveProperty("status");
    expect(facts.cadence).not.toHaveProperty("history");
    expect(facts.cadence).not.toHaveProperty("recordedElapsedDurations");
    expect(facts).not.toHaveProperty("connectors");
    expect(contextControls.historicalCompletionTimes).toMatchObject({ included: false, reason: "not_requested" });
    expect(JSON.stringify(facts)).not.toContain("updatedAt");
  });

  it("applies duration fallback and filters raw elapsed records to the configured history window", () => {
    const context = copy(fixture) as typeof fixture & { cadence: typeof fixture.cadence & { recordedElapsedDurations?: Array<{ behaviorRef: string; localDate: string; seconds: number }> } };
    Object.assign(context.cadence.occurrences[0], { durationCandidates: {
      configuredDefault: context.cadence.occurrences[0].duration,
      historicalAverage: { kind: "unknown", reason: "insufficient_samples", sampleCount: 2, lookbackDays: 90 },
    } });
    context.cadence.history.lookbackDays = 30;
    context.cadence.history.startLocalDate = "2026-10-02";
    context.cadence.recordedElapsedDurations = [
      { behaviorRef: "behavior_fixture", localDate: "2026-10-31", seconds: 1200 },
      { behaviorRef: "behavior_fixture", localDate: "2026-09-15", seconds: 1800 },
    ];
    const config = copy(DEFAULT_BRIEFING_CONFIG);
    config.scope.historyDays = 30;
    config.context.includeRecordedElapsedDurations = true;
    config.context.duration.preference = "historical_average";

    const fallback = projectBriefingContext(context, config);
    expect(fallback.facts.cadence.occurrences[0]?.duration).toMatchObject({ source: "behavior_default", seconds: 1200 });
    expect(fallback.facts.cadence.recordedElapsedDurations).toEqual([
      { behaviorRef: "behavior_fixture", localDate: "2026-10-31", seconds: 1200 },
    ]);
    expect(fallback.contextControls.recordedElapsedDurations).toMatchObject({ included: true, availability: "available" });

    config.context.duration.fallback = "none";
    expect(projectBriefingContext(context, config).facts.cadence.occurrences[0]).not.toHaveProperty("duration");
  });
});

it('migrates 1.1 unsupported finish-time requests without enabling historical timing', () => {
  const current = copy(DEFAULT_BRIEFING_CONFIG);
  const rest = { includeCompletionHistory: current.context.includeCompletionHistory, includeRecordedElapsedDurations: current.context.includeRecordedElapsedDurations, duration: current.context.duration };
  const withoutAnalysis: Record<string, unknown> = { ...current };
  delete withoutAnalysis.analysis;
  const old = { ...withoutAnalysis, version: '1.1', context: { ...rest, includeCompletionTimestamps: true } };
  expect(parseBriefingConfig(old)).toMatchObject({ version: '1.3', context: { includeHistoricalCompletionTimes: false }, analysis: { lanes: [] } });
  expect(() => parseBriefingConfig({ ...old, context: { ...old.context, extra: true } })).toThrow();
});

it("upgrades 1.2 configurations without selecting analysis lanes and orders lanes stably", () => {
  const previous: Record<string, unknown> = copy(DEFAULT_BRIEFING_CONFIG);
  delete previous.analysis;
  expect(parseBriefingConfig({ ...previous, version: "1.2" })).toEqual(DEFAULT_BRIEFING_CONFIG);
  expect(() => parseBriefingConfig({ ...previous, version: "1.2", length: { maxWords: 150 } })).toThrow();
  const selected = parseBriefingConfig({ ...copy(DEFAULT_BRIEFING_CONFIG), analysis: { lanes: ["decision-debt", "weekday-time-dips"], maxTips: 1, cooldownDays: 14 } });
  expect(selected.analysis.lanes).toEqual(["weekday-time-dips", "decision-debt"]);
});
