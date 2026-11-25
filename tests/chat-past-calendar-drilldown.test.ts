import { describe, expect, it, vi } from "vitest";
import {
  coalesceTargetDates,
  createEphemeralCalendarSessionCache,
} from "@/lib/services/chat/chat-calendar-cache";
import { createLiveChatExecutor, type ChatCalendarEvent, type ChatConnectorReads } from "@/lib/services/chat/chat-executor";

function makeEvent(date: string, title: string): ChatCalendarEvent {
  return {
    title,
    calendar: "Work",
    source: "googleCalendar",
    start: `${date}T15:00:00Z`,
    end: `${date}T16:00:00Z`,
    all_day: false,
    location: null,
    busy: true,
  };
}

describe("chat past calendar drill-down, coalescing & ephemeral cache (Ticket 355)", () => {
  it("coalesces nearby target dates into minimal bounding spans within 31 days", () => {
    const spans = coalesceTargetDates(["2026-10-02", "2026-10-04", "2026-10-05", "2026-11-10"]);
    expect(spans).toEqual([
      { start: "2026-10-02", end: "2026-10-05" },
      { start: "2026-11-10", end: "2026-11-10" },
    ]);
  });

  it("reuses ephemeral session cache for overlapping spans without repeat provider calls", async () => {
    const fetchSpan = vi.fn(async () => ({
      events: [makeEvent("2026-11-01", "Planning"), makeEvent("2026-11-03", "Review")],
      sources: [{ source: "googleCalendar" as const, state: "read" as const }],
    }));
    const cache = createEphemeralCalendarSessionCache(fetchSpan);

    const first = await cache.readSpan("2026-11-01", "2026-11-05");
    expect(first.events).toHaveLength(2);
    expect(fetchSpan).toHaveBeenCalledTimes(1);

    const second = await cache.readSpan("2026-11-03", "2026-11-03");
    expect(second.events.map((e) => e.title)).toEqual(["Review"]);
    expect(fetchSpan).toHaveBeenCalledTimes(1);
  });

  it("allows past dates in list_calendar_events up to 31 days, rejects >31 days, and supports list_calendar_load", async () => {
    const calendarEvents = vi.fn(async () => ({
      events: [makeEvent("2026-10-15", "Offsite")],
      sources: [{ source: "googleCalendar" as const, state: "read" as const }],
    }));
    const calendarLoad = vi.fn(async () => ({
      days: [{
        local_date: "2026-10-15",
        busy_minutes: 360,
        event_count: 5,
        earliest_start_minute: 540,
        latest_end_minute: 1020,
        has_all_day_busy: false,
        sources: ["google_calendar" as const],
      }],
      sources: [{ source: "googleCalendar" as const, state: "read" as const }],
    }));
    const reads: ChatConnectorReads = {
      calendarEvents,
      calendarLoad,
      workouts: async () => ({ workouts: [], sources: [] }),
    };
    const exec = createLiveChatExecutor({
      context: {} as never,
      sources: { notes: true, googleCalendar: true, outlookCalendar: false, icloudCalendar: false, hevy: false },
      reads,
      today: () => "2026-11-24",
    });

    const loadRes = await exec("list_calendar_load", { start_date: "2026-09-01", end_date: "2026-11-24" }, { idempotencyKey: null });
    expect(loadRes.ok).toBe(true);
    expect(calendarLoad).toHaveBeenCalledWith("2026-09-01", "2026-11-24");

    const pastRes = await exec("list_calendar_events", { start_date: "2026-10-10", end_date: "2026-10-20" }, { idempotencyKey: null });
    expect(pastRes.ok).toBe(true);
    expect(calendarEvents).toHaveBeenCalledWith("2026-10-10", "2026-10-20");

    const tooWide = await exec("list_calendar_events", { start_date: "2026-09-01", end_date: "2026-10-15" }, { idempotencyKey: null });
    expect(tooWide.ok).toBe(false);
  });
});
