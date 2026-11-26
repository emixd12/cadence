import {
  planSchedulePairings,
  type SchedulePairingBehavior,
  type SchedulePairingEvidenceInput,
  type SchedulePairingSkipReason,
} from "@cadence/core/resolvers/alongside-schedule-pairing.resolver";
import {
  describeSchedules,
  scheduleWeekdays,
  schedulesEqual,
  toProposeBehaviorChangeInput,
  validateProposeBehaviorChangeInput,
  type ProposalSchedule,
} from "@cadence/core/services/behavior-change-proposal";
import { WEEKDAYS, type Weekday } from "@cadence/core/types/recurrence";

/**
 * Ticket 362 (D33, "Pairing the schedule"): offline coach eval fixtures for the pairing
 * proposal. No model writes anything here (the line and reason are Cadence's own), so the
 * eval is the rule run on synthetic accounts plus the person's answer: Change for good
 * (accept), No (refuse) or no question at all (refused by a guard, or no evidence). Every
 * fixture then goes through the layer-one rules below. No account data is read.
 */
export const COACH_PAIRING_EVAL_FIXTURE_VERSION = "coach-pairing-eval-2026-11-26.1";
export const COACH_PAIRING_EVAL_TODAY = "2026-11-25";

export type CoachPairingEvalExpectation =
  | Readonly<{ kind: "accept"; guest: string; host: string; schedulesAfter: readonly string[] }>
  | Readonly<{ kind: "refuse"; guest: string; host: string }>
  | Readonly<{ kind: "none"; reason: SchedulePairingSkipReason }>;

export type CoachPairingEvalFixture = Readonly<{
  id: string;
  description: string;
  behaviors: readonly SchedulePairingBehavior[];
  evidence: SchedulePairingEvidenceInput;
  expect: CoachPairingEvalExpectation;
}>;

const NOT_SET = { lengthMinutes: null, isOpportunity: false, followsParentSchedule: false, neverSuggestMove: false, active: true } as const;

function daily(time: string): ProposalSchedule[] {
  return [{ recurrence: { frequency: "daily", interval: 1 }, time_entries: [{ kind: "exact", start_time: time }] }];
}
function weekly(days: readonly Weekday[], time: string, interval = 1): ProposalSchedule[] {
  return [{ recurrence: { frequency: "weekly", interval, days_of_week: [...days] }, time_entries: [{ kind: "exact", start_time: time }] }];
}

const helmet = (overrides: Partial<SchedulePairingBehavior> = {}): SchedulePairingBehavior => ({
  ...NOT_SET, id: "helmet", title: "Red light helmet", schedules: daily("07:30"), lengthMinutes: 10, alongside: true, where: { kind: "home" }, ...overrides,
});
const read = (overrides: Partial<SchedulePairingBehavior> = {}): SchedulePairingBehavior => ({
  ...NOT_SET, id: "read", title: "Read", schedules: daily("20:00"), lengthMinutes: 30, alongside: false, where: { kind: "home" }, ...overrides,
});
const pill = (overrides: Partial<SchedulePairingBehavior> = {}): SchedulePairingBehavior => ({
  ...NOT_SET, id: "pill", title: "Magnesium", schedules: daily("07:00"), alongside: true, where: { kind: "anywhere" }, ...overrides,
});
const journal = (overrides: Partial<SchedulePairingBehavior> = {}): SchedulePairingBehavior => ({
  ...NOT_SET, id: "journal", title: "Journal", schedules: weekly(["monday", "tuesday", "wednesday", "thursday", "friday"], "21:30"),
  lengthMinutes: 15, alongside: false, where: { kind: "home" }, ...overrides,
});

const signal = (behaviorId: string, otherBehaviorId: string) => ({ doneTogether: [{ behaviorId, otherBehaviorId, signalId: 11 }], yes: [] });
const yesOn = (dates: readonly string[], guest = "pill", host = "journal") =>
  ({ doneTogether: [], yes: dates.map((localDate) => ({ guestBehaviorId: guest, hostBehaviorId: host, localDate })) });
