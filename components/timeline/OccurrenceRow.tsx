"use client";

import { useCallback, useId, useState, type ReactNode } from "react";
import type { TimelineOccurrenceContext } from "@cadence/core/types/day-progress";
import type { NoteShortcut } from "@cadence/core/types/note-shortcut";

import { OccurrenceNoteForm } from "@/components/timeline/OccurrenceNoteForm";
import { StatusButtons } from "@/components/timeline/StatusButtons";
import { TimeTracker } from "@/components/timeline/TimeTracker";
import {
  beginOptimisticStatus,
  confirmOptimisticStatus,
  EMPTY_OPTIMISTIC_STATUS_STATE,
  type OptimisticTimelineStatusState,
  resolveOptimisticOccurrenceView,
  rollbackOptimisticStatus,
  type TimelineStatusActionStatus,
} from "@/lib/resolvers/timeline-optimistic-status.resolver";
import type {
  OccurrenceFormAction,
  TimeTrackingFormAction,
  TimelineOccurrenceView,
} from "@/lib/types/timeline";

type OccurrenceRowProps = Readonly<{
  occurrence: TimelineOccurrenceView;
  statusAction: OccurrenceFormAction;
  noteAction: OccurrenceFormAction;
  startTimeTrackingAction: TimeTrackingFormAction;
  stopTimeTrackingAction: TimeTrackingFormAction;
  resetTimeTrackingAction: TimeTrackingFormAction;
  shortcuts?: readonly NoteShortcut[];
  statusIconsOnly?: boolean;
  context?: TimelineOccurrenceContext;
  travelDetails?: ReactNode;
}>;

type KeyedOptimisticStatusState = Readonly<{
  serverStatusKey: string;
  value: OptimisticTimelineStatusState;
}>;

const ROW_TONE_CLASSES: Record<TimelineOccurrenceView["visualTone"], string> = {
  default: "bg-background text-foreground hover:bg-timeline-row-hover",
  needs_decision:
    "bg-surface text-foreground hover:bg-timeline-needs-decision-hover",
  completed: "bg-primary text-primary-foreground hover:bg-timeline-completed-hover",
  not_completed: "bg-accent text-primary-foreground hover:bg-accent",
};

const TIME_TONE_CLASSES: Record<TimelineOccurrenceView["visualTone"], string> = {
  default: "text-muted-readable",
  needs_decision: "text-foreground",
  completed: "text-primary-foreground",
  not_completed: "text-primary-foreground",
};

const RESOLVED_LABEL_CLASSES: Record<TimelineOccurrenceView["visualTone"], string> = {
  default: "text-muted-readable",
  needs_decision: "text-foreground",
  completed: "text-primary-foreground",
  not_completed: "text-primary-foreground",
};

type LabelDensity = "normal" | "compact";

