import { Temporal } from "@js-temporal/polyfill";

import { zonedInstant } from "./time.resolver";

/**
 * Ended and Paused Behaviors (docs/RECURRENCE_RULES.md, "Behavior end and pause").
 *
 * A Behavior stores its end and its pause as local days and optional local times,
 * never as instants: a Settings timezone change moves every active Behavior, and an
 * ended or paused Behavior is still active. The run state is worked out here from
 * those fields and an injected "now"; nothing is stored when a moment arrives.
 *
 * - End: `end_on` is the last local day the Behavior runs. With `end_time` it stops at
 *   that local time; without one it stops at the end of that day.
 * - Pause: from `pause_from_on` (at `pause_from_time`, or the start of that day) until
 *   the start of `pause_back_on`, the day it comes back by itself.
 *
 * Local times use the "compatible" rule (docs/DATETIME_STRATEGY.md): a time skipped by
 * a spring-forward transition moves to the next valid time, a repeated time takes the
 * earlier instant, and a day with no midnight starts at its first valid minute.
 */

export type BehaviorRunFields = Readonly<{
  active: boolean;
  timezone: string;
  endOn: string | null;
  endTime: string | null;
  pauseFromOn: string | null;
  pauseFromTime: string | null;
  pauseBackOn: string | null;
}>;

/** Snake-case stored row fields, as hosted rows, sync rows and BehaviorLog carry them. */
export type StoredBehaviorRunFields = Readonly<{
  active: boolean;
  timezone: string;
  end_on?: string | null;
  end_time?: string | null;
  pause_from_on?: string | null;
  pause_from_time?: string | null;
  pause_back_on?: string | null;
}>;

export type BehaviorRunStateKind = "running" | "ended" | "paused" | "archived";

export type BehaviorRunState = Readonly<{
  state: BehaviorRunStateKind;
  /** The instant the Behavior stops, when it has an end (past or future). */
  endsAt: string | null;
  /** The instant the current or upcoming pause starts. Null when no pause is set or it is over. */
  pauseStartsAt: string | null;
  /** The local day a current or upcoming pause comes back. Null when no pause is set or it is over. */
  backOn: string | null;
}>;

export type BehaviorPause = Readonly<{ fromOn: string; fromTime: string | null; backOn: string }>;

export function runFieldsFromStored(behavior: StoredBehaviorRunFields): BehaviorRunFields {
  return {
    active: behavior.active,
    timezone: behavior.timezone,
    endOn: behavior.end_on ?? null,
    endTime: behavior.end_time ? normalizeRunTime(behavior.end_time) : null,
    pauseFromOn: behavior.pause_from_on ?? null,
    pauseFromTime: behavior.pause_from_time ? normalizeRunTime(behavior.pause_from_time) : null,
    pauseBackOn: behavior.pause_back_on ?? null,
  };
}

/** The instant a Behavior stops running, or null when it has no end. */
export function behaviorEndInstant(fields: Pick<BehaviorRunFields, "endOn" | "endTime" | "timezone">): Temporal.Instant | null {
  if (!fields.endOn) return null;
  if (fields.endTime) return zonedInstant(fields.endOn, fields.endTime, fields.timezone);
  return startOfLocalDay(Temporal.PlainDate.from(fields.endOn).add({ days: 1 }).toString(), fields.timezone);
}

/** The pause as instants `[start, back)`, or null when no pause is set. */
export function behaviorPauseInterval(
  fields: Pick<BehaviorRunFields, "pauseFromOn" | "pauseFromTime" | "pauseBackOn" | "timezone">,
): Readonly<{ start: Temporal.Instant; back: Temporal.Instant }> | null {
  if (!fields.pauseFromOn || !fields.pauseBackOn) return null;
  const start = fields.pauseFromTime
    ? zonedInstant(fields.pauseFromOn, fields.pauseFromTime, fields.timezone)
    : startOfLocalDay(fields.pauseFromOn, fields.timezone);
  return { start, back: startOfLocalDay(fields.pauseBackOn, fields.timezone) };
}

/**
 * Running, ended, paused or archived at `now`. Archive wins; an end that has
 * passed wins over a pause.
 */
export function behaviorRunState(fields: BehaviorRunFields, now: Temporal.Instant): BehaviorRunState {
  const end = behaviorEndInstant(fields);
  const pause = behaviorPauseInterval(fields);
  const pauseRelevant = pause !== null && Temporal.Instant.compare(now, pause.back) < 0;
  const result = {
    endsAt: end?.toString() ?? null,
    pauseStartsAt: pauseRelevant ? pause.start.toString() : null,
    backOn: pauseRelevant ? fields.pauseBackOn : null,
  };
  if (!fields.active) return { state: "archived", ...result };
  if (end && Temporal.Instant.compare(now, end) >= 0) return { state: "ended", ...result };
  if (pauseRelevant && Temporal.Instant.compare(now, pause.start) >= 0) return { state: "paused", ...result };
  return { state: "running", ...result };
}

/** The Occurrence times the stop rule reads. `endsAt` is null for an exact time. */
export type RunStopCandidate = Readonly<{ startsAt: Temporal.Instant; endsAt: Temporal.Instant | null }>;

/**
 * True when an end or a pause removes an Occurrence (rule T4). Pass the effective
 * (moved) time. An exact time is removed when it starts at or after the end, or
 * inside the pause. A time range is removed when it is still open at the end (so
 * End now removes an Evening range at 8 PM) or overlaps the pause. The caller
 * keeps marked, noted and timed rows whatever this returns.
 */
