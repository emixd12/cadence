import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import { validateAdvisorDayContext } from "@cadence/core/services/advisor-day-context";
import { BRIEFING_PRESETS } from "@cadence/core/services/briefing-config";
import type { AdvisorDayContext, AdvisorOccurrencePlanning } from "@cadence/core/types/advisor-day-context";
import {
  COACH_SIGNAL_VERSION, COACH_SIGNAL_VERSION_ALONGSIDE, coachSignalVersion, resolveCoachSignals,
  type CoachSignalBehavior, type CoachSignalOccurrence,
} from "@cadence/core/resolvers/coach-signals.resolver";
import { ADVICE_SIGNAL_FACTS } from "@cadence/core/types/advice-cards";
import fixture from "./fixtures/advisor-day-context.valid.json";
import { generateDailyBrief } from "@/lib/services/daily-brief-consumer";
import {
  CHAT_ALONGSIDE_INSTRUCTIONS, CHAT_ALONGSIDE_PAIRING_RULE, CHAT_PROMPT_VERSION, CHAT_STATIC_INSTRUCTIONS, buildChatSystemPrompt, chatPromptVersion,
} from "@/lib/services/chat/chat-prompt";
import { chatPlanningBehaviorIds, withChatPlanning } from "@/lib/services/chat/chat-planning";
import { withPlanningFacts } from "@/lib/services/chat/chat-executor";
import { compactTimeline } from "@/lib/services/chat/chat.service";
import { visitCoachAccount, type CoachVisitPort } from "@/lib/services/coach-signals-job.service";

// Ticket 359 (D33): the advisor readers (the Daily Brief consumer, the day context, Chat
// and the coach) read the effective alongside value and Where, only while
// CADENCE_ALONGSIDE is on. With it off every output is what it was before.

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const context = validateAdvisorDayContext(fixture);
const walk = context.cadence.occurrences[0]!;
const now = () => Temporal.Instant.from(context.capturedAt);
const signal = () => new AbortController().signal;
const v12 = BRIEFING_PRESETS.find((item) => item.id === "advisor-analysis-3")!.config;

function withPlanning(planning: AdvisorOccurrencePlanning): AdvisorDayContext {
  return validateAdvisorDayContext({ ...structuredClone(fixture),
    cadence: { ...structuredClone(fixture).cadence, occurrences: structuredClone(fixture).cadence.occurrences.map((item, index) => index === 0 ? { ...item, planning } : item) } });
}

describe("day context planning field", () => {
  const planning: AdvisorOccurrencePlanning = { alongside: true, alongsideSource: "guess", where: { kind: "place", source: "evidence", placeKey: "k".repeat(43) } };

  it("accepts the documented shape and is optional", () => {
    expect(withPlanning(planning).cadence.occurrences[0]!.planning).toEqual(planning);
    expect(context.cadence.occurrences[0]).not.toHaveProperty("planning");
  });

  it("refuses extra fields, unknown values and a place key on anything but a place", () => {
    const bad = (value: unknown) => () => validateAdvisorDayContext({ ...structuredClone(fixture),
      cadence: { ...structuredClone(fixture).cadence, occurrences: structuredClone(fixture).cadence.occurrences.map((item, index) => index === 0 ? { ...item, planning: value } : item) } });
    expect(bad({ ...planning, label: "Gym" })).toThrow();
    expect(bad({ ...planning, alongsideSource: "model" })).toThrow();
    expect(bad({ ...planning, where: { kind: "home", source: "guess", placeKey: "k".repeat(43) } })).toThrow();
    expect(bad({ ...planning, where: { kind: "place", source: "person", placeKey: "Lift Club, 40.7,-74.0" } })).toThrow();
  });
});

describe("Daily Brief consumer reads the day context's planning", () => {
  const reply = () => vi.fn().mockResolvedValue({ text: "", occurrenceRefs: [], suggestions: [], tip: null });

  it("the person's yes keeps the Walk out of moves and conflicts; the model never sees planning", async () => {
    const generate = reply();
    await generateDailyBrief(withPlanning({ alongside: true, alongsideSource: "person", where: { kind: "anywhere", source: "person" } }),
      { generate, now, signal: signal(), config: v12 });
    const facts = generate.mock.calls[0]![0].facts as string;
    const plan = JSON.parse(facts).plan;
    expect(plan.options).toEqual([]);
    expect(plan.dayEvidence.findings.some((finding: { kind: string }) => finding.kind === "known_overlap")).toBe(false);
    for (const hidden of ["planning", "alongsideSource", "placeKey", "anywhere"]) expect(facts).not.toContain(hidden);
  });

  it("the person's no outranks this run's estimate, which guessed yes", async () => {
    const generate = reply();
    const estimate = vi.fn().mockResolvedValue({ estimates: [{ behaviorRef: walk.behaviorRef, minutes: 20, basis: "inferred", alongside: true }] });
    await generateDailyBrief(withPlanning({ alongside: false, alongsideSource: "person", where: { kind: "unknown", source: "none" } }),
      { generate, estimate, descriptions: {}, now, signal: signal(), config: v12 });
    expect(JSON.parse(generate.mock.calls[0]![0].facts).plan.options.map((option: { occurrenceRef: string }) => option.occurrenceRef)).toEqual([walk.ref]);
  });

  it("this run's estimate outranks a cached guess, as before", async () => {
    const generate = reply();
    const estimate = vi.fn().mockResolvedValue({ estimates: [{ behaviorRef: walk.behaviorRef, minutes: 20, basis: "inferred", alongside: false }] });
    await generateDailyBrief(withPlanning({ alongside: true, alongsideSource: "guess", where: { kind: "home", source: "guess" } }),
      { generate, estimate, descriptions: {}, now, signal: signal(), config: v12 });
    expect(JSON.parse(generate.mock.calls[0]![0].facts).plan.options).toHaveLength(1);
  });
});

