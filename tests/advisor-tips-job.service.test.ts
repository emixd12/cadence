import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it, vi } from "vitest";

import type { AdviceCard, AdviceSignalInput } from "@cadence/core/types/advice-cards";

import type { StoredTip, TipHistory, TipToWrite } from "@/lib/db/advisor-tips.repo";
import type { AgentModelSetting } from "@/lib/services/agent-model";
import { processCoachTips, visitAdvisorTips, withOffers, type TipVisitPort } from "@/lib/services/advisor-tips-job.service";
import type { AdvisorTipsSettings } from "@/lib/services/advisor-tips-settings";

// Advisor plan Phase 4, workstream 4B steps 2, 6 and 9: the daily tip run.

const SETTING: AgentModelSetting = { model: "openai/gpt-5.6-luna", reasoning: "low", maxOutputTokens: 1000, timeoutMs: 20_000 };

function card(id: string, signal: string, seeds: string[]): AdviceCard {
  return {
    id, revision: 1, status: "active", advice: "Advice.", action: "Pick one fixed time.", limitation: "Limitation.",
    applies_when: [{ signal: signal as never, scope: "behavior", facts: [] }], does_not_apply_when: [],
    evidence: { source_id: "s", kind: "meta_analysis", strength: "moderate", claim: "Claim.", quote: "Quote.", locator: "Abstract" },
    quip_seeds: seeds, audience: "any_account", reviewed_at: "2026-11-19", reviewer: "Emi", offer: null,
  };
}

const CARDS = [
  card("drop", "completion_drop", ["{behavior}: {recent_completed} of {recent_resolved} done lately.", "{behavior} is at {recent_completed} of {recent_resolved}."]),
  card("steady", "steady_behavior", ["{behavior} was done {completed} of {resolved} days.", "{behavior}: {completed} of {resolved}."]),
];

const DROP: AdviceSignalInput = { id: "1", kind: "completion_drop", behaviorId: "b-gym", facts: { recent_completed: 2, recent_resolved: 8, recent_rate: 0.25, drop: 0.5 } };
const STEADY: AdviceSignalInput = { id: "2", kind: "steady_behavior", behaviorId: "b-read", facts: { completed: 26, resolved: 28, rate: 0.93, window_days: 28 } };

type FakeState = {
  today: string;
  settings: AdvisorTipsSettings;
  signals: AdviceSignalInput[];
  tips: StoredTip[];
  suppressed: string[];
  reserveAllowed: boolean;
  generate: TipVisitPort["generate"];
  periods?: NonNullable<TipVisitPort["periods"]>;
  runs: { runId: string; outcome?: string; errorCode?: string | null; modelCalls?: number }[];
  storedSignals: number;
};

function fakePort(state: FakeState): TipVisitPort & { calls: { generate: number; notes: number; periods: string[]; write: TipToWrite[][] } } {
  const calls = { generate: 0, notes: 0, periods: [] as string[], write: [] as TipToWrite[][] };
  return {
    calls,
    async startRun() {
      const runId = `run-${state.runs.length + 1}`;
      state.runs.push({ runId });
      return { runId, localDate: state.today };
    },
    settings: async () => state.settings,
    signals: async () => state.signals,
    setup: async () => ({
      behaviors: [
        { id: "b-gym", createdAt: "2026-08-01T10:00:00Z", timezone: "UTC", active: true },
        { id: "b-read", createdAt: "2026-08-01T10:00:00Z", timezone: "UTC", active: true },
      ],
      occurrences: [],
      titles: new Map([["b-gym", "Gym"], ["b-read", "Reading"]]),
    }),
    history: async (since) => ({ tips: state.tips.filter((tip) => tip.localDate >= since), suppressedCardIds: state.suppressed }) satisfies TipHistory,
    notes: async () => { calls.notes += 1; return []; },
    periods: async (localDate) => { calls.periods.push(localDate); return state.periods ? state.periods(localDate) : []; },
    reserve: async () => state.reserveAllowed ? { allowed: true, reservationId: "res-1" } : { allowed: false },
    settle: async () => undefined,
    generate: async (input) => { calls.generate += 1; return state.generate(input); },
    async write(runId, tips) {
      calls.write.push([...tips]);
      tips.forEach((tip, index) => state.tips.push({
        localDate: state.today, position: index + 1, cardId: tip.cardId, behaviorId: tip.behaviorId, factIds: tip.factIds,
        factValues: tip.factValues, source: tip.source, shownAt: null, reaction: null,
      }));
      return tips.length;
    },
    storeContent: async () => undefined,
    async finishRun(runId, result) {
      Object.assign(state.runs.find((run) => run.runId === runId)!, { outcome: result.outcome, errorCode: result.errorCode, modelCalls: result.modelCalls });
    },
  };
}

