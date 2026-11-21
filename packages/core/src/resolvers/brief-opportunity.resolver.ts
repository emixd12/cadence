import { Temporal } from "@js-temporal/polyfill";

import {
  BRIEF_MOVE_MAX_LINES,
  BRIEF_MOVE_OTHER_TIMES,
  briefMoveFreeStarts,
  briefMoveItemBlocks,
  checkBriefMoveSlot,
  type BriefMoveBlock,
  type BriefMoveCalendarBusy,
  type BriefMoveDayItem,
  type BriefMoveInterval,
  type BriefMoveTravelInput,
} from "./brief-move.resolver";
import { BRIEF_MOVE_DEFAULT_LATEST_START_MINUTE, type BriefMoveLength, type BriefMoveTravel } from "../types/brief-moves";
import {
  BRIEF_OPPORTUNITY_MAX_LINES,
  type BriefOpportunityReasonCode,
  type BriefOpportunityWhere,
} from "../types/brief-opportunities";

/**
 * Behaviors of Opportunity (Task 7): the Daily Brief's "Add for today" lines, with no
 * database and no model. Every time comes from the one free-slot rule of the move lines
 * (`briefMoveItemBlocks`, `checkBriefMoveSlot`, `briefMoveFreeStarts`):
 *   - Today's open items block their time; a move line already planned in the same
 *     brief blocks its new time. Calendar events and travel spans block too.
 *   - A stale calendar offers nothing.
 *   - Behaviors not on Today come first, never Completed before longest-ago Completed.
 *     A Behavior already on Today is offered only when no other candidate fits.
 *   - "anywhere" and "home" come before "place". A home item is not offered between the
 *     day's first and last travel span (the person is away). A place item is offered
 *     with "travel not checked": an added item has no route yet.
 *   - At most `maxLines` lines, and the brief's lines together stay at or under
 *     `BRIEF_MOVE_MAX_LINES`. Each chosen time blocks the later ones.
 */

export type BriefOpportunityPoolItem = Readonly<{
  behaviorId: string;
  title: string;
  /** The Behavior's revision (`updated_at`) when read. */
  behaviorRevision: string;
  length: BriefMoveLength;
  whereKind: BriefOpportunityWhere;
  /** Whole days since the last Completed Occurrence; null when never Completed. */
  daysSinceLastCompleted: number | null;
  /** The Behavior already has an Occurrence today. */
  onToday: boolean;
}>;

export type BriefOpportunityPlanInputs = Readonly<{
  localDate: string;
  timezone: string;
  now: Temporal.Instant;
  items: readonly BriefMoveDayItem[];
  /** Where the brief's move lines put their items, by occurrence id. */
  movePositions?: ReadonlyMap<string, BriefMoveInterval>;
  /** Move lines already in this brief, for the shared line cap. */
  moveLineCount?: number;
  calendarBusy: readonly BriefMoveCalendarBusy[];
  calendar: "current" | "stale" | "none";
  travel: BriefMoveTravelInput | null;
  pool: readonly BriefOpportunityPoolItem[];
  /** Behaviors answered No or undone today. */
  declinedTodayBehaviorIds: ReadonlySet<string>;
  /** Behaviors switched to "Don't suggest adding this". */
  neverAddBehaviorIds: ReadonlySet<string>;
  /** Behaviors declined on enough different days to offer "Don't suggest adding this". */
  offerNeverAddBehaviorIds?: ReadonlySet<string>;
  latestStartMinute?: number;
  maxLines?: number;
}>;

export type BriefOpportunityCandidate = Readonly<{
  /** Stable within one plan: the Behavior id. */
  key: string;
  behaviorId: string;
  behaviorRevision: string;
  title: string;
  localDate: string;
  timezone: string;
  at: Readonly<{ startAt: string; endAt: string }>;
  length: BriefMoveLength;
  whereKind: BriefOpportunityWhere;
  reasonCode: BriefOpportunityReasonCode;
  daysSinceLastCompleted: number | null;
  otherTimes: readonly string[];
  travel: BriefMoveTravel;
  offerNeverAdd: boolean;
}>;

export type BriefOpportunityPlan = Readonly<{
  candidates: readonly BriefOpportunityCandidate[];
  calendar: "current" | "stale" | "none";
}>;

export function planBriefOpportunityLinesFromInputs(input: BriefOpportunityPlanInputs): BriefOpportunityPlan {
  if (input.calendar === "stale") return { candidates: [], calendar: "stale" };
  const cap = Math.max(0, Math.min(input.maxLines ?? BRIEF_OPPORTUNITY_MAX_LINES, BRIEF_MOVE_MAX_LINES - (input.moveLineCount ?? 0)));
  if (cap === 0) return { candidates: [], calendar: input.calendar };

  const eligible = input.pool.filter((item) => !input.declinedTodayBehaviorIds.has(item.behaviorId) && !input.neverAddBehaviorIds.has(item.behaviorId));
  const ordered = [...eligible].sort(compareCandidates);
  const notOnToday = ordered.filter((item) => !item.onToday);
  const blocks: BriefMoveBlock[] = briefOpportunityBlocks(input);
  const away = awaySpan(input.travel);
  const candidates: BriefOpportunityCandidate[] = [];

  const tryPool = (pool: readonly BriefOpportunityPoolItem[]) => {
    for (const item of pool) {
      if (candidates.length >= cap) return;
      // Just before now: `briefMoveFreeStarts` never returns `near` itself.
      const starts = briefOpportunityStarts({ ...input, item, blocks, away, near: input.now.subtract({ nanoseconds: 1 }), limit: 1 + BRIEF_MOVE_OTHER_TIMES });
      const [first, ...others] = starts;
      if (!first) continue;
      const end = first.add({ minutes: item.length.minutes });
      blocks.push({ kind: "item", ref: `opportunity:${item.behaviorId}`, title: item.title, start: first, end });
      candidates.push({
        key: item.behaviorId,
        behaviorId: item.behaviorId,
        behaviorRevision: item.behaviorRevision,
        title: item.title,
        localDate: input.localDate,
        timezone: input.timezone,
        at: { startAt: first.toString(), endAt: end.toString() },
        length: item.length,
        whereKind: item.whereKind,
        reasonCode: "open_window",
        daysSinceLastCompleted: item.daysSinceLastCompleted,
        otherTimes: others.map((start) => start.toString()),
        travel: opportunityTravel(item.whereKind),
        offerNeverAdd: input.offerNeverAddBehaviorIds?.has(item.behaviorId) ?? false,
      });
    }
  };
  tryPool(notOnToday);
  // Already on Today: only when nothing else fits.
  if (!candidates.length) tryPool(ordered.filter((item) => item.onToday));
  return { candidates, calendar: input.calendar };
}

