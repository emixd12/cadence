/** Hard limits for integration requests and responses. */
export const INTEGRATION_LIMITS = Object.freeze({
  /** Default and maximum page sizes for paginated list reads. */
  defaultPageSize: 50,
  maxPageSize: 100,
  /** Longest inclusive date range for `list_occurrences`. */
  maxOccurrenceRangeDays: 92,
  /** Longest inclusive date range for `get_adherence_summary`. */
  maxAdherenceRangeDays: 366,
  /** Most days `get_timeline` returns after its start date. */
  maxTimelineDays: 14,
  /** How far back `get_timeline` looks for Needs decision Occurrences, and how many it returns. */
  needsDecisionLookbackDays: 90,
  maxNeedsDecisionItems: 100,
  /** Most Behavior ids one filter can name. */
  maxBehaviorFilterIds: 50,
  /** Search query length and result count. */
  maxSearchQueryLength: 200,
  maxSearchResults: 20,
  /** Behavior definition limits, matching the web Behavior form. */
  maxBehaviorTitleLength: 160,
  maxBehaviorDescriptionLength: 1000,
  maxLocationTextLength: 500,
  maxSchedulesPerBehavior: 6,
  maxTimeEntriesPerSchedule: 8,
  maxRecurrenceInterval: 999,
  maxDefaultDurationMinutes: 1440,
  /** Sub-behaviors (contract 1.7.0): children one create_behavior call may add, the largest sibling position, and Occurrences one parent slot mark may change. */
  maxInlineSubBehaviors: 25,
  maxSubBehaviorSortOrder: 9999,
  maxParentSlotOccurrences: 50,
  /** Note limits. Archive notes match the web limit. */
  maxOccurrenceNoteLength: 2000,
  /** Day notes (Ticket 292): note length and the longest inclusive `list_day_notes` range. */
  maxDayNoteLength: 2000,
  maxDayNoteRangeDays: 92,
  maxArchiveNoteLength: 2000,
  /**
   * Periods (Ticket 370): label and note length, the longest inclusive `list_periods`
   * range, Periods per `list_periods` page, Period summaries in one embedded list
   * (`active_periods`, `period_split.periods`), Period summaries on one `get_timeline`
   * day (lower, so 14 days of the longest labels stay under the result cap), and Periods
   * one account can hold. The lengths, range and cap match `PERIOD_LIMITS`.
   */
  maxPeriodLabelLength: 60,
  maxPeriodNoteLength: 2000,
  maxPeriodRangeDays: 366,
  maxPeriodsPerPage: 40,
  maxEmbeddedPeriods: 20,
  maxTimelineDayPeriods: 10,
  maxPeriodsPerAccount: 500,
  /** Opaque token sizes. */
  maxCursorLength: 512,
  maxRevisionLength: 128,
  minIdempotencyKeyLength: 8,
  maxIdempotencyKeyLength: 128,
  maxExternalRefLength: 200,
  /** Seconds a stored idempotent result stays replayable. */
  idempotencyWindowSeconds: 86_400,
  /** Largest serialized UTF-8 result a handler may return. Larger results fail with `limit_exceeded`. */
  maxResponseBytes: 100_000,
} as const);

export type IntegrationLimits = typeof INTEGRATION_LIMITS;

/** Reminder offsets the web Behavior form allows, in minutes before the scheduled time. */
export const INTEGRATION_REMINDER_OFFSETS = Object.freeze([0, 15, 60, 1440, 4320] as const);
