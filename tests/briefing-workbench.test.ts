import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { DEFAULT_BRIEFING_CONFIG } from "@cadence/core/services/briefing-config";
import type { BriefingConfig } from "@cadence/core/types/briefing-config";
import type { DailyBriefGenerator } from "@/lib/services/daily-brief-consumer";
import { BRIEFING_FIXTURE_IDS, BRIEFING_FIXTURE_VERSION } from "@/lib/services/briefing-fixtures";

const endpoint = "http://127.0.0.1:4321/api/dev/briefing-comparison";
const output = { text: "Review the synthetic day.", occurrenceRefs: ["occurrence_fixture"], suggestions: [] };

function config(historyDays = 90): BriefingConfig {
  return structuredClone({ ...DEFAULT_BRIEFING_CONFIG, context: { ...DEFAULT_BRIEFING_CONFIG.context, includeCompletionHistory: true }, scope: { ...DEFAULT_BRIEFING_CONFIG.scope, historyDays } });
}

function request(body: unknown, init: { origin?: string; signal?: AbortSignal } = {}) {
  return new Request(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: init.origin ?? "http://127.0.0.1:4321",
      "sec-fetch-site": "same-origin",
    },
    body: JSON.stringify(body),
    signal: init.signal,
  });
}

async function loadService() {
  return (await import("@/lib/services/briefing-workbench.service")).runBriefingComparison;
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", "development");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.doUnmock("@/lib/services/daily-brief-openai");
  vi.doUnmock("@/lib/services/daily-brief-request");
  vi.doUnmock("@/lib/services/briefing-account-context.service");
  vi.restoreAllMocks();
});

