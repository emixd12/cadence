import { Temporal } from "@js-temporal/polyfill";

import type { NormalizedExternalEvent } from "../types/day-progress";

/**
 * Ticket 354 (decision 2026-11-24): derived daily calendar busy-load rollup.
 *
 * Pure per-source rollup over `NormalizedExternalEvent[]` for an inclusive local
 * date range in the user's timezone:
 * - Ignores cancelled events, declined events, and `availability === "free"` events.
 * - Deduplicates repeated instances by `${event.source}:${event.logicalInstanceId}` per day.
 * - Clips timed events with known duration (`!endUnspecified`) to each local day's
 *   bounds, computes the union of overlapping busy spans (`busyMinutes`, 0..1440),
 *   counts timed busy events (`eventCount`), and records `earliestStartMinute` (0..1439)
 *   and `latestEndMinute` (1..1440).
 * - Marks `hasAllDayBusy` when any non-cancelled, non-declined, non-free all-day event
 *   covers that local date.
 * - Emits one entry per local date in `[startLocalDate, endLocalDate]` (including zero-load
 *   days) so write-through overwrites days that became free.
 * - Reads no titles, descriptions, locations, or attendees.
 */

export type DailyCalendarLoadEntry = Readonly<{
  localDate: string;
  busyMinutes: number;
  eventCount: number;
  earliestStartMinute: number | null;
  latestEndMinute: number | null;
  hasAllDayBusy: boolean;
}>;

export type ResolveDailyCalendarLoadInput = Readonly<{
  startLocalDate: string;
  endLocalDate: string;
  timezone: string;
  events: readonly NormalizedExternalEvent[];
}>;

const MAX_ROLLUP_DAYS = 366;

export function resolveDailyCalendarLoad(
  input: ResolveDailyCalendarLoadInput,
): DailyCalendarLoadEntry[] {
  const start = Temporal.PlainDate.from(input.startLocalDate);
  const end = Temporal.PlainDate.from(input.endLocalDate);
  if (Temporal.PlainDate.compare(start, end) > 0) return [];
  const spanDays = start.until(end).days + 1;
  if (spanDays > MAX_ROLLUP_DAYS) {
    throw new RangeError(`Daily calendar load rollup range exceeds ${MAX_ROLLUP_DAYS} days.`);
  }

  const eligible = input.events.filter(
    (event) =>
      event.state !== "cancelled" &&
      event.currentUserResponse !== "declined" &&
      event.availability !== "free",
  );

  const entries: DailyCalendarLoadEntry[] = [];
  for (let offset = 0; offset < spanDays; offset += 1) {
    const day = start.add({ days: offset });
    const localDate = day.toString();
    const dayStart = day.toZonedDateTime({ timeZone: input.timezone }).toInstant().epochMilliseconds;
    const dayEnd = day.add({ days: 1 }).toZonedDateTime({ timeZone: input.timezone }).toInstant().epochMilliseconds;
    const dayDurationMs = Math.max(1, dayEnd - dayStart);

    const spans: Array<[number, number]> = [];
    const seenTimed = new Set<string>();
    let hasAllDayBusy = false;

    for (const event of eligible) {
      if (event.kind === "all_day") {
        if (allDayCoversDate(event.startLocalDate, event.endLocalDate, event.duration.days, localDate)) {
          hasAllDayBusy = true;
        }
        continue;
      }
      if (event.endUnspecified || event.duration.kind !== "known") continue;
      const clampedStart = Math.max(Temporal.Instant.from(event.startAt).epochMilliseconds, dayStart);
      const clampedEnd = Math.min(Temporal.Instant.from(event.endAt).epochMilliseconds, dayEnd);
      if (clampedEnd <= clampedStart) continue;
      const key = `${event.source}:${event.logicalInstanceId}`;
      if (seenTimed.has(key)) continue;
      seenTimed.add(key);
      spans.push([clampedStart, clampedEnd]);
    }

    if (spans.length === 0) {
      entries.push({
        localDate,
        busyMinutes: 0,
        eventCount: 0,
        earliestStartMinute: null,
        latestEndMinute: null,
        hasAllDayBusy,
      });
      continue;
    }

    spans.sort((left, right) => left[0] - right[0] || left[1] - right[1]);
    let totalMs = 0;
    let open: [number, number] | null = null;
    let minStart = spans[0][0];
    let maxEnd = spans[0][1];
    for (const span of spans) {
      if (span[0] < minStart) minStart = span[0];
      if (span[1] > maxEnd) maxEnd = span[1];
      if (open && span[0] <= open[1]) {
        open[1] = Math.max(open[1], span[1]);
      } else {
        if (open) totalMs += open[1] - open[0];
        open = [span[0], span[1]];
      }
    }
    if (open) totalMs += open[1] - open[0];

    const maxMinutesInDay = Math.min(1440, Math.round(dayDurationMs / 60_000));
    const busyMinutes = Math.min(1440, Math.round(totalMs / 60_000));
    const earliestStartMinute = Math.min(1439, Math.max(0, Math.floor((minStart - dayStart) / 60_000)));
    const rawLatestEnd = Math.min(1440, Math.max(1, Math.ceil((maxEnd - dayStart) / 60_000)));
    const latestEndMinute = Math.min(
      Math.max(1440, maxMinutesInDay),
      Math.max(earliestStartMinute + 1, rawLatestEnd),
    );

    entries.push({
      localDate,
      busyMinutes,
      eventCount: spans.length,
      earliestStartMinute,
      latestEndMinute,
      hasAllDayBusy,
    });
  }

  return entries;
}

/**
 * Supports both inclusive (`startLocalDate === endLocalDate` for 1-day) and
 * exclusive (`endLocalDate === startLocalDate + duration.days`) all-day encodings.
 */
function allDayCoversDate(
  startLocalDate: string,
  endLocalDate: string,
  durationDays: number,
  targetLocalDate: string,
): boolean {
  if (targetLocalDate < startLocalDate) return false;
  const start = Temporal.PlainDate.from(startLocalDate);
  const inclusiveEnd = start.add({ days: Math.max(0, durationDays - 1) }).toString();
  const effectiveEnd = endLocalDate < inclusiveEnd ? endLocalDate : inclusiveEnd;
  return targetLocalDate <= effectiveEnd;
}
