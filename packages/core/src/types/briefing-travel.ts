import type { TravelLegRole, TravelMode, TravelTimingModelProjection } from "./travel";
import type { PlaceLabelRetention } from "./place-labels";
import type { WeatherConditionId, WeatherMarginTableVersion } from "./weather";

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
 * Ticket 217 habit facts, learned only from what the user told Cadence. Get-ready
 * minutes are the user's own preparation time, never a route duration.
 */
export type AdvisorTravelHabits = Readonly<{
  rulesVersion: "travel-habit-defaults@1";
  getReadyMinutes: number;
  /** `default` follows the rules version; `learned` is the user's own value. */
  getReadySource: "default" | "learned";
  /** Remembered mode for the place of each Behavior, keyed by Behavior, never by place text, key or ID. */
  placeModes: readonly Readonly<{ behaviorRef: string; mode: TravelMode }>[];
}>;

export const ADVISOR_WEATHER_STATES = [
  /** A forecast was read; each trip says clear, margin or unknown. */
  "applied",
  /** No usable device position, so no weather margin today. */
  "no_position",
  /** The forecast could not be read. */
  "unavailable",
  /** No travel evidence was supplied with this context. */
  "not_supplied",
  /** The trips depend on Calendar events that the facts exclude. */
  "calendar_not_included",
  /** A trip goes to an occurrence or event that the facts exclude. */
  "scope_narrowed",
] as const;
export type AdvisorWeatherState = (typeof ADVISOR_WEATHER_STATES)[number];

/** One trip's weather rule conclusion (Ticket 218, `weather-margin@1`). */
export type AdvisorWeatherTrip = Readonly<{
  /** Destination commitment ref; `null` for the trip back to Home, as in route trips. */
  destinationRef: string | null;
  role: TravelLegRole;
  mode: TravelMode;
  /** `unknown` stays unknown: it never means clear weather. */
  state: "clear" | "margin" | "unknown";
  conditions: readonly WeatherConditionId[];
  /** A fixed table value for the condition, never a share of the trip; 0 unless `margin`. */
  marginMinutes: number;
  suggestion: Readonly<{ instead: TravelMode; alternatives: readonly TravelMode[] }> | null;
}>;

/**
 * Ticket 218 weather outlook and rule conclusions. The departure period comes from
 * planned timing, so the facts reveal no route duration. The Open-Meteo credit is
 * shown in the UI whenever these facts reach the model.
 */
export type AdvisorWeatherOutlook = Readonly<{
  source: "open_meteo";
  tableVersion: WeatherMarginTableVersion;
  state: AdvisorWeatherState;
  /** Whether a Calendar event shaped the trips; they then need the Calendar source. */
  calendarEvents: boolean;
  trips: readonly AdvisorWeatherTrip[];
}>;

/**
 * Ticket 216 label counts for one Behavior in the suggestion window, for example
 * "logged at Home 9 of 10 times". Counts only: no place keys, positions or text.
 */
export type AdvisorPlaceLabelBehaviorCounts = Readonly<{
  behaviorRef: string;
  total: number;
  home: number;
  /** At the saved place named by the Behavior's own Where. */
  wherePlace: number;
  otherSavedPlace: number;
  elsewhere: number;
}>;

export type AdvisorPlaceLabelCounts = Readonly<{
  rulesVersion: "where-suggestion-rules@1";
  /** The rule set's fixed window ending today, in local days. */
  periodDays: number;
  behaviors: readonly AdvisorPlaceLabelBehaviorCounts[];
  /**
   * Every label kept under the user's retention choice (owner decision, October 23,
   * 2026): 90 days, 1 year, or until the user deletes them.
   */
  retained: Readonly<{
    retention: PlaceLabelRetention;
    behaviors: readonly AdvisorPlaceLabelBehaviorCounts[];
  }>;
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
  placeLabels?: AdvisorPlaceLabelCounts;
}>;

/** The model sees the same shape, narrowed to the facts it receives. */
export type BriefingModelTravelFacts = AdvisorTravelContext;

/** Inspector state for the travel block. Present only when the context carries one. */
export type BriefingTravelControl = Readonly<{
  route: "available" | AdvisorTravelRouteUnavailableReason;
}>;
