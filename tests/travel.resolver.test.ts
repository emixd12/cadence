import { describe, expect, it } from "vitest";

import {
  resolveTravelAfterDecisions,
  resolveTravelCollisions,
  resolveTravelEvidence,
  resolveTravelPlan,
} from "../packages/core/src/resolvers/travel.resolver";
import { travelPlaceKey } from "../packages/core/src/services/travel-place-key";
import type {
  TravelCommitment,
  TravelEndpoint,
  TravelEvidenceInput,
  TravelLegResult,
  TravelMode,
  TravelPlanningInput,
  TravelRouteEstimate,
} from "../packages/core/src/types/travel";

const NOW = "2026-09-16T16:00:00Z";
const BUFFERS = { arrivalSeconds: 600, exitSeconds: 600, settlingSeconds: 600 };

describe("resolveTravelPlan", () => {
  it("keeps no-base outbound and A to B to C legs without detours", () => {
    const input = planningInput({
      base: null,
      device: endpoint("A", "device", "a1", 1, {
        observedAt: NOW,
        accuracyMeters: 10,
        grantRevision: "grant-1",
      }),
      commitments: [
        commitment("B", "2026-09-16T18:30:00Z", "2026-09-16T20:30:00Z", endpoint("B", "calendar", "b1", 2)),
        commitment("C", "2026-09-16T23:00:00Z", "2026-09-17T00:00:00Z", endpoint("C", "behavior", "c1", 3)),
      ],
    });

    const plan = resolveTravelPlan(input);

    expect(plan.legs.map((leg) => [
      leg.role,
      leg.provenance.originRef,
      leg.provenance.destinationRef,
    ])).toEqual([
      ["outbound", "A", "B"],
      ["onward", "B", "C"],
    ]);
    expect(plan.unknownLegs).toEqual([{
      role: "return",
      originCommitmentRef: "C",
      destinationCommitmentRef: null,
      reason: "return_base_missing",
    }]);
    expect(plan.legs.every((leg) => leg.id.length <= 128)).toBe(true);
    expect(JSON.stringify(plan)).not.toContain("saved_base");
  });

  it("skips travel between consecutive stops at the same place", () => {
    const place = (ref: string, source: TravelEndpoint["source"]) => endpoint(ref, source, `${ref}-r1`, 0, { point: { kind: "place_id", placeId: "same-place" } });
    const plan = resolveTravelPlan(planningInput({
      base: endpoint("base", "saved_base", "base-r1", 9, { point: { kind: "place_id", placeId: "home" } }),
      device: null,
      commitments: [
        commitment("event-gym", "2026-09-16T18:00:00Z", "2026-09-16T19:00:00Z", place("event-gym", "calendar")),
        commitment("behavior-swim", "2026-09-16T19:00:00Z", "2026-09-16T19:30:00Z", place("behavior-swim", "behavior")),
      ],
    }));
    expect(plan.legs.map((leg) => [leg.role, leg.originCommitmentRef, leg.destinationCommitmentRef])).toEqual([
      ["outbound", null, "event-gym"],
      ["return", "behavior-swim", null],
    ]);
    expect(plan.unknownLegs).toEqual([]);
  });

  it("uses a current device ahead of base and ignores a scheduled prediction", () => {
    const plan = resolveTravelPlan(planningInput({
      base: endpoint("base", "saved_base", "base-1", 9),
      predictedOrigin: endpoint("predicted", "planned_stop", "prediction-1", 8),
      device: endpoint("device", "device", "device-1", 7, {
        observedAt: "2026-09-16T15:59:30Z",
        accuracyMeters: 20,
        grantRevision: "grant-1",
      }),
    }));

    expect(plan.legs[0]?.provenance.originRef).toBe("device");

    const stale = resolveTravelPlan(planningInput({
      base: endpoint("base", "saved_base", "base-1", 9),
      predictedOrigin: endpoint("predicted", "planned_stop", "prediction-1", 8),
      device: endpoint("device", "device", "device-1", 7, {
        observedAt: "2026-09-16T15:58:59Z",
        accuracyMeters: 20,
        grantRevision: "grant-1",
      }),
    }));
    expect(stale.legs[0]?.provenance.originRef).toBe("base");
  });

  it("routes a fresh device to the next future stop and does not infer location from past or ongoing events", () => {
    const plan = resolveTravelPlan(planningInput({
      commitments: [
        commitment("past", "2026-09-16T12:00:00Z", "2026-09-16T13:00:00Z", endpoint("past-place", "calendar", "past-r1", 2)),
        commitment("ongoing", "2026-09-16T15:30:00Z", "2026-09-16T16:30:00Z", endpoint("ongoing-place", "calendar", "ongoing-r1", 3)),
        commitment("future", "2026-09-16T18:30:00Z", "2026-09-16T19:30:00Z", endpoint("future-place", "calendar", "future-r1", 4)),
      ],
    }));

    expect(plan.legs[0]).toMatchObject({
      role: "outbound",
      destinationCommitmentRef: "future",
      provenance: { originRef: "device", destinationRef: "future-place" },
    });
    expect(plan.commitments.map((commitment) => commitment.ref)).toEqual(["past", "ongoing", "future"]);
  });

  it("scopes corrections to the journey and source revision", () => {
    const correction = endpoint("corrected", "correction", "correction-1", 5);
    const matching = resolveTravelPlan(planningInput({
      corrections: [{
        journeyRef: "journey-1",
        targetRef: "event-1",
        appliesToRevision: "event-1-r1",
        endpoint: correction,
      }],
    }));
    expect(matching.legs[0]?.provenance.destinationRef).toBe("corrected");

    const stale = resolveTravelPlan(planningInput({
      corrections: [{
        journeyRef: "journey-1",
        targetRef: "event-1",
        appliesToRevision: "old-revision",
        endpoint: correction,
      }],
    }));
    expect(stale.legs[0]?.provenance.destinationRef).toBe("event-1-place");
  });

  it("keeps hybrid and unknown stops explicit and interrupts automatic chaining", () => {
    const plan = resolveTravelPlan(planningInput({
      base: null,
      commitments: [
        { ...commitment("hybrid", "2026-09-16T18:00:00Z", "2026-09-16T19:00:00Z", endpoint("hybrid-place", "calendar", "h1", 2)), attendance: "hybrid" },
        commitment("later", "2026-09-16T21:00:00Z", "2026-09-16T22:00:00Z", endpoint("later-place", "calendar", "l1", 3)),
      ],
    }));

    expect(plan.legs).toEqual([]);
    expect(plan.unknownLegs.map((leg) => leg.reason)).toEqual([
      "attendance_unknown",
      "origin_unknown",
      "return_base_missing",
    ]);
  });

  it.each<TravelMode>(["walking", "cycling", "transit", "driving"])(
    "preserves the selected %s mode",
    (mode) => {
      const plan = resolveTravelPlan(planningInput({ defaultMode: mode }));
      expect(plan.legs.every((leg) => leg.mode === mode && leg.request.mode === mode)).toBe(true);
    },
  );
});

