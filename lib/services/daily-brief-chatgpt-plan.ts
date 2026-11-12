import type { DailyBriefModelRequest, DailyBriefModelUsage } from "./daily-brief-consumer";
import { DAILY_BRIEF_SCHEMA, DAILY_BRIEF_SCHEMA_NAME } from "./daily-brief-schema";

/**
 * Ticket 296: the Daily Brief model call on the user's ChatGPT plan (decision D27).
 * The Mac runs it with the user's ChatGPT access token; Cadence's server prepares the
 * request and validates the output. Browser-safe: no Node APIs, no runtime imports
 * beyond the shared schema. Never logs or stores request or response bodies.
 * Request contract and model order: `docs/qa/2026-11-07-chatgpt-plan-spike.md`.
 */
export const CHATGPT_PLAN_API_BASE = "https://api.openai.com/v1";

/** Owner decision, November 12, 2026: the first of these the catalog lists is used. */
export const CHATGPT_PLAN_MODEL_ORDER = ["gpt-6.1-sol", "gpt-6.1-terra", "gpt-6-luna"] as const;

export const CHATGPT_PLAN_REASONING_EFFORT = "low";

/** Today's hosted cap on the model's reply, applied to the extracted output text. */
export const CHATGPT_PLAN_OUTPUT_LIMIT_BYTES = 64 * 1024;

/**
 * The event stream repeats the response object (with its instructions) in several
 * events, so responses get a larger cap than the output. Catalog, error and plain
 * JSON bodies use the same cap.
 */
export const CHATGPT_PLAN_STREAM_LIMIT_BYTES = 256 * 1024;

/**
 * What the Mac shows. `usage_limit`: the plan's limit is reached ("Manage usage").
 * `not_eligible`: the account's plan cannot run it. `reconnect`: sign in to ChatGPT
 * again. `retry_later`: a temporary provider or network failure. `advisor_unavailable`:
 * the reply broke the contract. `timeout`: the caller's signal ended the call.
 */
export type ChatGPTPlanErrorCode = "usage_limit" | "not_eligible" | "reconnect" | "retry_later" | "advisor_unavailable" | "timeout";

/** `reason` is a short internal code for logs and tests; it never holds provider text. */
export class ChatGPTPlanError extends Error {
  constructor(public readonly code: ChatGPTPlanErrorCode, public readonly reason: string) {
    super(code);
    this.name = "ChatGPTPlanError";
  }
}

const CODE_MAP: Readonly<Record<string, ChatGPTPlanErrorCode>> = {
  subscription_sharing_usage_limit_exceeded: "usage_limit",
  subscription_sharing_user_not_eligible: "not_eligible",
  subscription_sharing_route_not_supported: "not_eligible",
  subscription_sharing_invalid_user: "reconnect",
  chatpass_v2_scope_not_authorized: "reconnect",
  chatpass_v2_invalid_authorization_context: "reconnect",
  invalid_api_key: "reconnect",
  token_expired: "reconnect",
  server_is_overloaded: "retry_later",
  rate_limit_exceeded: "retry_later",
  server_error: "retry_later",
};

/** Maps a provider error code and HTTP status to what the Mac shows. A known code wins over the status. */
export function chatGPTPlanErrorCode(code: string | null, status: number | null): ChatGPTPlanErrorCode {
  const mapped = code && Object.hasOwn(CODE_MAP, code) ? CODE_MAP[code] : null;
  if (mapped) return mapped;
  if (code?.startsWith("chatpass_v2_")) return "reconnect";
  if (status === 401) return "reconnect";
  if (status === 429 || status === 408 || (status !== null && status >= 500)) return "retry_later";
  return "advisor_unavailable";
}

export type ChatGPTPlanCatalogModel = Readonly<{ slug: string; visibility: string | null }>;

/** Reads `models` (or `data`) rows from `GET /v1/models`; rows without a slug are skipped. */
export function parseChatGPTPlanCatalog(body: unknown): ChatGPTPlanCatalogModel[] {
  const rows = record(body) && Array.isArray(body.models) ? body.models : record(body) && Array.isArray(body.data) ? body.data : [];
  return rows.flatMap((row) => {
    if (!record(row)) return [];
    const slug = typeof row.slug === "string" ? row.slug : typeof row.id === "string" ? row.id : null;
    return slug ? [{ slug, visibility: typeof row.visibility === "string" ? row.visibility : null }] : [];
  });
}

