import { Temporal } from "@js-temporal/polyfill";
import { validateVersionedAdvisorDayContext } from "@cadence/core/services/advisor-day-context";
import type { AdvisorDayContext } from "@cadence/core/types/advisor-day-context";
import { activeBriefingConfig, briefingConfigurationRevision, prepareBriefing, type BriefingAnalysisInput } from "./briefing-pipeline";
import { parseBriefingConfig } from "@cadence/core/services/briefing-config";
import { applyDescriptionEstimates, parseDescriptionEstimates, selectDescriptionEstimateItems, type DescriptionEstimate, type DescriptionEstimateItem } from "@cadence/core/services/description-duration";
import type { BriefingConfig } from "@cadence/core/types/briefing-config";
import { DAILY_BRIEF_POLICY_VERSION, type DailyBriefing } from "@cadence/core/types/daily-brief";
import { briefingTipCategory, describeBriefingFinding, describeBriefingLimitation } from "@cadence/core/services/briefing-analysis";
import { isLaneRecipe, isPlainRecipe } from "@cadence/core/types/briefing-config";
import { briefingBehaviorNames } from "@cadence/core/services/daily-brief-presentation";
import { briefingSetupTip } from "@cadence/core/services/briefing-setup-tip";
import { briefingMoveOverview, briefingMoveReason } from "@cadence/core/services/briefing-move-overview";
import { briefingTravelOptionPolicy, briefingUsesWeather } from "@cadence/core/services/briefing-travel";

// Ticket 290: the instruction text lives in daily-brief-instructions.ts. These re-exports keep every existing import working.
export {
  DAILY_BRIEF_ANALYSIS_INSTRUCTIONS, DAILY_BRIEF_CONNECTOR_INSTRUCTIONS, DAILY_BRIEF_INSTRUCTIONS, DAILY_BRIEF_PROMPT_REVISION,
  DAILY_BRIEF_TRAVEL_INSTRUCTIONS, DAILY_BRIEF_V1_1_INSTRUCTIONS, DAILY_BRIEF_V1_2_INSTRUCTIONS, DURATION_ESTIMATE_INSTRUCTIONS,
  DURATION_ESTIMATE_V1_2_INSTRUCTIONS,
} from "./daily-brief-instructions";
import {
  composeDailyBriefInstructions, DAILY_BRIEF_PROMPT_VARIANTS, DURATION_ESTIMATE_INSTRUCTIONS, DURATION_ESTIMATE_V1_2_INSTRUCTIONS,
  type DailyBriefPromptVariant,
} from "./daily-brief-instructions";

/**
 * Ticket 288: token counts one model call reported. A count is null when the
 * provider did not report it. Counts only; never prompts, output or response IDs.
 */
export type DailyBriefModelUsage = Readonly<{
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
}>;

/** Which model call reported the usage: the brief itself or the Ticket 188 estimate step. */
export type DailyBriefModelCall = "brief" | "duration_estimate";

export type DailyBriefCallUsage = Readonly<{ call: DailyBriefModelCall }> & DailyBriefModelUsage;

/** Totals across calls. A token total is null when no call reported that count. */
export type DailyBriefUsageTotals = Readonly<{ calls: number }> & DailyBriefModelUsage;

export function sumDailyBriefUsage(usage: readonly DailyBriefModelUsage[]): DailyBriefUsageTotals {
  const total = (pick: (item: DailyBriefModelUsage) => number | null) => usage.reduce<number | null>((sum, item) => {
    const value = pick(item);
    return value === null ? sum : (sum ?? 0) + value;
  }, null);
  return { calls: usage.length, inputTokens: total((item) => item.inputTokens), cachedInputTokens: total((item) => item.cachedInputTokens),
    outputTokens: total((item) => item.outputTokens), reasoningTokens: total((item) => item.reasoningTokens) };
}

export type DailyBriefGenerator = (input: Readonly<{
  instructions: string;
  facts: string;
  signal: AbortSignal;
  /** Recipe 1.2 estimate calls also return `alongside`; the adapter picks the matching schema. */
  estimateVariant?: "alongside";
  /**
   * Ticket 288: present only when the caller asked for usage. The adapter calls it
   * once per provider response that reports usage. It never changes the request.
   */
  onUsage?: (usage: DailyBriefModelUsage) => void;
}>) => Promise<unknown>;

