import { beforeEach, describe, expect, it, vi } from "vitest";
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
import { requestInAppDailyBrief, updateDailyBriefSettings } from "@/lib/services/daily-brief.service";
import { DailyBriefError } from "@/lib/services/daily-brief-consumer";
import { BRIEF_QUIET_OPENING } from "@/lib/services/brief-opening";
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

describe("first-party daily briefing service", () => {
  it("passes the admitted preferences and local date to the shared account snapshot", async () => {
    await requestInAppDailyBrief(caller, input, { generate, now });
    expect(mocks.prepare).toHaveBeenCalledWith(caller, expect.objectContaining({
      historyDays: [90],
      includeCalendar: true,
      includeRecordedElapsedDurations: false,
      localDate: fixture.localDate,
      preferences: prefs,
      signal: expect.any(AbortSignal),
    }));
  });
  it("passes an optional travel token and the server's signing secrets only to the live snapshot (Ticket 219 Option A)", async () => {
    vi.stubEnv("TRAVEL_CONCLUSIONS_SIGNING_SECRET", "test-only-conclusions-secret-0123456789");
    try {
      await expect(requestInAppDailyBrief(caller, { ...input, travelConclusions: "signed.token" }, { generate, now })).resolves.toMatchObject({ state: "ready" });
      expect(mocks.prepare).toHaveBeenLastCalledWith(caller, expect.objectContaining({
        travelConclusions: { token: "signed.token", secrets: { current: "test-only-conclusions-secret-0123456789", previous: null } } }));
      // A malformed token is passed on for verification to reject; it never fails the request.
      await expect(requestInAppDailyBrief(caller, { ...input, travelConclusions: 42 }, { generate, now })).resolves.toMatchObject({ state: "ready" });
      await requestInAppDailyBrief(caller, input, { generate, now });
      expect(mocks.prepare).toHaveBeenLastCalledWith(caller, expect.objectContaining({ travelConclusions: expect.objectContaining({ token: null }) }));
      await expect(requestInAppDailyBrief(caller, { ...input, travelConclusions: "x", conclusions: "y" }, { generate, now })).rejects.toMatchObject({ code: "invalid_request" });
    } finally { vi.unstubAllEnvs(); }
  });

  it("plans lines, writes the words once, stores proposals, then saves the brief, which completes the lease", async () => {
    const result = await requestInAppDailyBrief(caller, input, { generate, now });
    expect(mocks.begin).toHaveBeenCalledWith(caller.client, { ...plain, expectedRevision: 1, refresh: false, moves: true }, expect.any(AbortSignal));
    expect(generate).toHaveBeenCalledTimes(1);
    expect(mocks.current).toHaveBeenCalledTimes(2);
    expect(mocks.proposals).toHaveBeenCalledWith(null, expect.objectContaining({ refresh: false, localDate: fixture.localDate,
      lines: [expect.objectContaining({ key: "line_1", reason: "It runs into your Team sync." })] }));
    expect(mocks.saveBrief).toHaveBeenCalledExactlyOnceWith(caller.client, expect.objectContaining({ leaseToken: "lease", refresh: false, withMoves: true,
      briefing: expect.objectContaining({ text: "Walk needs a new time today.", warnings: [] }) }), expect.any(AbortSignal));
    // The saved copy holds no move lines; they are rebuilt from the proposals on reopen.
    expect(mocks.saveBrief.mock.calls[0]![1].briefing).not.toHaveProperty("moves");
    expect(mocks.finish).not.toHaveBeenCalledWith(caller.client, expect.objectContaining({ success: true }), expect.anything());
    expect(result).toMatchObject({ state: "ready", briefing: { text: "Walk needs a new time today.", expiresAt: fixture.dayEndAt,
      refresh: { remaining: 2, available: true },
      moves: { version: "1", acceptAll: false, lines: [expect.objectContaining({ title: walk.title, reason: "It runs into your Team sync.", status: "proposed" })] } } });
    expect(JSON.stringify(result)).not.toMatch(/Suggestions only|No changes were applied/);
  });

  it("makes no model call on a quiet day and shows the stock opening", async () => {
    mocks.plan.mockResolvedValue({ candidates: [], calendar: "current" });
    const result = await requestInAppDailyBrief(caller, input, { generate, now });
    expect(generate).not.toHaveBeenCalled();
    expect(result).toMatchObject({ state: "ready", briefing: { text: BRIEF_QUIET_OPENING, moves: { lines: [] } } });
    expect(mocks.saveBrief).toHaveBeenCalledOnce();
  });

  it("gives clients from before Phase 3 a true opening only: no lines and no proposals", async () => {
    generate.mockRejectedValue(new DailyBriefError("advisor_unavailable", undefined, "provider_error"));
    const result = await requestInAppDailyBrief(caller, plain, { generate, now });
    expect(mocks.begin).toHaveBeenCalledWith(caller.client, expect.objectContaining({ moves: false }), expect.any(AbortSignal));
    // Cadence still plans the day, so the opening never says nothing needs moving when something does.
    expect(mocks.plan).toHaveBeenCalled();
    expect(mocks.proposals).not.toHaveBeenCalled();
    expect(result).toMatchObject({ state: "ready", briefing: { text: `${walk.title} could use a different time today.` } });
    expect(result.state === "ready" && result.briefing).not.toHaveProperty("moves");
    expect(mocks.saveBrief).toHaveBeenCalledWith(caller.client, expect.objectContaining({ withMoves: false }), expect.any(AbortSignal));
  });

  it("shows today's open schedule-change conflicts in the first brief", async () => {
    mocks.plan.mockResolvedValue({ candidates: [], calendar: "current" });
    const conflict = { conflictId: "c1", occurrenceId: "o1", behaviorId: "b1", title: "Stretch", expectedRevision: 1,
      at: { startAt: "2026-11-18T17:00:00Z", endAt: "2026-11-18T17:30:00Z" }, conflictingTitle: "Lunch" };
    mocks.conflicts.mockResolvedValue([conflict]);
    generate.mockRejectedValue(new DailyBriefError("advisor_unavailable", undefined, "provider_error"));
    const result = await requestInAppDailyBrief(caller, input, { generate, now });
    expect(generate).toHaveBeenCalled();
    expect(result).toMatchObject({ state: "ready", briefing: { text: expect.stringContaining("Stretch clashing"), moves: { conflicts: [{ conflictId: "c1" }] } } });
  });

  it("keeps each good sentence and falls back to stock text only where the model broke a rule", async () => {
    generate.mockResolvedValue({ opening: "Visit https://example.com now.", reasons: [{ key: "line_1", text: "It runs into your Team sync at 3:15 PM." }] });
    const result = await requestInAppDailyBrief(caller, input, { generate, now });
    expect(result).toMatchObject({ briefing: { text: `${walk.title} could use a different time today.`, moves: { lines: [{ reason: candidate.reason }] } } });
    expect(result.state === "ready" && result.briefing.notices).toBeUndefined();
  });

  it("shows the lines with stock text and a notice when the model fails or the budget is reached", async () => {
    generate.mockRejectedValue(new DailyBriefError("advisor_unavailable", undefined, "provider_error"));
    expect(await requestInAppDailyBrief(caller, input, { generate, now })).toMatchObject({ state: "ready", briefing: {
      moves: { lines: [{ reason: candidate.reason }] }, notices: [{ kind: "words_unavailable" }] } });
    generate.mockRejectedValue(new DailyBriefError("budget_reached", 3600, "budget_agent_share"));
    const result = await requestInAppDailyBrief(caller, input, { generate, now });
    expect(result).toMatchObject({ state: "ready", briefing: { notices: [{ kind: "budget_reached", until: expect.any(String) }] } });
    expect(result.state === "ready" && result.briefing.notices?.[0]?.text).toMatch(/limit.*Yes and Undo still work/);
  });

  it("says when the calendar did not load", async () => {
    mocks.plan.mockResolvedValue({ candidates: [], calendar: "stale" });
    expect(await requestInAppDailyBrief(caller, input, { generate, now })).toMatchObject({ briefing: { notices: [{ kind: "calendar_stale" }], moves: { calendar: "stale" } } });
  });

  it("reopens today's saved brief on any device with no model call and the lines' current answers", async () => {
    const saved = { text: "Walk needs a new time today.", localDate: fixture.localDate, timezone: fixture.timezone, generatedAt: fixture.capturedAt,
      expiresAt: fixture.dayEndAt, coverage: "complete", warnings: [] };
    mocks.begin.mockResolvedValue({ state: "saved", briefing: saved, runId: "run-1", withMoves: true, refreshesUsed: 1, localDate: fixture.localDate });
    const moves = { version: "1", localDate: fixture.localDate, timezone: fixture.timezone, runId: "run-1", lines: [], conflicts: [], acceptAll: false, undoAllBatchId: null, calendar: "current" };
    mocks.readMoves.mockResolvedValue(moves);
    expect(await requestInAppDailyBrief(caller, input, { generate, now })).toEqual({ state: "ready", briefing: { ...saved, moves, refresh: { remaining: 1, available: true } } });
    expect(mocks.readMoves).toHaveBeenCalledWith(caller.client, { localDate: fixture.localDate, timezone: fixture.timezone, runId: "run-1" });
    expect(generate).not.toHaveBeenCalled();
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.saveBrief).not.toHaveBeenCalled();
  });

  it("runs a refresh as a new brief that replaces the earlier one, and refuses past two a day", async () => {
    mocks.begin.mockResolvedValue({ state: "acquired", leaseToken: "lease", localDate: fixture.localDate, refresh: true, refreshesUsed: 1 });
    const result = await requestInAppDailyBrief(caller, { ...input, refresh: true }, { generate, now });
    expect(mocks.begin).toHaveBeenCalledWith(caller.client, expect.objectContaining({ refresh: true }), expect.any(AbortSignal));
    expect(mocks.proposals).toHaveBeenCalledWith(null, expect.objectContaining({ refresh: true }));
    expect(mocks.saveBrief).toHaveBeenCalledWith(caller.client, expect.objectContaining({ refresh: true }), expect.any(AbortSignal));
    expect(result).toMatchObject({ briefing: { refresh: { remaining: 0, available: false } } });
    mocks.begin.mockResolvedValue({ state: "refresh_limit_reached", refreshesUsed: 2 });
    await expect(requestInAppDailyBrief(caller, { ...input, refresh: true }, { generate, now })).rejects.toMatchObject({ code: "refresh_limit_reached" });
    await expect(requestInAppDailyBrief(caller, { ...input, refresh: "yes" }, { generate, now })).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("accepts the screen's calendar events for this request only and rejects malformed ones", async () => {
    const busy = [{ startAt: "2026-09-20T16:00:00Z", endAt: "2026-09-20T17:00:00Z", title: "Team sync" }];
    await requestInAppDailyBrief(caller, { ...input, calendarBusy: busy, travelTimes: "signed.times" }, { generate, now });
    expect(mocks.plan).toHaveBeenCalledWith(expect.objectContaining({ planning: { calendarBusy: busy, travelTimes: "signed.times" } }));
    expect(JSON.stringify(mocks.saveBrief.mock.calls[0]![1].briefing)).not.toContain("signed.times");
    for (const calendarBusy of [[{ startAt: "x", endAt: "y" }], [{ startAt: busy[0].endAt, endAt: busy[0].startAt }], [{ ...busy[0], extra: 1 }], "busy"]) {
      await expect(requestInAppDailyBrief(caller, { ...input, calendarBusy }, { generate, now })).rejects.toMatchObject({ code: "invalid_request" });
    }
  });
  it.each(["pending", "already_attempted"])("does not generate for %s", async (state) => {
    mocks.begin.mockResolvedValue({ state });
    expect(await requestInAppDailyBrief(caller, input, { generate, now })).toEqual({ state });
    expect(generate).not.toHaveBeenCalled();
  });
  it("returns the server's pending retry timing", async () => {
    mocks.begin.mockResolvedValue({ state: "pending", retryAfterSeconds: 42 });
    expect(await requestInAppDailyBrief(caller, input, { generate, now })).toEqual({ state: "pending", retryAfterSeconds: 42 });
  });
  it("reports an exhausted retry allowance without generating", async () => {
    mocks.begin.mockResolvedValue({ state: "retry_exhausted" });
    await expect(requestInAppDailyBrief(caller, { ...input, retry: true }, { generate, now })).rejects.toMatchObject({ code: "retry_exhausted" });
    expect(generate).not.toHaveBeenCalled();
    expect(mocks.finish).not.toHaveBeenCalled();
  });
  it("records phase diagnostics with codes but no prompt, facts or output", async () => {
    vi.stubEnv("CADENCE_PERF_LOG", "1");
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      generate.mockImplementation(() => new Promise(() => {}));
      await expect(requestInAppDailyBrief(caller, input, { generate, now, deadlineMs: 10 })).rejects.toMatchObject({ code: "timeout" });
      const events = info.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
      expect(events.map((event) => event.span)).toEqual(expect.arrayContaining([
        "daily_brief.preferences", "daily_brief.admission", "daily_brief.context", "daily_brief.request",
      ]));
      expect(events.find((event) => event.span === "daily_brief.request")).toMatchObject({ status: "error", error_code: "timeout" });
      const serialized = JSON.stringify(events);
      expect(serialized).not.toContain("walk");
      expect(serialized).not.toContain(fixture.cadence.occurrences[0].ref);
    } finally {
      info.mockRestore();
    }
  });
  it("requires server-owned enablement and current session before acquiring", async () => {
    mocks.read.mockResolvedValue({ ...prefs, enabled: false });
    await expect(requestInAppDailyBrief(caller, input, { generate, now })).rejects.toMatchObject({ code: "access_denied" });
    expect(mocks.begin).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });
  it("drops output when disclosure revision changes during the model call", async () => {
    generate.mockImplementation(async () => { mocks.current.mockRejectedValue(Object.assign(new Error("context_changed"), { code: "context_changed" })); return { opening: "A brief.", reasons: [] }; });
    await expect(requestInAppDailyBrief(caller, input, { generate, now })).rejects.toMatchObject({ code: "context_changed" });
    expect(mocks.saveBrief).not.toHaveBeenCalled();
  });
  it("never shows a brief it could not save", async () => {
    mocks.saveBrief.mockResolvedValue(false);
    await expect(requestInAppDailyBrief(caller, input, { generate, now })).rejects.toMatchObject({ code: "context_changed" });
    mocks.saveBrief.mockRejectedValue(new Error("storage"));
    await expect(requestInAppDailyBrief(caller, input, { generate, now })).rejects.toThrow("storage");
    expect(mocks.finish).toHaveBeenCalledWith(caller.client, expect.objectContaining({ success: false, leaseToken: "lease" }));
  });
  it("rejects Calendar scope changes before model disclosure", async () => {
    mocks.read.mockResolvedValue(dailyBriefPreferences({ revision: 1, allow: ["googleCalendar"] }));
    mocks.prepare.mockRejectedValue(Object.assign(new Error("context_changed"), { code: "context_changed" }));
    await expect(requestInAppDailyBrief(caller, input, { generate, now })).rejects.toMatchObject({ code: "context_changed" });
    expect(generate).not.toHaveBeenCalled();
  });
  it("stops at the request deadline and leaves no late result", async () => {
    generate.mockImplementation(() => new Promise(() => {}));
    await expect(requestInAppDailyBrief(caller, input, { generate, now, deadlineMs: 10 })).rejects.toMatchObject({ code: "timeout" });
    expect(mocks.saveBrief).not.toHaveBeenCalled();
  });
  it("maps older per-source saves to the one choice, excluding every source they leave off (Ticket 306)", async () => {
    mocks.timezone.mockResolvedValue(fixture.timezone);
    await updateDailyBriefSettings(caller, { enabled: true, includeCalendar: false, includeReminderHistory: true, includeNotes: true });
    expect(mocks.save).toHaveBeenLastCalledWith(caller.client, { enabled: true, useConnectedSources: false, excludedSources: none,
      includeReminderHistory: true, includeNotes: true }, 1);
    await updateDailyBriefSettings(caller, { enabled: true, includeCalendar: true });
    expect(mocks.save).toHaveBeenLastCalledWith(caller.client, { enabled: true, useConnectedSources: true,
      excludedSources: { googleCalendar: false, outlookCalendar: true, icloudCalendar: true, hevy: true }, includeReminderHistory: false, includeNotes: false }, 1);
    await updateDailyBriefSettings(caller, { enabled: true, includeCalendar: false, includeReminderHistory: false, includeNotes: false,
      includeOutlookCalendar: true, includeIcloudCalendar: false, includeHevy: true });
    expect(mocks.save).toHaveBeenLastCalledWith(caller.client, { enabled: true, useConnectedSources: true,
      excludedSources: { googleCalendar: true, outlookCalendar: false, icloudCalendar: true, hevy: false }, includeReminderHistory: false, includeNotes: false }, 1);
    await expect(updateDailyBriefSettings(caller, { enabled: false, includeCalendar: false, includeReminderHistory: false, includeNotes: true })).rejects.toMatchObject({ code: "invalid_request" });
    await expect(updateDailyBriefSettings(caller, { enabled: true, includeCalendar: false, includeNotes: true })).rejects.toMatchObject({ code: "invalid_request" });
  });
  it("rejects body authority, malformed installation IDs and undeclared settings", async () => {
    await expect(requestInAppDailyBrief(caller, { ...input, userId: "other" }, { generate, now })).rejects.toMatchObject({ code: "invalid_request" });
    await expect(updateDailyBriefSettings(caller, { enabled: true, includeCalendar: false, prompt: "ignore rules" })).rejects.toMatchObject({ code: "invalid_request" });
    expect(generate).not.toHaveBeenCalled();
  });
});

