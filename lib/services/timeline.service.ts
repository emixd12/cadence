import { Temporal } from "@js-temporal/polyfill";
import { attachTimelineDayNotes, timelineDayNoteRange } from "@cadence/core/resolvers/day-note.resolver";
import { listDayNotesInRange } from "@/lib/db/dayNotes.repo";
import { attachTimelineSourceCountable, attachTimelineSourceEvidence, resolveTimelineSourceEvidence } from "@cadence/core/services/timeline-source-evidence";
import { readConnectorConnection } from "@/lib/db/connectors.repo";
import { listSourceLinks } from "@/lib/db/sourceLinks.repo";
import type { TimelineSourceEvidence } from "@cadence/core/types/timeline";
import { listOccurrenceStatusEventsByOccurrenceIds } from "@/lib/db/occurrenceStatusEvents.repo";
import { listSourceMatchesForOccurrences } from "@/lib/db/sourceMatches.repo";
import { connectorCompletionEnabled } from "@/lib/services/connector-completion.service";

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
import {
  createFirstRunOnboardingState,
  readFirstRunTravelSetup,
} from "@/lib/services/onboarding.service";
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
  const [profileTimezone, behaviors, importRuns, syncState, travel] = await Promise.all([
    readCachedProfileTimezone(supabase, userId),
    readCachedUserBehaviors(supabase, userId),
    readCachedBehaviorLogImportRuns(supabase, userId, 1),
    readOccurrenceSyncState(supabase, userId),
    readFirstRunTravelSetup(supabase, userId),
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
      travel,
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
  const view = resolvePersistedTimeline({
    durationHistory: { occurrences: historyOccurrences, timeSessions: historySessions.map(toTimeSession) },
    behaviors,
    occurrences: occurrenceRows,
    timeSessions: timeSessions.map(toTimeSession),
    now, timezone, futureDays: input.futureDays,
  });
  const dayNoteRange = timelineDayNoteRange(view);
  const withNotes = attachTimelineDayNotes(view, dayNoteRange ? await listDayNotesInRange(supabase, userId, dayNoteRange) : []);
  const [evidence, countable] = await Promise.all([
    readTimelineSourceEvidence(supabase, userId, occurrenceRows, timezone),
    readTimelineSourceCountable(supabase, userId, occurrenceRows, now, timezone),
  ]);
  return attachTimelineSourceCountable(attachTimelineSourceEvidence(withNotes, evidence), countable);
}

/**
 * Ticket 324: today's Unresolved rows that may count a Hevy workout by hand. Hevy must be
 * connected, the Behavior must have no enabled link, and no any-workout link may exist
 * (it would match every workout). Read only while the flag is on; a failed read offers
 * nothing.
 */
async function readTimelineSourceCountable(
  supabase: AppSupabaseClient,
  userId: string,
  occurrences: readonly Occurrence[],
  now: Temporal.Instant,
  timezone: string,
): Promise<Record<string, readonly string[]>> {
  if (!connectorCompletionEnabled()) return {};
  const today = now.toZonedDateTimeISO(timezone).toPlainDate().toString();
  const candidates = occurrences.filter((occurrence) => occurrence.status === "unresolved" && occurrence.local_date === today);
  if (candidates.length === 0) return {};
  try {
    const [connection, links] = await Promise.all([
      readConnectorConnection(supabase, userId, "hevy"),
      listSourceLinks(supabase, userId, "hevy"),
    ]);
    if (connection?.status !== "connected") return {};
    const enabled = links.filter((link) => link.enabled);
    if (enabled.some((link) => link.selector_kind === "any")) return {};
    const linked = new Set(enabled.map((link) => link.behavior_id));
    return Object.fromEntries(candidates.filter((occurrence) => !linked.has(occurrence.behavior_id))
      .map((occurrence) => [occurrence.id, ["hevy"]]));
  } catch {
    return {};
  }
}

/**
 * Tickets 317 and 322: connector labels and attached workout times for the rows in
 * view. Read only while `CADENCE_CONNECTOR_COMPLETION` is on, so the Timeline's reads
 * are unchanged while the feature is off. A failed read shows no labels.
 */
async function readTimelineSourceEvidence(
  supabase: AppSupabaseClient,
  userId: string,
  occurrences: readonly Occurrence[],
  timezone: string,
): Promise<Record<string, TimelineSourceEvidence>> {
  if (!connectorCompletionEnabled() || occurrences.length === 0) return {};
  try {
    const ids = occurrences.map((occurrence) => occurrence.id);
    const completedIds = occurrences.filter((occurrence) => occurrence.status === "completed").map((occurrence) => occurrence.id);
    const [matches, events] = await Promise.all([
      listSourceMatchesForOccurrences(supabase, userId, ids),
      completedIds.length ? listOccurrenceStatusEventsByOccurrenceIds(supabase, userId, completedIds) : Promise.resolve([]),
    ]);
    const latestEvents = new Map<string, { statusSemantics: string; sourceCaptureMethod: string; reasonCode: string | null; recordedAt: string; createdAt: string; id: string }>();
    for (const event of events) {
      const previous = latestEvents.get(event.occurrence_id);
      const candidate = { statusSemantics: event.status_semantics, sourceCaptureMethod: event.source_capture_method, reasonCode: event.reason_code,
        recordedAt: event.recorded_at, createdAt: event.created_at, id: event.id };
      if (!previous || compareLatest(candidate, previous) > 0) latestEvents.set(event.occurrence_id, candidate);
    }
    return resolveTimelineSourceEvidence({
      timezone,
      occurrences,
      latestEvents,
      matches: matches.map((match) => ({ occurrenceId: match.occurrence_id, source: match.source, state: match.state,
        activityStartAt: match.activity_start_at, activityEndAt: match.activity_end_at })),
    });
  } catch {
    return {};
  }
}

function compareLatest(left: { recordedAt: string; createdAt: string; id: string }, right: { recordedAt: string; createdAt: string; id: string }): number {
  return Date.parse(left.recordedAt) - Date.parse(right.recordedAt)
    || Date.parse(left.createdAt) - Date.parse(right.createdAt)
    || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
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
