import { Temporal } from "@js-temporal/polyfill";

import { departureDetailPhrase, departureLinePhrase, departurePausedPhrase, departurePhraseContext } from "../services/departure-phrases";
import type { DeparturePhraseContext } from "../services/departure-phrases";
import { TRAVEL_LEG_OUTSIDE_WINDOW, travelEstimateAppearsAt, travelTripKey } from "../services/travel-refresh-policy";
import type { DepartureModel, DepartureModelInput, DepartureStop, DepartureTrip } from "../types/departure";
import type { TravelResolvedLegEvidence, TravelUnknownLeg } from "../types/travel";
import { travelLegsAfterLateArrival } from "./travel.resolver";

/** At this many seconds or fewer before the leave time, a trip is "soon". */
export const DEPARTURE_SOON_SECONDS = 30 * 60;
/** "Leave now" lasts this long from the leave time. At exactly this age the trip is late. */
export const DEPARTURE_LEAVE_NOW_SECONDS = 5 * 60;

type Draft = Omit<DepartureTrip, "phrase" | "linePhrase">;
type Candidate = Readonly<{ draft: Draft; finishedAt: Temporal.Instant | null }>;

/**
 * Ticket 265: the one answer to "when do I leave next?". Pure: `now` and the timezone are
 * injected. Nothing here reaches Daily Brief model input.
 */
export function resolveDepartureModel(input: DepartureModelInput): DepartureModel {
  const now = Temporal.Instant.from(input.now);
  const paused = input.pausedUntil && Temporal.Instant.compare(Temporal.Instant.from(input.pausedUntil), now) > 0
    ? input.pausedUntil
    : null;
  const pausedPhrase = paused ? departurePausedPhrase(paused, input.timezone) : null;
  const context = departurePhraseContext(input.now, input.timezone);
  const stops = new Map(input.stops.map((stop) => [stop.ref, stop]));
  const afterLate = input.evidence ? travelLegsAfterLateArrival(input.evidence.legs) : new Map<string, number>();

  // An unknown trip has no time of its own. Its plan's day is the day of the earliest routed leg.
  // With no routed leg nothing dates the plan, so a trip whose stop is missing is dropped.
  const readyTimes = (input.evidence?.legs ?? []).map((entry) => Temporal.Instant.from(entry.leg.readyAt)).sort(Temporal.Instant.compare);
  const unknownDayEnd = readyTimes[0] ? endOfLocalDay(readyTimes[0], input.timezone) : now;
  const remaining = input.evidence
    ? tripsInOrder(input.evidence, stops).flatMap((trip, index, all): Candidate[] => {
        const candidate = "leg" in trip
          ? fromLeg(trip, input, now, stops, afterLate.get(trip.leg.id) ?? 0)
          : fromUnknown(trip, all[index - 1] ?? null, stops, unknownDayEnd);
        if (!candidate) return [];
        return candidate.finishedAt && Temporal.Instant.compare(now, candidate.finishedAt) >= 0 ? [] : [candidate];
      })
    : [];

  const trips = remaining.map(({ draft }, index) => finish(
    withPause(index === 0 ? withHeadHome(draft, stops, now) : draft, paused),
    stops, context, paused, now,
  ));
  const next = trips[0] ?? null;
  if (next) return { state: next.state, next, phrase: next.linePhrase, trips, resumesAt: paused, pausedPhrase };
  // Evidence with no trips means none, and so does a day with no stops. Otherwise, without
  // evidence, a pause is all that can be said.
  if (paused && !input.evidence && input.stops.length > 0) return { state: "paused", next: null, phrase: pausedPhrase, trips, resumesAt: paused, pausedPhrase };
  return { state: "none", next: null, phrase: null, trips, resumesAt: null, pausedPhrase: null };
}

type EvidenceTrip = TravelResolvedLegEvidence | TravelUnknownLeg;

/** Trips by destination start. The trip home follows every stop. */
function tripsInOrder(
  evidence: NonNullable<DepartureModelInput["evidence"]>,
  stops: ReadonlyMap<string, DepartureStop>,
): EvidenceTrip[] {
  const destination = (trip: EvidenceTrip) => "leg" in trip ? trip.leg.destinationCommitmentRef : trip.destinationCommitmentRef;
  const role = (trip: EvidenceTrip) => "leg" in trip ? trip.leg.role : trip.role;
  const anchor = (trip: EvidenceTrip) => {
    const stop = stops.get(destination(trip) ?? "");
    return stop ? Temporal.Instant.from(stop.startAt) : null;
  };
  const all: EvidenceTrip[] = [...evidence.legs, ...(evidence.unknownLegs ?? [])];
  const outward = all.filter((trip) => role(trip) !== "return").sort((left, right) => {
    const [a, b] = [anchor(left), anchor(right)];
    if (!a || !b) return a ? -1 : b ? 1 : 0;
    return Temporal.Instant.compare(a, b);
  });
  return [...outward, ...all.filter((trip) => role(trip) === "return")];
}

