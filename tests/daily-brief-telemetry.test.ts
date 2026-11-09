import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import { validateAdvisorDayContext } from "@cadence/core/services/advisor-day-context";
import { BRIEFING_PRESETS, DEFAULT_BRIEFING_CONFIG } from "@cadence/core/services/briefing-config";
import fixture from "./fixtures/advisor-day-context.valid.json";
import { adviceRejected, DailyBriefError, generateDailyBrief, type DailyBriefCallUsage, type DailyBriefGenerator } from "@/lib/services/daily-brief-consumer";
import { DAILY_BRIEF_MODEL, generateOpenAIDailyBrief, generateOpenAIDurationEstimates, parseOpenAIUsage } from "@/lib/services/daily-brief-openai";
import { measurePerformanceSpan } from "@/lib/services/performance-timing";
import { createBriefingBenchStore, type BenchRun, type BriefingBenchStore } from "@/lib/services/briefing-bench-store";
import { briefingFixture } from "@/lib/services/briefing-fixtures";

// Ticket 288: token usage and internal failure reasons. Authored responses only; no provider is called.
const context = validateAdvisorDayContext(fixture);
const now = () => Temporal.Instant.from(context.capturedAt);
const advice = { suggestions: [], text: "Make room for your planned walk.", occurrenceRefs: [context.cadence.occurrences[0].ref] };
const providerUsage = { input_tokens: 1200, input_tokens_details: { cached_tokens: 300 }, output_tokens: 150, output_tokens_details: { reasoning_tokens: 64 }, total_tokens: 1350 };
const message = (text: string) => ({ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text }] });
const completed = (text = JSON.stringify(advice), extra: Record<string, unknown> = {}) => ({ status: "completed", output: [message(text)], usage: providerUsage, ...extra });
const adapterInput = { instructions: "Instructions", facts: "Synthetic facts", signal: new AbortController().signal };

describe("OpenAI usage parsing", () => {
  it("reads input, cached input, output and reasoning tokens", () => {
    expect(parseOpenAIUsage(providerUsage)).toEqual({ inputTokens: 1200, cachedInputTokens: 300, outputTokens: 150, reasoningTokens: 64 });
  });
  it("turns missing or malformed counts into null and a missing object into null", () => {
    expect(parseOpenAIUsage({ input_tokens: 10, output_tokens: -1, output_tokens_details: { reasoning_tokens: 1.5 } }))
      .toEqual({ inputTokens: 10, cachedInputTokens: null, outputTokens: null, reasoningTokens: null });
    expect(parseOpenAIUsage({ input_tokens: "10", input_tokens_details: [] })).toEqual({ inputTokens: null, cachedInputTokens: null, outputTokens: null, reasoningTokens: null });
    expect(parseOpenAIUsage(undefined)).toBeNull();
    expect(parseOpenAIUsage([1, 2])).toBeNull();
  });
});

