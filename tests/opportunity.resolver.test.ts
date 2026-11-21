import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";

import {
  canRemoveOpportunityOccurrence,
  isBehaviorInOpportunityPool,
  suggestDefaultOpportunitySlot,
  type OpportunityPoolBehavior,
  type OpportunityRemovalFacts,
} from "../lib/resolvers/opportunity.resolver";
import type { BriefMoveBlock } from "@cadence/core/resolvers/brief-move.resolver";

const TZ = "America/New_York";
const DAY = "2026-11-20";
const at = (time: string, date = DAY) =>
  Temporal.PlainDateTime.from(`${date}T${time}`).toZonedDateTime(TZ).toInstant();

const POOL: OpportunityPoolBehavior = {
  isOpportunity: true, active: true, timezone: TZ,
  endOn: null, endTime: null, pauseFromOn: null, pauseFromTime: null, pauseBackOn: null,
};

describe("isBehaviorInOpportunityPool", () => {
  const now = at("10:00");

  it("holds an active, running opportunity Behavior", () => {
    expect(isBehaviorInOpportunityPool(POOL, now)).toBe(true);
  });

  it.each([
    ["not an opportunity Behavior", { isOpportunity: false }],
    ["archived", { active: false }],
    ["ended", { endOn: "2026-11-19" }],
    ["ended earlier today", { endOn: DAY, endTime: "09:00" }],
    ["paused", { pauseFromOn: "2026-11-19", pauseBackOn: "2026-11-25" }],
  ])("leaves out a Behavior that is %s", (_label, change) => {
    expect(isBehaviorInOpportunityPool({ ...POOL, ...change }, now)).toBe(false);
  });

  it("keeps a Behavior whose end or pause is still ahead", () => {
    expect(isBehaviorInOpportunityPool({ ...POOL, endOn: DAY, endTime: "18:00" }, now)).toBe(true);
    expect(isBehaviorInOpportunityPool({ ...POOL, pauseFromOn: "2026-11-21", pauseBackOn: "2026-11-25" }, now)).toBe(true);
  });

  it("puts a Behavior back after its pause ends", () => {
    const paused = { ...POOL, pauseFromOn: "2026-11-18", pauseBackOn: DAY };
    expect(isBehaviorInOpportunityPool(paused, now)).toBe(true);
    expect(isBehaviorInOpportunityPool(paused, at("23:00", "2026-11-19"))).toBe(false);
  });
});

describe("canRemoveOpportunityOccurrence", () => {
  const clean: OpportunityRemovalFacts = {
    origin: "opportunity", status: "unresolved", note: null,
    hasTimeSessions: false, hasStatusHistory: false, hasActiveSourceMatch: false,
  };

  it("allows a clean added Occurrence", () => {
    expect(canRemoveOpportunityOccurrence(clean)).toBe(true);
    expect(canRemoveOpportunityOccurrence({ ...clean, note: "   " })).toBe(true);
  });

  it.each([
    ["a scheduled Occurrence", { origin: "scheduled" }],
    ["an Occurrence with no origin (scheduled)", { origin: undefined }],
    ["a Completed Occurrence", { status: "completed" as const }],
    ["a Not Completed Occurrence", { status: "not_completed" as const }],
    ["a noted Occurrence", { note: "felt good" }],
    ["a timed Occurrence", { hasTimeSessions: true }],
    ["an Occurrence with status history", { hasStatusHistory: true }],
    ["an Occurrence whose status history is unknown", { hasStatusHistory: undefined }],
    ["an Occurrence with an active source match", { hasActiveSourceMatch: true }],
  ])("refuses %s", (_label, change) => {
    expect(canRemoveOpportunityOccurrence({ ...clean, ...change })).toBe(false);
  });
});

describe("suggestDefaultOpportunitySlot", () => {
  const block = (start: string, end: string, kind: BriefMoveBlock["kind"] = "item"): BriefMoveBlock =>
    ({ kind, ref: `${kind}-${start}`, start: at(start), end: at(end) });

  it("rounds now up to the next 5 minutes when nothing blocks it", () => {
    expect(suggestDefaultOpportunitySlot({ localDate: DAY, timezone: TZ, now: at("10:02:30"), lengthMinutes: 30, blocks: [] }))
      .toMatchObject({ localTime: "10:05", source: "now" });
  });

  it("keeps now when it is already on a 5-minute step", () => {
    const slot = suggestDefaultOpportunitySlot({ localDate: DAY, timezone: TZ, now: at("10:05"), lengthMinutes: 30, blocks: [] });
    expect(slot.startsAt.equals(at("10:05"))).toBe(true);
    expect(slot.source).toBe("now");
  });

  it("keeps now when the blocks leave it free", () => {
    expect(suggestDefaultOpportunitySlot({ localDate: DAY, timezone: TZ, now: at("10:02"), lengthMinutes: 30, blocks: [block("14:00", "15:00")] }))
      .toMatchObject({ localTime: "10:05", source: "now" });
  });

  it("moves to the next free start after an item, with the 10-minute gap", () => {
    expect(suggestDefaultOpportunitySlot({ localDate: DAY, timezone: TZ, now: at("10:02"), lengthMinutes: 30, blocks: [block("10:00", "11:00")] }))
      .toMatchObject({ localTime: "11:10", source: "free_slot" });
  });

  it("skips a gap too short for the length", () => {
    const blocks = [block("10:00", "11:00"), block("11:30", "12:30", "calendar")];
    expect(suggestDefaultOpportunitySlot({ localDate: DAY, timezone: TZ, now: at("10:02"), lengthMinutes: 30, blocks }))
      .toMatchObject({ localTime: "12:40", source: "free_slot" });
  });

  it("falls back to now when the rest of the day is full", () => {
    expect(suggestDefaultOpportunitySlot({ localDate: DAY, timezone: TZ, now: at("10:02"), lengthMinutes: 30, blocks: [block("09:00", "23:59:59")] }))
      .toMatchObject({ localTime: "10:05", source: "now" });
  });

  it("never leaves today near midnight", () => {
    const slot = suggestDefaultOpportunitySlot({ localDate: DAY, timezone: TZ, now: at("23:58:30"), lengthMinutes: 30, blocks: [] });
    expect(slot).toMatchObject({ localTime: "23:58", source: "now" });
    expect(slot.startsAt.toZonedDateTimeISO(TZ).toPlainDate().toString()).toBe(DAY);
  });
});