describe("resolveTravelEvidence", () => {
  it("builds the synthetic 1:30 to 6:30 trip and half-open travel collisions", () => {
    const plan = resolveTravelPlan(planningInput({
      now: "2026-09-16T12:00:00Z",
      commitments: [commitment(
        "event-1",
        "2026-09-16T14:30:00Z",
        "2026-09-16T16:30:00Z",
        endpoint("event-1-place", "calendar", "event-1-place-r1", 2),
      )],
    }));
    const results = plan.legs.map((leg) => resultFor(
      leg,
      leg.role === "outbound"
        ? estimate("2026-09-16T13:30:00Z", "2026-09-16T14:20:00Z", 3000)
        : estimate("2026-09-16T16:40:00Z", "2026-09-16T18:20:00Z", 6000),
    ));

    const evidence = resolveTravelEvidence(evidenceInput(plan, results, [
      candidate("behavior-before", "2026-09-16T13:45:00Z", "2026-09-16T14:00:00Z"),
      candidate("behavior-return", "2026-09-16T17:30:00Z", "2026-09-16T18:00:00Z"),
      candidate("half-open", "2026-09-16T18:30:00Z", "2026-09-16T18:45:00Z"),
    ]));

    expect(evidence.occupiedSpans).toEqual([{
      startAt: "2026-09-16T13:30:00Z",
      endAt: "2026-09-16T18:30:00Z",
      segmentIds: expect.any(Array),
    }]);
    expect(evidence.collisions.map((collision) => collision.candidateRef)).toEqual([
      "behavior-before",
      "behavior-return",
    ]);
    expect(evidence.collisions.every((collision) => collision.travelCreated)).toBe(true);
    expect(evidence.completeTrip).toBe(true);
    expect(evidence.finalAvailabilityAt).toBe("2026-09-16T18:30:00Z");
    expect(evidence.modelProjection).toBeNull();
    expect(JSON.stringify(evidence)).not.toMatch(/latitude|longitude|placeId|request/);
  });

  it("labels late arrival without discarding known route occupancy", () => {
    const plan = resolveTravelPlan(planningInput({ now: "2026-09-16T12:00:00Z" }));
    const leg = plan.legs[0]!;
    const evidence = resolveTravelEvidence(evidenceInput(plan, [resultFor(leg,
      estimate("2026-09-16T18:10:00Z", "2026-09-16T18:40:00Z", 1800))], []));
    expect(evidence.legs[0]?.estimate?.warnings).toContain("Estimated arrival is after the planned arrival time.");
    expect(evidence.segments.some((segment) => segment.kind === "route")).toBe(true);
  });

  it("retains outbound occupancy and collisions when the return is unavailable", () => {
    const plan = resolveTravelPlan(planningInput({ now: "2026-09-16T12:00:00Z" }));
    const results = plan.legs.map((leg) => leg.role === "return"
      ? resultFor(leg, null)
      : resultFor(leg, estimate("2026-09-16T13:30:00Z", "2026-09-16T14:20:00Z", 3000)));
    const evidence = resolveTravelEvidence(evidenceInput(plan, results, [
      candidate("outbound-collision", "2026-09-16T13:45:00Z", "2026-09-16T14:00:00Z"),
    ]));

    expect(evidence.legs.map((leg) => [leg.leg.role, leg.state])).toEqual([
      ["outbound", "current"],
      ["return", "unavailable"],
    ]);
    expect(evidence.segments.some((segment) => segment.id.startsWith("route:") && segment.startAt === "2026-09-16T13:30:00Z")).toBe(true);
    expect(evidence.collisions[0]?.candidateRef).toBe("outbound-collision");
    expect(evidence.completeTrip).toBe(false);
    expect(evidence.finalAvailabilityAt).toBeNull();
  });

  it("keeps known free gaps between exact route and commitment segments", () => {
    const plan = resolveTravelPlan(planningInput({
      now: "2026-09-16T12:00:00Z",
      buffers: { arrivalSeconds: 0, exitSeconds: 0, settlingSeconds: 0 },
      commitments: [
        commitment("first", "2026-09-16T14:00:00Z", "2026-09-16T15:00:00Z", endpoint("first-place", "calendar", "first-r1", 2)),
        commitment("second", "2026-09-16T18:00:00Z", "2026-09-16T19:00:00Z", endpoint("second-place", "behavior", "second-r1", 3)),
      ],
    }));
    const results = plan.legs.map((leg) => {
      if (leg.role === "outbound") return resultFor(leg, estimate("2026-09-16T13:30:00Z", "2026-09-16T14:00:00Z", 1800));
      if (leg.role === "onward") return resultFor(leg, estimate("2026-09-16T17:30:00Z", "2026-09-16T18:00:00Z", 1800));
      return resultFor(leg, estimate("2026-09-16T19:00:00Z", "2026-09-16T19:30:00Z", 1800));
    });
    const evidence = resolveTravelEvidence(evidenceInput(
      plan,
      results,
      [],
      { arrivalSeconds: 0, exitSeconds: 0, settlingSeconds: 0 },
    ));

    expect(evidence.occupiedSpans.map(({ startAt, endAt }) => ({ startAt, endAt }))).toEqual([
      { startAt: "2026-09-16T13:30:00Z", endAt: "2026-09-16T15:00:00Z" },
      { startAt: "2026-09-16T17:30:00Z", endAt: "2026-09-16T19:30:00Z" },
    ]);
  });

  it("rejects stale grant and endpoint revisions without exposing stale occupancy", () => {
    const plan = resolveTravelPlan(planningInput());
    const results = plan.legs.map((leg) => resultFor(leg, estimate(
      leg.role === "outbound" ? "2026-09-16T17:30:00Z" : "2026-09-16T20:40:00Z",
      leg.role === "outbound" ? "2026-09-16T18:20:00Z" : "2026-09-16T21:30:00Z",
      3000,
    )));
    const staleGrant = resolveTravelEvidence({
      ...evidenceInput(plan, results, []),
      expectedGrantRevision: "grant-2",
    });
    expect(staleGrant.legs.every((leg) => leg.state === "rejected_revision")).toBe(true);
    expect(staleGrant.segments).toEqual([]);

    const staleEndpoint = resolveTravelEvidence(evidenceInput(plan, [{
      ...results[0]!,
      provenance: { ...results[0]!.provenance, destinationRevision: "changed" },
    }, ...results.slice(1)], []));
    expect(staleEndpoint.legs[0]?.state).toBe("rejected_revision");
  });

  it("uses elapsed instants across midnight and DST transitions", () => {
    const collisions = resolveTravelCollisions([
      {
        id: "route:midnight",
        kind: "route",
        startAt: "2026-09-17T03:30:00Z",
        endAt: "2026-09-17T04:30:00Z",
        sourceRefs: [],
        legId: "midnight",
      },
      {
        id: "route:dst",
        kind: "route",
        startAt: "2026-11-01T05:30:00Z",
        endAt: "2026-11-01T07:30:00Z",
        sourceRefs: [],
        legId: "dst",
      },
    ], [
      candidate("midnight-overlap", "2026-09-17T03:45:00Z", "2026-09-17T04:15:00Z"),
      candidate("dst-overlap", "2026-11-01T06:15:00Z", "2026-11-01T06:45:00Z"),
    ]);

    expect(collisions).toEqual([
      {
        candidateRef: "midnight-overlap",
        segmentIds: ["route:midnight"],
        travelCreated: true,
      },
      {
        candidateRef: "dst-overlap",
        segmentIds: ["route:dst"],
        travelCreated: true,
      },
    ]);
  });

  it("projects timing only when explicitly enabled", () => {
    const plan = resolveTravelPlan(planningInput({ now: "2026-09-16T12:00:00Z" }));
    const results = plan.legs.map((leg) => resultFor(
      leg,
      leg.role === "outbound"
        ? estimate("2026-09-16T17:30:00Z", "2026-09-16T18:20:00Z", 3000)
        : estimate("2026-09-16T20:40:00Z", "2026-09-16T21:30:00Z", 3000),
    ));
    const evidence = resolveTravelEvidence({
      ...evidenceInput(plan, results, []),
      modelProjection: "enabled",
    });

    expect(evidence.modelProjection?.legs).toHaveLength(2);
    expect(JSON.stringify(evidence.modelProjection)).not.toMatch(/latitude|longitude|placeId|originRef|destinationRef/);
  });
});

