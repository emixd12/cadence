import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import { BRIEFING_PRESETS, parseBriefingConfig } from "@cadence/core/services/briefing-config";
import { BRIEFING_FIXTURE_IDS, briefingFixture } from "@/lib/services/briefing-fixtures";
import { connectorDayContext } from "./helpers/connector-day-context";
import type { CalendarCaller } from "@/lib/services/google-calendar.service";
import fixture from "./fixtures/advisor-day-context.valid.json";

// Production stays pinned to DAILY_BRIEF_MODEL, effort "low" and a known prompt. Any byte
// change to the instructions or schema fails these tests, so a prompt change is always a
// reviewed, deliberate edit here.
// Advisor plan Phase 3 (3A2, Nov 18, 2026): the hosted brief now sends the short opening
// prompt (brief-opening.ts) in place of the ~38 KB layered prompt. The layered prompt still
// serves the workbench and the paused device path; its hash below changed once more because
// "Suggestions never change the record." left briefing-references.json (Emi, Phase 3).
const mocks = vi.hoisted(() => ({ read: vi.fn(), begin: vi.fn(), finish: vi.fn(), saveBrief: vi.fn(), prepare: vi.fn(), current: vi.fn(), config: vi.fn(), plan: vi.fn(), proposals: vi.fn() }));
vi.mock("@/lib/db/daily-brief.repo", () => ({ readDailyBriefPreferences: mocks.read, saveDailyBriefPreferences: vi.fn(), beginDailyBrief: mocks.begin, finishDailyBrief: mocks.finish,
  saveDailyBrief: mocks.saveBrief }));
vi.mock("@/lib/services/brief-moves.service", () => ({ planBriefMoveLines: mocks.plan, saveBriefProposals: mocks.proposals, readBriefMoves: vi.fn(), readOpenBriefConflicts: vi.fn(async () => []), ensureBehaviorEstimates: vi.fn() }));
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
import { generateDailyBrief } from "@/lib/services/daily-brief-consumer";
import { DAILY_BRIEF_MODEL } from "@/lib/services/daily-brief-model";
import { BRIEF_OPENING_INSTRUCTIONS, BRIEF_OPENING_PROMPT_REVISION, BRIEF_OPENING_SCHEMA, BRIEF_OPENING_SCHEMA_NAME } from "@/lib/services/brief-opening";
import { responsesReply } from "./helpers/model-responses";
import { dailyBriefPreferences } from "./helpers/daily-brief-preferences";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const caller = { client: {}, user: { id: "owner" } } as CalendarCaller;
const prefs = dailyBriefPreferences({ revision: 1 });
const candidate = {
  key: "line_1", occurrenceId: "occ-1", behaviorId: "beh-1", behaviorRevision: "r", title: fixture.cadence.occurrences[0]!.title,
  localDate: fixture.localDate, timezone: fixture.timezone, expectedRevision: "r",
  from: { startAt: "2026-09-20T16:30:00Z", endAt: "2026-09-20T17:00:00Z" }, to: { startAt: "2026-09-20T18:00:00Z", endAt: "2026-09-20T18:30:00Z" },
  length: { minutes: 30, source: "behavior_duration", assumed: false }, reasonCode: "calendar_overlap", reason: "It runs into Team sync.",
  anchor: { kind: "calendar_event", title: "Team sync" }, otherTimes: [], travel: "not_needed", late: false, offerNeverMove: false,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("OPENAI_API_KEY", "synthetic-key");
  mocks.read.mockResolvedValue(prefs);
  mocks.begin.mockResolvedValue({ state: "acquired", leaseToken: "lease", localDate: fixture.localDate, refresh: false, refreshesUsed: 0 });
  mocks.finish.mockResolvedValue(true);
  mocks.saveBrief.mockResolvedValue(true);
  mocks.current.mockResolvedValue(undefined);
  mocks.prepare.mockImplementation(async (_caller, options) => ({ contexts: [fixture], assertCurrent: mocks.current, configurationRefs: {}, preferences: options.preferences }));
  mocks.plan.mockResolvedValue({ candidates: [candidate], calendar: "current" });
  mocks.proposals.mockImplementation(async (_client, value) => value.lines.map(({ key: _key, ...line }: typeof candidate) => ({ ...line, proposalId: "p-1", status: "proposed", moveId: null })));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

/** Runs `/api/advisor/brief`'s service with the real model adapter and returns the exact request bodies it sent. */
async function productionBodies(features: readonly string[] = ["move_lines_v1"]): Promise<string[]> {
  const bodies: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    expect(String(url)).toBe("https://api.openai.com/v1/responses");
    bodies.push(init!.body as string);
    return Response.json(responsesReply({ opening: "Walk needs a new time today.", reasons: [{ key: "line_1", text: "It runs into your Team sync." }] }));
  }));
  await requestInAppDailyBrief(caller, { installationId: "11111111-1111-4111-8111-111111111111", retry: false, features },
    { now: () => Temporal.Instant.from(fixture.capturedAt) }).catch(() => undefined);
  return bodies;
}

describe("pinned production generation", () => {
  it("keeps the brief prompt revision value", () => {
    expect(BRIEF_OPENING_PROMPT_REVISION).toBe(sha(`${BRIEF_OPENING_INSTRUCTIONS}\0${JSON.stringify(BRIEF_OPENING_SCHEMA)}`).slice(0, 16));
    expect(BRIEF_OPENING_PROMPT_REVISION).toBe("682cac22099e71e0");
  });

  it("sends one short request with the pinned model, effort, schema and instructions", async () => {
    const bodies = await productionBodies();
    expect(bodies).toHaveLength(1);
    const body = JSON.parse(bodies[0]!);
    expect(`openai/${body.model}`).toBe(DAILY_BRIEF_MODEL);
    expect(body.reasoning).toEqual({ effort: "low" });
    expect(body).toMatchObject({ store: false, text: { format: { type: "json_schema", strict: true, name: BRIEF_OPENING_SCHEMA_NAME, schema: BRIEF_OPENING_SCHEMA } } });
    expect(body.tools).toBeUndefined();
    const instructions = body.input.find((item: { role: string }) => item.role === "developer").content as string;
    expect(instructions).toBe(BRIEF_OPENING_INSTRUCTIONS);
    // The 38 KB layered prompt is gone from the hosted brief; the whole request stays small.
    expect(bodies[0]!.length).toBeLessThan(12_000);
  });

  it("makes no model call for a quiet day, for any client", async () => {
    mocks.plan.mockResolvedValue({ candidates: [], calendar: "current" });
    expect(await productionBodies()).toHaveLength(0);
    expect(await productionBodies([])).toHaveLength(0);
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
