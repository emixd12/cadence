import { BehaviorValidationError, isWeekday, validateBehaviorPlanningFields } from "@cadence/core/services/behavior-values";
import { isBehaviorWhereKind } from "@cadence/core/services/behavior-where";
export { BehaviorValidationError, normalizeRecurrenceRule, recurrenceRuleToJson, recurrenceDefaultsFromRule, defaultRecurrenceDefaults, summarizeRecurrenceRule, normalizeScheduledTime, formatScheduledTimeLabel, formatScheduleSlotLabel, summarizeReminders, formatReminderOffset } from "@cadence/core/services/behavior-values";
import type { BehaviorInput } from "@cadence/core/behavior-store";
import type {
  BehaviorActionState,
  BehaviorFormField,
  CategoryOption,
} from "@/lib/types/behavior";
import type { RecurrenceRule, Weekday } from "@/lib/types/recurrence";
import {
  isValidTime,
  normalizeTime,
  timeRangePresetToSlot,
} from "@/lib/services/schedule";
import {
  TIME_RANGE_PRESETS,
  type BehaviorScheduleInput,
  type ScheduleSlotInput,
  type TimeRangePreset,
} from "@/lib/types/schedule";

export type ParsedBehaviorFormData = BehaviorInput & {
  behaviorId: string;
  scheduleSlots: ScheduleSlotInput[];
};

