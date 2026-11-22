import type { BehaviorFields, BehaviorScheduleGraphMutation } from "../behavior-store";
import type { OccurrenceStatus } from "../types/database";
import type { Json } from "../types/json";
import type {
  ParentSlotRollup,
  ParentSlotStatus,
  SubBehaviorLinkFacts,
  SubBehaviorLinkRejection,
  SubBehaviorLinkValidation,
  SubBehaviorRole,
} from "../types/sub-behavior";

export { SUB_BEHAVIOR_MAX_DEPTH } from "../types/sub-behavior";

const REJECTION_MESSAGES: Record<SubBehaviorLinkRejection, string> = {
  self_parent: "A Behavior can't be its own parent.",
  parent_not_found: "That parent Behavior wasn't found.",
  parent_is_sub_behavior: "A sub-behavior can't have sub-behaviors.",
  has_sub_behaviors: "A Behavior with sub-behaviors can't become a sub-behavior.",
  parent_archived: "An archived Behavior can't take sub-behaviors.",
  opportunity: "An opportunity Behavior can't be part of a routine.",
};

function reject(reason: SubBehaviorLinkRejection): SubBehaviorLinkValidation {
  return { ok: false, reason, message: REJECTION_MESSAGES[reason] };
}

function isLive(behavior: SubBehaviorLinkFacts): boolean {
  return !behavior.archivedAt;
}

/** Live (non-archived) sub-behaviors of one parent, in sibling order. */
export function listSubBehaviors<T extends SubBehaviorLinkFacts>(
  parentBehaviorId: string,
  behaviors: readonly T[],
  options: { includeArchived?: boolean } = {},
): T[] {
  return sortSubBehaviors(
    behaviors.filter((behavior) =>
      behavior.parentBehaviorId === parentBehaviorId &&
      behavior.id !== parentBehaviorId &&
      (options.includeArchived || isLive(behavior))),
  );
}

export function resolveSubBehaviorRole(
  behavior: SubBehaviorLinkFacts,
  behaviors: readonly SubBehaviorLinkFacts[],
): SubBehaviorRole {
  if (behavior.parentBehaviorId) return "sub_behavior";
  return listSubBehaviors(behavior.id, behaviors).length > 0 ? "parent" : "standalone";
}

/**
 * Depth-1 rule for setting `behaviorId`'s parent to `nextParentBehaviorId`. Null passes
 * (ungroup) unless an opportunity Behavior keeps sub-behaviors. Archived children still
 * count as children, so restoring one can never make a grandchild.
 *
 * Behaviors of Opportunity: an opportunity Behavior is never a parent or a sub-behavior.
 * `nextIsOpportunity` is the subject's flag after the write; without it the stored flag
 * in `behaviors` applies.
 */
export function validateSubBehaviorLink(input: {
  behaviorId: string;
  nextParentBehaviorId: string | null;
  behaviors: readonly SubBehaviorLinkFacts[];
  nextIsOpportunity?: boolean;
}): SubBehaviorLinkValidation {
  const parentId = input.nextParentBehaviorId;
  const subjectIsOpportunity = input.nextIsOpportunity
    ?? input.behaviors.find((behavior) => behavior.id === input.behaviorId)?.isOpportunity === true;
  const hasChildren = input.behaviors.some((behavior) =>
    behavior.parentBehaviorId === input.behaviorId && behavior.id !== input.behaviorId);
  if (parentId === null) return subjectIsOpportunity && hasChildren ? reject("opportunity") : { ok: true };
  if (parentId === input.behaviorId) return reject("self_parent");
  const parent = input.behaviors.find((behavior) => behavior.id === parentId);
  if (!parent) return reject("parent_not_found");
  if (subjectIsOpportunity || parent.isOpportunity) return reject("opportunity");
  if (parent.parentBehaviorId) return reject("parent_is_sub_behavior");
  if (!isLive(parent)) return reject("parent_archived");
  if (hasChildren) return reject("has_sub_behaviors");
  return { ok: true };
}

export type SubBehaviorGraphViolation = Readonly<{
  behaviorId: string;
  reason: SubBehaviorLinkRejection;
}>;

/** Checks a whole account's links at once (imports, restores, sync). Archived parents pass. */
export function findSubBehaviorGraphViolations(
  behaviors: readonly SubBehaviorLinkFacts[],
): SubBehaviorGraphViolation[] {
  const byId = new Map(behaviors.map((behavior) => [behavior.id, behavior]));
  const violations: SubBehaviorGraphViolation[] = [];
  for (const behavior of behaviors) {
    const parentId = behavior.parentBehaviorId;
    if (!parentId) continue;
    const parent = byId.get(parentId);
    const reason: SubBehaviorLinkRejection | null =
      parentId === behavior.id ? "self_parent"
        : !parent ? "parent_not_found"
          : parent.parentBehaviorId ? "parent_is_sub_behavior"
            : behavior.isOpportunity || parent.isOpportunity ? "opportunity"
              : null;
    if (reason) violations.push({ behaviorId: behavior.id, reason });
  }
  return violations;
}

