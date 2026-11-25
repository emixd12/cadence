// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/layout/AppShell";
import {
  SIDEBAR_HOVER_DISMISS_DELAY_MS,
  SIDEBAR_STORAGE_KEY,
  createInitialSidebarState,
  deriveSidebarVisualState,
  parseSidebarDockPreference,
  readStoredSidebarPreference,
  reduceSidebarState,
  serializeSidebarDockPreference,
  writeStoredSidebarPreference,
} from "@/components/layout/sidebar-state";
import { DesktopApp } from "@/apps/desktop/src/desktop-app";
import { CHAT_FIXTURE_CONVERSATIONS } from "@/app/design-system/chat-fixtures";

vi.mock("next/navigation", () => ({
  usePathname: () => "/timeline",
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
// This DOM test needs no Next image loader or network requests.
vi.mock("next/image", () => ({
  default: (props: ComponentProps<"img">) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img {...props} alt={props.alt ?? ""} />
  ),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.localStorage.clear();
  window.matchMedia = vi.fn().mockReturnValue({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  vi.useRealTimers();
  await act(() => root.unmount());
  container.remove();
  document.body.style.overflow = "";
  vi.restoreAllMocks();
});

const getDesktopAside = () =>
  container.querySelector<HTMLElement>('aside[aria-label="Desktop navigation"]')!;
const getMain = () => container.querySelector<HTMLElement>("main")!;
const getExpandTrigger = () =>
  getDesktopAside().querySelector<HTMLButtonElement>(
    'button[aria-label="Expand navigation"]',
  );
const getCollapseToggle = () =>
  getDesktopAside().querySelector<HTMLButtonElement>(
    'button[aria-label="Collapse navigation"]',
  );

function dispatchMouseEnter(target: HTMLElement) {
  target.dispatchEvent(
    new MouseEvent("mouseover", { bubbles: true, cancelable: true }),
  );
}

function dispatchMouseLeave(
  target: HTMLElement,
  relatedTarget: EventTarget | null = document.body,
) {
  target.dispatchEvent(
    new MouseEvent("mouseout", {
      bubbles: true,
      cancelable: true,
      relatedTarget,
    }),
  );
}

describe("sidebar state model", () => {
  it("separates persistent docking preference from transient hover overlay state", () => {
    let state = createInitialSidebarState("collapsed");
    expect(deriveSidebarVisualState(state)).toBe("collapsed");

    state = reduceSidebarState(state, { type: "hover_trigger_enter" });
    expect(state.preference).toBe("collapsed");
    expect(state.isHoverOpen).toBe(true);
    expect(deriveSidebarVisualState(state)).toBe("overlay");

    state = reduceSidebarState(state, { type: "hover_dismiss" });
    expect(state.preference).toBe("collapsed");
    expect(state.isHoverOpen).toBe(false);
    expect(deriveSidebarVisualState(state)).toBe("collapsed");

    state = reduceSidebarState(state, { type: "hover_trigger_enter" });
    state = reduceSidebarState(state, { type: "toggle_dock" });
    expect(state.preference).toBe("docked");
    expect(state.isHoverOpen).toBe(false);
    expect(deriveSidebarVisualState(state)).toBe("docked");

    state = reduceSidebarState(state, { type: "toggle_dock" });
    expect(state.preference).toBe("collapsed");
    expect(deriveSidebarVisualState(state)).toBe("collapsed");
  });

  it("suppresses immediate re-open after Escape dismissal until pointer leaves", () => {
    let state = createInitialSidebarState("collapsed");
    state = reduceSidebarState(state, { type: "hover_trigger_enter" });
    expect(deriveSidebarVisualState(state)).toBe("overlay");

    state = reduceSidebarState(state, {
      type: "dismiss_overlay",
      suppressHover: true,
    });
    expect(deriveSidebarVisualState(state)).toBe("collapsed");
    expect(state.hoverSuppressed).toBe(true);

    // Hovering again before leaving remains suppressed.
    state = reduceSidebarState(state, { type: "hover_trigger_enter" });
    expect(deriveSidebarVisualState(state)).toBe("collapsed");

    // Once pointer leaves the region, subsequent hover opens overlay again.
    state = reduceSidebarState(state, { type: "pointer_left_region" });
    state = reduceSidebarState(state, { type: "hover_trigger_enter" });
    expect(deriveSidebarVisualState(state)).toBe("overlay");
  });

  it("parses and serializes stored docking preferences cleanly", () => {
    expect(parseSidebarDockPreference("true")).toBe("docked");
    expect(parseSidebarDockPreference("docked")).toBe("docked");
    expect(parseSidebarDockPreference("false")).toBe("collapsed");
    expect(parseSidebarDockPreference("collapsed")).toBe("collapsed");
    expect(parseSidebarDockPreference("invalid")).toBeNull();
    expect(parseSidebarDockPreference(null)).toBeNull();
    expect(serializeSidebarDockPreference("docked")).toBe("true");
    expect(serializeSidebarDockPreference("collapsed")).toBe("false");
  });

  it("handles SecurityError when reading the window.localStorage getter itself throws", async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      window,
      "localStorage",
    );

    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("Storage access denied", "SecurityError");
      },
    });

    try {
      expect(readStoredSidebarPreference()).toBeNull();
      expect(() => writeStoredSidebarPreference("collapsed")).not.toThrow();

      await act(async () => {
        root.render(
          <DesktopApp
            activeScreen="timeline"
            availableScreens={["timeline", "behaviors", "export", "settings"]}
            onNavigate={vi.fn()}
          >
            <p>Desktop content</p>
          </DesktopApp>,
        );
      });

      expect(getDesktopAside().dataset.sidebarState).toBe("docked");
      await act(async () => {
        getCollapseToggle()!.click();
      });
      expect(getDesktopAside().dataset.sidebarState).toBe("collapsed");
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(window, "localStorage", originalDescriptor);
      }
    }
  });
});

