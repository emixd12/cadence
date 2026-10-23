import { Temporal } from "@js-temporal/polyfill";

import type { BehaviorDurationEstimate } from "../types/day-progress";
import {
  ADVISOR_CALENDAR_SOURCES,
  ADVISOR_CONNECTOR_KINDS,
  ADVISOR_DAY_CONTEXT_ACTIVITY_LIMIT,
  ADVISOR_DAY_CONTEXT_LIMITS,
  ADVISOR_DAY_CONTEXT_VERSION,
  ADVISOR_DAY_CONTEXT_VERSION_1_1,
  type AdvisorActivityConnector,
  type AdvisorCalendarConnector,
  type AdvisorCalendarConnectorV1_1,
  type AdvisorDayContext,
  type AdvisorDayContextRequest,
  type AdvisorCadenceSource,
  type AdvisorDayContextV1,
  type AdvisorDayContextRequestV1,
  type AdvisorDuration,
  type AdvisorDurationCandidates,
  type AdvisorHistoricalCompletionTimes,
  type AdvisorOpaqueRef,
  type AdvisorOccurrence,
  type AdvisorSourceFailureCode,
} from "../types/advisor-day-context";
import {
  ADVISOR_BEHAVIOR_WHERE,
  ADVISOR_TRAVEL_CONTEXT_VERSION,
  ADVISOR_TRAVEL_ROUTE_UNAVAILABLE_REASONS,
  ADVISOR_WEATHER_STATES,
} from "../types/briefing-travel";
import type { OccurrenceStatus } from "../types/database";
import { TRAVEL_MODEL_PROJECTION_VERSION, type TravelLegRole, type TravelMode, type TravelModelFit } from "../types/travel";
import { WEATHER_MARGIN_TABLE_VERSION } from "../types/weather";
import { CURRENT_WHERE_SUGGESTION_RULES } from "../resolvers/place-label.resolver";
import { PLACE_LABEL_RETENTIONS } from "../types/place-labels";
import { WEATHER_MARGIN_TABLE } from "../resolvers/weather-margin.resolver";
import { TRAVEL_HABIT_RULES } from "./travel-habits";
import type {
  ExternalEventFailure,
  ExternalEventSnapshotV1,
  VersionedExternalEventSnapshot,
} from "../types/external-event";
import {
  EXTERNAL_EVENT_ADAPTER_VERSION,
  EXTERNAL_EVENT_SCHEMA_VERSION,
  EXTERNAL_EVENT_SOURCE_VERSIONS,
} from "../types/external-event";
import {
  HEVY_WORKOUTS_ADAPTER_VERSION,
  RECORDED_ACTIVITY_MAX_RANGE_DAYS,
  RECORDED_ACTIVITY_SCHEMA_VERSION,
  type RecordedActivityFailure,
  type RecordedActivitySnapshotV1,
} from "../types/recorded-activity";
import {
  validateExternalEventSnapshot,
  validateVersionedExternalEventSnapshot,
} from "./external-event-validation";
import { validateRecordedActivitySnapshot } from "./recorded-activity-validation";

type AdvisorCadenceOccurrenceInput = Readonly<{
  id: string;
  behaviorId: string;
  title: string;
  status: OccurrenceStatus;
  localDate: string;
  scheduledFor: string;
  scheduleKind: "exact" | "range";
  scheduleStartTime: string;
  scheduleEndTime: string | null;
  duration: BehaviorDurationEstimate | Readonly<{
    kind: "unknown";
    reason: "history_limit_exceeded";
    sampleCount: 0;
    requiredSampleCount: 3;
    lookbackDays: 90;
  }>;
  durationCandidates?: AdvisorDurationCandidates;
}>;

type AdvisorHistoryOccurrenceInput = Readonly<{
  id: string;
  behaviorId: string;
  localDate: string;
  status: OccurrenceStatus;
}>;

export class AdvisorDayContextValidationError extends Error {
  constructor(message: string, public readonly code?: "context_limit_exceeded") {
    super(message);
    this.name = "AdvisorDayContextValidationError";
  }
}

export function validateAdvisorDayContextRequest(value: unknown): AdvisorDayContextRequestV1 {
  const request = record(value, "request");
  exactKeys(request, ["version", "localDate", "connectors"], "request");
  if (request.version !== ADVISOR_DAY_CONTEXT_VERSION) fail("request.version is unsupported.");
  if (request.localDate !== null) plainDate(request.localDate, "request.localDate");
  const connectors = array(request.connectors, "request.connectors", 1);
  if (connectors.length === 1 && connectors[0] !== "google_calendar") fail("request.connectors is invalid.");
  return value as AdvisorDayContextRequestV1;
}

/** Accepts `1.0` (Google or no connectors) and `1.1` (unique known connector kinds). */
export function validateVersionedAdvisorDayContextRequest(value: unknown): AdvisorDayContextRequest {
  const request = record(value, "request");
  if (request.version === ADVISOR_DAY_CONTEXT_VERSION) return validateAdvisorDayContextRequest(value);
  exactKeys(request, ["version", "localDate", "connectors"], "request");
  if (request.version !== ADVISOR_DAY_CONTEXT_VERSION_1_1) fail("request.version is unsupported.");
  if (request.localDate !== null) plainDate(request.localDate, "request.localDate");
  const connectors = array(request.connectors, "request.connectors", ADVISOR_CONNECTOR_KINDS.length);
  if (connectors.some((kind) => !(ADVISOR_CONNECTOR_KINDS as readonly unknown[]).includes(kind))
    || new Set(connectors).size !== connectors.length) {
    fail("request.connectors is invalid.");
  }
  return value as AdvisorDayContextRequest;
}

