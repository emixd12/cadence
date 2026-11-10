import Link from "next/link";
import { Plus } from "lucide-react";
import type { NoteShortcut } from "@cadence/core/types/note-shortcut";

import { MobileTimelinePullToRefresh } from "@/components/timeline/MobileTimelinePullToRefresh";
import { NeedsDecisionDialog } from "@/components/timeline/NeedsDecisionDialog";
import { DayProgressTimeline, type DayProgressContext } from "@/components/timeline/DayProgressTimeline";
import { TimelineGroup } from "@/components/timeline/TimelineGroup";
import type {
  OccurrenceFormAction,
  TimeTrackingFormAction,
  TimelineView,
} from "@/lib/types/timeline";

type TimelineProps = Readonly<{
  timeline: TimelineView;
  statusAction: OccurrenceFormAction;
  noteAction: OccurrenceFormAction;
  startTimeTrackingAction: TimeTrackingFormAction;
  stopTimeTrackingAction: TimeTrackingFormAction;
  resetTimeTrackingAction: TimeTrackingFormAction;
  shortcutsByBehavior?: Record<string, NoteShortcut[]>;
  dayNoteAction?: OccurrenceFormAction;
  dayProgress?: DayProgressContext;
  onDayChange?: () => void;
  liveCalendar?: boolean;
  travelAccountId?: string | null;
  /** Ticket 278: the trip digest from a web leave reminder's link. */
  leaveReminderDigest?: string | null;
}>;

export function Timeline({
  timeline,
  statusAction,
  noteAction,
  startTimeTrackingAction,
  stopTimeTrackingAction,
  resetTimeTrackingAction,
  shortcutsByBehavior = {},
  dayNoteAction,
  dayProgress,
  onDayChange,
  liveCalendar = false,
  travelAccountId,
  leaveReminderDigest = null,
}: TimelineProps) {
  return (
    <MobileTimelinePullToRefresh>
      <div className="grid gap-8 pb-32 sm:pb-24">
        {timeline.archiveNotifications?.length ? (
          <div role="status" className="grid gap-2 border-b border-line pb-4 text-sm">
            {timeline.archiveNotifications.map((notice) => (
              <p key={notice.behaviorId}>“{notice.title}” was automatically archived{notice.endDate ? ` for its ${notice.endDate} end date` : ""}. History is preserved.</p>
            ))}
            <Link href="/behaviors" className="product-action product-action-primary justify-self-start">Review archived behaviors</Link>
          </div>
        ) : null}
        <NeedsDecisionDialog
          title={timeline.needsDecision.title}
          occurrenceCount={timeline.needsDecision.occurrenceCount}
          hasRetainedRows={
            timeline.needsDecision.occurrenceCount === 0 &&
            timeline.needsDecision.daySections.length > 0
          }
        >
          {timeline.needsDecision.daySections.length === 0 ? (
            <p className="border-t border-line pt-4 text-base leading-7 text-muted-readable">
              {timeline.needsDecision.emptyMessage}
            </p>
          ) : (
            <div className="grid gap-5">
              {timeline.needsDecision.daySections.map((section) => (
                <TimelineGroup
                  key={section.key}
                  section={section}
                  statusAction={statusAction}
                  noteAction={noteAction}
                  startTimeTrackingAction={startTimeTrackingAction}
                  stopTimeTrackingAction={stopTimeTrackingAction}
                  resetTimeTrackingAction={resetTimeTrackingAction}
                  shortcutsByBehavior={shortcutsByBehavior}
                  variant="needsDecisionDialog"
                  dayNoteAction={dayNoteAction}
                  dayNote={timeline.dayNotes?.[section.localDate] ?? ""}
                />
              ))}
            </div>
          )}
        </NeedsDecisionDialog>

        <DayProgressTimeline
          timeline={timeline}
          context={dayProgress}
          statusAction={statusAction}
          noteAction={noteAction}
          startTimeTrackingAction={startTimeTrackingAction}
          stopTimeTrackingAction={stopTimeTrackingAction}
          resetTimeTrackingAction={resetTimeTrackingAction}
          shortcutsByBehavior={shortcutsByBehavior}
          dayNoteAction={dayNoteAction}
          onDayChange={onDayChange}
          liveCalendar={liveCalendar}
          travelAccountId={travelAccountId}
          leaveReminderDigest={leaveReminderDigest}
        />

        {timeline.nextFutureDays ? (
          <div className="border-t border-line pt-5">
            <Link
              href={`/timeline?days=${timeline.nextFutureDays}`}
              scroll={false}
              className="product-action product-action-primary min-h-11 gap-2 py-2 text-sm font-bold"
            >
              <Plus aria-hidden="true" size={18} strokeWidth={2.5} />
              <span>Show more days</span>
            </Link>
          </div>
        ) : null}
      </div>
    </MobileTimelinePullToRefresh>
  );
}
