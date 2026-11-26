import { planBriefMoveLinesFromInputs, type BriefMoveCandidate } from "@cadence/core/resolvers/brief-move.resolver";
import { planBriefPairingLines } from "@cadence/core/resolvers/alongside-pairing.resolver";
import { formatBriefingTime } from "@cadence/core/services/daily-brief-presentation";
import type { DailyBriefGenerator, DailyBriefModelUsage } from "../daily-brief-consumer";
import { writeBriefWords, type DailyBriefWords } from "../daily-brief.service";
import { modelPrice, usageMicrodollars } from "../agent-model-pricing";
import { briefEvalFixtures, type BriefEvalFixture, type BriefEvalFixtureId } from "./brief-fixtures";
import { BRIEF_DAY_NOTE_RULE, checkBriefDayNoteNotQuoted, checkBriefLayerOne, type BriefLayerOneViolation } from "./brief-rules";
import type { RubricCriterion } from "./harness";

/**
 * Advisor Phase 3 (3A2) eval harness. For each synthetic account it runs 3A1's
 * planner (no model), checks every line against the layer 1 rules, then writes the
 * brief's words through the production path (`writeBriefWords`: the short prompt, the
 * model call, and Cadence's per-field fallback). It records what a person would see,
 * a deterministic rubric, latency and cost. Output stays in the returned result.
 *
 * Pass bars (Emi, Nov 18): the brief appears in under 5 s; a month with both refreshes
 * used every day stays under the US$0.50 Daily Brief share; wording quality, graded
 * blind by `npm run advisor:grade`, is no lower than today's brief; the cheaper model
 * wins ties unless the other is clearly better written.
 */

/** The Daily Brief share of the monthly budget, in microdollars. */
export const BRIEF_MONTHLY_SHARE_MICRODOLLARS = 500_000;
/** A morning brief plus two refreshes, every day of a 31-day month. */
export const BRIEFS_PER_MONTH_WORST_CASE = 3 * 31;
/**
 * The model call's share of the 5 s bar, at the 95th percentile. The rest of the request
 * (sign-in, context capture, the saves) is not measured here; 1 s is set aside for it and
 * the live acceptance check times the whole request.
 */
export const BRIEF_WORDS_P95_BUDGET_MS = 4_000;

export type BriefEvalRun = Readonly<{ label: string; model: string; generate: DailyBriefGenerator }>;

export type BriefEvalLine = Readonly<{ key: string; title: string; from: string; to: string; reasonCode: string; anchor: string | null; reason: string; modelReason: boolean }>;

export type BriefEvalResult = Readonly<{
  fixture: BriefEvalFixtureId;
  label: string;
  model: string;
  lines: readonly BriefEvalLine[];
  opening: string;
  /** What a person reads: the opening, then each line. */
  shown: string;
  source: DailyBriefWords["source"];
  fallbacks: readonly string[];
  failure: string | null;
  modelCalls: number;
  layerOne: readonly BriefLayerOneViolation[];
  rubric: readonly RubricCriterion[];
  score: number;
  usage: DailyBriefModelUsage | null;
  costMicrodollars: number | null;
  plannerMs: number;
  /** The words step only (prompt build, model call, checks). Zero on a quiet day. */
  wordsMs: number;
}>;

export async function runBriefEval(input: Readonly<{ run: BriefEvalRun; fixtures?: readonly BriefEvalFixture[]; clock?: () => number }>): Promise<BriefEvalResult[]> {
  const results: BriefEvalResult[] = [];
  for (const fixture of input.fixtures ?? briefEvalFixtures()) results.push(await runFixture(fixture, input.run, input.clock ?? (() => performance.now())));
  return results;
}