export function projectAdvisorCadenceSource(input: Readonly<{
  observedAt: string;
  revision: string;
  historyStartLocalDate: string;
  historyEndLocalDateExclusive: string;
  historyDays: number;
  behaviors: readonly Readonly<{ id: string }>[];
  historyOccurrences: readonly AdvisorHistoryOccurrenceInput[];
  historyComplete: boolean;
  occurrences: readonly AdvisorCadenceOccurrenceInput[];
  recordedElapsedDurations?: readonly Readonly<{
    behaviorId: string;
    localDate: string;
    seconds: number;
  }>[];
  makeOpaqueRef: AdvisorOpaqueRef;
  historicalCompletionTimes?: AdvisorHistoricalCompletionTimes;
}>): AdvisorCadenceSource {
  instant(input.observedAt, "cadence.observedAt");
  nonempty(input.revision, "cadence.revision");
  const historyStart = plainDate(input.historyStartLocalDate, "cadence.history.startLocalDate");
  const historyEnd = plainDate(input.historyEndLocalDateExclusive, "cadence.history.endLocalDateExclusive");
  if (!Number.isInteger(input.historyDays) || input.historyDays < 1 || input.historyDays > 90 || !historyStart.add({ days: input.historyDays }).equals(historyEnd)) {
    throw new AdvisorDayContextValidationError("Cadence history must cover the declared 1 to 90 complete local days.");
  }
  if (input.behaviors.length > ADVISOR_DAY_CONTEXT_LIMITS.behaviors) {
    throw new AdvisorDayContextValidationError("Cadence Behavior limit exceeded.", "context_limit_exceeded");
  }
  if (input.occurrences.length > ADVISOR_DAY_CONTEXT_LIMITS.occurrences) {
    throw new AdvisorDayContextValidationError("Cadence occurrence limit exceeded.", "context_limit_exceeded");
  }

  const behaviorIds = new Set<string>();
  const historyCounts = new Map<string, { completedCount: number; notCompletedCount: number; unresolvedCount: number }>();
  for (const behavior of input.behaviors) {
    const behaviorId = nonempty(behavior.id, "behavior.id");
    if (behaviorIds.has(behaviorId)) throw new AdvisorDayContextValidationError("Cadence Behavior ids must be unique.");
    behaviorIds.add(behaviorId);
    historyCounts.set(behaviorId, { completedCount: 0, notCompletedCount: 0, unresolvedCount: 0 });
  }
  if (input.historyComplete) {
    const historyOccurrenceIds = new Set<string>();
    for (const occurrence of input.historyOccurrences) {
      const occurrenceId = nonempty(occurrence.id, "historyOccurrence.id");
      if (historyOccurrenceIds.has(occurrenceId)) throw new AdvisorDayContextValidationError("History occurrence ids must be unique.");
      historyOccurrenceIds.add(occurrenceId);
      const counts = historyCounts.get(nonempty(occurrence.behaviorId, "historyOccurrence.behaviorId"));
      if (!counts) throw new AdvisorDayContextValidationError("History occurrence has no selected Behavior.");
      const localDate = plainDate(occurrence.localDate, "historyOccurrence.localDate");
      if (Temporal.PlainDate.compare(localDate, historyStart) < 0 || Temporal.PlainDate.compare(localDate, historyEnd) >= 0) {
        throw new AdvisorDayContextValidationError("History occurrence falls outside the declared lookback.");
      }
      if (occurrence.status === "completed") counts.completedCount += 1;
      else if (occurrence.status === "not_completed") counts.notCompletedCount += 1;
      else if (occurrence.status === "unresolved") counts.unresolvedCount += 1;
      else fail("historyOccurrence.status is invalid.");
    }
  }

  const occurrenceIds = new Set<string>();
  const occurrences: AdvisorOccurrence[] = input.occurrences.map((occurrence) => {
    if (occurrenceIds.has(occurrence.id)) {
      throw new AdvisorDayContextValidationError("Cadence occurrence ids must be unique.");
    }
    occurrenceIds.add(nonempty(occurrence.id, "occurrence.id"));
    if (!behaviorIds.has(occurrence.behaviorId)) {
      throw new AdvisorDayContextValidationError("Cadence occurrence has no selected Behavior.");
    }
    plainDate(occurrence.localDate, "occurrence.localDate");
    instant(occurrence.scheduledFor, "occurrence.scheduledFor");
    time(occurrence.scheduleStartTime, "occurrence.schedule.startTime");
    if (occurrence.scheduleKind === "exact" && occurrence.scheduleEndTime !== null) {
      throw new AdvisorDayContextValidationError("Exact schedules cannot have an end time.");
    }
    if (occurrence.scheduleKind === "range") {
      time(occurrence.scheduleEndTime, "occurrence.schedule.endTime");
    }

    return {
      ref: input.makeOpaqueRef("occurrence", occurrence.id),
      behaviorRef: input.makeOpaqueRef("behavior", occurrence.behaviorId),
      title: occurrence.title,
      status: occurrence.status,
      localDate: occurrence.localDate,
      scheduledFor: occurrence.scheduledFor,
      schedule: {
        kind: occurrence.scheduleKind,
        startTime: occurrence.scheduleStartTime,
        endTime: occurrence.scheduleEndTime,
      },
      duration: projectDuration(occurrence.duration),
      ...(occurrence.durationCandidates ? { durationCandidates: occurrence.durationCandidates } : {}),
    };
  });

  return {
    observedAt: input.observedAt,
    revision: input.makeOpaqueRef("revision", input.revision),
    coverage: "complete",
    occurrences,
    history: {
      lookbackDays: input.historyDays,
      startLocalDate: input.historyStartLocalDate,
      endLocalDateExclusive: input.historyEndLocalDateExclusive,
      completeness: input.historyComplete ? "complete" : "unknown",
      reason: input.historyComplete ? null : "history_limit_exceeded",
      behaviors: input.behaviors.map((behavior) => {
        const counts = historyCounts.get(behavior.id);
        if (!counts) throw new AdvisorDayContextValidationError("Cadence Behavior history is unavailable.");
        return {
          behaviorRef: input.makeOpaqueRef("behavior", behavior.id),
          completedCount: input.historyComplete ? counts.completedCount : null,
          notCompletedCount: input.historyComplete ? counts.notCompletedCount : null,
          unresolvedCount: input.historyComplete ? counts.unresolvedCount : null,
        };
      }),
    },
    ...(input.historicalCompletionTimes ? { historicalCompletionTimes: input.historicalCompletionTimes } : {}),
    ...(input.recordedElapsedDurations ? {
      recordedElapsedDurations: input.recordedElapsedDurations.map((sample) => ({
        behaviorRef: input.makeOpaqueRef("behavior", sample.behaviorId),
        localDate: sample.localDate,
        seconds: sample.seconds,
      })),
    } : {}),
  };
}

export function projectAdvisorCalendarConnector(input: Readonly<{
  snapshot: ExternalEventSnapshotV1 | unknown;
  selectionRevision: number;
  now: Temporal.Instant;
  makeOpaqueRef: AdvisorOpaqueRef;
  failure?: ExternalEventFailure | null;
}>): AdvisorCalendarConnector {
  const snapshot = validateExternalEventSnapshot(input.snapshot);
  return projectCalendarConnector(snapshot, input) as AdvisorCalendarConnector;
}

/**
 * Any calendar source. Google output equals `projectAdvisorCalendarConnector`.
 * Outlook and iCloud refs are namespaced by source so equal provider IDs in
 * different sources never share a ref.
 */
export function projectVersionedAdvisorCalendarConnector(input: Readonly<{
  snapshot: VersionedExternalEventSnapshot | unknown;
  selectionRevision: number;
  now: Temporal.Instant;
  makeOpaqueRef: AdvisorOpaqueRef;
  failure?: ExternalEventFailure | null;
}>): AdvisorCalendarConnectorV1_1 {
  return projectCalendarConnector(validateVersionedExternalEventSnapshot(input.snapshot), input);
}

function projectCalendarConnector(snapshot: VersionedExternalEventSnapshot, input: Readonly<{
  selectionRevision: number;
  now: Temporal.Instant;
  makeOpaqueRef: AdvisorOpaqueRef;
  failure?: ExternalEventFailure | null;
}>): AdvisorCalendarConnectorV1_1 {
  const scoped = (value: string) => snapshot.source === "google_calendar" ? value : `${snapshot.source}\0${value}`;
  if (snapshot.requestedRange.selectedCalendarIds.length > ADVISOR_DAY_CONTEXT_LIMITS.calendars) {
    throw new AdvisorDayContextValidationError("Advisor Calendar limit exceeded.", "context_limit_exceeded");
  }
  if (snapshot.events.length > ADVISOR_DAY_CONTEXT_LIMITS.externalEvents) {
    throw new AdvisorDayContextValidationError("Advisor event limit exceeded.", "context_limit_exceeded");
  }

  const complete = snapshot.completeness === "complete" && snapshot.freshness.state === "current";
  const events = complete ? snapshot.events.map((event) => ({
    ref: input.makeOpaqueRef("event", scoped(`${event.calendarId}\0${event.providerEventId}`)),
    calendarRef: input.makeOpaqueRef("calendar", scoped(event.calendarId)),
    logicalInstanceRef: input.makeOpaqueRef("instance", scoped(`${event.calendarId}\0${event.logicalInstanceId}`)),
    revision: input.makeOpaqueRef("revision", scoped(JSON.stringify(event.revision))),
    interval: event.kind === "timed"
      ? { kind: "timed" as const, startAt: event.startAt, endAt: event.endAt, duration: event.duration }
      : { kind: "all_day" as const, startLocalDate: event.startLocalDate, endLocalDate: event.endLocalDate, duration: event.duration },
    sourceTimezone: event.sourceTimezone,
    sourceTimezoneFallback: event.sourceTimezoneFallback,
    state: event.state,
    availability: event.availability,
    currentUserResponse: event.currentUserResponse,
    recurrence: event.recurrence ? {
      seriesRef: input.makeOpaqueRef("series", scoped(`${event.calendarId}\0${event.recurrence.seriesId}`)),
      originalStart: event.recurrence.originalStart,
    } : null,
  })) : [];

  const failure = input.failure ?? snapshot.failures[0] ?? null;
  const state = snapshot.freshness.state === "current" && !complete
    ? "incomplete"
    : snapshot.freshness.state;
  const fetchedAt = snapshot.freshness.refreshedAt ?? snapshot.fetchedAt;
  if (fetchedAt) instant(fetchedAt, "connector.fetchedAt");
  if (complete && Temporal.Instant.compare(Temporal.Instant.from(fetchedAt), input.now) > 0) {
    throw new AdvisorDayContextValidationError("Calendar fetchedAt cannot be in the future.");
  }

  return {
    source: snapshot.source,
    state,
    complete,
    fetchedAt,
    connectionGeneration: snapshot.connectionGeneration,
    selectionRevision: input.selectionRevision,
    schemaVersion: snapshot.schemaVersion,
    adapterVersion: snapshot.adapterVersion,
    coverage: snapshot.coverage.map((coverage) => ({
      calendarRef: input.makeOpaqueRef("calendar", scoped(coverage.calendarId)),
      startLocalDate: coverage.startLocalDate,
      endLocalDate: coverage.endLocalDate,
      paginationComplete: coverage.paginationComplete,
    })),
    failure: failure ? {
      code: sourceFailureCode(failure.code),
      retryable: failure.retryable,
      retryAfterSeconds: failure.retryAfterSeconds,
    } : null,
    events,
  };
}

