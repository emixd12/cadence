import { Temporal } from "@js-temporal/polyfill";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarCaller } from "@/lib/services/google-calendar.service";
import fixture from "./fixtures/advisor-day-context.valid.json";

const mocks = vi.hoisted(() => ({
  preferences: vi.fn(),
  ids: vi.fn(),
  revision: vi.fn(),
  timezone: vi.fn(),
  contexts: vi.fn(),
  opaque: vi.fn(),
  calendar: vi.fn(),
  analysis: vi.fn(),
  analysisRevision: vi.fn(),
}));
vi.mock("@/lib/db/advisor-analysis.repo", async (original) => ({
  ...await original<typeof import("@/lib/db/advisor-analysis.repo")>(),
  readAdvisorAnalysisSnapshot: mocks.analysis,
  readAdvisorAnalysisRevision: mocks.analysisRevision,
}));

vi.mock("@/lib/db/daily-brief.repo", () => ({
  readDailyBriefPreferences: mocks.preferences,
  listDailyBriefBehaviorIds: mocks.ids,
}));
vi.mock("@/lib/db/advisor-context.repo", () => ({
  readAdvisorCadenceRevision: mocks.revision,
  readAdvisorProfileTimezone: mocks.timezone,
}));
vi.mock("@/lib/services/advisor-day-context.service", () => ({
  readAdvisorDayContexts: mocks.contexts,
  createAdvisorOpaqueRef: mocks.opaque,
}));
vi.mock("@/lib/services/google-calendar.service", () => ({ getCalendarConnection: mocks.calendar }));

import {
  briefingAccountRef,
  prepareAccountBriefingContexts,
  workbenchBehaviorRef,
} from "@/lib/services/briefing-account-context.service";

const preferences = {
  includeReminderHistory: false,
  includeNotes: false,
  enabled: true,
  includeCalendar: false,
  revision: 3,
  calendarConnectionGeneration: null,
  calendarSelectionRevision: null,
};
const caller = { client: {}, user: { id: "owner-1" } } as CalendarCaller;
const signal = new AbortController().signal;
const now = () => Temporal.Instant.from("2026-11-01T12:00:01Z");

beforeEach(() => {
  vi.resetAllMocks();
  mocks.preferences.mockResolvedValue(preferences);
  mocks.ids.mockResolvedValue(["behavior-1"]);
  mocks.revision.mockResolvedValue("raw-revision");
  mocks.timezone.mockResolvedValue(fixture.timezone);
  mocks.opaque.mockReturnValue((kind: string, value: string) => kind === "revision" ? (value === "raw-revision" ? "revision_cadence" : `revision_${value}`) : `${kind}_${value}`);
  mocks.contexts.mockImplementation(async ({ historyDays }) => historyDays.map((lookbackDays: number) => ({
    ...fixture,
    cadence: { ...fixture.cadence, history: { ...fixture.cadence.history, lookbackDays } },
  })));
});

