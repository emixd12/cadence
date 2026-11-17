import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { advisorEvalFixtures } from "@/lib/services/advisor-eval/fixtures";
import { fixtureFacts, gradeFixture, summarizeQuality, topPickAgreement, type QualityGrade } from "@/lib/services/advisor-eval/grader";
import type { AdvisorEvalResult } from "@/lib/services/advisor-eval/harness";

/**
 * Layer 3 live grading. Calls real grader models, so it costs money and is skipped
 * unless `CADENCE_ADVISOR_GRADE=1`. Run with `npm run advisor:grade`.
 *
 * - Grades the briefs saved in an `advisor:eval` report: `CADENCE_ADVISOR_GRADE_REPORT`
 *   (default: the newest file in `.local/advisor-eval/`). Nothing is regenerated.
 * - Graders: `CADENCE_ADVISOR_GRADERS`, comma-separated (default Claude Opus 5.5 and
 *   GPT-5.6 Sol, one per family). Direct transport bills each creator's own key.
 * - One grader over 10 fixtures with 5 candidates costs roughly US$0.25 to 0.40.
 *
 * Reports go to `.local/advisor-eval/` (git-ignored). They hold synthetic briefs only.
 */
const enabled = process.env.CADENCE_ADVISOR_GRADE === "1";

describe.skipIf(!enabled)("advisor quality grading (live)", () => {
  it("grades every candidate brief blind with each grader", async () => {
    const dir = ".local/advisor-eval";
    const path = process.env.CADENCE_ADVISOR_GRADE_REPORT
      ?? `${dir}/${readdirSync(dir).filter((name) => name.endsWith(".json") && !name.startsWith("grades-")).sort().at(-1)}`;
    const report = JSON.parse(readFileSync(path, "utf8")) as { baseline: { results: AdvisorEvalResult[] } | null; candidates: { results: AdvisorEvalResult[] }[] };
    const runs = [...(report.baseline ? [report.baseline] : []), ...report.candidates].map((row) => row.results);
    const graders = (process.env.CADENCE_ADVISOR_GRADERS ?? "anthropic/claude-opus-5.5,openai/gpt-5.6-sol").split(",").map((item) => item.trim()).filter(Boolean);

    const grades: QualityGrade[] = [];
    const calls: { fixture: string; grader: string; costMicrodollars: number | null; error: string | null }[] = [];
    for (const fixture of advisorEvalFixtures()) {
      const facts = await fixtureFacts(fixture);
      const briefs = runs.flatMap((results) => results.filter((item) => item.fixture === fixture.id).map((item) => ({ label: item.label, brief: item.brief })));
      const graded = await Promise.all(graders.map((grader) => gradeFixture({ fixture, facts, briefs, grader })));
      graded.forEach((result, index) => {
        grades.push(...result.grades);
        calls.push({ fixture: fixture.id, grader: graders[index], costMicrodollars: result.costMicrodollars, error: result.error });
      });
    }

    const summary = summarizeQuality(grades);
    const agreement = graders.length >= 2 ? topPickAgreement(grades, graders[0], graders[1]) : null;
    const out = { generatedAt: new Date().toISOString(), source: path, graders, summary, agreement, calls, grades };
    mkdirSync(dir, { recursive: true });
    const file = `${dir}/grades-${out.generatedAt.replace(/[:.]/g, "-")}.json`;
    writeFileSync(file, JSON.stringify(out, null, 2));
    console.log(`advisor grade report: ${file}`);
    for (const row of summary) console.log(JSON.stringify(row));
    console.log(JSON.stringify({ agreement, totalCostMicrodollars: calls.reduce((sum, item) => sum + (item.costMicrodollars ?? 0), 0),
      errors: calls.filter((item) => item.error).map((item) => `${item.fixture}:${item.grader}:${item.error}`) }));

    expect(calls.filter((item) => item.error)).toEqual([]);
  }, 1_200_000);
});
