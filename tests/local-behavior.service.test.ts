import { Temporal } from "@js-temporal/polyfill";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBehavior, setBehaviorActive, updateBehavior } from "@cadence/core/services/behavior.service";
import type { BehaviorUpdateCommit } from "@cadence/core/behavior-store";
import { stored, values } from "./helpers/behavior-graph-fixture";
import type { LocalBehaviorGraph, LocalCommandMap } from "../apps/desktop/src/local-store";
import { createLocalBehaviorStore } from "../apps/desktop/src/local-behavior.service";

const command = vi.hoisted(() => vi.fn());
vi.mock("../apps/desktop/src/local-store", () => ({
  localCommand: command,
  localMutation: (profileId: string, now: string) => ({ profileId, now, mutationId: "mutation" }),
}));
const now = Temporal.Instant.from("2026-08-30T16:00:00Z");
const recordedAt = now.toString();
const { category: _category, schedules: nestedSchedules, schedule_slots: slots, ...storedBehavior } = stored;
const behavior = { ...storedBehavior, archive_notes: storedBehavior.archive_notes ?? [] };
void _category;
const fixture = {
  behavior,
  schedules: nestedSchedules!.map(({ schedule_slots: _slots, ...schedule }) => { void _slots; return schedule; }),
  slots,
  revision: 17,
};
let current: LocalBehaviorGraph & { revision: number };

beforeEach(() => {
  vi.resetAllMocks();
  current = structuredClone(fixture);
  command.mockImplementation(async (operation: keyof LocalCommandMap, input: { graph?: LocalBehaviorGraph }) => {
    if (operation === "readBehaviorGraphs") return [structuredClone(current)];
    if (operation === "readCategories") return [];
    if (operation === "createBehaviorGraph" || operation === "updateBehaviorGraph") {
      current = { ...input.graph!, revision: current.revision + 1 };
      return structuredClone(current);
    }
    throw new Error(`Unexpected operation ${operation}`);
  });
});

