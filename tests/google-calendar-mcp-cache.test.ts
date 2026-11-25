import { describe, expect, it, vi } from "vitest";

import {
  createGoogleCalendarMcpCache,
  DEFAULT_MCP_DAILY_PROJECT_ALERT_THRESHOLD,
  DEFAULT_MCP_DAILY_USER_LIMIT,
} from "@/lib/services/google-calendar-mcp-cache";
import type { CalendarListEntry } from "@/lib/types/google-calendar";
import type { ExternalEventSnapshotV1 } from "@cadence/core/types/external-event";

const SAMPLE_CALENDARS: CalendarListEntry[] = [
  {
    id: "primary",
    name: "Primary",
    timezone: "America/New_York",
    primary: true,
    selected: true,
    accessRole: "owner",
  },
];

const SAMPLE_SNAPSHOT = {
  schemaVersion: "1.0.0",
  adapterVersion: "google-calendar-v1",
  accountId: "user-1",
  connectionGeneration: 1,
  source: "google_calendar",
  requestedRange: {
    startLocalDate: "2026-11-25",
    endLocalDate: "2026-11-25",
    timezone: "America/New_York",
    selectedCalendarIds: ["primary"],
  },
  fetchedAt: "2026-11-25T12:00:00Z",
  completeness: "complete",
  freshness: {
    state: "current",
    refreshedAt: "2026-11-25T12:00:00Z",
    label: "Calendar current",
    canAssertNoOverlap: true,
  },
  capabilities: {
    calendar_listing: { support: "supported", permission: "granted", availability: "available" },
    timed_events: { support: "supported", permission: "granted", availability: "available" },
    all_day_events: { support: "supported", permission: "granted", availability: "available" },
    recurrence: { support: "supported", permission: "granted", availability: "available" },
    details: { support: "supported", permission: "granted", availability: "available" },
    source_links: { support: "supported", permission: "granted", availability: "available" },
  },
  coverage: [
    {
      calendarId: "primary",
      startLocalDate: "2026-11-25",
      endLocalDate: "2026-11-25",
      paginationComplete: true,
      itemCount: 0,
    },
  ],
  failures: [],
  events: [],
  tombstones: [],
} as ExternalEventSnapshotV1;

