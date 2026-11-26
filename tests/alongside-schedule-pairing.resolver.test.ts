import { describe, expect, it } from "vitest";

import {
  NO_SCHEDULE_PAIRING_EVIDENCE,
  SCHEDULE_PAIRING_RULES,
  evaluateSchedulePairing,
  pairingYesDays,
  planSchedulePairings,
  schedulePairingEvidence,
  schedulePairingHostHolds,
  schedulePairingReason,
  type SchedulePairingBehavior,
  type SchedulePairingEvidenceInput,
  type SchedulePairingYes,
} from "@/lib/resolvers/alongside-schedule-pairing.resolver";
import {
  describeSchedules,
  toProposeBehaviorChangeInput,
  validateProposeBehaviorChangeInput,
  weekdaysWithSetTime,
  type ProposalSchedule,
} from "@cadence/core/services/behavior-change-proposal";
import type { Weekday } from "@cadence/core/types/recurrence";

// Ticket 362 (D33, "Pairing the schedule"): when the coach may propose moving an
// alongside Behavior's set time to its host's. Ways this could go wrong, each covered:
// proposing without evidence or on three Yes days; counting the same day twice or a Yes
// for another host; swapping guest and host; changing the guest on days the host is not
// scheduled; guessing on every N days, every N weeks or monthly schedules; pairing a
// routine step, an Opportunity Behavior without a schedule or a "Don't suggest moving
// this" guest; pairing at an unknown or different place; ignoring the cooldown.

const TODAY = "2026-11-25"; // a Wednesday
const PILL = "00000000-0000-4000-8000-0000000000a1";
const READ = "00000000-0000-4000-8000-0000000000b1";
const HELMET = "00000000-0000-4000-8000-0000000000c1";
const GYM = "00000000-0000-4000-8000-0000000000d1";
const ALL: readonly Weekday[] = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

function daily(time: string): ProposalSchedule[] {
  return [{ recurrence: { frequency: "daily", interval: 1 }, time_entries: [{ kind: "exact", start_time: time }] }];
}
function weekly(days: readonly Weekday[], time: string, interval = 1): ProposalSchedule[] {
  return [{ recurrence: { frequency: "weekly", interval, days_of_week: [...days] }, time_entries: [{ kind: "exact", start_time: time }] }];
}

function behavior(id: string, overrides: Partial<SchedulePairingBehavior> = {}): SchedulePairingBehavior {
  return {
    id, title: id === PILL ? "Magnesium" : id === READ ? "Read" : id === HELMET ? "Red light helmet" : "Gym",
    active: true, schedules: daily("07:00"), lengthMinutes: null, alongside: false, where: { kind: "home" },
    isOpportunity: false, followsParentSchedule: false, neverSuggestMove: false, ...overrides,
  };
}

const pill = (overrides: Partial<SchedulePairingBehavior> = {}) => behavior(PILL, { alongside: true, schedules: daily("07:00"), lengthMinutes: 5, ...overrides });
const read = (overrides: Partial<SchedulePairingBehavior> = {}) => behavior(READ, { schedules: daily("20:00"), lengthMinutes: 30, ...overrides });

const doneTogether: SchedulePairingEvidenceInput = { doneTogether: [{ behaviorId: PILL, otherBehaviorId: READ, signalId: 41 }], yes: [] };

function yes(dates: readonly string[], guest = PILL, host = READ): SchedulePairingYes[] {
  return dates.map((localDate) => ({ guestBehaviorId: guest, hostBehaviorId: host, localDate }));
}

function decide(guest: SchedulePairingBehavior, host: SchedulePairingBehavior, evidence: SchedulePairingEvidenceInput = doneTogether, declined = []) {
  return evaluateSchedulePairing({ today: TODAY, guest, host, evidence, declined });
}

