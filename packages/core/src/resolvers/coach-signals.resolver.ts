import { Temporal } from "@js-temporal/polyfill";

import { resolveCoachSignalsV2, weekdayMoveCounts } from "./coach-signals-v2.resolver";

/**
 * Coach signals (advisor plan, Phase 3 workstream 3D; "Persistent coach", "How it runs").
 *
 * The nightly coach job computes these with no model call and stores them in shadow:
 * nothing shows them until Phase 4 matches them to advice cards. Each signal names a
 * pattern in the person's own records and carries the counts that back it, so a later
 * quip can state one counted fact ("Reading got done 9 of 10 times before 9 am").
 *
 * Facts hold counts, dates, weekdays and local times of day only. They never hold a
 * title, a note or calendar data. Thresholds are constants here so a test can derive
 * expected signals from hand-checked fixtures, and Phase 4 can tune them in one place.
 *
 * Every counting period ends yesterday: the visit runs in the early morning, so today has no
 * outcomes yet. Move and answer periods include today, because a move made after
 * midnight but before the visit is already a fact.
 */

export const COACH_SIGNAL_VERSION = "coach-signals-2";

export const COACH_SIGNAL_THRESHOLDS = Object.freeze({
  /** Read this many days of Occurrences before today (version 2: eight weeks for dip and recovery). */
  historyDays: 56,
  completionDrop: { recentDays: 14, baselineDays: 28, minRecentResolved: 5, minBaselineResolved: 8, minDrop: 0.25 },
  /**
   * `windowDays` drives the version 1 rule. Version 2 also reads moves over
   * `weekdayLookbackDays` for the per-weekday counts that workstream 4C uses
   * ("4 of the last 5 matching weekdays"), and fires on `weekdayMinSameDirection`.
   */
  repeatedMove: { windowDays: 28, minSameDirectionDays: 3, minShare: 2 / 3, weekdayLookbackDays: 35, weekdayMinSameDirection: 4 },
  lateMarking: {
    windowDays: 14,
    behavior: { minDecisions: 5, minLateShare: 0.5 },
    account: { minDecisions: 10, minLateShare: 0.4 },
  },
  newBehavior: { settledAfterDays: 14, reportForDays: 7 },
  briefAnswers: { windowDays: 28 },
  /** Version 2: decisions, reminders and timed sessions are read over this many days. */
  reminderDecisionDays: 28,
});

const T = COACH_SIGNAL_THRESHOLDS;

export const COACH_SIGNAL_KINDS = [
  // Version 1 (3D).
  "completion_drop",
  "repeated_move",
  "late_marking",
  "new_behavior_settled",
  "brief_answers",
  // Version 2 (4B, ./coach-signals-v2.ts).
  "weekly_numbers",
  "weekday_gap",
  "time_of_day_gap",
  "timing_mode_gap",
  "steady_behavior",
  "never_done",
  "dip_recovery",
  "day_shape",
  "unmarked_items",
  "marking_time",
  "done_together",
  "crowded_hour",
  "setup_gaps",
  // Version 2, added after Emi's review (D8).
  "reminder_response",
  "session_length",
  "moved_vs_unmoved",
  // Behaviors of Opportunity (Task 7, ./coach-signals-v2.ts).
  "opportunity_ready_to_schedule",
] as const;

export type CoachSignalKind = (typeof COACH_SIGNAL_KINDS)[number];

export type CoachSignalFacts = Readonly<Record<string, string | number | boolean | null | readonly number[] | Readonly<Record<string, number>>>>;

export type CoachSignal = Readonly<{
  kind: CoachSignalKind;
  /** Null for an account-wide signal. */
  behaviorId: string | null;
  facts: CoachSignalFacts;
}>;

export type CoachSignalBehavior = Readonly<{
  id: string;
  /** When the Behavior was created (ISO instant). */
  createdAt: string;
  timezone: string;
  /** False for archived or paused Behaviors: they get no signal. */
  active: boolean;
  /** Version 2: has a length the person set (default duration). Undefined when not read. */
  hasLength?: boolean;
  /** Version 2: the length the person set, in minutes. Never a model estimate or a default. */
  lengthMinutes?: number | null;
  /** Version 2: has a Where set (anywhere, home or a place). Undefined when not read. */
  hasPlace?: boolean;
  /** Behaviors of Opportunity: available as an opportunity. Undefined when not read. */
  isOpportunity?: boolean;
  /** Behaviors of Opportunity: has a recurring schedule. False for an unscheduled opportunity Behavior. */
  hasSchedule?: boolean;
}>;

