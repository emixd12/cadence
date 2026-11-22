import { sha256 } from "../hash";

import { Temporal } from "@js-temporal/polyfill";
import { BEHAVIORLOG_INTERVENTION_CHANNELS, BEHAVIORLOG_INTERVENTION_DELIVERY_STATUSES } from "../types/behaviorlog-import";

import type {
  BehaviorLogExistingRecords,
  BehaviorLogInterventionChannel,
  BehaviorLogInterventionDeliveryStatus,
  BehaviorLogImportBehaviorPlan,
  BehaviorLogImportConflict,
  BehaviorLogImportDayGroup,
  BehaviorLogImportDefinitionEventPlan,
  BehaviorLogImportFile,
  BehaviorLogImportInterventionRulePlan,
  BehaviorLogImportInterventionPreviewPlan,
  BehaviorLogImportIssue,
  BehaviorLogImportMergeConflict,
  BehaviorLogImportMergePreview,
  BehaviorLogImportMergePreviewResult,
  BehaviorLogImportMergeRecordAction,
  BehaviorLogNoteSensitivity,
  BehaviorLogImportNotePlan,
  BehaviorLogImportOccurrencePlan,
  BehaviorLogImportPlan,
  BehaviorLogImportPreview,
  BehaviorLogImportRecordType,
  BehaviorLogImportSchedulePlan,
  BehaviorLogImportStatusEventPlan,
  BehaviorLogImportTimeSessionPlan,
  BehaviorLogSourceCaptureMethod,
  BehaviorLogSourceConfidence,
  BehaviorLogStatusSemantics,
  BehaviorLogUnsupportedField,
  BehaviorLogImportBehaviorRun,
} from "../types/behaviorlog-import";
import type { OccurrenceStatus } from "../types/database";
import { behaviorLogScheduleIdentity, collectBehaviorLogPortability } from "../services/behaviorlog-preservation";
import { parseArchiveNotes } from "./archive-note.resolver";
import type { Json } from "../types/json";

const BEHAVIORLOG_FORMAT = "behaviorlog.bundle";
const BEHAVIORLOG_SUPPORTED_SCHEMA_VERSIONS = [
  "0.1.0-draft",
  "0.2.0-draft",
  "0.3.0-draft",
] as const;
const BEHAVIORLOG_EXTENSION_NAMESPACE = "app.cadence";
const CADENCE_TIME_SESSIONS_PATH =
  "raw/cadence/occurrence_time_sessions.jsonl";
const TIMEZONE_VALIDATION_INSTANT = Temporal.Instant.from(
  "2000-01-01T00:00:00Z",
);

const CADENCE_RANGE_PRESETS = [
  {
    preset: "morning",
    start: "06:00",
    end: "12:00",
  },
  {
    preset: "afternoon",
    start: "12:00",
    end: "18:00",
  },
  {
    preset: "evening",
    start: "18:00",
    end: "00:00",
  },
  {
    preset: "night",
    start: "00:00",
    end: "06:00",
  },
] as const;

const REQUIRED_PATHS = [
  "manifest.json",
  "schema.json",
  "README.md",
  "AGENTS.md",
  "data/behaviors.jsonl",
  "data/schedules.jsonl",
  "data/occurrences.jsonl",
  "data/status_events.jsonl",
] as const;

const JSONL_FILES = {
  behaviors: "data/behaviors.jsonl",
  schedules: "data/schedules.jsonl",
  occurrences: "data/occurrences.jsonl",
  statusEvents: "data/status_events.jsonl",
  definitionEvents: "data/behavior_definition_events.jsonl",
  timeSessions: "data/time_sessions.jsonl",
  interventionRules: "data/intervention_rules.jsonl",
  notes: "data/notes.jsonl",
  interventions: "data/interventions.jsonl",
} as const;

const DEFINITION_EVENT_FIELDS = new Set([
  "record_type",
  "event_id",
  "behavior_id",
  "event_kind",
  "changed_fields",
  "previous",
  "next",
  "recorded_at_utc",
  "local_date",
  "timezone",
  "utc_offset_at_event",
  "reason_code",
  "source",
  "extensions",
]);

const TIME_SESSION_FIELDS = new Set([
  "record_type",
  "session_id",
  "occurrence_id",
  "behavior_id",
  "started_at_utc",
  "stopped_at_utc",
  "timezone",
  "local_date",
  "source",
  "extensions",
]);

const INTERVENTION_RULE_FIELDS = new Set([
  "record_type",
  "rule_id",
  "behavior_id",
  "intervention_type",
  "channel",
  "enabled",
  "offset_minutes",
  "active_from_local_date",
  "active_until_local_date",
  "timezone",
  "message_variant",
  "source",
  "extensions",
]);

const BEHAVIOR_FIELDS = new Set([
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
]);

const SCHEDULE_FIELDS = new Set([
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
]);

const OCCURRENCE_FIELDS = new Set([
  "record_type",
  "occurrence_id",
  "behavior_id",
  "schedule_id",
  "configuration_event_id",
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
  "source",
  "extensions",
]);

const STATUS_EVENT_FIELDS = new Set([
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
]);

const NOTE_FIELDS = new Set([
  "record_type",
  "note_id",
  "attached_to_type",
  "attached_to_id",
  "body_markdown",
  "note_role",
  "created_at_utc",
  "updated_at_utc",
  "sensitivity",
  "source",
  "extensions",
]);

const INTERVENTION_FIELDS = new Set([
  "record_type",
  "intervention_id",
  "behavior_id",
  "occurrence_id",
  "intervention_type",
  "channel",
  "scheduled_send_at_utc",
  "planned_for_utc",
  "sent_at_utc",
  "delivery_status",
  "failure_reason",
  "rule_id",
  "source",
  "extensions",
  "message_body",
  "body",
  "email_body",
  "push_payload",
  "payload",
  "endpoint",
  "raw_endpoint",
  "provider_id",
  "provider_identifier",
  "provider_message_id",
  "provider_delivery_id",
  "provider_secret",
  "api_key",
  "secret",
  "token",
  "subscription",
  "subscription_key",
  "subscription_keys",
  "p256dh",
  "auth",
  "recipient",
  "recipient_id",
  "recipient_email",
  "email",
  "phone",
  "address",
  "to",
]);

type JsonRecord = Record<string, unknown>;

type ParsedJsonlRecord = {
  file: string;
  row: number;
  record: JsonRecord;
};

export type ResolveBehaviorLogImportPreviewInput = {
  reminderChannel?: "browser_push" | "other";
  convertNativeRemindersToBrowser?: boolean;
  files: BehaviorLogImportFile[];
  existing?: BehaviorLogExistingRecords;
  supportedSchemaVersions?: readonly string[];
};

export type ResolveBehaviorLogImportMergePreviewInput = Omit<
  ResolveBehaviorLogImportPreviewInput,
  "existing"
> & {
  existing?: BehaviorLogExistingRecords;
};

export function resolveBehaviorLogImportPreview(
  input: ResolveBehaviorLogImportPreviewInput,
): BehaviorLogImportPreview {
  const errors: BehaviorLogImportIssue[] = [];
  const warnings: BehaviorLogImportIssue[] = [];
  const conflicts: BehaviorLogImportConflict[] = [];
  const unsupportedFields: BehaviorLogUnsupportedField[] = [];
  const fileMap = buildFileMap(input.files, errors);
  const manifest = parseJsonFile("manifest.json", fileMap, errors);
  const schemaVersion = readManifestSchemaVersion(manifest);

  validateRequiredFiles(fileMap, errors);
  validateManifest({
    manifest,
    fileMap,
    errors,
    warnings,
    supportedSchemaVersions:
      input.supportedSchemaVersions ?? BEHAVIORLOG_SUPPORTED_SCHEMA_VERSIONS,
  });
  validateCadenceTimeSessions({
    manifest,
    fileMap,
    errors,
    warnings,
  });
  parseJsonFile("schema.json", fileMap, errors);

  const behaviorRows = parseJsonlFile({
    file: JSONL_FILES.behaviors,
    expectedRecordType: "behavior",
    allowedFields: BEHAVIOR_FIELDS,
    fileMap,
    errors,
    unsupportedFields,
  });
  const scheduleRows = parseJsonlFile({
    file: JSONL_FILES.schedules,
    expectedRecordType: "schedule",
    allowedFields: SCHEDULE_FIELDS,
    fileMap,
    errors,
    unsupportedFields,
  });
  const occurrenceRows = parseJsonlFile({
    file: JSONL_FILES.occurrences,
    expectedRecordType: "occurrence",
    allowedFields: OCCURRENCE_FIELDS,
    fileMap,
    errors,
    unsupportedFields,
  });
  const statusEventRows = parseJsonlFile({
    file: JSONL_FILES.statusEvents,
    expectedRecordType: "status_event",
    allowedFields: STATUS_EVENT_FIELDS,
    fileMap,
    errors,
    unsupportedFields,
  });
  const definitionEventRows = fileMap.has(JSONL_FILES.definitionEvents)
    ? parseJsonlFile({
        file: JSONL_FILES.definitionEvents,
        expectedRecordType: "behavior_definition_event",
        allowedFields: DEFINITION_EVENT_FIELDS,
        fileMap,
        errors,
        unsupportedFields,
      })
    : [];
  const timeSessionRows = fileMap.has(JSONL_FILES.timeSessions)
    ? parseJsonlFile({
        file: JSONL_FILES.timeSessions,
        expectedRecordType: "time_session",
        allowedFields: TIME_SESSION_FIELDS,
        fileMap,
        errors,
        unsupportedFields,
      })
    : [];
  const interventionRuleRows = fileMap.has(JSONL_FILES.interventionRules)
    ? parseJsonlFile({
        file: JSONL_FILES.interventionRules,
        expectedRecordType: "intervention_rule",
        allowedFields: INTERVENTION_RULE_FIELDS,
        fileMap,
        errors,
        unsupportedFields,
      })
    : [];
  const noteRows = fileMap.has(JSONL_FILES.notes)
    ? parseJsonlFile({
        file: JSONL_FILES.notes,
        expectedRecordType: "note",
        allowedFields: NOTE_FIELDS,
        fileMap,
        errors,
        unsupportedFields,
      })
    : [];
  const interventionRows = fileMap.has(JSONL_FILES.interventions)
    ? parseJsonlFile({
        file: JSONL_FILES.interventions,
        expectedRecordType: "intervention",
        allowedFields: INTERVENTION_FIELDS,
        fileMap,
        errors,
        unsupportedFields,
      })
    : [];
  const plan: BehaviorLogImportPlan = {
    behaviors: behaviorRows
      .map((row) => toBehaviorPlan(row, errors, warnings))
      .filter((record): record is BehaviorLogImportBehaviorPlan =>
        Boolean(record),
      ),
    schedules: scheduleRows
      .map((row) => toSchedulePlan(row, errors))
      .filter((record): record is BehaviorLogImportSchedulePlan =>
        Boolean(record),
      ),
    occurrences: occurrenceRows
      .map((row) => toOccurrencePlan(row, errors))
      .filter((record): record is BehaviorLogImportOccurrencePlan =>
        Boolean(record),
      ),
    statusEvents: statusEventRows
      .map((row) => toStatusEventPlan(row, errors))
      .filter((record): record is BehaviorLogImportStatusEventPlan =>
        Boolean(record),
      ),
    definitionEvents: definitionEventRows
      .map((row) => toDefinitionEventPlan(row, errors, warnings))
      .filter((record): record is BehaviorLogImportDefinitionEventPlan =>
        Boolean(record),
      ),
    timeSessions: timeSessionRows
      .map((row) => toTimeSessionPlan(row, errors))
      .filter((record): record is BehaviorLogImportTimeSessionPlan =>
        Boolean(record),
      ),
    ...(fileMap.has(JSONL_FILES.interventionRules)
      ? {
          interventionRules: interventionRuleRows
            .map((row) => toInterventionRulePlan(row, errors, warnings, input.reminderChannel, input.convertNativeRemindersToBrowser))
            .filter(
              (record): record is BehaviorLogImportInterventionRulePlan =>
                Boolean(record),
            ),
        }
      : {}),
    notes: noteRows
      .map((row) => toNotePlan(row, errors))
      .filter((record): record is BehaviorLogImportNotePlan =>
        Boolean(record),
      ),
    interventions: interventionRows
      .map((row) => toInterventionPlan(row, schemaVersion, errors, warnings))
      .filter((record): record is BehaviorLogImportInterventionPreviewPlan =>
        Boolean(record),
      ),
  };

  validateDuplicateInterventionIds(plan, errors);
  skipDuplicateInterventionRules(plan, warnings);
  validateCrossReferences({ plan, errors, warnings });
  validateSubBehaviorLinks({ plan, errors, warnings });
  limitRunningTimeSessions(plan, warnings);
  validateNoteImportPolicy({ plan, warnings });
  validateSupportedSchedules({ plan, warnings, exportedAtUtc: typeof manifest?.exported_at_utc === "string" ? manifest.exported_at_utc : null });
  markConflicts({ plan, existing: input.existing, conflicts, warnings });
  warnAboutSnapshotHistory({ plan, warnings });
  const portability = collectBehaviorLogPortability({ files: input.files, manifest, plan, errors, warnings });

  return {
    valid: errors.length === 0,
    portability,
    summary: summarizePreview({
      schemaVersion,
      fileCount: fileMap.size,
      plan,
      errors,
      warnings,
      conflicts,
      unsupportedFields,
    }),
    errors,
    warnings,
    conflicts,
    unsupportedFields,
    plan,
  };
}

export function resolveBehaviorLogImportMergePreview(
  input: ResolveBehaviorLogImportMergePreviewInput,
): BehaviorLogImportMergePreviewResult {
  const preview = resolveBehaviorLogImportPreview({
    files: input.files,
    supportedSchemaVersions: input.supportedSchemaVersions,
    reminderChannel: input.reminderChannel,
    convertNativeRemindersToBrowser: input.convertNativeRemindersToBrowser,
  });
  const mergePreview = buildMergePreview({
    plan: preview.plan,
    existing: input.existing,
    privacy: readPrivacySummary(input.files),
    interventions: preview.plan.interventions,
  });
  const bundleFingerprint = createBehaviorLogImportBundleFingerprint(input.files);
  const localDataFingerprint = createBehaviorLogImportLocalDataFingerprint(
    input.existing,
  );
  const previewFingerprint = sha256(
    stableStringify({
      bundleFingerprint,
      localDataFingerprint,
      mergePreview,
      ...(input.convertNativeRemindersToBrowser ? { convertNativeRemindersToBrowser: true } : {}),
      semanticsVersion: 1,
    }),
  );

  return {
    ...preview,
    mergePreview,
    bundleFingerprint,
    localDataFingerprint,
    previewFingerprint,
  };
}

function buildFileMap(
  files: BehaviorLogImportFile[],
  errors: BehaviorLogImportIssue[],
): Map<string, BehaviorLogImportFile> {
  const map = new Map<string, BehaviorLogImportFile>();

  for (const file of files) {
    if (!file.path || file.path.trim().length === 0) {
      errors.push({
        severity: "error",
        code: "file_path_missing",
        message: "A bundle file has no path.",
      });
      continue;
    }

    if (map.has(file.path)) {
      errors.push({
        severity: "error",
        code: "duplicate_file",
        message: `Bundle includes duplicate file path ${file.path}.`,
        file: file.path,
      });
      continue;
    }

    map.set(file.path, file);
  }

  return map;
}

function validateRequiredFiles(
  fileMap: Map<string, BehaviorLogImportFile>,
  errors: BehaviorLogImportIssue[],
): void {
  for (const path of REQUIRED_PATHS) {
    if (!fileMap.has(path)) {
      errors.push({
        severity: "error",
        code: "required_file_missing",
        message: `Required BehaviorLog file is missing: ${path}.`,
        file: path,
      });
    }
  }
}

function validateManifest(input: {
  manifest: JsonRecord | null;
  fileMap: Map<string, BehaviorLogImportFile>;
  errors: BehaviorLogImportIssue[];
  warnings: BehaviorLogImportIssue[];
  supportedSchemaVersions: readonly string[];
}): void {
  if (!input.manifest) {
    return;
  }

  const format = input.manifest.format;
  const schemaVersion = input.manifest.schema_version;

  if (format !== BEHAVIORLOG_FORMAT) {
    input.errors.push({
      severity: "error",
      code: "unsupported_format",
      message: `Unsupported BehaviorLog format: ${String(format)}.`,
      file: "manifest.json",
    });
  }

  if (
    typeof schemaVersion !== "string" ||
    !input.supportedSchemaVersions.includes(schemaVersion)
  ) {
    input.errors.push({
      severity: "error",
      code: "unsupported_schema_version",
      message: `Unsupported BehaviorLog schema version: ${String(
        schemaVersion,
      )}.`,
      file: "manifest.json",
    });
  }

  if (!Array.isArray(input.manifest.files)) {
    input.errors.push({
      severity: "error",
      code: "manifest_files_invalid",
      message: "manifest.json must include a files array.",
      file: "manifest.json",
    });
    return;
  }

  const listedPaths = new Set<string>();

  for (const [index, entry] of input.manifest.files.entries()) {
    if (!isRecord(entry)) {
      input.errors.push({
        severity: "error",
        code: "manifest_file_invalid",
        message: `manifest.json files[${index}] must be an object.`,
        file: "manifest.json",
      });
      continue;
    }

    const path = entry.path;

    if (typeof path !== "string" || path.length === 0) {
      input.errors.push({
        severity: "error",
        code: "manifest_file_path_invalid",
        message: `manifest.json files[${index}].path must be a non-empty string.`,
        file: "manifest.json",
      });
      continue;
    }

    listedPaths.add(path);

    const file = input.fileMap.get(path);

    if (!file) {
      input.errors.push({
        severity: "error",
        code: "manifest_listed_file_missing",
        message: `manifest.json lists ${path}, but the file is absent.`,
        file: "manifest.json",
        path,
      });
      continue;
    }

    if (typeof entry.sha256 !== "string") {
      input.errors.push({
        severity: "error",
        code: "manifest_hash_missing",
        message: `manifest.json entry for ${path} must include sha256.`,
        file: "manifest.json",
        path,
      });
      continue;
    }

    const actualHash = sha256(file.content);

    if (entry.sha256.toLowerCase() !== actualHash) {
      input.errors.push({
        severity: "error",
        code: "manifest_hash_mismatch",
        message: `SHA-256 mismatch for ${path}.`,
        file: "manifest.json",
        path,
      });
    }
  }

  for (const requiredPath of REQUIRED_PATHS) {
    if (requiredPath === "manifest.json") {
      continue;
    }

    if (!listedPaths.has(requiredPath)) {
      input.errors.push({
        severity: "error",
        code: "required_file_not_listed",
        message: `manifest.json must list required file ${requiredPath}.`,
        file: "manifest.json",
        path: requiredPath,
      });
    }
  }

  for (const path of input.fileMap.keys()) {
    if (path !== "manifest.json" && !listedPaths.has(path)) {
      input.warnings.push({
        severity: "warning",
        code: "file_not_listed",
        message: `${path} is present but not listed in manifest.json.`,
        file: path,
      });
    }
  }
}

function validateCadenceTimeSessions(input: {
  manifest: JsonRecord | null;
  fileMap: Map<string, BehaviorLogImportFile>;
  errors: BehaviorLogImportIssue[];
  warnings: BehaviorLogImportIssue[];
}): void {
  const cadence = isRecord(input.manifest?.extensions)
    ? input.manifest.extensions[BEHAVIORLOG_EXTENSION_NAMESPACE]
    : null;
  const declaration = isRecord(cadence)
    ? cadence.occurrence_time_sessions
    : null;
  const file = input.fileMap.get(CADENCE_TIME_SESSIONS_PATH);
  const isManifestListed = Array.isArray(input.manifest?.files)
    ? input.manifest.files.some(
        (entry) =>
          isRecord(entry) && entry.path === CADENCE_TIME_SESSIONS_PATH,
      )
    : false;

  if (!declaration && !file) {
    return;
  }

  if (file && !isManifestListed) {
    input.errors.push({
      severity: "error",
      code: "cadence_time_sessions_not_listed",
      message:
        "Cadence time-session export files must be listed in manifest.json so their SHA-256 hash is verified.",
      file: "manifest.json",
      path: CADENCE_TIME_SESSIONS_PATH,
    });
  }

  if (!isRecord(declaration)) {
    input.errors.push({
      severity: "error",
      code: "cadence_time_sessions_extension_invalid",
      message:
        "Cadence time-session exports must declare occurrence_time_sessions in manifest.extensions.app.cadence.",
      file: "manifest.json",
    });
    return;
  }

  if (declaration.path !== CADENCE_TIME_SESSIONS_PATH || !file) {
    input.errors.push({
      severity: "error",
      code: "cadence_time_sessions_file_invalid",
      message:
        "Cadence time-session export metadata must reference raw/cadence/occurrence_time_sessions.jsonl.",
      file: "manifest.json",
      path: CADENCE_TIME_SESSIONS_PATH,
    });
    return;
  }

  const rows = parseCadenceTimeSessionRows(file, input.errors);

  const recordCount = declaration.record_count;

  if (
    typeof recordCount !== "number" ||
    !Number.isInteger(recordCount) ||
    recordCount < 0 ||
    recordCount !== rows.length
  ) {
    input.errors.push({
      severity: "error",
      code: "cadence_time_sessions_count_invalid",
      message:
        "Cadence time-session export metadata must match the optional file record count.",
      file: "manifest.json",
      path: CADENCE_TIME_SESSIONS_PATH,
    });
  }

  if (declaration.import_restore_support !== "export_only") {
    input.errors.push({
      severity: "error",
      code: "cadence_time_sessions_support_invalid",
      message:
        "Cadence time-session exports must declare export_only import and restore support.",
      file: "manifest.json",
      path: CADENCE_TIME_SESSIONS_PATH,
    });
  }

  if (
    !Array.isArray(declaration.ordering) ||
    declaration.ordering.length !== 2 ||
    declaration.ordering[0] !== "started_at" ||
    declaration.ordering[1] !== "session_id"
  ) {
    input.errors.push({
      severity: "error",
      code: "cadence_time_sessions_ordering_invalid",
      message:
        "Cadence time-session export metadata must declare started_at and session_id ordering.",
      file: "manifest.json",
      path: CADENCE_TIME_SESSIONS_PATH,
    });
  }

  input.warnings.push({
    severity: "warning",
    code: "cadence_time_sessions_export_only",
    message:
      "Cadence validated the optional time-session export file, but import and restore do not replay timing sessions.",
    file: CADENCE_TIME_SESSIONS_PATH,
  });
}

function parseCadenceTimeSessionRows(
  file: BehaviorLogImportFile,
  errors: BehaviorLogImportIssue[],
): JsonRecord[] {
  const rows: JsonRecord[] = [];

  for (const [index, line] of file.content.split(/\r?\n/).entries()) {
    if (line.trim().length === 0) {
      continue;
    }

    try {
      const record = JSON.parse(line);

      if (!isRecord(record) || record.record_type !== "occurrence_time_session") {
        throw new Error("must be an occurrence_time_session record");
      }
      if (
        typeof record.session_id !== "string" ||
        typeof record.occurrence_id !== "string" ||
        typeof record.behavior_id !== "string" ||
        typeof record.started_at !== "string"
      ) {
        throw new Error("requires session_id, occurrence_id, behavior_id, and started_at strings");
      }
      const startedAt = Temporal.Instant.from(record.started_at);
      const stoppedAt =
        record.stopped_at === null
          ? null
          : typeof record.stopped_at === "string"
            ? Temporal.Instant.from(record.stopped_at)
            : null;

      if (record.stopped_at !== null && stoppedAt === null) {
        throw new Error("stopped_at must be an ISO instant or null");
      }
      if (
        stoppedAt &&
        Temporal.Instant.compare(stoppedAt, startedAt) < 0
      ) {
        throw new Error("stopped_at cannot be before started_at");
      }
      if (
        (stoppedAt === null && record.duration_seconds !== null) ||
        (stoppedAt !== null &&
          (typeof record.duration_seconds !== "number" ||
            record.duration_seconds < 0))
      ) {
        throw new Error("duration_seconds must be null for running sessions and nonnegative for stopped sessions");
      }
      rows.push(record);
    } catch (error) {
      errors.push({
        severity: "error",
        code: "cadence_time_session_invalid",
        message: `${CADENCE_TIME_SESSIONS_PATH} row ${index + 1} ${errorMessage(error)}.`,
        file: CADENCE_TIME_SESSIONS_PATH,
        row: index + 1,
      });
    }
  }

  return rows;
}

