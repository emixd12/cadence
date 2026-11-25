"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import type {
  ChatAlert,
  ChatConfirm,
  ChatMessage,
  ChatOutcome,
  ChatPart,
  ChatRefusal,
  ChatToolLine,
} from "@cadence/core/types/chat";
import { AlertNotice, type AlertNoticeKind } from "@/components/feedback/AlertNotice";
import { CHAT_ALERT_LABELS } from "@/lib/ui/chat";
import { ChatThinkingHorse } from "./ChatThinkingHorse";
import streamStyles from "./chat-stream-text.module.css";

// Advisor plan Phase 5B: one conversation, text-like (DESIGN.md "Chat"). The
// person's words sit in a Cold Surface block on the right; Cadence's reply is
// plain Ink text. Tool lines and notes are small Readable Ash lines, outcomes are
// Ink italic with upright links, and anything that went wrong is the inline
// Alert notice: one Rust Signal sentence.

const LINK =
  "-my-2 inline-block py-2 underline underline-offset-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-default disabled:opacity-60";

export type ChatMessageHandlers = Readonly<{
  onUndo: (outcome: ChatOutcome) => void;
  onConfirm: (confirm: ChatConfirm, answer: "yes" | "no") => void;
  onAlternative: (refusal: ChatRefusal, startTime: string) => void;
  /** Ids of outcomes or confirms whose request is in flight. */
  busyIds: ReadonlySet<string>;
  /** Disables the links that send a message while a reply streams. */
  sending: boolean;
}>;

export function ChatMessages({
  messages,
  streamingId,
  handlers,
}: Readonly<{
  messages: readonly ChatMessage[];
  streamingId: string | null;
  handlers: ChatMessageHandlers;
}>) {
  const streamingVisible = streamingId !== null && messages.some((message) => message.id === streamingId);
  // The reply that streamed last keeps its word spans after it ends, so the fade can finish.
  const [liveId, setLiveId] = useState(streamingId);
  if (streamingId !== null && streamingId !== liveId) setLiveId(streamingId);
  return (
    <ol className="flex flex-col gap-6" aria-label="Conversation">
      {messages.map((message) => (
        <li key={message.id} data-chat-role={message.role}>
          {message.role === "user" ? (
            <UserMessage message={message} />
          ) : (
            <AssistantMessage
              message={message}
              streaming={message.id === streamingId}
              live={message.id === liveId}
              handlers={handlers}
            />
          )}
        </li>
      ))}
      {streamingId !== null && !streamingVisible ? (
        <li data-chat-role="assistant">
          <WaitingLine started={false} />
        </li>
      ) : null}
    </ol>
  );
}

function UserMessage({ message }: Readonly<{ message: ChatMessage }>) {
  const text = message.parts.map((part) => (part.type === "text" ? part.text : "")).join("");
  return (
    <div className="flex justify-end">
      <p className="max-w-[85%] whitespace-pre-wrap break-words bg-surface px-3 py-2 text-base leading-6 text-foreground">
        <span className="sr-only">You: </span>
        {text}
      </p>
    </div>
  );
}

function AssistantMessage({
  message,
  streaming,
  live,
  handlers,
}: Readonly<{ message: ChatMessage; streaming: boolean; live: boolean; handlers: ChatMessageHandlers }>) {
  const groups = groupParts(message.parts);
  // The horse runs whenever the reply is under way and no words are arriving.
  const waiting = streaming && message.parts.at(-1)?.type !== "text";
  // After a tool line the horse sits in that line; otherwise it gets a line of its own.
  const runningGroup = waiting && groups.at(-1)?.kind === "tools" ? groups.length - 1 : -1;
  return (
    <div className="flex max-w-prose flex-col gap-2 text-base leading-6 text-foreground" aria-busy={streaming || undefined}>
      <span className="sr-only">Cadence: </span>
      {groups.map((group, index) => (
        <PartGroup key={index} group={group} live={live} running={index === runningGroup} handlers={handlers} />
      ))}
      {waiting && runningGroup === -1 ? <WaitingLine started={message.parts.length > 0} /> : null}
    </div>
  );
}

