import { Temporal } from "@js-temporal/polyfill";
import type { AlongsideFormView } from "@cadence/core/resolvers/alongside.resolver";
import {
  EFFECTIVE_WHERE_EVIDENCE_PERIOD_DAYS,
  isWhereGuess,
  type EffectiveWhereLabel,
} from "@cadence/core/resolvers/effective-where.resolver";
import {
  alongsideFormViews,
  buildAlongsideBehaviorFacts,
  type AlongsideBehaviorFacts,
  type AlongsideGuess,
  type AlongsideGuessesResponse,
} from "@cadence/core/services/alongside-facts";
import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import { alongsideEnabled } from "@/lib/services/alongside-flag";
import { currentEstimate, type BriefMoveBehaviorFacts } from "@/lib/services/brief-move-day.service";
import { requireCurrentUserId } from "@/lib/auth/current-user";
import { readCachedProfileTimezone } from "@/lib/cache/stable-user-data.cache";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_TIMEZONE } from "@/lib/types/recurrence";

export {
  alongsideFormViews,
  alongsideQuestionBehaviorIds,
  alongsideRowViews,
  alongsideWhereGuesses,
  type AlongsideBehaviorFacts,
} from "@cadence/core/services/alongside-facts";

/**
 * Ticket 358 (D33): the alongside facts the Behavior form, the Timeline rows and the
 * Where suggestion show. One read for all three, built on the same rules the planners
 * use (`resolveAlongside`, `resolveEffectiveWhere`, and the cached estimate only while
 * its `input_hash` matches). Since Ticket 363 the facts are built in
 * `@cadence/core/services/alongside-facts`, which Cadence for Mac shares.
 *
 * Reads nothing and returns null while `CADENCE_ALONGSIDE` is off, so `behaviors.alongside`,
 * `where_guess` and `completion_place_labels` are not read and every surface renders as
 * before.
 */
type BehaviorRow = Readonly<{
  id: string; title: string; description: string | null; timezone: string; where_kind: string | null;
  location_text: string | null; updated_at: string; alongside: boolean | null;
}>;
type EstimateRow = Readonly<{ behavior_id: string; input_hash: string; duration_minutes: number | null; alongside: boolean; where_guess: string | null }>;
type LabelRow = Readonly<{ behavior_id: string; label: string; local_date: string }>;

export async function readAlongsideBehaviorFacts(
  supabase: AppSupabaseClient,
  userId: string,
  input: Readonly<{ behaviorIds?: readonly string[]; localDate: string; env?: Readonly<Record<string, string | undefined>> }>,
): Promise<ReadonlyMap<string, AlongsideBehaviorFacts> | null> {
  if (!alongsideEnabled(input.env)) return null;
  const ids = input.behaviorIds ? [...new Set(input.behaviorIds)] : null;
  if (ids && ids.length === 0) return new Map();
  const first = Temporal.PlainDate.from(input.localDate).subtract({ days: EFFECTIVE_WHERE_EVIDENCE_PERIOD_DAYS - 1 }).toString();
  // Labels only, never positions, inside the evidence period (Ticket 357).
  let labelQuery = supabase.from("completion_place_labels").select("behavior_id, label, local_date").eq("user_id", userId)
    .gte("local_date", first).lte("local_date", input.localDate);
  if (ids) labelQuery = labelQuery.in("behavior_id", ids);
  const [current, labels] = await Promise.all([readCurrentGuesses(supabase, userId, ids), labelQuery]);
  if (labels.error) throw labels.error;
  const labelsByBehavior = new Map<string, EffectiveWhereLabel[]>();
  for (const row of (labels.data ?? []) as readonly LabelRow[]) {
    labelsByBehavior.set(row.behavior_id, [...(labelsByBehavior.get(row.behavior_id) ?? []), { label: row.label, localDate: row.local_date }]);
  }
  return buildAlongsideBehaviorFacts({
    behaviors: current.behaviors.map((row) => ({ id: row.id, alongside: row.alongside, whereKind: row.where_kind, locationText: row.location_text })),
    guesses: current.guesses, labels: labelsByBehavior, localDate: input.localDate,
  });
}

