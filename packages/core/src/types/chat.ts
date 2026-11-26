import type { ChatTravelUiCard } from "./chat-travel";

/**
 * Advisor plan Phase 5 (5A): the Chat page's wire types. Shared by the chat server
 * (lib/services/chat/), the web Chat page (5B) and Cadence for Mac (5C).
 *
 * One turn: the client POSTs a ChatTurnRequest to CHAT_ROUTES.turn and reads the
 * response body as newline-delimited JSON, one ChatEvent per line
 * (`Content-Type: application/x-ndjson`). The server stores the same content as
 * ChatPart values on the reply, so a reopened conversation renders from
 * `ChatMessage.parts` exactly as the live stream rendered it.
 *
 * Rules the client relies on (phase-5-chat.md, Decisions T12, T13, T20):
 *   - Everything except `text` is written by Cadence, never by the model. Outcome
 *     lines, confirm questions, refusals and alerts are safe to render as-is.
 *   - The first single-record, reversible write in a question runs at once and
 *     arrives as an `outcome` with an Undo. Behavior changes, and any further write
 *     in the same question, arrive as one `confirm` listing every pending write.
 *   - A confirm expires after CHAT_CONFIRM_TTL_MINUTES, when a newer message is sent
 *     in the conversation, or when a listed record changed since. Answering an
 *     expired confirm changes nothing and returns state `expired`.
 *   - When the budget runs out mid-question, outcomes already sent stay valid; the
 *     `alert` with code `budget_reached` comes after them.
 */

export const CHAT_PROTOCOL_VERSION = "1" as const;

export const CHAT_ROUTES = Object.freeze({
  /** POST ChatTurnRequest → NDJSON stream of ChatEvent. */
  turn: "/api/advisor/chat",
  /** POST ChatConfirmRequest → ChatConfirmResponse (JSON). Runs no model call. */
  confirm: "/api/advisor/chat/confirm",
  /** POST ChatUndoRequest → ChatUndoResponse (JSON). Runs no model call. */
  undo: "/api/advisor/chat/undo",
  /**
   * POST ChatStopRequest → ChatStopResponse (JSON). Asks a running turn to stop. The
   * turn ends at its next safe point and still streams to the end: text and changes
   * already made stay (with Undo), changes waiting for a Yes are dropped, then a
   * `notice` of kind "stopped" and `done`. A finished or unknown turn: `stopped: false`.
   */
  stop: "/api/advisor/chat/stop",
  /** GET → ChatConversationList (JSON), newest first. `?before=<updatedAt>` pages. */
  conversations: "/api/advisor/chat/conversations",
  /** GET `${conversations}/<id>` → ChatConversationView (JSON). */
  conversation: (id: string) => `/api/advisor/chat/conversations/${encodeURIComponent(id)}`,
  /**
   * GET → ChatStarterList (JSON). Up to three starter questions for an empty
   * conversation, picked in code from the person's own week. Runs no model call.
   */
  starters: "/api/advisor/chat/starters",
});

/** Longest message a person can send, in characters. Longer input is refused with `invalid_request`. */
export const CHAT_MESSAGE_MAX_CHARS = 4_000;
/** A pending confirm is answerable this long after it was shown. */
export const CHAT_CONFIRM_TTL_MINUTES = 15;
/** Conversations per page in the past-conversations list. */
export const CHAT_CONVERSATIONS_PAGE_SIZE = 30;

// ----------------------------------------------------------------- requests

export type ChatTurnRequest = Readonly<{
  /** Null starts a new conversation; the `start` event names it. */
  conversationId: string | null;
  message: string;
  /**
   * A UUID the client makes once per send. Sending the same id again (a retry after a
   * dropped connection) never runs the turn twice: the server replays the stored reply
   * when it finished, or answers `alert` code `in_progress` while it is still running.
   */
  clientMessageId: string;
}>;

export type ChatConfirmRequest = Readonly<{ confirmId: string; answer: "yes" | "no" }>;

export type ChatConfirmResponse = Readonly<{
  confirm: ChatConfirm;
  /** The writes that ran after Yes, in order. Empty after No or when expired. */
  outcomes: readonly ChatOutcome[];
  /** Writes a rule refused at Yes time (for example a move onto a calendar event). */
  refusals: readonly ChatRefusal[];
  alert?: ChatAlert;
}>;

export type ChatUndoRequest = Readonly<{ outcomeId: string }>;
export type ChatUndoResponse = Readonly<{ outcome: ChatOutcome; alert?: ChatAlert }>;

// ----------------------------------------------------------------- stream events

export type ChatEvent =
  /** Always first. Ids of the stored user message and of the reply being written. */
  | Readonly<{ type: "start"; conversationId: string; userMessageId: string; messageId: string; protocol: typeof CHAT_PROTOCOL_VERSION }>
  /** Model text, appended to the reply's current text part. Plain text, no Markdown. */
  | Readonly<{ type: "text"; delta: string }>
  | Readonly<{ type: "tool"; tool: ChatToolLine }>
  | Readonly<{ type: "outcome"; outcome: ChatOutcome }>
  | Readonly<{ type: "confirm"; confirm: ChatConfirm }>
  | Readonly<{ type: "refusal"; refusal: ChatRefusal }>
  | Readonly<{ type: "notice"; notice: ChatNotice }>
  | Readonly<{ type: "alert"; alert: ChatAlert }>
  | Readonly<{ type: "travel_card"; card: ChatTravelUiCard }>
  /** Always last when the stream ends normally. */
  | Readonly<{ type: "done"; messageId: string }>;

// ----------------------------------------------------------------- stored content

