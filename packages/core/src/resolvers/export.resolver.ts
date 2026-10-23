import type { ExportPageData, ExportSummaryCounts } from "../types/export";
import { sha256 } from "../hash";

import { Temporal } from "@js-temporal/polyfill";

import behaviorLogSchema from "../behaviorlog.schema.json";

import type {
  BehaviorLogBundle,
  BehaviorLogFile,
  ExportBehaviorDefinitionEventInput,
  ExportBehaviorConfigurationEventInput,
  ExportBehaviorInput,
  ExportBundle,
  ExportCategoryInput,
  ExportDateRange,
  ExportJsonBackup,
  ExportJsonBehavior,
  ExportJsonBehaviorDefinitionEvent,
  ExportJsonBehaviorConfigurationEvent,
  ExportJsonBehaviorConfigurationSnapshot,
  ExportJsonCategory,
  ExportJsonOccurrence,
  ExportJsonStatusEvent,
  ExportJsonTimeSession,
  ExportOccurrenceInput,
  ExportProfileInput,
  ExportRangeKey,
  ExportRangeOption,
  ExportReminderDeliveryInput,
  ExportNativeReminderInput,
  ExportStatusCounts,
  ExportStatusEventInput,
  ExportTimeSessionInput,
  ExportImportedHistory,
} from "../types/export";
import { DEFAULT_TIMEZONE } from "../types/recurrence";
import type { BehaviorWhereKind } from "../types/behavior";
import { BEHAVIOR_CONFIGURATION_CHANGED_FIELDS } from "../types/behavior-configuration-event";
import { isBehaviorLogScheduleBoundary } from "./behavior-configuration.resolver";
import {
  formatRecordedDuration,
  resolveOccurrenceTimeTracking,
} from "./time-tracking.resolver";

const BEHAVIORLOG_SCHEMA_VERSION = "0.3.0-draft";
const BEHAVIORLOG_FORMAT = "behaviorlog.bundle";
const BEHAVIORLOG_EXTENSION_NAMESPACE = "app.cadence";
const BEHAVIORLOG_DEFINITION_HISTORY_PATH =
  "data/behavior_definition_events.jsonl";
const BEHAVIORLOG_CONFIGURATION_HISTORY_PATH =
  "raw/cadence/behavior_configuration_events.jsonl";
const BEHAVIORLOG_PORTABLE_CONFIGURATION_HISTORY_PATH = "data/behavior_configuration_events.jsonl";
const BEHAVIORLOG_TIME_SESSIONS_PATH = "data/time_sessions.jsonl";
const BEHAVIORLOG_INTERVENTION_RULES_PATH =
  "data/intervention_rules.jsonl";
const BEHAVIORLOG_GENERATION_RULE_ID = "rule_recurrence_calendar_simple_v1";
const BEHAVIOR_DEFINITION_CHANGED_FIELDS = ["title", "description"] as const;
const BEHAVIORLOG_BEHAVIOR_CSV_COLUMNS = [
  "record_type",
  "behavior_id",
  "title",
  "description",
  "category",
  "success_definition",
  "expected_duration_minutes",
  "created_at_utc",
  "archived_at_utc",
  "source",
  "sensitivity",
  "extensions",
] as const;
const BEHAVIORLOG_SCHEDULE_CSV_COLUMNS = [
  "record_type",
  "schedule_id",
  "behavior_id",
  "recurrence_profile",
  "recurrence",
  "timezone",
  "local_time",
  "window_start_local",
  "window_end_local",
  "active_from_local_date",
  "active_until_local_date",
  "anchor_local_date",
  "effective_from_utc",
  "effective_until_utc",
  "schedule_role",
  "schedule_group_id",
  "source",
  "extensions",
] as const;
const BEHAVIORLOG_OCCURRENCE_CSV_COLUMNS = [
  "record_type",
  "occurrence_id",
  "behavior_id",
  "schedule_id",
  "scheduled_for_utc",
  "local_date",
  "local_time",
  "timezone",
  "utc_offset_at_event",
  "due_window_start_utc",
  "due_window_end_utc",
  "generated_at_utc",
  "generation_rule_id",
  "occurrence_state",
  "current_status",
  "configuration_event_id",
  "source",
  "extensions",
] as const;
const BEHAVIORLOG_STATUS_EVENT_CSV_COLUMNS = [
  "record_type",
  "event_id",
  "occurrence_id",
  "behavior_id",
  "previous_status",
  "status",
  "status_semantics",
  "recorded_at_utc",
  "effective_at_utc",
  "local_date",
  "timezone",
  "utc_offset_at_event",
  "actor",
  "source",
  "note_id",
  "revises_event_id",
  "reason_code",
  "extensions",
] as const;

export const EXPORT_RANGE_OPTIONS: ExportRangeOption[] = [
  { key: "7", label: "7 days" },
  { key: "30", label: "30 days" },
  { key: "90", label: "90 days" },
  { key: "all", label: "All time" },
];
export const EXPORT_DEFAULT_RANGE_KEY: ExportRangeKey = "30";

const CSV_COLUMNS = [
  "local_date",
  "scheduled_for",
  "schedule",
  "behavior_title",
  "category",
  "status",
  "status_marked_at",
  "note",
] as const;
const TIME_TRACKING_CSV_COLUMNS = [
  ...CSV_COLUMNS,
  "tracked_duration_seconds",
  "time_session_count",
  "time_sessions",
] as const;
type AppCsvColumn = (typeof CSV_COLUMNS)[number];
const APP_CSV_FORMULA_NEUTRALIZED_COLUMNS = new Set<AppCsvColumn>([
  "behavior_title",
  "category",
  "note",
]);
const BEHAVIORLOG_CSV_FORMULA_NEUTRALIZED_COLUMNS = new Set([
  "title",
  "description",
  "category",
  "success_definition",
  "reason_code",
]);

export type ResolveExportInput = ExportImportedHistory & {
  profile: ExportProfileInput;
  categories: ExportCategoryInput[];
  behaviors: ExportBehaviorInput[];
  behaviorDefinitionEvents?: ExportBehaviorDefinitionEventInput[];
  behaviorConfigurationEvents?: ExportBehaviorConfigurationEventInput[];
  occurrences: ExportOccurrenceInput[];
  statusEvents?: ExportStatusEventInput[];
  reminderDeliveries?: ExportReminderDeliveryInput[];
  nativeReminders?: ExportNativeReminderInput[];
  now: Temporal.Instant;
  timezone?: string;
  range?: string | number | null;
  includeArchived?: boolean;
  includeNotes?: boolean;
  includeTimeTracking?: boolean;
  timeSessions?: ExportTimeSessionInput[];
};

export function resolveExportBundle(input: ResolveExportInput): ExportBundle {
  const timezone = input.timezone || input.profile.timezone || DEFAULT_TIMEZONE;
  const includeArchived = input.includeArchived ?? false;
  const includeNotes = input.includeNotes ?? false;
  const includeTimeTracking = input.includeTimeTracking ?? false;
  const range = resolveExportDateRange({
    now: input.now,
    timezone,
    range: input.range,
  });
  const exportedAt = formatInstantInTimezone(input.now, timezone);
  const categories = toJsonCategories(input.categories);
  const includedBehaviors = input.behaviors
    .filter((behavior) => includeArchived || behavior.active)
    .sort(compareBehaviors);
  const behaviorById = new Map(
    includedBehaviors.map((behavior) => [behavior.id, behavior]),
  );
  const behaviors = includedBehaviors.map((behavior) =>
    toJsonBehavior(behavior, includeNotes),
  );
  const behaviorDefinitionEvents = toJsonBehaviorDefinitionEvents({
    behaviorDefinitionEvents: input.behaviorDefinitionEvents ?? [],
    behaviorById,
  });
  const behaviorConfigurationEvents = toJsonBehaviorConfigurationEvents({
    behaviorConfigurationEvents: input.behaviorConfigurationEvents ?? [],
    behaviorById,
  });
  const behaviorConfigurationEventById = new Map(
    behaviorConfigurationEvents.map((event) => [event.id, event]),
  );
  const retainedHistory = retainedBehaviorLogHistory(input, { behaviorConfigurationEvents, behaviors, categories, profile: input.profile });
  const includedOccurrences = input.occurrences
    .filter((occurrence) => behaviorById.has(occurrence.behaviorId))
    .filter((occurrence) => isOccurrenceWithinRange(occurrence, range))
    .sort((left, right) => compareOccurrences(left, right, behaviorById))
    .map((occurrence) => {
      const retained = retainedHistory.occurrences.get(occurrence.id);
      return retained && !occurrence.behaviorConfigurationEventId && retained.localDate === occurrence.localDate &&
        Temporal.Instant.compare(retained.scheduledForUtc, occurrence.scheduledFor) === 0
        ? { ...occurrence, timezone: retained.timezone, behaviorConfigurationEventId: retained.configurationEventId }
        : occurrence;
    });
  const occurrences = includedOccurrences.map((occurrence) =>
      toJsonOccurrence({
        occurrence,
        behaviorById,
        behaviorConfigurationEventById,
        includeNotes,
      }),
    );
  const legacySnapshotOccurrences = includedOccurrences.map((occurrence) =>
    toJsonOccurrence({
      occurrence,
      behaviorById,
      behaviorConfigurationEventById: new Map(),
      includeNotes,
    }),
  );
  const overallCounts = countOccurrences(occurrences);
  const timeSessions = includeTimeTracking
    ? toJsonTimeSessions({
        timeSessions: input.timeSessions ?? [],
        occurrences,
      })
    : [];
  const statusEvents = toJsonStatusEvents({
    statusEvents: input.statusEvents ?? [],
    occurrences,
  });
  const fileBaseName = [
    "cadence-export",
    range.key === "all" ? "all-time" : `${range.key}-days`,
    range.endLocalDate,
    includeArchived ? "with-archived" : null,
    includeTimeTracking ? "with-time-tracking" : null,
  ]
    .filter(Boolean)
    .join("-");
  const jsonBackup = toJsonBackup({
    exportedAt,
    profile: input.profile,
    categories,
    behaviors,
    occurrences,
    statusEvents,
    behaviorDefinitionEvents,
    behaviorConfigurationEvents,
    timeSessions: includeTimeTracking ? timeSessions : undefined,
  });
  const behaviorLog = toBehaviorLogBundle({
    categories,
    exportedAtInstant: input.now,
    fileBaseName,
    profile: input.profile,
    behaviors,
    behaviorDefinitionEvents,
    behaviorConfigurationEvents,
    useConfigurationHistory: input.behaviorConfigurationEvents !== undefined,
    occurrences,
    statusEvents: input.statusEvents ?? [],
    reminderDeliveries: input.reminderDeliveries ?? [],
    nativeReminders: input.nativeReminders ?? [],
    timeSessions,
    includeTimeTracking,
    importedNotes: includeNotes ? input.importedNotes ?? [] : [],
    importedInterventions: input.importedInterventions ?? [],
    importRuns: input.importRuns ?? [],
    importMappings: input.importMappings ?? [],
  });

  return {
    timezone,
    exportedAt,
    includeArchived,
    includeNotes,
    includeTimeTracking,
    range,
    rangeOptions: [...EXPORT_RANGE_OPTIONS],
    categoryCount: categories.length,
    behaviorCount: behaviors.length,
    occurrenceCount: occurrences.length,
    behaviorConfigurationEventCount: behaviorConfigurationEvents.length,
    ...(includeTimeTracking ? { timeSessionCount: timeSessions.length } : {}),
    overallCounts,
    overallAdherenceLabel: formatAdherenceValue(overallCounts),
    jsonl: toJsonl({
      categories,
      behaviors,
      occurrences: legacySnapshotOccurrences,
      timeSessions,
    }),
    csv: toCsv(
      legacySnapshotOccurrences,
      timeSessions,
      includeTimeTracking,
    ),
    jsonBackup,
    json: JSON.stringify(jsonBackup, null, 2),
    markdownSummary: toMarkdownSummary({
      categories,
      range,
      counts: overallCounts,
      behaviors,
      behaviorDefinitionEvents,
      behaviorConfigurationEvents,
      occurrences,
      statusEvents,
      includeArchived,
      includeNotes,
      includeTimeTracking,
      timeSessions,
    }),
    fileBaseName,
    markdownFileName: `${fileBaseName}-summary.md`,
    behaviorLog,
  };
}

export function resolveExportDateRange(input: {
  now: Temporal.Instant;
  timezone?: string;
  range?: string | number | null;
}): ExportDateRange {
  const timezone = input.timezone || DEFAULT_TIMEZONE;
  const key = normalizeExportRangeKey(input.range);
  const endDate = input.now.toZonedDateTimeISO(timezone).toPlainDate();

  if (key === "all") {
    return {
      key,
      label: "All time",
      startLocalDate: null,
      endLocalDate: endDate.toString(),
      summaryLabel: "all saved occurrences, including future records",
    };
  }

  const rangeDays = Number(key);
  const startDate = endDate.subtract({ days: rangeDays - 1 });

  return {
    key,
    label: `${rangeDays} days`,
    startLocalDate: startDate.toString(),
    endLocalDate: endDate.toString(),
    summaryLabel: `${startDate.toString()} to ${endDate.toString()}`,
  };
}

export function exportReadEndLocalDate(range: ExportDateRange): string {
  return range.key === "all" ? "9999-12-31" : range.endLocalDate;
}

export function normalizeExportRangeKey(
  value: string | number | null | undefined,
): ExportRangeKey {
  const rawValue =
    typeof value === "number" ? String(Math.trunc(value)) : value?.trim();

  if (rawValue === "7" || rawValue === "30" || rawValue === "90") {
    return rawValue;
  }

  if (rawValue === "all" || rawValue === "all_time") {
    return "all";
  }

  return EXPORT_DEFAULT_RANGE_KEY;
}

function toJsonCategories(
  categories: ExportCategoryInput[],
): ExportJsonCategory[] {
  return [...categories]
    .sort((left, right) => {
      const sortOrderComparison = left.sortOrder - right.sortOrder;

      if (sortOrderComparison !== 0) {
        return sortOrderComparison;
      }

      return left.name.localeCompare(right.name);
    })
    .map((category) => ({
      id: category.id,
      name: category.name,
      sort_order: category.sortOrder,
      ...(category.description ? { description: category.description } : {}),
      created_at: category.createdAt,
      updated_at: category.updatedAt,
    }));
}

