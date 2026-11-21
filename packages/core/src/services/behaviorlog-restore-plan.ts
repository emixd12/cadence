import { storedRunColumns } from "./behavior-run-fields";
import type { Json } from "../types/json";
import { sha256 } from "../hash";
import { normalizeBehaviorDefinition, planBehaviorDefinitionChangeEvent, planInitialBehaviorDefinitionEvent } from "../resolvers/behavior-definition.resolver";
import { planBehaviorConfigurationChangeEvent, planInitialBehaviorConfigurationEvent } from "../resolvers/behavior-configuration.resolver";
import { toBehaviorConfigurationEventPlanPayload } from "./configuration-payload";
import type { OccurrenceOrigin, OpportunityAddedBy } from "../types/database";
import type { BehaviorLogExistingOccurrence, BehaviorLogImportOccurrencePlan, BehaviorLogImportBehaviorPlan, BehaviorLogImportDefinitionEventPlan, BehaviorLogExistingRecords, BehaviorLogImportNotePlan, BehaviorLogImportPreview, BehaviorLogImportRecordMappingInput, BehaviorLogImportSchedulePlan, BehaviorLogImportInterventionRulePlan } from "../types/behaviorlog-import";
import { serializeArchiveNotes } from "../resolvers/archive-note.resolver";
import type { BehaviorDefinition, BehaviorDefinitionEventPlan } from "../types/behavior-definition-event";
import type { BehaviorConfigurationSchedule } from "../types/behavior-configuration-event";
import { DEFAULT_TIMEZONE, type Weekday } from "../types/recurrence";
import type { BehaviorLogRestoreAction, BehaviorLogRestorePreview } from "../types/behaviorlog-restore";

type RestoreRowPrecondition = {
  record_type:
    | "behavior"
    | "schedule"
    | "occurrence"
    | "status_event"
    | "behavior_definition_event"
    | "time_session"
    | "note"
    | "intervention";
  local_id: string;
  expectation: "absent" | "unchanged";
  expected_updated_at: string | null;
};

export type RestoreProductPayload = {
  preconditions: RestoreRowPrecondition[];
  archive_behavior_ids: string[];
  delete_schedule_ids: string[];
  delete_occurrence_ids: string[];
  delete_status_event_ids: string[];
  clear_occurrence_note_ids: string[];
  delete_imported_note_ids: string[];
  delete_imported_intervention_ids: string[];
  behaviors: Array<Record<string, unknown>>;
  behavior_definition_events: Array<Record<string, unknown>>;
  behavior_configuration_events: Array<Record<string, unknown>>;
  schedules: Array<Record<string, unknown>>;
  occurrences: Array<Record<string, unknown>>;
  status_events: Array<Record<string, unknown>>;
  imported_notes: Array<Record<string, unknown>>;
  imported_interventions: Array<Record<string, unknown>>;
  time_sessions: Array<Record<string, unknown>>;
};

type RestoreBehaviorDefinitionEventPayload = {
  id: string;
  external_id: string | null;
  event_kind: "baseline" | "transition";
  behavior_id: string;
  previous_title: string | null;
  next_title: string;
  previous_description: string | null;
  next_description: string | null;
  changed_fields: Array<"title" | "description">;
  recorded_at: string;
  source: "import";
  reason: string | null;
  expected_previous_title: string | null;
  expected_previous_description: string | null;
};

export type RestorePayloadBuildResult = {
  payload: RestoreProductPayload;
  mappings: BehaviorLogImportRecordMappingInput[];
};

export class BehaviorLogRestoreUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BehaviorLogRestoreUserError";
  }
}

