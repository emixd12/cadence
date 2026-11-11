import type { DayNoteDataStore, DayNoteSaveCommit } from "@cadence/core/data-store";
import type { DayNoteRecord } from "@cadence/core/resolvers/day-note.resolver";

import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import { readAllPostgrestRows } from "@/lib/db/paginated-read";
import type { DayNote } from "@/lib/types/database";

export function createDayNoteStore(
  supabase: AppSupabaseClient,
  userId: string,
): DayNoteDataStore {
  return {
    listDayNotes: (range) => listDayNotesInRange(supabase, userId, range),
    saveDayNote: (input) => saveDayNoteIfExpected(supabase, input),
  };
}

// Paged like listAllDayNotes: a Timeline range runs from the oldest Needs
// decision date to the last future day, so it can hold more than one
// 1,000-row PostgREST page.
export async function listDayNotesInRange(
  supabase: AppSupabaseClient,
  userId: string,
  range: { from: string; to: string },
): Promise<DayNoteRecord[]> {
  return readAllPostgrestRows<DayNote>({
    label: "Day notes",
    getRowKey: (row) => row.id,
    createQuery: () =>
      supabase
        .from("day_notes")
        .select("*")
        .eq("user_id", userId)
        .gte("local_date", range.from)
        .lte("local_date", range.to)
        .order("local_date", { ascending: true })
        .order("id", { ascending: true }),
  });
}

export async function listAllDayNotes(
  supabase: AppSupabaseClient,
  userId: string,
): Promise<DayNote[]> {
  return readAllPostgrestRows<DayNote>({
    label: "Day notes",
    getRowKey: (row) => row.id,
    createQuery: () =>
      supabase
        .from("day_notes")
        .select("*")
        .eq("user_id", userId)
        .order("local_date", { ascending: true })
        .order("id", { ascending: true }),
  });
}

export async function saveDayNoteIfExpected(
  supabase: AppSupabaseClient,
  input: DayNoteSaveCommit,
): Promise<DayNoteRecord | null> {
  if (input.usedShortcut) {
    // Saves the note and excludes it from the day-note shortcut pool atomically.
    const { data, error } = await supabase
      .rpc("save_day_note_with_shortcut", {
        target_local_date: input.localDate,
        expected_note: input.expectedNote as unknown as string,
        next_note: input.note as unknown as string,
        used_shortcut: true,
      })
      .maybeSingle();
    if (error) throw error;
    return (data as DayNote | null) ?? null;
  }
  const { data, error } = await supabase
    .rpc("save_day_note", {
      target_local_date: input.localDate,
      expected_note: input.expectedNote as unknown as string,
      next_note: input.note as unknown as string,
    })
    .maybeSingle();
  if (error) throw error;
  return (data as DayNote | null) ?? null;
}