// Inputs written before Ticket 215 carry only location text, which meant A place.
function exportWhereKind(input: {
  whereKind?: BehaviorWhereKind | null;
  locationText?: string | null;
}): BehaviorWhereKind | null {
  return input.whereKind === undefined ? (input.locationText ? "place" : null) : input.whereKind;
}

function toJsonBehavior(
  behavior: ExportBehaviorInput,
  includeNotes: boolean,
): ExportJsonBehavior {
  return {
    id: behavior.id,
    category_id: behavior.categoryId,
    category: behavior.categoryName,
    title: behavior.title,
    description: behavior.description,
    where_kind: exportWhereKind(behavior),
    location_text: behavior.locationText ?? null,
    recurrence_rule: behavior.recurrenceRule,
    scheduled_time: behavior.scheduledTime,
    schedules: normalizeExportInputSchedules(behavior),
    schedule_slots: behavior.scheduleSlots,
    timezone: behavior.timezone,
    browser_reminder_enabled: behavior.browserReminderEnabled,
    email_reminder_enabled: behavior.emailReminderEnabled,
    reminder_offset_minutes: behavior.reminderOffsetMinutes,
    active: behavior.active,
    archived_at: behavior.archivedAt,
    ...(behavior.archiveNotes
      ? {
          archive_notes: behavior.archiveNotes.map((entry) => ({
            id: entry.id,
            archived_at: entry.archivedAt,
            note: includeNotes ? entry.note : null,
            updated_at: entry.updatedAt,
          })),
        }
      : {}),
    ...(behavior.defaultDurationMinutes === undefined
      ? {}
      : { default_duration_minutes: behavior.defaultDurationMinutes }),
    ...(behavior.endDate === undefined ? {} : { end_date: behavior.endDate }),
    ...(behavior.autoArchivedAt === undefined
      ? {}
      : { auto_archived_at: behavior.autoArchivedAt }),
    created_at: behavior.createdAt,
    updated_at: behavior.updatedAt,
  };
}

function toJsonBehaviorDefinitionEvents(input: {
  behaviorDefinitionEvents: ExportBehaviorDefinitionEventInput[];
  behaviorById: Map<string, ExportBehaviorInput>;
}): ExportJsonBehaviorDefinitionEvent[] {
  return input.behaviorDefinitionEvents
    .filter((event) => input.behaviorById.has(event.behaviorId))
    .sort(compareBehaviorDefinitionEvents)
    .map((event) => ({
      id: event.id,
      behavior_id: event.behaviorId,
      previous_title: event.previousTitle,
      next_title: event.nextTitle,
      previous_description: event.previousDescription,
      next_description: event.nextDescription,
      changed_fields: BEHAVIOR_DEFINITION_CHANGED_FIELDS.filter((field) =>
        event.changedFields.includes(field),
      ),
      recorded_at: formatUtc(event.recordedAt),
      source: event.source,
      reason: event.reason,
      created_at: event.createdAt,
      updated_at: event.updatedAt,
    }));
}

function toJsonBehaviorConfigurationEvents(input: {
  behaviorConfigurationEvents: ExportBehaviorConfigurationEventInput[];
  behaviorById: Map<string, ExportBehaviorInput>;
}): ExportJsonBehaviorConfigurationEvent[] {
  return input.behaviorConfigurationEvents
    .filter((event) => input.behaviorById.has(event.behaviorId))
    .sort(compareBehaviorConfigurationEvents)
    .map((event) => ({
      id: event.id,
      behavior_id: event.behaviorId,
      event_kind: event.eventKind,
      previous_configuration: event.previousConfiguration
        ? toJsonBehaviorConfigurationSnapshot(event.previousConfiguration)
        : null,
      next_configuration: toJsonBehaviorConfigurationSnapshot(
        event.nextConfiguration,
      ),
      changed_fields: BEHAVIOR_CONFIGURATION_CHANGED_FIELDS.filter((field) =>
        event.changedFields.includes(field),
      ),
      recorded_at: formatUtc(event.recordedAt),
      effective_at: formatUtc(event.effectiveAt),
      effective_local_date: event.effectiveLocalDate,
      timezone: event.timezone,
      source: event.source,
      reason_code: event.reasonCode,
      created_at: event.createdAt,
    }));
}

function toJsonBehaviorConfigurationSnapshot(
  snapshot: ExportBehaviorConfigurationEventInput["nextConfiguration"],
): ExportJsonBehaviorConfigurationSnapshot {
  return {
    category_id: snapshot.categoryId,
    location_text: snapshot.locationText ?? null,
    where_kind: exportWhereKind(snapshot),
    schedule_graph: snapshot.scheduleGraph.map((schedule) => ({
      recurrence_rule: schedule.recurrenceRule,
      sort_order: schedule.sortOrder,
      time_entries: schedule.timeEntries.map((entry) => ({
        kind: entry.kind,
        preset: entry.preset,
        start_time: entry.startTime,
        end_time: entry.endTime,
        sort_order: entry.sortOrder,
      })),
    })),
    browser_reminder_enabled: snapshot.browserReminderEnabled,
    email_reminder_enabled: snapshot.emailReminderEnabled,
    reminder_offset_minutes: snapshot.reminderOffsetMinutes,
    active: snapshot.active,
    timezone: snapshot.timezone,
  };
}

function toJsonOccurrence(input: {
  occurrence: ExportOccurrenceInput;
  behaviorById: Map<string, ExportBehaviorInput>;
  behaviorConfigurationEventById: Map<
    string,
    ExportJsonBehaviorConfigurationEvent
  >;
  includeNotes: boolean;
}): ExportJsonOccurrence {
  const {
    occurrence,
    behaviorById,
    behaviorConfigurationEventById,
    includeNotes,
  } = input;
  const behavior = behaviorById.get(occurrence.behaviorId);
  const configurationEvent = occurrence.behaviorConfigurationEventId
    ? behaviorConfigurationEventById.get(
        occurrence.behaviorConfigurationEventId,
      )
    : null;
  const timezone =
    occurrence.timezone ||
    (configurationEvent?.behavior_id === occurrence.behaviorId
      ? configurationEvent.next_configuration.timezone
      : null) ||
    behavior?.timezone ||
    DEFAULT_TIMEZONE;

  return {
    id: occurrence.id,
    behavior_id: occurrence.behaviorId,
    behavior_schedule_slot_id: occurrence.behaviorScheduleSlotId,
    behavior_configuration_event_id:
      occurrence.behaviorConfigurationEventId ?? null,
    behavior_title: behavior?.title ?? "Unknown behavior",
    category: behavior?.categoryName ?? null,
    scheduled_for: formatInstantInTimezone(occurrence.scheduledFor, timezone),
    schedule: occurrence.scheduledTimeLabel,
    schedule_kind: occurrence.scheduleKind,
    schedule_preset: occurrence.schedulePreset,
    schedule_start_time: occurrence.scheduleStartTime,
    schedule_end_time: occurrence.scheduleEndTime,
    local_date: occurrence.localDate,
    timezone,
    status: occurrence.status,
    completed_at: formatOptionalInstantInTimezone(
      occurrence.completedAt,
      timezone,
    ),
    status_marked_at: formatOptionalInstantInTimezone(
      occurrence.statusMarkedAt,
      timezone,
    ),
    note: includeNotes ? occurrence.note : null,
    created_at: occurrence.createdAt,
    updated_at: occurrence.updatedAt,
  };
}

function toJsonBackup(input: {
  exportedAt: string;
  profile: ExportProfileInput;
  categories: ExportJsonCategory[];
  behaviors: ExportJsonBehavior[];
  occurrences: ExportJsonOccurrence[];
  statusEvents: ExportJsonStatusEvent[];
  behaviorDefinitionEvents: ExportJsonBehaviorDefinitionEvent[];
  behaviorConfigurationEvents: ExportJsonBehaviorConfigurationEvent[];
  timeSessions?: ExportJsonTimeSession[];
}): ExportJsonBackup {
  return {
    exported_at: input.exportedAt,
    profile: {
      timezone: input.profile.timezone,
    },
    categories: input.categories,
    behaviors: input.behaviors,
    occurrences: input.occurrences,
    status_events: input.statusEvents,
    behavior_definition_events: input.behaviorDefinitionEvents,
    behavior_configuration_events: input.behaviorConfigurationEvents,
    ...(input.timeSessions ? { time_sessions: input.timeSessions } : {}),
  };
}

function toJsonTimeSessions(input: {
  timeSessions: ExportTimeSessionInput[];
  occurrences: ExportJsonOccurrence[];
}): ExportJsonTimeSession[] {
  const occurrenceById = new Map(
    input.occurrences.map((occurrence) => [occurrence.id, occurrence]),
  );

  return input.timeSessions
    .filter((session) => {
      const occurrence = occurrenceById.get(session.occurrenceId);

      return occurrence?.behavior_id === session.behaviorId;
    })
    .sort((left, right) => {
      const startedAt = Temporal.Instant.compare(
        Temporal.Instant.from(left.startedAt),
        Temporal.Instant.from(right.startedAt),
      );

      return startedAt !== 0 ? startedAt : left.id.localeCompare(right.id);
    })
    .map((session) => ({
      id: session.id,
      occurrence_id: session.occurrenceId,
      behavior_id: session.behaviorId,
      started_at: formatUtc(session.startedAt),
      stopped_at: formatOptionalUtc(session.stoppedAt),
      duration_seconds: session.stoppedAt
        ? resolveOccurrenceTimeTracking([
            {
              id: session.id,
              userId: "export",
              occurrenceId: session.occurrenceId,
              behaviorId: session.behaviorId,
              startedAt: session.startedAt,
              stoppedAt: session.stoppedAt,
            },
          ]).recordedSeconds
        : null,
    }));
}

function toJsonStatusEvents(input: {
  statusEvents: ExportStatusEventInput[];
  occurrences: ExportJsonOccurrence[];
}): ExportJsonStatusEvent[] {
  const occurrenceIds = new Set(
    input.occurrences.map((occurrence) => occurrence.id),
  );

  return input.statusEvents
    .filter((event) => occurrenceIds.has(event.occurrenceId))
    .sort(compareStatusEvents)
    .map((event) => ({
      id: event.id,
      occurrence_id: event.occurrenceId,
      behavior_id: event.behaviorId,
      previous_status: event.previousStatus,
      status: event.status,
      status_semantics: event.statusSemantics,
      recorded_at: formatUtc(event.recordedAt),
      effective_at: formatOptionalUtc(event.effectiveAt),
      local_date: event.localDate,
      timezone: event.timezone,
      source_capture_method: event.sourceCaptureMethod,
      source_confidence: event.sourceConfidence,
      revises_event_id: event.revisesEventId,
      reason_code: event.reasonCode,
      created_at: event.createdAt,
      updated_at: event.updatedAt,
    }));
}

function toJsonl(input: {
  categories: ExportJsonCategory[];
  behaviors: ExportJsonBehavior[];
  occurrences: ExportJsonOccurrence[];
  timeSessions: ExportJsonTimeSession[];
}): string {
  const lines = [
    ...input.categories.map((category) =>
      JSON.stringify({
        type: "category",
        id: category.id,
        name: category.name,
        sort_order: category.sort_order,
      }),
    ),
    ...input.behaviors.map((behavior) =>
      JSON.stringify({
        type: "behavior",
        id: behavior.id,
        behavior_title: behavior.title,
        category: behavior.category,
        description: behavior.description,
        recurrence_rule: behavior.recurrence_rule,
        scheduled_time: behavior.scheduled_time,
        schedules: behavior.schedules,
        schedule_slots: behavior.schedule_slots,
        timezone: behavior.timezone,
        browser_reminder_enabled: behavior.browser_reminder_enabled,
        email_reminder_enabled: behavior.email_reminder_enabled,
        reminder_offset_minutes: behavior.reminder_offset_minutes,
        active: behavior.active,
        archived_at: behavior.archived_at,
      }),
    ),
    ...input.occurrences.map((occurrence) =>
      JSON.stringify({
        type: "occurrence",
        id: occurrence.id,
        behavior_id: occurrence.behavior_id,
        behavior_schedule_slot_id: occurrence.behavior_schedule_slot_id,
        local_date: occurrence.local_date,
        scheduled_for: occurrence.scheduled_for,
        schedule: occurrence.schedule,
        schedule_kind: occurrence.schedule_kind,
        schedule_preset: occurrence.schedule_preset,
        schedule_start_time: occurrence.schedule_start_time,
        schedule_end_time: occurrence.schedule_end_time,
        behavior_title: occurrence.behavior_title,
        category: occurrence.category,
        status: occurrence.status,
        status_marked_at: occurrence.status_marked_at,
        note: occurrence.note,
      }),
    ),
    ...input.timeSessions.map((session) =>
      JSON.stringify({
        type: "time_session",
        id: session.id,
        occurrence_id: session.occurrence_id,
        behavior_id: session.behavior_id,
        started_at: session.started_at,
        stopped_at: session.stopped_at,
        duration_seconds: session.duration_seconds,
      }),
    ),
  ];

  return lines.join("\n");
}

function toCsv(
  occurrences: ExportJsonOccurrence[],
  timeSessions: ExportJsonTimeSession[],
  includeTimeTracking: boolean,
): string {
  const sessionsByOccurrenceId = new Map<string, ExportJsonTimeSession[]>();

  for (const session of timeSessions) {
    const sessions = sessionsByOccurrenceId.get(session.occurrence_id) ?? [];
    sessions.push(session);
    sessionsByOccurrenceId.set(session.occurrence_id, sessions);
  }
  const columns = includeTimeTracking ? TIME_TRACKING_CSV_COLUMNS : CSV_COLUMNS;
  const rows = [
    columns.join(","),
    ...occurrences.map((occurrence) => {
      const record: Record<string, string> = {
        local_date: occurrence.local_date,
        scheduled_for: occurrence.scheduled_for,
        schedule: occurrence.schedule,
        behavior_title: occurrence.behavior_title,
        category: occurrence.category ?? "",
        status: occurrence.status,
        status_marked_at: occurrence.status_marked_at ?? "",
        note: occurrence.note ?? "",
      };

      if (includeTimeTracking) {
        const sessions = sessionsByOccurrenceId.get(occurrence.id) ?? [];
        const trackedDurationSeconds = sessions.reduce(
          (total, session) => total + (session.duration_seconds ?? 0),
          0,
        );
        record.tracked_duration_seconds = String(trackedDurationSeconds);
        record.time_session_count = String(sessions.length);
        record.time_sessions = JSON.stringify(sessions);
      }

      return columns.map((column) =>
        escapeCsvCell(
          record[column],
          APP_CSV_FORMULA_NEUTRALIZED_COLUMNS.has(column as AppCsvColumn),
        ),
      ).join(",");
    }),
  ];

  return rows.join("\n");
}

