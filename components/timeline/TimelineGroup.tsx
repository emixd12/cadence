import { noticeText } from "@cadence/core/notices";
import type {
  OccurrenceFormAction,
  OpportunityFormAction,
  TimeTrackingFormAction,
  TimelineDaySection,
} from "@/lib/types/timeline";
import type { NoteShortcut } from "@cadence/core/types/note-shortcut";
import { OccurrenceRow } from "@/components/timeline/OccurrenceRow";
import { ParentOccurrenceRow } from "@/components/timeline/ParentOccurrenceRow";
import { DayNoteControl } from "@/components/timeline/DayNoteControl";
import { PeriodDayControls } from "@/components/periods/PeriodControl";
import type { PeriodActions, PeriodView } from "@/lib/types/period";
import { DAY_NOTE_SHORTCUT_POOL_ID } from "@cadence/core/resolvers/day-note.resolver";
import { PERIOD_NOTE_SHORTCUT_KEY } from "@cadence/core/resolvers/period.resolver";

type TimelineGroupProps = Readonly<{
  section: TimelineDaySection;
  statusAction: OccurrenceFormAction;
  noteAction: OccurrenceFormAction;
  startTimeTrackingAction: TimeTrackingFormAction;
  stopTimeTrackingAction: TimeTrackingFormAction;
  resetTimeTrackingAction: TimeTrackingFormAction;
  shortcutsByBehavior?: Record<string, NoteShortcut[]>;
  variant?: "feed" | "needsDecisionDialog";
  dayNoteAction?: OccurrenceFormAction;
  dayNote?: string;
  /** Ticket 369: Period writes. Without them the header shows no Period control. */
  periodActions?: PeriodActions;
  /** The Periods that cover this day. */
  periods?: readonly PeriodView[];
  periodLabelSuggestions?: readonly string[];
  /** Today in the account's timezone: "Add period" shows on that day only. */
  todayLocalDate?: string;
  removeOpportunityAction?: OpportunityFormAction;
  /** Marks every sub-behavior in a routine's slot. Without it routines offer no bulk marking. */
  parentSlotStatusAction?: OccurrenceFormAction;
}>;

const SECTION_CLASSES: Record<TimelineDaySection["kind"], string> = {
  today: "bg-background py-2 sm:py-3",
  future: "bg-background py-2 sm:py-3",
  needs_decision_day: "bg-background py-2 sm:py-3",
};

