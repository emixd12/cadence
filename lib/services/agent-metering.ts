import { createHash, randomUUID } from "node:crypto";
import type { AgentModelSetting, AgentModelUsage, AgentName } from "./agent-model";

/**
 * Phase 1B hooks for Phase 1A's spend budget and agent run log.
 *
 * Every model call reserves an estimated cost before it runs and settles the actual cost
 * after. Every agent run writes one metadata record. Phase 1A owns the Postgres tables and
 * functions; until it lands, `stubAgentMetering` grants every reservation and keeps nothing.
 * Swap in the real implementation by passing it to `agentMetering()` callers or replacing
 * `defaultAgentMetering`.
 */

/** Microdollars: US$1 = 1,000,000. Integers avoid floating-point drift in budgets. */
export type Microdollars = number;

export type SpendReservation =
  | Readonly<{ granted: true; reservationId: string }>
  | Readonly<{ granted: false; reason: "budget_exhausted" }>;

export interface AgentSpendBudget {
  /** Reserve before the call. A refused reservation means the model is never called. */
  reserve(input: Readonly<{ accountId: string; agent: AgentName; estimateMicrodollars: Microdollars }>): Promise<SpendReservation>;
  /** Settle after the call, success or failure. `actualMicrodollars` replaces the estimate. */
  settle(input: Readonly<{ reservationId: string; actualMicrodollars: Microdollars }>): Promise<void>;
}

/** Same names as Phase 1A's `agent_run_finish` outcomes. */
export type AgentRunOutcome = "success" | "refused_budget" | "invalid_output" | "model_error" | "timeout" | "superseded" | "error";

/** Maps an internal failure reason to a run outcome. */
export function runOutcomeForReason(reason: string): AgentRunOutcome {
  if (reason === "budget_exhausted") return "refused_budget";
  if (reason === "superseded") return "superseded";
  if (reason === "provider_timeout" || reason === "timeout" || reason === "cancelled") return "timeout";
  if (/^(validation_|output_|provider_refusal|provider_incomplete|provider_body_too_large)/.test(reason)) return "invalid_output";
  if (/^provider_/.test(reason)) return "model_error";
  return "error";
}

/** Metadata only. Phase 1A keeps it long-term in `agent_runs`. */
export type AgentRunRecord = Readonly<{
  runId: string;
  agent: AgentName;
  trigger: "user" | "schedule" | "eval";
  model: string;
  promptVersion: string;
  /** SHA-256 of the exact model input, for replay matching. Never the input itself. */
  inputHash: string;
  calls: number;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  costMicrodollars: Microdollars;
  toolCalls: number;
  outcome: AgentRunOutcome;
  errorReason: string | null;
  latencyMs: number;
  startedAt: string;
}>;

/** Content kept 30 days by Phase 1A (brief text, inputs for replay). */
export type AgentRunContent = Readonly<{ kind: "daily_brief"; localDate: string; body: unknown }>;

export interface AgentRunLog {
  record(input: Readonly<{ accountId: string; run: AgentRunRecord; content?: AgentRunContent }>): Promise<void>;
}

export type AgentMetering = Readonly<{ budget: AgentSpendBudget; runLog: AgentRunLog }>;

/** Grants everything and stores nothing. Used until Phase 1A merges. */
export const stubAgentMetering: AgentMetering = {
  budget: {
    async reserve() { return { granted: true, reservationId: randomUUID() }; },
    async settle() { /* Phase 1A records the settled cost. */ },
  },
  runLog: { async record() { /* Phase 1A writes agent_runs and the content store. */ } },
};

export function defaultAgentMetering(): AgentMetering {
  return stubAgentMetering;
}

/** US$ per million tokens. Source: AI Gateway catalog, checked 2026-11-16 (same as docs/COSTS.md). */
export type ModelPrice = Readonly<{ input: number; cachedInput: number; output: number }>;