export function buildRestorePayload(input: {
  userId: string;
  importRunId: string;
  importPreview: BehaviorLogImportPreview;
  preview: BehaviorLogRestorePreview;
  existing: BehaviorLogExistingRecords;
  now: string;
}): RestorePayloadBuildResult {
  const actionIndex = indexRestoreActions(input.preview);
  const behaviorIdByExternal = new Map<string, string>();
  const scheduleIdByExternal = new Map<string, string>();
  const occurrenceIdByExternal = new Map<string, string>();
  const statusEventIdByExternal = new Map<string, string>();
  const definitionEventIdByExternal = new Map<string, string>();
  const timeSessionIdByExternal = new Map<string, string>();
  const noteIdByExternal = new Map<string, string>();
  const interventionIdByExternal = new Map<string, string>();
  const latestStatusEventByOccurrence = new Map<string, string>();
  const mappings: BehaviorLogImportRecordMappingInput[] = [];
  const restoreRecordedAt = input.now;

  for (const behavior of input.importPreview.plan.behaviors) {
    const action = actionIndex.behavior.get(behavior.externalId);

    if (action && action.action !== "skip") {
      const behaviorId = deriveBehaviorLogRestoreLocalId(action, {
        externalId: behavior.externalId,
        label: "behavior",
        recordType: "behavior",
        userId: input.userId,
        bundleFingerprint: input.preview.bundleFingerprint,
      });
      behaviorIdByExternal.set(
        behavior.externalId,
        behaviorId,
      );
      mappings.push(
        restoreMapping(input, "behavior", behavior.externalId, behaviorId),
      );
    }
  }

  for (const schedule of input.importPreview.plan.schedules) {
    const action = actionIndex.schedule.get(schedule.externalId);

    if (action && action.action !== "skip") {
      const scheduleId = deriveBehaviorLogRestoreLocalId(action, {
        externalId: schedule.externalId,
        label: "schedule",
        recordType: "schedule",
        userId: input.userId,
        bundleFingerprint: input.preview.bundleFingerprint,
      });
      scheduleIdByExternal.set(
        schedule.externalId,
        scheduleId,
      );
      mappings.push(
        restoreMapping(input, "schedule", schedule.externalId, scheduleId),
      );
    }
  }

  for (const occurrence of input.importPreview.plan.occurrences) {
    const action = actionIndex.occurrence.get(occurrence.externalId);

    if (action && action.action !== "skip") {
      const occurrenceId = deriveBehaviorLogRestoreLocalId(action, {
        externalId: occurrence.externalId,
        label: "occurrence",
        recordType: "occurrence",
        userId: input.userId,
        bundleFingerprint: input.preview.bundleFingerprint,
      });
      occurrenceIdByExternal.set(
        occurrence.externalId,
        occurrenceId,
      );
      mappings.push(
        restoreMapping(input, "occurrence", occurrence.externalId, occurrenceId),
      );
    }
  }

  for (const event of input.importPreview.plan.statusEvents) {
    const action = actionIndex.status_event.get(event.externalId);

    if (action && action.action !== "skip") {
      const eventId = deriveBehaviorLogRestoreLocalId(action, {
        externalId: event.externalId,
        label: "status event",
        recordType: "status_event",
        userId: input.userId,
        bundleFingerprint: input.preview.bundleFingerprint,
      });
      statusEventIdByExternal.set(event.externalId, eventId);
      mappings.push(
        restoreMapping(input, "status_event", event.externalId, eventId),
      );
      latestStatusEventByOccurrence.set(event.occurrenceExternalId, event.externalId);
    }
  }

  for (const event of input.importPreview.plan.definitionEvents ?? []) {
    const action = actionIndex.behavior_definition_event.get(event.externalId);

    if (action && action.action !== "skip") {
      const eventId = deriveBehaviorLogRestoreLocalId(action, {
        externalId: event.externalId,
        label: "definition event",
        recordType: "behavior_definition_event",
        userId: input.userId,
        bundleFingerprint: input.preview.bundleFingerprint,
      });
      definitionEventIdByExternal.set(event.externalId, eventId);
      mappings.push(
        restoreMapping(
          input,
          "behavior_definition_event",
          event.externalId,
          eventId,
        ),
      );
    }
  }

  for (const session of input.importPreview.plan.timeSessions ?? []) {
    const action = actionIndex.time_session.get(session.externalId);

    if (action && action.action !== "skip") {
      const sessionId = deriveBehaviorLogRestoreLocalId(action, {
        externalId: session.externalId,
        label: "time session",
        recordType: "time_session",
        userId: input.userId,
        bundleFingerprint: input.preview.bundleFingerprint,
      });
      timeSessionIdByExternal.set(session.externalId, sessionId);
      mappings.push(
        restoreMapping(input, "time_session", session.externalId, sessionId),
      );
    }
  }

  for (const note of input.importPreview.plan.notes) {
    const action = actionIndex.note.get(note.externalId);

    if (action && action.action !== "skip") {
      const noteId = deriveBehaviorLogRestoreLocalId(action, {
        externalId: note.externalId,
        label: "note",
        recordType: "note",
        userId: input.userId,
        bundleFingerprint: input.preview.bundleFingerprint,
      });
      noteIdByExternal.set(note.externalId, noteId);
      mappings.push(restoreMapping(input, "note", note.externalId, noteId));
    }
  }

  for (const intervention of input.importPreview.plan.interventions) {
    const action = actionIndex.intervention.get(intervention.externalId);

    if (action && action.action !== "skip") {
      const interventionId = deriveBehaviorLogRestoreLocalId(action, {
        externalId: intervention.externalId,
        label: "intervention",
        recordType: "intervention",
        userId: input.userId,
        bundleFingerprint: input.preview.bundleFingerprint,
      });
      interventionIdByExternal.set(intervention.externalId, interventionId);
      mappings.push(
        restoreMapping(
          input,
          "intervention",
          intervention.externalId,
          interventionId,
        ),
      );
    }
  }

  const inlineNoteByOccurrence = new Map(
    input.importPreview.plan.notes
      .filter(
        (note) =>
          note.action !== "skip" &&
          note.noteRole !== "ai_generated" &&
          note.attachedToType === "occurrence",
      )
      .map((note) => [note.attachedToId, note.bodyMarkdown]),
  );
  const behaviorDefinitionEvents = buildRestoreBehaviorDefinitionEvents({
    behaviorPlans: input.importPreview.plan.behaviors,
    definitionEventPlans: input.importPreview.plan.definitionEvents ?? [],
    actionIndex: actionIndex.behavior,
    definitionEventActionIndex: actionIndex.behavior_definition_event,
    behaviorIdByExternal,
    definitionEventIdByExternal,
    existingBehaviors: input.existing.behaviors ?? [],
    restoreRecordedAt,
    userId: input.userId,
    bundleFingerprint: input.preview.bundleFingerprint,
  });
  const behaviorDefinitionEventByBehaviorId = latestDefinitionEventByBehavior(
    behaviorDefinitionEvents,
  );
  const existingOccurrenceById = new Map(
    (input.existing.occurrences ?? []).map((occurrence) => [occurrence.id, occurrence]),
  );
  const existingBehaviorById = new Map(
    (input.existing.behaviors ?? []).map((behavior) => [behavior.id, behavior]),
  );
  const preconditions = buildRestoreRowPreconditions({
    preview: input.preview,
    existing: input.existing,
    behaviorIdByExternal,
    scheduleIdByExternal,
    occurrenceIdByExternal,
    statusEventIdByExternal,
    noteIdByExternal,
    interventionIdByExternal,
    definitionEventIdByExternal,
    timeSessionIdByExternal,
  });
  const behaviorConfigurationPayloads =
    buildRestoreBehaviorConfigurationPayloads({
      behaviorPlans: input.importPreview.plan.behaviors,
      schedulePlans: input.importPreview.plan.schedules,
      interventionRulePlans: input.importPreview.plan.interventionRules,
      behaviorActions: input.preview.actions.behaviors,
      scheduleActions: input.preview.actions.schedules,
      behaviorActionIndex: actionIndex.behavior,
      scheduleActionIndex: actionIndex.schedule,
      behaviorIdByExternal,
      scheduleIdByExternal,
      existingBehaviors: input.existing.behaviors ?? [],
      restoreRecordedAt,
      behaviorTimezones: new Map(input.importPreview.plan.occurrences
        .map((occurrence) => [occurrence.behaviorExternalId, occurrence.timezone] as const)),
    });

  return {
    payload: {
      preconditions,
      archive_behavior_ids: input.preview.actions.behaviors
        .filter((action) => action.action === "archive")
        .map(requiredLocalId),
      delete_schedule_ids: input.preview.actions.schedules
        .filter((action) => action.action === "delete")
        .map(requiredLocalId),
      delete_occurrence_ids: input.preview.actions.occurrences
        .filter((action) => action.action === "delete")
        .map(requiredLocalId),
      delete_status_event_ids: [],
      clear_occurrence_note_ids: input.preview.actions.inlineOccurrenceNotes
        .filter((action) => action.action === "delete")
        .map(requiredLocalId),
      delete_imported_note_ids: input.preview.actions.importedNotes
        .filter((action) => action.action === "delete")
        .map(requiredLocalId),
      delete_imported_intervention_ids:
        input.preview.actions.importedInterventions
          .filter((action) => action.action === "delete")
          .map(requiredLocalId),
      behaviors: input.importPreview.plan.behaviors
        .filter((behavior) =>
          shouldUpsert(actionIndex.behavior.get(behavior.externalId)),
        )
        .map((behavior) => {
          const schedules = input.importPreview.plan.schedules.filter(
            (schedule) =>
              schedule.behaviorExternalId === behavior.externalId &&
              shouldUpsert(actionIndex.schedule.get(schedule.externalId)),
          );
          const primarySchedule = schedules[0];
          const opportunityBehaviorId = behaviorIdByExternal.get(behavior.externalId);
          // Behaviors of Opportunity: an opportunity Behavior may have no schedule.
          const isOpportunity = behavior.cadenceIsOpportunity
            ?? (opportunityBehaviorId ? existingBehaviorById.get(opportunityBehaviorId)?.isOpportunity : undefined);

          if (!primarySchedule && isOpportunity !== true) {
            throw new BehaviorLogRestoreUserError(
              `Behavior ${behavior.externalId} cannot be restored without a supported schedule.`,
            );
          }

          const definition = normalizeBehaviorDefinition({
            title: behavior.title,
            description: behavior.description,
          });
          const action = actionIndex.behavior.get(behavior.externalId);
          const behaviorId = requiredMapValue(
            behaviorIdByExternal,
            behavior.externalId,
            "restored behavior",
          );
          const definitionEvent =
            behaviorDefinitionEventByBehaviorId.get(behaviorId);
          const existingBehavior = existingBehaviorById.get(behaviorId);
          const reminderConfiguration = resolveRestoreReminderConfiguration(
            behavior,
            input.importPreview.plan.interventionRules,
          );

          if (!definitionEvent && !existingBehavior) {
            throw new BehaviorLogRestoreUserError(
              `Behavior ${behavior.externalId} cannot be restored without an initial definition event.`,
            );
          }

          return {
            id: behaviorId,
            external_id: behavior.externalId,
            category_id: null,
            category_description: input.importPreview.portability?.categories?.find((category) =>
              category.name.trim().toLowerCase() === (behavior.cadenceCategoryName?.trim() || behavior.category || "").toLowerCase())?.description ?? null,
            category_name:
              behavior.cadenceCategoryName?.trim() || behavior.category,
            title:
              definitionEvent?.next_title ??
              existingBehavior?.title ??
              definition.title,
            description:
              definitionEvent?.next_description ??
              existingBehavior?.description ??
              definition.description,
            recurrence_rule: primarySchedule ? toCadenceRecurrenceRule(primarySchedule) : null,
            scheduled_time: primarySchedule
              ? primarySchedule.localTime ?? primarySchedule.windowStartLocal
              : null,
            timezone: primarySchedule?.timezone
              || input.importPreview.plan.occurrences.find((occurrence) =>
                occurrence.behaviorExternalId === behavior.externalId)?.timezone
              || DEFAULT_TIMEZONE,
            ...(behavior.cadenceIsOpportunity === undefined
              ? {}
              : { is_opportunity: behavior.cadenceIsOpportunity }),
            browser_reminder_enabled:
              reminderConfiguration.browserReminderEnabled,
            email_reminder_enabled:
              reminderConfiguration.emailReminderEnabled,
            reminder_offset_minutes:
              reminderConfiguration.reminderOffsetMinutes,
            active: behavior.archivedAtUtc === null,
            archived_at: behavior.archivedAtUtc,
            ...(behavior.cadenceArchiveNotes === undefined
              ? {}
              : { archive_notes: serializeArchiveNotes(behavior.cadenceArchiveNotes) }),
            ...(behavior.expectedDurationMinutes === undefined
              ? {}
              : { default_duration_minutes: behavior.expectedDurationMinutes }),
            ...(behavior.cadenceRun === undefined
              ? {}
              : storedRunColumns(behavior.cadenceRun)),
            ...(behavior.cadenceAutoArchivedAt === undefined
              ? {}
              : { auto_archived_at: behavior.cadenceAutoArchivedAt }),
            ...restoredSubBehaviorLink(behavior, behaviorIdByExternal),
            created_at:
              action?.action === "create"
                ? behavior.createdAtUtc ?? restoreRecordedAt
                : behavior.createdAtUtc,
          };
        }),
      behavior_definition_events: behaviorDefinitionEvents,
      behavior_configuration_events: behaviorConfigurationPayloads.events,
      schedules: input.importPreview.plan.schedules
        .filter((schedule) =>
          shouldUpsert(actionIndex.schedule.get(schedule.externalId)),
        )
        .map((schedule) => {
          const behaviorSchedules = input.importPreview.plan.schedules.filter(
            (candidate) =>
              candidate.behaviorExternalId === schedule.behaviorExternalId &&
              shouldUpsert(actionIndex.schedule.get(candidate.externalId)),
          );
          const groupKey = restoreScheduleGroupKey(schedule);
          const groupKeys = Array.from(
            new Set(behaviorSchedules.map(restoreScheduleGroupKey)),
          );
          const groupSchedules = behaviorSchedules.filter(
            (candidate) => restoreScheduleGroupKey(candidate) === groupKey,
          );

          return {
          id: scheduleIdByExternal.get(schedule.externalId),
          external_id: schedule.externalId,
          behavior_id: requiredMapValue(
            behaviorIdByExternal,
            schedule.behaviorExternalId,
            "schedule behavior",
          ),
          kind: schedule.cadenceScheduleKind ?? "exact",
          preset: schedule.cadenceSchedulePreset,
          start_time: schedule.localTime ?? schedule.windowStartLocal,
          end_time: schedule.windowEndLocal,
          sort_order: groupSchedules.findIndex(
            (candidate) => candidate.externalId === schedule.externalId,
          ),
          configuration_sort_order: groupKeys.indexOf(groupKey),
          parent_group_key: groupKey,
          recurrence_rule: toCadenceRecurrenceRule(schedule),
          };
        }),
      occurrences: input.importPreview.plan.occurrences
        .filter((occurrence) =>
          shouldUpsert(actionIndex.occurrence.get(occurrence.externalId)),
        )
        .map((occurrence) => {
          const latestEventExternalId = latestStatusEventByOccurrence.get(
            occurrence.externalId,
          );
          const latestEvent = latestEventExternalId
            ? input.importPreview.plan.statusEvents.find(
                (event) => event.externalId === latestEventExternalId,
              )
            : null;
          const schedule = input.importPreview.plan.schedules.find(
            (candidate) =>
              candidate.externalId === occurrence.scheduleExternalId,
          );

          if (!schedule) {
            throw new BehaviorLogRestoreUserError(
              `Occurrence ${occurrence.externalId} cannot be restored without its schedule.`,
            );
          }

          return {
            id: occurrenceIdByExternal.get(occurrence.externalId),
            external_id: occurrence.externalId,
            behavior_id: requiredMapValue(
              behaviorIdByExternal,
              occurrence.behaviorExternalId,
              "occurrence behavior",
            ),
            behavior_schedule_slot_id:
              occurrence.importWithDetachedScheduleSnapshot
                ? null
                : requiredMapValue(
                    scheduleIdByExternal,
                    occurrence.scheduleExternalId,
                    "occurrence schedule",
                  ),
            scheduled_for: occurrence.scheduledForUtc,
            local_date: occurrence.localDate,
            schedule_kind: schedule.cadenceScheduleKind ?? "exact",
            schedule_preset: schedule.cadenceSchedulePreset,
            schedule_start_time: schedule.localTime ?? schedule.windowStartLocal,
            schedule_end_time: schedule.windowEndLocal,
            status: occurrence.currentStatus,
            completed_at:
              occurrence.currentStatus === "completed"
                ? latestEvent?.effectiveAtUtc ??
                  latestEvent?.recordedAtUtc ??
                  null
                : null,
            status_marked_at:
              occurrence.currentStatus === "unresolved"
                ? null
                : latestEvent?.recordedAtUtc ?? null,
            note: inlineNoteByOccurrence.get(occurrence.externalId) ?? null,
            // The restore update writes origin, so it must never fall back to "scheduled"
            // for a row the bundle does not describe: keep the stored provenance.
            ...restoredOccurrenceOrigin(
              occurrence,
              existingOccurrenceById.get(occurrenceIdByExternal.get(occurrence.externalId) ?? ""),
            ),
            created_at: occurrence.generatedAtUtc,
          };
        }),
      status_events: input.importPreview.plan.statusEvents
        .filter(
          (event) =>
            actionIndex.status_event.get(event.externalId)?.action === "create",
        )
        .map((event) => ({
          id: statusEventIdByExternal.get(event.externalId),
          external_id: event.externalId,
          occurrence_id: requiredMapValue(
            occurrenceIdByExternal,
            event.occurrenceExternalId,
            "status event occurrence",
          ),
          behavior_id: requiredMapValue(
            behaviorIdByExternal,
            event.behaviorExternalId,
            "status event behavior",
          ),
          previous_status: event.previousStatus,
          status: event.status,
          status_semantics: event.statusSemantics,
          recorded_at: event.recordedAtUtc,
          effective_at: event.effectiveAtUtc,
          local_date: event.localDate,
          timezone: event.timezone,
          source_capture_method: event.sourceCaptureMethod,
          source_confidence: event.sourceConfidence,
          revises_event_id: event.revisesEventId
            ? statusEventIdByExternal.get(event.revisesEventId) ?? null
            : null,
          reason_code: event.reasonCode,
        })),
      time_sessions: (input.importPreview.plan.timeSessions ?? [])
        .filter((session) => {
          const action = actionIndex.time_session.get(session.externalId);
          return action?.action === "create" || action?.action === "replace";
        })
        .map((session) => ({
          id: requiredMapValue(
            timeSessionIdByExternal,
            session.externalId,
            "time session id",
          ),
          external_id: session.externalId,
          occurrence_id: requiredMapValue(
            occurrenceIdByExternal,
            session.occurrenceExternalId,
            "time session occurrence",
          ),
          behavior_id: requiredMapValue(
            behaviorIdByExternal,
            session.behaviorExternalId,
            "time session behavior",
          ),
          started_at: session.startedAtUtc,
          stopped_at: session.stoppedAtUtc,
        }))
        .sort((left, right) => {
          if ((left.stopped_at === null) !== (right.stopped_at === null)) {
            return left.stopped_at === null ? 1 : -1;
          }
          return `${left.started_at}:${left.id}`.localeCompare(
            `${right.started_at}:${right.id}`,
          );
        }),
      imported_notes: input.importPreview.plan.notes
        .filter((note) => shouldUpsert(actionIndex.note.get(note.externalId)))
        .map((note) => ({
          id: requiredMapValue(noteIdByExternal, note.externalId, "note id"),
          import_run_id: input.importRunId,
          external_id: note.externalId,
          target_type: note.attachedToType,
          target_external_id: note.attachedToId,
          target_local_id: localTargetIdForNote({
            note,
            behaviorIdByExternal,
            occurrenceIdByExternal,
            statusEventIdByExternal,
          }),
          body_markdown: note.bodyMarkdown,
          note_role: note.noteRole,
          sensitivity: note.sensitivity,
          source_original_id: note.sourceOriginalId,
          source_capture_method: note.sourceCaptureMethod,
          source_confidence: note.sourceConfidence,
          imported_created_at: note.createdAtUtc,
          imported_updated_at: note.updatedAtUtc,
          metadata: { restored_from_behaviorlog: true },
        })),
      imported_interventions: input.importPreview.plan.interventions
        .filter((intervention) =>
          shouldUpsert(actionIndex.intervention.get(intervention.externalId)),
        )
        .map((intervention) => ({
          id: requiredMapValue(
            interventionIdByExternal,
            intervention.externalId,
            "intervention id",
          ),
          import_run_id: input.importRunId,
          external_id: intervention.externalId,
          behavior_external_id: intervention.behaviorExternalId,
          occurrence_external_id: intervention.occurrenceExternalId,
          behavior_id:
            behaviorIdByExternal.get(intervention.behaviorExternalId) ?? null,
          occurrence_id:
            occurrenceIdByExternal.get(intervention.occurrenceExternalId) ??
            null,
          intervention_type: intervention.interventionType,
          channel: intervention.channel,
          delivery_status: intervention.deliveryStatus,
          scheduled_send_at: intervention.scheduledSendAtUtc,
          sent_at: intervention.sentAtUtc,
          failure_reason: intervention.failureReason,
          source_original_id: intervention.sourceOriginalId,
          source_capture_method: intervention.sourceCaptureMethod,
          source_confidence: intervention.sourceConfidence,
          redacted_sensitivity_indicators: {
            droppedSensitiveFields:
              intervention.storageDecision.droppedSensitiveFields,
            redactedFields: intervention.storageDecision.redactedFields,
          },
          metadata: { restored_from_behaviorlog: true },
        })),
    },
    mappings,
  };
}