export type CoachSignalOccurrence = Readonly<{
  behaviorId: string;
  localDate: string;
  status: "unresolved" | "completed" | "not_completed";
  /** Version 2 fields. Optional so version 1 fixtures stay valid; a signal that needs one skips rows without it. */
  id?: string;
  /** "exact" = a set time, "range" = a time range. */
  scheduleKind?: "exact" | "range";
  /** The set start time, local "HH:MM" or "HH:MM:SS". Time-of-day facts use this, never the mark time (T3). */
  startTime?: string;
  /** The planned start instant (ISO), before any move. */
  plannedStartAt?: string;
  /** Behaviors of Opportunity: "opportunity" for an added Occurrence. Missing means scheduled. */
  origin?: "scheduled" | "opportunity";
}>;

/** The first explicit decision on an Occurrence (not a correction, not an import). */
export type CoachSignalDecision = Readonly<{
  occurrenceId: string;
  behaviorId: string;
  /** The Occurrence's local date. */
  localDate: string;
  recordedAt: string;
  /** Timezone the decision was recorded in. */
  timezone: string;
}>;

/** One `occurrence_moves` record. */
export type CoachSignalMove = Readonly<{
  occurrenceId: string;
  behaviorId: string;
  localDate: string;
  timezone: string;
  kind: "move" | "revert" | "supersede";
  chainPosition: number;
  /** True when this record put the Occurrence back at its planned time. */
  toPlanned: boolean;
  fromStartAt: string;
  toStartAt: string;
  source: string;
}>;

export type CoachBriefAnswerKind =
  | "yes"
  | "no"
  | "other_time"
  | "already_done"
  | "undo"
  | "never_move";

/** One answer to a brief move line. */
export type CoachSignalAnswer = Readonly<{
  behaviorId: string;
  localDate: string;
  kind: CoachBriefAnswerKind;
}>;

export type ResolveCoachSignalsInput = Readonly<{
  /** The visit's local date in the account's timezone. */
  today: string;
  behaviors: readonly CoachSignalBehavior[];
  occurrences: readonly CoachSignalOccurrence[];
  decisions: readonly CoachSignalDecision[];
  moves: readonly CoachSignalMove[];
  answers: readonly CoachSignalAnswer[];
  /** Version 2: sent reminders (any channel), for `reminder_response`. */
  reminders?: readonly CoachSignalReminder[];
  /** Version 2: timed sessions, for `session_length`. */
  sessions?: readonly CoachSignalSession[];
}>;

/** One reminder that was sent for an Occurrence. */
export type CoachSignalReminder = Readonly<{ occurrenceId: string; sentAt: string }>;

/** One timed session on an Occurrence. Open sessions (no stop) are left out by the reader. */
export type CoachSignalSession = Readonly<{ occurrenceId: string; behaviorId: string; startedAt: string; stoppedAt: string }>;

export function resolveCoachSignals(input: ResolveCoachSignalsInput): CoachSignal[] {
  const active = new Map(input.behaviors.filter((behavior) => behavior.active).map((behavior) => [behavior.id, behavior]));
  return [
    ...completionDrops(input, active),
    ...repeatedMoves(input, active),
    ...lateMarking(input, active),
    ...newBehaviorsSettled(input, active),
    ...briefAnswers(input, active),
    ...resolveCoachSignalsV2(input, active),
  ];
}

// ---------------------------------------------------------------------------