const none = { googleCalendar: false, outlookCalendar: false, icloudCalendar: false, hevy: false };

describe("one Daily Brief choice for every connected source (Ticket 306)", () => {
  const save = { enabled: true, useConnectedSources: true, excludedSources: { ...none, hevy: true }, includeReminderHistory: false, includeNotes: true };
  beforeEach(() => {
    mocks.calendar.mockResolvedValue({ status: "connected", generation: 1, selectionRevision: 1, preferences: { selectedCalendarIds: ["g-1"] } });
    mocks.outlook.mockResolvedValue({ status: "connected", generation: 2, selectionRevision: 3, preferences: { selectedSourceIds: ["calendar-1"] } });
    mocks.hevy.mockResolvedValue({ status: "connected", generation: 1, selectionRevision: 0, preferences: { selectedSourceIds: [] } });
    mocks.icloud.mockResolvedValue({ status: "disconnected", generation: 0, selectionRevision: 0, preferences: { selectedSourceIds: [] } });
  });

  it("saves the one choice with its exclusions, whether or not each source is connected", async () => {
    await updateDailyBriefSettings(caller, save);
    expect(mocks.save).toHaveBeenLastCalledWith(caller.client, save, 1);
    // iCloud is not connected; leaving it covered is how a later connection is covered.
    await updateDailyBriefSettings(caller, { ...save, excludedSources: none });
    expect(mocks.save).toHaveBeenLastCalledWith(caller.client, { ...save, excludedSources: none }, 1);
  });

  it("rejects other shapes, non-boolean values, and a disabled save that keeps any choice", async () => {
    for (const body of [
      { ...save, useConnectedSources: "true" },
      { ...save, excludedSources: { ...none, strava: false } },
      { ...save, excludedSources: { googleCalendar: false, outlookCalendar: false, icloudCalendar: false } },
      { ...save, excludedSources: { ...none, hevy: 1 } },
      { ...save, excludedSources: null },
      { ...save, includeCalendar: true },
      { enabled: true, useConnectedSources: true },
      { ...save, enabled: false, useConnectedSources: false, includeNotes: false },
      { ...save, enabled: false, excludedSources: none, includeNotes: false },
      { enabled: false, useConnectedSources: false, excludedSources: none, includeReminderHistory: false, includeNotes: true },
    ]) {
      await expect(updateDailyBriefSettings(caller, body)).rejects.toMatchObject({ code: "invalid_request" });
    }
    expect(mocks.save).not.toHaveBeenCalled();
    const off = { enabled: false, useConnectedSources: false, excludedSources: none, includeReminderHistory: false, includeNotes: false };
    await updateDailyBriefSettings(caller, off);
    expect(mocks.save).toHaveBeenLastCalledWith(caller.client, off, 1);
  });

  it("reports each source's status and which ones the brief uses, including a source connected after the choice", async () => {
    mocks.read.mockResolvedValue(dailyBriefPreferences({ revision: 1, allow: ["googleCalendar", "outlookCalendar", "icloudCalendar"] }));
    const { getDailyBriefSettings } = await import("@/lib/services/daily-brief.service");
    expect(await getDailyBriefSettings(caller)).toMatchObject({
      useConnectedSources: true, excludedSources: { ...none, hevy: true },
      sourceStatus: { googleCalendar: "ready", outlookCalendar: "ready", icloudCalendar: "not_connected", hevy: "ready" },
      // Older clients read these as per-source checkboxes.
      includeCalendar: true, includeOutlookCalendar: true, includeIcloudCalendar: false, includeHevy: false,
      connectorSources: { outlookCalendar: true, icloudCalendar: false, hevy: true },
      connectorAttention: { outlookCalendar: null, icloudCalendar: null, hevy: null },
    });
    // iCloud connects later: the choice already made covers it.
    mocks.icloud.mockResolvedValue({ status: "connected", generation: 4, selectionRevision: 2, preferences: { selectedSourceIds: ["ic_home"] } });
    expect(await getDailyBriefSettings(caller)).toMatchObject({ sourceStatus: { icloudCalendar: "ready" }, includeIcloudCalendar: true });
  });

  it("reads Google Calendar status from the Timeline connection only after the Ticket 307 migration", async () => {
    const { getDailyBriefSettings } = await import("@/lib/services/daily-brief.service");
    mocks.read.mockResolvedValue(dailyBriefPreferences({ revision: 1, allow: ["googleCalendar"] }));
    expect(await getDailyBriefSettings(caller)).toMatchObject({ sourceStatus: { googleCalendar: "ready" }, includeCalendar: true });
    expect(mocks.calendar).toHaveBeenLastCalledWith(caller);
    mocks.calendar.mockClear();
    mocks.read.mockResolvedValue(dailyBriefPreferences({ revision: 1, allow: ["googleCalendar"], googleCalendarSource: null }));
    expect(await getDailyBriefSettings(caller)).toMatchObject({ sourceStatus: { googleCalendar: "not_connected" }, includeCalendar: false });
    expect(mocks.calendar).not.toHaveBeenCalled();
  });

  it("reports a calendar with nothing selected, an unreadable status, and nothing used while the choice is off", async () => {
    mocks.outlook.mockResolvedValue({ status: "connected", generation: 2, selectionRevision: 3, preferences: { selectedSourceIds: [] } });
    mocks.hevy.mockRejectedValue(new Error("status unavailable"));
    mocks.calendar.mockResolvedValue({ status: "reconnect_required", generation: 1, selectionRevision: 1, preferences: { selectedCalendarIds: ["g-1"] } });
    const { getDailyBriefSettings } = await import("@/lib/services/daily-brief.service");
    expect(await getDailyBriefSettings(caller)).toMatchObject({
      useConnectedSources: false,
      sourceStatus: { googleCalendar: "not_connected", outlookCalendar: "no_calendars", icloudCalendar: "not_connected", hevy: "not_connected" },
      includeCalendar: false, includeOutlookCalendar: false, includeHevy: false,
    });
  });

  it("asks only the live brief for disclosed sources, ending provider reads before the generation reserve", async () => {
    const started = Date.now();
    await requestInAppDailyBrief(caller, input, { generate, now });
    const options = mocks.prepare.mock.calls[0]![1];
    expect(options.connectorSources).toMatchObject({ calendars: true, recordedActivity: true });
    expect(options.connectorSources.deadlineAt).toBeGreaterThanOrEqual(started + 50_000);
    expect(options.connectorSources.deadlineAt).toBeLessThanOrEqual(Date.now() + 50_000);
    mocks.prepare.mockClear();
    await requestInAppDailyBrief(caller, input, { generate, now, deadlineMs: 20_000 });
    expect(mocks.prepare.mock.calls[0]![1].connectorSources.deadlineAt).toBeLessThanOrEqual(Date.now() + 10_000);
  });

  it("sends the model only the lines and today's items and busy times: no recorded activity, no event details, no travel times", async () => {
    const { connectorDayContext } = await import("./helpers/connector-day-context");
    const context = connectorDayContext();
    mocks.prepare.mockImplementation(async (_caller, options) => ({ contexts: [context], assertCurrent: mocks.current, configurationRefs: {}, preferences: options.preferences }));
    const result = await requestInAppDailyBrief(caller, { ...input, travelTimes: "signed.times" }, { generate, now });
    expect(result).toMatchObject({ state: "ready", briefing: { coverage: "complete" } });
    const call = generate.mock.calls[0]![0] as { instructions: string; facts: string };
    const facts = JSON.parse(call.facts);
    expect(Object.keys(facts).sort()).toEqual(["conflicts", "day", "lines", "now", "today"]);
    expect(facts.lines).toEqual([expect.objectContaining({ key: "line_1", with: "{event}", why: "calendar_overlap" })]);
    expect(call.facts).not.toMatch(/Team sync|Private review|hevy|routine|exercise|signed\.times|outlook|ref_/i);

    // A withdrawn disclosure or changed connection after generation never delivers text.
    generate.mockImplementation(async () => { mocks.current.mockRejectedValue(Object.assign(new Error("context_changed"), { code: "context_changed" })); return { opening: "A brief.", reasons: [] }; });
    await expect(requestInAppDailyBrief(caller, input, { generate, now })).rejects.toMatchObject({ code: "context_changed" });
  });
});

