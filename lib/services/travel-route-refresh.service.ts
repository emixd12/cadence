import { createHash } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";

import { resolveTravelEvidence, resolveTravelPlan } from "@cadence/core/resolvers/travel.resolver";
import { resolveBehaviorDurationEstimate } from "@cadence/core/resolvers/timeline-context.resolver";
import { rememberedTravelMode, travelHabitBuffers, travelHabitPlaceKey } from "@cadence/core/services/travel-habits";
import {
  TRAVEL_LEG_OUTSIDE_WINDOW,
  normalizeTravelPlaceText,
  partitionTravelLegsByWindow,
  travelPlaceLookupReusable,
} from "@cadence/core/services/travel-refresh-policy";
import type { BehaviorDurationHistoryOccurrence, BehaviorDurationEstimate } from "@cadence/core/types/day-progress";
import type { TravelCollisionCandidate, TravelCommitment, TravelEndpoint, TravelPoint } from "@cadence/core/types/travel";
import { reserveTravelProviderSpend } from "@/lib/db/travelSpend.repo";
import { readTravelPlaceCache, writeTravelPlaceCache, type TravelPlaceCacheRow } from "@/lib/db/travelPlaceCache.repo";
import { listOccurrencesBetweenLocalDates } from "@/lib/db/occurrences.repo";
import { getProfileTimezone, listUserBehaviors } from "@/lib/db/behaviors.repo";
import { listTimeSessionHistory } from "@/lib/db/timeSessions.repo";
import { measurePerformanceSpan } from "@/lib/services/performance-timing";
import { projectTravelRouteDisplay, type TravelRoutesResponse } from "@/lib/services/travel-display.service";
import { TRAVEL_GEOCODE_MICRODOLLARS, assertTravelProviderReady, geocodeGoogleAddress, type TravelProviderConfig } from "@/lib/services/travel-provider";
import { TravelRoutingError, boundedMap, routeTravelLegs, type TravelSpendReservation } from "@/lib/services/travel-routing.service";
import { parseTravelRouteRefreshRequest, type TravelRouteRefreshRequest } from "@/lib/services/travel-route-request";
import { getCalendarConnection, getCalendarEvents, type CalendarCaller } from "@/lib/services/google-calendar.service";
import { readTravelRouteSource, type TravelRouteBehavior } from "@/lib/services/travel-settings.service";

const PLACE_LOOKUP_CONCURRENCY = 4;

type CommitmentDraft = Readonly<{ commitment: Omit<TravelCommitment, "endpoint">; placeText: string | null; endpointSource: TravelEndpoint["source"] }>;

/**
 * Ticket 214 refresh: reuse stored place lookups, fence the sources once before the
 * first paid call and once before returning, and route only legs in the window.
 * Ticket 213: every provider call reserves its list price first.
 */
