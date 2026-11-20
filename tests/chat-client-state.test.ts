import { describe, expect, it } from "vitest";
import type { ChatConfirm, ChatEvent } from "@cadence/core/types/chat";
import {
  EMPTY_CHAT_THREAD,
  addAlertAfterOutcome,
  addPendingUserMessage,
  alternativeMessage,
  applyChatEvent,
  applyConfirmResponse,
  conversationDateLabel,
  expireOpenConfirms,
  failTurn,
  ChatRequestError,
  createChatClient,
  readNdjson,
  replaceOutcome,
  chatRunState,
  dropUnsentTurn,
  normalizeChatPart,
  parseChatEvent,
  stopTurn,
  threadFromConversation,
  turnStarted,
  type ChatThreadState,
} from "@/lib/ui/chat";
import { CHAT_FIXTURE_CONFIRM, MEDS_OUTCOME, CHAT_FIXTURE_TODAY } from "@/app/design-system/chat-fixtures";

// Advisor plan Phase 5B: the Chat page folds 5A's stream into stored message shapes.

const ID = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-11-19T17:00:00.000Z");

function run(events: ChatEvent[], start: ChatThreadState = EMPTY_CHAT_THREAD) {
  let state = addPendingUserMessage(start, ID, "What is on today?", NOW);
  for (const event of events) state = applyChatEvent(state, event, ID, NOW);
  return state;
}

describe("chat stream folding", () => {
  it("builds the reply from start, text deltas, tool lines and done", () => {
    const state = run([
      { type: "start", conversationId: "c1", userMessageId: "u1", messageId: "a1", protocol: "1" },
      { type: "tool", tool: { id: "t1", subject: "timeline", text: "Looked at your Timeline", state: "done" } },
      { type: "text", delta: "You have " },
      { type: "text", delta: "3 items." },
      { type: "done", messageId: "a1" },
    ]);
    expect(state.conversationId).toBe("c1");
    expect(state.streamingId).toBeNull();
    expect(state.messages.map((message) => message.id)).toEqual(["u1", "a1"]);
    expect(state.messages[1]!.parts).toEqual([
      { type: "tool", tool: { id: "t1", subject: "timeline", text: "Looked at your Timeline", state: "done" } },
      { type: "text", text: "You have 3 items." },
    ]);
  });

  it("starts a new text part after a non-text part", () => {
    const state = run([
      { type: "start", conversationId: "c1", userMessageId: "u1", messageId: "a1", protocol: "1" },
      { type: "outcome", outcome: MEDS_OUTCOME },
      { type: "text", delta: "Walk is next." },
    ]);
    expect(state.messages[1]!.parts.map((part) => part.type)).toEqual(["outcome", "text"]);
    expect(state.streamingId).toBe("a1");
  });

  it("shows an alert that arrives before start under the person's message", () => {
    const state = run([
      { type: "alert", alert: { code: "chat_off", text: "Chat is off in Settings." } },
      { type: "done", messageId: "none" },
    ]);
    expect(state.messages).toHaveLength(2);
    expect(state.messages[1]!.parts).toEqual([{ type: "alert", alert: { code: "chat_off", text: "Chat is off in Settings." } }]);
    expect(state.streamingId).toBeNull();
  });

  it("keeps outcomes before a budget alert (T20)", () => {
    const state = run([
      { type: "start", conversationId: "c1", userMessageId: "u1", messageId: "a1", protocol: "1" },
      { type: "outcome", outcome: MEDS_OUTCOME },
      { type: "alert", alert: { code: "budget_reached", text: "Back on December 1.", retryAt: "2026-12-01T05:00:00Z" } },
    ]);
    expect(state.messages[1]!.parts.map((part) => part.type)).toEqual(["outcome", "alert"]);
  });

  it("ends a dropped turn with one alert", () => {
    const state = failTurn(run([]), ID, { code: "failed", text: "Could not reach Cadence." }, NOW);
    expect(state.streamingId).toBeNull();
    expect(state.messages.at(-1)!.parts).toEqual([{ type: "alert", alert: { code: "failed", text: "Could not reach Cadence." } }]);
  });
});

describe("answers to outcomes and confirms", () => {
  it("replaces an outcome after Undo and can add an alert under it", () => {
    const undone = replaceOutcome(CHAT_FIXTURE_TODAY, { ...MEDS_OUTCOME, text: "Undid: Marked Meds done.", undo: "done" });
    const outcome = undone.messages.flatMap((message) => message.parts).find((part) => part.type === "outcome");
    expect(outcome).toMatchObject({ outcome: { undo: "done", text: "Undid: Marked Meds done." } });
    const refused = addAlertAfterOutcome(undone, MEDS_OUTCOME.id, { code: "failed", text: "Meds changed since." });
    const parts = refused.messages[3]!.parts.map((part) => part.type);
    expect(parts).toEqual(["outcome", "alert", "text"]);
  });

  it("puts what ran after Yes right after the confirm", () => {
    const confirm = CHAT_FIXTURE_CONFIRM.messages[1]!.parts.find((part) => part.type === "confirm")!.confirm as ChatConfirm;
    const state = applyConfirmResponse(CHAT_FIXTURE_CONFIRM, {
      confirm: { ...confirm, state: "accepted" },
      outcomes: [{ id: "o1", kind: "move", text: "Moved Run to 6:00 PM.", confirmed: true, undo: "available" }],
      refusals: [],
    });
    expect(state.messages[1]!.parts.map((part) => part.type)).toEqual(["tool", "text", "confirm", "outcome"]);
  });

  it("expires open confirms when a newer message is sent (T13)", () => {
    const state = expireOpenConfirms(CHAT_FIXTURE_CONFIRM);
    const confirm = state.messages[1]!.parts.find((part) => part.type === "confirm");
    expect(confirm).toMatchObject({ confirm: { state: "expired" } });
  });
});

