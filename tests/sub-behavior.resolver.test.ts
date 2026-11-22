import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";

import type { BehaviorScheduleGraphMutation } from "@cadence/core/behavior-store";
import { resolveAnalytics, selectLeafOccurrences } from "../lib/resolvers/analytics.resolver";
import {
  normalizeBehaviorConfiguration,
  planBehaviorConfigurationChangeEvent,
} from "../lib/resolvers/behavior-configuration.resolver";
import {
  planOccurrenceGeneration,
  type ExistingOccurrenceForGeneration,
  type OccurrenceGenerationBehavior,
} from "../lib/resolvers/occurrence.resolver";
import { resolveRoutineReminderDeliveries } from "../lib/resolvers/reminder.resolver";
import {
  findSubBehaviorGraphViolations,
  hasActiveSubBehaviors,
  listSubBehaviors,
  mirrorParentSchedule,
  nextSubBehaviorSortOrder,
  parentOwnsOccurrenceGeneration,
  planInheritedScheduleMirrors,
  planParentSlotStatusChange,
  planSubBehaviorReorder,
  resolveParentSlotRollup,
  resolveSubBehaviorRole,
  validateSubBehaviorLink,
  type MirrorableBehavior,
} from "../lib/resolvers/sub-behavior.resolver";
import { mapTimelineDaySectionOccurrences, resolveTimeline } from "../lib/resolvers/timeline.resolver";
import type { AnalyticsOccurrenceInput } from "../lib/types/analytics";
import type { BehaviorConfigurationSnapshot } from "../lib/types/behavior-configuration-event";
import { DEFAULT_TIMEZONE } from "../lib/types/recurrence";
import type { SubBehaviorLinkFacts } from "../lib/types/sub-behavior";
import type { TimelineOccurrenceInput } from "../lib/types/timeline";

const behaviors: SubBehaviorLinkFacts[] = [
  { id: "skin", title: "Skin routine", parentBehaviorId: null },
  { id: "cerave", title: "Cerave", parentBehaviorId: "skin", subBehaviorSortOrder: 1 },
  { id: "facewash", title: "Facewash", parentBehaviorId: "skin", subBehaviorSortOrder: 0 },
  { id: "retinol", title: "Retinol", parentBehaviorId: "skin", subBehaviorSortOrder: 2, archivedAt: "2026-06-01T00:00:00Z" },
  { id: "walk", title: "Walk", parentBehaviorId: null },
  { id: "old", title: "Old routine", parentBehaviorId: null, archivedAt: "2026-05-01T00:00:00Z" },
];

