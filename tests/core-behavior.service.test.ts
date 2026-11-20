import { describe, expect, it, vi } from "vitest";

import type {
  BehaviorDataStore,
} from "../packages/core/src/behavior-store";
import {
  createBehavior, setBehaviorActive, updateBehavior, updateBehaviorArchiveNote,
} from "../packages/core/src/services/behavior.service";

import { recordedAt, stored, values } from "./helpers/behavior-graph-fixture";

function store(behavior = stored) {
  const adapter = {
    getBehaviorById: vi.fn().mockResolvedValue(behavior),
    createBehaviorWithAtomicScheduleGraph: vi.fn().mockResolvedValue(behavior),
    updateBehaviorWithAtomicScheduleGraph: vi.fn().mockResolvedValue(behavior),
  } satisfies BehaviorDataStore;
  return adapter;
}

describe("shared Behavior orchestration", () => {
  it("commits a complete graph and both baselines before reading the created Behavior", async () => {
    const adapter = store();
    const result = await createBehavior(adapter, { values, userId: "owner", timezone: "America/New_York", recordedAt });
    expect(result).toBe(stored);
    expect(adapter.createBehaviorWithAtomicScheduleGraph).toHaveBeenCalledWith(expect.objectContaining({
      behavior: expect.objectContaining({ user_id: "owner", title: "Read", active: true, archived_at: null }),
      definitionEventPlan: expect.objectContaining({ previousTitle: null, nextTitle: "Read", recordedAt }),
      configurationEventPlan: expect.objectContaining({ eventKind: "baseline", reasonCode: "behavior_created" }),
      schedules: [{
        id: "schedule", recurrence_rule: { frequency: "daily", interval: 1 }, sort_order: 0,
        slots: [{ id: "slot", kind: "exact", preset: null, start_time: "09:00", end_time: null, sort_order: 0 }],
      }],
    }));
    expect(adapter.getBehaviorById).toHaveBeenCalledWith("behavior");
    expect(adapter.createBehaviorWithAtomicScheduleGraph.mock.invocationCallOrder[0])
      .toBeLessThan(adapter.getBehaviorById.mock.invocationCallOrder[0]!);
  });

  it("preserves raw predecessor text and browser revision for a normalized no-op", async () => {
    const adapter = store({ ...stored, title: " Read ", description: " A chapter " });
    await updateBehavior(adapter, { behaviorId: "behavior", expectedUpdatedAt: "older-browser-revision", values, recordedAt });
    expect(adapter.updateBehaviorWithAtomicScheduleGraph).toHaveBeenCalledWith(expect.objectContaining({
      expectedUpdatedAt: "older-browser-revision",
      expectedDefinition: { title: " Read ", description: " A chapter " },
      expectedNormalizedDefinition: { title: "Read", description: "A chapter" },
      definitionEventPlan: null, configurationEventPlan: null,
      behavior: expect.objectContaining({ title: " Read ", description: " A chapter ", timezone: "America/New_York" }),
    }));
  });

  it("plans clearing a description and schedule changes without losing graph preconditions", async () => {
    const adapter = store();
    await updateBehavior(adapter, {
      behaviorId: "behavior", expectedUpdatedAt: stored.updated_at, recordedAt,
      values: { ...values, description: null, schedules: [{ ...values.schedules[0]!, timeEntries: [{ ...values.schedules[0]!.timeEntries[0]!, startTime: "10:00" }] }] },
    });
    const commit = adapter.updateBehaviorWithAtomicScheduleGraph.mock.calls[0]![0];
    expect(commit.behavior.description).toBeNull();
    expect(commit.definitionEventPlan).toMatchObject({ nextDescription: null, changedFields: ["description"] });
    expect(commit.configurationEventPlan).toMatchObject({ changedFields: ["schedule_graph"], reasonCode: "behavior_edited" });
    expect(commit.expectedScheduleGraph[0].slots[0].start_time).toBe("09:00");
    expect(commit.schedules[0].slots[0].start_time).toBe("10:00");
  });

  it("records a blank archive entry when a generic edit deactivates an active behavior", async () => {
    const adapter = store();
    await updateBehavior(adapter, {
      behaviorId: "behavior", expectedUpdatedAt: stored.updated_at, recordedAt,
      newArchiveNoteId: "33333333-3333-4333-8333-333333333333",
      values: { ...values, active: false },
    });
    expect(adapter.updateBehaviorWithAtomicScheduleGraph.mock.calls[0]![0].behavior.archive_notes).toEqual([{
      id: "33333333-3333-4333-8333-333333333333",
      archived_at: "2026-08-30T16:00:00Z",
      note: null,
      updated_at: "2026-08-30T16:00:00Z",
    }]);
  });

  it("archives and restores with the stored revision and no definition event", async () => {
    const adapter = store();
    await setBehaviorActive(adapter, {
      behaviorId: "behavior", active: false, expectedUpdatedAt: stored.updated_at,
      recordedAt, newArchiveNoteId: "11111111-1111-4111-8111-111111111111", archiveNote: "  Pausing  ",
    });
    expect(adapter.updateBehaviorWithAtomicScheduleGraph).toHaveBeenCalledWith(expect.objectContaining({
      expectedUpdatedAt: stored.updated_at, definitionEventPlan: null,
      behavior: expect.objectContaining({ active: false, archived_at: recordedAt, archive_notes: [{
        id: "11111111-1111-4111-8111-111111111111", archived_at: "2026-08-30T16:00:00Z",
        note: "Pausing", updated_at: "2026-08-30T16:00:00Z",
      }] }),
      configurationEventPlan: expect.objectContaining({ changedFields: ["active"], reasonCode: "behavior_archived" }),
    }));
    const archived = { ...stored, active: false, archived_at: "2026-08-20T00:00:00Z", archive_notes: [{
      id: "22222222-2222-4222-8222-222222222222", archived_at: "2026-08-20T00:00:00Z",
      note: null, updated_at: "2026-08-20T00:00:00Z",
    }] };
    adapter.getBehaviorById.mockResolvedValue(archived);
    await setBehaviorActive(adapter, { behaviorId: "behavior", active: false, expectedUpdatedAt: archived.updated_at, recordedAt });
    expect(adapter.updateBehaviorWithAtomicScheduleGraph.mock.lastCall![0]).toMatchObject({
      behavior: { archived_at: archived.archived_at }, configurationEventPlan: null,
    });
    await setBehaviorActive(adapter, { behaviorId: "behavior", active: true, expectedUpdatedAt: archived.updated_at, recordedAt });
    expect(adapter.updateBehaviorWithAtomicScheduleGraph.mock.lastCall![0]).toMatchObject({
      behavior: { active: true, archived_at: null, archive_notes: archived.archive_notes },
      configurationEventPlan: { reasonCode: "behavior_restored" },
    });
    adapter.getBehaviorById.mockResolvedValue({ ...archived, active: true, archived_at: null });
    await setBehaviorActive(adapter, {
      behaviorId: "behavior", active: false, expectedUpdatedAt: archived.updated_at, recordedAt,
      newArchiveNoteId: "33333333-3333-4333-8333-333333333333", archiveNote: "Again",
    });
    expect(adapter.updateBehaviorWithAtomicScheduleGraph.mock.lastCall![0].behavior.archive_notes).toHaveLength(2);
  });

  it("edits or removes one retained archive note with the submitted stale-write guard", async () => {
    const archived = { ...stored, active: false, archived_at: "2026-08-20T00:00:00Z", archive_notes: [{
      id: "22222222-2222-4222-8222-222222222222", archived_at: "2026-08-20T00:00:00Z",
      note: "Old", updated_at: "2026-08-20T00:00:00Z",
    }] };
    const adapter = store(archived);
    await updateBehaviorArchiveNote(adapter, {
      behaviorId: archived.id,
      archiveNoteId: "22222222-2222-4222-8222-222222222222",
      note: "  ", expectedUpdatedAt: "browser-revision", recordedAt,
    });
    expect(adapter.updateBehaviorWithAtomicScheduleGraph).toHaveBeenCalledWith(expect.objectContaining({
      expectedUpdatedAt: "browser-revision",
      definitionEventPlan: null,
      configurationEventPlan: null,
      behavior: expect.objectContaining({ archive_notes: [{
        id: "22222222-2222-4222-8222-222222222222", archived_at: "2026-08-20T00:00:00Z",
        note: null, updated_at: "2026-08-30T16:00:00Z",
      }] }),
    }));
  });

  it("propagates atomic conflicts and rejects missing rows without follow-up writes", async () => {
    const adapter = store();
    adapter.updateBehaviorWithAtomicScheduleGraph.mockRejectedValueOnce(new Error("Behavior schedule graph changed after it was read."));
    await expect(updateBehavior(adapter, { behaviorId: "behavior", expectedUpdatedAt: stored.updated_at, values, recordedAt }))
      .rejects.toThrow("Behavior schedule graph changed after it was read.");
    expect(adapter.updateBehaviorWithAtomicScheduleGraph).toHaveBeenCalledOnce();
    adapter.getBehaviorById.mockResolvedValue(null);
    await expect(setBehaviorActive(adapter, { behaviorId: "missing", active: false, expectedUpdatedAt: stored.updated_at,
      recordedAt, newArchiveNoteId: "11111111-1111-4111-8111-111111111111" })).rejects.toThrow("Behavior not found.");
    expect(adapter.updateBehaviorWithAtomicScheduleGraph).toHaveBeenCalledOnce();
  });
});

