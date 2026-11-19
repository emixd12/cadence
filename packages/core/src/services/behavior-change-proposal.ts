import { Temporal } from "@js-temporal/polyfill";

import { schedulesInput, uuid, localTime, type ScheduleInput } from "../integration/domain";
import { array, enumOf, integer, nullable, object, oneOf, literal, optional, string, type Infer } from "../integration/schema";
import { validateAgainstSchema, type ValidationIssue } from "../integration/validate";
import { WEEKDAYS, type Weekday } from "../types/recurrence";
import { formatClockTimeLabel } from "./schedule";

/**
 * Base schedule proposals, "Try for two weeks" (advisor plan Phase 4, workstream 4C).
 *
 * When the person keeps moving the same Behavior the same way on the same weekday, the
 * advisor proposes changing the Behavior's schedule itself, not just today's item. This
 * module holds every rule that needs no database: which patterns qualify, the exact new
 * schedule list (a one-weekday change splits a schedule), the first day it affects, the
 * fixed wording, and the dates of the two-week check-in. The nightly coach job (4B) calls
 * `evaluateBehaviorChangeCandidate`; the answer route calls the rest.
 *
 * Applying never runs here or on the coach's token: a Yes runs the person's own schedule
 * edit (T5), and the Mac receives it through sync.
 *
 * Today's item never moves (T1). A schedule edit applies at once and regenerates
 * today's unresolved future items, so a proposal (and its check-in) is held on any local
 * day whose weekday it changes. The line then always names a later first day.
 */

export const BEHAVIOR_CHANGE_RULES = Object.freeze({
  /** "4 of the last 5 matching weekdays". */
  lookbackMatchingDays: 5,
  minMovedDays: 4,
  /** Moves count as "the same way" when their targets sit within this many minutes of the median. */
  maxTargetSpreadMinutes: 60,
  /** A smaller shift is not worth a schedule change. */
  minShiftMinutes: 30,
  /** The proposed time is the median target rounded to this step. */
  roundToMinutes: 15,
  /** A No for the same Behavior and direction is not asked again for this long. */
  declineCooldownDays: 30,
  /** An unanswered proposal closes after this many days. */
  proposalOpenDays: 7,
  trialDays: 14,
  /** No answer to the check-in within this many days keeps the change. */
  checkInAnswerDays: 7,
  maxSchedules: 6,
  maxReasonLength: 200,
});

const R = BEHAVIOR_CHANGE_RULES;

export const BEHAVIOR_CHANGE_STATUSES = [
  "proposed", "accepted_trial", "accepted", "declined", "kept", "reverted", "expired",
] as const;
export type BehaviorChangeStatus = (typeof BEHAVIOR_CHANGE_STATUSES)[number];

/** Open: blocks a new proposal for the account. */
export const OPEN_BEHAVIOR_CHANGE_STATUSES: readonly BehaviorChangeStatus[] = ["proposed", "accepted_trial"];

export type BehaviorChangeDirection = "later" | "earlier";

/** One schedule as stored on a proposal: the integration contract's schedule input. */
export type ProposalSchedule = ScheduleInput;

/** The change itself: on these weekdays, the exact time `fromTime` becomes `toTime`. */
export type BehaviorChange = Readonly<{
  weekdays: readonly Weekday[];
  fromTime: string;
  toTime: string;
}>;

export const BEHAVIOR_CHANGE_SIGNAL_KINDS = ["repeated_move", "time_of_day_gap", "never_done"] as const;
export type BehaviorChangeSignalKind = (typeof BEHAVIOR_CHANGE_SIGNAL_KINDS)[number];

/**
 * What backs a proposal. A repeated-move proposal carries its own counts. A proposal from
 * a Time-of-day gap or Never done signal must name the advice card that backs it.
 */
export type BehaviorChangeEvidence =
  | Readonly<{
      source: "repeated_move";
      signalIds: readonly number[];
      weekday: Weekday;
      matchingDays: number;
      movedDays: number;
      direction: BehaviorChangeDirection;
      medianTargetTime: string;
      targetSpreadMinutes: number;
    }>
  | Readonly<{
      source: "card";
      signalKind: Exclude<BehaviorChangeSignalKind, "repeated_move">;
      signalIds: readonly number[];
      cardId: string;
      counts: Readonly<Record<string, number>>;
    }>;

