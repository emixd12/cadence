import { Temporal } from "@js-temporal/polyfill";

import { resolveCoachSignals, type CoachSignal, type ResolveCoachSignalsInput } from "@cadence/core/resolvers/coach-signals.resolver";
import { ADVICE_CARDS } from "@cadence/core/services/advice-library";
import type { AdviceCard, AdviceCardStatus, AdviceSignalInput } from "@cadence/core/types/advice-cards";

import type { StoredTip, TipHistory, TipToWrite } from "@/lib/db/advisor-tips.repo";
import type { AgentModelUsage } from "../agent-model";
import { modelPrice, usageMicrodollars } from "../agent-model-pricing";
import { chooseTipMatches } from "../advisor-tips-job.service";
import {
  CARD_REST_DAYS,
  FACT_REST_DAYS,
  TIP_INSTRUCTIONS,
  buildTipPrompt,
  checkTipText,
  resolveTipOutput,
  tipItems,
  type TipItem,
  type TipRejection,
} from "../advisor-tips-writer";
import { COACH_EVAL_START, coachEvalFixtures, type CoachEvalFixture, type CoachEvalFixtureId } from "./coach-fixtures";

/**
 * Advisor plan Phase 4, workstream 4B step 8: the coach eval. Each synthetic account is
 * visited on several mornings in a row, exactly as the nightly tip run does it: signals,
 * card matching against the tips already shown, one model call when there is something
 * new, code checks, seeds for refused lines. Every shipped tip then goes through the
 * layer-1 rules below. Cards are all drafts until the owner reviews them, so the eval
 * matches drafts too.
 */

export const COACH_LAYER_ONE_RULES = [
  "card_unknown", "line_fails_checks", "fact_counts_unmarked", "card_repeated", "fact_repeated",
  "notes_sent_when_off", "note_quoted", "forbidden_text",
] as const;
export type CoachLayerOneRule = typeof COACH_LAYER_ONE_RULES[number];
export type CoachLayerOneViolation = Readonly<{ rule: CoachLayerOneRule; localDate: string; cardId: string | null; detail: string }>;

/** Kinds that describe the planned day or the unmarked items themselves, so counting unmarked rows is their purpose. */
const PLANNED_DAY_KINDS = new Set(["account", "unmarked_items", "day_shape", "crowded_hour", "setup_gaps"]);

/** Pass bars (Claude's defaults; the owner can change them). */
export const COACH_EVAL_PASS = { ruleBreaks: 0, meanGrade: 4, p95MonthlyMicrodollars: 250_000 } as const;

export type CoachTipGenerator = (input: Readonly<{ instructions: string; prompt: string; onUsage(usage: AgentModelUsage): void }>) => Promise<unknown>;
export type CoachEvalRun = Readonly<{ label: string; model: string; generate: CoachTipGenerator }>;

export type CoachEvalDay = Readonly<{
  localDate: string;
  items: readonly Readonly<{ ref: string; cardId: string; behavior: string | null; facts: Record<string, unknown>; advice: string; action: string }>[];
  tips: readonly Readonly<{ text: string; cardId: string; source: "model" | "seed" }>[];
  modelCalls: number;
  costMicrodollars: number;
  latencyMs: number | null;
  rejected: readonly TipRejection[];
  error: string | null;
  violations: readonly CoachLayerOneViolation[];
}>;

export type CoachEvalResult = Readonly<{ fixture: CoachEvalFixtureId; label: string; model: string; days: readonly CoachEvalDay[] }>;

