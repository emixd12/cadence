import { Temporal } from "@js-temporal/polyfill";
import {
  resolveDailyCalendarLoad,
  type DailyCalendarLoadEntry,
} from "@cadence/core/resolvers/calendar-load.resolver";
import type { ExternalEventSource, NormalizedExternalEvent } from "@cadence/core/types/day-progress";
import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import {
  deleteDailyCalendarLoadForSource,
  listDailyCalendarLoad,
  upsertDailyCalendarLoad,
  type DailyCalendarLoadRow,
} from "@/lib/db/dailyCalendarLoad.repo";

// Ticket 354 (decision 2026-11-24): derived daily calendar busy-load rollup service.
// Stores numeric busy-load metrics only (no titles, descriptions, locations, or
// attendees), populated via write-through on complete calendar reads plus a bounded
// one-time connect backfill, and hard-deleted on disconnect or selection change.

export const CALENDAR_LOAD_CONNECT_BACKFILL_DAYS = 30;
export const CALENDAR_LOAD_CONNECT_BACKFILL_DEADLINE_MS = 6_000;
export const CALENDAR_LOAD_MAX_QUERY_DAYS = 366;

export type CalendarLoadSnapshotLike = Readonly<{
  completeness: "complete" | "incomplete";
  requestedRange: Readonly<{
    startLocalDate: string;
    endLocalDate: string;
    timezone: string;
  }>;
  events: readonly NormalizedExternalEvent[];
}>;

export type DailyCalendarLoadSummary = Readonly<{
  local_date: string;
  busy_minutes: number;
  event_count: number;
  earliest_start_minute: number | null;
  latest_end_minute: number | null;
  has_all_day_busy: boolean;
  sources: readonly ExternalEventSource[];
}>;

/**
 * Best-effort write-through from a complete external-event snapshot into
 * `public.daily_calendar_load`. Incomplete snapshots are skipped so partial
 * reads never overwrite valid rollups with zeros. Never throws.
 */
export async function persistCalendarLoadFromSnapshot(
  client: AppSupabaseClient,
  userId: string,
  source: ExternalEventSource,
  connectionGeneration: number,
  snapshot: CalendarLoadSnapshotLike,
  syncedAt: string = Temporal.Now.instant().toString(),
): Promise<number> {
  if (snapshot.completeness !== "complete") return 0;
  if (!Number.isSafeInteger(connectionGeneration) || connectionGeneration < 1) return 0;
  try {
    const entries: DailyCalendarLoadEntry[] = resolveDailyCalendarLoad({
      startLocalDate: snapshot.requestedRange.startLocalDate,
      endLocalDate: snapshot.requestedRange.endLocalDate,
      timezone: snapshot.requestedRange.timezone,
      events: snapshot.events,
    });
    if (entries.length === 0) return 0;
    return await upsertDailyCalendarLoad(client, userId, source, connectionGeneration, entries, syncedAt);
  } catch {
    return 0;
  }
}

/** Best-effort hard-delete on disconnect or calendar-selection change. Never throws. */
export async function clearCalendarLoadForSource(
  client: AppSupabaseClient,
  userId: string,
  source: ExternalEventSource,
): Promise<void> {
  try {
    await deleteDailyCalendarLoadForSource(client, userId, source);
  } catch {
    // Best-effort cleanup; never blocks disconnect or preference save.
  }
}

/**
 * Bounded 30-day lookback range ending today in the user's timezone for one-time
 * connect backfill.
 */
export function connectBackfillDateRange(
  timezone: string,
  now: Temporal.Instant = Temporal.Now.instant(),
  days: number = CALENDAR_LOAD_CONNECT_BACKFILL_DAYS,
): Readonly<{ startLocalDate: string; endLocalDate: string }> {
  const today = now.toZonedDateTimeISO(timezone).toPlainDate();
  return {
    startLocalDate: today.subtract({ days: Math.max(0, days - 1) }).toString(),
    endLocalDate: today.toString(),
  };
}

/**
 * Best-effort bounded 30-day lookback backfill invoked when a user connects or
 * selects calendars, so `daily_calendar_load` is immediately warm for Chat and
 * Daily Brief. Uses a tight timeout and swallows errors so selection saves never fail.
 */
export async function backfillCalendarLoadAfterSelection(
  client: AppSupabaseClient,
  userId: string,
  runRead: (startLocalDate: string, endLocalDate: string, signal: AbortSignal) => Promise<unknown>,
  now: Temporal.Instant = Temporal.Now.instant(),
): Promise<void> {
  try {
    const { data: profile, error } = await client.from("profiles").select("timezone").eq("id", userId).single();
    if (error || !profile || typeof profile.timezone !== "string") return;
    const range = connectBackfillDateRange(profile.timezone, now, CALENDAR_LOAD_CONNECT_BACKFILL_DAYS);
    await runRead(range.startLocalDate, range.endLocalDate, AbortSignal.timeout(CALENDAR_LOAD_CONNECT_BACKFILL_DEADLINE_MS));
  } catch {
    // Best-effort backfill; never blocks connection or preference save.
  }
}

/**
 * Reads persisted per-source rollups and aggregates them per local date across
 * the requested (enabled) sources for Chat and Daily Brief.
 */
export async function getDailyCalendarLoadForUser(
  client: AppSupabaseClient,
  userId: string,
  startLocalDate: string,
  endLocalDate: string,
  options: Readonly<{ sources?: readonly ExternalEventSource[]; signal?: AbortSignal }> = {},
): Promise<Readonly<{ days: DailyCalendarLoadSummary[]; rows: DailyCalendarLoadRow[] }>> {
  const rows = await listDailyCalendarLoad(client, userId, startLocalDate, endLocalDate, options);
  const byDate = new Map<string, DailyCalendarLoadRow[]>();
  for (const row of rows) {
    const existing = byDate.get(row.local_date);
    if (existing) existing.push(row);
    else byDate.set(row.local_date, [row]);
  }
  const days: DailyCalendarLoadSummary[] = [...byDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([localDate, dateRows]) => {
      let busyMinutes = 0;
      let eventCount = 0;
      let earliestStart: number | null = null;
      let latestEnd: number | null = null;
      let hasAllDayBusy = false;
      const sources: ExternalEventSource[] = [];
      for (const row of dateRows) {
        sources.push(row.source);
        busyMinutes += row.busy_minutes;
        eventCount += row.event_count;
        if (row.earliest_start_minute !== null) {
          earliestStart = earliestStart === null
            ? row.earliest_start_minute
            : Math.min(earliestStart, row.earliest_start_minute);
        }
        if (row.latest_end_minute !== null) {
          latestEnd = latestEnd === null
            ? row.latest_end_minute
            : Math.max(latestEnd, row.latest_end_minute);
        }
        if (row.has_all_day_busy) hasAllDayBusy = true;
      }
      return {
        local_date: localDate,
        busy_minutes: Math.min(1440, busyMinutes),
        event_count: eventCount,
        earliest_start_minute: earliestStart,
        latest_end_minute: latestEnd,
        has_all_day_busy: hasAllDayBusy,
        sources,
      };
    });
  return { days, rows };
}
