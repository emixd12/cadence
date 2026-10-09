// @vitest-environment jsdom
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BriefingReference } from "@cadence/core/services/briefing-references";
import type { BriefingPlanOption } from "@cadence/core/types/briefing-plan";
import type { DailyBriefing } from "@cadence/core/types/daily-brief";
import { DailyBriefBubble } from "@/components/briefing/DailyBriefBubble";
import { writeBriefingReview, writeReviewPacket } from "@/lib/services/briefing-review.service";
import { createBriefingBenchStore, type BenchCase } from "@/lib/services/briefing-bench-store";

const origin = "http://127.0.0.1:4321";
const caseId = "case-quote-0001";
const runId = "run-quote-0001";
const source: BriefingReference = {
  id: "source-one", revision: "1", title: "Useful Source", url: "https://example.test/source", publishedAt: null,
  reviewedAt: "2026-09-01", kind: "research_evidence", summary: "Summary", applicability: "Applies", limitations: "Limits", status: "active",
};
const option = { intervals: { proposed: { startAt: "2026-11-01T17:00:00Z", endAt: "2026-11-01T17:30:00Z" } } } as BriefingPlanOption;
const briefing: DailyBriefing = {
  text: "A useful overview.", localDate: "2026-11-01", timezone: "America/New_York", generatedAt: "2026-11-01T19:00:00Z",
  expiresAt: "2026-11-01T19:04:00Z", coverage: "complete", warnings: ["Suggestions only. No changes were applied."],
  suggestions: [{ text: "Try the earlier slot.", occurrenceRefs: [], referenceIds: [source.id, "source-two"], optionId: "option-one", option }],
  references: [source, { ...source, id: "source-two", title: "Second Source" }], tip: { text: "Keep the stretch brief.", laneId: "realistic-timing", basis: "Based on six marks.", limitation: "Marks show when you logged a decision." },
};

let root: string;
beforeEach(async () => {
  vi.stubEnv("NODE_ENV", "development");
  root = await mkdtemp(path.join(tmpdir(), "briefing-quote-"));
  const store = createBriefingBenchStore(root);
  const now = new Date().toISOString();
  await store.createCase("synthetic", {
    schemaVersion: 1, kind: "case", id: caseId, createdAt: now,
    source: { mode: "synthetic", fixtureId: "sparse", fixtureVersion: "1", analysisFixtureId: null, analysisFixtureVersion: "1" },
    evidenceType: "synthetic", localDate: briefing.localDate, timezone: briefing.timezone, capturedAt: now,
    expiresAt: new Date(Date.now() + 60_000).toISOString(), capture: {
      historyDays: [], includeCalendar: false, calendarDisclosed: false, includeRecordedElapsedDurations: false,
      includeHistoricalCompletionTimes: false, analysis: false, includeReminders: false, remindersDisclosed: false,
      includeNotes: false, notesDisclosed: false,
    }, behaviorTitles: [],
  } satisfies BenchCase);
  await store.append("synthetic", caseId, "runs", {
    schemaVersion: 1, kind: "run", id: runId, caseId, candidateId: "cand-quote-0001", attemptId: "attempt-1", createdAt: now,
    state: "ready", briefing, validation: "passed", latencyMs: 1, model: "test-model", promptRevision: "prompt",
    configurationRevision: "config", pipelineVersion: "pipeline", inspector: {},
  });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

function feedbackRequest(quote: string) {
  return new Request(`${origin}/api/dev/briefing-reviews`, {
    method: "POST", headers: { origin, "sec-fetch-site": "same-origin", "content-type": "application/json" },
    body: JSON.stringify({ source: "synthetic", action: "feedback", caseId, runIds: [runId, runId], preference: null,
      comment: "Check this output.", quote: { runId, text: quote }, replacement: null }),
  });
}

describe("Daily Brief visible text and quote validation", () => {
  it("renders and accepts quotes from every non-travel visible section, and rejects absent text", async () => {
    const markup = renderToStaticMarkup(<DailyBriefBubble state="ready" briefing={briefing} onDismiss={() => undefined} />);
    const container = document.createElement("div");
    container.innerHTML = markup;
    const links = container.querySelectorAll('a');
    const selection = document.createRange();
    selection.setStartBefore(links[0]!);
    selection.setEndAfter(links[1]!);
    expect(selection.toString()).toBe("Useful Source (research evidence) Second Source (research evidence)");
    const rendered = container.querySelector('[aria-label="Cadence Daily Brief"]')?.textContent?.replace(/\s+/gu, " ") ?? "";
    const quotes = [
      "Hypothetical option: 12:00 PM–12:30 PM (America/New_York). No change applied.",
      "Sources: Useful Source (research evidence) Second Source (research evidence)",
      "Generated 2:00 PM.",
      "Suggestions only. No changes were applied.",
    ];
    for (const quote of quotes) {
      expect(rendered).toContain(quote);
      const response = await writeBriefingReview(feedbackRequest(quote), createBriefingBenchStore(root));
      expect(response.status).toBe(200);
    }
    expect((await writeBriefingReview(feedbackRequest("A line that is not displayed."), createBriefingBenchStore(root))).status).toBe(400);
    await writeReviewPacket(createBriefingBenchStore(root), "synthetic", caseId);
    const packet = await readFile(path.join(root, "synthetic", caseId, "review-packet.md"), "utf8");
    for (const quote of quotes) expect(packet).toContain(`> ${quote}`);
  });
});
