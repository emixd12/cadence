import { Temporal } from "@js-temporal/polyfill";
import {
  addLocalDays,
  BEHAVIOR_CHANGE_RULES,
  buildChangedSchedules,
  changeFromWeekdayPattern,
  describeSchedules,
  evaluateBehaviorChangeCandidate,
  firstAffectedDate,
  formatBehaviorChangeLine,
  formatCheckInQuestion,
  formatEditedDuringTrial,
  formatKeptWithoutAnswer,
  formatLongDate,
  isHeldToday,
  restoreSchedules,
  schedulesEqual,
  summarizeWeekdayMoves,
  toProposeBehaviorChangeInput,
  trialCheckInDate,
  validateProposeBehaviorChangeInput,
  type BehaviorChange,
  type BehaviorChangeEvidence,
  type PlannedItem,
  type PlannedItemMove,
  type ProposalSchedule,
} from "@cadence/core/services/behavior-change-proposal";
import type {
  ScheduleProposalAnswer,
  ScheduleProposalAnswerResult,
  ScheduleProposalErrorCode,
  ScheduleProposalView,
} from "@cadence/core/types/behavior-change-proposals";
import type { Weekday } from "@cadence/core/types/recurrence";
import { formatClockTimeLabel } from "@cadence/core/services/schedule";

import {
  answerBehaviorChangeProposal,
  BehaviorChangeProposalError,
  coachProposeBehaviorChange,
  readBehaviorChangeProposal,
  readCoachBehaviorChangeState,
  type BehaviorChangeProposalRow,
} from "@/lib/db/behavior-change-proposals.repo";
import {
  getBehaviorById,
  getProfileTimezone,
  listUserBehaviors,
  type AppSupabaseClient,
  type BehaviorWithCategory,
} from "@/lib/db/behaviors.repo";
import { updateBehaviorForUser } from "@/lib/services/behavior.service";
import { integrationBehaviorInput } from "@/lib/services/integration-behavior-input";
import { serializeIntegrationBehavior } from "@/lib/services/integration-read-serialization";
import { DEFAULT_TIMEZONE } from "@/lib/types/recurrence";

/**
 * Advisor Phase 4C: base schedule proposals ("Try for two weeks").
 *
 * Two callers:
 * - the nightly coach visit (4B's job) on the coach token calls
 *   `proposeBehaviorChangesForVisit` after signals are stored. It reads, decides with the
 *   core rule, and stores at most one proposal through `coach_propose_behavior_change`.
 *   It never edits a Behavior.
 * - the person, on web or the Mac, through /api/advisor/coach/schedule-proposal:
 *   `readScheduleProposal` and `answerScheduleProposal`. Try, Change for good and Go back
 *   run the person's own schedule edit (`updateBehaviorForUser`, the web's existing path,
 *   with the Behavior's revision), then record the answer. A repeat after a failure in
 *   between finds the schedule already changed and only records the answer.
 */

export class ScheduleProposalError extends Error {
  constructor(readonly code: ScheduleProposalErrorCode) {
    super(code);
    this.name = "ScheduleProposalError";
  }
}

// ---------------------------------------------------------------------------
// The coach visit

/** One planned item as 4B's visit reads it (set time "HH:MM:SS"). */
export type CoachVisitOccurrence = Readonly<{
  id: string;
  behaviorId: string;
  localDate: string;
  scheduleKind: "exact" | "range";
  startTime: string;
}>;

/**
 * A card-backed candidate from 4B's matcher (a Time-of-day gap or Never done signal
 * backed by an advice card), with the change it suggests.
 */
export type CardBackedChangeCandidate = Readonly<{
  behaviorId: string;
  signalKind: "time_of_day_gap" | "never_done";
  cardId: string;
  weekdays: readonly Weekday[];
  fromTime: string;
  toTime: string;
  counts: Readonly<Record<string, number>>;
  signalIds?: readonly number[];
  reason?: string | null;
}>;

