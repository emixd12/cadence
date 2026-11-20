import { storedRunColumns } from "@cadence/core/services/behavior-run-fields";
import { createHash } from "node:crypto";

import { Temporal } from "@js-temporal/polyfill";

import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import {
  getBehaviorById,
  getBehaviorScheduleSlotById,
  listBehaviorCategories,
} from "@/lib/db/behaviors.repo";
import {
  createBehaviorWithAtomicScheduleGraph,
  updateBehaviorWithAtomicScheduleGraph,
  type BehaviorScheduleGraphMutation,
} from "@/lib/db/behaviorDefinitionEvents.repo";
import {
  applyBehaviorLogImportAtomically,
  createBehaviorLogImportRecordMappings as insertBehaviorLogImportRecordMappings,
  createBehaviorLogImportRun as insertBehaviorLogImportRun,
  getBehaviorLogImportRunById,
  listBehaviorLogImportRecordMappingsByRun,
  updateBehaviorLogImportRunStatus as updateImportRunStatus,
} from "@/lib/db/behaviorLogImports.repo";
import {
  createImportedIntervention,
  getImportedInterventionByImportIdentity,
} from "@/lib/db/importedInterventions.repo";
import {
  createImportedNote,
  getImportedNoteByImportIdentity,
} from "@/lib/db/notes.repo";
import {
  createOccurrenceForImport,
  getOccurrenceById,
  getOccurrenceByScheduleIdentity,
  updateOccurrenceById,
  updateOccurrenceNoteIfEmpty,
} from "@/lib/db/occurrences.repo";
import {
  createOccurrenceStatusEvent,
  getOccurrenceStatusEventByImportFingerprint,
  listOccurrenceStatusEventsByOccurrenceIds,
} from "@/lib/db/occurrenceStatusEvents.repo";
import {
  createBehaviorLogImportBundleFingerprint,
  resolveBehaviorLogImportMergePreview,
} from "@/lib/resolvers/behaviorlog-import.resolver";
import { planInitialBehaviorDefinitionEvent } from "@/lib/resolvers/behavior-definition.resolver";
import {
  normalizeBehaviorConfiguration,
  planBehaviorConfigurationChangeEvent,
  planInitialBehaviorConfigurationEvent,
} from "@/lib/resolvers/behavior-configuration.resolver";
import { normalizeBehaviorDefinition } from "@/lib/resolvers/behavior-definition.resolver";
import { serializeArchiveNotes } from "@cadence/core/resolvers/archive-note.resolver";
import { markOccurrenceSyncStale } from "@/lib/services/occurrence-sync-state.service";
import { repairUserOccurrenceReminderGraphBestEffort } from "@/lib/services/occurrence-reminder-repair.service";
import {
  invalidateBehaviorData,
  invalidateImportRunData,
} from "@/lib/cache/stable-user-data.cache";
import type {
  BehaviorLogExistingRecords,
  BehaviorLogImportBehaviorPlan,
  BehaviorLogImportFile,
  BehaviorLogImportIssue,
  BehaviorLogImportInterventionPreviewPlan,
  BehaviorLogImportMergePreview,
  BehaviorLogImportMergePreviewResult,
  BehaviorLogImportMergeRecordAction,
  BehaviorLogImportMode,
  BehaviorLogImportNotePlan,
  BehaviorLogImportOccurrencePlan,
  BehaviorLogImportPreview,
  BehaviorLogImportRecordMappingInput,
  BehaviorLogImportRecordType,
  BehaviorLogImportRunCreateInput,
  BehaviorLogImportRunStatus,
  BehaviorLogImportRunStatusUpdateInput,
  BehaviorLogImportSchedulePlan,
  BehaviorLogImportStatusEventPlan,
} from "@/lib/types/behaviorlog-import";
import type {
  BehaviorLogImportRecordMapping,
  BehaviorLogImportRun,
  Category,
  NewBehavior,
  NewImportedIntervention,
  NewImportedNote,
  NewOccurrence,
  NewOccurrenceStatusEvent,
  OccurrenceStatusEvent,
  OccurrenceStatus,
} from "@/lib/types/database";
import type { RecurrenceRule, Weekday } from "@/lib/types/recurrence";

const BEHAVIORLOG_FORMAT = "behaviorlog.bundle";
const SUPPORTED_RECURRENCE_PROFILE = "behaviorlog.calendar_simple.v1";
const CADENCE_RANGE_PRESETS = [
  {
    preset: "morning",
    startTime: "06:00",
    endTime: "12:00",
  },
  {
    preset: "afternoon",
    startTime: "12:00",
    endTime: "18:00",
  },
  {
    preset: "evening",
    startTime: "18:00",
    endTime: "00:00",
  },
  {
    preset: "night",
    startTime: "00:00",
    endTime: "06:00",
  },
] as const;

export type CreateBehaviorLogImportRunFromPreviewInput = {
  userId: string;
  files: BehaviorLogImportFile[];
  preview: BehaviorLogImportPreview;
  archiveFingerprint?: string | null;
  importMode?: BehaviorLogImportMode;
  acceptedPreviewRunId?: string | null;
  acceptedPreviewFingerprint?: string | null;
  status?: BehaviorLogImportRunStatus;
  startedAt?: string | null;
  completedAt?: string | null;
};

export type CreateBehaviorLogMergePreviewRunFromFilesInput = {
  userId: string;
  files: BehaviorLogImportFile[];
  existing?: BehaviorLogExistingRecords;
  supportedSchemaVersions?: readonly string[];
  startedAt?: string | null;
  completedAt?: string | null;
};

export async function createBehaviorLogImportRunFromPreview(
  supabase: AppSupabaseClient,
  input: CreateBehaviorLogImportRunFromPreviewInput,
): Promise<BehaviorLogImportRun> {
  const manifest = readManifestMetadata(input.files);
  const now = Temporal.Now.instant().toString();

  return createBehaviorLogImportRun(supabase, {
    userId: input.userId,
    bundleFormat: manifest.bundleFormat ?? BEHAVIORLOG_FORMAT,
    schemaVersion: input.preview.summary.schemaVersion ?? manifest.schemaVersion,
    manifestSha256: manifest.manifestSha256,
    bundleFingerprint: createBehaviorLogImportBundleFingerprint(input.files),
    producerName: manifest.producerName,
    producerVersion: manifest.producerVersion,
    subjectIdStrategy: manifest.subjectIdStrategy,
    privacyRedactionLevel: manifest.privacyRedactionLevel,
    importMode: input.importMode ?? "preview_only",
    acceptedPreviewRunId: input.acceptedPreviewRunId,
    acceptedPreviewFingerprint: input.acceptedPreviewFingerprint,
    dryRunSummary: {
      ...toDryRunSummarySnapshot(input.preview),
      ...(input.archiveFingerprint
        ? { archiveFingerprint: input.archiveFingerprint }
        : {}),
    },
    status: input.status ?? "previewed",
    startedAt: input.startedAt ?? now,
    completedAt: input.completedAt ?? now,
  });
}

export async function createBehaviorLogMergePreviewRunFromFiles(
  supabase: AppSupabaseClient,
  input: CreateBehaviorLogMergePreviewRunFromFilesInput,
): Promise<{
  importRun: BehaviorLogImportRun;
  preview: BehaviorLogImportMergePreviewResult;
}> {
  const preview = resolveBehaviorLogImportMergePreview({
    files: input.files,
    existing: input.existing,
    supportedSchemaVersions: input.supportedSchemaVersions,
  });
  const importRun = await createBehaviorLogImportRunFromPreview(supabase, {
    userId: input.userId,
    files: input.files,
    preview,
    importMode: "merge_preview",
    startedAt: input.startedAt,
    completedAt: input.completedAt,
  });

  return { importRun, preview };
}

export async function createBehaviorLogImportRun(
  supabase: AppSupabaseClient,
  input: BehaviorLogImportRunCreateInput,
): Promise<BehaviorLogImportRun> {
  const importRun = await insertBehaviorLogImportRun(
    supabase,
    normalizeImportRunInput(input),
  );

  invalidateImportRunData(input.userId);

  return importRun;
}

export async function updateBehaviorLogImportRunStatus(
  supabase: AppSupabaseClient,
  input: BehaviorLogImportRunStatusUpdateInput,
): Promise<BehaviorLogImportRun | null> {
  const importRun = await updateImportRunStatus(supabase, {
    ...input,
    failureMessage: input.failureMessage?.trim() || null,
  });

  invalidateImportRunData(input.userId);

  return importRun;
}

export async function createBehaviorLogImportRecordMappings(
  supabase: AppSupabaseClient,
  mappings: BehaviorLogImportRecordMappingInput[],
): Promise<void> {
  await insertBehaviorLogImportRecordMappings(
    supabase,
    mappings.map(normalizeMappingInput),
  );
}

export type AtomicBehaviorLogImportApplyResult = {
  importRun: BehaviorLogImportRun;
  created: BehaviorLogCreateOnlyApplyResult["created"] & {
    definitionEvents: number;
    timeSessions: number;
  };
  mapped?: BehaviorLogMergeApplyResult["mapped"] & {
    definitionEvents: number;
    timeSessions: number;
  };
  skipped: BehaviorLogCreateOnlyApplyResult["skipped"] & {
    definitionEvents: number;
    timeSessions: number;
  };
  warnings: BehaviorLogImportIssue[];
};

export async function applyAcceptedBehaviorLogImportPlanAtomically(
  supabase: AppSupabaseClient,
  input: {
    userId: string;
    files: BehaviorLogImportFile[];
    preview: BehaviorLogImportMergePreviewResult;
    importMode: "create_missing_only" | "merge_by_user_approved_plan";
    acceptedPreviewRunId: string;
    acceptedPreviewFingerprint: string;
    completedAt?: string;
  },
): Promise<AtomicBehaviorLogImportApplyResult> {
  const manifest = readManifestMetadata(input.files);
  const completedAt = input.completedAt ?? Temporal.Now.instant().toString();
  const response = await applyBehaviorLogImportAtomically(supabase, {
    accepted_preview_run_id: input.acceptedPreviewRunId,
    accepted_preview_fingerprint: input.acceptedPreviewFingerprint,
    import_mode: input.importMode,
    completed_at: completedAt,
    intervention_rules_present: input.files.some(
      (file) => file.path === "data/intervention_rules.jsonl",
    ),
    run: {
      bundle_format: manifest.bundleFormat ?? BEHAVIORLOG_FORMAT,
      schema_version: input.preview.summary.schemaVersion ?? manifest.schemaVersion,
      manifest_sha256: manifest.manifestSha256,
      bundle_fingerprint: createBehaviorLogImportBundleFingerprint(input.files),
      producer_name: manifest.producerName,
      producer_version: manifest.producerVersion,
      subject_id_strategy: manifest.subjectIdStrategy,
      privacy_redaction_level: manifest.privacyRedactionLevel,
      dry_run_summary: { ...toDryRunSummarySnapshot(input.preview), ...(input.preview.portability ? { portability: input.preview.portability } : {}) },
    },
    preview: input.preview,
  });

  if (response.status === "failed") {
    throw new Error(
      typeof response.failure_message === "string"
        ? response.failure_message
        : "BehaviorLog import apply failed.",
    );
  }

  const importRun = readObject(response.import_run) as BehaviorLogImportRun | null;
  const created = readObject(response.created);
  const skipped = readObject(response.skipped);

  if (!importRun || !created || !skipped) {
    throw new Error("BehaviorLog import apply returned an incomplete result.");
  }

  invalidateBehaviorData(input.userId);
  invalidateImportRunData(input.userId);
  await repairUserOccurrenceReminderGraphBestEffort(supabase, input.userId, {
    operation:
      input.importMode === "create_missing_only"
        ? "behaviorlog_import_create_missing"
        : "behaviorlog_import_merge",
    now: Temporal.Instant.from(completedAt),
  });

  return {
    importRun,
    created: created as AtomicBehaviorLogImportApplyResult["created"],
    mapped: readObject(response.mapped) as
      | AtomicBehaviorLogImportApplyResult["mapped"]
      | undefined,
    skipped: skipped as AtomicBehaviorLogImportApplyResult["skipped"],
    warnings: Array.isArray(response.warnings)
      ? (response.warnings as BehaviorLogImportIssue[])
      : [],
  };
}

export type ApplyCreateMissingBehaviorLogImportPlanInput = {
  userId: string;
  importRunId: string;
  preview: BehaviorLogImportPreview;
  completedAt?: string | null;
};