export function projectUnavailableAdvisorCalendar(input: Readonly<{
  connectionGeneration: number;
  selectionRevision: number;
  failure: Readonly<{
    code: AdvisorSourceFailureCode;
    retryable: boolean;
    retryAfterSeconds: number | null;
  }>;
}>): AdvisorCalendarConnector {
  return {
    source: "google_calendar",
    state: "unavailable",
    complete: false,
    fetchedAt: null,
    connectionGeneration: input.connectionGeneration,
    selectionRevision: input.selectionRevision,
    schemaVersion: EXTERNAL_EVENT_SCHEMA_VERSION,
    adapterVersion: EXTERNAL_EVENT_ADAPTER_VERSION,
    coverage: [],
    failure: input.failure,
    events: [],
  };
}

/** Unavailable Outlook or iCloud source state for `1.1`; it carries no events or coverage. */
export function projectUnavailableVersionedAdvisorCalendar(input: Readonly<{
  source: Exclude<AdvisorCalendarConnectorV1_1["source"], "google_calendar">;
  connectionGeneration: number;
  selectionRevision: number;
  failure: Readonly<{ code: AdvisorSourceFailureCode; retryable: boolean; retryAfterSeconds: number | null }>;
}>): AdvisorCalendarConnectorV1_1 {
  const versions = EXTERNAL_EVENT_SOURCE_VERSIONS[input.source];
  return {
    source: input.source,
    state: "unavailable",
    complete: false,
    fetchedAt: null,
    connectionGeneration: input.connectionGeneration,
    selectionRevision: input.selectionRevision,
    schemaVersion: versions.schemaVersion,
    adapterVersion: versions.adapterVersion,
    coverage: [],
    failure: input.failure,
    events: [],
  };
}

/** Unavailable Hevy source state. Missing activity never proves that no workout happened. */
export function projectUnavailableAdvisorActivity(input: Readonly<{
  connectionGeneration: number;
  failure: Readonly<{ code: AdvisorSourceFailureCode; retryable: boolean; retryAfterSeconds: number | null }>;
}>): AdvisorActivityConnector {
  return {
    source: "hevy",
    state: "unavailable",
    complete: false,
    fetchedAt: null,
    connectionGeneration: input.connectionGeneration,
    schemaVersion: RECORDED_ACTIVITY_SCHEMA_VERSION,
    adapterVersion: HEVY_WORKOUTS_ADAPTER_VERSION,
    coverage: null,
    failure: input.failure,
    activities: [],
  };
}

/**
 * Recorded workout timing only. Titles, provider IDs, and every discarded Hevy
 * field never reach this projection. Incomplete or stale reads expose no
 * activities. `now` is injected.
 */
export function projectAdvisorActivityConnector(input: Readonly<{
  snapshot: RecordedActivitySnapshotV1 | unknown;
  now: Temporal.Instant;
  makeOpaqueRef: AdvisorOpaqueRef;
  failure?: RecordedActivityFailure | null;
}>): AdvisorActivityConnector {
  const snapshot = validateRecordedActivitySnapshot(input.snapshot, { now: input.now });
  if (snapshot.activities.length > ADVISOR_DAY_CONTEXT_ACTIVITY_LIMIT) {
    throw new AdvisorDayContextValidationError("Advisor activity limit exceeded.", "context_limit_exceeded");
  }
  const fetchedAt = Temporal.Instant.from(snapshot.fetchedAt);
  const fresh = Temporal.Instant.compare(input.now, fetchedAt.add({ milliseconds: ADVISOR_DAY_CONTEXT_LIMITS.freshnessMs })) <= 0;
  const state = snapshot.completeness !== "complete" ? "incomplete" : fresh ? "current" : "stale";
  const complete = state === "current";
  const failure = input.failure ?? snapshot.failures[0] ?? null;
  return {
    source: "hevy",
    state,
    complete,
    fetchedAt: snapshot.fetchedAt,
    connectionGeneration: snapshot.connectionGeneration,
    schemaVersion: snapshot.schemaVersion,
    adapterVersion: snapshot.adapterVersion,
    coverage: {
      startLocalDate: snapshot.requestedRange.startLocalDate,
      endLocalDate: snapshot.requestedRange.endLocalDate,
      paginationComplete: snapshot.coverage.paginationComplete,
    },
    failure: failure ? {
      code: sourceFailureCode(failure.code),
      retryable: failure.retryable,
      retryAfterSeconds: failure.retryAfterSeconds,
    } : null,
    activities: complete ? snapshot.activities.map((activity) => ({
      ref: input.makeOpaqueRef("activity", activity.id),
      startAt: activity.startAt,
      endAt: activity.endAt,
      duration: activity.duration,
      localStartDate: activity.localStartDate,
      location: "unsupported" as const,
    })) : [],
  };
}

export function validateAdvisorDayContext(value: unknown): AdvisorDayContextV1 {
  return validateContext(value, "1.0_only") as AdvisorDayContextV1;
}

/** Accepts stored `1.0` (Google-only) and `1.1` (any known connector kind). */
export function validateVersionedAdvisorDayContext(value: unknown): AdvisorDayContext {
  return validateContext(value, "versioned");
}

function validateContext(value: unknown, mode: "1.0_only" | "versioned"): AdvisorDayContext {
  const root = record(value, "context");
  exactOptionalKeys(root, ["version", "snapshotId", "accountRef", "localDate", "timezone", "dayStartAt", "dayEndAt", "capturedAt", "expiresAt", "status", "authority", "grantGeneration", "cadence", "connectors"], ["travel"], "context");
  const version = root.version;
  if (version !== ADVISOR_DAY_CONTEXT_VERSION && (mode === "1.0_only" || version !== ADVISOR_DAY_CONTEXT_VERSION_1_1)) {
    fail("context.version is unsupported.");
  }
  nonempty(root.snapshotId, "context.snapshotId");
  nonempty(root.accountRef, "context.accountRef");
  plainDate(root.localDate, "context.localDate");
  timezone(root.timezone, "context.timezone");
  const dayStartAt = instant(root.dayStartAt, "context.dayStartAt");
  const dayEndAt = instant(root.dayEndAt, "context.dayEndAt");
  if (Temporal.Instant.compare(dayEndAt, dayStartAt) <= 0) fail("context.dayEndAt must follow dayStartAt.");
  const expectedDayStart = Temporal.PlainDate.from(root.localDate as string).toZonedDateTime({ timeZone: root.timezone as string, plainTime: "00:00" });
  const expectedDayEnd = expectedDayStart.add({ days: 1 });
  if (!dayStartAt.equals(expectedDayStart.toInstant()) || !dayEndAt.equals(expectedDayEnd.toInstant())) fail("context day bounds do not match localDate and timezone.");
  const capturedAt = instant(root.capturedAt, "context.capturedAt");
  const expiresAt = instant(root.expiresAt, "context.expiresAt");
  if (Temporal.Instant.compare(expiresAt, capturedAt) <= 0) fail("context.expiresAt must follow capturedAt.");
  if (Temporal.Instant.compare(expiresAt, capturedAt.add({ milliseconds: ADVISOR_DAY_CONTEXT_LIMITS.freshnessMs })) > 0 || Temporal.Instant.compare(expiresAt, dayEndAt) > 0) fail("context.expiresAt exceeds its freshness boundary.");
  if (root.status !== "complete" && root.status !== "partial") fail("context.status is invalid.");
  if (root.authority !== "read_only") fail("context.authority must be read_only.");
  integer(root.grantGeneration, "context.grantGeneration", 0);

  const cadence = record(root.cadence, "context.cadence");
  exactOptionalKeys(cadence, ["observedAt", "revision", "coverage", "occurrences", "history"], ["recordedElapsedDurations", "historicalCompletionTimes"], "context.cadence");
  const cadenceObservedAt = instant(cadence.observedAt, "context.cadence.observedAt");
  if (Temporal.Instant.compare(cadenceObservedAt, capturedAt) > 0 || Temporal.Instant.compare(expiresAt, cadenceObservedAt.add({ milliseconds: ADVISOR_DAY_CONTEXT_LIMITS.freshnessMs })) > 0) fail("Cadence observation bounds are invalid.");
  nonempty(cadence.revision, "context.cadence.revision");
  if (cadence.coverage !== "complete") fail("context.cadence.coverage is invalid.");
  const occurrences = array(cadence.occurrences, "context.cadence.occurrences", ADVISOR_DAY_CONTEXT_LIMITS.occurrences);
  const occurrenceRefs = new Set<string>();
  const behaviorRefs = new Set<string>();
  occurrences.forEach((occurrence, index) => {
    validateOccurrence(occurrence, index, root.localDate as string);
    const ref = record(occurrence, "occurrence").ref as string;
    if (occurrenceRefs.has(ref)) fail("Occurrence refs must be unique.");
    occurrenceRefs.add(ref);
    behaviorRefs.add(record(occurrence, "occurrence").behaviorRef as string);
  });
  if (behaviorRefs.size > ADVISOR_DAY_CONTEXT_LIMITS.behaviors) fail("Behavior ref limit exceeded.");
  const historyBehaviorRefs = validateCompletionHistory(cadence.history, root.localDate as string, behaviorRefs);
  if ("historicalCompletionTimes" in cadence) {
    validateHistoricalCompletionTimes(cadence.historicalCompletionTimes, cadence.history, root.timezone as string, historyBehaviorRefs);
  }
  if ("recordedElapsedDurations" in cadence) {
    const durationStart = Temporal.PlainDate.from(root.localDate as string).subtract({ days: 90 });
    array(cadence.recordedElapsedDurations, "context.cadence.recordedElapsedDurations", ADVISOR_DAY_CONTEXT_LIMITS.historyOccurrences).forEach((value, index) => {
      const sample = record(value, `recordedElapsedDuration[${index}]`);
      exactKeys(sample, ["behaviorRef", "localDate", "seconds"], `recordedElapsedDuration[${index}]`);
      const behaviorRef = nonempty(sample.behaviorRef, "recordedElapsedDuration.behaviorRef");
      if (!historyBehaviorRefs.has(behaviorRef)) fail("Recorded elapsed duration has no selected Behavior.");
      const sampleDate = plainDate(sample.localDate, "recordedElapsedDuration.localDate");
      if (Temporal.PlainDate.compare(sampleDate, durationStart) < 0 || Temporal.PlainDate.compare(sampleDate, root.localDate as string) >= 0) {
        fail("Recorded elapsed duration falls outside the 90-day source window.");
      }
      positive(sample.seconds, "recordedElapsedDuration.seconds");
    });
  }

  const eventRefs = new Set<string>();
  let connectors: unknown[];
  if (version === ADVISOR_DAY_CONTEXT_VERSION) {
    connectors = array(root.connectors, "context.connectors", 1);
    if (connectors.length !== 1) fail("context.connectors must contain the Google Calendar source state.");
    connectors.forEach((connector, index) => validateConnector(connector, index, root.localDate as string, capturedAt, expiresAt, ["google_calendar"], eventRefs));
  } else {
    connectors = array(root.connectors, "context.connectors", ADVISOR_CONNECTOR_KINDS.length);
    const sources = connectors.map((connector, index) => record(connector, `connector[${index}]`).source);
    if (connectors.length === 0 || new Set(sources).size !== sources.length) fail("context.connectors must list each source at most once.");
    connectors.forEach((connector, index) => {
      if (record(connector, `connector[${index}]`).source === "hevy") {
        validateActivityConnector(connector, index, root.localDate as string, root.timezone as string, capturedAt, expiresAt);
      } else {
        validateConnector(connector, index, root.localDate as string, capturedAt, expiresAt, ADVISOR_CALENDAR_SOURCES, eventRefs);
      }
    });
  }
  if (root.status === "complete" && connectors.some((connector) => {
    const row = record(connector, "connector");
    return row.state !== "not_requested" && row.complete !== true;
  })) {
    fail("Complete context cannot contain an incomplete connector.");
  }
  if ("travel" in root) validateTravel(root.travel, { occurrenceRefs, behaviorRefs: new Set([...behaviorRefs, ...historyBehaviorRefs]), eventRefs });
  return value as AdvisorDayContext;
}

