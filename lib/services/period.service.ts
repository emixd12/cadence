import { Temporal } from "@js-temporal/polyfill";

import {
  periodLabelSuggestions,
  periodsNewestFirst,
  toPeriodView,
  type PeriodRecord,
} from "@cadence/core/resolvers/period.resolver";
import { fixedClock, todayIn } from "@cadence/core/resolvers/time.resolver";
import {
  periodErrorActionState,
  createPeriod,
  deletePeriod,
  endPeriod,
  listPeriods,
  savePeriodNote,
  updatePeriod,
  type PeriodDeleteResult,
  type PeriodUpdateInput,
  type PeriodWriteResult,
} from "@cadence/core/services/period.service";
import { listPeriodNoteShortcuts } from "@cadence/core/services/note-shortcut.service";
import type { NoteShortcut } from "@cadence/core/types/note-shortcut";
import type { PeriodActionState, PeriodView } from "@cadence/core/types/period";
import { DEFAULT_TIMEZONE } from "@cadence/core/types/recurrence";

import { requireCurrentUserId } from "@/lib/auth/current-user";
import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import { createNoteShortcutStore } from "@/lib/db/noteShortcuts.repo";
import { createPeriodStore, listPeriodsOrNone } from "@/lib/db/periods.repo";
import { getProfileSettings } from "@/lib/db/profiles.repo";
import { createClient } from "@/lib/supabase/server";

// Callers: the Timeline's Server Actions and the Timeline and Behaviors page reads
// (Ticket 369); MCP handlers follow in Ticket 370. Period labels and notes are the
// person's own words and can describe health: never log them.

const SIGN_IN_MESSAGE = "Sign in again before changing periods.";

/** Shown as it is, beside the rule sentences the core service lists. */
const ALSO_SHOWN: ReadonlySet<string> = new Set([SIGN_IN_MESSAGE]);

/**
 * The action state for a failed Period write. A stale write names the
 * `period.conflict` notice. A broken rule keeps the service's own sentence. Any
 * other failure gets `fallback`, so provider text never reaches the screen.
 */
export function periodErrorToActionState(error: unknown, fallback: string): PeriodActionState {
  return periodErrorActionState(error, fallback, ALSO_SHOWN);
}

/** What the all-Periods list on Behaviors reads. */
export type PeriodListView = Readonly<{
  /** Every Period of the account, newest first. */
  periods: PeriodView[];
  /** Past labels, newest first, offered in the editor. */
  labelSuggestions: string[];
  /** Lines that repeat across Period notes, offered in the note field. */
  noteShortcuts: NoteShortcut[];
}>;

export async function getPeriodListForCurrentUser(): Promise<PeriodListView> {
  const supabase = await createClient();
  const userId = await requireCurrentUserId("Sign in again before viewing periods.");
  const records = await listPeriodsOrNone(supabase, userId);
  return {
    periods: periodsNewestFirst(records).map(toPeriodView),
    labelSuggestions: periodLabelSuggestions(records),
    noteShortcuts: await listPeriodNoteShortcuts(createNoteShortcutStore(supabase, userId), records, Temporal.Now.instant()),
  };
}

export type PeriodCreateFields = Readonly<{ label: unknown; startOn: unknown; endOn?: unknown; note?: unknown }>;
export type PeriodTarget = Readonly<{ id: unknown; expectedRevision: unknown }>;

/** Form fields: `label`, `start_on`, `end_on` (empty means ongoing), `note`. */
export async function createPeriodFromFormData(formData: FormData): Promise<PeriodWriteResult> {
  const supabase = await createClient();
  const userId = await requireCurrentUserId(SIGN_IN_MESSAGE);
  return createPeriodForUser(supabase, userId, {
    label: formData.get("label"),
    startOn: formData.get("start_on"),
    endOn: formData.get("end_on"),
    note: formData.get("note"),
  });
}

/**
 * Form fields: `period_id`, `expected_revision`, `label`, `start_on` and `end_on`. An
 * empty `end_on` makes the Period ongoing. `note` is optional: the editor saves the
 * note of an existing Period on its own, so a form without the field keeps the note,
 * and an empty one clears it.
 */