it("preserves planning fields across ordinary edits and archive-note writes", async () => {
  const existing = { ...stored, default_duration_minutes: 45, end_date: "2026-09-18", auto_archived_at: null };
  const adapter = store(existing);
  await updateBehavior(adapter, { behaviorId: stored.id, expectedUpdatedAt: stored.updated_at, values, recordedAt });
  expect(adapter.updateBehaviorWithAtomicScheduleGraph.mock.lastCall![0].behavior).toMatchObject({
    default_duration_minutes: 45, end_date: "2026-09-18", auto_archived_at: null,
  });
  await updateBehavior(adapter, { behaviorId: stored.id, expectedUpdatedAt: stored.updated_at,
    values: { ...values, defaultDurationMinutes: null, endDate: null }, recordedAt });
  expect(adapter.updateBehaviorWithAtomicScheduleGraph.mock.lastCall![0].behavior).toMatchObject({ default_duration_minutes: null, end_date: null });
});

it("records automatic archive once and clears an expired end date on restore", async () => {
  const archivedAt = "2026-09-18T12:00:00Z";
  const adapter = store({ ...stored, end_date: "2026-09-18", default_duration_minutes: 30 });
  await setBehaviorActive(adapter, { behaviorId: stored.id, active: false, automatic: true,
    recordedAt: archivedAt, effectiveAt: "2026-09-18T04:00:00Z", newArchiveNoteId: "11111111-1111-4111-8111-111111111111" });
  const commit = adapter.updateBehaviorWithAtomicScheduleGraph.mock.lastCall![0];
  expect(commit.behavior).toMatchObject({ active: false, auto_archived_at: archivedAt, end_date: "2026-09-18", default_duration_minutes: 30 });
  expect(commit.configurationEventPlan).toMatchObject({ source: "system", effectiveAt: "2026-09-18T04:00:00Z", reasonCode: "behavior_end_date_reached" });
  adapter.getBehaviorById.mockResolvedValue({ ...stored, ...commit.behavior });
  await setBehaviorActive(adapter, { behaviorId: stored.id, active: false, automatic: true, recordedAt: archivedAt });
  expect(adapter.updateBehaviorWithAtomicScheduleGraph).toHaveBeenCalledTimes(1);
  await setBehaviorActive(adapter, { behaviorId: stored.id, active: true, recordedAt: archivedAt });
  expect(adapter.updateBehaviorWithAtomicScheduleGraph.mock.lastCall![0].behavior).toMatchObject({ active: true, end_date: null, auto_archived_at: null, default_duration_minutes: 30 });
});

