// Ticket 360 (D33): the Daily Brief's one alongside question, saved with the brief.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import type { CalendarCaller } from "@/lib/services/google-calendar.service";
import fixture from "./fixtures/advisor-day-context.valid.json";
import { dailyBriefPreferences } from "./helpers/daily-brief-preferences";
const mocks = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), begin: vi.fn(), finish: vi.fn(), saveBrief: vi.fn(), timezone: vi.fn(), prepare: vi.fn(), current: vi.fn(), calendar: vi.fn(), config: vi.fn(),
  outlook: vi.fn(), hevy: vi.fn(), icloud: vi.fn(), plan: vi.fn(), proposals: vi.fn(), readMoves: vi.fn(), conflicts: vi.fn(async (): Promise<unknown[]> => []), estimates: vi.fn() }));
vi.mock("@/lib/services/outlook-calendar.service", () => ({ getOutlookCalendarConnection: mocks.outlook }));
vi.mock("@/lib/services/hevy.service", () => ({ getHevyConnection: mocks.hevy }));
vi.mock("@/lib/services/icloud-calendar.service", () => ({ getIcloudCalendarConnection: mocks.icloud }));
vi.mock("@/lib/db/daily-brief.repo", () => ({ readDailyBriefPreferences: mocks.read, saveDailyBriefPreferences: mocks.save, beginDailyBrief: mocks.begin, finishDailyBrief: mocks.finish,
  saveDailyBrief: mocks.saveBrief }));
vi.mock("@/lib/services/brief-moves.service", () => ({ planBriefMoveLines: mocks.plan, saveBriefProposals: mocks.proposals, readBriefMoves: mocks.readMoves, readOpenBriefConflicts: mocks.conflicts, ensureBehaviorEstimates: mocks.estimates }));
vi.mock("@/lib/services/briefing-pipeline", async (original) => {
  const actual = await original<typeof import("@/lib/services/briefing-pipeline")>();
  const active = () => mocks.config() ?? actual.activeBriefingConfig();
  return { ...actual, activeBriefingConfig: active, briefingConfigurationRevision: (value?: unknown) => actual.briefingConfigurationRevision(value ?? active()) };
});
vi.mock("@/lib/db/advisor-context.repo", () => ({ readAdvisorProfileTimezone: mocks.timezone }));
vi.mock("@/lib/services/briefing-account-context.service", () => ({
  briefingAccountRef: (userId: string) => `account-${userId}`,
  prepareAccountBriefingContexts: mocks.prepare,
}));
vi.mock("@/lib/services/google-calendar.service", () => ({ getCalendarConnection: mocks.calendar }));
const alongside = vi.hoisted(() => ({ plan: vi.fn(), reopen: vi.fn() }));
vi.mock("@/lib/services/brief-alongside.service", () => ({ planBriefAlongsideQuestion: alongside.plan, reopenBriefAlongsideQuestion: alongside.reopen }));
import { requestInAppDailyBrief } from "@/lib/services/daily-brief.service";
const caller = { client: {}, user: { id: "owner" } } as CalendarCaller;
const plain = { installationId: "11111111-1111-4111-8111-111111111111", retry: false };
const input = { ...plain, features: ["move_lines_v1"] };
const prefs = dailyBriefPreferences({ revision: 1 });
const now = () => Temporal.Instant.from(fixture.capturedAt);
const generate = vi.fn();
const walk = fixture.cadence.occurrences[0];
const candidate = {
  key: "line_1", occurrenceId: "occ-1", behaviorId: "beh-1", behaviorRevision: "2026-11-01T10:00:00Z", title: walk.title,
  localDate: fixture.localDate, timezone: fixture.timezone, expectedRevision: "2026-11-01T10:00:00Z",
  from: { startAt: "2026-09-20T16:30:00Z", endAt: "2026-09-20T17:00:00Z" }, to: { startAt: "2026-09-20T18:00:00Z", endAt: "2026-09-20T18:30:00Z" },
  length: { minutes: 30, source: "fallback", assumed: true }, reasonCode: "calendar_overlap", reason: "It runs into Team sync.",
  anchor: { kind: "calendar_event", title: "Team sync" }, otherTimes: [], travel: "not_needed", late: false, offerNeverMove: false,
} as const;
const stored = (lines: readonly (typeof candidate & { reason: string })[]) => lines.map(({ key, ...line }) => ({ ...line, proposalId: `9d0f6c3e-0000-4000-8000-00000000000${key.slice(-1)}`, status: "proposed", moveId: null }));
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("OPENAI_API_KEY", "synthetic-key");
  mocks.read.mockResolvedValue(prefs);
  mocks.begin.mockResolvedValue({ state: "acquired", leaseToken: "lease", localDate: fixture.localDate, refresh: false, refreshesUsed: 0 });
  mocks.finish.mockResolvedValue(true);
  mocks.saveBrief.mockResolvedValue(true);
  mocks.calendar.mockResolvedValue({ status: "disconnected", generation: 0, selectionRevision: 0, preferences: { selectedCalendarIds: [] } });
  mocks.timezone.mockResolvedValue(fixture.timezone);
  mocks.current.mockResolvedValue(undefined);
  mocks.prepare.mockImplementation(async (_caller, options) => ({
    contexts: [fixture],
    assertCurrent: mocks.current,
    configurationRefs: {},
    preferences: options.preferences,
  }));
  mocks.conflicts.mockResolvedValue([]);
  mocks.plan.mockResolvedValue({ candidates: [candidate], calendar: "current" });
  mocks.proposals.mockImplementation(async (_client, value) => stored(value.lines));
  mocks.estimates.mockResolvedValue(undefined);
  generate.mockResolvedValue({ opening: "Walk needs a new time today.", reasons: [{ key: "line_1", text: "It runs into your {event}." }] });
});

