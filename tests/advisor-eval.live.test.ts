import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ADVISOR_EVAL_FIXTURE_IDS, advisorEvalFixtures, type AdvisorEvalFixtureId } from "@/lib/services/advisor-eval/fixtures";
import { compareAdvisorEval, runAdvisorEval, summarizeAdvisorEval, type AdvisorEvalResult, type AdvisorEvalRun } from "@/lib/services/advisor-eval/harness";
import { DAILY_BRIEF_MODEL, generateDailyBriefWithModel } from "@/lib/services/daily-brief-model";
import { generateOpenAIDailyBrief } from "@/scripts/chatgpt-plan-spike-hosted-adapter";

/**
 * Phase 1B live eval. Calls the real model, so it costs money and is skipped
 * unless `CADENCE_ADVISOR_EVAL=1`. Run with `npm run advisor:eval`.
 *
 * - Baseline: the pre-AI-SDK adapter (frozen copy) with the production model.
 * - Candidates: the AI SDK path, once per model in `CADENCE_ADVISOR_EVAL_MODELS`
 *   (comma-separated, default the production model). Without the gateway, `openai/...`
 *   models bill `OPENAI_API_KEY` and `anthropic/...` models bill `ANTHROPIC_API_KEY`, so
 *   tests spend credits already bought there. Set `CADENCE_MODEL_TRANSPORT=gateway` to send
 *   candidates through AI Gateway instead.
 * - `CADENCE_ADVISOR_EVAL_BASELINE=0` skips the baseline.
 * - `CADENCE_ADVISOR_EVAL_FIXTURES` (comma-separated fixture IDs) runs only those accounts.
 *
 * One pass of the 10 fixtures on the production model costs about US$0.05.
 * Reports go to `.local/advisor-eval/` (git-ignored). They hold synthetic briefs only.
 */
const enabled = process.env.CADENCE_ADVISOR_EVAL === "1";

describe.skipIf(!enabled)("advisor eval (live)", () => {
  it("scores the AI SDK path at least as well as the previous adapter", async () => {
    const models = (process.env.CADENCE_ADVISOR_EVAL_MODELS ?? DAILY_BRIEF_MODEL).split(",").map((item) => item.trim()).filter(Boolean);
    const runs: AdvisorEvalRun[] = models.map((model) => ({ label: `ai-sdk:${model}`, model, generate: (input) => generateDailyBriefWithModel(input, { model }) }));
    const baselineRun: AdvisorEvalRun | null = process.env.CADENCE_ADVISOR_EVAL_BASELINE === "0" ? null : {
      label: `previous:${DAILY_BRIEF_MODEL}`, model: DAILY_BRIEF_MODEL,
      generate: (input) => generateOpenAIDailyBrief(input, { apiKey: process.env.OPENAI_API_KEY ?? "" }),
    };
    const only = process.env.CADENCE_ADVISOR_EVAL_FIXTURES?.split(",").map((item) => item.trim()).filter(Boolean);
    for (const id of only ?? []) if (!(ADVISOR_EVAL_FIXTURE_IDS as readonly string[]).includes(id)) throw new Error(`unknown fixture ${id}`);
    const fixtures = advisorEvalFixtures(only?.length ? only as AdvisorEvalFixtureId[] : undefined);
    const baseline = baselineRun ? await runAdvisorEval({ run: baselineRun, fixtures }) : null;
    const candidates: AdvisorEvalResult[][] = [];
    for (const run of runs) candidates.push(await runAdvisorEval({ run, fixtures }));

    const report = {
      generatedAt: new Date().toISOString(),
      baseline: baseline ? { summary: summarizeAdvisorEval(baseline), results: baseline } : null,
      candidates: candidates.map((results) => ({ summary: summarizeAdvisorEval(results), results,
        ...(baseline ? { comparison: compareAdvisorEval(baseline, results) } : {}) })),
    };
    mkdirSync(".local/advisor-eval", { recursive: true });
    const file = `.local/advisor-eval/${report.generatedAt.replace(/[:.]/g, "-")}.json`;
    writeFileSync(file, JSON.stringify(report, null, 2));
    console.log(`advisor eval report: ${file}`);
    for (const row of [report.baseline, ...report.candidates]) if (row) console.log(JSON.stringify(row.summary));
    for (const row of report.candidates) if ("comparison" in row && row.comparison) console.log(JSON.stringify({ atLeastAsGood: row.comparison.atLeastAsGood, regressions: row.comparison.regressions }));

    for (const results of candidates) expect(summarizeAdvisorEval(results).unexpectedLayerOne).toBe(0);
  }, 600_000);
});
