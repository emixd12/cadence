import { Temporal } from "@js-temporal/polyfill";
import {
  getNoteShortcutView,
  listAcceptedNoteShortcuts,
  manageNoteShortcuts,
  matchRepeatedNoteShortcuts,
} from "@cadence/core/services/note-shortcut.service";
import type {
  NoteShortcut,
  NoteShortcutCommand,
  NoteShortcutState,
  NoteShortcutView,
} from "@cadence/core/types/note-shortcut";

import { requireCurrentUserId } from "@/lib/auth/current-user";
import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import { createNoteShortcutStore } from "@/lib/db/noteShortcuts.repo";
import { createClient } from "@/lib/supabase/server";

export async function getNoteShortcutViewForCurrentUser(
  behaviorId: string | null,
): Promise<NoteShortcutView> {
  const store = await currentUserStore();
  return getNoteShortcutView(store, behaviorId, Temporal.Now.instant());
}

export async function manageNoteShortcutsForCurrentUser(
  behaviorId: string | null,
  command: NoteShortcutCommand,
  expectedRevision: string,
): Promise<NoteShortcutState> {
  if (!/^[a-f0-9]{64}$/.test(expectedRevision)) {
    throw new Error("This shortcut changed elsewhere. Refresh and try again.");
  }
  const store = await currentUserStore();
  return manageNoteShortcuts(store, {
    behaviorId,
    command,
    expectedRevision,
    now: Temporal.Now.instant(),
  });
}

export async function listAcceptedNoteShortcutsForCurrentUser(): Promise<
  Record<string, NoteShortcut[]>
> {
  const store = await currentUserStore();
  return listAcceptedNoteShortcuts(store);
}

// Ticket 305: runs after an in-app Note save. A failure here never fails the saved Note;
// the next save tries again.
export async function matchRepeatedNotesAfterNoteSave(
  supabase: AppSupabaseClient,
  userId: string,
  behaviorId: string,
): Promise<void> {
  try {
    await matchRepeatedNoteShortcuts(
      createNoteShortcutStore(supabase, userId),
      behaviorId,
      Temporal.Now.instant(),
    );
  } catch {
    // Shortcut matching is optional; ordinary Note entry stays usable.
  }
}

async function currentUserStore() {
  const userId = await requireCurrentUserId(
    "Sign in again before managing Note shortcuts.",
  );
  const supabase = await createClient();
  return createNoteShortcutStore(supabase, userId);
}