/** The first model in the owner's order that the catalog lists. Null means the plan cannot run a brief (no fallback, D27). */
export function selectChatGPTPlanModel(models: readonly ChatGPTPlanCatalogModel[]): string | null {
  const listed = new Set(models.filter((model) => model.visibility === "list").map((model) => model.slug));
  return CHATGPT_PLAN_MODEL_ORDER.find((slug) => listed.has(slug)) ?? null;
}

export type ChatGPTPlanCallOptions = Readonly<{
  accessToken: string;
  signal: AbortSignal;
  fetch?: typeof fetch;
  apiBase?: string;
}>;

/** Reads the account's model catalog and returns the model to use, or throws `not_eligible` when none is listed. */
export async function chooseChatGPTPlanModel(options: ChatGPTPlanCallOptions): Promise<string> {
  const response = await send(options, "/models", { method: "GET", headers: { Accept: "application/json" } });
  if (!response.ok) await failFromResponse(response, options.signal);
  const body = await readJsonResponse(response, options.signal);
  if (!record(body) || (!Array.isArray(body.models) && !Array.isArray(body.data))) throw new ChatGPTPlanError("advisor_unavailable", "provider_shape");
  const model = selectChatGPTPlanModel(parseChatGPTPlanCatalog(body));
  if (!model) throw new ChatGPTPlanError("not_eligible", "catalog_no_supported_model");
  return model;
}

/**
 * The plan request body: today's hosted body with `stream: true`, `input` as a
 * message list and no `background`, which the plan route rejects.
 */
export function chatGPTPlanBriefBody(request: DailyBriefModelRequest, model: string): string {
  return JSON.stringify({
    model, store: false, stream: true, tools: [], tool_choice: "none",
    reasoning: { effort: CHATGPT_PLAN_REASONING_EFFORT }, max_output_tokens: 2_000,
    instructions: request.instructions, input: [{ role: "user", content: request.facts }],
    text: { format: { type: "json_schema", name: DAILY_BRIEF_SCHEMA_NAME, strict: true, schema: DAILY_BRIEF_SCHEMA } },
  });
}

/**
 * Runs one Daily Brief call on the plan and returns the parsed model output for
 * Cadence's server to validate. Every failure is a `ChatGPTPlanError`.
 */
export async function generateChatGPTPlanDailyBrief(request: DailyBriefModelRequest, options: ChatGPTPlanCallOptions & Readonly<{
  model: string;
  onUsage?: (usage: DailyBriefModelUsage) => void;
}>): Promise<unknown> {
  const response = await send(options, "/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: chatGPTPlanBriefBody(request, options.model),
  });
  if (!response.ok) await failFromResponse(response, options.signal);
  const completed = await readCompletedResponse(response, options.signal);
  if (options.onUsage) {
    const usage = parseUsage(completed.usage);
    if (usage) {
      try { options.onUsage(usage); } catch { /* Telemetry never changes the result. */ }
    }
  }
  return parseOutput(completed);
}

async function send(options: ChatGPTPlanCallOptions, path: string, init: RequestInit & { headers: Record<string, string> }): Promise<Response> {
  if (!options.accessToken) throw new ChatGPTPlanError("reconnect", "token_missing");
  if (options.signal.aborted) throw new ChatGPTPlanError("timeout", "aborted");
  try {
    return await (options.fetch ?? fetch)(`${options.apiBase ?? CHATGPT_PLAN_API_BASE}${path}`, {
      ...init, redirect: "error", cache: "no-store", signal: options.signal,
      headers: { ...init.headers, Authorization: `Bearer ${options.accessToken}` },
    });
  } catch {
    throw options.signal.aborted ? new ChatGPTPlanError("timeout", "aborted") : new ChatGPTPlanError("retry_later", "network_error");
  }
}

