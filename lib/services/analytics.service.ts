import { assembleAnalyticsView } from "@cadence/core/services/analytics";
import { resolveConnectorTimingSummaries } from "@cadence/core/resolvers/analytics.resolver";
import type { AnalyticsConnectorTiming } from "@cadence/core/types/analytics";
import { listSourceMatchesForOccurrences } from "@/lib/db/sourceMatches.repo";
import { connectorCompletionEnabled } from "@/lib/services/connector-completion.service";
import { Temporal } from "@js-temporal/polyfill";

import type {
  AppSupabaseClient,
} from "@/lib/db/behaviors.repo";
import {
  listOccurrencesBetweenLocalDates,
  listUnresolvedOccurrencesBeforeLocalDate,
} from "@/lib/db/occurrences.repo";
import { listTimeSessionHistory } from "@/lib/db/timeSessions.repo";
import {
  resolveAnalyticsDateRange,
} from "@cadence/core/resolvers/analytics.resolver";
import { requireCurrentUserId } from "@/lib/auth/current-user";
import { ensureUserOccurrencesFresh } from "@/lib/services/occurrence.service";
import { reconcileMyDueBehaviorArchives } from "@/lib/services/behavior-lifecycle.service";
import { readOccurrenceSyncState } from "@/lib/services/occurrence-sync-state.service";
import { createClient } from "@/lib/supabase/server";
import {
  readCachedProfileTimezone,
  readCachedUserBehaviors,
} from "@/lib/cache/stable-user-data.cache";
import type {
  AnalyticsView,
} from "@/lib/types/analytics";
import { DEFAULT_TIMEZONE } from "@/lib/types/recurrence";

export type GetAnalyticsPageDataOptions = {
  now?: Temporal.Instant;
  rangeDays?: number;
  selectedBehaviorId?: string | null;
  selectedDayLocalDate?: string | null;
};

export async function getAnalyticsPageData(
  options: GetAnalyticsPageDataOptions = {},
): Promise<AnalyticsView> {
  const supabase = await createClient();
  const userId = await requireUserId(supabase);
  return getAnalyticsPageDataForUser(supabase, userId, options);
}

export async function getAnalyticsPageDataForUser(
  supabase: AppSupabaseClient,
  userId: string,
  options: GetAnalyticsPageDataOptions = {},
): Promise<AnalyticsView> {
  const now = options.now ?? Temporal.Now.instant();
  await reconcileMyDueBehaviorArchives(supabase, userId);
  const [profileTimezone, behaviors, syncState] = await Promise.all([
    readCachedProfileTimezone(supabase, userId),
    readCachedUserBehaviors(supabase, userId),
    readOccurrenceSyncState(supabase, userId),
  ]);
  const timezone = profileTimezone ?? DEFAULT_TIMEZONE;
  const dateRange = resolveAnalyticsDateRange({
    now,
    timezone,
    rangeDays: options.rangeDays,
  });

  await ensureUserOccurrencesFresh(supabase, userId, {
    now,
    behaviors,
    timezone,
    horizonDays: 0,
    syncState,
  });

  const [occurrences, needsDecisionOccurrences] = await Promise.all([
    listOccurrencesBetweenLocalDates(
      supabase,
      userId,
      dateRange.startLocalDate,
      dateRange.endLocalDate,
    ),
    listUnresolvedOccurrencesBeforeLocalDate(
      supabase,
      userId,
      dateRange.endLocalDate,
    ),
  ]);
  const timeSessions = await listTimeSessionHistory(supabase, {
    userId,
    startLocalDate: dateRange.startLocalDate,
    endLocalDate: dateRange.endLocalDate,
    includeArchived: true,
    throughStartedAt: now.toString(),
  });

  const view = assembleAnalyticsView({
    behaviors, occurrences, needsDecisionOccurrences, timeSessions, now, timezone,
    rangeDays: dateRange.rangeDays,
    selectedBehaviorId: options.selectedBehaviorId,
    selectedDayLocalDate: options.selectedDayLocalDate,
  });
  return attachConnectorTiming(view, await readConnectorTiming(supabase, userId, occurrences));
}

/**
 * Ticket 318: timing statistics for linked Behaviors from source matches. Read only
 * while `CADENCE_CONNECTOR_COMPLETION` is on. A failed read shows no timing.
 */
async function readConnectorTiming(
  supabase: AppSupabaseClient,
  userId: string,
  occurrences: readonly { id: string; behavior_id: string; status: string }[],
): Promise<Map<string, AnalyticsConnectorTiming>> {
  if (!connectorCompletionEnabled()) return new Map();
  const completed = occurrences.filter((occurrence) => occurrence.status === "completed");
  if (completed.length === 0) return new Map();
  try {
    const matches = await listSourceMatchesForOccurrences(supabase, userId, completed.map((occurrence) => occurrence.id));
    return resolveConnectorTimingSummaries({
      occurrences: completed.map((occurrence) => ({ id: occurrence.id, behaviorId: occurrence.behavior_id, status: occurrence.status })),
      matches: matches.map((match) => ({ occurrenceId: match.occurrence_id, state: match.state, activityRef: match.activity_ref,
        activityStartAt: match.activity_start_at, scheduledStartAt: match.scheduled_start_at, scheduledEndAt: match.scheduled_end_at })),
    });
  } catch {
    return new Map();
  }
}

function attachConnectorTiming(view: AnalyticsView, timing: Map<string, AnalyticsConnectorTiming>): AnalyticsView {
  if (timing.size === 0) return view;
  return { ...view, behaviorSummaries: view.behaviorSummaries.map((summary) =>
    timing.has(summary.behaviorId) ? { ...summary, connectorTiming: timing.get(summary.behaviorId)! } : summary) };
}

async function requireUserId(supabase: AppSupabaseClient): Promise<string> {
  void supabase;

  return requireCurrentUserId("Sign in again before viewing analytics.");
}
