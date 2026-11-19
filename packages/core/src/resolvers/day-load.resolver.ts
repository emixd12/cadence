import { Temporal } from "@js-temporal/polyfill";

import type { BehaviorDurationEstimate, NormalizedExternalEvent } from "../types/day-progress";

/**
 * Advisor plan Phase 4, workstream 4G (Emi, D8): how full a day was, from real lengths
 * only.
 *
 * - Calendar: each timed event's own start and end, clipped to the local day. All-day
 *   events, events with no stated end, cancelled events and events the person declined
 *   are left out. Overlapping events count once (the union of their times).
 * - Cadence items: every Occurrence on the day, whatever its status. An item counts
 *   only when its Behavior has a length the person set or a logged completion average
 *   (`resolveBehaviorDurationEstimate`: provenance "behavior_default" or
 *   "completed_stopped_occurrence_mean"). Never a model's estimate, never the
 *   30-minute default length. Items with neither are counted in `itemsNoLength`.
 *
 * Nothing about titles is read or kept.
 */

export const DAY_LOAD_VERSION = "day-load-1";

export type DayLoad = Readonly<{
  localDate: string;
  /** Null when no calendar was read. */
  calendarMinutes: number | null;
  calendarEvents: number | null;
  itemMinutes: number;
  itemsCounted: number;
  itemsNoLength: number;
}>;

export type DayLoadItem = Readonly<{ behaviorId: string }>;

/** The real length of a Behavior's items in seconds, or null. */
export function dayLoadItemSeconds(estimate: BehaviorDurationEstimate | undefined): number | null {
  if (!estimate || estimate.kind !== "known") return null;
  if (estimate.provenance !== "behavior_default" && estimate.provenance !== "completed_stopped_occurrence_mean") return null;
  return estimate.seconds > 0 ? estimate.seconds : null;
}

export function resolveDayLoad(input: Readonly<{
  localDate: string;
  timezone: string;
  items: readonly DayLoadItem[];
  lengths: ReadonlyMap<string, BehaviorDurationEstimate>;
  /** Null when no calendar was read. */
  calendarEvents: readonly NormalizedExternalEvent[] | null;
}>): DayLoad {
  let itemSeconds = 0;
  let itemsCounted = 0;
  let itemsNoLength = 0;
  for (const item of input.items) {
    const seconds = dayLoadItemSeconds(input.lengths.get(item.behaviorId));
    if (seconds === null) { itemsNoLength += 1; continue; }
    itemSeconds += seconds;
    itemsCounted += 1;
  }

  let calendarMinutes: number | null = null;
  let calendarEvents: number | null = null;
  if (input.calendarEvents) {
    const day = Temporal.PlainDate.from(input.localDate);
    const dayStart = day.toZonedDateTime({ timeZone: input.timezone }).toInstant().epochMilliseconds;
    const dayEnd = day.add({ days: 1 }).toZonedDateTime({ timeZone: input.timezone }).toInstant().epochMilliseconds;
    const spans: Array<[number, number]> = [];
    const seen = new Set<string>();
    for (const event of input.calendarEvents) {
      if (event.kind !== "timed" || event.endUnspecified || event.duration.kind !== "known") continue;
      if (event.state === "cancelled" || event.currentUserResponse === "declined") continue;
      const start = Math.max(Temporal.Instant.from(event.startAt).epochMilliseconds, dayStart);
      const end = Math.min(Temporal.Instant.from(event.endAt).epochMilliseconds, dayEnd);
      if (end <= start) continue;
      // The same event read from two calendars counts once.
      const key = `${event.source}:${event.logicalInstanceId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      spans.push([start, end]);
    }
    spans.sort((left, right) => left[0] - right[0]);
    let total = 0;
    let open: [number, number] | null = null;
    for (const span of spans) {
      if (open && span[0] <= open[1]) open[1] = Math.max(open[1], span[1]);
      else { if (open) total += open[1] - open[0]; open = [span[0], span[1]]; }
    }
    if (open) total += open[1] - open[0];
    calendarMinutes = Math.min(1440, Math.round(total / 60_000));
    calendarEvents = spans.length;
  }

  return {
    localDate: input.localDate,
    calendarMinutes,
    calendarEvents,
    itemMinutes: Math.round(itemSeconds / 60),
    itemsCounted,
    itemsNoLength,
  };
}
