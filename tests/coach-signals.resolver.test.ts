import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";

import {
  resolveCoachSignals,
  type CoachSignalBehavior,
  type CoachSignalDecision,
  type CoachSignalMove,
  type CoachSignalOccurrence,
  type ResolveCoachSignalsInput,
} from "@cadence/core/resolvers/coach-signals.resolver";

// Advisor plan Phase 3, workstream 3D. Expected signals come from hand-counted
// fixtures and the thresholds in the plan, not from the implementation.


// Version 2 added more kinds (tests/coach-signals-v2.resolver.test.ts). These cases pin
// the version 1 kinds only.
const V1_KINDS = new Set(["completion_drop", "repeated_move", "late_marking", "new_behavior_settled", "brief_answers"]);
function resolveV1(value: ResolveCoachSignalsInput) {
  return resolveCoachSignals(value).filter((signal) => V1_KINDS.has(signal.kind));
}

const TODAY = "2026-11-19";
const ZONE = "America/New_York";
const READING: CoachSignalBehavior = { id: "b-reading", createdAt: "2026-08-01T12:00:00Z", timezone: ZONE, active: true };
const GYM: CoachSignalBehavior = { id: "b-gym", createdAt: "2026-08-01T12:00:00Z", timezone: ZONE, active: true };

function day(offset: number): string {
  return Temporal.PlainDate.from(TODAY).add({ days: offset }).toString();
}

function input(overrides: Partial<ResolveCoachSignalsInput>): ResolveCoachSignalsInput {
  return { today: TODAY, behaviors: [READING, GYM], occurrences: [], decisions: [], moves: [], answers: [], ...overrides };
}

function occurrences(behaviorId: string, fromOffset: number, statuses: readonly CoachSignalOccurrence["status"][]): CoachSignalOccurrence[] {
  return statuses.map((status, index) => ({ behaviorId, localDate: day(fromOffset + index), status }));
}

const c = "completed" as const;
const n = "not_completed" as const;
const u = "unresolved" as const;

describe("completion_drop", () => {
  // Baseline: days -42..-15 (28 days). Recent: days -14..-1 (14 days).
  const baseline = occurrences(READING.id, -42, [...Array(10).fill(c), ...Array(2).fill(n)]); // 10/12 = 0.83
  it("fires when the recent rate is 25 points or more below the baseline", () => {
    const recent = occurrences(READING.id, -14, [c, c, c, n, n, n, u]); // 3/6 = 0.5
    const signals = resolveV1(input({ occurrences: [...baseline, ...recent] }));
    expect(signals).toEqual([{
      kind: "completion_drop",
      behaviorId: READING.id,
      facts: {
        recent_days: 14, recent_completed: 3, recent_resolved: 6, recent_unresolved: 1, recent_rate: 0.5,
        baseline_days: 28, baseline_completed: 10, baseline_resolved: 12, baseline_unresolved: 0, baseline_rate: 0.83,
        drop: 0.33,
        recent_period_days: 0, baseline_period_days: 0,
      },
    }]);
  });

  it("stays quiet for a smaller drop, too few recent decisions, or today's outcomes", () => {
    const smallDrop = occurrences(READING.id, -14, [c, c, c, c, n, n]); // 4/6 = 0.67, drop 0.17
    expect(resolveV1(input({ occurrences: [...baseline, ...smallDrop] }))).toEqual([]);
    const fewRecent = occurrences(READING.id, -14, [n, n, n, n, u, u]); // only 4 resolved
    expect(resolveV1(input({ occurrences: [...baseline, ...fewRecent] }))).toEqual([]);
    const todayOnly = [...occurrences(READING.id, -14, [c, c, c, c, c]), ...occurrences(READING.id, 0, [n, n, n, n, n])];
    expect(resolveV1(input({ occurrences: [...baseline, ...todayOnly] }))).toEqual([]);
  });

  it("ignores archived Behaviors", () => {
    const recent = occurrences(READING.id, -14, [n, n, n, n, n, n]);
    const archived = { ...READING, active: false };
    expect(resolveV1(input({ behaviors: [archived], occurrences: [...baseline, ...recent] }))).toEqual([]);
  });
});

