import type {
  PeriodCreateCommit,
  PeriodDataStore,
  PeriodDeleteCommit,
  PeriodUpdateCommit,
} from "@cadence/core/data-store";
import type { PeriodRecord } from "@cadence/core/resolvers/period.resolver";
import { PERIOD_LIMIT_MESSAGE } from "@cadence/core/services/period.service";

import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import { readAllPostgrestRows } from "@/lib/db/paginated-read";
import type { Period } from "@/lib/types/database";

/** SQLSTATE the `periods_enforce_account_cap` trigger raises at 500 Periods. */
const PERIOD_CAP_SQLSTATE = "54000";

export function createPeriodStore(
  supabase: AppSupabaseClient,
  userId: string,
): PeriodDataStore {
  return {
    listPeriods: (range) => listPeriods(supabase, userId, range),
    getPeriod: (id) => getPeriod(supabase, userId, id),
    createPeriod: (input) => createPeriod(supabase, input),
    updatePeriod: (input) => updatePeriodIfExpected(supabase, input),
    deletePeriod: (input) => deletePeriodIfExpected(supabase, input),
  };
}

// Paged, like every user-scoped read. An account holds at most 500 Periods, so this
// is one page today. With a range, returns the Periods that have a day inside it:
// first day on or before `to`, and ongoing or last day on or after `from`.
export async function listPeriods(
  supabase: AppSupabaseClient,
  userId: string,
  range?: { from: string; to: string },
): Promise<PeriodRecord[]> {
  return readAllPostgrestRows<Period>({
    label: "Periods",
    getRowKey: (row) => row.id,
    createQuery: () => {
      const query = supabase.from("periods").select("*").eq("user_id", userId);
      const ranged = range
        ? query.lte("start_on", range.to).or(`end_on.is.null,end_on.gte.${range.from}`)
        : query;
      return ranged
        .order("start_on", { ascending: true })
        .order("id", { ascending: true });
    },
  });
}

export async function getPeriod(
  supabase: AppSupabaseClient,
  userId: string,
  id: string,
): Promise<PeriodRecord | null> {
  const { data, error } = await supabase
    .from("periods")
    .select("*")
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function createPeriod(
  supabase: AppSupabaseClient,
  input: PeriodCreateCommit,
): Promise<PeriodRecord> {
  const { data, error } = await supabase
    .rpc("create_period", {
      p_label: input.label,
      p_start_on: input.startOn,
      p_end_on: input.endOn as unknown as string,
      p_note: input.note as unknown as string,
    })
    .maybeSingle();
  if (error) {
    if (error.code === PERIOD_CAP_SQLSTATE) throw new Error(PERIOD_LIMIT_MESSAGE);
    throw error;
  }
  if (!data) throw new Error("The period was not saved.");
  return data as Period;
}

/** Returns null when the Period is gone or its revision differs from the expected one. */
export async function updatePeriodIfExpected(
  supabase: AppSupabaseClient,
  input: PeriodUpdateCommit,
): Promise<PeriodRecord | null> {
  const { data, error } = await supabase
    .rpc("update_period", {
      p_id: input.id,
      p_expected_revision: input.expectedRevision,
      p_label: input.label,
      p_start_on: input.startOn,
      p_end_on: input.endOn as unknown as string,
      p_note: input.note as unknown as string,
    })
    .maybeSingle();
  if (error) throw error;
  return (data as Period | null) ?? null;
}

/** Returns the deleted id, or null when the Period is gone or its revision differs. */
export async function deletePeriodIfExpected(
  supabase: AppSupabaseClient,
  input: PeriodDeleteCommit,
): Promise<string | null> {
  const { data, error } = await supabase.rpc("delete_period", {
    p_id: input.id,
    p_expected_revision: input.expectedRevision,
  });
  if (error) throw error;
  const deleted: unknown = Array.isArray(data) ? data[0] : data;
  return typeof deleted === "string" ? deleted : null;
}
