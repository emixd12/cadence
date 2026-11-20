"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  CHAT_MESSAGE_MAX_CHARS,
  type ChatAlert,
  type ChatConfirm,
  type ChatConversationSummary,
  type ChatOutcome,
  type ChatRefusal,
} from "@cadence/core/types/chat";
import { AlertNotice } from "@/components/feedback/AlertNotice";
import { ChatAlertLine, ChatMessages } from "@/components/chat/ChatMessages";
import {
  CHAT_RUN_ANNOUNCEMENTS,
  ChatRequestError,
  EMPTY_CHAT_THREAD,
  addAlertAfterOutcome,
  addPendingUserMessage,
  alternativeMessage,
  announceConversationsChanged,
  applyChatEvent,
  applyConfirmResponse,
  chatRunState,
  clearFailedReply,
  conversationDateLabel,
  createChatClient,
  dropUnsentTurn,
  expireOpenConfirms,
  failTurn,
  pendingReplyId,
  replaceOutcome,
  stopTurn,
  threadFromConversation,
  type ChatClient,
  type ChatThreadState,
} from "@/lib/ui/chat";

// Advisor plan Phase 5B: the web Chat page. A conversation view with starter
// prompts and the composer, and a quiet list of past conversations. The same
// component renders the /design-system bench with a fixture client.

const LINK =
  "-my-2 inline-block py-2 underline underline-offset-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-default disabled:opacity-60";

export const CHAT_OPENING_LINE =
  "Chat can read all of your Cadence data, including notes and connected calendars.";

type View = "thread" | "past";

/** A message the server did not take (it failed or was stopped before `start`). Sent again with the same id. */
type Unsent = Readonly<{ clientMessageId: string; text: string; alert: ChatAlert | null }>;

/** A turn the server took that then failed mid-stream. "Send again" replays it with the same id. */
type FailedSend = Readonly<{ clientMessageId: string; text: string }>;

type RunningTurn = { clientMessageId: string; text: string; controller: AbortController; started: boolean };

const NETWORK_ALERT: ChatAlert = { code: "failed", text: "Could not reach Cadence. Your message was not answered." };

/** How close to the end of the page still counts as reading the newest line. */
const ANCHOR_SLACK_PX = 80;

export type ChatPageProps = Readonly<{
  client?: ChatClient;
  initialThread?: ChatThreadState;
  initialView?: View;
  /** Bench only: a fixed list instead of a fetched one. */
  initialConversations?: readonly ChatConversationSummary[];
  /** Bench only: a fixed clock for date labels. */
  now?: Date;
  /** The real page keeps the open conversation in `?c=` so a reload reopens it. */
  syncUrl?: boolean;
  /** The conversation named in `?c=` when the page loaded. */
  initialConversationId?: string;
}>;

