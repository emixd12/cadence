import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Temporal } from "@js-temporal/polyfill";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { DEFAULT_BRIEFING_CONFIG } from "@cadence/core/services/briefing-config";
import type { BriefingConfig } from "@cadence/core/types/briefing-config";
import { createBriefingBenchStore, type BriefingBenchStore, type BenchCase } from "@/lib/services/briefing-bench-store";
import { historicalFixture } from "@/lib/services/briefing-history.service";
import { briefingAnalysisFixture, BRIEFING_ANALYSIS_FIXTURE_VERSION } from "@/lib/services/briefing-analysis-fixtures";
import { BRIEFING_FIXTURE_VERSION } from "@/lib/services/briefing-fixtures";
import type { DailyBriefGenerator } from "@/lib/services/daily-brief-consumer";
import type { BriefingSequenceStatus } from "@/lib/services/briefing-sequence.service";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), preferences: vi.fn(), behaviors: vi.fn() }));
vi.mock("@/lib/services/google-calendar-request", () => ({ authenticateCalendarRequest: mocks.auth,
  calendarResponse: (_request: Request, body: unknown, status = 200) => Response.json(body, { status }), calendarPreflight: vi.fn(), readCalendarRequestBody: vi.fn() }));
vi.mock("@/lib/db/daily-brief.repo", () => ({ readDailyBriefPreferences: mocks.preferences, listDailyBriefBehaviorIds: mocks.behaviors,
  listBriefingWorkbenchBehaviors: vi.fn(), DailyBriefStorageError: class extends Error {} }));
vi.mock("@/lib/services/briefing-account-context.service", () => ({ briefingAccountRef: () => "account_reference_owner",
  workbenchBehaviorRef: () => "behavior_fixture", prepareAccountBriefingContexts: vi.fn() }));
const origin = "http://127.0.0.1:4321";
const candidate = (side: number) => ({ id: `candidate-000${side}`, role: side ? "candidate" : "baseline", label: side ? "B" : "A", parentCandidateId: null, proposalId: null, rationale: "" });
function config(): BriefingConfig { return structuredClone({ ...DEFAULT_BRIEFING_CONFIG, analysis: { ...DEFAULT_BRIEFING_CONFIG.analysis, lanes: ["realistic-timing", "decision-debt", "cross-source-context"], maxTips: 1 } }); }
const output = { text: "Review the day.", occurrenceRefs: [], suggestions: [], tip: null };
function request(body: unknown, method = "POST") { return new Request(`${origin}/api/dev/briefing-sequence`, { method,
  headers: { origin, "sec-fetch-site": "same-origin", "content-type": "application/json" }, body: JSON.stringify(body) }); }
