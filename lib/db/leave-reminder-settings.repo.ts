import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";

// Ticket 279, decision D3. The leave reminder switch, read and written as the
// signed-in user under RLS. The database trigger records when reminders turned
// on, asks the job for a visit, and deletes the account's reminder rows when
// they turn off (decision D15). This file never reads reminder rows.

export async function readLeaveReminderEnabled(client: AppSupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await client
    .from("travel_leave_reminder_settings")
    .select("enabled")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data?.enabled === true;
}

export async function writeLeaveReminderEnabled(client: AppSupabaseClient, userId: string, enabled: boolean): Promise<boolean> {
  const { data, error } = await client
    .from("travel_leave_reminder_settings")
    .upsert({ user_id: userId, enabled }, { onConflict: "user_id" })
    .select("enabled")
    .single();
  if (error) throw error;
  return data.enabled;
}
