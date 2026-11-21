import { Temporal } from "@js-temporal/polyfill";

import { behaviorRunState, type BehaviorRunFields } from "./behavior-run.resolver";
import { briefMoveFreeStarts, BRIEF_MOVE_STEP_SECONDS, type BriefMoveBlock } from "./brief-move.resolver";
import type { OccurrenceOrigin, OccurrenceStatus } from "../types/database";

/**
 * Behaviors of Opportunity (docs/RECURRENCE_RULES.md, "Behaviors of Opportunity").
 * An opportunity Behavior can be added to Today at any time. Its added Occurrences
 * carry `origin = "opportunity"`; generation never changes them, and a clean one can be
 * removed again. The hosted functions `add_opportunity_occurrence` and
 * `remove_opportunity_occurrence` hold the same rules.
 */

export type OpportunityPoolBehavior = BehaviorRunFields & Readonly<{ isOpportunity: boolean }>;

/** In the pool: an opportunity Behavior that is active and running at `now`. */
export function isBehaviorInOpportunityPool(behavior: OpportunityPoolBehavior, now: Temporal.Instant): boolean {
  return behavior.isOpportunity === true && behavior.active === true
    && behaviorRunState(behavior, now).state === "running";
}

export type OpportunityRemovalFacts = Readonly<{
  /** Missing means "scheduled". */
  origin?: OccurrenceOrigin | string | null;
  status: OccurrenceStatus;
  note: string | null;
  hasTimeSessions: boolean;
  /** Unknown (undefined) counts as history, so the row is not offered for removal. */
  hasStatusHistory?: boolean;
  hasActiveSourceMatch?: boolean;
}>;

/**
 * Remove is offered only for a clean added Occurrence: opportunity origin, Unresolved,
 * no note, no timed session, no status history and no active source match.
 */
export function canRemoveOpportunityOccurrence(occurrence: OpportunityRemovalFacts): boolean {
  return (occurrence.origin ?? "scheduled") === "opportunity"
    && occurrence.status === "unresolved"
    && (occurrence.note?.trim() ?? "") === ""
    && !occurrence.hasTimeSessions
    && occurrence.hasStatusHistory === false
    && occurrence.hasActiveSourceMatch !== true;
}

export type OpportunitySlotSuggestion = Readonly<{
  startsAt: Temporal.Instant;
  /** Local wall time, "HH:MM". */
  localTime: string;
  /** "free_slot": the nearest free start after now. "now": no block conflicts, or the day is full. */
  source: "free_slot" | "now";
}>;

/**
 * The default time for adding an opportunity Behavior to today: `now` rounded up to
 * the next 5 minutes when nothing blocks it, otherwise the nearest free start under the
 * shared free-slot rule (`briefMoveFreeStarts`). Never leaves today: near midnight it
 * keeps the current minute.
 */
export function suggestDefaultOpportunitySlot(input: Readonly<{
  localDate: string;
  timezone: string;
  now: Temporal.Instant;
  lengthMinutes: number;
  blocks: readonly BriefMoveBlock[];
}>): OpportunitySlotSuggestion {
  const rounded = roundUpToStep(input.now);
  const lengthSeconds = Math.max(1, Math.round(input.lengthMinutes)) * 60;
  const roundedOnDay = localDateOf(rounded, input.timezone) === input.localDate;
  const fallback = roundedOnDay ? rounded : truncateToMinute(input.now);
  const nowSuggestion = { startsAt: fallback, localTime: localTimeOf(fallback, input.timezone), source: "now" as const };
  const free = briefMoveFreeStarts({
    localDate: input.localDate,
    timezone: input.timezone,
    now: input.now,
    // Just before the rounded start, so the rounded start itself is never excluded.
    near: rounded.subtract({ nanoseconds: 1 }),
    lengthSeconds,
    blocks: input.blocks,
    limit: Number.MAX_SAFE_INTEGER,
  });
  const first = free[0];
  if (!first) return nowSuggestion;
  if (first.equals(rounded)) return { ...nowSuggestion, startsAt: rounded, localTime: localTimeOf(rounded, input.timezone) };
  return { startsAt: first, localTime: localTimeOf(first, input.timezone), source: "free_slot" };
}

function roundUpToStep(value: Temporal.Instant): Temporal.Instant {
  return value.round({ smallestUnit: "minute", roundingIncrement: BRIEF_MOVE_STEP_SECONDS / 60, roundingMode: "ceil" });
}

function truncateToMinute(value: Temporal.Instant): Temporal.Instant {
  return value.round({ smallestUnit: "minute", roundingMode: "floor" });
}

function localDateOf(value: Temporal.Instant, timezone: string): string {
  return value.toZonedDateTimeISO(timezone).toPlainDate().toString();
}

function localTimeOf(value: Temporal.Instant, timezone: string): string {
  const time = value.toZonedDateTimeISO(timezone);
  return `${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}`;
}
