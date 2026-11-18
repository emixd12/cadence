import {
  COACH_SIGNAL_THRESHOLDS,
  COACH_SIGNAL_VERSION,
  resolveCoachSignals,
  type CoachBriefAnswerKind,
  type CoachSignal,
  type CoachSignalAnswer,
  type CoachSignalDecision,
  type CoachSignalMove,
  type CoachSignalOccurrence,
  type ResolveCoachSignalsInput,
} from "@cadence/core/resolvers/coach-signals.resolver";
import { Temporal } from "@js-temporal/polyfill";

import { finishAgentRun, startAgentRun } from "@/lib/db/agent-runs.repo";
import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import type { Json } from "@/lib/db/database.types";
import { createAgentClient, type CreateAgentContextOptions } from "@/lib/integrations/agent-caller";

// Advisor plan Phase 3, workstream 3D: coach signals in shadow.
//
// An hourly cron (/api/advisor/coach/signals/process) visits accounts where it is
// early morning local time and that were active in the last seven days. The service
// role only asks the database which accounts are due (`coach_due_accounts`). Each
// visit then runs as the person on the coach agent's token channel: it reads their
// records under RLS, computes signals with no model call
// (packages/core/src/resolvers/coach-signals.resolver.ts) and stores them with
// `coach_record_signals`. Nothing is shown to the person.
//
// Safe to re-run: a visit is one agent_runs row for the account's local day, and
// storing replaces that day's signals. Accounts are taken in user id order, a page
// at a time (cursor), until the run budget is spent; an account left over is picked
// up by the next hourly run, which still falls in its early morning (03:00 to 05:59).
// Results and monitoring carry counts only.

export const COACH_SIGNALS_ENV = "CADENCE_COACH_SIGNALS";
export const COACH_SIGNALS_PAGE_SIZE = 50;
const RUN_BUDGET_MS = 50_000;
const ACCOUNT_CONCURRENCY = 4;
const READ_PAGE = 1000;

/** On unless the switch is exactly "off". */
export function coachSignalsEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env[COACH_SIGNALS_ENV]?.trim() !== "off";
}

export type DueCoachAccount = Readonly<{ userId: string; localDate: string }>;

export type CoachVisitOutcome = Readonly<{ signals: number; answersSource: CoachAnswersSource }>;

export type CoachSignalsJobResult = {
  enabled: boolean;
  pages: number;
  selected: number;
  visited: number;
  skipped: number;
  failed: number;
  signals: number;
};

export type ProcessCoachSignalsOptions = Readonly<{
  env?: Readonly<Record<string, string | undefined>>;
  now?: () => number;
  runBudgetMs?: number;
  pageSize?: number;
  selectDue(input: Readonly<{ after: string | null; limit: number }>): Promise<DueCoachAccount[]>;
  visit(account: DueCoachAccount): Promise<CoachVisitOutcome>;
}>;

export async function processCoachSignals(options: ProcessCoachSignalsOptions): Promise<CoachSignalsJobResult> {
  const total: CoachSignalsJobResult = { enabled: false, pages: 0, selected: 0, visited: 0, skipped: 0, failed: 0, signals: 0 };
  if (!coachSignalsEnabled(options.env)) return total;
  total.enabled = true;
  const clock = options.now ?? Date.now;
  const budgetEndsAt = clock() + (options.runBudgetMs ?? RUN_BUDGET_MS);
  const pageSize = Math.min(Math.max(1, Math.trunc(options.pageSize ?? COACH_SIGNALS_PAGE_SIZE)), 500);
  let after: string | null = null;
  while (clock() < budgetEndsAt) {
    const page = await options.selectDue({ after, limit: pageSize });
    total.pages += 1;
    total.selected += page.length;
    let index = 0;
    const worker = async () => {
      while (index < page.length) {
        const account = page[index++]!;
        if (clock() >= budgetEndsAt) { total.skipped += 1; continue; }
        // A failed account never stops the batch.
        try {
          const outcome = await options.visit(account);
          total.visited += 1;
          total.signals += outcome.signals;
        } catch {
          total.failed += 1;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(ACCOUNT_CONCURRENCY, page.length) }, worker));
    if (page.length < pageSize) break;
    after = page[page.length - 1]!.userId;
  }
  return total;
}

/** Service role: which accounts are due, in user id order after `after`. */
export function hostedDueCoachAccounts(serviceRole: AppSupabaseClient) {
  return async (input: Readonly<{ after: string | null; limit: number }>): Promise<DueCoachAccount[]> => {
    const { data, error } = await serviceRole.rpc("coach_due_accounts", { p_after: input.after as string, p_limit: input.limit });
    if (error) throw new CoachSignalsError("due_accounts_failed");
    return (data ?? []).map((row) => ({ userId: row.user_id, localDate: row.local_date }));
  };
}

export class CoachSignalsError extends Error {
  constructor(public readonly code: string) {
    super(`Coach signals failed: ${code}.`);
    this.name = "CoachSignalsError";
  }
}

