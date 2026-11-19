import { createGateway, generateText, jsonSchema, NoObjectGeneratedError, Output, type LanguageModel } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";

/**
 * Phase 1B model layer. Every Cadence agent model call goes through the AI SDK with an
 * AI Gateway model string (`creator/model`). The model is a per-agent setting; the eval
 * harness passes an override to try another one.
 *
 * Transport: `CADENCE_MODEL_TRANSPORT=gateway` sends calls through Vercel AI Gateway
 * (`AI_GATEWAY_API_KEY`, or OIDC on Vercel). Any other value, or none, is the direct
 * transport: each model goes straight to its creator with the owner's own key, so it
 * spends credits already bought there. `openai/...` uses `OPENAI_API_KEY` (the same
 * OpenAI account as before Phase 1B) and `anthropic/...` uses `ANTHROPIC_API_KEY`
 * (for development and evals; production's default model is OpenAI). Other creators
 * need the gateway. Switching production to the gateway is an owner decision.
 *
 * Never log prompts, facts, output or response IDs here.
 */

export type AgentName = "daily_brief" | "coach" | "chat";

/** Provider-neutral reasoning effort values the AI SDK accepts (`reasoning` call option). */
export const AGENT_REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type AgentReasoningEffort = typeof AGENT_REASONING_EFFORTS[number];

export type AgentModelSetting = Readonly<{
  /** AI Gateway model string, `creator/model`. */
  model: string;
  reasoning: AgentReasoningEffort;
  maxOutputTokens: number;
  /** Per-call ceiling; the caller's own deadline still applies. */
  timeoutMs: number;
}>;

/**
 * Per-agent defaults. The Daily Brief values are today's production values
 * (`gpt-5.6-luna`, effort low, 2,000 output tokens). Coach and chat are placeholders until
 * Phases 4 and 5 pick theirs with the eval harness.
 */
export const AGENT_MODEL_SETTINGS = {
  daily_brief: { model: "openai/gpt-5.6-luna", reasoning: "low", maxOutputTokens: 2_000, timeoutMs: 30_000 },
  coach: { model: "openai/gpt-5.6-luna", reasoning: "low", maxOutputTokens: 1_000, timeoutMs: 30_000 },
  chat: { model: "openai/gpt-5.6-luna", reasoning: "low", maxOutputTokens: 2_000, timeoutMs: 60_000 },
} as const satisfies Record<AgentName, AgentModelSetting>;

export function agentModelSetting(agent: AgentName, override: Partial<AgentModelSetting> = {}): AgentModelSetting {
  const setting = { ...AGENT_MODEL_SETTINGS[agent], ...override };
  return { ...setting, model: normalizeModelId(setting.model) };
}

const GATEWAY_MODEL_ID = /^[a-z0-9-]{1,32}\/[A-Za-z0-9._:-]{1,64}$/;
const BARE_MODEL_ID = /^[A-Za-z0-9._:-]{1,64}$/;

/** A bare OpenAI model ID saved before Phase 1B (for example `gpt-5.6-luna`) becomes `openai/gpt-5.6-luna`. */
export function normalizeModelId(value: string): string {
  if (GATEWAY_MODEL_ID.test(value)) return value;
  if (BARE_MODEL_ID.test(value)) return `openai/${value}`;
  throw new AgentModelError("invalid_model", "model_id_invalid");
}

export function isModelId(value: unknown): value is string {
  return typeof value === "string" && (GATEWAY_MODEL_ID.test(value) || BARE_MODEL_ID.test(value));
}

export type ModelTransport = "gateway" | "direct";
type Env = Readonly<Record<string, string | undefined>>;

export function modelTransport(env: Env = process.env): ModelTransport {
  return env.CADENCE_MODEL_TRANSPORT === "gateway" ? "gateway" : "direct";
}

/**
 * Whether the production default model can be called. Credentials are checked again by
 * the provider; a direct call to another creator fails then with `not_configured`.
 */
export function agentModelConfigured(env: Env = process.env): boolean {
  return modelTransport(env) === "gateway" ? !!(env.AI_GATEWAY_API_KEY || env.VERCEL_OIDC_TOKEN || env.VERCEL) : !!env.OPENAI_API_KEY;
}

