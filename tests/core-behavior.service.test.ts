import { describe, expect, it, vi } from "vitest";

import type {
  BehaviorDataStore,
} from "../packages/core/src/behavior-store";
import {
  answerBehaviorAlongsideQuestion, applyBehaviorRunAction, BehaviorRunStateError, createBehavior, setBehaviorActive, setBehaviorAlongside, updateBehavior, updateBehaviorArchiveNote,
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
  const existing = { ...stored, default_duration_minutes: 45, end_on: "2026-09-17", end_time: null, auto_archived_at: null };
  const adapter = store(existing);
  await updateBehavior(adapter, { behaviorId: stored.id, expectedUpdatedAt: stored.updated_at, values, recordedAt });
  expect(adapter.updateBehaviorWithAtomicScheduleGraph.mock.lastCall![0].behavior).toMatchObject({
    default_duration_minutes: 45, end_on: "2026-09-17", end_time: null, auto_archived_at: null,
  });
  await updateBehavior(adapter, { behaviorId: stored.id, expectedUpdatedAt: stored.updated_at,
    values: { ...values, defaultDurationMinutes: null, endOn: null }, recordedAt });
  expect(adapter.updateBehaviorWithAtomicScheduleGraph.mock.lastCall![0].behavior).toMatchObject({ default_duration_minutes: null, end_on: null });
  expect(adapter.updateBehaviorWithAtomicScheduleGraph.mock.lastCall![0].configurationEventPlan).toMatchObject({ changedFields: ["end"] });
});

it("keeps an end that has passed when an archived Behavior is restored (it comes back as Ended)", async () => {
  const adapter = store({ ...stored, active: false, archived_at: recordedAt, end_on: "2026-08-28", auto_archived_at: recordedAt });
  await setBehaviorActive(adapter, { behaviorId: stored.id, active: true, recordedAt });
  expect(adapter.updateBehaviorWithAtomicScheduleGraph.mock.lastCall![0].behavior).toMatchObject({
    active: true, end_on: "2026-08-28", auto_archived_at: null,
  });
  expect(adapter.updateBehaviorWithAtomicScheduleGraph.mock.lastCall![0].configurationEventPlan).toMatchObject({ reasonCode: "behavior_restored" });
});

describe("An end or a pause must be later than now", () => {
  // recordedAt is noon on August 30, 2026 in New York.
  it("refuses an end that has already passed, and accepts the end of today", async () => {
    for (const end of [{ endOn: "2026-08-29", endTime: null }, { endOn: "2026-08-30", endTime: "11:59" }]) {
      const adapter = store();
      await expect(createBehavior(adapter, { values: { ...values, ...end }, userId: "owner", timezone: "America/New_York", recordedAt }))
        .rejects.toMatchObject({ fieldErrors: { end_on: "Pick a time later than now. To stop it right away, use End now." } });
      expect(adapter.createBehaviorWithAtomicScheduleGraph).not.toHaveBeenCalled();
    }
    for (const end of [{ endOn: "2026-08-30", endTime: null }, { endOn: "2026-08-30", endTime: "12:01" }]) {
      const adapter = store();
      await createBehavior(adapter, { values: { ...values, ...end }, userId: "owner", timezone: "America/New_York", recordedAt });
      expect(adapter.createBehaviorWithAtomicScheduleGraph.mock.lastCall![0].behavior).toMatchObject({
        end_on: "2026-08-30", end_time: end.endTime ? `${end.endTime}:00` : null,
      });
    }
  });

  it("checks only a changed end, so an end that passed stays editable around it", async () => {
    const existing = { ...stored, end_on: "2026-08-20", end_time: null };
    const adapter = store(existing);
    await expect(updateBehavior(adapter, { behaviorId: stored.id, expectedUpdatedAt: stored.updated_at, recordedAt,
      values: { ...values, endOn: "2026-08-25" } })).rejects.toMatchObject({ fieldErrors: { end_on: expect.any(String) } });
    expect(adapter.updateBehaviorWithAtomicScheduleGraph).not.toHaveBeenCalled();
    await updateBehavior(adapter, { behaviorId: stored.id, expectedUpdatedAt: stored.updated_at, recordedAt,
      values: { ...values, title: "Read more" } });
    expect(adapter.updateBehaviorWithAtomicScheduleGraph.mock.lastCall![0].behavior).toMatchObject({ end_on: "2026-08-20" });
  });

  it("refuses a pause that starts before today or comes back too soon", async () => {
    for (const pause of [
      { fromOn: "2026-08-29", fromTime: null, backOn: "2026-09-02" },
      { fromOn: "2026-08-30", fromTime: null, backOn: "2026-08-30" },
    ]) {
      const adapter = store();
      await expect(updateBehavior(adapter, { behaviorId: stored.id, expectedUpdatedAt: stored.updated_at, recordedAt,
        values: { ...values, pause } })).rejects.toMatchObject({ fieldErrors: { pause: expect.any(String) } });
    }
  });
});

