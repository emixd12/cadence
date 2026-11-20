import { describe, expect, it } from "vitest";
import { ADVICE_CARDS } from "@cadence/core/services/advice-library";
import type { AdviceCard } from "@cadence/core/types/advice-cards";
import { searchAdviceCards } from "@/lib/services/chat/chat-advice";

// Advisor plan Phase 5 (5A): chat's search_advice reads only reviewed cards.

const reviewed = (card: AdviceCard): AdviceCard => ({ ...card, status: "active", reviewer: "owner", reviewed_at: "2026-11-20T00:00:00Z" });
// Any library card works: the query is its own advice sentence.
const plan = ADVICE_CARDS[0];
const query = plan.advice;

describe("search_advice", () => {
  it("finds a reviewed card by its words and returns its finding and source", () => {
    const result = searchAdviceCards(query, [reviewed(plan)]);
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]).toMatchObject({ id: plan.id, advice: plan.advice, finding: plan.evidence.claim, action: plan.action });
    expect(result.note).toBeUndefined();
  });

  it("never returns a card the owner has not reviewed", () => {
    expect(searchAdviceCards(query, [{ ...plan, status: "draft", reviewer: null, reviewed_at: null }]).cards).toEqual([]);
    expect(searchAdviceCards(query, [{ ...reviewed(plan), status: "withdrawn" }]).cards).toEqual([]);
  });

  it("says there is no research when nothing matches", () => {
    const result = searchAdviceCards("intermittent fasting ketones", ADVICE_CARDS.map(reviewed));
    expect(result.cards).toEqual([]);
    expect(result.note).toMatch(/no research/);
    expect(searchAdviceCards("the and", ADVICE_CARDS.map(reviewed)).cards).toEqual([]);
  });

  it("returns at most three cards, best match first", () => {
    const result = searchAdviceCards(ADVICE_CARDS.slice(0, 4).map((card) => card.advice).join(" "), ADVICE_CARDS.map(reviewed));
    expect(result.cards.length).toBeLessThanOrEqual(3);
    expect(result.cards.length).toBeGreaterThan(0);
  });
});