export async function runCoachEval(input: Readonly<{
  run: CoachEvalRun;
  fixtures?: readonly CoachEvalFixture[];
  days?: number;
  cards?: readonly AdviceCard[];
  statuses?: readonly AdviceCardStatus[];
  maxPerDay?: number;
  clock?: () => number;
}>): Promise<CoachEvalResult[]> {
  const fixtures = input.fixtures ?? coachEvalFixtures();
  const cards = input.cards ?? ADVICE_CARDS;
  const statuses = input.statuses ?? ["draft", "active"];
  const clock = input.clock ?? (() => performance.now());
  const price = modelPrice(input.run.model);
  const results: CoachEvalResult[] = [];
  for (const fixture of fixtures) {
    const shown: StoredTip[] = [];
    const days: CoachEvalDay[] = [];
    for (let offset = 0; offset < (input.days ?? 7); offset += 1) {
      const localDate = Temporal.PlainDate.from(COACH_EVAL_START).add({ days: offset }).toString();
      const signalInput = fixture.inputFor(localDate);
      const signals = toAdviceSignals(resolveCoachSignals(signalInput));
      const history: TipHistory = { tips: shown.filter((tip) => tip.localDate >= addDays(localDate, -CARD_REST_DAYS)), suppressedCardIds: [] };
      const { chosen } = chooseTipMatches({
        localDate, signals, setup: { behaviors: signalInput.behaviors, occurrences: signalInput.occurrences, titles: fixture.titles },
        history, cards, statuses, maxPerDay: input.maxPerDay ?? 3,
      });
      const items = tipItems(chosen, fixture.titles);
      let tips: TipToWrite[] = [];
      let rejected: readonly TipRejection[] = [];
      let modelCalls = 0;
      let cost = 0;
      let latencyMs: number | null = null;
      let error: string | null = null;
      let prompt = "";
      if (items.length) {
        prompt = buildTipPrompt({ items, notes: fixture.notesAllowed ? fixture.notesFor(localDate) : null });
        let usage: AgentModelUsage | null = null;
        const started = clock();
        let output: unknown = null;
        try {
          output = await input.run.generate({ instructions: TIP_INSTRUCTIONS, prompt, onUsage: (item) => { usage = item; } });
          modelCalls = 1;
        } catch (caught) {
          modelCalls = 1;
          error = caught instanceof Error ? caught.message.slice(0, 200) : "model_error";
        }
        latencyMs = clock() - started;
        if (price && usage) cost = usageMicrodollars(price, usage) ?? 0;
        const outcome = resolveTipOutput(output, items);
        tips = outcome.tips;
        rejected = outcome.rejected;
      }
      const violations = checkCoachLayerOne({ fixture, localDate, signalInput, items, tips, history, prompt, cards, statuses });
      days.push({
        localDate,
        items: items.map((item) => ({
          ref: item.ref, cardId: item.match.card.id, behavior: item.behaviorTitle,
          facts: Object.fromEntries(item.match.factNames.map((name) => [name, item.match.signal.facts[name] ?? null])),
          advice: item.match.card.advice, action: item.match.card.action,
        })),
        tips: tips.map((tip) => ({ text: tip.text, cardId: tip.cardId, source: tip.source })),
        modelCalls, costMicrodollars: cost, latencyMs, rejected, error, violations,
      });
      // The app shows every written tip that day.
      tips.forEach((tip, index) => shown.push({
        localDate, position: index + 1, cardId: tip.cardId, behaviorId: tip.behaviorId, factIds: tip.factIds,
        factValues: tip.factValues, source: tip.source, shownAt: `${localDate}T12:00:00Z`, reaction: null,
      }));
    }
    results.push({ fixture: fixture.id, label: input.run.label, model: input.run.model, days });
  }
  return results;
}

export function toAdviceSignals(signals: readonly CoachSignal[]): AdviceSignalInput[] {
  return signals.map((signal) => ({ id: `${signal.kind}:${signal.behaviorId ?? "account"}`, kind: signal.kind as AdviceSignalInput["kind"], behaviorId: signal.behaviorId, facts: signal.facts as Record<string, unknown> }));
}