function fromLeg(
  entry: TravelResolvedLegEvidence,
  input: DepartureModelInput,
  now: Temporal.Instant,
  stops: ReadonlyMap<string, DepartureStop>,
  delaySeconds: number,
): Candidate {
  const { leg, estimate } = entry;
  const base = baseDraft(leg.role, leg.originCommitmentRef, leg.destinationCommitmentRef, leg.id);
  const trip: Draft = { ...base, mode: leg.mode, fromHome: leg.provenance.originSource === "saved_base" };
  const destinationStart = stops.get(leg.destinationCommitmentRef ?? "")?.startAt ?? null;
  const usable = !!estimate && (entry.state === "current" || entry.state === "stale");
  if (!usable) return {
    draft: withoutTime(trip, entry, input, destinationStart, now),
    finishedAt: leg.role === "return"
      ? Temporal.Instant.from(leg.readyAt)
      // A stop missing from the input has no start, so the trip ends with its local day.
      : destinationStart ? Temporal.Instant.from(destinationStart) : endOfLocalDay(Temporal.Instant.from(leg.readyAt), input.timezone),
  };

  const leaveAt = Temporal.Instant.from(entry.weather?.departureAt ?? estimate.departureAt);
  const arriveAt = Temporal.Instant.from(entry.weather?.arrivalAt ?? estimate.arrivalAt);
  const travel = arriveAt.since(leaveAt);
  // From route times only. An arrival moved by the clock must never keep a trip open.
  const carriedArrival = arriveAt.add({ seconds: delaySeconds });
  const finishedAt = leg.role !== "return" && destinationStart && Temporal.Instant.compare(Temporal.Instant.from(destinationStart), carriedArrival) > 0
    ? Temporal.Instant.from(destinationStart)
    : carriedArrival;
  // Until the previous trip has arrived this trip's times mean nothing. After that it can leave at once.
  if (delaySeconds > 0 && Temporal.Instant.compare(now, leaveAt.add({ seconds: delaySeconds })) < 0) {
    const originLabel = stops.get(leg.originCommitmentRef ?? "")?.label ?? null;
    return { finishedAt, draft: { ...trip, state: "time_unknown", timeUnknownCause: "late_arrival",
      blockingRef: leg.originCommitmentRef, blockingLabel: originLabel, action: "refresh" } };
  }

  const expired = entry.state === "stale" || Temporal.Instant.compare(Temporal.Instant.from(estimate.expiresAt), now) <= 0;
  const untilLeave = leaveAt.since(now).total("seconds");
  const arrived = untilLeave <= 0;
  const pastLeaveNow = untilLeave <= -DEPARTURE_LEAVE_NOW_SECONDS;
  // An expired late flag says nothing once leave now has passed. Only the clock is left.
  const lateBasis = entry.late && !(expired && pastLeaveNow) ? "evidence" : pastLeaveNow ? "clock" : null;
  const state: Draft["state"] = lateBasis ? "late"
    : arrived ? "leave_now" : untilLeave <= DEPARTURE_SOON_SECONDS ? "soon" : "upcoming";
  const fromNow = now.add(travel);
  const shownArrival = lateBasis === "evidence"
    ? carriedArrival
    : arrived && Temporal.Instant.compare(fromNow, arriveAt) > 0 ? fromNow : arriveAt;
  return { finishedAt, draft: { ...trip, state, lateBasis,
    freshness: expired ? "last_estimate" : "current",
    checkedAt: estimate.observedAt,
    leaveAt: leaveAt.toString(),
    arriveAt: shownArrival.toString(),
    getReadyAt: getReadyAt(leg.role, leaveAt, Temporal.Instant.from(leg.readyAt), input.preparationSeconds),
    minutesUntilLeave: arrived ? null : Math.ceil(untilLeave / 60),
    action: expired ? "refresh" : null } };
}

function withoutTime(
  trip: Draft,
  entry: TravelResolvedLegEvidence,
  input: DepartureModelInput,
  destinationStart: string | null,
  now: Temporal.Instant,
): Draft {
  if (entry.state === "stale") return { ...trip, state: "estimate_expired", action: "refresh" };
  if (entry.state === "rejected_revision") return { ...trip, state: "trip_changed", action: "refresh" };
  if (entry.reason !== TRAVEL_LEG_OUTSIDE_WINDOW) return { ...trip, state: "no_route" };
  const appearsAt = travelEstimateAppearsAt({ role: entry.leg.role, readyAt: entry.leg.readyAt, destinationStartAt: destinationStart, arrivalBufferSeconds: input.arrivalBufferSeconds });
  const overdue = !!appearsAt && Temporal.Instant.compare(Temporal.Instant.from(appearsAt), now) <= 0;
  return { ...trip, state: "appears_later", appearsAt, action: overdue ? "refresh" : null };
}

