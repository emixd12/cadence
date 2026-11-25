import { describe, expect, it } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { simulateReadableStream } from "ai";
import { agentModelSetting } from "@/lib/services/agent-model";
import { CHAT_PROMPT_VERSION, buildChatSystemPrompt } from "@/lib/services/chat/chat-prompt";
import { buildChatToolDefinitions, isImmediateWrite } from "@/lib/services/chat/chat-tools";
import { runChatTurn } from "@/lib/services/chat/chat-turn";
import { runChatConfirm, runChatUndo } from "@/lib/services/chat/chat-confirm";
import { describeOutcome, describePendingWrite, type ChatToolExecutor, type ChatToolResult } from "@/lib/services/chat/chat-writes";

// Sub-behaviors in chat (chat-1.6): a routine mark runs at once and its Undo sets each
// changed step back to the status chat read before; routine create and grouping wait
// for a Yes with plain lines naming the routine and its steps.

const ALL_ON = { notes: true, googleCalendar: true, outlookCalendar: true, icloudCalendar: true, hevy: true };
const usage = { inputTokens: { total: 1000, noCache: 1000, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 50, text: 50, reasoning: 0 } };
const DAY = "2026-11-19";
const SLOT = "2026-11-19T13:00:00Z";
const SKIN = "10000000-0000-4000-8000-000000000001";

type Step = { text?: string; calls?: Array<{ name: string; input: Record<string, unknown> }> };

function scriptedModel(steps: Step[]) {
  let index = 0;
  let callId = 0;
  return new MockLanguageModelV4({
    doStream: async (options) => {
      let step = steps[Math.min(index++, steps.length - 1)]!;
      if (options.toolChoice?.type === "none") step = { text: step.text ?? "" };
      const chunks: unknown[] = [{ type: "stream-start", warnings: [] }];
      if (step.text) chunks.push({ type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: step.text }, { type: "text-end", id: "t" });
      for (const call of step.calls ?? []) {
        chunks.push({ type: "tool-input-start", id: `call-${callId}`, toolName: call.name }, { type: "tool-input-end", id: `call-${callId}` });
        chunks.push({ type: "tool-call", toolCallId: `call-${callId++}`, toolName: call.name, input: JSON.stringify(call.input) });
      }
      chunks.push({ type: "finish", usage, finishReason: { unified: step.calls?.length ? "tool-calls" : "stop", raw: undefined } });
      return { stream: simulateReadableStream({ chunks: chunks as never[] }) };
    },
  });
}

type Occ = { id: string; behavior_id: string; behavior_title: string; parent_behavior_id: string; parent_title: string; local_date: string; status: string; revision: string };

/** A Skin routine with three steps this morning; Facewash is already done. */
function routineAccount() {
  const steps: Record<string, Occ> = Object.fromEntries([
    ["s1", "Cerave", "unresolved"], ["s2", "Facewash", "completed"], ["s3", "Retinol", "unresolved"],
  ].map(([id, title, status]) => [id, {
    id: id!, behavior_id: `b-${id}`, behavior_title: title!, parent_behavior_id: SKIN, parent_title: "Skin routine",
    local_date: DAY, status: status!, revision: "r1",
  }]));
  const calls: Array<{ name: string; args: Record<string, unknown>; key: string | null }> = [];
  const group = () => ({
    parent_behavior_id: SKIN, title: "Skin routine", local_date: DAY, slot_key: SLOT, occurrence_ids: ["s1", "s2", "s3"],
  });
  const executor: ChatToolExecutor = async (name, args, { idempotencyKey }): Promise<ChatToolResult> => {
    calls.push({ name, args: { ...args }, key: idempotencyKey });
    switch (name) {
      case "get_timeline":
        return { ok: true, result: { days: [{ local_date: DAY, occurrences: Object.values(steps), parent_groups: [group()] }], needs_decision: null } };
      case "get_behavior": {
        const id = args.behavior_id as string;
        if (id === SKIN) return { ok: true, result: { behavior: { id: SKIN, title: "Skin routine", revision: "br1", parent_behavior_id: null } } };
        if (id === "b-walk") return { ok: true, result: { behavior: { id: "b-walk", title: "Walk", revision: "br2", parent_behavior_id: null } } };
        if (id === "b-s3") return { ok: true, result: { behavior: { id: "b-s3", title: "Retinol", revision: "br3", parent_behavior_id: SKIN } } };
        return { ok: false, error: { code: "not_found", message: "no" } };
      }
      case "get_occurrence": {
        const step = steps[args.occurrence_id as string];
        return step ? { ok: true, result: { occurrence: step } } : { ok: false, error: { code: "not_found", message: "no" } };
      }
      case "set_parent_occurrence_status": {
        const changed = Object.values(steps).filter((step) => step.status !== args.status).map((step) => step.id);
        for (const id of changed) steps[id] = { ...steps[id]!, status: args.status as string, revision: "r2" };
        return { ok: true, result: {
          parent_behavior_id: SKIN, status: args.status, occurrences: Object.values(steps), changed_occurrence_ids: changed,
          parent_groups: [group()], changed: changed.length > 0,
        } };
      }
      case "set_occurrence_status": {
        const step = steps[args.occurrence_id as string]!;
        if (args.expected_status && args.expected_status !== step.status) return { ok: false, error: { code: "conflict", message: "changed" } };
        const previous = step.status;
        steps[step.id] = { ...step, status: args.status as string, revision: "r3" };
        return { ok: true, result: { occurrence: steps[step.id], previous_status: previous, changed: previous !== args.status } };
      }
      case "create_behavior":
        return { ok: true, result: { behavior: { id: "b-new", title: args.title, parent_behavior_id: null },
          sub_behaviors: ((args.sub_behaviors as Array<{ title: string }>) ?? []).map((item, index) => ({ id: `b-new-${index}`, title: item.title })) } };
      case "update_behavior":
        return { ok: true, result: { behavior: { id: args.behavior_id, title: args.behavior_id === "b-walk" ? "Walk" : "Retinol" }, changed: true } };
      default: return { ok: true, result: {} };
    }
  };
  return { executor, calls, steps };
}

