import {
  addLocalDays,
  evaluateBehaviorChangeCandidate,
  scheduleWeekdays,
  weekdaysWithSetTime,
  type BehaviorChange,
  type BehaviorChangeEvidence,
  type BehaviorChangePlan,
  type BehaviorChangeSkipReason,
  type DeclinedBehaviorChange,
  type ProposalSchedule,
} from "../services/behavior-change-proposal";
import { WEEKDAYS, type Weekday } from "../types/recurrence";
import { alongsideMayOverlap, type OverlapPlace } from "./alongside.resolver";

/**
 * Ticket 362 (docs/DECISIONS.md, 2026-11-25, D33, "Pairing the schedule"): when the coach
 * may propose a lasting schedule change that puts an alongside Behavior (the guest) at
 * the set time of another Behavior (the host), for the person to confirm. The proposal is
 * an ordinary base schedule proposal (Advisor Phase 4C): Try for two weeks, Change for
 * good or No, applied only through the person's own Behavior edit.
 *
 * Evidence (either one):
 *   - the coach's stored `done_together` signal names the pair (either direction), or
 *   - the person said Yes to the same guest-and-host pairing line in the Daily Brief
 *     (`move_proposals`, source daily_brief, reason alongside_pairing, status accepted)
 *     on at least 4 different local dates in the last 28 days, today included.
 * Roles: the guest is effectively alongside (`resolveAlongside`) and the host is not.
 * Place: both effective Wheres are known or guessed (not unknown) and compatible under
 * `alongsideMayOverlap`, the same rule as pairing for today.
 *
 * "On the days both are scheduled": both Behaviors' schedules must be daily (every day)
 * or weekly (every week) on chosen weekdays, the only rules whose days are fixed
 * weekdays. The shared days are the weekdays on which both have a time. On every shared
 * day the guest has exactly one time and it is a set time, the host has exactly one set
 * time, and those two times are the same on every shared day. The change then moves the
 * guest's set time to the host's on the shared weekdays only (`buildChangedSchedules`
 * splits a schedule when the guest also occurs on other days, which keep their time).
 * Every N days, every N weeks and monthly schedules, ranges, several times on one day
 * and times that differ by weekday are refused, not guessed. A pair named by a
 * done_together signal takes the alongside side as guest.
 *
 * Never proposed for: a step that follows its routine's schedule (either side), an
 * Opportunity Behavior without a schedule (either side), a guest marked "Don't suggest
 * moving this", or a guest longer than its host when both lengths are set. The 30-day
 * cooldown after a No, the schedule-count limit and time collisions are the existing
 * proposal rules (`evaluateBehaviorChangeCandidate`).
 *
 * Pure: no database, environment or clock. `today` is the person's local date.
 */

export const SCHEDULE_PAIRING_RULES = Object.freeze({
  /** Yes answers to the same pairing, on this many different local dates... */
  minYesDays: 4,
  /** ...inside this many days, today included. */
  windowDays: 28,
});

export type SchedulePairingBehavior = Readonly<{
  id: string;
  title: string;
  active: boolean;
  /** The integration contract's schedule list (`proposalSchedules`). */
  schedules: readonly ProposalSchedule[];
  lengthMinutes: number | null;
  /** The effective alongside value (`resolveAlongside`). */
  alongside: boolean;
  /** The effective Where (`resolveEffectiveWhere`); null when not read. */
  where: OverlapPlace;
  isOpportunity: boolean;
  /** A routine step that follows its routine's schedule. */
  followsParentSchedule: boolean;
  /** "Don't suggest moving this". */
  neverSuggestMove: boolean;
}>;

/** One stored done_together signal, as ids. */
export type SchedulePairingDoneTogether = Readonly<{ behaviorId: string; otherBehaviorId: string; signalId: number | null }>;

/** One accepted Daily Brief pairing line. */
export type SchedulePairingYes = Readonly<{ guestBehaviorId: string; hostBehaviorId: string; localDate: string }>;

export type SchedulePairingEvidenceInput = Readonly<{
  doneTogether: readonly SchedulePairingDoneTogether[];
  yes: readonly SchedulePairingYes[];
}>;

export const NO_SCHEDULE_PAIRING_EVIDENCE: SchedulePairingEvidenceInput = Object.freeze({ doneTogether: [], yes: [] });

