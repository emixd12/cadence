import { Temporal } from "@js-temporal/polyfill";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BehaviorChangeProposalRow } from "@/lib/db/behavior-change-proposals.repo";
import type { BehaviorWithCategory } from "@/lib/db/behaviors.repo";

// Ticket 362 (D33, "Pairing the schedule"): the coach's pairing proposal and the person's
// answer, with the database replaced by in-memory fakes. Ways this could fail, each
// covered: storing without evidence; reading more than signals and Yes rows when there is
// none; proposing for a "Don't suggest moving this" guest; storing a title in the
// evidence; showing or applying a pairing whose host moved; editing before the person
// answers.

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  answer: vi.fn(),
  getBehavior: vi.fn(),
  timezone: vi.fn(),
  update: vi.fn(),
  coachState: vi.fn(),
  coachPropose: vi.fn(),
  listBehaviors: vi.fn(),
  signals: vi.fn(),
  accepted: vi.fn(),
  neverMove: vi.fn(),
  planning: vi.fn(),
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
vi.mock("@/lib/db/advisor-tips.repo", () => ({ readStoredSignals: mocks.signals }));
vi.mock("@/lib/db/alongside-schedule-pairing.repo", () => ({
  readAcceptedBriefPairings: mocks.accepted,
  readNeverMoveBehaviorIds: mocks.neverMove,
}));
vi.mock("@/lib/services/brief-move-day.service", () => ({ readBehaviorPlanningFacts: mocks.planning }));
vi.mock("@/lib/services/behavior.service", () => ({ updateBehaviorForUser: mocks.update }));

const { answerScheduleProposal, proposalSchedules, proposeSchedulePairingsForVisit, readScheduleProposal } =
  await import("@/lib/services/behavior-change-proposals.service");

const USER = "00000000-0000-4000-8000-000000000001";
const PILL = "00000000-0000-4000-8000-0000000000a1";
const READ = "00000000-0000-4000-8000-0000000000b1";
const RUN = "00000000-0000-4000-8000-0000000000cc";
const PROPOSAL = "00000000-0000-4000-8000-000000000099";
const at = "2026-10-01T12:00:00Z";
const TODAY = "2026-11-25";
const ALL = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

function row(id: string, title: string, time: string, overrides: Record<string, unknown> = {}): BehaviorWithCategory {
  const schedule = `${id.slice(0, -2)}${id.slice(-2) === "a1" ? "a2" : "b2"}`;
  const slot = { id: `${id.slice(0, -2)}${id.slice(-2) === "a1" ? "a3" : "b3"}`, user_id: USER, behavior_id: id, behavior_schedule_id: schedule,
    kind: "exact", preset: null, start_time: `${time}:00`, end_time: null, sort_order: 0, created_at: at, updated_at: at };
  return {
    id, user_id: USER, category_id: null, category: null, title, description: null, location_text: null,
    recurrence_rule: { frequency: "daily", interval: 1 }, scheduled_time: `${time}:00`, timezone: "America/New_York",
    browser_reminder_enabled: true, email_reminder_enabled: false, reminder_offset_minutes: 0, active: true, archived_at: null,
    auto_archived_at: null, end_date: null, default_duration_minutes: title === "Read" ? 30 : 5, archive_notes: [],
    current_configuration_event_id: slot.id, created_at: at, updated_at: "2026-11-01T00:00:00Z", schedule_slots: [slot],
    is_opportunity: false, parent_behavior_id: null, inherit_parent_schedule: false,
    schedules: [{ id: schedule, user_id: USER, behavior_id: id, recurrence_rule: { frequency: "daily", interval: 1 },
      sort_order: 0, created_at: at, updated_at: at, schedule_slots: [slot] }],
    ...overrides,
  } as unknown as BehaviorWithCategory;
}

let behaviors: Map<string, BehaviorWithCategory>;
let proposal: BehaviorChangeProposalRow;

const planningFacts = (alongside: Record<string, boolean>) => new Map(Object.entries(alongside).map(([id, value]) => [id, {
  alongside: { value, source: "person" as const }, where: { kind: "home" as const, source: "person" as const }, questionOpen: false,
}]));

function caller() {
  const query = { select: () => query, eq: () => query, then: (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null }) };
  return { supabase: { from: () => query } as never, userId: USER, now: Temporal.Instant.from("2026-11-25T15:00:00Z") };
}

