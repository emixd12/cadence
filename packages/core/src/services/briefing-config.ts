import rawPresets from "../data/briefing-presets.json";
import {
  BRIEFING_CONFIG_VERSION,
  DAILY_BRIEF_RECIPE,
  LEGACY_BRIEFING_CONFIG_VERSION,
  type BriefingConfig,
  type BriefingContextConfig,
  type BriefingContextControlState,
  type BriefingContextProjection,
  type BriefingDirectness,
  type BriefingEncouragement,
  type BriefingPreset,
  type BriefingPriority,
  type BriefingSuggestionType,
  type BriefingTone,
} from "../types/briefing-config";
import type { AdvisorDayContextV1 } from "../types/advisor-day-context";
import { BRIEFING_ANALYSIS_LANE_IDS, type BriefingAnalysisLaneId } from "../types/briefing-analysis";
import type { BriefingAnalysisConfig } from "../types/briefing-config";
import type { AdvisorDuration, AdvisorOccurrence } from "../types/advisor-day-context";
import { validateAdvisorDayContext } from "./advisor-day-context";

const TONES: readonly BriefingTone[] = ["calm", "warm", "matter_of_fact"];
const DIRECTNESS: readonly BriefingDirectness[] = ["gentle", "balanced", "direct"];
const ENCOURAGEMENT: readonly BriefingEncouragement[] = ["low", "moderate", "high"];
const PRIORITIES: readonly BriefingPriority[] = ["today_status", "needs_decision", "completion_history", "schedule_fit"];
const SUGGESTION_TYPES: readonly BriefingSuggestionType[] = ["recap", "priority", "schedule"];

export class BriefingConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BriefingConfigValidationError";
  }
}

