import { createHash } from "node:crypto";

import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";

import {
  resolveBehaviorLogImportMergePreview,
  resolveBehaviorLogImportPreview,
} from "../lib/resolvers/behaviorlog-import.resolver";
import { resolveExportBundle } from "../lib/resolvers/export.resolver";
import { resolveBehaviorLogRestorePreview } from "../lib/resolvers/behaviorlog-restore.resolver";
import { buildRestorePayload, restoredOccurrenceOrigin } from "@cadence/core/services/behaviorlog-restore-plan";
import type { BehaviorLogExistingRecords } from "@cadence/core/types/behaviorlog-import";
import { previewBehaviorLogImportFromZip } from "../lib/services/behaviorlog-import.service";
import { createStoredZip } from "../lib/services/zip";
import type { BehaviorLogFile } from "../lib/types/export";
import type {
  ExportBehaviorConfigurationEventInput,
  ExportBehaviorInput,
  ExportCategoryInput,
  ExportOccurrenceInput,
  ExportReminderDeliveryInput,
  ExportStatusEventInput,
  ExportTimeSessionInput,
} from "../lib/types/export";
import { DEFAULT_TIMEZONE } from "../lib/types/recurrence";

const NOW = Temporal.Instant.from("2026-06-08T16:00:00Z");

const categories: ExportCategoryInput[] = [
  {
    id: "category-grooming",
    name: "Grooming",
    sortOrder: 1,
  },
];

function behavior(
  overrides: Partial<ExportBehaviorInput> = {},
): ExportBehaviorInput {
  return {
    id: "behavior-brush",
    categoryId: "category-grooming",
    categoryName: "Grooming",
    title: "Brush teeth",
    description: "Night brushing",
    recurrenceRule: {
      frequency: "daily",
      interval: 1,
    },
    scheduledTime: "22:00",
    scheduleSlots: [
      {
        id: "slot-brush",
        kind: "exact",
        preset: null,
        startTime: "22:00",
        endTime: null,
        sortOrder: 0,
        label: "10:00 PM",
      },
    ],
    timezone: DEFAULT_TIMEZONE,
    browserReminderEnabled: true,
    emailReminderEnabled: false,
    reminderOffsetMinutes: 0,
    active: true,
    archivedAt: null,
    createdAt: "2026-05-01T12:00:00Z",
    updatedAt: "2026-05-01T12:00:00Z",
    ...overrides,
  };
}

function occurrence(
  overrides: Partial<ExportOccurrenceInput> = {},
): ExportOccurrenceInput {
  return {
    id: "occurrence-1",
    behaviorId: "behavior-brush",
    behaviorScheduleSlotId: "slot-brush",
    scheduledFor: "2026-06-08T13:00:00Z",
    scheduledTimeLabel: "9:00 AM",
    scheduleKind: "exact",
    schedulePreset: null,
    scheduleStartTime: "09:00",
    scheduleEndTime: null,
    localDate: "2026-06-08",
    status: "not_completed",
    completedAt: null,
    statusMarkedAt: "2026-06-08T14:10:00Z",
    note: "Skipped before work.",
    createdAt: "2026-06-08T12:00:00Z",
    updatedAt: "2026-06-08T14:10:00Z",
    ...overrides,
  };
}

function statusEvents(
  overrides: Partial<ExportStatusEventInput>[] = [],
): ExportStatusEventInput[] {
  const events: ExportStatusEventInput[] = [
    {
      id: "event-1",
      occurrenceId: "occurrence-1",
      behaviorId: "behavior-brush",
      previousStatus: "unresolved",
      status: "completed",
      statusSemantics: "explicit_user_mark",
      recordedAt: "2026-06-08T13:05:00Z",
      effectiveAt: "2026-06-08T13:05:00Z",
      localDate: "2026-06-08",
      timezone: DEFAULT_TIMEZONE,
      sourceCaptureMethod: "manual_tap",
      sourceConfidence: "high",
      revisesEventId: null,
      reasonCode: null,
    },
    {
      id: "event-2",
      occurrenceId: "occurrence-1",
      behaviorId: "behavior-brush",
      previousStatus: "completed",
      status: "not_completed",
      statusSemantics: "explicit_user_correction",
      recordedAt: "2026-06-08T14:10:00Z",
      effectiveAt: "2026-06-08T14:10:00Z",
      localDate: "2026-06-08",
      timezone: DEFAULT_TIMEZONE,
      sourceCaptureMethod: "manual_tap",
      sourceConfidence: "medium",
      revisesEventId: "event-1",
      reasonCode: "user_correction",
    },
  ];

  return events.map((event, index) => ({
    ...event,
    ...overrides[index],
  }));
}