function fromUnknown(
  unknown: TravelUnknownLeg,
  previous: EvidenceTrip | null,
  stops: ReadonlyMap<string, DepartureStop>,
  dayEnd: Temporal.Instant,
): Candidate | null {
  const trip = baseDraft(unknown.role, unknown.originCommitmentRef, unknown.destinationCommitmentRef, null);
  const origin = stops.get(unknown.originCommitmentRef ?? "");
  const destination = stops.get(unknown.destinationCommitmentRef ?? "");
  // A stop missing from the input gives no time, so such a trip lasts no longer than today.
  const finishedAt = unknown.role === "return"
    ? origin ? Temporal.Instant.from(origin.endAt ?? origin.startAt) : dayEnd
    : destination ? Temporal.Instant.from(destination.startAt) : dayEnd;
  switch (unknown.reason) {
    case "destination_unknown": return { finishedAt, draft: { ...trip, state: "needs_place" } };
    case "origin_unknown": {
      if (unknown.blockerResolved) return { finishedAt, draft: { ...trip, state: "trip_changed", action: "refresh" } };
      // The plan loses its place at the unknown stop before this one, and names no origin itself.
      const blocker = previous && !("leg" in previous) &&
        previous.reason === "destination_unknown"
        ? previous.destinationCommitmentRef
        : null;
      return { finishedAt, draft: { ...trip, state: "needs_origin", blockingRef: blocker,
        blockingLabel: blocker ? stops.get(blocker)?.label ?? null : null } };
    }
    case "return_base_missing": return { finishedAt, draft: { ...trip, state: "time_unknown", timeUnknownCause: "home_missing" } };
    case "timing_unknown": return { finishedAt, draft: { ...trip, state: "time_unknown", timeUnknownCause: "no_known_end" } };
    case "leg_limit": return { finishedAt, draft: { ...trip, state: "time_unknown", timeUnknownCause: "leg_limit" } };
    // A reason this version does not know, such as `attendance_unknown` from evidence saved
    // before decision D12, says nothing usable. The trip is skipped rather than breaking the day.
    default: return null;
  }
}

/** The first instant of the next local date, so a trip with no time of its own lasts no longer than its day. */
function endOfLocalDay(at: Temporal.Instant, timezone: string): Temporal.Instant {
  return at.toZonedDateTimeISO(timezone).toPlainDate().add({ days: 1 }).toZonedDateTime({ timeZone: timezone }).toInstant();
}

function baseDraft(role: Draft["role"], originRef: string | null, destinationRef: string | null, legId: string | null): Draft {
  return { key: travelTripKey({ role, originRef, destinationRef }), legId, role, originRef, destinationRef,
    mode: null, fromHome: false, state: "no_route", lateBasis: null, freshness: null, checkedAt: null, leaveAt: null, arriveAt: null,
    getReadyAt: null, minutesUntilLeave: null, appearsAt: null, timeUnknownCause: null, blockingRef: null, blockingLabel: null, action: null };
}

/** Mirrors the evidence's get-ready segment: outbound only, and never before the ready time. */
function getReadyAt(role: Draft["role"], leaveAt: Temporal.Instant, readyAt: Temporal.Instant, preparationSeconds: number): string | null {
  if (role !== "outbound" || preparationSeconds <= 0) return null;
  const earliest = leaveAt.subtract({ seconds: Math.ceil(preparationSeconds) });
  return (Temporal.Instant.compare(earliest, readyAt) < 0 ? readyAt : earliest).toString();
}

/** The trip home is "head home" only as the next trip while its event is under way. */
function withHeadHome(draft: Draft, stops: ReadonlyMap<string, DepartureStop>, now: Temporal.Instant): Draft {
  if (draft.role !== "return" || !draft.leaveAt) return draft;
  const origin = stops.get(draft.originRef ?? "");
  if (!origin?.endAt) return draft;
  const underWay = Temporal.Instant.compare(Temporal.Instant.from(origin.startAt), now) <= 0 &&
    Temporal.Instant.compare(now, Temporal.Instant.from(origin.endAt)) < 0;
  return underWay ? { ...draft, state: "head_home" } : draft;
}

/** A pause replaces only states waiting on a route. Known times and steps the user can take stay. */
function withPause(draft: Draft, paused: string | null): Draft {
  if (!paused) return draft;
  const waiting = draft.state === "appears_later" || draft.state === "estimate_expired" ||
    draft.state === "no_route" || draft.state === "trip_changed";
  return waiting ? { ...draft, state: "paused", appearsAt: null, action: null } : { ...draft, action: null };
}

function finish(
  draft: Draft,
  stops: ReadonlyMap<string, DepartureStop>,
  context: DeparturePhraseContext,
  paused: string | null,
  now: Temporal.Instant,
): DepartureTrip {
  const phraseInput = { ...draft,
    destinationLabel: stops.get(draft.destinationRef ?? "")?.label ?? null,
    appearsOverdue: !!draft.appearsAt && Temporal.Instant.compare(Temporal.Instant.from(draft.appearsAt), now) <= 0,
    resumesAt: paused };
  return { ...draft, phrase: departureDetailPhrase(phraseInput, context), linePhrase: departureLinePhrase(phraseInput, context) };
}