describe("dockable hover-to-reveal sidebar in AppShell", () => {
  it("expands into non-modal overlay on trigger hover and dismisses after a short delay on pointer leave", async () => {
    vi.useFakeTimers();
    await act(async () => {
      root.render(
        <AppShell
          defaultDesktopSidebarOpen={false}
          chatRecentsLoader={async () => CHAT_FIXTURE_CONVERSATIONS}
        >
          <button type="button">Main action</button>
        </AppShell>,
      );
    });

    const aside = getDesktopAside();
    const main = getMain();
    const trigger = getExpandTrigger()!;

    expect(aside.dataset.sidebarState).toBe("collapsed");
    expect(aside.dataset.sidebarPreference).toBe("collapsed");
    expect(aside.className).toContain("w-16");
    expect(aside.className).toContain("duration-[180ms]");
    expect(aside.className).toContain("motion-reduce:transition-none");
    expect(main.className).toContain("lg:pl-16");
    expect(main.dataset.sidebarLayout).toBe("collapsed");

    // Hovering the collapsed trigger temporarily opens overlay mode.
    await act(async () => {
      dispatchMouseEnter(trigger);
    });

    expect(aside.dataset.sidebarState).toBe("overlay");
    expect(aside.dataset.sidebarPreference).toBe("collapsed");
    expect(aside.className).toContain("w-64");
    expect(aside.className).toContain("shadow-lg");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.getAttribute("aria-pressed")).toBe("false");

    // Overlay must be non-modal: no dialog role, no focus trap, no body scroll lock, no storage write.
    expect(aside.getAttribute("role")).toBeNull();
    expect(aside.getAttribute("aria-modal")).toBeNull();
    expect(document.body.style.overflow).toBe("");
    expect(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBeNull();

    // Main content layout MUST NOT shift during overlay expansion.
    expect(main.className).toContain("lg:pl-16");
    expect(main.className).not.toContain("lg:pl-64");
    expect(main.dataset.sidebarLayout).toBe("collapsed");

    // Moving pointer outside triggers short dismissal delay (stays open during grace window).
    await act(async () => {
      dispatchMouseLeave(aside, main);
    });
    await act(async () => {
      vi.advanceTimersByTime(SIDEBAR_HOVER_DISMISS_DELAY_MS - 30);
    });
    expect(aside.dataset.sidebarState).toBe("overlay");

    // Once the dismissal delay elapses, overlay returns to collapsed.
    await act(async () => {
      vi.advanceTimersByTime(40);
    });
    expect(aside.dataset.sidebarState).toBe("collapsed");
    expect(aside.className).toContain("w-16");
    expect(aside.className).toContain("shadow-none");
    expect(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBeNull();
  });

  it("prevents flickering when the pointer moves between the trigger and the sidebar or briefly grazes outside", async () => {
    vi.useFakeTimers();
    await act(async () => {
      root.render(
        <AppShell
          defaultDesktopSidebarOpen={false}
          chatRecentsLoader={async () => CHAT_FIXTURE_CONVERSATIONS}
        >
          <p>Page</p>
        </AppShell>,
      );
    });

    const aside = getDesktopAside();
    const trigger = getExpandTrigger()!;
    const navLink = aside.querySelector<HTMLAnchorElement>('a[href="/behaviors"]')!;

    await act(async () => {
      dispatchMouseEnter(trigger);
    });
    expect(aside.dataset.sidebarState).toBe("overlay");

    // Moving from trigger into sidebar nav item keeps overlay continuously open.
    await act(async () => {
      dispatchMouseLeave(trigger, navLink);
      dispatchMouseEnter(navLink);
      vi.advanceTimersByTime(SIDEBAR_HOVER_DISMISS_DELAY_MS * 2);
    });
    expect(aside.dataset.sidebarState).toBe("overlay");

    // Moving from trigger with null relatedTarget (e.g. a narrow gap) into sidebar cancels dismissal.
    await act(async () => {
      dispatchMouseLeave(trigger, null);
      vi.advanceTimersByTime(50);
      dispatchMouseEnter(aside);
      vi.advanceTimersByTime(SIDEBAR_HOVER_DISMISS_DELAY_MS * 2);
    });
    expect(aside.dataset.sidebarState).toBe("overlay");

    // Briefly leaving sidebar and re-entering trigger before the delay expires cancels dismissal.
    await act(async () => {
      dispatchMouseLeave(aside, document.body);
      vi.advanceTimersByTime(SIDEBAR_HOVER_DISMISS_DELAY_MS - 40);
      dispatchMouseEnter(trigger);
      vi.advanceTimersByTime(SIDEBAR_HOVER_DISMISS_DELAY_MS * 2);
    });
    expect(aside.dataset.sidebarState).toBe("overlay");
  });

  it("docks on trigger click, reserves layout space, collapses on second toggle click, and persists preference", async () => {
    vi.useFakeTimers();
    await act(async () => {
      root.render(
        <AppShell
          defaultDesktopSidebarOpen={false}
          chatRecentsLoader={async () => CHAT_FIXTURE_CONVERSATIONS}
        >
          <p>Page</p>
        </AppShell>,
      );
    });

    const aside = getDesktopAside();
    const main = getMain();
    const trigger = getExpandTrigger()!;

    // Hover to reveal overlay, then click the same trigger to dock.
    await act(async () => {
      dispatchMouseEnter(trigger);
    });
    expect(aside.dataset.sidebarState).toBe("overlay");
    expect(main.className).toContain("lg:pl-16");

    await act(async () => {
      trigger.click();
    });
    expect(aside.dataset.sidebarState).toBe("docked");
    expect(aside.dataset.sidebarPreference).toBe("docked");
    expect(aside.className).toContain("w-64");
    expect(aside.className).toContain("shadow-none");
    expect(main.className).toContain("lg:pl-64");
    expect(main.dataset.sidebarLayout).toBe("docked");
    expect(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe("true");

    // Moving pointer outside a docked sidebar does NOT collapse it.
    await act(async () => {
      dispatchMouseLeave(aside, main);
      vi.advanceTimersByTime(SIDEBAR_HOVER_DISMISS_DELAY_MS * 3);
    });
    expect(aside.dataset.sidebarState).toBe("docked");

    // Clicking toggle again collapses it and persists "false".
    const collapseButton = getCollapseToggle()!;
    expect(collapseButton.getAttribute("aria-pressed")).toBe("true");
    await act(async () => {
      collapseButton.click();
    });
    expect(aside.dataset.sidebarState).toBe("collapsed");
    expect(aside.dataset.sidebarPreference).toBe("collapsed");
    expect(main.className).toContain("lg:pl-16");
    expect(main.dataset.sidebarLayout).toBe("collapsed");
    expect(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe("false");

    // Remounting restores the persisted collapsed preference.
    await act(async () => {
      root.unmount();
      root = createRoot(container);
      root.render(
        <AppShell chatRecentsLoader={async () => CHAT_FIXTURE_CONVERSATIONS}>
          <p>Page</p>
        </AppShell>,
      );
    });
    await act(async () => {
      vi.runAllTimers();
    });
    expect(getDesktopAside().dataset.sidebarState).toBe("collapsed");
    expect(getDesktopAside().dataset.sidebarPreference).toBe("collapsed");
    expect(getMain().className).toContain("lg:pl-16");

    // Blocked storage still permits docking and collapsing for the current session.
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Storage denied");
    });
    await act(async () => {
      getExpandTrigger()!.click();
    });
    expect(getDesktopAside().dataset.sidebarState).toBe("docked");
    expect(getMain().className).toContain("lg:pl-64");
  });

  it("supports keyboard toggling, Escape dismissal without focus trapping, and focus restoration", async () => {
    vi.useFakeTimers();
    await act(async () => {
      root.render(
        <AppShell
          defaultDesktopSidebarOpen={false}
          chatRecentsLoader={async () => CHAT_FIXTURE_CONVERSATIONS}
        >
          <button type="button">Main button</button>
        </AppShell>,
      );
    });

    const aside = getDesktopAside();
    const mainButton = container.querySelector<HTMLButtonElement>("main button")!;
    const expandTrigger = getExpandTrigger()!;

    // Hover to open overlay, focus a link inside overlay, then press Escape.
    await act(async () => {
      dispatchMouseEnter(expandTrigger);
    });
    expect(aside.dataset.sidebarState).toBe("overlay");

    const behaviorsLink = aside.querySelector<HTMLAnchorElement>('a[href="/behaviors"]')!;
    behaviorsLink.focus();
    expect(document.activeElement).toBe(behaviorsLink);

    // Non-modal: focus can move freely to main content without any trap.
    mainButton.focus();
    expect(document.activeElement).toBe(mainButton);
    expect(aside.dataset.sidebarState).toBe("overlay");

    // Escape while focus is in main dismisses overlay WITHOUT stealing focus from main.
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(aside.dataset.sidebarState).toBe("collapsed");
    expect(document.activeElement).toBe(mainButton);

    // Pointer leaving clears post-Escape hover suppression; re-hovering re-opens overlay.
    await act(async () => {
      dispatchMouseLeave(aside, mainButton);
      dispatchMouseEnter(getExpandTrigger()!);
    });
    expect(aside.dataset.sidebarState).toBe("overlay");

    // Escape while focus is inside overlay dismisses overlay and restores focus to the collapsed trigger.
    const overlayBrandLink = aside.querySelector<HTMLAnchorElement>(
      'a[aria-label="Open Timeline"]',
    )!;
    overlayBrandLink.focus();
    expect(document.activeElement).toBe(overlayBrandLink);

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(aside.dataset.sidebarState).toBe("collapsed");
    expect(document.activeElement).toBe(getExpandTrigger());

    // Keyboard activation of the focused toggle preserves focus on the opposite toggle button.
    await act(async () => {
      getExpandTrigger()!.click();
    });
    expect(aside.dataset.sidebarState).toBe("docked");
    expect(document.activeElement).toBe(getCollapseToggle());

    await act(async () => {
      getCollapseToggle()!.click();
    });
    expect(aside.dataset.sidebarState).toBe("collapsed");
    expect(document.activeElement).toBe(getExpandTrigger());
  });

  it("preserves sidebar scroll position and navigation state across collapsed, overlay, and docked transitions", async () => {
    vi.useFakeTimers();
    await act(async () => {
      root.render(
        <AppShell
          defaultDesktopSidebarOpen={false}
          defaultChatRecentsOpen
          chatRecentsLoader={async () => CHAT_FIXTURE_CONVERSATIONS}
        >
          <p>Page</p>
        </AppShell>,
      );
    });

    const aside = getDesktopAside();
    const nav = aside.querySelector<HTMLElement>('nav[aria-label="Primary"]')!;
    nav.scrollTop = 140;

    // Collapsed -> Overlay
    await act(async () => {
      dispatchMouseEnter(getExpandTrigger()!);
    });
    expect(aside.dataset.sidebarState).toBe("overlay");
    expect(aside.querySelector('nav[aria-label="Primary"]')).toBe(nav);
    expect(nav.scrollTop).toBe(140);

    // Toggle chat recents closed inside overlay and verify state survives docking and collapsing.
    const recentsToggle = aside.querySelector<HTMLButtonElement>(
      'button[aria-controls="chat-nav-recents"]',
    )!;
    expect(recentsToggle.getAttribute("aria-expanded")).toBe("true");
    await act(async () => {
      recentsToggle.click();
    });
    expect(recentsToggle.getAttribute("aria-expanded")).toBe("false");

    // Overlay -> Docked
    await act(async () => {
      getExpandTrigger()!.click();
    });
    expect(aside.dataset.sidebarState).toBe("docked");
    expect(aside.querySelector('nav[aria-label="Primary"]')).toBe(nav);
    expect(nav.scrollTop).toBe(140);
    expect(
      aside
        .querySelector<HTMLButtonElement>('button[aria-controls="chat-nav-recents"]')!
        .getAttribute("aria-expanded"),
    ).toBe("false");

    // Docked -> Collapsed -> Overlay
    await act(async () => {
      getCollapseToggle()!.click();
    });
    expect(aside.dataset.sidebarState).toBe("collapsed");
    expect(aside.querySelector('nav[aria-label="Primary"]')).toBe(nav);
    expect(nav.scrollTop).toBe(140);

    await act(async () => {
      dispatchMouseEnter(getExpandTrigger()!);
    });
    expect(aside.dataset.sidebarState).toBe("overlay");
    expect(aside.querySelector('nav[aria-label="Primary"]')).toBe(nav);
    expect(nav.scrollTop).toBe(140);
    expect(
      aside
        .querySelector<HTMLButtonElement>('button[aria-controls="chat-nav-recents"]')!
        .getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("ignores touch pointer enters so hover overlay does not stick on touch devices", async () => {
    await act(async () => {
      root.render(
        <AppShell
          defaultDesktopSidebarOpen={false}
          chatRecentsLoader={async () => CHAT_FIXTURE_CONVERSATIONS}
        >
          <p>Page</p>
        </AppShell>,
      );
    });

    const aside = getDesktopAside();
    const trigger = getExpandTrigger()!;

    // jsdom may not define PointerEvent globally, so construct a MouseEvent with pointerType.
    const touchEnter = new MouseEvent("pointerover", { bubbles: true });
    Object.defineProperty(touchEnter, "pointerType", { value: "touch" });
    await act(async () => {
      trigger.dispatchEvent(touchEnter);
    });

    expect(aside.dataset.sidebarState).toBe("collapsed");
  });
});

describe("dockable hover-to-reveal sidebar in DesktopApp", () => {
  it("reuses the same overlay, docking, layout-stability, and persistence model", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, "false");
    const onNavigate = vi.fn();

    await act(async () => {
      root.render(
        <DesktopApp
          activeScreen="timeline"
          availableScreens={["timeline", "behaviors", "export", "settings"]}
          onNavigate={onNavigate}
        >
          <p>Desktop content</p>
        </DesktopApp>,
      );
    });

    const aside = getDesktopAside();
    const main = getMain();

    expect(aside.dataset.sidebarState).toBe("collapsed");
    expect(main.className).toContain("lg:pl-16");

    // Hover trigger -> overlay without shifting desktop main content.
    await act(async () => {
      dispatchMouseEnter(getExpandTrigger()!);
    });
    expect(aside.dataset.sidebarState).toBe("overlay");
    expect(aside.className).toContain("w-64");
    expect(aside.className).toContain("shadow-lg");
    expect(main.className).toContain("lg:pl-16");
    expect(main.className).not.toContain("lg:pl-64");
    expect(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe("false");

    // Clicking trigger docks and updates localStorage.
    await act(async () => {
      getExpandTrigger()!.click();
    });
    expect(aside.dataset.sidebarState).toBe("docked");
    expect(main.className).toContain("lg:pl-64");
    expect(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe("true");
    expect(onNavigate).not.toHaveBeenCalled();

    // Collapse again -> hover -> Escape dismisses back to collapsed.
    await act(async () => {
      getCollapseToggle()!.click();
    });
    expect(aside.dataset.sidebarState).toBe("collapsed");
    await act(async () => {
      dispatchMouseEnter(getExpandTrigger()!);
    });
    expect(aside.dataset.sidebarState).toBe("overlay");
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(aside.dataset.sidebarState).toBe("collapsed");
  });
});
