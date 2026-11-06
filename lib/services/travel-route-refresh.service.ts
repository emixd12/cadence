import { createHash } from "node:crypto";
import { behaviorEndAt as coreBehaviorEndAt } from "@cadence/core/services/departure-stops";
import { Temporal } from "@js-temporal/polyfill";

import { resolveTravelEvidence, resolveTravelPlan } from "@cadence/core/resolvers/travel.resolver";
import { resolveBehaviorDurationEstimate } from "@cadence/core/resolvers/timeline-context.resolver";
import { rememberedTravelMode, travelHabitBuffers, travelHabitPlaceKey } from "@cadence/core/services/travel-habits";
import {
  TRAVEL_ESTIMATE_LIFETIME_SECONDS,
  TRAVEL_LEG_OUTSIDE_WINDOW,
  TRAVEL_LEG_READY_AFTER_END,
  normalizeTravelPlaceText,
  partitionTravelLegsByWindow,
  travelPlaceLookupReusable,
  travelTripMatches,
  type TravelBudgetState,
} from "@cadence/core/services/travel-refresh-policy";
import type { BehaviorDurationHistoryOccurrence, BehaviorDurationEstimate } from "@cadence/core/types/day-progress";
import type { TravelCollisionCandidate, TravelCommitment, TravelEndpoint, TravelPoint } from "@cadence/core/types/travel";
import { TRAVEL_OWNER_MONTH_CEILING_MICRODOLLARS, readTravelMonthSpend, reserveTravelProviderSpend } from "@/lib/db/travelSpend.repo";
import { readTravelPlaceCache, writeTravelPlaceCache, type TravelPlaceCacheRow } from "@/lib/db/travelPlaceCache.repo";
import { listOccurrencesBetweenLocalDates } from "@/lib/db/occurrences.repo";
import { getProfileTimezone, listUserBehaviors } from "@/lib/db/behaviors.repo";
import { listTimeSessionHistory } from "@/lib/db/timeSessions.repo";
import { measurePerformanceSpan } from "@/lib/services/performance-timing";
import { projectTravelRouteDisplay, type TravelRoutesResponse } from "@/lib/services/travel-display.service";
import { TRAVEL_GEOCODE_MICRODOLLARS, assertTravelProviderReady, geocodeGoogleAddress, type TravelProviderConfig } from "@/lib/services/travel-provider";
import { TravelRoutingError, boundedMap, routeTravelLegs, type TravelSpendReservation } from "@/lib/services/travel-routing.service";
import { parseTravelRouteRefreshRequest, type TravelRouteRefreshRequest } from "@/lib/services/travel-route-request";
import { getCalendarConnection, getCalendarEvents, type CalendarReadCaller } from "@/lib/services/google-calendar.service";
import { readTravelRouteSource, type TravelRouteBehavior } from "@/lib/services/travel-settings.service";
import { readTravelWeather } from "@/lib/services/weather-forecast.service";
import { WEATHER_PROVIDER_OFF, type WeatherProviderConfig } from "@/lib/services/weather-provider";
import { advisorWeatherOutlook } from "@cadence/core/services/briefing-travel";
import type { TravelEvidenceResult } from "@cadence/core/types/travel";
import { issueTravelConclusionsToken, renameTravelConclusionRefs, travelConclusionsSourceKey, travelDurationHistoryRange, travelDurationRevision } from "@/lib/services/travel-conclusions-token";

const PLACE_LOOKUP_CONCURRENCY = 4;

type CommitmentDraft = Readonly<{ commitment: Omit<TravelCommitment, "endpoint">; placeText: string | null; endpointSource: TravelEndpoint["source"] }>;

/**
 * Ticket 214 refresh: reuse stored place lookups, fence the sources once before the
 * first paid call and once before returning, and route only legs in the window.
 * Ticket 213: every provider call reserves its list price first.
 * Ticket 218: weather comes from the device position only, through a shared hourly cache.
 * Ticket 219 Option A: with a signing secret, a one-day view also carries a signed token
 * of Cadence's own conclusions for the Daily Brief request to return.
 * Ticket 267: a request naming trips routes only those trips' legs. A leg that could leave
 * only after its destination ends is never routed. The response reports the month's budget.
 * Ticket 277: the leave reminder job calls this with its own caller, which has no Auth user.
 */
