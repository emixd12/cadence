import { beforeEach, describe, expect, it, vi } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import type { CalendarCaller } from "@/lib/services/google-calendar.service";
import fixture from "./fixtures/advisor-day-context.valid.json";
import { dailyBriefPreferences } from "./helpers/daily-brief-preferences";
const mocks = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), begin: vi.fn(), finish: vi.fn(), timezone: vi.fn(), prepare: vi.fn(), current: vi.fn(), calendar: vi.fn(), tipHistory: vi.fn(), recordTip: vi.fn(), config: vi.fn(),
  outlook: vi.fn(), hevy: vi.fn(), icloud: vi.fn() }));
vi.mock("@/lib/services/outlook-calendar.service", () => ({ getOutlookCalendarConnection: mocks.outlook }));
vi.mock("@/lib/services/hevy.service", () => ({ getHevyConnection: mocks.hevy }));
vi.mock("@/lib/services/icloud-calendar.service", () => ({ getIcloudCalendarConnection: mocks.icloud }));
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
const prefs = dailyBriefPreferences({ revision: 1 });
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
    mocks.read.mockResolvedValue(dailyBriefPreferences({ revision: 1, allow: ["googleCalendar"] }));
    mocks.prepare.mockRejectedValue(Object.assign(new Error("context_changed"), { code: "context_changed" }));
    await expect(requestInAppDailyBrief(caller, input, { generate, now })).rejects.toMatchObject({ code: "context_changed" });
    expect(generate).not.toHaveBeenCalled();
  });
  it("stops a stalled model and leaves no late result", async () => {
    generate.mockImplementation(() => new Promise(() => {}));
    await expect(requestInAppDailyBrief(caller, input, { generate, now, deadlineMs: 10 })).rejects.toMatchObject({ code: "timeout" });
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

  it("sends disclosed sources to the model in separate branches with past-activity policy, and drops stale output", async () => {
    const { connectorDayContext } = await import("./helpers/connector-day-context");
    const context = connectorDayContext();
    mocks.prepare.mockImplementation(async (_caller, options) => ({ contexts: [context], assertCurrent: mocks.current, configurationRefs: {}, preferences: options.preferences }));
    const result = await requestInAppDailyBrief(caller, input, { generate, now });
    expect(result).toMatchObject({ state: "ready", briefing: { coverage: "complete" } });
    const call = generate.mock.calls[0]![0] as { instructions: string; facts: string };
    expect(call.instructions).toContain("recordedActivity lists past workouts");
    const facts = JSON.parse(call.facts);
    expect(facts.context.version).toBe("1.1");
    expect(facts.context.connectors).toHaveLength(1);
    expect(facts.context.connectorSources.calendars[0].source).toBe("outlook_calendar");
    expect(facts.context.connectorSources.recordedActivity).toMatchObject({ semantics: "past_recorded_activity", source: "hevy" });
    expect(call.facts).not.toMatch(/Private review|hevy\/[0-9a-f]{16}|routine|exercise/);

    // A withdrawn disclosure or changed connection after generation never delivers text.
    generate.mockImplementation(async () => { mocks.current.mockRejectedValue(Object.assign(new Error("context_changed"), { code: "context_changed" })); return { suggestions: [], text: "A brief", occurrenceRefs: [] }; });
    await expect(requestInAppDailyBrief(caller, input, { generate, now })).rejects.toMatchObject({ code: "context_changed" });
  });

  it("omits connector policy and branches when no source is disclosed", async () => {
    await requestInAppDailyBrief(caller, input, { generate, now });
    const call = generate.mock.calls[0]![0] as { instructions: string; facts: string };
    expect(call.instructions).not.toContain("recordedActivity");
    expect(JSON.parse(call.facts).context).not.toHaveProperty("connectorSources");
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

describe("Ticket 288 model span usage", () => {
  const events = (info: { mock: { calls: unknown[][] } }) => info.mock.calls.map(([line]) => JSON.parse(line as string)).filter((event) => event.span === "daily_brief.model");

  it("records the usage counts on a successful daily_brief.model span and never in the response", async () => {
    vi.stubEnv("CADENCE_PERF_LOG", "1");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      generate.mockImplementation(async (request: { onUsage?: (usage: object) => void }) => {
        request.onUsage?.({ inputTokens: 1200, cachedInputTokens: 300, outputTokens: 150, reasoningTokens: 64 });
        return { suggestions: [], text: "Take time for your walk.", occurrenceRefs: [fixture.cadence.occurrences[0].ref] };
      });
      const result = await requestInAppDailyBrief(caller, input, { generate, now });
      expect(result.state).toBe("ready");
      expect(JSON.stringify(result)).not.toMatch(/tokens|usage/i);
      expect(events(info)).toEqual([expect.objectContaining({ status: "success",
        counts: { usage_calls: 1, input_tokens: 1200, cached_input_tokens: 300, output_tokens: 150, reasoning_tokens: 64 } })]);
    } finally { info.mockRestore(); vi.unstubAllEnvs(); }
  });

  it("records the reason beside the public error code and the usage of the rejected call", async () => {
    vi.stubEnv("CADENCE_PERF_LOG", "1");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      generate.mockImplementation(async (request: { onUsage?: (usage: object) => void }) => {
        request.onUsage?.({ inputTokens: 900, cachedInputTokens: null, outputTokens: 400, reasoningTokens: null });
        return { suggestions: [], text: "word ".repeat(200), occurrenceRefs: [] };
      });
      await expect(requestInAppDailyBrief(caller, input, { generate, now })).rejects.toMatchObject({ code: "advisor_unavailable", reason: "validation_word_limit" });
      const [event] = events(info);
      expect(event).toMatchObject({ status: "error", error_code: "advisor_unavailable", error_reason: "validation_word_limit",
        counts: { usage_calls: 1, input_tokens: 900, output_tokens: 400 } });
      expect(event.counts).not.toHaveProperty("cached_input_tokens");
    } finally { info.mockRestore(); vi.unstubAllEnvs(); }
  });
});