function reminderDelivery(
  overrides: Partial<ExportReminderDeliveryInput> = {},
): ExportReminderDeliveryInput {
  return {
    id: "delivery-1",
    occurrenceId: "occurrence-1",
    channel: "email",
    scheduledSendAt: "2026-06-08T12:45:00Z",
    sentAt: "2026-06-08T12:46:00Z",
    status: "sent",
    error: null,
    processingStartedAt: "2026-06-08T12:45:01Z",
    createdAt: "2026-06-08T12:00:00Z",
    updatedAt: "2026-06-08T12:46:00Z",
    ...overrides,
  };
}

function bundleFiles(input: {
  behaviors?: ExportBehaviorInput[];
  behaviorConfigurationEvents?: ExportBehaviorConfigurationEventInput[];
  occurrences?: ExportOccurrenceInput[];
  statusEvents?: ExportStatusEventInput[];
  reminderDeliveries?: ExportReminderDeliveryInput[];
  timeSessions?: ExportTimeSessionInput[];
  includeArchived?: boolean;
} = {}): BehaviorLogFile[] {
  return resolveExportBundle({
    profile: {
      timezone: DEFAULT_TIMEZONE,
      subjectId: "subject_test",
    },
    categories,
    behaviors: input.behaviors ?? [behavior()],
    behaviorConfigurationEvents: input.behaviorConfigurationEvents,
    occurrences: input.occurrences ?? [occurrence()],
    statusEvents: input.statusEvents ?? statusEvents(),
    reminderDeliveries: input.reminderDeliveries,
    timeSessions: input.timeSessions,
    now: NOW,
    timezone: DEFAULT_TIMEZONE,
    range: "30",
    includeArchived: input.includeArchived,
    includeNotes: true,
    includeTimeTracking: Boolean(input.timeSessions),
  }).behaviorLog.files;
}

function historicalSelfExport() {
  const morning = { id: "slot-brush", kind: "exact" as const, preset: null,
    startTime: "09:00", endTime: null, sortOrder: 0, label: "9:00 AM" };
  const evening = { ...morning, id: "slot-evening", startTime: "17:00", sortOrder: 1, label: "5:00 PM" };
  const previous = { categoryId: "category-grooming", scheduleGraph: [{
    recurrenceRule: { frequency: "daily" as const, interval: 1 }, sortOrder: 0, timeEntries: [morning] }],
    browserReminderEnabled: true, emailReminderEnabled: false, reminderOffsetMinutes: 0, active: true, timezone: DEFAULT_TIMEZONE };
  const baseline: ExportBehaviorConfigurationEventInput = { id: "config-morning", behaviorId: "behavior-brush", eventKind: "baseline",
    previousConfiguration: null, nextConfiguration: previous, changedFields: ["schedule_graph"],
    recordedAt: "2026-05-01T12:00:00Z", effectiveAt: "2026-05-01T12:00:00Z", effectiveLocalDate: "2026-05-01",
    timezone: DEFAULT_TIMEZONE, source: "system", reasonCode: "history_capture_started" };
  const files = bundleFiles({ behaviors: [behavior({ scheduleSlots: [morning, evening], scheduledTime: "09:00" })],
    behaviorConfigurationEvents: [baseline, { ...baseline, id: "config-two-times", eventKind: "revision",
      previousConfiguration: previous, nextConfiguration: { ...previous, scheduleGraph: [{ ...previous.scheduleGraph[0], timeEntries: [morning, evening] }] },
      recordedAt: "2026-06-08T15:00:00Z", effectiveAt: "2026-06-08T15:00:00Z", effectiveLocalDate: "2026-06-08", source: "manual" }],
    occurrences: [occurrence({ behaviorConfigurationEventId: baseline.id })],
    timeSessions: [{ id: "session-historical", occurrenceId: "occurrence-1", behaviorId: "behavior-brush",
      startedAt: "2026-06-08T13:00:00Z", stoppedAt: "2026-06-08T13:01:00Z" }] });
  const imported = resolveBehaviorLogImportPreview({ files });
  const existing = {
    behaviors: [{ ...imported.plan.behaviors[0], id: "behavior-brush", active: true }],
    schedules: imported.plan.schedules.filter((schedule) => schedule.action === "create").map((schedule) => ({
      ...schedule, id: schedule.localTime === "09:00" ? morning.id : evening.id, behaviorId: "behavior-brush" })),
    occurrences: [{ id: "occurrence-1", behaviorId: "behavior-brush", scheduleId: morning.id,
      scheduledForUtc: "2026-06-08T13:00:00Z", localDate: "2026-06-08", timezone: DEFAULT_TIMEZONE,
      status: "not_completed" as const, note: "Skipped before work.",
      scheduleSnapshot: { kind: "exact" as const, preset: null, startTime: "09:00:00", endTime: null } }],
    statusEvents: statusEvents().map((event) => ({ ...event, recordedAtUtc: event.recordedAt })),
    timeSessions: [{ id: "session-historical", occurrenceId: "occurrence-1", behaviorId: "behavior-brush",
      startedAtUtc: "2026-06-08T13:00:00Z", stoppedAtUtc: "2026-06-08T13:01:00Z" }],
  };
  return { files, existing };
}

