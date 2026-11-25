import { Temporal } from "@js-temporal/polyfill";
import type { DailyCalendarLoadEntry } from "@cadence/core/resolvers/calendar-load.resolver";
import type { ExternalEventSource } from "@cadence/core/types/day-progress";
import type { AppSupabaseClient } from "./behaviors.repo";

export type DailyCalendarLoadGrantPurpose = "standard" | "agent_mcp";
export const GOOGLE_CALENDAR_LOAD_MAX_RETENTION_DAYS = 30;

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
  grant_purpose?: DailyCalendarLoadGrantPurpose;
  expires_at?: string | null;
}>;

export type UpsertDailyCalendarLoadOptions = Readonly<{
  grantPurpose?: DailyCalendarLoadGrantPurpose;
  expiresAt?: string | null;
}>;

export function capGoogleCalendarLoadExpiresAt(syncedAt: string, requestedExpiresAt?: string | null): string {
  const syncedInstant = Temporal.Instant.from(syncedAt);
  const maxExpiry = syncedInstant.add({ seconds: GOOGLE_CALENDAR_LOAD_MAX_RETENTION_DAYS * 86_400 });
  if (!requestedExpiresAt) return maxExpiry.toString();
  try {
    const requestedInstant = Temporal.Instant.from(requestedExpiresAt);
    return Temporal.Instant.compare(requestedInstant, maxExpiry) <= 0
      ? requestedInstant.toString()
      : maxExpiry.toString();
  } catch {
    return maxExpiry.toString();
  }
}

export async function upsertDailyCalendarLoad(
  client: AppSupabaseClient,
  userId: string,
  source: ExternalEventSource,
  connectionGeneration: number,
  entries: readonly DailyCalendarLoadEntry[],
  syncedAt: string,
  options: UpsertDailyCalendarLoadOptions = {},
): Promise<number> {
  if (entries.length === 0) return 0;
  const grantPurpose: DailyCalendarLoadGrantPurpose = options.grantPurpose ?? "standard";
  // Q2 invariant: Google Calendar rows in daily_calendar_load may ONLY be written by agent_mcp reads.
  if (source === "google_calendar" && grantPurpose !== "agent_mcp") return 0;
  const expiresAt = source === "google_calendar"
    ? capGoogleCalendarLoadExpiresAt(syncedAt, options.expiresAt)
    : null;
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
    grant_purpose: source === "google_calendar" ? "agent_mcp" : "standard",
    expires_at: expiresAt,
  }));
  const { error } = await (client as unknown as {
    from: (table: string) => { upsert: (rows: unknown, opts: unknown) => Promise<{ error: unknown }> };
  })
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
  options: Readonly<{ sources?: readonly ExternalEventSource[]; signal?: AbortSignal; now?: Temporal.Instant }> = {},
): Promise<DailyCalendarLoadRow[]> {
  let query = client
    .from("daily_calendar_load")
    .select(
      "user_id,source,local_date,busy_minutes,event_count,earliest_start_minute,latest_end_minute,has_all_day_busy,connection_generation,synced_at,grant_purpose,expires_at",
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
  const nowInstant = options.now ?? Temporal.Now.instant();
  return ((data ?? []) as unknown as DailyCalendarLoadRow[]).filter((row) => {
    if (row.source === "google_calendar" && row.grant_purpose && row.grant_purpose !== "agent_mcp") return false;
    if (!row.expires_at) return true;
    try {
      return Temporal.Instant.compare(Temporal.Instant.from(row.expires_at), nowInstant) > 0;
    } catch {
      return false;
    }
  });
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
