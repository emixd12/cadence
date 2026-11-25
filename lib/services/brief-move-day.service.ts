import { createHash } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import { effectiveEndAt, effectiveStartInstant, zonedInstant } from "@cadence/core/resolvers/time.resolver";
import { loggedAverageSeconds } from "@cadence/core/resolvers/move.resolver";
import { resolveBriefMoveLength, type BriefMoveDayItem } from "@cadence/core/resolvers/brief-move.resolver";
import { alongsideGuessWanted, resolveAlongside } from "@cadence/core/resolvers/alongside.resolver";
import { EFFECTIVE_WHERE_EVIDENCE_PERIOD_DAYS, resolveEffectiveWhere, type EffectiveWhere, type EffectiveWhereLabel } from "@cadence/core/resolvers/effective-where.resolver";
import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import { listOccurrencesBetweenLocalDates } from "@/lib/db/occurrences.repo";
import type { Occurrence } from "@/lib/types/database";
import { alongsideEnabled } from "@/lib/services/alongside-flag";

/**
 * Advisor Phase 3A1: the day as the one free-slot rule sees it. The Daily Brief's
 * lines, Re-plan, Other time, Yes and the Timeline's own "Move for today" all read the
 * day here, so every caller resolves the same lengths for the same items:
 * the Behavior's setting, the logged average (last 20 finished sessions, two or more),
 * the cached model estimate (only while its inputs are unchanged), then 30 minutes.
 * Each item's `alongside` comes from `resolveAlongside` (Ticket 356): with
 * `CADENCE_ALONGSIDE` on, the person's setting, then the cached guess, then false;
 * with it off, the cached guess, then false, and `behaviors.alongside` is not read.
 * With the flag on, each item also carries its effective Where (Ticket 357) for the
 * same-place overlap rule: the person's Where, counted completion place labels, the
 * cached guess, then unknown. With it off, no item has one, `location_text`,
 * `completion_place_labels` and `where_guess` are not read, and alongside items block
 * nothing, as before.
 */

const SESSION_SAMPLE = 20;

export type BriefMoveBehaviorFacts = Readonly<{
  id: string;
  title: string;
  description: string | null;
  timezone: string;
  defaultDurationMinutes: number | null;
  whereKind: string | null;
  /** Read only while `CADENCE_ALONGSIDE` is on, to key a place Where for planning. */
  locationText?: string | null;
  updatedAt: string;
  /**
   * The person's alongside answer (Ticket 356). Null: unanswered. Undefined while
   * `CADENCE_ALONGSIDE` is off, when the column is not read.
   */
  alongside?: boolean | null;
  /** Sub-behaviors (depth 1): the routine this step belongs to, with its title. */
  parentBehaviorId?: string | null;
  parentTitle?: string | null;
  inheritParentSchedule?: boolean;
  subBehaviorSortOrder?: number;
}>;

export type BriefMoveDay = Readonly<{
  /** Items from the day before to the day after (near-midnight moves see their neighbours). */
  items: readonly BriefMoveDayItem[];
  behaviors: ReadonlyMap<string, BriefMoveBehaviorFacts>;
  occurrences: ReadonlyMap<string, Occurrence>;
  /** Behaviors switched to "Don't suggest moving this". */
  neverMoveBehaviorIds: ReadonlySet<string>;
  /** Behaviors whose cached estimate is missing or out of date (the brief asks the model again). */
  staleEstimateBehaviorIds: ReadonlySet<string>;
}>;

/**
 * The inputs an estimate depends on. A different hash means the model is asked again;
 * the same hash reuses the cached length and "alongside" answer.
 *
 * `alongsideAsked: false` (Ticket 356) marks a length-only estimate, made while the
 * person's answer was set and the model was not asked about alongside. It hashes
 * differently, so its stored `alongside` is never read as a guess, and clearing the
 * answer makes the estimate stale and asks again.
 *
 * `whereAsked: true` (Ticket 359) marks an estimate from recipe 1.3, which also returned
 * the Where guess. Only `CADENCE_ALONGSIDE` on asks for it and reads it, so turning the
 * flag on asks each Behavior once more, and turning it off reads only recipe 1.2 rows.
 */
export function behaviorEstimateInputHash(
  behavior: Pick<BriefMoveBehaviorFacts, "title" | "description" | "whereKind">,
  options: Readonly<{ alongsideAsked?: boolean; whereAsked?: boolean }> = {},
): string {
  const inputs = { v: 1, title: behavior.title.trim(), description: behavior.description?.trim() ?? "", where: behavior.whereKind ?? null };
  const asked = options.alongsideAsked === false ? { ...inputs, alongside: "not_asked" } : inputs;
  return createHash("sha256").update(JSON.stringify(options.whereAsked === true ? { ...asked, whereGuess: "asked" } : asked)).digest("hex");
}

