import { Temporal } from "@js-temporal/polyfill";

import { sha256 } from "../hash";

import type {
  TravelCommitment,
  TravelEndpoint,
  TravelEvidenceLeg,
  TravelEvidenceInput,
  TravelEvidenceResult,
  TravelJourneyCorrection,
  TravelLegProvenance,
  TravelLegRole,
  TravelOccupiedSegment,
  TravelOccupiedSpan,
  TravelPlannedLeg,
  TravelPlanningInput,
  TravelPlanningResult,
  TravelPoint,
  TravelResolvedLegEvidence,
  TravelRouteEstimate,
  TravelUnknownLeg,
} from "../types/travel";
import { TRAVEL_EVIDENCE_VERSION } from "../types/travel";

const DEFAULT_MAX_DEVICE_AGE_SECONDS = 60;
const DEFAULT_MAX_DEVICE_ACCURACY_METERS = 100;
const DEFAULT_MAX_LEGS = 8;

export function resolveTravelPlan(input: TravelPlanningInput): TravelPlanningResult {
  const now = instant(input.now, "Travel now");
  validateNonEmpty(input.journeyRef, "Journey ref");
  validateNonEmpty(input.journeyRevision, "Journey revision");
  validateNonEmpty(input.grantRevision, "Travel grant revision");
  validateBuffers(input.buffers);
  const maxDeviceAge = nonNegative(
    input.maxDeviceAgeSeconds ?? DEFAULT_MAX_DEVICE_AGE_SECONDS,
    "Maximum device age",
  );
  const maxDeviceAccuracy = nonNegative(
    input.maxDeviceAccuracyMeters ?? DEFAULT_MAX_DEVICE_ACCURACY_METERS,
    "Maximum device accuracy",
  );
  const maxLegs = positiveInteger(input.maxLegs ?? DEFAULT_MAX_LEGS, "Maximum travel legs");
  const commitments = [...input.commitments]
    .filter((commitment) => !commitment.excluded)
    .sort((left, right) => Temporal.Instant.compare(
      instant(left.startAt, "Commitment start"),
      instant(right.startAt, "Commitment start"),
    ) || left.ref.localeCompare(right.ref));
  validateCommitments(commitments);
  const futureCommitments = commitments.filter((commitment) =>
    Temporal.Instant.compare(instant(commitment.startAt, "Commitment start"), now) > 0
  );
  for (const endpoint of [input.base, input.device, input.predictedOrigin]) {
    if (endpoint) validateEndpoint(endpoint);
  }

  const corrections = validCorrections(input.corrections, input.journeyRef);
  const initialOrigin = selectImmediateOrigin({
    input,
    corrections,
    now,
    maxDeviceAge,
    maxDeviceAccuracy,
  });
  const legs: TravelPlannedLeg[] = [];
  const unknownLegs: TravelUnknownLeg[] = [];
  let priorEndpoint: TravelEndpoint | null = initialOrigin;
  let priorCommitment: TravelCommitment | null = null;
  let chained = Boolean(initialOrigin);

  for (const commitment of futureCommitments) {
    if (commitment.attendance === "remote") continue;

    const corrected = correctionFor(corrections, commitment.ref, commitment.revision);
    const destination = corrected?.endpoint ?? commitment.endpoint;
    if (commitment.attendance !== "physical") {
      unknownLegs.push(unknownLeg(
        priorCommitment ? "onward" : "outbound",
        priorCommitment?.ref ?? null,
        commitment.ref,
        "attendance_unknown",
      ));
      priorEndpoint = null;
      priorCommitment = null;
      chained = false;
      continue;
    }
    if (!destination) {
      unknownLegs.push(unknownLeg(
        priorCommitment ? "onward" : "outbound",
        priorCommitment?.ref ?? null,
        commitment.ref,
        "destination_unknown",
      ));
      priorEndpoint = null;
      priorCommitment = null;
      chained = false;
      continue;
    }
    validateEndpoint(destination);

    const role: TravelLegRole = priorCommitment ? "onward" : "outbound";
    if (priorEndpoint && chained && samePlace(priorEndpoint.point, destination.point)) {
      // Consecutive stops at the same place need no travel and no route call (Ticket 214).
    } else if (!priorEndpoint || !chained) {
      unknownLegs.push(unknownLeg(role, priorCommitment?.ref ?? null, commitment.ref, "origin_unknown"));
    } else if (legs.length >= maxLegs) {
      unknownLegs.push(unknownLeg(role, priorCommitment?.ref ?? null, commitment.ref, "leg_limit"));
    } else {
      const readyAt = priorCommitment
        ? readyAfter(priorCommitment, input.buffers.exitSeconds)
        : now.toString();
      if (!readyAt) {
        unknownLegs.push(unknownLeg(role, priorCommitment?.ref ?? null, commitment.ref, "timing_unknown"));
      } else {
        const arrivalTarget = instant(commitment.startAt, "Commitment start")
          .subtract({ seconds: input.buffers.arrivalSeconds });
        legs.push(plannedLeg({
          input,
          role,
          origin: priorEndpoint,
          destination,
          originCommitmentRef: priorCommitment?.ref ?? null,
          destinationCommitmentRef: commitment.ref,
          readyAt,
          timing: { kind: "arrive_by", at: arrivalTarget.toString() },
          mode: commitment.mode ?? input.defaultMode,
        }));
      }
    }

    priorEndpoint = destination;
    priorCommitment = commitment;
    chained = true;
  }

  if (priorCommitment && priorEndpoint) {
    if (!input.base) {
      unknownLegs.push(unknownLeg("return", priorCommitment.ref, null, "return_base_missing"));
    } else if (legs.length >= maxLegs) {
      unknownLegs.push(unknownLeg("return", priorCommitment.ref, null, "leg_limit"));
    } else {
      validateEndpoint(input.base);
      const readyAt = readyAfter(priorCommitment, input.buffers.exitSeconds);
      if (!readyAt) {
        unknownLegs.push(unknownLeg("return", priorCommitment.ref, null, "timing_unknown"));
      } else {
        legs.push(plannedLeg({
          input,
          role: "return",
          origin: priorEndpoint,
          destination: input.base,
          originCommitmentRef: priorCommitment.ref,
          destinationCommitmentRef: null,
          readyAt,
          timing: { kind: "depart_at", at: readyAt },
          mode: priorCommitment.mode ?? input.defaultMode,
        }));
      }
    }
  }

  return {
    journeyRef: input.journeyRef,
    journeyRevision: input.journeyRevision,
    grantRevision: input.grantRevision,
    commitments,
    legs,
    unknownLegs,
  };
}