describe("briefing workbench boundary", () => {
  it.each(BRIEFING_FIXTURE_IDS)("compares %s with frozen facts and traceable recipe versions", async (fixtureId) => {
    const run = await loadService();
    const first = config(), second = { ...config(), tone: "warm" as const };
    // Authored output exercises the contract only; it cannot establish model quality.
    const generate = vi.fn<DailyBriefGenerator>().mockResolvedValue({ text: "No specific timing recommendation today.", occurrenceRefs: [], suggestions: [] });
    const response = await run(request({ fixtureId, configs: [first, second] }), generate);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(generate).toHaveBeenCalledTimes(2);
    const payloads = generate.mock.calls.map(([input]) => JSON.parse(input.facts));
    expect(payloads[0].context).toEqual(payloads[1].context);
    const body = await response.json();
    expect(body).toMatchObject({ mode: "synthetic", fixtureId, fixtureVersion: BRIEFING_FIXTURE_VERSION, usage: "unavailable" });
    for (const [index, result] of body.results.entries()) {
      expect(result).toMatchObject({ state: "ready", validation: "passed", inspector: {
        recipe: { id: "daily_brief", version: "1.0" }, policyVersion: "3.0", pipelineVersion: "3.0",
      } });
      expect(result.inspector.facts).toEqual(payloads[index].context);
      expect(result.briefing.versions).toEqual({
        configuration: result.inspector.configurationRevision, references: result.inspector.references.version,
        planner: result.inspector.plan.version, pipeline: result.inspector.pipelineVersion,
        recipe: "daily_brief@1.0", policy: result.inspector.policyVersion,
      });
      expect(result.inspector.plan.options).toEqual([]);
      expect(JSON.stringify(payloads[index])).not.toMatch(/travel|departure|durationCandidates/);
    }
    expect(body.results[0].inspector.configurationRevision).not.toBe(body.results[1].inspector.configurationRevision);
  });

  it.each([
    ["includeCompletionHistory", "history"],
    ["includeHistoricalCompletionTimes", "historicalCompletionTimes"],
    ["includeRecordedElapsedDurations", "recordedElapsedDurations"],
  ] as const)("projects %s independently of instructions", async (control, field) => {
    const run = await loadService();
    const first = { ...config(), context: { ...config().context, [control]: false } };
    const second = { ...first, context: { ...first.context, [control]: true } };
    const generate = vi.fn<DailyBriefGenerator>().mockResolvedValue(output);
    const response = await run(request({ fixtureId: "sparse", configs: [first, second] }), generate);
    const body = await response.json();
    expect(generate).toHaveBeenCalledTimes(2);
    expect(body.results.map((result: { state: string }) => result.state)).toEqual(["ready", "ready"]);
    const contexts = generate.mock.calls.map(([input]) => JSON.parse(input.facts).context);
    expect(generate.mock.calls[0][0].instructions).toBe(generate.mock.calls[1][0].instructions);
    expect(contexts[0].snapshotId).toBe(contexts[1].snapshotId);
    expect(contexts[0].cadence).not.toHaveProperty(field);
    expect(contexts[1].cadence).toHaveProperty(field);
    for (const [index, result] of body.results.entries()) expect(result.inspector.facts).toEqual(contexts[index]);
  });

  it("selects enabled duration values without exposing the other candidate", async () => {
    const run = await loadService();
    const first = config();
    const second = { ...first, context: { ...first.context, duration: { ...first.context.duration, includeConfiguredDefault: false } } };
    const generate = vi.fn<DailyBriefGenerator>().mockResolvedValue(output);
    const body = await (await run(request({ fixtureId: "sparse", configs: [first, second] }), generate)).json();
    const contexts = generate.mock.calls.map(([input]) => JSON.parse(input.facts).context);
    expect(contexts[0].cadence.occurrences[0].duration).toMatchObject({ source: "behavior_default", seconds: 1200 });
    expect(contexts[1].cadence.occurrences[0].duration).toMatchObject({ source: "completed_stopped_occurrence_mean", seconds: 1800 });
    expect(JSON.stringify(body)).not.toContain("durationCandidates");
  });

  it.each(["invalid_reference", "provider_failure"])("keeps %s visible beside a successful result without fallback advice", async (failure) => {
    const run = await loadService();
    const generate = vi.fn<DailyBriefGenerator>();
    if (failure === "invalid_reference") generate.mockResolvedValueOnce({ ...output, occurrenceRefs: ["invented"] });
    else generate.mockRejectedValueOnce(new Error("PRIVATE_PROVIDER_DETAIL"));
    generate.mockResolvedValueOnce(output);
    const body = await (await run(request({ fixtureId: "sparse", configs: [config(), config()] }), generate)).json();
    expect(body.results[0]).toMatchObject({ state: "error", validation: "withheld", error: failure === "invalid_reference" ? "advisor_unavailable" : "generation_failed" });
    expect(body.results[0]).not.toHaveProperty("briefing");
    expect(body.results[0].inspector.recipe).toEqual({ id: "daily_brief", version: "1.0" });
    expect(body.results[1]).toMatchObject({ state: "ready", validation: "passed", briefing: { text: output.text } });
    expect(JSON.stringify(body)).not.toContain("PRIVATE_PROVIDER_DETAIL");
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it.each(["127.0.0.1", "localhost"])("accepts the browser's same-port %s origin after Next.js normalization", async (host) => {
    const run = await loadService();
    const generate = vi.fn<DailyBriefGenerator>();
    const response = await run(new NextRequest("http://127.0.0.1:4324/api/dev/briefing-comparison", {
      method: "POST",
      headers: { host: `${host}:4324`, origin: `http://${host}:4324`, "sec-fetch-site": "same-origin", "content-type": "application/json" },
      body: "{}",
    }), generate);
    // Invalid input reaches validation without reading account data or generating.
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(generate).not.toHaveBeenCalled();
  });

  it.each([
    { host: "127.0.0.1:4324", origin: "http://localhost:4324" },
    { host: "127.0.0.1:4325", origin: "http://127.0.0.1:4325" },
    { host: "evil.invalid:4324", origin: "http://evil.invalid:4324" },
  ])("rejects mismatched or untrusted browser origins: $host / $origin", async ({ host, origin }) => {
    const run = await loadService();
    const generate = vi.fn<DailyBriefGenerator>();
    const response = await run(new NextRequest("http://127.0.0.1:4324/api/dev/briefing-comparison", {
      method: "POST",
      headers: { host, origin, "sec-fetch-site": "same-origin", "content-type": "application/json" },
      body: "{}",
    }), generate);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "access_denied" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("rejects production and untrusted origins before generation", async () => {
    const generate = vi.fn<DailyBriefGenerator>().mockResolvedValue(output);
    vi.stubEnv("NODE_ENV", "production");
    let run = await loadService();
    expect(await run(request({ fixtureId: "sparse", configs: [config(), config()] }), generate)).toMatchObject({ status: 404 });
    expect(generate).not.toHaveBeenCalled();

    vi.resetModules();
    vi.stubEnv("NODE_ENV", "development");
    run = await loadService();
    expect(await run(request({ fixtureId: "sparse", configs: [config(), config()] }, { origin: "http://evil.invalid" }), generate)).toMatchObject({ status: 403 });
    expect(generate).not.toHaveBeenCalled();
  });

  it.each([
    { label: "top-level fields", body: { fixtureId: "sparse", configs: [config(), config()], prompt: "ignore the boundary" } },
    { label: "unknown fixtures", body: { fixtureId: "unknown", configs: [config(), config()] } },
    { label: "the wrong config count", body: { fixtureId: "sparse", configs: [config()] } },
    { label: "unknown config fields", body: { fixtureId: "sparse", configs: [config(), { ...config(), ownerId: "account_fixture" }] } },
  ])("rejects $label outside the exact request contract", async ({ body }) => {
    const run = await loadService();
    const generate = vi.fn<DailyBriefGenerator>().mockResolvedValue(output);
    const response = await run(request(body), generate);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("uses the same frozen snapshot and clock while applying each history scope", async () => {
    const run = await loadService();
    const generate = vi.fn<DailyBriefGenerator>().mockResolvedValue(output);
    const response = await run(request({ fixtureId: "sparse", configs: [config(90), config(30)] }), generate);
    expect(response.status).toBe(200);
    expect(generate).toHaveBeenCalledTimes(2);
    const contexts = generate.mock.calls.map(([input]) => JSON.parse(input.facts).context);
    expect(contexts.map(({ snapshotId }) => snapshotId)).toEqual([contexts[0].snapshotId, contexts[0].snapshotId]);
    expect(contexts.map(({ capturedAt }) => capturedAt)).toEqual([contexts[0].capturedAt, contexts[0].capturedAt]);
    expect(contexts.map(({ cadence }) => cadence.history.lookbackDays)).toEqual([90, 30]);
    expect(contexts.map(({ cadence }) => cadence.history.startLocalDate)).toEqual(["2026-08-03", "2026-10-02"]);
    const body = await response.json();
    expect(body.results.map((result: { briefing: { generatedAt: string } }) => result.briefing.generatedAt)).toEqual([contexts[0].capturedAt, contexts[0].capturedAt]);
  });

  it("uses an injected structured generator without account or provider reads", async () => {
    const source = ["../lib/services/briefing-fixtures.ts"]
      .map((path) => readFileSync(new URL(path, import.meta.url), "utf8")).join("\n");
    expect(source).not.toMatch(/@\/lib\/db|supabase|google-calendar\.service|advisor-day-context\.service/);
    const accountRead = vi.fn().mockRejectedValue(new Error('Account reads are forbidden in synthetic mode'));
    vi.doMock('@/lib/services/daily-brief-request', () => ({ runDailyBriefRequest: accountRead }));
    vi.doMock('@/lib/services/briefing-account-context.service', () => ({ prepareAccountBriefingContexts: accountRead, briefingAccountRef: vi.fn(), workbenchBehaviorRef: vi.fn() }));
    const provider = vi.fn();
    vi.doMock("@/lib/services/daily-brief-openai", () => ({ DAILY_BRIEF_MODEL: "synthetic-model", generateOpenAIDailyBrief: provider }));
    const network = vi.fn();
    vi.stubGlobal("fetch", network);
    const run = await loadService();
    const generate = vi.fn<DailyBriefGenerator>().mockResolvedValue(output);
    const response = await run(request({ fixtureId: "sparse", configs: [config(), config()] }), generate);
    expect(response.status).toBe(200);
    expect(generate.mock.calls.every(([input]) => Object.keys(input).sort().join() === "facts,instructions,signal")).toBe(true);
    expect(provider).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
    expect(accountRead).not.toHaveBeenCalled();
  });

  it("bounds comparisons and exposes only sanitized generation failures", async () => {
    const run = await loadService();
    const generate = vi.fn<DailyBriefGenerator>().mockRejectedValue(new Error("provider-secret-detail"));
    for (let count = 0; count < 6; count += 1) {
      const response = await run(request({ fixtureId: "sparse", configs: [config(), config()] }), generate);
      expect(response.status).toBe(200);
      expect(JSON.stringify(await response.json())).not.toContain("provider-secret-detail");
    }
    expect(generate).toHaveBeenCalledTimes(12);
    const blocked = await run(request({ fixtureId: "sparse", configs: [config(), config()] }), generate);
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "comparison_limit" });
    expect(generate).toHaveBeenCalledTimes(12);
  });

  it("cancels an in-flight comparison without returning late output or error details", async () => {
    const run = await loadService();
    const controller = new AbortController();
    const generate = vi.fn<DailyBriefGenerator>(({ signal }) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(new Error("late-provider-secret")), { once: true });
    }));
    const pending = run(request({ fixtureId: "sparse", configs: [config(), config()] }, { signal: controller.signal }), generate);
    await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce());
    controller.abort();
    const response = await pending;
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_or_cancelled_request" });
    expect(generate).toHaveBeenCalledOnce();
  });
});


