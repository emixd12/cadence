import {
  PERIOD_LIMITS,
  normalizePeriodLabel,
  normalizePeriodNote,
  parsePeriodLocalDate,
  periodNaturalKey,
  type PeriodRecord,
} from "./period.resolver";

/**
 * Ticket 373: import and restore of Cadence Periods from BehaviorLog.
 *
 * Cadence exports each Period as a user `review` record in `data/reviews.jsonl`
 * with the `app.cadence` extension `{ period: true, label, ongoing, note,
 * updated_at_utc }`. This resolver reads only those records and plans writes back
 * to Periods. A review without `period: true` is not a Period: day-note reviews
 * and reviews from other tools are left to their own handling.
 *
 * A Period in a file is matched by its natural key (label, first day, last day,
 * ongoing matching ongoing), never by the file's id. A file from another account,
 * a repeated import and a retry after a partial failure therefore behave the same.
 * The resolver has no I/O or clock access; services save through the
 * `PeriodDataStore`. Labels and notes are the person's own words: no message
 * built here contains one.
 */
export const BEHAVIORLOG_PERIOD_REVIEWS_PATH = "data/reviews.jsonl";

const CADENCE_EXTENSION_NAMESPACE = "app.cadence";

export type BehaviorLogPeriodReview = Readonly<{
  /** The file's review id, for reports only. It is never used to match a Period. */
  externalId: string | null;
  label: string;
  startOn: string;
  /** Null when the extension says `ongoing: true`. */
  endOn: string | null;
  /** True when the extension carries a `note` field, including an explicit null. */
  hasNote: boolean;
  note: string | null;
}>;

export type BehaviorLogPeriodRead = Readonly<{
  /** One entry per natural key, in display order. */
  periods: BehaviorLogPeriodReview[];
  /** Cadence Period reviews that could not be read safely. */
  skipped: { externalId: string | null; reason: string }[];
}>;

export type BehaviorLogPeriodMode = "import" | "restore";

/** The stored fields a plan reads. Pass every Period of the account, so the cap is counted correctly. */
export type BehaviorLogExistingPeriod = Pick<PeriodRecord, "id" | "label" | "start_on" | "end_on" | "note" | "revision"> &
  Partial<Pick<PeriodRecord, "created_at">>;

export type BehaviorLogPeriodAction = BehaviorLogPeriodReview & Readonly<{
  /**
   * create: no stored Period has this key and it fits under the cap.
   * over_limit: no stored Period has this key and the account has no room for it.
   * keep: a stored Period has this key; nothing changes.
   * set_note: restore only. A stored Period has this key, the file carries a note
   * field and the stored note differs.
   */
  action: "create" | "over_limit" | "keep" | "set_note";
  /** The matched stored Period, for `keep` and `set_note`. */
  existing: Readonly<{ id: string; revision: number; note: string | null }> | null;
}>;

export type BehaviorLogPeriodPlan = Readonly<{
  mode: BehaviorLogPeriodMode;
  actions: BehaviorLogPeriodAction[];
  skipped: BehaviorLogPeriodRead["skipped"];
}>;

export type BehaviorLogPeriodOutcome = Readonly<{
  mode: BehaviorLogPeriodMode;
  /** True when the saved Periods could not be read, so none was planned or saved. */
  unavailable: boolean;
  /** Periods added (or, in a preview, to add). */
  added: number;
  /** Stored Periods whose note was set from the file (restore only). */
  notesSet: number;
  /** Periods in the file that already exist and were left as they are. */
  existing: number;
  /** Periods that do not fit under the account cap and were not added. */
  overLimit: number;
  /** Writes that failed. They do not undo the committed import or restore. */
  failed: number;
  skippedCount: number;
}>;

type BundleFile = Readonly<{ path: string; content: string }>;