function planningInput(overrides: Partial<TravelPlanningInput> = {}): TravelPlanningInput {
  return {
    journeyRef: "journey-1",
    journeyRevision: "journey-r1",
    now: NOW,
    grantRevision: "grant-1",
    defaultMode: "driving",
    base: endpoint("base", "saved_base", "base-r1", 9),
    device: endpoint("device", "device", "device-r1", 1, {
      observedAt: NOW,
      accuracyMeters: 10,
      grantRevision: "grant-1",
    }),
    predictedOrigin: null,
    corrections: [],
    commitments: [commitment(
      "event-1",
      "2026-09-16T18:30:00Z",
      "2026-09-16T20:30:00Z",
      endpoint("event-1-place", "calendar", "event-1-place-r1", 2),
    )],
    buffers: BUFFERS,
    ...overrides,
  };
}

function endpoint(
  ref: string,
  source: TravelEndpoint["source"],
  sourceRevision: string,
  coordinate: number,
  extra: Partial<TravelEndpoint> = {},
): TravelEndpoint {
  return {
    ref,
    source,
    sourceRevision,
    point: { kind: "coordinates", latitude: coordinate, longitude: coordinate },
    ...extra,
  };
}

function commitment(
  ref: string,
  startAt: string,
  endAt: string | null,
  destination: TravelEndpoint,
): TravelCommitment {
  return {
    ref,
    revision: `${ref}-r1`,
    kind: ref.startsWith("event") ? "calendar" : "behavior",
    startAt,
    endAt,
    attendance: "physical",
    endpoint: destination,
    mode: null,
  };
}

