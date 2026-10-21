import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_BRIEFING_CONFIG } from "@cadence/core/services/briefing-config";
import type { BriefingConfig } from "@cadence/core/types/briefing-config";
import { briefingFixture } from "@/lib/services/briefing-fixtures";
import { createBriefingBenchStore, type BriefingBenchStore } from "@/lib/services/briefing-bench-store";

const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), preferences: vi.fn(), behaviorIds: vi.fn(), capture: vi.fn(), current: vi.fn(), calendar: vi.fn() }));
vi.mock("@/lib/services/google-calendar.service", () => ({ getCalendarConnection: mocks.calendar }));
vi.mock("@/lib/services/google-calendar-request", () => ({ authenticateCalendarRequest: mocks.authenticate,
  calendarResponse: (_request: Request, body: unknown, status = 200) => Response.json(body, { status }),
  calendarPreflight: vi.fn(), readCalendarRequestBody: vi.fn() }));
vi.mock("@/lib/db/daily-brief.repo", () => ({ readDailyBriefPreferences: mocks.preferences, listDailyBriefBehaviorIds: mocks.behaviorIds,
  listBriefingWorkbenchBehaviors: vi.fn(), DailyBriefStorageError: class extends Error {} }));
vi.mock("@/lib/services/daily-brief.service", () => ({ getDailyBriefSettings: vi.fn() }));
vi.mock("@/lib/services/briefing-account-context.service", () => ({ prepareAccountBriefingContexts: mocks.capture,
  briefingAccountRef: (userId: string) => `account_reference_${userId}`, workbenchBehaviorRef: (_userId: string, id: string) => `behavior_${id}` }));

const origin = "http://127.0.0.1:4321";
const ACCOUNT = "account_reference_owner";
const CASE = "case-0000-account";
const preferences = { enabled: true, includeCalendar: false, includeReminderHistory: false, includeNotes: false, revision: 4, calendarConnectionGeneration: null, calendarSelectionRevision: null };
function config(tone: BriefingConfig["tone"] = "calm", historyDays = 90): BriefingConfig {
  return structuredClone({ ...DEFAULT_BRIEFING_CONFIG, tone, scope: { ...DEFAULT_BRIEFING_CONFIG.scope, historyDays } });
}
const candidate = (id: string, role: "baseline" | "candidate") => ({ id, label: role, role, parentCandidateId: null, proposalId: null, rationale: "" });
function post(url: string, body: unknown) {
  return new Request(`${origin}${url}`, { method: "POST", body: JSON.stringify(body), headers: { origin, "sec-fetch-site": "same-origin", "content-type": "application/json" } });
}
const output = { text: "Review your supplied context.", occurrenceRefs: [], suggestions: [] };

let root: string;
let store: BriefingBenchStore;
beforeEach(async () => {
  vi.resetModules(); Reflect.deleteProperty(globalThis, Symbol.for("cadence.briefingBenchBudget")); vi.resetAllMocks(); vi.stubEnv("NODE_ENV", "development");
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-01T12:00:00Z"));
  root = await mkdtemp(path.join(tmpdir(), "briefing-bench-account-"));
  store = createBriefingBenchStore(root);
  mocks.authenticate.mockResolvedValue({ user: { id: "owner" }, client: {} });
  mocks.preferences.mockResolvedValue(preferences);
  mocks.behaviorIds.mockResolvedValue(["owned"]);
  mocks.current.mockResolvedValue(undefined);
  mocks.capture.mockImplementation(async (_caller, input) => ({ preferences, analysisSource: null,
    contexts: input.historyDays.map((days: number) => briefingFixture("sparse", config("calm", days))),
    configurationRefs: { behavior_owned: "behavior_fixture" }, assertCurrent: mocks.current }));
});
afterEach(async () => { vi.useRealTimers(); vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });

async function capture() {
  const { runBriefingComparison } = await import("@/lib/services/briefing-workbench.service");
  const generate = vi.fn().mockResolvedValue(output);
  const response = await runBriefingComparison(post("/api/dev/briefing-comparison", { mode: "account", accountRef: ACCOUNT, preferenceRevision: 4,
    configs: [config(), config("warm", 30)], review: { caseId: CASE, candidates: [candidate("cand-a-000001", "baseline"), candidate("cand-b-000001", "candidate")] } }), generate, store);
  return { runBriefingComparison, generate, response };
}

async function captureWithCalendar() {
  const disclosed = { ...preferences, includeCalendar: true, calendarConnectionGeneration: 4, calendarSelectionRevision: 5 };
  mocks.preferences.mockResolvedValue(disclosed);
  mocks.calendar.mockResolvedValue({ status: "connected", generation: 4, selectionRevision: 5 });
  mocks.capture.mockImplementation(async (_caller, input) => ({ preferences: disclosed, analysisSource: null,
    contexts: input.historyDays.map((days: number) => {
      const context = briefingFixture("sparse", config("calm", days));
      return { ...context, connectors: context.connectors.map(connector => ({ ...connector, connectionGeneration: 4, selectionRevision: 5 })) };
    }), configurationRefs: { behavior_owned: "behavior_fixture" }, assertCurrent: mocks.current }));
  return capture();
}

