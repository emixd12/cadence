import { Temporal } from "@js-temporal/polyfill";
import { sha256 } from "../hash";
import type { BehaviorGraphRecord } from "../behavior-store";
import type { Json } from "../types/json";
import { resolveExportBundle } from "../resolvers/export.resolver";
import { parseArchiveNotes } from "../resolvers/archive-note.resolver";
import { normalizeRecurrenceRule, recurrenceDefaultsFromRule, summarizeRecurrenceRule } from "./behavior-values";
import { isBehaviorWhereKind, storedBehaviorWhere } from "./behavior-where";
import type { BehaviorWhereKind } from "../types/behavior";
import { compareScheduleSlots, formatScheduleSlotsSummary, formatOccurrenceScheduleLabel, toScheduleSlotView } from "./schedule";
import type {
  ExportBehaviorDefinitionEventInput, ExportBehaviorConfigurationEventInput, ExportBehaviorConfigurationSnapshot,
  ExportBehaviorInput, ExportBundle, ExportCategoryInput, ExportOccurrenceInput, ExportOccurrenceStatus,
  ExportReminderDeliveryChannel, ExportReminderDeliveryInput, ExportReminderDeliveryStatus, ExportStatusEventInput,
  ExportTimeSessionInput, ExportNativeReminderInput,
  ExportImportedHistory,
} from "../types/export";
import type {
  ExportPageBehaviorRow, ExportPageCategoryRow, ExportPageOccurrenceRow, ExportPageReminderDeliveryRow,
  ExportPageStatusEventRow, ExportDefinitionEventRow, ExportConfigurationEventRow, ExportTimeSessionRow,
} from "../types/export-rows";
import { BEHAVIOR_CONFIGURATION_CHANGED_FIELDS, type BehaviorConfigurationChangedField,
  type BehaviorConfigurationEventSource } from "../types/behavior-configuration-event";
import type { BehaviorDefinitionChangedField, BehaviorDefinitionEventSource } from "../types/behavior-definition-event";
import { DEFAULT_TIMEZONE } from "../types/recurrence";
import type { BehaviorScheduleView, ScheduleKind, TimeRangePreset } from "../types/schedule";

export type ExportOptions = {
  now?: Temporal.Instant; range?: string | number | null; includeArchived?: boolean;
  includeNotes?: boolean; includeTimeTracking?: boolean;
};
export type ExportAssemblyInput = ExportOptions & ExportImportedHistory & {
  now: Temporal.Instant; userId: string; timezone: string;
  categories: ExportPageCategoryRow[]; behaviors: BehaviorGraphRecord[];
  behaviorDefinitionEvents: ExportDefinitionEventRow[]; behaviorConfigurationEvents: ExportConfigurationEventRow[];
  occurrences: ExportPageOccurrenceRow[]; statusEvents: ExportPageStatusEventRow[];
  reminderDeliveries: ExportPageReminderDeliveryRow[]; timeSessions: ExportTimeSessionRow[];
  finalBehaviors?: ExportPageBehaviorRow[];
  nativeReminders?: ExportNativeReminderInput[];
};

