import { Temporal } from "@js-temporal/polyfill";
import type { AdvisorDayContext } from "@cadence/core/types/advisor-day-context";
import {
  BRIEF_MOVE_DEFAULT_LATEST_START_MINUTE, BRIEF_MOVE_FALLBACK_MINUTES, BRIEF_MOVES_VERSION,
  type BriefMoveLength, type BriefMoveLine, type BriefMoveReasonCode, type BriefMoves, type BriefPlanningContext,
} from "@cadence/core/types/brief-moves";
import { BRIEFING_PRESETS, parseBriefingConfig } from "@cadence/core/services/briefing-config";
import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import { prepareBriefing } from "./briefing-pipeline";
import { briefingMoveReason } from "@cadence/core/services/briefing-move-overview";
import { stockBriefMoveReason } from "./brief-opening";
import type { DailyBriefGenerator } from "./daily-brief-consumer";

/**
 * TEMPORARY STAND-IN for 3A1's lib/services/brief-moves.service.ts (advisor Phase 3).
 *
 * 3A1 owns this module: the one slot rule, lengths, the offered-items filter, proposal
 * writes and reopen reads. 3A2 builds the brief's words, the saved brief, Refresh and
 * the evals against the signatures agreed with 3A1 on Nov 18. This stand-in plans with
 * today's planner (recipe 1.2 policy) so the brief path and the evals run before 3A1's
 * module lands; on merge, 3A1's file replaces this one whole.
 */

/** A line before its proposal is stored. `key` is stable for one brief. */
export type BriefMoveCandidate = Omit<BriefMoveLine, "proposalId" | "status" | "moveId"> & Readonly<{ key: string }>;

export type BriefMovePlan = Readonly<{ candidates: readonly BriefMoveCandidate[]; calendar: "current" | "stale" | "none" }>;

/** Everything the pure planner needs; the wrapper reads these from the database. */
export type BriefMovePlanInputs = Readonly<{
  now: string;
  calendarBusy?: BriefPlanningContext["calendarBusy"];
  /** Verified travel times for this request, or null. Never stored, never sent to a model. */
  travel?: unknown;
  /** Occurrences answered No, or Undone, today: never offered again today. */
  declinedToday?: readonly string[];
  neverMoveBehaviorIds?: readonly string[];
  alongsideBehaviorIds?: readonly string[];
  lengths?: Readonly<Record<string, BriefMoveLength>>;
  latestStartMinute?: number;
}>;

const STAND_IN_CONFIG = (() => {
  const base = BRIEFING_PRESETS.find((preset) => preset.id === "advisor-analysis-3")!.config;
  return parseBriefingConfig({ ...base, analysis: { ...base.analysis, lanes: [], maxTips: 0 } });
})();

export async function planBriefMoveLines(input: Readonly<{
  context: AdvisorDayContext;
  planning: Readonly<{ calendarBusy?: BriefPlanningContext["calendarBusy"]; travelTimes?: unknown }>;
  now: string;
  supabase: AppSupabaseClient;
}>): Promise<BriefMovePlan> {
  return planBriefMoveLinesFromInputs(input.context, { now: input.now, calendarBusy: input.planning.calendarBusy, travel: input.planning.travelTimes ?? null });
}