it("saves captured account inputs once, in the owner's partition, and never returns them to the browser", async () => {
  const { response } = await capture();
  expect(response.status).toBe(200);
  expect((await response.json()).review).toMatchObject({ saved: true });
  const saved = JSON.parse(await readFile(path.join(root, `account-${ACCOUNT}`, CASE, "case.json"), "utf8"));
  expect(saved).toMatchObject({ evidenceType: "captured", source: { mode: "account", accountRef: ACCOUNT, preferenceRevision: 4 }, capture: { historyDays: [90, 30] } });
  expect(saved.inputs.contexts.map((context: { cadence: { history: { lookbackDays: number } } }) => context.cadence.history.lookbackDays)).toEqual([90, 30]);
  expect(mocks.capture).toHaveBeenCalledTimes(1);

  const { readBriefingReviews } = await import("@/lib/services/briefing-review.service");
  const detail = await (await readBriefingReviews(new Request(`${origin}/api/dev/briefing-reviews?source=account&caseId=${CASE}`, { headers: { "sec-fetch-site": "same-origin" } }), store)).json();
  expect(detail.detail.case).toMatchObject({ id: CASE, rerunnable: true });
  expect(detail.detail.case).not.toHaveProperty("inputs");
});

it("reruns a captured account case on its captured clock without a new capture", async () => {
  const { runBriefingComparison, generate } = await capture();
  vi.setSystemTime(new Date("2026-11-03T15:00:00Z"));
  const rerun = await runBriefingComparison(post("/api/dev/briefing-comparison", { mode: "saved", accountRef: ACCOUNT, configs: [config("matter_of_fact", 30)],
    review: { caseId: CASE, candidates: [candidate("cand-b-000002", "candidate")] } }), generate, store);
  expect(rerun.status).toBe(200);
  expect((await rerun.json()).results[0]).toMatchObject({ state: "ready" });
  expect(mocks.capture).toHaveBeenCalledTimes(1);
  expect(JSON.parse(generate.mock.calls[2]![0].facts).context).toEqual(JSON.parse(generate.mock.calls[1]![0].facts).context);
});

it("does not save newly generated account output after its context is withdrawn", async () => {
  const { runBriefingComparison } = await import("@/lib/services/briefing-workbench.service");
  const { DailyBriefError } = await import("@/lib/services/daily-brief-consumer");
  const generate = vi.fn().mockImplementation(async () => {
    mocks.current.mockRejectedValue(new DailyBriefError("context_changed"));
    return output;
  });
  const response = await runBriefingComparison(post("/api/dev/briefing-comparison", { mode: "account", accountRef: ACCOUNT, preferenceRevision: 4,
    configs: [config(), config("warm")], review: { caseId: CASE, candidates: [candidate("cand-a-000001", "baseline"), candidate("cand-b-000001", "candidate")] } }), generate, store);
  expect((await response.json()).error).toBe("context_changed");
  expect(generate).toHaveBeenCalledOnce();
  const detail = await store.readCase(`account-${ACCOUNT}`, CASE);
  expect(detail.runs).toHaveLength(1);
  expect(detail.runs[0]).toMatchObject({ state: "error", validation: "withheld" });
  expect(detail.runs[0]).not.toHaveProperty("briefing");
});

it.each([
  ["a history window that was not captured", () => ({ configs: [config("warm", 14)] }), "input_not_captured"],
  ["briefing access turned off", () => { mocks.preferences.mockResolvedValue({ ...preferences, enabled: false }); return {}; }, "access_denied"],
  ["a Behavior deleted since capture", () => { mocks.behaviorIds.mockResolvedValue([]); return {}; }, "context_changed"],
  ["a different signed-in owner", () => { mocks.authenticate.mockResolvedValue({ user: { id: "other" }, client: {} }); return {}; }, "context_changed"],
])("refuses a rerun after %s", async (_name, arrange, code) => {
  const { runBriefingComparison, generate } = await capture();
  const overrides = arrange();
  const rerun = await runBriefingComparison(post("/api/dev/briefing-comparison", { mode: "saved", accountRef: ACCOUNT, configs: [config("warm", 30)],
    review: { caseId: CASE, candidates: [candidate("cand-b-000003", "candidate")] }, ...overrides }), generate, store);
  expect((await rerun.json()).error).toBe(code);
  expect(generate).toHaveBeenCalledTimes(2);
});

