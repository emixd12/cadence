import { Temporal } from "@js-temporal/polyfill";

import type { OccurrenceStatus } from "../types/database";
import type {
  RecordedActivitySourceV1_1,
  RecordedActivityV1_1,
} from "../types/recorded-activity";

/**
 * Connector completion matching (Ticket 313, D28). Pure: callers inject `now`, the
 * source's minimum duration, links, Occurrences, evidence and prior matches. The
 * plan is applied by the database functions of Ticket 314, which recheck every
 * precondition. See `docs/plans/2026-11-10-connector-completion-architecture.md`,
 * section 3, "Matching rules (resolver)".
 */

/** Today and the 30 prior local dates (D28.6). */
export const CONNECTOR_COMPLETION_WINDOW_DAYS = 31;
/** On time: within this many minutes of an exact scheduled start. */
export const CONNECTOR_TIMING_ON_TIME_MINUTES = 30;

export type SourceLinkSelectorKind = "any" | "provider_keys";

export type ActivityMatchLink = Readonly<{
  id: string;
  behaviorId: string;
  source: RecordedActivitySourceV1_1;
  selectorKind: SourceLinkSelectorKind;
  selectorKeys: readonly string[];
  accountDigest: string;
  enabled: boolean;
}>;

export type ActivityMatchBehavior = Readonly<{
  id: string;
  timezone: string;
}>;

export type ActivityMatchOccurrence = Readonly<{
  id: string;
  behaviorId: string;
  localDate: string;
  scheduledStartAt: string;
  /** Null for an exact time. */
  scheduledEndAt: string | null;
  status: OccurrenceStatus;
  /** The Occurrence's latest status event, or null when it has none. */
  latestStatusEventId: string | null;
}>;

export type SourceMatchRole = "completion" | "attached";
export type SourceMatchState = "active" | "removed";

export type ActivityMatchRecord = Readonly<{
  id: string;
  occurrenceId: string;
  behaviorId: string;
  linkId: string;
  activityRef: string;
  activityStartAt: string;
  activityEndAt: string;
  activityRevision: string | null;
  role: SourceMatchRole;
  state: SourceMatchState;
  appliedEventId: string | null;
  revertedEventId: string | null;
}>;

export type ActivityMatchEvidence = Readonly<{
  activities: readonly RecordedActivityV1_1[];
  /**
   * A complete read covering `[coverageStartAt, coverageEndAt)`. Only a complete
   * read may remove a match for an absent activity.
   */
  complete: boolean;
  coverageStartAt: string;
  coverageEndAt: string;
  /** Activity refs the source reported as deleted. */
  deletedActivityRefs: readonly string[];
}>;

export type ResolveActivityMatchesInput = Readonly<{
  source: RecordedActivitySourceV1_1;
  /** The connected source's current account digest; links bound to another are fenced. */
  accountDigest: string;
  now: Temporal.Instant;
  minimumDurationSeconds: number;
  links: readonly ActivityMatchLink[];
  behaviors: readonly ActivityMatchBehavior[];
  occurrences: readonly ActivityMatchOccurrence[];
  evidence: ActivityMatchEvidence;
  matches: readonly ActivityMatchRecord[];
}>;

type MatchTarget = Readonly<{
  activityRef: string;
  activityStartAt: string;
  activityEndAt: string;
  activityRevision: string | null;
  behaviorId: string;
  linkId: string;
  occurrenceId: string;
  scheduledStartAt: string;
  scheduledEndAt: string | null;
}>;

export type ActivityMatchCompletePlan = MatchTarget & Readonly<{
  reason: "unresolved_occurrence";
  expectedLatestEventId: string | null;
}>;

export type ActivityMatchAttachPlan = MatchTarget & Readonly<{
  reason: "completed_occurrence" | "timing_refresh";
  /** Set for a timing refresh of an existing active match. */
  matchId: string | null;
}>;

export type ActivityMatchRemoveReason =
  | "absent_from_complete_read"
  | "deleted_at_source"
  | "moved_occurrence";

export type ActivityMatchRemovePlan = Readonly<{
  matchId: string;
  occurrenceId: string;
  behaviorId: string;
  reason: ActivityMatchRemoveReason;
  /** True when this removal should revert the connector's Completed status. */
  revertsStatus: boolean;
}>;

export type ActivityMatchSkipReason =
  | "no_link"
  | "ambiguous_links"
  | "no_occurrence"
  | "outside_window"
  | "below_minimum"
  | "not_completed"
  | "user_cleared_connector_completion"
  | "already_matched"
  | "pending_revert"
  | "unfinished_activity";