export async function refreshTravelRoutes(
  caller: CalendarReadCaller,
  raw: unknown,
  config: TravelProviderConfig,
  now = Temporal.Now.instant(),
  weatherConfig: WeatherProviderConfig = WEATHER_PROVIDER_OFF,
  conclusionsSecret: string | null = null,
): Promise<TravelRoutesResponse> {
  assertTravelProviderReady(config);
  const request = parseTravelRouteRefreshRequest(raw);
  const source = await readTravelRouteSource(caller.client, caller.user.id);
  if (!source.settings.enabled || !source.settings.mode || !source.settings.routingConsentAt) {
    throw new TravelRoutingError({ code: "context_changed", retryable: false, retryAfterSeconds: null });
  }
  const calendar = await getCalendarConnection(caller);
  const snapshot = calendar.status === "connected"
    ? await getCalendarEvents(caller, request.startLocalDate, request.endLocalDate)
    : null;
  const [behaviorOccurrences, behaviors, timezone] = await Promise.all([
    listOccurrencesBetweenLocalDates(caller.client, caller.user.id, request.startLocalDate, request.endLocalDate),
    listUserBehaviors(caller.client, caller.user.id),
    snapshot ? Promise.resolve(snapshot.requestedRange.timezone) : getProfileTimezone(caller.client, caller.user.id),
  ]);
  if (!timezone) throw new TravelRoutingError({ code: "context_changed", retryable: true, retryAfterSeconds: null });
  const historyRange = travelDurationHistoryRange(request.startLocalDate);
  const readDurationHistory = () => Promise.all([
    listOccurrencesBetweenLocalDates(caller.client, caller.user.id, historyRange.startLocalDate, historyRange.endLocalDate),
    listTimeSessionHistory(caller.client, { userId: caller.user.id, startLocalDate: historyRange.startLocalDate, endLocalDate: historyRange.endLocalDate, includeArchived: false, throughStartedAt: now.toString() }),
  ]);
  const [historyOccurrences, historySessions] = await readDurationHistory();
  const durationEstimates = behaviorDurationEstimates(historyOccurrences, historySessions, behaviors, now, timezone);
  const occurrenceRevisions = occurrenceRouteRevision(behaviorOccurrences);
  const durationRevision = travelDurationRevision(historyOccurrences, historySessions);
  const deadline = AbortSignal.timeout(45_000);
  const changed = () => new TravelRoutingError({ code: "context_changed", retryable: true, retryAfterSeconds: null });
  // Database inputs are fenced before spending and before delivery. Calendar has one initial read and one final check.
  const assertSourcesCurrent = async () => {
    if (deadline.aborted) throw changed();
    const [current, currentCalendar, currentOccurrences, [currentHistoryOccurrences, currentHistorySessions], currentTimezone] = await Promise.all([
      readTravelRouteSource(caller.client, caller.user.id),
      getCalendarConnection(caller),
      listOccurrencesBetweenLocalDates(caller.client, caller.user.id, request.startLocalDate, request.endLocalDate),
      readDurationHistory(),
      getProfileTimezone(caller.client, caller.user.id),
    ]);
    if (current.settingsRevision !== source.settingsRevision || current.habitsRevision !== source.habitsRevision || current.settings.enabled !== source.settings.enabled ||
      current.settings.mode !== source.settings.mode || current.settings.routingConsentAt !== source.settings.routingConsentAt ||
      current.settings.baseLocationText !== source.settings.baseLocationText || JSON.stringify(current.settings.habits) !== JSON.stringify(source.settings.habits) ||
      currentTimezone !== timezone ||
      currentCalendar.status !== calendar.status || currentCalendar.generation !== calendar.generation || currentCalendar.selectionRevision !== calendar.selectionRevision ||
      !sameBehaviors(current.behaviors, source.behaviors) || !sameOccurrences(currentOccurrences, occurrenceRevisions) ||
      travelDurationRevision(currentHistoryOccurrences, currentHistorySessions) !== durationRevision) {
      throw changed();
    }
  };
  // Calendar event revisions are checked once more before returning.
  const assertAllCurrent = async () => {
    const currentEvents = snapshot ? await getCalendarEvents(caller, request.startLocalDate, request.endLocalDate) : null;
    if (snapshot && (!currentEvents || !sameCalendarRevisions(snapshot.events, currentEvents.events))) throw changed();
    await assertSourcesCurrent();
    if (deadline.aborted) throw changed();
  };
  let fenced = false;
  const beforeFirstProviderCall = async () => {
    if (fenced) return;
    fenced = true;
    await assertSourcesCurrent();
  };
  const reserve: TravelSpendReservation = async (microdollars) => {
    const decision = await reserveTravelProviderSpend(caller.client, microdollars);
    if (!decision.allowed) {
      throw new TravelRoutingError({ code: "quota_exceeded", retryable: true, retryAfterSeconds: decision.retryAfterSeconds || 1, resetsAt: decision.resetsAt });
    }
  };

  const remembered = correctedPlaceTexts(snapshot?.events ?? [], request);
  const restored = restoredPlaceKeys(snapshot?.events ?? [], request);
  const drafts = [
    ...calendarCommitmentDrafts(snapshot?.events ?? [], request, remembered, now),
    ...behaviorCommitmentDrafts(behaviorOccurrences, source.behaviors, source.settings.baseLocationText, durationEstimates, timezone, now),
  ].sort((left, right) => compareInstants(left.commitment.startAt, right.commitment.startAt));
  // Keep one unrouteable boundary commitment when the bounded source window truncates.
  const bounded = drafts.length > 9
    ? [...drafts.slice(0, 8), { ...drafts[8]!, commitment: { ...drafts[8]!.commitment, attendance: "unknown" as const }, placeText: null }]
    : drafts;
  const baseText = bounded.length ? source.settings.baseLocationText : null;
  const places = await resolvePlaces(caller, [...bounded.map((draft) => draft.placeText), baseText], config, now, deadline, beforeFirstProviderCall, reserve, restored);
  await rememberCorrectedPlaces(caller, remembered, places, now);
  // Ticket 217: learned buffers and the remembered mode per place, falling back to usual travel.
  const habits = source.settings.habits;
  const buffers = travelHabitBuffers(habits);
  const commitments: TravelCommitment[] = bounded.map(({ commitment, placeText, endpointSource }) => {
    const point = placeText ? places.get(placeText) ?? null : null;
    const placeKey = travelHabitPlaceKey(placeText);
    return { ...commitment, placeKey, mode: rememberedTravelMode(habits, placeKey),
      endpoint: point ? { ref: commitment.ref, point, source: endpointSource, sourceRevision: commitment.revision, observedAt: now.toString() } : null } as TravelCommitment;
  });
  const basePoint = baseText ? places.get(baseText) ?? null : null;
  const base: TravelEndpoint | null = basePoint ? { ref: "base", point: basePoint, source: "saved_base", sourceRevision: source.settingsRevision, observedAt: now.toString() } : null;
  const behaviorOccupancy = behaviorOccupancyCandidates(behaviorOccurrences, source.behaviors, source.settings.baseLocationText, durationEstimates, timezone, now);
  const device = request.device ? endpointForDevice(request.device, source.settingsRevision) : null;
  const journeyRevision = revision(source.settingsRevision, source.habitsRevision, calendar.generation, calendar.selectionRevision, commitments, request.corrections);
  const plan = resolveTravelPlan({
    journeyRef: `${request.startLocalDate}:${request.endLocalDate}`,
    journeyRevision,
    grantRevision: source.settingsRevision,
    now: now.toString(),
    defaultMode: source.settings.mode,
    base,
    device,
    predictedOrigin: null,
    corrections: [],
    commitments,
    buffers,
  });
  // Weather never blocks routing; it runs beside the route calls and falls back to unavailable.
  const weatherRequest = plan.legs.length
    ? readTravelWeather({ device: request.device, config: weatherConfig, now }).catch(() => ({ state: "unavailable" as const }))
    : Promise.resolve(null);
  const trips = request.trips ?? null;
  const requested = (leg: (typeof plan.legs)[number]) => !!trips?.some((trip) => travelTripMatches(trip, leg));
  const { due: candidates, later } = trips
    ? { due: plan.legs.filter(requested), later: plan.legs.filter((leg) => !requested(leg)) }
    : request.scope === "day"
      ? { due: plan.legs, later: [] }
      : partitionTravelLegsByWindow(plan.legs, now);
  // The resolver would reject such a leg as unavailable after a paid call, two for transit.
  const commitmentEnds = new Map(plan.commitments.map((commitment) => [commitment.ref, commitment.endAt]));
  const readyAfterEnd = (leg: (typeof plan.legs)[number]) => {
    const endAt = commitmentEnds.get(leg.destinationCommitmentRef ?? "");
    return !!endAt && compareInstants(leg.readyAt, endAt) >= 0;
  };
  const due = candidates.filter((leg) => !readyAfterEnd(leg));
  const doomed = candidates.filter(readyAfterEnd);
  let routed: Awaited<ReturnType<typeof routeTravelLegs>> = [];
  if (due.length) {
    await beforeFirstProviderCall();
    routed = await measurePerformanceSpan({ span: "travel.route_legs", counts: { routed_legs: due.length, later_legs: later.length } },
      () => routeTravelLegs({ routes: due.map((leg) => ({ id: leg.id, request: leg.request })), provider: config, reserve, now, signal: deadline }));
  }
  const weather = await weatherRequest;
  await assertAllCurrent();
  const provenance = new Map(plan.legs.map((leg) => [leg.id, leg.provenance]));
  const results = [
    ...routed.map((result) => ({ legId: result.id, provenance: provenance.get(result.id)!, estimate: result.estimate, unavailableReason: result.failure?.code })),
    ...later.map((leg) => ({ legId: leg.id, provenance: leg.provenance, estimate: null, unavailableReason: TRAVEL_LEG_OUTSIDE_WINDOW })),
    ...doomed.map((leg) => ({ legId: leg.id, provenance: leg.provenance, estimate: null, unavailableReason: TRAVEL_LEG_READY_AFTER_END })),
  ];
  // A trip request leaves the other trips unrouted, so its conclusions would not describe the day.
  const signConclusions = !!conclusionsSecret && request.startLocalDate === request.endLocalDate && !trips;
  const evidence = resolveTravelEvidence({ plan, results, collisionCandidates: collisionCandidates(plan.commitments, behaviorOccupancy), buffers, weather, now: now.toString(), expectedJourneyRevision: journeyRevision, expectedGrantRevision: source.settingsRevision, modelProjection: signConclusions ? "enabled" : "disabled" });
  const conclusionsToken = (expiresAt: string) => signConclusions ? signedConclusions(evidence, {
    secret: conclusionsSecret!, userId: caller.user.id, localDate: request.startLocalDate, now, expiresAt,
    events: snapshot?.events ?? [], occurrenceIds: behaviorOccurrences.map((occurrence) => occurrence.id),
    sourceKey: travelConclusionsSourceKey({ settingsRevision: source.settingsRevision, habitsRevision: source.habitsRevision,
      enabled: source.settings.enabled, mode: source.settings.mode, routingConsentAt: source.settings.routingConsentAt,
      baseLocationText: source.settings.baseLocationText, habits: source.settings.habits ?? null,
      calendar: calendar, behaviors: source.behaviors, occurrences: behaviorOccurrences, timezone, durationRevision }),
  }) : null;
  const budget = await readTravelBudget(caller, timezone, now);
  return response(caller.user.id, source, conclusionsToken, budget, { ...projectTravelRouteDisplay(evidence),
    behaviorSources: behaviorOccurrences.filter(occurrence => afterNow(occurrence.scheduled_for, now) ||
      (!!behaviorDestination(source.behaviors.find((behavior) => behavior.id === occurrence.behavior_id), source.settings.baseLocationText) &&
        notEnded(behaviorEndAt(occurrence, durationEstimates.get(occurrence.behavior_id), timezone), now))).map(occurrence => {
      const duration = durationEstimates.get(occurrence.behavior_id);
      return { ref: occurrence.id, behaviorId: occurrence.behavior_id, unresolved: occurrence.status === "unresolved",
        ...(occurrence.schedule_kind === "exact" ? { durationSeconds: duration?.kind === "known" ? duration.seconds : null } : {}) };
    }),
  });
}