/** Reads Cadence-produced Period reviews; ignores every other review. */
export function readBehaviorLogPeriodReviews(files: readonly BundleFile[]): BehaviorLogPeriodRead {
  const file = files.find((entry) => entry.path === BEHAVIORLOG_PERIOD_REVIEWS_PATH);
  if (!file) return { periods: [], skipped: [] };
  const skipped: { externalId: string | null; reason: string }[] = [];
  const byKey = new Map<string, BehaviorLogPeriodReview>();

  for (const line of file.content.split("\n")) {
    if (!line.trim()) continue;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(record) || record.record_type !== "review") continue;
    const extension = cadencePeriodExtension(record);
    if (!extension) continue;
    const externalId = typeof record.review_id === "string" && record.review_id ? record.review_id : null;
    const review = toPeriodReview(record, extension, externalId);
    if (typeof review === "string") {
      skipped.push({ externalId, reason: review });
      continue;
    }
    const key = reviewKey(review);
    const first = byKey.get(key);
    if (!first) {
      byKey.set(key, review);
      continue;
    }
    // The same Period twice is one Period. When the copies disagree about the
    // note, the Period stays and no copy's note is used.
    if (first.hasNote !== review.hasNote || first.note !== review.note) {
      byKey.set(key, { ...first, hasNote: false, note: null });
      skipped.push({ externalId, reason: "The file has this period more than once with different notes. Its note was left out." });
    }
  }

  const periods = [...byKey.values()].sort(compareReviews);
  return { periods, skipped };
}

/**
 * Plans Period writes against every stored Period of the account.
 *
 * Import adds a Period when no stored Period has the same natural key and never
 * changes a stored one. Restore does the same and also sets the note of a matching
 * Period when the file carries a note field: an absent field keeps the stored
 * note, an explicit null clears it. A retried restore passes `setNotes: false`,
 * so a note edited after the first restore stays. Neither mode removes a Period
 * the file does not name, because an export can cover a date range. Neither adds
 * past the cap: new Periods are added in display order while room remains and the
 * rest are reported as `over_limit`.
 *
 * Matching is exact, so a stored Period whose label or dates were edited after the
 * export no longer matches and the file's Period is added beside it.
 */
export function planBehaviorLogPeriodWrites(input: Readonly<{
  read: BehaviorLogPeriodRead;
  existing: readonly BehaviorLogExistingPeriod[];
  mode: BehaviorLogPeriodMode;
  setNotes?: boolean;
  /** The account cap. Defaults to `PERIOD_LIMITS.perAccount`. */
  limit?: number;
}>): BehaviorLogPeriodPlan {
  const setNotes = input.setNotes ?? input.mode === "restore";
  const limit = input.limit ?? PERIOD_LIMITS.perAccount;
  // When two stored Periods share a key, the oldest is the match.
  const existingByKey = new Map<string, BehaviorLogExistingPeriod>();
  for (const period of [...input.existing].sort(compareExisting)) {
    const key = periodNaturalKey(period);
    if (!existingByKey.has(key)) existingByKey.set(key, period);
  }
  let room = Math.max(0, limit - input.existing.length);
  const actions = input.read.periods.map((review): BehaviorLogPeriodAction => {
    const match = existingByKey.get(reviewKey(review));
    if (!match) {
      if (room <= 0) return { ...review, action: "over_limit", existing: null };
      room--;
      return { ...review, action: "create", existing: null };
    }
    const existing = { id: match.id, revision: match.revision, note: match.note };
    const action = setNotes && review.hasNote && match.note !== review.note ? "set_note" : "keep";
    return { ...review, action, existing };
  });
  return { mode: input.mode, actions, skipped: input.read.skipped };
}

/** Outcome before any save: what the preview tells the user. */
export function previewBehaviorLogPeriodOutcome(plan: BehaviorLogPeriodPlan): BehaviorLogPeriodOutcome {
  const count = (action: BehaviorLogPeriodAction["action"]) => plan.actions.filter((entry) => entry.action === action).length;
  return {
    mode: plan.mode,
    unavailable: false,
    added: count("create"),
    notesSet: count("set_note"),
    existing: count("keep") + count("set_note"),
    overLimit: count("over_limit"),
    failed: 0,
    skippedCount: plan.skipped.length,
  };
}

/** Outcome when the saved Periods could not be read. */
export function unavailableBehaviorLogPeriodOutcome(mode: BehaviorLogPeriodMode): BehaviorLogPeriodOutcome {
  return { mode, unavailable: true, added: 0, notesSet: 0, existing: 0, overLimit: 0, failed: 0, skippedCount: 0 };
}

