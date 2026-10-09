import type { CompletionTimingSummary } from "../resolvers/completion-timing.resolver";

import type {
  ExternalEventAvailability,
  ExternalEventResponseStatus,
  ExternalEventSourceTimezoneFallback,
  ExternalEventState,
} from "./day-progress";
import type { OccurrenceStatus } from "./database";

export const ADVISOR_DAY_CONTEXT_VERSION = "1.0" as const;
export const ADVISOR_DAY_CONTEXT_LIMITS = Object.freeze({
  behaviors: 100,
  occurrences: 200,
  calendars: 32,
  externalEvents: 500,
  historyOccurrences: 10_000,
  historySessions: 20_000,
  responseBytes: 512 * 1024,
  deadlineMs: 30_000,
  freshnessMs: 5 * 60 * 1000,
});

export type AdvisorDayContextErrorCode =
  | "unauthenticated"
  | "access_denied"
  | "invalid_request"
  | "unsupported_version"
  | "context_changed"
  | "context_incomplete"
  | "context_limit_exceeded"
  | "timeout"
  | "rate_limited"
  | "write_not_supported";

export type AdvisorSourceFailureCode =
  | "not_connected"
  | "permission_denied"
  | "reconnect_required"
  | "rate_limited"
  | "provider_unavailable"
  | "timeout"
  | "malformed_provider_response"
  | "incomplete_pagination";

export type AdvisorDayContextFailure = Readonly<{
  code: AdvisorDayContextErrorCode;
  retryable: boolean;
  retryAfterSeconds: number | null;
}>;

export type AdvisorDayContextRequestV1 = Readonly<{
  version: typeof ADVISOR_DAY_CONTEXT_VERSION;
  localDate: string | null;
  connectors: [] | ["google_calendar"];
}>;

export type AdvisorDayContextErrorV1 = Readonly<{
  version: typeof ADVISOR_DAY_CONTEXT_VERSION;
  error: AdvisorDayContextFailure;
}>;

export type AdvisorDuration =
  | Readonly<{
      kind: "known";
      seconds: number;
      source: "behavior_default" | "completed_stopped_occurrence_mean";
      sampleCount: number;
      lookbackDays: 90;
    }>
  | Readonly<{
      kind: "unknown";
      reason: "insufficient_samples" | "history_limit_exceeded";
      sampleCount: number;
      lookbackDays: 90;
    }>;

export type AdvisorDurationCandidates = Readonly<{
  configuredDefault: Extract<AdvisorDuration, { kind: "known" }> | null;
  historicalAverage: AdvisorDuration;
}>;

export type AdvisorRecordedElapsedDuration = Readonly<{
  behaviorRef: string;
  localDate: string;
  seconds: number;
}>;

export type AdvisorOccurrence = Readonly<{
  ref: string;
  behaviorRef: string;
  title: string;
  status: OccurrenceStatus;
  localDate: string;
  scheduledFor: string;
  schedule: Readonly<{
    kind: "exact" | "range";
    startTime: string;
    endTime: string | null;
  }>;
  duration: AdvisorDuration;
  /** Internal source candidates. Model projections must apply recipe controls first. */
  durationCandidates?: AdvisorDurationCandidates;
}>;

export type AdvisorCompletionHistoryBehavior = Readonly<{
  behaviorRef: string;
  completedCount: number | null;
  notCompletedCount: number | null;
  unresolvedCount: number | null;
}>;

export type AdvisorCompletionHistory = Readonly<{
  lookbackDays: number;
  startLocalDate: string;
  endLocalDateExclusive: string;
  completeness: "complete" | "unknown";
  reason: "history_limit_exceeded" | null;
  behaviors: AdvisorCompletionHistoryBehavior[];
}>;

export type AdvisorHistoricalCompletionTimes = Readonly<{
  semantics: "completion_mark";
  timezone: string;
  lookbackDays: number;
  startLocalDate: string;
  endLocalDateExclusive: string;
  behaviors: readonly (CompletionTimingSummary & Readonly<{ behaviorRef: string }>)[];
}>;

export type AdvisorCadenceSource = Readonly<{
  observedAt: string;
  revision: string;
  coverage: "complete";
  occurrences: AdvisorOccurrence[];
  history: AdvisorCompletionHistory;
  /** Eligible completed, stopped samples. Omitted by legacy/synthetic contexts. */
  recordedElapsedDurations?: AdvisorRecordedElapsedDuration[];
  historicalCompletionTimes?: AdvisorHistoricalCompletionTimes;
}>;

export type AdvisorCalendarInterval =
  | Readonly<{
      kind: "timed";
      startAt: string;
      endAt: string;
      duration:
        | Readonly<{ kind: "known"; seconds: number }>
        | Readonly<{ kind: "unknown"; reason: "end_unspecified" }>;
    }>
  | Readonly<{
      kind: "all_day";
      startLocalDate: string;
      endLocalDate: string;
      duration: Readonly<{ kind: "calendar_days"; days: number }>;
    }>;

export type AdvisorCalendarEvent = Readonly<{
  ref: string;
  calendarRef: string;
  logicalInstanceRef: string;
  revision: string;
  interval: AdvisorCalendarInterval;
  sourceTimezone: string;
  sourceTimezoneFallback: ExternalEventSourceTimezoneFallback;
  state: ExternalEventState;
  availability: ExternalEventAvailability;
  currentUserResponse: ExternalEventResponseStatus | null;
  recurrence: Readonly<{
    seriesRef: string;
    originalStart:
      | Readonly<{ kind: "timed"; startAt: string }>
      | Readonly<{ kind: "all_day"; startLocalDate: string }>;
  }> | null;
}>;

export type AdvisorCalendarConnector = Readonly<{
  source: "google_calendar";
  state: "current" | "unavailable" | "incomplete" | "stale";
  complete: boolean;
  fetchedAt: string | null;
  connectionGeneration: number;
  selectionRevision: number;
  schemaVersion: string;
  adapterVersion: string;
  coverage: ReadonlyArray<{
    calendarRef: string;
    startLocalDate: string;
    endLocalDate: string;
    paginationComplete: boolean;
  }>;
  failure: Readonly<{
    code: AdvisorSourceFailureCode;
    retryable: boolean;
    retryAfterSeconds: number | null;
  }> | null;
  events: AdvisorCalendarEvent[];
}>;

export type AdvisorCalendarNotRequested = Readonly<{
  source: "google_calendar";
  state: "not_requested";
}>;

export type AdvisorDayContextV1 = Readonly<{
  version: typeof ADVISOR_DAY_CONTEXT_VERSION;
  snapshotId: string;
  accountRef: string;
  localDate: string;
  timezone: string;
  dayStartAt: string;
  dayEndAt: string;
  capturedAt: string;
  expiresAt: string;
  status: "complete" | "partial";
  authority: "read_only";
  grantGeneration: number;
  cadence: AdvisorCadenceSource;
  connectors: Array<AdvisorCalendarConnector | AdvisorCalendarNotRequested>;
}>;

export type AdvisorOpaqueRef = (
  kind: "account" | "snapshot" | "behavior" | "occurrence" | "calendar" | "event" | "instance" | "series" | "revision"
    | "configuration" | "status_event" | "note" | "analysis_revision",
  value: string,
) => string;
