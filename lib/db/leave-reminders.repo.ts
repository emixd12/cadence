import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";

// Ticket 276, decision D3. Choosing which accounts the leave reminder job
// visits is the job's one cross-account read. It runs on the service role and
// reads only account ids and next check times; the migration grants the
// service role nothing else on these tables. Everything else the job does runs
// as the user on `createLeaveReminderCaller`'s client.

export type DueLeaveReminderAccount = Readonly<{
  userId: string;
  nextCheckAt: string;
}>;

export const LEAVE_REMINDER_ACCOUNT_BATCH_MAX = 100;

export async function selectDueLeaveReminderAccounts(
  serviceRole: AppSupabaseClient,
  input: Readonly<{ dueBy: Date; limit: number }>,
): Promise<DueLeaveReminderAccount[]> {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > LEAVE_REMINDER_ACCOUNT_BATCH_MAX) {
    throw new RangeError(`Leave reminder batch must be 1–${LEAVE_REMINDER_ACCOUNT_BATCH_MAX} accounts.`);
  }
  if (!Number.isFinite(input.dueBy.getTime())) {
    throw new TypeError("Leave reminder due time is invalid.");
  }

  const { data, error } = await serviceRole
    .from("travel_leave_reminder_settings")
    .select("user_id, next_check_at")
    .eq("enabled", true)
    .lte("next_check_at", input.dueBy.toISOString())
    .order("next_check_at", { ascending: true })
    .limit(input.limit);

  if (error) throw error;

  return (data ?? []).flatMap((row) =>
    row.next_check_at ? [{ userId: row.user_id, nextCheckAt: row.next_check_at }] : [],
  );
}
