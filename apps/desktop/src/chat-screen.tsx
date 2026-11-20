import { ChatPage } from "@/components/chat/ChatPage";
import type { ChatConversationSummary } from "@cadence/core/types/chat";
import { CHAT_SETTINGS_LINK_CLASS, type ChatClient, type ChatThreadState } from "@/lib/ui/chat";

/** What the Chat screen opens with: a new conversation, one from the menu, or the list. */
export type DesktopChatTarget =
  | Readonly<{ kind: "new" }>
  | Readonly<{ kind: "conversation"; id: string }>
  | Readonly<{ kind: "past" }>;

/**
 * Advisor plan Phase 5C: the Mac's Chat screen. The same page as web
 * (components/chat/ChatPage.tsx) in the web page's frame. The Mac keeps the open
 * conversation in memory instead of `?c=`; the menu's recent chats pass it in.
 */
export function ChatScreen({
  client,
  target,
  openRequest,
  onOpenSettings,
  bench,
}: Readonly<{
  client: ChatClient;
  target: DesktopChatTarget;
  /** Changes on every menu pick, so picking the same row again starts it fresh. */
  openRequest: number;
  onOpenSettings: () => void;
  /** Bench only (`?bench=chat`): a fixture conversation, list and clock. */
  bench?: Readonly<{ thread?: ChatThreadState; conversations?: readonly ChatConversationSummary[]; now?: Date }>;
}>) {
  const conversationId = target.kind === "conversation" ? target.id : undefined;
  return (
    <div className="flex w-full flex-col">
      <div className="w-full overflow-hidden bg-background pt-1">
        {/* Native builds bundle this image without a Next server. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/cadence-page-banner-lines-dots.png" width={1965} height={64} alt="" aria-hidden="true" className="block h-auto w-full" />
      </div>
      <div className="mx-auto flex w-full max-w-3xl flex-col px-4 sm:px-6 lg:px-10">
        <h1 className="pt-4 text-3xl font-bold leading-tight sm:text-4xl">Chat</h1>
        <div className="pt-4">
          <ChatPage
            key={`${target.kind}:${conversationId ?? ""}:${openRequest}`}
            client={client}
            initialConversationId={conversationId}
            initialView={target.kind === "past" ? "past" : "thread"}
            initialThread={bench?.thread}
            initialConversations={bench?.conversations}
            now={bench?.now}
            settingsLink={
              <button type="button" className={CHAT_SETTINGS_LINK_CLASS} onClick={onOpenSettings}>
                Change this in Settings
              </button>
            }
          />
        </div>
      </div>
    </div>
  );
}