export type SchedulePairingSkipReason =
  | BehaviorChangeSkipReason
  | "same_behavior"
  | "follows_parent_schedule"
  | "opportunity_without_schedule"
  | "never_move"
  | "guest_not_alongside"
  | "host_alongside"
  | "place_unknown"
  | "place_differs"
  | "host_too_short"
  | "no_shared_days"
  | "guest_time_unclear"
  | "host_time_unclear"
  | "times_differ_by_day"
  | "already_paired";

export type SchedulePairingDecision =
  | Readonly<{ ok: true; plan: BehaviorChangePlan & Readonly<{ evidence: Extract<BehaviorChangeEvidence, { source: "alongside_pairing" }> }> }>
  | Readonly<{ ok: false; reason: SchedulePairingSkipReason }>;

/** Distinct local dates with a Yes per guest and host, in the `windowDays` dates ending today. */
export function pairingYesDays(today: string, yes: readonly SchedulePairingYes[]): ReadonlyMap<string, number> {
  const since = addLocalDays(today, -(SCHEDULE_PAIRING_RULES.windowDays - 1));
  const dates = new Map<string, Set<string>>();
  for (const answer of yes) {
    if (answer.localDate < since || answer.localDate > today || answer.guestBehaviorId === answer.hostBehaviorId) continue;
    const key = pairKey(answer.guestBehaviorId, answer.hostBehaviorId);
    dates.set(key, (dates.get(key) ?? new Set()).add(answer.localDate));
  }
  return new Map([...dates].map(([key, set]) => [key, set.size]));
}

/**
 * What backs a guest-and-host pair, or null. The done_together signal counts in either
 * direction (the roles come from the alongside values); Yes answers count only for the
 * same guest and host.
 */
export function schedulePairingEvidence(input: Readonly<{
  today: string;
  guestId: string;
  hostId: string;
  evidence: SchedulePairingEvidenceInput;
}>): Extract<BehaviorChangeEvidence, { source: "alongside_pairing" }> | null {
  const signals = input.evidence.doneTogether.filter((pair) =>
    (pair.behaviorId === input.guestId && pair.otherBehaviorId === input.hostId)
    || (pair.behaviorId === input.hostId && pair.otherBehaviorId === input.guestId));
  const yesDays = pairingYesDays(input.today, input.evidence.yes).get(pairKey(input.guestId, input.hostId)) ?? 0;
  const base = { source: "alongside_pairing" as const, hostBehaviorId: input.hostId, yesDays, windowDays: SCHEDULE_PAIRING_RULES.windowDays };
  if (signals.length) {
    const ids = [...new Set(signals.flatMap((pair) => pair.signalId !== null && Number.isSafeInteger(pair.signalId) && pair.signalId > 0 ? [pair.signalId] : []))];
    return { ...base, basis: "done_together", signalIds: ids.sort((a, b) => a - b).slice(0, 20) };
  }
  if (yesDays >= SCHEDULE_PAIRING_RULES.minYesDays) return { ...base, basis: "brief_yes", signalIds: [] };
  return null;
}

/** The decision for one guest and host. */
export function evaluateSchedulePairing(input: Readonly<{
  today: string;
  guest: SchedulePairingBehavior;
  host: SchedulePairingBehavior;
  evidence: SchedulePairingEvidenceInput;
  declined: readonly DeclinedBehaviorChange[];
  /** Counted facts for the reason line (done_together's together_days and window_days). */
  togetherDays?: Readonly<{ days: number; windowDays: number }> | null;
}>): SchedulePairingDecision {
  const { guest, host } = input;
  if (guest.id === host.id) return { ok: false, reason: "same_behavior" };
  const evidence = schedulePairingEvidence({ today: input.today, guestId: guest.id, hostId: host.id, evidence: input.evidence });
  if (!evidence) return { ok: false, reason: "no_evidence" };
  if (!guest.active || !host.active) return { ok: false, reason: "inactive_behavior" };
  if (guest.followsParentSchedule || host.followsParentSchedule) return { ok: false, reason: "follows_parent_schedule" };
  if ((guest.isOpportunity && guest.schedules.length === 0) || (host.isOpportunity && host.schedules.length === 0)) {
    return { ok: false, reason: "opportunity_without_schedule" };
  }
  if (guest.neverSuggestMove) return { ok: false, reason: "never_move" };
  if (!guest.alongside) return { ok: false, reason: "guest_not_alongside" };
  if (host.alongside) return { ok: false, reason: "host_alongside" };
  if (!guest.where || guest.where.kind === "unknown" || !host.where || host.where.kind === "unknown") return { ok: false, reason: "place_unknown" };
  if (!alongsideMayOverlap({ where: guest.where }, { kind: "item", where: host.where })) return { ok: false, reason: "place_differs" };
  if (guest.lengthMinutes !== null && host.lengthMinutes !== null && guest.lengthMinutes > host.lengthMinutes) return { ok: false, reason: "host_too_short" };

  const timed = sharedChange(guest.schedules, host.schedules);
  if (!timed.ok) return timed;
  const decision = evaluateBehaviorChangeCandidate({
    today: input.today,
    behavior: { id: guest.id, title: guest.title, active: guest.active, schedules: guest.schedules, lengthMinutes: guest.lengthMinutes },
    change: timed.change,
    evidence,
    hasOpenProposal: false,
    declined: input.declined,
    reason: schedulePairingReason({ guestTitle: guest.title, hostTitle: host.title, evidence, togetherDays: input.togetherDays ?? null }),
  });
  if (!decision.ok) return decision;
  return { ok: true, plan: { ...decision.plan, evidence } };
}