function escapeCsvCell(
  value: string,
  neutralizeFormulaPrefix = false,
): string {
  const spreadsheetSafeValue = neutralizeFormulaPrefix
    ? neutralizeSpreadsheetFormula(value)
    : value;

  if (!/[",\r\n]/.test(spreadsheetSafeValue)) {
    return spreadsheetSafeValue;
  }

  return `"${spreadsheetSafeValue.replaceAll('"', '""')}"`;
}

function neutralizeSpreadsheetFormula(value: string): string {
  return /^\s*[=+\-@]/u.test(value) ? `'${value}` : value;
}

function toBehaviorLogBundle(input: ExportImportedHistory & {
  exportedAtInstant: Temporal.Instant;
  fileBaseName: string;
  profile: ExportProfileInput;
  categories: ExportJsonCategory[];
  behaviors: ExportJsonBehavior[];
  behaviorDefinitionEvents: ExportJsonBehaviorDefinitionEvent[];
  behaviorConfigurationEvents: ExportJsonBehaviorConfigurationEvent[];
  useConfigurationHistory: boolean;
  occurrences: ExportJsonOccurrence[];
  statusEvents: ExportStatusEventInput[];
  reminderDeliveries: ExportReminderDeliveryInput[];
  nativeReminders: ExportNativeReminderInput[];
  timeSessions: ExportJsonTimeSession[];
  includeTimeTracking: boolean;
}): BehaviorLogBundle {
  const schemaContent = `${JSON.stringify(behaviorLogSchema, null, 2)}\n`;
  const readmeContent = createBehaviorLogReadme(input.useConfigurationHistory);
  const agentsContent = createBehaviorLogAgentsMd(
    input.useConfigurationHistory,
  );
  const behaviorRecords = input.behaviors.map((behavior) =>
    toBehaviorLogBehavior(behavior, input.profile),
  );
  const schedules = toBehaviorLogSchedules({
    behaviors: input.behaviors,
    configurationEvents: input.behaviorConfigurationEvents,
    occurrences: input.occurrences,
    useConfigurationHistory: input.useConfigurationHistory,
  });
  const occurrenceRecords = input.occurrences.map((occurrence) =>
    toBehaviorLogOccurrence(occurrence, schedules.scheduleIdByOccurrenceId),
  );
  const statusEventRecords = toBehaviorLogStatusEvents({
    statusEvents: input.statusEvents,
    occurrences: input.occurrences,
    behaviors: input.behaviors,
    importedEventIds: new Set((input.importMappings ?? []).filter((mapping) => mapping.record_type === "status_event").map((mapping) => mapping.local_id)),
  });
  const definitionEventRecords = toBehaviorLogDefinitionEvents(
    input.behaviorDefinitionEvents,
  );
  const timeSessionRecords = toBehaviorLogTimeSessions(input.timeSessions);
  const interventionRuleRecords = toBehaviorLogInterventionRules(input.behaviors, input.profile);
  const interventionRecords: Record<string, unknown>[] = toBehaviorLogInterventions({
    reminderDeliveries: input.reminderDeliveries,
    occurrences: input.occurrences,
    interventionRules: interventionRuleRecords,
  });
  let noteRecords: Record<string, unknown>[] = toBehaviorLogNotes(input.occurrences);
  const retainedHistory = retainedBehaviorLogHistory(input, input);
  const exportCategories = [...new Map([...retainedHistory.categories, ...input.categories].map((category) => [category.id, category])).values()];
  const nativeConfigurationRecords = toBehaviorLogConfigurationEvents({ ...input, categories: exportCategories });
  const includedBehaviorIds = new Set(input.behaviors.map((behavior) => behavior.id));
  const retainedConfigurationRecords = retainedHistory.configurationEvents.filter((event) => includedBehaviorIds.has(String(event.behavior_id)));
  const configurationRecords = [...retainedConfigurationRecords, ...nativeConfigurationRecords]
    .sort((left, right) => String(left.recorded_at_utc).localeCompare(String(right.recorded_at_utc)) || String(left.event_id).localeCompare(String(right.event_id)));
  const occurrenceById = new Map(input.occurrences.map((occurrence) => [occurrence.id, occurrence]));
  const occurrenceIds = new Set(occurrenceById.keys());
  const nativeRecords = input.nativeReminders.filter((row) => occurrenceIds.has(row.occurrenceId))
    .sort((left, right) => Temporal.Instant.compare(left.fireAt, right.fireAt) || left.id.localeCompare(right.id))
    .map((row) => {
      if (!["planned", "scheduled", "cancelled", "failed", "delivered"].includes(row.status)) {
        throw new Error(`Unsupported native reminder state: ${row.status}.`);
      }
      return {
        id: row.id, occurrence_id: row.occurrenceId, request_id: row.requestId,
        fire_at_utc: formatUtc(row.fireAt), state: row.status,
        verified_at_utc: formatOptionalUtc(row.verifiedAt),
        created_at_utc: formatUtc(row.createdAt), updated_at_utc: formatUtc(row.updatedAt),
      };
    });
  if (new Set(nativeRecords.map((row) => row.id)).size !== nativeRecords.length) {
    throw new Error("Native reminder export contains duplicate IDs.");
  }
  for (const row of nativeRecords) {
    const occurrence = occurrenceById.get(row.occurrence_id)!;
    interventionRecords.push({ record_type: "intervention", intervention_id: `native_${row.id}`,
      behavior_id: occurrence.behavior_id, occurrence_id: row.occurrence_id, intervention_type: "reminder", channel: "other",
      planned_for_utc: row.fire_at_utc, delivery_status: row.state === "scheduled" ? "planned" : row.state,
      ...(row.state === "failed" ? { failure_reason: "native_notification_failed" } : {}),
      source: createBehaviorLogSource({ originalId: row.id, captureMethod: "system_generated", confidence: "high",
        transformationNotes: "Native OS scheduling/observation state; user receipt or reading is unverified." }),
      extensions: { [BEHAVIORLOG_EXTENSION_NAMESPACE]: { native_notification: true, request_id: row.request_id,
        native_state: row.state, verified_at_utc: row.verified_at_utc, user_receipt: "unverified" } },
    });
  }
  const behaviorIds = new Set(input.behaviors.map((behavior) => behavior.id));
  const statusEventIds = new Set(statusEventRecords.map((event) => String(event.event_id)));
  const inlineNotes = new Map(noteRecords.map((record) => [String(record.attached_to_id), record]));
  const replacedInlineNoteIds = new Set<unknown>();
  for (const note of input.importedNotes ?? []) {
    const targets = note.target_type === "behavior" ? behaviorIds : note.target_type === "occurrence" ? occurrenceIds : note.target_type === "status_event" ? statusEventIds : null;
    if (!note.target_local_id || !targets?.has(note.target_local_id)) continue;
    const inlineNote = note.target_type === "occurrence" ? inlineNotes.get(note.target_local_id) : undefined;
    if (inlineNote?.body_markdown === note.body_markdown) replacedInlineNoteIds.add(inlineNote.note_id);
    noteRecords.push({ record_type: "note", note_id: note.id, attached_to_type: note.target_type,
      attached_to_id: note.target_local_id, body_markdown: note.body_markdown, note_role: note.note_role,
      created_at_utc: formatUtc(note.imported_created_at), updated_at_utc: formatOptionalUtc(note.imported_updated_at),
      ...(note.sensitivity ? { sensitivity: note.sensitivity } : {}),
      source: { producer: "Imported source", original_id: note.source_original_id,
        capture_method: note.source_capture_method, confidence: note.source_confidence },
    });
  }
  noteRecords = noteRecords.filter((note) => !replacedInlineNoteIds.has(note.note_id));
  for (const row of input.importedInterventions ?? []) {
    if (row.behavior_id && !behaviorIds.has(row.behavior_id)) continue;
    if (row.occurrence_id && !occurrenceIds.has(row.occurrence_id)) continue;
    interventionRecords.push({ record_type: "intervention", intervention_id: row.id,
      behavior_id: row.behavior_id, occurrence_id: row.occurrence_id, intervention_type: row.intervention_type ?? "reminder", channel: row.channel,
      planned_for_utc: formatUtc(row.scheduled_send_at), sent_at_utc: formatOptionalUtc(row.sent_at),
      delivery_status: row.delivery_status === "pending" ? "planned" : row.delivery_status,
      failure_reason: sanitizeInterventionFailureReason(row.failure_reason),
      source: { producer: "Imported source", original_id: row.source_original_id,
        capture_method: row.source_capture_method, confidence: row.source_confidence },
      extensions: { [BEHAVIORLOG_EXTENSION_NAMESPACE]: { passive_imported_history: true } },
    });
  }
  const filesWithoutManifest: BehaviorLogFile[] = [
    {
      path: "schema.json",
      mediaType: "application/json",
      content: schemaContent,
    },
    {
      path: "README.md",
      mediaType: "text/markdown",
      content: readmeContent,
    },
    {
      path: "AGENTS.md",
      mediaType: "text/markdown",
      content: agentsContent,
    },
    {
      path: "data/behaviors.jsonl",
      mediaType: "application/jsonl",
      content: toJsonlRecords(behaviorRecords),
    },
    {
      path: "data/schedules.jsonl",
      mediaType: "application/jsonl",
      content: toJsonlRecords(schedules.records),
    },
    {
      path: "data/occurrences.jsonl",
      mediaType: "application/jsonl",
      content: toJsonlRecords(occurrenceRecords),
    },
    {
      path: "data/status_events.jsonl",
      mediaType: "application/jsonl",
      content: toJsonlRecords(statusEventRecords),
    },
  ];

  if (noteRecords.length > 0) {
    filesWithoutManifest.push({
      path: "data/notes.jsonl",
      mediaType: "application/jsonl",
      content: toJsonlRecords(noteRecords),
    });
  }

  if (interventionRecords.length > 0) {
    filesWithoutManifest.push({
      path: "data/interventions.jsonl",
      mediaType: "application/jsonl",
      content: toJsonlRecords(interventionRecords),
    });
  }

  if (interventionRuleRecords.length > 0) {
    filesWithoutManifest.push({
      path: BEHAVIORLOG_INTERVENTION_RULES_PATH,
      mediaType: "application/jsonl",
      content: toJsonlRecords(interventionRuleRecords),
    });
  }

  filesWithoutManifest.push({
    path: BEHAVIORLOG_DEFINITION_HISTORY_PATH,
    mediaType: "application/jsonl",
    content: toJsonlRecords(definitionEventRecords),
  });
  if (input.useConfigurationHistory) {
    filesWithoutManifest.push({ path: BEHAVIORLOG_PORTABLE_CONFIGURATION_HISTORY_PATH,
      mediaType: "application/jsonl", content: toJsonlRecords(configurationRecords) });
    filesWithoutManifest.push({
      path: BEHAVIORLOG_CONFIGURATION_HISTORY_PATH,
      mediaType: "application/jsonl",
      content: toJsonlRecords(
        input.behaviorConfigurationEvents.map(toBehaviorLogRawConfigurationEvent),
      ),
    });
  }

  if (input.includeTimeTracking) {
    filesWithoutManifest.push({
      path: BEHAVIORLOG_TIME_SESSIONS_PATH,
      mediaType: "application/jsonl",
      content: toJsonlRecords(timeSessionRecords),
    });
  }

  filesWithoutManifest.push(
    ...toBehaviorLogCsvFiles({
      behaviorRecords,
      scheduleRecords: schedules.records,
      occurrenceRecords,
      statusEventRecords,
    }),
  );

  if (nativeRecords.length > 0) {
    filesWithoutManifest.push({ path: "raw/cadence/native_reminders.jsonl", mediaType: "application/jsonl",
      content: toJsonlRecords(nativeRecords) });
    const readme = filesWithoutManifest.find((file) => file.path === "README.md")!;
    readme.content += "\nNative reminder state is preserved in `raw/cadence/native_reminders.jsonl`. These OS scheduling/observation states do not prove user receipt or reading. The notification title, body, and raw errors are omitted. This extension is export-only.\n";
  }

  const manifestContent = JSON.stringify(
    createBehaviorLogManifest({
      exportedAt: input.exportedAtInstant.toString(),
      profile: input.profile,
      containsNotes:
        noteRecords.length > 0 ||
        input.behaviors.some((behavior) =>
          behavior.archive_notes?.some((entry) => entry.note !== null),
        ),
      nativeReminderCount: nativeRecords.length,
      containsInterventions:
        interventionRecords.length > 0 || interventionRuleRecords.length > 0,
      containsDefinitionHistory: true,
      containsTimeTracking: input.includeTimeTracking,
      behaviorConfigurationEventCount:
        input.behaviorConfigurationEvents.length,
      configurationHistoryIncluded: input.useConfigurationHistory,
      categories: exportCategories,
      files: filesWithoutManifest,
    }),
    null,
    2,
  );

  return {
    fileName: `${input.fileBaseName}.behaviorlog.zip`,
    files: [
      {
        path: "manifest.json",
        mediaType: "application/json",
        content: manifestContent,
      },
      ...filesWithoutManifest,
    ],
  };
}

function toBehaviorLogRawConfigurationEvent(
  event: ExportJsonBehaviorConfigurationEvent,
): Record<string, unknown> {
  // BehaviorLog keeps its pre-Where shape: no place text and no Where.
  const withoutLocation = (snapshot: ExportJsonBehaviorConfigurationSnapshot) => {
    const { location_text: _locationText, where_kind: _whereKind, ...rest } = snapshot;
    void _locationText;
    void _whereKind;
    return rest;
  };
  return {
    ...event,
    previous_configuration: event.previous_configuration
      ? withoutLocation(event.previous_configuration)
      : null,
    next_configuration: withoutLocation(event.next_configuration),
    changed_fields: event.changed_fields.filter((field) => field !== "location_text" && field !== "where_kind"),
  };
}

function createBehaviorLogManifest(input: {
  exportedAt: string;
  profile: ExportProfileInput;
  containsNotes: boolean;
  nativeReminderCount: number;
  containsInterventions: boolean;
  containsDefinitionHistory: boolean;
  containsTimeTracking: boolean;
  behaviorConfigurationEventCount: number;
  configurationHistoryIncluded: boolean;
  files: BehaviorLogFile[];
  categories: ExportJsonCategory[];
}) {
  return {
    format: BEHAVIORLOG_FORMAT,
    schema_version: BEHAVIORLOG_SCHEMA_VERSION,
    exported_at_utc: input.exportedAt,
    producer: {
      name: input.profile.producerName ?? "Cadence Tracker",
      version: input.profile.producerVersion ?? "0.1.0",
      exporter_version: BEHAVIORLOG_SCHEMA_VERSION,
      website: null,
    },
    subject: {
      subject_id: input.profile.subjectId,
      timezone_default: input.profile.timezone,
      locale: input.profile.locale ?? "en-US",
    },
    privacy: {
      redaction_level: "standard_redaction",
      subject_id_strategy: "pseudonymous",
      contains_notes: input.containsNotes,
      contains_context: false,
      contains_raw_location: false,
      contains_health_data: false,
      contains_ai_generated_content: false,
      contains_time_tracking: input.containsTimeTracking,
    },
    profiles: createBehaviorLogProfiles({
      containsInterventions: input.containsInterventions,
      containsDefinitionHistory: input.containsDefinitionHistory,
      containsTimeTracking: input.containsTimeTracking,
      containsConfigurationHistory: input.configurationHistoryIncluded,
    }),
    extensions: {
      [BEHAVIORLOG_EXTENSION_NAMESPACE]: {
        categories: input.categories,
        ...(input.nativeReminderCount > 0 ? { native_reminders: {
          path: "raw/cadence/native_reminders.jsonl", record_count: input.nativeReminderCount,
          ordering: ["fire_at_utc", "id"], import_restore_support: "export_only", user_receipt: "unverified",
        } } : {}),
        ...(input.configurationHistoryIncluded
          ? {
              behavior_configuration_history: {
                path: BEHAVIORLOG_CONFIGURATION_HISTORY_PATH,
                record_count: input.behaviorConfigurationEventCount,
                ordering: ["recorded_at", "id"],
                import_restore_support: "export_only",
              },
            }
          : {}),
      },
    },
    rules: {
      exchange: { fidelity: "partial", losses: [
        { path: "source/uncaptured_history", reason: "Deleted or never-captured history and exact creation times for inline notes cannot be reconstructed." },
        { path: "data/behaviors.jsonl/success_definition", reason: "Cadence generates success definitions from titles; separately authored imported success definitions are not retained." },
        { path: "source/imported_optional_fields", reason: "Imported optional fields, actor details, original source metadata, and unknown vendor extensions not stored by Cadence cannot be reconstructed." },
      ] },
      status_semantics: {
        unresolved:
          "No explicit completion or non-completion decision has been recorded.",
        completed: "The occurrence was explicitly completed.",
        not_completed: "The occurrence was explicitly marked not completed.",
      },
      unresolved_policy: "exclude_from_explicit_adherence",
      day_boundary: "local_midnight",
      definition_history_policy: "event_sourced",
      metric_rules: {
        rule_explicit_adherence_rate_v1: {
          formula: "completed / (completed + not_completed)",
          excludes: ["unresolved", "cancelled_occurrences"],
        },
        rule_resolution_rate_v1: {
          formula: "(completed + not_completed) / eligible_occurrences",
          excludes: ["cancelled_occurrences"],
        },
        rule_scheduled_completion_rate_v1: {
          formula: "completed / eligible_occurrences",
          excludes: ["cancelled_occurrences"],
        },
        rule_unresolved_rate_v1: {
          formula: "unresolved / eligible_occurrences",
          excludes: ["cancelled_occurrences"],
        },
      },
      source_status_mappings: [
        {
          source_status: "completed",
          mapped_status: "completed",
          semantic_confidence: "high",
        },
        {
          source_status: "not_completed",
          mapped_status: "not_completed",
          semantic_confidence: "high",
        },
      ],
    },
    files: input.files.map((file) => ({
      path: file.path,
      media_type: file.mediaType,
      schema_ref: schemaRefForBehaviorLogPath(file.path),
      required: isRequiredBehaviorLogPath(file.path),
      sha256: sha256(file.content),
    })),
  };
}

function createBehaviorLogProfiles(input: {
  containsInterventions: boolean;
  containsDefinitionHistory: boolean;
  containsTimeTracking: boolean;
  containsConfigurationHistory: boolean;
}): string[] {
  return [
    "core",
    input.containsInterventions ? "intervention" : null,
    input.containsDefinitionHistory ? "definition_history" : null,
    input.containsTimeTracking ? "time_tracking" : null,
    input.containsConfigurationHistory ? "configuration_history" : null,
  ].filter((profile): profile is string => profile !== null);
}

function toBehaviorLogBehavior(
  behavior: ExportJsonBehavior,
  profile: ExportProfileInput,
) {
  return omitNullish({
    record_type: "behavior",
    behavior_id: behavior.id,
    title: behavior.title,
    description: behavior.description,
    category: toBehaviorLogCategory(behavior.category),
    success_definition: `Complete ${behavior.title} for each scheduled occurrence.`,
    expected_duration_minutes: behavior.default_duration_minutes ?? null,
    created_at_utc: formatUtc(behavior.created_at),
    archived_at_utc: formatOptionalUtc(behavior.archived_at),
    source: createBehaviorLogSource({
      profile,
      originalId: behavior.id,
      captureMethod: "system_generated",
      confidence: "high",
      transformationNotes: "Title and description are user text; success_definition is generated from the current title, not a separately captured user definition.",
    }),
    sensitivity: isSensitiveCategory(behavior.category) ? "high" : "medium",
    extensions: {
      [BEHAVIORLOG_EXTENSION_NAMESPACE]: {
        category_id: behavior.category_id,
        category_name: behavior.category,
        active: behavior.active,
        browser_reminder_enabled: behavior.browser_reminder_enabled,
        email_reminder_enabled: behavior.email_reminder_enabled,
        reminder_offset_minutes: behavior.reminder_offset_minutes,
        ...(behavior.archive_notes !== undefined
          ? { archive_notes: behavior.archive_notes }
          : {}),
        ...(behavior.end_date !== undefined ? { end_date: behavior.end_date } : {}),
        ...(behavior.auto_archived_at !== undefined
          ? { auto_archived_at: behavior.auto_archived_at }
          : {}),
      },
    },
  });
}

function toBehaviorLogSchedules(input: {
  behaviors: ExportJsonBehavior[];
  configurationEvents: ExportJsonBehaviorConfigurationEvent[];
  occurrences: ExportJsonOccurrence[];
  useConfigurationHistory: boolean;
}) {
  if (!input.useConfigurationHistory) {
    return toLegacyBehaviorLogSchedules(input.behaviors, input.occurrences);
  }

  return toHistoricalBehaviorLogSchedules(input);
}

function toHistoricalBehaviorLogSchedules(input: {
  behaviors: ExportJsonBehavior[];
  configurationEvents: ExportJsonBehaviorConfigurationEvent[];
  occurrences: ExportJsonOccurrence[];
}) {
  const behaviorById = new Map(
    input.behaviors.map((behavior) => [behavior.id, behavior]),
  );
  const eventsByBehaviorId = new Map<
    string,
    ExportJsonBehaviorConfigurationEvent[]
  >();

  for (const event of input.configurationEvents) {
    const events = eventsByBehaviorId.get(event.behavior_id) ?? [];
    events.push(event);
    eventsByBehaviorId.set(event.behavior_id, events);
  }

  const recordsById = new Map<
    string,
    ReturnType<typeof createBehaviorLogSchedule>
  >();
  const periodEventByConfigurationEventId = new Map<
    string,
    ExportJsonBehaviorConfigurationEvent
  >();
  const scheduleIdsByPeriodEventId = new Map<string, string[]>();

  for (const behavior of input.behaviors) {
    const events = [...(eventsByBehaviorId.get(behavior.id) ?? [])].sort(
      compareJsonBehaviorConfigurationEvents,
    );
    const boundaries = events.filter(isBehaviorLogScheduleBoundary);
    const importBoundaryId = behavior.active
      ? [...boundaries]
          .reverse()
          .find((candidate) => candidate.next_configuration.active)?.id
      : boundaries.at(-1)?.id;
    let currentBoundary: ExportJsonBehaviorConfigurationEvent | null = null;

    for (const event of events) {
      if (isBehaviorLogScheduleBoundary(event)) {
        currentBoundary = event;
      }

      if (currentBoundary) {
        periodEventByConfigurationEventId.set(event.id, currentBoundary);
      }
    }

    for (const [boundaryIndex, boundary] of boundaries.entries()) {
      const inactiveCurrentCarrier =
        !boundary.next_configuration.active &&
        boundary.id === importBoundaryId;

      if (!boundary.next_configuration.active && !inactiveCurrentCarrier) {
        continue;
      }

      const nextBoundary = boundaries[boundaryIndex + 1] ?? null;
      const scheduleIds: string[] = [];

      for (const [scheduleIndex, schedule] of
        boundary.next_configuration.schedule_graph.entries()) {
        for (const [entryIndex, entry] of schedule.time_entries.entries()) {
          const scheduleId = scheduleIdForConfigurationPeriod(
            boundary.id,
            scheduleIndex,
            entryIndex,
          );
          scheduleIds.push(scheduleId);
          recordsById.set(
            scheduleId,
            createBehaviorLogSchedule({
              scheduleId,
              behavior,
              recurrenceRule: schedule.recurrence_rule,
              localTime: entry.start_time,
              windowStartLocal:
                entry.kind === "range" ? entry.start_time : null,
              windowEndLocal: entry.kind === "range" ? entry.end_time : null,
              slotId: null,
              scheduleKind: entry.kind,
              schedulePreset: entry.preset,
              scheduleLabel: entry.start_time,
              behaviorScheduleId:
                boundary.id === importBoundaryId
                  ? (behavior.schedules[scheduleIndex]?.id ?? null)
                  : null,
              sourceConfidence: "high",
              timezone: boundary.next_configuration.timezone,
              activeFromLocalDate: boundary.effective_local_date,
              activeUntilLocalDate:
                inactiveCurrentCarrier
                  ? boundary.effective_local_date
                  : nextBoundary
                  ? localDateForInstant(
                      nextBoundary.effective_at,
                      boundary.next_configuration.timezone,
                    )
                  : null,
              configurationEventId: boundary.id,
              effectiveFromUtc: boundary.effective_at,
              effectiveUntilUtc: inactiveCurrentCarrier
                ? boundary.effective_at
                : nextBoundary?.effective_at ?? null,
              scheduleIndex,
              timeEntryIndex: entryIndex,
              configurationActive: boundary.next_configuration.active,
              periodSemantics: inactiveCurrentCarrier
                ? "inactive_current_configuration_carrier"
                : undefined,
              importRole:
                boundary.id === importBoundaryId
                  ? "current_configuration"
                  : "historical_reference_only",
            }),
          );
        }
      }

      scheduleIdsByPeriodEventId.set(boundary.id, scheduleIds);
    }
  }

  const scheduleIdByOccurrenceId = new Map<string, string>();

  for (const occurrence of input.occurrences) {
    const behavior = behaviorById.get(occurrence.behavior_id);
    const configurationEventId =
      occurrence.behavior_configuration_event_id;
    const periodEvent = configurationEventId
      ? periodEventByConfigurationEventId.get(configurationEventId)
      : null;
    const matchedScheduleId = periodEvent
      ? findHistoricalScheduleId({
          occurrence,
          periodEvent,
          scheduleIds: scheduleIdsByPeriodEventId.get(periodEvent.id) ?? [],
        })
      : null;

    if (matchedScheduleId) {
      scheduleIdByOccurrenceId.set(occurrence.id, matchedScheduleId);
      continue;
    }

    const fallbackId = scheduleIdForLegacyOccurrence(occurrence.id);
    scheduleIdByOccurrenceId.set(occurrence.id, fallbackId);

    if (behavior && !recordsById.has(fallbackId)) {
      recordsById.set(
        fallbackId,
        createBehaviorLogLegacyOccurrenceSchedule({
          scheduleId: fallbackId,
          behavior,
          occurrence,
        }),
      );
    }
  }

  return {
    records: Array.from(recordsById.values()).sort((left, right) =>
      left.schedule_id.localeCompare(right.schedule_id),
    ),
    scheduleIdByOccurrenceId,
  };
}

function toLegacyBehaviorLogSchedules(
  behaviors: ExportJsonBehavior[],
  occurrences: ExportJsonOccurrence[],
) {
  const behaviorById = new Map(
    behaviors.map((behavior) => [behavior.id, behavior]),
  );
  const recordsById = new Map<
    string,
    ReturnType<typeof createBehaviorLogSchedule>
  >();
  const scheduleIdByOccurrenceId = new Map<string, string>();

  for (const behavior of behaviors) {
    for (const schedule of normalizeExportSchedules(behavior)) {
      for (const slot of schedule.timeEntries) {
        const scheduleId = scheduleIdForSlot(behavior.id, slot.id);
        recordsById.set(
          scheduleId,
          createBehaviorLogSchedule({
            scheduleId,
            behavior,
            recurrenceRule: schedule.recurrenceRule,
            localTime: slot.startTime,
            windowStartLocal: slot.kind === "range" ? slot.startTime : null,
            windowEndLocal: slot.kind === "range" ? slot.endTime : null,
            slotId: slot.id,
            scheduleKind: slot.kind,
            schedulePreset: slot.preset,
            scheduleLabel: slot.label,
            behaviorScheduleId: schedule.id || null,
            sourceConfidence: "high",
          }),
        );
      }
    }
  }

  for (const occurrence of occurrences) {
    const behavior = behaviorById.get(occurrence.behavior_id);

    if (!behavior) {
      continue;
    }

    const scheduleId = occurrence.behavior_schedule_slot_id
      ? scheduleIdForSlot(behavior.id, occurrence.behavior_schedule_slot_id)
      : scheduleIdForOccurrenceSnapshot(occurrence);
    scheduleIdByOccurrenceId.set(occurrence.id, scheduleId);

    if (!recordsById.has(scheduleId)) {
      recordsById.set(
        scheduleId,
        createBehaviorLogSchedule({
          scheduleId,
          behavior,
          recurrenceRule: recurrenceRuleForOccurrence(behavior, occurrence),
          localTime: occurrence.schedule_start_time,
          windowStartLocal:
            occurrence.schedule_kind === "range"
              ? occurrence.schedule_start_time
              : null,
          windowEndLocal:
            occurrence.schedule_kind === "range"
              ? occurrence.schedule_end_time
              : null,
          slotId: occurrence.behavior_schedule_slot_id,
          scheduleKind: occurrence.schedule_kind,
          schedulePreset: occurrence.schedule_preset,
          scheduleLabel: occurrence.schedule,
          behaviorScheduleId: behaviorScheduleIdForSlot(
            behavior,
            occurrence.behavior_schedule_slot_id,
          ),
          sourceConfidence: occurrence.behavior_schedule_slot_id
            ? "high"
            : "medium",
        }),
      );
    }
  }

  return {
    records: Array.from(recordsById.values()).sort((left, right) =>
      left.schedule_id.localeCompare(right.schedule_id),
    ),
    scheduleIdByOccurrenceId,
  };
}

function normalizeExportSchedules(
  behavior: ExportJsonBehavior,
): ExportJsonBehavior["schedules"] {
  if (behavior.schedules.length > 0) {
    return behavior.schedules;
  }

  return [
    {
      id: "",
      recurrenceRule: behavior.recurrence_rule,
      recurrenceSummary: "",
      recurrenceDefaults: {
        kind: "daily" as const,
        dailyInterval: 1,
        everyDays: 2,
        weeklyInterval: 1,
        weeklyDays: ["monday" as const],
        monthlyInterval: 1,
        monthlyDay: 1,
      },
      timeEntries: behavior.schedule_slots,
      timeSummary: "",
      sortOrder: 0,
    },
  ];
}

function normalizeExportInputSchedules(
  behavior: ExportBehaviorInput,
): ExportJsonBehavior["schedules"] {
  if (behavior.schedules && behavior.schedules.length > 0) {
    return behavior.schedules;
  }

  return [
    {
      id: "",
      recurrenceRule: behavior.recurrenceRule,
      recurrenceSummary: "",
      recurrenceDefaults: {
        kind: "daily" as const,
        dailyInterval: 1,
        everyDays: 2,
        weeklyInterval: 1,
        weeklyDays: ["monday" as const],
        monthlyInterval: 1,
        monthlyDay: 1,
      },
      timeEntries: behavior.scheduleSlots,
      timeSummary: "",
      sortOrder: 0,
    },
  ];
}

function recurrenceRuleForOccurrence(
  behavior: ExportJsonBehavior,
  occurrence: ExportJsonOccurrence,
): ExportJsonBehavior["recurrence_rule"] {
  const schedule = behavior.schedules.find((candidate) =>
    candidate.timeEntries.some(
      (entry) => entry.id === occurrence.behavior_schedule_slot_id,
    ),
  );

  return schedule?.recurrenceRule ?? behavior.recurrence_rule;
}

function behaviorScheduleIdForSlot(
  behavior: ExportJsonBehavior,
  slotId: string | null,
): string | null {
  return (
    behavior.schedules.find((schedule) =>
      schedule.timeEntries.some((entry) => entry.id === slotId),
    )?.id ?? null
  );
}

function findHistoricalScheduleId(input: {
  occurrence: ExportJsonOccurrence;
  periodEvent: ExportJsonBehaviorConfigurationEvent;
  scheduleIds: string[];
}): string | null {
  let flatIndex = 0;

  for (const schedule of input.periodEvent.next_configuration.schedule_graph) {
    for (const entry of schedule.time_entries) {
      const scheduleId = input.scheduleIds[flatIndex] ?? null;
      flatIndex += 1;

      if (
        scheduleId &&
        entry.kind === input.occurrence.schedule_kind &&
        entry.preset === input.occurrence.schedule_preset &&
        entry.start_time === input.occurrence.schedule_start_time &&
        entry.end_time === input.occurrence.schedule_end_time
      ) {
        return scheduleId;
      }
    }
  }

  return null;
}

function createBehaviorLogLegacyOccurrenceSchedule(input: {
  scheduleId: string;
  behavior: ExportJsonBehavior;
  occurrence: ExportJsonOccurrence;
}) {
  return createBehaviorLogSchedule({
    scheduleId: input.scheduleId,
    behavior: input.behavior,
    recurrenceRule: { frequency: "daily", interval: 1 },
    localTime: input.occurrence.schedule_start_time,
    windowStartLocal:
      input.occurrence.schedule_kind === "range"
        ? input.occurrence.schedule_start_time
        : null,
    windowEndLocal:
      input.occurrence.schedule_kind === "range"
        ? input.occurrence.schedule_end_time
        : null,
    slotId: input.occurrence.behavior_schedule_slot_id,
    scheduleKind: input.occurrence.schedule_kind,
    schedulePreset: input.occurrence.schedule_preset,
    scheduleLabel: input.occurrence.schedule,
    behaviorScheduleId: behaviorScheduleIdForSlot(
      input.behavior,
      input.occurrence.behavior_schedule_slot_id,
    ),
    sourceConfidence: "medium",
    timezone: input.occurrence.timezone,
    activeFromLocalDate: input.occurrence.local_date,
    activeUntilLocalDate: input.occurrence.local_date,
    configurationEventId:
      input.occurrence.behavior_configuration_event_id,
    historicalRecurrence: "unknown",
    lineageConfidence: "medium",
    importRole: "historical_reference_only",
  });
}

function createBehaviorLogSchedule(input: {
  scheduleId: string;
  behavior: ExportJsonBehavior;
  recurrenceRule: ExportJsonBehavior["recurrence_rule"];
  localTime: string;
  windowStartLocal: string | null;
  windowEndLocal: string | null;
  slotId: string | null;
  scheduleKind: string;
  schedulePreset: string | null;
  scheduleLabel: string;
  behaviorScheduleId: string | null;
  sourceConfidence: "high" | "medium";
  timezone?: string;
  activeFromLocalDate?: string;
  activeUntilLocalDate?: string | null;
  configurationEventId?: string | null;
  effectiveFromUtc?: string;
  effectiveUntilUtc?: string | null;
  scheduleIndex?: number;
  timeEntryIndex?: number;
  historicalRecurrence?: "unknown";
  lineageConfidence?: "medium";
  importRole?: "current_configuration" | "historical_reference_only";
  configurationActive?: boolean;
  periodSemantics?: "inactive_current_configuration_carrier";
}) {
  return omitNullish({
    record_type: "schedule",
    schedule_id: input.scheduleId,
    behavior_id: input.behavior.id,
    recurrence_profile: "behaviorlog.calendar_simple.v1",
    recurrence: toBehaviorLogRecurrence(input.recurrenceRule),
    timezone: input.timezone ?? input.behavior.timezone,
    local_time: input.localTime,
    window_start_local: input.windowStartLocal,
    window_end_local: input.windowEndLocal,
    active_from_local_date:
      input.activeFromLocalDate ??
      instantToLocalDate(input.behavior.created_at, input.behavior.timezone),
    active_until_local_date:
      input.activeUntilLocalDate !== undefined
        ? input.activeUntilLocalDate
        : input.behavior.archived_at
          ? instantToLocalDate(
              input.behavior.archived_at,
              input.behavior.timezone,
            )
          : null,
    anchor_local_date: instantToLocalDate(input.behavior.created_at, input.timezone ?? input.behavior.timezone),
    effective_from_utc: input.effectiveFromUtc,
    effective_until_utc: input.effectiveUntilUtc,
    schedule_role: input.importRole === "historical_reference_only" ? "historical_reference" : "generating",
    schedule_group_id: input.behaviorScheduleId ?? (input.configurationEventId !== undefined && input.scheduleIndex !== undefined ? `group_${input.configurationEventId}_${input.scheduleIndex}` : undefined),
    source: createBehaviorLogSource({
      originalId:
        input.configurationEventId ?? input.slotId ?? input.scheduleId,
      captureMethod: "system_generated",
      confidence: input.sourceConfidence,
    }),
    extensions: {
      [BEHAVIORLOG_EXTENSION_NAMESPACE]: {
        behavior_schedule_id: input.behaviorScheduleId,
        behavior_schedule_slot_id: input.slotId,
        schedule_kind: input.scheduleKind,
        schedule_preset: input.schedulePreset,
        schedule_label: input.scheduleLabel,
        behavior_configuration_event_id: input.configurationEventId,
        effective_from_utc: input.effectiveFromUtc,
        effective_until_utc: input.effectiveUntilUtc,
        schedule_index: input.scheduleIndex,
        time_entry_index: input.timeEntryIndex,
        historical_recurrence: input.historicalRecurrence,
        lineage_confidence: input.lineageConfidence,
        import_role: input.importRole,
        configuration_active: input.configurationActive,
        period_semantics: input.periodSemantics,
      },
    },
  });
}

function toBehaviorLogOccurrence(
  occurrence: ExportJsonOccurrence,
  scheduleIdByOccurrenceId: Map<string, string>,
) {
  const dueWindow = resolveDueWindow(occurrence);

  return omitNullish({
    record_type: "occurrence",
    occurrence_id: occurrence.id,
    behavior_id: occurrence.behavior_id,
    schedule_id:
      scheduleIdByOccurrenceId.get(occurrence.id) ??
      scheduleIdForOccurrenceSnapshot(occurrence),
    scheduled_for_utc: formatUtc(occurrence.scheduled_for),
    local_date: occurrence.local_date,
    local_time: occurrence.schedule_start_time,
    timezone: timezoneForOccurrence(occurrence),
    utc_offset_at_event: utcOffsetAtEvent(
      occurrence.scheduled_for,
      timezoneForOccurrence(occurrence),
    ),
    due_window_start_utc: dueWindow.start,
    due_window_end_utc: dueWindow.end,
    generated_at_utc: formatOptionalUtc(occurrence.created_at),
    generation_rule_id: BEHAVIORLOG_GENERATION_RULE_ID,
    occurrence_state: "active",
    current_status: occurrence.status,
    configuration_event_id: occurrence.behavior_configuration_event_id ?? undefined,
    source: createBehaviorLogSource({
      originalId: occurrence.id,
      captureMethod: "system_generated",
      confidence: "high",
    }),
    extensions: {
      [BEHAVIORLOG_EXTENSION_NAMESPACE]: {
        schedule: occurrence.schedule,
        schedule_kind: occurrence.schedule_kind,
        schedule_preset: occurrence.schedule_preset,
        schedule_start_time: occurrence.schedule_start_time,
        schedule_end_time: occurrence.schedule_end_time,
        behavior_configuration_event_id:
          occurrence.behavior_configuration_event_id,
        lineage_confidence: occurrence.behavior_configuration_event_id
          ? "high"
          : "medium",
      },
    },
  });
}

function toBehaviorLogStatusEvents(input: {
  statusEvents: ExportStatusEventInput[];
  occurrences: ExportJsonOccurrence[];
  behaviors: ExportJsonBehavior[];
  importedEventIds: Set<string>;
}) {
  const occurrenceById = new Map(
    input.occurrences.map((occurrence) => [occurrence.id, occurrence]),
  );
  const behaviorById = new Map(
    input.behaviors.map((behavior) => [behavior.id, behavior]),
  );
  const explicitEvents = input.statusEvents
    .filter((event) => occurrenceById.has(event.occurrenceId))
    .sort(compareStatusEvents)
    .map((event) => {
      const occurrence = occurrenceById.get(event.occurrenceId);
      const behavior = behaviorById.get(event.behaviorId);
      const imported = input.importedEventIds.has(event.id) || event.sourceCaptureMethod === "imported" ||
        event.statusSemantics === "imported_explicit" || event.statusSemantics === "ambiguous_import";

      return omitNullish({
        record_type: "status_event",
        event_id: event.id,
        occurrence_id: event.occurrenceId,
        behavior_id: event.behaviorId,
        previous_status: event.previousStatus,
        status: event.status,
        status_semantics: event.statusSemantics,
        recorded_at_utc: formatUtc(event.recordedAt),
        effective_at_utc: formatOptionalUtc(event.effectiveAt),
        local_date: event.localDate,
        timezone:
          event.timezone ||
          behavior?.timezone ||
          (occurrence ? timezoneForOccurrence(occurrence) : DEFAULT_TIMEZONE),
        utc_offset_at_event: utcOffsetAtEvent(
          event.recordedAt,
          event.timezone ||
            behavior?.timezone ||
            (occurrence ? timezoneForOccurrence(occurrence) : DEFAULT_TIMEZONE),
        ),
        actor: !imported && ["explicit_user_mark", "explicit_user_correction"].includes(event.statusSemantics) &&
          ["manual_tap", "manual_text"].includes(event.sourceCaptureMethod) ? {
          type: "user",
          id: "subject",
        } : undefined,
        source: createBehaviorLogSource({
          originalId: event.id,
          captureMethod: event.sourceCaptureMethod,
          confidence: event.sourceConfidence,
        }),
        note_id: null,
        revises_event_id: event.revisesEventId,
        reason_code: event.reasonCode,
      });
    });
  const eventOccurrenceIds = new Set(
    input.statusEvents.map((event) => event.occurrenceId),
  );
  const syntheticEvents = input.occurrences
    .filter(
      (occurrence) =>
        occurrence.status !== "unresolved" &&
        !eventOccurrenceIds.has(occurrence.id),
    )
    .map((occurrence) =>
      toSyntheticBehaviorLogStatusEvent(
        occurrence,
        behaviorById.get(occurrence.behavior_id),
      ),
    );

  return [...explicitEvents, ...syntheticEvents].sort((left, right) =>
    String(left.recorded_at_utc).localeCompare(String(right.recorded_at_utc)),
  );
}

function toSyntheticBehaviorLogStatusEvent(
  occurrence: ExportJsonOccurrence,
  behavior: ExportJsonBehavior | undefined,
) {
  const recordedAt =
    occurrence.status_marked_at ??
    occurrence.completed_at ??
    occurrence.updated_at ??
    occurrence.created_at ??
    occurrence.scheduled_for;
  const timezone = behavior?.timezone ?? timezoneForOccurrence(occurrence);

  return omitNullish({
    record_type: "status_event",
    event_id: `evt_${stableId(occurrence.id)}_${occurrence.status}`,
    occurrence_id: occurrence.id,
    behavior_id: occurrence.behavior_id,
    previous_status: "unresolved",
    status: occurrence.status,
    status_semantics: "explicit_user_mark",
    recorded_at_utc: formatUtc(recordedAt),
    effective_at_utc: formatOptionalUtc(
      occurrence.status === "completed"
        ? occurrence.completed_at
        : occurrence.status_marked_at,
    ),
    local_date: occurrence.local_date,
    timezone,
    utc_offset_at_event: utcOffsetAtEvent(recordedAt, timezone),
    actor: {
      type: "user",
      id: "subject",
    },
    source: createBehaviorLogSource({
      originalId: occurrence.id,
      captureMethod: "derived",
      confidence: "medium",
      transformationNotes:
        "Synthesized from the current occurrence status because no status event row was available.",
    }),
    note_id: null,
    revises_event_id: null,
    reason_code: null,
  });
}

function toBehaviorLogDefinitionEvents(
  events: ExportJsonBehaviorDefinitionEvent[],
) {
  const seenBehaviorIds = new Set<string>();

  return events.map((event) => {
    const baseline = !seenBehaviorIds.has(event.behavior_id);
    seenBehaviorIds.add(event.behavior_id);

    return {
      record_type: "behavior_definition_event",
      event_id: event.id,
      behavior_id: event.behavior_id,
      event_kind: baseline ? "baseline" : "revision",
      changed_fields: event.changed_fields,
      previous: baseline
        ? null
        : {
            title: event.previous_title,
            description: event.previous_description,
          },
      next: {
        title: event.next_title,
        description: event.next_description,
      },
      recorded_at_utc: event.recorded_at,
      reason_code: event.reason,
      source: createBehaviorLogSource({
        originalId: event.id,
        captureMethod: behaviorDefinitionCaptureMethod(event.source),
        confidence: "high",
      }),
    };
  });
}

function retainedBehaviorLogHistory(input: ExportImportedHistory, current: Parameters<typeof toBehaviorLogConfigurationEvents>[0]) {
  const configurationEvents = new Map<string, Record<string, unknown>>();
  const exchangedEventIds = new Map<string, string>();
  const categories = new Map<string, ExportJsonCategory>();
  const occurrences = new Map<string, { timezone: string; configurationEventId: string | null; scheduledForUtc: string; localDate: string }>();
  const object = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  const capture = (event: Record<string, unknown>) => JSON.stringify({ ...event, event_id: undefined }, (_key, value) =>
    object(value) ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))) : value);
  for (const run of [...input.importRuns ?? []].filter((row) => row.status === "applied").sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))) {
    const portability = object(object(run.dry_run_summary)?.portability);
    if (portability?.version !== 1) continue;
    for (const value of Array.isArray(portability.categories) ? portability.categories : []) {
      const category = object(value);
      if (!category || typeof category.id !== "string" || typeof category.name !== "string" || !Number.isInteger(category.sort_order)) continue;
      categories.set(category.id, { id: category.id, name: category.name, ...(typeof category.description === "string" ? { description: category.description } : {}), sort_order: Number(category.sort_order),
        ...(typeof category.created_at === "string" ? { created_at: category.created_at } : {}),
        ...(typeof category.updated_at === "string" ? { updated_at: category.updated_at } : {}) });
    }
    const mappings = new Map((input.importMappings ?? []).filter((row) => row.import_run_id === run.id)
      .map((row) => [`${row.record_type}:${row.external_id}`, row.local_id]));
    const local = (type: string, id: unknown) => mappings.get(`${type}:${String(id)}`);
    const eventIds = new Map<string, string>();
    for (const value of Array.isArray(portability.configurationEvents) ? portability.configurationEvents : []) {
      const event = object(value);
      const behaviorId = event && local("behavior", event.behavior_id);
      if (!event || !behaviorId || typeof event.event_id !== "string") continue;
      let id = `cfg_import_${sha256(`${behaviorId}:${event.event_id}`).slice(0, 32)}`;
      const captured = { ...event, behavior_id: behaviorId };
      const existing = configurationEvents.get(id);
      // A source ID may be reused by another ledger. Preserve conflicting captures.
      if (existing && capture(existing) !== capture(captured)) id = `cfg_import_${sha256(`${behaviorId}:${event.event_id}:${capture(captured)}`).slice(0, 32)}`;
      eventIds.set(event.event_id, id);
      exchangedEventIds.set(id, event.event_id);
      configurationEvents.set(id, { ...event, event_id: id, behavior_id: behaviorId });
    }
    for (const value of Array.isArray(portability.occurrences) ? portability.occurrences : []) {
      const occurrence = object(value);
      const id = occurrence && local("occurrence", occurrence.externalId);
      if (!occurrence || !id || typeof occurrence.timezone !== "string" || typeof occurrence.scheduledForUtc !== "string" || typeof occurrence.localDate !== "string") continue;
      occurrences.set(id, { timezone: occurrence.timezone, scheduledForUtc: occurrence.scheduledForUtc, localDate: occurrence.localDate,
        configurationEventId: typeof occurrence.configurationEventId === "string" ? eventIds.get(occurrence.configurationEventId) ?? null : null });
    }
  }
  // A self-export carries our previous generated ID. Only that proven alias,
  // with identical capture content/provenance, identifies the same event again.
  // Resolve after all ledgers so equal import timestamps cannot affect identity.
  const aliases = new Map<string, string>();
  const localEvents = new Map(toBehaviorLogConfigurationEvents({ ...current,
    categories: [...new Map([...categories.values(), ...current.categories].map((category) => [category.id, category])).values()],
  }).map((event) => [event.event_id, event]));
  for (const [id, event] of configurationEvents) {
    const previousId = exchangedEventIds.get(id)!;
    const previous = configurationEvents.get(previousId) ?? localEvents.get(previousId);
    if (previousId !== id && previous && capture(previous) === capture(event)) aliases.set(id, previousId);
  }
  for (const occurrence of occurrences.values()) {
    while (occurrence.configurationEventId && aliases.has(occurrence.configurationEventId)) {
      occurrence.configurationEventId = aliases.get(occurrence.configurationEventId)!;
    }
  }
  return { configurationEvents: [...configurationEvents.values()].filter((event) => !aliases.has(String(event.event_id))), occurrences, categories: [...categories.values()] };
}

