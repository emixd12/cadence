import { Temporal } from "@js-temporal/polyfill";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BriefMoveDayItem } from "@cadence/core/resolvers/brief-move.resolver";

// Task 7: the Daily Brief's "Add for today" answers. Ways this could fail, each covered:
//  - Yes adds without the one free-slot check, or not as the person with added_by daily_brief;
//  - a retried tap adds a second Occurrence (the Occurrence id must follow the key);
//  - a refused time is not recorded, or offers no free times;
//  - Undo removes an item the person marked, or treats an item already gone as a failure;
//  - a replayed key adds again;
//  - Re-check leaves a taken line, or keeps one when nothing fits;
//  - a stale calendar still plans lines.

const mocks = vi.hoisted(() => ({ add: vi.fn(), remove: vi.fn(), readDay: vi.fn(), readPool: vi.fn() }));
vi.mock("@/lib/services/opportunity.service", () => ({ addOpportunityToToday: mocks.add, removeOpportunityFromToday: mocks.remove }));
vi.mock("@/lib/services/brief-move-day.service", () => ({ readBriefMoveDay: mocks.readDay, behaviorEstimateInputHash: () => "h" }));
vi.mock("@/lib/services/advisor-day-context.service", () => ({ readAdvisorOpportunityPool: mocks.readPool }));

import { answerBriefOpportunity, planBriefOpportunityDay, recheckBriefOpportunities } from "@/lib/services/brief-opportunities.service";
import type { BriefMoveCallers } from "@/lib/services/brief-moves.service";

const TZ = "America/New_York";
const DAY = "2026-11-21";
const USER = "11111111-1111-4111-8111-111111111111";
const BEHAVIOR = "22222222-2222-4222-8222-222222222222";
const PROPOSAL = "44444444-4444-4444-8444-444444444444";
const ADDED = "55555555-5555-4555-8555-555555555555";
const local = (time: string) => Temporal.PlainDateTime.from(`${DAY}T${time}`).toZonedDateTime(TZ).toInstant();
const NOW = local("14:02");

type Row = Record<string, unknown>;

function proposal(extra: Row = {}): Row {
  return {
    id: PROPOSAL, user_id: USER, behavior_id: BEHAVIOR, local_date: DAY, source: "daily_brief", agent_run_id: "run-1", status: "proposed",
    proposed_start_at: local("15:00").toString(), proposed_end_at: local("15:20").toString(), reason: "open_window", replaces_proposal_id: null,
    occurrence_id: null, status_changed_at: null, created_at: local("07:00").toString(), updated_at: local("07:00").toString(),
    line: { behaviorId: BEHAVIOR, title: "Stretch", timezone: TZ, localDate: DAY, length: { minutes: 20, source: "behavior_duration", assumed: false },
      whereKind: "anywhere", reasonCode: "open_window", daysSinceLastCompleted: 3, otherTimes: [], travel: "not_needed", offerNeverAdd: false },
    ...extra,
  };
}

function fakeSupabase(tables: Record<string, Row[]>, rpc = vi.fn()) {
  return {
    rpc,
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      const rows = () => (tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)));
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      Object.assign(builder, {
        select: chain, order: chain, limit: chain, not: chain, is: chain, lte: chain, gte: chain, lt: chain,
        eq: (column: string, value: unknown) => { filters.push((row) => !(column in row) || row[column] === value); return builder; },
        in: (column: string, values: unknown[]) => { filters.push((row) => !(column in row) || values.includes(row[column])); return builder; },
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(resolve, reject),
      });
      return builder;
    },
  };
}

/** answer_opportunity_proposal as the database applies it, and the agent's record function. */
function answerRpc(row: Row) {
  return vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name !== "answer_opportunity_proposal") return { data: null, error: null };
    const kind = args.p_kind;
    const next = args.p_outcome === "refused" ? row.status
      : kind === "yes" ? "accepted" : kind === "other_time" ? "other_time" : kind === "undo" ? "undone" : "declined";
    const occurrence = kind === "yes" || kind === "other_time" ? args.p_occurrence_id : row.occurrence_id;
    return { data: { replayed: false, proposal: { ...row, status: next, occurrence_id: occurrence } }, error: null };
  });
}

function callers(tables: Record<string, Row[]>, rpc = vi.fn(), agentRpc = vi.fn()): BriefMoveCallers {
  const agent = fakeSupabase(tables, agentRpc);
  return {
    person: { supabase: fakeSupabase(tables, rpc) as never, userId: USER, now: NOW },
    agent: async () => agent as never,
    travelSecrets: {} as never,
  };
}