/** The cached estimate's guess when it is still current for `behavior`, null when current without a guess, undefined when stale. */
function currentEstimate(
  cached: Readonly<{ input_hash: string; duration_minutes: number | null; alongside: boolean; where_guess?: string | null }> | undefined,
  behavior: Pick<BriefMoveBehaviorFacts, "title" | "description" | "whereKind" | "alongside">,
  personSetting: boolean,
): Readonly<{ minutes: number | null; alongside: boolean | null; whereGuess: string | null }> | undefined {
  if (!cached) return undefined;
  // Flag off: recipe 1.2 rows only, and no Where guess is read.
  if (!personSetting) return cached.input_hash === behaviorEstimateInputHash(behavior) ? { minutes: cached.duration_minutes, alongside: cached.alongside, whereGuess: null } : undefined;
  // Flag on: recipe 1.3 rows only (Ticket 359), so every current row carries its Where guess.
  // A Behavior whose Where the person set was not given one.
  const whereGuess = behavior.whereKind ? null : cached.where_guess ?? null;
  if (cached.input_hash === behaviorEstimateInputHash(behavior, { whereAsked: true })) return { minutes: cached.duration_minutes, alongside: cached.alongside, whereGuess };
  if (!alongsideGuessWanted(behavior.alongside)
    && cached.input_hash === behaviorEstimateInputHash(behavior, { alongsideAsked: false, whereAsked: true })) {
    return { minutes: cached.duration_minutes, alongside: null, whereGuess };
  }
  return undefined;
}

