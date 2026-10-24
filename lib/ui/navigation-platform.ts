import type { TravelNavigationPreference } from "@cadence/core/types/travel";

type PlatformNavigator = Readonly<{ userAgent?: string; platform?: string }>;

/**
 * Ticket 215: navigation links follow the platform. Apple devices (macOS, iPhone,
 * iPad, including iPadOS desktop mode) open Apple Maps; everything else opens Google Maps.
 */
export function platformNavigationPreference(
  device: PlatformNavigator | undefined = typeof navigator === "undefined" ? undefined : navigator,
): TravelNavigationPreference {
  if (!device) return "google_maps";
  return /Mac|iPhone|iPad|iPod/.test(`${device.platform ?? ""} ${device.userAgent ?? ""}`) ? "apple_maps" : "google_maps";
}