/**
 * Resolves typed locations to place IDs, reusing stored lookups. One reservation covers
 * every new lookup. Paid results are stored even when another lookup fails.
 */
async function resolvePlaces(
  caller: CalendarReadCaller,
  texts: readonly (string | null)[],
  config: TravelProviderConfig,
  now: Temporal.Instant,
  signal: AbortSignal,
  beforeFirstProviderCall: () => Promise<void>,
  reserve: TravelSpendReservation,
  lookUpAgain: ReadonlySet<string> = new Set(),
): Promise<ReadonlyMap<string, TravelPoint | null>> {
  const keyByText = new Map(texts.flatMap((text) => text ? [[text, placeTextKey(text)] as const] : []));
  if (!keyByText.size) return new Map();
  const stored = await readTravelPlaceCache(caller.client, caller.user.id, [...new Set(keyByText.values())]);
  // Ticket 281: a key in lookUpAgain is looked up again, and the result replaces its stored row.
  const reusable = new Map(stored.filter((row) => !lookUpAgain.has(row.textKey) && travelPlaceLookupReusable(row, now)).map((row) => [row.textKey, row]));
  // One lookup per distinct key, even when differently typed texts normalize alike.
  const missing = [...new Map([...keyByText].filter(([, key]) => !reusable.has(key)).map(([text, key]) => [key, text])).entries()];
  if (missing.length) {
    await beforeFirstProviderCall();
    await reserve(missing.length * TRAVEL_GEOCODE_MICRODOLLARS);
    const lookedUp = await measurePerformanceSpan({ span: "travel.place_lookups", counts: { place_lookups: missing.length, cached_places: reusable.size } },
      () => boundedMap(missing, PLACE_LOOKUP_CONCURRENCY, async ([key, text]) => {
        try { return { key, result: await geocodeGoogleAddress(text, { config, signal, maxRetries: 0 }), error: null }; }
        catch (error) { return { key, result: null, error }; }
      }));
    const rows: TravelPlaceCacheRow[] = lookedUp.flatMap(({ key, result }) => result ? [{
      textKey: key,
      outcome: result.kind,
      placeId: result.kind === "resolved" && result.point.kind === "place_id" ? result.point.placeId : null,
      lookedUpAt: now.toString(),
    } as TravelPlaceCacheRow] : []);
    // A failed cache write costs a repeat lookup later; it must not discard this refresh.
    await writeTravelPlaceCache(caller.client, caller.user.id, rows).catch(() => undefined);
    for (const row of rows) reusable.set(row.textKey, row);
    const failed = lookedUp.find((item) => item.error);
    if (failed) throw failed.error;
  }
  return new Map([...keyByText].map(([text, key]) => {
    const row = reusable.get(key);
    return [text, row?.outcome === "resolved" && row.placeId ? { kind: "place_id" as const, placeId: row.placeId } : null];
  }));
}