describe("OpenAI adapter usage and reasons", () => {
  it("reports usage for the brief call and the estimate call", async () => {
    const onUsage = vi.fn();
    expect(await generateOpenAIDailyBrief({ ...adapterInput, onUsage }, { apiKey: "key", fetch: async () => Response.json(completed()) })).toEqual(advice);
    const estimates = { estimates: [] };
    expect(await generateOpenAIDurationEstimates({ ...adapterInput, onUsage }, { apiKey: "key", fetch: async () => Response.json(completed(JSON.stringify(estimates))) })).toEqual(estimates);
    expect(onUsage).toHaveBeenCalledTimes(2);
    expect(onUsage).toHaveBeenNthCalledWith(1, { inputTokens: 1200, cachedInputTokens: 300, outputTokens: 150, reasoningTokens: 64 });
  });

  it("reports nothing when the provider omits usage, and a throwing callback never changes the result", async () => {
    const onUsage = vi.fn();
    const withoutUsage: Record<string, unknown> = completed();
    delete withoutUsage.usage;
    await generateOpenAIDailyBrief({ ...adapterInput, onUsage }, { apiKey: "key", fetch: async () => Response.json(withoutUsage) });
    expect(onUsage).not.toHaveBeenCalled();
    const throwing = () => { throw new Error("collector failed"); };
    expect(await generateOpenAIDailyBrief({ ...adapterInput, onUsage: throwing }, { apiKey: "key", fetch: async () => Response.json(completed()) })).toEqual(advice);
  });

  it("sends a byte-identical request body with or without a usage callback", async () => {
    const bodies: string[] = [];
    const fetcher = async (_url: RequestInfo | URL, init?: RequestInit) => { bodies.push(init!.body as string); return Response.json(completed(JSON.stringify({ estimates: [] }))); };
    await generateOpenAIDailyBrief(adapterInput, { apiKey: "key", fetch: fetcher });
    await generateOpenAIDailyBrief({ ...adapterInput, onUsage: () => undefined }, { apiKey: "key", fetch: fetcher });
    await generateOpenAIDurationEstimates({ ...adapterInput, estimateVariant: "alongside" }, { apiKey: "key", fetch: fetcher });
    await generateOpenAIDurationEstimates({ ...adapterInput, estimateVariant: "alongside", onUsage: () => undefined }, { apiKey: "key", fetch: fetcher });
    expect(bodies[1]).toBe(bodies[0]);
    expect(bodies[3]).toBe(bodies[2]);
    // The body built before Ticket 288, field for field and in the same key order.
    const parsed = JSON.parse(bodies[0]);
    expect(bodies[0]).toBe(JSON.stringify({
      model: DAILY_BRIEF_MODEL, store: false, background: false, tools: [], tool_choice: "none",
      reasoning: { effort: "low" }, max_output_tokens: 2_000,
      instructions: adapterInput.instructions, input: adapterInput.facts,
      text: { format: { type: "json_schema", name: "cadence_daily_brief", strict: true, schema: parsed.text.format.schema } },
    }));
    expect(bodies[0]).not.toContain("onUsage");
    expect(JSON.parse(bodies[2]).text.format.name).toBe("cadence_duration_estimates_v1_2");
  });

  it.each([
    ["HTTP 500", () => new Response("provider secret", { status: 500 }), "advisor_unavailable", "provider_http_5xx"],
    ["HTTP 404", () => new Response("provider secret", { status: 404 }), "advisor_unavailable", "provider_http_4xx"],
    ["HTTP 429", () => new Response("provider secret", { status: 429 }), "rate_limited", "provider_http_429"],
    ["a missing body", () => new Response(null, { status: 200 }), "advisor_unavailable", "provider_body_missing"],
    ["an oversized body", () => new Response("a".repeat(65_537)), "advisor_unavailable", "provider_body_too_large"],
    ["a non-JSON body", () => new Response("not json"), "advisor_unavailable", "provider_body_not_json"],
    ["a missing output array", () => Response.json({ status: "completed" }), "advisor_unavailable", "provider_shape"],
    ["a token-limit stop", () => Response.json({ ...completed(), status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }), "advisor_unavailable", "provider_incomplete_max_output_tokens"],
    ["an unsafe incomplete reason", () => Response.json({ ...completed(), status: "incomplete", incomplete_details: { reason: "Some Long Provider Text!" } }), "advisor_unavailable", "provider_incomplete"],
    ["a failed status", () => Response.json({ ...completed(), status: "failed" }), "advisor_unavailable", "provider_status_failed"],
    ["a tool call", () => Response.json({ ...completed(), output: [{ type: "function_call" }] }), "advisor_unavailable", "provider_shape"],
    ["a refusal", () => Response.json({ ...completed(), output: [{ ...message(""), content: [{ type: "refusal", refusal: "No" }] }] }), "advisor_unavailable", "provider_refusal"],
    ["two text parts", () => Response.json({ ...completed(), output: [message("{}"), message("{}")] }), "advisor_unavailable", "provider_shape"],
    ["non-JSON output text", () => Response.json(completed("plain words")), "advisor_unavailable", "output_not_json"],
  ])("names the reason for %s and keeps the public code", async (_label, respond, code, reason) => {
    const error = await generateOpenAIDailyBrief(adapterInput, { apiKey: "key", fetch: async () => respond() }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DailyBriefError);
    expect(error).toMatchObject({ code, reason, message: code });
  });

  it("still reports usage from an incomplete response it rejects", async () => {
    const onUsage = vi.fn();
    await expect(generateOpenAIDailyBrief({ ...adapterInput, onUsage }, { apiKey: "key",
      fetch: async () => Response.json({ ...completed(), status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }) }))
      .rejects.toMatchObject({ code: "advisor_unavailable", reason: "provider_incomplete_max_output_tokens" });
    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({ outputTokens: 150 }));
  });
});