export function assembleExportBundle(input: ExportAssemblyInput): ExportBundle {
  const { userId, timezone, now, behaviors: cachedBehaviors, behaviorDefinitionEvents,
    behaviorConfigurationEvents, timeSessions } = input;
  const options = input;
  const exportRead = input;
  assertConfigurationHistoryStable({ behaviors: cachedBehaviors, configurationEvents: behaviorConfigurationEvents,
    finalBehaviors: input.finalBehaviors ?? cachedBehaviors, occurrences: input.occurrences });
  return resolveExportBundle({
    profile: {
      timezone,
      subjectId: pseudonymousSubjectId(userId),
      locale: "en-US",
      producerName: "Cadence Tracker",
      producerVersion: "0.1.0",
      reminderChannel: input.nativeReminders === undefined ? "browser_push" : "other",
    },
    categories: exportRead.categories.map(toExportCategoryInput),
    behaviors: cachedBehaviors.map(toExportBehaviorInput),
    behaviorDefinitionEvents: behaviorDefinitionEvents.map(
      toExportBehaviorDefinitionEventInput,
    ),
    behaviorConfigurationEvents: behaviorConfigurationEvents.map(
      toExportBehaviorConfigurationEventInput,
    ),
    occurrences: exportRead.occurrences.map(toExportOccurrenceInput),
    statusEvents: exportRead.statusEvents.map(toExportStatusEventInput),
    reminderDeliveries: exportRead.reminderDeliveries.map(
      toExportReminderDeliveryInput,
    ),
    nativeReminders: input.nativeReminders,
    importedNotes: input.importedNotes,
    importedInterventions: input.importedInterventions,
    importRuns: input.importRuns,
    importMappings: input.importMappings,
    timeSessions: timeSessions.map(toExportTimeSessionInput),
    now,
    timezone,
    range: input.range,
    includeArchived: options.includeArchived,
    includeNotes: options.includeNotes,
    includeTimeTracking: options.includeTimeTracking,
  });
}

function toExportTimeSessionInput(
  session: ExportTimeSessionRow,
): ExportTimeSessionInput {
  return {
    id: session.id,
    occurrenceId: session.occurrence_id,
    behaviorId: session.behavior_id,
    startedAt: session.started_at,
    stoppedAt: session.stopped_at,
  };
}

function toExportBehaviorDefinitionEventInput(
  event: ExportDefinitionEventRow,
): ExportBehaviorDefinitionEventInput {
  return {
    id: event.id,
    behaviorId: event.behavior_id,
    previousTitle: event.previous_title,
    nextTitle: event.next_title,
    previousDescription: event.previous_description,
    nextDescription: event.next_description,
    changedFields: normalizeBehaviorDefinitionChangedFields(
      event.changed_fields,
    ),
    recordedAt: event.recorded_at,
    source: normalizeBehaviorDefinitionEventSource(event.source),
    reason: event.reason,
    createdAt: event.created_at,
    updatedAt: event.updated_at,
  };
}

function toExportBehaviorConfigurationEventInput(
  event: ExportConfigurationEventRow,
): ExportBehaviorConfigurationEventInput {
  return {
    id: event.id,
    behaviorId: event.behavior_id,
    eventKind: normalizeConfigurationEventKind(event.event_kind),
    previousConfiguration:
      event.previous_configuration === null
        ? null
        : parseConfigurationSnapshot(event.previous_configuration),
    nextConfiguration: parseConfigurationSnapshot(event.next_configuration),
    changedFields: normalizeBehaviorConfigurationChangedFields(
      event.changed_fields,
    ),
    recordedAt: event.recorded_at,
    effectiveAt: event.effective_at,
    effectiveLocalDate: event.effective_local_date,
    timezone: event.timezone,
    source: normalizeBehaviorConfigurationEventSource(event.source),
    reasonCode: event.reason_code,
    createdAt: event.created_at,
  };
}