describe("local Behavior adapter", () => {
  it("projects the same full nested graph consumed by shared web orchestration", async () => {
    expect(await createLocalBehaviorStore("owner", now).getBehaviorById("behavior")).toEqual(stored);
  });

  it("submits a canonical graph, both full baselines, and a matching configuration pointer atomically", async () => {
    const result = await createBehavior(createLocalBehaviorStore("owner", now), {
      userId: "owner", timezone: "America/New_York", recordedAt,
      values: { ...values, schedules: [{ ...values.schedules[0]!, recurrenceRule: {
        frequency: "weekly", interval: 1, daysOfWeek: ["friday", "monday"],
      } }] },
    });
    const commit = command.mock.calls.find(([operation]) => operation === "createBehaviorGraph")![1] as LocalCommandMap["createBehaviorGraph"]["input"];
    expect(commit).toMatchObject({ profileId: "owner", now: recordedAt, mutationId: "mutation" });
    expect(commit.graph.behavior).toMatchObject({ id: result.id, user_id: "owner", created_at: recordedAt, updated_at: recordedAt,
      current_configuration_event_id: commit.configurationEvent.id });
    expect(commit.graph.schedules[0]).toMatchObject({ behavior_id: result.id, user_id: "owner",
      recurrence_rule: { daysOfWeek: ["monday", "friday"] } });
    expect(commit.graph.slots[0]).toMatchObject({ behavior_id: result.id, behavior_schedule_id: commit.graph.schedules[0].id,
      start_time: "09:00:00", created_at: recordedAt });
    expect(commit.definitionEvent).toMatchObject({ behavior_id: result.id, previous_title: null,
      next_title: "Read", next_description: "A chapter", changed_fields: ["title", "description"], recorded_at: recordedAt });
    expect(commit.configurationEvent).toMatchObject({ behavior_id: result.id, event_kind: "baseline",
      previous_configuration: null, effective_local_date: "2026-08-30", reason_code: "behavior_created" });
    expect(command.mock.calls.filter(([op]) => /BehaviorGraph$/.test(op))).toHaveLength(1);
  });

  it("retains IDs and creation timestamps while clearing text and moving an entry", async () => {
    await updateBehavior(createLocalBehaviorStore("owner", now), {
      behaviorId: "behavior", expectedUpdatedAt: stored.updated_at, recordedAt,
      values: { ...values, description: null, scheduledTime: "10:00", schedules: [{ ...values.schedules[0]!,
        timeEntries: [{ ...values.schedules[0]!.timeEntries[0]!, startTime: "10:00" }] }] },
    });
    const commit = command.mock.calls.find(([operation]) => operation === "updateBehaviorGraph")![1] as LocalCommandMap["updateBehaviorGraph"]["input"];
    expect(commit.expectedRevision).toBe(17);
    expect(commit.graph.behavior).toMatchObject({ id: "behavior", description: null, created_at: stored.created_at });
    expect(commit.graph.schedules[0]).toMatchObject({ id: "schedule", created_at: fixture.schedules[0].created_at });
    expect(commit.graph.slots[0]).toMatchObject({ id: "slot", start_time: "10:00:00", created_at: fixture.slots[0].created_at });
    expect(commit.definitionEvent).toMatchObject({ previous_description: "A chapter", next_description: null });
    expect(commit.configurationEvent).toMatchObject({ event_kind: "revision", changed_fields: ["schedule_graph"] });
  });

  it("rejects stale browser timestamps and native revision conflicts without retrying", async () => {
    const store = createLocalBehaviorStore("owner", now);
    await expect(updateBehavior(store, { behaviorId: "behavior", expectedUpdatedAt: "2026-08-28T00:00:00Z", recordedAt, values }))
      .rejects.toThrow("Behavior schedule graph changed after it was read.");
    expect(command.mock.calls.some(([operation]) => operation === "updateBehaviorGraph")).toBe(false);
    const reads = command.getMockImplementation()!;
    command.mockImplementation(async (operation: keyof LocalCommandMap, input: { graph?: LocalBehaviorGraph }) => {
      if (operation === "updateBehaviorGraph") throw new Error("Behavior changed. Review the latest Behavior and try again.");
      return reads(operation, input);
    });
    await expect(updateBehavior(store, { behaviorId: "behavior", expectedUpdatedAt: stored.updated_at, recordedAt, values }))
      .rejects.toThrow("Behavior schedule graph changed after it was read.");
    expect(command.mock.calls.filter(([operation]) => operation === "updateBehaviorGraph")).toHaveLength(1);
  });

  it("requires matching raw definition and graph guards before forwarding an atomic plan", async () => {
    let commit: BehaviorUpdateCommit | undefined;
    await updateBehavior({ getBehaviorById: async () => structuredClone(stored), createBehaviorWithAtomicScheduleGraph: vi.fn(),
      updateBehaviorWithAtomicScheduleGraph: async (input) => { commit = input; return stored; } }, {
      behaviorId: "behavior", expectedUpdatedAt: stored.updated_at, recordedAt, values,
    });
    const store = createLocalBehaviorStore("owner", now);
    await store.getBehaviorById("behavior");
    await expect(store.updateBehaviorWithAtomicScheduleGraph({ ...commit!, expectedDefinition: { title: "Other", description: null } }))
      .rejects.toThrow("Behavior schedule graph changed after it was read.");
    await expect(store.updateBehaviorWithAtomicScheduleGraph({ ...commit!, expectedScheduleGraph: [] }))
      .rejects.toThrow("Behavior schedule graph changed after it was read.");
    expect(command.mock.calls.some(([operation]) => operation === "updateBehaviorGraph")).toBe(false);
  });

  it("archives through shared policy without inventing definition history", async () => {
    await setBehaviorActive(createLocalBehaviorStore("owner", now), {
      behaviorId: "behavior", active: false, expectedUpdatedAt: stored.updated_at,
      recordedAt, newArchiveNoteId: "11111111-1111-4111-8111-111111111111", archiveNote: "Pausing",
    });
    const commit = command.mock.calls.find(([operation]) => operation === "updateBehaviorGraph")![1];
    expect(commit).toMatchObject({ expectedRevision: 17, definitionEvent: null,
      graph: { behavior: { active: false, archived_at: recordedAt, archive_notes: [{
        id: "11111111-1111-4111-8111-111111111111", archived_at: recordedAt,
        note: "Pausing", updated_at: recordedAt,
      }] } },
      configurationEvent: { reason_code: "behavior_archived", changed_fields: ["active"] } });
  });
});