export function resolveTravelEvidence(input: TravelEvidenceInput): TravelEvidenceResult {
  const now = instant(input.now, "Travel evidence now");
  validateBuffers(input.buffers);
  const planRevisionCurrent = input.plan.journeyRevision === input.expectedJourneyRevision;
  const grantCurrent = input.plan.grantRevision === input.expectedGrantRevision;
  const resultByLeg = uniqueResults(input.results);
  const plannedLegIds = new Set(input.plan.legs.map((leg) => leg.id));
  for (const resultId of resultByLeg.keys()) {
    if (!plannedLegIds.has(resultId)) throw new Error("Travel route result must belong to the current plan.");
  }
  const legs = input.plan.legs.map((leg): TravelResolvedLegEvidence => {
    if (!planRevisionCurrent || !grantCurrent) {
      return rejected(publicLeg(leg), "rejected_revision", "Journey or grant revision changed.");
    }
    const result = resultByLeg.get(leg.id);
    if (!result) return rejected(publicLeg(leg), "unavailable", "Route result is missing.");
    if (!sameProvenance(leg.provenance, result.provenance)) {
      return rejected(publicLeg(leg), "rejected_revision", "Route endpoint or grant revision changed.");
    }
    if (!result.estimate) {
      return rejected(publicLeg(leg), "unavailable", result.unavailableReason ?? "Route unavailable.");
    }
    validateEstimate(result.estimate);
    if (Temporal.Instant.compare(instant(result.estimate.expiresAt, "Route expiry"), now) <= 0) {
      return rejected(publicLeg(leg), "stale", "Route estimate expired.");
    }
    if (Temporal.Instant.compare(instant(result.estimate.observedAt, "Route observation"), now) > 0) {
      return rejected(publicLeg(leg), "rejected_revision", "Route observation is in the future.");
    }
    if (Temporal.Instant.compare(
      instant(result.estimate.departureAt, "Route departure"),
      instant(leg.readyAt, "Route ready time"),
    ) < 0) {
      return rejected(publicLeg(leg), "unavailable", "Route departs before its ready time.");
    }
    const late = leg.request.timing.kind === "arrive_by" && Temporal.Instant.compare(
      instant(result.estimate.arrivalAt, "Route arrival"), instant(leg.request.timing.at, "Arrival target"),
    ) > 0;
    const estimate = late ? { ...result.estimate, warnings: [...result.estimate.warnings,
      "Estimated arrival is after the planned arrival time."] } : result.estimate;
    return { leg: publicLeg(leg), state: "current", estimate, reason: null };
  });

  const segments = planRevisionCurrent && grantCurrent
    ? resolveSegments(input.plan.commitments, legs, input.buffers)
    : [];
  const occupiedSpans = mergeSegments(segments);
  const collisions = resolveTravelCollisions(segments, input.collisionCandidates);
  const returnLeg = legs.find((entry) => entry.leg.role === "return") ?? null;
  const completeTrip = input.plan.unknownLegs.length === 0 &&
    legs.length > 0 &&
    legs.every((entry) => entry.state === "current") &&
    returnLeg?.state === "current";
  const finalAvailabilityAt = completeTrip && returnLeg?.state === "current" && returnLeg.estimate
    ? instant(returnLeg.estimate.arrivalAt, "Return arrival")
        .add({ seconds: input.buffers.settlingSeconds })
        .toString()
    : null;
  const modelProjection = input.modelProjection === "enabled" && planRevisionCurrent && grantCurrent
    ? {
        version: TRAVEL_EVIDENCE_VERSION,
        journeyRef: input.plan.journeyRef,
        legs: legs.flatMap((entry) => entry.state === "current" && entry.estimate
          ? [{
              ref: entry.leg.id,
              role: entry.leg.role,
              mode: entry.leg.mode,
              departureAt: entry.estimate.departureAt,
              arrivalAt: entry.estimate.arrivalAt,
              durationSeconds: entry.estimate.durationSeconds,
              fallback: entry.estimate.fallback,
              observedAt: entry.estimate.observedAt,
              expiresAt: entry.estimate.expiresAt,
            }]
          : []),
        occupiedSpans,
        collisions,
        completeTrip,
        finalAvailabilityAt,
      }
    : null;

  return {
    version: TRAVEL_EVIDENCE_VERSION,
    journeyRef: input.plan.journeyRef,
    legs,
    segments,
    occupiedSpans,
    collisions,
    completeTrip,
    finalAvailabilityAt,
    modelProjection,
  };
}

