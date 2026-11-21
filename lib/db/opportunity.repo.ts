import type { OpportunityAddedBy } from "@cadence/core/types/database";
import type { AppSupabaseClient } from "./behaviors.repo";
import type { Occurrence, OccurrenceStatusEvent } from "@/lib/types/database";

/**
 * Behaviors of Opportunity: the two hosted functions that add and remove an
 * `origin = 'opportunity'` Occurrence (supabase/migrations/20261121100000). Both run as
 * the signed-in user under RLS and take the account's advisory lock.
 */

export type AddOpportunityOccurrenceArgs = Readonly<{
  behaviorId: string;
  localDate: string;
  /** "HH:MM". */
  startTime: string;
  /** "HH:MM" for a range; null for an exact time. */
  endTime: string | null;
  preset: string | null;
  addedBy: OpportunityAddedBy;
  markCompleted: boolean;
  occurrenceId: string | null;
}>;

export type AddOpportunityOccurrenceRow = Readonly<{
  created: boolean;
  occurrence: Occurrence;
  statusEvent: OccurrenceStatusEvent | null;
}>;

export type RemoveOpportunityOccurrenceRow = Readonly<{
  occurrence: Occurrence;
  cancelledReminderCount: number;
}>;

/** A refusal or failure from either function, with Postgres's code and message. */
export class OpportunityRpcError extends Error {
  constructor(message: string, readonly code: string | null) {
    super(message);
    this.name = "OpportunityRpcError";
  }
}

export async function addOpportunityOccurrence(
  supabase: AppSupabaseClient,
  args: AddOpportunityOccurrenceArgs,
): Promise<AddOpportunityOccurrenceRow> {
  const { data, error } = await supabase.rpc("add_opportunity_occurrence", {
    target_behavior_id: args.behaviorId,
    planned_local_date: args.localDate,
    planned_start_time: args.startTime,
    ...(args.endTime === null ? {} : { planned_end_time: args.endTime }),
    ...(args.preset === null ? {} : { planned_preset: args.preset }),
    planned_added_by: args.addedBy,
    mark_completed: args.markCompleted,
    ...(args.occurrenceId === null ? {} : { planned_occurrence_id: args.occurrenceId }),
  });
  if (error) throw new OpportunityRpcError(error.message, error.code ?? null);
  const row = asRecord(data);
  if (!row || !asRecord(row.occurrence)) throw new OpportunityRpcError("Invalid opportunity result.", null);
  return {
    created: row.created === true,
    occurrence: row.occurrence as Occurrence,
    statusEvent: (asRecord(row.status_event) as OccurrenceStatusEvent | null) ?? null,
  };
}

export async function removeOpportunityOccurrence(
  supabase: AppSupabaseClient,
  occurrenceId: string,
): Promise<RemoveOpportunityOccurrenceRow> {
  const { data, error } = await supabase.rpc("remove_opportunity_occurrence", {
    target_occurrence_id: occurrenceId,
  });
  if (error) throw new OpportunityRpcError(error.message, error.code ?? null);
  const row = asRecord(data);
  if (!row || row.removed !== true || !asRecord(row.occurrence)) {
    throw new OpportunityRpcError("Invalid opportunity result.", null);
  }
  return {
    occurrence: row.occurrence as Occurrence,
    cancelledReminderCount: typeof row.cancelled_reminder_count === "number" ? row.cancelled_reminder_count : 0,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
