import { Temporal } from "@js-temporal/polyfill";

/**
 * The one place Cadence asks for the time.
 *
 * Every feature that needs "now", today's local date, a local day's bounds or the
 * time an Occurrence actually sits at goes through this module. Rules live in
 * `docs/DATETIME_STRATEGY.md` ("Time helper" and "Moves").
 *
 * Core cannot read the clock (`npm run core:check`), so "now" arrives as an
 * injected `CadenceClock`. The web runtime's real clock is `systemClock` in
 * `lib/services/clock.ts`; tests pass `fixedClock`.
 *
 * Effective time is a placeholder until per-day moves land (advisor plan,
 * Phase 2): it returns the planned time. Callers that use it now pick up moves
 * without another change. `tests/scheduled-for-drift.test.ts` fails when new code
 * reads `scheduled_for` directly instead of asking here.
 */

export type InstantInput = Temporal.Instant | string;

/** A source of "now". Inject it; never read the system clock in core code. */
export type CadenceClock = Readonly<{ now: () => Temporal.Instant }>;

/** A clock that always returns the same instant. For tests, fixtures and replays. */
export function fixedClock(instant: InstantInput): CadenceClock {
  const fixed = toInstant(instant);
  return { now: () => fixed };
}

/** The clock's current instant. */
export function currentInstant(clock: CadenceClock): Temporal.Instant {
  return clock.now();
}

/** The local calendar date (`YYYY-MM-DD`) of an instant in an IANA timezone. */
export function localDateAt(instant: InstantInput, timezone: string): string {
  return toInstant(instant).toZonedDateTimeISO(timezone).toPlainDate().toString();
}

/**
 * Today's local date in a person's or a Behavior's timezone. For a same-day rule
 * about an Occurrence, pass the Behavior's timezone: it defines `local_date`.
 */
export function todayIn(clock: CadenceClock, timezone: string): string {
  return localDateAt(clock.now(), timezone);
}

/**
 * A local day as the half-open instant interval `[start, end)`, from local
 * midnight to the next local midnight. A day can last 23 or 25 hours; never add
 * 24 hours to derive the end.
 */
export function localDayBounds(localDate: string, timezone: string): Readonly<{ start: Temporal.Instant; end: Temporal.Instant }> {
  const date = Temporal.PlainDate.from(localDate);
  return {
    start: date.toZonedDateTime({ timeZone: timezone }).toInstant(),
    end: date.add({ days: 1 }).toZonedDateTime({ timeZone: timezone }).toInstant(),
  };
}

/** True when the instant falls on the given local date in the timezone. */
export function isOnLocalDate(instant: InstantInput, localDate: string, timezone: string): boolean {
  return localDateAt(instant, timezone) === Temporal.PlainDate.from(localDate).toString();
}

/**
 * The instant of a local wall-clock time on a local date, using the
 * RFC 5545 / Temporal "compatible" rule: a time skipped by a spring-forward
 * transition moves to the next valid time, and a time repeated by a fall-back
 * transition takes the earlier instant.
 */
export function zonedInstant(localDate: string, wallTime: string, timezone: string): Temporal.Instant {
  return Temporal.PlainDate.from(localDate)
    .toPlainDateTime(Temporal.PlainTime.from(wallTime))
    .toZonedDateTime(timezone, { disambiguation: "compatible" })
    .toInstant();
}

/** The fields effective time reads. Phase 2 adds the Occurrence's applied moves. */
export type EffectiveTimeSource = Readonly<{ scheduled_for: string }>;

/**
 * The time an Occurrence actually sits at: the latest applied move for its day,
 * otherwise its planned time. Until moves exist this is the planned time.
 * Returns the same ISO instant string the caller passed in.
 */
export function effectiveStartAt(occurrence: EffectiveTimeSource): string {
  return occurrence.scheduled_for;
}

/** `effectiveStartAt` as a Temporal instant. */
export function effectiveStartInstant(occurrence: EffectiveTimeSource): Temporal.Instant {
  return Temporal.Instant.from(effectiveStartAt(occurrence));
}

function toInstant(value: InstantInput): Temporal.Instant {
  return typeof value === "string" ? Temporal.Instant.from(value) : value;
}
