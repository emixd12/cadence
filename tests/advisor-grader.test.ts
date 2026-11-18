import { describe, expect, it, vi } from "vitest";
import { advisorEvalFixtures } from "@/lib/services/advisor-eval/fixtures";
import { fixtureFacts, gradeFixture, parseGrades, shownText, shuffled, summarizeQuality, topPickAgreement, type QualityGrade } from "@/lib/services/advisor-eval/grader";
import { OPENAI_ENV, responsesReply } from "./helpers/model-responses";

const brief = (text: string) => ({ text, suggestions: [{ text: `Move it (${text})` }] }) as never;
const fixture = advisorEvalFixtures(["new_user"])[0];
const scores = (value: number) => ({ accurate: value, useful: value, clear: value, warm: value, concise: value });

describe("advisor quality grader (layer 3)", () => {
  it("shuffles deterministically, and differently per seed", () => {
    const items = ["a", "b", "c", "d", "e"];
    expect(shuffled(items, "x")).toEqual(shuffled(items, "x"));
    expect([...shuffled(items, "x")].sort()).toEqual(items);
    expect(["y1", "y2", "y3", "y4"].some((seed) => shuffled(items, seed).join() !== shuffled(items, "x").join())).toBe(true);
  });

  it("shows the grader what a person sees", () => {
    expect(shownText({ text: "Hi.", suggestions: [{ text: "Move walk." }], tip: { text: "Drink water." } } as never)).toBe("Hi.\nSuggestion: Move walk.\nTip: Drink water.");
  });

  it("maps letters back to labels and drops malformed grades", () => {
    const lettered = [{ letter: "A", label: "m1" }, { letter: "B", label: "m2" }, { letter: "C", label: "m3" }];
    const grades = parseGrades({ grades: [{ letter: "A", ...scores(5), reason: "Good." }, { letter: "B", ...scores(4), clear: 9, reason: "Bad score." }],
      ranking: ["A", "A", "C", "Z"] }, lettered, "new_user", "g");
    expect(grades.map((item) => [item.label, item.scores?.warm ?? null, item.rank])).toEqual([["m1", 5, 1], ["m2", null, null], ["m3", null, 2]]);
  });

  it("summarizes per grader and overall, and measures top-pick agreement", () => {
    const row = (fixtureId: string, grader: string, label: string, value: number, rank: number): QualityGrade =>
      ({ fixture: fixtureId as never, grader, label, letter: "A", scores: scores(value), rank, reason: null });
    const grades = [row("f1", "g1", "m1", 5, 1), row("f1", "g1", "m2", 3, 2), row("f1", "g2", "m1", 4, 1), row("f1", "g2", "m2", 4, 2),
      row("f2", "g1", "m1", 3, 2), row("f2", "g1", "m2", 5, 1), row("f2", "g2", "m1", 5, 1), row("f2", "g2", "m2", 3, 2)];
    const all = summarizeQuality(grades).filter((item) => item.grader === "all");
    expect(all.find((item) => item.label === "m1")).toMatchObject({ graded: 4, overall: 4.25, meanRank: 1.25, firstPlaces: 3 });
    expect(topPickAgreement(grades, "g1", "g2")).toBe(0.5);
  });

  it("grades blind: no model names reach the grader, and failed briefs are listed, not sent", async () => {
    const facts = await fixtureFacts(fixture);
    expect(facts).toContain("clock");
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(responsesReply({ grades: [{ letter: "A", ...scores(4), reason: "Fine." }, { letter: "B", ...scores(3), reason: "Stiff." }], ranking: ["A", "B"] },
      { input: 3_000, cached: 0, output: 200, reasoning: 0 })));
    const result = await gradeFixture({ fixture, facts, grader: "openai/gpt-5.6-sol", env: OPENAI_ENV, fetch: fetcher,
      briefs: [{ label: "ai-sdk:anthropic/claude-haiku-5.5", brief: brief("one") }, { label: "ai-sdk:openai/gpt-5.6-luna", brief: brief("two") }, { label: "ai-sdk:x/broken", brief: null }] });
    const sent = String(fetcher.mock.calls[0][1]!.body);
    expect(sent).not.toMatch(/claude|luna|haiku|broken/i);
    expect(sent).toContain("BRIEF A");
    expect(result.error).toBeNull();
    expect(result.costMicrodollars).toBe(16_000); // 3,000 input at US$4 per million plus 200 output at US$20 per million.
    expect(result.grades.map((item) => item.label).sort()).toEqual(["ai-sdk:anthropic/claude-haiku-5.5", "ai-sdk:openai/gpt-5.6-luna", "ai-sdk:x/broken"]);
    expect(result.grades.find((item) => item.label === "ai-sdk:x/broken")).toMatchObject({ scores: null, reason: "no valid brief" });
  });

  it("reports a grader failure without throwing", async () => {
    const result = await gradeFixture({ fixture, facts: "{}", grader: "openai/gpt-5.6-sol", env: OPENAI_ENV,
      fetch: async () => new Response("no", { status: 500 }), briefs: [{ label: "m1", brief: brief("one") }] });
    expect(result.error).toBe("provider_http_5xx");
    expect(result.grades).toEqual([]);
  });
});