export function checkCoachLayerOne(input: Readonly<{
  fixture: CoachEvalFixture;
  localDate: string;
  signalInput: ResolveCoachSignalsInput;
  items: readonly TipItem[];
  tips: readonly TipToWrite[];
  history: TipHistory;
  prompt: string;
  cards: readonly AdviceCard[];
  statuses: readonly AdviceCardStatus[];
}>): CoachLayerOneViolation[] {
  const out: CoachLayerOneViolation[] = [];
  const add = (rule: CoachLayerOneRule, cardId: string | null, detail: string) => out.push({ rule, localDate: input.localDate, cardId, detail });
  const itemByCard = new Map(input.items.map((item) => [item.match.card.id, item]));
  // Signals again with every past unmarked row left out: a fact a tip uses must not change.
  const stripped = resolveCoachSignals({ ...input.signalInput,
    occurrences: input.signalInput.occurrences.filter((row) => row.status !== "unresolved" || row.localDate >= input.localDate) });
  if (!input.fixture.notesAllowed && input.prompt.includes("recent_day_notes")) add("notes_sent_when_off", null, "notes in the prompt");
  const today = Temporal.PlainDate.from(input.localDate);
  const daysAgo = (date: string) => Temporal.PlainDate.from(date).until(today, { largestUnit: "days" }).days;
  for (const tip of input.tips) {
    const card = input.cards.find((entry) => entry.id === tip.cardId);
    if (!card || !input.statuses.includes(card.status)) add("card_unknown", tip.cardId, "card not in the library or not allowed");
    const item = itemByCard.get(tip.cardId);
    if (!item) { add("card_unknown", tip.cardId, "tip without a matched item"); continue; }
    const check = checkTipText(tip.text, item.match, item.behaviorTitle);
    if (!check.ok) add("line_fails_checks", tip.cardId, check.reason);
    if (!PLANNED_DAY_KINDS.has(item.match.signal.kind)) {
      const twin = stripped.find((signal) => signal.kind === item.match.signal.kind && signal.behaviorId === item.match.signal.behaviorId);
      for (const name of item.match.factNames) {
        const before = JSON.stringify(item.match.signal.facts[name] ?? null);
        const after = JSON.stringify((twin?.facts as Record<string, unknown> | undefined)?.[name] ?? null);
        if (before !== after) add("fact_counts_unmarked", tip.cardId, `${item.match.signal.kind}.${name}: ${before} vs ${after} without unmarked rows`);
      }
    }
    const shown = input.history.tips.filter((old) => old.shownAt !== null);
    const sameValue = (id: string, old: StoredTip) => JSON.stringify(old.factValues[id] ?? null) === JSON.stringify(tip.factValues[id] ?? null);
    const recentCard = shown.filter((old) => old.cardId === tip.cardId && daysAgo(old.localDate) < CARD_REST_DAYS);
    if (recentCard.length && tip.factIds.every((id) => recentCard.some((old) => old.factIds.includes(id) && sameValue(id, old)))) {
      add("card_repeated", tip.cardId, "same card within 14 days with no new fact");
    }
    const ids = Object.keys(tip.factValues);
    if (ids.length && ids.every((id) => shown.some((old) => daysAgo(old.localDate) < FACT_REST_DAYS && old.factIds.includes(id) && sameValue(id, old)))) {
      add("fact_repeated", tip.cardId, "every fact stated with the same value within 7 days");
    }
    // The Behavior's own title may be named; anything else from it or from notes may not.
    const lower = (item.behaviorTitle ? tip.text.split(item.behaviorTitle).join(" ") : tip.text).toLowerCase();
    for (const text of input.fixture.forbiddenText) if (lower.includes(text.toLowerCase())) add("forbidden_text", tip.cardId, text);
    for (const note of input.fixture.notesFor(input.localDate)) {
      const words = note.note.toLowerCase().replace(/[^a-z0-9' ]/g, " ").split(/\s+/).filter(Boolean);
      for (let i = 0; i + 4 <= words.length; i += 1) {
        if (lower.replace(/[^a-z0-9' ]/g, " ").replace(/\s+/g, " ").includes(words.slice(i, i + 4).join(" "))) {
          add("note_quoted", tip.cardId, words.slice(i, i + 4).join(" "));
          break;
        }
      }
    }
  }
  return out;
}

export type CoachEvalSummary = Readonly<{
  label: string;
  model: string;
  accounts: number;
  days: number;
  tips: number;
  modelTips: number;
  seedTips: number;
  modelCalls: number;
  callErrors: number;
  /** Model lines refused by the checks, out of all model lines asked for. */
  rejectedLines: number;
  ruleBreaks: number;
  byRule: Readonly<Record<string, number>>;
  /** Cost per account scaled to a 30-day month from the simulated days. */
  meanMonthlyMicrodollars: number;
  p95MonthlyMicrodollars: number;
  p95LatencyMs: number | null;
}>;

export function summarizeCoachEval(results: readonly CoachEvalResult[]): CoachEvalSummary {
  const days = results.flatMap((result) => result.days);
  const monthly = results.map((result) => result.days.reduce((sum, day) => sum + day.costMicrodollars, 0) * 30 / Math.max(1, result.days.length));
  const latencies = days.flatMap((day) => day.latencyMs === null ? [] : [day.latencyMs]);
  const byRule: Record<string, number> = {};
  for (const violation of days.flatMap((day) => day.violations)) byRule[violation.rule] = (byRule[violation.rule] ?? 0) + 1;
  const tips = days.flatMap((day) => day.tips);
  return {
    label: results[0]?.label ?? "", model: results[0]?.model ?? "",
    accounts: results.length, days: days.length, tips: tips.length,
    modelTips: tips.filter((tip) => tip.source === "model").length, seedTips: tips.filter((tip) => tip.source === "seed").length,
    modelCalls: days.reduce((sum, day) => sum + day.modelCalls, 0), callErrors: days.filter((day) => day.error).length,
    rejectedLines: days.reduce((sum, day) => sum + day.rejected.length, 0),
    ruleBreaks: Object.values(byRule).reduce((sum, value) => sum + value, 0), byRule,
    meanMonthlyMicrodollars: monthly.length ? Math.round(monthly.reduce((sum, value) => sum + value, 0) / monthly.length) : 0,
    p95MonthlyMicrodollars: Math.round(percentile(monthly, 0.95)),
    p95LatencyMs: latencies.length ? Math.round(percentile(latencies, 0.95)) : null,
  };
}

function percentile(values: readonly number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]!;
}

function addDays(localDate: string, days: number): string {
  return Temporal.PlainDate.from(localDate).add({ days }).toString();
}
