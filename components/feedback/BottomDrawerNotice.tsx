"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * The shared bottom drawer for short notifications (owner decision, 2026-11-18). It
 * looks like the Calendar preview drawer: full width at the bottom, one Ash Line on
 * top, no fill, shadow or box, 16px padding, a Close action. It never takes focus.
 *
 * Each notification chooses how it ends: `autoCloseMs` closes it after that long,
 * or `null` waits for Close. The timer pauses while the pointer or keyboard focus is
 * inside, and starts over when they leave, so nobody loses it while using it. Only
 * use a timer when everything in the drawer can also be done elsewhere.
 */
export type BottomDrawerNoticeProps = Readonly<{
  children: ReactNode;
  onClose: () => void;
  /** Milliseconds before it closes by itself; null waits for Close. */
  autoCloseMs?: number | null;
  /** Announced politely by default; "alert" for something the person must act on now. */
  announce?: "status" | "alert";
  closeLabel?: string;
  /** Extra attribute for tests and tools, such as `data-move-toast`. */
  dataAttribute?: string;
}>;

export function BottomDrawerNotice({
  children,
  onClose,
  autoCloseMs = null,
  announce = "status",
  closeLabel = "Close",
  dataAttribute,
}: BottomDrawerNoticeProps) {
  const [paused, setPaused] = useState(false);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (autoCloseMs === null || paused) return;
    const timer = window.setTimeout(() => onCloseRef.current(), autoCloseMs);
    return () => window.clearTimeout(timer);
  }, [autoCloseMs, paused]);

  const drawer = (
    <div
      role={announce}
      data-bottom-drawer=""
      {...(dataAttribute ? { [dataAttribute]: "" } : {})}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPaused(false);
      }}
      className="fixed inset-x-0 bottom-0 z-[45] border-t border-line bg-background pb-[env(safe-area-inset-bottom)] text-foreground"
    >
      <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)_auto] gap-x-3 p-4">
        <div className="grid min-w-0 gap-2">{children}</div>
        <button
          type="button"
          aria-label={closeLabel}
          title={closeLabel}
          onClick={onClose}
          className="product-icon-action -mr-2 -mt-2 min-h-11 min-w-11 shrink-0 self-start sm:min-h-10 sm:min-w-10"
        >
          <X aria-hidden="true" size={16} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
  return typeof document === "undefined" ? drawer : createPortal(drawer, document.body);
}
