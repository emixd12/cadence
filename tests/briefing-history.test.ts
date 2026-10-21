import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import { DEFAULT_BRIEFING_CONFIG } from "@cadence/core/services/briefing-config";
import type { BriefingConfig } from "@cadence/core/types/briefing-config";
import { briefingFixture } from "@/lib/services/briefing-fixtures";
import { briefingAccountRef, workbenchBehaviorRef } from "@/lib/services/briefing-account-context.service";
import { createBriefingBenchStore, type BriefingBenchStore } from "@/lib/services/briefing-bench-store";
import { historicalFixture, inspectBriefingHistory, readBriefingHistory, type BriefingHistoryResponse } from "@/lib/services/briefing-history.service";
import calendarSnapshot from "./fixtures/external-event-snapshot.valid.json";

const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), capture: vi.fn(), current: vi.fn(), preferences: vi.fn(), behaviorIds: vi.fn(), behaviors: vi.fn(), occurrences: vi.fn(), statuses: vi.fn(), configurations: vi.fn(), pastCalendar: vi.fn(), calendar: vi.fn(), generate: vi.fn() }));
vi.mock("@/lib/services/briefing-account-context.service", async importOriginal => ({ ...await importOriginal<object>(), prepareAccountBriefingContexts: mocks.capture }));
vi.mock("@/lib/db/behaviors.repo", () => ({ listUserBehaviors: mocks.behaviors }));
vi.mock("@/lib/db/occurrences.repo", () => ({ listUserOccurrences: mocks.occurrences }));
vi.mock("@/lib/db/occurrenceStatusEvents.repo", () => ({ listOccurrenceStatusEventsByOccurrenceIds: mocks.statuses }));
vi.mock("@/lib/db/behaviorConfigurationEvents.repo", () => ({ listBehaviorConfigurationEvents: mocks.configurations }));
vi.mock("@/lib/services/google-calendar.service", () => ({ getCalendarEventsForWorkbenchHistory: mocks.pastCalendar, getCalendarConnection: mocks.calendar }));
vi.mock("@/lib/services/daily-brief-openai", () => ({ generateOpenAIDailyBrief: mocks.generate, DAILY_BRIEF_MODEL: "not_called" }));
vi.mock("@/lib/services/google-calendar-request", () => ({ authenticateCalendarRequest: mocks.authenticate,
  calendarResponse: (_request: Request, body: unknown, status = 200) => Response.json(body, { status }), calendarPreflight: vi.fn(), readCalendarRequestBody: vi.fn() }));
vi.mock("@/lib/db/daily-brief.repo", () => ({ readDailyBriefPreferences: mocks.preferences, listDailyBriefBehaviorIds: mocks.behaviorIds, listBriefingWorkbenchBehaviors: vi.fn(), DailyBriefStorageError: class extends Error {} }));

const origin = "http://127.0.0.1:4321";
const preferences = { enabled: true, includeCalendar: false, includeReminderHistory: false, includeNotes: false, revision: 3, calendarConnectionGeneration: null, calendarSelectionRevision: null };

it('keeps the overnight fixture across the target midnight when shifting dates', () => {
  const context = historicalFixture('overnight', DEFAULT_BRIEFING_CONFIG, Temporal.PlainDate.from('2026-09-20'),
    'America/New_York', Temporal.Instant.from('2026-09-20T11:00:00Z'));
  const connector = context.connectors[0];
  if (connector.state === 'not_requested') throw new Error('Expected authored Calendar');
  expect(connector.events[0].interval).toMatchObject({ kind: 'timed', startAt: '2026-09-21T03:00:00Z',
    endAt: '2026-09-21T06:00:00Z', duration: { seconds: 10800 } });
  expect(context.dayEndAt).toBe('2026-09-21T04:00:00Z');
});
const config = (historyDays = 90, lanes: BriefingConfig["analysis"]["lanes"] = []): BriefingConfig => structuredClone({ ...DEFAULT_BRIEFING_CONFIG,
  scope: { ...DEFAULT_BRIEFING_CONFIG.scope, historyDays }, analysis: { ...DEFAULT_BRIEFING_CONFIG.analysis, lanes } });
const post = (body: unknown, hostname = origin) => new Request(`${hostname}/api/dev/briefing-history`, { method: "POST", headers: {
  origin: hostname, "sec-fetch-site": "same-origin", "content-type": "application/json" }, body: JSON.stringify(body) });
