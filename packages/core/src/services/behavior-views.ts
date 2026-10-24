import type { BehaviorGraphRecord, BehaviorScheduleRecord } from "../behavior-store";
import type { BehaviorPageData, BehaviorView, CategoryOption } from "../types/behavior";
import type { BehaviorScheduleView, ScheduleKind, TimeRangePreset } from "../types/schedule";
import { DEFAULT_TIMEZONE } from "../types/recurrence";
import { parseArchiveNotes } from "../resolvers/archive-note.resolver";
import { formatScheduledTimeLabel, normalizeRecurrenceRule, normalizeScheduledTime,
  recurrenceDefaultsFromRule, summarizeRecurrenceRule, summarizeReminders } from "./behavior-values";
import { compareScheduleSlots, formatScheduleSlotsSummary, toScheduleSlotView } from "./schedule";
import { storedBehaviorWhere } from "./behavior-where";

export function assembleBehaviorPageData(input: {
  behaviors: BehaviorGraphRecord[]; categories: CategoryOption[]; profileTimezone: string | null;
}): BehaviorPageData {
  const behaviorViews = input.behaviors.map(toBehaviorView);
  return {
    categories: input.categories.map(toCategoryOption),
    activeBehaviors: behaviorViews.filter((behavior) => behavior.active),
    archivedBehaviors: behaviorViews.filter((behavior) => !behavior.active),
    defaultTimezone: input.profileTimezone ?? DEFAULT_TIMEZONE,
  };
}

export function toBehaviorView(behavior: BehaviorGraphRecord): BehaviorView {
  const recurrenceRule = normalizeRecurrenceRule(behavior.recurrence_rule);
  const scheduledTime = normalizeScheduledTime(behavior.scheduled_time);
  const scheduledTimeLabel = formatScheduledTimeLabel(scheduledTime);
  const schedules = toBehaviorScheduleViews(behavior, recurrenceRule, scheduledTime);
  const scheduleSlots = schedules.flatMap((schedule) => schedule.timeEntries);

  return {
    id: behavior.id,
    defaultDurationMinutes: behavior.default_duration_minutes ?? null,
    endDate: behavior.end_date ?? null,
    autoArchivedAt: behavior.auto_archived_at ?? null,
    title: behavior.title,
    description: behavior.description ?? "",
    whereKind: storedBehaviorWhere(behavior).where_kind,
    locationText: storedBehaviorWhere(behavior).location_text,
    categoryId: behavior.category_id ?? "",
    categoryName: behavior.category?.name ?? "No category",
    recurrenceSummary:
      schedules.length === 1
        ? schedules[0]?.recurrenceSummary ?? summarizeRecurrenceRule(recurrenceRule)
        : `${schedules.length} schedules`,
    recurrenceDefaults: recurrenceDefaultsFromRule(recurrenceRule),
    scheduledTime,
    scheduledTimeLabel,
    schedules,
    scheduleSlots,
    scheduleSummary:
      formatBehaviorScheduleSummary(schedules) ||
      formatScheduleSlotsSummary(scheduleSlots) ||
      scheduledTimeLabel,
    timezone: behavior.timezone,
    browserReminderEnabled: behavior.browser_reminder_enabled,
    emailReminderEnabled: behavior.email_reminder_enabled,
    reminderOffsetMinutes: behavior.reminder_offset_minutes,
    reminderSummary: summarizeReminders({
      browserReminderEnabled: behavior.browser_reminder_enabled,
      emailReminderEnabled: behavior.email_reminder_enabled,
      reminderOffsetMinutes: behavior.reminder_offset_minutes,
    }),
    active: behavior.active,
    archivedAt: behavior.archived_at,
    archiveNotes: parseArchiveNotes(behavior.archive_notes),
    createdAt: behavior.created_at,
    updatedAt: behavior.updated_at,
  };
}

