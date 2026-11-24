"use client";

import type { NoteShortcut } from "@cadence/core/types/note-shortcut";

import { NoteEditor, type NoteShortcutDismissHandler } from "@/components/notes/NoteEditor";
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
  return (
    <NoteEditor
      targetFields={{ occurrence_id: occurrenceId }}
      note={note}
      action={action}
      shortcuts={shortcuts}
      poolId={behaviorId}
      onDismissShortcut={onDismissShortcut}
      compact={compact}
    />
  );
}