export function parseBriefingConfig(value: unknown): BriefingConfig {
  const supplied = record(value, "configuration");
  const legacy = supplied.version === LEGACY_BRIEFING_CONFIG_VERSION && !("recipe" in supplied) && !("context" in supplied);
  const current = supplied.version === BRIEFING_CONFIG_VERSION;
  exactKeys(supplied, legacy
    ? ["version", "tone", "directness", "encouragement", "length", "priorities", "allowedSuggestionTypes", "alternatives", "scope", "referenceIds", "planner"]
    : ["version", "recipe", "tone", "directness", "encouragement", "length", "priorities", "allowedSuggestionTypes", "alternatives", "scope", "context", ...(current ? ["analysis"] : []), "referenceIds", "planner"], "configuration");
  // Configurations before 1.3 select no analysis lanes, preserving their behavior.
  const analysisValue = current ? supplied.analysis : { lanes: [], maxTips: 0, cooldownDays: 14 };
  const previous = supplied.version === "1.1";
  if (previous) {
    const oldContext = record(supplied.context, "configuration.context");
    exactKeys(oldContext, ["includeCompletionHistory", "includeCompletionTimestamps", "includeRecordedElapsedDurations", "duration"], "configuration.context");
    if (typeof oldContext.includeCompletionTimestamps !== "boolean") fail("Legacy timestamp selection must be a boolean.");
  }
  const config = legacy ? {
    ...supplied,
    version: BRIEFING_CONFIG_VERSION,
    recipe: DAILY_BRIEF_RECIPE,
    context: legacyContext(),
  } : previous ? {
    ...supplied, version: BRIEFING_CONFIG_VERSION,
    context: {
      includeCompletionHistory: (supplied.context as Record<string, unknown>).includeCompletionHistory,
      includeHistoricalCompletionTimes: false,
      includeRecordedElapsedDurations: (supplied.context as Record<string, unknown>).includeRecordedElapsedDurations,
      duration: (supplied.context as Record<string, unknown>).duration,
    },
  } : supplied.version === "1.2" ? { ...supplied, version: BRIEFING_CONFIG_VERSION } : supplied;
  if (config.version !== BRIEFING_CONFIG_VERSION) fail("configuration.version is unsupported.");
  const recipe = record(config.recipe, "configuration.recipe");
  exactKeys(recipe, ["id", "version"], "configuration.recipe");
  if (recipe.id !== DAILY_BRIEF_RECIPE.id || recipe.version !== DAILY_BRIEF_RECIPE.version) {
    fail("configuration.recipe is incompatible with this configuration.");
  }
  const tone = oneOf(config.tone, TONES, "configuration.tone");
  const directness = oneOf(config.directness, DIRECTNESS, "configuration.directness");
  const encouragement = oneOf(config.encouragement, ENCOURAGEMENT, "configuration.encouragement");

  const length = record(config.length, "configuration.length");
  exactKeys(length, ["maxWords"], "configuration.length");
  const analysis = parseAnalysis(analysisValue);
  // Findings need room for an action and its reason; 1.3 raises the ceiling for calibration.
  const maxWords = integer(length.maxWords, "configuration.length.maxWords", 40, current ? 180 : 120);

  const priorities = uniqueEnums(config.priorities, PRIORITIES, "configuration.priorities", 1, PRIORITIES.length);
  const allowedSuggestionTypes = uniqueEnums(config.allowedSuggestionTypes, SUGGESTION_TYPES, "configuration.allowedSuggestionTypes", 1, SUGGESTION_TYPES.length);
  const alternatives = integer(config.alternatives, "configuration.alternatives", 1, 3);

  const scope = record(config.scope, "configuration.scope");
  exactKeys(scope, ["behaviorRefs", "historyDays", "includeCalendar"], "configuration.scope");
  const behaviorRefs = scope.behaviorRefs === "all"
    ? "all" as const
    : uniqueRefs(scope.behaviorRefs, "configuration.scope.behaviorRefs", 100);
  const historyDays = integer(scope.historyDays, "configuration.scope.historyDays", 1, 90);
  if (typeof scope.includeCalendar !== "boolean") fail("configuration.scope.includeCalendar must be a boolean.");

  const context = parseContext(config.context);

  const referenceIds = uniqueIds(config.referenceIds, "configuration.referenceIds", 4);
  const planner = record(config.planner, "configuration.planner");
  exactKeys(planner, ["bufferMinutes", "preference", "movableBehaviorRefs", "permittedWindows"], "configuration.planner");
  const bufferMinutes = integer(planner.bufferMinutes, "configuration.planner.bufferMinutes", 0, 60);
  if (planner.preference !== "earliest" && planner.preference !== "least_change") fail("configuration.planner.preference is invalid.");
  const movableBehaviorRefs = uniqueRefs(planner.movableBehaviorRefs, "configuration.planner.movableBehaviorRefs", 100);
  if (behaviorRefs !== "all" && movableBehaviorRefs.some((ref) => !behaviorRefs.includes(ref))) {
    fail("Movable Behavior refs must be selected by configuration.scope.behaviorRefs.");
  }
  const permittedWindows = parseWindows(planner.permittedWindows);

  return {
    version: BRIEFING_CONFIG_VERSION,
    recipe: DAILY_BRIEF_RECIPE,
    tone,
    directness,
    encouragement,
    length: { maxWords },
    priorities,
    allowedSuggestionTypes,
    alternatives,
    scope: { behaviorRefs, historyDays, includeCalendar: scope.includeCalendar },
    context,
    analysis,
    referenceIds,
    planner: { bufferMinutes, preference: planner.preference, movableBehaviorRefs, permittedWindows },
  };
}

