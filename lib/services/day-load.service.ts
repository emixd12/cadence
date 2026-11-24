import { Temporal } from "@js-temporal/polyfill";

import { DAY_LOAD_VERSION, resolveDayLoad, type DayLoad } from "@cadence/core/resolvers/day-load.resolver";
import { resolveBehaviorDurationEstimate } from "@cadence/core/resolvers/timeline-context.resolver";
import type { BehaviorDurationEstimate, BehaviorDurationHistoryOccurrence, NormalizedExternalEvent } from "@cadence/core/types/day-progress";
import type { Json } from "@/lib/db/database.types";
import { listUserBehaviors, type AppSupabaseClient } from "@/lib/db/behaviors.repo";
import { readAllPostgrestRows } from "@/lib/db/paginated-read";
import { listTimeSessionHistory } from "@/lib/db/timeSessions.repo";
import type { CalendarReadCaller } from "@/lib/services/google-calendar.service";
import { readTravelCalendarConnections, readTravelCalendarEvents, travelCalendarSourcesTakingPart } from "@/lib/services/travel-calendar-sources";

// Advisor plan Phase 4, workstream 4G (Emi, D8): the stored day load.
//
// The coach's early-morning visit (4B's job, 03:00 to 05:59 local) calls `computeDayLoad`
// for the day about to start and stores it with `recordDayLoad`. That day is used
// because a live calendar read must start today. The load counts only real lengths
// (packages/core/src/resolvers/day-load.resolver.ts). Calendars are read only when the
// person's calendar source is on (4F's settings helper; the caller passes the answer).
// A failed calendar read stores the row without calendar numbers instead of failing.

export { DAY_LOAD_VERSION, type DayLoad };

export type DayLoadReads = Readonly<{
  behaviors(): Promise<ReadonlyArray<Readonly<{ id: string; default_duration_minutes?: number | null }>>>;
  occurrences(startLocalDate: string, endLocalDate: string): Promise<ReadonlyArray<Readonly<{
    id: string; behavior_id: string; local_date: string; status: string;
  }>>>;
  sessions(startLocalDate: string | null, endLocalDate: string, throughStartedAt: string): Promise<ReadonlyArray<Readonly<{
    id: string; user_id: string; occurrence_id: string; behavior_id: string; started_at: string; stopped_at: string | null;
  }>>>;
  /** The day's events from every connected calendar, or null when none could be read. */
  calendarEvents(localDate: string): Promise<readonly NormalizedExternalEvent[] | null>;
}>;

export async function computeDayLoad(reads: DayLoadReads, input: Readonly<{
  localDate: string;
  timezone: string;
  now: Temporal.Instant;
  calendarSourceOn: boolean;
}>): Promise<DayLoad> {
  const day = Temporal.PlainDate.from(input.localDate);
  const historyStart = "0001-01-01";
  const historyEnd = day.subtract({ days: 1 }).toString();
  const [behaviors, dayItems, history, sessions, calendarEvents] = await Promise.all([
    reads.behaviors(),
    reads.occurrences(input.localDate, input.localDate),
    reads.occurrences(historyStart, historyEnd),
    reads.sessions(null, historyEnd, input.now.toString()),
    input.calendarSourceOn ? reads.calendarEvents(input.localDate).catch(() => null) : Promise.resolve(null),
  ]);
  const byOccurrence = new Map<string, typeof sessions[number][]>();
  for (const session of sessions) byOccurrence.set(session.occurrence_id, [...(byOccurrence.get(session.occurrence_id) ?? []), session]);
  const durationHistory: BehaviorDurationHistoryOccurrence[] = history.map((occurrence) => ({
    id: occurrence.id, behaviorId: occurrence.behavior_id, localDate: occurrence.local_date,
    status: occurrence.status as BehaviorDurationHistoryOccurrence["status"],
    sessions: (byOccurrence.get(occurrence.id) ?? []).map((session) => ({
      id: session.id, userId: session.user_id, occurrenceId: session.occurrence_id, behaviorId: session.behavior_id,
      startedAt: session.started_at, stoppedAt: session.stopped_at,
    })),
  }));
  // The estimate's own "today" is the day being measured, so its history ends the day before.
  const asOf = day.toZonedDateTime({ timeZone: input.timezone }).toInstant();
  const lengths = new Map<string, BehaviorDurationEstimate>(behaviors.map((behavior) => [behavior.id, resolveBehaviorDurationEstimate({
    behaviorId: behavior.id, defaultDurationMinutes: behavior.default_duration_minutes,
    occurrences: durationHistory.filter((occurrence) => occurrence.behaviorId === behavior.id), now: asOf, timezone: input.timezone,
  })]));
  return resolveDayLoad({
    localDate: input.localDate, timezone: input.timezone,
    items: dayItems.map((occurrence) => ({ behaviorId: occurrence.behavior_id })),
    lengths, calendarEvents,
  });
}