const TRAVEL_MODES: readonly TravelMode[] = ["walking", "cycling", "transit", "driving"];
const TRAVEL_LEG_ROLES: readonly TravelLegRole[] = ["outbound", "onward", "return"];
const TRAVEL_FIT_BASES: readonly TravelModelFit["basis"][] = ["travel_known", "travel_overlap", "late_arrival", "travel_unknown", "duration_unknown"];

/**
 * Ticket 219. Every field may reach model input, so the shape is closed: enums,
 * refs already present in the context and bounded whole numbers in the later-stage
 * slots. No instant, duration or free text is accepted.
 */
function validateTravel(value: unknown, refs: Readonly<{ occurrenceRefs: Set<string>; behaviorRefs: Set<string>; eventRefs: Set<string> }>): void {
  const travel = record(value, "context.travel");
  exactOptionalKeys(travel, ["version", "routing", "usualMode", "behaviors", "route"], ["habits", "weather", "placeLabels"], "context.travel");
  if (travel.version !== ADVISOR_TRAVEL_CONTEXT_VERSION) fail("context.travel.version is unsupported.");
  if (travel.routing !== "on" && travel.routing !== "off") fail("context.travel.routing is invalid.");
  if (travel.usualMode !== null && !TRAVEL_MODES.includes(travel.usualMode as TravelMode)) fail("context.travel.usualMode is invalid.");
  if (travel.routing === "off" && travel.usualMode !== null) fail("context.travel.usualMode requires routing.");
  const behaviorRef = (item: unknown, label: string) => {
    const ref = nonempty(item, label);
    if (!refs.behaviorRefs.has(ref)) fail(`${label} has no Behavior in this context.`);
    return ref;
  };
  const destinationRef = (item: unknown, label: string) => {
    if (item === null) return;
    const ref = nonempty(item, label);
    if (!refs.occurrenceRefs.has(ref) && !refs.eventRefs.has(ref)) fail(`${label} has no occurrence or event in this context.`);
  };
  const unique = (items: string[], label: string) => { if (new Set(items).size !== items.length) fail(`${label} must be unique.`); };
  const mode = (item: unknown, label: string, nullable: boolean) => {
    if (!(nullable && item === null) && !TRAVEL_MODES.includes(item as TravelMode)) fail(`${label} is invalid.`);
  };
  const whole = (item: unknown, label: string, max: number) => {
    if (!Number.isInteger(item) || (item as number) < 0 || (item as number) > max) fail(`${label} is invalid.`);
  };

  unique(array(travel.behaviors, "context.travel.behaviors", ADVISOR_DAY_CONTEXT_LIMITS.behaviors).map((item, index) => {
    const row = record(item, `travel.behavior[${index}]`);
    exactKeys(row, ["behaviorRef", "where"], `travel.behavior[${index}]`);
    if (!(ADVISOR_BEHAVIOR_WHERE as readonly unknown[]).includes(row.where)) fail("travel.behavior.where is invalid.");
    return behaviorRef(row.behaviorRef, "travel.behavior.behaviorRef");
  }), "context.travel.behaviors");

  const route = record(travel.route, "context.travel.route");
  if (route.state === "unavailable") {
    exactKeys(route, ["state", "reason"], "context.travel.route");
    if (!(ADVISOR_TRAVEL_ROUTE_UNAVAILABLE_REASONS as readonly unknown[]).includes(route.reason)) fail("context.travel.route.reason is invalid.");
  } else if (route.state === "available") {
    if (travel.routing !== "on") fail("context.travel.route requires routing.");
    exactKeys(route, ["state", "conclusions"], "context.travel.route");
    const conclusions = record(route.conclusions, "travel.route.conclusions");
    exactKeys(conclusions, ["version", "travelDay", "calendarEvents", "trips", "fits"], "travel.route.conclusions");
    if (conclusions.version !== TRAVEL_MODEL_PROJECTION_VERSION) fail("travel.route.conclusions.version is unsupported.");
    if (conclusions.travelDay !== "yes" && conclusions.travelDay !== "no" && conclusions.travelDay !== "unknown") fail("travel.route.conclusions.travelDay is invalid.");
    if (typeof conclusions.calendarEvents !== "boolean") fail("travel.route.conclusions.calendarEvents is invalid.");
    array(conclusions.trips, "travel.route.conclusions.trips", ADVISOR_DAY_CONTEXT_LIMITS.occurrences).forEach((item, index) => {
      const trip = record(item, `travel.trip[${index}]`);
      exactKeys(trip, ["destinationRef", "role", "mode", "estimate"], `travel.trip[${index}]`);
      destinationRef(trip.destinationRef, "travel.trip.destinationRef");
      if (!TRAVEL_LEG_ROLES.includes(trip.role as TravelLegRole)) fail("travel.trip.role is invalid.");
      mode(trip.mode, "travel.trip.mode", true);
      if (trip.estimate !== "current" && trip.estimate !== "unknown") fail("travel.trip.estimate is invalid.");
    });
    unique(array(conclusions.fits, "travel.route.conclusions.fits", ADVISOR_DAY_CONTEXT_LIMITS.occurrences).map((item, index) => {
      const fit = record(item, `travel.fit[${index}]`);
      exactKeys(fit, ["ref", "conclusion", "basis", "trip", "position"], `travel.fit[${index}]`);
      const ref = nonempty(fit.ref, "travel.fit.ref");
      if (!refs.occurrenceRefs.has(ref)) fail("travel.fit.ref has no occurrence in this context.");
      if (fit.conclusion !== "fits" && fit.conclusion !== "does_not_fit" && fit.conclusion !== "unknown") fail("travel.fit.conclusion is invalid.");
      if (!TRAVEL_FIT_BASES.includes(fit.basis as TravelModelFit["basis"])) fail("travel.fit.basis is invalid.");
      if (fit.trip !== null) {
        const trip = record(fit.trip, "travel.fit.trip");
        exactKeys(trip, ["destinationRef", "role"], "travel.fit.trip");
        destinationRef(trip.destinationRef, "travel.fit.trip.destinationRef");
        if (!TRAVEL_LEG_ROLES.includes(trip.role as TravelLegRole)) fail("travel.fit.trip.role is invalid.");
      }
      if (fit.position !== null && fit.position !== "before" && fit.position !== "after") fail("travel.fit.position is invalid.");
      return ref;
    }), "travel.route.conclusions.fits");
  } else {
    fail("context.travel.route.state is invalid.");
  }

  if ("habits" in travel) {
    if (travel.routing !== "on") fail("context.travel.habits requires routing.");
    const habits = record(travel.habits, "context.travel.habits");
    exactKeys(habits, ["rulesVersion", "getReadyMinutes", "getReadySource", "placeModes"], "context.travel.habits");
    if (habits.rulesVersion !== TRAVEL_HABIT_RULES.version) fail("travel.habits.rulesVersion is unsupported.");
    const preparation = TRAVEL_HABIT_RULES.preparation;
    whole(habits.getReadyMinutes, "travel.habits.getReadyMinutes", preparation.maxMinutes);
    if ((habits.getReadyMinutes as number) % preparation.stepMinutes !== 0) fail("travel.habits.getReadyMinutes is invalid.");
    if (habits.getReadySource !== "default" && habits.getReadySource !== "learned") fail("travel.habits.getReadySource is invalid.");
    if (habits.getReadySource === "default" && habits.getReadyMinutes !== preparation.defaultMinutes) fail("travel.habits.getReadyMinutes does not match its source.");
    unique(array(habits.placeModes, "travel.habits.placeModes", ADVISOR_DAY_CONTEXT_LIMITS.behaviors).map((item, index) => {
      const row = record(item, `travel.placeMode[${index}]`);
      exactKeys(row, ["behaviorRef", "mode"], `travel.placeMode[${index}]`);
      mode(row.mode, "travel.placeMode.mode", false);
      return behaviorRef(row.behaviorRef, "travel.placeMode.behaviorRef");
    }), "travel.habits.placeModes");
  }
  if ("weather" in travel) {
    if (travel.routing !== "on") fail("context.travel.weather requires routing.");
    const weather = record(travel.weather, "context.travel.weather");
    exactKeys(weather, ["source", "tableVersion", "state", "calendarEvents", "trips"], "context.travel.weather");
    if (weather.source !== "open_meteo") fail("travel.weather.source is invalid.");
    if (weather.tableVersion !== WEATHER_MARGIN_TABLE_VERSION) fail("travel.weather.tableVersion is unsupported.");
    if (!(ADVISOR_WEATHER_STATES as readonly unknown[]).includes(weather.state)) fail("travel.weather.state is invalid.");
    if (typeof weather.calendarEvents !== "boolean") fail("travel.weather.calendarEvents is invalid.");
    const trips = array(weather.trips, "travel.weather.trips", ADVISOR_DAY_CONTEXT_LIMITS.occurrences);
    if (weather.state !== "applied" && trips.length) fail("travel.weather.trips require a forecast.");
    unique(trips.map((item, index) => {
      const trip = record(item, `travel.weather.trip[${index}]`);
      exactKeys(trip, ["destinationRef", "role", "mode", "state", "conditions", "marginMinutes", "suggestion"], `travel.weather.trip[${index}]`);
      destinationRef(trip.destinationRef, "travel.weather.trip.destinationRef");
      if (!TRAVEL_LEG_ROLES.includes(trip.role as TravelLegRole)) fail("travel.weather.trip.role is invalid.");
      // As in route trips, only the trip home has no destination.
      if ((trip.role === "return") !== (trip.destinationRef === null)) fail("travel.weather.trip.destinationRef is invalid.");
      mode(trip.mode, "travel.weather.trip.mode", false);
      if (trip.state !== "clear" && trip.state !== "margin" && trip.state !== "unknown") fail("travel.weather.trip.state is invalid.");
      const conditions = array(trip.conditions, "travel.weather.trip.conditions", WEATHER_MARGIN_TABLE.length);
      unique(conditions.map((condition) => {
        if (!WEATHER_MARGIN_TABLE.some((rule) => rule.id === condition)) fail("travel.weather.trip.condition is invalid.");
        return condition as string;
      }), "travel.weather.trip.conditions");
      // The margin is the largest fixed table value among the conditions, never a share of trip time.
      const margin = WEATHER_MARGIN_TABLE.filter((rule) => conditions.includes(rule.id)).reduce((largest, rule) => Math.max(largest, rule.marginMinutes), 0);
      if (trip.marginMinutes !== margin || (trip.state === "margin") !== (margin > 0)) fail("travel.weather.trip.marginMinutes is invalid.");
      if (trip.suggestion !== null) {
        const suggestion = record(trip.suggestion, "travel.weather.trip.suggestion");
        exactKeys(suggestion, ["instead", "alternatives"], "travel.weather.trip.suggestion");
        if (trip.state !== "margin" || suggestion.instead !== trip.mode) fail("travel.weather.trip.suggestion is invalid.");
        const alternatives = array(suggestion.alternatives, "travel.weather.trip.suggestion.alternatives", TRAVEL_MODES.length - 1);
        if (!alternatives.length) fail("travel.weather.trip.suggestion.alternatives is invalid.");
        unique(alternatives.map((alternative) => {
          mode(alternative, "travel.weather.trip.suggestion.alternative", false);
          if (alternative === trip.mode) fail("travel.weather.trip.suggestion.alternative is invalid.");
          return alternative as string;
        }), "travel.weather.trip.suggestion.alternatives");
      }
      return `${trip.role}:${trip.destinationRef ?? ""}`;
    }), "travel.weather.trips");
  }
  if ("placeLabels" in travel) {
    const labels = record(travel.placeLabels, "context.travel.placeLabels");
    exactKeys(labels, ["rulesVersion", "periodDays", "behaviors", "retained"], "context.travel.placeLabels");
    if (labels.rulesVersion !== CURRENT_WHERE_SUGGESTION_RULES.version || labels.periodDays !== CURRENT_WHERE_SUGGESTION_RULES.periodDays) {
      fail("travel.placeLabels.rulesVersion is unsupported.");
    }
    const counts = (value: unknown, label: string) => {
      const rows = new Map<string, Record<string, unknown>>();
      unique(array(value, label, ADVISOR_DAY_CONTEXT_LIMITS.behaviors).map((item, index) => {
        const row = record(item, `travel.placeLabel[${index}]`);
        exactKeys(row, ["behaviorRef", "total", "home", "wherePlace", "otherSavedPlace", "elsewhere"], `travel.placeLabel[${index}]`);
        for (const key of PLACE_LABEL_COUNT_KEYS) whole(row[key], `travel.placeLabel.${key}`, 10_000);
        const parts = (row.home as number) + (row.wherePlace as number) + (row.otherSavedPlace as number) + (row.elsewhere as number);
        if (row.total === 0 || row.total !== parts) fail("travel.placeLabel.total is invalid.");
        const ref = behaviorRef(row.behaviorRef, "travel.placeLabel.behaviorRef");
        rows.set(ref, row);
        return ref;
      }), label);
      return rows;
    };
    const period = counts(labels.behaviors, "travel.placeLabels.behaviors");
    const retained = record(labels.retained, "travel.placeLabels.retained");
    exactKeys(retained, ["retention", "behaviors"], "travel.placeLabels.retained");
    if (!(PLACE_LABEL_RETENTIONS as readonly unknown[]).includes(retained.retention)) fail("travel.placeLabels.retained.retention is invalid.");
    const kept = counts(retained.behaviors, "travel.placeLabels.retained.behaviors");
    // Every retention keeps at least the 60-day window, so kept history never counts fewer labels.
    for (const [ref, row] of period) {
      const whole = kept.get(ref);
      if (!whole || PLACE_LABEL_COUNT_KEYS.some((key) => (whole[key] as number) < (row[key] as number))) fail("travel.placeLabels.retained is invalid.");
    }
  }
}