function parseJsonFile(
  path: string,
  fileMap: Map<string, BehaviorLogImportFile>,
  errors: BehaviorLogImportIssue[],
): JsonRecord | null {
  const file = fileMap.get(path);

  if (!file) {
    return null;
  }

  try {
    const parsed = JSON.parse(file.content);

    if (!isRecord(parsed)) {
      errors.push({
        severity: "error",
        code: "json_object_expected",
        message: `${path} must contain one JSON object.`,
        file: path,
      });
      return null;
    }

    return parsed;
  } catch (error) {
    errors.push({
      severity: "error",
      code: "json_parse_error",
      message: `${path} could not be parsed: ${errorMessage(error)}.`,
      file: path,
    });
    return null;
  }
}

function readManifestSchemaVersion(manifest: JsonRecord | null): string | null {
  return typeof manifest?.schema_version === "string"
    ? manifest.schema_version
    : null;
}

function parseJsonlFile(input: {
  file: string;
  expectedRecordType: string;
  allowedFields: Set<string>;
  fileMap: Map<string, BehaviorLogImportFile>;
  errors: BehaviorLogImportIssue[];
  unsupportedFields: BehaviorLogUnsupportedField[];
}): ParsedJsonlRecord[] {
  const file = input.fileMap.get(input.file);

  if (!file) {
    return [];
  }

  return file.content.split(/\r?\n/).flatMap((line, index) => {
    const row = index + 1;

    if (line.trim().length === 0) {
      return [];
    }

    try {
      const parsed = JSON.parse(line);

      if (!isRecord(parsed)) {
        input.errors.push({
          severity: "error",
          code: "jsonl_record_invalid",
          message: `${input.file} row ${row} must be a JSON object.`,
          file: input.file,
          row,
        });
        return [];
      }

      if (parsed.record_type !== input.expectedRecordType) {
        input.errors.push({
          severity: "error",
          code: "record_type_invalid",
          message: `${input.file} row ${row} must have record_type '${input.expectedRecordType}'.`,
          file: input.file,
          row,
        });
        return [];
      }

      const extraFields = Object.keys(parsed).filter(
        (field) => !input.allowedFields.has(field),
      );

      if (extraFields.length > 0) {
        input.unsupportedFields.push({
          file: input.file,
          row,
          recordType: input.expectedRecordType,
          recordId: recordIdForUnsupportedField(parsed),
          fields: extraFields,
        });
        input.errors.push({
          severity: "error",
          code: "unsupported_top_level_field",
          message: `${input.file} row ${row} includes unsupported top-level field(s): ${extraFields.join(
            ", ",
          )}. Put custom fields under extensions.`,
          file: input.file,
          row,
        });
      }

      return [{ file: input.file, row, record: parsed }];
    } catch (error) {
      input.errors.push({
        severity: "error",
        code: "jsonl_parse_error",
        message: `${input.file} row ${row} could not be parsed: ${errorMessage(
          error,
        )}.`,
        file: input.file,
        row,
      });
      return [];
    }
  });
}

function toBehaviorPlan(
  row: ParsedJsonlRecord,
  errors: BehaviorLogImportIssue[],
  warnings: BehaviorLogImportIssue[],
): BehaviorLogImportBehaviorPlan | null {
  const id = readRequiredString(row, "behavior_id", errors);
  const title = readRequiredString(row, "title", errors);
  const category = readRequiredString(row, "category", errors);
  const createdAtUtc = readOptionalInstant(row, "created_at_utc", errors);
  const archivedAtUtc = readOptionalInstant(row, "archived_at_utc", errors);
  const source = readSource(row, errors, false);
  const cadence = readCadenceExtension(row.record);
  const cadenceActive = readExtensionBoolean(cadence, "active");
  const cadenceArchiveNotes = readArchiveNotes(cadence, row, errors);
  const expectedDurationMinutes = readOptionalInteger(
    row,
    "expected_duration_minutes",
    errors,
  );
  const cadenceRun = readExtensionRun(cadence, row, errors);
  const cadenceIsOpportunity = readExtensionBoolean(cadence, "is_opportunity");
  const cadenceAutoArchivedAt = readExtensionInstant(
    cadence,
    "auto_archived_at",
    row,
    errors,
  );
  const subBehaviorLink = readExtensionSubBehaviorLink(cadence, row, errors);

  if (
    expectedDurationMinutes !== null &&
    (expectedDurationMinutes < 1 || expectedDurationMinutes > 1_440)
  ) {
    errors.push({
      severity: "error",
      code: "behavior_expected_duration_invalid",
      message: `${row.file} row ${row.row}: expected_duration_minutes must be 1 through 1,440 or null.`,
      file: row.file,
      row: row.row,
      path: "expected_duration_minutes",
    });
  }
  if (cadenceAutoArchivedAt && !archivedAtUtc) {
    errors.push({
      severity: "error",
      code: "cadence_auto_archived_at_without_archive",
      message: `${row.file} row ${row.row}: auto_archived_at requires archived_at_utc.`,
      file: row.file,
      row: row.row,
      path: "extensions.app.cadence.auto_archived_at",
    });
  }

  if (!id || !title || !category) {
    return null;
  }

  if (archivedAtUtc === null && cadenceActive === false) {
    warnings.push({
      severity: "warning",
      code: "behavior_active_extension_ignored",
      message: `Behavior ${id} declares active false without archived_at_utc; Cadence treats it as active.`,
      file: row.file,
      row: row.row,
    });
  }

  return {
    action: "create",
    skipReasons: [],
    externalId: id,
    title,
    category,
    cadenceCategoryName: readExtensionString(cadence, "category_name"),
    description: readOptionalString(row, "description", errors),
    createdAtUtc,
    archivedAtUtc,
    ...(cadenceArchiveNotes === undefined ? {} : { cadenceArchiveNotes }),
    ...(Object.hasOwn(row.record, "expected_duration_minutes")
      ? { expectedDurationMinutes }
      : {}),
    ...(cadenceRun === undefined ? {} : { cadenceRun }),
    ...(cadenceAutoArchivedAt === undefined ? {} : { cadenceAutoArchivedAt }),
    ...(cadenceIsOpportunity === null ? {} : { cadenceIsOpportunity }),
    ...(subBehaviorLink ?? {}),
    active: archivedAtUtc === null,
    cadenceActive,
    cadenceBrowserReminderEnabled: readExtensionBoolean(
      cadence,
      "browser_reminder_enabled",
    ),
    cadenceEmailReminderEnabled: readExtensionBoolean(
      cadence,
      "email_reminder_enabled",
    ),
    cadenceReminderOffsetMinutes: readExtensionInteger(
      cadence,
      "reminder_offset_minutes",
    ),
    sourceOriginalId: source.originalId,
    sourceConfidence: source.confidence,
  };
}

function toSchedulePlan(
  row: ParsedJsonlRecord,
  errors: BehaviorLogImportIssue[],
): BehaviorLogImportSchedulePlan | null {
  const id = readRequiredString(row, "schedule_id", errors);
  const behaviorId = readRequiredString(row, "behavior_id", errors);
  const recurrenceProfile = readRequiredString(
    row,
    "recurrence_profile",
    errors,
  );
  const recurrence = readRequiredObject(row, "recurrence", errors);
  const timezone = readRequiredTimezone(row, "timezone", errors);
  const activeFromLocalDate = readRequiredLocalDate(
    row,
    "active_from_local_date",
    errors,
  );
  const source = readSource(row, errors, false);
  const cadence = readCadenceExtension(row.record);
  const localTime = readOptionalLocalTime(row, "local_time", errors);
  const windowStartLocal = readOptionalLocalTime(
    row,
    "window_start_local",
    errors,
  );
  const windowEndLocal = readOptionalLocalTime(row, "window_end_local", errors);

  if (
    !id ||
    !behaviorId ||
    !recurrenceProfile ||
    !recurrence ||
    !timezone ||
    !activeFromLocalDate
  ) {
    return null;
  }

  return {
    action: "create",
    skipReasons: [],
    externalId: id,
    behaviorExternalId: behaviorId,
    recurrenceProfile,
    recurrence: recurrenceProfile === "behaviorlog.calendar_simple.v1" ? {
      ...recurrence,
      interval: recurrence.interval ?? 1,
      ...(recurrence.type === "weekly_on_weekdays" && Number(recurrence.interval) > 1 ? {type: "every_n_weeks_on_weekdays"} : {}),
    } : recurrence,
    timezone,
    localTime,
    windowStartLocal,
    windowEndLocal,
    cadenceScheduleKind:
      windowStartLocal && windowEndLocal
        ? "range"
        : localTime
          ? "exact"
          : readExtensionScheduleKind(cadence, "schedule_kind"),
    cadenceSchedulePreset:
      windowStartLocal && windowEndLocal
        ? cadencePresetForRange(windowStartLocal, windowEndLocal)
        : readExtensionSchedulePreset(cadence, "schedule_preset"),
    cadenceBehaviorScheduleId: readOptionalString(row, "schedule_group_id", errors) ?? readExtensionString(
      cadence,
      "behavior_schedule_id",
    ),
    cadenceConfigurationEventId: readExtensionString(
      cadence,
      "behavior_configuration_event_id",
    ),
    cadenceImportRole: row.record.schedule_role === "historical_reference" ? "historical_reference_only"
      : row.record.schedule_role === "generating" ? "current_configuration" : readCadenceScheduleImportRole(cadence),
    cadenceHistoricalRecurrence:
      readExtensionString(cadence, "historical_recurrence") === "unknown"
        ? "unknown"
        : null,
    activeFromLocalDate,
    anchorLocalDate: readOptionalLocalDate(row, "anchor_local_date", errors),
    effectiveFromUtc: readOptionalInstant(row, "effective_from_utc", errors),
    effectiveUntilUtc: readOptionalInstant(row, "effective_until_utc", errors),
    activeUntilLocalDate: readOptionalLocalDate(
      row,
      "active_until_local_date",
      errors,
    ),
    sourceOriginalId: source.originalId,
    sourceConfidence: source.confidence,
  };
}

function toDefinitionEventPlan(
  row: ParsedJsonlRecord,
  errors: BehaviorLogImportIssue[],
  warnings: BehaviorLogImportIssue[],
): BehaviorLogImportDefinitionEventPlan | null {
  const externalId = readRequiredString(row, "event_id", errors);
  const behaviorExternalId = readRequiredString(row, "behavior_id", errors);
  const eventKindValue = readRequiredString(row, "event_kind", errors);
  const recordedAtUtc = readRequiredInstant(row, "recorded_at_utc", errors);
  const changedFieldsValue = row.record.changed_fields;
  const previousValue = row.record.previous;
  const nextValue = row.record.next;
  const source = readSource(row, errors, true);

  if (
    !externalId ||
    !behaviorExternalId ||
    !recordedAtUtc ||
    (eventKindValue !== "baseline" && eventKindValue !== "revision")
  ) {
    if (eventKindValue && eventKindValue !== "baseline" && eventKindValue !== "revision") {
      errors.push({
        severity: "error",
        code: "definition_event_kind_invalid",
        message: `${row.file} row ${row.row} has unsupported event_kind ${eventKindValue}.`,
        file: row.file,
        row: row.row,
      });
    }
    return null;
  }

  if (
    !Array.isArray(changedFieldsValue) ||
    changedFieldsValue.length === 0 ||
    changedFieldsValue.some((field) => typeof field !== "string")
  ) {
    errors.push({
      severity: "error",
      code: "definition_changed_fields_invalid",
      message: `${row.file} row ${row.row} requires a non-empty changed_fields string array.`,
      file: row.file,
      row: row.row,
    });
    return null;
  }

  if (!isRecord(nextValue) || (previousValue !== null && !isRecord(previousValue))) {
    errors.push({
      severity: "error",
      code: "definition_snapshot_invalid",
      message: `${row.file} row ${row.row} requires next object and previous object or null.`,
      file: row.file,
      row: row.row,
    });
    return null;
  }

  const changedFields = changedFieldsValue.filter(
    (field): field is "title" | "description" =>
      field === "title" || field === "description",
  );
  const unsupportedChangedFields = changedFieldsValue.filter(
    (field) => field !== "title" && field !== "description",
  );
  const previous = isRecord(previousValue) ? previousValue : null;
  const nextTitle = readNullableDefinitionField(nextValue, "title", row, errors);
  const plan: BehaviorLogImportDefinitionEventPlan = {
    action: "create",
    skipReasons: [],
    externalId,
    behaviorExternalId,
    eventKind: eventKindValue,
    changedFields,
    unsupportedChangedFields,
    previousTitle: previous
      ? readNullableDefinitionField(previous, "title", row, errors)
      : null,
    nextTitle,
    previousDescription: previous
      ? readNullableDefinitionField(previous, "description", row, errors)
      : null,
    nextDescription: readNullableDefinitionField(
      nextValue,
      "description",
      row,
      errors,
    ),
    recordedAtUtc,
    reasonCode: readOptionalString(row, "reason_code", errors),
    sourceCaptureMethod: source.captureMethod,
    sourceConfidence: source.confidence,
  };

  if (
    unsupportedChangedFields.length > 0 ||
    nextTitle === null ||
    (eventKindValue === "baseline" && previous !== null) ||
    (eventKindValue === "revision" && previous === null)
  ) {
    skip(plan, "definition_event_unmappable");
    warnings.push({
      severity: "warning",
      code: "definition_event_unmappable",
      message: `Definition event ${externalId} cannot be represented as Cadence title/description history and will be skipped.`,
      file: row.file,
      row: row.row,
    });
  }

  return plan;
}

function toTimeSessionPlan(
  row: ParsedJsonlRecord,
  errors: BehaviorLogImportIssue[],
): BehaviorLogImportTimeSessionPlan | null {
  const externalId = readRequiredString(row, "session_id", errors);
  const occurrenceExternalId = readRequiredString(row, "occurrence_id", errors);
  const behaviorExternalId = readRequiredString(row, "behavior_id", errors);
  const startedAtUtc = readRequiredInstant(row, "started_at_utc", errors);
  const stoppedAtUtc = readOptionalInstant(row, "stopped_at_utc", errors);
  const source = readSource(row, errors, false);

  if (!externalId || !occurrenceExternalId || !behaviorExternalId || !startedAtUtc) {
    return null;
  }

  if (
    stoppedAtUtc &&
    Temporal.Instant.compare(
      Temporal.Instant.from(stoppedAtUtc),
      Temporal.Instant.from(startedAtUtc),
    ) < 0
  ) {
    errors.push({
      severity: "error",
      code: "time_session_stop_before_start",
      message: `Time session ${externalId} stops before it starts.`,
      file: row.file,
      row: row.row,
    });
  }

  return {
    action: "create",
    skipReasons: [],
    externalId,
    occurrenceExternalId,
    behaviorExternalId,
    startedAtUtc,
    stoppedAtUtc,
    sourceOriginalId: source.originalId,
    sourceCaptureMethod: source.captureMethod,
    sourceConfidence: source.confidence,
  };
}

function toInterventionRulePlan(
  row: ParsedJsonlRecord,
  errors: BehaviorLogImportIssue[],
  warnings: BehaviorLogImportIssue[],
  reminderChannel: "browser_push" | "other" = "browser_push",
  convertNativeRemindersToBrowser = false,
): BehaviorLogImportInterventionRulePlan | null {
  const externalId = readRequiredString(row, "rule_id", errors);
  const interventionType = readRequiredString(
    row,
    "intervention_type",
    errors,
  );
  const sourceChannel = readRequiredString(row, "channel", errors);
  // The desktop adapter uses the existing browser reminder setting for native
  // intent. Never infer this mapping for another producer's generic `other`.
  const channel = (reminderChannel === "other" || convertNativeRemindersToBrowser) && sourceChannel === "other" && readCadenceExtension(row.record)?.native_notification === true
    ? "browser_push" : sourceChannel;
  if (channel !== sourceChannel && reminderChannel === "browser_push") {
    warnings.push({
      severity: "warning",
      code: "native_reminder_converted_to_browser",
      message: `Native reminder ${externalId} will become a browser reminder. Browser notification permission is still required. Configuration history stays unchanged.`,
      file: row.file,
      row: row.row,
    });
  }
  const behaviorExternalId = readOptionalString(row, "behavior_id", errors);
  const enabled = readRequiredBoolean(row, "enabled", errors);
  const offsetMinutes = readOptionalInteger(row, "offset_minutes", errors);
  const activeFromLocalDate = readOptionalLocalDate(
    row,
    "active_from_local_date",
    errors,
  );
  const activeUntilLocalDate = readOptionalLocalDate(
    row,
    "active_until_local_date",
    errors,
  );
  const timezone = readOptionalTimezone(row, "timezone", errors);
  const source = readSource(row, errors, false);

  if (!externalId || !interventionType || !channel || enabled === null) {
    return null;
  }

  const plan: BehaviorLogImportInterventionRulePlan = {
    action: "create",
    skipReasons: [],
    externalId,
    behaviorExternalId,
    interventionType,
    channel,
    enabled,
    offsetMinutes,
    activeFromLocalDate,
    activeUntilLocalDate,
    timezone,
    sourceOriginalId: source.originalId,
    sourceCaptureMethod: source.captureMethod,
    sourceConfidence: source.confidence,
  };

  if (offsetMinutes !== null && offsetMinutes > 0) {
    skip(plan, "positive_offset_after_occurrence");
    warnings.push({
      severity: "warning",
      code: "intervention_rule_positive_offset_unmappable",
      message: `Intervention rule ${externalId} uses positive offset_minutes ${offsetMinutes}, which schedules after the occurrence and cannot map to Cadence lead minutes; it will be skipped.`,
      file: row.file,
      row: row.row,
    });
  } else if (
    interventionType !== "reminder" ||
    (channel !== "browser_push" && channel !== "email") ||
    behaviorExternalId === null
  ) {
    skip(plan, "intervention_rule_unmappable");
    warnings.push({
      severity: "warning",
      code: "intervention_rule_unmappable",
      message: `Intervention rule ${externalId} cannot map to a Cadence behavior reminder and will be skipped.`,
      file: row.file,
      row: row.row,
    });
  }

  return plan;
}

function readNullableDefinitionField(
  snapshot: JsonRecord,
  field: string,
  row: ParsedJsonlRecord,
  errors: BehaviorLogImportIssue[],
): string | null {
  const value = snapshot[field];

  if (value === null || value === undefined || typeof value === "string") {
    return value ?? null;
  }

  errors.push({
    severity: "error",
    code: "definition_snapshot_field_invalid",
    message: `${row.file} row ${row.row} definition ${field} must be a string or null.`,
    file: row.file,
    row: row.row,
  });
  return null;
}

function toOccurrencePlan(
  row: ParsedJsonlRecord,
  errors: BehaviorLogImportIssue[],
): BehaviorLogImportOccurrencePlan | null {
  const id = readRequiredString(row, "occurrence_id", errors);
  const behaviorId = readRequiredString(row, "behavior_id", errors);
  const scheduleId = readRequiredString(row, "schedule_id", errors);
  const scheduledForUtc = readRequiredInstant(row, "scheduled_for_utc", errors);
  const localDate = readRequiredLocalDate(row, "local_date", errors);
  const timezone = readRequiredTimezone(row, "timezone", errors);
  const currentStatus = readRequiredStatus(row, "current_status", errors);
  const generatedAtUtc = readOptionalInstant(row, "generated_at_utc", errors);
  const source = readSource(row, errors, false);
  const cadenceProvenance = readExtensionOccurrenceOrigin(readCadenceExtension(row.record), row, errors);

  if (scheduledForUtc && localDate && timezone) {
    const derivedLocalDate = Temporal.Instant.from(scheduledForUtc)
      .toZonedDateTimeISO(timezone)
      .toPlainDate()
      .toString();

    if (derivedLocalDate !== localDate) {
      errors.push({
        severity: "error",
        code: "occurrence_local_date_mismatch",
        message: `Occurrence ${id ?? `at row ${row.row}`} declares local_date ${localDate}, but scheduled_for_utc resolves to ${derivedLocalDate} in ${timezone}.`,
        file: row.file,
        row: row.row,
      });
    }
  }

  if (
    !id ||
    !behaviorId ||
    !scheduleId ||
    !scheduledForUtc ||
    !localDate ||
    !timezone ||
    !currentStatus
  ) {
    return null;
  }

  return {
    action: "create",
    skipReasons: [],
    importWithDetachedScheduleSnapshot: false,
    externalId: id,
    behaviorExternalId: behaviorId,
    scheduleExternalId: scheduleId,
    scheduledForUtc,
    localDate,
    timezone,
    localTime: readOptionalLocalTime(row, "local_time", errors),
    generatedAtUtc,
    currentStatus,
    ...cadenceProvenance,
    sourceOriginalId: source.originalId,
    sourceConfidence: source.confidence,
  };
}

/**
 * Behaviors of Opportunity: `origin` and `added_by` under `extensions.app.cadence`. An
 * added Occurrence names who added it; a scheduled one names nobody. Returns nothing when
 * the bundle carries no origin, so restore keeps the stored value.
 */
function readExtensionOccurrenceOrigin(
  extension: JsonRecord | null,
  row: ParsedJsonlRecord,
  errors: BehaviorLogImportIssue[],
): Pick<BehaviorLogImportOccurrencePlan, "cadenceOrigin" | "cadenceAddedBy"> {
  if (!extension || !Object.hasOwn(extension, "origin")) return {};
  const origin = extension.origin;
  const addedBy = extension.added_by ?? null;
  if (origin === "scheduled" && addedBy === null) return { cadenceOrigin: "scheduled", cadenceAddedBy: null };
  if (origin === "opportunity" && (addedBy === "user" || addedBy === "daily_brief" || addedBy === "chat" || addedBy === "mcp")) {
    return { cadenceOrigin: "opportunity", cadenceAddedBy: addedBy };
  }
  errors.push({ severity: "error", code: "cadence_occurrence_origin_invalid",
    message: `${row.file} row ${row.row}: extensions.app.cadence origin and added_by do not match.`,
    file: row.file, row: row.row, path: "extensions.app.cadence.origin" });
  return {};
}

