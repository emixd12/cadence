"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { NotebookPen } from "lucide-react";

import { DAY_NOTE_SHORTCUT_POOL_ID, dayNotePreview } from "@cadence/core/resolvers/day-note.resolver";
import type { NoteShortcut } from "@cadence/core/types/note-shortcut";

import {
  NOTE_CLOSED_SAVED_MS,
  NoteEditor,
  type NoteShortcutDismissHandler,
} from "@/components/notes/NoteEditor";
import type { OccurrenceFormAction } from "@/lib/types/timeline";

export type DayNoteControlProps = Readonly<{
  localDate: string;
  dayLabel: string;
  note: string;
  action: OccurrenceFormAction;
  shortcuts?: readonly NoteShortcut[];
  onDismissShortcut?: NoteShortcutDismissHandler;
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
  onDismissShortcut,
}: DayNoteControlProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [optimisticOverride, setOptimisticOverride] = useState<{ base: string; value: string } | null>(null);
  const [showClosedSaved, setShowClosedSaved] = useState(false);
  const [focusSignal, setFocusSignal] = useState(0);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const optimisticNote = optimisticOverride && optimisticOverride.base === note ? optimisticOverride.value : note;

  const clearSavedTimer = useCallback(() => {
    if (savedTimerRef.current !== null) {
      clearTimeout(savedTimerRef.current);
      savedTimerRef.current = null;
    }
  }, []);

  useEffect(() => clearSavedTimer, [clearSavedTimer]);

  const flashClosedSaved = useCallback(() => {
    clearSavedTimer();
    setShowClosedSaved(true);
    savedTimerRef.current = setTimeout(() => {
      savedTimerRef.current = null;
      setShowClosedSaved(false);
    }, NOTE_CLOSED_SAVED_MS);
  }, [clearSavedTimer]);

  const preview = optimisticNote ? dayNotePreview(optimisticNote) : "";

  return (
    <details
      open={isOpen}
      onToggle={(event) => {
        const nextOpen = event.currentTarget.open;
        setIsOpen(nextOpen);
        if (nextOpen) {
          clearSavedTimer();
          setShowClosedSaved(false);
          setFocusSignal((signal) => signal + 1);
        }
      }}
      className="day-note group mt-2 text-sm"
      data-day-note={localDate}
    >
      <summary
        className="inline-flex min-h-11 max-w-full cursor-pointer list-none items-center gap-2 py-1 font-bold text-muted-readable hover:text-foreground focus-visible:text-foreground sm:min-h-8 [&::-webkit-details-marker]:hidden"
        aria-label={optimisticNote ? `Edit day note for ${dayLabel}` : `Add day note for ${dayLabel}`}
      >
        <NotebookPen aria-hidden="true" size={16} strokeWidth={2.25} className="shrink-0" />
        <span>{optimisticNote ? "Day note" : "Add day note"}</span>
        {!isOpen && preview ? (
          <span className="min-w-0 truncate font-normal text-foreground">
            {preview}
          </span>
        ) : null}
        {!isOpen && showClosedSaved ? (
          <span className="shrink-0 text-xs font-normal text-muted-readable" data-note-saved="true">
            Saved
          </span>
        ) : null}
      </summary>
      <div className="mt-2 max-w-2xl">
        <NoteEditor
          targetFields={{ local_date: localDate }}
          note={note}
          action={action}
          shortcuts={shortcuts}
          poolId={DAY_NOTE_SHORTCUT_POOL_ID}
          onDismissShortcut={onDismissShortcut}
          label="Day note"
          hideLabel
          placeholder="Add a note about this day"
          shortcutsLabel="Day note shortcuts"
          focusSignal={focusSignal}
          onSaved={(savedNote) => setOptimisticOverride({ base: note, value: savedNote })}
          onDone={({ saved }) => {
            setIsOpen(false);
            if (saved) {
              flashClosedSaved();
            }
          }}
          compact
        />
      </div>
    </details>
  );
}
