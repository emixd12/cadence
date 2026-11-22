// @vitest-environment jsdom
import { act, useEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SEMANTIC_ZOOM_STORAGE_KEY,
  TOUCH_ZOOM_RATIO,
  WHEEL_GESTURE_IDLE_MS,
  WHEEL_ZOOM_THRESHOLD,
  ZOOM_SWITCH_COOLDOWN_MS,
  isParentExpanded,
  keyboardZoomDirection,
  pinchZoomDirection,
  toggleParentOverride,
  useSemanticZoom,
  wheelZoomDirection,
  type SemanticZoom,
} from "@/components/timeline/use-semantic-zoom";

let container: HTMLDivElement;
let root: Root;
const handle: { current: SemanticZoom | null } = { current: null };
const zoom = () => handle.current!;

function Harness({ enabled = true }: Readonly<{ enabled?: boolean }>) {
  const ref = useRef<HTMLDivElement>(null);
  const state = useSemanticZoom({ containerRef: ref, enabled });
  useEffect(() => { handle.current = state; });
  return (
    <div ref={ref} data-testid="timeline" data-layer={state.layer}>
      <button type="button">Row</button>
      <span data-a={String(state.isExpanded("a"))} data-b={String(state.isExpanded("b"))} />
    </div>
  );
}

const surface = () => container.querySelector<HTMLElement>('[data-testid="timeline"]')!;
const layer = () => surface().dataset.layer;

function wheel(deltaY: number, ctrlKey = true) {
  const event = new WheelEvent("wheel", { deltaY, ctrlKey, bubbles: true, cancelable: true });
  act(() => { surface().dispatchEvent(event); });
  return event;
}

function touch(type: string, points: readonly (readonly [number, number])[]) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", { value: points.map(([clientX, clientY]) => ({ clientX, clientY })) });
  act(() => { surface().dispatchEvent(event); });
  return event;
}

