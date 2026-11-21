import type { OccurrenceStatus } from "./database";

/** One level only: a Behavior is standalone, a parent, or a sub-behavior. */
export const SUB_BEHAVIOR_MAX_DEPTH = 1;

/** Derived only. `partial` is never stored; stored statuses stay `OccurrenceStatus`. */
export type ParentSlotStatus = OccurrenceStatus | "partial";

export type ParentSlotRollup = Readonly<{
  status: ParentSlotStatus;
  completedCount: number;
  notCompletedCount: number;
  unresolvedCount: number;
  resolvedCount: number;
  totalCount: number;
  /** "2/3" style progress: completed over scheduled. */
  progressLabel: string;
  /** Completed, Not Completed, Unresolved, or the progress label when mixed. */
  statusLabel: string;
}>;

export type SubBehaviorRole = "standalone" | "parent" | "sub_behavior";

/** The link facts the resolver needs about one Behavior of the account. */
export type SubBehaviorLinkFacts = Readonly<{
  id: string;
  title?: string;
  parentBehaviorId: string | null;
  subBehaviorSortOrder?: number;
  inheritParentSchedule?: boolean;
  active?: boolean;
  archivedAt?: string | null;
  /** Behaviors of Opportunity. An opportunity Behavior is never part of a routine. */
  isOpportunity?: boolean;
}>;

export type SubBehaviorLinkRejection =
  | "self_parent"
  | "parent_not_found"
  | "parent_is_sub_behavior"
  | "has_sub_behaviors"
  | "parent_archived"
  | "opportunity";

export type SubBehaviorLinkValidation =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; reason: SubBehaviorLinkRejection; message: string }>;