export type ActivityMatchSkip = Readonly<{
  activityRef: string;
  behaviorId: string | null;
  reason: ActivityMatchSkipReason;
}>;

export type ActivityMatchPlan = Readonly<{
  complete: ActivityMatchCompletePlan[];
  attach: ActivityMatchAttachPlan[];
  remove: ActivityMatchRemovePlan[];
  skip: ActivityMatchSkip[];
}>;

type OccurrenceState = {
  occurrence: ActivityMatchOccurrence;
  status: OccurrenceStatus;
  /** A completion match with no `revertedEventId`: a connector completion stands. */
  standingCompletion: ActivityMatchRecord | null;
  activeMatchIds: Set<string>;
  pendingRevert: boolean;
};

export function resolveActivityMatches(input: ResolveActivityMatchesInput): ActivityMatchPlan {
  const plan: ActivityMatchPlan = { complete: [], attach: [], remove: [], skip: [] };
  const behaviors = new Map(input.behaviors.map((behavior) => [behavior.id, behavior]));
  const occurrencesByBehaviorDate = new Map<string, ActivityMatchOccurrence[]>();
  const states = new Map<string, OccurrenceState>();
  for (const occurrence of input.occurrences) {
    const key = behaviorDateKey(occurrence.behaviorId, occurrence.localDate);
    occurrencesByBehaviorDate.set(key, [...(occurrencesByBehaviorDate.get(key) ?? []), occurrence]);
    states.set(occurrence.id, {
      occurrence,
      status: occurrence.status,
      standingCompletion: null,
      activeMatchIds: new Set(),
      pendingRevert: false,
    });
  }
  for (const match of input.matches) {
    const state = states.get(match.occurrenceId);
    if (!state) continue;
    if (match.state === "active") state.activeMatchIds.add(match.id);
    if (match.role === "completion" && match.revertedEventId === null) state.standingCompletion = match;
  }
  const matchesByActivityBehavior = new Map(
    input.matches.map((match) => [activityBehaviorKey(match.activityRef, match.behaviorId), match]),
  );
  const links = input.links.filter((link) => link.enabled && link.source === input.source
    && link.accountDigest === input.accountDigest && behaviors.has(link.behaviorId));
  const activities = new Map(input.evidence.activities.map((activity) => [activity.id, activity]));
  const deleted = new Set(input.evidence.deletedActivityRefs);
  const coverageStart = Temporal.Instant.from(input.evidence.coverageStartAt);
  const coverageEnd = Temporal.Instant.from(input.evidence.coverageEndAt);

  // Rule 8: plan removals first.
  const removed = new Set<string>();
  const removeMatch = (match: ActivityMatchRecord, reason: ActivityMatchRemoveReason) => {
    // History outside the 31-day range never changes: an Occurrence the caller did not
    // load (older than 30 days) keeps its matches.
    const state = states.get(match.occurrenceId);
    if (!state || removed.has(match.id)) return;
    removed.add(match.id);
    state.activeMatchIds.delete(match.id);
    const revertsStatus = state.activeMatchIds.size === 0
      && state.status === "completed"
      && state.standingCompletion !== null
      && state.standingCompletion.appliedEventId !== null
      && state.standingCompletion.appliedEventId === state.occurrence.latestStatusEventId;
    if (revertsStatus) state.pendingRevert = true;
    plan.remove.push({
      matchId: match.id,
      occurrenceId: match.occurrenceId,
      behaviorId: match.behaviorId,
      reason,
      revertsStatus,
    });
  };
  for (const match of [...input.matches].sort(compareMatches)) {
    if (match.state !== "active") continue;
    if (deleted.has(match.activityRef)) {
      removeMatch(match, "deleted_at_source");
      continue;
    }
    const start = Temporal.Instant.from(match.activityStartAt);
    const covered = Temporal.Instant.compare(start, coverageStart) >= 0
      && Temporal.Instant.compare(start, coverageEnd) < 0;
    if (input.evidence.complete && covered && !activities.has(match.activityRef)) {
      removeMatch(match, "absent_from_complete_read");
    }
  }

  // Rule 7: an edit that moves an activity to another Occurrence removes its match.
  const ordered = [...input.evidence.activities]
    .filter((activity) => !deleted.has(activity.id))
    .sort(compareActivities);
  for (const activity of ordered) {
    for (const behaviorId of new Set(links.map((link) => link.behaviorId))) {
      const existing = matchesByActivityBehavior.get(activityBehaviorKey(activity.id, behaviorId));
      if (!existing || existing.state !== "active" || removed.has(existing.id)) continue;
      const behavior = behaviors.get(behaviorId);
      const existingState = states.get(existing.occurrenceId);
      if (!behavior || !existingState) continue;
      const localDate = localDateOf(activity.startAt, behavior.timezone);
      const target = nearestOccurrence(occurrencesByBehaviorDate.get(behaviorDateKey(behaviorId, localDate)), activity.startAt);
      if (localDate !== existingState.occurrence.localDate || (target && target.id !== existing.occurrenceId)) {
        removeMatch(existing, "moved_occurrence");
      }
    }
  }

  for (const activity of ordered) {
    planActivity(activity);
  }
  return plan;

  function planActivity(activity: RecordedActivityV1_1): void {
    if (Temporal.Instant.compare(Temporal.Instant.from(activity.endAt), input.now) > 0) {
      plan.skip.push({ activityRef: activity.id, behaviorId: null, reason: "unfinished_activity" });
      return;
    }
    // Rule 1: each kind of link is evaluated on its own; two of one kind write nothing.
    const accepting = links.filter((link) => linkAccepts(link, activity));
    if (accepting.length === 0) {
      plan.skip.push({ activityRef: activity.id, behaviorId: null, reason: "no_link" });
      return;
    }
    for (const kind of ["provider_keys", "any"] as const) {
      const ofKind = accepting.filter((link) => link.selectorKind === kind);
      if (ofKind.length > 1) {
        for (const link of ofKind) {
          plan.skip.push({ activityRef: activity.id, behaviorId: link.behaviorId, reason: "ambiguous_links" });
        }
        continue;
      }
      if (ofKind.length === 1) planForLink(activity, ofKind[0]);
    }
  }

  function planForLink(activity: RecordedActivityV1_1, link: ActivityMatchLink): void {
    const behavior = behaviors.get(link.behaviorId)!;
    const skip = (reason: ActivityMatchSkipReason) =>
      plan.skip.push({ activityRef: activity.id, behaviorId: link.behaviorId, reason });
    const localDate = localDateOf(activity.startAt, behavior.timezone);
    const today = input.now.toZonedDateTimeISO(behavior.timezone).toPlainDate();
    const date = Temporal.PlainDate.from(localDate);
    if (Temporal.PlainDate.compare(date, today) > 0
      || Temporal.PlainDate.compare(date, today.subtract({ days: CONNECTOR_COMPLETION_WINDOW_DAYS - 1 })) < 0) {
      skip("outside_window");
      return;
    }
    // Rule 2: the Occurrence that day with the nearest scheduled start.
    const occurrence = nearestOccurrence(
      occurrencesByBehaviorDate.get(behaviorDateKey(link.behaviorId, localDate)),
      activity.startAt,
    );
    if (!occurrence) {
      skip("no_occurrence");
      return;
    }
    const target: MatchTarget = {
      activityRef: activity.id,
      activityStartAt: activity.startAt,
      activityEndAt: activity.endAt,
      activityRevision: activity.revision.providerUpdatedAt,
      behaviorId: link.behaviorId,
      linkId: link.id,
      occurrenceId: occurrence.id,
      scheduledStartAt: occurrence.scheduledStartAt,
      scheduledEndAt: occurrence.scheduledEndAt,
    };
    // Rule 4 and rule 7: one match per activity and Behavior, ever.
    const existing = matchesByActivityBehavior.get(activityBehaviorKey(activity.id, link.behaviorId));
    if (existing) {
      if (existing.state === "active" && !removed.has(existing.id) && existing.occurrenceId === occurrence.id
        && (existing.activityStartAt !== activity.startAt || existing.activityEndAt !== activity.endAt)
        && activity.duration.seconds >= input.minimumDurationSeconds) {
        plan.attach.push({ ...target, reason: "timing_refresh", matchId: existing.id });
        return;
      }
      skip("already_matched");
      return;
    }
    // Rule 3 and D28.8: the effect depends on status and the minimum duration.
    if (activity.duration.seconds < input.minimumDurationSeconds) {
      skip("below_minimum");
      return;
    }
    const state = states.get(occurrence.id)!;
    if (state.pendingRevert) {
      skip("pending_revert");
      return;
    }
    if (state.status === "not_completed") {
      skip("not_completed");
      return;
    }
    if (state.status === "completed") {
      plan.attach.push({ ...target, reason: "completed_occurrence", matchId: null });
      return;
    }
    if (state.standingCompletion !== null) {
      skip("user_cleared_connector_completion");
      return;
    }
    plan.complete.push({
      ...target,
      reason: "unresolved_occurrence",
      expectedLatestEventId: occurrence.latestStatusEventId,
    });
    // Later activities in this run see the planned completion.
    state.status = "completed";
    state.standingCompletion = {
      id: `planned:${activity.id}:${link.behaviorId}`,
      occurrenceId: occurrence.id,
      behaviorId: link.behaviorId,
      linkId: link.id,
      activityRef: activity.id,
      activityStartAt: activity.startAt,
      activityEndAt: activity.endAt,
      activityRevision: activity.revision.providerUpdatedAt,
      role: "completion",
      state: "active",
      appliedEventId: null,
      revertedEventId: null,
    };
  }
}

