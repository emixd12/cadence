import { Temporal } from "@js-temporal/polyfill";
import type { PeriodCreateCommit, PeriodDataStore } from "@cadence/core/data-store";
import { noticeText } from "@cadence/core/notices";
import { PERIOD_NOTE_SHORTCUT_KEY, periodLabelSuggestions, periodsNewestFirst, toPeriodView } from "@cadence/core/resolvers/period.resolver";
import { fixedClock, todayIn } from "@cadence/core/resolvers/time.resolver";
import { listPeriodNoteShortcuts } from "@cadence/core/services/note-shortcut.service";
import {
  PERIOD_LIMIT_MESSAGE, createPeriod, deletePeriod, endPeriod, periodErrorActionState, savePeriodNote, updatePeriod,
} from "@cadence/core/services/period.service";
import type { NoteShortcut } from "@cadence/core/types/note-shortcut";
import type { PeriodActionState, PeriodNoticeId, PeriodView } from "@cadence/core/types/period";
import { DEFAULT_TIMEZONE } from "@cadence/core/types/recurrence";
import type { PeriodActions } from "../../../lib/types/period";
import { createLocalNoteShortcutStore } from "./local-note-shortcut.service";
import { localCommand, localMutation } from "./local-store";

/**
 * Ticket 374 (D35): Periods in the local SQLite store. The native store enforces the cap
 * of 500 Periods and compares the revision on every edit and removal, as the hosted
 * functions do. Each write is one transaction with its outbox entry.
 */
export function createLocalPeriodStore(profileId: string, now: Temporal.Instant): PeriodDataStore {
  const fields = (input: PeriodCreateCommit) => ({ label: input.label, startOn: input.startOn, endOn: input.endOn, note: input.note });
  const mutation = () => localMutation(profileId, now.toString());
  return {
    listPeriods: (range) => localCommand("readPeriods", range
      ? { profileId, startLocalDate: range.from, endLocalDate: range.to }
      : { profileId }),
    getPeriod: (id) => localCommand("readPeriod", { profileId, periodId: id }),
    createPeriod: (input) => atLimit(localCommand("createPeriod", { ...mutation(), newId: crypto.randomUUID(), ...fields(input) })),
    createPeriodIfAbsent: (input) => atLimit(localCommand("createPeriodIfAbsent", { ...mutation(), newId: crypto.randomUUID(), ...fields(input) })),
    updatePeriod: (input) => localCommand("updatePeriod", {
      ...mutation(), periodId: input.id, expectedRevision: input.expectedRevision, ...fields(input) }),
    deletePeriod: (input) => localCommand("deletePeriod", { ...mutation(), periodId: input.id, expectedRevision: input.expectedRevision }),
  };
}

/** The native store reports the cap in the shared words; any wrapping around them is dropped. */
async function atLimit<T>(write: Promise<T>): Promise<T> {
  try {
    return await write;
  } catch (error) {
    if (errorText(error).includes(PERIOD_LIMIT_MESSAGE)) throw new Error(PERIOD_LIMIT_MESSAGE);
    throw error;
  }
}

function errorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "";
}

/** What the all-Periods list on the Behaviors screen reads, as on the web. */
export type LocalPeriodList = Readonly<{ periods: PeriodView[]; labelSuggestions: string[]; noteShortcuts: NoteShortcut[] }>;

export async function readLocalPeriodList(profileId: string, now: Temporal.Instant): Promise<LocalPeriodList> {
  const records = await localCommand("readPeriods", { profileId });
  return {
    periods: periodsNewestFirst(records).map(toPeriodView),
    labelSuggestions: periodLabelSuggestions(records),
    noteShortcuts: await listPeriodNoteShortcuts(createLocalNoteShortcutStore(profileId), records, now),
  };
}

/**
 * The Timeline's shortcut map with the Period note chips under their own key, as the
 * web's `listInlineNoteShortcutsForCurrentUser` builds it. No chips, no key.
 */
export function withPeriodNoteShortcuts(
  inline: Record<string, NoteShortcut[]>, periodNotes: readonly NoteShortcut[],
): Record<string, NoteShortcut[]> {
  return periodNotes.length > 0 ? { ...inline, [PERIOD_NOTE_SHORTCUT_KEY]: [...periodNotes] } : inline;
}

/**
 * The four Period writes for the shared Timeline and Behaviors components, on the local
 * store. The form fields are the web's (`PeriodActions`). "End today" reads the profile
 * timezone at the time of the write. A failure shows a rule sentence or the fallback,
 * never store text, and no label or note is logged.
 */
export function createLocalPeriodActions(profileId: string, refresh: () => void): PeriodActions {
  const store = () => createLocalPeriodStore(profileId, Temporal.Now.instant());
  const target = (form: FormData) => ({ id: form.get("period_id"), expectedRevision: form.get("expected_revision") });
  const run = async (write: () => Promise<unknown>, noticeId: PeriodNoticeId, fallback: string): Promise<PeriodActionState> => {
    try {
      await write();
      refresh();
      return { status: "success", noticeId, message: noticeText(noticeId) };
    } catch (error) {
      return periodErrorActionState(error, fallback);
    }
  };
  return {
    save: (_previous, form) => run(() => form.get("period_id")
      ? updatePeriod(store(), { ...target(form), label: form.get("label"), startOn: form.get("start_on"), endOn: form.get("end_on"),
        ...(form.has("note") ? { note: form.get("note") } : {}) })
      : createPeriod(store(), { label: form.get("label"), startOn: form.get("start_on"), endOn: form.get("end_on"), note: form.get("note") }),
    "period.saved", "Unable to save this period."),
    end: (_previous, form) => run(async () => {
      const now = Temporal.Now.instant();
      const profile = await localCommand("readProfile", {});
      return endPeriod(createLocalPeriodStore(profileId, now), { ...target(form), today: todayIn(fixedClock(now), profile.timezone || DEFAULT_TIMEZONE) });
    }, "period.ended", "Unable to end this period."),
    remove: (_previous, form) => run(() => deletePeriod(store(), target(form)), "period.removed", "Unable to remove this period."),
    saveNote: async (_previous, form) => {
      try {
        const { period } = await savePeriodNote(store(), { id: form.get("period_id"), expectedNote: form.get("expected_note"), note: form.get("note") });
        refresh();
        return { status: "success", message: "", revision: period.revision };
      } catch (error) {
        return { status: "error", message: periodErrorActionState(error, "Unable to save this note.").message };
      }
    },
  };
}