describe("consumer validation reasons", () => {
  const run = (output: unknown, config: unknown = DEFAULT_BRIEFING_CONFIG) =>
    generateDailyBrief(context, { config, generate: async () => output, now, signal: new AbortController().signal });
  const priority = { ...DEFAULT_BRIEFING_CONFIG, allowedSuggestionTypes: ["priority"], referenceIds: ["nice-ph49-planning"] };
  const suggestion = { text: "Review the walk you planned.", occurrenceRefs: advice.occurrenceRefs, referenceIds: ["nice-ph49-planning"], optionId: null };

  it.each([
    ["a non-object", "text", DEFAULT_BRIEFING_CONFIG, "validation_shape"],
    ["an extra field", { ...advice, command: "mutate" }, DEFAULT_BRIEFING_CONFIG, "validation_shape"],
    ["an invented occurrence", { ...advice, occurrenceRefs: ["invented-reference"] }, DEFAULT_BRIEFING_CONFIG, "validation_unknown_ref"],
    ["non-array suggestions", { ...advice, suggestions: {} }, DEFAULT_BRIEFING_CONFIG, "validation_suggestion"],
    ["an invented citation", { ...advice, suggestions: [{ ...suggestion, referenceIds: ["invented"] }] }, priority, "validation_unknown_ref"],
    ["an invented planner option", { ...advice, suggestions: [{ ...suggestion, optionId: "option_999" }] }, priority, "validation_option"],
    ["an unoffered tip", { ...advice, tip: { findingId: "tip", text: "Try earlier.", noteRefs: [] } }, DEFAULT_BRIEFING_CONFIG, "validation_tip"],
    ["too many words", { ...advice, text: "word ".repeat(121) }, DEFAULT_BRIEFING_CONFIG, "validation_word_limit"],
    ["a URL", { ...advice, text: "See www.example.com before your walk." }, DEFAULT_BRIEFING_CONFIG, "validation_url"],
  ])("rejects %s with its own reason and the public code advisor_unavailable", async (_label, output, config, reason) => {
    const error = await run(output, config).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "advisor_unavailable", reason, message: "advisor_unavailable" });
  });

  it("passes a usage callback only when the caller asks, and labels the call", async () => {
    const usage: DailyBriefCallUsage[] = [];
    const generate = vi.fn<DailyBriefGenerator>(async (input) => {
      input.onUsage?.({ inputTokens: 10, cachedInputTokens: 0, outputTokens: 5, reasoningTokens: 2 });
      return advice;
    });
    await generateDailyBrief(context, { generate, now, signal: new AbortController().signal, onUsage: (item) => usage.push(item) });
    expect(Object.keys(generate.mock.calls[0]![0]).sort()).toEqual(["facts", "instructions", "onUsage", "signal"]);
    expect(usage).toEqual([{ call: "brief", inputTokens: 10, cachedInputTokens: 0, outputTokens: 5, reasoningTokens: 2 }]);
  });

  it("records estimate-call usage and the estimate failure reason without failing the brief step", async () => {
    const config = structuredClone(BRIEFING_PRESETS.find((item) => item.id === "advisor-analysis-2")!.config);
    const estimating = briefingFixture("missing_duration", config);
    const usage: DailyBriefCallUsage[] = [];
    let report: unknown = null;
    const estimate: DailyBriefGenerator = async (input) => {
      input.onUsage?.({ inputTokens: 40, cachedInputTokens: null, outputTokens: 2_000, reasoningTokens: 1_900 });
      throw adviceRejected("provider_incomplete_max_output_tokens");
    };
    await generateDailyBrief(estimating, { config, generate: async () => ({ text: "", occurrenceRefs: [], suggestions: [], tip: null }),
      now: () => Temporal.Instant.from(estimating.capturedAt), signal: new AbortController().signal,
      descriptions: Object.fromEntries(estimating.cadence.occurrences.map((item) => [item.behaviorRef, "About a 25 minute walk."])), estimate,
      onUsage: (item) => usage.push(item), onPrepared: (value) => { report = value.estimates; } }).catch(() => null);
    expect(report).toMatchObject({ state: "failed", reason: "provider_incomplete_max_output_tokens" });
    expect(usage[0]).toEqual({ call: "duration_estimate", inputTokens: 40, cachedInputTokens: null, outputTokens: 2_000, reasoningTokens: 1_900 });
  });
});

