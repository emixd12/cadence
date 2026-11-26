import { Temporal } from "@js-temporal/polyfill";
import { alongsideFormView, alongsideQuestionOpen, alongsideRowView, resolveAlongside, type AlongsideFormView, type AlongsideRowView } from "@cadence/core/resolvers/alongside.resolver";
import {
  EFFECTIVE_WHERE_EVIDENCE_PERIOD_DAYS,
  isWhereGuess,
  resolveEffectiveWhere,
  type EffectiveWhereLabel,
  type WhereGuess,
} from "@cadence/core/resolvers/effective-where.resolver";
import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import { alongsideEnabled } from "@/lib/services/alongside-flag";
import { currentEstimate, type BriefMoveBehaviorFacts } from "@/lib/services/brief-move-day.service";
import { requireCurrentUserId } from "@/lib/auth/current-user";
import { readCachedProfileTimezone } from "@/lib/cache/stable-user-data.cache";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_TIMEZONE } from "@/lib/types/recurrence";

/**
 * Ticket 358 (D33): the alongside facts the Behavior form, the Timeline rows and the
 * Where suggestion show. One read for all three, built on the same rules the planners
 * use (`resolveAlongside`, `resolveEffectiveWhere`, and the cached estimate only while
 * its `input_hash` matches).
 *
 * Reads nothing and returns null while `CADENCE_ALONGSIDE` is off, so `behaviors.alongside`,
 * `where_guess` and `completion_place_labels` are not read and every surface renders as
 * before.
 */
export type AlongsideBehaviorFacts = Readonly<{
  form: AlongsideFormView;
  /** Null unless the effective value is alongside. */
  row: AlongsideRowView | null;
  /** The cached Where guess while current and Where is Not set; null otherwise. */
  whereGuess: WhereGuess | null;
  /** Ticket 360: `alongsideQuestionOpen`, so every surface asks under the same rule. */
  questionOpen: boolean;
}>;

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
  let behaviorQuery = supabase.from("behaviors").select("id, title, description, timezone, where_kind, location_text, updated_at, alongside").eq("user_id", userId);
  let estimateQuery = supabase.from("behavior_advisor_estimates").select("behavior_id, input_hash, duration_minutes, alongside, where_guess").eq("user_id", userId);
  // Labels only, never positions, inside the evidence period (Ticket 357).
  let labelQuery = supabase.from("completion_place_labels").select("behavior_id, label, local_date").eq("user_id", userId)
    .gte("local_date", first).lte("local_date", input.localDate);
  if (ids) {
    behaviorQuery = behaviorQuery.in("id", ids);
    estimateQuery = estimateQuery.in("behavior_id", ids);
    labelQuery = labelQuery.in("behavior_id", ids);
  }
  const [behaviors, estimates, labels] = await Promise.all([behaviorQuery, estimateQuery, labelQuery]);
  for (const result of [behaviors, estimates, labels]) if (result.error) throw result.error;
  const estimateByBehavior = new Map(((estimates.data ?? []) as readonly EstimateRow[]).map((row) => [row.behavior_id, row]));
  const labelsByBehavior = new Map<string, EffectiveWhereLabel[]>();
  for (const row of (labels.data ?? []) as readonly LabelRow[]) {
    labelsByBehavior.set(row.behavior_id, [...(labelsByBehavior.get(row.behavior_id) ?? []), { label: row.label, localDate: row.local_date }]);
  }
  return new Map(((behaviors.data ?? []) as readonly BehaviorRow[]).map((row) => {
    const facts: BriefMoveBehaviorFacts = {
      id: row.id, title: row.title, description: row.description, timezone: row.timezone, defaultDurationMinutes: null,
      whereKind: row.where_kind, locationText: row.location_text, updatedAt: row.updated_at, alongside: row.alongside ?? null,
    };
    const estimate = currentEstimate(estimateByBehavior.get(row.id), facts, true);
    const setting = row.alongside ?? null;
    const guess = estimate?.alongside ?? null;
    const where = resolveEffectiveWhere({ whereKind: row.where_kind, locationText: row.location_text,
      labels: labelsByBehavior.get(row.id) ?? [], guess: estimate?.whereGuess ?? null, localDate: input.localDate });
    const whereGuess = row.where_kind === null && isWhereGuess(estimate?.whereGuess) ? estimate.whereGuess : null;
    return [row.id, {
      form: alongsideFormView({ setting, guess }),
      row: alongsideRowView(resolveAlongside({ setting, guess }), where),
      whereGuess,
      questionOpen: alongsideQuestionOpen({ alongside: setting }, guess),
    }] as const;
  }));
}

/** The Behavior form's view per Behavior, or null while the flag is off. */
export function alongsideFormViews(facts: ReadonlyMap<string, AlongsideBehaviorFacts> | null): Readonly<Record<string, AlongsideFormView>> | null {
  return facts ? Object.fromEntries([...facts].map(([id, value]) => [id, value.form])) : null;
}

/** The Timeline row facts for alongside Behaviors only. Empty while the flag is off. */
export function alongsideRowViews(facts: ReadonlyMap<string, AlongsideBehaviorFacts> | null): Readonly<Record<string, AlongsideRowView>> {
  return facts ? Object.fromEntries([...facts].flatMap(([id, value]) => value.row ? [[id, value.row] as const] : [])) : {};
}

/** Ticket 360: Behaviors whose alongside question is open. Empty while the flag is off. */
export function alongsideQuestionBehaviorIds(facts: ReadonlyMap<string, AlongsideBehaviorFacts> | null): ReadonlySet<string> {
  return new Set(facts ? [...facts].flatMap(([id, value]) => value.questionOpen ? [id] : []) : []);
}

/** Current Where guesses for Behaviors with Where Not set. Empty while the flag is off. */
export function alongsideWhereGuesses(facts: ReadonlyMap<string, AlongsideBehaviorFacts> | null): ReadonlyMap<string, WhereGuess> {
  return new Map(facts ? [...facts].flatMap(([id, value]) => value.whereGuess ? [[id, value.whereGuess] as const] : []) : []);
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
