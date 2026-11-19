import { describe, expect, it } from "vitest";

import {
  BEHAVIOR_CHANGE_RULES,
  buildChangedSchedules,
  changeFromWeekdayPattern,
  describeSchedules,
  evaluateBehaviorChangeCandidate,
  firstAffectedDate,
  formatBehaviorChangeLine,
  formatCheckInQuestion,
  isHeldToday,
  restoreSchedules,
  schedulesEqual,
  summarizeWeekdayMoves,
  toProposeBehaviorChangeInput,
  trialCheckInDate,
  validateProposeBehaviorChangeInput,
  type BehaviorChange,
  type BehaviorChangeEvidence,
  type PlannedItem,
  type PlannedItemMove,
  type ProposalSchedule,
} from "@cadence/core/services/behavior-change-proposal";

// Advisor Phase 4C: base schedule proposals ("Try for two weeks").

const TZ = "America/New_York";
const GYM = "11111111-1111-4111-8111-111111111111";
const S1 = "22222222-2222-4222-8222-222222222222";
const E1 = "33333333-3333-4333-8333-333333333333";
const S2 = "44444444-4444-4444-8444-444444444444";
const E2 = "55555555-5555-4555-8555-555555555555";

const monTueThu: ProposalSchedule[] = [{
  id: S1,
  recurrence: { frequency: "weekly", interval: 1, days_of_week: ["monday", "tuesday", "thursday"] },
  time_entries: [{ id: E1, kind: "exact", start_time: "07:00" }],
}];

const tuesdayToEvening: BehaviorChange = { weekdays: ["tuesday"], fromTime: "07:00", toTime: "18:30" };

/** Five Tuesdays before Thursday Nov 19, 2026, newest first: Nov 17, 10, 3, Oct 27, 20. */
const TUESDAYS = ["2026-11-17", "2026-11-10", "2026-11-03", "2026-10-27", "2026-10-20"];

function tuesdayItems(): PlannedItem[] {
  return TUESDAYS.map((localDate, i) => ({ occurrenceId: `occ-${i}`, behaviorId: GYM, localDate, startTime: "07:00", kind: "exact" }));
}

function moveTo(occurrenceId: string, localDate: string, time: string, extra: Partial<PlannedItemMove> = {}): PlannedItemMove {
  // New York is UTC-4 until Nov 1, 2026 and UTC-5 after.
  const offset = localDate < "2026-11-01" ? "-04:00" : "-05:00";
  return { occurrenceId, kind: "move", chainPosition: 1, toPlanned: false, toStartAt: new Date(`${localDate}T${time}:00${offset}`).toISOString(), timezone: TZ, ...extra };
}

function repeatedMoveEvidence(overrides: Partial<Extract<BehaviorChangeEvidence, { source: "repeated_move" }>> = {}): BehaviorChangeEvidence {
  return {
    source: "repeated_move", signalIds: [], weekday: "tuesday", matchingDays: 5, movedDays: 4,
    direction: "later", medianTargetTime: "18:30", targetSpreadMinutes: 15, ...overrides,
  };
}

describe("weekday move patterns", () => {
  it("finds 4 of the last 5 Tuesdays moved to the evening and turns it into a change", () => {
    const moves = [
      moveTo("occ-0", TUESDAYS[0]!, "18:30"),
      moveTo("occ-1", TUESDAYS[1]!, "18:15"),
      moveTo("occ-2", TUESDAYS[2]!, "18:45"),
      moveTo("occ-4", TUESDAYS[4]!, "18:30"),
    ];
    const [pattern] = summarizeWeekdayMoves({ today: "2026-11-19", items: tuesdayItems(), moves });
    expect(pattern).toMatchObject({
      behaviorId: GYM, weekday: "tuesday", fromTime: "07:00", matchingDays: 5, movedDays: 4,
      direction: "later", medianTargetTime: "18:30", targetSpreadMinutes: 15,
    });
    expect(changeFromWeekdayPattern(pattern!)?.change).toEqual(tuesdayToEvening);
  });

  it("does not count reverted moves, moves to another day, or today", () => {
    const moves = [
      moveTo("occ-0", TUESDAYS[0]!, "18:30"),
      moveTo("occ-1", TUESDAYS[1]!, "18:30"),
      moveTo("occ-2", TUESDAYS[2]!, "18:30"),
      moveTo("occ-3", TUESDAYS[3]!, "18:30"),
      moveTo("occ-3", TUESDAYS[3]!, "07:00", { kind: "revert", chainPosition: 2, toPlanned: true }),
      moveTo("occ-4", "2026-10-21", "18:30"),
    ];
    const items = [...tuesdayItems(), { occurrenceId: "occ-today", behaviorId: GYM, localDate: "2026-11-24", startTime: "07:00", kind: "exact" as const }];
    const [pattern] = summarizeWeekdayMoves({ today: "2026-11-19", items, moves });
    expect(pattern?.movedDays).toBe(3);
    expect(changeFromWeekdayPattern(pattern!)).toBeNull();
  });

  it("needs five matching days, a tight cluster and a real shift", () => {
    const base = { behaviorId: GYM, weekday: "tuesday" as const, fromTime: "07:00", direction: "later" as const, movedDates: [] };
    expect(changeFromWeekdayPattern({ ...base, matchingDays: 4, movedDays: 4, medianTargetTime: "18:30", targetSpreadMinutes: 0 })).toBeNull();
    expect(changeFromWeekdayPattern({ ...base, matchingDays: 5, movedDays: 4, medianTargetTime: "18:30", targetSpreadMinutes: 90 })).toBeNull();
    expect(changeFromWeekdayPattern({ ...base, matchingDays: 5, movedDays: 4, medianTargetTime: "07:20", targetSpreadMinutes: 0 })).toBeNull();
    expect(changeFromWeekdayPattern({ ...base, matchingDays: 5, movedDays: 4, medianTargetTime: "18:37", targetSpreadMinutes: 0 })?.change.toTime).toBe("18:30");
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
    const first = firstAffectedDate("2026-11-19", ["tuesday"]);
    expect(first).toBe("2026-11-24");
    expect(formatBehaviorChangeLine({ title: "Gym", change: tuesdayToEvening, firstAffectedDate: first }))
      .toBe("Change your schedule: Gym at 6:30 PM every Tuesday from Tuesday, Nov 24 (now 7:00 AM).");
    expect(formatCheckInQuestion({ title: "Gym", change: tuesdayToEvening })).toBe("Keep Gym at 6:30 PM every Tuesday?");
  });

  it("never names today: on the changed weekday the line is held", () => {
    expect(isHeldToday("2026-11-24", ["tuesday"])).toBe(true);
    expect(isHeldToday("2026-11-25", ["tuesday"])).toBe(false);
    expect(firstAffectedDate("2026-11-24", ["tuesday"])).toBe("2026-12-01");
  });

  it("asks on the right day across a clock change, and skips a changed weekday", () => {
    // Try on Sunday Oct 25; clocks go back Nov 1. Fourteen calendar days later is Sunday Nov 8.
    expect(trialCheckInDate("2026-10-25", ["tuesday"])).toBe("2026-11-08");
    // Spring forward Mar 8, 2026: still calendar days.
    expect(trialCheckInDate("2026-02-26", ["thursday"])).toBe("2026-03-13");
    // Fourteen days after a Wednesday is a Wednesday; a Wednesday change asks on Thursday.
    expect(trialCheckInDate("2026-11-18", ["wednesday"])).toBe("2026-12-03");
  });
});

