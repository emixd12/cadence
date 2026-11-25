import { Temporal } from "@js-temporal/polyfill";
import type {
  BehaviorLocationAffinity,
  BehaviorLongitudinalStats,
  FirstPartyLongitudinalPatterns,
  LongitudinalPatternSnapshot,
  LongitudinalRollingCalendarLayer,
  PostTravelShiftCompletionSummary,
  ProposalOutcomeKind,
  ProposalOutcomeSummary,
  RecurringRemodelSuggestion,
} from "../types/chat-travel";

const MAX_PERSISTED_CALENDAR_WINDOW_DAYS = 30;
const RECURRING_WEEKDAY_CONFLICT_MIN_EVIDENCE = 3;
const FREQUENT_TRAVEL_SHIFT_MIN_EVIDENCE = 3;
const LOW_TRAVEL_ADHERENCE_MIN_DECIDED = 4;
const LOW_TRAVEL_ADHERENCE_MAX_RATE = 0.4;
const LOW_TRAVEL_ADHERENCE_MIN_BASELINE = 0.7;

export type LongitudinalProposalOutcomeRecord = Readonly<{
  behaviorId: string;
  localDate: string;
  outcome: ProposalOutcomeKind;
  travelMotivated: boolean;
}>;

export type LongitudinalOccurrenceOutcomeRecord = Readonly<{
  behaviorId: string;
  localDate: string;
  status: "unresolved" | "completed" | "not_completed";
  travelMotivatedShift: boolean;
  travelDay: boolean;
  trackedDurationMinutes?: number | null;
  locationLabel?: "home" | "away" | null;
}>;

export type FirstPartyLongitudinalInput = Readonly<{
  now: Temporal.Instant | string;
  proposalOutcomes: readonly LongitudinalProposalOutcomeRecord[];
  occurrences: readonly LongitudinalOccurrenceOutcomeRecord[];
}>;

export type RollingCalendarSummaryInput = Readonly<{
  windowDays: number;
  heavyDayCount: number;
  averageBusyMinutes: number;
  busiestWeekdays: readonly number[];
}>;

function toInstantIso(value: Temporal.Instant | string): string {
  return (typeof value === "string" ? Temporal.Instant.from(value) : value).toString();
}

function summarizeOutcomes(records: readonly LongitudinalProposalOutcomeRecord[]): ProposalOutcomeSummary {
  let yes = 0;
  let otherTime = 0;
  let no = 0;
  let undo = 0;
  for (const record of records) {
    if (record.outcome === "yes") yes += 1;
    else if (record.outcome === "other_time") otherTime += 1;
    else if (record.outcome === "no") no += 1;
    else if (record.outcome === "undo") undo += 1;
  }
  const total = yes + otherTime + no + undo;
  return {
    yes,
    otherTime,
    no,
    undo,
    total,
    acceptanceRate: total > 0 ? round4((yes + otherTime) / total) : null,
  };
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1];
  if (next === undefined) return sorted[base];
  return sorted[base] + rest * (next - sorted[base]);
}

function computeLocationAffinity(homeCount: number, awayCount: number): BehaviorLocationAffinity {
  const total = homeCount + awayCount;
  if (total === 0) return "unknown";
  if (homeCount / total >= 0.7) return "home";
  if (awayCount / total >= 0.7) return "away";
  return "mixed";
}

/**
 * Computes Layer 2 (indefinite Cadence-owned first-party longitudinal behavioral patterns):
 * - Proposal outcome rates (Yes / Other / No / Undo) overall and per Behavior
 * - Completion rate following travel-motivated shifts vs. baseline
 * - Per-Behavior tracked duration medians/IQR spreads and Home vs. away location affinity
 * - Confirmed recurring schedule-remodeling suggestions
 */
