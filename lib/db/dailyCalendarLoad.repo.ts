import type { DailyCalendarLoadEntry } from "@cadence/core/resolvers/calendar-load.resolver";
import type { ExternalEventSource } from "@cadence/core/types/day-progress";
import type { AppSupabaseClient } from "./behaviors.repo";

export type DailyCalendarLoadRow = Readonly<{
  user_id: string;
  source: ExternalEventSource;
  local_date: string;
  busy_minutes: number;
  event_count: number;
  earliest_start_minute: number | null;
  latest_end_minute: number | null;
  has_all_day_busy: boolean;
  connection_generation: number;
  synced_at: string;
}>;

export async function upsertDailyCalendarLoad(
  client: AppSupabaseClient,
  userId: string,
  source: ExternalEventSource,
  connectionGeneration: number,
  entries: readonly DailyCalendarLoadEntry[],
  syncedAt: string,
): Promise<number> {
  if (entries.length === 0) return 0;
  const payload = entries.map((entry) => ({
    user_id: userId,
    source,
    local_date: entry.localDate,
    busy_minutes: entry.busyMinutes,
    event_count: entry.eventCount,
    earliest_start_minute: entry.earliestStartMinute,
    latest_end_minute: entry.latestEndMinute,
    has_all_day_busy: entry.hasAllDayBusy,
    connection_generation: connectionGeneration,
    synced_at: syncedAt,
  }));
  const { error } = await client
    .from("daily_calendar_load")
    .upsert(payload, { onConflict: "user_id,source,local_date" });
  if (error) throw error;
  return payload.length;
}

export async function listDailyCalendarLoad(
  client: AppSupabaseClient,
  userId: string,
  startLocalDate: string,
  endLocalDate: string,
  options: Readonly<{ sources?: readonly ExternalEventSource[]; signal?: AbortSignal }> = {},
): Promise<DailyCalendarLoadRow[]> {
  let query = client
    .from("daily_calendar_load")
    .select(
      "user_id,source,local_date,busy_minutes,event_count,earliest_start_minute,latest_end_minute,has_all_day_busy,connection_generation,synced_at",
    )
    .eq("user_id", userId)
    .gte("local_date", startLocalDate)
    .lte("local_date", endLocalDate)
    .order("local_date", { ascending: true })
    .order("source", { ascending: true });
  if (options.sources && options.sources.length > 0) {
    query = query.in("source", [...options.sources]);
  }
  if (options.signal && query.abortSignal) query = query.abortSignal(options.signal);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as DailyCalendarLoadRow[];
}

export async function deleteDailyCalendarLoadForSource(
  client: AppSupabaseClient,
  userId: string,
  source: ExternalEventSource,
): Promise<void> {
  const { error } = await client
    .from("daily_calendar_load")
    .delete()
    .eq("user_id", userId)
    .eq("source", source);
  if (error) throw error;
}