const synthetic = (overrides = {}) => ({ mode: "synthetic", fixtureId: "sparse", configs: [config(), config(30)], ...overrides });
const account = (overrides = {}) => ({ mode: "account", accountRef: briefingAccountRef("owner"), preferenceRevision: 3, configs: [config(), config(30)],
  startLocalDate: "2026-11-01", endLocalDate: "2026-11-02", ...overrides });
function occurrence(id: string, date: string, status = "completed", overrides = {}) {
  return { id, user_id: "owner", behavior_id: "owned", local_date: date, scheduled_for: `${date}T17:00:00Z`, status, status_marked_at: `${date}T17:30:00Z`,
    schedule_kind: "exact", schedule_start_time: "12:00:00", schedule_end_time: null, behavior_configuration_event_id: null, updated_at: "2026-11-14T12:00Z", created_at: "2026-11-14T12:00Z", ...overrides };
}
let root: string, store: BriefingBenchStore;
beforeEach(async () => {
  vi.resetAllMocks(); vi.stubEnv("NODE_ENV", "development"); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-15T12:00Z"));
  root = await mkdtemp(path.join(tmpdir(), "briefing-history-")); store = createBriefingBenchStore(root);
  mocks.authenticate.mockResolvedValue({ user: { id: "owner" }, client: {} }); mocks.preferences.mockResolvedValue(preferences);
  mocks.behaviorIds.mockResolvedValue(["owned"]);
  mocks.behaviors.mockResolvedValue([{ id: "owned", title: "Walk", default_duration_minutes: 30 }]);
  mocks.occurrences.mockResolvedValue([occurrence("first", "2026-11-01"), occurrence("history", "2026-10-31", "not_completed")]);
  mocks.statuses.mockResolvedValue([]); mocks.configurations.mockResolvedValue([]); mocks.current.mockResolvedValue(undefined);
  mocks.capture.mockImplementation(async (_caller, input) => ({ contexts: input.historyDays.map((days: number) => briefingFixture("sparse", config(days))), preferences,
    assertCurrent: mocks.current, configurationRefs: { [workbenchBehaviorRef("owner", "owned")]: "old_capture_ref" } }));
});
afterEach(async () => { vi.useRealTimers(); vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });

it("discovers fourteen logical mornings with no authentication, model or account read", async () => {
  const response = await inspectBriefingHistory(post(synthetic()), store);
  expect(response.status).toBe(200);
  const body = await response.json() as BriefingHistoryResponse;
  expect(body.range).toMatchObject({ startLocalDate: "2026-11-01", endLocalDate: "2026-11-14", targetDays: 14, logicalTime: "07:00", timezone: "America/New_York", underlyingStartLocalDate: "2026-08-03", lookbackDays: [90, 30] });
  expect(body.days).toHaveLength(14); expect(body.days[0]).toMatchObject({ logicalAt: "2026-11-01T12:00:00Z", evidenceType: "synthetic", state: "available" });
  expect(body.days[0].inspections).toHaveLength(2); expect(body.reconstruction.available).toBe(false);
  expect(mocks.authenticate).not.toHaveBeenCalled(); expect(mocks.capture).not.toHaveBeenCalled(); expect(mocks.generate).not.toHaveBeenCalled(); expect(mocks.occurrences).not.toHaveBeenCalled();
});

it("materializes DST day bounds, midnight and complete lookback dates without twenty-four-hour shifts", () => {
  for (const [date, hours, logicalAt] of [["2026-03-08", 23, "2026-03-08T11:00:00Z"], ["2026-11-01", 25, "2026-11-01T12:00:00Z"]] as const) {
    const day = Temporal.PlainDate.from(date), logical = day.toZonedDateTime({ timeZone: "America/New_York", plainTime: "07:00" }).toInstant();
    const context = historicalFixture("sparse", config(30), day, "America/New_York", logical);
    expect(context.capturedAt).toBe(logicalAt);
    expect(Temporal.Instant.from(context.dayStartAt).until(Temporal.Instant.from(context.dayEndAt)).total("hours")).toBe(hours);
    expect(context.cadence.history.startLocalDate).toBe(day.subtract({ days: 30 }).toString()); expect(context.cadence.history.endLocalDateExclusive).toBe(date);
    expect(context.cadence.recordedElapsedDurations?.every(row => row.localDate < date)).toBe(true);
  }
});

