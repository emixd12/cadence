import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";
import { alongsideMayOverlap, type OverlapPlace } from "@cadence/core/resolvers/alongside.resolver";
import {
  briefMoveBlocksForSubject,
  briefMoveFreeStarts,
  briefMoveItemBlocks,
  briefMoveOverlapSubject,
  checkBriefMoveSlot,
  collapseBriefMoveRoutines,
  planBriefMoveLinesFromInputs,
  type BriefMoveBlock,
  type BriefMoveDayItem,
  type BriefMovePlanInputs,
} from "@cadence/core/resolvers/brief-move.resolver";
import type { EffectiveWhere } from "@cadence/core/resolvers/effective-where.resolver";
import { alongsideFindingAllowed } from "@/lib/services/daily-brief-consumer";

// Ticket 357 (D33): an alongside item may overlap a Cadence item or calendar event at
// the same place, or where either place is unknown or Anywhere; never travel or an item
// somewhere else. Items without a Where (CADENCE_ALONGSIDE off) keep the earlier rule.

const TZ = "America/New_York";
const DAY = "2026-11-25";
const local = (time: string) => Temporal.PlainDateTime.from(`${DAY}T${time}`).toZonedDateTime(TZ).toInstant();

const HOME: EffectiveWhere = { kind: "home", source: "person" };
const ANYWHERE: EffectiveWhere = { kind: "anywhere", source: "person" };
const UNKNOWN: EffectiveWhere = { kind: "unknown", source: "none" };
const ELSEWHERE: EffectiveWhere = { kind: "elsewhere", source: "guess" };
const GYM: EffectiveWhere = { kind: "place", placeKey: "g".repeat(43), source: "person" };
const OFFICE: EffectiveWhere = { kind: "place", placeKey: "o".repeat(43), source: "evidence" };

function item(id: string, start: string, minutes: number, extra: Partial<BriefMoveDayItem> = {}): BriefMoveDayItem {
  const begin = local(start);
  return {
    occurrenceId: id, behaviorId: `b-${id}`, title: id, status: "unresolved", localDate: DAY, scheduleKind: "exact",
    start: begin, end: begin.add({ minutes }), length: { minutes, source: "behavior_duration", assumed: false },
    alongside: false, revision: `rev-${id}`, behaviorRevision: `brev-${id}`, ...extra,
  };
}

describe("alongsideMayOverlap", () => {
  const may = (left: OverlapPlace, right: OverlapPlace, kind: "item" | "calendar" | "travel" = "item") =>
    alongsideMayOverlap({ where: left }, { kind, where: right });

  it("allows the same place", () => {
    expect(may(HOME, HOME)).toBe(true);
    expect(may(GYM, { kind: "place", placeKey: GYM.placeKey })).toBe(true);
  });

  it("allows either side unknown or Anywhere", () => {
    for (const other of [UNKNOWN, ANYWHERE, null, undefined]) {
      expect(may(HOME, other)).toBe(true);
      expect(may(other, GYM)).toBe(true);
    }
  });

  it("refuses a different place", () => {
    expect(may(HOME, GYM)).toBe(false);
    expect(may(GYM, HOME)).toBe(false);
    expect(may(GYM, OFFICE)).toBe(false);
    expect(may(HOME, ELSEWHERE)).toBe(false);
  });

  it("treats an unnamed place away from home as unknown against another away from home", () => {
    expect(may(ELSEWHERE, ELSEWHERE)).toBe(true);
    expect(may(ELSEWHERE, GYM)).toBe(true);
    expect(may({ kind: "place" }, GYM)).toBe(true);
  });

  it("never allows travel, whatever the places", () => {
    for (const place of [HOME, ANYWHERE, UNKNOWN, null]) expect(may(place, place, "travel")).toBe(false);
  });

  it("treats a calendar event's place as unknown", () => {
    expect(alongsideMayOverlap({ where: HOME }, { kind: "calendar" })).toBe(true);
  });
});

