import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";
import {
  macLeaveReminderDigest, macLeaveReminderDigestFromId, macLeaveReminderId, planMacLeaveReminders,
  type MacLeaveReminderRecord,
} from "@cadence/core/services/mac-leave-reminder-plan";
import { DEPARTURE_PHRASE_REVIEW } from "@cadence/core/services/departure-phrases";
import { assessNativeReminderCoverage } from "@cadence/core/resolvers/native-reminder.resolver";
import type { DepartureStop, DepartureTrip } from "@cadence/core/types/departure";

const TZ = "America/New_York";
const at = (time: string) => Temporal.ZonedDateTime.from(`2026-11-10T${time}[${TZ}]`).toInstant().toString();
const DENTIST: DepartureStop = { ref: "event-dentist", label: "Dentist", startAt: at("14:30"), endAt: at("15:30") };
const GYM: DepartureStop = { ref: "33333333-3333-4333-8333-333333333333", label: "Gym", startAt: at("18:00"), endAt: at("19:00") };
const DIGEST = macLeaveReminderDigest(DENTIST.ref, DENTIST.startAt);
const ID = macLeaveReminderId(DIGEST);

function trip(overrides: Partial<DepartureTrip> = {}): DepartureTrip {
  return { key: "outbound|origin|event-dentist", legId: "leg-1", role: "outbound", originRef: null, destinationRef: DENTIST.ref,
    mode: "walking", fromHome: true, state: "upcoming", lateBasis: null, freshness: "current", checkedAt: at("12:40"),
    leaveAt: at("13:15"), arriveAt: at("14:20"), getReadyAt: at("13:05"), minutesUntilLeave: 35, appearsAt: null,
    timeUnknownCause: null, blockingRef: null, blockingLabel: null, action: null, phrase: "", linePhrase: "", ...overrides };
}

function plan(input: Partial<Parameters<typeof planMacLeaveReminders>[0]> & { now: string }) {
  return planMacLeaveReminders({ timezone: TZ, enabled: true, preparationSeconds: 600,
    departure: { localDate: "2026-11-10", trips: [trip()], stops: [DENTIST, GYM] }, records: [], pending: [], ...input });
}