/**
 * `code` is the public value that routes return. `reason` is an internal short
 * machine code (Ticket 288) for logs and development workbench records only;
 * production routes never return it.
 */
export class DailyBriefError extends Error {
  constructor(public readonly code: string, public readonly retryAfterSeconds?: number, public readonly reason?: string) {
    super(code);
  }
}

/** The one public code for rejected provider output, with the internal reason attached. */
export function adviceRejected(reason: string): DailyBriefError {
  return new DailyBriefError("advisor_unavailable", undefined, reason);
}

/** Provider-neutral generation. The adapter gets facts, never database or mutation capabilities. */
export async function generateDailyBrief(context: AdvisorDayContext, input: Readonly<{
  generate: DailyBriefGenerator;
  signal: AbortSignal;
  now: () => Temporal.Instant;
  config?: unknown;
  /** Freeze planning across comparisons while the live clock still checks expiry. */
  planningNow?: string;
  /** Authorized analysis inputs; ignored unless the configuration selects lanes. */
  analysis?: BriefingAnalysisInput;
  /** Called with the fingerprints to record when validated output includes the tip. */
  onTip?: (fingerprints: readonly string[]) => void;
  /** Ticket 188: descriptions the caller is authorized to send, keyed by behaviorRef. */
  descriptions?: Readonly<Record<string, string>>;
  /** Ticket 188: the separate estimate call. Without it, durations stay as recorded. */
  estimate?: DailyBriefGenerator;
  /** Receives what was actually planned, including accepted estimates, for inspection. */
  onPrepared?: (value: Readonly<{ prepared: ReturnType<typeof prepareBriefing>; estimates: DurationEstimateReport }>) => void;
  /** Ticket 288: receives token usage per model call. Without it, generator input stays unchanged. */
  onUsage?: (usage: DailyBriefCallUsage) => void;
  /** Ticket 290: development workbench only. Production omits it and sends the "layered" text. */
  promptVariant?: DailyBriefPromptVariant;
}>): Promise<DailyBriefing> {
  const promptVariant = input.promptVariant ?? "layered";
  if (!DAILY_BRIEF_PROMPT_VARIANTS.includes(promptVariant)) throw new DailyBriefError("invalid_request");
  validateVersionedAdvisorDayContext(context);
  assertBriefContextFresh(context, input.now());
  input.signal.throwIfAborted();
  const config = parseBriefingConfig(input.config ?? activeBriefingConfig());
  const { planned, report } = await estimateDurations(context, config, input, usageReporter(input.onUsage, "duration_estimate"));
  const alongside = new Set(report.estimates.filter((item) => item.alongside).map((item) => item.behaviorRef));
  const planningNow = input.planningNow ?? input.now().toString();
  const prepared = prepareBriefing(planned, config, planningNow, input.analysis, alongside);
  input.onPrepared?.({ prepared, estimates: report });
  const { facts, contextControls, references, plan, configurationRevision, pipelineVersion, analysis } = prepared;
  const v11 = isPlainRecipe(config.recipe);
  const v12 = isLaneRecipe(config.recipe);
  const offeredOptions = plan.options.filter(({ occurrenceRef }) => briefingTravelOptionPolicy(facts.travel, occurrenceRef).offer);
  const instructions = composeDailyBriefInstructions(promptVariant, { config, route: plan.route, analysis: Boolean(analysis),
    connectorSources: "connectorSources" in facts, travel: Boolean(facts.travel) });
  const alongsideRefs = new Set(planned.cadence.occurrences.filter((item) => alongside.has(item.behaviorRef)).map((item) => item.ref));
  // Keep detailed rejection diagnostics in the inspector, not the prose inputs.
  const modelPlan = {
    version: plan.version, route: plan.route, outcome: plan.outcome,
    generatedAt: plan.generatedAt, expiresAt: plan.expiresAt, revisions: plan.revisions,
    // Recipe 1.2: each option says why it exists, so the overview can explain every move.
    options: v12 ? offeredOptions.map((option) => ({ ...option, why: briefingMoveReason(option, plan, planningNow) })) : offeredOptions,
    dayEvidence: {
      ...plan.dayEvidence,
      findings: plan.dayEvidence.findings.filter((finding) => finding.kind !== "unknown_feasibility" &&
        // Recipe 1.2 states a move only in its option block, so no opening reaches the prose.
        !(v12 && finding.kind === "feasible_opportunity") &&
        // Recipe 1.2: a Behavior that can happen alongside other things is never one side of a conflict.
        !(v12 && (finding.kind === "known_overlap" || finding.kind === "tight_transition") && finding.refs.occurrenceRefs.some((ref) => alongsideRefs.has(ref))) &&
        // Recipe 1.1 mentions a different time only through an option, so a move-only opening without one is noise.
        !(v11 && finding.kind === "feasible_opportunity" && finding.hypotheticalMoveRequired && !offeredOptions.some((option) => option.occurrenceRef === finding.occurrenceRef)))
        .map((finding) => v12 ? withMinutes(finding) : withoutParticipants(finding)),
    },
  };
  const modelTip = analysis?.modelTip && v12 && analysis.tip ? { ...analysis.modelTip, category: briefingTipCategory(analysis.tip) } : analysis?.modelTip ?? null;
  const body = { recipe: config.recipe, policyVersion: DAILY_BRIEF_POLICY_VERSION, context: facts, references: references.included, plan: modelPlan,
    ...(analysis ? { analysis: { tip: modelTip } } : {}) };
  // Deterministic local-time labels, so the model never converts UTC instants itself.
  const payload = JSON.stringify({ ...body, clock: { timezone: context.timezone, labels: localTimeLabels(body, context.timezone) } });
  if (Buffer.byteLength(payload, "utf8") > 512 * 1024) throw new DailyBriefError("context_limit_exceeded");
  const onBriefUsage = usageReporter(input.onUsage, "brief");
  const result = await raceBriefAbort(input.generate({ instructions, facts: payload, signal: input.signal, ...(onBriefUsage ? { onUsage: onBriefUsage } : {}) }), input.signal);
  input.signal.throwIfAborted();
  const now = input.now();
  assertBriefContextFresh(context, now);
  if (briefingConfigurationRevision(config) !== configurationRevision) throw new DailyBriefError("context_changed");
  // Ticket 288: each rejection keeps the public code and names its internal reason.
  if (!result || typeof result !== "object" || Array.isArray(result)) throw adviceRejected("validation_shape");
  const value = result as Record<string, unknown>;
  const refs = new Set(facts.cadence.occurrences.map((item) => item.ref));
  const keys = Object.keys(value).sort().join();
  // Recipe 1.2 returns empty text on a quiet day; the tip or nothing is shown instead.
  if ((keys !== "occurrenceRefs,suggestions,text" && keys !== "occurrenceRefs,suggestions,text,tip") || typeof value.text !== "string" || (!v12 && !value.text.trim()) || value.text.length > 2_000 ||
      !Array.isArray(value.occurrenceRefs) || value.occurrenceRefs.length > 200) {
    throw adviceRejected("validation_shape");
  }
  if (value.occurrenceRefs.some((ref) => typeof ref !== "string" || !refs.has(ref)) || new Set(value.occurrenceRefs).size !== value.occurrenceRefs.length) {
    throw adviceRejected("validation_unknown_ref");
  }
  const validRefs = (items: unknown, allowed: Set<string>, max: number): items is string[] => Array.isArray(items) && items.length <= max && items.every((item) => typeof item === "string" && allowed.has(item)) && new Set(items).size === items.length;
  if (!Array.isArray(value.suggestions) || value.suggestions.length > config.alternatives) throw adviceRejected("validation_suggestion");
  const sources = new Set(references.included.map((source) => source.id));
  const selectedOptionIds = new Set<string>();
  const suggestions = value.suggestions.map((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw adviceRejected("validation_suggestion");
    const suggestion = item as Record<string, unknown>;
    // Recipe 1.2 move blocks carry no reason text (owner review, October 23); other suggestions need text.
    if (Object.keys(suggestion).sort().join() !== "occurrenceRefs,optionId,referenceIds,text" || typeof suggestion.text !== "string" || (!(v12 && suggestion.optionId !== null) && !suggestion.text.trim()) || suggestion.text.length > 1000 ||
        (plan.route !== "priority_suggestions" && plan.route !== "scheduling_options")) throw adviceRejected("validation_suggestion");
    if (!validRefs(suggestion.occurrenceRefs, refs, 200) || !validRefs(suggestion.referenceIds, sources, 4)) throw adviceRejected("validation_unknown_ref");
    const option = offeredOptions.find((option) => option.id === suggestion.optionId);
    if (plan.route === "scheduling_options" ? !option || !suggestion.occurrenceRefs.includes(option.occurrenceRef) : suggestion.optionId !== null) throw adviceRejected("validation_option");
    if (option) {
      if (selectedOptionIds.has(option.id)) throw adviceRejected("validation_option");
      selectedOptionIds.add(option.id);
    }
    // Recipe 1.2 shows the moved Behavior's name in the suggestion's own block.
    const behavior = v12 && option ? context.cadence.occurrences.find((occurrence) => occurrence.ref === option.occurrenceRef)?.title : undefined;
    return { text: v12 && option ? "" : suggestion.text.trim(), occurrenceRefs: suggestion.occurrenceRefs, referenceIds: suggestion.referenceIds, optionId: option?.id ?? null, ...(option ? { option } : {}), ...(behavior ? { behavior } : {}) };
  });
  // Recipe 1.2 fills omitted options only when projected travel permits a fallback.
  if (v12 && plan.route === "scheduling_options") {
    const used = new Set(suggestions.map((item) => item.optionId));
    for (const option of offeredOptions) {
      if (used.has(option.id) || !briefingTravelOptionPolicy(facts.travel, option.occurrenceRef).fallback) continue;
      const behavior = context.cadence.occurrences.find((occurrence) => occurrence.ref === option.occurrenceRef)?.title;
      suggestions.push({ text: "", occurrenceRefs: [option.occurrenceRef], referenceIds: [], optionId: option.id, option, ...(behavior ? { behavior } : {}) });
    }
    const order = new Map(offeredOptions.map((option, index) => [option.id, index]));
    suggestions.sort((left, right) => (order.get(left.optionId ?? "") ?? 99) - (order.get(right.optionId ?? "") ?? 99));
  }
  // Recipe 1.2: moves never appear without their reasons; Cadence writes them if the model did not.
  const moveOptions = suggestions.flatMap((item) => item.option ? [item.option] : []);
  const text = v12 && !value.text.trim() && moveOptions.length
    ? briefingMoveOverview({ options: moveOptions, plan, planningNow, timezone: context.timezone,
      titleOf: (ref) => context.cadence.occurrences.find((occurrence) => occurrence.ref === ref)?.title ?? null })
    : value.text.trim();
  const tip = validateTip(value.tip ?? null, analysis);
  // Count the text actually shown, including a recipe 1.2 overview Cadence wrote.
  const combined = [text, ...suggestions.map((item) => item.text), ...(tip ? [tip.text] : [])].join(" ");
  if (combined.length > 2600 || combined.trim().split(/\s+/u).filter(Boolean).length > config.length.maxWords) throw adviceRejected("validation_word_limit");
  if (/https?:|www\./i.test(combined)) throw adviceRejected("validation_url");
  const tipFinding = tip ? analysis!.tip! : null;
  if (tipFinding && analysis?.recordFingerprints.length) input.onTip?.(analysis.recordFingerprints);
  const analysisTip: DailyBriefing["tip"] | null = tip && tipFinding ? {
    text: tip.text,
    laneId: tipFinding.laneId,
    basis: describeBriefingFinding(tipFinding, {
      title: context.cadence.occurrences.find((item) => item.behaviorRef === tipFinding.behaviorRef)?.title ?? null,
      citedNotes: tip.noteRefs.length || undefined,
      plain: v11,
    }),
    limitation: describeBriefingLimitation(tipFinding.limitations, { plain: v11 }),
    ...(v11 ? { category: briefingTipCategory(tipFinding) } : {}),
  } : null;
  // Recipe 1.2: with no model tip, Cadence may nudge for a missing length, judged after estimates.
  const shownTip = analysisTip ?? (v12 ? briefingSetupTip({ facts, contextControls }) : null);
  return {
    ...(shownTip ? { tip: shownTip } : {}),
    suggestions, references: references.included.filter((source) => suggestions.some((item) => item.referenceIds.includes(source.id))),
    ...(v12 ? { behaviorNames: briefingBehaviorNames(context.cadence.occurrences.map((item) => item.title), [text, ...suggestions.map((item) => item.text), ...(shownTip ? [shownTip.text] : [])]) } : {}),
    versions: { configuration: configurationRevision, references: references.version, planner: plan.version, pipeline: pipelineVersion, recipe: `${config.recipe.id}@${config.recipe.version}`, policy: DAILY_BRIEF_POLICY_VERSION },
    text, localDate: context.localDate, timezone: context.timezone,
    generatedAt: now.toString(), expiresAt: context.expiresAt, coverage: facts.status,
    warnings: ["Suggestions only. No changes were applied."],
    ...(briefingUsesWeather(facts.travel) ? { attributions: ["open_meteo"] as const } : {}),
  };
}

