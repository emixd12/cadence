// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DailyBriefing } from "@cadence/core/types/daily-brief";
import { DailyBriefBubble } from "@/components/briefing/DailyBriefBubble";
import { ChatGptPlanCard } from "@/components/briefing/ChatGptPlanCard";
import { ChatGptPlanSettings } from "../apps/desktop/src/chatgpt/chatgpt-plan-settings";
import { SettingsScreen, type SettingsScreenProps } from "../apps/desktop/src/settings-screen";
import type { ChatGptConnectionStatus } from "../apps/desktop/src/chatgpt/connection";

// Ticket 299: the "Use your ChatGPT plan" card, its gating and the Daily Brief plan states.
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });
const flush = () => act(async () => { for (let i = 0; i < 4; i += 1) await Promise.resolve(); });
const button = (name: string) => [...container.querySelectorAll("button")].find((element) => element.textContent === name);
const noop = () => undefined;

const settingsProps: SettingsScreenProps = {
  currentTimezone: "America/New_York", accountConnected: true, updateTimezoneAction: async (state) => state,
  permission: "authorized", coverage: null, busy: false, onRequestPermission: noop, onReconcile: noop, onShowOnboarding: noop,
  dailyBriefControls: <p>Daily Brief controls</p>,
};

describe("ChatGPT plan gating", () => {
  it("renders no card and no ChatGPT copy when the switch is off", async () => {
    await act(() => root.render(<SettingsScreen {...settingsProps} />));
    expect(container.textContent).not.toContain("ChatGPT");
    expect(container.querySelector("#chatgpt-plan")).toBeNull();
  });

  it("renders the card in Planning when the switch passes it", async () => {
    await act(() => root.render(<SettingsScreen {...settingsProps} chatGptPlanControls={<ChatGptPlanCard state="disconnected"
      onConnect={noop} onCancel={noop} onDisconnect={noop} onManageUsage={noop} onConfirm={noop} />} />));
    const card = container.querySelector("#settings-planning #chatgpt-plan")!;
    expect(card.querySelector("h3, h2, h4")?.textContent).toBe("Use your ChatGPT plan");
    const connect = button("Continue with ChatGPT")!;
    expect(connect.hasAttribute("data-oai-siwc-button")).toBe(true);
  });
});

describe("Use your ChatGPT plan card", () => {
  function connection(states: ChatGptConnectionStatus[]) {
    return { status: vi.fn(async () => states.shift() ?? { state: "disconnected" as const, email: null }), cancelConnect: vi.fn(async () => undefined),
      disconnect: vi.fn(async () => "revoked" as const) };
  }
  const memoryFlag = () => { let value = false; return { read: () => value, write: () => { value = true; } }; };

  it("connects, shows the one-time confirmation, then the connected state with Manage usage and Disconnect", async () => {
    const native = connection([{ state: "disconnected", email: null }]);
    const openUsage = vi.fn();
    let finish: (value: ChatGptConnectionStatus) => void = noop;
    const connect = vi.fn(() => new Promise<ChatGptConnectionStatus>((resolve) => { finish = resolve; }));
    const flag = memoryFlag();
    await act(() => root.render(<ChatGptPlanSettings connection={native} connect={connect} openUsage={openUsage} confirmed={flag} />));
    await flush();
    await act(async () => button("Continue with ChatGPT")!.click());
    expect(container.textContent).toContain("Finish signing in to ChatGPT in your browser.");
    await act(async () => button("Cancel ChatGPT sign-in")!.click());
    expect(native.cancelConnect).toHaveBeenCalledOnce();
    await act(async () => finish({ state: "connectedWithPlanUsage", email: "person@example.test" }));
    await flush();
    expect(container.textContent).toContain("You’re using your ChatGPT plan");
    expect(container.textContent).toContain("person@example.test");
    expect(container.textContent).toContain("Using ChatGPT plan");
    await act(async () => button("Got it")!.click());
    expect(container.textContent).not.toContain("You’re using your ChatGPT plan");
    expect(flag.read()).toBe(true);
    await act(async () => button("Manage usage")!.click());
    expect(openUsage).toHaveBeenCalledOnce();
    await act(async () => button("Disconnect ChatGPT")!.click());
    await flush();
    expect(native.disconnect).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("ChatGPT is disconnected.");
    expect(button("Continue with ChatGPT")).toBeDefined();
  });

  it("does not repeat the confirmation once confirmed, and shows plan usage off and reconnect", async () => {
    const flag = memoryFlag();
    flag.write();
    await act(() => root.render(<ChatGptPlanSettings connection={connection([{ state: "connectedWithPlanUsage", email: "a@example.test" }])} connect={vi.fn()} openUsage={noop} confirmed={flag} />));
    await flush();
    expect(container.textContent).not.toContain("You’re using your ChatGPT plan");
    for (const [state, text] of [["connectedWithoutPlanUsage", "Plan usage is off."], ["needsReconnect", "Reconnect ChatGPT to use your plan."]] as const) {
      await act(() => root.render(<ChatGptPlanCard state={state} email="a@example.test" onConnect={noop} onCancel={noop} onDisconnect={noop} onManageUsage={noop} onConfirm={noop} />));
      expect(container.textContent).toContain(text);
      expect(button("Continue with ChatGPT")).toBeDefined();
      expect(button("Disconnect ChatGPT")).toBeDefined();
    }
  });
});

describe("Daily Brief plan states", () => {
  const briefing = { text: "Take time for your walk.", localDate: "2026-11-12", timezone: "America/New_York", generatedAt: "2026-11-12T13:00:00Z",
    expiresAt: "2026-11-12T23:00:00Z", warnings: [], suggestions: [], occurrenceRefs: [] } as unknown as DailyBriefing;

  it("shows Using ChatGPT plan with Manage usage, and plan usage off with Continue with ChatGPT", async () => {
    const manage = vi.fn();
    await act(() => root.render(<DailyBriefBubble state="ready" briefing={briefing} onDismiss={noop} plan={{ usage: "plan", onManageUsage: manage, onConnect: noop }} />));
    expect(container.textContent).toContain("Using ChatGPT plan");
    await act(async () => button("Manage usage")!.click());
    expect(manage).toHaveBeenCalledOnce();
    await act(() => root.render(<DailyBriefBubble state="ready" briefing={briefing} onDismiss={noop} plan={{ usage: "plan_off", onManageUsage: noop, onConnect: noop }} />));
    expect(container.textContent).toContain("ChatGPT plan usage is off");
    expect(button("Continue with ChatGPT")).toBeDefined();
    await act(() => root.render(<DailyBriefBubble state="ready" briefing={briefing} onDismiss={noop} />));
    expect(container.textContent).not.toContain("ChatGPT");
  });

  it("makes Manage usage the primary action of the usage-limit notice", async () => {
    await act(() => root.render(<DailyBriefBubble state="error" message="ChatGPT usage limit reached." onDismiss={noop}
      action={{ label: "Manage usage", onClick: noop }} onRetry={noop} retryLabel="Try again" />));
    const actions = [...container.querySelectorAll("[data-daily-brief-state=error] button")].map((element) => element.textContent);
    expect(actions.slice(0, 2)).toEqual(["Manage usage", "Try again"]);
    expect(button("Manage usage")!.className).toContain("product-action-primary");
  });
});
