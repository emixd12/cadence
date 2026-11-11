import { DAY_NOTE_LIMITS, normalizeDayNote, parseDayNoteLocalDate } from "./day-note.resolver";

/**
 * Ticket 292: restore and import of Cadence day notes from BehaviorLog.
 *
 * Cadence exports each non-empty day note as a one-day user `review` record in
 * `data/reviews.jsonl` with the `app.cadence` extension `{ day_note: true }`.
 * This resolver reads only those records and plans writes back to day notes.
 * Other reviews are not day notes and stay outside Cadence data. The resolver
 * has no I/O or clock access; services save through the `DayNoteDataStore`.
 */
export const BEHAVIORLOG_DAY_NOTE_REVIEWS_PATH = "data/reviews.jsonl";

const CADENCE_EXTENSION_NAMESPACE = "app.cadence";

export type BehaviorLogDayNoteReview = Readonly<{
  externalId: string;
  localDate: string;
  note: string;
}>;

export type BehaviorLogDayNoteRead = Readonly<{
  reviews: BehaviorLogDayNoteReview[];
  /** Cadence day-note reviews that could not be read safely. */
  skipped: { externalId: string | null; reason: string }[];
}>;

export type BehaviorLogDayNoteMode = "import" | "restore";

export type BehaviorLogDayNoteAction = Readonly<{
  externalId: string;
  localDate: string;
  note: string;
  existingNote: string | null;
  /**
   * create: no note on that date. replace: restore overwrites a different note.
   * keep: the same note is already saved. conflict: import found a different
   * note and leaves it unchanged.
   */
  action: "create" | "replace" | "keep" | "conflict";
}>;

export type BehaviorLogDayNotePlan = Readonly<{
  mode: BehaviorLogDayNoteMode;
  actions: BehaviorLogDayNoteAction[];
  skipped: BehaviorLogDayNoteRead["skipped"];
}>;

export type BehaviorLogDayNoteOutcome = Readonly<{
  mode: BehaviorLogDayNoteMode;
  /** True when the saved day notes could not be read, so no day note was planned or saved. */
  unavailable: boolean;
  saved: { create: number; replace: number };
  kept: number;
  /** Dates whose stored note differs from the bundle and was left unchanged. */
  conflictDates: string[];
  failedDates: string[];
  skippedCount: number;
}>;

type BundleFile = Readonly<{ path: string; content: string }>;

/** Reads Cadence-produced day-note reviews; ignores every other review. */
export function readBehaviorLogDayNoteReviews(files: readonly BundleFile[]): BehaviorLogDayNoteRead {
  const file = files.find((entry) => entry.path === BEHAVIORLOG_DAY_NOTE_REVIEWS_PATH);
  if (!file) return { reviews: [], skipped: [] };
  const skipped: { externalId: string | null; reason: string }[] = [];
  const byDate = new Map<string, BehaviorLogDayNoteReview[]>();

  for (const line of file.content.split("\n")) {
    if (!line.trim()) continue;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(record) || record.record_type !== "review" || !isCadenceDayNote(record)) continue;
    const externalId = typeof record.review_id === "string" && record.review_id ? record.review_id : null;
    const review = toDayNoteReview(record, externalId);
    if (typeof review === "string") {
      skipped.push({ externalId, reason: review });
      continue;
    }
    byDate.set(review.localDate, [...(byDate.get(review.localDate) ?? []), review]);
  }

  const reviews: BehaviorLogDayNoteReview[] = [];
  for (const [localDate, entries] of byDate) {
    if (new Set(entries.map((entry) => entry.note)).size > 1) {
      for (const entry of entries) {
        skipped.push({ externalId: entry.externalId, reason: `More than one different day note is dated ${localDate}.` });
      }
      continue;
    }
    reviews.push(entries[0]!);
  }
  reviews.sort((left, right) => (left.localDate < right.localDate ? -1 : left.localDate > right.localDate ? 1 : 0));
  return { reviews, skipped };
}

/**
 * Plans day-note writes. Import never overwrites a different saved note; it
 * reports the date as a conflict. A fresh restore replaces a different note on a
 * date the bundle covers. A retried restore passes `replaceDifferent: false`: it
 * only fills dates with no note, so an edit made after the first restore stays. Neither mode clears dates the bundle does not mention,
 * because an export can cover a date range or leave notes out.
 */
export function planBehaviorLogDayNoteWrites(input: Readonly<{
  read: BehaviorLogDayNoteRead;
  existing: readonly Readonly<{ local_date: string; note: string | null }>[];
  mode: BehaviorLogDayNoteMode;
  replaceDifferent?: boolean;
}>): BehaviorLogDayNotePlan {
  const replaceDifferent = input.replaceDifferent ?? input.mode === "restore";
  const existingByDate = new Map(input.existing.map((record) => [record.local_date, record.note]));
  const actions = input.read.reviews.map((review): BehaviorLogDayNoteAction => {
    const existingNote = existingByDate.get(review.localDate) ?? null;
    const action = existingNote === null
      ? "create"
      : existingNote === review.note
        ? "keep"
        : replaceDifferent ? "replace" : "conflict";
    return { ...review, existingNote, action };
  });
  return { mode: input.mode, actions, skipped: input.read.skipped };
}

