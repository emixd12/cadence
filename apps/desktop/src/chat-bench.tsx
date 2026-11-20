import { useMemo, useState } from "react";
import {
  CHAT_FIXTURE_BUDGET,
  CHAT_FIXTURE_CONFIRM,
  CHAT_FIXTURE_CONVERSATIONS,
  CHAT_FIXTURE_MEDICAL,
  CHAT_FIXTURE_NOW,
  CHAT_FIXTURE_REFUSAL,
  CHAT_FIXTURE_STOPPED,
  CHAT_FIXTURE_TODAY,
  fixtureChatClient,
  parseChatBenchState,
  type ChatBenchState,
} from "@/app/design-system/chat-fixtures";
import type { ChatThreadState } from "@/lib/ui/chat";
import { DesktopApp, type DesktopScreen } from "./desktop-app";
import { ChatScreen, type DesktopChatTarget } from "./chat-screen";

const THREADS: Partial<Record<ChatBenchState, ChatThreadState>> = {
  today: CHAT_FIXTURE_TODAY,
  confirm: CHAT_FIXTURE_CONFIRM,
  refusal: CHAT_FIXTURE_REFUSAL,
  medical: CHAT_FIXTURE_MEDICAL,
  budget: CHAT_FIXTURE_BUDGET,
  stopped: CHAT_FIXTURE_STOPPED,
};

/**
 * Advisor plan Phase 5C: the Mac Chat screen in the Mac shell with fixture data
 * (`?bench=chat&state=…`, same states as the web bench). Nothing reaches a server.
 */
export function ChatBench() {
  const state = parseChatBenchState(new URLSearchParams(window.location.search).get("state"));
  const client = useMemo(() => fixtureChatClient(), []);
  const [target, setTarget] = useState<{ target: DesktopChatTarget; request: number }>({
    target: state === "past" ? { kind: "past" } : { kind: "new" },
    request: 0,
  });
  const [message, setMessage] = useState("");
  const thread = target.request === 0 ? THREADS[state] : undefined;
  return (
    <DesktopApp
      activeScreen="chat"
      availableScreens={["timeline", "chat", "behaviors", "export", "settings"]}
      account={{ status: "linked", userId: "fixture", email: "owner@example.test", name: "Cadence User" }}
      onNavigate={(screen: DesktopScreen) => setMessage(`Fixture navigation: ${screen}`)}
      chat={{
        load: async () => CHAT_FIXTURE_CONVERSATIONS,
        activeId: thread ? "conv-today" : null,
        onOpen: (picked) =>
          setTarget((current) => ({
            target: picked.kind === "past" ? { kind: "past" } : { kind: "conversation", id: picked.id },
            request: current.request + 1,
          })),
      }}
    >
      {message ? <p role="status" className="sr-only">{message}</p> : null}
      <ChatScreen
        client={client}
        target={target.target}
        openRequest={target.request}
        onOpenSettings={() => setMessage("Fixture navigation: settings")}
        bench={{ thread, conversations: state === "past" ? CHAT_FIXTURE_CONVERSATIONS : undefined, now: CHAT_FIXTURE_NOW }}
      />
    </DesktopApp>
  );
}
