import type { Temporal } from "@js-temporal/polyfill";
import { resolveBehaviorDurationEstimate } from "../resolvers/timeline-context.resolver";
import type { BehaviorDurationHistoryOccurrence } from "../types/day-progress";
import type { BehaviorGraphRecord } from "../behavior-store";
import type { OccurrenceRecord } from "../data-store";
import type { TimelineOccurrenceInput } from "../types/timeline";
import type { TimeSession } from "../types/time-tracking";
import { resolveTimeline, resolveTimelineOccurrence } from "../resolvers/timeline.resolver";
import { resolveOccurrenceTimeTracking } from "../resolvers/time-tracking.resolver";
import { normalizeRecurrenceRule, normalizeScheduledTime, summarizeRecurrenceRule } from "./behavior-values";
import { formatCompactOccurrenceScheduleLabel } from "./schedule";
import { normalizeScheduleKind, normalizeSchedulePreset } from "./occurrence-generation";
import { normalizeOccurrenceStatus } from "./occurrence.service";

export function resolvePersistedTimeline(input: {
  behaviors: BehaviorGraphRecord[];
  occurrences: OccurrenceRecord[];
  timeSessions: TimeSession[];
  now: Temporal.Instant;
  timezone: string;
  futureDays?: number;
  startLocalDate?: string;
  durationHistory?: { occurrences: OccurrenceRecord[]; timeSessions: TimeSession[] };
}) {
  const activeBehaviorById = new Map(input.behaviors.filter((row) => row.active).map((row) => [row.id, row]));
  const sessionsByOccurrence = new Map<string, TimeSession[]>();
  for (const session of input.timeSessions) {
    const sessions = sessionsByOccurrence.get(session.occurrenceId) ?? [];
    sessions.push(session);
    sessionsByOccurrence.set(session.occurrenceId, sessions);
  }
  const occurrences = input.occurrences.map((row) => toTimelineOccurrenceInput(
    row, activeBehaviorById, sessionsByOccurrence.get(row.id) ?? [],
  )).filter((row): row is TimelineOccurrenceInput => row !== null);
  const timeline = resolveTimeline({ occurrences, now: input.now, timezone: input.timezone, futureDays: input.futureDays, startLocalDate: input.startLocalDate });
  if (input.durationHistory || input.behaviors.some((behavior) => behavior.default_duration_minutes != null)) {
    const historySessions = new Map<string, TimeSession[]>();
    for (const session of (input.durationHistory?.timeSessions ?? [])) {
      const group = historySessions.get(session.occurrenceId) ?? [];
      group.push(session);
      historySessions.set(session.occurrenceId, group);
    }
    const history: BehaviorDurationHistoryOccurrence[] = (input.durationHistory?.occurrences ?? []).map((row) => ({
      id: row.id, behaviorId: row.behavior_id, localDate: row.local_date,
      status: normalizeOccurrenceStatus(row.status), sessions: historySessions.get(row.id) ?? [],
    }));
    timeline.durationEstimates = Object.fromEntries([...activeBehaviorById.keys()].map((behaviorId) => [behaviorId,
      resolveBehaviorDurationEstimate({ behaviorId, defaultDurationMinutes: activeBehaviorById.get(behaviorId)?.default_duration_minutes, occurrences: history, now: input.now, timezone: input.timezone }),
    ]));
  }
  timeline.archiveNotifications = input.behaviors.filter((behavior) => !behavior.active && behavior.auto_archived_at)
    .map((behavior) => ({ behaviorId: behavior.id, title: behavior.title, endDate: behavior.end_date ?? null }));
  return timeline;
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
): TimelineOccurrenceInput | null {
  const behavior = activeBehaviorById.get(occurrence.behavior_id);

  if (!behavior) {
    return null;
  }

  const recurrenceRule = normalizeRecurrenceRule(behavior.recurrence_rule);
  const tracking = resolveOccurrenceTimeTracking(timeSessions);

  return {
    id: occurrence.id,
    behaviorId: occurrence.behavior_id,
    title: behavior.title,
    description: behavior.description ?? "",
    categoryName: behavior.category?.name ?? "No category",
    scheduleSummary: summarizeRecurrenceRule(recurrenceRule),
    scheduledFor: occurrence.scheduled_for,
    scheduledTimeLabel: formatCompactOccurrenceScheduleLabel({
      scheduleKind: normalizeScheduleKind(occurrence.schedule_kind),
      schedulePreset: normalizeSchedulePreset(occurrence.schedule_preset),
      scheduleStartTime: normalizeScheduledTime(occurrence.schedule_start_time),
      scheduleEndTime: occurrence.schedule_end_time
        ? normalizeScheduledTime(occurrence.schedule_end_time)
        : null,
    }),
    localDate: occurrence.local_date,
    status: normalizeOccurrenceStatus(occurrence.status),
    statusMarkedAt: occurrence.status_marked_at,
    note: occurrence.note ?? "",
    timeTracking: {
      recordedSeconds: tracking.recordedSeconds,
      runningStartedAt: tracking.runningSession?.startedAt ?? null,
    },
    canStartTimeTracking: behavior.active,
  };
}
