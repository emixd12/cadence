import { Temporal } from "@js-temporal/polyfill";
import { expect, it, vi } from "vitest";
import { loadLocalTimeline } from "../apps/desktop/src/local-timeline.service";

// Ticket 320: a linked Mac lists the workout times it received through account sync.
const mocks = vi.hoisted(() => ({ command: vi.fn(), fresh: vi.fn(), evidence: vi.fn(() => ({})) }));
vi.mock("../apps/desktop/src/local-store", () => ({ localCommand: mocks.command }));
vi.mock("../apps/desktop/src/local-generation.service", async (original) => ({
  ...await original<typeof import("../apps/desktop/src/local-generation.service")>(),
  ensureLocalOccurrencesFresh: mocks.fresh,
}));
vi.mock("@cadence/core/services/timeline-source-evidence", async (original) => ({
  ...await original<typeof import("@cadence/core/services/timeline-source-evidence")>(),
  resolveTimelineSourceEvidence: mocks.evidence,
}));

it("passes the synced source matches to the Timeline row evidence", async () => {
  const match = {
    id: "m1", user_id: "owner", occurrence_id: "o1", behavior_id: "b1", source: "hevy",
    activity_start_at: "2026-08-30T22:05:00Z", activity_end_at: "2026-08-30T22:50:00Z", role: "attached", state: "active",
    created_at: "2026-08-30T23:00:00Z", updated_at: "2026-08-30T23:00:00Z",
  };
  mocks.command.mockImplementation(async (operation: string) => {
    if (operation === "readProfile") return { id: "owner", timezone: "America/New_York" };
    if (operation === "readBehaviorGraphs" || operation === "readCategories" || operation === "readOccurrences" || operation === "readDayNotes") return [];
    if (operation === "readOccurrenceHistory") return { statusEvents: [], timeSessions: [], sourceMatches: [match] };
    throw new Error(operation);
  });

  await loadLocalTimeline(7, Temporal.Instant.from("2026-08-30T16:00:00Z"));

  expect(mocks.evidence).toHaveBeenCalledWith(expect.objectContaining({
    matches: [{ occurrenceId: "o1", source: "hevy", state: "active", activityStartAt: "2026-08-30T22:05:00Z", activityEndAt: "2026-08-30T22:50:00Z" }],
  }));
});