function toStatusEventPlan(
  row: ParsedJsonlRecord,
  errors: BehaviorLogImportIssue[],
): BehaviorLogImportStatusEventPlan | null {
  const id = readRequiredString(row, "event_id", errors);
  const occurrenceId = readRequiredString(row, "occurrence_id", errors);
  const behaviorId = readRequiredString(row, "behavior_id", errors);
  const status = readRequiredStatus(row, "status", errors);
  const statusSemantics = readRequiredStatusSemantics(
    row,
    "status_semantics",
    errors,
  );
  const recordedAtUtc = readRequiredInstant(row, "recorded_at_utc", errors);
  const localDate = readRequiredLocalDate(row, "local_date", errors);
  const timezone = readRequiredTimezone(row, "timezone", errors);
  const source = readSource(row, errors, true);

  if (
    !id ||
    !occurrenceId ||
    !behaviorId ||
    !status ||
    !statusSemantics ||
    !recordedAtUtc ||
    !localDate ||
    !timezone
  ) {
    return null;
  }

  return {
    action: "create",
    skipReasons: [],
    externalId: id,
    occurrenceExternalId: occurrenceId,
    behaviorExternalId: behaviorId,
    previousStatus: readOptionalStatus(row, "previous_status", errors),
    status,
    statusSemantics,
    recordedAtUtc,
    effectiveAtUtc: readOptionalInstant(row, "effective_at_utc", errors),
    localDate,
    timezone,
    sourceCaptureMethod: source.captureMethod,
    sourceConfidence: source.confidence,
    revisesEventId: readOptionalString(row, "revises_event_id", errors),
    reasonCode: readOptionalString(row, "reason_code", errors),
    sourceOriginalId: source.originalId,
  };
}

function toNotePlan(
  row: ParsedJsonlRecord,
  errors: BehaviorLogImportIssue[],
): BehaviorLogImportNotePlan | null {
  const id = readRequiredString(row, "note_id", errors);
  const attachedToType = readRequiredAttachedToType(
    row,
    "attached_to_type",
    errors,
  );
  const attachedToId = readRequiredString(row, "attached_to_id", errors);
  const bodyMarkdown = readRequiredString(row, "body_markdown", errors);
  const noteRole = readRequiredNoteRole(row, "note_role", errors);
  const createdAtUtc = readRequiredInstant(row, "created_at_utc", errors);
  const sensitivity = readOptionalNoteSensitivity(row, "sensitivity", errors);
  const source = readSource(row, errors, false);

  if (
    !id ||
    !attachedToType ||
    !attachedToId ||
    !bodyMarkdown ||
    !noteRole ||
    !createdAtUtc
  ) {
    return null;
  }

  return {
    action: "create",
    skipReasons: [],
    externalId: id,
    attachedToType,
    attachedToId,
    bodyMarkdown,
    noteRole,
    createdAtUtc,
    updatedAtUtc: readOptionalInstant(row, "updated_at_utc", errors),
    sensitivity,
    sourceOriginalId: source.originalId,
    sourceCaptureMethod: source.captureMethod,
    sourceConfidence: source.confidence,
  };
}

function toInterventionPlan(
  row: ParsedJsonlRecord,
  schemaVersion: string | null,
  errors: BehaviorLogImportIssue[],
  warnings: BehaviorLogImportIssue[],
): BehaviorLogImportInterventionPreviewPlan | null {
  const id = readRequiredString(row, "intervention_id", errors);
  const behaviorId = readRequiredString(row, "behavior_id", errors);
  const occurrenceId = readRequiredString(row, "occurrence_id", errors);
  const channel = readRequiredInterventionChannel(row, "channel", schemaVersion, errors);
  const plannedForField =
    schemaVersion !== "0.1.0-draft"
      ? "planned_for_utc"
      : "scheduled_send_at_utc";
  const scheduledSendAtUtc = readRequiredInstant(row, plannedForField, errors);
  const deliveryStatus = readRequiredInterventionDeliveryStatus(
    row,
    "delivery_status",
    schemaVersion,
    errors,
  );
  const source = readSource(row, errors, false);
  const sensitivePaths = collectSensitiveInterventionPaths(row.record);
  const failureReason = readOptionalString(row, "failure_reason", errors);
  const redactedFields = interventionRedactedFields({
    failureReason,
    sourceOriginalId: source.originalId,
    sensitivePaths,
  });

  warnAboutSensitiveInterventionPayload(row, warnings, sensitivePaths);
  if (row.record.extensions && typeof row.record.extensions === "object" && Object.keys(row.record.extensions).length) {
    warnings.push({ severity: "warning", code: "portability_loss", file: row.file, row: row.row,
      message: `${row.file} row ${row.row}: Passive intervention extensions are not preserved. Channel, observation status, and source attribution remain passive history; keep the original bundle for native OS metadata.` });
  }

  if (
    !id ||
    !behaviorId ||
    !occurrenceId ||
    !channel ||
    !scheduledSendAtUtc ||
    !deliveryStatus
  ) {
    return null;
  }

  return {
    action: "preview_only",
    previewOnly: true,
    externalId: id,
    behaviorExternalId: behaviorId,
    occurrenceExternalId: occurrenceId,
    interventionType: readOptionalString(row, "intervention_type", errors),
    channel,
    deliveryStatus,
    scheduledSendAtUtc,
    sentAtUtc: readOptionalInstant(row, "sent_at_utc", errors),
    failureReason: sanitizeInterventionFailureReason(
      failureReason,
      sensitivePaths,
    ),
    sourceOriginalId: sanitizeInterventionSourceOriginalId(
      source.originalId,
      sensitivePaths,
    ),
    sourceCaptureMethod: source.captureMethod,
    sourceConfidence: source.confidence,
    storageDecision: {
      decision: "store_passive_history",
      storedFields: interventionStoredFields(redactedFields, plannedForField),
      droppedSensitiveFields: sensitivePaths.filter(
        (path) => !redactedFields.includes(path),
      ),
      redactedFields,
      rawMessageBodyStored: false,
      rawEndpointStored: false,
      recipientIdentifiersStored: false,
      reminderDeliverySideEffects: false,
      providerSideEffects: false,
    },
  };
}

function warnAboutSensitiveInterventionPayload(
  row: ParsedJsonlRecord,
  warnings: BehaviorLogImportIssue[],
  paths: string[],
): void {
  if (paths.length === 0) {
    return;
  }

  const interventionId =
    typeof row.record.intervention_id === "string"
      ? row.record.intervention_id
      : `row ${row.row}`;

  warnings.push({
    severity: "warning",
    code: "intervention_sensitive_payload_present",
    message: `Intervention ${interventionId} contains sensitive delivery payload field(s): ${paths.join(
      ", ",
    )}. These values will be dropped or redacted before passive intervention history storage and must not be imported into reminders.`,
    file: row.file,
    row: row.row,
  });
}

function interventionRedactedFields(input: {
  failureReason: string | null;
  sourceOriginalId: string | null;
  sensitivePaths: string[];
}): string[] {
  const redactedFields: string[] = [];

  if (
    input.failureReason &&
    (input.sensitivePaths.includes("failure_reason") ||
      looksLikeSensitiveDeliveryValue(input.failureReason))
  ) {
    redactedFields.push("failure_reason");
  }

  if (
    input.sourceOriginalId &&
    (input.sensitivePaths.includes("source.original_id") ||
      looksLikeSensitiveDeliveryValue(input.sourceOriginalId))
  ) {
    redactedFields.push("source.original_id");
  }

  return redactedFields;
}

function sanitizeInterventionFailureReason(
  value: string | null,
  sensitivePaths: string[],
): string | null {
  if (!value) {
    return null;
  }

  if (
    sensitivePaths.includes("failure_reason") ||
    looksLikeSensitiveDeliveryValue(value)
  ) {
    return "Redacted sensitive delivery detail.";
  }

  return value;
}

function sanitizeInterventionSourceOriginalId(
  value: string | null,
  sensitivePaths: string[],
): string | null {
  if (!value) {
    return null;
  }

  if (
    sensitivePaths.includes("source.original_id") ||
    looksLikeSensitiveDeliveryValue(value)
  ) {
    return null;
  }

  return value;
}

function interventionStoredFields(
  redactedFields: string[],
  plannedForField: string,
): string[] {
  const fields = [
    "intervention_id",
    "behavior_id",
    "occurrence_id",
    "intervention_type",
    "channel",
    "delivery_status",
    plannedForField,
    "sent_at_utc",
    "failure_reason",
    "source.original_id",
    "source.capture_method",
    "source.confidence",
  ];

  return fields.map((field) =>
    redactedFields.includes(field) ? `${field} (redacted)` : field,
  );
}

function collectSensitiveInterventionPaths(
  value: unknown,
  path = "",
): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      collectSensitiveInterventionPaths(entry, `${path}[${index}]`),
    );
  }

  if (!isRecord(value)) {
    if (typeof value === "string" && looksLikeSensitiveDeliveryValue(value)) {
      return [path || "value"];
    }

    return [];
  }

  const paths: string[] = [];

  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;

    if (isSensitiveInterventionFieldName(key)) {
      paths.push(childPath);
    }

    paths.push(...collectSensitiveInterventionPaths(child, childPath));
  }

  return [...new Set(paths)].sort();
}

function isSensitiveInterventionFieldName(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");

  return (
    normalized === "messagebody" ||
    normalized === "emailbody" ||
    normalized === "pushpayload" ||
    normalized === "payload" ||
    normalized === "body" ||
    normalized.includes("endpoint") ||
    normalized.includes("subscription") ||
    normalized === "p256dh" ||
    normalized === "auth" ||
    normalized.includes("apikey") ||
    normalized.includes("secret") ||
    normalized.includes("token") ||
    normalized.includes("authorization") ||
    normalized.includes("credential") ||
    (normalized.includes("provider") &&
      (normalized.includes("id") ||
        normalized.includes("identifier") ||
        normalized.includes("message") ||
        normalized.includes("delivery") ||
        normalized.includes("secret") ||
        normalized.includes("token"))) ||
    normalized.includes("recipient") ||
    normalized === "email" ||
    normalized.includes("emailaddress") ||
    normalized === "phone" ||
    normalized === "address" ||
    normalized === "to"
  );
}

function looksLikeSensitiveDeliveryValue(value: string): boolean {
  return (
    /https?:\/\/\S+/i.test(value) ||
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(value) ||
    /\b(p256dh|auth|token|secret|api[_-]?key|authorization)\s*[:=]/i.test(
      value,
    )
  );
}

function validateCrossReferences(input: {
  plan: BehaviorLogImportPlan;
  errors: BehaviorLogImportIssue[];
  warnings: BehaviorLogImportIssue[];
}): void {
  const behaviorIds = new Set(
    input.plan.behaviors.map((behavior) => behavior.externalId),
  );
  const scheduleIds = new Set(
    input.plan.schedules.map((schedule) => schedule.externalId),
  );
  const scheduleBehaviorById = new Map(
    input.plan.schedules.map((schedule) => [
      schedule.externalId,
      schedule.behaviorExternalId,
    ]),
  );
  const occurrenceIds = new Set(
    input.plan.occurrences.map((occurrence) => occurrence.externalId),
  );
  const occurrenceBehaviorById = new Map(
    input.plan.occurrences.map((occurrence) => [
      occurrence.externalId,
      occurrence.behaviorExternalId,
    ]),
  );
  const statusEventIds = new Set(
    input.plan.statusEvents.map((event) => event.externalId),
  );

  for (const schedule of input.plan.schedules) {
    if (!behaviorIds.has(schedule.behaviorExternalId)) {
      input.errors.push({
        severity: "error",
        code: "schedule_behavior_missing",
        message: `Schedule ${schedule.externalId} references missing behavior ${schedule.behaviorExternalId}.`,
        file: JSONL_FILES.schedules,
      });
      skip(schedule, "missing_behavior");
    }
  }

  for (const occurrence of input.plan.occurrences) {
    if (!behaviorIds.has(occurrence.behaviorExternalId)) {
      input.errors.push({
        severity: "error",
        code: "occurrence_behavior_missing",
        message: `Occurrence ${occurrence.externalId} references missing behavior ${occurrence.behaviorExternalId}.`,
        file: JSONL_FILES.occurrences,
      });
      skip(occurrence, "missing_behavior");
    }

    if (!scheduleIds.has(occurrence.scheduleExternalId)) {
      input.errors.push({
        severity: "error",
        code: "occurrence_schedule_missing",
        message: `Occurrence ${occurrence.externalId} references missing schedule ${occurrence.scheduleExternalId}.`,
        file: JSONL_FILES.occurrences,
      });
      skip(occurrence, "missing_schedule");
    } else if (
      scheduleBehaviorById.get(occurrence.scheduleExternalId) !==
      occurrence.behaviorExternalId
    ) {
      input.errors.push({
        severity: "error",
        code: "occurrence_schedule_behavior_mismatch",
        message: `Occurrence ${occurrence.externalId} references schedule ${occurrence.scheduleExternalId}, which belongs to behavior ${scheduleBehaviorById.get(occurrence.scheduleExternalId)} instead of ${occurrence.behaviorExternalId}.`,
        file: JSONL_FILES.occurrences,
      });
      skip(occurrence, "schedule_behavior_mismatch");
    }
  }

  for (const event of input.plan.statusEvents) {
    if (!occurrenceIds.has(event.occurrenceExternalId)) {
      input.errors.push({
        severity: "error",
        code: "status_event_occurrence_missing",
        message: `Status event ${event.externalId} references missing occurrence ${event.occurrenceExternalId}.`,
        file: JSONL_FILES.statusEvents,
      });
      skip(event, "missing_occurrence");
    }

    if (!behaviorIds.has(event.behaviorExternalId)) {
      input.errors.push({
        severity: "error",
        code: "status_event_behavior_missing",
        message: `Status event ${event.externalId} references missing behavior ${event.behaviorExternalId}.`,
        file: JSONL_FILES.statusEvents,
      });
      skip(event, "missing_behavior");
    }

    if (event.revisesEventId && !statusEventIds.has(event.revisesEventId)) {
      input.warnings.push({
        severity: "warning",
        code: "status_event_revision_target_missing",
        message: `Status event ${event.externalId} revises ${event.revisesEventId}, which is not in this bundle.`,
        file: JSONL_FILES.statusEvents,
      });
    }
  }

  for (const event of input.plan.definitionEvents ?? []) {
    if (!behaviorIds.has(event.behaviorExternalId)) {
      input.warnings.push({
        severity: "warning",
        code: "definition_event_behavior_missing",
        message: `Definition event ${event.externalId} references missing behavior ${event.behaviorExternalId} and will be skipped.`,
        file: JSONL_FILES.definitionEvents,
      });
      skip(event, "missing_behavior");
    }
  }

  for (const session of input.plan.timeSessions ?? []) {
    const occurrenceBehaviorId = occurrenceBehaviorById.get(
      session.occurrenceExternalId,
    );

    if (
      !behaviorIds.has(session.behaviorExternalId) ||
      !occurrenceIds.has(session.occurrenceExternalId) ||
      occurrenceBehaviorId !== session.behaviorExternalId
    ) {
      input.warnings.push({
        severity: "warning",
        code: "time_session_parent_unmappable",
        message: `Time session ${session.externalId} cannot map to occurrence ${session.occurrenceExternalId} and behavior ${session.behaviorExternalId}; it will be skipped.`,
        file: JSONL_FILES.timeSessions,
      });
      skip(session, "parent_unmappable");
    }
  }

  for (const rule of input.plan.interventionRules ?? []) {
    if (
      rule.behaviorExternalId !== null &&
      !behaviorIds.has(rule.behaviorExternalId)
    ) {
      input.warnings.push({
        severity: "warning",
        code: "intervention_rule_behavior_missing",
        message: `Intervention rule ${rule.externalId} references missing behavior ${rule.behaviorExternalId} and will be skipped.`,
        file: JSONL_FILES.interventionRules,
      });
      skip(rule, "missing_behavior");
    }
  }

  for (const note of input.plan.notes) {
    const targetExists =
      (note.attachedToType === "behavior" &&
        behaviorIds.has(note.attachedToId)) ||
      (note.attachedToType === "occurrence" &&
        occurrenceIds.has(note.attachedToId)) ||
      (note.attachedToType === "status_event" &&
        statusEventIds.has(note.attachedToId)) ||
      note.attachedToType === "review";

    if (!targetExists) {
      input.warnings.push({
        severity: "warning",
        code: "note_target_missing",
        message: `Note ${note.externalId} references missing ${note.attachedToType} ${note.attachedToId}.`,
        file: JSONL_FILES.notes,
      });
      skip(note, "missing_attachment");
    }
  }

  for (const intervention of input.plan.interventions) {
    if (!behaviorIds.has(intervention.behaviorExternalId)) {
      input.errors.push({
        severity: "error",
        code: "intervention_behavior_missing",
        message: `Intervention ${intervention.externalId} references missing behavior ${intervention.behaviorExternalId}.`,
        file: JSONL_FILES.interventions,
      });
    }

    if (!occurrenceIds.has(intervention.occurrenceExternalId)) {
      input.errors.push({
        severity: "error",
        code: "intervention_occurrence_missing",
        message: `Intervention ${intervention.externalId} references missing occurrence ${intervention.occurrenceExternalId}.`,
        file: JSONL_FILES.interventions,
      });
    }
  }
}

function limitRunningTimeSessions(
  plan: BehaviorLogImportPlan,
  warnings: BehaviorLogImportIssue[],
): void {
  const runningByOccurrence = new Map<
    string,
    BehaviorLogImportTimeSessionPlan[]
  >();

  for (const session of plan.timeSessions ?? []) {
    if (session.action === "skip" || session.stoppedAtUtc !== null) {
      continue;
    }

    const sessions = runningByOccurrence.get(session.occurrenceExternalId);

    if (sessions) {
      sessions.push(session);
    } else {
      runningByOccurrence.set(session.occurrenceExternalId, [session]);
    }
  }

  for (const sessions of runningByOccurrence.values()) {
    sessions.sort((left, right) =>
      `${left.startedAtUtc}:${left.externalId}`.localeCompare(
        `${right.startedAtUtc}:${right.externalId}`,
      ),
    );

    for (const session of sessions.slice(1)) {
      skip(session, "additional_running_session");
      warnings.push({
        severity: "warning",
        code: "additional_running_time_session_skipped",
        message: `Time session ${session.externalId} is an additional running session for occurrence ${session.occurrenceExternalId} and will be skipped.`,
        file: JSONL_FILES.timeSessions,
      });
    }
  }
}

function validateDuplicateInterventionIds(
  plan: BehaviorLogImportPlan,
  errors: BehaviorLogImportIssue[],
): void {
  const seen = new Set<string>();

  for (const intervention of plan.interventions) {
    if (!seen.has(intervention.externalId)) {
      seen.add(intervention.externalId);
      continue;
    }

    errors.push({
      severity: "error",
      code: "duplicate_imported_id",
      message: `intervention ${intervention.externalId} appears more than once in the bundle.`,
      file: JSONL_FILES.interventions,
    });
  }
}

function skipDuplicateInterventionRules(
  plan: BehaviorLogImportPlan,
  warnings: BehaviorLogImportIssue[],
): void {
  const seen = new Set<string>();

  for (const rule of plan.interventionRules ?? []) {
    if (!seen.has(rule.externalId)) {
      seen.add(rule.externalId);
      continue;
    }

    skip(rule, "duplicate_imported_id");
    warnings.push({
      severity: "warning",
      code: "duplicate_intervention_rule_skipped",
      message: `Intervention rule ${rule.externalId} appears more than once and the duplicate will be skipped.`,
      file: JSONL_FILES.interventionRules,
    });
  }
}

function validateNoteImportPolicy(input: {
  plan: BehaviorLogImportPlan;
  warnings: BehaviorLogImportIssue[];
}): void {
  for (const note of input.plan.notes) {
    if (note.noteRole === "ai_generated") {
      input.warnings.push({
        severity: "warning",
        code: "ai_generated_note_skipped",
        message: `Note ${note.externalId} is AI-generated and will not be imported into Cadence notes.`,
        file: JSONL_FILES.notes,
      });
      skip(note, "ai_generated_note");
    }

    if (note.sensitivity === "high" || note.sensitivity === "restricted") {
      input.warnings.push({
        severity: "warning",
        code:
          note.sensitivity === "restricted"
            ? "restricted_note_present"
            : "high_sensitivity_note_present",
        message: `Note ${note.externalId} is labeled ${note.sensitivity} sensitivity; review it before accepting any note import action.`,
        file: JSONL_FILES.notes,
      });
    }
  }
}

function validateSupportedSchedules(input: {
  plan: BehaviorLogImportPlan;
  warnings: BehaviorLogImportIssue[];
  exportedAtUtc: string | null;
}): void {
  for (const schedule of input.plan.schedules) {
    if (schedule.action === "skip") {
      continue;
    }

    if (schedule.cadenceHistoricalRecurrence === "unknown") {
      input.warnings.push({
        severity: "warning",
        code: "cadence_unknown_historical_schedule_export_only",
        message: `Schedule ${schedule.externalId} is a one-occurrence historical placeholder. Cadence keeps it readable but does not import it as a current schedule.`,
        file: JSONL_FILES.schedules,
      });
      skip(schedule, "cadence_historical_schedule_export_only");
      markHistoricalOccurrenceSnapshots(input, schedule);
      continue;
    }

    if (
      schedule.cadenceImportRole === "historical_reference_only" ||
      (schedule.cadenceConfigurationEventId && schedule.cadenceImportRole !== "current_configuration")
    ) {
      input.warnings.push({
        severity: "warning",
        code: "cadence_historical_schedule_period_export_only",
        message: `Schedule ${schedule.externalId} is a historical configuration period. Cadence keeps it readable but imports only the current schedule snapshot.`,
        file: JSONL_FILES.schedules,
      });
      skip(schedule, "cadence_historical_schedule_export_only");
      markHistoricalOccurrenceSnapshots(input, schedule);
      continue;
    }

    if (schedule.recurrenceProfile !== "behaviorlog.calendar_simple.v1") {
      input.warnings.push({
        severity: "warning",
        code: "unsupported_recurrence_profile",
        message: `Schedule ${schedule.externalId} uses unsupported recurrence_profile ${schedule.recurrenceProfile}.`,
        file: JSONL_FILES.schedules,
      });
      skip(schedule, "unsupported_recurrence_profile");
      continue;
    }

    if (!isSupportedRecurrence(schedule.recurrence)) {
      input.warnings.push({
        severity: "warning",
        code: "unsupported_recurrence",
        message: `Schedule ${schedule.externalId} uses a recurrence payload Cadence cannot import in create-only mode.`,
        file: JSONL_FILES.schedules,
      });
      skip(schedule, "unsupported_recurrence");
      continue;
    }

    const behavior = input.plan.behaviors.find((row) => row.externalId === schedule.behaviorExternalId);
    const creationDate = behavior?.createdAtUtc
      ? Temporal.Instant.from(behavior.createdAtUtc).toZonedDateTimeISO(schedule.timezone).toPlainDate().toString() : null;
    const subminute = [schedule.localTime, schedule.windowStartLocal, schedule.windowEndLocal].some((value) => {
      if (!value) return false;
      const time = Temporal.PlainTime.from(value);
      return time.second !== 0 || time.millisecond !== 0 || time.microsecond !== 0 || time.nanosecond !== 0;
    });
    if (subminute) {
      input.warnings.push({severity:"warning",code:"unsupported_schedule_precision",message:`Schedule ${schedule.externalId} requires subminute execution that Cadence cannot operate. No time will be rounded.`,file:JSONL_FILES.schedules});
      skip(schedule,"unsupported_schedule_precision"); markHistoricalOccurrenceSnapshots(input,schedule); continue;
    }
    let futureStart = false;
    try { futureStart = !!(schedule.effectiveFromUtc && (!input.exportedAtUtc || Temporal.Instant.compare(schedule.effectiveFromUtc, input.exportedAtUtc) > 0)); } catch { futureStart = true; }
    const inactiveCurrentCarrier = behavior?.active === false && schedule.cadenceImportRole === "current_configuration" &&
      !!schedule.cadenceConfigurationEventId && schedule.effectiveFromUtc === schedule.effectiveUntilUtc && !futureStart;
    if (!inactiveCurrentCarrier && (schedule.effectiveUntilUtc || schedule.activeUntilLocalDate || futureStart)) {
      input.warnings.push({severity:"warning", code:"unsupported_schedule_effective_bounds",
        message:`Schedule ${schedule.externalId} has operating bounds Cadence cannot enforce. It will not become a current schedule; occurrence snapshots remain detached.`, file:JSONL_FILES.schedules});
      skip(schedule, "unsupported_schedule_effective_bounds"); markHistoricalOccurrenceSnapshots(input, schedule); continue;
    }
    if (Number(schedule.recurrence.interval) > 1 && schedule.anchorLocalDate && schedule.anchorLocalDate !== creationDate) {
      input.warnings.push({ severity: "warning", code: "unsupported_schedule_anchor",
        message: `Schedule ${schedule.externalId} has an independent interval anchor. Cadence cannot operate that schedule; occurrence snapshots remain detached.`, file: JSONL_FILES.schedules });
      skip(schedule, "unsupported_schedule_anchor");
      markHistoricalOccurrenceSnapshots(input, schedule);
      continue;
    }

    if (!isSupportedScheduleSlot(schedule)) {
      input.warnings.push({
        severity: "warning",
        code: "unsupported_schedule_window",
        message: `Schedule ${schedule.externalId} does not fit Cadence exact-time or preset time-range slots.`,
        file: JSONL_FILES.schedules,
      });
      skip(schedule, "unsupported_schedule_window");
    }
  }
  for (const behavior of input.plan.behaviors) {
    const schedules = input.plan.schedules.filter((schedule) => schedule.behaviorExternalId === behavior.externalId);
    if (!schedules.some((schedule) => schedule.action === "create") && schedules.some((schedule) => schedule.skipReasons.some((reason) => ["unsupported_schedule_anchor", "unsupported_schedule_precision", "unsupported_schedule_effective_bounds"].includes(reason)))) {
      skip(behavior, "no_operable_schedule");
      input.warnings.push({severity:"warning",code:"no_operable_schedule",message:`Behavior ${behavior.externalId} has no schedule Cadence can operate. Its behavior and dependent occurrence imports will be skipped.`,file:JSONL_FILES.behaviors});
    }
  }
}