const PLACE_LABEL_COUNT_KEYS = ["total", "home", "wherePlace", "otherSavedPlace", "elsewhere"] as const;

function validateHistoricalCompletionTimes(value: unknown, historyValue: unknown, zone: string, refs: Set<string>): void {
  const timing = record(value, "historicalCompletionTimes");
  const history = record(historyValue, "history");
  exactKeys(timing, ["semantics", "timezone", "lookbackDays", "startLocalDate", "endLocalDateExclusive", "behaviors"], "historicalCompletionTimes");
  if (timing.semantics !== "completion_mark" || timing.timezone !== zone ||
      ["lookbackDays", "startLocalDate", "endLocalDateExclusive"].some(key => timing[key] !== history[key])) {
    fail("Historical completion timing scope is invalid.");
  }
  const seen = new Set<string>();
  for (const value of array(timing.behaviors, "historicalCompletionTimes.behaviors", ADVISOR_DAY_CONTEXT_LIMITS.behaviors)) {
    const row = record(value, "timing behavior");
    exactKeys(row, ["behaviorRef", "sampleCount", "sampledDayCount", "delayedMarkCount", "typicalMarkedTime", "range", "reason", "exclusions"], "timing behavior");
    const ref = nonempty(row.behaviorRef, "timing.behaviorRef");
    if (!refs.has(ref) || seen.has(ref)) fail("Timing Behavior must be selected and unique.");
    seen.add(ref);
    const samples = integer(row.sampleCount, "timing.sampleCount", 0);
    const days = integer(row.sampledDayCount, "timing.sampledDayCount", 0);
    const delayed = integer(row.delayedMarkCount, "timing.delayedMarkCount", 0);
    if (samples > ADVISOR_DAY_CONTEXT_LIMITS.historyOccurrences || days > samples || days > (timing.lookbackDays as number) || delayed > samples) fail("Timing counts are invalid.");
    const reasons: unknown[] = [null, "insufficient_samples", "dispersed_times", "history_limit_exceeded", "source_unavailable"];
    if (!reasons.includes(row.reason)) fail("Timing reason is invalid.");
    if (row.reason === null) {
      if (samples < 3 || days < 3 || !/^\d{2}:\d{2}$/.test(row.typicalMarkedTime as string)) fail("Timing evidence is insufficient.");
      const typical = time(row.typicalMarkedTime, "typicalMarkedTime");
      const range = record(row.range, "timing.range");
      exactKeys(range, ["startTime", "endTime", "spansMidnight"], "timing.range");
      const start = time(range.startTime, "timing.range.startTime");
      const end = time(range.endTime, "timing.range.endTime");
      const startMinute = start.hour * 60 + start.minute;
      const endMinute = end.hour * 60 + end.minute;
      const typicalMinute = typical.hour * 60 + typical.minute;
      const span = (endMinute - startMinute + 1440) % 1440;
      if (range.spansMidnight !== (endMinute < startMinute) || span > 180 || (typicalMinute - startMinute + 1440) % 1440 > span) fail("Timing range is invalid.");
    } else if (row.typicalMarkedTime !== null || row.range !== null) fail("Unsupported timing cannot assert a typical time.");
    if ((row.reason === "source_unavailable" || row.reason === "history_limit_exceeded") && samples !== 0) fail("Unavailable timing cannot expose samples.");
    if (row.reason === "insufficient_samples" && samples >= 3 && days >= 3) fail("Timing insufficiency disagrees with counts.");
    if (row.reason === "dispersed_times" && (samples < 3 || days < 3)) fail("Timing dispersion needs sufficient samples.");
    const exclusions = record(row.exclusions, "timing.exclusions");
    exactKeys(exclusions, ["notCompleted", "outsideWindow", "missingMark", "invalidMark", "futureMark", "duplicateOccurrence"], "timing.exclusions");
    for (const count of Object.values(exclusions)) {
      if (integer(count, "timing exclusion", 0) > ADVISOR_DAY_CONTEXT_LIMITS.historyOccurrences) fail("Timing exclusion exceeds bounds.");
    }
  }
}