export type BehaviorLogCreateOnlyApplyResult = {
  importRun: BehaviorLogImportRun;
  created: {
    behaviors: number;
    schedules: number;
    occurrences: number;
    statusEvents: number;
    notes: number;
    interventions: number;
    mappings: number;
  };
  skipped: {
    behaviors: number;
    schedules: number;
    occurrences: number;
    statusEvents: number;
    notes: number;
    interventions: number;
  };
  warnings: BehaviorLogImportIssue[];
};

type MutableApplyResult = BehaviorLogCreateOnlyApplyResult & {
  importRun: BehaviorLogImportRun;
};

export type ApplyApprovedBehaviorLogMergePlanInput = {
  userId: string;
  importRunId: string;
  preview: BehaviorLogImportMergePreviewResult;
  completedAt?: string | null;
};

export type BehaviorLogMergeApplyResult = {
  importRun: BehaviorLogImportRun;
  created: {
    behaviors: number;
    schedules: number;
    occurrences: number;
    statusEvents: number;
    notes: number;
    interventions: number;
    mappings: number;
  };
  mapped: {
    behaviors: number;
    schedules: number;
    occurrences: number;
    statusEvents: number;
    notes: number;
    interventions: number;
  };
  skipped: {
    behaviors: number;
    schedules: number;
    occurrences: number;
    statusEvents: number;
    notes: number;
    interventions: number;
  };
  warnings: BehaviorLogImportIssue[];
};

type MutableMergeApplyResult = BehaviorLogMergeApplyResult & {
  importRun: BehaviorLogImportRun;
};

type MappingIndex = Map<string, string>;

type ScheduleImportResult = {
  warnings: BehaviorLogImportIssue[];
  skipped: {
    schedules: number;
  };
};

type MappingApplyResult = {
  created: {
    mappings: number;
  };
};

type SupportedScheduleImport = {
  plan: BehaviorLogImportSchedulePlan;
  recurrenceRule: RecurrenceRule;
  slot: {
    kind: "exact" | "range";
    preset: "morning" | "afternoon" | "evening" | "night" | null;
    startTime: string;
    endTime: string | null;
  };
};

export async function applyCreateMissingBehaviorLogImportPlan(
  supabase: AppSupabaseClient,
  input: ApplyCreateMissingBehaviorLogImportPlanInput,
): Promise<BehaviorLogCreateOnlyApplyResult> {
  const importRun = await getRequiredCreateOnlyImportRun(supabase, input);
  const completedAt = input.completedAt ?? Temporal.Now.instant().toString();
  const result: MutableApplyResult = {
    importRun,
    created: {
      behaviors: 0,
      schedules: 0,
      occurrences: 0,
      statusEvents: 0,
      notes: 0,
      interventions: 0,
      mappings: 0,
    },
    skipped: {
      behaviors: 0,
      schedules: 0,
      occurrences: 0,
      statusEvents: 0,
      notes: 0,
      interventions: 0,
    },
    warnings: [...input.preview.warnings],
  };

  try {
    assertPreviewCanApply(input.preview);
    assertImportRunHasAcceptedDryRun(importRun);
    await markOccurrenceSyncStale(supabase, {
      userId: input.userId,
      reason: "behaviorlog_import_applied",
    });

    const categories = await listBehaviorCategories(supabase, input.userId);
    const existingMappings = await listBehaviorLogImportRecordMappingsByRun(
      supabase,
      input.userId,
      input.importRunId,
    );
    const mappings = createMappingIndex(existingMappings);
    const supportedSchedules = collectSupportedSchedules(
      input.preview.plan.schedules,
      result,
    );
    const occurrenceScheduleSnapshots = collectOccurrenceScheduleSnapshots(
      input.preview.plan.schedules,
      result,
    );
    const schedulesByBehavior = groupBy(
      [...supportedSchedules.values()],
      (schedule) => schedule.plan.behaviorExternalId,
    );
    const behaviorIds = new Map<string, string>();
    const scheduleIds = new Map<string, string>();
    const atomicScheduleIds = new Map<string, string>();
    const occurrenceIds = new Map<string, string>();
    const statusEventIds = new Map<string, string>();

    for (const behavior of input.preview.plan.behaviors) {
      const mappedId = mappings.get(mappingKey("behavior", behavior.externalId));

      if (mappedId) {
        behaviorIds.set(behavior.externalId, mappedId);
        result.skipped.behaviors += 1;
        continue;
      }

      if (behavior.action !== "create") {
        result.skipped.behaviors += 1;
        continue;
      }

      const behaviorSchedules = schedulesByBehavior.get(behavior.externalId) ?? [];
      const primarySchedule = behaviorSchedules[0];

      if (!primarySchedule) {
        addApplyWarning(
          result,
          "behavior_without_supported_schedule",
          `Behavior ${behavior.externalId} has no supported schedule, so it was not imported.`,
        );
        result.skipped.behaviors += 1;
        continue;
      }

      const createdBehavior = await createImportedBehaviorWithDefinitionEvent(
        supabase,
        behavior,
        behaviorSchedules,
        completedAt,
        {
          user_id: input.userId,
          category_id: resolveCategoryId(categories, behavior),
          title: behavior.title,
          description: behavior.description,
          recurrence_rule: primarySchedule.recurrenceRule,
          scheduled_time: primarySchedule.slot.startTime,
          timezone: primarySchedule.plan.timezone,
          browser_reminder_enabled:
            behavior.cadenceBrowserReminderEnabled ?? true,
          email_reminder_enabled:
            behavior.cadenceEmailReminderEnabled ?? false,
          reminder_offset_minutes: behavior.cadenceReminderOffsetMinutes ?? 0,
          active: behavior.archivedAtUtc
            ? false
            : behavior.cadenceActive ?? true,
          archived_at: behavior.archivedAtUtc,
          archive_notes: serializeArchiveNotes(behavior.cadenceArchiveNotes ?? []),
          default_duration_minutes: behavior.expectedDurationMinutes ?? null,
          ...(behavior.cadenceRun ? storedRunColumns(behavior.cadenceRun) : {}),
          auto_archived_at: behavior.cadenceAutoArchivedAt ?? null,
          created_at: behavior.createdAtUtc ?? undefined,
        } satisfies NewBehavior,
      );

      behaviorIds.set(behavior.externalId, createdBehavior.id);
      await recordImportedScheduleIdentities({
        supabase,
        userId: input.userId,
        behaviorId: createdBehavior.id,
        schedules: behaviorSchedules,
        startingSortOrder: 0,
        scheduleIds: atomicScheduleIds,
      });
      result.created.behaviors += 1;
      await persistMapping(supabase, result, {
        userId: input.userId,
        importRunId: input.importRunId,
        recordType: "behavior",
        externalId: behavior.externalId,
        localId: createdBehavior.id,
      });
      mappings.set(mappingKey("behavior", behavior.externalId), createdBehavior.id);
    }

    for (const supportedSchedule of supportedSchedules.values()) {
      const schedule = supportedSchedule.plan;
      const mappedId = mappings.get(mappingKey("schedule", schedule.externalId));

      if (mappedId) {
        scheduleIds.set(schedule.externalId, mappedId);
        result.skipped.schedules += 1;
        continue;
      }

      if (schedule.action !== "create") {
        result.skipped.schedules += 1;
        continue;
      }

      const behaviorId = behaviorIds.get(schedule.behaviorExternalId);

      if (!behaviorId) {
        addApplyWarning(
          result,
          "schedule_parent_behavior_missing",
          `Schedule ${schedule.externalId} was skipped because its behavior was not imported.`,
        );
        result.skipped.schedules += 1;
        continue;
      }

      const localSlotId =
        atomicScheduleIds.get(schedule.externalId) ??
        failMissingAtomicImportSchedule(schedule.externalId);

      scheduleIds.set(schedule.externalId, localSlotId);

      result.created.schedules += 1;

      await persistMapping(supabase, result, {
        userId: input.userId,
        importRunId: input.importRunId,
        recordType: "schedule",
        externalId: schedule.externalId,
        localId: localSlotId,
      });
      mappings.set(mappingKey("schedule", schedule.externalId), localSlotId);
    }

    for (const occurrence of input.preview.plan.occurrences) {
      const mappedId = mappings.get(
        mappingKey("occurrence", occurrence.externalId),
      );

      if (mappedId) {
        occurrenceIds.set(occurrence.externalId, mappedId);
        result.skipped.occurrences += 1;
        continue;
      }

      if (occurrence.action !== "create") {
        result.skipped.occurrences += 1;
        continue;
      }

      const behaviorId = behaviorIds.get(occurrence.behaviorExternalId);
      const scheduleId = occurrence.importWithDetachedScheduleSnapshot
        ? null
        : (scheduleIds.get(occurrence.scheduleExternalId) ?? null);
      const supportedSchedule = occurrenceScheduleSnapshots.get(
        occurrence.scheduleExternalId,
      );

      if (
        !behaviorId ||
        (!occurrence.importWithDetachedScheduleSnapshot && !scheduleId) ||
        !supportedSchedule
      ) {
        addApplyWarning(
          result,
          "occurrence_parent_missing",
          `Occurrence ${occurrence.externalId} was skipped because its behavior or schedule was not imported.`,
        );
        result.skipped.occurrences += 1;
        continue;
      }

      const existingOccurrence = await getOccurrenceByScheduleIdentity(
        supabase,
        {
          userId: input.userId,
          behaviorId,
          localDate: occurrence.localDate,
          scheduleKind: supportedSchedule.slot.kind,
          scheduleStartTime: supportedSchedule.slot.startTime,
          scheduleEndTime: supportedSchedule.slot.endTime,
        },
      );
      const localOccurrence =
        existingOccurrence ??
        (await createOccurrenceForImport(
          supabase,
          toNewOccurrence({
            userId: input.userId,
            behaviorId,
            scheduleId,
            occurrence,
            supportedSchedule,
          }),
        ));

      occurrenceIds.set(occurrence.externalId, localOccurrence.id);

      if (!existingOccurrence) {
        result.created.occurrences += 1;
      } else {
        result.skipped.occurrences += 1;
      }

      await persistMapping(supabase, result, {
        userId: input.userId,
        importRunId: input.importRunId,
        recordType: "occurrence",
        externalId: occurrence.externalId,
        localId: localOccurrence.id,
      });
      mappings.set(
        mappingKey("occurrence", occurrence.externalId),
        localOccurrence.id,
      );
    }

    const importedEventsByOccurrenceId = new Map<
      string,
      BehaviorLogImportStatusEventPlan[]
    >();

    for (const event of [...input.preview.plan.statusEvents].sort(
      compareImportStatusEvents,
    )) {
      const mappedId = mappings.get(mappingKey("status_event", event.externalId));
      const occurrenceId = occurrenceIds.get(event.occurrenceExternalId);
      const behaviorId = behaviorIds.get(event.behaviorExternalId);

      if (mappedId) {
        statusEventIds.set(event.externalId, mappedId);

        if (occurrenceId) {
          addImportedEvent(importedEventsByOccurrenceId, occurrenceId, event);
        }

        result.skipped.statusEvents += 1;
        continue;
      }

      if (event.action !== "create") {
        result.skipped.statusEvents += 1;
        continue;
      }

      if (!occurrenceId || !behaviorId) {
        addApplyWarning(
          result,
          "status_event_parent_missing",
          `Status event ${event.externalId} was skipped because its behavior or occurrence was not imported.`,
        );
        result.skipped.statusEvents += 1;
        continue;
      }

      const existingEvent = await getOccurrenceStatusEventByImportFingerprint(
        supabase,
        {
          userId: input.userId,
          occurrenceId,
          recordedAt: event.recordedAtUtc,
          status: event.status,
        },
      );
      const localEvent =
        existingEvent ??
        (await createOccurrenceStatusEvent(
          supabase,
          toNewStatusEvent({
            userId: input.userId,
            occurrenceId,
            behaviorId,
            event,
            revisesEventId: event.revisesEventId
              ? statusEventIds.get(event.revisesEventId) ?? null
              : null,
            result,
          }),
        ));

      statusEventIds.set(event.externalId, localEvent.id);
      addImportedEvent(importedEventsByOccurrenceId, occurrenceId, event);

      if (!existingEvent) {
        result.created.statusEvents += 1;
      } else {
        result.skipped.statusEvents += 1;
      }

      await persistMapping(supabase, result, {
        userId: input.userId,
        importRunId: input.importRunId,
        recordType: "status_event",
        externalId: event.externalId,
        localId: localEvent.id,
      });
      mappings.set(mappingKey("status_event", event.externalId), localEvent.id);
    }

    for (const [occurrenceId, events] of importedEventsByOccurrenceId) {
      const latestEvent = [...events].sort(compareImportStatusEvents).at(-1);

      if (!latestEvent) {
        continue;
      }

      await updateOccurrenceById(
        supabase,
        input.userId,
        occurrenceId,
        occurrenceStatusUpdateFromEvent(latestEvent),
      );
    }

    for (const note of input.preview.plan.notes) {
      await applyCreateOnlyNotePlan(supabase, result, {
        userId: input.userId,
        importRunId: input.importRunId,
        note,
        behaviorIds,
        occurrenceIds,
        statusEventIds,
        mappings,
      });
    }

    for (const intervention of input.preview.plan.interventions) {
      await applyCreateOnlyInterventionPlan(supabase, result, {
        userId: input.userId,
        importRunId: input.importRunId,
        intervention,
        behaviorIds,
        occurrenceIds,
        mappings,
      });
    }

    const appliedRun = await updateBehaviorLogImportRunStatus(supabase, {
      userId: input.userId,
      importRunId: input.importRunId,
      status: "applied",
      failureMessage: null,
      completedAt,
    });

    if (appliedRun) {
      result.importRun = appliedRun;
    }

    invalidateBehaviorData(input.userId);
    await repairUserOccurrenceReminderGraphBestEffort(
      supabase,
      input.userId,
      {
        operation: "behaviorlog_import_create_missing",
        now: Temporal.Instant.from(completedAt),
      },
    );

    return result;
  } catch (error) {
    await updateBehaviorLogImportRunStatus(supabase, {
      userId: input.userId,
      importRunId: input.importRunId,
      status: "failed",
      failureMessage: errorMessage(error),
      completedAt,
    });
    throw error;
  }
}

