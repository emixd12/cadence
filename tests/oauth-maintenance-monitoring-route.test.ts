import { setImmediate } from "node:timers/promises";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as monitoring from "@/lib/monitoring/privacy-safe-events";
import * as breakers from "@/lib/security/launch-circuit-breakers";
import { resetAuthFailureRateLimitersForTests } from "@/lib/security/auth-failure-rate-limits";
import { processOccurrenceSyncHorizons } from "@/lib/services/occurrence.service";
import { purgeExpiredOAuthRecords } from "@/lib/db/oauth.repo";
import { GET } from "@/app/api/occurrences/sync/route";

// Keep the real maintenance service and route so both reporting attempts execute.
vi.mock("@/lib/services/occurrence.service", () => ({ processOccurrenceSyncHorizons: vi.fn() }));
vi.mock("@/lib/db/oauth.repo", () => ({ purgeExpiredOAuthRecords: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createServiceRoleClient: () => ({}) }));
const syncResult = { checked: 0, synced: 0, skipped: 0, failed: 0 };

function request() {
  return GET(new NextRequest("http://127.0.0.1:4321/api/occurrences/sync", {
    headers: { authorization: "Bearer synthetic-secret" },
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  resetAuthFailureRateLimitersForTests();
  vi.stubEnv("REMINDER_PROCESS_SECRET", "synthetic-secret");
  vi.stubEnv("CRON_SECRET", "");
  vi.stubEnv("CADENCE_DISABLE_OCCURRENCE_SYNC_BATCHES", "");
  vi.mocked(purgeExpiredOAuthRecords).mockRejectedValue(new Error("private purge failure"));
  vi.mocked(processOccurrenceSyncHorizons).mockResolvedValue(syncResult);
  vi.spyOn(monitoring, "reportMonitoringEvent").mockImplementation((event) => {
    if (event.name.startsWith("oauth_maintenance_")) throw new Error("OAuth monitoring sink failed");
  });
  vi.spyOn(monitoring, "reportMonitoringError").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("maintenance reporting failure boundary", () => {
  it.each(["success", "breaker", "sync failure"])("preserves %s response and clears the maintenance timer", async (path) => {
    vi.useFakeTimers();
    if (path === "breaker") vi.stubEnv("CADENCE_DISABLE_OCCURRENCE_SYNC_BATCHES", "1");
    if (path === "sync failure") vi.mocked(processOccurrenceSyncHorizons).mockRejectedValueOnce(new Error("sync failed"));
    const response = await request();
    expect(response.status).toBe(path === "breaker" ? 503 : path === "sync failure" ? 500 : 200);
    expect(await response.json()).toEqual(path === "breaker"
      ? { ok: false, error: "Occurrence sync is temporarily unavailable." }
      : path === "sync failure" ? { ok: false, error: "Unable to sync occurrences." }
      : { ok: true, result: syncResult });
    if (path === "breaker") expect(response.headers.get("retry-after")).toBe("300");
    expect(vi.getTimerCount()).toBe(0);
    expect(purgeExpiredOAuthRecords).toHaveBeenCalledOnce();
    expect(vi.mocked(monitoring.reportMonitoringEvent).mock.calls.filter(([event]) => event.name === "oauth_maintenance_failed")).toHaveLength(2);
  });

  it.each(["breaker", "occurrence error reporter"])("preserves the original unexpected %s exception", async (path) => {
    const original = new Error("original occurrence path failure");
    if (path === "breaker") vi.spyOn(breakers, "assertLaunchCircuitBreakerClosed").mockImplementationOnce(() => { throw original; });
    else {
      vi.mocked(processOccurrenceSyncHorizons).mockRejectedValueOnce(new Error("sync failed"));
      vi.mocked(monitoring.reportMonitoringError).mockImplementationOnce(() => { throw original; });
    }
    await expect(request()).rejects.toBe(original);
    expect(purgeExpiredOAuthRecords).toHaveBeenCalledOnce();
  });

  it("observes maintenance rejection immediately while occurrence work is delayed", async () => {
    let finish!: (value: typeof syncResult) => void;
    vi.mocked(processOccurrenceSyncHorizons).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    let settled = false;
    const pending = request();
    const observed = pending.then(() => { settled = true; }, () => { settled = true; });
    try {
      await setImmediate(); await setImmediate();
      expect(settled).toBe(false);
      expect(unhandled).not.toHaveBeenCalled();
      expect(purgeExpiredOAuthRecords).toHaveBeenCalledOnce();
    } finally {
      finish(syncResult);
      await observed;
      process.off("unhandledRejection", unhandled);
    }
    expect((await pending).status).toBe(200);
  });

  it("still awaits delayed maintenance when every OAuth reporting attempt throws", async () => {
    let reject!: (error: Error) => void;
    vi.mocked(purgeExpiredOAuthRecords).mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    let settled = false;
    const pending = request();
    const observed = pending.then(() => { settled = true; }, () => { settled = true; });
    await setImmediate();
    expect(processOccurrenceSyncHorizons).toHaveBeenCalledOnce();
    expect(settled).toBe(false);
    reject(new Error("private late purge failure"));
    await observed;
    expect((await pending).status).toBe(200);
  });

  it("contains logging failure after a successful purge without retrying", async () => {
    vi.mocked(purgeExpiredOAuthRecords).mockResolvedValueOnce({
      authorization_codes: 0, access_tokens: 0, token_families: 0, clients: 0,
      idempotency_records: 0, activity: 0, rate_limit_counters: 0,
    });
    expect((await request()).status).toBe(200);
    expect(purgeExpiredOAuthRecords).toHaveBeenCalledOnce();
  });
});