function state(overrides: Partial<FakeState> = {}): FakeState {
  return {
    today: "2026-11-19", settings: { tipsOn: true, notesAllowed: false, reminderHistoryAllowed: true }, signals: [DROP, STEADY], tips: [], suppressed: [],
    reserveAllowed: true, runs: [], storedSignals: 2,
    generate: async () => ({ tips: [
      { ref: "t1", text: "Gym: 2 of 8 done lately. Pick one fixed time." },
      { ref: "t2", text: "Reading was done 26 of 28 days." },
    ] }),
    ...overrides,
  };
}

const run = (port: TipVisitPort, extra: Partial<Parameters<typeof visitAdvisorTips>[1]> = {}) =>
  visitAdvisorTips(port, { setting: SETTING, cards: CARDS, statuses: ["active"], maxPerDay: 3, ...extra });

describe("visitAdvisorTips", () => {
  it("makes one model call and writes the checked lines", async () => {
    const s = state();
    const port = fakePort(s);
    const outcome = await run(port);
    expect(outcome).toEqual({ written: 2, modelCalls: 1, skipped: null, modelFailed: false, rejected: 0 });
    expect(port.calls.write[0]!.map((tip) => tip.source)).toEqual(["model", "model"]);
    expect(s.runs[0]).toMatchObject({ outcome: "success", modelCalls: 1 });
    expect(port.calls.notes).toBe(0);
  });

  it("reads day notes only when the notes choice allows it", async () => {
    const port = fakePort(state({ settings: { tipsOn: true, notesAllowed: true, reminderHistoryAllowed: true } }));
    await run(port);
    expect(port.calls.notes).toBe(1);
  });

  it("Ticket 371: sends Period labels and dates under the tips switch, with the notes choice off", async () => {
    const prompts: string[] = [];
    const s = state({ periods: async () => [{ label: "Sick", start: "2026-11-17", end: null }] });
    const answer = s.generate;
    s.generate = async (input) => { prompts.push(input.prompt); return answer(input); };
    const port = fakePort(s);
    expect(await run(port)).toMatchObject({ written: 2, modelCalls: 1 });
    expect(port.calls.periods).toEqual(["2026-11-19"]);
    expect(port.calls.notes).toBe(0);
    const body = JSON.parse(prompts[0]!) as Record<string, unknown>;
    expect(body.periods).toEqual([{ label: "Sick", start: "2026-11-17", end: null }]);
    expect(body).not.toHaveProperty("recent_day_notes");
  });

  it("Ticket 371: writes the tips without Periods when they cannot be read, or when the port reads none", async () => {
    const prompts: string[] = [];
    const s = state({ periods: async () => { throw new Error("Periods could not be loaded."); } });
    const answer = s.generate;
    s.generate = async (input) => { prompts.push(input.prompt); return answer(input); };
    expect(await run(fakePort(s))).toMatchObject({ written: 2, modelCalls: 1, modelFailed: false });
    expect(s.runs[0]).toMatchObject({ outcome: "success" });
    const { periods: _periods, ...without } = fakePort(s);
    expect(await run(without)).toBeDefined();
    for (const prompt of prompts) expect(JSON.parse(prompt)).not.toHaveProperty("periods");
  });

  it("Ticket 371: reads no Periods with tips off or with no tip to write", async () => {
    const off = fakePort(state({ settings: { tipsOn: false, notesAllowed: true, reminderHistoryAllowed: true } }));
    await run(off);
    const none = fakePort(state({ signals: [] }));
    await run(none);
    expect([off.calls.periods, none.calls.periods]).toEqual([[], []]);
  });

  it("with tips off: zero model calls, nothing written, stored tips stay", async () => {
    const old: StoredTip = { localDate: "2026-11-18", position: 1, cardId: "drop", behaviorId: "b-gym", factIds: [], factValues: {}, source: "seed", shownAt: "2026-11-18T09:00:00Z", reaction: null };
    const s = state({ settings: { tipsOn: false, notesAllowed: false, reminderHistoryAllowed: true }, tips: [old] });
    const port = fakePort(s);
    expect(await run(port)).toEqual({ written: 0, modelCalls: 0, skipped: "tips_off", rejected: 0 });
    expect(port.calls.generate).toBe(0);
    expect(port.calls.write).toEqual([]);
    expect(s.tips).toEqual([old]);
  });

  it("leaves reminder history out when the AI features settings turn it off", async () => {
    const reminderCard = card("reminder", "reminder_response", ["{behavior}: {quick} of {marked} marked soon after a reminder."]);
    const reminder: AdviceSignalInput = { id: "3", kind: "reminder_response", behaviorId: "b-gym", facts: { quick: 6, marked: 8 } };
    const off = fakePort(state({ signals: [reminder], settings: { tipsOn: true, notesAllowed: false, reminderHistoryAllowed: false } }));
    expect(await run(off, { cards: [reminderCard] })).toMatchObject({ written: 0, modelCalls: 0, skipped: "no_match" });
    expect(off.calls.generate).toBe(0);
    const on = fakePort(state({ signals: [reminder], generate: async () => ({ tips: [{ ref: "t1", text: "Gym: 6 of 8 marked soon after a reminder." }] }) }));
    expect(await run(on, { cards: [reminderCard] })).toMatchObject({ written: 1 });
  });

  it("with no matching card: no call and no tips (no filler)", async () => {
    const port = fakePort(state({ signals: [] }));
    expect(await run(port)).toMatchObject({ written: 0, modelCalls: 0, skipped: "no_match" });
    expect(port.calls.generate).toBe(0);
  });

  it("when the budget is used up: the cards' own wording, no call, no error", async () => {
    const s = state({ reserveAllowed: false });
    const port = fakePort(s);
    expect(await run(port)).toMatchObject({ written: 2, modelCalls: 0, skipped: "budget" });
    expect(port.calls.write[0]!.map((tip) => tip.source)).toEqual(["seed", "seed"]);
    expect(s.runs[0]!.outcome).toBe("success");
  });

  it("when the model call fails: seeds are written, the run records it, and signals are untouched", async () => {
    const s = state({ generate: async () => { throw Object.assign(new Error("boom"), { reason: "timeout" }); } });
    const port = fakePort(s);
    const outcome = await run(port);
    expect(outcome).toMatchObject({ written: 2, modelCalls: 1 });
    expect(port.calls.write[0]!.every((tip) => tip.source === "seed")).toBe(true);
    // The day's tips are written, so the day counts as done and no later hour calls again.
    expect(s.runs[0]).toMatchObject({ outcome: "success", errorCode: null });
    expect(outcome.modelFailed).toBe(true);
    expect(s.signals).toEqual([DROP, STEADY]);
  });

  it("when the model call fails and nothing could be written, the run records the failure for a retry", async () => {
    const s = state({ generate: async () => { throw Object.assign(new Error("boom"), { reason: "timeout" }); } });
    const port = { ...fakePort(s), write: async () => 0 };
    await run(port);
    expect(s.runs[0]).toMatchObject({ outcome: "model_error", errorCode: "model_error" });
  });

  it("bounds the model call by the job's deadline, and skips it when too little time is left", async () => {
    const timeouts: number[] = [];
    const s = state({ generate: async () => ({ tips: [] }) });
    const base = fakePort(s);
    const port = { ...base, generate: async (input: { timeoutMs: number }) => { timeouts.push(input.timeoutMs); return { tips: [] }; } };
    await run(port, { deadlineAt: 1_000_000 + 12_000, now: () => 1_000_000 });
    expect(timeouts).toEqual([12_000]);
    const s2 = state();
    const port2 = fakePort(s2);
    const outcome = await run(port2, { deadlineAt: 1_000_000 + 2_000, now: () => 1_000_000 });
    expect(port2.calls.generate).toBe(0);
    expect(outcome).toMatchObject({ skipped: "no_time", modelCalls: 0, written: 2 });
  });

  it("replaces a refused model line with its seed", async () => {
    const port = fakePort(state({ generate: async () => ({ tips: [{ ref: "t1", text: "Great work on Gym!" }, { ref: "t2", text: "Reading was done 26 of 28 days." }] }) }));
    const outcome = await run(port);
    expect(outcome.rejected).toBe(1);
    expect(port.calls.write[0]!.map((tip) => tip.source)).toEqual(["seed", "model"]);
  });

  it("keeps a card the person turned off out, on every later day", async () => {
    const s = state({ suppressed: ["drop"] });
    for (const day of ["2026-11-19", "2026-11-20", "2026-12-10"]) {
      s.today = day;
      s.tips = [];
      const port = fakePort(s);
      await run(port);
      expect(port.calls.write.flat().map((tip) => tip.cardId)).not.toContain("drop");
    }
  });

  it("runs workstream 4C's hook after tips, and its failure never fails the visit", async () => {
    const afterTips = vi.fn().mockRejectedValue(new Error("proposal failed"));
    const s = state();
    const outcome = await run(fakePort(s), { afterTips });
    expect(afterTips).toHaveBeenCalledWith(expect.objectContaining({ runId: "run-1", localDate: "2026-11-19" }));
    expect(outcome.written).toBe(2);
    expect(s.runs[0]!.outcome).toBe("success");
  });

  it("still runs the schedule proposal hook with tips off", async () => {
    const afterTips = vi.fn().mockResolvedValue(undefined);
    const s = state({ settings: { tipsOn: false, notesAllowed: false, reminderHistoryAllowed: true } });
    const outcome = await run(fakePort(s), { afterTips });
    expect(outcome.skipped).toBe("tips_off");
    expect(afterTips).toHaveBeenCalledWith(expect.objectContaining({ runId: "run-1", matches: [] }));
  });
});