function validateCompletionHistory(value: unknown, localDate: string, occurrenceBehaviorRefs: Set<string>): Set<string> {
  const history = record(value, "context.cadence.history");
  exactKeys(history, ["lookbackDays", "startLocalDate", "endLocalDateExclusive", "completeness", "reason", "behaviors"], "context.cadence.history");
  const lookbackDays = integer(history.lookbackDays, "context.cadence.history.lookbackDays", 1);
  if (lookbackDays > 90) fail("context.cadence.history.lookbackDays is invalid.");
  const start = plainDate(history.startLocalDate, "context.cadence.history.startLocalDate");
  const end = plainDate(history.endLocalDateExclusive, "context.cadence.history.endLocalDateExclusive");
  if (end.toString() !== localDate || !start.add({ days: lookbackDays }).equals(end)) fail("context.cadence.history bounds are invalid.");
  if (history.completeness !== "complete" && history.completeness !== "unknown") fail("context.cadence.history.completeness is invalid.");
  if ((history.completeness === "complete" && history.reason !== null) || (history.completeness === "unknown" && history.reason !== "history_limit_exceeded")) {
    fail("context.cadence.history completeness fields disagree.");
  }
  const behaviors = array(history.behaviors, "context.cadence.history.behaviors", ADVISOR_DAY_CONTEXT_LIMITS.behaviors);
  const behaviorRefs = new Set<string>();
  behaviors.forEach((value, index) => {
    const behavior = record(value, `history.behavior[${index}]`);
    exactKeys(behavior, ["behaviorRef", "completedCount", "notCompletedCount", "unresolvedCount"], `history.behavior[${index}]`);
    const behaviorRef = nonempty(behavior.behaviorRef, "history.behavior.behaviorRef");
    if (behaviorRefs.has(behaviorRef)) fail("History Behavior refs must be unique.");
    behaviorRefs.add(behaviorRef);
    for (const key of ["completedCount", "notCompletedCount", "unresolvedCount"] as const) {
      if (history.completeness === "complete") integer(behavior[key], `history.behavior.${key}`, 0);
      else if (behavior[key] !== null) fail("Unknown history counts must be null.");
    }
  });
  for (const behaviorRef of occurrenceBehaviorRefs) {
    if (!behaviorRefs.has(behaviorRef)) fail("Occurrence behaviorRef has no history entry.");
  }
  return behaviorRefs;
}

function projectDuration(estimate: AdvisorCadenceOccurrenceInput["duration"]): AdvisorDuration {
  if (estimate.kind === "known") {
    if (!Number.isFinite(estimate.seconds) || estimate.seconds <= 0) fail("Known duration must be positive.");
    return {
      kind: "known",
      seconds: estimate.seconds,
      source: estimate.provenance,
      sampleCount: estimate.sampleCount,
      lookbackDays: 90,
    };
  }
  return {
    kind: "unknown",
    reason: estimate.reason,
    sampleCount: estimate.sampleCount,
    lookbackDays: 90,
  };
}

function validateOccurrence(value: unknown, index: number, localDate: string): void {
  const occurrence = record(value, `occurrence[${index}]`);
  exactOptionalKeys(occurrence, ["ref", "behaviorRef", "title", "status", "localDate", "scheduledFor", "schedule", "duration"], ["durationCandidates"], `occurrence[${index}]`);
  nonempty(occurrence.ref, "occurrence.ref");
  nonempty(occurrence.behaviorRef, "occurrence.behaviorRef");
  if (typeof occurrence.title !== "string" || occurrence.title.length > 200) fail("occurrence.title is invalid.");
  if (!(["unresolved", "completed", "not_completed"] as unknown[]).includes(occurrence.status)) fail("occurrence.status is invalid.");
  plainDate(occurrence.localDate, "occurrence.localDate");
  if (occurrence.localDate !== localDate) fail("occurrence.localDate must match context.localDate.");
  instant(occurrence.scheduledFor, "occurrence.scheduledFor");
  const schedule = record(occurrence.schedule, "occurrence.schedule");
  exactKeys(schedule, ["kind", "startTime", "endTime"], "occurrence.schedule");
  if (schedule.kind !== "exact" && schedule.kind !== "range") fail("occurrence.schedule.kind is invalid.");
  time(schedule.startTime, "occurrence.schedule.startTime");
  if (schedule.kind === "exact" && schedule.endTime !== null) fail("Exact schedule end must be null.");
  if (schedule.kind === "range") time(schedule.endTime, "occurrence.schedule.endTime");
  validateDuration(occurrence.duration);
  if ("durationCandidates" in occurrence) validateDurationCandidates(occurrence.durationCandidates);
}

