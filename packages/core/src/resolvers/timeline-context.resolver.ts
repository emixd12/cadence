import type { ExternalEventSchedulingFact } from "../types/external-event";
import { Temporal } from "@js-temporal/polyfill";
import type { DepartureTrip } from "../types/departure";
import type { TravelEvidenceResult } from "../types/travel";
import { resolveTravelCollisions, travelUnreliableSegments } from "./travel.resolver";
import { RETURN_TIME_UNKNOWN, departureOverlapPhrase, departurePhraseContext } from "../services/departure-phrases";

import type {
  BehaviorDurationEstimate,
  BehaviorDurationHistoryOccurrence,
  ExternalEventFreshness,
  NormalizedExternalEvent,
  TimelineActivitySignal,
  TimelineOccurrenceContext,
} from "../types/day-progress";
import {
  formatRecordedDuration,
  resolveOccurrenceTimeTracking,
} from "./time-tracking.resolver";

export const DURATION_ESTIMATE_MIN_SAMPLES = 3;
export const DURATION_ESTIMATE_LOOKBACK_DAYS = 90;

export function resolveExternalEventFreshness(input: Readonly<{
  availability: "complete" | "incomplete" | "unavailable";
  refreshedAt: string | null;
  staleAfter: Temporal.Instant;
  now: Temporal.Instant;
}>): ExternalEventFreshness {
  const refreshedAt = input.refreshedAt
    ? parseInstant(input.refreshedAt, "External event refreshed_at")
    : null;

  if (refreshedAt && Temporal.Instant.compare(refreshedAt, input.now) > 0) {
    throw new Error("External event refreshed_at cannot be in the future.");
  }

  if (input.availability === "unavailable") {
    return {
      state: "unavailable",
      refreshedAt: refreshedAt?.toString() ?? null,
      label: "Calendar unavailable",
      canAssertNoOverlap: false,
    };
  }

  if (!refreshedAt) {
    throw new Error("Available external event data requires refreshed_at.");
  }

  if (input.availability === "incomplete") {
    return {
      state: "incomplete",
      refreshedAt: refreshedAt.toString(),
      label: "Calendar data incomplete",
      canAssertNoOverlap: false,
    };
  }

  const stale = Temporal.Instant.compare(input.now, input.staleAfter) >= 0;
  return stale
    ? {
        state: "stale",
        refreshedAt: refreshedAt.toString(),
        label: "Calendar data stale",
        canAssertNoOverlap: false,
      }
    : {
        state: "current",
        refreshedAt: refreshedAt.toString(),
        label: "Calendar current",
        canAssertNoOverlap: true,
      };
}

export function resolveBehaviorDurationEstimate(input: Readonly<{
  behaviorId: string;
  defaultDurationMinutes?: number | null;
  occurrences: BehaviorDurationHistoryOccurrence[];
  now: Temporal.Instant;
  timezone: string;
}>): BehaviorDurationEstimate {
  if (input.defaultDurationMinutes != null) {
    if (!Number.isInteger(input.defaultDurationMinutes) || input.defaultDurationMinutes < 1 || input.defaultDurationMinutes > 1440) {
      throw new Error("Default duration must be a whole number from 1 to 1,440 minutes.");
    }
    return { kind: "known", seconds: input.defaultDurationMinutes * 60,
      durationLabel: formatRecordedDuration(input.defaultDurationMinutes * 60),
      sampleCount: 0, lookbackDays: DURATION_ESTIMATE_LOOKBACK_DAYS, provenance: "behavior_default" };
  }
  const sources = resolveBehaviorDurationSources(input);
  return sources.historicalAverage;
}

