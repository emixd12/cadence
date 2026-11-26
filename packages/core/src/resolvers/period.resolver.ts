import { Temporal } from "@js-temporal/polyfill";

import type { PeriodView } from "../types/period";
import { resolveNoteUpdate } from "./status.resolver";

/**
 * A Period is a labeled range of local calendar dates the person declares for the
 * whole account, for example "Sick", November 3 to 9 (Ticket 368, D35). It is
 * annotation only: it has no Behavior and no Occurrence, and it never changes a
 * status, adherence, a reminder or a schedule. Both endpoints are inclusive. A
 * null end means the Period is ongoing. Periods may overlap and may lie in the
 * future. Dates are local dates, never instants: a timezone change does not move
 * a Period.
 */
export const PERIOD_LIMITS = {
  labelCharacters: 60,
  noteCharacters: 2_000,
  perAccount: 500,
  rangeDays: 366,
} as const;

export type PeriodRecord = {
  id: string;
  user_id: string;
  label: string;
  start_on: string;
  end_on: string | null;
  note: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
};

/** The two dates every date rule needs. */
export type PeriodDates = Readonly<Pick<PeriodRecord, "start_on" | "end_on">>;

/** Validated, normalized field values, ready to store. */
export type PeriodFields = Readonly<{
  label: string;
  startOn: string;
  endOn: string | null;
  note: string | null;
}>;

export type PeriodCreateInput = Readonly<{
  label: unknown;
  startOn: unknown;
  /** A local date. Null, undefined or empty text means ongoing. */
  endOn?: unknown;
  /** Null, undefined or blank text means no note. */
  note?: unknown;
}>;

export type PeriodCreatePlan = PeriodFields;

/** A key that is absent or undefined keeps the stored value. */
export type PeriodChanges = Readonly<{
  label?: unknown;
  startOn?: unknown;
  /** Null or empty text makes the Period ongoing. */
  endOn?: unknown;
  /** Null or blank text clears the note. */
  note?: unknown;
}>;

export type PeriodUpdatePlan = PeriodFields & Readonly<{
  id: string;
  expectedRevision: number;
  /** False when every field already has the planned value. */
  changed: boolean;
}>;

export type PeriodRange = Readonly<{ from: string; to: string }>;

export type PeriodEndState = "allowed" | "not_started" | "already_ended";

export const PERIOD_MESSAGES = {
  labelRequired: "Enter a label for this period.",
  labelTooLong: `Keep the label to ${PERIOD_LIMITS.labelCharacters} characters or fewer.`,
  labelOneLine: "Keep the label to one line.",
  startInvalid: "Choose a valid first day.",
  endInvalid: "Choose a valid last day, or leave it empty.",
  endBeforeStart: "The last day must be on or after the first day.",
  noteInvalid: "Enter the note as text.",
  noteTooLong: `Keep the note to ${PERIOD_LIMITS.noteCharacters.toLocaleString("en-US")} characters or fewer.`,
  revisionInvalid: "Refresh this period before saving it.",
  dateInvalid: "Choose a valid day.",
  rangeBackwards: "The day range must end on or after its start.",
  rangeTooLong: `Choose at most ${PERIOD_LIMITS.rangeDays} days of periods.`,
  endNotStarted: "This period has not started yet. Change its dates instead.",
  endAlreadyEnded: "This period has already ended.",
} as const;

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const LINE_BREAK = /[\n\r\v\f\u0085\u2028\u2029]/u;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function parseLocalDate(value: unknown, message: string): string {
  if (typeof value !== "string" || !LOCAL_DATE.test(value)) throw new Error(message);
  try {
    return Temporal.PlainDate.from(value, { overflow: "reject" }).toString();
  } catch {
    throw new Error(message);
  }
}

/** Parses one `YYYY-MM-DD` local date, such as the injected `today`. */
export function parsePeriodLocalDate(value: unknown): string {
  return parseLocalDate(value, PERIOD_MESSAGES.dateInvalid);
}

/**
 * Trims Unicode whitespace from both ends and checks the label rules: one line,
 * 1 to 60 characters, counted as code points like the hosted check.
 */
export function normalizePeriodLabel(value: unknown): string {
  if (typeof value !== "string") throw new Error(PERIOD_MESSAGES.labelRequired);
  const label = value.trim();
  if (label.length === 0) throw new Error(PERIOD_MESSAGES.labelRequired);
  if (LINE_BREAK.test(label)) throw new Error(PERIOD_MESSAGES.labelOneLine);
  if ([...label].length > PERIOD_LIMITS.labelCharacters) throw new Error(PERIOD_MESSAGES.labelTooLong);
  return label;
}

