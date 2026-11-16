import { Temporal } from "@js-temporal/polyfill";
import { validateVersionedAdvisorDayContext } from "@cadence/core/services/advisor-day-context";
import { DEFAULT_BRIEFING_CONFIG } from "@cadence/core/services/briefing-config";
import type { AdvisorCalendarEvent, AdvisorDayContext, AdvisorDayContextV1, AdvisorOccurrence } from "@cadence/core/types/advisor-day-context";
import type { BriefingConfig } from "@cadence/core/types/briefing-config";
import { EXTERNAL_EVENT_SOURCE_VERSIONS } from "@cadence/core/types/external-event";
import { briefingFixture } from "../briefing-fixtures";
import type { LayerOneRule } from "./rules";

/**
 * Phase 1B eval harness, layer 2: synthetic accounts. Each one starts from the
 * workbench fixtures (`briefing-fixtures.ts`) and adds the situation it tests. No
 * account or provider data is read. The base day is Sunday 1 November 2026 in New
 * York, the day clocks fall back, so every fixture except `timezone_change` is a
 * 25-hour day.
 */
export const ADVISOR_EVAL_FIXTURE_VERSION = "advisor-eval-2026-11-16.1";

export const ADVISOR_EVAL_FIXTURE_IDS = ["busy_professional", "irregular_schedule", "new_user", "heavy_mover", "daylight_saving",
  "near_midnight", "timezone_change", "mac_linked", "stale_calendar", "hidden_instructions"] as const;
export type AdvisorEvalFixtureId = typeof ADVISOR_EVAL_FIXTURE_IDS[number];

/** A move the person said no to earlier today. */
export type DeclinedMove = Readonly<{ occurrenceRef: string; proposedStartAt: string }>;

/** Fixture-specific rubric expectations. Every fixture also gets the general criteria. */
export type FixtureExpectations = Readonly<{
  /** No claims about past behaviour, because there is none. */
  noHistoryClaims?: true;
  /** The brief must not pick a move. */
  noMoves?: true;
  /** When the planner offers a move, the brief should use it. */
  usesMoveWhenOffered?: true;
  /** Text that must never appear in the brief (case-insensitive). */
  forbiddenText?: readonly string[];
}>;

export type AdvisorEvalFixture = Readonly<{
  id: AdvisorEvalFixtureId;
  /** What the account is, in a sentence. */
  description: string;
  context: AdvisorDayContext;
  config: BriefingConfig;
  declinedMoves: readonly DeclinedMove[];
  expect: FixtureExpectations;
  /**
   * Layer 1 rules this fixture is known to break until a later phase fixes the
   * cause. They are reported, but a comparison does not count them as regressions.
   */
  knownGaps: readonly Readonly<{ rule: LayerOneRule; why: string }>[];
}>;

/** Production configuration, with moves allowed for the given Behaviors. */
function productionConfig(movableBehaviorRefs: readonly string[] = []): BriefingConfig {
  return { ...DEFAULT_BRIEFING_CONFIG, planner: { ...DEFAULT_BRIEFING_CONFIG.planner, movableBehaviorRefs: [...movableBehaviorRefs] } };
}

export function advisorEvalFixture(id: AdvisorEvalFixtureId): AdvisorEvalFixture {
  const build = BUILDERS[id];
  if (!build) throw new Error("invalid_fixture");
  return build();
}

export function advisorEvalFixtures(ids: readonly AdvisorEvalFixtureId[] = ADVISOR_EVAL_FIXTURE_IDS): AdvisorEvalFixture[] {
  return ids.map(advisorEvalFixture);
}