/** Reuse estimates after manual decisions; never invent a route around a resolved stop. */
export function resolveTravelAfterDecisions(
  evidence: Omit<TravelEvidenceResult, "modelProjection">,
  resolvedRefs: ReadonlySet<string>,
): Omit<TravelEvidenceResult, "modelProjection"> {
  if (!resolvedRefs.size) return evidence;
  const legs = evidence.legs.filter(({ leg }) =>
    !resolvedRefs.has(leg.originCommitmentRef ?? "") && !resolvedRefs.has(leg.destinationCommitmentRef ?? ""));
  const legIds = new Set(legs.map(({ leg }) => leg.id));
  const segments = evidence.segments.filter(segment =>
    !segment.sourceRefs.some(ref => resolvedRefs.has(ref)) && (!segment.legId || legIds.has(segment.legId)));
  const segmentById = new Map(segments.map(segment => [segment.id, segment]));
  const collisions = evidence.collisions.flatMap(collision => {
    if (resolvedRefs.has(collision.candidateRef)) return [];
    const segmentIds = collision.segmentIds.filter(id => segmentById.has(id));
    return segmentIds.length ? [{ ...collision, segmentIds,
      travelCreated: segmentIds.some(id => segmentById.get(id)!.kind !== "commitment") }] : [];
  });
  const changed = legs.length !== evidence.legs.length || segments.length !== evidence.segments.length;
  return { ...evidence, legs, segments, collisions, occupiedSpans: mergeSegments(segments),
    completeTrip: !changed && evidence.completeTrip, finalAvailabilityAt: changed ? null : evidence.finalAvailabilityAt };
}

