import { describe, expect, it } from "vitest";
import { resolveDailyCalendarLoad } from "@/lib/resolvers/calendar-load.resolver";
import type { NormalizedExternalEvent } from "@cadence/core/types/day-progress";

function timedEvent(overrides: Partial<Extract<NormalizedExternalEvent, { kind: "timed" }>> = {}): Extract<NormalizedExternalEvent, { kind: "timed" }> {
  return {
    id: "evt-1",
    providerEventId: "prov-1",
    logicalInstanceId: "inst-1",
    calendarId: "primary",
    source: "google_calendar",
    calendarName: "Work",
    sourceTimezone: "America/New_York",
    sourceTimezoneFallback: "none",
    state: "confirmed",
    availability: "busy",
    currentUserResponse: "accepted",
    revision: { availability: "available", providerUpdatedAt: "2026-11-24T00:00:00Z", providerEtag: null },
    title: "Secret Meeting Title",
    description: "Private description",
    location: "123 Main St",
    sourceUrl: null,
    fieldAvailability: {},
    detailCompleteness: {},
    organizer: null,
    attendees: null,
    attendeesOmitted: false,
    conference: null,
    recurrence: null,
    attachments: null,
    kind: "timed",
    startAt: "2026-11-24T14:00:00Z", // 09:00 EST
    endAt: "2026-11-24T15:00:00Z", // 10:00 EST
    endUnspecified: false,
    duration: { kind: "known", seconds: 3600 },
    ...overrides,
  };
}

function allDayEvent(overrides: Partial<Extract<NormalizedExternalEvent, { kind: "all_day" }>> = {}): Extract<NormalizedExternalEvent, { kind: "all_day" }> {
  return {
    ...timedEvent(),
    kind: "all_day",
    startLocalDate: "2026-11-24",
    endLocalDate: "2026-11-24",
    duration: { kind: "calendar_days", days: 1 },
    ...overrides,
  } as Extract<NormalizedExternalEvent, { kind: "all_day" }>;
}

describe("resolveDailyCalendarLoad", () => {
  it("unions overlapping timed busy events and computes earliest/latest minutes", () => {
    const entries = resolveDailyCalendarLoad({
      startLocalDate: "2026-11-24",
      endLocalDate: "2026-11-25",
      timezone: "America/New_York",
      events: [
        timedEvent({ logicalInstanceId: "a", startAt: "2026-11-24T14:00:00Z", endAt: "2026-11-24T15:00:00Z" }), // 09:00-10:00
        timedEvent({ logicalInstanceId: "b", startAt: "2026-11-24T14:30:00Z", endAt: "2026-11-24T16:00:00Z" }), // 09:30-11:00
      ],
    });
    expect(entries).toEqual([
      {
        localDate: "2026-11-24",
        busyMinutes: 120,
        eventCount: 2,
        earliestStartMinute: 9 * 60,
        latestEndMinute: 11 * 60,
        hasAllDayBusy: false,
      },
      {
        localDate: "2026-11-25",
        busyMinutes: 0,
        eventCount: 0,
        earliestStartMinute: null,
        latestEndMinute: null,
        hasAllDayBusy: false,
      },
    ]);
  });

  it("ignores cancelled, declined, free, and duplicate events", () => {
    const entries = resolveDailyCalendarLoad({
      startLocalDate: "2026-11-24",
      endLocalDate: "2026-11-24",
      timezone: "America/New_York",
      events: [
        timedEvent({ logicalInstanceId: "dup", startAt: "2026-11-24T14:00:00Z", endAt: "2026-11-24T15:00:00Z" }),
        timedEvent({ logicalInstanceId: "dup", startAt: "2026-11-24T14:00:00Z", endAt: "2026-11-24T15:00:00Z" }),
        timedEvent({ logicalInstanceId: "cancelled", state: "cancelled" }),
        timedEvent({ logicalInstanceId: "declined", currentUserResponse: "declined" }),
        timedEvent({ logicalInstanceId: "free", availability: "free" }),
      ],
    });
    expect(entries[0]).toMatchObject({ busyMinutes: 60, eventCount: 1 });
  });

  it("tracks busy all-day events without inflating busyMinutes", () => {
    const entries = resolveDailyCalendarLoad({
      startLocalDate: "2026-11-24",
      endLocalDate: "2026-11-25",
      timezone: "America/New_York",
      events: [
        allDayEvent({ startLocalDate: "2026-11-24", endLocalDate: "2026-11-25", duration: { kind: "calendar_days", days: 2 }, availability: "busy" }),
        allDayEvent({ logicalInstanceId: "free-all-day", startLocalDate: "2026-11-25", endLocalDate: "2026-11-25", availability: "free" }),
      ],
    });
    expect(entries[0]).toMatchObject({ localDate: "2026-11-24", busyMinutes: 0, eventCount: 0, hasAllDayBusy: true });
    expect(entries[1]).toMatchObject({ localDate: "2026-11-25", busyMinutes: 0, eventCount: 0, hasAllDayBusy: true });
  });

  it("clips cross-midnight events cleanly to each local day", () => {
    const entries = resolveDailyCalendarLoad({
      startLocalDate: "2026-11-24",
      endLocalDate: "2026-11-25",
      timezone: "America/New_York",
      events: [
        timedEvent({
          logicalInstanceId: "overnight",
          startAt: "2026-11-25T04:00:00Z", // 23:00 EST on Nov 24
          endAt: "2026-11-25T06:00:00Z", // 01:00 EST on Nov 25
          duration: { kind: "known", seconds: 7200 },
        }),
      ],
    });
    expect(entries[0]).toMatchObject({ localDate: "2026-11-24", busyMinutes: 60, earliestStartMinute: 23 * 60, latestEndMinute: 24 * 60 });
    expect(entries[1]).toMatchObject({ localDate: "2026-11-25", busyMinutes: 60, earliestStartMinute: 0, latestEndMinute: 60 });
  });
});
