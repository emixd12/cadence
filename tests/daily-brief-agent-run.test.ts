import { beforeEach, describe, expect, it, vi } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import type { CalendarCaller } from "@/lib/services/google-calendar.service";
import fixture from "./fixtures/advisor-day-context.valid.json";
import { dailyBriefPreferences } from "./helpers/daily-brief-preferences";

// Advisor plan Phase 1A: the hosted Daily Brief writes an agent run, sends each
// model call through the spend budget, and stores its content. The database
// side is proven by tests/sql/advisor-1a-agent-foundations-smoke.sql and
// tests/agent-caller.local-integration.test.ts.

const mocks = vi.hoisted(() => ({ read: vi.fn(), begin: vi.fn(), finish: vi.fn(), timezone: vi.fn(), prepare: vi.fn(), current: vi.fn(),
  tipHistory: vi.fn(), recordTip: vi.fn(), agentClient: vi.fn(), configured: vi.fn(), saveBrief: vi.fn(), plan: vi.fn(), proposals: vi.fn() }));
vi.mock("@/lib/services/outlook-calendar.service", () => ({ getOutlookCalendarConnection: vi.fn() }));
vi.mock("@/lib/services/hevy.service", () => ({ getHevyConnection: vi.fn() }));
vi.mock("@/lib/services/icloud-calendar.service", () => ({ getIcloudCalendarConnection: vi.fn() }));
vi.mock("@/lib/services/google-calendar.service", () => ({ getCalendarConnection: vi.fn() }));
vi.mock("@/lib/db/daily-brief.repo", () => ({ readDailyBriefPreferences: mocks.read, saveDailyBriefPreferences: vi.fn(), beginDailyBrief: mocks.begin,
  finishDailyBrief: mocks.finish, readDailyBriefTipHistory: mocks.tipHistory, recordDailyBriefTip: mocks.recordTip, saveDailyBrief: mocks.saveBrief }));
vi.mock("@/lib/services/brief-moves.service", () => ({ planBriefMoveLines: mocks.plan, saveBriefProposals: mocks.proposals, readBriefMoves: vi.fn(), readOpenBriefConflicts: vi.fn(async () => []), ensureBehaviorEstimates: vi.fn() }));
vi.mock("@/lib/db/advisor-context.repo", () => ({ readAdvisorProfileTimezone: mocks.timezone }));
vi.mock("@/lib/services/briefing-account-context.service", () => ({
  briefingAccountRef: (userId: string) => `account-${userId}`,
  prepareAccountBriefingContexts: mocks.prepare,
}));
vi.mock("@/lib/integrations/agent-caller", () => ({ agentCallerConfigured: mocks.configured, createAgentClient: mocks.agentClient }));

import { requestInAppDailyBrief } from "@/lib/services/daily-brief.service";
import { beginDailyBriefAgentRun, dailyBriefContextIsCalendarDerived } from "@/lib/services/daily-brief-agent-run";
import { estimateCallMicrodollars, modelPrice, usageMicrodollars } from "@/lib/services/agent-model-pricing";

type Call = { name: string; args: Record<string, unknown> };
type Reply = { data: unknown; error: unknown };

/** A Supabase client double that records RPC calls in order. */
function fakeAgentClient(overrides: Record<string, (args: Record<string, unknown>) => Reply> = {}) {
  const calls: Call[] = [];
  const defaults: Record<string, (args: Record<string, unknown>) => Reply> = {
    agent_run_start: () => ({ data: [{ run_id: "run-1", local_date: fixture.localDate, timezone: fixture.timezone }], error: null }),
    reserve_agent_spend: () => ({ data: [{ allowed: true, reservation_id: "reservation-1", reason: null, retry_after_seconds: 0, resets_at: null }], error: null }),
    settle_agent_spend: () => ({ data: true, error: null }),
    agent_run_store_content: () => ({ data: true, error: null }),
    agent_run_finish: () => ({ data: true, error: null }),
  };
  const client = {
    rpc(name: string, args: Record<string, unknown> = {}) {
      calls.push({ name, args });
      const result = Promise.resolve((overrides[name] ?? defaults[name] ?? (() => ({ data: null, error: { message: "unexpected" } })))(args));
      return Object.assign(result, { abortSignal: () => result });
    },
  };
  return { client, calls, names: () => calls.map((call) => call.name) };
}

