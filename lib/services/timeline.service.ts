import { Temporal } from "@js-temporal/polyfill";

import {
  type AppSupabaseClient,
  type BehaviorWithCategory,
} from "@/lib/db/behaviors.repo";
import {
  listOccurrencesBetweenLocalDates,
  listResolvedOccurrencesBeforeLocalDateMarkedBetween,
  listUnresolvedOccurrencesBeforeLocalDate,
} from "@/lib/db/occurrences.repo";
import {
  listTimeSessionsByOccurrenceIds,
  listTimeSessionHistory,
} from "@/lib/db/timeSessions.repo";
import { resolveGenerationWindow } from "@/lib/resolvers/occurrence.resolver";
import {
  TIMELINE_MAX_FUTURE_DAYS,
} from "@/lib/resolvers/timeline.resolver";
import { resolvePersistedTimeline } from "@cadence/core/services/timeline.service";
import { toTimeSession } from "@/lib/services/time-tracking.service";
import { createFirstRunOnboardingState } from "@/lib/services/onboarding.service";
import { ensureUserOccurrencesFresh } from "@/lib/services/occurrence.service";
import { reconcileMyDueBehaviorArchives } from "@/lib/services/behavior-lifecycle.service";
import { readOccurrenceSyncState } from "@/lib/services/occurrence-sync-state.service";
import { requireCurrentUserId } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import {
  readCachedBehaviorLogImportRuns,
  readCachedProfileTimezone,
  readCachedUserBehaviors,
} from "@/lib/cache/stable-user-data.cache";
import type { Occurrence } from "@/lib/types/database";
import type { FirstRunOnboardingState } from "@/lib/types/onboarding";
import type {
  TimelineView,
} from "@/lib/types/timeline";
import { DEFAULT_TIMEZONE } from "@/lib/types/recurrence";

export type GetTimelinePageDataOptions = {
  now?: Temporal.Instant;
  futureDays?: number;
};

export type TimelinePageBundle = {
  timeline: TimelineView;
  onboarding: FirstRunOnboardingState;
};

export async function getTimelinePageBundle(
  options: GetTimelinePageDataOptions = {},
): Promise<TimelinePageBundle> {
  const supabase = await createClient();
  const userId = await requireUserId(supabase);
  return getTimelinePageBundleForUser(supabase, userId, options);
}

export async function getTimelinePageBundleForUser(
  supabase: AppSupabaseClient,
  userId: string,
  options: GetTimelinePageDataOptions = {},
): Promise<TimelinePageBundle> {
  const now = options.now ?? Temporal.Now.instant();
  await reconcileMyDueBehaviorArchives(supabase, userId);
  const [profileTimezone, behaviors, importRuns, syncState] = await Promise.all([
    readCachedProfileTimezone(supabase, userId),
    readCachedUserBehaviors(supabase, userId),
    readCachedBehaviorLogImportRuns(supabase, userId, 1),
    readOccurrenceSyncState(supabase, userId),
  ]);
  const timeline = await getTimelineViewForUser({
    supabase,
    userId,
    now,
    futureDays: options.futureDays,
    profileTimezone,
    behaviors,
    syncState,
  });

  return {
    timeline,
    onboarding: createFirstRunOnboardingState({
      hasAnyBehavior: behaviors.length > 0,
      hasImportRuns: importRuns.length > 0,
      timezone: profileTimezone,
    }),
  };
}

export async function getTimelinePageData(
  options: GetTimelinePageDataOptions = {},
): Promise<TimelineView> {
  const supabase = await createClient();
  const userId = await requireUserId(supabase);
  return getTimelinePageDataForUser(supabase, userId, options);
}

export async function getTimelinePageDataForUser(
  supabase: AppSupabaseClient,
  userId: string,
  options: GetTimelinePageDataOptions = {},
): Promise<TimelineView> {
  const now = options.now ?? Temporal.Now.instant();
  await reconcileMyDueBehaviorArchives(supabase, userId);
  const [profileTimezone, behaviors, syncState] = await Promise.all([
    readCachedProfileTimezone(supabase, userId),
    readCachedUserBehaviors(supabase, userId),
    readOccurrenceSyncState(supabase, userId),
  ]);

  return getTimelineViewForUser({
    supabase,
    userId,
    now,
    futureDays: options.futureDays,
    profileTimezone,
    behaviors,
    syncState,
  });
}

