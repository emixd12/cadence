import { describe, expect, it } from "vitest";

import {
  BEHAVIOR_CHANGE_RULES,
  buildChangedSchedules,
  changeFromMovePattern,
  describeSchedules,
  evaluateBehaviorChangeCandidate,
  evaluateBehaviorLengthCandidate,
  firstAffectedDate,
  formatBehaviorChangeLine,
  formatCheckInQuestion,
  formatLengthChangeLine,
  formatTipQuestion,
  lengthChangeFrom,
  restoreSchedules,
  schedulesEqual,
  summarizeMoves,
  toProposeBehaviorChangeInput,
  trialCheckInDate,
  validateProposeBehaviorChangeInput,
  weekdaysWithSetTime,
  type BehaviorChange,
  type BehaviorChangeEvidence,
  type MovePattern,
  type PlannedItem,
  type PlannedItemMove,
  type ProposalSchedule,
} from "@cadence/core/services/behavior-change-proposal";

// Advisor Phase 4C and "Tips with one-tap changes" (Nov 20): base schedule and length
// proposals. The bar is the tip's: 3 same-direction moves in 28 days, targets within
// 60 minutes, a shift of at least 30 minutes.

const TZ = "America/New_York";
const GYM = "11111111-1111-4111-8111-111111111111";
const S1 = "22222222-2222-4222-8222-222222222222";
const E1 = "33333333-3333-4333-8333-333333333333";
const S2 = "44444444-4444-4444-8444-444444444444";
const E2 = "55555555-5555-4555-8555-555555555555";
const TODAY = "2026-11-19"; // a Thursday

const monTueThu: ProposalSchedule[] = [{
  id: S1,
  recurrence: { frequency: "weekly", interval: 1, days_of_week: ["monday", "tuesday", "thursday"] },
  time_entries: [{ id: E1, kind: "exact", start_time: "07:00" }],
}];

const tuesdayToEvening: BehaviorChange = { weekdays: ["tuesday"], fromTime: "07:00", toTime: "18:30" };

/** Four Tuesdays before Thursday Nov 19, 2026, inside the 28-day window: Nov 17, 10, 3, Oct 27. */
const TUESDAYS = ["2026-11-17", "2026-11-10", "2026-11-03", "2026-10-27"];

function items(dates: readonly string[], startTime = "07:00"): PlannedItem[] {
  return dates.map((localDate, i) => ({ occurrenceId: `occ-${localDate}-${i}`, behaviorId: GYM, localDate, startTime, kind: "exact" }));
}

function moveTo(item: PlannedItem, time: string, extra: Partial<PlannedItemMove> = {}): PlannedItemMove {
  // New York is UTC-4 until Nov 1, 2026 and UTC-5 after.
  const offset = item.localDate < "2026-11-01" ? "-04:00" : "-05:00";
  return { occurrenceId: item.occurrenceId, kind: "move", chainPosition: 1, toPlanned: false, toStartAt: new Date(`${item.localDate}T${time}:00${offset}`).toISOString(), timezone: TZ, ...extra };
}

function repeatedMoveEvidence(overrides: Partial<Extract<BehaviorChangeEvidence, { source: "repeated_move" }>> = {}): BehaviorChangeEvidence {
  return {
    source: "repeated_move", signalIds: [], movedWeekdays: ["tuesday"], windowDays: 28, movedDays: 3,
    direction: "later", medianTargetTime: "18:30", targetSpreadMinutes: 15, ...overrides,
  };
}

function pattern(overrides: Partial<MovePattern> = {}): MovePattern {
  return {
    behaviorId: GYM, fromTime: "07:00", windowDays: 28, movedDays: 3, direction: "later", movedWeekdays: ["tuesday"],
    medianTargetTime: "18:30", targetSpreadMinutes: 15, movedDates: [], ...overrides,
  };
}

