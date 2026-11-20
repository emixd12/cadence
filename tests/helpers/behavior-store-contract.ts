import { createHash } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import { expect } from "vitest";
import type { BehaviorDataStore, BehaviorGraphRecord, BehaviorInput } from "@cadence/core/behavior-store";
import { createBehavior, setBehaviorActive, updateBehavior, updateBehaviorArchiveNote } from "@cadence/core/services/behavior.service";
import type { BehaviorConfigurationEvent, BehaviorDefinitionEvent } from "@/lib/types/database";

export const CONTRACT_NOW = Temporal.Instant.from("2026-08-30T12:00:00Z");
export const CONTRACT_VALUES: BehaviorInput = {
  defaultDurationMinutes: 45, endOn: "2099-12-30",
  title: "  Contract walk  ", description: " Original description ", categoryId: null,
  recurrenceRule: { frequency: "daily", interval: 1 }, scheduledTime: "09:00",
  schedules: [{ recurrenceRule: { frequency: "daily", interval: 1 }, sortOrder: 0,
    timeEntries: [{ kind: "exact", preset: null, startTime: "09:00", endTime: null, sortOrder: 0 }] }],
  browserReminderEnabled: true, emailReminderEnabled: false, reminderOffsetMinutes: 0, active: true,
};

export type BehaviorStoreSnapshot = {
  graphs: BehaviorGraphRecord[];
  definitions: BehaviorDefinitionEvent[];
  configurations: BehaviorConfigurationEvent[];
  syncState: { stale: boolean; state_version: number } | null;
};

type ContractAdapter = {
  userId: string;
  timezone: string;
  storeAt: (now: Temporal.Instant) => BehaviorDataStore;
  readSnapshot: () => Promise<BehaviorStoreSnapshot>;
};