export async function refreshTravelRoutes(
  caller: CalendarCaller,
  raw: unknown,
  config: TravelProviderConfig,
  now = Temporal.Now.instant(),
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
  const historyRange = durationHistoryRange(request.startLocalDate);
  const readDurationHistory = () => Promise.all([
    listOccurrencesBetweenLocalDates(caller.client, caller.user.id, historyRange.startLocalDate, historyRange.endLocalDate),
    listTimeSessionHistory(caller.client, { userId: caller.user.id, startLocalDate: historyRange.startLocalDate, endLocalDate: historyRange.endLocalDate, includeArchived: false, throughStartedAt: now.toString() }),
  ]);
  const [historyOccurrences, historySessions] = await readDurationHistory();
  const durationEstimates = behaviorDurationEstimates(historyOccurrences, historySessions, behaviors, now, timezone);
  const occurrenceRevisions = occurrenceRouteRevision(behaviorOccurrences);
  const durationRevision = historyRevision(historyOccurrences, historySessions);
  const deadline = AbortSignal.timeout(45_000);
  const changed = () => new TravelRoutingError({ code: "context_changed", retryable: true, retryAfterSeconds: null });
  // Database inputs are fenced before spending and before delivery. Calendar has one initial read and one final check.
  const assertSourcesCurrent = async () => {
    if (deadline.aborted) throw changed();
    const [current, currentCalendar, currentOccurrences, [currentHistoryOccurrences, currentHistorySessions]] = await Promise.all([
      readTravelRouteSource(caller.client, caller.user.id),
      getCalendarConnection(caller),
      listOccurrencesBetweenLocalDates(caller.client, caller.user.id, request.startLocalDate, request.endLocalDate),
      readDurationHistory(),
    ]);
    if (current.settingsRevision !== source.settingsRevision || current.habitsRevision !== source.habitsRevision || current.settings.enabled !== source.settings.enabled ||
      current.settings.mode !== source.settings.mode || current.settings.routingConsentAt !== source.settings.routingConsentAt ||
      currentCalendar.status !== calendar.status || currentCalendar.generation !== calendar.generation || currentCalendar.selectionRevision !== calendar.selectionRevision ||
      !sameBehaviors(current.behaviors, source.behaviors) || !sameOccurrences(currentOccurrences, occurrenceRevisions) ||
      historyRevision(currentHistoryOccurrences, currentHistorySessions) !== durationRevision) {
      throw changed();
    }
  };
  // Calendar event revisions are checked once more before returning.
  const assertAllCurrent = async () => {
    await assertSourcesCurrent();
    const currentEvents = snapshot ? await getCalendarEvents(caller, request.startLocalDate, request.endLocalDate) : null;
    if (snapshot && (!currentEvents || !sameCalendarRevisions(snapshot.events, currentEvents.events))) throw changed();
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

  const drafts = [
    ...calendarCommitmentDrafts(snapshot?.events ?? [], request, now),
    ...behaviorCommitmentDrafts(behaviorOccurrences, source.behaviors, source.settings.baseLocationText, durationEstimates, timezone, now),
  ].sort((left, right) => compareInstants(left.commitment.startAt, right.commitment.startAt));
  // Keep one unrouteable boundary commitment when the bounded source window truncates.
  const bounded = drafts.length > 9
    ? [...drafts.slice(0, 8), { ...drafts[8]!, commitment: { ...drafts[8]!.commitment, attendance: "unknown" as const }, placeText: null }]
    : drafts;
  const baseText = bounded.length ? source.settings.baseLocationText : null;
  const places = await resolvePlaces(caller, [...bounded.map((draft) => draft.placeText), baseText], config, now, deadline, beforeFirstProviderCall, reserve);
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
  const { due, later } = request.scope === "day"
    ? { due: plan.legs, later: [] }
    : partitionTravelLegsByWindow(plan.legs, now);
  let routed: Awaited<ReturnType<typeof routeTravelLegs>> = [];
  if (due.length) {
    await beforeFirstProviderCall();
    routed = await measurePerformanceSpan({ span: "travel.route_legs", counts: { routed_legs: due.length, later_legs: later.length } },
      () => routeTravelLegs({ routes: due.map((leg) => ({ id: leg.id, request: leg.request })), provider: config, reserve, now, signal: deadline }));
  }
  await assertAllCurrent();
  const provenance = new Map(plan.legs.map((leg) => [leg.id, leg.provenance]));
  const results = [
    ...routed.map((result) => ({ legId: result.id, provenance: provenance.get(result.id)!, estimate: result.estimate, unavailableReason: result.failure?.code })),
    ...later.map((leg) => ({ legId: leg.id, provenance: leg.provenance, estimate: null, unavailableReason: TRAVEL_LEG_OUTSIDE_WINDOW })),
  ];
  const evidence = resolveTravelEvidence({ plan, results, collisionCandidates: collisionCandidates(plan.commitments, behaviorOccupancy), buffers, now: now.toString(), expectedJourneyRevision: journeyRevision, expectedGrantRevision: source.settingsRevision, modelProjection: "disabled" });
  return response(caller.user.id, source, { ...projectTravelRouteDisplay(evidence),
    behaviorSources: behaviorOccurrences.filter(occurrence => afterNow(occurrence.scheduled_for, now)).map(occurrence => {
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
  caller: CalendarCaller,
  texts: readonly (string | null)[],
  config: TravelProviderConfig,
  now: Temporal.Instant,
  signal: AbortSignal,
  beforeFirstProviderCall: () => Promise<void>,
  reserve: TravelSpendReservation,
): Promise<ReadonlyMap<string, TravelPoint | null>> {
  const keyByText = new Map(texts.flatMap((text) => text ? [[text, placeTextKey(text)] as const] : []));
  if (!keyByText.size) return new Map();
  const stored = await readTravelPlaceCache(caller.client, caller.user.id, [...new Set(keyByText.values())]);
  const reusable = new Map(stored.filter((row) => travelPlaceLookupReusable(row, now)).map((row) => [row.textKey, row]));
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

function calendarCommitmentDrafts(
  events: Awaited<ReturnType<typeof getCalendarEvents>>["events"],
  request: TravelRouteRefreshRequest,
  now: Temporal.Instant,
): CommitmentDraft[] {
  const correctionById = new Map(request.corrections.map((correction) => [correction.eventId, correction]));
  const allTimed = events.filter((event) => event.kind === "timed");
  for (const correction of request.corrections) {
    const event = allTimed.find((candidate) => candidate.id === correction.eventId);
    if (!event || eventRevision(event) !== correction.revision) throw new TravelRoutingError({ code: "context_changed", retryable: true, retryAfterSeconds: null });
  }
  const prospective = allTimed
    .filter((event) => event.state !== "cancelled" && event.currentUserResponse !== "declined" && afterNow(event.startAt, now) && correctionById.get(event.id)?.attendance !== "remote")
    .sort((left, right) => compareInstants(left.startAt, right.startAt));
  const timed = prospective.length > 9 ? prospective.slice(0, 9) : prospective;
  return timed.map((event, index) => {
    const correction = correctionById.get(event.id);
    const locationText = correction?.locationText ?? (event.location || null);
    const overflow = prospective.length > 9 && index === 8;
    const attendance = overflow ? "unknown" : correction?.attendance ?? (locationText ? (event.conference ? "hybrid" : "physical") : "unknown");
    return {
      commitment: {
        ref: event.id,
        revision: eventRevision(event),
        kind: "calendar",
        startAt: event.startAt,
        endAt: event.endUnspecified ? null : event.endAt,
        attendance,
        mode: null,
        excluded: event.state === "cancelled" || event.currentUserResponse === "declined",
      } as Omit<TravelCommitment, "endpoint">,
      placeText: attendance === "physical" ? locationText : null,
      endpointSource: correction ? "correction" : "calendar",
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
    .filter((occurrence) => occurrence.status === "unresolved" && afterNow(occurrence.scheduled_for, now) && !!behaviorDestination(behaviorById.get(occurrence.behavior_id), homeText))
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

function behaviorEndAt(
  occurrence: Awaited<ReturnType<typeof listOccurrencesBetweenLocalDates>>[number],
  estimate: BehaviorDurationEstimate | undefined,
  timezone: string,
): string | null {
  try {
    if (occurrence.schedule_kind === "range" && occurrence.schedule_end_time) {
      return Temporal.PlainDate.from(occurrence.local_date).toZonedDateTime({ timeZone: timezone, plainTime: Temporal.PlainTime.from(occurrence.schedule_end_time) }).toInstant().toString();
    }
    if (occurrence.schedule_kind === "exact" && estimate?.kind === "known") return Temporal.Instant.from(occurrence.scheduled_for).add({ seconds: estimate.seconds }).toString();
  } catch { return null; }
  return null;
}

function endpointForDevice(device: NonNullable<TravelRouteRefreshRequest["device"]>, grantRevision: string): TravelEndpoint {
  return { ref: "device", point: { kind: "coordinates", latitude: device.latitude, longitude: device.longitude }, source: "device", sourceRevision: device.sampledAt, observedAt: device.sampledAt, accuracyMeters: device.accuracyMeters, grantRevision };
}

function eventRevision(event: { revision: { providerEtag: string | null; providerUpdatedAt: string | null }; id: string; startAt?: string; endAt?: string; location: string; conference: unknown; state: string }): string {
  if (event.revision.providerEtag || event.revision.providerUpdatedAt) return event.revision.providerEtag ?? event.revision.providerUpdatedAt!;
  return createHash("sha256").update(JSON.stringify([event.id, event.startAt ?? null, event.endAt ?? null, event.location, event.conference, event.state])).digest("base64url");
}

function revision(settingsRevision: string, habitsRevision: string | null, generation: number, selectionRevision: number, commitments: readonly TravelCommitment[], corrections: TravelRouteRefreshRequest["corrections"]): string {
  return createHash("sha256").update(JSON.stringify({ settingsRevision, habitsRevision, generation, selectionRevision, commitments: commitments.map(({ ref, revision: eventRevisionValue }) => [ref, eventRevisionValue]), corrections: corrections.map(({ eventId, revision: correctionRevision, attendance, locationText }) => [eventId, correctionRevision, attendance, locationText]) })).digest("base64url");
}

function sameBehaviors(left: readonly TravelRouteBehavior[], right: readonly TravelRouteBehavior[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function occurrenceRouteRevision(occurrences: Awaited<ReturnType<typeof listOccurrencesBetweenLocalDates>>): string {
  return JSON.stringify(occurrences.map(occurrence => [occurrence.id, occurrence.behavior_id, occurrence.scheduled_for,
    occurrence.local_date, occurrence.schedule_kind, occurrence.schedule_end_time]));
}

function sameOccurrences(current: Awaited<ReturnType<typeof listOccurrencesBetweenLocalDates>>, expected: string): boolean {
  return occurrenceRouteRevision(current) === expected;
}

function sameCalendarRevisions(left: Awaited<ReturnType<typeof getCalendarEvents>>["events"], right: Awaited<ReturnType<typeof getCalendarEvents>>["events"]): boolean {
  const revisions = (events: typeof left) => events.map((event) => [event.id, eventRevision(event)]).sort((first, second) => first[0].localeCompare(second[0]));
  return JSON.stringify(revisions(left)) === JSON.stringify(revisions(right));
}

function durationHistoryRange(startLocalDate: string): { startLocalDate: string; endLocalDate: string } {
  const start = Temporal.PlainDate.from(startLocalDate);
  return { startLocalDate: start.subtract({ days: 90 }).toString(), endLocalDate: start.subtract({ days: 1 }).toString() };
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

function historyRevision(
  occurrences: Awaited<ReturnType<typeof listOccurrencesBetweenLocalDates>>,
  sessions: Awaited<ReturnType<typeof listTimeSessionHistory>>,
): string {
  return createHash("sha256").update(JSON.stringify({
    occurrences: occurrences.map((occurrence) => [occurrence.id, occurrence.updated_at]),
    sessions: sessions.map((session) => [session.id, session.started_at, session.stopped_at]),
  })).digest("base64url");
}

function afterNow(value: string, now: Temporal.Instant): boolean {
  try { return Temporal.Instant.compare(Temporal.Instant.from(value), now) > 0; }
  catch { return false; }
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

function response(accountId: string, source: Awaited<ReturnType<typeof readTravelRouteSource>>, evidence: TravelRoutesResponse["evidence"]): TravelRoutesResponse {
  const expiresAt = evidence?.legs.reduce<string | null>((earliest, leg) => !leg.estimate ? earliest : !earliest || leg.estimate.expiresAt < earliest ? leg.estimate.expiresAt : earliest, null)
    ?? Temporal.Now.instant().add({ seconds: 300 }).toString();
  return { accountId, mode: source.settings.mode, navigationPreference: source.settings.navigationPreference, settingsRevision: source.settingsRevision,
    habitsRevision: source.habitsRevision, expiresAt, evidence };
}
