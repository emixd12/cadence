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
  coachState: vi.fn(),
  coachPropose: vi.fn(),
  listBehaviors: vi.fn(),
}));

vi.mock("@/lib/db/behavior-change-proposals.repo", async (original) => ({
  ...(await original<typeof import("@/lib/db/behavior-change-proposals.repo")>()),
  readBehaviorChangeProposal: mocks.read,
  answerBehaviorChangeProposal: mocks.answer,
  readCoachBehaviorChangeState: mocks.coachState,
  coachProposeBehaviorChange: mocks.coachPropose,
}));
vi.mock("@/lib/db/behaviors.repo", () => ({
  getBehaviorById: mocks.getBehavior,
  getProfileTimezone: mocks.timezone,
  listUserBehaviors: mocks.listBehaviors,
}));
vi.mock("@/lib/services/behavior.service", () => ({ updateBehaviorForUser: mocks.update }));

const { answerScheduleProposal, readScheduleProposal, proposalSchedules, proposeBehaviorChangesForVisit, proposeTipOffers } = await import("@/lib/services/behavior-change-proposals.service");
const { buildChangedSchedules } = await import("@cadence/core/services/behavior-change-proposal");

const USER = "00000000-0000-4000-8000-000000000001";
const GYM = "00000000-0000-4000-8000-000000000010";
const SCHEDULE = "00000000-0000-4000-8000-000000000011";
const SLOT = "00000000-0000-4000-8000-000000000012";
const PROPOSAL = "00000000-0000-4000-8000-000000000099";
const at = "2026-10-01T12:00:00Z";

function gym(days: string[], time = "07:00:00", extraSchedules: BehaviorWithCategory["schedules"] = [], length = 60): BehaviorWithCategory {
  const slot = { id: SLOT, user_id: USER, behavior_id: GYM, behavior_schedule_id: SCHEDULE, kind: "exact", preset: null,
    start_time: time, end_time: null, sort_order: 0, created_at: at, updated_at: at };
  return {
    id: GYM, user_id: USER, category_id: null, category: null, title: "Gym", description: null, location_text: null,
    recurrence_rule: { frequency: "weekly", interval: 1, daysOfWeek: days }, scheduled_time: time, timezone: "America/New_York",
    browser_reminder_enabled: true, email_reminder_enabled: false, reminder_offset_minutes: 0, active: true, archived_at: null,
    auto_archived_at: null, end_date: null, default_duration_minutes: length, archive_notes: [], current_configuration_event_id: SLOT,
    created_at: at, updated_at: "2026-11-01T00:00:00Z", schedule_slots: [slot],
    schedules: [{ id: SCHEDULE, user_id: USER, behavior_id: GYM, recurrence_rule: { frequency: "weekly", interval: 1, daysOfWeek: days },
      sort_order: 0, created_at: at, updated_at: at, schedule_slots: [slot] }, ...(extraSchedules ?? [])],
  } as unknown as BehaviorWithCategory;
}

const before = proposalSchedules(gym(["monday", "tuesday", "thursday"]));
const built = buildChangedSchedules(before, { weekdays: ["tuesday"], fromTime: "07:00", toTime: "18:30" });
if (!built.ok) throw new Error("fixture");
const after = built.schedules;

/** A value as jsonb gives it back: object keys ordered by length, then bytewise. */
function jsonbOrder<T>(value: T): T {
  if (Array.isArray(value)) return value.map(jsonbOrder) as T;
  if (value === null || typeof value !== "object") return value;
  const keys = Object.keys(value).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(keys.map((key) => [key, jsonbOrder((value as Record<string, unknown>)[key])])) as T;
}

let row: BehaviorChangeProposalRow;
let behavior: BehaviorWithCategory;

function proposed(overrides: Partial<Extract<BehaviorChangeProposalRow, { changeKind: "time" }>> = {}): BehaviorChangeProposalRow {
  return {
    id: PROPOSAL, behaviorId: GYM, createdLocalDate: "2026-11-19", changeKind: "time", weekdays: ["tuesday"], fromTime: "07:00", toTime: "18:30",
    direction: "later", schedulesBefore: jsonbOrder(before), schedulesAfter: jsonbOrder(after), firstAffectedDate: "2026-11-24",
    reason: "You moved it to about 6:30 PM on 4 of the last 28 days.", status: "proposed", closeReason: null,
    acceptedLocalDate: null, checkInDate: null, noticeShownAt: null, replayed: false, tip: null, ...overrides,
  };
}