export function resolveBehaviorDurationSources(input: Readonly<{
  behaviorId: string;
  defaultDurationMinutes?: number | null;
  occurrences: BehaviorDurationHistoryOccurrence[];
  now: Temporal.Instant;
  timezone: string;
}>): Readonly<{
  configuredDefault: Extract<BehaviorDurationEstimate, { kind: "known" }> | null;
  historicalAverage: BehaviorDurationEstimate;
  recordedElapsedDurations: readonly Readonly<{ localDate: string; seconds: number }>[];
}> {
  let configuredDefault: Extract<BehaviorDurationEstimate, { kind: "known" }> | null = null;
  if (input.defaultDurationMinutes != null) {
    if (!Number.isInteger(input.defaultDurationMinutes) || input.defaultDurationMinutes < 1 || input.defaultDurationMinutes > 1440) {
      throw new Error("Default duration must be a whole number from 1 to 1,440 minutes.");
    }
    configuredDefault = { kind: "known", seconds: input.defaultDurationMinutes * 60,
      durationLabel: formatRecordedDuration(input.defaultDurationMinutes * 60),
      sampleCount: 0, lookbackDays: DURATION_ESTIMATE_LOOKBACK_DAYS, provenance: "behavior_default" };
  }
  const today = input.now.toZonedDateTimeISO(input.timezone).toPlainDate();
  const start = today.subtract({ days: DURATION_ESTIMATE_LOOKBACK_DAYS });
  const occurrenceIds = new Set<string>();
  const sessionIds = new Set<string>();
  const samples: Array<{ localDate: string; seconds: number }> = [];

  for (const occurrence of input.occurrences) {
    if (!occurrence.id || occurrenceIds.has(occurrence.id)) {
      throw new Error("Duration history occurrence ids must be non-empty and unique.");
    }
    occurrenceIds.add(occurrence.id);

    const localDate = parseDate(occurrence.localDate, "Duration history local date");
    for (const session of occurrence.sessions) {
      if (!session.id || sessionIds.has(session.id)) {
        throw new Error("Duration history session ids must be non-empty and unique.");
      }
      sessionIds.add(session.id);
      if (
        session.occurrenceId !== occurrence.id ||
        session.behaviorId !== occurrence.behaviorId
      ) {
        throw new Error("Duration history sessions must match their occurrence and behavior.");
      }
    }

    if (
      occurrence.behaviorId !== input.behaviorId ||
      occurrence.status !== "completed" ||
      Temporal.PlainDate.compare(localDate, start) < 0 ||
      Temporal.PlainDate.compare(localDate, today) >= 0 ||
      occurrence.sessions.some(
        (session) =>
          session.stoppedAt === null ||
          Temporal.Instant.compare(
            parseInstant(session.stoppedAt, "Duration history stopped_at"),
            input.now,
          ) > 0,
      )
    ) {
      continue;
    }

    const tracking = resolveOccurrenceTimeTracking([...occurrence.sessions]);
    if (tracking.recordedSeconds > 0) {
      samples.push({ localDate: occurrence.localDate, seconds: tracking.recordedSeconds });
    }
  }

  if (samples.length < DURATION_ESTIMATE_MIN_SAMPLES) {
    return {
      configuredDefault,
      historicalAverage: {
        kind: "unknown",
        reason: "insufficient_samples",
        sampleCount: samples.length,
        requiredSampleCount: DURATION_ESTIMATE_MIN_SAMPLES,
        lookbackDays: DURATION_ESTIMATE_LOOKBACK_DAYS,
      },
      recordedElapsedDurations: samples,
    };
  }

  const seconds = samples.reduce((total, sample) => total + sample.seconds, 0) / samples.length;
  return {
    configuredDefault,
    historicalAverage: {
      kind: "known",
      seconds,
      durationLabel: formatRecordedDuration(seconds),
      sampleCount: samples.length,
      lookbackDays: DURATION_ESTIMATE_LOOKBACK_DAYS,
      provenance: "completed_stopped_occurrence_mean",
    },
    recordedElapsedDurations: samples,
  };
}