async function failFromResponse(response: Response, signal: AbortSignal): Promise<never> {
  // Bound error bodies as well; only the code is kept.
  const body = await readJsonResponse(response, signal);
  const code = errorCodeOf(body);
  throw new ChatGPTPlanError(chatGPTPlanErrorCode(code, response.status), code ? `provider_${safe(code)}` : `provider_http_${response.status}`);
}

/** Every response uses the same byte limit, cancellation and transport-error rules. */
async function* readBody(response: Response, signal: AbortSignal): AsyncGenerator<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) throw new ChatGPTPlanError("advisor_unavailable", "provider_body_missing");
  let bytes = 0;
  try {
    for (;;) {
      if (signal.aborted) throw new ChatGPTPlanError("timeout", "aborted");
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try { chunk = await reader.read(); }
      catch { throw signal.aborted ? new ChatGPTPlanError("timeout", "aborted") : new ChatGPTPlanError("retry_later", "stream_interrupted"); }
      if (signal.aborted) throw new ChatGPTPlanError("timeout", "aborted");
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > CHATGPT_PLAN_STREAM_LIMIT_BYTES) throw new ChatGPTPlanError("advisor_unavailable", "provider_body_too_large");
      yield chunk.value;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

async function readJsonResponse(response: Response, signal: AbortSignal): Promise<unknown> {
  if (signal.aborted) throw new ChatGPTPlanError("timeout", "aborted");
  if (!response.body) return null;
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of readBody(response, signal)) text += decoder.decode(chunk, { stream: true });
  text += decoder.decode();
  try { return JSON.parse(text); } catch { return null; }
}

/**
 * Reads the event stream through `response.completed`. The plan route sends it with
 * no Content-Type header (Ticket 295), so the body is read as SSE unless it is JSON.
 */
async function readCompletedResponse(response: Response, signal: AbortSignal): Promise<Record<string, unknown>> {
  if ((response.headers.get("content-type") ?? "").includes("json")) {
    // A plain JSON reply would mean the route ignored `stream: true`; accept a completed one.
    const body = await readJsonResponse(response, signal);
    if (record(body) && body.status === "completed") return body;
    throw new ChatGPTPlanError("advisor_unavailable", "provider_shape");
  }
  const decoder = new TextDecoder();
  const parser = createSseParser();
  let result: Record<string, unknown> | null = null;
  for await (const chunk of readBody(response, signal)) {
    for (const data of parser.push(decoder.decode(chunk, { stream: true }))) {
      result = handleEvent(data);
      if (result) break;
    }
    if (result) break;
  }
  if (!result) for (const data of [...parser.push(decoder.decode()), ...parser.end()]) result ??= handleEvent(data);
  if (!result) throw signal.aborted ? new ChatGPTPlanError("timeout", "aborted") : new ChatGPTPlanError("retry_later", "stream_interrupted");
  return result;
}

/** Returns the completed response object, throws on a terminal failure, or returns null to keep reading. */
function handleEvent(data: string): Record<string, unknown> | null {
  if (data === "[DONE]") return null;
  let event: unknown;
  try { event = JSON.parse(data); } catch { return null; }
  if (!record(event) || typeof event.type !== "string") return null;
  const body = record(event.response) ? event.response : null;
  switch (event.type) {
    case "response.completed":
      if (!body) throw new ChatGPTPlanError("advisor_unavailable", "provider_shape");
      return body;
    case "response.failed": {
      const code = errorCodeOf(body ? { error: body.error } : null);
      throw new ChatGPTPlanError(streamFailureCode(code), code ? `provider_${safe(code)}` : "provider_failed");
    }
    case "response.incomplete": {
      const reason = body && record(body.incomplete_details) && typeof body.incomplete_details.reason === "string" ? safe(body.incomplete_details.reason) : null;
      throw new ChatGPTPlanError("advisor_unavailable", reason ? `provider_incomplete_${reason}` : "provider_incomplete");
    }
    case "error": {
      const code = errorCodeOf(record(event.error) ? event : { error: event });
      throw new ChatGPTPlanError(streamFailureCode(code), code ? `provider_${safe(code)}` : "provider_error_event");
    }
    default:
      return null;
  }
}