describe("validateSubBehaviorLink", () => {
  const check = (behaviorId: string, nextParentBehaviorId: string | null) =>
    validateSubBehaviorLink({ behaviorId, nextParentBehaviorId, behaviors });

  it("accepts a standalone Behavior under a top-level parent, and always accepts ungrouping", () => {
    expect(check("walk", "skin")).toEqual({ ok: true });
    expect(check("cerave", null)).toEqual({ ok: true });
    expect(check("skin", null)).toEqual({ ok: true });
  });

  it("keeps opportunity Behaviors out of routines (Behaviors of Opportunity)", () => {
    const withPool = [...behaviors, { id: "stretch", title: "Stretch", parentBehaviorId: null, isOpportunity: true }];
    const opportunity = { ok: false, reason: "opportunity", message: "An opportunity Behavior can't be part of a routine." };
    expect(validateSubBehaviorLink({ behaviorId: "stretch", nextParentBehaviorId: "skin", behaviors: withPool })).toEqual(opportunity);
    expect(validateSubBehaviorLink({ behaviorId: "walk", nextParentBehaviorId: "stretch", behaviors: withPool })).toEqual(opportunity);
    expect(validateSubBehaviorLink({ behaviorId: "walk", nextParentBehaviorId: "skin", behaviors, nextIsOpportunity: true })).toEqual(opportunity);
    expect(validateSubBehaviorLink({ behaviorId: "skin", nextParentBehaviorId: null, behaviors, nextIsOpportunity: true })).toEqual(opportunity);
    expect(validateSubBehaviorLink({ behaviorId: "stretch", nextParentBehaviorId: null, behaviors: withPool })).toEqual({ ok: true });
    expect(findSubBehaviorGraphViolations([...withPool, { id: "step", parentBehaviorId: "stretch" }]))
      .toContainEqual({ behaviorId: "step", reason: "opportunity" });
  });

  it("rejects self-parenting, missing parents, grandchildren, parents with children and archived parents", () => {
    expect(check("walk", "walk")).toMatchObject({ ok: false, reason: "self_parent" });
    expect(check("walk", "missing")).toMatchObject({ ok: false, reason: "parent_not_found" });
    expect(check("walk", "cerave")).toMatchObject({ ok: false, reason: "parent_is_sub_behavior" });
    expect(check("skin", "walk")).toMatchObject({ ok: false, reason: "has_sub_behaviors" });
    expect(check("walk", "old")).toMatchObject({ ok: false, reason: "parent_archived" });
  });

  it("counts archived children, so restoring one can never create a grandchild", () => {
    const onlyArchivedChild: SubBehaviorLinkFacts[] = [
      { id: "a", parentBehaviorId: null },
      { id: "b", parentBehaviorId: "a", archivedAt: "2026-06-01T00:00:00Z" },
      { id: "c", parentBehaviorId: null },
    ];
    expect(validateSubBehaviorLink({ behaviorId: "a", nextParentBehaviorId: "c", behaviors: onlyArchivedChild }))
      .toMatchObject({ ok: false, reason: "has_sub_behaviors" });
  });
});

describe("sub-behavior graph facts", () => {
  it("finds depth violations across a whole account", () => {
    expect(findSubBehaviorGraphViolations([
      { id: "a", parentBehaviorId: null },
      { id: "b", parentBehaviorId: "a" },
      { id: "c", parentBehaviorId: "b" },
      { id: "d", parentBehaviorId: "d" },
      { id: "e", parentBehaviorId: "gone" },
    ])).toEqual([
      { behaviorId: "c", reason: "parent_is_sub_behavior" },
      { behaviorId: "d", reason: "self_parent" },
      { behaviorId: "e", reason: "parent_not_found" },
    ]);
    expect(findSubBehaviorGraphViolations(behaviors)).toEqual([]);
  });

  it("resolves roles and lists live children in sibling order", () => {
    expect(resolveSubBehaviorRole(behaviors[0]!, behaviors)).toBe("parent");
    expect(resolveSubBehaviorRole(behaviors[1]!, behaviors)).toBe("sub_behavior");
    expect(resolveSubBehaviorRole(behaviors[4]!, behaviors)).toBe("standalone");
    expect(listSubBehaviors("skin", behaviors).map((child) => child.id)).toEqual(["facewash", "cerave"]);
    expect(listSubBehaviors("skin", behaviors, { includeArchived: true }).map((child) => child.id))
      .toEqual(["facewash", "cerave", "retinol"]);
  });

  it("stops parent generation only while a live, active child exists", () => {
    expect(parentOwnsOccurrenceGeneration(behaviors[0]!, behaviors)).toBe(false);
    expect(hasActiveSubBehaviors("skin", behaviors)).toBe(true);
    const inactiveOnly: SubBehaviorLinkFacts[] = [
      { id: "p", parentBehaviorId: null },
      { id: "x", parentBehaviorId: "p", active: false },
      { id: "y", parentBehaviorId: "p", archivedAt: "2026-06-01T00:00:00Z" },
    ];
    expect(hasActiveSubBehaviors("p", inactiveOnly)).toBe(false);
    expect(parentOwnsOccurrenceGeneration(inactiveOnly[1]!, inactiveOnly)).toBe(true);
  });
});