async function runFixture(fixture: BriefEvalFixture, run: BriefEvalRun, clock: () => number): Promise<BriefEvalResult> {
  const plannerStarted = clock();
  const moves = planBriefMoveLinesFromInputs(fixture.plan);
  // Ticket 361: flag-on fixtures add pairing lines after the move lines, as planBriefMoveDay does.
  const plan = fixture.pairing ? { ...moves, candidates: [...moves.candidates, ...planBriefPairingLines({ ...fixture.plan, evidence: fixture.pairing }, moves.candidates)] } : moves;
  const plannerMs = clock() - plannerStarted;
  const layerOne = checkBriefLayerOne(fixture.plan, plan.candidates);
  const usages: DailyBriefModelUsage[] = [];
  let calls = 0;
  const generate: DailyBriefGenerator = (request) => { calls += 1; return run.generate(request); };
  const signal = new AbortController().signal;
  const started = clock();
  const words = await writeBriefWords({ context: fixture.context, candidates: plan.candidates, conflicts: [], calendar: plan.calendar, now: fixture.now,
    signal, requestSignal: signal, generate, onUsage: (usage) => usages.push(usage), ...(fixture.dayNotes ? { dayNotes: fixture.dayNotes } : {}) });
  const wordsMs = calls ? clock() - started : 0;
  const lines = plan.candidates.map((line) => evalLine(line, words, fixture.context.timezone));
  const shown = [words.opening, ...lines.map((line) => `${line.title}: ${line.from} → ${line.to}. ${line.reason}`)].join("\n");
  const usage = usages.length ? sumUsage(usages) : null;
  const failure = words.failure ? (words.failure.error instanceof Error ? `${words.failure.kind}:${(words.failure.error as { reason?: string }).reason ?? words.failure.error.message}` : words.failure.kind) : null;
  const rubric = scoreBriefRubric({ fixture, plan: plan.candidates, words, lines, calls, layerOne });
  const price = modelPrice(run.model);
  return {
    fixture: fixture.id, label: run.label, model: run.model, lines, opening: words.opening, shown, source: words.source, fallbacks: words.fallbacks, failure,
    modelCalls: calls, layerOne, rubric, score: rubric.filter((item) => item.passed).length / (rubric.length || 1), usage,
    costMicrodollars: usage && price ? usageMicrodollars(price, usage) : usage ? null : 0, plannerMs, wordsMs,
  };
}

function evalLine(line: BriefMoveCandidate, words: DailyBriefWords, timezone: string): BriefEvalLine {
  const time = (value: string) => formatBriefingTime(value, timezone).replace(/\s/gu, " ");
  const reason = words.reasons[line.key] ?? line.reason;
  return { key: line.key, title: line.title, from: time(line.from.startAt), to: time(line.to.startAt), reasonCode: line.reasonCode,
    anchor: line.anchor?.title ?? null, reason, modelReason: words.source === "model" && reason !== line.reason };
}