function estimate(
  departureAt: string,
  arrivalAt: string,
  durationSeconds: number,
): TravelRouteEstimate {
  return {
    departureAt,
    arrivalAt,
    durationSeconds,
    warnings: [],
    fallback: false,
    attribution: "Synthetic provider",
    observedAt: "2026-09-16T12:00:00Z",
    expiresAt: "2026-09-17T12:00:00Z",
  };
}

function resultFor(
  leg: ReturnType<typeof resolveTravelPlan>["legs"][number],
  routeEstimate: TravelRouteEstimate | null,
): TravelLegResult {
  return {
    legId: leg.id,
    provenance: leg.provenance,
    estimate: routeEstimate,
    unavailableReason: routeEstimate ? undefined : "no service",
  };
}

function evidenceInput(
  plan: ReturnType<typeof resolveTravelPlan>,
  results: TravelLegResult[],
  collisionCandidates: TravelEvidenceInput["collisionCandidates"],
  buffers = BUFFERS,
): TravelEvidenceInput {
  return {
    plan,
    results,
    collisionCandidates,
    buffers,
    now: "2026-09-16T12:30:00Z",
    expectedJourneyRevision: plan.journeyRevision,
    expectedGrantRevision: plan.grantRevision,
    modelProjection: "disabled",
  };
}