// ------------------------------------------------------------- weekday move patterns

/** One planned exact-time item of a Behavior, as the nightly job reads it. */
export type PlannedItem = Readonly<{
  occurrenceId: string;
  behaviorId: string;
  localDate: string;
  /** Planned local start, HH:MM (the schedule snapshot, never the move). */
  startTime: string;
  kind: "exact" | "range";
}>;

/** One `occurrence_moves` record (same fields as the coach signals resolver reads). */
export type PlannedItemMove = Readonly<{
  occurrenceId: string;
  kind: "move" | "revert" | "supersede";
  chainPosition: number;
  toPlanned: boolean;
  toStartAt: string;
  timezone: string;
}>;

/** Per Behavior, weekday and planned time: how the last five such items were moved. */
export type WeekdayMovePattern = Readonly<{
  behaviorId: string;
  weekday: Weekday;
  fromTime: string;
  /** Planned items of this weekday and time considered, newest first, at most five. */
  matchingDays: number;
  /** Of those, moved in `direction`. */
  movedDays: number;
  direction: BehaviorChangeDirection;
  /** Median local time they were moved to, HH:MM. */
  medianTargetTime: string;
  targetSpreadMinutes: number;
  movedDates: readonly string[];
}>;

/**
 * Builds weekday move patterns from planned items and their moves. Only days before
 * `today` count. 4B's signals version 2 stores these as the per-weekday move counts;
 * 4C reads them back (T3). Times of day are the planned time and the moved-to time,
 * never the stored completion time.
 */