function selectImmediateOrigin(args: Readonly<{
  input: TravelPlanningInput;
  corrections: TravelJourneyCorrection[];
  now: Temporal.Instant;
  maxDeviceAge: number;
  maxDeviceAccuracy: number;
}>): TravelEndpoint | null {
  const corrected = correctionFor(args.corrections, "origin", args.input.journeyRevision)?.endpoint;
  if (corrected) {
    validateEndpoint(corrected);
    return corrected;
  }
  if (args.input.device && deviceIsFresh(
    args.input.device,
    args.now,
    args.input.grantRevision,
    args.maxDeviceAge,
    args.maxDeviceAccuracy,
  )) return args.input.device;
  return args.input.base;
}

function deviceIsFresh(
  endpoint: TravelEndpoint,
  now: Temporal.Instant,
  grantRevision: string,
  maxAgeSeconds: number,
  maxAccuracyMeters: number,
): boolean {
  if (
    endpoint.source !== "device" ||
    !endpoint.observedAt ||
    endpoint.grantRevision !== grantRevision ||
    endpoint.accuracyMeters === undefined ||
    !Number.isFinite(endpoint.accuracyMeters) ||
    endpoint.accuracyMeters < 0 ||
    endpoint.accuracyMeters > maxAccuracyMeters
  ) return false;
  const observedAt = instant(endpoint.observedAt, "Device observation");
  const age = now.since(observedAt).total("seconds");
  return age >= 0 && age <= maxAgeSeconds;
}

function plannedLeg(args: Readonly<{
  input: TravelPlanningInput;
  role: TravelLegRole;
  origin: TravelEndpoint;
  destination: TravelEndpoint;
  originCommitmentRef: string | null;
  destinationCommitmentRef: string | null;
  readyAt: string;
  timing: TravelPlannedLeg["request"]["timing"];
  mode: TravelPlannedLeg["mode"];
}>): TravelPlannedLeg {
  return {
    id: `travel_${sha256(JSON.stringify([
      args.input.journeyRef,
      args.input.journeyRevision,
      args.input.grantRevision,
      args.role,
      args.originCommitmentRef,
      args.destinationCommitmentRef,
      args.origin.ref,
      args.destination.ref,
      args.origin.sourceRevision,
      args.destination.sourceRevision,
      args.mode,
      args.readyAt,
      args.timing.kind,
      args.timing.at,
    ]))}`,
    role: args.role,
    journeyRef: args.input.journeyRef,
    originCommitmentRef: args.originCommitmentRef,
    destinationCommitmentRef: args.destinationCommitmentRef,
    mode: args.mode,
    readyAt: args.readyAt,
    request: {
      origin: args.origin.point,
      destination: args.destination.point,
      mode: args.mode,
      readyAt: args.readyAt,
      timing: args.timing,
    },
    provenance: {
      originRef: args.origin.ref,
      originSource: args.origin.source,
      originRevision: args.origin.sourceRevision,
      destinationRef: args.destination.ref,
      destinationSource: args.destination.source,
      destinationRevision: args.destination.sourceRevision,
      grantRevision: args.input.grantRevision,
    },
  };
}