describe("Period days in completion_drop (Ticket 372)", () => {
  // Baseline: days -42..-15. Recent: days -14..-1. Reading drops; Gym drops by less than the bar.
  const reading = [
    ...occurrences(READING.id, -42, [...Array(10).fill(c), ...Array(2).fill(n)]), // 10/12 = 0.83
    ...occurrences(READING.id, -14, [c, c, c, n, n, n, u]), // 3/6 = 0.5
  ];
  const gym = [
    ...occurrences(GYM.id, -42, [...Array(10).fill(c), ...Array(2).fill(n)]), // 0.83
    ...occurrences(GYM.id, -14, [c, c, c, c, n, n]), // 0.67, drop 0.17: no signal
  ];
  const dates = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => day(from + index));
  const drops = (periodDates?: readonly string[]) => resolveCoachSignals(input({ occurrences: [...reading, ...gym], ...(periodDates ? { periodDates } : {}) }))
    .filter((signal) => signal.kind === "completion_drop");

  it("counts the Period days in each counting period, and reports 0 when no Period was read", () => {
    // Days -20..-10: six fall in the baseline (-20..-15), five in the recent 14 (-14..-10).
    expect(drops(dates(-20, -10))[0]!.facts).toMatchObject({ recent_period_days: 5, baseline_period_days: 6 });
    expect(drops()[0]!.facts).toMatchObject({ recent_period_days: 0, baseline_period_days: 0 });
    expect(drops([])[0]!.facts).toMatchObject({ recent_period_days: 0, baseline_period_days: 0 });
  });

  it("leaves out today, later days and days before the baseline, and counts a repeated date once", () => {
    const facts = drops([day(-43), day(-42), day(-15), day(-14), day(-14), day(-1), day(0), day(3)])[0]!.facts;
    expect(facts).toMatchObject({ recent_period_days: 2, baseline_period_days: 2 });
  });

  it("puts the same counts on every completion_drop of the visit: a Period covers the whole account", () => {
    const both = [...reading, ...occurrences(GYM.id, -42, [...Array(10).fill(c), ...Array(2).fill(n)]), ...occurrences(GYM.id, -14, [c, n, n, n, n, n])];
    const signals = resolveCoachSignals(input({ occurrences: both, periodDates: dates(-7, -1) })).filter((signal) => signal.kind === "completion_drop");
    expect(signals.map((signal) => [signal.behaviorId, signal.facts.recent_period_days, signal.facts.baseline_period_days]))
      .toEqual([[READING.id, 7, 0], [GYM.id, 7, 0]]);
  });

  it("suppresses, delays and re-thresholds nothing: the emitted signals and every other fact are identical with and without periodDates", () => {
    const base = input({
      occurrences: [...reading, ...gym],
      decisions: Array.from({ length: 6 }, (_, index) => ({ occurrenceId: `d${index}`, behaviorId: READING.id, localDate: day(-10 + index),
        recordedAt: `${day(-8 + index)}T15:00:00Z`, timezone: ZONE })),
      answers: [{ behaviorId: GYM.id, localDate: day(-3), kind: "no" }],
    });
    const without = resolveCoachSignals(base);
    expect(without.some((signal) => signal.kind === "completion_drop")).toBe(true);
    // Every day of both counting periods covered, a Period over only the recent 14 days, and one over only the baseline.
    for (const periodDates of [dates(-42, -1), dates(-14, -1), dates(-42, -15), dates(-60, 5)]) {
      const withPeriods = resolveCoachSignals({ ...base, periodDates });
      const strip = (signals: typeof without) => signals.map((signal) => ({ ...signal,
        facts: Object.fromEntries(Object.entries(signal.facts).filter(([name]) => name !== "recent_period_days" && name !== "baseline_period_days")) }));
      expect(strip(withPeriods)).toEqual(strip(without));
      // Only completion_drop carries the counts; every other kind is the same object for object.
      expect(withPeriods.filter((signal) => signal.kind !== "completion_drop")).toEqual(without.filter((signal) => signal.kind !== "completion_drop"));
      expect(withPeriods.filter((signal) => signal.kind !== "completion_drop").some((signal) => "recent_period_days" in signal.facts)).toBe(false);
    }
  });

  it("cannot put a Period label in facts: the resolver's input type takes local dates only, so no label or note reaches it", () => {
    // `periodDates` is `readonly string[]` of local dates. A Period record does not fit the type.
    const withLabel = { label: "Sick", note: "Flu, stayed in bed", start_on: day(-7), end_on: day(-1) };
    // @ts-expect-error A Period record is not a local date.
    const rejected: NonNullable<ResolveCoachSignalsInput["periodDates"]> = [withLabel];
    expect(rejected).toHaveLength(1);
    const signals = resolveCoachSignals(input({ occurrences: [...reading, ...gym], periodDates: dates(-7, -1) }));
    const drop = signals.find((signal) => signal.kind === "completion_drop")!;
    expect([typeof drop.facts.recent_period_days, typeof drop.facts.baseline_period_days]).toEqual(["number", "number"]);
    const text = JSON.stringify(signals);
    expect(text).not.toContain("Sick");
    expect(text).not.toContain("Flu");
    // No fact holds a covered date either: the two new facts are the only trace of a Period.
    for (const date of dates(-7, -1)) expect(JSON.stringify(drop.facts)).not.toContain(date);
  });
});

