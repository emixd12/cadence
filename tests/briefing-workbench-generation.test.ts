import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import { validateAdvisorDayContext } from "@cadence/core/services/advisor-day-context";
import { BRIEFING_PRESETS, DEFAULT_BRIEFING_CONFIG } from "@cadence/core/services/briefing-config";
import type { BriefingConfig } from "@cadence/core/types/briefing-config";
import fixture from "./fixtures/advisor-day-context.valid.json";
import { createBriefingBenchStore, type BenchCandidate, type BenchRun, type BriefingBenchStore } from "@/lib/services/briefing-bench-store";
import { generateDailyBrief, type DailyBriefGenerator } from "@/lib/services/daily-brief-consumer";
import { composeDailyBriefInstructions, dailyBriefPromptRevision, DAILY_BRIEF_PROMPT_REVISION } from "@/lib/services/daily-brief-instructions";
import {
  DAILY_BRIEF_MODEL, DAILY_BRIEF_REASONING_EFFORT, dailyBriefRequestBody, generateOpenAIDailyBrief, generateOpenAIDurationEstimates, OPENAI_REASONING_EFFORTS,
} from "@/lib/services/daily-brief-openai";

// Ticket 290: workbench-only model, reasoning effort and prompt variant. Model IDs here are fake.
// No provider is called: generators are injected or `fetch` is stubbed.
const origin = "http://127.0.0.1:4321";
const CASE = "case-0000-generation";
const advice = { text: "Your walk is at noon.", occurrenceRefs: [], suggestions: [] };
const completed = (text = JSON.stringify(advice)) => ({ status: "completed", output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text }] }] });
const candidate = (id: string, role: "baseline" | "candidate") => ({ id, label: role, role, parentCandidateId: null, proposalId: null, rationale: "" });
const review = (caseId = CASE, ids = ["cand-baseline-0290", "cand-candidate-0290"]) => ({ caseId, candidates: ids.map((id, index) => candidate(id, index ? "candidate" : "baseline")) });
const post = (url: string, body: unknown) => new Request(`${origin}${url}`, { method: "POST", body: JSON.stringify(body),
  headers: { origin, "sec-fetch-site": "same-origin", "content-type": "application/json" } });
const preset = (version: "1.1" | "1.2") => structuredClone(BRIEFING_PRESETS.find((item) => item.config.recipe.version === version)!.config) as BriefingConfig;
const lanesOff = (config: BriefingConfig): BriefingConfig => ({ ...config, analysis: { ...config.analysis, lanes: [], maxTips: 0 },
  context: { ...config.context, duration: { ...config.context.duration, includeDescriptionEstimate: false } } });

let root: string;
let store: BriefingBenchStore;
beforeEach(async () => {
  vi.resetModules(); Reflect.deleteProperty(globalThis, Symbol.for("cadence.briefingBenchBudget"));
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("CADENCE_BRIEFING_BENCH_MODELS", " bench-model-a,not a model!,bench-model-b ,bench-model-a");
  root = await mkdtemp(path.join(tmpdir(), "briefing-generation-"));
  store = createBriefingBenchStore(root);
});
afterEach(async () => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });

const service = () => import("@/lib/services/briefing-workbench.service");
const compare = async (body: Record<string, unknown>, generate?: DailyBriefGenerator) => {
  const { runBriefingComparison } = await service();
  return runBriefingComparison(post("/api/dev/briefing-comparison", body), generate, store);
};