function markHistoricalOccurrenceSnapshots(
  input: {
    plan: BehaviorLogImportPlan;
    warnings: BehaviorLogImportIssue[];
  },
  schedule: BehaviorLogImportSchedulePlan,
): void {
  for (const occurrence of input.plan.occurrences) {
    if (occurrence.scheduleExternalId !== schedule.externalId) {
      continue;
    }

    occurrence.importWithDetachedScheduleSnapshot = true;
    input.warnings.push({
      severity: "warning",
      code: "cadence_historical_occurrence_detached_schedule",
      message: `Occurrence ${occurrence.externalId} references historical schedule ${schedule.externalId}. Cadence imports the occurrence snapshot without attaching the historical schedule to the current Behavior graph.`,
      file: JSONL_FILES.occurrences,
    });
  }
}

function markConflicts(input: {
  plan: BehaviorLogImportPlan;
  existing: BehaviorLogExistingRecords | undefined;
  conflicts: BehaviorLogImportConflict[];
  warnings: BehaviorLogImportIssue[];
}): void {
  markDuplicateIds(input.plan.behaviors, "behavior", input.conflicts);
  markDuplicateIds(input.plan.schedules, "schedule", input.conflicts);
  markDuplicateIds(input.plan.occurrences, "occurrence", input.conflicts);
  markDuplicateIds(input.plan.statusEvents, "status_event", input.conflicts);
  markDuplicateIds(
    input.plan.definitionEvents ?? [],
    "behavior_definition_event",
    input.conflicts,
  );
  markDuplicateIds(input.plan.timeSessions ?? [], "time_session", input.conflicts);
  markDuplicateIds(input.plan.notes, "note", input.conflicts);
  markDuplicateIds(input.plan.interventions, "intervention", input.conflicts);

  const existing = input.existing ?? {};
  const existingBehaviorById = new Map(
    (existing.behaviors ?? []).map((behavior) => [behavior.id, behavior]),
  );
  const existingBehaviorByIdentity = new Map(
    (existing.behaviors ?? []).map((behavior) => [
      behaviorIdentity(behavior.title, behavior.category ?? null),
      behavior,
    ]),
  );

  for (const behavior of input.plan.behaviors) {
    const existingById = existingBehaviorById.get(behavior.externalId);
    const existingByIdentity = existingBehaviorByIdentity.get(
      behaviorIdentity(behavior.title, behavior.category),
    );

    if (existingById) {
      addConflict(input.conflicts, {
        code: "existing_behavior_id",
        message: `Behavior ${behavior.externalId} already exists locally.`,
        importedRecordType: "behavior",
        importedId: behavior.externalId,
        existingId: existingById.id,
      });
      skip(behavior, "existing_behavior_id");
      continue;
    }

    if (existingByIdentity) {
      addConflict(input.conflicts, {
        code: "likely_existing_behavior",
        message: `Behavior ${behavior.title} looks like an existing local behavior.`,
        importedRecordType: "behavior",
        importedId: behavior.externalId,
        existingId: existingByIdentity.id,
      });
      skip(behavior, "likely_existing_behavior");
    }
  }

  const behaviorById = new Map(
    input.plan.behaviors.map((behavior) => [behavior.externalId, behavior]),
  );

  for (const schedule of input.plan.schedules) {
    if (behaviorById.get(schedule.behaviorExternalId)?.action === "skip") {
      skip(schedule, "parent_behavior_skipped");
    }
  }

  const scheduleById = new Map(
    input.plan.schedules.map((schedule) => [schedule.externalId, schedule]),
  );
  const existingOccurrenceById = new Map(
    (existing.occurrences ?? []).map((occurrence) => [occurrence.id, occurrence]),
  );
  const existingOccurrenceByExactTime = new Map(
    (existing.occurrences ?? []).map((occurrence) => [
      `${occurrence.behaviorId}|${occurrence.scheduledForUtc}`,
      occurrence,
    ]),
  );
  const existingOccurrenceByLikelyTime = new Map(
    (existing.occurrences ?? [])
      .filter((occurrence) => occurrence.behaviorTitle)
      .map((occurrence) => [
        occurrenceIdentity({
          behaviorTitle: occurrence.behaviorTitle ?? "",
          scheduledForUtc: occurrence.scheduledForUtc,
          localDate: occurrence.localDate,
          timezone: occurrence.timezone,
        }),
        occurrence,
      ]),
  );

  for (const occurrence of input.plan.occurrences) {
    const parentBehavior = behaviorById.get(occurrence.behaviorExternalId);

    if (!parentBehavior || parentBehavior.action === "skip") {
      skip(occurrence, "parent_behavior_skipped");
    }

    const parentSchedule = scheduleById.get(occurrence.scheduleExternalId);

    if (
      parentSchedule?.action === "skip" &&
      !occurrence.importWithDetachedScheduleSnapshot
    ) {
      skip(occurrence, "parent_schedule_skipped");
    }

    const existingById = existingOccurrenceById.get(occurrence.externalId);
    const existingByExactTime = existingOccurrenceByExactTime.get(
      `${occurrence.behaviorExternalId}|${occurrence.scheduledForUtc}`,
    );
    const existingByLikelyTime =
      parentBehavior &&
      existingOccurrenceByLikelyTime.get(
        occurrenceIdentity({
          behaviorTitle: parentBehavior.title,
          scheduledForUtc: occurrence.scheduledForUtc,
          localDate: occurrence.localDate,
          timezone: occurrence.timezone,
        }),
      );

    if (existingById) {
      addOccurrenceConflict(
        input.conflicts,
        occurrence,
        "existing_occurrence_id",
        `Occurrence ${occurrence.externalId} already exists locally.`,
        existingById.id,
      );
      skip(occurrence, "existing_occurrence_id");
      continue;
    }

    if (existingByExactTime || existingByLikelyTime) {
      addOccurrenceConflict(
        input.conflicts,
        occurrence,
        "likely_existing_occurrence",
        `Occurrence ${occurrence.externalId} looks like an existing local occurrence.`,
        (existingByExactTime || existingByLikelyTime)?.id,
      );
      skip(occurrence, "likely_existing_occurrence");
    }
  }

  const occurrenceById = new Map(
    input.plan.occurrences.map((occurrence) => [
      occurrence.externalId,
      occurrence,
    ]),
  );
  const existingEventById = new Map(
    (existing.statusEvents ?? []).map((event) => [event.id, event]),
  );
  const existingEventByFingerprint = new Map(
    (existing.statusEvents ?? []).map((event) => [
      statusEventIdentity(event.occurrenceId, event.recordedAtUtc, event.status),
      event,
    ]),
  );

  for (const event of input.plan.statusEvents) {
    const parentOccurrence = occurrenceById.get(event.occurrenceExternalId);

    if (!parentOccurrence || parentOccurrence.action === "skip") {
      skip(event, "parent_occurrence_skipped");
    }

    const existingById = existingEventById.get(event.externalId);
    const existingByFingerprint = existingEventByFingerprint.get(
      statusEventIdentity(
        event.occurrenceExternalId,
        event.recordedAtUtc,
        event.status,
      ),
    );

    if (existingById) {
      addStatusEventConflict(
        input.conflicts,
        event,
        "existing_status_event_id",
        `Status event ${event.externalId} already exists locally.`,
        existingById.id,
      );
      skip(event, "existing_status_event_id");
      continue;
    }

    if (existingByFingerprint) {
      addStatusEventConflict(
        input.conflicts,
        event,
        "likely_existing_status_event",
        `Status event ${event.externalId} looks like an existing local status event.`,
        existingByFingerprint.id,
      );
      skip(event, "likely_existing_status_event");
    }
  }

  const statusEventById = new Map(
    input.plan.statusEvents.map((event) => [event.externalId, event]),
  );

  for (const note of input.plan.notes) {
    if (
      note.attachedToType === "behavior" &&
      behaviorById.get(note.attachedToId)?.action === "skip"
    ) {
      skip(note, "parent_behavior_skipped");
    }

    if (
      note.attachedToType === "occurrence" &&
      occurrenceById.get(note.attachedToId)?.action === "skip"
    ) {
      skip(note, "parent_occurrence_skipped");
    }

    if (
      note.attachedToType === "status_event" &&
      statusEventById.get(note.attachedToId)?.action === "skip"
    ) {
      skip(note, "parent_status_event_skipped");
    }
  }
}

function warnAboutSnapshotHistory(input: {
  plan: BehaviorLogImportPlan;
  warnings: BehaviorLogImportIssue[];
}): void {
  const eventsByOccurrenceId = groupBy(
    input.plan.statusEvents,
    (event) => event.occurrenceExternalId,
  );

  for (const occurrence of input.plan.occurrences) {
    const events = eventsByOccurrenceId.get(occurrence.externalId) ?? [];

    if (occurrence.currentStatus !== "unresolved" && events.length === 0) {
      input.warnings.push({
        severity: "warning",
        code: "resolved_snapshot_without_history",
        message: `Occurrence ${occurrence.externalId} has current_status ${occurrence.currentStatus} but no status_events row.`,
        file: JSONL_FILES.occurrences,
      });
      continue;
    }

    if (events.length === 0) {
      continue;
    }

    const latestEvent = [...events].sort(compareStatusEventPlans).at(-1);

    if (latestEvent && latestEvent.status !== occurrence.currentStatus) {
      input.warnings.push({
        severity: "warning",
        code: "snapshot_status_differs_from_history",
        message: `Occurrence ${occurrence.externalId} current_status ${occurrence.currentStatus} differs from latest status event ${latestEvent.status}.`,
        file: JSONL_FILES.occurrences,
      });
    }
  }
}

type MergePreviewBuildInput = {
  plan: BehaviorLogImportPlan;
  existing?: BehaviorLogExistingRecords;
  privacy: BehaviorLogImportMergePreview["privacy"];
  interventions: BehaviorLogImportInterventionPreviewPlan[];
};

type MergePreviewContext = {
  existing: BehaviorLogExistingRecords;
  mappingsByKey: Map<string, string>;
  behaviorsById: Map<string, NonNullable<BehaviorLogExistingRecords["behaviors"]>[number]>;
  behaviorsBySourceOriginalId: Map<
    string,
    NonNullable<BehaviorLogExistingRecords["behaviors"]>[number]
  >;
  behaviorsByIdentity: Map<
    string,
    NonNullable<BehaviorLogExistingRecords["behaviors"]>[number]
  >;
  behaviorsByCadenceIdentity: Map<
    string,
    NonNullable<BehaviorLogExistingRecords["behaviors"]>[number]
  >;
  behaviorsByTitle: Map<
    string,
    NonNullable<BehaviorLogExistingRecords["behaviors"]>[number]
  >;
  schedulesById: Map<string, NonNullable<BehaviorLogExistingRecords["schedules"]>[number]>;
  schedulesByBehaviorId: Map<
    string,
    NonNullable<BehaviorLogExistingRecords["schedules"]>[number][]
  >;
  occurrencesById: Map<string, NonNullable<BehaviorLogExistingRecords["occurrences"]>[number]>;
  occurrencesBySourceOriginalId: Map<
    string,
    NonNullable<BehaviorLogExistingRecords["occurrences"]>[number]
  >;
  statusEventsById: Map<
    string,
    NonNullable<BehaviorLogExistingRecords["statusEvents"]>[number]
  >;
  statusEventsBySourceOriginalId: Map<
    string,
    NonNullable<BehaviorLogExistingRecords["statusEvents"]>[number]
  >;
  statusEventsByFingerprint: Map<
    string,
    NonNullable<BehaviorLogExistingRecords["statusEvents"]>[number]
  >;
  importedNotesById: Map<
    string,
    NonNullable<BehaviorLogExistingRecords["importedNotes"]>[number]
  >;
  importedNotesByExternalId: Map<
    string,
    NonNullable<BehaviorLogExistingRecords["importedNotes"]>
  >;
  importedInterventionsById: Map<string, NonNullable<BehaviorLogExistingRecords["importedInterventions"]>[number]>;
  importedInterventionsByExternalId: Map<string, NonNullable<BehaviorLogExistingRecords["importedInterventions"]>>;
  importedSchedulesByBehaviorId: Map<string, BehaviorLogImportSchedulePlan[]>;
};

function buildMergePreview(
  input: MergePreviewBuildInput,
): BehaviorLogImportMergePreview {
  const context = createMergePreviewContext(input);
  const conflicts: BehaviorLogImportMergeConflict[] = [];
  const behaviorActions = input.plan.behaviors.map((behavior) =>
    resolveBehaviorMergeAction(behavior, context, conflicts),
  );
  const behaviorActionsByExternalId = new Map(
    behaviorActions.map((action) => [action.externalId, action]),
  );
  const scheduleActions = input.plan.schedules.map((schedule) =>
    resolveScheduleMergeAction({
      schedule,
      context,
      conflicts,
      behaviorActionsByExternalId,
    }),
  );
  const scheduleActionsByExternalId = new Map(
    scheduleActions.map((action) => [action.externalId, action]),
  );
  const schedulesByExternalId = new Map(
    input.plan.schedules.map((schedule) => [schedule.externalId, schedule]),
  );
  const occurrenceActions = input.plan.occurrences.map((occurrence) =>
    resolveOccurrenceMergeAction({
      occurrence,
      schedule: schedulesByExternalId.get(occurrence.scheduleExternalId),
      context,
      conflicts,
      behaviorActionsByExternalId,
      scheduleActionsByExternalId,
    }),
  );
  const occurrenceActionsByExternalId = new Map(
    occurrenceActions.map((action) => [action.externalId, action]),
  );
  const statusEventActions = input.plan.statusEvents.map((event) =>
    resolveStatusEventMergeAction({
      event,
      context,
      conflicts,
      occurrenceActionsByExternalId,
    }),
  );
  const statusEventActionsByExternalId = new Map(
    statusEventActions.map((action) => [action.externalId, action]),
  );
  const definitionEventActions = (input.plan.definitionEvents ?? []).map(
    (event) =>
      resolveDefinitionEventMergeAction({
        event,
        context,
        conflicts,
        behaviorActionsByExternalId,
      }),
  );
  const timeSessionActions = (input.plan.timeSessions ?? []).map((session) =>
    resolveTimeSessionMergeAction({
      session,
      context,
      conflicts,
      behaviorActionsByExternalId,
      occurrenceActionsByExternalId,
    }),
  );
  const noteActions = input.plan.notes.map((note) =>
    resolveNoteMergeAction({
      note,
      context,
      conflicts,
      behaviorActionsByExternalId,
      occurrenceActionsByExternalId,
      statusEventActionsByExternalId,
    }),
  );
  const interventionActions = input.interventions.map((intervention) =>
    resolveInterventionMergeAction({
      intervention,
      context,
      conflicts,
      behaviorActionsByExternalId,
      occurrenceActionsByExternalId,
    }),
  );
  const actions = {
    behaviors: behaviorActions,
    schedules: scheduleActions,
    occurrences: occurrenceActions,
    statusEvents: statusEventActions,
    definitionEvents: definitionEventActions,
    timeSessions: timeSessionActions,
    notes: noteActions,
    interventions: interventionActions,
  };

  return {
    mode: "merge_preview",
    privacy: input.privacy,
    semantics: {
      jsonlAuthoritative: true,
      csvIgnoredForMerge: true,
      statusEventsAuthoritative: true,
      unresolvedIsFailure: false,
      appendOnlyStatusEvents: true,
    },
    actionCounts: countMergeActions(actions),
    conflictCodes: [...new Set(conflicts.map((conflict) => conflict.code))].sort(),
    conflictCount: conflicts.length,
    conflicts,
    actions,
  };
}

function createMergePreviewContext(
  input: MergePreviewBuildInput,
): MergePreviewContext {
  const existing = input.existing ?? {};
  const existingSchedules = dedupeById([
    ...(existing.schedules ?? []),
    ...(existing.behaviors ?? []).flatMap((behavior) => behavior.schedules ?? []),
  ]);
  const behaviors = existing.behaviors ?? [];
  const occurrences = existing.occurrences ?? [];
  const statusEvents = existing.statusEvents ?? [];
  const importedNotes = existing.importedNotes ?? [];

  return {
    existing,
    mappingsByKey: new Map(
      (existing.mappings ?? []).map((mapping) => [
        mergeMappingKey(mapping.recordType, mapping.externalId),
        mapping.localId,
      ]),
    ),
    behaviorsById: new Map(behaviors.map((behavior) => [behavior.id, behavior])),
    behaviorsBySourceOriginalId: indexByOptionalString(
      behaviors,
      (behavior) => behavior.sourceOriginalId,
    ),
    behaviorsByIdentity: new Map(
      behaviors.map((behavior) => [
        behaviorIdentity(behavior.title, behavior.category ?? null),
        behavior,
      ]),
    ),
    behaviorsByCadenceIdentity: new Map(
      behaviors.flatMap((behavior) =>
        behavior.cadenceCategoryName
          ? [
              [
                behaviorIdentity(
                  behavior.title,
                  behavior.cadenceCategoryName,
                ),
                behavior,
              ] as const,
            ]
          : [],
      ),
    ),
    behaviorsByTitle: new Map(
      behaviors.map((behavior) => [normalizeIdentity(behavior.title), behavior]),
    ),
    schedulesById: new Map(
      existingSchedules.map((schedule) => [schedule.id, schedule]),
    ),
    schedulesByBehaviorId: groupBy(
      existingSchedules,
      (schedule) => schedule.behaviorId,
    ),
    occurrencesById: new Map(
      occurrences.map((occurrence) => [occurrence.id, occurrence]),
    ),
    occurrencesBySourceOriginalId: indexByOptionalString(
      occurrences,
      (occurrence) => occurrence.sourceOriginalId,
    ),
    statusEventsById: new Map(statusEvents.map((event) => [event.id, event])),
    statusEventsBySourceOriginalId: indexByOptionalString(
      statusEvents,
      (event) => event.sourceOriginalId,
    ),
    statusEventsByFingerprint: new Map(
      statusEvents.map((event) => [
        statusEventMergeIdentity(
          event.occurrenceId,
          event.recordedAtUtc,
          event.status,
          event.statusSemantics ?? null,
          event.revisesEventId ?? null,
        ),
        event,
      ]),
    ),
    importedNotesById: new Map(
      importedNotes.map((note) => [note.id, note]),
    ),
    importedNotesByExternalId: groupBy(importedNotes, (note) => note.externalId),
    importedInterventionsById: new Map((existing.importedInterventions ?? []).map((row) => [row.id, row])),
    importedInterventionsByExternalId: groupBy(existing.importedInterventions ?? [], (row) => row.externalId),
    importedSchedulesByBehaviorId: groupBy(
      input.plan.schedules.filter((schedule) => schedule.action === "create"),
      (schedule) => schedule.behaviorExternalId,
    ),
  };
}

function resolveBehaviorMergeAction(
  behavior: BehaviorLogImportBehaviorPlan,
  context: MergePreviewContext,
  conflicts: BehaviorLogImportMergeConflict[],
): BehaviorLogImportMergeRecordAction {
  const mappedLocalId = context.mappingsByKey.get(
    mergeMappingKey("behavior", behavior.externalId),
  );
  const mappedBehavior = mappedLocalId
    ? context.behaviorsById.get(mappedLocalId)
    : undefined;

  if (mappedLocalId && !mappedBehavior) {
    return conflictMergeAction({
      conflicts,
      recordType: "behavior",
      externalId: behavior.externalId,
      localId: mappedLocalId,
      codes: ["behavior_mapped_record_missing"],
      reasons: [
        `Existing import mapping points behavior ${behavior.externalId} at local behavior ${mappedLocalId}, but that local behavior was not provided to the preview.`,
      ],
    });
  }

  if (mappedBehavior) {
    return behaviorCandidateAction({
      behavior,
      existing: mappedBehavior,
      context,
      conflicts,
      reason: `Existing import mapping links behavior ${behavior.externalId} to local behavior ${mappedBehavior.id}.`,
    });
  }

  const sourceMatch = behavior.sourceOriginalId
    ? context.behaviorsBySourceOriginalId.get(behavior.sourceOriginalId) ??
      context.behaviorsById.get(behavior.sourceOriginalId)
    : undefined;

  if (sourceMatch) {
    return behaviorCandidateAction({
      behavior,
      existing: sourceMatch,
      context,
      conflicts,
      reason: `Behavior ${behavior.externalId} shares source original id ${behavior.sourceOriginalId}.`,
    });
  }

  const idMatch = context.behaviorsById.get(behavior.externalId);

  if (idMatch) {
    return behaviorCandidateAction({
      behavior,
      existing: idMatch,
      context,
      conflicts,
      reason: `Behavior ${behavior.externalId} matches a local behavior id.`,
    });
  }

  const cadenceIdentityMatch = behavior.cadenceCategoryName
    ? context.behaviorsByCadenceIdentity.get(
        behaviorIdentity(behavior.title, behavior.cadenceCategoryName),
      )
    : undefined;
  const identityMatch =
    cadenceIdentityMatch ??
    context.behaviorsByIdentity.get(
      behaviorIdentity(behavior.title, behaviorCategoryForIdentity(behavior)),
    );

  if (identityMatch) {
    return behaviorCandidateAction({
      behavior,
      existing: identityMatch,
      context,
      conflicts,
      reason: cadenceIdentityMatch
        ? `Behavior ${behavior.externalId} matches local Cadence title/category identity.`
        : `Behavior ${behavior.externalId} matches local canonical title/category identity.`,
    });
  }

  const titleOnlyMatch = context.behaviorsByTitle.get(
    normalizeIdentity(behavior.title),
  );

  if (titleOnlyMatch) {
    return behaviorCandidateAction({
      behavior,
      existing: titleOnlyMatch,
      context,
      conflicts,
      reason: `Behavior ${behavior.externalId} has the same title as local behavior ${titleOnlyMatch.id}, but category or provenance differs.`,
    });
  }

  return mergeAction({
    recordType: "behavior",
    externalId: behavior.externalId,
    action: "create_new",
    localId: null,
    reasons: [`Behavior ${behavior.externalId} has no local match.`],
  });
}

