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
import { attachTimelineAlongside } from "@cadence/core/services/timeline-alongside";
import { alongsideQuestionBehaviorIds, alongsideRowViews, readAlongsideBehaviorFacts } from "@/lib/services/alongside-view.service";

import {
  listBehaviorAdvisorEstimates,
  readBehaviorRevisionById,
  setBehaviorDefaultLength,
  type AppSupabaseClient,
  type BehaviorWithCategory,
} from "@/lib/db/behaviors.repo";
import type { NoticeId } from "@cadence/core/notices";
import {
  listOccurrencesBetweenLocalDates,
  listOccurrencesByIds,
  listResolvedOccurrencesBeforeLocalDateMarkedBetween,
  listUnresolvedOccurrencesBeforeLocalDate,
} from "@/lib/db/occurrences.repo";
import { behaviorEstimateInputHash } from "@/lib/services/brief-move-day.service";
import {
  listTimeSessionsByOccurrenceIds,
  listTimeSessionHistory,
} from "@/lib/db/timeSessions.repo";
import { resolveGenerationWindow } from "@/lib/resolvers/occurrence.resolver";
import {
  TIMELINE_MAX_FUTURE_DAYS,
} from "@/lib/resolvers/timeline.resolver";
import { resolvePersistedTimeline, type OpportunityRemovalReadFacts } from "@cadence/core/services/timeline.service";
import { toTimeSession } from "@/lib/services/time-tracking.service";
import {
  createFirstRunOnboardingState,
  readFirstRunTravelSetup,
} from "@/lib/services/onboarding.service";
import { ensureUserOccurrencesFresh } from "@/lib/services/occurrence.service";
import { readOccurrenceSyncState } from "@/lib/services/occurrence-sync-state.service";
import { requireCurrentUserId } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import {
  invalidateBehaviorData,
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

export async function setBehaviorDefaultDurationForCurrentUser(
  behaviorId: string,
  minutes: number,
): Promise<Readonly<{ ok: true; minutes: number } | { ok: false; noticeId: NoticeId }>> {
  const supabase = await createClient();
  const userId = await requireCurrentUserId("Sign in again before updating duration.");
  const behavior = await readBehaviorRevisionById(supabase, userId, behaviorId);

  if (!behavior) {
    return { ok: false, noticeId: "timeline.duration-unavailable" };
  }

  const saved = await setBehaviorDefaultLength(supabase, {
    behaviorId,
    minutes,
    expectedRevision: behavior.updated_at,
  });

  if (!saved.ok) {
    return {
      ok: false,
      noticeId:
        saved.reason === "revision_changed"
          ? "timeline.duration-revision-changed"
          : "timeline.duration-save-failed",
    };
  }

  invalidateBehaviorData(userId);
  return { ok: true, minutes };
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
  const [historySessions, advisorEstimates, removalFacts] = await Promise.all([
    listTimeSessionHistory(supabase, { userId, startLocalDate: null, endLocalDate: historyEnd,
      includeArchived: false, throughStartedAt: now.toString() }),
    readValidBehaviorAdvisorEstimates(supabase, userId, behaviors),
    readOpportunityRemovalFacts(supabase, userId, occurrenceRows),
  ]);
  const historyOccurrences = await listOccurrencesByIds(
    supabase,
    userId,
    historySessions.map((session) => session.occurrence_id),
  );
  const view = resolvePersistedTimeline({
    removalFacts,
    durationHistory: { occurrences: historyOccurrences, timeSessions: historySessions.map(toTimeSession) },
    advisorEstimates,
    behaviors,
    occurrences: occurrenceRows,
    timeSessions: timeSessions.map(toTimeSession),
    now, timezone, futureDays: input.futureDays,
  });
  const dayNoteRange = timelineDayNoteRange(view);
  const withNotes = attachTimelineDayNotes(view, dayNoteRange ? await listDayNotesInRange(supabase, userId, dayNoteRange) : []);
  const [evidence, countable, alongside] = await Promise.all([
    readTimelineSourceEvidence(supabase, userId, occurrenceRows, timezone),
    readTimelineSourceCountable(supabase, userId, occurrenceRows, now, timezone),
    readTimelineAlongside(supabase, userId, occurrenceRows, now, timezone),
  ]);
  return attachTimelineAlongside(attachTimelineSourceCountable(attachTimelineSourceEvidence(withNotes, evidence), countable), alongside.rows, alongside.questions);
}

/**
 * Ticket 358 (D33): each alongside Behavior's row label and effective Where. Read only
 * while `CADENCE_ALONGSIDE` is on, so the Timeline's reads are unchanged while it is
 * off. A failed read shows no labels, asks nothing and keeps every overlap cue.
 */
async function readTimelineAlongside(
  supabase: AppSupabaseClient,
  userId: string,
  occurrences: readonly Occurrence[],
  now: Temporal.Instant,
  timezone: string,
): Promise<Readonly<{ rows: ReturnType<typeof alongsideRowViews>; questions: ReadonlySet<string> }>> {
  const none = { rows: {}, questions: new Set<string>() };
  if (occurrences.length === 0) return none;
  try {
    const facts = await readAlongsideBehaviorFacts(supabase, userId, {
      behaviorIds: occurrences.map((occurrence) => occurrence.behavior_id),
      localDate: now.toZonedDateTimeISO(timezone).toPlainDate().toString(),
    });
    // Ticket 360: the rows whose alongside question is open may ask after a Completed mark.
    return { rows: alongsideRowViews(facts), questions: alongsideQuestionBehaviorIds(facts) };
  } catch {
    return none;
  }
}

/**
 * Reads cached AI duration estimates (`behavior_advisor_estimates`) for Behaviors
 * whose title, description, and place still match the cached `input_hash`.
 */
export async function readValidBehaviorAdvisorEstimates(
  supabase: AppSupabaseClient,
  userId: string,
  behaviors: readonly Readonly<{
    id: string;
    title: string;
    description?: string | null;
    where_kind?: string | null;
    active?: boolean;
  }>[],
): Promise<Record<string, number>> {
  const eligible = behaviors.filter((behavior) => behavior.active !== false);
  if (eligible.length === 0) return {};
  const rows = await listBehaviorAdvisorEstimates(
    supabase,
    userId,
    eligible.map((behavior) => behavior.id),
  );
  if (rows.length === 0) return {};
  const hashByBehavior = new Map(
    eligible.map((behavior) => [
      behavior.id,
      behaviorEstimateInputHash({
        title: behavior.title,
        description: behavior.description ?? null,
        whereKind: behavior.where_kind ?? null,
      }),
    ]),
  );
  const estimates: Record<string, number> = {};
  for (const row of rows) {
    if (
      row.duration_minutes != null &&
      row.input_hash === hashByBehavior.get(row.behavior_id)
    ) {
      estimates[row.behavior_id] = row.duration_minutes;
    }
  }
  return estimates;
}

/**
 * Behaviors of Opportunity: status history and active source matches for the added
 * Unresolved rows, so Remove matches `remove_opportunity_occurrence`. Reads nothing when
 * no added row could be removed.
 */
async function readOpportunityRemovalFacts(
  supabase: AppSupabaseClient,
  userId: string,
  occurrences: readonly Occurrence[],
): Promise<OpportunityRemovalReadFacts> {
  const ids = occurrences
    .filter((occurrence) => occurrence.origin === "opportunity" && occurrence.status === "unresolved")
    .map((occurrence) => occurrence.id);
  if (ids.length === 0) {
    return { statusHistoryOccurrenceIds: new Set(), activeSourceMatchOccurrenceIds: new Set() };
  }
  const [events, matches] = await Promise.all([
    listOccurrenceStatusEventsByOccurrenceIds(supabase, userId, ids),
    listSourceMatchesForOccurrences(supabase, userId, ids),
  ]);
  return {
    statusHistoryOccurrenceIds: new Set(events.map((event) => event.occurrence_id)),
    activeSourceMatchOccurrenceIds: new Set(matches
      .filter((match) => match.state === "active").map((match) => match.occurrence_id)),
  };
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
    // A link on a parent covers its sub-behaviors.
    if (linked.size > 0) {
      const { data, error } = await supabase.from("behaviors").select("id").eq("user_id", userId)
        .in("parent_behavior_id", [...linked]);
      if (error) return {};
      for (const row of data ?? []) linked.add(row.id);
    }
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
