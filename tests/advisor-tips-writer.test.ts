import { describe, expect, it } from "vitest";

import { ADVICE_CARDS } from "@cadence/core/services/advice-library";
import { ADVICE_SIGNAL_FACTS, type AdviceCard, type AdviceMatch } from "@cadence/core/types/advice-cards";

import type { StoredTip, TipHistory } from "@/lib/db/advisor-tips.repo";
import {
  checkTipText,
  resolveTipOutput,
  seedTipText,
  seedTips,
  selectTipMatches,
  tipItems,
  tipsPerDay,
} from "@/lib/services/advisor-tips-writer";

// Advisor plan Phase 4, workstream 4B steps 2, 3 and 9: choosing and checking tip lines.

const TODAY = "2026-11-19";

function card(id: string, overrides: Partial<AdviceCard> = {}): AdviceCard {
  return {
    id, revision: 1, status: "active", advice: "Advice.", action: "Pick one fixed time.", limitation: "Limitation.",
    applies_when: [{ signal: "completion_drop", scope: "behavior", facts: [] }], does_not_apply_when: [],
    evidence: { source_id: "s", kind: "meta_analysis", strength: "moderate", claim: "Claim.", quote: "Quote.", locator: "Abstract" },
    quip_seeds: ["{behavior}: {recent_completed} of {recent_resolved} done lately.", "{behavior} slipped to {recent_completed} of {recent_resolved}."],
    audience: "any_account", reviewed_at: TODAY, reviewer: "Emi",
    ...overrides,
  };
}

function match(id: string, facts: Record<string, unknown> = { recent_completed: 2, recent_resolved: 8 }, behaviorId: string | null = "b-gym", kind = "completion_drop"): AdviceMatch {
  const factNames = Object.keys(facts);
  return {
    card: card(id), signal: { id: null, kind: kind as never, behaviorId, facts }, behaviorId, factNames,
    factIds: factNames.map((name) => `${kind}:${behaviorId ?? "account"}:${name}`),
    matchStrength: 2, evidenceStrength: "moderate", daysSinceShown: null, score: 1,
  };
}

function shown(cardId: string, localDate: string, factValues: Record<string, unknown> = { "completion_drop:b-gym:recent_completed": 2, "completion_drop:b-gym:recent_resolved": 8 }): StoredTip {
  return {
    localDate, position: 1, cardId, behaviorId: "b-gym", factIds: Object.keys(factValues), factValues,
    source: "seed", shownAt: `${localDate}T09:00:00Z`, reaction: null,
  };
}

const EMPTY: TipHistory = { tips: [], suppressedCardIds: [] };

describe("tipsPerDay", () => {
  it("defaults to three and accepts one to three", () => {
    expect(tipsPerDay({})).toBe(3);
    expect(tipsPerDay({ CADENCE_COACH_TIPS_PER_DAY: "1" })).toBe(1);
    expect(tipsPerDay({ CADENCE_COACH_TIPS_PER_DAY: "9" })).toBe(3);
  });
});

describe("selectTipMatches", () => {
  it("takes up to the day's room, one per card and per topic", () => {
    const matches = [match("a"), match("b"), match("c", { streak: 4 }, "b-read"), match("d", { streak: 5 }, null, "weekly_numbers")];
    const picked = selectTipMatches({ matches, history: EMPTY, today: TODAY, max: 3 });
    expect(picked.map((m) => m.card.id)).toEqual(["a", "c", "d"]);
  });

  it("rests a card for 14 days unless a fact changed", () => {
    const history: TipHistory = { tips: [shown("a", "2026-11-10")], suppressedCardIds: [] };
    expect(selectTipMatches({ matches: [match("a")], history, today: TODAY, max: 3 })).toEqual([]);
    expect(selectTipMatches({ matches: [match("a", { recent_completed: 1, recent_resolved: 8 })], history, today: TODAY, max: 3 })).toHaveLength(1);
    const older: TipHistory = { tips: [shown("a", "2026-11-01")], suppressedCardIds: [] };
    expect(selectTipMatches({ matches: [match("a")], history: older, today: TODAY, max: 3 })).toHaveLength(1);
  });

  it("does not state the same facts again within 7 days through another card", () => {
    const history: TipHistory = { tips: [shown("other", "2026-11-16")], suppressedCardIds: [] };
    expect(selectTipMatches({ matches: [match("a")], history, today: TODAY, max: 3 })).toEqual([]);
  });

  it("counts tips already shown today and skips cards the person turned off", () => {
    const history: TipHistory = { tips: [shown("x", TODAY, {}), shown("y", TODAY, {})], suppressedCardIds: ["a"] };
    const picked = selectTipMatches({ matches: [match("a"), match("b"), match("c", { streak: 2 }, "b-read")], history, today: TODAY, max: 3 });
    expect(picked.map((m) => m.card.id)).toEqual(["b"]);
  });

  it("ignores tips written but never shown", () => {
    const history: TipHistory = { tips: [{ ...shown("a", "2026-11-18"), shownAt: null }], suppressedCardIds: [] };
    expect(selectTipMatches({ matches: [match("a")], history, today: TODAY, max: 3 })).toHaveLength(1);
  });
});

