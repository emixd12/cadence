import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";
import type { BriefMoveDayItem } from "@cadence/core/resolvers/brief-move.resolver";
import {
  checkBriefOpportunitySlot,
  planBriefOpportunityLinesFromInputs,
  type BriefOpportunityPlanInputs,
  type BriefOpportunityPoolItem,
} from "@cadence/core/resolvers/brief-opportunity.resolver";

// Ways this planner could fail, each covered below:
//  1. Offers a time on a stale calendar.
//  2. Offers a time an item, a calendar event, travel or a planned move line holds.
//  3. Two lines (or a line and a move line) land on the same time.
//  4. More than 2 lines, or more than 8 brief lines with the move lines.
//  5. Suggests a Behavior declined today or switched to "Don't suggest adding this".
//  6. Picks a Behavior already on Today while another one fits.
//  7. Ignores Where: a home item while away, a place item without "travel not checked".
//  8. Offers more than 3 other times, or a start after 10 pm.

const TZ = "America/New_York";
const DAY = "2026-11-20";
const local = (time: string) => Temporal.PlainDateTime.from(`${DAY}T${time}`).toZonedDateTime(TZ).toInstant();
const at = (instant: string) => Temporal.Instant.from(instant).toZonedDateTimeISO(TZ).toPlainTime().toString({ smallestUnit: "minute" });

function item(id: string, start: string, minutes: number): BriefMoveDayItem {
  const begin = local(start);
  return {
    occurrenceId: id, behaviorId: `b-${id}`, title: id, status: "unresolved", localDate: DAY, scheduleKind: "exact",
    start: begin, end: begin.add({ minutes }), length: { minutes, source: "behavior_duration", assumed: false },
    alongside: false, revision: "r", behaviorRevision: "br",
  };
}

function pool(id: string, extra: Partial<BriefOpportunityPoolItem> = {}): BriefOpportunityPoolItem {
  return {
    behaviorId: id, title: id, behaviorRevision: "br", length: { minutes: 30, source: "behavior_duration", assumed: false },
    whereKind: "anywhere", daysSinceLastCompleted: 2, onToday: false, ...extra,
  };
}

function plan(overrides: Partial<BriefOpportunityPlanInputs>) {
  return planBriefOpportunityLinesFromInputs({
    localDate: DAY, timezone: TZ, now: local("08:00"), items: [], calendarBusy: [], calendar: "current", travel: null,
    pool: [pool("stretch")], declinedTodayBehaviorIds: new Set(), neverAddBehaviorIds: new Set(), ...overrides,
  });
}