export type VisitProposalOutcome =
  | Readonly<{ proposed: true; proposalId: string; behaviorId: string }>
  | Readonly<{ proposed: false; reason: string }>;

export async function proposeBehaviorChangesForVisit(client: AppSupabaseClient, input: Readonly<{
  userId: string;
  runId: string;
  /** The visit's local date. */
  today: string;
  occurrences: readonly CoachVisitOccurrence[];
  moves: readonly PlannedItemMove[];
  cardCandidates?: readonly CardBackedChangeCandidate[];
  /** Model-written reasons by Behavior id, when 4B has them; the code writes its own otherwise. */
  reasons?: Readonly<Record<string, string>>;
}>): Promise<VisitProposalOutcome> {
  const state = await readCoachBehaviorChangeState(client);
  if (state.hasOpen) return { proposed: false, reason: "open_proposal" };

  const items: PlannedItem[] = input.occurrences.map((row) => ({
    occurrenceId: row.id, behaviorId: row.behaviorId, localDate: row.localDate,
    startTime: row.startTime.slice(0, 5), kind: row.scheduleKind,
  }));
  const patterns = summarizeWeekdayMoves({ today: input.today, items, moves: input.moves })
    .sort((a, b) => b.movedDays - a.movedDays || a.targetSpreadMinutes - b.targetSpreadMinutes);
  const candidates: Array<Readonly<{ behaviorId: string; change: BehaviorChange; evidence: BehaviorChangeEvidence; reason?: string | null }>> = [];
  for (const pattern of patterns) {
    const found = changeFromWeekdayPattern(pattern);
    if (found) candidates.push({ behaviorId: pattern.behaviorId, ...found, reason: input.reasons?.[pattern.behaviorId] });
  }
  for (const card of input.cardCandidates ?? []) {
    candidates.push({
      behaviorId: card.behaviorId,
      change: { weekdays: card.weekdays, fromTime: card.fromTime, toTime: card.toTime },
      evidence: { source: "card", signalKind: card.signalKind, cardId: card.cardId, counts: card.counts, signalIds: card.signalIds ?? [] },
      reason: card.reason,
    });
  }
  if (candidates.length === 0) return { proposed: false, reason: "no_candidate" };

  const behaviors = new Map((await listUserBehaviors(client, input.userId)).map((row) => [row.id, row]));
  const declined = state.declined.map((row) => ({
    behaviorId: row.behaviorId, direction: row.direction,
    declinedOn: row.declinedAt.slice(0, 10),
  }));
  let lastReason = "no_candidate";
  for (const candidate of candidates) {
    const behavior = behaviors.get(candidate.behaviorId);
    if (!behavior) { lastReason = "inactive_behavior"; continue; }
    const decision = evaluateBehaviorChangeCandidate({
      today: input.today,
      behavior: { id: behavior.id, title: behavior.title, active: behavior.active, schedules: proposalSchedules(behavior) },
      change: candidate.change, evidence: candidate.evidence, hasOpenProposal: false, declined, reason: candidate.reason,
    });
    if (!decision.ok) { lastReason = decision.reason; continue; }
    const proposal = toProposeBehaviorChangeInput(decision.plan, input.today, input.runId);
    const valid = validateProposeBehaviorChangeInput(proposal);
    if (!valid.ok) { lastReason = "invalid_proposal"; continue; }
    const stored = await coachProposeBehaviorChange(client, input.runId, proposal);
    if ("id" in stored) return { proposed: true, proposalId: stored.id, behaviorId: behavior.id };
    lastReason = stored.refused;
    if (stored.refused === "open_proposal") break;
  }
  return { proposed: false, reason: lastReason };
}

// ---------------------------------------------------------------------------
// The person

export type ScheduleProposalCaller = Readonly<{
  supabase: AppSupabaseClient;
  userId: string;
  now: Temporal.Instant;
}>;

