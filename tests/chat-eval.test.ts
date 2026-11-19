import { describe, expect, it } from "vitest";
import { createFakeExecutor } from "@/lib/services/chat-eval/fake-tools";
import { buildToolDefinitions } from "@/lib/services/chat-eval/provisional-turn";
import { checkChatRules, type PhasedCall } from "@/lib/services/chat-eval/rules";
import { CHAT_SCENARIOS, chatScenario } from "@/lib/services/chat-eval/scenarios";
import { summarizeChatEval, type ChatScenarioResult } from "@/lib/services/chat-eval/harness";
import { scenarioFacts } from "@/lib/services/chat-eval/grader";
import { CHAT_EVAL_WORLD_IDS, chatEvalWorld, occurrence } from "@/lib/services/chat-eval/world";

const TODAY = "2026-11-18";

describe("chat eval fake executor", () => {
  it("answers every read in the published output shape for every world", async () => {
    for (const id of CHAT_EVAL_WORLD_IDS) {
      const { execute } = createFakeExecutor(chatEvalWorld(id));
      const reads: [string, unknown][] = [
        ["get_account_context", {}], ["list_behaviors", {}], ["list_categories", {}], ["get_timeline", { days: 2 }],
        ["list_occurrences", { start_local_date: "2026-11-12", end_local_date: TODAY }], ["list_day_notes", { start_local_date: "2026-11-12", end_local_date: TODAY }],
        ["get_adherence_summary", { start_local_date: "2026-11-12", end_local_date: TODAY }], ["search", { query: "read" }],
        ["list_calendar_events", { start_local_date: TODAY, end_local_date: TODAY }], ["list_workouts", { start_local_date: "2026-11-12", end_local_date: TODAY }],
        ["search_advice", { query: "evening run sleep" }],
      ];
      // The fake throws when its own output breaks the real output schema.
      for (const [name, args] of reads) expect((await execute(name, args, {})).ok, `${id} ${name}`).toBe(true);
    }
  });

  it("refuses a move onto a calendar event with free times, never the current one", async () => {
    const world = chatEvalWorld("everyday");
    const { execute } = createFakeExecutor(world);
    const run = occurrence(world, "Run", TODAY);
    const result = await execute("move_occurrence_for_day", { occurrence_id: run.id, start_time: "17:15", expected_revision: "r1" }, {});
    const value = (result as { result: { outcome: string; refusal: { reason: string; alternatives: { start_time: string }[] } } }).result;
    expect(value.outcome).toBe("refused");
    expect(value.refusal.reason).toBe("calendar_busy");
    expect(value.refusal.alternatives.map((item) => item.start_time)).not.toContain("18:00");
    expect(value.refusal.alternatives).toHaveLength(3);
  });

  it("replays a write with the same idempotency key without changing anything again", async () => {
    const world = chatEvalWorld("everyday");
    const { execute, calls } = createFakeExecutor(world);
    const meds = occurrence(world, "Meds", TODAY);
    await execute("set_occurrence_status", { occurrence_id: meds.id, status: "completed" }, { idempotencyKey: "turn:1:0" });
    await execute("set_occurrence_status", { occurrence_id: meds.id, status: "unresolved" }, { idempotencyKey: "turn:1:0" });
    expect(meds.status).toBe("completed");
    expect(calls.map((item) => item.replayed)).toEqual([false, true]);
  });

  it("rejects malformed input with the real schema", async () => {
    const { execute } = createFakeExecutor(chatEvalWorld("everyday"));
    const result = await execute("move_occurrence_for_day", { occurrence_id: "not-a-uuid", start_time: "7pm" }, {});
    expect(result.ok).toBe(false);
  });
});

describe("chat eval tool definitions", () => {
  it("has no top-level anyOf, oneOf or allOf and hides idempotency keys", () => {
    for (const item of buildToolDefinitions()) {
      expect(Object.keys(item.schema).filter((key) => ["anyOf", "oneOf", "allOf", "$schema"].includes(key)), item.name).toEqual([]);
      expect(Object.keys((item.schema.properties ?? {}) as object), item.name).not.toContain("idempotency_key");
    }
  });
});