/** One plain sentence group for the import or restore message; null when nothing applies. */
export function describeBehaviorLogPeriodOutcome(
  outcome: BehaviorLogPeriodOutcome,
  phase: "preview" | "applied",
): string | null {
  const preview = phase === "preview";
  if (outcome.unavailable) {
    return preview
      ? "Periods could not be checked. Preview the bundle again to include them."
      : outcome.mode === "restore"
        ? "Periods could not be restored. Your other data was restored. Apply this restore again to add the periods."
        : "Periods could not be imported. Your other data was imported. Preview and apply the bundle again to add the periods.";
  }
  const parts: string[] = [];
  if (outcome.added) parts.push(`${outcome.added} ${preview ? "to add" : "added"}`);
  if (outcome.existing) parts.push(`${outcome.existing} already saved`);
  const sentences: string[] = [];
  if (parts.length) sentences.push(`Periods: ${parts.join(", ")}.`);
  if (outcome.notesSet) {
    sentences.push(`${countNotes(outcome.notesSet)} on saved periods ${preview ? "will be" : outcome.notesSet === 1 ? "was" : "were"} set from the bundle.`);
  }
  if (outcome.overLimit) {
    sentences.push(
      `${countPeriods(outcome.overLimit)} ${outcome.overLimit === 1 ? "does" : "do"} not fit under the limit of ${PERIOD_LIMITS.perAccount} periods and ${preview ? "will not be" : outcome.overLimit === 1 ? "was not" : "were not"} added.`,
    );
  }
  if (outcome.failed) sentences.push(`${countPeriods(outcome.failed)} could not be saved.`);
  if (outcome.skippedCount) {
    sentences.push(`${outcome.skippedCount} period ${outcome.skippedCount === 1 ? "record in the bundle was invalid and was" : "records in the bundle were invalid and were"} skipped.`);
  }
  return sentences.length ? sentences.join(" ") : null;
}

/** Appends the Period sentence to a status message. */
export function withBehaviorLogPeriodMessage(message: string, outcome: BehaviorLogPeriodOutcome | null, phase: "preview" | "applied"): string {
  const sentence = outcome ? describeBehaviorLogPeriodOutcome(outcome, phase) : null;
  return sentence ? `${message} ${sentence}` : message;
}

function countPeriods(count: number): string {
  return `${count} ${count === 1 ? "period" : "periods"}`;
}

function countNotes(count: number): string {
  return `${count} ${count === 1 ? "note" : "notes"}`;
}

function reviewKey(review: Pick<BehaviorLogPeriodReview, "label" | "startOn" | "endOn">): string {
  return periodNaturalKey({ label: review.label, start_on: review.startOn, end_on: review.endOn });
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** First day, then last day with ongoing last, then label. */
function compareReviews(a: BehaviorLogPeriodReview, b: BehaviorLogPeriodReview): number {
  if (a.startOn !== b.startOn) return compareText(a.startOn, b.startOn);
  if (a.endOn !== b.endOn) {
    if (a.endOn === null) return 1;
    if (b.endOn === null) return -1;
    return compareText(a.endOn, b.endOn);
  }
  return compareText(a.label, b.label);
}

function compareExisting(a: BehaviorLogExistingPeriod, b: BehaviorLogExistingPeriod): number {
  return compareText(a.created_at ?? "", b.created_at ?? "") || compareText(a.id, b.id);
}

function cadencePeriodExtension(record: Record<string, unknown>): Record<string, unknown> | null {
  const extensions = record.extensions;
  if (!isRecord(extensions)) return null;
  const cadence = extensions[CADENCE_EXTENSION_NAMESPACE];
  return isRecord(cadence) && cadence.period === true ? cadence : null;
}

function toPeriodReview(
  record: Record<string, unknown>,
  extension: Record<string, unknown>,
  externalId: string | null,
): BehaviorLogPeriodReview | string {
  if (record.review_role !== "user") return "Only periods the person wrote can be imported.";
  let label: string;
  try {
    label = normalizePeriodLabel(extension.label === undefined ? record.summary_markdown : extension.label);
  } catch {
    return "The period has no valid label.";
  }
  let startOn: string;
  try {
    startOn = parsePeriodLocalDate(record.period_start_local_date);
  } catch {
    return "The period has no valid first day.";
  }
  let endOn: string | null = null;
  if (extension.ongoing !== true) {
    try {
      endOn = parsePeriodLocalDate(record.period_end_local_date);
    } catch {
      return "The period has no valid last day.";
    }
    if (endOn < startOn) return "The period ends before it starts.";
  }
  const hasNote = Object.hasOwn(extension, "note");
  let note: string | null = null;
  if (hasNote) {
    try {
      note = normalizePeriodNote(extension.note);
    } catch {
      return "The period note is not valid.";
    }
  }
  return { externalId, label, startOn, endOn, hasNote, note };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