beforeEach(() => {
  vi.clearAllMocks();
  behaviors = new Map([[PILL, row(PILL, "Magnesium", "07:00")], [READ, row(READ, "Read", "20:00")]]);
  mocks.listBehaviors.mockImplementation(async () => [...behaviors.values()]);
  mocks.getBehavior.mockImplementation(async (_client: unknown, _user: string, id: string) => behaviors.get(id) ?? null);
  mocks.timezone.mockResolvedValue("America/New_York");
  mocks.coachState.mockResolvedValue({ hasOpen: false, declined: [] });
  mocks.coachPropose.mockResolvedValue({ id: PROPOSAL });
  mocks.signals.mockResolvedValue([]);
  mocks.accepted.mockResolvedValue([]);
  mocks.neverMove.mockResolvedValue(new Set());
  mocks.planning.mockResolvedValue(planningFacts({ [PILL]: true, [READ]: false }));
  const before = proposalSchedules(behaviors.get(PILL)!);
  proposal = {
    id: PROPOSAL, behaviorId: PILL, createdLocalDate: TODAY, changeKind: "time", weekdays: [...ALL], fromTime: "07:00", toTime: "20:00",
    direction: "later", schedulesBefore: before,
    schedulesAfter: [{ ...before[0]!, time_entries: [{ ...before[0]!.time_entries[0]!, start_time: "20:00" } as never] }],
    firstAffectedDate: TODAY, reason: "You did Magnesium and Read on the same day on 18 of the last 28 days.", status: "proposed",
    closeReason: null, acceptedLocalDate: null, checkInDate: null, noticeShownAt: null, replayed: false, tip: null,
    pairing: { hostBehaviorId: READ },
  };
  mocks.read.mockImplementation(async () => (["proposed", "accepted_trial"].includes(proposal.status) ? { ...proposal } : null));
  mocks.answer.mockImplementation(async (_client: unknown, input: { answer: string }) => {
    const target: Record<string, string> = { for_good: "accepted", no: "declined", schedule_changed: "expired", try: "accepted_trial" };
    proposal = { ...proposal, status: target[input.answer] as never, ...(input.answer === "schedule_changed" ? { closeReason: "schedule_changed" as const } : {}) };
    return { ...proposal };
  });
  mocks.update.mockImplementation(async () => {
    behaviors.set(PILL, row(PILL, "Magnesium", "20:00"));
    return behaviors.get(PILL);
  });
});

const visit = () => proposeSchedulePairingsForVisit({} as never, { userId: USER, runId: RUN, today: TODAY, env: { CADENCE_ALONGSIDE: "on" } });

