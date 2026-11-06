import { describe, expect, it } from "vitest";

import {
  LEAVE_REMINDER_MAX_ROUTES,
  leaveReminderLocalDate,
  leaveReminderTripDigest,
  nextLeaveReminderAccountCheck,
  planLeaveReminderVisit,
  resolveLeaveReminderOutcome,
  type LeaveReminderRecord,
} from "@cadence/core/services/leave-reminder-plan";

const TZ = "America/New_York";
const NOW = "2026-11-06T15:00:00Z"; // 10:00 local
const PREP = 10 * 60;

function record(overrides: Partial<LeaveReminderRecord> = {}): LeaveReminderRecord {
  return {
    id: "r1", tripDigest: "a".repeat(64), localDate: "2026-11-06", status: "pending", nextCheckAt: NOW,
    routeCount: 0, processingStartedAt: null, sentAt: null, updateSentAt: null, ...overrides,
  };
}

const trip = { digest: "a".repeat(64), destinationRef: "event-1" };

describe("leave reminder trip digest", () => {
  it("is a 64-character hex digest that changes when the event moves", () => {
    const digest = leaveReminderTripDigest("calendar", "event-1", "2026-11-06T18:00:00Z");
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(leaveReminderTripDigest("calendar", "event-1", "2026-11-06T13:00:00-05:00")).toBe(digest);
    expect(leaveReminderTripDigest("calendar", "event-1", "2026-11-06T18:30:00Z")).not.toBe(digest);
    expect(leaveReminderTripDigest("behavior", "event-1", "2026-11-06T18:00:00Z")).not.toBe(digest);
  });
});

describe("planLeaveReminderVisit", () => {
  const plan = (records: LeaveReminderRecord[], trips = [trip]) =>
    planLeaveReminderVisit({ now: NOW, timezone: TZ, preparationSeconds: PREP, records, trips });

  it("creates a record for a new trip and plans nothing twice", () => {
    expect(plan([]).create).toEqual([trip]);
    expect(plan([record({ status: "sent", sentAt: NOW, nextCheckAt: null, routeCount: 2 })]).create).toEqual([]);
  });

  it("works a pending record when its check falls within the next 5 minutes", () => {
    const planned = record({ routeCount: 1, nextCheckAt: "2026-11-06T15:04:59Z" });
    expect(plan([planned]).work).toEqual([{ record: planned, trip, step: "send" }]);
    expect(plan([record({ routeCount: 1, nextCheckAt: "2026-11-06T15:05:01Z" })]).work).toEqual([]);
    expect(plan([record({ routeCount: 0 })]).work[0]?.step).toBe("plan");
  });

  it("leaves a record another run holds, and takes over a stale claim", () => {
    expect(plan([record({ processingStartedAt: "2026-11-06T14:50:00Z" })]).work).toEqual([]);
    expect(plan([record({ processingStartedAt: "2026-11-06T14:45:00Z" })]).work).toHaveLength(1);
  });

  it("drops a pending trip that left the plan and closes an open check after sending", () => {
    const pending = record({ routeCount: 1 });
    const sent = record({ id: "r2", tripDigest: "b".repeat(64), status: "sent", sentAt: "2026-11-06T14:50:00Z", nextCheckAt: "2026-11-06T14:50:00Z", routeCount: 2 });
    const result = plan([pending, sent], []);
    expect(result.cancel).toEqual([pending]);
    expect(result.closeCheck).toEqual([sent]);
    expect(result.create).toEqual([]);
  });

  it("restores a dropped trip only if it was never routed", () => {
    const fresh = record({ status: "cancelled", nextCheckAt: null });
    const routed = record({ id: "r2", status: "cancelled", nextCheckAt: null, routeCount: 1 });
    expect(plan([fresh]).restore).toEqual([{ record: fresh, trip }]);
    expect(plan([routed]).restore).toEqual([]);
    expect(plan([routed]).create).toEqual([]);
  });

  it("runs the update route after the next run, while the named leave time is ahead", () => {
    const sent = record({ status: "sent", sentAt: "2026-11-06T14:58:00Z", nextCheckAt: "2026-11-06T14:58:00Z", routeCount: 2 });
    expect(plan([sent]).work).toEqual([]);
    const later = { ...sent, sentAt: "2026-11-06T14:55:00Z" };
    expect(plan([later]).work).toEqual([{ record: later, trip, step: "update" }]);
    // Named leave time = check + get-ready time = 14:45 + 10 min, already passed.
    const passed = { ...later, nextCheckAt: "2026-11-06T14:45:00Z" };
    expect(plan([passed]).closeCheck).toEqual([passed]);
    expect(plan([{ ...later, routeCount: LEAVE_REMINDER_MAX_ROUTES }]).work).toEqual([]);
    expect(plan([{ ...later, updateSentAt: NOW, nextCheckAt: null }]).work).toEqual([]);
  });

  it("closes an open check unrouted when Travel habits changed after sending", () => {
    const sent = record({ status: "sent", sentAt: "2026-11-06T14:55:00Z", nextCheckAt: "2026-11-06T14:58:00Z", routeCount: 2 });
    const withHabits = (habitsUpdatedAt: string | null) =>
      planLeaveReminderVisit({ now: NOW, timezone: TZ, preparationSeconds: PREP, habitsUpdatedAt, records: [sent], trips: [trip] });
    expect(withHabits("2026-11-06T14:57:00.000000Z")).toMatchObject({ work: [], closeCheck: [sent] });
    expect(withHabits("2026-11-06T14:55:00.000000Z").work).toEqual([{ record: sent, trip, step: "update" }]);
    expect(withHabits(null).work).toEqual([{ record: sent, trip, step: "update" }]);
  });

  it("cancels pending records from an earlier date and purges older ones", () => {
    const yesterday = record({ id: "y", localDate: "2026-11-05", routeCount: 1 });
    const older = record({ id: "o", localDate: "2026-11-04", routeCount: 1 });
    const result = plan([yesterday, older], []);
    expect(result.cancel).toEqual([yesterday]);
    expect(result.purgeBefore).toBe("2026-11-05");
  });
});