function completionDrops(input: ResolveCoachSignalsInput, active: ReadonlyMap<string, CoachSignalBehavior>): CoachSignal[] {
  const recentStart = addDays(input.today, -T.completionDrop.recentDays);
  const baselineStart = addDays(recentStart, -T.completionDrop.baselineDays);
  const tallies = new Map<string, { recent: Tally; baseline: Tally }>();
  for (const row of input.occurrences) {
    if (!active.has(row.behaviorId) || row.localDate >= input.today || row.localDate < baselineStart) continue;
    const entry = tallies.get(row.behaviorId) ?? { recent: emptyTally(), baseline: emptyTally() };
    count(row.localDate >= recentStart ? entry.recent : entry.baseline, row.status);
    tallies.set(row.behaviorId, entry);
  }
  const signals: CoachSignal[] = [];
  for (const [behaviorId, { recent, baseline }] of tallies) {
    const recentResolved = recent.completed + recent.notCompleted;
    const baselineResolved = baseline.completed + baseline.notCompleted;
    if (recentResolved < T.completionDrop.minRecentResolved || baselineResolved < T.completionDrop.minBaselineResolved) continue;
    const recentRate = recent.completed / recentResolved;
    const baselineRate = baseline.completed / baselineResolved;
    if (baselineRate - recentRate < T.completionDrop.minDrop) continue;
    signals.push({
      kind: "completion_drop",
      behaviorId,
      facts: {
        recent_days: T.completionDrop.recentDays,
        recent_completed: recent.completed,
        recent_resolved: recentResolved,
        recent_unresolved: recent.unresolved,
        recent_rate: round(recentRate),
        baseline_days: T.completionDrop.baselineDays,
        baseline_completed: baseline.completed,
        baseline_resolved: baselineResolved,
        baseline_unresolved: baseline.unresolved,
        baseline_rate: round(baselineRate),
        drop: round(baselineRate - recentRate),
      },
    });
  }
  return signals;
}

// ---------------------------------------------------------------------------

type NetMove = Readonly<{ localDate: string; weekday: number; shiftMinutes: number; targetMinute: number; source: string }>;

/**
 * A Behavior moved the same way on several days. Each Occurrence counts once, by its
 * net move that day: from its planned time to where its latest record left it. An
 * Occurrence that is back at its planned time (Undo of its only move, or a superseded
 * move) counts as not moved. Undoing a second move leaves the first one standing.
 */
function repeatedMoves(input: ResolveCoachSignalsInput, active: ReadonlyMap<string, CoachSignalBehavior>): CoachSignal[] {
  const windowStart = addDays(input.today, -T.repeatedMove.windowDays);
  const lookbackStart = addDays(input.today, -T.repeatedMove.weekdayLookbackDays);
  const chains = new Map<string, CoachSignalMove[]>();
  for (const move of input.moves) {
    if (!active.has(move.behaviorId) || move.localDate < lookbackStart || move.localDate > input.today) continue;
    const chain = chains.get(move.occurrenceId) ?? [];
    chain.push(move);
    chains.set(move.occurrenceId, chain);
  }
  const byBehavior = new Map<string, NetMove[]>();
  for (const chain of chains.values()) {
    chain.sort((a, b) => a.chainPosition - b.chainPosition);
    const first = chain[0]!;
    const latest = chain[chain.length - 1]!;
    if (first.chainPosition !== 1 || latest.kind === "supersede" || latest.toPlanned) continue;
    // The move that put the Occurrence where it is now: the latest record, or, after an
    // Undo, the earlier move it restored.
    const placedBy = [...chain].reverse().find((move) => move.kind === "move" && move.toStartAt === latest.toStartAt) ?? latest;
    const planned = Temporal.Instant.from(first.fromStartAt);
    const target = Temporal.Instant.from(latest.toStartAt);
    const shiftMinutes = Math.round(target.since(planned).total({ unit: "minutes" }));
    if (shiftMinutes === 0) continue;
    const local = target.toZonedDateTimeISO(latest.timezone);
    const moves = byBehavior.get(latest.behaviorId) ?? [];
    moves.push({
      localDate: latest.localDate,
      weekday: Temporal.PlainDate.from(latest.localDate).dayOfWeek,
      shiftMinutes,
      targetMinute: local.hour * 60 + local.minute,
      source: placedBy.source,
    });
    byBehavior.set(latest.behaviorId, moves);
  }
  const signals: CoachSignal[] = [];
  for (const [behaviorId, moves] of byBehavior) {
    // One net move per day: a Behavior with two Occurrences on one day counts that day once,
    // by its larger shift.
    const perDay = new Map<string, NetMove>();
    for (const move of moves) {
      const current = perDay.get(move.localDate);
      if (!current || Math.abs(move.shiftMinutes) > Math.abs(current.shiftMinutes)) perDay.set(move.localDate, move);
    }
    // Version 2: per-weekday counts over the last five matching weekdays (workstream 4C).
    const scheduledDates = input.occurrences.filter((row) => row.behaviorId === behaviorId).map((row) => row.localDate);
    const weekdays = weekdayMoveCounts(input.today, scheduledDates,
      new Map([...perDay].map(([date, move]) => [date, move.shiftMinutes])));
    const weekdayRule = Object.keys(weekdays.weekday_matching).some((day) =>
      Math.max(weekdays.weekday_later[day] ?? 0, weekdays.weekday_earlier[day] ?? 0) >= T.repeatedMove.weekdayMinSameDirection);

    const recent = [...perDay.values()].filter((move) => move.localDate >= windowStart);
    const pick = (days: readonly NetMove[]) => {
      const later = days.filter((move) => move.shiftMinutes > 0);
      const earlier = days.filter((move) => move.shiftMinutes < 0);
      return { days, same: later.length >= earlier.length ? later : earlier, direction: later.length >= earlier.length ? "later" : "earlier" };
    };
    const inPeriod = pick(recent);
    const windowRule = inPeriod.same.length >= T.repeatedMove.minSameDirectionDays
      && inPeriod.same.length / inPeriod.days.length >= T.repeatedMove.minShare;
    if (!windowRule && !weekdayRule) continue;
    // The weekday rule can fire on moves older than 28 days; then the facts
    // describe the whole lookback.
    const basis = windowRule ? inPeriod : pick([...perDay.values()]);
    const windowDays = windowRule ? T.repeatedMove.windowDays : T.repeatedMove.weekdayLookbackDays;
    const { same, days, direction } = basis;
    const targetMedian = median(same.map((move) => move.targetMinute));
    signals.push({
      kind: "repeated_move",
      behaviorId,
      facts: {
        window_days: windowDays,
        moved_days: days.length,
        same_direction_days: same.length,
        direction,
        median_shift_minutes: Math.round(median(same.map((move) => move.shiftMinutes))),
        median_target_time: clockTime(targetMedian),
        target_spread_minutes: Math.max(...same.map((move) => Math.abs(move.targetMinute - targetMedian))),
        weekdays: [...new Set(same.map((move) => move.weekday))].sort((a, b) => a - b),
        by_source: tallyBy(same.map((move) => move.source)),
        last_moved_date: same.map((move) => move.localDate).sort().at(-1)!,
        ...weekdays,
      },
    });
  }
  return signals;
}

