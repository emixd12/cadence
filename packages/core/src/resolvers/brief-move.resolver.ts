import { Temporal } from "@js-temporal/polyfill";

import {
  BRIEF_MOVE_DEFAULT_LATEST_START_MINUTE,
  BRIEF_MOVE_FALLBACK_MINUTES,
  type BriefMoveLength,
  type BriefMoveLengthSource,
  type BriefMoveReasonCode,
  type BriefMoveTravel,
} from "../types/brief-moves";
import { localDateAt, localDayBounds } from "./time.resolver";

/**
 * Advisor Phase 3A1: the one free-slot rule. The Daily Brief's lines, Other time,
 * Re-plan, Yes, Accept all and the Timeline's own "Move for today" all decide "is
 * this time free" here, so a time the brief offers is never refused at Yes on the
 * same data (docs/DATETIME_STRATEGY.md, "Brief moves"):
 *   - Every item has a length: the Behavior's setting, the logged average, the
 *     cached model estimate, then 30 minutes.
 *   - An exact-time item blocks its own length; a range item blocks only its own
 *     length, placed at the earliest point in its range that is free.
 *   - An "alongside" item (a pill, a device) blocks nothing.
 *   - Items and calendar events keep a 10-minute gap on each side. Travel spans
 *     already include their own margins, so they keep none.
 *   - The moved item's own travel (when known) pads its interval before and after.
 */

export const BRIEF_MOVE_BUFFER_SECONDS = 10 * 60;
export const BRIEF_MOVE_STEP_SECONDS = 5 * 60;
export const BRIEF_MOVE_OTHER_TIMES = 3;
/** At most this many lines per brief. */
export const BRIEF_MOVE_MAX_LINES = 8;

export type BriefMoveInterval = Readonly<{ start: Temporal.Instant; end: Temporal.Instant }>;

/** One of the day's items, at its effective time, with its length already resolved. */
export type BriefMoveDayItem = Readonly<{
  occurrenceId: string;
  behaviorId: string;
  title: string;
  status: string;
  localDate: string;
  scheduleKind: "exact" | "range";
  /** Effective start (the latest move, otherwise the plan). For a range, the range start. */
  start: Temporal.Instant;
  /** Exact items: effective end (moved) or start + length. Range items: the range end. */
  end: Temporal.Instant;
  length: BriefMoveLength;
  alongside: boolean;
  revision: string;
  behaviorRevision: string;
}>;

export type BriefMoveBlock = BriefMoveInterval & Readonly<{
  kind: "item" | "calendar" | "travel";
  ref: string;
  title?: string;
}>;

export type BriefMoveSlotCheck =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; reason: "slot_taken" | "too_close" | "calendar_busy" | "travel_busy"; ref: string }>;

/** The length order. `minutes` values below one minute are ignored. */
export function resolveBriefMoveLength(input: Readonly<{
  behaviorDefaultMinutes: number | null;
  loggedAverageSeconds: number | null;
  estimateMinutes: number | null;
}>): BriefMoveLength {
  const made = (minutes: number, source: BriefMoveLengthSource): BriefMoveLength =>
    ({ minutes: Math.min(Math.max(1, Math.round(minutes)), 1440), source, assumed: source === "model_estimate" || source === "fallback" });
  if (input.behaviorDefaultMinutes && input.behaviorDefaultMinutes >= 1) return made(input.behaviorDefaultMinutes, "behavior_duration");
  if (input.loggedAverageSeconds && input.loggedAverageSeconds >= 60) return made(input.loggedAverageSeconds / 60, "logged_average");
  if (input.estimateMinutes && input.estimateMinutes >= 1) return made(input.estimateMinutes, "model_estimate");
  return made(BRIEF_MOVE_FALLBACK_MINUTES, "fallback");
}

/**
 * What the day's other items occupy, as seen by `excludeId`'s move. `positions`
 * overrides where an item sits (a line already chosen in the same brief).
 */