export async function readScheduleProposal(caller: ScheduleProposalCaller): Promise<ScheduleProposalView> {
  const today = await localToday(caller);
  const row = await call(() => readBehaviorChangeProposal(caller.supabase, today));
  if (!row) return { kind: "none" };
  return await settleAndView(caller, row, today);
}

export async function answerScheduleProposal(caller: ScheduleProposalCaller, input: Readonly<{
  proposalId: string; answer: ScheduleProposalAnswer;
}>): Promise<ScheduleProposalAnswerResult> {
  const today = await localToday(caller);
  const row = await call(() => readBehaviorChangeProposal(caller.supabase, today));
  if (!row || row.id !== input.proposalId) {
    // Answered or closed already: a repeat of the same answer replays from the database.
    return await recordOnly(caller, input, today);
  }
  const answer = input.answer;
  if (answer === "try" && row.status === "accepted_trial") return await recordOnly(caller, input, today);
  const proposalAnswer = answer === "try" || answer === "for_good" || answer === "no";
  if (proposalAnswer ? row.status !== "proposed" : row.status !== "accepted_trial") throw new ScheduleProposalError("proposal_closed");
  if (row.status === "accepted_trial" && (row.checkInDate === null || today < row.checkInDate)) throw new ScheduleProposalError("proposal_closed");

  if (answer === "no" || answer === "keep") {
    const recorded = await call(() => answerBehaviorChangeProposal(caller.supabase, { proposalId: row.id, answer, today }));
    return { applied: false, replayed: recorded.replayed, view: { kind: "none" }, message: answer === "no" ? "No change." : `${await titleOf(caller, row)} stays at ${formatClockTimeLabel(row.toTime)}.` };
  }
  // Every answer below edits the schedule: never on a weekday the change touches (T1).
  if (isHeldToday(today, row.weekdays)) throw new ScheduleProposalError("held_today");
  const behavior = await getBehaviorById(caller.supabase, caller.userId, row.behaviorId);
  const current = behavior && behavior.active ? proposalSchedules(behavior) : null;
  const change: BehaviorChange = { weekdays: row.weekdays, fromTime: row.fromTime, toTime: row.toTime };

  if (answer === "try" || answer === "for_good") {
    let applied = false;
    if (!current) {
      await call(() => answerBehaviorChangeProposal(caller.supabase, { proposalId: row.id, answer: "schedule_changed", today }));
      throw new ScheduleProposalError("schedule_changed");
    }
    if (!schedulesEqual(current, row.schedulesAfter)) {
      if (!schedulesEqual(current, row.schedulesBefore)) {
        await call(() => answerBehaviorChangeProposal(caller.supabase, { proposalId: row.id, answer: "schedule_changed", today }));
        throw new ScheduleProposalError("schedule_changed");
      }
      // Rebuild from the live list so every kept schedule and entry carries its current id.
      const built = buildChangedSchedules(current, change);
      if (!built.ok || !schedulesEqual(built.schedules, row.schedulesAfter)) throw new ScheduleProposalError("schedule_changed");
      await writeSchedules(caller, behavior!, built.schedules);
      applied = true;
    }
    const checkInDate = answer === "try" ? trialCheckInDate(today, row.weekdays) : null;
    const recorded = await call(() => answerBehaviorChangeProposal(caller.supabase, { proposalId: row.id, answer, today, checkInDate }));
    const title = behavior!.title;
    const firstDay = formatLongDate(firstAffectedDate(today, row.weekdays));
    const message = answer === "try"
      ? `${title} is at ${formatClockTimeLabel(row.toTime)} from ${firstDay}. Cadence asks on ${formatLongDate(checkInDate!)} whether to keep it.`
      : `${title} is at ${formatClockTimeLabel(row.toTime)} from ${firstDay}.`;
    return { applied, replayed: recorded.replayed && !applied, view: await viewAfter(caller, today), message };
  }

  // Go back: only while the schedule still equals what the trial set (T4).
  if (!current || !schedulesEqual(current, row.schedulesAfter)) {
    if (current && schedulesEqual(current, row.schedulesBefore)) {
      // Already restored (a repeat after a failure): record only.
      const recorded = await call(() => answerBehaviorChangeProposal(caller.supabase, { proposalId: row.id, answer: "go_back", today }));
      return { applied: false, replayed: recorded.replayed, view: { kind: "none" }, message: `${behavior!.title} is back at ${formatClockTimeLabel(row.fromTime)}.` };
    }
    await call(() => answerBehaviorChangeProposal(caller.supabase, { proposalId: row.id, answer: "edited", today }));
    const text = formatEditedDuringTrial({ title: behavior?.title ?? "This Behavior" });
    return { applied: false, replayed: false, view: { kind: "notice", proposalId: row.id, behaviorId: row.behaviorId, text }, message: text };
  }
  await writeSchedules(caller, behavior!, restoreSchedules(row.schedulesBefore, current));
  const recorded = await call(() => answerBehaviorChangeProposal(caller.supabase, { proposalId: row.id, answer: "go_back", today }));
  return { applied: true, replayed: recorded.replayed, view: { kind: "none" }, message: `${behavior!.title} is back at ${formatClockTimeLabel(row.fromTime)}.` };
}

