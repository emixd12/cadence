import { Temporal } from "@js-temporal/polyfill";

import type { Json } from "../types/json";
import {
  BEHAVIOR_CONFIGURATION_CHANGED_FIELDS,
  type BehaviorConfigurationChangedField,
  type BehaviorConfigurationEventPlan,
  type BehaviorConfigurationEventSource,
  type BehaviorConfigurationSchedule,
  type BehaviorConfigurationSnapshot,
  type BehaviorConfigurationTimeEntry,
} from "../types/behavior-configuration-event";

type BehaviorConfigurationEventContext = {
  recordedAt: string;
  effectiveAt: string;
  source: BehaviorConfigurationEventSource;
  reasonCode: string;
};

export function isBehaviorLogScheduleBoundary(event: {
  event_kind: string;
  changed_fields: readonly string[];
}): boolean {
  return event.event_kind === "baseline" || event.changed_fields.some(
    (field) => field === "schedule_graph" || field === "timezone" || field === "active",
  );
}

export function planInitialBehaviorConfigurationEvent(
  input: BehaviorConfigurationEventContext & {
    configuration: BehaviorConfigurationSnapshot;
  },
): BehaviorConfigurationEventPlan {
  const nextConfiguration = normalizeBehaviorConfiguration(input.configuration);

  return createEventPlan({
    ...input,
    eventKind: "baseline",
    previousConfiguration: null,
    nextConfiguration,
    changedFields: [...BEHAVIOR_CONFIGURATION_CHANGED_FIELDS],
  });
}

export function planBehaviorConfigurationChangeEvent(
  input: BehaviorConfigurationEventContext & {
    previousConfiguration: BehaviorConfigurationSnapshot;
    nextConfiguration: BehaviorConfigurationSnapshot;
  },
): BehaviorConfigurationEventPlan | null {
  const previousConfiguration = normalizeBehaviorConfiguration(
    input.previousConfiguration,
  );
  const nextConfiguration = normalizeBehaviorConfiguration(
    input.nextConfiguration,
  );
  const changedFields = findChangedFields(
    previousConfiguration,
    nextConfiguration,
  );

  if (changedFields.length === 0) {
    return null;
  }

  return createEventPlan({
    ...input,
    eventKind: "revision",
    previousConfiguration,
    nextConfiguration,
    changedFields,
  });
}

export function normalizeBehaviorConfiguration(
  configuration: BehaviorConfigurationSnapshot,
): BehaviorConfigurationSnapshot {
  const timezone = normalizeStoredTimezone(configuration.timezone);

  return {
    categoryId: normalizeOptionalId(configuration.categoryId),
    ...normalizeWhere(configuration),
    scheduleGraph: configuration.scheduleGraph
      .map(normalizeSchedule)
      .sort(compareSchedules),
    browserReminderEnabled: configuration.browserReminderEnabled,
    emailReminderEnabled: configuration.emailReminderEnabled,
    reminderOffsetMinutes: configuration.reminderOffsetMinutes,
    active: configuration.active,
    timezone,
  };
}

function createEventPlan(
  input: BehaviorConfigurationEventContext & {
    eventKind: BehaviorConfigurationEventPlan["eventKind"];
    previousConfiguration: BehaviorConfigurationSnapshot | null;
    nextConfiguration: BehaviorConfigurationSnapshot;
    changedFields: BehaviorConfigurationChangedField[];
  },
): BehaviorConfigurationEventPlan {
  const effectiveInstant = Temporal.Instant.from(input.effectiveAt);
  const recordedAt = Temporal.Instant.from(input.recordedAt).toString();
  const effectiveAt = effectiveInstant.toString();
  const timezone = input.nextConfiguration.timezone;

  return {
    eventKind: input.eventKind,
    previousConfiguration: input.previousConfiguration,
    nextConfiguration: input.nextConfiguration,
    changedFields: input.changedFields,
    recordedAt,
    effectiveAt,
    effectiveLocalDate: effectiveInstant
      .toZonedDateTimeISO(timezone)
      .toPlainDate()
      .toString(),
    timezone,
    source: input.source,
    reasonCode: input.reasonCode.trim(),
  };
}