function behaviorCandidateAction(input: {
  behavior: BehaviorLogImportBehaviorPlan;
  existing: NonNullable<BehaviorLogExistingRecords["behaviors"]>[number];
  context: MergePreviewContext;
  conflicts: BehaviorLogImportMergeConflict[];
  reason: string;
}): BehaviorLogImportMergeRecordAction {
  const { codes, reasons } = compareBehaviorCandidate(
    input.behavior,
    input.existing,
    input.context,
  );

  if (codes.length > 0) {
    return conflictMergeAction({
      conflicts: input.conflicts,
      recordType: "behavior",
      externalId: input.behavior.externalId,
      localId: input.existing.id,
      codes,
      reasons,
    });
  }

  return mergeAction({
    recordType: "behavior",
    externalId: input.behavior.externalId,
    action: "map_to_existing",
    localId: input.existing.id,
    reasons: [input.reason],
  });
}

function resolveScheduleMergeAction(input: {
  schedule: BehaviorLogImportSchedulePlan;
  context: MergePreviewContext;
  conflicts: BehaviorLogImportMergeConflict[];
  behaviorActionsByExternalId: Map<string, BehaviorLogImportMergeRecordAction>;
}): BehaviorLogImportMergeRecordAction {
  if (input.schedule.action === "skip") {
    return mergeAction({
      recordType: "schedule",
      externalId: input.schedule.externalId,
      action: "skip_existing",
      localId: null,
      reasons: input.schedule.skipReasons.map(
        (reason) => `Schedule import skipped: ${reason}.`,
      ),
      relatedExternalIds: {
        behavior: input.schedule.behaviorExternalId,
      },
    });
  }

  const parent = input.behaviorActionsByExternalId.get(
    input.schedule.behaviorExternalId,
  );

  if (parent?.action === "conflict_requires_decision") {
    return conflictMergeAction({
      conflicts: input.conflicts,
      recordType: "schedule",
      externalId: input.schedule.externalId,
      localId: null,
      codes: ["schedule_parent_behavior_conflict"],
      reasons: [
        `Schedule ${input.schedule.externalId} cannot be compared until behavior ${input.schedule.behaviorExternalId} is resolved.`,
      ],
      relatedExternalIds: {
        behavior: input.schedule.behaviorExternalId,
      },
    });
  }

  if (!parent?.localId) {
    return mergeAction({
      recordType: "schedule",
      externalId: input.schedule.externalId,
      action: "create_new",
      localId: null,
      reasons: [
        `Schedule ${input.schedule.externalId} belongs to a behavior that will be created.`,
      ],
      relatedExternalIds: {
        behavior: input.schedule.behaviorExternalId,
      },
    });
  }

  const mappedLocalId = input.context.mappingsByKey.get(
    mergeMappingKey("schedule", input.schedule.externalId),
  );
  const mappedSchedule = mappedLocalId
    ? input.context.schedulesById.get(mappedLocalId)
    : undefined;

  if (mappedLocalId && !mappedSchedule) {
    return conflictMergeAction({
      conflicts: input.conflicts,
      recordType: "schedule",
      externalId: input.schedule.externalId,
      localId: mappedLocalId,
      codes: ["schedule_mapped_record_missing"],
      reasons: [
        `Existing import mapping points schedule ${input.schedule.externalId} at local schedule ${mappedLocalId}, but that local schedule was not provided to the preview.`,
      ],
      relatedExternalIds: {
        behavior: input.schedule.behaviorExternalId,
      },
    });
  }

  const sourceMatch = input.schedule.sourceOriginalId
    ? input.context.schedulesById.get(input.schedule.sourceOriginalId)
    : undefined;
  const idMatch = input.context.schedulesById.get(input.schedule.externalId);
  const shapeMatch = (
    input.context.schedulesByBehaviorId.get(parent.localId) ?? []
  ).find((schedule) => schedulesMatch(input.schedule, schedule));
  const candidate = mappedSchedule ?? sourceMatch ?? idMatch ?? shapeMatch;

  if (candidate) {
    const { codes, reasons } = compareScheduleCandidate(
      input.schedule,
      candidate,
      parent.localId,
    );

    if (codes.length > 0) {
      return conflictMergeAction({
        conflicts: input.conflicts,
        recordType: "schedule",
        externalId: input.schedule.externalId,
        localId: candidate.id,
        codes,
        reasons,
        relatedExternalIds: {
          behavior: input.schedule.behaviorExternalId,
        },
      });
    }

    return mergeAction({
      recordType: "schedule",
      externalId: input.schedule.externalId,
      action: "map_to_existing",
      localId: candidate.id,
      reasons: [
        `Schedule ${input.schedule.externalId} matches a local schedule for behavior ${parent.localId}.`,
      ],
      relatedExternalIds: {
        behavior: input.schedule.behaviorExternalId,
      },
    });
  }

  return mergeAction({
    recordType: "schedule",
    externalId: input.schedule.externalId,
    action: "create_new",
    localId: null,
    reasons: [
      `Schedule ${input.schedule.externalId} has no matching local recurrence and slot shape.`,
    ],
    relatedExternalIds: {
      behavior: input.schedule.behaviorExternalId,
    },
  });
}

function resolveOccurrenceMergeAction(input: {
  occurrence: BehaviorLogImportOccurrencePlan;
  schedule: BehaviorLogImportSchedulePlan | undefined;
  context: MergePreviewContext;
  conflicts: BehaviorLogImportMergeConflict[];
  behaviorActionsByExternalId: Map<string, BehaviorLogImportMergeRecordAction>;
  scheduleActionsByExternalId: Map<string, BehaviorLogImportMergeRecordAction>;
}): BehaviorLogImportMergeRecordAction {
  if (input.occurrence.action === "skip") {
    return mergeAction({
      recordType: "occurrence",
      externalId: input.occurrence.externalId,
      action: "skip_existing",
      localId: null,
      reasons: input.occurrence.skipReasons.map(
        (reason) => `Occurrence import skipped: ${reason}.`,
      ),
      relatedExternalIds: {
        behavior: input.occurrence.behaviorExternalId,
        schedule: input.occurrence.scheduleExternalId,
      },
    });
  }

  const behaviorAction = input.behaviorActionsByExternalId.get(
    input.occurrence.behaviorExternalId,
  );
  const scheduleAction = input.scheduleActionsByExternalId.get(
    input.occurrence.scheduleExternalId,
  );
  const detachedScheduleSnapshot =
    input.occurrence.importWithDetachedScheduleSnapshot;

  if (
    behaviorAction?.action === "conflict_requires_decision" ||
    (!detachedScheduleSnapshot &&
      scheduleAction?.action === "conflict_requires_decision")
  ) {
    return conflictMergeAction({
      conflicts: input.conflicts,
      recordType: "occurrence",
      externalId: input.occurrence.externalId,
      localId: null,
      codes: ["occurrence_parent_mapping_unresolved"],
      reasons: [
        `Occurrence ${input.occurrence.externalId} cannot be compared until its behavior and schedule are resolved.`,
      ],
      localDate: input.occurrence.localDate,
      timezone: input.occurrence.timezone,
      relatedExternalIds: {
        behavior: input.occurrence.behaviorExternalId,
        schedule: input.occurrence.scheduleExternalId,
      },
    });
  }

  if (
    !behaviorAction?.localId ||
    (!detachedScheduleSnapshot && !scheduleAction?.localId)
  ) {
    return mergeAction({
      recordType: "occurrence",
      externalId: input.occurrence.externalId,
      action: "create_new",
      localId: null,
      reasons: [
        detachedScheduleSnapshot
          ? `Occurrence ${input.occurrence.externalId} will preserve its historical schedule snapshot without attaching that schedule to the current Behavior graph.`
          : `Occurrence ${input.occurrence.externalId} belongs to behavior or schedule records that will be created.`,
      ],
      relatedExternalIds: {
        behavior: input.occurrence.behaviorExternalId,
        schedule: input.occurrence.scheduleExternalId,
      },
    });
  }

  const localBehaviorId = behaviorAction.localId;
  const localScheduleId = detachedScheduleSnapshot
    ? null
    : (scheduleAction?.localId ?? null);
  const mappedLocalId = input.context.mappingsByKey.get(
    mergeMappingKey("occurrence", input.occurrence.externalId),
  );
  const mappedOccurrence = mappedLocalId
    ? input.context.occurrencesById.get(mappedLocalId)
    : undefined;

  if (mappedLocalId && !mappedOccurrence) {
    return occurrenceConflictAction({
      occurrence: input.occurrence,
      conflicts: input.conflicts,
      localId: mappedLocalId,
      codes: ["occurrence_mapped_record_missing"],
      reasons: [
        `Existing import mapping points occurrence ${input.occurrence.externalId} at local occurrence ${mappedLocalId}, but that local occurrence was not provided to the preview.`,
      ],
    });
  }

  const sourceMatch = input.occurrence.sourceOriginalId
    ? input.context.occurrencesBySourceOriginalId.get(
        input.occurrence.sourceOriginalId,
      ) ?? input.context.occurrencesById.get(input.occurrence.sourceOriginalId)
    : undefined;
  const idMatch = input.context.occurrencesById.get(input.occurrence.externalId);
  const exactMatch = (input.context.existing.occurrences ?? []).find((candidate) =>
    occurrencesMatch(input.occurrence, candidate, {
      behaviorId: localBehaviorId,
      scheduleId: localScheduleId,
    }),
  );
  const sameInstantMismatch = (input.context.existing.occurrences ?? []).find(
    (candidate) =>
      candidate.behaviorId === localBehaviorId &&
      optionalStringsEqual(candidate.scheduleId, localScheduleId) &&
      candidate.scheduledForUtc === input.occurrence.scheduledForUtc &&
      !occurrencesMatch(input.occurrence, candidate, {
        behaviorId: localBehaviorId,
        scheduleId: localScheduleId,
      }),
  );
  const candidate =
    mappedOccurrence ?? sourceMatch ?? idMatch ?? exactMatch ?? sameInstantMismatch;

  if (candidate) {
    // Historical export schedules describe snapshots, not the current slot link.
    // Only explicit identity plus the saved snapshot can preserve that link.
    const preservesHistoricalSlot = detachedScheduleSnapshot &&
      Boolean(mappedOccurrence ?? sourceMatch ?? idMatch) &&
      historicalOccurrenceSnapshotMatches(input.schedule, candidate);
    const { codes, reasons } = compareOccurrenceCandidate(input.occurrence, candidate, {
      behaviorId: localBehaviorId,
      scheduleId: preservesHistoricalSlot ? (candidate.scheduleId ?? null) : localScheduleId,
    });

    if (codes.length > 0) {
      return occurrenceConflictAction({
        occurrence: input.occurrence,
        conflicts: input.conflicts,
        localId: candidate.id,
        codes,
        reasons,
      });
    }

    return mergeAction({
      recordType: "occurrence",
      externalId: input.occurrence.externalId,
      action: "map_to_existing",
      localId: candidate.id,
      reasons: [
        `Occurrence ${input.occurrence.externalId} matches a local occurrence by mapped behavior, mapped schedule, scheduled_for_utc, local_date, and timezone.`,
      ],
      relatedExternalIds: {
        behavior: input.occurrence.behaviorExternalId,
        schedule: input.occurrence.scheduleExternalId,
      },
    });
  }

  return mergeAction({
    recordType: "occurrence",
    externalId: input.occurrence.externalId,
    action: "create_new",
    localId: null,
    reasons: [
      `Occurrence ${input.occurrence.externalId} has no local match by mapped behavior, mapped schedule, scheduled_for_utc, local_date, and timezone.`,
    ],
    relatedExternalIds: {
      behavior: input.occurrence.behaviorExternalId,
      schedule: input.occurrence.scheduleExternalId,
    },
  });
}

function resolveStatusEventMergeAction(input: {
  event: BehaviorLogImportStatusEventPlan;
  context: MergePreviewContext;
  conflicts: BehaviorLogImportMergeConflict[];
  occurrenceActionsByExternalId: Map<string, BehaviorLogImportMergeRecordAction>;
}): BehaviorLogImportMergeRecordAction {
  const occurrenceAction = input.occurrenceActionsByExternalId.get(
    input.event.occurrenceExternalId,
  );

  if (occurrenceAction?.action === "conflict_requires_decision") {
    return statusEventConflictAction({
      event: input.event,
      conflicts: input.conflicts,
      localId: null,
      codes: ["status_event_parent_mapping_unresolved"],
      reasons: [
        `Status event ${input.event.externalId} cannot be compared until occurrence ${input.event.occurrenceExternalId} is resolved.`,
      ],
    });
  }

  if (!occurrenceAction?.localId) {
    return mergeAction({
      recordType: "status_event",
      externalId: input.event.externalId,
      action: "create_new",
      localId: null,
      reasons: [
        `Status event ${input.event.externalId} belongs to an occurrence that will be created. status_events.jsonl remains authoritative over the occurrence current_status snapshot.`,
      ],
      relatedExternalIds: {
        occurrence: input.event.occurrenceExternalId,
        behavior: input.event.behaviorExternalId,
        revisesEvent: input.event.revisesEventId,
      },
    });
  }

  const revisionCode = unresolvedRevisionCode(input.event, input.context);
  const mappedLocalId = input.context.mappingsByKey.get(
    mergeMappingKey("status_event", input.event.externalId),
  );
  const mappedEvent = mappedLocalId
    ? input.context.statusEventsById.get(mappedLocalId)
    : undefined;

  if (mappedLocalId && !mappedEvent) {
    return statusEventConflictAction({
      event: input.event,
      conflicts: input.conflicts,
      localId: mappedLocalId,
      codes: ["status_event_mapped_record_missing"],
      reasons: [
        `Existing import mapping points status event ${input.event.externalId} at local event ${mappedLocalId}, but that local event was not provided to the preview.`,
      ],
    });
  }

  const sourceMatch = input.event.sourceOriginalId
    ? input.context.statusEventsBySourceOriginalId.get(input.event.sourceOriginalId) ??
      input.context.statusEventsById.get(input.event.sourceOriginalId)
    : undefined;
  const idMatch = input.context.statusEventsById.get(input.event.externalId);
  const fingerprintMatch = input.context.statusEventsByFingerprint.get(
    statusEventMergeIdentity(
      occurrenceAction.localId,
      input.event.recordedAtUtc,
      input.event.status,
      input.event.statusSemantics,
      localRevisionTargetId(input.event, input.context),
    ),
  );
  const candidate = mappedEvent ?? sourceMatch ?? idMatch ?? fingerprintMatch;

  if (candidate) {
    const { codes, reasons } = compareStatusEventCandidate(input.event, candidate, {
      occurrenceId: occurrenceAction.localId,
      revisionTargetId: localRevisionTargetId(input.event, input.context),
    });
    const allCodes = [...codes, ...revisionCode.codes];
    const allReasons = [...reasons, ...revisionCode.reasons];

    if (allCodes.length > 0) {
      return statusEventConflictAction({
        event: input.event,
        conflicts: input.conflicts,
        localId: candidate.id,
        codes: allCodes,
        reasons: allReasons,
      });
    }

    return mergeAction({
      recordType: "status_event",
      externalId: input.event.externalId,
      action: fingerprintMatch ? "skip_existing" : "map_to_existing",
      localId: candidate.id,
      reasons: [
        fingerprintMatch
          ? `Status event ${input.event.externalId} already exists locally with the same occurrence, recorded time, status, semantics, and revision target.`
          : `Status event ${input.event.externalId} maps to local status event ${candidate.id}.`,
      ],
      relatedExternalIds: {
        occurrence: input.event.occurrenceExternalId,
        behavior: input.event.behaviorExternalId,
        revisesEvent: input.event.revisesEventId,
      },
    });
  }

  if (revisionCode.codes.length > 0) {
    return statusEventConflictAction({
      event: input.event,
      conflicts: input.conflicts,
      localId: null,
      codes: revisionCode.codes,
      reasons: revisionCode.reasons,
    });
  }

  return mergeAction({
    recordType: "status_event",
    externalId: input.event.externalId,
    action: "create_new",
    localId: null,
    reasons: [
      `Status event ${input.event.externalId} has no local append-only history match. status_events.jsonl remains authoritative over current_status snapshots.`,
    ],
    relatedExternalIds: {
      occurrence: input.event.occurrenceExternalId,
      behavior: input.event.behaviorExternalId,
      revisesEvent: input.event.revisesEventId,
    },
  });
}

function resolveDefinitionEventMergeAction(input: {
  event: BehaviorLogImportDefinitionEventPlan;
  context: MergePreviewContext;
  conflicts: BehaviorLogImportMergeConflict[];
  behaviorActionsByExternalId: Map<string, BehaviorLogImportMergeRecordAction>;
}): BehaviorLogImportMergeRecordAction {
  const relatedExternalIds = { behavior: input.event.behaviorExternalId };

  if (input.event.action === "skip") {
    return mergeAction({
      recordType: "behavior_definition_event",
      externalId: input.event.externalId,
      action: "skip_existing",
      localId: null,
      reasons: input.event.skipReasons,
      relatedExternalIds,
    });
  }

  const parent = input.behaviorActionsByExternalId.get(
    input.event.behaviorExternalId,
  );

  if (parent?.action === "conflict_requires_decision") {
    return conflictMergeAction({
      conflicts: input.conflicts,
      recordType: "behavior_definition_event",
      externalId: input.event.externalId,
      localId: null,
      codes: ["definition_event_parent_mapping_unresolved"],
      reasons: [
        `Definition event ${input.event.externalId} cannot be compared until behavior ${input.event.behaviorExternalId} is resolved.`,
      ],
      relatedExternalIds,
    });
  }

  if (!parent?.localId) {
    return mergeAction({
      recordType: "behavior_definition_event",
      externalId: input.event.externalId,
      action: "create_new",
      localId: null,
      reasons: ["Definition event belongs to a behavior that will be created."],
      relatedExternalIds,
    });
  }

  const mappedLocalId = input.context.mappingsByKey.get(
    mergeMappingKey("behavior_definition_event", input.event.externalId),
  );
  const existing = (input.context.existing.definitionEvents ?? []).find(
    (candidate) =>
      candidate.id === mappedLocalId ||
      candidate.id === input.event.externalId ||
      candidate.sourceOriginalId === input.event.externalId,
  );

  if (mappedLocalId && !existing) {
    return conflictMergeAction({
      conflicts: input.conflicts,
      recordType: "behavior_definition_event",
      externalId: input.event.externalId,
      localId: mappedLocalId,
      codes: ["definition_event_mapped_record_missing"],
      reasons: ["Definition-event import mapping points to a missing local record."],
      relatedExternalIds,
    });
  }

  if (existing) {
    const same =
      existing.behaviorId === parent.localId &&
      existing.recordedAtUtc === input.event.recordedAtUtc;

    if (!same) {
      return conflictMergeAction({
        conflicts: input.conflicts,
        recordType: "behavior_definition_event",
        externalId: input.event.externalId,
        localId: existing.id,
        codes: ["definition_event_identity_mismatch"],
        reasons: ["Mapped definition event has a different behavior or recorded time."],
        relatedExternalIds,
      });
    }

    return mergeAction({
      recordType: "behavior_definition_event",
      externalId: input.event.externalId,
      action: "map_to_existing",
      localId: existing.id,
      reasons: ["Definition event already exists for the mapped behavior and time."],
      relatedExternalIds,
    });
  }

  return mergeAction({
    recordType: "behavior_definition_event",
    externalId: input.event.externalId,
    action: "create_new",
    localId: null,
    reasons: ["Definition event has no local match."],
    relatedExternalIds,
  });
}

function resolveTimeSessionMergeAction(input: {
  session: BehaviorLogImportTimeSessionPlan;
  context: MergePreviewContext;
  conflicts: BehaviorLogImportMergeConflict[];
  behaviorActionsByExternalId: Map<string, BehaviorLogImportMergeRecordAction>;
  occurrenceActionsByExternalId: Map<string, BehaviorLogImportMergeRecordAction>;
}): BehaviorLogImportMergeRecordAction {
  const relatedExternalIds = {
    behavior: input.session.behaviorExternalId,
    occurrence: input.session.occurrenceExternalId,
  };

  if (input.session.action === "skip") {
    return mergeAction({
      recordType: "time_session",
      externalId: input.session.externalId,
      action: "skip_existing",
      localId: null,
      reasons: input.session.skipReasons,
      relatedExternalIds,
    });
  }

  const behavior = input.behaviorActionsByExternalId.get(
    input.session.behaviorExternalId,
  );
  const occurrence = input.occurrenceActionsByExternalId.get(
    input.session.occurrenceExternalId,
  );

  if (
    behavior?.action === "conflict_requires_decision" ||
    occurrence?.action === "conflict_requires_decision"
  ) {
    return conflictMergeAction({
      conflicts: input.conflicts,
      recordType: "time_session",
      externalId: input.session.externalId,
      localId: null,
      codes: ["time_session_parent_mapping_unresolved"],
      reasons: ["Time session cannot be compared until its parent records are resolved."],
      relatedExternalIds,
    });
  }

  if (!behavior?.localId || !occurrence?.localId) {
    return mergeAction({
      recordType: "time_session",
      externalId: input.session.externalId,
      action: "create_new",
      localId: null,
      reasons: ["Time session belongs to parent records that will be created."],
      relatedExternalIds,
    });
  }

  const mappedLocalId = input.context.mappingsByKey.get(
    mergeMappingKey("time_session", input.session.externalId),
  );
  const existing = (input.context.existing.timeSessions ?? []).find(
    (candidate) =>
      candidate.id === mappedLocalId ||
      candidate.id === input.session.externalId ||
      candidate.sourceOriginalId === input.session.externalId,
  );

  if (mappedLocalId && !existing) {
    return conflictMergeAction({
      conflicts: input.conflicts,
      recordType: "time_session",
      externalId: input.session.externalId,
      localId: mappedLocalId,
      codes: ["time_session_mapped_record_missing"],
      reasons: ["Time-session import mapping points to a missing local record."],
      relatedExternalIds,
    });
  }

  if (existing) {
    const same =
      existing.behaviorId === behavior.localId &&
      existing.occurrenceId === occurrence.localId &&
      existing.startedAtUtc === input.session.startedAtUtc &&
      existing.stoppedAtUtc === input.session.stoppedAtUtc;

    if (!same) {
      return conflictMergeAction({
        conflicts: input.conflicts,
        recordType: "time_session",
        externalId: input.session.externalId,
        localId: existing.id,
        codes: ["time_session_identity_mismatch"],
        reasons: ["Mapped time session has different parents or time bounds."],
        relatedExternalIds,
      });
    }

    return mergeAction({
      recordType: "time_session",
      externalId: input.session.externalId,
      action: "map_to_existing",
      localId: existing.id,
      reasons: ["Time session already matches the imported session."],
      relatedExternalIds,
    });
  }

  return mergeAction({
    recordType: "time_session",
    externalId: input.session.externalId,
    action: "create_new",
    localId: null,
    reasons: ["Time session has no local match."],
    relatedExternalIds,
  });
}

