import { Temporal } from "@js-temporal/polyfill";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BehaviorChangeProposalRow } from "@/lib/db/behavior-change-proposals.repo";
import type { BehaviorWithCategory } from "@/lib/db/behaviors.repo";

// Advisor Phase 4C: the answer flow, with the database functions replaced by an
// in-memory copy of their status rules.

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  answer: vi.fn(),
  getBehavior: vi.fn(),
  timezone: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/db/behavior-change-proposals.repo", async (original) => ({
  ...(await original<typeof import("@/lib/db/behavior-change-proposals.repo")>()),
  readBehaviorChangeProposal: mocks.read,
  answerBehaviorChangeProposal: mocks.answer,
}));
vi.mock("@/lib/db/behaviors.repo", () => ({
  getBehaviorById: mocks.getBehavior,
  getProfileTimezone: mocks.timezone,
  listUserBehaviors: vi.fn(),
}));
vi.mock("@/lib/services/behavior.service", () => ({ updateBehaviorForUser: mocks.update }));

const { answerScheduleProposal, readScheduleProposal, proposalSchedules } = await import("@/lib/services/behavior-change-proposals.service");
const { buildChangedSchedules } = await import("@cadence/core/services/behavior-change-proposal");

const USER = "00000000-0000-4000-8000-000000000001";
const GYM = "00000000-0000-4000-8000-000000000010";
const SCHEDULE = "00000000-0000-4000-8000-000000000011";
const SLOT = "00000000-0000-4000-8000-000000000012";
const PROPOSAL = "00000000-0000-4000-8000-000000000099";
const at = "2026-10-01T12:00:00Z";

function gym(days: string[], time = "07:00:00", extraSchedules: BehaviorWithCategory["schedules"] = []): BehaviorWithCategory {
  const slot = { id: SLOT, user_id: USER, behavior_id: GYM, behavior_schedule_id: SCHEDULE, kind: "exact", preset: null,
    start_time: time, end_time: null, sort_order: 0, created_at: at, updated_at: at };
  return {
    id: GYM, user_id: USER, category_id: null, category: null, title: "Gym", description: null, location_text: null,
    recurrence_rule: { frequency: "weekly", interval: 1, daysOfWeek: days }, scheduled_time: time, timezone: "America/New_York",
    browser_reminder_enabled: true, email_reminder_enabled: false, reminder_offset_minutes: 0, active: true, archived_at: null,
    auto_archived_at: null, end_date: null, default_duration_minutes: 60, archive_notes: [], current_configuration_event_id: SLOT,
    created_at: at, updated_at: "2026-11-01T00:00:00Z", schedule_slots: [slot],
    schedules: [{ id: SCHEDULE, user_id: USER, behavior_id: GYM, recurrence_rule: { frequency: "weekly", interval: 1, daysOfWeek: days },
      sort_order: 0, created_at: at, updated_at: at, schedule_slots: [slot] }, ...(extraSchedules ?? [])],
  } as unknown as BehaviorWithCategory;
}

const before = proposalSchedules(gym(["monday", "tuesday", "thursday"]));
const built = buildChangedSchedules(before, { weekdays: ["tuesday"], fromTime: "07:00", toTime: "18:30" });
if (!built.ok) throw new Error("fixture");
const after = built.schedules;

let row: BehaviorChangeProposalRow;
let behavior: BehaviorWithCategory;

function proposed(overrides: Partial<BehaviorChangeProposalRow> = {}): BehaviorChangeProposalRow {
  return {
    id: PROPOSAL, behaviorId: GYM, createdLocalDate: "2026-11-19", weekdays: ["tuesday"], fromTime: "07:00", toTime: "18:30",
    direction: "later", schedulesBefore: before, schedulesAfter: after, firstAffectedDate: "2026-11-24",
    reason: "You moved it to about 6:30 PM on 4 of the last 5 Tuesdays.", status: "proposed", closeReason: null,
    acceptedLocalDate: null, checkInDate: null, noticeShownAt: null, replayed: false, ...overrides,
  };
}