export function briefMoveItemBlocks(
  items: readonly BriefMoveDayItem[],
  excludeId: string | null,
  positions: ReadonlyMap<string, BriefMoveInterval> = new Map(),
): BriefMoveBlock[] {
  const open = items.filter((item) => item.status === "unresolved" && item.occurrenceId !== excludeId && !item.alongside);
  const exact: BriefMoveBlock[] = open.filter((item) => item.scheduleKind === "exact").map((item) => {
    const at = positions.get(item.occurrenceId) ?? { start: item.start, end: item.end };
    return { kind: "item", ref: item.occurrenceId, title: item.title, start: at.start, end: later(at.end, at.start) };
  });
  const placed: BriefMoveBlock[] = [...exact];
  const ranges = open.filter((item) => item.scheduleKind === "range")
    .sort((left, right) => Temporal.Instant.compare(left.start, right.start) || left.occurrenceId.localeCompare(right.occurrenceId));
  for (const item of ranges) {
    const seconds = item.length.minutes * 60;
    let start = item.start;
    // Earliest free point in the range; when nothing fits, the range start.
    for (let at = item.start; Temporal.Instant.compare(at.add({ seconds }), item.end) <= 0; at = at.add({ seconds: BRIEF_MOVE_STEP_SECONDS })) {
      const interval = { start: at, end: at.add({ seconds }) };
      if (!placed.some((block) => overlaps(interval, widen(block, BRIEF_MOVE_BUFFER_SECONDS)))) { start = at; break; }
    }
    placed.push({ kind: "item", ref: item.occurrenceId, title: item.title, start, end: start.add({ seconds }) });
  }
  return placed;
}

/** Is `interval` (padded by the item's own travel) free of every block, with the gap? */
export function checkBriefMoveSlot(input: Readonly<{
  interval: BriefMoveInterval;
  blocks: readonly BriefMoveBlock[];
  travelBeforeSeconds?: number;
  travelAfterSeconds?: number;
  bufferSeconds?: number;
}>): BriefMoveSlotCheck {
  const buffer = input.bufferSeconds ?? BRIEF_MOVE_BUFFER_SECONDS;
  const occupied = {
    start: input.interval.start.subtract({ seconds: input.travelBeforeSeconds ?? 0 }),
    end: input.interval.end.add({ seconds: input.travelAfterSeconds ?? 0 }),
  };
  const ordered = [...input.blocks].sort((left, right) => Temporal.Instant.compare(left.start, right.start));
  // Real overlaps first, so the reason names the most basic problem.
  for (const block of ordered) {
    if (!overlaps(occupied, block)) continue;
    return { ok: false, reason: block.kind === "calendar" ? "calendar_busy" : block.kind === "travel" ? "travel_busy" : "slot_taken", ref: block.ref };
  }
  for (const block of ordered) {
    if (block.kind === "travel" || !overlaps(occupied, widen(block, buffer))) continue;
    return { ok: false, reason: "too_close", ref: block.ref };
  }
  return { ok: true };
}

/**
 * Free starts on the local day, one per free gap, nearest `near` first, then returned
 * in time order. Starts are on 5-minute steps, not before `now`, and not after the
 * latest start minute when one is given. The item may end after midnight.
 */
export function briefMoveFreeStarts(input: Readonly<{
  localDate: string;
  timezone: string;
  now: Temporal.Instant;
  near: Temporal.Instant;
  lengthSeconds: number;
  blocks: readonly BriefMoveBlock[];
  travelBeforeSeconds?: number;
  travelAfterSeconds?: number;
  latestStartMinute?: number | null;
  limit: number;
  exclude?: readonly Temporal.Instant[];
}>): Temporal.Instant[] {
  const day = localDayBounds(input.localDate, input.timezone);
  const earliest = roundUp(later(day.start, input.now), BRIEF_MOVE_STEP_SECONDS);
  const latest = input.latestStartMinute == null ? null : latestStartInstant(input.localDate, input.timezone, input.latestStartMinute);
  const candidates: Temporal.Instant[] = [];
  for (let start = earliest; Temporal.Instant.compare(start, day.end) < 0; start = start.add({ seconds: BRIEF_MOVE_STEP_SECONDS })) {
    if (latest && Temporal.Instant.compare(start, latest) > 0) break;
    const check = checkBriefMoveSlot({
      interval: { start, end: start.add({ seconds: input.lengthSeconds }) }, blocks: input.blocks,
      travelBeforeSeconds: input.travelBeforeSeconds, travelAfterSeconds: input.travelAfterSeconds,
    });
    if (check.ok) candidates.push(start);
  }
  const distance = (value: Temporal.Instant) => Math.abs(value.since(input.near).total({ unit: "seconds" }));
  const gaps: Temporal.Instant[][] = [];
  for (const candidate of candidates) {
    const last = gaps.at(-1)?.at(-1);
    if (last && candidate.since(last).total({ unit: "seconds" }) === BRIEF_MOVE_STEP_SECONDS) gaps.at(-1)!.push(candidate);
    else gaps.push([candidate]);
  }
  const excluded = [input.near, ...(input.exclude ?? [])];
  return gaps
    .map((gap) => gap.filter((start) => !excluded.some((item) => item.equals(start)))
      .sort((left, right) => distance(left) - distance(right) || Temporal.Instant.compare(left, right))[0])
    .filter((start): start is Temporal.Instant => Boolean(start))
    .sort((left, right) => distance(left) - distance(right) || Temporal.Instant.compare(left, right))
    .slice(0, input.limit)
    .sort(Temporal.Instant.compare);
}