describe("planBriefOpportunityLinesFromInputs", () => {
  it("offers nothing on a stale calendar", () => {
    expect(plan({ calendar: "stale" })).toEqual({ candidates: [], calendar: "stale" });
  });

  it("offers the first free time after today's items, with the 10-minute gap", () => {
    const [line] = plan({ items: [item("gym", "08:00", 60)] }).candidates;
    expect(at(line!.at.startAt)).toBe("09:10");
    expect(at(line!.at.endAt)).toBe("09:40");
    expect(line).toMatchObject({ behaviorId: "stretch", reasonCode: "open_window", travel: "not_needed", offerNeverAdd: false });
  });

  it("keeps clear of calendar events and of the time a move line of the same brief offers", () => {
    expect(at(plan({ calendarBusy: [{ ref: "c1", start: local("08:00"), end: local("10:00") }] }).candidates[0]!.at.startAt)).toBe("10:10");
    const moved = plan({ items: [item("read", "15:00", 30)], movePositions: new Map([["read", { start: local("08:00"), end: local("08:30") }]]), moveLineCount: 1 });
    expect(at(moved.candidates[0]!.at.startAt)).toBe("08:40");
  });

  it("never puts two lines on the same time", () => {
    const { candidates } = plan({ pool: [pool("a"), pool("b")] });
    expect(candidates.map((line) => at(line.at.startAt))).toEqual(["08:00", "08:40"]);
  });

  it("offers at most two lines and keeps the brief at eight lines with the move lines", () => {
    const three = [pool("a"), pool("b"), pool("c")];
    expect(plan({ pool: three }).candidates).toHaveLength(2);
    expect(plan({ pool: three, moveLineCount: 7 }).candidates).toHaveLength(1);
    expect(plan({ pool: three, moveLineCount: 8 }).candidates).toHaveLength(0);
  });

  it("skips Behaviors declined today or switched off, and offers the switch after repeated declines", () => {
    const candidates = plan({
      pool: [pool("a"), pool("b"), pool("c")],
      declinedTodayBehaviorIds: new Set(["a"]), neverAddBehaviorIds: new Set(["b"]), offerNeverAddBehaviorIds: new Set(["c"]),
    }).candidates;
    expect(candidates.map((line) => [line.behaviorId, line.offerNeverAdd])).toEqual([["c", true]]);
  });

  it("prefers not on Today, then anywhere or home, then never or longest-ago Completed", () => {
    const { candidates } = plan({
      maxLines: 5,
      pool: [
        pool("recent", { daysSinceLastCompleted: 1 }),
        pool("today", { onToday: true, daysSinceLastCompleted: null }),
        pool("placed", { whereKind: "place", daysSinceLastCompleted: null }),
        pool("never", { daysSinceLastCompleted: null }),
        pool("week", { daysSinceLastCompleted: 7 }),
      ],
    });
    expect(candidates.map((line) => line.behaviorId)).toEqual(["never", "week", "recent", "placed"]);
  });

  it("offers a Behavior already on Today only when no other fits", () => {
    expect(plan({ pool: [pool("today", { onToday: true })] }).candidates.map((line) => line.behaviorId)).toEqual(["today"]);
    // Away from 8:00 to 23:30: the home item has no time left today.
    const travel = { spans: [{ start: local("08:00"), end: local("08:30"), refs: [] }, { start: local("23:00"), end: local("23:30"), refs: [] }], stops: new Map(), unknown: new Set<string>() };
    const offered = plan({ travel, pool: [pool("home", { whereKind: "home" }), pool("today", { onToday: true })] }).candidates;
    expect(offered.map((line) => [line.behaviorId, at(line.at.startAt)])).toEqual([["today", "08:30"]]);
  });

  it("keeps a home item out of the time away and marks a place item travel not checked", () => {
    const travel = {
      spans: [{ start: local("09:00"), end: local("09:30"), refs: ["occurrence:x"] }, { start: local("17:00"), end: local("17:30"), refs: ["occurrence:x"] }],
      stops: new Map(), unknown: new Set<string>(),
    };
    const ninety = { minutes: 90, source: "behavior_duration" as const, assumed: false };
    const home = plan({ travel, pool: [pool("home", { whereKind: "home", length: ninety })] }).candidates[0]!;
    expect(at(home.at.startAt)).toBe("17:30");
    const anywhere = plan({ now: local("09:00"), travel, pool: [pool("any", { length: ninety })] }).candidates[0]!;
    expect(at(anywhere.at.startAt)).toBe("09:30");
    expect(plan({ pool: [pool("gym", { whereKind: "place" })] }).candidates[0]!.travel).toBe("not_checked");
  });

  it("offers at most three other times, one per free gap", () => {
    const items = ["10:00", "12:00", "14:00", "16:00", "18:00"].map((start, index) => item(`i${index}`, start, 30));
    const [line] = plan({ items }).candidates;
    expect(at(line!.at.startAt)).toBe("08:00");
    expect(line!.otherTimes.map(at)).toEqual(["10:40", "12:40", "14:40"]);
  });

  it("offers no start after 10 pm", () => {
    expect(plan({ now: local("21:58") }).candidates.map((line) => at(line.at.startAt))).toEqual(["22:00"]);
    expect(plan({ now: local("22:01") }).candidates).toEqual([]);
  });
});

describe("checkBriefOpportunitySlot", () => {
  it("uses the move lines' rule, and the time away for a home item", () => {
    const blocks = [{ kind: "item" as const, ref: "gym", start: local("10:00"), end: local("11:00") }];
    const thirty = { minutes: 30, source: "behavior_duration" as const, assumed: false };
    expect(checkBriefOpportunitySlot({ start: local("11:05"), item: { length: thirty, whereKind: "anywhere" }, blocks, travel: null }))
      .toEqual({ ok: false, reason: "too_close", ref: "gym" });
    expect(checkBriefOpportunitySlot({ start: local("11:10"), item: { length: thirty, whereKind: "anywhere" }, blocks, travel: null })).toEqual({ ok: true });
    const travel = { spans: [{ start: local("12:00"), end: local("12:30"), refs: [] }, { start: local("15:00"), end: local("15:30"), refs: [] }], stops: new Map(), unknown: new Set<string>() };
    expect(checkBriefOpportunitySlot({ start: local("13:00"), item: { length: thirty, whereKind: "home" }, blocks: [], travel }))
      .toMatchObject({ ok: false, reason: "travel_busy" });
    expect(checkBriefOpportunitySlot({ start: local("13:00"), item: { length: thirty, whereKind: "anywhere" }, blocks: [], travel })).toEqual({ ok: true });
  });
});