describe("sub-behavior ordering", () => {
  it("appends after the highest sibling order", () => {
    expect(nextSubBehaviorSortOrder([])).toBe(0);
    expect(nextSubBehaviorSortOrder([{ subBehaviorSortOrder: 0 }, { subBehaviorSortOrder: 4 }])).toBe(5);
  });

  it("returns dense orders for rows that move and rejects incomplete lists", () => {
    const siblings = [
      { id: "a", subBehaviorSortOrder: 0 },
      { id: "b", subBehaviorSortOrder: 1 },
      { id: "c", subBehaviorSortOrder: 2 },
    ];
    expect(planSubBehaviorReorder({ siblings, orderedIds: ["a", "c", "b"] })).toEqual([
      { id: "c", subBehaviorSortOrder: 1 },
      { id: "b", subBehaviorSortOrder: 2 },
    ]);
    expect(() => planSubBehaviorReorder({ siblings, orderedIds: ["a", "b"] })).toThrow();
    expect(() => planSubBehaviorReorder({ siblings, orderedIds: ["a", "a", "b"] })).toThrow();
    expect(() => planSubBehaviorReorder({ siblings, orderedIds: ["a", "b", "z"] })).toThrow();
  });
});

describe("resolveParentSlotRollup", () => {
  it("derives parent status from children without a stored fourth status", () => {
    expect(resolveParentSlotRollup(["completed", "completed"])).toMatchObject({
      status: "completed", statusLabel: "Completed", progressLabel: "2/2",
    });
    expect(resolveParentSlotRollup(["not_completed", "not_completed"])).toMatchObject({
      status: "not_completed", statusLabel: "Not Completed",
    });
    expect(resolveParentSlotRollup(["unresolved", "unresolved"])).toMatchObject({ status: "unresolved" });
    expect(resolveParentSlotRollup([])).toMatchObject({ status: "unresolved", progressLabel: "0/0" });
    expect(resolveParentSlotRollup(["completed", "completed", "unresolved"])).toEqual({
      status: "partial",
      completedCount: 2,
      notCompletedCount: 0,
      unresolvedCount: 1,
      resolvedCount: 2,
      totalCount: 3,
      progressLabel: "2/3",
      statusLabel: "2/3",
    });
    expect(resolveParentSlotRollup(["completed", "not_completed"]).status).toBe("partial");
  });

  it("plans a parent mark as the child rows that change", () => {
    const rows = [
      { id: "1", status: "completed" as const },
      { id: "2", status: "unresolved" as const },
      { id: "3", status: "not_completed" as const },
    ];
    expect(planParentSlotStatusChange({ occurrences: rows, nextStatus: "completed" }).map((row) => row.id))
      .toEqual(["2", "3"]);
  });
});

describe("schedule mirroring", () => {
  const parentGraph: BehaviorScheduleGraphMutation[] = [{
    id: "parent-schedule",
    recurrence_rule: { frequency: "daily", interval: 1 },
    sort_order: 0,
    slots: [{ id: "parent-slot", kind: "exact", preset: null, start_time: "08:00", end_time: null, sort_order: 0 }],
  }];
  const parent: MirrorableBehavior = {
    fields: {
      recurrence_rule: { frequency: "daily", interval: 1 },
      scheduled_time: "08:00",
      timezone: DEFAULT_TIMEZONE,
      pause_from_on: "2026-07-01",
      pause_from_time: null,
      pause_back_on: "2026-07-05",
    },
    schedules: parentGraph,
  };

  it("copies the parent's schedule onto the child's own rows and never copies parent ids", () => {
    const fresh = mirrorParentSchedule({ parent });
    expect(fresh.schedules[0]).toMatchObject({ id: null, slots: [{ id: null, start_time: "08:00" }] });
    expect(fresh.fields).toMatchObject({ scheduled_time: "08:00", pause_back_on: "2026-07-05", end_on: null });

    const reused = mirrorParentSchedule({
      parent,
      childSchedules: [{
        id: "child-schedule",
        recurrence_rule: { frequency: "weekly", interval: 1, daysOfWeek: ["monday"] },
        sort_order: 0,
        slots: [{ id: "child-slot", kind: "exact", preset: null, start_time: "21:00", end_time: null, sort_order: 0 }],
      }],
    });
    expect(reused.schedules).toEqual([{
      id: "child-schedule",
      recurrence_rule: { frequency: "daily", interval: 1 },
      sort_order: 0,
      slots: [{ id: "child-slot", kind: "exact", preset: null, start_time: "08:00", end_time: null, sort_order: 0 }],
    }]);
  });

  it("plans mirrors only for inheriting children that drifted", () => {
    const mirrored = mirrorParentSchedule({ parent });
    const plans = planInheritedScheduleMirrors({
      parent,
      children: [
        { id: "in-sync", inheritParentSchedule: true, fields: mirrored.fields, schedules: mirrored.schedules.map((schedule) => ({ ...schedule, id: "own" })) },
        { id: "drifted", inheritParentSchedule: true, fields: { ...mirrored.fields, scheduled_time: "09:00" }, schedules: mirrored.schedules },
        { id: "custom", inheritParentSchedule: false, fields: { ...mirrored.fields, scheduled_time: "21:00" }, schedules: [] },
      ],
    });
    expect(plans.map((plan) => plan.behaviorId)).toEqual(["drifted"]);
  });
});

