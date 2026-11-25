import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import type { Json } from "@/lib/db/database.types";

// Advisor plan Phase 1A. Every call except the purge runs on a first-party
// agent client (lib/integrations/agent-caller.ts). The database takes the
// agent and the person from the token, never from arguments, and refuses
// session, MCP and job tokens.

export type AgentRunTrigger = "on_demand" | "retry" | "refresh" | "scheduled" | "chat_turn";
export type AgentRunOutcome =
  | "success"
  | "refused_budget"
  | "invalid_output"
  | "model_error"
  | "timeout"
  | "superseded"
  | "error";

export type AgentRunStarted = Readonly<{ runId: string; localDate: string; timezone: string }>;

export type AgentRunFinish = Readonly<{
  runId: string;
  outcome: AgentRunOutcome;
  errorCode: string | null;
  errorReason: string | null;
  inputHash: string | null;
  modelCalls: number;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  toolCalls?: readonly string[];
  linkedProposalIds?: readonly string[];
}>;

export type AgentSpendDecision =
  | Readonly<{ allowed: true; reservationId: string }>
  | Readonly<{ allowed: false; reason: "agent_share" | "account_total" | "global_day"; retryAfterSeconds: number; resetsAt: string }>;

export class AgentRunStorageError extends Error {
  constructor(public readonly code: string, options?: ErrorOptions) {
    super(`Agent run storage failed: ${code}.`, options);
    this.name = "AgentRunStorageError";
  }
}

function storageError(error: { message?: string; code?: string }) {
  const message = error.message ?? "";
  return new AgentRunStorageError(/^(agent|integration)_[a-z_]+$/.test(message) ? message : "database_error");
}

/** Creates or refreshes the person's first-party grant for the token's agent. */
export async function ensureAgentGrant(client: AppSupabaseClient): Promise<Readonly<{
  grantId: string; clientId: string; clientLabel: string; scopes: readonly string[];
}>> {
  const { data, error } = await client.rpc("agent_ensure_grant");
  if (error) throw storageError(error);
  const row = data?.[0];
  if (!row || typeof row.grant_id !== "string" || typeof row.client_id !== "string" ||
      typeof row.client_label !== "string" || !Array.isArray(row.scopes)) {
    throw new AgentRunStorageError("malformed_result");
  }
  return { grantId: row.grant_id, clientId: row.client_id, clientLabel: row.client_label, scopes: row.scopes };
}

export async function startAgentRun(client: AppSupabaseClient, input: Readonly<{
  trigger: AgentRunTrigger; model: string | null; promptVersion: string | null;
}>, signal?: AbortSignal): Promise<AgentRunStarted> {
  const request = client.rpc("agent_run_start", {
    p_trigger: input.trigger, p_model: input.model as string, p_prompt_version: input.promptVersion as string,
  });
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if (error) throw storageError(error);
  const row = data?.[0];
  if (!row || typeof row.run_id !== "string") throw new AgentRunStorageError("malformed_result");
  return { runId: row.run_id, localDate: row.local_date, timezone: row.timezone };
}

export async function finishAgentRun(client: AppSupabaseClient, input: AgentRunFinish, signal?: AbortSignal): Promise<boolean> {
  const request = client.rpc("agent_run_finish", {
    p_run_id: input.runId, p_outcome: input.outcome,
    p_error_code: input.errorCode as string, p_error_reason: input.errorReason as string,
    p_input_hash: input.inputHash as string, p_model_calls: input.modelCalls,
    p_input_tokens: input.inputTokens as number, p_cached_input_tokens: input.cachedInputTokens as number,
    p_output_tokens: input.outputTokens as number, p_reasoning_tokens: input.reasoningTokens as number,
    p_tool_calls: [...(input.toolCalls ?? [])], p_linked_proposal_ids: [...(input.linkedProposalIds ?? [])],
  });
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if (error) throw storageError(error);
  return data === true;
}

/**
 * Content is kept 30 days, or until the end of the run's local day when
 * `calendarDerived` is true. Returns false when that day has already ended.
 */
export async function storeAgentRunContent(client: AppSupabaseClient, input: Readonly<{
  runId: string; kind: "input" | "output"; seq?: number; body: Json; calendarDerived: boolean;
}>, signal?: AbortSignal): Promise<boolean> {
  const request = client.rpc("agent_run_store_content", {
    p_run_id: input.runId, p_kind: input.kind, p_seq: input.seq ?? 0, p_body: input.body,
    p_calendar_derived: input.calendarDerived,
  });
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if (error) throw storageError(error);
  return data === true;
}

