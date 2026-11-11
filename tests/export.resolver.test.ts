import { createHash } from "node:crypto";

import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";

import {
  normalizeExportRangeKey,
  resolveExportBundle,
  resolveExportDateRange,
} from "../lib/resolvers/export.resolver";
import { createStoredZip } from "../lib/services/zip";
import type {
  ExportBehaviorInput,
  ExportBehaviorConfigurationEventInput,
  ExportBehaviorDefinitionEventInput,
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
    sortOrder: 2,
    createdAt: "2026-05-01T12:00:00Z",
    updatedAt: "2026-05-01T12:00:00Z",
  },
  {
    id: "category-food",
    name: "Food / Drink",
    sortOrder: 1,
    createdAt: "2026-05-01T12:00:00Z",
    updatedAt: "2026-05-01T12:00:00Z",
  },
];

function behavior(
  overrides: Partial<ExportBehaviorInput> & Pick<ExportBehaviorInput, "id">,
): ExportBehaviorInput {
  return {
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
  overrides: Partial<ExportOccurrenceInput> & Pick<ExportOccurrenceInput, "id">,
): ExportOccurrenceInput {
  return {
    behaviorId: "behavior-brush",
    behaviorScheduleSlotId: "slot-brush",
    scheduledFor: "2026-06-08T13:00:00Z",
    scheduledTimeLabel: "9:00 AM",
    scheduleKind: "exact",
    schedulePreset: null,
    scheduleStartTime: "09:00",
    scheduleEndTime: null,
    localDate: "2026-06-08",
    status: "completed",
    completedAt: "2026-06-08T13:05:00Z",
    statusMarkedAt: "2026-06-08T13:05:00Z",
    note: null,
    createdAt: "2026-06-08T12:00:00Z",
    updatedAt: "2026-06-08T13:05:00Z",
    ...overrides,
  };
}

function reminderDelivery(
  overrides: Partial<ExportReminderDeliveryInput> &
    Pick<ExportReminderDeliveryInput, "id">,
): ExportReminderDeliveryInput {
  return {
    occurrenceId: "occurrence-1",
    channel: "browser_push",
    scheduledSendAt: "2026-06-08T12:45:00Z",
    sentAt: null,
    status: "pending",
    error: null,
    processingStartedAt: null,
    createdAt: "2026-06-08T12:00:00Z",
    updatedAt: "2026-06-08T12:00:00Z",
    ...overrides,
  };
}

function timeSession(
  overrides: Partial<ExportTimeSessionInput> & Pick<ExportTimeSessionInput, "id">,
): ExportTimeSessionInput {
  return {
    occurrenceId: "occurrence-1",
    behaviorId: "behavior-brush",
    startedAt: "2026-06-08T13:00:00Z",
    stoppedAt: "2026-06-08T13:02:14Z",
    ...overrides,
  };
}

function behaviorDefinitionEvent(
  overrides: Partial<ExportBehaviorDefinitionEventInput> &
    Pick<ExportBehaviorDefinitionEventInput, "id">,
): ExportBehaviorDefinitionEventInput {
  return {
    behaviorId: "behavior-brush",
    previousTitle: "Brush",
    nextTitle: "Brush teeth",
    previousDescription: "Evening routine",
    nextDescription: "Night brushing",
    changedFields: ["title", "description"],
    recordedAt: "2026-05-15T13:00:00Z",
    source: "manual",
    reason: null,
    createdAt: "2026-05-15T13:00:00Z",
    updatedAt: "2026-05-15T13:00:00Z",
    ...overrides,
  };
}

function behaviorConfigurationEvent(
  overrides: Partial<ExportBehaviorConfigurationEventInput> &
    Pick<ExportBehaviorConfigurationEventInput, "id">,
): ExportBehaviorConfigurationEventInput {
  const nextConfiguration = overrides.nextConfiguration ?? {
    categoryId: "category-grooming",
    scheduleGraph: [
      {
        recurrenceRule: { frequency: "daily", interval: 1 },
        sortOrder: 0,
        timeEntries: [
          {
            kind: "exact" as const,
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
  };

  return {
    behaviorId: "behavior-brush",
    eventKind: "baseline",
    previousConfiguration: null,
    nextConfiguration,
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
    timezone: nextConfiguration.timezone,
    source: "system",
    reasonCode: "history_capture_started",
    createdAt: "2026-05-01T12:00:00Z",
    ...overrides,
  };
}

function resolve(
  overrides: {
    behaviors?: ExportBehaviorInput[];
    behaviorDefinitionEvents?: ExportBehaviorDefinitionEventInput[];
    behaviorConfigurationEvents?: ExportBehaviorConfigurationEventInput[];
    occurrences?: ExportOccurrenceInput[];
    statusEvents?: ExportStatusEventInput[];
    reminderDeliveries?: ExportReminderDeliveryInput[];
    timeSessions?: ExportTimeSessionInput[];
    range?: string | number | null;
    includeArchived?: boolean;
    includeNotes?: boolean;
    includeTimeTracking?: boolean;
  } = {},
) {
  return resolveExportBundle({
    profile: {
      timezone: DEFAULT_TIMEZONE,
      subjectId: "subject_test",
    },
    categories,
    behaviors: overrides.behaviors ?? [behavior({ id: "behavior-brush" })],
    behaviorDefinitionEvents: overrides.behaviorDefinitionEvents,
    behaviorConfigurationEvents: overrides.behaviorConfigurationEvents,
    occurrences: overrides.occurrences ?? [occurrence({ id: "occurrence-1" })],
    statusEvents: overrides.statusEvents,
    reminderDeliveries: overrides.reminderDeliveries,
    timeSessions: overrides.timeSessions,
    now: NOW,
    timezone: DEFAULT_TIMEZONE,
    range: overrides.range,
    includeArchived: overrides.includeArchived,
    includeNotes: overrides.includeNotes,
    includeTimeTracking: overrides.includeTimeTracking,
  });
}

describe("resolveExportDateRange", () => {
  it("defaults to the last 30 local days ending today", () => {
    expect(
      resolveExportDateRange({
        now: NOW,
        timezone: DEFAULT_TIMEZONE,
      }),
    ).toEqual({
      key: "30",
      label: "30 days",
      startLocalDate: "2026-05-10",
      endLocalDate: "2026-06-08",
      summaryLabel: "2026-05-10 to 2026-06-08",
    });
  });

  it("accepts only documented export range options", () => {
    expect(normalizeExportRangeKey("7")).toBe("7");
    expect(normalizeExportRangeKey(30)).toBe("30");
    expect(normalizeExportRangeKey("90")).toBe("90");
    expect(normalizeExportRangeKey("all")).toBe("all");
    expect(normalizeExportRangeKey("14")).toBe("30");
    expect(normalizeExportRangeKey(Number.NaN)).toBe("30");
  });
});

describe("resolveExportBundle", () => {
  it("omits time tracking from every disabled artifact by default", () => {
    const bundle = resolve({
      timeSessions: [timeSession({ id: "session-hidden" })],
    });

    expect(bundle.includeTimeTracking).toBe(false);
    expect(bundle.timeSessionCount).toBeUndefined();
    expect(bundle.jsonBackup).not.toHaveProperty("time_sessions");
    expect(bundle.jsonl).not.toContain("time_session");
    expect(bundle.csv).not.toContain("tracked_duration_seconds");
    expect(bundle.fileBaseName).not.toContain("with-time-tracking");
    expect(bundle.markdownSummary).not.toContain("tracked time");
    expect(
      bundle.behaviorLog.files.some((file) =>
        file.path.includes("occurrence_time_sessions"),
      ),
    ).toBe(false);
    expect(JSON.stringify(bundle.behaviorLog.files[0])).not.toContain(
      "occurrence_time_sessions",
    );
  });

  it("includes scoped sessions and stopped-only duration summaries when enabled", () => {
    const bundle = resolve({
      includeTimeTracking: true,
      timeSessions: [
        timeSession({
          id: "session-running",
          startedAt: "2026-06-08T14:00:00Z",
          stoppedAt: null,
        }),
        timeSession({ id: "session-stopped" }),
        timeSession({
          id: "session-outside",
          occurrenceId: "occurrence-outside",
          behaviorId: "behavior-outside",
        }),
      ],
    });

    expect(bundle.timeSessionCount).toBe(2);
    expect(bundle.fileBaseName).toContain("with-time-tracking");
    expect(bundle.jsonBackup.time_sessions).toEqual([
      expect.objectContaining({
        id: "session-stopped",
        duration_seconds: 134,
      }),
      expect.objectContaining({
        id: "session-running",
        stopped_at: null,
        duration_seconds: null,
      }),
    ]);
    expect(bundle.jsonl).toContain('"type":"time_session"');
    expect(bundle.csv.split("\n")[0]).toContain("tracked_duration_seconds");
    expect(bundle.markdownSummary).toContain("## Time tracking");
    expect(bundle.markdownSummary).toContain("2m 14s average tracked time");
    expect(
      bundle.behaviorLog.files.find(
        (file) => file.path === "data/time_sessions.jsonl",
      )?.content,
    ).toContain("session-running");
    expect(
      bundle.behaviorLog.files.find(
        (file) => file.path === "data/time_sessions.jsonl",
      )?.content,
    ).not.toContain("duration_seconds");
    const manifest = JSON.parse(
      bundle.behaviorLog.files.find((file) => file.path === "manifest.json")
        ?.content ?? "{}",
    );
    expect(manifest.privacy.contains_time_tracking).toBe(true);
    expect(manifest.profiles).toContain("time_tracking");
  });

  it("round-trips the enabled time-session CSV JSON column through CSV escaping", () => {
    const bundle = resolve({
      includeTimeTracking: true,
      timeSessions: [
        timeSession({ id: "session,quoted\"id" }),
        timeSession({
          id: "session-running",
          startedAt: "2026-06-08T14:00:00Z",
          stoppedAt: null,
        }),
      ],
    });
    const [row] = parseCsv(bundle.csv);

    expect(bundle.csv).toContain('""id""');
    expect(row.tracked_duration_seconds).toBe("134");
    expect(row.time_session_count).toBe("2");
    expect(JSON.parse(row.time_sessions)).toEqual([
      expect.objectContaining({ id: 'session,quoted"id', duration_seconds: 134 }),
      expect.objectContaining({ id: "session-running", duration_seconds: null }),
    ]);
  });

  it("excludes sessions outside the selected date and archived-behavior scope", () => {
    const archivedBehavior = behavior({
      id: "behavior-archived",
      active: false,
      archivedAt: "2026-06-01T00:00:00Z",
    });
    const bundle = resolve({
      includeTimeTracking: true,
      behaviors: [behavior({ id: "behavior-brush" }), archivedBehavior],
      occurrences: [
        occurrence({ id: "occurrence-included" }),
        occurrence({
          id: "occurrence-out-of-range",
          localDate: "2026-04-01",
          scheduledFor: "2026-04-01T13:00:00Z",
        }),
        occurrence({
          id: "occurrence-archived",
          behaviorId: "behavior-archived",
        }),
      ],
      timeSessions: [
        timeSession({ id: "session-included", occurrenceId: "occurrence-included" }),
        timeSession({
          id: "session-out-of-range",
          occurrenceId: "occurrence-out-of-range",
        }),
        timeSession({
          id: "session-archived",
          occurrenceId: "occurrence-archived",
          behaviorId: "behavior-archived",
        }),
      ],
    });

    expect(bundle.jsonBackup.time_sessions).toEqual([
      expect.objectContaining({ id: "session-included" }),
    ]);
  });

  it("averages summed stopped sessions by timed occurrence in Markdown", () => {
    const bundle = resolve({
      includeTimeTracking: true,
      occurrences: [
        occurrence({ id: "occurrence-1" }),
        occurrence({ id: "occurrence-2" }),
      ],
      timeSessions: [
        timeSession({ id: "session-1", occurrenceId: "occurrence-1" }),
        timeSession({
          id: "session-2",
          occurrenceId: "occurrence-1",
          startedAt: "2026-06-08T13:05:00Z",
          stoppedAt: "2026-06-08T13:06:00Z",
        }),
        timeSession({
          id: "session-3",
          occurrenceId: "occurrence-2",
          startedAt: "2026-06-08T14:00:00Z",
          stoppedAt: "2026-06-08T14:01:00Z",
        }),
      ],
    });

    expect(bundle.markdownSummary).toContain(
      "3 stopped sessions, 4m 14s recorded, 2m 7s average tracked time",
    );
  });

  it("labels a running-only Markdown export without inventing a stopped session", () => {
    const bundle = resolve({
      includeTimeTracking: true,
      timeSessions: [
        timeSession({ id: "session-running", stoppedAt: null }),
      ],
    });

    expect(bundle.markdownSummary).toContain(
      "No stopped timing sessions in this export range.",
    );
  });

  it("emits valid JSONL with one category, behavior, or occurrence per line", () => {
    const bundle = resolve();
    const records = bundle.jsonl.split("\n").map((line) => JSON.parse(line));

    expect(records).toHaveLength(4);
    expect(records.map((record) => record.type)).toEqual([
      "category",
      "category",
      "behavior",
      "occurrence",
    ]);
    expect(records[0]).toMatchObject({
      type: "category",
      name: "Food / Drink",
      sort_order: 1,
    });
    expect(records[2]).toMatchObject({
      type: "behavior",
      behavior_title: "Brush teeth",
      recurrence_rule: {
        frequency: "daily",
        interval: 1,
      },
      schedule_slots: [
        expect.objectContaining({
          kind: "exact",
          startTime: "22:00",
          label: "10:00 PM",
        }),
      ],
      schedules: [
        expect.objectContaining({
          recurrenceRule: {
            frequency: "daily",
            interval: 1,
          },
          timeEntries: [
            expect.objectContaining({
              kind: "exact",
              startTime: "22:00",
              label: "10:00 PM",
            }),
          ],
        }),
      ],
    });
    expect(records[3]).toMatchObject({
      type: "occurrence",
      behavior_title: "Brush teeth",
      local_date: "2026-06-08",
      scheduled_for: "2026-06-08T09:00:00-04:00",
      schedule: "9:00 AM",
      schedule_kind: "exact",
      status: "completed",
      note: null,
    });
  });

  it("escapes commas, quotes, and newlines in CSV cells", () => {
    const bundle = resolve({
      includeNotes: true,
      behaviors: [
        behavior({
          id: "behavior-brush",
          title: 'Brush, "teeth"',
          categoryName: "Grooming\nCare",
        }),
      ],
      occurrences: [
        occurrence({
          id: "csv-row",
          note: 'Line one\nLine "two", more',
        }),
      ],
    });

    expect(bundle.csv).toBe(
      [
        "local_date,scheduled_for,schedule,behavior_title,category,status,status_marked_at,note",
        '2026-06-08,2026-06-08T09:00:00-04:00,9:00 AM,"Brush, ""teeth""","Grooming\nCare",completed,2026-06-08T09:05:00-04:00,"Line one\nLine ""two"", more"',
      ].join("\n"),
    );
  });

  it("neutralizes formula-leading values in app and BehaviorLog CSV cells", () => {
    const bundle = resolve({
      includeNotes: true,
      behaviors: [
        behavior({
          id: "behavior-brush",
          title: "=HYPERLINK(\"https://example.invalid\")",
          description: "@SUM(1+1)",
          categoryName: "+SUM(1+1)",
        }),
      ],
      occurrences: [
        occurrence({
          id: "formula-row",
          note: "  @SUM(1+1)",
        }),
      ],
      statusEvents: [
        {
          id: "formula-reason-event",
          occurrenceId: "formula-row",
          behaviorId: "behavior-brush",
          previousStatus: "unresolved",
          status: "completed",
          statusSemantics: "explicit_user_correction",
          recordedAt: "2026-06-08T13:05:00Z",
          effectiveAt: "2026-06-08T13:05:00Z",
          localDate: "2026-06-08",
          timezone: DEFAULT_TIMEZONE,
          sourceCaptureMethod: "imported",
          sourceConfidence: "high",
          revisesEventId: null,
          reasonCode: "-imported-formula",
        },
      ],
    });

    const [appCsvRow] = parseCsv(bundle.csv);
    const behaviorsCsv =
      bundle.behaviorLog.files.find((file) => file.path === "csv/behaviors.csv")
        ?.content ?? "";
    const [behaviorLogCsvRow] = parseCsv(behaviorsCsv);
    const statusEventsCsv =
      bundle.behaviorLog.files.find(
        (file) => file.path === "csv/status_events.csv",
      )?.content ?? "";
    const [statusEventCsvRow] = parseCsv(statusEventsCsv);

    expect(appCsvRow).toMatchObject({
      schedule: "9:00 AM",
      behavior_title: "'=HYPERLINK(\"https://example.invalid\")",
      category: "'+SUM(1+1)",
      note: "'  @SUM(1+1)",
    });
    expect(behaviorLogCsvRow).toMatchObject({
      title: "'=HYPERLINK(\"https://example.invalid\")",
      description: "'@SUM(1+1)",
      category: "'+SUM(1+1)",
      success_definition:
        "Complete =HYPERLINK(\"https://example.invalid\") for each scheduled occurrence.",
    });
    expect(statusEventCsvRow).toMatchObject({
      reason_code: "'-imported-formula",
      utc_offset_at_event: "-04:00",
    });
  });

  it("preserves signed machine-generated offsets in BehaviorLog CSV views", () => {
    const bundle = resolve({
      behaviors: [
        behavior({
          id: "behavior-west",
          title: "West behavior",
          timezone: "America/New_York",
        }),
        behavior({
          id: "behavior-east",
          title: "East behavior",
          timezone: "Asia/Kolkata",
        }),
      ],
      occurrences: [
        occurrence({
          id: "occurrence-west",
          behaviorId: "behavior-west",
        }),
        occurrence({
          id: "occurrence-east",
          behaviorId: "behavior-east",
        }),
      ],
      statusEvents: [
        {
          id: "event-west",
          occurrenceId: "occurrence-west",
          behaviorId: "behavior-west",
          previousStatus: "unresolved",
          status: "completed",
          statusSemantics: "explicit_user_mark",
          recordedAt: "2026-06-08T13:05:00Z",
          effectiveAt: "2026-06-08T13:05:00Z",
          localDate: "2026-06-08",
          timezone: "America/New_York",
          sourceCaptureMethod: "manual_tap",
          sourceConfidence: "high",
          revisesEventId: null,
          reasonCode: null,
        },
        {
          id: "event-east",
          occurrenceId: "occurrence-east",
          behaviorId: "behavior-east",
          previousStatus: "unresolved",
          status: "completed",
          statusSemantics: "explicit_user_mark",
          recordedAt: "2026-06-08T13:05:00Z",
          effectiveAt: "2026-06-08T13:05:00Z",
          localDate: "2026-06-08",
          timezone: "Asia/Kolkata",
          sourceCaptureMethod: "manual_tap",
          sourceConfidence: "high",
          revisesEventId: null,
          reasonCode: null,
        },
      ],
    });
    const fileByPath = new Map(
      bundle.behaviorLog.files.map((file) => [file.path, file]),
    );
    const occurrenceRows = parseCsv(
      fileByPath.get("csv/occurrences.csv")?.content ?? "",
    );
    const statusEventRows = parseCsv(
      fileByPath.get("csv/status_events.csv")?.content ?? "",
    );

    expect(
      occurrenceRows.map((row) => row.utc_offset_at_event).sort(),
    ).toEqual(["+05:30", "-04:00"]);
    expect(
      statusEventRows.map((row) => row.utc_offset_at_event).sort(),
    ).toEqual(["+05:30", "-04:00"]);
  });

  it("omits occurrence notes from every export output by default", () => {
    const bundle = resolve({
      occurrences: [
        occurrence({
          id: "occurrence-1",
          note: "Private note about this occurrence.",
        }),
      ],
    });
    const jsonlOccurrence = bundle.jsonl
      .split("\n")
      .map((line) => JSON.parse(line))
      .find((record) => record.type === "occurrence");
    const csvRows = parseCsv(bundle.csv);
    const fileByPath = new Map(
      bundle.behaviorLog.files.map((file) => [file.path, file]),
    );
    const manifest = JSON.parse(fileByPath.get("manifest.json")?.content ?? "");

    expect(bundle.includeNotes).toBe(false);
    expect(jsonlOccurrence.note).toBeNull();
    expect(csvRows[0]?.note).toBe("");
    expect(bundle.jsonBackup.occurrences[0]?.note).toBeNull();
    expect(fileByPath.has("data/notes.jsonl")).toBe(false);
    expect(manifest.privacy.contains_notes).toBe(false);
    expect(manifest.profiles).toEqual([
      "core",
      "intervention",
      "definition_history",
    ]);
    expect(bundle.markdownSummary).toContain("Occurrence notes: excluded");
    expect(bundle.markdownSummary).not.toContain("## Notes");
    expect(bundle.markdownSummary).not.toContain("Private note");
  });

  it("preserves occurrence notes when includeNotes is selected", () => {
    const bundle = resolve({
      includeNotes: true,
      occurrences: [
        occurrence({
          id: "occurrence-1",
          note: 'Line one\nLine "two", more',
        }),
      ],
    });
    const jsonlOccurrence = bundle.jsonl
      .split("\n")
      .map((line) => JSON.parse(line))
      .find((record) => record.type === "occurrence");
    const csvRows = parseCsv(bundle.csv);
    const fileByPath = new Map(
      bundle.behaviorLog.files.map((file) => [file.path, file]),
    );
    const manifest = JSON.parse(fileByPath.get("manifest.json")?.content ?? "");
    const notes = parseJsonl(fileByPath.get("data/notes.jsonl")?.content ?? "");

    expect(bundle.includeNotes).toBe(true);
    expect(jsonlOccurrence.note).toBe('Line one\nLine "two", more');
    expect(csvRows[0]?.note).toBe('Line one\nLine "two", more');
    expect(bundle.jsonBackup.occurrences[0]?.note).toBe(
      'Line one\nLine "two", more',
    );
    expect(manifest.privacy.contains_notes).toBe(true);
    expect(manifest.profiles).toEqual([
      "core",
      "intervention",
      "definition_history",
    ]);
    expect(notes).toEqual([
      expect.objectContaining({
        record_type: "note",
        attached_to_type: "occurrence",
        attached_to_id: "occurrence-1",
        body_markdown: 'Line one\nLine "two", more',
      }),
    ]);
    expect(bundle.markdownSummary).toContain("## Notes");
    expect(bundle.markdownSummary).toContain("Occurrence notes: included");
    expect(bundle.markdownSummary).toContain(
      '- 2026-06-08 - Brush teeth - 9:00 AM - completed: Line one Line "two", more',
    );
  });

  it("exports preset time range labels and snapshots", () => {
    const bundle = resolve({
      behaviors: [
        behavior({
          id: "behavior-stretch",
          title: "Stretch",
          scheduledTime: "06:00",
          scheduleSlots: [
            {
              id: "slot-morning",
              kind: "range",
              preset: "morning",
              startTime: "06:00",
              endTime: "12:00",
              sortOrder: 0,
              label: "Morning (6:00 AM-Noon)",
            },
          ],
        }),
      ],
      occurrences: [
        occurrence({
          id: "range-row",
          behaviorId: "behavior-stretch",
          scheduledFor: "2026-06-08T10:00:00Z",
          scheduledTimeLabel: "Morning (6:00 AM-Noon)",
          scheduleKind: "range",
          schedulePreset: "morning",
          scheduleStartTime: "06:00",
          scheduleEndTime: "12:00",
        }),
      ],
    });
    const occurrenceRecord = bundle.jsonBackup.occurrences[0];

    expect(occurrenceRecord).toMatchObject({
      schedule: "Morning (6:00 AM-Noon)",
      schedule_kind: "range",
      schedule_preset: "morning",
      schedule_start_time: "06:00",
      schedule_end_time: "12:00",
    });
    expect(bundle.csv).toContain(
      "Morning (6:00 AM-Noon),Stretch,Grooming,completed",
    );
  });

  it("exports multiple schedules with their own recurrence rules", () => {
    const bundle = resolve({
      behaviors: [
        behavior({
          id: "behavior-clean-aligners",
          title: "Clean Invisalign",
          scheduledTime: "08:00",
          recurrenceRule: { frequency: "daily", interval: 1 },
          schedules: [
            {
              id: "schedule-daily",
              recurrenceRule: { frequency: "daily", interval: 1 },
              recurrenceSummary: "Daily",
              recurrenceDefaults: {
                kind: "daily",
                dailyInterval: 1,
                everyDays: 2,
                weeklyInterval: 1,
                weeklyDays: ["monday"],
                monthlyInterval: 1,
                monthlyDay: 1,
              },
              timeEntries: [
                {
                  id: "slot-morning",
                  scheduleId: "schedule-daily",
                  kind: "exact",
                  preset: null,
                  startTime: "08:00",
                  endTime: null,
                  sortOrder: 0,
                  label: "8:00 AM",
                },
                {
                  id: "slot-night",
                  scheduleId: "schedule-daily",
                  kind: "exact",
                  preset: null,
                  startTime: "23:00",
                  endTime: null,
                  sortOrder: 1,
                  label: "11:00 PM",
                },
              ],
              timeSummary: "8:00 AM, 11:00 PM",
              sortOrder: 0,
            },
            {
              id: "schedule-every-two-days",
              recurrenceRule: { frequency: "interval_days", intervalDays: 2 },
              recurrenceSummary: "Every 2 days",
              recurrenceDefaults: {
                kind: "every_days",
                dailyInterval: 1,
                everyDays: 2,
                weeklyInterval: 1,
                weeklyDays: ["monday"],
                monthlyInterval: 1,
                monthlyDay: 1,
              },
              timeEntries: [
                {
                  id: "slot-overlap",
                  scheduleId: "schedule-every-two-days",
                  kind: "range",
                  preset: null,
                  startTime: "23:00",
                  endTime: "23:30",
                  sortOrder: 0,
                  label: "11:00 PM - 11:30 PM",
                },
              ],
              timeSummary: "11:00 PM - 11:30 PM",
              sortOrder: 1,
            },
          ],
          scheduleSlots: [
            {
              id: "slot-morning",
              scheduleId: "schedule-daily",
              kind: "exact",
              preset: null,
              startTime: "08:00",
              endTime: null,
              sortOrder: 0,
              label: "8:00 AM",
            },
            {
              id: "slot-night",
              scheduleId: "schedule-daily",
              kind: "exact",
              preset: null,
              startTime: "23:00",
              endTime: null,
              sortOrder: 1,
              label: "11:00 PM",
            },
            {
              id: "slot-overlap",
              scheduleId: "schedule-every-two-days",
              kind: "range",
              preset: null,
              startTime: "23:00",
              endTime: "23:30",
              sortOrder: 2,
              label: "11:00 PM - 11:30 PM",
            },
          ],
        }),
      ],
      occurrences: [
        occurrence({
          id: "aligners-night",
          behaviorId: "behavior-clean-aligners",
          behaviorScheduleSlotId: "slot-overlap",
          scheduledFor: "2026-06-09T03:00:00Z",
          scheduledTimeLabel: "11:00 PM - 11:30 PM",
          scheduleKind: "range",
          schedulePreset: null,
          scheduleStartTime: "23:00",
          scheduleEndTime: "23:30",
        }),
      ],
    });
    const jsonlRecords = bundle.jsonl
      .split("\n")
      .map((line) => JSON.parse(line));
    const behaviorRecord = jsonlRecords.find(
      (record) => record.type === "behavior",
    );
    const fileByPath = new Map(
      bundle.behaviorLog.files.map((file) => [file.path, file]),
    );
    const schedules = parseJsonl(
      fileByPath.get("data/schedules.jsonl")?.content ?? "",
    );

    expect(bundle.jsonBackup.behaviors[0]?.schedules).toHaveLength(2);
    expect(behaviorRecord.schedules).toHaveLength(2);
    expect(behaviorRecord.schedules[1].recurrenceRule).toEqual({
      frequency: "interval_days",
      intervalDays: 2,
    });
    expect(schedules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          schedule_id: "sch_slot-morning",
          recurrence: { type: "daily", interval: 1 },
          local_time: "08:00",
        }),
        expect.objectContaining({
          schedule_id: "sch_slot-overlap",
          recurrence: { type: "every_n_days", interval: 2 },
          local_time: "23:00",
          window_start_local: "23:00",
          window_end_local: "23:30",
        }),
      ]),
    );
  });

  it("includes profile timezone, categories, behaviors, occurrences, and exported_at in full JSON", () => {
    const bundle = resolve();

    expect(bundle.jsonBackup).toMatchObject({
      exported_at: "2026-06-08T12:00:00-04:00",
      profile: {
        timezone: DEFAULT_TIMEZONE,
      },
      categories: [
        {
          id: "category-food",
          name: "Food / Drink",
        },
        {
          id: "category-grooming",
          name: "Grooming",
        },
      ],
      behaviors: [
        {
          id: "behavior-brush",
          title: "Brush teeth",
        },
      ],
      occurrences: [
        {
          id: "occurrence-1",
          behavior_title: "Brush teeth",
          schedule: "9:00 AM",
          note: null,
        },
      ],
      status_events: [],
    });
    expect(JSON.parse(bundle.json)).toEqual(bundle.jsonBackup);
  });

  it("includes sorted status history for exported occurrences in full JSON", () => {
    const bundle = resolve({
      occurrences: [occurrence({ id: "occurrence-1" })],
      statusEvents: [
        {
          id: "event-late",
          occurrenceId: "occurrence-1",
          behaviorId: "behavior-brush",
          previousStatus: "completed",
          status: "not_completed",
          statusSemantics: "explicit_user_correction",
          recordedAt: "2026-06-08T13:00:00Z",
          effectiveAt: "2026-06-08T13:45:00Z",
          localDate: "2026-06-08",
          timezone: DEFAULT_TIMEZONE,
          sourceCaptureMethod: "manual_tap",
          sourceConfidence: "high",
          revisesEventId: "event-early",
          reasonCode: "user_correction",
        },
        {
          id: "event-early",
          occurrenceId: "occurrence-1",
          behaviorId: "behavior-brush",
          previousStatus: "unresolved",
          status: "completed",
          statusSemantics: "explicit_user_mark",
          recordedAt: "2026-06-08T13:00:00Z",
          effectiveAt: "2026-06-08T13:00:00Z",
          localDate: "2026-06-08",
          timezone: DEFAULT_TIMEZONE,
          sourceCaptureMethod: "manual_tap",
          sourceConfidence: "high",
          revisesEventId: null,
          reasonCode: null,
        },
        {
          id: "event-outside-range",
          occurrenceId: "occurrence-outside-range",
          behaviorId: "behavior-brush",
          previousStatus: "unresolved",
          status: "completed",
          statusSemantics: "explicit_user_mark",
          recordedAt: "2026-06-08T13:00:00Z",
          effectiveAt: null,
          localDate: "2026-06-08",
          timezone: DEFAULT_TIMEZONE,
          sourceCaptureMethod: "manual_tap",
          sourceConfidence: "high",
          revisesEventId: null,
          reasonCode: null,
        },
      ],
    });

    expect(bundle.jsonBackup.status_events).toEqual([
      expect.objectContaining({
        id: "event-early",
        recorded_at: "2026-06-08T13:00:00Z",
        effective_at: "2026-06-08T13:00:00Z",
        revises_event_id: null,
      }),
      expect.objectContaining({
        id: "event-late",
        previous_status: "completed",
        status: "not_completed",
        status_semantics: "explicit_user_correction",
        recorded_at: "2026-06-08T13:00:00Z",
        effective_at: "2026-06-08T13:45:00Z",
        revises_event_id: "event-early",
        reason_code: "user_correction",
      }),
    ]);
    expect(bundle.jsonBackup.status_events).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "event-outside-range" }),
      ]),
    );
  });

  it("exports all-time behavior definition history for included behaviors in deterministic order", () => {
    const history = [
      behaviorDefinitionEvent({
        id: "definition-z",
        changedFields: ["description", "title"],
        recordedAt: "2026-05-15T09:00:00-04:00",
      }),
      behaviorDefinitionEvent({
        id: "definition-a",
        previousTitle: null,
        previousDescription: null,
        nextDescription: "Evening routine",
        changedFields: ["title", "description"],
        recordedAt: "2026-05-01T12:00:00Z",
        source: "system",
        reason: "baseline_backfill",
        createdAt: "2026-05-01T12:00:00Z",
        updatedAt: "2026-05-01T12:00:00Z",
      }),
      behaviorDefinitionEvent({
        id: "definition-b",
        previousTitle: "Brush teeth",
        nextTitle: "Brush teeth",
        previousDescription: "Night brushing",
        nextDescription: "Night brushing and flossing",
        changedFields: ["description"],
        recordedAt: "2026-05-15T13:00:00Z",
      }),
      behaviorDefinitionEvent({
        id: "definition-archived",
        behaviorId: "behavior-archived",
      }),
      behaviorDefinitionEvent({
        id: "definition-not-exported",
        behaviorId: "behavior-not-exported",
      }),
    ];
    const bundle = resolve({
      range: "7",
      behaviors: [
        behavior({ id: "behavior-brush" }),
        behavior({
          id: "behavior-archived",
          title: "Archived behavior",
          active: false,
          archivedAt: "2026-05-20T12:00:00Z",
        }),
      ],
      behaviorDefinitionEvents: history,
    });
    const fileByPath = new Map(
      bundle.behaviorLog.files.map((file) => [file.path, file]),
    );
    const portableHistory = parseJsonl(
      fileByPath.get("data/behavior_definition_events.jsonl")?.content ?? "",
    );
    const manifest = JSON.parse(fileByPath.get("manifest.json")?.content ?? "");
    const manifestEntry = manifest.files.find(
      (entry: { path: string }) =>
        entry.path === "data/behavior_definition_events.jsonl",
    );

    expect(bundle.jsonBackup.behavior_definition_events).toEqual([
      expect.objectContaining({
        id: "definition-a",
        previous_title: null,
        next_title: "Brush teeth",
        previous_description: null,
        next_description: "Evening routine",
        changed_fields: ["title", "description"],
        recorded_at: "2026-05-01T12:00:00Z",
        source: "system",
        reason: "baseline_backfill",
      }),
      expect.objectContaining({
        id: "definition-b",
        changed_fields: ["description"],
        recorded_at: "2026-05-15T13:00:00Z",
      }),
      expect.objectContaining({
        id: "definition-z",
        changed_fields: ["title", "description"],
        recorded_at: "2026-05-15T13:00:00Z",
      }),
    ]);
    expect(portableHistory).toEqual([
      expect.objectContaining({
        record_type: "behavior_definition_event",
        event_id: "definition-a",
        behavior_id: "behavior-brush",
        event_kind: "baseline",
        changed_fields: ["title", "description"],
        previous: null,
        next: {
          title: "Brush teeth",
          description: "Evening routine",
        },
        recorded_at_utc: "2026-05-01T12:00:00Z",
        reason_code: "baseline_backfill",
        source: expect.objectContaining({ capture_method: "system_generated" }),
      }),
      expect.objectContaining({
        event_id: "definition-b",
        event_kind: "revision",
        changed_fields: ["description"],
        previous: {
          title: "Brush teeth",
          description: "Night brushing",
        },
        next: {
          title: "Brush teeth",
          description: "Night brushing and flossing",
        },
        source: expect.objectContaining({ capture_method: "manual_text" }),
      }),
      expect.objectContaining({
        event_id: "definition-z",
        event_kind: "revision",
      }),
    ]);
    expect(manifestEntry).toMatchObject({
      media_type: "application/jsonl",
      schema_ref: "#/$defs/BehaviorDefinitionEvent",
      required: false,
      sha256: sha256(
        fileByPath.get("data/behavior_definition_events.jsonl")?.content ?? "",
      ),
    });
    expect(manifest.profiles).toContain("definition_history");
    expect(manifest.rules.definition_history_policy).toBe("event_sourced");
    expect(
      manifest.extensions["app.cadence"],
    ).not.toHaveProperty("behavior_definition_history");
    expect(bundle.markdownSummary).toContain(
      "Behavior definition history: included (3 events)",
    );
    expect(bundle.markdownSummary).toContain("## Behavior definition history");
    expect(bundle.markdownSummary).toContain(
      "`data/behavior_definition_events.jsonl`",
    );

    const withArchived = resolve({
      range: "7",
      includeArchived: true,
      behaviors: [
        behavior({ id: "behavior-brush" }),
        behavior({
          id: "behavior-archived",
          title: "Archived behavior",
          active: false,
          archivedAt: "2026-05-20T12:00:00Z",
        }),
      ],
      behaviorDefinitionEvents: history,
    });

    expect(
      withArchived.jsonBackup.behavior_definition_events.map(
        (event) => event.id,
      ),
    ).toEqual([
      "definition-a",
      "definition-archived",
      "definition-b",
      "definition-z",
    ]);
  });

  it("emits an empty optional definition-history file when no events are available", () => {
    const bundle = resolve();
    const fileByPath = new Map(
      bundle.behaviorLog.files.map((file) => [file.path, file]),
    );

    expect(bundle.jsonBackup.behavior_definition_events).toEqual([]);
    expect(
      fileByPath.get("data/behavior_definition_events.jsonl")?.content,
    ).toBe("");
    expect(bundle.markdownSummary).toContain(
      "Behavior definition history: included (0 events)",
    );
  });

  it("exports complete configuration history and segments BehaviorLog schedule periods", () => {
    const daily = behaviorConfigurationEvent({ id: "config-daily" });
    const reminderConfiguration = {
      ...daily.nextConfiguration,
      emailReminderEnabled: true,
    };
    const reminder = behaviorConfigurationEvent({
      id: "config-reminder",
      eventKind: "revision",
      previousConfiguration: daily.nextConfiguration,
      nextConfiguration: reminderConfiguration,
      changedFields: ["email_reminder_enabled"],
      recordedAt: "2026-06-05T14:00:00Z",
      effectiveAt: "2026-06-05T14:00:00Z",
      effectiveLocalDate: "2026-06-05",
      source: "manual",
      reasonCode: "behavior_form_update",
    });
    const weeklyConfiguration = {
      ...reminderConfiguration,
      scheduleGraph: [
        {
          recurrenceRule: {
            frequency: "weekly" as const,
            interval: 1,
            daysOfWeek: ["monday" as const],
          },
          sortOrder: 0,
          timeEntries: reminderConfiguration.scheduleGraph[0].timeEntries,
        },
      ],
    };
    const weekly = behaviorConfigurationEvent({
      id: "config-weekly",
      eventKind: "revision",
      previousConfiguration: reminderConfiguration,
      nextConfiguration: weeklyConfiguration,
      changedFields: ["schedule_graph"],
      recordedAt: "2026-06-08T14:00:00Z",
      effectiveAt: "2026-06-08T14:00:00Z",
      effectiveLocalDate: "2026-06-08",
      source: "manual",
      reasonCode: "behavior_form_update",
    });
    const bundle = resolve({
      range: "all",
      behaviorConfigurationEvents: [weekly, reminder, daily],
      occurrences: [
        occurrence({
          id: "occurrence-daily",
          behaviorConfigurationEventId: "config-reminder",
          scheduledFor: "2026-06-01T13:00:00Z",
          localDate: "2026-06-01",
        }),
        occurrence({
          id: "occurrence-weekly",
          behaviorConfigurationEventId: "config-weekly",
          scheduledFor: "2026-06-08T15:00:00Z",
          localDate: "2026-06-08",
        }),
      ],
    });
    const fileByPath = new Map(
      bundle.behaviorLog.files.map((file) => [file.path, file]),
    );
    const schedules = parseJsonl(
      fileByPath.get("data/schedules.jsonl")?.content ?? "",
    );
    const behaviorLogOccurrences = parseJsonl(
      fileByPath.get("data/occurrences.jsonl")?.content ?? "",
    );
    const rawHistory = parseJsonl(
      fileByPath.get("raw/cadence/behavior_configuration_events.jsonl")
        ?.content ?? "",
    );
    const manifest = JSON.parse(fileByPath.get("manifest.json")?.content ?? "");

    expect(bundle.jsonBackup.behavior_configuration_events.map((event) => event.id)).toEqual([
      "config-daily",
      "config-reminder",
      "config-weekly",
    ]);
    expect(bundle.jsonBackup.behavior_configuration_events[2]).toMatchObject({
      previous_configuration: expect.objectContaining({
        email_reminder_enabled: true,
      }),
      next_configuration: expect.objectContaining({
        schedule_graph: [
          expect.objectContaining({
            recurrence_rule: expect.objectContaining({ frequency: "weekly" }),
          }),
        ],
      }),
      effective_at: "2026-06-08T14:00:00Z",
    });
    expect(rawHistory.map((event) => event.id)).toEqual(
      bundle.jsonBackup.behavior_configuration_events.map((event) => event.id),
    );
    expect(JSON.stringify(rawHistory)).not.toContain('"location_text"');
    expect(manifest.extensions["app.cadence"].behavior_configuration_history).toEqual({
      path: "raw/cadence/behavior_configuration_events.jsonl",
      record_count: 3,
      ordering: ["recorded_at", "id"],
      import_restore_support: "export_only",
    });
    const historyFile = fileByPath.get(
      "raw/cadence/behavior_configuration_events.jsonl",
    );
    expect(
      manifest.files.find(
        (entry: { path: string }) => entry.path === historyFile?.path,
      ),
    ).toMatchObject({
      required: false,
      schema_ref: null,
      sha256: sha256(historyFile?.content ?? ""),
    });
    expect(schedules).toEqual([
      expect.objectContaining({
        schedule_id: "sch_config-daily_0_0",
        recurrence: { type: "daily", interval: 1 },
        active_from_local_date: "2026-05-01",
        active_until_local_date: "2026-06-08",
        extensions: {
          "app.cadence": expect.objectContaining({
            behavior_configuration_event_id: "config-daily",
            effective_from_utc: "2026-05-01T12:00:00Z",
            effective_until_utc: "2026-06-08T14:00:00Z",
            import_role: "historical_reference_only",
          }),
        },
      }),
      expect.objectContaining({
        schedule_id: "sch_config-weekly_0_0",
        recurrence: {
          type: "weekly_on_weekdays",
          weekdays: ["monday"],
        },
        active_from_local_date: "2026-06-08",
        active_until_local_date: null,
        extensions: {
          "app.cadence": expect.objectContaining({
            behavior_configuration_event_id: "config-weekly",
            import_role: "current_configuration",
          }),
        },
      }),
    ]);
    expect(behaviorLogOccurrences).toEqual([
      expect.objectContaining({
        occurrence_id: "occurrence-daily",
        schedule_id: "sch_config-daily_0_0",
        extensions: {
          "app.cadence": expect.objectContaining({
            behavior_configuration_event_id: "config-reminder",
          }),
        },
      }),
      expect.objectContaining({
        occurrence_id: "occurrence-weekly",
        schedule_id: "sch_config-weekly_0_0",
      }),
    ]);
    expect(bundle.jsonl).not.toContain("behavior_configuration_event_id");
    expect(bundle.csv.split("\n")[0]).not.toContain(
      "behavior_configuration_event_id",
    );
    expect(bundle.markdownSummary).toContain(
      "Behavior configuration history: included (3 events)",
    );
    expect(bundle.markdownSummary).toContain("does not establish causality");
    expect(bundle.markdownSummary).toContain(
      "does not provide clinical guidance",
    );
  });

  it("uses one-day medium-confidence placeholders for null-lineage Occurrences", () => {
    const bundle = resolve({
      range: "all",
      behaviorConfigurationEvents: [
        behaviorConfigurationEvent({ id: "config-daily" }),
      ],
      occurrences: [
        occurrence({
          id: "occurrence-legacy",
          behaviorConfigurationEventId: null,
          behaviorScheduleSlotId: "slot-old",
          localDate: "2026-06-01",
          scheduledFor: "2026-06-01T13:00:00Z",
        }),
      ],
    });
    const schedules = parseJsonl(
      bundle.behaviorLog.files.find(
        (file) => file.path === "data/schedules.jsonl",
      )?.content ?? "",
    );
    const exportedOccurrence = parseJsonl(
      bundle.behaviorLog.files.find(
        (file) => file.path === "data/occurrences.jsonl",
      )?.content ?? "",
    )[0];
    const fallback = schedules.find(
      (schedule) => schedule.schedule_id === "sch_legacy_occurrence-legacy",
    );

    expect(fallback).toMatchObject({
      recurrence: { type: "daily", interval: 1 },
      active_from_local_date: "2026-06-01",
      active_until_local_date: "2026-06-01",
      source: expect.objectContaining({ confidence: "medium" }),
      extensions: {
        "app.cadence": expect.objectContaining({
          historical_recurrence: "unknown",
          lineage_confidence: "medium",
          import_role: "historical_reference_only",
        }),
      },
    });
    expect(exportedOccurrence.schedule_id).toBe(
      "sch_legacy_occurrence-legacy",
    );
  });

  it("keeps JSONL and CSV byte-stable when historical lineage uses another timezone", () => {
    const losAngelesConfiguration = behaviorConfigurationEvent({
      id: "config-los-angeles-history",
      nextConfiguration: {
        ...behaviorConfigurationEvent({ id: "template" }).nextConfiguration,
        timezone: "America/Los_Angeles",
      },
      timezone: "America/Los_Angeles",
      effectiveLocalDate: "2026-05-01",
    });
    const occurrenceInput = occurrence({
      id: "occurrence-timezone-history",
      behaviorConfigurationEventId: "config-los-angeles-history",
      scheduledFor: "2026-06-08T13:00:00Z",
    });
    const legacyBundle = resolve({
      occurrences: [occurrenceInput],
    });
    const historyBundle = resolve({
      behaviorConfigurationEvents: [losAngelesConfiguration],
      occurrences: [occurrenceInput],
    });
    const behaviorLogOccurrence = parseJsonl(
      historyBundle.behaviorLog.files.find(
        (file) => file.path === "data/occurrences.jsonl",
      )?.content ?? "",
    )[0];

    expect(historyBundle.jsonl).toBe(legacyBundle.jsonl);
    expect(historyBundle.csv).toBe(legacyBundle.csv);
    expect(behaviorLogOccurrence.timezone).toBe("America/Los_Angeles");
    expect(historyBundle.jsonBackup.occurrences[0]?.timezone).toBe(
      "America/Los_Angeles",
    );
  });

  it("ends an old timezone period using the old period timezone", () => {
    const oldConfiguration = behaviorConfigurationEvent({
      id: "config-los-angeles",
      nextConfiguration: {
        ...behaviorConfigurationEvent({ id: "base" }).nextConfiguration,
        timezone: "America/Los_Angeles",
      },
      timezone: "America/Los_Angeles",
      effectiveLocalDate: "2026-05-01",
    });
    const newConfiguration = behaviorConfigurationEvent({
      id: "config-tokyo",
      eventKind: "revision",
      previousConfiguration: oldConfiguration.nextConfiguration,
      nextConfiguration: {
        ...oldConfiguration.nextConfiguration,
        timezone: "Asia/Tokyo",
      },
      changedFields: ["timezone"],
      recordedAt: "2026-06-02T01:00:00Z",
      effectiveAt: "2026-06-02T01:00:00Z",
      effectiveLocalDate: "2026-06-02",
      timezone: "Asia/Tokyo",
    });
    const bundle = resolve({
      behaviorConfigurationEvents: [oldConfiguration, newConfiguration],
      occurrences: [],
    });
    const oldSchedule = parseJsonl(
      bundle.behaviorLog.files.find(
        (file) => file.path === "data/schedules.jsonl",
      )?.content ?? "",
    ).find(
      (schedule) => schedule.schedule_id === "sch_config-los-angeles_0_0",
    );

    expect(oldSchedule?.active_until_local_date).toBe("2026-06-01");
  });

  it("ends and reopens same-day active periods with distinct event schedule ids", () => {
    const initial = behaviorConfigurationEvent({ id: "config-initial" });
    const inactiveConfiguration = {
      ...initial.nextConfiguration,
      active: false,
    };
    const inactive = behaviorConfigurationEvent({
      id: "config-inactive",
      eventKind: "revision",
      previousConfiguration: initial.nextConfiguration,
      nextConfiguration: inactiveConfiguration,
      changedFields: ["active"],
      recordedAt: "2026-06-08T14:00:00Z",
      effectiveAt: "2026-06-08T14:00:00Z",
      effectiveLocalDate: "2026-06-08",
      source: "manual",
    });
    const restored = behaviorConfigurationEvent({
      id: "config-restored",
      eventKind: "revision",
      previousConfiguration: inactiveConfiguration,
      nextConfiguration: initial.nextConfiguration,
      changedFields: ["active"],
      recordedAt: "2026-06-08T19:00:00Z",
      effectiveAt: "2026-06-08T19:00:00Z",
      effectiveLocalDate: "2026-06-08",
      source: "manual",
    });
    const bundle = resolve({
      range: "all",
      behaviorConfigurationEvents: [restored, initial, inactive],
      occurrences: [],
    });
    const files = new Map(
      bundle.behaviorLog.files.map((file) => [file.path, file.content]),
    );
    const schedules = parseJsonl(files.get("data/schedules.jsonl") ?? "");
    const rawHistory = parseJsonl(
      files.get("raw/cadence/behavior_configuration_events.jsonl") ?? "",
    );

    expect(schedules).toEqual([
      expect.objectContaining({
        schedule_id: "sch_config-initial_0_0",
        active_until_local_date: "2026-06-08",
        extensions: {
          "app.cadence": expect.objectContaining({
            effective_until_utc: "2026-06-08T14:00:00Z",
            import_role: "historical_reference_only",
          }),
        },
      }),
      expect.objectContaining({
        schedule_id: "sch_config-restored_0_0",
        active_from_local_date: "2026-06-08",
        extensions: {
          "app.cadence": expect.objectContaining({
            effective_from_utc: "2026-06-08T19:00:00Z",
            import_role: "current_configuration",
          }),
        },
      }),
    ]);
    expect(rawHistory.map((event) => event.id)).toEqual([
      "config-initial",
      "config-inactive",
      "config-restored",
    ]);
    expect(
      rawHistory.map((event) => [
        event.effective_at,
        (event.next_configuration as { active: boolean }).active,
      ]),
    ).toEqual([
      ["2026-05-01T12:00:00Z", true],
      ["2026-06-08T14:00:00Z", false],
      ["2026-06-08T19:00:00Z", true],
    ]);
  });

  it("keeps category-only revisions in history without splitting schedules", () => {
    const initial = behaviorConfigurationEvent({ id: "config-category-base" });
    const categoryConfiguration = {
      ...initial.nextConfiguration,
      categoryId: "category-food",
    };
    const categoryRevision = behaviorConfigurationEvent({
      id: "config-category-change",
      eventKind: "revision",
      previousConfiguration: initial.nextConfiguration,
      nextConfiguration: categoryConfiguration,
      changedFields: ["category_id"],
      recordedAt: "2026-06-02T12:00:00Z",
      effectiveAt: "2026-06-02T12:00:00Z",
      effectiveLocalDate: "2026-06-02",
      source: "manual",
    });
    const bundle = resolve({
      behaviorConfigurationEvents: [categoryRevision, initial],
      occurrences: [
        occurrence({
          id: "occurrence-category",
          behaviorConfigurationEventId: "config-category-change",
        }),
      ],
    });
    const schedules = parseJsonl(
      bundle.behaviorLog.files.find(
        (file) => file.path === "data/schedules.jsonl",
      )?.content ?? "",
    );
    const exportedOccurrence = parseJsonl(
      bundle.behaviorLog.files.find(
        (file) => file.path === "data/occurrences.jsonl",
      )?.content ?? "",
    )[0];

    expect(schedules).toHaveLength(1);
    expect(schedules[0]).toMatchObject({
      schedule_id: "sch_config-category-base_0_0",
      extensions: {
        "app.cadence": expect.objectContaining({
          import_role: "current_configuration",
        }),
      },
    });
    expect(exportedOccurrence.schedule_id).toBe(
      "sch_config-category-base_0_0",
    );
    expect(bundle.jsonBackup.behavior_configuration_events).toHaveLength(2);
  });

  it("filters archived configuration history only by the archived option, not range", () => {
    const archivedBaseline = behaviorConfigurationEvent({
      id: "config-archived-active",
      behaviorId: "behavior-archived",
    });
    const archivedInactiveConfiguration = {
      ...archivedBaseline.nextConfiguration,
      active: false,
    };
    const archivedRevision = behaviorConfigurationEvent({
      id: "config-archived-inactive",
      behaviorId: "behavior-archived",
      eventKind: "revision",
      previousConfiguration: archivedBaseline.nextConfiguration,
      nextConfiguration: archivedInactiveConfiguration,
      changedFields: ["active"],
      recordedAt: "2026-05-20T12:00:00Z",
      effectiveAt: "2026-05-20T12:00:00Z",
      effectiveLocalDate: "2026-05-20",
      source: "manual",
    });
    const inputs = {
      behaviors: [
        behavior({ id: "behavior-brush" }),
        behavior({
          id: "behavior-archived",
          active: false,
          archivedAt: "2026-05-20T12:00:00Z",
        }),
      ],
      behaviorConfigurationEvents: [
        archivedRevision,
        behaviorConfigurationEvent({ id: "config-live" }),
        archivedBaseline,
      ],
      occurrences: [],
      range: "7",
    };
    const defaultBundle = resolve(inputs);
    const archivedBundle = resolve({ ...inputs, includeArchived: true });
    const archivedSchedules = parseJsonl(
      archivedBundle.behaviorLog.files.find(
        (file) => file.path === "data/schedules.jsonl",
      )?.content ?? "",
    );

    expect(
      defaultBundle.jsonBackup.behavior_configuration_events.map(
        (event) => event.id,
      ),
    ).toEqual(["config-live"]);
    expect(
      archivedBundle.jsonBackup.behavior_configuration_events.map(
        (event) => event.id,
      ),
    ).toEqual([
      "config-archived-active",
      "config-live",
      "config-archived-inactive",
    ]);
    expect(
      archivedSchedules.find(
        (schedule) =>
          schedule.behavior_id === "behavior-archived" &&
          (
            schedule.extensions as {
              "app.cadence": { import_role: string };
            }
          )["app.cadence"].import_role === "current_configuration",
      ),
    ).toMatchObject({
      active_from_local_date: "2026-05-20",
      active_until_local_date: "2026-05-20",
      extensions: {
        "app.cadence": expect.objectContaining({
          behavior_configuration_event_id: "config-archived-inactive",
          configuration_active: false,
          period_semantics: "inactive_current_configuration_carrier",
          effective_from_utc: "2026-05-20T12:00:00Z",
          effective_until_utc: "2026-05-20T12:00:00Z",
        }),
      },
    });
  });

  it("exports an honest current carrier for an archived false baseline", () => {
    const inactiveConfiguration = {
      ...behaviorConfigurationEvent({ id: "template" }).nextConfiguration,
      active: false,
    };
    const bundle = resolve({
      behaviors: [
        behavior({
          id: "behavior-archived",
          active: false,
          archivedAt: "2026-05-01T12:00:00Z",
        }),
      ],
      behaviorConfigurationEvents: [
        behaviorConfigurationEvent({
          id: "config-archived-baseline",
          behaviorId: "behavior-archived",
          nextConfiguration: inactiveConfiguration,
        }),
      ],
      occurrences: [],
      includeArchived: true,
    });
    const schedules = parseJsonl(
      bundle.behaviorLog.files.find(
        (file) => file.path === "data/schedules.jsonl",
      )?.content ?? "",
    );

    expect(schedules).toEqual([
      expect.objectContaining({
        schedule_id: "sch_config-archived-baseline_0_0",
        active_from_local_date: "2026-05-01",
        active_until_local_date: "2026-05-01",
        extensions: {
          "app.cadence": expect.objectContaining({
            behavior_configuration_event_id: "config-archived-baseline",
            configuration_active: false,
            period_semantics: "inactive_current_configuration_carrier",
            import_role: "current_configuration",
          }),
        },
      }),
    ]);
  });

  it("guides Markdown readers to use status history for corrections and logging", () => {
    const bundle = resolve();

    expect(bundle.markdownSummary).toContain("## Status history");
    expect(bundle.markdownSummary).toContain(
      "Occurrence rows are current snapshots.",
    );
    expect(bundle.markdownSummary).toContain(
      "`recorded_at` is when Cadence logged",
    );
    expect(bundle.markdownSummary).toContain(
      "`revises_event_id` links a correction",
    );
    expect(bundle.markdownSummary).toContain("adherence-timing analysis");
    expect(bundle.markdownSummary).toContain(
      "does not change Cadence's stored status or default adherence calculation",
    );
  });

  it("exports connector completions with their D28.7 provenance unchanged (Ticket 322)", () => {
    const connectorEvent = {
      id: "event-connector",
      occurrenceId: "occurrence-1",
      behaviorId: "behavior-brush",
      previousStatus: "unresolved" as const,
      status: "completed" as const,
      statusSemantics: "system_rule_declared" as const,
      recordedAt: "2026-06-08T14:00:00Z",
      effectiveAt: "2026-06-08T13:45:00Z",
      localDate: "2026-06-08",
      timezone: DEFAULT_TIMEZONE,
      sourceCaptureMethod: "derived" as const,
      sourceConfidence: "high" as const,
      revisesEventId: null,
      reasonCode: "connector:hevy",
    };
    const bundle = resolve({ occurrences: [occurrence({ id: "occurrence-1" })], statusEvents: [connectorEvent] });
    const files = new Map(bundle.behaviorLog.files.map((file) => [file.path, file]));
    const [event] = parseJsonl(files.get("data/status_events.jsonl")?.content ?? "");
    expect(event).toMatchObject({
      status_semantics: "system_rule_declared",
      reason_code: "connector:hevy",
      effective_at_utc: "2026-06-08T13:45:00Z",
      source: expect.objectContaining({ capture_method: "derived", confidence: "high" }),
    });
    // A connector completion is not attributed to the user.
    expect(event).not.toHaveProperty("actor");
    expect(bundle.jsonBackup.status_events).toMatchObject([{
      status_semantics: "system_rule_declared", source_capture_method: "derived", source_confidence: "high", reason_code: "connector:hevy",
    }]);
  });

  it("emits a BehaviorLog bundle with required files, hashes, status events, and notes", () => {
    const bundle = resolve({
      includeNotes: true,
      occurrences: [
        occurrence({
          id: "occurrence-1",
          note: "Flossed too.",
        }),
      ],
      statusEvents: [
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
      ],
    });
    const fileByPath = new Map(
      bundle.behaviorLog.files.map((file) => [file.path, file]),
    );
    const manifest = JSON.parse(fileByPath.get("manifest.json")?.content ?? "");
    const occurrences = parseJsonl(
      fileByPath.get("data/occurrences.jsonl")?.content ?? "",
    );
    const statusEvents = parseJsonl(
      fileByPath.get("data/status_events.jsonl")?.content ?? "",
    );
    const notes = parseJsonl(fileByPath.get("data/notes.jsonl")?.content ?? "");

    expect(bundle.behaviorLog.fileName).toBe(
      "cadence-export-30-days-2026-06-08.behaviorlog.zip",
    );
    expect(bundle.behaviorLog.files.map((file) => file.path)).toEqual([
      "manifest.json",
      "schema.json",
      "README.md",
      "AGENTS.md",
      "data/behaviors.jsonl",
      "data/schedules.jsonl",
      "data/occurrences.jsonl",
      "data/status_events.jsonl",
      "data/notes.jsonl",
      "data/intervention_rules.jsonl",
      "data/behavior_definition_events.jsonl",
      "csv/behaviors.csv",
      "csv/schedules.csv",
      "csv/occurrences.csv",
      "csv/status_events.csv",
    ]);
    expect(manifest).toMatchObject({
      format: "behaviorlog.bundle",
      schema_version: "0.3.0-draft",
      subject: {
        subject_id: "subject_test",
        timezone_default: DEFAULT_TIMEZONE,
      },
      privacy: {
        subject_id_strategy: "pseudonymous",
        contains_notes: true,
      },
      profiles: ["core", "intervention", "definition_history"],
    });

    for (const manifestFile of manifest.files) {
      const file = fileByPath.get(manifestFile.path);

      expect(file).toBeDefined();
      expect(manifestFile.sha256).toBe(sha256(file?.content ?? ""));
    }

    expect(occurrences[0]).toMatchObject({
      record_type: "occurrence",
      occurrence_id: "occurrence-1",
      schedule_id: "sch_slot-brush",
      local_date: "2026-06-08",
      timezone: DEFAULT_TIMEZONE,
      current_status: "completed",
    });
    expect(statusEvents).toEqual([
      expect.objectContaining({
        record_type: "status_event",
        event_id: "event-1",
        occurrence_id: "occurrence-1",
        previous_status: "unresolved",
        status: "completed",
        status_semantics: "explicit_user_mark",
        recorded_at_utc: "2026-06-08T13:05:00Z",
        source: expect.objectContaining({
          capture_method: "manual_tap",
          confidence: "high",
        }),
      }),
    ]);
    expect(notes).toEqual([
      expect.objectContaining({
        record_type: "note",
        attached_to_type: "occurrence",
        attached_to_id: "occurrence-1",
        body_markdown: "Flossed too.",
      }),
    ]);
  });

  it("emits optional BehaviorLog CSV views that join back to authoritative JSONL records", () => {
    const bundle = resolve({
      statusEvents: [
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
      ],
    });
    const fileByPath = new Map(
      bundle.behaviorLog.files.map((file) => [file.path, file]),
    );
    const manifest = JSON.parse(fileByPath.get("manifest.json")?.content ?? "");
    const manifestByPath = new Map(
      manifest.files.map((file: Record<string, unknown>) => [file.path, file]),
    );

    const comparisons = [
      {
        jsonPath: "data/behaviors.jsonl",
        csvPath: "csv/behaviors.csv",
        idField: "behavior_id",
      },
      {
        jsonPath: "data/schedules.jsonl",
        csvPath: "csv/schedules.csv",
        idField: "schedule_id",
      },
      {
        jsonPath: "data/occurrences.jsonl",
        csvPath: "csv/occurrences.csv",
        idField: "occurrence_id",
      },
      {
        jsonPath: "data/status_events.jsonl",
        csvPath: "csv/status_events.csv",
        idField: "event_id",
      },
    ];

    for (const comparison of comparisons) {
      const manifestEntry = manifestByPath.get(comparison.csvPath);
      const csvFile = fileByPath.get(comparison.csvPath);
      const jsonRecords = parseJsonl(
        fileByPath.get(comparison.jsonPath)?.content ?? "",
      );
      const csvRows = parseCsv(csvFile?.content ?? "");

      expect(manifestEntry).toMatchObject({
        media_type: "text/csv",
        required: false,
        schema_ref: null,
        sha256: sha256(csvFile?.content ?? ""),
      });
      expect(csvRows).toHaveLength(jsonRecords.length);
      expect(csvRows.map((row) => row[comparison.idField])).toEqual(
        jsonRecords.map((record) => String(record[comparison.idField])),
      );
    }
  });

  it("escapes BehaviorLog CSV view cells and keeps extension data in one JSON string column", () => {
    const bundle = resolve({
      behaviors: [
        behavior({
          id: "behavior-brush",
          title: 'Brush, "teeth"\ncarefully',
          description: 'Use "soft", circular strokes\nbefore bed.',
          categoryName: "Grooming",
        }),
      ],
    });
    const behaviorsCsv =
      bundle.behaviorLog.files.find((file) => file.path === "csv/behaviors.csv")
        ?.content ?? "";
    const [row] = parseCsv(behaviorsCsv);

    expect(behaviorsCsv).toContain('"Brush, ""teeth""\ncarefully"');
    expect(row.title).toBe('Brush, "teeth"\ncarefully');
    expect(row.description).toBe('Use "soft", circular strokes\nbefore bed.');
    expect(Object.keys(row)).toContain("extensions");
    expect(Object.keys(row)).not.toContain("app.cadence");
    expect(JSON.parse(row.extensions)).toMatchObject({
      "app.cadence": {
        category_name: "Grooming",
        browser_reminder_enabled: true,
      },
    });
  });

  it("exports reminder deliveries as optional BehaviorLog intervention records", () => {
    const bundle = resolve({
      behaviors: [
        behavior({
          id: "behavior-brush",
          emailReminderEnabled: true,
          reminderOffsetMinutes: 60,
        }),
      ],
      occurrences: [
        occurrence({
          id: "occurrence-1",
          behaviorId: "behavior-brush",
        }),
        occurrence({
          id: "occurrence-2",
          behaviorId: "behavior-brush",
          scheduledFor: "2026-06-08T14:00:00Z",
        }),
      ],
      reminderDeliveries: [
        reminderDelivery({
          id: "delivery-pending",
          occurrenceId: "occurrence-1",
          channel: "browser_push",
          status: "pending",
          scheduledSendAt: "2026-06-08T12:45:00Z",
        }),
        reminderDelivery({
          id: "delivery-sent",
          occurrenceId: "occurrence-1",
          channel: "email",
          status: "sent",
          scheduledSendAt: "2026-06-08T12:50:00Z",
          sentAt: "2026-06-08T12:51:00Z",
        }),
        reminderDelivery({
          id: "delivery-failed",
          occurrenceId: "occurrence-2",
          channel: "email",
          status: "failed",
          scheduledSendAt: "2026-06-08T13:40:00Z",
          error:
            "Provider rejected emma@example.com endpoint https://push.example/sub p256dh=secret-key auth=auth-key token=secret-token",
        }),
        reminderDelivery({
          id: "delivery-cancelled",
          occurrenceId: "occurrence-2",
          channel: "browser_push",
          status: "cancelled",
          scheduledSendAt: "2026-06-08T13:45:00Z",
        }),
        reminderDelivery({
          id: "delivery-outside-export",
          occurrenceId: "occurrence-not-exported",
        }),
      ],
    });
    const fileByPath = new Map(
      bundle.behaviorLog.files.map((file) => [file.path, file]),
    );
    const manifest = JSON.parse(fileByPath.get("manifest.json")?.content ?? "");
    const manifestEntry = manifest.files.find(
      (file: Record<string, unknown>) =>
        file.path === "data/interventions.jsonl",
    );
    const schema = JSON.parse(fileByPath.get("schema.json")?.content ?? "");
    const interventions = parseJsonl(
      fileByPath.get("data/interventions.jsonl")?.content ?? "",
    );
    const interventionRules = parseJsonl(
      fileByPath.get("data/intervention_rules.jsonl")?.content ?? "",
    );
    const occurrenceIds = new Set(
      parseJsonl(fileByPath.get("data/occurrences.jsonl")?.content ?? "").map(
        (record) => record.occurrence_id,
      ),
    );
    const behaviorIds = new Set(
      parseJsonl(fileByPath.get("data/behaviors.jsonl")?.content ?? "").map(
        (record) => record.behavior_id,
      ),
    );

    expect(manifest.profiles).toEqual([
      "core",
      "intervention",
      "definition_history",
    ]);
    expect(manifestEntry).toMatchObject({
      path: "data/interventions.jsonl",
      media_type: "application/jsonl",
      required: false,
      schema_ref: "#/$defs/Intervention",
      sha256: sha256(fileByPath.get("data/interventions.jsonl")?.content ?? ""),
    });
    expect(schema.$defs.Intervention.properties).toHaveProperty(
      "planned_for_utc",
    );
    expect(schema.$defs.Intervention.properties).not.toHaveProperty(
      "scheduled_send_at_utc",
    );
    expect(interventionRules).toEqual([
      expect.objectContaining({
        record_type: "intervention_rule",
        rule_id: "rule_reminder_behavior-brush_browser_push",
        behavior_id: "behavior-brush",
        intervention_type: "reminder",
        channel: "browser_push",
        enabled: true,
        offset_minutes: -60,
      }),
      expect.objectContaining({
        rule_id: "rule_reminder_behavior-brush_email",
        channel: "email",
        offset_minutes: -60,
      }),
    ]);
    expect(
      interventions.map((intervention) => intervention.intervention_id),
    ).toEqual([
      "delivery-pending",
      "delivery-sent",
      "delivery-failed",
      "delivery-cancelled",
    ]);
    expect(
      interventions.map((intervention) => intervention.delivery_status),
    ).toEqual(["planned", "sent", "failed", "cancelled"]);
    expect(interventions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          intervention_id: "delivery-sent",
          occurrence_id: "occurrence-1",
          behavior_id: "behavior-brush",
          channel: "email",
          sent_at_utc: "2026-06-08T12:51:00Z",
        }),
      ]),
    );

    expect(
      interventions.find(
        (intervention) => intervention.intervention_id === "delivery-sent",
      ),
    ).not.toHaveProperty("failure_reason");
    expect(
      interventions.find(
        (intervention) => intervention.intervention_id === "delivery-pending",
      ),
    ).not.toHaveProperty("rule_id");
    expect(
      interventions.find(
        (intervention) => intervention.intervention_id === "delivery-sent",
      ),
    ).not.toHaveProperty("rule_id");

    for (const intervention of interventions) {
      expect(occurrenceIds.has(intervention.occurrence_id)).toBe(true);
      expect(behaviorIds.has(intervention.behavior_id)).toBe(true);
      expect(intervention).toHaveProperty("planned_for_utc");
      expect(intervention).not.toHaveProperty("scheduled_send_at_utc");
      expect(intervention.delivery_status).not.toBe("pending");
      expect(intervention).not.toHaveProperty("message_body");
      expect(intervention).not.toHaveProperty("endpoint");
      expect(intervention).not.toHaveProperty("p256dh");
      expect(intervention).not.toHaveProperty("auth");
    }

    const failedIntervention = interventions.find(
      (intervention) => intervention.intervention_id === "delivery-failed",
    );

    expect(failedIntervention?.failure_reason).toContain("Provider rejected");
    expect(failedIntervention?.failure_reason).not.toContain(
      "https://push.example/sub",
    );
    expect(failedIntervention?.failure_reason).not.toContain(
      "emma@example.com",
    );
    expect(failedIntervention?.failure_reason).not.toContain("secret-key");
    expect(failedIntervention?.failure_reason).not.toContain("auth-key");
    expect(failedIntervention?.failure_reason).not.toContain("secret-token");
    expect(failedIntervention?.extensions).toMatchObject({
      "app.cadence": {
        reminder_delivery_id: "delivery-failed",
      },
    });
  });

  it("keeps BehaviorLog core valid when intervention records are absent", () => {
    const bundle = resolve();
    const fileByPath = new Map(
      bundle.behaviorLog.files.map((file) => [file.path, file]),
    );
    const manifest = JSON.parse(fileByPath.get("manifest.json")?.content ?? "");

    expect(fileByPath.has("data/interventions.jsonl")).toBe(false);
    expect(manifest.profiles).toEqual([
      "core",
      "intervention",
      "definition_history",
    ]);
  });

  it("synthesizes BehaviorLog status events for resolved legacy occurrences", () => {
    const bundle = resolve({
      occurrences: [
        occurrence({
          id: "completed-without-event",
          status: "completed",
          completedAt: "2026-06-08T13:05:00Z",
          statusMarkedAt: "2026-06-08T13:05:00Z",
        }),
        occurrence({
          id: "not-completed-without-event",
          status: "not_completed",
          scheduledFor: "2026-06-08T14:00:00Z",
          completedAt: null,
          statusMarkedAt: "2026-06-08T14:05:00Z",
        }),
        occurrence({
          id: "unresolved-without-event",
          status: "unresolved",
          scheduledFor: "2026-06-08T15:00:00Z",
          completedAt: null,
          statusMarkedAt: null,
        }),
      ],
    });
    const statusEvents = parseJsonl(
      bundle.behaviorLog.files.find(
        (file) => file.path === "data/status_events.jsonl",
      )?.content ?? "",
    );

    expect(statusEvents).toHaveLength(2);
    expect(statusEvents.map((event) => event.occurrence_id)).toEqual([
      "completed-without-event",
      "not-completed-without-event",
    ]);
    expect(statusEvents).toEqual([
      expect.objectContaining({
        previous_status: "unresolved",
        status: "completed",
        status_semantics: "explicit_user_mark",
        source: expect.objectContaining({
          capture_method: "derived",
          confidence: "medium",
        }),
      }),
      expect.objectContaining({
        previous_status: "unresolved",
        status: "not_completed",
        status_semantics: "explicit_user_mark",
        source: expect.objectContaining({
          capture_method: "derived",
          confidence: "medium",
        }),
      }),
    ]);
  });

  it("calculates Markdown adherence with unresolved excluded", () => {
    const bundle = resolve({
      occurrences: [
        occurrence({ id: "completed-1", status: "completed" }),
        occurrence({
          id: "completed-2",
          status: "completed",
          scheduledFor: "2026-06-08T14:00:00Z",
        }),
        occurrence({
          id: "not-completed-1",
          status: "not_completed",
          scheduledFor: "2026-06-08T15:00:00Z",
          completedAt: null,
          statusMarkedAt: "2026-06-08T15:03:00Z",
        }),
        occurrence({
          id: "unresolved-1",
          status: "unresolved",
          scheduledFor: "2026-06-08T16:00:00Z",
          completedAt: null,
          statusMarkedAt: null,
        }),
      ],
    });

    expect(bundle.markdownSummary).toContain(
      "- Default adherence: 2 / (2 + 1) = 66.7%",
    );
    expect(bundle.markdownSummary).toContain(
      "- Brush teeth: 2 completed, 1 not completed, 1 unresolved, 66.7% adherence",
    );
    expect(bundle.overallCounts).toMatchObject({
      completedCount: 2,
      notCompletedCount: 1,
      unresolvedCount: 1,
      resolvedCount: 3,
      totalCount: 4,
    });
  });

  it("excludes archived behaviors and their occurrences by default", () => {
    const bundle = resolve({
      behaviors: [
        behavior({ id: "behavior-active", title: "Active behavior" }),
        behavior({
          id: "behavior-archived",
          title: "Archived behavior",
          active: false,
          archivedAt: "2026-06-01T12:00:00Z",
        }),
      ],
      occurrences: [
        occurrence({
          id: "active-occurrence",
          behaviorId: "behavior-active",
        }),
        occurrence({
          id: "archived-occurrence",
          behaviorId: "behavior-archived",
        }),
      ],
    });

    expect(bundle.behaviorCount).toBe(1);
    expect(bundle.occurrenceCount).toBe(1);
    expect(bundle.json).toContain("Active behavior");
    expect(bundle.json).not.toContain("Archived behavior");
  });

  it("includes archived behaviors and their occurrences when selected", () => {
    const bundle = resolve({
      includeArchived: true,
      behaviors: [
        behavior({ id: "behavior-active", title: "Active behavior" }),
        behavior({
          id: "behavior-archived",
          title: "Archived behavior",
          active: false,
          archivedAt: "2026-06-01T12:00:00Z",
        }),
      ],
      occurrences: [
        occurrence({
          id: "active-occurrence",
          behaviorId: "behavior-active",
        }),
        occurrence({
          id: "archived-occurrence",
          behaviorId: "behavior-archived",
        }),
      ],
    });

    expect(bundle.behaviorCount).toBe(2);
    expect(bundle.occurrenceCount).toBe(2);
    expect(bundle.json).toContain("Archived behavior");
  });

  it("filters occurrences by local-date range and excludes future rows", () => {
    const bundle = resolve({
      range: "7",
      occurrences: [
        occurrence({
          id: "too-old",
          localDate: "2026-05-31",
          scheduledFor: "2026-05-31T13:00:00Z",
        }),
        occurrence({
          id: "inside-range",
          localDate: "2026-06-02",
          scheduledFor: "2026-06-02T13:00:00Z",
        }),
        occurrence({
          id: "future",
          localDate: "2026-06-09",
          scheduledFor: "2026-06-09T13:00:00Z",
        }),
      ],
    });

    expect(bundle.range).toMatchObject({
      key: "7",
      startLocalDate: "2026-06-02",
      endLocalDate: "2026-06-08",
    });
    expect(bundle.jsonBackup.occurrences.map((row) => row.id)).toEqual([
      "inside-range",
    ]);
  });

  it("keeps a five-year, ten-daily-behavior export comfortably below 2 MiB", () => {
    const worstCaseBehaviors = Array.from({ length: 10 }, (_, index) =>
      behavior({
        id: `worst-behavior-${index}`,
        title: `Daily behavior ${index + 1}`,
        scheduleSlots: [
          {
            id: `worst-slot-${index}`,
            kind: "exact",
            preset: null,
            startTime: "09:00",
            endTime: null,
            sortOrder: 0,
            label: "9:00 AM",
          },
        ],
      }),
    );
    const worstCaseOccurrences: ExportOccurrenceInput[] = [];
    const worstCaseStatusEvents: ExportStatusEventInput[] = [];
    let date = Temporal.PlainDate.from("2021-01-01");
    const endDate = Temporal.PlainDate.from("2025-12-31");

    while (Temporal.PlainDate.compare(date, endDate) <= 0) {
      const localDate = date.toString();

      for (let behaviorIndex = 0; behaviorIndex < 10; behaviorIndex += 1) {
        const occurrenceId = `worst-occurrence-${behaviorIndex}-${localDate}`;
        const behaviorId = `worst-behavior-${behaviorIndex}`;
        const status = behaviorIndex % 2 === 0 ? "completed" : "not_completed";
        const markedAt = `${localDate}T14:05:00Z`;
        const noteSeed =
          `Daily reflection for behavior ${behaviorIndex + 1} on ${localDate}. ` +
          "Completed the planned routine, recorded the surrounding context, " +
          "and noted the practical details that may help explain future patterns. ";
        const note = noteSeed.repeat(Math.ceil(500 / noteSeed.length)).slice(0, 500);

        worstCaseOccurrences.push(
          occurrence({
            id: occurrenceId,
            behaviorId,
            behaviorScheduleSlotId: `worst-slot-${behaviorIndex}`,
            scheduledFor: `${localDate}T14:00:00Z`,
            localDate,
            status,
            completedAt: status === "completed" ? markedAt : null,
            statusMarkedAt: markedAt,
            note,
            createdAt: `${localDate}T13:55:00Z`,
            updatedAt: markedAt,
          }),
        );
        worstCaseStatusEvents.push({
          id: `worst-event-${behaviorIndex}-${localDate}`,
          occurrenceId,
          behaviorId,
          previousStatus: "unresolved",
          status,
          statusSemantics: "explicit_user_mark",
          recordedAt: markedAt,
          effectiveAt: markedAt,
          localDate,
          timezone: DEFAULT_TIMEZONE,
          sourceCaptureMethod: "manual_tap",
          sourceConfidence: "high",
          revisesEventId: null,
          reasonCode: null,
          createdAt: markedAt,
          updatedAt: markedAt,
        });
      }

      date = date.add({ days: 1 });
    }

    const bundle = resolveExportBundle({
      profile: {
        timezone: DEFAULT_TIMEZONE,
        subjectId: "subject_worst_case",
      },
      categories,
      behaviors: worstCaseBehaviors,
      occurrences: worstCaseOccurrences,
      statusEvents: worstCaseStatusEvents,
      reminderDeliveries: [],
      now: Temporal.Instant.from("2026-01-01T17:00:00Z"),
      timezone: DEFAULT_TIMEZONE,
      range: "all",
      includeNotes: true,
    });
    const zip = createStoredZip(bundle.behaviorLog.files);

    console.info(
      `Worst-case BehaviorLog export ZIP: ${zip.byteLength} bytes ` +
        `(${(zip.byteLength / (1024 * 1024)).toFixed(3)} MiB)`,
    );
    expect(worstCaseOccurrences).toHaveLength(18_260);
    expect(worstCaseStatusEvents).toHaveLength(18_260);
    expect(zip.byteLength).toBeLessThan(1.5 * 1024 * 1024);
  }, 30_000);

  it("exports archive history through the Cadence extension and redacts its text with notes", () => {
    const archiveNotes = [
      {
        id: "11111111-1111-4111-8111-111111111111",
        archivedAt: "2026-06-01T12:00:00Z",
        note: "Paused while traveling.",
        updatedAt: "2026-06-01T12:00:00Z",
      },
    ];
    const persistence = {
      defaultDurationMinutes: 45,
      endDate: "2026-06-01",
      autoArchivedAt: "2026-06-01T12:00:00Z",
      active: false,
      archivedAt: "2026-06-01T12:00:00Z",
    };
    const withNotes = resolve({
      behaviors: [behavior({ id: "behavior-brush", archiveNotes, ...persistence })],
      includeArchived: true,
      includeNotes: true,
    });
    const withoutNotes = resolve({
      behaviors: [behavior({ id: "behavior-brush", archiveNotes, ...persistence })],
      includeArchived: true,
      includeNotes: false,
    });
    const withNotesBehavior = parseJsonl(
      withNotes.behaviorLog.files.find((file) => file.path === "data/behaviors.jsonl")?.content ?? "",
    )[0];
    const withoutNotesBehavior = parseJsonl(
      withoutNotes.behaviorLog.files.find((file) => file.path === "data/behaviors.jsonl")?.content ?? "",
    )[0];

    expect(withNotes.jsonBackup.behaviors[0].archive_notes).toEqual([
      expect.objectContaining({ note: "Paused while traveling." }),
    ]);
    expect(withNotes.jsonBackup.behaviors[0]).toMatchObject({
      default_duration_minutes: 45,
      end_date: "2026-06-01",
      auto_archived_at: "2026-06-01T12:00:00Z",
    });
    expect(withNotesBehavior).toMatchObject({ expected_duration_minutes: 45 });
    expect(withNotesBehavior.extensions).toMatchObject({
      "app.cadence": {
        archive_notes: [{ note: "Paused while traveling." }],
        end_date: "2026-06-01",
        auto_archived_at: "2026-06-01T12:00:00Z",
      },
    });
    expect(withoutNotes.json).not.toContain("Paused while traveling.");
    expect(
      withoutNotes.behaviorLog.files.map((file) => file.content).join("\n"),
    ).not.toContain("Paused while traveling.");
    expect(withoutNotesBehavior.extensions).toMatchObject({
      "app.cadence": { archive_notes: [{ note: null }] },
    });
  });
});

function parseJsonl(content: string): Array<Record<string, unknown>> {
  return content
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function parseCsv(content: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const nextChar = content[index + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if (char === "\n" && !inQuotes) {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    if (char !== "\r" || inQuotes) {
      cell += char;
    }
  }

  row.push(cell);
  rows.push(row);

  const [headers = [], ...dataRows] = rows;

  return dataRows
    .filter((dataRow) => dataRow.some((value) => value.length > 0))
    .map((dataRow) =>
      Object.fromEntries(
        headers.map((header, index) => [header, dataRow[index] ?? ""]),
      ),
    );
}
