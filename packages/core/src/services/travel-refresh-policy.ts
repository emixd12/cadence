import { Temporal } from "@js-temporal/polyfill";

import type { TravelEvidenceResult, TravelLegRole, TravelPlannedLeg, TravelResolvedLegEvidence } from "../types/travel";

/**
 * Ticket 214: a `timeline` scope request, which released clients still send, routes only legs
 * that fall due within this window. Ticket 267's refresh plan sends `day` and trip requests instead.
 */
export const TRAVEL_ROUTE_WINDOW_SECONDS = 3 * 60 * 60;
/** A route estimate expires this long after it was checked. The provider adapter caps its expiry here. */
export const TRAVEL_ESTIMATE_LIFETIME_SECONDS = 5 * 60;
/** Ticket 214: a device more than this far from the last sample used makes the current estimate out of date. */
export const TRAVEL_MOVEMENT_THRESHOLD_METERS = 500;
/** Google permits storing place IDs indefinitely; refresh them yearly so closed or moved places resolve again. */
export const TRAVEL_PLACE_RESOLVED_REUSE_SECONDS = 365 * 24 * 60 * 60;
/** Unresolved or ambiguous text is retried monthly rather than on every refresh. */
export const TRAVEL_PLACE_UNRESOLVED_REUSE_SECONDS = 30 * 24 * 60 * 60;
/** Unavailable reason for a leg left for a later refresh; it is never zero travel. */
export const TRAVEL_LEG_OUTSIDE_WINDOW = "outside_route_window";
/**
 * Ticket 267: unavailable reason for a leg that could leave only at or after its destination
 * ends. The server passes it to the resolver without a route call. The text is the resolver's own.
 */
export const TRAVEL_LEG_READY_AFTER_END = "Route is ready only after its destination ends.";
/**
 * Ticket 284 finding: times are shown to the minute, so a route is late only when its arrival
 * shows a later minute than its target. An arrival seconds past a 2:15 target reads 2:15, never late.
 */
export function travelArrivalAfterTarget(arrivalAt: string, targetAt: string): boolean {
  const minute = (at: string) => Math.floor(Temporal.Instant.from(at).epochMilliseconds / 60_000);
  return minute(arrivalAt) > minute(targetAt);
}
/** Ticket 267: a trip with a known leave time is refreshed once within this long of it... */
export const TRAVEL_TRIP_FIRST_REFRESH_SECONDS = 3 * 60 * 60;
/** ...and once more within this long of it. */
export const TRAVEL_TRIP_FINAL_REFRESH_SECONDS = 30 * 60;
/** Ticket 268: movement refreshes the next trip from the device at most this often. */
export const TRAVEL_MOVEMENT_REFRESH_FLOOR_SECONDS = 10 * 60;
/** Ticket 267: at this share of the monthly ceiling, automatic refreshes stop. Refresh travel continues. */
export const TRAVEL_BUDGET_AUTOMATIC_PAUSE_SHARE = 0.8;

export type TravelPlaceLookupOutcome = "resolved" | "unresolved" | "ambiguous";

