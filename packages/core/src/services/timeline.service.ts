import { Temporal } from "@js-temporal/polyfill";
import { resolveBehaviorDurationEstimate } from "../resolvers/timeline-context.resolver";
import type { BehaviorDurationHistoryOccurrence } from "../types/day-progress";
import type { BehaviorGraphRecord } from "../behavior-store";
import type { OccurrenceRecord } from "../data-store";
import type { TimelineOccurrenceInput } from "../types/timeline";
import type { TimeSession } from "../types/time-tracking";
import { resolveTimeline, resolveTimelineOccurrence } from "../resolvers/timeline.resolver";
import { resolveOccurrenceTimeTracking } from "../resolvers/time-tracking.resolver";
import { normalizeScheduledTime, storedRecurrenceRuleOrNull, summarizeRecurrenceRule } from "./behavior-values";
import { resolveOpportunityPool } from "./opportunity-pool";
import { formatClockTimeLabel, formatCompactOccurrenceScheduleLabel } from "./schedule";
import { effectiveStartAt, isMoved } from "../resolvers/time.resolver";
import { normalizeScheduleKind, normalizeSchedulePreset } from "./occurrence-generation";
import { normalizeOccurrenceStatus } from "./occurrence.service";
import { storedBehaviorWhere } from "./behavior-where";
import { behaviorRunNotice, runFieldsFromStored } from "../resolvers/behavior-run.resolver";
import type { BehaviorRunNotice } from "../types/timeline";
import type { OpportunityAddedBy } from "../types/database";
import { selectLeafOccurrences } from "../resolvers/analytics.resolver";

export function resolvePersistedTimeline(input: {
  behaviors: BehaviorGraphRecord[];
  occurrences: OccurrenceRecord[];
  timeSessions: TimeSession[];
  now: Temporal.Instant;
  timezone: string;
  futureDays?: number;
  startLocalDate?: string;
  durationHistory?: { occurrences: OccurrenceRecord[]; timeSessions: TimeSession[] };
  /** Cached AI description duration estimates (minutes) keyed by behaviorId, valid for current inputs. */
  advisorEstimates?: Readonly<Record<string, number>>;
  /**
   * Behaviors of Opportunity: which added Occurrences have status history or an active
   * source match, for Remove. Without it, Remove stays hidden.
   */
  removalFacts?: OpportunityRemovalReadFacts;
}) {
  const activeBehaviorById = new Map(input.behaviors.filter((row) => row.active).map((row) => [row.id, row]));
  const sessionsByOccurrence = new Map<string, TimeSession[]>();
  for (const session of input.timeSessions) {
    const sessions = sessionsByOccurrence.get(session.occurrenceId) ?? [];
    sessions.push(session);
    sessionsByOccurrence.set(session.occurrenceId, sessions);
  }
  const behaviorById = new Map(input.behaviors.map((row) => [row.id, row]));
  // A parent's own kept Occurrence never shows on a day its sub-behaviors cover.
  const occurrences = selectLeafOccurrences(input.occurrences.map((row) => toTimelineOccurrenceInput(
    row, activeBehaviorById, sessionsByOccurrence.get(row.id) ?? [], input.removalFacts, behaviorById,
  )).filter((row): row is TimelineOccurrenceInput => row !== null));
  const timeline = resolveTimeline({ occurrences, now: input.now, timezone: input.timezone, futureDays: input.futureDays, startLocalDate: input.startLocalDate });
  if (
    input.durationHistory ||
    input.behaviors.some((behavior) => behavior.default_duration_minutes != null) ||
    (input.advisorEstimates && Object.keys(input.advisorEstimates).length > 0)
  ) {
    const history = durationHistoryFrom(input.durationHistory ?? { occurrences: [], timeSessions: [] });
    timeline.durationEstimates = Object.fromEntries([...activeBehaviorById.keys()].map((behaviorId) => [behaviorId,
      resolveBehaviorDurationEstimate({
        behaviorId,
        defaultDurationMinutes: activeBehaviorById.get(behaviorId)?.default_duration_minutes,
        descriptionEstimateMinutes: input.advisorEstimates?.[behaviorId] ?? null,
        occurrences: history,
        now: input.now,
        timezone: input.timezone,
      }),
    ]));
  }
  timeline.runNotices = resolveBehaviorRunNotices(input.behaviors, input.now);
  timeline.opportunityPool = resolveOpportunityPool({
    behaviors: input.behaviors, timeline, now: input.now, timezone: input.timezone,
  });
  return timeline;
}

