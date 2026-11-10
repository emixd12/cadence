import { listDayNotes, saveDayNote, type DayNoteSaveResult } from "@cadence/core/services/day-note.service";
import type { DayNoteRecord } from "@cadence/core/resolvers/day-note.resolver";

import { requireCurrentUserId } from "@/lib/auth/current-user";
import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import { createDayNoteStore } from "@/lib/db/dayNotes.repo";
import { createClient } from "@/lib/supabase/server";

const SIGN_IN_MESSAGE = "Sign in again before saving day notes.";

export async function saveDayNoteFromFormData(formData: FormData): Promise<DayNoteSaveResult> {
  const supabase = await createClient();
  const userId = await requireCurrentUserId(SIGN_IN_MESSAGE);
  return saveDayNoteForUser(supabase, userId, {
    localDate: formData.get("local_date"),
    expectedNote: formData.get("expected_note"),
    note: formData.get("note"),
    usedShortcut: formData.get("used_shortcut") === "true",
  });
}

export async function saveDayNoteForUser(
  supabase: AppSupabaseClient,
  userId: string,
  input: Readonly<{ localDate: unknown; expectedNote: unknown; note: unknown; usedShortcut?: boolean }>,
): Promise<DayNoteSaveResult> {
  return saveDayNote(createDayNoteStore(supabase, userId), input);
}

export async function listDayNotesForUser(
  supabase: AppSupabaseClient,
  userId: string,
  range: Readonly<{ from: string; to: string }>,
): Promise<DayNoteRecord[]> {
  return listDayNotes(createDayNoteStore(supabase, userId), range);
}
