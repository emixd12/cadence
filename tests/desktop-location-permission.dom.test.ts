// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { readMacForegroundLocation, readMacLocationPermission } from "../apps/desktop/src/foreground-location";

const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => native);

beforeEach(() => {
  vi.resetAllMocks();
  native.isTauri.mockReturnValue(true);
});

it.each(["granted", "prompt", "denied", "unavailable"] as const)("reads %s through the status-only command", async (state) => {
  native.invoke.mockResolvedValue(state);
  await expect(readMacLocationPermission()).resolves.toBe(state);
  expect(native.invoke).toHaveBeenCalledExactlyOnceWith("location_permission");
});

it.each([null, 3, { state: "available", latitude: 1, longitude: 1 }, "unknown"])("does not infer a grant from an invalid native response %j", async (response) => {
  native.invoke.mockResolvedValue(response);
  await expect(readMacLocationPermission()).resolves.toBe("unavailable");
});

it("keeps missing or rejected bridges unavailable", async () => {
  native.isTauri.mockReturnValue(false);
  await expect(readMacLocationPermission()).resolves.toBe("unavailable");
  expect(native.invoke).not.toHaveBeenCalled();
  native.isTauri.mockReturnValue(true);
  native.invoke.mockRejectedValue(new Error("not registered"));
  await expect(readMacLocationPermission()).resolves.toBe("unavailable");
});

it("retains coordinate reads without prompting for Timeline travel", async () => {
  const sample = { state: "available", latitude: 1, longitude: 1, accuracyMeters: 10, sampledAt: Date.now() };
  native.invoke.mockResolvedValue(sample);
  await expect(readMacForegroundLocation(false)).resolves.toEqual(sample);
  expect(native.invoke).toHaveBeenCalledExactlyOnceWith("foreground_location", { requestPermission: false });
});
