import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";
import type {
  BehaviorCreateCommit, BehaviorDataStore, BehaviorGraphRecord, BehaviorInput, BehaviorUpdateCommit,
} from "@cadence/core/behavior-store";
import {
  applyBehaviorRunAction, createBehavior, createBehaviorGroup, reorderSubBehaviors, setBehaviorActive,
  SubBehaviorLinkError, updateBehavior,
} from "@cadence/core/services/behavior.service";
import { applyParentSlotStatusTransition } from "@cadence/core/services/occurrence.service";
import { resolvePersistedTimeline } from "@cadence/core/services/timeline.service";
import { assembleAnalyticsView } from "@cadence/core/services/analytics";
import type { OccurrenceRecord, StatusTransitionCommit } from "@cadence/core/data-store";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const PARENT = "a0000000-0000-4000-8000-000000000000";
const CHILD_A = "a1000000-0000-4000-8000-000000000000";
const CHILD_B = "a2000000-0000-4000-8000-000000000000";
const STANDALONE = "b0000000-0000-4000-8000-000000000000";
const RECORDED_AT = "2026-11-21T12:00:00.000Z";

function record(id: string, overrides: Partial<BehaviorGraphRecord> = {}, time = "21:00:00"): BehaviorGraphRecord {
  return {
    id, user_id: USER_ID, current_configuration_event_id: `cfg-${id}`,
    created_at: "2026-11-01T12:00:00.000Z", updated_at: `2026-11-01T12:00:00.000Z#${id}`,
    category_id: null, category: null, title: `Behavior ${id.slice(0, 2)}`, description: null,
    recurrence_rule: { frequency: "daily", interval: 1 }, scheduled_time: time, timezone: "America/New_York",
    browser_reminder_enabled: true, email_reminder_enabled: false, reminder_offset_minutes: 0,
    active: true, archived_at: null, archive_notes: [],
    parent_behavior_id: null, sub_behavior_sort_order: 0, inherit_parent_schedule: false,
    schedules: [{
      id: `sch-${id}`, user_id: USER_ID, behavior_id: id, recurrence_rule: { frequency: "daily", interval: 1 },
      sort_order: 0, created_at: "", updated_at: "",
      schedule_slots: [{
        id: `slot-${id}`, user_id: USER_ID, behavior_id: id, behavior_schedule_id: `sch-${id}`, kind: "exact",
        preset: null, start_time: time, end_time: null, sort_order: 0, created_at: "", updated_at: "",
      }],
    }],
    schedule_slots: [],
    ...overrides,
  };
}

function values(time: string, overrides: Partial<BehaviorInput> = {}): BehaviorInput {
  return {
    title: "Floss", description: null, categoryId: null,
    recurrenceRule: { frequency: "daily", interval: 1 } as BehaviorInput["recurrenceRule"], scheduledTime: time,
    schedules: [{
      recurrenceRule: { frequency: "daily", interval: 1 } as BehaviorInput["recurrenceRule"], sortOrder: 0,
      timeEntries: [{ kind: "exact", preset: null, startTime: time, endTime: null, sortOrder: 0 }],
    }] as BehaviorInput["schedules"],
    browserReminderEnabled: true, emailReminderEnabled: false, reminderOffsetMinutes: 0, active: true,
    ...overrides,
  };
}

/** A store that records commits and returns the stored row for each id. */
function memoryStore(rows: BehaviorGraphRecord[]) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const calls = { created: [] as BehaviorCreateCommit[], groupCreated: [] as BehaviorCreateCommit[][],
    updated: [] as BehaviorUpdateCommit[], groupUpdated: [] as BehaviorUpdateCommit[][], reordered: [] as unknown[] };
  const fromCreate = (commit: BehaviorCreateCommit) => {
    const id = commit.behavior.id ?? "c0000000-0000-4000-8000-000000000000";
    const row = { ...record(id), ...commit.behavior, id } as BehaviorGraphRecord;
    byId.set(id, row);
    return row;
  };
  const store: BehaviorDataStore = {
    getBehaviorById: async (id) => byId.get(id) ?? null,
    createBehaviorWithAtomicScheduleGraph: async (commit) => { calls.created.push(commit); return fromCreate(commit); },
    updateBehaviorWithAtomicScheduleGraph: async (commit) => {
      calls.updated.push(commit);
      return { ...byId.get(commit.behaviorId)!, ...commit.behavior };
    },
    listBehaviors: async () => [...byId.values()],
    createBehaviorGroupWithAtomicScheduleGraphs: async (commits) => { calls.groupCreated.push(commits); return commits.map(fromCreate); },
    updateBehaviorGroupWithAtomicScheduleGraphs: async (commits) => {
      calls.groupUpdated.push(commits);
      return commits.map((commit) => ({ ...byId.get(commit.behaviorId)!, ...commit.behavior }));
    },
    reorderSubBehaviors: async (input) => { calls.reordered.push(input); return 1; },
  };
  return { store, calls };
}

