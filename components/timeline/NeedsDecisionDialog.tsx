"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { X } from "lucide-react";

import { OPEN_NEEDS_DECISION_EVENT } from "@/lib/ui/advisor";

const FOCUSABLE_SELECTOR =
  'summary, a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

type NeedsDecisionDialogProps = Readonly<{
  title: string;
  occurrenceCount: number;
  hasRetainedRows?: boolean;
  children: ReactNode;
}>;

export function NeedsDecisionDialog({
  title,
  occurrenceCount,
  hasRetainedRows = false,
  children,
}: NeedsDecisionDialogProps) {
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const dialogId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const hasDecisions = occurrenceCount > 0;

  // A tip's "Open Needs decision" link opens this dialog from the advisor.
  useEffect(() => {
    const open = () => setIsOpen(true);
    window.addEventListener(OPEN_NEEDS_DECISION_EVENT, open);
    return () => window.removeEventListener(OPEN_NEEDS_DECISION_EVENT, open);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const previousElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const launcherElement = openButtonRef.current;

    closeButtonRef.current?.focus({ preventScroll: true });
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const dialog = dialogRef.current;

      if (!dialog) {
        return;
      }

      const focusableElements = getFocusableElements(dialog);

      if (focusableElements.length === 0) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement;

      if (!dialog.contains(activeElement)) {
        event.preventDefault();
        firstElement.focus({ preventScroll: true });
        return;
      }

      if (event.shiftKey && activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus({ preventScroll: true });
        return;
      }

      if (!event.shiftKey && activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus({ preventScroll: true });
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      document.removeEventListener("keydown", handleKeyDown);

      // WebKit pointer clicks can leave body focused instead of the launcher.
      if (launcherElement?.isConnected) {
        launcherElement.focus({ preventScroll: true });
      } else if (previousElement?.isConnected) {
        previousElement.focus({ preventScroll: true });
      }
    };
  }, [isOpen]);

  function openDialog() {
    setIsOpen(true);
  }

  function handleBackdropClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) {
      setIsOpen(false);
    }
  }

  return (
    <>
      <button
        ref={openButtonRef}
        type="button"
        aria-controls={dialogId}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label={decisionButtonLabel(occurrenceCount, hasRetainedRows)}
        onClick={openDialog}
        className={[
          "fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-4 right-4 z-40 flex items-stretch justify-between border text-left transition-colors sm:bottom-6 sm:left-auto sm:right-6 sm:max-w-[calc(100vw-2rem)]",
          hasDecisions
            ? "border-line bg-primary text-primary-foreground hover:bg-foreground"
            : "border-line bg-background text-foreground hover:bg-surface",
        ].join(" ")}
      >
        <span
          className="grid min-h-14 min-w-14 place-items-center px-3 text-2xl font-bold leading-none"
          aria-hidden="true"
        >
          {occurrenceCount}
        </span>
        <span className="grid min-h-14 flex-1 content-center px-3 py-2 sm:flex-none">
          <span className="text-sm font-bold leading-5">{title}</span>
          <span className="text-xs font-bold leading-5">
            {decisionButtonDetail(occurrenceCount, hasRetainedRows)}
          </span>
        </span>
      </button>

      {isOpen ? (
        <div
          className="fixed inset-0 z-50 grid bg-foreground/50 sm:place-items-center sm:p-4"
          onMouseDown={handleBackdropClick}
        >
          <section
            id={dialogId}
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            tabIndex={-1}
            className="relative flex h-dvh w-full flex-col overflow-hidden bg-background text-foreground sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:w-[min(920px,100%)] sm:border sm:border-line"
          >
            <button
              ref={closeButtonRef}
              type="button"
              aria-label="Close Needs decision"
              title="Close"
              onClick={() => setIsOpen(false)}
              className="product-icon-action absolute right-2 top-[max(0.5rem,env(safe-area-inset-top))] z-10 min-h-11 min-w-11 shrink-0 bg-background sm:right-3 sm:top-3 sm:min-h-10 sm:min-w-10"
            >
              <X aria-hidden="true" size={18} strokeWidth={2.5} />
            </button>

            <div className="min-h-0 flex-1 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              {children}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

export function getFocusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) =>
      !element.hasAttribute("disabled") &&
      element.getAttribute("aria-hidden") !== "true" &&
      isRendered(element),
  );
}

function isRendered(element: HTMLElement): boolean {
  return typeof element.checkVisibility === "function"
    ? element.checkVisibility({ checkVisibilityCSS: true })
    : element.getClientRects().length > 0;
}

function decisionButtonDetail(count: number, hasRetainedRows: boolean): string {
  if (count === 0 && hasRetainedRows) {
    return "Review decisions from today";
  }

  return `${count} to decide`;
}

function decisionButtonLabel(count: number, hasRetainedRows: boolean): string {
  if (count === 0 && hasRetainedRows) {
    return "Open Needs decision, no prior unresolved occurrences, review decisions from today";
  }

  if (count === 1) {
    return "Open Needs decision, 1 prior unresolved occurrence";
  }

  return `Open Needs decision, ${count} prior unresolved occurrences`;
}