const refusal = () => ({ data: [{ allowed: false, reservation_id: null, reason: "agent_share", retry_after_seconds: 3600, resets_at: "2026-12-01T08:00:00Z" }], error: null });

const caller = { client: {}, user: { id: "owner" } } as CalendarCaller;
const input = { installationId: "11111111-1111-4111-8111-111111111111", retry: false, features: ["move_lines_v1"] };
const candidate = {
  key: "line_1", occurrenceId: "occ-1", behaviorId: "beh-1", behaviorRevision: "r", title: fixture.cadence.occurrences[0].title,
  localDate: fixture.localDate, timezone: fixture.timezone, expectedRevision: "r",
  from: { startAt: "2026-09-20T16:30:00Z", endAt: "2026-09-20T17:00:00Z" }, to: { startAt: "2026-09-20T18:00:00Z", endAt: "2026-09-20T18:30:00Z" },
  length: { minutes: 30, source: "behavior_duration", assumed: false }, reasonCode: "item_overlap", reason: "It overlaps another item.",
  anchor: null, otherTimes: [], travel: "not_needed", late: false, offerNeverMove: false,
};
const now = () => Temporal.Instant.from(fixture.capturedAt);
const generate = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("OPENAI_API_KEY", "synthetic-key");
  mocks.read.mockResolvedValue(dailyBriefPreferences({ revision: 1 }));
  mocks.begin.mockResolvedValue({ state: "acquired", leaseToken: "lease", localDate: fixture.localDate });
  mocks.finish.mockResolvedValue(true);
  mocks.timezone.mockResolvedValue(fixture.timezone);
  mocks.current.mockResolvedValue(undefined);
  mocks.prepare.mockImplementation(async (_caller, options) => ({ contexts: [fixture], assertCurrent: mocks.current, configurationRefs: {}, preferences: options.preferences }));
  mocks.tipHistory.mockResolvedValue([]);
  mocks.recordTip.mockResolvedValue(true);
  mocks.configured.mockReturnValue(true);
  mocks.saveBrief.mockResolvedValue(true);
  mocks.plan.mockResolvedValue({ candidates: [candidate], calendar: "current" });
  mocks.proposals.mockImplementation(async (_client, value) => value.lines.map(({ key: _key, ...line }: typeof candidate) => ({ ...line, proposalId: "9d0f6c3e-0000-4000-8000-000000000001", status: "proposed", moveId: null })));
  generate.mockImplementation(async (request) => {
    request.onUsage?.({ inputTokens: 8700, cachedInputTokens: 0, outputTokens: 480, reasoningTokens: 300 });
    return { opening: "One item could use a different time today.", reasons: [{ key: "line_1", text: "It overlaps another item." }] };
  });
});

