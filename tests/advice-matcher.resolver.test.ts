import { describe, expect, it } from "vitest";

import { matchAdviceCards, conditionHolds } from "@cadence/core/resolvers/advice-matcher.resolver";
import type { AdviceAccountFacts, AdviceCard, AdviceSignalInput } from "@cadence/core/types/advice-cards";

// Advisor plan Phase 4, workstream 4A. Fixture cards are built here, not read from the
// library, so these tests pin the matcher's rules rather than today's content.

const TODAY = "2026-11-19";

const ACCOUNT: AdviceAccountFacts = {
  account_age_days: 60, active_behaviors: 5, behaviors_with_window: 1, behaviors_with_set_time: 4,
  behaviors_without_length: 2, behaviors_without_place: 3, morning_items: 6, afternoon_items: 4, evening_items: 3,
  max_items_same_hour: 2, behaviors_created_last_14_days: 0,
};

function card(overrides: Partial<AdviceCard> & Pick<AdviceCard, "id">): AdviceCard {
  return {
    revision: 1, status: "active", advice: "Advice.", action: "Action.", limitation: "Limitation.",
    applies_when: [{ signal: "completion_drop", scope: "behavior", facts: [] }], does_not_apply_when: [],
    evidence: { source_id: "s", kind: "meta_analysis", strength: "moderate", claim: "Claim.", quote: "Quote.", locator: "Abstract" },
    quip_seeds: ["{behavior}: {recent_completed} of {recent_resolved}.", "Two."], audience: "any_account",
    reviewed_at: "2026-11-19", reviewer: "Emi", offer: null,
    ...overrides,
  };
}

const DROP: AdviceSignalInput = { id: "sig-1", kind: "completion_drop", behaviorId: "b-gym", facts: { recent_completed: 2, recent_resolved: 8, recent_rate: 0.25, drop: 0.5 } };

