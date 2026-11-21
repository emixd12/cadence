"use client";

import Link from "next/link";
import { useCallback } from "react";
import {
  ChatRecentsList,
  chatRecentsHref,
  type ChatRecentsLinkProps,
  type ChatRecentsLoader,
} from "@/components/chat/ChatRecents";

export {
  CHAT_NAV_RECENT_LIMIT,
  ChatRecentsToggle,
  useChatRecentsOpen,
  type ChatRecentsLoader,
} from "@/components/chat/ChatRecents";

// Advisor plan Phase 5B: the web side menu's recent chats. Each row is a page link
// (`/chat?c=…`); the shared list lives in components/chat/ChatRecents.tsx (the Mac uses it too).

function readWebActiveId(): string | null {
  const url = new URL(window.location.href);
  return url.pathname === "/chat" ? url.searchParams.get("c") : null;
}

/** Up to five recent chats, then "All conversations". Loads when opened. */
export function ChatNavRecents({
  load,
  pathname,
  onNavigate,
}: Readonly<{
  load: ChatRecentsLoader;
  pathname: string;
  onNavigate?: () => void;
}>) {
  const renderLink = useCallback(
    ({ target, className, title, current, children }: ChatRecentsLinkProps) => (
      <Link
        href={chatRecentsHref(target)}
        aria-current={current ? "page" : undefined}
        title={title}
        onClick={onNavigate}
        data-chat-recent={target.kind === "conversation" ? target.id : undefined}
        className={className}
      >
        {children}
      </Link>
    ),
    [onNavigate],
  );
  return <ChatRecentsList load={load} renderLink={renderLink} readActiveId={readWebActiveId} refreshKey={pathname} />;
}
