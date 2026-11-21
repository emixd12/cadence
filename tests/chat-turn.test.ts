import { describe, expect, it } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { simulateReadableStream } from "ai";
import type { ChatEvent, ChatMessage, ChatPart } from "@cadence/core/types/chat";
import { agentModelSetting } from "@/lib/services/agent-model";
import { modelPrice, usageMicrodollars } from "@/lib/services/agent-model-pricing";
import { buildChatSystemPrompt } from "@/lib/services/chat/chat-prompt";
import { buildChatToolDefinitions, trimToolResult } from "@/lib/services/chat/chat-tools";
import { buildHistoryMessages, messageText, runChatTurn, summarizeOlderMessages } from "@/lib/services/chat/chat-turn";
import { runChatConfirm, runChatUndo } from "@/lib/services/chat/chat-confirm";
import { recordSentPart } from "@/lib/services/chat/chat.service";
import { chatEnabled, chatSources } from "@/lib/services/chat/chat-settings";
import { aiSettingsFromStored } from "@/lib/services/ai-settings.service";
import type { ChatToolExecutor, ChatToolResult } from "@/lib/services/chat/chat-writes";

const ALL_ON = { notes: true, googleCalendar: true, outlookCalendar: true, icloudCalendar: true, hevy: true };
const usage = { inputTokens: { total: 1000, noCache: 1000, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 50, text: 50, reasoning: 0 } };

type Step = { text?: string; calls?: Array<{ name: string; input: Record<string, unknown> }> };

/** A model that answers each step from a script. */
function scriptedModel(steps: Step[]) {
  let index = 0;
  let callId = 0;
  return new MockLanguageModelV4({
    doStream: async (options) => {
      // Like a real provider, tool choice "none" means the next text-only step.
      let step = steps[Math.min(index++, steps.length - 1)]!;
      if (options.toolChoice?.type === "none") {
        while (step.calls?.length && index < steps.length) step = steps[index++]!;
        step = { text: step.text ?? "" };
      }
      const chunks: unknown[] = [{ type: "stream-start", warnings: [] }];
      if (step.text) chunks.push({ type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: step.text }, { type: "text-end", id: "t" });
      for (const call of step.calls ?? []) {
        chunks.push({ type: "tool-input-start", id: `call-${callId}`, toolName: call.name });
        chunks.push({ type: "tool-input-end", id: `call-${callId}` });
        chunks.push({ type: "tool-call", toolCallId: `call-${callId++}`, toolName: call.name, input: JSON.stringify(call.input) });
      }
      chunks.push({ type: "finish", usage, finishReason: { unified: step.calls?.length ? "tool-calls" : "stop", raw: undefined } });
      return { stream: simulateReadableStream({ chunks: chunks as never[] }) };
    },
  });
}

const OCC = (id: string, extra: Record<string, unknown> = {}) => ({
  id, behavior_id: `b-${id}`, behavior_title: id === "o1" ? "Meds" : "Walk", local_date: "2026-11-19", timezone: "America/New_York",
  scheduled_for: "2026-11-19T14:00:00Z", effective_start_at: "2026-11-19T14:00:00Z", status: "unresolved", note: "old note", revision: "r1", ...extra,
});

