/**
 * Advisor plan Phase 5B: the Chat page's client state and wire calls.
 *
 * The server (Phase 5A) streams one ChatEvent per line. `applyChatEvent` folds
 * those events into the same ChatMessage shape the server stores, so a live
 * reply and a reopened conversation render through one component. Everything
 * here is pure except the `createChatClient` fetch calls.
 */
import {
  CHAT_ALERT_CODES,
  CHAT_ROUTES,
  CHAT_STOPPED_NOTICE,
  type ChatAlert,
  type ChatAlertCode,
  type ChatConfirm,
  type ChatConfirmResponse,
  type ChatConversationList,
  type ChatConversationView,
  type ChatEvent,
  type ChatMessage,
  type ChatNotice,
  type ChatOutcome,
  type ChatPart,
  type ChatStarterList,
  type ChatTurnRequest,
  type ChatUndoResponse,
} from "@cadence/core/types/chat";
import { CHAT_STARTER_COUNT, CHAT_STARTER_FALLBACK } from "@cadence/core/resolvers/chat-starters.resolver";

export type ChatThreadState = Readonly<{
  conversationId: string | null;
  messages: readonly ChatMessage[];
  /** The reply being streamed, by message id; null when no turn is running. */
  streamingId: string | null;
}>;

export const EMPTY_CHAT_THREAD: ChatThreadState = Object.freeze({
  conversationId: null,
  messages: [],
  streamingId: null,
});

/** The person's message, shown at once while the turn starts. */
export function addPendingUserMessage(
  state: ChatThreadState,
  clientMessageId: string,
  text: string,
  now: Date = new Date(),
): ChatThreadState {
  const message: ChatMessage = {
    id: pendingUserId(clientMessageId),
    role: "user",
    createdAt: now.toISOString(),
    parts: [{ type: "text", text }],
  };
  return {
    ...state,
    messages: [...state.messages, message],
    streamingId: pendingReplyId(clientMessageId),
  };
}

export function pendingUserId(clientMessageId: string) {
  return `pending-user:${clientMessageId}`;
}

export function pendingReplyId(clientMessageId: string) {
  return `pending-reply:${clientMessageId}`;
}

/** Folds one stream event into the thread. Unknown events are ignored. */
export function applyChatEvent(
  state: ChatThreadState,
  event: ChatEvent,
  clientMessageId: string,
  now: Date = new Date(),
): ChatThreadState {
  switch (event.type) {
    case "start": {
      const pendingUser = pendingUserId(clientMessageId);
      const pendingReply = pendingReplyId(clientMessageId);
      const messages = state.messages
        // A replayed turn reuses the server's reply id: drop the old partial reply so events land once.
        .filter((message) => message.id !== pendingReply && message.id !== event.messageId)
        .map((message) =>
          message.id === pendingUser ? { ...message, id: event.userMessageId } : message,
        );
      const reply: ChatMessage = {
        id: event.messageId,
        role: "assistant",
        createdAt: now.toISOString(),
        parts: [],
      };
      return {
        conversationId: event.conversationId,
        messages: [...messages, reply],
        streamingId: event.messageId,
      };
    }
    case "text":
      return updateStreamingReply(state, (parts) => {
        const last = parts.at(-1);
        if (last?.type === "text") {
          return [...parts.slice(0, -1), { type: "text", text: last.text + event.delta }];
        }
        return [...parts, { type: "text", text: event.delta }];
      });
    case "tool":
      return updateStreamingReply(state, (parts) => [...parts, { type: "tool", tool: event.tool }]);
    case "outcome":
      return updateStreamingReply(state, (parts) => [...parts, { type: "outcome", outcome: event.outcome }]);
    case "confirm":
      return updateStreamingReply(state, (parts) => [...parts, { type: "confirm", confirm: event.confirm }]);
    case "refusal":
      return updateStreamingReply(state, (parts) => [...parts, { type: "refusal", refusal: event.refusal }]);
    case "notice":
      return updateStreamingReply(state, (parts) => [...parts, { type: "notice", notice: event.notice }]);
    case "alert":
      return addAlertToReply(state, event.alert, clientMessageId, now);
    case "done":
      return { ...state, streamingId: null };
    default:
      return state;
  }
}