describe("the free-slot rule with the same-place rule", () => {
  const helmet = (where?: EffectiveWhere) => item("helmet", "20:00", 10, { alongside: true, ...(where ? { where } : {}) });
  const reading = (where?: EffectiveWhere) => item("reading", "20:00", 30, where ? { where } : {});

  it("without a Where (flag off), an alongside item blocks nothing, exactly as before", () => {
    const blocks = briefMoveItemBlocks([helmet(), reading()], "reading");
    expect(blocks).toEqual([]);
    // And a moved alongside item is blocked like any other item.
    expect(briefMoveItemBlocks([helmet(), reading()], "helmet").map((block) => block.ref)).toEqual(["reading"]);
    const calendar: BriefMoveBlock[] = [{ kind: "calendar", ref: "event", start: local("20:00"), end: local("21:00") }];
    expect(briefMoveBlocksForSubject(calendar, briefMoveOverlapSubject([helmet()], "helmet"))).toEqual(calendar);
  });

  it("at the same place, or with a place unknown, the alongside item still blocks nothing", () => {
    expect(briefMoveItemBlocks([helmet(HOME), reading(HOME)], "reading")).toEqual([]);
    expect(briefMoveItemBlocks([helmet(UNKNOWN), reading(GYM)], "reading")).toEqual([]);
    expect(briefMoveItemBlocks([helmet(HOME), reading(ANYWHERE)], "reading")).toEqual([]);
    // With no moving item (an opportunity placement), its place is unknown.
    expect(briefMoveItemBlocks([helmet(HOME)], null)).toEqual([]);
  });

  it("somewhere else, the alongside item blocks like any other item", () => {
    const blocks = briefMoveItemBlocks([helmet(HOME), reading(GYM)], "reading");
    expect(blocks.map((block) => block.ref)).toEqual(["helmet"]);
    expect(checkBriefMoveSlot({ interval: { start: local("20:00"), end: local("20:30") }, blocks }))
      .toEqual({ ok: false, reason: "slot_taken", ref: "helmet" });
    const starts = briefMoveFreeStarts({ localDate: DAY, timezone: TZ, now: local("19:00"), near: local("20:00"),
      lengthSeconds: 30 * 60, blocks, limit: 3 });
    expect(starts.every((start) => checkBriefMoveSlot({ interval: { start, end: start.add({ minutes: 30 }) }, blocks }).ok)).toBe(true);
    expect(starts.some((start) => start.equals(local("20:00")))).toBe(false);
  });

  it("a moved alongside item may share time with items and calendar events it may overlap, never travel", () => {
    const subject = briefMoveOverlapSubject([helmet(HOME), reading(HOME)], "helmet");
    expect(briefMoveItemBlocks([helmet(HOME), reading(HOME)], "helmet")).toEqual([]);
    expect(briefMoveItemBlocks([helmet(HOME), reading(GYM)], "helmet").map((block) => block.ref)).toEqual(["reading"]);
    const others: BriefMoveBlock[] = [
      { kind: "calendar", ref: "event", start: local("20:00"), end: local("21:00") },
      { kind: "travel", ref: "trip", start: local("21:00"), end: local("21:30") },
    ];
    expect(briefMoveBlocksForSubject(others, subject).map((block) => block.ref)).toEqual(["trip"]);
    // A non-alongside subject keeps every block.
    expect(briefMoveBlocksForSubject(others, briefMoveOverlapSubject([reading(HOME)], "reading"))).toEqual(others);
  });

  it("a routine block's place is its steps' shared Where, otherwise unknown", () => {
    const step = (id: string, order: number, where: EffectiveWhere) => item(id, "07:00", 5, { alongside: true, where,
      routine: { parentBehaviorId: "skin", parentTitle: "Skin routine", inheritParentSchedule: true, stepOrder: order } });
    expect(collapseBriefMoveRoutines([step("serum", 0, HOME), step("helmet", 1, HOME)])[0]!.where).toEqual(HOME);
    expect(collapseBriefMoveRoutines([step("serum", 0, HOME), step("helmet", 1, GYM)])[0]!.where).toEqual(UNKNOWN);
  });

  it("the brief moves the item that collides with an alongside item somewhere else", () => {
    const base: BriefMovePlanInputs = {
      localDate: DAY, timezone: TZ, now: local("08:00"), items: [], calendarBusy: [], calendar: "current", travel: null,
      declinedToday: new Set(), neverMoveBehaviorIds: new Set(),
    };
    const same = planBriefMoveLinesFromInputs({ ...base, items: [helmet(HOME), reading(HOME)] });
    expect(same.candidates).toEqual([]);
    const apart = planBriefMoveLinesFromInputs({ ...base, items: [helmet(HOME), reading(GYM)] });
    expect(apart.candidates.map((line) => [line.occurrenceId, line.reasonCode])).toEqual([["reading", "item_overlap"]]);
    // Flag off: no Where, no line, as before.
    expect(planBriefMoveLinesFromInputs({ ...base, items: [helmet(), reading()] }).candidates).toEqual([]);
  });
});

describe("Daily Brief overlap and tight-fit findings", () => {
  const alongside = new Set(["o-helmet"]);
  const places: Record<string, OverlapPlace> = { "o-helmet": HOME, "o-reading": HOME, "o-gym": GYM };
  const placeOf = (ref: string) => places[ref];

  it("drops a finding the rule allows and keeps one it refuses", () => {
    expect(alongsideFindingAllowed(["o-helmet", "o-reading"], alongside, placeOf)).toBe(true);
    expect(alongsideFindingAllowed(["o-helmet", "o-gym"], alongside, placeOf)).toBe(false);
    // Against a calendar event, whose place is unknown.
    expect(alongsideFindingAllowed(["o-helmet"], alongside, placeOf)).toBe(true);
    // No alongside side: a conflict as always.
    expect(alongsideFindingAllowed(["o-reading", "o-gym"], alongside, placeOf)).toBe(false);
  });

  it("without places (the default), every finding with an alongside side is dropped, as before", () => {
    expect(alongsideFindingAllowed(["o-helmet", "o-gym"], alongside, () => undefined)).toBe(true);
  });
});