/** Signed travel for one request (lib/services/travel-times-token.ts), already verified. */
export type BriefMoveTravelInput = Readonly<{
  /** Occupied travel spans (routes and their margins) and the commitments they serve. */
  spans: readonly Readonly<{ start: Temporal.Instant; end: Temporal.Instant; refs: readonly string[] }>[];
  /** Travel each stop needs before and after it, by occurrence id. */
  stops: ReadonlyMap<string, Readonly<{ beforeSeconds: number; afterSeconds: number }>>;
  /** Occurrences at a place whose travel time is not known. */
  unknown: ReadonlySet<string>;
}>;

export type BriefMoveCalendarBusy = BriefMoveInterval & Readonly<{ ref: string; title?: string }>;

export type BriefMoveCandidate = Readonly<{
  /** Stable within one plan: the occurrence id. */
  key: string;
  occurrenceId: string;
  behaviorId: string;
  behaviorRevision: string;
  title: string;
  localDate: string;
  timezone: string;
  expectedRevision: string;
  from: Readonly<{ startAt: string; endAt: string }>;
  to: Readonly<{ startAt: string; endAt: string }>;
  length: BriefMoveLength;
  reasonCode: BriefMoveReasonCode;
  reason: string;
  anchor: Readonly<{ kind: "calendar_event" | "trip" | "item"; title: string }> | null;
  otherTimes: readonly string[];
  travel: BriefMoveTravel;
  late: boolean;
  offerNeverMove: boolean;
  /** The reason or anchor names a calendar event: the stored text is kept for its day only. */
  calendarDerived: boolean;
}>;

export type BriefMovePlanInputs = Readonly<{
  localDate: string;
  timezone: string;
  now: Temporal.Instant;
  items: readonly BriefMoveDayItem[];
  calendarBusy: readonly BriefMoveCalendarBusy[];
  /** `stale`: a connected calendar could not be read now, so no time is offered. */
  calendar: "current" | "stale" | "none";
  travel: BriefMoveTravelInput | null;
  /** Behaviors whose stops are at a place ("place" Where), for "travel not checked". */
  placeBehaviorIds?: ReadonlySet<string>;
  /** Occurrences answered No or undone today. */
  declinedToday: ReadonlySet<string>;
  neverMoveBehaviorIds: ReadonlySet<string>;
  /** Behaviors declined on enough different days to offer "Don't suggest moving this". */
  offerNeverMoveBehaviorIds?: ReadonlySet<string>;
  latestStartMinute?: number;
  maxLines?: number;
}>;

export type BriefMovePlan = Readonly<{
  candidates: readonly BriefMoveCandidate[];
  calendar: "current" | "stale" | "none";
}>;

/**
 * The brief's move lines, with no database and no model: what will go wrong today and
 * one move per affected item. Lines are chosen in time order and each chosen time
 * blocks the later ones, so Accept all's times never collide.
 */
