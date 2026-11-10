import { Temporal } from "@js-temporal/polyfill";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getLocalExportDownload, getLocalExportPageData } from "../apps/desktop/src/local-export.service";
import { readZipEntries } from "../lib/services/zip";
import type { Profile } from "../lib/types/database";
import { USER_ID, storedBehavior, storedConfigurationEvent, storedExportOccurrence } from "./helpers/export-row-fixture";

const mocks = vi.hoisted(() => ({ command: vi.fn(), fresh: vi.fn() }));
vi.mock("../apps/desktop/src/local-store", () => ({ localCommand: mocks.command }));
vi.mock("../apps/desktop/src/local-generation.service", async (original) => ({
  ...await original<typeof import("../apps/desktop/src/local-generation.service")>(), ensureLocalOccurrencesFresh: mocks.fresh,
}));
const now = Temporal.Instant.from("2026-06-08T16:00:00Z");
const profile = { id: USER_ID, timezone: "America/New_York" } as Profile;

beforeEach(() => {
  vi.resetAllMocks();
  const row = storedBehavior();
  const { category, schedules, schedule_slots, ...behavior } = row;
  void category; void schedule_slots;
  mocks.command.mockResolvedValue({ categories: [], graphs: [{ behavior, schedules, slots: [], revision: 1 }],
    behaviorDefinitionEvents: [], behaviorConfigurationEvents: [{
      id: "configuration-1", behavior_id: row.id, event_kind: "baseline", previous_configuration: null,
      next_configuration: { categoryId: null, scheduleGraph: [{ recurrenceRule: { frequency: "daily", interval: 1 },
        sortOrder: 0, timeEntries: [{ kind: "exact", preset: null, startTime: "22:00:00", endTime: null, sortOrder: 0 }] }],
        browserReminderEnabled: true, emailReminderEnabled: false, reminderOffsetMinutes: 0, active: true, timezone: row.timezone },
      changed_fields: ["schedule_graph"], recorded_at: row.created_at, effective_at: row.created_at,
      effective_local_date: "2026-05-01", timezone: row.timezone, source: "manual", reason_code: "behavior_created", created_at: row.created_at,
    }], occurrences: [{ ...storedExportOccurrence(), note: "Private note" }],
    statusEvents: [], reminderDeliveries: [], timeSessions: [], nativeReminders: [{
      id: "native-1", user_id: USER_ID, occurrence_id: storedExportOccurrence().id, request_id: "native-request",
      fire_at: "2026-05-01T22:00:00Z", title: "Private title", body: "Private body", error: "Private error",
      status: "scheduled", verified_at: row.created_at, created_at: row.created_at, updated_at: row.updated_at,
    }],
  });
});