function get(id: string, accountRef: string | null = null) { return new Request(`${origin}/api/dev/briefing-sequence?id=${id}${accountRef ? `&accountRef=${accountRef}` : ""}`, { headers: { "sec-fetch-site": "same-origin" } }); }
let root: string, store: BriefingBenchStore;
beforeEach(async () => {
  vi.resetModules(); vi.resetAllMocks(); Reflect.deleteProperty(globalThis, Symbol.for("cadence.briefingBenchBudget")); vi.stubEnv("NODE_ENV", "development");
  root = await mkdtemp(path.join(tmpdir(), "cadence-sequence-")); store = createBriefingBenchStore(root);
  mocks.auth.mockResolvedValue({ user: { id: "owner" }, client: {} }); mocks.preferences.mockResolvedValue({ enabled: true, revision: 1 }); mocks.behaviors.mockResolvedValue(["owned"]);
});
afterEach(async () => { vi.unstubAllEnvs(); vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });
async function save(id: string, date: string, account = false, evidenceType?: BenchCase["evidenceType"]) {
  const day = Temporal.PlainDate.from(date), logical = day.toZonedDateTime({ timeZone: "America/New_York", plainTime: "07:00" }).toInstant();
  const context = historicalFixture("sparse", config(), day, "America/New_York", logical);
  const saved: BenchCase = { schemaVersion: 1, kind: "case", id, createdAt: new Date().toISOString(),
    source: account ? { mode: "account", accountRef: "account_reference_owner", preferenceRevision: 1 }
      : { mode: "synthetic", fixtureId: "sparse", fixtureVersion: BRIEFING_FIXTURE_VERSION, analysisFixtureId: "marking_offset", analysisFixtureVersion: BRIEFING_ANALYSIS_FIXTURE_VERSION },
    evidenceType: evidenceType ?? (account ? "captured" : "synthetic"), localDate: date, timezone: context.timezone, capturedAt: context.capturedAt, expiresAt: context.expiresAt,
    capture: { historyDays: [90], includeCalendar: false, calendarDisclosed: false, includeRecordedElapsedDurations: false, includeHistoricalCompletionTimes: false,
      analysis: true, includeReminders: false, remindersDisclosed: false, includeNotes: false, notesDisclosed: false },
    inputs: { contexts: [context], analysisSource: briefingAnalysisFixture("marking_offset", context), configurationRefs: account ? { behavior_fixture: "behavior_fixture" } : {} }, behaviorTitles: [{ ref: "behavior_fixture", title: "Walk" }] };
  await store.createCase(account ? "account-account_reference_owner" : "synthetic", saved);
}
const input = (caseIds = ["case-sequence-0001", "case-sequence-0002"], extra = {}) => ({ action: "simulate", accountRef: null, caseIds,
  configs: [config(), config()], candidates: [candidate(0), candidate(1)], mode: "daily", warmup: [], callBudget: 100, ...extra });
async function waitJob(id: string) {
  const { readBriefingSequence } = await import("@/lib/services/briefing-sequence.service");
  let body!: BriefingSequenceStatus;
  await vi.waitFor(async () => { body = await (await readBriefingSequence(get(id))).json(); expect(["queued", "running"]).not.toContain(body.state); });
  return body;
}