describe("performance log usage counts and reasons", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it("logs the exact usage count keys and still drops every other token key", async () => {
    vi.stubEnv("CADENCE_PERF_LOG", "1");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await measurePerformanceSpan({ span: "daily_brief.model", counts: { usage_calls: 1, input_tokens: 1200, cached_input_tokens: 300, output_tokens: 150,
      reasoning_tokens: 64, access_token: 7, tokens: 9, refresh_token_count: 1, input_tokens_secret: 3, total_tokens: 5 } }, async () => 1);
    const event = JSON.parse(info.mock.calls[0]![0] as string);
    expect(event.counts).toEqual({ usage_calls: 1, input_tokens: 1200, cached_input_tokens: 300, output_tokens: 150, reasoning_tokens: 64 });
  });

  it("logs the failure reason beside the error code, with counts from errorCounts", async () => {
    vi.stubEnv("CADENCE_PERF_LOG", "1");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await expect(measurePerformanceSpan({ span: "daily_brief.model", errorCounts: () => ({ output_tokens: 2_000, note_count: 4 }) },
      async () => { throw adviceRejected("validation_word_limit"); })).rejects.toThrow();
    const event = JSON.parse(info.mock.calls[0]![0] as string);
    expect(event).toMatchObject({ status: "error", error_code: "advisor_unavailable", error_reason: "validation_word_limit", counts: { output_tokens: 2_000 } });
    expect(event.counts).not.toHaveProperty("note_count");
  });

  it("drops a reason that is not a short machine code", async () => {
    vi.stubEnv("CADENCE_PERF_LOG", "1");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await expect(measurePerformanceSpan({ span: "daily_brief.model" }, async () => { throw new DailyBriefError("advisor_unavailable", undefined, "Provider said: secret text"); })).rejects.toThrow();
    const event = JSON.parse(info.mock.calls[0]![0] as string);
    expect(event).not.toHaveProperty("error_reason");
    expect(event).not.toHaveProperty("counts");
  });
});

