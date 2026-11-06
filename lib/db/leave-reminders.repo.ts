import type { LeaveReminderRecord, LeaveReminderStatus } from "@cadence/core/services/leave-reminder-plan";

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

/**
 * Ticket 277 follow-up: the database's own time of the last hosted get-ready change
 * (`travel_settings.preparation_changed_at`, set only by a trigger). Unlike
 * `habits_updated_at`, no device clock writes it. Read as the user under RLS.
 */
export async function readTravelPreparationChangedAt(client: AppSupabaseClient, userId: string): Promise<string | null> {
  const { data, error } = await client.from("travel_settings")
    .select("preparation_changed_at").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data?.preparation_changed_at ?? null;
}

// Ticket 277: the job's reads and writes on its own records. Every function runs on
// the user's minted client (`createLeaveReminderCaller`), so RLS limits it to that
// account. Writes are compare-and-set on the claim, so overlapping runs cannot both
// route or send one reminder.

const LEAVE_REMINDER_COLUMNS =
  "id, trip_digest, local_date, status, next_check_at, route_count, processing_started_at, sent_at, update_sent_at, planned_preparation_minutes";

type LeaveReminderRow = Readonly<{
  id: string;
  trip_digest: string;
  local_date: string;
  status: string;
  next_check_at: string | null;
  route_count: number;
  processing_started_at: string | null;
  sent_at: string | null;
  update_sent_at: string | null;
  planned_preparation_minutes: number | null;
}>;

/** The fields the job may change on a claimed record. */
export type LeaveReminderRecordPatch = Partial<Readonly<{
  status: LeaveReminderStatus;
  next_check_at: string | null;
  route_count: number;
  processing_started_at: string | null;
  sent_at: string;
  update_sent_at: string;
  error: string | null;
  planned_preparation_minutes: number | null;
}>>;

export type LeaveReminderStore = Readonly<{
  /** Takes the account's visit: moves its next check to the lease end if it is unchanged. */
  claimAccount(expectedNextCheckAt: string, leaseUntil: string): Promise<boolean>;
  /**
   * Ends the visit: sets the next check if the lease is still this run's. Decision D19: a
   * get-ready change can replace the lease, and an overlapping visit may then set a later
   * next check from records this visit still held. So when the lease is gone, a later next
   * check is brought forward to this visit's own; it never moves later.
   */
  releaseAccount(leaseUntil: string, nextCheckAt: string): Promise<boolean>;
  remindersEnabled(): Promise<boolean>;
  listRecords(): Promise<LeaveReminderRecord[]>;
  deleteBefore(localDate: string): Promise<void>;
  /** Inserts a claimed pending record. Null when another run already has the trip. */
  insertClaimed(input: Readonly<{ tripDigest: string; localDate: string; now: string }>): Promise<LeaveReminderRecord | null>;
  /** Claims an unclaimed or stale record that is unchanged since it was read. */
  claim(record: LeaveReminderRecord, now: string, staleBefore: string): Promise<LeaveReminderRecord | null>;
  /** Writes a claimed record if the claim is still this run's. */
  finish(record: LeaveReminderRecord, patch: LeaveReminderRecordPatch): Promise<boolean>;
  /** Changes an unclaimed or stale record that is unchanged since it was read. */
  updateUnclaimed(record: LeaveReminderRecord, staleBefore: string, patch: LeaveReminderRecordPatch): Promise<boolean>;
}>;

