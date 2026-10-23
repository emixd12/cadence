import type { AdvisorDayContextV1, AdvisorDuration, AdvisorOccurrence } from "../types/advisor-day-context";
import { isLaneRecipe, type BriefingConfig } from "../types/briefing-config";

/** Ticket 188 bounds. Descriptions are untrusted user text; Cadence trims and caps them. */
export const DESCRIPTION_DURATION_LIMITS = Object.freeze({
  behaviors: 20,
  descriptionChars: 1_000,
  minMinutes: 1,
  maxMinutes: 480,
});

export type DescriptionEstimateItem = Readonly<{ behaviorRef: string; title: string; description: string }>;

export type DescriptionEstimate = Readonly<{
  behaviorRef: string;
  minutes: number | null;
  /** "stated": the description gives the length. "inferred": the model judged a typical length. */
  basis: "stated" | "inferred";
  /** Recipe 1.2: the activity can usually happen during other activities. */
  alongside?: boolean;
}>;

/**
 * Behaviors that would otherwise have unknown duration today: unresolved, in scope,
 * without a known enabled source, and with a non-empty description.
 */
export function selectDescriptionEstimateItems(
  context: AdvisorDayContextV1,
  config: BriefingConfig,
  descriptions: Readonly<Record<string, string>>,
): DescriptionEstimateItem[] {
  if (!config.context.duration.includeDescriptionEstimate) return [];
  const scope = config.scope.behaviorRefs === "all" ? null : new Set(config.scope.behaviorRefs);
  const items = new Map<string, DescriptionEstimateItem>();
  for (const occurrence of context.cadence.occurrences) {
    if (occurrence.status !== "unresolved" || (scope && !scope.has(occurrence.behaviorRef)) || items.has(occurrence.behaviorRef)) continue;
    // Recipe 1.2 also asks about Behaviors with a recorded length, for `alongside`; the recorded length still wins.
    if (hasRecordedDuration(occurrence, config) && !isLaneRecipe(config.recipe)) continue;
    const description = descriptions[occurrence.behaviorRef]?.trim() ?? "";
    // Recipe 1.2 also estimates from the title alone (owner review, October 23).
    if (!description && !isLaneRecipe(config.recipe)) continue;
    items.set(occurrence.behaviorRef, {
      behaviorRef: occurrence.behaviorRef,
      title: occurrence.title,
      description: description.slice(0, DESCRIPTION_DURATION_LIMITS.descriptionChars),
    });
    if (items.size === DESCRIPTION_DURATION_LIMITS.behaviors) break;
  }
  return [...items.values()];
}

function hasRecordedDuration(occurrence: AdvisorOccurrence, config: BriefingConfig): boolean {
  const candidates = occurrence.durationCandidates;
  const configured = candidates ? candidates.configuredDefault : occurrence.duration.kind === "known" && occurrence.duration.source === "behavior_default" ? occurrence.duration : null;
  const historical = candidates ? candidates.historicalAverage : occurrence.duration;
  return Boolean((config.context.duration.includeConfiguredDefault && configured?.kind === "known") ||
    (config.context.duration.includeHistoricalAverage && historical.kind === "known" && historical.source === "completed_stopped_occurrence_mean"));
}

/** Accepts only well-formed estimates for requested Behaviors. Anything else is dropped, not repaired. */
export function parseDescriptionEstimates(value: unknown, items: readonly DescriptionEstimateItem[], options: Readonly<{ alongside?: boolean }> = {}): DescriptionEstimate[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const estimates = (value as Record<string, unknown>).estimates;
  if (!Array.isArray(estimates) || estimates.length > items.length) return [];
  const requested = new Set(items.map((item) => item.behaviorRef));
  const seen = new Set<string>();
  const accepted: DescriptionEstimate[] = [];
  for (const entry of estimates) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const row = entry as Record<string, unknown>;
    if (Object.keys(row).sort().join() !== (options.alongside ? "alongside,basis,behaviorRef,minutes" : "basis,behaviorRef,minutes")) continue;
    if (options.alongside && typeof row.alongside !== "boolean") continue;
    if (typeof row.behaviorRef !== "string" || !requested.has(row.behaviorRef) || seen.has(row.behaviorRef)) continue;
    if (row.basis !== "stated" && row.basis !== "inferred") continue;
    const minutes = row.minutes;
    if (minutes !== null && !(Number.isInteger(minutes) && (minutes as number) >= DESCRIPTION_DURATION_LIMITS.minMinutes && (minutes as number) <= DESCRIPTION_DURATION_LIMITS.maxMinutes)) continue;
    seen.add(row.behaviorRef);
    accepted.push({ behaviorRef: row.behaviorRef, minutes: minutes as number | null, basis: row.basis, ...(options.alongside ? { alongside: row.alongside as boolean } : {}) });
  }
  return accepted;
}

/** Adds each estimate as the lowest-priority duration candidate; configuration still selects. */
export function applyDescriptionEstimates(context: AdvisorDayContextV1, estimates: readonly DescriptionEstimate[]): AdvisorDayContextV1 {
  const byRef = new Map(estimates.filter((item) => item.minutes !== null).map((item) => [item.behaviorRef, item.minutes as number]));
  if (!byRef.size) return context;
  return {
    ...context,
    cadence: {
      ...context.cadence,
      occurrences: context.cadence.occurrences.map((occurrence) => {
        const minutes = byRef.get(occurrence.behaviorRef);
        if (minutes === undefined) return occurrence;
        const estimate: Extract<AdvisorDuration, { kind: "known" }> = { kind: "known", seconds: minutes * 60, source: "description_estimate", sampleCount: 0, lookbackDays: 90 };
        const candidates = occurrence.durationCandidates ?? {
          configuredDefault: occurrence.duration.kind === "known" && occurrence.duration.source === "behavior_default" ? occurrence.duration : null,
          historicalAverage: occurrence.duration.kind === "known" && occurrence.duration.source === "behavior_default"
            ? { kind: "unknown" as const, reason: "insufficient_samples" as const, sampleCount: 0, lookbackDays: 90 as const }
            : occurrence.duration,
        };
        return { ...occurrence, durationCandidates: { ...candidates, descriptionEstimate: estimate } };
      }),
    },
  };
}
