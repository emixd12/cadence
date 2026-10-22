import {
  ADVISOR_TRAVEL_CONTEXT_VERSION,
  type AdvisorTravelContext,
  type AdvisorTravelRouteFacts,
  type BriefingModelTravelFacts,
  type BriefingTravelControl,
} from "../types/briefing-travel";
import type { BehaviorWhereKind } from "../types/behavior";
import type { TravelMode, TravelTimingModelProjection } from "../types/travel";

/**
 * Ticket 219. Builds the travel block of a Daily Brief context from stored
 * preferences and, when supplied, Cadence's own route conclusions. Place text,
 * Home text and route estimates are never inputs.
 */
export function buildAdvisorTravelContext(input: Readonly<{
  routing: boolean;
  usualMode: TravelMode | null;
  behaviors: readonly Readonly<{ behaviorRef: string; whereKind: BehaviorWhereKind | null }>[];
  /** Live route conclusions only. The private workbench supplies synthetic ones. */
  conclusions?: TravelTimingModelProjection | null;
}>): AdvisorTravelContext {
  const route: AdvisorTravelRouteFacts = !input.routing
    ? { state: "unavailable", reason: "routing_off" }
    : input.conclusions
      ? { state: "available", conclusions: input.conclusions }
      : { state: "unavailable", reason: "not_supplied" };
  return {
    version: ADVISOR_TRAVEL_CONTEXT_VERSION,
    routing: input.routing ? "on" : "off",
    usualMode: input.routing ? input.usualMode : null,
    // Not set is "location not set", which the model must not read as Anywhere.
    behaviors: input.behaviors.map((behavior) => ({ behaviorRef: behavior.behaviorRef, where: behavior.whereKind ?? "not_set" })),
    route,
  };
}

/**
 * Narrows the travel block to the facts the model receives. Route conclusions
 * that depend on an excluded Calendar source or an excluded stop are withheld
 * whole, never partly: a partial set could misstate what fits.
 */
export function projectBriefingTravelFacts(travel: AdvisorTravelContext, visible: Readonly<{
  /** Unresolved occurrence refs in the model facts. */
  occurrenceRefs: ReadonlySet<string>;
  /** Behaviors with an occurrence in the model facts. */
  behaviorRefs: ReadonlySet<string>;
  /** Calendar event refs in the model facts; empty when the Calendar is excluded. */
  eventRefs: ReadonlySet<string>;
  calendarIncluded: boolean;
}>): Readonly<{ facts: BriefingModelTravelFacts; control: BriefingTravelControl }> {
  const destinationVisible = (ref: string | null) => ref === null || visible.occurrenceRefs.has(ref) || visible.eventRefs.has(ref);
  let route: AdvisorTravelRouteFacts = travel.route;
  if (route.state === "available") {
    const conclusions = route.conclusions;
    const fits = conclusions.fits.filter((fit) => visible.occurrenceRefs.has(fit.ref));
    route = conclusions.calendarEvents && !visible.calendarIncluded
      ? { state: "unavailable", reason: "calendar_not_included" }
      : !conclusions.trips.every((trip) => destinationVisible(trip.destinationRef)) || !fits.every((fit) => destinationVisible(fit.trip?.destinationRef ?? null))
        ? { state: "unavailable", reason: "scope_narrowed" }
        : { state: "available", conclusions: { ...conclusions, fits } };
  }
  const facts: BriefingModelTravelFacts = {
    version: travel.version,
    routing: travel.routing,
    usualMode: travel.usualMode,
    behaviors: travel.behaviors.filter((behavior) => visible.behaviorRefs.has(behavior.behaviorRef)),
    route,
    ...(travel.habits ? { habits: {
      getReadyMinutes: travel.habits.getReadyMinutes,
      placeModes: travel.habits.placeModes.filter((row) => visible.behaviorRefs.has(row.behaviorRef)),
    } } : {}),
    ...(travel.weather ? { weather: {
      source: travel.weather.source,
      conditions: travel.weather.conditions.filter((row) => destinationVisible(row.tripDestinationRef)),
    } } : {}),
    ...(travel.placeLabels ? { placeLabels: travel.placeLabels.filter((row) => visible.behaviorRefs.has(row.behaviorRef)) } : {}),
  };
  return { facts, control: { route: route.state === "available" ? "available" : route.reason } };
}