function parseAnalysis(value: unknown): BriefingAnalysisConfig {
  const analysis = record(value, "configuration.analysis");
  exactKeys(analysis, ["lanes", "maxTips", "cooldownDays"], "configuration.analysis");
  const lanes = uniqueEnums<BriefingAnalysisLaneId>(analysis.lanes, BRIEFING_ANALYSIS_LANE_IDS, "configuration.analysis.lanes", 0, BRIEFING_ANALYSIS_LANE_IDS.length);
  if (analysis.maxTips !== 0 && analysis.maxTips !== 1) fail("configuration.analysis.maxTips must be 0 or 1.");
  if (analysis.maxTips === 1 && lanes.length === 0) fail("configuration.analysis.maxTips needs at least one selected lane.");
  const cooldownDays = integer(analysis.cooldownDays, "configuration.analysis.cooldownDays", 7, 30);
  // Keep a stable lane order so equivalent selections share a configuration revision.
  return { lanes: BRIEFING_ANALYSIS_LANE_IDS.filter((id) => lanes.includes(id)), maxTips: analysis.maxTips, cooldownDays };
}

export function serializeBriefingConfig(value: unknown): string {
  return JSON.stringify(parseBriefingConfig(value));
}

export function scopeBriefingContext(contextValue: unknown, configValue: unknown): AdvisorDayContextV1 {
  const context = validateAdvisorDayContext(contextValue);
  const config = parseBriefingConfig(configValue);
  if (context.cadence.history.lookbackDays !== config.scope.historyDays) {
    fail("Briefing context history does not match configuration.scope.historyDays.");
  }
  const selected = config.scope.behaviorRefs === "all" ? null : new Set(config.scope.behaviorRefs);
  const connectors = config.scope.includeCalendar
    ? context.connectors
    : [{ source: "google_calendar" as const, state: "not_requested" as const }];
  return validateAdvisorDayContext({
    ...context,
    status: config.scope.includeCalendar ? context.status : "complete",
    cadence: {
      observedAt: context.cadence.observedAt,
      revision: context.cadence.revision,
      coverage: context.cadence.coverage,
      occurrences: (selected ? context.cadence.occurrences.filter(({ behaviorRef }) => selected.has(behaviorRef)) : context.cadence.occurrences)
        .map((occurrence) => {
          return {
            ref: occurrence.ref,
            behaviorRef: occurrence.behaviorRef,
            title: occurrence.title,
            status: occurrence.status,
            localDate: occurrence.localDate,
            scheduledFor: occurrence.scheduledFor,
            schedule: occurrence.schedule,
            duration: selectDuration(occurrence, config).duration,
          };
        }),
      history: {
        ...context.cadence.history,
        behaviors: selected ? context.cadence.history.behaviors.filter(({ behaviorRef }) => selected.has(behaviorRef)) : context.cadence.history.behaviors,
      },
      ...(config.context.includeHistoricalCompletionTimes && context.cadence.historicalCompletionTimes ? {
        historicalCompletionTimes: {
          ...context.cadence.historicalCompletionTimes,
          behaviors: context.cadence.historicalCompletionTimes.behaviors.filter(({ behaviorRef }) => !selected || selected.has(behaviorRef)),
        },
      } : {}),
      ...(config.context.includeRecordedElapsedDurations && context.cadence.recordedElapsedDurations ? {
        recordedElapsedDurations: selected
          ? context.cadence.recordedElapsedDurations.filter(({ behaviorRef }) => selected.has(behaviorRef))
          : context.cadence.recordedElapsedDurations,
      } : {}),
    },
    connectors,
  });
}