export function TimelineGroup({
  section,
  statusAction,
  noteAction,
  startTimeTrackingAction,
  stopTimeTrackingAction,
  resetTimeTrackingAction,
  shortcutsByBehavior = {},
  variant = "feed",
  dayNoteAction,
  dayNote = "",
  periodActions,
  periods,
  periodLabelSuggestions,
  todayLocalDate,
  removeOpportunityAction,
  parentSlotStatusAction,
}: TimelineGroupProps) {
  const dayNoteOnly = dayNoteAction ? (
    <DayNoteControl
      localDate={section.localDate}
      dayLabel={section.label}
      note={dayNote}
      action={dayNoteAction}
      shortcuts={shortcutsByBehavior[DAY_NOTE_SHORTCUT_POOL_ID]}
    />
  ) : null;
  // Period chips sit under the date; on today "Add period" sits beside the day note.
  const dayNoteControl = periodActions && todayLocalDate ? (
    <PeriodDayControls
      localDate={section.localDate}
      dayLabel={section.label}
      periods={periods}
      today={todayLocalDate}
      labelSuggestions={periodLabelSuggestions}
      noteShortcuts={shortcutsByBehavior[PERIOD_NOTE_SHORTCUT_KEY]}
      actions={periodActions}
    >
      {dayNoteOnly}
    </PeriodDayControls>
  ) : dayNoteOnly;
  const isEmpty = section.occurrenceGroups.length === 0 && section.parentGroups.length === 0;
  // Older views without `rows` keep their standalone stacks.
  const rows: TimelineDaySection["rows"] = section.rows.length > 0 ? section.rows
    : section.occurrenceGroups.map((group) => ({ kind: "behavior", key: group.key, group }));
  const rowActions = {
    statusAction,
    noteAction,
    startTimeTrackingAction,
    stopTimeTrackingAction,
    resetTimeTrackingAction,
  };
  const isNeedsDecisionDialog = variant === "needsDecisionDialog";

  return (
    <section
      className={SECTION_CLASSES[section.kind]}
      aria-labelledby={`${section.key}-title`}
    >
      <div
        className={[
          "flex flex-col gap-2 border-b border-line pb-3 sm:flex-row sm:items-end sm:justify-between",
          isNeedsDecisionDialog ? "pr-12" : "",
        ].join(" ")}
      >
        {isNeedsDecisionDialog ? (
          <div>
            <h2
              id={`${section.key}-title`}
              className="font-bold leading-tight text-2xl"
            >
              <time dateTime={section.localDate}>{section.label}</time>
            </h2>
            <p className="mt-1 text-sm font-bold text-muted-readable">
              {decisionCountLabel(section.unresolvedOccurrenceCount)}
            </p>
            {dayNoteControl}
          </div>
        ) : (
          <div>
            <p className="text-sm font-bold text-muted-readable">
              {section.relativeLabel}
            </p>
            <h2
              id={`${section.key}-title`}
              className={[
                "font-bold leading-tight",
                section.kind === "today" ? "text-3xl" : "text-2xl",
              ].join(" ")}
            >
              <time dateTime={section.localDate}>{section.label}</time>
            </h2>
            {dayNoteControl}
          </div>
        )}
      </div>

      {isEmpty ? (
        <p className="mt-3 bg-surface p-3 text-base leading-7 text-muted-readable">
          {section.emptyMessage}
        </p>
      ) : (
        <div className="mt-3 grid gap-1">
          {rows.map((row) => row.kind === "behavior" ? (
            <OccurrenceStack
              key={row.key}
              group={row.group}
              {...rowActions}
              shortcutsByBehavior={shortcutsByBehavior}
              removeOpportunityAction={removeOpportunityAction}
            />
          ) : (
            <ParentOccurrenceRow key={row.key} group={row.group} parentSlotStatusAction={parentSlotStatusAction}>
              {row.group.children.map((occurrence) => (
                <OccurrenceRow
                  key={occurrence.id}
                  occurrence={occurrence}
                  {...rowActions}
                  shortcuts={shortcutsByBehavior[occurrence.behaviorId]}
                />
              ))}
            </ParentOccurrenceRow>
          ))}
        </div>
      )}
    </section>
  );
}

function decisionCountLabel(count: number): string {
  return noticeText("timeline.left-to-decide", { count });
}

function OccurrenceStack({
  group,
  statusAction,
  noteAction,
  startTimeTrackingAction,
  stopTimeTrackingAction,
  resetTimeTrackingAction,
  shortcutsByBehavior,
  removeOpportunityAction,
}: Readonly<{
  group: TimelineDaySection["occurrenceGroups"][number];
  statusAction: OccurrenceFormAction;
  noteAction: OccurrenceFormAction;
  startTimeTrackingAction: TimeTrackingFormAction;
  stopTimeTrackingAction: TimeTrackingFormAction;
  resetTimeTrackingAction: TimeTrackingFormAction;
  shortcutsByBehavior: Record<string, NoteShortcut[]>;
  removeOpportunityAction?: OpportunityFormAction;
}>) {
  if (!group.isGroupedStack) {
    const occurrence = group.occurrences[0];

    if (!occurrence) {
      return null;
    }

    return (
      <OccurrenceRow
        occurrence={occurrence}
        statusAction={statusAction}
        noteAction={noteAction}
        startTimeTrackingAction={startTimeTrackingAction}
        stopTimeTrackingAction={stopTimeTrackingAction}
        resetTimeTrackingAction={resetTimeTrackingAction}
        shortcuts={shortcutsByBehavior[group.behaviorId]}
        removeOpportunityAction={removeOpportunityAction}
      />
    );
  }

  return (
    <div
      className="grid gap-2 bg-surface p-2 sm:gap-1 sm:p-1"
      aria-label={`${group.title} scheduled times`}
    >
      <p className="px-2 py-1 text-sm font-bold leading-6 text-muted-readable">
        Multiple scheduled times
      </p>
      {group.occurrences.map((occurrence) => (
        <OccurrenceRow
          key={occurrence.id}
          occurrence={occurrence}
          statusAction={statusAction}
          noteAction={noteAction}
          startTimeTrackingAction={startTimeTrackingAction}
          stopTimeTrackingAction={stopTimeTrackingAction}
          resetTimeTrackingAction={resetTimeTrackingAction}
          shortcuts={shortcutsByBehavior[group.behaviorId]}
          removeOpportunityAction={removeOpportunityAction}
        />
      ))}
    </div>
  );
}
