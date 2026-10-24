"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { useRefresh } from "@cadence/ui/runtime";
import { Check, CircleDashed, X } from "lucide-react";

import {
  type CompletionChimeIntent,
  playCompletionChime,
  prepareCompletionChimeForUserGesture,
  shouldPlayCompletionChime,
  shouldPlayCompletionChimeForStatusSuccess,
} from "@/lib/ui/completion-feedback";
import type {
  OccurrenceActionState,
  OccurrenceFormAction,
  TimelineStatus,
} from "@/lib/types/timeline";
import type { TimelineStatusActionStatus } from "@/lib/resolvers/timeline-optimistic-status.resolver";
import { useCompletionPlaceCapture } from "@/components/travel/PlaceLabels";

type StatusButtonsProps = Readonly<{
  occurrenceId: string;
  currentStatus: TimelineStatus;
  action: OccurrenceFormAction;
  compact?: boolean;
  singleLine?: boolean;
  iconOnly?: boolean;
  includeUnresolved?: boolean;
  unresolvedLabel?: string;
  disabled?: boolean;
  pendingStatus?: TimelineStatusActionStatus | null;
  onStatusSubmit?: (status: TimelineStatusActionStatus) => void;
  onStatusSuccess?: (status: TimelineStatusActionStatus | null) => void;
  onStatusError?: () => void;
}>;

type StatusButtonValue = TimelineStatusActionStatus;
type StatusFormAction = (formData: FormData) => void;

export type StatusSubmissionEventHandlers = Readonly<{
  onPointerDown: () => void;
  onClick: () => void;
  onSubmit: () => void;
}>;

export function createStatusSubmissionEventHandlers({
  onStatusIntent,
  onStatusSubmit,
}: Readonly<{
  onStatusIntent: () => void;
  onStatusSubmit?: () => void;
}>): StatusSubmissionEventHandlers {
  return {
    onPointerDown: onStatusIntent,
    onClick: onStatusIntent,
    onSubmit: () => {
      onStatusIntent();
      onStatusSubmit?.();
    },
  };
}

type MutableRef<Value> = {
  current: Value;
};

export function captureCompletionChimeIntent({
  currentStatus,
  submittedStatus,
  completionChimeIntentRef,
  preparedChimeForSubmitRef,
  prepareChime,
}: Readonly<{
  currentStatus: TimelineStatus;
  submittedStatus: StatusButtonValue | null;
  completionChimeIntentRef: MutableRef<CompletionChimeIntent | null>;
  preparedChimeForSubmitRef: MutableRef<boolean>;
  prepareChime: () => void;
}>): void {
  if (!submittedStatus) {
    completionChimeIntentRef.current = null;
    preparedChimeForSubmitRef.current = false;
    return;
  }

  const intent: CompletionChimeIntent = {
    currentStatus,
    submittedStatus,
  };
  const shouldChimeAfterSuccess = shouldPlayCompletionChime({
    currentStatus: intent.currentStatus,
    nextStatus: intent.submittedStatus,
  });

  if (shouldChimeAfterSuccess && !preparedChimeForSubmitRef.current) {
    prepareChime();
    preparedChimeForSubmitRef.current = true;
  }

  if (!shouldChimeAfterSuccess) {
    preparedChimeForSubmitRef.current = false;
  }

  completionChimeIntentRef.current = intent;
}

export function startCompletionChimeAndRefresh({
  shouldChime,
  playChime,
  refresh,
}: Readonly<{
  shouldChime: boolean;
  playChime: () => Promise<void>;
  refresh: () => void;
}>): void {
  if (shouldChime) {
    void playChime();
  }

  refresh();
}

const EMPTY_ACTION_STATE: OccurrenceActionState = {
  status: "idle",
  message: "",
};

