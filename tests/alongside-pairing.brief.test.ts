import { createHash } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BriefMoveDayItem } from "@cadence/core/resolvers/brief-move.resolver";
import type { EffectiveWhere } from "@cadence/core/resolvers/effective-where.resolver";
import type { BriefMoveLine } from "@cadence/core/types/brief-moves";

// Ticket 361 (D33): pairing lines in the Daily Brief. Ways this could fail, each covered:
//  - the flag is off and the planner still runs, or the evidence is read;
//  - pairing lines skip the line cap or land before the move lines;
//  - the prompt changes for a brief without a pairing line;
//  - Re-check keeps a pairing whose host moved or left, or closes one that still holds;
//  - Re-plan offers the same host again, or an ordinary move instead of another pairing;
//  - the evidence carries anything but ids and hours.

const mocks = vi.hoisted(() => ({ readDay: vi.fn(), readPrefs: vi.fn(), evidence: vi.fn() }));
vi.mock("@/lib/services/brief-move-day.service", () => ({ readBriefMoveDay: mocks.readDay, behaviorEstimateInputHash: () => "h" }));
vi.mock("@/lib/db/daily-brief.repo", () => ({ readDailyBriefPreferences: mocks.readPrefs }));
vi.mock("@/lib/services/alongside-pairing.service", async (original) => ({
  ...(await original<typeof import("@/lib/services/alongside-pairing.service")>()),
  readAlongsidePairingEvidence: mocks.evidence,
}));

import { planBriefMoveDay, recheckBriefMoves, replanBriefMove, type BriefMoveCallers } from "@/lib/services/brief-moves.service";
import { pairingEvidenceFromRpc } from "@/lib/db/pairing-evidence.repo";
import { planBriefMoveLinesFromInputs } from "@cadence/core/resolvers/brief-move.resolver";
import {
  BRIEF_OPENING_INSTRUCTIONS, BRIEF_OPENING_PAIRING_INSTRUCTIONS, BRIEF_OPENING_PAIRING_PROMPT_REVISION, BRIEF_OPENING_SCHEMA,
  prepareBriefOpening, validateBriefOpening, type BriefOpeningLine,
} from "@/lib/services/brief-opening";
import { NO_TRAVEL_CONCLUSIONS_SECRETS } from "@/lib/services/travel-conclusions-token";
import fixture from "./fixtures/advisor-day-context.valid.json";
import type { AdvisorDayContext } from "@cadence/core/types/advisor-day-context";

const TZ = "America/New_York";
const DAY = "2026-11-25";
const USER = "11111111-1111-4111-8111-111111111111";
const PROPOSAL = "44444444-4444-4444-8444-444444444444";
const local = (time: string) => Temporal.PlainDateTime.from(`${DAY}T${time}`).toZonedDateTime(TZ).toInstant();
const NOW = local("08:00");
const HOME: EffectiveWhere = { kind: "home", source: "person" };

type Row = Record<string, unknown>;

function item(id: string, start: string, minutes: number, extra: Partial<BriefMoveDayItem> = {}): BriefMoveDayItem {
  const begin = local(start);
  return {
    occurrenceId: id, behaviorId: `b-${id}`, title: id, status: "unresolved", localDate: DAY, scheduleKind: "exact",
    start: begin, end: begin.add({ minutes }), length: { minutes, source: "behavior_duration", assumed: false },
    alongside: false, alongsideSource: "default", where: HOME, revision: `2026-11-25T0${id.length % 10}:00:00Z`, behaviorRevision: "2026-11-01T00:00:00Z", ...extra,
  };
}
const helmet = () => item("helmet", "14:00", 10, { alongside: true, alongsideSource: "guess", title: "Red light helmet" });

function day(items: readonly BriefMoveDayItem[]) {
  return { items, behaviors: new Map(), occurrences: new Map(items.map((entry) => [entry.occurrenceId, { id: entry.occurrenceId, effective_start_at: null }])),
    neverMoveBehaviorIds: new Set<string>(), staleEstimateBehaviorIds: new Set<string>() };
}

