import { Temporal } from "@js-temporal/polyfill";
import {
  briefMoveItemBlocks, briefMoveStartAllowed, checkBriefMoveSlot,
  type BriefMoveBlock, type BriefMoveCandidate, type BriefMoveInterval, type BriefMovePlanInputs,
} from "@cadence/core/resolvers/brief-move.resolver";
import { BRIEF_MOVE_DEFAULT_LATEST_START_MINUTE } from "@cadence/core/types/brief-moves";
import { alongsideMayOverlap } from "@cadence/core/resolvers/alongside.resolver";

/**
 * Advisor Phase 3 (3A2) eval, layer 1: rules every offered line must keep, checked with
 * no model (Emi's pass bars, Nov 18). The planner and the slot rule belong to 3A1;
 * these checks hold them to what the brief promises.
 */
export const BRIEF_LAYER_ONE_RULES = [
  "yes_check_alone", "yes_check_all", "declined_reoffered", "alongside_offered", "never_move_offered",
  "after_latest_hour", "lines_collide", "leaves_day", "starts_in_past", "offered_on_stale_calendar",
  // Ticket 359 (D33): a line's new time overlaps an alongside item at a different place.
  "alongside_other_place",
] as const;
export type BriefLayerOneRule = typeof BRIEF_LAYER_ONE_RULES[number];
export type BriefLayerOneViolation = Readonly<{ rule: BriefLayerOneRule; occurrenceId: string; detail: string }>;

type Line = Pick<BriefMoveCandidate, "occurrenceId" | "behaviorId" | "to" | "from">;

export function checkBriefLayerOne(input: BriefMovePlanInputs, lines: readonly Line[]): BriefLayerOneViolation[] {
  const violations: BriefLayerOneViolation[] = [];
  const add = (rule: BriefLayerOneRule, line: Line, detail: string) => violations.push({ rule, occurrenceId: line.occurrenceId, detail });
  const latest = input.latestStartMinute ?? BRIEF_MOVE_DEFAULT_LATEST_START_MINUTE;
  const alongside = new Set(input.items.filter((item) => item.alongside).map((item) => item.behaviorId));
  const calendar: BriefMoveBlock[] = input.calendarBusy.map((event) => ({ kind: "calendar", ref: event.ref, title: event.title, start: event.start, end: event.end }));
  const interval = (value: Readonly<{ startAt: string; endAt: string }>): BriefMoveInterval =>
    ({ start: Temporal.Instant.from(value.startAt), end: Temporal.Instant.from(value.endAt) });
  const accepted = new Map(lines.map((line) => [line.occurrenceId, interval(line.to)]));
  const dayEnd = Temporal.PlainDate.from(input.localDate).add({ days: 1 }).toZonedDateTime({ timeZone: input.timezone, plainTime: "00:00" }).toInstant();

  if (input.calendar === "stale") for (const line of lines) add("offered_on_stale_calendar", line, "the calendar could not be read");
  for (const line of lines) {
    const to = interval(line.to);
    if (input.declinedToday.has(line.occurrenceId)) add("declined_reoffered", line, "answered No or undone today");
    if (alongside.has(line.behaviorId)) add("alongside_offered", line, "happens alongside other things");
    if (input.neverMoveBehaviorIds.has(line.behaviorId)) add("never_move_offered", line, "set to Don't suggest moving this");
    // Items carry a Where only while CADENCE_ALONGSIDE is on; without one this rule cannot apply.
    const moving = input.items.find((item) => item.occurrenceId === line.occurrenceId);
    for (const item of input.items) {
      if (!item.alongside || !item.where || !moving?.where || item.occurrenceId === line.occurrenceId || item.status !== "unresolved") continue;
      if (overlaps(to, { start: item.start, end: item.end }) && !alongsideMayOverlap(item, { kind: "item", where: moving.where })) {
        add("alongside_other_place", line, `overlaps ${item.occurrenceId} (${item.where.kind}) from ${moving.where.kind}`);
      }
    }
    if (!briefMoveStartAllowed(to.start, input.localDate, input.timezone, latest)) add("after_latest_hour", line, `starts ${line.to.startAt}`);
    if (Temporal.Instant.compare(to.end, dayEnd) > 0) add("leaves_day", line, `ends ${line.to.endAt}`);
    if (Temporal.Instant.compare(to.start, input.now) < 0) add("starts_in_past", line, `starts ${line.to.startAt}`);
    // Yes on this line alone, with every other line still undecided.
    const alone = checkBriefMoveSlot({ interval: to, blocks: [...briefMoveItemBlocks(input.items, line.occurrenceId), ...calendar] });
    if (!alone.ok) add("yes_check_alone", line, `${alone.reason} ${alone.ref}`);
    // Accept all: every other line already at its new time.
    const others = new Map([...accepted].filter(([id]) => id !== line.occurrenceId));
    const all = checkBriefMoveSlot({ interval: to, blocks: [...briefMoveItemBlocks(input.items, line.occurrenceId, others), ...calendar] });
    if (!all.ok) add("yes_check_all", line, `${all.reason} ${all.ref}`);
  }
  for (let left = 0; left < lines.length; left += 1) {
    for (let right = left + 1; right < lines.length; right += 1) {
      const a = lines[left]!;
      const b = lines[right]!;
      if (a.occurrenceId === b.occurrenceId) add("lines_collide", a, "two lines move the same item");
      else if (overlaps(interval(a.to), interval(b.to))) add("lines_collide", a, `overlaps ${b.occurrenceId}`);
    }
  }
  return violations;
}

function overlaps(a: BriefMoveInterval, b: BriefMoveInterval): boolean {
  return Temporal.Instant.compare(a.start, b.end) < 0 && Temporal.Instant.compare(b.start, a.end) < 0;
}