/** Consecutive tool lines read as one small block. */
type PartGroupValue = Readonly<{ kind: "tools"; parts: readonly Extract<ChatPart, { type: "tool" }>[] }> | Readonly<{ kind: "part"; part: ChatPart }>;

function groupParts(parts: readonly ChatPart[]): PartGroupValue[] {
  const groups: PartGroupValue[] = [];
  for (const part of parts) {
    const last = groups.at(-1);
    if (part.type === "tool" && last?.kind === "tools") {
      groups[groups.length - 1] = { kind: "tools", parts: [...last.parts, part] };
    } else if (part.type === "tool") {
      groups.push({ kind: "tools", parts: [part] });
    } else {
      groups.push({ kind: "part", part });
    }
  }
  return groups;
}

function PartGroup({
  group,
  live,
  running,
  handlers,
}: Readonly<{ group: PartGroupValue; live: boolean; running: boolean; handlers: ChatMessageHandlers }>) {
  if (group.kind === "tools") return <ToolLines tools={group.parts.map((part) => part.tool)} running={running} />;
  const { part } = group;
  switch (part.type) {
    case "text":
      return <p className="whitespace-pre-wrap break-words">{live ? <StreamedWords text={part.text} /> : part.text}</p>;
    case "outcome":
      return <OutcomeLine outcome={part.outcome} handlers={handlers} />;
    case "confirm":
      return <ConfirmBlock confirm={part.confirm} handlers={handlers} />;
    case "refusal":
      return <RefusalBlock refusal={part.refusal} handlers={handlers} />;
    case "notice":
      return (
        <p className="text-sm leading-5 text-muted-readable" data-chat-notice={part.notice.kind}>
          {part.notice.text}
        </p>
      );
    case "alert":
      return <ChatAlertLine alert={part.alert} />;
    default:
      return null;
  }
}

/** One Rust Signal sentence: "Chat paused. …". Also used above the composer. */
export function ChatAlertLine({ alert }: Readonly<{ alert: ChatAlert }>) {
  return (
    <AlertNotice kind={alertKind(alert.code)} label={CHAT_ALERT_LABELS[alert.code]} variant="inline">
      {alert.text}
    </AlertNotice>
  );
}

function alertKind(code: keyof typeof CHAT_ALERT_LABELS): AlertNoticeKind {
  if (code === "budget_reached") return "budget_reached";
  if (code === "model_unavailable" || code === "failed") return "model_failed";
  return "write_refused";
}

function OutcomeLine({ outcome, handlers }: Readonly<{ outcome: ChatOutcome; handlers: ChatMessageHandlers }>) {
  return (
    <p className="italic" data-chat-outcome={outcome.kind} data-chat-undo={outcome.undo}>
      {outcome.text}
      {outcome.undo === "available" ? (
        <>
          {" "}
          <span className="not-italic">
            <button
              type="button"
              className={LINK}
              disabled={handlers.busyIds.has(outcome.id)}
              onClick={() => handlers.onUndo(outcome)}
            >
              Undo
            </button>
          </span>
        </>
      ) : null}
    </p>
  );
}

function ConfirmBlock({ confirm, handlers }: Readonly<{ confirm: ChatConfirm; handlers: ChatMessageHandlers }>) {
  const busy = handlers.busyIds.has(confirm.id);
  return (
    <div className="flex flex-col gap-1" data-chat-confirm={confirm.state}>
      <p>{confirm.question}</p>
      {confirm.items.length > 0 ? (
        <ul className="flex flex-col pl-3">
          {confirm.items.map((item, index) => (
            <li key={index}>
              <span aria-hidden="true">– </span>
              {item.text}
            </li>
          ))}
        </ul>
      ) : null}
      {confirm.state === "pending" ? (
        <p>
          <button type="button" className={`font-bold ${LINK}`} disabled={busy} onClick={() => handlers.onConfirm(confirm, "yes")}>
            Yes
          </button>
          <Dot />
          <button type="button" className={LINK} disabled={busy} onClick={() => handlers.onConfirm(confirm, "no")}>
            No
          </button>
        </p>
      ) : confirm.state === "accepted" ? null : (
        <p className="italic">{confirmStateText(confirm.state)}</p>
      )}
    </div>
  );
}

