import { createHash } from "node:crypto";

import type { AdvisorDayContext } from "@cadence/core/types/advisor-day-context";
import {
  finishAgentRun,
  reserveAgentSpend,
  settleAgentSpend,
  startAgentRun,
  storeAgentRunContent,
  type AgentRunOutcome,
  type AgentRunTrigger,
} from "@/lib/db/agent-runs.repo";
import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import type { Json } from "@/lib/db/database.types";
import { agentCallerConfigured, createAgentClient } from "@/lib/integrations/agent-caller";
import { estimateCallMicrodollars, modelPrice, usageMicrodollars } from "./agent-model-pricing";
import { DailyBriefError, type DailyBriefGenerator, type DailyBriefModelUsage } from "./daily-brief-consumer";

// Advisor plan Phase 1A: the hosted Daily Brief writes one agent_runs row per
// attempt, and its model calls go through the spend budget. Each call reserves
// an estimate first; a refusal stops the call before the provider sees it.
// After the call, the reservation settles at the reported cost (or at the
// estimate when the provider reported no usage).
//
// The run log keeps metadata long-term. The facts sent to the model and the
// brief that came back go to the 30-day content store, and only until the end
// of the local day when they include calendar or travel facts.

/** Default output cap for the estimate; the brief passes its model setting's cap. Every call may use all of it. */
export const DAILY_BRIEF_MAX_OUTPUT_TOKENS = 2_000;

export type DailyBriefAgentRun = Readonly<{
  runId: string;
  /** The run's `daily_brief` agent client, for the proposal writes that belong to this run (advisor Phase 3). */
  client: AppSupabaseClient;
  /** Wraps the generator so each call reserves, then settles, spend. */
  wrap: (generate: DailyBriefGenerator) => DailyBriefGenerator;
  /**
   * Records the outcome. Never throws: the brief's result does not depend on the log.
   * The run row is written first; content is skipped once `signal` aborts, so the
   * caller can bound these writes to its own deadline.
   */
  finish: (
    result: Readonly<{
      ok: true; briefing: unknown; calendarDerived: boolean; googleCalendarDerived?: boolean; linkedProposalIds?: readonly string[];
      /** Set when the brief was shown with Cadence's stock words because the model call failed; the run records that failure. */
      wordsError?: unknown;
    }> | Readonly<{ ok: false; error: unknown }>,
    signal?: AbortSignal,
  ) => Promise<void>;
}>;

export type BeginDailyBriefAgentRunOptions = Readonly<{
  userId: string;
  trigger: AgentRunTrigger;
  /** AI Gateway model string, such as `openai/gpt-5.6-luna`. Its price must be in agent-model-pricing.ts. */
  model: string;
  /** The call's output cap, used for the pre-call estimate. Defaults to DAILY_BRIEF_MAX_OUTPUT_TOKENS. */
  maxOutputTokens?: number;
  promptVersion: string;
  signal?: AbortSignal;
  /** Tests inject a client; production mints a `daily_brief` agent client. */
  client?: AppSupabaseClient;
}>;

/**
 * Starts the run. Returns null only when this deployment has no agent signing
 * key (local development without MCP); every other failure stops the brief,
 * because spend could not be checked.
 */
