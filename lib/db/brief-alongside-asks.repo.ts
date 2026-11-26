import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";

// Ticket 360 follow-up (D33): which Behaviors' alongside question a saved Daily Brief
// already included (`public.brief_alongside_asks`, migration 20261126100000). Owner-only
// RLS; runs on the person's own client. Ids and dates only.

/** The Behaviors among `behaviorIds` that a brief before `localDate` already asked about. */
export async function readBriefAlongsideAskedBefore(client: AppSupabaseClient,
  input: Readonly<{ userId: string; behaviorIds: readonly string[]; localDate: string }>): Promise<ReadonlySet<string>> {
  if (!input.behaviorIds.length) return new Set();
  const { data, error } = await client.from("brief_alongside_asks").select("behavior_id")
    .eq("user_id", input.userId).in("behavior_id", [...new Set(input.behaviorIds)]).lt("local_date", input.localDate);
  if (error) throw error;
  return new Set((data ?? []).map((row) => row.behavior_id));
}

/** Records the first brief that asked about `behaviorId`. A later brief keeps the first date. */
export async function recordBriefAlongsideAsk(client: AppSupabaseClient,
  input: Readonly<{ userId: string; behaviorId: string; localDate: string }>): Promise<void> {
  const { error } = await client.from("brief_alongside_asks")
    .upsert({ user_id: input.userId, behavior_id: input.behaviorId, local_date: input.localDate },
      { onConflict: "user_id,behavior_id", ignoreDuplicates: true });
  if (error) throw error;
}
