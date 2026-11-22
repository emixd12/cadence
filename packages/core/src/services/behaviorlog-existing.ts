import type { OpportunityAddedBy } from "../types/database";
import { Temporal } from "@js-temporal/polyfill";
import { isBehaviorLogScheduleBoundary } from "../resolvers/behavior-configuration.resolver";
import { BEHAVIORLOG_INTERVENTION_CHANNELS, BEHAVIORLOG_INTERVENTION_DELIVERY_STATUSES,
  type BehaviorLogInterventionChannel, type BehaviorLogInterventionDeliveryStatus } from "../types/behaviorlog-import";
import type { BehaviorGraphRecord } from "../behavior-store";
import type { OccurrenceRecord, OccurrenceStatusEventRecord } from "../data-store";
import { normalizeRecurrenceRule } from "./behavior-values";
import type { BehaviorLogExistingOccurrence, BehaviorLogExistingRecords, BehaviorLogExistingSchedule, BehaviorLogImportRecordType, BehaviorLogSourceCaptureMethod, BehaviorLogSourceConfidence, BehaviorLogStatusSemantics } from "../types/behaviorlog-import";
import type { OccurrenceStatus } from "../types/database";
import type { PortabilityConfigurationEventRow, PortabilityDefinitionEventRow, PortabilityTimeSessionRow, PortabilityMappingRow, PortabilityNoteRow, PortabilityInterventionRow, PortabilityImportRunRow } from "../types/portability-rows";
import { DEFAULT_TIMEZONE, type RecurrenceRule } from "../types/recurrence";
import { parseArchiveNotes } from "../resolvers/archive-note.resolver";
const BEHAVIORLOG_RECURRENCE_PROFILE = "behaviorlog.calendar_simple.v1";

