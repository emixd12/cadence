export type ExternalEventSource =
  | "google_calendar"
  | "outlook_calendar"
  | "icloud_calendar";

export type ExternalEventField =
  | "title"
  | "description"
  | "location"
  | "source_url"
  | "organizer"
  | "attendees"
  | "conference"
  | "recurrence"
  | "attachments";

export type ExternalEventFieldAvailability =
  | "not_provided"
  | "restricted"
  | "provider_omitted"
  | "unsupported"
  | "unknown";

export type ExternalEventDetailCompleteness =
  | "complete"
  | "provider_omitted"
  | "client_truncated"
  | "restricted"
  | "unsupported"
  | "unknown";

export type ExternalEventState =
  | "confirmed"
  | "tentative"
  | "cancelled"
  | "unknown";

export type ExternalEventAvailability = "busy" | "free" | "unknown";

export type ExternalEventResponseStatus =
  | "needs_action"
  | "declined"
  | "tentative"
  | "accepted"
  | "unknown";

export type ExternalEventSourceTimezoneFallback =
  | "none"
  | "calendar"
  | "request";

export type ExternalEventRevision = Readonly<{
  availability: "available" | "unavailable";
  providerUpdatedAt: string | null;
  providerEtag: string | null;
}>;

export type ExternalEventOriginalStart =
  | Readonly<{ kind: "timed"; startAt: string }>
  | Readonly<{ kind: "all_day"; startLocalDate: string }>;

type NormalizedExternalEventBase = Readonly<{
  id: string;
  providerEventId: string;
  logicalInstanceId: string;
  calendarId: string;
  source: ExternalEventSource;
  calendarName: string;
  sourceTimezone: string;
  sourceTimezoneFallback: ExternalEventSourceTimezoneFallback;
  state: ExternalEventState;
  availability: ExternalEventAvailability;
  currentUserResponse: ExternalEventResponseStatus | null;
  revision: ExternalEventRevision;
  title: string;
  description: string;
  location: string;
  sourceUrl: string | null;
  fieldAvailability: Partial<
    Record<ExternalEventField, ExternalEventFieldAvailability>
  >;
  detailCompleteness: Partial<
    Record<
      "attendees" | "conference_entry_points" | "attachments",
      ExternalEventDetailCompleteness
    >
  >;
  organizer: Readonly<{
    displayName: string | null;
    email: string | null;
    self: boolean;
  }> | null;
  attendees: ReadonlyArray<
    Readonly<{
      displayName: string | null;
      email: string | null;
      responseStatus:
        ExternalEventResponseStatus;
      optional: boolean;
      organizer: boolean;
      self: boolean;
    }>
  > | null;
  attendeesOmitted: boolean;
  conference: Readonly<{
    name: string | null;
    entryPoints: ReadonlyArray<
      Readonly<{
        type: "video" | "phone" | "sip" | "more" | "unknown";
        uri: string;
        label: string | null;
      }>
    >;
    notes: string | null;
  }> | null;
  recurrence: Readonly<{
    seriesId: string;
    originalStart: ExternalEventOriginalStart;
  }> | null;
  attachments: ReadonlyArray<
    Readonly<{
      title: string | null;
      mimeType: string | null;
      url: string;
    }>
  > | null;
}>;

export type NormalizedTimedExternalEvent = NormalizedExternalEventBase &
  Readonly<{
    kind: "timed";
    startAt: string;
    endAt: string;
    endUnspecified: boolean;
    duration:
      | Readonly<{ kind: "known"; seconds: number }>
      | Readonly<{ kind: "unknown"; reason: "end_unspecified" }>;
  }>;

export type NormalizedAllDayExternalEvent = NormalizedExternalEventBase &
  Readonly<{
    kind: "all_day";
    startLocalDate: string;
    endLocalDate: string;
    duration: Readonly<{ kind: "calendar_days"; days: number }>;
  }>;

export type NormalizedExternalEvent =
  | NormalizedTimedExternalEvent
  | NormalizedAllDayExternalEvent;

export type ExternalEventFreshnessState =
  | "current"
  | "stale"
  | "incomplete"
  | "unavailable";