describe("End now, Start again, Pause and Resume now", () => {
  it("End now stops this minute, rounded up, and repeating it writes no revision", async () => {
    const adapter = store();
    await applyBehaviorRunAction(adapter, { behaviorId: stored.id, action: { kind: "end_now" }, recordedAt: "2026-08-30T16:00:30Z" });
    const commit = adapter.updateBehaviorWithAtomicScheduleGraph.mock.lastCall![0];
    expect(commit.behavior).toMatchObject({ end_on: "2026-08-30", end_time: "12:01:00", active: true });
    expect(commit.configurationEventPlan).toMatchObject({ changedFields: ["end"], reasonCode: "behavior_ended" });
    adapter.getBehaviorById.mockResolvedValue({ ...stored, ...commit.behavior });
    await applyBehaviorRunAction(adapter, { behaviorId: stored.id, action: { kind: "end_now" }, recordedAt: "2026-08-30T16:05:00Z" });
    expect(adapter.updateBehaviorWithAtomicScheduleGraph.mock.lastCall![0]).toMatchObject({ configurationEventPlan: null });
  });

  it("End now in the last minute of a day stops at the end of that day", async () => {
    const adapter = store();
    await applyBehaviorRunAction(adapter, { behaviorId: stored.id, action: { kind: "end_now" }, recordedAt: "2026-08-31T03:59:30Z" });
    expect(adapter.updateBehaviorWithAtomicScheduleGraph.mock.lastCall![0].behavior).toMatchObject({ end_on: "2026-08-30", end_time: null });
  });

  it("Start again clears the end", async () => {
    const adapter = store({ ...stored, end_on: "2026-08-29", end_time: null });
    await applyBehaviorRunAction(adapter, { behaviorId: stored.id, action: { kind: "start_again" }, recordedAt });
    expect(adapter.updateBehaviorWithAtomicScheduleGraph.mock.lastCall![0].behavior).toMatchObject({ end_on: null, end_time: null });
  });

  it("a pause that starts today starts now; one ahead starts with its day and replaces the old one", async () => {
    const adapter = store({ ...stored, pause_from_on: "2026-09-10", pause_from_time: null, pause_back_on: "2026-09-12" });
    await applyBehaviorRunAction(adapter, { behaviorId: stored.id, recordedAt,
      action: { kind: "pause", pause: { fromOn: "2026-08-30", fromTime: null, backOn: "2026-09-02" } } });
    expect(adapter.updateBehaviorWithAtomicScheduleGraph.mock.lastCall![0].behavior).toMatchObject({
      pause_from_on: "2026-08-30", pause_from_time: "12:00:00", pause_back_on: "2026-09-02",
    });
    await applyBehaviorRunAction(adapter, { behaviorId: stored.id, recordedAt,
      action: { kind: "pause", pause: { fromOn: "2026-09-03", fromTime: null, backOn: "2026-09-05" } } });
    expect(adapter.updateBehaviorWithAtomicScheduleGraph.mock.lastCall![0].behavior).toMatchObject({
      pause_from_on: "2026-09-03", pause_from_time: null, pause_back_on: "2026-09-05",
    });
  });

  it("Resume now clears the pause and an end that has passed", async () => {
    const adapter = store({ ...stored, end_on: "2026-08-29", pause_from_on: "2026-08-20", pause_from_time: null, pause_back_on: "2026-09-02" });
    await applyBehaviorRunAction(adapter, { behaviorId: stored.id, action: { kind: "resume" }, recordedAt });
    expect(adapter.updateBehaviorWithAtomicScheduleGraph.mock.lastCall![0].behavior).toMatchObject({
      end_on: null, pause_from_on: null, pause_back_on: null,
    });
  });

  it("refuses a run action on an archived Behavior and pausing an ended one", async () => {
    await expect(applyBehaviorRunAction(store({ ...stored, active: false }), { behaviorId: stored.id, action: { kind: "end_now" }, recordedAt }))
      .rejects.toBeInstanceOf(BehaviorRunStateError);
    await expect(applyBehaviorRunAction(store({ ...stored, end_on: "2026-08-29" }), { behaviorId: stored.id, recordedAt,
      action: { kind: "pause", pause: { fromOn: "2026-08-30", fromTime: null, backOn: "2026-09-02" } } }))
      .rejects.toBeInstanceOf(BehaviorRunStateError);
  });
});