export function assembleBehaviorLogExistingRecords(input: {
  behaviors: BehaviorGraphRecord[]; occurrences: OccurrenceRecord[]; statusEvents: OccurrenceStatusEventRecord[];
  definitionEvents: PortabilityDefinitionEventRow[]; timeSessions: Pick<PortabilityTimeSessionRow, "id" | "occurrence_id" | "behavior_id" | "started_at" | "stopped_at">[];
  mappings: PortabilityMappingRow[]; importedNotes: PortabilityNoteRow[]; importedInterventions: PortabilityInterventionRow[];
  configurationEvents: PortabilityConfigurationEventRow[];
  importRuns?: PortabilityImportRunRow[];
}): BehaviorLogExistingRecords {
  const { behaviors, occurrences, statusEvents, definitionEvents, timeSessions, mappings, importedNotes, importedInterventions } = input;
  const behaviorById = new Map(
    behaviors.map((behavior) => [behavior.id, behavior]),
  );
  const boundariesByBehavior = new Map<string, PortabilityConfigurationEventRow[]>();
  for (const event of input.configurationEvents.filter(isBehaviorLogScheduleBoundary).sort(
    (left, right) => Temporal.Instant.compare(left.recorded_at, right.recorded_at) || left.id.localeCompare(right.id),
  )) {
    const boundaries = boundariesByBehavior.get(event.behavior_id) ?? [];
    boundaries.push(event);
    boundariesByBehavior.set(event.behavior_id, boundaries);
  }
  const schedules = behaviors.flatMap((behavior) => {
    const boundaries = boundariesByBehavior.get(behavior.id) ?? [];
    const boundary = behavior.active ? boundaries.findLast((event) => {
      const configuration = event.next_configuration;
      return configuration !== null && typeof configuration === "object" && !Array.isArray(configuration) && configuration.active === true;
    }) : boundaries.at(-1);
    return toExistingSchedules(behavior, boundary);
  });
  const schedulesById = new Map(schedules.map((schedule) => [schedule.id, schedule]));
  const runOwners = new Map((input.importRuns ?? []).filter((run) => run.status === "applied").map((run) => [run.id, run.user_id]));
  const ownedMappings = new Map(mappings.filter((mapping) => mapping.user_id === runOwners.get(mapping.import_run_id))
    .map((mapping) => [`${mapping.import_run_id}:${mapping.record_type}:${mapping.external_id}`, mapping.local_id]));
  for (const run of input.importRuns ?? []) {
    if (run.status !== "applied") continue;
    const summary = jsonObject(run.dry_run_summary), portability = jsonObject(summary?.portability);
    if (portability?.version !== 1 || !Array.isArray(portability.scheduleIdentities)) continue;
    for (const value of portability.scheduleIdentities) {
      const source = jsonObject(value);
      if (!source || typeof source.externalId !== "string" || typeof source.behaviorExternalId !== "string" ||
        typeof source.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(source.fingerprint)) continue;
      const scheduleId = ownedMappings.get(`${run.id}:schedule:${source.externalId}`);
      const behaviorId = ownedMappings.get(`${run.id}:behavior:${source.behaviorExternalId}`);
      const schedule = scheduleId ? schedulesById.get(scheduleId) : undefined;
      if (!schedule || !behaviorId || schedule.behaviorId !== behaviorId || behaviorById.get(behaviorId)?.user_id !== run.user_id) continue;
      schedule.acceptedSourceIdentities ??= [];
      if (!schedule.acceptedSourceIdentities.includes(source.fingerprint)) schedule.acceptedSourceIdentities.push(source.fingerprint);
    }
  }

  return {
    behaviors: behaviors.map((behavior) => toExistingBehavior(behavior, schedules.filter((schedule) => schedule.behaviorId === behavior.id))),
    schedules,
    occurrences: occurrences.map((occurrence) =>
      toExistingOccurrence(occurrence, behaviorById.get(occurrence.behavior_id)),
    ),
    statusEvents: statusEvents.map(toExistingStatusEvent),
    definitionEvents: definitionEvents.map((event) => ({
      id: event.id,
      behaviorId: event.behavior_id,
      recordedAtUtc: canonicalInstant(event.recorded_at),
      sourceOriginalId: event.id,
    })),
    timeSessions: timeSessions.map((session) => ({
      id: session.id,
      occurrenceId: session.occurrence_id,
      behaviorId: session.behavior_id,
      startedAtUtc: canonicalInstant(session.started_at),
      stoppedAtUtc: session.stopped_at ? canonicalInstant(session.stopped_at) : null,
      sourceOriginalId: session.id,
    })),
    importedNotes: importedNotes.map(toExistingImportedNote),
    importedInterventions: importedInterventions.map(
      toExistingImportedIntervention,
    ),
    mappings: mappings.map((mapping) => ({
      recordType: normalizeRecordType(mapping.record_type),
      externalId: mapping.external_id,
      localId: mapping.local_id,
    })),
  };
}
function jsonObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function toExistingBehavior(behavior: BehaviorGraphRecord, schedules: BehaviorLogExistingSchedule[]) {
  return {
    id: behavior.id,
    rowUpdatedAtUtc: behavior.updated_at,
    title: behavior.title,
    description: behavior.description,
    category: toBehaviorLogCategory(behavior.category?.name ?? null),
    cadenceCategoryName: behavior.category?.name ?? null,
    active: behavior.active,
    archivedAt: behavior.archived_at,
    archiveNotes: parseArchiveNotes(behavior.archive_notes),
    defaultDurationMinutes: behavior.default_duration_minutes ?? null,
    run: {
      endOn: behavior.end_on ?? null,
      endTime: behavior.end_time ?? null,
      pauseFromOn: behavior.pause_from_on ?? null,
      pauseFromTime: behavior.pause_from_time ?? null,
      pauseBackOn: behavior.pause_back_on ?? null,
    },
    autoArchivedAt: behavior.auto_archived_at ?? null,
    ...(behavior.is_opportunity === undefined ? {} : { isOpportunity: behavior.is_opportunity }),
    parentBehaviorId: behavior.parent_behavior_id ?? null,
    subBehaviorSortOrder: behavior.sub_behavior_sort_order ?? 0,
    inheritParentSchedule: behavior.inherit_parent_schedule ?? false,
    sourceOriginalId: behavior.id,
    schedules,
    configurationSnapshot: toExistingBehaviorConfiguration(behavior),
  };
}