describe("historical schedule merge identity", () => {
  it("maps the same saved Occurrence after adding a current slot, preserving status and timing parents", () => {
    const { files, existing } = historicalSelfExport();
    const preview = resolveBehaviorLogImportMergePreview({ files, existing });
    expect(preview.plan.occurrences[0].importWithDetachedScheduleSnapshot).toBe(true);
    expect(preview.mergePreview.conflictCodes).toEqual([]);
    expect(preview.mergePreview.actions.occurrences[0]).toMatchObject({ action: "map_to_existing", localId: "occurrence-1" });
    expect(preview.mergePreview.actions.statusEvents.map((action) => [action.action, action.localId])).toEqual([
      ["skip_existing", "event-1"], ["skip_existing", "event-2"],
    ]);
    expect(preview.mergePreview.actions.timeSessions?.[0]).toMatchObject({ action: "map_to_existing", localId: "session-historical" });
  });

  it("does not merge an unrelated attached Occurrence at the same instant", () => {
    const { files, existing } = historicalSelfExport();
    existing.occurrences[0].id = "another-occurrence";
    const preview = resolveBehaviorLogImportMergePreview({ files, existing: { ...existing, statusEvents: [], timeSessions: [] } });
    expect(preview.mergePreview.actions.occurrences[0]).toMatchObject({ action: "create_new", localId: null });
  });

  it.each(["mapping", "source"])("preserves an explicit %s to a differently named local Occurrence", (identity) => {
    const { files, existing } = historicalSelfExport();
    existing.occurrences[0].id = "local-occurrence";
    if (identity === "source") Object.assign(existing.occurrences[0], { sourceOriginalId: "occurrence-1" });
    for (const event of existing.statusEvents) event.occurrenceId = "local-occurrence";
    existing.timeSessions[0].occurrenceId = "local-occurrence";
    const preview = resolveBehaviorLogImportMergePreview({ files, existing: { ...existing,
      mappings: identity === "mapping" ? [{ recordType: "occurrence", externalId: "occurrence-1", localId: "local-occurrence" }] : [],
    } });
    expect(preview.mergePreview.conflictCodes).toEqual([]);
    expect(preview.mergePreview.actions.occurrences[0]).toMatchObject({ action: "map_to_existing", localId: "local-occurrence" });
  });

  it.each(["behavior", "time", "date", "timezone", "kind", "preset", "start", "end", "missing snapshot"])("rejects explicit historical identity with different %s", (field) => {
    const { files, existing } = historicalSelfExport();
    const candidate = existing.occurrences[0];
    if (field === "behavior") candidate.behaviorId = "another-behavior";
    if (field === "time") candidate.scheduledForUtc = "2026-06-08T14:00:00Z";
    if (field === "date") candidate.localDate = "2026-06-07";
    if (field === "timezone") candidate.timezone = "America/Los_Angeles";
    if (field === "kind") Object.assign(candidate.scheduleSnapshot, { kind: "range" });
    if (field === "preset") Object.assign(candidate.scheduleSnapshot, { preset: "morning" });
    if (field === "start") candidate.scheduleSnapshot.startTime = "10:00:00";
    if (field === "end") Object.assign(candidate.scheduleSnapshot, { endTime: "11:00:00" });
    if (field === "missing snapshot") Reflect.deleteProperty(candidate, "scheduleSnapshot");
    const preview = resolveBehaviorLogImportMergePreview({ files, existing });
    expect(preview.mergePreview.conflictCodes).toContain("occurrence_identity_mismatch");
  });
});

