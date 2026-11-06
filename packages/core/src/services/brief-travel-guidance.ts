import { Temporal } from "@js-temporal/polyfill";
import { travelLegsAfterLateArrival } from "../resolvers/travel.resolver";
import type { DepartureModel, DepartureTrip } from "../types/departure";
import type { TravelEvidenceResult } from "../types/travel";
import type { TravelWeatherSummary, WeatherConditionId, WeatherModeSuggestion } from "../types/weather";
import { RETURN_TIME_UNKNOWN, departureBriefBackPhrase, departureBriefOverlapPhrase, departurePhraseContext } from "./departure-phrases";

/**
 * Deterministic travel guidance shown beside the Daily Brief (Ticket 170). Ticket 272: its lines
 * come from the departure model, in the forms that name the event. A last estimate stays, marked,
 * and a late trip shows as late. It never routes, estimates or moves anything, and none of it
 * reaches the model: model input carries only Cadence's signed conclusions (L-001).
 */
export type BriefTravelGuidanceItem = Readonly<{
  kind: "overlap" | "departure" | "return";
  /** The finished sentence. */
  phrase: string;
  /** Ticket 218: a departure's fixed weather margin, already in its leave time. Null otherwise. */
  weather: BriefTravelWeather | null;
}>;

export type BriefTravelWeather = Readonly<{
  marginMinutes: number;
  conditions: readonly WeatherConditionId[];
  suggestion: WeatherModeSuggestion | null;
}>;

