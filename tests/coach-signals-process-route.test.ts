import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { agentCallerConfigured } from "@/lib/integrations/agent-caller";
import { reportMonitoringEvent } from "@/lib/monitoring/privacy-safe-events";
import { resetAuthFailureRateLimitersForTests } from "@/lib/security/auth-failure-rate-limits";
import { agentModelConfigured } from "@/lib/services/agent-model";
import { processCoachTips } from "@/lib/services/advisor-tips-job.service";
import { processCoachSignals } from "@/lib/services/coach-signals-job.service";

vi.mock("@/lib/services/coach-signals-job.service", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/services/coach-signals-job.service")>();
  return {
    coachSignalsEnabled: original.coachSignalsEnabled,
    processCoachSignals: vi.fn(),
    visitCoachAccount: vi.fn(),
    createHostedCoachVisitPort: vi.fn(),
    hostedDueCoachAccounts: vi.fn(() => vi.fn()),
  };
});
vi.mock("@/lib/services/advisor-tips-job.service", () => ({
  processCoachTips: vi.fn(),
  visitAdvisorTips: vi.fn(),
  createHostedTipVisitPort: vi.fn(),
  hostedDueTipAccounts: vi.fn(() => vi.fn()),
}));
vi.mock("@/lib/services/agent-model", () => ({
  agentModelConfigured: vi.fn(() => true),
  agentModelSetting: vi.fn(() => ({ model: "openai/gpt-5.6-luna", reasoning: "low", maxOutputTokens: 1000, timeoutMs: 30000 })),
}));
vi.mock("@/lib/integrations/agent-caller", () => ({ agentCallerConfigured: vi.fn(() => true) }));
vi.mock("@/lib/supabase/admin", () => ({ createServiceRoleClient: vi.fn(() => ({})) }));
vi.mock("@/lib/monitoring/privacy-safe-events", () => ({ reportMonitoringEvent: vi.fn(), reportMonitoringError: vi.fn() }));

const URL_PATH = "http://localhost:3000/api/advisor/coach/signals/process";
const RESULT = { enabled: true, pages: 1, selected: 2, visited: 2, skipped: 0, failed: 0, signals: 5 };
const TIPS = { pages: 1, selected: 1, visited: 1, leftOver: 0, failed: 0, written: 3, modelCalls: 1, modelFailures: 0 };

async function loadRoute() {
  vi.resetModules();
  return import("../app/api/advisor/coach/signals/process/route");
}

function request(headers: Record<string, string> = { authorization: "Bearer cron-secret" }) {
  return new NextRequest(URL_PATH, { method: "GET", headers });
}

describe("coach signals process route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAuthFailureRateLimitersForTests();
    vi.stubEnv("CRON_SECRET", "cron-secret");
    vi.stubEnv("CADENCE_COACH_SIGNALS", "");
    vi.mocked(agentCallerConfigured).mockReturnValue(true);
    vi.mocked(processCoachSignals).mockResolvedValue(RESULT);
    vi.mocked(processCoachTips).mockResolvedValue(TIPS);
    vi.mocked(agentModelConfigured).mockReturnValue(true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does nothing without CRON_SECRET, and accepts only that secret", async () => {
    const { GET } = await loadRoute();
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(request())).status).toBe(503);
    vi.stubEnv("CRON_SECRET", "cron-secret");
    expect((await GET(request({ authorization: "Bearer other-secret" }))).status).toBe(401);
    expect(processCoachSignals).not.toHaveBeenCalled();
  });

  it("stops when switched off", async () => {
    const { GET } = await loadRoute();
    vi.stubEnv("CADENCE_COACH_SIGNALS", "off");
    await expect((await GET(request())).json()).resolves.toEqual({ ok: true, enabled: false, result: null });
    expect(processCoachSignals).not.toHaveBeenCalled();
  });

  it("refuses to run without an agent signing key", async () => {
    const { GET } = await loadRoute();
    vi.mocked(agentCallerConfigured).mockReturnValue(false);
    expect((await GET(request())).status).toBe(503);
    expect(processCoachSignals).not.toHaveBeenCalled();
  });

  it("runs the job and reports counts only", async () => {
    const { GET, POST } = await loadRoute();
    await expect((await GET(request())).json()).resolves.toEqual({ ok: true, enabled: true, result: RESULT, tips: TIPS });
    expect((await POST(new NextRequest(URL_PATH, { method: "POST", headers: { authorization: "Bearer cron-secret" } }))).status).toBe(200);
    expect(reportMonitoringEvent).toHaveBeenCalledWith({
      name: "coach_signals_process_completed",
      context: { route: "/api/advisor/coach/signals/process", method: "GET", ...RESULT },
    });
    expect(reportMonitoringEvent).toHaveBeenCalledWith({
      name: "coach_tips_process_completed",
      context: { route: "/api/advisor/coach/signals/process", method: "GET", ...TIPS },
    });
    // Signals get their own time allowance before tips (review call T6).
    expect(vi.mocked(processCoachSignals).mock.calls[0]![0].runBudgetMs).toBeLessThan(30_000);
    expect(vi.mocked(processCoachTips).mock.calls[0]![0].runBudgetMs).toBeLessThan(30_000);
  });

  it("stores signals but writes no tips when no model is configured", async () => {
    const { GET } = await loadRoute();
    vi.mocked(agentModelConfigured).mockReturnValue(false);
    await expect((await GET(request())).json()).resolves.toEqual({ ok: true, enabled: true, result: RESULT, tips: null });
    expect(processCoachTips).not.toHaveBeenCalled();
  });

  it("returns 500 when the job throws", async () => {
    const { GET } = await loadRoute();
    vi.mocked(processCoachSignals).mockRejectedValue(new Error("db down"));
    expect((await GET(request())).status).toBe(500);
  });
});