/** What blocks an opportunity line: today's open items (at their planned move), calendar events and travel. */
export function briefOpportunityBlocks(input: Readonly<{
  items: readonly BriefMoveDayItem[];
  movePositions?: ReadonlyMap<string, BriefMoveInterval>;
  calendarBusy: readonly BriefMoveCalendarBusy[];
  travel: BriefMoveTravelInput | null;
}>): BriefMoveBlock[] {
  return [
    ...briefMoveItemBlocks(input.items, null, input.movePositions ?? new Map()),
    ...input.calendarBusy.map((event) => ({ kind: "calendar" as const, ref: event.ref, start: event.start, end: event.end, ...(event.title ? { title: event.title } : {}) })),
    ...(input.travel?.spans ?? []).map((span, index) => ({ kind: "travel" as const, ref: span.refs[0] ?? `travel:${index}`, start: span.start, end: span.end })),
  ];
}

/**
 * Free starts for one opportunity item by the one rule, nearest `near` first then in
 * time order. Home items skip starts while the person is away.
 */
export function briefOpportunityStarts(input: Readonly<{
  localDate: string;
  timezone: string;
  now: Temporal.Instant;
  near: Temporal.Instant;
  item: Pick<BriefOpportunityPoolItem, "length" | "whereKind">;
  blocks: readonly BriefMoveBlock[];
  away?: BriefMoveInterval | null;
  travel?: BriefMoveTravelInput | null;
  latestStartMinute?: number;
  limit: number;
  exclude?: readonly Temporal.Instant[];
}>): Temporal.Instant[] {
  const lengthSeconds = input.item.length.minutes * 60;
  const away = input.away === undefined ? awaySpan(input.travel ?? null) : input.away;
  const blocks = input.item.whereKind === "home" && away
    ? [...input.blocks, { kind: "travel" as const, ref: "away", start: away.start, end: away.end }]
    : input.blocks;
  return briefMoveFreeStarts({
    localDate: input.localDate, timezone: input.timezone, now: input.now, near: input.near, lengthSeconds, blocks,
    latestStartMinute: input.latestStartMinute ?? BRIEF_MOVE_DEFAULT_LATEST_START_MINUTE,
    limit: input.limit, exclude: input.exclude,
  });
}

/** Is one opportunity time still free by the one rule (Yes, Other time, Re-check)? */
export function checkBriefOpportunitySlot(input: Readonly<{
  start: Temporal.Instant;
  item: Pick<BriefOpportunityPoolItem, "length" | "whereKind">;
  blocks: readonly BriefMoveBlock[];
  travel: BriefMoveTravelInput | null;
}>): ReturnType<typeof checkBriefMoveSlot> {
  const away = awaySpan(input.travel);
  const blocks = input.item.whereKind === "home" && away
    ? [...input.blocks, { kind: "travel" as const, ref: "away", start: away.start, end: away.end }]
    : input.blocks;
  return checkBriefMoveSlot({ interval: { start: input.start, end: input.start.add({ minutes: input.item.length.minutes }) }, blocks });
}

export function opportunityTravel(whereKind: BriefOpportunityWhere): BriefMoveTravel {
  return whereKind === "place" ? "not_checked" : "not_needed";
}

/** From the day's first travel span to its last: the person is away from home. */
function awaySpan(travel: BriefMoveTravelInput | null): BriefMoveInterval | null {
  const spans = travel?.spans ?? [];
  if (spans.length < 2) return null;
  const start = spans.map((span) => span.start).sort(Temporal.Instant.compare)[0]!;
  const end = spans.map((span) => span.end).sort(Temporal.Instant.compare).at(-1)!;
  return { start, end };
}

function whereRank(where: BriefOpportunityWhere): number {
  return where === "place" ? 1 : 0;
}

function compareCandidates(left: BriefOpportunityPoolItem, right: BriefOpportunityPoolItem): number {
  const days = (item: BriefOpportunityPoolItem) => item.daysSinceLastCompleted ?? Number.POSITIVE_INFINITY;
  return Number(left.onToday) - Number(right.onToday)
    || whereRank(left.whereKind) - whereRank(right.whereKind)
    || days(right) - days(left)
    || left.title.localeCompare(right.title)
    || left.behaviorId.localeCompare(right.behaviorId);
}
