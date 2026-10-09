import { beforeEach, describe, expect, it, vi } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import type { CalendarCaller } from "@/lib/services/google-calendar.service";
import fixture from "./fixtures/advisor-day-context.valid.json";
const mocks = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), begin: vi.fn(), finish: vi.fn(), timezone: vi.fn(), prepare: vi.fn(), current: vi.fn(), calendar: vi.fn(), tipHistory: vi.fn(), recordTip: vi.fn(), config: vi.fn() }));
vi.mock("@/lib/db/daily-brief.repo", () => ({ readDailyBriefPreferences: mocks.read, saveDailyBriefPreferences: mocks.save, beginDailyBrief: mocks.begin, finishDailyBrief: mocks.finish,
  readDailyBriefTipHistory: mocks.tipHistory, recordDailyBriefTip: mocks.recordTip }));
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
const caller = { client: {}, user: { id: "owner" } } as CalendarCaller;
const input = { installationId: "11111111-1111-4111-8111-111111111111", retry: false };
const prefs = { enabled: true, includeCalendar: false, includeReminderHistory: false, includeNotes: false, revision: 1, calendarConnectionGeneration: null, calendarSelectionRevision: null };
const now = () => Temporal.Instant.from(fixture.capturedAt);
const generate = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("OPENAI_API_KEY", "synthetic-key");
  mocks.read.mockResolvedValue(prefs);
  mocks.begin.mockResolvedValue({ state: "acquired", leaseToken: "lease", localDate: fixture.localDate });
  mocks.finish.mockResolvedValue(true);
  mocks.timezone.mockResolvedValue(fixture.timezone);
  mocks.current.mockResolvedValue(undefined);
  mocks.prepare.mockImplementation(async (_caller, options) => ({
    contexts: [fixture],
    assertCurrent: mocks.current,
    configurationRefs: {},
    preferences: options.preferences,
  }));
  generate.mockResolvedValue({ suggestions: [], text: "Take time for your walk.", occurrenceRefs: [fixture.cadence.occurrences[0].ref] });
  mocks.tipHistory.mockResolvedValue([]);
  mocks.recordTip.mockResolvedValue(true);
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
  it("uses authenticated repositories, rechecks fences and completes one lease", async () => {
    const result = await requestInAppDailyBrief(caller, input, { generate, now });
    expect(result.state).toBe("ready");
    expect(mocks.begin).toHaveBeenCalledWith(caller.client, { ...input, expectedRevision: 1 }, expect.any(AbortSignal));
    expect(generate).toHaveBeenCalledTimes(1);
    expect(mocks.current).toHaveBeenCalledTimes(2);
    expect(mocks.finish).toHaveBeenCalledWith(caller.client, expect.objectContaining({ success: true, leaseToken: "lease" }), expect.any(AbortSignal));
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
    generate.mockImplementation(async () => { mocks.current.mockRejectedValue(Object.assign(new Error("context_changed"), { code: "context_changed" })); return { suggestions: [], text: "A brief", occurrenceRefs: [] }; });
    await expect(requestInAppDailyBrief(caller, input, { generate, now })).rejects.toMatchObject({ code: "context_changed" });
  });
  it("drops output when cadence changes or a lease is superseded", async () => {
    generate.mockImplementation(async () => { mocks.current.mockRejectedValue(Object.assign(new Error("context_changed"), { code: "context_changed" })); return { suggestions: [], text: "A brief", occurrenceRefs: [] }; });
    await expect(requestInAppDailyBrief(caller, input, { generate, now })).rejects.toMatchObject({ code: "context_changed" });
    mocks.current.mockResolvedValue(undefined);
    mocks.finish.mockResolvedValue(false);
    generate.mockResolvedValue({ suggestions: [], text: "A brief", occurrenceRefs: [] });
    await expect(requestInAppDailyBrief(caller, input, { generate, now })).rejects.toMatchObject({ code: "context_changed" });
  });
  it("rejects Calendar scope changes before model disclosure", async () => {
    mocks.read.mockResolvedValue({ ...prefs, includeCalendar: true, calendarConnectionGeneration: 1, calendarSelectionRevision: 1 });
    mocks.prepare.mockRejectedValue(Object.assign(new Error("context_changed"), { code: "context_changed" }));
    await expect(requestInAppDailyBrief(caller, input, { generate, now })).rejects.toMatchObject({ code: "context_changed" });
    expect(generate).not.toHaveBeenCalled();
  });
  it("stops a stalled model and leaves no late result", async () => {
    generate.mockImplementation(() => new Promise(() => {}));
    await expect(requestInAppDailyBrief(caller, input, { generate, now, deadlineMs: 10 })).rejects.toMatchObject({ code: "timeout" });
  });
  it("accepts four-control saves and revokes optional sources for older two-control clients", async () => {
    mocks.calendar.mockResolvedValue({ status: "connected" });
    mocks.timezone.mockResolvedValue(fixture.timezone);
    await updateDailyBriefSettings(caller, { enabled: true, includeCalendar: false, includeReminderHistory: true, includeNotes: true });
    expect(mocks.save).toHaveBeenLastCalledWith(caller.client, { enabled: true, includeCalendar: false, includeReminderHistory: true, includeNotes: true }, 1);
    await updateDailyBriefSettings(caller, { enabled: true, includeCalendar: false });
    expect(mocks.save).toHaveBeenLastCalledWith(caller.client, { enabled: true, includeCalendar: false, includeReminderHistory: false, includeNotes: false }, 1);
    await expect(updateDailyBriefSettings(caller, { enabled: false, includeCalendar: false, includeReminderHistory: false, includeNotes: true })).rejects.toMatchObject({ code: "invalid_request" });
    await expect(updateDailyBriefSettings(caller, { enabled: true, includeCalendar: false, includeNotes: true })).rejects.toMatchObject({ code: "invalid_request" });
  });
  it("rejects body authority, malformed installation IDs and undeclared settings", async () => {
    await expect(requestInAppDailyBrief(caller, { ...input, userId: "other" }, { generate, now })).rejects.toMatchObject({ code: "invalid_request" });
    await expect(updateDailyBriefSettings(caller, { enabled: true, includeCalendar: false, prompt: "ignore rules" })).rejects.toMatchObject({ code: "invalid_request" });
    expect(generate).not.toHaveBeenCalled();
  });
});