function buildRestoreRowPreconditions(input: {
  preview: BehaviorLogRestorePreview;
  existing: BehaviorLogExistingRecords;
  behaviorIdByExternal: Map<string, string>;
  scheduleIdByExternal: Map<string, string>;
  occurrenceIdByExternal: Map<string, string>;
  statusEventIdByExternal: Map<string, string>;
  noteIdByExternal: Map<string, string>;
  interventionIdByExternal: Map<string, string>;
  definitionEventIdByExternal: Map<string, string>;
  timeSessionIdByExternal: Map<string, string>;
}): RestoreRowPrecondition[] {
  const preconditions = new Map<string, RestoreRowPrecondition>();

  const add = (entry: RestoreRowPrecondition): void => {
    const key = `${entry.record_type}:${entry.local_id}`;
    const existing = preconditions.get(key);

    if (existing && JSON.stringify(existing) !== JSON.stringify(entry)) {
      throw new BehaviorLogRestoreUserError(
        `Restore preview has conflicting preconditions for ${entry.record_type} ${entry.local_id}.`,
      );
    }

    preconditions.set(key, entry);
  };
  const addAction = (
    action: BehaviorLogRestoreAction,
    recordType: RestoreRowPrecondition["record_type"],
    createdIds: Map<string, string>,
    existingRows: Array<{ id: string; rowUpdatedAtUtc?: string | null }>,
  ): void => {
    if (action.action === "skip") {
      return;
    }

    if (action.action === "create") {
      if (!action.externalId) {
        throw new BehaviorLogRestoreUserError(
          `Restore create action for ${recordType} is missing its external id.`,
        );
      }

      add({
        record_type: recordType,
        local_id: requiredMapValue(
          createdIds,
          action.externalId,
          `${recordType} create precondition`,
        ),
        expectation: "absent",
        expected_updated_at: null,
      });
      return;
    }

    const localId = requiredLocalId(action);
    const existing = existingRows.find((row) => row.id === localId);
    const expectedUpdatedAt = existing?.rowUpdatedAtUtc;

    if (!existing || !expectedUpdatedAt) {
      throw new BehaviorLogRestoreUserError(
        `Local ${recordType} ${localId} is missing its restore concurrency marker. Preview the restore again.`,
      );
    }

    add({
      record_type: recordType,
      local_id: localId,
      expectation: "unchanged",
      expected_updated_at: expectedUpdatedAt,
    });
  };

  for (const action of input.preview.actions.behaviors) {
    addAction(
      action,
      "behavior",
      input.behaviorIdByExternal,
      input.existing.behaviors ?? [],
    );
  }

  for (const action of input.preview.actions.schedules) {
    addAction(
      action,
      "schedule",
      input.scheduleIdByExternal,
      input.existing.schedules ?? [],
    );
  }

  for (const action of input.preview.actions.occurrences) {
    addAction(
      action,
      "occurrence",
      input.occurrenceIdByExternal,
      input.existing.occurrences ?? [],
    );
  }

  for (const action of input.preview.actions.inlineOccurrenceNotes) {
    if (action.action === "skip" || action.action === "keep") {
      continue;
    }

    if (action.action === "create" && action.localId === null) {
      continue;
    }

    const localId = requiredLocalId(action);
    const existing = (input.existing.occurrences ?? []).find(
      (row) => row.id === localId,
    );

    if (!existing?.rowUpdatedAtUtc) {
      throw new BehaviorLogRestoreUserError(
        `Local occurrence ${localId} is missing its restore concurrency marker. Preview the restore again.`,
      );
    }

    add({
      record_type: "occurrence",
      local_id: localId,
      expectation: "unchanged",
      expected_updated_at: existing.rowUpdatedAtUtc,
    });
  }

  for (const action of input.preview.actions.statusEvents) {
    if (action.action !== "create") {
      continue;
    }

    addAction(
      action,
      "status_event",
      input.statusEventIdByExternal,
      input.existing.statusEvents ?? [],
    );
  }

  for (const action of input.preview.actions.definitionEvents ?? []) {
    if (action.action !== "create") {
      continue;
    }

    add({
      record_type: "behavior_definition_event",
      local_id: requiredMapValue(
        input.definitionEventIdByExternal,
        action.externalId ?? "",
        "definition event create precondition",
      ),
      expectation: "absent",
      expected_updated_at: null,
    });
  }

  for (const action of input.preview.actions.timeSessions ?? []) {
    if (action.action !== "create") {
      continue;
    }

    add({
      record_type: "time_session",
      local_id: requiredMapValue(
        input.timeSessionIdByExternal,
        action.externalId ?? "",
        "time session create precondition",
      ),
      expectation: "absent",
      expected_updated_at: null,
    });
  }

  for (const action of input.preview.actions.importedNotes) {
    addAction(
      action,
      "note",
      input.noteIdByExternal,
      input.existing.importedNotes ?? [],
    );
  }

  for (const action of input.preview.actions.importedInterventions) {
    addAction(
      action,
      "intervention",
      input.interventionIdByExternal,
      input.existing.importedInterventions ?? [],
    );
  }

  return [...preconditions.values()].sort((left, right) =>
    `${left.record_type}:${left.local_id}`.localeCompare(
      `${right.record_type}:${right.local_id}`,
    ),
  );
}