/** Overlap participants are recipe 1.2 input; earlier recipes keep their original model input. */
function withoutParticipants<T extends ReturnType<typeof prepareBriefing>["plan"]["dayEvidence"]["findings"][number]>(finding: T): T {
  if (finding.kind !== "known_overlap") return finding;
  const rest: Record<string, unknown> = { ...finding };
  delete rest.participants;
  return rest as T;
}

/** Recipe 1.2 model input: overlap and gap lengths in whole minutes, so prose never computes them. */
function withMinutes<T extends ReturnType<typeof prepareBriefing>["plan"]["dayEvidence"]["findings"][number]>(finding: T): T {
  if (finding.kind === "known_overlap") return { ...finding, overlapMinutes: Math.round(finding.interval.duration.seconds / 60) };
  if (finding.kind === "tight_transition") return { ...finding, minutesBetween: Math.floor(finding.availableSeconds / 60), preferredMinutesBetween: Math.round(finding.requiredBufferSeconds / 60) };
  return finding;
}

export type DurationEstimateReport = Readonly<{
  state: "not_requested" | "none_needed" | "ready" | "failed";
  items: readonly DescriptionEstimateItem[];
  estimates: readonly DescriptionEstimate[];
  /** Ticket 288: internal short code for a failed estimate step; inspector only. */
  reason?: string;
}>;