describe("a steady account over 30 days", () => {
  it("never repeats a card inside 14 days or a fact inside 7, and makes no call on a day with nothing new", async () => {
    const s = state({ signals: [STEADY] });
    let calls = 0;
    const callDays: string[] = [];
    let day = Temporal.PlainDate.from("2026-11-01");
    for (let i = 0; i < 30; i += 1, day = day.add({ days: 1 })) {
      s.today = day.toString();
      // The steady count changes once, on day 20, and stays.
      s.signals = [i >= 19 ? { ...STEADY, facts: { ...STEADY.facts, completed: 27 } } : STEADY];
      s.generate = async () => ({ tips: [{ ref: "t1", text: `Reading was done ${(s.signals[0]!.facts as { completed: number }).completed} of 28 days.` }] });
      const port = fakePort(s);
      const outcome = await run(port);
      // The app shows each written tip the same day.
      s.tips = s.tips.map((tip) => tip.localDate === s.today ? { ...tip, shownAt: `${s.today}T09:00:00Z` } : tip);
      calls += outcome.modelCalls;
      if (outcome.modelCalls > 0) callDays.push(s.today);
      if (outcome.written === 0) expect(outcome.modelCalls).toBe(0);
    }
    // Day 1 (new), day 15 (the card's 14-day rest is over), day 20 (a fact changed inside
    // the rest). Day 29 is only 9 days after the last line with the same fact: nothing new.
    expect(callDays).toEqual(["2026-11-01", "2026-11-15", "2026-11-20"]);
    expect(calls).toBe(3);
    expect(s.tips.map((tip) => tip.localDate)).toEqual(callDays);
  });
});