describe("repeated_move", () => {
  // Gym is planned at 07:00 New York (12:00Z in November) and moved to the evening.
  function move(occurrenceId: string, offset: number, toUtc: string, extra: Partial<CoachSignalMove> = {}): CoachSignalMove {
    const localDate = day(offset);
    return {
      occurrenceId, behaviorId: GYM.id, localDate, timezone: ZONE, kind: "move", chainPosition: 1,
      fromStartAt: `${localDate}T12:00:00Z`, toStartAt: `${localDate}T${toUtc}:00Z`, toPlanned: false, source: "person", ...extra,
    };
  }

  it("fires when the same Behavior moved the same way on three or more days", () => {
    const moves = [
      move("o1", -9, "23:30"), // Tue Nov 10, 18:30 local, +690 min
      move("o2", -6, "23:00"), // Fri Nov 13, 18:00 local, +660 min
      move("o3", -2, "23:30", { source: "daily_brief" }), // Tue Nov 17, 18:30 local
      move("o4", -1, "11:00"), // 06:00 local, earlier: the one exception
    ];
    const [signal] = resolveV1(input({ moves }));
    expect(signal).toEqual({
      kind: "repeated_move",
      behaviorId: GYM.id,
      facts: {
        window_days: 28, moved_days: 4, same_direction_days: 3, direction: "later",
        median_shift_minutes: 690, median_target_time: "18:30", target_spread_minutes: 30,
        weekdays: [2, 5], by_source: { person: 2, daily_brief: 1 }, last_moved_date: day(-2),
        // Version 2: per-weekday counts over the last five matching weekdays (no Occurrence
        // rows in this fixture, so the moved dates are the matching dates).
        weekday_matching: { 2: 2, 3: 1, 5: 1 }, weekday_later: { 2: 2, 3: 0, 5: 1 }, weekday_earlier: { 2: 0, 3: 1, 5: 0 },
      },
    });
  });

  it("version 2: counts moves on the last 5 matching weekdays, reaching back past 28 days", () => {
    // Gym every Tuesday for five weeks (Oct 20 .. Nov 17), moved later on four of them.
    // Oct 20 is outside the 28-day window but still one of the last five Tuesdays.
    const tuesdays = [-30, -23, -16, -9, -2];
    const rows: CoachSignalOccurrence[] = tuesdays.map((offset) => ({ behaviorId: GYM.id, localDate: day(offset), status: c }));
    const moves = [move("t1", -30, "23:30"), move("t2", -23, "23:30"), move("t4", -9, "23:30"), move("t5", -2, "23:30")];
    const [signal] = resolveV1(input({ occurrences: rows, moves }));
    expect(signal?.kind).toBe("repeated_move");
    expect(signal?.facts).toMatchObject({
      window_days: 28, same_direction_days: 3, direction: "later",
      weekday_matching: { 2: 5 }, weekday_later: { 2: 4 }, weekday_earlier: { 2: 0 },
    });
  });

  it("does not count a move that was undone, and stays quiet below three days", () => {
    const undone: CoachSignalMove[] = [
      move("o3", -2, "23:30"),
      { ...move("o3", -2, "12:00"), kind: "revert", chainPosition: 2, fromStartAt: `${day(-2)}T23:30:00Z`, toPlanned: true },
    ];
    expect(resolveV1(input({ moves: [move("o1", -9, "23:30"), move("o2", -6, "23:00"), ...undone] }))).toEqual([]);
  });

  it("uses the net move of a re-moved Occurrence, from its planned time", () => {
    const removed: CoachSignalMove[] = [
      move("o3", -2, "14:00"),
      { ...move("o3", -2, "23:30"), chainPosition: 2, fromStartAt: `${day(-2)}T14:00:00Z` },
    ];
    const [signal] = resolveV1(input({ moves: [move("o1", -9, "23:30"), move("o2", -6, "23:00"), ...removed] }));
    expect(signal?.facts).toMatchObject({ moved_days: 3, same_direction_days: 3, median_shift_minutes: 690 });
  });

  it("keeps the first move when a second move is undone", () => {
    // 07:00 -> 18:30 (by the person) -> 20:00 (by the brief), then Undo: back at 18:30.
    const partial: CoachSignalMove[] = [
      move("o3", -2, "23:30"),
      { ...move("o3", -2, "01:00"), chainPosition: 2, fromStartAt: `${day(-2)}T23:30:00Z`, toStartAt: `${day(-1)}T01:00:00Z`, source: "daily_brief" },
      { ...move("o3", -2, "23:30"), kind: "revert", chainPosition: 3, fromStartAt: `${day(-1)}T01:00:00Z`, source: "person" },
    ];
    const [signal] = resolveV1(input({ moves: [move("o1", -9, "23:30"), move("o2", -6, "23:00"), ...partial] }));
    expect(signal?.facts).toMatchObject({ moved_days: 3, same_direction_days: 3, median_target_time: "18:30", by_source: { person: 3 } });
  });

  it("stays quiet when moves go both ways", () => {
    const moves = [move("o1", -9, "23:30"), move("o2", -6, "23:30"), move("o3", -4, "23:30"),
      move("o4", -3, "11:00"), move("o5", -2, "11:00")]; // 3 of 5 later is under two thirds
    expect(resolveV1(input({ moves }))).toEqual([]);
  });
});

