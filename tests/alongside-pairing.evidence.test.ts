import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Temporal } from "@js-temporal/polyfill";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Ticket 361 follow-up (D33): the pairing evidence is read on the caller's own client
// through advisor_read_pairing_evidence. Ways this could fail, each covered:
//  - the service mints a coach (or any) agent client again;
//  - it calls coach_read_signals, or a function other than the narrow one;
//  - a failed or refused read throws instead of meaning no evidence;
//  - Chat reads the evidence on a client other than its own.

const mocks = vi.hoisted(() => ({ createAgentClient: vi.fn(), createAgentContext: vi.fn(), readDay: vi.fn() }));
vi.mock("@/lib/integrations/agent-caller", () => ({
  agentCallerConfigured: () => true,
  createAgentClient: mocks.createAgentClient,
  createAgentContext: mocks.createAgentContext,
}));
vi.mock("@/lib/services/brief-move-day.service", () => ({ readBriefMoveDay: mocks.readDay }));

import { planChatPairings, readAlongsidePairingEvidence } from "@/lib/services/alongside-pairing.service";

const DAY = "2026-11-25";
const USER = "11111111-1111-4111-8111-111111111111";

function client(result: unknown) {
  return { rpc: vi.fn(async () => result) };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.readDay.mockResolvedValue({ items: [], behaviors: new Map(), occurrences: new Map(), neverMoveBehaviorIds: new Set(), staleEstimateBehaviorIds: new Set() });
});

describe("readAlongsidePairingEvidence", () => {
  it("calls only advisor_read_pairing_evidence, once, on the client it was given", async () => {
    const own = client({ data: { done_together: [{ behavior_id: "b-1", other_behavior_id: "b-2" }], crowded_hours: [19] }, error: null });
    expect(await readAlongsidePairingEvidence(own as never, DAY)).toEqual({ doneTogether: [{ behaviorId: "b-1", otherBehaviorId: "b-2" }], crowdedHours: [19] });
    expect(own.rpc).toHaveBeenCalledExactlyOnceWith("advisor_read_pairing_evidence", { p_local_date: DAY });
    expect(mocks.createAgentClient).not.toHaveBeenCalled();
    expect(mocks.createAgentContext).not.toHaveBeenCalled();
  });

  it("no client, a refused read or a malformed answer: no evidence, no throw", async () => {
    expect(await readAlongsidePairingEvidence(null, DAY)).toEqual({ doneTogether: [], crowdedHours: [] });
    const refused = client({ data: null, error: { code: "42501", message: "agent_channel_required" } });
    expect(await readAlongsidePairingEvidence(refused as never, DAY)).toEqual({ doneTogether: [], crowdedHours: [] });
    const thrown = { rpc: vi.fn(async () => { throw new Error("network"); }) };
    expect(await readAlongsidePairingEvidence(thrown as never, DAY)).toEqual({ doneTogether: [], crowdedHours: [] });
    const malformed = client({ data: [], error: null });
    expect(await readAlongsidePairingEvidence(malformed as never, DAY)).toEqual({ doneTogether: [], crowdedHours: [] });
    expect(mocks.createAgentClient).not.toHaveBeenCalled();
  });
});

describe("Chat's pairings", () => {
  it("reads the evidence on Chat's own client", async () => {
    const chat = client({ data: { done_together: [], crowded_hours: [] }, error: null });
    await planChatPairings({ supabase: chat as never, userId: USER, localDate: DAY, timezone: "America/New_York",
      now: Temporal.Instant.from("2026-11-25T13:00:00Z"), calendarBusy: [] });
    expect(chat.rpc).toHaveBeenCalledExactlyOnceWith("advisor_read_pairing_evidence", { p_local_date: DAY });
    expect(mocks.createAgentClient).not.toHaveBeenCalled();
    expect(mocks.createAgentContext).not.toHaveBeenCalled();
  });
});

describe("the service source", () => {
  it("mints no agent client and never names the coach's signal reader", () => {
    const source = readFileSync(join(process.cwd(), "lib/services/alongside-pairing.service.ts"), "utf8");
    expect(source).not.toMatch(/agent-caller|createAgentClient|createAgentContext/);
    expect(source).not.toMatch(/coach_read_signals|readStoredSignals|"coach"/);
  });
});
