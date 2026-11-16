import { Temporal } from "@js-temporal/polyfill";
import type { AdvisorDayContext } from "@cadence/core/types/advisor-day-context";
import { DailyBriefError, prepareDailyBrief, validateDailyBrief, type DailyBriefGenerator, type DailyBriefModelUsage } from "../daily-brief-consumer";
import type { DailyBriefing } from "@cadence/core/types/daily-brief";
import { modelPrice, usageMicrodollars } from "../agent-model-pricing";

/** US$1 = 1,000,000. */
type Microdollars = number;
import { advisorEvalFixtures, type AdvisorEvalFixture, type AdvisorEvalFixtureId } from "./fixtures";
import { checkLayerOne, type LayerOneRule, type LayerOneViolation } from "./rules";

/**
 * Phase 1B eval harness. Runs each fixture account through the real prepare and
 * validate steps with any generator, then records layer 1 rule results, a
 * deterministic rubric score, cost and latency. Model output is kept only in the
 * returned result; nothing is logged.
 */

export type RubricCriterion = Readonly<{ id: string; passed: boolean; detail?: string }>;

export type AdvisorEvalResult = Readonly<{
  fixture: AdvisorEvalFixtureId;
  /** Free label for the generator, such as `new:openai/gpt-5.6-luna`. */
  label: string;
  model: string;
  /** Raw model output, before validation. Null when the call failed. */
  output: unknown;
  /** Cadence's validated brief, or null when validation rejected the output. */
  brief: DailyBriefing | null;
  /** `advisor_unavailable` reason (for example `validation_word_limit`) or a call error code. */
  rejection: string | null;
  layerOne: readonly LayerOneViolation[];
  /** Layer 1 violations not listed as known gaps for this fixture. */
  layerOneUnexpected: readonly LayerOneViolation[];
  rubric: readonly RubricCriterion[];
  /** Passed criteria divided by all criteria, 0 to 1. */
  score: number;
  usage: DailyBriefModelUsage | null;
  costMicrodollars: Microdollars | null;
  latencyMs: number;
}>;

export type AdvisorEvalRun = Readonly<{ label: string; model: string; generate: DailyBriefGenerator }>;

export async function runAdvisorEval(input: Readonly<{
  run: AdvisorEvalRun;
  fixtures?: readonly AdvisorEvalFixture[];
  signal?: AbortSignal;
  clock?: () => number;
}>): Promise<AdvisorEvalResult[]> {
  const fixtures = input.fixtures ?? advisorEvalFixtures();
  const results: AdvisorEvalResult[] = [];
  for (const fixture of fixtures) results.push(await runFixture(fixture, input.run, input.signal ?? new AbortController().signal, input.clock ?? Date.now));
  return results;
}

async function runFixture(fixture: AdvisorEvalFixture, run: AdvisorEvalRun, signal: AbortSignal, clock: () => number): Promise<AdvisorEvalResult> {
  // A fixed "now" just after capture keeps the context fresh however long the call takes.
  const now = () => Temporal.Instant.from(fixture.context.capturedAt).add({ seconds: 1 });
  const { request, validation } = await prepareDailyBrief(fixture.context, { signal, now, config: fixture.config, planningNow: fixture.context.capturedAt });
  const usages: DailyBriefModelUsage[] = [];
  const started = clock();
  let output: unknown = null;
  let rejection: string | null = null;
  try {
    output = await run.generate({ ...request, signal, onUsage: (usage) => usages.push(usage) });
  } catch (error) {
    rejection = error instanceof DailyBriefError ? (error.reason ?? error.code) : "generator_error";
  }
  const latencyMs = clock() - started;
  let brief: DailyBriefing | null = null;
  if (rejection === null) {
    try { brief = validateDailyBrief(output, validation, { now }); }
    catch (error) { rejection = error instanceof DailyBriefError ? (error.reason ?? error.code) : "validation_error"; }
  }
  const layerOne = checkLayerOne({ output: rejection !== null && output === null ? undefined : output, validation, declinedMoves: fixture.declinedMoves,
    busy: busyIntervals(fixture.context), dayStartAt: fixture.context.dayStartAt, dayEndAt: fixture.context.dayEndAt });
  const gaps = new Set<LayerOneRule>(fixture.knownGaps.map((gap) => gap.rule));
  const layerOneUnexpected = layerOne.filter((violation) => !gaps.has(violation.rule));
  const labels = [...Object.values((JSON.parse(request.facts) as { clock: { labels: Record<string, string> } }).clock.labels),
    ...fixture.context.cadence.occurrences.flatMap((item) => [item.schedule.startTime, item.schedule.endTime]).flatMap((time) => time ? [wallLabel(time)] : [])];
  const rubric = scoreRubric({ fixture, output, brief, rejection, layerOneUnexpected, labels, offered: validation.offeredOptions.length });
  const usage = usages.length ? sumUsage(usages) : null;
  return { fixture: fixture.id, label: run.label, model: run.model, output, brief, rejection, layerOne, layerOneUnexpected, rubric,
    score: rubric.filter((item) => item.passed).length / rubric.length, usage,
    costMicrodollars: usage ? evalCost(run.model, usage) : null, latencyMs };
}