function toBehaviorLogConfigurationEvents(input: {
  behaviorConfigurationEvents: ExportJsonBehaviorConfigurationEvent[];
  behaviors: ExportJsonBehavior[];
  categories: ExportJsonCategory[];
  profile: ExportProfileInput;
}) {
  const categories = new Map(input.categories.map((category) => [category.id, category.name]));
  const behaviors = new Map(input.behaviors.map((behavior) => [behavior.id, behavior]));
  const fields = ["category", "schedules", "intervention_rules", "active", "timezone"] as const;
  return input.behaviorConfigurationEvents.map((event) => {
    const behavior = behaviors.get(event.behavior_id)!;
    const snapshot = (value: ExportJsonBehaviorConfigurationSnapshot) => ({
      category: value.category_id ? categories.get(value.category_id) ?? null : null,
      active: value.active, timezone: value.timezone,
      schedules: value.schedule_graph.map((schedule) => ({
        recurrence_profile: "behaviorlog.calendar_simple.v1", recurrence: toBehaviorLogRecurrence(schedule.recurrence_rule),
        anchor_local_date: instantToLocalDate(behavior.created_at, value.timezone),
        time_entries: schedule.time_entries.map((entry) => ({ local_time: entry.start_time,
          window_start_local: entry.kind === "range" ? entry.start_time : null,
          window_end_local: entry.kind === "range" ? entry.end_time : null,
          extensions: { [BEHAVIORLOG_EXTENSION_NAMESPACE]: { preset: entry.preset, sort_order: entry.sort_order } },
        })), extensions: { [BEHAVIORLOG_EXTENSION_NAMESPACE]: { sort_order: schedule.sort_order } },
      })),
      intervention_rules: ([input.profile.reminderChannel ?? "browser_push", "email"] as const).map((channel) => ({
        intervention_type: "reminder", channel, enabled: channel === "email" ? value.email_reminder_enabled : value.browser_reminder_enabled,
        offset_minutes: -value.reminder_offset_minutes, timezone: value.timezone,
        ...(channel === "other" ? { extensions: { [BEHAVIORLOG_EXTENSION_NAMESPACE]: { native_notification: true } } } : {}),
      })),
      extensions: { [BEHAVIORLOG_EXTENSION_NAMESPACE]: { category_id: value.category_id } },
    });
    const previous = event.previous_configuration ? snapshot(event.previous_configuration) : null;
    const next = snapshot(event.next_configuration);
    const changedFields = event.event_kind === "baseline" ? [...fields] : fields.filter((field) => JSON.stringify(previous?.[field]) !== JSON.stringify(next[field]));
    const transformationNotes = [
      [event.previous_configuration, event.next_configuration].some((value) => value?.category_id && !categories.has(value.category_id))
        ? "A historical category label is unavailable. The snapshot category is null; its original category ID remains in extensions." : null,
      changedFields.length === 0 ? `Canonical fields are unchanged after projection. The source revision changed ${event.changed_fields.join(", ")}; captured producer-specific differences remain in snapshot extensions.` : null,
    ].filter(Boolean).join(" ") || undefined;
    return { record_type: "behavior_configuration_event", event_id: event.id, behavior_id: event.behavior_id,
      event_kind: event.event_kind, previous, next, changed_fields: changedFields,
      recorded_at_utc: event.recorded_at, effective_at_utc: event.effective_at, effective_local_date: event.effective_local_date,
      timezone: event.timezone, reason_code: event.reason_code,
      source: createBehaviorLogSource({ originalId: event.id, captureMethod: behaviorDefinitionCaptureMethod(event.source), confidence: "high",
        transformationNotes }),
    };
  });
}

