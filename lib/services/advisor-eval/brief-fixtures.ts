import { Temporal } from "@js-temporal/polyfill";
import { validateVersionedAdvisorDayContext } from "@cadence/core/services/advisor-day-context";
import type { AdvisorDayContext, AdvisorOccurrence, AdvisorOccurrencePlanning } from "@cadence/core/types/advisor-day-context";
import { BRIEF_MOVE_DEFAULT_LATEST_START_MINUTE, BRIEF_MOVE_FALLBACK_MINUTES, type BriefMoveLength } from "@cadence/core/types/brief-moves";
import type { BriefMoveCalendarBusy, BriefMoveDayItem, BriefMovePlanInputs } from "@cadence/core/resolvers/brief-move.resolver";
import { advisorEvalFixture, type AdvisorEvalFixtureId } from "./fixtures";

/**
 * Advisor Phase 3 (3A2) eval, synthetic accounts. Each one reuses a Phase 1B day
 * (`fixtures.ts`) and adds what the Phase 3 planner reads: items answered No or
 * Undone today, Behaviors set to "Don't suggest moving this", items that happen
 * alongside others (a pill), the latest start hour, and calendar event titles (which
 * the browser sends with the request). Under Phase 3 every time-based Behavior may
 * move, so no fixture lists movable Behaviors.
 */
export const BRIEF_EVAL_FIXTURE_VERSION = "brief-eval-2026-11-25.1";

export const BRIEF_EVAL_FIXTURE_IDS = ["busy_professional", "irregular_schedule", "new_user", "heavy_mover", "daylight_saving",
  "near_midnight", "timezone_change", "mac_linked", "stale_calendar", "hidden_instructions",
  "quiet_day", "declined_and_undone", "alongside_and_never_move", "late_evening", "alongside_places"] as const;
export type BriefEvalFixtureId = typeof BRIEF_EVAL_FIXTURE_IDS[number];

export type BriefEvalExpectations = Readonly<{
  /** No line at all, so no model call. */
  noLines?: true;
  /** These occurrence ids must get a line. */
  movesOccurrences?: readonly string[];
  /** These occurrence ids must not get a line. */
  keepsOccurrences?: readonly string[];
  /** No claims about past behaviour, because there is none. */
  noHistoryClaims?: true;
  /** Text that must never appear in the brief (case-insensitive). */
  forbiddenText?: readonly string[];
}>;

export type BriefEvalFixture = Readonly<{
  id: BriefEvalFixtureId;
  description: string;
  context: AdvisorDayContext;
  /** When the brief is asked for. */
  now: string;
  plan: BriefMovePlanInputs;
  expect: BriefEvalExpectations;
}>;

type Scenario = Readonly<{
  declinedToday?: readonly string[];
  neverMoveBehaviorIds?: readonly string[];
  alongsideBehaviorIds?: readonly string[];
  latestStartMinute?: number;
  /** Titles for busy calendar events, by event ref. Unlisted events are "Meeting". */
  eventTitles?: Readonly<Record<string, string>>;
  /** Gives single occurrences their own Behavior (the base day shares one Behavior). */
  behaviorOf?: Readonly<Record<string, string>>;
  /** When the brief is asked for, as a local wall time. Defaults to just after capture. */
  at?: string;
  /** Titles for single occurrences, over the busy day's titles. */
  titles?: Readonly<Record<string, string>>;
  /**
   * Ticket 359: read as with CADENCE_ALONGSIDE on. Each Behavior's effective alongside value
   * and Where, by behaviorRef; unlisted Behaviors are not alongside and their Where is
   * unknown. Every item then carries a Where, and the day context carries `planning`.
   */
  planning?: Readonly<Record<string, AdvisorOccurrencePlanning>>;
}>;

/** Readable titles for the busy day's twelve hourly items, so graders read a real day. */
const BUSY_TITLES: Readonly<Record<string, string>> = {
  occurrence_fixture_0: "Morning run", occurrence_fixture_1: "Vitamins", occurrence_fixture_2: "Inbox zero", occurrence_fixture_3: "Spanish lesson",
  occurrence_fixture_4: "Lunch walk", occurrence_fixture_5: "Water plants", occurrence_fixture_6: "Stretch", occurrence_fixture_7: "Deep work block",
  occurrence_fixture_8: "Call Mum", occurrence_fixture_9: "Cook dinner", occurrence_fixture_10: "Read", occurrence_fixture_11: "Plan tomorrow",
};