/** A failure reported inside the stream: a known code maps as usual; anything else is a temporary provider failure. */
function streamFailureCode(code: string | null): ChatGPTPlanErrorCode {
  const mapped = chatGPTPlanErrorCode(code, null);
  return mapped === "advisor_unavailable" ? "retry_later" : mapped;
}

/** The same output rules as the hosted adapter: one assistant message with one output text, parsed as JSON. */
function parseOutput(body: Record<string, unknown>): unknown {
  if (body.status !== "completed" || !Array.isArray(body.output)) throw new ChatGPTPlanError("advisor_unavailable", "provider_shape");
  const texts: string[] = [];
  for (const item of body.output) {
    if (!record(item)) throw new ChatGPTPlanError("advisor_unavailable", "provider_shape");
    if (item.type === "reasoning") continue;
    if (item.type !== "message" || item.role !== "assistant" || item.status !== "completed" || !Array.isArray(item.content)) throw new ChatGPTPlanError("advisor_unavailable", "provider_shape");
    for (const part of item.content) {
      if (record(part) && part.type === "refusal") throw new ChatGPTPlanError("advisor_unavailable", "provider_refusal");
      if (!record(part) || part.type !== "output_text" || typeof part.text !== "string") throw new ChatGPTPlanError("advisor_unavailable", "provider_shape");
      texts.push(part.text);
    }
  }
  if (texts.length !== 1) throw new ChatGPTPlanError("advisor_unavailable", "provider_shape");
  if (new TextEncoder().encode(texts[0]).byteLength > CHATGPT_PLAN_OUTPUT_LIMIT_BYTES) throw new ChatGPTPlanError("advisor_unavailable", "provider_body_too_large");
  try { return JSON.parse(texts[0]); }
  catch { throw new ChatGPTPlanError("advisor_unavailable", "output_not_json"); }
}

/** Same reading as the hosted `parseOpenAIUsage`; any malformed count becomes null. */
function parseUsage(value: unknown): DailyBriefModelUsage | null {
  if (!record(value)) return null;
  const count = (item: unknown) => typeof item === "number" && Number.isSafeInteger(item) && item >= 0 ? item : null;
  const input = record(value.input_tokens_details) ? value.input_tokens_details : {};
  const output = record(value.output_tokens_details) ? value.output_tokens_details : {};
  return { inputTokens: count(value.input_tokens), cachedInputTokens: count(input.cached_tokens),
    outputTokens: count(value.output_tokens), reasoningTokens: count(output.reasoning_tokens) };
}

/** Minimal text/event-stream parser that tolerates chunk boundaries anywhere; returns each event's data. */
export function createSseParser(): { push: (chunk: string) => string[]; end: () => string[] } {
  let buffer = "";
  let data: string[] = [];
  const out: string[] = [];
  const line = (raw: string) => {
    if (raw === "") { if (data.length) out.push(data.join("\n")); data = []; return; }
    if (raw.startsWith(":")) return;
    const colon = raw.indexOf(":");
    const field = colon === -1 ? raw : raw.slice(0, colon);
    if (field === "data") data.push(colon === -1 ? "" : raw.slice(colon + 1).replace(/^ /u, ""));
  };
  const drain = () => out.splice(0, out.length);
  return {
    push(chunk: string) {
      buffer += chunk;
      let index: number;
      while ((index = buffer.search(/\r\n|\n|\r/u)) !== -1) {
        // A lone CR at the end may be the first half of a CRLF split across chunks.
        if (buffer[index] === "\r" && index === buffer.length - 1) break;
        const width = buffer.startsWith("\r\n", index) ? 2 : 1;
        line(buffer.slice(0, index));
        buffer = buffer.slice(index + width);
      }
      return drain();
    },
    end() {
      if (buffer) { line(buffer); buffer = ""; }
      line("");
      return drain();
    },
  };
}

function errorCodeOf(body: unknown): string | null {
  const error = record(body) && record(body.error) ? body.error : null;
  return error && typeof error.code === "string" ? error.code : record(body) && typeof body.code === "string" ? body.code : null;
}

/** Keeps internal reasons to short lowercase codes. */
function safe(value: string): string {
  return /^[a-z0-9][a-z0-9_]{0,63}$/u.test(value) ? value : "unrecognized";
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