export function planBriefMoveLinesFromInputs(input: BriefMovePlanInputs): BriefMovePlan {
  if (input.calendar === "stale") return { candidates: [], calendar: "stale" };
  const latestStartMinute = input.latestStartMinute ?? BRIEF_MOVE_DEFAULT_LATEST_START_MINUTE;
  const positions = new Map<string, BriefMoveInterval>();
  const today = input.items.filter((item) => item.localDate === input.localDate);
  const movable = (item: BriefMoveDayItem) => item.status === "unresolved" && item.scheduleKind === "exact" && !item.alongside
    && !input.neverMoveBehaviorIds.has(item.behaviorId) && !input.declinedToday.has(item.occurrenceId);
  const ordered = [...today].sort((left, right) => Temporal.Instant.compare(left.start, right.start) || left.occurrenceId.localeCompare(right.occurrenceId));
  const calendarBlocks: BriefMoveBlock[] = input.calendarBusy.map((event) => ({ kind: "calendar", ref: event.ref, title: event.title, start: event.start, end: event.end }));
  const candidates: BriefMoveCandidate[] = [];

  for (const item of ordered) {
    if (candidates.length >= (input.maxLines ?? BRIEF_MOVE_MAX_LINES)) break;
    if (!movable(item)) continue;
    const current = positions.get(item.occurrenceId) ?? { start: item.start, end: item.end };
    const travelBlocks = travelBlocksFor(input.travel, item.occurrenceId);
    const itemBlocks = briefMoveItemBlocks(input.items, item.occurrenceId, positions);
    const problem = findProblem(item, current, {
      now: input.now, calendar: calendarBlocks, travel: travelBlocks, items: itemBlocks,
      laterMovable: (ref) => {
        const other = today.find((candidate) => candidate.occurrenceId === ref);
        if (!other || !movable(other)) return false;
        const at = positions.get(other.occurrenceId) ?? { start: other.start, end: other.end };
        const order = Temporal.Instant.compare(at.start, current.start);
        return order > 0 || (order === 0 && other.occurrenceId > item.occurrenceId);
      },
    });
    if (!problem) continue;

    const stop = input.travel?.stops.get(item.occurrenceId) ?? null;
    const atPlace = input.travel?.unknown.has(item.occurrenceId) || (input.placeBehaviorIds?.has(item.behaviorId) ?? false);
    const travel: BriefMoveTravel = stop ? "checked" : atPlace ? "not_checked" : "not_needed";
    const lengthSeconds = item.length.minutes * 60;
    const blocks = [...itemBlocks, ...calendarBlocks, ...travelBlocks];
    const near = problem.code === "time_passed" ? input.now : current.start;
    const starts = briefMoveFreeStarts({
      localDate: item.localDate, timezone: input.timezone, now: input.now, near, lengthSeconds, blocks,
      travelBeforeSeconds: stop?.beforeSeconds, travelAfterSeconds: stop?.afterSeconds,
      latestStartMinute, limit: 1 + BRIEF_MOVE_OTHER_TIMES, exclude: [current.start],
    });
    if (!starts.length) continue;
    const nearest = (problem.code === "time_passed"
      ? [...starts].sort(Temporal.Instant.compare)
      : [...starts].sort((left, right) => Math.abs(left.since(near).total("seconds")) - Math.abs(right.since(near).total("seconds"))
        || Temporal.Instant.compare(left, right)))[0]!;
    const to = { start: nearest, end: nearest.add({ seconds: lengthSeconds }) };
    positions.set(item.occurrenceId, to);
    candidates.push({
      key: item.occurrenceId,
      occurrenceId: item.occurrenceId,
      behaviorId: item.behaviorId,
      behaviorRevision: item.behaviorRevision,
      title: item.title,
      localDate: item.localDate,
      timezone: input.timezone,
      expectedRevision: item.revision,
      from: { startAt: current.start.toString(), endAt: current.end.toString() },
      to: { startAt: to.start.toString(), endAt: to.end.toString() },
      length: item.length,
      reasonCode: problem.code,
      reason: stockBriefMoveReason(problem.code, item.title, problem.anchor),
      anchor: problem.anchor,
      otherTimes: starts.filter((start) => !start.equals(nearest)).map((start) => start.toString()),
      travel,
      late: problem.code === "time_passed" || Temporal.Instant.compare(current.start, input.now) < 0,
      offerNeverMove: input.offerNeverMoveBehaviorIds?.has(item.behaviorId) ?? false,
      calendarDerived: problem.anchor?.kind === "calendar_event",
    });
  }
  return { candidates, calendar: input.calendar };
}