const question = { behaviorId: "11111111-2222-4333-8444-555555555555", title: "Red light helmet" };
const withQuestion = { ...input, features: ["move_lines_v1", "alongside_question_v1"] };
const day = { items: [{ behaviorId: question.behaviorId, title: question.title, localDate: fixture.localDate, start: Temporal.Instant.from("2026-09-20T20:00:00Z") }] };
afterEach(() => { vi.unstubAllEnvs(); });

describe("Daily Brief alongside question", () => {
  beforeEach(() => {
    mocks.plan.mockResolvedValue({ candidates: [candidate], calendar: "current", day });
    alongside.plan.mockResolvedValue(question);
  });

  it("flag on and asked for: picks one question from the day, saves it with the brief and shows it", async () => {
    vi.stubEnv("CADENCE_ALONGSIDE", "on");
    const result = await requestInAppDailyBrief(caller, withQuestion, { generate, now });
    expect(alongside.plan).toHaveBeenCalledExactlyOnceWith(caller.client, "owner", { localDate: fixture.localDate, items: day.items });
    expect(mocks.saveBrief.mock.calls[0]![1].briefing).toMatchObject({ alongsideQuestion: question });
    expect(result).toMatchObject({ state: "ready", briefing: { alongsideQuestion: question } });
  });

  it("flag off, or a client that did not ask: nothing is read and the brief is as before", async () => {
    const before = await requestInAppDailyBrief(caller, input, { generate, now });
    const asked = await requestInAppDailyBrief(caller, withQuestion, { generate, now });
    vi.stubEnv("CADENCE_ALONGSIDE", "on");
    const notAsked = await requestInAppDailyBrief(caller, input, { generate, now });
    expect(alongside.plan).not.toHaveBeenCalled();
    for (const call of mocks.saveBrief.mock.calls) expect(call[1].briefing).not.toHaveProperty("alongsideQuestion");
    for (const result of [asked, notAsked]) expect(JSON.stringify(result)).toBe(JSON.stringify(before));
  });

  it("a failed read asks nothing and still shows the brief", async () => {
    vi.stubEnv("CADENCE_ALONGSIDE", "on");
    alongside.plan.mockRejectedValue(new Error("read failed"));
    const result = await requestInAppDailyBrief(caller, withQuestion, { generate, now });
    expect(result).toMatchObject({ state: "ready" });
    expect((result as { briefing: object }).briefing).not.toHaveProperty("alongsideQuestion");
  });

  const saved = { text: "Walk needs a new time today.", localDate: fixture.localDate, timezone: fixture.timezone, generatedAt: fixture.capturedAt,
    expiresAt: fixture.dayEndAt, coverage: "complete", warnings: [] };

  it("reopen: the saved question returns while open, and never to a client that did not ask", async () => {
    vi.stubEnv("CADENCE_ALONGSIDE", "on");
    mocks.begin.mockResolvedValue({ state: "saved", briefing: { ...saved, alongsideQuestion: question }, runId: "run-1", withMoves: false, refreshesUsed: 0, localDate: fixture.localDate });
    alongside.reopen.mockResolvedValue(question);
    expect(await requestInAppDailyBrief(caller, withQuestion, { generate, now })).toMatchObject({ briefing: { alongsideQuestion: question } });
    expect(alongside.reopen).toHaveBeenCalledWith(caller.client, "owner", { localDate: fixture.localDate, saved: question });
    alongside.reopen.mockResolvedValue(null);
    expect((await requestInAppDailyBrief(caller, withQuestion, { generate, now }) as { briefing: object }).briefing).not.toHaveProperty("alongsideQuestion");
    alongside.reopen.mockClear();
    expect((await requestInAppDailyBrief(caller, input, { generate, now }) as { briefing: object }).briefing).not.toHaveProperty("alongsideQuestion");
    vi.stubEnv("CADENCE_ALONGSIDE", "");
    expect((await requestInAppDailyBrief(caller, withQuestion, { generate, now }) as { briefing: object }).briefing).not.toHaveProperty("alongsideQuestion");
    expect(alongside.reopen).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });
});