describe("the coach's visit", () => {
  it("stores one pairing proposal from the done_together signal, with ids and counts only", async () => {
    mocks.signals.mockResolvedValue([{ id: "41", kind: "done_together", behaviorId: PILL,
      facts: { other_behavior_id: READ, together_days: 18, window_days: 28, alongside: true, other_alongside: false } }]);
    expect(await visit()).toEqual({ proposed: true, proposalId: PROPOSAL, behaviorId: PILL });
    expect(mocks.coachPropose).toHaveBeenCalledTimes(1);
    const stored = mocks.coachPropose.mock.calls[0]![2] as Record<string, unknown>;
    expect(stored).toMatchObject({
      behavior_id: PILL, change_kind: "time", weekdays: ALL, from_time: "07:00", to_time: "20:00", first_affected_date: TODAY,
      reason: "You did Magnesium and Read on the same day on 18 of the last 28 days.",
      evidence: { source: "alongside_pairing", basis: "done_together", host_behavior_id: READ, signal_ids: [41], yes_days: 0, window_days: 28 },
    });
    expect(JSON.stringify(stored.evidence)).not.toMatch(/Read|Magnesium/);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.accepted).toHaveBeenCalledWith(expect.anything(), USER, { since: "2026-10-29", until: TODAY });
  });

  it("stores one from four Yes days in the Daily Brief", async () => {
    mocks.accepted.mockResolvedValue(["2026-11-24", "2026-11-20", "2026-11-12", "2026-11-01"]
      .map((localDate) => ({ guestBehaviorId: PILL, hostBehaviorId: READ, localDate })));
    expect(await visit()).toMatchObject({ proposed: true });
    expect(mocks.coachPropose.mock.calls[0]![2]).toMatchObject({
      evidence: { basis: "brief_yes", yes_days: 4 }, reason: "You said Yes to Magnesium during Read on 4 days in the last 28.",
    });
  });

  it("no evidence: reads nothing more and stores nothing", async () => {
    expect(await visit()).toEqual({ proposed: false, reason: "no_evidence" });
    expect(mocks.listBehaviors).not.toHaveBeenCalled();
    expect(mocks.planning).not.toHaveBeenCalled();
    expect(mocks.coachPropose).not.toHaveBeenCalled();
  });

  it("three Yes days, a guest marked Don't suggest moving this, or a guest that is not alongside: nothing stored", async () => {
    mocks.accepted.mockResolvedValue(["2026-11-24", "2026-11-20", "2026-11-12"].map((localDate) => ({ guestBehaviorId: PILL, hostBehaviorId: READ, localDate })));
    expect(await visit()).toEqual({ proposed: false, reason: "no_evidence" });
    mocks.signals.mockResolvedValue([{ id: "41", kind: "done_together", behaviorId: PILL, facts: { other_behavior_id: READ } }]);
    mocks.neverMove.mockResolvedValue(new Set([PILL]));
    expect(await visit()).toEqual({ proposed: false, reason: "never_move" });
    mocks.neverMove.mockResolvedValue(new Set());
    mocks.planning.mockResolvedValue(planningFacts({ [PILL]: false, [READ]: false }));
    expect(await visit()).toEqual({ proposed: false, reason: "guest_not_alongside" });
    expect(mocks.coachPropose).not.toHaveBeenCalled();
  });

  it("a routine step that follows its routine's schedule is never a guest", async () => {
    behaviors.set(PILL, row(PILL, "Magnesium", "07:00", { parent_behavior_id: READ, inherit_parent_schedule: true }));
    mocks.signals.mockResolvedValue([{ id: "41", kind: "done_together", behaviorId: PILL, facts: { other_behavior_id: READ } }]);
    expect(await visit()).toEqual({ proposed: false, reason: "follows_parent_schedule" });
  });

  it("reports the database's refusal (one open proposal per Behavior)", async () => {
    mocks.signals.mockResolvedValue([{ id: "41", kind: "done_together", behaviorId: PILL, facts: { other_behavior_id: READ } }]);
    mocks.coachPropose.mockResolvedValue({ refused: "open_proposal", openId: "x" });
    expect(await visit()).toEqual({ proposed: false, reason: "open_proposal" });
  });
});

describe("the person", () => {
  it("sees the proposal line, the reason and its host before anything changes", async () => {
    const view = await readScheduleProposal(caller());
    expect(view).toMatchObject({
      kind: "proposal", proposalId: PROPOSAL, behaviorId: PILL, changeKind: "time",
      line: "Change your schedule: Magnesium at 8:00 PM every day, starting today (now 7:00 AM).",
      reason: "You did Magnesium and Read on the same day on 18 of the last 28 days.",
      before: ["Every day at 7:00 AM"], after: ["Every day at 8:00 PM"], answers: ["try", "for_good", "no"],
      pairing: { hostBehaviorId: READ, hostTitle: "Read" },
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("Change for good runs the person's own Behavior edit", async () => {
    const result = await answerScheduleProposal(caller(), { proposalId: PROPOSAL, answer: "for_good" });
    expect(mocks.update).toHaveBeenCalledTimes(1);
    const written = mocks.update.mock.calls[0]![2] as { behaviorId: string; values: { schedules: Array<{ timeEntries: Array<{ startTime: string }> }> } };
    expect(written.behaviorId).toBe(PILL);
    expect(written.values.schedules.map((schedule) => schedule.timeEntries.map((entry) => entry.startTime))).toEqual([["20:00"]]);
    expect(result).toMatchObject({ applied: true, undoable: true });
    expect(proposal.status).toBe("accepted");
  });

  it("No changes nothing", async () => {
    expect(await answerScheduleProposal(caller(), { proposalId: PROPOSAL, answer: "no" })).toMatchObject({ applied: false, message: "No change." });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("a host that moved closes the proposal, on reading and on answering", async () => {
    behaviors.set(READ, row(READ, "Read", "21:00"));
    expect(await readScheduleProposal(caller())).toEqual({ kind: "none" });
    expect(proposal).toMatchObject({ status: "expired", closeReason: "schedule_changed" });

    proposal = { ...proposal, status: "proposed", closeReason: null };
    await expect(answerScheduleProposal(caller(), { proposalId: PROPOSAL, answer: "try" })).rejects.toMatchObject({ code: "schedule_changed" });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("an archived host closes it too", async () => {
    behaviors.set(READ, row(READ, "Read", "20:00", { active: false }));
    expect(await readScheduleProposal(caller())).toEqual({ kind: "none" });
  });
});
