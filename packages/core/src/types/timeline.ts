import type { BehaviorDurationEstimate } from "./day-progress";

export type TimelineStatus = "unresolved" | "completed" | "not_completed";

export type TimelineOccurrenceInput = {
  id: string;
  behaviorId: string;
  title: string;
  description: string;
  categoryName: string;
  scheduleSummary: string;
  scheduledFor: string;
  scheduledTimeLabel: string;
  /** Ticket 261: schedule facts for the Behavior's end. Optional so older views stay valid. */
  scheduleKind?: "exact" | "range";
  scheduleEndTime?: string | null;
  localDate: string;
  status: TimelineStatus;
  statusMarkedAt: string | null;
  note: string;
  timeTracking: TimelineTimeTrackingView;
  canStartTimeTracking: boolean;
};

export type TimelineTimeTrackingView = Readonly<{
  recordedSeconds: number;
  runningStartedAt: string | null;
}>;

export type TimelineVisualTone =
  | "default"
  | "needs_decision"
  | "completed"
  | "not_completed";

export type TimelineOccurrenceView = {
  id: string;
  behaviorId: string;
  title: string;
  scheduledFor: string;
  scheduledTimeLabel: string;
  /** Ticket 261: schedule facts for the Behavior's end. Optional so older views stay valid. */
  scheduleKind?: "exact" | "range";
  scheduleEndTime?: string | null;
  localDate: string;
  status: TimelineStatus;
  statusMarkedAt: string | null;
  statusLabel: string;
  statusDetail: string;
  expandedStatusActionLabel: string;
  visualTone: TimelineVisualTone;
  isVisibleInNeedsDecision: boolean;
  canShowDecisionActionsWhenUnresolved: boolean;
  showDecisionActions: boolean;
  showCollapsedStatusLabel: boolean;
  description: string;
  categoryName: string;
  scheduleSummary: string;
  note: string;
  timeTracking: TimelineTimeTrackingView;
  canStartTimeTracking: boolean;
};

export type TimelineDaySectionKind = "today" | "future" | "needs_decision_day";

export type TimelineOccurrenceGroup = {
  key: string;
  behaviorId: string;
  title: string;
  occurrences: TimelineOccurrenceView[];
  isGroupedStack: boolean;
};

export type TimelineDaySection = {
  key: string;
  kind: TimelineDaySectionKind;
  localDate: string;
  label: string;
  relativeLabel: string;
  emptyMessage: string;
  occurrences: TimelineOccurrenceView[];
  unresolvedOccurrenceCount: number;
  occurrenceGroups: TimelineOccurrenceGroup[];
};

export type TimelineNeedsDecisionGroup = {
  title: string;
  emptyMessage: string;
  occurrenceCount: number;
  daySections: TimelineDaySection[];
};

export type TimelineView = {
  archiveNotifications?: Array<{ behaviorId: string; title: string; endDate: string | null }>;
  durationEstimates?: Record<string, BehaviorDurationEstimate>;
  timezone: string;
  todayLocalDate: string;
  visibleFutureDays: number;
  maxFutureDays: number;
  nextFutureDays: number | null;
  needsDecision: TimelineNeedsDecisionGroup;
  daySections: TimelineDaySection[];
};

export type OccurrenceActionField = "occurrence_id" | "status" | "note";

export type OccurrenceActionState = {
  status: "idle" | "success" | "error";
  message: string;
  nextStatus?: TimelineStatus;
  fieldErrors?: Partial<Record<OccurrenceActionField, string>>;
};


export type TimeTrackingActionState = Readonly<{
  status: "idle" | "success" | "error";
  message: string;
  tracking?: TimelineTimeTrackingView;
  requestId?: string;
}>;