async function mount(enabled = true) {
  await act(() => root.render(<Harness enabled={enabled} />));
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-20T15:00:00Z"));
  window.localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("Semantic Zoom gesture rules", () => {
  it("needs a full wheel pinch before it switches, in either direction", () => {
    expect(wheelZoomDirection(-(WHEEL_ZOOM_THRESHOLD - 1))).toBeNull();
    expect(wheelZoomDirection(-WHEEL_ZOOM_THRESHOLD)).toBe("in");
    expect(wheelZoomDirection(WHEEL_ZOOM_THRESHOLD)).toBe("out");
  });

  it("switches on a clear two-finger spread only", () => {
    expect(pinchZoomDirection(1.1)).toBeNull();
    expect(pinchZoomDirection(TOUCH_ZOOM_RATIO)).toBe("in");
    expect(pinchZoomDirection(1 / TOUCH_ZOOM_RATIO)).toBe("out");
    expect(pinchZoomDirection(Number.NaN)).toBeNull();
    expect(pinchZoomDirection(0)).toBeNull();
  });

  it("maps Ctrl/Cmd + = and - and ignores plain or Alt keys", () => {
    expect(keyboardZoomDirection({ key: "=", ctrlKey: true, metaKey: false, altKey: false })).toBe("in");
    expect(keyboardZoomDirection({ key: "+", ctrlKey: false, metaKey: true, altKey: false })).toBe("in");
    expect(keyboardZoomDirection({ key: "-", ctrlKey: false, metaKey: true, altKey: false })).toBe("out");
    expect(keyboardZoomDirection({ key: "=", ctrlKey: false, metaKey: false, altKey: false })).toBeNull();
    expect(keyboardZoomDirection({ key: "=", ctrlKey: true, metaKey: false, altKey: true })).toBeNull();
  });

  it("keeps an override only while it differs from the layer", () => {
    const opened = toggleParentOverride("parents", {}, "a");
    expect(opened).toEqual({ a: true });
    expect(isParentExpanded("parents", opened, "a")).toBe(true);
    expect(isParentExpanded("parents", opened, "b")).toBe(false);
    expect(toggleParentOverride("parents", opened, "a")).toEqual({});
    const closed = toggleParentOverride("sub_behaviors", {}, "a");
    expect(isParentExpanded("sub_behaviors", closed, "a")).toBe(false);
    expect(isParentExpanded("sub_behaviors", closed, "b")).toBe(true);
  });
});

describe("useSemanticZoom", () => {
  it("starts on Routines and restores the stored layer", async () => {
    await mount();
    expect(layer()).toBe("parents");
    await act(() => root.unmount());
    window.localStorage.setItem(SEMANTIC_ZOOM_STORAGE_KEY, "sub_behaviors");
    root = createRoot(container);
    await mount();
    expect(layer()).toBe("sub_behaviors");
  });

  it("treats a stored value it does not know as Routines", async () => {
    window.localStorage.setItem(SEMANTIC_ZOOM_STORAGE_KEY, "grandchildren");
    await mount();
    expect(layer()).toBe("parents");
  });

  it("lets plain wheel scrolling through untouched", async () => {
    await mount();
    const event = wheel(-500, false);
    expect(event.defaultPrevented).toBe(false);
    expect(layer()).toBe("parents");
  });

  it("blocks page zoom on every pinch event and switches once past the threshold", async () => {
    await mount();
    const small = wheel(-(WHEEL_ZOOM_THRESHOLD / 2));
    expect(small.defaultPrevented).toBe(true);
    expect(layer()).toBe("parents");
    wheel(-(WHEEL_ZOOM_THRESHOLD / 2));
    expect(layer()).toBe("sub_behaviors");
    expect(window.localStorage.getItem(SEMANTIC_ZOOM_STORAGE_KEY)).toBe("sub_behaviors");
  });

  it("drops a slow pinch's delta after a pause", async () => {
    await mount();
    wheel(-(WHEEL_ZOOM_THRESHOLD - 5));
    vi.setSystemTime(Date.now() + WHEEL_GESTURE_IDLE_MS + 10);
    wheel(-10);
    expect(layer()).toBe("parents");
  });

  it("does not bounce back within the same gesture", async () => {
    await mount();
    wheel(-WHEEL_ZOOM_THRESHOLD);
    expect(layer()).toBe("sub_behaviors");
    wheel(WHEEL_ZOOM_THRESHOLD * 3);
    expect(layer()).toBe("sub_behaviors");
    vi.setSystemTime(Date.now() + ZOOM_SWITCH_COOLDOWN_MS + 10);
    wheel(WHEEL_ZOOM_THRESHOLD);
    expect(layer()).toBe("parents");
  });

  it("switches on a two-finger pinch and leaves one-finger scrolling alone", async () => {
    await mount();
    touch("touchstart", [[100, 100]]);
    const scroll = touch("touchmove", [[100, 300]]);
    expect(scroll.defaultPrevented).toBe(false);

    touch("touchstart", [[100, 100], [200, 100]]);
    const slight = touch("touchmove", [[95, 100], [205, 100]]);
    expect(slight.defaultPrevented).toBe(true);
    expect(layer()).toBe("parents");
    touch("touchmove", [[60, 100], [240, 100]]);
    expect(layer()).toBe("sub_behaviors");
    // The same pinch switches nothing more, even when it closes again.
    touch("touchmove", [[140, 100], [160, 100]]);
    expect(layer()).toBe("sub_behaviors");
    touch("touchend", []);

    vi.setSystemTime(Date.now() + ZOOM_SWITCH_COOLDOWN_MS + 10);
    touch("touchstart", [[60, 100], [240, 100]]);
    touch("touchmove", [[120, 100], [180, 100]]);
    expect(layer()).toBe("parents");
  });

  it("follows Ctrl/Cmd + = and - pressed inside the Timeline", async () => {
    await mount();
    const button = container.querySelector("button")!;
    const press = (key: string) => {
      const event = new KeyboardEvent("keydown", { key, metaKey: true, bubbles: true, cancelable: true });
      act(() => { button.dispatchEvent(event); });
      return event;
    };
    expect(press("=").defaultPrevented).toBe(true);
    expect(layer()).toBe("sub_behaviors");
    press("-");
    expect(layer()).toBe("parents");
  });

  it("ignores gestures while the Timeline has no routine", async () => {
    await mount(false);
    const event = wheel(-WHEEL_ZOOM_THRESHOLD * 2);
    expect(event.defaultPrevented).toBe(false);
    expect(layer()).toBe("parents");
  });

  it("opens one routine on a click and clears that choice when the layer changes", async () => {
    await mount();
    const flags = () => container.querySelector<HTMLElement>("[data-a]")!.dataset;
    act(() => zoom().toggleParent("a"));
    expect(flags()).toMatchObject({ a: "true", b: "false" });
    act(() => zoom().setLayer("sub_behaviors"));
    expect(flags()).toMatchObject({ a: "true", b: "true" });
    act(() => zoom().toggleParent("b"));
    expect(flags()).toMatchObject({ a: "true", b: "false" });
    act(() => zoom().setLayer("parents"));
    expect(flags()).toMatchObject({ a: "false", b: "false" });
  });
});
