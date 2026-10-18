import type {
  ExternalEventAvailability,
  ExternalEventFreshness,
  ExternalEventOriginalStart,
  ExternalEventResponseStatus,
  ExternalEventRevision,
  ExternalEventState,
  ExternalEventSource,
  NormalizedExternalEvent,
} from "./day-progress";

/** Google Calendar wire version. Google responses stay exactly `1.0.0`. */
export const EXTERNAL_EVENT_SCHEMA_VERSION = "1.0.0" as const;
export const EXTERNAL_EVENT_ADAPTER_VERSION = "google-calendar-v1" as const;
/** Wire version for the Outlook and iCloud calendar sources only (Ticket 221). */
export const EXTERNAL_EVENT_SCHEMA_VERSION_1_1 = "1.1.0" as const;
export const OUTLOOK_CALENDAR_ADAPTER_VERSION = "outlook-calendar-v1" as const;
export const ICLOUD_CALENDAR_ADAPTER_VERSION = "icloud-calendar-v1" as const;
/** Each source accepts exactly one schema/adapter pair. */
export const EXTERNAL_EVENT_SOURCE_VERSIONS = Object.freeze({
  google_calendar: Object.freeze({
    schemaVersion: EXTERNAL_EVENT_SCHEMA_VERSION,
    adapterVersion: EXTERNAL_EVENT_ADAPTER_VERSION,
  }),
  outlook_calendar: Object.freeze({
    schemaVersion: EXTERNAL_EVENT_SCHEMA_VERSION_1_1,
    adapterVersion: OUTLOOK_CALENDAR_ADAPTER_VERSION,
  }),
  icloud_calendar: Object.freeze({
    schemaVersion: EXTERNAL_EVENT_SCHEMA_VERSION_1_1,
    adapterVersion: ICLOUD_CALENDAR_ADAPTER_VERSION,
  }),
} as const);
export const EXTERNAL_EVENT_MAX_CALENDARS = 32;
export const EXTERNAL_EVENT_MAX_RANGE_DAYS = 31;

export const EXTERNAL_EVENT_CAPABILITIES = [
  "calendar_listing",
  "timed_events",
  "all_day_events",
  "recurrence",
  "details",
  "source_links",
] as const;

export type ExternalEventCapabilityName =
  (typeof EXTERNAL_EVENT_CAPABILITIES)[number];

export type ExternalEventCapability = Readonly<{
  support: "supported" | "unsupported" | "unknown";
  permission: "granted" | "denied" | "unknown";
  availability: "available" | "degraded" | "unavailable" | "unknown";
}>;

export type ExternalEventCapabilities = Readonly<
  Record<ExternalEventCapabilityName, ExternalEventCapability>
>;

export type ExternalEventRequestedRange = Readonly<{
  startLocalDate: string;
  endLocalDate: string;
  timezone: string;
  selectedCalendarIds: string[];
}>;

export type ExternalEventCoverage = Readonly<{
  calendarId: string;
  startLocalDate: string;
  endLocalDate: string;
  paginationComplete: boolean;
  itemCount: number;
}>;

export type ExternalEventErrorCode =
  | "unauthenticated"
  | "not_connected"
  | "permission_denied"
  | "wrong_account"
  | "reconnect_required"
  | "rate_limited"
  | "provider_unavailable"
  | "timeout"
  | "malformed_provider_response"
  | "incomplete_pagination"
  | "invalid_request"
  | "unsupported_schema_version";

export type ExternalEventFailure = Readonly<{
  code: ExternalEventErrorCode;
  calendarId: string | null;
  retryable: boolean;
  retryAfterSeconds: number | null;
  message: string;
}>;

export type ExternalEventCancellationTombstone = Readonly<{
  id: string;
  providerEventId: string;
  logicalInstanceId: string;
  calendarId: string;
  source: "google_calendar";
  recurrence: Readonly<{
    seriesId: string;
    originalStart: ExternalEventOriginalStart;
  }> | null;
  revision: ExternalEventRevision;
}>;