/**
 * Duration history in the shape `resolveBehaviorDurationEstimate` reads: each
 * Occurrence with its own time sessions. The Timeline and every move caller build
 * their history here (Ticket 366), so both count the same samples.
 */
export function durationHistoryFrom(input: Readonly<{
  occurrences: readonly Pick<OccurrenceRecord, "id" | "behavior_id" | "local_date" | "status">[];
  timeSessions: readonly TimeSession[];
}>): BehaviorDurationHistoryOccurrence[] {
  const sessionsByOccurrence = new Map<string, TimeSession[]>();
  for (const session of input.timeSessions) {
    const group = sessionsByOccurrence.get(session.occurrenceId) ?? [];
    group.push(session);
    sessionsByOccurrence.set(session.occurrenceId, group);
  }
  return input.occurrences.map((row) => ({
    id: row.id, behaviorId: row.behavior_id, localDate: row.local_date,
    status: normalizeOccurrenceStatus(row.status), sessions: sessionsByOccurrence.get(row.id) ?? [],
  }));
}

export type OpportunityRemovalReadFacts = Readonly<{
  statusHistoryOccurrenceIds: ReadonlySet<string>;
  activeSourceMatchOccurrenceIds: ReadonlySet<string>;
}>;

/** Today's ended, paused and back-today notices, in title order (T7). */
export function resolveBehaviorRunNotices(behaviors: readonly BehaviorGraphRecord[], now: Temporal.Instant): BehaviorRunNotice[] {
  return behaviors.flatMap((behavior) => {
    const notice = behaviorRunNotice(runFieldsFromStored(behavior), now);
    return notice ? [{ behaviorId: behavior.id, title: behavior.title, kind: notice.kind, backOn: notice.backOn, updatedAt: behavior.updated_at }] : [];
  }).sort((left, right) => left.title.localeCompare(right.title) || left.behaviorId.localeCompare(right.behaviorId));
}

export function resolvePersistedTimelineOccurrence(input: {
  behavior: BehaviorGraphRecord;
  occurrence: OccurrenceRecord;
  timeSessions: TimeSession[];
  now: Temporal.Instant;
  timezone: string;
}) {
  const occurrence = toTimelineOccurrenceInput(
    input.occurrence,
    new Map([[input.behavior.id, input.behavior]]),
    input.timeSessions,
  );
  return occurrence ? resolveTimelineOccurrence({ occurrence, now: input.now, timezone: input.timezone }) : null;
}