export function projectBriefingContext(contextValue: unknown, configValue: unknown): BriefingContextProjection {
  const config = parseBriefingConfig(configValue);
  const sourceContext = validateAdvisorDayContext(contextValue);
  const context = scopeBriefingContext(contextValue, config);
  const selectedRefs = config.scope.behaviorRefs === "all" ? null : new Set(config.scope.behaviorRefs);
  const sourceOccurrences = selectedRefs
    ? sourceContext.cadence.occurrences.filter(({ behaviorRef }) => selectedRefs.has(behaviorRef))
    : sourceContext.cadence.occurrences;
  const selections = [...new Map(sourceOccurrences.map((occurrence) => {
    const selected = selectDuration(occurrence, config);
    return [occurrence.behaviorRef, {
      behaviorRef: occurrence.behaviorRef,
      source: selected.source,
      sampleCount: selected.duration.sampleCount,
      reason: selected.reason,
    }] as const;
  })).values()];
  const unresolved = sourceOccurrences.filter(({ status }) => status === "unresolved");
  const occurrences = unresolved.map((occurrence) => {
    const selected = selectDuration(occurrence, config);
    const fact = {
      ref: occurrence.ref,
      behaviorRef: occurrence.behaviorRef,
      title: occurrence.title,
      localDate: occurrence.localDate,
      scheduledFor: occurrence.scheduledFor,
      schedule: occurrence.schedule,
    };
    return selected.source ? { ...fact, duration: selected.duration } : fact;
  });
  const calendar = context.connectors[0];
  const calendarIncluded = Boolean(calendar && calendar.state !== "not_requested");
  const calendarAvailable = Boolean(calendarIncluded && calendar && "complete" in calendar && calendar.complete);
  const selectedBehaviors = new Set(context.cadence.history.behaviors.map(({ behaviorRef }) => behaviorRef));
  const recorded = (sourceContext.cadence.recordedElapsedDurations ?? []).filter(({ behaviorRef, localDate }) =>
    selectedBehaviors.has(behaviorRef) && localDate >= context.cadence.history.startLocalDate && localDate < context.cadence.history.endLocalDateExclusive);
  const recordedIncluded = config.context.includeRecordedElapsedDurations && recorded.length > 0;
  const facts = {
    version: context.version,
    snapshotId: context.snapshotId,
    accountRef: context.accountRef,
    localDate: context.localDate,
    timezone: context.timezone,
    dayStartAt: context.dayStartAt,
    dayEndAt: context.dayEndAt,
    capturedAt: context.capturedAt,
    expiresAt: context.expiresAt,
    status: context.status,
    authority: context.authority,
    grantGeneration: context.grantGeneration,
    cadence: {
      observedAt: context.cadence.observedAt,
      revision: context.cadence.revision,
      coverage: context.cadence.coverage,
      occurrences,
      ...(config.context.includeCompletionHistory ? { history: context.cadence.history } : {}),
      ...(context.cadence.historicalCompletionTimes ? { historicalCompletionTimes: context.cadence.historicalCompletionTimes } : {}),
      ...(recordedIncluded ? {
        recordedElapsedDurations: recorded,
      } : {}),
    },
    ...(config.scope.includeCalendar && calendarIncluded ? { connectors: context.connectors } : {}),
  };
  return {
    facts,
    contextControls: {
      calendar: control(config.scope.includeCalendar, config.scope.includeCalendar && calendarIncluded, calendarAvailable ? "available" : "unavailable"),
      completionHistory: control(config.context.includeCompletionHistory, config.context.includeCompletionHistory, context.cadence.history.completeness === "complete" ? "available" : "unavailable"),
      historicalCompletionTimes: control(config.context.includeHistoricalCompletionTimes,
        Boolean(context.cadence.historicalCompletionTimes),
        context.cadence.historicalCompletionTimes && context.cadence.historicalCompletionTimes.behaviors.every(item => item.reason !== "source_unavailable" && item.reason !== "history_limit_exceeded") ? "available" : "unavailable"),
      recordedElapsedDurations: control(config.context.includeRecordedElapsedDurations, recordedIncluded, recorded.length > 0 ? "available" : "unavailable"),
      duration: {
        preference: config.context.duration.preference,
        fallback: config.context.duration.fallback,
        configuredDefault: { requested: config.context.duration.includeConfiguredDefault },
        historicalAverage: { requested: config.context.duration.includeHistoricalAverage },
        selections,
      },
    },
  };
}