function behaviorDefinitionCaptureMethod(
  source: ExportJsonBehaviorDefinitionEvent["source"],
): "manual_text" | "imported" | "system_generated" {
  switch (source) {
    case "manual":
      return "manual_text";
    case "import":
      return "imported";
    case "system":
      return "system_generated";
  }
}

function toBehaviorLogTimeSessions(sessions: ExportJsonTimeSession[]) {
  return sessions.map((session) => ({
    record_type: "time_session",
    session_id: session.id,
    occurrence_id: session.occurrence_id,
    behavior_id: session.behavior_id,
    started_at_utc: session.started_at,
    stopped_at_utc: session.stopped_at,
  }));
}

function toBehaviorLogInterventionRules(behaviors: ExportJsonBehavior[], profile: ExportProfileInput) {
  return behaviors.flatMap((behavior) =>
    ([profile.reminderChannel ?? "browser_push", "email"] as const)
      .map((channel) => ({
        record_type: "intervention_rule",
        rule_id: interventionRuleId(behavior.id, channel),
        behavior_id: behavior.id,
        intervention_type: "reminder",
        channel,
        enabled: channel === "email" ? behavior.email_reminder_enabled : behavior.browser_reminder_enabled,
        offset_minutes: -behavior.reminder_offset_minutes,
        timezone: behavior.timezone,
        ...(channel === "other" ? { extensions: { [BEHAVIORLOG_EXTENSION_NAMESPACE]: { native_notification: true } } } : {}),
        source: createBehaviorLogSource({
          originalId: behavior.id,
          captureMethod: "system_generated",
          confidence: "high",
        }),
      })),
  );
}

