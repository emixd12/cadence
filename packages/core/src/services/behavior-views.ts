import type { BehaviorGraphRecord, BehaviorScheduleRecord } from "../behavior-store";
import type { BehaviorPageData, BehaviorView, CategoryOption } from "../types/behavior";
import type { BehaviorScheduleView, ScheduleKind, TimeRangePreset } from "../types/schedule";
import { DEFAULT_TIMEZONE } from "../types/recurrence";
import { parseArchiveNotes } from "../resolvers/archive-note.resolver";
import { formatScheduledTimeLabel, normalizeRecurrenceRule, normalizeScheduledTime,
  recurrenceDefaultsFromRule, storedRecurrenceRuleOrNull, summarizeRecurrenceRule, summarizeReminders } from "./behavior-values";
import { compareScheduleSlots, formatScheduleSlotsSummary, toScheduleSlotView } from "./schedule";
import { storedBehaviorWhere } from "./behavior-where";
import type { Temporal } from "@js-temporal/polyfill";
import { behaviorRunState, runFieldsFromStored } from "../resolvers/behavior-run.resolver";

export function assembleBehaviorPageData(input: {
  behaviors: BehaviorGraphRecord[]; categories: CategoryOption[]; profileTimezone: string | null;
  /** Needed for each view's run state (running, ended, paused). */
  now?: Temporal.Instant;
}): BehaviorPageData {
  const behaviorViews = input.behaviors.map((behavior) => toBehaviorView(behavior, input.now));
  return {
    categories: input.categories.map(toCategoryOption),
    activeBehaviors: behaviorViews.filter((behavior) => behavior.active),
    archivedBehaviors: behaviorViews.filter((behavior) => !behavior.active),
    defaultTimezone: input.profileTimezone ?? DEFAULT_TIMEZONE,
  };
}

export function toBehaviorView(behavior: BehaviorGraphRecord, now?: Temporal.Instant): BehaviorView {
  const storedRule = storedRecurrenceRuleOrNull(behavior);
  const unscheduled = storedRule === null || behavior.scheduled_time === null;
  // An unscheduled opportunity Behavior has no schedule; the form defaults to Daily.
  const recurrenceRule = storedRule ?? UNSCHEDULED_FORM_RULE;
  const scheduledTime = behavior.scheduled_time === null ? "" : normalizeScheduledTime(behavior.scheduled_time);
  const scheduledTimeLabel = scheduledTime ? formatScheduledTimeLabel(scheduledTime) : "";
  const schedules = unscheduled && (behavior.schedules ?? []).length === 0
    ? [] : toBehaviorScheduleViews(behavior, recurrenceRule, scheduledTime);
  const scheduleSlots = schedules.flatMap((schedule) => schedule.timeEntries);

  return {
    id: behavior.id,
    defaultDurationMinutes: behavior.default_duration_minutes ?? null,
    ...behaviorRunView(behavior, now),
    autoArchivedAt: behavior.auto_archived_at ?? null,
    title: behavior.title,
    description: behavior.description ?? "",
    parentBehaviorId: behavior.parent_behavior_id ?? null,
    subBehaviorSortOrder: behavior.sub_behavior_sort_order ?? 0,
    inheritParentSchedule: behavior.parent_behavior_id ? behavior.inherit_parent_schedule ?? false : false,
    whereKind: storedBehaviorWhere(behavior).where_kind,
    locationText: storedBehaviorWhere(behavior).location_text,
    categoryId: behavior.category_id ?? "",
    categoryName: behavior.category?.name ?? "No category",
    recurrenceSummary:
      schedules.length === 0 ? "" : schedules.length === 1
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
    ...(behavior.is_opportunity === undefined ? {} : { isOpportunity: behavior.is_opportunity }),
    createdAt: behavior.created_at,
    updatedAt: behavior.updated_at,
  };
}

const UNSCHEDULED_FORM_RULE = { frequency: "daily", interval: 1 } as const;

function behaviorRunView(behavior: BehaviorGraphRecord, now?: Temporal.Instant) {
  const fields = runFieldsFromStored(behavior);
  return {
    endOn: fields.endOn,
    endTime: fields.endTime,
    pause: fields.pauseFromOn && fields.pauseBackOn
      ? { fromOn: fields.pauseFromOn, fromTime: fields.pauseFromTime, backOn: fields.pauseBackOn }
      : null,
    ...(now ? { runState: behaviorRunState(fields, now).state } : {}),
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