function candidate(ref: string, startAt: string, endAt: string): TravelEvidenceInput["collisionCandidates"][number] {
  return { ref, kind: "behavior", startAt, endAt };
}


it("keeps a zero-duration route valid without creating an invalid Timeline span", () => {
  const plan = resolveTravelPlan(planningInput());
  const evidence = resolveTravelEvidence(evidenceInput(plan, plan.legs.map((leg) =>
    resultFor(leg, estimate(leg.request.timing.at, leg.request.timing.at, 0))), []));
  expect(evidence.completeTrip).toBe(true);
  expect(evidence.segments.every((segment) => segment.startAt !== segment.endAt)).toBe(true);
  expect(evidence.segments.some((segment) => segment.kind === "commitment")).toBe(true);
});


it("recomputes occupancy after a decision without inventing replacement routes", () => {
  const plan = resolveTravelPlan(planningInput());
  const evidence = resolveTravelEvidence(evidenceInput(plan, plan.legs.map(leg => resultFor(leg,
    estimate("2026-09-16T17:00:00Z", "2026-09-16T17:10:00Z", 600))), []));
  const ref = plan.commitments[0]!.ref;
  const updated = resolveTravelAfterDecisions(evidence, [{ id: ref, status: "completed" }])!;
  expect(updated.legs.every(({ leg }) => leg.destinationCommitmentRef !== ref && leg.originCommitmentRef !== ref)).toBe(true);
  expect(updated.segments.every(segment => !segment.sourceRefs.includes(ref))).toBe(true);
  expect(updated.completeTrip).toBe(false);
  expect(updated.finalAvailabilityAt).toBeNull();
  expect(resolveTravelAfterDecisions(evidence, [])).toBe(evidence);
  expect(evidence.legs.length).toBeGreaterThan(updated.legs.length);
});


it("withdraws a cached trip when a previously omitted occurrence becomes unresolved", () => {
  const plan = resolveTravelPlan(planningInput());
  const evidence = { ...resolveTravelEvidence(evidenceInput(plan, [], [])),
    behaviorSources: [{ ref: "omitted", behaviorId: "behavior", unresolved: false }] };
  expect(resolveTravelAfterDecisions(evidence, [{ id: "omitted", status: "unresolved" }])).toBeNull();
});

it("withdraws stale duration-dependent routes without invalidating range schedules or unchanged estimates", () => {
  const plan = resolveTravelPlan(planningInput());
  const evidence = { ...resolveTravelEvidence(evidenceInput(plan, [], [])),
    behaviorSources: [{ ref: "exact", behaviorId: "behavior", unresolved: true, durationSeconds: 600 }] };
  const duration = { kind: "known" as const, seconds: 600, durationLabel: "10 minutes", sampleCount: 3, lookbackDays: 90, provenance: "completed_stopped_occurrence_mean" as const };
  const occurrences = [{ id: "exact", status: "unresolved" as const }];
  expect(resolveTravelAfterDecisions(evidence, occurrences, { behavior: duration })).toBe(evidence);
  expect(resolveTravelAfterDecisions(evidence, occurrences, { behavior: { ...duration, seconds: 1200 } })).toBeNull();
  expect(resolveTravelAfterDecisions(evidence, occurrences)).toBeNull();
  const range = { ...evidence, behaviorSources: [{ ref: "exact", behaviorId: "behavior", unresolved: true }] };
  expect(resolveTravelAfterDecisions(range, occurrences)).toBe(range);
});