export type SchedulePairingCandidate = Readonly<{ guestId: string; hostId: string }>;

export type SchedulePairingOutcome = Readonly<{
  guestId: string;
  hostId: string;
  decision: SchedulePairingDecision;
}>;

/**
 * Every pair the evidence names, decided. Pairs come from done_together signals (the
 * alongside side is the guest; a pair where neither or both sides are alongside is
 * decided with the signal's own Behavior as guest and refused on the roles) and from Yes
 * answers (as answered). Ordered: pairs backed by both kinds of evidence, then more Yes
 * days, then by guest and host id. At most one accepted plan per guest.
 */
export function planSchedulePairings(input: Readonly<{
  today: string;
  behaviors: readonly SchedulePairingBehavior[];
  evidence: SchedulePairingEvidenceInput;
  declined: readonly DeclinedBehaviorChange[];
  /** done_together counts per signal Behavior and partner, for the reason line. */
  togetherDays?: ReadonlyMap<string, Readonly<{ days: number; windowDays: number }>>;
}>): SchedulePairingOutcome[] {
  const byId = new Map(input.behaviors.map((behavior) => [behavior.id, behavior]));
  const pairs = new Map<string, SchedulePairingCandidate>();
  for (const pair of input.evidence.doneTogether) {
    const flip = byId.get(pair.behaviorId)?.alongside !== true && byId.get(pair.otherBehaviorId)?.alongside === true;
    const [guestId, hostId] = flip ? [pair.otherBehaviorId, pair.behaviorId] : [pair.behaviorId, pair.otherBehaviorId];
    pairs.set(pairKey(guestId, hostId), { guestId, hostId });
  }
  for (const [key, days] of pairingYesDays(input.today, input.evidence.yes)) {
    if (days < 1) continue;
    const [guestId, hostId] = key.split("|") as [string, string];
    pairs.set(key, { guestId, hostId });
  }
  const yesDays = pairingYesDays(input.today, input.evidence.yes);
  const named = (pair: SchedulePairingCandidate) => input.evidence.doneTogether.some((item) =>
    (item.behaviorId === pair.guestId && item.otherBehaviorId === pair.hostId) || (item.behaviorId === pair.hostId && item.otherBehaviorId === pair.guestId));
  const days = (pair: SchedulePairingCandidate) => yesDays.get(pairKey(pair.guestId, pair.hostId)) ?? 0;
  const both = (pair: SchedulePairingCandidate) => Number(named(pair) && days(pair) >= SCHEDULE_PAIRING_RULES.minYesDays);
  const ordered = [...pairs.values()].sort((left, right) => both(right) - both(left) || days(right) - days(left)
    || left.guestId.localeCompare(right.guestId) || left.hostId.localeCompare(right.hostId));

  const planned = new Set<string>();
  const outcomes: SchedulePairingOutcome[] = [];
  for (const pair of ordered) {
    const guest = byId.get(pair.guestId), host = byId.get(pair.hostId);
    if (!guest || !host) {
      outcomes.push({ ...pair, decision: { ok: false, reason: "inactive_behavior" } });
      continue;
    }
    if (planned.has(pair.guestId)) {
      outcomes.push({ ...pair, decision: { ok: false, reason: "open_proposal" } });
      continue;
    }
    const together = input.togetherDays?.get(pairKey(pair.guestId, pair.hostId)) ?? input.togetherDays?.get(pairKey(pair.hostId, pair.guestId)) ?? null;
    const decision = evaluateSchedulePairing({ today: input.today, guest, host, evidence: input.evidence, declined: input.declined, togetherDays: together });
    if (decision.ok) planned.add(pair.guestId);
    outcomes.push({ ...pair, decision });
  }
  return outcomes;
}

