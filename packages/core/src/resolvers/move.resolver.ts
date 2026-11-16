import { Temporal } from "@js-temporal/polyfill";

import { localDayBounds } from "./time.resolver";

/**
 * Per-day moves (advisor plan, Phase 2A): durations, the tap-time free-slot check,
 * refusal wording and schedule-edit collisions. The database functions
 * `move_occurrence_for_day` / `revert_occurrence_move` enforce status, revision,
 * today, range and same-day rules for every caller; this module holds the checks that
 * need durations and the calendar, which the caller has. Rules:
 * docs/DATETIME_STRATEGY.md, "Moves".
 */

/** A move without a known length is assumed to take this long. */
export const DEFAULT_MOVE_SECONDS = 30 * 60;

/** How many alternative times a refusal offers. */
export const MOVE_ALTERNATIVES_LIMIT = 3;

export const MOVE_REFUSAL_REASONS = [
  "occurrence_not_found",
  "occurrence_resolved",
  "not_today",
  "revision_changed",
  "range_behavior",
  "start_not_on_day",
  "time_passed",
  "no_change",
  "nothing_to_undo",
  "not_latest_move",
  "slot_taken",
  "calendar_busy",
] as const;
export type MoveRefusalReason = (typeof MOVE_REFUSAL_REASONS)[number];

/** Plain-language refusal text for every caller (web, brief, chat, MCP). */
export const MOVE_REFUSAL_MESSAGES: Readonly<Record<MoveRefusalReason, string>> = Object.freeze({
  occurrence_not_found: "This Occurrence does not exist in your account.",
  occurrence_resolved: "This is already marked, so it stays where it is.",
  not_today: "Only today's items can be moved.",
  revision_changed: "This changed on another device. Look at its current time before moving it again.",
  range_behavior: "Items scheduled as a time range are not moved.",
  start_not_on_day: "A move keeps the item on today. Pick a start time today.",
  time_passed: "That time has already passed. Pick a later time.",
  no_change: "It is already at that time.",
  nothing_to_undo: "There is no move to undo.",
  not_latest_move: "Only the latest move can be undone.",
  slot_taken: "Something else is already at that time.",
  calendar_busy: "Your calendar is busy at that time.",
});

export const MOVE_PERSON_REASONS = ["running_late", "conflict", "low_energy", "other"] as const;
export type MovePersonReason = (typeof MOVE_PERSON_REASONS)[number];

export type MoveDurationSource = "behavior_duration" | "logged_average" | "planned_length" | "explicit";

/**
 * The length a moved Occurrence keeps: the Behavior's duration, then the person's
 * logged average, then the planned length (30 minutes when the plan has none). A
 * model estimate joins in Phase 3.
 */
export function resolveMoveDuration(input: Readonly<{
  behaviorDefaultMinutes: number | null;
  loggedAverageSeconds: number | null;
  plannedSeconds: number | null;
}>): Readonly<{ seconds: number; source: MoveDurationSource }> {
  if (input.behaviorDefaultMinutes && input.behaviorDefaultMinutes > 0) {
    return { seconds: Math.round(input.behaviorDefaultMinutes * 60), source: "behavior_duration" };
  }
  if (input.loggedAverageSeconds && input.loggedAverageSeconds >= 60) {
    return { seconds: Math.min(Math.round(input.loggedAverageSeconds), 86_400), source: "logged_average" };
  }
  if (input.plannedSeconds && input.plannedSeconds > 0) {
    return { seconds: Math.min(Math.round(input.plannedSeconds), 86_400), source: "planned_length" };
  }
  return { seconds: DEFAULT_MOVE_SECONDS, source: "planned_length" };
}

/** Average length of logged time sessions, or null with fewer than two. */
export function loggedAverageSeconds(sessions: readonly Readonly<{ started_at: string; stopped_at: string | null }>[]): number | null {
  const lengths = sessions.flatMap((session) => {
    if (!session.stopped_at) return [];
    const seconds = Temporal.Instant.from(session.started_at).until(Temporal.Instant.from(session.stopped_at)).total({ unit: "seconds" });
    return seconds >= 60 && seconds <= 86_400 ? [seconds] : [];
  });
  if (lengths.length < 2) return null;
  return lengths.reduce((sum, value) => sum + value, 0) / lengths.length;
}

export type MoveInterval = Readonly<{ start: Temporal.Instant; end: Temporal.Instant }>;
export type MoveOccupant = MoveInterval & Readonly<{ occurrenceId: string }>;
export type MoveCalendarBusy = MoveInterval & Readonly<{ ref?: string }>;

export type MoveSlotCheck =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; reason: "slot_taken"; occurrenceId: string }>
  | Readonly<{ ok: false; reason: "calendar_busy"; ref: string | null }>;

