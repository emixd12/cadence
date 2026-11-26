import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";
import {
  ALONGSIDE_PAIRING_CROWDED_ITEMS,
  ALONGSIDE_PAIRING_REASON_CODE,
  NO_ALONGSIDE_PAIRING_EVIDENCE,
  pairingHostStands,
  planAlongsidePairings,
  planBriefPairingLines,
  stockAlongsidePairingReason,
  type AlongsidePairingEvidence,
  type AlongsidePairingInputs,
} from "@cadence/core/resolvers/alongside-pairing.resolver";
import * as compatibility from "@/lib/resolvers/alongside-pairing.resolver";
import {
  BRIEF_MOVE_MAX_LINES,
  briefMoveBlocksForSubject,
  briefMoveItemBlocks,
  briefMoveOverlapSubject,
  checkBriefMoveSlot,
  planBriefMoveLinesFromInputs,
  travelBlocksFor,
  type BriefMoveCalendarBusy,
  type BriefMoveDayItem,
  type BriefMovePlanInputs,
  type BriefMoveTravelInput,
} from "@cadence/core/resolvers/brief-move.resolver";
import { COACH_SIGNAL_V2_THRESHOLDS } from "@cadence/core/resolvers/coach-signals-v2.resolver";
import type { EffectiveWhere } from "@cadence/core/resolvers/effective-where.resolver";

// Ticket 361 (D33, "Pairing for today"): the pairing planner.

const TZ = "America/New_York";
const DAY = "2026-11-25";
const local = (time: string) => Temporal.PlainDateTime.from(`${DAY}T${time}`).toZonedDateTime(TZ).toInstant();
const NOW = local("08:00");

const HOME: EffectiveWhere = { kind: "home", source: "person" };
const HOME_GUESS: EffectiveWhere = { kind: "home", source: "guess" };
const ANYWHERE: EffectiveWhere = { kind: "anywhere", source: "person" };
const UNKNOWN: EffectiveWhere = { kind: "unknown", source: "none" };
const ELSEWHERE: EffectiveWhere = { kind: "elsewhere", source: "guess" };

function item(id: string, start: string, minutes: number, extra: Partial<BriefMoveDayItem> = {}): BriefMoveDayItem {
  const begin = local(start);
  return {
    occurrenceId: id, behaviorId: `b-${id}`, title: id, status: "unresolved", localDate: DAY, scheduleKind: "exact",
    start: begin, end: begin.add({ minutes }), length: { minutes, source: "behavior_duration", assumed: false },
    alongside: false, alongsideSource: "default", where: UNKNOWN, revision: `rev-${id}`, behaviorRevision: `brev-${id}`, ...extra,
  };
}
const guest = (id: string, start: string, minutes = 10, where: EffectiveWhere = HOME_GUESS, extra: Partial<BriefMoveDayItem> = {}) =>
  item(id, start, minutes, { alongside: true, alongsideSource: "guess", where, ...extra });

function plan(items: readonly BriefMoveDayItem[], extra: Partial<AlongsidePairingInputs> = {}) {
  return planAlongsidePairings({ localDate: DAY, timezone: TZ, now: NOW, items, calendarBusy: [], travel: null, evidence: NO_ALONGSIDE_PAIRING_EVIDENCE, ...extra });
}

/** The check a Yes runs (occurrence-move.service.ts slotInputs): the guest's blocks under the same-place rule. */
function yesCheck(items: readonly BriefMoveDayItem[], occurrenceId: string, start: Temporal.Instant, minutes: number,
  calendar: readonly BriefMoveCalendarBusy[] = [], travel: BriefMoveTravelInput | null = null) {
  const stop = travel?.stops.get(occurrenceId);
  return checkBriefMoveSlot({
    interval: { start, end: start.add({ minutes }) },
    blocks: briefMoveBlocksForSubject([
      ...briefMoveItemBlocks(items, occurrenceId),
      ...calendar.map((event) => ({ kind: "calendar" as const, ref: event.ref, start: event.start, end: event.end })),
      ...travelBlocksFor(travel, occurrenceId),
    ], briefMoveOverlapSubject(items, occurrenceId)),
    travelBeforeSeconds: stop?.beforeSeconds ?? 0, travelAfterSeconds: stop?.afterSeconds ?? 0,
  });
}

/** Three items at 7 PM make it a crowded hour (the coach's threshold). Their places are unknown, so none hosts. */
const crowdedSeven = () => [item("dinner", "19:00", 20), item("dishes", "19:25", 15), item("call", "19:45", 10)];