it("simulates in chronological order with stable fingerprints, explicit warmup, and no model calls", async () => {
  await save("case-sequence-0001", "2026-11-02"); await save("case-sequence-0002", "2026-11-03");
  const { startBriefingSequence } = await import("@/lib/services/briefing-sequence.service");
  const generate = vi.fn();
  const body = await (await startBriefingSequence(request(input(["case-sequence-0002", "case-sequence-0001"])), generate, store)).json();
  expect(body.caseIds).toEqual(["case-sequence-0001", "case-sequence-0002"]);
  expect(body).toMatchObject({ plannedCalls: 4, warmup: [], spacing: "one_tip_per_day_skip_different_tip_next_day" });
  expect(body.assumption).toContain("assumed delivered");
  expect(body.days[0].selections[0].fingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(body.days[1].selections[0]).toMatchObject({ tipId: null, decisions: [expect.objectContaining({ decision: "cooldown" })] });
  expect(body.days[0].selections[0].eligibleLanes).toEqual(["realistic-timing"]);
  expect(generate).not.toHaveBeenCalled(); expect(mocks.auth).not.toHaveBeenCalled();
  expect((await store.readCase("synthetic", "case-sequence-0001")).runs).toHaveLength(0);
  const warmup = [{ fingerprint: body.days[0].selections[0].fingerprint, lastShownLocalDate: "2026-11-01" }];
  const warmed = await (await startBriefingSequence(request(input(undefined, { warmup })), generate, store)).json();
  expect(warmed.days[0].selections[0].tipId).toBeNull();
});

it("generation history records only retained successful tips independently for A and B", async () => {
  await save("case-sequence-0001", "2026-11-02"); await save("case-sequence-0002", "2026-11-03");
  const { startBriefingSequence } = await import("@/lib/services/briefing-sequence.service");
  let call = 0;
  const generate = vi.fn<DailyBriefGenerator>(async ({ facts }) => { const tip = JSON.parse(facts).analysis.tip; return { ...output,
    tip: call++ === 0 || !tip ? null : { findingId: "tip", text: "Leave room for later logging today.", noteRefs: [] } }; });
  const response = await startBriefingSequence(request(input(undefined, { action: "start" })), generate, store);
  expect(response.status).toBe(202);
  const job = await waitJob((await response.json()).id);
  expect(job.state).toBe("ready"); expect(job.dispatchedCalls).toBe(4);
  expect(job.results.map(result => result.retainedFingerprints.length > 0)).toEqual([false, true, true, false]);
  expect(job.results.every(result => result.saved)).toBe(true);
  const runs = (await store.readCase("synthetic", "case-sequence-0002")).runs;
  expect(runs[0].evaluation).toMatchObject({ sequenceId: job.id, mode: "daily" });
  expect(runs[0].attemptId).not.toBe((await store.readCase("synthetic", "case-sequence-0001")).runs[0].attemptId);
});

it("derives eligible diagnostic lanes, labels its bypass, and keeps all normal output validation", async () => {
  await save("case-sequence-0001", "2026-11-02");
  const { startBriefingSequence } = await import("@/lib/services/briefing-sequence.service");
  const generate = vi.fn<DailyBriefGenerator>().mockResolvedValueOnce({ ...output, occurrenceRefs: ["invented"] }).mockResolvedValue(output);
  const response = await startBriefingSequence(request(input(["case-sequence-0001"], { mode: "diagnostic", action: "start" })), generate, store);
  const job = await waitJob((await response.json()).id);
  expect(job.plan.plannedCalls).toBe(2); expect(job.state).toBe("partial");
  expect(job.results.map(result => result.laneId)).toEqual(["realistic-timing", "realistic-timing"]);
  expect(job.results[0]).toMatchObject({ state: "error", error: "advisor_unavailable" });
  const runs = (await store.readCase("synthetic", "case-sequence-0001")).runs;
  expect(runs[0].evaluation?.label).toContain("bypasses cross-lane ranking and cooldown");
  expect(runs.every(run => !run.evaluation?.retainedFingerprints.length)).toBe(true);
});

it("cancels dispatched work, saves queued cancellations, releases unused calls and retains completed output for GET", async () => {
  await save("case-sequence-0001", "2026-11-02"); await save("case-sequence-0002", "2026-11-03");
  const { startBriefingSequence, cancelBriefingSequence } = await import("@/lib/services/briefing-sequence.service");
  const generate = vi.fn<DailyBriefGenerator>().mockResolvedValueOnce(output).mockImplementation(({ signal }) => new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(new Error("private_provider_error")), { once: true });
  }));
  const response = await startBriefingSequence(request(input(undefined, { action: "start" })), generate, store);
  const id = (await response.json()).id;
  await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
  expect((await cancelBriefingSequence(request({ id, accountRef: null }, "DELETE"))).status).toBe(200);
  const job = await waitJob(id);
  expect(job.state).toBe("cancelled"); expect(job.dispatchedCalls).toBe(2); expect(job.budget.reserved).toBe(0);
  expect(job.results.map(result => result.state)).toEqual(["ready", "cancelled", "cancelled", "cancelled"]);
  expect(job.results[0].briefing?.text).toBe(output.text); expect(JSON.stringify(job)).not.toContain("private_provider_error");
  expect((await store.readCase("synthetic", "case-sequence-0002")).runs.map(run => run.state)).toEqual(["cancelled", "cancelled"]);
});

