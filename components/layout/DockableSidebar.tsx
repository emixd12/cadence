"use client";

import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import {
  SIDEBAR_HOVER_DISMISS_DELAY_MS,
  SIDEBAR_STORAGE_KEY,
  createInitialSidebarState,
  deriveSidebarVisualState,
  readStoredSidebarPreference,
  reduceSidebarState,
  writeStoredSidebarPreference,
  type SidebarDockPreference,
  type SidebarVisualState,
} from "@/components/layout/sidebar-state";

export {
  SIDEBAR_HOVER_DISMISS_DELAY_MS,
  SIDEBAR_STORAGE_KEY,
  SIDEBAR_TRANSITION_DURATION_MS,
  createInitialSidebarState,
  deriveSidebarVisualState,
  parseSidebarDockPreference,
  readStoredSidebarPreference,
  reduceSidebarState,
  serializeSidebarDockPreference,
  writeStoredSidebarPreference,
  type SidebarDockPreference,
  type SidebarEvent,
  type SidebarState,
  type SidebarVisualState,
} from "@/components/layout/sidebar-state";

export type UseDockableSidebarOptions = Readonly<{
  /** Initial docking preference before client storage hydration. Default: "docked". */
  defaultPreference?: SidebarDockPreference;
  /** localStorage key for persisting the docked/collapsed preference. Default: "sidebar-open". */
  storageKey?: string;
  /** Optional media query used only when no stored preference exists. */
  desktopMediaQuery?: string;
  /** Read localStorage synchronously during initialization (safe for client-only shells like desktop). */
  readInitialPreferenceSync?: boolean;
  /** Short delay (ms) before dismissing the hover overlay after pointer leave. Default: 160. */
  hoverDismissDelayMs?: number;
}>;

export type DockableSidebarRenderState = Readonly<{
  visualState: SidebarVisualState;
  preference: SidebarDockPreference;
  isCollapsed: boolean;
  isExpanded: boolean;
  isOverlay: boolean;
  isDocked: boolean;
}>;

export type DockableSidebarRegionHandlers = Readonly<{
  onPointerEnter: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerLeave: (event: ReactPointerEvent<HTMLElement>) => void;
  onMouseEnter: (event: ReactMouseEvent<HTMLElement>) => void;
  onMouseLeave: (event: ReactMouseEvent<HTMLElement>) => void;
}>;

export type DockableSidebarController = Readonly<{
  preference: SidebarDockPreference;
  visualState: SidebarVisualState;
  isDocked: boolean;
  isOverlay: boolean;
  isExpanded: boolean;
  isCollapsed: boolean;
  toggleDock: () => void;
  setPreference: (preference: SidebarDockPreference) => void;
  dismissOverlay: () => void;
  focusTrigger: () => void;
  registerSidebar: (node: HTMLElement | null) => void;
  registerTrigger: (node: HTMLButtonElement | null) => void;
  sidebarProps: DockableSidebarRegionHandlers;
  triggerProps: DockableSidebarRegionHandlers;
}>;