/** Cadence's internal vocabulary, which a person should never read. */
const INTERNAL_WORDS = /\b(planner|slot|feasible|intervals?|coverage|constraints?|buffer|candidate|occurrence|reason ?code|anchor)\b/i;
/** Phrases that claim a track record. A new account has none. */
const HISTORY_CLAIMS = /\b(usual(ly)?|normal(ly)?|typical(ly)?|as always|streak|in a row|lately|recently|last (week|time)|you've been|you have been|most days|consistent(ly)?)\b|\d+\s?%/i;
/** Words that tell the person a change already happened. Nothing moves until they say yes. */
const ALREADY_MOVED = /\b(i('ve| have)? moved|i('ve| have)? rescheduled|has been moved|have been moved|was moved|were moved|i shifted)\b/i;

export function scoreBriefRubric(input: Readonly<{
  fixture: BriefEvalFixture;
  plan: readonly BriefMoveCandidate[];
  words: DailyBriefWords;
  lines: readonly BriefEvalLine[];
  calls: number;
  layerOne: readonly BriefLayerOneViolation[];
}>): RubricCriterion[] {
  const { fixture, words, lines } = input;
  const text = [words.opening, ...lines.map((line) => line.reason)].join(" ");
  const criteria: RubricCriterion[] = [
    { id: "layer1_clean", passed: input.layerOne.length === 0, ...(input.layerOne.length ? { detail: input.layerOne.map((item) => item.rule).join(",") } : {}) },
  ];
  const ids = new Set(input.plan.map((line) => line.occurrenceId));
  if (fixture.expect.noLines) criteria.push({ id: "no_lines", passed: ids.size === 0 && input.calls === 0, ...(ids.size ? { detail: [...ids].join(",") } : {}) });
  for (const id of fixture.expect.movesOccurrences ?? []) criteria.push({ id: `moves:${id}`, passed: ids.has(id) });
  for (const id of fixture.expect.keepsOccurrences ?? []) criteria.push({ id: `keeps:${id}`, passed: !ids.has(id) });
  for (const pair of fixture.expect.pairs ?? []) {
    criteria.push({ id: `pairs:${pair.guest}:${pair.host}`, passed: input.plan.some((line) => line.occurrenceId === pair.guest
      && line.reasonCode === "alongside_pairing" && line.pairing?.hostOccurrenceId === pair.host) });
  }
  if (!lines.length) return criteria;
  // Wording, only when there is something to say.
  criteria.push({ id: "model_words_used", passed: words.source === "model" && words.fallbacks.length === 0,
    ...(words.fallbacks.length ? { detail: words.fallbacks.join(",") } : words.source !== "model" ? { detail: "stock" } : {}) });
  const anchored = lines.filter((line) => line.anchor);
  if (anchored.length) {
    const missing = anchored.filter((line) => !line.reason.toLowerCase().includes(line.anchor!.toLowerCase()));
    criteria.push({ id: "names_what_it_works_around", passed: missing.length === 0, ...(missing.length ? { detail: missing.map((line) => line.title).join(", ") } : {}) });
  }
  const jargon = text.match(INTERNAL_WORDS);
  criteria.push({ id: "plain_words", passed: !jargon, ...(jargon ? { detail: jargon[0] } : {}) });
  const moved = text.match(ALREADY_MOVED);
  criteria.push({ id: "no_change_claimed", passed: !moved, ...(moved ? { detail: moved[0] } : {}) });
  if (fixture.expect.noHistoryClaims) {
    const match = text.match(HISTORY_CLAIMS);
    criteria.push({ id: "no_history_claims", passed: !match, ...(match ? { detail: match[0] } : {}) });
  }
  if (fixture.dayNotes?.length) {
    criteria.push({ id: BRIEF_DAY_NOTE_RULE, ...checkBriefDayNoteNotQuoted({ dayNotes: fixture.dayNotes, texts: [words.opening, ...lines.map((line) => line.reason)], fallbacks: words.fallbacks }) });
  }
  if (fixture.expect.forbiddenText?.length) {
    const lower = text.toLowerCase();
    const found = fixture.expect.forbiddenText.filter((item) => lower.includes(item.toLowerCase()));
    criteria.push({ id: "no_injection_echo", passed: found.length === 0, ...(found.length ? { detail: found.join(", ") } : {}) });
  }
  return criteria;
}

function sumUsage(items: readonly DailyBriefModelUsage[]): DailyBriefModelUsage {
  const total = (pick: (item: DailyBriefModelUsage) => number | null | undefined) =>
    items.reduce<number | null>((sum, item) => { const value = pick(item); return value == null ? sum : (sum ?? 0) + value; }, null);
  return { inputTokens: total((item) => item.inputTokens), cachedInputTokens: total((item) => item.cachedInputTokens),
    cacheWriteTokens: total((item) => item.cacheWriteTokens), outputTokens: total((item) => item.outputTokens), reasoningTokens: total((item) => item.reasoningTokens) };
}

export type BriefEvalSummary = Readonly<{
  label: string;
  model: string;
  fixtures: number;
  /** Briefs that called the model (a quiet day does not). */
  calledBriefs: number;
  layerOneViolations: number;
  meanScore: number;
  /** Briefs that used Cadence's stock words for at least one field. */
  briefsWithFallback: number;
  failures: number;
  meanCostPerBriefMicrodollars: number;
  maxCostPerBriefMicrodollars: number;
  /** Mean brief cost times 93 (a morning brief and two refreshes every day of a 31-day month). */
  worstMonthMicrodollars: number;
  p50WordsMs: number;
  p95WordsMs: number;
  maxPlannerMs: number;
  passes: Readonly<{ cost: boolean; speed: boolean; rules: boolean }>;
}>;

export function summarizeBriefEval(results: readonly BriefEvalResult[]): BriefEvalSummary {
  const called = results.filter((item) => item.modelCalls > 0);
  const costs = called.map((item) => item.costMicrodollars ?? 0);
  const mean = costs.length ? costs.reduce((sum, value) => sum + value, 0) / costs.length : 0;
  const times = called.map((item) => item.wordsMs).sort((left, right) => left - right);
  const pick = (share: number) => times.length ? times[Math.min(times.length - 1, Math.ceil(share * times.length) - 1)]! : 0;
  const layerOne = results.reduce((sum, item) => sum + item.layerOne.length, 0);
  const worst = Math.round(mean * BRIEFS_PER_MONTH_WORST_CASE);
  return {
    label: results[0]?.label ?? "", model: results[0]?.model ?? "", fixtures: results.length, calledBriefs: called.length,
    layerOneViolations: layerOne,
    meanScore: results.reduce((sum, item) => sum + item.score, 0) / (results.length || 1),
    briefsWithFallback: called.filter((item) => item.source !== "model" || item.fallbacks.length > 0).length,
    failures: results.filter((item) => item.failure).length,
    meanCostPerBriefMicrodollars: Math.round(mean), maxCostPerBriefMicrodollars: Math.max(0, ...costs),
    worstMonthMicrodollars: worst, p50WordsMs: Math.round(pick(0.5)), p95WordsMs: Math.round(pick(0.95)),
    maxPlannerMs: Math.round(Math.max(0, ...results.map((item) => item.plannerMs)) * 100) / 100,
    passes: { cost: worst <= BRIEF_MONTHLY_SHARE_MICRODOLLARS, speed: pick(0.95) <= BRIEF_WORDS_P95_BUDGET_MS, rules: layerOne === 0 },
  };
}
