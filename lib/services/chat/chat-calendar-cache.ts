import { Temporal } from "@js-temporal/polyfill";
import type { ChatCalendarEvent, ChatSourceReport } from "./chat-executor";

/**
 * Ticket 355 (decision 2026-11-24): date coalescing and short-lived ephemeral
 * session caching for bounded live calendar reads in Chat.
 *
 * - Coalesces nearby requested dates into minimal bounding-window provider calls
 *   (each at most 31 inclusive days) and filters events in memory to target dates.
 * - Caches fetched windows ephemerally for the lifetime of the turn/session so
 *   repeated or overlapping tool calls reuse already-fetched events without
 *   repeat provider API calls. Raw events are discarded when the session ends.
 */

export type DateSpan = Readonly<{ start: string; end: string }>;

export const MAX_CALENDAR_LIVE_SPAN_DAYS = 31;
const DEFAULT_COALESCE_GAP_DAYS = 3;

/**
 * Clusters sorted target local dates (`YYYY-MM-DD`) into minimal bounding spans
 * where consecutive dates within `maxGapDays` merge as long as the resulting
 * cluster stays within `maxSpanDays` inclusive days.
 */
export function coalesceTargetDates(
  dates: readonly string[],
  options: Readonly<{ maxGapDays?: number; maxSpanDays?: number }> = {},
): DateSpan[] {
  const unique = [...new Set(dates)].sort();
  if (unique.length === 0) return [];
  const maxGapDays = options.maxGapDays ?? DEFAULT_COALESCE_GAP_DAYS;
  const maxSpanDays = options.maxSpanDays ?? MAX_CALENDAR_LIVE_SPAN_DAYS;

  const spans: DateSpan[] = [];
  let clusterStart = Temporal.PlainDate.from(unique[0]);
  let clusterEnd = clusterStart;

  for (let index = 1; index < unique.length; index += 1) {
    const next = Temporal.PlainDate.from(unique[index]);
    const gap = clusterEnd.until(next).days;
    const mergedSpan = clusterStart.until(next).days + 1;
    if (gap <= maxGapDays && mergedSpan <= maxSpanDays) {
      clusterEnd = next;
    } else {
      spans.push({ start: clusterStart.toString(), end: clusterEnd.toString() });
      clusterStart = next;
      clusterEnd = next;
    }
  }
  spans.push({ start: clusterStart.toString(), end: clusterEnd.toString() });
  return spans;
}

/** Filters events to those overlapping any of the inclusive target local dates in `timezone`. */
export function filterEventsToDates(
  events: readonly ChatCalendarEvent[],
  targetDates: ReadonlySet<string>,
  timezone: string,
): ChatCalendarEvent[] {
  if (targetDates.size === 0) return [];
  const bounds = [...targetDates].map((date) => {
    const plain = Temporal.PlainDate.from(date);
    const startMs = plain.toZonedDateTime({ timeZone: timezone }).toInstant().epochMilliseconds;
    const endMs = plain.add({ days: 1 }).toZonedDateTime({ timeZone: timezone }).toInstant().epochMilliseconds;
    return { date, startMs, endMs };
  });

  return events.filter((event) => {
    if (event.all_day) {
      const start = event.start.slice(0, 10);
      const end = (event.end ?? start).slice(0, 10);
      for (const { date } of bounds) {
        if (date >= start && date <= end) return true;
      }
      return false;
    }
    const eventStartMs = Temporal.Instant.from(event.start).epochMilliseconds;
    const eventEndMs = event.end
      ? Math.max(eventStartMs + 1, Temporal.Instant.from(event.end).epochMilliseconds)
      : eventStartMs + 1;
    for (const { startMs, endMs } of bounds) {
      if (eventStartMs < endMs && eventEndMs > startMs) return true;
    }
    return false;
  });
}

export function expandDateSpan(start: string, end: string): string[] {
  const first = Temporal.PlainDate.from(start);
  const last = Temporal.PlainDate.from(end);
  const days = first.until(last).days;
  if (days < 0) return [];
  const result: string[] = [];
  for (let offset = 0; offset <= days; offset += 1) {
    result.push(first.add({ days: offset }).toString());
  }
  return result;
}

type CachedWindow = Readonly<{
  start: string;
  end: string;
  events: readonly ChatCalendarEvent[];
  sources: readonly ChatSourceReport[];
}>;

/**
 * Ephemeral in-memory cache for one Chat turn/session. Reuses complete cached
 * windows whenever a requested span or date subset is already covered.
 */
export function createEphemeralCalendarSessionCache(
  fetchSpan: (start: string, end: string) => Promise<Readonly<{ events: ChatCalendarEvent[]; sources: ChatSourceReport[] }>>,
  timezone: string,
) {
  const windows: CachedWindow[] = [];

  const findCovering = (start: string, end: string): CachedWindow | null =>
    windows.find((window) => window.start <= start && window.end >= end) ?? null;

  const readSpan = async (start: string, end: string): Promise<Readonly<{ events: ChatCalendarEvent[]; sources: ChatSourceReport[] }>> => {
    const covered = findCovering(start, end);
    if (covered) {
      const targets = new Set(expandDateSpan(start, end));
      return { events: filterEventsToDates(covered.events, targets, timezone), sources: [...covered.sources] };
    }
    const fetched = await fetchSpan(start, end);
    const allClean = fetched.sources.every((source) => source.state !== "failed" && source.state !== "partial");
    if (allClean) {
      windows.push({ start, end, events: fetched.events, sources: fetched.sources });
    }
    return fetched;
  };

  const readDates = async (dates: readonly string[]): Promise<Readonly<{ events: ChatCalendarEvent[]; sources: ChatSourceReport[] }>> => {
    const clusters = coalesceTargetDates(dates);
    const reads = await Promise.all(clusters.map((cluster) => readSpan(cluster.start, cluster.end)));
    const targetSet = new Set(dates);
    const seenEvents = new Set<string>();
    const events: ChatCalendarEvent[] = [];
    for (const read of reads) {
      for (const event of filterEventsToDates(read.events, targetSet, timezone)) {
        const key = `${event.source}|${event.calendar}|${event.start}|${event.end ?? ""}|${event.title}`;
        if (seenEvents.has(key)) continue;
        seenEvents.add(key);
        events.push(event);
      }
    }
    events.sort((left, right) => left.start.localeCompare(right.start));
    const sources = mergeSourceReports(reads.map((read) => read.sources));
    return { events, sources };
  };

  return { readSpan, readDates };
}

function mergeSourceReports(groups: readonly (readonly ChatSourceReport[])[]): ChatSourceReport[] {
  const priority: Record<ChatSourceReport["state"], number> = {
    unavailable: 6,
    failed: 5,
    partial: 4,
    no_calendars: 3,
    off: 2,
    not_connected: 1,
    read: 0,
  };
  const merged = new Map<ChatSourceReport["source"], ChatSourceReport>();
  for (const group of groups) {
    for (const report of group) {
      const existing = merged.get(report.source);
      if (!existing || priority[report.state] > priority[existing.state]) {
        merged.set(report.source, report);
      }
    }
  }
  return [...merged.values()];
}