describe("move patterns (the tip's bar)", () => {
  it("finds 3 Tuesdays moved to the evening in 28 days and turns it into a Tuesday change", () => {
    const planned = items(TUESDAYS);
    const moves = [moveTo(planned[0]!, "18:30"), moveTo(planned[1]!, "18:15"), moveTo(planned[2]!, "18:45")];
    const [found] = summarizeMoves({ today: TODAY, items: planned, moves });
    expect(found).toMatchObject({
      behaviorId: GYM, fromTime: "07:00", windowDays: 28, movedDays: 3, movedWeekdays: ["tuesday"],
      direction: "later", medianTargetTime: "18:30", targetSpreadMinutes: 15,
    });
    expect(changeFromMovePattern(found!, { schedules: monTueThu })?.change).toEqual(tuesdayToEvening);
  });

  it("moves on two or more weekdays change every day with that set time", () => {
    const planned = items(["2026-11-16", "2026-11-17", "2026-11-12"]); // Mon, Tue, Thu
    const moves = planned.map((item) => moveTo(item, "18:30"));
    const [found] = summarizeMoves({ today: TODAY, items: planned, moves });
    expect(found?.movedWeekdays).toEqual(["monday", "tuesday", "thursday"]);
    const daily: ProposalSchedule[] = [{ id: S1, recurrence: { frequency: "daily", interval: 1 }, time_entries: [{ id: E1, kind: "exact", start_time: "07:00" }] }];
    const result = changeFromMovePattern(found!, { schedules: daily });
    expect(result?.change.weekdays).toHaveLength(7);
    expect(formatTipQuestion({ title: "Gym", change: result!.change })).toBe("Set Gym to 6:30 PM every day?");
    // Two weekdays on a Mon–Fri schedule: every weekday.
    const weekdays: ProposalSchedule[] = [{ recurrence: { frequency: "weekly", interval: 1, days_of_week: ["monday", "tuesday", "wednesday", "thursday", "friday"] }, time_entries: [{ kind: "exact", start_time: "07:00" }] }];
    expect(weekdaysWithSetTime(weekdays, "07:00")).toHaveLength(5);
    expect(formatTipQuestion({ title: "Gym", change: changeFromMovePattern(found!, { schedules: weekdays })!.change })).toBe("Set Gym to 6:30 PM every weekday?");
  });

  it("does not count reverted moves, moves to another day, today, or days before the window", () => {
    const planned = items([...TUESDAYS, "2026-10-20"]);
    const moves = [
      moveTo(planned[0]!, "18:30"),
      moveTo(planned[1]!, "18:30"),
      moveTo(planned[2]!, "18:30", { kind: "move" }),
      moveTo(planned[2]!, "07:00", { kind: "revert", chainPosition: 2, toPlanned: true }),
      { ...moveTo(planned[3]!, "18:30"), toStartAt: new Date("2026-10-28T18:30:00-04:00").toISOString() },
      moveTo(planned[4]!, "18:30"), // Oct 20 is 30 days back
    ];
    const today = { occurrenceId: "occ-today", behaviorId: GYM, localDate: TODAY, startTime: "07:00", kind: "exact" as const };
    const [found] = summarizeMoves({ today: TODAY, items: [...planned, today], moves: [...moves, moveTo(today, "18:30")] });
    expect(found?.movedDays).toBe(2);
    expect(changeFromMovePattern(found!)).toBeNull();
  });

  it("needs three moves, targets within 60 minutes and a shift of at least 30 minutes", () => {
    expect(changeFromMovePattern(pattern({ movedDays: 2 }))).toBeNull();
    expect(changeFromMovePattern(pattern({ targetSpreadMinutes: 61 }))).toBeNull();
    expect(changeFromMovePattern(pattern({ targetSpreadMinutes: 60 }))).not.toBeNull();
    expect(changeFromMovePattern(pattern({ medianTargetTime: "07:20" }))).toBeNull();
    expect(changeFromMovePattern(pattern({ medianTargetTime: "07:30" }))?.change.toTime).toBe("07:30");
    // The median rounds to 15 minutes.
    expect(changeFromMovePattern(pattern({ medianTargetTime: "18:37" }))?.change.toTime).toBe("18:30");
    expect(changeFromMovePattern(pattern({ medianTargetTime: "18:38" }))?.change.toTime).toBe("18:45");
  });

  it("groups moves by the set time they came from", () => {
    const morning = items(["2026-11-16", "2026-11-17", "2026-11-18"], "07:00");
    const noon = items(["2026-11-13", "2026-11-12"], "12:00");
    const moves = [...morning.map((item) => moveTo(item, "08:00")), ...noon.map((item) => moveTo(item, "13:00"))];
    const found = summarizeMoves({ today: TODAY, items: [...morning, ...noon], moves });
    expect(found.map((p) => [p.fromTime, p.movedDays])).toEqual([["07:00", 3], ["12:00", 2]]);
  });
});