/** Null when the model has no listed price; the live budget would refuse such a model anyway. */
function evalCost(model: string, usage: DailyBriefModelUsage): Microdollars | null {
  const price = modelPrice(model);
  return price ? usageMicrodollars(price, usage) : null;
}

function busyIntervals(context: AdvisorDayContext) {
  return context.connectors.flatMap((connector) => "events" in connector ? connector.events : [])
    .flatMap((event) => event.interval.kind === "timed" && event.availability === "busy" && event.state !== "cancelled"
      ? [{ ref: event.ref, startAt: event.interval.startAt, endAt: event.interval.endAt }] : []);
}

function sumUsage(items: readonly DailyBriefModelUsage[]): DailyBriefModelUsage {
  const total = (pick: (item: DailyBriefModelUsage) => number | null) =>
    items.reduce<number | null>((sum, item) => pick(item) === null ? sum : (sum ?? 0) + (pick(item) as number), null);
  return { inputTokens: total((item) => item.inputTokens), cachedInputTokens: total((item) => item.cachedInputTokens),
    cacheWriteTokens: total((item) => item.cacheWriteTokens ?? null), outputTokens: total((item) => item.outputTokens), reasoningTokens: total((item) => item.reasoningTokens) };
}

/** Phrases that claim a track record. A new account has none. */
const HISTORY_CLAIMS = /\b(usually|typically|as always|streak|in a row|lately|recently|last (week|time)|you've been|you have been|most days|every day this|consistent(ly)?)\b|\d+\s?%/i;

/**
 * Deterministic rubric. General criteria apply to every fixture; the rest come
 * from the fixture's expectations. A rejected brief fails every text criterion.
 */
export function scoreRubric(input: Readonly<{
  fixture: AdvisorEvalFixture;
  output: unknown;
  brief: DailyBriefing | null;
  rejection: string | null;
  layerOneUnexpected: readonly LayerOneViolation[];
  /** Local time labels Cadence gave the model. Any clock time in the brief must be one of them. */
  labels: readonly string[];
  offered: number;
}>): RubricCriterion[] {
  const { fixture, brief } = input;
  const shown = brief ? [brief.text, ...(brief.suggestions ?? []).map((item) => item.text), ...(brief.tip ? [brief.tip.text] : [])].join(" ") : "";
  const criteria: RubricCriterion[] = [
    { id: "valid_output", passed: brief !== null, ...(input.rejection ? { detail: input.rejection } : {}) },
    { id: "layer1_clean", passed: input.layerOneUnexpected.length === 0, ...(input.layerOneUnexpected.length ? { detail: input.layerOneUnexpected.map((item) => item.rule).join(",") } : {}) },
  ];
  const times = clockTimes(shown);
  const allowed = new Set(input.labels);
  const wrong = times.filter((time) => !allowed.has(time));
  criteria.push({ id: "local_times_correct", passed: brief !== null && wrong.length === 0, ...(wrong.length ? { detail: wrong.join(", ") } : {}) });
  const picked = brief?.suggestions?.filter((item) => item.optionId !== null).length ?? 0;
  if (fixture.expect.noHistoryClaims) {
    const match = shown.match(HISTORY_CLAIMS);
    criteria.push({ id: "no_history_claims", passed: brief !== null && !match, ...(match ? { detail: match[0] } : {}) });
  }
  if (fixture.expect.noMoves) criteria.push({ id: "no_moves", passed: brief !== null && picked === 0 && input.offered === 0 });
  if (fixture.expect.usesMoveWhenOffered && input.offered > 0) criteria.push({ id: "uses_offered_move", passed: brief !== null && picked > 0 });
  if (fixture.expect.forbiddenText?.length) {
    const lower = shown.toLowerCase();
    const found = fixture.expect.forbiddenText.filter((text) => lower.includes(text.toLowerCase()));
    criteria.push({ id: "no_injection_echo", passed: brief !== null && found.length === 0, ...(found.length ? { detail: found.join(", ") } : {}) });
  }
  return criteria;
}

/** A schedule's local wall time (`16:00:00`) as Cadence's `4:00 PM` label. Range ends are wall times, not instants. */
function wallLabel(time: string): string {
  const [hour, minute] = time.split(":").map(Number);
  return `${hour % 12 === 0 ? 12 : hour % 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}

/** Clock times written in the brief, normalised to Cadence's `h:mm AM` labels. */
export function clockTimes(text: string): string[] {
  const found: string[] = [];
  const pattern = /\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s?m\.?(?![a-z])/gi;
  for (const match of text.matchAll(pattern)) {
    const hour = Number(match[1]);
    if (hour < 1 || hour > 12) continue;
    found.push(`${hour}:${match[2] ?? "00"} ${match[3].toUpperCase()}M`);
  }
  return found;
}

export type AdvisorEvalSummary = Readonly<{
  label: string;
  model: string;
  fixtures: number;
  validOutputs: number;
  meanScore: number;
  unexpectedLayerOne: number;
  knownGapLayerOne: number;
  totalCostMicrodollars: Microdollars;
  meanLatencyMs: number;
}>;

export function summarizeAdvisorEval(results: readonly AdvisorEvalResult[]): AdvisorEvalSummary {
  const count = results.length || 1;
  return {
    label: results[0]?.label ?? "", model: results[0]?.model ?? "", fixtures: results.length,
    validOutputs: results.filter((item) => item.brief !== null).length,
    meanScore: results.reduce((sum, item) => sum + item.score, 0) / count,
    unexpectedLayerOne: results.reduce((sum, item) => sum + item.layerOneUnexpected.length, 0),
    knownGapLayerOne: results.reduce((sum, item) => sum + item.layerOne.length - item.layerOneUnexpected.length, 0),
    totalCostMicrodollars: results.reduce((sum, item) => sum + (item.costMicrodollars ?? 0), 0),
    meanLatencyMs: results.reduce((sum, item) => sum + item.latencyMs, 0) / count,
  };
}

export type AdvisorEvalComparison = Readonly<{
  /** True when the candidate is at least as good as the baseline on every gate. */
  atLeastAsGood: boolean;
  /** Fixtures where the candidate scored lower than the baseline. */
  regressions: readonly Readonly<{ fixture: AdvisorEvalFixtureId; baseline: number; candidate: number }>[];
  baseline: AdvisorEvalSummary;
  candidate: AdvisorEvalSummary;
}>;

/**
 * Gates: no more invalid outputs, no more unexpected layer 1 violations, and a
 * mean rubric score no lower than the baseline minus `tolerance` (model output
 * varies run to run). Per-fixture drops are listed for review either way.
 */
export function compareAdvisorEval(baseline: readonly AdvisorEvalResult[], candidate: readonly AdvisorEvalResult[], tolerance = 0.05): AdvisorEvalComparison {
  const before = summarizeAdvisorEval(baseline);
  const after = summarizeAdvisorEval(candidate);
  const regressions = candidate.flatMap((item) => {
    const base = baseline.find((other) => other.fixture === item.fixture);
    return base && item.score < base.score ? [{ fixture: item.fixture, baseline: base.score, candidate: item.score }] : [];
  });
  return {
    atLeastAsGood: after.validOutputs >= before.validOutputs && after.unexpectedLayerOne <= before.unexpectedLayerOne && after.meanScore >= before.meanScore - tolerance,
    regressions, baseline: before, candidate: after,
  };
}
