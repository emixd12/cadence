import type {
  RecordedActivity,
  RecordedActivitySourceV1_1,
} from "@cadence/core/types/recorded-activity";
import type { AppSupabaseClient } from "./behaviors.repo";

export type RecordedActivityRow = Readonly<{
  id: string;
  user_id: string;
  source: RecordedActivitySourceV1_1;
  activity_ref: string;
  kind: "workout";
  start_at: string;
  end_at: string;
  local_start_date: string;
  duration_seconds: number;
  selector_digest: string | null;
  provider_updated_at: string | null;
  state: "active" | "removed";
  account_digest: string;
  connection_generation: number;
  synced_at: string;
}>;

export type UpsertRecordedActivityInput = Readonly<{
  source: RecordedActivitySourceV1_1;
  activity_ref: string;
  kind: "workout";
  start_at: string;
  end_at: string;
  local_start_date: string;
  duration_seconds: number;
  selector_digest: string | null;
  provider_updated_at: string | null;
  state: "active" | "removed";
  account_digest: string;
  connection_generation: number;
  synced_at: string;
}>;

export function toRecordedActivity(row: RecordedActivityRow): RecordedActivity {
  return {
    id: row.activity_ref,
    kind: row.kind,
    startAt: row.start_at,
    endAt: row.end_at,
    duration: { kind: "known", seconds: row.duration_seconds },
    localStartDate: row.local_start_date,
    revision: row.provider_updated_at
      ? { availability: "available", providerUpdatedAt: row.provider_updated_at }
      : { availability: "unavailable", providerUpdatedAt: null },
    fieldAvailability: { location: "unsupported", sourceTimezone: "unsupported" },
  };
}

export async function upsertRecordedActivities(
  client: AppSupabaseClient,
  userId: string,
  rows: readonly UpsertRecordedActivityInput[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const payload = rows.map((row) => ({ ...row, user_id: userId }));
  const { error } = await client
    .from("recorded_activities")
    .upsert(payload, { onConflict: "user_id,source,activity_ref" });
  if (error) throw error;
  return payload.length;
}

export async function markRecordedActivitiesRemoved(
  client: AppSupabaseClient,
  userId: string,
  source: RecordedActivitySourceV1_1,
  activityRefs: readonly string[],
  syncedAt: string,
): Promise<number> {
  const unique = [...new Set(activityRefs)];
  if (unique.length === 0) return 0;
  const { error } = await client
    .from("recorded_activities")
    .update({ state: "removed", synced_at: syncedAt })
    .eq("user_id", userId)
    .eq("source", source)
    .in("activity_ref", unique);
  if (error) throw error;
  return unique.length;
}

export async function listRecordedActivitiesInRange(
  client: AppSupabaseClient,
  userId: string,
  source: RecordedActivitySourceV1_1,
  startLocalDate: string,
  endLocalDate: string,
  options: Readonly<{ signal?: AbortSignal; connectionGeneration?: number }> = {},
): Promise<RecordedActivityRow[]> {
  let query = client
    .from("recorded_activities")
    .select(
      "id,user_id,source,activity_ref,kind,start_at,end_at,local_start_date,duration_seconds,selector_digest,provider_updated_at,state,account_digest,connection_generation,synced_at",
    )
    .eq("user_id", userId)
    .eq("source", source)
    .eq("state", "active")
    .gte("local_start_date", startLocalDate)
    .lte("local_start_date", endLocalDate)
    .order("start_at", { ascending: true });
  if (options.connectionGeneration !== undefined) {
    query = query.eq("connection_generation", options.connectionGeneration);
  }
  if (options.signal && query.abortSignal) query = query.abortSignal(options.signal);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as RecordedActivityRow[];
}

export async function deleteRecordedActivitiesForSource(
  client: AppSupabaseClient,
  userId: string,
  source: RecordedActivitySourceV1_1,
): Promise<void> {
  const { error } = await client
    .from("recorded_activities")
    .delete()
    .eq("user_id", userId)
    .eq("source", source);
  if (error) throw error;
}