describe("evidence", () => {
  it("the done_together signal names the pair in either direction", () => {
    expect(schedulePairingEvidence({ today: TODAY, guestId: PILL, hostId: READ, evidence: doneTogether })).toMatchObject({ basis: "done_together", signalIds: [41] });
    const reversed = { doneTogether: [{ behaviorId: READ, otherBehaviorId: PILL, signalId: null }], yes: [] };
    expect(schedulePairingEvidence({ today: TODAY, guestId: PILL, hostId: READ, evidence: reversed })).toMatchObject({ basis: "done_together", signalIds: [] });
  });

  it("four different days of Yes in the last 28 days count; three do not", () => {
    expect(SCHEDULE_PAIRING_RULES).toEqual({ minYesDays: 4, windowDays: 28 });
    const four = { doneTogether: [], yes: yes(["2026-11-25", "2026-11-20", "2026-11-10", "2026-10-29"]) };
    expect(schedulePairingEvidence({ today: TODAY, guestId: PILL, hostId: READ, evidence: four })).toMatchObject({ basis: "brief_yes", yesDays: 4 });
    const three = { doneTogether: [], yes: yes(["2026-11-25", "2026-11-20", "2026-11-10"]) };
    expect(schedulePairingEvidence({ today: TODAY, guestId: PILL, hostId: READ, evidence: three })).toBeNull();
  });

  it("the same day twice, a day outside the window, a later day and a Yes for another host do not count", () => {
    const answers = [
      ...yes(["2026-11-25", "2026-11-25", "2026-11-20", "2026-11-10"]),
      ...yes(["2026-10-28"]), // 28 days before today: outside
      ...yes(["2026-11-26"]), // after today
      ...yes(["2026-11-02"], PILL, GYM),
      ...yes(["2026-11-03"], READ, PILL), // the other way round
    ];
    expect(pairingYesDays(TODAY, answers).get(`${PILL}|${READ}`)).toBe(3);
    expect(schedulePairingEvidence({ today: TODAY, guestId: PILL, hostId: READ, evidence: { doneTogether: [], yes: answers } })).toBeNull();
  });

  it("no evidence: nothing proposed", () => {
    expect(decide(pill(), read(), NO_SCHEDULE_PAIRING_EVIDENCE)).toEqual({ ok: false, reason: "no_evidence" });
  });
});

