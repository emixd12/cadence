import type { DailyBriefGenerator } from "./daily-brief-consumer";
import { adviceRejected, DailyBriefError } from "./daily-brief-consumer";
import { DAILY_BRIEF_SCHEMA, DAILY_BRIEF_SCHEMA_NAME } from "./daily-brief-schema";
import { AGENT_MODEL_SETTINGS, AGENT_REASONING_EFFORTS, AgentModelError, agentModelSetting, generateStructured, type AgentModelSetting, type AgentReasoningEffort } from "./agent-model";

/**
 * Daily Brief model adapter (Phase 1B). Replaces the direct OpenAI Responses client with one
 * AI SDK structured-output call through `agent-model.ts`. The schema, output cap, timeout,
 * model and effort are today's production values; only the transport changed.
 */
export const DAILY_BRIEF_MODEL: string = AGENT_MODEL_SETTINGS.daily_brief.model;
export const DAILY_BRIEF_REASONING_EFFORT: AgentReasoningEffort = AGENT_MODEL_SETTINGS.daily_brief.reasoning;
export const DAILY_BRIEF_REASONING_EFFORTS = AGENT_REASONING_EFFORTS;

/** Ticket 290: a different model or effort for one call. Only the workbench and eval harness pass it. */
export type DailyBriefGenerationOverride = Readonly<{ model?: string; effort?: AgentReasoningEffort }>;

type AdapterOptions = Readonly<{ env?: Readonly<Record<string, string | undefined>>; fetch?: typeof fetch }> & DailyBriefGenerationOverride;

export function dailyBriefModelSetting(override: DailyBriefGenerationOverride = {}): AgentModelSetting {
  return agentModelSetting("daily_brief", { ...(override.model ? { model: override.model } : {}), ...(override.effort ? { reasoning: override.effort } : {}) });
}

/** Server-only. Do not log request or response bodies or keep response IDs. */
export async function generateDailyBriefWithModel(input: Parameters<DailyBriefGenerator>[0], options: AdapterOptions = {}): Promise<unknown> {
  return call(input, options, DAILY_BRIEF_SCHEMA_NAME, DAILY_BRIEF_SCHEMA, dailyBriefModelSetting(options));
}

/** Ticket 188 estimate step: same transport and limits, its own strict schema, always the production setting. */
export async function generateDurationEstimatesWithModel(input: Parameters<DailyBriefGenerator>[0], options: Omit<AdapterOptions, "model" | "effort"> = {}): Promise<unknown> {
  return input.estimateVariant === "alongside"
    ? call(input, options, "cadence_duration_estimates_v1_2", DURATION_ESTIMATE_ALONGSIDE_SCHEMA, dailyBriefModelSetting())
    : call(input, options, "cadence_duration_estimates", DURATION_ESTIMATE_SCHEMA, dailyBriefModelSetting());
}

const DURATION_ESTIMATE_SCHEMA = { type: "object", additionalProperties: false, required: ["estimates"], properties: {
  estimates: { type: "array", items: { type: "object", additionalProperties: false, required: ["behaviorRef", "minutes", "basis"], properties: {
    behaviorRef: { type: "string" }, minutes: { type: ["integer", "null"] }, basis: { type: "string", enum: ["stated", "inferred"] },
  } } },
} } as const;

/** Recipe 1.2 adds `alongside`: whether the activity can usually happen during other activities. */
const DURATION_ESTIMATE_ALONGSIDE_SCHEMA = { type: "object", additionalProperties: false, required: ["estimates"], properties: {
  estimates: { type: "array", items: { type: "object", additionalProperties: false, required: ["behaviorRef", "minutes", "basis", "alongside"], properties: {
    behaviorRef: { type: "string" }, minutes: { type: ["integer", "null"] }, basis: { type: "string", enum: ["stated", "inferred"] }, alongside: { type: "boolean" },
  } } },
} } as const;

async function call(input: Parameters<DailyBriefGenerator>[0], options: AdapterOptions, schemaName: string, schema: unknown, setting: AgentModelSetting): Promise<unknown> {
  try {
    return await generateStructured({ agent: "daily_brief", setting, instructions: input.instructions, prompt: input.facts, schemaName, schema,
      signal: input.signal, ...(input.onUsage ? { onUsage: input.onUsage } : {}), ...(options.env ? { env: options.env } : {}), ...(options.fetch ? { fetch: options.fetch } : {}) });
  } catch (error) {
    // Ticket 288: every failure keeps its public code and carries a short internal reason.
    if (!(error instanceof AgentModelError)) throw error;
    if (error.kind === "not_configured") throw new DailyBriefError("not_configured", undefined, error.reason);
    if (error.kind === "rate_limited") throw new DailyBriefError("rate_limited", undefined, error.reason);
    if (error.kind === "invalid_model") throw new DailyBriefError("invalid_request", undefined, error.reason);
    throw adviceRejected(error.reason);
  }
}
