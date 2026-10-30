import { describe, expect, it } from "vitest";
import { BRIEFING_ANALYSIS_LANE_IDS } from "@cadence/core/types/briefing-analysis";
import { DEFAULT_BRIEFING_CONFIG } from "@cadence/core/services/briefing-config";
import { BRIEFING_LANE_LABELS, countBriefingWords, diffBriefingConfigs, reviewBriefingReading } from "@cadence/core/services/briefing-review";

describe("briefing reading review", () => {
  it("counts every visible word against the configured cap, with no minimum", () => {
    const words = (count: number) => Array.from({ length: count }, (_, index) => `word${index}`).join(" ");
    expect(reviewBriefingReading({ visibleText: words(20), segments: [] })).toMatchObject({ visibleWords: 20, position: "within", target: { minWords: 0, maxWords: 120 } });
    expect(reviewBriefingReading({ visibleText: words(120), segments: [] })).toMatchObject({ visibleWords: 120, position: "within" });
    expect(reviewBriefingReading({ visibleText: words(121), segments: [] }).position).toBe("above");
    expect(reviewBriefingReading({ visibleText: words(150), segments: [], maxWords: 150 })).toMatchObject({ position: "within", target: { maxWords: 150 } });
    expect(reviewBriefingReading({ visibleText: words(151), segments: [], maxWords: 150 }).position).toBe("above");
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

  it("does not count a Behavior title in two parts as repetition, but still flags repeated advice", () => {
    const title = "Physical Therapy in Red Light";
    const nameOnly = reviewBriefingReading({
      visibleText: "", behaviorTitles: [title],
      segments: [
        { label: "overview", text: `${title} was due at 10:00 AM and is still open.` },
        { label: "tip", text: `Record the decision right after doing ${title}.` },
      ],
    });
    expect(nameOnly.repeated).toEqual([]);
    const advice = reviewBriefingReading({
      visibleText: "", behaviorTitles: [title],
      segments: [
        { label: "overview", text: `For ${title}, record the decision right after you finish.` },
        { label: "tip", text: `Try to record the decision right after you finish ${title}.` },
      ],
    });
    expect(advice.repeated).toEqual([{ between: ["overview", "tip"], phrase: "record the decision right after" }]);
  });

  it("flags internal vocabulary unless a Behavior title uses the word", () => {
    const segments = [{ label: "overview", text: "The planner found a move option. Run your Baseline stretch at noon." }];
    expect(reviewBriefingReading({ visibleText: "", segments }).mechanicsTerms).toEqual(["planner", "move option", "baseline"]);
    expect(reviewBriefingReading({ visibleText: "", segments, behaviorTitles: ["Baseline stretch"] }).mechanicsTerms).toEqual(["planner", "move option"]);
  });

  it("exempts whole title mentions without masking the same term elsewhere or partial title matches", () => {
    const review = reviewBriefingReading({ visibleText: "", behaviorTitles: ["Baseline stretch"], segments: [
      { label: "overview", text: "The Baseline—stretch is at noon. The baseline target is unclear." },
      { label: "tip", text: "Baseline stretching may need a different time." },
    ] });
    expect(review.mechanicsTerms).toEqual(["baseline"]);
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