/** Selects whether a link's selector accepts an activity. */
export function linkAccepts(link: ActivityMatchLink, activity: RecordedActivityV1_1): boolean {
  if (link.selectorKind === "any") return true;
  const keys = activity.selectorKeys;
  if (!keys || keys.length === 0) return false;
  return link.selectorKeys.some((key) => keys.includes(key));
}

function nearestOccurrence(
  occurrences: readonly ActivityMatchOccurrence[] | undefined,
  activityStartAt: string,
): ActivityMatchOccurrence | null {
  if (!occurrences || occurrences.length === 0) return null;
  const start = Temporal.Instant.from(activityStartAt);
  const distance = (occurrence: ActivityMatchOccurrence) =>
    Math.abs(Temporal.Instant.from(occurrence.scheduledStartAt).since(start).total({ unit: "seconds" }));
  return [...occurrences].sort((left, right) =>
    distance(left) - distance(right)
    || Temporal.Instant.compare(Temporal.Instant.from(left.scheduledStartAt), Temporal.Instant.from(right.scheduledStartAt))
    || compareText(left.id, right.id))[0];
}

function localDateOf(instant: string, timezone: string): string {
  return Temporal.Instant.from(instant).toZonedDateTimeISO(timezone).toPlainDate().toString();
}

function compareActivities(left: RecordedActivityV1_1, right: RecordedActivityV1_1): number {
  return Temporal.Instant.compare(Temporal.Instant.from(left.startAt), Temporal.Instant.from(right.startAt))
    || compareText(left.id, right.id);
}