/** Normalizes like a day note: CRLF to LF, trimmed, blank becomes null. */
export function normalizePeriodNote(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error(PERIOD_MESSAGES.noteInvalid);
  const note = resolveNoteUpdate({ note: value }).note;
  if (note !== null && [...note].length > PERIOD_LIMITS.noteCharacters) {
    throw new Error(PERIOD_MESSAGES.noteTooLong);
  }
  return note;
}

function normalizeEndOn(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return parseLocalDate(value, PERIOD_MESSAGES.endInvalid);
}

/** The revision a caller last read: a positive integer, or its digits from a form field. */
export function resolvePeriodRevision(value: unknown): number {
  const revision = typeof value === "string" && /^\d{1,10}$/.test(value) ? Number(value) : value;
  if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 1 || revision > 2_147_483_647) {
    throw new Error(PERIOD_MESSAGES.revisionInvalid);
  }
  return revision;
}

function assertRange(startOn: string, endOn: string | null): void {
  if (endOn !== null && endOn < startOn) throw new Error(PERIOD_MESSAGES.endBeforeStart);
}

/** Validates a new Period. Any start date is allowed: past, today or future. */
export function resolvePeriodCreate(input: PeriodCreateInput): PeriodCreatePlan {
  const label = normalizePeriodLabel(input.label);
  const startOn = parseLocalDate(input.startOn, PERIOD_MESSAGES.startInvalid);
  const endOn = normalizeEndOn(input.endOn);
  assertRange(startOn, endOn);
  return { label, startOn, endOn, note: normalizePeriodNote(input.note) };
}

/**
 * Plans an edit against the stored Period. Only the keys present in `changes`
 * change; the rest keep their stored values. `expectedRevision` is the revision
 * the caller last read (a number, or digits from a form field) and defaults to
 * the stored one.
 */
export function resolvePeriodUpdate(input: Readonly<{
  period: Pick<PeriodRecord, "id" | "label" | "start_on" | "end_on" | "note" | "revision">;
  expectedRevision?: unknown;
  changes: PeriodChanges;
}>): PeriodUpdatePlan {
  const { period, changes } = input;
  const expectedRevision = input.expectedRevision === undefined
    ? period.revision
    : resolvePeriodRevision(input.expectedRevision);
  const label = changes.label === undefined ? period.label : normalizePeriodLabel(changes.label);
  const startOn = changes.startOn === undefined
    ? period.start_on
    : parseLocalDate(changes.startOn, PERIOD_MESSAGES.startInvalid);
  const endOn = changes.endOn === undefined ? period.end_on : normalizeEndOn(changes.endOn);
  const note = changes.note === undefined ? period.note : normalizePeriodNote(changes.note);
  assertRange(startOn, endOn);
  return {
    id: period.id,
    expectedRevision,
    label,
    startOn,
    endOn,
    note,
    changed: label !== period.label || startOn !== period.start_on || endOn !== period.end_on || note !== period.note,
  };
}

/**
 * Whether "End today" applies. It needs a Period that has started (first day today
 * or earlier) and is ongoing or ends after today. A Period that ends today or
 * earlier has already ended: ending never extends a finished Period.
 */
export function resolvePeriodEndState(input: Readonly<{ period: PeriodDates; today: string }>): PeriodEndState {
  const today = parsePeriodLocalDate(input.today);
  if (input.period.start_on > today) return "not_started";
  if (input.period.end_on !== null && input.period.end_on <= today) return "already_ended";
  return "allowed";
}

/** Plans "End today": the last day becomes `today`. Throws when the rule does not allow it. */
export function resolvePeriodEnd(input: Readonly<{
  period: Pick<PeriodRecord, "id" | "label" | "start_on" | "end_on" | "note" | "revision">;
  today: string;
  expectedRevision?: unknown;
}>): PeriodUpdatePlan {
  const state = resolvePeriodEndState(input);
  if (state === "not_started") throw new Error(PERIOD_MESSAGES.endNotStarted);
  if (state === "already_ended") throw new Error(PERIOD_MESSAGES.endAlreadyEnded);
  return resolvePeriodUpdate({
    period: input.period,
    expectedRevision: input.expectedRevision,
    changes: { endOn: parsePeriodLocalDate(input.today) },
  });
}

