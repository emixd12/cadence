import { describe, expect, it, vi } from "vitest";

import { readTravelMonthSpend, reserveTravelProviderSpend } from "@/lib/db/travelSpend.repo";

describe("travel spend repository", () => {
  it("reserves list-price microdollars through the atomic budget function", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ allowed: true, retry_after_seconds: 0, resets_at: null }], error: null });
    await expect(reserveTravelProviderSpend({ rpc } as never, 15_000)).resolves.toEqual({ allowed: true, retryAfterSeconds: 0, resetsAt: null });
    expect(rpc).toHaveBeenCalledWith("reserve_travel_provider_spend", { requested_microdollars: 15_000 });
  });

  it("returns the renewal instant with a refusal", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ allowed: false, retry_after_seconds: 3_600, resets_at: "2026-11-01T04:00:00+00:00" }], error: null });
    await expect(reserveTravelProviderSpend({ rpc } as never, 5_000)).resolves.toEqual({ allowed: false, retryAfterSeconds: 3_600, resetsAt: "2026-11-01T04:00:00+00:00" });
  });

  it("fails closed for a malformed decision", async () => {
    await expect(reserveTravelProviderSpend({ rpc: vi.fn().mockResolvedValue({ data: [], error: null }) } as never, 5_000)).rejects.toThrow("did not return a decision");
    await expect(reserveTravelProviderSpend({ rpc: vi.fn().mockResolvedValue({ data: [{ allowed: false, retry_after_seconds: 60, resets_at: null }], error: null }) } as never, 5_000)).rejects.toThrow("did not return a decision");
  });
});


it("reads only the selected owner's local month and distinguishes failure from zero", async () => {
  const maybeSingle = vi.fn().mockResolvedValue({ data: { reserved_microdollars: 125_000 }, error: null });
  const eq = vi.fn().mockReturnThis();
  const select = vi.fn(() => ({ eq, maybeSingle }));
  eq.mockReturnValue({ eq, maybeSingle });
  const from = vi.fn(() => ({ select }));
  expect(await readTravelMonthSpend({ from } as never, "owner", "2026-11-01")).toBe(125_000);
  expect(from).toHaveBeenCalledWith("travel_spend_owner_month");
  expect(eq.mock.calls).toEqual([["user_id", "owner"], ["local_month", "2026-11-01"]]);
  maybeSingle.mockResolvedValue({ data: null, error: null } as never);
  expect(await readTravelMonthSpend({ from } as never, "owner", "2026-11-01")).toBe(0);
  maybeSingle.mockResolvedValue({ data: null, error: new Error("unavailable") } as never);
  await expect(readTravelMonthSpend({ from } as never, "owner", "2026-11-01")).rejects.toThrow("unavailable");
});
