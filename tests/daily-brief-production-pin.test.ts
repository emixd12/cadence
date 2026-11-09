import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import { BRIEFING_PRESETS, parseBriefingConfig } from "@cadence/core/services/briefing-config";
import type { BriefingConfig } from "@cadence/core/types/briefing-config";
import type { CalendarCaller } from "@/lib/services/google-calendar.service";
import { BRIEFING_FIXTURE_IDS, briefingFixture } from "@/lib/services/briefing-fixtures";
import fixture from "./fixtures/advisor-day-context.valid.json";
import { connectorDayContext } from "./helpers/connector-day-context";

// Ticket 290: production stays pinned to DAILY_BRIEF_MODEL, effort "low" and the layered
// prompt. The hashes below were computed from the code before Ticket 290 changed the
// consumer, the instructions module and the adapter. Any byte change fails these tests.
const mocks = vi.hoisted(() => ({ read: vi.fn(), begin: vi.fn(), finish: vi.fn(), prepare: vi.fn(), current: vi.fn(), tipHistory: vi.fn(), recordTip: vi.fn(), config: vi.fn() }));
vi.mock("@/lib/db/daily-brief.repo", () => ({ readDailyBriefPreferences: mocks.read, saveDailyBriefPreferences: vi.fn(), beginDailyBrief: mocks.begin, finishDailyBrief: mocks.finish,
  readDailyBriefTipHistory: mocks.tipHistory, recordDailyBriefTip: mocks.recordTip }));
vi.mock("@/lib/services/briefing-pipeline", async (original) => {
  const actual = await original<typeof import("@/lib/services/briefing-pipeline")>();
  const active = () => mocks.config() ?? actual.activeBriefingConfig();
  return { ...actual, activeBriefingConfig: active, briefingConfigurationRevision: (value?: unknown) => actual.briefingConfigurationRevision(value ?? active()) };
});
vi.mock("@/lib/db/advisor-context.repo", () => ({ readAdvisorProfileTimezone: vi.fn() }));
vi.mock("@/lib/services/briefing-account-context.service", () => ({ briefingAccountRef: (userId: string) => `account-${userId}`, prepareAccountBriefingContexts: mocks.prepare }));
vi.mock("@/lib/services/google-calendar.service", () => ({ getCalendarConnection: vi.fn() }));
vi.mock("@/lib/services/outlook-calendar.service", () => ({ getOutlookCalendarConnection: vi.fn() }));
vi.mock("@/lib/services/icloud-calendar.service", () => ({ getIcloudCalendarConnection: vi.fn() }));
vi.mock("@/lib/services/hevy.service", () => ({ getHevyConnection: vi.fn() }));

import { requestInAppDailyBrief } from "@/lib/services/daily-brief.service";
import { DAILY_BRIEF_PROMPT_REVISION, generateDailyBrief } from "@/lib/services/daily-brief-consumer";
import { DAILY_BRIEF_MODEL } from "@/lib/services/daily-brief-openai";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const caller = { client: {}, user: { id: "owner" } } as CalendarCaller;
const prefs = { enabled: true, includeCalendar: false, includeReminderHistory: false, includeNotes: false, revision: 1, calendarConnectionGeneration: null, calendarSelectionRevision: null };
const preset = (version: "1.1" | "1.2") => BRIEFING_PRESETS.find((item) => item.config.recipe.version === version)!.config;

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("OPENAI_API_KEY", "synthetic-key");
  mocks.read.mockResolvedValue(prefs);
  mocks.begin.mockResolvedValue({ state: "acquired", leaseToken: "lease", localDate: fixture.localDate });
  mocks.finish.mockResolvedValue(true);
  mocks.current.mockResolvedValue(undefined);
  mocks.prepare.mockImplementation(async (_caller, options) => ({ contexts: [fixture], assertCurrent: mocks.current, configurationRefs: {}, preferences: options.preferences }));
  mocks.tipHistory.mockResolvedValue([]);
  mocks.recordTip.mockResolvedValue(true);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

/** Runs `/api/advisor/brief`'s service with the real OpenAI adapter and returns the exact request bodies it sent. */
async function productionBodies(config?: BriefingConfig): Promise<string[]> {
  mocks.config.mockReturnValue(config);
  const bodies: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    expect(String(url)).toBe("https://api.openai.com/v1/responses");
    bodies.push(init!.body as string);
    return Response.json({ status: "completed", output: [{ type: "message", role: "assistant", status: "completed",
      content: [{ type: "output_text", text: JSON.stringify({ text: "Make room for your planned walk.", occurrenceRefs: [], suggestions: [], tip: null }) }] }] });
  }));
  await requestInAppDailyBrief(caller, { installationId: "11111111-1111-4111-8111-111111111111", retry: false },
    { now: () => Temporal.Instant.from(fixture.capturedAt) }).catch(() => undefined);
  return bodies;
}

describe("pinned production generation (Ticket 290)", () => {
  it("keeps the prompt revision value", () => {
    expect(DAILY_BRIEF_PROMPT_REVISION).toBe("5588d260d8e145ad");
  });

  it("sends the same request body from the production path as before Ticket 290", async () => {
    const hashes: string[] = [];
    for (const config of [undefined, preset("1.1"), preset("1.2")]) {
      const bodies = await productionBodies(config);
      expect(bodies).toHaveLength(1);
      const body = JSON.parse(bodies[0]!);
      expect(body.model).toBe(DAILY_BRIEF_MODEL);
      expect(body.reasoning).toEqual({ effort: "low" });
      hashes.push(sha(bodies[0]!));
    }
    expect(hashes).toEqual([
      "203330927b3fc0e3034e81a003667f7cbf746fe2721ea539647f20067ff1cded",
      "e6e17fb33c4e7161b180231df2eb5a56d93aa29e0dfb09873b561d4e0721a33d",
      "0555944f7d104df2384a9e69408539f760ee93abfe6ceab1fb918c8a769426d2",
    ]);
  });

  it("builds the same instructions in the consumer for every recipe, fixture and flag", async () => {
    const presets = BRIEFING_PRESETS.map((item) => item.config);
    const laneFree = presets.filter((config) => config.recipe.version !== "1.0")
      .map((config) => parseBriefingConfig({ ...config, analysis: { ...config.analysis, lanes: [], maxTips: 0 } }));
    const all: string[] = [];
    for (const config of [...presets, ...laneFree]) {
      for (const context of [...BRIEFING_FIXTURE_IDS.map((id) => briefingFixture(id, config)), connectorDayContext()]) {
        await generateDailyBrief(context, { config, now: () => Temporal.Instant.from(context.capturedAt), signal: new AbortController().signal,
          generate: async (input) => { all.push(input.instructions); return {}; } }).catch(() => undefined);
      }
    }
    expect(all.length).toBeGreaterThan(20);
    expect(sha(all.join("\0"))).toBe("9b02eab2c72fbcca7c3c64f586cb7ed4f69a6e250ee984dbea081a595dd3e532");
  }, 120_000);
});