/** A caller at a given instant. */
function caller(instant: string) {
  return { supabase: {} as never, userId: USER, now: Temporal.Instant.from(instant) };
}

beforeEach(() => {
  vi.clearAllMocks();
  row = proposed();
  behavior = gym(["monday", "tuesday", "thursday"]);
  mocks.timezone.mockResolvedValue("America/New_York");
  mocks.getBehavior.mockImplementation(async () => behavior);
  mocks.read.mockImplementation(async () => (["proposed", "accepted_trial"].includes(row.status)
    || (row.status === "kept" && !row.noticeShownAt && row.closeReason !== "kept") ? { ...row } : null));
  mocks.answer.mockImplementation(async (_client: unknown, input: { answer: string; today: string; checkInDate?: string | null }) => {
    const target: Record<string, [string, string | null]> = {
      try: ["accepted_trial", null], for_good: ["accepted", null], no: ["declined", null], schedule_changed: ["expired", "schedule_changed"],
      keep: ["kept", "kept"], go_back: ["reverted", null], edited: ["kept", "edited_during_trial"],
    };
    if (input.answer === "notice_seen") { row = { ...row, noticeShownAt: "now" }; return { ...row }; }
    const [status, close] = target[input.answer]!;
    if (row.status === status && row.closeReason === close) return { ...row, replayed: true };
    row = {
      ...row, status: status as never, closeReason: close as never,
      ...(input.answer === "try" ? { acceptedLocalDate: input.today, checkInDate: input.checkInDate! } : {}),
      ...(input.answer === "edited" ? { noticeShownAt: "now" } : {}),
    };
    return { ...row };
  });
  mocks.update.mockImplementation(async (_client: unknown, _user: string, input: { values: { schedules: unknown[] } }) => {
    const schedules = input.values.schedules as Array<{ recurrenceRule: { daysOfWeek: string[] }; timeEntries: Array<{ startTime: string }> }>;
    // Rebuild the fixture from what was written, as the database would.
    const [first, ...rest] = schedules;
    behavior = gym(first!.recurrenceRule.daysOfWeek, `${first!.timeEntries[0]!.startTime}:00`, rest.map((schedule, i) => {
      const id = `00000000-0000-4000-8000-0000000002${i}0`;
      const slot = { id: `00000000-0000-4000-8000-0000000003${i}0`, user_id: USER, behavior_id: GYM, behavior_schedule_id: id, kind: "exact",
        preset: null, start_time: `${schedule.timeEntries[0]!.startTime}:00`, end_time: null, sort_order: 0, created_at: at, updated_at: at };
      return { id, user_id: USER, behavior_id: GYM, recurrence_rule: { frequency: "weekly", interval: 1, daysOfWeek: schedule.recurrenceRule.daysOfWeek },
        sort_order: i + 1, created_at: at, updated_at: at, schedule_slots: [slot] };
    }) as never);
    return behavior;
  });
});

// Thursday Nov 19, 2026, 10:00 in New York.
const THURSDAY = "2026-11-19T15:00:00Z";

