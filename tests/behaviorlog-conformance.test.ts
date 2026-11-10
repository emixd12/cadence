import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";

import behaviorLogSchema from "../packages/core/src/behaviorlog.schema.json";
import { resolveBehaviorLogImportPreview } from "../lib/resolvers/behaviorlog-import.resolver";
import { resolveExportBundle } from "../lib/resolvers/export.resolver";
import { previewBehaviorLogImportFromZip } from "../lib/services/behaviorlog-import.service";
import { createStoredZip } from "../lib/services/zip";
import type {
  BehaviorLogFile,
  ExportBehaviorConfigurationEventInput,
  ExportBehaviorInput,
  ExportBehaviorDefinitionEventInput,
  ExportCategoryInput,
  ExportDayNoteInput,
  ExportOccurrenceInput,
  ExportReminderDeliveryInput,
  ExportStatusEventInput,
  ExportTimeSessionInput,
} from "../lib/types/export";
import { DEFAULT_TIMEZONE } from "../lib/types/recurrence";

const NOW = Temporal.Instant.from("2026-06-08T16:00:00Z");

const REQUIRED_CORE_FILES = [
  "manifest.json",
  "schema.json",
  "README.md",
  "AGENTS.md",
  "data/behaviors.jsonl",
  "data/schedules.jsonl",
  "data/occurrences.jsonl",
  "data/status_events.jsonl",
] as const;
const CADENCE_DEFINITION_HISTORY_PATH =
  "data/behavior_definition_events.jsonl";
const CADENCE_CONFIGURATION_HISTORY_PATH =
  "raw/cadence/behavior_configuration_events.jsonl";

const CORE_STATUSES = new Set(["unresolved", "completed", "not_completed"]);
const OCCURRENCE_STATES = new Set(["active", "cancelled"]);

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
  "scheduled_for_utc",
  "configuration_event_id",
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

type JsonRecord = Record<string, unknown>;

const categories: ExportCategoryInput[] = [
  {
    id: "category-grooming",
    name: "Grooming",
    sortOrder: 1,
    createdAt: "2026-05-01T12:00:00Z",
    updatedAt: "2026-05-01T12:00:00Z",
  },
];

function conformanceBehavior(): ExportBehaviorInput {
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
    emailReminderEnabled: true,
    reminderOffsetMinutes: 0,
    active: true,
    archivedAt: null,
    createdAt: "2026-05-01T12:00:00Z",
    updatedAt: "2026-05-01T12:00:00Z",
  };
}

function conformanceOccurrences(): ExportOccurrenceInput[] {
  return [
    {
      id: "occurrence-1",
      behaviorId: "behavior-brush",
      behaviorScheduleSlotId: "slot-brush",
      behaviorConfigurationEventId: "configuration-brush-initial",
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
    },
    {
      id: "occurrence-2",
      behaviorId: "behavior-brush",
      behaviorScheduleSlotId: "slot-brush",
      behaviorConfigurationEventId: "configuration-brush-initial",
      scheduledFor: "2026-06-08T15:00:00Z",
      scheduledTimeLabel: "9:00 AM",
      scheduleKind: "exact",
      schedulePreset: null,
      scheduleStartTime: "09:00",
      scheduleEndTime: null,
      localDate: "2026-06-08",
      status: "unresolved",
      completedAt: null,
      statusMarkedAt: null,
      note: null,
      createdAt: "2026-06-08T12:00:00Z",
      updatedAt: "2026-06-08T12:00:00Z",
    },
  ];
}

function conformanceBehaviorDefinitionEvents(): ExportBehaviorDefinitionEventInput[] {
  return [
    {
      id: "definition-brush-initial",
      behaviorId: "behavior-brush",
      previousTitle: null,
      nextTitle: "Brush teeth",
      previousDescription: null,
      nextDescription: "Night brushing",
      changedFields: ["title", "description"],
      recordedAt: "2026-05-01T12:00:00Z",
      source: "system",
      reason: "baseline_backfill",
      createdAt: "2026-05-01T12:00:00Z",
      updatedAt: "2026-05-01T12:00:00Z",
    },
  ];
}

