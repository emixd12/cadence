// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatEvent } from "@cadence/core/types/chat";
import type { ChatClient } from "@/lib/ui/chat";
import { CHAT_FIXTURE_CONVERSATIONS, MEDS_OUTCOME, fixtureChatClient } from "@/app/design-system/chat-fixtures";
import { DesktopApp, type DesktopChatNav } from "../apps/desktop/src/desktop-app";
import { ChatScreen } from "../apps/desktop/src/chat-screen";
import { INTERRUPTED_TURN_SYNC_DELAYS_MS, createDesktopChatClient, desktopChatFetch, withAccountWrites } from "../apps/desktop/src/chat";

// Advisor plan Phase 5C: Chat on Cadence for Mac.

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 40)));
const linked = { status: "linked", userId: "hosted", email: "owner@example.test", name: "Cadence User" } as const;
const desktopNav = () => container.querySelector('aside[aria-label="Desktop navigation"]')!;
const navLabels = () => Array.from(desktopNav().querySelectorAll('nav[aria-label="Primary"] > *')).map((node) => node.textContent?.trim());

function chatNav(overrides: Partial<DesktopChatNav> = {}): DesktopChatNav {
  return { load: vi.fn(async () => CHAT_FIXTURE_CONVERSATIONS), onOpen: vi.fn(), activeId: null, ...overrides };
}

describe("Chat in the Mac menu", () => {
  it("has no Chat item on a Mac without Chat (local profile, or not linked)", async () => {
    await act(async () => root.render(<DesktopApp activeScreen="timeline" onNavigate={vi.fn()}>Content</DesktopApp>));
    expect(navLabels()).toEqual(["Timeline", "Behaviors", "Export & Import", "Settings"]);
  });

  it("shows Chat after Timeline on a linked Mac, with recent chats that open on the Chat screen", async () => {
    const nav = chatNav();
    const onNavigate = vi.fn();
    await act(async () =>
      root.render(
        <DesktopApp activeScreen="timeline" onNavigate={onNavigate} account={linked} chat={nav}
          availableScreens={["timeline", "chat", "behaviors", "export", "settings"]}>Content</DesktopApp>,
      ),
    );
    await settle();
    expect(navLabels()[0]).toBe("Timeline");
    expect(navLabels()[1]).toContain("Chat");
    const items = Array.from(desktopNav().querySelectorAll<HTMLButtonElement>("#chat-nav-recents button"));
    expect(items.map((item) => item.textContent)).toEqual([
      ...CHAT_FIXTURE_CONVERSATIONS.slice(0, 5).map((item) => item.title),
      "All conversations",
    ]);
    await act(async () => items[0]!.click());
    expect(nav.onOpen).toHaveBeenCalledWith({ kind: "conversation", id: CHAT_FIXTURE_CONVERSATIONS[0]!.id });
    await act(async () => items.at(-1)!.click());
    expect(nav.onOpen).toHaveBeenLastCalledWith({ kind: "past" });

    const chatButton = Array.from(desktopNav().querySelectorAll<HTMLButtonElement>("button")).find((b) => b.getAttribute("aria-label") === "Chat")!;
    await act(async () => chatButton.click());
    expect(onNavigate).toHaveBeenCalledWith("chat", undefined);
  });

  it("marks the open conversation while the Chat screen is showing", async () => {
    const id = CHAT_FIXTURE_CONVERSATIONS[1]!.id;
    await act(async () =>
      root.render(
        <DesktopApp activeScreen="chat" onNavigate={vi.fn()} account={linked} chat={chatNav({ activeId: id })}
          availableScreens={["timeline", "chat", "behaviors", "export", "settings"]}>Content</DesktopApp>,
      ),
    );
    await settle();
    const current = desktopNav().querySelector('#chat-nav-recents [aria-current="page"]');
    expect(current?.getAttribute("data-chat-recent")).toBe(id);
  });
});