describe("layer-1 rules", () => {
  const behavior = { id: GYM, title: "Gym", active: true, schedules: monTueThu };
  const base = { today: "2026-11-19", behavior, change: tuesdayToEvening, hasOpenProposal: false, declined: [] };

  it("makes no proposal without its signal", () => {
    expect(evaluateBehaviorChangeCandidate({ ...base, evidence: null })).toEqual({ ok: false, reason: "no_evidence" });
    expect(evaluateBehaviorChangeCandidate({ ...base, evidence: repeatedMoveEvidence({ movedDays: 3 }) })).toEqual({ ok: false, reason: "no_evidence" });
    expect(evaluateBehaviorChangeCandidate({ ...base, evidence: repeatedMoveEvidence({ weekday: "monday" }) })).toEqual({ ok: false, reason: "no_evidence" });
    expect(evaluateBehaviorChangeCandidate({ ...base, evidence: repeatedMoveEvidence({ direction: "earlier" }) })).toEqual({ ok: false, reason: "no_evidence" });
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

  it("never proposes an every-day change, which would always touch today", () => {
    const daily = { ...behavior, schedules: [{ recurrence: { frequency: "daily", interval: 1 }, time_entries: [{ kind: "exact", start_time: "07:00" }] }] as ProposalSchedule[] };
    const evidence: BehaviorChangeEvidence = { source: "card", signalKind: "time_of_day_gap", signalIds: [], cardId: "time-of-day.v1", counts: { done: 3 } };
    const everyDay = { weekdays: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const, fromTime: "07:00", toTime: "18:00" };
    expect(evaluateBehaviorChangeCandidate({ ...base, behavior: daily, change: everyDay, evidence })).toEqual({ ok: false, reason: "every_day" });
  });

  it("stores a valid operation input whose wording names the first affected day and the old time", () => {
    const result = evaluateBehaviorChangeCandidate({ ...base, evidence: repeatedMoveEvidence(), reason: "Line one\nline two" });
    if (!result.ok) throw new Error(result.reason);
    expect(result.plan.reason).toBe("You moved it to about 6:30 PM on 4 of the last 5 Tuesdays.");
    const input = toProposeBehaviorChangeInput(result.plan, base.today, null);
    expect(validateProposeBehaviorChangeInput(input)).toEqual({ ok: true, value: input });
    expect(input.first_affected_date).toBe("2026-11-24");
    const line = formatBehaviorChangeLine({ title: "Gym", change: result.plan.change, firstAffectedDate: input.first_affected_date });
    expect(line).toContain("from Tuesday, Nov 24");
    expect(line).toContain("(now 7:00 AM)");
  });

  it("holds the rule over every weekday and time combination it accepts", () => {
    const times = ["06:00", "07:00", "12:30", "18:00", "21:45"];
    for (const weekday of ["monday", "tuesday", "thursday"] as const) {
      for (const toTime of times) {
        const change = { weekdays: [weekday], fromTime: "07:00", toTime };
        const direction = toTime > "07:00" ? "later" : "earlier";
        const result = evaluateBehaviorChangeCandidate({ ...base, change, evidence: repeatedMoveEvidence({ weekday, direction }) });
        if (!result.ok) { expect(toTime).toBe("07:00"); continue; }
        const first = firstAffectedDate(base.today, result.plan.weekdays);
        expect(first > base.today).toBe(true);
        const line = formatBehaviorChangeLine({ title: "Gym", change: result.plan.change, firstAffectedDate: first });
        expect(line).toMatch(/^Change your schedule: Gym at .+ every .+ from \w+day, \w{3} \d{1,2} \(now 7:00 AM\)\.$/);
        expect(result.plan.schedulesAfter.length).toBeLessThanOrEqual(BEHAVIOR_CHANGE_RULES.maxSchedules);
      }
    }
  });
});
