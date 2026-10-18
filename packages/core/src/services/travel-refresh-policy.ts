import { Temporal } from "@js-temporal/polyfill";

import type { TravelPlannedLeg } from "../types/travel";

/** Ticket 214: a Timeline refresh routes only legs that depart, or must arrive, within this window. */
export const TRAVEL_ROUTE_WINDOW_SECONDS = 3 * 60 * 60;
/** Ticket 214: a device more than this far from the last sample used makes the current estimate out of date. */
export const TRAVEL_MOVEMENT_THRESHOLD_METERS = 500;
/** Google permits storing place IDs indefinitely; refresh them yearly so closed or moved places resolve again. */
export const TRAVEL_PLACE_RESOLVED_REUSE_SECONDS = 365 * 24 * 60 * 60;
/** Unresolved or ambiguous text is retried monthly rather than on every refresh. */
export const TRAVEL_PLACE_UNRESOLVED_REUSE_SECONDS = 30 * 24 * 60 * 60;
/** Unavailable reason for a leg left for a later refresh; it is never zero travel. */
export const TRAVEL_LEG_OUTSIDE_WINDOW = "outside_route_window";

export type TravelPlaceLookupOutcome = "resolved" | "unresolved" | "ambiguous";

/** Case, width and spacing differences in typed text must not cause another paid lookup. */
export function normalizeTravelPlaceText(text: string): string {
  return text.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

export function travelPlaceLookupReusable(
  entry: Readonly<{ outcome: TravelPlaceLookupOutcome; lookedUpAt: string }>,
  now: Temporal.Instant,
): boolean {
  let age: number;
  try { age = now.since(Temporal.Instant.from(entry.lookedUpAt)).total("seconds"); }
  catch { return false; }
  if (age < 0) return false;
  return age < (entry.outcome === "resolved" ? TRAVEL_PLACE_RESOLVED_REUSE_SECONDS : TRAVEL_PLACE_UNRESOLVED_REUSE_SECONDS);
}

/** Splits planned legs into those to route now and those left for a later refresh. */
export function partitionTravelLegsByWindow<T extends Pick<TravelPlannedLeg, "id" | "request">>(
  legs: readonly T[],
  now: Temporal.Instant,
  windowSeconds = TRAVEL_ROUTE_WINDOW_SECONDS,
): Readonly<{ due: T[]; later: T[] }> {
  const limit = now.add({ seconds: windowSeconds });
  const due: T[] = [];
  const later: T[] = [];
  for (const leg of legs) {
    // A depart-at leg is due by its departure; an arrive-by leg by its arrival target.
    const at = Temporal.Instant.from(leg.request.timing.at);
    (Temporal.Instant.compare(at, limit) <= 0 ? due : later).push(leg);
  }
  return { due, later };
}

export type TravelDeviceSample = Readonly<{ latitude: number; longitude: number; accuracyMeters: number }>;

/**
 * True when a new sample is farther than the threshold from the previous one, beyond both
 * accuracy radii, or when a sample appears where none was used. Losing a sample is not movement.
 */
export function travelDeviceMoved(
  previous: TravelDeviceSample | null,
  next: TravelDeviceSample | null,
  thresholdMeters = TRAVEL_MOVEMENT_THRESHOLD_METERS,
): boolean {
  if (!next) return false;
  if (!previous) return true;
  return greatCircleMeters(previous, next) - previous.accuracyMeters - next.accuracyMeters > thresholdMeters;
}

function greatCircleMeters(left: TravelDeviceSample, right: TravelDeviceSample): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = radians(right.latitude - left.latitude);
  const longitudeDelta = radians(right.longitude - left.longitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(left.latitude)) * Math.cos(radians(right.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(a)));
}
