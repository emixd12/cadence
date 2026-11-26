import { beforeEach, describe, expect, it, vi } from "vitest";

// Ticket 362: the tip run's schedule proposal step. With CADENCE_ALONGSIDE off it is
// exactly the repeated-move question, as before; with it on, one pairing step follows.

const mocks = vi.hoisted(() => ({
  moved: vi.fn(),
  pairing: vi.fn(),
  occurrences: vi.fn(),
  moves: vi.fn(),
}));

vi.mock("@/lib/services/behavior-change-proposals.service", () => ({
  proposeBehaviorChangesForVisit: mocks.moved,
  proposeSchedulePairingsForVisit: mocks.pairing,
  proposeTipOffers: vi.fn(),
}));
vi.mock("@/lib/db/coach-signals.repo", () => ({
  createCoachSignalReads: () => ({ occurrences: mocks.occurrences, moves: mocks.moves }),
}));
vi.mock("@/lib/integrations/agent-caller", () => ({ createAgentClient: vi.fn() }));

const { hostedScheduleProposalHook } = await import("@/lib/services/advisor-tips-job.service");

const USER = "00000000-0000-4000-8000-000000000001";
const context = { runId: "run-1", localDate: "2026-11-25", signals: [], matches: [] };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.occurrences.mockResolvedValue([]);
  mocks.moves.mockResolvedValue([]);
  mocks.moved.mockResolvedValue({ proposed: false, reason: "no_candidate" });
  mocks.pairing.mockResolvedValue({ proposed: false, reason: "no_evidence" });
});

describe("hostedScheduleProposalHook", () => {
  it.each([[{}], [{ CADENCE_ALONGSIDE: "off" }], [{ CADENCE_ALONGSIDE: "ON" }]])("flag off (%j): only the repeated-move question", async (env) => {
    await hostedScheduleProposalHook({} as never, USER, env)(context);
    expect(mocks.moved).toHaveBeenCalledTimes(1);
    expect(mocks.pairing).not.toHaveBeenCalled();
  });

  it("flag on: the pairing step runs after the repeated-move question, on the same run", async () => {
    const env = { CADENCE_ALONGSIDE: "on" };
    await hostedScheduleProposalHook({} as never, USER, env)(context);
    expect(mocks.moved).toHaveBeenCalledTimes(1);
    expect(mocks.pairing).toHaveBeenCalledWith({}, { userId: USER, runId: "run-1", today: "2026-11-25", env });
    expect(mocks.moved.mock.invocationCallOrder[0]!).toBeLessThan(mocks.pairing.mock.invocationCallOrder[0]!);
  });

  it("flag on: a failed repeated-move step still runs the pairing step, then reports the failure", async () => {
    mocks.moved.mockRejectedValue(new Error("read failed"));
    await expect(hostedScheduleProposalHook({} as never, USER, { CADENCE_ALONGSIDE: "on" })(context)).rejects.toThrow("read failed");
    expect(mocks.pairing).toHaveBeenCalledTimes(1);
  });
});