describe("Chat", () => {
  /** sha256 of the chat-1.7 static text and of one full prompt, computed from origin/main at 088558ca (before the alongside rule). */
  const CHAT_1_7_STATIC_SHA256 = "6bb105248e97a3b6a74ddb2edc444559af7e8a7b3ca6d13ff1df7d39a2011954";
  const CHAT_1_7_PROMPT_SHA256 = "592a534d63258ea0213a0daf4c9304873178c27ddeeb31daf055acfbfb95d36c";
  const promptContext = { timezone: "America/New_York", today: "2026-11-25", localTime: "08:40", weekday: "Wednesday", sourcesOff: [] };

  it("flag off: chat-1.7 and its prompt, unchanged", () => {
    expect(chatPromptVersion(false)).toBe(CHAT_PROMPT_VERSION);
    expect(CHAT_PROMPT_VERSION).toBe("chat-1.7");
    expect(buildChatSystemPrompt(promptContext)).toBe(buildChatSystemPrompt({ ...promptContext, alongside: false }));
    expect(buildChatSystemPrompt(promptContext).startsWith(`${CHAT_STATIC_INSTRUCTIONS}\n\nThe person's timezone:`)).toBe(true);
    expect(buildChatSystemPrompt(promptContext)).not.toContain("alongside");
    expect(sha(CHAT_STATIC_INSTRUCTIONS)).toBe(CHAT_1_7_STATIC_SHA256);
    expect(sha(buildChatSystemPrompt(promptContext))).toBe(CHAT_1_7_PROMPT_SHA256);
  });

  it("flag on: chat-1.8 adds the alongside rule to the cached part", () => {
    expect(chatPromptVersion(true)).toBe("chat-1.8");
    const prompt = buildChatSystemPrompt({ ...promptContext, alongside: true });
    expect(prompt.startsWith(`${CHAT_STATIC_INSTRUCTIONS}\n\n${CHAT_ALONGSIDE_INSTRUCTIONS}\n\nThe person's timezone:`)).toBe(true);
    // No asking (Ticket 360) here. Ticket 361 adds the pairing rule, and only it names the pairing tool.
    expect(CHAT_ALONGSIDE_INSTRUCTIONS).not.toMatch(/\bask\b/i);
    expect(CHAT_ALONGSIDE_INSTRUCTIONS.endsWith(` ${CHAT_ALONGSIDE_PAIRING_RULE}`)).toBe(true);
    expect(CHAT_ALONGSIDE_INSTRUCTIONS.match(/plan_alongside_pairings/g)).toHaveLength(1);
  });

  const timeline = {
    timezone: "America/New_York", today_local_date: "2026-11-25",
    days: [{ local_date: "2026-11-25", occurrences: [
      { id: "o1", behavior_id: "helmet", behavior_title: "Red light helmet", local_date: "2026-11-25", status: "unresolved", revision: "r1", alongside: null },
      { id: "o2", behavior_id: "gym", behavior_title: "Gym session", local_date: "2026-11-25", status: "unresolved", revision: "r2", alongside: false },
    ] }],
    needs_decision: { occurrences: [], total_count: 0 },
  };
  const facts = new Map([
    ["helmet", { alongside: { value: true, source: "guess" as const }, where: { kind: "home" as const, source: "guess" as const, placeKey: undefined } }],
    ["gym", { alongside: { value: false, source: "person" as const }, where: { kind: "place" as const, source: "person" as const, placeKey: "k".repeat(43) } }],
  ]);

  it("adds planning to each item, with the Where kind and never a place key", () => {
    expect(chatPlanningBehaviorIds(timeline)).toEqual(["helmet", "gym"]);
    const planned = withChatPlanning(timeline, facts) as typeof timeline;
    expect(planned.days[0]!.occurrences.map((item) => (item as { planning?: unknown }).planning)).toEqual([
      { alongside: true, alongside_source: "guess", where: "home", where_source: "guess" },
      { alongside: false, alongside_source: "person", where: "place", where_source: "person" },
    ]);
    expect(JSON.stringify(planned)).not.toContain("k".repeat(43));
    expect(timeline.days[0]!.occurrences[0]).not.toHaveProperty("planning");
    // The first turn's compact Timeline keeps it.
    expect((compactTimeline(planned) as { items: Array<{ planning?: unknown }> }).items[0]!.planning).toEqual(
      { alongside: true, alongside_source: "guess", where: "home", where_source: "guess" });
    expect((compactTimeline(timeline) as { items: object[] }).items[0]).not.toHaveProperty("planning");
  });

  it("adds planning to Behavior reads", () => {
    const behaviors = { behaviors: [{ id: "gym", title: "Gym session", is_opportunity: false, schedules: [], alongside: false }] };
    expect((withChatPlanning(behaviors, facts) as { behaviors: Array<{ planning?: unknown }> }).behaviors[0]!.planning)
      .toEqual({ alongside: false, alongside_source: "person", where: "place", where_source: "person" });
  });

  it("flag off: the executor's result is the MCP result itself, with nothing read", async () => {
    const supabase = { from: vi.fn() };
    const context = { supabase, userId: "user" } as never;
    expect(await withPlanningFacts("get_timeline", timeline, context, "2026-11-25", {})).toBe(timeline);
    expect(await withPlanningFacts("set_occurrence_status", timeline, context, "2026-11-25", { CADENCE_ALONGSIDE: "on" })).toBe(timeline);
    expect(supabase.from).not.toHaveBeenCalled();
  });
});