function toExistingBehaviorConfiguration(behavior: BehaviorGraphRecord) {
  const parentSchedules = behavior.schedules ?? [];
  const scheduleGraph =
    parentSchedules.length > 0
      ? parentSchedules.map((schedule) => ({
          id: schedule.id,
          recurrenceRule: schedule.recurrence_rule,
          sortOrder: schedule.sort_order,
          timeEntries: schedule.schedule_slots.map((slot) => ({
            id: slot.id,
            kind: slot.kind,
            preset: slot.preset,
            startTime: slot.start_time,
            endTime: slot.end_time,
            sortOrder: slot.sort_order,
          })),
        }))
      : [
          {
            recurrenceRule: behavior.recurrence_rule,
            sortOrder: 0,
            timeEntries: behavior.schedule_slots.map((slot) => ({
              id: slot.id,
              kind: slot.kind,
              preset: slot.preset,
              startTime: slot.start_time,
              endTime: slot.end_time,
              sortOrder: slot.sort_order,
            })),
          },
        ];

  return {
    categoryId: behavior.category_id,
    scheduleGraph,
    browserReminderEnabled: behavior.browser_reminder_enabled,
    emailReminderEnabled: behavior.email_reminder_enabled,
    reminderOffsetMinutes: behavior.reminder_offset_minutes,
    active: behavior.active,
    timezone: behavior.timezone,
  };
}

function toExistingSchedules(
  behavior: BehaviorGraphRecord,
  boundary: PortabilityConfigurationEventRow | undefined,
): BehaviorLogExistingSchedule[] {
  const timezone = behavior.timezone || DEFAULT_TIMEZONE;

  return behavior.schedule_slots.map((slot) => ({
    id: slot.id,
    rowUpdatedAtUtc: slot.updated_at,
    behaviorId: behavior.id,
    recurrenceProfile: BEHAVIORLOG_RECURRENCE_PROFILE,
    recurrence: toBehaviorLogRecurrence(
      normalizeRecurrenceRule(behavior.schedules?.find((parent) => parent.id === slot.behavior_schedule_id)?.recurrence_rule ?? behavior.recurrence_rule),
    ),
    timezone,
    localTime: normalizeTime(slot.start_time),
    windowStartLocal:
      slot.kind === "range" ? normalizeTime(slot.start_time) : null,
    windowEndLocal:
      slot.kind === "range" && slot.end_time
        ? normalizeTime(slot.end_time)
        : null,
    cadenceScheduleKind: slot.kind === "range" ? "range" : "exact",
    cadenceSchedulePreset: normalizeSchedulePreset(slot.preset),
    activeFromLocalDate: boundary?.effective_local_date ?? instantToLocalDate(behavior.created_at, timezone),
    anchorLocalDate: instantToLocalDate(behavior.created_at, timezone),
    activeUntilLocalDate: behavior.archived_at
      ? boundary?.effective_local_date ?? instantToLocalDate(behavior.archived_at, timezone)
      : null,
    sourceOriginalId: slot.id,
  }));
}

