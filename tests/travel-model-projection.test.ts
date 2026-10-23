import { describe, expect, it } from "vitest";

import { resolveTravelEvidence, resolveTravelPlan } from "../packages/core/src/resolvers/travel.resolver";
import type {
  TravelCommitment,
  TravelEndpoint,
  TravelEvidenceInput,
  TravelPlanningInput,
  TravelRouteEstimate,
  TravelTimingModelProjection,
} from "../packages/core/src/types/travel";

// Ticket 219: Cadence's own travel conclusions for model input (docs/LEGAL.md L-001).
const NOW = "2026-09-16T12:00:00Z";
const ZERO = { arrivalSeconds: 0, exitSeconds: 0, settlingSeconds: 0 };
// Odd-second durations, so a leaked value or derived pair is detectable.
const OUTBOUND = { departureAt: "2026-09-16T17:47:13Z", arrivalAt: "2026-09-16T18:30:00Z", seconds: 2_567 };
const HOME = { departureAt: "2026-09-16T20:30:00Z", arrivalAt: "2026-09-16T21:13:07Z", seconds: 2_587 };

describe("travel model projection", () => {
  it("concludes fits, travel overlaps and unknown durations without timing", () => {
    const projection = project({}, [
      candidate("run", "2026-09-16T13:00:00Z", "2026-09-16T13:30:00Z"),
      candidate("read", "2026-09-16T18:00:00Z", "2026-09-16T18:20:00Z"),
      candidate("stretch", "2026-09-16T21:00:00Z", "2026-09-16T21:20:00Z"),
      candidate("journal", "2026-09-16T22:00:00Z", "2026-09-16T22:30:00Z"),
      candidate("nap", "2026-09-16T17:50:00Z", null),
      candidate("tea", "2026-09-16T15:00:00Z", null),
    ]);

    expect(projection.travelDay).toBe("yes");
    expect(projection.calendarEvents).toBe(true);
    expect(projection.trips).toEqual([
      { destinationRef: "event-1", role: "outbound", mode: "cycling", estimate: "current" },
      { destinationRef: null, role: "return", mode: "cycling", estimate: "current" },
    ]);
    expect(Object.fromEntries(projection.fits.map((fit) => [fit.ref, [fit.conclusion, fit.basis, fit.trip?.destinationRef ?? null, fit.trip?.role ?? null, fit.position]]))).toEqual({
      run: ["fits", "travel_known", "event-1", "outbound", "before"],
      tea: ["unknown", "duration_unknown", "event-1", "outbound", "before"],
      nap: ["does_not_fit", "travel_overlap", "event-1", "outbound", null],
      read: ["does_not_fit", "travel_overlap", "event-1", "outbound", null],
      stretch: ["does_not_fit", "travel_overlap", null, "return", null],
      journal: ["fits", "travel_known", null, "return", "after"],
    });
    expect(projection.fits.map((fit) => fit.ref)).toEqual(["run", "tea", "nap", "read", "stretch", "journal"]);
    assertNoTiming(projection);
  });

  it("keeps unknown legs unknown instead of treating them as zero travel", () => {
    const device = { ...place("phone"), ref: "device", source: "device" as const, observedAt: NOW, accuracyMeters: 10, grantRevision: "grant-1" };
    const noHome = project({ base: null, device }, [
      candidate("run", "2026-09-16T13:00:00Z", "2026-09-16T13:30:00Z"),
      candidate("journal", "2026-09-16T22:00:00Z", "2026-09-16T22:30:00Z"),
    ]);
    expect(noHome.trips.at(-1)).toEqual({ destinationRef: null, role: "return", mode: null, estimate: "unknown" });
    expect(noHome.fits.map((fit) => [fit.ref, fit.conclusion, fit.basis, fit.trip?.role, fit.position])).toEqual([
      ["run", "fits", "travel_known", "outbound", "before"],
      ["journal", "unknown", "travel_unknown", "return", "after"],
    ]);

    const missingEstimate = project({}, [
      candidate("run", "2026-09-16T13:00:00Z", "2026-09-16T13:30:00Z"),
      candidate("journal", "2026-09-16T22:00:00Z", "2026-09-16T22:30:00Z"),
    ], (role) => role === "outbound" ? null : HOME);
    expect(missingEstimate.trips[0]).toMatchObject({ destinationRef: "event-1", estimate: "unknown" });
    expect(missingEstimate.fits.map((fit) => [fit.ref, fit.conclusion, fit.basis])).toEqual([
      ["run", "unknown", "travel_unknown"],
      ["journal", "fits", "travel_known"],
    ]);

    const expired = project({}, [candidate("run", "2026-09-16T13:00:00Z", "2026-09-16T13:30:00Z")],
      (role) => role === "outbound" ? { ...OUTBOUND, expiresAt: "2026-09-16T12:00:00Z" } : HOME);
    expect(expired.fits[0]).toMatchObject({ conclusion: "unknown", basis: "travel_unknown" });
  });

  it("concludes that a Home Behavior does not fit when travel there arrives late", () => {
    const home = place("home");
    const projection = project({ commitments: [
      commitment("event-1", "2026-09-16T18:30:00Z", "2026-09-16T20:30:00Z", place("dentist")),
      commitment("stretch-home", "2026-09-16T21:00:00Z", "2026-09-16T21:20:00Z", { ...home, ref: "stretch-home" }),
    ] }, [], (role) => role === "outbound" ? OUTBOUND : role === "onward" ? HOME : { ...HOME, departureAt: "2026-09-16T21:20:00Z", arrivalAt: "2026-09-16T21:20:00Z", seconds: 0 });
    expect(projection.fits).toEqual([{
      ref: "stretch-home", conclusion: "does_not_fit", basis: "late_arrival",
      trip: { destinationRef: "stretch-home", role: "onward" }, position: null,
    }]);
    assertNoTiming(projection);
  });

  it("reports an unknown trip to a stop without a place and a day without travel", () => {
    const unknownPlace = project({ commitments: [
      commitment("event-1", "2026-09-16T18:30:00Z", "2026-09-16T20:30:00Z", place("dentist")),
      { ...commitment("library", "2026-09-16T21:00:00Z", "2026-09-16T22:00:00Z", place("library")), endpoint: null },
    ] }, []);
    expect(unknownPlace.trips).toContainEqual({ destinationRef: "library", role: "onward", mode: null, estimate: "unknown" });
    expect(unknownPlace.fits).toEqual([{ ref: "library", conclusion: "unknown", basis: "travel_unknown",
      trip: { destinationRef: "library", role: "onward" }, position: null }]);

    const quiet = project({ commitments: [] }, [candidate("run", "2026-09-16T13:00:00Z", "2026-09-16T13:30:00Z")]);
    expect(quiet).toEqual({ version: "2.0", travelDay: "no", calendarEvents: false, trips: [], fits: [] });

    const maybeRemote = project({ commitments: [{ ...commitment("event-1", "2026-09-16T18:30:00Z", "2026-09-16T20:30:00Z", place("dentist")), attendance: "unknown" }] },
      [candidate("run", "2026-09-16T13:00:00Z", "2026-09-16T13:30:00Z")]);
    expect(maybeRemote.travelDay).toBe("unknown");
    expect(maybeRemote.trips).toEqual([]);
    expect(maybeRemote.fits[0]).toMatchObject({ conclusion: "unknown", basis: "travel_unknown" });
  });

  it("projects nothing while disabled or after a revision change", () => {
    const plan = resolveTravelPlan(planning({}));
    const input = evidence(plan, []);
    expect(resolveTravelEvidence(input).modelProjection).toBeNull();
    expect(resolveTravelEvidence({ ...input, modelProjection: "enabled", expectedJourneyRevision: "changed" }).modelProjection).toBeNull();
  });
});