function parseConfigurationSnapshot(
  value: Json,
): ExportBehaviorConfigurationSnapshot {
  const snapshot = requireJsonObject(value, "configuration snapshot");
  const scheduleGraph = requireJsonArray(
    snapshot.schedule_graph,
    "configuration schedule_graph",
  ).map((scheduleValue) => {
    const schedule = requireJsonObject(
      scheduleValue,
      "configuration schedule",
    );

    return {
      recurrenceRule: normalizeRecurrenceRule(
        requireJsonObject(
          schedule.recurrence_rule,
          "configuration recurrence_rule",
        ),
      ),
      sortOrder: requireInteger(
        schedule.sort_order,
        "configuration schedule sort_order",
      ),
      timeEntries: requireJsonArray(
        schedule.time_entries,
        "configuration time_entries",
      ).map((entryValue) => {
        const entry = requireJsonObject(
          entryValue,
          "configuration time entry",
        );

        return {
          kind: normalizeScheduleKind(
            requireString(entry.kind, "configuration schedule kind"),
          ),
          preset: normalizeSchedulePreset(
            requireNullableString(
              entry.preset,
              "configuration schedule preset",
            ),
          ),
          startTime: normalizeExportTime(
            requireString(
              entry.start_time,
              "configuration schedule start_time",
            ),
          ),
          endTime:
            requireNullableString(
              entry.end_time,
              "configuration schedule end_time",
            ) === null
              ? null
              : normalizeExportTime(
                  requireString(
                    entry.end_time,
                    "configuration schedule end_time",
                  ),
                ),
          sortOrder: requireInteger(
            entry.sort_order,
            "configuration time entry sort_order",
          ),
        };
      }),
    };
  });

  return {
    categoryId: requireNullableString(
      snapshot.category_id,
      "configuration category_id",
    ),
    locationText: requireNullableString(
      snapshot.location_text ?? null,
      "configuration location_text",
    ),
    ...(snapshot.where_kind === undefined ? {} : {
      whereKind: requireWhereKind(snapshot.where_kind, "configuration where_kind"),
    }),
    scheduleGraph,
    browserReminderEnabled: requireBoolean(
      snapshot.browser_reminder_enabled,
      "configuration browser_reminder_enabled",
    ),
    emailReminderEnabled: requireBoolean(
      snapshot.email_reminder_enabled,
      "configuration email_reminder_enabled",
    ),
    reminderOffsetMinutes: requireInteger(
      snapshot.reminder_offset_minutes,
      "configuration reminder_offset_minutes",
    ),
    active: requireBoolean(snapshot.active, "configuration active"),
    timezone: requireString(snapshot.timezone, "configuration timezone"),
  };
}

function normalizeConfigurationEventKind(
  value: string,
): ExportBehaviorConfigurationEventInput["eventKind"] {
  if (value === "baseline" || value === "revision") {
    return value;
  }

  throw new Error(`Unsupported behavior configuration event kind: ${value}.`);
}

function normalizeBehaviorConfigurationChangedFields(
  values: string[],
): BehaviorConfigurationChangedField[] {
  const fields = BEHAVIOR_CONFIGURATION_CHANGED_FIELDS.filter((field) =>
    values.includes(field),
  );

  if (
    fields.length === 0 ||
    fields.length !== values.length ||
    new Set(values).size !== values.length
  ) {
    throw new Error("Unsupported behavior configuration changed fields.");
  }

  return fields;
}

function normalizeBehaviorConfigurationEventSource(
  value: string,
): BehaviorConfigurationEventSource {
  if (value === "manual" || value === "import" || value === "system") {
    return value;
  }

  throw new Error(`Unsupported behavior configuration event source: ${value}.`);
}

function requireJsonObject(value: Json | undefined, label: string): {
  [key: string]: Json | undefined;
} {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }

  throw new Error(`Invalid ${label}.`);
}

function requireJsonArray(value: Json | undefined, label: string): Json[] {
  if (Array.isArray(value)) {
    return value;
  }

  throw new Error(`Invalid ${label}.`);
}

function requireString(value: Json | undefined, label: string): string {
  if (typeof value === "string") {
    return value;
  }

  throw new Error(`Invalid ${label}.`);
}

function requireNullableString(
  value: Json | undefined,
  label: string,
): string | null {
  if (value === null || typeof value === "string") {
    return value;
  }

  throw new Error(`Invalid ${label}.`);
}

function requireWhereKind(
  value: Json | undefined,
  label: string,
): BehaviorWhereKind | null {
  if (value === null || isBehaviorWhereKind(value)) {
    return value;
  }

  throw new Error(`Invalid ${label}.`);
}

function requireInteger(value: Json | undefined, label: string): number {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }

  throw new Error(`Invalid ${label}.`);
}

function requireBoolean(value: Json | undefined, label: string): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  throw new Error(`Invalid ${label}.`);
}

