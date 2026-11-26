import Link from "next/link";
import { Plus } from "lucide-react";
import type { NoteShortcut } from "@cadence/core/types/note-shortcut";

import { MobileTimelinePullToRefresh } from "@/components/timeline/MobileTimelinePullToRefresh";
import { NeedsDecisionDialog } from "@/components/timeline/NeedsDecisionDialog";
import { DayProgressTimeline, type DayProgressContext } from "@/components/timeline/DayProgressTimeline";
import { TimelineGroup } from "@/components/timeline/TimelineGroup";
import { BehaviorRunNotices } from "@/components/timeline/BehaviorRunNotices";
import type { BehaviorFormAction } from "@/lib/types/behavior";
import type { PeriodActions } from "@/lib/types/period";
import type {
  DefaultDurationFormAction,
  OccurrenceFormAction,
  OpportunityFormAction,
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
  /**
   * Ticket 369: save, End today and Remove for Periods. With them, day headers show
   * `timeline.periodsByDate` as chips and today offers "Add period". Without them
   * no Period control renders.
   */
  periodActions?: PeriodActions;
  dayProgress?: DayProgressContext;
  onDayChange?: () => void;
  liveCalendar?: boolean;
  travelAccountId?: string | null;
  /** Ticket 278: the trip digest from a web leave reminder's link. */
  leaveReminderDigest?: string | null;
  /** Start again and Resume now on the ended and paused notices (Ended and Paused). */
  runAction?: BehaviorFormAction;
  /** Behaviors of Opportunity: the basket's add and Done now, and a row's Remove. Omitted where unavailable. */
  addOpportunityAction?: OpportunityFormAction;
  removeOpportunityAction?: OpportunityFormAction;
  /** Completed or Not Completed for a whole routine slot (sub-behaviors). */
  parentSlotStatusAction?: OccurrenceFormAction;
  /** Quick inline default duration setter for a Behavior. */
  defaultDurationAction?: DefaultDurationFormAction;
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
  periodActions,
  dayProgress,
  onDayChange,
  liveCalendar = false,
  travelAccountId,
  leaveReminderDigest = null,
  runAction,
  addOpportunityAction,
  removeOpportunityAction,
  parentSlotStatusAction,
  defaultDurationAction,
}: TimelineProps) {
  return (
    <MobileTimelinePullToRefresh>
      <div className="grid gap-8 pb-32 sm:pb-24">
        <BehaviorRunNotices notices={timeline.runNotices} todayLocalDate={timeline.todayLocalDate} runAction={runAction} />
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
                  periodActions={periodActions}
                  periods={timeline.periodsByDate?.[section.localDate]}
                  periodLabelSuggestions={timeline.periodLabelSuggestions}
                  todayLocalDate={timeline.todayLocalDate}
                  removeOpportunityAction={removeOpportunityAction}
                  parentSlotStatusAction={parentSlotStatusAction}
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
          periodActions={periodActions}
          onDayChange={onDayChange}
          liveCalendar={liveCalendar}
          travelAccountId={travelAccountId}
          leaveReminderDigest={leaveReminderDigest}
          addOpportunityAction={addOpportunityAction}
          removeOpportunityAction={removeOpportunityAction}
          parentSlotStatusAction={parentSlotStatusAction}
          defaultDurationAction={defaultDurationAction}
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