/**
 * Is `[start, end)` free? Other Occurrences are checked at their effective times;
 * calendar events only when the caller has them (the web Timeline and the Daily Brief
 * hold today's events; MCP callers do not, and the server keeps no calendar copy).
 */
export function checkMoveSlot(input: Readonly<{
  occurrenceId: string;
  interval: MoveInterval;
  others: readonly MoveOccupant[];
  calendarBusy?: readonly MoveCalendarBusy[];
}>): MoveSlotCheck {
  const blocker = input.others.find((other) => other.occurrenceId !== input.occurrenceId && overlaps(input.interval, other));
  if (blocker) return { ok: false, reason: "slot_taken", occurrenceId: blocker.occurrenceId };
  const busy = (input.calendarBusy ?? []).find((event) => overlaps(input.interval, event));
  if (busy) return { ok: false, reason: "calendar_busy", ref: busy.ref ?? null };
  return { ok: true };
}

/**
 * After a schedule edit, today's moved Occurrences whose moved time now collides
 * with another Unresolved Occurrence. One entry per moved Occurrence, naming the
 * earliest collision. The server records these as move_conflict notices.
 */
export function findMoveConflicts(occurrences: readonly Readonly<{
  id: string;
  status: string;
  moved: boolean;
  interval: MoveInterval;
}>[]): Readonly<{ occurrence_id: string; conflicting_occurrence_id: string }>[] {
  const open = occurrences.filter((occurrence) => occurrence.status === "unresolved");
  return open
    .filter((occurrence) => occurrence.moved)
    .flatMap((moved) => {
      const collision = open
        .filter((other) => other.id !== moved.id && overlaps(moved.interval, other.interval))
        .sort((left, right) => Temporal.Instant.compare(left.interval.start, right.interval.start) || left.id.localeCompare(right.id))[0];
      return collision ? [{ occurrence_id: moved.id, conflicting_occurrence_id: collision.id }] : [];
    })
    .sort((left, right) => left.occurrence_id.localeCompare(right.occurrence_id));
}

/**
 * Up to three free start times on the Occurrence's day, nearest the requested time
 * first, for a refusal to offer. Starts are rounded up to five minutes, not before
 * `now`, and leave room for the duration; a late start may end after midnight.
 */
export function moveAlternatives(input: Readonly<{
  localDate: string;
  timezone: string;
  requestedStart: Temporal.Instant;
  durationSeconds: number;
  now: Temporal.Instant;
  blocks: readonly MoveInterval[];
  limit?: number;
}>): Temporal.Instant[] {
  const limit = input.limit ?? MOVE_ALTERNATIVES_LIMIT;
  const day = localDayBounds(input.localDate, input.timezone);
  const step = 5 * 60;
  const earliest = roundUp(later(day.start, input.now), step);
  const candidates: Temporal.Instant[] = [];
  for (let start = earliest; Temporal.Instant.compare(start, day.end) < 0; start = start.add({ seconds: step })) {
    const interval = { start, end: start.add({ seconds: input.durationSeconds }) };
    if (!input.blocks.some((block) => overlaps(interval, block))) candidates.push(start);
  }
  const distance = (value: Temporal.Instant) => Math.abs(value.since(input.requestedStart).total({ unit: "seconds" }));
  // One candidate per free gap, the start nearest the request, so options are distinct.
  const gaps: Temporal.Instant[][] = [];
  for (const candidate of candidates) {
    const last = gaps.at(-1)?.at(-1);
    if (last && candidate.since(last).total({ unit: "seconds" }) === step) gaps.at(-1)!.push(candidate);
    else gaps.push([candidate]);
  }
  return gaps
    .map((gap) => [...gap].sort((left, right) => distance(left) - distance(right))[0]!)
    .filter((start) => !start.equals(input.requestedStart))
    .sort((left, right) => distance(left) - distance(right) || Temporal.Instant.compare(left, right))
    .slice(0, limit)
    .sort(Temporal.Instant.compare);
}

function overlaps(left: MoveInterval, right: MoveInterval): boolean {
  if (left.start.equals(left.end) || right.start.equals(right.end)) {
    return Temporal.Instant.compare(left.start, right.end) < 0 && Temporal.Instant.compare(right.start, left.end) < 0
      || left.start.equals(right.start);
  }
  return Temporal.Instant.compare(left.start, right.end) < 0 && Temporal.Instant.compare(right.start, left.end) < 0;
}

function later(left: Temporal.Instant, right: Temporal.Instant): Temporal.Instant {
  return Temporal.Instant.compare(left, right) >= 0 ? left : right;
}

function roundUp(value: Temporal.Instant, seconds: number): Temporal.Instant {
  const epoch = value.epochMilliseconds;
  const unit = seconds * 1000;
  return Temporal.Instant.fromEpochMilliseconds(Math.ceil(epoch / unit) * unit);
}