const FOUR_DAYS = ["2026-11-24", "2026-11-19", "2026-11-10", "2026-11-02"];

export const COACH_PAIRING_EVAL_FIXTURES: readonly CoachPairingEvalFixture[] = [
  { id: "accept_done_together", description: "The helmet and Read are done on the same days; the person changes the helmet for good.",
    behaviors: [helmet(), read()], evidence: signal("helmet", "read"),
    expect: { kind: "accept", guest: "helmet", host: "read", schedulesAfter: ["Every day at 8:00 PM"] } },
  { id: "accept_brief_yes_weekdays", description: "Yes to the pill during Journal on four days; Journal is on weekdays only, so weekends keep 7:00 AM.",
    behaviors: [pill(), journal()], evidence: yesOn(FOUR_DAYS),
    expect: { kind: "accept", guest: "pill", host: "journal", schedulesAfter: ["Saturday and Sunday at 7:00 AM", "Monday, Tuesday, Wednesday, Thursday and Friday at 9:30 PM"] } },
  { id: "refuse_answer_no", description: "Same evidence as accept_done_together; the person answers No.",
    behaviors: [helmet(), read()], evidence: signal("read", "helmet"), expect: { kind: "refuse", guest: "helmet", host: "read" } },
  { id: "refuse_never_move", description: "The helmet is marked Don't suggest moving this.",
    behaviors: [helmet({ neverSuggestMove: true }), read()], evidence: signal("helmet", "read"), expect: { kind: "none", reason: "never_move" } },
  { id: "refuse_follows_routine", description: "The pill is a step that follows its routine's schedule.",
    behaviors: [pill({ followsParentSchedule: true }), journal()], evidence: yesOn(FOUR_DAYS), expect: { kind: "none", reason: "follows_parent_schedule" } },
  { id: "refuse_opportunity_without_schedule", description: "The pill is an Opportunity Behavior with no schedule.",
    behaviors: [pill({ isOpportunity: true, schedules: [] }), journal()], evidence: yesOn(FOUR_DAYS), expect: { kind: "none", reason: "opportunity_without_schedule" } },
  { id: "refuse_other_place", description: "The helmet is at home; the gym is somewhere else.",
    behaviors: [helmet(), read({ id: "gym", title: "Gym", where: { kind: "elsewhere" }, lengthMinutes: 60 })], evidence: signal("helmet", "gym"),
    expect: { kind: "none", reason: "place_differs" } },
  { id: "refuse_every_other_week", description: "Journal is every other week, so its days are not fixed weekdays.",
    behaviors: [pill(), journal({ schedules: weekly(["monday"], "21:30", 2) })], evidence: yesOn(FOUR_DAYS), expect: { kind: "none", reason: "unsupported_schedule" } },
  { id: "no_evidence_three_yes_days", description: "Yes on three days only.",
    behaviors: [pill(), journal()], evidence: yesOn(FOUR_DAYS.slice(0, 3)), expect: { kind: "none", reason: "no_evidence" } },
  { id: "no_evidence_none", description: "No done_together signal and no Yes answers.",
    behaviors: [helmet(), read()], evidence: { doneTogether: [], yes: [] }, expect: { kind: "none", reason: "no_evidence" } },
];

export const COACH_PAIRING_LAYER_ONE_RULES = [
  "expected_outcome", "proposed_without_evidence", "invalid_proposal", "guest_off_host_time", "other_days_changed", "changed_without_yes",
] as const;
export type CoachPairingLayerOneRule = typeof COACH_PAIRING_LAYER_ONE_RULES[number];

export type CoachPairingEvalResult = Readonly<{
  fixture: string;
  /** What the coach stored: the first plan, as the visit stores one per run. */
  proposed: Readonly<{ guest: string; host: string; line: readonly string[]; reason: string }> | null;
  skipped: SchedulePairingSkipReason | null;
  /** The guest's schedules after the person's answer. */
  after: readonly string[] | null;
  violations: readonly Readonly<{ rule: CoachPairingLayerOneRule; detail: string }>[];
}>;