export function useDockableSidebar({
  defaultPreference = "docked",
  storageKey = SIDEBAR_STORAGE_KEY,
  desktopMediaQuery,
  readInitialPreferenceSync = false,
  hoverDismissDelayMs = SIDEBAR_HOVER_DISMISS_DELAY_MS,
}: UseDockableSidebarOptions = {}): DockableSidebarController {
  const [state, dispatch] = useReducer(
    reduceSidebarState,
    { defaultPreference, readInitialPreferenceSync, storageKey },
    (init) => {
      if (init.readInitialPreferenceSync) {
        const stored = readStoredSidebarPreference(undefined, init.storageKey);
        if (stored !== null) {
          return createInitialSidebarState(stored);
        }
      }

      return createInitialSidebarState(init.defaultPreference);
    },
  );

  const visualState = deriveSidebarVisualState(state);
  const isDocked = state.preference === "docked";
  const isOverlay = visualState === "overlay";
  const isExpanded = visualState !== "collapsed";
  const isCollapsed = visualState === "collapsed";

  const sidebarRef = useRef<HTMLElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasStoredPreferenceRef = useRef(false);
  // True once the person docks or collapses the sidebar in this mount. The stored
  // preference is applied a frame after mount, and must not undo that choice.
  const hasChosenPreferenceRef = useRef(false);
  const isPointerInsideRef = useRef(false);
  const lastPointerTypeRef = useRef<string | null>(null);
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const cancelDismissTimer = useCallback(() => {
    if (dismissTimerRef.current !== null) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  }, []);

  const isNodeInsideSidebarRegion = useCallback((node: EventTarget | null) => {
    if (!(node instanceof Node)) {
      return false;
    }

    return Boolean(
      sidebarRef.current?.contains(node) || triggerRef.current?.contains(node),
    );
  }, []);

  const scheduleOverlayDismiss = useCallback(() => {
    cancelDismissTimer();
    const current = stateRef.current;

    if (current.preference !== "collapsed") {
      return;
    }

    if (!current.isHoverOpen) {
      if (current.hoverSuppressed) {
        dispatch({ type: "pointer_left_region" });
      }
      return;
    }

    if (hoverDismissDelayMs <= 0) {
      dispatch({ type: "hover_dismiss" });
      return;
    }

    dismissTimerRef.current = setTimeout(() => {
      dismissTimerRef.current = null;
      dispatch({ type: "hover_dismiss" });
    }, hoverDismissDelayMs);
  }, [cancelDismissTimer, hoverDismissDelayMs]);

  const setPreference = useCallback(
    (preference: SidebarDockPreference) => {
      cancelDismissTimer();
      hasStoredPreferenceRef.current = true;
      hasChosenPreferenceRef.current = true;
      writeStoredSidebarPreference(preference, undefined, storageKey);
      dispatch({ type: "set_preference", preference, suppressHover: false });
    },
    [cancelDismissTimer, storageKey],
  );

  const toggleDock = useCallback(() => {
    cancelDismissTimer();
    const nextPreference: SidebarDockPreference =
      stateRef.current.preference === "docked" ? "collapsed" : "docked";
    hasStoredPreferenceRef.current = true;
    hasChosenPreferenceRef.current = true;
    writeStoredSidebarPreference(nextPreference, undefined, storageKey);
    dispatch({ type: "toggle_dock", suppressHover: false });
  }, [cancelDismissTimer, storageKey]);

  const dismissOverlay = useCallback(() => {
    cancelDismissTimer();
    dispatch({
      type: "dismiss_overlay",
      suppressHover: isPointerInsideRef.current,
    });
  }, [cancelDismissTimer]);

  const handleTriggerEnter = useCallback(
    (pointerType?: string) => {
      if (pointerType === "touch") {
        return;
      }

      isPointerInsideRef.current = true;
      cancelDismissTimer();
      dispatch({ type: "hover_trigger_enter" });
    },
    [cancelDismissTimer],
  );

  const handleSidebarEnter = useCallback(
    (pointerType?: string) => {
      if (pointerType === "touch") {
        return;
      }

      isPointerInsideRef.current = true;
      cancelDismissTimer();
    },
    [cancelDismissTimer],
  );

  const handleRegionLeave = useCallback(
    (relatedTarget: EventTarget | null, pointerType?: string) => {
      if (pointerType === "touch") {
        return;
      }

      if (isNodeInsideSidebarRegion(relatedTarget)) {
        isPointerInsideRef.current = true;
        cancelDismissTimer();
        return;
      }

      isPointerInsideRef.current = false;
      scheduleOverlayDismiss();
    },
    [cancelDismissTimer, isNodeInsideSidebarRegion, scheduleOverlayDismiss],
  );

  // Hydrate persistent preference from localStorage (and optional desktop media query).
  useEffect(() => {
    const stored = readStoredSidebarPreference(undefined, storageKey);
    const mediaQuery =
      desktopMediaQuery && typeof window.matchMedia === "function"
        ? window.matchMedia(desktopMediaQuery)
        : null;

    const handleDesktopChange = (event: MediaQueryListEvent) => {
      if (!hasStoredPreferenceRef.current) {
        dispatch({
          type: "hydrate_preference",
          preference: event.matches ? "docked" : "collapsed",
        });
      }
    };

    const frameId = window.requestAnimationFrame(() => {
      if (hasChosenPreferenceRef.current) return;
      if (stored !== null) {
        hasStoredPreferenceRef.current = true;
        if (stored !== stateRef.current.preference) {
          dispatch({ type: "hydrate_preference", preference: stored });
        }
      } else if (mediaQuery) {
        const nextPreference: SidebarDockPreference = mediaQuery.matches
          ? "docked"
          : "collapsed";
        if (nextPreference !== stateRef.current.preference) {
          dispatch({ type: "hydrate_preference", preference: nextPreference });
        }
      }
    });

    mediaQuery?.addEventListener("change", handleDesktopChange);

    return () => {
      window.cancelAnimationFrame(frameId);
      mediaQuery?.removeEventListener("change", handleDesktopChange);
    };
  }, [desktopMediaQuery, storageKey]);

  // Clear pending hover dismissal timer on unmount.
  useEffect(() => cancelDismissTimer, [cancelDismissTimer]);

  const restoreFocusOnEscapeRef = useRef(false);

  // Dismiss transient overlay on Escape without trapping focus or adding a backdrop.
  useEffect(() => {
    if (!isOverlay) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      const active = document.activeElement;
      restoreFocusOnEscapeRef.current =
        active instanceof Node && isNodeInsideSidebarRegion(active);
      dismissOverlay();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [dismissOverlay, isNodeInsideSidebarRegion, isOverlay]);

  // When Escape dismissed the overlay while focus was inside the sidebar,
  // restore focus to the collapsed trigger after the collapsed state commits.
  useEffect(() => {
    if (visualState === "collapsed" && restoreFocusOnEscapeRef.current) {
      restoreFocusOnEscapeRef.current = false;
      triggerRef.current?.focus({ preventScroll: true });
    }
  }, [visualState]);

  const sidebarProps: DockableSidebarRegionHandlers = {
    onPointerEnter: (event) => {
      lastPointerTypeRef.current = event.pointerType;
      handleSidebarEnter(event.pointerType);
    },
    onPointerLeave: (event) => {
      lastPointerTypeRef.current = event.pointerType;
      handleRegionLeave(event.relatedTarget, event.pointerType);
    },
    onMouseEnter: () => {
      if (lastPointerTypeRef.current === "touch") {
        return;
      }
      handleSidebarEnter("mouse");
    },
    onMouseLeave: (event) => {
      if (lastPointerTypeRef.current === "touch") {
        return;
      }
      handleRegionLeave(event.relatedTarget, "mouse");
    },
  };

  const triggerProps: DockableSidebarRegionHandlers = {
    onPointerEnter: (event) => {
      lastPointerTypeRef.current = event.pointerType;
      handleTriggerEnter(event.pointerType);
    },
    onPointerLeave: (event) => {
      lastPointerTypeRef.current = event.pointerType;
      handleRegionLeave(event.relatedTarget, event.pointerType);
    },
    onMouseEnter: () => {
      if (lastPointerTypeRef.current === "touch") {
        return;
      }
      handleTriggerEnter("mouse");
    },
    onMouseLeave: (event) => {
      if (lastPointerTypeRef.current === "touch") {
        return;
      }
      handleRegionLeave(event.relatedTarget, "mouse");
    },
  };

  const registerSidebar = useCallback((node: HTMLElement | null) => {
    sidebarRef.current = node;
  }, []);

  const registerTrigger = useCallback((node: HTMLButtonElement | null) => {
    triggerRef.current = node;
  }, []);

  const focusTrigger = useCallback(() => {
    triggerRef.current?.focus({ preventScroll: true });
  }, []);

  return {
    preference: state.preference,
    visualState,
    isDocked,
    isOverlay,
    isExpanded,
    isCollapsed,
    toggleDock,
    setPreference,
    dismissOverlay,
    focusTrigger,
    registerSidebar,
    registerTrigger,
    sidebarProps,
    triggerProps,
  };
}

export type DockableSidebarProps = Readonly<{
  controller: DockableSidebarController;
  ariaLabel?: string;
  brandMark: ReactNode;
  renderBrandLink: (state: DockableSidebarRenderState) => ReactNode;
  renderNav: (state: DockableSidebarRenderState) => ReactNode;
  renderFooter?: (state: DockableSidebarRenderState) => ReactNode;
}>;

export function DockableSidebar({
  controller,
  ariaLabel = "Desktop navigation",
  brandMark,
  renderBrandLink,
  renderNav,
  renderFooter,
}: DockableSidebarProps) {
  const {
    visualState,
    preference,
    isCollapsed,
    isExpanded,
    isOverlay,
    isDocked,
    toggleDock,
    focusTrigger,
    registerSidebar,
    registerTrigger,
    sidebarProps,
    triggerProps,
  } = controller;
  const restoreToggleFocusRef = useRef(false);

  const renderState: DockableSidebarRenderState = {
    visualState,
    preference,
    isCollapsed,
    isExpanded,
    isOverlay,
    isDocked,
  };

  const handleToggleClick = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      restoreToggleFocusRef.current =
        document.activeElement === event.currentTarget;
      toggleDock();
    },
    [toggleDock],
  );

  // Preserve keyboard focus across the docked <-> collapsed toggle swap.
  useEffect(() => {
    if (restoreToggleFocusRef.current) {
      restoreToggleFocusRef.current = false;
      focusTrigger();
    }
  }, [focusTrigger, preference]);

  return (
    <aside
      ref={registerSidebar}
      aria-label={ariaLabel}
      data-sidebar-state={visualState}
      data-sidebar-preference={preference}
      {...sidebarProps}
      className={[
        "fixed inset-y-0 left-0 z-50 hidden flex-col overflow-hidden border-r border-line bg-card transition-[width,box-shadow] duration-[180ms] ease-out motion-reduce:transition-none lg:flex",
        isExpanded ? "w-64" : "w-16",
        isOverlay ? "shadow-lg" : "shadow-none",
      ].join(" ")}
    >
      <div className="relative grid h-16 shrink-0 grid-cols-[4rem_1fr] items-center">
        {isDocked ? (
          <>
            {renderBrandLink(renderState)}
            <button
              ref={registerTrigger}
              type="button"
              title="Collapse navigation"
              aria-label="Collapse navigation"
              aria-expanded={true}
              aria-pressed={true}
              data-sidebar-toggle="collapse"
              onClick={handleToggleClick}
              className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <PanelLeftClose
                aria-hidden="true"
                className="h-4 w-4"
                strokeWidth={2}
              />
            </button>
          </>
        ) : (
          <>
            <button
              ref={registerTrigger}
              type="button"
              title="Expand navigation"
              aria-label="Expand navigation"
              aria-expanded={isOverlay}
              aria-pressed={false}
              data-sidebar-trigger="true"
              data-sidebar-toggle="expand"
              onClick={handleToggleClick}
              {...triggerProps}
              className="group relative flex h-16 w-16 items-center justify-center transition-opacity duration-150 ease-out hover:opacity-70 active:opacity-70 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <span
                className={[
                  "absolute flex items-center justify-center transition-opacity duration-[180ms] motion-reduce:transition-none",
                  isOverlay
                    ? "opacity-0"
                    : "group-hover:opacity-0 group-focus-visible:opacity-0",
                ].join(" ")}
              >
                {brandMark}
              </span>
              <PanelLeftOpen
                aria-hidden="true"
                className={[
                  "absolute h-4 w-4 transition-opacity duration-[180ms] motion-reduce:transition-none",
                  isOverlay
                    ? "opacity-100"
                    : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
                ].join(" ")}
                strokeWidth={2}
              />
            </button>
            {isOverlay ? renderBrandLink(renderState) : null}
          </>
        )}
      </div>

      {renderNav(renderState)}
      {renderFooter ? renderFooter(renderState) : null}
    </aside>
  );
}