/** The inclusive date range a plan reads, or null when the bundle has no day notes. */
export function behaviorLogDayNoteDateRange(read: BehaviorLogDayNoteRead): { from: string; to: string } | null {
  if (!read.reviews.length) return null;
  return { from: read.reviews[0]!.localDate, to: read.reviews[read.reviews.length - 1]!.localDate };
}

/** Outcome before any save: what the preview tells the user. */
export function previewBehaviorLogDayNoteOutcome(plan: BehaviorLogDayNotePlan): BehaviorLogDayNoteOutcome {
  return {
    mode: plan.mode,
    unavailable: false,
    saved: {
      create: plan.actions.filter((action) => action.action === "create").length,
      replace: plan.actions.filter((action) => action.action === "replace").length,
    },
    kept: plan.actions.filter((action) => action.action === "keep").length,
    conflictDates: plan.actions.filter((action) => action.action === "conflict").map((action) => action.localDate),
    failedDates: [],
    skippedCount: plan.skipped.length,
  };
}

/** Outcome when the saved day notes could not be read. */
export function unavailableBehaviorLogDayNoteOutcome(mode: BehaviorLogDayNoteMode): BehaviorLogDayNoteOutcome {
  return { mode, unavailable: true, saved: { create: 0, replace: 0 }, kept: 0, conflictDates: [], failedDates: [], skippedCount: 0 };
}

/** One plain sentence group for the import or restore message; null when nothing applies. */
export function describeBehaviorLogDayNoteOutcome(
  outcome: BehaviorLogDayNoteOutcome,
  phase: "preview" | "applied",
): string | null {
  const parts: string[] = [];
  const preview = phase === "preview";
  const action = outcome.mode === "restore" ? "restore" : "import";
  if (outcome.unavailable) {
    return preview
      ? `Day notes could not be checked. Preview the bundle again to include them.`
      : outcome.mode === "restore"
        ? "Day notes could not be restored. Your other data was restored. Apply this restore again to add the day notes."
        : "Day notes could not be imported. Your other data was imported. Preview and apply the bundle again to add the day notes.";
  }
  if (outcome.saved.create) parts.push(`${outcome.saved.create} ${preview ? "to add" : "added"}`);
  if (outcome.saved.replace) parts.push(`${outcome.saved.replace} ${preview ? "to replace" : "replaced"}`);
  if (outcome.kept) parts.push(`${outcome.kept} already saved`);
  const sentences: string[] = [];
  if (parts.length) sentences.push(`Day notes: ${parts.join(", ")}.`);
  if (outcome.conflictDates.length) {
    sentences.push(
      `${countDays(outcome.conflictDates.length)} already ${outcome.conflictDates.length === 1 ? "has" : "have"} a different day note, ${preview ? `which this ${action} will not change` : `which this ${action} did not change`}: ${outcome.conflictDates.join(", ")}.`,
    );
  }
  if (outcome.failedDates.length) {
    sentences.push(`${countDays(outcome.failedDates.length)} could not save a day note: ${outcome.failedDates.join(", ")}.`);
  }
  if (outcome.skippedCount) {
    sentences.push(`${outcome.skippedCount} day ${outcome.skippedCount === 1 ? "note was" : "notes were"} skipped because ${outcome.skippedCount === 1 ? "it was" : "they were"} invalid.`);
  }
  return sentences.length ? sentences.join(" ") : null;
}

/** Appends the day-note sentence to a status message. */
export function withBehaviorLogDayNoteMessage(message: string, outcome: BehaviorLogDayNoteOutcome | null, phase: "preview" | "applied"): string {
  const sentence = outcome ? describeBehaviorLogDayNoteOutcome(outcome, phase) : null;
  return sentence ? `${message} ${sentence}` : message;
}

function countDays(count: number): string {
  return `${count} ${count === 1 ? "day" : "days"}`;
}

function isCadenceDayNote(record: Record<string, unknown>): boolean {
  const extensions = record.extensions;
  if (!isRecord(extensions)) return false;
  const cadence = extensions[CADENCE_EXTENSION_NAMESPACE];
  return isRecord(cadence) && cadence.day_note === true;
}

function toDayNoteReview(record: Record<string, unknown>, externalId: string | null): BehaviorLogDayNoteReview | string {
  if (!externalId) return "The day note has no review id.";
  if (record.review_role !== "user") return "Only user-written day notes can be restored.";
  let localDate: string;
  try {
    localDate = parseDayNoteLocalDate(record.period_start_local_date);
  } catch {
    return "The day note has no valid date.";
  }
  if (record.period_end_local_date !== localDate) return "A day note must cover exactly one day.";
  if (typeof record.summary_markdown !== "string") return "The day note has no text.";
  const note = normalizeDayNote(record.summary_markdown);
  if (note === null) return "The day note has no text.";
  if ([...note].length > DAY_NOTE_LIMITS.characters) return "The day note is longer than the limit.";
  return { externalId, localDate, note };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
