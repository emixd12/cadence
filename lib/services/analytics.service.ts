import { assembleAnalyticsView } from "@cadence/core/services/analytics";
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

  return assembleAnalyticsView({
    behaviors, occurrences, needsDecisionOccurrences, timeSessions, now, timezone,
    rangeDays: dateRange.rangeDays,
    selectedBehaviorId: options.selectedBehaviorId,
    selectedDayLocalDate: options.selectedDayLocalDate,
  });
}

async function requireUserId(supabase: AppSupabaseClient): Promise<string> {
  void supabase;

  return requireCurrentUserId("Sign in again before viewing analytics.");
}
