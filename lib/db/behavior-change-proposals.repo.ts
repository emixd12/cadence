import type {
  BehaviorChangeDirection,
  BehaviorChangeStatus,
  ProposalSchedule,
  ProposeBehaviorChangeInput,
} from "@cadence/core/services/behavior-change-proposal";
import type { Weekday } from "@cadence/core/types/recurrence";

import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import type { Json } from "@/lib/db/database.types";

// Advisor Phase 4C: database access for base schedule proposals. The table is server
// only (cadence_advisor_private.behavior_change_proposals); every read and write goes
// through one of four functions. The coach token proposes; the person reads and answers.

export class BehaviorChangeProposalError extends Error {
  constructor(public readonly code: "not_found" | "closed" | "invalid_input" | "failed") {
    super(`Schedule proposal: ${code}.`);
    this.name = "BehaviorChangeProposalError";
  }
}

export type BehaviorChangeCloseReason = "unanswered" | "schedule_changed" | "kept" | "no_answer" | "edited_during_trial";

export type BehaviorChangeProposalRow = Readonly<{
  id: string;
  behaviorId: string;
  createdLocalDate: string;
  weekdays: Weekday[];
  fromTime: string;
  toTime: string;
  direction: BehaviorChangeDirection;
  schedulesBefore: ProposalSchedule[];
  schedulesAfter: ProposalSchedule[];
  firstAffectedDate: string;
  reason: string;
  status: BehaviorChangeStatus;
  closeReason: BehaviorChangeCloseReason | null;
  acceptedLocalDate: string | null;
  checkInDate: string | null;
  noticeShownAt: string | null;
  replayed: boolean;
}>;

export type CoachBehaviorChangeState = Readonly<{
  hasOpen: boolean;
  declined: ReadonlyArray<Readonly<{ behaviorId: string; direction: BehaviorChangeDirection; declinedAt: string }>>;
}>;

/** Coach token: stores a proposal, or returns why the database refused it. */
export async function coachProposeBehaviorChange(client: AppSupabaseClient, runId: string, proposal: ProposeBehaviorChangeInput):
  Promise<Readonly<{ id: string } | { refused: string }>> {
  const body: Record<string, unknown> = { ...proposal };
  delete body.run_id;
  const { data, error } = await client.rpc("coach_propose_behavior_change", { p_run_id: runId, p_proposal: body as unknown as Json });
  if (error) throw new BehaviorChangeProposalError("failed");
  const result = data as { id?: string; refused?: string } | null;
  if (result?.id) return { id: result.id };
  return { refused: result?.refused ?? "unknown" };
}

/** Coach token: an open proposal, and Nos inside the 30-day cooldown. */
export async function readCoachBehaviorChangeState(client: AppSupabaseClient): Promise<CoachBehaviorChangeState> {
  const { data, error } = await client.rpc("coach_behavior_change_state");
  if (error) throw new BehaviorChangeProposalError("failed");
  const value = data as { has_open?: boolean; declined?: Array<{ behavior_id: string; direction: BehaviorChangeDirection; declined_at: string }> } | null;
  return {
    hasOpen: Boolean(value?.has_open),
    declined: (value?.declined ?? []).map((row) => ({ behaviorId: row.behavior_id, direction: row.direction, declinedAt: row.declined_at })),
  };
}

/** The person: the one proposal to show as of their local date, or null. */
export async function readBehaviorChangeProposal(client: AppSupabaseClient, today: string): Promise<BehaviorChangeProposalRow | null> {
  const { data, error } = await client.rpc("read_behavior_change_proposal", { p_today: today });
  if (error) throw mapError(error);
  return data ? toRow(data) : null;
}

export type BehaviorChangeAnswerKind = "try" | "for_good" | "no" | "schedule_changed" | "keep" | "go_back" | "edited" | "notice_seen";

/** The person records an answer. A repeat of an answer that took effect is a replay. */
export async function answerBehaviorChangeProposal(client: AppSupabaseClient, input: Readonly<{
  proposalId: string; answer: BehaviorChangeAnswerKind; today: string; checkInDate?: string | null;
}>): Promise<BehaviorChangeProposalRow> {
  const { data, error } = await client.rpc("answer_behavior_change_proposal", {
    p_proposal_id: input.proposalId, p_answer: input.answer, p_today: input.today,
    ...(input.checkInDate ? { p_check_in_date: input.checkInDate } : {}),
  });
  if (error) throw mapError(error);
  if (!data) throw new BehaviorChangeProposalError("failed");
  return toRow(data);
}

function mapError(error: { message?: string; code?: string }): Error {
  if (error.message === "behavior_change_not_found" || error.code === "P0002") return new BehaviorChangeProposalError("not_found");
  if (error.message === "behavior_change_closed") return new BehaviorChangeProposalError("closed");
  if (error.message === "behavior_change_invalid_input" || error.code === "22023") return new BehaviorChangeProposalError("invalid_input");
  return new BehaviorChangeProposalError("failed");
}

function toRow(data: Json): BehaviorChangeProposalRow {
  const row = data as Record<string, unknown>;
  return {
    id: String(row.id),
    behaviorId: String(row.behavior_id),
    createdLocalDate: String(row.created_local_date),
    weekdays: row.weekdays as Weekday[],
    fromTime: String(row.from_time),
    toTime: String(row.to_time),
    direction: row.direction as BehaviorChangeDirection,
    schedulesBefore: row.schedules_before as ProposalSchedule[],
    schedulesAfter: row.schedules_after as ProposalSchedule[],
    firstAffectedDate: String(row.first_affected_date),
    reason: String(row.reason),
    status: row.status as BehaviorChangeStatus,
    closeReason: (row.close_reason ?? null) as BehaviorChangeCloseReason | null,
    acceptedLocalDate: (row.accepted_local_date ?? null) as string | null,
    checkInDate: (row.check_in_date ?? null) as string | null,
    noticeShownAt: (row.notice_shown_at ?? null) as string | null,
    replayed: row.replayed === true,
  };
}