function turn(steps: Step[], account = routineAccount()) {
  let id = 0;
  const promise = runChatTurn({
    setting: agentModelSetting("chat"), model: scriptedModel(steps),
    instructions: buildChatSystemPrompt({ timezone: "America/New_York", today: DAY, localTime: "09:00", weekday: "Thursday", sourcesOff: [] }),
    tools: buildChatToolDefinitions(ALL_ON), history: [], userMessage: "hi", executor: account.executor, replyId: "reply-1",
    signal: AbortSignal.timeout(5_000), onEvent: () => undefined, newId: () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
  });
  return { promise, account };
}

describe("chat routines (chat-1.6)", () => {
  it("tells the model about routines and steps", () => {
    expect(CHAT_PROMPT_VERSION).toBe("chat-1.7");
    const prompt = buildChatSystemPrompt({ timezone: "UTC", today: DAY, localTime: "09:00", weekday: "Thursday", sourcesOff: [] });
    expect(prompt).toContain("set_parent_occurrence_status");
    expect(prompt).toContain("sub_behaviors");
    expect(isImmediateWrite("set_parent_occurrence_status")).toBe(true);
  });

  it("marks a whole routine at once, and Undo sets back only the steps it changed", async () => {
    const { promise, account } = turn([
      { calls: [{ name: "set_parent_occurrence_status", input: { parent_behavior_id: SKIN, status: "completed", local_date: DAY, slot_key: SLOT } }] },
      { text: "Done." },
    ]);
    const result = await promise;
    expect(result.pending).toBeNull();
    expect(result.writes).toHaveLength(1);
    const write = result.writes[0]!;
    expect(write.outcome).toMatchObject({
      kind: "status", text: "Marked Skin routine done: Cerave, Facewash and Retinol.", undo: "available", behaviorId: SKIN, localDate: DAY,
    });
    expect(Object.values(account.steps).map((step) => step.status)).toEqual(["completed", "completed", "completed"]);
    // Facewash was already done: its Undo leaves it done.
    expect(write.undo?.calls?.map((call) => call.args)).toEqual([
      { occurrence_id: "s1", status: "unresolved", expected_status: "completed" },
      { occurrence_id: "s3", status: "unresolved", expected_status: "completed" },
    ]);

    const undone = await runChatUndo({ outcome: write.outcome, plan: write.undo!, executor: account.executor, idempotencyKey: "chat:undo:1" });
    expect(undone).toEqual({ ok: true, text: "Undid: Marked Skin routine done: Cerave, Facewash and Retinol." });
    expect(Object.values(account.steps).map((step) => step.status)).toEqual(["unresolved", "completed", "unresolved"]);
    expect(account.calls.filter((call) => call.name === "set_occurrence_status").map((call) => call.key)).toEqual(["chat:undo:1:0", "chat:undo:1:1"]);
  });

  it("Undo of a routine mark changes nothing when one step changed since", async () => {
    const { promise, account } = turn([
      { calls: [{ name: "set_parent_occurrence_status", input: { parent_behavior_id: SKIN, status: "completed", local_date: DAY, slot_key: SLOT } }] },
      { text: "Done." },
    ]);
    const write = (await promise).writes[0]!;
    account.steps.s3 = { ...account.steps.s3!, status: "not_completed" };
    const undone = await runChatUndo({ outcome: write.outcome, plan: write.undo!, executor: account.executor, idempotencyKey: "chat:undo:2" });
    expect(undone).toEqual({ ok: false, reason: "changed" });
    expect(account.steps.s1!.status).toBe("completed");
    expect(account.calls.some((call) => call.name === "set_occurrence_status")).toBe(false);
  });

  it("names the routine when one step is marked", () => {
    const facts = { occurrence: routineAccount().steps.s3 };
    const call = { name: "set_occurrence_status" as const, args: { occurrence_id: "s3", status: "not_completed" } };
    expect(describePendingWrite(call, facts)).toBe("Mark Retinol in Skin routine not done");
    expect(describeOutcome(call, { occurrence: { ...facts.occurrence, status: "not_completed" } }, facts)).toBe("Marked Retinol in Skin routine not done.");
  });

  it("asks before creating a routine with its steps, and the line lists them", async () => {
    const { promise, account } = turn([
      { calls: [{ name: "create_behavior", input: { title: "Skin routine", schedules: [], sub_behaviors: [{ title: "Cerave" }, { title: "Facewash" }, { title: "Retinol" }] } }] },
      { text: "That's waiting for your Yes." },
    ]);
    const result = await promise;
    expect(result.writes).toHaveLength(0);
    expect(result.pending?.confirm.items).toEqual([{ text: "Create Skin routine with 3 steps: Cerave, Facewash, Retinol", kind: "create_behavior" }]);

    const run = await runChatConfirm({ confirmId: "c1", writes: result.pending!.writes, executor: account.executor, newId: () => "o-1" });
    expect(run.state).toBe("accepted");
    expect(run.writes[0]!.outcome.text).toBe("Created Skin routine with 3 steps: Cerave, Facewash, Retinol.");
    expect(run.writes[0]!.undo?.call).toEqual({ name: "archive_behavior", args: { behavior_id: "b-new" } });
  });

  it("describes grouping and ungrouping with the routine's name", () => {
    const parent = { id: SKIN, title: "Skin routine" };
    const into = { name: "update_behavior" as const, args: { behavior_id: "b-walk", parent_behavior_id: SKIN } };
    expect(describePendingWrite(into, { behavior: { title: "Walk" }, parent })).toBe("Move Walk into Skin routine");
    expect(describeOutcome(into, { behavior: { title: "Walk" } }, { parent })).toBe("Moved Walk into Skin routine.");
    const out = { name: "update_behavior" as const, args: { behavior_id: "b-s3", parent_behavior_id: null } };
    expect(describePendingWrite(out, { behavior: { title: "Retinol", parent_behavior_id: SKIN }, parent })).toBe("Take Retinol out of Skin routine, as its own Behavior");
    const own = { name: "update_behavior" as const, args: { behavior_id: "b-s3", inherit_parent_schedule: false, schedules: [] } };
    expect(describePendingWrite(own, { behavior: { title: "Retinol" }, parent })).toBe("Give Retinol its own schedule");
    const step = { name: "create_behavior" as const, args: { title: "Toner", parent_behavior_id: SKIN } };
    expect(describePendingWrite(step, { parent })).toBe("Add Toner to Skin routine");
  });

  it("reads the routine it groups into before asking, so the line names it", async () => {
    const { promise, account } = turn([
      { calls: [{ name: "update_behavior", input: { behavior_id: "b-walk", parent_behavior_id: SKIN } }] },
      { text: "That's waiting for your Yes." },
    ]);
    const result = await promise;
    expect(result.pending?.confirm.items).toEqual([{ text: "Move Walk into Skin routine", kind: "update_behavior" }]);
    expect(account.calls.filter((call) => call.name === "get_behavior").map((call) => call.args.behavior_id)).toEqual(["b-walk", SKIN]);
  });
});