function validateDurationCandidates(value: unknown): void {
  const candidates = record(value, "occurrence.durationCandidates");
  exactKeys(candidates, ["configuredDefault", "historicalAverage"], "occurrence.durationCandidates");
  if (candidates.configuredDefault !== null) {
    validateDuration(candidates.configuredDefault);
    const configured = record(candidates.configuredDefault, "occurrence.durationCandidates.configuredDefault");
    if (configured.kind !== "known" || configured.source !== "behavior_default") fail("Configured default duration candidate is invalid.");
  }
  validateDuration(candidates.historicalAverage);
  const historical = record(candidates.historicalAverage, "occurrence.durationCandidates.historicalAverage");
  if (historical.kind === "known" && historical.source !== "completed_stopped_occurrence_mean") fail("Historical average duration candidate is invalid.");
}

function validateDuration(value: unknown): void {
  const duration = record(value, "duration");
  if (duration.kind === "known") {
    exactKeys(duration, ["kind", "seconds", "source", "sampleCount", "lookbackDays"], "duration");
    positive(duration.seconds, "duration.seconds");
    if (duration.source !== "behavior_default" && duration.source !== "completed_stopped_occurrence_mean") fail("duration.source is invalid.");
  } else if (duration.kind === "unknown") {
    exactKeys(duration, ["kind", "reason", "sampleCount", "lookbackDays"], "duration");
    if (duration.reason !== "insufficient_samples" && duration.reason !== "history_limit_exceeded") fail("duration.reason is invalid.");
  } else fail("duration.kind is invalid.");
  integer(duration.sampleCount, "duration.sampleCount", 0);
  if (duration.lookbackDays !== 90) fail("duration.lookbackDays is invalid.");
}

function validateConnector(
  value: unknown,
  index: number,
  localDate: string,
  capturedAt: Temporal.Instant,
  expiresAt: Temporal.Instant,
  allowedSources: readonly string[],
  eventRefs: Set<string>,
): void {
  const connector = record(value, `connector[${index}]`);
  if (connector.state === "not_requested") {
    exactKeys(connector, ["source", "state"], `connector[${index}]`);
    if (!allowedSources.includes(connector.source as string)) fail("connector.source is invalid.");
    return;
  }
  exactKeys(connector, ["source", "state", "complete", "fetchedAt", "connectionGeneration", "selectionRevision", "schemaVersion", "adapterVersion", "coverage", "failure", "events"], `connector[${index}]`);
  if (!allowedSources.includes(connector.source as string)) fail("connector.source is invalid.");
  const versions = EXTERNAL_EVENT_SOURCE_VERSIONS[connector.source as keyof typeof EXTERNAL_EVENT_SOURCE_VERSIONS];
  if (!(["current", "unavailable", "incomplete", "stale"] as unknown[]).includes(connector.state)) fail("connector.state is invalid.");
  if (typeof connector.complete !== "boolean") fail("connector.complete is invalid.");
  const fetchedAt = connector.fetchedAt === null ? null : instant(connector.fetchedAt, "connector.fetchedAt");
  if (fetchedAt && (Temporal.Instant.compare(fetchedAt, capturedAt) > 0 || Temporal.Instant.compare(expiresAt, fetchedAt.add({ milliseconds: ADVISOR_DAY_CONTEXT_LIMITS.freshnessMs })) > 0)) fail("connector.fetchedAt bounds are invalid.");
  integer(connector.connectionGeneration, "connector.connectionGeneration", 0);
  integer(connector.selectionRevision, "connector.selectionRevision", 0);
  if (connector.schemaVersion !== versions.schemaVersion) fail("connector.schemaVersion is unsupported.");
  if (connector.adapterVersion !== versions.adapterVersion) fail("connector.adapterVersion is unsupported.");
  const coverage = array(connector.coverage, "connector.coverage", ADVISOR_DAY_CONTEXT_LIMITS.calendars);
  const calendarRefs = new Set<string>();
  coverage.forEach((item, itemIndex) => {
    const row = record(item, `coverage[${itemIndex}]`);
    exactKeys(row, ["calendarRef", "startLocalDate", "endLocalDate", "paginationComplete"], "coverage");
    nonempty(row.calendarRef, "coverage.calendarRef");
    if (calendarRefs.has(row.calendarRef as string)) fail("Calendar coverage refs must be unique.");
    calendarRefs.add(row.calendarRef as string);
    plainDate(row.startLocalDate, "coverage.startLocalDate");
    plainDate(row.endLocalDate, "coverage.endLocalDate");
    if (row.startLocalDate !== localDate || row.endLocalDate !== localDate) fail("Calendar coverage must match the context day.");
    if (typeof row.paginationComplete !== "boolean") fail("coverage.paginationComplete is invalid.");
  });
  const events = array(connector.events, "connector.events", ADVISOR_DAY_CONTEXT_LIMITS.externalEvents);
  if (!connector.complete && events.length > 0) fail("Incomplete connector cannot expose events.");
  events.forEach((event) => {
    validateEvent(event, calendarRefs);
    const ref = record(event, "event").ref as string;
    if (eventRefs.has(ref)) fail("Event refs must be unique.");
    eventRefs.add(ref);
  });
  validateConnectorFailure(connector.failure);
  if (connector.complete !== (connector.state === "current") || (connector.complete && (connector.failure !== null || fetchedAt === null || coverage.some((item) => record(item, "coverage").paginationComplete !== true)))) {
    fail("Connector completeness fields disagree.");
  }
  if (!connector.complete && connector.failure === null && (connector.state === "unavailable" || connector.state === "incomplete")) fail("Unavailable or incomplete connector requires a failure.");
}

function validateConnectorFailure(value: unknown): void {
  if (value === null) return;
  const failure = record(value, "connector.failure");
  exactKeys(failure, ["code", "retryable", "retryAfterSeconds"], "connector.failure");
  validateSourceFailureCode(failure.code);
  if (typeof failure.retryable !== "boolean") fail("connector.failure.retryable is invalid.");
  if (failure.retryAfterSeconds !== null) integer(failure.retryAfterSeconds, "connector.failure.retryAfterSeconds", 0);
}

function validateActivityConnector(value: unknown, index: number, localDate: string, zone: string, capturedAt: Temporal.Instant, expiresAt: Temporal.Instant): void {
  const connector = record(value, `connector[${index}]`);
  if (connector.state === "not_requested") {
    exactKeys(connector, ["source", "state"], `connector[${index}]`);
    return;
  }
  exactKeys(connector, ["source", "state", "complete", "fetchedAt", "connectionGeneration", "schemaVersion", "adapterVersion", "coverage", "failure", "activities"], `connector[${index}]`);
  if (!(["current", "unavailable", "incomplete", "stale"] as unknown[]).includes(connector.state)) fail("connector.state is invalid.");
  if (typeof connector.complete !== "boolean") fail("connector.complete is invalid.");
  const fetchedAt = connector.fetchedAt === null ? null : instant(connector.fetchedAt, "connector.fetchedAt");
  if (fetchedAt && Temporal.Instant.compare(fetchedAt, capturedAt) > 0) fail("connector.fetchedAt bounds are invalid.");
  if (connector.complete && fetchedAt && Temporal.Instant.compare(expiresAt, fetchedAt.add({ milliseconds: ADVISOR_DAY_CONTEXT_LIMITS.freshnessMs })) > 0) fail("connector.fetchedAt bounds are invalid.");
  integer(connector.connectionGeneration, "connector.connectionGeneration", 0);
  if (connector.schemaVersion !== RECORDED_ACTIVITY_SCHEMA_VERSION) fail("connector.schemaVersion is unsupported.");
  if (connector.adapterVersion !== HEVY_WORKOUTS_ADAPTER_VERSION) fail("connector.adapterVersion is unsupported.");
  let rangeStart: Temporal.Instant | null = null;
  let rangeEnd: Temporal.Instant | null = null;
  if (connector.coverage !== null) {
    const coverage = record(connector.coverage, "connector.coverage");
    exactKeys(coverage, ["startLocalDate", "endLocalDate", "paginationComplete"], "connector.coverage");
    const start = plainDate(coverage.startLocalDate, "coverage.startLocalDate");
    const end = plainDate(coverage.endLocalDate, "coverage.endLocalDate");
    if (coverage.endLocalDate !== localDate || Temporal.PlainDate.compare(start, end) > 0 || start.until(end).days + 1 > RECORDED_ACTIVITY_MAX_RANGE_DAYS) {
      fail("Activity coverage must end on the context day and span at most 31 days.");
    }
    if (typeof coverage.paginationComplete !== "boolean") fail("coverage.paginationComplete is invalid.");
    rangeStart = start.toZonedDateTime({ timeZone: zone }).toInstant();
    rangeEnd = end.add({ days: 1 }).toZonedDateTime({ timeZone: zone }).toInstant();
  }
  const activities = array(connector.activities, "connector.activities", ADVISOR_DAY_CONTEXT_ACTIVITY_LIMIT);
  if (!connector.complete && activities.length > 0) fail("Incomplete connector cannot expose activities.");
  const refs = new Set<string>();
  activities.forEach((value) => {
    const activity = record(value, "activity");
    exactKeys(activity, ["ref", "startAt", "endAt", "duration", "localStartDate", "location"], "activity");
    const ref = nonempty(activity.ref, "activity.ref");
    if (refs.has(ref)) fail("Activity refs must be unique.");
    refs.add(ref);
    const start = instant(activity.startAt, "activity.startAt");
    const end = instant(activity.endAt, "activity.endAt");
    if (Temporal.Instant.compare(end, start) <= 0) fail("Activity end must follow start.");
    if (Temporal.Instant.compare(end, capturedAt) > 0) fail("Activity cannot end after capture.");
    if (!rangeStart || !rangeEnd || Temporal.Instant.compare(start, rangeEnd) >= 0 || Temporal.Instant.compare(end, rangeStart) <= 0) fail("Activity falls outside its coverage.");
    const duration = record(activity.duration, "activity.duration");
    exactKeys(duration, ["kind", "seconds"], "activity.duration");
    if (duration.kind !== "known" || duration.seconds !== start.until(end).total({ unit: "seconds" })) fail("Activity duration does not match its interval.");
    if (activity.localStartDate !== start.toZonedDateTimeISO(zone).toPlainDate().toString()) fail("Activity localStartDate is invalid.");
    if (activity.location !== "unsupported") fail("activity.location is invalid.");
  });
  validateConnectorFailure(connector.failure);
  if (connector.complete !== (connector.state === "current") || (connector.complete && (connector.failure !== null || fetchedAt === null || connector.coverage === null || record(connector.coverage, "connector.coverage").paginationComplete !== true))) {
    fail("Connector completeness fields disagree.");
  }
  if (!connector.complete && connector.failure === null && (connector.state === "unavailable" || connector.state === "incomplete")) fail("Unavailable or incomplete connector requires a failure.");
}