describe("resolveBehaviorLogImportPreview", () => {
  it("round-trips Cadence archive history and rejects malformed extension entries", () => {
    const archiveNotes = [{
      id: "11111111-1111-4111-8111-111111111111",
      archivedAt: "2026-06-01T12:00:00Z",
      note: "Paused while traveling.",
      updatedAt: "2026-06-01T12:00:00Z",
    }];
    const files = bundleFiles({ includeArchived: true, behaviors: [behavior({
      archiveNotes,
      defaultDurationMinutes: 45,
      endOn: "2026-05-31",
      autoArchivedAt: "2026-06-01T12:00:00Z",
      active: false,
      archivedAt: "2026-06-01T12:00:00Z",
    })] });
    const preview = resolveBehaviorLogImportPreview({ files });

    expect(preview.valid).toBe(true);
    expect(preview.plan.behaviors[0].cadenceArchiveNotes).toEqual(archiveNotes);
    expect(preview.plan.behaviors[0]).toMatchObject({
      expectedDurationMinutes: 45,
      cadenceRun: { endOn: "2026-05-31", endTime: null, pauseFromOn: null, pauseFromTime: null, pauseBackOn: null },
      cadenceAutoArchivedAt: "2026-06-01T12:00:00Z",
    });

    const invalid = replaceJsonlRecords(files, "data/behaviors.jsonl", (records) =>
      records.map((record) => ({
        ...record,
        extensions: { "app.cadence": { ...(record.extensions as Record<string, Record<string, unknown>>)["app.cadence"], archive_notes: [{ ...archiveNotes[0], id: "not-a-uuid" }] } },
      })),
    );
    expect(resolveBehaviorLogImportPreview({ files: invalid }).errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "cadence_archive_notes_invalid" })]),
    );

    const invalidFields = replaceJsonlRecords(files, "data/behaviors.jsonl", (records) =>
      records.map((record) => ({
        ...record,
        archived_at_utc: null,
        expected_duration_minutes: 0,
        extensions: {
          "app.cadence": {
            ...(record.extensions as Record<string, Record<string, unknown>>)["app.cadence"],
            end_on: "2026-02-30",
          },
        },
      })),
    );
    expect(resolveBehaviorLogImportPreview({ files: invalidFields }).errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "behavior_expected_duration_invalid" }),
        expect.objectContaining({ code: "cadence_end_on_invalid" }),
        expect.objectContaining({ code: "cadence_auto_archived_at_without_archive" }),
      ]),
    );
  });

  it("round-trips an arbitrary range as a custom range slot", () => {
    const preview = resolveBehaviorLogImportPreview({
      files: bundleFiles({
        behaviors: [
          behavior({
            scheduleSlots: [
              {
                id: "slot-brush",
                kind: "range",
                preset: null,
                startTime: "07:15",
                endTime: "09:40",
                sortOrder: 0,
                label: "7:15–9:40 AM",
              },
            ],
          }),
        ],
        occurrences: [
          occurrence({
            scheduleKind: "range",
            scheduleStartTime: "07:15",
            scheduleEndTime: "09:40",
          }),
        ],
      }),
    });

    expect(preview.valid).toBe(true);
    expect(preview.plan.schedules).toEqual([
      expect.objectContaining({
        cadenceScheduleKind: "range",
        cadenceSchedulePreset: null,
        windowStartLocal: "07:15",
        windowEndLocal: "09:40",
      }),
    ]);
  });

  it("plans canonical time sessions for replay", () => {
    const preview = resolveBehaviorLogImportPreview({
      files: bundleFiles({
        timeSessions: [
          {
            id: "session-1",
            occurrenceId: "occurrence-1",
            behaviorId: "behavior-brush",
            startedAt: "2026-06-08T13:00:00Z",
            stoppedAt: null,
          },
        ],
      }),
    });

    expect(preview.valid).toBe(true);
    expect(preview.plan.timeSessions).toEqual([
      expect.objectContaining({
        action: "create",
        externalId: "session-1",
        occurrenceExternalId: "occurrence-1",
        behaviorExternalId: "behavior-brush",
        startedAtUtc: "2026-06-08T13:00:00Z",
        stoppedAtUtc: null,
      }),
    ]);
    expect(preview.summary.timeSessionCount).toBe(1);
  });

  it("rejects an altered canonical timing file through its manifest hash", () => {
    const files = replaceFileContent(
      bundleFiles({
        timeSessions: [
          {
            id: "session-1",
            occurrenceId: "occurrence-1",
            behaviorId: "behavior-brush",
            startedAt: "2026-06-08T13:00:00Z",
            stoppedAt: null,
          },
        ],
      }),
      "data/time_sessions.jsonl",
      '{"record_type":"occurrence_time_session"}',
      { updateManifestHash: false },
    );
    const preview = resolveBehaviorLogImportPreview({ files });

    expect(preview.valid).toBe(false);
    expect(preview.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "manifest_hash_mismatch" }),
        expect.objectContaining({ code: "record_type_invalid" }),
      ]),
    );
  });

  it("warns when a canonical timing file is absent from the manifest", () => {
    const files = removeManifestEntry(
      bundleFiles({
        timeSessions: [
          {
            id: "session-1",
            occurrenceId: "occurrence-1",
            behaviorId: "behavior-brush",
            startedAt: "2026-06-08T13:00:00Z",
            stoppedAt: null,
          },
        ],
      }),
      "data/time_sessions.jsonl",
    );
    const preview = resolveBehaviorLogImportPreview({ files });

    expect(preview.valid).toBe(true);
    expect(preview.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "file_not_listed",
          file: "data/time_sessions.jsonl",
        }),
      ]),
    );
  });

  it("validates and plans a dry-run from an exported BehaviorLog zip", () => {
    const zip = createStoredZip(bundleFiles());
    const preview = previewBehaviorLogImportFromZip({ zip });

    expect(preview.valid).toBe(true);
    expect(preview.summary).toMatchObject({
      schemaVersion: "0.3.0-draft",
      behaviorCount: 1,
      scheduleCount: 1,
      occurrenceCount: 1,
      statusEventCount: 2,
      noteCount: 1,
      errorCount: 0,
      conflictCount: 0,
    });
    expect(preview.plan.occurrences[0]).toMatchObject({
      externalId: "occurrence-1",
      currentStatus: "not_completed",
      localDate: "2026-06-08",
      timezone: DEFAULT_TIMEZONE,
      action: "create",
    });
    expect(preview.plan.statusEvents[1]).toMatchObject({
      externalId: "event-2",
      status: "not_completed",
      statusSemantics: "explicit_user_correction",
      sourceCaptureMethod: "manual_tap",
      sourceConfidence: "medium",
      revisesEventId: "event-1",
      reasonCode: "user_correction",
    });
    expect(preview.summary.dayGroups).toEqual([
      {
        localDate: "2026-06-08",
        timezone: DEFAULT_TIMEZONE,
        occurrenceCount: 1,
        statusEventCount: 2,
        noteCount: 1,
        conflictCount: 0,
      },
    ]);
  });

  it("reports manifest hash mismatches and actionable JSONL parse rows", () => {
    const files = replaceFileContent(
      bundleFiles(),
      "data/status_events.jsonl",
      '{"record_type":"status_event"',
      { updateManifestHash: false },
    );
    const preview = resolveBehaviorLogImportPreview({ files });

    expect(preview.valid).toBe(false);
    expect(preview.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "manifest_hash_mismatch",
          path: "data/status_events.jsonl",
        }),
        expect.objectContaining({
          code: "jsonl_parse_error",
          file: "data/status_events.jsonl",
          row: 1,
        }),
      ]),
    );
  });

  it("detects likely local conflicts without mutating the import records", () => {
    const preview = resolveBehaviorLogImportPreview({
      files: bundleFiles(),
      existing: {
        behaviors: [
          {
            id: "local-behavior",
            title: "Brush teeth",
            category: "hygiene",
          },
        ],
        occurrences: [
          {
            id: "local-occurrence",
            behaviorId: "local-behavior",
            behaviorTitle: "Brush teeth",
            scheduledForUtc: "2026-06-08T13:00:00Z",
            localDate: "2026-06-08",
            timezone: DEFAULT_TIMEZONE,
            status: "completed",
          },
        ],
        statusEvents: [
          {
            id: "local-event",
            occurrenceId: "occurrence-1",
            behaviorId: "behavior-brush",
            recordedAtUtc: "2026-06-08T13:05:00Z",
            status: "completed",
          },
        ],
      },
    });

    expect(preview.valid).toBe(true);
    expect(preview.conflicts.map((conflict) => conflict.code)).toEqual(
      expect.arrayContaining([
        "likely_existing_behavior",
        "likely_existing_occurrence",
        "likely_existing_status_event",
      ]),
    );
    expect(preview.plan.behaviors[0]).toMatchObject({
      action: "skip",
      skipReasons: ["likely_existing_behavior"],
    });
    expect(preview.plan.occurrences[0].skipReasons).toEqual(
      expect.arrayContaining([
        "parent_behavior_skipped",
        "likely_existing_occurrence",
      ]),
    );
    expect(preview.plan.statusEvents[0].skipReasons).toEqual(
      expect.arrayContaining([
        "parent_occurrence_skipped",
        "likely_existing_status_event",
      ]),
    );
  });

  it("treats current_status as a snapshot instead of synthesizing history", () => {
    const files = replaceFileContent(
      bundleFiles({
        occurrences: [
          occurrence({
            status: "completed",
            completedAt: "2026-06-08T13:05:00Z",
            statusMarkedAt: "2026-06-08T13:05:00Z",
          }),
        ],
        statusEvents: [],
      }),
      "data/status_events.jsonl",
      "",
    );
    const preview = resolveBehaviorLogImportPreview({ files });

    expect(preview.valid).toBe(true);
    expect(preview.summary.statusEventCount).toBe(0);
    expect(preview.plan.occurrences[0]).toMatchObject({
      currentStatus: "completed",
      action: "create",
    });
    expect(preview.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "resolved_snapshot_without_history",
          file: "data/occurrences.jsonl",
        }),
      ]),
    );
  });

  it("previews optional intervention profile records during dry-run import", () => {
    const files = bundleFiles({
      reminderDeliveries: [reminderDelivery()],
    });
    const preview = resolveBehaviorLogImportPreview({ files });
    const manifest = JSON.parse(
      files.find((file) => file.path === "manifest.json")?.content ?? "{}",
    );
    const interventionFile = files.find(
      (file) => file.path === "data/interventions.jsonl",
    );
    const interventionEntry = manifest.files.find(
      (entry: Record<string, unknown>) =>
        entry.path === "data/interventions.jsonl",
    );

    expect(interventionFile).toBeDefined();
    expect(interventionEntry).toMatchObject({
      required: false,
      sha256: sha256(interventionFile?.content ?? ""),
    });
    expect(preview.valid).toBe(true);
    expect(preview.summary).toMatchObject({
      behaviorCount: 1,
      scheduleCount: 1,
      occurrenceCount: 1,
      statusEventCount: 2,
      noteCount: 1,
      interventionCount: 1,
      interventionPreviewOnlyCount: 1,
      interventionStoredCount: 1,
      interventionSensitiveFieldDropCount: 0,
      interventionRedactedFieldCount: 0,
      errorCount: 0,
    });
    expect(preview.plan.interventions[0]).toMatchObject({
      action: "preview_only",
      previewOnly: true,
      externalId: "delivery-1",
      behaviorExternalId: "behavior-brush",
      occurrenceExternalId: "occurrence-1",
      channel: "email",
      deliveryStatus: "sent",
    });
  });

  it("rejects unsupported top-level fields in core records", () => {
    const files = replaceJsonlRecords(
      bundleFiles(),
      "data/behaviors.jsonl",
      (records) =>
        records.map((record) => ({
          ...record,
          unknown_top_level_field: true,
        })),
    );
    const preview = resolveBehaviorLogImportPreview({ files });

    expect(preview.valid).toBe(false);
    expect(preview.summary.unsupportedFieldCount).toBe(1);
    expect(preview.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "unsupported_top_level_field",
          file: "data/behaviors.jsonl",
          row: 1,
        }),
      ]),
    );
    expect(preview.unsupportedFields).toEqual([
      expect.objectContaining({
        file: "data/behaviors.jsonl",
        row: 1,
        fields: ["unknown_top_level_field"],
      }),
    ]);
  });

  it("skips intervention rules that schedule after an occurrence", () => {
    const files = replaceJsonlRecords(
      bundleFiles(),
      "data/intervention_rules.jsonl",
      (records) =>
        records.map((record) => ({
          ...record,
          offset_minutes: 15,
        })),
    );
    const preview = resolveBehaviorLogImportPreview({ files });

    expect(preview.valid).toBe(true);
    expect(preview.plan.interventionRules).toHaveLength(2);
    expect(preview.plan.interventionRules).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "skip",
        offsetMinutes: 15,
        skipReasons: ["positive_offset_after_occurrence"],
      }),
    ]));
    expect(preview.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "intervention_rule_positive_offset_unmappable",
          file: "data/intervention_rules.jsonl",
        }),
      ]),
    );
  });

  it("distinguishes absent intervention rules from a present empty file", () => {
    const files = bundleFiles();
    const absent = resolveBehaviorLogImportPreview({
      files: removeManifestEntry(files, "data/intervention_rules.jsonl").filter(
        (file) => file.path !== "data/intervention_rules.jsonl",
      ),
    });
    const empty = resolveBehaviorLogImportPreview({
      files: replaceFileContent(files, "data/intervention_rules.jsonl", ""),
    });

    expect(absent.valid).toBe(true);
    expect(absent.plan.interventionRules).toBeUndefined();
    expect(empty.valid).toBe(true);
    expect(empty.plan.interventionRules).toEqual([]);
  });

  it("creates stable preview bindings and changes them when bundle or local data changes", () => {
    const files = bundleFiles();
    const base = resolveBehaviorLogImportMergePreview({
      files,
      existing: { mappings: [] },
    });
    const reordered = resolveBehaviorLogImportMergePreview({
      files: [...files].reverse(),
      existing: { mappings: [] },
    });
    const alteredBundle = resolveBehaviorLogImportMergePreview({
      files: replaceFileContent(
        files,
        "data/behaviors.jsonl",
        JSON.stringify({
          ...parseJsonl(
            files.find((file) => file.path === "data/behaviors.jsonl")
              ?.content ?? "",
          )[0],
          description: "Changed after preview.",
        }),
      ),
      existing: { mappings: [] },
    });
    const changedLocalData = resolveBehaviorLogImportMergePreview({
      files,
      existing: {
        mappings: [
          {
            recordType: "behavior",
            externalId: "behavior-brush",
            localId: "local-behavior",
          },
        ],
      },
    });

    expect(reordered).toMatchObject({
      bundleFingerprint: base.bundleFingerprint,
      localDataFingerprint: base.localDataFingerprint,
      previewFingerprint: base.previewFingerprint,
    });
    expect(alteredBundle.bundleFingerprint).not.toBe(base.bundleFingerprint);
    expect(alteredBundle.previewFingerprint).not.toBe(base.previewFingerprint);
    expect(changedLocalData.bundleFingerprint).toBe(base.bundleFingerprint);
    expect(changedLocalData.localDataFingerprint).not.toBe(
      base.localDataFingerprint,
    );
    expect(changedLocalData.previewFingerprint).not.toBe(
      base.previewFingerprint,
    );
  });
});