export type ParseBehaviorFormOptions = {
  mode: "create" | "update";
  categories?: CategoryOption[];
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SCHEDULED_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_BEHAVIOR_SCHEDULES = 6;
const MAX_TIME_ENTRIES_PER_SCHEDULE = 8;
const ALLOWED_REMINDER_OFFSETS = new Set([0, 15, 60, 1440, 4320]);
export function parseBehaviorFormData(
  formData: FormData,
  options: ParseBehaviorFormOptions,
): ParsedBehaviorFormData {
  const fieldErrors: Partial<Record<BehaviorFormField, string>> = {};
  const behaviorId = getOptionalString(formData, "behavior_id");
  const title = getOptionalString(formData, "title").trim();
  const description = getOptionalString(formData, "description").trim();
  // Forms without Where (MCP input) keep the earlier rule: location text means A place.
  const whereKind = formData.has("where_kind") ? getOptionalString(formData, "where_kind").trim() || null : undefined;
  const locationText = whereKind === undefined || whereKind === "place"
    ? getOptionalString(formData, "location_text").trim()
    : "";
  const categoryId = getOptionalString(formData, "category_id").trim();
  const duration = getOptionalString(formData, "default_duration_minutes").trim();
  const defaultDurationMinutes = duration ? Number(duration) : null;
  const endDate = getOptionalString(formData, "end_date").trim() || null;
  try { validateBehaviorPlanningFields({ defaultDurationMinutes, endDate }); }
  catch (error) {
    if (!(error instanceof BehaviorValidationError)) throw error;
    Object.assign(fieldErrors, error.fieldErrors);
  }

  if (options.mode === "update" && !UUID_PATTERN.test(behaviorId)) {
    fieldErrors.behavior_id = "Choose an existing behavior to edit.";
  }

  if (!title) {
    fieldErrors.title = "Enter a title.";
  } else if (title.length > 160) {
    fieldErrors.title = "Keep the title to 160 characters or fewer.";
  }

  if (description.length > 1000) {
    fieldErrors.description =
      "Keep the description to 1,000 characters or fewer.";
  }
  if (whereKind != null && !isBehaviorWhereKind(whereKind)) {
    fieldErrors.where_kind = "Choose where this happens.";
  } else if (whereKind === "place" && !locationText) {
    fieldErrors.location_text = "Enter the place.";
  } else if (locationText.length > 500 || /[\u0000-\u001f\u007f]/u.test(locationText)) {
    fieldErrors.location_text = "Keep the place to 500 characters and remove control characters.";
  }

  if (categoryId && !UUID_PATTERN.test(categoryId)) {
    fieldErrors.category_id = "Choose one of your categories.";
  } else if (
    categoryId &&
    options.categories &&
    !options.categories.some((category) => category.id === categoryId)
  ) {
    fieldErrors.category_id = "Choose one of your categories.";
  }

  const { recurrenceRule, schedules, scheduleSlots } =
    parseSchedulesAndLegacyFieldsFromForm(formData, fieldErrors);
  const reminderOffsetMinutes = parseReminderOffset(formData, fieldErrors);

  if (Object.keys(fieldErrors).length > 0) {
    throw new BehaviorValidationError("Check the highlighted fields.", fieldErrors);
  }

  return {
    behaviorId,
    defaultDurationMinutes,
    endDate,
    title,
    description: description || null,
    whereKind: whereKind === undefined ? undefined : isBehaviorWhereKind(whereKind) ? whereKind : null,
    locationText: locationText || null,
    categoryId: categoryId || null,
    recurrenceRule,
    scheduledTime: scheduleSlots[0]?.startTime ?? "09:00",
    schedules,
    scheduleSlots,
    browserReminderEnabled: getCheckboxValue(formData, "browser_reminder"),
    emailReminderEnabled: getCheckboxValue(formData, "email_reminder"),
    reminderOffsetMinutes,
    active:
      options.mode === "create" ? true : getCheckboxValue(formData, "active"),
  };
}

export function behaviorErrorToActionState(error: unknown): BehaviorActionState {
  if (error instanceof BehaviorValidationError) {
    return {
      status: "error",
      message: error.message,
      fieldErrors: error.fieldErrors,
    };
  }

  const message = getErrorMessage(error);

  if (message === "Behavior schedule graph changed after it was read.") {
    return {
      status: "error",
      message: "This behavior changed elsewhere. Reload it before saving again. Your draft is still here.",
      conflict: true,
    };
  }

  if (error instanceof Error) {
    return {
      status: "error",
      message: error.message,
    };
  }

  return {
    status: "error",
    message: "Something went wrong while saving this behavior.",
  };
}

function getErrorMessage(error: unknown): string | null {
  if (error instanceof Error) {
    return error.message;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return null;
}

function parseSchedulesAndLegacyFieldsFromForm(
  formData: FormData,
  fieldErrors: Partial<Record<BehaviorFormField, string>>,
): {
  recurrenceRule: RecurrenceRule;
  schedules: BehaviorScheduleInput[];
  scheduleSlots: ScheduleSlotInput[];
} {
  if (getOptionalString(formData, "behavior_schedule_count")) {
    const schedules = parseBehaviorSchedulesFromForm(formData, fieldErrors);
    const recurrenceRule = schedules[0]?.recurrenceRule ?? {
      frequency: "daily",
      interval: 1,
    };
    const scheduleSlots = schedules.flatMap((schedule) => schedule.timeEntries);

    return {
      recurrenceRule,
      schedules,
      scheduleSlots,
    };
  }

  const recurrenceRule = parseRecurrenceRuleFromForm(formData, fieldErrors);
  const scheduleSlots = parseScheduleSlotsFromForm(formData, fieldErrors);

  return {
    recurrenceRule,
    schedules: [
      {
        id: null,
        recurrenceRule,
        timeEntries: scheduleSlots,
        sortOrder: 0,
      },
    ],
    scheduleSlots,
  };
}

function parseBehaviorSchedulesFromForm(
  formData: FormData,
  fieldErrors: Partial<Record<BehaviorFormField, string>>,
): BehaviorScheduleInput[] {
  const rawCount = getOptionalString(formData, "behavior_schedule_count");
  const count = Number(rawCount);

  if (!Number.isInteger(count) || count < 1) {
    fieldErrors.schedule = "Add at least one schedule.";
    return [
      {
        id: null,
        recurrenceRule: { frequency: "daily", interval: 1 },
        timeEntries: [
          {
            id: null,
            kind: "exact",
            preset: null,
            startTime: "09:00",
            endTime: null,
            sortOrder: 0,
          },
        ],
        sortOrder: 0,
      },
    ];
  }

  if (count > MAX_BEHAVIOR_SCHEDULES) {
    fieldErrors.schedule = `Use ${MAX_BEHAVIOR_SCHEDULES} or fewer schedules.`;
  }

  const upperBound = Math.min(count, MAX_BEHAVIOR_SCHEDULES);
  const schedules: BehaviorScheduleInput[] = [];

  for (let index = 0; index < upperBound; index += 1) {
    schedules.push(parseBehaviorScheduleAtIndex(formData, index, fieldErrors));
  }

  if (schedules.every((schedule) => schedule.timeEntries.length === 0)) {
    fieldErrors.schedule = "Add at least one time entry.";
  }

  return schedules;
}

function parseBehaviorScheduleAtIndex(
  formData: FormData,
  index: number,
  fieldErrors: Partial<Record<BehaviorFormField, string>>,
): BehaviorScheduleInput {
  const id = getOptionalString(formData, `behavior_schedule_id_${index}`).trim();

  if (id && !UUID_PATTERN.test(id)) {
    fieldErrors.schedule = "Choose one of this behavior's schedules.";
  }

  return {
    id: id || null,
    recurrenceRule: parseRecurrenceRuleFromForm(
      formData,
      fieldErrors,
      `schedule_${index}`,
    ),
    timeEntries: parseTimeEntriesForSchedule(formData, index, fieldErrors),
    sortOrder: index,
  };
}

function parseTimeEntriesForSchedule(
  formData: FormData,
  scheduleIndex: number,
  fieldErrors: Partial<Record<BehaviorFormField, string>>,
): ScheduleSlotInput[] {
  const rawCount = getOptionalString(
    formData,
    `schedule_${scheduleIndex}_time_entry_count`,
  );
  const count = Number(rawCount);

  if (!Number.isInteger(count) || count < 1) {
    fieldErrors.schedule = "Each schedule needs at least one time.";
    return [
      {
        id: null,
        kind: "exact",
        preset: null,
        startTime: "09:00",
        endTime: null,
        sortOrder: 0,
      },
    ];
  }

  if (count > MAX_TIME_ENTRIES_PER_SCHEDULE) {
    fieldErrors.schedule = `Use ${MAX_TIME_ENTRIES_PER_SCHEDULE} or fewer times per schedule.`;
  }

  const upperBound = Math.min(count, MAX_TIME_ENTRIES_PER_SCHEDULE);
  const seenStartTimes = new Set<string>();
  const entries: ScheduleSlotInput[] = [];

  for (let index = 0; index < upperBound; index += 1) {
    const entry = parseTimeEntryAtIndex(
      formData,
      scheduleIndex,
      index,
      fieldErrors,
    );
    const entryKey = entry.startTime;

    if (seenStartTimes.has(entryKey)) {
      fieldErrors.schedule = "Use each start time only once within a schedule.";
    }

    seenStartTimes.add(entryKey);
    entries.push({
      ...entry,
      sortOrder: index,
    });
  }

  return entries;
}

function parseTimeEntryAtIndex(
  formData: FormData,
  scheduleIndex: number,
  index: number,
  fieldErrors: Partial<Record<BehaviorFormField, string>>,
): ScheduleSlotInput {
  const id = getOptionalString(
    formData,
    `schedule_${scheduleIndex}_time_entry_id_${index}`,
  ).trim();
  const kind = getOptionalString(
    formData,
    `schedule_${scheduleIndex}_time_entry_kind_${index}`,
  );

  if (id && !UUID_PATTERN.test(id)) {
    fieldErrors.schedule = "Choose one of this schedule's time entries.";
  }

  if (kind === "range") {
    const preset = getOptionalString(
      formData,
      `schedule_${scheduleIndex}_time_entry_range_preset_${index}`,
    );

    if (isTimeRangePreset(preset)) {
      return timeRangePresetToSlot({
        id: id || null,
        preset,
        sortOrder: index,
      });
    }

    const startTime = getOptionalString(
      formData,
      `schedule_${scheduleIndex}_time_entry_range_start_${index}`,
    ).trim();
    const endTime = getOptionalString(
      formData,
      `schedule_${scheduleIndex}_time_entry_range_end_${index}`,
    ).trim();

    if (
      !SCHEDULED_TIME_PATTERN.test(startTime) ||
      !isValidTime(startTime) ||
      !SCHEDULED_TIME_PATTERN.test(endTime) ||
      !isValidTime(endTime)
    ) {
      fieldErrors.schedule = "Choose a valid time range.";
      return {
        id: id || null,
        kind: "range",
        preset: null,
        startTime: "09:00",
        endTime: "09:30",
        sortOrder: index,
      };
    }

    if (normalizeTime(startTime) === normalizeTime(endTime)) {
      fieldErrors.schedule = "Use a range with different start and end times.";
    }

    return {
      id: id || null,
      kind: "range",
      preset: null,
      startTime: normalizeTime(startTime),
      endTime: normalizeTime(endTime),
      sortOrder: index,
    };
  }

  if (kind !== "exact") {
    fieldErrors.schedule = "Choose exact time or time range.";
  }

  const startTime = getOptionalString(
    formData,
    `schedule_${scheduleIndex}_time_entry_exact_time_${index}`,
  ).trim();

  if (!SCHEDULED_TIME_PATTERN.test(startTime) || !isValidTime(startTime)) {
    fieldErrors.schedule = "Choose a scheduled time.";
    return {
      id: id || null,
      kind: "exact",
      preset: null,
      startTime: "09:00",
      endTime: null,
      sortOrder: index,
    };
  }

  return {
    id: id || null,
    kind: "exact",
    preset: null,
    startTime: normalizeTime(startTime),
    endTime: null,
    sortOrder: index,
  };
}

function parseRecurrenceRuleFromForm(
  formData: FormData,
  fieldErrors: Partial<Record<BehaviorFormField, string>>,
  prefix = "",
): RecurrenceRule {
  const kind = getOptionalString(formData, recurrenceFieldName(prefix, "recurrence_kind"));

  switch (kind) {
    case "daily":
      return {
        frequency: "daily",
        interval: parsePositiveIntegerField(
          formData,
          recurrenceFieldName(prefix, "daily_interval"),
          "recurrence",
          fieldErrors,
        ),
      };

    case "every_days":
      return {
        frequency: "interval_days",
        intervalDays: parsePositiveIntegerField(
          formData,
          recurrenceFieldName(prefix, "every_days"),
          "recurrence",
          fieldErrors,
        ),
      };

    case "weekly":
      return {
        frequency: "weekly",
        interval: parsePositiveIntegerField(
          formData,
          recurrenceFieldName(prefix, "weekly_interval"),
          "recurrence",
          fieldErrors,
        ),
        daysOfWeek: parseWeekdays(formData, fieldErrors, prefix),
      };

    case "monthly":
      return {
        frequency: "monthly",
        interval: parsePositiveIntegerField(
          formData,
          recurrenceFieldName(prefix, "monthly_interval"),
          "recurrence",
          fieldErrors,
        ),
        dayOfMonth: parseIntegerFieldInRange(
          formData,
          recurrenceFieldName(prefix, "monthly_day"),
          1,
          31,
          "recurrence",
          fieldErrors,
        ),
      };

    default:
      fieldErrors.recurrence = "Choose a recurrence.";
      return { frequency: "daily", interval: 1 };
  }
}

function recurrenceFieldName(prefix: string, fieldName: string): string {
  return prefix ? `${prefix}_${fieldName}` : fieldName;
}

function parseWeekdays(
  formData: FormData,
  fieldErrors: Partial<Record<BehaviorFormField, string>>,
  prefix = "",
): Weekday[] {
  const weekdays = formData
    .getAll(recurrenceFieldName(prefix, "weekly_days"))
    .filter((value): value is string => typeof value === "string")
    .filter(isWeekday);

  if (weekdays.length === 0) {
    fieldErrors.recurrence = "Choose at least one weekday.";
  }

  return weekdays;
}

function parseReminderOffset(
  formData: FormData,
  fieldErrors: Partial<Record<BehaviorFormField, string>>,
): number {
  const value = parseIntegerFieldInRange(
    formData,
    "reminder_offset",
    0,
    4320,
    "reminders",
    fieldErrors,
  );

  if (!ALLOWED_REMINDER_OFFSETS.has(value)) {
    fieldErrors.reminders = "Choose a reminder offset.";
  }

  return value;
}

function parseScheduleSlotsFromForm(
  formData: FormData,
  fieldErrors: Partial<Record<BehaviorFormField, string>>,
): ScheduleSlotInput[] {
  const rawCount = getOptionalString(formData, "schedule_slot_count");

  if (!rawCount) {
    return [parseLegacyScheduledTimeSlot(formData, fieldErrors)];
  }

  const count = Number(rawCount);

  if (!Number.isInteger(count) || count < 1) {
    fieldErrors.schedule = "Add at least one scheduled time or range.";
    return [
      {
        id: null,
        kind: "exact",
        preset: null,
        startTime: "09:00",
        endTime: null,
        sortOrder: 0,
      },
    ];
  }

  if (count > MAX_TIME_ENTRIES_PER_SCHEDULE) {
    fieldErrors.schedule = `Use ${MAX_TIME_ENTRIES_PER_SCHEDULE} or fewer scheduled times or ranges.`;
  }

  const slots: ScheduleSlotInput[] = [];
  const seenStartTimes = new Set<string>();
  const upperBound = Math.min(count, MAX_TIME_ENTRIES_PER_SCHEDULE);

  for (let index = 0; index < upperBound; index += 1) {
    const slot = parseScheduleSlotAtIndex(formData, index, fieldErrors);

    if (seenStartTimes.has(slot.startTime)) {
      fieldErrors.schedule = "Use each scheduled start time only once.";
    }

    seenStartTimes.add(slot.startTime);
    slots.push({
      ...slot,
      sortOrder: index,
    });
  }

  if (slots.length === 0) {
    fieldErrors.schedule = "Add at least one scheduled time or range.";
  }

  return slots;
}

function parseLegacyScheduledTimeSlot(
  formData: FormData,
  fieldErrors: Partial<Record<BehaviorFormField, string>>,
): ScheduleSlotInput {
  const scheduledTime = getOptionalString(formData, "scheduled_time").trim();

  if (!SCHEDULED_TIME_PATTERN.test(scheduledTime) || !isValidTime(scheduledTime)) {
    fieldErrors.schedule = "Choose a scheduled time.";
    return {
      id: null,
      kind: "exact",
      preset: null,
      startTime: "09:00",
      endTime: null,
      sortOrder: 0,
    };
  }

  return {
    id: null,
    kind: "exact",
    preset: null,
    startTime: normalizeTime(scheduledTime),
    endTime: null,
    sortOrder: 0,
  };
}

function parseScheduleSlotAtIndex(
  formData: FormData,
  index: number,
  fieldErrors: Partial<Record<BehaviorFormField, string>>,
): ScheduleSlotInput {
  const id = getOptionalString(formData, `schedule_slot_id_${index}`).trim();
  const kind = getOptionalString(formData, `schedule_kind_${index}`);

  if (id && !UUID_PATTERN.test(id)) {
    fieldErrors.schedule = "Choose one of this behavior's schedule rows.";
  }

  if (kind === "range") {
    const preset = getOptionalString(formData, `schedule_range_preset_${index}`);

    if (isTimeRangePreset(preset)) {
      return timeRangePresetToSlot({
        id: id || null,
        preset,
        sortOrder: index,
      });
    }

    fieldErrors.schedule = "Choose a time range.";
    return timeRangePresetToSlot({
      id: id || null,
      preset: "morning",
      sortOrder: index,
    });
  }

  if (kind !== "exact") {
    fieldErrors.schedule = "Choose exact time or time range.";
  }

  const startTime = getOptionalString(
    formData,
    `schedule_exact_time_${index}`,
  ).trim();

  if (!SCHEDULED_TIME_PATTERN.test(startTime) || !isValidTime(startTime)) {
    fieldErrors.schedule = "Choose a scheduled time.";
    return {
      id: id || null,
      kind: "exact",
      preset: null,
      startTime: "09:00",
      endTime: null,
      sortOrder: index,
    };
  }

  return {
    id: id || null,
    kind: "exact",
    preset: null,
    startTime: normalizeTime(startTime),
    endTime: null,
    sortOrder: index,
  };
}

function parsePositiveIntegerField(
  formData: FormData,
  fieldName: string,
  errorField: BehaviorFormField,
  fieldErrors: Partial<Record<BehaviorFormField, string>>,
): number {
  return parseIntegerFieldInRange(
    formData,
    fieldName,
    1,
    999,
    errorField,
    fieldErrors,
  );
}

function parseIntegerFieldInRange(
  formData: FormData,
  fieldName: string,
  minimum: number,
  maximum: number,
  errorField: BehaviorFormField,
  fieldErrors: Partial<Record<BehaviorFormField, string>>,
): number {
  const value = Number(getOptionalString(formData, fieldName));

  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    fieldErrors[errorField] =
      `Enter a whole number from ${minimum} to ${maximum}.`;
    return minimum;
  }

  return value;
}

function isTimeRangePreset(value: string): value is TimeRangePreset {
  return value in TIME_RANGE_PRESETS;
}

function getOptionalString(formData: FormData, fieldName: string): string {
  const value = formData.get(fieldName);

  return typeof value === "string" ? value : "";
}

function getCheckboxValue(formData: FormData, fieldName: string): boolean {
  const value = formData.get(fieldName);

  return value === "on" || value === "true";
}
