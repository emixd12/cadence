import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isModelId, type AgentReasoningEffort } from "@/lib/services/agent-model";
import { chatEvalSetting, runChatEval, summarizeChatEval, type ChatScenarioResult } from "@/lib/services/chat-eval/harness";
import { gradeScenario, summarizeChatQuality, type ChatQualityGrade } from "@/lib/services/chat-eval/grader";
import { chatEvalModelNote } from "@/lib/services/chat-eval/model-notes";
import { CHAT_SCENARIOS } from "@/lib/services/chat-eval/scenarios";

/**
 * Phase 5 (5D) live chat eval. Calls real models, so it costs money and is skipped
 * unless `CADENCE_CHAT_EVAL=1` (run) or `CADENCE_CHAT_GRADE=1` (grade a saved run).
 *
 * - `npm run chat:eval`: plays every scenario once per candidate in
 *   `CADENCE_CHAT_EVAL_MODELS` (comma-separated; `model@effort` sets reasoning effort).
 *   `CADENCE_CHAT_EVAL_SCENARIOS` runs a subset. Direct transport bills each creator's
 *   own key (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`).
 * - `npm run chat:grade`: grades the newest run (or `CADENCE_CHAT_GRADE_REPORT`) blind
 *   with `CADENCE_CHAT_GRADERS` (default Claude Opus 5.5 and GPT-5.6 Sol).
 *
 * Reports go to `.local/chat-eval/` (git-ignored). They hold synthetic conversations only.
 */
(globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false;
const DIR = ".local/chat-eval";

describe.skipIf(process.env.CADENCE_CHAT_EVAL !== "1")("chat eval (live)", () => {
  it("plays every scenario for each candidate model", async () => {
    const specs = (process.env.CADENCE_CHAT_EVAL_MODELS ?? "openai/gpt-5.6-luna").split(",").map((item) => item.trim()).filter(Boolean);
    const only = process.env.CADENCE_CHAT_EVAL_SCENARIOS?.split(",").map((item) => item.trim()).filter(Boolean);
    const scenarios = only?.length ? CHAT_SCENARIOS.filter((item) => only.includes(item.id)) : CHAT_SCENARIOS.filter((item) => !item.optIn);
    const runs: { label: string; results: ChatScenarioResult[] }[] = [];
    // CADENCE_CHAT_EVAL_REPEATS plays everything n times (labels gain "#1".."#n");
    // CADENCE_CHAT_EVAL_TUNED=1 appends each model's tuning note (model-notes.ts).
    const repeats = Math.max(1, Number(process.env.CADENCE_CHAT_EVAL_REPEATS ?? "1"));
    const tuned = process.env.CADENCE_CHAT_EVAL_TUNED === "1";
    await Promise.all(specs.map(async (spec) => {
      const [model, effort] = spec.split("@");
      if (!isModelId(model)) throw new Error(`invalid model ${model}`);
      const setting = chatEvalSetting(model, effort ? { reasoning: effort as AgentReasoningEffort } : {});
      for (let round = 1; round <= repeats; round += 1) {
        const label = repeats > 1 ? `${spec}#${round}` : spec;
        const results = await runChatEval({ candidate: { label, setting, ...(tuned ? { instructionsNote: chatEvalModelNote(model) } : {}) }, scenarios, concurrency: 4 });
        runs.push({ label, results });
        console.log(JSON.stringify(summarizeChatEval(results)));
      }
    }));
    runs.sort((a, b) => a.label.localeCompare(b.label));
    const report = { generatedAt: new Date().toISOString(), scenarios: scenarios.map((item) => item.id),
      candidates: runs.map((run) => ({ summary: summarizeChatEval(run.results), results: run.results })) };
    mkdirSync(DIR, { recursive: true });
    const file = `${DIR}/${report.generatedAt.replace(/[:.]/g, "-")}.json`;
    writeFileSync(file, JSON.stringify(report, null, 2));
    console.log(`chat eval report: ${file}`);
    for (const run of runs) for (const result of run.results) for (const item of result.breaks) console.log(`BREAK ${run.label} ${result.scenario}: ${item.rule} ${item.detail}`);
    expect(runs.length).toBe(specs.length);
  }, 3_600_000);
});

describe.skipIf(process.env.CADENCE_CHAT_GRADE !== "1")("chat quality grading (live)", () => {
  it("grades every transcript blind with each grader", async () => {
    const path = process.env.CADENCE_CHAT_GRADE_REPORT ?? `${DIR}/${readdirSync(DIR).filter((name) => name.endsWith(".json") && !name.startsWith("grades-")).sort().at(-1)}`;
    const report = JSON.parse(readFileSync(path, "utf8")) as { candidates: { results: ChatScenarioResult[] }[] };
    const graders = (process.env.CADENCE_CHAT_GRADERS ?? "anthropic/claude-opus-5.5,openai/gpt-5.6-sol").split(",").map((item) => item.trim()).filter(Boolean);
    const grades: ChatQualityGrade[] = [];
    const calls: { scenario: string; grader: string; costMicrodollars: number | null; error: string | null }[] = [];
    await Promise.all(CHAT_SCENARIOS.map(async (scenario) => {
      const results = report.candidates.flatMap((run) => run.results.filter((item) => item.scenario === scenario.id));
      if (!results.length) return;
      const graded = await Promise.all(graders.map((grader) => gradeScenario({ scenario, results, grader })));
      graded.forEach((result, index) => {
        grades.push(...result.grades);
        calls.push({ scenario: scenario.id, grader: graders[index], costMicrodollars: result.costMicrodollars, error: result.error });
      });
    }));
    const summary = summarizeChatQuality(grades);
    const out = { generatedAt: new Date().toISOString(), source: path, graders, summary, calls, grades };
    const file = `${DIR}/grades-${out.generatedAt.replace(/[:.]/g, "-")}.json`;
    writeFileSync(file, JSON.stringify(out, null, 2));
    console.log(`chat grade report: ${file}`);
    for (const row of summary.filter((item) => item.grader === "all")) console.log(JSON.stringify(row));
    console.log(JSON.stringify({ totalCostMicrodollars: calls.reduce((sum, item) => sum + (item.costMicrodollars ?? 0), 0), errors: calls.filter((item) => item.error) }));
    expect(calls.filter((item) => item.error)).toEqual([]);
  }, 1_800_000);
});
