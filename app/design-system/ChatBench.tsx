"use client";

import { useMemo } from "react";
import { ChatPage } from "@/components/chat/ChatPage";
import { AppShell } from "@/components/layout/AppShell";
import { HorseBanner } from "@/components/layout/HorseBanner";
import { EMPTY_CHAT_THREAD, type ChatThreadState } from "@/lib/ui/chat";
import {
  CHAT_BENCH_STATES,
  CHAT_FIXTURE_BUDGET,
  CHAT_FIXTURE_CONFIRM,
  CHAT_FIXTURE_CONVERSATIONS,
  CHAT_FIXTURE_MEDICAL,
  CHAT_FIXTURE_NOW,
  CHAT_FIXTURE_REFUSAL,
  CHAT_FIXTURE_STOPPED,
  CHAT_FIXTURE_TODAY,
  fixtureChatClient,
  type ChatBenchState,
} from "./chat-fixtures";

// Advisor plan Phase 5B. The Chat page on synthetic conversations, inside the real
// app shell: /design-system?preview=chat&state=<state>. No account, no model call;
// sending, Yes · No and Undo answer in memory.


const THREADS: Record<Exclude<ChatBenchState, "past">, ChatThreadState> = {
  opening: EMPTY_CHAT_THREAD,
  today: CHAT_FIXTURE_TODAY,
  confirm: CHAT_FIXTURE_CONFIRM,
  refusal: CHAT_FIXTURE_REFUSAL,
  medical: CHAT_FIXTURE_MEDICAL,
  budget: CHAT_FIXTURE_BUDGET,
  stopped: CHAT_FIXTURE_STOPPED,
  unsent: CHAT_FIXTURE_TODAY,
};

/** The side menu's recent chats on the bench: the fixture list, newest first. */
const benchRecents = async () => CHAT_FIXTURE_CONVERSATIONS;

export function ChatBenchPage({
  state,
  recentsOpen,
  menuOpen = false,
}: Readonly<{ state: ChatBenchState; recentsOpen?: boolean; menuOpen?: boolean }>) {
  return (
    <AppShell
      user={{ name: "Bench person", email: "bench@example.test" }}
      chatRecentsLoader={benchRecents}
      defaultChatRecentsOpen={recentsOpen}
      defaultMobileNavOpen={menuOpen}
    >
      <div className="flex w-full flex-col">
        <HorseBanner />
        <div className="mx-auto flex w-full max-w-3xl flex-col px-4 sm:px-6 lg:px-10">
          <h1 className="pt-4 text-3xl font-bold leading-tight sm:text-4xl">Chat</h1>
          <nav aria-label="Bench states" className="flex flex-wrap gap-x-3 pt-2 text-sm leading-5 text-muted-readable" data-bench-only>
            {CHAT_BENCH_STATES.map((name) => (
              <a key={name} href={`/design-system?preview=chat&state=${name}`} className={name === state ? "text-foreground" : "underline underline-offset-2"}>
                {name}
              </a>
            ))}
          </nav>
          <div className="pt-4">
            <ChatBench state={state} />
          </div>
        </div>
      </div>
    </AppShell>
  );
}

export function ChatBench({ state = "today" }: Readonly<{ state?: ChatBenchState }>) {
  const client = useMemo(() => fixtureChatClient({ offline: state === "unsent" }), [state]);
  return (
    <ChatPage
      key={state}
      client={client}
      now={CHAT_FIXTURE_NOW}
      initialView={state === "past" ? "past" : "thread"}
      initialThread={state === "past" ? CHAT_FIXTURE_TODAY : THREADS[state]}
      initialConversations={state === "past" ? CHAT_FIXTURE_CONVERSATIONS : undefined}
    />
  );
}