export async function applyApprovedBehaviorLogMergePlan(
  supabase: AppSupabaseClient,
  input: ApplyApprovedBehaviorLogMergePlanInput,
): Promise<BehaviorLogMergeApplyResult> {
  const importRun = await getRequiredMergeApplyImportRun(supabase, input);
  const completedAt = input.completedAt ?? Temporal.Now.instant().toString();
  const result: MutableMergeApplyResult = {
    importRun,
    created: {
      behaviors: 0,
      schedules: 0,
      occurrences: 0,
      statusEvents: 0,
      notes: 0,
      interventions: 0,
      mappings: 0,
    },
    mapped: {
      behaviors: 0,
      schedules: 0,
      occurrences: 0,
      statusEvents: 0,
      notes: 0,
      interventions: 0,
    },
    skipped: {
      behaviors: 0,
      schedules: 0,
      occurrences: 0,
      statusEvents: 0,
      notes: 0,
      interventions: 0,
    },
    warnings: [...input.preview.warnings],
  };

  try {
    assertPreviewCanApply(input.preview);
    assertImportRunHasAcceptedDryRun(importRun);

    const acceptedMergePreview = getAcceptedMergePreview(importRun);

    assertMergePreviewMatchesInput(input.preview.mergePreview, acceptedMergePreview);
    assertMergePlanCanApply(acceptedMergePreview);
    await markOccurrenceSyncStale(supabase, {
      userId: input.userId,
      reason: "behaviorlog_import_applied",
    });

    const actionIndex = createMergeActionIndex(acceptedMergePreview);
    const categories = await listBehaviorCategories(supabase, input.userId);
    const existingMappings = await listBehaviorLogImportRecordMappingsByRun(
      supabase,
      input.userId,
      input.importRunId,
    );
    const mappings = createMappingIndex(existingMappings);
    const supportedSchedules = collectSupportedSchedules(
      input.preview.plan.schedules,
      result,
    );
    const occurrenceScheduleSnapshots = collectOccurrenceScheduleSnapshots(
      input.preview.plan.schedules,
      result,
    );
    const schedulesByBehavior = groupBy(
      [...supportedSchedules.values()],
      (schedule) => schedule.plan.behaviorExternalId,
    );
    const behaviorIds = new Map<string, string>();
    const scheduleIds = new Map<string, string>();
    const atomicScheduleIds = new Map<string, string>();
    const occurrenceIds = new Map<string, string>();
    const statusEventIds = new Map<string, string>();
    const createdBehaviorIds = new Set<string>();
    const notePlansByExternalId = new Map<string, BehaviorLogImportNotePlan>(
      input.preview.plan.notes.map((note) => [note.externalId, note]),
    );
    const interventionPlansByExternalId = new Map<
      string,
      BehaviorLogImportInterventionPreviewPlan
    >(
      input.preview.plan.interventions.map((intervention) => [
        intervention.externalId,
        intervention,
      ]),
    );

    hydrateMappingTargets({
      mappings,
      behaviorIds,
      scheduleIds,
      occurrenceIds,
      statusEventIds,
    });
    hydrateMergeActionTargets({
      acceptedMergePreview,
      behaviorIds,
      scheduleIds,
      occurrenceIds,
      statusEventIds,
    });

    for (const behavior of input.preview.plan.behaviors) {
      const action = requireMergeAction(actionIndex, "behavior", behavior.externalId);
      const mappedId = mappings.get(mappingKey("behavior", behavior.externalId));

      if (mappedId) {
        behaviorIds.set(behavior.externalId, mappedId);
        result.skipped.behaviors += 1;
        continue;
      }

      if (action.action === "skip_existing") {
        await persistActionMappingIfLocalId(supabase, result, {
          userId: input.userId,
          importRunId: input.importRunId,
          action,
        });
        if (action.localId) {
          behaviorIds.set(behavior.externalId, action.localId);
        }
        result.skipped.behaviors += 1;
        continue;
      }

      if (action.action === "map_to_existing") {
        const localId = requireActionLocalId(action);
        const localBehavior = await getBehaviorById(supabase, input.userId, localId);

        if (!localBehavior) {
          throw new Error(
            `Accepted merge plan maps behavior ${behavior.externalId} to missing local behavior ${localId}.`,
          );
        }

        behaviorIds.set(behavior.externalId, localId);
        await persistMapping(supabase, result, {
          userId: input.userId,
          importRunId: input.importRunId,
          recordType: "behavior",
          externalId: behavior.externalId,
          localId,
        });
        mappings.set(mappingKey("behavior", behavior.externalId), localId);
        result.mapped.behaviors += 1;
        continue;
      }

      if (action.action !== "create_new") {
        throw new Error(
          `BehaviorLog merge action ${action.action} for behavior ${behavior.externalId} cannot be applied.`,
        );
      }

      if (behavior.action !== "create") {
        addApplyWarning(
          result,
          "behavior_plan_not_creatable",
          `Behavior ${behavior.externalId} was not imported because the validated plan did not mark it createable.`,
        );
        result.skipped.behaviors += 1;
        continue;
      }

      const behaviorSchedules = schedulesByBehavior.get(behavior.externalId) ?? [];
      const primarySchedule = behaviorSchedules[0];

      if (!primarySchedule) {
        addApplyWarning(
          result,
          "behavior_without_supported_schedule",
          `Behavior ${behavior.externalId} has no supported schedule, so it was not imported.`,
        );
        result.skipped.behaviors += 1;
        continue;
      }

      const createdBehavior = await createImportedBehaviorWithDefinitionEvent(
        supabase,
        behavior,
        behaviorSchedules,
        completedAt,
        {
          user_id: input.userId,
          category_id: resolveCategoryId(categories, behavior),
          title: behavior.title,
          description: behavior.description,
          recurrence_rule: primarySchedule.recurrenceRule,
          scheduled_time: primarySchedule.slot.startTime,
          timezone: primarySchedule.plan.timezone,
          browser_reminder_enabled:
            behavior.cadenceBrowserReminderEnabled ?? true,
          email_reminder_enabled:
            behavior.cadenceEmailReminderEnabled ?? false,
          reminder_offset_minutes: behavior.cadenceReminderOffsetMinutes ?? 0,
          active: behavior.archivedAtUtc
            ? false
            : behavior.cadenceActive ?? true,
          archived_at: behavior.archivedAtUtc,
          archive_notes: serializeArchiveNotes(behavior.cadenceArchiveNotes ?? []),
          default_duration_minutes: behavior.expectedDurationMinutes ?? null,
          ...(behavior.cadenceRun ? storedRunColumns(behavior.cadenceRun) : {}),
          auto_archived_at: behavior.cadenceAutoArchivedAt ?? null,
          created_at: behavior.createdAtUtc ?? undefined,
        } satisfies NewBehavior,
      );

      behaviorIds.set(behavior.externalId, createdBehavior.id);
      createdBehaviorIds.add(createdBehavior.id);
      await recordImportedScheduleIdentities({
        supabase,
        userId: input.userId,
        behaviorId: createdBehavior.id,
        schedules: behaviorSchedules,
        startingSortOrder: 0,
        scheduleIds: atomicScheduleIds,
      });
      result.created.behaviors += 1;
      await persistMapping(supabase, result, {
        userId: input.userId,
        importRunId: input.importRunId,
        recordType: "behavior",
        externalId: behavior.externalId,
        localId: createdBehavior.id,
      });
      mappings.set(mappingKey("behavior", behavior.externalId), createdBehavior.id);
    }

    await applyImportedScheduleChangesToExistingBehaviors({
      supabase,
      userId: input.userId,
      completedAt,
      supportedSchedules,
      schedulesByBehavior,
      actionIndex,
      behaviorIds,
      createdBehaviorIds,
      atomicScheduleIds,
      existingScheduleIds: scheduleIds,
    });

    for (const supportedSchedule of supportedSchedules.values()) {
      const schedule = supportedSchedule.plan;
      const action = requireMergeAction(actionIndex, "schedule", schedule.externalId);
      const mappedId = mappings.get(mappingKey("schedule", schedule.externalId));

      if (mappedId) {
        scheduleIds.set(schedule.externalId, mappedId);
        result.skipped.schedules += 1;
        continue;
      }

      if (action.action === "skip_existing") {
        await persistActionMappingIfLocalId(supabase, result, {
          userId: input.userId,
          importRunId: input.importRunId,
          action,
        });
        if (action.localId) {
          scheduleIds.set(schedule.externalId, action.localId);
        }
        result.skipped.schedules += 1;
        continue;
      }

      if (action.action === "map_to_existing") {
        const localId = requireActionLocalId(action);
        const localSchedule = await getBehaviorScheduleSlotById(supabase, {
          userId: input.userId,
          scheduleSlotId: localId,
        });

        if (!localSchedule) {
          throw new Error(
            `Accepted merge plan maps schedule ${schedule.externalId} to missing local schedule ${localId}.`,
          );
        }

        scheduleIds.set(schedule.externalId, localId);
        await persistMapping(supabase, result, {
          userId: input.userId,
          importRunId: input.importRunId,
          recordType: "schedule",
          externalId: schedule.externalId,
          localId,
        });
        mappings.set(mappingKey("schedule", schedule.externalId), localId);
        result.mapped.schedules += 1;
        continue;
      }

      if (action.action !== "create_new") {
        throw new Error(
          `BehaviorLog merge action ${action.action} for schedule ${schedule.externalId} cannot be applied.`,
        );
      }

      if (schedule.action !== "create") {
        addApplyWarning(
          result,
          "schedule_plan_not_creatable",
          `Schedule ${schedule.externalId} was not imported because the validated plan did not mark it createable.`,
        );
        result.skipped.schedules += 1;
        continue;
      }

      const behaviorId = behaviorIds.get(schedule.behaviorExternalId);

      if (!behaviorId) {
        addApplyWarning(
          result,
          "schedule_parent_behavior_missing",
          `Schedule ${schedule.externalId} was skipped because its behavior was not imported or mapped.`,
        );
        result.skipped.schedules += 1;
        continue;
      }

      const localSlotId =
        atomicScheduleIds.get(schedule.externalId) ??
        failMissingAtomicImportSchedule(schedule.externalId);

      scheduleIds.set(schedule.externalId, localSlotId);

      result.created.schedules += 1;

      await persistMapping(supabase, result, {
        userId: input.userId,
        importRunId: input.importRunId,
        recordType: "schedule",
        externalId: schedule.externalId,
        localId: localSlotId,
      });
      mappings.set(mappingKey("schedule", schedule.externalId), localSlotId);
    }

    for (const occurrence of input.preview.plan.occurrences) {
      const action = requireMergeAction(
        actionIndex,
        "occurrence",
        occurrence.externalId,
      );
      const mappedId = mappings.get(
        mappingKey("occurrence", occurrence.externalId),
      );

      if (mappedId) {
        occurrenceIds.set(occurrence.externalId, mappedId);
        result.skipped.occurrences += 1;
        continue;
      }

      if (action.action === "skip_existing") {
        await persistActionMappingIfLocalId(supabase, result, {
          userId: input.userId,
          importRunId: input.importRunId,
          action,
        });
        if (action.localId) {
          occurrenceIds.set(occurrence.externalId, action.localId);
        }
        result.skipped.occurrences += 1;
        continue;
      }

      if (action.action === "map_to_existing") {
        const localId = requireActionLocalId(action);
        const localOccurrence = await getOccurrenceById(
          supabase,
          input.userId,
          localId,
        );

        if (!localOccurrence) {
          throw new Error(
            `Accepted merge plan maps occurrence ${occurrence.externalId} to missing local occurrence ${localId}.`,
          );
        }

        occurrenceIds.set(occurrence.externalId, localId);
        await persistMapping(supabase, result, {
          userId: input.userId,
          importRunId: input.importRunId,
          recordType: "occurrence",
          externalId: occurrence.externalId,
          localId,
        });
        mappings.set(mappingKey("occurrence", occurrence.externalId), localId);
        result.mapped.occurrences += 1;
        continue;
      }

      if (action.action !== "create_new") {
        throw new Error(
          `BehaviorLog merge action ${action.action} for occurrence ${occurrence.externalId} cannot be applied.`,
        );
      }

      if (occurrence.action !== "create") {
        addApplyWarning(
          result,
          "occurrence_plan_not_creatable",
          `Occurrence ${occurrence.externalId} was not imported because the validated plan did not mark it createable.`,
        );
        result.skipped.occurrences += 1;
        continue;
      }

      const behaviorId = behaviorIds.get(occurrence.behaviorExternalId);
      const scheduleId = occurrence.importWithDetachedScheduleSnapshot
        ? null
        : (scheduleIds.get(occurrence.scheduleExternalId) ?? null);
      const supportedSchedule = occurrenceScheduleSnapshots.get(
        occurrence.scheduleExternalId,
      );

      if (
        !behaviorId ||
        (!occurrence.importWithDetachedScheduleSnapshot && !scheduleId) ||
        !supportedSchedule
      ) {
        addApplyWarning(
          result,
          "occurrence_parent_missing",
          `Occurrence ${occurrence.externalId} was skipped because its behavior or schedule was not imported or mapped.`,
        );
        result.skipped.occurrences += 1;
        continue;
      }

      const existingOccurrence = await getOccurrenceByScheduleIdentity(
        supabase,
        {
          userId: input.userId,
          behaviorId,
          localDate: occurrence.localDate,
          scheduleKind: supportedSchedule.slot.kind,
          scheduleStartTime: supportedSchedule.slot.startTime,
          scheduleEndTime: supportedSchedule.slot.endTime,
        },
      );
      const localOccurrence =
        existingOccurrence ??
        (await createOccurrenceForImport(
          supabase,
          toNewOccurrence({
            userId: input.userId,
            behaviorId,
            scheduleId,
            occurrence,
            supportedSchedule,
          }),
        ));

      occurrenceIds.set(occurrence.externalId, localOccurrence.id);

      if (!existingOccurrence) {
        result.created.occurrences += 1;
      } else {
        result.skipped.occurrences += 1;
      }

      await persistMapping(supabase, result, {
        userId: input.userId,
        importRunId: input.importRunId,
        recordType: "occurrence",
        externalId: occurrence.externalId,
        localId: localOccurrence.id,
      });
      mappings.set(
        mappingKey("occurrence", occurrence.externalId),
        localOccurrence.id,
      );
    }

    hydrateMergeActionTargets({
      acceptedMergePreview,
      behaviorIds,
      scheduleIds,
      occurrenceIds,
      statusEventIds,
    });

    const importedEventsByOccurrenceId = new Map<
      string,
      BehaviorLogImportStatusEventPlan[]
    >();

    for (const event of [...input.preview.plan.statusEvents].sort(
      compareImportStatusEvents,
    )) {
      const action = requireMergeAction(
        actionIndex,
        "status_event",
        event.externalId,
      );
      const mappedId = mappings.get(mappingKey("status_event", event.externalId));
      const occurrenceId = occurrenceIds.get(event.occurrenceExternalId);
      const behaviorId = behaviorIds.get(event.behaviorExternalId);

      if (mappedId) {
        statusEventIds.set(event.externalId, mappedId);

        if (occurrenceId) {
          addImportedEvent(importedEventsByOccurrenceId, occurrenceId, event);
        }

        result.skipped.statusEvents += 1;
        continue;
      }

      if (action.action === "skip_existing" || action.action === "map_to_existing") {
        const localId = requireActionLocalId(action);

        statusEventIds.set(event.externalId, localId);
        await persistMapping(supabase, result, {
          userId: input.userId,
          importRunId: input.importRunId,
          recordType: "status_event",
          externalId: event.externalId,
          localId,
        });
        mappings.set(mappingKey("status_event", event.externalId), localId);

        if (occurrenceId) {
          addImportedEvent(importedEventsByOccurrenceId, occurrenceId, event);
        }

        if (action.action === "map_to_existing") {
          result.mapped.statusEvents += 1;
        } else {
          result.skipped.statusEvents += 1;
        }
        continue;
      }

      if (action.action !== "create_new") {
        throw new Error(
          `BehaviorLog merge action ${action.action} for status event ${event.externalId} cannot be applied.`,
        );
      }

      if (event.action !== "create") {
        addApplyWarning(
          result,
          "status_event_plan_not_creatable",
          `Status event ${event.externalId} was not imported because the validated plan did not mark it createable.`,
        );
        result.skipped.statusEvents += 1;
        continue;
      }

      if (!occurrenceId || !behaviorId) {
        throw new Error(
          `Status event ${event.externalId} cannot be applied because its behavior or occurrence was not imported or mapped.`,
        );
      }

      const existingEvent = await getOccurrenceStatusEventByImportFingerprint(
        supabase,
        {
          userId: input.userId,
          occurrenceId,
          recordedAt: event.recordedAtUtc,
          status: event.status,
        },
      );
      const localEvent =
        existingEvent ??
        (await createOccurrenceStatusEvent(
          supabase,
          toNewStatusEvent({
            userId: input.userId,
            occurrenceId,
            behaviorId,
            event,
            revisesEventId: event.revisesEventId
              ? statusEventIds.get(event.revisesEventId) ?? null
              : null,
            result,
          }),
        ));

      statusEventIds.set(event.externalId, localEvent.id);
      addImportedEvent(importedEventsByOccurrenceId, occurrenceId, event);

      if (!existingEvent) {
        result.created.statusEvents += 1;
      } else {
        result.skipped.statusEvents += 1;
      }

      await persistMapping(supabase, result, {
        userId: input.userId,
        importRunId: input.importRunId,
        recordType: "status_event",
        externalId: event.externalId,
        localId: localEvent.id,
      });
      mappings.set(mappingKey("status_event", event.externalId), localEvent.id);
    }

    await updateMergeOccurrenceSnapshots({
      supabase,
      userId: input.userId,
      importedEventsByOccurrenceId,
      statusEventIds,
      result,
    });

    for (const noteAction of acceptedMergePreview.actions.notes) {
      await applyNoteMergeAction(supabase, result, {
        userId: input.userId,
        importRunId: input.importRunId,
        action: noteAction,
        notePlansByExternalId,
        behaviorIds,
        occurrenceIds,
        statusEventIds,
        mappings,
      });
    }

    for (const interventionAction of acceptedMergePreview.actions.interventions) {
      await applyInterventionMergeAction(supabase, result, {
        userId: input.userId,
        importRunId: input.importRunId,
        action: interventionAction,
        interventionPlansByExternalId,
        behaviorIds,
        occurrenceIds,
        mappings,
      });
    }

    const appliedRun = await updateBehaviorLogImportRunStatus(supabase, {
      userId: input.userId,
      importRunId: input.importRunId,
      status: "applied",
      failureMessage: null,
      completedAt,
    });

    if (appliedRun) {
      result.importRun = appliedRun;
    }

    invalidateBehaviorData(input.userId);
    await repairUserOccurrenceReminderGraphBestEffort(
      supabase,
      input.userId,
      {
        operation: "behaviorlog_import_merge",
        now: Temporal.Instant.from(completedAt),
      },
    );

    return result;
  } catch (error) {
    await updateBehaviorLogImportRunStatus(supabase, {
      userId: input.userId,
      importRunId: input.importRunId,
      status: "failed",
      failureMessage: errorMessage(error),
      completedAt,
    });
    throw error;
  }
}