describe("the change", () => {
  it("moves the guest's set time to the host's on every day both are scheduled", () => {
    const decision = decide(pill(), read());
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.plan.change).toEqual({ weekdays: ALL, fromTime: "07:00", toTime: "20:00" });
    expect(describeSchedules(decision.plan.schedulesAfter)).toEqual(["Every day at 8:00 PM"]);
    expect(decision.plan.evidence).toEqual({ source: "alongside_pairing", basis: "done_together", hostBehaviorId: READ, signalIds: [41], yesDays: 0, windowDays: 28 });
    expect(decision.plan.reason).toBe("You usually do Magnesium on the same days as Read.");
  });

  it("keeps the guest's time on days the host is not scheduled", () => {
    const decision = decide(pill(), read({ schedules: weekly(["monday", "wednesday", "friday"], "20:00") }));
    if (!decision.ok) throw new Error(decision.reason);
    expect(decision.plan.weekdays).toEqual(["monday", "wednesday", "friday"]);
    expect(describeSchedules(decision.plan.schedulesAfter)).toEqual([
      "Tuesday, Thursday, Saturday and Sunday at 7:00 AM", "Monday, Wednesday and Friday at 8:00 PM",
    ]);
  });

  it("changes a weekly guest in place when the host covers all its days", () => {
    const decision = decide(pill({ schedules: weekly(["tuesday", "thursday"], "07:30") }), read());
    if (!decision.ok) throw new Error(decision.reason);
    expect(describeSchedules(decision.plan.schedulesAfter)).toEqual(["Tuesday and Thursday at 8:00 PM"]);
  });

  it("refuses schedules that do not land on fixed weekdays", () => {
    expect(decide(pill({ schedules: [{ recurrence: { frequency: "interval_days", interval_days: 2 }, time_entries: [{ kind: "exact", start_time: "07:00" }] }] }), read()))
      .toEqual({ ok: false, reason: "unsupported_schedule" });
    expect(decide(pill(), read({ schedules: [{ recurrence: { frequency: "monthly", interval: 1, day_of_month: 31 }, time_entries: [{ kind: "exact", start_time: "20:00" }] }] })))
      .toEqual({ ok: false, reason: "unsupported_schedule" });
    expect(decide(pill({ schedules: weekly(["monday"], "07:00", 2) }), read())).toEqual({ ok: false, reason: "unsupported_schedule" });
    expect(decide(pill({ schedules: [{ recurrence: { frequency: "daily", interval: 3 }, time_entries: [{ kind: "exact", start_time: "07:00" }] }] }), read()))
      .toEqual({ ok: false, reason: "unsupported_schedule" });
  });

  it("refuses ranges, two times on one day, times that differ by weekday, no shared day and a guest already there", () => {
    expect(decide(pill({ schedules: [{ recurrence: { frequency: "daily", interval: 1 }, time_entries: [{ kind: "range", preset: "morning" }] }] }), read()))
      .toEqual({ ok: false, reason: "range_time" });
    expect(decide(pill({ schedules: [{ recurrence: { frequency: "daily", interval: 1 }, time_entries: [{ kind: "exact", start_time: "07:00" }, { kind: "exact", start_time: "13:00" }] }] }), read()))
      .toEqual({ ok: false, reason: "guest_time_unclear" });
    expect(decide(pill(), read({ schedules: [{ recurrence: { frequency: "daily", interval: 1 }, time_entries: [{ kind: "range", preset: "evening" }] }] })))
      .toEqual({ ok: false, reason: "host_time_unclear" });
    expect(decide(pill(), read({ schedules: [...weekly(["monday"], "20:00"), ...weekly(["tuesday"], "21:00")] })))
      .toEqual({ ok: false, reason: "times_differ_by_day" });
    expect(decide(pill({ schedules: weekly(["saturday"], "07:00") }), read({ schedules: weekly(["monday"], "20:00") })))
      .toEqual({ ok: false, reason: "no_shared_days" });
    expect(decide(pill({ schedules: daily("20:00") }), read())).toEqual({ ok: false, reason: "already_paired" });
  });

  it("keeps the existing rules: a No in the last 30 days and a time collision", () => {
    expect(evaluateSchedulePairing({ today: TODAY, guest: pill(), host: read(), evidence: doneTogether,
      declined: [{ behaviorId: PILL, direction: "later", declinedOn: "2026-11-10" }] })).toEqual({ ok: false, reason: "declined_recently" });
    const twice = pill({ schedules: [...weekly(["monday"], "07:00"), ...weekly(["monday"], "20:00")] });
    expect(decide(twice, read())).toEqual({ ok: false, reason: "guest_time_unclear" });
  });
});

describe("never proposed", () => {
  it.each([
    ["a guest step that follows its routine's schedule", pill({ followsParentSchedule: true }), read(), "follows_parent_schedule"],
    ["a host step that follows its routine's schedule", pill(), read({ followsParentSchedule: true }), "follows_parent_schedule"],
    ["an Opportunity guest without a schedule", pill({ isOpportunity: true, schedules: [] }), read(), "opportunity_without_schedule"],
    ["an Opportunity host without a schedule", pill(), read({ isOpportunity: true, schedules: [] }), "opportunity_without_schedule"],
    ["a guest marked Don't suggest moving this", pill({ neverSuggestMove: true }), read(), "never_move"],
    ["a guest that is not alongside", pill({ alongside: false }), read(), "guest_not_alongside"],
    ["a host that is alongside", pill(), read({ alongside: true }), "host_alongside"],
    ["an unknown guest place", pill({ where: { kind: "unknown" } }), read(), "place_unknown"],
    ["a host place not read", pill(), read({ where: null }), "place_unknown"],
    ["a different place", pill({ where: { kind: "home" } }), read({ where: { kind: "elsewhere" } }), "place_differs"],
    ["two different saved places", pill({ where: { kind: "place", placeKey: "a" } }), read({ where: { kind: "place", placeKey: "b" } }), "place_differs"],
    ["a guest longer than its host", pill({ lengthMinutes: 45 }), read({ lengthMinutes: 30 }), "host_too_short"],
    ["an archived guest", pill({ active: false }), read(), "inactive_behavior"],
    ["the same Behavior", pill(), pill(), "same_behavior"],
  ] as const)("%s", (_name, guest, host, reason) => {
    expect(decide(guest, host)).toEqual({ ok: false, reason });
  });

  it("an Opportunity Behavior with a schedule and a guessed Anywhere may pair", () => {
    expect(decide(pill({ isOpportunity: true, where: { kind: "anywhere" } }), read()).ok).toBe(true);
  });
});