function fakeSupabase(tables: Record<string, Row[]>, rpc: unknown = vi.fn(async () => ({ data: null, error: null }))) {
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

/** The agent's record_brief_move_proposals, returning stored rows the way the database does. */
function agentRpc() {
  return vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name !== "record_brief_move_proposals") return { data: null, error: null };
    const proposals = args.p_proposals as Row[];
    return { data: proposals.map((entry, index) => ({
      id: `55555555-5555-4555-8555-55555555555${index}`, user_id: USER, occurrence_id: entry.occurrence_id, behavior_id: (entry.line as Row).behaviorId,
      local_date: DAY, source: "daily_brief", agent_run_id: "run-1", status: "proposed", proposed_start_at: entry.proposed_start_at,
      proposed_end_at: entry.proposed_end_at, reason: entry.reason, expected_revision: entry.expected_revision, line: entry.line, move_id: null,
      replaces_proposal_id: entry.replaces_proposal_id, created_at: NOW.toString(), updated_at: NOW.toString(),
    })), error: null };
  });
}

/** A stored pairing line: Red light helmet during Reading at 8 PM. */
function pairingRow(items: readonly BriefMoveDayItem[], extra: Row = {}): Row {
  const moves = planBriefMoveLinesFromInputs({ localDate: DAY, timezone: TZ, now: NOW, items, calendarBusy: [], calendar: "none", travel: null,
    declinedToday: new Set(), neverMoveBehaviorIds: new Set() }).candidates;
  expect(moves).toEqual([]);
  const guest = items.find((entry) => entry.occurrenceId === "helmet")!;
  const line = {
    occurrenceId: "helmet", behaviorId: "b-helmet", behaviorRevision: guest.behaviorRevision, title: "Red light helmet", localDate: DAY, timezone: TZ,
    expectedRevision: guest.revision, from: { startAt: guest.start.toString(), endAt: guest.end.toString() },
    to: { startAt: local("20:00").toString(), endAt: local("20:10").toString() }, length: guest.length, reasonCode: "alongside_pairing",
    reason: "Do Red light helmet during reading at 8:00 PM.", anchor: { kind: "item", title: "reading" }, otherTimes: [], travel: "not_needed",
    late: false, offerNeverMove: false, calendarDerived: false,
    pairing: { hostOccurrenceId: "reading", hostBehaviorId: "b-reading", hostTitle: "reading", hostStartAt: local("20:00").toString(), needs: ["done_together"] },
  };
  return {
    id: PROPOSAL, user_id: USER, occurrence_id: "helmet", behavior_id: "b-helmet", local_date: DAY, source: "daily_brief", agent_run_id: "run-1",
    status: "proposed", proposed_start_at: line.to.startAt, proposed_end_at: line.to.endAt, reason: "alongside_pairing", expected_revision: guest.revision,
    line, move_id: null, replaces_proposal_id: null, created_at: NOW.toString(), updated_at: NOW.toString(), ...extra,
  };
}

function callers(tables: Record<string, Row[]>, rpc = agentRpc()): Readonly<{ callers: BriefMoveCallers; rpc: ReturnType<typeof agentRpc> }> {
  const person = fakeSupabase(tables) as never;
  const agent = fakeSupabase({}, rpc) as never;
  return { rpc, callers: { person: { supabase: person, userId: USER, now: NOW }, agent: async () => agent, travelSecrets: NO_TRAVEL_CONCLUSIONS_SECRETS } };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.readPrefs.mockRejectedValue(new Error("no preferences in this test"));
  mocks.evidence.mockResolvedValue({ doneTogether: [{ behaviorId: "b-helmet", otherBehaviorId: "b-reading" }], crowdedHours: [] });
});
afterEach(() => { vi.unstubAllEnvs(); });

const PAIRABLE = () => [helmet(), item("reading", "20:00", 45, { title: "reading" }), item("tv", "21:30", 60, { title: "tv" })];