describe("Daily Brief agent run (advisor plan Phase 1A)", () => {
  it("writes an agent run, reserves before the model call, settles the actual cost and stores input and output", async () => {
    const fake = fakeAgentClient();
    mocks.agentClient.mockReturnValue({ client: fake.client, tokenExpiresAt: () => new Date() });

    const result = await requestInAppDailyBrief(caller, input, { generate, now });

    expect(result.state).toBe("ready");
    expect(mocks.agentClient).toHaveBeenCalledWith("owner", "daily_brief");
    expect(fake.names()).toEqual(["agent_run_start", "reserve_agent_spend", "settle_agent_spend",
      "agent_brief_refresh_funded", "agent_run_finish", "agent_run_store_content", "agent_run_store_content"]);
    const [start, reserve, settle, , finish, storedInput, storedOutput] = fake.calls;
    expect(start.args).toMatchObject({ p_trigger: "on_demand", p_model: "openai/gpt-5.6-luna" });
    expect(start.args.p_prompt_version).toMatch(/^[a-f0-9]{16}:[a-f0-9]{64}$/);
    expect(reserve.args).toMatchObject({ p_run_id: "run-1", p_model: "openai/gpt-5.6-luna" });
    expect(reserve.args.p_estimated_microdollars as number).toBeGreaterThan(2_400);
    // 8,700 input tokens at US$0.20/M plus 480 output tokens at US$1.20/M.
    expect(settle.args).toEqual({ p_reservation_id: "reservation-1", p_actual_microdollars: 2316 });
    expect(storedInput.args).toMatchObject({ p_run_id: "run-1", p_kind: "input", p_seq: 0,
      p_calendar_derived: dailyBriefContextIsCalendarDerived(fixture as never) });
    expect((storedInput.args.p_body as { facts: string }).facts).toBe(generate.mock.calls[0][0].facts);
    expect(storedOutput.args).toMatchObject({ p_kind: "output", p_body: result.state === "ready" ? JSON.parse(JSON.stringify(result.briefing)) : null });
    expect(finish.args).toMatchObject({ p_run_id: "run-1", p_outcome: "success", p_model_calls: 1, p_input_tokens: 8700, p_output_tokens: 480,
      p_linked_proposal_ids: ["9d0f6c3e-0000-4000-8000-000000000001"] });
    expect(finish.args.p_input_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("refuses a call that would pass the agent's share before the model is called, and shows Cadence's short version", async () => {
    const fake = fakeAgentClient({ reserve_agent_spend: refusal });
    mocks.agentClient.mockReturnValue({ client: fake.client, tokenExpiresAt: () => new Date() });

    const result = await requestInAppDailyBrief(caller, input, { generate, now });

    expect(generate).not.toHaveBeenCalled();
    expect(result).toMatchObject({ state: "ready", briefing: { notices: [expect.objectContaining({ kind: "budget_reached" })] } });
    const finish = fake.calls.find((call) => call.name === "agent_run_finish")!;
    expect(finish.args).toMatchObject({ p_outcome: "refused_budget", p_error_code: "budget_reached", p_error_reason: "budget_agent_share", p_model_calls: 0 });
    // The shown brief completes the lease through the save.
    expect(mocks.saveBrief).toHaveBeenCalledTimes(1);
    expect(mocks.finish).not.toHaveBeenCalled();
  });

  it("does not call the model when the budget cannot be checked", async () => {
    const fake = fakeAgentClient({ reserve_agent_spend: () => ({ data: null, error: { message: "agent_channel_required" } }) });
    mocks.agentClient.mockReturnValue({ client: fake.client, tokenExpiresAt: () => new Date() });
    const result = await requestInAppDailyBrief(caller, input, { generate, now });
    expect(generate).not.toHaveBeenCalled();
    expect(result).toMatchObject({ state: "ready", briefing: { notices: [expect.objectContaining({ kind: "words_unavailable" })] } });
    expect(fake.calls.find((call) => call.name === "agent_run_finish")!.args).toMatchObject({ p_error_reason: "budget_unavailable" });
  });

  it("records a failed model call and settles at the estimate when no usage was reported", async () => {
    const fake = fakeAgentClient();
    mocks.agentClient.mockReturnValue({ client: fake.client, tokenExpiresAt: () => new Date() });
    const { DailyBriefError } = await import("@/lib/services/daily-brief-consumer");
    generate.mockRejectedValue(new DailyBriefError("advisor_unavailable", undefined, "provider_body_missing"));

    await expect(requestInAppDailyBrief(caller, { ...input, retry: true }, { generate, now })).resolves.toMatchObject({ state: "ready" });

    const reserve = fake.calls.find((call) => call.name === "reserve_agent_spend")!;
    const settle = fake.calls.find((call) => call.name === "settle_agent_spend")!;
    expect(settle.args.p_actual_microdollars).toBe(reserve.args.p_estimated_microdollars);
    expect(fake.calls[0].args).toMatchObject({ p_trigger: "retry" });
    expect(fake.calls.find((call) => call.name === "agent_run_finish")).toMatchObject({ args: { p_outcome: "model_error", p_error_reason: "provider_body_missing" } });
    // The shown stock brief is still stored for replay.
    expect(fake.names().filter((name) => name === "agent_run_store_content")).toHaveLength(2);
  });

  it("stops the brief when a configured agent signing key is invalid", async () => {
    mocks.configured.mockImplementation(() => { throw new Error("invalid key"); });
    await expect(requestInAppDailyBrief(caller, input, { generate, now })).rejects.toMatchObject({ code: "advisor_unavailable" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("returns a finished brief even when a run-log write is slower than the deadline allows", async () => {
    const fake = fakeAgentClient();
    const slow = { ...fake.client, rpc(name: string, args: Record<string, unknown> = {}) {
      if (name !== "agent_run_store_content") return fake.client.rpc(name, args);
      fake.calls.push({ name, args });
      const pending = new Promise<Reply>(() => undefined);
      return Object.assign(pending, { abortSignal: (signal: AbortSignal) =>
        new Promise<Reply>((resolve) => signal.addEventListener("abort", () => resolve({ data: null, error: { message: "aborted" } }), { once: true })) });
    } };
    mocks.agentClient.mockReturnValue({ client: slow, tokenExpiresAt: () => new Date() });
    await expect(requestInAppDailyBrief(caller, input, { generate, now, deadlineMs: 2_300 })).resolves.toMatchObject({ state: "ready" });
    expect(fake.names()).toContain("agent_run_finish");
  });

  it("runs without a run log only when the deployment has no agent signing key", async () => {
    mocks.configured.mockReturnValue(false);
    await expect(requestInAppDailyBrief(caller, input, { generate, now })).resolves.toMatchObject({ state: "ready" });
    expect(mocks.agentClient).not.toHaveBeenCalled();
  });

  it("refuses a model with no recorded price before calling it", async () => {
    const fake = fakeAgentClient();
    const run = await beginDailyBriefAgentRun({ userId: "owner", trigger: "on_demand", model: "unpriced-model", promptVersion: "v1", client: fake.client as never });
    const wrapped = run!.wrap(generate);
    await expect(wrapped({ instructions: "i", facts: "f", signal: new AbortController().signal })).rejects.toMatchObject({ code: "advisor_unavailable", reason: "model_price_unknown" });
    expect(generate).not.toHaveBeenCalled();
    expect(fake.names()).toEqual(["agent_run_start"]);
  });
});

describe("agent model pricing", () => {
  it("reads gateway model strings and prices cached input separately", () => {
    const price = modelPrice("openai/gpt-5.6-luna")!;
    expect(price).toEqual(modelPrice("gpt-5.6-luna"));
    expect(modelPrice("unknown")).toBeNull();
    expect(usageMicrodollars(price, { inputTokens: 1_000_000, cachedInputTokens: 500_000, outputTokens: 0 })).toBe(110_000);
    expect(usageMicrodollars(price, { inputTokens: null, cachedInputTokens: null, outputTokens: null })).toBeNull();
    expect(estimateCallMicrodollars(price, { requestCharacters: 40_000, maxOutputTokens: 2_000 })).toBe(10_400);
  });

  it("bills Anthropic cache writes at 1.25x input and cache reads at the cached rate", () => {
    const price = modelPrice("anthropic/claude-sonnet-5.5")!;
    // 1M input: 600k written to the cache (US$1.50), 300k read from it (US$0.03), 100k fresh (US$0.20).
    expect(usageMicrodollars(price, { inputTokens: 1_000_000, cachedInputTokens: 300_000, cacheWriteTokens: 600_000, outputTokens: 0 })).toBe(1_730_000);
    // OpenAI has no separate write price; its cache writes bill as normal input.
    expect(usageMicrodollars(modelPrice("openai/gpt-5.6-luna")!, { inputTokens: 1_000, cachedInputTokens: 0, cacheWriteTokens: 1_000, outputTokens: 0 })).toBe(200);
  });

  it("prices the Phase 1B eval candidates, including Anthropic models", () => {
    expect(modelPrice("anthropic/claude-sonnet-5.5")).toEqual({ input: 2, cachedInput: 0.1, cacheWriteInput: 2.5, output: 10 });
    expect(modelPrice("anthropic/claude-haiku-5.5")).not.toBeNull();
    expect(modelPrice("openai/gpt-5.6-terra")).not.toBeNull();
  });

  it("estimates with the caller's output cap and model", async () => {
    const fake = fakeAgentClient();
    const run = await beginDailyBriefAgentRun({ userId: "owner", trigger: "on_demand", model: "anthropic/claude-sonnet-5.5", maxOutputTokens: 1_000,
      promptVersion: "v1", client: fake.client as never });
    await run!.wrap(async () => ({}))({ instructions: "i".repeat(100), facts: "", signal: new AbortController().signal });
    const reserve = fake.calls.find((call) => call.name === "reserve_agent_spend")!;
    // 100 characters at the US$2.50 per million cache-write rate plus 1,000 output tokens at US$10 per million.
    expect(reserve.args).toMatchObject({ p_model: "anthropic/claude-sonnet-5.5", p_estimated_microdollars: 10_250 });
  });
});