function buildRestoreBehaviorDefinitionEvents(input: {
  behaviorPlans: BehaviorLogImportBehaviorPlan[];
  definitionEventPlans: BehaviorLogImportDefinitionEventPlan[];
  actionIndex: Map<string, BehaviorLogRestoreAction>;
  definitionEventActionIndex: Map<string, BehaviorLogRestoreAction>;
  behaviorIdByExternal: Map<string, string>;
  definitionEventIdByExternal: Map<string, string>;
  existingBehaviors: NonNullable<BehaviorLogExistingRecords["behaviors"]>;
  restoreRecordedAt: string;
  userId: string;
  bundleFingerprint: string;
}): RestoreBehaviorDefinitionEventPayload[] {
  const events: RestoreBehaviorDefinitionEventPayload[] = [];

  for (const behavior of input.behaviorPlans) {
    const action = input.actionIndex.get(behavior.externalId);

    if (!action || action.action === "skip" || action.action === "archive") {
      continue;
    }

    const behaviorId = requiredMapValue(
      input.behaviorIdByExternal,
      behavior.externalId,
      "definition event behavior",
    );
    const importedEvents = input.definitionEventPlans
      .filter(
        (event) =>
          event.behaviorExternalId === behavior.externalId &&
          input.definitionEventActionIndex.get(event.externalId)?.action ===
            "create",
      )
      .sort(compareDefinitionEventPlans);
    const hasImportedBaseline = input.definitionEventPlans.some(
      (event) =>
        event.behaviorExternalId === behavior.externalId &&
        event.eventKind === "baseline" &&
        input.definitionEventActionIndex.get(event.externalId)?.action !==
          "skip",
    );

    if (!hasImportedBaseline && action.action !== "keep") {
      const nextDefinition = normalizeBehaviorDefinition({
        title: behavior.title,
        description: behavior.description,
      });
      const existingBehavior = input.existingBehaviors.find(
        (candidate) => candidate.id === behaviorId,
      );
      const previousDefinition = existingBehavior
        ? normalizeBehaviorDefinition({
            title: existingBehavior.title,
            description: existingBehavior.description ?? null,
          })
        : null;
      const plan = previousDefinition
        ? planBehaviorDefinitionChangeEvent({
            previousDefinition,
            nextDefinition,
            recordedAt: input.restoreRecordedAt,
            source: "import",
            reason: "behaviorlog_restore",
          })
        : planInitialBehaviorDefinitionEvent({
            definition: nextDefinition,
            recordedAt: behavior.createdAtUtc ?? input.restoreRecordedAt,
            source: "import",
            reason: "behaviorlog_restore",
          });

      if (!plan) {
        continue;
      }

      events.push({
        ...toRestoreBehaviorDefinitionEventPayload({
          behaviorId,
          eventKind: previousDefinition ? "transition" : "baseline",
          plan,
          expectedPreviousDefinition: previousDefinition,
        }),
        id: deterministicRestoreUuid([
          "behaviorlog_restore",
          input.userId,
          input.bundleFingerprint,
          "synthetic_behavior_definition_event",
          behavior.externalId,
        ]),
        external_id: null,
      });
    }

    for (const event of importedEvents) {
      events.push({
        id: requiredMapValue(
          input.definitionEventIdByExternal,
          event.externalId,
          "definition event id",
        ),
        external_id: event.externalId,
        event_kind: event.eventKind === "baseline" ? "baseline" : "transition",
        behavior_id: behaviorId,
        previous_title: event.previousTitle,
        next_title: event.nextTitle as string,
        previous_description: event.previousDescription,
        next_description: event.nextDescription,
        changed_fields: event.changedFields,
        recorded_at: event.recordedAtUtc,
        source: "import",
        reason: event.reasonCode,
        expected_previous_title: event.previousTitle,
        expected_previous_description: event.previousDescription,
      });
    }
  }

  return events.sort((left, right) =>
    `${left.recorded_at}:${left.id}`.localeCompare(
      `${right.recorded_at}:${right.id}`,
    ),
  );
}