describe("the Mac Chat screen", () => {
  it("opens with the starter questions and sends Change this in Settings to the Mac's Settings screen", async () => {
    const onOpenSettings = vi.fn();
    await act(async () =>
      root.render(<ChatScreen client={fixtureChatClient({ delayMs: 0 })} target={{ kind: "new" }} openRequest={0} onOpenSettings={onOpenSettings} />),
    );
    await settle();
    expect(container.querySelector("h1")?.textContent).toBe("Chat");
    expect(container.querySelector('[data-chat-starters="ready"]')?.querySelectorAll("button").length).toBeGreaterThan(0);
    // No web link: the Mac webview has no /settings page.
    expect(container.querySelector('a[href="/settings"]')).toBeNull();
    const settings = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Change this in Settings")!;
    await act(async () => settings.click());
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it("opens a conversation the menu picked", async () => {
    const client = fixtureChatClient({ delayMs: 0 });
    const getConversation = vi.spyOn(client, "getConversation");
    await act(async () =>
      root.render(<ChatScreen client={client} target={{ kind: "conversation", id: "conv-today" }} openRequest={1} onOpenSettings={vi.fn()} />),
    );
    await settle();
    expect(getConversation).toHaveBeenCalledWith("conv-today");
  });

  it("opens the list of past conversations", async () => {
    await act(async () =>
      root.render(<ChatScreen client={fixtureChatClient({ delayMs: 0 })} target={{ kind: "past" }} openRequest={1} onOpenSettings={vi.fn()} />),
    );
    await settle();
    expect(container.querySelector("#past-conversations")?.textContent).toBe("Past conversations");
  });
});

describe("the Mac chat client", () => {
  it("calls the hosted origin with the Mac's bearer session, no cookies and no redirects", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 200 }));
    const send = desktopChatFetch("https://cadence.example", async () => "token-1", fetcher as unknown as typeof fetch);
    await send("/api/advisor/chat/conversations", { headers: { Accept: "application/json" } });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://cadence.example/api/advisor/chat/conversations");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer token-1");
    expect(new Headers(init.headers).get("Accept")).toBe("application/json");
    expect(init.credentials).toBe("omit");
    expect(init.redirect).toBe("error");
  });

  it("has no client without a hosted origin", () => {
    const supabase = { auth: { getSession: async () => ({ data: { session: null } }) } } as never;
    expect(createDesktopChatClient(supabase, vi.fn(), null)).toBeNull();
  });

  it("asks account sync to run after a turn, Yes or Undo that changed records, and only then", async () => {
    const start: ChatEvent = { type: "start", conversationId: "c1", userMessageId: "u1", messageId: "m1", protocol: 1 as never };
    const events: ChatEvent[] = [start, { type: "text", delta: "Done." }, { type: "done", messageId: "m1" }];
    const base: ChatClient = {
      ...fixtureChatClient({ delayMs: 0 }),
      sendTurn: async (_request, onEvent) => events.forEach(onEvent),
      confirm: async (confirmId) => ({ confirm: { id: confirmId } as never, outcomes: [], refusals: [] }),
      undo: async () => ({ outcome: MEDS_OUTCOME }),
    };
    const onAccountWrite = vi.fn();
    const client = withAccountWrites(base, onAccountWrite);
    const request = { conversationId: null, message: "hi", clientMessageId: "00000000-0000-4000-8000-000000000001" };

    await client.sendTurn(request, vi.fn());
    expect(onAccountWrite).not.toHaveBeenCalled();

    events.splice(2, 0, { type: "outcome", outcome: MEDS_OUTCOME }, { type: "outcome", outcome: MEDS_OUTCOME });
    const seen = vi.fn();
    await client.sendTurn(request, seen);
    expect(seen).toHaveBeenCalledTimes(5);
    expect(onAccountWrite).toHaveBeenCalledTimes(1);

    await client.confirm("confirm-1", "no");
    expect(onAccountWrite).toHaveBeenCalledTimes(1);

    await client.undo(MEDS_OUTCOME.id);
    expect(onAccountWrite).toHaveBeenCalledTimes(2);
  });

  it("still syncs when a turn that already wrote is stopped or drops", async () => {
    const onAccountWrite = vi.fn();
    const scheduled: number[] = [];
    const client = withAccountWrites(
      {
        ...fixtureChatClient({ delayMs: 0 }),
        sendTurn: async (_request, onEvent) => {
          onEvent({ type: "outcome", outcome: MEDS_OUTCOME });
          throw new Error("connection dropped");
        },
      },
      onAccountWrite,
      (_run, delay) => scheduled.push(delay),
    );
    await expect(
      client.sendTurn({ conversationId: null, message: "hi", clientMessageId: "00000000-0000-4000-8000-000000000002" }, vi.fn()),
    ).rejects.toThrow("connection dropped");
    expect(onAccountWrite).toHaveBeenCalledOnce();
    // Never started on the server: nothing can land later.
    expect(scheduled).toEqual([]);
  });

  it("syncs again later when the Mac stops listening to a turn the server took (it keeps running)", async () => {
    const onAccountWrite = vi.fn();
    const scheduled: Array<{ run: () => void; delay: number }> = [];
    const client = withAccountWrites(
      {
        ...fixtureChatClient({ delayMs: 0 }),
        sendTurn: async (_request, onEvent) => {
          onEvent({ type: "start", conversationId: "c1", userMessageId: "u1", messageId: "m1", protocol: 1 as never });
          throw new DOMException("aborted", "AbortError");
        },
      },
      onAccountWrite,
      (run, delay) => scheduled.push({ run, delay }),
    );
    await expect(
      client.sendTurn({ conversationId: null, message: "mark meds done", clientMessageId: "00000000-0000-4000-8000-000000000003" }, vi.fn()),
    ).rejects.toThrow("aborted");
    expect(onAccountWrite).toHaveBeenCalledOnce();
    expect(scheduled.map((item) => item.delay)).toEqual(INTERRUPTED_TURN_SYNC_DELAYS_MS);
    scheduled.forEach((item) => item.run());
    expect(onAccountWrite).toHaveBeenCalledTimes(1 + INTERRUPTED_TURN_SYNC_DELAYS_MS.length);
  });
});
