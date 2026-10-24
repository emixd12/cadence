import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBriefingBenchStore, type BenchCase } from "@/lib/services/briefing-bench-store";
import { writeBriefingReview, writeReviewPacket } from "@/lib/services/briefing-review.service";

const origin = "http://127.0.0.1:4321";
const caseId = "case-estimate-0001";
const runId = "run-estimate-0001";
let root: string;

beforeEach(async () => {
  vi.stubEnv("NODE_ENV", "development");
  root = await mkdtemp(path.join(tmpdir(), "briefing-estimate-"));
  const store = createBriefingBenchStore(root);
  const now = new Date().toISOString();
  await store.createCase("synthetic", {
    schemaVersion: 1, kind: "case", id: caseId, createdAt: now,
    source: { mode: "synthetic", fixtureId: "missing_duration", fixtureVersion: "1", analysisFixtureId: null, analysisFixtureVersion: "1" },
    evidenceType: "synthetic", localDate: "2026-11-01", timezone: "America/New_York", capturedAt: now,
    expiresAt: new Date(Date.now() + 60_000).toISOString(), capture: {
      historyDays: [], includeCalendar: false, calendarDisclosed: false, includeRecordedElapsedDurations: false,
      includeHistoricalCompletionTimes: false, analysis: false, includeReminders: false, remindersDisclosed: false,
      includeNotes: false, notesDisclosed: false,
    }, behaviorTitles: [],
  } satisfies BenchCase);
  await store.append("synthetic", caseId, "runs", {
    schemaVersion: 1, kind: "run", id: runId, caseId, candidateId: "cand-estimate-0001", attemptId: "attempt-1", createdAt: now,
    state: "error", error: "advisor_unavailable", validation: "withheld", latencyMs: 1, model: "test-model", promptRevision: "prompt",
    configurationRevision: "config", pipelineVersion: "pipeline", inspector: { durationEstimates: {
      state: "ready", items: [{ behaviorRef: "behavior_fixture", title: "Walk", description: "A loop around the park." }],
      estimates: [{ behaviorRef: "behavior_fixture", minutes: 25, basis: "inferred" }],
    } },
  });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

function review(body: Record<string, unknown>) {
  return writeBriefingReview(new Request(`${origin}/api/dev/briefing-reviews`, {
    method: "POST", headers: { origin, "sec-fetch-site": "same-origin", "content-type": "application/json" },
    body: JSON.stringify({ source: "synthetic", action: "estimate_review", caseId, runId, behaviorRef: "behavior_fixture", actualMinutes: 40, comment: "", ...body }),
  }), createBriefingBenchStore(root));
}

describe("duration estimate reviews", () => {
  it("records the owner's typical length beside the run's estimate and lists it in the packet", async () => {
    const response = await review({ comment: "Includes the walk to the park." });
    expect(response.status).toBe(200);
    const detail = await createBriefingBenchStore(root).readCase("synthetic", caseId);
    expect(detail.estimateReviews).toEqual([expect.objectContaining({ runId, behaviorRef: "behavior_fixture", estimatedMinutes: 25, basis: "inferred", actualMinutes: 40 })]);
    await writeReviewPacket(createBriefingBenchStore(root), "synthetic", caseId);
    const packet = await readFile(path.join(root, "synthetic", caseId, "review-packet.md"), "utf8");
    expect(packet).toContain("## Duration estimate reviews");
    expect(packet).toContain(`| \`${runId}\` | Walk | 25 | inferred | 40 | Includes the walk to the park. |`);
  });

  it("rejects unknown Behaviors, out-of-range lengths and empty reviews", async () => {
    expect((await review({ behaviorRef: "behavior_other" })).status).toBe(400);
    expect((await review({ actualMinutes: 0 })).status).toBe(400);
    expect((await review({ actualMinutes: 481 })).status).toBe(400);
    expect((await review({ actualMinutes: null, comment: "" })).status).toBe(400);
    expect((await review({ extra: true })).status).toBe(400);
    expect((await review({ actualMinutes: null, comment: "Varies a lot." })).status).toBe(200);
  });
});