export function resolveFirstPartyLongitudinalPatterns(
  input: FirstPartyLongitudinalInput,
): FirstPartyLongitudinalPatterns {
  const generatedAt = toInstantIso(input.now);
  const overallProposals = summarizeOutcomes(input.proposalOutcomes);

  let shiftedCompleted = 0;
  let shiftedDecided = 0;
  let baselineCompleted = 0;
  let baselineDecided = 0;

  const behaviorIds = new Set<string>();
  const proposalsByBehavior = new Map<string, LongitudinalProposalOutcomeRecord[]>();
  const occurrencesByBehavior = new Map<string, LongitudinalOccurrenceOutcomeRecord[]>();

  for (const proposal of input.proposalOutcomes) {
    behaviorIds.add(proposal.behaviorId);
    const list = proposalsByBehavior.get(proposal.behaviorId) ?? [];
    list.push(proposal);
    proposalsByBehavior.set(proposal.behaviorId, list);
  }

  for (const occ of input.occurrences) {
    behaviorIds.add(occ.behaviorId);
    const list = occurrencesByBehavior.get(occ.behaviorId) ?? [];
    list.push(occ);
    occurrencesByBehavior.set(occ.behaviorId, list);

    if (occ.status === "unresolved") continue;
    if (occ.travelMotivatedShift) {
      shiftedDecided += 1;
      if (occ.status === "completed") shiftedCompleted += 1;
    } else {
      baselineDecided += 1;
      if (occ.status === "completed") baselineCompleted += 1;
    }
  }

  const shiftedRate = shiftedDecided > 0 ? round4(shiftedCompleted / shiftedDecided) : null;
  const baselineRate = baselineDecided > 0 ? round4(baselineCompleted / baselineDecided) : null;
  const postTravelShiftCompletion: PostTravelShiftCompletionSummary = {
    shiftedCompleted,
    shiftedDecided,
    shiftedRate,
    baselineCompleted,
    baselineDecided,
    baselineRate,
    lift: shiftedRate !== null && baselineRate !== null ? round4(shiftedRate - baselineRate) : null,
  };

  const sortedBehaviorIds = Array.from(behaviorIds).sort();
  const behaviorStats: BehaviorLongitudinalStats[] = [];
  const remodelSuggestions: RecurringRemodelSuggestion[] = [];

  for (const behaviorId of sortedBehaviorIds) {
    const behProposals = proposalsByBehavior.get(behaviorId) ?? [];
    const behOccurrences = occurrencesByBehavior.get(behaviorId) ?? [];

    const durations: number[] = [];
    let homeCompletionCount = 0;
    let awayCompletionCount = 0;

    const weekdayConflictCounts = new Map<number, number>();
    let travelDayCompleted = 0;
    let travelDayDecided = 0;
    let nonTravelDayCompleted = 0;
    let nonTravelDayDecided = 0;

    for (const occ of behOccurrences) {
      if (
        typeof occ.trackedDurationMinutes === "number" &&
        Number.isFinite(occ.trackedDurationMinutes) &&
        occ.trackedDurationMinutes > 0
      ) {
        durations.push(occ.trackedDurationMinutes);
      }

      if (occ.status === "completed") {
        if (occ.locationLabel === "home") homeCompletionCount += 1;
        else if (occ.locationLabel === "away") awayCompletionCount += 1;
      }

      if (occ.status !== "unresolved") {
        if (occ.travelDay) {
          travelDayDecided += 1;
          if (occ.status === "completed") travelDayCompleted += 1;
        } else {
          nonTravelDayDecided += 1;
          if (occ.status === "completed") nonTravelDayCompleted += 1;
        }
      }

      if (occ.travelMotivatedShift || (occ.travelDay && occ.status === "not_completed")) {
        const weekday = Temporal.PlainDate.from(occ.localDate).dayOfWeek;
        weekdayConflictCounts.set(weekday, (weekdayConflictCounts.get(weekday) ?? 0) + 1);
      }
    }

    durations.sort((a, b) => a - b);
    const trackedDurationMedianMinutes =
      durations.length > 0 ? round2(quantile(durations, 0.5)) : null;
    const trackedDurationIqrMinutes =
      durations.length >= 2 ? round2(quantile(durations, 0.75) - quantile(durations, 0.25)) : null;

    behaviorStats.push({
      behaviorId,
      trackedDurationSampleCount: durations.length,
      trackedDurationMedianMinutes,
      trackedDurationIqrMinutes,
      locationAffinity: computeLocationAffinity(homeCompletionCount, awayCompletionCount),
      homeCompletionCount,
      awayCompletionCount,
      proposalOutcomes: summarizeOutcomes(behProposals),
    });

    // Signal 1: Recurring weekday conflict
    const affectedWeekdays = Array.from(weekdayConflictCounts.entries())
      .filter(([, count]) => count >= RECURRING_WEEKDAY_CONFLICT_MIN_EVIDENCE)
      .sort((a, b) => a[0] - b[0]);
    if (affectedWeekdays.length > 0) {
      const maxEvidence = Math.max(...affectedWeekdays.map(([, count]) => count));
      remodelSuggestions.push({
        behaviorId,
        pattern: "recurring_weekday_conflict",
        affectedWeekdays: affectedWeekdays.map(([day]) => day),
        suggestedAction: "shift_weekday",
        confidence: maxEvidence >= 5 ? "high" : "medium",
        evidenceCount: maxEvidence,
        requiresConfirmation: true,
      });
    }

    // Signal 2: Frequent accepted travel-motivated shifts
    const acceptedTravelShifts = behProposals.filter(
      (p) => p.travelMotivated && (p.outcome === "yes" || p.outcome === "other_time"),
    );
    if (acceptedTravelShifts.length >= FREQUENT_TRAVEL_SHIFT_MIN_EVIDENCE) {
      const shiftWeekdays = Array.from(
        new Set(acceptedTravelShifts.map((p) => Temporal.PlainDate.from(p.localDate).dayOfWeek)),
      ).sort((a, b) => a - b);
      remodelSuggestions.push({
        behaviorId,
        pattern: "frequent_travel_shift",
        affectedWeekdays: shiftWeekdays,
        suggestedAction: "mark_flexible",
        confidence: acceptedTravelShifts.length >= 5 ? "high" : "medium",
        evidenceCount: acceptedTravelShifts.length,
        requiresConfirmation: true,
      });
    }

    // Signal 3: Low adherence on travel days vs. strong baseline
    if (travelDayDecided >= LOW_TRAVEL_ADHERENCE_MIN_DECIDED && nonTravelDayDecided >= 2) {
      const travelRate = travelDayCompleted / travelDayDecided;
      const nonTravelRate = nonTravelDayCompleted / nonTravelDayDecided;
      if (
        travelRate <= LOW_TRAVEL_ADHERENCE_MAX_RATE &&
        nonTravelRate >= LOW_TRAVEL_ADHERENCE_MIN_BASELINE
      ) {
        remodelSuggestions.push({
          behaviorId,
          pattern: "low_adherence_on_travel_days",
          affectedWeekdays: [],
          suggestedAction: "shift_time_window",
          confidence: travelDayDecided >= 6 ? "high" : "medium",
          evidenceCount: travelDayDecided,
          requiresConfirmation: true,
        });
      }
    }
  }

  return {
    provenance: "cadence_first_party",
    generatedAt,
    proposalOutcomes: overallProposals,
    postTravelShiftCompletion,
    behaviorStats,
    remodelSuggestions,
  };
}