function placeTextKey(text: string): string {
  return createHash("sha256").update(normalizeTravelPlaceText(text)).digest("base64url");
}

/**
 * Ticket 281: each corrected event's own location key, mapped to the corrected text. Other
 * events with the same location use the correction too. Unlocated events have nothing to remember.
 */
function correctedPlaceTexts(events: Awaited<ReturnType<typeof getCalendarEvents>>["events"], request: TravelRouteRefreshRequest): ReadonlyMap<string, string> {
  return new Map(request.corrections.flatMap((correction) => {
    const location = events.find((event) => event.id === correction.eventId)?.location;
    if (!location || !normalizeTravelPlaceText(location)) return [];
    const key = placeTextKey(location);
    return key === placeTextKey(correction.locationText) ? [] : [[key, correction.locationText] as const];
  }));
}

/**
 * Ticket 281: the location keys of events corrected back to their own text. The user is undoing
 * a remembered place, so that text is looked up again and the result replaces the remembered row.
 * This costs one place lookup per refresh while the correction stays, until the Timeline closes.
 */
function restoredPlaceKeys(events: Awaited<ReturnType<typeof getCalendarEvents>>["events"], request: TravelRouteRefreshRequest): ReadonlySet<string> {
  return new Set(request.corrections.flatMap((correction) => {
    const location = events.find((event) => event.id === correction.eventId)?.location;
    if (!location || !normalizeTravelPlaceText(location)) return [];
    const key = placeTextKey(location);
    return key === placeTextKey(correction.locationText) ? [key] : [];
  }));
}

