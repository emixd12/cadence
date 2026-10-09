/**
 * Daily Brief analysis lanes (Tickets 169–173). Lanes turn bounded, owner-scoped
 * history into small findings with stated evidence, coverage and limitations.
 * The model explains supported findings; it never calculates them.
 */
export const BRIEFING_ANALYSIS_VERSION = "1.0" as const;

/** Lane IDs reuse the export prompt IDs whose purpose they share. */
export const BRIEFING_ANALYSIS_LANE_IDS = [
  "weekday-time-dips",
  "realistic-timing",
  "schedule-load",
  "cross-source-context",
  "decision-debt",
  "logging-chronology",
  "correction-patterns",
  "reminder-effectiveness",
  "notes-failure-themes",
] as const;

export type BriefingAnalysisLaneId = (typeof BRIEFING_ANALYSIS_LANE_IDS)[number];

/** Source families a lane can require. Optional families need their own disclosure. */
export type BriefingAnalysisInput =
  | "history_occurrences"
  | "schedule_slots"
  | "configuration_periods"
  | "status_events"
  | "reminder_deliveries"
  | "not_completed_notes"
  | "historical_calendar";

export type BriefingAnalysisOptionalSource = "reminders" | "notes";

export type BriefingAnalysisProposalKind =
  | "timing_experiment"
  | "load_experiment"
  | "decision_moment"
  | "reminder_adjustment"
  | "obstacle_plan";

export type BriefingAnalysisLaneContract = Readonly<{
  id: BriefingAnalysisLaneId;
  question: string;
  requiredInputs: readonly BriefingAnalysisInput[];
  /** Non-null lanes stay unavailable until the account discloses this source. */
  optionalSource: BriefingAnalysisOptionalSource | null;
  /** Local-date lookback bounds. The selected window is applied before aggregation. */
  lookback: Readonly<{ minDays: number; maxDays: 90 }>;
  /** Plain statement of the sufficiency rule tested in `briefing-analysis.resolver.ts`. */
  sufficiency: string;
  permittedProposals: readonly BriefingAnalysisProposalKind[];
  /** Missing, capped or undisclosed inputs never produce partial totals. */
  unsupportedInput: "unavailable";
}>;

/** Internal, owner-scoped analysis records. Never sent to a model or inspector as-is. */
export type BriefingAnalysisOccurrence = Readonly<{
  ref: string;
  behaviorRef: string;
  localDate: string;
  scheduledFor: string;
  scheduleKind: "exact" | "range";
  /** Local `HH:MM` slot start. */
  startTime: string;
  endTime: string | null;
  status: "unresolved" | "completed" | "not_completed";
  /** Latest recorded mark. A logging time, never a performance time. */
  statusMarkedAt: string | null;
  configurationRef: string | null;
}>;

export type BriefingAnalysisStatusEvent = Readonly<{
  ref: string;
  occurrenceRef: string;
  previousStatus: "unresolved" | "completed" | "not_completed" | null;
  status: "unresolved" | "completed" | "not_completed";
  semantics: "explicit_user_mark" | "explicit_user_correction" | "imported_explicit" | "system_rule_declared" | "ambiguous_import";
  recordedAt: string;
  revisesRef: string | null;
}>;

export type BriefingAnalysisConfigurationPeriod = Readonly<{
  ref: string;
  behaviorRef: string;
  effectiveAt: string;
  effectiveLocalDate: string;
  /** True for baselines and schedule, timezone or active changes; false for reminder/category-only edits. */
  startsSchedulePeriod: boolean;
  browserReminderEnabled: boolean;
  emailReminderEnabled: boolean;
}>;

export type BriefingAnalysisReminderDelivery = Readonly<{
  occurrenceRef: string;
  channel: "browser_push" | "email";
  status: "sent" | "failed" | "cancelled" | "pending";
  scheduledSendAt: string;
}>;

export type BriefingAnalysisNote = Readonly<{
  ref: string;
  occurrenceRef: string;
  behaviorRef: string;
  localDate: string;
  /** Trimmed and bounded Note text from a Not Completed occurrence. */
  text: string;
}>;

