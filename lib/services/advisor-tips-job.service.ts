import { Temporal } from "@js-temporal/polyfill";

import { matchAdviceCards } from "@cadence/core/resolvers/advice-matcher.resolver";
import { resolveCoachAccountFacts } from "@cadence/core/resolvers/coach-signals-v2.resolver";
import type { CoachSignalBehavior, CoachSignalOccurrence } from "@cadence/core/resolvers/coach-signals.resolver";
import { ADVICE_CARDS } from "@cadence/core/services/advice-library";
import type { AdviceCard, AdviceCardStatus, AdviceMatch, AdviceSignalInput } from "@cadence/core/types/advice-cards";

import {
  finishAgentRun,
  reserveAgentSpend,
  settleAgentSpend,
  startAgentRun,
  storeAgentRunContent,
  type AgentRunOutcome,
  type AgentRunTrigger,
} from "@/lib/db/agent-runs.repo";
import {
  AdvisorTipsError,
  readStoredSignals,
  readTipHistory,
  selectDueTipAccounts,
  writeTips,
  type DueTipAccount,
  type TipHistory,
  type TipToWrite,
} from "@/lib/db/advisor-tips.repo";
import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import { createCoachSignalReads } from "@/lib/db/coach-signals.repo";
import { createAgentClient } from "@/lib/integrations/agent-caller";
import { agentModelSetting, generateStructured, type AgentModelSetting, type AgentModelUsage } from "./agent-model";
import { estimateCallMicrodollars, modelPrice, usageMicrodollars } from "./agent-model-pricing";
import { readAdvisorTipsSettings, type AdvisorTipsSettings } from "./advisor-tips-settings";
import {
  CARD_REST_DAYS,
  TIP_INSTRUCTIONS,
  TIP_PROMPT_VERSION,
  TIP_SCHEMA,
  TIP_SCHEMA_NAME,
  buildTipPrompt,
  resolveTipOutput,
  seedTips,
  selectTipMatches,
  tipItems,
  tipsPerDay,
  type DayNote,
  type TipItem,
  type TipOutcome,
} from "./advisor-tips-writer";

// Advisor plan Phase 4, workstream 4B step 2: the daily tip run.
//
// A separate step after the morning signals visit (review call T6), with its own due list
// (`coach_tips_due_accounts`: signals stored today, no tip run yet, under three tries) and
// its own time allowance inside the hourly coach cron. Each account is one agent_runs row
// (agent coach, trigger scheduled, prompt version coach-tips-1). A failed model call
// never touches that morning's signals; the run fills the day from the cards' own seeds.
//
// At most one model call per account a day, and only when a card matched that was not
// used in the last 14 days, or a used card has a new fact. No match, no call, fewer tips
// (D1). Tips off in Settings: no call and nothing written; stored tips stay (D7).
// Opening the app never calls a model (advisor-tips-request.ts).

export const COACH_TIPS_PAGE_SIZE = 50;
const ACCOUNT_CONCURRENCY = 4;

export type TipVisitOutcome = Readonly<{
  written: number;
  modelCalls: number;
  /** Why no model call was made, when none was. */
  skipped: "tips_off" | "no_match" | "budget" | null;
  rejected: number;
}>;

export type CoachTipsJobResult = {
  pages: number;
  selected: number;
  visited: number;
  /** Accounts left for the next hourly run because this run's time was spent. */
  leftOver: number;
  failed: number;
  written: number;
  modelCalls: number;
};

