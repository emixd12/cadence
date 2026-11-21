import { createHash } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import { effectiveEndAt, effectiveStartInstant, zonedInstant } from "@cadence/core/resolvers/time.resolver";
import { loggedAverageSeconds } from "@cadence/core/resolvers/move.resolver";
import { resolveBriefMoveLength, type BriefMoveDayItem } from "@cadence/core/resolvers/brief-move.resolver";
import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import { listOccurrencesBetweenLocalDates } from "@/lib/db/occurrences.repo";
import type { Occurrence } from "@/lib/types/database";

/**
 * Advisor Phase 3A1: the day as the one free-slot rule sees it. The Daily Brief's
 * lines, Re-plan, Other time, Yes and the Timeline's own "Move for today" all read the
 * day here, so every caller resolves the same lengths for the same items:
 * the Behavior's setting, the logged average (last 20 finished sessions, two or more),
 * the cached model estimate (only while its inputs are unchanged), then 30 minutes.
 */

const SESSION_SAMPLE = 20;

export type BriefMoveBehaviorFacts = Readonly<{
  id: string;
  title: string;
  description: string | null;
  timezone: string;
  defaultDurationMinutes: number | null;
  whereKind: string | null;
  updatedAt: string;
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
 */
export function behaviorEstimateInputHash(behavior: Pick<BriefMoveBehaviorFacts, "title" | "description" | "whereKind">): string {
  return createHash("sha256").update(JSON.stringify({
    v: 1, title: behavior.title.trim(), description: behavior.description?.trim() ?? "", where: behavior.whereKind ?? null,
  })).digest("hex");
}

export async function readBriefMoveDay(
  supabase: AppSupabaseClient,
  userId: string,
  localDate: string,
): Promise<BriefMoveDay> {
  const date = Temporal.PlainDate.from(localDate);
  const rows = await listOccurrencesBetweenLocalDates(supabase, userId,
    date.subtract({ days: 1 }).toString(), date.add({ days: 1 }).toString());
  const behaviorIds = [...new Set(rows.map((row) => row.behavior_id))];
  if (behaviorIds.length === 0) {
    return { items: [], behaviors: new Map(), occurrences: new Map(), neverMoveBehaviorIds: new Set(), staleEstimateBehaviorIds: new Set() };
  }
  const [behaviorRows, sessions, estimates, preferences] = await Promise.all([
    supabase.from("behaviors").select("id, title, description, timezone, default_duration_minutes, where_kind, updated_at, parent_behavior_id, inherit_parent_schedule, sub_behavior_sort_order")
      .eq("user_id", userId).in("id", behaviorIds),
    supabase.from("occurrence_time_sessions").select("behavior_id, started_at, stopped_at")
      .eq("user_id", userId).in("behavior_id", behaviorIds).not("stopped_at", "is", null)
      .order("started_at", { ascending: false }).limit(SESSION_SAMPLE * behaviorIds.length),
    supabase.from("behavior_advisor_estimates").select("behavior_id, input_hash, duration_minutes, alongside")
      .eq("user_id", userId).in("behavior_id", behaviorIds),
    supabase.from("behavior_move_preferences").select("behavior_id, never_suggest_move")
      .eq("user_id", userId).in("behavior_id", behaviorIds),
  ]);
  for (const result of [behaviorRows, sessions, estimates, preferences]) if (result.error) throw result.error;

  const parentIds = [...new Set((behaviorRows.data ?? []).flatMap((row) => row.parent_behavior_id ? [row.parent_behavior_id] : []))];
  const parents = parentIds.length
    ? await supabase.from("behaviors").select("id, title").eq("user_id", userId).in("id", parentIds)
    : { data: [] as { id: string; title: string }[], error: null };
  if (parents.error) throw parents.error;
  const parentTitles = new Map((parents.data ?? []).map((row) => [row.id, row.title]));
  const behaviors = new Map<string, BriefMoveBehaviorFacts>((behaviorRows.data ?? []).map((row) => [row.id, {
    id: row.id, title: row.title, description: row.description, timezone: row.timezone,
    defaultDurationMinutes: row.default_duration_minutes, whereKind: row.where_kind, updatedAt: row.updated_at,
    parentBehaviorId: row.parent_behavior_id ?? null, parentTitle: row.parent_behavior_id ? parentTitles.get(row.parent_behavior_id) ?? null : null,
    inheritParentSchedule: row.inherit_parent_schedule === true, subBehaviorSortOrder: row.sub_behavior_sort_order ?? 0,
  }]));
  const sessionsByBehavior = new Map<string, Array<{ started_at: string; stopped_at: string | null }>>();
  for (const session of sessions.data ?? []) {
    const list = sessionsByBehavior.get(session.behavior_id) ?? [];
    if (list.length < SESSION_SAMPLE) list.push(session);
    sessionsByBehavior.set(session.behavior_id, list);
  }
  const staleEstimateBehaviorIds = new Set<string>();
  const estimateByBehavior = new Map<string, Readonly<{ minutes: number | null; alongside: boolean }>>();
  for (const behavior of behaviors.values()) {
    const cached = (estimates.data ?? []).find((row) => row.behavior_id === behavior.id);
    if (cached && cached.input_hash === behaviorEstimateInputHash(behavior)) {
      estimateByBehavior.set(behavior.id, { minutes: cached.duration_minutes, alongside: cached.alongside });
    } else {
      staleEstimateBehaviorIds.add(behavior.id);
    }
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
    items.push(dayItem(row, behavior, length, estimate?.alongside ?? false));
  }
  return { items, behaviors, occurrences: new Map(rows.map((row) => [row.id, row])), neverMoveBehaviorIds, staleEstimateBehaviorIds };
}

function dayItem(row: Occurrence, behavior: BriefMoveBehaviorFacts, length: BriefMoveDayItem["length"], alongside: boolean): BriefMoveDayItem {
  const start = effectiveStartInstant(row);
  const moved = effectiveEndAt(row);
  const range = row.schedule_kind !== "exact";
  const end = moved ? Temporal.Instant.from(moved)
    : range && row.schedule_end_time ? zonedInstant(row.local_date, row.schedule_end_time.slice(0, 5), behavior.timezone)
      : start.add({ minutes: length.minutes });
  return {
    occurrenceId: row.id, behaviorId: row.behavior_id, title: behavior.title, status: row.status, localDate: row.local_date,
    scheduleKind: range ? "range" : "exact", start, end: Temporal.Instant.compare(end, start) > 0 ? end : start.add({ minutes: length.minutes }),
    length, alongside, revision: row.updated_at, behaviorRevision: behavior.updatedAt,
    ...(behavior.parentBehaviorId && behavior.parentTitle ? { routine: {
      parentBehaviorId: behavior.parentBehaviorId, parentTitle: behavior.parentTitle,
      inheritParentSchedule: behavior.inheritParentSchedule === true, stepOrder: behavior.subBehaviorSortOrder ?? 0,
    } } : {}),
  };
}
