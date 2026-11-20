import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AdviceCard } from "@cadence/core/types/advice-cards";

const auth = vi.hoisted(() => ({ authenticateCalendarRequest: vi.fn() }));
const repo = vi.hoisted(() => ({ nextTip: vi.fn(), reactToTip: vi.fn(), recentTips: vi.fn() }));

vi.mock("@/lib/services/google-calendar-request", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/google-calendar-request")>()),
  authenticateCalendarRequest: auth.authenticateCalendarRequest,
}));
vi.mock("@/lib/db/advisor-tips.repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db/advisor-tips.repo")>()),
  nextTip: repo.nextTip, reactToTip: repo.reactToTip, recentTips: repo.recentTips,
}));

import { CalendarConnectionError } from "@/lib/services/google-calendar-oauth";
import { handleNextTip, handleRecentTips, handleTipReaction, parseReaction, type TipRequestDeps } from "@/lib/services/advisor-tips-request";

// Advisor plan Phase 4, workstream 4B step 5: the tip routes.

const CARD: AdviceCard = {
  id: "drop", revision: 2, status: "active", advice: "Advice.", action: "Action.", limitation: "Limitation.",
  applies_when: [{ signal: "completion_drop", scope: "behavior", facts: [] }], does_not_apply_when: [],
  evidence: { source_id: "missing", kind: "meta_analysis", strength: "moderate", claim: "Claim.", quote: "Quote.", locator: "Abstract" },
  quip_seeds: ["One.", "Two."], audience: "any_account", reviewed_at: "2026-11-19", reviewer: "Emi",
};

const ROW = { id: "11111111-1111-4111-8111-111111111111", localDate: "2026-11-19", text: "Gym: 2 of 8.", cardId: "drop", cardRevision: 2, behaviorId: "b-gym", shownAt: "2026-11-19T09:00:00Z", reaction: null };

function deps(overrides: Partial<TipRequestDeps> = {}): TipRequestDeps {
  return { settings: async () => ({ tipsOn: true, notesAllowed: false }), firstDay: vi.fn(async () => 0), cards: [CARD], ...overrides };
}

const get = () => new Request("https://cadence.test/api/advisor/tips/next", { headers: { authorization: "Bearer t" } });
const post = (body: unknown) => new Request("https://cadence.test/api/advisor/tips/reaction", {
  method: "POST", headers: { authorization: "Bearer t", "content-type": "application/json" }, body: JSON.stringify(body),
});

beforeEach(() => {
  vi.clearAllMocks();
  auth.authenticateCalendarRequest.mockResolvedValue({ client: {}, user: { id: "u-1" }, via: "bearer" });
});

describe("GET next tip", () => {
  it("returns today's next tip with its research card", async () => {
    repo.nextTip.mockResolvedValue({ state: "tip", tip: ROW, fresh: true, nextAt: "2026-11-19T11:00:00Z" });
    const response = await handleNextTip(get(), deps());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ state: "tip", fresh: true, nextAt: "2026-11-19T11:00:00Z", tip: { id: ROW.id, text: ROW.text } });
    expect(body.tip.research).toMatchObject({ cardId: "drop", cardRevision: 2, claim: "Claim.", strength: "moderate", source: { kind: "meta_analysis" } });
    expect(repo.nextTip).toHaveBeenCalledWith({}, 120);
  });

  it("with tips off: nothing, and no tip is marked shown", async () => {
    const response = await handleNextTip(get(), deps({ settings: async () => ({ tipsOn: false, notesAllowed: false }) }));
    expect(await response.json()).toEqual({ state: "none", reason: "tips_off", nextAt: null });
    expect(repo.nextTip).not.toHaveBeenCalled();
  });

  it("fills a new account's first day from the cards, then reads again", async () => {
    repo.nextTip.mockResolvedValueOnce({ state: "none", reason: "no_tips_today", nextAt: null })
      .mockResolvedValueOnce({ state: "tip", tip: ROW, fresh: true, nextAt: null });
    const firstDay = vi.fn(async () => 2);
    const body = await (await handleNextTip(get(), deps({ firstDay }))).json();
    expect(firstDay).toHaveBeenCalledWith("u-1");
    expect(body.state).toBe("tip");
  });

  it("a failed first-day fill still answers with nothing", async () => {
    repo.nextTip.mockResolvedValue({ state: "none", reason: "no_tips_today", nextAt: null });
    const body = await (await handleNextTip(get(), deps({ firstDay: async () => { throw new Error("x"); } }))).json();
    expect(body).toEqual({ state: "none", reason: "no_tips_today", nextAt: null });
  });

  it("passes on a later time when spacing holds the next tip", async () => {
    repo.nextTip.mockResolvedValue({ state: "none", reason: "later", nextAt: "2026-11-19T13:00:00Z" });
    expect(await (await handleNextTip(get(), deps())).json()).toEqual({ state: "none", reason: "later", nextAt: "2026-11-19T13:00:00Z" });
  });

  it("answers 401 without a session", async () => {
    auth.authenticateCalendarRequest.mockRejectedValue(new CalendarConnectionError("unauthenticated"));
    const response = await handleNextTip(get(), deps());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthenticated" });
  });

  it("answers 503 when the database fails", async () => {
    repo.nextTip.mockRejectedValue(new Error("db"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await handleNextTip(get(), deps())).status).toBe(503);
  });
});

