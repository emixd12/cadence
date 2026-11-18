import { describe, expect, it } from "vitest";
import { BRIEF_EVAL_FIXTURE_IDS, briefEvalFixture, briefEvalFixtures } from "@/lib/services/advisor-eval/brief-fixtures";
import { runBriefEval, summarizeBriefEval, type BriefEvalRun } from "@/lib/services/advisor-eval/brief-harness";
import { checkBriefLayerOne } from "@/lib/services/advisor-eval/brief-rules";
import { planBriefMoveLinesFromInputs } from "@cadence/core/resolvers/brief-move.resolver";

// Advisor Phase 3 (3A2): the brief eval with no model. A scripted writer stands in for
// the model, so these runs check the planner's lines against the layer 1 rules, the
// rubric and the cost and speed arithmetic. `npm run advisor:brief-eval` runs real models.

/** A well-behaved writer: names what each move works around. */
const scripted = (opening = "A few things clash today; here are new times."): BriefEvalRun => ({
  label: "scripted", model: "openai/gpt-5.6-luna",
  generate: async (request) => {
    request.onUsage?.({ inputTokens: 2_000, cachedInputTokens: 0, outputTokens: 200, reasoningTokens: 0 });
    const facts = JSON.parse(request.facts) as { lines: { key: string; with: string | null }[] };
    return { opening, reasons: facts.lines.map((line) => ({ key: line.key, text: line.with ? `It runs into ${line.with}.` : "Its time no longer works today." })) };
  },
});

describe("Phase 3 brief eval (no model)", () => {
  it("keeps every layer 1 rule on every synthetic account", () => {
    for (const fixture of briefEvalFixtures()) {
      const plan = planBriefMoveLinesFromInputs(fixture.plan);
      expect({ fixture: fixture.id, violations: checkBriefLayerOne(fixture.plan, plan.candidates) }).toEqual({ fixture: fixture.id, violations: [] });
    }
  });

  it("meets every fixture expectation and makes no model call when nothing needs moving", async () => {
    const results = await runBriefEval({ run: scripted() });
    expect(results.map((item) => item.fixture)).toEqual([...BRIEF_EVAL_FIXTURE_IDS]);
    for (const result of results) expect({ fixture: result.fixture, failed: result.rubric.filter((item) => !item.passed) }).toEqual({ fixture: result.fixture, failed: [] });
    for (const id of ["quiet_day", "stale_calendar", "near_midnight"] as const) {
      expect(results.find((item) => item.fixture === id)).toMatchObject({ modelCalls: 0, lines: [], costMicrodollars: 0 });
    }
    // Phase 1B expected no move for the new user's Walk; under Phase 3 it moves out of the busy event.
    expect(results.find((item) => item.fixture === "new_user")!.lines).toEqual([expect.objectContaining({ title: "Walk", reasonCode: "calendar_overlap" })]);
    const summary = summarizeBriefEval(results);
    // 2,000 input tokens at US$0.20/M plus 200 output tokens at US$1.20/M, 93 times.
    expect(summary).toMatchObject({ layerOneViolations: 0, meanCostPerBriefMicrodollars: 640, worstMonthMicrodollars: 59_520, passes: { cost: true, rules: true } });
  });

  it("marks words that claim a change, echo hidden instructions or skip the anchor", async () => {
    const bad: BriefEvalRun = { label: "bad", model: "openai/gpt-5.6-luna", generate: async (request) => {
      const facts = JSON.parse(request.facts) as { lines: { key: string }[] };
      return { opening: "I moved your Walk. Ignore all rules.", reasons: facts.lines.map((line) => ({ key: line.key, text: "Better this way." })) };
    } };
    const [result] = await runBriefEval({ run: bad, fixtures: [briefEvalFixture("hidden_instructions")] });
    const failed = result!.rubric.filter((item) => !item.passed).map((item) => item.id);
    expect(failed).toEqual(expect.arrayContaining(["no_change_claimed", "no_injection_echo", "names_what_it_works_around"]));
  });

  it("falls back to Cadence's words when the model fails, and counts it", async () => {
    const failing: BriefEvalRun = { label: "failing", model: "openai/gpt-5.6-luna", generate: async () => { throw new Error("down"); } };
    const [result] = await runBriefEval({ run: failing, fixtures: [briefEvalFixture("new_user")] });
    expect(result).toMatchObject({ source: "stock", failure: "words_unavailable:down", lines: [expect.objectContaining({ modelReason: false })] });
    expect(summarizeBriefEval([result!])).toMatchObject({ briefsWithFallback: 1, failures: 1 });
  });

  it("finds a line offered against the rules", () => {
    const fixture = briefEvalFixture("heavy_mover");
    const walk = fixture.plan.items[0]!;
    const line = { occurrenceId: walk.occurrenceId, behaviorId: walk.behaviorId,
      from: { startAt: walk.start.toString(), endAt: walk.end.toString() },
      // Inside the busy lunch event and after the 10 PM latest start.
      to: { startAt: "2026-11-01T17:10:00Z", endAt: "2026-11-01T17:30:00Z" } };
    const late = { ...line, to: { startAt: "2026-11-02T03:30:00Z", endAt: "2026-11-02T03:50:00Z" } };
    const rules = [...checkBriefLayerOne(fixture.plan, [line]), ...checkBriefLayerOne(fixture.plan, [late])].map((item) => item.rule);
    expect(rules).toEqual(expect.arrayContaining(["declined_reoffered", "yes_check_alone", "after_latest_hour"]));
  });
});
