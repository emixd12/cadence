import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";

import {
  resolveCoachSignals,
  type CoachSignalBehavior,
  type CoachSignalDecision,
  type CoachSignalKind,
  type CoachSignalOccurrence,
  type ResolveCoachSignalsInput,
} from "@cadence/core/resolvers/coach-signals.resolver";
import { partOfDay, resolveCoachAccountFacts } from "@cadence/core/resolvers/coach-signals-v2.resolver";

// Advisor plan Phase 4, workstream 4B step 1: coach signals version 2. Every expected
// number below is counted by hand from the fixture, not read back from the code.
// Today is Thursday 2026-11-19; the 28-day window is Oct 22 .. Nov 18.

const TODAY = "2026-11-19";
const ZONE = "America/New_York";
const OLD = "2026-08-01T12:00:00Z";
const behavior = (id: string, extra: Partial<CoachSignalBehavior> = {}): CoachSignalBehavior =>
  ({ id, createdAt: OLD, timezone: ZONE, active: true, ...extra });
const A = behavior("b-a");
const B = behavior("b-b");
const C = behavior("b-c");

const c = "completed" as const;
const n = "not_completed" as const;
const u = "unresolved" as const;
type Status = CoachSignalOccurrence["status"];

function day(offset: number): string {
  return Temporal.PlainDate.from(TODAY).add({ days: offset }).toString();
}

let serial = 0;
function row(behaviorId: string, offset: number, status: Status, extra: Partial<CoachSignalOccurrence> = {}): CoachSignalOccurrence {
  serial += 1;
  return { id: `o${serial}`, behaviorId, localDate: day(offset), status, scheduleKind: "exact", startTime: "08:00:00", ...extra };
}

/** One row per day from `from` for each status given. */
function run(behaviorId: string, from: number, statuses: readonly Status[], extra: Partial<CoachSignalOccurrence> = {}) {
  return statuses.map((status, index) => row(behaviorId, from + index, status, extra));
}

function input(overrides: Partial<ResolveCoachSignalsInput>): ResolveCoachSignalsInput {
  return { today: TODAY, behaviors: [A, B, C], occurrences: [], decisions: [], moves: [], answers: [], ...overrides };
}

function only(kind: CoachSignalKind, value: ResolveCoachSignalsInput) {
  return resolveCoachSignals(value).filter((signal) => signal.kind === kind);
}

const repeat = <T,>(value: T, times: number): T[] => Array(times).fill(value);

describe("weekly_numbers", () => {
  it("compares the last 7 days with the 4 weeks before, counting marks only", () => {
    // Prior: days -35..-8 (28 days): 20 done, 6 not done, 2 unmarked -> 20/26 = 0.77.
    const prior = run(A.id, -35, [...repeat(c, 20), ...repeat(n, 6), u, u]);
    // Week: days -7..-1: 3 done, 2 not done, 2 unmarked -> 3/5 = 0.6.
    const week = run(A.id, -7, [c, n, c, u, n, c, u]);
    const [perBehavior, account] = only("weekly_numbers", input({ occurrences: [...prior, ...week] }));
    const facts = { window_days: 7, week_completed: 3, week_not_completed: 2, week_rate: 0.6, prior_weeks: 4, prior_rate: 0.77, change: -0.17 };
    expect(perBehavior).toEqual({ kind: "weekly_numbers", behaviorId: A.id, facts });
    expect(account).toEqual({ kind: "weekly_numbers", behaviorId: null, facts });
  });

  it("stays quiet with fewer than 3 marks this week", () => {
    const prior = run(A.id, -35, repeat(c, 28));
    const week = run(A.id, -7, [c, n, u, u, u, u, u]);
    expect(only("weekly_numbers", input({ occurrences: [...prior, ...week] }))).toEqual([]);
  });
});