export async function updatePeriodFromFormData(formData: FormData): Promise<PeriodWriteResult> {
  const supabase = await createClient();
  const userId = await requireCurrentUserId(SIGN_IN_MESSAGE);
  return updatePeriodForUser(supabase, userId, {
    ...readTarget(formData),
    label: formData.get("label"),
    startOn: formData.get("start_on"),
    endOn: formData.get("end_on"),
    ...(formData.has("note") ? { note: formData.get("note") } : {}),
  });
}

/**
 * The auto-saving note field. Form fields: `period_id`, `note` and `expected_note`,
 * the note the field last read. Label and days stay as they are.
 */
export async function savePeriodNoteFromFormData(formData: FormData): Promise<PeriodWriteResult> {
  const supabase = await createClient();
  const userId = await requireCurrentUserId(SIGN_IN_MESSAGE);
  return savePeriodNote(createPeriodStore(supabase, userId), {
    id: formData.get("period_id"),
    expectedNote: formData.get("expected_note"),
    note: formData.get("note"),
  });
}

/** Form fields: `period_id`, `expected_revision`. */
export async function endPeriodFromFormData(formData: FormData): Promise<PeriodWriteResult> {
  const supabase = await createClient();
  const userId = await requireCurrentUserId(SIGN_IN_MESSAGE);
  return endPeriodForUser(supabase, userId, readTarget(formData));
}

/** Form fields: `period_id`, `expected_revision`. */
export async function deletePeriodFromFormData(formData: FormData): Promise<PeriodDeleteResult> {
  const supabase = await createClient();
  const userId = await requireCurrentUserId(SIGN_IN_MESSAGE);
  return deletePeriodForUser(supabase, userId, readTarget(formData));
}

/** Every Period of the account, or with a range only those with a day inside it. */
export async function listPeriodsForUser(
  supabase: AppSupabaseClient,
  userId: string,
  range?: Readonly<{ from: unknown; to: unknown }>,
  options: Readonly<{ maxDays?: number | null }> = {},
): Promise<PeriodRecord[]> {
  return listPeriods(createPeriodStore(supabase, userId), range, options);
}

export async function createPeriodForUser(
  supabase: AppSupabaseClient,
  userId: string,
  input: PeriodCreateFields,
): Promise<PeriodWriteResult> {
  return createPeriod(createPeriodStore(supabase, userId), input);
}

/** Only the fields present in the input change. */
export async function updatePeriodForUser(
  supabase: AppSupabaseClient,
  userId: string,
  input: PeriodUpdateInput,
): Promise<PeriodWriteResult> {
  return updatePeriod(createPeriodStore(supabase, userId), input);
}

/**
 * "End today". Today is the local date in the profile timezone at the time of the
 * write, read here and never taken from the caller. `now` is for tests.
 */
export async function endPeriodForUser(
  supabase: AppSupabaseClient,
  userId: string,
  input: PeriodTarget,
  options: Readonly<{ now?: Temporal.Instant }> = {},
): Promise<PeriodWriteResult> {
  const today = await periodTodayForUser(supabase, userId, options.now ?? Temporal.Now.instant());
  return endPeriod(createPeriodStore(supabase, userId), { ...input, today });
}

export async function deletePeriodForUser(
  supabase: AppSupabaseClient,
  userId: string,
  input: PeriodTarget,
): Promise<PeriodDeleteResult> {
  return deletePeriod(createPeriodStore(supabase, userId), input);
}

/** The account's local date at `now`, from the profile timezone. */
export async function periodTodayForUser(
  supabase: AppSupabaseClient,
  userId: string,
  now: Temporal.Instant,
): Promise<string> {
  const profile = await getProfileSettings(supabase, userId);
  return todayIn(fixedClock(now), profile?.timezone || DEFAULT_TIMEZONE);
}

function readTarget(formData: FormData): PeriodTarget {
  return { id: formData.get("period_id"), expectedRevision: formData.get("expected_revision") };
}
