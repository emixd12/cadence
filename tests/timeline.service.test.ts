import { Temporal } from "@js-temporal/polyfill";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  requireCurrentUserId: vi.fn(),
  readCachedProfileTimezone: vi.fn(),
  readCachedUserBehaviors: vi.fn(),
  readOccurrenceSyncState: vi.fn(),
  ensureUserOccurrencesFresh: vi.fn(),
  listOccurrencesBetweenLocalDates: vi.fn(),
  listResolvedOccurrencesBeforeLocalDateMarkedBetween: vi.fn(),
  listUnresolvedOccurrencesBeforeLocalDate: vi.fn(),
  listTimeSessionHistory: vi.fn(),
  listTimeSessionsByOccurrenceIds: vi.fn(),
  resolveGenerationWindow: vi.fn(),
  resolveTimeline: vi.fn(),
  listDayNotesInRange: vi.fn(),
  listPeriods: vi.fn(),
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
vi.mock("@/lib/db/occurrences.repo", () => ({
  listOccurrencesBetweenLocalDates: mocks.listOccurrencesBetweenLocalDates,
  listOccurrencesByIds: vi.fn(async () => []),
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
vi.mock("@/lib/db/periods.repo", () => ({
  listPeriodsOrNone: mocks.listPeriods,
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
    mocks.listPeriods.mockResolvedValue([]);
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
      userId: "user-1", startLocalDate: null, endLocalDate: "2026-08-07",
      includeArchived: false, throughStartedAt: "2026-08-08T16:00:00Z",
    });
  });

  // Ticket 369: the Timeline view carries the Periods its day headers show.
  describe("Periods on the view", () => {
    const period = (overrides: Record<string, unknown>) => ({
      id: "p-1", user_id: "user-1", label: "Sick", start_on: "2026-08-07", end_on: "2026-08-08", note: null,
      revision: 1, created_at: "2026-08-06T12:00:00Z", updated_at: "2026-08-06T12:00:00Z", ...overrides,
    });
    const load = async () => {
      const { getTimelinePageData } = await import("../lib/services/timeline.service");
      return getTimelinePageData({ now: Temporal.Instant.from("2026-08-08T16:00:00Z") });
    };

    it("attaches the Periods that cover a shown day, a per-date index and label suggestions", async () => {
      mocks.listPeriods.mockResolvedValue([
        period({}),
        period({ id: "p-2", label: "Travel", start_on: "2026-08-09", end_on: "2026-08-09", note: "Lisbon", revision: 3, created_at: "2026-08-07T12:00:00Z" }),
        period({ id: "p-3", label: "sick", start_on: "2026-07-01", end_on: "2026-07-02", created_at: "2026-07-01T12:00:00Z" }),
        period({ id: "p-4", label: "Exams", start_on: "2027-08-20", end_on: "2027-08-25", created_at: "2026-08-01T12:00:00Z" }),
      ]);

      const view = await load();

      // The whole account's list is read once, with no range.
      expect(mocks.listPeriods).toHaveBeenCalledTimes(1);
      expect(mocks.listPeriods).toHaveBeenCalledWith(expect.anything(), "user-1");
      // The view shows today, August 8, and the days after it. August 7 is not shown.
      expect(view.daySections[0]?.localDate).toBe("2026-08-08");
      const sick = { id: "p-1", label: "Sick", start_on: "2026-08-07", end_on: "2026-08-08", note: null, revision: 1 };
      const travel = { id: "p-2", label: "Travel", start_on: "2026-08-09", end_on: "2026-08-09", note: "Lisbon", revision: 3 };
      expect(view.periodsByDate).toEqual({
        "2026-08-08": [sick],
        "2026-08-09": [travel],
      });
      // Only Periods on a shown day; ownership and timestamps stay on the server.
      expect(view.periods).toEqual([sick, travel]);
      // Suggestions come from every Period, newest first, one spelling per label.
      expect(view.periodLabelSuggestions).toEqual(["Travel", "Sick", "Exams"]);
    });

    it("does not hide a Periods read failure (a missing table already reads as none in the repository)", async () => {
      mocks.listPeriods.mockRejectedValue({ code: "42501", message: "permission denied" });
      await expect(load()).rejects.toMatchObject({ code: "42501" });
    });
  });
});