it("bounds ninety target days and discloses the ninety-day underlying lookback", async () => {
  const good = await inspectBriefingHistory(post(synthetic({ startLocalDate: "2026-08-17", endLocalDate: "2026-11-14" })), store);
  expect(good.status).toBe(200); expect((await good.json()).range).toMatchObject({ targetDays: 90, underlyingStartLocalDate: "2026-05-19" });
  expect((await inspectBriefingHistory(post(synthetic({ startLocalDate: "2026-08-16", endLocalDate: "2026-11-14" })), store)).status).toBe(400);
  expect((await inspectBriefingHistory(post(synthetic({ endLocalDate: "2026-11-15" })), store)).status).toBe(400);
});

it("saves exact historical synthetic contexts for both configuration windows and retains old captured labels", async () => {
  const response = await inspectBriefingHistory(post(synthetic({ startLocalDate: "2026-11-01", endLocalDate: "2026-11-01", saveLocalDate: "2026-11-01", analysisFixtureId: "weekday_dip" })), store);
  const body = await response.json() as BriefingHistoryResponse;
  const record = (await store.readCase("synthetic", body.savedCaseId!)).case;
  expect(record.inputs?.contexts.map(context => [context.localDate, context.cadence.history.lookbackDays])).toEqual([["2026-11-01", 90], ["2026-11-01", 30]]);
  expect(record.inputs?.analysisSource?.localDate).toBe("2026-11-01"); expect(record.inputs?.configurationRefs).toEqual({});
  expect(record.history).toMatchObject({ observedAt: "2026-11-15T12:00:00Z", logicalTime: "07:00", lookbackDays: [90, 30] });
  await store.createCase("synthetic", { ...record, id: "captured-old-case", history: undefined, evidenceType: "captured" });
  const grid = await (await inspectBriefingHistory(post(synthetic({ startLocalDate: "2026-11-01", endLocalDate: "2026-11-01" })), store)).json();
  expect(grid.days[0].retainedCases).toContainEqual(expect.objectContaining({ id: "captured-old-case", evidenceType: "captured", logicalAt: "2026-11-01T12:00:00Z", rerunnable: true }));
});

it('shares complete authored inputs when A excludes a source that B includes', async () => {
  const a = config(), b = { ...config(), context: { ...config().context, includeHistoricalCompletionTimes: true } };
  const body = await (await inspectBriefingHistory(post(synthetic({ configs: [a, b], startLocalDate: '2026-11-01',
    endLocalDate: '2026-11-01', saveLocalDate: '2026-11-01' })), store)).json() as BriefingHistoryResponse;
  expect(body.days[0].inspections[0].facts.cadence.historicalCompletionTimes).toBeUndefined();
  expect(body.days[0].inspections[1].facts.cadence.historicalCompletionTimes?.behaviors).toHaveLength(1);
  const saved = (await store.readCase('synthetic', body.savedCaseId!)).case;
  expect(saved.inputs?.contexts).toHaveLength(1);
  expect(saved.inputs?.contexts[0].cadence.historicalCompletionTimes?.behaviors).toHaveLength(1);
});

it("reruns frozen synthetic history on the selected logical day through the existing comparison service", async () => {
  const body = await (await inspectBriefingHistory(post(synthetic({ fixtureId: "uneventful", startLocalDate: "2026-10-12", endLocalDate: "2026-10-12", saveLocalDate: "2026-10-12" })), store)).json();
  const { runBriefingComparison } = await import("@/lib/services/briefing-workbench.service");
  const generate = vi.fn().mockResolvedValue({ text: "Review the supplied day.", occurrenceRefs: [], suggestions: [] });
  const response = await runBriefingComparison(new Request(`${origin}/api/dev/briefing-comparison`, { method: "POST", headers: { origin, "sec-fetch-site": "same-origin", "content-type": "application/json" },
    body: JSON.stringify({ mode: "saved", accountRef: null, configs: [config()], review: { caseId: body.savedCaseId, candidates: [{ id: "history-replay-001", label: "history", role: "candidate", parentCandidateId: null, proposalId: null, rationale: "" }] } }) }), generate, store);
  expect(response.status).toBe(200); expect((await response.json()).results[0].state).toBe("ready");
  expect(JSON.parse(generate.mock.calls[0][0].facts).context.localDate).toBe("2026-10-12");
});

