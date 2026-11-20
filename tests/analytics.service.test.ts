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
  listUnresolvedOccurrencesBeforeLocalDate: vi.fn(),
  listTimeSessionHistory: vi.fn(),
  listTimeSessionsByOccurrenceIds: vi.fn(),
  resolveAnalyticsDateRange: vi.fn(),
  resolveAnalytics: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/auth/current-user", () => ({
  requireCurrentUserId: mocks.requireCurrentUserId,
}));
vi.mock("@/lib/cache/stable-user-data.cache", () => ({
  readCachedProfileTimezone: mocks.readCachedProfileTimezone,
  readCachedUserBehaviors: mocks.readCachedUserBehaviors,
}));
vi.mock("@/lib/services/occurrence-sync-state.service", () => ({
  readOccurrenceSyncState: mocks.readOccurrenceSyncState,
}));
vi.mock("@/lib/services/occurrence.service", () => ({
  ensureUserOccurrencesFresh: mocks.ensureUserOccurrencesFresh,
}));
vi.mock("@/lib/db/occurrences.repo", () => ({
  listOccurrencesBetweenLocalDates: mocks.listOccurrencesBetweenLocalDates,
  listUnresolvedOccurrencesBeforeLocalDate:
    mocks.listUnresolvedOccurrencesBeforeLocalDate,
}));
vi.mock("@/lib/db/timeSessions.repo", () => ({
  listTimeSessionHistory: mocks.listTimeSessionHistory,
  listTimeSessionsByOccurrenceIds: mocks.listTimeSessionsByOccurrenceIds,
}));
vi.mock("@cadence/core/resolvers/analytics.resolver", () => ({
  resolveAnalyticsDateRange: mocks.resolveAnalyticsDateRange,
  resolveAnalytics: mocks.resolveAnalytics,
}));

describe("analytics service time-session routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockResolvedValue({});
    mocks.requireCurrentUserId.mockResolvedValue("user-1");
    mocks.readCachedProfileTimezone.mockResolvedValue("America/New_York");
    mocks.readCachedUserBehaviors.mockResolvedValue([]);
    mocks.readOccurrenceSyncState.mockResolvedValue(null);
    mocks.ensureUserOccurrencesFresh.mockResolvedValue({ synced: false });
    mocks.listOccurrencesBetweenLocalDates.mockResolvedValue([]);
    mocks.listUnresolvedOccurrencesBeforeLocalDate.mockResolvedValue([]);
    mocks.listTimeSessionHistory.mockResolvedValue([]);
    mocks.resolveAnalyticsDateRange.mockReturnValue({
      startLocalDate: "2026-05-11",
      endLocalDate: "2026-08-08",
      rangeDays: 90,
    });
    mocks.resolveAnalytics.mockReturnValue({ kind: "analytics-view" });
  });

  it("reads joined history by local-date range with a fixed high-water", async () => {
    const now = Temporal.Instant.from("2026-08-08T16:00:00Z");
    const { getAnalyticsPageData } = await import(
      "../lib/services/analytics.service"
    );

    await getAnalyticsPageData({ now, rangeDays: 90 });

    expect(mocks.listTimeSessionHistory).toHaveBeenCalledWith(
      expect.anything(),
      {
        userId: "user-1",
        startLocalDate: "2026-05-11",
        endLocalDate: "2026-08-08",
        includeArchived: true,
        throughStartedAt: "2026-08-08T16:00:00Z",
      },
    );
    expect(mocks.listTimeSessionsByOccurrenceIds).not.toHaveBeenCalled();
  });
});
