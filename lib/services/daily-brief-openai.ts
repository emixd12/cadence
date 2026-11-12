import type { DailyBriefGenerator, DailyBriefModelUsage } from "./daily-brief-consumer";
import { adviceRejected, DailyBriefError } from "./daily-brief-consumer";
import { DAILY_BRIEF_SCHEMA, DAILY_BRIEF_SCHEMA_NAME } from "./daily-brief-schema";

export const DAILY_BRIEF_MODEL = "gpt-5.6-luna";
/** The production reasoning effort. */
export const DAILY_BRIEF_REASONING_EFFORT = "low";

/**
 * The `reasoning.effort` values the OpenAI Responses API reference documents
 * (checked November 9, 2026). Not every model supports every value; the provider
 * rejects an unsupported one, which the workbench records as a failed run.
 */
export const OPENAI_REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type OpenAIReasoningEffort = typeof OPENAI_REASONING_EFFORTS[number];

/**
 * Ticket 290: a different model or reasoning effort for one brief call. Only the
 * development workbench passes it; production omits it and sends DAILY_BRIEF_MODEL
 * with DAILY_BRIEF_REASONING_EFFORT.
 */
export type DailyBriefGenerationOverride = Readonly<{ model?: string; effort?: OpenAIReasoningEffort }>;

/** Server-only adapter. Do not log request/response bodies or persist response IDs. */
export async function generateOpenAIDailyBrief(
  input: Parameters<DailyBriefGenerator>[0],
  options: Readonly<{ apiKey: string; fetch?: typeof fetch }> & DailyBriefGenerationOverride,
): Promise<unknown> {
  return requestStructured(input, options, DAILY_BRIEF_SCHEMA_NAME, DAILY_BRIEF_SCHEMA, { model: options.model, effort: options.effort });
}

/** Ticket 188 estimate step: same transport and limits, separate strict schema. Always the production model and effort. */
export async function generateOpenAIDurationEstimates(
  input: Parameters<DailyBriefGenerator>[0],
  options: Readonly<{ apiKey: string; fetch?: typeof fetch }>,
): Promise<unknown> {
  return input.estimateVariant === "alongside"
    ? requestStructured(input, options, "cadence_duration_estimates_v1_2", DURATION_ESTIMATE_ALONGSIDE_SCHEMA)
    : requestStructured(input, options, "cadence_duration_estimates", DURATION_ESTIMATE_SCHEMA);
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

async function requestStructured(
  input: Parameters<DailyBriefGenerator>[0],
  options: Readonly<{ apiKey: string; fetch?: typeof fetch }>,
  name: string,
  schema: unknown,
  generation: DailyBriefGenerationOverride = {},
): Promise<unknown> {
  if (!options.apiKey) throw new DailyBriefError("not_configured");
  const response = await (options.fetch ?? fetch)("https://api.openai.com/v1/responses", {
    method: "POST", redirect: "error", cache: "no-store", signal: input.signal,
    headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
    body: dailyBriefRequestBody(input, name, schema, generation),
  });
  // Ticket 288: every failure keeps its public code and carries a short internal reason.
  if (!response.ok) {
    await response.body?.cancel();
    const reason = response.status === 429 ? "provider_http_429" : `provider_http_${Math.floor(response.status / 100)}xx`;
    throw response.status === 429 ? new DailyBriefError("rate_limited", undefined, reason) : adviceRejected(reason);
  }
  const reader = response.body?.getReader();
  if (!reader) throw adviceRejected("provider_body_missing");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let body: unknown;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 64 * 1024) throw adviceRejected("provider_body_too_large");
      chunks.push(value);
    }
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw adviceRejected("provider_body_not_json"); }
  } finally { await reader.cancel(); }
  // Usage is reported before the status check: an incomplete or rejected response still consumed tokens.
  if (record(body) && input.onUsage) {
    const usage = parseOpenAIUsage(body.usage);
    if (usage) {
      try { input.onUsage(usage); } catch { /* Telemetry never changes the result. */ }
    }
  }
  if (!record(body) || !Array.isArray(body.output)) throw adviceRejected("provider_shape");
  if (body.status !== "completed") throw adviceRejected(statusReason(body));
  const texts: string[] = [];
  for (const item of body.output) {
    if (!record(item)) throw adviceRejected("provider_shape");
    if (item.type === "reasoning") continue;
    if (item.type !== "message" || item.role !== "assistant" || item.status !== "completed" || !Array.isArray(item.content)) throw adviceRejected("provider_shape");
    for (const part of item.content) {
      if (record(part) && part.type === "refusal") throw adviceRejected("provider_refusal");
      if (!record(part) || part.type !== "output_text" || typeof part.text !== "string") throw adviceRejected("provider_shape");
      texts.push(part.text);
    }
  }
  if (texts.length !== 1) throw adviceRejected("provider_shape");
  try { return JSON.parse(texts[0]); }
  catch { throw adviceRejected("output_not_json"); }
}

/**
 * The exact request body. Exported so a test can prove that usage collection
 * leaves it byte-identical (Ticket 288). `onUsage` never reaches the provider.
 * Without a generation override the body is the production body (Ticket 290).
 */
export function dailyBriefRequestBody(input: Parameters<DailyBriefGenerator>[0], name: string, schema: unknown, generation: DailyBriefGenerationOverride = {}): string {
  return JSON.stringify({
    model: generation.model ?? DAILY_BRIEF_MODEL, store: false, background: false, tools: [], tool_choice: "none",
    reasoning: { effort: generation.effort ?? DAILY_BRIEF_REASONING_EFFORT }, max_output_tokens: 2_000,
    instructions: input.instructions, input: input.facts,
    text: { format: { type: "json_schema", name, strict: true, schema } },
  });
}

/**
 * Reads the Responses API `usage` object: `input_tokens`,
 * `input_tokens_details.cached_tokens`, `output_tokens` and
 * `output_tokens_details.reasoning_tokens`. Any missing or malformed count
 * becomes null; a missing `usage` object returns null.
 */
export function parseOpenAIUsage(value: unknown): DailyBriefModelUsage | null {
  if (!record(value)) return null;
  const count = (item: unknown) => typeof item === "number" && Number.isSafeInteger(item) && item >= 0 ? item : null;
  const input = record(value.input_tokens_details) ? value.input_tokens_details : {};
  const output = record(value.output_tokens_details) ? value.output_tokens_details : {};
  return { inputTokens: count(value.input_tokens), cachedInputTokens: count(input.cached_tokens),
    outputTokens: count(value.output_tokens), reasoningTokens: count(output.reasoning_tokens) };
}

/** `provider_incomplete` plus the provider's reason when it is a short lowercase code, such as `max_output_tokens`. */
function statusReason(body: Record<string, unknown>): string {
  const safe = (value: unknown) => typeof value === "string" && /^[a-z][a-z_]{0,17}$/.test(value) ? value : null;
  if (body.status === "incomplete") {
    const detail = record(body.incomplete_details) ? safe(body.incomplete_details.reason) : null;
    return detail ? `provider_incomplete_${detail}` : "provider_incomplete";
  }
  const status = safe(body.status);
  return status ? `provider_status_${status}` : "provider_shape";
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