/** Binds a call name to the caller's usage callback; undefined keeps generator input unchanged. */
function usageReporter(onUsage: ((usage: DailyBriefCallUsage) => void) | undefined, call: DailyBriefModelCall) {
  return onUsage ? (usage: DailyBriefModelUsage) => onUsage({ call, ...usage }) : undefined;
}

/**
 * Ticket 188: one bounded estimate call before planning. A failed or malformed reply
 * leaves durations unknown and never fails the brief; cancellation still aborts it.
 */
async function estimateDurations<T extends AdvisorDayContext>(context: T, config: BriefingConfig, input: Readonly<{
  descriptions?: Readonly<Record<string, string>>; estimate?: DailyBriefGenerator; signal: AbortSignal;
}>, onUsage?: (usage: DailyBriefModelUsage) => void): Promise<Readonly<{ planned: T; report: DurationEstimateReport }>> {
  if (!isPlainRecipe(config.recipe) || !config.context.duration.includeDescriptionEstimate || !input.descriptions || !input.estimate) {
    return { planned: context, report: { state: "not_requested", items: [], estimates: [] } };
  }
  const items = selectDescriptionEstimateItems(context, config, input.descriptions);
  if (!items.length) return { planned: context, report: { state: "none_needed", items, estimates: [] } };
  try {
    const lanes = isLaneRecipe(config.recipe);
    const raw = await raceBriefAbort(input.estimate({ instructions: lanes ? `${DURATION_ESTIMATE_INSTRUCTIONS}\n${DURATION_ESTIMATE_V1_2_INSTRUCTIONS}` : DURATION_ESTIMATE_INSTRUCTIONS, facts: JSON.stringify({ items }), signal: input.signal, ...(lanes ? { estimateVariant: "alongside" as const } : {}), ...(onUsage ? { onUsage } : {}) }), input.signal);
    const estimates = parseDescriptionEstimates(raw, items, { alongside: lanes });
    return { planned: applyDescriptionEstimates(context, estimates), report: { state: "ready", items, estimates } };
  } catch (error) {
    if (input.signal.aborted) throw error;
    const reason = error instanceof DailyBriefError ? error.reason ?? error.code : "estimate_failed";
    return { planned: context, report: { state: "failed", items, estimates: [], reason } };
  }
}