function lengthProposal(overrides: Partial<Extract<BehaviorChangeProposalRow, { changeKind: "length" }>> = {}): BehaviorChangeProposalRow {
  return {
    id: PROPOSAL, behaviorId: GYM, createdLocalDate: "2026-11-19", changeKind: "length", fromMinutes: 60, toMinutes: 45, direction: "shorter",
    firstAffectedDate: "2026-11-19", reason: "Gym sessions ran about 45 minutes.", status: "proposed", closeReason: null,
    acceptedLocalDate: null, checkInDate: null, noticeShownAt: null, replayed: false,
    tip: { cardId: "set-the-length-it-takes", text: "Gym sessions ran about 45 minutes over the last 6 times." }, ...overrides,
  };
}

/** Today's Occurrences as the outcome line reads them (after the edit). */
let todayOccurrences: Array<{ status: string; schedule_start_time: string; effective_start_at: string | null }> = [];

function fakeSupabase() {
  const query = { select: () => query, eq: () => query, then: (resolve: (value: unknown) => unknown) => resolve({ data: todayOccurrences, error: null }) };
  return { from: () => query } as never;
}

/** A caller at a given instant. */
function caller(instant: string) {
  return { supabase: fakeSupabase(), userId: USER, now: Temporal.Instant.from(instant) };
}

