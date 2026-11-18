import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";
import {
  briefMoveFreeStarts,
  briefMoveItemBlocks,
  checkBriefMoveSlot,
  planBriefMoveLinesFromInputs,
  resolveBriefMoveLength,
  type BriefMoveDayItem,
  type BriefMovePlanInputs,
} from "@cadence/core/resolvers/brief-move.resolver";

const TZ = "America/New_York";
const DAY = "2026-11-18";
const local = (time: string, date = DAY) => Temporal.PlainDateTime.from(`${date}T${time}`).toZonedDateTime(TZ).toInstant();

function item(id: string, start: string, minutes: number, extra: Partial<BriefMoveDayItem> = {}): BriefMoveDayItem {
  const begin = local(start);
  return {
    occurrenceId: id, behaviorId: `b-${id}`, title: id, status: "unresolved", localDate: DAY, scheduleKind: "exact",
    start: begin, end: begin.add({ minutes }), length: { minutes, source: "behavior_duration", assumed: false },
    alongside: false, revision: `rev-${id}`, behaviorRevision: `brev-${id}`, ...extra,
  };
}

function plan(overrides: Partial<BriefMovePlanInputs>) {
  return planBriefMoveLinesFromInputs({
    localDate: DAY, timezone: TZ, now: local("08:00"), items: [], calendarBusy: [], calendar: "current", travel: null,
    declinedToday: new Set(), neverMoveBehaviorIds: new Set(), ...overrides,
  });
}

describe("resolveBriefMoveLength", () => {
  it("uses the setting, then the logged average, then the estimate, then 30 minutes", () => {
    expect(resolveBriefMoveLength({ behaviorDefaultMinutes: 45, loggedAverageSeconds: 600, estimateMinutes: 20 }))
      .toEqual({ minutes: 45, source: "behavior_duration", assumed: false });
    expect(resolveBriefMoveLength({ behaviorDefaultMinutes: null, loggedAverageSeconds: 600, estimateMinutes: 20 }))
      .toEqual({ minutes: 10, source: "logged_average", assumed: false });
    expect(resolveBriefMoveLength({ behaviorDefaultMinutes: null, loggedAverageSeconds: null, estimateMinutes: 20 }))
      .toEqual({ minutes: 20, source: "model_estimate", assumed: true });
    expect(resolveBriefMoveLength({ behaviorDefaultMinutes: null, loggedAverageSeconds: 20, estimateMinutes: null }))
      .toEqual({ minutes: 30, source: "fallback", assumed: true });
  });
});

describe("checkBriefMoveSlot", () => {
  const blocks = briefMoveItemBlocks([item("gym", "13:00", 60)], null);

  it("keeps a 10-minute gap from items and calendar events", () => {
    expect(checkBriefMoveSlot({ interval: { start: local("14:00"), end: local("14:30") }, blocks }))
      .toEqual({ ok: false, reason: "too_close", ref: "gym" });
    expect(checkBriefMoveSlot({ interval: { start: local("14:10"), end: local("14:40") }, blocks })).toEqual({ ok: true });
    expect(checkBriefMoveSlot({ interval: { start: local("13:30"), end: local("14:00") }, blocks }))
      .toEqual({ ok: false, reason: "slot_taken", ref: "gym" });
  });

  it("lets a range item block only its own length, and an alongside item nothing", () => {
    const reading = item("read", "20:00", 30, { scheduleKind: "range", end: local("22:00") });
    const pill = item("pill", "09:00", 5, { alongside: true });
    const occupied = briefMoveItemBlocks([reading, pill], null);
    expect(occupied).toHaveLength(1);
    expect(checkBriefMoveSlot({ interval: { start: local("20:45"), end: local("21:30") }, blocks: occupied })).toEqual({ ok: true });
    expect(checkBriefMoveSlot({ interval: { start: local("20:15"), end: local("20:45") }, blocks: occupied }).ok).toBe(false);
  });

  it("pads the moved item by its own travel, and travel spans need no gap", () => {
    const travel = [{ kind: "travel" as const, ref: "trip", start: local("12:00"), end: local("12:30") }];
    expect(checkBriefMoveSlot({ interval: { start: local("12:30"), end: local("13:00") }, blocks: travel })).toEqual({ ok: true });
    expect(checkBriefMoveSlot({ interval: { start: local("12:40"), end: local("13:00") }, blocks: travel, travelBeforeSeconds: 15 * 60 }))
      .toEqual({ ok: false, reason: "travel_busy", ref: "trip" });
  });
});

describe("briefMoveFreeStarts", () => {
  it("never offers a start after the latest hour or before now", () => {
    const starts = briefMoveFreeStarts({ localDate: DAY, timezone: TZ, now: local("21:00"), near: local("21:00"), lengthSeconds: 1800,
      blocks: [], latestStartMinute: 22 * 60, limit: 10 });
    expect(starts.every((start) => Temporal.Instant.compare(start, local("22:00")) <= 0)).toBe(true);
    expect(starts.every((start) => Temporal.Instant.compare(start, local("21:00")) >= 0)).toBe(true);
  });
});

