import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";

import { resolveTravelEvidence, resolveTravelPlan } from "../packages/core/src/resolvers/travel.resolver";
import { briefingTravelOptionPolicy } from "../packages/core/src/services/briefing-travel";
import type { BriefingModelTravelFacts } from "../packages/core/src/types/briefing-travel";
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

    // Decision D12: only the stop past the source window lacks attendance. Its trip is unknown, not left out.
    const pastWindow = project({ commitments: [{ ...commitment("event-1", "2026-09-16T18:30:00Z", "2026-09-16T20:30:00Z", place("dentist")), attendance: "unknown" }] },
      [candidate("run", "2026-09-16T13:00:00Z", "2026-09-16T13:30:00Z")]);
    expect(pastWindow.travelDay).toBe("unknown");
    expect(pastWindow.trips).toEqual([{ destinationRef: "event-1", role: "outbound", mode: null, estimate: "unknown" }]);
    expect(pastWindow.fits[0]).toMatchObject({ conclusion: "unknown", basis: "travel_unknown" });
  });

  it("Ticket 264: a late trip on foot keeps the same late_arrival conclusion as driving", () => {
    const stop = commitment("stretch", "2026-09-16T12:15:00Z", "2026-09-16T12:45:00Z", place("studio"));
    // The provider counts back from the arrival target, to before the ready time.
    const counted = { departureAt: "2026-09-16T11:45:00Z", arrivalAt: "2026-09-16T12:15:00Z", seconds: 1_807 };
    const walking = project({ commitments: [stop] }, [], (role) => role === "outbound" ? counted : HOME);
    expect(walking.fits).toEqual([{ ref: "stretch", conclusion: "does_not_fit", basis: "late_arrival",
      trip: { destinationRef: "stretch", role: "outbound" }, position: null }]);
    expect(walking.trips[0]).toEqual({ destinationRef: "stretch", role: "outbound", mode: "cycling", estimate: "current" });
    const evaluated = project({ commitments: [stop], defaultMode: "driving" }, [],
      (role) => role === "outbound" ? { departureAt: NOW, arrivalAt: "2026-09-16T12:30:07Z", seconds: 1_807 } : HOME);
    expect(evaluated.fits).toEqual(walking.fits);
    const serialized = JSON.stringify(walking);
    for (const leaked of ["12:30", "1807", "studio-place", "11:45"]) expect(serialized).not.toContain(leaked);
    assertNoTiming(walking);
  });

  it("Ticket 264: transit that cannot start in time stays unknown, never late", () => {
    const stop = commitment("stretch", "2026-09-16T12:15:00Z", "2026-09-16T12:45:00Z", place("studio"));
    const counted = { departureAt: "2026-09-16T11:45:00Z", arrivalAt: "2026-09-16T12:15:00Z", seconds: 1_807 };
    const projection = project({ commitments: [stop], defaultMode: "transit" }, [], (role) => role === "outbound" ? counted : HOME);
    expect(projection.fits).toEqual([{ ref: "stretch", conclusion: "unknown", basis: "travel_unknown",
      trip: { destinationRef: "stretch", role: "outbound" }, position: null }]);
  });

  it("Ticket 264: an event under way adds its trip home, and no conclusion about the past", () => {
    const projection = project({ commitments: [
      commitment("event-now", "2026-09-16T11:30:00Z", "2026-09-16T13:00:00Z", place("dentist")),
    ] }, [
      candidate("run", "2026-09-16T12:30:00Z", "2026-09-16T12:45:00Z"),
      candidate("started", "2026-09-16T11:45:00Z", "2026-09-16T12:30:00Z"),
      candidate("tea", "2026-09-16T13:10:00Z", "2026-09-16T13:30:00Z"),
      candidate("journal", "2026-09-16T22:00:00Z", "2026-09-16T22:30:00Z"),
    ], () => ({ departureAt: "2026-09-16T13:00:00Z", arrivalAt: "2026-09-16T13:43:07Z", seconds: 2_587 }));
    expect(projection.travelDay).toBe("yes");
    expect(projection.calendarEvents).toBe(true);
    expect(projection.trips).toEqual([{ destinationRef: null, role: "return", mode: "cycling", estimate: "current" }]);
    expect(projection.fits.map((fit) => [fit.ref, fit.conclusion, fit.basis, fit.trip?.role ?? null, fit.position])).toEqual([
      ["run", "fits", "travel_known", "return", "before"],
      ["tea", "does_not_fit", "travel_overlap", "return", null],
      ["journal", "fits", "travel_known", "return", "after"],
    ]);
    assertNoTiming(projection);
    expect(JSON.stringify(projection)).not.toContain("13:43");
  });

  it("Ticket 264: a started stop with no known end adds no trip and no unknown trip", () => {
    const projection = project({ commitments: [
      { ...commitment("event-now", "2026-09-16T11:30:00Z", "2026-09-16T13:00:00Z", place("dentist")), endAt: null },
    ] }, [candidate("journal", "2026-09-16T22:00:00Z", "2026-09-16T22:30:00Z")]);
    expect(projection).toEqual({ version: "2.0", travelDay: "no", calendarEvents: true, trips: [], fits: [] });
  });

  it("projects nothing while disabled or after a revision change", () => {
    const plan = resolveTravelPlan(planning({}));
    const input = evidence(plan, []);
    expect(resolveTravelEvidence(input).modelProjection).toBeNull();
    expect(resolveTravelEvidence({ ...input, modelProjection: "enabled", expectedJourneyRevision: "changed" }).modelProjection).toBeNull();
  });
});