describe("Mac leave reminder planner (Ticket 280)", () => {
  it("schedules one reminder at the leave time minus the get-ready time, naming the estimate time", () => {
    const result = plan({ now: at("12:45") });
    expect(result.schedule).toEqual([{ id: ID, digest: DIGEST, fireAt: at("13:05"),
      title: "Leave by 1:15 PM for Dentist", body: "Walking from Home, arrive 2:20 PM. Estimate checked 12:40 PM." }]);
    expect(result.records).toEqual([{ digest: DIGEST, localDate: "2026-11-10", reminderAt: at("13:05"), leaveAt: at("13:15"), update: null }]);
    expect(result.cancelPending).toEqual([]);
    expect(result.removeAll).toBe(false);
  });

  it("names the previous stop or the Mac's position as the start", () => {
    expect(plan({ now: at("12:45"), departure: { localDate: "2026-11-10", stops: [DENTIST],
      trips: [trip({ fromHome: false, originRef: "event-lunch", role: "onward", mode: "transit" })] } }).schedule[0]?.body)
      .toBe("Transit from your previous stop, arrive 2:20 PM. Estimate checked 12:40 PM.");
    expect(plan({ now: at("12:45"), departure: { localDate: "2026-11-10", stops: [DENTIST],
      trips: [trip({ fromHome: false, originRef: null, mode: "driving" })] } }).schedule[0]?.body)
      .toBe("Driving from your position, arrive 2:20 PM. Estimate checked 12:40 PM.");
  });

  it("fires at once while the leave time is ahead when the reminder time has passed, and never after the leave time", () => {
    expect(plan({ now: at("13:10") }).schedule[0]?.fireAt).toBe(Temporal.Instant.from(at("13:10")).add({ seconds: 10 }).toString());
    expect(plan({ now: at("13:15") }).schedule).toEqual([]);
    expect(plan({ now: at("13:20") }).schedule).toEqual([]);
  });

  it("gives the trip home and trips without a known time no reminder", () => {
    const trips = [trip({ role: "return", destinationRef: null }), trip({ leaveAt: null, state: "time_unknown" }),
      trip({ destinationRef: "missing-stop" })];
    expect(plan({ now: at("12:00"), departure: { localDate: "2026-11-10", trips, stops: [DENTIST] } }).schedule).toEqual([]);
  });

  it("keeps a matching pending reminder and replaces it when a new estimate arrives before it fires", () => {
    const first = plan({ now: at("12:45") });
    const pending = first.schedule.map(({ id, title, body, fireAt }) => ({ id, title, body, fireAt }));
    expect(plan({ now: at("12:50"), records: first.records, pending }).schedule).toEqual([]);
    const moved = plan({ now: at("12:55"), records: first.records, pending,
      departure: { localDate: "2026-11-10", stops: [DENTIST], trips: [trip({ leaveAt: at("13:00"), checkedAt: at("12:54") })] } });
    expect(moved.schedule).toMatchObject([{ id: ID, title: "Leave by 1:00 PM for Dentist", fireAt: Temporal.Instant.from(at("12:55")).add({ seconds: 10 }).toString() }]);
    expect(moved.cancelPending).toEqual([]);
    expect(moved.records[0]?.update).toBeNull();
  });

  it("sends one update after the reminder fired, only for a leave time 10+ minutes earlier and still ahead (D15)", () => {
    const fired: MacLeaveReminderRecord = { digest: DIGEST, localDate: "2026-11-10", reminderAt: at("13:05"), leaveAt: at("13:15"), update: null };
    const later = (leaveAt: string, now = at("13:06")) => plan({ now, records: [fired],
      departure: { localDate: "2026-11-10", stops: [DENTIST], trips: [trip({ leaveAt, checkedAt: at("13:06") })] } });
    expect(later(at("13:06")).schedule).toEqual([]);
    expect(later(at("13:06"), at("13:06")).schedule).toEqual([]);
    expect(later(at("13:07")).schedule).toEqual([]);
    expect(later(at("13:30")).schedule).toEqual([]);
    const earlier = plan({ now: at("13:06"), records: [{ ...fired, leaveAt: at("13:20") }],
      departure: { localDate: "2026-11-10", stops: [DENTIST], trips: [trip({ leaveAt: at("13:10"), checkedAt: at("13:06") })] } });
    expect(earlier.schedule).toMatchObject([{ id: `${ID}.update`, title: "Leave earlier: by 1:10 PM for Dentist",
      body: "Walking from Home, arrive 2:20 PM. Estimate checked 1:06 PM." }]);
    expect(earlier.records[0]?.update?.leaveAt).toBe(at("13:10"));
    const again = plan({ now: at("13:07"), records: earlier.records,
      departure: { localDate: "2026-11-10", stops: [DENTIST], trips: [trip({ leaveAt: at("13:08"), checkedAt: at("13:07") })] } });
    expect(again.schedule).toEqual([]);
  });

  it("cancels a pending reminder when its trip is dropped or moved, and remembers one that already fired", () => {
    const first = plan({ now: at("12:45") });
    const pending = first.schedule.map(({ id, title, body, fireAt }) => ({ id, title, body, fireAt }));
    const dropped = plan({ now: at("12:50"), records: first.records, pending, departure: { localDate: "2026-11-10", trips: [], stops: [] } });
    expect(dropped.cancelPending).toEqual([ID]);
    expect(dropped.records).toEqual([]);
    const moved = plan({ now: at("12:50"), records: first.records, pending,
      departure: { localDate: "2026-11-10", trips: [trip()], stops: [{ ...DENTIST, startAt: at("15:00") }] } });
    expect(moved.cancelPending).toEqual([ID]);
    expect(moved.schedule[0]?.id).not.toBe(ID);
    const fired = plan({ now: at("13:06"), records: first.records, pending: [], departure: { localDate: "2026-11-10", trips: [], stops: [] } });
    expect(fired.records).toEqual(first.records);
    const back = plan({ now: at("13:07"), records: fired.records });
    expect(back.schedule).toEqual([]);
  });

  it("keeps what is scheduled when no plan is known, and forgets earlier days", () => {
    const first = plan({ now: at("12:45") });
    const pending = first.schedule.map(({ id, title, body, fireAt }) => ({ id, title, body, fireAt }));
    expect(plan({ now: at("12:50"), records: first.records, pending, departure: null })).toEqual({ schedule: [], cancelPending: [], removeAll: false, records: first.records });
    expect(plan({ now: at("12:50"), records: first.records, pending, departure: { localDate: "2026-11-09", trips: [], stops: [] } }).cancelPending).toEqual([]);
    const tomorrow = Temporal.Instant.from(at("12:50")).add({ hours: 24 }).toString();
    expect(plan({ now: tomorrow, records: first.records, pending, departure: null })).toMatchObject({ cancelPending: [ID], records: [] });
  });

  it("removes every leave reminder when reminders are off", () => {
    const result = plan({ now: at("12:45"), enabled: false, pending: [{ id: ID, title: "t", body: "b", fireAt: at("13:05") },
      { id: "cadence.local.33333333-3333-4333-8333-333333333333", title: "Behavior", body: "b", fireAt: at("13:05") }] });
    expect(result).toEqual({ schedule: [], cancelPending: [ID], removeAll: true, records: [] });
  });

  it("uses identifiers the Behavior reminder planner never owns, so coverage is unchanged", () => {
    expect(macLeaveReminderDigestFromId(ID)).toBe(DIGEST);
    expect(macLeaveReminderDigestFromId(`${ID}.update`)).toBe(DIGEST);
    for (const other of ["cadence.local.33333333-3333-4333-8333-333333333333", `${ID}x`, `${ID}.update.update`, "cadence.leave.", 4]) {
      expect(macLeaveReminderDigestFromId(other)).toBeNull();
    }
    const now = Temporal.Instant.from(at("12:00"));
    const requests = [{ id: "cadence.local.33333333-3333-4333-8333-333333333333", title: "Stretch", body: "Body", fireAt: at("13:00") }];
    const context = { requests, now, targetThrough: now.add({ hours: 24 * 30 }) };
    const without = assessNativeReminderCoverage({ ...context, pending: requests });
    const withLeave = assessNativeReminderCoverage({ ...context, pending: [...requests, { id: ID, title: "Leave by", body: "b", fireAt: at("13:05") }] });
    expect(withLeave).toEqual(without);
  });

  it("lists its wording as not yet approved", () => {
    const rows = DEPARTURE_PHRASE_REVIEW.filter((row) => row.ticket === "280");
    expect(rows.map((row) => row.template)).toEqual(["Leave by {time} for {event}", "Leave earlier: by {time} for {event}",
      "{Mode} from {start}, arrive {time}. Estimate checked {time}."]);
    expect(rows.every((row) => row.approvedOn === null)).toBe(true);
  });
});