function replaceJsonlRecords(
  files: BehaviorLogFile[],
  path: string,
  update: (records: Array<Record<string, unknown>>) => Array<Record<string, unknown>>,
): BehaviorLogFile[] {
  const file = files.find((entry) => entry.path === path);
  const records = parseJsonl(file?.content ?? "");

  return replaceFileContent(
    files,
    path,
    update(records)
      .map((record) => JSON.stringify(record))
      .join("\n"),
  );
}

function replaceFileContent(
  files: BehaviorLogFile[],
  path: string,
  content: string,
  options: { updateManifestHash?: boolean } = {},
): BehaviorLogFile[] {
  const cloned = files.map((file) => ({ ...file }));
  const target = cloned.find((file) => file.path === path);

  if (!target) {
    throw new Error(`Missing fixture file ${path}.`);
  }

  target.content = content;

  if (options.updateManifestHash === false) {
    return cloned;
  }

  const manifestFile = cloned.find((file) => file.path === "manifest.json");

  if (!manifestFile) {
    throw new Error("Missing fixture manifest.");
  }

  const manifest = JSON.parse(manifestFile.content);
  manifest.files = manifest.files.map((entry: Record<string, unknown>) =>
    entry.path === path ? { ...entry, sha256: sha256(content) } : entry,
  );
  manifestFile.content = JSON.stringify(manifest, null, 2);

  return cloned;
}