describe("showing a proposal", () => {
  it("shows the fixed line with before and after", async () => {
    expect(await readScheduleProposal(caller(THURSDAY))).toEqual({
      kind: "proposal", proposalId: PROPOSAL, behaviorId: GYM,
      line: "Change your schedule: Gym at 6:30 PM every Tuesday from Tuesday, Nov 24 (now 7:00 AM).",
      reason: row.reason,
      before: ["Monday, Tuesday and Thursday at 7:00 AM"],
      after: ["Monday and Thursday at 7:00 AM", "Tuesday at 6:30 PM"],
      firstAffectedDate: "2026-11-24", answers: ["try", "for_good", "no"],
    });
  });

  it("holds on the weekday it changes, so today's item never moves", async () => {
    expect(await readScheduleProposal(caller("2026-11-24T15:00:00Z"))).toEqual({ kind: "hold", proposalId: PROPOSAL, reason: "affected_weekday_today" });
    await expect(answerScheduleProposal(caller("2026-11-24T15:00:00Z"), { proposalId: PROPOSAL, answer: "try" })).rejects.toMatchObject({ code: "held_today" });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("closes a proposal whose schedule changed before the answer", async () => {
    behavior = gym(["monday", "tuesday", "thursday"], "08:00:00");
    expect(await readScheduleProposal(caller(THURSDAY))).toEqual({ kind: "none" });
    expect(row.status).toBe("expired");
  });
});

describe("answers", () => {
  it("Try applies the exact intended schedule list and sets the check-in fourteen days out", async () => {
    const result = await answerScheduleProposal(caller(THURSDAY), { proposalId: PROPOSAL, answer: "try" });
    expect(mocks.update).toHaveBeenCalledTimes(1);
    const written = mocks.update.mock.calls[0]![2] as { expectedUpdatedAt: string; values: { schedules: Array<{ id?: string | null; recurrenceRule: unknown; timeEntries: Array<{ id?: string | null; startTime: string }> }> } };
    expect(written.expectedUpdatedAt).toBe("2026-11-01T00:00:00Z");
    expect(written.values.schedules.map((s) => ({ id: s.id ?? null, rule: s.recurrenceRule, times: s.timeEntries.map((e) => [e.id ?? null, e.startTime]) }))).toEqual([
      { id: SCHEDULE, rule: { frequency: "weekly", interval: 1, daysOfWeek: ["monday", "thursday"] }, times: [[SLOT, "07:00"]] },
      { id: null, rule: { frequency: "weekly", interval: 1, daysOfWeek: ["tuesday"] }, times: [[null, "18:30"]] },
    ]);
    expect(row).toMatchObject({ status: "accepted_trial", acceptedLocalDate: "2026-11-19", checkInDate: "2026-12-03" });
    expect(result).toMatchObject({ applied: true, view: { kind: "trial", checkInDate: "2026-12-03" } });
    expect(result.message).toBe("Gym is at 6:30 PM from Tuesday, Nov 24. Cadence asks on Thursday, Dec 3 whether to keep it.");
  });

  it("a repeated Try after the edit only records the answer", async () => {
    await answerScheduleProposal(caller(THURSDAY), { proposalId: PROPOSAL, answer: "try" });
    const again = await answerScheduleProposal(caller(THURSDAY), { proposalId: PROPOSAL, answer: "try" });
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(again).toMatchObject({ applied: false, replayed: true });
  });

  it("No changes nothing", async () => {
    await answerScheduleProposal(caller(THURSDAY), { proposalId: PROPOSAL, answer: "no" });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(row.status).toBe("declined");
  });

  it("Go back restores the old schedule after the check-in day", async () => {
    await answerScheduleProposal(caller(THURSDAY), { proposalId: PROPOSAL, answer: "try" });
    const checkIn = "2026-12-03T15:00:00Z";
    expect(await readScheduleProposal(caller(checkIn))).toMatchObject({ kind: "check_in", question: "Keep Gym at 6:30 PM every Tuesday?" });
    const result = await answerScheduleProposal(caller(checkIn), { proposalId: PROPOSAL, answer: "go_back" });
    expect(result).toMatchObject({ applied: true, message: "Gym is back at 7:00 AM." });
    const restored = mocks.update.mock.calls[1]![2] as { values: { schedules: Array<{ id?: string | null; recurrenceRule: unknown }> } };
    expect(restored.values.schedules.map((s) => [s.id ?? null, s.recurrenceRule])).toEqual([
      [SCHEDULE, { frequency: "weekly", interval: 1, daysOfWeek: ["monday", "tuesday", "thursday"] }],
    ]);
    expect(row.status).toBe("reverted");
  });

  it("Go back after a manual edit during the trial changes nothing and closes with one line (T4)", async () => {
    await answerScheduleProposal(caller(THURSDAY), { proposalId: PROPOSAL, answer: "try" });
    behavior = gym(["monday", "thursday"], "06:00:00");
    const checkIn = "2026-12-03T15:00:00Z";
    const view = await readScheduleProposal(caller(checkIn));
    expect(view).toEqual({ kind: "notice", proposalId: PROPOSAL, behaviorId: GYM,
      text: "You changed Gym's schedule during the trial, so it stays as you set it." });
    expect(mocks.update).toHaveBeenCalledTimes(1);
    await expect(answerScheduleProposal(caller(checkIn), { proposalId: PROPOSAL, answer: "go_back" })).rejects.toMatchObject({ code: "proposal_closed" });
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });

  it("refuses Keep and Go back before the check-in day", async () => {
    await answerScheduleProposal(caller(THURSDAY), { proposalId: PROPOSAL, answer: "try" });
    await expect(answerScheduleProposal(caller("2026-12-01T15:00:00Z"), { proposalId: PROPOSAL, answer: "keep" })).rejects.toMatchObject({ code: "proposal_closed" });
  });
});

describe("the check-in day", () => {
  beforeEach(() => {
    row = proposed({ status: "accepted_trial", acceptedLocalDate: "2026-11-19", checkInDate: "2026-12-03" });
    behavior = gym(["monday", "thursday"]);
    // The trial's schedule: Monday and Thursday 07:00 plus Tuesday 18:30.
    mocks.getBehavior.mockImplementation(async () => {
      const base = gym(["monday", "thursday"]);
      const slot = { ...base.schedule_slots[0]!, id: "00000000-0000-4000-8000-000000000301", behavior_schedule_id: "00000000-0000-4000-8000-000000000201", start_time: "18:30:00" };
      return { ...base, schedules: [...base.schedules!, { ...base.schedules![0]!, id: "00000000-0000-4000-8000-000000000201",
        recurrence_rule: { frequency: "weekly", interval: 1, daysOfWeek: ["tuesday"] }, schedule_slots: [slot] }] } as BehaviorWithCategory;
    });
  });

  it("asks on the right day after the person moves to another timezone", async () => {
    // 03:00 UTC on Dec 3 is still Dec 2 in Los Angeles, and already Dec 3 in Berlin.
    mocks.timezone.mockResolvedValue("America/Los_Angeles");
    expect(await readScheduleProposal(caller("2026-12-03T03:00:00Z"))).toMatchObject({ kind: "trial" });
    mocks.timezone.mockResolvedValue("Europe/Berlin");
    expect(await readScheduleProposal(caller("2026-12-03T03:00:00Z"))).toMatchObject({ kind: "check_in" });
  });

  it("asks on the right day across a clock change", async () => {
    row = proposed({ status: "accepted_trial", acceptedLocalDate: "2026-10-25", checkInDate: "2026-11-08" });
    // 23:30 on Nov 7 in New York (after the Nov 1 change, UTC-5) is still the trial.
    expect(await readScheduleProposal(caller("2026-11-08T04:30:00Z"))).toMatchObject({ kind: "trial" });
    // 00:30 on Nov 8 asks.
    expect(await readScheduleProposal(caller("2026-11-08T05:30:00Z"))).toMatchObject({ kind: "check_in" });
  });

  it("a kept trial with no answer says so once", async () => {
    row = proposed({ status: "kept", closeReason: "no_answer", acceptedLocalDate: "2026-11-19", checkInDate: "2026-12-03" });
    expect(await readScheduleProposal(caller("2026-12-11T15:00:00Z"))).toEqual({
      kind: "notice", proposalId: PROPOSAL, behaviorId: GYM, text: "Gym stays at 6:30 PM every Tuesday. You can change it in Behaviors.",
    });
    expect(await readScheduleProposal(caller("2026-12-11T16:00:00Z"))).toEqual({ kind: "none" });
  });
});