describe("resolveLeaveReminderOutcome", () => {
  const estimate = (leaveAt: string) => ({ kind: "estimate" as const, leaveAt });

  it("plans the check at the leave time minus the get-ready time", () => {
    expect(resolveLeaveReminderOutcome({ step: "plan", now: NOW, preparationSeconds: PREP, result: estimate("2026-11-06T18:00:00Z") }))
      .toEqual({ kind: "schedule", nextCheckAt: "2026-11-06T17:50:00Z" });
  });

  it("sends at once when the reminder time is due or has passed but the leave time is ahead", () => {
    expect(resolveLeaveReminderOutcome({ step: "plan", now: NOW, preparationSeconds: PREP, result: estimate("2026-11-06T15:12:00Z") }))
      .toEqual({ kind: "send", leaveAt: "2026-11-06T15:12:00Z", nextCheckAt: "2026-11-06T15:02:00Z" });
    // The send route sends even when its new reminder time is later.
    expect(resolveLeaveReminderOutcome({ step: "send", now: NOW, preparationSeconds: PREP, result: estimate("2026-11-06T15:40:00Z") }))
      .toEqual({ kind: "send", leaveAt: "2026-11-06T15:40:00Z", nextCheckAt: "2026-11-06T15:30:00Z" });
    // Too close to the leave time for an update route.
    expect(resolveLeaveReminderOutcome({ step: "send", now: NOW, preparationSeconds: PREP, result: estimate("2026-11-06T15:03:00Z") }))
      .toMatchObject({ kind: "send", nextCheckAt: null });
  });

  it("sends nothing after the leave time, and fails a refused or missing route", () => {
    expect(resolveLeaveReminderOutcome({ step: "send", now: NOW, preparationSeconds: PREP, result: estimate(NOW) }))
      .toEqual({ kind: "fail", error: "leave_time_passed" });
    expect(resolveLeaveReminderOutcome({ step: "plan", now: NOW, preparationSeconds: PREP, result: { kind: "unavailable", budgetRefused: true } }))
      .toEqual({ kind: "fail", error: "budget_refused" });
    expect(resolveLeaveReminderOutcome({ step: "send", now: NOW, preparationSeconds: PREP, result: { kind: "unavailable", budgetRefused: false } }))
      .toEqual({ kind: "fail", error: "route_unavailable" });
  });

  it("sends the one update only for a leave time 10 minutes or more earlier and still ahead", () => {
    // Named reminder 15:20, so named leave time 15:30.
    const update = (leaveAt: string) => resolveLeaveReminderOutcome({
      step: "update", now: NOW, preparationSeconds: PREP, result: estimate(leaveAt), namedReminderAt: "2026-11-06T15:20:00Z",
    });
    expect(update("2026-11-06T15:20:00Z")).toEqual({ kind: "send_update", leaveAt: "2026-11-06T15:20:00Z" });
    expect(update("2026-11-06T15:21:00Z")).toEqual({ kind: "close", error: null });
    expect(update("2026-11-06T15:45:00Z")).toEqual({ kind: "close", error: null });
    expect(update("2026-11-06T14:59:00Z")).toEqual({ kind: "close", error: null });
  });
});