it("reruns explicit unknown account sources without creating new source facts", async () => {
  const disclosed = { ...preferences, includeCalendar: true, calendarConnectionGeneration: 3, calendarSelectionRevision: 4 };
  mocks.preferences.mockResolvedValue(disclosed);
  mocks.capture.mockImplementation(async (_caller, input) => ({ contexts: input.historyDays.map((days: number) => briefingFixture("sparse", config(days))), preferences: disclosed,
    assertCurrent: mocks.current, configurationRefs: { [workbenchBehaviorRef("owner", "owned")]: "old_capture_ref" } }));
  const selected = { ...config(), scope: { ...config().scope, includeCalendar: true }, context: { ...config().context, includeCompletionHistory: true } };
  const body = await (await inspectBriefingHistory(post(account({ configs: [selected], saveLocalDate: "2026-11-01" })), store)).json();
  const { runBriefingComparison } = await import("@/lib/services/briefing-workbench.service");
  const generate = vi.fn().mockResolvedValue({ text: "Review the supplied day.", occurrenceRefs: [], suggestions: [] });
  const response = await runBriefingComparison(new Request(`${origin}/api/dev/briefing-comparison`, { method: "POST", headers: { origin, "sec-fetch-site": "same-origin", "content-type": "application/json" },
    body: JSON.stringify({ mode: "saved", accountRef: briefingAccountRef("owner"), configs: [selected], review: { caseId: body.savedCaseId, candidates: [{ id: "history-account-001", label: "history", role: "candidate", parentCandidateId: null, proposalId: null, rationale: "" }] } }) }), generate, store);
  expect(response.status).toBe(200); expect((await response.json()).results[0].state).toBe("ready");
  const facts = JSON.parse(generate.mock.calls[0][0].facts).context;
  expect(facts.cadence.history.completeness).toBe("unknown"); expect(facts.connectors).toBeUndefined();
  expect(mocks.pastCalendar).not.toHaveBeenCalled();
});

it("labels late corrections, backfilled imports and later-created rows Retrospective without pretending as-of state", async () => {
  mocks.occurrences.mockResolvedValue([occurrence("late", "2026-11-01", "not_completed", { status_marked_at: "2026-11-14T12:00Z" }),
    occurrence("import", "2026-11-01", "completed", { created_at: "2026-11-14T12:00Z", status_marked_at: "2026-11-01T06:00Z" }), occurrence("past", "2026-10-31")]);
  const response = await inspectBriefingHistory(post(account({ saveLocalDate: "2026-11-01" })), store);
  expect(response.status).toBe(200);
  const body = await response.json() as BriefingHistoryResponse;
  expect(body.days[0]).toMatchObject({ evidenceType: "retrospective", counts: { scheduled: 2, completed: 1, notCompleted: 1, unresolved: 0 } });
  expect(body.days[1]).toMatchObject({ state: "unavailable", counts: null, inspections: [] });
  const record = (await store.readCase(`account-${briefingAccountRef("owner")}`, body.savedCaseId!)).case;
  expect(record.evidenceType).toBe("retrospective");
  expect(record.inputs?.contexts[0].cadence.history).toMatchObject({ completeness: "unknown", behaviors: [{ completedCount: null, notCompletedCount: null, unresolvedCount: null }] });
  expect(record.inputs?.contexts[0].cadence.occurrences.map(row => row.status)).toEqual(["not_completed", "completed"]);
  expect(record.history?.coverage.find(row => row.source === "durations")?.state).toBe("unknown");
  expect(mocks.capture.mock.calls[0][1]).not.toHaveProperty("clock"); expect(mocks.current).toHaveBeenCalled(); expect(mocks.generate).not.toHaveBeenCalled();
});

it("does not save unknown deleted/empty days or count them as zero", async () => {
  const response = await inspectBriefingHistory(post(account({ saveLocalDate: "2026-11-02" })), store);
  expect((await response.json()).error).toBe("input_not_captured"); expect(await store.listCases(`account-${briefingAccountRef("owner")}`)).toEqual([]);
});

it("keeps source gaps unknown and current Notes and reminder statuses unavailable", async () => {
  const selectedHistory = { ...config(), context: { ...config().context, includeCompletionHistory: true } };
  const body = await (await inspectBriefingHistory(post(account({ configs: [selectedHistory, config(30)] })), store)).json() as BriefingHistoryResponse;
  const coverage = body.days[0].coverage;
  expect(coverage.filter(row => row.source === "completion_history").map(row => row.state)).toEqual(["unknown", "unknown"]);
  expect(coverage.find(row => row.source === "notes")?.state).toBe("unavailable"); expect(coverage.find(row => row.source === "reminders")?.state).toBe("unavailable");
  expect(body.days[0].inspections[0].facts.cadence.history?.completeness).toBe("unknown");
});