function buildRestoreBehaviorConfigurationPayloads(input: {
  behaviorPlans: BehaviorLogImportBehaviorPlan[];
  schedulePlans: BehaviorLogImportSchedulePlan[];
  interventionRulePlans: BehaviorLogImportInterventionRulePlan[] | undefined;
  behaviorActions: BehaviorLogRestoreAction[];
  scheduleActions: BehaviorLogRestoreAction[];
  behaviorActionIndex: Map<string, BehaviorLogRestoreAction>;
  scheduleActionIndex: Map<string, BehaviorLogRestoreAction>;
  behaviorIdByExternal: Map<string, string>;
  scheduleIdByExternal: Map<string, string>;
  existingBehaviors: NonNullable<BehaviorLogExistingRecords["behaviors"]>;
  restoreRecordedAt: string;
  /** An unscheduled Behavior's timezone, read from its Occurrences. */
  behaviorTimezones: ReadonlyMap<string, string>;
}): {
  events: Array<Record<string, unknown>>;
} {
  const existingById = new Map(
    input.existingBehaviors.map((behavior) => [behavior.id, behavior]),
  );
  const events: Array<Record<string, unknown>> = [];
  const plannedBehaviorIds = new Set<string>();
  const deletedScheduleIds = new Set(
    input.scheduleActions
      .filter((action) => action.action === "delete")
      .map(requiredLocalId),
  );

  for (const behavior of input.behaviorPlans) {
    const action = input.behaviorActionIndex.get(behavior.externalId);

    if (!shouldUpsert(action)) {
      continue;
    }

    const behaviorId = requiredMapValue(
      input.behaviorIdByExternal,
      behavior.externalId,
      "configuration history behavior",
    );
    const schedules = input.schedulePlans.filter(
      (schedule) =>
        schedule.behaviorExternalId === behavior.externalId &&
        shouldUpsert(input.scheduleActionIndex.get(schedule.externalId)),
    );
    const primarySchedule = schedules[0];
    const isOpportunity = behavior.cadenceIsOpportunity
      ?? existingById.get(behaviorId)?.isOpportunity ?? false;

    if (!primarySchedule && !isOpportunity) {
      throw new BehaviorLogRestoreUserError(
        `Behavior ${behavior.externalId} cannot restore configuration history without a schedule.`,
      );
    }

    const graph = groupRestoreSchedules(schedules).map((group, index) => ({
      recurrenceRule: toCadenceRecurrenceRule(group[0]),
      sortOrder: index,
      timeEntries: group.map((schedule, slotIndex) => ({
        id: requiredMapValue(
          input.scheduleIdByExternal,
          schedule.externalId,
          "configuration history schedule",
        ),
        kind: schedule.cadenceScheduleKind ?? "exact",
        preset: schedule.cadenceSchedulePreset,
        startTime: schedule.localTime ?? schedule.windowStartLocal ?? "",
        endTime: schedule.windowEndLocal,
        sortOrder: slotIndex,
      })),
    }));
    const reminderConfiguration = resolveRestoreReminderConfiguration(
      behavior,
      input.interventionRulePlans,
    );
    const nextConfiguration = {
      categoryId: null,
      scheduleGraph: graph,
      browserReminderEnabled:
        reminderConfiguration.browserReminderEnabled,
      emailReminderEnabled: reminderConfiguration.emailReminderEnabled,
      reminderOffsetMinutes: reminderConfiguration.reminderOffsetMinutes,
      active: behavior.archivedAtUtc === null,
      timezone: primarySchedule?.timezone || input.behaviorTimezones.get(behavior.externalId) || DEFAULT_TIMEZONE,
      isOpportunity,
    };
    const previousConfiguration =
      existingById.get(behaviorId)?.configurationSnapshot ?? null;
    const eventPlan =
      action?.action === "create"
        ? planInitialBehaviorConfigurationEvent({
            configuration: nextConfiguration,
            recordedAt: input.restoreRecordedAt,
            effectiveAt: input.restoreRecordedAt,
            source: "import",
            reasonCode: "behaviorlog_restore",
          })
        : previousConfiguration
          ? planBehaviorConfigurationChangeEvent({
              previousConfiguration,
              nextConfiguration,
              recordedAt: input.restoreRecordedAt,
              effectiveAt: input.restoreRecordedAt,
              source: "import",
              reasonCode: "behaviorlog_restore",
            })
          : null;

    if (action?.action !== "create" && !previousConfiguration) {
      throw new BehaviorLogRestoreUserError(
        `Behavior ${behavior.externalId} is missing its prior configuration snapshot.`,
      );
    }

    if (eventPlan) {
      events.push({
        behavior_id: behaviorId,
        ...(toBehaviorConfigurationEventPlanPayload(eventPlan) as Record<
          string,
          unknown
        >),
      });
    }

    plannedBehaviorIds.add(behaviorId);
  }

  for (const action of input.behaviorActions) {
    if (action.action !== "archive") {
      continue;
    }

    const behaviorId = requiredLocalId(action);

    if (plannedBehaviorIds.has(behaviorId)) {
      continue;
    }

    const previousConfiguration =
      existingById.get(behaviorId)?.configurationSnapshot;

    if (!previousConfiguration) {
      throw new BehaviorLogRestoreUserError(
        `Archived behavior ${behaviorId} is missing its prior configuration snapshot.`,
      );
    }

    const eventPlan = planBehaviorConfigurationChangeEvent({
      previousConfiguration,
      nextConfiguration: {
        ...previousConfiguration,
        active: false,
      },
      recordedAt: input.restoreRecordedAt,
      effectiveAt: input.restoreRecordedAt,
      source: "import",
      reasonCode: "behaviorlog_restore",
    });

    if (eventPlan) {
      events.push({
        behavior_id: behaviorId,
        ...(toBehaviorConfigurationEventPlanPayload(eventPlan) as Record<
          string,
          unknown
        >),
      });
    }

    plannedBehaviorIds.add(behaviorId);
  }

  for (const existing of input.existingBehaviors) {
    const previousConfiguration = existing.configurationSnapshot;

    if (!previousConfiguration || plannedBehaviorIds.has(existing.id)) {
      continue;
    }

    const nextScheduleGraph = removeDeletedScheduleEntries(
      previousConfiguration.scheduleGraph,
      deletedScheduleIds,
    );

    if (nextScheduleGraph.length === previousConfiguration.scheduleGraph.length &&
      nextScheduleGraph.every(
        (schedule, index) =>
          schedule.timeEntries.length ===
          previousConfiguration.scheduleGraph[index]?.timeEntries.length,
      )) {
      continue;
    }

    const eventPlan = planBehaviorConfigurationChangeEvent({
      previousConfiguration,
      nextConfiguration: {
        ...previousConfiguration,
        scheduleGraph: nextScheduleGraph,
      },
      recordedAt: input.restoreRecordedAt,
      effectiveAt: input.restoreRecordedAt,
      source: "import",
      reasonCode: "behaviorlog_restore",
    });

    if (!eventPlan) {
      continue;
    }

    events.push({
      behavior_id: existing.id,
      ...(toBehaviorConfigurationEventPlanPayload(eventPlan) as Record<
        string,
        unknown
      >),
    });
    plannedBehaviorIds.add(existing.id);
  }

  return { events };
}

