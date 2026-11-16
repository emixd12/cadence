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
 * Effective time is where an Occurrence actually sits today: the latest applied
 * per-day move, otherwise its planned time (advisor plan, Phase 2). The server keeps
 * it on the row as `effective_start_at` / `effective_end_at`, written only by the
 * move functions; a device that syncs the move records derives the same value with
 * `effectiveTimeFromMoves`. `tests/scheduled-for-drift.test.ts` fails when new code
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

/**
 * The fields effective time reads. `effective_start_at` is the server's derived
 * value: null (or absent) means the Occurrence sits at its planned time.
 */
export type EffectiveTimeSource = Readonly<{
  scheduled_for: string;
  effective_start_at?: string | null;
}>;

/** The fields effective end time reads. */
export type EffectiveEndSource = EffectiveTimeSource & Readonly<{ effective_end_at?: string | null }>;

/**
 * The time an Occurrence actually sits at: the latest applied move for its day,
 * otherwise its planned time. Returns an ISO instant string (the planned one exactly
 * as the caller passed it when the Occurrence is not moved).
 */
export function effectiveStartAt(occurrence: EffectiveTimeSource): string {
  return occurrence.effective_start_at ?? occurrence.scheduled_for;
}

/** `effectiveStartAt` as a Temporal instant. */
export function effectiveStartInstant(occurrence: EffectiveTimeSource): Temporal.Instant {
  return Temporal.Instant.from(effectiveStartAt(occurrence));
}

/**
 * The end of a moved Occurrence, or null when it sits at its planned time (the
 * caller then derives the planned end the way it always has).
 */
export function effectiveEndAt(occurrence: EffectiveEndSource): string | null {
  return occurrence.effective_start_at ? occurrence.effective_end_at ?? null : null;
}

/** True when a move currently places the Occurrence away from its planned time. */
export function isMoved(occurrence: EffectiveTimeSource): boolean {
  return Boolean(occurrence.effective_start_at);
}

/**
 * The planned time. Only identity, history and export code should need it: anything
 * that shows, reminds or matches uses `effectiveStartAt`.
 */
export function plannedStartAt(occurrence: EffectiveTimeSource): string {
  return occurrence.scheduled_for;
}

/** The fields of a synced `occurrence_moves` record that effective time reads. */
export type OccurrenceMoveTimeRecord = Readonly<{
  occurrence_id: string;
  chain_position: number;
  timezone: string;
  to_start_at: string;
  to_end_at: string;
  to_planned: boolean;
}>;

/**
 * Effective time from an Occurrence's move records, the same rule the server's move
 * functions write onto the row: the latest record of the chain decides. A move places
 * the Occurrence at its new time; an Undo back to the plan returns null. A record made
 * in another timezone than the Behavior's current one is superseded, so the Occurrence
 * follows its plan again. Returns null when the Occurrence sits at its planned time.
 * Rules: docs/DATETIME_STRATEGY.md, "Moves".
 */
export function effectiveTimeFromMoves(
  moves: readonly OccurrenceMoveTimeRecord[],
  occurrenceId: string,
  behaviorTimezone: string,
): Readonly<{ effective_start_at: string; effective_end_at: string }> | null {
  let latest: OccurrenceMoveTimeRecord | null = null;
  for (const move of moves) {
    if (move.occurrence_id !== occurrenceId) continue;
    if (!latest || move.chain_position > latest.chain_position) latest = move;
  }
  if (!latest || latest.to_planned || latest.timezone !== behaviorTimezone) return null;
  return {
    effective_start_at: Temporal.Instant.from(latest.to_start_at).toString(),
    effective_end_at: Temporal.Instant.from(latest.to_end_at).toString(),
  };
}

function toInstant(value: InstantInput): Temporal.Instant {
  return typeof value === "string" ? Temporal.Instant.from(value) : value;
}