describe("planBriefMoveDay pairing lines", () => {
  const agentClient = { channel: "daily_brief" } as never;
  const run = (items: readonly BriefMoveDayItem[]) => planBriefMoveDay({
    supabase: fakeSupabase({}) as never, userId: USER, localDate: DAY, timezone: TZ, now: NOW, context: null, planning: {},
    travelSecrets: NO_TRAVEL_CONCLUSIONS_SECRETS, day: day(items) as never, evidenceClient: agentClient,
  });

  it("flag off: no pairing line and no evidence read", async () => {
    const plan = await run(PAIRABLE());
    expect(plan.candidates).toEqual([]);
    expect(mocks.evidence).not.toHaveBeenCalled();
  });

  it("flag on: a pairing line after the move lines, from the coach's evidence", async () => {
    vi.stubEnv("CADENCE_ALONGSIDE", "on");
    const plan = await run(PAIRABLE());
    // The Daily Brief agent's own client, never a coach client.
    expect(mocks.evidence).toHaveBeenCalledWith(agentClient, DAY);
    expect(plan.candidates.map((line) => [line.occurrenceId, line.reasonCode, line.pairing?.hostOccurrenceId])).toEqual([["helmet", "alongside_pairing", "reading"]]);
  });

  it("flag on: no evidence, nothing helps, nothing offered", async () => {
    vi.stubEnv("CADENCE_ALONGSIDE", "on");
    mocks.evidence.mockResolvedValue({ doneTogether: [], crowdedHours: [] });
    expect((await run(PAIRABLE())).candidates).toEqual([]);
  });
});

