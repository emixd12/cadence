import type { TravelMode, TravelTimingModelProjection } from "./travel";

/**
 * Ticket 219: travel facts in the Daily Brief context. Everything here may reach
 * model input after `projectBriefingContext`, so it holds no route durations,
 * leave-by, departure or arrival times, addresses, coordinates, place IDs or
 * provider responses (`docs/LEGAL.md` L-001).
 */
export const ADVISOR_TRAVEL_CONTEXT_VERSION = "1.0" as const;

/** Where a Behavior happens (Ticket 215). `not_set` means "location not set", never Anywhere. */
export const ADVISOR_BEHAVIOR_WHERE = ["not_set", "anywhere", "home", "place"] as const;
export type AdvisorBehaviorWhere = (typeof ADVISOR_BEHAVIOR_WHERE)[number];

export const ADVISOR_TRAVEL_ROUTE_UNAVAILABLE_REASONS = [
  "routing_off",
  /** No current route evidence was supplied with this context. */
  "not_supplied",
  /** The conclusions depend on Calendar events that the facts exclude. */
  "calendar_not_included",
  /** A trip goes to an occurrence or event that the facts exclude. */
  "scope_narrowed",
] as const;
export type AdvisorTravelRouteUnavailableReason = (typeof ADVISOR_TRAVEL_ROUTE_UNAVAILABLE_REASONS)[number];

export type AdvisorTravelRouteFacts =
  | Readonly<{ state: "available"; conclusions: TravelTimingModelProjection }>
  | Readonly<{ state: "unavailable"; reason: AdvisorTravelRouteUnavailableReason }>;

/**
 * Ticket 217 slot, filled in stage 2. Learned from what the user told Cadence.
 * Minutes are the user's own preparation time, never a route duration.
 */
export type AdvisorTravelHabits = Readonly<{
  getReadyMinutes: number | null;
  /** Usual mode for the place of each Behavior, keyed by Behavior, never by place text or ID. */
  placeModes: readonly Readonly<{ behaviorRef: string; mode: TravelMode }>[];
}>;

export const ADVISOR_WEATHER_CONDITIONS = ["precipitation", "snow", "extreme_heat"] as const;
export type AdvisorWeatherCondition = (typeof ADVISOR_WEATHER_CONDITIONS)[number];

/**
 * Ticket 218 slot, filled in stage 2. A margin is a fixed number of minutes for a
 * weather condition, never a share of trip time, so it reveals no route duration.
 */
export type AdvisorWeatherOutlook = Readonly<{
  source: "open_meteo";
  conditions: readonly Readonly<{
    /** The trip the condition affects, by destination ref; `null` for the day. */
    tripDestinationRef: string | null;
    condition: AdvisorWeatherCondition;
    marginMinutes: number;
    suggestedMode: TravelMode | null;
  }>[];
}>;

/** Ticket 216 slot, filled in stage 2. Counts of completion place labels in the retention window. */
export type AdvisorPlaceLabelCounts = Readonly<{
  behaviorRef: string;
  home: number;
  savedPlace: number;
  elsewhere: number;
}>;

export type AdvisorTravelContext = Readonly<{
  version: typeof ADVISOR_TRAVEL_CONTEXT_VERSION;
  /** The travel toggle with its routing consent. */
  routing: "on" | "off";
  /** Usual travel from Travel settings; `null` when routing is off or no mode is saved. */
  usualMode: TravelMode | null;
  behaviors: readonly Readonly<{ behaviorRef: string; where: AdvisorBehaviorWhere }>[];
  route: AdvisorTravelRouteFacts;
  habits?: AdvisorTravelHabits;
  weather?: AdvisorWeatherOutlook;
  placeLabels?: readonly AdvisorPlaceLabelCounts[];
}>;

/** The model sees the same shape, narrowed to the facts it receives. */
export type BriefingModelTravelFacts = AdvisorTravelContext;

/** Inspector state for the travel block. Present only when the context carries one. */
export type BriefingTravelControl = Readonly<{
  route: "available" | AdvisorTravelRouteUnavailableReason;
}>;