function updateStreamingReply(
  state: ChatThreadState,
  update: (parts: readonly ChatPart[]) => readonly ChatPart[],
): ChatThreadState {
  if (!state.streamingId) return state;
  let found = false;
  const messages = state.messages.map((message) => {
    if (message.id !== state.streamingId) return message;
    found = true;
    return { ...message, parts: update(message.parts) };
  });
  return found ? { ...state, messages } : state;
}

/**
 * An alert can arrive before `start` (chat is off, a bad request) or after it
 * (budget reached mid-question). Either way it shows under the person's message.
 */
function addAlertToReply(
  state: ChatThreadState,
  alert: ChatAlert,
  clientMessageId: string,
  now: Date,
): ChatThreadState {
  const withReply = ensureReply(state, clientMessageId, now);
  return updateStreamingReply(withReply, (parts) => [...parts, { type: "alert", alert }]);
}

function ensureReply(state: ChatThreadState, clientMessageId: string, now: Date): ChatThreadState {
  const replyId = state.streamingId ?? pendingReplyId(clientMessageId);
  if (state.messages.some((message) => message.id === replyId)) {
    return { ...state, streamingId: replyId };
  }
  const reply: ChatMessage = { id: replyId, role: "assistant", createdAt: now.toISOString(), parts: [] };
  return { ...state, messages: [...state.messages, reply], streamingId: replyId };
}

/** Ends a turn the client gave up on (the connection dropped) with one alert. */
export function failTurn(
  state: ChatThreadState,
  clientMessageId: string,
  alert: ChatAlert,
  now: Date = new Date(),
): ChatThreadState {
  return { ...addAlertToReply(state, alert, clientMessageId, now), streamingId: null };
}

/** Removes a failed attempt's local alert before the same message is sent again. */
export function clearFailedReply(state: ChatThreadState, clientMessageId: string): ChatThreadState {
  const replyId = pendingReplyId(clientMessageId);
  return { ...state, messages: state.messages.filter((message) => message.id !== replyId) };
}

/**
 * A turn that failed or was stopped before the server's `start`: the server never
 * stored it, so the message leaves the transcript and goes back into the composer.
 */
export function dropUnsentTurn(state: ChatThreadState, clientMessageId: string): ChatThreadState {
  const ids = new Set([pendingUserId(clientMessageId), pendingReplyId(clientMessageId)]);
  return { ...state, messages: state.messages.filter((message) => !ids.has(message.id)), streamingId: null };
}

/** True once the server's `start` replaced the pending message with the stored one. */
export function turnStarted(state: ChatThreadState, clientMessageId: string): boolean {
  return !state.messages.some((message) => message.id === pendingUserId(clientMessageId));
}

/** The person pressed Stop: what streamed stays, and the reply ends with "Stopped." */
export function stopTurn(state: ChatThreadState): ChatThreadState {
  const stopped = updateStreamingReply(state, (parts) =>
    parts.at(-1)?.type === "notice" && (parts.at(-1) as { notice: ChatNotice }).notice.kind === "stopped"
      ? parts
      : [...parts, { type: "notice", notice: CHAT_STOPPED_NOTICE }],
  );
  return { ...stopped, streamingId: null };
}

/**
 * The skill's run states. `waiting_for_user` means the newest reply holds an open
 * Yes · No question. A reopened conversation reads the same way as a live one.
 */
export type ChatRunState = "idle" | "working" | "waiting_for_user" | "completed" | "stopped" | "failed";

export function chatRunState(state: ChatThreadState): ChatRunState {
  if (state.streamingId) return "working";
  const last = state.messages.at(-1);
  if (!last) return "idle";
  if (last.role === "user") return "failed";
  if (last.parts.some((part) => part.type === "confirm" && part.confirm.state === "pending")) return "waiting_for_user";
  const tail = last.parts.at(-1);
  if (tail?.type === "notice" && tail.notice.kind === "stopped") return "stopped";
  if (tail?.type === "alert") return "failed";
  return "completed";
}

