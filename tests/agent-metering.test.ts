import { beforeEach, describe, expect, it, vi } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import type { CalendarCaller } from "@/lib/services/google-calendar.service";
import fixture from "./fixtures/advisor-day-context.valid.json";
import { dailyBriefPreferences } from "./helpers/daily-brief-preferences";
import { AgentBudgetRefused, estimateCallMicrodollars, meteredCall, stubAgentMetering, usageMicrodollars, type AgentMetering, type AgentRunRecord } from "@/lib/services/agent-metering";
import { agentModelSetting, normalizeModelId } from "@/lib/services/agent-model";
import type { DailyBriefGenerator } from "@/lib/services/daily-brief-consumer";

// Phase 1B: spend budget and run-log hooks. Phase 1A supplies the real Postgres implementation.
const mocks = vi.hoisted(() => ({ read: vi.fn(), begin: vi.fn(), finish: vi.fn(), prepare: vi.fn(), current: vi.fn() }));
vi.mock("@/lib/db/daily-brief.repo", () => ({ readDailyBriefPreferences: mocks.read, saveDailyBriefPreferences: vi.fn(), beginDailyBrief: mocks.begin, finishDailyBrief: mocks.finish,
  readDailyBriefTipHistory: vi.fn().mockResolvedValue([]), recordDailyBriefTip: vi.fn() }));
vi.mock("@/lib/db/advisor-context.repo", () => ({ readAdvisorProfileTimezone: vi.fn() }));
vi.mock("@/lib/services/briefing-account-context.service", () => ({ briefingAccountRef: (id: string) => `account-${id}`, prepareAccountBriefingContexts: mocks.prepare }));
vi.mock("@/lib/services/google-calendar.service", () => ({ getCalendarConnection: vi.fn() }));
vi.mock("@/lib/services/outlook-calendar.service", () => ({ getOutlookCalendarConnection: vi.fn() }));
vi.mock("@/lib/services/icloud-calendar.service", () => ({ getIcloudCalendarConnection: vi.fn() }));
vi.mock("@/lib/services/hevy.service", () => ({ getHevyConnection: vi.fn() }));
import { requestInAppDailyBrief } from "@/lib/services/daily-brief.service";

const caller = { client: {}, user: { id: "owner" } } as CalendarCaller;
const attempt = { installationId: "11111111-1111-4111-8111-111111111111", retry: false };
const now = () => Temporal.Instant.from(fixture.capturedAt);
const output = { suggestions: [], text: "Take time for your walk.", occurrenceRefs: [fixture.cadence.occurrences[0].ref] };

function recordingMetering(granted = true) {
  const reserve = vi.fn(async () => granted ? { granted: true as const, reservationId: "res-1" } : { granted: false as const, reason: "budget_exhausted" as const });
  const settle = vi.fn(async () => undefined);
  const runs: { accountId: string; run: AgentRunRecord; content?: unknown }[] = [];
  const metering: AgentMetering = { budget: { reserve, settle }, runLog: { record: async (entry) => { runs.push(entry); } } };
  return { metering, reserve, settle, runs };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("OPENAI_API_KEY", "synthetic-key");
  mocks.read.mockResolvedValue(dailyBriefPreferences({ revision: 1 }));
  mocks.begin.mockResolvedValue({ state: "acquired", leaseToken: "lease", localDate: fixture.localDate });
  mocks.finish.mockResolvedValue(true);
  mocks.current.mockResolvedValue(undefined);
  mocks.prepare.mockImplementation(async (_caller, options) => ({ contexts: [fixture], assertCurrent: mocks.current, configurationRefs: {}, preferences: options.preferences }));
});

describe("cost arithmetic", () => {
  it("prices Luna at US$0.20 / 0.02 / 1.20 per million and bills cached input at the cached rate", () => {
    expect(usageMicrodollars("openai/gpt-5.6-luna", { inputTokens: 8_700, cachedInputTokens: 0, outputTokens: 480, reasoningTokens: 200 })).toBe(Math.ceil(8_700 * 0.2 + 480 * 1.2));
    expect(usageMicrodollars("openai/gpt-5.6-luna", { inputTokens: 1_000, cachedInputTokens: 400, outputTokens: 0, reasoningTokens: null })).toBe(Math.ceil(600 * 0.2 + 400 * 0.02));
    expect(usageMicrodollars("openai/gpt-5.6-luna", { inputTokens: null, cachedInputTokens: null, outputTokens: null, reasoningTokens: null })).toBeNull();
  });
  it("estimates an upper bound from input size and the full output allowance", () => {
    const setting = agentModelSetting("daily_brief");
    expect(estimateCallMicrodollars(setting, 30_000)).toBe(Math.ceil(10_000 * 0.2 + 2_000 * 1.2));
    // An unlisted model is priced high so a reservation never reads as free.
    expect(estimateCallMicrodollars({ ...setting, model: "example/unlisted" }, 30_000)).toBeGreaterThan(estimateCallMicrodollars(setting, 30_000) * 10);
  });
  it("normalizes a bare OpenAI model ID and rejects junk", () => {
    expect(normalizeModelId("gpt-5.6-luna")).toBe("openai/gpt-5.6-luna");
    expect(normalizeModelId("anthropic/claude-sonnet-5.5")).toBe("anthropic/claude-sonnet-5.5");
    expect(() => normalizeModelId("not a model")).toThrow();
  });
});

