import { Temporal } from "@js-temporal/polyfill";

import { localDayBounds } from "./time.resolver";
import { trackedDurationWins } from "./time-tracking.resolver";
import { noticeText } from "../notices";
import type { CalendarEventPlace } from "./alongside.resolver";

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

/** Plain-language refusal text for every caller (web, brief, chat, MCP), from the notices library. */
export const MOVE_REFUSAL_MESSAGES: Readonly<Record<MoveRefusalReason, string>> = Object.freeze({
  occurrence_not_found: noticeText("move.refused.occurrence-not-found"),
  occurrence_resolved: noticeText("move.refused.occurrence-resolved"),
  not_today: noticeText("move.refused.not-today"),
  revision_changed: noticeText("move.refused.revision-changed"),
  range_behavior: noticeText("move.refused.range-behavior"),
  start_not_on_day: noticeText("move.refused.start-not-on-day"),
  time_passed: noticeText("move.refused.time-passed"),
  no_change: noticeText("move.refused.no-change"),
  nothing_to_undo: noticeText("move.refused.nothing-to-undo"),
  not_latest_move: noticeText("move.refused.not-latest-move"),
  slot_taken: noticeText("move.refused.slot-taken"),
  calendar_busy: noticeText("move.refused.calendar-busy"),
});

export const MOVE_PERSON_REASONS = ["running_late", "conflict", "low_energy", "other"] as const;
export type MovePersonReason = (typeof MOVE_PERSON_REASONS)[number];

export type MoveDurationSource = "behavior_duration" | "logged_average" | "planned_length" | "explicit";

/**
 * The length a moved Occurrence keeps (Ticket 366, D34): the tracked figure once the
 * Behavior has 3 tracked completions, then the intended duration the person set, then
 * the tracked figure from fewer, then the planned length (30 minutes when the plan has
 * none). `logged_average` keeps its stored name; the figure is the Timeline's median
 * (`resolveBehaviorDurationSources`), never a separate per-session measurement.
 */
export function resolveMoveDuration(input: Readonly<{
  behaviorDefaultMinutes: number | null;
  loggedAverageSeconds: number | null;
  /** How many tracked completions the figure rests on. Omitted counts as fewer than 3. */
  loggedSampleCount?: number | null;
  plannedSeconds: number | null;
}>): Readonly<{ seconds: number; source: MoveDurationSource }> {
  const logged = input.loggedAverageSeconds && input.loggedAverageSeconds >= 60
    ? { seconds: Math.min(Math.round(input.loggedAverageSeconds), 86_400), source: "logged_average" as const } : null;
  if (logged && trackedDurationWins(input.loggedSampleCount ?? 0)) return logged;
  if (input.behaviorDefaultMinutes && input.behaviorDefaultMinutes > 0) {
    return { seconds: Math.round(input.behaviorDefaultMinutes * 60), source: "behavior_duration" };
  }
  if (logged) return logged;
  if (input.plannedSeconds && input.plannedSeconds > 0) {
    return { seconds: Math.min(Math.round(input.plannedSeconds), 86_400), source: "planned_length" };
  }
  return { seconds: DEFAULT_MOVE_SECONDS, source: "planned_length" };
}

export type MoveInterval = Readonly<{ start: Temporal.Instant; end: Temporal.Instant }>;
export type MoveOccupant = MoveInterval & Readonly<{ occurrenceId: string }>;
/**
 * `eventPlace` (Ticket 384): the event's coarse place under the same-place rule, set only
 * while `CADENCE_ALONGSIDE` is on and only for this request. Absent: unknown.
 */
export type MoveCalendarBusy = MoveInterval & Readonly<{ ref?: string; eventPlace?: CalendarEventPlace }>;

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

/**
 * Whether a Timeline row offers the person's own "Move for today" and Undo (Phase
 * 2C): today's Unresolved items scheduled at an exact time, with a known revision.
 * The database function enforces the same rules; this only decides what to show.
 */
export function canSelfMoveOccurrence(occurrence: Readonly<{
  localDate: string;
  status: string;
  scheduleKind?: "exact" | "range";
  revision?: string;
}>, todayLocalDate: string): boolean {
  return occurrence.localDate === todayLocalDate && occurrence.status === "unresolved"
    && occurrence.scheduleKind !== "range" && Boolean(occurrence.revision);
}
