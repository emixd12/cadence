import { Temporal } from "@js-temporal/polyfill";

import { noticeText } from "../notices";
import { formatBriefingTime } from "../services/daily-brief-presentation";
import {
  BRIEF_MOVE_DEFAULT_LATEST_START_MINUTE,
  type BriefMovePairingNeed,
  type BriefMoveTravel,
} from "../types/brief-moves";
import { alongsideMayOverlap, alongsidePairingGuesses } from "./alongside.resolver";
import {
  BRIEF_MOVE_MAX_LINES,
  BRIEF_MOVE_OTHER_TIMES,
  briefMoveBlocksForSubject,
  briefMoveFreeStarts,
  briefMoveItemBlocks,
  briefMoveRoutineBlocks,
  briefMoveStartAllowed,
  checkBriefMoveSlot,
  collapseBriefMoveRoutines,
  travelBlocksFor,
  type BriefMoveBlock,
  type BriefMoveCalendarBusy,
  type BriefMoveCandidate,
  type BriefMoveDayItem,
  type BriefMoveInterval,
  type BriefMoveOverlapSubject,
  type BriefMovePlanInputs,
  type BriefMoveTravelInput,
} from "./brief-move.resolver";
import { COACH_SIGNAL_V2_THRESHOLDS } from "./coach-signals-v2.resolver";

/**
 * Ticket 361 (docs/DECISIONS.md, 2026-11-25, D33, "Pairing for today"): the one rule
 * for booking an alongside item during another of today's items. The Daily Brief and
 * Chat both ask it; the model only writes the words.
 *
 *   - Guest: an Unresolved, exact-time alongside item today whose place is known or
 *     guessed (its effective Where is not unknown).
 *   - Host: an Unresolved, exact-time Cadence item today that is not alongside, at least
 *     as long as the guest, starting now or later and not after the latest start hour,
 *     whose place is known or guessed and compatible under `alongsideMayOverlap`. Hosts
 *     are Cadence items only, never calendar events (D33).
 *   - Routines: a step that follows its routine's time is neither a guest nor a host on
 *     its own. A routine slot of two or more such steps is one item, as the brief's
 *     collapse makes it: it may host (titled by the routine, with the steps' summed
 *     length and shared Where), and it is never a guest.
 *   - A pairing helps only when the guest sits in a crowded hour, runs into travel or an
 *     item somewhere else, or the coach's done_together signal names the guest with one
 *     of today's hosts. Otherwise nothing is proposed. "Crowded" reuses the coach's
 *     `crowded_hour` threshold (`COACH_SIGNAL_V2_THRESHOLDS.crowdedHour.minItemsPerDay`,
 *     3 items in one hour, alongside items not counted) on today's items, or an hour the
 *     stored `crowded_hour` signal names.
 *   - Host order: a host the done_together signal names first, then the nearest host to
 *     the guest's current start, then the earlier, then by id. At most one pairing per
 *     guest and per host. A guest already inside a compatible host's time is left alone,
 *     including a host that started before `now`.
 *   - The target is the host's start for the guest's own length. It must pass the same
 *     slot check a Yes runs (`checkBriefMoveSlot` on the guest's blocks under the
 *     same-place rule, with the guest's own travel), so a proposed pairing is not
 *     refused at Yes on the same data.
 *
 * A pairing is an ordinary move of the guest. Nothing links the two items: a later move
 * of the host does not carry the guest.
 *
 * Pure: no database, environment or clock. Inject `now`.
 */

/** The reason code a pairing line carries (move_proposals.reason, occurrence_moves.reason). */
export const ALONGSIDE_PAIRING_REASON_CODE = "alongside_pairing" as const;

/** Items in one local hour that make it crowded: the coach's own `crowded_hour` threshold. */
export const ALONGSIDE_PAIRING_CROWDED_ITEMS = COACH_SIGNAL_V2_THRESHOLDS.crowdedHour.minItemsPerDay;

/** What the coach's stored signals say, as ids and hours only. */
export type AlongsidePairingEvidence = Readonly<{
  /** Pairs from `done_together` signals, either direction. */
  doneTogether: readonly Readonly<{ behaviorId: string; otherBehaviorId: string }>[];
  /** Local hours (0 to 23) a `crowded_hour` signal names. */
  crowdedHours: readonly number[];
}>;

