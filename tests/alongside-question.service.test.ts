import { Temporal } from "@js-temporal/polyfill";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Ticket 360 (D33): one stored answer behind every surface's question.

const readFacts = vi.fn();
const getBehavior = vi.fn();
const updateBehavior = vi.fn();
const askedBefore = vi.fn();
const recordAsk = vi.fn();

vi.mock("@/lib/services/alongside-view.service", () => ({ readAlongsideBehaviorFacts: (...args: unknown[]) => readFacts(...args) }));
vi.mock("@/lib/db/brief-alongside-asks.repo", () => ({
  readBriefAlongsideAskedBefore: (...args: unknown[]) => askedBefore(...args),
  recordBriefAlongsideAsk: (...args: unknown[]) => recordAsk(...args),
}));
vi.mock("@/lib/db/behaviors.repo", () => ({ getBehaviorById: (...args: unknown[]) => getBehavior(...args) }));
vi.mock("@/lib/services/behavior.service", () => ({ answerBehaviorAlongsideQuestionForUser: (...args: unknown[]) => updateBehavior(...args) }));

const { recordBehaviorAlongsideAnswer, AlongsideAnswerError } = await import("@/lib/services/alongside-answer.service");
const { answerBriefAlongsideQuestion, parseBriefAlongsideAnswer, planBriefAlongsideQuestion, recordBriefAlongsideQuestionAsked, reopenBriefAlongsideQuestion } =
  await import("@/lib/services/brief-alongside.service");
const { attachTimelineAlongside } = await import("@cadence/core/services/timeline-alongside");
const { BriefMoveError } = await import("@/lib/services/brief-moves.service");

const ON = { CADENCE_ALONGSIDE: "on" };
const OFF = {};
const supabase = {} as never;
const HELMET = "11111111-1111-4111-8111-111111111111";
const facts = (open: Readonly<Record<string, boolean>>) => new Map(Object.entries(open).map(([id, questionOpen]) => [id, { questionOpen }]));

beforeEach(() => {
  readFacts.mockReset(); getBehavior.mockReset(); updateBehavior.mockReset(); askedBefore.mockReset(); recordAsk.mockReset();
  askedBefore.mockResolvedValue(new Set());
  recordAsk.mockResolvedValue(undefined);
});

describe("recordBehaviorAlongsideAnswer", () => {
  it("writes the setting through the Behavior definition service", async () => {
    getBehavior.mockResolvedValue({ id: HELMET, updated_at: "2026-11-25T12:00:00Z", alongside: null });
    updateBehavior.mockResolvedValue({ alongside: true, alreadyAnswered: false });
    expect(await recordBehaviorAlongsideAnswer(supabase, "user-1", { behaviorId: HELMET, alongside: true, recordedAt: "2026-11-25T14:00:00Z", env: ON }))
      .toEqual({ behaviorId: HELMET, alongside: true, changed: true });
    expect(updateBehavior).toHaveBeenCalledWith(supabase, "user-1", { behaviorId: HELMET, alongside: true }, "2026-11-25T14:00:00Z");
  });

  it("writes nothing for the answer already stored", async () => {
    getBehavior.mockResolvedValue({ id: HELMET, updated_at: "2026-11-25T12:00:00Z", alongside: false });
    expect(await recordBehaviorAlongsideAnswer(supabase, "user-1", { behaviorId: HELMET, alongside: false, env: ON }))
      .toEqual({ behaviorId: HELMET, alongside: false, changed: false });
    expect(updateBehavior).not.toHaveBeenCalled();
  });

  it("never overwrites an answer made elsewhere since the prompt was shown (audit fix 7)", async () => {
    getBehavior.mockResolvedValue({ id: HELMET, updated_at: "2026-11-25T12:30:00Z", alongside: false });
    expect(await recordBehaviorAlongsideAnswer(supabase, "user-1", { behaviorId: HELMET, alongside: true, env: ON }))
      .toEqual({ behaviorId: HELMET, alongside: false, changed: false, alreadyAnswered: true });
    expect(updateBehavior).not.toHaveBeenCalled();
    // The brief's route returns the same result.
    expect(await answerBriefAlongsideQuestion({ supabase, userId: "user-1" }, { behaviorId: HELMET, alongside: true }, ON))
      .toMatchObject({ alongside: false, alreadyAnswered: true });
  });

  it("refuses with the flag off, for a missing Behavior, and for a changed revision", async () => {
    await expect(recordBehaviorAlongsideAnswer(supabase, "user-1", { behaviorId: HELMET, alongside: true, env: OFF }))
      .rejects.toMatchObject({ code: "unavailable" });
    expect(getBehavior).not.toHaveBeenCalled();
    getBehavior.mockResolvedValue(null);
    await expect(recordBehaviorAlongsideAnswer(supabase, "user-1", { behaviorId: HELMET, alongside: true, env: ON }))
      .rejects.toMatchObject({ code: "not_found", message: "This Behavior is not in your account anymore." });
    getBehavior.mockResolvedValue({ id: HELMET, updated_at: "2026-11-25T12:00:00Z", alongside: null });
    updateBehavior.mockRejectedValue(new Error("Reload this behavior before saving changes."));
    const refused = recordBehaviorAlongsideAnswer(supabase, "user-1", { behaviorId: HELMET, alongside: true, env: ON });
    await expect(refused).rejects.toBeInstanceOf(AlongsideAnswerError);
    await expect(refused).rejects.toMatchObject({ code: "revision_changed" });
  });
});