async function getRequiredCreateOnlyImportRun(
  supabase: AppSupabaseClient,
  input: Pick<
    ApplyCreateMissingBehaviorLogImportPlanInput,
    "userId" | "importRunId"
  >,
): Promise<BehaviorLogImportRun> {
  const importRun = await getBehaviorLogImportRunById(
    supabase,
    input.userId,
    input.importRunId,
  );

  if (!importRun) {
    throw new Error("BehaviorLog import run was not found.");
  }

  if (importRun.import_mode !== "create_missing_only") {
    throw new Error(
      `BehaviorLog import run mode must be create_missing_only, received ${importRun.import_mode}.`,
    );
  }

  if (importRun.status !== "previewed" && importRun.status !== "applied") {
    throw new Error(
      `BehaviorLog import run must be previewed or applied before create-only import, received ${importRun.status}.`,
    );
  }

  return importRun;
}

async function getRequiredMergeApplyImportRun(
  supabase: AppSupabaseClient,
  input: Pick<ApplyApprovedBehaviorLogMergePlanInput, "userId" | "importRunId">,
): Promise<BehaviorLogImportRun> {
  const importRun = await getBehaviorLogImportRunById(
    supabase,
    input.userId,
    input.importRunId,
  );

  if (!importRun) {
    throw new Error("BehaviorLog import run was not found.");
  }

  if (importRun.import_mode !== "merge_by_user_approved_plan") {
    throw new Error(
      `BehaviorLog import run mode must be merge_by_user_approved_plan, received ${importRun.import_mode}.`,
    );
  }

  if (importRun.status !== "previewed" && importRun.status !== "applied") {
    throw new Error(
      `BehaviorLog import run must be previewed or applied before merge import, received ${importRun.status}.`,
    );
  }

  return importRun;
}

function assertPreviewCanApply(preview: BehaviorLogImportPreview): void {
  if (!preview.valid || preview.errors.length > 0) {
    throw new Error("BehaviorLog import requires a valid dry-run preview.");
  }
}

function assertImportRunHasAcceptedDryRun(importRun: BehaviorLogImportRun): void {
  const summary = readObject(importRun.dry_run_summary);

  if (summary?.valid !== true) {
    throw new Error(
      "BehaviorLog import run does not contain an accepted valid dry-run summary.",
    );
  }

  if (
    typeof summary.errorCount === "number" &&
    Number.isFinite(summary.errorCount) &&
    summary.errorCount > 0
  ) {
    throw new Error(
      "BehaviorLog import run dry-run summary contains validation errors.",
    );
  }
}

function getAcceptedMergePreview(
  importRun: BehaviorLogImportRun,
): BehaviorLogImportMergePreview {
  const summary = readObject(importRun.dry_run_summary);
  const mergePreview = readObject(summary?.mergePreview);

  if (!mergePreview) {
    throw new Error(
      "BehaviorLog merge import run does not contain an accepted merge preview.",
    );
  }

  return mergePreview as unknown as BehaviorLogImportMergePreview;
}

function assertMergePreviewMatchesInput(
  inputPreview: BehaviorLogImportMergePreview,
  acceptedPreview: BehaviorLogImportMergePreview,
): void {
  if (inputPreview.mode !== "merge_preview" || acceptedPreview.mode !== "merge_preview") {
    throw new Error("BehaviorLog merge import requires a merge-preview plan.");
  }

  if (
    stableStringify(inputPreview.actions) !==
    stableStringify(acceptedPreview.actions)
  ) {
    throw new Error(
      "BehaviorLog merge import input does not match the accepted merge plan stored on the import run.",
    );
  }
}

function assertMergePlanCanApply(
  mergePreview: BehaviorLogImportMergePreview,
): void {
  const unresolvedActions = allMergeActions(mergePreview).filter(
    (action) => action.action === "conflict_requires_decision",
  );

  if (unresolvedActions.length > 0) {
    throw new Error(
      `BehaviorLog merge import cannot apply while ${unresolvedActions.length} conflict action(s) still require a user decision.`,
    );
  }
}

function createMergeActionIndex(
  mergePreview: BehaviorLogImportMergePreview,
): Map<string, BehaviorLogImportMergeRecordAction> {
  return new Map(
    allMergeActions(mergePreview).map((action) => [
      mappingKey(action.recordType, action.externalId),
      action,
    ]),
  );
}

function requireMergeAction(
  actionIndex: Map<string, BehaviorLogImportMergeRecordAction>,
  recordType: BehaviorLogImportRecordType,
  externalId: string,
): BehaviorLogImportMergeRecordAction {
  const action = actionIndex.get(mappingKey(recordType, externalId));

  if (!action) {
    throw new Error(
      `BehaviorLog merge import is missing an accepted ${recordType} action for ${externalId}.`,
    );
  }

  return action;
}