export const NO_ALONGSIDE_PAIRING_EVIDENCE: AlongsidePairingEvidence = Object.freeze({ doneTogether: [], crowdedHours: [] });

export type AlongsidePairingInputs = Readonly<{
  localDate: string;
  timezone: string;
  now: Temporal.Instant;
  /** The day's items (neighbouring days included), each with its effective Where. */
  items: readonly BriefMoveDayItem[];
  calendarBusy: readonly BriefMoveCalendarBusy[];
  travel: BriefMoveTravelInput | null;
  evidence: AlongsidePairingEvidence;
  /** Occurrences answered No or undone today: not guests. */
  declinedToday?: ReadonlySet<string>;
  /** "Don't suggest moving this": not guests. */
  neverMoveBehaviorIds?: ReadonlySet<string>;
  latestStartMinute?: number;
  /** Items other lines already move, at the time they offer: neither guest nor host, and they block there. */
  positions?: ReadonlyMap<string, BriefMoveInterval>;
  /** Only these occurrences may be guests (Chat on request, Re-plan, Re-check). */
  onlyGuests?: ReadonlySet<string>;
  excludeHosts?: ReadonlySet<string>;
  /** False when the person asked for this guest (Chat) or the need was already found (Re-plan): skip the "helps" rule. */
  requireNeed?: boolean;
  limit?: number;
}>;

export type AlongsidePairing = Readonly<{
  guest: BriefMoveDayItem;
  host: BriefMoveDayItem;
  /** The guest's new time: the host's start, for the guest's length. */
  to: BriefMoveInterval;
  needs: readonly BriefMovePairingNeed[];
  /** Other free starts for the guest near the host's start (Other time), ascending. */
  otherTimes: readonly Temporal.Instant[];
}>;

