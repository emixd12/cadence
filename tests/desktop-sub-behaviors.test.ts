import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalBehaviorGraph, LocalCommandMap } from "../apps/desktop/src/local-store";
import { createLocalBehaviorActions, createLocalOccurrenceActions } from "../apps/desktop/src/local-actions";
import type { OccurrenceRecord } from "@cadence/core/data-store";
import type { Profile } from "../lib/types/database";

// Sub-behaviors on the Mac: the local actions read the same form fields as the web and
// commit through one local command each (group create, reorder, routine slot mark).
const command = vi.hoisted(() => vi.fn());
vi.mock("../apps/desktop/src/local-store", () => ({
  localCommand: command,
  localMutation: (profileId: string, now: string) => ({ profileId, now, mutationId: "mutation" }),
}));

type Graph = LocalBehaviorGraph & { revision: number };
const profile = { id: "owner", timezone: "America/New_York" } as Profile;
const idle = { status: "idle", message: "" } as const;
let graphs: Graph[];
let occurrences: OccurrenceRecord[];
const occurrenceIds = ["7f000000-0000-4000-8000-000000000001", "7f000000-0000-4000-8000-000000000002"];

beforeEach(() => {
  vi.resetAllMocks();
  graphs = [];
  occurrences = [];
  command.mockImplementation(async (operation: keyof LocalCommandMap, input: Record<string, unknown>) => {
    if (operation === "readBehaviorGraphs") return structuredClone(graphs);
    if (operation === "readCategories") return [];
    if (operation === "createBehaviorGroup") {
      const created = (input.items as Array<{ graph: LocalBehaviorGraph }>).map(({ graph }) => ({ ...graph, revision: 1 }));
      graphs.push(...created);
      return structuredClone(created);
    }
    if (operation === "reorderSubBehaviors") return 2;
    if (operation === "readOccurrence") return occurrences.find(({ id }) => id === input.occurrenceId) ?? null;
    if (operation === "readOccurrenceHistory") return { statusEvents: [], timeSessions: [] };
    if (operation === "applyParentSlotStatusTransition") {
      return (input.transitions as Array<{ occurrenceId: string; status: string }>).map((transition) => ({
        statusChanged: true, concurrentDuplicate: false, statusEvent: null,
        occurrence: { ...occurrences.find(({ id }) => id === transition.occurrenceId)!, status: transition.status },
      }));
    }
    throw new Error(`Unexpected operation ${operation}`);
  });
});

function groupForm() {
  const form = new FormData();
  for (const [name, value] of Object.entries({
    title: "Skin routine", behavior_schedule_count: "1", schedule_0_recurrence_kind: "daily",
    schedule_0_daily_interval: "1", schedule_0_time_entry_count: "1", schedule_0_time_entry_kind_0: "exact",
    schedule_0_time_entry_exact_time_0: "21:00", sub_behavior_count: "2",
    sub_behavior_0_title: "Cerave", sub_behavior_0_inherit: "true",
    sub_behavior_1_title: "Retinol", sub_behavior_1_inherit: "false", sub_behavior_1_recurrence_kind: "weekly",
    sub_behavior_1_time: "21:00",
  })) form.set(name, value);
  form.append("sub_behavior_1_weekly_days", "monday");
  form.append("sub_behavior_1_weekly_days", "friday");
  return form;
}

function calls<K extends keyof LocalCommandMap>(operation: K): Array<LocalCommandMap[K]["input"]> {
  return command.mock.calls.filter(([name]) => name === operation).map(([, input]) => input);
}

describe("Mac sub-behaviors", () => {
  it("creates a parent and its sub-behaviors in one local write", async () => {
    const refresh = vi.fn();
    const { createAction } = createLocalBehaviorActions(profile, refresh);
    const result = await createAction(idle, groupForm());
    expect(result).toMatchObject({ status: "success", behavior: { title: "Skin routine" } });
    const [write] = calls("createBehaviorGroup");
    expect(write!.items).toHaveLength(3);
    const [parent, cerave, retinol] = write!.items.map(({ graph }) => graph.behavior);
    expect(parent).toMatchObject({ parent_behavior_id: null, inherit_parent_schedule: false });
    expect(cerave).toMatchObject({ parent_behavior_id: parent!.id, inherit_parent_schedule: true, sub_behavior_sort_order: 0 });
    expect(retinol).toMatchObject({ parent_behavior_id: parent!.id, inherit_parent_schedule: false, sub_behavior_sort_order: 1 });
    // A following sub-behavior stores a copy of the parent's 21:00 schedule; Retinol keeps its own days.
    expect(write!.items[1]!.graph.slots[0]).toMatchObject({ start_time: "21:00:00" });
    expect(write!.items[2]!.graph.schedules[0]!.recurrence_rule).toMatchObject({ daysOfWeek: ["monday", "friday"] });
    expect(write!.items[1]!.configurationEvent.next_configuration).toMatchObject({ parentBehaviorId: parent!.id, inheritParentSchedule: true });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("reorders the live sub-behaviors of one parent", async () => {
    const { createAction, reorderAction } = createLocalBehaviorActions(profile, vi.fn());
    await createAction(idle, groupForm());
    const [parent, cerave, retinol] = graphs.map(({ behavior }) => behavior.id);
    const form = new FormData();
    form.set("parent_behavior_id", parent!);
    form.append("sub_behavior_id", retinol!);
    form.append("sub_behavior_id", cerave!);
    expect(await reorderAction(idle, form)).toMatchObject({ status: "success" });
    expect(calls("reorderSubBehaviors")).toMatchObject([{ parentBehaviorId: parent, orderedBehaviorIds: [retinol, cerave] }]);
    // A list that leaves a sub-behavior out is refused before any write.
    form.delete("sub_behavior_id");
    form.append("sub_behavior_id", retinol!);
    expect(await reorderAction(idle, form)).toMatchObject({ status: "error" });
    expect(calls("reorderSubBehaviors")).toHaveLength(1);
  });

  it("marks every step of a routine slot in one local write", async () => {
    await createLocalBehaviorActions(profile, vi.fn()).createAction(idle, groupForm());
    const [parent, cerave, retinol] = graphs.map(({ behavior }) => behavior.id);
    occurrences = [cerave!, retinol!].map((behaviorId, index) => ({
      id: occurrenceIds[index]!, user_id: "owner", behavior_id: behaviorId, local_date: "2026-11-20",
      scheduled_for: "2026-11-21T02:00:00Z", status: "unresolved", note: null, completed_at: null, status_marked_at: null,
    } as OccurrenceRecord));
    const form = new FormData();
    form.set("parent_behavior_id", parent!);
    form.set("status", "completed");
    for (const { id } of occurrences) form.append("occurrence_id", id);
    const { parentSlotStatusAction } = createLocalOccurrenceActions("owner", vi.fn());
    expect(await parentSlotStatusAction(idle, form)).toMatchObject({ status: "success", nextStatus: "completed" });
    const [write] = calls("applyParentSlotStatusTransition");
    expect(write!.parentBehaviorId).toBe(parent);
    expect(write!.transitions.map(({ occurrenceId, status, event }) => [occurrenceId, status, event?.behavior_id, event?.status]))
      .toEqual([[occurrenceIds[0], "completed", cerave, "completed"], [occurrenceIds[1], "completed", retinol, "completed"]]);
  });
});
