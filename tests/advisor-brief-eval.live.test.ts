import { mkdirSync, writeFileSync } from "node:fs";
import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";
import { DEFAULT_BRIEFING_CONFIG } from "@cadence/core/services/briefing-config";
import { planBriefMoveLinesFromInputs } from "@cadence/core/resolvers/brief-move.resolver";
import type { DailyBriefing } from "@cadence/core/types/daily-brief";
import { BRIEF_EVAL_FIXTURE_IDS, briefEvalFixtures, type BriefEvalFixtureId } from "@/lib/services/advisor-eval/brief-fixtures";
import { runBriefEval, summarizeBriefEval, type BriefEvalResult, type BriefEvalRun } from "@/lib/services/advisor-eval/brief-harness";
import type { AdvisorEvalFixture } from "@/lib/services/advisor-eval/fixtures";
import { gradeFixture, summarizeQuality, topPickAgreement, type QualityGrade } from "@/lib/services/advisor-eval/grader";
import { runAdvisorEval } from "@/lib/services/advisor-eval/harness";
import { prepareBriefOpening } from "@/lib/services/brief-opening";
import type { AgentReasoningEffort } from "@/lib/services/agent-model";
import { DAILY_BRIEF_MODEL, generateBriefOpeningWithModel, generateDailyBriefWithModel } from "@/lib/services/daily-brief-model";

/**
 * Advisor Phase 3 (3A2) live brief eval. Calls real models, so it costs money and is
 * skipped unless `CADENCE_ADVISOR_EVAL=1`. Run with `npm run advisor:brief-eval`.
 *
 * - Candidates: `CADENCE_ADVISOR_EVAL_MODELS`, comma-separated `creator/model@effort`
 *   (effort optional, default the production effort). Default: the production model.
 *   Without the gateway, `openai/...` bills `OPENAI_API_KEY` and `anthropic/...` bills
 *   `ANTHROPIC_API_KEY`.
 * - `CADENCE_ADVISOR_EVAL_FIXTURES` runs only the listed accounts.
 * - `CADENCE_ADVISOR_GRADERS` (comma-separated, empty to skip) grades blind, per account
 *   with move lines: today's production brief (the long prompt, same day) against each
 *   candidate. Default: one Anthropic and one OpenAI grader.
 *
 * One candidate over the 14 accounts costs well under US$0.01; grading costs roughly
 * US$0.30 per grader. Reports go to `.local/advisor-eval/` (git-ignored; synthetic only).
 */
const enabled = process.env.CADENCE_ADVISOR_EVAL === "1";

describe.skipIf(!enabled)("Phase 3 brief eval (live)", () => {
  it("writes the brief on each candidate model, then grades it against today's brief", async () => {
    const specs = (process.env.CADENCE_ADVISOR_EVAL_MODELS ?? DAILY_BRIEF_MODEL).split(",").map((item) => item.trim()).filter(Boolean);
    const runs: BriefEvalRun[] = specs.map((spec) => {
      const [model, effort] = spec.split("@") as [string, AgentReasoningEffort | undefined];
      return { label: spec, model, generate: (input) => generateBriefOpeningWithModel(input, { model, ...(effort ? { effort } : {}) }) };
    });
    const only = process.env.CADENCE_ADVISOR_EVAL_FIXTURES?.split(",").map((item) => item.trim()).filter(Boolean);
    for (const id of only ?? []) if (!(BRIEF_EVAL_FIXTURE_IDS as readonly string[]).includes(id)) throw new Error(`unknown fixture ${id}`);
    const fixtures = briefEvalFixtures(only?.length ? only as BriefEvalFixtureId[] : undefined);

    const candidates: BriefEvalResult[][] = [];
    for (const run of runs) candidates.push(await runBriefEval({ run, fixtures }));

    // Blind grading on the accounts with something to say.
    const graders = (process.env.CADENCE_ADVISOR_GRADERS ?? "anthropic/claude-opus-5.5,openai/gpt-5.6-sol").split(",").map((item) => item.trim()).filter(Boolean);
    const grades: QualityGrade[] = [];
    const gradeCalls: { fixture: string; grader: string; costMicrodollars: number | null; error: string | null }[] = [];
    const today: { fixture: string; brief: DailyBriefing | null; costMicrodollars: number | null; latencyMs: number }[] = [];
    if (graders.length) {
      for (const fixture of fixtures) {
        const plan = planBriefMoveLinesFromInputs(fixture.plan);
        if (!plan.candidates.length) continue;
        // Today's production brief for the same day: the long prompt, production preset and model.
        const legacy = { id: fixture.id, description: fixture.description, context: fixture.context, config: DEFAULT_BRIEFING_CONFIG,
          declinedMoves: [], expect: {}, knownGaps: [] } as unknown as AdvisorEvalFixture;
        const [current] = await runAdvisorEval({ run: { label: "today", model: DAILY_BRIEF_MODEL, generate: (input) => generateDailyBriefWithModel(input) }, fixtures: [legacy] });
        today.push({ fixture: fixture.id, brief: current!.brief, costMicrodollars: current!.costMicrodollars, latencyMs: current!.latencyMs });
        const facts = prepareBriefOpening({ context: fixture.context, lines: plan.candidates, conflicts: [], calendar: plan.calendar, now: fixture.now }).facts;
        const briefs = [{ label: "today", brief: current!.brief },
          ...candidates.map((results) => {
            const result = results.find((item) => item.fixture === fixture.id)!;
            return { label: result.label, brief: asBriefing(result, fixture.context.localDate, fixture.context.timezone) };
          })];
        const graded = await Promise.all(graders.map((grader) => gradeFixture({ fixture: legacy, facts, briefs, grader })));
        graded.forEach((result, index) => {
          grades.push(...result.grades);
          gradeCalls.push({ fixture: fixture.id, grader: graders[index]!, costMicrodollars: result.costMicrodollars, error: result.error });
        });
      }
    }

    const report = {
      generatedAt: new Date().toISOString(),
      candidates: candidates.map((results) => ({ summary: summarizeBriefEval(results), results })),
      quality: graders.length ? { graders, summary: summarizeQuality(grades),
        agreement: graders.length >= 2 ? topPickAgreement(grades, graders[0]!, graders[1]!) : null, calls: gradeCalls, grades, today } : null,
    };
    mkdirSync(".local/advisor-eval", { recursive: true });
    const file = `.local/advisor-eval/brief-${report.generatedAt.replace(/[:.]/g, "-")}.json`;
    writeFileSync(file, JSON.stringify(report, null, 2));
    console.log(`brief eval report: ${file}`);
    for (const row of report.candidates) console.log(JSON.stringify(row.summary));
    for (const row of report.quality?.summary.filter((item) => item.grader === "all") ?? []) console.log(JSON.stringify(row));

    for (const results of candidates) expect(summarizeBriefEval(results).layerOneViolations).toBe(0);
  }, 1_800_000);
});

/** A candidate's brief in the shape the grader reads: the opening, then one suggestion per line. */
function asBriefing(result: BriefEvalResult, localDate: string, timezone: string): DailyBriefing {
  const now = Temporal.Now.instant().toString();
  return { text: result.opening, localDate, timezone, generatedAt: now, expiresAt: now, coverage: "complete", warnings: [],
    suggestions: result.lines.map((line) => ({ text: `${line.title}: ${line.from} → ${line.to}. ${line.reason}` })) } as unknown as DailyBriefing;
}