// Both real adapters run this exact sequence. Snapshots are hashed before an
// assertion so failure output cannot disclose owner IDs or imported content.
export async function exerciseBehaviorStoreContract(adapter: ContractAdapter) {
  const storeAt = (seconds: number) => adapter.storeAt(CONTRACT_NOW.add({ seconds }));
  const recordedAt = (seconds: number) => CONTRACT_NOW.add({ seconds }).toString();
  const created = await createBehavior(storeAt(0), {
    userId: adapter.userId, timezone: adapter.timezone, values: CONTRACT_VALUES, recordedAt: recordedAt(0),
  });
  expect(created.title).toBe("Contract walk");
  expect(created.description).toBe("Original description");
  expect(created.default_duration_minutes).toBe(45);
  expect(created.end_on).toBe("2099-12-30");
  expect(created.auto_archived_at).toBeNull();
  expect(created.active).toBe(true);
  expect(created.schedules).toHaveLength(1);
  expect(created.schedule_slots).toHaveLength(1);
  const baseline = await adapter.readSnapshot();
  expect(baseline.graphs).toHaveLength(1);
  expect(baseline.definitions.map((event) => event.next_title)).toEqual(["Contract walk"]);
  expect(baseline.configurations.map((event) => event.event_kind)).toEqual(["baseline"]);
  expect(Boolean(created.current_configuration_event_id)).toBe(true);
  expect(baseline.syncState?.stale).toBe(true);

  const schedule = created.schedules![0];
  const slot = schedule.schedule_slots[0];
  const revised: BehaviorInput = { ...CONTRACT_VALUES, title: "Contract walk revised", description: null,
    scheduledTime: "10:00", schedules: [{ ...CONTRACT_VALUES.schedules[0], id: schedule.id,
      timeEntries: [{ ...CONTRACT_VALUES.schedules[0].timeEntries[0], id: slot.id, startTime: "10:00" }] }] };
  const updated = await updateBehavior(storeAt(1), {
    behaviorId: created.id, expectedUpdatedAt: created.updated_at, values: revised, recordedAt: recordedAt(1),
  });
  expect(updated.description).toBeNull();
  expect(updated.default_duration_minutes).toBe(45);
  expect(updated.end_on).toBe("2099-12-30");
  const edited = await adapter.readSnapshot();
  expect(edited.definitions.map((event) => event.next_title)).toEqual(["Contract walk", "Contract walk revised"]);
  expect(edited.configurations.map((event) => event.reason_code)).toEqual(["behavior_created", "behavior_edited"]);
  expect(edited.syncState?.state_version).toBe((baseline.syncState?.state_version ?? 0) + 1);
  expect(edited.graphs[0].schedule_slots[0].start_time.slice(0, 5)).toBe("10:00");
  expect(edited.graphs[0].schedule_slots[0].id === slot.id).toBe(true);

  await expect(updateBehavior(storeAt(2), {
    behaviorId: created.id, expectedUpdatedAt: created.updated_at,
    values: { ...revised, title: "Stale overwrite" }, recordedAt: recordedAt(2),
  })).rejects.toThrow("changed");
  expect(snapshotHash(await adapter.readSnapshot())).toBe(snapshotHash(edited));

  // Reusing another Behavior's retained schedule ID passes structural validation
  // but fails the real write after earlier graph/history writes have started.
  await expect(createBehavior(storeAt(3), {
    userId: adapter.userId, timezone: adapter.timezone,
    values: { ...CONTRACT_VALUES, title: "Rolled back Behavior", schedules: revised.schedules },
    recordedAt: recordedAt(3),
  })).rejects.toMatchObject({ message: expect.stringMatching(/changed|constraint rejected the transaction/i) });
  expect(snapshotHash(await adapter.readSnapshot())).toBe(snapshotHash(edited));

  const archiveNoteId = "11111111-1111-4111-8111-111111111111";
  await setBehaviorActive(storeAt(4), { behaviorId: created.id, active: false, expectedUpdatedAt: updated.updated_at,
    newArchiveNoteId: archiveNoteId, archiveNote: "  Program finished  ", recordedAt: recordedAt(4) });
  const archived = await adapter.readSnapshot();
  expect(archived.graphs[0].active).toBe(false);
  expect(archived.graphs[0].default_duration_minutes).toBe(45);
  expect(archived.graphs[0].end_on).toBe("2099-12-30");
  expect(Boolean(archived.graphs[0].archived_at)).toBe(true);
  expect(archived.definitions).toHaveLength(2);
  expect(archived.configurations.map((event) => event.reason_code)).toEqual([
    "behavior_created", "behavior_edited", "behavior_archived",
  ]);
  expect(archived.syncState?.state_version).toBe(edited.syncState!.state_version + 1);
  expect(archived.graphs[0].archive_notes).toMatchObject([{ id: archiveNoteId, note: "Program finished" }]);
  await setBehaviorActive(storeAt(5), { behaviorId: created.id, active: true, expectedUpdatedAt: archived.graphs[0].updated_at, recordedAt: recordedAt(5) });
  const restored = await adapter.readSnapshot();
  expect(restored.graphs[0].active).toBe(true);
  expect(restored.graphs[0].default_duration_minutes).toBe(45);
  expect(restored.graphs[0].end_on).toBe("2099-12-30");
  expect(restored.graphs[0].auto_archived_at).toBeNull();
  expect(restored.graphs[0].archived_at).toBeNull();
  expect(restored.definitions).toHaveLength(2);
  expect(restored.configurations.map((event) => event.reason_code)).toEqual([
    "behavior_created", "behavior_edited", "behavior_archived", "behavior_restored",
  ]);
  expect(restored.syncState?.state_version).toBe(archived.syncState!.state_version + 1);
  expect(restored.graphs[0].archive_notes).toEqual(archived.graphs[0].archive_notes);
  const archivedAgain = await setBehaviorActive(storeAt(6), { behaviorId: created.id, active: false,
    expectedUpdatedAt: restored.graphs[0].updated_at, recordedAt: recordedAt(6),
    newArchiveNoteId: "22222222-2222-4222-8222-222222222222", archiveNote: "Routine established" });
  expect(archivedAgain.archive_notes).toMatchObject([{ note: "Program finished" }, { note: "Routine established" }]);
  const revisedNote = await updateBehaviorArchiveNote(storeAt(7), { behaviorId: created.id, archiveNoteId,
    expectedUpdatedAt: archivedAgain.updated_at, recordedAt: recordedAt(7), note: "Program completed" });
  expect(revisedNote.archive_notes).toMatchObject([{ note: "Program completed" }, { note: "Routine established" }]);
  const beforeStaleNote = snapshotHash(await adapter.readSnapshot());
  await expect(updateBehaviorArchiveNote(storeAt(8), { behaviorId: created.id, archiveNoteId,
    expectedUpdatedAt: created.updated_at, recordedAt: recordedAt(8), note: "Stale overwrite" })).rejects.toThrow(/changed/);
  expect(snapshotHash(await adapter.readSnapshot())).toBe(beforeStaleNote);
  const clearedNote = await updateBehaviorArchiveNote(storeAt(9), { behaviorId: created.id, archiveNoteId,
    expectedUpdatedAt: revisedNote.updated_at, recordedAt: recordedAt(9), note: "" });
  expect(clearedNote.archive_notes).toMatchObject([{ id: archiveNoteId, note: null }, { note: "Routine established" }]);
  return { behaviorId: created.id, definitionCount: 2, configurationCount: 5 };
}

export function snapshotHash(snapshot: unknown) {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}