/** Token counts from one call. A count is null when the provider did not report it. */
export type AgentModelUsage = Readonly<{
  inputTokens: number | null;
  cachedInputTokens: number | null;
  /** Input tokens written to a prompt cache on this call. Anthropic bills these above the input price. */
  cacheWriteTokens?: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
}>;

/**
 * `kind` decides the public outcome: `not_configured`, `rate_limited`, or `rejected`
 * (any provider or output failure). `reason` is a short internal code for logs and evals.
 */
export class AgentModelError extends Error {
  constructor(public readonly kind: "not_configured" | "rate_limited" | "rejected" | "invalid_model", public readonly reason: string) {
    super(reason);
  }
}

export type StructuredCallInput = Readonly<{
  agent: AgentName;
  setting: AgentModelSetting;
  instructions: string;
  prompt: string;
  schemaName: string;
  schema: unknown;
  signal: AbortSignal;
  onUsage?: (usage: AgentModelUsage) => void;
  env?: Env;
  /** Tests inject a fetch; production uses the global one. */
  fetch?: typeof fetch;
}>;

/** Largest accepted structured output, as before Phase 1B. */
const MAX_OUTPUT_BYTES = 64 * 1024;

/**
 * One structured-output call with no tools and no retries. Returns the parsed JSON object;
 * the caller's own validator decides whether it is acceptable.
 */
export async function generateStructured(input: StructuredCallInput): Promise<unknown> {
  const env = input.env ?? process.env;
  const model = resolveModel(input.setting.model, env, input.fetch);
  const report = (usage: unknown) => {
    const parsed = parseUsage(usage);
    if (parsed && input.onUsage) {
      try { input.onUsage(parsed); } catch { /* Telemetry never changes the result. */ }
    }
  };
  let result;
  try {
    result = await generateText({
      model,
      // The instructions are the same for every account, so they end in a cache breakpoint.
      // OpenAI caches a repeated prefix on its own; Anthropic caches only where it is asked to.
      // Other providers ignore the Anthropic option.
      instructions: { role: "system", content: input.instructions, providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } },
      prompt: input.prompt,
      output: Output.object({ name: input.schemaName, schema: jsonSchema(input.schema as Parameters<typeof jsonSchema>[0]) }),
      reasoning: input.setting.reasoning,
      maxOutputTokens: input.setting.maxOutputTokens,
      maxRetries: 0,
      abortSignal: AbortSignal.any([input.signal, AbortSignal.timeout(input.setting.timeoutMs)]),
      providerOptions: {
        openai: { store: false, strictJsonSchema: true, reasoningSummary: null },
        ...(modelTransport(env) === "gateway" ? { gateway: { tags: [`agent:${input.agent}`] } } : {}),
      },
    });
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) {
      report(error.usage);
      throw new AgentModelError("rejected", outputFailureReason(error.finishReason));
    }
    throw mapProviderError(error, input.signal);
  }
  report(result.usage);
  if (result.finishReason !== "stop") throw new AgentModelError("rejected", outputFailureReason(result.finishReason));
  if (Buffer.byteLength(result.text, "utf8") > MAX_OUTPUT_BYTES) throw new AgentModelError("rejected", "provider_body_too_large");
  try { return result.output; }
  catch { throw new AgentModelError("rejected", "output_not_json"); }
}

/** The AI SDK model for a Gateway model string, on this deployment's transport. Chat (Phase 5) streams with it. */
export function resolveAgentModel(id: string, env: Env = process.env, customFetch?: typeof fetch): LanguageModel {
  return resolveModel(id, env, customFetch);
}

/** Maps a provider failure to an AgentModelError, as generateStructured does. */
export function agentModelFailure(error: unknown, signal: AbortSignal): unknown {
  return mapProviderError(error, signal);
}

