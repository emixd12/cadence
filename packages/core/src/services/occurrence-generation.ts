import type { Temporal } from "@js-temporal/polyfill";
import type { BehaviorGraphRecord } from "../behavior-store";
import type { OccurrenceRecord } from "../data-store";
import {
  normalizeOccurrenceScheduleGraph, planOccurrenceGeneration,
  type ExistingOccurrenceForGeneration, type OccurrenceGenerationSchedule,
} from "../resolvers/occurrence.resolver";
import type { ScheduleKind, TimeRangePreset } from "../types/schedule";
import { normalizeOccurrenceStatus } from "./occurrence.service";
import { normalizeRecurrenceRule } from "./behavior-values";
import { compareScheduleSlots, normalizeTime, toScheduleSlotView } from "./schedule";

export function planPersistedOccurrences(input: {
  behavior: BehaviorGraphRecord;
  occurrences: OccurrenceRecord[];
  timeSessionOccurrenceIds: ReadonlySet<string>;
  now: Temporal.Instant;
  horizonDays?: number;
}) {
  const behavior = input.behavior;
  if (!behavior.current_configuration_event_id) {
    throw new Error("Behavior configuration history is unavailable for occurrence generation.");
  }
  const schedules = storedSchedulesForGeneration(behavior);
  return planOccurrenceGeneration({
    behavior: {
      id: behavior.id, userId: behavior.user_id,
      configurationEventId: behavior.current_configuration_event_id,
      recurrenceRule: normalizeRecurrenceRule(behavior.recurrence_rule),
      schedules, scheduleSlots: schedules.flatMap((schedule) => schedule.timeEntries),
      timezone: behavior.timezone, active: behavior.active, endDate: behavior.end_date,
      createdAt: behavior.created_at,
    },
    existingOccurrences: input.occurrences.map((row) =>
      toExistingOccurrenceForGeneration(row, input.timeSessionOccurrenceIds)),
    now: input.now, horizonDays: input.horizonDays,
  });
}

export function toExistingOccurrenceForGeneration(
  row: OccurrenceRecord, timeSessionOccurrenceIds: ReadonlySet<string>,
): ExistingOccurrenceForGeneration {
  return {
    id: row.id, scheduledFor: row.scheduled_for, localDate: row.local_date,
    status: normalizeOccurrenceStatus(row.status), scheduleSlotId: row.behavior_schedule_slot_id,
    scheduleKind: normalizeScheduleKind(row.schedule_kind), schedulePreset: normalizeSchedulePreset(row.schedule_preset),
    scheduleStartTime: normalizeTime(row.schedule_start_time),
    scheduleEndTime: row.schedule_end_time ? normalizeTime(row.schedule_end_time) : null,
    note: row.note, hasTimeSessions: timeSessionOccurrenceIds.has(row.id),
    behaviorConfigurationEventId: row.behavior_configuration_event_id,
    moved: Boolean(row.effective_start_at),
  };
}

export function storedSchedulesForGeneration(behavior: BehaviorGraphRecord): OccurrenceGenerationSchedule[] {
  const slots = (rows: BehaviorGraphRecord["schedule_slots"], scheduleId?: string) => rows
    .map((row) => toScheduleSlotView({
      id: row.id, scheduleId: row.behavior_schedule_id ?? scheduleId,
      kind: normalizeScheduleKind(row.kind), preset: normalizeSchedulePreset(row.preset),
      startTime: row.start_time, endTime: row.end_time, sortOrder: row.sort_order,
    }))
    .sort(compareScheduleSlots)
    .map(({ id, scheduleId, kind, preset, startTime, endTime, sortOrder }) =>
      ({ id, scheduleId, kind, preset, startTime, endTime, sortOrder }));
  const persisted = (behavior.schedules ?? []).map((schedule) => ({
    id: schedule.id, recurrenceRule: normalizeRecurrenceRule(schedule.recurrence_rule),
    timeEntries: slots(schedule.schedule_slots, schedule.id), sortOrder: schedule.sort_order,
  }));
  if (!behavior.active) return persisted;
  const normalization = normalizeOccurrenceScheduleGraph({
    schedules: persisted,
    compatibilitySchedule: {
      id: null, recurrenceRule: normalizeRecurrenceRule(behavior.recurrence_rule),
      timeEntries: slots(behavior.schedule_slots), sortOrder: 0,
    },
  });
  if (normalization.status !== "valid") {
    throw new Error("This behavior schedule needs repair before occurrences can be generated.");
  }
  return normalization.schedules;
}

export function normalizeScheduleKind(value: string): ScheduleKind {
  if (value === "exact" || value === "range") return value;
  throw new Error(`Unsupported schedule kind: ${value}.`);
}

export function normalizeSchedulePreset(value: string | null): TimeRangePreset | null {
  if (value === null || value === "morning" || value === "afternoon" || value === "evening" || value === "night") return value;
  throw new Error(`Unsupported schedule preset: ${value}.`);
}