function toExistingOccurrence(
  occurrence: OccurrenceRecord,
  behavior: BehaviorGraphRecord | undefined,
): BehaviorLogExistingOccurrence {
  return {
    id: occurrence.id,
    rowUpdatedAtUtc: occurrence.updated_at,
    behaviorId: occurrence.behavior_id,
    scheduleId: occurrence.behavior_schedule_slot_id,
    behaviorTitle: behavior?.title ?? null,
    scheduledForUtc: canonicalInstant(occurrence.scheduled_for),
    localDate: occurrence.local_date,
    timezone: behavior?.timezone ?? DEFAULT_TIMEZONE,
    status: normalizeOccurrenceStatus(occurrence.status),
    note: occurrence.note,
    origin: occurrence.origin === "opportunity" ? "opportunity" : "scheduled",
    addedBy: occurrence.origin === "opportunity" ? existingAddedBy(occurrence.added_by) : null,
    sourceOriginalId: occurrence.id,
    scheduleSnapshot: {
      kind: occurrence.schedule_kind === "range" ? "range" : "exact",
      preset: normalizeSchedulePreset(occurrence.schedule_preset),
      startTime: normalizeTime(occurrence.schedule_start_time),
      endTime: occurrence.schedule_end_time ? normalizeTime(occurrence.schedule_end_time) : null,
    },
  };
}

function existingAddedBy(value: string | null | undefined): OpportunityAddedBy | null {
  return value === "user" || value === "daily_brief" || value === "chat" || value === "mcp" ? value : null;
}

function toExistingStatusEvent(event: OccurrenceStatusEventRecord) {
  return {
    id: event.id,
    rowUpdatedAtUtc: event.updated_at,
    occurrenceId: event.occurrence_id,
    behaviorId: event.behavior_id,
    recordedAtUtc: canonicalInstant(event.recorded_at),
    status: normalizeOccurrenceStatus(event.status),
    statusSemantics: normalizeStatusSemantics(event.status_semantics),
    sourceCaptureMethod: normalizeSourceCaptureMethod(
      event.source_capture_method,
    ),
    sourceConfidence: normalizeSourceConfidence(event.source_confidence),
    revisesEventId: event.revises_event_id,
    sourceOriginalId: event.id,
  };
}

function toExistingImportedNote(note: PortabilityNoteRow) {
  return {
    id: note.id,
    rowUpdatedAtUtc: note.updated_at,
    importRunId: note.import_run_id,
    externalId: note.external_id,
    targetType: normalizeImportedNoteTargetType(note.target_type),
    targetExternalId: note.target_external_id,
    targetLocalId: note.target_local_id,
    bodyMarkdown: note.body_markdown,
    noteRole: normalizeImportedNoteRole(note.note_role),
    sensitivity: normalizeImportedNoteSensitivity(note.sensitivity),
    sourceOriginalId: note.source_original_id,
    sourceCaptureMethod: normalizeSourceCaptureMethod(
      note.source_capture_method,
    ),
    sourceConfidence: normalizeSourceConfidence(note.source_confidence),
    createdAtUtc: canonicalInstant(note.imported_created_at),
    updatedAtUtc: note.imported_updated_at ? canonicalInstant(note.imported_updated_at) : null,
  };
}

function toExistingImportedIntervention(intervention: PortabilityInterventionRow) {
  return {
    id: intervention.id,
    rowUpdatedAtUtc: intervention.updated_at,
    importRunId: intervention.import_run_id,
    externalId: intervention.external_id,
    behaviorExternalId: intervention.behavior_external_id,
    occurrenceExternalId: intervention.occurrence_external_id,
    behaviorId: intervention.behavior_id,
    occurrenceId: intervention.occurrence_id,
    interventionType: intervention.intervention_type,
    channel: normalizeInterventionChannel(intervention.channel),
    deliveryStatus: normalizeInterventionDeliveryStatus(
      intervention.delivery_status,
    ),
    scheduledSendAtUtc: canonicalInstant(intervention.scheduled_send_at),
    sentAtUtc: intervention.sent_at ? canonicalInstant(intervention.sent_at) : null,
    failureReason: intervention.failure_reason,
    sourceOriginalId: intervention.source_original_id,
    sourceCaptureMethod: normalizeSourceCaptureMethod(
      intervention.source_capture_method,
    ),
    sourceConfidence: normalizeSourceConfidence(intervention.source_confidence),
  };
}

