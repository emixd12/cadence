import { describe, expect, it } from "vitest";

import { projectTravelRouteDisplay } from "@/lib/services/travel-display.service";

describe("travel route display projection", () => {
  it("removes route request coordinates and place IDs", () => {
    const result = projectTravelRouteDisplay({
      version: "1.0", journeyRef: "journey", segments: [], occupiedSpans: [], collisions: [], completeTrip: false, finalAvailabilityAt: null, modelProjection: null,
      legs: [{ state: "current", reason: null, estimate: { durationSeconds: 60, departureAt: "2026-09-22T12:00:00Z", arrivalAt: "2026-09-22T12:01:00Z", warnings: [], fallback: false, attribution: "Google Maps", observedAt: "2026-09-22T12:00:00Z", expiresAt: "2026-09-22T12:05:00Z" }, leg: {
        id: "leg", role: "outbound", journeyRef: "journey", originCommitmentRef: null, destinationCommitmentRef: "event", mode: "walking", readyAt: "2026-09-22T12:00:00Z",
        provenance: { originRef: "device", originSource: "device", originRevision: "one", destinationRef: "event", destinationSource: "calendar", destinationRevision: "two", grantRevision: "three" },
      } }],
    });
    expect(JSON.stringify(result)).not.toContain("latitude");
    expect(JSON.stringify(result)).not.toContain("placeId");
  });

  it("adds only new fields, so a released Mac build reads the response unchanged", () => {
    const leg = { state: "current" as const, reason: null, estimate: { durationSeconds: 1800, departureAt: "2026-09-22T12:00:00Z", arrivalAt: "2026-09-22T12:30:00Z", warnings: ["Estimated arrival is after the planned arrival time."], fallback: false, attribution: "Google Maps", observedAt: "2026-09-22T12:00:00Z", expiresAt: "2026-09-22T12:05:00Z" }, leg: {
      id: "leg", role: "outbound" as const, journeyRef: "journey", originCommitmentRef: null, destinationCommitmentRef: "event", mode: "walking" as const, readyAt: "2026-09-22T12:00:00Z",
      provenance: { originRef: "device", originSource: "device" as const, originRevision: "one", destinationRef: "event", destinationSource: "calendar" as const, destinationRevision: "two", grantRevision: "three" },
    } };
    const released = { version: "1.0" as const, journeyRef: "journey", segments: [], occupiedSpans: [], collisions: [], completeTrip: false, finalAvailabilityAt: null };
    const unknownLegs = [{ role: "return" as const, originCommitmentRef: "event", destinationCommitmentRef: null, reason: "return_base_missing" as const }];
    const result = projectTravelRouteDisplay({ ...released, modelProjection: null, unknownLegs, legs: [{ ...leg, late: true }] });
    expect(result).toEqual({ ...released, unknownLegs, legs: [{ ...leg, late: true }] });
    // Every field the released client reads keeps its shape and meaning; the state set is unchanged.
    expect(result.version).toBe("1.0");
    expect(result.legs[0]).toMatchObject(leg);
    expect(projectTravelRouteDisplay({ ...released, modelProjection: null, legs: [] }).unknownLegs).toEqual([]);
  });
});
