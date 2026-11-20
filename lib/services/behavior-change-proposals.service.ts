import { Temporal } from "@js-temporal/polyfill";
import {
  addLocalDays,
  BEHAVIOR_CHANGE_RULES,
  buildChangedSchedules,
  changeFromMovePattern,
  describeSchedules,
  evaluateBehaviorChangeCandidate,
  evaluateBehaviorLengthCandidate,
  firstAffectedDate,
  formatBehaviorChangeLine,
  formatCheckInQuestion,
  formatEditedDuringTrial,
  formatKeptWithoutAnswer,
  formatLengthChangeLine,
  formatLengthCheckInQuestion,
  formatLongDate,
  formatTipQuestion,
  everyDays as everyDaysOf,
  lengthChangeFrom,
  minutesLabel,
  restoreSchedules,
  schedulesEqual,
  summarizeMoves,
  toProposeBehaviorChangeInput,
  trialCheckInDate,
  validateProposeBehaviorChangeInput,
  type BehaviorChange,
  type BehaviorChangeEvidence,
  type BehaviorChangePlan,
  type BehaviorLengthPlan,
  type DeclinedBehaviorChange,
  type PlannedItem,
  type PlannedItemMove,
  type ProposalSchedule,
} from "@cadence/core/services/behavior-change-proposal";
import { ADVICE_CARDS } from "@cadence/core/services/advice-library";
import type { AdviceCard } from "@cadence/core/types/advice-cards";
import type {
  ScheduleProposalAnswer,
  ScheduleProposalAnswerResult,
  ScheduleProposalErrorCode,
  ScheduleProposalTip,
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
import { researchFor } from "@/lib/services/advisor-tip-research";
import { DEFAULT_TIMEZONE } from "@/lib/types/recurrence";

/**
 * Advisor Phase 4C: base schedule proposals ("Try for two weeks"), and since Nov 20 the
 * offers that tips carry ("Tips with one-tap changes").
 *
 * Callers:
 * - the nightly tip run (4B's job) on the coach token calls `proposeTipOffers` for the
 *   day's tips that carry an offer (a new set time or a new length), before it writes
 *   them, and links each tip to the proposal it made.
 * - the same run then calls `proposeBehaviorChangesForVisit`: the older repeated-move
 *   question, on the same rule. The database keeps one open proposal per Behavior, so a
 *   Behavior whose tip already asked gets no second question.
 *   Neither ever edits a Behavior.
 * - the person, on web or the Mac, through /api/advisor/coach/schedule-proposal:
 *   `readScheduleProposal` and `answerScheduleProposal`. Try, Change for good, Go back and
 *   Undo run the person's own edit (`updateBehaviorForUser`, the web's existing path, with
 *   the Behavior's revision), then record the answer. A repeat after a failure in between
 *   finds the schedule already changed and only records the answer.
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

type VisitInput = Readonly<{
  userId: string;
  runId: string;
  /** The visit's local date. */
  today: string;
  occurrences: readonly CoachVisitOccurrence[];
  moves: readonly PlannedItemMove[];
}>;

