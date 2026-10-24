// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MobileTimelinePullToRefresh } from "@/components/timeline/MobileTimelinePullToRefresh";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  connectors: vi.fn<() => Promise<boolean>>(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/lib/ui/timeline-connector-reloads", () => ({ reloadWebTimelineConnectors: mocks.connectors }));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
  mocks.refresh.mockReset();
  mocks.connectors.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
});

describe("Timeline reload boundary", () => {
  it("coalesces wheel input and announces success only after Cadence and connectors complete", async () => {
    let finish!: (success: boolean) => void;
    mocks.connectors.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await act(() => root.render(<MobileTimelinePullToRefresh><main>Timeline</main></MobileTimelinePullToRefresh>));
    const boundary = container.querySelector<HTMLElement>("[data-timeline-pull-to-refresh]")!;

    await act(() => {
      boundary.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -60 }));
      boundary.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -60 }));
    });
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(mocks.connectors).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Reloading Cadence and connectors");
    expect(container.textContent).not.toContain("Cadence and connectors reloaded.");

    await act(async () => { finish(true); await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(container.textContent).toContain("Cadence and connectors reloaded.");
  });

  it("keeps failure honest when a connector refresh is stale", async () => {
    mocks.connectors.mockResolvedValue(false);
    await act(() => root.render(<MobileTimelinePullToRefresh><main>Timeline</main></MobileTimelinePullToRefresh>));
    const boundary = container.querySelector<HTMLElement>("[data-timeline-pull-to-refresh]")!;
    await act(async () => {
      boundary.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -60 }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain("Reload incomplete. Cadence or connector data may be stale.");
    expect(container.textContent).not.toContain("Cadence and connectors reloaded.");
  });

  it("does not start a reload while offline", async () => {
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: false });
    await act(() => root.render(<MobileTimelinePullToRefresh><main>Timeline</main></MobileTimelinePullToRefresh>));
    await act(() => {
      container.querySelector<HTMLElement>("[data-timeline-pull-to-refresh]")!
        .dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -60 }));
    });
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.connectors).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Reload failed while offline. Displayed data may be stale.");
  });

  it("leaves controls, nested scrolling, and dialogs untouched, including during a wheel lock", async () => {
    let finish!: (success: boolean) => void;
    mocks.connectors.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await act(() => root.render(
      <MobileTimelinePullToRefresh>
        <button type="button">Control</button>
        <div data-nested style={{ overflowY: "auto" }}>Nested</div>
        <main>Timeline</main>
      </MobileTimelinePullToRefresh>,
    ));
    const boundary = container.querySelector<HTMLElement>("[data-timeline-pull-to-refresh]")!;
    const control = container.querySelector("button")!;
    const nested = container.querySelector<HTMLElement>("[data-nested]")!;
    Object.defineProperties(nested, {
      scrollHeight: { configurable: true, value: 200 },
      clientHeight: { configurable: true, value: 100 },
    });
    for (const target of [control, nested]) {
      const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -60 });
      target.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(mocks.refresh).not.toHaveBeenCalled();

    await act(() => boundary.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -60 })));
    expect(mocks.refresh).toHaveBeenCalledOnce();
    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    document.body.append(dialog);
    const lockedEvent = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -60 });
    boundary.dispatchEvent(lockedEvent);
    expect(lockedEvent.defaultPrevented).toBe(false);
    expect(mocks.refresh).toHaveBeenCalledOnce();
    dialog.remove();
    await act(async () => { finish(true); await Promise.resolve(); });
  });
});