describe("Ticket 217 learned buffers", () => {
  const departures = (plan: ReturnType<typeof resolveTravelPlan>) => plan.legs.map((leg) => resultFor(leg, leg.role === "return"
    ? estimate("2026-09-16T20:30:00Z", "2026-09-16T21:00:00Z", 1800)
    : estimate("2026-09-16T17:50:00Z", "2026-09-16T18:20:00Z", 1800)));

  it("occupies get-ready time before an outbound departure without moving the route", () => {
    const without = resolveTravelPlan(planningInput());
    const learned = { ...BUFFERS, preparationSeconds: 600 };
    const plan = resolveTravelPlan(planningInput({ buffers: learned }));
    expect(plan.legs.map((leg) => leg.id)).toEqual(without.legs.map((leg) => leg.id));
    expect(plan.legs.map((leg) => leg.request)).toEqual(without.legs.map((leg) => leg.request));

    const evidence = resolveTravelEvidence(evidenceInput(plan, departures(plan), [
      candidate("behavior-before", "2026-09-16T17:30:00Z", "2026-09-16T17:45:00Z"),
      candidate("behavior-earlier", "2026-09-16T17:00:00Z", "2026-09-16T17:30:00Z"),
    ], learned));
    const preparation = evidence.segments.filter((segment) => segment.kind === "preparation_buffer");
    expect(preparation).toEqual([expect.objectContaining({
      startAt: "2026-09-16T17:40:00Z", endAt: "2026-09-16T17:50:00Z", sourceRefs: ["event-1"],
    })]);
    expect(plan.legs.find((leg) => leg.id === preparation[0]!.legId)?.role).toBe("outbound");
    expect(evidence.collisions).toEqual([expect.objectContaining({ candidateRef: "behavior-before", travelCreated: true })]);

    const zero = resolveTravelEvidence(evidenceInput(without, departures(without), [], BUFFERS));
    expect(zero.segments.some((segment) => segment.kind === "preparation_buffer")).toBe(false);
  });

  it("adds no get-ready time before onward or return legs", () => {
    const learned = { ...BUFFERS, preparationSeconds: 900 };
    const plan = resolveTravelPlan(planningInput({ buffers: learned, commitments: [
      commitment("event-1", "2026-09-16T18:30:00Z", "2026-09-16T19:00:00Z", endpoint("one", "calendar", "one-r1", 2)),
      commitment("event-2", "2026-09-16T20:00:00Z", "2026-09-16T20:30:00Z", endpoint("two", "calendar", "two-r1", 3)),
    ] }));
    const evidence = resolveTravelEvidence(evidenceInput(plan, plan.legs.map((leg) => resultFor(leg,
      leg.role === "outbound" ? estimate("2026-09-16T17:50:00Z", "2026-09-16T18:20:00Z", 1800)
        : leg.role === "onward" ? estimate("2026-09-16T19:10:00Z", "2026-09-16T19:40:00Z", 1800)
          : estimate("2026-09-16T20:40:00Z", "2026-09-16T21:10:00Z", 1800))), [], learned));
    const preparation = evidence.segments.filter((segment) => segment.kind === "preparation_buffer");
    expect(preparation).toHaveLength(1);
    expect(plan.legs.find((leg) => leg.id === preparation[0]!.legId)?.role).toBe("outbound");
  });

  it("rejects a negative get-ready time and keeps a learned arrival buffer in the arrival target", () => {
    expect(() => resolveTravelPlan(planningInput({ buffers: { ...BUFFERS, preparationSeconds: -1 } })))
      .toThrow("Preparation buffer must be finite and non-negative.");
    const plan = resolveTravelPlan(planningInput({ buffers: { arrivalSeconds: 300, exitSeconds: 0, settlingSeconds: 0, preparationSeconds: 600 } }));
    expect(plan.legs[0]!.request.timing).toEqual({ kind: "arrive_by", at: "2026-09-16T18:25:00Z" });
  });

  it("carries a remembered mode and its place key to the journey, never to the trip home", () => {
    const placeKey = travelPlaceKey("1 Gym Street");
    const remembered = { ...commitment("event-1", "2026-09-16T18:30:00Z", "2026-09-16T20:30:00Z",
      endpoint("event-1-place", "calendar", "event-1-place-r1", 2)), mode: "transit" as TravelMode, placeKey };
    const plan = resolveTravelPlan(planningInput({ commitments: [remembered] }));
    expect(plan.legs.map((leg) => [leg.role, leg.mode, leg.destinationPlaceKey])).toEqual([
      ["outbound", "transit", placeKey],
      ["return", "transit", null],
    ]);
    const evidence = resolveTravelEvidence(evidenceInput(plan, departures(plan), []));
    expect(evidence.legs.map(({ leg }) => leg.destinationPlaceKey)).toEqual([placeKey, null]);
    expect(() => resolveTravelPlan(planningInput({ commitments: [{ ...remembered, placeKey: "Main Street" }] })))
      .toThrow("Travel commitment place key must be a place key.");
  });
});