/**
 * Validates an inclusive query range. `maxDays` defaults to 366; pass null for a
 * caller with no day limit, such as an all-time analytics range.
 */
export function resolvePeriodRange(
  input: Readonly<{ from: unknown; to: unknown }>,
  options: Readonly<{ maxDays?: number | null }> = {},
): PeriodRange {
  const from = parsePeriodLocalDate(input.from);
  const to = parsePeriodLocalDate(input.to);
  if (to < from) throw new Error(PERIOD_MESSAGES.rangeBackwards);
  const maxDays = options.maxDays === undefined ? PERIOD_LIMITS.rangeDays : options.maxDays;
  if (maxDays !== null) {
    const days = Temporal.PlainDate.from(from).until(Temporal.PlainDate.from(to), { largestUnit: "days" }).days + 1;
    if (days > maxDays) {
      throw new Error(maxDays === PERIOD_LIMITS.rangeDays ? PERIOD_MESSAGES.rangeTooLong : `Choose at most ${maxDays} days of periods.`);
    }
  }
  return { from, to };
}

/** True when the Period covers the local date. Both endpoints are inclusive. */
export function periodCoversDate(period: PeriodDates, localDate: string): boolean {
  return period.start_on <= localDate && (period.end_on === null || localDate <= period.end_on);
}

function text(value: string | undefined): string {
  return value ?? "";
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** What ordering reads. `id` and `created_at` break ties when both dates are equal. */
export type OrderedPeriod = PeriodDates & Readonly<{ id?: string; created_at?: string }>;

/**
 * The one display order: first day, then last day with ongoing last, then creation
 * time, then id. Periods with equal dates keep a stable order across reads.
 */
export function comparePeriods(a: OrderedPeriod, b: OrderedPeriod): number {
  if (a.start_on !== b.start_on) return compareText(a.start_on, b.start_on);
  if (a.end_on !== b.end_on) {
    if (a.end_on === null) return 1;
    if (b.end_on === null) return -1;
    return compareText(a.end_on, b.end_on);
  }
  return compareText(text(a.created_at), text(b.created_at)) || compareText(text(a.id), text(b.id));
}

/** Periods with at least one day in the inclusive range, in display order. */
export function periodsOverlappingRange<T extends OrderedPeriod>(periods: readonly T[], from: string, to: string): T[] {
  if (to < from) return [];
  return periods
    .filter((period) => period.start_on <= to && (period.end_on === null || period.end_on >= from))
    .sort(comparePeriods);
}

/** Periods that cover `today`, in display order. A Period that starts tomorrow is not active. */
export function activePeriods<T extends OrderedPeriod>(periods: readonly T[], today: string): T[] {
  return periods.filter((period) => periodCoversDate(period, today)).sort(comparePeriods);
}

/** For Timeline day headers: each given date that a Period covers, with its Periods in display order. */
export function periodsByDate<T extends OrderedPeriod>(periods: readonly T[], dates: readonly string[]): Record<string, T[]> {
  const ordered = [...periods].sort(comparePeriods);
  const result: Record<string, T[]> = {};
  for (const date of dates) {
    const covering = ordered.filter((period) => periodCoversDate(period, date));
    if (covering.length > 0) result[date] = covering;
  }
  return result;
}

/**
 * The union of local dates in the inclusive range that at least one Period covers.
 * Overlapping Periods count a date once. An ongoing Period covers through `to`.
 */
export function periodCoveredDates(periods: readonly PeriodDates[], from: string, to: string): Set<string> {
  const covered = new Set<string>();
  if (to < from) return covered;
  const spans = periods
    .filter((period) => period.start_on <= to && (period.end_on === null || period.end_on >= from))
    .map((period) => ({
      start: period.start_on < from ? from : period.start_on,
      end: period.end_on === null || period.end_on > to ? to : period.end_on,
    }))
    .sort((a, b) => compareText(a.start, b.start));
  let reached: string | null = null;
  for (const span of spans) {
    if (reached !== null && span.end <= reached) continue;
    const end = Temporal.PlainDate.from(span.end);
    let day: Temporal.PlainDate = reached !== null && reached >= span.start
      ? Temporal.PlainDate.from(reached).add({ days: 1 })
      : Temporal.PlainDate.from(span.start);
    while (Temporal.PlainDate.compare(day, end) <= 0) {
      covered.add(day.toString());
      day = day.add({ days: 1 });
    }
    reached = span.end;
  }
  return covered;
}

/**
 * Splits rows into those on a covered date and the rest, keeping their order. Use
 * it with `periodCoveredDates` and count each side with `resolveAdherenceCounts`;
 * the adherence definition does not change.
 */
export function splitByPeriods<T extends Readonly<{ localDate: string }>>(
  rows: readonly T[],
  coveredDates: ReadonlySet<string>,
): { inside: T[]; outside: T[] };
export function splitByPeriods<T>(
  rows: readonly T[],
  coveredDates: ReadonlySet<string>,
  localDateOf: (row: T) => string,
): { inside: T[]; outside: T[] };
export function splitByPeriods<T>(
  rows: readonly T[],
  coveredDates: ReadonlySet<string>,
  localDateOf: (row: T) => string = (row) => (row as Readonly<{ localDate: string }>).localDate,
): { inside: T[]; outside: T[] } {
  const inside: T[] = [];
  const outside: T[] = [];
  for (const row of rows) (coveredDates.has(localDateOf(row)) ? inside : outside).push(row);
  return { inside, outside };
}

/**
 * Past labels to offer when adding a Period: distinct without regard to case,
 * newest first by creation time. The most recent spelling of a label wins.
 */
export function periodLabelSuggestions(
  periods: readonly Pick<PeriodRecord, "id" | "label" | "start_on" | "created_at">[],
  limit = 8,
): string[] {
  const newestFirst = [...periods].sort((a, b) =>
    compareText(b.created_at, a.created_at) || compareText(b.start_on, a.start_on) || compareText(b.id, a.id));
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const period of newestFirst) {
    if (labels.length >= limit) break;
    const key = period.label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    labels.push(period.label);
  }
  return labels;
}