/** What a screen reader hears when the run state changes. Idle says nothing. */
export const CHAT_RUN_ANNOUNCEMENTS: Readonly<Record<ChatRunState, string>> = Object.freeze({
  idle: "",
  working: "Cadence is answering.",
  waiting_for_user: "Cadence is waiting for your Yes or No.",
  completed: "Cadence answered.",
  stopped: "Stopped.",
  failed: "Not answered.",
});

/** Replaces one outcome everywhere it appears (after Undo). */
export function replaceOutcome(state: ChatThreadState, outcome: ChatOutcome): ChatThreadState {
  return mapParts(state, (part) =>
    part.type === "outcome" && part.outcome.id === outcome.id ? [{ type: "outcome", outcome }] : [part],
  );
}

/** A failed or refused Undo shows its alert right under the outcome it answers. */
export function addAlertAfterOutcome(state: ChatThreadState, outcomeId: string, alert: ChatAlert): ChatThreadState {
  return mapParts(state, (part) =>
    part.type === "outcome" && part.outcome.id === outcomeId ? [part, { type: "alert", alert }] : [part],
  );
}

/**
 * After Yes or No: the confirm takes its new state, and what ran (or was refused)
 * follows it in the same reply, in order.
 */
export function applyConfirmResponse(state: ChatThreadState, response: ChatConfirmResponse): ChatThreadState {
  return mapParts(state, (part) => {
    if (part.type !== "confirm" || part.confirm.id !== response.confirm.id) return [part];
    const followUps: ChatPart[] = [
      ...response.outcomes.map((outcome) => ({ type: "outcome", outcome }) as const),
      ...response.refusals.map((refusal) => ({ type: "refusal", refusal }) as const),
      ...(response.alert ? [{ type: "alert", alert: response.alert } as const] : []),
    ];
    return [{ type: "confirm", confirm: response.confirm }, ...followUps];
  });
}

/** A confirm shown on screen expires when a newer message is sent (T13). */
export function expireOpenConfirms(state: ChatThreadState): ChatThreadState {
  return mapParts(state, (part) =>
    part.type === "confirm" && part.confirm.state === "pending"
      ? [{ type: "confirm", confirm: { ...part.confirm, state: "expired" } satisfies ChatConfirm }]
      : [part],
  );
}

function mapParts(state: ChatThreadState, map: (part: ChatPart) => readonly ChatPart[]): ChatThreadState {
  return {
    ...state,
    messages: state.messages.map((message) =>
      message.role === "assistant" ? { ...message, parts: message.parts.flatMap(map) } : message,
    ),
  };
}

export function threadFromConversation(view: ChatConversationView): ChatThreadState {
  const messages = view.messages.map((message) => ({
    ...message,
    parts: message.parts.flatMap((part) => {
      const safe = normalizeChatPart(part);
      return safe ? [safe] : [];
    }),
  }));
  return { conversationId: view.conversation.id, messages, streamingId: null };
}

// ----------------------------------------------------------------- validation

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const isString = (value: unknown): value is string => typeof value === "string";

/**
 * Checks a stored part or an event's content against the shapes the renderer
 * needs. A part of an unknown or broken shape that still carries a `text` string
 * shows as plain text; anything else is dropped. Nothing malformed reaches React.
 */
export function normalizeChatPart(value: unknown): ChatPart | null {
  if (!isRecord(value)) return null;
  const fallback = (): ChatPart | null => (isString(value.text) && value.text ? { type: "text", text: value.text } : null);
  switch (value.type) {
    case "text":
      return isString(value.text) ? { type: "text", text: value.text } : null;
    case "tool": {
      const tool = value.tool;
      return isRecord(tool) && isString(tool.id) && isString(tool.text) ? (value as ChatPart) : fallback();
    }
    case "outcome": {
      const outcome = value.outcome;
      return isRecord(outcome) && isString(outcome.id) && isString(outcome.text) ? (value as ChatPart) : textOf(outcome);
    }
    case "confirm": {
      const confirm = value.confirm;
      return isRecord(confirm) && isString(confirm.id) && isString(confirm.question) && Array.isArray(confirm.items)
        ? (value as ChatPart)
        : null;
    }
    case "refusal": {
      const refusal = value.refusal;
      return isRecord(refusal) && isString(refusal.id) && isString(refusal.text)
        ? ({ type: "refusal", refusal: { ...refusal, alternatives: Array.isArray(refusal.alternatives) ? refusal.alternatives : [] } } as unknown as ChatPart)
        : textOf(refusal);
    }
    case "notice": {
      const notice = value.notice;
      return isRecord(notice) && isString(notice.text) ? (value as ChatPart) : null;
    }
    case "alert": {
      const alert = value.alert;
      return isRecord(alert) && isString(alert.text)
        ? ({ type: "alert", alert: { ...alert, code: CHAT_ALERT_CODE_SET.has(alert.code as ChatAlertCode) ? alert.code : "failed" } } as unknown as ChatPart)
        : null;
    }
    default:
      return fallback();
  }
}

