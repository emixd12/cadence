import type { Temporal } from "@js-temporal/polyfill";
import { CURRENT_WHERE_SUGGESTION_RULES, placeLabelRetentionCutoff, placeRefForWhere } from "../resolvers/place-label.resolver";
import {
  ADVISOR_TRAVEL_CONTEXT_VERSION,
  type AdvisorPlaceLabelCounts,
  type AdvisorTravelContext,
  type AdvisorTravelHabits,
  type AdvisorTravelRouteFacts,
  type AdvisorWeatherOutlook,
  type BriefingModelTravelFacts,
  type BriefingTravelControl,
} from "../types/briefing-travel";
import type { BehaviorWhereKind } from "../types/behavior";
import type { CompletionPlaceLabel, PlaceLabelRetention, PlaceLabelValue } from "../types/place-labels";
import type { TravelEvidenceResult, TravelHabits, TravelMode, TravelTimingModelProjection } from "../types/travel";
import { WEATHER_MARGIN_TABLE_VERSION } from "../types/weather";
import { rememberedTravelMode, resolveTravelHabits, TRAVEL_HABIT_RULES, travelHabitPlaceKey } from "./travel-habits";
import { projectWeatherOutlook } from "./weather-outlook";

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
  /** Stage 2 (Ticket 217): from `advisorTravelHabits`; sent only while routing is on. */
  habits?: AdvisorTravelHabits | null;
  /** Stage 2 (Ticket 218): from `advisorWeatherOutlook`; `not_supplied` while routing is on without one. */
  weather?: AdvisorWeatherOutlook | null;
  /** Stage 2 (Ticket 216): from `advisorPlaceLabelCounts`, only while labels are on. */
  placeLabels?: AdvisorPlaceLabelCounts | null;
}>): AdvisorTravelContext {
  const route: AdvisorTravelRouteFacts = !input.routing
    ? { state: "unavailable", reason: "routing_off" }
    : input.conclusions
      ? { state: "available", conclusions: input.conclusions }
      : { state: "unavailable", reason: "not_supplied" };
  const weather = input.weather ?? { source: "open_meteo", tableVersion: WEATHER_MARGIN_TABLE_VERSION, state: "not_supplied", calendarEvents: false, trips: [] };
  return {
    version: ADVISOR_TRAVEL_CONTEXT_VERSION,
    routing: input.routing ? "on" : "off",
    usualMode: input.routing ? input.usualMode : null,
    // Not set is "location not set", which the model must not read as Anywhere.
    behaviors: input.behaviors.map((behavior) => ({ behaviorRef: behavior.behaviorRef, where: behavior.whereKind ?? "not_set" })),
    route,
    // Habits and weather shape trips only, so they stay out while routing is off.
    ...(input.routing && input.habits ? { habits: input.habits } : {}),
    ...(input.routing ? { weather } : {}),
    ...(input.placeLabels?.retained.behaviors.length ? { placeLabels: input.placeLabels } : {}),
  };
}

/**
 * Ticket 217: get-ready time and the remembered mode for each Behavior's place.
 * The place key is the same Ticket 216 key the habits store; it never leaves this
 * function. Behaviors without a remembered mode follow usual travel.
 */
export function advisorTravelHabits(habits: TravelHabits | null | undefined, behaviors: readonly Readonly<{
  behaviorRef: string;
  whereKind: BehaviorWhereKind | null;
  /** A place's own text, used only to derive its key. */
  locationText: string | null;
}>[], homeText: string | null): AdvisorTravelHabits {
  const resolved = resolveTravelHabits(habits);
  const placeModes = behaviors.flatMap((behavior) => {
    const text = behavior.whereKind === "home" ? homeText : behavior.whereKind === "place" ? behavior.locationText : null;
    const mode = rememberedTravelMode(habits, travelHabitPlaceKey(text));
    return mode ? [{ behaviorRef: behavior.behaviorRef, mode }] : [];
  });
  return { rulesVersion: TRAVEL_HABIT_RULES.version, getReadyMinutes: resolved.preparationMinutes,
    getReadySource: resolved.preparationSource, placeModes };
}

/**
 * Ticket 218: the weather outlook and rule conclusions from the same evidence as the
 * route conclusions, so both pass the same model-projection gate. Return legs use
 * `null` like route trips. `ref` maps a commitment ref to the context's opaque ref.
 */
export function advisorWeatherOutlook(
  evidence: Pick<TravelEvidenceResult, "legs" | "weather" | "modelProjection">,
  ref: (commitmentRef: string) => string = (value) => value,
): AdvisorWeatherOutlook | null {
  const projection = projectWeatherOutlook(evidence);
  if (!projection || !evidence.modelProjection) return null;
  return {
    source: "open_meteo",
    tableVersion: projection.tableVersion,
    state: projection.state,
    calendarEvents: evidence.modelProjection.calendarEvents,
    trips: projection.commitments.map((trip) => ({
      destinationRef: trip.role === "return" ? null : ref(trip.commitmentRef),
      role: trip.role,
      mode: trip.mode,
      state: trip.state,
      conditions: [...trip.conditions],
      marginMinutes: trip.marginMinutes,
      suggestion: trip.suggestion ? { instead: trip.suggestion.instead, alternatives: [...trip.suggestion.alternatives] } : null,
    })),
  };
}

