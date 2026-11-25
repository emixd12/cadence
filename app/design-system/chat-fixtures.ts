import type {
  ChatConfirm,
  ChatConversationSummary,
  ChatEvent,
  ChatMessage,
  ChatOutcome,
  ChatPart,
} from "@cadence/core/types/chat";
import { CHAT_MEDICAL_NOTICE, CHAT_STOPPED_NOTICE } from "@cadence/core/types/chat";
import { pickChatStarters, type ChatStarterFacts } from "@cadence/core/resolvers/chat-starters.resolver";
import { CHAT_STARTER_PROMPTS, type ChatClient, type ChatThreadState } from "@/lib/ui/chat";

// Advisor plan Phase 5B bench: synthetic conversations in 5A's stored shapes.
// No account, no model call. The fixture client answers in memory.

export const CHAT_BENCH_STATES = ["opening", "today", "thinking", "confirm", "refusal", "medical", "budget", "stopped", "unsent", "past"] as const;
export type ChatBenchState = (typeof CHAT_BENCH_STATES)[number];

export function parseChatBenchState(value: string | null): ChatBenchState {
  return (CHAT_BENCH_STATES as readonly string[]).includes(value ?? "") ? (value as ChatBenchState) : "today";
}

export const CHAT_FIXTURE_NOW = new Date("2026-11-19T17:20:00.000Z");
const AT = (minutes: number) => new Date(CHAT_FIXTURE_NOW.getTime() - minutes * 60_000).toISOString();

const user = (id: string, text: string, minutes: number): ChatMessage => ({
  id,
  role: "user",
  createdAt: AT(minutes),
  parts: [{ type: "text", text }],
});
const reply = (id: string, parts: readonly ChatPart[], minutes: number): ChatMessage => ({
  id,
  role: "assistant",
  createdAt: AT(minutes),
  parts,
});

const tool = (id: string, subject: "timeline" | "calendar" | "behaviors" | "adherence" | "occurrences", text: string) =>
  ({ type: "tool", tool: { id, subject, text, state: "done" } }) as const;

export const MEDS_OUTCOME: ChatOutcome = {
  id: "outcome-meds",
  kind: "status",
  text: "Marked Meds done.",
  confirmed: false,
  undo: "available",
  occurrenceId: "occ-meds",
};

const BEHAVIOR_CONFIRM: ChatConfirm = {
  id: "confirm-run",
  question: "Make these 2 changes?",
  items: [
    { text: "Change Run to Monday, Wednesday and Friday", kind: "update_behavior" },
    { text: "Move today’s Run to 6:00 PM", kind: "move" },
  ],
  expiresAt: new Date(CHAT_FIXTURE_NOW.getTime() + 15 * 60_000).toISOString(),
  state: "pending",
};

/** A reply under way after two actions: the thinking horse beside the newest action. */
export const CHAT_FIXTURE_THINKING: ChatThreadState = {
  conversationId: "conv-thinking",
  streamingId: "bench-thinking",
  messages: [
    user("m1", "How did my week go?", 12),
    reply("bench-thinking", [tool("tt1", "timeline", "Looked at your Timeline"), tool("tt2", "adherence", "Looked at this week")], 12),
  ],
};

/** "What is on today?" with tool lines, a calendar answer, then a single write with Undo. */
export const CHAT_FIXTURE_TODAY: ChatThreadState = {
  conversationId: "conv-today",
  streamingId: null,
  messages: [
    user("m1", "What is on today?", 12),
    reply(
      "m2",
      [
        tool("t1", "timeline", "Looked at your Timeline"),
        tool("t2", "calendar", "Looked at your calendar"),
        {
          type: "text",
          text:
            "You have 6 items left today. Meds and Walk are this morning. Your calendar has Design review from 10:00 to 11:30 AM and Team dinner at 7:00 PM, so Run at 6:00 PM still fits before dinner. Piano practice at 8:30 PM is the last one.",
        },
      ],
      12,
    ),
    user("m3", "Mark meds done", 10),
    reply("m4", [{ type: "outcome", outcome: MEDS_OUTCOME }, { type: "text", text: "Done. Walk is next at 9:00 AM." }], 10),
  ],
};

/** A Behavior change waits for one Yes · No listing every write. */
export const CHAT_FIXTURE_CONFIRM: ChatThreadState = {
  conversationId: "conv-confirm",
  streamingId: null,
  messages: [
    user("c1", "Make my run Monday, Wednesday and Friday, and move today’s to 6", 4),
    reply(
      "c2",
      [
        tool("t3", "behaviors", "Looked at your Behaviors"),
        { type: "text", text: "Run is on Tuesday and Thursday now. Here is what I would change." },
        { type: "confirm", confirm: BEHAVIOR_CONFIRM },
      ],
      4,
    ),
  ],
};