// ---------------------------------------------------------------------------

/** Decisions usually recorded on a later local day than the Occurrence's own day. */
function lateMarking(input: ResolveCoachSignalsInput, active: ReadonlyMap<string, CoachSignalBehavior>): CoachSignal[] {
  const windowStart = addDays(input.today, -T.lateMarking.windowDays);
  const firsts = new Map<string, CoachSignalDecision>();
  for (const decision of input.decisions) {
    if (!active.has(decision.behaviorId) || decision.localDate < windowStart || decision.localDate >= input.today) continue;
    const current = firsts.get(decision.occurrenceId);
    if (!current || decision.recordedAt < current.recordedAt) firsts.set(decision.occurrenceId, decision);
  }
  const perBehavior = new Map<string, { decisions: number; late: number; lagDays: number[] }>();
  const account = { decisions: 0, late: 0, lagDays: [] as number[] };
  for (const decision of firsts.values()) {
    const recordedDate = Temporal.Instant.from(decision.recordedAt).toZonedDateTimeISO(decision.timezone).toPlainDate();
    const lagDays = Math.max(0, Temporal.PlainDate.from(decision.localDate).until(recordedDate, { largestUnit: "days" }).days);
    const entry = perBehavior.get(decision.behaviorId) ?? { decisions: 0, late: 0, lagDays: [] };
    for (const tally of [entry, account]) {
      tally.decisions += 1;
      if (lagDays > 0) { tally.late += 1; tally.lagDays.push(lagDays); }
    }
    perBehavior.set(decision.behaviorId, entry);
  }
  const facts = (tally: { decisions: number; late: number; lagDays: number[] }) => ({
    window_days: T.lateMarking.windowDays,
    decisions: tally.decisions,
    later_day: tally.late,
    late_share: round(tally.late / tally.decisions),
    median_lag_days: tally.lagDays.length ? median(tally.lagDays) : 0,
  });
  const signals: CoachSignal[] = [];
  for (const [behaviorId, tally] of perBehavior) {
    if (tally.decisions < T.lateMarking.behavior.minDecisions || tally.late / tally.decisions < T.lateMarking.behavior.minLateShare) continue;
    signals.push({ kind: "late_marking", behaviorId, facts: facts(tally) });
  }
  if (account.decisions >= T.lateMarking.account.minDecisions && account.late / account.decisions >= T.lateMarking.account.minLateShare) {
    signals.push({ kind: "late_marking", behaviorId: null, facts: facts(account) });
  }
  return signals;
}