describe("google-calendar-mcp-cache", () => {
  it("expires list_calendars (10 min) and snapshot (5 min) entries by TTL", () => {
    let nowMs = Date.parse("2026-11-25T12:00:00Z");
    const cache = createGoogleCalendarMcpCache({ now: () => nowMs });

    const calKey = { userId: "u1", grantGeneration: 1, selectionRevision: 1 };
    const snapKey = { ...calKey, rangeKey: "2026-11-25..2026-11-25" };

    cache.setCalendars(calKey, SAMPLE_CALENDARS);
    cache.setSnapshot(snapKey, SAMPLE_SNAPSHOT);

    expect(cache.getCalendars(calKey)).toEqual(SAMPLE_CALENDARS);
    expect(cache.getSnapshot(snapKey)).toEqual(SAMPLE_SNAPSHOT);

    // Advance 5 minutes: snapshot expires, calendars still fresh
    nowMs += 5 * 60 * 1_000;
    expect(cache.getSnapshot(snapKey)).toBeNull();
    expect(cache.getCalendars(calKey)).toEqual(SAMPLE_CALENDARS);

    // Advance another 5 minutes (10 total): calendars expire
    nowMs += 5 * 60 * 1_000;
    expect(cache.getCalendars(calKey)).toBeNull();
  });

  it("isolates cache entries by userId, grantGeneration, selectionRevision, and rangeKey, and evicts LRU", () => {
    const cache = createGoogleCalendarMcpCache({ maxEntries: 2 });

    const k1 = { userId: "u1", grantGeneration: 1, selectionRevision: 1, rangeKey: "r1" };
    const k2 = { userId: "u1", grantGeneration: 2, selectionRevision: 1, rangeKey: "r1" };
    const k3 = { userId: "u1", grantGeneration: 1, selectionRevision: 2, rangeKey: "r1" };

    cache.setSnapshot(k1, SAMPLE_SNAPSHOT);
    expect(cache.getSnapshot(k2)).toBeNull();
    expect(cache.getSnapshot(k3)).toBeNull();

    cache.setSnapshot(k2, SAMPLE_SNAPSHOT);
    // Touch k1 so k2 becomes least-recently-used
    expect(cache.getSnapshot(k1)).not.toBeNull();
    cache.setSnapshot(k3, SAMPLE_SNAPSHOT);

    expect(cache.getSnapshot(k2)).toBeNull();
    expect(cache.getSnapshot(k1)).not.toBeNull();
    expect(cache.getSnapshot(k3)).not.toBeNull();
  });

  it("immediately invalidates all entries for a user on disconnect/settings change without affecting other users", () => {
    const cache = createGoogleCalendarMcpCache();

    cache.setCalendars({ userId: "u1", grantGeneration: 1, selectionRevision: 1 }, SAMPLE_CALENDARS);
    cache.setSnapshot({ userId: "u1", grantGeneration: 1, selectionRevision: 1, rangeKey: "r1" }, SAMPLE_SNAPSHOT);
    cache.setCalendars({ userId: "u2", grantGeneration: 1, selectionRevision: 1 }, SAMPLE_CALENDARS);

    cache.invalidateUser("u1");

    expect(cache.getCalendars({ userId: "u1", grantGeneration: 1, selectionRevision: 1 })).toBeNull();
    expect(cache.getSnapshot({ userId: "u1", grantGeneration: 1, selectionRevision: 1, rangeKey: "r1" })).toBeNull();
    expect(cache.getCalendars({ userId: "u2", grantGeneration: 1, selectionRevision: 1 })).toEqual(SAMPLE_CALENDARS);
  });

  it("enforces 40 MCP requests/user/day budget and resets on next UTC day", () => {
    let nowMs = Date.parse("2026-11-25T23:59:00Z");
    const cache = createGoogleCalendarMcpCache({ now: () => nowMs });

    for (let i = 1; i <= DEFAULT_MCP_DAILY_USER_LIMIT; i += 1) {
      const result = cache.consumeBudget("u1");
      expect(result.allowed).toBe(true);
      expect(result.used).toBe(i);
      expect(result.remaining).toBe(DEFAULT_MCP_DAILY_USER_LIMIT - i);
    }

    const blocked = cache.consumeBudget("u1");
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.reason).toBe("mcp_daily_budget_exceeded");

    // Next UTC day resets budget
    nowMs = Date.parse("2026-11-26T00:00:01Z");
    const nextDay = cache.consumeBudget("u1");
    expect(nextDay.allowed).toBe(true);
    expect(nextDay.used).toBe(1);
    expect(nextDay.utcDay).toBe("2026-11-26");
  });

  it("emits a single privacy-safe monitoring warning when project daily volume reaches 3,500 requests/day", () => {
    const reportEvent = vi.fn();
    const cache = createGoogleCalendarMcpCache({
      now: () => Date.parse("2026-11-25T15:00:00Z"),
      reportEvent,
    });

    // Spread 3,500 requests across 100 users (35 each <= 40/user/day)
    for (let userIndex = 0; userIndex < 100; userIndex += 1) {
      const res = cache.consumeBudget(`user-${userIndex}`, 35);
      expect(res.allowed).toBe(true);
    }

    expect(cache.getProjectDailyCount()).toBe(DEFAULT_MCP_DAILY_PROJECT_ALERT_THRESHOLD);
    expect(reportEvent).toHaveBeenCalledTimes(1);
    expect(reportEvent).toHaveBeenCalledWith({
      name: "google_calendar_mcp_daily_volume_warning",
      severity: "warning",
      context: {
        utc_day: "2026-11-25",
        daily_requests: 3_500,
        alert_threshold: 3_500,
      },
    });

    // Subsequent requests on the same UTC day do not spam additional warnings
    cache.consumeBudget("user-extra", 1);
    expect(reportEvent).toHaveBeenCalledTimes(1);
  });
});