function requireActionLocalId(action: BehaviorLogImportMergeRecordAction): string {
  if (!action.localId) {
    throw new Error(
      `BehaviorLog merge action ${action.action} for ${action.recordType} ${action.externalId} requires a local id.`,
    );
  }

  return action.localId;
}

function allMergeActions(
  mergePreview: BehaviorLogImportMergePreview,
): BehaviorLogImportMergeRecordAction[] {
  return [
    ...mergePreview.actions.behaviors,
    ...mergePreview.actions.schedules,
    ...mergePreview.actions.occurrences,
    ...mergePreview.actions.statusEvents,
    ...mergePreview.actions.notes,
    ...mergePreview.actions.interventions,
  ];
}

function createMappingIndex(
  mappings: BehaviorLogImportRecordMapping[],
): MappingIndex {
  return new Map(
    mappings.map((mapping) => [
      mappingKey(mapping.record_type, mapping.external_id),
      mapping.local_id,
    ]),
  );
}

function hydrateMappingTargets(input: {
  mappings: MappingIndex;
  behaviorIds: Map<string, string>;
  scheduleIds: Map<string, string>;
  occurrenceIds: Map<string, string>;
  statusEventIds: Map<string, string>;
}): void {
  for (const [key, localId] of input.mappings) {
    const separatorIndex = key.indexOf(":");

    if (separatorIndex < 1) {
      continue;
    }

    const recordType = key.slice(0, separatorIndex);
    const externalId = key.slice(separatorIndex + 1);

    if (!externalId) {
      continue;
    }

    setMappedId(input, recordType, externalId, localId);
  }
}

function hydrateMergeActionTargets(input: {
  acceptedMergePreview: BehaviorLogImportMergePreview;
  behaviorIds: Map<string, string>;
  scheduleIds: Map<string, string>;
  occurrenceIds: Map<string, string>;
  statusEventIds: Map<string, string>;
}): void {
  for (const action of allMergeActions(input.acceptedMergePreview)) {
    if (!action.localId) {
      continue;
    }

    setMappedId(input, action.recordType, action.externalId, action.localId);
  }
}

function setMappedId(
  input: {
    behaviorIds: Map<string, string>;
    scheduleIds: Map<string, string>;
    occurrenceIds: Map<string, string>;
    statusEventIds: Map<string, string>;
  },
  recordType: string,
  externalId: string,
  localId: string,
): void {
  switch (recordType) {
    case "behavior":
      input.behaviorIds.set(externalId, localId);
      return;
    case "schedule":
      input.scheduleIds.set(externalId, localId);
      return;
    case "occurrence":
      input.occurrenceIds.set(externalId, localId);
      return;
    case "status_event":
      input.statusEventIds.set(externalId, localId);
      return;
    default:
      return;
  }
}

function collectSupportedSchedules(
  schedules: BehaviorLogImportSchedulePlan[],
  result: ScheduleImportResult,
): Map<string, SupportedScheduleImport> {
  const supported = new Map<string, SupportedScheduleImport>();

  for (const schedule of schedules) {
    if (schedule.action !== "create") {
      result.skipped.schedules += 1;
      continue;
    }

    const supportedSchedule = toSupportedSchedule(schedule, result);

    if (!supportedSchedule) {
      result.skipped.schedules += 1;
      continue;
    }

    supported.set(schedule.externalId, supportedSchedule);
  }

  return supported;
}

function collectOccurrenceScheduleSnapshots(
  schedules: BehaviorLogImportSchedulePlan[],
  result: ScheduleImportResult,
): Map<string, SupportedScheduleImport> {
  const supported = new Map<string, SupportedScheduleImport>();

  for (const schedule of schedules) {
    if (
      schedule.action !== "create" &&
      !schedule.skipReasons.includes("cadence_historical_schedule_export_only")
    ) {
      continue;
    }

    const supportedSchedule = toSupportedSchedule(schedule, result);

    if (supportedSchedule) {
      supported.set(schedule.externalId, supportedSchedule);
    }
  }

  return supported;
}

function toSupportedSchedule(
  schedule: BehaviorLogImportSchedulePlan,
  result: ScheduleImportResult,
): SupportedScheduleImport | null {
  if (schedule.recurrenceProfile !== SUPPORTED_RECURRENCE_PROFILE) {
    addApplyWarning(
      result,
      "unsupported_recurrence_profile",
      `Schedule ${schedule.externalId} uses unsupported recurrence_profile ${schedule.recurrenceProfile}.`,
    );
    return null;
  }

  const recurrenceRule = toRecurrenceRule(schedule.recurrence);

  if (!recurrenceRule) {
    addApplyWarning(
      result,
      "unsupported_recurrence",
      `Schedule ${schedule.externalId} uses a recurrence payload Cadence cannot import.`,
    );
    return null;
  }

  const slot = toScheduleSlot(schedule);

  if (!slot) {
    addApplyWarning(
      result,
      "unsupported_schedule_window",
      `Schedule ${schedule.externalId} does not fit Cadence exact-time or preset time-range slots.`,
    );
    return null;
  }

  return {
    plan: schedule,
    recurrenceRule,
    slot,
  };
}

function toRecurrenceRule(
  recurrence: Record<string, unknown>,
): RecurrenceRule | null {
  switch (recurrence.type) {
    case "daily":
      return isPositiveInteger(recurrence.interval)
        ? {
            frequency: "daily",
            interval: recurrence.interval,
          }
        : null;
    case "every_n_days":
      return isPositiveInteger(recurrence.interval)
        ? {
            frequency: "interval_days",
            intervalDays: recurrence.interval,
          }
        : null;
    case "weekly_on_weekdays":
      return isWeekdayArray(recurrence.weekdays)
        ? {
            frequency: "weekly",
            interval: 1,
            daysOfWeek: recurrence.weekdays,
          }
        : null;
    case "every_n_weeks_on_weekdays":
      return isPositiveInteger(recurrence.interval) &&
        isWeekdayArray(recurrence.weekdays)
        ? {
            frequency: "weekly",
            interval: recurrence.interval,
            daysOfWeek: recurrence.weekdays,
          }
        : null;
    case "monthly_on_day":
      return isPositiveInteger(recurrence.interval) &&
        isPositiveInteger(recurrence.day) &&
        recurrence.day <= 31 &&
        (recurrence.fallback === undefined ||
          recurrence.fallback === "last_day_of_month")
        ? {
            frequency: "monthly",
            interval: recurrence.interval,
            dayOfMonth: recurrence.day,
          }
        : null;
    default:
      return null;
  }
}

function toScheduleSlot(
  schedule: BehaviorLogImportSchedulePlan,
): SupportedScheduleImport["slot"] | null {
  if (schedule.windowStartLocal || schedule.windowEndLocal) {
    if (!schedule.windowStartLocal || !schedule.windowEndLocal) {
      return null;
    }

    const preset =
      schedule.cadenceSchedulePreset ??
      cadencePresetForRange(
        schedule.windowStartLocal,
        schedule.windowEndLocal,
      );

    if (!preset) {
      return null;
    }

    return {
      kind: "range",
      preset,
      startTime: schedule.windowStartLocal,
      endTime: schedule.windowEndLocal,
    };
  }

  if (!schedule.localTime) {
    return null;
  }

  return {
    kind: "exact",
    preset: null,
    startTime: schedule.localTime,
    endTime: null,
  };
}

async function createImportedBehaviorWithDefinitionEvent(
  supabase: AppSupabaseClient,
  behaviorPlan: BehaviorLogImportBehaviorPlan,
  schedules: SupportedScheduleImport[],
  appliedAt: string,
  behavior: NewBehavior,
) {
  const recordedAt = behaviorPlan.createdAtUtc ?? new Date().toISOString();
  const definitionEventPlan = planInitialBehaviorDefinitionEvent({
    definition: {
      title: behavior.title,
      description: behavior.description ?? null,
    },
    recordedAt,
    source: "import",
    reason: "behaviorlog_import",
  });

  const scheduleGraph = toImportedBehaviorScheduleGraph(schedules);
  const configurationEventPlan = planInitialBehaviorConfigurationEvent({
    configuration: toImportedBehaviorConfiguration(
      behavior,
      scheduleGraph,
    ),
    recordedAt: appliedAt,
    effectiveAt: appliedAt,
    source: "import",
    reasonCode: "behaviorlog_import",
  });

  return createBehaviorWithAtomicScheduleGraph(supabase, {
    behavior: {
      ...behavior,
      title: definitionEventPlan.nextTitle,
      description: definitionEventPlan.nextDescription,
      created_at: recordedAt,
    },
    definitionEventPlan,
    configurationEventPlan,
    schedules: scheduleGraph,
  });
}

async function applyImportedScheduleChangesToExistingBehaviors(input: {
  supabase: AppSupabaseClient;
  userId: string;
  completedAt: string;
  supportedSchedules: Map<string, SupportedScheduleImport>;
  schedulesByBehavior: Map<string, SupportedScheduleImport[]>;
  actionIndex: Map<string, BehaviorLogImportMergeRecordAction>;
  behaviorIds: Map<string, string>;
  createdBehaviorIds: Set<string>;
  atomicScheduleIds: Map<string, string>;
  existingScheduleIds: Map<string, string>;
}): Promise<void> {
  for (const [behaviorExternalId, importedSchedules] of input.schedulesByBehavior) {
    const behaviorId = input.behaviorIds.get(behaviorExternalId);

    if (!behaviorId || input.createdBehaviorIds.has(behaviorId)) {
      continue;
    }

    const schedulesToCreate = importedSchedules.filter((schedule) => {
      const action = requireMergeAction(
        input.actionIndex,
        "schedule",
        schedule.plan.externalId,
      );

      return (
        action.action === "create_new" &&
        !input.existingScheduleIds.has(schedule.plan.externalId)
      );
    });

    if (schedulesToCreate.length === 0) {
      continue;
    }

    const existingBehavior = await getBehaviorById(
      input.supabase,
      input.userId,
      behaviorId,
    );

    if (!existingBehavior) {
      throw new Error(
        `Imported schedule target behavior ${behaviorId} is unavailable.`,
      );
    }

    const expectedScheduleGraph = toStoredImportScheduleGraph(existingBehavior);
    const appendStartingSortOrder =
      expectedScheduleGraph.reduce(
        (maximum, schedule) => Math.max(maximum, schedule.sort_order),
        -1,
      ) + 1;
    const appendedSchedules = toImportedBehaviorScheduleGraph(
      schedulesToCreate,
      appendStartingSortOrder,
    );
    const nextScheduleGraph = [...expectedScheduleGraph, ...appendedSchedules];
    const previousConfiguration = toImportedBehaviorConfiguration(
      existingBehavior,
      expectedScheduleGraph,
    );
    const nextConfiguration = toImportedBehaviorConfiguration(
      existingBehavior,
      nextScheduleGraph,
    );
    const configurationEventPlan = planBehaviorConfigurationChangeEvent({
      previousConfiguration,
      nextConfiguration,
      recordedAt: input.completedAt,
      effectiveAt: input.completedAt,
      source: "import",
      reasonCode: "behaviorlog_import",
    });

    if (!configurationEventPlan) {
      continue;
    }

    const updatedBehavior = await updateBehaviorWithAtomicScheduleGraph(input.supabase, {
      behaviorId,
      behavior: {
        category_id: existingBehavior.category_id,
        title: existingBehavior.title,
        description: existingBehavior.description,
        recurrence_rule: existingBehavior.recurrence_rule,
        scheduled_time: existingBehavior.scheduled_time,
        timezone: existingBehavior.timezone,
        browser_reminder_enabled: existingBehavior.browser_reminder_enabled,
        email_reminder_enabled: existingBehavior.email_reminder_enabled,
        reminder_offset_minutes: existingBehavior.reminder_offset_minutes,
        active: existingBehavior.active,
        archived_at: existingBehavior.archived_at,
      },
      expectedDefinition: {
        title: existingBehavior.title,
        description: existingBehavior.description,
      },
      expectedNormalizedDefinition: normalizeBehaviorDefinition({
        title: existingBehavior.title,
        description: existingBehavior.description,
      }),
      expectedScheduleGraph,
      expectedUpdatedAt: existingBehavior.updated_at,
      definitionEventPlan: null,
      configurationEventPlan,
      schedules: nextScheduleGraph,
    });

    if (!updatedBehavior) {
      throw new Error(
        `Imported schedule target behavior ${behaviorId} changed before its schedule update.`,
      );
    }

    await recordImportedScheduleIdentities({
      supabase: input.supabase,
      userId: input.userId,
      behaviorId,
      schedules: schedulesToCreate,
      startingSortOrder: appendStartingSortOrder,
      scheduleIds: input.atomicScheduleIds,
    });
  }
}