// Comparison identity must not depend on PostgREST's +00:00 spelling versus
// SQLite/export's Z spelling. Keep rowUpdatedAtUtc raw for stale-row guards.
function canonicalInstant(value: string): string {
  return Temporal.Instant.from(value).toString();
}

function toBehaviorLogRecurrence(rule: RecurrenceRule): Record<string, unknown> {
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

function instantToLocalDate(instant: string, timezone: string): string {
  return Temporal.Instant.from(instant)
    .toZonedDateTimeISO(timezone || DEFAULT_TIMEZONE)
    .toPlainDate()
    .toString();
}

function normalizeTime(value: string): string {
  return value.slice(0, 5);
}

function normalizeSchedulePreset(
  value: string | null,
): "morning" | "afternoon" | "evening" | "night" | null {
  if (
    value === "morning" ||
    value === "afternoon" ||
    value === "evening" ||
    value === "night"
  ) {
    return value;
  }

  return null;
}

function normalizeRecordType(value: string): BehaviorLogImportRecordType {
  if (
    value === "behavior" ||
    value === "schedule" ||
    value === "occurrence" ||
    value === "status_event" ||
    value === "note" ||
    value === "intervention" ||
    value === "behavior_definition_event" ||
    value === "time_session"
  ) {
    return value;
  }

  throw new Error(`Unsupported BehaviorLog import mapping record type: ${value}.`);
}

function normalizeOccurrenceStatus(value: string): OccurrenceStatus {
  if (
    value === "unresolved" ||
    value === "completed" ||
    value === "not_completed"
  ) {
    return value;
  }

  return "unresolved";
}

function normalizeStatusSemantics(value: string): BehaviorLogStatusSemantics {
  if (
    value === "explicit_user_mark" ||
    value === "explicit_user_correction" ||
    value === "imported_explicit" ||
    value === "system_rule_declared" ||
    value === "ambiguous_import"
  ) {
    return value;
  }

  return "ambiguous_import";
}

function normalizeImportedNoteTargetType(
  value: string,
): "behavior" | "occurrence" | "status_event" | "review" {
  if (
    value === "behavior" ||
    value === "occurrence" ||
    value === "status_event" ||
    value === "review"
  ) {
    return value;
  }

  return "review";
}

function normalizeImportedNoteRole(
  value: string,
): "user" | "imported" | "system" | "ai_generated" {
  if (
    value === "user" ||
    value === "imported" ||
    value === "system" ||
    value === "ai_generated"
  ) {
    return value;
  }

  return "imported";
}

function normalizeImportedNoteSensitivity(
  value: string | null,
): "low" | "medium" | "high" | "restricted" | null {
  if (
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "restricted"
  ) {
    return value;
  }

  return null;
}

function normalizeInterventionChannel(value: string): BehaviorLogInterventionChannel {
  const channel = BEHAVIORLOG_INTERVENTION_CHANNELS.find((channel) => channel === value);
  if (!channel) throw new Error("Stored passive intervention has an unsupported channel.");
  return channel;
}

function normalizeInterventionDeliveryStatus(
  value: string,
): BehaviorLogInterventionDeliveryStatus {
  const status = BEHAVIORLOG_INTERVENTION_DELIVERY_STATUSES.find((status) => status === value);
  if (!status) throw new Error("Stored passive intervention has an unsupported delivery status.");
  return status;
}

function normalizeSourceCaptureMethod(
  value: string,
): BehaviorLogSourceCaptureMethod {
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

  return "unknown";
}

function normalizeSourceConfidence(value: string): BehaviorLogSourceConfidence {
  if (
    value === "high" ||
    value === "medium" ||
    value === "low" ||
    value === "ambiguous" ||
    value === "unknown"
  ) {
    return value;
  }

  return "unknown";
}