/**
 * Ticket 281: stores a corrected place's ID under the original text's key, so the text resolves
 * to it after a reload. Only the key and place ID are stored, never place or event text. Turning
 * travel off deletes the rows. A failed write only loses the memory, not this refresh.
 */
async function rememberCorrectedPlaces(
  caller: CalendarReadCaller,
  remembered: ReadonlyMap<string, string>,
  places: ReadonlyMap<string, TravelPoint | null>,
  now: Temporal.Instant,
): Promise<void> {
  const rows: TravelPlaceCacheRow[] = [...remembered].flatMap(([textKey, text]) => {
    const point = places.get(text);
    return point?.kind === "place_id" ? [{ textKey, outcome: "resolved" as const, placeId: point.placeId, lookedUpAt: now.toString() }] : [];
  });
  if (rows.length) await writeTravelPlaceCache(caller.client, caller.user.id, rows).catch(() => undefined);
}

function calendarCommitmentDrafts(
  events: Awaited<ReturnType<typeof getCalendarEvents>>["events"],
  request: TravelRouteRefreshRequest,
  remembered: ReadonlyMap<string, string>,
  now: Temporal.Instant,
): CommitmentDraft[] {
  const correctionById = new Map(request.corrections.map((correction) => [correction.eventId, correction]));
  const allTimed = events.filter((event) => event.kind === "timed");
  for (const correction of request.corrections) {
    const event = allTimed.find((candidate) => candidate.id === correction.eventId);
    if (!event || eventRevision(event) !== correction.revision) throw new TravelRoutingError({ code: "context_changed", retryable: true, retryAfterSeconds: null });
  }
  // Decision D12: an event with a place is in person; an event without one is not travel. It asks
  // nothing, gets no route and never blocks a later trip. It stays a normal Calendar event.
  // Ticket 281: an event whose location another event corrected uses that correction too.
  const placeOf = (event: (typeof allTimed)[number]): string | null => correctionById.get(event.id)?.locationText ??
    (event.location ? remembered.get(placeTextKey(event.location)) ?? event.location : null);
  // Ticket 264: an event under way stays the prior stop until its end.
  const prospective = allTimed
    .filter((event) => event.state !== "cancelled" && event.currentUserResponse !== "declined" && placeOf(event) !== null &&
      (afterNow(event.startAt, now) || notEnded(event.endUnspecified ? null : event.endAt, now)))
    .sort((left, right) => compareInstants(left.startAt, right.startAt));
  const timed = prospective.length > 9 ? prospective.slice(0, 9) : prospective;
  return timed.map((event, index) => {
    const overflow = prospective.length > 9 && index === 8;
    return {
      commitment: {
        ref: event.id,
        revision: eventRevision(event),
        kind: "calendar",
        startAt: event.startAt,
        endAt: event.endUnspecified ? null : event.endAt,
        attendance: overflow ? "unknown" : "physical",
        mode: null,
        excluded: event.state === "cancelled" || event.currentUserResponse === "declined",
      } as Omit<TravelCommitment, "endpoint">,
      placeText: overflow ? null : placeOf(event),
      endpointSource: correctionById.has(event.id) ? "correction" : "calendar",
    };
  });
}