/**
 * Whether the host still has the proposal's new time on every weekday the change covers,
 * so the change still puts the guest at its host's time. Checked when the proposal is
 * shown and again before a Yes applies it.
 */
export function schedulePairingHostHolds(host: Readonly<{ active: boolean; schedules: readonly ProposalSchedule[] }> | null,
  change: Pick<BehaviorChange, "weekdays" | "toTime">): boolean {
  if (!host || !host.active) return false;
  const days = new Set(weekdaysWithSetTime(host.schedules, change.toTime));
  return change.weekdays.every((day) => days.has(day));
}

/**
 * The reason under the proposal line, from counted facts:
 * "You did Magnesium and Read on the same day on 18 of the last 28 days." or
 * "You said Yes to Magnesium during Read on 4 days in the last 28."
 */
export function schedulePairingReason(input: Readonly<{
  guestTitle: string;
  hostTitle: string;
  evidence: Extract<BehaviorChangeEvidence, { source: "alongside_pairing" }>;
  togetherDays?: Readonly<{ days: number; windowDays: number }> | null;
}>): string {
  if (input.evidence.basis === "brief_yes") {
    return `You said Yes to ${input.guestTitle} during ${input.hostTitle} on ${input.evidence.yesDays} days in the last ${input.evidence.windowDays}.`;
  }
  const counted = input.togetherDays;
  if (counted && Number.isInteger(counted.days) && counted.days > 0 && Number.isInteger(counted.windowDays) && counted.windowDays >= counted.days) {
    return `You did ${input.guestTitle} and ${input.hostTitle} on the same day on ${counted.days} of the last ${counted.windowDays} days.`;
  }
  return `You usually do ${input.guestTitle} on the same days as ${input.hostTitle}.`;
}

// ------------------------------------------------------------------ helpers

function pairKey(guestId: string, hostId: string): string {
  return `${guestId}|${hostId}`;
}

type Entry = ProposalSchedule["time_entries"][number];

/** Per weekday: every time entry the schedules put there, or null when a schedule is not on fixed weekdays. */
function entriesByWeekday(schedules: readonly ProposalSchedule[]): Map<Weekday, Entry[]> | null {
  const days = new Map<Weekday, Entry[]>();
  for (const schedule of schedules) {
    const weekdays = scheduleWeekdays(schedule);
    if (weekdays === null) return null;
    for (const day of weekdays) days.set(day, [...(days.get(day) ?? []), ...schedule.time_entries]);
  }
  return days;
}

function sharedChange(guestSchedules: readonly ProposalSchedule[], hostSchedules: readonly ProposalSchedule[]):
  Readonly<{ ok: true; change: BehaviorChange }> | Readonly<{ ok: false; reason: SchedulePairingSkipReason }> {
  const guest = entriesByWeekday(guestSchedules), host = entriesByWeekday(hostSchedules);
  if (!guest || !host) return { ok: false, reason: "unsupported_schedule" };
  const shared = WEEKDAYS.filter((day) => (guest.get(day)?.length ?? 0) > 0 && (host.get(day)?.length ?? 0) > 0);
  if (!shared.length) return { ok: false, reason: "no_shared_days" };
  let fromTime: string | null = null, toTime: string | null = null;
  for (const day of shared) {
    const mine = guest.get(day)!, theirs = host.get(day)!;
    if (mine.length !== 1) return { ok: false, reason: "guest_time_unclear" };
    if (mine[0]!.kind !== "exact") return { ok: false, reason: "range_time" };
    if (theirs.length !== 1 || theirs[0]!.kind !== "exact") return { ok: false, reason: "host_time_unclear" };
    const from = startOf(mine[0]!), to = startOf(theirs[0]!);
    if ((fromTime !== null && from !== fromTime) || (toTime !== null && to !== toTime)) return { ok: false, reason: "times_differ_by_day" };
    fromTime = from;
    toTime = to;
  }
  if (fromTime === toTime) return { ok: false, reason: "already_paired" };
  return { ok: true, change: { weekdays: shared, fromTime: fromTime!, toTime: toTime! } };
}

function startOf(entry: Entry): string {
  return "start_time" in entry ? entry.start_time.slice(0, 5) : "";
}