/** Reserves an estimate before one model call. A refusal reserves nothing. */
export async function reserveAgentSpend(client: AppSupabaseClient, input: Readonly<{
  runId: string | null; model: string; estimatedMicrodollars: number;
}>, signal?: AbortSignal): Promise<AgentSpendDecision> {
  const request = client.rpc("reserve_agent_spend", {
    p_run_id: input.runId as string, p_model: input.model, p_estimated_microdollars: input.estimatedMicrodollars,
  });
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if (error) throw storageError(error);
  const row = data?.[0];
  if (row?.allowed === true && typeof row.reservation_id === "string") return { allowed: true, reservationId: row.reservation_id };
  if (row?.allowed === false && (row.reason === "agent_share" || row.reason === "account_total" || row.reason === "global_day") &&
      typeof row.retry_after_seconds === "number" && typeof row.resets_at === "string") {
    return { allowed: false, reason: row.reason, retryAfterSeconds: row.retry_after_seconds, resetsAt: row.resets_at };
  }
  throw new AgentRunStorageError("malformed_result");
}

export async function settleAgentSpend(client: AppSupabaseClient, input: Readonly<{
  reservationId: string; actualMicrodollars: number;
}>, signal?: AbortSignal): Promise<boolean> {
  const request = client.rpc("settle_agent_spend", {
    p_reservation_id: input.reservationId, p_actual_microdollars: input.actualMicrodollars,
  });
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if (error) throw storageError(error);
  return data === true;
}

/**
 * Advisor Phase 3: whether a Daily Brief refresh leaves one morning brief funded for
 * every remaining day of the month. `briefMicrodollars` is the caller's estimate of
 * one brief; the database uses this month's average when that is higher.
 */
export async function agentBriefRefreshFunded(client: AppSupabaseClient, briefMicrodollars: number, signal?: AbortSignal): Promise<Readonly<{
  funded: boolean; neededMicrodollars: number; remainingMicrodollars: number; resetsAt: string;
}>> {
  const request = client.rpc("agent_brief_refresh_funded", { p_brief_microdollars: Math.max(1, Math.min(1_000_000, Math.ceil(briefMicrodollars))) });
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if (error) throw storageError(error);
  const row = data?.[0];
  if (!row || typeof row.funded !== "boolean" || typeof row.resets_at !== "string") throw new AgentRunStorageError("malformed_result");
  return { funded: row.funded, neededMicrodollars: Number(row.needed_microdollars), remainingMicrodollars: Number(row.remaining_microdollars), resetsAt: row.resets_at };
}

/** Service role only: clears saved brief text once its local day has ended (advisor Phase 3). */
export async function purgeEndedDailyBriefDays(serviceClient: AppSupabaseClient, signal?: AbortSignal): Promise<number> {
  const request = serviceClient.rpc("purge_ended_daily_brief_days");
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if (error) throw storageError(error);
  if (typeof data !== "number") throw new AgentRunStorageError("malformed_result");
  return data;
}

/** Service role only: the scheduled deletion job. */
export async function purgeExpiredAgentRunContents(serviceClient: AppSupabaseClient, signal?: AbortSignal): Promise<number> {
  const request = serviceClient.rpc("purge_expired_agent_run_contents");
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if (error) throw storageError(error);
  if (typeof data !== "number") throw new AgentRunStorageError("malformed_result");
  return data;
}

/** Service role only: <=30-day derived-finding expiry sweep for Google Calendar MCP AI data. */
export async function purgeExpiredGoogleCalendarAiData(serviceClient: AppSupabaseClient, signal?: AbortSignal): Promise<number> {
  const request = (serviceClient as unknown as {
    rpc: (fn: string) => { abortSignal: (s: AbortSignal) => Promise<{ data: unknown; error: { message?: string; code?: string } | null }> } & Promise<{ data: unknown; error: { message?: string; code?: string } | null }>;
  }).rpc("purge_expired_google_calendar_ai_data");
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if (error) throw storageError(error);
  if (typeof data !== "number") throw new AgentRunStorageError("malformed_result");
  return data;
}
