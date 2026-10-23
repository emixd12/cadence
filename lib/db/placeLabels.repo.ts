import type {
  CompletionPlaceLabelRecord,
  PlaceLabelBehaviorRecord,
  PlaceLabelSettingsRecord,
  PlaceMarkerRecord,
  WhereSuggestionDismissalRecord,
} from "@cadence/core/types/place-labels";
import type { AppSupabaseClient } from "./behaviors.repo";

export type PlaceLabelSettingsRow = PlaceLabelSettingsRecord;
export type PlaceMarkerRow = PlaceMarkerRecord;
export type CompletionPlaceLabelRow = CompletionPlaceLabelRecord;
export type WhereSuggestionDismissalRow = WhereSuggestionDismissalRecord;
export type PlaceLabelBehaviorRow = PlaceLabelBehaviorRecord;

const SETTINGS = "enabled,retention,enabled_at,marker_prompt_dismissed_at,updated_at";
const MARKERS = "id,place_key,latitude_e6,longitude_e6,accuracy_meters,rule_version,recorded_at";
const LABELS = "id,behavior_id,local_date,label,rule_version,recorded_at";

export async function readPlaceLabelSettingsRow(client: AppSupabaseClient, userId: string): Promise<PlaceLabelSettingsRow | null> {
  const { data, error } = await client.from("place_label_settings").select(SETTINGS).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data as PlaceLabelSettingsRow | null;
}

export async function savePlaceLabelSettingsRow(client: AppSupabaseClient, input: {
  enabled: boolean;
  retention: string;
  markerPromptDismissed: boolean;
  expectedUpdatedAt: string | null;
  retentionCutoff: string | null;
}): Promise<PlaceLabelSettingsRow> {
  const { data, error } = await client.rpc("save_place_label_settings", {
    next_enabled: input.enabled,
    next_retention: input.retention,
    next_marker_prompt_dismissed: input.markerPromptDismissed,
    // The generated RPC types omit SQL nullability for these arguments.
    expected_updated_at: input.expectedUpdatedAt as string,
    retention_cutoff: input.retentionCutoff as string,
  });
  if (error) throw error;
  const row = (data as PlaceLabelSettingsRow[] | null)?.[0];
  if (!row) throw new Error("Place label settings were not saved.");
  return row;
}

export async function readPlaceMarkerRows(client: AppSupabaseClient, userId: string): Promise<PlaceMarkerRow[]> {
  const { data, error } = await client.from("place_markers").select(MARKERS).eq("user_id", userId).order("id");
  if (error) throw error;
  return (data ?? []) as PlaceMarkerRow[];
}

export async function upsertPlaceMarkerRow(client: AppSupabaseClient, userId: string, row: PlaceMarkerRow): Promise<void> {
  const { error } = await client.from("place_markers").upsert({ ...row, user_id: userId }, { onConflict: "user_id,id" });
  if (error) throw error;
}

export async function deletePlaceMarkerRows(client: AppSupabaseClient, userId: string, id: string | null): Promise<void> {
  let query = client.from("place_markers").delete().eq("user_id", userId);
  if (id !== null) query = query.eq("id", id);
  const { error } = await query;
  if (error) throw error;
}

export async function readCompletionPlaceLabelRows(client: AppSupabaseClient, userId: string): Promise<CompletionPlaceLabelRow[]> {
  const { data, error } = await client.from("completion_place_labels").select(LABELS).eq("user_id", userId).order("local_date");
  if (error) throw error;
  return (data ?? []) as CompletionPlaceLabelRow[];
}

export async function insertCompletionPlaceLabelRow(client: AppSupabaseClient, userId: string, row: CompletionPlaceLabelRow): Promise<void> {
  const { error } = await client.from("completion_place_labels").insert({ ...row, user_id: userId });
  if (error) throw error;
}

/** Deletes every label, or only those with a local date before `before`. */
export async function deleteCompletionPlaceLabelRows(client: AppSupabaseClient, userId: string, before: string | null): Promise<void> {
  let query = client.from("completion_place_labels").delete().eq("user_id", userId);
  if (before !== null) query = query.lt("local_date", before);
  const { error } = await query;
  if (error) throw error;
}

export async function readWhereSuggestionDismissalRows(client: AppSupabaseClient, userId: string): Promise<WhereSuggestionDismissalRow[]> {
  const { data, error } = await client.from("where_suggestion_dismissals").select("id,suggestion,rule_version,dismissed_at").eq("user_id", userId);
  if (error) throw error;
  return (data ?? []) as WhereSuggestionDismissalRow[];
}

export async function upsertWhereSuggestionDismissalRow(client: AppSupabaseClient, userId: string, row: WhereSuggestionDismissalRow): Promise<void> {
  const { error } = await client.from("where_suggestion_dismissals").upsert({ ...row, user_id: userId }, { onConflict: "id" });
  if (error) throw error;
}

export async function readPlaceLabelBehaviorRows(client: AppSupabaseClient, userId: string): Promise<PlaceLabelBehaviorRow[]> {
  const { data, error } = await client.from("behaviors").select("id,active,where_kind,location_text")
    .eq("user_id", userId).order("created_at").order("id");
  if (error) throw error;
  return (data ?? []) as PlaceLabelBehaviorRow[];
}

export async function readProfileTimezone(client: AppSupabaseClient, userId: string): Promise<string | null> {
  const { data, error } = await client.from("profiles").select("timezone").eq("id", userId).maybeSingle();
  if (error) throw error;
  return (data as { timezone: string } | null)?.timezone ?? null;
}

/** Service-role maintenance: deletes labels past each account's retention. */
export async function purgeExpiredCompletionPlaceLabels(client: AppSupabaseClient): Promise<number> {
  const { data, error } = await client.rpc("purge_expired_completion_place_labels");
  if (error) throw error;
  return typeof data === "number" ? data : 0;
}