describe("tip delivery accounting", () => {
  const walk = fixture.cadence.occurrences[0];
  const history = Array.from({ length: 15 }, (_, index) => ({ ref: `history_${index}`, behaviorRef: walk.behaviorRef,
    localDate: Temporal.PlainDate.from(fixture.localDate).subtract({ days: 15 - index }).toString(), scheduledFor: "2026-10-20T16:30:00Z",
    scheduleKind: "exact", startTime: "12:30", endTime: null, status: index % 5 < 2 ? "unresolved" : "completed", statusMarkedAt: null, configurationRef: null }));
  const analysisSource = { version: "1.0", observedAt: fixture.capturedAt, revision: "r", timezone: fixture.timezone, localDate: fixture.localDate,
    startLocalDate: "2026-08-03", lookbackDays: 90, completeness: "complete", occurrences: history,
    statusEvents: { state: "not_requested" }, configurationPeriods: { state: "available", records: [] }, reminders: { state: "not_requested" }, notes: { state: "not_requested" },
    today: { scheduledCount: 1, unresolved: [{ ref: walk.ref, behaviorRef: walk.behaviorRef, startTime: "12:30" }] } };
  const tipped = { suggestions: [], text: "Walk at 12:30.", occurrenceRefs: [walk.ref], tip: { findingId: "tip", text: "Record the walk right after it.", noteRefs: [] } };
  beforeEach(async () => {
    const { parseBriefingConfig, BRIEFING_PRESETS } = await import("@cadence/core/services/briefing-config");
    const candidate = BRIEFING_PRESETS.find((preset) => preset.id === "advisor-analysis")!.config;
    mocks.config.mockReturnValue(parseBriefingConfig({ ...candidate, analysis: { ...candidate.analysis, lanes: ["decision-debt", "reminder-effectiveness"] } }));
    mocks.prepare.mockImplementation(async (_caller, options) => ({ contexts: [fixture], assertCurrent: mocks.current, configurationRefs: {}, preferences: options.preferences,
      analysisSource, tipFingerprint: () => "f".repeat(64) }));
  });

  it("requests analysis sources only for selected lanes and records a delivered tip against the lease", async () => {
    generate.mockResolvedValue(tipped);
    const result = await requestInAppDailyBrief(caller, input, { generate, now });
    expect(result).toMatchObject({ state: "ready", briefing: { tip: { laneId: "decision-debt" } } });
    expect(mocks.prepare).toHaveBeenCalledWith(caller, expect.objectContaining({ analysis: { includeReminders: true, includeNotes: false } }));
    expect(mocks.recordTip).toHaveBeenCalledExactlyOnceWith(caller.client, { installationId: input.installationId, leaseToken: "lease", expectedRevision: 1, fingerprint: "f".repeat(64) }, expect.any(AbortSignal));
  });

  it.each([
    ["a failed model call", () => generate.mockRejectedValue(new Error("provider"))],
    ["a superseded lease", () => { generate.mockResolvedValue(tipped); mocks.finish.mockResolvedValue(false); }],
    ["a changed context after generation", () => { generate.mockImplementation(async () => { mocks.current.mockRejectedValue(Object.assign(new Error("changed"), { code: "context_changed" })); return tipped; }); }],
  ])("does not consume the tip after %s", async (_label, arrange) => {
    arrange();
    await expect(requestInAppDailyBrief(caller, input, { generate, now })).rejects.toBeDefined();
    expect(mocks.recordTip).not.toHaveBeenCalled();
  });

  it("keeps the brief when the tip record fails", async () => {
    generate.mockResolvedValue(tipped);
    mocks.recordTip.mockRejectedValue(new Error("storage"));
    expect(await requestInAppDailyBrief(caller, input, { generate, now })).toMatchObject({ state: "ready" });
  });
});