export function planAlongsidePairings(input: AlongsidePairingInputs): AlongsidePairing[] {
  const latest = input.latestStartMinute ?? BRIEF_MOVE_DEFAULT_LATEST_START_MINUTE;
  const positions = new Map(input.positions ?? []);
  const routineSlots = briefMoveRoutineBlocks(input.items);
  const today = collapseBriefMoveRoutines(input.items).filter((item) => item.localDate === input.localDate);
  const open = (item: BriefMoveDayItem) => item.status === "unresolved" && item.scheduleKind === "exact";
  const placed = (item: BriefMoveDayItem) => !!item.where && item.where.kind !== "unknown";
  const followsRoutine = (item: BriefMoveDayItem) => item.routine?.inheritParentSchedule === true;
  const byStart = (left: BriefMoveDayItem, right: BriefMoveDayItem) =>
    Temporal.Instant.compare(left.start, right.start) || left.occurrenceId.localeCompare(right.occurrenceId);

  const guests = today.filter((item) => open(item) && item.alongside && placed(item) && !followsRoutine(item)
    && !positions.has(item.occurrenceId)
    && !(input.declinedToday?.has(item.occurrenceId) ?? false)
    && !(input.neverMoveBehaviorIds?.has(item.behaviorId) ?? false)
    && (!input.onlyGuests || input.onlyGuests.has(item.occurrenceId))).sort(byStart);
  // Every open item that could host, including ones already in progress: a guest inside
  // one of them is already paired (audit fix 5b). Only those starting now or later, by
  // the latest start, may be offered.
  const openHosts = today.filter((item) => open(item) && !item.alongside && placed(item)
    && (!followsRoutine(item) || routineSlots.has(item.occurrenceId))
    && !positions.has(item.occurrenceId)).sort(byStart);
  const hosts = openHosts.filter((item) => !(input.excludeHosts?.has(item.occurrenceId) ?? false)
    && Temporal.Instant.compare(item.start, input.now) >= 0
    && briefMoveStartAllowed(item.start, input.localDate, input.timezone, latest));

  const calendar: BriefMoveBlock[] = input.calendarBusy.map((event) => ({ kind: "calendar", ref: event.ref, title: event.title, start: event.start, end: event.end }));
  const used = new Set<string>();
  const pairings: AlongsidePairing[] = [];

  for (const guest of guests) {
    if (pairings.length >= (input.limit ?? Number.POSITIVE_INFINITY)) break;
    const subject: BriefMoveOverlapSubject = { alongside: true, where: guest.where };
    const seconds = guest.length.minutes * 60;
    const stop = input.travel?.stops.get(guest.occurrenceId);
    const blocks = () => briefMoveBlocksForSubject([
      ...briefMoveItemBlocks(input.items, guest.occurrenceId, positions, subject),
      ...calendar,
      ...travelBlocksFor(input.travel, guest.occurrenceId),
    ], subject);
    const fits = (host: BriefMoveDayItem) => host.end.since(host.start).total("seconds") >= seconds
      && alongsideMayOverlap(guest, { kind: "item", where: host.where });
    // Already during a compatible host, even one that started before now: nothing to book.
    if (openHosts.some((host) => fits(host)
      && Temporal.Instant.compare(host.start, guest.start) <= 0 && Temporal.Instant.compare(guest.end, host.end) <= 0)) continue;
    const compatible = hosts.filter(fits);
    const candidates = compatible.filter((host) => !used.has(host.occurrenceId) && !host.start.equals(guest.start));
    if (!candidates.length) continue;

    const partners = doneTogetherPartners(input.evidence, guest.behaviorId);
    const needs: BriefMovePairingNeed[] = [];
    if (crowded(guest, today, input)) needs.push("crowded_hour");
    if (!checkBriefMoveSlot({ interval: { start: guest.start, end: guest.end }, blocks: blocks(), bufferSeconds: 0,
      travelBeforeSeconds: stop?.beforeSeconds, travelAfterSeconds: stop?.afterSeconds }).ok) needs.push("conflict");
    if (candidates.some((host) => partners.has(host.behaviorId))) needs.push("done_together");
    if ((input.requireNeed ?? true) && !needs.length) continue;

    const distance = (host: BriefMoveDayItem) => Math.abs(host.start.since(guest.start).total("seconds"));
    const ordered = [...candidates].sort((left, right) => Number(partners.has(right.behaviorId)) - Number(partners.has(left.behaviorId))
      || distance(left) - distance(right) || byStart(left, right));
    for (const host of ordered) {
      const to = { start: host.start, end: host.start.add({ seconds }) };
      const view = blocks();
      const check = checkBriefMoveSlot({ interval: to, blocks: view, travelBeforeSeconds: stop?.beforeSeconds, travelAfterSeconds: stop?.afterSeconds });
      if (!check.ok) continue;
      const otherTimes = briefMoveFreeStarts({
        localDate: guest.localDate, timezone: input.timezone, now: input.now, near: host.start, lengthSeconds: seconds, blocks: view,
        travelBeforeSeconds: stop?.beforeSeconds, travelAfterSeconds: stop?.afterSeconds, latestStartMinute: latest,
        limit: BRIEF_MOVE_OTHER_TIMES, exclude: [guest.start],
      });
      positions.set(guest.occurrenceId, to);
      used.add(host.occurrenceId);
      pairings.push({ guest, host, to, needs, otherTimes });
      break;
    }
  }
  return pairings;
}

/** Inputs for the brief's pairing lines: the move planner's inputs plus the coach's evidence. */
export type BriefPairingInputs = BriefMovePlanInputs & Readonly<{ evidence: AlongsidePairingEvidence }>;

/**
 * The brief's pairing lines, after its move lines: they count toward the same line cap,
 * hold the times the move lines offer, and offer nothing on a stale calendar.
 */
export function planBriefPairingLines(input: BriefPairingInputs, moveLines: readonly BriefMoveCandidate[]): BriefMoveCandidate[] {
  if (input.calendar === "stale") return [];
  const room = (input.maxLines ?? BRIEF_MOVE_MAX_LINES) - moveLines.length;
  if (room <= 0) return [];
  const positions = new Map(moveLines.map((line) => [line.occurrenceId, { start: Temporal.Instant.from(line.to.startAt), end: Temporal.Instant.from(line.to.endAt) }]));
  return planAlongsidePairings({
    localDate: input.localDate, timezone: input.timezone, now: input.now, items: input.items, calendarBusy: input.calendarBusy,
    travel: input.travel, evidence: input.evidence, declinedToday: input.declinedToday, neverMoveBehaviorIds: input.neverMoveBehaviorIds,
    latestStartMinute: input.latestStartMinute, positions, limit: room,
  }).map((pairing) => briefPairingCandidate(pairing, input));
}