function resolveSegments(
  commitments: TravelCommitment[],
  legs: TravelResolvedLegEvidence[],
  buffers: TravelEvidenceInput["buffers"],
): TravelOccupiedSegment[] {
  const commitmentsByRef = new Map(commitments.map((commitment) => [commitment.ref, commitment]));
  const segments: TravelOccupiedSegment[] = commitments.flatMap((commitment) =>
    commitment.endAt && Temporal.Instant.compare(
      instant(commitment.startAt, "Commitment start"),
      instant(commitment.endAt, "Commitment end"),
    ) < 0
      ? [segment(`commitment:${commitment.ref}`, "commitment", commitment.startAt, commitment.endAt, [commitment.ref], null)]
      : [],
  );

  for (const entry of legs) {
    if (entry.state !== "current" || !entry.estimate) continue;
    const { leg, estimate } = entry;
    const sourceRefs = [leg.originCommitmentRef, leg.destinationCommitmentRef]
      .filter((ref): ref is string => ref !== null);
    segments.push(segment(`route:${leg.id}`, "route", estimate.departureAt, estimate.arrivalAt, sourceRefs, leg.id));

    const origin = leg.originCommitmentRef ? commitmentsByRef.get(leg.originCommitmentRef) : null;
    if (origin?.endAt && buffers.exitSeconds > 0) {
      const end = instant(origin.endAt, "Commitment end").add({ seconds: buffers.exitSeconds }).toString();
      segments.push(segment(`exit:${leg.id}`, "exit_buffer", origin.endAt, end, [origin.ref], leg.id));
    }
    const destination = leg.destinationCommitmentRef
      ? commitmentsByRef.get(leg.destinationCommitmentRef)
      : null;
    if (destination && buffers.arrivalSeconds > 0) {
      const start = instant(destination.startAt, "Commitment start")
        .subtract({ seconds: buffers.arrivalSeconds })
        .toString();
      segments.push(segment(`arrival:${leg.id}`, "arrival_buffer", start, destination.startAt, [destination.ref], leg.id));
    }
    if (leg.role === "return" && buffers.settlingSeconds > 0) {
      const end = instant(estimate.arrivalAt, "Return arrival")
        .add({ seconds: buffers.settlingSeconds })
        .toString();
      segments.push(segment(`settling:${leg.id}`, "settling_buffer", estimate.arrivalAt, end, sourceRefs, leg.id));
    }
  }

  return segments
    .filter((value) => value.startAt !== value.endAt)
    .filter((value, index, all) => all.findIndex((candidate) => candidate.id === value.id) === index)
    .sort((left, right) => Temporal.Instant.compare(
      instant(left.startAt, "Occupied segment start"),
      instant(right.startAt, "Occupied segment start"),
    ) || left.id.localeCompare(right.id));
}

function mergeSegments(segments: TravelOccupiedSegment[]): TravelOccupiedSpan[] {
  const spans: TravelOccupiedSpan[] = [];
  for (const value of segments) {
    const last = spans.at(-1);
    if (!last || Temporal.Instant.compare(
      instant(value.startAt, "Occupied segment start"),
      instant(last.endAt, "Occupied span end"),
    ) > 0) {
      spans.push({ startAt: value.startAt, endAt: value.endAt, segmentIds: [value.id] });
      continue;
    }
    if (Temporal.Instant.compare(
      instant(value.endAt, "Occupied segment end"),
      instant(last.endAt, "Occupied span end"),
    ) > 0) {
      spans[spans.length - 1] = {
        startAt: last.startAt,
        endAt: value.endAt,
        segmentIds: [...last.segmentIds, value.id],
      };
    } else {
      spans[spans.length - 1] = { ...last, segmentIds: [...last.segmentIds, value.id] };
    }
  }
  return spans;
}

