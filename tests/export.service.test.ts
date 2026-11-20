import { Temporal } from "@js-temporal/polyfill";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { USER_ID, BEHAVIOR_ID, storedBehavior, storedExportPageBehavior, storedConfigurationEvent, storedExportOccurrence, uuid } from "./helpers/export-row-fixture";

const mocks = vi.hoisted(() => ({
  consumeExportDownloadRateLimit: vi.fn(),
  readExportPageSummary: vi.fn(),
  createClient: vi.fn(),
  requireCurrentUserId: vi.fn(),
  readCachedProfileTimezone: vi.fn(),
  readCachedUserBehaviors: vi.fn(),
  listBehaviorDefinitionEvents: vi.fn(),
  listBehaviorConfigurationEvents: vi.fn(),
  readExportPageBundle: vi.fn(),
  ensureUserOccurrencesFresh: vi.fn(),
  listTimeSessionHistory: vi.fn(),
  listTimeSessionsByOccurrenceIds: vi.fn(),
  listAppliedBehaviorLogImportRuns: vi.fn(), listBehaviorLogImportRecordMappings: vi.fn(),
  listImportedNotes: vi.fn(), listImportedInterventions: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

vi.mock("@/lib/auth/current-user", () => ({
  requireCurrentUserId: mocks.requireCurrentUserId,
}));

vi.mock("@/lib/cache/stable-user-data.cache", () => ({
  readCachedProfileTimezone: mocks.readCachedProfileTimezone,
  readCachedUserBehaviors: mocks.readCachedUserBehaviors,
}));

vi.mock("@/lib/db/behaviorDefinitionEvents.repo", () => ({
  listBehaviorDefinitionEvents: mocks.listBehaviorDefinitionEvents,
}));

vi.mock("@/lib/db/behaviorConfigurationEvents.repo", () => ({
  listBehaviorConfigurationEvents: mocks.listBehaviorConfigurationEvents,
}));

vi.mock("@/lib/db/exportPageRead.repo", () => ({
  readExportPageBundle: mocks.readExportPageBundle,
  readExportPageSummary: mocks.readExportPageSummary,
}));

vi.mock("@/lib/db/occurrenceMoves.repo", () => ({ listOccurrenceMovesForExport: async () => [] }));
vi.mock("@/lib/services/occurrence.service", () => ({
  ensureUserOccurrencesFresh: mocks.ensureUserOccurrencesFresh,
}));

vi.mock("@/lib/db/timeSessions.repo", () => ({
  listTimeSessionHistory: mocks.listTimeSessionHistory,
  listTimeSessionsByOccurrenceIds: mocks.listTimeSessionsByOccurrenceIds,
}));
vi.mock("@/lib/db/behaviorLogImports.repo", () => ({ listAppliedBehaviorLogImportRuns: mocks.listAppliedBehaviorLogImportRuns, listBehaviorLogImportRecordMappings: mocks.listBehaviorLogImportRecordMappings }));
vi.mock("@/lib/db/notes.repo", () => ({ listImportedNotes: mocks.listImportedNotes }));
vi.mock("@/lib/db/importedInterventions.repo", () => ({ listImportedInterventions: mocks.listImportedInterventions }));

vi.mock("@/lib/db/launchRateLimits.repo", () => ({ consumeExportDownloadRateLimit: mocks.consumeExportDownloadRateLimit }));

describe("getUserExportBundle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.consumeExportDownloadRateLimit.mockResolvedValue({ allowed: true });
    mocks.listAppliedBehaviorLogImportRuns.mockResolvedValue([]); mocks.listBehaviorLogImportRecordMappings.mockResolvedValue([]);
    mocks.listImportedNotes.mockResolvedValue([]); mocks.listImportedInterventions.mockResolvedValue([]);
    mocks.createClient.mockResolvedValue({});
    mocks.requireCurrentUserId.mockResolvedValue(USER_ID);
    mocks.readCachedProfileTimezone.mockResolvedValue("America/New_York");
    mocks.readCachedUserBehaviors.mockResolvedValue([storedBehavior()]);
    mocks.listBehaviorDefinitionEvents.mockResolvedValue([
      {
        id: "definition-1",
        user_id: USER_ID,
        behavior_id: BEHAVIOR_ID,
        previous_title: null,
        next_title: "Brush teeth",
        previous_description: null,
        next_description: "Night brushing",
        changed_fields: ["title", "description"],
        recorded_at: "2026-05-01T12:00:00Z",
        source: "system",
        reason: "baseline_backfill",
        created_at: "2026-05-01T12:00:00Z",
        updated_at: "2026-05-01T12:00:00Z",
      },
    ]);
    mocks.listBehaviorConfigurationEvents.mockResolvedValue([
      storedConfigurationEvent(),
    ]);
    mocks.readExportPageBundle.mockResolvedValue({
      profile: null,
      syncState: null,
      categories: [],
      behaviors: [storedExportPageBehavior()],
      occurrences: [],
      statusEvents: [],
      reminderDeliveries: [],
    });
    mocks.ensureUserOccurrencesFresh.mockResolvedValue({ synced: false });
    mocks.listTimeSessionHistory.mockResolvedValue([]);
  });

  it("opens Export with counts only, without artifact reads or rate-limit consumption", async () => {
    mocks.readExportPageSummary.mockResolvedValue({ behavior_count: 2, completed_count: 3,
      not_completed_count: 1, unresolved_count: 6, time_session_count: 5 });
    const { getExportPageData } = await import("../lib/services/export.service");
    const page = await getExportPageData({ now: Temporal.Instant.from("2026-06-08T16:00:00Z"),
      range: "all", includeTimeTracking: true });
    expect(page).toMatchObject({ behaviorCount: 2, occurrenceCount: 10,
      overallAdherenceLabel: "75%", timeSessionCount: 5 });
    expect(page).not.toHaveProperty("markdownSummary");
    expect(page).not.toHaveProperty("json");
    for (const fn of [mocks.readExportPageBundle, mocks.listBehaviorDefinitionEvents,
      mocks.listBehaviorConfigurationEvents, mocks.listTimeSessionHistory,
      mocks.listAppliedBehaviorLogImportRuns, mocks.ensureUserOccurrencesFresh,
      mocks.consumeExportDownloadRateLimit]) expect(fn).not.toHaveBeenCalled();
    expect(mocks.readExportPageSummary).toHaveBeenCalledWith(expect.anything(), {
      startLocalDate: null, endLocalDate: "9999-12-31", includeArchived: false, includeTimeTracking: true,
      throughStartedAt: "2026-06-08T16:00:00Z",
    });
  });

  it("loads user-scoped definition events and maps them into every rich export", async () => {
    const { getUserExportBundle } =
      await import("../lib/services/export.service");
    const bundle = await getUserExportBundle({
      now: Temporal.Instant.from("2026-06-08T16:00:00Z"),
      range: "all",
    });

    expect(mocks.listBehaviorDefinitionEvents).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
    );
    expect(bundle.jsonBackup.behavior_definition_events).toEqual([
      expect.objectContaining({
        id: "definition-1",
        behavior_id: BEHAVIOR_ID,
        next_title: "Brush teeth",
        next_description: "Night brushing",
        changed_fields: ["title", "description"],
        source: "system",
        reason: "baseline_backfill",
      }),
    ]);
    expect(bundle.jsonBackup.behavior_configuration_events).toEqual([
      expect.objectContaining({
        id: "configuration-1",
        behavior_id: BEHAVIOR_ID,
        event_kind: "baseline",
        reason_code: "history_capture_started",
      }),
    ]);
    expect(bundle.behaviorConfigurationEventCount).toBe(1);
    expect(bundle.markdownSummary).toContain(
      "Behavior definition history: included (1 event)",
    );
    expect(
      bundle.behaviorLog.files.find(
        (file) => file.path === "data/behavior_definition_events.jsonl",
      )?.content,
    ).toContain('"event_id":"definition-1"');
  });

  it("uses complete materialized standard histories above the Data API cap", async () => {
    const recordedAt = Temporal.Instant.from("2026-05-01T12:00:00Z");
    const definitionEvents = Array.from({ length: 1_001 }, (_, index) => ({
      id: uuid(index + 10_000),
      user_id: USER_ID,
      behavior_id: BEHAVIOR_ID,
      previous_title: index === 0 ? null : `Brush teeth ${index - 1}`,
      next_title: `Brush teeth ${index}`,
      previous_description: null,
      next_description: null,
      changed_fields: ["title"],
      recorded_at: recordedAt.add({ seconds: index }).toString(),
      source: "system",
      reason: "history",
      created_at: recordedAt.add({ seconds: index }).toString(),
      updated_at: recordedAt.add({ seconds: index }).toString(),
    }));
    const occurrence = storedExportOccurrence();
    const timeSessions = Array.from({ length: 1_001 }, (_, index) => ({
      id: uuid(index + 20_000),
      user_id: USER_ID,
      occurrence_id: occurrence.id,
      behavior_id: BEHAVIOR_ID,
      started_at: recordedAt.add({ seconds: index }).toString(),
      stopped_at: recordedAt.add({ seconds: index + 1 }).toString(),
    }));
    mocks.listBehaviorDefinitionEvents.mockResolvedValue(definitionEvents);
    mocks.listTimeSessionHistory.mockResolvedValue(timeSessions);
    mocks.readExportPageBundle.mockResolvedValue({
      profile: null,
      syncState: null,
      categories: [],
      behaviors: [storedExportPageBehavior()],
      occurrences: [occurrence],
      statusEvents: [],
      reminderDeliveries: [],
    });
    const { getUserExportBundle } =
      await import("../lib/services/export.service");

    const bundle = await getUserExportBundle({
      now: Temporal.Instant.from("2026-06-08T16:00:00Z"),
      range: "all",
      includeTimeTracking: true,
    });
    const definitionFile = bundle.behaviorLog.files.find(
      (file) => file.path === "data/behavior_definition_events.jsonl",
    );
    const timeSessionFile = bundle.behaviorLog.files.find(
      (file) => file.path === "data/time_sessions.jsonl",
    );

    expect(bundle.jsonBackup.behavior_definition_events).toHaveLength(1_001);
    expect(bundle.jsonBackup.time_sessions).toHaveLength(1_001);
    expect(definitionFile?.content.split("\n")).toHaveLength(1_001);
    expect(timeSessionFile?.content.split("\n")).toHaveLength(1_001);
  });

  it("fails when a final Behavior pointer no longer matches the captured history", async () => {
    mocks.readExportPageBundle.mockResolvedValue({
      profile: null,
      syncState: null,
      categories: [],
      behaviors: [
        {
          ...storedExportPageBehavior(),
          current_configuration_event_id: "configuration-2",
        },
      ],
      occurrences: [],
      statusEvents: [],
      reminderDeliveries: [],
    });
    const { getUserExportBundle } =
      await import("../lib/services/export.service");

    await expect(
      getUserExportBundle({
        now: Temporal.Instant.from("2026-06-08T16:00:00Z"),
        range: "all",
      }),
    ).rejects.toThrow("Behavior configuration changed during export");
  });

  it("does not read timing rows unless the exact time-tracking option is enabled", async () => {
    const { getUserExportBundle } =
      await import("../lib/services/export.service");

    await getUserExportBundle({
      now: Temporal.Instant.from("2026-06-08T16:00:00Z"),
      range: "all",
    });

    expect(mocks.listTimeSessionHistory).not.toHaveBeenCalled();

    await getUserExportBundle({
      now: Temporal.Instant.from("2026-06-08T16:00:00Z"),
      range: "all",
      includeTimeTracking: true,
    });

    expect(mocks.listTimeSessionHistory).toHaveBeenCalledWith(
      expect.anything(),
      {
        userId: USER_ID,
        startLocalDate: null,
        endLocalDate: "9999-12-31",
        includeArchived: false,
        throughStartedAt: "2026-06-08T16:00:00Z",
      },
    );
    expect(mocks.listTimeSessionsByOccurrenceIds).not.toHaveBeenCalled();
  });
});