function normalizeBehaviorDefinitionChangedFields(
  values: string[],
): BehaviorDefinitionChangedField[] {
  const fields: BehaviorDefinitionChangedField[] = [];

  if (values.includes("title")) {
    fields.push("title");
  }

  if (values.includes("description")) {
    fields.push("description");
  }

  if (
    fields.length === 0 ||
    fields.length !== values.length ||
    new Set(values).size !== values.length
  ) {
    throw new Error("Unsupported behavior definition changed fields.");
  }

  return fields;
}

function normalizeBehaviorDefinitionEventSource(
  value: string,
): BehaviorDefinitionEventSource {
  if (value === "manual" || value === "import" || value === "system") {
    return value;
  }

  throw new Error(`Unsupported behavior definition event source: ${value}.`);
}

function toExportReminderDeliveryInput(
  delivery: ExportPageReminderDeliveryRow,
): ExportReminderDeliveryInput {
  return {
    id: delivery.id,
    occurrenceId: delivery.occurrence_id,
    channel: normalizeReminderChannel(delivery.channel),
    scheduledSendAt: delivery.scheduled_send_at,
    sentAt: delivery.sent_at,
    status: normalizeReminderDeliveryStatus(delivery.status),
    error: delivery.error,
    processingStartedAt: delivery.processing_started_at,
    createdAt: delivery.created_at,
    updatedAt: delivery.updated_at,
  };
}

function toExportCategoryInput(
  category: ExportPageCategoryRow,
): ExportCategoryInput {
  return {
    id: category.id,
    name: category.name,
    sortOrder: category.sort_order,
    description: category.description ?? null,
    createdAt: category.created_at,
    updatedAt: category.updated_at,
  };
}

function toExportBehaviorInput(
  behavior: BehaviorGraphRecord,
): ExportBehaviorInput {
  const recurrenceRule = normalizeRecurrenceRule(behavior.recurrence_rule);
  const scheduledTime = normalizeExportTime(behavior.scheduled_time);
  const schedules = toExportBehaviorSchedules(
    behavior,
    recurrenceRule,
    scheduledTime,
  );

  return {
    id: behavior.id,
    categoryId: behavior.category_id,
    categoryName: behavior.category?.name ?? null,
    title: behavior.title,
    description: behavior.description,
    whereKind: storedBehaviorWhere(behavior).where_kind,
    locationText: behavior.location_text ?? null,
    recurrenceRule,
    scheduledTime,
    schedules,
    scheduleSlots: schedules.flatMap((schedule) => schedule.timeEntries),
    timezone: behavior.timezone || DEFAULT_TIMEZONE,
    browserReminderEnabled: behavior.browser_reminder_enabled,
    emailReminderEnabled: behavior.email_reminder_enabled,
    reminderOffsetMinutes: behavior.reminder_offset_minutes,
    active: behavior.active,
    archivedAt: behavior.archived_at,
    archiveNotes: parseArchiveNotes(behavior.archive_notes),
    defaultDurationMinutes: behavior.default_duration_minutes ?? null,
    endDate: behavior.end_date ?? null,
    autoArchivedAt: behavior.auto_archived_at ?? null,
    createdAt: behavior.created_at,
    updatedAt: behavior.updated_at,
  };
}

