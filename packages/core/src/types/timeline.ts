import type { OccurrenceOrigin, OpportunityAddedBy } from "./database";
import type { BehaviorWhereKind } from "./behavior";
import type { BehaviorDurationEstimate } from "./day-progress";
import type { NoticeId } from "../notices";
import type { ParentSlotRollup } from "./sub-behavior";

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
  /**
   * Advisor plan, Phase 2: the planned time label when a per-day move places this
   * Occurrence elsewhere today. The row's time and time label are then the moved
   * (effective) time. Absent when the Occurrence sits at its planned time.
   */
  movedFromLabel?: string;
  /**
   * Advisor plan, Phase 2C: the Occurrence's `updated_at`, sent back as the expected
   * revision when the web moves or undoes it. Absent where moves are read only (Mac).
   */
  revision?: string;
  /** Ticket 261: schedule facts for the Behavior's end. Optional so older views stay valid. */
  scheduleKind?: "exact" | "range";
  scheduleEndTime?: string | null;
  /**
   * Ticket 271: the Behavior's own place text when Where is A place, for a Directions link.
   * Absent otherwise. Source-authored text only; never route content.
   */
  placeText?: string;
  /**
   * The Behavior's Where when it is Home or A place, so the travel source key changes when a
   * Behavior's place is edited. Absent otherwise.
   */
  whereKind?: "home" | "place";
  localDate: string;
  status: TimelineStatus;
  statusMarkedAt: string | null;
  note: string;
  timeTracking: TimelineTimeTrackingView;
  canStartTimeTracking: boolean;
  /** Behaviors of Opportunity. Missing means "scheduled". */
  origin?: OccurrenceOrigin;
  addedBy?: OpportunityAddedBy | null;
  /** Remove facts. Unknown status history counts as history, so Remove stays hidden. */
  hasStatusHistory?: boolean;
  hasActiveSourceMatch?: boolean;
  /**
   * True when any time session row exists, even a zero-length one. Missing falls back to
   * the recorded time, which misses zero-length sessions.
   */
  hasTimeSessions?: boolean;
  /** Sub-behaviors (depth 1): set on a sub-behavior's Occurrence. Absent on standalone rows. */
  parentBehaviorId?: string | null;
  parentTitle?: string;
  subBehaviorSortOrder?: number;
  /**
   * Groups sub-behavior rows into one parent slot. Defaults to `scheduledFor`, so rows that
   * share the parent's time on a day form one group.
   */
  parentSlotKey?: string;
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
  /**
   * Advisor plan, Phase 2: the planned time label when a per-day move places this
   * Occurrence elsewhere today. The row's time and time label are then the moved
   * (effective) time. Absent when the Occurrence sits at its planned time.
   */
  movedFromLabel?: string;
  /**
   * Advisor plan, Phase 2C: the Occurrence's `updated_at`, sent back as the expected
   * revision when the web moves or undoes it. Absent where moves are read only (Mac).
   */
  revision?: string;
  /** Ticket 261: schedule facts for the Behavior's end. Optional so older views stay valid. */
  scheduleKind?: "exact" | "range";
  scheduleEndTime?: string | null;
  /** Ticket 271: see `TimelineOccurrenceInput.placeText`. */
  placeText?: string;
  /** See `TimelineOccurrenceInput.whereKind`. */
  whereKind?: "home" | "place";
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
  /** Tickets 317 and 319: what a connected service contributed. Absent when nothing did. */
  sourceEvidence?: TimelineSourceEvidence;
  /**
   * Ticket 324: connected sources whose workouts this Occurrence may count by hand. Set
   * only on today's Unresolved rows whose Behavior has no enabled link to the source,
   * while no any-workout link exists for it. Absent otherwise.
   */
  sourceCountable?: readonly string[];
  /**
   * Behaviors of Opportunity: "scheduled" unless the row was added from the pool. The
   * resolver always sets these three; they are optional so hand-built views stay valid.
   */
  origin?: OccurrenceOrigin;
  addedBy?: OpportunityAddedBy | null;
  /** A clean added row can be removed, from Today or from Needs decision. */
  canRemove?: boolean;
  /** Sub-behaviors (depth 1): set on a sub-behavior's Occurrence. Absent on standalone rows. */
  parentBehaviorId?: string | null;
  parentTitle?: string;
  subBehaviorSortOrder?: number;
  /**
   * Groups sub-behavior rows into one parent slot. Defaults to `scheduledFor`, so rows that
   * share the parent's time on a day form one group.
   */
  parentSlotKey?: string;
};

export type TimelineSourceEvidence = Readonly<{
  source: string;
  sourceLabel: string;
  /** True while the connector's own status event is the latest and the row is Completed. */
  fromConnector: boolean;
  /** Active matches, oldest first; empty on the Mac until Ticket 320. */
  workouts: readonly Readonly<{ startAt: string; endAt: string; label: string }>[];
}>;

export type TimelineDaySectionKind = "today" | "future" | "needs_decision_day";