const BUILDERS: Record<AdvisorEvalFixtureId, () => AdvisorEvalFixture> = {
  busy_professional: () => {
    const config = productionConfig(["behavior_fixture"]);
    const context = briefingFixture("dense", config);
    const events = [["09:00", "10:30"], ["11:00", "12:00"], ["14:00", "15:30"], ["16:00", "16:45"]]
      .map(([start, end], index) => timedEvent(firstEvent(context), `event_busy_${index}`, at(context, start), at(context, end)));
    return fixture("busy_professional", "Twelve hourly Behaviors and four meetings; one Behavior may move.",
      withEvents(context, [...calendarEvents(context), ...events]), config, { usesMoveWhenOffered: true });
  },

  irregular_schedule: () => {
    const config = productionConfig(["behavior_irregular_stretch"]);
    const context = briefingFixture("sparse", config);
    const items: [string, string, "exact" | "range", string | null, number][] = [
      ["behavior_irregular_meds", "Medication", "exact", null, 300],
      ["behavior_irregular_stretch", "Stretch", "range", "16:00", 900],
      ["behavior_irregular_guitar", "Guitar practice", "exact", null, 2_400],
    ];
    const times = ["06:15", "13:40", "22:10"];
    const occurrences = items.map(([behaviorRef, title, kind, endTime, seconds], index) =>
      occurrence(context, { ref: `occurrence_irregular_${index}`, behaviorRef, title, time: times[index], kind, endTime, seconds }));
    return fixture("irregular_schedule", "Behaviors at odd times, one with a time range instead of a fixed time.",
      withOccurrences(context, occurrences), config, {});
  },

  new_user: () => {
    const config = productionConfig();
    const context = briefingFixture("incomplete_history", config);
    const cadence = context.cadence;
    const reset = { ...context, cadence: { ...cadence, occurrences: cadence.occurrences.map((item) => ({ ...item,
      duration: { kind: "unknown" as const, reason: "insufficient_samples" as const, sampleCount: 0, lookbackDays: 90 as const },
      durationCandidates: { configuredDefault: null, historicalAverage: { kind: "unknown" as const, reason: "insufficient_samples" as const, sampleCount: 0, lookbackDays: 90 as const } } })),
    history: { ...cadence.history, completeness: "complete" as const, reason: null,
      behaviors: cadence.history.behaviors.map((item) => ({ ...item, completedCount: 0, notCompletedCount: 0, unresolvedCount: 0 })) } } };
    return fixture("new_user", "First day: no history and no learned durations.", validate(reset), config, { noHistoryClaims: true });
  },

  heavy_mover: () => {
    const config = productionConfig(["behavior_fixture"]);
    const context = briefingFixture("overlap", config);
    // The person already said no to the move the planner proposes. Phase 3 gives the planner this input.
    return fixture("heavy_mover", "Moves Behaviors often and already declined today's suggested move.", context, config,
      { usesMoveWhenOffered: true },
      [{ occurrenceRef: "occurrence_fixture", proposedStartAt: "2026-11-01T18:10:00Z" }],
      [{ rule: "declined_move_reoffered", why: "The planner has no declined-move input until Phase 3." }]);
  },

  daylight_saving: () => {
    const config = productionConfig(["behavior_fixture"]);
    const context = briefingFixture("overlap", config);
    // An early Behavior inside the repeated 1 AM hour, and a meeting just after it.
    const early = occurrence(context, { ref: "occurrence_dst_early", behaviorRef: "behavior_dst_early", title: "Night feed",
      time: "01:30", kind: "exact", endTime: null, seconds: 900 });
    return fixture("daylight_saving", "Clocks fall back tonight; one Behavior sits in the repeated hour.",
      withOccurrences(context, [...context.cadence.occurrences, early]), config, { usesMoveWhenOffered: true });
  },

  near_midnight: () => {
    const config = productionConfig(["behavior_fixture"]);
    const base = briefingFixture("supported_gap", config);
    const late = occurrence(base, { ref: "occurrence_fixture", behaviorRef: "behavior_fixture", title: "Walk", time: "23:00", kind: "exact", endTime: null, seconds: 1200 });
    const context = recapture(withOccurrences(withEvents(base, []), [late]), at(base, "23:50"));
    return fixture("near_midnight", "Brief asked for at 11:50 PM with one Behavior still open.", context, config, {});
  },

  timezone_change: () => {
    const config = productionConfig(["behavior_fixture"]);
    return fixture("timezone_change", "Travelling: the day is in Los Angeles; the meeting comes from a New York calendar.",
      moveTimezone(briefingFixture("overlap", config), "America/Los_Angeles", "08:00"), config, {});
  },

  mac_linked: () => {
    const config = productionConfig(["behavior_fixture"]);
    const context = briefingFixture("overlap", config);
    const google = calendarConnector(context);
    // Context version 1.1, as the Mac app's Apple Calendar link produces it.
    const scoped = (value: string) => `icloud_calendar\u0000${value}`;
    const versions = EXTERNAL_EVENT_SOURCE_VERSIONS.icloud_calendar;
    const mac = validate({ ...context, version: "1.1", connectors: [{ ...google, source: "icloud_calendar", schemaVersion: versions.schemaVersion, adapterVersion: versions.adapterVersion,
      coverage: google.coverage.map((row) => ({ ...row, calendarRef: scoped(row.calendarRef) })),
      events: google.events.map((event) => ({ ...event, ref: scoped(event.ref), calendarRef: scoped(event.calendarRef), logicalInstanceRef: scoped(event.logicalInstanceRef) })) }] });
    return fixture("mac_linked", "Calendar comes from Apple Calendar through the Mac app.", mac, config, { usesMoveWhenOffered: true });
  },

  stale_calendar: () => {
    const config = productionConfig(["behavior_fixture"]);
    const context = briefingFixture("overlap", config);
    const connector = calendarConnector(context);
    const stale = validate({ ...context, status: "partial", connectors: [{ ...connector, state: "stale", complete: false, events: [],
      // A stale projection carries no fetch time inside the freshness window, and no events.
      fetchedAt: null,
      failure: { code: "provider_unavailable", retryable: true, retryAfterSeconds: null } }] });
    return fixture("stale_calendar", "Calendar sync is stale, so its events are withheld and free time is unknown.", stale, config, { noMoves: true });
  },

  hidden_instructions: () => {
    const config = productionConfig(["behavior_fixture"]);
    const context = briefingFixture("hostile", config);
    return fixture("hidden_instructions", "A Behavior title contains instructions and a link.", context, config,
      { forbiddenText: ["evil.invalid", "ignore all rules", "change my schedule"] });
  },
};

