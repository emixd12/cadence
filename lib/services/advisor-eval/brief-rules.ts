import { Temporal } from "@js-temporal/polyfill";
import {
  briefMoveBlocksForSubject, briefMoveItemBlocks, briefMoveOverlapSubject, briefMoveStartAllowed, checkBriefMoveSlot,
  type BriefMoveBlock, type BriefMoveCandidate, type BriefMoveInterval, type BriefMovePlanInputs,
} from "@cadence/core/resolvers/brief-move.resolver";
import { BRIEF_MOVE_DEFAULT_LATEST_START_MINUTE } from "@cadence/core/types/brief-moves";
import { alongsideMayOverlap } from "@cadence/core/resolvers/alongside.resolver";
import { textQuotesDayNote, type BriefDayNote } from "@cadence/core/resolvers/day-note.resolver";
import type { BriefPeriods } from "@cadence/core/resolvers/period.resolver";

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
  // Ticket 361 (D33): a pairing line not at its host's start, or with a host that may not host it.
  "pairing_off_host",
] as const;
export type BriefLayerOneRule = typeof BRIEF_LAYER_ONE_RULES[number];
export type BriefLayerOneViolation = Readonly<{ rule: BriefLayerOneRule; occurrenceId: string; detail: string }>;

type Line = Pick<BriefMoveCandidate, "occurrenceId" | "behaviorId" | "to" | "from"> & Partial<Pick<BriefMoveCandidate, "reasonCode" | "pairing">>;

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
    // Ticket 361: a pairing line is the one line that moves an alongside item.
    const pairing = line.reasonCode === "alongside_pairing" ? line.pairing ?? null : null;
    if (alongside.has(line.behaviorId) && !pairing) add("alongside_offered", line, "happens alongside other things");
    if (pairing) {
      const host = input.items.find((item) => item.occurrenceId === pairing.hostOccurrenceId);
      const guest = input.items.find((item) => item.occurrenceId === line.occurrenceId);
      if (!host || host.alongside || host.status !== "unresolved" || !host.start.equals(to.start) || !host.where || host.where.kind === "unknown"
        || !guest?.where || guest.where.kind === "unknown" || !alongsideMayOverlap(guest, { kind: "item", where: host.where })) {
        add("pairing_off_host", line, `host ${pairing.hostOccurrenceId}`);
      }
    }
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
    // Yes on this line alone, with every other line still undecided. An alongside subject sees
    // calendar events under the same-place rule, as the Yes check does (items carry a Where only with the flag on).
    const subject = briefMoveOverlapSubject(input.items, line.occurrenceId);
    const alone = checkBriefMoveSlot({ interval: to, blocks: briefMoveBlocksForSubject([...briefMoveItemBlocks(input.items, line.occurrenceId), ...calendar], subject) });
    if (!alone.ok) add("yes_check_alone", line, `${alone.reason} ${alone.ref}`);
    // Accept all: every other line already at its new time.
    const others = new Map([...accepted].filter(([id]) => id !== line.occurrenceId));
    const all = checkBriefMoveSlot({ interval: to, blocks: briefMoveBlocksForSubject([...briefMoveItemBlocks(input.items, line.occurrenceId, others), ...calendar], subject) });
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

/**
 * Ticket 367 (D35): a rule on the brief's words, not its lines. The model's opening and
 * reasons may be informed by a day note and may never repeat one. Production replaces a
 * sentence that does with Cadence's stock text (`opening_day_note`, `reason_day_note`), so
 * the rule reads both what is shown and which sentences were replaced.
 */
export const BRIEF_DAY_NOTE_RULE = "day_note_not_quoted";

export function checkBriefDayNoteNotQuoted(input: Readonly<{
  dayNotes: readonly BriefDayNote[];
  /** The opening and every reason, as shown. */
  texts: readonly string[];
  fallbacks: readonly string[];
}>): Readonly<{ passed: boolean; detail?: string }> {
  const replaced = input.fallbacks.filter((item) => item.endsWith("_day_note"));
  if (replaced.length) return { passed: false, detail: replaced.join(",") };
  const notes = input.dayNotes.map((item) => item.note);
  return input.texts.some((text) => textQuotesDayNote(text, notes)) ? { passed: false, detail: "shown" } : { passed: true };
}

/**
 * Ticket 371 (D35): a rule on the brief's words when the facts carry Periods. The opening
 * and the reasons may name a Period's label. They may not suggest marking anything because
 * of it, and may not say anything about the person's health beyond the label itself. The
 * rule reads the shown text with the labels taken out, so a label such as "Sick" passes and
 * the same word added by the model does not. "These days are marked Sick" names a label;
 * "mark them done" suggests a mark.
 */
export const BRIEF_PERIOD_RULE = "period_named_not_judged";

const PERIOD_MARKING = /\b(mark(s|ed|ing)? (it|them|this|that|these|those|anything|everything|the rest)|mark(s|ed|ing)?\b[^.]{0,40}\b(done|completed?|missed)|count(s|ed|ing)? (it|them|this|that|these|those|today) as|skip(s|ped|ping)?|excus(e|es|ed|ing)|write (it|them|these|those|today) off|let (it|them|these|those) (go|slide)|as (done|completed)|not (done|completed))\b/i;
const PERIOD_HEALTH = /\b(sick|ill|illness|unwell|symptoms?|fever|recover(y|s|ed|ing)?|heal(s|ed|ing)?|rest up|get well|feel(ing)? better|take care of yourself|doctors?|medic(ine|ation|al)|health|diagnos\w+)\b/i;

export function checkBriefPeriodNamedNotJudged(input: Readonly<{
  periods: BriefPeriods;
  /** The opening and every reason, as shown. */
  texts: readonly string[];
}>): Readonly<{ passed: boolean; detail?: string }> {
  const labels = [...input.periods.periods, ...input.periods.recentPeriods].map((item) => item.label).sort((a, b) => b.length - a.length);
  for (const shown of input.texts) {
    let text = shown;
    for (const label of labels) text = text.replace(new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu"), " ");
    const marking = text.match(PERIOD_MARKING);
    if (marking) return { passed: false, detail: `marking: ${marking[0]}` };
    const health = text.match(PERIOD_HEALTH);
    if (health) return { passed: false, detail: `health: ${health[0]}` };
  }
  return { passed: true };
}