function toImportedBehaviorScheduleGraph(
  schedules: SupportedScheduleImport[],
  startingSortOrder = 0,
): BehaviorScheduleGraphMutation[] {
  return schedules.map((schedule, index) => ({
    recurrence_rule: schedule.recurrenceRule,
    sort_order: startingSortOrder + index,
    slots: [
      {
        kind: schedule.slot.kind,
        preset: schedule.slot.preset,
        start_time: schedule.slot.startTime,
        end_time: schedule.slot.endTime,
        sort_order: 0,
      },
    ],
  }));
}

function toStoredImportScheduleGraph(
  behavior: Awaited<ReturnType<typeof getBehaviorById>> & {},
): BehaviorScheduleGraphMutation[] {
  return (behavior.schedules ?? []).map((schedule) => ({
    id: schedule.id,
    recurrence_rule: schedule.recurrence_rule,
    sort_order: schedule.sort_order,
    slots: schedule.schedule_slots.map((slot) => ({
      id: slot.id,
      kind: slot.kind,
      preset: slot.preset,
      start_time: slot.start_time,
      end_time: slot.end_time,
      sort_order: slot.sort_order,
    })),
  }));
}

function toImportedBehaviorConfiguration(
  behavior: Pick<
    NewBehavior,
    | "category_id"
    | "browser_reminder_enabled"
    | "email_reminder_enabled"
    | "reminder_offset_minutes"
    | "active"
    | "timezone"
  >,
  schedules: BehaviorScheduleGraphMutation[],
) {
  return normalizeBehaviorConfiguration({
    categoryId: behavior.category_id ?? null,
    scheduleGraph: schedules.map((schedule) => ({
      recurrenceRule: schedule.recurrence_rule,
      sortOrder: schedule.sort_order,
      timeEntries: schedule.slots.map((slot) => ({
        kind: slot.kind,
        preset: slot.preset,
        startTime: slot.start_time,
        endTime: slot.end_time,
        sortOrder: slot.sort_order,
      })),
    })),
    browserReminderEnabled: behavior.browser_reminder_enabled ?? true,
    emailReminderEnabled: behavior.email_reminder_enabled ?? false,
    reminderOffsetMinutes: behavior.reminder_offset_minutes ?? 0,
    active: behavior.active ?? true,
    timezone: behavior.timezone ?? "America/New_York",
  });
}

function failMissingAtomicImportSchedule(externalId: string): never {
  throw new Error(
    `Imported schedule ${externalId} was not created at its atomic behavior boundary.`,
  );
}

async function recordImportedScheduleIdentities(input: {
  supabase: AppSupabaseClient;
  userId: string;
  behaviorId: string;
  schedules: SupportedScheduleImport[];
  startingSortOrder: number;
  scheduleIds: Map<string, string>;
}): Promise<void> {
  const storedBehavior = await getBehaviorById(
    input.supabase,
    input.userId,
    input.behaviorId,
  );

  if (!storedBehavior) {
    throw new Error(
      `Imported behavior ${input.behaviorId} is unavailable after its atomic schedule write.`,
    );
  }

  for (const [index, importedSchedule] of input.schedules.entries()) {
    const expectedSortOrder = input.startingSortOrder + index;
    const candidates = (storedBehavior.schedules ?? []).flatMap((schedule) => {
      if (
        schedule.sort_order !== expectedSortOrder ||
        stableStringify(schedule.recurrence_rule) !==
          stableStringify(importedSchedule.recurrenceRule)
      ) {
        return [];
      }

      return schedule.schedule_slots.filter(
        (slot) =>
          slot.kind === importedSchedule.slot.kind &&
          slot.preset === importedSchedule.slot.preset &&
          normalizeDatabaseTime(slot.start_time) ===
            normalizeDatabaseTime(importedSchedule.slot.startTime) &&
          normalizeNullableDatabaseTime(slot.end_time) ===
            normalizeNullableDatabaseTime(importedSchedule.slot.endTime) &&
          slot.sort_order === 0,
      );
    });

    if (candidates.length !== 1) {
      throw new Error(
        `Imported schedule ${importedSchedule.plan.externalId} could not be matched to one atomic schedule slot.`,
      );
    }

    input.scheduleIds.set(importedSchedule.plan.externalId, candidates[0].id);
  }
}

function normalizeDatabaseTime(value: string): string {
  return value.length === 5 ? `${value}:00` : value;
}

function normalizeNullableDatabaseTime(value: string | null): string | null {
  return value === null ? null : normalizeDatabaseTime(value);
}

function resolveCategoryId(
  categories: Category[],
  behavior: BehaviorLogImportBehaviorPlan,
): string | null {
  const categoryNames = [
    behavior.cadenceCategoryName,
    behavior.category,
  ].filter((name): name is string => Boolean(name));
  const categoryByName = new Map(
    categories.map((category) => [normalizeIdentity(category.name), category.id]),
  );

  for (const name of categoryNames) {
    const categoryId = categoryByName.get(normalizeIdentity(name));

    if (categoryId) {
      return categoryId;
    }
  }

  return null;
}

async function persistMapping(
  supabase: AppSupabaseClient,
  result: MappingApplyResult,
  mapping: BehaviorLogImportRecordMappingInput,
): Promise<void> {
  await createBehaviorLogImportRecordMappings(supabase, [mapping]);
  result.created.mappings += 1;
}

async function persistActionMappingIfLocalId(
  supabase: AppSupabaseClient,
  result: MappingApplyResult,
  input: {
    userId: string;
    importRunId: string;
    action: BehaviorLogImportMergeRecordAction;
  },
): Promise<void> {
  if (!input.action.localId) {
    return;
  }

  await persistMapping(supabase, result, {
    userId: input.userId,
    importRunId: input.importRunId,
    recordType: input.action.recordType,
    externalId: input.action.externalId,
    localId: input.action.localId,
  });
}

async function applyCreateOnlyNotePlan(
  supabase: AppSupabaseClient,
  result: MutableApplyResult,
  input: {
    userId: string;
    importRunId: string;
    note: BehaviorLogImportNotePlan;
    behaviorIds: Map<string, string>;
    occurrenceIds: Map<string, string>;
    statusEventIds: Map<string, string>;
    mappings: MappingIndex;
  },
): Promise<void> {
  if (input.mappings.has(mappingKey("note", input.note.externalId))) {
    result.skipped.notes += 1;
    return;
  }

  if (input.note.action === "skip" || input.note.noteRole === "ai_generated") {
    result.skipped.notes += 1;
    return;
  }

  const targetLocalId = resolveImportedNoteTargetLocalId(input.note, input);

  if (input.note.attachedToType !== "review" && !targetLocalId) {
    addApplyWarning(
      result,
      "note_target_missing",
      `Note ${input.note.externalId} was skipped because its ${input.note.attachedToType} target was not imported or mapped.`,
    );
    result.skipped.notes += 1;
    return;
  }

  const persisted = await persistImportedNoteRecord(supabase, result, {
    userId: input.userId,
    importRunId: input.importRunId,
    note: input.note,
    targetLocalId,
    mappings: input.mappings,
    noteDecision: "create_only_imported_note_record",
  });

  if (!persisted) {
    result.skipped.notes += 1;
    return;
  }

  if (persisted.created) {
    result.created.notes += 1;
  } else {
    result.skipped.notes += 1;
  }

  if (input.note.attachedToType === "occurrence" && targetLocalId) {
    await maybeFillOccurrenceNoteFromImportedNote(supabase, result, {
      userId: input.userId,
      note: input.note,
      occurrenceId: targetLocalId,
      noteDecision: "fill_created_occurrence_note",
    });
  }
}

async function applyNoteMergeAction(
  supabase: AppSupabaseClient,
  result: MutableMergeApplyResult,
  input: {
    userId: string;
    importRunId: string;
    action: BehaviorLogImportMergeRecordAction;
    notePlansByExternalId: Map<string, BehaviorLogImportNotePlan>;
    behaviorIds: Map<string, string>;
    occurrenceIds: Map<string, string>;
    statusEventIds: Map<string, string>;
    mappings: MappingIndex;
  },
): Promise<void> {
  if (input.action.recordType !== "note") {
    throw new Error(
      `Expected a note merge action, received ${input.action.recordType}.`,
    );
  }

  if (input.action.action === "conflict_requires_decision") {
    throw new Error(
      `BehaviorLog merge action for note ${input.action.externalId} still requires a user decision.`,
    );
  }

  if (input.mappings.has(mappingKey("note", input.action.externalId))) {
    result.skipped.notes += 1;
    return;
  }

  const note = input.notePlansByExternalId.get(input.action.externalId);

  if (!note) {
    addApplyWarning(
      result,
      "note_plan_missing",
      `Note ${input.action.externalId} was skipped because the validated note plan was not found.`,
    );
    result.skipped.notes += 1;
    return;
  }

  if (input.action.action === "skip_existing") {
    await persistActionMappingIfLocalId(supabase, result, {
      userId: input.userId,
      importRunId: input.importRunId,
      action: input.action,
    });
    result.skipped.notes += 1;
    return;
  }

  if (note.action === "skip" || note.noteRole === "ai_generated") {
    addApplyWarning(
      result,
      "note_not_product_importable",
      `Note ${note.externalId} was skipped because the validated note plan does not allow importing it.`,
    );
    result.skipped.notes += 1;
    return;
  }

  if (
    input.action.action !== "create_new" &&
    input.action.action !== "map_to_existing"
  ) {
    throw new Error(
      `BehaviorLog merge action ${input.action.action} for note ${note.externalId} cannot be applied.`,
    );
  }

  const noteDecision = readActionMetadataString(
    input.action,
    "noteDecision",
  );
  const targetLocalId =
    readActionMetadataString(input.action, "targetLocalId") ??
    input.action.localId ??
    resolveImportedNoteTargetLocalId(note, input);

  if (note.attachedToType !== "review" && !targetLocalId) {
    addApplyWarning(
      result,
      "note_target_missing",
      `Note ${note.externalId} was skipped because its ${note.attachedToType} target was not imported or mapped.`,
    );
    result.skipped.notes += 1;
    return;
  }

  const persisted = await persistImportedNoteRecord(supabase, result, {
    userId: input.userId,
    importRunId: input.importRunId,
    note,
    targetLocalId,
    mappings: input.mappings,
    noteDecision,
  });

  if (!persisted) {
    result.skipped.notes += 1;
    return;
  }

  if (persisted.created) {
    result.created.notes += 1;
  } else {
    result.mapped.notes += 1;
  }

  if (note.attachedToType === "occurrence" && targetLocalId) {
    await maybeFillOccurrenceNoteFromImportedNote(supabase, result, {
      userId: input.userId,
      note,
      occurrenceId: targetLocalId,
      noteDecision,
    });
  }
}

async function persistImportedNoteRecord(
  supabase: AppSupabaseClient,
  result: MappingApplyResult & { warnings: BehaviorLogImportIssue[] },
  input: {
    userId: string;
    importRunId: string;
    note: BehaviorLogImportNotePlan;
    targetLocalId: string | null;
    mappings: MappingIndex;
    noteDecision: string | null;
  },
): Promise<{ id: string; created: boolean } | null> {
  const importedNote = normalizeImportedNoteBody(input.note.bodyMarkdown);

  if (!importedNote) {
    addApplyWarning(
      result,
      "note_body_empty",
      `Note ${input.note.externalId} was skipped because its normalized body is empty.`,
    );
    return null;
  }

  const existing = await getImportedNoteByImportIdentity(supabase, {
    userId: input.userId,
    externalId: input.note.externalId,
    targetType: input.note.attachedToType,
    targetExternalId: input.note.attachedToId,
  });
  const localNote =
    existing ??
    (await createImportedNote(
      supabase,
      toNewImportedNote({
        userId: input.userId,
        importRunId: input.importRunId,
        note: input.note,
        bodyMarkdown: importedNote,
        targetLocalId: input.targetLocalId,
        noteDecision: input.noteDecision,
      }),
    ));

  await persistMapping(supabase, result, {
    userId: input.userId,
    importRunId: input.importRunId,
    recordType: "note",
    externalId: input.note.externalId,
    localId: localNote.id,
  });
  input.mappings.set(mappingKey("note", input.note.externalId), localNote.id);

  return { id: localNote.id, created: !existing };
}