describe("coach signals version 4", () => {
  const TODAY = "2026-11-19";
  const behavior = (id: string, extra: Partial<CoachSignalBehavior> = {}): CoachSignalBehavior =>
    ({ id, createdAt: "2026-08-01T12:00:00Z", timezone: "America/New_York", active: true, ...extra });
  let serial = 0;
  const rows = (behaviorId: string, statuses: readonly CoachSignalOccurrence["status"][], startTime: string): CoachSignalOccurrence[] =>
    statuses.map((status, index) => ({ id: `o${(serial += 1)}`, behaviorId, status, scheduleKind: "exact", startTime,
      localDate: Temporal.PlainDate.from(TODAY).subtract({ days: statuses.length - index }).toString() }));
  // Helmet and Reading: done on the same days 10 of 12, both missed the other 2.
  const together = [...Array(10).fill("completed"), "not_completed", "not_completed"] as CoachSignalOccurrence["status"][];
  const input = (alongside: boolean | undefined) => ({
    today: TODAY,
    behaviors: [behavior("helmet", alongside === undefined ? {} : { alongside }), behavior("reading", alongside === undefined ? {} : { alongside: false })],
    occurrences: [...rows("helmet", together, "20:00:00"), ...rows("reading", together, "20:00:00")],
    decisions: [], moves: [], answers: [],
  });

  it("versions only with the flag", () => {
    expect([coachSignalVersion(false), coachSignalVersion(true)]).toEqual([COACH_SIGNAL_VERSION, COACH_SIGNAL_VERSION_ALONGSIDE]);
    expect(COACH_SIGNAL_VERSION_ALONGSIDE).toBe("coach-signals-4");
    expect(ADVICE_SIGNAL_FACTS.done_together).toEqual(expect.arrayContaining(["alongside", "other_alongside"]));
  });

  it("done_together says which side is alongside, and version 3 facts are unchanged", () => {
    const v3 = resolveCoachSignals(input(undefined)).filter((item) => item.kind === "done_together");
    const v4 = resolveCoachSignals(input(true)).filter((item) => item.kind === "done_together");
    expect(v3.length).toBeGreaterThan(0);
    for (const item of v3) expect(item.facts).not.toHaveProperty("alongside");
    expect(v4.map((item) => ({ ...item, facts: { ...item.facts } }))).toEqual(v3.map((item) => ({ ...item, facts: {
      ...item.facts, alongside: item.behaviorId === "helmet", other_alongside: item.behaviorId !== "helmet",
    } })));
  });

  it("the visit stores version 4 facts only when the port reads alongside", async () => {
    const port = (alongside?: CoachVisitPort["alongside"]): CoachVisitPort => ({
      startRun: async () => ({ runId: "run", localDate: TODAY }),
      reads: {
        behaviors: async () => input(undefined).behaviors, occurrences: async () => input(undefined).occurrences,
        decisions: async () => [], moves: async () => [], answers: async () => ({ source: "proposals" as const, rows: [] }),
        reminders: async () => [], sessions: async () => [],
      } as never,
      ...(alongside ? { alongside } : {}),
      record: vi.fn(async (_run: string, signals: readonly unknown[]) => signals.length),
      finishRun: async () => undefined,
    });
    const off = port();
    await visitCoachAccount(off);
    const on = port(async () => new Map([["helmet", true], ["reading", false]]));
    await visitCoachAccount(on);
    const stored = (visit: CoachVisitPort) => ((visit.record as ReturnType<typeof vi.fn>).mock.calls[0]![1] as Array<{ kind: string; facts: object }>)
      .filter((item) => item.kind === "done_together");
    expect(stored(off).every((item) => !("alongside" in item.facts))).toBe(true);
    expect(stored(on).every((item) => "alongside" in item.facts)).toBe(true);
  });
});