function interventionRuleId(behaviorId: string, channel: string): string {
  return `rule_reminder_${behaviorId}_${channel}`;
}

function toBehaviorLogNotes(occurrences: ExportJsonOccurrence[]) {
  return occurrences
    .filter((occurrence) => occurrence.note)
    .map((occurrence) =>
      omitNullish({
        record_type: "note",
        note_id: noteIdForOccurrence(occurrence.id),
        attached_to_type: "occurrence",
        attached_to_id: occurrence.id,
        body_markdown: occurrence.note,
        note_role: "user",
        created_at_utc: formatUtc(
          occurrence.updated_at ??
            occurrence.status_marked_at ??
            occurrence.created_at ??
            occurrence.scheduled_for,
        ),
        updated_at_utc: null,
        sensitivity: "high",
        source: createBehaviorLogSource({
          originalId: occurrence.id,
          captureMethod: "manual_text",
          confidence: "medium",
          transformationNotes: "Note creation time is approximate: Cadence stores only the occurrence update time, not a separate note creation time.",
        }),
      }),
    );
}

function createBehaviorLogSource(input: {
  profile?: ExportProfileInput;
  originalId: string | null;
  captureMethod:
    | "manual_tap"
    | "manual_text"
    | "system_generated"
    | "imported"
    | "inferred"
    | "derived"
    | "ai_generated"
    | "unknown";
  confidence: "high" | "medium" | "low" | "ambiguous" | "unknown";
  transformationNotes?: string;
}) {
  return omitNullish({
    producer: input.profile?.producerName ?? "Cadence Tracker",
    producer_version: input.profile?.producerVersion ?? "0.1.0",
    original_id: input.originalId,
    capture_method: input.captureMethod,
    imported_from: null,
    confidence: input.confidence,
    transformation_notes: input.transformationNotes ?? null,
  });
}

