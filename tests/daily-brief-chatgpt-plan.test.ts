import { readFileSync } from "node:fs";
import { afterEach } from "vitest";
import { MOCK_MODELS, startMockOpenAI, type MockOpenAI } from "../scripts/chatgpt-plan-spike-mock";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import { activeBriefingConfig } from "@/lib/services/briefing-pipeline";
import { briefingFixture } from "@/lib/services/briefing-fixtures";
import { prepareDailyBrief, validateDailyBrief } from "@/lib/services/daily-brief-consumer";
import { dailyBriefRequestBody } from "@/lib/services/daily-brief-openai";
import { DAILY_BRIEF_SCHEMA, DAILY_BRIEF_SCHEMA_NAME } from "@/lib/services/daily-brief-schema";
import {
  CHATGPT_PLAN_STREAM_LIMIT_BYTES, ChatGPTPlanError, chatGPTPlanBriefBody, chatGPTPlanErrorCode, chooseChatGPTPlanModel, createSseParser,
  generateChatGPTPlanDailyBrief, parseChatGPTPlanCatalog, selectChatGPTPlanModel,
} from "@/lib/services/daily-brief-chatgpt-plan";

// Ticket 296: the ChatGPT plan adapter. Contract and model order: docs/qa/2026-11-07-chatgpt-plan-spike.md.
const request = { instructions: "Synthetic instructions.", facts: "{\"synthetic\":true}" };
const output = { text: "Today looks manageable.", occurrenceRefs: [], suggestions: [], tip: null };
const signal = () => new AbortController().signal;

function completedEvent(value: unknown = output, extra: Record<string, unknown> = {}) {
  return { type: "response.completed", response: { status: "completed", output: [
    { type: "reasoning", summary: [] },
    { type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(value) }] },
  ], usage: { input_tokens: 2394, input_tokens_details: { cached_tokens: 0 }, output_tokens: 69, output_tokens_details: { reasoning_tokens: 12 } }, ...extra } };
}