function removeDeletedScheduleEntries(
  scheduleGraph: BehaviorConfigurationSchedule[],
  deletedScheduleIds: Set<string>,
): BehaviorConfigurationSchedule[] {
  return scheduleGraph.flatMap((schedule) => {
    const timeEntries = schedule.timeEntries.filter(
      (entry) => !entry.id || !deletedScheduleIds.has(entry.id),
    );

    return timeEntries.length > 0 ? [{ ...schedule, timeEntries }] : [];
  });
}

function toRestoreBehaviorDefinitionEventPayload(input: {
  behaviorId: string;
  eventKind: "baseline" | "transition";
  plan: BehaviorDefinitionEventPlan;
  expectedPreviousDefinition: BehaviorDefinition | null;
}): Omit<RestoreBehaviorDefinitionEventPayload, "id" | "external_id"> {
  return {
    event_kind: input.eventKind,
    behavior_id: input.behaviorId,
    previous_title: input.plan.previousTitle,
    next_title: input.plan.nextTitle,
    previous_description: input.plan.previousDescription,
    next_description: input.plan.nextDescription,
    changed_fields: input.plan.changedFields,
    recorded_at: input.plan.recordedAt,
    source: "import",
    reason: "behaviorlog_restore",
    expected_previous_title: input.expectedPreviousDefinition?.title ?? null,
    expected_previous_description:
      input.expectedPreviousDefinition?.description ?? null,
  };
}

