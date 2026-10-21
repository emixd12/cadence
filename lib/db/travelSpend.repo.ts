import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";

export type TravelSpendDecision = Readonly<{ allowed: boolean; retryAfterSeconds: number; resetsAt: string | null }>;

/** Reserves list-price microdollars before travel provider calls; refused requests reserve nothing. */
export async function reserveTravelProviderSpend(
  supabase: AppSupabaseClient,
  microdollars: number,
): Promise<TravelSpendDecision> {
  const { data, error } = await supabase.rpc("reserve_travel_provider_spend", { requested_microdollars: microdollars });
  if (error) throw error;
  const row = data?.[0];
  if (!row || typeof row.allowed !== "boolean" || !Number.isInteger(row.retry_after_seconds) || row.retry_after_seconds < 0
    || (row.allowed ? row.resets_at !== null : typeof row.resets_at !== "string")) {
    throw new Error("Travel spend reservation did not return a decision.");
  }
  return { allowed: row.allowed, retryAfterSeconds: row.retry_after_seconds, resetsAt: row.allowed ? null : row.resets_at };
}

/** Owner-scoped operator/workbench readback; this never reserves spend. */
export async function readTravelMonthSpend(supabase: AppSupabaseClient, userId: string, localMonth: string): Promise<number> {
  const { data, error } = await supabase.from("travel_spend_owner_month")
    .select("reserved_microdollars").eq("user_id", userId).eq("local_month", localMonth).maybeSingle();
  if (error) throw error;
  return data?.reserved_microdollars ?? 0;
}