/**
 * Ticket 215: A place routes to its text and Home routes to the saved Home.
 * Not set, Anywhere, and Home without a saved Home request no route.
 */
function behaviorDestination(behavior: TravelRouteBehavior | undefined, homeText: string | null): Readonly<{ text: string; source: TravelEndpoint["source"] }> | null {
  if (behavior?.whereKind === "place" && behavior.locationText) return { text: behavior.locationText, source: "behavior" };
  if (behavior?.whereKind === "home" && homeText) return { text: homeText, source: "saved_base" };
  return null;
}

function behaviorCommitmentDrafts(
  occurrences: Awaited<ReturnType<typeof listOccurrencesBetweenLocalDates>>,
  behaviors: readonly TravelRouteBehavior[],
  homeText: string | null,
  durations: ReadonlyMap<string, BehaviorDurationEstimate>,
  timezone: string,
  now: Temporal.Instant,
): CommitmentDraft[] {
  const behaviorById = new Map(behaviors.map((behavior) => [behavior.id, behavior]));
  const prospective = occurrences
    .filter((occurrence) => occurrence.status === "unresolved" && !!behaviorDestination(behaviorById.get(occurrence.behavior_id), homeText) &&
      (afterNow(occurrence.scheduled_for, now) || notEnded(behaviorEndAt(occurrence, durations.get(occurrence.behavior_id), timezone), now)))
    .sort((left, right) => compareInstants(left.scheduled_for, right.scheduled_for));
  const candidates = prospective.length > 9 ? prospective.slice(0, 9) : prospective;
  return candidates.flatMap((occurrence, index) => {
    const behavior = behaviorById.get(occurrence.behavior_id);
    const destination = behaviorDestination(behavior, homeText);
    if (!behavior || !destination) return [];
    const overflow = prospective.length > 9 && index === 8;
    return [{
      commitment: {
        ref: occurrence.id,
        revision: `${behavior.updatedAt}:${occurrence.updated_at}`,
        kind: "behavior",
        startAt: occurrence.scheduled_for,
        endAt: behaviorEndAt(occurrence, durations.get(occurrence.behavior_id), timezone),
        attendance: overflow ? "unknown" : "physical",
        mode: null,
        excluded: false,
      } as Omit<TravelCommitment, "endpoint">,
      placeText: overflow ? null : destination.text,
      endpointSource: destination.source,
    }];
  });
}

function behaviorOccupancyCandidates(
  occurrences: Awaited<ReturnType<typeof listOccurrencesBetweenLocalDates>>,
  behaviors: readonly TravelRouteBehavior[],
  homeText: string | null,
  durations: ReadonlyMap<string, BehaviorDurationEstimate>,
  timezone: string,
  now: Temporal.Instant,
): TravelCollisionCandidate[] {
  const sourceById = new Map(behaviors.map((behavior) => [behavior.id, behavior]));
  return occurrences
    .filter((occurrence) => occurrence.status === "unresolved" && afterNow(occurrence.scheduled_for, now))
    .flatMap((occurrence) => {
      const source = sourceById.get(occurrence.behavior_id);
      // Routed Behaviors already enter the travel plan. Not set, Anywhere and
      // Home without a saved Home still occupy time but never break the route chain.
      if (!source || behaviorDestination(source, homeText)) return [];
      const endAt = behaviorEndAt(occurrence, durations.get(occurrence.behavior_id), timezone);
      return endAt ? [{ ref: occurrence.id, kind: "behavior" as const, startAt: occurrence.scheduled_for, endAt }] : [];
    });
}

