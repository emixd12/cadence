import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";

import {
  DAY_PROGRESS_MAX_ICON_LANES,
  nextTripCrowdsBehavior,
  resolveDayProgressLayout,
  resolveNextTripMarkInput,
  resolveNextTripRowIndex,
} from "../packages/core/src/resolvers/day-progress.resolver";
import type {
  NormalizedAllDayExternalEvent,
  NormalizedTimedExternalEvent,
} from "../packages/core/src/types/day-progress";

describe("resolveDayProgressLayout", () => {
  it("keeps unchanged chronological rows and brackets equal-time peers at the first row", () => {
    const layout = resolveDayProgressLayout({
      timezone: "UTC",
      days: [{
        localDate: "2026-09-16",
        top: 0,
        bottom: 600,
        rows: [
          row("first", "2026-09-16T09:00:00Z", 120),
          row("peer", "2026-09-16T09:00:00Z", 180),
          row("close", "2026-09-16T09:05:00Z", 260),
          row("long-gap", "2026-09-16T20:00:00Z", 500),
        ],
      }],
    }).days[0]!;

    expect(layout.rowLayouts.map((item) => item.occurrenceId)).toEqual([
      "first",
      "peer",
      "close",
      "long-gap",
    ]);
    expect(layout.rowLayouts[1]).toMatchObject({
      actualPosition: 120,
      displayPosition: 180,
      displacement: 60,
    });
    expect(layout.sameTimeBrackets).toEqual([{
      actualAt: "2026-09-16T09:00:00Z",
      anchorOccurrenceId: "first",
      peerOccurrenceIds: ["peer"],
      top: 120,
      bottom: 180,
    }]);
    expect(layout.positionAnchors.map((anchor) => anchor.position)).toEqual([
      0, 120, 260, 500, 600,
    ]);
  });

  it("uses the first midnight row as the day-start anchor and keeps midnight peers displaced", () => {
    const layout = resolveDayProgressLayout({
      timezone: "UTC",
      now: Temporal.Instant.from("2026-09-16T00:00:00Z"),
      days: [{
        localDate: "2026-09-16",
        top: 0,
        bottom: 500,
        rows: [
          row("midnight", "2026-09-16T00:00:00Z", 30),
          row("midnight-peer", "2026-09-16T00:00:00Z", 70),
        ],
      }],
    }).days[0]!;

    expect(layout.positionAnchors[0]).toEqual({
      kind: "day_start",
      actualAt: "2026-09-16T00:00:00Z",
      position: 30,
      occurrenceId: "midnight",
    });
    expect(layout.rowLayouts[1]).toMatchObject({
      actualPosition: 30,
      displayPosition: 70,
      displacement: 40,
    });
    expect(layout.movingDot?.displayPosition).toBe(30);
  });

  it("maps 23- and 25-hour local days from their true Temporal boundaries", () => {
    const layout = resolveDayProgressLayout({
      timezone: "America/New_York",
      days: [
        { localDate: "2026-03-08", top: 0, bottom: 230, rows: [] },
      ],
    }).days[0]!;
    const fall = resolveDayProgressLayout({
      timezone: "America/New_York",
      days: [
        { localDate: "2026-11-01", top: 0, bottom: 250, rows: [] },
      ],
    }).days[0]!;

    expect(Temporal.Instant.from(layout.dayStart).until(layout.dayEnd).total({ unit: "hours" })).toBe(23);
    expect(Temporal.Instant.from(fall.dayStart).until(fall.dayEnd).total({ unit: "hours" })).toBe(25);
  });

  it("groups only exact original starts and keeps nearby and clipped overnight starts separate", () => {
    const events = [
      timedEvent("overnight-earlier", "2026-09-15T22:00:00Z", "2026-09-16T01:00:00Z"),
      timedEvent("overnight-later", "2026-09-15T23:00:00Z", "2026-09-16T01:00:00Z"),
      timedEvent("exact-z", "2026-09-16T09:00:00Z", "2026-09-16T10:00:00Z"),
      timedEvent("exact-offset", "2026-09-16T05:00:00-04:00", "2026-09-16T06:00:00-04:00"),
      timedEvent("exact-third", "2026-09-16T11:00:00+02:00", "2026-09-16T12:00:00+02:00"),
      timedEvent("nearby", "2026-09-16T09:01:00Z", "2026-09-16T10:00:00Z"),
      {
        ...timedEvent("unknown-end", "2026-09-16T12:00:00Z", "2026-09-16T13:00:00Z"),
        endUnspecified: true,
        duration: { kind: "unknown" as const, reason: "end_unspecified" as const },
      },
      allDayEvent("all-day", "2026-09-16", "2026-09-17"),
    ];
    const layout = resolveDayProgressLayout({
      timezone: "UTC",
      events,
      days: [{ localDate: "2026-09-16", top: 0, bottom: 400, rows: [] }],
    }).days[0]!;

    expect(DAY_PROGRESS_MAX_ICON_LANES).toBe(1);
    expect(layout.timedEventSpans.find((span) => span.eventId === "overnight-earlier")).toMatchObject({
      clippedStart: "2026-09-16T00:00:00Z",
      continuesBefore: true,
      continuesAfter: false,
    });
    expect(layout.allDayEventIds).toEqual(["all-day"]);
    expect(layout.timedEventSpans.find((span) => span.eventId === "unknown-end")).toMatchObject({
      actualEnd: null,
      clippedEnd: null,
      endPosition: null,
      endUnspecified: true,
    });
    expect(layout.timedEventSpans
      .filter((span) => span.eventId.startsWith("overnight"))
      .map((span) => span.startPosition)).toEqual([0, 0]);
    expect(layout.timedEventSpans
      .filter((span) => span.eventId.startsWith("overnight"))
      .map((span) => span.overflowGroupId)).toEqual([null, null]);
    expect(layout.iconOverflowGroups).toEqual([{
      id: "exact-start-2026-09-16-1",
      position: expect.any(Number),
      iconLane: 0,
      eventIds: ["exact-offset", "exact-third", "exact-z"],
      count: 3,
    }]);
    expect(layout.timedEventSpans.find((span) => span.eventId === "nearby")).toMatchObject({
      iconLane: 0,
      overflowGroupId: null,
    });
  });

  it("places one marker per event across midnight, including events already underway at range start", () => {
    const events = [timedEvent("overnight", "2026-09-16T23:30:00Z", "2026-09-18T02:00:00Z")];
    const days = [16, 17, 18].map((day, index) => ({ localDate: `2026-09-${day}`, top: index * 200, bottom: (index + 1) * 200, rows: [] }));
    const layout = resolveDayProgressLayout({ timezone: "UTC", events, days });
    expect(layout.days.map((day) => day.timedEventSpans[0]!.iconLane)).toEqual([0, null, null]);
    expect(layout.days.map((day) => day.requiredIconHeight)).toEqual([88, 0, 0]);
    const clipped = resolveDayProgressLayout({ timezone: "UTC", events, days: days.slice(1) });
    expect(clipped.days.map((day) => day.timedEventSpans[0]!.iconLane)).toEqual([0, null]);
    const separatelyMeasured = resolveDayProgressLayout({ timezone: "UTC", events, firstVisibleDate: "2026-09-16", days: days.slice(1, 2) });
    expect(separatelyMeasured.days[0]!.timedEventSpans[0]!.iconLane).toBeNull();
    expect(separatelyMeasured.days[0]!.timedEventSpans[0]!.continuesAfter).toBe(true);
    expect(() => resolveDayProgressLayout({ timezone: "UTC", events, firstVisibleDate: "2026-09-19", days })).toThrow("First visible date");
  });

  it("packs dense distinct starts 44 pixels apart and reports the height needed before grouping", () => {
    const events = [
      timedEvent("one", "2026-09-16T09:00:00Z", "2026-09-16T10:00:00Z"),
      timedEvent("two", "2026-09-16T09:01:00Z", "2026-09-16T10:00:00Z"),
      timedEvent("three", "2026-09-16T09:02:00Z", "2026-09-16T10:00:00Z"),
      timedEvent("four", "2026-09-16T09:03:00Z", "2026-09-16T10:00:00Z"),
    ];
    const fitting = resolveDayProgressLayout({
      timezone: "UTC",
      maxIconLanes: 2,
      events,
      days: [{ localDate: "2026-09-16", top: 0, bottom: 220, rows: [] }],
    }).days[0]!;
    const positions = fitting.timedEventSpans.map((span) => span.iconPosition);

    expect(fitting.requiredIconHeight).toBe(220);
    expect(fitting.iconLayoutOverflow).toBe(false);
    expect(fitting.iconOverflowGroups).toEqual([]);
    expect(positions[0]).toBeGreaterThanOrEqual(44);
    expect(positions.at(-1)).toBeLessThanOrEqual(176);
    expect(positions.slice(1).map((position, index) => position - positions[index]!))
      .toEqual([44, 44, 44]);

    const centered = resolveDayProgressLayout({
      timezone: "UTC",
      events: events.slice(0, 2),
      days: [{ localDate: "2026-09-16", top: 0, bottom: 480, rows: [] }],
    }).days[0]!.timedEventSpans;
    expect(centered[1]!.iconPosition - centered[0]!.iconPosition).toBe(44);
    expect((centered[0]!.iconPosition + centered[1]!.iconPosition) / 2)
      .toBeCloseTo((centered[0]!.startPosition + centered[1]!.startPosition) / 2);

    const overflowing = resolveDayProgressLayout({
      timezone: "UTC",
      events,
      days: [{ localDate: "2026-09-16", top: 0, bottom: 175, rows: [] }],
    }).days[0]!;
    expect(overflowing.requiredIconHeight).toBe(220);
    expect(overflowing.iconLayoutOverflow).toBe(true);
    expect(overflowing.iconOverflowGroups).toEqual([]);
    expect(overflowing.timedEventSpans.map((span) => span.iconPosition))
      .toEqual([44, 88, 132, 176]);
  });

  it("accepts empty and expanded days and rejects invalid geometry, time order, and event intervals", () => {
    expect(resolveDayProgressLayout({
      timezone: "UTC",
      days: [
        { localDate: "2026-09-16", top: 0, bottom: 100, rows: [] },
        { localDate: "2026-09-17", top: 100, bottom: 500, rows: [row("expanded", "2026-09-17T12:00:00Z", 350)] },
      ],
    }).days).toHaveLength(2);

    expect(() => resolveDayProgressLayout({
      timezone: "UTC",
      days: [{ localDate: "2026-09-16", top: 0, bottom: 100, rows: [
        row("later", "2026-09-16T10:00:00Z", 20),
        row("earlier", "2026-09-16T09:00:00Z", 40),
      ] }],
    })).toThrow("chronological");
    expect(() => resolveDayProgressLayout({
      timezone: "UTC",
      days: [{ localDate: "2026-09-16", top: 100, bottom: 100, rows: [] }],
    })).toThrow("finite top and bottom");
    expect(() => resolveDayProgressLayout({
      timezone: "UTC",
      events: [timedEvent("zero", "2026-09-16T10:00:00Z", "2026-09-16T10:00:00Z")],
      days: [{ localDate: "2026-09-16", top: 0, bottom: 100, rows: [] }],
    })).toThrow("end after");
  });
});

