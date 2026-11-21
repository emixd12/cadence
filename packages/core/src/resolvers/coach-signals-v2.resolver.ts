import { Temporal } from "@js-temporal/polyfill";

import type {
  CoachSignal,
  CoachSignalBehavior,
  CoachSignalMove,
  CoachSignalOccurrence,
  ResolveCoachSignalsInput,
} from "./coach-signals.resolver";

/**
 * Coach signals version 2 (advisor plan Phase 4, workstream 4B step 1; review decision D1).
 *
 * Thirteen more patterns, computed in code with no model call, so the advisor has
 * something true and new to say on most days. Fact names follow the advice-card
 * contract agreed with workstream 4A (`ADVICE_SIGNAL_FACTS` in
 * `packages/core/src/types/advice-cards.ts`).
 *
 * Rules every signal here follows:
 * - Rates count marks only: done / (done + not done). An unmarked item never counts
 *   as a miss (D5). Only `unmarked_items` looks at unmarked items, and it counts them.
 * - Every counting period ends yesterday. Today has no outcomes yet.
 * - Time of day is the item's set start time, never when it was marked (T3).
 * - At most one row per kind per Behavior, plus at most one account-wide row
 *   (behaviorId null): the table keeps one row per (day, kind, Behavior).
 * - Sample-size floors follow the analysis lanes (`BRIEFING_ANALYSIS_THRESHOLDS`).
 */

export const COACH_SIGNAL_V2_THRESHOLDS = Object.freeze({
  windowDays: 28,
  weeklyNumbers: { priorWeeks: 4, minWeekResolved: 3, minPriorResolved: 8 },
  weekdayGap: {
    behavior: { minResolved: 4, minOtherResolved: 8, minGap: 0.3 },
    account: { minResolved: 6, minOtherResolved: 20, minGap: 0.25 },
  },
  timeOfDayGap: { minResolved: 6, minOtherResolved: 6, minGap: 0.3 },
  timingModeGap: { minResolved: 6, minGap: 0.25 },
  steady: { minResolved: 8, minRate: 0.9 },
  neverDone: { minResolved: 5, maxRate: 0.1 },
  dipRecovery: { weeks: 8, minWeekResolved: 3, minUsualWeeks: 4, minDrop: 0.4, recoveredWithin: 0.15 },
  dayShape: { minMarkedDays: 10, minMissed: 6, badDayShare: 0.2, clusteredShare: 0.6, spreadShare: 0.35 },
  unmarked: { minUnmarked: 5, minOldestDays: 3 },
  markingTime: { account: { minDecisions: 10 }, behavior: { minDecisions: 6 }, minDistinctDates: 5 },
  doneTogether: { minSharedDays: 8, together: 0.85, minMissedDays: 2, onlyWithMaxRate: 0.1, onlyWithMinRate: 0.6, onlyWithMinMissedDays: 3 },
  crowdedHour: { minItemsPerDay: 3, minResolved: 6, minOtherResolved: 10, minGap: 0.15 },
  repeatedMoveWeekday: { matchingDays: 5, lookbackDays: 35 },
  reminderResponse: { quickMinutes: 30, behavior: { minMarked: 6 }, account: { minMarked: 10 } },
  sessionLength: { minSessions: 4, shorterBelow: 0.8, longerAbove: 1.2, maxSessionMinutes: 12 * 60 },
  movedVsUnmoved: { behavior: { minEach: 5 }, account: { minEach: 8 }, minGap: 0.15 },
  opportunityReady: { minCompleted: 3, windowMinutes: 60 },
});

const V = COACH_SIGNAL_V2_THRESHOLDS;

export type PartOfDay = "morning" | "afternoon" | "evening";