it("keeps output visible as Not saved and creates new attempts on retry", async () => {
  await save("case-sequence-0001", "2026-11-02");
  const { startBriefingSequence } = await import("@/lib/services/briefing-sequence.service");
  const broken = { ...store, append: vi.fn().mockRejectedValue(new Error("disk full")) };
  const generate = vi.fn<DailyBriefGenerator>().mockResolvedValue(output);
  const unsaved = await startBriefingSequence(request(input(["case-sequence-0001"], { action: "start" })), generate, broken);
  const first = await waitJob((await unsaved.json()).id);
  expect(first.results.every(result => !result.saved && result.briefing?.text === output.text)).toBe(true);
  const start = async () => waitJob((await (await startBriefingSequence(request(input(["case-sequence-0001"], { action: "start" })), generate, store)).json()).id);
  const retry = await start(), again = await start();
  expect(retry.results.every(result => result.saved)).toBe(true); expect(again.results[0].runId).not.toBe(retry.results[0].runId);
  expect((await store.readCase("synthetic", "case-sequence-0001")).runs).toHaveLength(4);
});

it("rechecks current account consent between queued calls and refuses private GET after revocation", async () => {
  await save("case-sequence-0001", "2026-11-02", true);
  const { startBriefingSequence, readBriefingSequence } = await import("@/lib/services/briefing-sequence.service");
  const generate = vi.fn<DailyBriefGenerator>().mockImplementation(async () => { mocks.preferences.mockResolvedValue({ enabled: false, revision: 2 }); return output; });
  const response = await startBriefingSequence(request(input(["case-sequence-0001"], { action: "start", accountRef: "account_reference_owner" })), generate, store);
  expect(response.status).toBe(202); const id = (await response.json()).id;
  await vi.waitFor(async () => expect((await store.readCase("account-account_reference_owner", "case-sequence-0001")).runs.length).toBeGreaterThanOrEqual(2));
  expect(generate).toHaveBeenCalledOnce();
  expect((await readBriefingSequence(get(id, "account_reference_owner"))).status).toBe(403);
  expect((await readBriefingSequence(get(id))).status).toBe(404);
  const runs = (await store.readCase("account-account_reference_owner", "case-sequence-0001")).runs;
  expect(runs.every(run => !run.briefing)).toBe(true);
});

it("saturated permits recheck queued account consent before dispatch or accounting", async () => {
  await save("case-sequence-0001", "2026-11-02", true);
  const { briefingBenchBudget } = await import("@/lib/services/briefing-bench-budget");
  const { runBriefingComparison } = await import("@/lib/services/briefing-workbench.service");
  const budget = briefingBenchBudget(), occupied = budget.reserve(2);
  let releaseA!: () => void, releaseB!: () => void;
  const signal = new AbortController().signal;
  const a = occupied.dispatch(signal, () => new Promise<void>(resolve => { releaseA = resolve; }));
  const b = occupied.dispatch(signal, () => new Promise<void>(resolve => { releaseB = resolve; }));
  await vi.waitFor(() => expect(budget.snapshot().used).toBe(2));
  const generate = vi.fn<DailyBriefGenerator>().mockResolvedValue(output);
  const comparison = runBriefingComparison(request({ mode: "saved", accountRef: "account_reference_owner", configs: [config()],
    review: { caseId: "case-sequence-0001", candidates: [candidate(0)] } }), generate, store);
  await vi.waitFor(() => expect(budget.snapshot().reserved).toBe(1));
  await vi.waitFor(() => expect(mocks.preferences).toHaveBeenCalledTimes(3));
  mocks.preferences.mockResolvedValue({ enabled: false, revision: 2 });
  releaseA(); releaseB(); await Promise.all([a, b]); occupied.close();
  expect((await comparison).status).toBe(403);
  expect(generate).not.toHaveBeenCalled();
  expect(budget.snapshot()).toMatchObject({ used: 2, reserved: 0, inFlight: 0 });
});