export function briefEvalFixtures(ids: readonly BriefEvalFixtureId[] = BRIEF_EVAL_FIXTURE_IDS): BriefEvalFixture[] {
  return ids.map(briefEvalFixture);
}

export function briefEvalFixture(id: BriefEvalFixtureId): BriefEvalFixture {
  switch (id) {
    case "busy_professional":
      return build(id, "busy_professional", "Twelve hourly Behaviors and four meetings.", { eventTitles: BUSY_EVENTS }, {});
    case "irregular_schedule":
      return build(id, "irregular_schedule", "Behaviors at odd times, one with a time range.", {}, {});
    case "new_user":
      // Phase 1B expected no move because no Behavior was movable. Under Phase 3 every
      // time-based Behavior may move, so the Walk inside the busy event gets a line.
      return build(id, "new_user", "First day: no history and no learned lengths.", {}, { noHistoryClaims: true });
    case "heavy_mover":
      return build(id, "heavy_mover", "Moves Behaviors often; already said No to moving the Walk today.",
        { declinedToday: ["occurrence_fixture"] }, { keepsOccurrences: ["occurrence_fixture"] });
    case "daylight_saving":
      return build(id, "daylight_saving", "Clocks fall back tonight; one Behavior sits in the repeated hour.", {}, {});
    case "near_midnight":
      return build(id, "near_midnight", "Brief asked for at 11:50 PM with one Behavior still open.", {}, { noLines: true });
    case "timezone_change":
      return build(id, "timezone_change", "Travelling: the day is in Los Angeles; the meeting is on a New York calendar.", {}, {});
    case "mac_linked":
      return build(id, "mac_linked", "Calendar comes from Apple Calendar through the Mac app.", {}, {});
    case "stale_calendar":
      return build(id, "stale_calendar", "Calendar sync is stale, so no time that depends on it is offered.", {}, { noLines: true });
    case "hidden_instructions":
      return build(id, "hidden_instructions", "A Behavior title contains instructions and a link.", {},
        { forbiddenText: ["evil.invalid", "ignore all rules", "change my schedule"] });
    case "quiet_day":
      return quietDay();
    case "declined_and_undone":
      return build(id, "busy_professional", "Said No to one move and undid another earlier today.",
        { declinedToday: ["occurrence_fixture_1", "occurrence_fixture_3"], eventTitles: BUSY_EVENTS },
        { keepsOccurrences: ["occurrence_fixture_1", "occurrence_fixture_3"] });
    case "alongside_and_never_move":
      return build(id, "busy_professional", "Takes vitamins alongside a meeting; turned off moves for the Spanish lesson.",
        { behaviorOf: { occurrence_fixture_1: "behavior_vitamins", occurrence_fixture_3: "behavior_spanish" },
          alongsideBehaviorIds: ["behavior_vitamins"], neverMoveBehaviorIds: ["behavior_spanish"], eventTitles: BUSY_EVENTS },
        { keepsOccurrences: ["occurrence_fixture_1", "occurrence_fixture_3"] });
    case "late_evening":
      // Latest start 5 PM: afternoon clashes may not be pushed into the evening.
      return build(id, "busy_professional", "Wants nothing suggested after 5 PM.", { latestStartMinute: 17 * 60, eventTitles: BUSY_EVENTS }, {});
    case "alongside_places":
      // Ticket 359 (D33), flag on: the pill (the person's yes, Anywhere) stays inside Team
      // sync; the red-light helmet (a guess: alongside, at Home) stays at 1 PM; the gym
      // session (a guess: elsewhere) leaves lunch. The Spanish class (counted elsewhere)
      // leaves its 1:1 but may not land on the helmet, which is at a different place; under
      // the earlier rule it would have moved to 1:10 PM, during the helmet.
      return build(id, "busy_professional", "Vitamin D during a meeting, a red-light helmet at Home, a gym session and a Spanish class elsewhere.", {
        behaviorOf: { occurrence_fixture_1: "behavior_pill", occurrence_fixture_3: "behavior_spanish_class", occurrence_fixture_4: "behavior_gym",
          occurrence_fixture_5: "behavior_helmet" },
        titles: { occurrence_fixture_1: "Vitamin D", occurrence_fixture_3: "Spanish class", occurrence_fixture_4: "Gym session", occurrence_fixture_5: "Red light helmet" },
        planning: {
          behavior_pill: { alongside: true, alongsideSource: "person", where: { kind: "anywhere", source: "person" } },
          behavior_helmet: { alongside: true, alongsideSource: "guess", where: { kind: "home", source: "guess" } },
          behavior_gym: { alongside: false, alongsideSource: "guess", where: { kind: "elsewhere", source: "guess" } },
          behavior_spanish_class: { alongside: false, alongsideSource: "person", where: { kind: "elsewhere", source: "evidence" } },
        },
        eventTitles: BUSY_EVENTS,
      }, { keepsOccurrences: ["occurrence_fixture_1", "occurrence_fixture_5"], movesOccurrences: ["occurrence_fixture_3", "occurrence_fixture_4"] });
  }
}