export function resolveTimelineOccurrenceContext(input: Readonly<{
  occurrenceId: string;
  occurrenceStatus?: "unresolved" | "completed" | "not_completed";
  scheduledFor: string;
  runningStartedAt: string | null;
  estimate: BehaviorDurationEstimate;
  events: readonly (NormalizedExternalEvent | ExternalEventSchedulingFact)[];
  freshness: ExternalEventFreshness;
  travel?: Pick<TravelEvidenceResult, "segments" | "completeTrip"> & Partial<Pick<TravelEvidenceResult, "legs" | "unknownLegs">> | null;
  /**
   * Ticket 266: the departure model's remaining trips. When given, the trip home's state decides
   * whether "Return time unknown." applies, so the row agrees with the drawer and dialog.
   */
  departure?: Readonly<{ trips: readonly Pick<DepartureTrip, "role" | "state">[] }> | null;
  /** Ticket 261: titles by commitment ref, to name the trip a Behavior overlaps. */
  travelLabels?: ReadonlyMap<string, string>;
  /** The account timezone for the trip's times. Defaults to America/New_York. */
  timezone?: string;
  now: Temporal.Instant;
}>): TimelineOccurrenceContext {
  const scheduledFor = parseInstant(input.scheduledFor, "Occurrence scheduled_for");
  if (
    input.estimate.kind === "known" &&
    (!Number.isFinite(input.estimate.seconds) || input.estimate.seconds <= 0)
  ) {
    throw new Error("Known duration estimates must be positive and finite.");
  }
  const estimatedEnd = input.estimate.kind === "known"
    ? scheduledFor.add({ milliseconds: Math.round(input.estimate.seconds * 1000) })
    : null;
  const activitySignals: TimelineActivitySignal[] = [];

  if (Temporal.Instant.compare(input.now, scheduledFor) >= 0 && Temporal.Instant.compare(input.now, scheduledFor.add({ minutes: 1 })) < 0) {
    activitySignals.push("scheduled_now");
  }
  if (
    estimatedEnd &&
    Temporal.Instant.compare(input.now, scheduledFor) >= 0 &&
    Temporal.Instant.compare(input.now, estimatedEnd) < 0
  ) {
    activitySignals.push("estimated_window");
  }
  if (input.runningStartedAt) {
    const runningStartedAt = parseInstant(input.runningStartedAt, "Running started_at");
    if (Temporal.Instant.compare(runningStartedAt, input.now) > 0) {
      throw new Error("Running started_at cannot be in the future.");
    }
    activitySignals.push("tracking_now");
  }

  const eventIds = new Set<string>();
  const overlappingEventIds: string[] = [];
  let hasUncertainTimedEvent = false;
  for (const event of input.events) {
    if (!event.id || eventIds.has(event.id)) {
      throw new Error("External event ids must be non-empty and unique.");
    }
    eventIds.add(event.id);
    const interval = "interval" in event ? event.interval : event;
    if (interval.kind === "all_day" || event.state === "cancelled" || event.availability === "free" || event.currentUserResponse === "declined") continue;

    const eventStart = parseInstant(interval.startAt, "External event start");
    const eventEnd = parseInstant(interval.endAt, "External event end");
    if (Temporal.Instant.compare(eventEnd, eventStart) <= 0) {
      throw new Error("Timed external events must end after they start.");
    }
    if (interval.duration.kind === "unknown") {
      const beginsInsideKnownWindow = estimatedEnd &&
        Temporal.Instant.compare(eventStart, scheduledFor) >= 0 &&
        Temporal.Instant.compare(eventStart, estimatedEnd) < 0;
      const beginsAtUnknownWindow = !estimatedEnd &&
        Temporal.Instant.compare(eventStart, scheduledFor) === 0;
      if (beginsInsideKnownWindow || beginsAtUnknownWindow) {
        overlappingEventIds.push(event.id);
      } else if (
        Temporal.Instant.compare(eventStart, estimatedEnd ?? scheduledFor) < 0
      ) {
        hasUncertainTimedEvent = true;
      }
      continue;
    }
    const overlaps = estimatedEnd
      ? intervalsOverlap(scheduledFor, estimatedEnd, eventStart, eventEnd)
      : Temporal.Instant.compare(eventStart, scheduledFor) <= 0 &&
          Temporal.Instant.compare(scheduledFor, eventEnd) < 0;
    if (overlaps) overlappingEventIds.push(event.id);
  }
  // Ticket 268: a trip after a late arrival occupies its whole unreliable span, as in the Daily Brief.
  const travelSegments = input.travel ? [...input.travel.segments, ...(input.travel.legs ? travelUnreliableSegments({ legs: input.travel.legs }) : [])] : [];
  const travelCollision = input.travel && (input.occurrenceStatus === undefined || input.occurrenceStatus === "unresolved") ? resolveTravelCollisions(travelSegments, [{
    ref: input.occurrenceId, kind: "behavior", startAt: scheduledFor.toString(), endAt: estimatedEnd?.toString() ?? null,
  }])[0] : null;
  const travelSourceRefs = travelCollision ? travelSegments
    .filter((segment) => travelCollision.segmentIds.includes(segment.id))
    .flatMap((segment) => segment.sourceRefs) : [];
  for (const ref of travelSourceRefs) if (!overlappingEventIds.includes(ref)) overlappingEventIds.push(ref);
  overlappingEventIds.sort();

  const overlapAssessment = overlappingEventIds.length > 0
    ? "possible"
    : estimatedEnd && !hasUncertainTimedEvent && input.freshness.canAssertNoOverlap && (!input.travel || input.travel.completeTrip)
      ? "none"
      : "unknown";

  return {
    occurrenceId: input.occurrenceId,
    estimate: input.estimate,
    estimatedStart: scheduledFor.toString(),
    estimatedEnd: estimatedEnd?.toString() ?? null,
    activitySignals,
    overlappingEventIds,
    overlapAssessment,
    ...(travelCollision?.travelCreated ? { travelOverlapLegIds: [...new Set(travelSegments
      .filter((segment) => travelCollision.segmentIds.includes(segment.id) && segment.legId)
      .map((segment) => segment.legId!))].sort() } : {}),
    overlapLabel: travelCollision?.travelCreated ? travelOverlapLabel({ ...input, travel: { ...input.travel!, segments: travelSegments } }, travelCollision.segmentIds)
      : overlapAssessment === "unknown" && returnTimeUnknown(input.travel, input.departure) ? RETURN_TIME_UNKNOWN
      : overlapAssessment === "unknown" && hasUncertainTimedEvent
      ? `Event end unknown · ${input.freshness.label}`
      : overlapLabel(overlapAssessment, input.freshness, estimatedEnd !== null),
    freshness: input.freshness,
  };
}