describe("matchAdviceCards", () => {
  it("matches an active card to its signal and names the facts and fact ids", () => {
    const [match, ...rest] = matchAdviceCards({ cards: [card({ id: "a" })], signals: [DROP], account: ACCOUNT, today: TODAY });
    expect(rest).toEqual([]);
    expect(match!.behaviorId).toBe("b-gym");
    expect(match!.factNames).toEqual(["recent_completed", "recent_resolved"]);
    expect(match!.factIds).toEqual(["completion_drop:b-gym:recent_completed", "completion_drop:b-gym:recent_resolved"]);
    expect(match!.matchStrength).toBe(2);
    expect(match!.daysSinceShown).toBeNull();
  });

  it("keeps drafts, withdrawn and turned-off cards away from people", () => {
    const cards = [card({ id: "draft", status: "draft", reviewer: null, reviewed_at: null }), card({ id: "gone", status: "withdrawn" }), card({ id: "off" })];
    expect(matchAdviceCards({ cards, signals: [DROP], account: ACCOUNT, today: TODAY, suppressedCardIds: ["off"] })).toEqual([]);
    expect(matchAdviceCards({ cards, signals: [DROP], account: ACCOUNT, today: TODAY, statuses: ["draft"] }).map((m) => m.card.id)).toEqual(["draft"]);
  });

  it("tests fact conditions and scope", () => {
    const strict = card({ id: "strict", applies_when: [{ signal: "completion_drop", scope: "behavior", facts: [{ fact: "drop", op: "gte", value: 0.6 }] }] });
    const accountOnly = card({ id: "acct", applies_when: [{ signal: "completion_drop", scope: "account", facts: [] }], quip_seeds: ["{recent_completed}.", "Two."] });
    expect(matchAdviceCards({ cards: [strict, accountOnly], signals: [DROP], account: ACCOUNT, today: TODAY })).toEqual([]);
    const loose = card({ id: "loose", applies_when: [{ signal: "completion_drop", scope: "behavior", facts: [{ fact: "drop", op: "gte", value: 0.4 }] }] });
    expect(matchAdviceCards({ cards: [loose], signals: [DROP], account: ACCOUNT, today: TODAY })[0]!.matchStrength).toBe(3);
  });

  it("excludes a card when does_not_apply_when holds for the same Behavior or the account, not another Behavior", () => {
    const guarded = card({ id: "g", does_not_apply_when: [{ signal: "steady_behavior", scope: "either", facts: [] }] });
    const other: AdviceSignalInput = { kind: "steady_behavior", behaviorId: "b-reading", facts: {} };
    const same: AdviceSignalInput = { kind: "steady_behavior", behaviorId: "b-gym", facts: {} };
    const wide: AdviceSignalInput = { kind: "steady_behavior", behaviorId: null, facts: {} };
    expect(matchAdviceCards({ cards: [guarded], signals: [DROP, other], account: ACCOUNT, today: TODAY })).toHaveLength(1);
    expect(matchAdviceCards({ cards: [guarded], signals: [DROP, same], account: ACCOUNT, today: TODAY })).toEqual([]);
    expect(matchAdviceCards({ cards: [guarded], signals: [DROP, wide], account: ACCOUNT, today: TODAY })).toEqual([]);
    const setup = card({ id: "s", does_not_apply_when: [{ signal: "account", scope: "account", facts: [{ fact: "active_behaviors", op: "gte", value: 5 }] }] });
    expect(matchAdviceCards({ cards: [setup], signals: [DROP], account: ACCOUNT, today: TODAY })).toEqual([]);
  });

  it("can hold back a card while items sit unmarked", () => {
    const steady = card({
      id: "steady", applies_when: [{ signal: "steady_behavior", scope: "behavior", facts: [] }], quip_seeds: ["{behavior}.", "Two."],
      does_not_apply_when: [{ signal: "unmarked_items", scope: "either", facts: [{ fact: "oldest_days", op: "gte", value: 5 }] }],
    });
    const held: AdviceSignalInput = { kind: "steady_behavior", behaviorId: "b-gym", facts: { rate: 0.95 } };
    const lapsed: AdviceSignalInput = { kind: "unmarked_items", behaviorId: null, facts: { unmarked: 9, oldest_days: 9 } };
    const fresh: AdviceSignalInput = { kind: "unmarked_items", behaviorId: null, facts: { unmarked: 1, oldest_days: 1 } };
    expect(matchAdviceCards({ cards: [steady], signals: [held, lapsed], account: ACCOUNT, today: TODAY })).toEqual([]);
    expect(matchAdviceCards({ cards: [steady], signals: [held, fresh], account: ACCOUNT, today: TODAY })).toHaveLength(1);
  });

  it("names facts behind counted and formatted placeholders", () => {
    const c = card({ id: "f", quip_seeds: ["{recent_completed|item|items} by {mark_time_clock}.", "Two."] });
    const [match] = matchAdviceCards({ cards: [c], signals: [{ ...DROP, facts: { ...DROP.facts, mark_time: "21:00" } }], account: ACCOUNT, today: TODAY });
    expect(match!.factNames).toEqual(["mark_time", "recent_completed"]);
  });

  it("serves first-two-weeks cards from setup facts alone, only to new accounts", () => {
    const starter = card({
      id: "starter", audience: "first_two_weeks",
      applies_when: [{ signal: "account", scope: "account", facts: [{ fact: "behaviors_without_length", op: "gte", value: 1 }] }],
      quip_seeds: ["{behaviors_without_length} items have no length yet.", "Two."],
    });
    const young = { ...ACCOUNT, account_age_days: 3 };
    const [match] = matchAdviceCards({ cards: [starter], signals: [], account: young, today: TODAY });
    expect(match!.signal.kind).toBe("account");
    expect(match!.factIds).toEqual(["account:account:behaviors_without_length"]);
    expect(matchAdviceCards({ cards: [starter], signals: [], account: ACCOUNT, today: TODAY })).toEqual([]);
    const history = card({ id: "h", audience: "history_needed" });
    expect(matchAdviceCards({ cards: [history], signals: [DROP], account: young, today: TODAY })).toEqual([]);
  });

  it("ranks by match, evidence and days since shown, deterministically", () => {
    const strong = card({ id: "b-strong", evidence: { ...card({ id: "x" }).evidence, strength: "strong" } });
    const recent = card({ id: "a-recent", evidence: { ...card({ id: "x" }).evidence, strength: "strong" } });
    const limited = card({ id: "c-limited", evidence: { ...card({ id: "x" }).evidence, strength: "limited" } });
    const ranked = matchAdviceCards({
      cards: [limited, recent, strong], signals: [DROP], account: ACCOUNT, today: TODAY,
      shown: [{ cardId: "a-recent", localDate: "2026-11-17" }, { cardId: "a-recent", localDate: "2026-10-01" }],
    });
    expect(ranked.map((m) => m.card.id)).toEqual(["b-strong", "c-limited", "a-recent"]);
    expect(ranked[2]!.daysSinceShown).toBe(2);
  });

  it("returns one match per card and Behavior, the strongest", () => {
    const two = card({ id: "two", applies_when: [
      { signal: "completion_drop", scope: "behavior", facts: [] },
      { signal: "completion_drop", scope: "behavior", facts: [{ fact: "drop", op: "gt", value: 0.3 }] },
    ] });
    const second: AdviceSignalInput = { ...DROP, behaviorId: "b-reading" };
    const matches = matchAdviceCards({ cards: [two], signals: [DROP, second], account: ACCOUNT, today: TODAY });
    expect(matches.map((m) => [m.behaviorId, m.matchStrength])).toEqual([["b-gym", 3], ["b-reading", 3]]);
  });
});

describe("conditionHolds", () => {
  it("compares only like types and never matches a missing fact", () => {
    expect(conditionHolds({ fact: "x", op: "gte", value: 3 }, 3)).toBe(true);
    expect(conditionHolds({ fact: "x", op: "lt", value: 3 }, "2")).toBe(false);
    expect(conditionHolds({ fact: "x", op: "eq", value: "later" }, "later")).toBe(true);
    expect(conditionHolds({ fact: "x", op: "in", value: [6, 7] }, 7)).toBe(true);
    expect(conditionHolds({ fact: "x", op: "ne", value: true }, undefined)).toBe(false);
    expect(conditionHolds({ fact: "x", op: "eq", value: 0 }, null)).toBe(false);
  });
});
