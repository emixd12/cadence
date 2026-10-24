import type { ExternalEventErrorCode } from "./external-event";

/**
 * Recorded activity is an actual past interval reported by a provider. It is not
 * a scheduled event: it never enters `NormalizedExternalEvent`, Calendar
 * selection, overlap cues, or Behavior/Occurrence status. See
 * `docs/EXTERNAL_EVENT_CONTRACT.md` "Recorded activity snapshot (Hevy)".
 */
export const RECORDED_ACTIVITY_SCHEMA_VERSION = "1.0.0" as const;
export const HEVY_WORKOUTS_ADAPTER_VERSION = "hevy-workouts-v1" as const;
export const RECORDED_ACTIVITY_SOURCE = "hevy" as const;
/** Today and up to 30 prior local dates, inclusive. */
export const RECORDED_ACTIVITY_MAX_RANGE_DAYS = 31;
export const RECORDED_ACTIVITY_PAGE_SIZE = 10;
/** Applies only to recorded activity; the 20-page calendar bound is unchanged. */
export const RECORDED_ACTIVITY_MAX_PAGES = 50;
export const RECORDED_ACTIVITY_MAX_ITEMS =
  RECORDED_ACTIVITY_PAGE_SIZE * RECORDED_ACTIVITY_MAX_PAGES;

export type RecordedActivitySource = typeof RECORDED_ACTIVITY_SOURCE;

export type RecordedActivityRequestedRange = Readonly<{
  startLocalDate: string;
  endLocalDate: string;
  timezone: string;
}>;

/**
 * `complete` means no change was detected during the read. It is not an atomic
 * snapshot: list ordering is undocumented and offset pages can shift.
 */
export type RecordedActivityCoverage = Readonly<{
  pagesRead: number;
  pageCount: number | null;
  countBefore: number | null;
  countAfter: number | null;
  itemCount: number;
  duplicatesRemoved: number;
  paginationComplete: boolean;
}>;

export type RecordedActivityFailure = Readonly<{
  code: ExternalEventErrorCode;
  retryable: boolean;
  retryAfterSeconds: number | null;
  message: string;
}>;

export type RecordedActivityRevision = Readonly<{
  availability: "available" | "unavailable";
  providerUpdatedAt: string | null;
}>;

export type RecordedActivity = Readonly<{
  /** Opaque account-scoped ID derived from source and provider workout ID. */
  id: string;
  kind: "workout";
  startAt: string;
  endAt: string;
  /** Derived from `endAt - startAt`; never supplied independently. */
  duration: Readonly<{ kind: "known"; seconds: number }>;
  localStartDate: string;
  revision: RecordedActivityRevision;
  /** Hevy documents no location or timezone field. Never inferred. */
  fieldAvailability: Readonly<{
    location: "unsupported";
    sourceTimezone: "unsupported";
  }>;
}>;

export type RecordedActivitySnapshotV1 = Readonly<{
  schemaVersion: typeof RECORDED_ACTIVITY_SCHEMA_VERSION;
  adapterVersion: typeof HEVY_WORKOUTS_ADAPTER_VERSION;
  source: RecordedActivitySource;
  accountId: string;
  connectionGeneration: number;
  requestedRange: RecordedActivityRequestedRange;
  fetchedAt: string;
  completeness: "complete" | "incomplete";
  coverage: RecordedActivityCoverage;
  failures: RecordedActivityFailure[];
  activities: RecordedActivity[];
}>;

export type RecordedActivitySnapshotScope = Readonly<{
  source: RecordedActivitySource;
  accountId: string;
  connectionGeneration: number;
  startLocalDate: string;
  endLocalDate: string;
  timezone: string;
}>;

/** Provider workout timing after the adapter discards every other field. */
export type RecordedWorkoutTimingInput = Readonly<{
  providerWorkoutId: unknown;
  startTime: unknown;
  endTime: unknown;
  updatedAt: unknown;
}>;

export type RecordedActivityQuarantineReason =
  | "missing_identity"
  | "malformed_start"
  | "malformed_end"
  | "end_unknown"
  | "reversed_interval"
  | "future_interval"
  | "malformed_revision";

export type RecordedActivityNormalizationResult =
  | Readonly<{ status: "accepted"; activity: RecordedActivity }>
  | Readonly<{ status: "outside_range" }>
  | Readonly<{ status: "quarantined"; reason: RecordedActivityQuarantineReason }>;
