// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatPage } from "@/components/chat/ChatPage";
import type { ChatEvent } from "@cadence/core/types/chat";
import type { ChatClient } from "@/lib/ui/chat";
import {
  CHAT_FIXTURE_CONFIRM,
  CHAT_FIXTURE_NOW,
  CHAT_FIXTURE_REFUSAL,
  CHAT_FIXTURE_TODAY,
  fixtureChatClient,
} from "@/app/design-system/chat-fixtures";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

// Advisor plan Phase 5B: the web Chat page on the fixture client.

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
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

async function type(text: string) {
  const field = container.querySelector("textarea")!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    setter.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const pressEnter = () =>
  act(async () => container.querySelector("textarea")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 30)));
const button = (name: string) =>
  Array.from(container.querySelectorAll("button")).find((element) => element.textContent?.trim() === name) as HTMLButtonElement | undefined;

describe("Chat page", () => {
  it("opens with the data line and the person's three starter questions, and sends one", async () => {
    const client = fixtureChatClient({ delayMs: 0 });
    const sendTurn = vi.spyOn(client, "sendTurn");
    let resolveStarters: (list: readonly string[]) => void = () => undefined;
    const starters = vi.spyOn(client, "starters").mockReturnValue(new Promise((resolve) => { resolveStarters = resolve; }));
    await act(async () => root.render(<ChatPage client={client} now={CHAT_FIXTURE_NOW} />));
    expect(container.textContent).toContain("Chat can read all of your Cadence data, including notes and connected calendars.");
    expect(container.querySelector('a[href="/settings"]')?.textContent).toBe("Change this in Settings");
    expect(container.querySelector('[aria-label="Try starting with"]')?.getAttribute("data-chat-starters")).toBe("loading");
    expect(container.querySelectorAll('[aria-label="Try starting with"] button')).toHaveLength(0);
    await act(async () => resolveStarters(["Why does Piano practice keep slipping?", "What did I skip this week?", "What should I do next today?"]));
    expect(starters).toHaveBeenCalledTimes(1);
    expect(Array.from(container.querySelectorAll('[aria-label="Try starting with"] button')).map((item) => item.textContent)).toEqual([
      "Why does Piano practice keep slipping?", "What did I skip this week?", "What should I do next today?",
    ]);

    await act(async () => button("What did I skip this week?")!.click());
    await settle();
    expect(sendTurn).toHaveBeenCalledTimes(1);
    expect(sendTurn.mock.calls[0]![0]).toMatchObject({ conversationId: null, message: "What did I skip this week?" });
    expect(container.querySelector('[data-chat-tool="adherence"]')?.textContent).toBe("Looked at this week");
    expect(container.textContent).toContain("You skipped Run on Tuesday");
    expect(container.querySelector('[aria-label="Try starting with"]')).toBeNull();
  });

  it("shows an outcome in italic with Undo, and Undo replaces it", async () => {
    await act(async () => root.render(<ChatPage client={fixtureChatClient({ delayMs: 0 })} initialThread={CHAT_FIXTURE_TODAY} />));
    const outcome = container.querySelector("[data-chat-outcome]")!;
    expect(outcome.className).toContain("italic");
    expect(outcome.querySelector(".not-italic button")?.textContent).toBe("Undo");
    await act(async () => button("Undo")!.click());
    await settle();
    expect(container.querySelector("[data-chat-outcome]")?.textContent).toBe("Undid: Marked Meds done.");
    expect(button("Undo")).toBeUndefined();
  });

  it("asks one Yes · No for every pending write, then lists what ran", async () => {
    await act(async () => root.render(<ChatPage client={fixtureChatClient({ delayMs: 0 })} initialThread={CHAT_FIXTURE_CONFIRM} />));
    expect(container.querySelector('[data-chat-confirm="pending"]')?.textContent).toContain("Make these 2 changes?");
    await act(async () => button("Yes")!.click());
    await settle();
    expect(container.querySelector('[data-chat-confirm="accepted"]')).not.toBeNull();
    expect(button("Yes")).toBeUndefined();
    expect(Array.from(container.querySelectorAll("[data-chat-outcome]")).map((element) => element.textContent)).toEqual([
      "Changed Run to Monday, Wednesday and Friday.",
      "Moved today’s Run to 6:00 PM. Undo",
    ]);
  });

  it("shows a refusal as one red sentence and sends a picked time as a message", async () => {
    const client = fixtureChatClient({ delayMs: 0 });
    const sendTurn = vi.spyOn(client, "sendTurn");
    await act(async () => root.render(<ChatPage client={client} initialThread={CHAT_FIXTURE_REFUSAL} />));
    const alert = container.querySelector('[data-alert-kind="write_refused"]')!;
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.querySelector("p")?.textContent).toBe("Not changed. Your 7:00 PM has Team dinner on your calendar.");
    await act(async () => button("5:30 PM")!.click());
    await settle();
    expect(sendTurn.mock.calls[0]![0]).toMatchObject({ conversationId: "conv-refusal", message: "Move it to 5:30 PM" });
  });

  it("puts the words back in the box when the server never took the message, and resends with the same id", async () => {
    const sendTurn = vi.fn<ChatClient["sendTurn"]>(async () => {
      throw new TypeError("network");
    });
    const client: ChatClient = { ...fixtureChatClient({ delayMs: 0 }), sendTurn };
    await act(async () => root.render(<ChatPage client={client} />));
    await type("Mark meds done");
    await pressEnter();
    await settle();
    const field = container.querySelector("textarea")!;
    expect(field.value).toBe("Mark meds done");
    expect(container.querySelectorAll('[data-chat-role="user"]')).toHaveLength(0);
    expect(container.querySelector("[data-chat-unsent]")?.textContent).toBe("Not answered. Could not reach Cadence. Your message was not answered.");
    await pressEnter();
    await settle();
    expect(sendTurn.mock.calls[1]![0].clientMessageId).toBe(sendTurn.mock.calls[0]![0].clientMessageId);
  });

  it("keeps a partial reply after the connection drops mid-stream, and Send again replays the same id", async () => {
    const sendTurn = vi.fn(async (request: { clientMessageId: string }, onEvent: (event: ChatEvent) => void) => {
      onEvent({ type: "start", conversationId: "c1", userMessageId: "u1", messageId: "r1", protocol: "1" });
      onEvent({ type: "text", delta: "Meds is at 8:00 AM and" });
      if (sendTurn.mock.calls.length === 1) throw new TypeError("network");
      onEvent({ type: "text", delta: " Walk is at noon." });
      onEvent({ type: "done", messageId: "r1" } as ChatEvent);
    });
    const client: ChatClient = { ...fixtureChatClient({ delayMs: 0 }), sendTurn };
    await act(async () => root.render(<ChatPage client={client} />));
    await type("What is on today?");
    await pressEnter();
    await settle();
    expect(container.textContent).toContain("Meds is at 8:00 AM and");
    expect(container.textContent).toContain("Not answered. Could not reach Cadence.");
    expect(container.querySelector("[data-chat-run-state]")?.getAttribute("data-chat-run-state")).toBe("failed");
    await act(async () => button("Send again")!.click());
    await settle();
    expect(sendTurn.mock.calls[1]![0].clientMessageId).toBe(sendTurn.mock.calls[0]![0].clientMessageId);
    expect(container.querySelectorAll('[data-chat-role="user"]')).toHaveLength(1);
    // The replayed reply replaces the partial one instead of streaming into a copy.
    expect(container.querySelectorAll('[data-chat-role="assistant"]')).toHaveLength(1);
    expect(container.textContent?.split("Meds is at 8:00 AM and")).toHaveLength(2);
    expect(container.textContent).not.toContain("Could not reach Cadence.");
  });

  it("Stop ends the reply, keeps what streamed, and asks the server to stop", async () => {
    const client = fixtureChatClient({ delayMs: 40 });
    const stop = vi.spyOn(client, "stop");
    const sendTurn = vi.spyOn(client, "sendTurn");
    await act(async () => root.render(<ChatPage client={client} />));
    await type("What did I skip this week?");
    await pressEnter();
    await act(() => new Promise((resolve) => setTimeout(resolve, 150)));
    const action = container.querySelector("[data-chat-action]") as HTMLButtonElement;
    expect(action.textContent).toBe("Stop");
    await act(async () => action.click());
    await settle();
    expect(stop).toHaveBeenCalledWith(sendTurn.mock.calls[0]![0].clientMessageId);
    expect(container.querySelector('[data-chat-notice="stopped"]')?.textContent).toBe("Stopped.");
    expect(container.querySelector('[data-chat-tool="adherence"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Everything else is done");
    expect(container.querySelector("[data-chat-action]")?.textContent).toBe("Send");
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Stopped.");
  });

  it("does not pull the page down while the person reads earlier lines, and offers Jump to latest", async () => {
    const client = fixtureChatClient({ delayMs: 30 });
    await act(async () => root.render(<ChatPage client={client} initialThread={CHAT_FIXTURE_TODAY} />));
    await type("What did I skip this week?");
    await pressEnter();
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    // The person scrolls up: the end of the page is now far below the screen.
    Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, value: 5000 });
    await act(async () => window.dispatchEvent(new Event("scroll")));
    const scrolls = (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mock.calls.length;
    await act(() => new Promise((resolve) => setTimeout(resolve, 200)));
    expect((Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mock.calls.length).toBe(scrolls);
    await act(async () => button("Jump to latest")!.click());
    expect((Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mock.calls.length).toBe(scrolls + 1);
    expect(button("Jump to latest")).toBeUndefined();
    Reflect.deleteProperty(document.documentElement, "scrollHeight");
    await settle();
  });

  it("announces the finished answer and records the conversation in the address", async () => {
    const replaceState = vi.spyOn(window.history, "replaceState");
    await act(async () => root.render(<ChatPage client={fixtureChatClient({ delayMs: 0 })} syncUrl />));
    await type("What is on today?");
    await pressEnter();
    await settle();
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Cadence answered.");
    expect(String(replaceState.mock.calls.at(-1)?.[2])).toContain("c=bench-conv");
  });

  it("reopens the conversation named in the address after a reload", async () => {
    const fixture = fixtureChatClient({ delayMs: 0 });
    let open!: () => void;
    const opened = new Promise<void>((resolve) => { open = resolve; });
    const getConversation = vi.fn(async (id: string) => { await opened; return fixture.getConversation(id); });
    const sendTurn = vi.spyOn(fixture, "sendTurn");
    const client: ChatClient = { ...fixture, getConversation, sendTurn };
    await act(async () => root.render(<ChatPage client={client} syncUrl initialConversationId="conv-refusal" />));
    expect(container.textContent).toContain("Opening your conversation…");
    // Send stays off until the conversation is open, so a message cannot start a new one.
    await type("Is that still on?");
    expect((container.querySelector('[data-chat-action="send"]') as HTMLButtonElement).disabled).toBe(true);
    await pressEnter();
    expect(sendTurn).not.toHaveBeenCalled();
    await act(async () => open());
    await settle();
    expect(container.textContent).toContain("Your 7:00 PM has Team dinner on your calendar.");
    expect(container.querySelector('[aria-label="Try starting with"]')).toBeNull();
  });

  it("lists past conversations newest first and opens one", async () => {
    await act(async () => root.render(<ChatPage client={fixtureChatClient({ delayMs: 0 })} now={CHAT_FIXTURE_NOW} />));
    await act(async () => button("Past conversations")!.click());
    await settle();
    const rows = Array.from(container.querySelectorAll("#past-conversations + ul li, section ul li"));
    expect(rows[0]?.textContent).toContain("What is on today?");
    expect(rows[0]?.textContent).toContain("Today");
    await act(async () => button("Move my run to 7 tonight")!.click());
    await settle();
    expect(container.textContent).toContain("Your 7:00 PM has Team dinner on your calendar.");
  });
});