function compareMatches(left: ActivityMatchRecord, right: ActivityMatchRecord): number {
  return Temporal.Instant.compare(Temporal.Instant.from(left.activityStartAt), Temporal.Instant.from(right.activityStartAt))
    || compareText(left.id, right.id);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function behaviorDateKey(behaviorId: string, localDate: string): string {
  return `${behaviorId}\u0000${localDate}`;
}

function activityBehaviorKey(activityRef: string, behaviorId: string): string {
  return `${activityRef}\u0000${behaviorId}`;
}

export type ConnectorTiming = Readonly<{
  /** Activity start minus scheduled start, in whole minutes (rounded toward zero). */
  offsetMinutes: number;
  onTime: boolean;
}>;

/**
 * On time means within 30 minutes of an exact scheduled start, or a start inside
 * a scheduled range (inclusive of both ends).
 */
export function classifyConnectorTiming(input: Readonly<{
  scheduledStartAt: string;
  scheduledEndAt: string | null;
  activityStartAt: string;
}>): ConnectorTiming {
  const scheduledStart = Temporal.Instant.from(input.scheduledStartAt);
  const activityStart = Temporal.Instant.from(input.activityStartAt);
  const offsetMinutes = Math.trunc(activityStart.since(scheduledStart).total({ unit: "minutes" }));
  if (input.scheduledEndAt === null) {
    const absoluteMinutes = Math.abs(activityStart.since(scheduledStart).total({ unit: "minutes" }));
    return { offsetMinutes, onTime: absoluteMinutes <= CONNECTOR_TIMING_ON_TIME_MINUTES };
  }
  const scheduledEnd = Temporal.Instant.from(input.scheduledEndAt);
  return {
    offsetMinutes,
    onTime: Temporal.Instant.compare(activityStart, scheduledStart) >= 0
      && Temporal.Instant.compare(activityStart, scheduledEnd) <= 0,
  };
}

/** Rule 9: an Occurrence's timing comes from its active match nearest the scheduled start. */
export function selectTimingMatch<T extends Readonly<{
  state: SourceMatchState;
  activityStartAt: string;
  scheduledStartAt: string;
  activityRef: string;
}>>(matches: readonly T[]): T | null {
  const active = matches.filter((match) => match.state === "active");
  if (active.length === 0) return null;
  const distance = (match: T) => Math.abs(Temporal.Instant.from(match.activityStartAt)
    .since(Temporal.Instant.from(match.scheduledStartAt)).total({ unit: "seconds" }));
  return [...active].sort((left, right) => distance(left) - distance(right)
    || Temporal.Instant.compare(Temporal.Instant.from(left.activityStartAt), Temporal.Instant.from(right.activityStartAt))
    || compareText(left.activityRef, right.activityRef))[0];
}