describe("nextLeaveReminderAccountCheck", () => {
  it("re-reads Calendar within 30 minutes and visits at the earliest due record", () => {
    expect(nextLeaveReminderAccountCheck({ now: NOW, timezone: TZ, records: [] })).toBe("2026-11-06T15:30:00Z");
    expect(nextLeaveReminderAccountCheck({ now: NOW, timezone: TZ, records: [record({ routeCount: 1, nextCheckAt: "2026-11-06T15:12:00Z" })] }))
      .toBe("2026-11-06T15:12:00Z");
  });

  it("waits for the update route until the run after sending", () => {
    const sent = record({ status: "sent", sentAt: NOW, nextCheckAt: "2026-11-06T14:58:00Z", routeCount: 2 });
    expect(nextLeaveReminderAccountCheck({ now: NOW, timezone: TZ, records: [sent] })).toBe("2026-11-06T15:09:00Z");
  });

  it("plans the new local date from local midnight across daylight-saving changes", () => {
    // November 1, 2026: clocks fall back at 2:00 in New York; midnight after is 05:00Z.
    expect(nextLeaveReminderAccountCheck({ now: "2026-11-02T04:45:00Z", timezone: TZ, records: [] })).toBe("2026-11-02T05:00:00Z");
    expect(leaveReminderLocalDate("2026-11-02T04:59:00Z", TZ)).toBe("2026-11-01");
    expect(leaveReminderLocalDate("2026-11-02T05:00:00Z", TZ)).toBe("2026-11-02");
    // March 8, 2026: clocks spring forward; midnight after is 04:00Z.
    expect(nextLeaveReminderAccountCheck({ now: "2026-03-09T03:50:00Z", timezone: TZ, records: [] })).toBe("2026-03-09T04:00:00Z");
  });

  it("keeps reminder times in instants across the fall-back hour", () => {
    // Leave at 1:30 EST (06:30Z), after the repeated hour; 10 minutes earlier is 06:20Z (1:20 EST).
    expect(resolveLeaveReminderOutcome({ step: "plan", now: "2026-11-01T04:00:00Z", preparationSeconds: PREP, result: { kind: "estimate", leaveAt: "2026-11-01T06:30:00Z" } }))
      .toEqual({ kind: "schedule", nextCheckAt: "2026-11-01T06:20:00Z" });
    // Leave at 1:05 EST (06:05Z): the reminder 10 minutes earlier shows 1:55 EDT (05:55Z) on the clock.
    expect(resolveLeaveReminderOutcome({ step: "plan", now: "2026-11-01T04:00:00Z", preparationSeconds: PREP, result: { kind: "estimate", leaveAt: "2026-11-01T06:05:00Z" } }))
      .toEqual({ kind: "schedule", nextCheckAt: "2026-11-01T05:55:00Z" });
  });
});