const BUSY_EVENTS: Readonly<Record<string, string>> = { event_busy_0: "Team sync", event_busy_1: "1:1 with Sam", event_fixture: "Lunch with Alex",
  event_busy_2: "Client review", event_busy_3: "School pickup" };

function build(id: BriefEvalFixtureId, base: AdvisorEvalFixtureId, description: string, scenario: Scenario, expect: BriefEvalExpectations): BriefEvalFixture {
  const source = advisorEvalFixture(base).context;
  const titled = base === "busy_professional" ? withTitles(source, { ...BUSY_TITLES, ...scenario.titles }, scenario.behaviorOf ?? {}) : source;
  const context = scenario.planning ? withPlanning(titled, scenario.planning) : titled;
  const now = scenario.at
    ? Temporal.PlainDate.from(context.localDate).toZonedDateTime({ timeZone: context.timezone, plainTime: scenario.at }).toInstant().toString()
    : Temporal.Instant.from(context.capturedAt).add({ seconds: 1 }).toString();
  return { id, description, context, now, plan: planInputs(context, now, scenario), expect };
}

function withTitles(context: AdvisorDayContext, titles: Readonly<Record<string, string>>, behaviorOf: Readonly<Record<string, string>>): AdvisorDayContext {
  const occurrences = context.cadence.occurrences.map((item) => ({ ...item, title: titles[item.ref] ?? item.title, behaviorRef: behaviorOf[item.ref] ?? item.behaviorRef }));
  // A Behavior split off for one item gets a history row of its own, as the context requires.
  const rows = context.cadence.history.behaviors;
  const added = Object.entries(behaviorOf).flatMap(([ref, behaviorRef]) => {
    const source = rows.find((row) => row.behaviorRef === context.cadence.occurrences.find((item) => item.ref === ref)?.behaviorRef);
    return source && !rows.some((row) => row.behaviorRef === behaviorRef) ? [{ ...source, behaviorRef }] : [];
  });
  return validateVersionedAdvisorDayContext(structuredClone({ ...context,
    cadence: { ...context.cadence, occurrences, history: { ...context.cadence.history, behaviors: [...rows, ...added] } } }));
}

/** Ticket 359: the day context's planning field, as the flag-on day context reader adds it. */
function withPlanning(context: AdvisorDayContext, planning: Readonly<Record<string, AdvisorOccurrencePlanning>>): AdvisorDayContext {
  const occurrences = context.cadence.occurrences.map((item) => ({ ...item, planning: planning[item.behaviorRef] ?? NO_PLANNING }));
  return validateVersionedAdvisorDayContext(structuredClone({ ...context, cadence: { ...context.cadence, occurrences } }));
}

const NO_PLANNING: AdvisorOccurrencePlanning = { alongside: false, alongsideSource: "default", where: { kind: "unknown", source: "none" } };