describe("processCoachTips", () => {
  it("visits every due account in a realistic morning window and reports accounts left over", async () => {
    const accounts = Array.from({ length: 120 }, (_, i) => ({ userId: `u-${String(i).padStart(3, "0")}`, localDate: "2026-11-19" }));
    const selectDue = async ({ after, limit }: { after: string | null; limit: number }) =>
      accounts.filter((a) => after === null || a.userId > after).slice(0, limit);
    const done = await processCoachTips({
      runBudgetMs: 26_000, selectDue,
      visit: async (account) => {
        if (account.userId === "u-007") throw new Error("bad account");
        return { written: 2, modelCalls: 1, skipped: null, rejected: 0 };
      },
    });
    expect(done).toMatchObject({ selected: 120, visited: 119, failed: 1, leftOver: 0, written: 238, modelCalls: 119 });

    let now = 0;
    const timed = await processCoachTips({
      runBudgetMs: 1_000, now: () => now, selectDue,
      visit: async () => { now += 100; return { written: 1, modelCalls: 1, skipped: null, rejected: 0 }; },
    });
    expect(timed.visited + timed.leftOver).toBe(timed.selected);
    expect(timed.leftOver).toBeGreaterThan(0);
  });
});

describe("offers on the day's tips (one-tap changes)", () => {
  const setup = {
    behaviors: [
      { id: "b-gym", createdAt: "2026-08-01T10:00:00Z", timezone: "UTC", active: true, hasLength: true, hasPlace: true },
      { id: "b-read", createdAt: "2026-08-01T10:00:00Z", timezone: "UTC", active: true, hasLength: false, hasPlace: false },
    ],
    occurrences: [],
    titles: new Map([["b-gym", "Gym"], ["b-read", "Reading"]]),
  };
  const tip = (cardId: string, behaviorId: string | null): TipToWrite => ({
    text: "A line.", cardId, cardRevision: 1, behaviorId, factIds: [], factValues: {}, source: "seed",
  });
  const cards = [
    { ...card("set-it", "repeated_move", ["One."]), offer: { kind: "set_time" as const } },
    { ...card("give-length", "missing_length", ["One."]), offer: { kind: "open" as const, target: "length" as const } },
    { ...card("unmarked", "unmarked", ["One."]), offer: { kind: "open" as const, target: "unmarked" as const } },
    card("plain", "completion_drop", ["One."]),
  ];

  it("stores the question first and falls back to a link when it is refused", async () => {
    const offers = vi.fn(async (_run: string, _date: string, list: readonly { key: string }[]) => list.map((item) => ({ key: item.key, proposalId: "p-1", reason: null })));
    const tips = await withOffers({ offers }, { runId: "r", localDate: "2026-11-19", tips: [tip("set-it", "b-gym"), tip("plain", "b-gym")], matches: [], setup, cards });
    expect(tips[0]).toMatchObject({ proposalId: "p-1", linkTarget: null });
    expect(tips[1]).not.toHaveProperty("proposalId");
    const refused = await withOffers({ offers: async () => [{ key: "0", proposalId: null, reason: "below_bar" }] },
      { runId: "r", localDate: "2026-11-19", tips: [tip("set-it", "b-gym")], matches: [], setup, cards });
    expect(refused[0]).toMatchObject({ proposalId: null, linkTarget: "time", linkBehaviorId: "b-gym" });
  });

  it("a failed proposal step never stops the tips", async () => {
    const tips = await withOffers({ offers: async () => { throw new Error("db"); } },
      { runId: "r", localDate: "2026-11-19", tips: [tip("set-it", "b-gym")], matches: [], setup, cards });
    expect(tips[0]).toMatchObject({ proposalId: null, linkTarget: "time" });
  });

  it("an account tip links to the first Behavior missing that field; Needs decision has no Behavior", async () => {
    const tips = await withOffers({}, { runId: "r", localDate: "2026-11-19", tips: [tip("give-length", null), tip("unmarked", null)], matches: [], setup, cards });
    expect(tips[0]).toMatchObject({ linkTarget: "length", linkBehaviorId: "b-read" });
    expect(tips[1]).toMatchObject({ linkTarget: "unmarked", linkBehaviorId: null });
  });
});