/** No instant, number, provider field or place survives into the projection. */
function assertNoTiming(projection: TravelTimingModelProjection): void {
  const allowedKeys = new Set(["version", "travelDay", "calendarEvents", "trips", "fits", "destinationRef", "role", "mode", "estimate", "ref", "conclusion", "basis", "trip", "position"]);
  const visit = (value: unknown): void => {
    if (typeof value === "number") throw new Error(`Number in model projection: ${value}`);
    if (typeof value === "string") expect(value).not.toMatch(/\d{4}-\d{2}-\d{2}T|\d{1,2}:\d{2}/);
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") {
      for (const [key, item] of Object.entries(value)) {
        expect(allowedKeys.has(key)).toBe(true);
        visit(item);
      }
    }
  };
  visit(projection);
  const serialized = JSON.stringify(projection);
  for (const leaked of [OUTBOUND.departureAt, HOME.arrivalAt, String(OUTBOUND.seconds), String(HOME.seconds), "dentist-place", "latitude", "attribution"]) {
    expect(serialized).not.toContain(leaked);
  }
}

type LegEstimate = Readonly<{ departureAt: string; arrivalAt: string; seconds: number; expiresAt?: string }>;

function project(
  overrides: Partial<TravelPlanningInput>,
  candidates: TravelEvidenceInput["collisionCandidates"],
  estimateFor: (role: string) => LegEstimate | null = (role) => role === "outbound" ? OUTBOUND : HOME,
): TravelTimingModelProjection {
  const plan = resolveTravelPlan(planning(overrides));
  const results = plan.legs.map((leg) => {
    const value = estimateFor(leg.role);
    return { legId: leg.id, provenance: leg.provenance, estimate: value ? estimate(value) : null, unavailableReason: value ? undefined : "no service" };
  });
  const commitments = plan.commitments.map((item) => ({ ref: item.ref, kind: item.kind === "behavior" ? "behavior" as const : "commitment" as const, startAt: item.startAt, endAt: item.endAt }));
  const projection = resolveTravelEvidence({ ...evidence(plan, [...commitments, ...candidates]), results, modelProjection: "enabled" }).modelProjection;
  if (!projection) throw new Error("Projection is missing.");
  return projection;
}