function compareDefinitionEventPlans(
  left: BehaviorLogImportDefinitionEventPlan,
  right: BehaviorLogImportDefinitionEventPlan,
): number {
  return `${left.recordedAtUtc}:${left.externalId}`.localeCompare(
    `${right.recordedAtUtc}:${right.externalId}`,
  );
}

function latestDefinitionEventByBehavior(
  events: RestoreBehaviorDefinitionEventPayload[],
): Map<string, RestoreBehaviorDefinitionEventPayload> {
  const latest = new Map<string, RestoreBehaviorDefinitionEventPayload>();

  for (const event of events) {
    latest.set(event.behavior_id, event);
  }

  return latest;
}

function restoreScheduleGroupKey(
  schedule: BehaviorLogImportSchedulePlan,
): string {
  return schedule.cadenceBehaviorScheduleId?.trim() || schedule.externalId;
}

function groupRestoreSchedules(
  schedules: BehaviorLogImportSchedulePlan[],
): BehaviorLogImportSchedulePlan[][] {
  const groups = new Map<string, BehaviorLogImportSchedulePlan[]>();

  for (const schedule of schedules) {
    const key = restoreScheduleGroupKey(schedule);
    const group = groups.get(key);

    if (group) {
      group.push(schedule);
    } else {
      groups.set(key, [schedule]);
    }
  }

  return [...groups.values()];
}

function resolveRestoreReminderConfiguration(
  behavior: BehaviorLogImportBehaviorPlan,
  interventionRules: BehaviorLogImportInterventionRulePlan[] | undefined,
): {
  browserReminderEnabled: boolean;
  emailReminderEnabled: boolean;
  reminderOffsetMinutes: number;
} {
  if (interventionRules === undefined) {
    return {
      browserReminderEnabled:
        behavior.cadenceBrowserReminderEnabled ?? true,
      emailReminderEnabled: behavior.cadenceEmailReminderEnabled ?? false,
      reminderOffsetMinutes: behavior.cadenceReminderOffsetMinutes ?? 0,
    };
  }

  const rules = interventionRules.filter(
    (rule) =>
      rule.action !== "skip" &&
      rule.behaviorExternalId === behavior.externalId &&
      rule.interventionType === "reminder",
  );
  const browserRule = rules.find((rule) => rule.channel === "browser_push");
  const emailRule = rules.find((rule) => rule.channel === "email");
  const enabledOffset = [browserRule, emailRule].find(
    (rule) => rule?.enabled && rule.offsetMinutes !== null,
  )?.offsetMinutes;

  return {
    browserReminderEnabled: browserRule?.enabled ?? false,
    emailReminderEnabled: emailRule?.enabled ?? false,
    reminderOffsetMinutes: Math.max(0, -(enabledOffset ?? 0)),
  };
}

function indexRestoreActions(preview: BehaviorLogRestorePreview): Record<
  | "behavior"
  | "schedule"
  | "occurrence"
  | "status_event"
  | "behavior_definition_event"
  | "time_session"
  | "note"
  | "intervention",
  Map<string, BehaviorLogRestoreAction>
> {
  return {
    behavior: indexByExternalId(preview.actions.behaviors),
    schedule: indexByExternalId(preview.actions.schedules),
    occurrence: indexByExternalId(preview.actions.occurrences),
    status_event: indexByExternalId(preview.actions.statusEvents),
    behavior_definition_event: indexByExternalId(
      preview.actions.definitionEvents ?? [],
    ),
    time_session: indexByExternalId(preview.actions.timeSessions ?? []),
    note: indexByExternalId(preview.actions.importedNotes),
    intervention: indexByExternalId(preview.actions.importedInterventions),
  };
}