describe("occurrence generation for parents with sub-behaviors", () => {
  const parentBehavior: OccurrenceGenerationBehavior = {
    id: "skin",
    userId: "user-1",
    configurationEventId: "config-1",
    recurrenceRule: { frequency: "daily", interval: 1 },
    scheduleSlots: [{ id: null, kind: "exact", preset: null, startTime: "09:00", endTime: null, sortOrder: 0 }],
    timezone: DEFAULT_TIMEZONE,
    active: true,
    createdAt: "2026-01-01T14:00:00Z",
  };
  const now = Temporal.Instant.from("2026-01-05T16:00:00Z");
  const existing = (id: string, localDate: string, overrides: Partial<ExistingOccurrenceForGeneration> = {}) => ({
    id,
    scheduledFor: `${localDate}T14:00:00Z`,
    localDate,
    status: "unresolved" as const,
    scheduleSlotId: null,
    scheduleKind: "exact" as const,
    schedulePreset: null,
    scheduleStartTime: "09:00",
    scheduleEndTime: null,
    note: null,
    hasTimeSessions: false,
    behaviorConfigurationEventId: "config-1",
    ...overrides,
  });

  it("creates nothing and removes only untouched future rows, keeping history", () => {
    const plan = planOccurrenceGeneration({
      behavior: { ...parentBehavior, hasActiveSubBehaviors: true },
      now,
      horizonDays: 3,
      existingOccurrences: [
        existing("today-past", "2026-01-05"),
        existing("future-untouched", "2026-01-06"),
        existing("future-noted", "2026-01-07", { note: "keep" }),
        existing("future-marked", "2026-01-08", { status: "completed" }),
      ],
    });
    expect(plan.create).toEqual([]);
    expect(plan.updateUnresolved).toEqual([]);
    expect(plan.deleteUnresolved.map((row) => row.id)).toEqual(["future-untouched"]);
  });

  it("generates as before once no active sub-behavior remains", () => {
    const plan = planOccurrenceGeneration({
      behavior: { ...parentBehavior, hasActiveSubBehaviors: false },
      now,
      horizonDays: 2,
      existingOccurrences: [],
    });
    expect(plan.create.map((row) => row.localDate)).toEqual(["2026-01-05", "2026-01-06", "2026-01-07"]);
  });
});

function timelineRow(overrides: Partial<TimelineOccurrenceInput> & Pick<TimelineOccurrenceInput, "id">): TimelineOccurrenceInput {
  return {
    behaviorId: `behavior-${overrides.id}`,
    title: `Behavior ${overrides.id}`,
    description: "",
    categoryName: "No category",
    scheduleSummary: "Daily",
    scheduledFor: "2026-06-07T13:00:00Z",
    scheduledTimeLabel: "9:00 AM",
    localDate: "2026-06-07",
    status: "unresolved",
    statusMarkedAt: null,
    note: "",
    timeTracking: { recordedSeconds: 0, runningStartedAt: null },
    canStartTimeTracking: true,
    ...overrides,
  };
}