describe("workbench usage and reasons", () => {
  const origin = "http://127.0.0.1:4321";
  const CASE = "case-0000-telemetry";
  const candidate = (id: string, role: "baseline" | "candidate") => ({ id, label: role, role, parentCandidateId: null, proposalId: null, rationale: "" });
  const post = (url: string, body: unknown) => new Request(`${origin}${url}`, { method: "POST", body: JSON.stringify(body),
    headers: { origin, "sec-fetch-site": "same-origin", "content-type": "application/json" } });
  let root: string;
  let store: BriefingBenchStore;
  beforeEach(async () => {
    vi.resetModules(); Reflect.deleteProperty(globalThis, Symbol.for("cadence.briefingBenchBudget"));
    vi.stubEnv("NODE_ENV", "development");
    root = await mkdtemp(path.join(tmpdir(), "briefing-telemetry-"));
    store = createBriefingBenchStore(root);
  });
  afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });

  it("returns and saves usage per result and the reason for a rejected run, and reads older runs", async () => {
    const { runBriefingComparison } = await import("@/lib/services/briefing-workbench.service");
    const { writeBriefingReview, readBriefingReviews } = await import("@/lib/services/briefing-review.service");
    const generate = vi.fn<DailyBriefGenerator>()
      .mockImplementationOnce(async (input) => { input.onUsage?.({ inputTokens: 100, cachedInputTokens: 20, outputTokens: 30, reasoningTokens: 10 }); return { text: "Your walk is at noon.", occurrenceRefs: [], suggestions: [] }; })
      .mockImplementationOnce(async (input) => { input.onUsage?.({ inputTokens: 110, cachedInputTokens: null, outputTokens: 40, reasoningTokens: 12 }); return { text: "See www.example.com", occurrenceRefs: [], suggestions: [] }; });
    const response = await runBriefingComparison(post("/api/dev/briefing-comparison", { fixtureId: "sparse", configs: [DEFAULT_BRIEFING_CONFIG, { ...DEFAULT_BRIEFING_CONFIG, tone: "warm" }],
      review: { caseId: CASE, candidates: [candidate("cand-baseline-0001", "baseline"), candidate("cand-candidate-0001", "candidate")] } }), generate, store);
    expect(response.status).toBe(200);
    const body = await response.json();
    // The UI reads `usage` as a string; counts are per result.
    expect(body.usage).toBe("per_result");
    expect(body.results[0]).toMatchObject({ state: "ready", usage: [{ call: "brief", inputTokens: 100, cachedInputTokens: 20, outputTokens: 30, reasoningTokens: 10 }] });
    expect(body.results[0]).not.toHaveProperty("reason");
    expect(body.results[1]).toMatchObject({ state: "error", error: "advisor_unavailable", reason: "validation_url", usage: [{ call: "brief", inputTokens: 110 }] });

    const runs = (await store.readCase("synthetic", CASE)).runs;
    expect(runs[0]).toMatchObject({ usage: [{ call: "brief", inputTokens: 100 }] });
    expect(runs[1]).toMatchObject({ reason: "validation_url", usage: [{ call: "brief", outputTokens: 40 }] });

    // A run saved before Ticket 288 has neither field and still loads.
    const { usage: _usage, reason: _reason, ...rest } = runs[0] as BenchRun;
    const older = { ...rest, id: "00000000-0000-4000-8000-000000000288" };
    expect([_usage, _reason]).toEqual([expect.any(Array), undefined]);
    await appendFile(path.join(store.caseDir("synthetic", CASE), "runs.jsonl"), `${JSON.stringify(older)}\n`);
    const read = await readBriefingReviews(new Request(`${origin}/api/dev/briefing-reviews?source=synthetic&caseId=${CASE}`, { headers: { "sec-fetch-site": "same-origin" } }), store);
    expect(read.status).toBe(200);
    const detail = (await read.json()).detail;
    expect(detail.runs).toHaveLength(3);
    expect(detail.runs[2]).not.toHaveProperty("usage");

    expect((await writeBriefingReview(post("/api/dev/briefing-reviews", { source: "synthetic", action: "packet", caseId: CASE }), store)).status).toBe(200);
    const packet = await readFile(path.join(store.caseDir("synthetic", CASE), "review-packet.md"), "utf8");
    expect(packet).toContain("Usage: 1 model call; input tokens 100 (cached 20); output tokens 30 (reasoning 10).");
    expect(packet).toContain("(advisor_unavailable, reason validation_url)");
    expect(packet).toContain("Usage: not recorded (run saved before usage recording).");

    expect((await writeBriefingReview(post("/api/dev/briefing-reviews", { source: "synthetic", action: "sequence_report", caseId: CASE, caseIds: [CASE] }), store)).status).toBe(200);
    const report = await readFile(path.join(store.caseDir("synthetic", CASE), "sequence-report.md"), "utf8");
    expect(report).toContain("Token usage across all attempts: 2 model calls; input tokens 210 (cached 20); output tokens 70 (reasoning 22); runs saved without usage records: 1. Monetary cost: not calculated.");
    expect(report).toContain('Failure reasons (internal codes): {"validation_url":1}.');
    expect(report).toContain("State: error; validation: withheld; error: advisor_unavailable; reason: validation_url.");
    expect(report).not.toContain("Tokens and monetary cost: unavailable");
  });
});