/**
 * Validates the optional tip against the one finding offered. Structural
 * violations reject the brief; unsupported Note themes or quoted Note text
 * drop only the tip.
 */
function validateTip(value: unknown, analysis: ReturnType<typeof prepareBriefing>["analysis"]): { text: string; noteRefs: string[] } | null {
  if (value === null) return null;
  const offered = analysis?.modelTip;
  if (!offered || !value || typeof value !== "object" || Array.isArray(value)) throw adviceRejected("validation_tip");
  const tip = value as Record<string, unknown>;
  if (Object.keys(tip).sort().join() !== "findingId,noteRefs,text" || tip.findingId !== "tip" ||
      typeof tip.text !== "string" || !tip.text.trim() || tip.text.length > 600 ||
      !Array.isArray(tip.noteRefs) || tip.noteRefs.some((ref) => typeof ref !== "string") || new Set(tip.noteRefs).size !== tip.noteRefs.length) {
    throw adviceRejected("validation_tip");
  }
  const noteRefs = tip.noteRefs as string[];
  const text = tip.text.trim();
  if (offered.laneId !== "notes-failure-themes") {
    if (noteRefs.length) throw adviceRejected("validation_tip");
    return { text, noteRefs };
  }
  const notes = new Map((offered.notes ?? []).map((note) => [note.ref, note.text]));
  if (noteRefs.length < 3 || noteRefs.some((ref) => !notes.has(ref))) return null;
  // Keep private Note wording out of the displayed tip.
  if ([...notes.values()].some((note) => sharesPhrase(text, note, 6))) return null;
  return { text, noteRefs };
}

