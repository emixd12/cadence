import type { DayNoteDataStore } from "../data-store";
import {
  resolveDayNoteRange,
  resolveDayNoteUpdate,
  type DayNoteRecord,
} from "../resolvers/day-note.resolver";

export const DAY_NOTE_CONFLICT_MESSAGE =
  "This day note changed elsewhere. Review the latest note before saving again.";

export type DayNoteSaveResult = Readonly<{
  localDate: string;
  note: string | null;
  record: DayNoteRecord | null;
  changed: boolean;
}>;

/** Saves, edits, or clears the one note for a calendar date. */
export async function saveDayNote(
  store: Pick<DayNoteDataStore, "saveDayNote">,
  input: Readonly<{ localDate: unknown; expectedNote: unknown; note: unknown; usedShortcut?: boolean }>,
): Promise<DayNoteSaveResult> {
  const plan = resolveDayNoteUpdate(input);
  if (plan.expectedNote === null && plan.note === null) {
    return { localDate: plan.localDate, note: null, record: null, changed: false };
  }
  const record = await store.saveDayNote({
    localDate: plan.localDate,
    expectedNote: plan.expectedNote,
    note: plan.note,
    ...(input.usedShortcut && plan.note !== null ? { usedShortcut: true } : {}),
  });
  if (!record) throw new Error(DAY_NOTE_CONFLICT_MESSAGE);
  return { localDate: plan.localDate, note: record.note, record, changed: plan.expectedNote !== plan.note };
}

export async function listDayNotes(
  store: Pick<DayNoteDataStore, "listDayNotes">,
  input: Readonly<{ from: unknown; to: unknown }>,
): Promise<DayNoteRecord[]> {
  const range = resolveDayNoteRange(input);
  const records = await store.listDayNotes(range);
  return records
    .filter((record) => record.local_date >= range.from && record.local_date <= range.to)
    .sort((a, b) => (a.local_date < b.local_date ? -1 : a.local_date > b.local_date ? 1 : 0));
}
