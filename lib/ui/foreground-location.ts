"use client";

export type ForegroundLocation =
  | Readonly<{ state: "available"; latitude: number; longitude: number; accuracyMeters: number; sampledAt: number }>
  | Readonly<{ state: "denied" | "unavailable"; reason?: string }>
  | Readonly<{ state: "prompt" | "revoked" | "stale" | "inaccurate" }>;

export type LocationPermission = "granted" | "prompt" | "denied" | "unavailable";

/** Reads permission only. It never requests permission or a device position. */
export async function readBrowserLocationPermission(): Promise<LocationPermission> {
  if (typeof navigator === "undefined" || typeof navigator.permissions?.query !== "function") return "unavailable";
  try { return (await navigator.permissions.query({ name: "geolocation" })).state; }
  catch { return "unavailable"; }
}

export function validateForegroundLocation(value: unknown, now: number): ForegroundLocation {
  if (!value || typeof value !== "object") return { state: "unavailable" };
  const row = value as Record<string, unknown>;
  if (row.state !== "available") {
    const state = row.state === "denied" || row.state === "prompt" || row.state === "revoked" ? row.state : "unavailable";
    if ((state === "denied" || state === "unavailable") && typeof row.reason === "string" && row.reason) return { state, reason: row.reason };
    return { state };
  }
  const { latitude, longitude, accuracyMeters, sampledAt } = row;
  if (typeof latitude !== "number" || !Number.isFinite(latitude) || Math.abs(latitude) > 90 ||
    typeof longitude !== "number" || !Number.isFinite(longitude) || Math.abs(longitude) > 180 ||
    typeof sampledAt !== "number" || !Number.isFinite(sampledAt) || sampledAt > now ||
    typeof accuracyMeters !== "number" || !Number.isFinite(accuracyMeters) || accuracyMeters < 0) return { state: "unavailable" };
  if (now - sampledAt > 60_000) return { state: "stale" };
  if (accuracyMeters > 100) return { state: "inaccurate" };
  return { state: "available", latitude, longitude, accuracyMeters, sampledAt };
}

/** A new OS prompt is allowed only by the setup button. Samples are never retained here. */
export async function readBrowserForegroundLocation(requestPermission = false): Promise<ForegroundLocation> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return { state: "unavailable", reason: "no_geolocation" };
  if (!window.isSecureContext) return { state: "unavailable", reason: "insecure_context" };
  if (document.hidden || !document.hasFocus()) return { state: "unavailable", reason: "hidden" };
  let permission: PermissionStatus | null = null;
  try { permission = await navigator.permissions?.query({ name: "geolocation" }) ?? null; } catch { /* Some browsers omit Permissions API support. */ }
  if (permission?.state === "denied") return { state: "denied", reason: "permission_denied" };
  if (!requestPermission && permission?.state !== "granted") return { state: "prompt" };
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition((position) => {
      if (document.hidden || !document.hasFocus() || permission?.state === "denied") { resolve({ state: "revoked" }); return; }
      resolve(validateForegroundLocation({ state: "available", latitude: position.coords.latitude,
        longitude: position.coords.longitude, accuracyMeters: position.coords.accuracy, sampledAt: position.timestamp }, Date.now()));
    }, (error) => resolve(error.code === 1 ? { state: "denied", reason: "permission_denied" }
      : { state: "unavailable", reason: error.code === 3 ? "timeout" : `position_error_${error.code}` }),
    { enableHighAccuracy: false, maximumAge: 0, timeout: 12_000 });
  });
}