// Ticket 270 (D2, "Next trip only"): the next trip's span and marker.
describe("next trip marks", () => {
  type MarkTrip = NonNullable<Parameters<typeof resolveNextTripMarkInput>[0]>;
  const trip = (overrides: Partial<MarkTrip> = {}): MarkTrip => ({ key: "outbound::dentist", legId: "leg-1", state: "upcoming",
    getReadyAt: "2026-09-16T12:50:00Z", leaveAt: "2026-09-16T13:20:00Z", arriveAt: "2026-09-16T13:55:00Z", ...overrides });
  const day = (localDate = "2026-09-16") => ({ localDate, top: 0, bottom: 2400, rows: [] as ReturnType<typeof row>[] });

  it("marks only a next trip with a leave time and an arrival", () => {
    expect(resolveNextTripMarkInput(trip())).toEqual({ key: "outbound::dentist", legId: "leg-1",
      startAt: "2026-09-16T12:50:00Z", leaveAt: "2026-09-16T13:20:00Z", arriveAt: "2026-09-16T13:55:00Z" });
    // Without get-ready time (the trip home, or an onward trip) the span starts at the leave time.
    expect(resolveNextTripMarkInput(trip({ getReadyAt: null }))?.startAt).toBe("2026-09-16T13:20:00Z");
    for (const state of ["soon", "leave_now", "late", "head_home"] as const) expect(resolveNextTripMarkInput(trip({ state })), state).not.toBeNull();
    for (const state of ["appears_later", "needs_place", "needs_origin", "time_unknown", "no_route", "trip_changed", "estimate_expired", "paused"] as const) {
      expect(resolveNextTripMarkInput(trip({ state })), state).toBeNull();
    }
    expect(resolveNextTripMarkInput(trip({ leaveAt: null }))).toBeNull();
    expect(resolveNextTripMarkInput(trip({ arriveAt: null }))).toBeNull();
    expect(resolveNextTripMarkInput(null)).toBeNull();
  });

  it("places the span from get-ready to arrival and the leave tick on the axis", () => {
    const layout = resolveDayProgressLayout({ timezone: "UTC", days: [day()], nextTrip: resolveNextTripMarkInput(trip()) }).days[0]!;
    // 100 px per hour on an empty day: 12:50 is 1283.3, 13:20 is 1333.3, 13:55 is 1391.7.
    expect(layout.nextTrip?.key).toBe("outbound::dentist");
    expect(layout.nextTrip?.startPosition).toBeCloseTo(1283.33, 1);
    expect(layout.nextTrip?.leavePosition).toBeCloseTo(1333.33, 1);
    expect(layout.nextTrip?.endPosition).toBeCloseTo(1391.67, 1);
    expect(layout.nextTrip?.labelPosition).toBe(layout.nextTrip?.leavePosition);
    expect(resolveDayProgressLayout({ timezone: "UTC", days: [day()] }).days[0]!.nextTrip).toBeNull();
  });

  it("clips the span to each day and leaves the tick on the leave day", () => {
    const late = resolveNextTripMarkInput(trip({ getReadyAt: null, leaveAt: "2026-09-16T23:40:00Z", arriveAt: "2026-09-17T00:20:00Z" }));
    const [first, second] = resolveDayProgressLayout({ timezone: "UTC", days: [day(), { ...day("2026-09-17"), top: 2400, bottom: 4800 }], nextTrip: late }).days;
    expect(first!.nextTrip).toMatchObject({ endPosition: 2400 });
    expect(first!.nextTrip?.leavePosition).toBeCloseTo(2366.67, 1);
    expect(second!.nextTrip).toMatchObject({ startPosition: 2400, leavePosition: null, labelPosition: null });
    const third = resolveDayProgressLayout({ timezone: "UTC", days: [{ ...day("2026-09-18") }], nextTrip: late }).days[0]!;
    expect(third.nextTrip).toBeNull();
  });

  it("moves the rail label clear of Calendar markers only when they share the rail", () => {
    const events = [timedEvent("dentist", "2026-09-16T13:30:00Z", "2026-09-16T14:30:00Z")];
    const input = { timezone: "UTC", days: [day()], events, nextTrip: resolveNextTripMarkInput(trip()) };
    const shared = resolveDayProgressLayout({ ...input, nextTripLabel: { height: 32, avoidIcons: true } }).days[0]!;
    const icon = shared.timedEventSpans[0]!.iconPosition;
    // The marker sits at 1350; the label (32 px) keeps 38 px from its centre and stays nearest the leave time.
    expect(Math.abs(shared.nextTrip!.labelPosition! - icon)).toBeGreaterThanOrEqual(38);
    expect(shared.nextTrip!.labelPosition).toBeCloseTo(icon - 38, 5);
    const apart = resolveDayProgressLayout({ ...input, nextTripLabel: { height: 32, avoidIcons: false } }).days[0]!;
    expect(apart.nextTrip!.labelPosition).toBe(apart.nextTrip!.leavePosition);
    expect(() => resolveDayProgressLayout({ ...input, nextTripLabel: { height: 0, avoidIcons: true } })).toThrow("rail label height");
  });

  it("rejects a next trip whose times are out of order", () => {
    expect(() => resolveDayProgressLayout({ timezone: "UTC", days: [day()],
      nextTrip: { key: "k", legId: null, startAt: "2026-09-16T13:30:00Z", leaveAt: "2026-09-16T13:20:00Z", arriveAt: "2026-09-16T13:55:00Z" } })).toThrow("in order");
  });

  it("puts marker B's row before the first Behavior at or after the leave time, on the leave day only", () => {
    const input = { localDate: "2026-09-16", timezone: "UTC", trip: resolveNextTripMarkInput(trip()) };
    expect(resolveNextTripRowIndex({ ...input, scheduledFor: ["2026-09-16T09:00:00Z", "2026-09-16T13:20:00Z", "2026-09-16T14:00:00Z"] })).toBe(1);
    expect(resolveNextTripRowIndex({ ...input, scheduledFor: ["2026-09-16T09:00:00Z"] })).toBe(1);
    expect(resolveNextTripRowIndex({ ...input, scheduledFor: [] })).toBe(0);
    expect(resolveNextTripRowIndex({ ...input, localDate: "2026-09-17", scheduledFor: [] })).toBeNull();
    // New York: 13:20Z is 9:20 AM on the same local date.
    expect(resolveNextTripRowIndex({ ...input, timezone: "America/New_York", scheduledFor: ["2026-09-16T13:00:00Z"] })).toBe(1);
    expect(resolveNextTripRowIndex({ ...input, trip: null, scheduledFor: [] })).toBeNull();
  });

  it("says a Behavior is crowded only by the next trip's own leg", () => {
    const next = resolveNextTripMarkInput(trip());
    expect(nextTripCrowdsBehavior({ travelOverlapLegIds: ["leg-1"] }, next)).toBe(true);
    expect(nextTripCrowdsBehavior({ travelOverlapLegIds: ["leg-2"] }, next)).toBe(false);
    expect(nextTripCrowdsBehavior({}, next)).toBe(false);
    expect(nextTripCrowdsBehavior({ travelOverlapLegIds: ["leg-1"] }, null)).toBe(false);
    expect(nextTripCrowdsBehavior({ travelOverlapLegIds: ["leg-1"] }, resolveNextTripMarkInput(trip({ legId: null })))).toBe(false);
  });
});

