import type { DayNoteDataStore } from "../data-store";
import {
  behaviorLogDayNoteDateRange,
  planBehaviorLogDayNoteWrites,
  previewBehaviorLogDayNoteOutcome,
  readBehaviorLogDayNoteReviews,
  type BehaviorLogDayNoteMode,
  type BehaviorLogDayNoteOutcome,
  type BehaviorLogDayNotePlan,
} from "../resolvers/behaviorlog-day-note.resolver";

type BundleFile = Readonly<{ path: string; content: string }>;

/**
 * Ticket 292: plans day-note writes for a BehaviorLog import or restore against
 * the saved notes. Returns null when the bundle has no Cadence day notes.
 */
export async function planBehaviorLogDayNotes(
  store: Pick<DayNoteDataStore, "listDayNotes">,
  files: readonly BundleFile[],
  mode: BehaviorLogDayNoteMode,
): Promise<BehaviorLogDayNotePlan | null> {
  const read = readBehaviorLogDayNoteReviews(files);
  if (!read.reviews.length && !read.skipped.length) return null;
  const range = behaviorLogDayNoteDateRange(read);
  const existing = range ? await store.listDayNotes(range) : [];
  return planBehaviorLogDayNoteWrites({ read, existing, mode });
}

export async function previewBehaviorLogDayNotes(
  store: Pick<DayNoteDataStore, "listDayNotes">,
  files: readonly BundleFile[],
  mode: BehaviorLogDayNoteMode,
): Promise<BehaviorLogDayNoteOutcome | null> {
  const plan = await planBehaviorLogDayNotes(store, files, mode);
  return plan ? previewBehaviorLogDayNoteOutcome(plan) : null;
}

/**
 * Saves planned day notes after the main import or restore commits. Each save
 * compares and sets the stored note, so a note changed since the plan is
 * reported as a conflict instead of being overwritten. A failed save is
 * reported by date; it does not undo the committed import.
 */
export async function applyBehaviorLogDayNotes(
  store: DayNoteDataStore,
  files: readonly BundleFile[],
  mode: BehaviorLogDayNoteMode,
): Promise<BehaviorLogDayNoteOutcome | null> {
  const plan = await planBehaviorLogDayNotes(store, files, mode);
  if (!plan) return null;
  const outcome = { saved: { create: 0, replace: 0 }, kept: 0, conflictDates: [] as string[], failedDates: [] as string[], skippedCount: plan.skipped.length };
  for (const action of plan.actions) {
    if (action.action === "keep") {
      outcome.kept++;
      continue;
    }
    if (action.action === "conflict") {
      outcome.conflictDates.push(action.localDate);
      continue;
    }
    try {
      const record = await store.saveDayNote({ localDate: action.localDate, expectedNote: action.existingNote, note: action.note });
      if (record) outcome.saved[action.action]++;
      else outcome.conflictDates.push(action.localDate);
    } catch {
      outcome.failedDates.push(action.localDate);
    }
  }
  return outcome;
}