export function summarizeWeekdayMoves(input: Readonly<{
  today: string;
  items: readonly PlannedItem[];
  moves: readonly PlannedItemMove[];
}>): WeekdayMovePattern[] {
  const latestMove = new Map<string, PlannedItemMove>();
  for (const move of input.moves) {
    const current = latestMove.get(move.occurrenceId);
    if (!current || move.chainPosition > current.chainPosition) latestMove.set(move.occurrenceId, move);
  }
  const groups = new Map<string, PlannedItem[]>();
  for (const item of input.items) {
    if (item.kind !== "exact" || item.localDate >= input.today) continue;
    const key = `${item.behaviorId}|${weekdayOf(item.localDate)}|${item.startTime.slice(0, 5)}`;
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  const patterns: WeekdayMovePattern[] = [];
  for (const [key, items] of groups) {
    const [behaviorId, weekday, fromTime] = key.split("|") as [string, Weekday, string];
    // One item per date: two items with the same weekday and planned time cannot exist.
    const recent = [...items].sort((a, b) => b.localDate.localeCompare(a.localDate)).slice(0, R.lookbackMatchingDays);
    const planned = minutesOf(fromTime);
    const moved = recent.flatMap((item) => {
      const move = latestMove.get(item.occurrenceId);
      if (!move || move.kind === "revert" || move.toPlanned) return [];
      const target = Temporal.Instant.from(move.toStartAt).toZonedDateTimeISO(move.timezone);
      // A move to another day is not a time-of-day pattern.
      if (target.toPlainDate().toString() !== item.localDate) return [];
      const minute = target.hour * 60 + target.minute;
      return minute === planned ? [] : [{ date: item.localDate, minute }];
    });
    const later = moved.filter((move) => move.minute > planned);
    const earlier = moved.filter((move) => move.minute < planned);
    const same = later.length >= earlier.length ? later : earlier;
    if (same.length === 0) continue;
    const median = medianOf(same.map((move) => move.minute));
    patterns.push({
      behaviorId, weekday, fromTime,
      matchingDays: recent.length,
      movedDays: same.length,
      direction: same === later ? "later" : "earlier",
      medianTargetTime: clock(median),
      targetSpreadMinutes: Math.max(...same.map((move) => Math.abs(move.minute - median))),
      movedDates: same.map((move) => move.date).sort(),
    });
  }
  return patterns.sort((a, b) => a.behaviorId.localeCompare(b.behaviorId)
    || WEEKDAYS.indexOf(a.weekday) - WEEKDAYS.indexOf(b.weekday) || a.fromTime.localeCompare(b.fromTime));
}

/** A pattern strong enough to propose, as a change plus its evidence; otherwise null. */
export function changeFromWeekdayPattern(pattern: WeekdayMovePattern, signalIds: readonly number[] = []):
  Readonly<{ change: BehaviorChange; evidence: BehaviorChangeEvidence }> | null {
  if (pattern.matchingDays < R.lookbackMatchingDays || pattern.movedDays < R.minMovedDays) return null;
  if (pattern.targetSpreadMinutes > R.maxTargetSpreadMinutes) return null;
  const toMinute = roundMinutes(minutesOf(pattern.medianTargetTime), R.roundToMinutes);
  const fromMinute = minutesOf(pattern.fromTime);
  if (Math.abs(toMinute - fromMinute) < R.minShiftMinutes) return null;
  if ((toMinute > fromMinute ? "later" : "earlier") !== pattern.direction) return null;
  return {
    change: { weekdays: [pattern.weekday], fromTime: pattern.fromTime, toTime: clock(toMinute) },
    evidence: {
      source: "repeated_move",
      signalIds,
      weekday: pattern.weekday,
      matchingDays: pattern.matchingDays,
      movedDays: pattern.movedDays,
      direction: pattern.direction,
      medianTargetTime: pattern.medianTargetTime,
      targetSpreadMinutes: pattern.targetSpreadMinutes,
    },
  };
}

// ------------------------------------------------------------- the new schedule list

export type ScheduleChangeResult =
  | Readonly<{ ok: true; schedules: ProposalSchedule[]; weekdays: Weekday[] }>
  | Readonly<{ ok: false; reason: BehaviorChangeSkipReason }>;

/**
 * The exact schedule list after the change (T2). Every schedule that has the exact time
 * `fromTime` on a changed weekday is handled:
 * - all its weekdays change: the time entry changes in place (ids kept);
 * - only some do: those weekdays leave it and form a new weekly schedule with the same
 *   entries, `fromTime` replaced by `toTime`. The old schedule keeps its ids.
 * Only daily-every-day and weekly-every-week schedules can be split; anything else, a range
 * at that time, a time that would collide, or more than six schedules refuses.
 */
export function buildChangedSchedules(schedules: readonly ProposalSchedule[], change: BehaviorChange): ScheduleChangeResult {
  const wanted = new Set(change.weekdays);
  const from = change.fromTime;
  const to = change.toTime;
  if (wanted.size === 0 || from === to) return { ok: false, reason: "no_change" };
  const next: ProposalSchedule[] = [];
  const touched = new Set<Weekday>();
  for (const schedule of schedules) {
    const days = scheduleWeekdays(schedule);
    const hit = schedule.time_entries.find((entry) => entryStart(entry) === from);
    const overlap = days ? days.filter((day) => wanted.has(day)) : null;
    if (!hit || (overlap !== null && overlap.length === 0)) { next.push(clone(schedule)); continue; }
    if (overlap === null) {
      // A schedule we cannot split (every N days, monthly, every N weeks) has this time on
      // a changed weekday only if it can land there; refuse rather than guess.
      return { ok: false, reason: "unsupported_schedule" };
    }
    if (hit.kind !== "exact") return { ok: false, reason: "range_time" };
    for (const day of overlap) touched.add(day);
    const moved = schedule.time_entries.map((entry) => entry === hit ? { ...(entry.id ? { id: entry.id } : {}), kind: "exact" as const, start_time: to } : { ...entry });
    if (overlap.length === days!.length) {
      next.push({ ...clone(schedule), time_entries: moved });
      continue;
    }
    const kept = days!.filter((day) => !wanted.has(day));
    next.push({ ...clone(schedule), recurrence: { frequency: "weekly", interval: 1, days_of_week: kept } });
    next.push({
      recurrence: { frequency: "weekly", interval: 1, days_of_week: overlap },
      time_entries: moved.map(withoutId),
    });
  }
  if (touched.size === 0) return { ok: false, reason: "time_not_scheduled" };
  if (next.length > R.maxSchedules) return { ok: false, reason: "too_many_schedules" };
  if (hasCollision(next)) return { ok: false, reason: "time_collision" };
  return { ok: true, schedules: next, weekdays: WEEKDAYS.filter((day) => touched.has(day)) };
}

/** Same schedules, ignoring ids and the order of schedules, entries and weekdays. */
export function schedulesEqual(left: readonly ProposalSchedule[], right: readonly ProposalSchedule[]): boolean {
  // Key order is not kept: a list read back from jsonb has its keys in jsonb's own order.
  const canon = (list: readonly ProposalSchedule[]) => list.map((schedule) => stableStringify({
    recurrence: canonicalRecurrence(schedule.recurrence),
    entries: schedule.time_entries.map((entry) => stableStringify(withoutId(entry))).sort(),
  })).sort();
  return JSON.stringify(canon(left)) === JSON.stringify(canon(right));
}

/**
 * The list to write for Go back: the stored old schedules, with ids only where that schedule
 * or entry still exists, so the edit keeps lineage where it can and creates the rest.
 */
export function restoreSchedules(old: readonly ProposalSchedule[], current: readonly ProposalSchedule[]): ProposalSchedule[] {
  const scheduleIds = new Set(current.flatMap((schedule) => schedule.id ? [schedule.id] : []));
  const entryIds = new Set(current.flatMap((schedule) => schedule.time_entries.flatMap((entry) => entry.id ? [entry.id] : [])));
  return old.map((schedule) => ({
    ...(schedule.id && scheduleIds.has(schedule.id) ? { id: schedule.id } : {}),
    recurrence: { ...schedule.recurrence } as ProposalSchedule["recurrence"],
    time_entries: schedule.time_entries.map((entry) => entry.id && entryIds.has(entry.id) ? { ...entry } : withoutId(entry)),
  }));
}

// ------------------------------------------------------------- dates

/** The first local date after `today` whose weekday the change touches. */
export function firstAffectedDate(today: string, weekdays: readonly Weekday[]): string {
  if (weekdays.length === 0) throw new RangeError("A change needs at least one weekday.");
  let date = Temporal.PlainDate.from(today).add({ days: 1 });
  while (!weekdays.includes(weekdayOf(date.toString()))) date = date.add({ days: 1 });
  return date.toString();
}

/**
 * True when answering today would move one of today's items: today's weekday is one the
 * change touches. The line and the check-in wait for another day.
 */
export function isHeldToday(today: string, weekdays: readonly Weekday[]): boolean {
  return weekdays.includes(weekdayOf(today));
}

/**
 * The trial's check-in day: fourteen calendar days after the day the person said Try,
 * moved forward past any day the change touches. Calendar-date arithmetic in the person's
 * current timezone, so a clock change or a move to another timezone never shifts it.
 */
export function trialCheckInDate(acceptedLocalDate: string, weekdays: readonly Weekday[]): string {
  let date = Temporal.PlainDate.from(acceptedLocalDate).add({ days: R.trialDays });
  while (weekdays.includes(weekdayOf(date.toString()))) date = date.add({ days: 1 });
  return date.toString();
}

export function addLocalDays(localDate: string, days: number): string {
  return Temporal.PlainDate.from(localDate).add({ days }).toString();
}

// ------------------------------------------------------------- choosing to propose

export type BehaviorChangeSkipReason =
  | "no_evidence"
  | "inactive_behavior"
  | "open_proposal"
  | "declined_recently"
  | "no_change"
  | "every_day"
  | "unsupported_schedule"
  | "range_time"
  | "time_not_scheduled"
  | "time_collision"
  | "too_many_schedules";

export type BehaviorChangeCandidateBehavior = Readonly<{
  id: string;
  title: string;
  active: boolean;
  schedules: readonly ProposalSchedule[];
}>;

/** A past No, as the job reads it. */
export type DeclinedBehaviorChange = Readonly<{ behaviorId: string; direction: BehaviorChangeDirection; declinedOn: string }>;

export type BehaviorChangePlan = Readonly<{
  behaviorId: string;
  change: BehaviorChange;
  direction: BehaviorChangeDirection;
  schedulesBefore: ProposalSchedule[];
  schedulesAfter: ProposalSchedule[];
  /** Weekdays the new list actually changes. */
  weekdays: Weekday[];
  evidence: BehaviorChangeEvidence;
  reason: string;
}>;

/**
 * The 4C rule (T10), called by 4B's nightly job for each candidate. Returns the plan to
 * store with `propose_behavior_change`, or why not. The database checks the account-wide
 * rules again (one open proposal, the 30-day cooldown) under a lock.
 */
export function evaluateBehaviorChangeCandidate(input: Readonly<{
  today: string;
  behavior: BehaviorChangeCandidateBehavior;
  change: BehaviorChange;
  evidence: BehaviorChangeEvidence | null;
  hasOpenProposal: boolean;
  declined: readonly DeclinedBehaviorChange[];
  /** Model-written reason; replaced by the code's own when it breaks the reason rules. */
  reason?: string | null;
}>): Readonly<{ ok: true; plan: BehaviorChangePlan }> | Readonly<{ ok: false; reason: BehaviorChangeSkipReason }> {
  if (!input.evidence || !evidenceMatchesChange(input.evidence, input.change)) return { ok: false, reason: "no_evidence" };
  if (!input.behavior.active) return { ok: false, reason: "inactive_behavior" };
  if (input.hasOpenProposal) return { ok: false, reason: "open_proposal" };
  const direction = directionOf(input.change);
  const since = addLocalDays(input.today, -R.declineCooldownDays);
  if (input.declined.some((no) => no.behaviorId === input.behavior.id && no.direction === direction && no.declinedOn > since)) {
    return { ok: false, reason: "declined_recently" };
  }
  const built = buildChangedSchedules(input.behavior.schedules, input.change);
  if (!built.ok) return built;
  // A change on every weekday would always touch today (see isHeldToday).
  if (built.weekdays.length === 7) return { ok: false, reason: "every_day" };
  return {
    ok: true,
    plan: {
      behaviorId: input.behavior.id,
      change: { ...input.change, weekdays: built.weekdays },
      direction,
      schedulesBefore: input.behavior.schedules.map(clone),
      schedulesAfter: built.schedules,
      weekdays: built.weekdays,
      evidence: input.evidence,
      reason: acceptReason(input.reason) ?? codeReason(input.evidence, input.change),
    },
  };
}

export function directionOf(change: Pick<BehaviorChange, "fromTime" | "toTime">): BehaviorChangeDirection {
  return minutesOf(change.toTime) > minutesOf(change.fromTime) ? "later" : "earlier";
}

function evidenceMatchesChange(evidence: BehaviorChangeEvidence, change: BehaviorChange): boolean {
  if (evidence.signalIds.some((id) => !Number.isSafeInteger(id) || id < 1)) return false;
  if (evidence.source === "card") return evidence.cardId.length > 0;
  return change.weekdays.length === 1 && change.weekdays[0] === evidence.weekday
    && evidence.matchingDays >= R.lookbackMatchingDays && evidence.movedDays >= R.minMovedDays
    && evidence.direction === directionOf(change);
}

// ------------------------------------------------------------- wording (T1)

/**
 * The fixed proposal line. The model writes only the reason, shown under it.
 * "Change your schedule: Gym at 6:30 PM every Tuesday from Tuesday, Nov 24 (now 7:00 AM)."
 */
export function formatBehaviorChangeLine(input: Readonly<{ title: string; change: BehaviorChange; firstAffectedDate: string }>): string {
  return `Change your schedule: ${input.title} at ${formatClockTimeLabel(input.change.toTime)} ${everyDays(input.change.weekdays)}`
    + ` from ${formatLongDate(input.firstAffectedDate)} (now ${formatClockTimeLabel(input.change.fromTime)}).`;
}

export function formatCheckInQuestion(input: Readonly<{ title: string; change: BehaviorChange }>): string {
  return `Keep ${input.title} at ${formatClockTimeLabel(input.change.toTime)} ${everyDays(input.change.weekdays)}?`;
}

/** Shown once when the check-in got no answer for seven days. */
export function formatKeptWithoutAnswer(input: Readonly<{ title: string; change: BehaviorChange }>): string {
  return `${input.title} stays at ${formatClockTimeLabel(input.change.toTime)} ${everyDays(input.change.weekdays)}. You can change it in Behaviors.`;
}

/** Shown once when the person edited the schedule during the trial (T4). */
export function formatEditedDuringTrial(input: Readonly<{ title: string }>): string {
  return `You changed ${input.title}'s schedule during the trial, so it stays as you set it.`;
}

/** One line per schedule, for the before and after view. */
export function describeSchedules(schedules: readonly ProposalSchedule[]): string[] {
  return schedules.map((schedule) => {
    const times = schedule.time_entries.map(entryLabel).join(", ");
    return `${capitalize(recurrenceLabel(schedule.recurrence))} at ${times}`;
  });
}

/** The code's own reason, used when the model's is missing or breaks the rules. */
export function codeReason(evidence: BehaviorChangeEvidence, change: BehaviorChange): string {
  if (evidence.source === "repeated_move") {
    return `You moved it to about ${formatClockTimeLabel(change.toTime)} on ${evidence.movedDays} of the last ${evidence.matchingDays} ${pluralDay(evidence.weekday)}.`;
  }
  return evidence.signalKind === "never_done"
    ? `It rarely gets done at ${formatClockTimeLabel(change.fromTime)}.`
    : `Items at this time of day get done less often for you.`;
}

function acceptReason(reason: string | null | undefined): string | null {
  if (!reason) return null;
  const text = reason.trim();
  if (text.length === 0 || text.length > R.maxReasonLength || /[\r\n]/.test(text)) return null;
  return text;
}

// ------------------------------------------------------------- internal operation

/**
 * `propose_behavior_change`: an internal operation, not listed on MCP yet (plan: it joins
 * MCP once its shape settles). Same schema language as the integration contract, so moving
 * it into INTEGRATION_OPERATIONS later is a registry change only.
 */
export const PROPOSE_BEHAVIOR_CHANGE_OPERATION = Object.freeze({
  name: "propose_behavior_change" as const,
  title: "Propose a Behavior schedule change",
  description:
    "Records a proposal to change one Behavior's schedule on some weekdays from one exact time to another. "
    + "The person answers Try for two weeks, Change for good or No; the change applies only through the person's own edit.",
  input: object({
    behavior_id: uuid("Behavior to change."),
    weekdays: array(enumOf(WEEKDAYS), { minItems: 1, maxItems: 6, uniqueItems: true }),
    from_time: localTime("Exact time the schedule has now on those weekdays."),
    to_time: localTime("Proposed exact time."),
    schedules_before: schedulesInput,
    schedules_after: schedulesInput,
    first_affected_date: string({ format: "date", description: "First local date the change affects." }),
    reason: string({ minLength: 1, maxLength: R.maxReasonLength }),
    evidence: oneOf([
      object({
        source: literal("repeated_move"),
        signal_ids: array(integer({ minimum: 1 }), { maxItems: 20 }),
        weekday: enumOf(WEEKDAYS),
        matching_days: integer({ minimum: 1, maximum: 31 }),
        moved_days: integer({ minimum: 1, maximum: 31 }),
        direction: enumOf(["later", "earlier"] as const),
        median_target_time: localTime(),
        target_spread_minutes: integer({ minimum: 0, maximum: 1440 }),
      }),
      object({
        source: literal("card"),
        signal_kind: enumOf(["time_of_day_gap", "never_done"] as const),
        signal_ids: array(integer({ minimum: 1 }), { maxItems: 20 }),
        card_id: string({ minLength: 1, maxLength: 120, pattern: "^[a-z0-9][a-z0-9._-]*$" }),
        counts: array(object({
          name: string({ pattern: "^[a-z][a-z0-9_]{0,40}$" }),
          value: integer({ minimum: 0, maximum: 100000 }),
        }), { maxItems: 20 }),
      }),
    ]),
    run_id: optional(nullable(uuid())),
  }),
});

export type ProposeBehaviorChangeInput = Infer<typeof PROPOSE_BEHAVIOR_CHANGE_OPERATION.input>;

/** The operation's input for a plan from `evaluateBehaviorChangeCandidate`. */
export function toProposeBehaviorChangeInput(plan: BehaviorChangePlan, today: string, runId: string | null): ProposeBehaviorChangeInput {
  const evidence = plan.evidence;
  return {
    behavior_id: plan.behaviorId,
    weekdays: [...plan.weekdays],
    from_time: plan.change.fromTime,
    to_time: plan.change.toTime,
    schedules_before: plan.schedulesBefore,
    schedules_after: plan.schedulesAfter,
    first_affected_date: firstAffectedDate(today, plan.weekdays),
    reason: plan.reason,
    evidence: evidence.source === "repeated_move"
      ? {
          source: "repeated_move", signal_ids: [...evidence.signalIds], weekday: evidence.weekday,
          matching_days: evidence.matchingDays, moved_days: evidence.movedDays, direction: evidence.direction,
          median_target_time: evidence.medianTargetTime, target_spread_minutes: evidence.targetSpreadMinutes,
        }
      : {
          source: "card", signal_kind: evidence.signalKind, signal_ids: [...evidence.signalIds],
          card_id: evidence.cardId,
          counts: Object.entries(evidence.counts).map(([name, value]) => ({ name, value })),
        },
    run_id: runId,
  };
}

export function validateProposeBehaviorChangeInput(value: unknown):
  { ok: true; value: ProposeBehaviorChangeInput } | { ok: false; issues: ValidationIssue[] } {
  return validateAgainstSchema<ProposeBehaviorChangeInput>(PROPOSE_BEHAVIOR_CHANGE_OPERATION.input.schema, value);
}

// ------------------------------------------------------------- helpers

type Entry = ProposalSchedule["time_entries"][number];

function entryStart(entry: Entry): string | null {
  return "start_time" in entry ? entry.start_time : null;
}

function scheduleWeekdays(schedule: ProposalSchedule): Weekday[] | null {
  const rule = schedule.recurrence;
  if (rule.frequency === "daily" && rule.interval === 1) return [...WEEKDAYS];
  if (rule.frequency === "weekly" && rule.interval === 1) return WEEKDAYS.filter((day) => rule.days_of_week.includes(day));
  return null;
}

function hasCollision(schedules: readonly ProposalSchedule[]): boolean {
  for (const day of WEEKDAYS) {
    const starts = schedules.flatMap((schedule) => {
      const days = scheduleWeekdays(schedule);
      if (days && !days.includes(day)) return [];
      return schedule.time_entries.map((entry) => stableStringify(withoutId(entry)));
    });
    // Schedules we cannot place on a weekday are counted on every weekday: conservative.
    if (new Set(starts).size !== starts.length) return true;
  }
  return false;
}

function canonicalRecurrence(rule: ProposalSchedule["recurrence"]): unknown {
  if (rule.frequency === "weekly") return { ...rule, days_of_week: WEEKDAYS.filter((day) => rule.days_of_week.includes(day)) };
  return rule;
}

/** JSON with object keys sorted, so equal values give equal text whatever their key order. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function withoutId<T extends object>(value: T): T {
  const copy = { ...value } as T & { id?: unknown };
  delete copy.id;
  return copy;
}

function clone(schedule: ProposalSchedule): ProposalSchedule {
  return JSON.parse(JSON.stringify(schedule)) as ProposalSchedule;
}

function recurrenceLabel(rule: ProposalSchedule["recurrence"]): string {
  if (rule.frequency === "daily") return rule.interval === 1 ? "every day" : `every ${rule.interval} days`;
  if (rule.frequency === "interval_days") return `every ${rule.interval_days} days`;
  if (rule.frequency === "monthly") return `monthly on day ${rule.day_of_month}`;
  const days = WEEKDAYS.filter((day) => rule.days_of_week.includes(day)).map(capitalize);
  return `${rule.interval === 1 ? "" : `every ${rule.interval} weeks on `}${joinWords(days)}`;
}

function entryLabel(entry: Entry): string {
  if (entry.kind === "exact") return formatClockTimeLabel(entry.start_time);
  if ("preset" in entry) return capitalize(entry.preset);
  return `${formatClockTimeLabel(entry.start_time)} - ${formatClockTimeLabel(entry.end_time)}`;
}

function everyDays(weekdays: readonly Weekday[]): string {
  const days = WEEKDAYS.filter((day) => weekdays.includes(day));
  return `every ${joinWords(days.map(capitalize))}`;
}

function pluralDay(weekday: Weekday): string {
  return `${capitalize(weekday)}s`;
}

function joinWords(words: readonly string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "Tuesday, Nov 24": weekday and date in the language-neutral form the app uses. */
export function formatLongDate(localDate: string): string {
  const date = Temporal.PlainDate.from(localDate);
  return `${capitalize(weekdayOf(localDate))}, ${MONTHS[date.month - 1]} ${date.day}`;
}

export function weekdayOf(localDate: string): Weekday {
  return WEEKDAYS[Temporal.PlainDate.from(localDate).dayOfWeek - 1]!;
}

function minutesOf(time: string): number {
  const [hour, minute] = time.slice(0, 5).split(":").map(Number);
  return hour! * 60 + minute!;
}

function clock(minutes: number): string {
  const value = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function roundMinutes(minutes: number, step: number): number {
  return Math.min(Math.round(minutes / step) * step, 1440 - step);
}

function medianOf(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
}