function resolveNoteMergeAction(input: {
  note: BehaviorLogImportNotePlan;
  context: MergePreviewContext;
  conflicts: BehaviorLogImportMergeConflict[];
  behaviorActionsByExternalId: Map<string, BehaviorLogImportMergeRecordAction>;
  occurrenceActionsByExternalId: Map<string, BehaviorLogImportMergeRecordAction>;
  statusEventActionsByExternalId: Map<string, BehaviorLogImportMergeRecordAction>;
}): BehaviorLogImportMergeRecordAction {
  const metadata = noteMergeMetadata(input.note);
  const mappedLocalId = input.context.mappingsByKey.get(
    mergeMappingKey("note", input.note.externalId),
  );
  const candidates = new Map((input.context.importedNotesByExternalId.get(input.note.externalId) ?? []).map((row) => [row.id, row]));
  const direct = input.context.importedNotesById.get(input.note.externalId);
  const mapped = mappedLocalId ? input.context.importedNotesById.get(mappedLocalId) : undefined;
  if (direct) candidates.set(direct.id, direct);
  if (mapped) candidates.set(mapped.id, mapped);
  if (candidates.size > 1) {
    return conflictMergeAction({ conflicts: input.conflicts, recordType: "note", externalId: input.note.externalId,
      localId: null, codes: ["note_identity_ambiguous"], reasons: ["The note ID or import mapping identifies different passive notes."],
      relatedExternalIds: noteRelatedExternalIds(input.note), metadata });
  }
  const targetAction = noteTargetAction(input);

  if (mappedLocalId) {
    const importedNote = input.context.importedNotesById.get(mappedLocalId);

    if (!importedNote) {
      return conflictMergeAction({
        conflicts: input.conflicts,
        recordType: "note",
        externalId: input.note.externalId,
        localId: mappedLocalId,
        codes: ["note_mapped_record_missing"],
        reasons: [
          `Existing import mapping points note ${input.note.externalId} at ${mappedLocalId}, but no imported_notes row was provided. Cadence will not reinterpret legacy occurrence-note mappings as imported-note records.`,
        ],
        relatedExternalIds: noteRelatedExternalIds(input.note),
        metadata: {
          ...metadata,
          noteDecision: "mapped_imported_note_missing",
          noteStorageDecision: "requires_imported_note_record",
        },
      });
    }

    const mismatch = compareImportedNote(input.note, importedNote, targetAction);

    if (mismatch.codes.length > 0) {
      return conflictMergeAction({
        conflicts: input.conflicts,
        recordType: "note",
        externalId: input.note.externalId,
        localId: importedNote.id,
        codes: mismatch.codes,
        reasons: mismatch.reasons,
        relatedExternalIds: noteRelatedExternalIds(input.note),
        metadata,
      });
    }

    return mergeAction({
      recordType: "note",
      externalId: input.note.externalId,
      action: "map_to_existing",
      localId: importedNote.id,
      reasons: [
        `Existing import mapping links note ${input.note.externalId} to imported note ${importedNote.id}.`,
      ],
      relatedExternalIds: noteRelatedExternalIds(input.note),
      metadata: {
        ...metadata,
        noteDecision: "already_mapped",
        noteStorageDecision: "existing_imported_note_record",
      },
    });
  }

  const existingImportedNote = candidates.values().next().value;

  if (existingImportedNote) {
    const mismatch = compareImportedNote(input.note, existingImportedNote, targetAction);

    if (mismatch.codes.length > 0) {
      return conflictMergeAction({
        conflicts: input.conflicts,
        recordType: "note",
        externalId: input.note.externalId,
        localId: existingImportedNote.id,
        codes: mismatch.codes,
        reasons: mismatch.reasons,
        relatedExternalIds: noteRelatedExternalIds(input.note),
        metadata,
      });
    }

    return mergeAction({
      recordType: "note",
      externalId: input.note.externalId,
      action: "map_to_existing",
      localId: existingImportedNote.id,
      reasons: [
        `Imported note ${input.note.externalId} already exists as passive note ${existingImportedNote.id}.`,
      ],
      relatedExternalIds: noteRelatedExternalIds(input.note),
      metadata: {
        ...metadata,
        noteDecision: "already_imported_note_record",
        noteStorageDecision: "existing_imported_note_record",
      },
    });
  }

  if (input.note.action === "skip") {
    return mergeAction({
      recordType: "note",
      externalId: input.note.externalId,
      action: "skip_existing",
      localId: null,
      reasons: noteSkipReasons(input.note),
      relatedExternalIds: noteRelatedExternalIds(input.note),
      metadata: {
        ...metadata,
        noteDecision: "skip_unsupported_note",
        noteStorageDecision: "skip_imported_note_record",
      },
    });
  }

  if (input.note.noteRole === "ai_generated") {
    return mergeAction({
      recordType: "note",
      externalId: input.note.externalId,
      action: "skip_existing",
      localId: null,
      reasons: [
        `Note ${input.note.externalId} is AI-generated and will not be imported into Cadence notes.`,
      ],
      relatedExternalIds: noteRelatedExternalIds(input.note),
      metadata: {
        ...metadata,
        noteDecision: "skip_ai_generated_note",
        noteStorageDecision: "skip_imported_note_record",
      },
    });
  }

  if (targetAction?.action === "conflict_requires_decision") {
    return conflictMergeAction({
      conflicts: input.conflicts,
      recordType: "note",
      externalId: input.note.externalId,
      localId: null,
      codes: ["note_attachment_unresolved"],
      reasons: [
        `Note ${input.note.externalId} cannot be imported until its ${input.note.attachedToType} attachment is resolved.`,
      ],
      relatedExternalIds: noteRelatedExternalIds(input.note),
      metadata,
    });
  }

  if (input.note.attachedToType === "review") {
    return importedNoteRecordAction({
      note: input.note,
      metadata,
      noteDecision: "create_imported_note_record",
      reason: `Review note ${input.note.externalId} will be stored as passive imported note history.`,
    });
  }

  if (!targetAction) {
    return conflictMergeAction({
      conflicts: input.conflicts,
      recordType: "note",
      externalId: input.note.externalId,
      localId: null,
      codes: ["note_attachment_unresolved"],
      reasons: [
        `Note ${input.note.externalId} cannot be imported because ${input.note.attachedToType} ${input.note.attachedToId} has no merge action.`,
      ],
      relatedExternalIds: noteRelatedExternalIds(input.note),
      metadata,
    });
  }

  if (input.note.attachedToType !== "occurrence") {
    return importedNoteRecordAction({
      note: input.note,
      metadata,
      targetAction,
      noteDecision: "create_imported_note_record",
      reason: `Note ${input.note.externalId} will be stored as passive imported ${input.note.attachedToType} note history.`,
    });
  }

  if (targetAction.action === "create_new") {
    return importedNoteRecordAction({
      note: input.note,
      metadata,
      targetAction,
      noteDecision: "fill_created_occurrence_note",
      reason: `Note ${input.note.externalId} will be stored as an imported note and can fill occurrence ${input.note.attachedToId} after that occurrence is created.`,
    });
  }

  if (!targetAction.localId) {
    return importedNoteRecordAction({
      note: input.note,
      metadata,
      targetAction,
      noteDecision: "skip_missing_target",
      reason: `Note ${input.note.externalId} will be stored as imported note history without a local occurrence target.`,
    });
  }

  const localOccurrence = input.context.occurrencesById.get(targetAction.localId);

  if (!localOccurrence) {
    return importedNoteRecordAction({
      note: input.note,
      metadata,
      targetAction,
      noteDecision: "target_occurrence_not_provided",
      reason: `Note ${input.note.externalId} will be stored as imported note history; local occurrence ${targetAction.localId} was not provided for safe inline-note inspection.`,
    });
  }

  if (isEmptyNoteBody(localOccurrence.note)) {
    return importedNoteRecordAction({
      note: input.note,
      metadata,
      targetAction,
      noteDecision: "fill_empty_occurrence_note",
      reason: `Note ${input.note.externalId} will be stored as an imported note and may fill empty local occurrence note ${localOccurrence.id}.`,
      localDate: localOccurrence.localDate,
      timezone: localOccurrence.timezone,
    });
  }

  if (noteBodiesEqual(localOccurrence.note, input.note.bodyMarkdown)) {
    return importedNoteRecordAction({
      note: input.note,
      metadata,
      targetAction,
      noteDecision: "note_matches_existing_occurrence_note",
      reason: `Note ${input.note.externalId} will be stored as an imported note; its body already matches local occurrence ${localOccurrence.id}.`,
      localDate: localOccurrence.localDate,
      timezone: localOccurrence.timezone,
    });
  }

  return importedNoteRecordAction({
    note: input.note,
    metadata,
    targetAction,
    noteDecision: "requires_explicit_note_replace_decision",
    reason: `Note ${input.note.externalId} will be stored as passive imported note history; local occurrence ${localOccurrence.id} has a different inline note and will not be changed without an explicit later decision.`,
    localDate: localOccurrence.localDate,
    timezone: localOccurrence.timezone,
  });
}

function noteTargetAction(input: {
  note: BehaviorLogImportNotePlan;
  behaviorActionsByExternalId: Map<string, BehaviorLogImportMergeRecordAction>;
  occurrenceActionsByExternalId: Map<string, BehaviorLogImportMergeRecordAction>;
  statusEventActionsByExternalId: Map<string, BehaviorLogImportMergeRecordAction>;
}): BehaviorLogImportMergeRecordAction | undefined {
  switch (input.note.attachedToType) {
    case "behavior":
      return input.behaviorActionsByExternalId.get(input.note.attachedToId);
    case "occurrence":
      return input.occurrenceActionsByExternalId.get(input.note.attachedToId);
    case "status_event":
      return input.statusEventActionsByExternalId.get(input.note.attachedToId);
    case "review":
      return undefined;
  }
}

function importedNoteRecordAction(input: {
  note: BehaviorLogImportNotePlan;
  metadata: Record<string, unknown>;
  targetAction?: BehaviorLogImportMergeRecordAction;
  noteDecision: string;
  reason: string;
  localDate?: string;
  timezone?: string;
}): BehaviorLogImportMergeRecordAction {
  return mergeAction({
    recordType: "note",
    externalId: input.note.externalId,
    action: "create_new",
    localId: null,
    reasons: [input.reason],
    relatedExternalIds: noteRelatedExternalIds(input.note),
    metadata: {
      ...input.metadata,
      noteDecision: input.noteDecision,
      noteStorageDecision: "create_imported_note_record",
      targetLocalId: input.targetAction?.localId ?? null,
      targetAction: input.targetAction?.action ?? null,
      localDate: input.localDate ?? null,
      timezone: input.timezone ?? null,
    },
  });
}

function noteRelatedExternalIds(
  note: BehaviorLogImportNotePlan,
): Record<string, string | null> {
  return {
    [note.attachedToType]: note.attachedToId,
  };
}

function noteSkipReasons(note: BehaviorLogImportNotePlan): string[] {
  if (note.skipReasons.length === 0) {
    return [`Note ${note.externalId} is skipped by the validated import plan.`];
  }

  return note.skipReasons.map(
    (reason) => `Note ${note.externalId} is skipped: ${reason}.`,
  );
}

function noteMergeMetadata(
  note: BehaviorLogImportNotePlan,
): Record<string, unknown> {
  const normalizedBody = normalizeNoteBody(note.bodyMarkdown) ?? note.bodyMarkdown;

  return {
    attachedToType: note.attachedToType,
    attachedToId: note.attachedToId,
    noteRole: note.noteRole,
    sensitivity: note.sensitivity,
    sourceOriginalId: note.sourceOriginalId ?? null,
    sourceCaptureMethod: note.sourceCaptureMethod,
    sourceConfidence: note.sourceConfidence,
    createdAtUtc: note.createdAtUtc,
    updatedAtUtc: note.updatedAtUtc,
    bodySha256: sha256(normalizedBody),
  };
}

function compareImportedNote(
  note: BehaviorLogImportNotePlan,
  existing: NonNullable<BehaviorLogExistingRecords["importedNotes"]>[number],
  targetAction: BehaviorLogImportMergeRecordAction | undefined,
): { codes: string[]; reasons: string[] } {
  const codes: string[] = [];
  const reasons: string[] = [];

  if (
    existing.targetType !== note.attachedToType ||
    (note.attachedToType === "review"
      ? existing.targetExternalId !== note.attachedToId || existing.targetLocalId !== null
      : !targetAction?.localId || targetAction.action === "conflict_requires_decision" || existing.targetLocalId !== targetAction.localId)
  ) {
    codes.push("note_attachment_mismatch");
    reasons.push(
      `Imported note ${note.externalId} is attached to ${note.attachedToType} ${note.attachedToId}, but existing note ${existing.id} is attached to ${existing.targetType} ${existing.targetExternalId}.`,
    );
  }

  if (existing.bodyMarkdown !== note.bodyMarkdown) {
    codes.push("note_body_mismatch");
    reasons.push(
      `Imported note ${note.externalId} content differs from existing note ${existing.id}.`,
    );
  }

  if (existing.noteRole !== note.noteRole || existing.sensitivity !== note.sensitivity ||
    (existing.sourceOriginalId ?? null) !== (note.sourceOriginalId ?? null) ||
    existing.sourceCaptureMethod !== note.sourceCaptureMethod || existing.sourceConfidence !== note.sourceConfidence ||
    existing.createdAtUtc !== note.createdAtUtc || existing.updatedAtUtc !== note.updatedAtUtc) {
    codes.push("note_provenance_mismatch");
    reasons.push(`Imported note ${note.externalId} has different recorded metadata or provenance from existing note ${existing.id}.`);
  }

  return { codes, reasons };
}

function isEmptyNoteBody(value: string | null | undefined): boolean {
  return normalizeNoteBody(value) === null;
}

function noteBodiesEqual(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  return normalizeNoteBody(left) === normalizeNoteBody(right);
}

function normalizeNoteBody(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\r\n/g, "\n").trim() ?? "";

  return normalized.length > 0 ? normalized : null;
}

function resolveInterventionMergeAction(input: {
  intervention: BehaviorLogImportInterventionPreviewPlan;
  context: MergePreviewContext;
  conflicts: BehaviorLogImportMergeConflict[];
  behaviorActionsByExternalId: Map<string, BehaviorLogImportMergeRecordAction>;
  occurrenceActionsByExternalId: Map<string, BehaviorLogImportMergeRecordAction>;
}): BehaviorLogImportMergeRecordAction {
  const mappedLocalId = input.context.mappingsByKey.get(
    mergeMappingKey("intervention", input.intervention.externalId),
  );

  const behaviorAction = input.intervention.behaviorExternalId
    ? input.behaviorActionsByExternalId.get(input.intervention.behaviorExternalId)
    : undefined;
  const occurrenceAction = input.intervention.occurrenceExternalId
    ? input.occurrenceActionsByExternalId.get(
        input.intervention.occurrenceExternalId,
      )
    : undefined;

  if (
    behaviorAction?.action === "conflict_requires_decision" ||
    occurrenceAction?.action === "conflict_requires_decision"
  ) {
    return conflictMergeAction({
      conflicts: input.conflicts,
      recordType: "intervention",
      externalId: input.intervention.externalId,
      localId: null,
      codes: ["intervention_parent_unresolved"],
      reasons: [
        `Intervention ${input.intervention.externalId} cannot be reviewed until its behavior or occurrence is resolved.`,
      ],
      relatedExternalIds: {
        behavior: input.intervention.behaviorExternalId,
        occurrence: input.intervention.occurrenceExternalId,
      },
    });
  }

  const candidates = new Map((input.context.importedInterventionsByExternalId.get(input.intervention.externalId) ?? []).map((row) => [row.id, row]));
  const direct = input.context.importedInterventionsById.get(input.intervention.externalId);
  const mapped = mappedLocalId ? input.context.importedInterventionsById.get(mappedLocalId) : undefined;
  if (direct) candidates.set(direct.id, direct);
  if (mapped) candidates.set(mapped.id, mapped);
  const relatedExternalIds = { behavior: input.intervention.behaviorExternalId, occurrence: input.intervention.occurrenceExternalId };
  if (mappedLocalId && !mapped) {
    return conflictMergeAction({ conflicts: input.conflicts, recordType: "intervention", externalId: input.intervention.externalId,
      localId: mappedLocalId, codes: ["intervention_mapped_record_missing"],
      reasons: ["The intervention mapping points to a missing passive history record."], relatedExternalIds });
  }
  if (candidates.size > 1) {
    return conflictMergeAction({ conflicts: input.conflicts, recordType: "intervention", externalId: input.intervention.externalId,
      localId: null, codes: ["intervention_identity_ambiguous"],
      reasons: ["The intervention ID or import mapping identifies different passive records."], relatedExternalIds });
  }
  const existing = candidates.values().next().value;
  if (existing) {
    const intervention = input.intervention;
    const same = behaviorAction?.localId && occurrenceAction?.localId &&
      existing.behaviorId === behaviorAction.localId && existing.occurrenceId === occurrenceAction.localId &&
      existing.interventionType === intervention.interventionType && existing.channel === intervention.channel &&
      existing.deliveryStatus === intervention.deliveryStatus && existing.scheduledSendAtUtc === intervention.scheduledSendAtUtc &&
      existing.sentAtUtc === intervention.sentAtUtc && existing.failureReason === intervention.failureReason &&
      (existing.sourceOriginalId ?? null) === (intervention.sourceOriginalId ?? null) &&
      existing.sourceCaptureMethod === intervention.sourceCaptureMethod && existing.sourceConfidence === intervention.sourceConfidence;
    if (!same) {
      return conflictMergeAction({ conflicts: input.conflicts, recordType: "intervention", externalId: intervention.externalId,
        localId: existing.id, codes: ["intervention_identity_mismatch"],
        reasons: ["The passive intervention has different mapped parents, observation content, or provenance."], relatedExternalIds });
    }
    return mergeAction({ recordType: "intervention", externalId: intervention.externalId, action: "map_to_existing", localId: existing.id,
      reasons: ["The intervention ID identifies an unchanged passive history record."], relatedExternalIds });
  }

  return mergeAction({
    recordType: "intervention",
    externalId: input.intervention.externalId,
    action: "create_new",
    localId: null,
    reasons: [
      `Intervention ${input.intervention.externalId} can be stored as passive imported intervention history without reminder delivery or provider side effects.`,
    ],
    relatedExternalIds: {
      behavior: input.intervention.behaviorExternalId,
      occurrence: input.intervention.occurrenceExternalId,
    },
    metadata: interventionMergeMetadata({
      intervention: input.intervention,
      behaviorLocalId: behaviorAction?.localId ?? null,
      occurrenceLocalId: occurrenceAction?.localId ?? null,
    }),
  });
}

function interventionMergeMetadata(input: {
  intervention: BehaviorLogImportInterventionPreviewPlan;
  behaviorLocalId: string | null;
  occurrenceLocalId: string | null;
}): Record<string, unknown> {
  return {
    interventionDecision: "store_passive_history",
    interventionType: input.intervention.interventionType,
    channel: input.intervention.channel,
    deliveryStatus: input.intervention.deliveryStatus,
    scheduledSendAtUtc: input.intervention.scheduledSendAtUtc,
    sentAtUtc: input.intervention.sentAtUtc,
    behaviorExternalId: input.intervention.behaviorExternalId,
    occurrenceExternalId: input.intervention.occurrenceExternalId,
    behaviorLocalId: input.behaviorLocalId,
    occurrenceLocalId: input.occurrenceLocalId,
    storageDecision: input.intervention.storageDecision,
  };
}

function compareBehaviorCandidate(
  behavior: BehaviorLogImportBehaviorPlan,
  existing: NonNullable<BehaviorLogExistingRecords["behaviors"]>[number],
  context: MergePreviewContext,
): { codes: string[]; reasons: string[] } {
  const codes: string[] = [];
  const reasons: string[] = [];
  const canonicalIdentityDiffers =
    behaviorIdentity(behavior.title, behaviorCategoryForIdentity(behavior)) !==
    behaviorIdentity(existing.title, existing.category ?? null);
  const cadenceDisplayCategoryDiffers =
    behavior.cadenceCategoryName !== null &&
    existing.cadenceCategoryName != null &&
    normalizeIdentity(behavior.cadenceCategoryName) !==
      normalizeIdentity(existing.cadenceCategoryName);

  if (canonicalIdentityDiffers || cadenceDisplayCategoryDiffers) {
    codes.push("behavior_identity_mismatch");
    reasons.push(
      `Behavior ${behavior.externalId} differs from local behavior ${existing.id} by title or category identity.`,
    );
  }

  if (importedBehaviorArchived(behavior) !== existingBehaviorArchived(existing)) {
    codes.push("behavior_archive_state_mismatch");
    reasons.push(
      `Behavior ${behavior.externalId} archive state differs from local behavior ${existing.id}.`,
    );
  }

  if (
    !behaviorScheduleShapesCompatible(
      context.importedSchedulesByBehaviorId.get(behavior.externalId) ?? [],
      context.schedulesByBehaviorId.get(existing.id) ?? existing.schedules ?? [],
    )
  ) {
    codes.push("behavior_schedule_shape_mismatch");
    reasons.push(
      `Behavior ${behavior.externalId} schedule shape does not match local behavior ${existing.id}.`,
    );
  }

  return { codes, reasons };
}

function compareScheduleCandidate(
  schedule: BehaviorLogImportSchedulePlan,
  existing: NonNullable<BehaviorLogExistingRecords["schedules"]>[number],
  behaviorId: string,
): { codes: string[]; reasons: string[] } {
  if (existing.behaviorId === behaviorId && schedulesMatch(schedule, existing)) {
    return { codes: [], reasons: [] };
  }

  return {
    codes: ["schedule_shape_mismatch"],
    reasons: [
      `Schedule ${schedule.externalId} differs from local schedule ${existing.id} by behavior mapping, recurrence, timezone, active dates, or slot shape.`,
    ],
  };
}

function compareOccurrenceCandidate(
  occurrence: BehaviorLogImportOccurrencePlan,
  existing: NonNullable<BehaviorLogExistingRecords["occurrences"]>[number],
  parent: { behaviorId: string; scheduleId: string | null },
): { codes: string[]; reasons: string[] } {
  if (occurrencesMatch(occurrence, existing, parent)) {
    return { codes: [], reasons: [] };
  }

  return {
    codes: ["occurrence_identity_mismatch"],
    reasons: [
      `Occurrence ${occurrence.externalId} differs from local occurrence ${existing.id} by mapped behavior, mapped schedule, scheduled_for_utc, local_date, or timezone.`,
    ],
  };
}

function compareStatusEventCandidate(
  event: BehaviorLogImportStatusEventPlan,
  existing: NonNullable<BehaviorLogExistingRecords["statusEvents"]>[number],
  parent: { occurrenceId: string; revisionTargetId: string | null },
): { codes: string[]; reasons: string[] } {
  if (
    existing.occurrenceId === parent.occurrenceId &&
    existing.recordedAtUtc === event.recordedAtUtc &&
    existing.status === event.status &&
    (existing.statusSemantics ?? event.statusSemantics) ===
      event.statusSemantics &&
    optionalStringsEqual(existing.revisesEventId ?? null, parent.revisionTargetId)
  ) {
    return { codes: [], reasons: [] };
  }

  return {
    codes: ["status_event_identity_mismatch"],
    reasons: [
      `Status event ${event.externalId} differs from local event ${existing.id} by occurrence mapping, recorded time, status, semantics, or revision target.`,
    ],
  };
}