describe("POST reaction", () => {
  it("records a reaction and returns the tip", async () => {
    repo.reactToTip.mockResolvedValue({ ...ROW, reaction: "dont_suggest" });
    const response = await handleTipReaction(post({ tipId: ROW.id, reaction: "dont_suggest" }), deps());
    expect(response.status).toBe(200);
    expect((await response.json()).tip.reaction).toBe("dont_suggest");
    expect(repo.reactToTip).toHaveBeenCalledWith({}, ROW.id, "dont_suggest");
  });

  it("answers 404 for a tip that is not the person's", async () => {
    repo.reactToTip.mockResolvedValue(null);
    expect((await handleTipReaction(post({ tipId: ROW.id, reaction: "helpful" }), deps())).status).toBe(404);
  });

  it.each([
    [{ tipId: "nope", reaction: "helpful" }],
    [{ tipId: ROW.id, reaction: "love_it" }],
    [{ tipId: ROW.id, reaction: "helpful", extra: 1 }],
    [[ROW.id]],
  ])("refuses a malformed body %j", async (body) => {
    expect((await handleTipReaction(post(body), deps())).status).toBe(400);
    expect(() => parseReaction(body)).toThrow();
  });
});

describe("first-day tips (T7)", () => {
  const starter: AdviceCard = {
    ...CARD, id: "starter", audience: "first_two_weeks",
    applies_when: [{ signal: "account", scope: "account", facts: [{ fact: "behaviors_without_length", op: "gte", value: 1 }] }],
    quip_seeds: ["{behaviors_without_length} of your items have no length yet. Add one to plan the day better.", "Two."],
  };
  const today = new Date().toISOString().slice(0, 10);

  function port(createdAt: string) {
    const calls = { startRun: 0, generate: 0, written: [] as unknown[], finished: [] as unknown[] };
    const p = {
      calls,
      startRun: async () => { calls.startRun += 1; return { runId: "r", localDate: today }; },
      settings: async () => ({ tipsOn: true, notesAllowed: false }),
      signals: async () => [], history: async () => ({ tips: [], suppressedCardIds: [] }), notes: async () => [],
      setup: async () => ({ behaviors: [{ id: "b", createdAt, timezone: "UTC", active: true, hasLength: false }], occurrences: [], titles: new Map([["b", "Gym"]]) }),
      reserve: async () => ({ allowed: false as const }), settle: async () => undefined,
      generate: async () => { calls.generate += 1; return null; },
      write: async (_: string, tips: readonly unknown[]) => { calls.written.push(...tips); return tips.length; },
      storeContent: async () => undefined,
      finishRun: async (_: string, result: unknown) => { calls.finished.push(result); },
    };
    return p;
  }

  it("fills a new account's tips from first-two-weeks cards with no model call", async () => {
    const { writeFirstDayTips } = await import("@/lib/services/advisor-tips-request");
    const p = port(new Date().toISOString());
    expect(await writeFirstDayTips(p, [starter, CARD])).toBe(1);
    expect(p.calls.generate).toBe(0);
    expect(p.calls.written).toEqual([expect.objectContaining({ cardId: "starter", source: "seed", text: "1 of your items have no length yet. Add one to plan the day better." })]);
    expect(p.calls.finished).toEqual([expect.objectContaining({ outcome: "success", modelCalls: 0 })]);
  });

  it("leaves accounts older than two weeks alone, without a run row", async () => {
    const { writeFirstDayTips } = await import("@/lib/services/advisor-tips-request");
    const p = port("2026-01-01T00:00:00Z");
    expect(await writeFirstDayTips(p, [starter])).toBe(0);
    expect(p.calls.startRun).toBe(0);
  });
});

// Advisor 4E: the panel's "Earlier" list.
describe("GET recent tips", () => {
  const recent = () => new Request("https://cadence.test/api/advisor/tips/recent", { headers: { authorization: "Bearer t" } });

  it("returns shown tips from earlier days with their research cards, skipping cards that left the library", async () => {
    repo.recentTips.mockResolvedValue([{ ...ROW, localDate: "2026-11-18", reaction: "helpful" }, { ...ROW, id: "gone", cardId: "removed" }]);
    const body = await (await handleRecentTips(recent(), deps())).json();
    expect(repo.recentTips).toHaveBeenCalledWith({}, 7, 10);
    expect(body.tips).toHaveLength(1);
    expect(body.tips[0]).toMatchObject({ localDate: "2026-11-18", reaction: "helpful", research: { cardId: "drop" } });
  });

  it("with tips off: an empty list and no read", async () => {
    const body = await (await handleRecentTips(recent(), deps({ settings: async () => ({ tipsOn: false, notesAllowed: false }) }))).json();
    expect(body).toEqual({ tips: [] });
    expect(repo.recentTips).not.toHaveBeenCalled();
  });

  it("answers 401 without a session", async () => {
    auth.authenticateCalendarRequest.mockRejectedValue(new CalendarConnectionError("unauthenticated"));
    expect((await handleRecentTips(recent(), deps())).status).toBe(401);
  });
});
