"use client";

import type { NoteShortcut } from "@cadence/core/types/note-shortcut";

import { NoteEditor } from "@/components/notes/NoteEditor";
import type { OccurrenceFormAction } from "@/lib/types/timeline";

export { insertNoteShortcutDraft, reconcileSavedNoteDraft } from "@/components/notes/NoteEditor";

type OccurrenceNoteFormProps = Readonly<{
  occurrenceId: string;
  note: string;
  action: OccurrenceFormAction;
  shortcuts?: readonly NoteShortcut[];
  compact?: boolean;
}>;

export function OccurrenceNoteForm({
  occurrenceId,
  note,
  action,
  shortcuts,
  compact,
}: OccurrenceNoteFormProps) {
  return (
    <NoteEditor
      targetFields={{ occurrence_id: occurrenceId }}
      note={note}
      action={action}
      shortcuts={shortcuts}
      compact={compact}
    />
  );
}