const parentRow = () => record(PARENT, { title: "Skin routine" });
const inheritingChild = (id = CHILD_A, sort = 0) =>
  record(id, { parent_behavior_id: PARENT, inherit_parent_schedule: true, sub_behavior_sort_order: sort, title: `Step ${sort}` });
const customChild = () =>
  record(CHILD_B, { parent_behavior_id: PARENT, inherit_parent_schedule: false, sub_behavior_sort_order: 1, title: "Retinol" }, "22:00:00");

describe("sub-behavior Behavior writes", () => {
  it("creates an inheriting sub-behavior with the parent's schedule and the link in its baseline", async () => {
    const { store, calls } = memoryStore([parentRow(), inheritingChild()]);
    await createBehavior(store, {
      values: values("07:00", { parentBehaviorId: PARENT }), userId: USER_ID, timezone: "America/New_York",
      recordedAt: RECORDED_AT, newId: () => CHILD_B,
    });
    const commit = calls.created[0]!;
    expect(commit.behavior).toMatchObject({
      id: CHILD_B, parent_behavior_id: PARENT, inherit_parent_schedule: true, sub_behavior_sort_order: 1,
      scheduled_time: "21:00:00",
    });
    expect(commit.schedules[0]!.slots[0]).toMatchObject({ start_time: "21:00:00", id: null });
    expect(commit.configurationEventPlan.nextConfiguration).toMatchObject({ parentBehaviorId: PARENT, inheritParentSchedule: true });
    expect(commit.configurationEventPlan.changedFields).toEqual(expect.arrayContaining(["parent_behavior_id", "inherit_parent_schedule"]));
  });

  it("keeps a custom schedule when the sub-behavior does not inherit", async () => {
    const { store, calls } = memoryStore([parentRow()]);
    await createBehavior(store, {
      values: values("07:00", { parentBehaviorId: PARENT, inheritParentSchedule: false }), userId: USER_ID,
      timezone: "America/New_York", recordedAt: RECORDED_AT, newId: () => CHILD_B,
    });
    expect(calls.created[0]!.behavior).toMatchObject({ inherit_parent_schedule: false, scheduled_time: "07:00" });
  });

  it.each([
    ["a sub-behavior as the parent", CHILD_A, "A sub-behavior can't have sub-behaviors."],
    ["an archived parent", STANDALONE, "An archived Behavior can't take sub-behaviors."],
    ["a missing parent", "f0000000-0000-4000-8000-000000000000", "That parent Behavior wasn't found."],
  ])("refuses %s", async (_label, parentId, message) => {
    const { store, calls } = memoryStore([parentRow(), inheritingChild(),
      record(STANDALONE, { active: false, archived_at: "2026-11-02T00:00:00Z" })]);
    await expect(createBehavior(store, {
      values: values("07:00", { parentBehaviorId: parentId }), userId: USER_ID, timezone: "America/New_York",
      recordedAt: RECORDED_AT,
    })).rejects.toThrow(new SubBehaviorLinkError(message));
    expect(calls.created).toHaveLength(0);
  });

  it("refuses to give a parent with sub-behaviors a parent of its own", async () => {
    const parent = parentRow();
    const { store } = memoryStore([parent, inheritingChild(), record(STANDALONE)]);
    await expect(updateBehavior(store, {
      behaviorId: PARENT, expectedUpdatedAt: parent.updated_at, recordedAt: RECORDED_AT,
      values: values("21:00:00", { title: parent.title, parentBehaviorId: STANDALONE }),
    })).rejects.toThrow("A Behavior with sub-behaviors can't become a sub-behavior.");
  });

  it("creates a parent and its sub-behaviors in one group write", async () => {
    const ids = [PARENT, CHILD_A, CHILD_B];
    const { store, calls } = memoryStore([]);
    const created = await createBehaviorGroup(store, {
      parent: values("21:00", { title: "Skin routine" }),
      subBehaviors: [values("08:00", { title: "Cerave" }), values("22:00", { title: "Retinol", inheritParentSchedule: false })],
      userId: USER_ID, timezone: "America/New_York", recordedAt: RECORDED_AT, newId: () => ids.shift()!,
    });
    const [parent, cerave, retinol] = calls.groupCreated[0]!;
    expect(parent!.behavior).toMatchObject({ id: PARENT, parent_behavior_id: null, inherit_parent_schedule: false });
    expect(cerave!.behavior).toMatchObject({ parent_behavior_id: PARENT, inherit_parent_schedule: true, sub_behavior_sort_order: 0, scheduled_time: "21:00" });
    expect(retinol!.behavior).toMatchObject({ parent_behavior_id: PARENT, inherit_parent_schedule: false, sub_behavior_sort_order: 1, scheduled_time: "22:00" });
    expect(created.subBehaviors.map((row) => row.id)).toEqual([CHILD_A, CHILD_B]);
  });

  it("mirrors a parent schedule edit onto inheriting sub-behaviors only, in the same write", async () => {
    const parent = parentRow();
    const { store, calls } = memoryStore([parent, inheritingChild(), customChild()]);
    await updateBehavior(store, {
      behaviorId: PARENT, expectedUpdatedAt: parent.updated_at, recordedAt: RECORDED_AT,
      values: values("20:30", { title: parent.title }),
    });
    expect(calls.updated).toHaveLength(0);
    const [parentCommit, mirror, ...rest] = calls.groupUpdated[0]!;
    expect(rest).toHaveLength(0);
    expect(parentCommit!.behaviorId).toBe(PARENT);
    expect(mirror).toMatchObject({ behaviorId: CHILD_A, expectedUpdatedAt: inheritingChild().updated_at });
    expect(mirror!.schedules[0]!.slots[0]).toMatchObject({ start_time: "20:30", id: `slot-${CHILD_A}` });
    expect(mirror!.configurationEventPlan?.changedFields).toEqual(["schedule_graph"]);
  });

  it("writes one Behavior when the parent edit changes nothing its sub-behaviors mirror", async () => {
    const parent = parentRow();
    const { store, calls } = memoryStore([parent, inheritingChild()]);
    await updateBehavior(store, {
      behaviorId: PARENT, expectedUpdatedAt: parent.updated_at, recordedAt: RECORDED_AT,
      values: values("21:00:00", { title: "Evening skin routine" }),
    });
    expect(calls.groupUpdated).toHaveLength(0);
    expect(calls.updated).toHaveLength(1);
  });

  it("archives active sub-behaviors with the parent and keeps their links", async () => {
    const { store, calls } = memoryStore([parentRow(), inheritingChild(), customChild()]);
    await setBehaviorActive(store, {
      behaviorId: PARENT, active: false, recordedAt: RECORDED_AT, newArchiveNoteId: "d0000000-0000-4000-8000-000000000000",
      newId: () => globalThis.crypto.randomUUID(),
    });
    const commits = calls.groupUpdated[0]!;
    expect(commits.map((commit) => commit.behaviorId)).toEqual([PARENT, CHILD_A, CHILD_B]);
    for (const commit of commits.slice(1)) {
      expect(commit.behavior).toMatchObject({ active: false, archived_at: RECORDED_AT, parent_behavior_id: PARENT });
      expect(commit.configurationEventPlan?.reasonCode).toBe("behavior_archived");
    }
  });

  it("restores the sub-behaviors archived with the parent, and no others", async () => {
    const archivedAt = "2026-11-10T12:00:00.000Z";
    const { store, calls } = memoryStore([
      record(PARENT, { active: false, archived_at: archivedAt }),
      record(CHILD_A, { parent_behavior_id: PARENT, inherit_parent_schedule: true, active: false, archived_at: archivedAt }),
      record(CHILD_B, { parent_behavior_id: PARENT, active: false, archived_at: "2026-11-05T12:00:00.000Z" }),
    ]);
    await setBehaviorActive(store, { behaviorId: PARENT, active: true, recordedAt: RECORDED_AT });
    expect(calls.groupUpdated[0]!.map((commit) => commit.behaviorId)).toEqual([PARENT, CHILD_A]);
  });

  it("refuses to restore a sub-behavior while its parent is archived", async () => {
    const { store } = memoryStore([
      record(PARENT, { active: false, archived_at: "2026-11-10T12:00:00.000Z" }),
      record(CHILD_A, { parent_behavior_id: PARENT, active: false, archived_at: "2026-11-05T12:00:00.000Z" }),
    ]);
    await expect(setBehaviorActive(store, { behaviorId: CHILD_A, active: true, recordedAt: RECORDED_AT }))
      .rejects.toThrow("Restore the parent Behavior first.");
  });

  it("pauses inheriting sub-behaviors with their parent and refuses a run action on one directly", async () => {
    const { store, calls } = memoryStore([parentRow(), inheritingChild(), customChild()]);
    await applyBehaviorRunAction(store, {
      behaviorId: PARENT, recordedAt: RECORDED_AT,
      action: { kind: "pause", pause: { fromOn: "2026-11-25", fromTime: null, backOn: "2026-11-28" } },
    });
    const [, mirror, ...rest] = calls.groupUpdated[0]!;
    expect(rest).toHaveLength(0);
    expect(mirror).toMatchObject({ behaviorId: CHILD_A, behavior: { pause_from_on: "2026-11-25", pause_back_on: "2026-11-28" } });
    expect(mirror!.configurationEventPlan?.reasonCode).toBe("behavior_paused");
    await expect(applyBehaviorRunAction(store, { behaviorId: CHILD_A, recordedAt: RECORDED_AT, action: { kind: "end_now" } }))
      .rejects.toThrow("This sub-behavior follows its parent's schedule.");
  });

  it("reorders only an exact sibling list and skips a no-op", async () => {
    const { store, calls } = memoryStore([parentRow(), inheritingChild(CHILD_A, 0), customChild()]);
    await expect(reorderSubBehaviors(store, { parentBehaviorId: PARENT, orderedBehaviorIds: [CHILD_B] }))
      .rejects.toThrow("Sub-behavior order must list each sub-behavior once.");
    expect(await reorderSubBehaviors(store, { parentBehaviorId: PARENT, orderedBehaviorIds: [CHILD_A, CHILD_B] })).toBe(0);
    await reorderSubBehaviors(store, { parentBehaviorId: PARENT, orderedBehaviorIds: [CHILD_B, CHILD_A] });
    expect(calls.reordered).toEqual([{ parentBehaviorId: PARENT, orderedBehaviorIds: [CHILD_B, CHILD_A] }]);
  });
});