/**
 * A parent with live, active sub-behaviors generates no new Occurrences: its sub-behaviors
 * own the slot. Its past Occurrences stay as they are.
 */
export function parentOwnsOccurrenceGeneration(
  behavior: SubBehaviorLinkFacts,
  behaviors: readonly SubBehaviorLinkFacts[],
): boolean {
  if (behavior.parentBehaviorId) return true;
  return !behaviors.some((candidate) =>
    candidate.parentBehaviorId === behavior.id &&
    candidate.id !== behavior.id &&
    isLive(candidate) &&
    candidate.active !== false);
}

export function hasActiveSubBehaviors(
  parentBehaviorId: string,
  behaviors: readonly SubBehaviorLinkFacts[],
): boolean {
  return !parentOwnsOccurrenceGeneration(
    { id: parentBehaviorId, parentBehaviorId: null },
    behaviors,
  );
}

export function compareSubBehaviors(
  left: Pick<SubBehaviorLinkFacts, "id" | "title" | "subBehaviorSortOrder">,
  right: Pick<SubBehaviorLinkFacts, "id" | "title" | "subBehaviorSortOrder">,
): number {
  return (left.subBehaviorSortOrder ?? 0) - (right.subBehaviorSortOrder ?? 0)
    || (left.title ?? "").localeCompare(right.title ?? "")
    || left.id.localeCompare(right.id);
}

export function sortSubBehaviors<T extends Pick<SubBehaviorLinkFacts, "id" | "title" | "subBehaviorSortOrder">>(
  behaviors: readonly T[],
): T[] {
  return [...behaviors].sort(compareSubBehaviors);
}

/** Sort order for a sub-behavior added at the end of its siblings. */
export function nextSubBehaviorSortOrder(
  siblings: readonly Pick<SubBehaviorLinkFacts, "subBehaviorSortOrder">[],
): number {
  return siblings.reduce((max, sibling) => Math.max(max, (sibling.subBehaviorSortOrder ?? 0) + 1), 0);
}

/**
 * Dense sort orders for a requested sibling order. Ids must be exactly the current
 * siblings; returns only rows whose order changes.
 */
export function planSubBehaviorReorder(input: {
  siblings: readonly Pick<SubBehaviorLinkFacts, "id" | "subBehaviorSortOrder">[];
  orderedIds: readonly string[];
}): Array<{ id: string; subBehaviorSortOrder: number }> {
  const current = new Set(input.siblings.map((sibling) => sibling.id));
  const requested = new Set(input.orderedIds);
  if (requested.size !== input.orderedIds.length || requested.size !== current.size ||
    input.orderedIds.some((id) => !current.has(id))) {
    throw new Error("Sub-behavior order must list each sub-behavior once.");
  }
  const previous = new Map(input.siblings.map((sibling) => [sibling.id, sibling.subBehaviorSortOrder ?? 0]));
  return input.orderedIds.flatMap((id, index) =>
    previous.get(id) === index ? [] : [{ id, subBehaviorSortOrder: index }]);
}

/**
 * Derived rollup of one parent slot, derived from the sub-behaviors scheduled in it. Never a
 * fourth stored status: mixed slots read as `partial` with "2/3" progress.
 */
export function resolveParentSlotRollup(
  statuses: readonly OccurrenceStatus[],
): ParentSlotRollup {
  const completedCount = statuses.filter((status) => status === "completed").length;
  const notCompletedCount = statuses.filter((status) => status === "not_completed").length;
  const unresolvedCount = statuses.filter((status) => status === "unresolved").length;
  const totalCount = statuses.length;
  const status: ParentSlotStatus =
    totalCount === 0 || unresolvedCount === totalCount ? "unresolved"
      : completedCount === totalCount ? "completed"
        : notCompletedCount === totalCount ? "not_completed"
          : "partial";
  const progressLabel = `${completedCount}/${totalCount}`;
  return {
    status,
    completedCount,
    notCompletedCount,
    unresolvedCount,
    resolvedCount: completedCount + notCompletedCount,
    totalCount,
    progressLabel,
    statusLabel: status === "completed" ? "Completed"
      : status === "not_completed" ? "Not Completed"
        : status === "unresolved" ? "Unresolved"
          : progressLabel,
  };
}

/**
 * Marking a parent slot sets every sub-behavior Occurrence in it to one status. Returns the
 * rows that change, so the service writes them in one transaction.
 */