function sse(...events: unknown[]): string {
  return events.map((event) => `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
}

/** A streaming 200 like the live plan route: no Content-Type header, delivered in chunks of `size` bytes. */
function streamReply(text: string, size = 1 << 20): Response {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(controller) {
    for (let index = 0; index < bytes.length; index += size) controller.enqueue(bytes.slice(index, index + size));
    controller.close();
  } }), { status: 200 });
}

function fetchOnce(response: Response | (() => Promise<Response>), seen?: { url?: string; init?: RequestInit }): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    if (seen) Object.assign(seen, { url, init });
    return typeof response === "function" ? response() : response;
  }) as unknown as typeof fetch;
}

const call = (fetchImpl: typeof fetch, abort = signal()) =>
  generateChatGPTPlanDailyBrief(request, { accessToken: "token_synthetic", model: "gpt-6.1-sol", signal: abort, fetch: fetchImpl });

async function failure(promise: Promise<unknown>): Promise<ChatGPTPlanError> {
  try { await promise; } catch (error) { if (error instanceof ChatGPTPlanError) return error; throw error; }
  throw new Error("expected a ChatGPTPlanError");
}

describe("model selection", () => {
  const catalog = (...rows: [string, string | null][]) => parseChatGPTPlanCatalog({ models: rows.map(([slug, visibility]) => ({ slug, visibility })) });

  it("takes the first listed model in the owner's order, whatever the catalog order", () => {
    expect(selectChatGPTPlanModel(catalog(["gpt-6-luna", "list"], ["gpt-6.1-terra", "list"], ["gpt-6.1-sol", "list"]))).toBe("gpt-6.1-sol");
    expect(selectChatGPTPlanModel(catalog(["gpt-6-luna", "list"], ["gpt-6.1-terra", "list"]))).toBe("gpt-6.1-terra");
    expect(selectChatGPTPlanModel(catalog(["gpt-5.6-luna", "list"], ["gpt-6-luna", "list"]))).toBe("gpt-6-luna");
  });

  it("never picks a hidden model and returns null when none in the order is listed", () => {
    expect(selectChatGPTPlanModel(catalog(["gpt-6.1-sol", "hide"], ["gpt-6.1-terra", null], ["gpt-5.6-luna", "list"]))).toBeNull();
    expect(selectChatGPTPlanModel(parseChatGPTPlanCatalog(null))).toBeNull();
  });

  it("reads the catalog and maps an empty match to not eligible", async () => {
    const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    const seen: { url?: string; init?: RequestInit } = {};
    await expect(chooseChatGPTPlanModel({ accessToken: "t", signal: signal(), fetch: fetchOnce(reply({ models: [{ slug: "gpt-6.1-terra", visibility: "list" }] }), seen) }))
      .resolves.toBe("gpt-6.1-terra");
    expect(seen.url).toBe("https://api.openai.com/v1/models");
    expect((seen.init?.headers as Record<string, string>).Authorization).toBe("Bearer t");
    expect(await failure(chooseChatGPTPlanModel({ accessToken: "t", signal: signal(), fetch: fetchOnce(reply({ models: [] })) })))
      .toMatchObject({ code: "not_eligible", reason: "catalog_no_supported_model" });
    expect(await failure(chooseChatGPTPlanModel({ accessToken: "t", signal: signal(), fetch: fetchOnce(reply({ error: { code: null } }, 401)) })))
      .toMatchObject({ code: "reconnect" });
  });
});

describe("request contract", () => {
  it("is today's hosted body with stream on, input as a message list and no background", () => {
    const plan = JSON.parse(chatGPTPlanBriefBody(request, "gpt-6.1-sol"));
    const hosted = JSON.parse(dailyBriefRequestBody({ ...request, signal: signal() }, DAILY_BRIEF_SCHEMA_NAME, DAILY_BRIEF_SCHEMA, { model: "gpt-6.1-sol" }));
    expect(plan).toEqual({ ...Object.fromEntries(Object.entries(hosted).filter(([key]) => key !== "background")),
      stream: true, input: [{ role: "user", content: request.facts }] });
    expect(plan.text.format).toMatchObject({ type: "json_schema", strict: true, name: "cadence_daily_brief" });
  });

  it("sends the body to /v1/responses with the access token and the caller's signal", async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    const abort = new AbortController();
    await call(fetchOnce(streamReply(sse(completedEvent())), seen), abort.signal);
    expect(seen.url).toBe("https://api.openai.com/v1/responses");
    expect(seen.init).toMatchObject({ method: "POST", redirect: "error", cache: "no-store", signal: abort.signal });
    expect((seen.init?.headers as Record<string, string>).Authorization).toBe("Bearer token_synthetic");
    expect(seen.init?.body).toBe(chatGPTPlanBriefBody(request, "gpt-6.1-sol"));
  });
});

describe("stream parsing", () => {
  it("returns the parsed output from an untyped stream split at every byte", async () => {
    const text = sse({ type: "response.created", response: { status: "in_progress" } },
      { type: "response.output_text.delta", delta: "{" }, completedEvent()).replaceAll("\n", "\r\n");
    for (const size of [1, 2, 7, 1 << 20]) await expect(call(fetchOnce(() => Promise.resolve(streamReply(text, size))))).resolves.toEqual(output);
  });

  it("reports usage once and keeps the result when the callback throws", async () => {
    const usage: unknown[] = [];
    await generateChatGPTPlanDailyBrief(request, { accessToken: "t", model: "m", signal: signal(), fetch: fetchOnce(streamReply(sse(completedEvent()))),
      onUsage: (value) => usage.push(value) });
    expect(usage).toEqual([{ inputTokens: 2394, cachedInputTokens: 0, outputTokens: 69, reasoningTokens: 12 }]);
    await expect(generateChatGPTPlanDailyBrief(request, { accessToken: "t", model: "m", signal: signal(), fetch: fetchOnce(streamReply(sse(completedEvent()))),
      onUsage: () => { throw new Error("telemetry"); } })).resolves.toEqual(output);
  });

  it("parses SSE data lines and ignores comments and other fields", () => {
    const parser = createSseParser();
    expect(parser.push(": keep-alive\nevent: x\nid: 1\ndata: a\ndata: b\n\ndata: c")).toEqual(["a\nb"]);
    expect(parser.end()).toEqual(["c"]);
  });
});

describe("error mapping", () => {
  const json = (status: number, code: string | null) => new Response(JSON.stringify({ error: { code, message: "Synthetic provider text." } }),
    { status, headers: { "Content-Type": "application/json" } });

  it("maps provider codes before HTTP status", () => {
    expect(chatGPTPlanErrorCode("subscription_sharing_usage_limit_exceeded", 429)).toBe("usage_limit");
    expect(chatGPTPlanErrorCode("subscription_sharing_user_not_eligible", 403)).toBe("not_eligible");
    expect(chatGPTPlanErrorCode("subscription_sharing_invalid_user", 403)).toBe("reconnect");
    expect(chatGPTPlanErrorCode("chatpass_v2_something_new", 403)).toBe("reconnect");
    expect(chatGPTPlanErrorCode("server_is_overloaded", 200)).toBe("retry_later");
    expect(chatGPTPlanErrorCode(null, 401)).toBe("reconnect");
    expect(chatGPTPlanErrorCode(null, 429)).toBe("retry_later");
    expect(chatGPTPlanErrorCode(null, 503)).toBe("retry_later");
    expect(chatGPTPlanErrorCode(null, 400)).toBe("advisor_unavailable");
  });

  it("maps HTTP failures and never keeps provider text", async () => {
    const cases: [Response, string, string][] = [
      [json(429, "subscription_sharing_usage_limit_exceeded"), "usage_limit", "provider_subscription_sharing_usage_limit_exceeded"],
      [json(403, "subscription_sharing_user_not_eligible"), "not_eligible", "provider_subscription_sharing_user_not_eligible"],
      [json(401, null), "reconnect", "provider_http_401"],
      [json(503, null), "retry_later", "provider_http_503"],
      [json(400, null), "advisor_unavailable", "provider_http_400"],
      [json(400, "Bad Code With Spaces"), "advisor_unavailable", "provider_unrecognized"],
    ];
    for (const [response, code, reason] of cases) {
      const error = await failure(call(fetchOnce(response)));
      expect(error).toMatchObject({ code, reason });
      expect(JSON.stringify(error) + error.message).not.toContain("Synthetic provider text");
    }
  });

  it("maps failures reported inside the stream", async () => {
    const failed = (code: string | null) => sse({ type: "response.failed", response: { status: "failed", error: { code, message: "x" } } });
    expect(await failure(call(fetchOnce(streamReply(failed("server_is_overloaded")))))).toMatchObject({ code: "retry_later", reason: "provider_server_is_overloaded" });
    expect(await failure(call(fetchOnce(streamReply(failed("subscription_sharing_usage_limit_exceeded")))))).toMatchObject({ code: "usage_limit" });
    expect(await failure(call(fetchOnce(streamReply(failed(null)))))).toMatchObject({ code: "retry_later", reason: "provider_failed" });
    expect(await failure(call(fetchOnce(streamReply(sse({ type: "error", error: { code: "subscription_sharing_invalid_user" } }))))))
      .toMatchObject({ code: "reconnect" });
    expect(await failure(call(fetchOnce(streamReply(sse({ type: "response.incomplete", response: { incomplete_details: { reason: "max_output_tokens" } } }))))))
      .toMatchObject({ code: "advisor_unavailable", reason: "provider_incomplete_max_output_tokens" });
    expect(await failure(call(fetchOnce(streamReply(sse({ type: "response.created", response: {} }))))))
      .toMatchObject({ code: "retry_later", reason: "stream_interrupted" });
  });

  it("rejects output that breaks the contract", async () => {
    const message = (content: unknown[]) => sse({ type: "response.completed", response: { status: "completed", output: [{ type: "message", role: "assistant", status: "completed", content }] } });
    expect(await failure(call(fetchOnce(streamReply(message([{ type: "refusal", refusal: "no" }])))))).toMatchObject({ code: "advisor_unavailable", reason: "provider_refusal" });
    expect(await failure(call(fetchOnce(streamReply(message([{ type: "output_text", text: "not json" }])))))).toMatchObject({ reason: "output_not_json" });
    expect(await failure(call(fetchOnce(streamReply(message([])))))).toMatchObject({ reason: "provider_shape" });
    expect(await failure(call(fetchOnce(streamReply(sse({ type: "response.completed" })))))).toMatchObject({ reason: "provider_shape" });
  });

  it("caps the stream size", async () => {
    const padding = sse({ type: "response.output_text.delta", delta: "x".repeat(1024) });
    const text = padding.repeat(Math.ceil(CHATGPT_PLAN_STREAM_LIMIT_BYTES / padding.length) + 1) + sse(completedEvent());
    expect(await failure(call(fetchOnce(streamReply(text, 4096))))).toMatchObject({ code: "advisor_unavailable", reason: "provider_body_too_large" });
  });

  it("maps network errors, aborts and a missing token", async () => {
    const offline = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    expect(await failure(call(offline))).toMatchObject({ code: "retry_later", reason: "network_error" });
    const abort = new AbortController();
    abort.abort();
    expect(await failure(call(fetchOnce(streamReply(sse(completedEvent()))), abort.signal))).toMatchObject({ code: "timeout" });
    const midStream = new AbortController();
    const stalled = new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(sse({ type: "response.created", response: {} })));
      midStream.signal.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
    } }), { status: 200 });
    const pending = call(fetchOnce(stalled), midStream.signal);
    midStream.abort();
    expect(await failure(pending)).toMatchObject({ code: "timeout" });
    expect(await failure(generateChatGPTPlanDailyBrief(request, { accessToken: "", model: "m", signal: signal(), fetch: offline })))
      .toMatchObject({ code: "reconnect", reason: "token_missing" });
  });
});

describe("with the prepare and validate steps", () => {
  it("runs a prepared recipe 1.0 request and validates the output into a briefing", async () => {
    const config = activeBriefingConfig();
    const context = briefingFixture("sparse", config);
    const now = () => Temporal.Instant.from(context.capturedAt);
    const prepared = await prepareDailyBrief(context, { config, now, signal: signal() });
    const seen: { init?: RequestInit } = {};
    const result = await generateChatGPTPlanDailyBrief(prepared.request,
      { accessToken: "t", model: "gpt-6.1-sol", signal: signal(), fetch: fetchOnce(streamReply(sse(completedEvent())), seen) });
    expect(JSON.parse(String(seen.init?.body))).toMatchObject({ instructions: prepared.request.instructions, input: [{ role: "user", content: prepared.request.facts }] });
    expect(validateDailyBrief(result, JSON.parse(JSON.stringify(prepared.validation)), { now })).toMatchObject({ text: output.text, localDate: context.localDate });
  });
});

describe("against the plan mock", () => {
  const mocks: MockOpenAI[] = [];
  afterEach(async () => { await Promise.all(mocks.splice(0).map((item) => item.close())); });

  it("sends a body the plan mock accepts and returns its brief", async () => {
    const target = await startMockOpenAI();
    mocks.push(target);
    target.state.liveAccessTokens.add("token_mock");
    const config = activeBriefingConfig();
    const context = briefingFixture("sparse", config);
    const now = () => Temporal.Instant.from(context.capturedAt);
    const prepared = await prepareDailyBrief(context, { config, now, signal: signal() });
    const result = await generateChatGPTPlanDailyBrief(prepared.request,
      { accessToken: "token_mock", model: MOCK_MODELS[0].slug, signal: signal(), apiBase: target.endpoints.apiBase });
    expect(validateDailyBrief(result, prepared.validation, { now }).text).toBe("Synthetic mock brief for a quiet day.");
    expect(target.state.briefRequests).toBe(1);
  });

  it("maps the mock's usage limit and an unknown token", async () => {
    const target = await startMockOpenAI({ usageLimitAfter: 0 });
    mocks.push(target);
    target.state.liveAccessTokens.add("token_mock");
    const options = { accessToken: "token_mock", model: MOCK_MODELS[0].slug, signal: signal(), apiBase: target.endpoints.apiBase };
    const brief = { instructions: "Synthetic.", facts: "{\"synthetic\":true}" };
    expect(await failure(generateChatGPTPlanDailyBrief(brief, options))).toMatchObject({ code: "usage_limit" });
    expect(await failure(generateChatGPTPlanDailyBrief(brief, { ...options, accessToken: "token_unknown" }))).toMatchObject({ code: "reconnect" });
  });
});

describe("browser safety", () => {
  it("imports only types and the shared schema, and uses no Node APIs", () => {
    for (const file of ["lib/services/daily-brief-chatgpt-plan.ts", "lib/services/daily-brief-schema.ts"]) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      expect(source).not.toMatch(/\bBuffer\b|from "node:|process\.env|console\./u);
      const imports = [...source.matchAll(/^import (type )?.* from "(.+)";$/gmu)].map((match) => `${match[1] ?? ""}${match[2]}`);
      expect(imports.every((item) => item.startsWith("type ") || item === "./daily-brief-schema")).toBe(true);
    }
  });
});