describe("desktop export read and download", () => {
  it.each(["hosted", "mixed"])("preserves %s configuration history in the page and every download format", async (shape) => {
    const snapshot = await mocks.command();
    const event = snapshot.behaviorConfigurationEvents[0];
    const native = event.next_configuration;
    const hosted = storedConfigurationEvent().next_configuration;
    snapshot.behaviorConfigurationEvents = [
      { ...event, id: "configuration-baseline" },
      { ...event, event_kind: "revision", previous_configuration: native },
    ];
    const options = { now, range: "all", includeNotes: true };
    const expected = await getLocalExportPageData(profile, options);
    const formats = ["jsonl", "csv", "json", "markdown", "behaviorlog"] as const;
    const downloads = await Promise.all(formats.map((format) => getLocalExportDownload(profile, format, options)));
    snapshot.behaviorConfigurationEvents[0].next_configuration = hosted;
    snapshot.behaviorConfigurationEvents[1].previous_configuration = hosted;
    if (shape === "hosted") snapshot.behaviorConfigurationEvents[1].next_configuration = hosted;
    const before = structuredClone(snapshot);

    expect(await getLocalExportPageData(profile, options)).toEqual(expected);
    for (const [index, format] of formats.entries()) {
      expect(await getLocalExportDownload(profile, format, options)).toEqual(downloads[index]);
    }
    expect(snapshot).toEqual(before);
  });

  it.each(["schedule", "reminder"])("rejects malformed hosted %s data instead of exporting partial history", async (field) => {
    const snapshot = await mocks.command();
    const configuration = storedConfigurationEvent().next_configuration;
    const invalid = field === "schedule"
      ? { ...configuration, schedule_graph: [{ ...configuration.schedule_graph[0], time_entries: null }] }
      : { ...configuration, browser_reminder_enabled: "true" };
    snapshot.behaviorConfigurationEvents[0].next_configuration = invalid;
    await expect(getLocalExportDownload(profile, "json", { now, range: "all" })).rejects.toThrow(
      field === "schedule" ? "Invalid configuration time_entries." : "Invalid configuration browser_reminder_enabled.",
    );
  });

  it("reads saved all-time records without generating future occurrences and defaults sensitive options off", async () => {
    const bundle = await getLocalExportPageData(profile, { now, range: "all" });
    expect(mocks.fresh).not.toHaveBeenCalled();
    expect(mocks.command).toHaveBeenCalledExactlyOnceWith("readExportSnapshot", {
      profileId: USER_ID, startLocalDate: null, endLocalDate: "9999-12-31", includeTimeTracking: false,
      throughStartedAt: now.toString(),
    });
    expect(bundle.jsonBackup.occurrences[0].note).toBeNull();
    expect(bundle.jsonBackup).not.toHaveProperty("time_sessions");
    expect(bundle.jsonBackup.behavior_configuration_events[0]).toMatchObject({ id: "configuration-1" });
    const contents = bundle.behaviorLog.files.map(({ content }) => content).join("\n");
    expect(contents).not.toContain(USER_ID);
    expect(contents).not.toMatch(/Private (note|title|body|error)/);
  });

  it("exports local day notes only when notes are included", async () => {
    const snapshot = await mocks.command();
    snapshot.dayNotes = [{ id: "50000000-0000-4000-8000-000000000001", user_id: USER_ID, local_date: "2026-08-31", note: "Private day note",
      revision: 1, created_at: "2026-08-31T12:00:00Z", updated_at: "2026-08-31T12:00:00Z" }];
    mocks.command.mockResolvedValue(snapshot);
    expect((await getLocalExportPageData(profile, { now, range: "all" })).jsonBackup).not.toHaveProperty("day_notes");
    const bundle = await getLocalExportPageData(profile, { now, range: "all", includeNotes: true });
    expect(bundle.jsonBackup.day_notes).toEqual([expect.objectContaining({ local_date: "2026-08-31", note: "Private day note" })]);
    expect(bundle.behaviorLog.files.find(({ path }) => path === "data/reviews.jsonl")?.content).toContain("Private day note");
  });

  it.each(["jsonl", "csv", "json", "markdown", "behaviorlog"] as const)("produces a %s payload without filesystem or browser download side effects", async (format) => {
    const payload = await getLocalExportDownload(profile, format, { now, range: "all", includeNotes: true });
    if (format === "behaviorlog") {
      expect(payload.mimeType).toBe("application/zip");
      expect(payload.filename).toMatch(/\.behaviorlog\.zip$/);
      const entries = readZipEntries(payload.bytes!);
      expect(entries.some(({ path }) => path === "raw/cadence/native_reminders.jsonl")).toBe(true);
      expect(entries.find(({ path }) => path === "data/notes.jsonl")?.content).toContain("Private note");
    } else {
      expect(payload.text).toContain("Private note");
      expect(payload.bytes).toBeUndefined();
      expect(payload.filename).toMatch(format === "markdown" ? /\.md$/ : new RegExp(`\\.${format}$`));
    }
  });

  it("propagates snapshot failure and never substitutes a partial export", async () => {
    mocks.command.mockRejectedValueOnce(new Error("history row ceiling"));
    await expect(getLocalExportDownload(profile, "json", { now })).rejects.toThrow("history row ceiling");
  });
});