/** The proposal is no longer the one to show: replay the same answer, or report it closed. */
async function recordOnly(caller: ScheduleProposalCaller, input: Readonly<{ proposalId: string; answer: ScheduleProposalAnswer }>, today: string):
  Promise<ScheduleProposalAnswerResult> {
  try {
    const recorded = await answerBehaviorChangeProposal(caller.supabase, {
      proposalId: input.proposalId, answer: input.answer, today,
      // The database replays an answer that already took effect and ignores this date then.
      checkInDate: input.answer === "try" ? addLocalDays(today, BEHAVIOR_CHANGE_RULES.trialDays) : null,
    });
    if (!recorded.replayed) throw new ScheduleProposalError("proposal_closed");
    return { applied: false, replayed: true, view: await viewAfter(caller, today), message: "Already saved." };
  } catch (error) {
    if (error instanceof ScheduleProposalError) throw error;
    if (error instanceof BehaviorChangeProposalError && error.code === "not_found") throw new ScheduleProposalError("proposal_not_found");
    throw new ScheduleProposalError("proposal_closed");
  }
}

async function settleAndView(caller: ScheduleProposalCaller, row: BehaviorChangeProposalRow, today: string): Promise<ScheduleProposalView> {
  const change: BehaviorChange = { weekdays: row.weekdays, fromTime: row.fromTime, toTime: row.toTime };
  const behavior = await getBehaviorById(caller.supabase, caller.userId, row.behaviorId);
  const title = behavior?.title ?? "This Behavior";

  if (row.status === "kept") {
    // A trial kept without an answer: say so once.
    await call(() => answerBehaviorChangeProposal(caller.supabase, { proposalId: row.id, answer: "notice_seen", today }));
    return { kind: "notice", proposalId: row.id, behaviorId: row.behaviorId, text: formatKeptWithoutAnswer({ title, change }) };
  }
  const current = behavior && behavior.active ? proposalSchedules(behavior) : null;

  if (row.status === "proposed") {
    if (!current || !schedulesEqual(current, row.schedulesBefore)) {
      // The person changed the schedule (or archived the Behavior) first: the line is stale.
      await call(() => answerBehaviorChangeProposal(caller.supabase, { proposalId: row.id, answer: "schedule_changed", today }));
      return { kind: "none" };
    }
    if (isHeldToday(today, row.weekdays)) return { kind: "hold", proposalId: row.id, reason: "affected_weekday_today" };
    const first = firstAffectedDate(today, row.weekdays);
    return {
      kind: "proposal",
      proposalId: row.id,
      behaviorId: row.behaviorId,
      line: formatBehaviorChangeLine({ title, change, firstAffectedDate: first }),
      reason: row.reason,
      before: describeSchedules(row.schedulesBefore),
      after: describeSchedules(row.schedulesAfter),
      firstAffectedDate: first,
      answers: ["try", "for_good", "no"],
    };
  }

  // A trial.
  if (row.checkInDate === null || today < row.checkInDate) {
    return {
      kind: "trial", proposalId: row.id, behaviorId: row.behaviorId, checkInDate: row.checkInDate ?? today,
      line: `Trying ${title} at ${formatClockTimeLabel(row.toTime)} until ${formatLongDate(row.checkInDate ?? today)}.`,
    };
  }
  if (!current || !schedulesEqual(current, row.schedulesAfter)) {
    // Edited during the trial: Go back is not offered (T4). Close with one line.
    await call(() => answerBehaviorChangeProposal(caller.supabase, { proposalId: row.id, answer: "edited", today }));
    return { kind: "notice", proposalId: row.id, behaviorId: row.behaviorId, text: formatEditedDuringTrial({ title }) };
  }
  if (isHeldToday(today, row.weekdays)) return { kind: "hold", proposalId: row.id, reason: "affected_weekday_today" };
  return {
    kind: "check_in", proposalId: row.id, behaviorId: row.behaviorId,
    question: formatCheckInQuestion({ title, change }), answers: ["keep", "go_back"],
  };
}

