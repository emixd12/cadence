"use client";

import { NotebookPen } from "lucide-react";

import { dayNotePreview } from "@cadence/core/resolvers/day-note.resolver";
import type { NoteShortcut } from "@cadence/core/types/note-shortcut";

import { NoteEditor } from "@/components/notes/NoteEditor";
import type { OccurrenceFormAction } from "@/lib/types/timeline";

export type DayNoteControlProps = Readonly<{
  localDate: string;
  dayLabel: string;
  note: string;
  action: OccurrenceFormAction;
  shortcuts?: readonly NoteShortcut[];
}>;

/**
 * One note for the whole day, opened from a small control under the date.
 * A day note has no status and never changes adherence or Needs decision.
 */
export function DayNoteControl({
  localDate,
  dayLabel,
  note,
  action,
  shortcuts,
}: DayNoteControlProps) {
  const preview = note ? dayNotePreview(note) : "";

  return (
    <details className="day-note group mt-2 text-sm" data-day-note={localDate}>
      <summary
        className="inline-flex min-h-11 max-w-full cursor-pointer list-none items-center gap-2 py-1 font-bold text-muted-readable hover:text-foreground focus-visible:text-foreground sm:min-h-8 [&::-webkit-details-marker]:hidden"
        aria-label={note ? `Edit day note for ${dayLabel}` : `Add day note for ${dayLabel}`}
      >
        <NotebookPen aria-hidden="true" size={16} strokeWidth={2.25} className="shrink-0" />
        <span>{note ? "Day note" : "Add day note"}</span>
        {preview ? (
          <span className="min-w-0 truncate font-normal text-foreground group-open:hidden">
            {preview}
          </span>
        ) : null}
      </summary>
      <div className="mt-2 max-w-2xl">
        <NoteEditor
          targetFields={{ local_date: localDate }}
          note={note}
          action={action}
          shortcuts={shortcuts}
          label="Day note"
          placeholder="Add a note about this day"
          shortcutsLabel="Day note shortcuts"
          compact
        />
      </div>
    </details>
  );
}