describe("Timeline parent groups", () => {
  const now = Temporal.Instant.from("2026-06-07T16:00:00Z");
  const child = (id: string, title: string, order: number, overrides: Partial<TimelineOccurrenceInput> = {}) =>
    timelineRow({
      id,
      behaviorId: id.split("-")[0]!,
      title,
      parentBehaviorId: "skin",
      parentTitle: "Skin routine",
      subBehaviorSortOrder: order,
      scheduledFor: "2026-06-07T12:00:00Z",
      scheduledTimeLabel: "8:00 AM",
      ...overrides,
    });

  const timeline = resolveTimeline({
    now,
    timezone: DEFAULT_TIMEZONE,
    futureDays: 0,
    occurrences: [
      timelineRow({ id: "walk", title: "Walk", scheduledFor: "2026-06-07T11:00:00Z" }),
      child("cerave-1", "Cerave", 1, { status: "completed" }),
      child("facewash-1", "Facewash", 0, { status: "completed" }),
      child("retinol-1", "Retinol", 2),
      child("cerave-night", "Cerave", 1, { scheduledFor: "2026-06-08T01:00:00Z", scheduledTimeLabel: "9:00 PM" }),
      child("facewash-prior", "Facewash", 0, { localDate: "2026-06-06", scheduledFor: "2026-06-06T12:00:00Z" }),
      child("cerave-prior", "Cerave", 1, { localDate: "2026-06-06", scheduledFor: "2026-06-06T12:00:00Z", status: "completed", statusMarkedAt: "2026-06-06T13:00:00Z" }),
    ],
  });
  const today = timeline.daySections[0]!;

  it("groups children per parent slot in sibling order and keeps standalone rows apart", () => {
    expect(today.occurrenceGroups.map((group) => group.behaviorId)).toEqual(["behavior-walk"]);
    expect(today.parentGroups).toHaveLength(2);
    const morning = today.parentGroups[0]!;
    expect(morning).toMatchObject({ parentBehaviorId: "skin", title: "Skin routine", scheduledTimeLabel: "8:00 AM" });
    expect(morning.children.map((row) => row.id)).toEqual(["facewash-1", "cerave-1", "retinol-1"]);
    expect(morning.rollup).toMatchObject({ status: "partial", statusLabel: "2/3" });
    expect(morning.showDecisionActions).toBe(true);
    expect(today.parentGroups[1]!.children.map((row) => row.id)).toEqual(["cerave-night"]);
    expect(today.occurrences).toHaveLength(5);
  });

  it("orders day rows by time across standalone groups and parent slots", () => {
    expect(today.rows.map((row) => `${row.kind}:${row.key}`)).toEqual([
      "behavior:" + today.occurrenceGroups[0]!.key,
      "parent:" + today.parentGroups[0]!.key,
      "parent:" + today.parentGroups[1]!.key,
    ]);
  });

  it("shows a prior partly marked slot in Needs decision with only unresolved children counted", () => {
    expect(timeline.needsDecision.occurrenceCount).toBe(1);
    const prior = timeline.needsDecision.daySections[0]!;
    expect(prior.occurrenceGroups).toEqual([]);
    expect(prior.parentGroups[0]).toMatchObject({ visualTone: "needs_decision", isVisibleInNeedsDecision: true });
    expect(prior.parentGroups[0]!.children.map((row) => row.id)).toEqual(["facewash-prior"]);
  });

  it("recomputes rollups when a transform changes child rows", () => {
    const next = mapTimelineDaySectionOccurrences(today, (row) => ({ ...row, status: "completed" }));
    expect(next.parentGroups[0]!.rollup.status).toBe("completed");
    const row = next.rows.find((item) => item.kind === "parent");
    expect(row?.kind === "parent" && row.group.rollup.status).toBe("completed");
    expect(next.occurrenceGroups[0]!.occurrences[0]!.status).toBe("completed");
  });
});