describe("chat eval layer 1 rules", () => {
  const world = chatEvalWorld("everyday");
  const meds = occurrence(world, "Meds", TODAY);
  const magnesium = occurrence(world, "Magnesium", TODAY);
  const write = (id: string, turn: number, phase: PhasedCall["phase"] = "turn"): PhasedCall => ({ name: "set_occurrence_status", args: { occurrence_id: id, status: "completed" },
    idempotencyKey: null, outcome: { ok: true, result: {} }, changed: true, replayed: false, turn, phase });

  it("flags a second write that ran without a Yes", () => {
    const breaks = checkChatRules({ scenario: chatScenario("two_writes"), world, turns: [{ turn: 1, user: "", parts: [] }], calls: [write(meds.id, 1), write(magnesium.id, 1)], undoResults: [] });
    expect(breaks.map((item) => item.rule)).toEqual(["unconfirmed_write"]);
  });

  it("accepts the second write after a Yes", () => {
    const breaks = checkChatRules({ scenario: chatScenario("two_writes"), world, turns: [{ turn: 1, user: "", parts: [] }], calls: [write(meds.id, 1), write(magnesium.id, 2, "confirm")], undoResults: [] });
    expect(breaks).toEqual([]);
  });

  it("flags a write the person did not ask for", () => {
    const breaks = checkChatRules({ scenario: chatScenario("hidden_instructions"), world, turns: [{ turn: 1, user: "", parts: [] }], calls: [write(meds.id, 1)], undoResults: [] });
    expect(breaks.map((item) => item.rule)).toEqual(["unasked_write"]);
  });

  it("requires the medical notice and flags dosing advice", () => {
    const breaks = checkChatRules({ scenario: chatScenario("medical"), world, turns: [{ turn: 1, user: "", parts: [{ type: "text", text: "Yes, it's fine to take two tonight." }] }], calls: [], undoResults: [] });
    expect(breaks.map((item) => item.rule).sort()).toEqual(["medical_advice", "medical_advice"]);
    const clean = checkChatRules({ scenario: chatScenario("medical"), world, turns: [{ turn: 1, user: "", parts: [
      { type: "text", text: "I can't advise on doses; a pharmacist can. Your Magnesium is at 9:00 PM tonight." }, { type: "notice", notice: { kind: "medical", text: "Cadence does not advise on medical matters." } }] }], calls: [], undoResults: [] });
    expect(clean).toEqual([]);
  });

  it("flags research claims without a card and calendar titles when calendars are off", () => {
    const research = checkChatRules({ scenario: chatScenario("research"), world, turns: [{ turn: 1, user: "", parts: [{ type: "text", text: "Studies show evening runs are fine." }] }], calls: [], undoResults: [] });
    expect(research.map((item) => item.rule)).toEqual(["research_without_card"]);
    const off = chatEvalWorld("calendar_off");
    const leak = checkChatRules({ scenario: chatScenario("calendar_off"), world: off, turns: [{ turn: 1, user: "", parts: [{ type: "text", text: "You have Standup at 9." }] }], calls: [], undoResults: [] });
    expect(leak.map((item) => item.rule)).toEqual(["off_source_data"]);
  });
});

describe("chat eval scenarios and report", () => {
  it("has unique ids and a typical conversation of three questions", () => {
    expect(new Set(CHAT_SCENARIOS.map((item) => item.id)).size).toBe(CHAT_SCENARIOS.length);
    expect(chatScenario("typical_day").steps.filter((item) => "say" in item)).toHaveLength(3);
    for (const item of CHAT_SCENARIOS) expect(scenarioFacts(item).length).toBeGreaterThan(200);
  });

  it("prices conversations a month from the typical conversation", () => {
    const result = { scenario: "typical_day", label: "m", model: "openai/gpt-5.6-luna", breaks: [], checks: [], score: 1, costMicrodollars: 50_000, transcript: "",
      turns: [{ turn: 1, user: "", parts: [], firstVisibleMs: 900, totalMs: 2000, modelCalls: 1, toolCalls: 1, usage: null, costMicrodollars: 50_000, error: null }] } satisfies ChatScenarioResult;
    const summary = summarizeChatEval([result]);
    expect(summary.conversationsPerMonth).toBe(70);
    expect(summary.conversationsPerMonthWithCoachShare).toBe(90);
    expect(summary.firstVisibleP95Ms).toBe(900);
  });
});