/** An in-memory account: two items today. Records every call and key. */
function fakeExecutor() {
  const state: Record<string, ReturnType<typeof OCC>> = { o1: OCC("o1"), o2: OCC("o2") };
  const calls: Array<{ name: string; args: Record<string, unknown>; key: string | null }> = [];
  const dayNote: { note: string | null; revision: string } = { note: "Busy day", revision: "d1" };
  let revision = 1;
  const executor: ChatToolExecutor = async (name, args, { idempotencyKey }): Promise<ChatToolResult> => {
    calls.push({ name, args: { ...args }, key: idempotencyKey });
    const id = args.occurrence_id as string;
    switch (name) {
      case "get_timeline": return { ok: true, result: { days: [{ occurrences: Object.values(state) }] } };
      case "get_occurrence": return state[id] ? { ok: true, result: { occurrence: state[id] } } : { ok: false, error: { code: "not_found", message: "no" } };
      case "list_calendar_events": return { ok: true, result: { events: [{ title: "Team dinner", start: "2026-11-19T23:00:00Z" }], sources: [{ source: "googleCalendar", state: "read" }] } };
      case "set_occurrence_status": {
        const previous = state[id]!.status;
        if (args.expected_status && args.expected_status !== previous) return { ok: false, error: { code: "conflict", message: "changed" } };
        state[id] = { ...state[id]!, status: args.status as string, revision: `r${++revision}` };
        return { ok: true, result: { occurrence: state[id], previous_status: previous, changed: previous !== args.status } };
      }
      case "update_occurrence_note": {
        if (args.expected_revision && args.expected_revision !== state[id]!.revision) return { ok: false, error: { code: "conflict", message: "changed" } };
        state[id] = { ...state[id]!, note: args.note as string, revision: `r${++revision}` };
        return { ok: true, result: { occurrence: state[id], changed: true } };
      }
      case "move_occurrence_for_day": {
        if (args.expected_revision && args.expected_revision !== state[id]!.revision) return { ok: false, error: { code: "conflict", message: "changed" } };
        if (args.start_time === "19:00") {
          return { ok: true, result: { outcome: "refused", occurrence: state[id], move: null, refusal: { reason: "calendar_busy", message: "Your 7 pm has Team dinner on your calendar.",
            alternatives: [{ start_at: "2026-11-20T01:30:00Z", start_time: "20:30" }] } } };
        }
        state[id] = { ...state[id]!, effective_start_at: "2026-11-19T23:00:00Z", revision: `r${++revision}` };
        return { ok: true, result: { outcome: "moved", occurrence: state[id], move: { id: "m1" }, refusal: null } };
      }
      case "revert_occurrence_move":
        if (args.expected_revision && args.expected_revision !== state[id]!.revision) return { ok: false, error: { code: "conflict", message: "changed" } };
        state[id] = { ...state[id]!, effective_start_at: state[id]!.scheduled_for, revision: `r${++revision}` };
        return { ok: true, result: { outcome: "undone", occurrence: state[id], move: { id: "m2" }, refusal: null } };
      case "get_behavior": return { ok: true, result: { behavior: { id: args.behavior_id, title: "Stretch", revision: "b1" } } };
      case "add_opportunity_occurrence": {
        if (args.start_time === "19:00") {
          return { ok: true, result: { outcome: "refused", occurrence: null, refusal: { reason: "calendar_busy", message: "Your calendar is busy at that time.",
            alternatives: [{ start_at: "2026-11-20T01:30:00Z", start_time: "20:30" }] } } };
        }
        const done = args.mark_completed === true;
        state.o3 = { ...OCC("o3"), behavior_id: args.behavior_id as string, behavior_title: "Stretch", effective_start_at: "2026-11-19T20:00:00Z",
          status: done ? "completed" : "unresolved", note: null as unknown as string, revision: `r${++revision}` };
        return { ok: true, result: { outcome: done ? "logged" : "added", occurrence: state.o3, refusal: null } };
      }
      case "remove_opportunity_occurrence": {
        const item = state[id];
        if (!item) return { ok: false, error: { code: "not_found", message: "no" } };
        if (args.expected_revision && args.expected_revision !== item.revision) {
          return { ok: true, result: { outcome: "refused", occurrence: item, refusal: { reason: "revision_changed", message: "Stretch changed since it was read." } } };
        }
        delete state[id];
        return { ok: true, result: { outcome: "removed", occurrence: item, refusal: null } };
      }
      case "list_day_notes": return { ok: true, result: { day_notes: dayNote.note === null ? [] : [{ local_date: "2026-11-19", ...dayNote }] } };
      case "update_day_note":
        if (args.expected_revision && args.expected_revision !== dayNote.revision) return { ok: false, error: { code: "conflict", message: "changed" } };
        dayNote.note = args.note as string; dayNote.revision = `d${++revision}`;
        return { ok: true, result: { day_note: { local_date: "2026-11-19", ...dayNote }, changed: true } };
      default: return { ok: true, result: {} };
    }
  };
  return { executor, calls, state, dayNote };
}