/** A move onto a calendar event is refused with other times; an Undo has already run. */
export const CHAT_FIXTURE_REFUSAL: ChatThreadState = {
  conversationId: "conv-refusal",
  streamingId: null,
  messages: [
    user("r1", "Move my run to 7 tonight", 3),
    reply(
      "r2",
      [
        tool("t4", "calendar", "Looked at your calendar"),
        {
          type: "refusal",
          refusal: {
            id: "refusal-run",
            kind: "move",
            text: "Your 7:00 PM has Team dinner on your calendar.",
            reason: "calendar_busy",
            occurrenceId: "occ-run",
            alternatives: [
              { startAt: "2026-11-19T22:30:00.000Z", startTime: "5:30 PM" },
              { startAt: "2026-11-20T02:00:00.000Z", startTime: "9:00 PM" },
              { startAt: "2026-11-20T02:30:00.000Z", startTime: "9:30 PM" },
            ],
          },
        },
      ],
      3,
    ),
    user("r3", "Mark walk done", 2),
    reply(
      "r4",
      [
        {
          type: "outcome",
          outcome: { id: "outcome-walk", kind: "status", text: "Undid: Marked Walk done.", confirmed: false, undo: "done" },
        },
      ],
      2,
    ),
  ],
};

/** A medical question: one-line decline, timing still discussed, grey disclaimer under the reply. */
export const CHAT_FIXTURE_MEDICAL: ChatThreadState = {
  conversationId: "conv-medical",
  streamingId: null,
  messages: [
    user("d1", "Should I take my meds with dinner instead?", 5),
    reply(
      "d2",
      [
        tool("t5", "occurrences", "Looked at your Meds"),
        {
          type: "text",
          text:
            "I can’t advise on medication. Your doctor or pharmacist can. On timing: Meds is at 8:00 AM and takes 5 minutes, and dinner is at 7:00 PM on your calendar, so moving it there would not clash with anything.",
        },
        { type: "notice", notice: CHAT_MEDICAL_NOTICE },
      ],
      5,
    ),
  ],
};

/** The budget runs out mid-question: what ran shows first, then the alert. Also an off source. */
export const CHAT_FIXTURE_BUDGET: ChatThreadState = {
  conversationId: "conv-budget",
  streamingId: null,
  messages: [
    user("b1", "Mark stretch done and what did I skip this week?", 1),
    reply(
      "b2",
      [
        {
          type: "outcome",
          outcome: { id: "outcome-stretch", kind: "status", text: "Marked Stretch done.", confirmed: false, undo: "available" },
        },
        { type: "tool", tool: { id: "t6", subject: "calendar", text: "Your calendar is off in Settings", state: "off" } },
        {
          type: "alert",
          alert: {
            code: "budget_reached",
            text: "This month’s chat budget is used up. Chat is back on December 1. Your Timeline still works.",
            retryAt: "2026-12-01T05:00:00.000Z",
          },
        },
      ],
      1,
    ),
  ],
};

/** The person pressed Stop: the partial answer stays and ends with "Stopped." */
export const CHAT_FIXTURE_STOPPED: ChatThreadState = {
  conversationId: "conv-stopped",
  streamingId: null,
  messages: [
    user("s1", "How is my week going?", 3),
    reply(
      "s2",
      [
        tool("t9", "adherence", "Looked at this week"),
        { type: "text", text: "This week you finished 18 of 24 items. Meds and Walk are done every day so far. Run" },
        { type: "notice", notice: CHAT_STOPPED_NOTICE },
      ],
      3,
    ),
  ],
};

export const CHAT_FIXTURE_CONVERSATIONS: readonly ChatConversationSummary[] = [
  { id: "conv-today", title: "What is on today?", createdAt: AT(12), updatedAt: AT(10) },
  { id: "conv-confirm", title: "Make my run Monday, Wednesday and Friday", createdAt: AT(1500), updatedAt: AT(1490) },
  { id: "conv-refusal", title: "Move my run to 7 tonight", createdAt: AT(3000), updatedAt: AT(2990) },
  { id: "conv-medical", title: "Should I take my meds with dinner instead?", createdAt: AT(9000), updatedAt: AT(9000) },
  { id: "conv-week", title: "How did last week go?", createdAt: AT(11000), updatedAt: AT(10990) },
  { id: "conv-piano", title: "Add piano practice on weekday evenings", createdAt: AT(21000), updatedAt: AT(20990) },
];