describe("length changes", () => {
  it("rounds the usual session time to 5 minutes and needs a change", () => {
    expect(lengthChangeFrom({ currentMinutes: 30, medianMinutes: 43 })).toEqual({ fromMinutes: 30, toMinutes: 45 });
    expect(lengthChangeFrom({ currentMinutes: 30, medianMinutes: 31 })).toBeNull();
    expect(lengthChangeFrom({ currentMinutes: null, medianMinutes: 45 })).toBeNull();
    expect(lengthChangeFrom({ currentMinutes: 30, medianMinutes: 2 })).toEqual({ fromMinutes: 30, toMinutes: 5 });
  });

  it("stores a tip-backed length question that applies from today", () => {
    const evidence = { source: "tip" as const, signalKind: "session_length" as const, signalIds: [7], cardId: "set-the-length-it-takes", tipText: "Gym sessions ran about 45 minutes, not 30.", counts: { sessions: 6 } };
    const behavior = { id: GYM, title: "Gym", active: true, schedules: monTueThu, lengthMinutes: 30 };
    const result = evaluateBehaviorLengthCandidate({ today: TODAY, behavior, change: { fromMinutes: 30, toMinutes: 45 }, evidence, hasOpenProposal: false, declined: [] });
    if (!result.ok) throw new Error(result.reason);
    expect(result.plan.direction).toBe("longer");
    const input = toProposeBehaviorChangeInput(result.plan, TODAY, null);
    expect(input).toMatchObject({ change_kind: "length", from_minutes: 30, to_minutes: 45, first_affected_date: TODAY });
    expect(validateProposeBehaviorChangeInput(input).ok).toBe(true);
    expect(formatTipQuestion({ title: "Gym", length: result.plan.change })).toBe("Update Gym's intended duration to 45 minutes?");
    expect(formatLengthChangeLine({ title: "Gym", change: result.plan.change })).toBe("Update the intended duration: Gym to 45 minutes (now 30 minutes).");
    expect(evaluateBehaviorLengthCandidate({ today: TODAY, behavior: { ...behavior, lengthMinutes: null }, change: { fromMinutes: 30, toMinutes: 45 }, evidence, hasOpenProposal: false, declined: [] }))
      .toEqual({ ok: false, reason: "no_length" });
    expect(evaluateBehaviorLengthCandidate({ today: TODAY, behavior, change: { fromMinutes: 30, toMinutes: 45 }, evidence, hasOpenProposal: false, declined: [{ behaviorId: GYM, direction: "longer", declinedOn: "2026-11-10" }] }))
      .toEqual({ ok: false, reason: "declined_recently" });
  });

  it("refuses fields that do not match the change kind", () => {
    const evidence = { source: "tip", signal_kind: "session_length", signal_ids: [], card_id: "c", tip_text: "t", counts: [] };
    const mixed = { behavior_id: GYM, change_kind: "length", from_minutes: 30, to_minutes: 45, from_time: "07:00", first_affected_date: TODAY, reason: "r", evidence, run_id: null };
    expect(validateProposeBehaviorChangeInput(mixed)).toMatchObject({ ok: false, issues: [{ keyword: "pairing" }] });
  });
});