function conformanceBehaviorConfigurationEvents(): ExportBehaviorConfigurationEventInput[] {
  return [
    {
      id: "configuration-brush-initial",
      behaviorId: "behavior-brush",
      eventKind: "baseline",
      previousConfiguration: null,
      nextConfiguration: {
        categoryId: "category-grooming",
        scheduleGraph: [
          {
            recurrenceRule: { frequency: "daily", interval: 1 },
            sortOrder: 0,
            timeEntries: [
              {
                kind: "exact",
                preset: null,
                startTime: "09:00",
                endTime: null,
                sortOrder: 0,
              },
            ],
          },
        ],
        browserReminderEnabled: true,
        emailReminderEnabled: false,
        reminderOffsetMinutes: 0,
        active: true,
        timezone: DEFAULT_TIMEZONE,
      },
      changedFields: [
        "category_id",
        "schedule_graph",
        "browser_reminder_enabled",
        "email_reminder_enabled",
        "reminder_offset_minutes",
        "active",
        "timezone",
      ],
      recordedAt: "2026-05-01T12:00:00Z",
      effectiveAt: "2026-05-01T12:00:00Z",
      effectiveLocalDate: "2026-05-01",
      timezone: DEFAULT_TIMEZONE,
      source: "system",
      reasonCode: "history_capture_started",
    },
  ];
}