export async function readBriefMoveDay(
  supabase: AppSupabaseClient,
  userId: string,
  localDate: string,
  options: Readonly<{ env?: Readonly<Record<string, string | undefined>> }> = {},
): Promise<BriefMoveDay> {
  const personSetting = alongsideEnabled(options.env);
  const date = Temporal.PlainDate.from(localDate);
  const rows = await listOccurrencesBetweenLocalDates(supabase, userId,
    date.subtract({ days: 1 }).toString(), date.add({ days: 1 }).toString());
  const behaviorIds = [...new Set(rows.map((row) => row.behavior_id))];
  if (behaviorIds.length === 0) {
    return { items: [], behaviors: new Map(), occurrences: new Map(), neverMoveBehaviorIds: new Set(), staleEstimateBehaviorIds: new Set() };
  }
  const [behaviorRows, sessions, estimates, preferences, labels] = await Promise.all([
    // The columns are read only while the flag is on, so the flag never runs ahead of the migrations.
    personSetting
      ? supabase.from("behaviors").select("id, title, description, timezone, default_duration_minutes, where_kind, location_text, updated_at, parent_behavior_id, inherit_parent_schedule, sub_behavior_sort_order, alongside")
        .eq("user_id", userId).in("id", behaviorIds)
      : supabase.from("behaviors").select("id, title, description, timezone, default_duration_minutes, where_kind, updated_at, parent_behavior_id, inherit_parent_schedule, sub_behavior_sort_order")
        .eq("user_id", userId).in("id", behaviorIds),
    supabase.from("occurrence_time_sessions").select("behavior_id, started_at, stopped_at")
      .eq("user_id", userId).in("behavior_id", behaviorIds).not("stopped_at", "is", null)
      .order("started_at", { ascending: false }).limit(SESSION_SAMPLE * behaviorIds.length),
    personSetting
      ? supabase.from("behavior_advisor_estimates").select("behavior_id, input_hash, duration_minutes, alongside, where_guess")
        .eq("user_id", userId).in("behavior_id", behaviorIds)
      : supabase.from("behavior_advisor_estimates").select("behavior_id, input_hash, duration_minutes, alongside")
        .eq("user_id", userId).in("behavior_id", behaviorIds),
    supabase.from("behavior_move_preferences").select("behavior_id, never_suggest_move")
      .eq("user_id", userId).in("behavior_id", behaviorIds),
    // Ticket 357: labels inside the evidence period, for the effective Where. Labels only, never positions.
    personSetting
      ? supabase.from("completion_place_labels").select("behavior_id, label, local_date")
        .eq("user_id", userId).in("behavior_id", behaviorIds)
        .gte("local_date", date.subtract({ days: EFFECTIVE_WHERE_EVIDENCE_PERIOD_DAYS - 1 }).toString()).lte("local_date", localDate)
      : Promise.resolve({ data: [] as LabelRow[], error: null }),
  ]);
  for (const result of [behaviorRows, sessions, estimates, preferences, labels]) if (result.error) throw result.error;

  const behaviorData: readonly BehaviorFactsRow[] = behaviorRows.data ?? [];
  const parentIds = [...new Set(behaviorData.flatMap((row) => row.parent_behavior_id ? [row.parent_behavior_id] : []))];
  const parents = parentIds.length
    ? await supabase.from("behaviors").select("id, title").eq("user_id", userId).in("id", parentIds)
    : { data: [] as { id: string; title: string }[], error: null };
  if (parents.error) throw parents.error;
  const parentTitles = new Map((parents.data ?? []).map((row) => [row.id, row.title]));
  const behaviors = new Map<string, BriefMoveBehaviorFacts>(behaviorData.map((row) => [row.id, {
    id: row.id, title: row.title, description: row.description, timezone: row.timezone,
    defaultDurationMinutes: row.default_duration_minutes, whereKind: row.where_kind, updatedAt: row.updated_at,
    parentBehaviorId: row.parent_behavior_id ?? null, parentTitle: row.parent_behavior_id ? parentTitles.get(row.parent_behavior_id) ?? null : null,
    inheritParentSchedule: row.inherit_parent_schedule === true, subBehaviorSortOrder: row.sub_behavior_sort_order ?? 0,
    ...(personSetting ? { alongside: row.alongside ?? null, locationText: row.location_text ?? null } : {}),
  }]));
  const labelsByBehavior = new Map<string, EffectiveWhereLabel[]>();
  for (const row of (labels.data ?? []) as readonly LabelRow[]) {
    labelsByBehavior.set(row.behavior_id, [...(labelsByBehavior.get(row.behavior_id) ?? []), { label: row.label, localDate: row.local_date }]);
  }
  const sessionsByBehavior = new Map<string, Array<{ started_at: string; stopped_at: string | null }>>();
  for (const session of sessions.data ?? []) {
    const list = sessionsByBehavior.get(session.behavior_id) ?? [];
    if (list.length < SESSION_SAMPLE) list.push(session);
    sessionsByBehavior.set(session.behavior_id, list);
  }
  const staleEstimateBehaviorIds = new Set<string>();
  const estimateByBehavior = new Map<string, Readonly<{ minutes: number | null; alongside: boolean | null; whereGuess: string | null }>>();
  for (const behavior of behaviors.values()) {
    const current = currentEstimate((estimates.data ?? []).find((row) => row.behavior_id === behavior.id), behavior, personSetting);
    if (current) estimateByBehavior.set(behavior.id, current);
    else staleEstimateBehaviorIds.add(behavior.id);
  }
  const neverMoveBehaviorIds = new Set((preferences.data ?? []).filter((row) => row.never_suggest_move).map((row) => row.behavior_id));

  const items: BriefMoveDayItem[] = [];
  for (const row of rows) {
    const behavior = behaviors.get(row.behavior_id);
    if (!behavior) continue;
    const estimate = estimateByBehavior.get(behavior.id);
    const length = resolveBriefMoveLength({
      behaviorDefaultMinutes: behavior.defaultDurationMinutes,
      loggedAverageSeconds: loggedAverageSeconds(sessionsByBehavior.get(behavior.id) ?? []),
      estimateMinutes: estimate?.minutes ?? null,
    });
    const alongside = resolveAlongside({ setting: personSetting ? behavior.alongside : null, guess: estimate?.alongside ?? null });
    const where = personSetting ? resolveEffectiveWhere({
      whereKind: behavior.whereKind, locationText: behavior.locationText ?? null,
      labels: labelsByBehavior.get(behavior.id) ?? [], guess: estimate?.whereGuess ?? null, localDate,
    }) : undefined;
    items.push({ ...dayItem(row, behavior, length, alongside), ...(where ? { where } : {}) });
  }
  return { items, behaviors, occurrences: new Map(rows.map((row) => [row.id, row])), neverMoveBehaviorIds, staleEstimateBehaviorIds };
}

type LabelRow = Readonly<{ behavior_id: string; label: string; local_date: string }>;

type BehaviorFactsRow = Readonly<{
  id: string; title: string; description: string | null; timezone: string; default_duration_minutes: number | null;
  where_kind: string | null; location_text?: string | null; updated_at: string; parent_behavior_id: string | null; inherit_parent_schedule: boolean;
  sub_behavior_sort_order: number; alongside?: boolean | null;
}>;

