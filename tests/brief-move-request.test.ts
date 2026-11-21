import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  answer: vi.fn(),
  replan: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/services/google-calendar-request", async (load) => ({
  ...(await load<typeof import("@/lib/services/google-calendar-request")>()),
  authenticateCalendarRequest: mocks.authenticate,
}));
vi.mock("@/lib/services/brief-moves.service", async (load) => ({
  ...(await load<typeof import("@/lib/services/brief-moves.service")>()),
  answerBriefMove: mocks.answer,
  replanBriefMove: mocks.replan,
}));

import { POST as answerRoute } from "@/app/api/advisor/brief/answer/route";
import { POST as replanRoute } from "@/app/api/advisor/brief/replan/route";
import { BriefMoveError } from "@/lib/services/brief-moves.service";
import { parseBriefMoveAnswer, parseBriefMoveLength, parsePlanningContext } from "@/lib/services/brief-move-request";

const PROPOSAL = "0b6f7a4e-4d1c-4f39-9b9e-5d5f8f0c1a11";
const REVISION = "2026-11-18T14:00:00.123456+00:00";

function post(path: string, body: unknown) {
  return new Request(`https://app.cadence-me.com${path}`, {
    method: "POST", headers: { origin: "https://app.cadence-me.com", "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticate.mockResolvedValue({ client: { rpc: mocks.rpc }, user: { id: "11111111-1111-4111-8111-111111111111" }, via: "cookie" });
  mocks.rpc.mockResolvedValue({ data: [{ allowed: true, retry_after_seconds: 1 }], error: null });
});

describe("brief move request bodies", () => {
  it("accepts each answer kind exactly as the types define it", () => {
    expect(parseBriefMoveAnswer({ kind: "yes", idempotencyKey: "k1", proposalId: PROPOSAL, expectedRevision: REVISION,
      context: { calendarBusy: [{ startAt: "2026-11-18T15:00:00Z", endAt: "2026-11-18T16:00:00Z", title: " Team sync " }], travelTimes: "a.b" } }))
      .toEqual({ kind: "yes", idempotencyKey: "k1", proposalId: PROPOSAL, expectedRevision: REVISION,
        context: { calendarBusy: [{ startAt: "2026-11-18T15:00:00Z", endAt: "2026-11-18T16:00:00Z", title: "Team sync" }], travelTimes: "a.b" } });
    expect(parseBriefMoveAnswer({ kind: "no", idempotencyKey: "k2", proposalId: PROPOSAL })).toMatchObject({ kind: "no" });
    expect(parseBriefMoveAnswer({ kind: "accept_all", idempotencyKey: "k3", lines: [{ proposalId: PROPOSAL, expectedRevision: REVISION }] }))
      .toMatchObject({ kind: "accept_all", context: { calendarBusy: [] } });
    expect(parseBriefMoveAnswer({ kind: "undo_all", idempotencyKey: "k4", batchId: PROPOSAL })).toMatchObject({ kind: "undo_all" });
  });

  it("refuses unknown fields, bad ids, bad times and oversized lists", () => {
    const bad = [
      { kind: "yes", idempotencyKey: "k", proposalId: PROPOSAL, expectedRevision: REVISION, extra: 1 },
      { kind: "no", idempotencyKey: "k", proposalId: "not-a-uuid" },
      { kind: "other_time", idempotencyKey: "k", proposalId: PROPOSAL, expectedRevision: REVISION, startAt: "3pm" },
      { kind: "accept_all", idempotencyKey: "k", lines: [] },
      { kind: "accept_all", idempotencyKey: "k", lines: [{ proposalId: PROPOSAL, expectedRevision: REVISION }, { proposalId: PROPOSAL, expectedRevision: REVISION }] },
      { kind: "maybe", idempotencyKey: "k", proposalId: PROPOSAL },
      { kind: "no", idempotencyKey: "has space", proposalId: PROPOSAL },
    ];
    for (const body of bad) expect(() => parseBriefMoveAnswer(body)).toThrow(BriefMoveError);
    expect(() => parsePlanningContext({ calendarBusy: Array.from({ length: 201 }, () => ({ startAt: "2026-11-18T15:00:00Z", endAt: "2026-11-18T16:00:00Z" })) })).toThrow(BriefMoveError);
    expect(() => parseBriefMoveLength({ behaviorId: PROPOSAL, minutes: 0, expectedBehaviorRevision: REVISION })).toThrow(BriefMoveError);
    expect(() => parseBriefMoveLength({ behaviorId: PROPOSAL, minutes: 12.5, expectedBehaviorRevision: REVISION })).toThrow(BriefMoveError);
  });
});

describe("brief move routes", () => {
  it("returns the answer, and maps each error to its status", async () => {
    mocks.answer.mockResolvedValueOnce({ kind: "no", results: [], batchId: null, replayed: false, showFirstMoveLine: false });
    const ok = await answerRoute(post("/api/advisor/brief/answer", { kind: "no", idempotencyKey: "k", proposalId: PROPOSAL }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ kind: "no" });

    for (const [code, status] of [["proposal_not_found", 404], ["proposal_closed", 409], ["idempotency_key_reused", 409]] as const) {
      mocks.answer.mockRejectedValueOnce(new BriefMoveError(code));
      const response = await answerRoute(post("/api/advisor/brief/answer", { kind: "no", idempotencyKey: "k", proposalId: PROPOSAL }));
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: code });
    }
    const invalid = await answerRoute(post("/api/advisor/brief/answer", { kind: "no" }));
    expect(invalid.status).toBe(400);
    mocks.authenticate.mockRejectedValueOnce(new BriefMoveError("unauthenticated"));
    expect((await answerRoute(post("/api/advisor/brief/answer", {}))).status).toBe(401);
    // An unexpected failure says only that the advisor is unavailable.
    mocks.answer.mockRejectedValueOnce(new Error("database said something private"));
    const failed = await answerRoute(post("/api/advisor/brief/answer", { kind: "no", idempotencyKey: "k", proposalId: PROPOSAL }));
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ error: "advisor_unavailable" });
  });

  it("limits Re-plan and Other time per account", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [{ allowed: false, retry_after_seconds: 42 }], error: null });
    const limited = await replanRoute(post("/api/advisor/brief/replan", { proposalId: PROPOSAL }));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "rate_limited", retryAfterSeconds: 42 });
    expect(mocks.rpc).toHaveBeenCalledWith("consume_launch_rate_limit", { p_action: "brief_move_replan" });
    expect(mocks.replan).not.toHaveBeenCalled();

    mocks.answer.mockResolvedValueOnce({ kind: "no", results: [], batchId: null, replayed: false, showFirstMoveLine: false });
    await answerRoute(post("/api/advisor/brief/answer", { kind: "no", idempotencyKey: "k", proposalId: PROPOSAL }));
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
});