describe("checkTipText", () => {
  const m = match("a");
  it("accepts a plain line with the person's own numbers", () => {
    expect(checkTipText("Gym: 2 of 8 done lately. Pick one fixed time.", m, "Gym")).toEqual({ ok: true });
  });
  it.each([
    ["", "empty"],
    ["x".repeat(221), "too_long"],
    ["Gym: 2 of 8.\nNext line.", "too_long"],
    ["**Gym**: 2 of 8.", "formatting"],
    ["See https://example.com for 2 of 8.", "formatting"],
    ["Gym: 2 of 8. Keep it up!", "praise"],
    ["Great job, 2 of 8 on Gym.", "praise"],
    ["Your signal shows 2 of 8.", "internal_words"],
    ["Gym: 3 of 8 done lately.", "unknown_number"],
    ["Gym has slipped lately.", "no_fact"],
  ])("refuses %j (%s)", (text, reason) => {
    expect(checkTipText(text, m, "Gym")).toEqual({ ok: false, reason });
  });
  it("allows a 0-to-1 rate as a whole percent and numbers from the title", () => {
    const rate = match("r", { recent_rate: 0.25 });
    expect(checkTipText("Run 5k is at 25% lately.", rate, "Run 5k")).toEqual({ ok: true });
  });
});

describe("resolveTipOutput", () => {
  const items = tipItems([match("a"), match("b", { streak: 4 }, "b-read")], new Map([["b-gym", "Gym"], ["b-read", "Reading"]]));

  it("keeps lines that pass and replaces the rest with the card's seed when one fits", () => {
    const outcome = resolveTipOutput({ tips: [
      { ref: "t1", text: "Gym: 2 of 8 done lately. Pick one fixed time." },
      { ref: "t2", text: "Amazing streak of 4!" },
    ] }, items);
    // Card b's seeds name facts its match does not carry, so the refused line is dropped.
    expect(outcome.tips.map((tip) => tip.source)).toEqual(["model"]);
    expect(outcome.rejected).toEqual(["praise"]);
    expect(outcome.dropped).toBe(1);
    const refused = resolveTipOutput({ tips: [{ ref: "t1", text: "Gym is doing great!" }] }, items);
    expect(refused.tips[0]).toMatchObject({ source: "seed", text: "Gym: 2 of 8 done lately." });
    expect(outcome.tips[0]!.factValues).toEqual({ "completion_drop:b-gym:recent_completed": 2, "completion_drop:b-gym:recent_resolved": 8 });
  });

  it("drops an item whose seeds cannot be filled, never inventing a line", () => {
    const outcome = seedTips(items);
    // Card b's seeds name facts the match does not carry.
    expect(outcome.tips.map((tip) => tip.cardId)).toEqual(["a"]);
    expect(outcome.dropped).toBe(1);
  });

  it("ignores malformed output", () => {
    expect(resolveTipOutput("nonsense", items).tips.every((tip) => tip.source === "seed")).toBe(true);
    expect(resolveTipOutput({ tips: [{ ref: 1, text: null }] }, items).rejected).toEqual([]);
  });
});

describe("shipped cards' seeds", () => {
  // Step 9: seed wording passes the same checks as model lines.
  const SAMPLE: Record<string, unknown> = {
    weekday: 2, hour: 7, part_of_day: "evening", direction: "later", median_target_time: "18:30", median_mark_time: "21:10",
    pattern: "clustered", weaker_mode: "range", other_behavior_id: "b-2", recovered: true, last_moved_date: "2026-11-18",
  };
  const valueFor = (name: string) => SAMPLE[name] ?? (/(rate|share|gap|drop|change)$/.test(name) ? 0.42 : 3);

  it("give at least one line per card that passes checkTipText", () => {
    for (const shipped of ADVICE_CARDS) {
      const facts = Object.fromEntries(
        shipped.applies_when.flatMap((rule) => [...(ADVICE_SIGNAL_FACTS[rule.signal] ?? []), "window_days"]).map((name) => [name, valueFor(name)]),
      );
      const seeded = shipped.quip_seeds.join(" ");
      const factNames = Object.keys(facts).filter((name) => seeded.includes(`{${name}}`));
      const rule = shipped.applies_when[0]!;
      const behaviorId = rule.scope === "account" ? null : "b-gym";
      const built: AdviceMatch = {
        card: shipped, signal: { id: null, kind: rule.signal as never, behaviorId, facts }, behaviorId, factNames,
        factIds: factNames.map((name) => `${rule.signal}:${behaviorId ?? "account"}:${name}`),
        matchStrength: 1, evidenceStrength: "moderate", daysSinceShown: null, score: 1,
      };
      expect(seedTipText(built, behaviorId ? "Gym" : null), shipped.id).not.toBeNull();
    }
  });
});