/**
 * Ticket 266: "Return time unknown." only when the trip home has no time and none is coming. With
 * the departure model: its trip home cannot be timed (time unknown or needs a start), or trips
 * remain with no trip home at all. A waiting estimate, a known time or a finished day says nothing.
 * Without the model, a return leg that is not current or an unknown return leg.
 */
function returnTimeUnknown(
  travel: Readonly<{ completeTrip: boolean; legs?: TravelEvidenceResult["legs"]; unknownLegs?: TravelEvidenceResult["unknownLegs"] }> | null | undefined,
  departure: Readonly<{ trips: readonly Pick<DepartureTrip, "role" | "state">[] }> | null | undefined,
): boolean {
  if (!travel || travel.completeTrip) return false;
  if (departure) {
    const home = departure.trips.find((trip) => trip.role === "return");
    if (!home) return departure.trips.length > 0;
    return home.state === "time_unknown" || home.state === "needs_origin";
  }
  return (travel.legs ?? []).some((entry) => entry.leg.role === "return" && entry.state !== "current") ||
    (travel.unknownLegs ?? []).some((leg) => leg.role === "return");
}

/** Names the trip a Behavior overlaps and that trip's travel span, from the colliding segments. */
function travelOverlapLabel(
  input: Readonly<{ travel?: Pick<TravelEvidenceResult, "segments"> & Partial<Pick<TravelEvidenceResult, "legs">> | null;
    travelLabels?: ReadonlyMap<string, string>; timezone?: string; now: Temporal.Instant }>,
  segmentIds: readonly string[],
): string {
  const segments = input.travel?.segments ?? [];
  const legId = segments.find((segment) => segmentIds.includes(segment.id) && segment.kind !== "commitment" && segment.legId)?.legId ?? null;
  const entry = input.travel?.legs?.find((item) => item.leg.id === legId);
  const leg = entry?.leg;
  // A trip after a late arrival names its unreliable span, not its route times (Ticket 268).
  const unreliable = segments.find((segment) => segment.id === `unreliable:${legId}`);
  // The shown leave and arrival times, which include any weather margin.
  const travelled = unreliable ? [unreliable] : entry?.estimate
    ? [{ startAt: entry.weather?.departureAt ?? entry.estimate.departureAt, endAt: entry.weather?.arrivalAt ?? entry.estimate.arrivalAt }]
    : segments.filter((segment) => segment.legId === legId && segment.kind === "route");
  const span = travelled.length ? travelled : segments.filter((segment) => segmentIds.includes(segment.id));
  const startAt = span.map((segment) => Temporal.Instant.from(segment.startAt)).sort(Temporal.Instant.compare)[0]!;
  const endAt = span.map((segment) => Temporal.Instant.from(segment.endAt)).sort(Temporal.Instant.compare).at(-1)!;
  const destinationRef = leg?.destinationCommitmentRef ?? null;
  const timezone = input.timezone ?? "America/New_York";
  return departureOverlapPhrase({ home: leg?.role === "return",
    destinationLabel: destinationRef ? input.travelLabels?.get(destinationRef) ?? null : null,
    startAt: startAt.toString(), endAt: endAt.toString() }, departurePhraseContext(input.now.toString(), timezone));
}

function intervalsOverlap(
  leftStart: Temporal.Instant,
  leftEnd: Temporal.Instant,
  rightStart: Temporal.Instant,
  rightEnd: Temporal.Instant,
): boolean {
  return Temporal.Instant.compare(leftStart, rightEnd) < 0 &&
    Temporal.Instant.compare(rightStart, leftEnd) < 0;
}

function overlapLabel(
  assessment: TimelineOccurrenceContext["overlapAssessment"],
  freshness: ExternalEventFreshness,
  hasKnownDuration: boolean,
): string {
  if (assessment === "possible") {
    return freshness.state === "current"
      ? "Possible overlap"
      : `Possible overlap · ${freshness.label}`;
  }
  if (assessment === "none") return "No timed overlap";
  if (!hasKnownDuration) return "Duration unknown";
  return freshness.label;
}

function parseInstant(value: string, field: string): Temporal.Instant {
  try {
    return Temporal.Instant.from(value);
  } catch {
    throw new Error(`${field} is invalid.`);
  }
}

function parseDate(value: string, field: string): Temporal.PlainDate {
  try {
    return Temporal.PlainDate.from(value);
  } catch {
    throw new Error(`${field} is invalid.`);
  }
}
