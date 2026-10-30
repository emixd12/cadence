import type {
  AdvisorCalendarInterval,
  AdvisorCalendarConnectorV1_1,
  AdvisorDayContextV1,
} from "./advisor-day-context";

export const BRIEFING_PLAN_VERSION = "1.1" as const;
export const BRIEFING_PLAN_LIMITS = Object.freeze({
  alternatives: 3,
  dayEvidenceFindings: 32,
  movableOccurrences: 32,
  windowsPerOccurrence: 8,
  totalWindows: 64,
  candidatesPerOccurrence: 1_024,
});

type AdvisorTimedInterval = Extract<AdvisorCalendarInterval, { kind: "timed" }>;

export type BriefingPlanInterval = Omit<AdvisorTimedInterval, "duration"> & Readonly<{
  duration: Readonly<{ kind: "known"; seconds: number }>;
}>;

export type BriefingPlanSuggestionType = "recap" | "priority" | "schedule";

export type BriefingPlanMovableOccurrence = Readonly<{
  occurrenceRef: string;
  /** Empty when no configured local window exists on the captured day. */
  permittedWindows: readonly BriefingPlanInterval[];
  durationAssumption?: Readonly<{
    seconds: number;
    reason: string;
  }>;
}>;

export type BriefingPlanInput = Readonly<{
  context: AdvisorDayContextV1;
  /**
   * Separately disclosed Outlook or iCloud sources (Ticket 239). Their events
   * are fixed commitments, and each must be current and complete before any
   * scheduling option or feasible opportunity is claimed. Recorded workout
   * activity is never a planner input.
   */
  additionalCalendars?: readonly AdvisorCalendarConnectorV1_1[];
  now: string;
  configurationRevision: string;
  alternatives: number;
  allowedSuggestionTypes: readonly BriefingPlanSuggestionType[];
  fixedCommitmentsComplete: boolean;
  /** Shared configured windows used for evidence, independent of move permission. */
  permittedWindows?: readonly BriefingPlanInterval[];
  movableOccurrences: readonly BriefingPlanMovableOccurrence[];
  policy: Readonly<{
    bufferMinutes: number;
    preference: "earliest" | "least_change";
    /**
     * Recipe 1.2: at most one option per occurrence, overlaps first, without two
     * chosen times colliding. Absent or false keeps the pooled ranking.
     */
    onePerOccurrence?: boolean;
    /**
     * Recipe 1.2: range-scheduled occurrences are windows, so they neither block
     * moves nor form overlaps; occurrences with unknown length block nothing.
     */
    flexibleSchedules?: boolean;
  }>;
}>;

export type BriefingDayEvidenceCalendarFreshness =
  | "current_complete"
  | "current_partial"
  | "stale"
  | "missing";

export type BriefingDayEvidenceAssumption =
  | Readonly<{
      kind: "duration";
      occurrenceRef: string;
      source: "context_estimate";
      seconds: number;
      reason: string;
    }>
  | Readonly<{
      kind: "reserved_range";
      occurrenceRef: string;
      interval: BriefingPlanInterval;
    }>
  | Readonly<{
      kind: "buffer";
      seconds: number;
    }>;

export type BriefingOverlapParticipant = Readonly<{
  ref: string;
  source: "occurrence" | "calendar_event";
  interval: BriefingPlanInterval;
  /** The overlap covers all of this side, its start, its end, or a span in its middle. */
  part: "all" | "start" | "end" | "middle";
}>;

type BriefingDayEvidenceFindingBase = Readonly<{
  id: string;
  rank: number;
  refs: Readonly<{
    occurrenceRefs: readonly string[];
    calendarEventRefs: readonly string[];
  }>;
  assumptions: readonly BriefingDayEvidenceAssumption[];
  freshness: BriefingDayEvidenceCalendarFreshness;
}>;

