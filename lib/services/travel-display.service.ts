import type { TravelBudgetState } from "@cadence/core/services/travel-refresh-policy";
import type { TravelEvidenceResult, TravelMode, TravelNavigationPreference } from "@cadence/core/types/travel";

/** Public route projection. Never return provider request endpoints or place IDs. */
export type TravelRouteDisplay = Omit<TravelEvidenceResult, "modelProjection">;

export function projectTravelRouteDisplay(evidence: TravelEvidenceResult): TravelRouteDisplay {
  return { version: evidence.version, journeyRef: evidence.journeyRef, legs: evidence.legs,
    unknownLegs: evidence.unknownLegs ?? [], segments: evidence.segments, occupiedSpans: evidence.occupiedSpans, collisions: evidence.collisions,
    completeTrip: evidence.completeTrip, finalAvailabilityAt: evidence.finalAvailabilityAt,
    ...(evidence.weather ? { weather: evidence.weather } : {}) };
}

export type TravelRoutesResponse = Readonly<{
  accountId: string;
  mode: TravelMode | null;
  navigationPreference: TravelNavigationPreference | null;
  settingsRevision: string | null;
  /** Ticket 217: the learned-habit revision this view was planned with. */
  habitsRevision?: string | null;
  expiresAt: string | null;
  /**
   * Ticket 219 Option A: signed conclusions for the Daily Brief request to return
   * unchanged. Present only when the server has a signing secret.
   */
  conclusionsToken?: string;
  /**
   * Ticket 267: the month's reserved spend after this request. Absent when it could not be
   * read. From 80% of the ceiling the refresh plan stops automatic requests.
   */
  budget?: TravelBudgetState;
  evidence: TravelRouteDisplay | null;
}>;