export function planParentSlotStatusChange<T extends { id: string; status: OccurrenceStatus }>(input: {
  occurrences: readonly T[];
  nextStatus: OccurrenceStatus;
}): T[] {
  return input.occurrences.filter((occurrence) => occurrence.status !== input.nextStatus);
}

export type MirroredScheduleFields = Pick<
  BehaviorFields,
  | "recurrence_rule"
  | "scheduled_time"
  | "timezone"
  | "end_on"
  | "end_time"
  | "pause_from_on"
  | "pause_from_time"
  | "pause_back_on"
>;

export type MirrorableBehavior = Readonly<{
  fields: MirroredScheduleFields;
  schedules: readonly BehaviorScheduleGraphMutation[];
}>;

/**
 * The schedule an inheriting sub-behavior stores: the parent's recurrence, times, timezone,
 * end and pause, on the child's own schedule rows. Existing child row ids are reused by
 * position so a mirror updates rows in place; parent ids are never copied.
 */
export function mirrorParentSchedule(input: {
  parent: MirrorableBehavior;
  childSchedules?: readonly BehaviorScheduleGraphMutation[];
}): { fields: MirroredScheduleFields; schedules: BehaviorScheduleGraphMutation[] } {
  const childSchedules = [...(input.childSchedules ?? [])].sort((left, right) => left.sort_order - right.sort_order);
  const parentSchedules = [...input.parent.schedules].sort((left, right) => left.sort_order - right.sort_order);
  return {
    fields: {
      recurrence_rule: input.parent.fields.recurrence_rule,
      scheduled_time: input.parent.fields.scheduled_time,
      timezone: input.parent.fields.timezone,
      end_on: input.parent.fields.end_on ?? null,
      end_time: input.parent.fields.end_time ?? null,
      pause_from_on: input.parent.fields.pause_from_on ?? null,
      pause_from_time: input.parent.fields.pause_from_time ?? null,
      pause_back_on: input.parent.fields.pause_back_on ?? null,
    },
    schedules: parentSchedules.map((schedule, index) => {
      const existing = childSchedules[index];
      const existingSlots = [...(existing?.slots ?? [])].sort((left, right) => left.sort_order - right.sort_order);
      return {
        id: existing?.id ?? null,
        recurrence_rule: schedule.recurrence_rule,
        sort_order: schedule.sort_order,
        slots: [...schedule.slots]
          .sort((left, right) => left.sort_order - right.sort_order)
          .map((slot, slotIndex) => ({
            id: existingSlots[slotIndex]?.id ?? null,
            kind: slot.kind,
            preset: slot.preset,
            start_time: slot.start_time,
            end_time: slot.end_time,
            sort_order: slot.sort_order,
          })),
      };
    }),
  };
}

/** True when a child's stored schedule already matches its parent's, ignoring row ids. */
export function scheduleMatchesParent(input: {
  parent: MirrorableBehavior;
  child: MirrorableBehavior;
}): boolean {
  return mirrorKey(input.parent) === mirrorKey(input.child);
}

/**
 * Children that inherit the parent's schedule and drift from it, with the mirror each one
 * should store. Custom-schedule children are left alone.
 */
export function planInheritedScheduleMirrors<T extends MirrorableBehavior & {
  id: string;
  inheritParentSchedule: boolean;
}>(input: {
  parent: MirrorableBehavior;
  children: readonly T[];
}): Array<{ behaviorId: string; fields: MirroredScheduleFields; schedules: BehaviorScheduleGraphMutation[] }> {
  return input.children
    .filter((child) => child.inheritParentSchedule && !scheduleMatchesParent({ parent: input.parent, child }))
    .map((child) => ({
      behaviorId: child.id,
      ...mirrorParentSchedule({ parent: input.parent, childSchedules: child.schedules }),
    }));
}

function mirrorKey(behavior: MirrorableBehavior): string {
  const fields = behavior.fields;
  return JSON.stringify({
    recurrence: stableJson(fields.recurrence_rule),
    time: fields.scheduled_time,
    timezone: fields.timezone,
    end: [fields.end_on ?? null, fields.end_time ?? null],
    pause: [fields.pause_from_on ?? null, fields.pause_from_time ?? null, fields.pause_back_on ?? null],
    schedules: [...behavior.schedules]
      .sort((left, right) => left.sort_order - right.sort_order)
      .map((schedule) => ({
        recurrence: stableJson(schedule.recurrence_rule),
        sort: schedule.sort_order,
        slots: [...schedule.slots]
          .sort((left, right) => left.sort_order - right.sort_order)
          .map((slot) => [slot.kind, slot.preset, slot.start_time, slot.end_time, slot.sort_order]),
      })),
  });
}

function stableJson(value: Json): Json {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, stableJson(nested as Json)]));
  }
  return value;
}
