import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as repository from "@/lib/db/oauth.repo";
import { runOAuthMaintenance } from "@/lib/services/oauth-maintenance.service";
import { createServiceRoleClient } from "@/lib/supabase/admin";

vi.mock("@/lib/supabase/admin", () => ({ createServiceRoleClient: vi.fn() }));

const counts = {
  authorization_codes: 1, access_tokens: 2, token_families: 3,
  clients: 4, idempotency_records: 5, activity: 6, rate_limit_counters: 7,
};

describe("OAuth maintenance", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(createServiceRoleClient).mockReturnValue({} as never);
  });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it("records only validated counts and clears the deadline after success", async () => {
    vi.spyOn(repository, "purgeExpiredOAuthRecords").mockResolvedValue(counts);
    await runOAuthMaintenance();
    expect(JSON.parse(vi.mocked(console.info).mock.calls[0][0])).toEqual({
      source: "cadence", name: "oauth_maintenance_completed", severity: "info",
      context: { codes_deleted: 1, access_deleted: 2, families_deleted: 3,
        clients_deleted: 4, retries_deleted: 5, activity_deleted: 6, counters_deleted: 7 },
    });
    expect(console.error).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([new Error("private database text"), new repository.OAuthPersistenceError("OAuth purge result was malformed.", "invalid_purge_result")])(
    "reports failure without counts, exception text or a success event", async (error) => {
      vi.spyOn(repository, "purgeExpiredOAuthRecords").mockRejectedValue(error);
      await expect(runOAuthMaintenance()).resolves.toBeUndefined();
      expect(console.info).not.toHaveBeenCalled();
      expect(JSON.parse(vi.mocked(console.error).mock.calls[0][0])).toEqual({
        source: "cadence", name: "oauth_maintenance_failed", severity: "error", context: { outcome: "unknown" },
      });
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("contains client configuration failures", async () => {
    vi.mocked(createServiceRoleClient).mockImplementationOnce(() => { throw new Error("private config"); });
    await expect(runOAuthMaintenance()).resolves.toBeUndefined();
    expect(console.info).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts at eight seconds and awaits transport cancellation before settling", async () => {
    let finishCancellation!: () => void;
    let requestSignal!: AbortSignal;
    const purge = vi.spyOn(repository, "purgeExpiredOAuthRecords").mockImplementation((_client, signal) => {
      requestSignal = signal;
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => { finishCancellation = () => reject(new Error("aborted private body")); });
      });
    });
    let settled = false;
    const work = runOAuthMaintenance().then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(7999);
    expect(requestSignal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(requestSignal.aborted).toBe(true);
    expect(settled).toBe(false);
    finishCancellation();
    await work;
    expect(purge).toHaveBeenCalledOnce();
    expect(console.info).not.toHaveBeenCalled();
    expect(JSON.parse(vi.mocked(console.error).mock.calls[0][0]).name).toBe("oauth_maintenance_timed_out");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never advances success freshness for a result arriving after the deadline", async () => {
    let resolve!: (value: repository.OAuthPurgeCounts) => void;
    vi.spyOn(repository, "purgeExpiredOAuthRecords").mockImplementation(() => new Promise((r) => { resolve = r; }));
    const work = runOAuthMaintenance();
    await vi.advanceTimersByTimeAsync(8000);
    resolve(counts);
    await work;
    expect(console.info).not.toHaveBeenCalled();
    expect(JSON.parse(vi.mocked(console.error).mock.calls[0][0]).name).toBe("oauth_maintenance_timed_out");
  });
});
