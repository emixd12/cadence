import type { OccurrenceOrigin } from "./database";
export type AnalyticsStatus = "unresolved" | "completed" | "not_completed";

export type AnalyticsRangeDays = 7 | 30 | 90;

export type AnalyticsOccurrenceInput = {
  id: string;
  behaviorId: string;
  behaviorTitle: string;
  behaviorActive?: boolean;
  behaviorCreatedAt: string;
  categoryName: string;
  scheduledFor: string;
  scheduledTimeLabel: string;
  localDate: string;
  status: AnalyticsStatus;
  note: string;
  timezone: string;
  /** Behaviors of Opportunity. Missing means "scheduled". Adherence reads scheduled rows only. */
  origin?: OccurrenceOrigin;
  /** Sub-behaviors (depth 1): set on a sub-behavior's Occurrence. */
  parentBehaviorId?: string | null;
  parentBehaviorTitle?: string | null;
  subBehaviorSortOrder?: number;
};

export type AnalyticsTimeSessionInput = {
  id: string;
  userId: string;
  occurrenceId: string;
  behaviorId: string;
  startedAt: string;
  stoppedAt: string | null;
};

export type AnalyticsTrackedTime = {
  recordedSeconds: number;
  durationLabel: string;
  hasRecordedTime: boolean;
  isInProgress: boolean;
};

export type AnalyticsAverageTrackedTime = {
  averageSeconds: number;
  durationLabel: string;
  timedOccurrenceCount: number;
};

export type AnalyticsStatusCounts = {
  completedCount: number;
  notCompletedCount: number;
  unresolvedCount: number;
  resolvedCount: number;
  totalCount: number;
};

export type AnalyticsAdherence = {
  rate: number | null;
  percentLabel: string;
  detailLabel: string;
};

/**
 * Behaviors of Opportunity: added Occurrences, counted apart from adherence. The label
 * is "Done N times" when any was Completed, otherwise null.
 */
export type AnalyticsOpportunityCounts = {
  /** The resolver always sets these; optional so hand-built summaries stay valid. */
  opportunityCompletedCount?: number;
  opportunityNotCompletedCount?: number;
  opportunityDoneLabel?: string | null;
};

/** Status counts and adherence cover scheduled Occurrences; the unresolved count also holds added ones in Needs decision. */
export type AnalyticsSummary = AnalyticsStatusCounts & AnalyticsAdherence & AnalyticsOpportunityCounts;

export type AnalyticsOverallDayState =
  | "empty"
  | "completed"
  | "partial"
  | "not_completed"
  | "unresolved";

export type AnalyticsBehaviorDayState =
  | "empty"
  | "full"
  | "partial"
  | "not_completed"
  | "unresolved";

export type AnalyticsDayCell = {
  key: string;
  localDate: string;
  label: string;
  shortLabel: string;
  isSelected: boolean;
  state: AnalyticsOverallDayState;
  stateLabel: string;
  completionRate: number | null;
  counts: AnalyticsStatusCounts;
  ariaLabel: string;
};

export type AnalyticsBehaviorDayCell = {
  key: string;
  localDate: string;
  label: string;
  shortLabel: string;
  state: AnalyticsBehaviorDayState;
  stateLabel: string;
  isSelected: boolean;
  isTrackingStart: boolean;
  counts: AnalyticsStatusCounts;
  ariaLabel: string;
};

/** Counts and adherence cover scheduled Occurrences; day cells show every Occurrence. */
export type AnalyticsBehaviorSummary = AnalyticsStatusCounts &
  AnalyticsAdherence & AnalyticsOpportunityCounts & {
    behaviorId: string;
    title: string;
    categoryName: string;
    trackingStartLocalDate: string;
    trackingStartLabel: string;
    averageTrackedTime: AnalyticsAverageTrackedTime | null;
    dailyCells: AnalyticsBehaviorDayCell[];
    /** Ticket 318: timing from connector source matches; absent without matches. */
    connectorTiming?: AnalyticsConnectorTiming | null;
  };

export type AnalyticsConnectorTiming = Readonly<{
  matchedCount: number;
  onTimeCount: number;
  /** Median of activity start minus scheduled start, in whole minutes. */
  medianOffsetMinutes: number;
  label: string;
}>;

/** Parent slots by derived state. A slot is one parent, day and time. */
export type AnalyticsParentSlotCounts = {
  totalSlots: number;
  completedSlots: number;
  partialSlots: number;
  notCompletedSlots: number;
  unresolvedSlots: number;
};

/**
 * Rolled-up progress of one parent Behavior: its sub-behaviors' Occurrences plus its own
 * Occurrences from before it had sub-behaviors. Each Occurrence counts once.
 */
export type AnalyticsParentSummary = AnalyticsStatusCounts &
  AnalyticsAdherence & {
    parentBehaviorId: string;
    title: string;
    categoryName: string;
    /** Sub-behaviors seen in range, in sibling order. Their own summaries sit in `behaviorSummaries`. */
    subBehaviorIds: string[];
    slotCounts: AnalyticsParentSlotCounts;
    dailyCells: AnalyticsBehaviorDayCell[];
  };

export type AnalyticsCategorySummary = AnalyticsStatusCounts &
  AnalyticsAdherence & AnalyticsOpportunityCounts & {
    categoryName: string;
  };

export type AnalyticsSelectedDayOccurrence = {
  id: string;
  behaviorId: string;
  title: string;
  categoryName: string;
  scheduledFor: string;
  scheduledTimeLabel: string;
  status: AnalyticsStatus;
  statusLabel: string;
  note: string;
  trackedTime: AnalyticsTrackedTime | null;
};

export type AnalyticsSelectedBehaviorDay = {
  behaviorId: string;
  behaviorTitle: string;
  localDate: string;
  label: string;
  occurrences: AnalyticsSelectedDayOccurrence[];
};

export type AnalyticsView = {
  timezone: string;
  rangeDays: AnalyticsRangeDays;
  rangeOptions: AnalyticsRangeDays[];
  rangeStartLocalDate: string;
  rangeEndLocalDate: string;
  rangeLabel: string;
  summary: AnalyticsSummary;
  overallHeatmap: AnalyticsDayCell[];
  behaviorSummaries: AnalyticsBehaviorSummary[];
  parentSummaries: AnalyticsParentSummary[];
  categorySummaries: AnalyticsCategorySummary[];
  selectedBehaviorDay: AnalyticsSelectedBehaviorDay | null;
};