export function isStoppedByRunFields(fields: BehaviorRunFields, candidate: RunStopCandidate): boolean {
  const end = behaviorEndInstant(fields);
  const last = candidate.endsAt ?? candidate.startsAt;
  if (end) {
    const stoppedByEnd = candidate.endsAt
      ? Temporal.Instant.compare(candidate.endsAt, end) > 0
      : Temporal.Instant.compare(candidate.startsAt, end) >= 0;
    if (stoppedByEnd) return true;
  }
  const pause = behaviorPauseInterval(fields);
  if (!pause) return false;
  if (Temporal.Instant.compare(candidate.startsAt, pause.back) >= 0) return false;
  return candidate.endsAt
    ? Temporal.Instant.compare(last, pause.start) > 0
    : Temporal.Instant.compare(candidate.startsAt, pause.start) >= 0;
}

/**
 * The end of a time range planned on a local day. A range whose end is at or
 * before its start ends on the next day.
 */
export function plannedRangeEnd(localDate: string, startTime: string, endTime: string, timezone: string): Temporal.Instant {
  const start = Temporal.PlainTime.from(startTime);
  const end = Temporal.PlainTime.from(endTime);
  const day = Temporal.PlainDate.from(localDate);
  const endDay = Temporal.PlainTime.compare(end, start) <= 0 ? day.add({ days: 1 }) : day;
  return zonedInstant(endDay.toString(), end.toString(), timezone);
}

/**
 * The earliest local day whose rows an end or a pause may still remove. Generation
 * reads from it so rows left by a stop entered offline (a Mac edit, an import) go too.
 */
export function earliestStoppedLocalDate(fields: BehaviorRunFields): string | null {
  const days = [fields.endOn, fields.pauseFromOn].filter((day): day is string => Boolean(day));
  if (days.length === 0) return null;
  return days.sort()[0] ?? null;
}

/**
 * Re-express stops that already happened in a new timezone so their moment stays
 * (rule T1). A Settings timezone change moves every active Behavior; an end or a
 * pause start still to come keeps its wall-clock time and moves with it.
 */
export function reexpressPastStops(
  fields: BehaviorRunFields,
  nextTimezone: string,
  now: Temporal.Instant,
): Pick<BehaviorRunFields, "endOn" | "endTime" | "pauseFromOn" | "pauseFromTime"> {
  const end = behaviorEndInstant(fields);
  const pause = behaviorPauseInterval(fields);
  const next = { endOn: fields.endOn, endTime: fields.endTime, pauseFromOn: fields.pauseFromOn, pauseFromTime: fields.pauseFromTime };
  if (fields.timezone === nextTimezone) return next;
  if (end && Temporal.Instant.compare(end, now) <= 0) {
    const local = localDayAndTime(end, nextTimezone, "end");
    next.endOn = local.day;
    next.endTime = local.time;
  }
  if (pause && Temporal.Instant.compare(pause.start, now) <= 0) {
    const local = localDayAndTime(pause.start, nextTimezone, "start");
    next.pauseFromOn = local.day;
    next.pauseFromTime = local.time;
  }
  return next;
}

/** `HH:MM:SS`, the stored and snapshot form of an end or pause time. */
export function normalizeRunTime(value: string): string {
  const match = value.trim().match(/^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.\d+)?)?$/);
  if (!match) throw new Error(`Invalid local time: ${value}.`);
  return `${match[1]}:${match[2]}:${match[3] ?? "00"}`;
}

function startOfLocalDay(localDate: string, timezone: string): Temporal.Instant {
  return Temporal.PlainDate.from(localDate).toZonedDateTime({ timeZone: timezone }).toInstant();
}

// A stop at local midnight reads as the end of the previous day (no time) for an end,
// and as the start of the day (no time) for a pause start.
function localDayAndTime(instant: Temporal.Instant, timezone: string, kind: "end" | "start") {
  const zoned = instant.toZonedDateTimeISO(timezone);
  const time = zoned.toPlainTime().round({ smallestUnit: "minute", roundingMode: "ceil" });
  const rolled = time.equals(Temporal.PlainTime.from("00:00")) && !zoned.toPlainTime().equals(time);
  const day = rolled ? zoned.toPlainDate().add({ days: 1 }) : zoned.toPlainDate();
  if (time.equals(Temporal.PlainTime.from("00:00"))) {
    return kind === "end"
      ? { day: day.subtract({ days: 1 }).toString(), time: null }
      : { day: day.toString(), time: null };
  }
  return { day: day.toString(), time: normalizeRunTime(time.toString()) };
}

export type BehaviorRunNoticeKind = "ended" | "paused" | "back";

/**
 * The one-line Timeline notice for a Behavior today (rule T7), derived from its
 * fields with no stored record. "ended" shows on the day the end arrives (with no
 * time, the first day the Behavior is missing), "paused" on the day a pause starts,
 * and "back" on its back-on day. Archived Behaviors show none.
 */
export function behaviorRunNotice(fields: BehaviorRunFields, now: Temporal.Instant): Readonly<{ kind: BehaviorRunNoticeKind; backOn: string | null }> | null {
  if (!fields.active) return null;
  const today = now.toZonedDateTimeISO(fields.timezone).toPlainDate().toString();
  const state = behaviorRunState(fields, now);
  const end = behaviorEndInstant(fields);
  if (state.state === "ended") {
    return end && end.toZonedDateTimeISO(fields.timezone).toPlainDate().toString() === today
      ? { kind: "ended", backOn: null } : null;
  }
  const pause = behaviorPauseInterval(fields);
  if (state.state === "paused" && pause) {
    return pause.start.toZonedDateTimeISO(fields.timezone).toPlainDate().toString() === today
      ? { kind: "paused", backOn: fields.pauseBackOn } : null;
  }
  if (fields.pauseBackOn === today && fields.pauseFromOn !== null && fields.pauseFromOn < today) {
    return { kind: "back", backOn: fields.pauseBackOn };
  }
  return null;
}