it("checks saved-account consent after candidate storage and before model dispatch", async () => {
  const { runBriefingComparison, generate } = await capture();
  const append = store.append;
  vi.spyOn(store, "append").mockImplementation(async (...args) => {
    await append(...args);
    if (args[2] === "candidates") mocks.preferences.mockResolvedValue({ ...preferences, enabled: false, revision: 5 });
  });
  const response = await runBriefingComparison(post("/api/dev/briefing-comparison", { mode: "saved", accountRef: ACCOUNT, configs: [config("warm", 30)],
    review: { caseId: CASE, candidates: [candidate("cand-b-000004", "candidate")] } }), generate, store);
  expect(response.status).toBe(403);
  expect((await response.json()).error).toBe("access_denied");
  expect(generate).toHaveBeenCalledTimes(2);
});

it("withholds a saved-account result and cancels the next dispatch when generation consent changes", async () => {
  const { runBriefingComparison, generate } = await capture();
  generate.mockImplementationOnce(async () => {
    mocks.preferences.mockResolvedValue({ ...preferences, enabled: false, revision: 5 });
    return output;
  });
  const response = await runBriefingComparison(post("/api/dev/briefing-comparison", { mode: "saved", accountRef: ACCOUNT,
    configs: [config("warm", 30), config("matter_of_fact", 30)],
    review: { caseId: CASE, candidates: [candidate("cand-b-000005", "candidate"), candidate("cand-b-000006", "candidate")] } }), generate, store);
  expect(response.status).toBe(403);
  expect(generate).toHaveBeenCalledTimes(3);
  const detail = await store.readCase(`account-${ACCOUNT}`, CASE);
  expect(detail.runs.at(-1)).toMatchObject({ state: "error", error: "access_denied", validation: "withheld" });
  expect(detail.runs.at(-1)).not.toHaveProperty("briefing");
});

it("deletes an expired account case before a direct saved-case rerun", async () => {
  const { runBriefingComparison, generate } = await capture();
  vi.setSystemTime(new Date("2026-12-03T15:00:00Z"));
  const response = await runBriefingComparison(post("/api/dev/briefing-comparison", { mode: "saved", accountRef: ACCOUNT, configs: [config("warm", 30)],
    review: { caseId: CASE, candidates: [candidate("cand-b-000007", "candidate")] } }), generate, store);
  expect((await response.json()).error).toBe("case_not_found");
  expect(generate).toHaveBeenCalledTimes(2);
  await expect(readFile(path.join(root, `account-${ACCOUNT}`, CASE, "case.json"))).rejects.toMatchObject({ code: "ENOENT" });
});

it.each(["unchanged", "selection", "connection", "reauthorized", "missing capture"])("checks %s Calendar authorization before saved replay", async (change) => {
  const { runBriefingComparison, generate, response } = await captureWithCalendar();
  expect(response.status).toBe(200);
  const saved = await store.readCase(`account-${ACCOUNT}`, CASE);
  expect(saved.case.capture.includeCalendar).toBe(true);
  if (change === "selection" || change === "reauthorized") mocks.calendar.mockResolvedValue({ status: "connected", generation: 4, selectionRevision: 6 });
  if (change === "connection") mocks.calendar.mockResolvedValue({ status: "connected", generation: 5, selectionRevision: 5 });
  if (change === "reauthorized") mocks.preferences.mockResolvedValue({ ...preferences, revision: 5, includeCalendar: true, calendarConnectionGeneration: 4, calendarSelectionRevision: 6 });
  if (change === "missing capture") vi.spyOn(store, "readCase").mockResolvedValue({ ...saved, case: { ...saved.case, inputs: undefined } });
  const replay = await runBriefingComparison(post("/api/dev/briefing-comparison", { mode: "saved", accountRef: ACCOUNT, configs: [config("warm", 30)],
    review: { caseId: CASE, candidates: [candidate("cand-calendar-001", "candidate")] } }), generate, store);
  expect(replay.status).toBe(change === "unchanged" ? 200 : change === "reauthorized" || change === "missing capture" ? 409 : 403);
  expect(generate).toHaveBeenCalledTimes(change === "unchanged" ? 3 : 2);
});

it("withholds saved output when Calendar selection changes during generation", async () => {
  const { runBriefingComparison, generate } = await captureWithCalendar();
  generate.mockImplementationOnce(async () => {
    mocks.calendar.mockResolvedValue({ status: "connected", generation: 4, selectionRevision: 6 });
    return output;
  });
  const response = await runBriefingComparison(post("/api/dev/briefing-comparison", { mode: "saved", accountRef: ACCOUNT, configs: [config("warm", 30), config("calm", 30)],
    review: { caseId: CASE, candidates: [candidate("cand-calendar-002", "candidate"), candidate("cand-calendar-003", "candidate")] } }), generate, store);
  expect(response.status).toBe(403);
  expect(generate).toHaveBeenCalledTimes(3);
  const saved = await store.readCase(`account-${ACCOUNT}`, CASE);
  expect(saved.runs.at(-1)).toMatchObject({ state: "error", error: "access_denied", validation: "withheld" });
  expect(saved.runs.at(-1)).not.toHaveProperty("briefing");
});