export function resolveTravelCollisions(
  segments: TravelOccupiedSegment[],
  candidates: TravelEvidenceInput["collisionCandidates"],
): TravelEvidenceResult["collisions"] {
  return candidates.flatMap((candidate) => {
    if (!candidate.endAt) return [];
    const start = instant(candidate.startAt, "Collision candidate start");
    const end = instant(candidate.endAt, "Collision candidate end");
    if (Temporal.Instant.compare(start, end) >= 0) return [];
    const overlapping = segments.filter((occupied) =>
      !occupied.sourceRefs.includes(candidate.ref) &&
      Temporal.Instant.compare(start, instant(occupied.endAt, "Occupied segment end")) < 0 &&
      Temporal.Instant.compare(instant(occupied.startAt, "Occupied segment start"), end) < 0
    );
    return overlapping.length === 0 ? [] : [{
      candidateRef: candidate.ref,
      segmentIds: overlapping.map((occupied) => occupied.id),
      travelCreated: overlapping.some((occupied) => occupied.kind !== "commitment"),
    }];
  });
}

function segment(
  id: string,
  kind: TravelOccupiedSegment["kind"],
  startAt: string,
  endAt: string,
  sourceRefs: string[],
  legId: string | null,
): TravelOccupiedSegment {
  const start = instant(startAt, "Occupied segment start");
  const end = instant(endAt, "Occupied segment end");
  if (Temporal.Instant.compare(start, end) > 0) {
    throw new Error("Occupied segment end must not precede its start.");
  }
  return { id, kind, startAt: start.toString(), endAt: end.toString(), sourceRefs, legId };
}

function uniqueResults(results: TravelEvidenceInput["results"]): Map<string, TravelEvidenceInput["results"][number]> {
  const values = new Map<string, TravelEvidenceInput["results"][number]>();
  for (const result of results) {
    if (values.has(result.legId)) throw new Error("Travel route result ids must be unique.");
    values.set(result.legId, result);
  }
  return values;
}

function validateCommitments(commitments: TravelCommitment[]): void {
  const refs = new Set<string>();
  for (const commitment of commitments) {
    validateNonEmpty(commitment.ref, "Commitment ref");
    validateNonEmpty(commitment.revision, "Commitment revision");
    if (refs.has(commitment.ref)) throw new Error("Travel commitment refs must be unique.");
    refs.add(commitment.ref);
    const start = instant(commitment.startAt, "Commitment start");
    if (commitment.endAt && Temporal.Instant.compare(start, instant(commitment.endAt, "Commitment end")) > 0) {
      throw new Error("Travel commitment end must not precede its start.");
    }
    if (commitment.endpoint) validateEndpoint(commitment.endpoint);
  }
}

function validateEndpoint(endpoint: TravelEndpoint): void {
  validateNonEmpty(endpoint.ref, "Travel endpoint ref");
  validateNonEmpty(endpoint.sourceRevision, "Travel endpoint revision");
  validatePoint(endpoint.point);
}

function validatePoint(point: TravelPoint): void {
  if (point.kind === "place_id") {
    validateNonEmpty(point.placeId, "Travel place id");
    return;
  }
  if (
    !Number.isFinite(point.latitude) || point.latitude < -90 || point.latitude > 90 ||
    !Number.isFinite(point.longitude) || point.longitude < -180 || point.longitude > 180
  ) throw new Error("Travel coordinates must be finite valid latitude and longitude values.");
}