function occurrenceConflictAction(input: {
  occurrence: BehaviorLogImportOccurrencePlan;
  conflicts: BehaviorLogImportMergeConflict[];
  localId: string | null;
  codes: string[];
  reasons: string[];
}): BehaviorLogImportMergeRecordAction {
  return conflictMergeAction({
    conflicts: input.conflicts,
    recordType: "occurrence",
    externalId: input.occurrence.externalId,
    localId: input.localId,
    codes: input.codes,
    reasons: input.reasons,
    localDate: input.occurrence.localDate,
    timezone: input.occurrence.timezone,
    relatedExternalIds: {
      behavior: input.occurrence.behaviorExternalId,
      schedule: input.occurrence.scheduleExternalId,
    },
  });
}

function statusEventConflictAction(input: {
  event: BehaviorLogImportStatusEventPlan;
  conflicts: BehaviorLogImportMergeConflict[];
  localId: string | null;
  codes: string[];
  reasons: string[];
}): BehaviorLogImportMergeRecordAction {
  return conflictMergeAction({
    conflicts: input.conflicts,
    recordType: "status_event",
    externalId: input.event.externalId,
    localId: input.localId,
    codes: input.codes,
    reasons: input.reasons,
    localDate: input.event.localDate,
    timezone: input.event.timezone,
    relatedExternalIds: {
      occurrence: input.event.occurrenceExternalId,
      behavior: input.event.behaviorExternalId,
      revisesEvent: input.event.revisesEventId,
    },
  });
}

function conflictMergeAction(input: {
  conflicts: BehaviorLogImportMergeConflict[];
  recordType: BehaviorLogImportRecordType;
  externalId: string;
  localId: string | null;
  codes: string[];
  reasons: string[];
  localDate?: string;
  timezone?: string;
  relatedExternalIds?: Record<string, string | null>;
  metadata?: Record<string, unknown>;
}): BehaviorLogImportMergeRecordAction {
  for (const [index, code] of input.codes.entries()) {
    input.conflicts.push({
      code,
      reason: input.reasons[index] ?? input.reasons[0] ?? code,
      importedRecordType: input.recordType,
      importedId: input.externalId,
      existingId: input.localId,
      localDate: input.localDate,
      timezone: input.timezone,
    });
  }

  return mergeAction({
    recordType: input.recordType,
    externalId: input.externalId,
    action: "conflict_requires_decision",
    localId: input.localId,
    conflictCodes: input.codes,
    reasons: input.reasons,
    relatedExternalIds: input.relatedExternalIds,
    metadata: input.metadata,
  });
}

function mergeAction(input: {
  recordType: BehaviorLogImportRecordType;
  externalId: string;
  action: BehaviorLogImportMergeRecordAction["action"];
  localId: string | null;
  reasons: string[];
  conflictCodes?: string[];
  relatedExternalIds?: Record<string, string | null>;
  metadata?: Record<string, unknown>;
}): BehaviorLogImportMergeRecordAction {
  return {
    recordType: input.recordType,
    externalId: input.externalId,
    action: input.action,
    localId: input.localId,
    conflictCodes: input.conflictCodes ?? [],
    reasons: input.reasons,
    relatedExternalIds: input.relatedExternalIds,
    metadata: input.metadata,
  };
}

function countMergeActions(
  actions: BehaviorLogImportMergePreview["actions"],
): BehaviorLogImportMergePreview["actionCounts"] {
  const counts: BehaviorLogImportMergePreview["actionCounts"] = {
    create_new: 0,
    map_to_existing: 0,
    skip_existing: 0,
    conflict_requires_decision: 0,
  };

  for (const group of Object.values(actions)) {
    for (const action of group) {
      counts[action.action] += 1;
    }
  }

  return counts;
}

function behaviorCategoryForIdentity(
  behavior: BehaviorLogImportBehaviorPlan,
): string | null {
  // Candidate lookup follows the authoritative BehaviorLog category. When
  // both records also carry Cadence display-category metadata,
  // compareBehaviorCandidate verifies that identity separately.
  return behavior.category;
}

function importedBehaviorArchived(
  behavior: BehaviorLogImportBehaviorPlan,
): boolean {
  return Boolean(behavior.archivedAtUtc);
}

function existingBehaviorArchived(
  behavior: NonNullable<BehaviorLogExistingRecords["behaviors"]>[number],
): boolean {
  return Boolean(behavior.archivedAt) || behavior.active === false;
}

function behaviorScheduleShapesCompatible(
  importedSchedules: BehaviorLogImportSchedulePlan[],
  existingSchedules: NonNullable<BehaviorLogExistingRecords["schedules"]>,
): boolean {
  if (importedSchedules.length === 0 || existingSchedules.length === 0) {
    return true;
  }

  return importedSchedules.every((importedSchedule) =>
    existingSchedules.some((existingSchedule) =>
      schedulesMatch(importedSchedule, existingSchedule),
    ),
  );
}

function schedulesMatch(
  imported: BehaviorLogImportSchedulePlan,
  existing: NonNullable<BehaviorLogExistingRecords["schedules"]>[number],
): boolean {
  return (
    imported.recurrenceProfile === existing.recurrenceProfile &&
    stableStringify(imported.recurrence) === stableStringify(existing.recurrence) &&
    imported.timezone === existing.timezone &&
    normalizeLocalTimeForCompare(imported.localTime) ===
      normalizeLocalTimeForCompare(existing.localTime) &&
    normalizeLocalTimeForCompare(imported.windowStartLocal) ===
      normalizeLocalTimeForCompare(existing.windowStartLocal) &&
    normalizeLocalTimeForCompare(imported.windowEndLocal) ===
      normalizeLocalTimeForCompare(existing.windowEndLocal) &&
    (imported.cadenceScheduleKind ?? null) ===
      (existing.cadenceScheduleKind ?? null) &&
    (imported.cadenceSchedulePreset ?? null) ===
      (existing.cadenceSchedulePreset ?? null) &&
    (existing.anchorLocalDate == null || existing.anchorLocalDate === (imported.anchorLocalDate ?? imported.activeFromLocalDate)) &&
    ((imported.activeFromLocalDate === existing.activeFromLocalDate &&
      optionalStringsEqual(imported.activeUntilLocalDate, existing.activeUntilLocalDate)) ||
      (existing.anchorLocalDate === (imported.anchorLocalDate ?? imported.activeFromLocalDate) &&
        existing.acceptedSourceIdentities?.includes(behaviorLogScheduleIdentity(imported)) === true))
  );
}

function historicalOccurrenceSnapshotMatches(
  importedSchedule: BehaviorLogImportSchedulePlan | undefined,
  existing: NonNullable<BehaviorLogExistingRecords["occurrences"]>[number],
): boolean {
  const snapshot = existing.scheduleSnapshot;
  return Boolean(snapshot && importedSchedule &&
    snapshot.kind === importedSchedule.cadenceScheduleKind &&
    optionalStringsEqual(snapshot.preset, importedSchedule.cadenceSchedulePreset) &&
    normalizeLocalTimeForCompare(snapshot.startTime) === normalizeLocalTimeForCompare(importedSchedule.windowStartLocal ?? importedSchedule.localTime) &&
    normalizeLocalTimeForCompare(snapshot.endTime) === normalizeLocalTimeForCompare(importedSchedule.windowEndLocal));
}

function occurrencesMatch(
  imported: BehaviorLogImportOccurrencePlan,
  existing: NonNullable<BehaviorLogExistingRecords["occurrences"]>[number],
  parent: { behaviorId: string; scheduleId: string | null },
): boolean {
  return (
    existing.behaviorId === parent.behaviorId &&
    optionalStringsEqual(existing.scheduleId, parent.scheduleId) &&
    existing.scheduledForUtc === imported.scheduledForUtc &&
    existing.localDate === imported.localDate &&
    existing.timezone === imported.timezone
  );
}

function unresolvedRevisionCode(
  event: BehaviorLogImportStatusEventPlan,
  context: MergePreviewContext,
): { codes: string[]; reasons: string[] } {
  if (!event.revisesEventId) {
    return { codes: [], reasons: [] };
  }

  const hasImportedTarget = context.existing.statusEvents?.some(
    (candidate) =>
      candidate.id === event.revisesEventId ||
      candidate.sourceOriginalId === event.revisesEventId,
  );
  const hasMappedTarget = context.mappingsByKey.has(
    mergeMappingKey("status_event", event.revisesEventId),
  );

  if (hasImportedTarget || hasMappedTarget) {
    return { codes: [], reasons: [] };
  }

  return {
    codes: ["status_event_revision_target_unresolved"],
    reasons: [
      `Status event ${event.externalId} revises ${event.revisesEventId}, but that revision target has no local mapping in the merge preview input.`,
    ],
  };
}

function localRevisionTargetId(
  event: BehaviorLogImportStatusEventPlan,
  context: MergePreviewContext,
): string | null {
  if (!event.revisesEventId) {
    return null;
  }

  return (
    context.mappingsByKey.get(
      mergeMappingKey("status_event", event.revisesEventId),
    ) ??
    context.statusEventsById.get(event.revisesEventId)?.id ??
    context.statusEventsBySourceOriginalId.get(event.revisesEventId)?.id ??
    null
  );
}

function statusEventMergeIdentity(
  occurrenceId: string,
  recordedAtUtc: string,
  status: OccurrenceStatus,
  semantics: BehaviorLogStatusSemantics | null,
  revisesEventId: string | null,
): string {
  return [
    occurrenceId,
    recordedAtUtc,
    status,
    semantics ?? "",
    revisesEventId ?? "",
  ].join("|");
}

function readPrivacySummary(
  files: BehaviorLogImportFile[],
): BehaviorLogImportMergePreview["privacy"] {
  const manifest = parseLooseJsonObject(
    files.find((file) => file.path === "manifest.json")?.content ?? null,
  );
  const privacy = isRecord(manifest?.privacy) ? manifest.privacy : null;
  const profiles = Array.isArray(manifest?.profiles)
    ? manifest.profiles.filter((profile): profile is string =>
        typeof profile === "string",
      )
    : [];
  const containsNotesFile = files.some((file) => file.path === JSONL_FILES.notes);
  const containsInterventionsFile = files.some(
    (file) => file.path === JSONL_FILES.interventions,
  );

  return {
    profiles,
    redactionLevel: readPreviewString(privacy?.redaction_level),
    subjectIdStrategy: readPreviewString(privacy?.subject_id_strategy),
    containsNotes:
      readPreviewBoolean(privacy?.contains_notes) ?? containsNotesFile,
    containsInterventions:
      profiles.includes("intervention") ||
      profiles.includes("interventions") ||
      containsInterventionsFile,
    containsRawLocation: readPreviewBoolean(privacy?.contains_raw_location),
    containsHealthData: readPreviewBoolean(privacy?.contains_health_data),
    containsAiGeneratedContent: readPreviewBoolean(
      privacy?.contains_ai_generated_content,
    ),
  };
}