export async function beginDailyBriefAgentRun(options: BeginDailyBriefAgentRunOptions): Promise<DailyBriefAgentRun | null> {
  let client: AppSupabaseClient;
  try {
    if (!options.client && !agentCallerConfigured()) return null;
    client = options.client ?? createAgentClient(options.userId, "daily_brief").client;
  } catch {
    // A key that is set but unusable stops the brief instead of skipping the budget.
    throw new DailyBriefError("advisor_unavailable", undefined, "agent_key_invalid");
  }
  const price = modelPrice(options.model);
  let runId: string;
  try {
    ({ runId } = await startAgentRun(client, { trigger: options.trigger, model: options.model, promptVersion: options.promptVersion }, options.signal));
  } catch {
    throw new DailyBriefError("advisor_unavailable", undefined, "run_log_unavailable");
  }

  const usage: DailyBriefModelUsage[] = [];
  const inputs: Array<Readonly<{ instructionsSha256: string; facts: string }>> = [];
  let inputHash: string | null = null;
  let refused = false;
  let calls = 0;

  const wrap = (generate: DailyBriefGenerator): DailyBriefGenerator => async (input) => {
    if (!price) throw new DailyBriefError("advisor_unavailable", undefined, "model_price_unknown");
    const estimate = estimateCallMicrodollars(price, {
      requestCharacters: input.instructions.length + input.facts.length,
      maxOutputTokens: options.maxOutputTokens ?? DAILY_BRIEF_MAX_OUTPUT_TOKENS,
    });
    let decision;
    try {
      decision = await reserveAgentSpend(client, { runId, model: options.model, estimatedMicrodollars: estimate }, input.signal);
    } catch {
      input.signal.throwIfAborted();
      throw new DailyBriefError("advisor_unavailable", undefined, "budget_unavailable");
    }
    if (!decision.allowed) {
      refused = true;
      throw new DailyBriefError("budget_reached", decision.retryAfterSeconds, `budget_${decision.reason}`);
    }
    calls += 1;
    const instructionsSha256 = sha256(input.instructions);
    inputHash ??= sha256(`${instructionsSha256}\n${input.facts}`);
    inputs.push({ instructionsSha256, facts: input.facts });
    const reported: { usage: DailyBriefModelUsage | null } = { usage: null };
    try {
      return await generate({
        ...input,
        onUsage: (item) => {
          reported.usage = item;
          usage.push(item);
          input.onUsage?.(item);
        },
      });
    } finally {
      const actual = reported.usage ? usageMicrodollars(price, reported.usage) : null;
      await settleAgentSpend(client, { reservationId: decision.reservationId, actualMicrodollars: actual ?? estimate }).catch(() => undefined);
    }
  };

  const finish: DailyBriefAgentRun["finish"] = async (result, signal) => {
    const failure = !result.ok ? describeFailure(result.error, refused)
      : result.wordsError !== undefined ? describeFailure(result.wordsError, refused) : null;
    const total = (pick: (item: DailyBriefModelUsage) => number | null) =>
      usage.reduce<number | null>((sum, item) => { const value = pick(item); return value === null ? sum : (sum ?? 0) + value; }, null);
    if (signal?.aborted) return;
    // Metadata first: it is kept long-term; content only shortens replay coverage when lost.
    await finishAgentRun(client, {
      runId,
      outcome: failure?.outcome ?? "success",
      errorCode: failure?.errorCode ?? null,
      errorReason: failure?.errorReason ?? null,
      inputHash,
      modelCalls: calls,
      inputTokens: total((item) => item.inputTokens),
      cachedInputTokens: total((item) => item.cachedInputTokens),
      outputTokens: total((item) => item.outputTokens),
      reasoningTokens: total((item) => item.reasoningTokens),
      ...(result.ok && result.linkedProposalIds?.length ? { linkedProposalIds: result.linkedProposalIds } : {}),
    }, signal).catch(() => undefined);
    if (!result.ok) return;
    try {
      for (const [seq, item] of inputs.entries()) {
        if (signal?.aborted) return;
        await storeAgentRunContent(client, { runId, kind: "input", seq, calendarDerived: result.calendarDerived,
          ...(result.googleCalendarDerived !== undefined ? { googleCalendarDerived: result.googleCalendarDerived } : {}),
          body: { instructions_sha256: item.instructionsSha256, facts: item.facts } }, signal);
      }
      if (signal?.aborted) return;
      await storeAgentRunContent(client, { runId, kind: "output", calendarDerived: result.calendarDerived,
        ...(result.googleCalendarDerived !== undefined ? { googleCalendarDerived: result.googleCalendarDerived } : {}),
        body: JSON.parse(JSON.stringify(result.briefing ?? null)) as Json }, signal);
    } catch {
      // A lost content row only shortens replay coverage.
    }
  };

  return { runId, client, wrap, finish };
}

/** Calendar events and travel facts come from a calendar; such text is kept only for its local day. */
export function dailyBriefContextIsCalendarDerived(context: AdvisorDayContext): boolean {
  return context.connectors.some((connector) => "events" in connector && Array.isArray(connector.events) && connector.events.length > 0)
    || context.travel !== undefined;
}

function describeFailure(error: unknown, refused: boolean): Readonly<{ outcome: AgentRunOutcome; errorCode: string; errorReason: string | null }> {
  if (!(error instanceof DailyBriefError)) return { outcome: "error", errorCode: "internal_error", errorReason: null };
  const errorCode = /^[a-z][a-z0-9_]{0,63}$/.test(error.code) ? error.code : "internal_error";
  const errorReason = error.reason && /^[a-z][a-z0-9_:]{0,95}$/.test(error.reason) ? error.reason : null;
  if (refused && error.reason?.startsWith("budget_")) return { outcome: "refused_budget", errorCode, errorReason };
  if (error.code === "timeout") return { outcome: "timeout", errorCode, errorReason };
  if (error.code === "cancelled" || error.code === "context_changed" || error.code === "context_expired") {
    return { outcome: "superseded", errorCode, errorReason };
  }
  if (error.code === "advisor_unavailable" && error.reason) {
    const invalid = error.reason.startsWith("validation_") || error.reason === "output_not_json" || error.reason === "provider_shape";
    if (invalid) return { outcome: "invalid_output", errorCode, errorReason };
    if (error.reason.startsWith("provider_")) return { outcome: "model_error", errorCode, errorReason };
  }
  return { outcome: "error", errorCode, errorReason };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