/** The core rule, from a database row. The Timeline uses the same one through `departureStops`. */
function behaviorEndAt(
  occurrence: Awaited<ReturnType<typeof listOccurrencesBetweenLocalDates>>[number],
  estimate: BehaviorDurationEstimate | undefined,
  timezone: string,
): string | null {
  return coreBehaviorEndAt({ localDate: occurrence.local_date, scheduledFor: occurrence.scheduled_for,
    scheduleKind: occurrence.schedule_kind, scheduleEndTime: occurrence.schedule_end_time }, estimate, timezone);
}

function endpointForDevice(device: NonNullable<TravelRouteRefreshRequest["device"]>, grantRevision: string): TravelEndpoint {
  return { ref: "device", point: { kind: "coordinates", latitude: device.latitude, longitude: device.longitude }, source: "device", sourceRevision: device.sampledAt, observedAt: device.sampledAt, accuracyMeters: device.accuracyMeters, grantRevision };
}

function eventRevision(event: { revision: { providerEtag: string | null; providerUpdatedAt: string | null }; id: string; startAt?: string; endAt?: string; location: string; conference: unknown; state: string }): string {
  if (event.revision.providerEtag || event.revision.providerUpdatedAt) return event.revision.providerEtag ?? event.revision.providerUpdatedAt!;
  return createHash("sha256").update(JSON.stringify([event.id, event.startAt ?? null, event.endAt ?? null, event.location, event.conference, event.state])).digest("base64url");
}

function revision(settingsRevision: string, habitsRevision: string | null, generation: number, selectionRevision: number, commitments: readonly TravelCommitment[], corrections: TravelRouteRefreshRequest["corrections"]): string {
  return createHash("sha256").update(JSON.stringify({ settingsRevision, habitsRevision, generation, selectionRevision, commitments: commitments.map(({ ref, revision: eventRevisionValue }) => [ref, eventRevisionValue]), corrections: corrections.map(({ eventId, revision: correctionRevision, locationText }) => [eventId, correctionRevision, locationText]) })).digest("base64url");
}

