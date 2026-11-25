import type { TravelFitConclusion, TravelMode } from "./travel";

export const CHAT_TRAVEL_MODEL_VERSION = "1.0" as const;

export type ChatTravelDaypartBucket =
  | "early_morning"
  | "morning"
  | "midday"
  | "afternoon"
  | "evening"
  | "late_evening";

/**
 * Coarse daypart free-window hint safe to send to an LLM (`docs/LEGAL.md` L-001).
 * Never carries exact route-derived minutes, leave-by timestamps, or addresses.
 */
export type ChatTravelFreeWindowBucket = Readonly<{
  bucket: ChatTravelDaypartBucket;
  label: string;
}>;

export type ChatTravelBehaviorFitStatus = TravelFitConclusion | "tight";

export type ChatTravelBehaviorFit = Readonly<{
  occurrenceRef: string;
  behaviorId: string;
  status: ChatTravelBehaviorFitStatus;
  basis:
    | "travel_known"
    | "travel_overlap"
    | "late_arrival"
    | "travel_unknown"
    | "duration_unknown";
  flexible: boolean;
}>;

/** Confirmed cross-day move candidate for a flexible Behavior on a heavy/conflicting travel day. */
export type CrossDayRescheduleCandidate = Readonly<{
  occurrenceRef: string;
  behaviorId: string;
  fromLocalDate: string;
  suggestedLocalDate: string;
  suggestedBucket: ChatTravelDaypartBucket;
  reason: "heavy_travel_day" | "travel_conflict" | "tight_schedule";
  requiresConfirmation: true;
}>;

/** Confirmed recurring schedule remodeling suggestion derived from longitudinal first-party signals. */
export type RecurringRemodelSuggestion = Readonly<{
  behaviorId: string;
  pattern:
    | "recurring_weekday_conflict"
    | "frequent_travel_shift"
    | "low_adherence_on_travel_days";
  /** ISO weekdays: 1 = Monday .. 7 = Sunday. */
  affectedWeekdays: readonly number[];
  suggestedAction: "shift_weekday" | "shift_time_window" | "mark_flexible";
  confidence: "medium" | "high";
  evidenceCount: number;
  requiresConfirmation: true;
}>;

/**
 * Deterministic per-day fit/conflict conclusions SAFE to send to an LLM (`L-001`).
 * Explicitly excludes route durations, distances, leave-by times, coordinates, and raw addresses.
 */
export type ChatTravelDayFitConclusion = Readonly<{
  localDate: string;
  heavyTravelDay: boolean;
  tripCount: number;
  hasUnknownTravel: boolean;
  behaviorFits: readonly ChatTravelBehaviorFit[];
  freeWindows: readonly ChatTravelFreeWindowBucket[];
  crossDayCandidates: readonly CrossDayRescheduleCandidate[];
}>;

/**
 * Model-facing 7-day travel horizon projection (`L-001` compliant).
 */
export type ChatTravelModelProjection = Readonly<{
  version: typeof CHAT_TRAVEL_MODEL_VERSION;
  todayLocalDate: string;
  horizonDays: number;
  days: readonly ChatTravelDayFitConclusion[];
  crossDayCandidates: readonly CrossDayRescheduleCandidate[];
}>;

/**
 * Exact structured UI travel card rendered inline beside Chat's reply by Cadence.
 * NEVER sent to the LLM (`docs/LEGAL.md` L-001).
 */
export type ChatTravelUiCard = Readonly<{
  localDate: string;
  tripLabel: string;
  destinationLabel: string;
  mode: TravelMode;
  leaveByLocalTime: string;
  durationMinutes: number;
  arrivalLocalTime: string;
  bufferMinutes: number;
  conflictSummary: string | null;
}>;

export type ChatTravelHorizonResult = Readonly<{
  modelSummary: ChatTravelModelProjection;
  uiCards: readonly ChatTravelUiCard[];
  horizonDays: number;
}>;

export type ProposalOutcomeKind = "yes" | "other_time" | "no" | "undo";

export type ProposalOutcomeSummary = Readonly<{
  yes: number;
  otherTime: number;
  no: number;
  undo: number;
  total: number;
  acceptanceRate: number | null;
}>;

export type PostTravelShiftCompletionSummary = Readonly<{
  shiftedCompleted: number;
  shiftedDecided: number;
  shiftedRate: number | null;
  baselineCompleted: number;
  baselineDecided: number;
  baselineRate: number | null;
  lift: number | null;
}>;

export type BehaviorLocationAffinity = "home" | "away" | "mixed" | "unknown";

export type BehaviorLongitudinalStats = Readonly<{
  behaviorId: string;
  trackedDurationSampleCount: number;
  trackedDurationMedianMinutes: number | null;
  trackedDurationIqrMinutes: number | null;
  locationAffinity: BehaviorLocationAffinity;
  homeCompletionCount: number;
  awayCompletionCount: number;
  proposalOutcomes: ProposalOutcomeSummary;
}>;

/** Layer 2: Indefinite Cadence-owned first-party longitudinal behavioral patterns. */
export type FirstPartyLongitudinalPatterns = Readonly<{
  provenance: "cadence_first_party";
  generatedAt: string;
  proposalOutcomes: ProposalOutcomeSummary;
  postTravelShiftCompletion: PostTravelShiftCompletionSummary;
  behaviorStats: readonly BehaviorLongitudinalStats[];
  remodelSuggestions: readonly RecurringRemodelSuggestion[];
}>;

/**
 * Layer 1: Rolling (<=30d) or ephemeral (>30d) calendar load summary.
 * Contains only numeric/enum load aggregates — never raw calendar titles, descriptions, or locations.
 */
export type LongitudinalRollingCalendarLayer = Readonly<{
  provenance: "rolling_calendar_mcp" | "ephemeral_calendar_mcp";
  ephemeral: boolean;
  windowDays: number;
  heavyDayCount: number;
  averageBusyMinutes: number;
  /** ISO weekdays (1 = Monday .. 7 = Sunday) with the highest average busy load. */
  busiestWeekdays: readonly number[];
}>;

/** Two-layer longitudinal snapshot combining Layer 1 (rolling/ephemeral calendar) and Layer 2 (first-party). */
export type LongitudinalPatternSnapshot = Readonly<{
  rollingCalendarWindow: LongitudinalRollingCalendarLayer | null;
  firstPartyPatterns: FirstPartyLongitudinalPatterns;
}>;
