import { Temporal } from "@js-temporal/polyfill";
import type { Json } from "../types/json";
import type { BehaviorFormField, BehaviorRecurrenceFormDefaults } from "../types/behavior";
import type { RecurrenceRule, Weekday } from "../types/recurrence";
import { WEEKDAYS } from "../types/recurrence";
import { formatClockTimeLabel, formatScheduleSlotLabel, normalizeTime } from "./schedule";

export class BehaviorValidationError extends Error {
  readonly fieldErrors: Partial<Record<BehaviorFormField, string>>;

  constructor(
    message: string,
    fieldErrors: Partial<Record<BehaviorFormField, string>>,
  ) {
    super(message);
    this.name = "BehaviorValidationError";
    this.fieldErrors = fieldErrors;
  }
}

const WEEKDAY_LABELS: Record<Weekday, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

export function normalizeRecurrenceRule(value: unknown): RecurrenceRule {
  if (!isRecord(value)) {
    throw new BehaviorValidationError("Stored recurrence is invalid.", {
      recurrence: "Stored recurrence is invalid.",
    });
  }

  switch (value.frequency) {
    case "daily":
      return {
        frequency: "daily",
        interval: requirePositiveInteger(value.interval, "recurrence"),
      };

    case "interval_days":
      return {
        frequency: "interval_days",
        intervalDays: requirePositiveInteger(value.intervalDays, "recurrence"),
      };

    case "weekly":
      return {
        frequency: "weekly",
        interval: requirePositiveInteger(value.interval, "recurrence"),
        daysOfWeek: requireWeekdays(value.daysOfWeek),
      };

    case "monthly":
      return {
        frequency: "monthly",
        interval: requirePositiveInteger(value.interval, "recurrence"),
        dayOfMonth: requireIntegerInRange(value.dayOfMonth, 1, 31, "recurrence"),
      };

    default:
      throw new BehaviorValidationError("Stored recurrence is invalid.", {
        recurrence: "Stored recurrence is invalid.",
      });
  }
}

export function recurrenceRuleToJson(recurrenceRule: RecurrenceRule): Json {
  return recurrenceRule as unknown as Json;
}

export function recurrenceDefaultsFromRule(
  recurrenceRule: RecurrenceRule,
): BehaviorRecurrenceFormDefaults {
  switch (recurrenceRule.frequency) {
    case "daily":
      return {
        ...defaultRecurrenceDefaults(),
        kind: "daily",
        dailyInterval: recurrenceRule.interval,
      };

    case "interval_days":
      return {
        ...defaultRecurrenceDefaults(),
        kind: "every_days",
        everyDays: recurrenceRule.intervalDays,
      };

    case "weekly":
      return {
        ...defaultRecurrenceDefaults(),
        kind: "weekly",
        weeklyInterval: recurrenceRule.interval,
        weeklyDays: recurrenceRule.daysOfWeek,
      };

    case "monthly":
      return {
        ...defaultRecurrenceDefaults(),
        kind: "monthly",
        monthlyInterval: recurrenceRule.interval,
        monthlyDay: recurrenceRule.dayOfMonth,
      };
  }
}

export function defaultRecurrenceDefaults(): BehaviorRecurrenceFormDefaults {
  return {
    kind: "daily",
    dailyInterval: 1,
    everyDays: 2,
    weeklyInterval: 1,
    weeklyDays: ["monday"],
    monthlyInterval: 1,
    monthlyDay: 1,
  };
}

export function summarizeRecurrenceRule(recurrenceRule: RecurrenceRule): string {
  switch (recurrenceRule.frequency) {
    case "daily":
      return recurrenceRule.interval === 1
        ? "Daily"
        : `Every ${recurrenceRule.interval} days`;

    case "interval_days":
      return recurrenceRule.intervalDays === 1
        ? "Daily"
        : `Every ${recurrenceRule.intervalDays} days`;

    case "weekly": {
      const dayList = recurrenceRule.daysOfWeek
        .map((weekday) => WEEKDAY_LABELS[weekday])
        .join(", ");
      return recurrenceRule.interval === 1
        ? `Weekly on ${dayList}`
        : `Every ${recurrenceRule.interval} weeks on ${dayList}`;
    }

    case "monthly":
      return recurrenceRule.interval === 1
        ? `Monthly on day ${recurrenceRule.dayOfMonth}`
        : `Every ${recurrenceRule.interval} months on day ${recurrenceRule.dayOfMonth}`;
  }
}