export function OccurrenceRow({
  occurrence,
  statusAction,
  noteAction,
  startTimeTrackingAction,
  stopTimeTrackingAction,
  resetTimeTrackingAction,
  shortcuts,
  statusIconsOnly = false,
  context,
  travelDetails,
}: OccurrenceRowProps) {
  const serverStatusKey = [
    occurrence.id,
    occurrence.status,
    occurrence.statusMarkedAt ?? "",
  ].join(":");
  const [keyedOptimisticStatus, setKeyedOptimisticStatus] =
    useState<KeyedOptimisticStatusState>({
      serverStatusKey,
      value: EMPTY_OPTIMISTIC_STATUS_STATE,
    });
  const optimisticStatus =
    keyedOptimisticStatus.serverStatusKey === serverStatusKey
      ? keyedOptimisticStatus.value
      : EMPTY_OPTIMISTIC_STATUS_STATE;
  const optimisticView = resolveOptimisticOccurrenceView(
    occurrence,
    optimisticStatus,
  );
  const visibleOccurrence = optimisticView.occurrence;
  const instanceId = useId();
  const detailsId = `${visibleOccurrence.id}-${instanceId}-details`;
  const pendingStatusLabel = optimisticStatus.pendingStatus
    ? statusLabel(optimisticStatus.pendingStatus)
    : null;
  const labelDensity = getLabelDensity({
    title: visibleOccurrence.title,
    shouldProtectActionSpace: optimisticView.showPrimaryStatusActions,
  });
  const summaryActionSpaceClass = optimisticView.showPrimaryStatusActions
    ? "pr-56"
    : visibleOccurrence.showCollapsedStatusLabel
      ? "pr-36 sm:pr-40"
      : "pr-0";
  const titleActionBufferClass = optimisticView.showPrimaryStatusActions
    ? "pr-4 sm:pr-5"
    : "";

  const handleOptimisticStatus = useCallback(
    (nextStatus: TimelineStatusActionStatus) => {
      setKeyedOptimisticStatus({
        serverStatusKey,
        value: beginOptimisticStatus(nextStatus),
      });
    },
    [serverStatusKey],
  );
  const handleStatusConfirmed = useCallback(
    (nextStatus: TimelineStatusActionStatus | null) => {
      setKeyedOptimisticStatus({
        serverStatusKey,
        value: confirmOptimisticStatus(nextStatus),
      });
    },
    [serverStatusKey],
  );
  const handleStatusRejected = useCallback(() => {
    setKeyedOptimisticStatus({
      serverStatusKey,
      value: rollbackOptimisticStatus(),
    });
  }, [serverStatusKey]);

  return (
    <article
      data-occurrence-id={visibleOccurrence.id}
      aria-busy={optimisticView.isPending ? "true" : undefined}
      data-optimistic-status={optimisticStatus.pendingStatus ?? undefined}
      data-visual-tone={visibleOccurrence.visualTone}
      className={[
        "timeline-occurrence-row transition-colors",
        ROW_TONE_CLASSES[visibleOccurrence.visualTone],
      ].join(" ")}
    >
      {pendingStatusLabel ? (
        <p className="sr-only" role="status">
          Saving {pendingStatusLabel} status.
        </p>
      ) : null}
      <div className="timeline-occurrence-row-grid grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-0">
        <details
          className="group col-start-1 col-end-3 row-start-1 min-w-0"
        >
          <summary
            aria-controls={detailsId}
            aria-describedby={context ? `${detailsId}-context` : undefined}
            data-label-density={labelDensity}
            className={[
              "product-disclosure-trigger timeline-occurrence-summary grid min-h-12 items-center py-1.5 pl-3 sm:py-2 sm:pl-4",
              summaryActionSpaceClass,
            ].join(" ")}
          >
            <div className="timeline-occurrence-main col-start-1 grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] items-center gap-2 sm:grid-cols-[5.75rem_minmax(0,1fr)] sm:gap-1">
              <time
                dateTime={visibleOccurrence.scheduledFor}
                className={[
                  "timeline-occurrence-time min-w-0 whitespace-nowrap text-sm font-bold leading-5",
                  TIME_TONE_CLASSES[visibleOccurrence.visualTone],
                ].join(" ")}
              >
                {visibleOccurrence.scheduledTimeLabel}
              </time>

              <h3
                className={[
                  "timeline-occurrence-title min-w-0 truncate text-base font-bold leading-tight sm:text-lg",
                  titleActionBufferClass,
                ].join(" ")}
              >
                {visibleOccurrence.title}
              </h3>
            </div>
          </summary>

          <div
            id={detailsId}
            className="timeline-occurrence-details mt-0 gap-2 px-3 pb-3 pt-0 text-sm leading-6 text-muted-readable sm:px-4 sm:pb-4"
          >
            <DetailItem
              label="Description"
              value={visibleOccurrence.description || "No description."}
            />
            <DetailItem label="Category" value={visibleOccurrence.categoryName} />
            <DetailItem
              label="Schedule"
              value={visibleOccurrence.scheduleSummary}
            />

            {context ? <div id={`${detailsId}-context`} className="grid gap-1" aria-label="Scheduling context">
              <h4 className="font-bold text-foreground">Scheduling context</h4>
              <p>{context.estimate.kind === "known" ? context.estimate.provenance === "behavior_default" ? `Default duration: ${context.estimate.durationLabel}. Set on this Behavior; separate from tracked time.` : `Estimated duration: ${context.estimate.durationLabel}. Mean of ${context.estimate.sampleCount} completed Occurrences in the preceding ${context.estimate.lookbackDays} days.`
                : `Duration unknown. ${context.estimate.sampleCount} of ${context.estimate.requiredSampleCount} required completed Occurrences have usable timing.`}</p>
              <p>{context.overlapLabel}</p>
              {context.activitySignals.map((signal) => <p key={signal}>{signal === "scheduled_now" ? "Scheduled now" : signal === "estimated_window" ? "Estimated window" : "Tracking now"}</p>)}
            </div> : null}

            {travelDetails}

            <TimeTracker
              occurrenceId={visibleOccurrence.id}
              tracking={visibleOccurrence.timeTracking}
              canStart={visibleOccurrence.canStartTimeTracking}
              startAction={startTimeTrackingAction}
              stopAction={stopTimeTrackingAction}
              resetAction={resetTimeTrackingAction}
            />

            {!optimisticView.showPrimaryStatusActions ? (
              <div className="grid gap-2">
                <h4 className="font-bold text-foreground">
                  {visibleOccurrence.expandedStatusActionLabel}
                </h4>
                <StatusButtons
                  occurrenceId={visibleOccurrence.id}
                  currentStatus={visibleOccurrence.status}
                  action={statusAction}
                  disabled={optimisticView.isPending}
                  pendingStatus={optimisticStatus.pendingStatus}
                  onStatusSubmit={handleOptimisticStatus}
                  onStatusSuccess={handleStatusConfirmed}
                  onStatusError={handleStatusRejected}
                  includeUnresolved
                  compact
                />
              </div>
            ) : null}

            <OccurrenceNoteForm
              occurrenceId={visibleOccurrence.id}
              note={visibleOccurrence.note}
              action={noteAction}
              shortcuts={shortcuts}
              compact
            />
          </div>
        </details>

        {optimisticView.showPrimaryStatusActions ? (
          <div
            className="timeline-occurrence-status pointer-events-none col-start-2 row-start-1 z-10 mr-3 flex min-h-12 items-center self-start justify-self-end sm:mr-4"
            data-status-region="actions"
          >
            <StatusButtons
              occurrenceId={visibleOccurrence.id}
              currentStatus={visibleOccurrence.status}
              action={statusAction}
              disabled={optimisticView.isPending}
              pendingStatus={optimisticStatus.pendingStatus}
              onStatusSubmit={handleOptimisticStatus}
              onStatusSuccess={handleStatusConfirmed}
              onStatusError={handleStatusRejected}
              iconOnly={statusIconsOnly}
              singleLine
            />
          </div>
        ) : visibleOccurrence.showCollapsedStatusLabel ? (
          <p
            className={[
              "timeline-occurrence-status pointer-events-none col-start-2 row-start-1 z-10 mr-3 flex min-h-12 items-center self-start justify-self-end whitespace-nowrap text-xs font-bold leading-5 sm:mr-4 sm:text-sm",
              RESOLVED_LABEL_CLASSES[visibleOccurrence.visualTone],
            ].join(" ")}
            data-status-region="label"
          >
            {pendingStatusLabel
              ? `Saving ${pendingStatusLabel}...`
              : visibleOccurrence.statusLabel}
          </p>
        ) : null}

      </div>
    </article>
  );
}

function getLabelDensity({
  title,
  shouldProtectActionSpace,
}: Readonly<{
  title: string;
  shouldProtectActionSpace: boolean;
}>): LabelDensity {
  return shouldProtectActionSpace && title.length > 18 ? "compact" : "normal";
}

function statusLabel(status: TimelineStatusActionStatus): string {
  switch (status) {
    case "completed":
      return "Completed";
    case "not_completed":
      return "Not Completed";
    case "unresolved":
      return "Unresolved";
  }
}

function DetailItem({
  label,
  value,
}: Readonly<{
  label: string;
  value: string;
}>) {
  return (
    <div className="grid gap-1">
      <h4 className="font-bold leading-5 text-foreground">{label}</h4>
      <p className="timeline-occurrence-detail-value break-words leading-5">
        {value}
      </p>
    </div>
  );
}