/** Each Behavior row and its current model guesses (the cached estimate while its inputs are unchanged). */
async function readCurrentGuesses(supabase: AppSupabaseClient, userId: string, ids: readonly string[] | null) {
  let behaviorQuery = supabase.from("behaviors").select("id, title, description, timezone, where_kind, location_text, updated_at, alongside").eq("user_id", userId);
  let estimateQuery = supabase.from("behavior_advisor_estimates").select("behavior_id, input_hash, duration_minutes, alongside, where_guess").eq("user_id", userId);
  if (ids) {
    behaviorQuery = behaviorQuery.in("id", ids);
    estimateQuery = estimateQuery.in("behavior_id", ids);
  }
  const [behaviors, estimates] = await Promise.all([behaviorQuery, estimateQuery]);
  for (const result of [behaviors, estimates]) if (result.error) throw result.error;
  const estimateByBehavior = new Map(((estimates.data ?? []) as readonly EstimateRow[]).map((row) => [row.behavior_id, row]));
  const rows = (behaviors.data ?? []) as readonly BehaviorRow[];
  const guesses = new Map<string, AlongsideGuess>();
  for (const row of rows) {
    const facts: BriefMoveBehaviorFacts = {
      id: row.id, title: row.title, description: row.description, timezone: row.timezone, defaultDurationMinutes: null,
      whereKind: row.where_kind, locationText: row.location_text, updatedAt: row.updated_at, alongside: row.alongside ?? null,
    };
    const estimate = currentEstimate(estimateByBehavior.get(row.id), facts, true);
    if (!estimate) continue;
    const whereGuess = row.where_kind === null && isWhereGuess(estimate.whereGuess) ? estimate.whereGuess : null;
    guesses.set(row.id, { alongside: estimate.alongside, whereGuess });
  }
  return { behaviors: rows, guesses };
}

/**
 * Ticket 363: the current model guesses for every Behavior of the account, for a linked
 * Cadence for Mac (`GET /api/behaviors/alongside`). The Mac keeps them in memory only and
 * builds every view itself from its own rows. `enabled: false`, with no reads, while
 * `CADENCE_ALONGSIDE` is off, so the Mac shows no alongside UI for the account. Only
 * Behaviors with a current guess are listed.
 */
export async function readAlongsideGuesses(
  supabase: AppSupabaseClient,
  userId: string,
  env?: Readonly<Record<string, string | undefined>>,
): Promise<AlongsideGuessesResponse> {
  if (!alongsideEnabled(env)) return { enabled: false, guesses: [] };
  const { guesses } = await readCurrentGuesses(supabase, userId, null);
  return {
    enabled: true,
    guesses: [...guesses].filter(([, guess]) => guess.alongside !== null || guess.whereGuess !== null)
      .map(([behaviorId, guess]) => ({ behaviorId, alongside: guess.alongside, whereGuess: guess.whereGuess })),
  };
}

/**
 * The Behaviors page's alongside form views. Null, with no reads at all, while
 * `CADENCE_ALONGSIDE` is off.
 */
export async function getAlongsideFormViewsForCurrentUser(
  behaviorIds: readonly string[],
): Promise<Readonly<Record<string, AlongsideFormView>> | null> {
  if (!alongsideEnabled()) return null;
  const supabase = await createClient();
  const userId = await requireCurrentUserId("Sign in again before viewing behaviors.");
  const timezone = (await readCachedProfileTimezone(supabase, userId)) ?? DEFAULT_TIMEZONE;
  return alongsideFormViews(await readAlongsideBehaviorFacts(supabase, userId, {
    behaviorIds, localDate: Temporal.Now.instant().toZonedDateTimeISO(timezone).toPlainDate().toString(),
  }));
}