export function normalizeScheduledTime(value: string): string {
  return normalizeTime(value);
}

export function formatScheduledTimeLabel(value: string): string {
  return formatClockTimeLabel(value);
}

export { formatScheduleSlotLabel };

export function summarizeReminders(input: {
  browserReminderEnabled: boolean;
  emailReminderEnabled: boolean;
  reminderOffsetMinutes: number;
}): string {
  const channels = [
    input.browserReminderEnabled ? "Browser notifications" : null,
    input.emailReminderEnabled ? "Email" : null,
  ].filter(Boolean);

  if (channels.length === 0) {
    return "No reminders";
  }

  return `${channels.join(" + ")}, ${formatReminderOffset(input.reminderOffsetMinutes)}`;
}

export function formatReminderOffset(minutes: number): string {
  switch (minutes) {
    case 0:
      return "at scheduled start";
    case 15:
      return "15 minutes before";
    case 60:
      return "1 hour before";
    case 1440:
      return "1 day before";
    case 4320:
      return "3 days before";
    default:
      return `${minutes} minutes before`;
  }
}

function requirePositiveInteger(
  value: unknown,
  errorField: BehaviorFormField,
): number {
  return requireIntegerInRange(value, 1, 999, errorField);
}

function requireIntegerInRange(
  value: unknown,
  minimum: number,
  maximum: number,
  errorField: BehaviorFormField,
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new BehaviorValidationError("Stored recurrence is invalid.", {
      [errorField]: "Stored recurrence is invalid.",
    });
  }

  return value;
}

function requireWeekdays(value: unknown): Weekday[] {
  if (!Array.isArray(value)) {
    throw new BehaviorValidationError("Stored recurrence is invalid.", {
      recurrence: "Stored recurrence is invalid.",
    });
  }

  const weekdays = value.filter(
    (weekday): weekday is Weekday =>
      typeof weekday === "string" && isWeekday(weekday),
  );

  if (weekdays.length === 0 || weekdays.length !== value.length) {
    throw new BehaviorValidationError("Stored recurrence is invalid.", {
      recurrence: "Stored recurrence is invalid.",
    });
  }

  return weekdays;
}

export function isWeekday(value: string): value is Weekday {
  return WEEKDAYS.includes(value as Weekday);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const END_DATE_NOT_AFTER_TODAY_MESSAGE = "Choose a date after today. The Behavior’s last day is the day before its end date.";

/**
 * Checks Default duration and End date. With `today` (the Behavior's local date), an End date
 * must come after today: the End date is the first day the Behavior no longer runs
 * (docs/RECURRENCE_RULES.md, "Behavior end date"), so today or earlier would archive it at once.
 */
export function validateBehaviorPlanningFields(input: {
  defaultDurationMinutes?: number | null; endDate?: string | null;
}, options: { today?: string } = {}): void {
  const errors: Partial<Record<BehaviorFormField, string>> = {};
  if (input.defaultDurationMinutes != null && (!Number.isInteger(input.defaultDurationMinutes) ||
      input.defaultDurationMinutes < 1 || input.defaultDurationMinutes > 1440)) {
    errors.default_duration_minutes = "Enter a whole number from 1 to 1,440 minutes, or leave blank.";
  }
  if (input.endDate != null) {
    try {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.endDate) || input.endDate < "0001-01-01" ||
          Temporal.PlainDate.from(input.endDate).toString() !== input.endDate) throw new Error("Invalid date");
    } catch { errors.end_date = "Enter a valid end date, or leave blank."; }
    if (!errors.end_date && options.today && input.endDate <= options.today) {
      errors.end_date = END_DATE_NOT_AFTER_TODAY_MESSAGE;
    }
  }
  if (Object.keys(errors).length) throw new BehaviorValidationError("Check the highlighted fields.", errors);
}