describe("the exact new schedule list (T2)", () => {
  it("splits one weekday out of a weekly schedule and keeps the old schedule's ids", () => {
    const result = buildChangedSchedules(monTueThu, tuesdayToEvening);
    expect(result).toEqual({
      ok: true,
      weekdays: ["tuesday"],
      schedules: [
        { id: S1, recurrence: { frequency: "weekly", interval: 1, days_of_week: ["monday", "thursday"] }, time_entries: [{ id: E1, kind: "exact", start_time: "07:00" }] },
        { recurrence: { frequency: "weekly", interval: 1, days_of_week: ["tuesday"] }, time_entries: [{ kind: "exact", start_time: "18:30" }] },
      ],
    });
  });

  it("splits a daily schedule into the six other days and the changed one", () => {
    const daily: ProposalSchedule[] = [{ id: S1, recurrence: { frequency: "daily", interval: 1 }, time_entries: [{ id: E1, kind: "exact", start_time: "07:00" }] }];
    const result = buildChangedSchedules(daily, tuesdayToEvening);
    expect(result.ok && result.schedules.map((s) => s.recurrence)).toEqual([
      { frequency: "weekly", interval: 1, days_of_week: ["monday", "wednesday", "thursday", "friday", "saturday", "sunday"] },
      { frequency: "weekly", interval: 1, days_of_week: ["tuesday"] },
    ]);
  });

  it("changes the time in place when the schedule is only that weekday, and keeps other entries", () => {
    const tuesdayOnly: ProposalSchedule[] = [{
      id: S1, recurrence: { frequency: "weekly", interval: 1, days_of_week: ["tuesday"] },
      time_entries: [{ id: E1, kind: "exact", start_time: "07:00" }, { id: E2, kind: "exact", start_time: "12:00" }],
    }];
    const result = buildChangedSchedules(tuesdayOnly, tuesdayToEvening);
    expect(result.ok && result.schedules).toEqual([{
      id: S1, recurrence: { frequency: "weekly", interval: 1, days_of_week: ["tuesday"] },
      time_entries: [{ id: E1, kind: "exact", start_time: "18:30" }, { id: E2, kind: "exact", start_time: "12:00" }],
    }]);
  });

  it("refuses ranges, collisions, unsupported recurrences, a missing time and a seventh schedule", () => {
    const range: ProposalSchedule[] = [{ recurrence: { frequency: "weekly", interval: 1, days_of_week: ["tuesday"] }, time_entries: [{ kind: "range", start_time: "07:00", end_time: "09:00" }] }];
    expect(buildChangedSchedules(range, tuesdayToEvening)).toEqual({ ok: false, reason: "range_time" });
    const collide: ProposalSchedule[] = [...monTueThu, { id: S2, recurrence: { frequency: "weekly", interval: 1, days_of_week: ["tuesday"] }, time_entries: [{ id: E2, kind: "exact", start_time: "18:30" }] }];
    expect(buildChangedSchedules(collide, tuesdayToEvening)).toEqual({ ok: false, reason: "time_collision" });
    const fortnightly: ProposalSchedule[] = [{ recurrence: { frequency: "weekly", interval: 2, days_of_week: ["tuesday"] }, time_entries: [{ kind: "exact", start_time: "07:00" }] }];
    expect(buildChangedSchedules(fortnightly, tuesdayToEvening)).toEqual({ ok: false, reason: "unsupported_schedule" });
    expect(buildChangedSchedules(monTueThu, { ...tuesdayToEvening, fromTime: "08:00" })).toEqual({ ok: false, reason: "time_not_scheduled" });
    const six: ProposalSchedule[] = ["monday", "tuesday", "wednesday", "thursday", "friday"].map((day, i) => ({
      recurrence: { frequency: "weekly", interval: 1, days_of_week: day === "tuesday" ? ["tuesday", "saturday"] : [day] } as ProposalSchedule["recurrence"],
      time_entries: [{ kind: "exact", start_time: `0${i + 5}:00` }],
    }));
    six.push({ recurrence: { frequency: "weekly", interval: 1, days_of_week: ["sunday"] }, time_entries: [{ kind: "exact", start_time: "10:00" }] });
    expect(buildChangedSchedules(six, { weekdays: ["tuesday"], fromTime: "06:00", toTime: "18:00" })).toEqual({ ok: false, reason: "too_many_schedules" });
  });

  it("compares lists without ids or order, and Go back reuses only ids that still exist", () => {
    const after = buildChangedSchedules(monTueThu, tuesdayToEvening);
    if (!after.ok) throw new Error("expected a change");
    const reordered = [...after.schedules].reverse().map((s) => ({ ...s, id: undefined }));
    expect(schedulesEqual(reordered, after.schedules)).toBe(true);
    expect(schedulesEqual(monTueThu, after.schedules)).toBe(false);
    const current = after.schedules.map((s, i) => ({ ...s, id: s.id ?? S2, time_entries: s.time_entries.map((e) => ({ ...e, id: e.id ?? `${i}0000000-0000-4000-8000-000000000000` })) }));
    expect(restoreSchedules(monTueThu, current)).toEqual(monTueThu);
    expect(restoreSchedules(monTueThu, [current[1]!])).toEqual([{ recurrence: monTueThu[0]!.recurrence, time_entries: [{ kind: "exact", start_time: "07:00" }] }]);
  });

  it("describes before and after", () => {
    const after = buildChangedSchedules(monTueThu, tuesdayToEvening);
    expect(describeSchedules(monTueThu)).toEqual(["Monday, Tuesday and Thursday at 7:00 AM"]);
    expect(after.ok && describeSchedules(after.schedules)).toEqual(["Monday and Thursday at 7:00 AM", "Tuesday at 6:30 PM"]);
  });
});