function toBehaviorScheduleViews(
  behavior: BehaviorGraphRecord,
  fallbackRecurrenceRule: ReturnType<typeof normalizeRecurrenceRule>,
  fallbackScheduledTime: string,
): BehaviorScheduleView[] {
  const schedules = behavior.schedules ?? [];

  if (schedules.length > 0) {
    return schedules
      .map((schedule) => toBehaviorScheduleView(schedule, fallbackScheduledTime))
      .sort((left, right) => left.sortOrder - right.sortOrder);
  }

  const legacySlots =
    behavior.schedule_slots.length > 0
      ? behavior.schedule_slots
          .map((slot) =>
            toScheduleSlotView({
              id: slot.id,
              scheduleId: slot.behavior_schedule_id,
              kind: normalizeScheduleKind(slot.kind),
              preset: normalizeSchedulePreset(slot.preset),
              startTime: slot.start_time,
              endTime: slot.end_time,
              sortOrder: slot.sort_order,
            }),
          )
          .sort(compareScheduleSlots)
      : [
          toScheduleSlotView({
            id: "",
            scheduleId: null,
            kind: "exact",
            preset: null,
            startTime: fallbackScheduledTime,
            endTime: null,
            sortOrder: 0,
          }),
        ];

  return [
    {
      id: "",
      recurrenceRule: fallbackRecurrenceRule,
      recurrenceSummary: summarizeRecurrenceRule(fallbackRecurrenceRule),
      recurrenceDefaults: recurrenceDefaultsFromRule(fallbackRecurrenceRule),
      timeEntries: legacySlots,
      timeSummary: formatScheduleSlotsSummary(legacySlots),
      sortOrder: 0,
    },
  ];
}

function toBehaviorScheduleView(
  schedule: BehaviorScheduleRecord,
  fallbackScheduledTime: string,
): BehaviorScheduleView {
  const recurrenceRule = normalizeRecurrenceRule(schedule.recurrence_rule);
  const timeEntries =
    schedule.schedule_slots.length > 0
      ? schedule.schedule_slots
          .map((slot) =>
            toScheduleSlotView({
              id: slot.id,
              scheduleId: slot.behavior_schedule_id ?? schedule.id,
              kind: normalizeScheduleKind(slot.kind),
              preset: normalizeSchedulePreset(slot.preset),
              startTime: slot.start_time,
              endTime: slot.end_time,
              sortOrder: slot.sort_order,
            }),
          )
          .sort(compareScheduleSlots)
      : [
          toScheduleSlotView({
            id: "",
            scheduleId: schedule.id,
            kind: "exact",
            preset: null,
            startTime: fallbackScheduledTime,
            endTime: null,
            sortOrder: 0,
          }),
        ];

  return {
    id: schedule.id,
    recurrenceRule,
    recurrenceSummary: summarizeRecurrenceRule(recurrenceRule),
    recurrenceDefaults: recurrenceDefaultsFromRule(recurrenceRule),
    timeEntries,
    timeSummary: formatScheduleSlotsSummary(timeEntries),
    sortOrder: schedule.sort_order,
  };
}

function formatBehaviorScheduleSummary(schedules: BehaviorScheduleView[]): string {
  if (schedules.length === 0) {
    return "";
  }

  if (schedules.length === 1) {
    return schedules[0]?.timeSummary ?? "";
  }

  return schedules
    .map(
      (schedule, index) =>
        `Schedule ${index + 1}: ${schedule.recurrenceSummary}, ${schedule.timeSummary}`,
    )
    .join("; ");
}

function normalizeScheduleKind(value: string): ScheduleKind {
  if (value === "exact" || value === "range") {
    return value;
  }

  throw new Error(`Unsupported schedule kind: ${value}.`);
}

function normalizeSchedulePreset(value: string | null): TimeRangePreset | null {
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

function toCategoryOption(category: CategoryOption): CategoryOption {
  return {
    id: category.id,
    name: category.name,
    description: category.description ?? null,
  };
}