describe("Re-check and Re-plan of a pairing line", () => {
  beforeEach(() => { vi.stubEnv("CADENCE_ALONGSIDE", "on"); });
  const request = { localDate: DAY, context: { calendarBusy: [] }, proposalIds: [PROPOSAL] };

  it("leaves a line whose host still stands", async () => {
    const items = PAIRABLE();
    mocks.readDay.mockResolvedValue(day(items));
    const { callers: c, rpc } = callers({ move_proposals: [pairingRow(items)] });
    expect(await recheckBriefMoves(c, request)).toEqual({ replaced: [] });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("pairs again with the host at its new time when the host moved", async () => {
    const items = PAIRABLE();
    const row = pairingRow(items);
    const moved = items.map((entry) => entry.occurrenceId === "reading" ? { ...entry, start: local("20:30"), end: local("21:15") } : entry);
    mocks.readDay.mockResolvedValue(day(moved));
    const { callers: c } = callers({ move_proposals: [row] });
    const { replaced } = await recheckBriefMoves(c, request);
    const line = replaced[0]!.line as BriefMoveLine;
    expect(line).toMatchObject({ reasonCode: "alongside_pairing", to: { startAt: local("20:30").toString() },
      pairing: { hostOccurrenceId: "reading", hostStartAt: local("20:30").toString(), needs: ["done_together"] } });
    expect(line.reason.replace(/\s/gu, " ")).toBe("Do Red light helmet during reading at 8:30 PM.");
  });

  it("closes the line when no host is left", async () => {
    const items = PAIRABLE();
    const row = pairingRow(items);
    mocks.readDay.mockResolvedValue(day(items.map((entry) => entry.alongside ? entry : { ...entry, status: "completed" })));
    const { callers: c, rpc } = callers({ move_proposals: [row] });
    expect(await recheckBriefMoves(c, request)).toEqual({ replaced: [{ proposalId: PROPOSAL, line: null }] });
    expect(rpc).toHaveBeenCalledWith("withdraw_brief_move_proposal", { p_proposal_id: PROPOSAL });
  });

  it("flag off: a stored pairing line is checked like any other line", async () => {
    vi.stubEnv("CADENCE_ALONGSIDE", "");
    const items = PAIRABLE();
    const row = pairingRow(items);
    mocks.readDay.mockResolvedValue(day(items.map((entry) => entry.occurrenceId === "reading" ? { ...entry, start: local("20:30"), end: local("21:15") } : entry)));
    const { callers: c } = callers({ move_proposals: [row] });
    expect(await recheckBriefMoves(c, request)).toEqual({ replaced: [] });
  });

  it("Re-plan pairs the guest with another host, or offers nothing", async () => {
    const items = PAIRABLE();
    mocks.readDay.mockResolvedValue(day(items));
    const { callers: c } = callers({ move_proposals: [pairingRow(items)] });
    const result = await replanBriefMove(c, { proposalId: PROPOSAL, context: { calendarBusy: [] } });
    expect(result.line).toMatchObject({ reasonCode: "alongside_pairing", to: { startAt: local("21:30").toString() }, pairing: { hostOccurrenceId: "tv" } });

    const only = items.filter((entry) => entry.occurrenceId !== "tv");
    mocks.readDay.mockResolvedValue(day(only));
    const second = callers({ move_proposals: [pairingRow(only)] });
    expect(await replanBriefMove(second.callers, { proposalId: PROPOSAL, context: { calendarBusy: [] } })).toEqual({ line: null, replacedProposalId: PROPOSAL });
  });
});

describe("the brief's words for a pairing line", () => {
  const context = fixture as unknown as AdvisorDayContext;
  const base: BriefOpeningLine = {
    key: "a", title: "Walk", from: { startAt: "2026-09-20T16:30:00Z", endAt: "2026-09-20T17:00:00Z" }, to: { startAt: "2026-09-20T18:00:00Z", endAt: "2026-09-20T18:30:00Z" },
    length: { minutes: 30, source: "behavior_duration", assumed: false }, reasonCode: "calendar_overlap", anchor: null, late: false, travel: "not_needed", reason: "It runs into a calendar event.",
  };
  const pairing: BriefOpeningLine = { ...base, key: "b", title: "Red light helmet", reasonCode: "alongside_pairing", anchor: { kind: "item", title: "Reading" }, reason: "Do Red light helmet during Reading at 2:00 PM." };

  it("sends the pinned prompt when no line is a pairing, and adds the pairing rule only with one", () => {
    const plain = prepareBriefOpening({ context, lines: [base], conflicts: [], calendar: "none", now: context.capturedAt });
    expect(plain.instructions).toBe(BRIEF_OPENING_INSTRUCTIONS);
    const paired = prepareBriefOpening({ context, lines: [base, pairing], conflicts: [], calendar: "none", now: context.capturedAt });
    expect(paired.instructions).toBe(`${BRIEF_OPENING_INSTRUCTIONS}\n${BRIEF_OPENING_PAIRING_INSTRUCTIONS}`);
    const facts = JSON.parse(paired.facts) as { lines: { key: string; why: string; with: string | null }[] };
    expect(facts.lines.find((line) => line.key === "b")).toMatchObject({ why: "alongside_pairing", with: "Reading" });
    // Pinned: a change to the pairing rule is a reviewed edit here.
    expect(BRIEF_OPENING_PAIRING_PROMPT_REVISION).toBe(createHash("sha256")
      .update(`${BRIEF_OPENING_INSTRUCTIONS}\n${BRIEF_OPENING_PAIRING_INSTRUCTIONS}\0${JSON.stringify(BRIEF_OPENING_SCHEMA)}`).digest("hex").slice(0, 16));
    expect(BRIEF_OPENING_PAIRING_PROMPT_REVISION).toBe("6f3ca1a4796ef317");
  });

  it("keeps the stock sentence when the model names the reason code", () => {
    const words = validateBriefOpening({ opening: "Two things today.", reasons: [{ key: "b", text: "alongside_pairing with Reading." }] },
      { lines: [pairing], conflicts: [], labels: [] });
    expect(words.reasons.b).toBe(pairing.reason);
    expect(words.fallbacks).toContain("reason_jargon");
  });
});

describe("pairing evidence", () => {
  it("keeps only ids and whole hours from the function's answer", () => {
    expect(pairingEvidenceFromRpc({
      done_together: [{ behavior_id: "b-1", other_behavior_id: "b-2", together_days: 9 }, { behavior_id: "b-3" }, "b-4"],
      crowded_hours: [19, 31, 7.5, "8"],
      completion_drop: [{ behavior_id: "b-5" }],
    })).toEqual({ doneTogether: [{ behaviorId: "b-1", otherBehaviorId: "b-2" }], crowdedHours: [19] });
    expect(pairingEvidenceFromRpc({})).toEqual({ doneTogether: [], crowdedHours: [] });
  });
});