function removeManifestEntry(
  files: BehaviorLogFile[],
  path: string,
): BehaviorLogFile[] {
  return files.map((file) => {
    if (file.path !== "manifest.json") {
      return { ...file };
    }

    const manifest = JSON.parse(file.content);
    manifest.files = manifest.files.filter(
      (entry: Record<string, unknown>) => entry.path !== path,
    );

    return { ...file, content: JSON.stringify(manifest, null, 2) };
  });
}

function parseJsonl(content: string): Array<Record<string, unknown>> {
  return content
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

describe("BehaviorLog round trip for Behaviors of Opportunity", () => {
  const walk = behavior({
    id: "behavior-walk", title: "Walk", recurrenceRule: null, scheduledTime: null,
    schedules: [], scheduleSlots: [], isOpportunity: true,
  });
  const addedWalk = occurrence({
    id: "occurrence-walk", behaviorId: "behavior-walk", behaviorScheduleSlotId: null,
    status: "unresolved", completedAt: null, statusMarkedAt: null, note: null,
    origin: "opportunity", addedBy: "chat",
  });
  const files = () => bundleFiles({
    behaviors: [behavior(), walk],
    occurrences: [occurrence({ origin: "scheduled", addedBy: null }), addedWalk],
    statusEvents: statusEvents(),
  });

  it("exports the flag, no schedule, and the Occurrence provenance", () => {
    const read = (path: string) => files().find((file) => file.path === path)!.content.trim().split("\n").map((line) => JSON.parse(line));
    const behaviorRow = read("data/behaviors.jsonl").find((row) => row.behavior_id === "behavior-walk");
    expect(behaviorRow.extensions["app.cadence"].is_opportunity).toBe(true);
    const occurrenceRow = read("data/occurrences.jsonl").find((row) => row.occurrence_id === "occurrence-walk");
    expect(occurrenceRow.extensions["app.cadence"]).toMatchObject({ origin: "opportunity", added_by: "chat" });
    const schedule = read("data/schedules.jsonl").find((row) => row.schedule_id === occurrenceRow.schedule_id);
    expect(schedule.schedule_role).toBe("historical_reference");
  });

  it("imports the flag and provenance back, and keeps the Behavior without a schedule", () => {
    const preview = resolveBehaviorLogImportPreview({ files: files() });
    expect(preview.errors).toEqual([]);
    const plannedWalk = preview.plan.behaviors.find((row) => row.externalId === "behavior-walk");
    expect(plannedWalk).toMatchObject({ action: "create", cadenceIsOpportunity: true });
    expect(preview.plan.occurrences.find((row) => row.externalId === "occurrence-walk"))
      .toMatchObject({ cadenceOrigin: "opportunity", cadenceAddedBy: "chat", importWithDetachedScheduleSnapshot: true });
    expect(preview.plan.occurrences.find((row) => row.externalId === "occurrence-1"))
      .toMatchObject({ cadenceOrigin: "scheduled", cadenceAddedBy: null });
  });

  it("reports an origin that does not name who added it", () => {
    const source = files();
    const occurrences = source.find((file) => file.path === "data/occurrences.jsonl")!.content;
    const broken = replaceFileContent(source, "data/occurrences.jsonl", occurrences.replace('"added_by":"chat"', '"added_by":null'));
    expect(resolveBehaviorLogImportPreview({ files: broken }).errors.map(({ code }) => code))
      .toContain("cadence_occurrence_origin_invalid");
  });
});

describe("BehaviorLog restore payload for Behaviors of Opportunity", () => {
  const walk = behavior({
    id: "behavior-walk", title: "Walk", recurrenceRule: null, scheduledTime: null,
    schedules: [], scheduleSlots: [], isOpportunity: true,
  });
  const addedWalk = (extra: Partial<ExportOccurrenceInput> = {}) => occurrence({
    id: "occurrence-walk", behaviorId: "behavior-walk", behaviorScheduleSlotId: null,
    status: "unresolved", completedAt: null, statusMarkedAt: null, note: null, ...extra,
  });
  const payloadFor = (occurrences: ExportOccurrenceInput[], existing: BehaviorLogExistingRecords = {}) => {
    const importPreview = resolveBehaviorLogImportPreview({ files: bundleFiles({ behaviors: [walk], occurrences, statusEvents: [] }) });
    const preview = resolveBehaviorLogRestorePreview({ importPreview, existing });
    return buildRestorePayload({ userId: "11111111-1111-4111-8111-111111111111", importRunId: "run-1",
      importPreview, preview, existing, now: "2026-06-08T16:00:00Z" }).payload;
  };

  it("sends the flag, no schedule, and the added Occurrence's origin", () => {
    const payload = payloadFor([addedWalk({ origin: "opportunity", addedBy: "daily_brief" })]);
    expect(payload.behaviors[0]).toMatchObject({ is_opportunity: true, recurrence_rule: null, scheduled_time: null });
    expect(payload.occurrences[0]).toMatchObject({ origin: "opportunity", added_by: "daily_brief" });
  });

  it("keeps an existing added Occurrence added when an older bundle carries no origin", () => {
    const planned = resolveBehaviorLogImportPreview({ files: bundleFiles({ behaviors: [walk], occurrences: [addedWalk()], statusEvents: [] }) })
      .plan.occurrences[0]!;
    const existingRow = { id: "o", behaviorId: "behavior-walk", scheduledForUtc: "2026-06-08T13:00:00Z", localDate: "2026-06-08",
      timezone: DEFAULT_TIMEZONE, status: "unresolved" as const };
    expect(planned.cadenceOrigin).toBeUndefined();
    expect(restoredOccurrenceOrigin(planned, { ...existingRow, origin: "opportunity", addedBy: "mcp" }))
      .toEqual({ origin: "opportunity", added_by: "mcp" });
    expect(restoredOccurrenceOrigin(planned, { ...existingRow, origin: "scheduled", addedBy: null }))
      .toEqual({ origin: "scheduled", added_by: null });
    expect(restoredOccurrenceOrigin({ ...planned, cadenceOrigin: "opportunity", cadenceAddedBy: "user" }, { ...existingRow, origin: "opportunity", addedBy: "mcp" }))
      .toEqual({ origin: "opportunity", added_by: "user" });
  });

  it("sends scheduled with nobody for a bundle that predates origin", () => {
    const payload = payloadFor([addedWalk()]);
    expect(payload.occurrences[0]).toMatchObject({ origin: "scheduled", added_by: null });
  });
});