function conformanceStatusEvents(): ExportStatusEventInput[] {
  return [
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
}

function conformanceReminderDeliveries(): ExportReminderDeliveryInput[] {
  return [
    {
      id: "delivery-planned",
      occurrenceId: "occurrence-2",
      channel: "browser_push",
      scheduledSendAt: "2026-06-08T14:30:00Z",
      sentAt: null,
      status: "pending",
      error: null,
      processingStartedAt: null,
      createdAt: "2026-06-08T12:00:00Z",
      updatedAt: "2026-06-08T12:00:00Z",
    },
    {
      id: "delivery-1",
      occurrenceId: "occurrence-1",
      channel: "email",
      scheduledSendAt: "2026-06-08T12:30:00Z",
      sentAt: "2026-06-08T12:31:00Z",
      status: "sent",
      error: null,
      processingStartedAt: "2026-06-08T12:30:01Z",
      createdAt: "2026-06-08T12:00:00Z",
      updatedAt: "2026-06-08T12:31:00Z",
    },
  ];
}

function resolveConformanceBundle(input: {
  includeTimeTracking?: boolean;
  timeSessions?: ExportTimeSessionInput[];
  includeNotes?: boolean;
  dayNotes?: ExportDayNoteInput[];
} = {}) {
  return resolveExportBundle({
    profile: {
      timezone: DEFAULT_TIMEZONE,
      subjectId: "subject_test",
      producerName: "Cadence Tracker",
      producerVersion: "0.1.0",
    },
    categories,
    behaviors: [conformanceBehavior()],
    behaviorDefinitionEvents: conformanceBehaviorDefinitionEvents(),
    behaviorConfigurationEvents: conformanceBehaviorConfigurationEvents(),
    occurrences: conformanceOccurrences(),
    statusEvents: conformanceStatusEvents(),
    reminderDeliveries: conformanceReminderDeliveries(),
    now: NOW,
    timezone: DEFAULT_TIMEZONE,
    range: "all",
    includeNotes: input.includeNotes ?? false,
    includeTimeTracking: input.includeTimeTracking,
    timeSessions: input.timeSessions,
    dayNotes: input.dayNotes,
  }).behaviorLog;
}

describe("BehaviorLog core conformance", () => {
  it("includes day notes in Full JSON only when notes are included and inside the range", () => {
    const base = {
      profile: { timezone: DEFAULT_TIMEZONE, subjectId: "subject_test", producerName: "Cadence Tracker", producerVersion: "0.1.0" },
      categories, behaviors: [conformanceBehavior()], occurrences: conformanceOccurrences(), now: NOW, timezone: DEFAULT_TIMEZONE,
      dayNotes: [
        { id: "60000000-0000-4000-8000-000000000001", localDate: "2026-06-07", note: "Sick", createdAt: "2026-06-07T12:00:00Z", updatedAt: "2026-06-07T12:00:00Z" },
        { id: "60000000-0000-4000-8000-000000000004", localDate: "2026-01-02", note: "Old", createdAt: "2026-01-02T12:00:00Z", updatedAt: "2026-01-02T12:00:00Z" },
      ],
    };
    expect(resolveExportBundle({ ...base, range: "all", includeNotes: false }).jsonBackup.day_notes).toBeUndefined();
    expect(resolveExportBundle({ ...base, range: "all", includeNotes: true }).jsonBackup.day_notes?.map((note) => note.note)).toEqual(["Old", "Sick"]);
    expect(resolveExportBundle({ ...base, range: 30, includeNotes: true }).jsonBackup.day_notes).toEqual([{
      id: "60000000-0000-4000-8000-000000000001", local_date: "2026-06-07", note: "Sick",
      created_at: "2026-06-07T12:00:00Z", updated_at: "2026-06-07T12:00:00Z",
    }]);
  });

  it("exports day notes as one-day user reviews that pass the reference validator", async () => {
    const dayNotes: ExportDayNoteInput[] = [
      { id: "60000000-0000-4000-8000-000000000002", localDate: "2026-06-08", note: "Travel day", createdAt: "2026-06-08T12:00:00Z", updatedAt: "2026-06-08T13:00:00Z" },
      { id: "60000000-0000-4000-8000-000000000001", localDate: "2026-06-07", note: "Sick", createdAt: "2026-06-07T12:00:00Z", updatedAt: "2026-06-07T12:00:00Z" },
      { id: "60000000-0000-4000-8000-000000000003", localDate: "2026-06-06", note: null, createdAt: "2026-06-06T12:00:00Z", updatedAt: "2026-06-06T12:30:00Z" },
    ];
    expect(resolveConformanceBundle({ includeNotes: false, dayNotes }).files.some((file) => file.path === "data/reviews.jsonl")).toBe(false);
    const bundle = resolveConformanceBundle({ includeNotes: true, dayNotes });
    const filesByPath = new Map(bundle.files.map((file) => [file.path, file]));
    const reviews = parseJsonl(filesByPath.get("data/reviews.jsonl")?.content ?? "");
    expect(reviews.map((review) => review.summary_markdown)).toEqual(["Sick", "Travel day"]);
    expect(reviews[0]).toMatchObject({
      record_type: "review", review_id: "60000000-0000-4000-8000-000000000001",
      period_start_local_date: "2026-06-07", period_end_local_date: "2026-06-07", review_role: "user",
      extensions: { "app.cadence": { day_note: true } },
    });
    const manifest = parseJson(filesByPath.get("manifest.json")?.content ?? "");
    expect(manifest.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "data/reviews.jsonl", schema_ref: "#/$defs/Review" }),
    ]));
    expect(resolveBehaviorLogImportPreview({ files: bundle.files }).valid).toBe(true);

    const { root, bundlePath } = await writeBehaviorLogDirectory(bundle.files);
    try {
      const result = spawnSync(process.execPath, ["scripts/behaviorlog-conformance.mjs", bundlePath], { cwd: process.cwd(), encoding: "utf8" });
      expect(result.status, result.stderr || result.stdout).toBe(0);
      expect(result.stdout).toContain("BehaviorLog bundle valid:");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("exports standard time tracking with matching privacy and profile declarations", async () => {
    const bundle = resolveConformanceBundle({
      includeTimeTracking: true,
      timeSessions: [
        {
          id: "session-1",
          occurrenceId: "occurrence-1",
          behaviorId: "behavior-brush",
          startedAt: "2026-06-08T13:00:00Z",
          stoppedAt: null,
        },
      ],
    });
    const filesByPath = new Map(bundle.files.map((file) => [file.path, file]));
    const manifest = parseJson(filesByPath.get("manifest.json")?.content ?? "");
    const timingPath = "data/time_sessions.jsonl";
    const timingFile = filesByPath.get(timingPath);

    expect(timingFile?.content).toContain('"record_type":"time_session"');
    expect(timingFile?.content).toContain('"started_at_utc"');
    expect(timingFile?.content).not.toContain("duration_seconds");
    expect(manifest.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: timingPath,
          required: false,
          schema_ref: "#/$defs/TimeSession",
        }),
      ]),
    );
    expect(manifest.privacy).toMatchObject({ contains_time_tracking: true });
    expect(manifest.profiles).toContain("time_tracking");
    expect(bundle.files.some((file) => file.path.includes("occurrence_time_sessions"))).toBe(false);
    expect(resolveBehaviorLogImportPreview({ files: bundle.files }).valid).toBe(
      true,
    );
    expect(
      previewBehaviorLogImportFromZip({ zip: createStoredZip(bundle.files) })
        .valid,
    ).toBe(true);

    const { root, bundlePath } = await writeBehaviorLogDirectory(bundle.files);

    try {
      const result = spawnSync(
        process.execPath,
        ["scripts/behaviorlog-conformance.mjs", bundlePath],
        { cwd: process.cwd(), encoding: "utf8" },
      );

      expect(result.status, result.stderr || result.stdout).toBe(0);
      expect(result.stdout).toContain("BehaviorLog bundle valid:");
      expect(result.stderr).not.toContain("Warnings:");
      expect(result.stderr).not.toContain("Warnings:");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("materializes Cadence output and passes the upstream reference validator snapshot", async () => {
    const bundle = resolveConformanceBundle();
    const { root, bundlePath } = await writeBehaviorLogDirectory(bundle.files);

    try {
      const result = spawnSync(
        process.execPath,
        ["scripts/behaviorlog-conformance.mjs", bundlePath],
        {
          cwd: process.cwd(),
          encoding: "utf8",
        },
      );

      expect(result.status, result.stderr || result.stdout).toBe(0);
      expect(result.stdout).toContain("BehaviorLog bundle valid:");

      const preview = resolveBehaviorLogImportPreview({ files: bundle.files });

      expect(preview.valid, JSON.stringify(preview.errors, null, 2)).toBe(true);
      expect(preview.summary).toMatchObject({
        schemaVersion: "0.3.0-draft",
        behaviorCount: 1,
        scheduleCount: 1,
        occurrenceCount: 2,
        statusEventCount: 2,
        noteCount: 0,
        errorCount: 0,
        unsupportedFieldCount: 0,
      });
      expect(bundle.files.map((file) => file.path)).toContain(
        "data/interventions.jsonl",
      );
      expect(bundle.files.map((file) => file.path)).toContain(
        "data/intervention_rules.jsonl",
      );
      expect(bundle.files.map((file) => file.path)).toContain(
        CADENCE_DEFINITION_HISTORY_PATH,
      );
      expect(bundle.files.map((file) => file.path)).toContain(
        CADENCE_CONFIGURATION_HISTORY_PATH,
      );
      expect(
        bundle.files
          .map((file) => file.path)
          .filter((path) => path.startsWith("raw/cadence/")),
      ).toEqual([CADENCE_CONFIGURATION_HISTORY_PATH]);
      expect(preview.unsupportedFields).toEqual([]);
      expect(
        bundle.files.find((file) => file.path === "schema.json")?.content,
      ).toBe(`${JSON.stringify(behaviorLogSchema, null, 2)}\n`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("satisfies Level 1 core record, reference, status, and extension checks", () => {
    const bundle = resolveConformanceBundle();
    const fileByPath = new Map(bundle.files.map((file) => [file.path, file]));
    const manifest = parseJson(fileByPath.get("manifest.json")?.content ?? "");
    const behaviors = parseJsonl(
      fileByPath.get("data/behaviors.jsonl")?.content ?? "",
    );
    const schedules = parseJsonl(
      fileByPath.get("data/schedules.jsonl")?.content ?? "",
    );
    const occurrences = parseJsonl(
      fileByPath.get("data/occurrences.jsonl")?.content ?? "",
    );
    const statusEvents = parseJsonl(
      fileByPath.get("data/status_events.jsonl")?.content ?? "",
    );
    const interventions = parseJsonl(
      fileByPath.get("data/interventions.jsonl")?.content ?? "",
    );
    const interventionRules = parseJsonl(
      fileByPath.get("data/intervention_rules.jsonl")?.content ?? "",
    );

    for (const path of REQUIRED_CORE_FILES) {
      expect(fileByPath.has(path), `${path} should be emitted`).toBe(true);
    }

    expect(manifest).toMatchObject({
      format: "behaviorlog.bundle",
      schema_version: "0.3.0-draft",
      profiles: ["core", "intervention", "definition_history", "configuration_history"],
      rules: expect.objectContaining({
        definition_history_policy: "event_sourced",
      }),
    });

    const manifestFiles = readManifestFiles(manifest);

    for (const entry of manifestFiles) {
      const file = fileByPath.get(entry.path);

      expect(file, `${entry.path} should exist`).toBeDefined();
      expect(entry.sha256).toBe(sha256(file?.content ?? ""));
    }

    expect(
      manifestFiles.find(
        (entry) => entry.path === CADENCE_DEFINITION_HISTORY_PATH,
      ),
    ).toMatchObject({
      path: CADENCE_DEFINITION_HISTORY_PATH,
      required: false,
    });
    expect(
      parseJsonl(
        fileByPath.get(CADENCE_DEFINITION_HISTORY_PATH)?.content ?? "",
      ),
    ).toEqual([
      expect.objectContaining({
        record_type: "behavior_definition_event",
        event_id: "definition-brush-initial",
        behavior_id: "behavior-brush",
        event_kind: "baseline",
        previous: null,
        next: {
          title: "Brush teeth",
          description: "Night brushing",
        },
        changed_fields: ["title", "description"],
      }),
    ]);

    expectUniqueIds(behaviors, "behavior_id");
    expectUniqueIds(schedules, "schedule_id");
    expectUniqueIds(occurrences, "occurrence_id");
    expectUniqueIds(statusEvents, "event_id");
    expectUniqueIds(interventionRules, "rule_id");
    const interventionRuleIds = new Set(
      interventionRules.map((rule) => String(rule.rule_id)),
    );
    expect(interventions.every((record) => record.rule_id == null ||
      interventionRuleIds.has(String(record.rule_id)))).toBe(true);
    expectNoUnknownTopLevelFields(behaviors, BEHAVIOR_FIELDS);
    expectNoUnknownTopLevelFields(schedules, SCHEDULE_FIELDS);
    expectNoUnknownTopLevelFields(occurrences, OCCURRENCE_FIELDS);
    expectNoUnknownTopLevelFields(statusEvents, STATUS_EVENT_FIELDS);
    expectExtensionsNamespaced([...behaviors, ...schedules, ...occurrences]);

    const behaviorIds = new Set(
      behaviors.map((behavior) => String(behavior.behavior_id)),
    );
    const scheduleIds = new Set(
      schedules.map((schedule) => String(schedule.schedule_id)),
    );
    const occurrenceIds = new Set(
      occurrences.map((occurrence) => String(occurrence.occurrence_id)),
    );
    const statusEventIds = new Set(
      statusEvents.map((event) => String(event.event_id)),
    );

    for (const schedule of schedules) {
      expect(behaviorIds.has(String(schedule.behavior_id))).toBe(true);
      expectValidTimezone(String(schedule.timezone));
    }

    for (const occurrence of occurrences) {
      expect(behaviorIds.has(String(occurrence.behavior_id))).toBe(true);
      expect(scheduleIds.has(String(occurrence.schedule_id))).toBe(true);
      expect(CORE_STATUSES.has(String(occurrence.current_status))).toBe(true);
      expect(OCCURRENCE_STATES.has(String(occurrence.occurrence_state))).toBe(
        true,
      );
      expectValidLocalDate(String(occurrence.local_date));
      expectValidTimezone(String(occurrence.timezone));
    }

    for (const event of statusEvents) {
      expect(occurrenceIds.has(String(event.occurrence_id))).toBe(true);
      expect(behaviorIds.has(String(event.behavior_id))).toBe(true);
      expect(CORE_STATUSES.has(String(event.status))).toBe(true);
      expect(String(event.status)).not.toBe("missed");
      expectValidLocalDate(String(event.local_date));
      expectValidTimezone(String(event.timezone));

      if (event.revises_event_id) {
        expect(statusEventIds.has(String(event.revises_event_id))).toBe(true);
      }
    }

    const occurrenceOne = occurrences.find(
      (occurrence) => occurrence.occurrence_id === "occurrence-1",
    );
    const occurrenceOneEvents = statusEvents.filter(
      (event) => event.occurrence_id === "occurrence-1",
    );

    expect(occurrenceOne?.current_status).toBe("not_completed");
    expect(occurrenceOneEvents.map((event) => event.status)).toEqual([
      "completed",
      "not_completed",
    ]);
    expect(occurrenceOneEvents[1]).toMatchObject({
      status_semantics: "explicit_user_correction",
      revises_event_id: "event-1",
    });
  });
});

async function writeBehaviorLogDirectory(files: BehaviorLogFile[]): Promise<{
  root: string;
  bundlePath: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "cadence-behaviorlog-"));
  const bundlePath = path.join(root, "cadence.behaviorlog");

  await mkdir(bundlePath, { recursive: true });

  for (const file of files) {
    const destination = path.join(bundlePath, file.path);

    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, file.content, "utf8");
  }

  return { root, bundlePath };
}