describe("wire helpers", () => {
  it("reads NDJSON across chunk boundaries and skips broken lines", async () => {
    const encoder = new TextEncoder();
    const chunks = ['{"type":"text","de', 'lta":"Hi"}\nnot json\n{"type":"done","messageId":"a1"}'];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
    const lines: unknown[] = [];
    await readNdjson(body, (line) => lines.push(line));
    expect(lines).toEqual([{ type: "text", delta: "Hi" }, { type: "done", messageId: "a1" }]);
  });

  it("labels conversation dates in the viewer's time zone", () => {
    const now = new Date("2026-11-19T17:00:00.000Z");
    expect(conversationDateLabel("2026-11-19T13:00:00.000Z", now, "America/New_York")).toBe("Today");
    expect(conversationDateLabel("2026-11-18T13:00:00.000Z", now, "America/New_York")).toBe("Yesterday");
    expect(conversationDateLabel("2026-11-12T13:00:00.000Z", now, "America/New_York")).toBe("Nov 12");
    expect(conversationDateLabel("2025-11-12T13:00:00.000Z", now, "America/New_York")).toBe("Nov 12, 2025");
  });

  it("sends a refusal's other time as a normal message", () => {
    expect(alternativeMessage("5:30 PM")).toBe("Move it to 5:30 PM");
  });

  it("turns a JSON refusal before the stream into a ChatRequestError with its alert", async () => {
    const client = createChatClient(async () =>
      new Response(JSON.stringify({ alert: { code: "chat_off", text: "Chat is off in Settings." } }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const events: unknown[] = [];
    await expect(
      client.sendTurn({ conversationId: null, message: "Hi", clientMessageId: ID }, (event) => events.push(event)),
    ).rejects.toMatchObject({ status: 403, alert: { code: "chat_off" } });
    expect(events).toEqual([]);
    expect(ChatRequestError).toBeDefined();
  });

  it("reads a 200 NDJSON stream", async () => {
    const client = createChatClient(async () =>
      new Response('{"type":"text","delta":"Hi"}\n{"type":"done","messageId":"a1"}\n', {
        status: 200,
        headers: { "Content-Type": "application/x-ndjson" },
      }),
    );
    const events: unknown[] = [];
    await client.sendTurn({ conversationId: null, message: "Hi", clientMessageId: ID }, (event) => events.push(event));
    expect(events).toHaveLength(2);
  });
});

describe("chat run states and recovery", () => {
  const started = (): ChatEvent => ({ type: "start", conversationId: "c1", userMessageId: "u1", messageId: "r1", protocol: "1" });

  it("reads idle, working, waiting, completed, stopped and failed", () => {
    expect(chatRunState(EMPTY_CHAT_THREAD)).toBe("idle");
    expect(chatRunState(run([started()]))).toBe("working");
    expect(chatRunState(CHAT_FIXTURE_CONFIRM)).toBe("waiting_for_user");
    expect(chatRunState(CHAT_FIXTURE_TODAY)).toBe("completed");
    expect(chatRunState(stopTurn(run([started(), { type: "text", delta: "Meds" }])))).toBe("stopped");
    expect(chatRunState(failTurn(run([started()]), ID, { code: "failed", text: "x" }, NOW))).toBe("failed");
  });

  it("Stop keeps what streamed and ends with one Stopped note", () => {
    const state = stopTurn(stopTurn(run([started(), { type: "text", delta: "Meds is at" }])));
    expect(state.streamingId).toBeNull();
    expect(state.messages.at(-1)?.parts).toEqual([
      { type: "text", text: "Meds is at" },
      { type: "notice", notice: { kind: "stopped", text: "Stopped." } },
    ]);
  });

  it("drops a turn the server never took, and tells started from not started", () => {
    const pending = run([]);
    expect(turnStarted(pending, ID)).toBe(false);
    expect(turnStarted(run([started()]), ID)).toBe(true);
    const dropped = dropUnsentTurn(pending, ID);
    expect(dropped.messages).toHaveLength(0);
    expect(dropped.streamingId).toBeNull();
  });

  it("drops malformed events and shows unknown parts with text as plain text", () => {
    expect(parseChatEvent({ type: "text" })).toBeNull();
    expect(parseChatEvent({ type: "outcome", outcome: { id: 1 } })).toBeNull();
    expect(parseChatEvent({ type: "outcome", outcome: { text: "Marked Meds done." } })).toEqual({ type: "text", delta: "Marked Meds done." });
    expect(parseChatEvent({ type: "chart", data: [1, 2] })).toBeNull();
    expect(parseChatEvent("nonsense")).toBeNull();
    expect(normalizeChatPart({ type: "chart", text: "Run is up 20% this week." })).toEqual({ type: "text", text: "Run is up 20% this week." });
    expect(normalizeChatPart({ type: "alert", alert: { code: "new_code", text: "Something broke." } })).toEqual({
      type: "alert",
      alert: { code: "failed", text: "Something broke." },
    });
    const view = threadFromConversation({
      conversation: { id: "c1", title: "t", createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() },
      messages: [{ id: "r1", role: "assistant", createdAt: NOW.toISOString(), parts: [{ type: "confirm" } as never, { type: "text", text: "Hi" }] }],
    });
    expect(view.messages[0]!.parts).toEqual([{ type: "text", text: "Hi" }]);
  });
});