export function StatusButtons({
  occurrenceId,
  currentStatus,
  action,
  compact = false,
  singleLine = false,
  iconOnly = false,
  includeUnresolved = false,
  unresolvedLabel = "Unmark",
  disabled = false,
  pendingStatus = null,
  onStatusSubmit,
  onStatusSuccess,
  onStatusError,
}: StatusButtonsProps) {
  const [state, formAction, isPending] = useActionState(
    action,
    EMPTY_ACTION_STATE,
  );
  const refresh = useRefresh();
  const capturePlace = useCompletionPlaceCapture();
  const completionChimeIntentRef = useRef<CompletionChimeIntent | null>(null);
  const preparedChimeForSubmitRef = useRef(false);

  useEffect(() => {
    if (state.status === "success") {
      const confirmedStatus = state.nextStatus ?? null;
      const shouldChimeAfterSuccess = shouldPlayCompletionChimeForStatusSuccess(
        {
          intent: completionChimeIntentRef.current,
          serverNextStatus: confirmedStatus,
        },
      );
      const refreshTimeline = () => {
        refresh();
        onStatusSuccess?.(confirmedStatus);
      };

      startCompletionChimeAndRefresh({
        shouldChime: shouldChimeAfterSuccess,
        playChime: playCompletionChime,
        refresh: refreshTimeline,
      });
      // Ticket 216: only a first resolution to Completed on this device can be labeled.
      if (confirmedStatus === "completed" && completionChimeIntentRef.current?.currentStatus === "unresolved") {
        capturePlace?.(occurrenceId);
      }

      completionChimeIntentRef.current = null;
      preparedChimeForSubmitRef.current = false;
    }

    if (state.status === "error") {
      completionChimeIntentRef.current = null;
      preparedChimeForSubmitRef.current = false;
      refresh();
      onStatusError?.();
    }
  }, [capturePlace, occurrenceId, onStatusError, onStatusSuccess, refresh, state]);

  function prepareForSubmittedStatus(submittedStatus: StatusButtonValue | null) {
    captureCompletionChimeIntent({
      currentStatus,
      submittedStatus,
      completionChimeIntentRef,
      preparedChimeForSubmitRef,
      prepareChime: prepareCompletionChimeForUserGesture,
    });
  }

  return (
    <div
      className={
        compact
          ? "grid gap-2"
          : singleLine
            ? "grid min-w-max gap-2"
            : "grid gap-2 sm:w-auto"
      }
    >
      <div
        className={
          compact
            ? "flex flex-wrap items-center gap-x-4 gap-y-2"
            : singleLine
              ? "flex items-center justify-end gap-x-2"
              : "flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-2 sm:w-auto sm:justify-end"
        }
      >
        <StatusSubmitForm
          occurrenceId={occurrenceId}
          currentStatus={currentStatus}
          status="completed"
          label="Completed"
          action={formAction}
          onStatusIntent={prepareForSubmittedStatus}
          onStatusSubmit={onStatusSubmit}
          disabled={disabled || isPending}
          pendingStatus={pendingStatus}
          iconOnly={iconOnly}
          singleLine={singleLine}
        />
        <StatusSubmitForm
          occurrenceId={occurrenceId}
          currentStatus={currentStatus}
          status="not_completed"
          label="Not Completed"
          action={formAction}
          onStatusIntent={prepareForSubmittedStatus}
          onStatusSubmit={onStatusSubmit}
          disabled={disabled || isPending}
          pendingStatus={pendingStatus}
          iconOnly={iconOnly}
          singleLine={singleLine}
        />
        {includeUnresolved ? (
          <StatusSubmitForm
            occurrenceId={occurrenceId}
            currentStatus={currentStatus}
            status="unresolved"
            label={unresolvedLabel}
            action={formAction}
            onStatusIntent={prepareForSubmittedStatus}
            onStatusSubmit={onStatusSubmit}
            disabled={disabled || isPending}
            pendingStatus={pendingStatus}
            iconOnly={iconOnly}
            singleLine={singleLine}
          />
        ) : null}
      </div>
      <ActionMessage state={state} />
    </div>
  );
}

function StatusSubmitForm({
  occurrenceId,
  currentStatus,
  status,
  label,
  action,
  onStatusIntent,
  onStatusSubmit,
  disabled,
  pendingStatus,
  singleLine,
  iconOnly,
}: Readonly<{
  occurrenceId: string;
  currentStatus: TimelineStatus;
  status: StatusButtonValue;
  label: string;
  action: StatusFormAction;
  onStatusIntent: (status: StatusButtonValue) => void;
  onStatusSubmit?: (status: StatusButtonValue) => void;
  disabled: boolean;
  pendingStatus: StatusButtonValue | null;
  singleLine: boolean;
  iconOnly: boolean;
}>) {
  const submissionEventHandlers = createStatusSubmissionEventHandlers({
    onStatusIntent: () => {
      onStatusIntent(status);
    },
    onStatusSubmit: () => {
      onStatusSubmit?.(status);
    },
  });

  return (
    <form
      action={action}
      onSubmit={submissionEventHandlers.onSubmit}
      className="contents"
    >
      <input type="hidden" name="occurrence_id" value={occurrenceId} />
      <input type="hidden" name="expected_status" value={currentStatus} />
      <input type="hidden" name="status" value={status} />
      <StatusSubmitButton
        status={status}
        label={label}
        onPointerDown={submissionEventHandlers.onPointerDown}
        onClick={submissionEventHandlers.onClick}
        disabled={disabled}
        pendingStatus={pendingStatus}
        iconOnly={iconOnly}
        singleLine={singleLine}
      />
    </form>
  );
}

function StatusSubmitButton({
  status,
  label,
  onPointerDown,
  onClick,
  disabled,
  pendingStatus,
  singleLine,
  iconOnly,
}: Readonly<{
  status: StatusButtonValue;
  label: string;
  onPointerDown?: () => void;
  onClick?: () => void;
  disabled: boolean;
  pendingStatus: StatusButtonValue | null;
  singleLine: boolean;
  iconOnly: boolean;
}>) {
  const { pending } = useFormStatus();
  const Icon =
    status === "completed"
      ? Check
      : status === "not_completed"
        ? X
        : CircleDashed;
  const isSavingThisStatus = pending || pendingStatus === status;

  return (
    <button
      type="submit"
      disabled={pending || disabled}
      aria-disabled={pending || disabled ? "true" : undefined}
      title={iconOnly ? label : undefined}
      data-single-line={singleLine ? "true" : undefined}
      onClick={onClick}
      onPointerDown={onPointerDown}
      className={[
        "timeline-status-action product-action product-action-primary pointer-events-auto min-h-11 gap-1.5 whitespace-nowrap py-1 font-bold",
        singleLine
          ? "min-w-11 px-1 text-base sm:min-h-8 sm:px-0 sm:text-sm"
          : "text-sm sm:min-h-8",
      ].join(" ")}
    >
      <Icon
        aria-hidden="true"
        size={singleLine ? 16 : 14}
        strokeWidth={2.5}
      />
      <span className={iconOnly ? "sr-only" : undefined}>{isSavingThisStatus ? `Saving ${label}...` : label}</span>
    </button>
  );
}

function ActionMessage({ state }: Readonly<{ state: OccurrenceActionState }>) {
  if (state.status === "idle" || !state.message) {
    return null;
  }

  return (
    <p
      className={[
        "border-t border-line pt-2 text-sm leading-6",
        state.status === "success" ? "text-foreground" : "text-accent",
      ].join(" ")}
      role={state.status === "error" ? "alert" : "status"}
    >
      {state.message}
    </p>
  );
}