function toBehaviorLogInterventions(input: {
  reminderDeliveries: ExportReminderDeliveryInput[];
  occurrences: ExportJsonOccurrence[];
  interventionRules: ReturnType<typeof toBehaviorLogInterventionRules>;
}) {
  const occurrenceById = new Map(
    input.occurrences.map((occurrence) => [occurrence.id, occurrence]),
  );
  const rulesById = new Map(input.interventionRules.map((rule) => [rule.rule_id, rule]));

  return [...input.reminderDeliveries]
    .filter((delivery) => occurrenceById.has(delivery.occurrenceId))
    .sort(compareReminderDeliveries)
    .map((delivery) => {
      const occurrence = occurrenceById.get(delivery.occurrenceId)!;
      const ruleId = interventionRuleId(
        occurrence.behavior_id,
        delivery.channel,
      );
      const rule = rulesById.get(ruleId);
      const matchesRule = rule?.enabled && Temporal.Instant.from(occurrence.scheduled_for)
        .add({ minutes: rule.offset_minutes }).equals(Temporal.Instant.from(delivery.scheduledSendAt));

      return omitNullish({
        record_type: "intervention",
        intervention_id: delivery.id,
        behavior_id: occurrence.behavior_id,
        occurrence_id: delivery.occurrenceId,
        intervention_type: "reminder",
        channel: delivery.channel,
        planned_for_utc: formatUtc(delivery.scheduledSendAt),
        sent_at_utc: formatOptionalUtc(delivery.sentAt),
        delivery_status: delivery.status === "pending" ? "planned" : delivery.status,
        failure_reason:
          sanitizeInterventionFailureReason(delivery.error) ?? undefined,
        rule_id: matchesRule ? ruleId : undefined,
        source: createBehaviorLogSource({
          originalId: delivery.id,
          captureMethod: "system_generated",
          confidence: "high",
        }),
        extensions: {
          [BEHAVIORLOG_EXTENSION_NAMESPACE]: omitNullish({
            reminder_delivery_id: delivery.id,
            processing_started_at_utc: formatOptionalUtc(
              delivery.processingStartedAt,
            ),
            created_at_utc: formatOptionalUtc(delivery.createdAt),
            updated_at_utc: formatOptionalUtc(delivery.updatedAt),
          }),
        },
      });
    });
}

function createBehaviorLogReadme(includeConfigurationHistory: boolean): string {
  return [
    "# Cadence BehaviorLog Bundle",
    "",
    "This export contains BehaviorLog core records generated by Cadence Tracker.",
    "",
    "Read `manifest.json` first. JSONL files under `data/` are authoritative.",
    "CSV files under `csv/`, when present, are derived compatibility views and should join back to JSONL records by stable ID.",
    "Behavior title and description revisions are included in the standard `data/behavior_definition_events.jsonl` file.",
    ...(includeConfigurationHistory
      ? [
          "Schedule, reminder, category, active-state, and timezone revisions use the standard `data/behavior_configuration_events.jsonl` file. The legacy `raw/cadence/behavior_configuration_events.jsonl` file remains a Cadence projection.",
        ]
      : []),
    "Time tracking, when selected, is included in the standard `data/time_sessions.jsonl` file.",
  ].join("\n");
}

function createBehaviorLogAgentsMd(
  includeConfigurationHistory: boolean,
): string {
  return [
    "# AGENTS.md",
    "",
    "This is a BehaviorLog Bundle. Read `manifest.json` first, then validate `schema.json`, then inspect files under `data/`.",
    "",
    "## Required reasoning rules",
    "",
    "- Do not treat `unresolved` as `not_completed`.",
    "- Do not use `missed` unless the manifest defines it as a derived label.",
    "- Use `local_date` and `timezone` for day, week, and month analysis.",
    "- Use UTC timestamps for ordering events.",
    "- Prefer `status_events.jsonl` over `current_status` snapshots when analyzing history.",
    "- Use `data/behavior_definition_events.jsonl` to account for behavior renames and description changes. Order revisions by `recorded_at_utc`, then `event_id`.",
    ...(includeConfigurationHistory
      ? [
          "- Use `data/behavior_configuration_events.jsonl` and occurrence `configuration_event_id` for captured configuration history. The raw Cadence projection is optional. Schedule effective UTC bounds are half-open; use `anchor_local_date` for recurrence phase.",
          "- Treat legacy schedules marked `historical_recurrence: unknown` as one-occurrence placeholders, not verified recurrence history.",
          "- Treat before-and-after configuration differences as descriptive. Do not infer causality or clinical guidance from them.",
        ]
      : []),
    "- Treat behavior definition revisions as context. They do not change occurrence status history or adherence calculations.",
    "- Treat files under `csv/` as compatibility views only; JSONL files under `data/` remain authoritative.",
    "- Treat notes as attributed context, not objective fact.",
    "- Report unresolved counts when computing adherence.",
  ].join("\n");
}

function toBehaviorLogRecurrence(rule: ExportJsonBehavior["recurrence_rule"]) {
  switch (rule.frequency) {
    case "daily":
      return rule.interval === 1
        ? { type: "daily", interval: 1 }
        : { type: "every_n_days", interval: rule.interval };
    case "interval_days":
      return { type: "every_n_days", interval: rule.intervalDays };
    case "weekly":
      return rule.interval === 1
        ? { type: "weekly_on_weekdays", weekdays: rule.daysOfWeek }
        : {
            type: "every_n_weeks_on_weekdays",
            interval: rule.interval,
            weekdays: rule.daysOfWeek,
          };
    case "monthly":
      return {
        type: "monthly_on_day",
        interval: rule.interval,
        day: rule.dayOfMonth,
        fallback: "last_day_of_month",
      };
  }
}

function toBehaviorLogCategory(category: string | null): string {
  switch (category) {
    case "Grooming":
      return "hygiene";
    case "Fitness":
      return "fitness";
    case "Food / Drink":
      return "nutrition";
    case "Home":
      return "chores";
    case "Admin":
      return "admin";
    case "Medical":
    case "Measurements":
      return "health_wellness";
    case "Other":
      return "other";
    case null:
      return "uncategorized";
    default:
      return category.trim().length > 0 ? category : "uncategorized";
  }
}

function isSensitiveCategory(category: string | null): boolean {
  return category === "Medical" || category === "Measurements";
}

function resolveDueWindow(occurrence: ExportJsonOccurrence): {
  start: string | null;
  end: string | null;
} {
  if (occurrence.schedule_kind !== "range" || !occurrence.schedule_end_time) {
    return {
      start: null,
      end: null,
    };
  }

  const timezone = timezoneForOccurrence(occurrence);
  const localDate = Temporal.PlainDate.from(occurrence.local_date);
  const startTime = Temporal.PlainTime.from(occurrence.schedule_start_time);
  const endTime = Temporal.PlainTime.from(occurrence.schedule_end_time);
  const endDate =
    Temporal.PlainTime.compare(endTime, startTime) <= 0
      ? localDate.add({ days: 1 })
      : localDate;

  return {
    start: plainDateTimeToInstant(localDate, startTime, timezone).toString(),
    end: plainDateTimeToInstant(endDate, endTime, timezone).toString(),
  };
}

function plainDateTimeToInstant(
  date: Temporal.PlainDate,
  time: Temporal.PlainTime,
  timezone: string,
): Temporal.Instant {
  return date.toPlainDateTime(time).toZonedDateTime(timezone).toInstant();
}

function instantToLocalDate(
  value: string | null | undefined,
  timezone: string,
): string {
  const instant = value
    ? Temporal.Instant.from(value)
    : Temporal.Instant.from("1970-01-01T00:00:00Z");

  return instant
    .toZonedDateTimeISO(timezone || DEFAULT_TIMEZONE)
    .toPlainDate()
    .toString();
}

function localDateForInstant(value: string, timezone: string): string {
  return Temporal.Instant.from(value)
    .toZonedDateTimeISO(timezone || DEFAULT_TIMEZONE)
    .toPlainDate()
    .toString();
}

function timezoneForOccurrence(occurrence: ExportJsonOccurrence): string {
  return occurrence.timezone || DEFAULT_TIMEZONE;
}

function utcOffsetAtEvent(value: string, timezone: string): string {
  return Temporal.Instant.from(value).toZonedDateTimeISO(
    timezone || DEFAULT_TIMEZONE,
  ).offset;
}

function formatUtc(
  value: string | Temporal.Instant | null | undefined,
): string {
  if (!value) {
    return Temporal.Instant.from("1970-01-01T00:00:00Z").toString();
  }

  return (
    typeof value === "string" ? Temporal.Instant.from(value) : value
  ).toString();
}

function formatOptionalUtc(value: string | null | undefined): string | null {
  return value ? Temporal.Instant.from(value).toString() : null;
}

function schemaRefForBehaviorLogPath(path: string): string | null {
  switch (path) {
    case "data/behaviors.jsonl":
      return "#/$defs/Behavior";
    case "data/schedules.jsonl":
      return "#/$defs/Schedule";
    case "data/occurrences.jsonl":
      return "#/$defs/Occurrence";
    case "data/status_events.jsonl":
      return "#/$defs/StatusEvent";
    case "data/notes.jsonl":
      return "#/$defs/Note";
    case "data/interventions.jsonl":
      return "#/$defs/Intervention";
    case "data/intervention_rules.jsonl":
      return "#/$defs/InterventionRule";
    case "data/behavior_definition_events.jsonl":
      return "#/$defs/BehaviorDefinitionEvent";
    case "data/behavior_configuration_events.jsonl":
      return "#/$defs/BehaviorConfigurationEvent";
    case "data/time_sessions.jsonl":
      return "#/$defs/TimeSession";
    default:
      return null;
  }
}

function isRequiredBehaviorLogPath(path: string): boolean {
  return [
    "schema.json",
    "README.md",
    "AGENTS.md",
    "data/behaviors.jsonl",
    "data/schedules.jsonl",
    "data/occurrences.jsonl",
    "data/status_events.jsonl",
  ].includes(path);
}

function scheduleIdForSlot(behaviorId: string, slotId: string | null): string {
  return `sch_${stableId(slotId ?? behaviorId)}`;
}

function scheduleIdForOccurrenceSnapshot(
  occurrence: Pick<
    ExportJsonOccurrence,
    | "behavior_id"
    | "schedule_kind"
    | "schedule_preset"
    | "schedule_start_time"
    | "schedule_end_time"
  >,
): string {
  return `sch_${stableId(
    [
      occurrence.behavior_id,
      occurrence.schedule_kind,
      occurrence.schedule_preset ?? "exact",
      occurrence.schedule_start_time,
      occurrence.schedule_end_time ?? "none",
    ].join("_"),
  )}`;
}

function scheduleIdForConfigurationPeriod(
  configurationEventId: string,
  scheduleIndex: number,
  timeEntryIndex: number,
): string {
  return `sch_${stableId(configurationEventId)}_${scheduleIndex}_${timeEntryIndex}`;
}

function scheduleIdForLegacyOccurrence(occurrenceId: string): string {
  return `sch_legacy_${stableId(occurrenceId)}`;
}

function noteIdForOccurrence(occurrenceId: string): string {
  return `note_${stableId(occurrenceId)}`;
}

function stableId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "_");
}

function toJsonlRecords(records: unknown[]): string {
  return records.map((record) => JSON.stringify(record)).join("\n");
}

function toBehaviorLogCsvFiles(input: {
  behaviorRecords: Record<string, unknown>[];
  scheduleRecords: Record<string, unknown>[];
  occurrenceRecords: Record<string, unknown>[];
  statusEventRecords: Record<string, unknown>[];
}): BehaviorLogFile[] {
  return [
    {
      path: "csv/behaviors.csv",
      mediaType: "text/csv",
      content: toBehaviorLogCsv(
        BEHAVIORLOG_BEHAVIOR_CSV_COLUMNS,
        input.behaviorRecords,
      ),
    },
    {
      path: "csv/schedules.csv",
      mediaType: "text/csv",
      content: toBehaviorLogCsv(
        BEHAVIORLOG_SCHEDULE_CSV_COLUMNS,
        input.scheduleRecords,
      ),
    },
    {
      path: "csv/occurrences.csv",
      mediaType: "text/csv",
      content: toBehaviorLogCsv(
        BEHAVIORLOG_OCCURRENCE_CSV_COLUMNS,
        input.occurrenceRecords,
      ),
    },
    {
      path: "csv/status_events.csv",
      mediaType: "text/csv",
      content: toBehaviorLogCsv(
        BEHAVIORLOG_STATUS_EVENT_CSV_COLUMNS,
        input.statusEventRecords,
      ),
    },
  ];
}

function toBehaviorLogCsv(
  columns: readonly string[],
  records: Record<string, unknown>[],
): string {
  return [
    columns.join(","),
    ...records.map((record) =>
      columns
        .map((column) =>
          escapeCsvCell(
            formatCsvValue(record[column]),
            BEHAVIORLOG_CSV_FORMULA_NEUTRALIZED_COLUMNS.has(column),
          ),
        )
        .join(","),
    ),
  ].join("\n");
}

function formatCsvValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return JSON.stringify(value);
}


function compareBehaviorDefinitionEvents(
  left: ExportBehaviorDefinitionEventInput,
  right: ExportBehaviorDefinitionEventInput,
): number {
  const recordedComparison = Temporal.Instant.compare(
    Temporal.Instant.from(left.recordedAt),
    Temporal.Instant.from(right.recordedAt),
  );

  if (recordedComparison !== 0) {
    return recordedComparison;
  }

  return left.id.localeCompare(right.id);
}

function compareBehaviorConfigurationEvents(
  left: ExportBehaviorConfigurationEventInput,
  right: ExportBehaviorConfigurationEventInput,
): number {
  const recordedComparison = Temporal.Instant.compare(
    Temporal.Instant.from(left.recordedAt),
    Temporal.Instant.from(right.recordedAt),
  );

  return recordedComparison !== 0
    ? recordedComparison
    : left.id.localeCompare(right.id);
}

function compareJsonBehaviorConfigurationEvents(
  left: ExportJsonBehaviorConfigurationEvent,
  right: ExportJsonBehaviorConfigurationEvent,
): number {
  const recordedComparison = Temporal.Instant.compare(
    Temporal.Instant.from(left.recorded_at),
    Temporal.Instant.from(right.recorded_at),
  );

  return recordedComparison !== 0
    ? recordedComparison
    : left.id.localeCompare(right.id);
}

function compareStatusEvents(
  left: ExportStatusEventInput,
  right: ExportStatusEventInput,
): number {
  const recordedComparison = Temporal.Instant.compare(
    Temporal.Instant.from(left.recordedAt),
    Temporal.Instant.from(right.recordedAt),
  );

  if (recordedComparison !== 0) {
    return recordedComparison;
  }

  return left.id.localeCompare(right.id);
}