describe("planBriefMoveLinesFromInputs", () => {
  const meeting = { ref: "event-1", title: "Team sync", start: local("13:00"), end: local("14:00") };

  it("moves an item out of a calendar event to the nearest time that passes the Yes check", () => {
    const items = [item("gym", "13:00", 60), item("read", "15:00", 20)];
    const result = plan({ items, calendarBusy: [meeting] });
    expect(result.candidates).toHaveLength(1);
    const line = result.candidates[0]!;
    expect(line.reasonCode).toBe("calendar_overlap");
    expect(line.anchor).toEqual({ kind: "calendar_event", title: "Team sync" });
    expect(line.reason).toContain("Team sync");
    expect(line.calendarDerived).toBe(true);
    // Every offered time passes the same check Yes runs.
    const blocks = [...briefMoveItemBlocks(items, "gym"), { kind: "calendar" as const, ref: meeting.ref, start: meeting.start, end: meeting.end }];
    for (const start of [line.to.startAt, ...line.otherTimes]) {
      const begin = Temporal.Instant.from(start);
      expect(checkBriefMoveSlot({ interval: { start: begin, end: begin.add({ minutes: 60 }) }, blocks })).toEqual({ ok: true });
    }
  });

  it("does not offer declined, never-move, alongside or range items", () => {
    const items = [
      item("gym", "13:00", 30), item("walk", "13:15", 30), item("pill", "13:20", 5, { alongside: true }),
      item("read", "13:00", 30, { scheduleKind: "range", end: local("15:00") }),
    ];
    const result = plan({ items, calendarBusy: [meeting], declinedToday: new Set(["gym"]), neverMoveBehaviorIds: new Set(["b-walk"]) });
    expect(result.candidates).toEqual([]);
  });

  it("moves the later of two overlapping items, and Accept all's times never collide", () => {
    const items = [item("a", "09:00", 60), item("b", "09:30", 60), item("c", "09:45", 30)];
    const result = plan({ items });
    expect(result.candidates.map((line) => line.occurrenceId)).toEqual(["b", "c"]);
    const [b, c] = result.candidates;
    const bStart = Temporal.Instant.from(b!.to.startAt), cStart = Temporal.Instant.from(c!.to.startAt);
    const bEnd = bStart.add({ minutes: 60 }), cEnd = cStart.add({ minutes: 30 });
    expect(Temporal.Instant.compare(bEnd.add({ minutes: 10 }), cStart) <= 0 || Temporal.Instant.compare(cEnd.add({ minutes: 10 }), bStart) <= 0).toBe(true);
  });

  it("offers a passed item a later time and Already did it", () => {
    const result = plan({ items: [item("gym", "07:00", 30)], now: local("10:02") });
    expect(result.candidates[0]).toMatchObject({ reasonCode: "time_passed", late: true, to: { startAt: local("10:05").toString() } });
  });

  it("offers nothing on a stale calendar, and nothing on a quiet day", () => {
    expect(plan({ items: [item("gym", "13:00", 60)], calendarBusy: [meeting], calendar: "stale" })).toEqual({ candidates: [], calendar: "stale" });
    expect(plan({ items: [item("gym", "16:00", 60)], calendarBusy: [meeting] }).candidates).toEqual([]);
  });

  it("says travel was not checked for a stop with no known travel time, and keeps room for known travel", () => {
    const items = [item("gym", "13:00", 60)];
    const unknown = plan({ items, calendarBusy: [meeting], placeBehaviorIds: new Set(["b-gym"]) });
    expect(unknown.candidates[0]!.travel).toBe("not_checked");
    const known = plan({ items, calendarBusy: [meeting], travel: { spans: [], unknown: new Set(),
      stops: new Map([["gym", { beforeSeconds: 20 * 60, afterSeconds: 20 * 60 }]]) } });
    const line = known.candidates[0]!;
    expect(line.travel).toBe("checked");
    // The meeting plus a 10-minute gap plus 20 minutes of travel on each side: 11:30 at the latest, or 14:30 at the earliest.
    expect(line.to.startAt).toBe(local("11:30").toString());
  });

  it("keeps every suggested start on the day across a DST change", () => {
    const fallBack = "2026-11-01";
    const items = [{ ...item("gym", "01:30", 60), localDate: fallBack,
      start: Temporal.PlainDateTime.from(`${fallBack}T01:30`).toZonedDateTime(TZ).toInstant(),
      end: Temporal.PlainDateTime.from(`${fallBack}T01:30`).toZonedDateTime(TZ).toInstant().add({ minutes: 60 }) }];
    const result = planBriefMoveLinesFromInputs({ localDate: fallBack, timezone: TZ, now: Temporal.PlainDateTime.from(`${fallBack}T00:00`).toZonedDateTime(TZ).toInstant(),
      items, calendar: "current", travel: null, declinedToday: new Set(), neverMoveBehaviorIds: new Set(),
      calendarBusy: [{ ref: "e", start: items[0]!.start, end: items[0]!.end }] });
    for (const line of result.candidates) {
      for (const start of [line.to.startAt, ...line.otherTimes]) {
        expect(Temporal.Instant.from(start).toZonedDateTimeISO(TZ).toPlainDate().toString()).toBe(fallBack);
      }
    }
  });
});