function turn(steps: Step[], fake = fakeExecutor(), extra: Partial<Parameters<typeof runChatTurn>[0]> = {}) {
  const events: ChatEvent[] = [];
  let id = 0;
  const promise = runChatTurn({
    setting: agentModelSetting("chat"), model: scriptedModel(steps),
    instructions: buildChatSystemPrompt({ timezone: "America/New_York", today: "2026-11-19", localTime: "09:00", weekday: "Thursday", sourcesOff: [] }),
    tools: buildChatToolDefinitions(ALL_ON), history: [], userMessage: "hi", executor: fake.executor, replyId: "reply-1",
    signal: AbortSignal.timeout(5_000), onEvent: (event) => events.push(event), newId: () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
    ...extra,
  });
  return { promise, events, fake };
}

describe("chat turn (5A)", () => {
  it("answers a read with a muted tool line and streamed text", async () => {
    const { promise, events } = turn([{ calls: [{ name: "get_timeline", input: {} }] }, { text: "You have Meds and Walk today." }]);
    const result = await promise;
    expect(events.map((event) => event.type)).toEqual(["tool", "text"]);
    expect(result.parts).toEqual([
      { type: "tool", tool: expect.objectContaining({ subject: "timeline", text: "Looked at your Timeline", state: "done" }) },
      { type: "text", text: "You have Meds and Walk today." },
    ]);
    expect(result.writes).toHaveLength(0);
    expect(result.pending).toBeNull();
  });

  it("shows the lookup line when the model starts the call, before the read finishes", async () => {
    const order: string[] = [];
    const fake = fakeExecutor();
    const executor: ChatToolExecutor = async (...args) => { order.push(`run:${args[0]}`); return fake.executor(...args); };
    const { promise } = turn([{ calls: [{ name: "get_timeline", input: {} }] }, { text: "ok" }], { ...fake, executor },
      { onEvent: (event) => { if (event.type === "tool") order.push("line"); } });
    await promise;
    expect(order).toEqual(["line", "run:get_timeline"]);
  });

  it("runs the first single-record write at once with an Undo", async () => {
    const { promise, fake } = turn([{ calls: [{ name: "set_occurrence_status", input: { occurrence_id: "o1", status: "completed" } }] }, { text: "Done." }]);
    const result = await promise;
    expect(result.writes).toHaveLength(1);
    expect(result.writes[0]!.outcome).toMatchObject({ kind: "status", text: "Marked Meds done.", undo: "available", confirmed: false, occurrenceId: "o1" });
    expect(fake.state.o1!.status).toBe("completed");
    // T14: the write carries a key from the reply id and its position.
    expect(fake.calls.find((call) => call.name === "set_occurrence_status")!.key).toMatch(/^chat:reply-1:\d+$/);
  });

  it("pauses a second write in the same question, even when both arrive in one step (T12)", async () => {
    const { promise, fake } = turn([{ calls: [
      { name: "set_occurrence_status", input: { occurrence_id: "o1", status: "completed" } },
      { name: "set_occurrence_status", input: { occurrence_id: "o2", status: "completed" } },
    ] }, { text: "Meds is marked; Walk is waiting for your Yes." }]);
    const result = await promise;
    expect(result.writes.map((write) => write.outcome.text)).toEqual(["Marked Meds done."]);
    expect(fake.state.o2!.status).toBe("unresolved");
    expect(result.pending?.confirm).toMatchObject({ question: "Make this change?", state: "pending", items: [{ text: "Mark Walk done", kind: "status" }] });
    expect(result.pending?.writes[0]!.guard).toEqual({ kind: "occurrence", id: "o2", revision: "r1" });
  });

  it("always asks before a Behavior change", async () => {
    const { promise, fake } = turn([{ calls: [{ name: "create_behavior", input: { title: "Stretch", schedules: [] } }] }, { text: "Waiting for your Yes." }]);
    const result = await promise;
    expect(result.writes).toHaveLength(0);
    expect(result.pending?.confirm.items).toEqual([{ text: "Create a new Behavior, Stretch", kind: "create_behavior" }]);
    expect(fake.calls.some((call) => call.name === "create_behavior")).toBe(false);
  });

  it("shows a calendar refusal with other times and runs no second write", async () => {
    const { promise, events, fake } = turn([
      { calls: [{ name: "move_occurrence_for_day", input: { occurrence_id: "o2", start_time: "19:00" } }] },
      { calls: [{ name: "move_occurrence_for_day", input: { occurrence_id: "o2", start_time: "20:30" } }] },
      { text: "7 pm clashes with Team dinner. 8:30 pm is free." },
    ]);
    const result = await promise;
    const refusal = events.find((event) => event.type === "refusal");
    expect(refusal).toMatchObject({ refusal: { reason: "calendar_busy", alternatives: [{ startTime: "20:30" }] } });
    // The model tried the other time on its own: it waits for a Yes instead.
    expect(fake.calls.filter((call) => call.name === "move_occurrence_for_day")).toHaveLength(1);
    expect(result.pending?.confirm.items[0]!.text).toBe("Move Walk to 8:30 pm today");
  });

  it("shows the medical disclaimer once and lets the model still help with timing", async () => {
    const { promise } = turn([
      { text: "Cadence does not advise on dosing.", calls: [{ name: "medical_notice", input: {} }] },
      { calls: [{ name: "get_timeline", input: {} }, { name: "medical_notice", input: {} }] },
      { text: "Your Magnesium is at 9 pm tonight." },
    ]);
    const result = await promise;
    expect(result.modelCalls).toBe(3);
    expect(result.parts.filter((part) => part.type === "text").map((part) => part.type === "text" && part.text))
      .toEqual(["Cadence does not advise on dosing.", "Your Magnesium is at 9 pm tonight."]);
    expect(result.parts.filter((part) => part.type === "notice")).toEqual([{ type: "notice", notice: { kind: "medical", text: "Cadence does not advise on medical matters." } }]);
    expect(result.toolCalls).toEqual(["get_timeline"]);
  });

  it("lets the model answer when it calls the medical notice before writing anything", async () => {
    const { promise } = turn([{ calls: [{ name: "medical_notice", input: {} }] }, { text: "Cadence does not advise on medical matters; a pharmacist can help." }]);
    const result = await promise;
    expect(result.modelCalls).toBe(2);
    expect(result.parts.map((part) => part.type)).toEqual(["notice", "text"]);
  });

  it("stops at 8 tool calls and answers", async () => {
    const reads = Array.from({ length: 12 }, () => ({ calls: [{ name: "get_timeline", input: {} }] } as Step));
    const { promise, fake } = turn([...reads, { text: "Here is what I found." }]);
    const result = await promise;
    expect(fake.calls.filter((call) => call.name === "get_timeline")).toHaveLength(8);
    expect(result.parts.at(-1)).toEqual({ type: "text", text: "Here is what I found." });
  });

  it("shows outcomes first, then the budget line, when the budget runs out mid-question (T20)", async () => {
    let reservations = 0;
    const { promise, events } = turn(
      [{ calls: [{ name: "set_occurrence_status", input: { occurrence_id: "o1", status: "completed" } }] }, { text: "Done." }],
      fakeExecutor(),
      { spend: async () => (++reservations === 1 ? { ok: true, settle: async () => undefined } : { ok: false, retryAt: "2026-12-01T00:00:00Z" }) },
    );
    const result = await promise;
    expect(events.map((event) => event.type)).toEqual(["outcome", "alert"]);
    expect(result.stop).toBe("budget_reached");
    expect(result.parts.at(-1)).toMatchObject({ type: "alert", alert: { code: "budget_reached", retryAt: "2026-12-01T00:00:00Z" } });
  });

  it("stops at the question's spending ceiling", async () => {
    const reads = Array.from({ length: 6 }, () => ({ calls: [{ name: "get_timeline", input: {} }] } as Step));
    const { promise } = turn([...reads, { text: "ok" }], fakeExecutor(), {
      setting: agentModelSetting("chat"), limits: { questionCeilingMicrodollars: 1 },
      spend: async () => ({ ok: true, settle: async () => undefined }),
    });
    const result = await promise;
    expect(result.stop).toBe("ceiling");
    expect(result.modelCalls).toBe(1);
  });

  it("judges the ceiling on measured spend, not the reservation estimate", async () => {
    const setting = agentModelSetting("chat");
    const perCall = usageMicrodollars(modelPrice(setting.model)!, { inputTokens: 1000, cachedInputTokens: 0, outputTokens: 50 })!;
    const { promise } = turn([{ calls: [{ name: "get_timeline", input: {} }] }, { calls: [{ name: "get_timeline", input: {} }] }, { text: "ok" }], fakeExecutor(), {
      setting, limits: { questionCeilingMicrodollars: perCall * 4 },
      spend: async () => ({ ok: true, settle: async () => undefined }),
    });
    const result = await promise;
    expect(result.stop).toBe("answered");
    expect(result.modelCalls).toBe(3);
  });

  it("stops at the next safe point when the person presses Stop", async () => {
    const stop = new AbortController();
    const fake = fakeExecutor();
    const executor: ChatToolExecutor = async (name, args, options) => {
      const result = await fake.executor(name, args, options);
      if (name === "set_occurrence_status") stop.abort();
      return result;
    };
    const { promise } = turn([
      { calls: [{ name: "set_occurrence_status", input: { occurrence_id: "o1", status: "completed" } },
        { name: "update_occurrence_note", input: { occurrence_id: "o2", note: "later" } }] },
      { calls: [{ name: "set_occurrence_status", input: { occurrence_id: "o2", status: "completed" } }] },
      { text: "Done." },
    ], { ...fake, executor }, { stop: stop.signal });
    const result = await promise;
    expect(result.stop).toBe("stopped");
    expect(result.modelCalls).toBe(1);
    // The write that ran stays with its Undo; the waiting one is dropped, not offered.
    expect(result.writes).toHaveLength(1);
    expect(result.pending).toBeNull();
    expect(result.parts.map((part) => part.type)).toEqual(["outcome", "notice"]);
    expect(result.parts.at(-1)).toEqual({ type: "notice", notice: { kind: "stopped", text: "Stopped." } });
    expect(fake.calls.filter((call) => call.name === "update_occurrence_note")).toHaveLength(0);
  });

  it("never lets the model choose an idempotency key", async () => {
    const { promise, fake } = turn([{ calls: [{ name: "set_occurrence_status", input: { occurrence_id: "o1", status: "completed", idempotency_key: "model-chosen-key" } }] }, { text: "ok" }]);
    await promise;
    const write = fake.calls.find((call) => call.name === "set_occurrence_status")!;
    expect(write.args.idempotency_key).toBeUndefined();
    expect(write.key).not.toBe("model-chosen-key");
  });
});