export type TimelineOccurrenceGroup = {
  key: string;
  behaviorId: string;
  title: string;
  occurrences: TimelineOccurrenceView[];
  isGroupedStack: boolean;
};

/** One parent slot on one day: the sub-behavior rows scheduled together. */
export type TimelineParentGroupView = {
  key: string;
  parentBehaviorId: string;
  title: string;
  localDate: string;
  /** Earliest child time in the slot. */
  scheduledFor: string;
  scheduledTimeLabel: string;
  /** Sub-behavior rows in sibling order. */
  children: TimelineOccurrenceView[];
  rollup: ParentSlotRollup;
  visualTone: TimelineVisualTone;
  /** True when any child row shows Completed and Not Completed actions. */
  showDecisionActions: boolean;
  isVisibleInNeedsDecision: boolean;
};

/** A day's rows in time order: standalone Behavior groups and parent slots. */
export type TimelineDayRow =
  | { kind: "behavior"; key: string; group: TimelineOccurrenceGroup }
  | { kind: "parent"; key: string; group: TimelineParentGroupView };

export type TimelineDaySection = {
  key: string;
  kind: TimelineDaySectionKind;
  localDate: string;
  label: string;
  relativeLabel: string;
  emptyMessage: string;
  occurrences: TimelineOccurrenceView[];
  unresolvedOccurrenceCount: number;
  /** Standalone Behaviors only; sub-behavior rows sit in `parentGroups`. */
  occurrenceGroups: TimelineOccurrenceGroup[];
  parentGroups: TimelineParentGroupView[];
  rows: TimelineDayRow[];
};

export type TimelineNeedsDecisionGroup = {
  title: string;
  emptyMessage: string;
  occurrenceCount: number;
  daySections: TimelineDaySection[];
};

export type BehaviorRunNotice = {
  behaviorId: string;
  title: string;
  /** ended: "Run ended. Start again". paused: "Run is paused, back Dec 8". back: "Run is back today". */
  kind: "ended" | "paused" | "back";
  /** The back-on day of a pause. */
  backOn: string | null;
  /** The Behavior's revision, sent as expected_updated_at by the notice's Start again or Resume now. */
  updatedAt: string;
};

/** One Behavior in today's opportunity pool, for the Timeline's Opportunity Basket. */
export type TimelineOpportunityPoolItem = Readonly<{
  behaviorId: string;
  title: string;
  categoryName: string;
  defaultDurationMinutes: number | null;
  whereKind: BehaviorWhereKind | null;
  locationText: string | null;
  /** True when the Behavior already has an Occurrence on today's Timeline. */
  onToday: boolean;
  /** The default start: now rounded up to 5 minutes, or the nearest free start among today's items. */
  suggestedStart: Readonly<{ startsAt: string; localTime: string; source: "now" | "free_slot" }>;
  /** The length used for the suggestion, in minutes. */
  lengthMinutes: number;
}>;

export type TimelineView = {
  /** Behaviors of Opportunity: today's pool, in title order. Absent where not resolved. */
  opportunityPool?: TimelineOpportunityPoolItem[];
  /** Ended, paused and back-today notices for today (T7). Derived from fields; nothing is stored. */
  runNotices?: BehaviorRunNotice[];
  durationEstimates?: Record<string, BehaviorDurationEstimate>;
  timezone: string;
  todayLocalDate: string;
  visibleFutureDays: number;
  maxFutureDays: number;
  nextFutureDays: number | null;
  needsDecision: TimelineNeedsDecisionGroup;
  daySections: TimelineDaySection[];
  /** Saved day notes by local date for the dates this view shows (Ticket 292). */
  dayNotes?: Record<string, string>;
};

export type OccurrenceActionField = "occurrence_id" | "status" | "note";

export type OccurrenceActionState = {
  status: "idle" | "success" | "error";
  message: string;
  nextStatus?: TimelineStatus;
  fieldErrors?: Partial<Record<OccurrenceActionField, string>>;
};


/**
 * Behaviors of Opportunity: the result of adding, logging Done now or removing an added
 * item. `noticeId` names an `opportunity.*` notice; show it with its params.
 */
export type OpportunityActionState =
  | Readonly<{ status: "idle" }>
  | Readonly<{
    status: "added" | "logged" | "removed";
    occurrenceId: string;
    noticeId: string;
    noticeParams: Readonly<Record<string, string | number>>;
  }>
  | Readonly<{
    status: "refused";
    reason: "not_available" | "not_running" | "not_today" | "invalid_time" | "marked" | "kept" | "not_found";
    noticeId: string;
    noticeParams: Readonly<Record<string, string | number>>;
  }>
  | Readonly<{ status: "error"; noticeId: "opportunity.failed" }>;

export type TimeTrackingActionState = Readonly<{
  status: "idle" | "success" | "error";
  message: string;
  tracking?: TimelineTimeTrackingView;
  requestId?: string;
}>;

export type DefaultDurationActionState = Readonly<{
  status: "idle" | "success" | "error";
  message: string;
  noticeId?: NoticeId;
  minutes?: number;
}>;
