import type {
  AdvisorCalendarConnector,
  AdvisorCalendarNotRequested,
  AdvisorCompletionHistory,
  AdvisorHistoricalCompletionTimes,
  AdvisorDuration,
} from "./advisor-day-context";
import type { BriefingAnalysisLaneId } from "./briefing-analysis";

export const BRIEFING_CONFIG_VERSION = "1.3" as const;
export const LEGACY_BRIEFING_CONFIG_VERSION = "1.0" as const;
export const DAILY_BRIEF_RECIPE = Object.freeze({ id: "daily_brief", version: "1.0" } as const);

export type BriefingTone = "calm" | "warm" | "matter_of_fact";
export type BriefingDirectness = "gentle" | "balanced" | "direct";
export type BriefingEncouragement = "low" | "moderate" | "high";
export type BriefingPriority = "today_status" | "needs_decision" | "completion_history" | "schedule_fit";
export type BriefingSuggestionType = "recap" | "priority" | "schedule";
export type BriefingDurationSource = "configured_default" | "historical_average";

export type BriefingContextConfig = Readonly<{
  includeCompletionHistory: boolean;
  includeHistoricalCompletionTimes: boolean;
  includeRecordedElapsedDurations: boolean;
  duration: Readonly<{
    includeHistoricalAverage: boolean;
    includeConfiguredDefault: boolean;
    preference: BriefingDurationSource;
    fallback: "other_enabled_source" | "none";
  }>;
}>;

/**
 * Analysis lane selection (Tickets 169–173). Selecting a lane never grants its
 * source: optional reminder and Note lanes also need the account's disclosure.
 */
export type BriefingAnalysisConfig = Readonly<{
  lanes: readonly BriefingAnalysisLaneId[];
  /** A ceiling, not a quota: at most one pattern tip per brief. */
  maxTips: 0 | 1;
  /** Local days before the same finding fingerprint may appear again. */
  cooldownDays: number;
}>;

export type BriefingConfigV1 = Readonly<{
  version: typeof BRIEFING_CONFIG_VERSION;
  recipe: typeof DAILY_BRIEF_RECIPE;
  tone: BriefingTone;
  directness: BriefingDirectness;
  encouragement: BriefingEncouragement;
  length: Readonly<{ maxWords: number }>;
  priorities: readonly BriefingPriority[];
  allowedSuggestionTypes: readonly BriefingSuggestionType[];
  alternatives: number;
  scope: Readonly<{
    behaviorRefs: "all" | readonly string[];
    historyDays: number;
    includeCalendar: boolean;
  }>;
  context: BriefingContextConfig;
  analysis: BriefingAnalysisConfig;
  referenceIds: readonly string[];
  planner: Readonly<{
    bufferMinutes: number;
    preference: "earliest" | "least_change";
    movableBehaviorRefs: readonly string[];
    permittedWindows: readonly Readonly<{
      startMinute: number;
      endMinute: number;
    }>[];
  }>;
}>;

export type BriefingConfig = BriefingConfigV1;

export type BriefingPreset = Readonly<{
  id: string;
  label: string;
  config: BriefingConfig;
}>;

export type BriefingModelOccurrence = Readonly<{
  ref: string;
  behaviorRef: string;
  title: string;
  localDate: string;
  scheduledFor: string;
  schedule: Readonly<{ kind: "exact" | "range"; startTime: string; endTime: string | null }>;
  duration?: AdvisorDuration;
}>;

export type BriefingModelFacts = Readonly<{
  version: "1.0";
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
  cadence: Readonly<{
    observedAt: string;
    revision: string;
    coverage: "complete";
    occurrences: BriefingModelOccurrence[];
    history?: AdvisorCompletionHistory;
    historicalCompletionTimes?: AdvisorHistoricalCompletionTimes;
    recordedElapsedDurations?: readonly Readonly<{
      behaviorRef: string;
      localDate: string;
      seconds: number;
    }>[];
  }>;
  connectors?: Array<AdvisorCalendarConnector | AdvisorCalendarNotRequested>;
}>;

export type BriefingContextControlState = Readonly<{
  requested: boolean;
  included: boolean;
  availability: "available" | "unavailable" | "unsupported";
  reason: "not_requested" | "source_unavailable" | null;
}>;

export type BriefingContextControls = Readonly<{
  calendar: BriefingContextControlState;
  completionHistory: BriefingContextControlState;
  historicalCompletionTimes: BriefingContextControlState;
  recordedElapsedDurations: BriefingContextControlState;
  duration: Readonly<{
    preference: BriefingDurationSource;
    fallback: "other_enabled_source" | "none";
    configuredDefault: Readonly<{ requested: boolean }>;
    historicalAverage: Readonly<{ requested: boolean }>;
    selections: readonly Readonly<{
      behaviorRef: string;
      source: BriefingDurationSource | null;
      sampleCount: number;
      reason: "disabled" | "insufficient_samples" | "history_limit_exceeded" | "unavailable" | null;
    }>[];
  }>;
}>;

export type BriefingContextProjection = Readonly<{
  facts: BriefingModelFacts;
  contextControls: BriefingContextControls;
}>;