function textOf(value: unknown): ChatPart | null {
  return isRecord(value) && isString(value.text) && value.text ? { type: "text", text: value.text } : null;
}

const CHAT_ALERT_CODE_SET: ReadonlySet<ChatAlertCode> = new Set(CHAT_ALERT_CODES);

/** One NDJSON line to a ChatEvent, or null when it does not match a known shape. */
export function parseChatEvent(value: unknown): ChatEvent | null {
  if (!isRecord(value)) return null;
  switch (value.type) {
    case "start":
      return isString(value.conversationId) && isString(value.userMessageId) && isString(value.messageId)
        ? (value as ChatEvent)
        : null;
    case "text":
      return isString(value.delta) ? { type: "text", delta: value.delta } : null;
    case "done":
      return { type: "done", messageId: isString(value.messageId) ? value.messageId : "" };
    case "tool":
    case "outcome":
    case "confirm":
    case "refusal":
    case "notice":
    case "alert": {
      const part = normalizeChatPart(value);
      if (!part) return null;
      return part.type === "text" ? { type: "text", delta: part.text } : (part as ChatEvent);
    }
    default:
      return null;
  }
}

// ----------------------------------------------------------------- side menu

/** The Chat page fires this when a conversation starts, opens or closes, so the side menu's recent chats follow. */
export const CHAT_CONVERSATIONS_CHANGED_EVENT = "cadence:chat-conversations-changed";
export type ChatConversationsChangedDetail = Readonly<{ activeId: string | null }>;

export function announceConversationsChanged(activeId: string | null) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<ChatConversationsChangedDetail>(CHAT_CONVERSATIONS_CHANGED_EVENT, { detail: { activeId } }),
  );
}

// ----------------------------------------------------------------- wording

/** The alert label for each code, written before the server's sentence ("Chat paused. …"). */
export const CHAT_ALERT_LABELS: Readonly<Record<ChatAlertCode, string>> = Object.freeze({
  budget_reached: "Chat paused",
  model_unavailable: "Chat unavailable",
  chat_off: "Chat is off",
  rate_limited: "Too many messages",
  tool_limit: "Stopped",
  failed: "Not answered",
  in_progress: "Still answering",
  invalid_request: "Not sent",
});

/** Shown while the person's own starters load, and whenever they cannot be read. */
export const CHAT_STARTER_PROMPTS: readonly string[] = Object.freeze(CHAT_STARTER_FALLBACK.map((starter) => starter.text));

const STARTER_TEXT_MAX = 200;

/** Keeps well-formed starters only; anything else falls back to the general three. */
export function parseChatStarters(value: unknown): readonly string[] {
  const list = value && typeof value === "object" ? (value as { starters?: unknown }).starters : null;
  const texts = Array.isArray(list)
    ? list.flatMap((item) => {
      const text = item && typeof item === "object" ? (item as { text?: unknown }).text : null;
      return typeof text === "string" && text.trim() && text.length <= STARTER_TEXT_MAX ? [text.trim()] : [];
    }).slice(0, CHAT_STARTER_COUNT)
    : [];
  return texts.length > 0 ? texts : CHAT_STARTER_PROMPTS;
}

/** The message a refusal's other time sends (5A: "Move it to 18:30"). */
export function alternativeMessage(startTime: string) {
  return `Move it to ${startTime}`;
}