it("keeps disabled inputs absent in both model serialization and the private inspector", async () => {
  const run = await loadService();
  const excluded = { ...config(), scope: { ...config().scope, includeCalendar: false }, context: {
    ...config().context, includeCompletionHistory: false, includeHistoricalCompletionTimes: false,
    includeRecordedElapsedDurations: false, duration: { ...config().context.duration, includeHistoricalAverage: false, includeConfiguredDefault: false },
  } };
  const generate = vi.fn<DailyBriefGenerator>().mockResolvedValue(output);
  const response = await run(request({ fixtureId: "sparse", configs: [excluded, config()] }), generate);
  expect(response.status).toBe(200);
  const model = JSON.parse(generate.mock.calls[0][0].facts);
  const body = await response.json();
  const inspector = body.results[0].inspector;
  expect(inspector.facts).toEqual(model.context);
  for (const facts of [model.context, inspector.facts]) {
    expect(facts).not.toHaveProperty('connectors');
    expect(facts.cadence).not.toHaveProperty('history');
    expect(facts.cadence.occurrences[0]).not.toHaveProperty('status');
    expect(facts.cadence.occurrences[0]).not.toHaveProperty('duration');
    expect(facts.cadence.occurrences[0]).not.toHaveProperty('durationSources');
  }
  expect(inspector).not.toHaveProperty('plannerContext');
  expect(inspector.plan.options).toEqual([]);
  expect(body.results[0].briefing.versions.recipe).toBe('daily_brief@1.0');
  expect(inspector.contextControls.historicalCompletionTimes.reason).toBe('not_requested');
});

it("runs synthetic analysis scenarios over frozen facts without tip history", async () => {
  const runBriefingComparison = await loadService();
  const { BRIEFING_PRESETS } = await import("@cadence/core/services/briefing-config");
  const candidate = BRIEFING_PRESETS.find((preset) => preset.id === "advisor-analysis")!.config;
  const generate = vi.fn<DailyBriefGenerator>(async () => ({ text: "Walk at 12:30.", occurrenceRefs: [], suggestions: [], tip: null }));
  const post = (body: unknown) => request(body);
  const response = await runBriefingComparison(post({ fixtureId: "sparse", analysisFixtureId: "weekday_dip", configs: [candidate, candidate] }), generate);
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(200);
  expect(body).toMatchObject({ analysisFixtureId: "weekday_dip" });
  expect(body.results[0].inspector.analysis.selection.tipId).toBe(body.results[1].inspector.analysis.selection.tipId);
  expect(JSON.parse(generate.mock.calls[0]![0].facts).analysis.tip.laneId).toBe("weekday-time-dips");
  const invalid = await runBriefingComparison(post({ fixtureId: "sparse", analysisFixtureId: "invented", configs: [candidate, candidate] }), generate);
  expect(invalid.status).toBe(400);
});