describe("wording and dates (T1)", () => {
  it("uses the fixed template with the first affected day and the old time", () => {
    const first = firstAffectedDate(TODAY, ["tuesday"]);
    expect(first).toBe("2026-11-24");
    expect(formatBehaviorChangeLine({ title: "Gym", change: tuesdayToEvening, firstAffectedDate: first, today: TODAY }))
      .toBe("Change your schedule: Gym at 6:30 PM every Tuesday from Tuesday, Nov 24 (now 7:00 AM).");
    expect(formatCheckInQuestion({ title: "Gym", change: tuesdayToEvening })).toBe("Keep Gym at 6:30 PM every Tuesday?");
    expect(formatTipQuestion({ title: "Gym", change: tuesdayToEvening })).toBe("Set Gym to 6:30 PM every Tuesday?");
  });

  it("a Yes applies today: on the changed weekday the first day is today", () => {
    expect(firstAffectedDate("2026-11-24", ["tuesday"])).toBe("2026-11-24");
    expect(firstAffectedDate("2026-11-24", ["tuesday"], { afterToday: true })).toBe("2026-12-01");
    expect(formatBehaviorChangeLine({ title: "Gym", change: tuesdayToEvening, firstAffectedDate: "2026-11-24", today: "2026-11-24" }))
      .toBe("Change your schedule: Gym at 6:30 PM every Tuesday, starting today (now 7:00 AM).");
  });

  it("asks fourteen calendar days later, across a clock change", () => {
    // Try on Sunday Oct 25; clocks go back Nov 1. Fourteen calendar days later is Sunday Nov 8.
    expect(trialCheckInDate("2026-10-25")).toBe("2026-11-08");
    // Spring forward Mar 8, 2026: still calendar days.
    expect(trialCheckInDate("2026-02-26")).toBe("2026-03-12");
  });
});

