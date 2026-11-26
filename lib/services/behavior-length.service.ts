import { Temporal } from "@js-temporal/polyfill";
import { resolveBehaviorDurationEstimate } from "@cadence/core/resolvers/timeline-context.resolver";
import { durationHistoryFrom } from "@cadence/core/services/timeline.service";
import type { BehaviorDurationEstimate, BehaviorDurationHistoryOccurrence } from "@cadence/core/types/day-progress";
import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import { listOccurrencesByIds } from "@/lib/db/occurrences.repo";
import { listTimeSessionHistory } from "@/lib/db/timeSessions.repo";
import { toTimeSession } from "@/lib/services/time-tracking.service";
import { DEFAULT_TIMEZONE } from "@/lib/types/recurrence";

/**
 * Ticket 366: one measurement of how long a Behavior takes, for every caller.
 *
 * A sample is one Completed Occurrence before today with its time sessions added
 * together. The Timeline reads the same history (`lib/services/timeline.service.ts`),
 * and both hand it to `resolveBehaviorDurationEstimate`, which holds the length order.
 * Moves, the Daily Brief's Opportunity pool and Chat moves read lengths here, so a
 * move never plans with a different figure from the one the Timeline shows.
 */
export async function readDurationHistory(supabase: AppSupabaseClient, input: Readonly<{
  userId: string;
  now: Temporal.Instant;
  timezone: string;
}>): Promise<BehaviorDurationHistoryOccurrence[]> {
  const today = input.now.toZonedDateTimeISO(input.timezone).toPlainDate();
  const sessions = await listTimeSessionHistory(supabase, {
    userId: input.userId, startLocalDate: null, endLocalDate: today.subtract({ days: 1 }).toString(),
    includeArchived: false, throughStartedAt: input.now.toString(),
  });
  const occurrences = await listOccurrencesByIds(supabase, input.userId, sessions.map((session) => session.occurrence_id));
  return durationHistoryFrom({ occurrences, timeSessions: sessions.map(toTimeSession) });
}

/** The account's timezone, as the Timeline uses it for "today". */
export async function readAccountTimezone(supabase: AppSupabaseClient, userId: string): Promise<string> {
  const { data, error } = await supabase.from("profiles").select("timezone").eq("id", userId).maybeSingle();
  if (error) throw error;
  return data?.timezone || DEFAULT_TIMEZONE;
}

export type BehaviorLengthInput = Readonly<{
  id: string;
  defaultDurationMinutes: number | null;
  /** A cached model estimate, used only when nothing is tracked or set. */
  estimateMinutes?: number | null;
}>;

/** The planning length of each Behavior, by the shared order. */
export async function readBehaviorLengths(supabase: AppSupabaseClient, input: Readonly<{
  userId: string;
  behaviors: readonly BehaviorLengthInput[];
  now?: Temporal.Instant;
}>): Promise<Map<string, BehaviorDurationEstimate>> {
  if (input.behaviors.length === 0) return new Map();
  const now = input.now ?? Temporal.Now.instant();
  const timezone = await readAccountTimezone(supabase, input.userId);
  const history = await readDurationHistory(supabase, { userId: input.userId, now, timezone });
  const byBehavior = new Map<string, BehaviorDurationHistoryOccurrence[]>();
  for (const occurrence of history) {
    const list = byBehavior.get(occurrence.behaviorId) ?? [];
    list.push(occurrence);
    byBehavior.set(occurrence.behaviorId, list);
  }
  return new Map(input.behaviors.map((behavior) => [behavior.id, resolveBehaviorDurationEstimate({
    behaviorId: behavior.id,
    defaultDurationMinutes: behavior.defaultDurationMinutes,
    descriptionEstimateMinutes: behavior.estimateMinutes ?? null,
    occurrences: byBehavior.get(behavior.id) ?? [],
    now,
    timezone,
  })]));
}
