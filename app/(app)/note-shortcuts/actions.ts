"use server";

import { revalidatePath } from "next/cache";

import type { NoteShortcutCommand } from "@cadence/core/types/note-shortcut";
import type { NoteShortcutActionState } from "@/components/note-shortcuts/NoteShortcutControls";
import {
  getNoteShortcutViewForCurrentUser,
  manageNoteShortcutsForCurrentUser,
} from "@/lib/services/note-shortcut.service";

export async function manageNoteShortcutAction(
  behaviorId: string | null,
  command: NoteShortcutCommand,
  expectedRevision: string,
): Promise<NoteShortcutActionState> {
  try {
    await manageNoteShortcutsForCurrentUser(behaviorId, command, expectedRevision);
    const view = await getNoteShortcutViewForCurrentUser(behaviorId);
    revalidatePath("/timeline");
    revalidatePath("/behaviors");
    revalidatePath("/settings");
    return { status: "success", message: shortcutMessage(command.operation, view), view };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Unable to save Note shortcuts.",
    };
  }
}

function shortcutMessage(operation: NoteShortcutCommand["operation"], view: Awaited<ReturnType<typeof getNoteShortcutViewForCurrentUser>>): string {
  if (operation === "analyze") return view.entries.some((entry) => entry.status === "proposed")
    ? "Repeated Notes checked."
    : "No new shortcuts found. Matching needs the same Note on three eligible Occurrences.";
  if (operation === "accept") return "Note shortcut accepted.";
  if (operation === "edit") return "Note shortcut saved.";
  if (operation === "dismiss") return "Note shortcut dismissed.";
  if (operation === "remove") return "Note shortcut removed.";
  return "Note shortcut setting saved.";
}