async function viewAfter(caller: ScheduleProposalCaller, today: string): Promise<ScheduleProposalView> {
  const row = await call(() => readBehaviorChangeProposal(caller.supabase, today));
  return row ? await settleAndView(caller, row, today) : { kind: "none" };
}

async function writeSchedules(caller: ScheduleProposalCaller, behavior: BehaviorWithCategory, schedules: ProposalSchedule[]) {
  const values = integrationBehaviorInput(
    { behavior_id: behavior.id, expected_revision: behavior.updated_at, schedules },
    serializeIntegrationBehavior(behavior, null),
  );
  try {
    await updateBehaviorForUser(caller.supabase, caller.userId, {
      behaviorId: behavior.id, values, expectedUpdatedAt: behavior.updated_at,
    }, caller.now.toString());
  } catch (error) {
    if (error instanceof Error && /reload|revision|changed/i.test(error.message)) throw new ScheduleProposalError("revision_changed");
    throw error;
  }
}

/** The integration contract's schedule list, without display fields. */
export function proposalSchedules(behavior: BehaviorWithCategory): ProposalSchedule[] {
  return serializeIntegrationBehavior(behavior, null).schedules.map((schedule) => ({
    id: schedule.id,
    recurrence: schedule.recurrence,
    time_entries: schedule.time_entries.map((entry) => entry.kind === "exact"
      ? { id: entry.id, kind: "exact" as const, start_time: entry.start_time }
      : entry.preset
        ? { id: entry.id, kind: "range" as const, preset: entry.preset }
        : { id: entry.id, kind: "range" as const, start_time: entry.start_time, end_time: entry.end_time ?? entry.start_time }),
  })) as ProposalSchedule[];
}

async function titleOf(caller: ScheduleProposalCaller, row: BehaviorChangeProposalRow): Promise<string> {
  return (await getBehaviorById(caller.supabase, caller.userId, row.behaviorId))?.title ?? "This Behavior";
}

async function localToday(caller: ScheduleProposalCaller): Promise<string> {
  const timezone = (await getProfileTimezone(caller.supabase, caller.userId)) ?? DEFAULT_TIMEZONE;
  return caller.now.toZonedDateTimeISO(timezone).toPlainDate().toString();
}

async function call<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof BehaviorChangeProposalError) {
      if (error.code === "not_found") throw new ScheduleProposalError("proposal_not_found");
      if (error.code === "closed") throw new ScheduleProposalError("proposal_closed");
      if (error.code === "invalid_input") throw new ScheduleProposalError("invalid_request");
      throw new ScheduleProposalError("advisor_unavailable");
    }
    throw error;
  }
}

export const SCHEDULE_PROPOSAL_RULES = BEHAVIOR_CHANGE_RULES;
