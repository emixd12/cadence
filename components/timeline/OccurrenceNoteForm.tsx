"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { noticeText } from "@cadence/core/notices";
import { dayNotePreview } from "@cadence/core/resolvers/day-note.resolver";
import type { NoteShortcut } from "@cadence/core/types/note-shortcut";

import {
  NOTE_CLOSED_SAVED_MS,
  NoteEditor,
  type NoteShortcutDismissHandler,
} from "@/components/notes/NoteEditor";
import type { OccurrenceFormAction } from "@/lib/types/timeline";

export { insertNoteShortcutDraft, reconcileSavedNoteDraft } from "@/components/notes/NoteEditor";

type OccurrenceNoteFormProps = Readonly<{
  occurrenceId: string;
  behaviorId?: string;
  note: string;
  action: OccurrenceFormAction;
  shortcuts?: readonly NoteShortcut[];
  onDismissShortcut?: NoteShortcutDismissHandler;
  compact?: boolean;
}>;

export function OccurrenceNoteForm({
  occurrenceId,
  behaviorId,
  note,
  action,
  shortcuts,
  onDismissShortcut,
  compact,
}: OccurrenceNoteFormProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [optimisticOverride, setOptimisticOverride] = useState<{ base: string; value: string } | null>(null);
  const [showClosedSaved, setShowClosedSaved] = useState(false);
  const [focusSignal, setFocusSignal] = useState(0);
  const userOpeningRef = useRef(false);
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
        const shouldFocus = userOpeningRef.current;
        userOpeningRef.current = false;
        setIsOpen(nextOpen);
        if (nextOpen) {
          clearSavedTimer();
          setShowClosedSaved(false);
          if (shouldFocus) {
            setFocusSignal((signal) => signal + 1);
          }
        }
      }}
      className="occurrence-note group text-sm"
      data-occurrence-note={occurrenceId}
    >
      <summary
        onClick={() => {
          if (!isOpen) userOpeningRef.current = true;
        }}
        className="inline-flex min-h-11 max-w-full cursor-pointer list-none items-center gap-2 py-1 font-bold text-foreground hover:text-foreground focus-visible:text-foreground sm:min-h-8 [&::-webkit-details-marker]:hidden"
        aria-label={optimisticNote ? "Edit note" : "Add note"}
      >
        <span>{optimisticNote ? "Note" : "Add note"}</span>
        {!isOpen && preview ? (
          <span className="min-w-0 truncate font-normal text-muted-readable">
            {preview}
          </span>
        ) : null}
        {!isOpen && showClosedSaved ? (
          <span
            className="shrink-0 text-xs font-normal text-muted-readable"
            data-notice="timeline.note-saved"
            data-note-saved="true"
          >
            {noticeText("timeline.note-saved")}
          </span>
        ) : null}
      </summary>
      <div className={compact ? "mt-1" : "mt-2"}>
        <NoteEditor
          targetFields={{ occurrence_id: occurrenceId }}
          note={note}
          action={action}
          shortcuts={shortcuts}
          poolId={behaviorId}
          onDismissShortcut={onDismissShortcut}
          hideLabel
          focusSignal={focusSignal}
          onSaved={(savedNote) => setOptimisticOverride({ base: note, value: savedNote })}
          onDone={({ saved }) => {
            setIsOpen(false);
            if (saved) {
              flashClosedSaved();
            }
          }}
          compact={compact}
        />
      </div>
    </details>
  );
}
