"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
  type TouchEvent as ReactTouchEvent,
} from "react";
import { useRouter } from "next/navigation";

import {
  beginPullToRefresh,
  claimPullToRefreshRequest,
  continuePullToRefresh,
  IDLE_PULL_TO_REFRESH_STATE,
  MOBILE_TIMELINE_MAX_WIDTH,
  PULL_TO_REFRESH_THRESHOLD,
  type PullToRefreshState,
} from "@/components/timeline/mobile-pull-to-refresh";
import { reloadWebTimelineConnectors } from "@/lib/ui/timeline-connector-reloads";
import {
  hasTimelineScrollableAncestor,
  isTimelineInteractiveTarget,
  isTimelineModalOpen,
  useTimelineWheelReload,
} from "@/lib/ui/timeline-wheel-reload";

const RESULT_DURATION_MS = 2_400;

type MobileTimelinePullToRefreshProps = Readonly<{
  children: ReactNode;
}>;

export function MobileTimelinePullToRefresh({
  children,
}: MobileTimelinePullToRefreshProps) {
  const router = useRouter();
  const [pullState, setPullState] =
    useState<PullToRefreshState>(IDLE_PULL_TO_REFRESH_STATE);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [resultMessage, setResultMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const pullStateRef = useRef<PullToRefreshState>(IDLE_PULL_TO_REFRESH_STATE);
  const refreshInFlightRef = useRef(false);
  const connectorSuccessRef = useRef<boolean | null>(null);
  const sawPendingRef = useRef(false);
  const resultTimerRef = useRef<number | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isRefreshing) {
      return;
    }

    if (isPending) {
      sawPendingRef.current = true;
      return;
    }

    if (!sawPendingRef.current || connectorSuccessRef.current === null) return;

    refreshInFlightRef.current = false;
    setIsRefreshing(false);
    setResultMessage(connectorSuccessRef.current
      ? "Cadence and connectors reloaded."
      : "Reload incomplete. Cadence or connector data may be stale.");
    connectorSuccessRef.current = null;
    sawPendingRef.current = false;
    if (resultTimerRef.current !== null) window.clearTimeout(resultTimerRef.current);
    resultTimerRef.current = window.setTimeout(() => setResultMessage(""), RESULT_DURATION_MS);
  }, [isPending, isRefreshing]);

  useEffect(() => () => {
    if (resultTimerRef.current !== null) window.clearTimeout(resultTimerRef.current);
  }, []);

  const updatePullState = useCallback((nextState: PullToRefreshState) => {
    pullStateRef.current = nextState;
    setPullState(nextState);
  }, []);

  const resetPull = useCallback(() => {
    updatePullState(IDLE_PULL_TO_REFRESH_STATE);
  }, [updatePullState]);

  const requestRefresh = useCallback(() => {
    if (refreshInFlightRef.current) {
      return;
    }

    if (!navigator.onLine) {
      setResultMessage("Reload failed while offline. Displayed data may be stale.");
      if (resultTimerRef.current !== null) window.clearTimeout(resultTimerRef.current);
      resultTimerRef.current = window.setTimeout(() => setResultMessage(""), RESULT_DURATION_MS);
      return;
    }

    refreshInFlightRef.current = true;
    connectorSuccessRef.current = null;
    sawPendingRef.current = false;
    setResultMessage("");
    setIsRefreshing(true);
    startTransition(async () => {
      try {
        router.refresh();
        connectorSuccessRef.current = await reloadWebTimelineConnectors();
      } catch {
        connectorSuccessRef.current = false;
      }
    });
  }, [router, startTransition]);

  useTimelineWheelReload({
    rootRef: wrapperRef,
    reloadInFlightRef: refreshInFlightRef,
    onReload: requestRefresh,
  });

  const handleTouchMove = useCallback(
    (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        resetPull();
        return;
      }

      const touch = event.touches[0];
      const nextPullState = continuePullToRefresh(pullStateRef.current, {
        x: touch.clientX,
        y: touch.clientY,
      });

      if (nextPullState.phase === "pulling") {
        // React delegates touchmove passively. This native non-passive listener
        // prevents native refresh and a synthetic disclosure click only after
        // the gesture has locked to a downward pull.
        event.preventDefault();
      }

      updatePullState(nextPullState);
    },
    [resetPull, updatePullState],
  );

  useEffect(() => {
    const wrapper = wrapperRef.current;

    if (!wrapper) {
      return;
    }

    wrapper.addEventListener("touchmove", handleTouchMove, { passive: false });

    return () => {
      wrapper.removeEventListener("touchmove", handleTouchMove);
    };
  }, [handleTouchMove]);

  function handleTouchStart(event: ReactTouchEvent<HTMLDivElement>) {
    if (event.touches.length !== 1) {
      resetPull();
      return;
    }

    const touch = event.touches[0];
    const target = event.target instanceof Element ? event.target : null;
    const startedOnInteractiveElement = isTimelineInteractiveTarget(target);

    updatePullState(
      beginPullToRefresh({
        isMobile: window.innerWidth <= MOBILE_TIMELINE_MAX_WIDTH,
        isAtScrollTop: !hasTimelineScrollableAncestor(target, wrapperRef.current!) && getNearestScrollTop(target) <= 0,
        isModalOpen: isTimelineModalOpen(),
        startedOnInteractiveElement,
        x: touch.clientX,
        y: touch.clientY,
      }),
    );
  }

  function handleTouchEnd() {
    const refreshRequest = claimPullToRefreshRequest(
      pullStateRef.current,
      refreshInFlightRef.current,
    );
    resetPull();

    if (refreshRequest.shouldRefresh) {
      requestRefresh();
    }
  }

  const isPulling = pullState.phase === "pulling";
  const isReadyToRefresh =
    isPulling && pullState.distance >= PULL_TO_REFRESH_THRESHOLD;
  const feedback = isRefreshing
    ? "Reloading Cadence and connectors"
    : isReadyToRefresh
      ? "Release to refresh"
      : "Pull to refresh";

  return (
    <div
      ref={wrapperRef}
      data-timeline-pull-to-refresh
      data-pull-state={isRefreshing ? "refreshing" : pullState.phase}
      className="timeline-pull-to-refresh"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={resetPull}
    >
      {isPulling || isRefreshing || resultMessage ? (
        <p
          aria-live="polite"
          className="pointer-events-none fixed left-1/2 top-[calc(4rem+max(0.5rem,env(safe-area-inset-top)))] z-30 -translate-x-1/2 border border-line bg-background px-3 py-1.5 text-xs text-muted-readable motion-safe:transition-opacity motion-reduce:transition-none"
          role="status"
        >
          {resultMessage || feedback}
        </p>
      ) : null}
      {children}
    </div>
  );
}

function getPageScrollTop(): number {
  return Math.max(
    window.scrollY,
    document.documentElement.scrollTop,
    document.body.scrollTop,
  );
}

function getNearestScrollTop(target: Element | null): number {
  let element = target;

  while (element && element !== document.body && element !== document.documentElement) {
    const { overflowY } = window.getComputedStyle(element);

    if (
      /^(auto|overlay|scroll)$/.test(overflowY) &&
      element.scrollHeight > element.clientHeight
    ) {
      return element.scrollTop;
    }

    element = element.parentElement;
  }

  return getPageScrollTop();
}