function row(occurrenceId: string, scheduledFor: string, center: number) {
  return { occurrenceId, scheduledFor, center };
}

function timedEvent(id: string, startAt: string, endAt: string): NormalizedTimedExternalEvent {
  return {
    ...eventBase(id),
    kind: "timed",
    startAt,
    endAt,
    endUnspecified: false,
    duration: {
      kind: "known",
      seconds: Temporal.Instant.from(startAt).until(Temporal.Instant.from(endAt)).total({ unit: "seconds" }),
    },
  };
}

function allDayEvent(
  id: string,
  startLocalDate: string,
  endLocalDate: string,
): NormalizedAllDayExternalEvent {
  return {
    ...eventBase(id),
    kind: "all_day",
    startLocalDate,
    endLocalDate,
    duration: {
      kind: "calendar_days",
      days: Temporal.PlainDate.from(startLocalDate).until(Temporal.PlainDate.from(endLocalDate)).days,
    },
  };
}

function eventBase(id: string) {
  return {
    id,
    providerEventId: id,
    logicalInstanceId: `logical-${id}`,
    calendarId: "calendar-1",
    source: "google_calendar" as const,
    calendarName: "Work",
    sourceTimezone: "UTC",
    sourceTimezoneFallback: "request" as const,
    state: "confirmed" as const,
    availability: "busy" as const,
    currentUserResponse: null,
    revision: { availability: "unavailable" as const, providerUpdatedAt: null, providerEtag: null },
    title: id,
    description: "",
    location: "",
    sourceUrl: null,
    fieldAvailability: {},
    detailCompleteness: {},
    organizer: null,
    attendees: null,
    attendeesOmitted: false,
    conference: null,
    recurrence: null,
    attachments: null,
  };
}