/** The stock reason sentence for each code. 3A2's model may write a better one. */
export function stockBriefMoveReason(code: BriefMoveReasonCode, title: string,
  anchor: BriefMoveCandidate["anchor"]): string {
  switch (code) {
    case "calendar_overlap":
      return anchor ? `${title} overlaps “${anchor.title}” on your calendar.` : `${title} overlaps an event on your calendar.`;
    case "travel_overlap":
      return `${title} falls in time you need for travel.`;
    case "item_overlap":
      return anchor ? `${title} overlaps ${anchor.title}.` : `${title} overlaps another item.`;
    case "tight_transition":
      return `${title} leaves no time between it and the next thing.`;
    case "time_passed":
      return `${title}’s time has passed.`;
    case "conflict_after_schedule_edit":
      return `A schedule change now puts something else at ${title}’s moved time.`;
  }
}

/** The latest allowed start as an instant on the local date (22:00 by default). */
export function latestStartInstant(localDate: string, timezone: string, minute: number): Temporal.Instant {
  return Temporal.PlainDate.from(localDate)
    .toPlainDateTime({ hour: Math.floor(minute / 60), minute: minute % 60 })
    .toZonedDateTime(timezone, { disambiguation: "compatible" })
    .toInstant();
}

/** Whether a start is on the item's day and not after the latest hour. */
export function briefMoveStartAllowed(start: Temporal.Instant, localDate: string, timezone: string, latestStartMinute: number): boolean {
  return localDateAt(start, timezone) === localDate
    && Temporal.Instant.compare(start, latestStartInstant(localDate, timezone, latestStartMinute)) <= 0;
}

export function travelBlocksFor(travel: BriefMoveTravelInput | null, occurrenceId: string): BriefMoveBlock[] {
  if (!travel) return [];
  const own = `occurrence:${occurrenceId}`;
  return travel.spans.filter((span) => !span.refs.includes(own))
    .map((span, index) => ({ kind: "travel" as const, ref: span.refs[0] ?? `travel:${index}`, start: span.start, end: span.end }));
}

// ------------------------------------------------------------------ helpers

type Problem = Readonly<{ code: BriefMoveReasonCode; anchor: BriefMoveCandidate["anchor"] }>;

function findProblem(item: BriefMoveDayItem, current: BriefMoveInterval, input: Readonly<{
  now: Temporal.Instant;
  calendar: readonly BriefMoveBlock[];
  travel: readonly BriefMoveBlock[];
  items: readonly BriefMoveBlock[];
  laterMovable: (ref: string) => boolean;
}>): Problem | null {
  if (Temporal.Instant.compare(current.end, input.now) <= 0) return { code: "time_passed", anchor: null };
  const calendar = input.calendar.find((block) => overlaps(current, block));
  if (calendar) return { code: "calendar_overlap", anchor: calendar.title ? { kind: "calendar_event", title: calendar.title } : null };
  if (input.travel.some((block) => overlaps(current, block))) return { code: "travel_overlap", anchor: null };
  // Of two overlapping items, the later one moves, unless it cannot be moved.
  const other = input.items.find((block) => overlaps(current, block) && !input.laterMovable(block.ref));
  if (other) return { code: "item_overlap", anchor: other.title ? { kind: "item", title: other.title } : null };
  return null;
}

function overlaps(left: BriefMoveInterval, right: BriefMoveInterval): boolean {
  return Temporal.Instant.compare(left.start, right.end) < 0 && Temporal.Instant.compare(right.start, left.end) < 0;
}

function widen(block: BriefMoveInterval, seconds: number): BriefMoveInterval {
  return { start: block.start.subtract({ seconds }), end: block.end.add({ seconds }) };
}

function later(left: Temporal.Instant, right: Temporal.Instant): Temporal.Instant {
  return Temporal.Instant.compare(left, right) >= 0 ? left : right;
}

function roundUp(value: Temporal.Instant, seconds: number): Temporal.Instant {
  const unit = seconds * 1000;
  return Temporal.Instant.fromEpochMilliseconds(Math.ceil(value.epochMilliseconds / unit) * unit);
}