it("rechecks current ownership and source mutation before saving or returning account inputs", async () => {
  const { DailyBriefError } = await import("@/lib/services/daily-brief-consumer");
  mocks.current.mockRejectedValue(new DailyBriefError("access_denied"));
  expect((await (await inspectBriefingHistory(post(account({ saveLocalDate: "2026-11-01" })), store)).json()).error).toBe("access_denied");
  expect(await store.listCases(`account-${briefingAccountRef("owner")}`)).toEqual([]);
  mocks.current.mockResolvedValue(undefined); mocks.occurrences.mockResolvedValueOnce([occurrence("first", "2026-11-01")]).mockResolvedValueOnce([]);
  expect((await (await inspectBriefingHistory(post(account()), store)).json()).error).toBe("context_changed");
});

it("inspects retained retrospective analysis with a half-open lookback and no invented revision cutoff", async () => {
  const daily = config(30, ["correction-patterns", "cross-source-context"]);
  mocks.occurrences.mockResolvedValue([occurrence("before-window", "2026-08-02"), occurrence("first-lookback", "2026-08-03"), occurrence("last-lookback", "2026-10-31"), occurrence("target", "2026-11-01")]);
  mocks.statuses.mockResolvedValue([{ id: "corrected", occurrence_id: "last-lookback", status: "not_completed", previous_status: "completed", status_semantics: "explicit_user_correction",
    recorded_at: "2026-11-14T12:00Z", created_at: "2026-11-14T12:00Z", revises_event_id: "older" }]);
  const response = await inspectBriefingHistory(post(account({ configs: [daily], startLocalDate: "2026-11-01", endLocalDate: "2026-11-01", saveLocalDate: "2026-11-01" })), store);
  expect(response.status).toBe(200);
  const body = await response.json() as BriefingHistoryResponse;
  const source = (await store.readCase(`account-${briefingAccountRef("owner")}`, body.savedCaseId!)).case.inputs!.analysisSource!;
  expect(source.occurrences.map(row => row.localDate)).toEqual(["2026-08-03", "2026-10-31"]);
  expect(source.statusEvents).toMatchObject({ state: "available", records: [{ recordedAt: "2026-11-14T12:00Z", semantics: "explicit_user_correction" }] });
  expect(body.days[0].evidenceType).toBe("retrospective");
  expect(body.days[0].inspections[0].analysis?.result.lanes.find(row => row.laneId === "cross-source-context")).toMatchObject({ state: "unavailable", reason: "historical_calendar_not_read" });
});