describe("Ticket 265: a trip made unreliable by an earlier late arrival", () => {
  const exit = { arrivalSeconds: 0, exitSeconds: 300, settlingSeconds: 0 };
  // Every leg is a 20-minute walk from its ready time.
  function chain(reviewEnd: string, candidates: TravelEvidenceInput["collisionCandidates"]) {
    const plan = resolveTravelPlan(planning({ defaultMode: "walking", buffers: exit, commitments: [
      commitment("event-standup", "2026-09-16T14:00:00Z", "2026-09-16T15:00:00Z", place("standup")),
      commitment("event-review", "2026-09-16T14:30:00Z", reviewEnd, place("review")),
    ] }));
    const results = plan.legs.map((leg) => {
      const arrivalAt = Temporal.Instant.from(leg.readyAt).add({ seconds: 1200 }).toString();
      return { legId: leg.id, provenance: leg.provenance, estimate: estimate({ departureAt: leg.readyAt, arrivalAt, seconds: 1200 }) };
    });
    const result = resolveTravelEvidence({ ...evidence(plan, candidates), buffers: exit, results, modelProjection: "enabled" });
    return { result, projection: result.modelProjection! };
  }
  const fitOf = (projection: TravelTimingModelProjection, ref: string) => projection.fits.find((fit) => fit.ref === ref);

  it("the reviewer's example: no fit inside the window the trip home may take", () => {
    const { result, projection } = chain("2026-09-16T15:10:00Z", [
      candidate("stretch", "2026-09-16T15:36:00Z", "2026-09-16T15:40:00Z"),
      candidate("tea", "2026-09-16T15:20:00Z", "2026-09-16T15:30:00Z"),
      candidate("journal", "2026-09-16T15:45:00Z", "2026-09-16T16:00:00Z"),
    ]);
    // The onward trip arrives 15:25; the trip home was estimated 15:15-15:35.
    expect(result.legs.map(({ estimate: value }) => [value?.departureAt, value?.arrivalAt]).at(-1)).toEqual(["2026-09-16T15:15:00Z", "2026-09-16T15:35:00Z"]);
    expect(projection.trips.find((trip) => trip.role === "return")).toMatchObject({ estimate: "unknown" });
    expect(fitOf(projection, "stretch")).toMatchObject({ conclusion: "unknown", basis: "travel_unknown" });
    // Known travel still counts: the onward walk, 15:05-15:25, is reliable.
    expect(fitOf(projection, "tea")).toMatchObject({ conclusion: "does_not_fit", basis: "travel_overlap", trip: { role: "onward" } });
    expect(fitOf(projection, "journal")).toMatchObject({ conclusion: "fits", basis: "travel_known" });
    expect(projection.version).toBe("2.0");
    assertNoTiming(projection);
  });

  it("an on-time chain still fits", () => {
    const { result, projection } = chain("2026-09-16T15:30:00Z", [
      candidate("stretch", "2026-09-16T16:00:00Z", "2026-09-16T16:10:00Z"),
    ]);
    expect(result.completeTrip).toBe(true);
    expect(projection.trips.every((trip) => trip.estimate === "current")).toBe(true);
    expect(fitOf(projection, "stretch")).toMatchObject({ conclusion: "fits", basis: "travel_known" });
  });

  it("a Daily Brief option inside the window is not justified", () => {
    const facts = (projection: TravelTimingModelProjection) => ({ version: "1.0", routing: "on", usualMode: "walking", behaviors: [],
      route: { state: "available", conclusions: projection } }) as unknown as BriefingModelTravelFacts;
    const unreliable = chain("2026-09-16T15:10:00Z", [candidate("stretch", "2026-09-16T15:36:00Z", "2026-09-16T15:40:00Z")]).projection;
    expect(briefingTravelOptionPolicy(facts(unreliable), "stretch")).toEqual({ offer: true, fallback: false });
    const onTime = chain("2026-09-16T15:30:00Z", [candidate("stretch", "2026-09-16T16:00:00Z", "2026-09-16T16:10:00Z")]).projection;
    expect(briefingTravelOptionPolicy(facts(onTime), "stretch")).toEqual({ offer: true, fallback: true });
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