function resolveModel(id: string, env: Env, customFetch?: typeof fetch): LanguageModel {
  if (modelTransport(env) === "gateway") {
    const apiKey = env.AI_GATEWAY_API_KEY;
    return createGateway({ ...(apiKey ? { apiKey } : {}), ...(customFetch ? { fetch: customFetch } : {}) })(id);
  }
  const slash = id.indexOf("/");
  const creator = slash === -1 ? id : id.slice(0, slash);
  const name = slash === -1 ? "" : id.slice(slash + 1);
  if (!name) throw new AgentModelError("invalid_model", "model_id_invalid");
  if (creator === "openrouter") {
    // Eval-only route to models neither direct provider serves ("openrouter/deepseek/...").
    if (!env.OPENROUTER_API_KEY) throw new AgentModelError("not_configured", "openrouter_key_missing");
    if (!name.includes("/")) throw new AgentModelError("invalid_model", "model_id_invalid");
    return createOpenAI({ apiKey: env.OPENROUTER_API_KEY, baseURL: "https://openrouter.ai/api/v1", name: "openrouter",
      ...(customFetch ? { fetch: customFetch } : {}) }).chat(name);
  }
  if (creator === "openai") {
    if (!env.OPENAI_API_KEY) throw new AgentModelError("not_configured", "openai_key_missing");
    return createOpenAI({ apiKey: env.OPENAI_API_KEY, ...(customFetch ? { fetch: customFetch } : {}) }).responses(name);
  }
  if (creator === "anthropic") {
    if (!env.ANTHROPIC_API_KEY) throw new AgentModelError("not_configured", "anthropic_key_missing");
    return createAnthropic({ apiKey: env.ANTHROPIC_API_KEY, ...(customFetch ? { fetch: customFetch } : {}) })(anthropicApiModelId(name));
  }
  // Without the gateway only OpenAI and Anthropic models are reachable.
  throw new AgentModelError("not_configured", "model_needs_gateway");
}

/**
 * AI Gateway writes Claude versions with dots (`claude-sonnet-5.5`); the Anthropic API
 * uses dashes (`claude-sonnet-5-5`). Dated IDs (`claude-haiku-4-5-20251001`) pass through.
 */
export function anthropicApiModelId(name: string): string {
  return name.replace(/\./g, "-");
}

function outputFailureReason(finishReason: string | undefined): string {
  if (finishReason === "length") return "provider_incomplete_max_output_tokens";
  if (finishReason === "content-filter") return "provider_refusal";
  if (finishReason === "stop" || finishReason === undefined) return "output_not_json";
  return `provider_incomplete_${finishReason.replace(/[^a-z]/g, "_").slice(0, 17)}`;
}

function mapProviderError(error: unknown, signal: AbortSignal): unknown {
  if (signal.aborted) return error;
  if (error instanceof AgentModelError) return error;
  const name = error instanceof Error ? error.name : "";
  if (name === "AbortError" || name === "TimeoutError") return new AgentModelError("rejected", "provider_timeout");
  if (/LoadAPIKeyError|GatewayAuthenticationError/.test(name)) return new AgentModelError("not_configured", "provider_auth");
  const status = record(error) && typeof error.statusCode === "number" ? error.statusCode : null;
  if (status === 429) return new AgentModelError("rate_limited", "provider_http_429");
  // A 2xx status here means the body itself was unreadable.
  if (status !== null && status >= 200 && status < 300) return new AgentModelError("rejected", "provider_shape");
  if (status !== null) return new AgentModelError("rejected", `provider_http_${Math.floor(status / 100)}xx`);
  return new AgentModelError("rejected", "provider_shape");
}

/** Reads the AI SDK `LanguageModelUsage` shape. Returns null when no count is present. */
export function parseUsage(value: unknown): AgentModelUsage | null {
  if (!record(value)) return null;
  const count = (item: unknown) => typeof item === "number" && Number.isSafeInteger(item) && item >= 0 ? item : null;
  const input = record(value.inputTokenDetails) ? value.inputTokenDetails : {};
  const output = record(value.outputTokenDetails) ? value.outputTokenDetails : {};
  const usage = { inputTokens: count(value.inputTokens), cachedInputTokens: count(input.cacheReadTokens),
    outputTokens: count(value.outputTokens), reasoningTokens: count(output.reasoningTokens) };
  if (Object.values(usage).every((item) => item === null)) return null;
  // Anthropic bills cache writes above the input price; OpenAI reports them too, at the input price.
  const written = count(input.cacheWriteTokens);
  return written ? { ...usage, cacheWriteTokens: written } : usage;
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