export type ExternalEventSnapshotV1 = Readonly<{
  schemaVersion: typeof EXTERNAL_EVENT_SCHEMA_VERSION;
  adapterVersion: typeof EXTERNAL_EVENT_ADAPTER_VERSION;
  accountId: string;
  connectionGeneration: number;
  source: "google_calendar";
  requestedRange: ExternalEventRequestedRange;
  fetchedAt: string;
  completeness: "complete" | "incomplete";
  freshness: ExternalEventFreshness;
  capabilities: ExternalEventCapabilities;
  coverage: ExternalEventCoverage[];
  failures: ExternalEventFailure[];
  events: NormalizedExternalEvent[];
  tombstones: ExternalEventCancellationTombstone[];
}>;

export type ExternalEventSourceV1_1 = Exclude<ExternalEventSource, "google_calendar">;

export type ExternalEventCancellationTombstoneV1_1 = Omit<
  ExternalEventCancellationTombstone,
  "source"
> & Readonly<{ source: ExternalEventSourceV1_1 }>;

type ExternalEventSnapshotV1_1Body<Source extends ExternalEventSourceV1_1> = Omit<
  ExternalEventSnapshotV1,
  "schemaVersion" | "adapterVersion" | "source" | "tombstones"
> & Readonly<{
  schemaVersion: typeof EXTERNAL_EVENT_SCHEMA_VERSION_1_1;
  adapterVersion: (typeof EXTERNAL_EVENT_SOURCE_VERSIONS)[Source]["adapterVersion"];
  source: Source;
  tombstones: Array<ExternalEventCancellationTombstoneV1_1 & Readonly<{ source: Source }>>;
}>;

/** Outlook or iCloud snapshot. Served only by new provider routes. */
export type ExternalEventSnapshotV1_1 =
  | ExternalEventSnapshotV1_1Body<"outlook_calendar">
  | ExternalEventSnapshotV1_1Body<"icloud_calendar">;

export type VersionedExternalEventSnapshot =
  | ExternalEventSnapshotV1
  | ExternalEventSnapshotV1_1;

/** Every cache or stored snapshot key binds these facts together. */
export type ExternalEventSnapshotScope = Readonly<{
  source: ExternalEventSource;
  accountId: string;
  connectionGeneration: number;
  startLocalDate: string;
  endLocalDate: string;
  timezone: string;
  selectedCalendarIds: readonly string[];
}>;

export type ExternalEventSchedulingFact = Readonly<{
  id: string;
  providerEventId: string;
  logicalInstanceId: string;
  calendarId: string;
  interval:
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
  sourceTimezone: string;
  sourceTimezoneFallback: "none" | "calendar" | "request";
  state: ExternalEventState;
  availability: ExternalEventAvailability;
  currentUserResponse: ExternalEventResponseStatus | null;
  recurrence: Readonly<{
    seriesId: string;
    originalStart: ExternalEventOriginalStart;
  }> | null;
  revision: ExternalEventRevision;
}>;

export type ExternalEventSchedulingProjection = Readonly<{
  schemaVersion: typeof EXTERNAL_EVENT_SCHEMA_VERSION;
  accountId: string;
  requestedRange: ExternalEventRequestedRange;
  completeness: "complete" | "incomplete";
  freshness: ExternalEventFreshness;
  coverage: ExternalEventCoverage[];
  events: ExternalEventSchedulingFact[];
  tombstones: ExternalEventCancellationTombstone[];
}>;

export type ExternalEventSchedulingProjectionV1_1 = Omit<
  ExternalEventSchedulingProjection,
  "schemaVersion" | "tombstones"
> & Readonly<{
  schemaVersion: typeof EXTERNAL_EVENT_SCHEMA_VERSION_1_1;
  source: ExternalEventSourceV1_1;
  tombstones: ExternalEventCancellationTombstoneV1_1[];
}>;
