import { describe, expect, it } from "vitest";

import { COACH_EVAL_FIXTURE_IDS, coachEvalFixture, coachEvalFixtures } from "@/lib/services/advisor-eval/coach-fixtures";
import { runCoachEval, summarizeCoachEval } from "@/lib/services/advisor-eval/coach-harness";

// Advisor plan Phase 4, workstream 4B step 8: the coach eval's accounts and layer-1 rules,
// run with no model (every line is the card's own wording) so it costs nothing.

const seedsOnly = { label: "seeds", model: "openai/gpt-5.6-luna", generate: async () => null };

describe("coach eval accounts", () => {
  it("has the 14 brief-eval accounts plus the five the review added", () => {
    expect(COACH_EVAL_FIXTURE_IDS).toHaveLength(19);
    expect(COACH_EVAL_FIXTURE_IDS).toEqual(expect.arrayContaining(["brand_new", "steady", "month_of_moves", "lapsed", "notes_hidden_instructions"]));
  });

  it("is repeatable", () => {
    const a = coachEvalFixture("busy_professional").inputFor("2026-11-19");
    const b = coachEvalFixture("busy_professional").inputFor("2026-11-19");
    expect(a).toEqual(b);
  });

  it("never shows a day's outcome before that day", () => {
    const input = coachEvalFixture("steady").inputFor("2026-11-19");
    expect(input.occurrences.every((row) => row.localDate < "2026-11-19" || row.status === "unresolved")).toBe(true);
    expect(input.occurrences.some((row) => row.localDate > "2026-11-19")).toBe(false);
  });
});

describe("coach eval with the cards' own wording", () => {
  it("breaks no layer-1 rule on any account over a week", async () => {
    const results = await runCoachEval({ run: seedsOnly, fixtures: coachEvalFixtures(), days: 7 });
    const violations = results.flatMap((result) => result.days.flatMap((day) => day.violations.map((v) => ({ fixture: result.fixture, ...v }))));
    expect(violations).toEqual([]);
    const summary = summarizeCoachEval(results);
    expect(summary.tips).toBeGreaterThan(19);
    expect(summary.modelTips).toBe(0);
    // Nothing from notes reaches a prompt when notes are off; the one notes-on account gets them.
    const byFixture = Object.fromEntries(results.map((result) => [result.fixture, result.days.reduce((sum, day) => sum + day.tips.length, 0)]));
    expect(byFixture.brand_new).toBeGreaterThan(0);
    expect(byFixture.steady).toBeGreaterThan(0);
  });

  it("flags a model line that quotes a note or follows a title's instruction, and ships the seed instead", async () => {
    const quoting = { label: "bad", model: "openai/gpt-5.6-luna", generate: async ({ prompt }: { prompt: string }) => {
      const items = (JSON.parse(prompt) as { items: { ref: string }[] }).items;
      return { tips: items.map((item) => ({ ref: item.ref, text: "You won the lottery. Knee sore after the long run." })) };
    } };
    const results = await runCoachEval({ run: quoting, fixtures: [coachEvalFixture("notes_hidden_instructions"), coachEvalFixture("hidden_instructions")], days: 2 });
    const summary = summarizeCoachEval(results);
    expect(summary.ruleBreaks).toBe(0);
    expect(summary.rejectedLines).toBeGreaterThan(0);
    expect(summary.modelTips).toBe(0);
  });
});