export type ExternalEventFreshness = Readonly<{
  state: ExternalEventFreshnessState;
  refreshedAt: string | null;
  label: string;
  canAssertNoOverlap: boolean;
}>;

export type DayProgressRowGeometry = Readonly<{
  occurrenceId: string;
  scheduledFor: string;
  center: number;
}>;

export type DayProgressDayGeometry = Readonly<{
  localDate: string;
  top: number;
  bottom: number;
  rows: DayProgressRowGeometry[];
}>;

export type DayProgressPositionAnchor = Readonly<{
  kind: "day_start" | "row" | "day_end";
  actualAt: string;
  position: number;
  occurrenceId: string | null;
}>;

export type DayProgressRowLayout = Readonly<{
  occurrenceId: string;
  actualAt: string;
  actualPosition: number;
  displayPosition: number;
  displacement: number;
}>;

export type DayProgressSameTimeBracket = Readonly<{
  actualAt: string;
  anchorOccurrenceId: string;
  peerOccurrenceIds: string[];
  top: number;
  bottom: number;
}>;

export type DayProgressMovingDot = Readonly<{
  actualAt: string;
  actualPosition: number;
  displayPosition: number;
  displacement: number;
}>;

export type DayProgressTimedEventSpan = Readonly<{
  eventId: string;
  actualStart: string;
  actualEnd: string | null;
  clippedStart: string;
  clippedEnd: string | null;
  startPosition: number;
  iconPosition: number;
  endPosition: number | null;
  endUnspecified: boolean;
  continuesBefore: boolean;
  continuesAfter: boolean;
  iconLane: 0 | 1 | null;
  overflowGroupId: string | null;
}>;

export type DayProgressIconOverflowGroup = Readonly<{
  id: string;
  position: number;
  iconLane: 0 | 1;
  eventIds: string[];
  count: number;
}>;

export type DayProgressDayLayout = Readonly<{
  localDate: string;
  dayStart: string;
  dayEnd: string;
  top: number;
  bottom: number;
  positionAnchors: DayProgressPositionAnchor[];
  rowLayouts: DayProgressRowLayout[];
  sameTimeBrackets: DayProgressSameTimeBracket[];
  movingDot: DayProgressMovingDot | null;
  timedEventSpans: DayProgressTimedEventSpan[];
  travelSpans: ReadonlyArray<Readonly<{ segmentId: string; sourceRefs: string[]; startPosition: number; endPosition: number }>>;
  requiredIconHeight: number;
  iconLayoutOverflow: boolean;
  allDayEventIds: string[];
  iconOverflowGroups: DayProgressIconOverflowGroup[];
}>;

export type DayProgressLayout = Readonly<{
  timezone: string;
  days: DayProgressDayLayout[];
}>;

export type BehaviorDurationHistoryOccurrence = Readonly<{
  id: string;
  behaviorId: string;
  localDate: string;
  status: "unresolved" | "completed" | "not_completed";
  sessions: ReadonlyArray<
    Readonly<{
      id: string;
      userId: string;
      occurrenceId: string;
      behaviorId: string;
      startedAt: string;
      stoppedAt: string | null;
    }>
  >;
}>;

export type BehaviorDurationEstimate =
  | Readonly<{
      kind: "known";
      seconds: number;
      durationLabel: string;
      sampleCount: number;
      lookbackDays: number;
      provenance: "completed_stopped_occurrence_mean" | "behavior_default";
    }>
  | Readonly<{
      kind: "unknown";
      reason: "insufficient_samples";
      sampleCount: number;
      requiredSampleCount: number;
      lookbackDays: number;
    }>;

export type TimelineActivitySignal =
  | "scheduled_now"
  | "estimated_window"
  | "tracking_now";

export type TimelineOccurrenceContext = Readonly<{
  occurrenceId: string;
  estimate: BehaviorDurationEstimate;
  estimatedStart: string;
  estimatedEnd: string | null;
  activitySignals: TimelineActivitySignal[];
  overlappingEventIds: string[];
  overlapAssessment: "possible" | "none" | "unknown";
  overlapLabel: string;
  freshness: ExternalEventFreshness;
}>;