/** "Today", "Yesterday", or a short date, in the viewer's own time zone. */
export function conversationDateLabel(iso: string, now: Date = new Date(), timeZone?: string): string {
  const day = (date: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  if (day(at) === day(now)) return "Today";
  if (day(at) === day(new Date(now.getTime() - 86_400_000))) return "Yesterday";
  const sameYear =
    new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric" }).format(at) ===
    new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric" }).format(now);
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(at);
}

// ----------------------------------------------------------------- wire

export type ChatClient = Readonly<{
  /** Streams one turn; calls `onEvent` per line. Rejects only when the connection fails. */
  sendTurn(request: ChatTurnRequest, onEvent: (event: ChatEvent) => void, signal?: AbortSignal): Promise<void>;
  confirm(confirmId: string, answer: "yes" | "no"): Promise<ChatConfirmResponse>;
  undo(outcomeId: string): Promise<ChatUndoResponse>;
  listConversations(before?: string | null): Promise<ChatConversationList>;
  getConversation(id: string): Promise<ChatConversationView>;
  /** Asks the server to end a running turn early. Never throws. */
  stop(clientMessageId: string): Promise<void>;
  /** Starter questions picked from the person's own week. Never throws: falls back to the general three. */
  starters(): Promise<readonly string[]>;
}>;

export class ChatRequestError extends Error {
  constructor(
    readonly status: number,
    readonly alert: ChatAlert | null,
  ) {
    super(alert?.text ?? `Chat request failed (${status})`);
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function createChatClient(fetchImpl: FetchLike = (input, init) => fetch(input, init)): ChatClient {
  async function json<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetchImpl(path, {
      ...init,
      credentials: "same-origin",
      headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) },
    });
    const body = (await response.json().catch(() => null)) as (T & { alert?: ChatAlert }) | null;
    if (!response.ok || body === null) throw new ChatRequestError(response.status, body?.alert ?? null);
    return body;
  }

  return {
    async sendTurn(request, onEvent, signal) {
      const response = await fetchImpl(CHAT_ROUTES.turn, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
        body: JSON.stringify(request),
        signal,
      });
      // A failure before the stream starts is a JSON `{ alert }` with an HTTP status (5A).
      const streaming = (response.headers.get("Content-Type") ?? "").includes("application/x-ndjson");
      if (!response.ok || !streaming || !response.body) {
        const body = (await response.json().catch(() => null)) as { alert?: ChatAlert } | null;
        throw new ChatRequestError(response.status, body?.alert ?? null);
      }
      await readNdjson(response.body, (line) => {
        const event = parseChatEvent(line);
        if (event) onEvent(event);
      });
    },
    confirm: (confirmId, answer) =>
      json<ChatConfirmResponse>(CHAT_ROUTES.confirm, { method: "POST", body: JSON.stringify({ confirmId, answer }) }),
    undo: (outcomeId) => json<ChatUndoResponse>(CHAT_ROUTES.undo, { method: "POST", body: JSON.stringify({ outcomeId }) }),
    listConversations: (before) =>
      json<ChatConversationList>(
        before ? `${CHAT_ROUTES.conversations}?before=${encodeURIComponent(before)}` : CHAT_ROUTES.conversations,
      ),
    getConversation: (id) => json<ChatConversationView>(CHAT_ROUTES.conversation(id)),
    async stop(clientMessageId) {
      await fetchImpl(CHAT_ROUTES.stop, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ clientMessageId }),
      }).catch(() => undefined);
    },
    async starters() {
      try {
        return parseChatStarters(await json<ChatStarterList>(CHAT_ROUTES.starters));
      } catch {
        return CHAT_STARTER_PROMPTS;
      }
    },
  };
}

/** Reads newline-delimited JSON; a malformed line is skipped, never fatal. */
export async function readNdjson(body: ReadableStream<Uint8Array>, onLine: (value: unknown) => void) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const flush = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      onLine(JSON.parse(trimmed));
    } catch {
      // A broken line loses one event, not the reply.
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      flush(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
  }
  buffer += decoder.decode();
  flush(buffer);
}
