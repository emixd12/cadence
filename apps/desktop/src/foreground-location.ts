import { invoke, isTauri } from "@tauri-apps/api/core";
import { validateForegroundLocation, type ForegroundLocation, type LocationPermission } from "@/lib/ui/foreground-location";

/** Reads the OS grant without starting a position request or competing with one. */
export async function readMacLocationPermission(): Promise<LocationPermission> {
  if (!isTauri()) return "unavailable";
  try {
    const value = await invoke<unknown>("location_permission");
    return value === "granted" || value === "prompt" || value === "denied" ? value : "unavailable";
  } catch { return "unavailable"; }
}

export async function readMacForegroundLocation(requestPermission = false): Promise<ForegroundLocation> {
  if (!isTauri()) return { state: "unavailable", reason: "bridge" };
  if (document.hidden) return { state: "unavailable", reason: "hidden" };
  try {
    const value = await invoke<unknown>("foreground_location", { requestPermission });
    return document.hidden ? { state: "unavailable", reason: "hidden" } : validateForegroundLocation(value, Date.now());
  } catch { return { state: "unavailable", reason: "bridge" }; }
}

/** Opens System Settings › Privacy & Security › Location Services. The native command takes no URL. */
export async function openMacLocationSettings(): Promise<void> {
  if (!isTauri()) throw new Error("System Settings opens only from the desktop app.");
  await invoke("open_location_settings");
}