function dayItem(row: Occurrence, behavior: BriefMoveBehaviorFacts, length: BriefMoveDayItem["length"], alongside: ReturnType<typeof resolveAlongside>): BriefMoveDayItem {
  const start = effectiveStartInstant(row);
  const moved = effectiveEndAt(row);
  const range = row.schedule_kind !== "exact";
  const end = moved ? Temporal.Instant.from(moved)
    : range && row.schedule_end_time ? zonedInstant(row.local_date, row.schedule_end_time.slice(0, 5), behavior.timezone)
      : start.add({ minutes: length.minutes });
  return {
    occurrenceId: row.id, behaviorId: row.behavior_id, title: behavior.title, status: row.status, localDate: row.local_date,
    scheduleKind: range ? "range" : "exact", start, end: Temporal.Instant.compare(end, start) > 0 ? end : start.add({ minutes: length.minutes }),
    length, alongside: alongside.value, alongsideSource: alongside.source, revision: row.updated_at, behaviorRevision: behavior.updatedAt,
    ...(behavior.parentBehaviorId && behavior.parentTitle ? { routine: {
      parentBehaviorId: behavior.parentBehaviorId, parentTitle: behavior.parentTitle,
      inheritParentSchedule: behavior.inheritParentSchedule === true, stepOrder: behavior.subBehaviorSortOrder ?? 0,
    } } : {}),
  };
}

/**
 * Ticket 359: one Behavior's effective alongside value and effective Where, as every
 * advisor surface reads them (Chat, the day context and the coach). The same rules as
 * `readBriefMoveDay`: the person's answer, then the current cached guess, then false; the
 * person's Where, then counted completion place labels, then the current cached guess,
 * then unknown. Planning only: never passed to travel, departure, route or leave-reminder
 * code, and never sent to a model (a `place` Where's key stays server-side).
 */
export type BehaviorPlanningFacts = Readonly<{
  alongside: ReturnType<typeof resolveAlongside>;
  where: EffectiveWhere;
}>;

/**
 * Reads the planning facts for `behaviorIds`, counting labels for `localDate`. With
 * `CADENCE_ALONGSIDE` off it reads nothing and returns an empty map, so every caller's
 * output stays exactly as before.
 */
export async function readBehaviorPlanningFacts(
  supabase: AppSupabaseClient,
  userId: string,
  behaviorIds: readonly string[],
  localDate: string,
  options: Readonly<{ env?: Readonly<Record<string, string | undefined>> }> = {},
): Promise<ReadonlyMap<string, BehaviorPlanningFacts>> {
  const ids = [...new Set(behaviorIds)];
  if (!alongsideEnabled(options.env) || ids.length === 0) return new Map();
  const date = Temporal.PlainDate.from(localDate);
  const [behaviorRows, estimates, labels] = await Promise.all([
    supabase.from("behaviors").select("id, title, description, where_kind, location_text, alongside").eq("user_id", userId).in("id", ids),
    supabase.from("behavior_advisor_estimates").select("behavior_id, input_hash, duration_minutes, alongside, where_guess")
      .eq("user_id", userId).in("behavior_id", ids),
    supabase.from("completion_place_labels").select("behavior_id, label, local_date")
      .eq("user_id", userId).in("behavior_id", ids)
      .gte("local_date", date.subtract({ days: EFFECTIVE_WHERE_EVIDENCE_PERIOD_DAYS - 1 }).toString()).lte("local_date", localDate),
  ]);
  for (const result of [behaviorRows, estimates, labels]) if (result.error) throw result.error;
  const labelsByBehavior = new Map<string, EffectiveWhereLabel[]>();
  for (const row of (labels.data ?? []) as readonly LabelRow[]) {
    labelsByBehavior.set(row.behavior_id, [...(labelsByBehavior.get(row.behavior_id) ?? []), { label: row.label, localDate: row.local_date }]);
  }
  const facts = new Map<string, BehaviorPlanningFacts>();
  for (const row of (behaviorRows.data ?? []) as readonly PlanningBehaviorRow[]) {
    const behavior = { title: row.title, description: row.description, whereKind: row.where_kind, alongside: row.alongside ?? null };
    const estimate = currentEstimate((estimates.data ?? []).find((item) => item.behavior_id === row.id), behavior, true);
    facts.set(row.id, {
      alongside: resolveAlongside({ setting: behavior.alongside, guess: estimate?.alongside ?? null }),
      where: resolveEffectiveWhere({ whereKind: row.where_kind, locationText: row.location_text ?? null,
        labels: labelsByBehavior.get(row.id) ?? [], guess: estimate?.whereGuess ?? null, localDate }),
    });
  }
  return facts;
}

type PlanningBehaviorRow = Readonly<{
  id: string; title: string; description: string | null; where_kind: string | null; location_text: string | null; alongside: boolean | null;
}>;