describe("chat confirm and Undo (5A)", () => {
  it("runs every pending write after Yes, with keys from the confirm", async () => {
    const fake = fakeExecutor();
    const pending = [
      { call: { name: "set_occurrence_status" as const, args: { occurrence_id: "o1", status: "completed" } }, item: { text: "Mark Meds done", kind: "status" as const }, guard: { kind: "occurrence" as const, id: "o1", revision: "r1" } },
      { call: { name: "set_occurrence_status" as const, args: { occurrence_id: "o2", status: "completed" } }, item: { text: "Mark Walk done", kind: "status" as const }, guard: { kind: "occurrence" as const, id: "o2", revision: "r1" } },
    ];
    const run = await runChatConfirm({ confirmId: "c1", writes: pending, executor: fake.executor });
    expect(run.state).toBe("accepted");
    expect(run.writes.map((write) => write.outcome.text)).toEqual(["Marked Meds done.", "Marked Walk done."]);
    expect(run.writes.every((write) => write.outcome.confirmed)).toBe(true);
    expect(fake.calls.filter((call) => call.name === "set_occurrence_status").map((call) => call.key)).toEqual(["chat:c1:0", "chat:c1:1"]);
  });

  it("does nothing on Yes when a listed record changed (T13)", async () => {
    const fake = fakeExecutor();
    fake.state.o2 = { ...fake.state.o2!, revision: "r9" };
    const run = await runChatConfirm({ confirmId: "c1", executor: fake.executor, writes: [
      { call: { name: "set_occurrence_status", args: { occurrence_id: "o2", status: "completed" } }, item: { text: "Mark Walk done", kind: "status" }, guard: { kind: "occurrence", id: "o2", revision: "r1" } },
    ] });
    expect(run.state).toBe("expired");
    expect(fake.calls.some((call) => call.name === "set_occurrence_status")).toBe(false);
  });

  it("adds an opportunity at once, and Undo takes it back off today", async () => {
    const { promise, fake } = turn([{ calls: [{ name: "add_opportunity_occurrence", input: { behavior_id: "b-stretch", start_time: "15:00" } }] }, { text: "Added." }]);
    const result = await promise;
    const write = result.writes[0]!;
    expect(write.outcome).toMatchObject({ kind: "opportunity", text: "Added Stretch to today at 3 pm.", undo: "available" });
    expect(write.undo?.call).toEqual({ name: "remove_opportunity_occurrence", args: { occurrence_id: "o3", expected_revision: fake.state.o3!.revision } });
    expect(await runChatUndo({ outcome: write.outcome, plan: write.undo!, executor: fake.executor, idempotencyKey: "chat:undo:o1" })).toMatchObject({ ok: true });
    expect(fake.state.o3).toBeUndefined();
  });

  it("offers no Undo for Done now, and shows a taken time as a refusal with other times", async () => {
    const logged = await turn([{ calls: [{ name: "add_opportunity_occurrence", input: { behavior_id: "b-stretch", mark_completed: true } }] }, { text: "ok" }]).promise;
    expect(logged.writes[0]!.outcome).toMatchObject({ kind: "opportunity", undo: "unavailable" });
    expect(logged.writes[0]!.undo).toBeNull();
    const busy = turn([{ calls: [{ name: "add_opportunity_occurrence", input: { behavior_id: "b-stretch", start_time: "19:00" } }] }, { text: "ok" }]);
    const refused = await busy.promise;
    expect(refused.writes).toHaveLength(0);
    expect(busy.events.find((event) => event.type === "refusal")).toMatchObject({
      refusal: { kind: "opportunity", reason: "calendar_busy", alternatives: [{ startTime: "20:30" }] },
    });
  });

  it("waits for a Yes before a second opportunity in the same question", async () => {
    const result = await turn([{ calls: [
      { name: "add_opportunity_occurrence", input: { behavior_id: "b-stretch", start_time: "15:00" } },
      { name: "add_opportunity_occurrence", input: { behavior_id: "b-read", preset: "evening" } },
    ] }, { text: "ok" }]).promise;
    expect(result.writes).toHaveLength(1);
    expect(result.pending?.writes.map((write) => write.item)).toEqual([{ text: "Add Stretch to today this evening", kind: "opportunity" }]);
  });

  it("Undo after a note edit restores the old text (T11)", async () => {
    const { promise, fake } = turn([{ calls: [{ name: "update_occurrence_note", input: { occurrence_id: "o1", note: "new note" } }] }, { text: "Saved." }]);
    const result = await promise;
    expect(fake.state.o1!.note).toBe("new note");
    const write = result.writes[0]!;
    const undo = await runChatUndo({ outcome: write.outcome, plan: write.undo!, executor: fake.executor, idempotencyKey: "chat:undo:x1" });
    expect(undo).toEqual({ ok: true, text: "Undid: Saved a note on Meds." });
    expect(fake.state.o1!.note).toBe("old note");
  });

  it("Undo refuses when the person changed the item since", async () => {
    const { promise, fake } = turn([{ calls: [{ name: "set_occurrence_status", input: { occurrence_id: "o1", status: "completed" } }] }, { text: "ok" }]);
    const result = await promise;
    fake.state.o1 = { ...fake.state.o1!, status: "not_completed" };
    const undo = await runChatUndo({ outcome: result.writes[0]!.outcome, plan: result.writes[0]!.undo!, executor: fake.executor, idempotencyKey: "chat:undo:x2" });
    expect(undo).toEqual({ ok: false, reason: "changed" });
  });

  it("Undo of a move reverts it", async () => {
    const { promise, fake } = turn([{ calls: [{ name: "move_occurrence_for_day", input: { occurrence_id: "o2", start_time: "18:00" } }] }, { text: "ok" }]);
    const result = await promise;
    const undo = await runChatUndo({ outcome: result.writes[0]!.outcome, plan: result.writes[0]!.undo!, executor: fake.executor, idempotencyKey: "chat:undo:x3" });
    expect(undo.ok).toBe(true);
    expect(fake.calls.at(-1)).toMatchObject({ name: "revert_occurrence_move", args: { occurrence_id: "o2", expected_revision: expect.any(String) } });
  });

  it("Undo of a move refuses after the person moved the item again", async () => {
    const { promise, fake } = turn([{ calls: [{ name: "move_occurrence_for_day", input: { occurrence_id: "o2", start_time: "18:00" } }] }, { text: "ok" }]);
    const result = await promise;
    // The person moves Walk again from the Timeline.
    fake.state.o2 = { ...fake.state.o2!, effective_start_at: "2026-11-20T00:00:00Z", revision: "r-timeline" };
    const undo = await runChatUndo({ outcome: result.writes[0]!.outcome, plan: result.writes[0]!.undo!, executor: fake.executor, idempotencyKey: "chat:undo:x4" });
    expect(undo).toEqual({ ok: false, reason: "changed" });
    expect(fake.state.o2!.effective_start_at).toBe("2026-11-20T00:00:00Z");
  });

  it("does nothing on Yes when the day note changed while waiting", async () => {
    const fake = fakeExecutor();
    const run = () => runChatConfirm({ confirmId: "c2", executor: fake.executor, writes: [
      { call: { name: "update_day_note", args: { local_date: "2026-11-19", note: "Chat's text" } }, item: { text: "Save a day note", kind: "day_note" }, guard: { kind: "day_note", id: "2026-11-19", revision: "d1" } },
    ] });
    fake.dayNote.note = "Person's newer text"; fake.dayNote.revision = "d7";
    expect((await run()).state).toBe("expired");
    expect(fake.dayNote.note).toBe("Person's newer text");
  });

  it("a resumed Yes finishes without re-checking guards its own writes changed", async () => {
    const fake = fakeExecutor();
    fake.state.o1 = { ...fake.state.o1!, status: "completed", revision: "r5" }; // the first Yes already ran this write
    const run = await runChatConfirm({ confirmId: "c3", executor: fake.executor, resumed: true, writes: [
      { call: { name: "set_occurrence_status", args: { occurrence_id: "o1", status: "completed" } }, item: { text: "Mark Meds done", kind: "status" }, guard: { kind: "occurrence", id: "o1", revision: "r1" } },
    ] });
    expect(run.state).toBe("accepted");
  });
});