const VIEWS: Record<string, ChatThreadState> = {
  "conv-today": CHAT_FIXTURE_TODAY,
  "conv-confirm": CHAT_FIXTURE_CONFIRM,
  "conv-refusal": CHAT_FIXTURE_REFUSAL,
  "conv-medical": CHAT_FIXTURE_MEDICAL,
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A bench week: Piano practice slipping, Meds steady, two items still open today. */
export const CHAT_FIXTURE_STARTER_FACTS: ChatStarterFacts = {
  today: "2026-11-20",
  todayTotal: 4,
  todayDone: 2,
  todayOpen: 2,
  movedToday: null,
  unmarked: 1,
  week: { decided: 18, rate: 0.72 },
  month: { decided: 76, rate: 0.78 },
  behaviors: [
    { title: "Meds", decided: 28, rate: 1 },
    { title: "Walk", decided: 24, rate: 0.83 },
    { title: "Run", decided: 12, rate: 0.67 },
    { title: "Piano practice", decided: 12, rate: 0.33 },
  ],
};

/**
 * Answers in memory. A message with "skip" streams a read; anything else marks one item done.
 * `offline`: every send fails before the server takes it (the "unsent" bench state).
 */
export function fixtureChatClient({ delayMs = 120, offline = false }: Readonly<{ delayMs?: number; offline?: boolean }> = {}): ChatClient {
  let counter = 0;
  return {
    async starters() {
      await sleep(delayMs);
      return offline ? CHAT_STARTER_PROMPTS : pickChatStarters(CHAT_FIXTURE_STARTER_FACTS).map((starter) => starter.text);
    },
    async sendTurn(request, onEvent, signal) {
      if (offline) {
        await sleep(delayMs);
        throw new TypeError("offline");
      }
      counter += 1;
      const messageId = `bench-reply-${counter}`;
      const events: ChatEvent[] = [
        {
          type: "start",
          conversationId: request.conversationId ?? "bench-conv",
          userMessageId: `bench-user-${counter}`,
          messageId,
          protocol: "1",
        },
      ];
      if (/skip/i.test(request.message)) {
        events.push(
          { type: "tool", tool: { id: `bench-tool-${counter}`, subject: "adherence", text: "Looked at this week", state: "done" } },
          ..."You skipped Run on Tuesday and Piano practice on Monday and Wednesday. Everything else is done or still open today."
            .split(/(?<= )/)
            .map((delta) => ({ type: "text", delta }) as const),
        );
      } else if (/medic|meds with/i.test(request.message)) {
        events.push(
          { type: "text", delta: "I can’t advise on medication. Meds is at 8:00 AM today." },
          { type: "notice", notice: CHAT_MEDICAL_NOTICE },
        );
      } else {
        events.push(
          { type: "tool", tool: { id: `bench-tool-${counter}`, subject: "timeline", text: "Looked at your Timeline", state: "done" } },
          ...`Today you have Meds at 8:00 AM, Walk at 9:00 AM and Run at 6:00 PM.`.split(/(?<= )/).map((delta) => ({ type: "text", delta }) as const),
        );
      }
      events.push({ type: "done", messageId });
      for (const event of events) {
        await sleep(event.type === "text" ? delayMs / 4 : delayMs);
        if (signal?.aborted) throw new DOMException("Stopped", "AbortError");
        onEvent(event);
      }
    },
    async confirm(confirmId, answer) {
      await sleep(delayMs);
      const confirm = { ...BEHAVIOR_CONFIRM, id: confirmId, state: answer === "yes" ? "accepted" : "declined" } as const;
      return {
        confirm,
        outcomes:
          answer === "yes"
            ? [
                { id: "outcome-run-days", kind: "update_behavior", text: "Changed Run to Monday, Wednesday and Friday.", confirmed: true, undo: "unavailable" },
                { id: "outcome-run-move", kind: "move", text: "Moved today’s Run to 6:00 PM.", confirmed: true, undo: "available" },
              ]
            : [],
        refusals: [],
      };
    },
    async undo(outcomeId) {
      await sleep(delayMs);
      const original = [MEDS_OUTCOME].find((outcome) => outcome.id === outcomeId);
      const text = original ? `Undid: ${original.text}` : "Undone.";
      return { outcome: { ...(original ?? { id: outcomeId, kind: "status", confirmed: false }), text, undo: "done" } as ChatOutcome };
    },
    async listConversations() {
      await sleep(delayMs);
      return { conversations: CHAT_FIXTURE_CONVERSATIONS, nextBefore: null };
    },
    async stop() {},
    async getConversation(id) {
      await sleep(delayMs);
      const thread = VIEWS[id] ?? CHAT_FIXTURE_TODAY;
      const summary = CHAT_FIXTURE_CONVERSATIONS.find((item) => item.id === id) ?? CHAT_FIXTURE_CONVERSATIONS[0]!;
      return { conversation: summary, messages: thread.messages };
    },
  };
}