/** A reply's content in order. Same shapes as the events, without start and done. */
export type ChatPart =
  | Readonly<{ type: "text"; text: string }>
  | Readonly<{ type: "tool"; tool: ChatToolLine }>
  | Readonly<{ type: "outcome"; outcome: ChatOutcome }>
  | Readonly<{ type: "confirm"; confirm: ChatConfirm }>
  | Readonly<{ type: "refusal"; refusal: ChatRefusal }>
  | Readonly<{ type: "notice"; notice: ChatNotice }>
  | Readonly<{ type: "alert"; alert: ChatAlert }>
  | Readonly<{ type: "travel_card"; card: ChatTravelUiCard }>;

export type ChatMessage = Readonly<{
  id: string;
  role: "user" | "assistant";
  createdAt: string;
  /** A user message has exactly one `text` part. */
  parts: readonly ChatPart[];
}>;

export type ChatConversationSummary = Readonly<{
  id: string;
  /** Cadence's short title: the first words of the first message. */
  title: string;
  createdAt: string;
  updatedAt: string;
}>;

export type ChatConversationList = Readonly<{
  conversations: readonly ChatConversationSummary[];
  /** Pass as `before` for the next page; null on the last page. */
  nextBefore: string | null;
}>;

/** A starter question: tapping it sends `text` as the person's message. */
export type ChatStarter = Readonly<{ id: string; text: string }>;

export type ChatStarterList = Readonly<{ starters: readonly ChatStarter[] }>;

export type ChatConversationView = Readonly<{
  conversation: ChatConversationSummary;
  /** Oldest first. Confirms and outcomes carry their current state, not the state when sent. */
  messages: readonly ChatMessage[];
}>;

// ----------------------------------------------------------------- parts

/** What chat looked at, shown as a small muted line ("Looked at your Timeline"). */
export const CHAT_TOOL_SUBJECTS = [
  "timeline", "behaviors", "occurrences", "notes", "adherence", "account", "search", "calendar", "workouts", "advice", "travel", "patterns",
  "periods",
] as const;
export type ChatToolSubject = (typeof CHAT_TOOL_SUBJECTS)[number];

export type ChatToolLine = Readonly<{
  id: string;
  subject: ChatToolSubject;
  /** Cadence's words, for example "Looked at your calendar". */
  text: string;
  /** `failed`: the source could not be read ("Could not read your calendar"). `off`: turned off in Settings. */
  state: "done" | "failed" | "off";
}>;

export const CHAT_OUTCOME_KINDS = [
  "status", "occurrence_note", "day_note", "move", "create_behavior", "update_behavior", "archive_behavior", "restore_behavior",
  "opportunity",
] as const;
export type ChatOutcomeKind = (typeof CHAT_OUTCOME_KINDS)[number];

/** A write that ran. Rendered as Ink italic outcome text (DESIGN.md "Outcome text"). */
export type ChatOutcome = Readonly<{
  id: string;
  kind: ChatOutcomeKind;
  /** Cadence's words in the past tense, for example "Marked Meds done." */
  text: string;
  /** True when it ran after a Yes on a confirm. */
  confirmed: boolean;
  /**
   * `available`: show Undo. `done`: it was undone; `text` already says so ("Undid: Marked Meds done.").
   * `unavailable`: no Undo for this write (a Behavior edit), or Undo no longer applies.
   */
  undo: "available" | "done" | "unavailable";
  /** Records the write touched, so a client can refresh them. */
  occurrenceId?: string;
  behaviorId?: string;
  localDate?: string;
}>;

export type ChatConfirmItem = Readonly<{
  /** Cadence's words in the imperative, for example "Mark Walk done". */
  text: string;
  kind: ChatOutcomeKind;
}>;

/** One Yes · No question listing every pending write of one question. */
export type ChatConfirm = Readonly<{
  id: string;
  /** Plain question, for example "Make these 2 changes?" */
  question: string;
  items: readonly ChatConfirmItem[];
  expiresAt: string;
  /** `pending` shows Yes · No. Other states show as plain text without links. */
  state: "pending" | "accepted" | "declined" | "expired";
}>;

/** A write a rule stopped. Shown in the shared alert style, with other times as text links when present. */
export type ChatRefusal = Readonly<{
  id: string;
  kind: ChatOutcomeKind;
  /** Cadence's sentence, for example "Your 6 pm has Team dinner on your calendar." */
  text: string;
  reason: string;
  occurrenceId?: string;
  /** Up to three other start times today. Choosing one sends it as a normal message ("Move it to 18:30"). */
  alternatives: readonly Readonly<{ startAt: string; startTime: string }>[];
}>;

/** `medical`: show "Cadence does not advise on medical matters." as a small grey note under the reply (D6). */
export type ChatNotice = Readonly<{ kind: "medical" | "stopped"; text: string }>;

export type ChatStopRequest = Readonly<{ clientMessageId: string }>;
/** `stopped` is true when a running turn was asked to stop. */
export type ChatStopResponse = Readonly<{ stopped: boolean }>;

export const CHAT_ALERT_CODES = [
  "budget_reached", "model_unavailable", "chat_off", "rate_limited", "tool_limit", "failed", "in_progress", "invalid_request",
] as const;
export type ChatAlertCode = (typeof CHAT_ALERT_CODES)[number];

/** One red sentence in the shared alert style. */
export type ChatAlert = Readonly<{
  code: ChatAlertCode;
  text: string;
  /** `budget_reached`: when chat is available again (UTC instant). `rate_limited`: when to retry. */
  retryAt?: string;
}>;

/** The fixed medical disclaimer (D6). */
export const CHAT_MEDICAL_NOTICE: ChatNotice = Object.freeze({ kind: "medical", text: "Cadence does not advise on medical matters." });
export const CHAT_STOPPED_NOTICE: ChatNotice = Object.freeze({ kind: "stopped", text: "Stopped." });