describe("planSchedulePairings", () => {
  it("takes the alongside side as guest when the signal names the host first", () => {
    const outcomes = planSchedulePairings({ today: TODAY, behaviors: [pill(), read()],
      evidence: { doneTogether: [{ behaviorId: READ, otherBehaviorId: PILL, signalId: 7 }], yes: [] }, declined: [] });
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ guestId: PILL, hostId: READ, decision: { ok: true } });
  });

  it("decides each named pair, more Yes days first, and plans at most one per guest", () => {
    const gym = behavior(GYM, { schedules: daily("18:00"), lengthMinutes: 60 });
    const outcomes = planSchedulePairings({
      today: TODAY, behaviors: [pill(), read(), gym, behavior(HELMET, { alongside: true, schedules: daily("21:00"), lengthMinutes: 10 })],
      evidence: {
        doneTogether: [{ behaviorId: PILL, otherBehaviorId: GYM, signalId: 3 }, { behaviorId: HELMET, otherBehaviorId: READ, signalId: 4 }],
        yes: yes(["2026-11-24", "2026-11-23", "2026-11-22", "2026-11-21", "2026-11-20"]),
      },
      declined: [],
      togetherDays: new Map([[`${HELMET}|${READ}`, { days: 18, windowDays: 28 }]]),
    });
    expect(outcomes.map((item) => [item.guestId, item.hostId, item.decision.ok ? "ok" : item.decision.reason])).toEqual([
      [PILL, READ, "ok"], [PILL, GYM, "open_proposal"], [HELMET, READ, "ok"],
    ]);
    const helmet = outcomes[2]!.decision;
    expect(helmet.ok && helmet.plan.reason).toBe("You did Red light helmet and Read on the same day on 18 of the last 28 days.");
    const first = outcomes[0]!.decision;
    expect(first.ok && first.plan.reason).toBe("You said Yes to Magnesium during Read on 5 days in the last 28.");
  });
});

describe("storage and the host check", () => {
  it("the plan becomes a valid propose_behavior_change input with ids and counts only", () => {
    const decision = decide(pill(), read());
    if (!decision.ok) throw new Error(decision.reason);
    const input = toProposeBehaviorChangeInput(decision.plan, TODAY, null);
    expect(input.evidence).toEqual({ source: "alongside_pairing", basis: "done_together", host_behavior_id: READ, signal_ids: [41], yes_days: 0, window_days: 28 });
    expect(input.first_affected_date).toBe(TODAY);
    expect(validateProposeBehaviorChangeInput(input).ok).toBe(true);
    expect(JSON.stringify(input.evidence)).not.toContain("Read");
  });

  it("a host that moved, dropped a weekday or was archived no longer holds", () => {
    const change = { weekdays: ["monday", "wednesday"] as Weekday[], toTime: "20:00" };
    expect(schedulePairingHostHolds({ active: true, schedules: daily("20:00") }, change)).toBe(true);
    expect(schedulePairingHostHolds({ active: true, schedules: daily("21:00") }, change)).toBe(false);
    expect(schedulePairingHostHolds({ active: true, schedules: weekly(["monday"], "20:00") }, change)).toBe(false);
    expect(schedulePairingHostHolds({ active: false, schedules: daily("20:00") }, change)).toBe(false);
    expect(schedulePairingHostHolds(null, change)).toBe(false);
    expect(weekdaysWithSetTime(daily("20:00"), "20:00")).toEqual(ALL);
  });

  it("writes a plain reason without counts when the signal gave none", () => {
    expect(schedulePairingReason({ guestTitle: "Magnesium", hostTitle: "Read",
      evidence: { source: "alongside_pairing", basis: "done_together", hostBehaviorId: READ, signalIds: [], yesDays: 0, windowDays: 28 },
      togetherDays: { days: 40, windowDays: 28 } })).toBe("You usually do Magnesium on the same days as Read.");
  });
});