function planning(overrides: Partial<TravelPlanningInput>): TravelPlanningInput {
  return {
    journeyRef: "journey-1", journeyRevision: "journey-r1", now: NOW, grantRevision: "grant-1", defaultMode: "cycling",
    base: { ...place("home"), ref: "base", source: "saved_base" }, device: null, predictedOrigin: null, corrections: [],
    commitments: [commitment("event-1", "2026-09-16T18:30:00Z", "2026-09-16T20:30:00Z", place("dentist"))],
    buffers: ZERO,
    ...overrides,
  };
}

function evidence(plan: ReturnType<typeof resolveTravelPlan>, collisionCandidates: TravelEvidenceInput["collisionCandidates"]): TravelEvidenceInput {
  return { plan, results: [], collisionCandidates, buffers: ZERO, now: NOW, expectedJourneyRevision: plan.journeyRevision,
    expectedGrantRevision: plan.grantRevision, modelProjection: "disabled" };
}

function place(name: string): TravelEndpoint {
  return { ref: `${name}-place`, source: "calendar", sourceRevision: `${name}-r1`, point: { kind: "place_id", placeId: `${name}-place` } };
}

function commitment(ref: string, startAt: string, endAt: string, destination: TravelEndpoint): TravelCommitment {
  return { ref, revision: `${ref}-r1`, kind: ref.startsWith("event") ? "calendar" : "behavior", startAt, endAt,
    attendance: "physical", endpoint: destination, mode: null };
}

function candidate(ref: string, startAt: string, endAt: string | null): TravelEvidenceInput["collisionCandidates"][number] {
  return { ref, kind: "behavior", startAt, endAt };
}

function estimate(value: LegEstimate): TravelRouteEstimate {
  return { departureAt: value.departureAt, arrivalAt: value.arrivalAt, durationSeconds: value.seconds, warnings: [], fallback: false,
    attribution: "Synthetic provider", observedAt: "2026-09-16T11:59:00Z", expiresAt: value.expiresAt ?? "2026-09-17T12:00:00Z" };
}
