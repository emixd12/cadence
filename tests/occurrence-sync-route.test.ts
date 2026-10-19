import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as breakers from "@/lib/security/launch-circuit-breakers";
import { resetAuthFailureRateLimitersForTests } from "@/lib/security/auth-failure-rate-limits";
import { processOccurrenceSyncHorizons } from "@/lib/services/occurrence.service";
import { runOAuthMaintenance } from "@/lib/services/oauth-maintenance.service";
import { GET, POST } from "../app/api/occurrences/sync/route";

vi.mock("@/lib/services/occurrence.service", () => ({
  processOccurrenceSyncHorizons: vi.fn(),
}));

vi.mock("@/lib/services/oauth-maintenance.service", () => ({ runOAuthMaintenance: vi.fn() }));

const ORIGINAL_SECRET = process.env.REMINDER_PROCESS_SECRET;
const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;
const ORIGINAL_BATCH_BREAKER =
  process.env.CADENCE_DISABLE_OCCURRENCE_SYNC_BATCHES;

describe("occurrence sync route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(runOAuthMaintenance).mockResolvedValue(undefined);
    resetAuthFailureRateLimitersForTests();
    process.env.REMINDER_PROCESS_SECRET = "process-secret";
    process.env.CRON_SECRET = "";
    restoreEnv(
      "CADENCE_DISABLE_OCCURRENCE_SYNC_BATCHES",
      ORIGINAL_BATCH_BREAKER,
    );
    vi.mocked(processOccurrenceSyncHorizons).mockResolvedValue({
      checked: 2,
      synced: 1,
      skipped: 1,
      failed: 0,
    });
  });

  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  afterAll(() => {
    restoreEnv("REMINDER_PROCESS_SECRET", ORIGINAL_SECRET);
    restoreEnv("CRON_SECRET", ORIGINAL_CRON_SECRET);
    restoreEnv(
      "CADENCE_DISABLE_OCCURRENCE_SYNC_BATCHES",
      ORIGINAL_BATCH_BREAKER,
    );
  });

  it("does no work when the process secret is not configured", async () => {
    delete process.env.REMINDER_PROCESS_SECRET;
    delete process.env.CRON_SECRET;

    const response = await POST(
      new NextRequest("http://localhost:3000/api/occurrences/sync", {
        method: "POST",
      }),
    );

    await expect(response.json()).resolves.toMatchObject({
      ok: false,
    });
    expect(response.status).toBe(503);
    expect(processOccurrenceSyncHorizons).not.toHaveBeenCalled();
    expect(runOAuthMaintenance).not.toHaveBeenCalled();
  });

  it("rejects requests without the configured secret", async () => {
    const response = await POST(
      new NextRequest("http://localhost:3000/api/occurrences/sync", {
        method: "POST",
        headers: {
          "x-reminder-process-secret": "wrong-secret",
        },
      }),
    );

    await expect(response.json()).resolves.toMatchObject({
      ok: false,
    });
    expect(response.status).toBe(401);
    expect(processOccurrenceSyncHorizons).not.toHaveBeenCalled();
    expect(runOAuthMaintenance).not.toHaveBeenCalled();
  });

  it("syncs horizons with the configured secret", async () => {
    const response = await POST(
      new NextRequest("http://localhost:3000/api/occurrences/sync?limit=3", {
        method: "POST",
        headers: {
          authorization: "Bearer process-secret",
        },
      }),
    );

    await expect(response.json()).resolves.toEqual({
      ok: true,
      result: {
        checked: 2,
        synced: 1,
        skipped: 1,
        failed: 0,
      },
    });
    expect(response.status).toBe(200);
    expect(processOccurrenceSyncHorizons).toHaveBeenCalledWith({
      limit: 3,
    });
  });

  it("bounds the manual processing limit", async () => {
    const response = await POST(
      new NextRequest("http://localhost:3000/api/occurrences/sync?limit=10000", {
        method: "POST",
        headers: {
          authorization: "Bearer process-secret",
        },
      }),
    );

    await expect(response.json()).resolves.toMatchObject({
      ok: true,
    });
    expect(response.status).toBe(200);
    expect(processOccurrenceSyncHorizons).toHaveBeenCalledWith({
      limit: 100,
    });
  });

  it("stops only occurrence batches when the launch breaker is open", async () => {
    process.env.CADENCE_DISABLE_OCCURRENCE_SYNC_BATCHES = "1";

    const response = await POST(
      new NextRequest("http://localhost:3000/api/occurrences/sync", {
        method: "POST",
        headers: {
          authorization: "Bearer process-secret",
        },
      }),
    );

    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Occurrence sync is temporarily unavailable.",
    });
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("300");
    expect(runOAuthMaintenance).toHaveBeenCalledOnce();
    expect(processOccurrenceSyncHorizons).not.toHaveBeenCalled();
  });

  it("processes Vercel Cron GET requests with the cron secret", async () => {
    delete process.env.REMINDER_PROCESS_SECRET;
    process.env.CRON_SECRET = "cron-secret";

    const response = await GET(
      new NextRequest("http://localhost:3000/api/occurrences/sync", {
        method: "GET",
        headers: {
          authorization: "Bearer cron-secret",
        },
      }),
    );

    await expect(response.json()).resolves.toMatchObject({
      ok: true,
    });
    expect(response.status).toBe(200);
    expect(processOccurrenceSyncHorizons).toHaveBeenCalledWith({
      limit: undefined,
    });
  });
  function authorizedRequest() {
    return new NextRequest("http://localhost:4321/api/occurrences/sync", {
      headers: { authorization: "Bearer process-secret" },
    });
  }

  it("does not purge after authentication rate limiting", async () => {
    let status = 0;
    for (let index = 0; index < 30; index++) {
      status = (await GET(new NextRequest("http://localhost:4321/api/occurrences/sync"))).status;
    }
    expect(status).toBe(429);
    expect(runOAuthMaintenance).not.toHaveBeenCalled();
  });

  it("purges with zero profiles and MCP disabled", async () => {
    vi.stubEnv("CADENCE_MCP_ENABLED", "false");
    vi.mocked(processOccurrenceSyncHorizons).mockResolvedValue({ checked: 0, synced: 0, skipped: 0, failed: 0 });
    expect((await GET(authorizedRequest())).status).toBe(200);
    expect(runOAuthMaintenance).toHaveBeenCalledOnce();
  });

  it.each(["archive failure", "target query failure"])("preserves early sync error response: %s", async (message) => {
    vi.mocked(processOccurrenceSyncHorizons).mockRejectedValueOnce(new Error(message));
    const response = await GET(authorizedRequest());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, error: "Unable to sync occurrences." });
    expect(runOAuthMaintenance).toHaveBeenCalledOnce();
  });

  it.each(["timeout", "malformed result", "unexpected rejection"])("does not block sync on maintenance %s", async (message) => {
    vi.mocked(runOAuthMaintenance).mockRejectedValueOnce(new Error(message));
    expect((await GET(authorizedRequest())).status).toBe(200);
    expect(processOccurrenceSyncHorizons).toHaveBeenCalledOnce();
  });

  it.each(["success", "breaker", "sync failure", "unexpected breaker failure"])(
    "starts independently and awaits maintenance on %s exit", async (path) => {
      let finish!: () => void;
      vi.mocked(runOAuthMaintenance).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
      const unexpected = new Error("unexpected breaker");
      if (path === "breaker") process.env.CADENCE_DISABLE_OCCURRENCE_SYNC_BATCHES = "1";
      if (path === "sync failure") vi.mocked(processOccurrenceSyncHorizons).mockRejectedValueOnce(new Error("failure"));
      if (path === "unexpected breaker failure") vi.spyOn(breakers, "assertLaunchCircuitBreakerClosed").mockImplementationOnce(() => {
        expect(runOAuthMaintenance).toHaveBeenCalledOnce();
        throw unexpected;
      });
      let settled = false;
      const request = GET(authorizedRequest());
      const observed = request.then(() => { settled = true; }, () => { settled = true; });
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      expect(runOAuthMaintenance).toHaveBeenCalledOnce();
      if (path === "success" || path === "sync failure") expect(processOccurrenceSyncHorizons).toHaveBeenCalledOnce();
      else expect(processOccurrenceSyncHorizons).not.toHaveBeenCalled();
      expect(settled).toBe(false);
      finish();
      await observed;
      if (path === "unexpected breaker failure") await expect(request).rejects.toBe(unexpected);
      else expect((await request).status).toBe(path === "breaker" ? 503 : path === "sync failure" ? 500 : 200);
    },
  );

});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}
