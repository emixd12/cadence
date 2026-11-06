import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { reportMonitoringEvent } from "@/lib/monitoring/privacy-safe-events";
import { resetAuthFailureRateLimitersForTests } from "@/lib/security/auth-failure-rate-limits";
import { createLeaveReminderDelivery } from "@/lib/services/leave-reminder-delivery";
import { processLeaveReminders } from "@/lib/services/leave-reminder-job.service";
import { assertTravelProviderReady, readTravelProviderConfig } from "@/lib/services/travel-provider";

vi.mock("@/lib/services/leave-reminder-job.service", () => ({
  processLeaveReminders: vi.fn(),
  createHostedLeaveReminderAccountPort: vi.fn(),
  hostedDueAccountSelection: vi.fn(() => vi.fn()),
}));
vi.mock("@/lib/services/leave-reminder-delivery", () => ({ createLeaveReminderDelivery: vi.fn() }));
vi.mock("@/lib/services/travel-provider", () => ({ readTravelProviderConfig: vi.fn(() => ({})), assertTravelProviderReady: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createServiceRoleClient: vi.fn(() => ({})) }));
vi.mock("@/lib/monitoring/privacy-safe-events", () => ({ reportMonitoringEvent: vi.fn(), reportMonitoringError: vi.fn() }));

const URL_PATH = "http://localhost:3000/api/travel/leave-reminders/process";
const RESULT = { selected: 1, visited: 1, skipped: 0, failed: 0, planned: 1, sent: 0, updates: 0, failedReminders: 0, cancelled: 0 };

async function loadRoute() {
  vi.resetModules();
  return import("../app/api/travel/leave-reminders/process/route");
}

function request(headers: Record<string, string> = { authorization: "Bearer cron-secret" }) {
  return new NextRequest(URL_PATH, { method: "GET", headers });
}

describe("leave reminder process route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAuthFailureRateLimitersForTests();
    vi.stubEnv("CRON_SECRET", "cron-secret");
    vi.stubEnv("REMINDER_PROCESS_SECRET", "other-secret");
    vi.stubEnv("CADENCE_LEAVE_REMINDER_JOB", "enabled");
    vi.stubEnv("CADENCE_DISABLE_LEAVE_REMINDER_BATCHES", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("VERCEL_OIDC_TOKEN_FILE", "");
    vi.stubEnv("VERCEL_OIDC_TOKEN", "");
    vi.mocked(createLeaveReminderDelivery).mockReturnValue(vi.fn());
    vi.mocked(processLeaveReminders).mockResolvedValue(RESULT);
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
    expect((await GET(request({ "x-reminder-process-secret": "cron-secret" }))).status).toBe(401);
    expect(processLeaveReminders).not.toHaveBeenCalled();
  });

  it("stays off until the server flag is exactly enabled", async () => {
    const { GET } = await loadRoute();
    for (const value of ["", "1", "true", "Enabled"]) {
      vi.stubEnv("CADENCE_LEAVE_REMINDER_JOB", value);
      const response = await GET(request());
      await expect(response.json()).resolves.toEqual({ ok: true, enabled: false, result: null });
    }
    expect(readTravelProviderConfig).not.toHaveBeenCalled();
    expect(processLeaveReminders).not.toHaveBeenCalled();
  });

  it("stops before any account is read when its circuit breaker is open", async () => {
    const { GET } = await loadRoute();
    vi.stubEnv("CADENCE_DISABLE_LEAVE_REMINDER_BATCHES", "1");
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("300");
    expect(processLeaveReminders).not.toHaveBeenCalled();
  });

  it("fails closed without travel estimates or a delivery", async () => {
    const { GET } = await loadRoute();
    vi.mocked(assertTravelProviderReady).mockImplementationOnce(() => { throw new Error("not_configured"); });
    expect((await GET(request())).status).toBe(503);
    vi.mocked(createLeaveReminderDelivery).mockReturnValueOnce(null);
    expect((await GET(request())).status).toBe(503);
    expect(processLeaveReminders).not.toHaveBeenCalled();
  });

  it("runs a bounded batch and reports counts only", async () => {
    const { GET } = await loadRoute();
    const response = await GET(new NextRequest(`${URL_PATH}?limit=7`, { headers: { authorization: "Bearer cron-secret" } }));
    await expect(response.json()).resolves.toEqual({ ok: true, enabled: true, result: RESULT });
    expect(processLeaveReminders).toHaveBeenCalledWith(expect.objectContaining({ limit: 7 }));
  });

  it("reads the OIDC subject token from the header, then the file, then the variable", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cadence-oidc-"));
    try {
      const file = join(directory, "token");
      writeFileSync(file, "file-token\n");
      vi.stubEnv("VERCEL_OIDC_TOKEN_FILE", file);
      vi.stubEnv("VERCEL_OIDC_TOKEN", "env-token");
      const { GET } = await loadRoute();
      await GET(request({ authorization: "Bearer cron-secret", "x-vercel-oidc-token": "header-token" }));
      await GET(request());
      vi.stubEnv("VERCEL_OIDC_TOKEN_FILE", join(directory, "missing"));
      await GET(request());
      vi.stubEnv("VERCEL_OIDC_TOKEN", "");
      await GET(request());
      expect(vi.mocked(readTravelProviderConfig).mock.calls.map((call) => call[1])).toEqual(["header-token", "file-token", "env-token", null]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("logs only whether the token was present, once, in production", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("VERCEL_OIDC_TOKEN", "secret-oidc-value");
    const { GET } = await loadRoute();
    await GET(request());
    await GET(request());
    const presence = vi.mocked(reportMonitoringEvent).mock.calls.filter(([event]) => event.name === "leave_reminder_process_oidc_subject");
    expect(presence).toHaveLength(1);
    expect(presence[0]![0].context).toMatchObject({ oidc_subject_present: true, oidc_subject_source: "env" });
    expect(JSON.stringify(vi.mocked(reportMonitoringEvent).mock.calls)).not.toContain("secret-oidc-value");
  });
});
