import { DAILY_BRIEF_POLICY_VERSION } from "@cadence/core/types/daily-brief";
import { createHash } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import { parseBriefingConfig, DEFAULT_BRIEFING_CONFIG, scopeBriefingContext, projectBriefingContext, projectBriefingConnectorSources, splitBriefingContext } from "@cadence/core/services/briefing-config";
import { selectBriefingReferences } from "@cadence/core/services/briefing-references";
import { BRIEFING_PLAN_LIMITS, BRIEFING_PLAN_VERSION } from "@cadence/core/types/briefing-plan";
import { isLaneRecipe, isPlainRecipe } from "@cadence/core/types/briefing-config";
import { planBriefing } from "@cadence/core/resolvers/briefing-plan.resolver";
import type { AdvisorDayContext, AdvisorDayContextV1 } from "@cadence/core/types/advisor-day-context";
import { BRIEFING_ANALYSIS_VERSION, type BriefingAnalysisResult, type BriefingAnalysisSource, type BriefingFinding } from "@cadence/core/types/briefing-analysis";
import type { BriefingConfig } from "@cadence/core/types/briefing-config";
import { resolveBriefingAnalysis, selectBriefingTip, type BriefingTipSelection } from "@cadence/core/resolvers/briefing-analysis.resolver";
import { projectBriefingTipForModel, type BriefingModelTipFinding } from "@cadence/core/services/briefing-analysis";

export const BRIEFING_PIPELINE_VERSION = "3.0";

/** Analysis inputs the caller authorized and read. Absent sources leave selected lanes unavailable. */
export type BriefingAnalysisInput = Readonly<{
  source: BriefingAnalysisSource | null;
  /** Development retrospective evaluation may inspect retained rows without proving the original scheduled universe. */
  cadenceComplete?: boolean;
  /** Content-free tip history; omitted by workbench and fixtures, which never record deliveries. */
  shown?: readonly Readonly<{ fingerprint: string; lastShownLocalDate: string }>[];
  fingerprintOf?: (finding: BriefingFinding) => string;
}>;

export type PreparedBriefingAnalysis = Readonly<{
  version: typeof BRIEFING_ANALYSIS_VERSION;
  result: BriefingAnalysisResult;
  selection: Pick<BriefingTipSelection, "decisions"> & Readonly<{ tipId: string | null }>;
  tip: BriefingFinding | null;
  modelTip: BriefingModelTipFinding | null;
  fingerprint: string | null;
  recordFingerprints: readonly string[];
}>;
// Promotion is a reviewed repository change. Browser drafts never reach this selector.
export function activeBriefingConfig() { return parseBriefingConfig(DEFAULT_BRIEFING_CONFIG); }

export function briefingConfigurationRevision(value: unknown = activeBriefingConfig()) {
  const config = parseBriefingConfig(value);
  return createHash("sha256").update(JSON.stringify({ config, references: selectBriefingReferences(config.referenceIds), pipeline: BRIEFING_PIPELINE_VERSION, policy: DAILY_BRIEF_POLICY_VERSION, planner: BRIEFING_PLAN_VERSION })).digest("hex");
}

/**
 * `alongsideBehaviorRefs` (recipe 1.2): Behaviors that can happen during other
 * activities. They receive no move options; the consumer also keeps their overlaps
 * out of the brief.
 */
