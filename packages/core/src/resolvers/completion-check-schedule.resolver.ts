import { Temporal } from "@js-temporal/polyfill";

/**
 * Background check schedule for connector completion (Ticket 321, D28.5). Pure:
 * the caller injects `now` and the account's linked, Unresolved Occurrences for
 * today with their pending reminder times. A check is useful only when nobody is
 * looking, so an account is checked at three kinds of moment instead of on a fixed
 * interval. See `docs/plans/2026-11-10-connector-completion-architecture.md`,
 * "Background check schedule".
 */

/** The job route runs at these minutes of every hour, off the top of the hour. */
export const COMPLETION_CHECK_RUN_MINUTES = [7, 22, 37, 52] as const;
/** Invariant 12: at most 24 background checks per account per local day. */
export const COMPLETION_CHECK_DAILY_LIMIT = 24;
/** After a failed check the wait doubles from one run interval, up to 6 hours. */
export const COMPLETION_CHECK_BASE_BACKOFF_MINUTES = 15;
export const COMPLETION_CHECK_MAX_BACKOFF_MINUTES = 6 * 60;
const AFTER_START_HALF_HOURS = 6;

/** `cheap`: strategy A or B. `full_scan`: strategy C keeps only reminder and nightly checks. */
export type CompletionReadStrategy = "cheap" | "full_scan";

export type CompletionCheckOccurrence = Readonly<{
  scheduledStartAt: string;
  /** Pending reminder send instants for this Occurrence. */
  reminderAt: readonly string[];
}>;

export type CompletionCheckScheduleInput = Readonly<{
  now: Temporal.Instant;
  /** The profile timezone; the nightly check follows its local midnight. */
  timezone: string;
  strategy: CompletionReadStrategy;
  /** Today's Unresolved Occurrences of linked Behaviors. Resolved ones are left out by the caller. */
  occurrences: readonly CompletionCheckOccurrence[];
  /** Background checks already run on today's local date. */
  checksToday: number;
  consecutiveFailures: number;
  /** The last background attempt, for the failure backoff. */
  lastAttemptAt: string | null;
  reconnectRequired: boolean;
}>;

export type CompletionCheckReason = "before_reminder" | "after_start" | "nightly";

export type CompletionCheckSchedule = Readonly<{
  /** Null stops background checks until something changes (reconnect required). */
  nextCheckAt: string | null;
  reason: CompletionCheckReason | null;
}>;

export function resolveCompletionCheckSchedule(input: CompletionCheckScheduleInput): CompletionCheckSchedule {
  if (input.reconnectRequired) return { nextCheckAt: null, reason: null };
  const now = input.now;
  const midnight = startOfNextLocalDay(now, input.timezone);
  const nightly = firstRunAfter(midnight);
  const candidates: Array<{ at: Temporal.Instant; reason: CompletionCheckReason }> = [{ at: nightly, reason: "nightly" }];

  if (input.checksToday < COMPLETION_CHECK_DAILY_LIMIT) {
    for (const occurrence of input.occurrences) {
      for (const reminder of occurrence.reminderAt) {
        const slot = lastRunBefore(Temporal.Instant.from(reminder));
        if (slot && Temporal.Instant.compare(slot, now) > 0) candidates.push({ at: slot, reason: "before_reminder" });
      }
      if (input.strategy === "cheap") {
        const after = nextAfterStartCheck(Temporal.Instant.from(occurrence.scheduledStartAt), now, midnight);
        if (after) candidates.push({ at: after, reason: "after_start" });
      }
    }
  }

  candidates.sort((left, right) => Temporal.Instant.compare(left.at, right.at));
  let chosen = candidates[0];
  if (input.consecutiveFailures > 0 && input.lastAttemptAt) {
    const minutes = Math.min(COMPLETION_CHECK_MAX_BACKOFF_MINUTES,
      COMPLETION_CHECK_BASE_BACKOFF_MINUTES * 2 ** Math.min(16, input.consecutiveFailures - 1));
    const earliest = Temporal.Instant.from(input.lastAttemptAt).add({ minutes });
    if (Temporal.Instant.compare(chosen.at, earliest) < 0) chosen = { at: earliest, reason: chosen.reason };
  }
  return { nextCheckAt: chosen.at.toString(), reason: chosen.reason };
}

/** Every 30 minutes for 3 hours after the start, then hourly until local midnight. */
function nextAfterStartCheck(start: Temporal.Instant, now: Temporal.Instant, midnight: Temporal.Instant): Temporal.Instant | null {
  for (let index = 1; ; index += 1) {
    const minutes = index <= AFTER_START_HALF_HOURS ? index * 30 : AFTER_START_HALF_HOURS * 30 + (index - AFTER_START_HALF_HOURS) * 60;
    const at = start.add({ minutes });
    if (Temporal.Instant.compare(at, midnight) >= 0) return null;
    if (Temporal.Instant.compare(at, now) > 0) return at;
  }
}

/** The last job run strictly before an instant. Run minutes are UTC minutes. */
export function lastRunBefore(instant: Temporal.Instant): Temporal.Instant | null {
  const utc = instant.toZonedDateTimeISO("UTC");
  const hourStart = utc.round({ smallestUnit: "hour", roundingMode: "floor" });
  for (let hours = 0; hours <= 1; hours += 1) {
    const base = hourStart.subtract({ hours });
    for (const minute of [...COMPLETION_CHECK_RUN_MINUTES].reverse()) {
      const run = base.add({ minutes: minute }).toInstant();
      if (Temporal.Instant.compare(run, instant) < 0) return run;
    }
  }
  return null;
}

/** The first job run at or after an instant. */
export function firstRunAfter(instant: Temporal.Instant): Temporal.Instant {
  const utc = instant.toZonedDateTimeISO("UTC");
  const hourStart = utc.round({ smallestUnit: "hour", roundingMode: "floor" });
  for (let hours = 0; hours <= 1; hours += 1) {
    for (const minute of COMPLETION_CHECK_RUN_MINUTES) {
      const run = hourStart.add({ hours, minutes: minute }).toInstant();
      if (Temporal.Instant.compare(run, instant) >= 0) return run;
    }
  }
  return instant;
}

function startOfNextLocalDay(now: Temporal.Instant, timezone: string): Temporal.Instant {
  return now.toZonedDateTimeISO(timezone).toPlainDate().add({ days: 1 })
    .toZonedDateTime({ timeZone: timezone }).toInstant();
}