describe("the Daily Brief question", () => {
  const item = (behaviorId: string, title: string, start: string, localDate = "2026-11-25") => ({ behaviorId, title, localDate, start: Temporal.Instant.from(start) });
  const items = [
    item("reading", "Reading", "2026-11-25T13:00:00Z"),
    item("helmet", "Red light helmet", "2026-11-25T20:00:00Z"),
    item("pill", "Pill", "2026-11-25T22:00:00Z"),
    item("helmet", "Red light helmet", "2026-11-24T20:00:00Z", "2026-11-24"),
  ];

  it("asks about the earliest of today's open items, through the one reader", async () => {
    readFacts.mockResolvedValue(facts({ reading: false, helmet: true, pill: true }));
    expect(await planBriefAlongsideQuestion(supabase, "user-1", { localDate: "2026-11-25", items, env: ON }))
      .toEqual({ behaviorId: "helmet", title: "Red light helmet" });
    expect(readFacts.mock.calls[0]![2]).toMatchObject({ behaviorIds: ["reading", "helmet", "pill"], localDate: "2026-11-25" });
  });

  it("skips a Behavior an earlier day's brief already asked about, reading only open ones", async () => {
    readFacts.mockResolvedValue(facts({ reading: false, helmet: true, pill: true }));
    askedBefore.mockResolvedValue(new Set(["helmet"]));
    expect(await planBriefAlongsideQuestion(supabase, "user-1", { localDate: "2026-11-25", items, env: ON }))
      .toEqual({ behaviorId: "pill", title: "Pill" });
    expect(askedBefore).toHaveBeenCalledExactlyOnceWith(supabase, { userId: "user-1", behaviorIds: ["helmet", "pill"], localDate: "2026-11-25" });
    askedBefore.mockResolvedValue(new Set(["helmet", "pill"]));
    expect(await planBriefAlongsideQuestion(supabase, "user-1", { localDate: "2026-11-25", items, env: ON })).toBeNull();
  });

  it("a failed asked read fails the pick, which the brief turns into no question", async () => {
    readFacts.mockResolvedValue(facts({ helmet: true }));
    askedBefore.mockRejectedValue(new Error("read failed"));
    await expect(planBriefAlongsideQuestion(supabase, "user-1", { localDate: "2026-11-25", items, env: ON })).rejects.toThrow("read failed");
  });

  it("records the asked Behavior once the brief is saved, and nothing with the flag off or no question", async () => {
    const question = { behaviorId: HELMET, title: "Red light helmet" };
    await recordBriefAlongsideQuestionAsked(supabase, "user-1", { localDate: "2026-11-25", question, env: ON });
    expect(recordAsk).toHaveBeenCalledExactlyOnceWith(supabase, { userId: "user-1", behaviorId: HELMET, localDate: "2026-11-25" });
    recordAsk.mockClear();
    await recordBriefAlongsideQuestionAsked(supabase, "user-1", { localDate: "2026-11-25", question, env: OFF });
    await recordBriefAlongsideQuestionAsked(supabase, "user-1", { localDate: "2026-11-25", question: null, env: ON });
    expect(recordAsk).not.toHaveBeenCalled();
  });

  it("asks nothing with nothing open, and reads nothing with the flag off", async () => {
    readFacts.mockResolvedValue(facts({ reading: false, helmet: false, pill: false }));
    expect(await planBriefAlongsideQuestion(supabase, "user-1", { localDate: "2026-11-25", items, env: ON })).toBeNull();
    readFacts.mockClear();
    expect(await planBriefAlongsideQuestion(supabase, "user-1", { localDate: "2026-11-25", items, env: OFF })).toBeNull();
    expect(await reopenBriefAlongsideQuestion(supabase, "user-1", { localDate: "2026-11-25", saved: { behaviorId: "helmet", title: "Red light helmet" }, env: OFF })).toBeNull();
    expect(readFacts).not.toHaveBeenCalled();
    expect(askedBefore).not.toHaveBeenCalled();
  });

  it("reopens the saved question while open and drops it once answered", async () => {
    const saved = { behaviorId: "helmet", title: "Red light helmet" };
    readFacts.mockResolvedValue(facts({ helmet: true }));
    expect(await reopenBriefAlongsideQuestion(supabase, "user-1", { localDate: "2026-11-25", saved, env: ON })).toEqual(saved);
    readFacts.mockResolvedValue(facts({ helmet: false }));
    expect(await reopenBriefAlongsideQuestion(supabase, "user-1", { localDate: "2026-11-25", saved, env: ON })).toBeNull();
    expect(await reopenBriefAlongsideQuestion(supabase, "user-1", { localDate: "2026-11-25", saved: null, env: ON })).toBeNull();
  });

  it("checks the answer body strictly", () => {
    expect(parseBriefAlongsideAnswer({ behaviorId: HELMET, alongside: true })).toEqual({ behaviorId: HELMET, alongside: true });
    for (const bad of [null, [], {}, { behaviorId: HELMET }, { behaviorId: "helmet", alongside: true }, { behaviorId: HELMET, alongside: "yes" },
      { behaviorId: HELMET, alongside: true, extra: 1 }]) {
      expect(() => parseBriefAlongsideAnswer(bad)).toThrow(BriefMoveError);
    }
  });

  it("maps a refused answer to the brief's error codes", async () => {
    getBehavior.mockResolvedValue(null);
    await expect(answerBriefAlongsideQuestion({ supabase, userId: "user-1" }, { behaviorId: HELMET, alongside: true }, ON))
      .rejects.toMatchObject({ code: "proposal_not_found" });
    await expect(answerBriefAlongsideQuestion({ supabase, userId: "user-1" }, { behaviorId: HELMET, alongside: true }, OFF))
      .rejects.toMatchObject({ code: "invalid_request" });
  });
});

describe("attachTimelineAlongside", () => {
  const view = {
    daySections: [{ localDate: "2026-11-25", occurrences: [{ id: "o1", behaviorId: "helmet" }, { id: "o2", behaviorId: "gym" }],
      occurrenceGroups: [], parentGroups: [], rows: [] }],
    needsDecision: { daySections: [] },
  } as never;

  it("returns the view itself with no rows and no questions", () => {
    expect(attachTimelineAlongside(view, {})).toBe(view);
    expect(attachTimelineAlongside(view, {}, new Set())).toBe(view);
  });

  it("marks only rows whose question is open", () => {
    const attached = attachTimelineAlongside(view, { helmet: { source: "guess" } }, new Set(["helmet"])) as unknown as
      { daySections: Array<{ occurrences: Array<Record<string, unknown>> }> };
    const [helmet, gym] = attached.daySections[0]!.occurrences;
    expect(helmet).toMatchObject({ alongside: { source: "guess" }, alongsideQuestion: true });
    expect(gym).not.toHaveProperty("alongsideQuestion");
  });
});