function parseLooseJsonObject(content: string | null): JsonRecord | null {
  if (!content) {
    return null;
  }

  try {
    const parsed = JSON.parse(content);

    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readPreviewString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function readPreviewBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function mergeMappingKey(
  recordType: BehaviorLogImportRecordType,
  externalId: string,
): string {
  return `${recordType}:${externalId}`;
}

function optionalStringsEqual(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  return (left ?? null) === (right ?? null);
}

function normalizeLocalTimeForCompare(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  try {
    return Temporal.PlainTime.from(value).toString({ smallestUnit: "minute" });
  } catch {
    return value;
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

export function createBehaviorLogImportBundleFingerprint(
  files: BehaviorLogImportFile[],
): string {
  return sha256(
    [...files]
      .sort((left, right) => left.path.localeCompare(right.path))
      .map((file) => [file.path, sha256(file.content), ""].join("\0"))
      .join(""),
  );
}

export function createBehaviorLogImportLocalDataFingerprint(
  existing: BehaviorLogExistingRecords | undefined,
): string {
  return sha256(stableStringify(existing ?? {}));
}

function dedupeById<T extends { id: string }>(values: T[]): T[] {
  return [...new Map(values.map((value) => [value.id, value])).values()];
}

function indexByOptionalString<T>(
  values: T[],
  getKey: (value: T) => string | null | undefined,
): Map<string, T> {
  const map = new Map<string, T>();

  for (const value of values) {
    const key = getKey(value);

    if (key) {
      map.set(key, value);
    }
  }

  return map;
}

function summarizePreview(input: {
  schemaVersion: string | null;
  fileCount: number;
  plan: BehaviorLogImportPlan;
  errors: BehaviorLogImportIssue[];
  warnings: BehaviorLogImportIssue[];
  conflicts: BehaviorLogImportConflict[];
  unsupportedFields: BehaviorLogUnsupportedField[];
}): BehaviorLogImportPreview["summary"] {
  const allPlans = [
    ...input.plan.behaviors,
    ...input.plan.schedules,
    ...input.plan.occurrences,
    ...input.plan.statusEvents,
    ...(input.plan.definitionEvents ?? []),
    ...(input.plan.timeSessions ?? []),
    ...(input.plan.interventionRules ?? []),
    ...input.plan.notes,
  ];
  const interventionCounts = summarizeInterventionCounts(input.plan);
  const interventionStorageSummary = summarizeInterventionStorage(input.plan);

  return {
    schemaVersion: input.schemaVersion,
    fileCount: input.fileCount,
    behaviorCount: input.plan.behaviors.length,
    scheduleCount: input.plan.schedules.length,
    occurrenceCount: input.plan.occurrences.length,
    statusEventCount: input.plan.statusEvents.length,
    definitionEventCount: (input.plan.definitionEvents ?? []).length,
    timeSessionCount: (input.plan.timeSessions ?? []).length,
    interventionRuleCount: (input.plan.interventionRules ?? []).length,
    noteCount: input.plan.notes.length,
    interventionCount: input.plan.interventions.length,
    interventionPreviewOnlyCount: input.plan.interventions.filter(
      (intervention) => intervention.action === "preview_only",
    ).length,
    interventionStoredCount: interventionStorageSummary.storedCount,
    interventionSensitiveFieldDropCount:
      interventionStorageSummary.sensitiveFieldDropCount,
    interventionRedactedFieldCount: interventionStorageSummary.redactedFieldCount,
    interventionCounts,
    createCount: allPlans.filter((record) => record.action === "create")
      .length,
    skipCount: allPlans.filter((record) => record.action === "skip").length,
    errorCount: input.errors.length,
    warningCount: input.warnings.length,
    conflictCount: input.conflicts.length,
    unsupportedFieldCount: input.unsupportedFields.reduce(
      (count, entry) => count + entry.fields.length,
      0,
    ),
    dayGroups: summarizeDayGroups(input.plan, input.conflicts),
  };
}

function summarizeInterventionStorage(plan: BehaviorLogImportPlan): {
  storedCount: number;
  sensitiveFieldDropCount: number;
  redactedFieldCount: number;
} {
  return plan.interventions.reduce(
    (summary, intervention) => ({
      storedCount:
        intervention.storageDecision.decision === "store_passive_history"
          ? summary.storedCount + 1
          : summary.storedCount,
      sensitiveFieldDropCount:
        summary.sensitiveFieldDropCount +
        intervention.storageDecision.droppedSensitiveFields.length,
      redactedFieldCount:
        summary.redactedFieldCount +
        intervention.storageDecision.redactedFields.length,
    }),
    {
      storedCount: 0,
      sensitiveFieldDropCount: 0,
      redactedFieldCount: 0,
    },
  );
}

function summarizeInterventionCounts(
  plan: BehaviorLogImportPlan,
): BehaviorLogImportPreview["summary"]["interventionCounts"] {
  const behaviorsById = new Map(
    plan.behaviors.map((behavior) => [behavior.externalId, behavior]),
  );

  return {
    byChannel: countInterventionsBy(
      plan.interventions,
      (intervention) => intervention.channel,
    ),
    byDeliveryStatus: countInterventionsBy(
      plan.interventions,
      (intervention) => intervention.deliveryStatus,
    ),
    byBehavior: countInterventionsBy(
      plan.interventions,
      (intervention) => intervention.behaviorExternalId,
    ).map((entry) => ({
      behaviorExternalId: entry.value,
      behaviorTitle: behaviorsById.get(entry.value)?.title ?? null,
      count: entry.count,
    })),
  };
}

function countInterventionsBy<T>(
  interventions: BehaviorLogImportInterventionPreviewPlan[],
  getValue: (intervention: BehaviorLogImportInterventionPreviewPlan) => T,
): Array<{ value: T; count: number }> {
  const counts = new Map<T, number>();

  for (const intervention of interventions) {
    const value = getValue(intervention);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => String(left.value).localeCompare(String(right.value)));
}

function summarizeDayGroups(
  plan: BehaviorLogImportPlan,
  conflicts: BehaviorLogImportConflict[],
): BehaviorLogImportDayGroup[] {
  const groups = new Map<string, BehaviorLogImportDayGroup>();
  const add = (localDate: string, timezone: string) => {
    const key = `${localDate}|${timezone}`;
    const group =
      groups.get(key) ??
      ({
        localDate,
        timezone,
        occurrenceCount: 0,
        statusEventCount: 0,
        noteCount: 0,
        conflictCount: 0,
      } satisfies BehaviorLogImportDayGroup);

    groups.set(key, group);
    return group;
  };

  const occurrenceById = new Map(
    plan.occurrences.map((occurrence) => [occurrence.externalId, occurrence]),
  );

  for (const occurrence of plan.occurrences) {
    add(occurrence.localDate, occurrence.timezone).occurrenceCount += 1;
  }

  for (const event of plan.statusEvents) {
    add(event.localDate, event.timezone).statusEventCount += 1;
  }

  for (const note of plan.notes) {
    if (note.attachedToType !== "occurrence") {
      continue;
    }

    const occurrence = occurrenceById.get(note.attachedToId);

    if (occurrence) {
      add(occurrence.localDate, occurrence.timezone).noteCount += 1;
    }
  }

  for (const conflict of conflicts) {
    if (conflict.localDate && conflict.timezone) {
      add(conflict.localDate, conflict.timezone).conflictCount += 1;
    }
  }

  return [...groups.values()].sort((left, right) => {
    const dateComparison = left.localDate.localeCompare(right.localDate);

    if (dateComparison !== 0) {
      return dateComparison;
    }

    return left.timezone.localeCompare(right.timezone);
  });
}

function markDuplicateIds(
  plans: Array<{ action: string; skipReasons?: string[]; externalId: string }>,
  recordType: BehaviorLogImportConflict["importedRecordType"],
  conflicts: BehaviorLogImportConflict[],
): void {
  const seen = new Set<string>();

  for (const plan of plans) {
    if (seen.has(plan.externalId)) {
      addConflict(conflicts, {
        code: "duplicate_imported_id",
        message: `${recordType} ${plan.externalId} appears more than once in the bundle.`,
        importedRecordType: recordType,
        importedId: plan.externalId,
      });
      if (plan.skipReasons) {
        plan.action = "skip";
        plan.skipReasons.push("duplicate_imported_id");
      }
      continue;
    }

    seen.add(plan.externalId);
  }
}

function addOccurrenceConflict(
  conflicts: BehaviorLogImportConflict[],
  occurrence: BehaviorLogImportOccurrencePlan,
  code: string,
  message: string,
  existingId?: string,
): void {
  addConflict(conflicts, {
    code,
    message,
    importedRecordType: "occurrence",
    importedId: occurrence.externalId,
    existingId,
    localDate: occurrence.localDate,
    timezone: occurrence.timezone,
  });
}

function addStatusEventConflict(
  conflicts: BehaviorLogImportConflict[],
  event: BehaviorLogImportStatusEventPlan,
  code: string,
  message: string,
  existingId?: string,
): void {
  addConflict(conflicts, {
    code,
    message,
    importedRecordType: "status_event",
    importedId: event.externalId,
    existingId,
    localDate: event.localDate,
    timezone: event.timezone,
  });
}

function addConflict(
  conflicts: BehaviorLogImportConflict[],
  conflict: BehaviorLogImportConflict,
): void {
  conflicts.push(conflict);
}

function skip(
  record: { action: "create" | "skip"; skipReasons: string[] },
  reason: string,
): void {
  record.action = "skip";

  if (!record.skipReasons.includes(reason)) {
    record.skipReasons.push(reason);
  }
}

function readRequiredString(
  row: ParsedJsonlRecord,
  field: string,
  errors: BehaviorLogImportIssue[],
): string | null {
  const value = row.record[field];

  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }

  errors.push({
    severity: "error",
    code: "required_field_invalid",
    message: `${row.file} row ${row.row} requires string field ${field}.`,
    file: row.file,
    row: row.row,
  });
  return null;
}

function readOptionalString(
  row: ParsedJsonlRecord,
  field: string,
  errors: BehaviorLogImportIssue[],
): string | null {
  const value = row.record[field];

  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  errors.push({
    severity: "error",
    code: "optional_field_invalid",
    message: `${row.file} row ${row.row} field ${field} must be a string or null.`,
    file: row.file,
    row: row.row,
  });
  return null;
}

function readRequiredBoolean(
  row: ParsedJsonlRecord,
  field: string,
  errors: BehaviorLogImportIssue[],
): boolean | null {
  const value = row.record[field];

  if (typeof value === "boolean") {
    return value;
  }

  errors.push({
    severity: "error",
    code: "required_boolean_invalid",
    message: `${row.file} row ${row.row} requires boolean field ${field}.`,
    file: row.file,
    row: row.row,
  });
  return null;
}

function readOptionalInteger(
  row: ParsedJsonlRecord,
  field: string,
  errors: BehaviorLogImportIssue[],
): number | null {
  const value = row.record[field];

  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }

  errors.push({
    severity: "error",
    code: "optional_integer_invalid",
    message: `${row.file} row ${row.row} field ${field} must be an integer or null.`,
    file: row.file,
    row: row.row,
  });
  return null;
}

function readRequiredObject(
  row: ParsedJsonlRecord,
  field: string,
  errors: BehaviorLogImportIssue[],
): Record<string, unknown> | null {
  const value = row.record[field];

  if (isRecord(value)) {
    return value;
  }

  errors.push({
    severity: "error",
    code: "required_object_invalid",
    message: `${row.file} row ${row.row} requires object field ${field}.`,
    file: row.file,
    row: row.row,
  });
  return null;
}

function readRequiredInstant(
  row: ParsedJsonlRecord,
  field: string,
  errors: BehaviorLogImportIssue[],
): string | null {
  const value = readRequiredString(row, field, errors);

  return value ? normalizeInstant(value, row, field, errors) : null;
}

function readOptionalInstant(
  row: ParsedJsonlRecord,
  field: string,
  errors: BehaviorLogImportIssue[],
): string | null {
  const value = readOptionalString(row, field, errors);

  return value ? normalizeInstant(value, row, field, errors) : null;
}

function normalizeInstant(
  value: string,
  row: ParsedJsonlRecord,
  field: string,
  errors: BehaviorLogImportIssue[],
): string | null {
  try {
    return Temporal.Instant.from(value).toString();
  } catch {
    errors.push({
      severity: "error",
      code: "instant_invalid",
      message: `${row.file} row ${row.row} field ${field} must be an ISO instant.`,
      file: row.file,
      row: row.row,
    });
    return null;
  }
}

function readRequiredLocalDate(
  row: ParsedJsonlRecord,
  field: string,
  errors: BehaviorLogImportIssue[],
): string | null {
  const value = readRequiredString(row, field, errors);

  return value ? normalizeLocalDate(value, row, field, errors) : null;
}

function readOptionalLocalDate(
  row: ParsedJsonlRecord,
  field: string,
  errors: BehaviorLogImportIssue[],
): string | null {
  const value = readOptionalString(row, field, errors);

  return value ? normalizeLocalDate(value, row, field, errors) : null;
}

function normalizeLocalDate(
  value: string,
  row: ParsedJsonlRecord,
  field: string,
  errors: BehaviorLogImportIssue[],
): string | null {
  try {
    return Temporal.PlainDate.from(value).toString();
  } catch {
    errors.push({
      severity: "error",
      code: "local_date_invalid",
      message: `${row.file} row ${row.row} field ${field} must be YYYY-MM-DD.`,
      file: row.file,
      row: row.row,
    });
    return null;
  }
}

function readRequiredTimezone(
  row: ParsedJsonlRecord,
  field: string,
  errors: BehaviorLogImportIssue[],
): string | null {
  const value = readRequiredString(row, field, errors);

  if (!value) {
    return null;
  }

  try {
    TIMEZONE_VALIDATION_INSTANT.toZonedDateTimeISO(value);
    return value;
  } catch {
    errors.push({
      severity: "error",
      code: "timezone_invalid",
      message: `${row.file} row ${row.row} field ${field} must be an IANA timezone.`,
      file: row.file,
      row: row.row,
    });
    return null;
  }
}

function readOptionalTimezone(
  row: ParsedJsonlRecord,
  field: string,
  errors: BehaviorLogImportIssue[],
): string | null {
  const value = readOptionalString(row, field, errors);

  if (value === null) {
    return null;
  }

  try {
    TIMEZONE_VALIDATION_INSTANT.toZonedDateTimeISO(value);
    return value;
  } catch {
    errors.push({
      severity: "error",
      code: "timezone_invalid",
      message: `${row.file} row ${row.row} field ${field} must be an IANA timezone or null.`,
      file: row.file,
      row: row.row,
    });
    return null;
  }
}

function readOptionalLocalTime(
  row: ParsedJsonlRecord,
  field: string,
  errors: BehaviorLogImportIssue[],
): string | null {
  const value = readOptionalString(row, field, errors);

  if (!value) {
    return null;
  }

  try {
    if (!/^\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?$/.test(value)) throw new Error("Invalid local time.");
    Temporal.PlainTime.from(value);
    return value;
  } catch {
    errors.push({
      severity: "error",
      code: "local_time_invalid",
      message: `${row.file} row ${row.row} field ${field} must be HH:MM or HH:MM:SS, optionally with fractional seconds.`,
      file: row.file,
      row: row.row,
    });
    return null;
  }
}

function readRequiredStatus(
  row: ParsedJsonlRecord,
  field: string,
  errors: BehaviorLogImportIssue[],
): OccurrenceStatus | null {
  const value = readRequiredString(row, field, errors);

  if (value && isOccurrenceStatus(value)) {
    return value;
  }

  if (value) {
    errors.push({
      severity: "error",
      code: "status_invalid",
      message: `${row.file} row ${row.row} field ${field} has unsupported status ${value}.`,
      file: row.file,
      row: row.row,
    });
  }

  return null;
}

function readOptionalStatus(
  row: ParsedJsonlRecord,
  field: string,
  errors: BehaviorLogImportIssue[],
): OccurrenceStatus | null {
  const value = readOptionalString(row, field, errors);

  if (value === null) {
    return null;
  }

  if (isOccurrenceStatus(value)) {
    return value;
  }

  errors.push({
    severity: "error",
    code: "status_invalid",
    message: `${row.file} row ${row.row} field ${field} has unsupported status ${value}.`,
    file: row.file,
    row: row.row,
  });
  return null;
}

function readRequiredStatusSemantics(
  row: ParsedJsonlRecord,
  field: string,
  errors: BehaviorLogImportIssue[],
): BehaviorLogStatusSemantics | null {
  const value = readRequiredString(row, field, errors);

  if (value && isStatusSemantics(value)) {
    return value;
  }

  if (value) {
    errors.push({
      severity: "error",
      code: "status_semantics_invalid",
      message: `${row.file} row ${row.row} field ${field} has unsupported semantics ${value}.`,
      file: row.file,
      row: row.row,
    });
  }

  return null;
}

function readRequiredAttachedToType(
  row: ParsedJsonlRecord,
  field: string,
  errors: BehaviorLogImportIssue[],
): BehaviorLogImportNotePlan["attachedToType"] | null {
  const value = readRequiredString(row, field, errors);

  if (
    value === "behavior" ||
    value === "occurrence" ||
    value === "status_event" ||
    value === "review"
  ) {
    return value;
  }

  if (value) {
    errors.push({
      severity: "error",
      code: "note_target_type_invalid",
      message: `${row.file} row ${row.row} field ${field} has unsupported target type ${value}.`,
      file: row.file,
      row: row.row,
    });
  }

  return null;
}

function readRequiredNoteRole(
  row: ParsedJsonlRecord,
  field: string,
  errors: BehaviorLogImportIssue[],
): BehaviorLogImportNotePlan["noteRole"] | null {
  const value = readRequiredString(row, field, errors);

  if (
    value === "user" ||
    value === "imported" ||
    value === "system" ||
    value === "ai_generated"
  ) {
    return value;
  }

  if (value) {
    errors.push({
      severity: "error",
      code: "note_role_invalid",
      message: `${row.file} row ${row.row} field ${field} has unsupported role ${value}.`,
      file: row.file,
      row: row.row,
    });
  }

  return null;
}

function readOptionalNoteSensitivity(
  row: ParsedJsonlRecord,
  field: string,
  errors: BehaviorLogImportIssue[],
): BehaviorLogNoteSensitivity | null {
  const value = readOptionalString(row, field, errors);

  if (value === null) {
    return null;
  }

  if (
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "restricted"
  ) {
    return value;
  }

  errors.push({
    severity: "error",
    code: "note_sensitivity_invalid",
    message: `${row.file} row ${row.row} field ${field} has unsupported sensitivity ${value}.`,
    file: row.file,
    row: row.row,
  });
  return null;
}

function readRequiredInterventionChannel(
  row: ParsedJsonlRecord,
  field: string,
  schemaVersion: string | null,
  errors: BehaviorLogImportIssue[],
): BehaviorLogInterventionChannel | null {
  const value = readRequiredString(row, field, errors);

  if (value && isInterventionChannel(value) &&
    (schemaVersion !== "0.1.0-draft" || value === "browser_push" || value === "email")) {
    return value;
  }

  if (value) {
    errors.push({
      severity: "error",
      code: "intervention_channel_invalid",
      message: `${row.file} row ${row.row} field ${field} has unsupported channel ${value}.`,
      file: row.file,
      row: row.row,
    });
  }

  return null;
}

function readRequiredInterventionDeliveryStatus(
  row: ParsedJsonlRecord,
  field: string,
  schemaVersion: string | null,
  errors: BehaviorLogImportIssue[],
): BehaviorLogInterventionDeliveryStatus | null {
  const value = readRequiredString(row, field, errors);

  if (schemaVersion !== "0.1.0-draft" && value === "planned") {
    return "pending";
  }

  if (
    value &&
    isInterventionDeliveryStatus(value) &&
    (schemaVersion === "0.1.0-draft"
      ? ["pending", "sent", "failed", "cancelled"].includes(value)
      : value !== "pending")
  ) {
    return value;
  }

  if (value) {
    errors.push({
      severity: "error",
      code: "intervention_delivery_status_invalid",
      message: `${row.file} row ${row.row} field ${field} has unsupported delivery status ${value}.`,
      file: row.file,
      row: row.row,
    });
  }

  return null;
}

function readSource(
  row: ParsedJsonlRecord,
  errors: BehaviorLogImportIssue[],
  required: boolean,
): {
  captureMethod: BehaviorLogSourceCaptureMethod;
  confidence: BehaviorLogSourceConfidence;
  originalId: string | null;
} {
  const source = row.record.source;

  if (!isRecord(source)) {
    if (required) {
      errors.push({
        severity: "error",
        code: "source_invalid",
        message: `${row.file} row ${row.row} requires object field source.`,
        file: row.file,
        row: row.row,
      });
    }

    return {
      captureMethod: "unknown",
      confidence: "unknown",
      originalId: null,
    };
  }

  const captureMethod =
    typeof source.capture_method === "string" &&
    isSourceCaptureMethod(source.capture_method)
      ? source.capture_method
      : "unknown";
  const confidence =
    typeof source.confidence === "string" &&
    isSourceConfidence(source.confidence)
      ? source.confidence
      : "unknown";
  const originalId =
    typeof source.original_id === "string" && source.original_id.trim().length > 0
      ? source.original_id.trim()
      : null;

  return { captureMethod, confidence, originalId };
}

function readCadenceExtension(record: JsonRecord): JsonRecord | null {
  const extensions = record.extensions;

  if (!isRecord(extensions)) {
    return null;
  }

  const cadence = extensions[BEHAVIORLOG_EXTENSION_NAMESPACE];

  return isRecord(cadence) ? cadence : null;
}

function readArchiveNotes(
  extension: JsonRecord | null,
  row: ParsedJsonlRecord,
  errors: BehaviorLogImportIssue[],
) {
  if (!extension || !Object.hasOwn(extension, "archive_notes")) {
    return undefined;
  }

  try {
    return parseArchiveNotes(extension.archive_notes as Json);
  } catch (error) {
    errors.push({
      severity: "error",
      code: "cadence_archive_notes_invalid",
      message: `${row.file} row ${row.row}: archive_notes is invalid: ${errorMessage(error)}.`,
      file: row.file,
      row: row.row,
      path: "extensions.app.cadence.archive_notes",
    });
    return undefined;
  }
}

/**
 * End and pause under `extensions.app.cadence` (docs/EXPORT_FORMATS.md). A bundle
 * written before Ended and Paused carries `end_date`, the first day the Behavior no
 * longer ran; it reads as `end_on` the day before. Returns undefined when the bundle
 * carries none of these fields, so restore keeps the stored values.
 */
function readExtensionRun(
  extension: JsonRecord | null,
  row: ParsedJsonlRecord,
  errors: BehaviorLogImportIssue[],
): BehaviorLogImportBehaviorRun | undefined {
  const fields = ["end_on", "end_time", "pause_from_on", "pause_from_time", "pause_back_on"];
  if (!extension) return undefined;
  const hasCurrent = fields.some((field) => Object.hasOwn(extension, field));
  if (!hasCurrent) {
    const legacy = readExtensionLocalDate(extension, "end_date", row, errors);
    if (legacy === undefined) return undefined;
    return {
      endOn: legacy === null || legacy <= "0001-01-01" ? null : Temporal.PlainDate.from(legacy).subtract({ days: 1 }).toString(),
      endTime: null, pauseFromOn: null, pauseFromTime: null, pauseBackOn: null,
    };
  }
  const run: BehaviorLogImportBehaviorRun = {
    endOn: readExtensionLocalDate(extension, "end_on", row, errors) ?? null,
    endTime: readExtensionLocalTime(extension, "end_time", row, errors) ?? null,
    pauseFromOn: readExtensionLocalDate(extension, "pause_from_on", row, errors) ?? null,
    pauseFromTime: readExtensionLocalTime(extension, "pause_from_time", row, errors) ?? null,
    pauseBackOn: readExtensionLocalDate(extension, "pause_back_on", row, errors) ?? null,
  };
  const invalid = (run.endTime !== null && run.endOn === null)
    || (run.pauseFromOn === null) !== (run.pauseBackOn === null)
    || (run.pauseFromTime !== null && run.pauseFromOn === null)
    || (run.pauseFromOn !== null && run.pauseBackOn !== null && run.pauseBackOn <= run.pauseFromOn);
  if (invalid) {
    errors.push({ severity: "error", code: "cadence_run_fields_invalid",
      message: `${row.file} row ${row.row}: extensions.app.cadence end and pause fields are incomplete or out of order.`,
      file: row.file, row: row.row, path: "extensions.app.cadence" });
  }
  return run;
}

function readExtensionLocalTime(
  extension: JsonRecord,
  field: string,
  row: ParsedJsonlRecord,
  errors: BehaviorLogImportIssue[],
): string | null | undefined {
  if (!Object.hasOwn(extension, field)) return undefined;
  const value = extension[field];
  if (value === null) return null;
  if (typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d(:00)?$/.test(value)) {
    return value.length === 5 ? `${value}:00` : value;
  }
  errors.push({ severity: "error", code: `cadence_${field}_invalid`,
    message: `${row.file} row ${row.row}: extensions.app.cadence.${field} must be a local time HH:MM:00 or null.`,
    file: row.file, row: row.row, path: `extensions.app.cadence.${field}` });
  return undefined;
}

function readExtensionLocalDate(
  extension: JsonRecord | null,
  field: string,
  row: ParsedJsonlRecord,
  errors: BehaviorLogImportIssue[],
): string | null | undefined {
  if (!extension || !Object.hasOwn(extension, field)) return undefined;
  const value = extension[field];
  if (value === null) return null;
  if (typeof value === "string") {
    try {
      if (/^\d{4}-\d{2}-\d{2}$/.test(value) && value >= "0001-01-01"
        && Temporal.PlainDate.from(value).toString() === value) return value;
    } catch { /* report below */ }
  }
  errors.push({ severity: "error", code: `cadence_${field}_invalid`,
    message: `${row.file} row ${row.row}: extensions.app.cadence.${field} must be an ISO local date or null.`,
    file: row.file, row: row.row, path: `extensions.app.cadence.${field}` });
  return undefined;
}

function readExtensionInstant(
  extension: JsonRecord | null,
  field: string,
  row: ParsedJsonlRecord,
  errors: BehaviorLogImportIssue[],
): string | null | undefined {
  if (!extension || !Object.hasOwn(extension, field)) return undefined;
  const value = extension[field];
  if (value === null) return null;
  if (typeof value === "string") {
    try { return Temporal.Instant.from(value).toString(); }
    catch { /* report below */ }
  }
  errors.push({ severity: "error", code: `cadence_${field}_invalid`,
    message: `${row.file} row ${row.row}: extensions.app.cadence.${field} must be a UTC instant or null.`,
    file: row.file, row: row.row, path: `extensions.app.cadence.${field}` });
  return undefined;
}

/** `parent_behavior_id`, `sub_behavior_sort_order`, `inherit_parent_schedule`; undefined when absent. */
function readExtensionSubBehaviorLink(
  extension: JsonRecord | null,
  row: ParsedJsonlRecord,
  errors: BehaviorLogImportIssue[],
): Pick<BehaviorLogImportBehaviorPlan, "cadenceParentBehaviorExternalId" | "cadenceSubBehaviorSortOrder" | "cadenceInheritParentSchedule"> | undefined {
  if (!extension || !Object.hasOwn(extension, "parent_behavior_id")) return undefined;
  const invalid = (field: string, expected: string) => {
    errors.push({ severity: "error", code: `cadence_${field}_invalid`,
      message: `${row.file} row ${row.row}: extensions.app.cadence.${field} must be ${expected}.`,
      file: row.file, row: row.row, path: `extensions.app.cadence.${field}` });
  };
  const parent = extension.parent_behavior_id;
  if (parent !== null && (typeof parent !== "string" || parent.trim().length === 0)) {
    invalid("parent_behavior_id", "a behavior_id or null");
    return undefined;
  }
  const order = extension.sub_behavior_sort_order;
  if (order !== undefined && order !== null && (!Number.isInteger(order) || (order as number) < 0 || (order as number) > 9_999)) {
    invalid("sub_behavior_sort_order", "an integer from 0 through 9,999");
  }
  const inherit = extension.inherit_parent_schedule;
  if (inherit !== undefined && inherit !== null && typeof inherit !== "boolean") {
    invalid("inherit_parent_schedule", "true or false");
  }
  const parentId = typeof parent === "string" ? parent.trim() : null;
  return {
    cadenceParentBehaviorExternalId: parentId,
    cadenceSubBehaviorSortOrder: parentId && Number.isInteger(order) ? order as number : 0,
    cadenceInheritParentSchedule: parentId ? (typeof inherit === "boolean" ? inherit : true) : false,
  };
}

/**
 * Sub-behaviors stay one level deep. A self link, a parent that is itself a
 * sub-behavior (which includes every cycle) is an error. A parent missing from the bundle
 * imports the Behavior on its own. Parents are ordered before their sub-behaviors so
 * every write can name its parent.
 */
function validateSubBehaviorLinks(input: {
  plan: BehaviorLogImportPlan;
  errors: BehaviorLogImportIssue[];
  warnings: BehaviorLogImportIssue[];
}): void {
  const byId = new Map(input.plan.behaviors.map((behavior) => [behavior.externalId, behavior]));
  for (const behavior of input.plan.behaviors) {
    const parentId = behavior.cadenceParentBehaviorExternalId;
    if (!parentId) continue;
    const parent = byId.get(parentId);
    const fail = (code: string, message: string) => input.errors.push({
      severity: "error", code, message, file: JSONL_FILES.behaviors,
      path: "extensions.app.cadence.parent_behavior_id",
    });
    if (parentId === behavior.externalId) {
      fail("cadence_sub_behavior_self_parent", `Behavior ${behavior.externalId} names itself as its parent Behavior.`);
    } else if (!parent) {
      input.warnings.push({
        severity: "warning",
        code: "cadence_sub_behavior_parent_missing",
        message: `Behavior ${behavior.externalId} names parent Behavior ${parentId}, which is not in this bundle. Cadence imports it on its own.`,
        file: JSONL_FILES.behaviors,
      });
      behavior.cadenceParentBehaviorExternalId = null;
      behavior.cadenceSubBehaviorSortOrder = 0;
      behavior.cadenceInheritParentSchedule = false;
    } else if (parent.cadenceParentBehaviorExternalId) {
      fail("cadence_sub_behavior_depth", `Behavior ${behavior.externalId} is under ${parentId}, which is itself a sub-behavior. Sub-behaviors are one level deep.`);
    }
  }
  const depth = (behavior: BehaviorLogImportBehaviorPlan) => behavior.cadenceParentBehaviorExternalId ? 1 : 0;
  input.plan.behaviors.sort((left, right) => depth(left) - depth(right));
}

function readExtensionString(
  extension: JsonRecord | null,
  field: string,
): string | null {
  const value = extension?.[field];

  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function readExtensionBoolean(
  extension: JsonRecord | null,
  field: string,
): boolean | null {
  const value = extension?.[field];

  return typeof value === "boolean" ? value : null;
}

function readCadenceScheduleImportRole(
  extension: JsonRecord | null,
): BehaviorLogImportSchedulePlan["cadenceImportRole"] {
  const value = extension?.import_role;

  return value === "current_configuration" ||
    value === "historical_reference_only"
    ? value
    : null;
}

function readExtensionInteger(
  extension: JsonRecord | null,
  field: string,
): number | null {
  const value = extension?.[field];

  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function readExtensionScheduleKind(
  extension: JsonRecord | null,
  field: string,
): BehaviorLogImportSchedulePlan["cadenceScheduleKind"] {
  const value = extension?.[field];

  return value === "exact" || value === "range" ? value : null;
}

function readExtensionSchedulePreset(
  extension: JsonRecord | null,
  field: string,
): BehaviorLogImportSchedulePlan["cadenceSchedulePreset"] {
  const value = extension?.[field];

  return isCadenceRangePreset(value) ? value : null;
}

function isSupportedRecurrence(recurrence: Record<string, unknown>): boolean {
  switch (recurrence.type) {
    case "daily":
      return isPositiveInteger(recurrence.interval);
    case "every_n_days":
      return isPositiveInteger(recurrence.interval);
    case "weekly_on_weekdays":
      return isWeekdayArray(recurrence.weekdays);
    case "every_n_weeks_on_weekdays":
      return (
        isPositiveInteger(recurrence.interval) &&
        isWeekdayArray(recurrence.weekdays)
      );
    case "monthly_on_day":
      return (
        isPositiveInteger(recurrence.interval) &&
        isPositiveInteger(recurrence.day) &&
        recurrence.day <= 31 &&
        (recurrence.fallback === undefined ||
          recurrence.fallback === "last_day_of_month")
      );
    default:
      return false;
  }
}

function isSupportedScheduleSlot(
  schedule: BehaviorLogImportSchedulePlan,
): boolean {
  if (schedule.windowStartLocal || schedule.windowEndLocal) {
    return Boolean(schedule.windowStartLocal && schedule.windowEndLocal);
  }

  return schedule.localTime !== null;
}

function cadencePresetForRange(
  startTime: string,
  endTime: string,
): BehaviorLogImportSchedulePlan["cadenceSchedulePreset"] {
  return (
    CADENCE_RANGE_PRESETS.find(
      (preset) => preset.start === startTime && preset.end === endTime,
    )?.preset ?? null
  );
}

function isOccurrenceStatus(value: string): value is OccurrenceStatus {
  return (
    value === "unresolved" ||
    value === "completed" ||
    value === "not_completed"
  );
}

function isStatusSemantics(value: string): value is BehaviorLogStatusSemantics {
  return (
    value === "explicit_user_mark" ||
    value === "explicit_user_correction" ||
    value === "imported_explicit" ||
    value === "system_rule_declared" ||
    value === "ambiguous_import"
  );
}

function isInterventionChannel(
  value: string,
): value is BehaviorLogInterventionChannel {
  return BEHAVIORLOG_INTERVENTION_CHANNELS.some((channel) => channel === value);
}

function isInterventionDeliveryStatus(
  value: string,
): value is BehaviorLogInterventionDeliveryStatus {
  return BEHAVIORLOG_INTERVENTION_DELIVERY_STATUSES.some((status) => status === value);
}

function isSourceCaptureMethod(
  value: string,
): value is BehaviorLogSourceCaptureMethod {
  return (
    value === "manual_tap" ||
    value === "manual_text" ||
    value === "system_generated" ||
    value === "imported" ||
    value === "inferred" ||
    value === "derived" ||
    value === "ai_generated" ||
    value === "unknown"
  );
}

function isSourceConfidence(value: string): value is BehaviorLogSourceConfidence {
  return (
    value === "high" ||
    value === "medium" ||
    value === "low" ||
    value === "ambiguous" ||
    value === "unknown"
  );
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isWeekdayArray(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0 && value.every(isWeekday);
}

function isWeekday(value: unknown): boolean {
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

function isCadenceRangePreset(
  value: unknown,
): value is BehaviorLogImportSchedulePlan["cadenceSchedulePreset"] {
  return (
    value === "morning" ||
    value === "afternoon" ||
    value === "evening" ||
    value === "night"
  );
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordIdForUnsupportedField(record: JsonRecord): string | null {
  for (const key of [
    "behavior_id",
    "schedule_id",
    "occurrence_id",
    "event_id",
    "note_id",
    "intervention_id",
  ]) {
    const value = record[key];

    if (typeof value === "string") {
      return value;
    }
  }

  return null;
}

function groupBy<T>(
  values: T[],
  getKey: (value: T) => string,
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();

  for (const value of values) {
    const key = getKey(value);
    const group = grouped.get(key) ?? [];
    group.push(value);
    grouped.set(key, group);
  }

  return grouped;
}

function compareStatusEventPlans(
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

function behaviorIdentity(title: string, category: string | null): string {
  return `${normalizeIdentity(title)}|${normalizeIdentity(category ?? "")}`;
}

function occurrenceIdentity(input: {
  behaviorTitle: string;
  scheduledForUtc: string;
  localDate: string;
  timezone: string;
}): string {
  return [
    normalizeIdentity(input.behaviorTitle),
    input.scheduledForUtc,
    input.localDate,
    input.timezone,
  ].join("|");
}

function statusEventIdentity(
  occurrenceId: string,
  recordedAtUtc: string,
  status: OccurrenceStatus,
): string {
  return `${occurrenceId}|${recordedAtUtc}|${status}`;
}

function normalizeIdentity(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}


function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