export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  "openai/gpt-5.6-luna": { input: 0.20, cachedInput: 0.02, output: 1.20 },
  "openai/gpt-5.6-terra": { input: 2.00, cachedInput: 0.20, output: 12.00 },
  "openai/gpt-5.6-sol": { input: 4.00, cachedInput: 0.40, output: 20.00 },
  // Anthropic, checked 2026-11-16. Haiku 5.5 doubles past 100k input tokens; a brief stays far below.
  "anthropic/claude-haiku-5.5": { input: 0.10, cachedInput: 0.01, output: 0.50 },
  "anthropic/claude-sonnet-5.5": { input: 2.00, cachedInput: 0.10, output: 10.00 },
  "anthropic/claude-opus-5.5": { input: 4.00, cachedInput: 0.20, output: 20.00 },
  "anthropic/claude-fable-5.2": { input: 8.00, cachedInput: 0.20, output: 40.00 },
};

/** Used for a model with no listed price, so a reservation is never zero. Deliberately high. */
const UNKNOWN_MODEL_PRICE: ModelPrice = { input: 5.00, cachedInput: 5.00, output: 25.00 };

export function modelPrice(model: string, prices: Readonly<Record<string, ModelPrice>> = MODEL_PRICES): ModelPrice {
  return prices[model] ?? UNKNOWN_MODEL_PRICE;
}

/**
 * Upper-bound estimate before a call: about 3 characters per input token (conservative for
 * English and JSON) and the full output allowance.
 */
export function estimateCallMicrodollars(setting: AgentModelSetting, inputChars: number, prices?: Readonly<Record<string, ModelPrice>>): Microdollars {
  const price = modelPrice(setting.model, prices);
  return Math.ceil(Math.ceil(inputChars / 3) * price.input + setting.maxOutputTokens * price.output);
}

/**
 * Actual cost from reported usage. Cached input bills at the cached rate and is part of
 * `inputTokens`; reasoning is part of `outputTokens`. Returns null when usage is missing.
 */
export function usageMicrodollars(model: string, usage: AgentModelUsage, prices?: Readonly<Record<string, ModelPrice>>): Microdollars | null {
  if (usage.inputTokens === null && usage.outputTokens === null) return null;
  const price = modelPrice(model, prices);
  const cached = Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens ?? 0);
  const fresh = (usage.inputTokens ?? 0) - cached;
  return Math.ceil(fresh * price.input + cached * price.cachedInput + (usage.outputTokens ?? 0) * price.output);
}

export function inputHash(...parts: readonly string[]): string {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(String(part.length)).update(":").update(part);
  return hash.digest("hex");
}

export class AgentBudgetRefused extends Error {
  constructor() { super("budget_exhausted"); }
}

/**
 * Wraps one model call with reserve and settle. A refused reservation throws
 * `AgentBudgetRefused` before the call. Settle always runs, with the estimate when the
 * provider reported no usage. Returns the call's value and the settled cost.
 */
export async function meteredCall<T>(input: Readonly<{
  metering: AgentMetering;
  accountId: string;
  agent: AgentName;
  setting: AgentModelSetting;
  inputChars: number;
  call: (onUsage: (usage: AgentModelUsage) => void) => Promise<T>;
  onCost?: (microdollars: Microdollars) => void;
}>): Promise<T> {
  const estimate = estimateCallMicrodollars(input.setting, input.inputChars);
  const reservation = await input.metering.budget.reserve({ accountId: input.accountId, agent: input.agent, estimateMicrodollars: estimate });
  if (!reservation.granted) throw new AgentBudgetRefused();
  let actual: Microdollars | null = null;
  try {
    return await input.call((usage) => {
      const cost = usageMicrodollars(input.setting.model, usage);
      if (cost !== null) actual = (actual ?? 0) + cost;
    });
  } finally {
    const settled = actual ?? estimate;
    input.onCost?.(settled);
    await input.metering.budget.settle({ reservationId: reservation.reservationId, actualMicrodollars: settled }).catch(() => undefined);
  }
}
