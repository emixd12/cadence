import { Temporal } from "@js-temporal/polyfill";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  requireCurrentUserId: vi.fn(),
  readCachedProfileTimezone: vi.fn(),
  readCachedUserBehaviors: vi.fn(),
  readOccurrenceSyncState: vi.fn(),
  ensureUserOccurrencesFresh: vi.fn(),
  reconcileMyDueBehaviorArchives: vi.fn(),
  listOccurrencesBetweenLocalDates: vi.fn(),
  listResolvedOccurrencesBeforeLocalDateMarkedBetween: vi.fn(),
  listUnresolvedOccurrencesBeforeLocalDate: vi.fn(),
  listTimeSessionHistory: vi.fn(),
  listTimeSessionsByOccurrenceIds: vi.fn(),
  resolveGenerationWindow: vi.fn(),
  resolveTimeline: vi.fn(),
  listDayNotesInRange: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/auth/current-user", () => ({
  requireCurrentUserId: mocks.requireCurrentUserId,
}));
vi.mock("@/lib/cache/stable-user-data.cache", () => ({
  readCachedProfileTimezone: mocks.readCachedProfileTimezone,
  readCachedUserBehaviors: mocks.readCachedUserBehaviors,
  readCachedBehaviorLogImportRuns: vi.fn(),
}));
vi.mock("@/lib/services/occurrence-sync-state.service", () => ({
  readOccurrenceSyncState: mocks.readOccurrenceSyncState,
}));
vi.mock("@/lib/services/occurrence.service", () => ({
  ensureUserOccurrencesFresh: mocks.ensureUserOccurrencesFresh,
}));
vi.mock("@/lib/services/behavior-lifecycle.service", () => ({
  reconcileMyDueBehaviorArchives: mocks.reconcileMyDueBehaviorArchives,
}));
vi.mock("@/lib/db/occurrences.repo", () => ({
  listOccurrencesBetweenLocalDates: mocks.listOccurrencesBetweenLocalDates,
  listResolvedOccurrencesBeforeLocalDateMarkedBetween:
    mocks.listResolvedOccurrencesBeforeLocalDateMarkedBetween,
  listUnresolvedOccurrencesBeforeLocalDate:
    mocks.listUnresolvedOccurrencesBeforeLocalDate,
}));
vi.mock("@/lib/db/timeSessions.repo", () => ({
  listTimeSessionHistory: mocks.listTimeSessionHistory,
  listTimeSessionsByOccurrenceIds: mocks.listTimeSessionsByOccurrenceIds,
}));
vi.mock("@/lib/db/dayNotes.repo", () => ({
  listDayNotesInRange: mocks.listDayNotesInRange,
}));
vi.mock("@/lib/resolvers/occurrence.resolver", () => ({
  resolveGenerationWindow: mocks.resolveGenerationWindow,
}));
vi.mock("@/lib/resolvers/timeline.resolver", () => ({
  TIMELINE_MAX_FUTURE_DAYS: 30,
  resolveTimeline: mocks.resolveTimeline,
}));

describe("timeline service time-session routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockResolvedValue({});
    mocks.requireCurrentUserId.mockResolvedValue("user-1");
    mocks.readCachedProfileTimezone.mockResolvedValue("America/New_York");
    mocks.readCachedUserBehaviors.mockResolvedValue([]);
    mocks.readOccurrenceSyncState.mockResolvedValue(null);
    mocks.ensureUserOccurrencesFresh.mockResolvedValue({ synced: false });
    mocks.reconcileMyDueBehaviorArchives.mockResolvedValue([]);
    mocks.listOccurrencesBetweenLocalDates.mockResolvedValue([]);
    mocks.listResolvedOccurrencesBeforeLocalDateMarkedBetween.mockResolvedValue(
      [],
    );
    mocks.listUnresolvedOccurrencesBeforeLocalDate.mockResolvedValue([]);
    mocks.listTimeSessionsByOccurrenceIds.mockResolvedValue([]);
    mocks.listTimeSessionHistory.mockResolvedValue([]);
    mocks.resolveGenerationWindow.mockReturnValue({
      startLocalDate: "2026-08-08",
      endLocalDate: "2026-09-07",
    });
    mocks.resolveTimeline.mockReturnValue({ kind: "timeline-view" });
    mocks.listDayNotesInRange.mockResolvedValue([]);
  });

  it("keeps the arbitrary-ID repository contract", async () => {
    const { getTimelinePageData } = await import(
      "../lib/services/timeline.service"
    );

    await getTimelinePageData({
      now: Temporal.Instant.from("2026-08-08T16:00:00Z"),
    });

    expect(mocks.listTimeSessionsByOccurrenceIds).toHaveBeenCalledWith(
      expect.anything(),
      { userId: "user-1", occurrenceIds: [] },
    );
    expect(mocks.listTimeSessionHistory).toHaveBeenCalledWith(expect.anything(), {
      userId: "user-1", startLocalDate: "2026-05-10", endLocalDate: "2026-08-07",
      includeArchived: false, throughStartedAt: "2026-08-08T16:00:00Z",
    });
  });
});
