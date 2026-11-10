import type {
  OccurrenceFormAction,
  TimeTrackingFormAction,
  TimelineDaySection,
} from "@/lib/types/timeline";
import type { NoteShortcut } from "@cadence/core/types/note-shortcut";
import { OccurrenceRow } from "@/components/timeline/OccurrenceRow";
import { DayNoteControl } from "@/components/timeline/DayNoteControl";
import { DAY_NOTE_SHORTCUT_POOL_ID } from "@cadence/core/resolvers/day-note.resolver";

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
}: TimelineGroupProps) {
  const dayNoteControl = dayNoteAction ? (
    <DayNoteControl
      localDate={section.localDate}
      dayLabel={section.label}
      note={dayNote}
      action={dayNoteAction}
      shortcuts={shortcutsByBehavior[DAY_NOTE_SHORTCUT_POOL_ID]}
    />
  ) : null;
  const isEmpty = section.occurrenceGroups.length === 0;
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
          {section.occurrenceGroups.map((group) => (
            <OccurrenceStack
              key={group.key}
              group={group}
              statusAction={statusAction}
              noteAction={noteAction}
              startTimeTrackingAction={startTimeTrackingAction}
              stopTimeTrackingAction={stopTimeTrackingAction}
              resetTimeTrackingAction={resetTimeTrackingAction}
              shortcutsByBehavior={shortcutsByBehavior}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function decisionCountLabel(count: number): string {
  if (count === 0) {
    return "None left to decide";
  }

  if (count === 1) {
    return "1 left to decide";
  }

  return `${count} left to decide`;
}

function OccurrenceStack({
  group,
  statusAction,
  noteAction,
  startTimeTrackingAction,
  stopTimeTrackingAction,
  resetTimeTrackingAction,
  shortcutsByBehavior,
}: Readonly<{
  group: TimelineDaySection["occurrenceGroups"][number];
  statusAction: OccurrenceFormAction;
  noteAction: OccurrenceFormAction;
  startTimeTrackingAction: TimeTrackingFormAction;
  stopTimeTrackingAction: TimeTrackingFormAction;
  resetTimeTrackingAction: TimeTrackingFormAction;
  shortcutsByBehavior: Record<string, NoteShortcut[]>;
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
        />
      ))}
    </div>
  );
}