function toTimelineOccurrenceInput(
  occurrence: OccurrenceRecord,
  activeBehaviorById: Map<string, BehaviorGraphRecord>,
  timeSessions: TimeSession[],
  removalFacts?: OpportunityRemovalReadFacts,
  behaviorById: Map<string, BehaviorGraphRecord> = activeBehaviorById,
): TimelineOccurrenceInput | null {
  const behavior = activeBehaviorById.get(occurrence.behavior_id);

  if (!behavior) {
    return null;
  }

  const recurrenceRule = storedRecurrenceRuleOrNull(behavior);
  const origin = occurrence.origin === "opportunity" ? "opportunity" : "scheduled";
  const tracking = resolveOccurrenceTimeTracking(timeSessions);

  return {
    id: occurrence.id,
    behaviorId: occurrence.behavior_id,
    title: behavior.title,
    description: behavior.description ?? "",
    categoryName: behavior.category?.name ?? "No category",
    scheduleSummary: recurrenceRule ? summarizeRecurrenceRule(recurrenceRule) : "",
    ...occurrenceTimeLabels(occurrence, behavior.timezone),
    revision: occurrence.updated_at,
    scheduleKind: normalizeScheduleKind(occurrence.schedule_kind),
    scheduleEndTime: occurrence.schedule_end_time ? normalizeScheduledTime(occurrence.schedule_end_time) : null,
    ...behaviorPlaceText(behavior),
    localDate: occurrence.local_date,
    status: normalizeOccurrenceStatus(occurrence.status),
    statusMarkedAt: occurrence.status_marked_at,
    note: occurrence.note ?? "",
    timeTracking: {
      recordedSeconds: tracking.recordedSeconds,
      runningStartedAt: tracking.runningSession?.startedAt ?? null,
    },
    canStartTimeTracking: behavior.active,
    origin,
    addedBy: origin === "opportunity" ? toAddedBy(occurrence.added_by) : null,
    hasTimeSessions: timeSessions.length > 0,
    ...(removalFacts ? {
      hasStatusHistory: removalFacts.statusHistoryOccurrenceIds.has(occurrence.id),
      hasActiveSourceMatch: removalFacts.activeSourceMatchOccurrenceIds.has(occurrence.id),
    } : {}),
    ...subBehaviorTimelineFields(behavior, behaviorById),
  };
}

function subBehaviorTimelineFields(behavior: BehaviorGraphRecord, behaviorById: Map<string, BehaviorGraphRecord>) {
  const parentId = behavior.parent_behavior_id ?? null;
  const parent = parentId ? behaviorById.get(parentId) : undefined;
  if (!parentId || !parent) return {};
  return {
    parentBehaviorId: parentId,
    parentTitle: parent.title,
    subBehaviorSortOrder: behavior.sub_behavior_sort_order ?? 0,
  };
}

function toAddedBy(value: string | null | undefined): OpportunityAddedBy | null {
  return value === "user" || value === "daily_brief" || value === "chat" || value === "mcp" ? value : null;
}

/**
 * Advisor plan, Phase 2: the row sits at its effective time. A moved row shows its new
 * time and keeps the planned label as "Moved from". Range Behaviors are not moved in v1.
 */
function occurrenceTimeLabels(occurrence: OccurrenceRecord, timezone: string) {
  const planned = formatCompactOccurrenceScheduleLabel({
    scheduleKind: normalizeScheduleKind(occurrence.schedule_kind),
    schedulePreset: normalizeSchedulePreset(occurrence.schedule_preset),
    scheduleStartTime: normalizeScheduledTime(occurrence.schedule_start_time),
    scheduleEndTime: occurrence.schedule_end_time
      ? normalizeScheduledTime(occurrence.schedule_end_time)
      : null,
  });
  const start = effectiveStartAt(occurrence);
  const time: { scheduledFor: string; scheduledTimeLabel: string; movedFromLabel?: string } = { scheduledFor: start, scheduledTimeLabel: planned };
  if (!isMoved(occurrence)) return time;
  const wall = Temporal.Instant.from(start).toZonedDateTimeISO(timezone).toPlainTime().toString({ smallestUnit: "minute" });
  return { ...time, scheduledTimeLabel: formatClockTimeLabel(wall), movedFromLabel: planned };
}

/**
 * Ticket 271: A place's text for the row's Directions link. Also the Where kind when it is Home
 * or A place, for the travel source key. An unreadable Where gives neither.
 */
function behaviorPlaceText(behavior: BehaviorGraphRecord): { placeText?: string; whereKind?: "home" | "place" } {
  try {
    const where = storedBehaviorWhere(behavior);
    if (where.where_kind === "home") return { whereKind: "home" };
    return where.where_kind === "place" && where.location_text ? { placeText: where.location_text, whereKind: "place" } : {};
  } catch {
    return {};
  }
}