// ---------------------------------------------------------------------------

/**
 * A Behavior created 14 to 20 days ago: its first two weeks are over. The signal repeats
 * on each of those seven mornings so a missed visit loses nothing; Phase 4's delivery
 * log keeps the coach from saying it twice.
 */
function newBehaviorsSettled(input: ResolveCoachSignalsInput, active: ReadonlyMap<string, CoachSignalBehavior>): CoachSignal[] {
  const signals: CoachSignal[] = [];
  for (const behavior of active.values()) {
    const createdDate = Temporal.Instant.from(behavior.createdAt).toZonedDateTimeISO(behavior.timezone).toPlainDate();
    const ageDays = createdDate.until(Temporal.PlainDate.from(input.today), { largestUnit: "days" }).days;
    if (ageDays < T.newBehavior.settledAfterDays || ageDays >= T.newBehavior.settledAfterDays + T.newBehavior.reportForDays) continue;
    const firstWeeksEnd = createdDate.add({ days: T.newBehavior.settledAfterDays }).toString();
    const tally = emptyTally();
    for (const row of input.occurrences) {
      if (row.behaviorId === behavior.id && row.localDate >= createdDate.toString() && row.localDate < firstWeeksEnd) count(tally, row.status);
    }
    const resolved = tally.completed + tally.notCompleted;
    signals.push({
      kind: "new_behavior_settled",
      behaviorId: behavior.id,
      facts: {
        age_days: ageDays,
        first_days: T.newBehavior.settledAfterDays,
        completed: tally.completed,
        not_completed: tally.notCompleted,
        unresolved: tally.unresolved,
        completion_rate: resolved ? round(tally.completed / resolved) : null,
      },
    });
  }
  return signals;
}

// ---------------------------------------------------------------------------

/** How the person answered the brief's move lines, per Behavior and for the account. */
function briefAnswers(input: ResolveCoachSignalsInput, active: ReadonlyMap<string, CoachSignalBehavior>): CoachSignal[] {
  const windowStart = addDays(input.today, -T.briefAnswers.windowDays);
  const rows = input.answers.filter((answer) => answer.localDate >= windowStart && answer.localDate <= input.today);
  const facts = (answers: readonly CoachSignalAnswer[]) => ({
    window_days: T.briefAnswers.windowDays,
    answers: answers.length,
    by_kind: tallyBy(answers.map((answer) => answer.kind)),
    answered_days: new Set(answers.map((answer) => answer.localDate)).size,
    declined_days: new Set(answers.filter((answer) => answer.kind === "no").map((answer) => answer.localDate)).size,
    last_answer_date: answers.map((answer) => answer.localDate).sort().at(-1) ?? null,
  });
  const perBehavior = new Map<string, CoachSignalAnswer[]>();
  for (const answer of rows) {
    if (!active.has(answer.behaviorId)) continue;
    const list = perBehavior.get(answer.behaviorId) ?? [];
    list.push(answer);
    perBehavior.set(answer.behaviorId, list);
  }
  const signals: CoachSignal[] = [...perBehavior].map(([behaviorId, answers]) => ({ kind: "brief_answers" as const, behaviorId, facts: facts(answers) }));
  if (rows.length > 0) signals.push({ kind: "brief_answers", behaviorId: null, facts: facts(rows) });
  return signals;
}

// ---------------------------------------------------------------------------

type Tally = { completed: number; notCompleted: number; unresolved: number };
const emptyTally = (): Tally => ({ completed: 0, notCompleted: 0, unresolved: 0 });

function count(tally: Tally, status: CoachSignalOccurrence["status"]) {
  if (status === "completed") tally.completed += 1;
  else if (status === "not_completed") tally.notCompleted += 1;
  else tally.unresolved += 1;
}

function tallyBy(values: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const value of values) out[value] = (out[value] ?? 0) + 1;
  return out;
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
