import { describe, expect, it, vi } from "vitest";

// Advisor plan Phase 4G: a Calendar that returns only part of the day must not count as fully read,
// so the stored day load leaves its calendar numbers out.
vi.mock("@/lib/services/google-calendar.service", () => ({ getCalendarConnection: vi.fn(), getCalendarEvents: vi.fn() }));
vi.mock("@/lib/services/outlook-calendar.service", () => ({ getOutlookCalendarConnection: vi.fn(), getOutlookCalendarEvents: vi.fn() }));
vi.mock("@/lib/services/icloud-calendar.service", () => ({ getIcloudCalendarConnection: vi.fn(), getIcloudCalendarEvents: vi.fn() }));

const { getCalendarEvents } = await import("../lib/services/google-calendar.service");
const { getOutlookCalendarEvents } = await import("../lib/services/outlook-calendar.service");
const { readTravelCalendarEvents } = await import("../lib/services/travel-calendar-sources");
const { createHostedDayLoadReads } = await import("../lib/services/day-load.service");

const snapshot = (completeness: "complete" | "incomplete") => ({ requestedRange: { timezone: "America/New_York" }, completeness, events: [] });
const connections = {
  google: { status: "connected" },
  outlook: { status: "connected", preferences: { selectedSourceIds: ["a"] } },
  icloud: { status: "disconnected", preferences: { selectedSourceIds: [] } },
} as never;
const request = { scope: "day", startLocalDate: "2026-11-20", endLocalDate: "2026-11-20" } as const;

describe("calendar read completeness", () => {
  it("is complete only when every Calendar read returned the whole range", async () => {
    vi.mocked(getCalendarEvents).mockResolvedValue(snapshot("complete") as never);
    vi.mocked(getOutlookCalendarEvents).mockResolvedValue(snapshot("complete") as never);
    expect((await readTravelCalendarEvents({} as never, connections, request)).complete).toBe(true);

    vi.mocked(getOutlookCalendarEvents).mockResolvedValue(snapshot("incomplete") as never);
    const partial = await readTravelCalendarEvents({} as never, connections, request);
    expect(partial.complete).toBe(false);
    expect(partial.unavailable).toEqual([]);

    vi.mocked(getOutlookCalendarEvents).mockResolvedValue(snapshot("complete") as never);
    vi.mocked(getCalendarEvents).mockResolvedValue(snapshot("incomplete") as never);
    expect((await readTravelCalendarEvents({} as never, connections, request)).complete).toBe(false);
  });

  it("pages the day load's occurrence history past the 1,000-row cap", async () => {
    const ranges: Array<[number, number]> = [];
    const rows = Array.from({ length: 1_500 }, (_, index) => ({ id: `o${String(index).padStart(4, "0")}`, behavior_id: "b", local_date: "2026-10-01", status: "completed" }));
    const query = { select: () => query, eq: () => query, gte: () => query, lte: () => query, order: () => query,
      range: async (from: number, to: number) => { ranges.push([from, to]); return { data: rows.slice(from, to + 1), error: null }; } };
    const reads = createHostedDayLoadReads({ user: { id: "u" }, client: { from: () => query } } as never);
    expect(await reads.occurrences("2026-08-22", "2026-11-19")).toHaveLength(1_500);
    expect(ranges).toEqual([[0, 999], [1000, 1999]]);
  });
});