describe("the alongside answer in configuration history (Ticket 363)", () => {
  it("writes one revision naming alongside and keeps every other stored field", async () => {
    const adapter = store({ ...stored, alongside: null });
    await setBehaviorAlongside(adapter, { behaviorId: "behavior", alongside: true, recordedAt });
    const commit = adapter.updateBehaviorWithAtomicScheduleGraph.mock.calls[0]![0];
    expect(commit.behavior).toMatchObject({ alongside: true, title: stored.title, active: stored.active });
    expect(commit.definitionEventPlan).toBeNull();
    expect(commit.configurationEventPlan).toMatchObject({
      eventKind: "revision", changedFields: ["alongside"], reasonCode: "alongside_answered",
      previousConfiguration: { alongside: null }, nextConfiguration: { alongside: true },
    });
  });

  it("a question prompt answers only an unanswered Behavior (audit fix 7)", async () => {
    const answered = store({ ...stored, alongside: false });
    await expect(answerBehaviorAlongsideQuestion(answered, { behaviorId: "behavior", alongside: true, recordedAt }))
      .resolves.toEqual({ alongside: false, alreadyAnswered: true });
    expect(answered.updateBehaviorWithAtomicScheduleGraph).not.toHaveBeenCalled();
    const open = store({ ...stored, alongside: null });
    await expect(answerBehaviorAlongsideQuestion(open, { behaviorId: "behavior", alongside: true, recordedAt }))
      .resolves.toEqual({ alongside: true, alreadyAnswered: false });
    expect(open.updateBehaviorWithAtomicScheduleGraph.mock.calls[0]![0]).toMatchObject({ behavior: { alongside: true }, expectedUpdatedAt: stored.updated_at });
  });

  it("writes nothing for the same answer again", async () => {
    const adapter = store({ ...stored, alongside: false });
    await expect(setBehaviorAlongside(adapter, { behaviorId: "behavior", alongside: false, recordedAt })).resolves.toMatchObject({ alongside: false });
    expect(adapter.updateBehaviorWithAtomicScheduleGraph).not.toHaveBeenCalled();
  });

  it("keeps the stored answer on an edit that does not send one, and records an edit that does", async () => {
    const keep = store({ ...stored, alongside: true });
    await updateBehavior(keep, { behaviorId: "behavior", expectedUpdatedAt: stored.updated_at, values, recordedAt });
    const kept = keep.updateBehaviorWithAtomicScheduleGraph.mock.calls[0]![0];
    expect(kept.behavior.alongside).toBe(true);
    expect(kept.configurationEventPlan).toBeNull();
    const change = store({ ...stored, alongside: true });
    await updateBehavior(change, { behaviorId: "behavior", expectedUpdatedAt: stored.updated_at, values: { ...values, alongside: null }, recordedAt });
    expect(change.updateBehaviorWithAtomicScheduleGraph.mock.calls[0]![0].configurationEventPlan).toMatchObject({ changedFields: ["alongside"] });
  });

  it("carries the stored answer through a lifecycle write", async () => {
    const adapter = store({ ...stored, alongside: true });
    await setBehaviorActive(adapter, { behaviorId: "behavior", active: false, recordedAt, newArchiveNoteId: "33333333-3333-4333-8333-333333333333" });
    const commit = adapter.updateBehaviorWithAtomicScheduleGraph.mock.calls[0]![0];
    expect(commit.behavior.alongside).toBe(true);
    expect(commit.configurationEventPlan?.changedFields).toEqual(["active"]);
  });
});