function validateEvent(value: unknown, calendarRefs: Set<string>): void {
  const event = record(value, "event");
  exactKeys(event, ["ref", "calendarRef", "logicalInstanceRef", "revision", "interval", "sourceTimezone", "sourceTimezoneFallback", "state", "availability", "currentUserResponse", "recurrence"], "event");
  for (const key of ["ref", "calendarRef", "logicalInstanceRef", "revision"] as const) nonempty(event[key], `event.${key}`);
  if (!calendarRefs.has(event.calendarRef as string)) fail("Event calendarRef has no coverage entry.");
  timezone(event.sourceTimezone, "event.sourceTimezone");
  if (!(["none", "calendar", "request"] as unknown[]).includes(event.sourceTimezoneFallback)) fail("event.sourceTimezoneFallback is invalid.");
  if (!(["confirmed", "tentative", "cancelled", "unknown"] as unknown[]).includes(event.state)) fail("event.state is invalid.");
  if (!(["busy", "free", "unknown"] as unknown[]).includes(event.availability)) fail("event.availability is invalid.");
  if (event.currentUserResponse !== null && !(["needs_action", "declined", "tentative", "accepted", "unknown"] as unknown[]).includes(event.currentUserResponse)) fail("event.currentUserResponse is invalid.");
  const interval = record(event.interval, "event.interval");
  if (interval.kind === "timed") {
    exactKeys(interval, ["kind", "startAt", "endAt", "duration"], "event.interval");
    const start = instant(interval.startAt, "event.interval.startAt");
    const end = instant(interval.endAt, "event.interval.endAt");
    if (Temporal.Instant.compare(end, start) <= 0) fail("Timed event end must follow start.");
    const duration = record(interval.duration, "event.interval.duration");
    if (duration.kind === "known") {
      exactKeys(duration, ["kind", "seconds"], "event.interval.duration");
      const seconds = positive(duration.seconds, "event.interval.duration.seconds");
      if (Math.abs(seconds - start.until(end).total({ unit: "seconds" })) > 0.001) fail("Timed event duration does not match its interval.");
    } else if (duration.kind === "unknown") {
      exactKeys(duration, ["kind", "reason"], "event.interval.duration");
      if (duration.reason !== "end_unspecified") fail("Timed event unknown duration reason is invalid.");
    } else fail("event.interval.duration.kind is invalid.");
  } else if (interval.kind === "all_day") {
    exactKeys(interval, ["kind", "startLocalDate", "endLocalDate", "duration"], "event.interval");
    plainDate(interval.startLocalDate, "event.interval.startLocalDate");
    plainDate(interval.endLocalDate, "event.interval.endLocalDate");
    const duration = record(interval.duration, "event.interval.duration");
    exactKeys(duration, ["kind", "days"], "event.interval.duration");
    if (duration.kind !== "calendar_days") fail("All-day duration kind is invalid.");
    const days = integer(duration.days, "event.interval.duration.days", 1);
    if (days !== Temporal.PlainDate.from(interval.startLocalDate as string).until(Temporal.PlainDate.from(interval.endLocalDate as string)).days) fail("All-day duration does not match its span.");
  } else fail("event.interval.kind is invalid.");
  if (event.recurrence !== null) {
    const recurrence = record(event.recurrence, "event.recurrence");
    exactKeys(recurrence, ["seriesRef", "originalStart"], "event.recurrence");
    nonempty(recurrence.seriesRef, "event.recurrence.seriesRef");
    const original = record(recurrence.originalStart, "event.recurrence.originalStart");
    if (original.kind === "timed") {
      exactKeys(original, ["kind", "startAt"], "event.recurrence.originalStart");
      instant(original.startAt, "event.recurrence.originalStart.startAt");
    } else if (original.kind === "all_day") {
      exactKeys(original, ["kind", "startLocalDate"], "event.recurrence.originalStart");
      plainDate(original.startLocalDate, "event.recurrence.originalStart.startLocalDate");
    } else fail("event.recurrence.originalStart.kind is invalid.");
  }
}

function sourceFailureCode(value: unknown): AdvisorSourceFailureCode {
  const allowed: AdvisorSourceFailureCode[] = ["not_connected", "permission_denied", "reconnect_required", "rate_limited", "provider_unavailable", "timeout", "malformed_provider_response", "incomplete_pagination"];
  if (!allowed.includes(value as AdvisorSourceFailureCode)) return "provider_unavailable";
  return value as AdvisorSourceFailureCode;
}

function validateSourceFailureCode(value: unknown): AdvisorSourceFailureCode {
  const allowed: AdvisorSourceFailureCode[] = ["not_connected", "permission_denied", "reconnect_required", "rate_limited", "provider_unavailable", "timeout", "malformed_provider_response", "incomplete_pagination"];
  if (!allowed.includes(value as AdvisorSourceFailureCode)) fail("connector.failure.code is invalid.");
  return value as AdvisorSourceFailureCode;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object.`);
  return value as Record<string, unknown>;
}
function array(value: unknown, label: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) fail(`${label} is invalid.`);
  return value;
}
function exactKeys(value: Record<string, unknown>, keys: string[], label: string): void {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !(key in value))) fail(`${label} must contain exactly the documented fields.`);
}
function exactOptionalKeys(value: Record<string, unknown>, required: string[], optional: string[], label: string): void {
  const keys = Object.keys(value);
  if (required.some((key) => !(key in value)) || keys.some((key) => !required.includes(key) && !optional.includes(key))) {
    fail(`${label} must contain only the documented fields.`);
  }
}
function nonempty(value: unknown, label: string): string {
  if (typeof value !== "string" || !value || value.length > 512) fail(`${label} is invalid.`);
  return value;
}
function instant(value: unknown, label: string): Temporal.Instant {
  try { return Temporal.Instant.from(nonempty(value, label)); } catch { return fail(`${label} is invalid.`); }
}
function plainDate(value: unknown, label: string): Temporal.PlainDate {
  try { const parsed = Temporal.PlainDate.from(nonempty(value, label)); if (parsed.toString() !== value) fail(`${label} is invalid.`); return parsed; }
  catch { return fail(`${label} is invalid.`); }
}
function time(value: unknown, label: string): Temporal.PlainTime {
  try { return Temporal.PlainTime.from(nonempty(value, label)); } catch { return fail(`${label} is invalid.`); }
}
function timezone(value: unknown, label: string): void {
  try { Temporal.Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(nonempty(value, label)); } catch { fail(`${label} is invalid.`); }
}
function integer(value: unknown, label: string, min: number): number {
  if (!Number.isInteger(value) || (value as number) < min) fail(`${label} is invalid.`);
  return value as number;
}
function positive(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) fail(`${label} is invalid.`);
  return value;
}
function fail(message: string): never { throw new AdvisorDayContextValidationError(message); }