// ---------------------------------------------------------------------------
// One visit, as the person, on the coach token channel.

export type CoachAnswersSource = "answers" | "proposals";

export type CoachSignalReads = Readonly<{
  behaviors(): Promise<ResolveCoachSignalsInput["behaviors"]>;
  occurrences(since: string, before: string): Promise<CoachSignalOccurrence[]>;
  decisions(since: string, before: string): Promise<CoachSignalDecision[]>;
  moves(since: string): Promise<CoachSignalMove[]>;
  answers(since: string): Promise<Readonly<{ source: CoachAnswersSource; rows: CoachSignalAnswer[] }>>;
}>;

export type CoachVisitPort = Readonly<{
  startRun(): Promise<Readonly<{ runId: string; localDate: string }>>;
  reads: CoachSignalReads;
  record(runId: string, signals: readonly CoachSignal[]): Promise<number>;
  finishRun(runId: string, outcome: "success" | "error", errorCode: string | null): Promise<void>;
}>;

export async function visitCoachAccount(port: CoachVisitPort): Promise<CoachVisitOutcome> {
  const run = await port.startRun();
  try {
    const today = run.localDate;
    const T = COACH_SIGNAL_THRESHOLDS;
    const [behaviors, occurrences, decisions, moves, answers] = await Promise.all([
      port.reads.behaviors(),
      port.reads.occurrences(addDays(today, -T.historyDays), today),
      port.reads.decisions(addDays(today, -T.lateMarking.windowDays), today),
      port.reads.moves(addDays(today, -T.repeatedMove.windowDays)),
      port.reads.answers(addDays(today, -T.briefAnswers.windowDays)),
    ]);
    const signals = resolveCoachSignals({ today, behaviors, occurrences, decisions, moves, answers: answers.rows });
    const stored = await port.record(run.runId, signals);
    await port.finishRun(run.runId, "success", null);
    return { signals: stored, answersSource: answers.source };
  } catch (error) {
    const code = error instanceof CoachSignalsError ? error.code : "visit_failed";
    await port.finishRun(run.runId, "error", code).catch(() => undefined);
    throw error;
  }
}

export function createHostedCoachVisitPort(userId: string, options: CreateAgentContextOptions = {}): CoachVisitPort {
  const { client } = createAgentClient(userId, "coach", options);
  return createCoachVisitPort(client, userId);
}

export function createCoachVisitPort(client: AppSupabaseClient, userId: string): CoachVisitPort {
  return {
    async startRun() {
      const run = await startAgentRun(client, { trigger: "scheduled", model: null, promptVersion: COACH_SIGNAL_VERSION });
      return { runId: run.runId, localDate: run.localDate };
    },
    reads: createCoachSignalReads(client, userId),
    async record(runId, signals) {
      const { data, error } = await client.rpc("coach_record_signals", {
        p_run_id: runId,
        p_signal_version: COACH_SIGNAL_VERSION,
        p_signals: signals.map((signal) => ({ kind: signal.kind, behavior_id: signal.behaviorId, facts: signal.facts })) as unknown as Json,
      });
      if (error || typeof data !== "number") throw new CoachSignalsError("record_failed");
      return data;
    },
    async finishRun(runId, outcome, errorCode) {
      await finishAgentRun(client, {
        runId, outcome, errorCode, errorReason: null, inputHash: null, modelCalls: 0,
        inputTokens: null, cachedInputTokens: null, outputTokens: null, reasoningTokens: null,
      });
    },
  };
}

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
        .select("id,created_at,timezone,active,archived_at").eq("user_id", userId);
      if (error) throw new CoachSignalsError("read_behaviors_failed");
      return (data ?? []).map((row) => ({
        id: row.id, createdAt: row.created_at, timezone: row.timezone, active: row.active && row.archived_at === null,
      }));
    },
    async occurrences(since, before) {
      const rows = await pages("read_occurrences_failed", (from, to) => client.from("occurrences")
        .select("id,behavior_id,local_date,status").eq("user_id", userId)
        .gte("local_date", since).lt("local_date", before).order("id").range(from, to));
      return rows.flatMap((row) => isStatus(row.status)
        ? [{ behaviorId: row.behavior_id, localDate: row.local_date, status: row.status }] : []);
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
        .select("id,occurrence_id,behavior_id,local_date,timezone,kind,chain_position,from_start_at,to_start_at,source")
        .eq("user_id", userId).gte("local_date", since).order("id").range(from, to));
      return rows.flatMap((row) => row.kind === "move" || row.kind === "revert" || row.kind === "supersede"
        ? [{
          occurrenceId: row.occurrence_id, behaviorId: row.behavior_id, localDate: row.local_date, timezone: row.timezone,
          kind: row.kind, chainPosition: row.chain_position, fromStartAt: row.from_start_at, toStartAt: row.to_start_at,
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

function addDays(localDate: string, days: number): string {
  return Temporal.PlainDate.from(localDate).add({ days }).toString();
}