describe("OpenAI adapter overrides", () => {
  const input = { instructions: "Instructions", facts: "Synthetic facts", signal: new AbortController().signal };
  const capture = () => {
    const bodies: string[] = [];
    const fetcher = async (_url: RequestInfo | URL, init?: RequestInit) => { bodies.push(init!.body as string); return Response.json(completed(JSON.stringify({ estimates: [] }))); };
    return { bodies, fetcher };
  };

  it("lists the documented reasoning efforts and keeps the production effort", () => {
    expect(OPENAI_REASONING_EFFORTS).toEqual(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);
    expect(DAILY_BRIEF_REASONING_EFFORT).toBe("low");
  });

  it("sends the production body without overrides and changes only model and effort with them", async () => {
    const { bodies, fetcher } = capture();
    await generateOpenAIDailyBrief(input, { apiKey: "key", fetch: fetcher });
    await generateOpenAIDailyBrief(input, { apiKey: "key", fetch: fetcher, model: "bench-model-a", effort: "high" });
    await generateOpenAIDailyBrief(input, { apiKey: "key", fetch: fetcher, effort: "medium" });
    expect(bodies[0]).toBe(dailyBriefRequestBody(input, "cadence_daily_brief", JSON.parse(bodies[0]!).text.format.schema));
    const [base, both, effortOnly] = bodies.map((body) => JSON.parse(body));
    expect([base.model, base.reasoning]).toEqual([DAILY_BRIEF_MODEL, { effort: "low" }]);
    expect(both).toEqual({ ...base, model: "bench-model-a", reasoning: { effort: "high" } });
    expect(Object.keys(both)).toEqual(Object.keys(base));
    expect(effortOnly).toEqual({ ...base, reasoning: { effort: "medium" } });
  });

  it("keeps the production model and effort for the duration-estimate call", async () => {
    const { bodies, fetcher } = capture();
    await generateOpenAIDurationEstimates(input, { apiKey: "key", fetch: fetcher });
    expect(JSON.parse(bodies[0]!)).toMatchObject({ model: DAILY_BRIEF_MODEL, reasoning: { effort: "low" } });
  });
});

describe("consumer prompt variants", () => {
  const context = validateAdvisorDayContext(fixture);
  const now = () => Temporal.Instant.from(context.capturedAt);
  const instructionsFor = async (config: BriefingConfig, promptVariant?: string) => {
    let sent = "";
    let route: string | null = null;
    await generateDailyBrief(context, { config, now, signal: new AbortController().signal, ...(promptVariant ? { promptVariant: promptVariant as "layered" } : {}),
      onPrepared: ({ prepared }) => { route = prepared.plan.route; },
      generate: async (value) => { sent = value.instructions; return advice; } }).catch(() => undefined);
    return { sent, route: route! };
  };

  it("sends the layered text by default and for \"layered\", and the consolidated text for \"consolidated\"", async () => {
    const config = lanesOff(preset("1.1"));
    const omitted = await instructionsFor(config);
    const layered = await instructionsFor(config, "layered");
    const consolidated = await instructionsFor(config, "consolidated");
    const flags = { config, route: omitted.route as "recap", analysis: false, connectorSources: false, travel: false };
    expect(layered.sent).toBe(omitted.sent);
    expect(omitted.sent).toBe(composeDailyBriefInstructions("layered", flags));
    expect(consolidated.sent).toBe(composeDailyBriefInstructions("consolidated", flags));
    expect(consolidated.sent).not.toBe(omitted.sent);
  });

  it("rejects an unknown variant before any model call", async () => {
    const generate = vi.fn<DailyBriefGenerator>();
    await expect(generateDailyBrief(context, { now, signal: new AbortController().signal, generate, promptVariant: "freeform" as "layered" }))
      .rejects.toMatchObject({ code: "invalid_request" });
    expect(generate).not.toHaveBeenCalled();
  });
});