async function getTimelineViewForUser(input: {
  supabase: AppSupabaseClient;
  userId: string;
  now: Temporal.Instant;
  futureDays?: number;
  profileTimezone: string | null;
  behaviors: BehaviorWithCategory[];
  syncState?: Awaited<ReturnType<typeof readOccurrenceSyncState>>;
}): Promise<TimelineView> {
  const { supabase, userId, now, behaviors } = input;
  const timezone = input.profileTimezone ?? DEFAULT_TIMEZONE;

  await ensureUserOccurrencesFresh(supabase, userId, {
    now,
    behaviors,
    timezone,
    horizonDays: TIMELINE_MAX_FUTURE_DAYS,
    syncState: input.syncState,
  });

  const timelineWindow = resolveGenerationWindow({
    now,
    timezone,
    horizonDays: TIMELINE_MAX_FUTURE_DAYS,
  });
  const retentionWindow = resolveLocalDayInstantWindow(
    timelineWindow.startLocalDate,
    timezone,
  );
  const [
    priorUnresolvedOccurrences,
    retainedPriorOccurrences,
    forwardOccurrences,
  ] = await Promise.all([
    listUnresolvedOccurrencesBeforeLocalDate(
      supabase,
      userId,
      timelineWindow.startLocalDate,
    ),
    listResolvedOccurrencesBeforeLocalDateMarkedBetween(supabase, {
      userId,
      localDate: timelineWindow.startLocalDate,
      statusMarkedFrom: retentionWindow.startInclusive,
      statusMarkedBefore: retentionWindow.endExclusive,
    }),
    listOccurrencesBetweenLocalDates(
      supabase,
      userId,
      timelineWindow.startLocalDate,
      timelineWindow.endLocalDate,
    ),
  ]);
  const occurrenceRows = [
    ...dedupeOccurrences([
      ...priorUnresolvedOccurrences,
      ...retainedPriorOccurrences,
    ]),
    ...forwardOccurrences,
  ];
  const timeSessions = await listTimeSessionsByOccurrenceIds(supabase, {
    userId,
    occurrenceIds: occurrenceRows.map((occurrence) => occurrence.id),
  });
  const historyEnd = Temporal.PlainDate.from(timelineWindow.startLocalDate).subtract({ days: 1 }).toString();
  const historyStart = Temporal.PlainDate.from(timelineWindow.startLocalDate).subtract({ days: 90 }).toString();
  const [historyOccurrences, historySessions] = await Promise.all([
    listOccurrencesBetweenLocalDates(supabase, userId, historyStart, historyEnd),
    listTimeSessionHistory(supabase, { userId, startLocalDate: historyStart, endLocalDate: historyEnd,
      includeArchived: false, throughStartedAt: now.toString() }),
  ]);
  return resolvePersistedTimeline({
    durationHistory: { occurrences: historyOccurrences, timeSessions: historySessions.map(toTimeSession) },
    behaviors,
    occurrences: occurrenceRows,
    timeSessions: timeSessions.map(toTimeSession),
    now, timezone, futureDays: input.futureDays,
  });
}

async function requireUserId(supabase: AppSupabaseClient): Promise<string> {
  void supabase;

  return requireCurrentUserId("Sign in again before viewing the timeline.");
}

function resolveLocalDayInstantWindow(
  localDate: string,
  timezone: string,
): { startInclusive: string; endExclusive: string } {
  const startDate = Temporal.PlainDate.from(localDate);
  const start = startDate.toZonedDateTime({
    timeZone: timezone,
    plainTime: Temporal.PlainTime.from("00:00"),
  });
  const end = start.add({ days: 1 });

  return {
    startInclusive: start.toInstant().toString(),
    endExclusive: end.toInstant().toString(),
  };
}

function dedupeOccurrences(occurrences: Occurrence[]): Occurrence[] {
  const occurrenceById = new Map<string, Occurrence>();

  for (const occurrence of occurrences) {
    occurrenceById.set(occurrence.id, occurrence);
  }

  return Array.from(occurrenceById.values());
}