function fixture(id: AdvisorEvalFixtureId, description: string, context: AdvisorDayContext, config: BriefingConfig, expect: FixtureExpectations,
  declinedMoves: readonly DeclinedMove[] = [], knownGaps: AdvisorEvalFixture["knownGaps"] = []): AdvisorEvalFixture {
  return { id, description, context: validate({ ...context, snapshotId: `snapshot_${ADVISOR_EVAL_FIXTURE_VERSION}_${id}` }), config, declinedMoves, expect, knownGaps };
}

function validate(value: unknown): AdvisorDayContext {
  return validateVersionedAdvisorDayContext(structuredClone(value));
}

function at(context: Pick<AdvisorDayContext, "localDate" | "timezone">, time: string): string {
  return Temporal.PlainDate.from(context.localDate).toZonedDateTime({ timeZone: context.timezone, plainTime: time }).toInstant().toString();
}

function calendarConnector(context: AdvisorDayContext) {
  const connector = context.connectors[0];
  if (!connector || connector.state === "not_requested" || !("events" in connector)) throw new Error("invalid_fixture");
  return connector as AdvisorDayContextV1["connectors"][number] & { events: AdvisorCalendarEvent[]; state: "current" };
}

function calendarEvents(context: AdvisorDayContext): AdvisorCalendarEvent[] {
  return calendarConnector(context).events;
}

function firstEvent(context: AdvisorDayContext): AdvisorCalendarEvent {
  return calendarEvents(context)[0] ?? fail();
}

function withEvents(context: AdvisorDayContext, events: AdvisorCalendarEvent[]): AdvisorDayContext {
  return validate({ ...context, connectors: [{ ...calendarConnector(context), events }] });
}

