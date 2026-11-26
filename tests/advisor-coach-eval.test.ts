import { describe, expect, it } from "vitest";

import { COACH_EVAL_FIXTURE_IDS, coachEvalFixture, coachEvalFixtures } from "@/lib/services/advisor-eval/coach-fixtures";
import { runCoachEval, summarizeCoachEval } from "@/lib/services/advisor-eval/coach-harness";
import { resolveCoachSignals } from "@cadence/core/resolvers/coach-signals.resolver";

// Advisor plan Phase 4, workstream 4B step 8: the coach eval's accounts and layer-1 rules,
// run with no model (every line is the card's own wording) so it costs nothing.

const seedsOnly = { label: "seeds", model: "openai/gpt-5.6-luna", generate: async () => null };

describe("coach eval accounts", () => {
  it("has the 14 brief-eval accounts plus the five the review added, the alongside account and the Period account", () => {
    expect(COACH_EVAL_FIXTURE_IDS).toHaveLength(21);
    expect(COACH_EVAL_FIXTURE_IDS).toEqual(expect.arrayContaining(["brand_new", "steady", "month_of_moves", "lapsed", "notes_hidden_instructions", "alongside_evening", "period_sick_week"]));
  });

  it("Ticket 372: period_sick_week reports a completion drop with its Period days, and the Period suppresses nothing", () => {
    const input = coachEvalFixture("period_sick_week").inputFor("2026-11-19");
    // "Sick", November 10 to 16: all seven days fall in the recent 14 (November 5 to 18).
    expect(input.periodDates).toEqual(["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16"]);
    const signals = resolveCoachSignals(input);
    const drop = signals.find((signal) => signal.kind === "completion_drop" && signal.behaviorId === "gym");
    expect(drop?.facts).toMatchObject({ recent_period_days: 7, baseline_period_days: 0 });
    // The same account with no Period read: the same signals, with both counts at 0.
    expect(resolveCoachSignals({ ...input, periodDates: undefined })).toEqual(signals.map((signal) => signal.kind === "completion_drop"
      ? { ...signal, facts: { ...signal.facts, recent_period_days: 0, baseline_period_days: 0 } } : signal));
    // The input and the facts carry dates and counts, never the label.
    expect(JSON.stringify([input, signals]).toLowerCase()).not.toContain("sick");
  });

  it("Ticket 359: alongside items (the helmet and the pill) do not crowd the evening hour", () => {
    const input = coachEvalFixture("alongside_evening").inputFor("2026-11-19");
    expect(input.behaviors.filter((behavior) => behavior.alongside).map((behavior) => behavior.id)).toEqual(["helmet", "pill"]);
    const crowded = (value: typeof input) => resolveCoachSignals(value).filter((signal) => signal.kind === "crowded_hour");
    // Version 3 (flag off, the value unread) counts all four 8 PM items and calls the hour crowded.
    const unread = { ...input, behaviors: input.behaviors.map((behavior) => ({ ...behavior, alongside: undefined })) };
    expect(crowded(unread)).toEqual([expect.objectContaining({ facts: expect.objectContaining({ hour: 20 }) })]);
    // Version 4 leaves the helmet and the pill out: two items in the hour are not a crowd.
    expect(crowded(input)).toEqual([]);
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
  // One test per account. As a single test the 19 accounts (21 since Ticket 372) took 2.7 to 4.4 s on GitHub's
  // runners and passed the 5 s limit on 3 of 11 runs on November 20, 2026.
  const tipsByFixture = new Map<string, number>();

  it.each(COACH_EVAL_FIXTURE_IDS)("breaks no layer-1 rule on %s over a week", async (id) => {
    const results = await runCoachEval({ run: seedsOnly, fixtures: [coachEvalFixture(id)], days: 7 });
    const violations = results.flatMap((result) => result.days.flatMap((day) => day.violations.map((v) => ({ fixture: result.fixture, ...v }))));
    expect(violations).toEqual([]);
    const summary = summarizeCoachEval(results);
    expect(summary.modelTips).toBe(0);
    tipsByFixture.set(id, summary.tips);
  });

  it("gives tips across the accounts", () => {
    // Fails unless every account's test above ran first, so it cannot pass on a partial run.
    expect([...tipsByFixture.keys()].sort()).toEqual([...COACH_EVAL_FIXTURE_IDS].sort());
    const tips = [...tipsByFixture.values()].reduce((sum, count) => sum + count, 0);
    expect(tips).toBeGreaterThan(19);
    // Nothing from notes reaches a prompt when notes are off; the one notes-on account gets them.
    expect(tipsByFixture.get("brand_new")).toBeGreaterThan(0);
    expect(tipsByFixture.get("steady")).toBeGreaterThan(0);
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