describe("brief move recheck request (3A1 follow-up)", () => {
  it("takes a local date, the screen's context and the lines it shows", async () => {
    const { parseBriefMoveRecheck } = await import("@/lib/services/brief-move-request");
    expect(parseBriefMoveRecheck({ localDate: "2026-11-19", proposalIds: [PROPOSAL, PROPOSAL] }))
      .toEqual({ localDate: "2026-11-19", context: { calendarBusy: [] }, proposalIds: [PROPOSAL] });
    for (const bad of [{}, { localDate: "2026-13-40" }, { localDate: "11/19/2026" }, { localDate: "2026-11-19", proposalIds: ["x"] },
      { localDate: "2026-11-19", extra: 1 }, { localDate: "2026-11-19", proposalIds: Array.from({ length: 65 }, () => PROPOSAL) }]) {
      expect(() => parseBriefMoveRecheck(bad)).toThrow(BriefMoveError);
    }
  });
});

describe("Task 7: opportunity bodies on the brief routes", () => {
  it("parses an opportunity answer only with target opportunity, and keeps move answers unchanged", async () => {
    const { parseBriefAnswer, parseBriefMoveRecheck } = await import("@/lib/services/brief-move-request");
    expect(parseBriefAnswer({ target: "opportunity", kind: "yes", idempotencyKey: "k1", proposalId: PROPOSAL })).toEqual({
      target: "opportunity", answer: { target: "opportunity", kind: "yes", idempotencyKey: "k1", proposalId: PROPOSAL, context: { calendarBusy: [] } },
    });
    expect(parseBriefAnswer({ target: "opportunity", kind: "other_time", idempotencyKey: "k2", proposalId: PROPOSAL, startAt: "2026-11-18T20:00:00Z" }).answer)
      .toMatchObject({ kind: "other_time", startAt: "2026-11-18T20:00:00Z" });
    expect(parseBriefAnswer({ kind: "no", idempotencyKey: "k3", proposalId: PROPOSAL })).toEqual({ target: "move", answer: { kind: "no", idempotencyKey: "k3", proposalId: PROPOSAL } });
    expect(() => parseBriefAnswer({ target: "move", kind: "no", idempotencyKey: "k3", proposalId: PROPOSAL })).toThrow(BriefMoveError);
    expect(() => parseBriefAnswer({ target: "opportunity", kind: "already_done", idempotencyKey: "k4", proposalId: PROPOSAL })).toThrow(BriefMoveError);
    expect(() => parseBriefAnswer({ target: "opportunity", kind: "never_add", idempotencyKey: "k5", proposalId: PROPOSAL, expectedRevision: REVISION })).toThrow(BriefMoveError);
    // A re-check body without opportunity ids is the move re-check exactly as before.
    expect(parseBriefMoveRecheck({ localDate: "2026-11-18" })).toEqual({ localDate: "2026-11-18", context: { calendarBusy: [] }, proposalIds: [] });
    expect(parseBriefMoveRecheck({ localDate: "2026-11-18", opportunityProposalIds: [PROPOSAL, PROPOSAL] }).opportunityProposalIds).toEqual([PROPOSAL]);
  });
});