beforeEach(() => {
  vi.clearAllMocks();
  row = proposed();
  behavior = gym(["monday", "tuesday", "thursday"]);
  mocks.timezone.mockResolvedValue("America/New_York");
  mocks.getBehavior.mockImplementation(async () => behavior);
  todayOccurrences = [];
  mocks.read.mockImplementation(async (_client: unknown, _today: string, proposalId?: string) => {
    // With an id the database returns that proposal whatever its status.
    if (proposalId) return proposalId === row.id ? { ...row } : null;
    return ["proposed", "accepted_trial"].includes(row.status)
      || (row.status === "kept" && !row.noticeShownAt && row.closeReason !== "kept") ? { ...row } : null;
  });
  mocks.answer.mockImplementation(async (_client: unknown, input: { answer: string; today: string; checkInDate?: string | null }) => {
    const target: Record<string, [string, string | null]> = {
      try: ["accepted_trial", null], for_good: ["accepted", null], no: ["declined", null], schedule_changed: ["expired", "schedule_changed"],
      keep: ["kept", "kept"], go_back: ["reverted", null], edited: ["kept", "edited_during_trial"], undo: ["reverted", "undone"],
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
  mocks.update.mockImplementation(async (_client: unknown, _user: string, input: { values: { schedules: unknown[]; defaultDurationMinutes: number | null } }) => {
    const schedules = input.values.schedules as Array<{ recurrenceRule: { daysOfWeek: string[] }; timeEntries: Array<{ startTime: string }> }>;
    const length = input.values.defaultDurationMinutes ?? 60;
    // Rebuild the fixture from what was written, as the database would.
    const [first, ...rest] = schedules;
    behavior = gym(first!.recurrenceRule.daysOfWeek, `${first!.timeEntries[0]!.startTime}:00`, rest.map((schedule, i) => {
      const id = `00000000-0000-4000-8000-0000000002${i}0`;
      const slot = { id: `00000000-0000-4000-8000-0000000003${i}0`, user_id: USER, behavior_id: GYM, behavior_schedule_id: id, kind: "exact",
        preset: null, start_time: `${schedule.timeEntries[0]!.startTime}:00`, end_time: null, sort_order: 0, created_at: at, updated_at: at };
      return { id, user_id: USER, behavior_id: GYM, recurrence_rule: { frequency: "weekly", interval: 1, daysOfWeek: schedule.recurrenceRule.daysOfWeek },
        sort_order: i + 1, created_at: at, updated_at: at, schedule_slots: [slot] };
    }) as never, length);
    return behavior;
  });
});

// Thursday Nov 19, 2026, 10:00 in New York.
const THURSDAY = "2026-11-19T15:00:00Z";

describe("showing a proposal", () => {
  it("shows the fixed line with before and after", async () => {
    expect(await readScheduleProposal(caller(THURSDAY))).toEqual({
      kind: "proposal", proposalId: PROPOSAL, behaviorId: GYM, changeKind: "time",
      line: "Change your schedule: Gym at 6:30 PM every Tuesday from Tuesday, Nov 24 (now 7:00 AM).",
      reason: row.reason,
      before: ["Monday, Tuesday and Thursday at 7:00 AM"],
      after: ["Monday and Thursday at 7:00 AM", "Tuesday at 6:30 PM"],
      firstAffectedDate: "2026-11-24", answers: ["try", "for_good", "no"], tip: null,
    });
  });

  it("a question from a tip carries the tip's sentence, Cadence's question and the card's research", async () => {
    row = proposed({ tip: { cardId: "set-it-where-you-keep-moving-it", text: "You moved Gym to about 6:30 PM on 3 Tuesdays." } });
    const view = await readScheduleProposal(caller(THURSDAY));
    expect(view).toMatchObject({
      kind: "proposal",
      tip: { text: "You moved Gym to about 6:30 PM on 3 Tuesdays.", question: "Set Gym to 6:30 PM every Tuesday?", research: { cardId: "set-it-where-you-keep-moving-it" } },
    });
  });

  it("on the weekday it changes, the line starts today", async () => {
    expect(await readScheduleProposal(caller("2026-11-24T15:00:00Z"))).toMatchObject({
      kind: "proposal", firstAffectedDate: "2026-11-24",
      line: "Change your schedule: Gym at 6:30 PM every Tuesday, starting today (now 7:00 AM).",
    });
  });

  it("closes a proposal whose schedule changed before the answer", async () => {
    behavior = gym(["monday", "tuesday", "thursday"], "08:00:00");
    expect(await readScheduleProposal(caller(THURSDAY))).toEqual({ kind: "none" });
    expect(row.status).toBe("expired");
  });
});

describe("stored lists and retries", () => {
  it("the fixture lists really come back in jsonb key order", () => {
    if (row.changeKind !== "time") throw new Error("fixture");
    expect(Object.keys(row.schedulesBefore[0]!.recurrence)).not.toEqual(Object.keys(before[0]!.recurrence));
  });

  it("an applied Try whose record failed stays open, and a repeat records it without a second edit", async () => {
    mocks.answer.mockRejectedValueOnce(new Error("network"));
    await expect(answerScheduleProposal(caller(THURSDAY), { proposalId: PROPOSAL, answer: "try" })).rejects.toBeDefined();
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(row.status).toBe("proposed");
    expect(await readScheduleProposal(caller(THURSDAY))).toMatchObject({ kind: "proposal", proposalId: PROPOSAL });
    expect(row.status).toBe("proposed");
    // The repeat finds the change already made, so it only records the answer.
    const again = await answerScheduleProposal(caller("2026-11-24T15:00:00Z"), { proposalId: PROPOSAL, answer: "try" });
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(again).toMatchObject({ applied: false });
    expect(row.status).toBe("accepted_trial");
  });
});

describe("coach visits", () => {
  it("does not stop on the state read's open flag; the propose call settles and decides", async () => {
    mocks.coachState.mockResolvedValue({ hasOpen: true, declined: [] });
    mocks.listBehaviors.mockResolvedValue([behavior]);
    mocks.coachPropose.mockResolvedValue({ id: "00000000-0000-4000-8000-0000000000aa" });
    const tuesdays = ["2026-10-20", "2026-10-27", "2026-11-03", "2026-11-10", "2026-11-17"];
    const outcome = await proposeBehaviorChangesForVisit({} as never, {
      userId: USER, runId: "00000000-0000-4000-8000-0000000000bb", today: "2026-11-19",
      occurrences: tuesdays.map((date, i) => ({ id: `occ-${i}`, behaviorId: GYM, localDate: date, scheduleKind: "exact", startTime: "07:00:00" })),
      moves: tuesdays.slice(1).map((date, i) => ({
        occurrenceId: `occ-${i + 1}`, kind: "move" as const, chainPosition: 1, toPlanned: false,
        toStartAt: Temporal.PlainDateTime.from(`${date}T18:30`).toZonedDateTime("America/New_York").toInstant().toString(),
        timezone: "America/New_York",
      })),
    });
    expect(mocks.coachPropose).toHaveBeenCalledTimes(1);
    expect(outcome).toMatchObject({ proposed: true });
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
    expect(result.message).toBe("Gym is at 6:30 PM every Tuesday from Tuesday, Nov 24. Cadence asks on Thursday, Dec 3 whether to keep it.");
  });

  it("a Yes on the changed weekday moves today's Occurrence when it is still ahead and unmarked", async () => {
    // The schedule edit regenerated today's unmarked, future Occurrence at the new time.
    todayOccurrences = [{ status: "unresolved", schedule_start_time: "18:30:00", effective_start_at: null }];
    const result = await answerScheduleProposal(caller("2026-11-24T15:00:00Z"), { proposalId: PROPOSAL, answer: "for_good" });
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ applied: true, undoable: true, message: "Gym is at 6:30 PM every Tuesday, starting today." });
  });

  it("a day already moved by hand keeps its move; the change starts next week", async () => {
    // A hand move survives the schedule edit: today's Occurrence keeps its effective start.
    todayOccurrences = [{ status: "unresolved", schedule_start_time: "18:30:00", effective_start_at: "2026-11-24T17:00:00Z" }];
    const result = await answerScheduleProposal(caller("2026-11-24T15:00:00Z"), { proposalId: PROPOSAL, answer: "try" });
    expect(result.message).toBe("Gym is at 6:30 PM every Tuesday from Tuesday, Dec 1. Cadence asks on Tuesday, Dec 8 whether to keep it.");
  });

  it("Undo after Change for good restores the earlier schedule", async () => {
    await answerScheduleProposal(caller(THURSDAY), { proposalId: PROPOSAL, answer: "for_good" });
    expect(row.status).toBe("accepted");
    const result = await answerScheduleProposal(caller(THURSDAY), { proposalId: PROPOSAL, answer: "undo" });
    expect(result).toMatchObject({ applied: true, message: "Gym is back at 7:00 AM." });
    const restored = mocks.update.mock.calls[1]![2] as { values: { schedules: Array<{ id?: string | null; recurrenceRule: unknown }> } };
    expect(restored.values.schedules.map((s) => [s.id ?? null, s.recurrenceRule])).toEqual([
      [SCHEDULE, { frequency: "weekly", interval: 1, daysOfWeek: ["monday", "tuesday", "thursday"] }],
    ]);
    expect(row).toMatchObject({ status: "reverted", closeReason: "undone" });
    // A repeat replays.
    expect(await answerScheduleProposal(caller(THURSDAY), { proposalId: PROPOSAL, answer: "undo" })).toMatchObject({ applied: false, replayed: true });
    expect(mocks.update).toHaveBeenCalledTimes(2);
  });

  it("Undo after an edit since the tap changes nothing", async () => {
    await answerScheduleProposal(caller(THURSDAY), { proposalId: PROPOSAL, answer: "for_good" });
    behavior = gym(["monday", "thursday"], "06:00:00");
    await expect(answerScheduleProposal(caller(THURSDAY), { proposalId: PROPOSAL, answer: "undo" })).rejects.toMatchObject({ code: "schedule_changed" });
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(row.status).toBe("accepted");
  });

  it("Undo is refused for a trial or an open question", async () => {
    await expect(answerScheduleProposal(caller(THURSDAY), { proposalId: PROPOSAL, answer: "undo" })).rejects.toMatchObject({ code: "proposal_closed" });
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

describe("length questions", () => {
  beforeEach(() => { row = lengthProposal(); });

  it("shows the tip, its question and the length line", async () => {
    expect(await readScheduleProposal(caller(THURSDAY))).toMatchObject({
      kind: "proposal", changeKind: "length", firstAffectedDate: "2026-11-19",
      line: "Change the length: Gym to 45 minutes (now 1 hour).",
      tip: { question: "Set Gym to 45 minutes?", research: { cardId: "set-the-length-it-takes" } },
    });
  });

  it("Change for good sets the length on any day, and Undo puts it back", async () => {
    const result = await answerScheduleProposal(caller("2026-11-24T15:00:00Z"), { proposalId: PROPOSAL, answer: "for_good" });
    expect(result).toMatchObject({ applied: true, undoable: true, message: "Gym is now 45 minutes." });
    expect((mocks.update.mock.calls[0]![2] as { values: { defaultDurationMinutes: number } }).values.defaultDurationMinutes).toBe(45);
    expect(behavior.default_duration_minutes).toBe(45);
    const undone = await answerScheduleProposal(caller("2026-11-24T15:00:00Z"), { proposalId: PROPOSAL, answer: "undo" });
    expect(undone).toMatchObject({ applied: true, message: "Gym is back at 1 hour." });
    expect(behavior.default_duration_minutes).toBe(60);
  });

  it("a length changed by hand before the answer closes the question", async () => {
    behavior = gym(["monday", "tuesday", "thursday"], "07:00:00", [], 50);
    expect(await readScheduleProposal(caller(THURSDAY))).toEqual({ kind: "none" });
    expect(row.status).toBe("expired");
  });
});

describe("tip offers", () => {
  const RUN = "00000000-0000-4000-8000-0000000000bb";
  const tuesdays = ["2026-10-27", "2026-11-03", "2026-11-10", "2026-11-17"];
  const visit = {
    userId: USER, runId: RUN, today: "2026-11-19",
    occurrences: tuesdays.map((date, i) => ({ id: `occ-${i}`, behaviorId: GYM, localDate: date, scheduleKind: "exact" as const, startTime: "07:00:00" })),
    moves: tuesdays.slice(1).map((date, i) => ({
      occurrenceId: `occ-${i + 1}`, kind: "move" as const, chainPosition: 1, toPlanned: false,
      toStartAt: Temporal.PlainDateTime.from(`${date}T18:30`).toZonedDateTime("America/New_York").toInstant().toString(),
      timezone: "America/New_York",
    })),
  };
  const offer = { key: "0", kind: "set_time" as const, behaviorId: GYM, cardId: "set-it-where-you-keep-moving-it", tipText: "You moved Gym to about 6:30 PM on 3 Tuesdays.", facts: {} };

  beforeEach(() => {
    mocks.coachState.mockResolvedValue({ hasOpen: false, declined: [] });
    mocks.listBehaviors.mockResolvedValue([gym(["monday", "tuesday", "thursday"])]);
  });

  it("stores the tip's question with the change code computed from the moves", async () => {
    mocks.coachPropose.mockResolvedValue({ id: "00000000-0000-4000-8000-0000000000aa" });
    expect(await proposeTipOffers({} as never, { ...visit, offers: [offer] })).toEqual([{ key: "0", proposalId: "00000000-0000-4000-8000-0000000000aa", reason: null }]);
    const stored = mocks.coachPropose.mock.calls[0]![2] as { weekdays: string[]; to_time: string; evidence: { source: string; tip_text: string }; first_affected_date: string };
    expect(stored).toMatchObject({ weekdays: ["tuesday"], to_time: "18:30", first_affected_date: "2026-11-24", evidence: { source: "tip", tip_text: offer.tipText } });
  });

  it("links to the Behavior's open question from the same card, and refuses another card's", async () => {
    mocks.coachPropose.mockResolvedValue({ refused: "open_proposal", openId: PROPOSAL, openCardId: offer.cardId });
    expect(await proposeTipOffers({} as never, { ...visit, offers: [offer] })).toEqual([{ key: "0", proposalId: PROPOSAL, reason: null }]);
    mocks.coachPropose.mockResolvedValue({ refused: "open_proposal", openId: PROPOSAL, openCardId: null });
    expect(await proposeTipOffers({} as never, { ...visit, offers: [offer] })).toEqual([{ key: "0", proposalId: null, reason: "open_proposal" }]);
  });

  it("below the bar there is no question", async () => {
    expect(await proposeTipOffers({} as never, { ...visit, moves: visit.moves.slice(1), offers: [offer] }))
      .toEqual([{ key: "0", proposalId: null, reason: "below_bar" }]);
    expect(mocks.coachPropose).not.toHaveBeenCalled();
  });

  it("a length offer rounds the usual session time to 5 minutes", async () => {
    mocks.coachPropose.mockResolvedValue({ id: "00000000-0000-4000-8000-0000000000ac" });
    const result = await proposeTipOffers({} as never, { ...visit, offers: [{ ...offer, kind: "set_length", cardId: "set-the-length-it-takes", facts: { median_minutes: 43, sessions: 6 } }] });
    expect(result[0]?.proposalId).toBe("00000000-0000-4000-8000-0000000000ac");
    expect(mocks.coachPropose.mock.calls[0]![2]).toMatchObject({ change_kind: "length", from_minutes: 60, to_minutes: 45 });
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