export async function processCoachTips(options: Readonly<{
  now?: () => number;
  runBudgetMs: number;
  pageSize?: number;
  selectDue(input: Readonly<{ after: string | null; limit: number }>): Promise<DueTipAccount[]>;
  visit(account: DueTipAccount): Promise<TipVisitOutcome>;
}>): Promise<CoachTipsJobResult> {
  const total: CoachTipsJobResult = { pages: 0, selected: 0, visited: 0, leftOver: 0, failed: 0, written: 0, modelCalls: 0 };
  const clock = options.now ?? Date.now;
  const budgetEndsAt = clock() + options.runBudgetMs;
  const pageSize = Math.min(Math.max(1, Math.trunc(options.pageSize ?? COACH_TIPS_PAGE_SIZE)), 500);
  let after: string | null = null;
  while (clock() < budgetEndsAt) {
    const page = await options.selectDue({ after, limit: pageSize });
    total.pages += 1;
    total.selected += page.length;
    let index = 0;
    const worker = async () => {
      while (index < page.length) {
        const account = page[index++]!;
        if (clock() >= budgetEndsAt) { total.leftOver += 1; continue; }
        try {
          const outcome = await options.visit(account);
          total.visited += 1;
          total.written += outcome.written;
          total.modelCalls += outcome.modelCalls;
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

export function hostedDueTipAccounts(serviceRole: AppSupabaseClient) {
  return (input: Readonly<{ after: string | null; limit: number }>) => selectDueTipAccounts(serviceRole, input);
}

// ---------------------------------------------------------------------------
// One account.

export type TipSetup = Readonly<{
  behaviors: readonly CoachSignalBehavior[];
  occurrences: readonly CoachSignalOccurrence[];
  titles: ReadonlyMap<string, string>;
}>;

export type SpendDecision = Readonly<{ allowed: true; reservationId: string } | { allowed: false }>;

export type TipVisitPort = Readonly<{
  startRun(input: Readonly<{ trigger: AgentRunTrigger; model: string | null }>): Promise<Readonly<{ runId: string; localDate: string }>>;
  settings(): Promise<AdvisorTipsSettings>;
  signals(localDate: string): Promise<AdviceSignalInput[]>;
  setup(localDate: string): Promise<TipSetup>;
  history(since: string): Promise<TipHistory>;
  /** Day notes for [since, before). Called only when the notes choice allows it. */
  notes(since: string, before: string): Promise<DayNote[]>;
  reserve(runId: string, estimatedMicrodollars: number): Promise<SpendDecision>;
  settle(reservationId: string, actualMicrodollars: number): Promise<void>;
  generate(input: Readonly<{ instructions: string; prompt: string; onUsage(usage: AgentModelUsage): void }>): Promise<unknown>;
  write(runId: string, tips: readonly TipToWrite[]): Promise<number>;
  storeContent(runId: string, input: Readonly<{ prompt: string; output: unknown }>): Promise<void>;
  finishRun(runId: string, result: Readonly<{
    outcome: AgentRunOutcome; errorCode: string | null; errorReason: string | null; modelCalls: number; usage: AgentModelUsage | null;
  }>): Promise<void>;
}>;

export type TipVisitOptions = Readonly<{
  setting: AgentModelSetting;
  cards?: readonly AdviceCard[];
  statuses?: readonly AdviceCardStatus[];
  maxPerDay?: number;
  trigger?: AgentRunTrigger;
  /** Run after tips are written, on the same run (workstream 4C's schedule proposals). Its failure never fails the visit. */
  afterTips?: (context: Readonly<{ runId: string; localDate: string; signals: readonly AdviceSignalInput[]; matches: readonly AdviceMatch[] }>) => Promise<void>;
}>;

/** Chooses today's matches. Exported for the eval and the first-day path. */
export function chooseTipMatches(input: Readonly<{
  localDate: string;
  signals: readonly AdviceSignalInput[];
  setup: TipSetup;
  history: TipHistory;
  cards: readonly AdviceCard[];
  statuses: readonly AdviceCardStatus[];
  maxPerDay: number;
}>): Readonly<{ matches: AdviceMatch[]; chosen: AdviceMatch[] }> {
  const account = resolveCoachAccountFacts({
    today: input.localDate, behaviors: input.setup.behaviors, occurrences: input.setup.occurrences,
    decisions: [], moves: [], answers: [],
  });
  const matches = matchAdviceCards({
    cards: input.cards,
    signals: input.signals,
    account,
    today: input.localDate,
    shown: input.history.tips.filter((tip) => tip.shownAt !== null).map((tip) => ({ cardId: tip.cardId, localDate: tip.localDate, behaviorId: tip.behaviorId })),
    suppressedCardIds: input.history.suppressedCardIds,
    statuses: input.statuses,
  });
  const chosen = selectTipMatches({ matches, history: input.history, today: input.localDate, max: input.maxPerDay });
  return { matches, chosen };
}

export async function visitAdvisorTips(port: TipVisitPort, options: TipVisitOptions): Promise<TipVisitOutcome> {
  const model = options.setting.model;
  const run = await port.startRun({ trigger: options.trigger ?? "scheduled", model });
  let modelCalls = 0;
  let usage: AgentModelUsage | null = null;
  try {
    const settings = await port.settings();
    if (!settings.tipsOn) {
      await port.finishRun(run.runId, { outcome: "success", errorCode: null, errorReason: null, modelCalls: 0, usage: null });
      return { written: 0, modelCalls: 0, skipped: "tips_off", rejected: 0 };
    }
    const today = run.localDate;
    const [signals, setup, history] = await Promise.all([
      port.signals(today),
      port.setup(today),
      port.history(addDays(today, -CARD_REST_DAYS)),
    ]);
    const { matches, chosen } = chooseTipMatches({
      localDate: today, signals, setup, history,
      cards: options.cards ?? ADVICE_CARDS, statuses: options.statuses ?? ["active"],
      maxPerDay: options.maxPerDay ?? tipsPerDay(),
    });
    let outcome: TipOutcome = { tips: [], rejected: [], dropped: 0 };
    let skipped: TipVisitOutcome["skipped"] = chosen.length === 0 ? "no_match" : null;
    let failure: Readonly<{ outcome: AgentRunOutcome; code: string; reason: string }> | null = null;
    if (chosen.length > 0) {
      const items = tipItems(chosen, setup.titles);
      const notes = settings.notesAllowed ? await port.notes(addDays(today, -7), today) : null;
      const prompt = buildTipPrompt({ items, notes });
      const called = await callModel(port, run.runId, options.setting, prompt, items);
      modelCalls = called.modelCalls;
      usage = called.usage;
      outcome = called.outcome;
      if (called.refused) skipped = "budget";
      failure = called.failure;
      const written = await port.write(run.runId, outcome.tips);
      if (modelCalls > 0) await port.storeContent(run.runId, { prompt, output: outcome.tips.map((tip) => tip.text) }).catch(() => undefined);
      if (options.afterTips) await options.afterTips({ runId: run.runId, localDate: today, signals, matches }).catch(() => undefined);
      await port.finishRun(run.runId, {
        // The day's tips were written either way; a model failure is recorded, not repeated.
        outcome: failure?.outcome ?? "success", errorCode: failure?.code ?? null, errorReason: failure?.reason ?? null, modelCalls, usage,
      });
      return { written, modelCalls, skipped, rejected: outcome.rejected.length };
    }
    if (options.afterTips) await options.afterTips({ runId: run.runId, localDate: today, signals, matches }).catch(() => undefined);
    await port.finishRun(run.runId, { outcome: "success", errorCode: null, errorReason: null, modelCalls: 0, usage: null });
    return { written: 0, modelCalls: 0, skipped, rejected: 0 };
  } catch (error) {
    const code = error instanceof AdvisorTipsError ? error.code : "visit_failed";
    await port.finishRun(run.runId, { outcome: "error", errorCode: code, errorReason: null, modelCalls, usage }).catch(() => undefined);
    throw error;
  }
}

async function callModel(port: TipVisitPort, runId: string, setting: AgentModelSetting, prompt: string, items: readonly TipItem[]): Promise<Readonly<{
  outcome: TipOutcome; modelCalls: number; usage: AgentModelUsage | null; refused: boolean;
  failure: Readonly<{ outcome: AgentRunOutcome; code: string; reason: string }> | null;
}>> {
  const price = modelPrice(setting.model);
  if (!price) return { outcome: seedTips(items), modelCalls: 0, usage: null, refused: false, failure: { outcome: "error", code: "model_price_unknown", reason: "model_price_unknown" } };
  const estimate = estimateCallMicrodollars(price, { requestCharacters: TIP_INSTRUCTIONS.length + prompt.length, maxOutputTokens: setting.maxOutputTokens });
  const decision = await port.reserve(runId, estimate);
  // Budget used up: the cards' own wording, never an error (step 6).
  if (!decision.allowed) return { outcome: seedTips(items), modelCalls: 0, usage: null, refused: true, failure: null };
  let usage: AgentModelUsage | null = null;
  try {
    const output = await port.generate({ instructions: TIP_INSTRUCTIONS, prompt, onUsage: (item) => { usage = item; } });
    return { outcome: resolveTipOutput(output, items), modelCalls: 1, usage, refused: false, failure: null };
  } catch (error) {
    const reason = error && typeof error === "object" && "reason" in error ? String((error as { reason: unknown }).reason) : "model_error";
    return {
      outcome: seedTips(items), modelCalls: 1, usage, refused: false,
      failure: { outcome: "model_error", code: "model_error", reason: /^[a-z][a-z0-9_:]{0,95}$/.test(reason) ? reason : "model_error" },
    };
  } finally {
    const actual: number | null = usage ? usageMicrodollars(price, usage) : null;
    await port.settle(decision.reservationId, actual ?? estimate).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Hosted port: the coach agent's client, as the person.

export function createHostedTipVisitPort(userId: string, options: Readonly<{ client?: AppSupabaseClient; setting?: AgentModelSetting }> = {}): TipVisitPort {
  const client = options.client ?? createAgentClient(userId, "coach").client;
  const setting = options.setting ?? agentModelSetting("coach");
  const reads = createCoachSignalReads(client, userId);
  return {
    async startRun(input) {
      const run = await startAgentRun(client, { trigger: input.trigger, model: input.model, promptVersion: TIP_PROMPT_VERSION });
      return { runId: run.runId, localDate: run.localDate };
    },
    settings: () => readAdvisorTipsSettings(client),
    signals: (localDate) => readStoredSignals(client, localDate),
    async setup(localDate) {
      const [behaviors, occurrences, titles] = await Promise.all([
        reads.behaviors(),
        reads.occurrences(addDays(localDate, -14), addDays(localDate, 1)),
        readBehaviorTitles(client, userId),
      ]);
      return { behaviors, occurrences, titles };
    },
    history: (since) => readTipHistory(client, since),
    notes: (since, before) => readDayNotes(client, userId, since, before),
    async reserve(runId, estimatedMicrodollars) {
      const decision = await reserveAgentSpend(client, { runId, model: setting.model, estimatedMicrodollars });
      return decision.allowed ? { allowed: true, reservationId: decision.reservationId } : { allowed: false };
    },
    async settle(reservationId, actualMicrodollars) {
      await settleAgentSpend(client, { reservationId, actualMicrodollars });
    },
    generate: (input) => generateStructured({
      agent: "coach", setting, instructions: input.instructions, prompt: input.prompt,
      schemaName: TIP_SCHEMA_NAME, schema: TIP_SCHEMA, signal: AbortSignal.timeout(setting.timeoutMs), onUsage: input.onUsage,
    }),
    write: (runId, tips) => writeTips(client, runId, tips),
    async storeContent(runId, input) {
      await storeAgentRunContent(client, { runId, kind: "input", calendarDerived: false, body: { facts: input.prompt } });
      await storeAgentRunContent(client, { runId, kind: "output", calendarDerived: false, body: input.output as never });
    },
    async finishRun(runId, result) {
      await finishAgentRun(client, {
        runId, outcome: result.outcome, errorCode: result.errorCode, errorReason: result.errorReason, inputHash: null,
        modelCalls: result.modelCalls, inputTokens: result.usage?.inputTokens ?? null, cachedInputTokens: result.usage?.cachedInputTokens ?? null,
        outputTokens: result.usage?.outputTokens ?? null, reasoningTokens: result.usage?.reasoningTokens ?? null,
      });
    },
  };
}

async function readBehaviorTitles(client: AppSupabaseClient, userId: string): Promise<Map<string, string>> {
  const { data, error } = await client.from("behaviors").select("id,title").eq("user_id", userId).is("archived_at", null);
  if (error) throw new AdvisorTipsError("read_titles_failed");
  return new Map((data ?? []).map((row) => [row.id, row.title]));
}

async function readDayNotes(client: AppSupabaseClient, userId: string, since: string, before: string): Promise<DayNote[]> {
  const { data, error } = await client.from("day_notes").select("local_date,note").eq("user_id", userId)
    .gte("local_date", since).lt("local_date", before).not("note", "is", null).order("local_date", { ascending: false }).limit(7);
  if (error) throw new AdvisorTipsError("read_notes_failed");
  return (data ?? []).flatMap((row) => row.note ? [{ localDate: row.local_date, note: row.note }] : []);
}

function addDays(localDate: string, days: number): string {
  return Temporal.PlainDate.from(localDate).add({ days }).toString();
}