describe("weekday_gap", () => {
  it("finds the weakest weekday for a Behavior and for the account", () => {
    // A and B daily for 28 days (Oct 22 Thu .. Nov 18 Wed): each weekday 4 times.
    // Mondays (Oct 26, Nov 2, 9, 16) not done; everything else done.
    const mondaysMissed = (id: string) => run(id, -28, repeat(c, 28)).map((r) =>
      Temporal.PlainDate.from(r.localDate).dayOfWeek === 1 ? { ...r, status: n } : r);
    const signals = only("weekday_gap", input({ occurrences: [...mondaysMissed(A.id), ...mondaysMissed(B.id)] }));
    const facts = { window_days: 28, weekday: 1, weekday_rate: 0, weekday_resolved: 4, other_rate: 1, other_resolved: 24, gap: 1 };
    expect(signals).toEqual([
      { kind: "weekday_gap", behaviorId: A.id, facts },
      { kind: "weekday_gap", behaviorId: B.id, facts },
      // The account needs 6 marks on the weekday: 8 Mondays here.
      { kind: "weekday_gap", behaviorId: null, facts: { ...facts, weekday_resolved: 8, other_resolved: 48 } },
    ]);
  });

  it("ignores unmarked Mondays", () => {
    const rows = run(A.id, -28, repeat(c, 28)).map((r) =>
      Temporal.PlainDate.from(r.localDate).dayOfWeek === 1 ? { ...r, status: u } : r);
    expect(only("weekday_gap", input({ occurrences: rows }))).toEqual([]);
  });
});

describe("time_of_day_gap", () => {
  it("names the part of the day with the lower rate, by set time", () => {
    // Evening items (19:00): 2 of 8 done. Morning items (07:30): 9 of 10 done.
    const evening = run(A.id, -8, [c, c, n, n, n, n, n, n], { startTime: "19:00:00" });
    const morning = run(B.id, -10, [...repeat(c, 9), n], { startTime: "07:30:00" });
    expect(only("time_of_day_gap", input({ occurrences: [...evening, ...morning] }))).toEqual([{
      kind: "time_of_day_gap",
      behaviorId: null,
      facts: { window_days: 28, part_of_day: "evening", part_rate: 0.25, part_resolved: 8, other_rate: 0.9, other_resolved: 10, gap: 0.65 },
    }]);
  });

  it("splits the day at 04:00, 12:00 and 17:00", () => {
    expect([partOfDay(3 * 60 + 59), partOfDay(4 * 60), partOfDay(11 * 60 + 59), partOfDay(12 * 60), partOfDay(16 * 60 + 59), partOfDay(17 * 60)])
      .toEqual(["evening", "morning", "morning", "afternoon", "afternoon", "evening"]);
  });
});

describe("timing_mode_gap", () => {
  it("compares window items with set-time items", () => {
    // Window: 3 of 6 done (0.5). Set time: 7 of 8 done (0.88).
    const window = run(A.id, -6, [c, c, c, n, n, n], { scheduleKind: "range" });
    const set = run(B.id, -8, [...repeat(c, 7), n]);
    expect(only("timing_mode_gap", input({ occurrences: [...window, ...set] }))).toEqual([{
      kind: "timing_mode_gap",
      behaviorId: null,
      facts: { window_days: 28, weaker_mode: "range", window_rate: 0.5, window_resolved: 6, set_time_rate: 0.88, set_time_resolved: 8, gap: 0.38 },
    }]);
  });
});

describe("steady_behavior and never_done", () => {
  it("marks a 90% Behavior steady and a 10% Behavior never done", () => {
    const steady = run(A.id, -28, [...repeat(c, 19), n, ...repeat(u, 8)]); // 19/20 = 0.95
    const never = run(B.id, -10, [...repeat(n, 9), c]); // 1/10 = 0.1
    const signals = resolveCoachSignals(input({ occurrences: [...steady, ...never] }))
      .filter((s) => s.kind === "steady_behavior" || s.kind === "never_done");
    expect(signals).toEqual([
      { kind: "steady_behavior", behaviorId: A.id, facts: { window_days: 28, weeks: 4, rate: 0.95, completed: 19, resolved: 20 } },
      { kind: "never_done", behaviorId: B.id, facts: { window_days: 28, weeks: 4, rate: 0.1, completed: 1, resolved: 10 } },
    ]);
  });

  it("waits until a Behavior is four weeks old", () => {
    const young = behavior("b-young", { createdAt: `${day(-20)}T12:00:00Z` });
    const rows = run(young.id, -20, repeat(c, 20));
    expect(only("steady_behavior", input({ behaviors: [young], occurrences: rows }))).toEqual([]);
  });
});