function occurrence(id: string, behaviorId: string, overrides: Partial<OccurrenceRecord> = {}): OccurrenceRecord {
  return {
    id, user_id: USER_ID, behavior_id: behaviorId, behavior_configuration_event_id: `cfg-${behaviorId}`,
    behavior_schedule_slot_id: null, scheduled_for: "2026-11-21T02:00:00Z", local_date: "2026-11-20",
    schedule_kind: "exact", schedule_preset: null, schedule_start_time: "21:00:00", schedule_end_time: null,
    status: "unresolved", completed_at: null, status_marked_at: null, note: null,
    created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T00:00:00Z",
    ...overrides,
  } as OccurrenceRecord;
}

describe("parent slot marking", () => {
  it("commits every changing child in one call, with one status event each", async () => {
    const rows = new Map([
      ["o1", occurrence("o1", CHILD_A)],
      ["o2", occurrence("o2", CHILD_B, { status: "completed", completed_at: "2026-11-21T02:01:00Z", status_marked_at: "2026-11-21T02:01:00Z" })],
      ["o3", occurrence("o3", CHILD_A, { status: "not_completed", status_marked_at: "2026-11-21T02:01:00Z" })],
    ]);
    const sent: StatusTransitionCommit[][] = [];
    const { results } = await applyParentSlotStatusTransition({
      readStatusContext: async (id) => ({ occurrence: rows.get(id)!, latestStatusEventId: id === "o1" ? null : `event-${id}`, timezone: "America/New_York" }),
      applyParentSlotStatusTransition: async ({ commits }) => {
        sent.push(commits);
        return commits.map((commit) => ({ statusChanged: true, concurrentDuplicate: false, occurrence: rows.get(commit.occurrenceId)!, statusEvent: null }));
      },
    }, { parentBehaviorId: PARENT, occurrenceIds: ["o1", "o2", "o3"], nextStatus: "completed", now: Temporal.Instant.from("2026-11-21T02:05:00Z") });
    expect(results).toHaveLength(2);
    expect(sent[0]!.map((commit) => commit.occurrenceId)).toEqual(["o1", "o3"]);
    expect(sent[0]![0]).toMatchObject({ expectedStatus: "unresolved", status: "completed", cancelPendingReminders: true,
      event: { statusSemantics: "explicit_user_mark" } });
    expect(sent[0]![1]).toMatchObject({ expectedStatus: "not_completed", expectedLatestEventId: "event-o3",
      event: { statusSemantics: "explicit_user_correction" } });
  });

  it("writes nothing when every child already has the status, and refuses a stale view", async () => {
    const store = {
      readStatusContext: async (id: string) => ({ occurrence: occurrence(id, CHILD_A, { status: "completed" }), latestStatusEventId: "e", timezone: "UTC" }),
      applyParentSlotStatusTransition: async () => { throw new Error("should not write"); },
    };
    const now = Temporal.Instant.from("2026-11-21T02:05:00Z");
    expect((await applyParentSlotStatusTransition(store, { parentBehaviorId: PARENT, occurrenceIds: ["o1"], nextStatus: "completed", now })).results).toEqual([]);
    await expect(applyParentSlotStatusTransition(store, {
      parentBehaviorId: PARENT, occurrenceIds: ["o1"], nextStatus: "not_completed", now, expectedStatuses: { o1: "unresolved" },
    })).rejects.toThrow("Occurrence status changed.");
  });
});