describe("chat writes survive a failed turn (5A)", () => {
  it("stores each write before the turn goes on", async () => {
    const stored: string[] = [];
    const { promise } = turn([{ calls: [{ name: "set_occurrence_status", input: { occurrence_id: "o1", status: "completed" } }] }, { text: "Done." }],
      fakeExecutor(), { onWrite: async (write) => { stored.push(write.outcome.text); } });
    await promise;
    expect(stored).toEqual(["Marked Meds done."]);
  });

  it("keeps streamed parts in order, joining text deltas", () => {
    const parts: ChatPart[] = [];
    const outcome = { id: "o", kind: "status" as const, text: "Marked Meds done.", confirmed: false, undo: "available" as const };
    for (const event of [{ type: "text", delta: "Marking " }, { type: "text", delta: "it." }, { type: "outcome", outcome },
      { type: "confirm", confirm: {} }, { type: "text", delta: "Then" }] as ChatEvent[]) recordSentPart(parts, event);
    expect(parts).toEqual([{ type: "text", text: "Marking it." }, { type: "outcome", outcome }, { type: "text", text: "Then" }]);
  });
});

describe("chat history and tools (5A)", () => {
  const message = (role: "user" | "assistant", text: string, index: number): ChatMessage => ({ id: `m${index}`, role, createdAt: "2026-11-19T00:00:00Z", parts: [{ type: "text", text }] });

  it("resends at most the history cap plus a code-written summary (T21)", () => {
    const history = Array.from({ length: 40 }, (_, index) => message(index % 2 ? "assistant" : "user", `message ${index}`, index));
    const messages = buildHistoryMessages({ history, summary: summarizeOlderMessages(history, 20), userMessage: "now?" }, 20);
    expect(messages).toHaveLength(21);
    expect(String(messages.at(-1)!.content)).toContain("Summary of earlier messages");
    expect(String(messages.at(-1)!.content)).toContain("Person: message 0");
  });

  it("tells the model after any history that earlier replies are not a source", () => {
    const first = buildHistoryMessages({ history: [], userMessage: "hi" }, 20);
    expect(first.at(-1)!.content).toBe("hi");
    const later = buildHistoryMessages({ history: [message("user", "hi", 0), message("assistant", "Hello.", 1)], userMessage: "and Walk?" }, 20);
    expect(String(later.at(-1)!.content)).toMatch(/^and Walk\?\n\n\(Cadence note: earlier replies are not a source\./);
  });

  it("leaves read lines out of resent history but keeps outcomes", () => {
    const text = messageText({ id: "a", role: "assistant", createdAt: "", parts: [
      { type: "tool", tool: { id: "t", subject: "calendar", text: "Looked at your calendar", state: "done" } },
      { type: "text", text: "You have Team dinner at 7." },
      { type: "outcome", outcome: { id: "o", kind: "status", text: "Marked Meds done.", confirmed: false, undo: "done" } },
    ] });
    expect(text).toBe("You have Team dinner at 7.\n[Cadence: Marked Meds done. Then undone.]");
  });

  it("cuts tool results to 12 KB, shortening lists first", () => {
    const big = { items: Array.from({ length: 500 }, (_, index) => ({ index, title: "x".repeat(80) })) };
    const trimmed = trimToolResult(big);
    expect(Buffer.byteLength(trimmed)).toBeLessThanOrEqual(12 * 1024);
    expect(JSON.parse(trimmed).items.at(-1)).toHaveProperty("omitted");
  });

  it("hides note tools when Notes is off and calendar tools when every calendar is off", () => {
    const names = buildChatToolDefinitions({ notes: false, googleCalendar: false, outlookCalendar: false, icloudCalendar: false, hevy: true }).map((tool) => tool.name);
    expect(names).not.toContain("list_day_notes");
    expect(names).not.toContain("update_occurrence_note");
    expect(names).not.toContain("list_calendar_events");
    expect(names).toContain("list_workouts");
    expect(names).toContain("search_advice");
  });

  it("gives the model no top-level anyOf and no idempotency key", () => {
    for (const tool of buildChatToolDefinitions(ALL_ON)) {
      expect(tool.inputSchema).not.toHaveProperty("anyOf");
      expect(tool.inputSchema).not.toHaveProperty("oneOf");
      expect(Object.keys((tool.inputSchema.properties ?? {}) as object)).not.toContain("idempotency_key");
    }
  });
});

describe("chat follows the AI features setting (4F)", () => {
  const none = { googleCalendar: false, outlookCalendar: false, icloudCalendar: false, hevy: false };
  const allOn = { approvedAt: "2026-11-20T09:00:00Z", revision: 1, dailyBriefEnabled: true, tipsEnabled: true, chatEnabled: true,
    includeNotes: true, includeReminderHistory: true, useConnectedSources: true, excludedSources: none };

  it("is off before the approval and when chat is turned off", () => {
    expect(chatEnabled(aiSettingsFromStored({ ...allOn, approvedAt: null }))).toBe(false);
    expect(chatEnabled(aiSettingsFromStored({ ...allOn, chatEnabled: false }))).toBe(false);
    expect(chatEnabled(aiSettingsFromStored(allOn))).toBe(true);
  });

  it("reads only the sources left on", () => {
    expect(chatSources(aiSettingsFromStored({ ...allOn, includeNotes: false, excludedSources: { ...none, hevy: true } })))
      .toEqual({ notes: false, googleCalendar: true, outlookCalendar: true, icloudCalendar: true, hevy: false });
    expect(Object.values(chatSources(aiSettingsFromStored({ ...allOn, chatEnabled: false })))).toEqual([false, false, false, false, false]);
  });
});
