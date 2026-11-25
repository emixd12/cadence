import { describe, expect, it, vi } from "vitest";
import {
  clearCalendarLoadForSource,
  connectBackfillDateRange,
  getDailyCalendarLoadForUser,
  persistCalendarLoadFromSnapshot,
} from "@/lib/services/daily-calendar-load.service";
import { Temporal } from "@js-temporal/polyfill";

function fakeSupabase(options: { rows?: unknown[]; onUpsert?: (payload: unknown) => void; onDelete?: () => void } = {}) {
  return {
    from: () => ({
      upsert: (payload: unknown) => {
        options.onUpsert?.(payload);
        return Promise.resolve({ error: null });
      },
      delete: () => ({
        eq: () => ({
          eq: () => {
            options.onDelete?.();
            return Promise.resolve({ error: null });
          },
        }),
      }),
      select: () => ({
        eq: () => ({
          gte: () => ({
            lte: () => ({
              order: () => ({
                order: () => ({
                  in: () => Promise.resolve({ data: options.rows ?? [], error: null }),
                  then: (resolve: (v: unknown) => void) => resolve({ data: options.rows ?? [], error: null }),
                }),
              }),
            }),
          }),
        }),
      }),
    }),
  } as never;
}

describe("daily-calendar-load.service", () => {
  it("skips persistence for incomplete snapshots", async () => {
    const onUpsert = vi.fn();
    const written = await persistCalendarLoadFromSnapshot(
      fakeSupabase({ onUpsert }),
      "user-1",
      "google_calendar",
      1,
      {
        completeness: "incomplete",
        requestedRange: { startLocalDate: "2026-11-24", endLocalDate: "2026-11-24", timezone: "America/New_York" },
        events: [],
      },
      "2026-11-24T12:00:00Z",
    );
    expect(written).toBe(0);
    expect(onUpsert).not.toHaveBeenCalled();
  });

  it("blocks standard Timeline Google Calendar writes and persists agent_mcp Google writes with <=30-day expiry", async () => {
    const onStandardUpsert = vi.fn();
    const standardWritten = await persistCalendarLoadFromSnapshot(
      fakeSupabase({ onUpsert: onStandardUpsert }),
      "user-1",
      "google_calendar",
      2,
      {
        completeness: "complete",
        requestedRange: { startLocalDate: "2026-11-24", endLocalDate: "2026-11-24", timezone: "America/New_York" },
        events: [],
      },
      "2026-11-24T12:00:00Z",
    );
    expect(standardWritten).toBe(0);
    expect(onStandardUpsert).not.toHaveBeenCalled();

    let captured: unknown = null;
    const written = await persistCalendarLoadFromSnapshot(
      fakeSupabase({ onUpsert: (payload) => { captured = payload; } }),
      "user-1",
      "google_calendar",
      2,
      {
        completeness: "complete",
        requestedRange: { startLocalDate: "2026-11-24", endLocalDate: "2026-11-24", timezone: "America/New_York" },
        events: [],
      },
      "2026-11-24T12:00:00Z",
      { grantPurpose: "agent_mcp" },
    );
    expect(written).toBe(1);
    expect(captured).toEqual([
      {
        user_id: "user-1",
        source: "google_calendar",
        local_date: "2026-11-24",
        busy_minutes: 0,
        event_count: 0,
        earliest_start_minute: null,
        latest_end_minute: null,
        has_all_day_busy: false,
        connection_generation: 2,
        synced_at: "2026-11-24T12:00:00Z",
        grant_purpose: "agent_mcp",
        expires_at: "2026-12-24T12:00:00Z",
      },
    ]);
  });

  it("clears source rows on disconnect", async () => {
    const onDelete = vi.fn();
    await clearCalendarLoadForSource(fakeSupabase({ onDelete }), "user-1", "outlook_calendar");
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it("aggregates multi-source rollups per local_date", async () => {
    const res = await getDailyCalendarLoadForUser(
      fakeSupabase({
        rows: [
          {
            user_id: "u1", source: "google_calendar", local_date: "2026-11-20",
            busy_minutes: 90, event_count: 2, earliest_start_minute: 540, latest_end_minute: 720,
            has_all_day_busy: false, connection_generation: 1, synced_at: "2026-11-24T00:00:00Z",
          },
          {
            user_id: "u1", source: "outlook_calendar", local_date: "2026-11-20",
            busy_minutes: 60, event_count: 1, earliest_start_minute: 480, latest_end_minute: 840,
            has_all_day_busy: true, connection_generation: 1, synced_at: "2026-11-24T00:00:00Z",
          },
        ],
      }),
      "u1",
      "2026-11-01",
      "2026-11-24",
      { sources: ["google_calendar", "outlook_calendar"] },
    );
    expect(res.days).toEqual([
      {
        local_date: "2026-11-20",
        busy_minutes: 150,
        event_count: 3,
        earliest_start_minute: 480,
        latest_end_minute: 840,
        has_all_day_busy: true,
        sources: ["google_calendar", "outlook_calendar"],
      },
    ]);
  });

  it("computes 30-day connect backfill range", () => {
    const range = connectBackfillDateRange("America/New_York", Temporal.Instant.from("2026-11-24T15:00:00Z"), 30);
    expect(range).toEqual({ startLocalDate: "2026-10-26", endLocalDate: "2026-11-24" });
  });
});