/**
 * Ticket 371 (D35): the Periods the Daily Brief's opening reads. `periods` covers today, at
 * most 5. `recentPeriods` ended in the 7 local days before today, at most 3. Labels and
 * dates only: a Period's note is never part of either list.
 */
export const BRIEF_PERIOD_LIMITS = { active: 5, recent: 3, recentDays: 7 } as const;

/** One Period as the brief reads it. `since` and `until` are local dates; a null `until` means ongoing. */
export type BriefPeriod = Readonly<{ label: string; since: string; until: string | null }>;
export type BriefPeriods = Readonly<{ periods: readonly BriefPeriod[]; recentPeriods: readonly BriefPeriod[] }>;

type LabeledPeriod = OrderedPeriod & Readonly<Pick<PeriodRecord, "label">>;

/** The inclusive local dates the Daily Brief reads Periods for; `localDate` is today in the account's timezone. */
export function briefPeriodRange(localDate: string): PeriodRange {
  const to = parsePeriodLocalDate(localDate);
  return { from: Temporal.PlainDate.from(to).subtract({ days: BRIEF_PERIOD_LIMITS.recentDays }).toString(), to };
}

/**
 * Chooses the brief's Periods. Those covering today come in display order, the first 5.
 * Those that ended in the 7 days before today come most recently ended first, the first 3.
 * A Period that starts after today is in neither list.
 */
export function resolveBriefPeriods(input: Readonly<{ localDate: string; records: readonly LabeledPeriod[] }>): BriefPeriods {
  const { from, to: today } = briefPeriodRange(input.localDate);
  const shape = (period: LabeledPeriod): BriefPeriod => ({ label: period.label, since: period.start_on, until: period.end_on });
  const ended = input.records
    .filter((period) => period.end_on !== null && period.end_on >= from && period.end_on < today)
    .sort((a, b) => compareText(b.end_on ?? "", a.end_on ?? "") || comparePeriods(a, b));
  return {
    periods: activePeriods(input.records, today).slice(0, BRIEF_PERIOD_LIMITS.active).map(shape),
    recentPeriods: ended.slice(0, BRIEF_PERIOD_LIMITS.recent).map(shape),
  };
}

/**
 * Ticket 371 (D35): the Periods the advisor tips prompt reads: those with a day in the 7
 * local days before today or on today, in display order, at most 5. Labels and dates only.
 */
export const TIP_PERIOD_LIMITS = { periods: 5, days: 7 } as const;

/** One Period as the tips prompt reads it. `start` and `end` are local dates; a null `end` means ongoing. */
export type TipPeriod = Readonly<{ label: string; start: string; end: string | null }>;