function validateEstimate(estimate: TravelRouteEstimate): void {
  nonNegative(estimate.durationSeconds, "Route duration");
  validateNonEmpty(estimate.attribution, "Route attribution");
  const departure = instant(estimate.departureAt, "Route departure");
  const arrival = instant(estimate.arrivalAt, "Route arrival");
  const observed = instant(estimate.observedAt, "Route observation");
  const expiry = instant(estimate.expiresAt, "Route expiry");
  if (Temporal.Instant.compare(departure, arrival) > 0) throw new Error("Route arrival must not precede departure.");
  if (Temporal.Instant.compare(observed, expiry) >= 0) throw new Error("Route expiry must follow its observation.");
}

function validateBuffers(buffers: TravelEvidenceInput["buffers"]): void {
  nonNegative(buffers.arrivalSeconds, "Arrival buffer");
  nonNegative(buffers.exitSeconds, "Exit buffer");
  nonNegative(buffers.settlingSeconds, "Settling buffer");
}

function validCorrections(corrections: TravelJourneyCorrection[], journeyRef: string): TravelJourneyCorrection[] {
  const targets = new Set<string>();
  return corrections.filter((correction) => {
    if (correction.journeyRef !== journeyRef) return false;
    validateNonEmpty(correction.targetRef, "Travel correction target");
    validateNonEmpty(correction.appliesToRevision, "Travel correction revision");
    validateEndpoint(correction.endpoint);
    if (targets.has(correction.targetRef)) throw new Error("Travel corrections must target a journey point once.");
    targets.add(correction.targetRef);
    return true;
  });
}

function correctionFor(
  corrections: TravelJourneyCorrection[],
  targetRef: string,
  revision: string,
): TravelJourneyCorrection | null {
  return corrections.find((correction) =>
    correction.targetRef === targetRef && correction.appliesToRevision === revision
  ) ?? null;
}

function samePlace(left: TravelEndpoint["point"], right: TravelEndpoint["point"]): boolean {
  return left.kind === "place_id" && right.kind === "place_id" && left.placeId === right.placeId;
}

function readyAfter(commitment: TravelCommitment, exitSeconds: number): string | null {
  return commitment.endAt
    ? instant(commitment.endAt, "Commitment end").add({ seconds: exitSeconds }).toString()
    : null;
}

function unknownLeg(
  role: TravelLegRole,
  originCommitmentRef: string | null,
  destinationCommitmentRef: string | null,
  reason: TravelUnknownLeg["reason"],
): TravelUnknownLeg {
  return { role, originCommitmentRef, destinationCommitmentRef, reason };
}

function rejected(
  leg: TravelEvidenceLeg,
  state: Exclude<TravelResolvedLegEvidence["state"], "current">,
  reason: string,
): TravelResolvedLegEvidence {
  return { leg, state, estimate: null, reason };
}

function publicLeg(leg: TravelPlannedLeg): TravelEvidenceLeg {
  return {
    id: leg.id,
    role: leg.role,
    journeyRef: leg.journeyRef,
    originCommitmentRef: leg.originCommitmentRef,
    destinationCommitmentRef: leg.destinationCommitmentRef,
    mode: leg.mode,
    readyAt: leg.readyAt,
    provenance: leg.provenance,
  };
}

function sameProvenance(left: TravelLegProvenance, right: TravelLegProvenance): boolean {
  return left.originRef === right.originRef &&
    left.originSource === right.originSource &&
    left.originRevision === right.originRevision &&
    left.destinationRef === right.destinationRef &&
    left.destinationSource === right.destinationSource &&
    left.destinationRevision === right.destinationRevision &&
    left.grantRevision === right.grantRevision;
}

function instant(value: string, label: string): Temporal.Instant {
  try {
    return Temporal.Instant.from(value);
  } catch {
    throw new Error(`${label} must be a valid instant.`);
  }
}

function nonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be finite and non-negative.`);
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer.`);
  return value;
}

function validateNonEmpty(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} must not be empty.`);
}