describe("late_marking", () => {
  function decision(occurrenceId: string, behaviorId: string, offset: number, recordedAt: string): CoachSignalDecision {
    return { occurrenceId, behaviorId, localDate: day(offset), recordedAt, timezone: ZONE };
  }

  it("fires per Behavior when half or more first decisions land on a later day", () => {
    // Reading: 5 decisions, 3 recorded the next day (after local midnight), one two days later.
    const decisions = [
      decision("r1", READING.id, -10, `${day(-9)}T13:00:00Z`),
      decision("r2", READING.id, -8, `${day(-7)}T13:00:00Z`),
      decision("r3", READING.id, -6, `${day(-4)}T13:00:00Z`),
      decision("r4", READING.id, -4, `${day(-4)}T22:00:00Z`), // 17:00 local, same day
      decision("r5", READING.id, -2, `${day(-2)}T23:00:00Z`), // 18:00 local, same day
      // A correction recorded later does not replace the first decision.
      decision("r4", READING.id, -4, `${day(-1)}T13:00:00Z`),
    ];
    expect(resolveV1(input({ decisions }))).toEqual([{
      kind: "late_marking",
      behaviorId: READING.id,
      facts: { window_days: 14, decisions: 5, later_day: 3, late_share: 0.6, median_lag_days: 1 },
    }]);
  });

  it("reads the recorded day in the decision's timezone", () => {
    // 03:30Z is 22:30 the previous evening in New York: same day, not late.
    const decisions = Array.from({ length: 5 }, (_, index) =>
      decision(`r${index}`, READING.id, -10 + index, `${day(-9 + index)}T03:30:00Z`));
    expect(resolveV1(input({ decisions }))).toEqual([]);
  });

  it("adds an account-wide signal across Behaviors", () => {
    const late = Array.from({ length: 4 }, (_, index) => decision(`g${index}`, GYM.id, -12 + index, `${day(-10 + index)}T13:00:00Z`));
    const sameDay = Array.from({ length: 4 }, (_, index) => decision(`r${index}`, READING.id, -12 + index, `${day(-12 + index)}T20:00:00Z`));
    const twoMore = [decision("g9", GYM.id, -3, `${day(-3)}T20:00:00Z`), decision("r9", READING.id, -3, `${day(-3)}T20:00:00Z`)];
    // Gym: 4 of 5 late. Reading: 0 of 5. Account: 4 of 10 = 0.4.
    const signals = resolveV1(input({ decisions: [...late, ...sameDay, ...twoMore] }));
    expect(signals.map((signal) => [signal.behaviorId, signal.facts.later_day, signal.facts.decisions])).toEqual([
      [GYM.id, 4, 5],
      [null, 4, 10],
    ]);
  });
});