// Postgres renders timestamptz as `+00:00`; other sources use `Z`. Both are instants.
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** Maps every UTC instant in the model payload to a local `h:mm AM` label. */
export function localTimeLabels(value: unknown, timezone: string): Record<string, string> {
  const labels: Record<string, string> = {};
  const visit = (item: unknown) => {
    if (typeof item === "string") {
      if (INSTANT.test(item) && !(item in labels)) {
        const local = Temporal.Instant.from(item).toZonedDateTimeISO(timezone);
        labels[item] = `${local.hour % 12 === 0 ? 12 : local.hour % 12}:${String(local.minute).padStart(2, "0")} ${local.hour < 12 ? "AM" : "PM"}`;
      }
    } else if (Array.isArray(item)) item.forEach(visit);
    else if (item && typeof item === "object") Object.values(item).forEach(visit);
  };
  visit(value);
  return labels;
}

function sharesPhrase(text: string, source: string, words: number): boolean {
  const tokens = (value: string) => value.toLowerCase().normalize("NFKC").split(/[^\p{L}\p{N}']+/u).filter(Boolean);
  const haystack = ` ${tokens(text).join(" ")} `;
  const needle = tokens(source);
  for (let index = 0; index + words <= needle.length; index += 1) {
    if (haystack.includes(` ${needle.slice(index, index + words).join(" ")} `)) return true;
  }
  return false;
}

export function assertBriefContextFresh(context: AdvisorDayContext, now: Temporal.Instant): void {
  if (Temporal.Instant.compare(now, Temporal.Instant.from(context.capturedAt)) < 0 ||
      Temporal.Instant.compare(now, Temporal.Instant.from(context.expiresAt)) >= 0 ||
      now.toZonedDateTimeISO(context.timezone).toPlainDate().toString() !== context.localDate) {
    throw new DailyBriefError("context_expired");
  }
}

export function raceBriefAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DailyBriefError("timeout"));
    if (signal.aborted) { void work.catch(() => undefined); abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