describe("analytics leaf counting", () => {
  const row = (overrides: Partial<AnalyticsOccurrenceInput> & Pick<AnalyticsOccurrenceInput, "id">): AnalyticsOccurrenceInput => ({
    behaviorId: "walk",
    behaviorTitle: "Walk",
    behaviorCreatedAt: "2026-06-01T12:00:00Z",
    categoryName: "Health",
    scheduledFor: "2026-06-05T12:00:00Z",
    scheduledTimeLabel: "8:00 AM",
    localDate: "2026-06-05",
    status: "completed",
    note: "",
    timezone: DEFAULT_TIMEZONE,
    ...overrides,
  });
  const childRow = (id: string, behaviorId: string, localDate: string, status: AnalyticsOccurrenceInput["status"], order: number) =>
    row({
      id,
      behaviorId,
      behaviorTitle: behaviorId,
      localDate,
      scheduledFor: `${localDate}T12:00:00Z`,
      status,
      parentBehaviorId: "skin",
      parentBehaviorTitle: "Skin routine",
      subBehaviorSortOrder: order,
    });
  const occurrences = [
    row({ id: "skin-history", behaviorId: "skin", behaviorTitle: "Skin routine", localDate: "2026-06-03", scheduledFor: "2026-06-03T12:00:00Z", status: "not_completed" }),
    row({ id: "skin-superseded", behaviorId: "skin", behaviorTitle: "Skin routine", localDate: "2026-06-05", status: "completed" }),
    childRow("facewash-5", "facewash", "2026-06-05", "completed", 0),
    childRow("cerave-5", "cerave", "2026-06-05", "not_completed", 1),
    childRow("facewash-6", "facewash", "2026-06-06", "completed", 0),
    childRow("cerave-6", "cerave", "2026-06-06", "completed", 1),
    row({ id: "walk-5" }),
  ];

  it("drops a parent's own row on a day its sub-behaviors cover and keeps its history", () => {
    expect(selectLeafOccurrences(occurrences).map((item) => item.id)).not.toContain("skin-superseded");
    expect(selectLeafOccurrences(occurrences).map((item) => item.id)).toContain("skin-history");
  });

  it("counts each leaf once overall and by category, with parent rollups beside child summaries", () => {
    const view = resolveAnalytics({
      occurrences,
      now: Temporal.Instant.from("2026-06-07T16:00:00Z"),
      timezone: DEFAULT_TIMEZONE,
      rangeDays: 7,
      selectedBehaviorId: "skin",
      selectedDayLocalDate: "2026-06-05",
    });
    expect(view.summary).toMatchObject({ completedCount: 4, notCompletedCount: 2, totalCount: 6 });
    expect(view.categorySummaries).toEqual([expect.objectContaining({ categoryName: "Health", totalCount: 6 })]);
    expect(view.behaviorSummaries.map((summary) => [summary.behaviorId, summary.totalCount]))
      .toEqual([["cerave", 2], ["facewash", 2], ["skin", 1], ["walk", 1]]);
    expect(view.parentSummaries).toHaveLength(1);
    expect(view.parentSummaries[0]).toMatchObject({
      parentBehaviorId: "skin",
      title: "Skin routine",
      subBehaviorIds: ["facewash", "cerave"],
      totalCount: 5,
      completedCount: 3,
      slotCounts: { totalSlots: 3, completedSlots: 1, partialSlots: 1, notCompletedSlots: 1, unresolvedSlots: 0 },
    });
    expect(view.selectedBehaviorDay).toMatchObject({ behaviorTitle: "Skin routine" });
    expect(view.selectedBehaviorDay?.occurrences.map((item) => item.id)).toEqual(["cerave-5", "facewash-5"]);
  });
});

