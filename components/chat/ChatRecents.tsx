"use client";

import type { ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { ChatConversationSummary } from "@cadence/core/types/chat";
import { CHAT_CONVERSATIONS_CHANGED_EVENT, type ChatConversationsChangedDetail } from "@/lib/ui/chat";
import { readLocalItem, writeLocalItem } from "@/lib/ui/browser-storage";

// Advisor plan Phase 5B: recent chats as a quiet drawer under the Chat item in the
// side menu. Open on the first visit (Emi, Nov 20) and remembered per browser, so Chat stays one
// menu item among others rather than a column of conversations. Phase 5C: the web menu
// (components/layout/ChatNavRecents.tsx) and the Mac menu (apps/desktop) draw the same list;
// each passes how a row opens its conversation (a page link on web, a screen change on the Mac).

const STORAGE_KEY = "nav-chat-recents-open";
export const CHAT_NAV_RECENT_LIMIT = 5;

export type ChatRecentsLoader = () => Promise<readonly ChatConversationSummary[]>;

/** What a row opens: one conversation, or the list of all of them. */
export type ChatRecentsTarget = Readonly<{ kind: "conversation"; id: string }> | Readonly<{ kind: "past" }>;

export type ChatRecentsLinkProps = Readonly<{
  target: ChatRecentsTarget;
  className: string;
  title?: string;
  current?: boolean;
  children: ReactNode;
}>;

/** Draws one row's link. Web renders a page link; the Mac renders a button that changes screen. */
export type ChatRecentsLinkRenderer = (props: ChatRecentsLinkProps) => ReactNode;

/** The web address for a target (`/chat?c=…` or `/chat?view=past`). */
export function chatRecentsHref(target: ChatRecentsTarget): string {
  return target.kind === "past" ? "/chat?view=past" : `/chat?c=${encodeURIComponent(target.id)}`;
}

function readStoredOpen(): boolean {
  // Open on the first visit; after that, whatever the person last chose.
  return readLocalItem(STORAGE_KEY) !== "false";
}

function storeOpen(open: boolean) {
  // Remembering is a convenience; the drawer still works when the write is refused.
  writeLocalItem(STORAGE_KEY, String(open));
}

/** The arrow button that sits at the right end of the Chat menu row. */
export function ChatRecentsToggle({
  open,
  onToggle,
}: Readonly<{ open: boolean; onToggle: () => void }>) {
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls="chat-nav-recents"
      aria-label={open ? "Hide recent chats" : "Show recent chats"}
      title={open ? "Hide recent chats" : "Show recent chats"}
      onClick={onToggle}
      className="flex h-10 w-10 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <Icon aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
    </button>
  );
}

export function useChatRecentsOpen(initialOpen?: boolean) {
  const [open, setOpen] = useState(initialOpen ?? false);
  useEffect(() => {
    if (initialOpen !== undefined) return;
    const frame = window.requestAnimationFrame(() => setOpen(readStoredOpen()));
    return () => window.cancelAnimationFrame(frame);
  }, [initialOpen]);
  const toggle = useCallback(() => {
    setOpen((current) => {
      storeOpen(!current);
      return !current;
    });
  }, []);
  return [open, toggle] as const;
}

/** Up to five recent chats, then "All conversations". Loads when opened. */
export function ChatRecentsList({
  load,
  renderLink,
  readActiveId,
  activeId: shownId,
  refreshKey,
}: Readonly<{
  load: ChatRecentsLoader;
  renderLink: ChatRecentsLinkRenderer;
  /** The conversation on screen when the list mounts (web reads `?c=`). */
  readActiveId?: () => string | null;
  /** The conversation on screen, when the caller already knows it (the Mac). Wins over the read. */
  activeId?: string | null;
  /** A change reloads the list and reads the active row again (web passes the path). */
  refreshKey?: string;
}>) {
  const [items, setItems] = useState<readonly ChatConversationSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  // The Chat page says when a conversation starts or opens, so the list and the
  // marked row follow without a reload.
  useEffect(() => {
    const readActive = () => {
      if (readActiveId) setActiveId(readActiveId());
    };
    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent<ChatConversationsChangedDetail>).detail;
      setActiveId(detail?.activeId ?? null);
      setVersion((current) => current + 1);
    };
    const frame = window.requestAnimationFrame(readActive);
    window.addEventListener(CHAT_CONVERSATIONS_CHANGED_EVENT, onChanged);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener(CHAT_CONVERSATIONS_CHANGED_EVENT, onChanged);
    };
  }, [readActiveId, refreshKey]);

  useEffect(() => {
    let live = true;
    load().then(
      (conversations) => {
        if (!live) return;
        setItems(conversations.slice(0, CHAT_NAV_RECENT_LIMIT));
        setFailed(false);
      },
      () => {
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [load, version, refreshKey]);

  return (
    <ul id="chat-nav-recents" aria-label="Recent chats" className="mb-2 ml-8 mr-3 flex flex-col border-l border-line text-xs leading-4">
      {failed ? <li className="py-1.5 pl-3 pr-1 text-muted-readable">Could not load recent chats.</li> : null}
      {items === null && !failed ? <li className="py-1.5 pl-3 pr-1 text-muted-readable">Loading…</li> : null}
      {items !== null && items.length === 0 ? (
        <li className="py-1.5 pl-3 pr-1 text-muted-readable">No chats yet.</li>
      ) : null}
      {items?.map((item) => {
        const active = item.id === (shownId !== undefined ? shownId : activeId);
        return (
          <li key={item.id}>
            {renderLink({
              target: { kind: "conversation", id: item.id },
              current: active,
              title: item.title,
              className: [
                "block w-full truncate py-1.5 pl-3 pr-1 text-left transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                active ? "text-foreground" : "text-muted-foreground hover:bg-surface hover:text-foreground",
              ].join(" "),
              children: item.title,
            })}
          </li>
        );
      })}
      {items !== null && items.length > 0 ? (
        <li>
          {renderLink({
            target: { kind: "past" },
            className:
              "block py-1.5 pl-3 pr-1 text-left text-muted-readable underline underline-offset-2 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
            children: "All conversations",
          })}
        </li>
      ) : null}
    </ul>
  );
}