/** Case, width and spacing differences in typed text must not cause another paid lookup. */
export function normalizeTravelPlaceText(text: string): string {
  return text.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Ticket 282: the first stop, in the order given, whose place is away from Home. A stop at
 * Home's text needs no trip, and a stop with blank text has no place. With no Home, the first
 * stop with a place. The hosted first-trip request routes this stop, and the Timeline keys
 * tomorrow's estimate on it, so both pick the same one.
 */
export function firstTravelStopAwayFromHome<Stop>(stops: readonly Stop[], placeText: (stop: Stop) => string | null | undefined,
  homeText: string | null): Stop | null {
  const home = homeText ? normalizeTravelPlaceText(homeText) : null;
  return stops.find((stop) => {
    const text = normalizeTravelPlaceText(placeText(stop) ?? "");
    return !!text && text !== home;
  }) ?? null;
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

/**
 * Splits planned legs into those to route now and those left for a later refresh, for a
 * `timeline` scope request. A leg is due once its estimate's appearance time has come.
 */
export function partitionTravelLegsByWindow<T extends Pick<TravelPlannedLeg, "id" | "role" | "readyAt" | "request">>(
  legs: readonly T[],
  now: Temporal.Instant,
  windowSeconds = TRAVEL_ROUTE_WINDOW_SECONDS,
): Readonly<{ due: T[]; later: T[] }> {
  const due: T[] = [];
  const later: T[] = [];
  for (const leg of legs) {
    const at = Temporal.Instant.from(legDueAnchor(leg)).subtract({ seconds: windowSeconds });
    (Temporal.Instant.compare(at, now) <= 0 ? due : later).push(leg);
  }
  return { due, later };
}

/**
 * A depart-at leg counts back from its departure and an arrive-by leg from its arrival target.
 * An onward leg also counts back from its ready time, the earliest it can leave, so a trip
 * longer than the window still gets its leave time before it is due (Ticket 267, C3).
 */
function legDueAnchor(leg: Pick<TravelPlannedLeg, "role" | "readyAt" | "request">): string {
  const at = leg.request.timing.at;
  if (leg.role !== "onward") return at;
  return Temporal.Instant.compare(Temporal.Instant.from(leg.readyAt), Temporal.Instant.from(at)) < 0 ? leg.readyAt : at;
}

/**
 * Ticket 265: when a leg with no estimate gets one. Ticket 267: this is both the `timeline`
 * scope window above and the refresh plan's fallback for a trip with no estimate, so
 * "Leave time appears by" stays true. Null when the destination's start is unknown.
 */
export function travelEstimateAppearsAt(input: Readonly<{
  role: TravelPlannedLeg["role"];
  readyAt: string;
  destinationStartAt: string | null;
  arrivalBufferSeconds: number;
}>, windowSeconds = TRAVEL_ROUTE_WINDOW_SECONDS): string | null {
  if (input.role === "return") return Temporal.Instant.from(input.readyAt).subtract({ seconds: windowSeconds }).toString();
  if (!input.destinationStartAt) return null;
  const arrivalTarget = Temporal.Instant.from(input.destinationStartAt).subtract({ seconds: Math.ceil(input.arrivalBufferSeconds) });
  return Temporal.Instant.from(legDueAnchor({ role: input.role, readyAt: input.readyAt,
    request: { timing: { kind: "arrive_by", at: arrivalTarget.toString() } } as TravelPlannedLeg["request"] }))
    .subtract({ seconds: windowSeconds }).toString();
}

/** Ticket 267: one trip, by role and commitment refs. Leg IDs change with each device sample. */
export type TravelTripRef = Readonly<{ role: TravelLegRole; originRef: string | null; destinationRef: string | null }>;

/** The trip's key, as the departure model names it. */
export function travelTripKey(trip: TravelTripRef): string {
  return `${trip.role}:${trip.originRef ?? ""}:${trip.destinationRef ?? ""}`;
}

/**
 * True when a planned leg is the requested trip: the trip to the same stop, or the trip home
 * from the same stop. An onward trip becomes an outbound one once its earlier stop has
 * passed, and is still the trip asked for.
 */
export function travelTripMatches(
  trip: TravelTripRef,
  leg: Readonly<{ role: TravelLegRole; originCommitmentRef: string | null; destinationCommitmentRef: string | null }>,
): boolean {
  if (trip.role === "return" || leg.role === "return") return trip.role === leg.role && trip.originRef === leg.originCommitmentRef;
  return trip.destinationRef !== null && trip.destinationRef === leg.destinationCommitmentRef;
}

/** Ticket 267: the month's reserved spend, as the route response reports it. */
export type TravelBudgetState = Readonly<{
  reservedMicrodollars: number;
  ceilingMicrodollars: number;
  /** The start of the next local month, when the budget renews. */
  resetsAt: string;
}>;

/** True from 80% of the ceiling until the budget renews. The ceiling itself stays in the database. */
export function travelBudgetPausesAutomatic(budget: TravelBudgetState | null | undefined, now: Temporal.Instant): boolean {
  if (!budget || budget.ceilingMicrodollars <= 0) return false;
  if (Temporal.Instant.compare(now, Temporal.Instant.from(budget.resetsAt)) >= 0) return false;
  return budget.reservedMicrodollars >= budget.ceilingMicrodollars * TRAVEL_BUDGET_AUTOMATIC_PAUSE_SHARE;
}

/** One trip as the refresh plan sees it. */
export type TravelRefreshTrip = TravelTripRef & Readonly<{
  key: string;
  /** The leave time from the last estimate, current or not. */
  leaveAt: string | null;
  /** When that estimate was checked. */
  checkedAt: string | null;
  /** For a trip with no estimate that a later request will route: when it falls due. */
  fallbackAt: string | null;
}>;

/**
 * Ticket 267: the trips a refresh plan watches, from the latest evidence the client keeps.
 * A trip with no estimate is watched only when it was left for later. A trip that failed
 * for another reason waits for Refresh travel or a whole-day trigger.
 */
export function travelRefreshTrips(input: Readonly<{
  legs: readonly Pick<TravelResolvedLegEvidence, "leg" | "estimate" | "reason" | "weather">[];
  stops: readonly Readonly<{ ref: string; startAt: string }>[];
  arrivalBufferSeconds: number;
}>): TravelRefreshTrip[] {
  const starts = new Map(input.stops.map((stop) => [stop.ref, stop.startAt]));
  return input.legs.flatMap(({ leg, estimate, reason, weather }): TravelRefreshTrip[] => {
    const ref: TravelTripRef = { role: leg.role, originRef: leg.originCommitmentRef, destinationRef: leg.destinationCommitmentRef };
    const key = travelTripKey(ref);
    if (estimate) return [{ ...ref, key, leaveAt: weather?.departureAt ?? estimate.departureAt, checkedAt: estimate.observedAt, fallbackAt: null }];
    if (reason !== TRAVEL_LEG_OUTSIDE_WINDOW) return [];
    const fallbackAt = travelEstimateAppearsAt({ role: leg.role, readyAt: leg.readyAt,
      destinationStartAt: starts.get(leg.destinationCommitmentRef ?? "") ?? null, arrivalBufferSeconds: input.arrivalBufferSeconds });
    return fallbackAt ? [{ ...ref, key, leaveAt: null, checkedAt: null, fallbackAt }] : [];
  });
}

/**
 * Ticket 268: the refresh plan's trips from a route response alone. Stop starts come from its
 * commitment segments and the arrival buffer from an arrival segment, so a client needs no
 * Calendar or Behavior detail to plan. A stop with no known end has no commitment segment, so
 * its trip, if it has no estimate, gets no fallback; Refresh travel and whole-day triggers still apply.
 */
export function travelRefreshTripsFromEvidence(evidence: Pick<TravelEvidenceResult, "legs" | "segments">): TravelRefreshTrip[] {
  const stops = evidence.segments.flatMap((segment) => segment.kind === "commitment" && segment.sourceRefs.length === 1
    ? [{ ref: segment.sourceRefs[0]!, startAt: segment.startAt }] : []);
  const arrival = evidence.segments.find((segment) => segment.kind === "arrival_buffer");
  const arrivalBufferSeconds = arrival
    ? Math.max(0, Temporal.Instant.from(arrival.endAt).since(Temporal.Instant.from(arrival.startAt)).total("seconds"))
    : 0;
  return travelRefreshTrips({ legs: evidence.legs, stops, arrivalBufferSeconds });
}

/** What the client remembers about its last requests. Display data stays out of it. */
export type TravelRefreshState = Readonly<{
  /** The local date of the last whole-day request. */
  localDate: string;
  /** The client's source key at that request; a different key is a source change. */
  sourceKey: string | null;
  /** The device sample that request used. */
  device: TravelDeviceSample | null;
  /** Trip key to the time a trip request for it was last sent, today. */
  tripAttempts: Readonly<Record<string, string>>;
  /**
   * Ticket 268: when a request last routed from a new device sample (a whole-day request or a
   * movement refresh). Movement waits 10 minutes from it.
   */
  deviceRoutedAt?: string;
}>;

export type TravelRefreshDayTrigger = "refresh_travel" | "first_open" | "source_changed" | "device_moved";
export type TravelRefreshTripTrigger = "trip_3h" | "trip_30m" | "no_estimate" | "device_moved";
export type TravelRefreshRequest =
  | Readonly<{ kind: "day"; trigger: TravelRefreshDayTrigger }>
  | Readonly<{ kind: "trip"; trigger: TravelRefreshTripTrigger; trips: readonly TravelTripRef[] }>;

export type TravelRefreshPlan = Readonly<{
  /** The request due now, or null. */
  request: TravelRefreshRequest | null;
  /** When the next automatic request falls due, if nothing else changes. Re-plan then. */
  nextDueAt: string | null;
  /** At 80% of the monthly ceiling until it renews. Only Refresh travel requests. */
  automaticPaused: boolean;
}>;

export type TravelRefreshPlanInput = Readonly<{
  now: string;
  timezone: string;
  /** The user chose Refresh travel. It always routes the whole day, whatever the budget state. */
  refreshTravel?: boolean;
  /** The Timeline is visible and its window focused. Only then do trip refreshes fall due. */
  timelineFocused: boolean;
  /** The client's key for the route sources (settings, Calendar, Behaviors, corrections). */
  sourceKey: string | null;
  device: TravelDeviceSample | null;
  trips: readonly TravelRefreshTrip[];
  budget: TravelBudgetState | null;
  last: TravelRefreshState | null;
}>;

/**
 * Ticket 267 (decision D1): which travel request is due now, if any, and when the next one
 * falls due. Pure; `now` is injected. In order:
 *
 * 1. Refresh travel routes the whole day.
 * 2. At 80% of the monthly ceiling nothing else requests.
 * 3. The first open of a local date routes the whole day, with or without the Daily Brief.
 * 4. A source change routes the whole day.
 * 5. While the Timeline is visible and focused, a trip with a known leave time is refreshed
 *    once within 3 hours of it and once within 30 minutes. A trip with no estimate is
 *    requested once its estimate's appearance time has come. Ticket 268: the device moving
 *    more than 500 m refreshes only the next trip that leaves from the device, the next
 *    outbound trip, no sooner than 10 minutes after the last request that routed from the device. All trips due now share one request.
 *
 * An open with a last estimate and none of these triggers requests nothing.
 */
export function resolveTravelRefreshPlan(input: TravelRefreshPlanInput): TravelRefreshPlan {
  const now = Temporal.Instant.from(input.now);
  const today = now.toZonedDateTimeISO(input.timezone).toPlainDate();
  const nextMidnight = today.add({ days: 1 }).toZonedDateTime({ timeZone: input.timezone }).toInstant();
  const automaticPaused = travelBudgetPausesAutomatic(input.budget, now);
  if (input.refreshTravel) return { request: { kind: "day", trigger: "refresh_travel" }, nextDueAt: null, automaticPaused };
  if (automaticPaused) return { request: null, nextDueAt: input.budget!.resetsAt, automaticPaused };

  const last = input.last;
  const day = (trigger: TravelRefreshDayTrigger): TravelRefreshPlan => ({ request: { kind: "day", trigger }, nextDueAt: null, automaticPaused });
  if (!last || last.localDate !== today.toString()) return day("first_open");
  if (input.sourceKey !== last.sourceKey) return day("source_changed");

  let next = nextMidnight;
  const later = (at: Temporal.Instant) => { if (Temporal.Instant.compare(at, next) < 0) next = at; };
  const due = new Map<string, Readonly<{ trip: TravelTripRef; trigger: TravelRefreshTripTrigger }>>();
  for (const trip of input.trips) {
    const attempt = last.tripAttempts[trip.key] ?? null;
    const touchedSince = (at: Temporal.Instant) => [trip.checkedAt, attempt].some((value) => !!value && Temporal.Instant.compare(Temporal.Instant.from(value), at) >= 0);
    if (trip.leaveAt) {
      const leaveAt = Temporal.Instant.from(trip.leaveAt);
      if (Temporal.Instant.compare(now, leaveAt) >= 0) continue;
      const first = leaveAt.subtract({ seconds: TRAVEL_TRIP_FIRST_REFRESH_SECONDS });
      const final = leaveAt.subtract({ seconds: TRAVEL_TRIP_FINAL_REFRESH_SECONDS });
      if (Temporal.Instant.compare(now, final) >= 0) { if (!touchedSince(final)) due.set(trip.key, { trip, trigger: "trip_30m" }); }
      else if (Temporal.Instant.compare(now, first) >= 0) { if (!touchedSince(first)) due.set(trip.key, { trip, trigger: "trip_3h" }); later(final); }
      else later(first);
    } else if (trip.fallbackAt) {
      const fallbackAt = Temporal.Instant.from(trip.fallbackAt);
      if (Temporal.Instant.compare(now, fallbackAt) < 0) later(fallbackAt);
      else if (!touchedSince(fallbackAt)) due.set(trip.key, { trip, trigger: "no_estimate" });
    }
  }
  // Only a trip that leaves from the device depends on where it is: the next outbound trip.
  if (travelDeviceMoved(last.device, input.device)) {
    const floorEnds = last.deviceRoutedAt ? Temporal.Instant.from(last.deviceRoutedAt).add({ seconds: TRAVEL_MOVEMENT_REFRESH_FLOOR_SECONDS }) : null;
    const nextOutbound = input.trips
      .filter((trip) => trip.role === "outbound" && (!trip.leaveAt || Temporal.Instant.compare(Temporal.Instant.from(trip.leaveAt), now) > 0))
      .sort((left, right) => Temporal.Instant.compare(Temporal.Instant.from(left.leaveAt ?? left.fallbackAt ?? input.now), Temporal.Instant.from(right.leaveAt ?? right.fallbackAt ?? input.now)))[0];
    if (floorEnds && Temporal.Instant.compare(now, floorEnds) < 0) later(floorEnds);
    else if (nextOutbound) due.set(nextOutbound.key, { trip: nextOutbound, trigger: "device_moved" });
  }
  if (!input.timelineFocused || !due.size) {
    // Unfocused, a due trip waits for focus; the plan is asked again then.
    return { request: null, nextDueAt: next.toString(), automaticPaused };
  }
  const triggers = [...due.values()].map((entry) => entry.trigger);
  const trigger = triggers.includes("device_moved") ? "device_moved" : triggers.includes("trip_30m") ? "trip_30m" : triggers.includes("trip_3h") ? "trip_3h" : "no_estimate";
  const trips = [...due.values()].map(({ trip }) => ({ role: trip.role, originRef: trip.originRef, destinationRef: trip.destinationRef }));
  return { request: { kind: "trip", trigger, trips }, nextDueAt: next.toString(), automaticPaused };
}

/**
 * The state to keep after sending a request. Record a whole-day request once it returns a
 * route response, so a failed one is tried again on the next open. Record a trip request
 * when it is sent, so a failing trip is not requested again before its next threshold.
 */
export function recordTravelRefresh(
  last: TravelRefreshState | null,
  request: TravelRefreshRequest,
  input: Pick<TravelRefreshPlanInput, "now" | "timezone" | "sourceKey" | "device">,
): TravelRefreshState {
  const today = Temporal.Instant.from(input.now).toZonedDateTimeISO(input.timezone).toPlainDate().toString();
  const attempts = last?.localDate === today ? last.tripAttempts : {};
  if (request.kind === "day") return { localDate: today, sourceKey: input.sourceKey, device: input.device, tripAttempts: attempts, deviceRoutedAt: input.now };
  const kept = last?.localDate === today ? last : { localDate: today, sourceKey: input.sourceKey, device: input.device, tripAttempts: {} };
  // Movement moves the baseline to the sample the request used and starts the 10-minute floor.
  const base = request.trigger === "device_moved" ? { ...kept, device: input.device, deviceRoutedAt: input.now } : kept;
  return { ...base, tripAttempts: { ...attempts, ...Object.fromEntries(request.trips.map((trip) => [travelTripKey(trip), input.now])) } };
}

/** The route request fields for a planned request. Both kinds use the whole-day scope. */
export function travelRefreshRequestFields(request: TravelRefreshRequest): Readonly<{ scope: "day"; trips?: readonly TravelTripRef[] }> {
  return request.kind === "trip" ? { scope: "day", trips: request.trips } : { scope: "day" };
}

/** Ticket 282: from this local hour, tomorrow's first trip is estimated even while today has trips left. */
export const TRAVEL_TOMORROW_FROM_HOUR = 17;

export type TravelTomorrowPlanInput = Readonly<{
  now: string;
  timezone: string;
  /** The date of the day view asking. After midnight that view no longer requests. */
  localDate: string;
  /** Today's trips from the kept day view. Null while no day view is known, so nothing is requested. */
  todayTrips: readonly TravelRefreshTrip[] | null;
  /** Identifies tomorrow's first located stop and its revision. Null when tomorrow has none. */
  stopKey: string | null;
  /**
   * The last request for tomorrow's first trip: its date and stop key. `retryAt` is set after a
   * first request failed for a reason worth one more try; the retry is due from then.
   */
  last: Readonly<{ localDate: string; stopKey: string; retryAt?: string | null }> | null;
  budget: TravelBudgetState | null;
}>;

export type TravelTomorrowPlan = Readonly<{
  /** Tomorrow's local date when a request is due now, otherwise null. */
  dueLocalDate: string | null;
  /** When to ask again if nothing else changes: 5 PM or the last leave time today. */
  nextDueAt: string | null;
}>;

/**
 * Ticket 282 (decision D4): whether to estimate tomorrow's first trip now. Pure; `now` is
 * injected. A request is due once per tomorrow's first stop and its revision, after 5 PM local
 * time or once today has no trips left. A failed request is tried once more at `retryAt`. It is a request of its own, so today's signed
 * conclusions never cover it. Automatic, so it stops at 80% of the monthly ceiling.
 */
export function resolveTravelTomorrowPlan(input: TravelTomorrowPlanInput): TravelTomorrowPlan {
  const none: TravelTomorrowPlan = { dueLocalDate: null, nextDueAt: null };
  const now = Temporal.Instant.from(input.now);
  const today = now.toZonedDateTimeISO(input.timezone).toPlainDate();
  if (today.toString() !== input.localDate || !input.stopKey || !input.todayTrips) return none;
  const tomorrow = today.add({ days: 1 }).toString();
  const retryAt = input.last?.localDate === tomorrow && input.last.stopKey === input.stopKey
    ? input.last.retryAt ? Temporal.Instant.from(input.last.retryAt) : null : undefined;
  // Asked already: once, plus one retry after a failure, under the 5-minute failure wait.
  if (retryAt === null) return none;
  if (travelBudgetPausesAutomatic(input.budget, now)) return none;
  if (retryAt && Temporal.Instant.compare(now, retryAt) < 0) return { dueLocalDate: null, nextDueAt: retryAt.toString() };
  if (retryAt) return { dueLocalDate: tomorrow, nextDueAt: null };
  const evening = today.toPlainDateTime({ hour: TRAVEL_TOMORROW_FROM_HOUR }).toZonedDateTime(input.timezone).toInstant();
  const ahead = (at: string) => Temporal.Instant.compare(Temporal.Instant.from(at), now) > 0;
  const tripsLeft = input.todayTrips.filter((trip) => !trip.leaveAt || ahead(trip.leaveAt));
  if (Temporal.Instant.compare(now, evening) >= 0 || !tripsLeft.length) return { dueLocalDate: tomorrow, nextDueAt: null };
  // With every remaining leave time known, the day can end before 5 PM.
  const lastLeave = tripsLeft.every((trip) => trip.leaveAt)
    ? tripsLeft.map((trip) => Temporal.Instant.from(trip.leaveAt!)).sort(Temporal.Instant.compare).at(-1)! : evening;
  return { dueLocalDate: null, nextDueAt: (Temporal.Instant.compare(lastLeave, evening) < 0 ? lastLeave : evening).toString() };
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