/** A day where nothing clashes: three Behaviors spread out, no calendar events in the way. */
function quietDay(): BriefEvalFixture {
  const base = advisorEvalFixture("irregular_schedule").context;
  const connectors = base.connectors.map((connector) => "events" in connector ? { ...connector, events: [] } : connector);
  const context = { ...base, connectors } as AdvisorDayContext;
  // Asked for at 6 AM, before the first item, so nothing has passed either.
  const now = Temporal.PlainDate.from(context.localDate).toZonedDateTime({ timeZone: context.timezone, plainTime: "06:00" }).toInstant().toString();
  return { id: "quiet_day", description: "Nothing clashes today.", context, now, plan: planInputs(context, now, {}), expect: { noLines: true } };
}

/** What the Phase 3 planner reads, built from a day context the way 3A1's day reader does. */
export function planInputs(context: AdvisorDayContext, now: string, scenario: Scenario): BriefMovePlanInputs {
  const alongside = new Set([...(scenario.alongsideBehaviorIds ?? []),
    ...Object.entries(scenario.planning ?? {}).filter(([, item]) => item.alongside).map(([ref]) => ref)]);
  // Every expected title must exist, so a renamed base fixture fails loudly.
  for (const ref of [...(scenario.declinedToday ?? []), ...Object.keys(scenario.behaviorOf ?? {})]) {
    if (!context.cadence.occurrences.some((item) => item.ref === ref)) throw new Error(`unknown occurrence ${ref}`);
  }
  const items = context.cadence.occurrences.map((item) => {
    const day = dayItem(context, item, alongside.has(item.behaviorRef));
    if (!scenario.planning) return day;
    const facts = scenario.planning[item.behaviorRef] ?? NO_PLANNING;
    return { ...day, alongsideSource: facts.alongsideSource, where: facts.where };
  });
  const calendar = calendarState(context);
  const calendarBusy: BriefMoveCalendarBusy[] = context.connectors.flatMap((connector) => "events" in connector ? connector.events : [])
    .flatMap((event) => event.interval.kind === "timed" && event.availability === "busy" && event.state !== "cancelled"
      ? [{ ref: event.ref, title: scenario.eventTitles?.[event.ref] ?? "Meeting",
        start: Temporal.Instant.from(event.interval.startAt), end: Temporal.Instant.from(event.interval.endAt) }] : []);
  return {
    localDate: context.localDate, timezone: context.timezone, now: Temporal.Instant.from(now), items, calendarBusy, calendar, travel: null,
    declinedToday: new Set(scenario.declinedToday ?? []), neverMoveBehaviorIds: new Set(scenario.neverMoveBehaviorIds ?? []),
    latestStartMinute: scenario.latestStartMinute ?? BRIEF_MOVE_DEFAULT_LATEST_START_MINUTE,
  };
}

function dayItem(context: AdvisorDayContext, item: AdvisorOccurrence, alongside: boolean): BriefMoveDayItem {
  const length: BriefMoveLength = item.duration.kind === "known"
    ? { minutes: Math.max(1, Math.round(item.duration.seconds / 60)), source: "behavior_duration", assumed: false }
    : { minutes: BRIEF_MOVE_FALLBACK_MINUTES, source: "fallback", assumed: true };
  const start = Temporal.Instant.from(item.scheduledFor);
  const rangeEnd = item.schedule.kind === "range" && item.schedule.endTime
    ? Temporal.PlainDate.from(context.localDate).toZonedDateTime({ timeZone: context.timezone, plainTime: item.schedule.endTime }).toInstant() : null;
  return {
    occurrenceId: item.ref, behaviorId: item.behaviorRef, title: item.title, status: item.status, localDate: item.localDate,
    scheduleKind: item.schedule.kind, start, end: rangeEnd ?? start.add({ minutes: length.minutes }), length, alongside,
    revision: `revision_${item.ref}`, behaviorRevision: `revision_${item.behaviorRef}`,
  };
}

function calendarState(context: AdvisorDayContext): "current" | "stale" | "none" {
  const calendars = context.connectors.filter((connector) => "events" in connector);
  if (!calendars.length) return "none";
  return calendars.some((connector) => "state" in connector && connector.state !== "current") ? "stale" : "current";
}
