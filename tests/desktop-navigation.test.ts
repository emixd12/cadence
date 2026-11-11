import { afterEach, describe, expect, it, vi } from "vitest";
import { scrollAfterDesktopNavigation } from "../apps/desktop/src/desktop-navigation";

function browser() {
  let callback: (() => void) | undefined;
  let mutation: (() => void) | undefined;
  const scrollTo = vi.fn();
  const scrollIntoView = vi.fn();
  const disconnect = vi.fn();
  const getElementById = vi.fn<() => unknown>(() => null);
  vi.stubGlobal("window", {
    requestAnimationFrame: vi.fn((next: () => void) => { callback = next; return 1; }),
    cancelAnimationFrame: vi.fn(() => { callback = undefined; }),
    scrollTo, setTimeout: vi.fn(() => 1), clearTimeout: vi.fn(),
  });
  vi.stubGlobal("document", { body: {}, getElementById });
  vi.stubGlobal("MutationObserver", class {
    constructor(next: () => void) { mutation = next; }
    observe = vi.fn();
    disconnect = disconnect;
  });
  return { scrollTo, scrollIntoView, disconnect, getElementById,
    frame: () => { const next = callback; callback = undefined; next?.(); },
    mountAnchor: () => { getElementById.mockReturnValue({ scrollIntoView, closest: () => null }); mutation?.(); },
  };
}

afterEach(() => vi.unstubAllGlobals());
describe("desktop navigation scroll", () => {
  it("resets primary navigation only after the screen can commit", () => {
    const page = browser();
    scrollAfterDesktopNavigation();
    expect(page.scrollTo).not.toHaveBeenCalled();
    page.frame();
    expect(page.scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 0, left: 0, behavior: "instant" });
    expect(page.getElementById).not.toHaveBeenCalled();
  });

  it("waits for an asynchronously loaded onboarding anchor without losing it", () => {
    const page = browser();
    scrollAfterDesktopNavigation("behaviorlog-import");
    page.frame();
    expect(page.scrollIntoView).not.toHaveBeenCalled();
    expect(page.getElementById).toHaveBeenCalledWith("behaviorlog-import");
    page.mountAnchor();
    page.frame();
    expect(page.scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: "start" });
    expect(page.disconnect).toHaveBeenCalledOnce();
    expect(page.scrollTo).not.toHaveBeenCalled();
  });

  it("cancels an old anchor request when another navigation or activation wins", () => {
    const page = browser();
    const cancel = scrollAfterDesktopNavigation("behaviorlog-import");
    page.frame();
    cancel();
    page.mountAnchor();
    page.frame();
    expect(page.scrollIntoView).not.toHaveBeenCalled();
    expect(page.disconnect).toHaveBeenCalledOnce();
  });
});