export type BriefingAnalysisOptionalRecords<T> =
  | Readonly<{ state: "available"; records: readonly T[] }>
  | Readonly<{ state: "not_permitted" | "capped" | "not_requested" }>;

export type BriefingAnalysisSource = Readonly<{
  version: typeof BRIEFING_ANALYSIS_VERSION;
  observedAt: string;
  /** Opaque revision of every record below, fenced before delivery. */
  revision: string;
  timezone: string;
  /** Today's local date; history covers `[startLocalDate, localDate)`. */
  localDate: string;
  startLocalDate: string;
  lookbackDays: 90;
  completeness: "complete" | "capped";
  occurrences: readonly BriefingAnalysisOccurrence[];
  statusEvents: BriefingAnalysisOptionalRecords<BriefingAnalysisStatusEvent>;
  configurationPeriods: BriefingAnalysisOptionalRecords<BriefingAnalysisConfigurationPeriod>;
  reminders: BriefingAnalysisOptionalRecords<BriefingAnalysisReminderDelivery>;
  notes: BriefingAnalysisOptionalRecords<BriefingAnalysisNote>;
  /** Today's scheduled load by Behavior, used for relevance only. */
  today: Readonly<{
    scheduledCount: number;
    /** One Behavior ref per occurrence scheduled today, so a narrowed scope can recount load. */
    scheduledBehaviorRefs?: readonly string[];
    unresolved: readonly Readonly<{ ref: string; behaviorRef: string; startTime: string }>[];
  }>;
}>;

export type BriefingAnalysisLaneState =
  | "finding"
  | "no_finding"
  | "unavailable"
  | "not_selected";

export type BriefingAnalysisUnavailableReason =
  | "source_not_permitted"
  | "source_capped"
  | "source_not_requested"
  | "insufficient_window"
  | "insufficient_stable_period"
  | "historical_calendar_not_read"
  | "actual_time_unavailable";

export type BriefingAnalysisLaneResult = Readonly<{
  laneId: BriefingAnalysisLaneId;
  state: BriefingAnalysisLaneState;
  reason: BriefingAnalysisUnavailableReason | null;
  /** Findings the lane evaluated before sufficiency/materiality filtering. */
  candidateCount: number;
}>;

export type BriefingAnalysisLimitation =
  | "association_not_cause"
  | "marking_time_not_performance_time"
  | "unresolved_excluded_from_rates"
  | "schedule_period_segmented"
  | "delivery_records_only"
  | "user_written_notes"
  | "window_before_history_capture";

export type BriefingFinding = Readonly<{
  /** Stable within one analysis; not a cross-day fingerprint. */
  id: string;
  laneId: BriefingAnalysisLaneId;
  behaviorRef: string | null;
  /** Lane-specific subject key, for example `weekday:2` or `load:heavy`. */
  key: string;
  /** Coarse evidence bucket. A changed bucket may justify showing a tip again. */
  evidenceBand: string;
  scope: Readonly<{ startLocalDate: string; endLocalDateExclusive: string; days: number }>;
  /** Named integer counts with explicit denominators. */
  counts: Readonly<Record<string, number>>;
  /** Rates are ratios of the counts above, rounded to two decimals. */
  rates: Readonly<Record<string, number>>;
  coverage: Readonly<{ resolved: number; unresolved: number; total: number }>;
  sufficiency: Readonly<{ rule: string; met: true }>;
  /** Absolute difference or share that passed the materiality threshold. */
  materiality: number;
  /** True when the finding bears on something scheduled or planned today. */
  relevantToday: boolean;
  proposal: Readonly<{ kind: BriefingAnalysisProposalKind; detail: Readonly<Record<string, string | number>> }>;
  limitations: readonly BriefingAnalysisLimitation[];
  /** Internal supporting record refs; bounded and excluded from model input. */
  evidenceRefs: readonly string[];
  observedAt: string;
  revision: string;
  expiresAt: string;
}>;

export type BriefingAnalysisResult = Readonly<{
  version: typeof BRIEFING_ANALYSIS_VERSION;
  lanes: readonly BriefingAnalysisLaneResult[];
  findings: readonly BriefingFinding[];
}>;