export function planBriefMoveLinesFromInputs(context: AdvisorDayContext, inputs: BriefMovePlanInputs): BriefMovePlan {
  const declined = new Set(inputs.declinedToday ?? []);
  const never = new Set(inputs.neverMoveBehaviorIds ?? []);
  const alongside = new Set(inputs.alongsideBehaviorIds ?? []);
  const latest = inputs.latestStartMinute ?? BRIEF_MOVE_DEFAULT_LATEST_START_MINUTE;
  const prepared = prepareBriefing(context, STAND_IN_CONFIG, inputs.now, undefined, new Set([...alongside, ...never]));
  const { plan } = prepared;
  const byRef = new Map(context.cadence.occurrences.map((item) => [item.ref, item]));
  const calendars = context.connectors.filter((connector) => connector.source !== undefined && "state" in connector);
  const calendar = !calendars.length ? "none" : calendars.some((connector) => "state" in connector && connector.state === "stale") ? "stale" : "current";
  const candidates: BriefMoveCandidate[] = [];
  for (const option of plan.options) {
    const item = byRef.get(option.occurrenceRef);
    if (!item || declined.has(item.ref) || never.has(item.behaviorRef) || alongside.has(item.behaviorRef)) continue;
    if (option.intervals.proposed.kind !== "timed" || option.intervals.current.kind !== "timed") continue;
    const start = Temporal.Instant.from(option.intervals.proposed.startAt).toZonedDateTimeISO(context.timezone);
    if (start.hour * 60 + start.minute > latest) continue;
    const reason = briefingMoveReason(option, plan, inputs.now);
    const finding = plan.dayEvidence.findings.find((entry) => entry.kind === "known_overlap" && entry.refs.occurrenceRefs.includes(option.occurrenceRef));
    const other = finding?.kind === "known_overlap" ? finding.participants.find((entry) => entry.ref !== option.occurrenceRef) : undefined;
    const reasonCode: BriefMoveReasonCode = reason === "time_passed" ? "time_passed" : reason === "too_close" ? "tight_transition"
      : other?.source === "calendar_event" ? "calendar_overlap" : "item_overlap";
    const anchorTitle = other && other.source !== "calendar_event" ? byRef.get(other.ref)?.title ?? null : null;
    const anchor = anchorTitle ? { kind: "item" as const, title: anchorTitle } : null;
    const minutes = Math.round(Temporal.Instant.from(option.intervals.proposed.startAt).until(Temporal.Instant.from(option.intervals.proposed.endAt)).total("minutes"));
    const length: BriefMoveLength = inputs.lengths?.[item.behaviorRef]
      ?? (item.duration.kind === "known" ? { minutes, source: "behavior_duration", assumed: false } : { minutes: minutes || BRIEF_MOVE_FALLBACK_MINUTES, source: "fallback", assumed: true });
    candidates.push({
      key: `line_${candidates.length + 1}`,
      occurrenceId: item.ref, behaviorId: item.behaviorRef, behaviorRevision: "stand-in", title: item.title,
      localDate: context.localDate, timezone: context.timezone, expectedRevision: "stand-in",
      from: { startAt: option.intervals.current.startAt, endAt: option.intervals.current.endAt },
      to: { startAt: option.intervals.proposed.startAt, endAt: option.intervals.proposed.endAt },
      length, reasonCode, reason: stockBriefMoveReason(reasonCode, anchor?.title ?? null), anchor,
      otherTimes: [], travel: "not_needed",
      late: Temporal.Instant.compare(Temporal.Instant.from(option.intervals.current.startAt), Temporal.Instant.from(inputs.now)) < 0,
      offerNeverMove: false,
    });
  }
  return { candidates, calendar };
}

/** 3A1: fills the per-Behavior length and "alongside" cache, calling the model only for new or changed Behaviors. */
export async function ensureBehaviorEstimates(_agentClient: AppSupabaseClient | null, _context: AdvisorDayContext, _estimate: DailyBriefGenerator, _signal?: AbortSignal): Promise<void> {
  // The stand-in keeps durations as recorded.
}

/** 3A1: stores the shown lines as proposals; `refresh` supersedes the day's earlier undecided brief lines. */
export async function saveBriefProposals(_agentClient: AppSupabaseClient | null, input: Readonly<{
  runId: string; localDate: string; refresh: boolean; lines: readonly BriefMoveCandidate[];
}>): Promise<BriefMoveLine[]> {
  return input.lines.map(({ key, ...line }) => ({ ...line, proposalId: `stand-in-${key}`, status: "proposed" as const, moveId: null }));
}

/** 3A1: today's lines with their current statuses, for reopening with no model call. */
export async function readBriefMoves(_client: AppSupabaseClient, input: Readonly<{ localDate: string; timezone: string; runId?: string | null }>): Promise<BriefMoves> {
  return { version: BRIEF_MOVES_VERSION, localDate: input.localDate, timezone: input.timezone, runId: input.runId ?? null,
    lines: [], conflicts: [], acceptAll: false, undoAllBatchId: null, calendar: "none" };
}