export type BriefTravelGuidance = Readonly<{
  localDate: string;
  /** The earliest check time among the shown estimates, for the footer. */
  observedAt: string;
  expiresAt: string;
  items: readonly BriefTravelGuidanceItem[];
  /** Brief option IDs whose proposed interval overlaps travel occupancy. */
  conflictingOptionIds: readonly string[];
  attribution: string | null;
  /** Ticket 218: weather state and Open-Meteo credit; null while weather is off. */
  weather: Pick<TravelWeatherSummary, "state" | "attribution"> | null;
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
const MAX_DEPARTURES = 2;

export function projectBriefTravelGuidance(input: Readonly<{
  evidence: BriefTravelEvidence | null | undefined;
  /** The departure model for the same evidence and clock (Ticket 265). */
  departure: Pick<DepartureModel, "trips">;
  localDate: string;
  now: string;
  timezone: string;
  /** Display titles by commitment or occurrence ref. */
  labels: ReadonlyMap<string, string>;
  /** Unresolved Behavior occurrence refs that travel may crowd. */
  behaviorRefs: ReadonlySet<string>;
  options?: readonly Readonly<{ id: string; startAt: string; endAt: string }>[];
}>): BriefTravelGuidance | null {
  const evidence = input.evidence;
  if (!evidence) return null;
  const context = departurePhraseContext(input.now, input.timezone);
  const trips = input.departure.trips;
  const entryById = new Map(evidence.legs.map((item) => [item.leg.id, item]));
  const segmentById = new Map(evidence.segments.map((segment) => [segment.id, segment]));
  const label = (ref: string | null | undefined) => (ref ? input.labels.get(ref) : undefined) ?? "your next stop";
  // A trip with a time, current or a last estimate, until it has arrived. The model drops it then.
  const timed = trips.filter((trip) => trip.leaveAt !== null && trip.legId !== null);
  const timedLegIds = new Set(timed.map((trip) => trip.legId!));

  const overlaps: BriefTravelGuidanceItem[] = evidence.collisions
    .filter((collision) => collision.travelCreated && input.behaviorRefs.has(collision.candidateRef) &&
      collision.segmentIds.some((id) => { const legId = segmentById.get(id)?.legId; return !!legId && timedLegIds.has(legId); }))
    .map((collision) => {
      const legId = collision.segmentIds.map((id) => segmentById.get(id)?.legId).find(Boolean);
      const destination = legId ? entryById.get(legId)?.leg.destinationCommitmentRef : null;
      return { kind: "overlap" as const, weather: null,
        phrase: departureBriefOverlapPhrase(label(collision.candidateRef), destination ? label(destination) : null) };
    });
  // Outbound trips with a time, including late ones, and a trip held up by a late arrival (Ticket 265).
  const departures: BriefTravelGuidanceItem[] = trips
    .filter((trip) => trip.role !== "return" && (trip.leaveAt !== null || (trip.state === "time_unknown" && trip.timeUnknownCause === "late_arrival")))
    .slice(0, MAX_DEPARTURES)
    .map((trip) => ({ kind: "departure" as const, phrase: trip.linePhrase, weather: weatherOf(trip, entryById) }));
  const back = returnItems(evidence, trips, context);
  const items = [...overlaps, ...departures, ...back].slice(0, MAX_ITEMS);

  const occupiedSpans = [...evidence.occupiedSpans.map((span) => ({ startAt: span.startAt, endAt: span.endAt })), ...unreliableTravelSpans(evidence)];
  if (!items.length && !occupiedSpans.length) return null;
  const estimates = (timed.length ? timed.map((trip) => entryById.get(trip.legId!)) : evidence.legs)
    .flatMap((entry) => entry?.estimate ? [entry.estimate] : []);
  if (!estimates.length) return null;
  const earliest = (values: string[]) => values.reduce((left, right) => Temporal.Instant.compare(Temporal.Instant.from(left), Temporal.Instant.from(right)) <= 0 ? left : right);
  return {
    localDate: input.localDate,
    observedAt: earliest(estimates.map((estimate) => estimate.observedAt)),
    expiresAt: earliest(estimates.map((estimate) => estimate.expiresAt)),
    items,
    conflictingOptionIds: (input.options ?? []).filter((option) => overlapsTravelSpans(option, occupiedSpans)).map((option) => option.id),
    occupiedSpans,
    attribution: estimates.find((estimate) => estimate.attribution)?.attribution ?? null,
    weather: evidence.weather ? { state: evidence.weather.state, attribution: evidence.weather.attribution } : null,
  };
}

/**
 * The trip home: the model's line once it is the next trip, such as "Head home now". Before that,
 * when the whole trip is known, when you are back. Without a return leg only its time is unknown.
 */
function returnItems(evidence: BriefTravelEvidence, trips: readonly DepartureTrip[],
  context: ReturnType<typeof departurePhraseContext>): BriefTravelGuidanceItem[] {
  if (!trips.length) return [];
  const next = trips[0]!;
  if (next.role === "return" && next.leaveAt) return [{ kind: "return", phrase: next.linePhrase, weather: null }];
  const home = trips.find((trip) => trip.role === "return");
  if (home && evidence.completeTrip && evidence.finalAvailabilityAt) {
    return [{ kind: "return", phrase: departureBriefBackPhrase(evidence.finalAvailabilityAt, context), weather: null }];
  }
  // Ticket 265: a trip home after a late arrival cannot be relied on, so only its time is unknown.
  if (home?.state === "time_unknown") return [{ kind: "return", phrase: home.linePhrase, weather: null }];
  const hasReturnLeg = evidence.legs.some((item) => item.leg.role === "return");
  return hasReturnLeg ? [] : [{ kind: "return", phrase: RETURN_TIME_UNKNOWN, weather: null }];
}

function weatherOf(trip: DepartureTrip, entries: ReadonlyMap<string, BriefTravelEvidence["legs"][number]>): BriefTravelWeather | null {
  const weather = trip.leaveAt && trip.legId ? entries.get(trip.legId)?.weather : null;
  return weather?.state === "margin"
    ? { marginMinutes: weather.marginSeconds / 60, conditions: weather.conditions, suggestion: weather.suggestion }
    : null;
}

/**
 * Ticket 265: a trip that would leave before the previous trip arrives may take anything from its
 * ready time until its arrival delayed by that shortfall, the same span as the model projection.
 */
function unreliableTravelSpans(evidence: BriefTravelEvidence): Readonly<{ startAt: string; endAt: string }>[] {
  const shortfalls = travelLegsAfterLateArrival(evidence.legs);
  return evidence.legs.flatMap((entry) => {
    const shortfall = shortfalls.get(entry.leg.id);
    if (shortfall === undefined || !entry.estimate) return [];
    const endAt = Temporal.Instant.from(entry.weather?.arrivalAt ?? entry.estimate.arrivalAt).add({ seconds: shortfall }).toString();
    return [{ startAt: entry.leg.readyAt, endAt }];
  });
}
