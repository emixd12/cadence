import { Temporal } from "@js-temporal/polyfill";

import { resolveExpectedNote, resolveNoteUpdate } from "./status.resolver";

/**
 * A day note is one note about a whole calendar date in the user's timezone.
 * It has no status, no Behavior, and no Occurrence. It never changes adherence,
 * Needs decision, or reminders. Clearing keeps the row with a null note.
 */
export const DAY_NOTE_LIMITS = { characters: 2_000, rangeDays: 92 } as const;

export const DAY_NOTE_SHORTCUT_POOL_ID = "day_notes";

export type DayNoteRecord = {
  id: string;
  user_id: string;
  local_date: string;
  note: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
};

export type DayNoteUpdatePlan = Readonly<{
  localDate: string;
  expectedNote: string | null;
  note: string | null;
}>;

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseDayNoteLocalDate(value: unknown): string {
  if (typeof value !== "string" || !LOCAL_DATE.test(value)) {
    throw new Error("Choose a valid day for this note.");
  }
  try {
    return Temporal.PlainDate.from(value, { overflow: "reject" }).toString();
  } catch {
    throw new Error("Choose a valid day for this note.");
  }
}

/** Normalizes like Occurrence notes: CRLF to LF, trimmed, empty becomes null. */
export function normalizeDayNote(value: string): string | null {
  return resolveNoteUpdate({ note: value }).note;
}

export function resolveDayNoteUpdate(input: Readonly<{
  localDate: unknown;
  expectedNote: unknown;
  note: unknown;
}>): DayNoteUpdatePlan {
  const localDate = parseDayNoteLocalDate(input.localDate);
  if (typeof input.note !== "string") throw new Error("Enter a day note before saving.");
  if (typeof input.expectedNote !== "string") throw new Error("Refresh this day before saving its note.");
  const note = normalizeDayNote(input.note);
  if (note !== null && [...note].length > DAY_NOTE_LIMITS.characters) {
    throw new Error(`Keep the day note to ${DAY_NOTE_LIMITS.characters.toLocaleString("en-US")} characters or fewer.`);
  }
  return {
    localDate,
    expectedNote: resolveExpectedNote(input.expectedNote),
    note,
  };
}

/** Inclusive date list used to read the visible Timeline days. */
export function resolveDayNoteRange(input: Readonly<{ from: unknown; to: unknown }>): Readonly<{ from: string; to: string }> {
  const from = parseDayNoteLocalDate(input.from);
  const to = parseDayNoteLocalDate(input.to);
  const days = Temporal.PlainDate.from(from).until(Temporal.PlainDate.from(to), { largestUnit: "days" }).days + 1;
  if (days < 1) throw new Error("The day range must end on or after its start.");
  if (days > DAY_NOTE_LIMITS.rangeDays) throw new Error(`Choose at most ${DAY_NOTE_LIMITS.rangeDays} days of day notes.`);
  return { from, to };
}

/** Indexes saved, non-empty day notes by local date. */
export function dayNotesByDate(records: readonly Pick<DayNoteRecord, "local_date" | "note">[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const record of records) {
    if (record.note && record.note.trim()) result[record.local_date] = record.note;
  }
  return result;
}

/** One-line preview for the day header. */
export function dayNotePreview(note: string, maxCharacters = 80): string {
  const line = note.replace(/\s+/gu, " ").trim();
  const characters = [...line];
  return characters.length <= maxCharacters ? line : `${characters.slice(0, maxCharacters - 1).join("").trimEnd()}…`;
}

type TimelineDates = {
  daySections: readonly { localDate: string }[];
  needsDecision: { daySections: readonly { localDate: string }[] };
};

/** The first and last local dates a Timeline view shows, including Needs decision days. */
export function timelineDayNoteRange(view: Readonly<TimelineDates>): Readonly<{ from: string; to: string }> | null {
  const dates = [...view.daySections, ...view.needsDecision.daySections].map((section) => section.localDate).sort();
  return dates.length ? { from: dates[0]!, to: dates[dates.length - 1]! } : null;
}

/** Returns the view with saved notes for exactly the dates it shows. */
export function attachTimelineDayNotes<T extends TimelineDates>(
  view: T,
  records: readonly Pick<DayNoteRecord, "local_date" | "note">[],
): T & { dayNotes: Record<string, string> } {
  const shown = new Set([...view.daySections, ...view.needsDecision.daySections].map((section) => section.localDate));
  return { ...view, dayNotes: dayNotesByDate(records.filter((record) => shown.has(record.local_date))) };
}

/**
 * Ticket 367 (D35): the day notes the Daily Brief's opening reads. Today and the two
 * local days before it, each note cut to 280 characters. A model sentence may not
 * repeat a whole note of three or more words, or six words in a row from a note.
 */
export const BRIEF_DAY_NOTE_LIMITS = { days: 3, characters: 280, wholeNoteWords: 3, sharedWords: 6 } as const;

export const BRIEF_DAY_NOTE_DAYS = ["today", "yesterday", "2 days ago"] as const;
export type BriefDayNote = Readonly<{ day: (typeof BRIEF_DAY_NOTE_DAYS)[number]; note: string }>;

/** The inclusive local dates the Daily Brief reads day notes for; `localDate` is today in the account's timezone. */
export function briefDayNoteRange(localDate: string): Readonly<{ from: string; to: string }> {
  const to = parseDayNoteLocalDate(localDate);
  return { from: Temporal.PlainDate.from(to).subtract({ days: BRIEF_DAY_NOTE_LIMITS.days - 1 }).toString(), to };
}

/** The brief's day notes, newest day first. Days with no note are left out; an empty list means the brief gets none. */
export function resolveBriefDayNotes(input: Readonly<{
  localDate: string;
  records: readonly Pick<DayNoteRecord, "local_date" | "note">[];
}>): BriefDayNote[] {
  const today = Temporal.PlainDate.from(parseDayNoteLocalDate(input.localDate));
  const saved = dayNotesByDate(input.records);
  return BRIEF_DAY_NOTE_DAYS.flatMap((day, daysAgo) => {
    const note = saved[today.subtract({ days: daysAgo }).toString()]?.trim();
    return note ? [{ day, note: [...note].slice(0, BRIEF_DAY_NOTE_LIMITS.characters).join("").trimEnd() }] : [];
  });
}

/**
 * True when `text` repeats a day note: the whole note when it has three or more words, or
 * any six words in a row from a longer one. Case, spacing and punctuation are ignored.
 */
export function textQuotesDayNote(text: string, notes: readonly string[]): boolean {
  const words = (value: string) => value.normalize("NFKC").toLowerCase().split(/[^\p{L}\p{N}']+/u).filter(Boolean);
  const haystack = ` ${words(text).join(" ")} `;
  return notes.some((note) => {
    const needle = words(note);
    if (needle.length < BRIEF_DAY_NOTE_LIMITS.wholeNoteWords) return false;
    const size = Math.min(BRIEF_DAY_NOTE_LIMITS.sharedWords, needle.length);
    for (let index = 0; index + size <= needle.length; index += 1) {
      if (haystack.includes(` ${needle.slice(index, index + size).join(" ")} `)) return true;
    }
    return false;
  });
}