function compareReminderDeliveries(
  left: ExportReminderDeliveryInput,
  right: ExportReminderDeliveryInput,
): number {
  const scheduledComparison = Temporal.Instant.compare(
    Temporal.Instant.from(left.scheduledSendAt),
    Temporal.Instant.from(right.scheduledSendAt),
  );

  if (scheduledComparison !== 0) {
    return scheduledComparison;
  }

  return left.id.localeCompare(right.id);
}

function sanitizeInterventionFailureReason(
  value: string | null,
): string | null {
  if (!value) {
    return null;
  }

  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/https?:\/\/[^\s)]+/gi, "[redacted-url]")
    .replace(/\b(p256dh|auth)\s*[:=]\s*\S+/gi, "$1=[redacted-key]")
    .replace(
      /\b(api[_-]?key|token|secret|bearer)\s*[:=]\s*\S+/gi,
      "$1=[redacted-secret]",
    );
}

function omitNullish<T extends Record<string, unknown>>(input: T): T {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as T;
}

function toMarkdownSummary(input: {
  categories: ExportJsonCategory[];
  range: ExportDateRange;
  counts: ExportStatusCounts;
  behaviors: ExportJsonBehavior[];
  behaviorDefinitionEvents: ExportJsonBehaviorDefinitionEvent[];
  behaviorConfigurationEvents: ExportJsonBehaviorConfigurationEvent[];
  occurrences: ExportJsonOccurrence[];
  includeArchived: boolean;
  includeNotes: boolean;
  includeTimeTracking: boolean;
  timeSessions: ExportJsonTimeSession[];
  statusEvents: ExportJsonStatusEvent[];
}): string {
  const behaviorLines = summarizeByBehavior(input.occurrences);
  const categoryLines = summarizeByCategory(input.occurrences);
  const noteLines = summarizeOccurrenceNotes(input.occurrences);
  const timeTrackingLines = input.includeTimeTracking
    ? summarizeTimeTracking(input.timeSessions, input.behaviors)
    : [];

  return [
    `# Behavior adherence summary, ${input.range.summaryLabel}`,
    "",
    `Archived behaviors: ${input.includeArchived ? "included" : "excluded"}`,
    `Occurrence notes: ${input.includeNotes ? "included" : "excluded"}`,
    `Behavior definition history: included (${input.behaviorDefinitionEvents.length} ${input.behaviorDefinitionEvents.length === 1 ? "event" : "events"})`,
    `Behavior configuration history: included (${input.behaviorConfigurationEvents.length} ${input.behaviorConfigurationEvents.length === 1 ? "event" : "events"})`,
    "",
    "## Overall",
    `- Completed: ${input.counts.completedCount}`,
    `- Not Completed: ${input.counts.notCompletedCount}`,
    `- Unresolved: ${input.counts.unresolvedCount}`,
    `- Default adherence: ${formatAdherenceFormula(input.counts)}`,
    "",
    "## By behavior",
    ...(behaviorLines.length > 0
      ? behaviorLines
      : ["- No occurrences in this range."]),
    "",
    "## By category",
    ...input.categories.filter((category) => category.description).map((category) => `- ${category.name}: ${normalizeMarkdownNote(category.description!)}`),
    ...(categoryLines.length > 0
      ? categoryLines
      : ["- No category counts in this range."]),
    "",
    "## Behavior definition history",
    "- Behavior rows and occurrence titles are current snapshots. Use Full JSON `behavior_definition_events` or BehaviorLog `data/behavior_definition_events.jsonl` to account for renames and description changes.",
    "- Order revisions by `recorded_at`, then `id`. `changed_fields` identifies whether the title, description, or both changed; previous and next values preserve the full definition text.",
    "- BehaviorLog definition revision events use the standard definition-history profile.",
    "",
    "## Behavior configuration history",
    "- Use Full JSON `behavior_configuration_events` or standard BehaviorLog `data/behavior_configuration_events.jsonl` for schedule, timezone, active-state, category, and reminder changes. The legacy `raw/cadence/behavior_configuration_events.jsonl` remains an app-specific projection.",
    "- Segment schedule and adherence analysis at `schedule_graph`, `timezone`, and `active` boundaries. Exact change instants are in `effective_at`; BehaviorLog core date bounds are calendar-date approximations.",
    "- Treat before-and-after differences as descriptive associations. Configuration timing does not establish causality, and this export does not provide clinical guidance.",
    "",
    "## Status history",
    "- Occurrence rows are current snapshots. Use `status_events` for corrections and decision chronology.",
    "- `recorded_at` is when Cadence logged the decision; `effective_at` is its stated effective time when present; `revises_event_id` links a correction to the prior event.",
    "- For late-log and adherence-timing analysis, compare `recorded_at` with `effective_at` and the occurrence schedule. This context does not change Cadence's stored status or default adherence calculation.",
    ...(timeTrackingLines.length > 0
      ? ["", "## Time tracking", ...timeTrackingLines]
      : input.includeTimeTracking
        ? [
            "",
            "## Time tracking",
            "- No stopped timing sessions in this export range.",
          ]
        : []),
    ...(noteLines.length > 0 ? ["", "## Notes", ...noteLines] : []),
  ].join("\n");
}

function summarizeTimeTracking(
  sessions: ExportJsonTimeSession[],
  behaviors: ExportJsonBehavior[],
): string[] {
  const titleByBehaviorId = new Map(
    behaviors.map((behavior) => [behavior.id, behavior.title]),
  );
  const totalsByBehaviorId = new Map<
    string,
    {
      stoppedSessionCount: number;
      recordedSeconds: number;
      occurrenceTotals: Map<string, number>;
    }
  >();

  for (const session of sessions) {
    if (session.duration_seconds === null) {
      continue;
    }

    const totals = totalsByBehaviorId.get(session.behavior_id) ?? {
      stoppedSessionCount: 0,
      recordedSeconds: 0,
      occurrenceTotals: new Map(),
    };
    totals.stoppedSessionCount += 1;
    totals.recordedSeconds += session.duration_seconds;
    totals.occurrenceTotals.set(
      session.occurrence_id,
      (totals.occurrenceTotals.get(session.occurrence_id) ?? 0) +
        session.duration_seconds,
    );
    totalsByBehaviorId.set(session.behavior_id, totals);
  }

  return Array.from(totalsByBehaviorId.entries())
    .map(([behaviorId, totals]) => {
      const title = titleByBehaviorId.get(behaviorId) ?? "Unknown behavior";
      const averageSeconds =
        totals.recordedSeconds / totals.occurrenceTotals.size;

      return `- ${title}: ${totals.stoppedSessionCount} stopped ${totals.stoppedSessionCount === 1 ? "session" : "sessions"}, ${formatRecordedDuration(totals.recordedSeconds)} recorded, ${formatRecordedDuration(averageSeconds)} average tracked time`;
    })
    .sort((left, right) => left.localeCompare(right));
}

function summarizeByBehavior(occurrences: ExportJsonOccurrence[]): string[] {
  const groups = new Map<string, ExportJsonOccurrence[]>();

  for (const occurrence of occurrences) {
    const existing = groups.get(occurrence.behavior_id) ?? [];
    existing.push(occurrence);
    groups.set(occurrence.behavior_id, existing);
  }

  return Array.from(groups.values())
    .map((group) => {
      const firstOccurrence = group[0];
      const title = firstOccurrence?.behavior_title ?? "Unknown behavior";
      const counts = countOccurrences(group);

      return `- ${title}: ${counts.completedCount} completed, ${counts.notCompletedCount} not completed, ${counts.unresolvedCount} unresolved, ${formatAdherenceLabel(counts)}`;
    })
    .sort((left, right) => left.localeCompare(right));
}

function summarizeByCategory(occurrences: ExportJsonOccurrence[]): string[] {
  const groups = new Map<string, ExportJsonOccurrence[]>();

  for (const occurrence of occurrences) {
    const categoryName = occurrence.category ?? "No category";
    const existing = groups.get(categoryName) ?? [];
    existing.push(occurrence);
    groups.set(categoryName, existing);
  }

  return Array.from(groups.entries())
    .map(([categoryName, group]) => {
      const counts = countOccurrences(group);

      return `- ${categoryName}: ${counts.completedCount} completed, ${counts.notCompletedCount} not completed, ${counts.unresolvedCount} unresolved`;
    })
    .sort((left, right) => left.localeCompare(right));
}

function summarizeOccurrenceNotes(
  occurrences: ExportJsonOccurrence[],
): string[] {
  return occurrences
    .filter((occurrence) => occurrence.note)
    .map((occurrence) => {
      const note = normalizeMarkdownNote(occurrence.note ?? "");
      const statusLabel =
        occurrence.status === "not_completed"
          ? "not completed"
          : occurrence.status;

      return `- ${occurrence.local_date} - ${occurrence.behavior_title} - ${occurrence.schedule} - ${statusLabel}: ${note}`;
    })
    .filter((line) => !line.endsWith(": "))
    .sort((left, right) => left.localeCompare(right));
}

function normalizeMarkdownNote(note: string): string {
  return note.replace(/\s+/g, " ").trim();
}

function countOccurrences(
  occurrences: ExportJsonOccurrence[],
): ExportStatusCounts {
  const counts: ExportStatusCounts = {
    completedCount: 0,
    notCompletedCount: 0,
    unresolvedCount: 0,
    resolvedCount: 0,
    totalCount: 0,
  };

  for (const occurrence of occurrences) {
    counts.totalCount += 1;

    switch (occurrence.status) {
      case "completed":
        counts.completedCount += 1;
        counts.resolvedCount += 1;
        break;
      case "not_completed":
        counts.notCompletedCount += 1;
        counts.resolvedCount += 1;
        break;
      case "unresolved":
        counts.unresolvedCount += 1;
        break;
    }
  }

  return counts;
}

function formatAdherenceFormula(counts: ExportStatusCounts): string {
  if (counts.resolvedCount === 0) {
    return "No resolved occurrences";
  }

  return `${counts.completedCount} / (${counts.completedCount} + ${counts.notCompletedCount}) = ${formatPercent(counts.completedCount / counts.resolvedCount)}%`;
}

function formatAdherenceLabel(counts: ExportStatusCounts): string {
  if (counts.resolvedCount === 0) {
    return "No resolved occurrences";
  }

  return `${formatPercent(counts.completedCount / counts.resolvedCount)}% adherence`;
}

function formatAdherenceValue(counts: ExportStatusCounts): string {
  if (counts.resolvedCount === 0) {
    return "No resolved occurrences";
  }

  return `${formatPercent(counts.completedCount / counts.resolvedCount)}%`;
}

function formatPercent(rate: number): string {
  const rounded = Math.round(rate * 1000) / 10;

  return Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1);
}

function isOccurrenceWithinRange(
  occurrence: ExportOccurrenceInput,
  range: ExportDateRange,
): boolean {
  if (range.key === "all") return true;
  const localDate = Temporal.PlainDate.from(occurrence.localDate);
  const endDate = Temporal.PlainDate.from(range.endLocalDate);

  if (Temporal.PlainDate.compare(localDate, endDate) > 0) {
    return false;
  }

  if (!range.startLocalDate) {
    return true;
  }

  const startDate = Temporal.PlainDate.from(range.startLocalDate);

  return Temporal.PlainDate.compare(localDate, startDate) >= 0;
}

function compareBehaviors(
  left: ExportBehaviorInput,
  right: ExportBehaviorInput,
): number {
  const titleComparison = left.title.localeCompare(right.title);

  if (titleComparison !== 0) {
    return titleComparison;
  }

  return left.id.localeCompare(right.id);
}

function compareOccurrences(
  left: ExportOccurrenceInput,
  right: ExportOccurrenceInput,
  behaviorById: Map<string, ExportBehaviorInput>,
): number {
  const localDateComparison = Temporal.PlainDate.compare(
    Temporal.PlainDate.from(left.localDate),
    Temporal.PlainDate.from(right.localDate),
  );

  if (localDateComparison !== 0) {
    return localDateComparison;
  }

  const instantComparison = Temporal.Instant.compare(
    Temporal.Instant.from(left.scheduledFor),
    Temporal.Instant.from(right.scheduledFor),
  );

  if (instantComparison !== 0) {
    return instantComparison;
  }

  const leftTitle = behaviorById.get(left.behaviorId)?.title ?? "";
  const rightTitle = behaviorById.get(right.behaviorId)?.title ?? "";

  return leftTitle.localeCompare(rightTitle);
}

function formatOptionalInstantInTimezone(
  value: string | null,
  timezone: string,
): string | null {
  return value ? formatInstantInTimezone(value, timezone) : null;
}

function formatInstantInTimezone(
  value: Temporal.Instant | string,
  timezone: string,
): string {
  const instant =
    typeof value === "string" ? Temporal.Instant.from(value) : value;

  return instant
    .toZonedDateTimeISO(timezone || DEFAULT_TIMEZONE)
    .toString({ timeZoneName: "never" });
}

export function resolveExportPageSummary(input: {
  now: Temporal.Instant;
  timezone: string;
  range?: string | number | null;
  includeArchived?: boolean;
  includeNotes?: boolean;
  includeTimeTracking?: boolean;
  counts: ExportSummaryCounts;
}): ExportPageData {
  const counts = input.counts;
  const resolvedCount = counts.completed_count + counts.not_completed_count;
  const totalCount = resolvedCount + counts.unresolved_count;
  return {
    timezone: input.timezone,
    range: resolveExportDateRange(input),
    rangeOptions: [...EXPORT_RANGE_OPTIONS],
    includeArchived: input.includeArchived ?? false,
    includeNotes: input.includeNotes ?? false,
    includeTimeTracking: input.includeTimeTracking ?? false,
    behaviorCount: counts.behavior_count,
    occurrenceCount: totalCount,
    ...(input.includeTimeTracking ? { timeSessionCount: counts.time_session_count } : {}),
    overallAdherenceLabel: formatAdherenceValue({
      completedCount: counts.completed_count, notCompletedCount: counts.not_completed_count,
      unresolvedCount: counts.unresolved_count, resolvedCount, totalCount,
    }),
  };
}
