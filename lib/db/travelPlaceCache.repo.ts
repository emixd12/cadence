import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";

export type TravelPlaceCacheRow = Readonly<{
  textKey: string;
  outcome: "resolved" | "unresolved" | "ambiguous";
  placeId: string | null;
  lookedUpAt: string;
}>;

export async function readTravelPlaceCache(
  supabase: AppSupabaseClient,
  userId: string,
  textKeys: readonly string[],
): Promise<TravelPlaceCacheRow[]> {
  if (!textKeys.length) return [];
  const { data, error } = await supabase.from("travel_place_cache")
    .select("text_key,outcome,place_id,looked_up_at")
    .eq("user_id", userId)
    .in("text_key", [...textKeys]);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    textKey: row.text_key,
    outcome: row.outcome as TravelPlaceCacheRow["outcome"],
    placeId: row.place_id,
    lookedUpAt: row.looked_up_at,
  }));
}

export async function writeTravelPlaceCache(
  supabase: AppSupabaseClient,
  userId: string,
  rows: readonly TravelPlaceCacheRow[],
): Promise<void> {
  if (!rows.length) return;
  const { error } = await supabase.from("travel_place_cache").upsert(rows.map((row) => ({
    user_id: userId,
    text_key: row.textKey,
    outcome: row.outcome,
    place_id: row.placeId,
    looked_up_at: row.lookedUpAt,
  })), { onConflict: "user_id,text_key" });
  if (error) throw error;
}