export function prepareBriefing(sourceContext: AdvisorDayContext, value: unknown, now: string, analysisInput?: BriefingAnalysisInput,
  alongsideBehaviorRefs: ReadonlySet<string> = new Set()) {
  const config = parseBriefingConfig(value);
  // Ticket 239: existing projections see the Google-only `1.0` view; disclosed sources travel separately.
  const { context, sources } = splitBriefingContext(sourceContext, config);
  const plannerContext = scopeBriefingContext(context, config);
  const projected = projectBriefingContext(context, config);
  const contextControls = projected.contextControls;
  const connectorSources = projectBriefingConnectorSources(sources);
  const sourcesComplete = sources.calendars.every((item) => item.complete) && (sources.recordedActivity?.complete ?? true);
  const facts = connectorSources ? {
    ...projected.facts,
    version: sourceContext.version,
    status: projected.facts.status === "complete" && sourcesComplete ? "complete" as const : "partial" as const,
    connectorSources,
  } : projected.facts;
  const references = selectBriefingReferences(config.referenceIds);
  const configurationRevision = briefingConfigurationRevision(config);
  const atMinute = (minute: number) => {
    const date = Temporal.PlainDate.from(facts.localDate);
    const target = minute === 1440 ? date.add({ days: 1 }) : date;
    const local = target.toPlainDateTime({ hour: Math.floor(minute % 1440 / 60), minute: minute % 60 });
    const zoned = local.toZonedDateTime(facts.timezone);
    // A skipped local time cannot expand the configured window into a different hour.
    return zoned.toPlainDateTime().equals(local) ? zoned.toInstant() : null;
  };
  const windows = config.planner.permittedWindows.flatMap(({ startMinute, endMinute }) => {
    const start = atMinute(startMinute), end = atMinute(endMinute);
    if (!start || !end || Temporal.Instant.compare(start, end) >= 0) return [];
    return [{ kind: "timed" as const, startAt: start.toString(), endAt: end.toString(), duration: { kind: "known" as const, seconds: start.until(end).total("seconds") } }];
  });
  // A narrowed Behavior view omits fixed commitments and cannot establish availability.
  const plan = planBriefing({ context: plannerContext, now, configurationRevision,
    ...(sources.calendars.length ? { additionalCalendars: sources.calendars } : {}),
    permittedWindows: windows,
    fixedCommitmentsComplete: (analysisInput?.cadenceComplete ?? true) && plannerContext.cadence.occurrences.length === context.cadence.occurrences.length,
    alternatives: config.alternatives, allowedSuggestionTypes: config.allowedSuggestionTypes,
    // Recipe 1.2: a range Behavior already floats within its span, so it is never moved.
    movableOccurrences: movableOccurrences(config, plannerContext).filter((item) => !alongsideBehaviorRefs.has(item.behaviorRef) &&
      !(isLaneRecipe(config.recipe) && item.schedule.kind === "range")).map((item) => ({
      occurrenceRef: item.ref,
      permittedWindows: windows,
    })), policy: isLaneRecipe(config.recipe) ? { ...config.planner, onePerOccurrence: true, flexibleSchedules: true } : config.planner });
  const analysis = config.analysis.lanes.length ? prepareAnalysis(config, context, analysisInput) : null;
  return { config, configurationRevision, facts, contextControls, references, plan, analysis, pipelineVersion: BRIEFING_PIPELINE_VERSION, recipe: config.recipe, policyVersion: DAILY_BRIEF_POLICY_VERSION };
}

/**
 * Recipe 1.0 moves only explicitly listed Behaviors. Recipes 1.1 and 1.2 treat every
 * Behavior still unresolved at generation as movable within today, for suggestions
 * only; the Behavior's schedule never changes. The earliest occurrences fit the planner limit.
 */
export function movableOccurrences(config: BriefingConfig, context: AdvisorDayContextV1): AdvisorDayContextV1["cadence"]["occurrences"] {
  const unresolved = context.cadence.occurrences.filter((item) => item.status === "unresolved");
  if (!isPlainRecipe(config.recipe)) return unresolved.filter((item) => config.planner.movableBehaviorRefs.includes(item.behaviorRef));
  return [...unresolved]
    .sort((left, right) => Temporal.Instant.compare(Temporal.Instant.from(left.scheduledFor), Temporal.Instant.from(right.scheduledFor)) || left.ref.localeCompare(right.ref))
    .slice(0, BRIEFING_PLAN_LIMITS.movableOccurrences);
}

function prepareAnalysis(config: BriefingConfig, context: AdvisorDayContextV1, input: BriefingAnalysisInput | undefined): PreparedBriefingAnalysis {
  // A source from another day or timezone cannot support today's findings.
  const source = input?.source && input.source.localDate === context.localDate && input.source.timezone === context.timezone ? input.source : null;
  const result: BriefingAnalysisResult = source
    ? resolveBriefingAnalysis({ source, lanes: config.analysis.lanes, historyDays: config.scope.historyDays, behaviorRefs: config.scope.behaviorRefs, expiresAt: context.expiresAt })
    : { version: BRIEFING_ANALYSIS_VERSION, findings: [], lanes: config.analysis.lanes.map((laneId) => ({ laneId, state: "unavailable" as const, reason: "source_not_requested" as const, candidateCount: 0 })) };
  const selection = selectBriefingTip({
    findings: result.findings, maxTips: config.analysis.maxTips, cooldownDays: config.analysis.cooldownDays,
    // Recipe 1.2 (owner decision, October 23): quiet days may show a different tip on consecutive days.
    nextDaySpacing: !isLaneRecipe(config.recipe),
    localDate: context.localDate, shown: input?.shown ?? [], fingerprintOf: input?.fingerprintOf ?? ((finding) => finding.id),
  });
  return {
    version: BRIEFING_ANALYSIS_VERSION,
    result,
    selection: { tipId: selection.tip?.id ?? null, decisions: selection.decisions },
    tip: selection.tip,
    modelTip: selection.tip ? projectBriefingTipForModel(selection.tip, source) : null,
    fingerprint: selection.fingerprint,
    recordFingerprints: selection.recordFingerprints,
  };
}
