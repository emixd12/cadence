import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { COACH_EVAL_FIXTURE_IDS, coachEvalFixtures, type CoachEvalFixtureId } from "@/lib/services/advisor-eval/coach-fixtures";
import { gradeCoachDay, summarizeCoachQuality, type CoachGrade } from "@/lib/services/advisor-eval/coach-grader";
import { COACH_EVAL_PASS, runCoachEval, summarizeCoachEval, type CoachEvalResult, type CoachEvalRun } from "@/lib/services/advisor-eval/coach-harness";
import { agentModelSetting, generateStructured, type AgentReasoningEffort } from "@/lib/services/agent-model";
import { TIP_SCHEMA, TIP_SCHEMA_NAME } from "@/lib/services/advisor-tips-writer";

/**
 * Advisor plan Phase 4, workstream 4B step 8: live coach eval. Calls real models, so it
 * costs money and is skipped unless `CADENCE_ADVISOR_EVAL=1`. Run `npm run advisor:coach-eval`.
 *
 * - Candidates: `CADENCE_ADVISOR_EVAL_MODELS`, comma-separated `creator/model@effort`.
 *   Default: the coach's production model.
 * - `CADENCE_ADVISOR_EVAL_FIXTURES` runs only the listed accounts; `CADENCE_COACH_EVAL_DAYS`
 *   sets the mornings per account (default 7).
 * - `CADENCE_ADVISOR_GRADERS` (comma-separated, empty to skip): two blind graders by default.
 *   Graders see the first and last morning of each account.
 *
 * Pass bars: zero layer-1 rule breaks, mean grade at least 4, cost under US$0.25 per
 * account per month at the 95th percentile. The report gives cost per account per model.
 * Reports go to `.local/advisor-eval/` (git-ignored; synthetic only).
 */
const enabled = process.env.CADENCE_ADVISOR_EVAL === "1";

describe.skipIf(!enabled)("Phase 4 coach eval (live)", () => {
  it("writes tips on each candidate model, checks the rules, and grades them blind", async () => {
    const coach = agentModelSetting("coach");
    const specs = (process.env.CADENCE_ADVISOR_EVAL_MODELS ?? coach.model).split(",").map((item) => item.trim()).filter(Boolean);
    const runs: CoachEvalRun[] = specs.map((spec) => {
      const [model, effort] = spec.split("@") as [string, AgentReasoningEffort | undefined];
      const setting = { ...coach, model, ...(effort ? { reasoning: effort } : {}) };
      return { label: spec, model, generate: (input) => generateStructured({
        agent: "coach", setting, instructions: input.instructions, prompt: input.prompt,
        schemaName: TIP_SCHEMA_NAME, schema: TIP_SCHEMA, signal: AbortSignal.timeout(setting.timeoutMs), onUsage: input.onUsage,
      }) };
    });
    const only = process.env.CADENCE_ADVISOR_EVAL_FIXTURES?.split(",").map((item) => item.trim()).filter(Boolean);
    for (const id of only ?? []) if (!(COACH_EVAL_FIXTURE_IDS as readonly string[]).includes(id)) throw new Error(`unknown fixture ${id}`);
    const fixtures = coachEvalFixtures(only?.length ? only as CoachEvalFixtureId[] : undefined);
    const days = Number(process.env.CADENCE_COACH_EVAL_DAYS ?? 7);

    const candidates: CoachEvalResult[][] = [];
    for (const run of runs) candidates.push(await runCoachEval({ run, fixtures, days }));

    const graders = (process.env.CADENCE_ADVISOR_GRADERS ?? "anthropic/claude-opus-5.5,openai/gpt-5.6-sol").split(",").map((item) => item.trim()).filter(Boolean);
    const grades: CoachGrade[] = [];
    const gradeCalls: { fixture: string; localDate: string; grader: string; costMicrodollars: number | null; error: string | null }[] = [];
    for (const [index, fixture] of fixtures.entries()) {
      const reference = candidates[0]![index]!;
      for (const day of [reference.days[0], reference.days[reference.days.length - 1]]) {
        if (!day || !day.items.length) continue;
        const sets = candidates.map((results) => {
          const same = results[index]!.days.find((item) => item.localDate === day.localDate)!;
          return { label: results[index]!.label, tips: same.tips.map((tip) => tip.text) };
        });
        const graded = await Promise.all(graders.map((grader) => gradeCoachDay({ fixture: fixture.id, day, candidates: sets, grader })));
        graded.forEach((result, g) => {
          grades.push(...result.grades);
          gradeCalls.push({ fixture: fixture.id, localDate: day.localDate, grader: graders[g]!, costMicrodollars: result.costMicrodollars, error: result.error });
        });
      }
    }

    const summaries = candidates.map(summarizeCoachEval);
    const quality = summarizeCoachQuality(grades);
    const verdicts = summaries.map((summary) => {
      const grade = quality.find((row) => row.grader === "all" && row.label === summary.label)?.mean ?? null;
      return { label: summary.label, ruleBreaks: summary.ruleBreaks, meanGrade: grade, p95MonthlyUsd: summary.p95MonthlyMicrodollars / 1_000_000,
        passes: summary.ruleBreaks <= COACH_EVAL_PASS.ruleBreaks && (grade === null || grade >= COACH_EVAL_PASS.meanGrade)
          && summary.p95MonthlyMicrodollars < COACH_EVAL_PASS.p95MonthlyMicrodollars };
    });
    const report = { generatedAt: new Date().toISOString(), days, pass: COACH_EVAL_PASS, verdicts, candidates: candidates.map((results, i) => ({ summary: summaries[i], results })),
      quality: graders.length ? { graders, summary: quality, calls: gradeCalls, grades } : null };
    mkdirSync(".local/advisor-eval", { recursive: true });
    const file = `.local/advisor-eval/coach-${report.generatedAt.replace(/[:.]/g, "-")}.json`;
    writeFileSync(file, JSON.stringify(report, null, 2));
    console.log(`coach eval report: ${file}`);
    for (const summary of summaries) console.log(JSON.stringify(summary));
    for (const row of quality.filter((item) => item.grader === "all")) console.log(JSON.stringify(row));
    for (const verdict of verdicts) console.log(JSON.stringify(verdict));

    for (const summary of summaries) expect(summary.ruleBreaks).toBe(0);
  }, 3_600_000);
});
