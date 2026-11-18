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
// Updated Nov 16, 2026 (owner-approved plain-words rules from the model-graded eval, PR #293).
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
import { DAILY_BRIEF_MODEL } from "@/lib/services/daily-brief-model";
import { DAILY_BRIEF_SCHEMA, DAILY_BRIEF_SCHEMA_NAME } from "@/lib/services/daily-brief-schema";
import { dailyBriefRequestBody } from "../scripts/chatgpt-plan-spike-hosted-adapter";
import { responsesReply } from "./helpers/model-responses";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const caller = { client: {}, user: { id: "owner" } } as CalendarCaller;
import { dailyBriefPreferences } from "./helpers/daily-brief-preferences";
const prefs = dailyBriefPreferences({ revision: 1 });
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

/** Runs `/api/advisor/brief`'s service with the real model adapter and returns the exact request bodies it sent. */
async function productionBodies(config?: BriefingConfig): Promise<string[]> {
  mocks.config.mockReturnValue(config);
  const bodies: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    expect(String(url)).toBe("https://api.openai.com/v1/responses");
    bodies.push(init!.body as string);
    return Response.json(responsesReply({ text: "Make room for your planned walk.", occurrenceRefs: [], suggestions: [], tip: null }));
  }));
  await requestInAppDailyBrief(caller, { installationId: "11111111-1111-4111-8111-111111111111", retry: false },
    { now: () => Temporal.Instant.from(fixture.capturedAt) }).catch(() => undefined);
  return bodies;
}

/**
 * Phase 1B: the AI SDK builds a different wire body, so the pin is now on what the model
 * reads. The instructions and facts are put back into the pre-1B body builder; its hash
 * must equal the hash pinned before Ticket 290. Same text, same model, same effort.
 */
function asPreAiSdkBody(body: string): string {
  const parsed = JSON.parse(body);
  const instructions = parsed.input.find((item: { role: string }) => item.role === "developer").content as string;
  const facts = parsed.input.find((item: { role: string }) => item.role === "user").content[0].text as string;
  return dailyBriefRequestBody({ instructions, facts, signal: new AbortController().signal }, DAILY_BRIEF_SCHEMA_NAME, DAILY_BRIEF_SCHEMA,
    { model: parsed.model, effort: parsed.reasoning.effort });
}

describe("pinned production generation (Ticket 290)", () => {
  it("keeps the prompt revision value", () => {
    expect(DAILY_BRIEF_PROMPT_REVISION).toBe("5fdc1c2ec78153e9");
  });

  it("sends the same request body from the production path as before Ticket 290", async () => {
    const hashes: string[] = [];
    for (const config of [undefined, preset("1.1"), preset("1.2")]) {
      const bodies = await productionBodies(config);
      expect(bodies).toHaveLength(1);
      const body = JSON.parse(bodies[0]!);
      expect(`openai/${body.model}`).toBe(DAILY_BRIEF_MODEL);
      expect(body.reasoning).toEqual({ effort: "low" });
      expect(body).toMatchObject({ store: false, max_output_tokens: 2_000, text: { format: { type: "json_schema", strict: true, name: DAILY_BRIEF_SCHEMA_NAME, schema: DAILY_BRIEF_SCHEMA } } });
      expect(body.tools).toBeUndefined();
      hashes.push(sha(asPreAiSdkBody(bodies[0]!)));
    }
    expect(hashes).toEqual([
      "f0191748c97b32c58d73822fe2070c640a42cca5b9249dbac0e471d44c00c554",
      "121be422cd65edd8fdbc6e25a950737a516a4427b9f145c9b8bf064f6d8985c6",
      "013197ab2ea5c6d7c7eeace7c45655f50ad2e1c92e99c7dd854ceccd5daf3183",
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
    expect(sha(all.join("\0"))).toBe("10c295dca3a5882d0e292942a79c079714889d6cffb4d4e8fdd0db7b3a3b1618");
  }, 120_000);
});