function toExportBehaviorSchedules(
  behavior: BehaviorGraphRecord,
  fallbackRecurrenceRule: ExportBehaviorInput["recurrenceRule"],
  fallbackScheduledTime: string,
): BehaviorScheduleView[] {
  const schedules = behavior.schedules ?? [];

  if (schedules.length > 0) {
    return schedules
      .map((schedule) => {
        const recurrenceRule = normalizeRecurrenceRule(
          schedule.recurrence_rule,
        );
        const timeEntries = schedule.schedule_slots
          .map((slot) =>
            toExportScheduleSlotView({
              id: slot.id,
              scheduleId: slot.behavior_schedule_id ?? schedule.id,
              kind: normalizeScheduleKind(slot.kind),
              preset: normalizeSchedulePreset(slot.preset),
              startTime: slot.start_time,
              endTime: slot.end_time,
              sortOrder: slot.sort_order,
            }),
          )
          .sort(compareScheduleSlots);

        return {
          id: schedule.id,
          recurrenceRule,
          recurrenceSummary: summarizeRecurrenceRule(recurrenceRule),
          recurrenceDefaults: recurrenceDefaultsFromRule(recurrenceRule),
          timeEntries,
          timeSummary: formatScheduleSlotsSummary(timeEntries),
          sortOrder: schedule.sort_order,
        };
      })
      .sort((left, right) => left.sortOrder - right.sortOrder);
  }

  const timeEntries =
    behavior.schedule_slots.length > 0
      ? behavior.schedule_slots
          .map((slot) =>
            toExportScheduleSlotView({
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
          toExportScheduleSlotView({
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
      timeEntries,
      timeSummary: formatScheduleSlotsSummary(timeEntries),
      sortOrder: 0,
    },
  ];
}

function normalizeExportTime(value: string): string {
  const time = Temporal.PlainTime.from(value);
  return time.second === 0 && time.millisecond === 0 && time.microsecond === 0 && time.nanosecond === 0
    ? time.toString({ smallestUnit: "minute" })
    : time.toString();
}

function toExportScheduleSlotView(input: Parameters<typeof toScheduleSlotView>[0]) {
  return {
    ...toScheduleSlotView(input),
    startTime: normalizeExportTime(input.startTime),
    endTime: input.endTime === null ? null : normalizeExportTime(input.endTime),
  };
}

function toExportOccurrenceInput(
  occurrence: ExportPageOccurrenceRow,
): ExportOccurrenceInput {
  return {
    id: occurrence.id,
    behaviorId: occurrence.behavior_id,
    behaviorScheduleSlotId: occurrence.behavior_schedule_slot_id,
    behaviorConfigurationEventId:
      occurrence.behavior_configuration_event_id,
    scheduledFor: occurrence.scheduled_for,
    scheduledTimeLabel: formatOccurrenceScheduleLabel({
      scheduleKind: normalizeScheduleKind(occurrence.schedule_kind),
      schedulePreset: normalizeSchedulePreset(occurrence.schedule_preset),
      scheduleStartTime: normalizeExportTime(occurrence.schedule_start_time),
      scheduleEndTime: occurrence.schedule_end_time
        ? normalizeExportTime(occurrence.schedule_end_time)
        : null,
    }),
    scheduleKind: normalizeScheduleKind(occurrence.schedule_kind),
    schedulePreset: normalizeSchedulePreset(occurrence.schedule_preset),
    scheduleStartTime: normalizeExportTime(occurrence.schedule_start_time),
    scheduleEndTime: occurrence.schedule_end_time
      ? normalizeExportTime(occurrence.schedule_end_time)
      : null,
    localDate: occurrence.local_date,
    status: normalizeOccurrenceStatus(occurrence.status),
    completedAt: occurrence.completed_at,
    statusMarkedAt: occurrence.status_marked_at,
    note: occurrence.note,
    createdAt: occurrence.created_at,
    updatedAt: occurrence.updated_at,
  };
}

function toExportStatusEventInput(
  event: ExportPageStatusEventRow,
): ExportStatusEventInput {
  return {
    id: event.id,
    occurrenceId: event.occurrence_id,
    behaviorId: event.behavior_id,
    previousStatus: normalizeNullableOccurrenceStatus(event.previous_status),
    status: normalizeOccurrenceStatus(event.status),
    statusSemantics: normalizeStatusSemantics(event.status_semantics),
    recordedAt: event.recorded_at,
    effectiveAt: event.effective_at,
    localDate: event.local_date,
    timezone: event.timezone || DEFAULT_TIMEZONE,
    sourceCaptureMethod: normalizeSourceCaptureMethod(
      event.source_capture_method,
    ),
    sourceConfidence: normalizeSourceConfidence(event.source_confidence),
    revisesEventId: event.revises_event_id,
    reasonCode: event.reason_code,
    createdAt: event.created_at,
    updatedAt: event.updated_at,
  };
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

function normalizeOccurrenceStatus(value: string): ExportOccurrenceStatus {
  if (
    value === "unresolved" ||
    value === "completed" ||
    value === "not_completed"
  ) {
    return value;
  }

  throw new Error(`Unsupported occurrence status: ${value}.`);
}

function normalizeNullableOccurrenceStatus(
  value: string | null,
): ExportOccurrenceStatus | null {
  return value ? normalizeOccurrenceStatus(value) : null;
}

function normalizeStatusSemantics(
  value: string,
): ExportStatusEventInput["statusSemantics"] {
  if (
    value === "explicit_user_mark" ||
    value === "explicit_user_correction" ||
    value === "imported_explicit" ||
    value === "system_rule_declared" ||
    value === "ambiguous_import"
  ) {
    return value;
  }

  throw new Error(`Unsupported status semantics: ${value}.`);
}

function normalizeSourceCaptureMethod(
  value: string,
): ExportStatusEventInput["sourceCaptureMethod"] {
  if (
    value === "manual_tap" ||
    value === "manual_text" ||
    value === "system_generated" ||
    value === "imported" ||
    value === "inferred" ||
    value === "derived" ||
    value === "ai_generated" ||
    value === "unknown"
  ) {
    return value;
  }

  throw new Error(`Unsupported source capture method: ${value}.`);
}

function normalizeSourceConfidence(
  value: string,
): ExportStatusEventInput["sourceConfidence"] {
  if (
    value === "high" ||
    value === "medium" ||
    value === "low" ||
    value === "ambiguous" ||
    value === "unknown"
  ) {
    return value;
  }

  throw new Error(`Unsupported source confidence: ${value}.`);
}

function normalizeReminderChannel(
  value: string,
): ExportReminderDeliveryChannel {
  if (value === "browser_push" || value === "email") {
    return value;
  }

  throw new Error(`Unsupported reminder channel: ${value}.`);
}

function normalizeReminderDeliveryStatus(
  value: string,
): ExportReminderDeliveryStatus {
  if (
    value === "pending" ||
    value === "sent" ||
    value === "failed" ||
    value === "cancelled"
  ) {
    return value;
  }

  throw new Error(`Unsupported reminder delivery status: ${value}.`);
}

export function pseudonymousSubjectId(userId: string): string {
  return `subject_${sha256(userId).slice(0, 16)}`;
}

export function assertConfigurationHistoryStable(input: {
  behaviors: BehaviorGraphRecord[];
  configurationEvents: ExportConfigurationEventRow[];
  finalBehaviors: ExportPageBehaviorRow[];
  occurrences: ExportPageOccurrenceRow[];
}): void {
  const eventById = new Map(
    input.configurationEvents.map((event) => [event.id, event]),
  );
  const expectedByBehaviorId = new Map(
    input.behaviors.map((behavior) => [behavior.id, behavior]),
  );

  if (input.finalBehaviors.length !== input.behaviors.length) {
    throw new Error(
      "Behavior configuration changed during export. Try the export again.",
    );
  }

  for (const finalBehavior of input.finalBehaviors) {
    const behavior = expectedByBehaviorId.get(finalBehavior.id);

    if (
      !behavior ||
      finalBehavior.current_configuration_event_id !==
        behavior.current_configuration_event_id ||
      finalBehavior.updated_at !== behavior.updated_at
    ) {
      throw new Error(
        "Behavior configuration changed during export. Try the export again.",
      );
    }

    const currentEvent = finalBehavior.current_configuration_event_id
      ? eventById.get(finalBehavior.current_configuration_event_id)
      : null;

    if (!currentEvent || currentEvent.behavior_id !== finalBehavior.id) {
      throw new Error(
        "Behavior configuration history is incomplete. Try the export again.",
      );
    }
  }

  for (const occurrence of input.occurrences) {
    if (!occurrence.behavior_configuration_event_id) {
      continue;
    }

    const event = eventById.get(occurrence.behavior_configuration_event_id);

    if (!event || event.behavior_id !== occurrence.behavior_id) {
      throw new Error(
        "Occurrence configuration history is incomplete. Try the export again.",
      );
    }
  }
}