export function ChatPage({
  client: providedClient,
  initialThread,
  initialView = "thread",
  initialConversations,
  now,
  syncUrl = false,
  initialConversationId,
}: ChatPageProps) {
  const client = useMemo(() => providedClient ?? createChatClient(), [providedClient]);
  const [thread, setThread] = useState<ChatThreadState>(initialThread ?? EMPTY_CHAT_THREAD);
  const [view, setView] = useState<View>(initialView);
  const [draft, setDraft] = useState("");
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  const [unsent, setUnsent] = useState<Unsent | null>(null);
  const [failedSend, setFailedSend] = useState<FailedSend | null>(null);
  const [restoring, setRestoring] = useState(Boolean(initialConversationId) && !initialThread);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const [showJump, setShowJump] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [starters, setStarters] = useState<readonly string[] | null>(null);
  const runRef = useRef<RunningTurn | null>(null);
  const anchoredRef = useRef(true);
  const followNextRef = useRef(false);
  const announceRef = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);
  const sending = thread.streamingId !== null;
  const runState = chatRunState(thread);

  useEffect(() => () => runRef.current?.controller.abort(), []);

  // A reload reopens the conversation named in `?c=`.
  useEffect(() => {
    if (!initialConversationId || initialThread) return;
    let live = true;
    client.getConversation(initialConversationId).then(
      (conversation) => {
        if (!live) return;
        followNextRef.current = true;
        setThread(threadFromConversation(conversation));
        setRestoring(false);
      },
      () => {
        if (!live) return;
        setConversationParam(null);
        setRestoreFailed(true);
        setRestoring(false);
      },
    );
    return () => {
      live = false;
    };
  }, [client, initialConversationId, initialThread]);

  // The person is "anchored" while the newest line is on screen. Only then does a
  // streaming reply pull the page along; otherwise "Jump to latest" appears.
  useEffect(() => {
    const onScroll = () => {
      const anchored = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - ANCHOR_SLACK_PX;
      anchoredRef.current = anchored;
      if (anchored) setShowJump(false);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const lastMessage = thread.messages.at(-1);
  const contentSize = lastMessage ? lastMessage.parts.reduce((size, part) => size + 1 + (part.type === "text" ? part.text.length : 0), 0) : 0;
  useEffect(() => {
    if (thread.messages.length === 0) return;
    if (followNextRef.current || anchoredRef.current) {
      followNextRef.current = false;
      endRef.current?.scrollIntoView?.({ block: "end" });
      anchoredRef.current = true;
    } else {
      setShowJump(true);
    }
  }, [thread.messages.length, contentSize]);

  const jumpToLatest = useCallback(() => {
    anchoredRef.current = true;
    setShowJump(false);
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, []);

  // Screen readers hear each run state change once, without moving focus.
  useEffect(() => {
    if (announceRef.current) setAnnouncement(CHAT_RUN_ANNOUNCEMENTS[runState]);
  }, [runState]);

  const syncConversation = useCallback(
    (id: string | null) => {
      if (syncUrl) setConversationParam(id);
      announceConversationsChanged(id);
    },
    [syncUrl],
  );

  const runTurn = useCallback(
    async (clientMessageId: string, text: string, conversationId: string | null) => {
      const run: RunningTurn = { clientMessageId, text, controller: new AbortController(), started: false };
      runRef.current = run;
      announceRef.current = true;
      try {
        await client.sendTurn(
          { conversationId, message: text, clientMessageId },
          (event) => {
            if (event.type === "start") {
              run.started = true;
              syncConversation(event.conversationId);
            }
            setThread((current) => applyChatEvent(current, event, clientMessageId));
          },
          run.controller.signal,
        );
        // A stream that ended without `done` still ends the turn.
        setThread((current) => (current.streamingId ? { ...current, streamingId: null } : current));
      } catch (error) {
        // Stop already settled the thread.
        if (run.controller.signal.aborted) return;
        const alert = error instanceof ChatRequestError && error.alert ? error.alert : null;
        if (!run.started) {
          // The server never took it: the words go back into the box, nothing is lost.
          setThread((current) => dropUnsentTurn(current, clientMessageId));
          setDraft((current) => (current.trim() ? current : text));
          setUnsent({ clientMessageId, text, alert: alert ?? NETWORK_ALERT });
        } else {
          setThread((current) => failTurn(current, clientMessageId, alert ?? NETWORK_ALERT));
          setFailedSend({ clientMessageId, text });
        }
      } finally {
        if (runRef.current === run) runRef.current = null;
      }
    },
    [client, syncConversation],
  );

  const send = useCallback(
    (raw: string) => {
      const text = raw.trim();
      // While a requested conversation is still opening, a send would start a new one instead.
      if (!text || sending || restoring) return;
      // The same words after a failure keep their id, so the server never runs them twice.
      const clientMessageId = unsent && unsent.text === text ? unsent.clientMessageId : newClientMessageId();
      setUnsent(null);
      setFailedSend(null);
      setRestoreFailed(false);
      setDraft("");
      setView("thread");
      followNextRef.current = true;
      setThread((current) => addPendingUserMessage(expireOpenConfirms(current), clientMessageId, text));
      void runTurn(clientMessageId, text, thread.conversationId);
    },
    [restoring, runTurn, sending, thread.conversationId, unsent],
  );

  /** Ends the running turn. What streamed stays; a turn the server never took goes back into the box. */
  const stop = useCallback(() => {
    const run = runRef.current;
    if (!run) return;
    runRef.current = null;
    void client.stop(run.clientMessageId);
    run.controller.abort();
    if (run.started) {
      setThread((current) => stopTurn(current));
    } else {
      setThread((current) => dropUnsentTurn(current, run.clientMessageId));
      setDraft((current) => (current.trim() ? current : run.text));
      setUnsent({ clientMessageId: run.clientMessageId, text: run.text, alert: null });
    }
  }, [client]);

  /** Sends the same message again with the same id, so the server never runs it twice. */
  const retry = useCallback(() => {
    if (!failedSend || sending) return;
    const { clientMessageId, text } = failedSend;
    setFailedSend(null);
    followNextRef.current = true;
    setThread((current) => ({ ...clearFailedReply(current, clientMessageId), streamingId: pendingReplyId(clientMessageId) }));
    void runTurn(clientMessageId, text, thread.conversationId);
  }, [failedSend, runTurn, sending, thread.conversationId]);

  const withBusy = useCallback(async (id: string, work: () => Promise<void>) => {
    announceRef.current = true;
    setBusyIds((current) => new Set(current).add(id));
    try {
      await work();
    } finally {
      setBusyIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }, []);

  const onUndo = useCallback(
    (outcome: ChatOutcome) =>
      void withBusy(outcome.id, async () => {
        try {
          const response = await client.undo(outcome.id);
          setThread((current) => {
            const next = replaceOutcome(current, response.outcome);
            return response.alert ? addAlertAfterOutcome(next, outcome.id, response.alert) : next;
          });
        } catch (error) {
          const alert =
            error instanceof ChatRequestError && error.alert
              ? error.alert
              : { code: "failed" as const, text: "Could not reach Cadence. Undo did not go through. Try again." };
          setThread((current) => addAlertAfterOutcome(current, outcome.id, alert));
        }
      }),
    [client, withBusy],
  );

  const onConfirm = useCallback(
    (confirm: ChatConfirm, answer: "yes" | "no") =>
      void withBusy(confirm.id, async () => {
        try {
          const response = await client.confirm(confirm.id, answer);
          setThread((current) => applyConfirmResponse(current, response));
        } catch (error) {
          const alert =
            error instanceof ChatRequestError && error.alert
              ? error.alert
              : { code: "failed" as const, text: "Could not reach Cadence. Nothing was changed. Try again." };
          setThread((current) =>
            applyConfirmResponse(current, { confirm, outcomes: [], refusals: [], alert }),
          );
        }
      }),
    [client, withBusy],
  );

  const onAlternative = useCallback(
    (_refusal: ChatRefusal, startTime: string) => send(alternativeMessage(startTime)),
    [send],
  );

  const resetTurnState = useCallback(() => {
    if (runRef.current) {
      runRef.current.controller.abort();
      runRef.current = null;
    }
    announceRef.current = false;
    setAnnouncement("");
    setFailedSend(null);
    setUnsent(null);
    setRestoreFailed(false);
    setShowJump(false);
  }, []);

  const startNew = useCallback(() => {
    resetTurnState();
    setThread(EMPTY_CHAT_THREAD);
    syncConversation(null);
    setView("thread");
  }, [resetTurnState, syncConversation]);

  const openConversation = useCallback(
    async (id: string) => {
      const conversation = await client.getConversation(id);
      resetTurnState();
      followNextRef.current = true;
      setThread(threadFromConversation(conversation));
      syncConversation(id);
      setView("thread");
    },
    [client, resetTurnState, syncConversation],
  );

  const empty = thread.messages.length === 0;
  const wantsStarters = empty && !restoring && starters === null;

  // Starter questions come from the person's own week (no model call). Loaded once,
  // only when an empty conversation is on screen; the client never throws.
  useEffect(() => {
    if (!wantsStarters) return;
    let live = true;
    void client.starters().then((list) => {
      if (live) setStarters(list);
    });
    return () => {
      live = false;
    };
  }, [client, wantsStarters]);

  return (
    <div className="flex min-h-[calc(100dvh-12rem)] w-full flex-col">
      <nav aria-label="Chat" className="flex items-center gap-4 text-sm leading-5 text-muted-readable">
        {view === "thread" && !empty ? (
          <button type="button" className={LINK} onClick={startNew}>
            New conversation
          </button>
        ) : null}
        {view === "thread" ? (
          <button type="button" className={LINK} onClick={() => setView("past")}>
            Past conversations
          </button>
        ) : (
          <button type="button" className={LINK} onClick={() => setView("thread")}>
            Back to chat
          </button>
        )}
      </nav>

      <p className="sr-only" role="status" aria-live="polite" data-chat-run-state={runState}>
        {announcement}
      </p>

      {view === "past" ? (
        <PastConversations client={client} initial={initialConversations} now={now} onOpen={openConversation} />
      ) : (
        <>
          <div className="flex flex-1 flex-col gap-6 pt-6 pb-6">
            {restoring ? <p className="text-sm leading-5 text-muted-readable">Opening your conversation…</p> : null}
            {restoreFailed ? (
              <AlertNotice kind="model_failed" label="Not loaded" variant="inline">
                Could not open that conversation. It is still in Past conversations.
              </AlertNotice>
            ) : null}
            {empty && !restoring ? <ChatOpening starters={starters} onPick={send} disabled={sending} /> : null}
            <ChatMessages
              messages={thread.messages}
              streamingId={thread.streamingId}
              handlers={{ onUndo, onConfirm, onAlternative, busyIds, sending }}
            />
            {failedSend && !sending ? (
              <p className="text-base leading-6">
                <button type="button" className={LINK} onClick={retry}>
                  Send again
                </button>
              </p>
            ) : null}
            <div ref={endRef} />
          </div>
          <ChatComposer
            value={draft}
            onChange={setDraft}
            onSend={() => send(draft)}
            onStop={stop}
            sending={sending}
            locked={restoring}
            unsentAlert={unsent?.alert ?? null}
            showJump={showJump}
            onJump={jumpToLatest}
          />
        </>
      )}
    </div>
  );
}

function setConversationParam(id: string | null) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("c", id);
  else url.searchParams.delete("c");
  url.searchParams.delete("view");
  window.history.replaceState(window.history.state, "", url);
}

function ChatOpening({
  starters,
  onPick,
  disabled,
}: Readonly<{ starters: readonly string[] | null; onPick: (text: string) => void; disabled: boolean }>) {
  return (
    <div className="flex max-w-prose flex-col gap-4 text-base leading-6">
      <p className="text-sm leading-5 text-muted-readable">
        {CHAT_OPENING_LINE}{" "}
        <Link href="/settings" className="underline underline-offset-2 hover:text-foreground">
          Change this in Settings
        </Link>
        .
      </p>
      {/* Three lines are reserved while the person's own starters load, so nothing jumps. */}
      <ul className="flex min-h-[4.75rem] flex-col gap-1" aria-label="Try starting with" aria-busy={starters === null} data-chat-starters={starters === null ? "loading" : "ready"}>
        {(starters ?? []).map((prompt) => (
          <li key={prompt}>
            <button type="button" className={LINK} disabled={disabled} onClick={() => onPick(prompt)}>
              {prompt}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ChatComposer({
  value,
  onChange,
  onSend,
  onStop,
  sending,
  locked,
  unsentAlert,
  showJump,
  onJump,
}: Readonly<{
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  sending: boolean;
  /** True while a requested conversation is opening; Send stays off. */
  locked: boolean;
  unsentAlert: ChatAlert | null;
  showJump: boolean;
  onJump: () => void;
}>) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Grow with the text up to six lines; then scroll inside the field.
  useEffect(() => {
    const field = ref.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, 160)}px`;
  }, [value]);

  // On phones the keyboard shrinks the visual viewport: keep the field and the last line visible.
  useEffect(() => {
    const viewport = typeof window === "undefined" ? null : window.visualViewport;
    if (!viewport) return;
    const keepInView = () => {
      if (document.activeElement === ref.current) ref.current?.scrollIntoView?.({ block: "end" });
    };
    viewport.addEventListener("resize", keepInView);
    return () => viewport.removeEventListener("resize", keepInView);
  }, []);

  const canSend = !locked && value.trim().length > 0;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (sending) onStop();
    else if (canSend) onSend();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (!sending && canSend) onSend();
    } else if (event.key === "Escape" && sending) {
      event.preventDefault();
      onStop();
    }
  };

  return (
    <form
      onSubmit={submit}
      className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-2 border-t border-line bg-background px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:mx-0 sm:px-0"
    >
      {showJump ? (
        <p className="flex justify-end text-sm leading-5 text-muted-readable">
          <button type="button" className={LINK} onClick={onJump}>
            Jump to latest
          </button>
        </p>
      ) : null}
      {unsentAlert ? (
        <div className="text-base leading-6" data-chat-unsent>
          <ChatAlertLine alert={unsentAlert} />
        </div>
      ) : null}
      <label htmlFor="chat-message" className="sr-only">
        Message
      </label>
      <div className="flex items-end gap-3">
        <textarea
          id="chat-message"
          ref={ref}
          rows={1}
          value={value}
          maxLength={CHAT_MESSAGE_MAX_CHARS}
          placeholder="Ask about your day or change a record"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          className="min-h-10 flex-1 resize-none border border-line bg-background px-3 py-2 text-base leading-6 text-foreground placeholder:text-muted-readable focus:outline-2 focus:outline-offset-2"
        />
        <div className="pb-2 text-base leading-6">
          {/* One button that reads Send or Stop, so keyboard focus stays put when a reply ends. */}
          <button
            type="submit"
            className={`font-bold text-foreground ${LINK}`}
            disabled={!sending && !canSend}
            data-chat-action={sending ? "stop" : "send"}
          >
            {sending ? "Stop" : "Send"}
          </button>
        </div>
      </div>
    </form>
  );
}

function PastConversations({
  client,
  initial,
  now,
  onOpen,
}: Readonly<{
  client: ChatClient;
  initial?: readonly ChatConversationSummary[];
  now?: Date;
  onOpen: (id: string) => Promise<void>;
}>) {
  const [items, setItems] = useState<readonly ChatConversationSummary[] | null>(initial ?? null);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);

  const load = useCallback(
    async (before: string | null) => {
      setFailed(false);
      try {
        const page = await client.listConversations(before);
        setItems((current) => (before && current ? [...current, ...page.conversations] : page.conversations));
        setNextBefore(page.nextBefore);
      } catch {
        setFailed(true);
      }
    },
    [client],
  );

  useEffect(() => {
    if (initial) return;
    let live = true;
    client.listConversations(null).then(
      (page) => {
        if (!live) return;
        setItems(page.conversations);
        setNextBefore(page.nextBefore);
      },
      () => {
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [client, initial]);

  const open = async (id: string) => {
    setOpening(id);
    try {
      await onOpen(id);
    } catch {
      setFailed(true);
    } finally {
      setOpening(null);
    }
  };

  return (
    <section aria-labelledby="past-conversations" className="flex max-w-prose flex-col gap-3 pt-6 text-base leading-6">
      <h2 id="past-conversations" className="text-sm uppercase leading-5 tracking-[1px] text-muted-readable">
        Past conversations
      </h2>
      {failed ? (
        <AlertNotice kind="model_failed" label="Not loaded" variant="inline">
          Could not load your conversations. Try again in a moment.
        </AlertNotice>
      ) : null}
      {items === null && !failed ? <p className="text-sm leading-5 text-muted-readable" role="status">Loading…</p> : null}
      {items !== null && items.length === 0 ? (
        <p className="text-sm leading-5 text-muted-readable">No conversations yet.</p>
      ) : null}
      {items !== null && items.length > 0 ? (
        <ul className="flex flex-col divide-y divide-line">
          {items.map((item) => (
            <li key={item.id} className="flex items-baseline justify-between gap-4 py-2">
              <button
                type="button"
                className="min-w-0 truncate py-1 text-left underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
                disabled={opening !== null}
                onClick={() => void open(item.id)}
              >
                {item.title}
              </button>
              <span className="shrink-0 text-sm leading-5 text-muted-readable tabular-nums">
                {conversationDateLabel(item.updatedAt, now)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {nextBefore ? (
        <p>
          <button type="button" className={LINK} onClick={() => void load(nextBefore)}>
            Show older
          </button>
        </p>
      ) : null}
    </section>
  );
}

function newClientMessageId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16),
  );
}
