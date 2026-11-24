"use client";

import {
  type MutableRefObject,
  useActionState,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { formatTrackedDuration } from "@/lib/resolvers/time-tracking.resolver";
import type {
  TimeTrackingActionState,
  TimeTrackingFormAction,
  TimelineTimeTrackingView,
} from "@/lib/types/timeline";

type TimeTrackerProps = Readonly<{
  occurrenceId: string;
  tracking: TimelineTimeTrackingView;
  canStart: boolean;
  startAction: TimeTrackingFormAction;
  stopAction: TimeTrackingFormAction;
  resetAction: TimeTrackingFormAction;
}>;

const IDLE_STATE: TimeTrackingActionState = {
  status: "idle",
  message: "",
};

export function TimeTracker({
  occurrenceId,
  tracking,
  canStart,
  startAction,
  stopAction,
  resetAction,
}: TimeTrackerProps) {
  const [startState, submitStart, isStarting] = useActionState(
    startAction,
    IDLE_STATE,
  );
  const [stopState, submitStop, isStopping] = useActionState(stopAction, IDLE_STATE);
  const [resetState, submitReset, isResetting] = useActionState(
    resetAction,
    IDLE_STATE,
  );
  const serverTrackingKey = `${tracking.recordedSeconds}:${tracking.runningStartedAt ?? ""}`;
  const [keyedActiveRequest, setKeyedActiveRequest] = useState<Readonly<{
    serverTrackingKey: string;
    requestId: string | null;
  }>>({ serverTrackingKey, requestId: null });
  const activeRequestId =
    keyedActiveRequest.serverTrackingKey === serverTrackingKey
      ? keyedActiveRequest.requestId
      : null;
  const setActiveRequestId = (requestId: string) =>
    setKeyedActiveRequest({ serverTrackingKey, requestId });
  const requestCounter = useRef(0);
  const actionState = resolveActionStateForRequest(
    activeRequestId,
    startState,
    stopState,
    resetState,
  );
  const effectiveTracking = actionState?.tracking ?? tracking;
  const [nowMilliseconds, setNowMilliseconds] = useState<number | null>(null);
  const running = effectiveTracking.runningStartedAt !== null;

  useEffect(() => {
    if (!running) {
      return;
    }

    let interval: number | undefined;
    const refresh = () => setNowMilliseconds(Date.now());
    const stopRefreshing = () => {
      if (interval !== undefined) {
        window.clearInterval(interval);
        interval = undefined;
      }
    };
    const startRefreshing = () => {
      stopRefreshing();
      refresh();
      interval = window.setInterval(refresh, 1000);
    };
    const onVisibilityChange = () => {
      if (document.hidden) {
        stopRefreshing();
      } else {
        startRefreshing();
      }
    };

    if (!document.hidden) {
      startRefreshing();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      stopRefreshing();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [running]);

  const displayedSeconds = useMemo(() => {
    if (!effectiveTracking.runningStartedAt) {
      return effectiveTracking.recordedSeconds;
    }

    const startedMilliseconds = Date.parse(effectiveTracking.runningStartedAt);
    const elapsedSeconds =
      nowMilliseconds !== null && Number.isFinite(startedMilliseconds)
      ? Math.max(0, Math.floor((nowMilliseconds - startedMilliseconds) / 1000))
      : 0;

    return effectiveTracking.recordedSeconds + elapsedSeconds;
  }, [effectiveTracking, nowMilliseconds]);
  const isPending = isStarting || isStopping || isResetting;
  const canReset = running || effectiveTracking.recordedSeconds > 0;
  const showTracker = running || canStart || canReset;
  const showStaticLabel = running || !canStart;

  if (!showTracker) {
    return null;
  }

  return (
    <section className="grid gap-1.5" aria-label="Track time">
      {showStaticLabel ? (
        <h4 className="timeline-time-tracker-strong font-bold leading-5">
          Track time
        </h4>
      ) : (
        <TimeActionForm
          occurrenceId={occurrenceId}
          action={submitStart}
          disabled={isPending}
          label={isStarting ? "Starting..." : "Track Time"}
          onSubmit={() => beginAction("start", requestCounter, setActiveRequestId)}
        />
      )}
      {running || effectiveTracking.recordedSeconds > 0 ? (
        <p className="timeline-time-tracker-strong tabular-nums leading-5">
          {formatTrackedDuration(displayedSeconds)}
        </p>
      ) : null}
      {running || canReset ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {running ? (
            <TimeActionForm
              occurrenceId={occurrenceId}
              action={submitStop}
              disabled={isPending}
              label={isStopping ? "Stopping..." : "Stop"}
              onSubmit={() => beginAction("stop", requestCounter, setActiveRequestId)}
            />
          ) : null}
          {canReset ? (
            <TimeActionForm
              occurrenceId={occurrenceId}
              action={submitReset}
              disabled={isPending}
              label={isResetting ? "Resetting..." : "Reset tracked time"}
              onSubmit={() => beginAction("reset", requestCounter, setActiveRequestId)}
            />
          ) : null}
        </div>
      ) : null}
      {actionState ? (
        <p
          role="status"
          data-status={actionState.status}
          className="timeline-time-tracker-feedback"
        >
          {actionState.message}
        </p>
      ) : null}
    </section>
  );
}

function TimeActionForm({
  occurrenceId,
  action,
  disabled,
  label,
  onSubmit,
}: Readonly<{
  occurrenceId: string;
  action: (formData: FormData) => void;
  disabled: boolean;
  label: string;
  onSubmit: () => string;
}>) {
  return (
    <form
      action={action}
      onSubmit={(event) => {
        const requestId = onSubmit();
        const input = event.currentTarget.elements.namedItem("client_action_id");

        if (input instanceof HTMLInputElement) {
          input.value = requestId;
        }
      }}
    >
      <input type="hidden" name="occurrence_id" value={occurrenceId} />
      <input type="hidden" name="client_action_id" value="" />
      <button
        type="submit"
        className="timeline-time-tracker-action product-action min-h-11 py-2 text-sm font-bold"
        disabled={disabled}
      >
        {label}
      </button>
    </form>
  );
}

export function resolveActionStateForRequest(
  activeRequestId: string | null,
  startState: TimeTrackingActionState,
  stopState: TimeTrackingActionState,
  resetState: TimeTrackingActionState,
): TimeTrackingActionState | null {
  if (!activeRequestId) {
    return null;
  }

  return [startState, stopState, resetState].find(
    (state) => state.requestId === activeRequestId,
  ) ?? null;
}

function beginAction(
  action: "start" | "stop" | "reset",
  requestCounter: MutableRefObject<number>,
  setActiveRequestId: (requestId: string) => void,
): string {
  requestCounter.current += 1;
  const requestId = `${action}-${requestCounter.current}`;

  setActiveRequestId(requestId);
  return requestId;
}