function parseContext(value: unknown): BriefingContextConfig {
  const context = record(value, "configuration.context");
  exactKeys(context, ["includeCompletionHistory", "includeHistoricalCompletionTimes", "includeRecordedElapsedDurations", "duration"], "configuration.context");
  for (const key of ["includeCompletionHistory", "includeHistoricalCompletionTimes", "includeRecordedElapsedDurations"] as const) {
    if (typeof context[key] !== "boolean") fail(`configuration.context.${key} must be a boolean.`);
  }
  const duration = record(context.duration, "configuration.context.duration");
  exactKeys(duration, ["includeHistoricalAverage", "includeConfiguredDefault", "preference", "fallback"], "configuration.context.duration");
  if (typeof duration.includeHistoricalAverage !== "boolean" || typeof duration.includeConfiguredDefault !== "boolean") {
    fail("configuration.context.duration source controls must be booleans.");
  }
  if (duration.preference !== "configured_default" && duration.preference !== "historical_average") {
    fail("configuration.context.duration.preference is invalid.");
  }
  if (duration.fallback !== "other_enabled_source" && duration.fallback !== "none") {
    fail("configuration.context.duration.fallback is invalid.");
  }
  return {
    includeCompletionHistory: context.includeCompletionHistory as boolean,
    includeHistoricalCompletionTimes: context.includeHistoricalCompletionTimes as boolean,
    includeRecordedElapsedDurations: context.includeRecordedElapsedDurations as boolean,
    duration: {
      includeHistoricalAverage: duration.includeHistoricalAverage,
      includeConfiguredDefault: duration.includeConfiguredDefault,
      preference: duration.preference,
      fallback: duration.fallback,
    },
  };
}

function legacyContext(): BriefingContextConfig {
  return {
    includeCompletionHistory: true,
    includeHistoricalCompletionTimes: false,
    includeRecordedElapsedDurations: false,
    duration: {
      includeHistoricalAverage: true,
      includeConfiguredDefault: true,
      preference: "configured_default",
      fallback: "other_enabled_source",
    },
  };
}

function selectDuration(occurrence: AdvisorOccurrence, config: BriefingConfig): Readonly<{
  duration: AdvisorDuration;
  source: "configured_default" | "historical_average" | null;
  reason: "disabled" | "insufficient_samples" | "history_limit_exceeded" | "unavailable" | null;
}> {
  const candidates = occurrence.durationCandidates ?? {
    configuredDefault: occurrence.duration.kind === "known" && occurrence.duration.source === "behavior_default" ? occurrence.duration : null,
    historicalAverage: occurrence.duration.kind === "known" && occurrence.duration.source === "completed_stopped_occurrence_mean"
      ? occurrence.duration
      : occurrence.duration.kind === "unknown" ? occurrence.duration : { kind: "unknown" as const, reason: "insufficient_samples" as const, sampleCount: 0, lookbackDays: 90 as const },
  };
  const enabled = {
    configured_default: config.context.duration.includeConfiguredDefault,
    historical_average: config.context.duration.includeHistoricalAverage,
  };
  const candidate = (source: "configured_default" | "historical_average") => source === "configured_default"
    ? candidates.configuredDefault
    : candidates.historicalAverage;
  const preferred = config.context.duration.preference;
  const alternative = preferred === "configured_default" ? "historical_average" : "configured_default";
  const sources = config.context.duration.fallback === "other_enabled_source" ? [preferred, alternative] as const : [preferred] as const;
  for (const source of sources) {
    if (!enabled[source]) continue;
    const value = candidate(source);
    if (value?.kind === "known") return { duration: value, source, reason: null };
  }
  const requested = sources.find((source) => enabled[source] && candidate(source)) ?? sources.find((source) => enabled[source]);
  const unavailable = requested ? candidate(requested) : null;
  const reason = unavailable?.kind === "unknown" ? unavailable.reason : requested ? "unavailable" : "disabled";
  return {
    duration: unavailable?.kind === "unknown" ? unavailable : { kind: "unknown", reason: "insufficient_samples", sampleCount: 0, lookbackDays: 90 },
    source: null,
    reason,
  };
}