describe("dip_recovery", () => {
  it("finds a dip two weeks ago and the return to the usual rate", () => {
    // Eight 7-day weeks, week 1 = days -7..-1. 4 marks a week.
    // Weeks 3 and 4 (days -28..-15): 1 of 4 done (0.25). Other weeks: 4 of 4 (1.0).
    const rows: CoachSignalOccurrence[] = [];
    for (let week = 1; week <= 8; week += 1) {
      const start = -7 * week;
      const dip = week === 3 || week === 4;
      rows.push(...run(A.id, start, dip ? [c, n, n, n] : [c, c, c, c]));
    }
    const [signal] = only("dip_recovery", input({ occurrences: rows }));
    expect(signal).toEqual({
      kind: "dip_recovery",
      behaviorId: A.id,
      facts: { weeks: 8, dip_weeks: 2, dip_weeks_ago: 3, dip_rate: 0.25, usual_rate: 1, recovered: true, recent_rate: 1 },
    });
  });
});

describe("day_shape", () => {
  it("calls misses clustered when the worst fifth of days hold most of them", () => {
    // 10 marked days. Two bad days with 4 misses each; one other day with 1 miss.
    // Bad days = ceil(10 * 0.2) = 2, holding 8 of 9 misses = 0.89.
    const rows: CoachSignalOccurrence[] = [];
    for (let offset = -10; offset <= -1; offset += 1) {
      const misses = offset === -9 || offset === -4 ? 4 : offset === -2 ? 1 : 0;
      for (const [index, id] of [A.id, B.id, C.id, "b-d"].entries()) rows.push(row(id, offset, index < misses ? n : c));
    }
    const D = behavior("b-d");
    expect(only("day_shape", input({ behaviors: [A, B, C, D], occurrences: rows }))).toEqual([{
      kind: "day_shape",
      behaviorId: null,
      facts: { window_days: 28, pattern: "clustered", marked_days: 10, bad_days: 2, missed_total: 9, miss_share_on_bad_days: 0.89 },
    }]);
  });
});

describe("unmarked_items", () => {
  it("counts items waiting unmarked and their age, and never counts today", () => {
    const rows = [row(A.id, -1, u), row(A.id, -3, u), row(B.id, -12, u), row(B.id, 0, u), row(C.id, -2, c)];
    expect(only("unmarked_items", input({ occurrences: rows }))).toEqual([{
      kind: "unmarked_items",
      behaviorId: null,
      facts: { window_days: 56, unmarked: 3, oldest_days: 12, yesterday: 1, last_7_days: 2, older: 1 },
    }]);
  });

  it("stays quiet for one or two fresh items", () => {
    expect(only("unmarked_items", input({ occurrences: [row(A.id, -1, u), row(A.id, -2, u)] }))).toEqual([]);
  });
});

describe("marking_time", () => {
  it("reports the median mark time and lag after the set time", () => {
    // Six days of A at 08:00 New York (13:00Z), marked at 11:00 local (16:00Z) = 3 h later,
    // except one marked the next morning at 09:00 local (+25 h).
    const rows = run(A.id, -6, repeat(c, 6), { plannedStartAt: "" }).map((r) => ({ ...r, plannedStartAt: `${r.localDate}T13:00:00Z` }));
    const decisions: CoachSignalDecision[] = rows.map((r, index) => ({
      occurrenceId: r.id!, behaviorId: A.id, localDate: r.localDate, timezone: ZONE,
      recordedAt: index === 0 ? `${day(-5)}T14:00:00Z` : `${r.localDate}T16:00:00Z`,
    }));
    const [signal] = only("marking_time", input({ occurrences: rows, decisions }));
    // Lags: 25, 3, 3, 3, 3, 3 h -> median 3. Mark times: 09:00, 11:00 x5 -> median 11:00.
    expect(signal).toEqual({
      kind: "marking_time",
      behaviorId: A.id,
      facts: { window_days: 14, decisions: 6, median_lag_hours: 3, median_mark_time: "11:00", same_day_share: 0.83 },
    });
  });
});

describe("done_together", () => {
  it("finds two Behaviors done on the same days", () => {
    // 10 shared days. A and B both done on 7, both missed on 3.
    const pattern: Status[] = [c, c, n, c, c, n, c, c, n, c];
    const rows = [...run(A.id, -10, pattern), ...run(B.id, -10, pattern), ...run(C.id, -10, [c, n, c, n, c, n, c, n, c, n])];
    const signals = only("done_together", input({ occurrences: rows }));
    expect(signals).toContainEqual({
      kind: "done_together",
      behaviorId: A.id,
      facts: { window_days: 28, other_behavior_id: B.id, together_days: 7, either_days: 7, shared_days: 10, pattern: "together", agreement: 1 },
    });
  });

  it("finds a Behavior done only when another is", () => {
    // A: done on 6 days, missed on 4. B: done on 5 of A's done days, never on A's missed days.
    const a: Status[] = [c, c, c, c, c, c, n, n, n, n];
    const b: Status[] = [c, c, c, c, c, n, n, n, n, n];
    const signals = only("done_together", input({ behaviors: [A, B], occurrences: [...run(A.id, -10, a), ...run(B.id, -10, b)] }));
    expect(signals).toContainEqual({
      kind: "done_together",
      behaviorId: B.id,
      facts: {
        window_days: 28, other_behavior_id: A.id, together_days: 5, either_days: 6, shared_days: 10,
        pattern: "only_with", rate_with: 0.83, rate_without: 0,
      },
    });
  });
});