it("clears an expired date when the edit form restores a Behavior", async () => {
  const adapter = store({ ...stored, active: false, end_date: "2026-08-29", auto_archived_at: recordedAt });
  await updateBehavior(adapter, { behaviorId: stored.id, expectedUpdatedAt: stored.updated_at, recordedAt,
    values: { ...values, active: true, endDate: "2026-08-29" } });
  expect(adapter.updateBehaviorWithAtomicScheduleGraph.mock.lastCall![0].behavior).toMatchObject({ active: true, end_date: null, auto_archived_at: null });
});

describe("End date must come after today", () => {
  // recordedAt in the fixture; the Behavior's timezone decides "today".
  const today = (timezone: string) => new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date(recordedAt));
  const addDays = (date: string, days: number) => {
    const [year, month, day] = date.split("-").map(Number);
    return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10);
  };

  it("refuses creating a Behavior whose End date is today or earlier", async () => {
    for (const endDate of [today("America/New_York"), addDays(today("America/New_York"), -1)]) {
      const adapter = store();
      await expect(createBehavior(adapter, { values: { ...values, endDate }, userId: "owner", timezone: "America/New_York", recordedAt }))
        .rejects.toMatchObject({ fieldErrors: { end_date: "Choose a date after today. The Behavior’s last day is the day before its end date." } });
      expect(adapter.createBehaviorWithAtomicScheduleGraph).not.toHaveBeenCalled();
    }
  });

  it("accepts tomorrow as the End date", async () => {
    const adapter = store();
    await createBehavior(adapter, { values: { ...values, endDate: addDays(today("America/New_York"), 1) }, userId: "owner", timezone: "America/New_York", recordedAt });
    expect(adapter.createBehaviorWithAtomicScheduleGraph).toHaveBeenCalledOnce();
  });

  it("refuses changing an active Behavior's End date to today, and leaves an unchanged date alone", async () => {
    const existing = { ...stored, end_date: addDays(today(stored.timezone), 5) };
    const adapter = store(existing);
    await expect(updateBehavior(adapter, { behaviorId: stored.id, expectedUpdatedAt: stored.updated_at, recordedAt,
      values: { ...values, endDate: today(stored.timezone) } })).rejects.toMatchObject({ fieldErrors: { end_date: expect.any(String) } });
    expect(adapter.updateBehaviorWithAtomicScheduleGraph).not.toHaveBeenCalled();
    await updateBehavior(adapter, { behaviorId: stored.id, expectedUpdatedAt: stored.updated_at, recordedAt,
      values: { ...values, endDate: existing.end_date } });
    expect(adapter.updateBehaviorWithAtomicScheduleGraph).toHaveBeenCalledOnce();
  });
});