function indexByExternalId(
  actions: BehaviorLogRestoreAction[],
): Map<string, BehaviorLogRestoreAction> {
  return new Map(
    actions
      .filter((action) => action.externalId)
      .map((action) => [action.externalId as string, action]),
  );
}

function shouldUpsert(action: BehaviorLogRestoreAction | undefined): boolean {
  return Boolean(
    action &&
      (action.action === "create" ||
        action.action === "replace" ||
        action.action === "keep"),
  );
}

export function deriveBehaviorLogRestoreLocalId(
  action: BehaviorLogRestoreAction,
  input: {
    externalId: string;
    label: string;
    recordType: BehaviorLogImportRecordMappingInput["recordType"];
    userId: string;
    bundleFingerprint: string;
  },
): string {
  if (action.action === "create") {
    return deterministicRestoreUuid([
      "behaviorlog_restore",
      input.userId,
      input.bundleFingerprint,
      input.recordType,
      input.externalId,
    ]);
  }

  const id = action.localId;

  if (id && isUuid(id)) {
    return id;
  }

  if (!id || !isUuid(id)) {
    throw new BehaviorLogRestoreUserError(
      `Restore action for ${input.label} ${input.externalId} is missing a safe local id.`,
    );
  }

  return id;
}

function restoreMapping(
  input: {
    userId: string;
    importRunId: string;
  },
  recordType: BehaviorLogImportRecordMappingInput["recordType"],
  externalId: string,
  localId: string,
): BehaviorLogImportRecordMappingInput {
  return {
    userId: input.userId,
    importRunId: input.importRunId,
    recordType,
    externalId,
    localId,
  };
}

function deterministicRestoreUuid(parts: string[]): string {
  const bytes = sha256(parts.join("\0")).slice(0, 32).match(/../g)!.map((byte) => Number.parseInt(byte, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

function requiredLocalId(action: BehaviorLogRestoreAction): string {
  if (!action.localId || !isUuid(action.localId)) {
    throw new BehaviorLogRestoreUserError(
      `Restore action for ${action.recordType} is missing a safe local id.`,
    );
  }

  return action.localId;
}

function requiredMapValue(
  map: Map<string, string>,
  key: string,
  label: string,
): string {
  const value = map.get(key);

  if (!value) {
    throw new BehaviorLogRestoreUserError(`Restore payload is missing ${label}.`);
  }

  return value;
}

function localTargetIdForNote(input: {
  note: BehaviorLogImportNotePlan;
  behaviorIdByExternal: Map<string, string>;
  occurrenceIdByExternal: Map<string, string>;
  statusEventIdByExternal: Map<string, string>;
}): string | null {
  switch (input.note.attachedToType) {
    case "behavior":
      return input.behaviorIdByExternal.get(input.note.attachedToId) ?? null;
    case "occurrence":
      return input.occurrenceIdByExternal.get(input.note.attachedToId) ?? null;
    case "status_event":
      return input.statusEventIdByExternal.get(input.note.attachedToId) ?? null;
    case "review":
      return null;
  }
}

export function toCadenceRecurrenceRule(
  schedule: BehaviorLogImportSchedulePlan,
): Json {
  const recurrence = schedule.recurrence;

  switch (recurrence.type) {
    case "daily":
      return { frequency: "daily", interval: readPositiveInt(recurrence.interval) ?? 1 };
    case "every_n_days":
      return {
        frequency: "interval_days",
        intervalDays: readPositiveInt(recurrence.interval) ?? 1,
      };
    case "weekly_on_weekdays":
      return {
        frequency: "weekly",
        interval: 1,
        daysOfWeek: readWeekdays(recurrence.weekdays),
      };
    case "every_n_weeks_on_weekdays":
      return {
        frequency: "weekly",
        interval: readPositiveInt(recurrence.interval) ?? 1,
        daysOfWeek: readWeekdays(recurrence.weekdays),
      };
    case "monthly_on_day":
      return {
        frequency: "monthly",
        interval: readPositiveInt(recurrence.interval) ?? 1,
        dayOfMonth: readPositiveInt(recurrence.day) ?? 1,
      };
    default:
      throw new BehaviorLogRestoreUserError(
        `Schedule ${schedule.externalId} uses an unsupported recurrence shape.`,
      );
  }
}

function readPositiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}

function readWeekdays(value: unknown): Weekday[] {
  const weekdays = Array.isArray(value)
    ? value.filter((day): day is Weekday => isWeekday(day))
    : [];

  if (weekdays.length === 0) {
    throw new BehaviorLogRestoreUserError(
      "Weekly restore schedules must include at least one supported weekday.",
    );
  }

  return weekdays;
}

function isWeekday(value: unknown): value is Weekday {
  return (
    value === "monday" ||
    value === "tuesday" ||
    value === "wednesday" ||
    value === "thursday" ||
    value === "friday" ||
    value === "saturday" ||
    value === "sunday"
  );
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

/** The restore update writes origin, so a bundle without one keeps the stored provenance. */
export function restoredOccurrenceOrigin(
  occurrence: BehaviorLogImportOccurrencePlan,
  existing: BehaviorLogExistingOccurrence | undefined,
): { origin: OccurrenceOrigin; added_by: OpportunityAddedBy | null } {
  if (occurrence.cadenceOrigin) {
    return {
      origin: occurrence.cadenceOrigin,
      added_by: occurrence.cadenceOrigin === "opportunity" ? occurrence.cadenceAddedBy ?? null : null,
    };
  }
  if (existing?.origin === "opportunity") return { origin: "opportunity", added_by: existing.addedBy ?? null };
  return { origin: "scheduled", added_by: null };
}

/** Link fields only when the bundle carries them: the restore function then keeps the local link. */
function restoredSubBehaviorLink(
  behavior: BehaviorLogImportBehaviorPlan,
  behaviorIdByExternal: ReadonlyMap<string, string>,
): { parent_behavior_id?: string | null; sub_behavior_sort_order?: number; inherit_parent_schedule?: boolean } {
  if (behavior.cadenceParentBehaviorExternalId === undefined) return {};
  const parentId = behavior.cadenceParentBehaviorExternalId
    ? behaviorIdByExternal.get(behavior.cadenceParentBehaviorExternalId) ?? null
    : null;
  return {
    parent_behavior_id: parentId,
    sub_behavior_sort_order: parentId ? behavior.cadenceSubBehaviorSortOrder ?? 0 : 0,
    inherit_parent_schedule: parentId ? behavior.cadenceInheritParentSchedule ?? true : false,
  };
}