describe("layer-1 rules", () => {
  const behavior = { id: GYM, title: "Gym", active: true, schedules: monTueThu };
  const base = { today: TODAY, behavior, change: tuesdayToEvening, hasOpenProposal: false, declined: [] };

  it("makes no proposal without its signal", () => {
    expect(evaluateBehaviorChangeCandidate({ ...base, evidence: null })).toEqual({ ok: false, reason: "no_evidence" });
    expect(evaluateBehaviorChangeCandidate({ ...base, evidence: repeatedMoveEvidence({ movedDays: 2 }) })).toEqual({ ok: false, reason: "no_evidence" });
    expect(evaluateBehaviorChangeCandidate({ ...base, evidence: repeatedMoveEvidence({ movedWeekdays: ["monday"] }) })).toEqual({ ok: false, reason: "no_evidence" });
    expect(evaluateBehaviorChangeCandidate({ ...base, evidence: repeatedMoveEvidence({ direction: "earlier" }) })).toEqual({ ok: false, reason: "no_evidence" });
    expect(evaluateBehaviorChangeCandidate({ ...base, evidence: repeatedMoveEvidence({ targetSpreadMinutes: 75 }) })).toEqual({ ok: false, reason: "no_evidence" });
  });

  it("makes no proposal for a range Behavior", () => {
    const ranges = { ...behavior, schedules: [{ recurrence: { frequency: "weekly", interval: 1, days_of_week: ["tuesday"] }, time_entries: [{ kind: "range", preset: "morning" }] }] as ProposalSchedule[] };
    const result = evaluateBehaviorChangeCandidate({ ...base, behavior: ranges, change: { ...tuesdayToEvening, fromTime: "06:00" }, evidence: repeatedMoveEvidence() });
    expect(result.ok).toBe(false);
  });

  it("never makes two open proposals, and respects a recent No", () => {
    expect(evaluateBehaviorChangeCandidate({ ...base, hasOpenProposal: true, evidence: repeatedMoveEvidence() })).toEqual({ ok: false, reason: "open_proposal" });
    expect(evaluateBehaviorChangeCandidate({ ...base, evidence: repeatedMoveEvidence(), declined: [{ behaviorId: GYM, direction: "later", declinedOn: "2026-11-01" }] }))
      .toEqual({ ok: false, reason: "declined_recently" });
    expect(evaluateBehaviorChangeCandidate({ ...base, evidence: repeatedMoveEvidence(), declined: [{ behaviorId: GYM, direction: "earlier", declinedOn: "2026-11-01" }] }).ok).toBe(true);
    expect(evaluateBehaviorChangeCandidate({ ...base, evidence: repeatedMoveEvidence(), declined: [{ behaviorId: GYM, direction: "later", declinedOn: "2026-10-19" }] }).ok).toBe(true);
  });

  it("proposes an every-day change; it starts today", () => {
    const daily = { ...behavior, schedules: [{ recurrence: { frequency: "daily", interval: 1 }, time_entries: [{ kind: "exact", start_time: "07:00" }] }] as ProposalSchedule[] };
    const everyDay: BehaviorChange = { weekdays: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"], fromTime: "07:00", toTime: "18:30" };
    const result = evaluateBehaviorChangeCandidate({ ...base, behavior: daily, change: everyDay, evidence: repeatedMoveEvidence({ movedWeekdays: ["monday", "tuesday"] }) });
    if (!result.ok) throw new Error(result.reason);
    expect(toProposeBehaviorChangeInput(result.plan, TODAY, null).first_affected_date).toBe(TODAY);
  });

  it("stores a valid operation input whose wording names the first affected day and the old time", () => {
    const result = evaluateBehaviorChangeCandidate({ ...base, evidence: repeatedMoveEvidence(), reason: "Line one\nline two" });
    if (!result.ok) throw new Error(result.reason);
    expect(result.plan.reason).toBe("You moved it to about 6:30 PM on 3 of the last 28 days.");
    const input = toProposeBehaviorChangeInput(result.plan, base.today, null);
    expect(validateProposeBehaviorChangeInput(input)).toEqual({ ok: true, value: input });
    expect(input.first_affected_date).toBe("2026-11-24");
    const line = formatBehaviorChangeLine({ title: "Gym", change: result.plan.change, firstAffectedDate: input.first_affected_date, today: TODAY });
    expect(line).toContain("from Tuesday, Nov 24");
    expect(line).toContain("(now 7:00 AM)");
  });

  it("stores a tip-backed question with the tip's sentence as its reason", () => {
    const tipText = "You moved Gym from 7:00 AM to about 6:30 PM on 3 Tuesdays in the last 4 weeks.";
    const evidence: BehaviorChangeEvidence = { source: "tip", signalKind: "repeated_move", signalIds: [3], cardId: "set-it-where-you-keep-moving-it", tipText, counts: { moved_days: 3, window_days: 28 } };
    const result = evaluateBehaviorChangeCandidate({ ...base, evidence });
    if (!result.ok) throw new Error(result.reason);
    expect(result.plan.reason).toBe(tipText);
    const input = toProposeBehaviorChangeInput(result.plan, TODAY, null);
    expect(input.evidence).toMatchObject({ source: "tip", card_id: "set-it-where-you-keep-moving-it", tip_text: tipText });
    expect(validateProposeBehaviorChangeInput(input).ok).toBe(true);
  });

  it("holds the rule over every weekday and time combination it accepts", () => {
    const times = ["06:00", "07:00", "12:30", "18:00", "21:45"];
    for (const weekday of ["monday", "tuesday", "thursday"] as const) {
      for (const toTime of times) {
        const change = { weekdays: [weekday], fromTime: "07:00", toTime };
        const direction = toTime > "07:00" ? "later" : "earlier";
        const result = evaluateBehaviorChangeCandidate({ ...base, change, evidence: repeatedMoveEvidence({ movedWeekdays: [weekday], direction }) });
        if (!result.ok) { expect(toTime).toBe("07:00"); continue; }
        const first = firstAffectedDate(base.today, result.plan.weekdays);
        expect(first >= base.today).toBe(true);
        const line = formatBehaviorChangeLine({ title: "Gym", change: result.plan.change, firstAffectedDate: first, today: base.today });
        expect(line).toMatch(/^Change your schedule: Gym at .+ every .+( from \w+day, \w{3} \d{1,2}|, starting today) \(now 7:00 AM\)\.$/);
        expect(result.plan.schedulesAfter.length).toBeLessThanOrEqual(BEHAVIOR_CHANGE_RULES.maxSchedules);
      }
    }
  });
});