describe("alongside pairing: the rule", () => {
  it("re-exports from lib/resolvers and reuses the coach's crowded threshold", () => {
    expect(compatibility.planAlongsidePairings).toBe(planAlongsidePairings);
    expect(ALONGSIDE_PAIRING_CROWDED_ITEMS).toBe(COACH_SIGNAL_V2_THRESHOLDS.crowdedHour.minItemsPerDay);
    expect(ALONGSIDE_PAIRING_REASON_CODE).toBe("alongside_pairing");
  });

  it("pairs a guest in a crowded hour with the nearest compatible host, at the host's start", () => {
    const items = [...crowdedSeven(), guest("helmet", "19:10"), item("reading", "20:00", 45, { where: HOME }), item("tv", "21:30", 60, { where: HOME })];
    const [pairing, ...rest] = plan(items);
    expect(rest).toEqual([]);
    expect(pairing!.guest.occurrenceId).toBe("helmet");
    expect(pairing!.host.occurrenceId).toBe("reading");
    expect(pairing!.to.start.equals(local("20:00"))).toBe(true);
    expect(pairing!.to.end.equals(local("20:10"))).toBe(true);
    expect(pairing!.needs).toEqual(["crowded_hour"]);
    // The same data never refuses it at Yes.
    expect(yesCheck(items, "helmet", pairing!.to.start, 10).ok).toBe(true);
    expect(pairing!.otherTimes.every((start) => !start.equals(local("20:00")) && !start.equals(local("19:10")))).toBe(true);
  });

  it("proposes nothing when pairing would not help", () => {
    expect(plan([guest("helmet", "14:00"), item("reading", "20:00", 45, { where: HOME })])).toEqual([]);
  });

  it("helps when the guest runs into travel or an item somewhere else", () => {
    const items = [guest("helmet", "17:10"), item("gym", "17:00", 60, { where: ELSEWHERE }), item("reading", "20:00", 45, { where: HOME })];
    expect(plan(items).map((pairing) => [pairing.host.occurrenceId, pairing.needs])).toEqual([["reading", ["conflict"]]]);
    const travel: BriefMoveTravelInput = { spans: [{ start: local("14:00"), end: local("14:30"), refs: ["occurrence:errand"] }], stops: new Map(), unknown: new Set() };
    const byTravel = plan([guest("helmet", "14:05"), item("reading", "20:00", 45, { where: HOME })], { travel });
    expect(byTravel.map((pairing) => pairing.needs)).toEqual([["conflict"]]);
  });

  it("does not count a calendar event as a conflict for an alongside guest, and never hosts on one", () => {
    const calendar = [{ ref: "cal", start: local("14:00"), end: local("15:00"), title: "Call" }];
    expect(plan([guest("helmet", "14:05"), item("reading", "20:00", 45, { where: HOME })], { calendarBusy: calendar })).toEqual([]);
  });

  it("helps and prefers a host the done_together signal names over a nearer one", () => {
    const evidence: AlongsidePairingEvidence = { doneTogether: [{ behaviorId: "b-tv", otherBehaviorId: "b-helmet" }], crowdedHours: [] };
    const items = [guest("helmet", "14:00"), item("reading", "15:00", 45, { where: HOME }), item("tv", "21:00", 60, { where: HOME })];
    const [pairing] = plan(items, { evidence });
    expect(pairing!.host.occurrenceId).toBe("tv");
    expect(pairing!.needs).toEqual(["done_together"]);
  });

  it("uses an hour the crowded_hour signal names", () => {
    const items = [guest("helmet", "14:00"), item("reading", "15:00", 45, { where: HOME })];
    expect(plan(items, { evidence: { doneTogether: [], crowdedHours: [14] } }).map((pairing) => pairing.needs)).toEqual([["crowded_hour"]]);
    expect(plan(items, { evidence: { doneTogether: [], crowdedHours: [9] } })).toEqual([]);
  });

  it("needs both places known or guessed, and compatible", () => {
    const evidence: AlongsidePairingEvidence = { doneTogether: [{ behaviorId: "b-helmet", otherBehaviorId: "b-host" }], crowdedHours: [] };
    expect(plan([guest("helmet", "14:00"), item("host", "20:00", 45, { where: UNKNOWN })], { evidence })).toEqual([]);
    expect(plan([guest("helmet", "14:00", 10, UNKNOWN), item("host", "20:00", 45, { where: HOME })], { evidence })).toEqual([]);
    expect(plan([guest("helmet", "14:00"), item("host", "20:00", 45, { where: ELSEWHERE })], { evidence })).toEqual([]);
    // Anywhere is known and goes with anything that is not travel.
    expect(plan([guest("pill", "14:00", 1, ANYWHERE, { behaviorId: "b-helmet" }), item("host", "20:00", 45, { where: ELSEWHERE })], { evidence })).toHaveLength(1);
  });

  it("skips hosts that are shorter, alongside, past, resolved or a range", () => {
    const evidence: AlongsidePairingEvidence = { doneTogether: ["short", "along", "past", "done", "range"].map((id) => ({ behaviorId: "b-helmet", otherBehaviorId: `b-${id}` })), crowdedHours: [] };
    const items = [guest("helmet", "12:00", 20),
      item("short", "13:00", 15, { where: HOME }),
      guest("along", "14:00", 60, HOME),
      item("past", "07:00", 60, { where: HOME }),
      item("done", "15:00", 60, { where: HOME, status: "completed" }),
      item("range", "16:00", 60, { where: HOME, scheduleKind: "range" })];
    expect(plan(items, { evidence })).toEqual([]);
  });

  it("refuses a host whose start the guest's own Yes check would refuse", () => {
    // Travel to an errand sits over Reading's start: the guest may not share time with travel.
    const travel: BriefMoveTravelInput = { spans: [{ start: local("19:50"), end: local("20:05"), refs: ["occurrence:errand"] }], stops: new Map(), unknown: new Set() };
    const items = [...crowdedSeven(), guest("helmet", "19:10"), item("reading", "20:00", 45, { where: HOME }), item("tv", "21:30", 60, { where: HOME })];
    const [pairing] = plan(items, { travel });
    expect(pairing!.host.occurrenceId).toBe("tv");
    expect(yesCheck(items, "helmet", local("20:00"), 10, [], travel).ok).toBe(false);
    expect(yesCheck(items, "helmet", pairing!.to.start, 10, [], travel).ok).toBe(true);
  });

  it("gives each host at most one guest and each guest at most one host", () => {
    const evidence: AlongsidePairingEvidence = { doneTogether: [], crowdedHours: [19] };
    const items = [guest("helmet", "19:00"), guest("brace", "19:20", 10, HOME, { behaviorId: "b-brace" }), item("reading", "20:00", 45, { where: HOME })];
    const pairings = plan(items, { evidence });
    expect(pairings.map((pairing) => [pairing.guest.occurrenceId, pairing.host.occurrenceId])).toEqual([["helmet", "reading"]]);
  });

  it("leaves a guest already inside a compatible host's time", () => {
    const evidence: AlongsidePairingEvidence = { doneTogether: [{ behaviorId: "b-helmet", otherBehaviorId: "b-reading" }], crowdedHours: [] };
    expect(plan([guest("helmet", "20:10"), item("reading", "20:00", 45, { where: HOME }), item("tv", "21:30", 60, { where: HOME })], { evidence })).toEqual([]);
  });

  it("does not pair a guest answered No today or set to Don't suggest moving this", () => {
    const items = [...crowdedSeven(), guest("helmet", "19:10"), item("reading", "20:00", 45, { where: HOME })];
    expect(plan(items, { declinedToday: new Set(["helmet"]) })).toEqual([]);
    expect(plan(items, { neverMoveBehaviorIds: new Set(["b-helmet"]) })).toEqual([]);
  });

  it("treats a routine slot as one host and never pairs a step that follows its routine's time on its own", () => {
    const step = (id: string, order: number, extra: Partial<BriefMoveDayItem> = {}) => item(id, "20:00", 20, {
      where: HOME, routine: { parentBehaviorId: "b-evening", parentTitle: "Evening routine", inheritParentSchedule: true, stepOrder: order }, ...extra });
    const evidence: AlongsidePairingEvidence = { doneTogether: [], crowdedHours: [14] };
    // Two steps at 8 PM: one 40-minute host titled by the routine.
    const [pairing] = plan([guest("helmet", "14:00", 30), step("floss", 1), step("skincare", 2)], { evidence });
    expect(pairing!.host.title).toBe("Evening routine");
    expect(pairing!.host.occurrenceId).toBe("floss");
    // One lone step neither hosts nor is a guest.
    expect(plan([guest("helmet", "14:00"), step("floss", 1)], { evidence })).toEqual([]);
    expect(plan([step("pill", 1, { alongside: true, start: local("14:00"), end: local("14:01") }), item("reading", "20:00", 45, { where: HOME })], { evidence })).toEqual([]);
  });

  it("skips the help rule only when asked for one guest", () => {
    const items = [guest("helmet", "14:00"), item("reading", "20:00", 45, { where: HOME })];
    expect(plan(items)).toEqual([]);
    expect(plan(items, { onlyGuests: new Set(["helmet"]), requireNeed: false }).map((pairing) => pairing.host.occurrenceId)).toEqual(["reading"]);
    expect(plan(items, { onlyGuests: new Set(["helmet"]), requireNeed: false, excludeHosts: new Set(["reading"]) })).toEqual([]);
  });

  it("finds nothing without a Where on the items (CADENCE_ALONGSIDE off)", () => {
    const items = [...crowdedSeven(), guest("helmet", "19:10"), item("reading", "20:00", 45, { where: HOME })]
      .map((entry) => ({ ...entry, where: undefined }));
    expect(plan(items)).toEqual([]);
  });

  it("knows whether a stored pairing's host still stands", () => {
    const items = [guest("helmet", "14:00"), item("reading", "20:00", 45, { where: HOME })];
    expect(pairingHostStands(items, { hostOccurrenceId: "reading", hostStartAt: local("20:00").toString() })).toBe(true);
    expect(pairingHostStands(items, { hostOccurrenceId: "reading", hostStartAt: local("19:00").toString() })).toBe(false);
    expect(pairingHostStands([items[0]!, { ...items[1]!, status: "completed" }], { hostOccurrenceId: "reading", hostStartAt: local("20:00").toString() })).toBe(false);
  });
});

