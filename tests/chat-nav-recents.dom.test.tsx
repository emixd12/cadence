// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "@/components/layout/AppShell";
import { CHAT_FIXTURE_CONVERSATIONS } from "@/app/design-system/chat-fixtures";
import { announceConversationsChanged } from "@/lib/ui/chat";

vi.mock("next/navigation", () => ({
  usePathname: () => "/chat",
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock("next/image", () => ({ default: () => null }));

// Advisor plan Phase 5B: recent chats as a drawer, open on the first visit, under Chat in the side menu.

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.localStorage.clear();
  window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() });
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
const desktopNav = () => container.querySelectorAll("aside")[1]!;

describe("recent chats in the side menu", () => {
  it("starts open on the first visit, lists five recent chats and All conversations, and remembers a close", async () => {
    const load = vi.fn(async () => CHAT_FIXTURE_CONVERSATIONS);
    await act(async () => root.render(<AppShell chatRecentsLoader={load}><p>Page</p></AppShell>));
    await settle();
    const toggle = desktopNav().querySelector('button[aria-controls="chat-nav-recents"]') as HTMLButtonElement;
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const links = Array.from(desktopNav().querySelectorAll("#chat-nav-recents a"));
    expect(links.map((link) => link.textContent)).toEqual([
      ...CHAT_FIXTURE_CONVERSATIONS.slice(0, 5).map((item) => item.title),
      "All conversations",
    ]);
    expect(links[0]!.getAttribute("href")).toBe("/chat?c=conv-today");
    expect(links.at(-1)!.getAttribute("href")).toBe("/chat?view=past");

    await act(async () => toggle.click());
    await settle();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(desktopNav().querySelector("#chat-nav-recents")).toBeNull();
    expect(window.localStorage.getItem("nav-chat-recents-open")).toBe("false");
  });

  it("stays closed once the person has closed it", async () => {
    window.localStorage.setItem("nav-chat-recents-open", "false");
    const load = vi.fn(async () => CHAT_FIXTURE_CONVERSATIONS);
    await act(async () => root.render(<AppShell chatRecentsLoader={load}><p>Page</p></AppShell>));
    await settle();
    expect(desktopNav().querySelector("#chat-nav-recents")).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it("marks the open conversation and reloads when the Chat page starts a new one", async () => {
    let started = false;
    const load = vi.fn(async () => (started ? CHAT_FIXTURE_CONVERSATIONS : CHAT_FIXTURE_CONVERSATIONS.slice(1)));
    await act(async () => root.render(<AppShell chatRecentsLoader={load} defaultChatRecentsOpen><p>Page</p></AppShell>));
    await settle();
    expect(desktopNav().querySelector('[data-chat-recent="conv-today"]')).toBeNull();
    started = true;
    await act(async () => announceConversationsChanged("conv-today"));
    await settle();
    expect(desktopNav().querySelector('[data-chat-recent="conv-today"]')?.getAttribute("aria-current")).toBe("page");
  });
});
