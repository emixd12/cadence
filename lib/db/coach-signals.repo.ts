import type {
  CoachBriefAnswerKind,
  CoachSignal,
  CoachSignalAnswer,
  CoachSignalDecision,
  CoachSignalMove,
  CoachSignalOccurrence,
  ResolveCoachSignalsInput,
} from "@cadence/core/resolvers/coach-signals.resolver";

import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import type { Json } from "@/lib/db/database.types";

// Advisor plan Phase 3, workstream 3D: database access for coach signals in shadow.
// `selectDueCoachAccounts` runs on the service role and calls only
// `coach_due_accounts`. Everything else runs on the coach agent's client, as the
// person, under RLS. Reads are bounded by date and paged.

const READ_PAGE = 1000;

export class CoachSignalsError extends Error {
  constructor(public readonly code: string) {
    super(`Coach signals failed: ${code}.`);
    this.name = "CoachSignalsError";
  }
}

export type DueCoachAccount = Readonly<{ userId: string; localDate: string }>;

/** Service role: which accounts are due, in user id order after `after`. */
export async function selectDueCoachAccounts(serviceRole: AppSupabaseClient,
  input: Readonly<{ after: string | null; limit: number }>): Promise<DueCoachAccount[]> {
  const { data, error } = await serviceRole.rpc("coach_due_accounts", { p_after: input.after as string, p_limit: input.limit });
  if (error) throw new CoachSignalsError("due_accounts_failed");
  return (data ?? []).map((row) => ({ userId: row.user_id, localDate: row.local_date }));
}

/** Coach token: replaces the run's local day of signals. Returns how many were stored. */
export async function recordCoachSignals(client: AppSupabaseClient, input: Readonly<{
  runId: string; signalVersion: string; signals: readonly CoachSignal[];
}>): Promise<number> {
  const { data, error } = await client.rpc("coach_record_signals", {
    p_run_id: input.runId,
    p_signal_version: input.signalVersion,
    p_signals: input.signals.map((signal) => ({ kind: signal.kind, behavior_id: signal.behaviorId, facts: signal.facts })) as unknown as Json,
  });
  if (error || typeof data !== "number") throw new CoachSignalsError("record_failed");
  return data;
}

export type CoachAnswersSource = "answers" | "proposals";

export type CoachSignalReads = Readonly<{
  behaviors(): Promise<ResolveCoachSignalsInput["behaviors"]>;
  occurrences(since: string, before: string): Promise<CoachSignalOccurrence[]>;
  decisions(since: string, before: string): Promise<CoachSignalDecision[]>;
  moves(since: string): Promise<CoachSignalMove[]>;
  answers(since: string): Promise<Readonly<{ source: CoachAnswersSource; rows: CoachSignalAnswer[] }>>;
}>;

const PROPOSAL_STATUS_ANSWERS: Readonly<Record<string, CoachBriefAnswerKind>> = {
  accepted: "yes",
  declined: "no",
  other_time: "other_time",
  already_done: "already_done",
  undone: "undo",
};

const ANSWER_KINDS: Readonly<Record<string, CoachBriefAnswerKind>> = {
  yes: "yes",
  accept_all: "yes",
  no: "no",
  other_time: "other_time",
  already_done: "already_done",
  undo: "undo",
  undo_all: "undo",
  never_move: "never_move",
};