export function runCoachPairingEval(fixtures: readonly CoachPairingEvalFixture[] = COACH_PAIRING_EVAL_FIXTURES): CoachPairingEvalResult[] {
  return fixtures.map((fixture) => {
    const violations: { rule: CoachPairingLayerOneRule; detail: string }[] = [];
    const outcomes = planSchedulePairings({ today: COACH_PAIRING_EVAL_TODAY, behaviors: fixture.behaviors, evidence: fixture.evidence, declined: [] });
    const first = outcomes.find((outcome) => outcome.decision.ok) ?? null;
    const skipped = first ? null : outcomes.at(-1)?.decision.ok === false ? (outcomes.at(-1)!.decision as { reason: SchedulePairingSkipReason }).reason : "no_evidence";
    const expect = fixture.expect;
    if (!first || !first.decision.ok) {
      if (expect.kind !== "none") violations.push({ rule: "expected_outcome", detail: `no proposal (${skipped})` });
      else if (skipped !== expect.reason) violations.push({ rule: "expected_outcome", detail: `skipped ${skipped}, expected ${expect.reason}` });
      return { fixture: fixture.id, proposed: null, skipped, after: null, violations };
    }
    const plan = first.decision.plan;
    if (expect.kind === "none") violations.push({ rule: "proposed_without_evidence", detail: `${first.guestId} during ${first.hostId}` });
    else if (expect.guest !== first.guestId || expect.host !== first.hostId) {
      violations.push({ rule: "expected_outcome", detail: `${first.guestId} during ${first.hostId}` });
    }
    // Fixture ids are short names; the stored input needs ids in uuid form.
    const stored = toProposeBehaviorChangeInput({ ...plan, behaviorId: fixtureUuid(first.guestId),
      evidence: { ...plan.evidence, hostBehaviorId: fixtureUuid(first.hostId) } }, COACH_PAIRING_EVAL_TODAY, null);
    if (!validateProposeBehaviorChangeInput(stored).ok) {
      violations.push({ rule: "invalid_proposal", detail: "propose_behavior_change input" });
    }
    const guest = fixture.behaviors.find((item) => item.id === first.guestId)!;
    const host = fixture.behaviors.find((item) => item.id === first.hostId)!;
    // The answer: Change for good writes the planned list; No writes nothing.
    const after = expect.kind === "accept" ? plan.schedulesAfter : guest.schedules;
    if (expect.kind !== "accept" && !schedulesEqual(after, guest.schedules)) violations.push({ rule: "changed_without_yes", detail: fixture.id });
    if (expect.kind === "accept") {
      for (const day of WEEKDAYS) {
        const hostTime = timesOn(host.schedules, day)[0] ?? null;
        const before = timesOn(guest.schedules, day), now = timesOn(after, day);
        if (hostTime && before.length) {
          if (now.join() !== hostTime) violations.push({ rule: "guest_off_host_time", detail: `${day}: ${now.join()} vs ${hostTime}` });
        } else if (now.join() !== before.join()) violations.push({ rule: "other_days_changed", detail: `${day}: ${before.join()} -> ${now.join()}` });
      }
      if (describeSchedules(after).join("|") !== expect.schedulesAfter.join("|")) {
        violations.push({ rule: "expected_outcome", detail: describeSchedules(after).join("; ") });
      }
    }
    return {
      fixture: fixture.id, skipped: null, after: describeSchedules(after), violations,
      proposed: { guest: first.guestId, host: first.hostId, line: describeSchedules(plan.schedulesAfter), reason: plan.reason },
    };
  });
}

function fixtureUuid(name: string): string {
  let hash = 0;
  for (const char of name) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  return `00000000-0000-4000-8000-${hash.toString(16).padStart(12, "0").slice(-12)}`;
}

function timesOn(schedules: readonly ProposalSchedule[], day: Weekday): string[] {
  return schedules.flatMap((schedule) => (scheduleWeekdays(schedule) ?? []).includes(day)
    ? schedule.time_entries.flatMap((entry) => "start_time" in entry ? [entry.start_time.slice(0, 5)] : []) : []);
}