/**
 * Combines Layer 2 (indefinite Cadence-owned first-party patterns) with an optional
 * Layer 1 (<=30-day rolling or >30-day ephemeral calendar load summary).
 * Tags provenance clearly and strips any non-aggregate fields so persisted outputs
 * never leak raw calendar text.
 */
export function mergeLongitudinalLayers(
  firstParty: FirstPartyLongitudinalPatterns,
  rollingCalendarSummary: RollingCalendarSummaryInput | null | undefined,
): LongitudinalPatternSnapshot {
  if (!rollingCalendarSummary) {
    return {
      rollingCalendarWindow: null,
      firstPartyPatterns: firstParty,
    };
  }

  const windowDays = Math.max(1, Math.trunc(rollingCalendarSummary.windowDays));
  const ephemeral = windowDays > MAX_PERSISTED_CALENDAR_WINDOW_DAYS;
  const busiestWeekdays = Array.from(
    new Set(
      rollingCalendarSummary.busiestWeekdays
        .map((day) => Math.trunc(day))
        .filter((day) => day >= 1 && day <= 7),
    ),
  ).sort((a, b) => a - b);

  const rollingCalendarWindow: LongitudinalRollingCalendarLayer = {
    provenance: ephemeral ? "ephemeral_calendar_mcp" : "rolling_calendar_mcp",
    ephemeral,
    windowDays,
    heavyDayCount: Math.max(0, Math.trunc(rollingCalendarSummary.heavyDayCount)),
    averageBusyMinutes: Math.max(0, round2(rollingCalendarSummary.averageBusyMinutes)),
    busiestWeekdays,
  };

  return {
    rollingCalendarWindow,
    firstPartyPatterns: firstParty,
  };
}
