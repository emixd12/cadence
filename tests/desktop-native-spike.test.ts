import { afterEach, expect, test, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => false }));
import { cancelProbes, scheduleProbe } from "../apps/desktop/src/native-spike";

afterEach(() => { vi.useRealTimers(); invoke.mockReset(); });

test("native probes validate input and replace stable IDs", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-30T12:00:00.000Z"));
  for (const [count, delay] of [[0, 30], [4097, 30], [1.5, 30], [1, NaN], [1, 9], [1, 2592001]]) {
    await expect(scheduleProbe(count, delay)).rejects.toThrow();
  }
  expect(invoke).not.toHaveBeenCalled();
  invoke.mockResolvedValue({ pending: [] });
  await scheduleProbe(2, 30);
  const request = invoke.mock.calls[0][1].request;
  expect(request.reminders.map(({ id, fireAt }: { id: string; fireAt: string }) => ({ id, fireAt }))).toEqual([
    { id: "cadence-spike.1", fireAt: "2026-08-30T12:00:30.000Z" },
    { id: "cadence-spike.2", fireAt: "2026-08-30T12:00:30.000Z" },
  ]);
  await scheduleProbe(2, 30);
  expect(invoke.mock.calls[1][1]).toEqual(invoke.mock.calls[0][1]);
});

test("cancellation includes only probe IDs, deduplicates overlaps, and preserves read failures", async () => {
  for (const [pending, delivered, ids] of [
    [["cadence-spike.1", "cadence-spike.2"], ["cadence-spike.2", "cadence-spike.3"], ["cadence-spike.1", "cadence-spike.2", "cadence-spike.3"]],
    [[], ["cadence-spike.delivered-only"], ["cadence-spike.delivered-only"]],
    [["cadence.local.00000000-0000-4000-a000-000000000010", "cadence-spike.1"],
      ["cadence-spike.1", "cadence-spike.delivered-only", "cadence.local.00000000-0000-4000-a000-000000000020"],
      ["cadence-spike.1", "cadence-spike.delivered-only"]],
    [["cadence.local.00000000-0000-4000-a000-000000000010"],
      ["cadence.local.00000000-0000-4000-a000-000000000020"], []],
    [[], [], []],
  ]) {
    invoke.mockReset();
    invoke.mockResolvedValueOnce({ pending: pending.map((id) => ({ id })) });
    invoke.mockResolvedValueOnce({ delivered: delivered.map((id) => ({ id })) });
    invoke.mockResolvedValueOnce({ pending: [] });
    await expect(cancelProbes()).resolves.toEqual({ pending: [] });
    expect(invoke).toHaveBeenNthCalledWith(1, "native_notifications", { request: { operation: "pending" } });
    expect(invoke).toHaveBeenNthCalledWith(2, "native_notifications", { request: { operation: "delivered" } });
    expect(invoke).toHaveBeenLastCalledWith("native_notifications", { request: { operation: "cancel", ids } });
  }

  invoke.mockReset();
  invoke.mockResolvedValueOnce({ pending: [{ id: "cadence-spike.1" }] });
  invoke.mockRejectedValueOnce(new Error("Delivered notification lookup failed."));
  await expect(cancelProbes()).rejects.toThrow("Delivered notification lookup failed.");
  expect(invoke).toHaveBeenCalledTimes(2);
});
