import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import type { Profile } from "@/lib/types/database";

export type ProfileSettings = Pick<Profile, "email" | "timezone">;
export type ProfileOccurrenceSyncTarget = Pick<Profile, "id" | "timezone">;

export async function getProfileSettings(
  supabase: AppSupabaseClient,
  userId: string,
): Promise<ProfileSettings | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("email, timezone")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ?? null;
}

export async function listProfileOccurrenceSyncTargets(
  supabase: AppSupabaseClient,
  options: { limit: number },
): Promise<ProfileOccurrenceSyncTarget[]> {
  const { data: syncTargets, error: syncTargetError } = await supabase
    .from("occurrence_sync_state")
    .select("user_id")
    .order("stale", { ascending: false })
    .order("synced_through_local_date", {
      ascending: true,
      nullsFirst: true,
    })
    .order("updated_at", { ascending: true })
    .order("user_id", { ascending: true })
    .limit(options.limit);

  if (syncTargetError) {
    throw syncTargetError;
  }

  if (!syncTargets?.length) {
    return [];
  }

  const orderedUserIds = syncTargets.map((target) => target.user_id);
  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select("id, timezone")
    .in("id", orderedUserIds);

  if (profileError) {
    throw profileError;
  }

  const timezoneByUserId = new Map(
    (profiles ?? []).map((profile) => [profile.id, profile.timezone]),
  );

  return orderedUserIds.reduce<ProfileOccurrenceSyncTarget[]>(
    (targets, userId) => {
      const timezone = timezoneByUserId.get(userId);

      if (timezone) {
        targets.push({ id: userId, timezone });
      }

      return targets;
    },
    [],
  );
}
