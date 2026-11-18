import {
  COACH_SIGNAL_THRESHOLDS,
  COACH_SIGNAL_VERSION,
  resolveCoachSignals,
  type CoachSignal,
} from "@cadence/core/resolvers/coach-signals.resolver";
import { Temporal } from "@js-temporal/polyfill";

import { finishAgentRun, startAgentRun } from "@/lib/db/agent-runs.repo";
import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import {
  CoachSignalsError,
  createCoachSignalReads,
  recordCoachSignals,
  selectDueCoachAccounts,
  type CoachAnswersSource,
  type CoachSignalReads,
  type DueCoachAccount,
} from "@/lib/db/coach-signals.repo";
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

/** On unless the switch is exactly "off". */
export function coachSignalsEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env[COACH_SIGNALS_ENV]?.trim() !== "off";
}

export type { DueCoachAccount };

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
  return (input: Readonly<{ after: string | null; limit: number }>) => selectDueCoachAccounts(serviceRole, input);
}

// ---------------------------------------------------------------------------
// One visit, as the person, on the coach token channel.

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
    record: (runId, signals) => recordCoachSignals(client, { runId, signalVersion: COACH_SIGNAL_VERSION, signals }),
    async finishRun(runId, outcome, errorCode) {
      await finishAgentRun(client, {
        runId, outcome, errorCode, errorReason: null, inputHash: null, modelCalls: 0,
        inputTokens: null, cachedInputTokens: null, outputTokens: null, reasoningTokens: null,
      });
    },
  };
}

function addDays(localDate: string, days: number): string {
  return Temporal.PlainDate.from(localDate).add({ days }).toString();
}