export async function proposeBehaviorChangesForVisit(client: AppSupabaseClient, input: VisitInput & Readonly<{
  cardCandidates?: readonly CardBackedChangeCandidate[];
  /** Model-written reasons by Behavior id, when 4B has them; the code writes its own otherwise. */
  reasons?: Readonly<Record<string, string>>;
}>): Promise<VisitProposalOutcome> {
  // No early return on state.hasOpen: that read does not settle proposals past their dates,
  // so a stale one would block every visit. coach_propose_behavior_change settles first and
  // refuses with open_proposal when the Behavior really has one open.
  const state = await readCoachBehaviorChangeState(client);
  const behaviors = new Map((await listUserBehaviors(client, input.userId)).map((row) => [row.id, row]));

  const candidates: Array<Readonly<{ behaviorId: string; change: BehaviorChange; evidence: BehaviorChangeEvidence; reason?: string | null }>> = [];
  for (const pattern of summarizeMoves({ today: input.today, items: plannedItems(input.occurrences), moves: input.moves })) {
    const behavior = behaviors.get(pattern.behaviorId);
    const found = changeFromMovePattern(pattern, { schedules: behavior ? proposalSchedules(behavior) : undefined });
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

  const declined = declinedOf(state);
  let lastReason = "no_candidate";
  const tried = new Set<string>();
  for (const candidate of candidates) {
    // One proposal per Behavior: the first (strongest) candidate of each.
    if (tried.has(candidate.behaviorId)) continue;
    const behavior = behaviors.get(candidate.behaviorId);
    if (!behavior) { lastReason = "inactive_behavior"; continue; }
    const decision = evaluateBehaviorChangeCandidate({
      today: input.today,
      behavior: candidateBehavior(behavior),
      change: candidate.change, evidence: candidate.evidence, hasOpenProposal: false, declined, reason: candidate.reason,
    });
    if (!decision.ok) { lastReason = decision.reason; continue; }
    tried.add(candidate.behaviorId);
    const stored = await store(client, input, decision.plan);
    if ("id" in stored) return { proposed: true, proposalId: stored.id, behaviorId: behavior.id };
    lastReason = stored.refused;
  }
  return { proposed: false, reason: lastReason };
}

/** A tip that carries an offer: the change it may propose, from the tip's own signal. */
export type TipOffer = Readonly<{
  /** The caller's key for the tip, returned with its outcome. */
  key: string;
  kind: "set_time" | "set_length";
  behaviorId: string;
  cardId: string;
  /** The tip's sentence, as it will be stored. The question shows it above the choices. */
  tipText: string;
  signalIds?: readonly number[];
  /** The tip's signal facts (repeated_move or session_length). */
  facts: Readonly<Record<string, unknown>>;
}>;

export type TipOfferOutcome = Readonly<{ key: string; proposalId: string | null; reason: string | null }>;

/**
 * Proposals for the day's tips that carry an offer, before the tips are written. The
 * change is computed here, by the same rule as the repeated-move question: moves grouped
 * by the set time they came from (the tip's bar), or the usual session length rounded to
 * 5 minutes. A tip whose Behavior already has the same tip's question open links to it
 * (a re-run of the day's tips). Any refusal leaves the tip with its link instead.
 */
export async function proposeTipOffers(client: AppSupabaseClient, input: VisitInput & Readonly<{ offers: readonly TipOffer[] }>):
  Promise<TipOfferOutcome[]> {
  if (input.offers.length === 0) return [];
  const state = await readCoachBehaviorChangeState(client);
  const declined = declinedOf(state);
  const behaviors = new Map((await listUserBehaviors(client, input.userId)).map((row) => [row.id, row]));
  const patterns = summarizeMoves({ today: input.today, items: plannedItems(input.occurrences), moves: input.moves });
  const outcomes: TipOfferOutcome[] = [];
  for (const offer of input.offers) {
    const behavior = behaviors.get(offer.behaviorId);
    if (!behavior) { outcomes.push({ key: offer.key, proposalId: null, reason: "inactive_behavior" }); continue; }
    const evidenceBase = { source: "tip" as const, cardId: offer.cardId, tipText: offer.tipText, signalIds: offer.signalIds ?? [] };
    let plan: BehaviorChangePlan | BehaviorLengthPlan | null = null;
    let reason = "no_change";
    if (offer.kind === "set_time") {
      // The strongest pattern of this Behavior (most moves, then tightest spread).
      const found = patterns.filter((pattern) => pattern.behaviorId === offer.behaviorId)
        .map((pattern) => changeFromMovePattern(pattern, { schedules: proposalSchedules(behavior) }))
        .find((item) => item !== null);
      if (found && found.evidence.source === "repeated_move") {
        const decision = evaluateBehaviorChangeCandidate({
          today: input.today, behavior: candidateBehavior(behavior), change: found.change,
          evidence: { ...evidenceBase, signalKind: "repeated_move", counts: { moved_days: found.evidence.movedDays, window_days: found.evidence.windowDays } },
          hasOpenProposal: false, declined,
        });
        if (decision.ok) plan = decision.plan; else reason = decision.reason;
      } else reason = "below_bar";
    } else {
      const median = Number(offer.facts.median_minutes);
      const change = lengthChangeFrom({ currentMinutes: behavior.default_duration_minutes ?? null, medianMinutes: median });
      if (change) {
        const counts: Record<string, number> = {};
        for (const name of ["sessions", "planned_minutes", "median_minutes", "longer", "shorter"]) {
          const value = Number(offer.facts[name]);
          if (Number.isInteger(value) && value >= 0) counts[name] = value;
        }
        const decision = evaluateBehaviorLengthCandidate({
          today: input.today, behavior: candidateBehavior(behavior), change,
          evidence: { ...evidenceBase, signalKind: "session_length", counts }, hasOpenProposal: false, declined,
        });
        if (decision.ok) plan = decision.plan; else reason = decision.reason;
      }
    }
    if (!plan) { outcomes.push({ key: offer.key, proposalId: null, reason }); continue; }
    const stored = await store(client, input, plan);
    if ("id" in stored) outcomes.push({ key: offer.key, proposalId: stored.id, reason: null });
    else if (stored.refused === "open_proposal" && stored.openId && stored.openCardId === offer.cardId) {
      outcomes.push({ key: offer.key, proposalId: stored.openId, reason: null });
    } else outcomes.push({ key: offer.key, proposalId: null, reason: stored.refused });
  }
  return outcomes;
}

async function store(client: AppSupabaseClient, input: VisitInput, plan: BehaviorChangePlan | BehaviorLengthPlan) {
  const proposal = toProposeBehaviorChangeInput(plan, input.today, input.runId);
  const valid = validateProposeBehaviorChangeInput(proposal);
  if (!valid.ok) return { refused: "invalid_proposal" } as const;
  return await coachProposeBehaviorChange(client, input.runId, proposal);
}

function plannedItems(occurrences: readonly CoachVisitOccurrence[]): PlannedItem[] {
  return occurrences.map((row) => ({
    occurrenceId: row.id, behaviorId: row.behaviorId, localDate: row.localDate,
    startTime: row.startTime.slice(0, 5), kind: row.scheduleKind,
  }));
}

function declinedOf(state: Awaited<ReturnType<typeof readCoachBehaviorChangeState>>): DeclinedBehaviorChange[] {
  return state.declined.map((row) => ({ behaviorId: row.behaviorId, direction: row.direction, declinedOn: row.declinedAt.slice(0, 10) }));
}

function candidateBehavior(behavior: BehaviorWithCategory) {
  return {
    id: behavior.id, title: behavior.title, active: behavior.active, schedules: proposalSchedules(behavior),
    lengthMinutes: behavior.default_duration_minutes ?? null,
  };
}

// ---------------------------------------------------------------------------
// The person

export type ScheduleProposalCaller = Readonly<{
  supabase: AppSupabaseClient;
  userId: string;
  now: Temporal.Instant;
  /** Advice cards for a tip-backed question's "Why this?" (tests pass their own). */
  cards?: readonly AdviceCard[];
}>;

export async function readScheduleProposal(caller: ScheduleProposalCaller): Promise<ScheduleProposalView> {
  const today = await localToday(caller);
  const row = await call(() => readBehaviorChangeProposal(caller.supabase, today));
  if (!row) return { kind: "none" };
  return await settleAndView(caller, row, today);
}

const OPEN_ANSWERS: readonly ScheduleProposalAnswer[] = ["try", "for_good", "no"];

export async function answerScheduleProposal(caller: ScheduleProposalCaller, input: Readonly<{
  proposalId: string; answer: ScheduleProposalAnswer;
}>): Promise<ScheduleProposalAnswerResult> {
  const today = await localToday(caller);
  // The answered proposal itself, whatever its status: with one open per Behavior it need
  // not be the one first in line, and Undo answers a closed one.
  const row = await call(() => readBehaviorChangeProposal(caller.supabase, today, input.proposalId));
  if (!row || row.id !== input.proposalId) throw new ScheduleProposalError("proposal_not_found");
  const answer = input.answer;
  const behavior = await getBehaviorById(caller.supabase, caller.userId, row.behaviorId);
  const title = behavior?.title ?? "This Behavior";

  if (answer === "undo") return await undo(caller, row, behavior, today);
  // Answered already: a repeat of the same answer replays from the database.
  if (OPEN_ANSWERS.includes(answer) ? row.status !== "proposed" : row.status !== "accepted_trial") {
    return await recordOnly(caller, input, today);
  }
  if (row.status === "accepted_trial" && (row.checkInDate === null || today < row.checkInDate)) throw new ScheduleProposalError("proposal_closed");

  if (answer === "no" || answer === "keep") {
    const recorded = await call(() => answerBehaviorChangeProposal(caller.supabase, { proposalId: row.id, answer, today }));
    const kept = row.changeKind === "length" ? minutesLabel(row.toMinutes) : formatClockTimeLabel(row.toTime);
    return { applied: false, replayed: recorded.replayed, view: await viewAfter(caller, today), message: answer === "no" ? "No change." : `${title} stays at ${kept}.` };
  }
  const active = behavior && behavior.active ? behavior : null;

  if (answer === "try" || answer === "for_good") {
    let applied = false;
    if (!active) {
      await call(() => answerBehaviorChangeProposal(caller.supabase, { proposalId: row.id, answer: "schedule_changed", today }));
      throw new ScheduleProposalError("schedule_changed");
    }
    if (row.changeKind === "length") {
      const current = active.default_duration_minutes ?? null;
      if (current !== row.toMinutes) {
        if (current !== row.fromMinutes) {
          await call(() => answerBehaviorChangeProposal(caller.supabase, { proposalId: row.id, answer: "schedule_changed", today }));
          throw new ScheduleProposalError("schedule_changed");
        }
        await writeBehavior(caller, active, { default_duration_minutes: row.toMinutes });
        applied = true;
      }
    } else {
      const current = proposalSchedules(active);
      if (!schedulesEqual(current, row.schedulesAfter)) {
        if (!schedulesEqual(current, row.schedulesBefore)) {
          await call(() => answerBehaviorChangeProposal(caller.supabase, { proposalId: row.id, answer: "schedule_changed", today }));
          throw new ScheduleProposalError("schedule_changed");
        }
        // Rebuild from the live list so every kept schedule and entry carries its current id.
        const built = buildChangedSchedules(current, changeOf(row));
        if (!built.ok || !schedulesEqual(built.schedules, row.schedulesAfter)) throw new ScheduleProposalError("schedule_changed");
        await writeBehavior(caller, active, { schedules: built.schedules });
        applied = true;
      }
    }
    const checkInDate = answer === "try" ? trialCheckInDate(today) : null;
    const recorded = await call(() => answerBehaviorChangeProposal(caller.supabase, { proposalId: row.id, answer, today, checkInDate }));
    const now = await appliedLine(caller, row, title, today);
    const message = answer === "try"
      ? `${now} Cadence asks on ${formatLongDate(checkInDate!)} whether to keep it.`
      : now;
    return {
      applied, replayed: recorded.replayed && !applied, view: await viewAfter(caller, today), message,
      ...(answer === "for_good" ? { undoable: true } : {}),
    };
  }

  // Go back: only while the schedule (or length) still equals what the trial set (T4).
  const restored = await restore(caller, row, active);
  if (restored === "changed") {
    await call(() => answerBehaviorChangeProposal(caller.supabase, { proposalId: row.id, answer: "edited", today }));
    const text = formatEditedDuringTrial({ title, length: row.changeKind === "length" });
    return { applied: false, replayed: false, view: { kind: "notice", proposalId: row.id, behaviorId: row.behaviorId, text }, message: text };
  }
  const recorded = await call(() => answerBehaviorChangeProposal(caller.supabase, { proposalId: row.id, answer: "go_back", today }));
  return { applied: restored === "restored", replayed: recorded.replayed && restored !== "restored", view: await viewAfter(caller, today), message: backLine(row, title) };
}

/** Undo after Change for good: restores the earlier time or length while it is unchanged since the tap. */
async function undo(caller: ScheduleProposalCaller, row: BehaviorChangeProposalRow, behavior: BehaviorWithCategory | null, today: string):
  Promise<ScheduleProposalAnswerResult> {
  const title = behavior?.title ?? "This Behavior";
  if (row.status === "reverted" && row.closeReason === "undone") {
    return { applied: false, replayed: true, view: await viewAfter(caller, today), message: backLine(row, title) };
  }
  if (row.status !== "accepted") throw new ScheduleProposalError("proposal_closed");
  const restored = await restore(caller, row, behavior && behavior.active ? behavior : null);
  if (restored === "changed") throw new ScheduleProposalError("schedule_changed");
  const recorded = await call(() => answerBehaviorChangeProposal(caller.supabase, { proposalId: row.id, answer: "undo", today }));
  return { applied: restored === "restored", replayed: recorded.replayed && restored !== "restored", view: await viewAfter(caller, today), message: backLine(row, title) };
}

/**
 * Puts the earlier schedule or length back: "restored" after an edit, "already" when it is
 * back already (a repeat after a failure), "changed" when the person edited it since.
 */
async function restore(caller: ScheduleProposalCaller, row: BehaviorChangeProposalRow, behavior: BehaviorWithCategory | null):
  Promise<"restored" | "already" | "changed"> {
  if (!behavior) return "changed";
  if (row.changeKind === "length") {
    const current = behavior.default_duration_minutes ?? null;
    if (current === row.fromMinutes) return "already";
    if (current !== row.toMinutes) return "changed";
    await writeBehavior(caller, behavior, { default_duration_minutes: row.fromMinutes });
    return "restored";
  }
  const current = proposalSchedules(behavior);
  if (schedulesEqual(current, row.schedulesBefore)) return "already";
  if (!schedulesEqual(current, row.schedulesAfter)) return "changed";
  await writeBehavior(caller, behavior, { schedules: restoreSchedules(row.schedulesBefore, current) });
  return "restored";
}

function backLine(row: BehaviorChangeProposalRow, title: string): string {
  return row.changeKind === "length"
    ? `${title} is back at ${minutesLabel(row.fromMinutes)}.`
    : `${title} is back at ${formatClockTimeLabel(row.fromTime)}.`;
}

/**
 * The outcome after a Yes, read after the edit: "Gym is at 6:30 PM every day, starting
 * today." when today's Occurrence moved (it was ahead, unmarked and not moved by hand),
 * otherwise the next day the change touches. A length has no day: "Gym is now 45 minutes."
 */
async function appliedLine(caller: ScheduleProposalCaller, row: BehaviorChangeProposalRow, title: string, today: string): Promise<string> {
  if (row.changeKind === "length") return `${title} is now ${minutesLabel(row.toMinutes)}.`;
  const days = everyDaysOf(row.weekdays);
  const startsToday = row.weekdays.includes(weekdayOfDate(today)) && await todayAtNewTime(caller, row.behaviorId, today, row.toTime);
  const first = startsToday ? today : firstAffectedDate(today, row.weekdays, { afterToday: true });
  return `${title} is at ${formatClockTimeLabel(row.toTime)} ${days}${first === today ? ", starting today" : ` from ${formatLongDate(first)}`}.`;
}

/** Today's Occurrence of the Behavior sits at the new set time, unmarked and not moved by hand. */
async function todayAtNewTime(caller: ScheduleProposalCaller, behaviorId: string, today: string, toTime: string): Promise<boolean> {
  const { data, error } = await caller.supabase.from("occurrences")
    .select("status,schedule_start_time,effective_start_at")
    .eq("user_id", caller.userId).eq("behavior_id", behaviorId).eq("local_date", today);
  if (error || !data) return false;
  return data.some((occurrence) => occurrence.status === "unresolved" && occurrence.effective_start_at === null
    && occurrence.schedule_start_time.slice(0, 5) === toTime);
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
  const behavior = await getBehaviorById(caller.supabase, caller.userId, row.behaviorId);
  const title = behavior?.title ?? "This Behavior";
  const active = behavior && behavior.active ? behavior : null;

  if (row.status === "kept") {
    // A trial kept without an answer: say so once.
    await call(() => answerBehaviorChangeProposal(caller.supabase, { proposalId: row.id, answer: "notice_seen", today }));
    const text = row.changeKind === "length"
      ? formatKeptWithoutAnswer({ title, length: { fromMinutes: row.fromMinutes, toMinutes: row.toMinutes } })
      : formatKeptWithoutAnswer({ title, change: changeOf(row) });
    return { kind: "notice", proposalId: row.id, behaviorId: row.behaviorId, text };
  }
  const state = !active ? "gone" : changeState(row, active);

  if (row.status === "proposed") {
    // "after": an answer applied the change but recording it failed (or is in flight).
    // Keep the proposal so a repeat of the answer records it.
    if (state !== "before" && state !== "after") {
      // The person changed the schedule (or archived the Behavior) first: the line is stale.
      await call(() => answerBehaviorChangeProposal(caller.supabase, { proposalId: row.id, answer: "schedule_changed", today }));
      return await viewAfter(caller, today);
    }
    const tip = tipOf(caller, row, title);
    if (row.changeKind === "length") {
      return {
        kind: "proposal", proposalId: row.id, behaviorId: row.behaviorId, changeKind: "length",
        line: formatLengthChangeLine({ title, change: { fromMinutes: row.fromMinutes, toMinutes: row.toMinutes } }),
        reason: row.reason, before: [minutesLabel(row.fromMinutes)], after: [minutesLabel(row.toMinutes)],
        firstAffectedDate: today, answers: ["try", "for_good", "no"], tip,
      };
    }
    const change = changeOf(row);
    const first = firstAffectedDate(today, row.weekdays);
    return {
      kind: "proposal",
      proposalId: row.id,
      behaviorId: row.behaviorId,
      changeKind: "time",
      line: formatBehaviorChangeLine({ title, change, firstAffectedDate: first, today }),
      reason: row.reason,
      before: describeSchedules(row.schedulesBefore),
      after: describeSchedules(row.schedulesAfter),
      firstAffectedDate: first,
      answers: ["try", "for_good", "no"],
      tip,
    };
  }

  // A trial.
  const value = row.changeKind === "length" ? minutesLabel(row.toMinutes) : `${formatClockTimeLabel(row.toTime)}`;
  if (row.checkInDate === null || today < row.checkInDate) {
    return {
      kind: "trial", proposalId: row.id, behaviorId: row.behaviorId, checkInDate: row.checkInDate ?? today,
      line: `Trying ${title} at ${value} until ${formatLongDate(row.checkInDate ?? today)}.`,
    };
  }
  if (state !== "after") {
    // Edited during the trial: Go back is not offered (T4). Close with one line.
    await call(() => answerBehaviorChangeProposal(caller.supabase, { proposalId: row.id, answer: "edited", today }));
    return { kind: "notice", proposalId: row.id, behaviorId: row.behaviorId, text: formatEditedDuringTrial({ title, length: row.changeKind === "length" }) };
  }
  return {
    kind: "check_in", proposalId: row.id, behaviorId: row.behaviorId,
    question: row.changeKind === "length"
      ? formatLengthCheckInQuestion({ title, change: { fromMinutes: row.fromMinutes, toMinutes: row.toMinutes } })
      : formatCheckInQuestion({ title, change: changeOf(row) }),
    answers: ["keep", "go_back"],
  };
}

/** Where the Behavior stands against the proposal: as before it, as after it, or changed otherwise. */
function changeState(row: BehaviorChangeProposalRow, behavior: BehaviorWithCategory): "before" | "after" | "changed" {
  if (row.changeKind === "length") {
    const current = behavior.default_duration_minutes ?? null;
    return current === row.fromMinutes ? "before" : current === row.toMinutes ? "after" : "changed";
  }
  const current = proposalSchedules(behavior);
  return schedulesEqual(current, row.schedulesBefore) ? "before" : schedulesEqual(current, row.schedulesAfter) ? "after" : "changed";
}

function tipOf(caller: ScheduleProposalCaller, row: BehaviorChangeProposalRow, title: string): ScheduleProposalTip | null {
  if (!row.tip) return null;
  const question = row.changeKind === "length"
    ? formatTipQuestion({ title, length: { fromMinutes: row.fromMinutes, toMinutes: row.toMinutes } })
    : formatTipQuestion({ title, change: changeOf(row) });
  return { text: row.tip.text, question, research: researchFor(row.tip.cardId, caller.cards ?? ADVICE_CARDS) };
}

function changeOf(row: Extract<BehaviorChangeProposalRow, { changeKind: "time" }>): BehaviorChange {
  return { weekdays: row.weekdays, fromTime: row.fromTime, toTime: row.toTime };
}

async function viewAfter(caller: ScheduleProposalCaller, today: string): Promise<ScheduleProposalView> {
  const row = await call(() => readBehaviorChangeProposal(caller.supabase, today));
  return row ? await settleAndView(caller, row, today) : { kind: "none" };
}

async function writeBehavior(caller: ScheduleProposalCaller, behavior: BehaviorWithCategory,
  change: Readonly<{ schedules?: ProposalSchedule[]; default_duration_minutes?: number }>) {
  const values = integrationBehaviorInput(
    { behavior_id: behavior.id, expected_revision: behavior.updated_at, ...change },
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

const WEEKDAY_ORDER = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

function weekdayOfDate(localDate: string): Weekday {
  return WEEKDAY_ORDER[Temporal.PlainDate.from(localDate).dayOfWeek - 1]!;
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