async function maybeFillOccurrenceNoteFromImportedNote(
  supabase: AppSupabaseClient,
  result: { warnings: BehaviorLogImportIssue[] },
  input: {
    userId: string;
    note: BehaviorLogImportNotePlan;
    occurrenceId: string;
    noteDecision: string | null;
  },
): Promise<void> {
  const importedNote = normalizeImportedNoteBody(input.note.bodyMarkdown);

  if (!importedNote) {
    return;
  }

  const occurrence = await getOccurrenceById(
    supabase,
    input.userId,
    input.occurrenceId,
  );

  if (!occurrence) {
    throw new Error(
      `Accepted import plan maps note ${input.note.externalId} to missing local occurrence ${input.occurrenceId}.`,
    );
  }

  if (noteBodiesEqual(occurrence.note, importedNote)) {
    return;
  }

  if (
    input.noteDecision !== "fill_created_occurrence_note" &&
    input.noteDecision !== "fill_empty_occurrence_note"
  ) {
    return;
  }

  const updatedOccurrence = await updateOccurrenceNoteIfEmpty(supabase, {
    userId: input.userId,
    occurrenceId: input.occurrenceId,
    note: importedNote,
  });

  if (!updatedOccurrence) {
    addApplyWarning(
      result,
      "occurrence_note_not_empty",
      `Note ${input.note.externalId} was stored as passive imported note history, but local occurrence ${input.occurrenceId} no longer has an empty inline note.`,
    );
  }
}

function resolveImportedNoteTargetLocalId(
  note: BehaviorLogImportNotePlan,
  input: {
    behaviorIds: Map<string, string>;
    occurrenceIds: Map<string, string>;
    statusEventIds: Map<string, string>;
  },
): string | null {
  switch (note.attachedToType) {
    case "behavior":
      return input.behaviorIds.get(note.attachedToId) ?? null;
    case "occurrence":
      return input.occurrenceIds.get(note.attachedToId) ?? null;
    case "status_event":
      return input.statusEventIds.get(note.attachedToId) ?? null;
    case "review":
      return null;
  }
}

function toNewImportedNote(input: {
  userId: string;
  importRunId: string;
  note: BehaviorLogImportNotePlan;
  bodyMarkdown: string;
  targetLocalId: string | null;
  noteDecision: string | null;
}): NewImportedNote {
  return {
    user_id: input.userId,
    import_run_id: input.importRunId,
    external_id: input.note.externalId,
    target_type: input.note.attachedToType,
    target_external_id: input.note.attachedToId,
    target_local_id: input.targetLocalId,
    body_markdown: input.bodyMarkdown,
    note_role: input.note.noteRole,
    sensitivity: input.note.sensitivity,
    source_original_id: input.note.sourceOriginalId ?? null,
    source_capture_method: input.note.sourceCaptureMethod,
    source_confidence: input.note.sourceConfidence,
    imported_created_at: input.note.createdAtUtc,
    imported_updated_at: input.note.updatedAtUtc,
    metadata: {
      noteDecision: input.noteDecision,
      attachment: {
        type: input.note.attachedToType,
        externalId: input.note.attachedToId,
        localId: input.targetLocalId,
      },
      passiveImportedNote: true,
      analyticsStatusSideEffects: false,
    },
  } satisfies NewImportedNote;
}

async function applyCreateOnlyInterventionPlan(
  supabase: AppSupabaseClient,
  result: MutableApplyResult,
  input: {
    userId: string;
    importRunId: string;
    intervention: BehaviorLogImportInterventionPreviewPlan;
    behaviorIds: Map<string, string>;
    occurrenceIds: Map<string, string>;
    mappings: MappingIndex;
  },
): Promise<void> {
  if (
    input.mappings.has(mappingKey("intervention", input.intervention.externalId))
  ) {
    result.skipped.interventions += 1;
    return;
  }

  const persisted = await persistImportedInterventionRecord(supabase, result, {
    userId: input.userId,
    importRunId: input.importRunId,
    intervention: input.intervention,
    behaviorId:
      input.behaviorIds.get(input.intervention.behaviorExternalId) ?? null,
    occurrenceId:
      input.occurrenceIds.get(input.intervention.occurrenceExternalId) ?? null,
    mappings: input.mappings,
    interventionDecision: "create_only_passive_history",
  });

  if (!persisted) {
    result.skipped.interventions += 1;
    return;
  }

  if (persisted.created) {
    result.created.interventions += 1;
  } else {
    result.skipped.interventions += 1;
  }
}

async function applyInterventionMergeAction(
  supabase: AppSupabaseClient,
  result: MutableMergeApplyResult,
  input: {
    userId: string;
    importRunId: string;
    action: BehaviorLogImportMergeRecordAction;
    interventionPlansByExternalId: Map<
      string,
      BehaviorLogImportInterventionPreviewPlan
    >;
    behaviorIds: Map<string, string>;
    occurrenceIds: Map<string, string>;
    mappings: MappingIndex;
  },
): Promise<void> {
  if (input.action.recordType !== "intervention") {
    throw new Error(
      `Expected an intervention merge action, received ${input.action.recordType}.`,
    );
  }

  if (input.action.action === "conflict_requires_decision") {
    throw new Error(
      `BehaviorLog merge action for intervention ${input.action.externalId} still requires a user decision.`,
    );
  }

  if (input.mappings.has(mappingKey("intervention", input.action.externalId))) {
    result.skipped.interventions += 1;
    return;
  }

  if (input.action.action === "skip_existing") {
    await persistActionMappingIfLocalId(supabase, result, {
      userId: input.userId,
      importRunId: input.importRunId,
      action: input.action,
    });
    result.skipped.interventions += 1;
    return;
  }

  if (input.action.action === "map_to_existing") {
    await persistActionMappingIfLocalId(supabase, result, {
      userId: input.userId,
      importRunId: input.importRunId,
      action: input.action,
    });
    result.mapped.interventions += 1;
    return;
  }

  if (input.action.action !== "create_new") {
    throw new Error(
      `BehaviorLog merge action ${input.action.action} for intervention ${input.action.externalId} cannot be applied.`,
    );
  }

  const intervention = input.interventionPlansByExternalId.get(
    input.action.externalId,
  );

  if (!intervention) {
    addApplyWarning(
      result,
      "intervention_plan_missing",
      `Intervention ${input.action.externalId} was skipped because the validated intervention plan was not found.`,
    );
    result.skipped.interventions += 1;
    return;
  }

  const persisted = await persistImportedInterventionRecord(supabase, result, {
    userId: input.userId,
    importRunId: input.importRunId,
    intervention,
    behaviorId:
      input.behaviorIds.get(intervention.behaviorExternalId) ??
      readActionMetadataString(input.action, "behaviorLocalId"),
    occurrenceId:
      input.occurrenceIds.get(intervention.occurrenceExternalId) ??
      readActionMetadataString(input.action, "occurrenceLocalId"),
    mappings: input.mappings,
    interventionDecision: readActionMetadataString(
      input.action,
      "interventionDecision",
    ),
  });

  if (!persisted) {
    result.skipped.interventions += 1;
    return;
  }

  if (persisted.created) {
    result.created.interventions += 1;
  } else {
    result.mapped.interventions += 1;
  }
}

async function persistImportedInterventionRecord(
  supabase: AppSupabaseClient,
  result: MappingApplyResult & { warnings: BehaviorLogImportIssue[] },
  input: {
    userId: string;
    importRunId: string;
    intervention: BehaviorLogImportInterventionPreviewPlan;
    behaviorId: string | null;
    occurrenceId: string | null;
    mappings: MappingIndex;
    interventionDecision: string | null;
  },
): Promise<{ id: string; created: boolean } | null> {
  if (!input.intervention.scheduledSendAtUtc) {
    addApplyWarning(
      result,
      "intervention_scheduled_send_missing",
      `Intervention ${input.intervention.externalId} was skipped because it has no scheduled send timestamp.`,
    );
    return null;
  }

  const existing = await getImportedInterventionByImportIdentity(supabase, {
    userId: input.userId,
    importRunId: input.importRunId,
    externalId: input.intervention.externalId,
  });
  const localIntervention =
    existing ??
    (await createImportedIntervention(
      supabase,
      toNewImportedIntervention(input),
    ));

  await persistMapping(supabase, result, {
    userId: input.userId,
    importRunId: input.importRunId,
    recordType: "intervention",
    externalId: input.intervention.externalId,
    localId: localIntervention.id,
  });
  input.mappings.set(
    mappingKey("intervention", input.intervention.externalId),
    localIntervention.id,
  );

  return { id: localIntervention.id, created: !existing };
}

function toNewImportedIntervention(input: {
  userId: string;
  importRunId: string;
  intervention: BehaviorLogImportInterventionPreviewPlan;
  behaviorId: string | null;
  occurrenceId: string | null;
  interventionDecision: string | null;
}): NewImportedIntervention {
  if (!input.intervention.scheduledSendAtUtc) {
    throw new Error(
      `Intervention ${input.intervention.externalId} is missing scheduled send timestamp.`,
    );
  }

  return {
    user_id: input.userId,
    import_run_id: input.importRunId,
    external_id: input.intervention.externalId,
    behavior_external_id: input.intervention.behaviorExternalId,
    occurrence_external_id: input.intervention.occurrenceExternalId,
    behavior_id: input.behaviorId,
    occurrence_id: input.occurrenceId,
    intervention_type: input.intervention.interventionType,
    channel: input.intervention.channel,
    delivery_status: input.intervention.deliveryStatus,
    scheduled_send_at: input.intervention.scheduledSendAtUtc,
    sent_at: input.intervention.sentAtUtc,
    failure_reason: input.intervention.failureReason,
    source_original_id: input.intervention.sourceOriginalId ?? null,
    source_capture_method: input.intervention.sourceCaptureMethod,
    source_confidence: input.intervention.sourceConfidence,
    redacted_sensitivity_indicators: {
      droppedSensitiveFields:
        input.intervention.storageDecision.droppedSensitiveFields,
      redactedFields: input.intervention.storageDecision.redactedFields,
      containsSensitiveDeliveryPayload:
        input.intervention.storageDecision.droppedSensitiveFields.length > 0 ||
        input.intervention.storageDecision.redactedFields.length > 0,
      rawMessageBodyStored: false,
      rawEndpointStored: false,
      recipientIdentifiersStored: false,
    },
    metadata: {
      interventionDecision: input.interventionDecision,
      storageDecision: input.intervention.storageDecision,
      passiveImportedIntervention: true,
      reminderDeliverySideEffects: false,
      providerSideEffects: false,
      attachment: {
        behavior: {
          externalId: input.intervention.behaviorExternalId,
          localId: input.behaviorId,
        },
        occurrence: {
          externalId: input.intervention.occurrenceExternalId,
          localId: input.occurrenceId,
        },
      },
    },
  } satisfies NewImportedIntervention;
}

function toNewOccurrence(input: {
  userId: string;
  behaviorId: string;
  scheduleId: string | null;
  occurrence: BehaviorLogImportOccurrencePlan;
  supportedSchedule: SupportedScheduleImport;
}): NewOccurrence {
  return {
    user_id: input.userId,
    behavior_id: input.behaviorId,
    behavior_schedule_slot_id: input.scheduleId,
    scheduled_for: input.occurrence.scheduledForUtc,
    local_date: input.occurrence.localDate,
    schedule_kind: input.supportedSchedule.slot.kind,
    schedule_preset: input.supportedSchedule.slot.preset,
    schedule_start_time: input.supportedSchedule.slot.startTime,
    schedule_end_time: input.supportedSchedule.slot.endTime,
    status: "unresolved",
    completed_at: null,
    status_marked_at: null,
    created_at: input.occurrence.generatedAtUtc ?? undefined,
  };
}

function toNewStatusEvent(input: {
  userId: string;
  occurrenceId: string;
  behaviorId: string;
  event: BehaviorLogImportStatusEventPlan;
  revisesEventId: string | null;
  result: MutableApplyResult;
}): NewOccurrenceStatusEvent {
  if (input.event.revisesEventId && !input.revisesEventId) {
    addApplyWarning(
      input.result,
      "status_event_revision_target_missing",
      `Status event ${input.event.externalId} revises ${input.event.revisesEventId}, but that event was not imported before it.`,
    );
  }

  return {
    user_id: input.userId,
    occurrence_id: input.occurrenceId,
    behavior_id: input.behaviorId,
    previous_status: input.event.previousStatus,
    status: input.event.status,
    status_semantics: input.event.statusSemantics,
    recorded_at: input.event.recordedAtUtc,
    effective_at: input.event.effectiveAtUtc,
    local_date: input.event.localDate,
    timezone: input.event.timezone,
    source_capture_method: input.event.sourceCaptureMethod,
    source_confidence: input.event.sourceConfidence,
    revises_event_id: input.revisesEventId,
    reason_code: input.event.reasonCode,
  };
}

