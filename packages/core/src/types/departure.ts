import type { TravelEvidenceResult, TravelLegRole, TravelMode } from "./travel";

/**
 * What to do about one trip. `last estimate` is not a state: `freshness` says whether a
 * shown time has expired, so a time-based state keeps its meaning after expiry.
 */
export type DepartureState =
  | "upcoming"
  | "soon"
  | "leave_now"
  | "late"
  | "head_home"
  | "appears_later"
  | "needs_place"
  | "needs_attendance"
  | "needs_origin"
  /** No time can be stated. `timeUnknownCause` says why. */
  | "time_unknown"
  | "no_route"
  | "trip_changed"
  | "estimate_expired"
  | "paused"
  | "none";

export type DepartureFreshness = "current" | "last_estimate";

export type DepartureTimeUnknownCause =
  | "home_missing"
  /** The trip would leave before the previous trip arrives, so its times cannot be relied on. */
  | "late_arrival"
  | "no_known_end"
  | "leg_limit";

/**
 * Why a trip reads `late`. `evidence`: the route says it arrives after its target; with
 * `freshness: "current"` this is the only case to treat as an alarm. `clock`: only the clock has
 * passed the leave time. The user may well have left, so never present this as a problem.
 */
export type DepartureLateBasis = "evidence" | "clock";

export type DepartureAction = "refresh";

export type DepartureStop = Readonly<{
  /** Commitment ref, as in the travel evidence. */
  ref: string;
  /** Display title. Stays on the device; nothing here reaches model input. */
  label: string;
  startAt: string;
  endAt: string | null;
}>;

export type DepartureModelInput = Readonly<{
  /** Evidence after `resolveTravelAfterDecisions`. Null when no evidence is available. */
  evidence: Pick<TravelEvidenceResult, "legs" | "unknownLegs"> | null;
  /** Today's commitments. Public evidence has no route request, so times come from here. */
  stops: readonly DepartureStop[];
  now: string;
  timezone: string;
  /** Used only to count an "appears later" time back from the arrival target. */
  arrivalBufferSeconds: number;
  preparationSeconds: number;
  /** When the used-up travel budget renews. Null when estimates are not paused. */
  pausedUntil: string | null;
}>;

export type DepartureTrip = Readonly<{
  /** Stable across device samples, unlike `legId`: role and commitment refs. */
  key: string;
  legId: string | null;
  role: TravelLegRole;
  originRef: string | null;
  destinationRef: string | null;
  mode: TravelMode | null;
  fromHome: boolean;
  state: Exclude<DepartureState, "none">;
  /** Set only when `state` is `late`. */
  lateBasis: DepartureLateBasis | null;
  freshness: DepartureFreshness | null;
  /** When the estimate was checked. Null without a shown time. */
  checkedAt: string | null;
  leaveAt: string | null;
  /**
   * Estimated arrival. The route's arrival for late evidence. Otherwise, once the leave time
   * has arrived, now plus the travel time: a rough figure that never keeps a trip open.
   */
  arriveAt: string | null;
  /** When get-ready time starts, for an outbound trip. Never before the leg can start. */
  getReadyAt: string | null;
  /** Whole minutes rounded up. Null once the leave time has arrived, or without a time. */
  minutesUntilLeave: number | null;
  /** For `appears_later`: when the estimate is due. Null if its stop is not in the input. */
  appearsAt: string | null;
  timeUnknownCause: DepartureTimeUnknownCause | null;
  /** For `needs_origin` and a `late_arrival` cause: the event that holds this trip up. */
  blockingRef: string | null;
  blockingLabel: string | null;
  action: DepartureAction | null;
  /** For a place that already names the event, such as the event's own drawer. */
  phrase: string;
  /** Names the event, for the next-departure line and reminders. */
  linePhrase: string;
}>;

export type DepartureModel = Readonly<{
  /** The next trip's state, `paused` when only the pause can be said, or `none`. */
  state: DepartureState;
  next: DepartureTrip | null;
  /** The line to show. Null only for `none`. */
  phrase: string | null;
  /** Upcoming trips in order. A trip that has passed is left out. */
  trips: readonly DepartureTrip[];
  /** Set while paused, including when known times are still shown. */
  resumesAt: string | null;
  pausedPhrase: string | null;
}>;