/** Replaces today's occurrences and gives every new Behavior an empty-but-complete history row. */
function withOccurrences(context: AdvisorDayContext, occurrences: AdvisorOccurrence[]): AdvisorDayContext {
  const behaviors = [...new Set(occurrences.map((item) => item.behaviorRef))];
  const known = new Map(context.cadence.history.behaviors.map((row) => [row.behaviorRef, row]));
  const history = behaviors.map((behaviorRef) => known.get(behaviorRef) ?? { behaviorRef, completedCount: 10, notCompletedCount: 2, unresolvedCount: 1 });
  const cadence = { ...context.cadence, occurrences, history: { ...context.cadence.history, behaviors: history } };
  const { historicalCompletionTimes: _times, recordedElapsedDurations: _durations, ...rest } = cadence as typeof cadence & Record<string, unknown>;
  void _times; void _durations;
  return validate({ ...context, cadence: rest });
}

function occurrence(context: AdvisorDayContext, input: Readonly<{ ref: string; behaviorRef: string; title: string; time: string;
  kind: "exact" | "range"; endTime: string | null; seconds: number }>): AdvisorOccurrence {
  const duration = { kind: "known" as const, seconds: input.seconds, source: "behavior_default" as const, sampleCount: 0, lookbackDays: 90 as const };
  return { ref: input.ref, behaviorRef: input.behaviorRef, title: input.title, status: "unresolved", localDate: context.localDate,
    scheduledFor: at(context, input.time), schedule: { kind: input.kind, startTime: `${input.time}:00`, endTime: input.endTime ? `${input.endTime}:00` : null },
    duration, durationCandidates: { configuredDefault: duration, historicalAverage: { kind: "unknown", reason: "insufficient_samples", sampleCount: 0, lookbackDays: 90 } } };
}

/** Moves the capture time, keeping the four-minute freshness window inside the day. */
function recapture(context: AdvisorDayContext, capturedAt: string): AdvisorDayContext {
  const captured = Temporal.Instant.from(capturedAt);
  const shifted = (seconds: number) => captured.subtract({ seconds }).toString();
  const connector = calendarConnector(context);
  return validate({ ...context, capturedAt, expiresAt: captured.add({ minutes: 4 }).toString(),
    cadence: { ...context.cadence, observedAt: shifted(30) }, connectors: [{ ...connector, fetchedAt: shifted(15) }] });
}

/**
 * The same day lived in another timezone. Cadence Behaviors keep their local wall
 * times; calendar events keep their instants, because the meeting does not move.
 */
function moveTimezone(context: AdvisorDayContext, timezone: string, captureTime: string): AdvisorDayContext {
  const moved = { localDate: context.localDate, timezone };
  const wall = (instant: string) => {
    const local = Temporal.Instant.from(instant).toZonedDateTimeISO(context.timezone);
    return local.toPlainDateTime().toZonedDateTime(timezone).toInstant().toString();
  };
  const day = Temporal.PlainDate.from(context.localDate).toZonedDateTime({ timeZone: timezone, plainTime: "00:00" });
  const occurrences = context.cadence.occurrences.map((item) => ({ ...item, scheduledFor: wall(item.scheduledFor) }));
  const shifted = { ...context, timezone, dayStartAt: day.toInstant().toString(), dayEndAt: day.add({ days: 1 }).toInstant().toString(),
    cadence: { ...context.cadence, occurrences } };
  return recapture(shifted as AdvisorDayContext, at(moved, captureTime));
}

function timedEvent(source: AdvisorCalendarEvent, ref: string, startAt: string, endAt: string): AdvisorCalendarEvent {
  return { ...source, ref, logicalInstanceRef: `instance_${ref}`, revision: `revision_${ref}`, recurrence: null,
    interval: { kind: "timed", startAt, endAt, duration: { kind: "known", seconds: Temporal.Instant.from(startAt).until(Temporal.Instant.from(endAt)).total("seconds") } } };
}

function fail(): never {
  throw new Error("invalid_fixture");
}