describe("crowded_hour", () => {
  it("finds an hour with 3 or more items a day and a lower rate", () => {
    // 07:00 hour: A, B, C every day for 4 days = 3 a day, 6 of 12 done.
    // 18:00: D every day for 12 days, 11 of 12 done.
    const D = behavior("b-d");
    const seven = [A, B, C].flatMap((b) => run(b.id, -4, [c, n, c, n], { startTime: "07:15:00" }));
    const evening = run(D.id, -12, [...repeat(c, 11), n], { startTime: "18:00:00" });
    expect(only("crowded_hour", input({ behaviors: [A, B, C, D], occurrences: [...seven, ...evening] }))).toEqual([{
      kind: "crowded_hour",
      behaviorId: null,
      facts: { window_days: 28, hour: 7, items_in_hour: 3, hour_rate: 0.5, hour_resolved: 12, other_rate: 0.92, gap: 0.42 },
    }]);
  });
});

describe("setup_gaps", () => {
  it("lists Behaviors without a length or a place, and an account total", () => {
    const behaviors = [
      behavior("b-a", { hasLength: false, hasPlace: true }),
      behavior("b-b", { hasLength: true, hasPlace: false }),
      behavior("b-c", { hasLength: true, hasPlace: true }),
    ];
    expect(only("setup_gaps", input({ behaviors }))).toEqual([
      { kind: "setup_gaps", behaviorId: "b-a", facts: { missing_length: true, missing_place: false } },
      { kind: "setup_gaps", behaviorId: "b-b", facts: { missing_length: false, missing_place: true } },
      { kind: "setup_gaps", behaviorId: null, facts: { active_behaviors: 3, without_length: 1, without_place: 1 } },
    ]);
  });
});

describe("account facts", () => {
  it("describes a brand-new account from today's items", () => {
    const fresh = [
      behavior("b-a", { createdAt: `${TODAY}T14:00:00Z`, hasLength: false, hasPlace: false }),
      behavior("b-b", { createdAt: `${TODAY}T14:00:00Z`, hasLength: true, hasPlace: true }),
      behavior("b-c", { createdAt: `${TODAY}T14:00:00Z`, hasLength: true, hasPlace: false }),
    ];
    const rows = [
      row("b-a", 0, u, { startTime: "07:00:00" }),
      row("b-b", 0, u, { startTime: "07:30:00", scheduleKind: "range" }),
      row("b-c", 0, u, { startTime: "20:00:00" }),
    ];
    expect(resolveCoachAccountFacts(input({ behaviors: fresh, occurrences: rows }))).toEqual({
      account_age_days: 0, active_behaviors: 3, behaviors_with_window: 1, behaviors_with_set_time: 2,
      behaviors_without_length: 1, behaviors_without_place: 2, morning_items: 2, afternoon_items: 0, evening_items: 1,
      max_items_same_hour: 2, behaviors_created_last_14_days: 3,
    });
  });
});

describe("rules every version 2 signal follows", () => {
  it("emits at most one row per kind per Behavior, and nothing from today", () => {
    const rows = [A, B, C].flatMap((b) => run(b.id, -56, Array.from({ length: 57 }, (_, i) => (i % 3 === 0 ? n : i % 7 === 0 ? u : c))));
    const signals = resolveCoachSignals(input({ occurrences: rows }));
    const keys = signals.map((s) => `${s.kind}:${s.behaviorId ?? "account"}`);
    expect(new Set(keys).size).toBe(keys.length);
    const todayOnly = [A, B, C].flatMap((b) => [row(b.id, 0, n), row(b.id, 0, n), row(b.id, 0, n)]);
    expect(resolveCoachSignals(input({ occurrences: todayOnly }))).toEqual([]);
  });
});