/** The hosted reads, as the person, on the caller's client (the coach token in 4B's job). */
export function createHostedDayLoadReads(caller: CalendarReadCaller): DayLoadReads {
  const userId = caller.user.id;
  return {
    behaviors: () => listUserBehaviors(caller.client, userId),
    // Paged: 90 days of history can pass the API's 1,000-row cap.
    occurrences: (start, end) => readAllPostgrestRows({
      label: "day load occurrences",
      createQuery: () => caller.client.from("occurrences").select("id,behavior_id,local_date,status")
        .eq("user_id", userId).gte("local_date", start).lte("local_date", end).order("id"),
      getRowKey: (row) => row.id,
    }),
    sessions: (start, end, through) => listTimeSessionHistory(caller.client, {
      userId, startLocalDate: start, endLocalDate: end, includeArchived: true, throughStartedAt: through,
    }),
    async calendarEvents(localDate) {
      const connections = await readTravelCalendarConnections(caller);
      const takingPart = travelCalendarSourcesTakingPart(connections).length;
      if (takingPart === 0) return null;
      const events = await readTravelCalendarEvents(caller, connections, { scope: "day", startLocalDate: localDate, endLocalDate: localDate });
      // Calendar numbers only when every connected calendar was read in full.
      return events.unavailable.length === 0 && events.complete ? events.all : null;
    },
  };
}

/** Coach token only: stores (or replaces) one day's row. */
export async function recordDayLoad(client: AppSupabaseClient, runId: string, load: DayLoad): Promise<void> {
  const { error } = await (client as unknown as {
    rpc(fn: "coach_record_day_load", args: Record<string, unknown>): Promise<{ error: unknown }>;
  }).rpc("coach_record_day_load", {
    p_run_id: runId,
    p_local_date: load.localDate,
    p_load_version: DAY_LOAD_VERSION,
    p_load: {
      calendar_minutes: load.calendarMinutes, calendar_events: load.calendarEvents, item_minutes: load.itemMinutes,
      items_counted: load.itemsCounted, items_no_length: load.itemsNoLength,
    } satisfies Json,
  });
  if (error) throw new Error("day_load_record_failed");
}

/** Coach token only: stored rows from `from` to `to` (at most 400 days). */
export async function readDayLoads(client: AppSupabaseClient, from: string, to: string): Promise<DayLoad[]> {
  const { data, error } = await (client as unknown as {
    rpc(fn: "coach_day_loads", args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
  }).rpc("coach_day_loads", { p_from: from, p_to: to });
  if (error || !Array.isArray(data)) throw new Error("day_load_read_failed");
  return data.map((row: Record<string, unknown>) => ({
    localDate: String(row.local_date),
    calendarMinutes: row.calendar_minutes === null ? null : Number(row.calendar_minutes),
    calendarEvents: row.calendar_events === null ? null : Number(row.calendar_events),
    itemMinutes: Number(row.item_minutes),
    itemsCounted: Number(row.items_counted),
    itemsNoLength: Number(row.items_no_length),
  }));
}
