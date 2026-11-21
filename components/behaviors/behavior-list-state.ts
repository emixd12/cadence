import { sortSubBehaviors, validateSubBehaviorLink } from "@cadence/core/resolvers/sub-behavior.resolver";
import type { SubBehaviorLinkFacts } from "@cadence/core/types/sub-behavior";
import type { BehaviorView } from "@/lib/types/behavior";

export function upsertBehaviorView(
  behaviors: BehaviorView[],
  behavior: BehaviorView,
): BehaviorView[] {
  return [...behaviors.filter((item) => item.id !== behavior.id), behavior].sort(
    compareBehaviorViews,
  );
}

export function reconcileCreatedBehaviorViews(
  createdBehaviorRows: BehaviorView[],
  activeBehaviors: readonly BehaviorView[],
  archivedBehaviors: readonly BehaviorView[],
): BehaviorView[] {
  if (createdBehaviorRows.length === 0) {
    return createdBehaviorRows;
  }

  const serverBehaviorIds = new Set([
    ...activeBehaviors.map((behavior) => behavior.id),
    ...archivedBehaviors.map((behavior) => behavior.id),
  ]);
  const pendingCreatedRows = createdBehaviorRows.filter(
    (behavior) => !serverBehaviorIds.has(behavior.id),
  );

  return pendingCreatedRows.length === createdBehaviorRows.length
    ? createdBehaviorRows
    : pendingCreatedRows;
}

export function removeBehaviorView(
  behaviors: BehaviorView[],
  behaviorId: string,
): BehaviorView[] {
  return behaviors.filter((behavior) => behavior.id !== behaviorId);
}

function compareBehaviorViews(left: BehaviorView, right: BehaviorView): number {
  const timeComparison = left.scheduledTime.localeCompare(right.scheduledTime);

  if (timeComparison !== 0) {
    return timeComparison;
  }

  const titleComparison = left.title.localeCompare(right.title);

  if (titleComparison !== 0) {
    return titleComparison;
  }

  return left.id.localeCompare(right.id);
}

export type BehaviorSort = "time" | "name" | "category";

export function projectBehaviorList(
  behaviors: readonly BehaviorView[],
  categories: readonly { id: string }[],
  categoryId: string,
  sort: BehaviorSort,
) {
  const order = new Map(categories.map((category, index) => [category.id, index]));
  const rows = [...behaviors].sort((left, right) => {
    if (sort === "time") return compareBehaviorViews(left, right);
    const categoryOrder = sort === "category"
      ? (order.get(left.categoryId) ?? categories.length) - (order.get(right.categoryId) ?? categories.length)
      : 0;
    return categoryOrder || left.title.localeCompare(right.title) || left.id.localeCompare(right.id);
  });
  const visibleIds = new Set(rows.filter((behavior) =>
    categoryId === "all" || (categoryId === "none" ? !behavior.categoryId : behavior.categoryId === categoryId),
  ).map((behavior) => behavior.id));
  return { rows, visibleIds };
}

/** Behaviors of Opportunity: available as an opportunity with no fixed schedule. */
export function isUnscheduledOpportunity(behavior: Pick<BehaviorView, "isOpportunity" | "schedules">): boolean {
  return behavior.isOpportunity === true && (behavior.schedules?.length ?? 0) === 0;
}

export type ParentOption = Readonly<{ id: string; title: string }>;

function linkFacts(behavior: BehaviorView): SubBehaviorLinkFacts {
  return {
    id: behavior.id,
    title: behavior.title,
    parentBehaviorId: behavior.parentBehaviorId ?? null,
    subBehaviorSortOrder: behavior.subBehaviorSortOrder,
    inheritParentSchedule: behavior.inheritParentSchedule,
    active: behavior.active,
    archivedAt: behavior.archivedAt,
  };
}

/**
 * Parent choices for one Behavior (null while creating): the depth-1 rules come from the
 * sub-behavior resolver. `locked` means the Behavior has sub-behaviors of its own.
 */
export function parentChoices(
  behaviorId: string | null,
  behaviors: readonly BehaviorView[],
): { options: ParentOption[]; locked: boolean } {
  const facts = behaviors.map(linkFacts);
  const subjectId = behaviorId ?? "";
  const locked = behaviorId !== null && facts.some((behavior) => behavior.parentBehaviorId === behaviorId);
  if (locked) return { options: [], locked };
  const options = behaviors
    .filter((candidate) => candidate.active && validateSubBehaviorLink({
      behaviorId: subjectId, nextParentBehaviorId: candidate.id, behaviors: facts,
    }).ok)
    .map((candidate) => ({ id: candidate.id, title: candidate.title }))
    .sort((left, right) => left.title.localeCompare(right.title) || left.id.localeCompare(right.id));
  return { options, locked };
}

/** Sub-behaviors of each parent present in `behaviors`, in sibling order. */
export function groupSubBehaviors(behaviors: readonly BehaviorView[]): Map<string, BehaviorView[]> {
  const ids = new Set(behaviors.map((behavior) => behavior.id));
  const groups = new Map<string, BehaviorView[]>();
  for (const behavior of behaviors) {
    const parentId = behavior.parentBehaviorId;
    if (!parentId || !ids.has(parentId)) continue;
    groups.set(parentId, [...(groups.get(parentId) ?? []), behavior]);
  }
  for (const [parentId, children] of groups) groups.set(parentId, sortSubBehaviors(children));
  return groups;
}

/** Moves one id up or down a list of ids; returns the list unchanged at the ends. */
export function moveId(ids: readonly string[], id: string, direction: -1 | 1): string[] {
  const index = ids.indexOf(id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= ids.length) return [...ids];
  const next = [...ids];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

/** Standalone Behaviors that may move under one parent. */
export function attachCandidates(parentId: string, behaviors: readonly BehaviorView[]): ParentOption[] {
  return behaviors
    .filter((behavior) => behavior.active && behavior.id !== parentId && !behavior.parentBehaviorId &&
      parentChoices(behavior.id, behaviors).options.some((option) => option.id === parentId))
    .map((behavior) => ({ id: behavior.id, title: behavior.title }))
    .sort((left, right) => left.title.localeCompare(right.title) || left.id.localeCompare(right.id));
}
