import { describe, expect, it } from "vitest";
import { BRIEFING_ANALYSIS_LANE_IDS } from "@cadence/core/types/briefing-analysis";
import { DEFAULT_BRIEFING_CONFIG } from "@cadence/core/services/briefing-config";
import { BRIEFING_LANE_LABELS, countBriefingWords, diffBriefingConfigs, reviewBriefingReading } from "@cadence/core/services/briefing-review";

describe("briefing reading review", () => {
  it("counts every visible word and places it against the 80–120 working range", () => {
    const words = (count: number) => Array.from({ length: count }, (_, index) => `word${index}`).join(" ");
    expect(reviewBriefingReading({ visibleText: words(79), segments: [] })).toMatchObject({ visibleWords: 79, position: "below" });
    expect(reviewBriefingReading({ visibleText: words(120), segments: [] })).toMatchObject({ visibleWords: 120, position: "within" });
    expect(reviewBriefingReading({ visibleText: words(121), segments: [] }).position).toBe("above");
    expect(countBriefingWords("  one\ntwo   three ")).toBe(3);
  });

  it("warns about a five-word phrase repeated between visible parts, not shorter overlaps", () => {
    const review = reviewBriefingReading({ visibleText: "", segments: [
      { label: "overview", text: "Your walk marks tend to come later than scheduled." },
      { label: "tip", text: "Walk marks tend to come later than its time." },
      { label: "suggestion 1", text: "Try the walk later." },
    ] });
    expect(review.repeated).toEqual([{ between: ["overview", "tip"], phrase: "walk marks tend to come" }]);
  });

  it("flags internal vocabulary unless a Behavior title uses the word", () => {
    const segments = [{ label: "overview", text: "The planner found a move option. Run your Baseline stretch at noon." }];
    expect(reviewBriefingReading({ visibleText: "", segments }).mechanicsTerms).toEqual(["planner", "move option", "baseline"]);
    expect(reviewBriefingReading({ visibleText: "", segments, behaviorTitles: ["Baseline stretch"] }).mechanicsTerms).toEqual(["planner", "move option"]);
  });

  it("labels every analysis lane in plain language", () => {
    expect(Object.keys(BRIEFING_LANE_LABELS).sort()).toEqual([...BRIEFING_ANALYSIS_LANE_IDS].sort());
  });

  it("lists leaf configuration differences with arrays compared whole", () => {
    const after = { ...DEFAULT_BRIEFING_CONFIG, tone: "warm" as const, analysis: { ...DEFAULT_BRIEFING_CONFIG.analysis, lanes: ["decision-debt" as const] } };
    expect(diffBriefingConfigs(DEFAULT_BRIEFING_CONFIG, after)).toEqual([
      { path: "analysis.lanes", before: DEFAULT_BRIEFING_CONFIG.analysis.lanes, after: ["decision-debt"] },
      { path: "tone", before: DEFAULT_BRIEFING_CONFIG.tone, after: "warm" },
    ]);
    expect(diffBriefingConfigs(DEFAULT_BRIEFING_CONFIG, structuredClone(DEFAULT_BRIEFING_CONFIG))).toEqual([]);
  });
});