describe("routine reminders", () => {
  const parent = { id: "skin", userId: "u", browserReminderEnabled: true, emailReminderEnabled: false, reminderOffsetMinutes: 10 };
  const childBehavior = (id: string) => ({ id, userId: "u", browserReminderEnabled: true, emailReminderEnabled: true, reminderOffsetMinutes: 0 });
  const occurrence = (id: string, status: "unresolved" | "completed" = "unresolved", scheduledFor = "2026-06-07T12:00:00Z") =>
    ({ id, userId: "u", scheduledFor, status });

  it("sends one reminder per slot for inheriting children, with the parent's settings", () => {
    const result = resolveRoutineReminderDeliveries({
      parent,
      children: [
        { behavior: childBehavior("cerave"), inheritParentSchedule: true, subBehaviorSortOrder: 1, occurrences: [occurrence("cerave-1")] },
        { behavior: childBehavior("facewash"), inheritParentSchedule: true, subBehaviorSortOrder: 0, occurrences: [occurrence("facewash-1")] },
      ],
    });
    expect(result.deliveries).toEqual([{
      userId: "u",
      occurrenceId: "facewash-1",
      channel: "browser_push",
      scheduledSendAt: "2026-06-07T11:50:00Z",
      status: "pending",
    }]);
    expect(result.slots).toEqual([{
      parentBehaviorId: "skin",
      scheduledFor: "2026-06-07T12:00:00Z",
      anchorOccurrenceId: "facewash-1",
      occurrenceIds: ["facewash-1", "cerave-1"],
    }]);
  });

  it("moves the anchor past marked children, drops fully marked slots and keeps custom reminders", () => {
    const result = resolveRoutineReminderDeliveries({
      parent,
      children: [
        { behavior: childBehavior("facewash"), inheritParentSchedule: true, subBehaviorSortOrder: 0, occurrences: [occurrence("facewash-1", "completed"), occurrence("facewash-2", "completed", "2026-06-08T12:00:00Z")] },
        { behavior: childBehavior("cerave"), inheritParentSchedule: true, subBehaviorSortOrder: 1, occurrences: [occurrence("cerave-1")] },
        { behavior: childBehavior("retinol"), inheritParentSchedule: false, subBehaviorSortOrder: 2, occurrences: [occurrence("retinol-1", "unresolved", "2026-06-08T01:00:00Z")] },
      ],
    });
    expect(result.slots.map((slot) => slot.anchorOccurrenceId)).toEqual(["cerave-1"]);
    expect(result.deliveries.map((delivery) => `${delivery.occurrenceId}:${delivery.channel}`)).toEqual([
      "retinol-1:browser_push",
      "retinol-1:email",
      "cerave-1:browser_push",
    ]);
  });
});

describe("configuration history for sub-behavior links", () => {
  const base: BehaviorConfigurationSnapshot = {
    categoryId: null,
    scheduleGraph: [],
    browserReminderEnabled: true,
    emailReminderEnabled: false,
    reminderOffsetMinutes: 0,
    active: true,
    timezone: DEFAULT_TIMEZONE,
  };
  const change = (previous: Partial<BehaviorConfigurationSnapshot>, next: Partial<BehaviorConfigurationSnapshot>) =>
    planBehaviorConfigurationChangeEvent({
      previousConfiguration: { ...base, ...previous },
      nextConfiguration: { ...base, ...next },
      recordedAt: "2026-06-07T16:00:00Z",
      effectiveAt: "2026-06-07T16:00:00Z",
      source: "manual",
      reasonCode: "behavior_updated",
    });

  it("reads older snapshots as standalone and defaults inheritance on under a parent", () => {
    expect(normalizeBehaviorConfiguration(base)).toMatchObject({ parentBehaviorId: null, inheritParentSchedule: false });
    expect(normalizeBehaviorConfiguration({ ...base, parentBehaviorId: "skin" }))
      .toMatchObject({ parentBehaviorId: "skin", inheritParentSchedule: true });
    expect(normalizeBehaviorConfiguration({ ...base, parentBehaviorId: null, inheritParentSchedule: true }))
      .toMatchObject({ inheritParentSchedule: false });
    expect(change({}, { parentBehaviorId: null })).toBeNull();
  });

  it("records grouping, ungrouping and inheritance changes", () => {
    expect(change({}, { parentBehaviorId: "skin" })?.changedFields).toEqual(["parent_behavior_id", "inherit_parent_schedule"]);
    expect(change({ parentBehaviorId: "skin" }, { parentBehaviorId: "skin", inheritParentSchedule: false })?.changedFields)
      .toEqual(["inherit_parent_schedule"]);
    expect(change({ parentBehaviorId: "skin", inheritParentSchedule: false }, { parentBehaviorId: "body", inheritParentSchedule: false })?.changedFields)
      .toEqual(["parent_behavior_id"]);
  });
});