function sameBehaviors(left: readonly TravelRouteBehavior[], right: readonly TravelRouteBehavior[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function occurrenceRouteRevision(occurrences: Awaited<ReturnType<typeof listOccurrencesBetweenLocalDates>>): string {
  return JSON.stringify(occurrences.map(occurrence => [occurrence.id, occurrence.behavior_id, occurrence.scheduled_for,
    occurrence.local_date, occurrence.schedule_kind, occurrence.schedule_end_time, occurrence.status]));
}

function sameOccurrences(current: Awaited<ReturnType<typeof listOccurrencesBetweenLocalDates>>, expected: string): boolean {
  return occurrenceRouteRevision(current) === expected;
}

function sameCalendarRevisions(left: Awaited<ReturnType<typeof getCalendarEvents>>["events"], right: Awaited<ReturnType<typeof getCalendarEvents>>["events"]): boolean {
  const revisions = (events: typeof left) => events.map((event) => [event.id, eventRevision(event)]).sort((first, second) => first[0].localeCompare(second[0]));
  return JSON.stringify(revisions(left)) === JSON.stringify(revisions(right));
}

function behaviorDurationEstimates(
  occurrences: Awaited<ReturnType<typeof listOccurrencesBetweenLocalDates>>,
  sessions: Awaited<ReturnType<typeof listTimeSessionHistory>>,
  behaviors: Awaited<ReturnType<typeof listUserBehaviors>>,
  now: Temporal.Instant,
  timezone: string,
): ReadonlyMap<string, BehaviorDurationEstimate> {
  const sessionsByOccurrence = new Map<string, typeof sessions>();
  for (const session of sessions) {
    const entries = sessionsByOccurrence.get(session.occurrence_id) ?? [];
    entries.push(session);
    sessionsByOccurrence.set(session.occurrence_id, entries);
  }
  const history: BehaviorDurationHistoryOccurrence[] = occurrences.map((occurrence) => ({
    id: occurrence.id, behaviorId: occurrence.behavior_id, localDate: occurrence.local_date,
    status: occurrence.status as BehaviorDurationHistoryOccurrence["status"],
    sessions: (sessionsByOccurrence.get(occurrence.id) ?? []).map((session) => ({
      id: session.id, userId: session.user_id, occurrenceId: session.occurrence_id,
      behaviorId: session.behavior_id, startedAt: session.started_at, stoppedAt: session.stopped_at,
    })),
  }));
  return new Map(behaviors.map((behavior) => [behavior.id, resolveBehaviorDurationEstimate({
    behaviorId: behavior.id, defaultDurationMinutes: behavior.default_duration_minutes,
    occurrences: history, now, timezone,
  })]));
}

function afterNow(value: string, now: Temporal.Instant): boolean {
  try { return Temporal.Instant.compare(Temporal.Instant.from(value), now) > 0; }
  catch { return false; }
}

/** Ticket 264: only a known end shows a started commitment is under way. No end is invented. */
function notEnded(endAt: string | null, now: Temporal.Instant): boolean {
  return endAt !== null && afterNow(endAt, now);
}

function compareInstants(left: string, right: string): number {
  return Temporal.Instant.compare(Temporal.Instant.from(left), Temporal.Instant.from(right));
}

function collisionCandidates(commitments: readonly TravelCommitment[], occupancy: readonly TravelCollisionCandidate[]): TravelCollisionCandidate[] {
  const candidates = commitments
    .filter((commitment) => !commitment.excluded)
    .map((commitment) => ({
      ref: commitment.ref,
      kind: commitment.kind === "behavior" ? "behavior" as const : "commitment" as const,
      startAt: commitment.startAt,
      endAt: commitment.endAt,
    }));
  const refs = new Set(candidates.map((candidate) => candidate.ref));
  return [...candidates, ...occupancy.filter((candidate) => !refs.has(candidate.ref))];
}

/**
 * Ticket 267: the month's reserved spend after this request. The ceiling is enforced only by
 * `reserve_travel_provider_spend`; this readback never reserves. A failed read omits the field.
 */
async function readTravelBudget(caller: CalendarReadCaller, timezone: string, now: Temporal.Instant): Promise<TravelBudgetState | null> {
  try {
    const month = now.toZonedDateTimeISO(timezone).toPlainDate().with({ day: 1 });
    const reserved = await readTravelMonthSpend(caller.client, caller.user.id, month.toString());
    return { reservedMicrodollars: reserved, ceilingMicrodollars: TRAVEL_OWNER_MONTH_CEILING_MICRODOLLARS,
      resetsAt: month.add({ months: 1 }).toZonedDateTime({ timeZone: timezone }).toInstant().toString() };
  } catch {
    return null;
  }
}

function response(accountId: string, source: Awaited<ReturnType<typeof readTravelRouteSource>>, conclusionsToken: ((expiresAt: string) => string | null) | null,
  budget: TravelBudgetState | null, evidence: TravelRoutesResponse["evidence"]): TravelRoutesResponse {
  const expiresAt = evidence?.legs.reduce<string | null>((earliest, leg) => !leg.estimate ? earliest : !earliest || leg.estimate.expiresAt < earliest ? leg.estimate.expiresAt : earliest, null)
    ?? Temporal.Now.instant().add({ seconds: TRAVEL_ESTIMATE_LIFETIME_SECONDS }).toString();
  const token = conclusionsToken?.(expiresAt) ?? null;
  return { accountId, mode: source.settings.mode, navigationPreference: source.settings.navigationPreference, settingsRevision: source.settingsRevision,
    habitsRevision: source.habitsRevision, expiresAt, evidence, ...(token ? { conclusionsToken: token } : {}), ...(budget ? { budget } : {}) };
}

/**
 * Signs Cadence's conclusions for this view (Ticket 219 Option A). Commitments are named
 * by occurrence ID or Calendar event identity so the brief can map them to its own refs.
 * Any commitment it cannot name withholds the whole token.
 */
function signedConclusions(evidence: TravelEvidenceResult, input: Readonly<{
  secret: string; userId: string; localDate: string; now: Temporal.Instant; expiresAt: string; sourceKey: string;
  events: Awaited<ReturnType<typeof getCalendarEvents>>["events"]; occurrenceIds: readonly string[];
}>): string | null {
  const conclusions = evidence.modelProjection;
  if (!conclusions || Temporal.Instant.compare(Temporal.Instant.from(input.expiresAt), input.now) <= 0) return null;
  const occurrences = new Set(input.occurrenceIds);
  const events = new Map(input.events.map((event) => [event.id, event]));
  const named = new Map(input.events.map((event) => [`event:${event.calendarId}\0${event.providerEventId}`, JSON.stringify(event.revision)]));
  const rename = (ref: string) => {
    const event = events.get(ref);
    const key = occurrences.has(ref) ? `occurrence:${ref}` : event ? `event:${event.calendarId}\0${event.providerEventId}` : null;
    if (!key) throw new Error("Unnamed travel commitment.");
    return key;
  };
  try {
    const facts = renameTravelConclusionRefs({ conclusions, weather: advisorWeatherOutlook(evidence) }, rename);
    return issueTravelConclusionsToken({ sub: input.userId, date: input.localDate, src: input.sourceKey, iat: input.now.toString(),
      exp: input.expiresAt, conclusions: facts.conclusions, weather: facts.weather, events: Object.fromEntries(named) }, input.secret);
  } catch {
    return null;
  }
}
