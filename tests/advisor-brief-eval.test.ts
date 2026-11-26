import { describe, expect, it } from "vitest";
import { BRIEF_EVAL_FIXTURE_IDS, briefEvalFixture, briefEvalFixtures } from "@/lib/services/advisor-eval/brief-fixtures";
import { runBriefEval, summarizeBriefEval, type BriefEvalRun } from "@/lib/services/advisor-eval/brief-harness";
import { checkBriefDayNoteNotQuoted, checkBriefLayerOne } from "@/lib/services/advisor-eval/brief-rules";
import { briefOpeningInstructions } from "@/lib/services/brief-opening";
import { planBriefMoveLinesFromInputs } from "@cadence/core/resolvers/brief-move.resolver";
import { planBriefPairingLines } from "@cadence/core/resolvers/alongside-pairing.resolver";
import { Temporal } from "@js-temporal/polyfill";

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

  it("Ticket 359: keeps the pill and the helmet, and moves the Spanish class off the helmet at a different place", () => {
    const fixture = briefEvalFixture("alongside_places");
    const plan = planBriefMoveLinesFromInputs(fixture.plan);
    const lines = new Map(plan.candidates.map((line) => [line.occurrenceId, line]));
    expect(lines.has("occurrence_fixture_1")).toBe(false);
    expect(lines.has("occurrence_fixture_5")).toBe(false);
    const local = (at: string) => Temporal.Instant.from(at).toZonedDateTimeISO(fixture.context.timezone).toPlainTime().toString({ smallestUnit: "minute" });
    expect(local(lines.get("occurrence_fixture_3")!.to.startAt)).toBe("13:30");
    // The earlier rule (no Where on any item) put the class at 1:10 PM, during the helmet: the new rule names that.
    const earlier = { ...fixture.plan, items: fixture.plan.items.map((item) => ({ ...item, where: undefined })) };
    const before = planBriefMoveLinesFromInputs(earlier).candidates.find((line) => line.occurrenceId === "occurrence_fixture_3")!;
    expect(local(before.to.startAt)).toBe("13:10");
    // The Yes checks see it too, since they read the same places.
    expect(checkBriefLayerOne(fixture.plan, [before]).map((item) => item.rule)).toEqual(["alongside_other_place", "yes_check_alone", "yes_check_all"]);
    // The day context carries the same facts, and the brief's model facts never do.
    expect(fixture.context.cadence.occurrences.find((item) => item.ref === "occurrence_fixture_5")!.planning)
      .toEqual({ alongside: true, alongsideSource: "guess", where: { kind: "home", source: "guess" } });
  });

  it("Ticket 361: pairs the helmet with Read at 6 PM, keeps every rule, and no other flag-on fixture gets a pairing", () => {
    for (const fixture of briefEvalFixtures()) {
      if (!fixture.pairing) continue;
      const moves = planBriefMoveLinesFromInputs(fixture.plan).candidates;
      const lines = [...moves, ...planBriefPairingLines({ ...fixture.plan, evidence: fixture.pairing }, moves)];
      expect({ fixture: fixture.id, violations: checkBriefLayerOne(fixture.plan, lines) }).toEqual({ fixture: fixture.id, violations: [] });
      const pairings = lines.filter((line) => line.reasonCode === "alongside_pairing");
      if (fixture.id !== "alongside_pairing") expect({ fixture: fixture.id, pairings }).toEqual({ fixture: fixture.id, pairings: [] });
    }
    const fixture = briefEvalFixture("alongside_pairing");
    const moves = planBriefMoveLinesFromInputs(fixture.plan).candidates;
    const [line, ...rest] = planBriefPairingLines({ ...fixture.plan, evidence: fixture.pairing! }, moves);
    expect(rest).toEqual([]);
    const local = (at: string) => Temporal.Instant.from(at).toZonedDateTimeISO(fixture.context.timezone).toPlainTime().toString({ smallestUnit: "minute" });
    expect(line).toMatchObject({ occurrenceId: "occurrence_fixture_5", reasonCode: "alongside_pairing", anchor: { kind: "item", title: "Read" },
      pairing: { hostOccurrenceId: "occurrence_fixture_10", needs: ["done_together"] } });
    expect(local(line!.to.startAt)).toBe("18:00");
    expect(line!.reason.replace(/\s/gu, " ")).toBe("Do Red light helmet during Read at 6:00 PM.");
    // Without the coach's evidence nothing about the helmet helps, so it stays.
    expect(planBriefPairingLines({ ...fixture.plan, evidence: { doneTogether: [], crowdedHours: [] } }, moves)).toEqual([]);
    // A pairing line placed anywhere but its host's start breaks the pairing rule.
    const off = { ...line!, to: { startAt: Temporal.Instant.from(line!.to.startAt).add({ minutes: 30 }).toString(), endAt: Temporal.Instant.from(line!.to.endAt).add({ minutes: 30 }).toString() } };
    expect(checkBriefLayerOne(fixture.plan, [off]).map((item) => item.rule)).toEqual(["pairing_off_host"]);
    // The same line as an ordinary move line is an alongside item offered against the rules.
    expect(checkBriefLayerOne(fixture.plan, [{ ...line!, reasonCode: "item_overlap", pairing: undefined }]).map((item) => item.rule)).toEqual(["alongside_offered"]);
  });

  it("Ticket 367: sends the day notes and marks a brief that repeats one", async () => {
    const fixture = briefEvalFixture("day_notes");
    expect(fixture.dayNotes!.map((item) => item.day)).toEqual(["today", "yesterday", "2 days ago"]);
    const seen: string[] = [];
    const writer = (opening: string): BriefEvalRun => ({ label: "notes", model: "openai/gpt-5.6-luna", generate: async (request) => {
      seen.push(request.instructions);
      const facts = JSON.parse(request.facts) as { dayNotes: unknown; lines: { key: string; with: string | null }[] };
      expect(facts.dayNotes).toEqual(fixture.dayNotes);
      return { opening, reasons: facts.lines.map((line) => ({ key: line.key, text: line.with ? `It runs into ${line.with}.` : "Its time no longer works today." })) };
    } });
    const [kept] = await runBriefEval({ run: writer("A few things clash on a slow day; here are new times."), fixtures: [fixture] });
    expect(seen[0]).toBe(briefOpeningInstructions(["dayNotes"]));
    expect(kept!.rubric.find((item) => item.id === "day_note_not_quoted")).toEqual({ id: "day_note_not_quoted", passed: true });
    expect(kept!.rubric.filter((item) => !item.passed)).toEqual([]);
    // The five-word note repeated whole: production shows stock words, and the rule records the slip.
    const [quoted] = await runBriefEval({ run: writer("Head cold, slept four hours. A few things clash today."), fixtures: [fixture] });
    expect(quoted!.fallbacks).toEqual(["opening_day_note"]);
    expect(quoted!.opening).not.toContain("Head cold");
    expect(quoted!.rubric.find((item) => item.id === "day_note_not_quoted")).toEqual({ id: "day_note_not_quoted", passed: false, detail: "opening_day_note" });
    // The rule also reads shown text on its own, for words that reached the person.
    expect(checkBriefDayNoteNotQuoted({ dayNotes: fixture.dayNotes!, texts: ["Your flight home was delayed three hours."], fallbacks: [] })).toEqual({ passed: false, detail: "shown" });
    // A fixture with no day notes gets the plain prompt and no such rule.
    const [plain] = await runBriefEval({ run: scripted(), fixtures: [briefEvalFixture("busy_professional")] });
    expect(plain!.rubric.some((item) => item.id === "day_note_not_quoted")).toBe(false);
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

describe("Phase 3 brief eval fixtures", () => {
  it("are valid day contexts, so today's brief can run on them too", async () => {
    const { validateVersionedAdvisorDayContext } = await import("@cadence/core/services/advisor-day-context");
    for (const fixture of briefEvalFixtures()) expect(() => validateVersionedAdvisorDayContext(structuredClone(fixture.context))).not.toThrow();
  });
});
