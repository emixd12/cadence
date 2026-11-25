import { getLocalStorage } from "@/lib/ui/browser-storage";

export const SIDEBAR_STORAGE_KEY = "sidebar-open";
export const SIDEBAR_HOVER_DISMISS_DELAY_MS = 160;
export const SIDEBAR_TRANSITION_DURATION_MS = 180;

/** Persistent user layout preference for the desktop navigation sidebar. */
export type SidebarDockPreference = "docked" | "collapsed";

/** Visual presentation state derived from persistent preference and transient hover state. */
export type SidebarVisualState = "collapsed" | "overlay" | "docked";

export type SidebarState = Readonly<{
  /** Persistent docking preference ("docked" reserves layout space; "collapsed" keeps the compact rail). */
  preference: SidebarDockPreference;
  /** Transient hover-to-reveal overlay state; only takes effect when preference === "collapsed". */
  isHoverOpen: boolean;
  /**
   * Prevents immediate hover re-expansion after dismissing an overlay (e.g. Escape)
   * until the pointer leaves the sidebar/trigger region.
   */
  hoverSuppressed: boolean;
}>;

export type SidebarEvent =
  | Readonly<{ type: "hydrate_preference"; preference: SidebarDockPreference }>
  | Readonly<{ type: "hover_trigger_enter" }>
  | Readonly<{ type: "hover_dismiss" }>
  | Readonly<{ type: "pointer_left_region" }>
  | Readonly<{ type: "toggle_dock"; suppressHover?: boolean }>
  | Readonly<{
      type: "set_preference";
      preference: SidebarDockPreference;
      suppressHover?: boolean;
    }>
  | Readonly<{ type: "dismiss_overlay"; suppressHover?: boolean }>;

export function createInitialSidebarState(
  defaultPreference: SidebarDockPreference = "docked",
): SidebarState {
  return {
    preference: defaultPreference,
    isHoverOpen: false,
    hoverSuppressed: false,
  };
}

export function deriveSidebarVisualState(
  state: SidebarState,
): SidebarVisualState {
  if (state.preference === "docked") {
    return "docked";
  }

  return state.isHoverOpen ? "overlay" : "collapsed";
}

export function reduceSidebarState(
  state: SidebarState,
  event: SidebarEvent,
): SidebarState {
  switch (event.type) {
    case "hydrate_preference":
      if (event.preference === "docked") {
        return {
          preference: "docked",
          isHoverOpen: false,
          hoverSuppressed: false,
        };
      }

      return {
        preference: "collapsed",
        isHoverOpen: false,
        hoverSuppressed: false,
      };

    case "hover_trigger_enter":
      if (state.preference === "docked" || state.hoverSuppressed) {
        return state;
      }

      if (state.isHoverOpen) {
        return state;
      }

      return {
        ...state,
        isHoverOpen: true,
      };

    case "hover_dismiss":
      if (!state.isHoverOpen && !state.hoverSuppressed) {
        return state;
      }

      return {
        ...state,
        isHoverOpen: false,
        hoverSuppressed: false,
      };

    case "pointer_left_region":
      if (!state.hoverSuppressed) {
        return state;
      }

      return {
        ...state,
        hoverSuppressed: false,
      };

    case "toggle_dock":
      if (state.preference === "docked") {
        return {
          preference: "collapsed",
          isHoverOpen: false,
          hoverSuppressed: Boolean(event.suppressHover),
        };
      }

      return {
        preference: "docked",
        isHoverOpen: false,
        hoverSuppressed: false,
      };

    case "set_preference":
      if (event.preference === "docked") {
        return {
          preference: "docked",
          isHoverOpen: false,
          hoverSuppressed: false,
        };
      }

      return {
        preference: "collapsed",
        isHoverOpen: false,
        hoverSuppressed: Boolean(event.suppressHover),
      };

    case "dismiss_overlay":
      if (state.preference !== "collapsed" || !state.isHoverOpen) {
        return state;
      }

      return {
        ...state,
        isHoverOpen: false,
        hoverSuppressed: Boolean(event.suppressHover),
      };
  }
}

export function parseSidebarDockPreference(
  raw: string | null,
): SidebarDockPreference | null {
  if (raw === "true" || raw === "docked") {
    return "docked";
  }

  if (raw === "false" || raw === "collapsed") {
    return "collapsed";
  }

  return null;
}

export function serializeSidebarDockPreference(
  preference: SidebarDockPreference,
): "true" | "false" {
  return preference === "docked" ? "true" : "false";
}

export function readStoredSidebarPreference(
  storage?: Pick<Storage, "getItem"> | null,
  storageKey = SIDEBAR_STORAGE_KEY,
): SidebarDockPreference | null {
  try {
    const target = storage === undefined ? getLocalStorage() : storage;

    if (!target) {
      return null;
    }

    return parseSidebarDockPreference(target.getItem(storageKey));
  } catch {
    return null;
  }
}

export function writeStoredSidebarPreference(
  preference: SidebarDockPreference,
  storage?: Pick<Storage, "setItem"> | null,
  storageKey = SIDEBAR_STORAGE_KEY,
): void {
  try {
    const target = storage === undefined ? getLocalStorage() : storage;

    if (!target) {
      return;
    }

    target.setItem(storageKey, serializeSidebarDockPreference(preference));
  } catch {
    // Persistence is a convenience; the sidebar still works without it.
  }
}