describe("account briefing context", () => {
  it("prepares one shared capture for two windows and maps stable handles to capture refs", async () => {
    const result = await prepareAccountBriefingContexts(caller, {
      historyDays: [90, 30], includeCalendar: false, signal, clock: now,
    });

    expect(result.contexts.map((context) => context.cadence.history.lookbackDays)).toEqual([90, 30]);
    expect(mocks.contexts).toHaveBeenCalledOnce();
    expect(mocks.contexts).toHaveBeenCalledWith(expect.objectContaining({
      historyDays: [90, 30],
      includeGoogleCalendar: false,
      signal,
    }));
    expect(result.configurationRefs).toEqual({
      [workbenchBehaviorRef("owner-1", "behavior-1")]: "behavior_behavior-1",
    });
    expect(result.preferences).toEqual(preferences);
    expect(briefingAccountRef("owner-1")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("uses a fresh opaque-reference key for every capture", async () => {
    await prepareAccountBriefingContexts(caller, { historyDays: [90], includeCalendar: false, signal, clock: now });
    await prepareAccountBriefingContexts(caller, { historyDays: [90], includeCalendar: false, signal, clock: now });
    const first = mocks.contexts.mock.calls[0][0].opaqueRefKey as Uint8Array;
    const second = mocks.contexts.mock.calls[1][0].opaqueRefKey as Uint8Array;
    expect(first).toHaveLength(32);
    expect(second).toHaveLength(32);
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(false);
  });

  it("requires enabled preferences and an active caller signal", async () => {
    mocks.preferences.mockResolvedValue({ ...preferences, enabled: false });
    await expect(prepareAccountBriefingContexts(caller, { historyDays: [90], includeCalendar: false, signal, clock: now }))
      .rejects.toMatchObject({ code: "access_denied" });
    const controller = new AbortController();
    controller.abort();
    await expect(prepareAccountBriefingContexts(caller, { historyDays: [90], includeCalendar: false, signal: controller.signal, clock: now }))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.contexts).not.toHaveBeenCalled();

    mocks.preferences.mockResolvedValue(preferences);
    const later = new AbortController();
    const prepared = await prepareAccountBriefingContexts(caller, { historyDays: [90], includeCalendar: false, signal: later.signal, clock: now });
    later.abort();
    await expect(prepared.assertCurrent()).rejects.toMatchObject({ name: "AbortError" });
  });

  it("reads Calendar only when requested and separately disclosed", async () => {
    await prepareAccountBriefingContexts(caller, { historyDays: [90], includeCalendar: true, signal, clock: now });
    expect(mocks.contexts).toHaveBeenCalledWith(expect.objectContaining({ includeGoogleCalendar: false }));
    expect(mocks.calendar).not.toHaveBeenCalled();

    const disclosed = { ...preferences, includeCalendar: true, calendarConnectionGeneration: 4, calendarSelectionRevision: 5 };
    mocks.preferences.mockResolvedValue(disclosed);
    mocks.calendar.mockResolvedValue({
      status: "connected", generation: 4, selectionRevision: 5,
      preferences: { selectedCalendarIds: ["calendar-1"] },
    });
    await prepareAccountBriefingContexts(caller, { historyDays: [90], includeCalendar: true, signal, clock: now });
    expect(mocks.contexts).toHaveBeenLastCalledWith(expect.objectContaining({ includeGoogleCalendar: true }));
  });

  it("rechecks preferences, owner scope, source revision, timezone, Calendar selection, and expiry", async () => {
    const assertFailure = async (change: () => void) => {
      const prepared = await prepareAccountBriefingContexts(caller, {
        historyDays: [90], includeCalendar: false, signal, preferences, clock: now,
      });
      change();
      await expect(prepared.assertCurrent()).rejects.toMatchObject({ code: expect.stringMatching(/context_(changed|expired)/) });
      vi.clearAllMocks();
      mocks.preferences.mockResolvedValue(preferences);
      mocks.ids.mockResolvedValue(["behavior-1"]);
      mocks.revision.mockResolvedValue("raw-revision");
      mocks.timezone.mockResolvedValue(fixture.timezone);
      mocks.opaque.mockReturnValue((kind: string, value: string) => kind === "revision" ? (value === "raw-revision" ? "revision_cadence" : `revision_${value}`) : `${kind}_${value}`);
      mocks.contexts.mockResolvedValue([fixture]);
    };

    await assertFailure(() => mocks.preferences.mockResolvedValue({ ...preferences, revision: 4 }));
    await assertFailure(() => mocks.ids.mockResolvedValue(["behavior-2"]));
    await assertFailure(() => mocks.revision.mockResolvedValue("changed"));
    await assertFailure(() => mocks.timezone.mockResolvedValue("Europe/London"));

    const ownerCaller = { client: {}, user: { id: "owner-1" } } as CalendarCaller;
    const ownerPrepared = await prepareAccountBriefingContexts(ownerCaller, {
      historyDays: [90], includeCalendar: false, signal, preferences, clock: now,
    });
    ownerCaller.user.id = "owner-2";
    await expect(ownerPrepared.assertCurrent()).rejects.toMatchObject({ code: "context_changed" });
    ownerCaller.user.id = "owner-1";

    const disclosed = { ...preferences, includeCalendar: true, calendarConnectionGeneration: 4, calendarSelectionRevision: 5 };
    mocks.preferences.mockResolvedValue(disclosed);
    mocks.calendar.mockResolvedValue({ status: "connected", generation: 4, selectionRevision: 5, preferences: { selectedCalendarIds: ["calendar-1"] } });
    const calendarPrepared = await prepareAccountBriefingContexts(caller, {
      historyDays: [90], includeCalendar: true, signal, preferences: disclosed, clock: now,
    });
    mocks.calendar.mockResolvedValue({ status: "connected", generation: 4, selectionRevision: 6, preferences: { selectedCalendarIds: ["calendar-1"] } });
    await expect(calendarPrepared.assertCurrent()).rejects.toMatchObject({ code: "context_changed" });

    mocks.preferences.mockResolvedValue(preferences);
    let instant = Temporal.Instant.from("2026-11-01T12:00:01Z");
    const prepared = await prepareAccountBriefingContexts(caller, {
      historyDays: [90], includeCalendar: false, signal, preferences, clock: () => instant,
    });
    instant = Temporal.Instant.from(fixture.expiresAt);
    await expect(prepared.assertCurrent()).rejects.toMatchObject({ code: "context_expired" });
  });
});

describe("analysis source reads (Ticket 169)", () => {
  const snapshot = (overrides: Record<string, unknown> = {}) => ({
    timezone: fixture.timezone, observedAt: "2026-11-01T12:00:00Z", revision: "analysis-raw",
    occurrences: [{ id: "occ-1", behaviorId: "behavior-1", localDate: "2026-10-30", scheduledFor: "2026-10-30T16:30:00Z",
      scheduleKind: "exact", scheduleStartTime: "12:30:00", scheduleEndTime: null, status: "not_completed", statusMarkedAt: null, configurationEventId: null }],
    statusEvents: [], configurationEvents: [
      { id: "cfg-1", behaviorId: "behavior-1", eventKind: "baseline", effectiveAt: "2026-08-15T00:00:00Z", effectiveLocalDate: "2026-08-15", changedFields: ["schedule_graph"], source: "system", reasonCode: "history_capture_started", browserReminderEnabled: true, emailReminderEnabled: false },
      { id: "cfg-2", behaviorId: "behavior-1", eventKind: "revision", effectiveAt: "2026-09-01T00:00:00Z", effectiveLocalDate: "2026-09-01", changedFields: ["browser_reminder_enabled"], source: "manual", reasonCode: "edit", browserReminderEnabled: false, emailReminderEnabled: false },
      { id: "cfg-3", behaviorId: "behavior-1", eventKind: "revision", effectiveAt: "2026-09-10T00:00:00Z", effectiveLocalDate: "2026-09-10", changedFields: ["schedule_graph"], source: "manual", reasonCode: "edit", browserReminderEnabled: false, emailReminderEnabled: false },
    ],
    reminders: "not_requested", notes: "not_requested", ...overrides,
  });
  beforeEach(() => {
    mocks.analysis.mockResolvedValue(snapshot());
    mocks.analysisRevision.mockResolvedValue("analysis-raw");
  });

  it("reads nothing without selected lanes and never requests undisclosed optional sources", async () => {
    const plain = await prepareAccountBriefingContexts(caller, { historyDays: [90], includeCalendar: false, signal, clock: now });
    expect(plain.analysisSource).toBeNull();
    expect(mocks.analysis).not.toHaveBeenCalled();
    const requested = await prepareAccountBriefingContexts(caller, { historyDays: [90], includeCalendar: false, signal, clock: now, analysis: { includeReminders: true, includeNotes: true } });
    expect(mocks.analysis).toHaveBeenCalledWith(caller.client, expect.objectContaining({ includeReminders: false, includeNotes: false, behaviorIds: ["behavior-1"], historyStartLocalDate: "2026-08-03" }));
    expect(requested.analysisSource).toMatchObject({ reminders: { state: "not_requested" }, notes: { state: "not_requested" }, completeness: "complete" });
  });

  it("requests disclosed sources and projects opaque, schedule-segmented records", async () => {
    mocks.preferences.mockResolvedValue({ ...preferences, includeReminderHistory: true, includeNotes: true });
    mocks.analysis.mockResolvedValue(snapshot({ reminders: [], notes: [{ occurrenceId: "occ-1", behaviorId: "behavior-1", localDate: "2026-10-30", text: "  Rain  " }] }));
    const prepared = await prepareAccountBriefingContexts(caller, { historyDays: [90], includeCalendar: false, signal, clock: now, analysis: { includeReminders: true, includeNotes: true } });
    expect(mocks.analysis).toHaveBeenCalledWith(caller.client, expect.objectContaining({ includeReminders: true, includeNotes: true }));
    const source = prepared.analysisSource!;
    expect(source.occurrences[0]).toMatchObject({ ref: "occurrence_occ-1", behaviorRef: "behavior_behavior-1", startTime: "12:30" });
    expect(source.configurationPeriods).toEqual({ state: "available", records: [
      expect.objectContaining({ ref: "configuration_cfg-1", startsSchedulePeriod: false }),
      expect.objectContaining({ ref: "configuration_cfg-2", startsSchedulePeriod: false }),
      expect.objectContaining({ ref: "configuration_cfg-3", startsSchedulePeriod: true }),
    ] });
    expect(source.notes).toEqual({ state: "available", records: [{ ref: "note_occ-1", occurrenceRef: "occurrence_occ-1", behaviorRef: "behavior_behavior-1", localDate: "2026-10-30", text: "Rain" }] });
    expect(JSON.stringify(source)).not.toMatch(/"occ-1"|"behavior-1"|"cfg-/);
  });

  it("marks capped sources and fences the analysis revision before delivery", async () => {
    mocks.analysis.mockResolvedValue(snapshot({ statusEvents: Array.from({ length: 20_001 }, (_, index) => ({ id: `e${index}`, occurrenceId: "occ-1", previousStatus: null, status: "completed", semantics: "explicit_user_mark", recordedAt: "2026-10-30T17:00:00Z", revisesEventId: null })) }));
    const prepared = await prepareAccountBriefingContexts(caller, { historyDays: [90], includeCalendar: false, signal, clock: now, analysis: { includeReminders: false, includeNotes: false } });
    expect(prepared.analysisSource?.statusEvents).toEqual({ state: "capped" });
    await expect(prepared.assertCurrent()).resolves.toBeUndefined();
    mocks.analysisRevision.mockResolvedValue("analysis-changed");
    await expect(prepared.assertCurrent()).rejects.toMatchObject({ code: "context_changed" });
  });

  it("rejects a timezone race and derives stable per-owner tip fingerprints", async () => {
    mocks.analysis.mockResolvedValueOnce(snapshot({ timezone: "Europe/Paris" }));
    await expect(prepareAccountBriefingContexts(caller, { historyDays: [90], includeCalendar: false, signal, clock: now, analysis: { includeReminders: false, includeNotes: false } }))
      .rejects.toMatchObject({ code: "context_changed" });
    const finding = { laneId: "decision-debt", behaviorRef: "behavior_behavior-1", key: "unresolved", evidenceBand: "share:4" } as never;
    const first = await prepareAccountBriefingContexts(caller, { historyDays: [90], includeCalendar: false, signal, clock: now, analysis: { includeReminders: false, includeNotes: false } });
    const second = await prepareAccountBriefingContexts(caller, { historyDays: [90], includeCalendar: false, signal, clock: now, analysis: { includeReminders: false, includeNotes: false } });
    expect(first.tipFingerprint(finding)).toMatch(/^[0-9a-f]{64}$/);
    expect(first.tipFingerprint(finding)).toBe(second.tipFingerprint(finding));
    const other = await prepareAccountBriefingContexts({ ...caller, user: { id: "owner-2" } } as CalendarCaller, { historyDays: [90], includeCalendar: false, signal, clock: now, analysis: { includeReminders: false, includeNotes: false } });
    expect(other.tipFingerprint(finding)).not.toBe(first.tipFingerprint(finding));
  });
});