/**
 * Ticket 216: label counts per Behavior in the suggestion window and over everything
 * kept under the user's retention choice; nothing while labels are off.
 */
export function advisorPlaceLabelCounts(input: Readonly<{
  enabled: boolean;
  retention: PlaceLabelRetention;
  labels: readonly Pick<CompletionPlaceLabel, "behaviorId" | "label" | "localDate">[];
  behaviors: readonly Readonly<{ behaviorRef: string; id: string; whereKind: BehaviorWhereKind | null; locationText: string | null }>[];
  today: Temporal.PlainDate;
}>): AdvisorPlaceLabelCounts | null {
  if (!input.enabled) return null;
  const rules = CURRENT_WHERE_SUGGESTION_RULES;
  // A new rules version needs its own model-input review before it ships.
  if (rules.version !== "where-suggestion-rules@1") throw new Error("Unsupported Where suggestion rules for model input.");
  const today = input.today.toString();
  const periodStart = input.today.subtract({ days: rules.periodDays - 1 }).toString();
  const retainedStart = placeLabelRetentionCutoff(input.retention, input.today)?.toString() ?? null;
  const counts = (from: string | null) => input.behaviors.flatMap((behavior) => {
    const own = placeRefForWhere(behavior);
    const labels = input.labels.filter((label) => label.behaviorId === behavior.id && label.localDate <= today && (from === null || label.localDate >= from));
    const count = (predicate: (label: PlaceLabelValue) => boolean) => labels.filter((label) => predicate(label.label)).length;
    const saved = (label: PlaceLabelValue) => label !== "home" && label !== "elsewhere";
    return labels.length ? [{ behaviorRef: behavior.behaviorRef, total: labels.length, home: count((label) => label === "home"),
      wherePlace: count((label) => saved(label) && label === own), otherSavedPlace: count((label) => saved(label) && label !== own),
      elsewhere: count((label) => label === "elsewhere") }] : [];
  });
  return { rulesVersion: rules.version, periodDays: rules.periodDays, behaviors: counts(periodStart),
    retained: { retention: input.retention, behaviors: counts(retainedStart) } };
}

/**
 * Narrows the travel block to the facts the model receives. Route conclusions and
 * weather trips that depend on an excluded Calendar source or an excluded stop are
 * withheld whole, never partly: a partial set could misstate what fits.
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
  const weather = travel.weather;
  const weatherFacts = !weather ? null
    : weather.calendarEvents && !visible.calendarIncluded ? { ...weather, state: "calendar_not_included" as const, calendarEvents: false, trips: [] }
      : !weather.trips.every((trip) => destinationVisible(trip.destinationRef)) ? { ...weather, state: "scope_narrowed" as const, calendarEvents: false, trips: [] }
        : weather;
  const facts: BriefingModelTravelFacts = {
    version: travel.version,
    routing: travel.routing,
    usualMode: travel.usualMode,
    behaviors: travel.behaviors.filter((behavior) => visible.behaviorRefs.has(behavior.behaviorRef)),
    route,
    ...(travel.habits ? { habits: { ...travel.habits,
      placeModes: travel.habits.placeModes.filter((row) => visible.behaviorRefs.has(row.behaviorRef)),
    } } : {}),
    ...(weatherFacts ? { weather: weatherFacts } : {}),
    ...(travel.placeLabels ? { placeLabels: { ...travel.placeLabels,
      behaviors: travel.placeLabels.behaviors.filter((row) => visible.behaviorRefs.has(row.behaviorRef)),
      retained: { ...travel.placeLabels.retained,
        behaviors: travel.placeLabels.retained.behaviors.filter((row) => visible.behaviorRefs.has(row.behaviorRef)) },
    } } : {}),
  };
  return { facts, control: { route: route.state === "available" ? "available" : route.reason } };
}

/** Weather facts with at least one trip reached the model, so the brief shows the Open-Meteo credit. */
export function briefingUsesWeather(travel: BriefingModelTravelFacts | undefined): boolean {
  return travel?.weather?.state === "applied" && travel.weather.trips.length > 0;
}

/**
 * Apply the travel policy to final projected facts, never undisclosed context.
 * The planner stays travel-free: a fit describes the scheduled occurrence, not
 * proof that a proposed time avoids travel. Unknown or withheld conclusions may
 * inform a model-selected suggestion, but cannot justify adding an omitted move.
 */
export function briefingTravelOptionPolicy(travel: BriefingModelTravelFacts | undefined, occurrenceRef: string): Readonly<{
  offer: boolean;
  fallback: boolean;
}> {
  if (!travel || travel.routing === "off") return { offer: true, fallback: true };
  const conclusion = travel.route.state === "available"
    ? travel.route.conclusions.fits.find(({ ref }) => ref === occurrenceRef)?.conclusion
    : undefined;
  return { offer: conclusion !== "does_not_fit", fallback: conclusion === "fits" };
}
