import { Temporal } from "@js-temporal/polyfill";
import type { TravelEvidenceResult, TravelMode } from "../types/travel";

/**
 * Deterministic travel guidance shown beside the Daily Brief (Ticket 170).
 * It projects existing travel evidence; it never routes, estimates or moves
 * anything, and none of it reaches the model while model projection is gated.
 */
export type BriefTravelGuidanceItem =
  | Readonly<{ kind: "overlap"; behaviorLabel: string; travelLabel: string }>
  | Readonly<{ kind: "departure"; at: string; label: string; mode: TravelMode }>
  | Readonly<{ kind: "return"; at: string }>
  | Readonly<{ kind: "return_unknown" }>;

export type BriefTravelGuidance = Readonly<{
  localDate: string;
  observedAt: string;
  expiresAt: string;
  items: readonly BriefTravelGuidanceItem[];
  /** Brief option IDs whose proposed interval overlaps travel occupancy. */
  conflictingOptionIds: readonly string[];
  attribution: string | null;
  /** Travel-expanded occupancy, used to check brief options without another route request. */
  occupiedSpans: readonly Readonly<{ startAt: string; endAt: string }>[];
}>;

/** Half-open overlap between an interval and any travel-occupied span. Unknown travel is never treated as free. */
export function overlapsTravelSpans(
  interval: Readonly<{ startAt: string; endAt: string }>,
  spans: readonly Readonly<{ startAt: string; endAt: string }>[],
): boolean {
  return spans.some((span) =>
    Temporal.Instant.compare(Temporal.Instant.from(interval.startAt), Temporal.Instant.from(span.endAt)) < 0 &&
    Temporal.Instant.compare(Temporal.Instant.from(span.startAt), Temporal.Instant.from(interval.endAt)) < 0);
}

export type BriefTravelEvidence = Omit<TravelEvidenceResult, "modelProjection">;

/** Labels and Behavior candidates from today's Timeline rows and Calendar events. */
export function briefTravelSubjects(
  occurrences: readonly Readonly<{ id: string; title: string; status: string }>[],
  events: readonly Readonly<{ id: string; title: string }>[],
): Readonly<{ labels: ReadonlyMap<string, string>; behaviorRefs: ReadonlySet<string> }> {
  return {
    labels: new Map([...occurrences.map((item) => [item.id, item.title] as const), ...events.map((event) => [event.id, event.title] as const)]),
    // Resolved work is not crowded by travel; only Unresolved rows are candidates.
    behaviorRefs: new Set(occurrences.filter((item) => item.status === "unresolved").map((item) => item.id)),
  };
}

const MAX_ITEMS = 4;

export function projectBriefTravelGuidance(input: Readonly<{
  evidence: BriefTravelEvidence | null | undefined;
  localDate: string;
  now: string;
  /** Display titles by commitment or occurrence ref. */
  labels: ReadonlyMap<string, string>;
  /** Unresolved Behavior occurrence refs that travel may crowd. */
  behaviorRefs: ReadonlySet<string>;
  options?: readonly Readonly<{ id: string; startAt: string; endAt: string }>[];
}>): BriefTravelGuidance | null {
  const evidence = input.evidence;
  if (!evidence) return null;
  const now = Temporal.Instant.from(input.now);
  const after = (value: string) => Temporal.Instant.compare(Temporal.Instant.from(value), now) > 0;
  const current = evidence.legs.filter((item) => item.state === "current" && item.estimate && after(item.estimate.expiresAt));
  // Expired or changed estimates are withdrawn, never shown as current timing.
  if (!current.length) return null;
  const earliest = (values: string[]) => values.reduce((left, right) => Temporal.Instant.compare(Temporal.Instant.from(left), Temporal.Instant.from(right)) <= 0 ? left : right);
  const expiresAt = earliest(current.map((item) => item.estimate!.expiresAt));
  const observedAt = earliest(current.map((item) => item.estimate!.observedAt));
  const legById = new Map(evidence.legs.map((item) => [item.leg.id, item.leg]));
  const segmentById = new Map(evidence.segments.map((segment) => [segment.id, segment]));
  const label = (ref: string | null | undefined) => (ref ? input.labels.get(ref) : undefined) ?? "your next stop";

  const currentLegIds = new Set(current.map((item) => item.leg.id));
  // Only overlaps created by a current, unexpired leg are shown.
  const overlaps: BriefTravelGuidanceItem[] = evidence.collisions
    .filter((collision) => collision.travelCreated && input.behaviorRefs.has(collision.candidateRef) &&
      collision.segmentIds.some((id) => { const legId = segmentById.get(id)?.legId; return !!legId && currentLegIds.has(legId); }))
    .map((collision) => {
      const leg = collision.segmentIds.map((id) => segmentById.get(id)?.legId).find(Boolean);
      const destination = leg ? legById.get(leg)?.destinationCommitmentRef : null;
      return { kind: "overlap" as const, behaviorLabel: label(collision.candidateRef), travelLabel: destination ? label(destination) : "planned travel" };
    });
  const departures: BriefTravelGuidanceItem[] = current
    .filter((item) => item.leg.role !== "return" && after(item.estimate!.departureAt))
    .sort((left, right) => Temporal.Instant.compare(Temporal.Instant.from(left.estimate!.departureAt), Temporal.Instant.from(right.estimate!.departureAt)))
    .slice(0, 2)
    .map((item) => ({ kind: "departure" as const, at: item.estimate!.departureAt, label: label(item.leg.destinationCommitmentRef), mode: item.leg.mode }));
  const hasReturnLeg = evidence.legs.some((item) => item.leg.role === "return");
  // Without a return leg (no base, leg limit or unknown timing) only the return is withheld; known legs stay.
  const back: BriefTravelGuidanceItem[] = evidence.completeTrip && evidence.finalAvailabilityAt
    ? [{ kind: "return", at: evidence.finalAvailabilityAt }]
    : hasReturnLeg ? [] : [{ kind: "return_unknown" }];
  return {
    localDate: input.localDate,
    observedAt,
    expiresAt,
    items: [...overlaps, ...departures, ...back].slice(0, MAX_ITEMS),
    conflictingOptionIds: (input.options ?? []).filter((option) => overlapsTravelSpans(option, evidence.occupiedSpans)).map((option) => option.id),
    occupiedSpans: evidence.occupiedSpans.map((span) => ({ startAt: span.startAt, endAt: span.endAt })),
    attribution: current.find((item) => item.estimate!.attribution)?.estimate!.attribution ?? null,
  };
}