describe("alongside pairing: brief lines", () => {
  const inputs = (items: readonly BriefMoveDayItem[], extra: Partial<BriefMovePlanInputs> = {}): BriefMovePlanInputs => ({
    localDate: DAY, timezone: TZ, now: NOW, items, calendarBusy: [], calendar: "current", travel: null,
    declinedToday: new Set(), neverMoveBehaviorIds: new Set(), ...extra,
  });
  const evidence = NO_ALONGSIDE_PAIRING_EVIDENCE;

  it("writes a pairing line with its own reason code, the host as anchor and the stock sentence", () => {
    const base = inputs([...crowdedSeven(), guest("helmet", "19:10", 10, HOME_GUESS, { title: "Red light helmet" }), item("reading", "20:00", 45, { where: HOME, title: "Reading" })]);
    const moves = planBriefMoveLinesFromInputs(base).candidates;
    const [line] = planBriefPairingLines({ ...base, evidence }, moves);
    expect(line).toMatchObject({
      key: "helmet", occurrenceId: "helmet", reasonCode: "alongside_pairing", anchor: { kind: "item", title: "Reading" },
      to: { startAt: local("20:00").toString(), endAt: local("20:10").toString() }, travel: "not_needed", late: false, calendarDerived: false,
      pairing: { hostOccurrenceId: "reading", hostBehaviorId: "b-reading", hostTitle: "Reading", hostStartAt: local("20:00").toString(), needs: ["crowded_hour"] },
    });
    expect(line!.reason).toBe(stockAlongsidePairingReason("Red light helmet", "Reading", local("20:00"), TZ));
    expect(line!.reason.replace(/\s/gu, " ")).toBe("Do Red light helmet during Reading at 8:00 PM.");
  });

  it("counts toward the line cap and offers nothing on a stale calendar", () => {
    const base = inputs([...crowdedSeven(), guest("helmet", "19:10"), item("reading", "20:00", 45, { where: HOME })]);
    const full = Array.from({ length: BRIEF_MOVE_MAX_LINES }, (_, index) => ({ occurrenceId: `m${index}`, to: { startAt: local("06:00").toString(), endAt: local("06:05").toString() } }));
    expect(planBriefPairingLines({ ...base, evidence }, full as never)).toEqual([]);
    expect(planBriefPairingLines({ ...base, maxLines: 1, evidence }, [])).toHaveLength(1);
    expect(planBriefPairingLines({ ...base, calendar: "stale", evidence }, [])).toEqual([]);
  });

  it("does not host on an item a move line moves, and holds the time a move line offers", () => {
    // Reading runs into a calendar event, so its own line moves it; TV hosts instead.
    const calendarBusy = [{ ref: "cal", start: local("20:00"), end: local("20:30"), title: "Call" }];
    const base = inputs([...crowdedSeven(), guest("helmet", "19:10"), item("reading", "20:00", 45, { where: HOME }), item("tv", "21:30", 60, { where: HOME })], { calendarBusy });
    const moves = planBriefMoveLinesFromInputs(base).candidates;
    expect(moves.map((line) => line.occurrenceId)).toEqual(["reading"]);
    const pairings = planBriefPairingLines({ ...base, evidence }, moves);
    expect(pairings.map((line) => line.pairing?.hostOccurrenceId)).toEqual(["tv"]);
  });

  it("a declined guest gets no pairing line, and its offer of Don't suggest carries", () => {
    const base = inputs([...crowdedSeven(), guest("helmet", "19:10"), item("reading", "20:00", 45, { where: HOME })]);
    expect(planBriefPairingLines({ ...base, declinedToday: new Set(["helmet"]), evidence }, [])).toEqual([]);
    expect(planBriefPairingLines({ ...base, offerNeverMoveBehaviorIds: new Set(["b-helmet"]), evidence }, [])[0]!.offerNeverMove).toBe(true);
  });
});