function parseJson(content: string): JsonRecord {
  return JSON.parse(content) as JsonRecord;
}

function parseJsonl(content: string): JsonRecord[] {
  return content
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as JsonRecord);
}

function readManifestFiles(manifest: JsonRecord): Array<{
  path: string;
  sha256: string;
  required: boolean;
}> {
  if (!Array.isArray(manifest.files)) {
    throw new Error("manifest.files must be an array.");
  }

  return manifest.files.map((entry) => {
    if (!isRecord(entry)) {
      throw new Error("manifest.files entries must be objects.");
    }

    return {
      path: String(entry.path),
      sha256: String(entry.sha256),
      required: entry.required === true,
    };
  });
}

function expectUniqueIds(records: JsonRecord[], key: string): void {
  const ids = records.map((record) => String(record[key]));

  expect(new Set(ids).size).toBe(ids.length);
}

function expectNoUnknownTopLevelFields(
  records: JsonRecord[],
  allowedFields: Set<string>,
): void {
  for (const record of records) {
    const extraFields = Object.keys(record).filter(
      (field) => !allowedFields.has(field),
    );

    expect(extraFields).toEqual([]);
  }
}

function expectExtensionsNamespaced(records: JsonRecord[]): void {
  for (const record of records) {
    for (const field of Object.keys(record)) {
      expect(field).not.toMatch(/^app\.|cadence/i);
    }

    if (record.extensions === undefined) {
      continue;
    }

    if (!isRecord(record.extensions)) {
      throw new Error("extensions must be an object when present.");
    }

    expect(Object.keys(record.extensions)).toEqual(["app.cadence"]);
  }
}

function expectValidLocalDate(value: string): void {
  expect(() => Temporal.PlainDate.from(value)).not.toThrow();
}

function expectValidTimezone(value: string): void {
  expect(() =>
    Temporal.Instant.from("2026-01-01T00:00:00Z").toZonedDateTimeISO(value),
  ).not.toThrow();
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