/** Reads under RLS as the person. Every query is bounded by date and paged. */
export function createCoachSignalReads(client: AppSupabaseClient, userId: string): CoachSignalReads {
  return {
    async behaviors() {
      const { data, error } = await client.from("behaviors")
        .select("id,created_at,timezone,active,archived_at,default_duration_minutes,where_kind").eq("user_id", userId);
      if (error) throw new CoachSignalsError("read_behaviors_failed");
      return (data ?? []).map((row) => ({
        id: row.id, createdAt: row.created_at, timezone: row.timezone, active: row.active && row.archived_at === null,
        hasLength: row.default_duration_minutes !== null, hasPlace: row.where_kind !== null,
      }));
    },
    async occurrences(since, before) {
      const rows = await pages("read_occurrences_failed", (from, to) => client.from("occurrences")
        .select("id,behavior_id,local_date,status,schedule_kind,schedule_start_time,scheduled_for").eq("user_id", userId)
        .gte("local_date", since).lt("local_date", before).order("id").range(from, to));
      return rows.flatMap((row) => isStatus(row.status)
        ? [{
          id: row.id, behaviorId: row.behavior_id, localDate: row.local_date, status: row.status,
          scheduleKind: row.schedule_kind === "range" ? "range" as const : "exact" as const,
          startTime: row.schedule_start_time, plannedStartAt: row.scheduled_for,
        }] : []);
    },
    async decisions(since, before) {
      // First explicit decisions only: a mark from Unresolved, made by the person.
      const rows = await pages("read_decisions_failed", (from, to) => client.from("occurrence_status_events")
        .select("id,occurrence_id,behavior_id,local_date,recorded_at,timezone").eq("user_id", userId)
        .eq("status_semantics", "explicit_user_mark").in("status", ["completed", "not_completed"])
        .or("previous_status.is.null,previous_status.eq.unresolved")
        .gte("local_date", since).lt("local_date", before).order("id").range(from, to));
      return rows.map((row) => ({
        occurrenceId: row.occurrence_id, behaviorId: row.behavior_id, localDate: row.local_date,
        recordedAt: row.recorded_at, timezone: row.timezone,
      }));
    },
    async moves(since) {
      const rows = await pages("read_moves_failed", (from, to) => client.from("occurrence_moves")
        .select("id,occurrence_id,behavior_id,local_date,timezone,kind,chain_position,from_start_at,to_start_at,to_planned,source")
        .eq("user_id", userId).gte("local_date", since).order("id").range(from, to));
      return rows.flatMap((row) => row.kind === "move" || row.kind === "revert" || row.kind === "supersede"
        ? [{
          occurrenceId: row.occurrence_id, behaviorId: row.behavior_id, localDate: row.local_date, timezone: row.timezone,
          kind: row.kind, chainPosition: row.chain_position, fromStartAt: row.from_start_at, toStartAt: row.to_start_at,
          toPlanned: row.to_planned,
          source: row.source,
        }] : []);
    },
    async answers(since) {
      // Workstream 3A1 records every answer in move_proposal_answers. Until that table
      // exists, read the answer each proposal ended with.
      const answers = await readAnswerRows(client, userId, since);
      if (answers) return { source: "answers", rows: answers };
      const rows = await pages("read_proposals_failed", (from, to) => client.from("move_proposals")
        .select("id,behavior_id,local_date,status").eq("user_id", userId).eq("source", "daily_brief")
        .gte("local_date", since).order("id").range(from, to));
      return {
        source: "proposals",
        rows: rows.flatMap((row) => {
          const kind = PROPOSAL_STATUS_ANSWERS[row.status];
          return kind ? [{ behaviorId: row.behavior_id, localDate: row.local_date, kind }] : [];
        }),
      };
    },
  };
}

type AnswerRow = { id: string; behavior_id: string; local_date: string; kind: string; outcome: string | null };

/** Null when the answers table is not there yet. Refused answers changed nothing and are left out. */
async function readAnswerRows(client: AppSupabaseClient, userId: string, since: string): Promise<CoachSignalAnswer[] | null> {
  // The table arrives with workstream 3A1, so it is not in the generated types yet.
  const untyped = client as unknown as { from(table: string): ReturnType<AppSupabaseClient["from"]> };
  const rows = await pages<AnswerRow>("read_answers_failed", (from, to) => untyped.from("move_proposal_answers")
    .select("id,behavior_id,local_date,kind,outcome").eq("user_id", userId).gte("local_date", since)
    .order("id").range(from, to) as unknown as PromiseLike<PageResult<AnswerRow>>, isMissingRelation);
  if (rows === null) return null;
  return rows.flatMap((row) => {
    const kind = ANSWER_KINDS[row.kind];
    return kind && row.outcome !== "refused" ? [{ behaviorId: row.behavior_id, localDate: row.local_date, kind }] : [];
  });
}

function isMissingRelation(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "PGRST205" || code === "42P01";
}

type PageResult<Row> = { data: Row[] | null; error: unknown };

async function pages<Row>(code: string, query: (from: number, to: number) => PromiseLike<PageResult<Row>>): Promise<Row[]>;
async function pages<Row>(code: string, query: (from: number, to: number) => PromiseLike<PageResult<Row>>,
  missing: (error: unknown) => boolean): Promise<Row[] | null>;
async function pages<Row>(code: string, query: (from: number, to: number) => PromiseLike<PageResult<Row>>,
  missing?: (error: unknown) => boolean): Promise<Row[] | null> {
  const rows: Row[] = [];
  for (let from = 0; ; from += READ_PAGE) {
    const { data, error } = await query(from, from + READ_PAGE - 1);
    if (error) {
      if (from === 0 && missing?.(error)) return null;
      throw new CoachSignalsError(code);
    }
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < READ_PAGE) return rows;
    if (from >= 50 * READ_PAGE) throw new CoachSignalsError(`${code}_too_many`);
  }
}

function isStatus(value: string): value is CoachSignalOccurrence["status"] {
  return value === "unresolved" || value === "completed" || value === "not_completed";
}