describe("new_behavior_settled", () => {
  it("fires from day 14 to day 20 after creation with the first two weeks' counts", () => {
    // Created 2026-11-05 at 09:00 local; today is day 14.
    const fresh: CoachSignalBehavior = { id: "b-new", createdAt: "2026-11-05T14:00:00Z", timezone: ZONE, active: true };
    const rows = occurrences(fresh.id, -14, [c, c, n, c, u, c, c, n, c, c, c, u, c, n, c]); // last one is today
    expect(resolveV1(input({ behaviors: [fresh], occurrences: rows }))).toEqual([{
      kind: "new_behavior_settled",
      behaviorId: fresh.id,
      facts: { age_days: 14, first_days: 14, completed: 9, not_completed: 3, unresolved: 2, completion_rate: 0.75 },
    }]);
  });

  it("stays quiet on day 13 and from day 21", () => {
    for (const createdAt of ["2026-11-06T14:00:00Z", "2026-10-29T14:00:00Z"]) {
      expect(resolveV1(input({ behaviors: [{ id: "b-new", createdAt, timezone: ZONE, active: true }] }))).toEqual([]);
    }
  });
});

describe("brief_answers", () => {
  it("counts answers per Behavior and for the account over 28 days", () => {
    const answers = [
      { behaviorId: GYM.id, localDate: day(-1), kind: "no" as const },
      { behaviorId: GYM.id, localDate: day(-3), kind: "no" as const },
      { behaviorId: GYM.id, localDate: day(-3), kind: "other_time" as const },
      { behaviorId: READING.id, localDate: day(0), kind: "yes" as const },
      { behaviorId: READING.id, localDate: day(-40), kind: "yes" as const }, // outside the window
    ];
    expect(resolveV1(input({ answers }))).toEqual([
      { kind: "brief_answers", behaviorId: GYM.id, facts: {
        window_days: 28, answers: 3, by_kind: { no: 2, other_time: 1 }, answered_days: 2, declined_days: 2, last_answer_date: day(-1),
      } },
      { kind: "brief_answers", behaviorId: READING.id, facts: {
        window_days: 28, answers: 1, by_kind: { yes: 1 }, answered_days: 1, declined_days: 0, last_answer_date: day(0),
      } },
      { kind: "brief_answers", behaviorId: null, facts: {
        window_days: 28, answers: 4, by_kind: { no: 2, other_time: 1, yes: 1 }, answered_days: 3, declined_days: 2, last_answer_date: day(0),
      } },
    ]);
  });

  it("emits nothing before the brief offers moves", () => {
    expect(resolveV1(input({}))).toEqual([]);
  });
});