/** Morning 04:00 to 11:59, afternoon 12:00 to 16:59, evening otherwise. */
export function partOfDay(minuteOfDay: number): PartOfDay {
  const hour = Math.floor(minuteOfDay / 60);
  if (hour >= 4 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  return "evening";
}

/** Facts about how an account is set up. Computed every visit; first-two-weeks cards use them. */
export type CoachAccountFacts = Readonly<{
  account_age_days: number;
  active_behaviors: number;
  behaviors_with_window: number;
  behaviors_with_set_time: number;
  behaviors_without_length: number;
  behaviors_without_place: number;
  morning_items: number;
  afternoon_items: number;
  evening_items: number;
  max_items_same_hour: number;
  behaviors_created_last_14_days: number;
}>;

export function resolveCoachSignalsV2(input: ResolveCoachSignalsInput, active: ReadonlyMap<string, CoachSignalBehavior>): CoachSignal[] {
  const ctx = context(input, active);
  return [
    ...weeklyNumbers(ctx),
    ...weekdayGap(ctx),
    ...timeOfDayGap(ctx),
    ...timingModeGap(ctx),
    ...steadyAndNeverDone(ctx),
    ...dipRecovery(ctx),
    ...dayShape(ctx),
    ...unmarkedItems(ctx),
    ...markingTime(ctx),
    ...doneTogether(ctx),
    ...crowdedHour(ctx),
    ...setupGaps(ctx),
    ...reminderResponse(ctx),
    ...sessionLength(ctx),
    ...movedVsUnmoved(ctx),
    ...opportunityReadyToSchedule(ctx),
  ];
}

/**
 * Setup facts for the account (4A's `AdviceAccountFacts`). Age counts from the first
 * Behavior ever created, archived ones included; 0 on the first day. Item counts use the
 * most recent day (up to today) each active Behavior was scheduled, so a brand-new account
 * has them on day one.
 */
export function resolveCoachAccountFacts(input: ResolveCoachSignalsInput): CoachAccountFacts {
  const active = input.behaviors.filter((behavior) => behavior.active);
  const today = Temporal.PlainDate.from(input.today);
  const created = input.behaviors.map((b) => Temporal.PlainDate.from(localDateOf(b.createdAt, b.timezone)))
    .sort(Temporal.PlainDate.compare)[0] ?? today;
  const latest = latestDayItems(input.occurrences.filter((row) => row.localDate <= input.today), new Set(active.map((b) => b.id)));
  const parts = { morning: 0, afternoon: 0, evening: 0 };
  const hours = new Map<number, number>();
  let ranged = 0;
  let setTime = 0;
  for (const rows of latest.values()) {
    const first = rows[0]!;
    if (first.scheduleKind === "range") ranged += 1; else setTime += 1;
    for (const row of rows) {
      const minute = startMinute(row);
      if (minute === null) continue;
      parts[partOfDay(minute)] += 1;
      hours.set(Math.floor(minute / 60), (hours.get(Math.floor(minute / 60)) ?? 0) + 1);
    }
  }
  return {
    account_age_days: Math.max(0, created.until(today, { largestUnit: "days" }).days),
    active_behaviors: active.length,
    behaviors_with_window: ranged,
    behaviors_with_set_time: setTime,
    behaviors_without_length: active.filter((b) => b.hasLength === false).length,
    behaviors_without_place: active.filter((b) => b.hasPlace === false).length,
    morning_items: parts.morning,
    afternoon_items: parts.afternoon,
    evening_items: parts.evening,
    max_items_same_hour: Math.max(0, ...hours.values()),
    behaviors_created_last_14_days: active.filter((b) => {
      const date = Temporal.Instant.from(b.createdAt).toZonedDateTimeISO(b.timezone).toPlainDate();
      return date.until(today, { largestUnit: "days" }).days < 14;
    }).length,
  };
}

// ---------------------------------------------------------------------------

type Ctx = Readonly<{
  input: ResolveCoachSignalsInput;
  active: ReadonlyMap<string, CoachSignalBehavior>;
  /** Active Behaviors' rows from the last 28 days, ending yesterday. */
  recent: readonly CoachSignalOccurrence[];
  windowStart: string;
}>;

function context(input: ResolveCoachSignalsInput, active: ReadonlyMap<string, CoachSignalBehavior>): Ctx {
  const windowStart = addDays(input.today, -V.windowDays);
  const recent = input.occurrences.filter((row) => active.has(row.behaviorId) && row.localDate >= windowStart && row.localDate < input.today);
  return { input, active, recent, windowStart };
}

type Tally = { completed: number; notCompleted: number };
const tally = (): Tally => ({ completed: 0, notCompleted: 0 });
const resolved = (t: Tally) => t.completed + t.notCompleted;
const rate = (t: Tally) => (resolved(t) ? round(t.completed / resolved(t)) : null);

function add(t: Tally, status: CoachSignalOccurrence["status"]) {
  if (status === "completed") t.completed += 1;
  else if (status === "not_completed") t.notCompleted += 1;
}

function tallyRows(rows: readonly CoachSignalOccurrence[]): Tally {
  const t = tally();
  for (const row of rows) add(t, row.status);
  return t;
}

function groupBy<K, V>(rows: readonly V[], key: (row: V) => K | null): Map<K, V[]> {
  const out = new Map<K, V[]>();
  for (const row of rows) {
    const k = key(row);
    if (k === null) continue;
    const list = out.get(k);
    if (list) list.push(row); else out.set(k, [row]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Weekly numbers: the last 7 days against the 4 weeks before.

function weeklyNumbers(ctx: Ctx): CoachSignal[] {
  const T = V.weeklyNumbers;
  const weekStart = addDays(ctx.input.today, -7);
  const priorStart = addDays(weekStart, -7 * T.priorWeeks);
  const rows = ctx.input.occurrences.filter((row) => ctx.active.has(row.behaviorId) && row.localDate >= priorStart && row.localDate < ctx.input.today);
  const facts = (list: readonly CoachSignalOccurrence[]) => {
    const week = tallyRows(list.filter((row) => row.localDate >= weekStart));
    const prior = tallyRows(list.filter((row) => row.localDate < weekStart));
    if (resolved(week) < T.minWeekResolved || resolved(prior) < T.minPriorResolved) return null;
    return {
      window_days: 7,
      week_completed: week.completed,
      week_not_completed: week.notCompleted,
      week_rate: rate(week)!,
      prior_weeks: T.priorWeeks,
      prior_rate: rate(prior)!,
      change: round(rate(week)! - rate(prior)!),
    };
  };
  const signals: CoachSignal[] = [];
  for (const [behaviorId, list] of groupBy(rows, (row) => row.behaviorId)) {
    const f = facts(list);
    if (f) signals.push({ kind: "weekly_numbers", behaviorId, facts: f });
  }
  const account = facts(rows);
  if (account) signals.push({ kind: "weekly_numbers", behaviorId: null, facts: account });
  return signals;
}

// ---------------------------------------------------------------------------
// Weekday gap: one weekday much weaker than the rest.

function weekdayGap(ctx: Ctx): CoachSignal[] {
  const find = (rows: readonly CoachSignalOccurrence[], T: { minResolved: number; minOtherResolved: number; minGap: number }) => {
    const byDay = groupBy(rows, (row) => weekday(row.localDate));
    let best: { weekday: number; day: Tally; other: Tally; gap: number } | null = null;
    for (const [day, list] of byDay) {
      const dayTally = tallyRows(list);
      const other = tallyRows(rows.filter((row) => weekday(row.localDate) !== day));
      if (resolved(dayTally) < T.minResolved || resolved(other) < T.minOtherResolved) continue;
      const gap = round(rate(other)! - rate(dayTally)!);
      if (gap < T.minGap) continue;
      if (!best || gap > best.gap || (gap === best.gap && day < best.weekday)) best = { weekday: day, day: dayTally, other, gap };
    }
    return best && {
      window_days: V.windowDays,
      weekday: best.weekday,
      weekday_rate: rate(best.day)!,
      weekday_resolved: resolved(best.day),
      other_rate: rate(best.other)!,
      other_resolved: resolved(best.other),
      gap: best.gap,
    };
  };
  const signals: CoachSignal[] = [];
  for (const [behaviorId, list] of groupBy(ctx.recent, (row) => row.behaviorId)) {
    const facts = find(list, V.weekdayGap.behavior);
    if (facts) signals.push({ kind: "weekday_gap", behaviorId, facts });
  }
  const account = find(ctx.recent, V.weekdayGap.account);
  if (account) signals.push({ kind: "weekday_gap", behaviorId: null, facts: account });
  return signals;
}

// ---------------------------------------------------------------------------
// Time-of-day gap: items set for one part of the day get done less (account-wide).

function timeOfDayGap(ctx: Ctx): CoachSignal[] {
  const T = V.timeOfDayGap;
  const timed = ctx.recent.filter((row) => startMinute(row) !== null);
  const byPart = groupBy(timed, (row) => partOfDay(startMinute(row)!));
  let best: { part: PartOfDay; t: Tally; other: Tally; gap: number } | null = null;
  for (const part of ["morning", "afternoon", "evening"] as const) {
    const t = tallyRows(byPart.get(part) ?? []);
    const other = tallyRows(timed.filter((row) => partOfDay(startMinute(row)!) !== part));
    if (resolved(t) < T.minResolved || resolved(other) < T.minOtherResolved) continue;
    const gap = round(rate(other)! - rate(t)!);
    if (gap >= T.minGap && (!best || gap > best.gap)) best = { part, t, other, gap };
  }
  if (!best) return [];
  return [{
    kind: "time_of_day_gap",
    behaviorId: null,
    facts: {
      window_days: V.windowDays,
      part_of_day: best.part,
      part_rate: rate(best.t)!,
      part_resolved: resolved(best.t),
      other_rate: rate(best.other)!,
      other_resolved: resolved(best.other),
      gap: best.gap,
    },
  }];
}

// ---------------------------------------------------------------------------
// Set time or time range: one way of scheduling works less well (account-wide).

function timingModeGap(ctx: Ctx): CoachSignal[] {
  const T = V.timingModeGap;
  const withKind = ctx.recent.filter((row) => row.scheduleKind !== undefined);
  const windowTally = tallyRows(withKind.filter((row) => row.scheduleKind === "range"));
  const setTally = tallyRows(withKind.filter((row) => row.scheduleKind === "exact"));
  if (resolved(windowTally) < T.minResolved || resolved(setTally) < T.minResolved) return [];
  const gap = round(Math.abs(rate(windowTally)! - rate(setTally)!));
  if (gap < T.minGap) return [];
  return [{
    kind: "timing_mode_gap",
    behaviorId: null,
    facts: {
      window_days: V.windowDays,
      weaker_mode: rate(windowTally)! < rate(setTally)! ? "range" : "set_time",
      window_rate: rate(windowTally)!,
      window_resolved: resolved(windowTally),
      set_time_rate: rate(setTally)!,
      set_time_resolved: resolved(setTally),
      gap,
    },
  }];
}

// ---------------------------------------------------------------------------
// Steady item (90% or more for four weeks) and never done (10% or less).
// Both need a Behavior that existed for the whole 28 days.

function steadyAndNeverDone(ctx: Ctx): CoachSignal[] {
  const signals: CoachSignal[] = [];
  for (const [behaviorId, list] of groupBy(ctx.recent, (row) => row.behaviorId)) {
    const behavior = ctx.active.get(behaviorId)!;
    if (localDateOf(behavior.createdAt, behavior.timezone) > ctx.windowStart) continue;
    const t = tallyRows(list);
    const r = rate(t);
    if (r === null) continue;
    const facts = { window_days: V.windowDays, weeks: V.windowDays / 7, rate: r, completed: t.completed, resolved: resolved(t) };
    if (resolved(t) >= V.steady.minResolved && r >= V.steady.minRate) signals.push({ kind: "steady_behavior", behaviorId, facts });
    else if (resolved(t) >= V.neverDone.minResolved && r <= V.neverDone.maxRate) signals.push({ kind: "never_done", behaviorId, facts });
  }
  return signals;
}

// ---------------------------------------------------------------------------
// Dip and recovery: one or more weeks far below the usual rate, and the return.
// Weeks are 7-day blocks ending yesterday; week 1 is the most recent.

function dipRecovery(ctx: Ctx): CoachSignal[] {
  const T = V.dipRecovery;
  const start = addDays(ctx.input.today, -7 * T.weeks);
  const rows = ctx.input.occurrences.filter((row) => ctx.active.has(row.behaviorId) && row.localDate >= start && row.localDate < ctx.input.today);
  const weekOf = (localDate: string) => Math.floor((Temporal.PlainDate.from(localDate).until(Temporal.PlainDate.from(ctx.input.today)).days - 1) / 7) + 1;
  const find = (list: readonly CoachSignalOccurrence[]) => {
    const weeks = new Map<number, Tally>();
    for (const row of list) {
      const w = weekOf(row.localDate);
      const t = weeks.get(w) ?? tally();
      add(t, row.status);
      weeks.set(w, t);
    }
    const rated = [...weeks].filter(([, t]) => resolved(t) >= T.minWeekResolved).map(([week, t]) => ({ week, rate: rate(t)! }));
    if (rated.length < T.minUsualWeeks + 1) return null;
    const usual = median(rated.map((w) => w.rate));
    const dips = rated.filter((w) => usual - w.rate >= T.minDrop);
    if (dips.length === 0 || dips.length > rated.length / 2) return null;
    const recent = rated.find((w) => w.week === 1);
    if (!recent) return null;
    const lastDipWeek = Math.min(...dips.map((w) => w.week));
    const recovered = lastDipWeek > 1 && usual - recent.rate <= T.recoveredWithin;
    return {
      weeks: T.weeks,
      dip_weeks: dips.length,
      dip_weeks_ago: lastDipWeek,
      dip_rate: round(median(dips.map((w) => w.rate))),
      usual_rate: round(usual),
      recovered,
      recent_rate: recent.rate,
    };
  };
  const signals: CoachSignal[] = [];
  for (const [behaviorId, list] of groupBy(rows, (row) => row.behaviorId)) {
    const facts = find(list);
    if (facts) signals.push({ kind: "dip_recovery", behaviorId, facts });
  }
  const account = find(rows);
  if (account) signals.push({ kind: "dip_recovery", behaviorId: null, facts: account });
  return signals;
}

// ---------------------------------------------------------------------------
// Day shape: do misses cluster on a few bad days, or spread evenly? (account-wide)

function dayShape(ctx: Ctx): CoachSignal[] {
  const T = V.dayShape;
  const days = [...groupBy(ctx.recent, (row) => row.localDate).values()].map(tallyRows).filter((t) => resolved(t) > 0);
  const missed = days.reduce((sum, t) => sum + t.notCompleted, 0);
  if (days.length < T.minMarkedDays || missed < T.minMissed) return [];
  const badDays = Math.max(1, Math.ceil(days.length * T.badDayShare));
  const worst = days.map((t) => t.notCompleted).sort((a, b) => b - a).slice(0, badDays);
  const share = round(worst.reduce((a, b) => a + b, 0) / missed);
  const pattern = share >= T.clusteredShare ? "clustered" : share <= T.spreadShare ? "spread" : null;
  if (!pattern) return [];
  return [{
    kind: "day_shape",
    behaviorId: null,
    facts: { window_days: V.windowDays, pattern, marked_days: days.length, bad_days: badDays, missed_total: missed, miss_share_on_bad_days: share },
  }];
}

// ---------------------------------------------------------------------------
// Unmarked items: how many wait unmarked and how old they are (account-wide).
// This is the one signal about unmarked items; it counts them, it never treats them as misses.

function unmarkedItems(ctx: Ctx): CoachSignal[] {
  const T = V.unmarked;
  const historyStart = addDays(ctx.input.today, -56);
  const rows = ctx.input.occurrences.filter((row) => ctx.active.has(row.behaviorId) && row.status === "unresolved"
    && row.localDate >= historyStart && row.localDate < ctx.input.today);
  if (rows.length === 0) return [];
  const today = Temporal.PlainDate.from(ctx.input.today);
  const ages = rows.map((row) => Temporal.PlainDate.from(row.localDate).until(today).days);
  const oldest = Math.max(...ages);
  if (rows.length < T.minUnmarked && oldest < T.minOldestDays) return [];
  return [{
    kind: "unmarked_items",
    behaviorId: null,
    facts: {
      window_days: 56,
      unmarked: rows.length,
      oldest_days: oldest,
      yesterday: ages.filter((age) => age === 1).length,
      last_7_days: ages.filter((age) => age <= 7).length,
      older: ages.filter((age) => age > 7).length,
    },
  }];
}

// ---------------------------------------------------------------------------
// Marking time: when marks usually happen and how long after the set time.

function markingTime(ctx: Ctx): CoachSignal[] {
  const T = V.markingTime;
  const start = addDays(ctx.input.today, -14);
  const byId = new Map(ctx.input.occurrences.filter((row) => row.id).map((row) => [row.id!, row]));
  const firsts = new Map<string, { behaviorId: string; localDate: string; lagMinutes: number; markMinute: number; sameDay: boolean }>();
  const seen = new Map<string, string>();
  for (const decision of ctx.input.decisions) {
    if (!ctx.active.has(decision.behaviorId) || decision.localDate < start || decision.localDate >= ctx.input.today) continue;
    const occurrence = byId.get(decision.occurrenceId);
    const setAt = occurrence?.plannedStartAt;
    if (!setAt) continue;
    const previous = seen.get(decision.occurrenceId);
    if (previous && previous <= decision.recordedAt) continue;
    seen.set(decision.occurrenceId, decision.recordedAt);
    const marked = Temporal.Instant.from(decision.recordedAt);
    const local = marked.toZonedDateTimeISO(decision.timezone);
    firsts.set(decision.occurrenceId, {
      behaviorId: decision.behaviorId,
      localDate: decision.localDate,
      lagMinutes: Math.round(marked.since(Temporal.Instant.from(setAt)).total({ unit: "minutes" })),
      markMinute: local.hour * 60 + local.minute,
      sameDay: local.toPlainDate().toString() === decision.localDate,
    });
  }
  const facts = (list: readonly { localDate: string; lagMinutes: number; markMinute: number; sameDay: boolean }[]) => ({
    window_days: 14,
    decisions: list.length,
    median_lag_hours: Math.round(median(list.map((item) => item.lagMinutes)) / 6) / 10,
    median_mark_time: clockTime(median(list.map((item) => item.markMinute))),
    same_day_share: round(list.filter((item) => item.sameDay).length / list.length),
  });
  const distinctDates = (list: readonly { localDate: string }[]) => new Set(list.map((item) => item.localDate)).size;
  const all = [...firsts.values()];
  const signals: CoachSignal[] = [];
  for (const [behaviorId, list] of groupBy(all, (item) => item.behaviorId)) {
    if (list.length >= T.behavior.minDecisions && distinctDates(list) >= T.minDistinctDates) {
      signals.push({ kind: "marking_time", behaviorId, facts: facts(list) });
    }
  }
  if (all.length >= T.account.minDecisions && distinctDates(all) >= T.minDistinctDates) {
    signals.push({ kind: "marking_time", behaviorId: null, facts: facts(all) });
  }
  return signals;
}

// ---------------------------------------------------------------------------
// Done together: two Behaviors nearly always done on the same days, or one done
// only when another is. Keeps the strongest pair per Behavior.

function doneTogether(ctx: Ctx): CoachSignal[] {
  const T = V.doneTogether;
  // Per Behavior and day: done if any of that day's items was done, else not done if any was marked.
  const outcomes = new Map<string, Map<string, boolean>>();
  for (const row of ctx.recent) {
    if (row.status === "unresolved") continue;
    const days = outcomes.get(row.behaviorId) ?? new Map<string, boolean>();
    days.set(row.localDate, (days.get(row.localDate) ?? false) || row.status === "completed");
    outcomes.set(row.behaviorId, days);
  }
  type Pair = { a: string; b: string; pattern: "together" | "only_with"; strength: number; facts: Record<string, string | number> };
  const pairs: Pair[] = [];
  const ids = [...outcomes.keys()].sort();
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = 0; j < ids.length; j += 1) {
      if (i === j) continue;
      const a = ids[i]!;
      const b = ids[j]!;
      const aDays = outcomes.get(a)!;
      const bDays = outcomes.get(b)!;
      const shared = [...aDays.keys()].filter((d) => bDays.has(d));
      if (shared.length < T.minSharedDays) continue;
      const both = shared.filter((d) => aDays.get(d) && bDays.get(d)).length;
      const neither = shared.filter((d) => !aDays.get(d) && !bDays.get(d)).length;
      const either = shared.filter((d) => aDays.get(d) || bDays.get(d)).length;
      const facts = { window_days: V.windowDays, other_behavior_id: b, together_days: both, either_days: either, shared_days: shared.length };
      if (i < j) {
        const agreement = (both + neither) / shared.length;
        const missed = shared.length - both;
        if (agreement >= T.together && missed >= T.minMissedDays && both > 0) {
          pairs.push({ a, b, pattern: "together", strength: agreement, facts: { ...facts, pattern: "together", agreement: round(agreement) } });
        }
      }
      // b only when a: b is rarely done on days a is missed, and often done on days a is done.
      const aMissed = shared.filter((d) => !aDays.get(d));
      const aDone = shared.filter((d) => aDays.get(d));
      if (aMissed.length >= T.onlyWithMinMissedDays && aDone.length > 0) {
        const bWhenMissed = aMissed.filter((d) => bDays.get(d)).length / aMissed.length;
        const bWhenDone = aDone.filter((d) => bDays.get(d)).length / aDone.length;
        if (bWhenMissed <= T.onlyWithMaxRate && bWhenDone >= T.onlyWithMinRate) {
          pairs.push({
            a: b, b: a, pattern: "only_with", strength: bWhenDone - bWhenMissed,
            facts: { ...facts, other_behavior_id: a, pattern: "only_with", rate_with: round(bWhenDone), rate_without: round(bWhenMissed) },
          });
        }
      }
    }
  }
  const best = new Map<string, Pair>();
  for (const pair of pairs.sort((x, y) => y.strength - x.strength || x.a.localeCompare(y.a) || x.b.localeCompare(y.b))) {
    if (!best.has(pair.a)) best.set(pair.a, pair);
  }
  return [...best.values()].map((pair) => ({ kind: "done_together" as const, behaviorId: pair.a, facts: pair.facts }));
}

// ---------------------------------------------------------------------------
// Crowded hour: many items set for one hour, with a lower rate there (account-wide).

function crowdedHour(ctx: Ctx): CoachSignal[] {
  const T = V.crowdedHour;
  const timed = ctx.recent.filter((row) => startMinute(row) !== null);
  const hourOf = (row: CoachSignalOccurrence) => Math.floor(startMinute(row)! / 60);
  let best: { hour: number; perDay: number; t: Tally; other: Tally; gap: number } | null = null;
  for (const [hour, list] of groupBy(timed, hourOf)) {
    const days = new Set(list.map((row) => row.localDate)).size;
    const perDay = list.length / days;
    if (perDay < T.minItemsPerDay) continue;
    const t = tallyRows(list);
    const other = tallyRows(timed.filter((row) => hourOf(row) !== hour));
    if (resolved(t) < T.minResolved || resolved(other) < T.minOtherResolved) continue;
    const gap = round(rate(other)! - rate(t)!);
    if (gap >= T.minGap && (!best || gap > best.gap)) best = { hour, perDay, t, other, gap };
  }
  if (!best) return [];
  return [{
    kind: "crowded_hour",
    behaviorId: null,
    facts: {
      window_days: V.windowDays,
      hour: best.hour,
      items_in_hour: Math.round(best.perDay * 10) / 10,
      hour_rate: rate(best.t)!,
      hour_resolved: resolved(best.t),
      other_rate: rate(best.other)!,
      gap: best.gap,
    },
  }];
}

// ---------------------------------------------------------------------------
// Setup gaps: active Behaviors without a length or a place.

function setupGaps(ctx: Ctx): CoachSignal[] {
  const behaviors = [...ctx.active.values()].filter((b) => b.hasLength !== undefined || b.hasPlace !== undefined);
  const signals: CoachSignal[] = [];
  for (const behavior of behaviors) {
    const missingLength = behavior.hasLength === false;
    const missingPlace = behavior.hasPlace === false;
    if (missingLength || missingPlace) {
      signals.push({ kind: "setup_gaps", behaviorId: behavior.id, facts: { missing_length: missingLength, missing_place: missingPlace } });
    }
  }
  const withoutLength = behaviors.filter((b) => b.hasLength === false).length;
  const withoutPlace = behaviors.filter((b) => b.hasPlace === false).length;
  if (withoutLength + withoutPlace > 0) {
    signals.push({
      kind: "setup_gaps",
      behaviorId: null,
      facts: { active_behaviors: behaviors.length, without_length: withoutLength, without_place: withoutPlace },
    });
  }
  return signals;
}

// ---------------------------------------------------------------------------
// Reminder response: marks that come within 30 minutes of a sent reminder against marks
// that come later. Only marked items count (D5): an item never marked is not "ignored".

function reminderResponse(ctx: Ctx): CoachSignal[] {
  const T = V.reminderResponse;
  if (!ctx.input.reminders?.length) return [];
  const byId = new Map(ctx.recent.filter((row) => row.id && row.status !== "unresolved").map((row) => [row.id!, row]));
  const firstMark = new Map<string, string>();
  for (const decision of ctx.input.decisions) {
    const current = firstMark.get(decision.occurrenceId);
    if (!current || decision.recordedAt < current) firstMark.set(decision.occurrenceId, decision.recordedAt);
  }
  const firstReminder = new Map<string, string>();
  for (const reminder of ctx.input.reminders) {
    if (!byId.has(reminder.occurrenceId)) continue;
    const current = firstReminder.get(reminder.occurrenceId);
    if (!current || reminder.sentAt < current) firstReminder.set(reminder.occurrenceId, reminder.sentAt);
  }
  const items: { behaviorId: string; minutes: number; completed: boolean }[] = [];
  for (const [occurrenceId, sentAt] of firstReminder) {
    const markedAt = firstMark.get(occurrenceId);
    if (!markedAt) continue;
    const minutes = Math.round(Temporal.Instant.from(markedAt).since(Temporal.Instant.from(sentAt)).total({ unit: "minutes" }));
    if (minutes < 0) continue; // Marked before the reminder went out: not a response.
    const row = byId.get(occurrenceId)!;
    items.push({ behaviorId: row.behaviorId, minutes, completed: row.status === "completed" });
  }
  const facts = (list: typeof items) => {
    const quick = list.filter((item) => item.minutes <= T.quickMinutes);
    return {
      window_days: V.windowDays,
      reminded_marked: list.length,
      within_30_min: quick.length,
      later: list.length - quick.length,
      quick_share: round(quick.length / list.length),
      median_minutes_after: Math.round(median(list.map((item) => item.minutes))),
    };
  };
  const signals: CoachSignal[] = [];
  for (const [behaviorId, list] of groupBy(items, (item) => item.behaviorId)) {
    if (list.length >= T.behavior.minMarked) signals.push({ kind: "reminder_response", behaviorId, facts: facts(list) });
  }
  if (items.length >= T.account.minMarked) signals.push({ kind: "reminder_response", behaviorId: null, facts: facts(items) });
  return signals;
}

// ---------------------------------------------------------------------------
// Time spent against planned length: timed sessions against the length the person set.
// Only a length the person set counts as planned: never a model estimate or a default (D8).

function sessionLength(ctx: Ctx): CoachSignal[] {
  const T = V.sessionLength;
  if (!ctx.input.sessions?.length) return [];
  const inPeriod = new Map(ctx.recent.filter((row) => row.id).map((row) => [row.id!, row]));
  const minutesByOccurrence = new Map<string, { behaviorId: string; minutes: number }>();
  for (const session of ctx.input.sessions) {
    if (!inPeriod.has(session.occurrenceId)) continue;
    const minutes = Temporal.Instant.from(session.stoppedAt).since(Temporal.Instant.from(session.startedAt)).total({ unit: "minutes" });
    if (!(minutes > 0) || minutes > T.maxSessionMinutes) continue;
    const entry = minutesByOccurrence.get(session.occurrenceId) ?? { behaviorId: session.behaviorId, minutes: 0 };
    entry.minutes += minutes;
    minutesByOccurrence.set(session.occurrenceId, entry);
  }
  const signals: CoachSignal[] = [];
  for (const [behaviorId, list] of groupBy([...minutesByOccurrence.values()], (item) => item.behaviorId)) {
    const planned = ctx.active.get(behaviorId)?.lengthMinutes;
    if (!planned || planned <= 0 || list.length < T.minSessions) continue;
    const ratios = list.map((item) => item.minutes / planned);
    const shorter = ratios.filter((ratio) => ratio < T.shorterBelow).length;
    const longer = ratios.filter((ratio) => ratio > T.longerAbove).length;
    const medianRatio = median(ratios);
    signals.push({
      kind: "session_length",
      behaviorId,
      facts: {
        window_days: V.windowDays,
        sessions: list.length,
        planned_minutes: planned,
        median_minutes: Math.round(median(list.map((item) => item.minutes))),
        shorter,
        longer,
        on_target: list.length - shorter - longer,
        pattern: medianRatio < T.shorterBelow ? "shorter" : medianRatio > T.longerAbove ? "longer" : "on_target",
      },
    });
  }
  return signals;
}

// ---------------------------------------------------------------------------
// Moved against unmoved: items moved for the day get done more or less often than the
// same Behavior left in place. Silent until there are enough marked moved items.

function movedVsUnmoved(ctx: Ctx): CoachSignal[] {
  const T = V.movedVsUnmoved;
  if (ctx.input.moves.length === 0) return [];
  const moved = netMovedOccurrences(ctx.input.moves);
  const marked = ctx.recent.filter((row) => row.id && row.status !== "unresolved");
  const facts = (list: readonly CoachSignalOccurrence[], minEach: number) => {
    const movedRows = tallyRows(list.filter((row) => moved.has(row.id!)));
    const unmovedRows = tallyRows(list.filter((row) => !moved.has(row.id!)));
    if (resolved(movedRows) < minEach || resolved(unmovedRows) < minEach) return null;
    const gap = round(rate(movedRows)! - rate(unmovedRows)!);
    if (Math.abs(gap) < T.minGap) return null;
    return {
      window_days: V.windowDays,
      moved_rate: rate(movedRows)!,
      moved_resolved: resolved(movedRows),
      unmoved_rate: rate(unmovedRows)!,
      unmoved_resolved: resolved(unmovedRows),
      gap,
      pattern: gap > 0 ? "moved_better" : "moved_worse",
    };
  };
  const signals: CoachSignal[] = [];
  for (const [behaviorId, list] of groupBy(marked, (row) => row.behaviorId)) {
    const f = facts(list, T.behavior.minEach);
    if (f) signals.push({ kind: "moved_vs_unmoved", behaviorId, facts: f });
  }
  const account = facts(marked, T.account.minEach);
  if (account) signals.push({ kind: "moved_vs_unmoved", behaviorId: null, facts: account });
  return signals;
}

/** Occurrences whose latest move record leaves them away from their planned time. */
// ---------------------------------------------------------------------------
// Behaviors of Opportunity (Task 7): an unscheduled opportunity Behavior that the person
// added and Completed on the same weekday, within one hour of the same time, at least 3
// times in the last 28 days. Ready for a future "give it a schedule" tip; no card yet.

function opportunityReadyToSchedule(ctx: Ctx): CoachSignal[] {
  const T = V.opportunityReady;
  const signals: CoachSignal[] = [];
  const added = ctx.recent.filter((row) => row.origin === "opportunity" && row.status === "completed");
  for (const [behaviorId, rows] of groupBy(added, (row) => row.behaviorId)) {
    const behavior = ctx.active.get(behaviorId);
    if (!behavior || behavior.isOpportunity !== true || behavior.hasSchedule !== false) continue;
    let best: { weekday: number; minutes: number[] } | null = null;
    for (const [day, list] of groupBy(rows, (row) => weekday(row.localDate))) {
      const minutes = list.map(startMinute).filter((value): value is number => value !== null).sort((a, b) => a - b);
      const cluster = densestWindow(minutes, T.windowMinutes);
      if (cluster.length < T.minCompleted) continue;
      if (!best || cluster.length > best.minutes.length || (cluster.length === best.minutes.length && day < best.weekday)) best = { weekday: day, minutes: cluster };
    }
    if (!best) continue;
    signals.push({
      kind: "opportunity_ready_to_schedule",
      behaviorId,
      facts: {
        weekday: best.weekday,
        completed_count: best.minutes.length,
        usual_time: clockTime(median(best.minutes)),
        earliest_time: clockTime(best.minutes[0]!),
        latest_time: clockTime(best.minutes.at(-1)!),
        window_minutes: T.windowMinutes,
      },
    });
  }
  return signals;
}

/** The largest run of sorted minutes that fits in `width` minutes; the earliest on a tie. */
function densestWindow(sorted: readonly number[], width: number): number[] {
  let best: number[] = [];
  for (let start = 0; start < sorted.length; start += 1) {
    let end = start;
    while (end + 1 < sorted.length && sorted[end + 1]! - sorted[start]! <= width) end += 1;
    if (end - start + 1 > best.length) best = sorted.slice(start, end + 1);
  }
  return best;
}

function netMovedOccurrences(moves: readonly CoachSignalMove[]): Set<string> {
  const latest = new Map<string, CoachSignalMove>();
  for (const move of moves) {
    const current = latest.get(move.occurrenceId);
    if (!current || move.chainPosition > current.chainPosition) latest.set(move.occurrenceId, move);
  }
  return new Set([...latest.values()].filter((move) => move.kind !== "supersede" && !move.toPlanned).map((move) => move.occurrenceId));
}

// ---------------------------------------------------------------------------
// Per-weekday move counts for workstream 4C ("4 of the last 5 matching weekdays").

export type WeekdayMoveCounts = Readonly<{
  weekday_matching: Readonly<Record<string, number>>;
  weekday_later: Readonly<Record<string, number>>;
  weekday_earlier: Readonly<Record<string, number>>;
}>;

/**
 * For each weekday, the last five dates (up to today) the Behavior was scheduled on that
 * weekday, and on how many of them it ended the day moved later or earlier.
 * `netShiftByDate` maps a local date to that day's net shift in minutes.
 */
export function weekdayMoveCounts(today: string, scheduledDates: readonly string[], netShiftByDate: ReadonlyMap<string, number>): WeekdayMoveCounts {
  const matching: Record<string, number> = {};
  const later: Record<string, number> = {};
  const earlier: Record<string, number> = {};
  const lookbackStart = addDays(today, -V.repeatedMoveWeekday.lookbackDays);
  const dates = [...new Set([...scheduledDates, ...netShiftByDate.keys()])]
    .filter((date) => date <= today && date > lookbackStart).sort().reverse();
  for (const [day, list] of groupBy(dates, (date) => weekday(date))) {
    const last = list.slice(0, V.repeatedMoveWeekday.matchingDays);
    const key = String(day);
    matching[key] = last.length;
    later[key] = last.filter((date) => (netShiftByDate.get(date) ?? 0) > 0).length;
    earlier[key] = last.filter((date) => (netShiftByDate.get(date) ?? 0) < 0).length;
  }
  return { weekday_matching: sortKeys(matching), weekday_later: sortKeys(later), weekday_earlier: sortKeys(earlier) };
}

// ---------------------------------------------------------------------------

function latestDayItems(rows: readonly CoachSignalOccurrence[], activeIds: ReadonlySet<string>): Map<string, CoachSignalOccurrence[]> {
  const out = new Map<string, CoachSignalOccurrence[]>();
  for (const [behaviorId, list] of groupBy(rows.filter((row) => activeIds.has(row.behaviorId)), (row) => row.behaviorId)) {
    const lastDate = list.map((row) => row.localDate).sort().at(-1)!;
    out.set(behaviorId, list.filter((row) => row.localDate === lastDate));
  }
  return out;
}

function startMinute(row: CoachSignalOccurrence): number | null {
  const match = row.startTime ? /^(\d{2}):(\d{2})/.exec(row.startTime) : null;
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function weekday(localDate: string): number {
  return Temporal.PlainDate.from(localDate).dayOfWeek;
}

function localDateOf(instant: string, zone: string): string {
  return Temporal.Instant.from(instant).toZonedDateTimeISO(zone).toPlainDate().toString();
}

function addDays(localDate: string, days: number): string {
  return Temporal.PlainDate.from(localDate).add({ days }).toString();
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function clockTime(minuteOfDay: number): string {
  const minute = Math.round(minuteOfDay);
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

function sortKeys(record: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => Number(a) - Number(b)));
}