/** The inclusive local dates the tips prompt reads Periods for. */
export function tipPeriodRange(localDate: string): PeriodRange {
  const to = parsePeriodLocalDate(localDate);
  return { from: Temporal.PlainDate.from(to).subtract({ days: TIP_PERIOD_LIMITS.days }).toString(), to };
}

export function resolveTipPeriods(input: Readonly<{ localDate: string; records: readonly LabeledPeriod[] }>): TipPeriod[] {
  const { from, to } = tipPeriodRange(input.localDate);
  return periodsOverlappingRange(input.records, from, to).slice(0, TIP_PERIOD_LIMITS.periods)
    .map((period) => ({ label: period.label, start: period.start_on, end: period.end_on }));
}

/** The fields a screen reads. Ownership and timestamps stay on the server. */
export function toPeriodView(period: Pick<PeriodRecord, keyof PeriodView>): PeriodView {
  return {
    id: period.id,
    label: period.label,
    start_on: period.start_on,
    end_on: period.end_on,
    note: period.note,
    revision: period.revision,
  };
}

/** Newest first for the all-Periods list: the reverse of the display order. */
export function periodsNewestFirst<T extends OrderedPeriod>(periods: readonly T[]): T[] {
  return [...periods].sort((a, b) => comparePeriods(b, a));
}

type TimelineShownDates = Readonly<{
  daySections: readonly Readonly<{ localDate: string }>[];
  needsDecision: Readonly<{ daySections: readonly Readonly<{ localDate: string }>[] }>;
}>;

/**
 * Returns the Timeline view with its Periods (Ticket 369): for each shown local date,
 * Needs decision days included, the Periods that cover it; the Periods that cover at
 * least one shown date; and label suggestions from every Period of the account.
 * `periods` is the whole account's list. A Period changes nothing else in the view.
 */
export function attachTimelinePeriods<T extends TimelineShownDates>(
  view: T,
  periods: readonly PeriodRecord[],
): T & { periods: PeriodView[]; periodsByDate: Record<string, PeriodView[]>; periodLabelSuggestions: string[] } {
  const dates = [...new Set([...view.daySections, ...view.needsDecision.daySections].map((section) => section.localDate))];
  const covering = periodsByDate(periods, dates);
  const views = new Map<string, PeriodView>();
  const byDate: Record<string, PeriodView[]> = {};
  for (const [date, records] of Object.entries(covering)) {
    byDate[date] = records.map((record) => {
      const known = views.get(record.id) ?? toPeriodView(record);
      views.set(record.id, known);
      return known;
    });
  }
  const shown = periods.filter((period) => views.has(period.id)).sort(comparePeriods);
  return {
    ...view,
    periods: shown.map((period) => views.get(period.id)!),
    periodsByDate: byDate,
    periodLabelSuggestions: periodLabelSuggestions(periods),
  };
}

function dayLabel(localDate: string, withYear: boolean): string {
  const date = Temporal.PlainDate.from(localDate);
  const day = `${MONTHS[date.month - 1]} ${date.day}`;
  return withYear ? `${day}, ${date.year}` : day;
}

/**
 * The dates as display text: "Nov 3 – Nov 9", "Nov 3" for one day, "Since Nov 3"
 * for an ongoing Period. With `today`, an ongoing Period that has not started
 * reads "From Nov 3", and a date outside today's year shows its year. Without
 * `today`, years show only when the two dates fall in different years.
 */
export function periodRangeLabel(period: PeriodDates, options: Readonly<{ today?: string }> = {}): string {
  const startYear = period.start_on.slice(0, 4);
  const endYear = period.end_on === null ? startYear : period.end_on.slice(0, 4);
  const currentYear = options.today === undefined ? null : options.today.slice(0, 4);
  const withYear = startYear !== endYear || (currentYear !== null && (startYear !== currentYear || endYear !== currentYear));
  const start = dayLabel(period.start_on, withYear);
  if (period.end_on === null) {
    return options.today !== undefined && period.start_on > options.today ? `From ${start}` : `Since ${start}`;
  }
  if (period.end_on === period.start_on) return start;
  return `${start} – ${dayLabel(period.end_on, withYear)}`;
}

/**
 * Identity of a Period in an export file: label, first day and last day, where
 * ongoing matches only ongoing. The label is compared exactly. Import and restore
 * match on this key, never on the file's id.
 */
export function periodNaturalKey(period: Pick<PeriodRecord, "label" | "start_on" | "end_on">): string {
  return JSON.stringify([period.label, period.start_on, period.end_on]);
}
