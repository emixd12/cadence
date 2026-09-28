import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_BRIEFING_CONFIG } from "@cadence/core/services/briefing-config";
import type { BriefingConfig } from "@cadence/core/types/briefing-config";
import { briefingFixture } from "@/lib/services/briefing-fixtures";
import { createBriefingBenchStore, type BriefingBenchStore } from "@/lib/services/briefing-bench-store";

const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), preferences: vi.fn(), behaviorIds: vi.fn(), capture: vi.fn(), current: vi.fn() }));
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
  vi.resetModules(); vi.resetAllMocks(); vi.stubEnv("NODE_ENV", "development");
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