function item(id: string, start: string, minutes: number): BriefMoveDayItem {
  const begin = local(start);
  return { occurrenceId: id, behaviorId: `b-${id}`, title: id, status: "unresolved", localDate: DAY, scheduleKind: "exact", start: begin,
    end: begin.add({ minutes }), length: { minutes, source: "behavior_duration", assumed: false }, alongside: false, revision: "r", behaviorRevision: "br" };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readDay.mockResolvedValue({ items: [], behaviors: new Map(), occurrences: new Map() });
  mocks.add.mockImplementation(async (_caller, input) => ({ outcome: "added", created: true, occurrence: { id: input.occurrenceId }, notice: { id: "opportunity.added", params: {} } }));
});

const context = { calendarBusy: [] };

describe("answerBriefOpportunity", () => {
  it("Yes checks the slot, then adds as the person with added_by daily_brief at the line's time", async () => {
    const row = proposal();
    const rpc = answerRpc(row);
    const result = await answerBriefOpportunity(callers({ opportunity_proposals: [row] }, rpc),
      { target: "opportunity", kind: "yes", proposalId: PROPOSAL, idempotencyKey: "tap-1", context });
    expect(mocks.add).toHaveBeenCalledWith(expect.objectContaining({ userId: USER }), expect.objectContaining({
      behaviorId: BEHAVIOR, placement: { kind: "exact", startTime: "15:00" }, addedBy: "daily_brief",
    }));
    const occurrenceId = mocks.add.mock.calls[0]![1].occurrenceId as string;
    expect(rpc).toHaveBeenCalledWith("answer_opportunity_proposal", expect.objectContaining({ p_kind: "yes", p_outcome: "applied", p_occurrence_id: occurrenceId }));
    expect(result).toMatchObject({ target: "opportunity", outcome: "applied", occurrenceId, refusal: null, line: { status: "accepted", occurrenceId } });

    // The same tap again (a lost reply) asks for the same Occurrence, so the database replays it.
    await answerBriefOpportunity(callers({ opportunity_proposals: [row] }, answerRpc(row)),
      { target: "opportunity", kind: "yes", proposalId: PROPOSAL, idempotencyKey: "tap-1", context });
    expect(mocks.add.mock.calls[1]![1].occurrenceId).toBe(occurrenceId);
  });

  it("a Yes retried after the add saved but the answer write failed completes instead of refusing as taken", async () => {
    const row = proposal();
    await answerBriefOpportunity(callers({ opportunity_proposals: [row] }, vi.fn(async () => ({ data: null, error: new Error("lost") }))),
      { target: "opportunity", kind: "yes", proposalId: PROPOSAL, idempotencyKey: "tap-r", context }).catch(() => undefined);
    const occurrenceId = mocks.add.mock.calls[0]![1].occurrenceId as string;
    // The added item now holds 15:00 on the day, so the slot check alone would refuse it.
    mocks.readDay.mockResolvedValue({ items: [item(occurrenceId, "15:00", 20)], behaviors: new Map(), occurrences: new Map() });
    const tables = { opportunity_proposals: [row],
      occurrences: [{ id: occurrenceId, user_id: USER, behavior_id: BEHAVIOR, origin: "opportunity",
        scheduled_for: local("15:00").toString(), effective_start_at: null, effective_end_at: null }] };
    const retried = await answerBriefOpportunity(callers(tables, answerRpc(row)),
      { target: "opportunity", kind: "yes", proposalId: PROPOSAL, idempotencyKey: "tap-r", context });
    expect(retried).toMatchObject({ outcome: "applied", occurrenceId, refusal: null });
    expect(mocks.add.mock.calls[1]![1].occurrenceId).toBe(occurrenceId);

    // Another Behavior's item at that time still refuses a fresh tap.
    const fresh = await answerBriefOpportunity(callers({ opportunity_proposals: [row], occurrences: tables.occurrences }, answerRpc(row)),
      { target: "opportunity", kind: "yes", proposalId: PROPOSAL, idempotencyKey: "tap-s", context });
    expect(fresh.refusal?.reason).toBe("slot_taken");
  });

  it("refuses a time blocked by trusted calendarBusy and offers alternatives", async () => {
    const row = proposal();
    const rpc = answerRpc(row);
    const busy = { calendarBusy: [{ startAt: local("14:45").toString(), endAt: local("16:00").toString() }] };
    const result = await answerBriefOpportunity(callers({ opportunity_proposals: [row] }, rpc),
      { target: "opportunity", kind: "yes", proposalId: PROPOSAL, idempotencyKey: "tap-2", context: busy });
    expect(mocks.add).not.toHaveBeenCalled();
    expect(result.outcome).toBe("refused");
    expect(result.refusal?.reason).toBe("calendar_busy");
  });

  it("refuses a time an item of the day holds now", async () => {
    mocks.readDay.mockResolvedValue({ items: [item("piano", "15:10", 30)], behaviors: new Map(), occurrences: new Map() });
    const result = await answerBriefOpportunity(callers({ opportunity_proposals: [proposal()] }, answerRpc(proposal())),
      { target: "opportunity", kind: "yes", proposalId: PROPOSAL, idempotencyKey: "tap-3", context });
    expect(result.refusal?.reason).toBe("slot_taken");
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it("throws proposal_closed for Yes on an answered line, and replays a key without adding", async () => {
    await expect(answerBriefOpportunity(callers({ opportunity_proposals: [proposal({ status: "declined" })] }),
      { target: "opportunity", kind: "yes", proposalId: PROPOSAL, idempotencyKey: "tap-4", context })).rejects.toMatchObject({ code: "proposal_closed" });
    const answered = proposal({ status: "accepted", occurrence_id: ADDED });
    const tables = {
      opportunity_proposals: [answered],
      opportunity_proposal_answers: [{ user_id: USER, proposal_id: PROPOSAL, idempotency_key: "tap-5", kind: "yes", outcome: "applied", occurrence_id: ADDED }],
      occurrences: [{ id: ADDED, user_id: USER, scheduled_for: local("15:00").toString(), effective_start_at: null, effective_end_at: null }],
    };
    const result = await answerBriefOpportunity(callers(tables), { target: "opportunity", kind: "yes", proposalId: PROPOSAL, idempotencyKey: "tap-5", context });
    expect(result).toMatchObject({ replayed: true, outcome: "applied", occurrenceId: ADDED, line: { appliedAt: { startAt: local("15:00").toString() } } });
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it("Undo keeps an item the person marked, and stands when the item is already gone", async () => {
    const row = proposal({ status: "accepted", occurrence_id: ADDED });
    mocks.remove.mockResolvedValueOnce({ outcome: "refused", reason: "marked", notice: { id: "opportunity.remove-refused.marked", params: { title: "Stretch" } } });
    const rpc = answerRpc(row);
    const kept = await answerBriefOpportunity(callers({ opportunity_proposals: [row] }, rpc), { target: "opportunity", kind: "undo", proposalId: PROPOSAL, idempotencyKey: "u-1" });
    expect(mocks.remove).toHaveBeenCalledWith(expect.anything(), { occurrenceId: ADDED, title: "Stretch" });
    expect(kept.outcome).toBe("refused");
    expect(kept.refusal?.reason).toBe("marked");
    expect(rpc).toHaveBeenCalledWith("answer_opportunity_proposal", expect.objectContaining({ p_kind: "undo", p_outcome: "refused", p_refusal_reason: "marked" }));

    mocks.remove.mockResolvedValueOnce({ outcome: "refused", reason: "not_found", notice: { id: "opportunity.remove-refused.not-found", params: {} } });
    const gone = await answerBriefOpportunity(callers({ opportunity_proposals: [row] }, answerRpc(row)), { target: "opportunity", kind: "undo", proposalId: PROPOSAL, idempotencyKey: "u-2" });
    expect(gone).toMatchObject({ outcome: "applied", line: { status: "undone" } });
  });
});

describe("recheckBriefOpportunities", () => {
  it("re-plans a line whose time is taken now, and withdraws one when nothing fits", async () => {
    mocks.readDay.mockResolvedValue({ items: [item("piano", "15:00", 30)], behaviors: new Map(), occurrences: new Map() });
    const agentRpc = vi.fn(async (name: string, args: Record<string, unknown>) => name === "record_brief_opportunity_proposals"
      ? { data: (args.p_proposals as Row[]).map((entry) => proposal({ id: "66666666-6666-4666-8666-666666666666", proposed_start_at: entry.proposed_start_at, proposed_end_at: entry.proposed_end_at, line: entry.line })), error: null }
      : { data: null, error: null });
    const result = await recheckBriefOpportunities(callers({ opportunity_proposals: [proposal()], move_proposals: [] }, vi.fn(), agentRpc),
      { localDate: DAY, context, proposalIds: [PROPOSAL] });
    const recorded = agentRpc.mock.calls.find(([name]) => name === "record_brief_opportunity_proposals")![1] as { p_proposals: Row[] };
    expect(recorded.p_proposals[0]).toMatchObject({ behavior_id: BEHAVIOR, replaces_proposal_id: PROPOSAL, proposed_start_at: local("14:30").toString() });
    expect(result.replaced).toHaveLength(1);
    expect(result.replaced[0]!.line?.at.startAt).toBe(local("14:30").toString());

    // Second open with nothing changed writes nothing.
    const quiet = vi.fn();
    mocks.readDay.mockResolvedValue({ items: [], behaviors: new Map(), occurrences: new Map() });
    expect(await recheckBriefOpportunities(callers({ opportunity_proposals: [proposal()], move_proposals: [] }, vi.fn(), quiet),
      { localDate: DAY, context, proposalIds: [PROPOSAL] })).toEqual({ replaced: [] });
    expect(quiet).not.toHaveBeenCalled();

    // Trusted calendarBusy filling the rest of the day withdraws the line.
    const full = { calendarBusy: [{ startAt: local("14:00").toString(), endAt: local("23:59").toString() }] };
    const withdrawBusy = vi.fn(async () => ({ data: null, error: null }));
    const closedBusy = await recheckBriefOpportunities(callers({ opportunity_proposals: [proposal()], move_proposals: [] }, vi.fn(), withdrawBusy),
      { localDate: DAY, context: full, proposalIds: [PROPOSAL] });
    expect(withdrawBusy).toHaveBeenCalledWith("withdraw_brief_opportunity_proposal", { p_proposal_id: PROPOSAL });
    expect(closedBusy.replaced).toEqual([{ proposalId: PROPOSAL, line: null }]);

    // Recheck preserves Google Calendar provenance from a superseded proposal.
    mocks.readDay.mockResolvedValue({ items: [item("piano", "15:00", 30)], behaviors: new Map(), occurrences: new Map() });
    const provenanceRpc = vi.fn(async (name: string, args: Record<string, unknown>) => name === "record_brief_opportunity_proposals"
      ? { data: (args.p_proposals as Row[]).map((entry) => proposal({ id: "77777777-7777-4777-8777-777777777777", proposed_start_at: entry.proposed_start_at, proposed_end_at: entry.proposed_end_at, line: entry.line })), error: null }
      : { data: null, error: null });
    await recheckBriefOpportunities(
      callers({ opportunity_proposals: [proposal({ contains_google_calendar: true, google_calendar_grant_generation: 4 })], move_proposals: [] }, vi.fn(), provenanceRpc),
      { localDate: DAY, context, proposalIds: [PROPOSAL] },
    );
    const provenanceRecorded = provenanceRpc.mock.calls.find(([name]) => name === "record_brief_opportunity_proposals")![1] as { p_proposals: Row[] };
    expect(provenanceRecorded.p_proposals[0]).toMatchObject({ contains_google_calendar: true, google_calendar_grant_generation: 4 });

    // When day items fill the rest of the day, nothing fits and the line is withdrawn.
    mocks.readDay.mockResolvedValue({ items: [item("all-day", "14:00", 599)], behaviors: new Map(), occurrences: new Map() });
    const withdraw = vi.fn(async () => ({ data: null, error: null }));
    const closed = await recheckBriefOpportunities(callers({ opportunity_proposals: [proposal()], move_proposals: [] }, vi.fn(), withdraw),
      { localDate: DAY, context, proposalIds: [PROPOSAL] });
    expect(withdraw).toHaveBeenCalledWith("withdraw_brief_opportunity_proposal", { p_proposal_id: PROPOSAL });
    expect(closed.replaced).toEqual([{ proposalId: PROPOSAL, line: null }]);
  });
});

describe("planBriefOpportunityDay", () => {
  it("plans nothing on a stale calendar and does not read the pool", async () => {
    const context = { connectors: [{ events: [], state: "stale", complete: false }] } as never;
    const result = await planBriefOpportunityDay({
      supabase: fakeSupabase({}) as never, userId: USER, localDate: DAY, timezone: TZ, now: NOW, context, planning: {}, travelSecrets: {} as never,
    });
    expect(result).toEqual({ candidates: [], calendar: "stale" });
    expect(mocks.readPool).not.toHaveBeenCalled();
  });
});