it("requires a separate past Calendar choice and preserves its live read time in retrospective coverage", async () => {
  const disclosed = { ...preferences, includeCalendar: true, calendarConnectionGeneration: 3, calendarSelectionRevision: 4 };
  mocks.capture.mockImplementation(async (_caller, input) => ({ contexts: input.historyDays.map((days: number) => briefingFixture("sparse", config(days))), preferences: disclosed,
    assertCurrent: mocks.current, configurationRefs: { [workbenchBehaviorRef("owner", "owned")]: "old_capture_ref" } }));
  const snapshot = structuredClone(calendarSnapshot);
  snapshot.requestedRange.endLocalDate = "2026-11-02"; snapshot.coverage[0].endLocalDate = "2026-11-02";
  snapshot.fetchedAt = "2026-11-15T12:00:00Z"; snapshot.freshness.refreshedAt = snapshot.fetchedAt;
  mocks.pastCalendar.mockResolvedValue({ result: { ok: true, snapshot }, connection: { selectionRevision: 4 } });
  await inspectBriefingHistory(post(account()), store); expect(mocks.pastCalendar).not.toHaveBeenCalled();
  const body = await (await inspectBriefingHistory(post(account({ includePastCalendar: true, saveLocalDate: "2026-11-01" })), store)).json() as BriefingHistoryResponse;
  expect(mocks.pastCalendar).toHaveBeenCalledWith(expect.objectContaining({ user: { id: "owner" } }), "2026-11-01", "2026-11-02", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  const calendar = body.days[0].coverage.find(row => row.source === "calendar")!;
  expect(calendar.state).toBe("retained"); expect(calendar.limitations.join()).toContain("2026-11-15T12:00:00Z");
  expect(body.days[0].evidenceType).toBe("retrospective");
  const saved = (await store.readCase(`account-${briefingAccountRef("owner")}`, body.savedCaseId!)).case;
  expect(saved.inputs?.contexts[0].connectors[0]).toMatchObject({ state: "current", complete: true, fetchedAt: "2026-11-01T12:00:00Z" });
  expect(saved.history?.observedAt).toBe("2026-11-15T12:00:00Z");
  expect(body.days[0].inspections[0].plan.dayEvidence.coverage).toMatchObject({ cadence: "partial", canClaimFeasibleOpportunities: false });
});

it("never expands a returned Calendar range into complete coverage for an unfetched day", async () => {
  const disclosed = { ...preferences, includeCalendar: true, calendarConnectionGeneration: 3, calendarSelectionRevision: 4 };
  mocks.capture.mockImplementation(async (_caller, input) => ({ contexts: input.historyDays.map((days: number) => briefingFixture("sparse", config(days))), preferences: disclosed,
    assertCurrent: mocks.current, configurationRefs: { [workbenchBehaviorRef("owner", "owned")]: "old_capture_ref" } }));
  mocks.occurrences.mockResolvedValue([occurrence("day-one", "2026-11-01"), occurrence("day-two", "2026-11-02")]);
  const snapshot = structuredClone(calendarSnapshot);
  snapshot.requestedRange.endLocalDate = "2026-11-01"; snapshot.coverage[0].endLocalDate = "2026-11-01";
  snapshot.events = [snapshot.events[0]]; snapshot.coverage[0].itemCount = 1;
  snapshot.fetchedAt = "2026-11-15T12:00:00Z"; snapshot.freshness.refreshedAt = snapshot.fetchedAt;
  mocks.pastCalendar.mockResolvedValue({ result: { ok: true, snapshot }, connection: { selectionRevision: 4 } });
  const body = await (await inspectBriefingHistory(post(account({ includePastCalendar: true })), store)).json() as BriefingHistoryResponse;
  expect(body.days[1].coverage.find(row => row.source === "calendar")?.state).toBe("unavailable");
  expect(body.days[1].inspections[0].plan.dayEvidence.coverage.canClaimFeasibleOpportunities).toBe(false);
  expect(body.days[1].inspections[0].facts.connectors?.[0]).toMatchObject({ complete: false, state: "incomplete", coverage: [], events: [] });
});

it("marks capped targets unavailable and does not save a truncated day", async () => {
  mocks.occurrences.mockResolvedValue(Array.from({ length: 201 }, (_, index) => occurrence(`target-${index}`, "2026-11-01")));
  const body = await (await inspectBriefingHistory(post(account()), store)).json() as BriefingHistoryResponse;
  expect(body.days[0]).toMatchObject({ state: "unavailable", counts: null, inspections: [] });
  expect(body.days[0].coverage.find(row => row.source === "occurrences")?.state).toBe("capped");
});

it("rejects owner drift and expired saved cases using live time", async () => {
  expect((await (await inspectBriefingHistory(post(account({ accountRef: briefingAccountRef("other") })), store)).json()).error).toBe("context_changed");
  const body = await (await inspectBriefingHistory(post(synthetic({ startLocalDate: "2026-11-01", endLocalDate: "2026-11-01", saveLocalDate: "2026-11-01" })), store)).json();
  vi.setSystemTime(new Date("2026-12-20T12:00Z"));
  await expect(store.readCase("synthetic", body.savedCaseId)).rejects.toMatchObject({ code: "not_found" });
});

it("keeps production and foreign origins guarded before account or model reads", async () => {
  vi.stubEnv("NODE_ENV", "production"); expect((await inspectBriefingHistory(post(synthetic()), store)).status).toBe(404);
  vi.stubEnv("NODE_ENV", "development"); expect((await inspectBriefingHistory(post(synthetic(), "https://example.com"), store)).status).toBe(403);
  expect((await readBriefingHistory(new Request(`${origin}/api/dev/briefing-history`, { headers: { "sec-fetch-site": "same-origin" } }))).status).toBe(200);
  expect(mocks.generate).not.toHaveBeenCalled(); expect(mocks.authenticate).not.toHaveBeenCalled();
});
