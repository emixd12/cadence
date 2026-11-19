import { Temporal } from "@js-temporal/polyfill";
import type {
  AdviceAccountFacts,
  AdviceCard,
  AdviceCardShown,
  AdviceCardStatus,
  AdviceEvidenceStrength,
  AdviceFactCondition,
  AdviceMatch,
  AdviceRule,
  AdviceSignalInput,
} from "../types/advice-cards";

/**
 * Advice matcher (advisor plan, Phase 4 workstream 4A).
 *
 * Deterministic: coach signals plus the account's setup facts in, ranked cards out. No model
 * call and no embeddings. A card matches when any `applies_when` rule holds for a signal and
 * no `does_not_apply_when` rule holds for the same Behavior or the whole account. There is no
 * category or health exclusion (Phase 4 decision D6). Ranking weighs match strength,
 * evidence strength and days since the card was last shown; callers apply their own repeat
 * windows (4B: no card within 14 days) using `daysSinceShown`.
 */

export const ADVICE_MATCHER_VERSION = "advice-matcher-1";

/** Accounts younger than this many days get "first two weeks" cards. */
export const ADVICE_FIRST_WEEKS_DAYS = 14;

const EVIDENCE_WEIGHT: Readonly<Record<AdviceEvidenceStrength, number>> = { strong: 3, moderate: 2, limited: 1, product_rule: 1 };

export type MatchAdviceCardsInput = Readonly<{
  cards: readonly AdviceCard[];
  signals: readonly AdviceSignalInput[];
  account: AdviceAccountFacts;
  /** The account's local date today. */
  today: string;
  /** Cards already shown to this account (any age; older entries simply rank higher). */
  shown?: readonly AdviceCardShown[];
  /** Cards the person asked never to see again. */
  suppressedCardIds?: readonly string[];
  /** Defaults to active only. Evals and the review page may include drafts. */
  statuses?: readonly AdviceCardStatus[];
}>;

export function matchAdviceCards(input: MatchAdviceCardsInput): AdviceMatch[] {
  const statuses = input.statuses ?? ["active"];
  const suppressed = new Set(input.suppressedCardIds ?? []);
  const accountSignal: AdviceSignalInput = { id: null, kind: "account", behaviorId: null, facts: input.account };
  const lastShown = new Map<string, string>();
  for (const entry of input.shown ?? []) {
    const current = lastShown.get(entry.cardId);
    if (!current || entry.localDate > current) lastShown.set(entry.cardId, entry.localDate);
  }
  const today = Temporal.PlainDate.from(input.today);
  const best = new Map<string, AdviceMatch>();

  for (const card of input.cards) {
    if (!statuses.includes(card.status) || suppressed.has(card.id)) continue;
    if (!audienceFits(card, input.account)) continue;
    const shownDate = lastShown.get(card.id);
    const daysSinceShown = shownDate ? Math.max(0, Temporal.PlainDate.from(shownDate).until(today, { largestUnit: "days" }).days) : null;
    for (const rule of card.applies_when) {
      for (const signal of candidates(rule, input.signals, accountSignal)) {
        if (!ruleHolds(rule, signal)) continue;
        const behaviorId = signal.behaviorId;
        if (excluded(card, behaviorId, input.signals, accountSignal)) continue;
        const factNames = namesFor(card, rule, signal);
        const matchStrength = 1 + rule.facts.length + (behaviorId ? 1 : 0);
        const evidenceStrength = card.evidence.strength;
        const score = matchStrength * 2 + EVIDENCE_WEIGHT[evidenceStrength] + recencyWeight(daysSinceShown);
        const match: AdviceMatch = {
          card, signal, behaviorId, factNames,
          factIds: factNames.map((name) => `${signal.kind}:${behaviorId ?? "account"}:${name}`),
          matchStrength, evidenceStrength, daysSinceShown, score,
        };
        const key = `${card.id}|${behaviorId ?? ""}`;
        const current = best.get(key);
        if (!current || match.score > current.score) best.set(key, match);
      }
    }
  }

  return [...best.values()].sort((a, b) =>
    b.score - a.score
    || a.card.id.localeCompare(b.card.id)
    || (a.behaviorId ?? "").localeCompare(b.behaviorId ?? ""));
}

function audienceFits(card: AdviceCard, account: AdviceAccountFacts): boolean {
  if (card.audience === "first_two_weeks") return account.account_age_days < ADVICE_FIRST_WEEKS_DAYS;
  if (card.audience === "history_needed") return account.account_age_days >= ADVICE_FIRST_WEEKS_DAYS;
  return true;
}

function candidates(rule: AdviceRule, signals: readonly AdviceSignalInput[], accountSignal: AdviceSignalInput): readonly AdviceSignalInput[] {
  if (rule.signal === "account") return [accountSignal];
  return signals.filter((signal) => signal.kind === rule.signal && scopeFits(rule, signal));
}

function scopeFits(rule: AdviceRule, signal: AdviceSignalInput): boolean {
  if (rule.scope === "behavior") return signal.behaviorId !== null;
  if (rule.scope === "account") return signal.behaviorId === null;
  return true;
}

function ruleHolds(rule: AdviceRule, signal: AdviceSignalInput): boolean {
  return rule.facts.every((condition) => conditionHolds(condition, signal.facts[condition.fact]));
}

export function conditionHolds(condition: AdviceFactCondition, actual: unknown): boolean {
  if (actual === undefined || actual === null) return false;
  const expected = condition.value;
  switch (condition.op) {
    case "eq": return actual === expected;
    case "ne": return actual !== expected;
    case "in": return Array.isArray(expected) && (typeof actual === "string" || typeof actual === "number") && expected.includes(actual);
    default: {
      if (typeof actual !== "number" || typeof expected !== "number") return false;
      if (condition.op === "gt") return actual > expected;
      if (condition.op === "gte") return actual >= expected;
      if (condition.op === "lt") return actual < expected;
      return actual <= expected;
    }
  }
}

/** An exclusion holds for a signal about the same Behavior, about the whole account, or for setup facts. */
function excluded(card: AdviceCard, behaviorId: string | null, signals: readonly AdviceSignalInput[], accountSignal: AdviceSignalInput): boolean {
  return card.does_not_apply_when.some((rule) =>
    candidates(rule, signals, accountSignal).some((signal) =>
      (signal.behaviorId === null || signal.behaviorId === behaviorId) && ruleHolds(rule, signal)));
}

function namesFor(card: AdviceCard, rule: AdviceRule, signal: AdviceSignalInput): string[] {
  const names = new Set(rule.facts.map((condition) => condition.fact));
  for (const seed of card.quip_seeds) {
    for (const match of seed.matchAll(/\{([a-z0-9_]+)(?:\|[^|{}]+\|[^|{}]+)?\}/g)) {
      const name = match[1]!;
      const base = name === "weekday_name" ? "weekday" : name === "hour_label" ? "hour" : name.replace(/_(pct|clock|duration)$/, "");
      if (base !== "behavior" && signal.facts[base] !== undefined) names.add(base);
    }
  }
  return [...names].sort();
}

function recencyWeight(daysSinceShown: number | null): number {
  if (daysSinceShown === null) return 3;
  if (daysSinceShown >= 14) return 2;
  if (daysSinceShown >= 7) return 1;
  return 0;
}