/** After Yes the outcome lines say what ran, so only No and expiry get a line here. */
function confirmStateText(state: "declined" | "expired"): string {
  return state === "declined" ? "Not changed." : "This question expired. Nothing was changed.";
}

function RefusalBlock({ refusal, handlers }: Readonly<{ refusal: ChatRefusal; handlers: ChatMessageHandlers }>) {
  const action: ReactNode =
    refusal.alternatives.length > 0 ? (
      <p>
        Free:{" "}
        {refusal.alternatives.map((alternative, index) => (
          <span key={alternative.startAt}>
            {index > 0 ? <Dot /> : null}
            <button
              type="button"
              className={LINK}
              disabled={handlers.sending}
              onClick={() => handlers.onAlternative(refusal, alternative.startTime)}
            >
              {alternative.startTime}
            </button>
          </span>
        ))}
      </p>
    ) : undefined;
  return (
    <AlertNotice kind="write_refused" variant="inline" action={action}>
      {refusal.text}
    </AlertNotice>
  );
}

/**
 * What chat looked at, as one line: the newest action replaces the one before it. The
 * line is a button that opens a box listing every action. While the reply is under way
 * the horse runs beside it.
 */
function ToolLines({ tools, running }: Readonly<{ tools: readonly ChatToolLine[]; running: boolean }>) {
  const [open, setOpen] = useState(false);
  const latest = tools[tools.length - 1];
  return (
    <div className="flex flex-col gap-2 text-sm leading-5 text-muted-readable" data-chat-tools>
      <p className="flex items-center gap-2">
        {running ? <ChatThinkingHorse /> : null}
        {running ? <span className="sr-only">Working on your answer… </span> : null}
        <button
          type="button"
          className="-my-2 inline-flex items-center gap-1.5 py-2 text-left hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2"
          aria-expanded={open}
          data-chat-tools-toggle
          onClick={() => setOpen((value) => !value)}
        >
          <span key={latest.id} className={streamStyles.word}>
            {latest.text}
          </span>
          <svg
            aria-hidden="true"
            viewBox="0 0 10 10"
            className={`size-2.5 shrink-0 transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3.5 1.5 7 5 3.5 8.5" />
          </svg>
        </button>
      </p>
      <ul
        className={`flex-col gap-1.5 rounded-xl border border-line px-3.5 py-2.5 ${open ? "flex" : ""} ${running ? "ml-[58px]" : ""}`}
        hidden={!open}
        aria-label="What chat looked at"
      >
        {tools.map((tool) => (
          <li key={tool.id} data-chat-tool={tool.subject} data-chat-tool-state={tool.state}>
            {tool.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

function WaitingLine({ started }: Readonly<{ started: boolean }>) {
  return (
    <p className="text-sm leading-5 text-muted-readable">
      <ChatThinkingHorse />
      <span className="sr-only">{started ? "Working on your answer…" : "Reading your question…"}</span>
    </p>
  );
}

const WORD_STAGGER_MS = 16;
const WORD_STAGGER_MAX_MS = 900;

/** A streamed reply's words: each batch that arrives fades in, word after word. */
function StreamedWords({ text }: Readonly<{ text: string }>) {
  const words = text.match(/\S+\s*|\s+/g) ?? [];
  // `batchStart` is where the newest batch of words begins.
  const [seen, setSeen] = useState({ count: 0, batchStart: 0 });
  if (seen.count !== words.length) setSeen({ count: words.length, batchStart: Math.min(seen.count, words.length) });
  return words.map((word, index) => (
    <StreamedWord key={index} word={word} delayMs={Math.min(Math.max(index - seen.batchStart, 0) * WORD_STAGGER_MS, WORD_STAGGER_MAX_MS)} />
  ));
}

function StreamedWord({ word, delayMs }: Readonly<{ word: string; delayMs: number }>) {
  // The delay is fixed when the word first appears, so later batches do not restart it.
  const [style] = useState<CSSProperties>(() => ({ animationDelay: `${delayMs}ms` }));
  return (
    <span className={streamStyles.word} style={style}>
      {word}
    </span>
  );
}

function Dot() {
  return <span aria-hidden="true"> · </span>;
}