function occurrenceStatusUpdateFromEvent(
  event: BehaviorLogImportStatusEventPlan,
): {
  status: OccurrenceStatus;
  completed_at: string | null;
  status_marked_at: string | null;
} {
  return {
    status: event.status,
    completed_at:
      event.status === "completed"
        ? event.effectiveAtUtc ?? event.recordedAtUtc
        : null,
    status_marked_at:
      event.status === "unresolved" ? null : event.recordedAtUtc,
  };
}

async function updateMergeOccurrenceSnapshots(input: {
  supabase: AppSupabaseClient;
  userId: string;
  importedEventsByOccurrenceId: Map<string, BehaviorLogImportStatusEventPlan[]>;
  statusEventIds: Map<string, string>;
  result: MutableMergeApplyResult;
}): Promise<void> {
  const occurrenceIds = [...input.importedEventsByOccurrenceId.keys()];
  const localEvents = await listOccurrenceStatusEventsByOccurrenceIds(
    input.supabase,
    input.userId,
    occurrenceIds,
  );
  const localEventsByOccurrenceId = groupBy(
    localEvents,
    (event) => event.occurrence_id,
  );
  const importedLocalIds = new Set(input.statusEventIds.values());

  for (const [occurrenceId, importedEvents] of input.importedEventsByOccurrenceId) {
    const latestImportedEvent = [...importedEvents].sort(
      compareImportStatusEventsBySnapshotOrder,
    ).at(-1);

    if (!latestImportedEvent) {
      continue;
    }

    const latestImportedLocalId = input.statusEventIds.get(
      latestImportedEvent.externalId,
    );

    if (!latestImportedLocalId) {
      continue;
    }

    const occurrenceEvents = localEventsByOccurrenceId.get(occurrenceId) ?? [];
    const latestLocalEvent = [...occurrenceEvents].sort(
      compareOccurrenceStatusEventsBySnapshotOrder,
    ).at(-1);

    if (latestLocalEvent?.id !== latestImportedLocalId) {
      continue;
    }

    if (
      shouldProtectLocalExplicitStatus({
        latestImportedEvent,
        occurrenceEvents,
        importedLocalIds,
      })
    ) {
      addApplyWarning(
        input.result,
        "status_snapshot_protected_by_high_confidence_local_event",
        `Occurrence ${occurrenceId} snapshot was not updated from imported status event ${latestImportedEvent.externalId} because a local explicit high-confidence event has priority.`,
      );
      continue;
    }

    await updateOccurrenceById(
      input.supabase,
      input.userId,
      occurrenceId,
      occurrenceStatusUpdateFromEvent(latestImportedEvent),
    );
  }
}

function addImportedEvent(
  eventsByOccurrenceId: Map<string, BehaviorLogImportStatusEventPlan[]>,
  occurrenceId: string,
  event: BehaviorLogImportStatusEventPlan,
): void {
  const events = eventsByOccurrenceId.get(occurrenceId) ?? [];
  events.push(event);
  eventsByOccurrenceId.set(occurrenceId, events);
}

function compareImportStatusEvents(
  left: BehaviorLogImportStatusEventPlan,
  right: BehaviorLogImportStatusEventPlan,
): number {
  const recordedComparison = Temporal.Instant.compare(
    Temporal.Instant.from(left.recordedAtUtc),
    Temporal.Instant.from(right.recordedAtUtc),
  );

  if (recordedComparison !== 0) {
    return recordedComparison;
  }

  return left.externalId.localeCompare(right.externalId);
}

function compareImportStatusEventsBySnapshotOrder(
  left: BehaviorLogImportStatusEventPlan,
  right: BehaviorLogImportStatusEventPlan,
): number {
  return compareStatusEventOrderKeys(
    statusEventOrderKeyFromImport(left),
    statusEventOrderKeyFromImport(right),
  );
}

function compareOccurrenceStatusEventsBySnapshotOrder(
  left: OccurrenceStatusEvent,
  right: OccurrenceStatusEvent,
): number {
  return compareStatusEventOrderKeys(
    statusEventOrderKeyFromRow(left),
    statusEventOrderKeyFromRow(right),
  );
}

function compareStatusEventOrderKeys(
  left: StatusEventOrderKey,
  right: StatusEventOrderKey,
): number {
  const effectiveComparison = Temporal.Instant.compare(
    Temporal.Instant.from(left.effectiveAtOrRecordedAt),
    Temporal.Instant.from(right.effectiveAtOrRecordedAt),
  );

  if (effectiveComparison !== 0) {
    return effectiveComparison;
  }

  const recordedComparison = Temporal.Instant.compare(
    Temporal.Instant.from(left.recordedAt),
    Temporal.Instant.from(right.recordedAt),
  );

  if (recordedComparison !== 0) {
    return recordedComparison;
  }

  return left.tieBreaker.localeCompare(right.tieBreaker);
}

type StatusEventOrderKey = {
  effectiveAtOrRecordedAt: string;
  recordedAt: string;
  tieBreaker: string;
};

function statusEventOrderKeyFromImport(
  event: BehaviorLogImportStatusEventPlan,
): StatusEventOrderKey {
  return {
    effectiveAtOrRecordedAt: event.effectiveAtUtc ?? event.recordedAtUtc,
    recordedAt: event.recordedAtUtc,
    tieBreaker: event.externalId,
  };
}

function statusEventOrderKeyFromRow(
  event: OccurrenceStatusEvent,
): StatusEventOrderKey {
  return {
    effectiveAtOrRecordedAt: event.effective_at ?? event.recorded_at,
    recordedAt: event.recorded_at,
    tieBreaker: event.id,
  };
}

function shouldProtectLocalExplicitStatus(input: {
  latestImportedEvent: BehaviorLogImportStatusEventPlan;
  occurrenceEvents: OccurrenceStatusEvent[];
  importedLocalIds: Set<string>;
}): boolean {
  if (!isAmbiguousOrLowerConfidenceImport(input.latestImportedEvent)) {
    return false;
  }

  return input.occurrenceEvents.some(
    (event) =>
      !input.importedLocalIds.has(event.id) &&
      isExplicitHighConfidenceLocalEvent(event) &&
      event.status !== input.latestImportedEvent.status,
  );
}

function isAmbiguousOrLowerConfidenceImport(
  event: BehaviorLogImportStatusEventPlan,
): boolean {
  return (
    event.statusSemantics === "ambiguous_import" ||
    event.sourceConfidence === "medium" ||
    event.sourceConfidence === "low" ||
    event.sourceConfidence === "ambiguous" ||
    event.sourceConfidence === "unknown"
  );
}

function isExplicitHighConfidenceLocalEvent(
  event: OccurrenceStatusEvent,
): boolean {
  return (
    (event.status_semantics === "explicit_user_mark" ||
      event.status_semantics === "explicit_user_correction") &&
    event.source_confidence === "high"
  );
}

function groupBy<T>(
  values: T[],
  getKey: (value: T) => string,
): Map<string, T[]> {
  const groups = new Map<string, T[]>();

  for (const value of values) {
    const key = getKey(value);
    const group = groups.get(key) ?? [];
    group.push(value);
    groups.set(key, group);
  }

  return groups;
}

function addApplyWarning(
  result: { warnings: BehaviorLogImportIssue[] },
  code: string,
  message: string,
): void {
  if (
    result.warnings.some(
      (warning) => warning.code === code && warning.message === message,
    )
  ) {
    return;
  }

  result.warnings.push({
    severity: "warning",
    code,
    message,
  });
}

function readActionMetadataString(
  action: BehaviorLogImportMergeRecordAction,
  field: string,
): string | null {
  const value = action.metadata?.[field];

  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function normalizeImportedNoteBody(value: string): string | null {
  const normalized = value.replace(/\r\n/g, "\n").trim();

  return normalized.length > 0 ? normalized : null;
}

function noteBodiesEqual(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const normalize = (value: string | null | undefined) =>
    value?.replace(/\r\n/g, "\n").trim() || null;

  return normalize(left) === normalize(right);
}

function mappingKey(recordType: string, externalId: string): string {
  return `${recordType}:${externalId}`;
}

function normalizeIdentity(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function cadencePresetForRange(
  startTime: string,
  endTime: string,
): SupportedScheduleImport["slot"]["preset"] {
  return (
    CADENCE_RANGE_PRESETS.find(
      (preset) => preset.startTime === startTime && preset.endTime === endTime,
    )?.preset ?? null
  );
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isWeekdayArray(value: unknown): value is Weekday[] {
  return Array.isArray(value) && value.length > 0 && value.every(isWeekday);
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

function normalizeImportRunInput(
  input: BehaviorLogImportRunCreateInput,
): BehaviorLogImportRunCreateInput {
  return {
    ...input,
    bundleFormat: requireNonempty(input.bundleFormat, "bundleFormat"),
    manifestSha256: normalizeSha256(input.manifestSha256),
    bundleFingerprint: normalizeSha256(input.bundleFingerprint),
    acceptedPreviewRunId: normalizeNullableString(
      input.acceptedPreviewRunId ?? null,
    ),
    acceptedPreviewFingerprint: normalizeSha256(
      input.acceptedPreviewFingerprint ?? null,
    ),
    producerName: normalizeNullableString(input.producerName),
    producerVersion: normalizeNullableString(input.producerVersion),
    subjectIdStrategy: normalizeNullableString(input.subjectIdStrategy),
    privacyRedactionLevel: normalizeNullableString(input.privacyRedactionLevel),
    failureMessage: normalizeNullableString(input.failureMessage ?? null),
    dryRunSummary: { ...input.dryRunSummary },
  };
}

function normalizeMappingInput(
  input: BehaviorLogImportRecordMappingInput,
): BehaviorLogImportRecordMappingInput {
  return {
    ...input,
    externalId: requireNonempty(input.externalId, "externalId"),
    localId: requireNonempty(input.localId, "localId"),
  };
}

function readManifestMetadata(files: BehaviorLogImportFile[]): {
  bundleFormat: string | null;
  schemaVersion: string | null;
  manifestSha256: string | null;
  producerName: string | null;
  producerVersion: string | null;
  subjectIdStrategy: string | null;
  privacyRedactionLevel: string | null;
} {
  const manifestFile = files.find((file) => file.path === "manifest.json");
  const manifestSha256 = manifestFile ? sha256(manifestFile.content) : null;
  const manifest = parseJsonObject(manifestFile?.content ?? null);
  const producer = readObject(manifest?.producer);
  const privacy = readObject(manifest?.privacy);

  return {
    bundleFormat: readString(manifest?.format),
    schemaVersion: readString(manifest?.schema_version),
    manifestSha256,
    producerName: readString(producer?.name),
    producerVersion:
      readString(producer?.version) ?? readString(producer?.exporter_version),
    subjectIdStrategy: readString(privacy?.subject_id_strategy),
    privacyRedactionLevel: readString(privacy?.redaction_level),
  };
}

function toDryRunSummarySnapshot(
  preview: BehaviorLogImportPreview,
): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {
    ...preview.summary,
    valid: preview.valid,
  };

  if (preview.mergePreview) {
    snapshot.mergePreview = {
      mode: preview.mergePreview.mode,
      privacy: preview.mergePreview.privacy,
      semantics: preview.mergePreview.semantics,
      actionCounts: preview.mergePreview.actionCounts,
      conflictCodes: preview.mergePreview.conflictCodes,
      conflictCount: preview.mergePreview.conflictCount,
      conflicts: preview.mergePreview.conflicts,
      actions: preview.mergePreview.actions,
    };
  }

  if (hasPreviewBinding(preview)) {
    snapshot.previewFingerprint = preview.previewFingerprint;
    snapshot.localDataFingerprint = preview.localDataFingerprint;
    snapshot.bundleFingerprint = preview.bundleFingerprint;
  }

  return snapshot;
}

function hasPreviewBinding(
  preview: BehaviorLogImportPreview,
): preview is BehaviorLogImportMergePreviewResult {
  const candidate = preview as Partial<BehaviorLogImportMergePreviewResult>;

  return (
    Boolean(preview.mergePreview) &&
    typeof candidate.previewFingerprint === "string" &&
    typeof candidate.localDataFingerprint === "string" &&
    typeof candidate.bundleFingerprint === "string"
  );
}

function parseJsonObject(content: string | null): Record<string, unknown> | null {
  if (!content) {
    return null;
  }

  try {
    return readObject(JSON.parse(content));
  } catch {
    return null;
  }
}

function readObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function normalizeNullableString(value: string | null): string | null {
  return value?.trim() || null;
}

function normalizeSha256(value: string | null): string | null {
  const normalized = normalizeNullableString(value);

  return normalized ? normalized.toLowerCase() : null;
}

function requireNonempty(value: string, field: string): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error(`BehaviorLog import ${field} is required.`);
  }

  return normalized;
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }

  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortJson(entry)]),
    );
  }

  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