function control(
  requested: boolean,
  included: boolean,
  availability: "available" | "unavailable",
): BriefingContextControlState {
  return {
    requested,
    included,
    availability,
    reason: requested ? (availability === "available" ? null : "source_unavailable") : "not_requested",
  };
}

function parsePreset(value: unknown): BriefingPreset {
  const preset = record(value, "preset");
  exactKeys(preset, ["id", "label", "config"], "preset");
  return {
    id: stableId(preset.id, "preset.id"),
    label: text(preset.label, "preset.label", 80),
    config: parseBriefingConfig(preset.config),
  };
}

export const BRIEFING_PRESETS: readonly BriefingPreset[] = rawPresets.map(parsePreset);
if (new Set(BRIEFING_PRESETS.map(preset => preset.id)).size !== BRIEFING_PRESETS.length) fail("Preset IDs must be unique.");
export const DEFAULT_BRIEFING_CONFIG: BriefingConfig = BRIEFING_PRESETS.find((preset) => preset.id === "cadence-default")?.config ?? fail("A default briefing preset is required.");

function parseWindows(value: unknown): Array<{ startMinute: number; endMinute: number }> {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4) fail("configuration.planner.permittedWindows must contain 1 to 4 windows.");
  const windows = value.map((item, index) => {
    const interval = record(item, `configuration.planner.permittedWindows[${index}]`);
    exactKeys(interval, ["startMinute", "endMinute"], `configuration.planner.permittedWindows[${index}]`);
    const startMinute = integer(interval.startMinute, `configuration.planner.permittedWindows[${index}].startMinute`, 0, 1439);
    const endMinute = integer(interval.endMinute, `configuration.planner.permittedWindows[${index}].endMinute`, 1, 1440);
    if (endMinute <= startMinute) fail("Planner windows must end after they start.");
    return { startMinute, endMinute };
  });
  for (let index = 1; index < windows.length; index += 1) {
    if (windows[index - 1].endMinute > windows[index].startMinute) fail("Planner windows must be ordered and non-overlapping.");
  }
  return windows;
}

function uniqueEnums<T extends string>(value: unknown, allowed: readonly T[], label: string, min: number, max: number): T[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(`${label} has an invalid length.`);
  const values = value.map((item) => oneOf(item, allowed, label));
  if (new Set(values).size !== values.length) fail(`${label} must be unique.`);
  return values;
}

function uniqueRefs(value: unknown, label: string, max: number): string[] {
  if (!Array.isArray(value) || value.length > max) fail(`${label} has an invalid length.`);
  const refs = value.map((item) => {
    const ref = text(item, label, 256);
    if (!/^behavior_[A-Za-z0-9_-]+$/.test(ref)) fail(`${label} contains an invalid Behavior ref.`);
    return ref;
  });
  if (new Set(refs).size !== refs.length) fail(`${label} must be unique.`);
  return refs;
}

function uniqueIds(value: unknown, label: string, max: number): string[] {
  if (!Array.isArray(value) || value.length > max) fail(`${label} has an invalid length.`);
  const ids = value.map((item) => stableId(item, label));
  if (new Set(ids).size !== ids.length) fail(`${label} must be unique.`);
  return ids;
}

function stableId(value: unknown, label: string): string {
  const id = text(value, label, 64);
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(id)) fail(`${label} is invalid.`);
  return id;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) fail(`${label} is invalid.`);
  return value as T;
}

function integer(value: unknown, label: string, min: number, max: number): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) fail(`${label} must be a whole number from ${min} to ${max}.`);
  return value as number;
}

function text(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) fail(`${label} is invalid.`);
  return value;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const expected = [...keys].sort();
  const actual = Object.keys(value).sort();
  if (expected.length !== actual.length || expected.some((key, index) => key !== actual[index])) fail(`${label} must contain exactly: ${keys.join(", ")}.`);
}

function fail(message: string): never {
  throw new BriefingConfigValidationError(message);
}