describe("meteredCall", () => {
  const setting = agentModelSetting("daily_brief");
  it("refuses before the call when the budget says no", async () => {
    const { metering } = recordingMetering(false);
    const call = vi.fn();
    await expect(meteredCall({ metering, accountId: "a", agent: "daily_brief", setting, inputChars: 10, call })).rejects.toBeInstanceOf(AgentBudgetRefused);
    expect(call).not.toHaveBeenCalled();
  });
  it("settles the actual cost, or the estimate when no usage came back, even on failure", async () => {
    const { metering, settle } = recordingMetering();
    await meteredCall({ metering, accountId: "a", agent: "daily_brief", setting, inputChars: 30, call: async (onUsage) => {
      onUsage({ inputTokens: 1_000, cachedInputTokens: 0, outputTokens: 100, reasoningTokens: 0 }); return "ok"; } });
    expect(settle).toHaveBeenLastCalledWith({ reservationId: "res-1", actualMicrodollars: 320 });
    await expect(meteredCall({ metering, accountId: "a", agent: "daily_brief", setting, inputChars: 30, call: async () => { throw new Error("provider"); } })).rejects.toThrow("provider");
    expect(settle).toHaveBeenLastCalledWith({ reservationId: "res-1", actualMicrodollars: estimateCallMicrodollars(setting, 30) });
  });
  it("the stub grants every reservation", async () => {
    expect(await stubAgentMetering.budget.reserve({ accountId: "a", agent: "chat", estimateMicrodollars: 1 })).toMatchObject({ granted: true });
  });
});

describe("Daily Brief service hooks", () => {
  it("reserves, settles and writes one metadata run plus content for a shown brief", async () => {
    const { metering, reserve, settle, runs } = recordingMetering();
    const generate = vi.fn<DailyBriefGenerator>(async (input) => {
      input.onUsage?.({ inputTokens: 8_700, cachedInputTokens: 0, outputTokens: 480, reasoningTokens: 200 });
      return output;
    });
    const result = await requestInAppDailyBrief(caller, attempt, { generate, now, metering });
    expect(result).toMatchObject({ state: "ready" });
    expect(reserve).toHaveBeenCalledWith(expect.objectContaining({ accountId: "owner", agent: "daily_brief" }));
    expect(settle).toHaveBeenCalledWith({ reservationId: "res-1", actualMicrodollars: 2_316 });
    expect(runs).toHaveLength(1);
    expect(runs[0]!.run).toMatchObject({ agent: "daily_brief", trigger: "user", model: "openai/gpt-5.6-luna", calls: 1, inputTokens: 8_700, outputTokens: 480,
      costMicrodollars: 2_316, toolCalls: 0, outcome: "ok", errorReason: null });
    expect(runs[0]!.run.inputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(runs[0]!.content).toMatchObject({ kind: "daily_brief", localDate: fixture.localDate });
    // Metadata never carries the prompt, facts or output.
    expect(JSON.stringify(runs[0]!.run)).not.toContain("walk");
  });

  it("refuses a call over budget before the model, and logs the refusal without content", async () => {
    const { metering, runs } = recordingMetering(false);
    const generate = vi.fn();
    await expect(requestInAppDailyBrief(caller, attempt, { generate, now, metering })).rejects.toMatchObject({ code: "budget_reached" });
    expect(generate).not.toHaveBeenCalled();
    expect(runs).toEqual([expect.objectContaining({ run: expect.objectContaining({ outcome: "budget_refused", costMicrodollars: 0 }) })]);
    expect(runs[0]!.content).toBeUndefined();
  });

  it("logs a superseded brief as an error without keeping its text", async () => {
    const { metering, runs } = recordingMetering();
    mocks.finish.mockResolvedValue(false);
    await expect(requestInAppDailyBrief(caller, attempt, { generate: vi.fn().mockResolvedValue(output), now, metering })).rejects.toMatchObject({ code: "context_changed" });
    expect(runs).toEqual([expect.objectContaining({ run: expect.objectContaining({ outcome: "error", errorReason: "superseded" }) })]);
    expect(runs[0]!.content).toBeUndefined();
  });
});