describe("timeline and analytics assembly", () => {
  const behaviors = [parentRow(), inheritingChild(CHILD_A, 0), customChild()];
  const occurrences = [
    occurrence("parent-kept", PARENT, { status: "completed", completed_at: "2026-11-21T02:01:00Z", status_marked_at: "2026-11-21T02:01:00Z" }),
    occurrence("child-a", CHILD_A, { status: "completed", completed_at: "2026-11-21T02:01:00Z", status_marked_at: "2026-11-21T02:01:00Z" }),
    occurrence("child-b", CHILD_B),
    occurrence("parent-old", PARENT, { local_date: "2026-11-19", scheduled_for: "2026-11-20T02:00:00Z" }),
  ];
  const now = Temporal.Instant.from("2026-11-21T03:00:00Z");

  it("drops a parent's own row on a day its sub-behaviors cover and labels child rows", () => {
    const timeline = resolvePersistedTimeline({ behaviors, occurrences, timeSessions: [], now, timezone: "America/New_York" });
    const rows = [...timeline.needsDecision.daySections, ...timeline.daySections].flatMap((day) => day.occurrences);
    const ids = rows.map((row) => row.id);
    expect(ids).not.toContain("parent-kept");
    expect(ids).toEqual(expect.arrayContaining(["child-a", "child-b", "parent-old"]));
    const child = rows.find((row) => row.id === "child-a");
    expect(child).toMatchObject({ parentBehaviorId: PARENT, parentTitle: "Skin routine", subBehaviorSortOrder: 0 });
  });

  it("rolls sub-behavior rows up under the parent without counting the parent's row twice", () => {
    const view = assembleAnalyticsView({
      behaviors, occurrences, needsDecisionOccurrences: [], timeSessions: [], now, timezone: "America/New_York", rangeDays: 7,
    });
    const summary = view.parentSummaries.find((row) => row.parentBehaviorId === PARENT);
    expect(summary).toBeDefined();
    expect(summary!.subBehaviorIds).toEqual([CHILD_A, CHILD_B]);
  });
});