export type BriefingDayEvidenceFinding =
  | (BriefingDayEvidenceFindingBase & Readonly<{
      kind: "known_overlap";
      interval: BriefingPlanInterval;
      /** Both sides of the overlap and which part of each one it covers. */
      participants: readonly BriefingOverlapParticipant[];
    }>)
  | (BriefingDayEvidenceFindingBase & Readonly<{
      kind: "tight_transition";
      interval: BriefingPlanInterval;
      availableSeconds: number;
      requiredBufferSeconds: number;
    }>)
  | (BriefingDayEvidenceFindingBase & Readonly<{
      kind: "feasible_opportunity";
      occurrenceRef: string;
      interval: BriefingPlanInterval;
      permittedWindow: BriefingPlanInterval;
      hypotheticalMoveRequired: boolean;
    }>)
  | (BriefingDayEvidenceFindingBase & Readonly<{
      kind: "unknown_feasibility";
      occurrenceRef: string;
      reasons: readonly (
        | "duration_unknown"
        | "calendar_missing"
        | "calendar_stale"
        | "calendar_incomplete"
        | "fixed_commitments_incomplete"
        | "unknown_blocker_end"
        | "no_permitted_window"
      )[];
    }>);

export type BriefingDayEvidence = Readonly<{
  coverage: Readonly<{
    cadence: "complete" | "partial";
    calendar: BriefingDayEvidenceCalendarFreshness;
    canClaimFeasibleOpportunities: boolean;
  }>;
  freshness: Readonly<{
    capturedAt: string;
    expiresAt: string;
    calendarFetchedAt: string | null;
  }>;
  findings: readonly BriefingDayEvidenceFinding[];
  omittedFindingCount: number;
}>;

export type BriefingPlanRejectionCode =
  | "calendar_missing"
  | "calendar_not_current"
  | "candidate_limit_exceeded"
  | "context_expired"
  | "context_not_yet_valid"
  | "context_partial"
  | "duration_unknown"
  | "fixed_commitments_incomplete"
  | "no_allowed_suggestion"
  | "no_change_needed"
  | "no_feasible_window"
  | "occurrence_not_found"
  | "occurrence_not_unresolved";

export type BriefingPlanRejection = Readonly<{
  occurrenceRef: string | null;
  code: BriefingPlanRejectionCode;
  reason: string;
}>;

export type BriefingPlanOption = Readonly<{
  id: string;
  occurrenceRef: string;
  intervals: Readonly<{
    current: BriefingPlanInterval;
    proposed: BriefingPlanInterval;
  }>;
  assumptions: readonly Readonly<{
    kind: "duration";
    source: "context_estimate" | "explicit_input";
    seconds: number;
    reason: string;
  }>[];
  constraints: Readonly<{
    permittedWindow: BriefingPlanInterval;
    bufferBeforeSeconds: number;
    bufferAfterSeconds: number;
    calendarEventRefs: readonly string[];
    fixedOccurrenceRefs: readonly string[];
  }>;
  reasons: readonly (
    | "current_interval_conflicts"
    | "earliest_feasible"
    | "least_change_feasible"
  )[];
}>;

export type BriefingPlanResult = Readonly<{
  version: typeof BRIEFING_PLAN_VERSION;
  route:
    | "recap"
    | "priority_suggestions"
    | "scheduling_options"
    | "insufficient_context";
  outcome: "options" | "no_change" | "no_feasible_option" | "not_requested";
  generatedAt: string;
  expiresAt: string;
  revisions: Readonly<{
    configuration: string;
    snapshot: string;
    cadence: string;
    grantGeneration: number;
    calendar: Readonly<{
      connectionGeneration: number;
      selectionRevision: number;
      schemaVersion: string;
      adapterVersion: string;
    }> | null;
  }>;
  dayEvidence: BriefingDayEvidence;
  options: readonly BriefingPlanOption[];
  rejections: readonly BriefingPlanRejection[];
}>;
