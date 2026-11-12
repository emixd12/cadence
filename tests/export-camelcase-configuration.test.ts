import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";
import { assembleExportBundle, type ExportAssemblyInput } from "@cadence/core/services/export-assembly";
import { toStoredConfigurationSnapshot } from "@cadence/core/services/configuration-payload";
import type { Json } from "@cadence/core/types/json";
import { USER_ID, storedBehavior, storedConfigurationEvent, storedExportOccurrence } from "./helpers/export-row-fixture";

// Defect D2 (Ticket 292 acceptance): Cadence for Mac keeps configuration snapshots in its
// camelCase shape and account sync uploaded them unchanged, so hosted history holds both shapes.
function macSnapshot(overrides: Record<string, Json> = {}): Json {
  return {
    categoryId: null, locationText: null, whereKind: null,
    scheduleGraph: [{ recurrenceRule: { frequency: "daily", interval: 1 }, sortOrder: 0,
      timeEntries: [{ kind: "exact", preset: null, startTime: "22:00:00", endTime: null, sortOrder: 0 }] }],
    browserReminderEnabled: true, emailReminderEnabled: false, reminderOffsetMinutes: 0,
    active: true, timezone: "America/New_York", ...overrides,
  };
}

const input: ExportAssemblyInput = {
  userId: USER_ID, timezone: "America/New_York", now: Temporal.Instant.from("2026-06-08T16:00:00Z"), range: "all",
  categories: [], behaviors: [storedBehavior()], behaviorDefinitionEvents: [],
  behaviorConfigurationEvents: [storedConfigurationEvent()], occurrences: [storedExportOccurrence()],
  statusEvents: [], reminderDeliveries: [], timeSessions: [],
};

describe("camelCase configuration history (defect D2)", () => {
  it("exports a Mac-written baseline exactly like the hosted snake_case row", () => {
    const hosted = assembleExportBundle(input);
    const mac = assembleExportBundle({ ...input, behaviorConfigurationEvents: [{
      ...storedConfigurationEvent(), next_configuration: macSnapshot({ locationText: undefined as never, whereKind: undefined as never }),
    }] });
    expect([mac.json, mac.jsonl, mac.csv, mac.markdownSummary]).toEqual([hosted.json, hosted.jsonl, hosted.csv, hosted.markdownSummary]);
    expect(mac.behaviorLog.files).toEqual(hosted.behaviorLog.files);
  });

  it("exports a Mac-written revision with camelCase previous and next snapshots", () => {
    const revision = {
      ...storedConfigurationEvent(), id: "configuration-2", event_kind: "revision",
      previous_configuration: macSnapshot(), next_configuration: macSnapshot({ reminderOffsetMinutes: 15 }),
      changed_fields: ["reminder_offset_minutes"], recorded_at: "2026-05-02T12:00:00Z", effective_at: "2026-05-02T12:00:00Z",
      effective_local_date: "2026-05-02",
    };
    const bundle = assembleExportBundle({ ...input, behaviorConfigurationEvents: [storedConfigurationEvent(), revision] });
    const event = bundle.jsonBackup.behavior_configuration_events.find(({ id }) => id === "configuration-2");
    expect(event?.previous_configuration?.reminder_offset_minutes).toBe(0);
    expect(event?.next_configuration.reminder_offset_minutes).toBe(15);
    expect(event?.next_configuration.schedule_graph[0].time_entries[0].start_time).toBe("22:00");
  });
});

describe("toStoredConfigurationSnapshot", () => {
  it("returns hosted snake_case snapshots unchanged", () => {
    const snapshot = storedConfigurationEvent().next_configuration;
    expect(toStoredConfigurationSnapshot(snapshot)).toBe(snapshot);
  });

  it("maps every camelCase key to the hosted shape", () => {
    expect(toStoredConfigurationSnapshot(macSnapshot({ categoryId: "category-1", locationText: "Gym", whereKind: "place" }))).toEqual({
      category_id: "category-1", location_text: "Gym", where_kind: "place",
      schedule_graph: [{ recurrence_rule: { frequency: "daily", interval: 1 }, sort_order: 0,
        time_entries: [{ kind: "exact", preset: null, start_time: "22:00:00", end_time: null, sort_order: 0 }] }],
      browser_reminder_enabled: true, email_reminder_enabled: false, reminder_offset_minutes: 0,
      active: true, timezone: "America/New_York",
    });
  });

  it("leaves Where absent when an older Mac snapshot has no whereKind", () => {
    const older = { ...(macSnapshot() as Record<string, Json>) };
    delete older.whereKind;
    expect(toStoredConfigurationSnapshot(older)).not.toHaveProperty("where_kind");
  });

  it("rejects snapshots in neither shape", () => {
    expect(() => toStoredConfigurationSnapshot([])).toThrow("Invalid configuration snapshot.");
    expect(() => toStoredConfigurationSnapshot({ scheduleGraph: "x" })).toThrow("Invalid configuration schedule graph.");
  });
});