export function createLeaveReminderStore(client: AppSupabaseClient, userId: string): LeaveReminderStore {
  const records = () => client.from("travel_leave_reminders");

  return {
    async claimAccount(expectedNextCheckAt, leaseUntil) {
      const { data, error } = await client.from("travel_leave_reminder_settings")
        .update({ next_check_at: leaseUntil })
        .eq("user_id", userId).eq("enabled", true).eq("next_check_at", expectedNextCheckAt)
        .select("user_id");
      if (error) throw error;
      return (data ?? []).length === 1;
    },
    async releaseAccount(leaseUntil, nextCheckAt) {
      const { data, error } = await client.from("travel_leave_reminder_settings")
        .update({ next_check_at: nextCheckAt })
        .eq("user_id", userId).eq("enabled", true).eq("next_check_at", leaseUntil)
        .select("user_id");
      if (error) throw error;
      if ((data ?? []).length === 1) return true;
      const { error: earlierError } = await client.from("travel_leave_reminder_settings")
        .update({ next_check_at: nextCheckAt })
        .eq("user_id", userId).eq("enabled", true).gt("next_check_at", nextCheckAt);
      if (earlierError) throw earlierError;
      return false;
    },
    async remindersEnabled() {
      const { data, error } = await client.from("travel_leave_reminder_settings")
        .select("enabled").eq("user_id", userId).maybeSingle();
      if (error) throw error;
      return data?.enabled === true;
    },
    async listRecords() {
      const { data, error } = await records().select(LEAVE_REMINDER_COLUMNS).eq("user_id", userId);
      if (error) throw error;
      return (data ?? []).map(toRecord);
    },
    async deleteBefore(localDate) {
      const { error } = await records().delete().eq("user_id", userId).lt("local_date", localDate);
      if (error) throw error;
    },
    async insertClaimed({ tripDigest, localDate, now }) {
      const { data, error } = await records()
        .insert({ user_id: userId, trip_digest: tripDigest, local_date: localDate, status: "pending",
          next_check_at: now, route_count: 0, processing_started_at: now })
        .select(LEAVE_REMINDER_COLUMNS).maybeSingle();
      // 23505: another run inserted the trip first. 23514: reminders were turned off.
      if (error && (error.code === "23505" || error.code === "23514")) return null;
      if (error) throw error;
      return data ? toRecord(data) : null;
    },
    async claim(record, now, staleBefore) {
      const { data, error } = await sameRecord(records().update({ processing_started_at: now }), record)
        .or(`processing_started_at.is.null,processing_started_at.lte.${staleBefore}`)
        .select(LEAVE_REMINDER_COLUMNS).maybeSingle();
      if (error) throw error;
      return data ? toRecord(data) : null;
    },
    async finish(record, patch) {
      if (!record.processingStartedAt) throw new Error("A leave reminder must be claimed before it is finished.");
      const { data, error } = await sameRecord(records().update(patch), record)
        .eq("processing_started_at", record.processingStartedAt)
        .select("id");
      if (error) throw error;
      return (data ?? []).length === 1;
    },
    async updateUnclaimed(record, staleBefore, patch) {
      const { data, error } = await sameRecord(records().update(patch), record)
        .or(`processing_started_at.is.null,processing_started_at.lte.${staleBefore}`)
        .select("id");
      if (error) throw error;
      return (data ?? []).length === 1;
    },
  };

  function sameRecord<Query extends { eq: (column: string, value: string | number) => Query; is: (column: string, value: null) => Query }>(
    query: Query,
    record: LeaveReminderRecord,
  ): Query {
    const scoped = query.eq("id", record.id).eq("user_id", userId).eq("status", record.status).eq("route_count", record.routeCount);
    const withCheck = record.nextCheckAt === null ? scoped.is("next_check_at", null) : scoped.eq("next_check_at", record.nextCheckAt);
    return record.updateSentAt === null ? withCheck.is("update_sent_at", null) : withCheck;
  }
}

function toRecord(row: LeaveReminderRow): LeaveReminderRecord {
  return {
    id: row.id,
    tripDigest: row.trip_digest,
    localDate: row.local_date,
    status: row.status as LeaveReminderStatus,
    nextCheckAt: row.next_check_at,
    routeCount: row.route_count,
    processingStartedAt: row.processing_started_at,
    sentAt: row.sent_at,
    updateSentAt: row.update_sent_at,
    plannedPreparationMinutes: row.planned_preparation_minutes,
  };
}