/** One pairing as a brief line. The stock reason stands until the model writes one. */
export function briefPairingCandidate(pairing: AlongsidePairing, input: Pick<BriefMovePlanInputs, "timezone" | "now" | "travel" | "placeBehaviorIds" | "offerNeverMoveBehaviorIds">): BriefMoveCandidate {
  const { guest, host } = pairing;
  const unknownLeg = input.travel?.unknown.has(guest.occurrenceId) ?? false;
  const stop = input.travel?.stops.get(guest.occurrenceId) ?? null;
  const atPlace = input.placeBehaviorIds?.has(guest.behaviorId) ?? false;
  const travel: BriefMoveTravel = unknownLeg ? "not_checked" : stop ? "checked" : atPlace ? "not_checked" : "not_needed";
  const guesses = alongsidePairingGuesses(guest, host);
  return {
    key: guest.occurrenceId,
    occurrenceId: guest.occurrenceId,
    behaviorId: guest.behaviorId,
    behaviorRevision: guest.behaviorRevision,
    title: guest.title,
    localDate: guest.localDate,
    timezone: input.timezone,
    expectedRevision: guest.revision,
    from: { startAt: guest.start.toString(), endAt: guest.end.toString() },
    to: { startAt: pairing.to.start.toString(), endAt: pairing.to.end.toString() },
    length: guest.length,
    reasonCode: ALONGSIDE_PAIRING_REASON_CODE,
    reason: stockAlongsidePairingReason(guest.title, host.title, host.start, input.timezone),
    anchor: { kind: "item", title: host.title },
    otherTimes: pairing.otherTimes.map((start) => start.toString()),
    travel,
    late: Temporal.Instant.compare(guest.start, input.now) < 0,
    offerNeverMove: input.offerNeverMoveBehaviorIds?.has(guest.behaviorId) ?? false,
    calendarDerived: false,
    pairing: {
      hostOccurrenceId: host.occurrenceId, hostBehaviorId: host.behaviorId, hostTitle: host.title,
      hostStartAt: host.start.toString(), needs: pairing.needs,
      ...(guesses ? { guesses } : {}),
    },
  };
}

/** "Do Red light helmet during Reading at 8:00 PM." from the notices library. */
export function stockAlongsidePairingReason(guest: string, host: string, hostStart: Temporal.Instant, timezone: string): string {
  return noticeText("brief-moves.pairing", { guest, host, time: formatBriefingTime(hostStart.toString(), timezone) });
}

/**
 * Whether a stored pairing still describes the day: its host is still an Unresolved item
 * today at the same start. A line whose host moved, was marked or left is re-planned.
 */
export function pairingHostStands(items: readonly BriefMoveDayItem[], pairing: Readonly<{ hostOccurrenceId: string; hostStartAt: string }>): boolean {
  const host = collapseBriefMoveRoutines(items).find((item) => item.occurrenceId === pairing.hostOccurrenceId);
  return !!host && host.status === "unresolved" && host.start.equals(Temporal.Instant.from(pairing.hostStartAt));
}

// ------------------------------------------------------------------ helpers

function doneTogetherPartners(evidence: AlongsidePairingEvidence, behaviorId: string): ReadonlySet<string> {
  const partners = new Set<string>();
  for (const pair of evidence.doneTogether) {
    if (pair.behaviorId === behaviorId) partners.add(pair.otherBehaviorId);
    else if (pair.otherBehaviorId === behaviorId) partners.add(pair.behaviorId);
  }
  return partners;
}

/** The guest's local hour holds the coach's crowded count of items (alongside ones not counted), or a crowded_hour signal names it. */
function crowded(guest: BriefMoveDayItem, today: readonly BriefMoveDayItem[], input: Pick<AlongsidePairingInputs, "timezone" | "evidence">): boolean {
  const hourOf = (instant: Temporal.Instant) => instant.toZonedDateTimeISO(input.timezone).hour;
  const hour = hourOf(guest.start);
  if (input.evidence.crowdedHours.includes(hour)) return true;
  const inHour = today.filter((item) => item.scheduleKind === "exact" && !item.alongside && hourOf(item.start) === hour).length;
  return inHour >= ALONGSIDE_PAIRING_CROWDED_ITEMS;
}