describe("Ticket 288 model span usage", () => {
  const events = (info: { mock: { calls: unknown[][] } }) => info.mock.calls.map(([line]) => JSON.parse(line as string)).filter((event) => event.span === "daily_brief.model");

  it("records the usage counts on a successful daily_brief.model span and never in the response", async () => {
    vi.stubEnv("CADENCE_PERF_LOG", "1");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      generate.mockImplementation(async (request: { onUsage?: (usage: object) => void }) => {
        request.onUsage?.({ inputTokens: 1200, cachedInputTokens: 300, outputTokens: 150, reasoningTokens: 64 });
        return { opening: "Walk needs a new time today.", reasons: [{ key: "line_1", text: "It runs into your Team sync." }] };
      });
      const result = await requestInAppDailyBrief(caller, input, { generate, now });
      expect(result.state).toBe("ready");
      expect(JSON.stringify(result)).not.toMatch(/tokens|usage/i);
      expect(events(info)).toEqual([expect.objectContaining({ status: "success",
        counts: { usage_calls: 1, input_tokens: 1200, cached_input_tokens: 300, output_tokens: 150, reasoning_tokens: 64 } })]);
    } finally { info.mockRestore(); vi.unstubAllEnvs(); }
  });

  it("keeps the usage of a call whose words fell back to stock text", async () => {
    vi.stubEnv("CADENCE_PERF_LOG", "1");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      generate.mockImplementation(async (request: { onUsage?: (usage: object) => void }) => {
        request.onUsage?.({ inputTokens: 900, cachedInputTokens: null, outputTokens: 400, reasoningTokens: null });
        return { opening: "word ".repeat(200), reasons: [] };
      });
      expect(await requestInAppDailyBrief(caller, input, { generate, now })).toMatchObject({ state: "ready", briefing: { text: `${walk.title} could use a different time today.` } });
      const [event] = events(info);
      expect(event).toMatchObject({ status: "success", counts: { usage_calls: 1, input_tokens: 900, output_tokens: 400 } });
      expect(event.counts).not.toHaveProperty("cached_input_tokens");
    } finally { info.mockRestore(); vi.unstubAllEnvs(); }
  });
});
