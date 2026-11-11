import type { Temporal } from "@js-temporal/polyfill";
import type { DayNoteDataStore } from "@cadence/core/data-store";
import { saveDayNote } from "@cadence/core/services/day-note.service";
import { localCommand, localMutation } from "./local-store";

/** Ticket 292: day notes in the local SQLite store. The native store compares and sets the note. */
export function createLocalDayNoteStore(profileId: string, now: Temporal.Instant): DayNoteDataStore {
  return {
    listDayNotes: (range) => localCommand("readDayNotes", { profileId, startLocalDate: range.from, endLocalDate: range.to }),
    saveDayNote: (plan) => localCommand("saveDayNote", {
      ...localMutation(profileId, now.toString()), newId: crypto.randomUUID(),
      localDate: plan.localDate, expectedNote: plan.expectedNote, note: plan.note,
      // A shortcut-assisted save also excludes this day note from the day-note pool.
      ...(plan.usedShortcut ? { usedShortcut: true } : {}),
    }),
  };
}

export function saveLocalDayNote(
  profileId: string,
  input: Readonly<{ localDate: unknown; expectedNote: unknown; note: unknown; usedShortcut?: boolean }>,
  now: Temporal.Instant,
) {
  return saveDayNote(createLocalDayNoteStore(profileId, now), input);
}
