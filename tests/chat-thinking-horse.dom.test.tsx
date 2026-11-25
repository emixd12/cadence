// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ChatMessage, ChatPart } from "@cadence/core/types/chat";
import { ChatMessages, type ChatMessageHandlers } from "@/components/chat/ChatMessages";

const handlers: ChatMessageHandlers = {
  onUndo: () => {},
  onConfirm: () => {},
  onAlternative: () => {},
  busyIds: new Set(),
  sending: true,
};

const user: ChatMessage = { id: "u1", role: "user", createdAt: "2026-11-25T12:00:00.000Z", parts: [{ type: "text", text: "How did my week go?" }] };
const reply = (parts: readonly ChatPart[]): ChatMessage => ({ id: "a1", role: "assistant", createdAt: "2026-11-25T12:00:01.000Z", parts });
const tool: ChatPart = { type: "tool", tool: { id: "t1", subject: "timeline", text: "Looked at your Timeline", state: "done" } };

describe("Chat thinking horse", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = (messages: readonly ChatMessage[], streamingId: string | null) =>
    act(() => root.render(<ChatMessages messages={messages} streamingId={streamingId} handlers={handlers} />));
  const horse = () => container.querySelector("[data-chat-thinking]");

  it("runs before the reply starts", () => {
    render([user], "pending-reply:c1");
    expect(horse()).not.toBeNull();
    expect(container.textContent).toContain("Reading your question…");
  });

  it("keeps running after tool lines until words arrive", () => {
    render([user, reply([tool])], "a1");
    expect(horse()).not.toBeNull();
    expect(container.textContent).toContain("Working on your answer…");

    render([user, reply([tool, { type: "text", text: "A steady week." }])], "a1");
    expect(horse()).toBeNull();
  });

  it("shows the newest action and opens to list them all", () => {
    const second: ChatPart = { type: "tool", tool: { id: "t2", subject: "adherence", text: "Looked at this week", state: "done" } };
    render([user, reply([tool, second])], "a1");
    const toggle = container.querySelector<HTMLButtonElement>("[data-chat-tools-toggle]");
    expect(toggle?.textContent).toContain("Looked at this week");
    expect(toggle?.textContent).not.toContain("Looked at your Timeline");
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    expect(horse()?.closest("[data-chat-tools]")).not.toBeNull();
    expect(container.querySelector("ul")?.hidden).toBe(true);

    act(() => toggle?.click());
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector("ul")?.hidden).toBe(false);
    expect([...container.querySelectorAll("li[data-chat-tool]")].map((item) => item.textContent)).toEqual([
      "Looked at your Timeline",
      "Looked at this week",
    ]);
  });

  it("keeps the newest action as the label while the list is open", () => {
    render([user, reply([tool, { type: "text", text: "A steady week." }])], null);
    const toggle = container.querySelector<HTMLButtonElement>("[data-chat-tools-toggle]");
    expect(toggle?.textContent).toBe("Looked at your Timeline");
    act(() => toggle?.click());
    expect(toggle?.textContent).toBe("Looked at your Timeline");
    expect(container.querySelector('li[data-chat-tool="timeline"]')?.textContent).toBe("Looked at your Timeline");
  });

  it("stops when the reply ends and keeps the streamed words", () => {
    render([user, reply([tool, { type: "text", text: "A steady week." }])], "a1");
    render([user, reply([tool, { type: "text", text: "A steady week." }])], null);
    expect(horse()).toBeNull();
    expect(container.querySelector('[data-chat-role="assistant"] p.whitespace-pre-wrap')?.textContent).toBe("A steady week.");
  });

  it("shows a reopened reply as plain text", () => {
    render([user, reply([{ type: "text", text: "A steady week." }])], null);
    expect(container.querySelector('[data-chat-role="assistant"] p.whitespace-pre-wrap span')).toBeNull();
  });
});