describe("workbench generation options", () => {
  it("allows DAILY_BRIEF_MODEL plus valid environment IDs, and serves them only in development", async () => {
    const { briefingGenerationOptions, readBriefingGenerationOptions } = await service();
    const options = briefingGenerationOptions();
    expect(options.models).toEqual([DAILY_BRIEF_MODEL, "bench-model-a", "bench-model-b"]);
    expect(options.efforts).toEqual(OPENAI_REASONING_EFFORTS);
    expect(options.promptVariants).toEqual(["layered", "consolidated"]);
    expect(options.defaults).toEqual({ model: DAILY_BRIEF_MODEL, effort: "low", promptVariant: "layered" });
    expect(briefingGenerationOptions({}).models).toEqual([DAILY_BRIEF_MODEL]);
    expect(briefingGenerationOptions({ CADENCE_BRIEFING_BENCH_MODELS: `${"a".repeat(65)},ok:model-1.2_x` }).models).toEqual([DAILY_BRIEF_MODEL, "ok:model-1.2_x"]);
    const get = () => new Request(`${origin}/api/dev/briefing-comparison?view=generation`, { headers: { "sec-fetch-site": "same-origin" } });
    const response = readBriefingGenerationOptions(get());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(JSON.parse(JSON.stringify(options)));
    vi.stubEnv("NODE_ENV", "production");
    expect(readBriefingGenerationOptions(get()).status).toBe(404);
  });

  it.each([
    ["an unknown key", [{ temperature: 1 }, {}]],
    ["an unlisted model", [{}, { model: "bench-model-z" }]],
    ["an unlisted effort", [{}, { effort: "extreme" }]],
    ["an unknown variant", [{}, { promptVariant: "freeform" }]],
    ["a non-string value", [{}, { model: null }]],
    ["a non-object item", [{}, "bench-model-a"]],
    ["a length that does not match configs", [{}]],
    ["a non-array", { model: "bench-model-a" }],
  ])("rejects %s with invalid_request before any model call", async (_label, generation) => {
    const generate = vi.fn<DailyBriefGenerator>();
    const response = await compare({ fixtureId: "sparse", configs: [DEFAULT_BRIEFING_CONFIG, DEFAULT_BRIEFING_CONFIG], generation }, generate);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("keeps a request without generation as today and records the production values", async () => {
    const generate = vi.fn<DailyBriefGenerator>().mockResolvedValue(advice);
    const response = await compare({ fixtureId: "sparse", configs: [DEFAULT_BRIEFING_CONFIG, DEFAULT_BRIEFING_CONFIG], review: review() }, generate);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(generate.mock.calls.every(([input]) => Object.keys(input).sort().join() === "facts,instructions,onUsage,signal")).toBe(true);
    expect(generate.mock.calls[0]![0].instructions).toBe(generate.mock.calls[1]![0].instructions);
    const production = { model: DAILY_BRIEF_MODEL, effort: "low", promptVariant: "layered", promptRevision: DAILY_BRIEF_PROMPT_REVISION };
    expect(body).toMatchObject({ model: DAILY_BRIEF_MODEL, promptRevision: DAILY_BRIEF_PROMPT_REVISION });
    for (const result of body.results) expect(result).toMatchObject(production);
    const detail = await store.readCase("synthetic", CASE);
    for (const run of detail.runs) expect(run).toMatchObject(production);
    for (const item of detail.candidates) expect(item.generation).toEqual({ model: DAILY_BRIEF_MODEL, effort: "low", promptVariant: "layered" });
  });

  it("sends each candidate's model, effort and prompt to the provider and records what each run used", async () => {
    vi.stubEnv("OPENAI_API_KEY", "synthetic-key");
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.openai.com/v1/responses");
      bodies.push(JSON.parse(init!.body as string));
      return Response.json(completed());
    }));
    const config = lanesOff(preset("1.1"));
    const response = await compare({ fixtureId: "sparse", configs: [config, config], review: review(),
      generation: [{}, { model: "bench-model-a", effort: "high", promptVariant: "consolidated" }] });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toMatchObject({ model: DAILY_BRIEF_MODEL, reasoning: { effort: "low" } });
    expect(bodies[1]).toMatchObject({ model: "bench-model-a", reasoning: { effort: "high" } });
    expect(bodies[1]!.instructions).not.toBe(bodies[0]!.instructions);
    expect(bodies[1]!.instructions).toContain("Route:");
    expect(bodies[1]!.instructions).not.toContain("Recipe 1.1 rules");
    const consolidated = { model: "bench-model-a", effort: "high", promptVariant: "consolidated", promptRevision: dailyBriefPromptRevision("consolidated") };
    expect(body.results[0]).toMatchObject({ model: DAILY_BRIEF_MODEL, effort: "low", promptVariant: "layered", promptRevision: DAILY_BRIEF_PROMPT_REVISION });
    expect(body.results[1]).toMatchObject(consolidated);
    const detail = await store.readCase("synthetic", CASE);
    expect(detail.runs[1]).toMatchObject(consolidated);
    expect(detail.candidates[1]!.generation).toEqual({ model: "bench-model-a", effort: "high", promptVariant: "consolidated" });
  });

  it("records the layered text for a recipe the consolidated variant does not rewrite", async () => {
    const generate = vi.fn<DailyBriefGenerator>().mockResolvedValue(advice);
    const response = await compare({ fixtureId: "sparse", configs: [DEFAULT_BRIEFING_CONFIG, DEFAULT_BRIEFING_CONFIG], review: review(),
      generation: [{}, { promptVariant: "consolidated" }] }, generate);
    const body = await response.json();
    expect(generate.mock.calls[1]![0].instructions).toBe(generate.mock.calls[0]![0].instructions);
    expect(body.results[1]).toMatchObject({ promptVariant: "layered", promptRevision: DAILY_BRIEF_PROMPT_REVISION });
    // The candidate keeps the requested choice; the run records the text actually sent.
    expect((await store.readCase("synthetic", CASE)).candidates[1]!.generation).toMatchObject({ promptVariant: "consolidated" });
  });

  it("treats generation as candidate identity", async () => {
    const generate = vi.fn<DailyBriefGenerator>().mockResolvedValue(advice);
    const ids = ["cand-baseline-0290", "cand-candidate-0290"];
    await compare({ fixtureId: "sparse", configs: [DEFAULT_BRIEFING_CONFIG, DEFAULT_BRIEFING_CONFIG], review: review(CASE, ids), generation: [{}, { effort: "medium" }] }, generate);
    const rerun = (generation?: unknown[]) => compare({ mode: "saved", accountRef: null, configs: [DEFAULT_BRIEFING_CONFIG],
      review: { caseId: CASE, candidates: [candidate(ids[1]!, "candidate")] }, ...(generation ? { generation } : {}) }, generate);
    expect((await rerun([{ effort: "medium" }])).status).toBe(200);
    expect(await (await rerun([{ effort: "high" }])).json()).toEqual({ error: "invalid_request" });
    expect(await (await rerun()).json()).toEqual({ error: "invalid_request" });
    // A new candidate ID carries the new choice.
    const fresh = await compare({ mode: "saved", accountRef: null, configs: [DEFAULT_BRIEFING_CONFIG], generation: [{ effort: "high" }],
      review: { caseId: CASE, candidates: [candidate("cand-candidate-0291", "candidate")] } }, generate);
    expect(fresh.status).toBe(200);
    expect((await store.readCase("synthetic", CASE)).candidates.map((item) => item.generation?.effort)).toEqual(["low", "medium", "high"]);
  });

  it("loads and reruns a case saved before Ticket 290, then prints generation in the packet and report", async () => {
    const generate = vi.fn<DailyBriefGenerator>().mockResolvedValue(advice);
    const ids = ["cand-baseline-0290", "cand-candidate-0290"];
    await compare({ fixtureId: "sparse", configs: [DEFAULT_BRIEFING_CONFIG, DEFAULT_BRIEFING_CONFIG], review: review(CASE, ids) }, generate);
    // Strip every Ticket 290 field, as an older workbench saved them.
    const dir = store.caseDir("synthetic", CASE);
    const strip = async (file: string, fields: string[]) => {
      const lines = (await readFile(path.join(dir, file), "utf8")).trim().split("\n").map((line) => {
        const record = JSON.parse(line);
        for (const field of fields) delete record[field];
        return JSON.stringify(record);
      });
      await writeFile(path.join(dir, file), `${lines.join("\n")}\n`);
    };
    await strip("candidates.jsonl", ["generation"]);
    await strip("runs.jsonl", ["effort", "promptVariant"]);
    const before = await store.readCase("synthetic", CASE);
    expect(before.candidates.every((item: BenchCandidate) => item.generation === undefined)).toBe(true);
    expect(before.runs.every((item: BenchRun) => item.effort === undefined)).toBe(true);
    // An old candidate matches the production values, with or without an explicit generation.
    for (const generation of [undefined, [{}], [{ model: DAILY_BRIEF_MODEL, effort: "low", promptVariant: "layered" }]]) {
      const response = await compare({ mode: "saved", accountRef: null, configs: [DEFAULT_BRIEFING_CONFIG], ...(generation ? { generation } : {}),
        review: { caseId: CASE, candidates: [candidate(ids[1]!, "candidate")] } }, generate);
      expect(response.status).toBe(200);
    }
    // A different choice on the old candidate ID is a different candidate.
    expect((await compare({ mode: "saved", accountRef: null, configs: [DEFAULT_BRIEFING_CONFIG], generation: [{ model: "bench-model-b" }],
      review: { caseId: CASE, candidates: [candidate(ids[1]!, "candidate")] } }, generate)).status).toBe(400);
    await compare({ mode: "saved", accountRef: null, configs: [DEFAULT_BRIEFING_CONFIG], generation: [{ model: "bench-model-b", promptVariant: "consolidated" }],
      review: { caseId: CASE, candidates: [candidate("cand-candidate-0292", "candidate")] } }, generate);

    const { writeBriefingReview } = await import("@/lib/services/briefing-review.service");
    expect((await writeBriefingReview(post("/api/dev/briefing-reviews", { source: "synthetic", action: "packet", caseId: CASE }), store)).status).toBe(200);
    const packet = await readFile(path.join(dir, "review-packet.md"), "utf8");
    expect(packet).toContain("- Generation: not recorded (saved before Ticket 290; it used the production model, effort and layered prompt)");
    expect(packet).toContain("- Generation: model bench-model-b; reasoning effort low; prompt consolidated");
    expect(packet).toContain('- `generation.model`: "' + DAILY_BRIEF_MODEL + '" → "bench-model-b"');
    expect(packet).toContain('- `generation.promptVariant`: "layered" → "consolidated"');
    expect(packet).toContain("- No configuration or generation differences.");
    expect(packet).toContain(`- Generation: model ${DAILY_BRIEF_MODEL}; reasoning effort not recorded; prompt variant not recorded; prompt revision \`${DAILY_BRIEF_PROMPT_REVISION}\``);
    expect(packet).toContain(`- Generation: model bench-model-b; reasoning effort low; prompt variant layered; prompt revision \`${DAILY_BRIEF_PROMPT_REVISION}\``);

    expect((await writeBriefingReview(post("/api/dev/briefing-reviews", { source: "synthetic", action: "sequence_report", caseId: CASE, caseIds: [CASE] }), store)).status).toBe(200);
    const report = await readFile(path.join(dir, "sequence-report.md"), "utf8");
    expect(report).toContain("Generation · baseline · baseline: not recorded (saved before Ticket 290; it used the production model, effort and layered prompt).");
    expect(report).toContain(`Generation · candidate · candidate: model bench-model-b; reasoning effort low; prompt consolidated. Differences from baseline: generation.model ${DAILY_BRIEF_MODEL} → bench-model-b; generation.promptVariant layered → consolidated.`);
    expect(report).toContain("Differences from baseline: none.");
    expect(report).toContain(`model: ${DAILY_BRIEF_MODEL}; effort: not recorded; prompt variant: not recorded; prompt: ${DAILY_BRIEF_PROMPT_REVISION};`);
    expect(report).toContain(`model: bench-model-b; effort: low; prompt variant: layered; prompt: ${DAILY_BRIEF_PROMPT_REVISION};`);
  });
});