it("comparison and sequence share the provider-call cap across service imports", async () => {
  await save("case-sequence-0001", "2026-11-02");
  vi.stubEnv("CADENCE_BRIEFING_BENCH_CALL_LIMIT", "2");
  const { runBriefingComparison } = await import("@/lib/services/briefing-workbench.service");
  const generate = vi.fn<DailyBriefGenerator>().mockResolvedValue(output);
  await runBriefingComparison(request({ fixtureId: "sparse", configs: [config(), config()] }), generate, store);
  vi.resetModules();
  const { startBriefingSequence } = await import("@/lib/services/briefing-sequence.service");
  const rejected = await startBriefingSequence(request(input(["case-sequence-0001"], { action: "start", callBudget: 2 })), generate, store);
  expect(rejected.status).toBe(429);
  const job = await rejected.json();
  expect(job).toMatchObject({ state: "error", error: "comparison_limit", dispatchedCalls: 0, budget: { used: 2 } });
  expect(generate).toHaveBeenCalledTimes(2);
  expect((await store.readCase("synthetic", "case-sequence-0001")).runs.map(run => run.error)).toEqual(["comparison_limit", "comparison_limit"]);
});

it("counts timed-out dispatched calls and retains the next completed result", async () => {
  await save("case-sequence-0001", "2026-11-02");
  const timeout = new AbortController(); let firstModel = true;
  vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => {
    if (ms === 25_000 && firstModel) { firstModel = false; return timeout.signal; }
    return new AbortController().signal;
  });
  const { startBriefingSequence } = await import("@/lib/services/briefing-sequence.service");
  const generate = vi.fn<DailyBriefGenerator>().mockImplementationOnce(({ signal }) => new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(new Error("timeout detail")), { once: true });
  })).mockResolvedValue(output);
  const response = await startBriefingSequence(request(input(["case-sequence-0001"], { action: "start" })), generate, store);
  const id = (await response.json()).id;
  await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce()); timeout.abort();
  const job = await waitJob(id);
  expect(job.state).toBe("partial"); expect(job.dispatchedCalls).toBe(2);
  expect(job.results[0]).toMatchObject({ state: "error", error: "timeout", saved: true });
  expect(job.results[1]).toMatchObject({ state: "ready", saved: true });
  expect(job.budget).toMatchObject({ used: 2, reserved: 0, inFlight: 0 });
});

it("makes one local date one sequence step and explicitly models spacing from warmup", async () => {
  await save("case-sequence-0001", "2026-11-02"); await save("case-sequence-0002", "2026-11-02");
  const { startBriefingSequence } = await import("@/lib/services/briefing-sequence.service");
  const generate = vi.fn();
  expect((await startBriefingSequence(request(input()), generate, store)).status).toBe(400);
  const response = await startBriefingSequence(request(input(["case-sequence-0001"], {
    warmup: [{ fingerprint: "0".repeat(64), lastShownLocalDate: "2026-11-01" }],
  })), generate, store);
  const plan = await response.json();
  expect(plan.days[0].selections[0]).toMatchObject({ tipId: null, decisions: [expect.objectContaining({ decision: "spacing" })] });
  expect(generate).not.toHaveBeenCalled();
});

it("keeps retrospective schedule coverage partial in both inspector and model inputs", async () => {
  await save("case-sequence-0001", "2026-11-02", true, "retrospective");
  const { startBriefingSequence, readBriefingSequence } = await import("@/lib/services/briefing-sequence.service");
  const generate = vi.fn<DailyBriefGenerator>().mockResolvedValue(output);
  const response = await startBriefingSequence(request(input(["case-sequence-0001"], { action: "start", accountRef: "account_reference_owner" })), generate, store);
  const id = (await response.json()).id;
  let job!: BriefingSequenceStatus;
  await vi.waitFor(async () => { job = await (await readBriefingSequence(get(id, "account_reference_owner"))).json(); expect(job.state).toBe("ready"); });
  for (const [call] of generate.mock.calls) expect(JSON.parse(call.facts).plan.dayEvidence.coverage.cadence).toBe("partial");
  for (const result of job.results) {
    expect(result.inspector.plan.dayEvidence.coverage.cadence).toBe("partial");
    expect(result.inspector.plan.dayEvidence.findings.some(finding => finding.kind === "feasible_opportunity")).toBe(false);
  }
});