function findChangedFields(
  previous: BehaviorConfigurationSnapshot,
  next: BehaviorConfigurationSnapshot,
): BehaviorConfigurationChangedField[] {
  const changedFields: BehaviorConfigurationChangedField[] = [];

  if (previous.categoryId !== next.categoryId) {
    changedFields.push("category_id");
  }
  if (previous.locationText !== next.locationText) {
    changedFields.push("location_text");
  }
  if (previous.whereKind !== next.whereKind) {
    changedFields.push("where_kind");
  }
  if (!jsonEqual(previous.scheduleGraph, next.scheduleGraph)) {
    changedFields.push("schedule_graph");
  }
  if (previous.browserReminderEnabled !== next.browserReminderEnabled) {
    changedFields.push("browser_reminder_enabled");
  }
  if (previous.emailReminderEnabled !== next.emailReminderEnabled) {
    changedFields.push("email_reminder_enabled");
  }
  if (previous.reminderOffsetMinutes !== next.reminderOffsetMinutes) {
    changedFields.push("reminder_offset_minutes");
  }
  if (previous.active !== next.active) {
    changedFields.push("active");
  }
  if (previous.timezone !== next.timezone) {
    changedFields.push("timezone");
  }

  return changedFields;
}

// Snapshots written before Ticket 215 carry only location text, which meant A place.
function normalizeWhere(
  configuration: BehaviorConfigurationSnapshot,
): Pick<BehaviorConfigurationSnapshot, "locationText" | "whereKind"> {
  const locationText = configuration.locationText?.trim() || null;
  const whereKind = configuration.whereKind === undefined
    ? (locationText ? "place" : null)
    : configuration.whereKind;
  return { locationText: whereKind === "place" ? locationText : null, whereKind };
}

function normalizeSchedule(
  schedule: BehaviorConfigurationSchedule,
): BehaviorConfigurationSchedule {
  return {
    recurrenceRule: normalizeJson(schedule.recurrenceRule),
    sortOrder: schedule.sortOrder,
    timeEntries: schedule.timeEntries
      .map(normalizeTimeEntry)
      .sort(compareTimeEntries),
  };
}

function normalizeTimeEntry(
  entry: BehaviorConfigurationTimeEntry,
): BehaviorConfigurationTimeEntry {
  return {
    kind: entry.kind.trim(),
    preset: entry.preset?.trim() || null,
    startTime: normalizeLocalTime(entry.startTime),
    endTime: entry.endTime ? normalizeLocalTime(entry.endTime) : null,
    sortOrder: entry.sortOrder,
  };
}

function normalizeJson(value: Json): Json {
  if (Array.isArray(value)) {
    return value.map(normalizeJson);
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .flatMap(([key, nestedValue]) => {
          if (nestedValue === undefined) {
            return [];
          }

          const normalizedValue = normalizeJson(nestedValue);

          if (
            key === "daysOfWeek" &&
            Array.isArray(normalizedValue) &&
            normalizedValue.every((day) => typeof day === "string")
          ) {
            return [[key, [...normalizedValue].sort(compareWeekdays)]];
          }

          return [[key, normalizedValue]];
        }),
    );
  }

  return value;
}

function normalizeLocalTime(value: string): string {
  const match = value.trim().match(
    /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.(\d{1,6}))?)?$/,
  );

  if (!match) {
    throw new Error(`Invalid local schedule time: ${value}.`);
  }

  const fraction = match[4]?.replace(/0+$/, "");

  return `${match[1]}:${match[2]}:${match[3] ?? "00"}${fraction ? `.${fraction}` : ""}`;
}

function normalizeStoredTimezone(timezone: string): string {
  const normalized = timezone.trim();

  new Intl.DateTimeFormat("en-US", { timeZone: normalized });

  return normalized;
}

function normalizeOptionalId(value: string | null): string | null {
  const normalized = value?.trim() ?? "";

  return normalized.length > 0 ? normalized : null;
}

function compareSchedules(
  left: BehaviorConfigurationSchedule,
  right: BehaviorConfigurationSchedule,
): number {
  return (
    left.sortOrder - right.sortOrder ||
    stableStringify(left).localeCompare(stableStringify(right))
  );
}

function compareTimeEntries(
  left: BehaviorConfigurationTimeEntry,
  right: BehaviorConfigurationTimeEntry,
): number {
  return (
    left.sortOrder - right.sortOrder ||
    left.startTime.localeCompare(right.startTime) ||
    stableStringify(left).localeCompare(stableStringify(right))
  );
}

const WEEKDAY_ORDER = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

function compareWeekdays(left: Json, right: Json): number {
  return (
    WEEKDAY_ORDER.indexOf(left as (typeof WEEKDAY_ORDER)[number]) -
    WEEKDAY_ORDER.indexOf(right as (typeof WEEKDAY_ORDER)[number])
  );
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return stableStringify(left) === stableStringify(right);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value);
}
