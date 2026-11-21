import { effectiveStartAt } from "../resolvers/time.resolver";
import { Temporal } from "@js-temporal/polyfill";
import type { BehaviorGraphRecord } from "../behavior-store";
import type { OccurrenceRecord } from "../data-store";
import { resolveAnalytics } from "../resolvers/analytics.resolver";
import type { AnalyticsOccurrenceInput, AnalyticsTimeSessionInput, AnalyticsView } from "../types/analytics";
import type { OccurrenceStatus } from "../types/database";
import { DEFAULT_TIMEZONE } from "../types/recurrence";
import { formatOccurrenceScheduleLabel } from "./schedule";

export type AnalyticsSelection = {
  rangeDays?: number; selectedBehaviorId?: string | null; selectedDayLocalDate?: string | null;
};

export function assembleAnalyticsView(input: AnalyticsSelection & {
  behaviors: BehaviorGraphRecord[]; occurrences: OccurrenceRecord[]; needsDecisionOccurrences: OccurrenceRecord[];
  timeSessions: Array<Parameters<typeof toAnalyticsTimeSessionInput>[0]>; now: Temporal.Instant; timezone: string;
}): AnalyticsView {
  const { occurrences, needsDecisionOccurrences, timeSessions, now, timezone } = input;
  const options = input;
  const behaviorById = new Map(input.behaviors.map((behavior) => [behavior.id, behavior]));
  return resolveAnalytics({
    occurrences: occurrences
      .map((occurrence) => toAnalyticsOccurrenceInput(occurrence, behaviorById))
      .filter((occurrence): occurrence is AnalyticsOccurrenceInput =>
        Boolean(occurrence),
      ),
    needsDecisionOccurrences: needsDecisionOccurrences
      .map((occurrence) => toAnalyticsOccurrenceInput(occurrence, behaviorById))
      .filter((occurrence): occurrence is AnalyticsOccurrenceInput =>
        Boolean(occurrence),
      ),
    timeSessions: timeSessions.map(toAnalyticsTimeSessionInput),
    now,
    timezone,
    rangeDays: options.rangeDays,
    selectedBehaviorId: options.selectedBehaviorId,
    selectedDayLocalDate: options.selectedDayLocalDate,
  });
}

function toAnalyticsTimeSessionInput(
  session: {
    id: string;
    user_id: string;
    occurrence_id: string;
    behavior_id: string;
    started_at: string;
    stopped_at: string | null;
  },
): AnalyticsTimeSessionInput {
  return {
    id: session.id,
    userId: session.user_id,
    occurrenceId: session.occurrence_id,
    behaviorId: session.behavior_id,
    startedAt: session.started_at,
    stoppedAt: session.stopped_at,
  };
}

function toAnalyticsOccurrenceInput(
  occurrence: OccurrenceRecord,
  behaviorById: Map<string, BehaviorGraphRecord>,
): AnalyticsOccurrenceInput | null {
  const behavior = behaviorById.get(occurrence.behavior_id);

  if (!behavior) {
    return null;
  }

  return {
    id: occurrence.id,
    behaviorId: occurrence.behavior_id,
    behaviorTitle: behavior.title,
    behaviorActive: behavior.active,
    behaviorCreatedAt: behavior.created_at,
    categoryName: behavior.category?.name ?? "No category",
    scheduledFor: effectiveStartAt(occurrence),
    scheduledTimeLabel: formatOccurrenceScheduleLabel({
      scheduleKind: normalizeScheduleKind(occurrence.schedule_kind),
      schedulePreset: normalizeSchedulePreset(occurrence.schedule_preset),
      scheduleStartTime: occurrence.schedule_start_time,
      scheduleEndTime: occurrence.schedule_end_time,
    }),
    localDate: occurrence.local_date,
    status: normalizeOccurrenceStatus(occurrence.status),
    note: occurrence.note ?? "",
    timezone: behavior.timezone || DEFAULT_TIMEZONE,
    origin: occurrence.origin === "opportunity" ? "opportunity" : "scheduled",
  };
}

function normalizeScheduleKind(value: string): "exact" | "range" {
  if (value === "exact" || value === "range") {
    return value;
  }

  throw new Error(`Unsupported schedule kind: ${value}.`);
}

function normalizeSchedulePreset(
  value: string | null,
): "morning" | "afternoon" | "evening" | "night" | null {
  if (
    value === null ||
    value === "morning" ||
    value === "afternoon" ||
    value === "evening" ||
    value === "night"
  ) {
    return value;
  }

  throw new Error(`Unsupported schedule preset: ${value}.`);
}

function normalizeOccurrenceStatus(value: string): OccurrenceStatus {
  if (value === "unresolved" || value === "completed" || value === "not_completed") {
    return value;
  }

  throw new Error(`Unsupported occurrence status: ${value}.`);
}
