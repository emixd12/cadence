import { projectExternalEventSchedulingEvent } from "../packages/core/src/services/external-event-projection";
import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";

import {
  DURATION_ESTIMATE_LOOKBACK_DAYS,
  DURATION_ESTIMATE_MIN_SAMPLES,
  behaviorDurationIsTracked,
  resolveBehaviorDurationEstimate,
  resolveBehaviorDurationSources,
  selectBehaviorDuration,
  resolveExternalEventFreshness,
  resolveTimelineOccurrenceContext,
} from "../packages/core/src/resolvers/timeline-context.resolver";
import type {
  BehaviorDurationEstimate,
  BehaviorDurationHistoryOccurrence,
  NormalizedTimedExternalEvent,
} from "../packages/core/src/types/day-progress";

const NOW = Temporal.Instant.from("2026-09-16T16:00:00Z");
const CURRENT = resolveExternalEventFreshness({
  availability: "complete",
  refreshedAt: "2026-09-16T15:00:00Z",
  staleAfter: Temporal.Instant.from("2026-09-16T17:00:00Z"),
  now: NOW,
});

describe("resolveBehaviorDurationEstimate", () => {
  it("takes the median of positive stopped totals from distinct Completed occurrences across all-time history before today", () => {
    const estimate = resolveBehaviorDurationEstimate({
      behaviorId: "behavior-1",
      now: NOW,
      timezone: "America/New_York",
      occurrences: [
        history("one", "2026-09-15", [session("one", "a", 60)]),
        history("two", "2026-08-01", [session("two", "b", 20), session("two", "c", 40)]),
        history("three", "2026-01-10", [session("three", "d", 61)]),
        history("today-excluded", "2026-09-16", [session("today-excluded", "e", 1000)]),
      ],
    });

    expect(DURATION_ESTIMATE_MIN_SAMPLES).toBe(1);
    expect(DURATION_ESTIMATE_LOOKBACK_DAYS).toBe(90);
    expect(estimate).toEqual({
      kind: "known",
      seconds: 60,
      durationLabel: "1m 0s",
      sampleCount: 3,
      lookbackDays: null,
      provenance: "completed_stopped_occurrence_mean",
    });
  });

  it("supports a single completed tracked occurrence as the minimum floor and respects an explicit lookback window", () => {
    const single = resolveBehaviorDurationEstimate({
      behaviorId: "behavior-1",
      now: NOW,
      timezone: "America/New_York",
      occurrences: [
        history("one", "2026-01-10", [session("one", "a", 1800)]),
      ],
    });
    expect(single).toEqual({
      kind: "known",
      seconds: 1800,
      durationLabel: "30m 0s",
      sampleCount: 1,
      lookbackDays: null,
      provenance: "completed_stopped_occurrence_mean",
    });

    const bounded = resolveBehaviorDurationEstimate({
      behaviorId: "behavior-1",
      now: NOW,
      timezone: "America/New_York",
      lookbackDays: 90,
      occurrences: [
        history("old-excluded", "2026-06-17", [session("old-excluded", "f", 1000)]),
      ],
    });
    expect(bounded).toEqual({
      kind: "unknown",
      reason: "insufficient_samples",
      sampleCount: 0,
      requiredSampleCount: 1,
      lookbackDays: 90,
    });
  });

  it("follows intended duration > 1 or 2 tracked completions > cached description estimate > unknown below the floor of 3", () => {
    const fromDescription = resolveBehaviorDurationEstimate({
      behaviorId: "behavior-1",
      descriptionEstimateMinutes: 25,
      now: NOW,
      timezone: "America/New_York",
      occurrences: [],
    });
    expect(fromDescription).toEqual({
      kind: "known",
      seconds: 1500,
      durationLabel: "25m 0s",
      sampleCount: 0,
      lookbackDays: null,
      provenance: "description_estimate",
    });

    const trackedBeatsDescription = resolveBehaviorDurationEstimate({
      behaviorId: "behavior-1",
      descriptionEstimateMinutes: 25,
      now: NOW,
      timezone: "America/New_York",
      occurrences: [history("one", "2026-09-15", [session("one", "a", 1800)])],
    });
    expect(trackedBeatsDescription).toMatchObject({
      kind: "known",
      seconds: 1800,
      provenance: "completed_stopped_occurrence_mean",
    });

    const defaultBeatsAll = resolveBehaviorDurationEstimate({
      behaviorId: "behavior-1",
      defaultDurationMinutes: 15,
      descriptionEstimateMinutes: 25,
      now: NOW,
      timezone: "America/New_York",
      occurrences: [history("one", "2026-09-15", [session("one", "a", 1800)])],
    });
    expect(defaultBeatsAll).toMatchObject({
      kind: "known",
      seconds: 900,
      provenance: "behavior_default",
    });
    expect(behaviorDurationIsTracked(defaultBeatsAll)).toBe(false);
    expect(behaviorDurationIsTracked(trackedBeatsDescription)).toBe(false);
  });

  it("lets the tracked figure decide from 3 tracked completions and keeps the intended duration beside it (Ticket 366)", () => {
    const three = [
      history("one", "2026-09-15", [session("one", "a", 1200)]),
      history("two", "2026-09-14", [session("two", "b", 1500)]),
      history("three", "2026-09-13", [session("three", "c", 1320)]),
    ];
    const input = { behaviorId: "behavior-1", descriptionEstimateMinutes: 25, now: NOW, timezone: "America/New_York" };

    const two = resolveBehaviorDurationEstimate({ ...input, defaultDurationMinutes: 30, occurrences: three.slice(0, 2) });
    expect(two).toMatchObject({ seconds: 1800, provenance: "behavior_default" });
    expect(two).not.toHaveProperty("intendedSeconds");

    const tracked = resolveBehaviorDurationEstimate({ ...input, defaultDurationMinutes: 30, occurrences: three });
    expect(tracked).toEqual({
      kind: "known", seconds: 1320, durationLabel: "22m 0s", sampleCount: 3, lookbackDays: null,
      provenance: "completed_stopped_occurrence_mean", intendedSeconds: 1800,
    });
    expect(behaviorDurationIsTracked(tracked)).toBe(true);

    const noIntent = resolveBehaviorDurationEstimate({ ...input, occurrences: three });
    expect(noIntent).toMatchObject({ seconds: 1320, sampleCount: 3 });
    expect(noIntent).not.toHaveProperty("intendedSeconds");
    expect(behaviorDurationIsTracked(noIntent)).toBe(true);
  });

  it("uses the median of the 10 most recent tracked completions, so one long session does not move the figure", () => {
    const occurrences = [
      // The two oldest fall outside the 10 most recent.
      history("old-1", "2026-08-01", [session("old-1", "o1", 60)]),
      history("old-2", "2026-08-02", [session("old-2", "o2", 60)]),
      ...Array.from({ length: 9 }, (_, index) => history(`r-${index}`, `2026-09-0${index + 1}`, [session(`r-${index}`, `s-${index}`, 1200)])),
      history("left-running", "2026-09-10", [session("left-running", "long", 36_000)]),
    ];
    const sources = resolveBehaviorDurationSources({ behaviorId: "behavior-1", now: NOW, timezone: "America/New_York", occurrences });
    expect(sources.historicalAverage).toMatchObject({ kind: "known", seconds: 1200, sampleCount: 10 });
    expect(sources.recordedElapsedDurations).toHaveLength(12);
    expect(selectBehaviorDuration(sources)).toBe(sources.historicalAverage);
  });

  it("excludes running, non-Completed, zero, and future-stopped occurrences", () => {
    const occurrences = [
      history("running", "2026-09-13", [session("running", "c", 60), running("running", "d")]),
      history("not-completed", "2026-09-12", [session("not-completed", "e", 60)], "not_completed"),
      history("zero", "2026-09-11", [session("zero", "f", 0)]),
      history("future-stop", "2026-09-10", [{
        ...session("future-stop", "g", 60),
        startedAt: "2026-09-16T16:30:00Z",
        stoppedAt: "2026-09-16T16:31:00Z",
      }]),
    ];

    expect(resolveBehaviorDurationEstimate({
      behaviorId: "behavior-1",
      occurrences,
      now: NOW,
      timezone: "America/New_York",
    })).toEqual({
      kind: "unknown",
      reason: "insufficient_samples",
      sampleCount: 0,
      requiredSampleCount: 1,
      lookbackDays: null,
    });
  });

  it("keeps configured defaults, historical averages, and eligible raw elapsed samples distinct", () => {
    const sources = resolveBehaviorDurationSources({
      behaviorId: "behavior-1",
      defaultDurationMinutes: 15,
      now: NOW,
      timezone: "America/New_York",
      occurrences: [
        history("one", "2026-09-15", [session("one", "a", 60)]),
        history("two", "2026-09-14", [session("two", "b", 120)]),
        history("three", "2026-09-13", [session("three", "c", 180)]),
        history("unresolved", "2026-09-12", [session("unresolved", "d", 240)], "unresolved"),
      ],
    });

    expect(sources.configuredDefault).toMatchObject({ seconds: 900, provenance: "behavior_default" });
    expect(sources.historicalAverage).toMatchObject({ seconds: 120, sampleCount: 3, provenance: "completed_stopped_occurrence_mean" });
    expect(sources.recordedElapsedDurations).toEqual([
      { localDate: "2026-09-15", seconds: 60 },
      { localDate: "2026-09-14", seconds: 120 },
      { localDate: "2026-09-13", seconds: 180 },
    ]);
  });

  it("rejects duplicate occurrences, duplicate sessions, and cross-occurrence sessions", () => {
    const duplicate = history("same", "2026-09-15", [session("same", "a", 60)]);
    expect(() => resolveBehaviorDurationEstimate({
      behaviorId: "behavior-1",
      occurrences: [duplicate, duplicate],
      now: NOW,
      timezone: "UTC",
    })).toThrow("occurrence ids");

    expect(() => resolveBehaviorDurationEstimate({
      behaviorId: "behavior-1",
      occurrences: [
        history("one", "2026-09-15", [session("one", "same", 60)]),
        history("two", "2026-09-14", [session("two", "same", 60)]),
      ],
      now: NOW,
      timezone: "UTC",
    })).toThrow("session ids");

    expect(() => resolveBehaviorDurationEstimate({
      behaviorId: "behavior-1",
      occurrences: [history("one", "2026-09-15", [session("other", "x", 60)])],
      now: NOW,
      timezone: "UTC",
    })).toThrow("match their occurrence");
  });
});

describe("external freshness and Timeline context", () => {
  it("keeps unavailable, incomplete, stale, and current data distinct", () => {
    expect(CURRENT).toMatchObject({ state: "current", canAssertNoOverlap: true });
    expect(resolveExternalEventFreshness({
      availability: "complete",
      refreshedAt: "2026-09-16T14:00:00Z",
      staleAfter: NOW,
      now: NOW,
    })).toMatchObject({ state: "stale", canAssertNoOverlap: false });
    expect(resolveExternalEventFreshness({
      availability: "incomplete",
      refreshedAt: "2026-09-16T15:00:00Z",
      staleAfter: Temporal.Instant.from("2026-09-16T17:00:00Z"),
      now: NOW,
    })).toMatchObject({ state: "incomplete", canAssertNoOverlap: false });
    expect(resolveExternalEventFreshness({
      availability: "unavailable",
      refreshedAt: null,
      staleAfter: NOW,
      now: NOW,
    })).toMatchObject({ state: "unavailable", canAssertNoOverlap: false });
  });

  it("uses half-open overlap, excludes all-day events, and supports fractional means", () => {
    const estimate = knownEstimate(181 / 3);
    const context = resolveTimelineOccurrenceContext({
      occurrenceId: "occurrence-1",
      scheduledFor: "2026-09-16T16:00:00Z",
      runningStartedAt: "2026-09-16T15:59:00Z",
      estimate,
      now: NOW,
      freshness: CURRENT,
      events: [
        timedEvent("adjacent-before", "2026-09-16T15:00:00Z", "2026-09-16T16:00:00Z"),
        timedEvent("overlap", "2026-09-16T16:01:00Z", "2026-09-16T17:00:00Z"),
        timedEvent("adjacent-after", "2026-09-16T16:01:00.333Z", "2026-09-16T17:00:00Z"),
        {
          ...eventBase("all-day"),
          kind: "all_day",
          startLocalDate: "2026-09-16",
          endLocalDate: "2026-09-17",
          duration: { kind: "calendar_days", days: 1 },
        },
      ],
    });

    expect(context.estimatedEnd).toBe("2026-09-16T16:01:00.333Z");
    expect(context.overlappingEventIds).toEqual(["overlap"]);
    expect(context.overlapAssessment).toBe("possible");
    expect(context.activitySignals).toEqual([
      "scheduled_now",
      "estimated_window",
      "tracking_now",
    ]);
  });

  it("checks only the scheduled instant for unknown duration and never claims a free slot", () => {
    const unknown: BehaviorDurationEstimate = {
      kind: "unknown",
      reason: "insufficient_samples",
      sampleCount: 1,
      requiredSampleCount: 3,
      lookbackDays: 90,
    };
    const overlapping = resolveTimelineOccurrenceContext({
      occurrenceId: "occurrence-1",
      scheduledFor: "2026-09-16T16:00:00Z",
      runningStartedAt: null,
      estimate: unknown,
      now: NOW,
      freshness: CURRENT,
      events: [timedEvent("at-time", "2026-09-16T15:30:00Z", "2026-09-16T16:30:00Z")],
    });
    const empty = resolveTimelineOccurrenceContext({
      occurrenceId: "occurrence-1",
      scheduledFor: "2026-09-16T16:00:00Z",
      runningStartedAt: null,
      estimate: unknown,
      now: NOW,
      freshness: CURRENT,
      events: [],
    });

    expect(overlapping).toMatchObject({
      overlapAssessment: "possible",
      overlapLabel: "Possible overlap",
    });
    expect(empty).toMatchObject({
      overlapAssessment: "unknown",
      overlapLabel: "Duration unknown",
    });
  });

  it("qualifies overlap and empty assessments when Calendar data is stale or incomplete", () => {
    const stale = resolveExternalEventFreshness({
      availability: "complete",
      refreshedAt: "2026-09-15T12:00:00Z",
      staleAfter: Temporal.Instant.from("2026-09-16T00:00:00Z"),
      now: NOW,
    });
    const context = resolveTimelineOccurrenceContext({
      occurrenceId: "occurrence-1",
      scheduledFor: "2026-09-16T16:00:00Z",
      runningStartedAt: null,
      estimate: knownEstimate(60),
      events: [timedEvent("event", "2026-09-16T16:00:30Z", "2026-09-16T17:00:00Z")],
      freshness: stale,
      now: NOW,
    });
    const incomplete = { ...stale, state: "incomplete" as const, label: "Calendar data incomplete" };
    const empty = resolveTimelineOccurrenceContext({
      occurrenceId: "occurrence-2",
      scheduledFor: "2026-09-16T18:00:00Z",
      runningStartedAt: null,
      estimate: knownEstimate(60),
      events: [],
      freshness: incomplete,
      now: NOW,
    });

    expect(context.overlapLabel).toBe("Possible overlap · Calendar data stale");
    expect(empty).toMatchObject({
      overlapAssessment: "unknown",
      overlapLabel: "Calendar data incomplete",
    });
  });

  it("treats provider compatibility ends as unknown instead of claiming a free interval", () => {
    const unknownEnd = {
      ...timedEvent("unknown-end", "2026-09-16T15:00:00Z", "2026-09-16T16:00:00Z"),
      endUnspecified: true,
      duration: { kind: "unknown" as const, reason: "end_unspecified" as const },
    };
    const uncertain = resolveTimelineOccurrenceContext({
      occurrenceId: "occurrence-1",
      scheduledFor: "2026-09-16T16:00:00Z",
      runningStartedAt: null,
      estimate: knownEstimate(60),
      events: [unknownEnd],
      freshness: CURRENT,
      now: NOW,
    });
    const startsInside = resolveTimelineOccurrenceContext({
      occurrenceId: "occurrence-2",
      scheduledFor: "2026-09-16T14:59:30Z",
      runningStartedAt: null,
      estimate: knownEstimate(60),
      events: [unknownEnd],
      freshness: CURRENT,
      now: NOW,
    });

    expect(uncertain).toMatchObject({
      overlapAssessment: "unknown",
      overlapLabel: "Event end unknown · Calendar current",
      overlappingEventIds: [],
    });
    expect(startsInside).toMatchObject({
      overlapAssessment: "possible",
      overlappingEventIds: ["unknown-end"],
    });
  });
});

function history(
  id: string,
  localDate: string,
  sessions: BehaviorDurationHistoryOccurrence["sessions"],
  status: BehaviorDurationHistoryOccurrence["status"] = "completed",
): BehaviorDurationHistoryOccurrence {
  return { id, behaviorId: "behavior-1", localDate, status, sessions };
}

function session(occurrenceId: string, id: string, seconds: number) {
  return {
    id,
    userId: "user-1",
    occurrenceId,
    behaviorId: "behavior-1",
    startedAt: "2026-09-15T10:00:00Z",
    stoppedAt: Temporal.Instant.from("2026-09-15T10:00:00Z").add({ seconds }).toString(),
  };
}

function running(occurrenceId: string, id: string) {
  return { ...session(occurrenceId, id, 1), stoppedAt: null };
}

function knownEstimate(seconds: number): BehaviorDurationEstimate {
  return {
    kind: "known",
    seconds,
    durationLabel: "1m 0s",
    sampleCount: 3,
    lookbackDays: 90,
    provenance: "completed_stopped_occurrence_mean",
  };
}

function timedEvent(id: string, startAt: string, endAt: string): NormalizedTimedExternalEvent {
  return {
    ...eventBase(id),
    kind: "timed",
    startAt,
    endAt,
    endUnspecified: false,
    duration: {
      kind: "known",
      seconds: Temporal.Instant.from(startAt).until(Temporal.Instant.from(endAt)).total({ unit: "seconds" }),
    },
  };
}

function eventBase(id: string): Omit<NormalizedTimedExternalEvent, "kind" | "startAt" | "endAt" | "endUnspecified" | "duration"> {
  return {
    id,
    providerEventId: id,
    logicalInstanceId: `logical-${id}`,
    calendarId: "calendar-1",
    source: "google_calendar",
    calendarName: "Work",
    sourceTimezone: "UTC",
    sourceTimezoneFallback: "request",
    state: "confirmed",
    availability: "busy",
    currentUserResponse: null,
    revision: { availability: "unavailable", providerUpdatedAt: null, providerEtag: null },
    title: id,
    description: "",
    location: "",
    sourceUrl: null,
    fieldAvailability: {},
    detailCompleteness: {},
    organizer: null,
    attendees: null,
    attendeesOmitted: false,
    conference: null,
    recurrence: null,
    attachments: null,
  };
}

it("uses projected busy facts and retains Scheduled now through its display minute", () => {
  const base = timedEvent("busy", "2026-09-16T16:00:00Z", "2026-09-16T17:00:00Z");
  const events = [base, { ...base, id: "free", availability: "free" as const },
    { ...base, id: "cancelled", state: "cancelled" as const }, { ...base, id: "declined", currentUserResponse: "declined" as const }].map(projectExternalEventSchedulingEvent);
  const context = resolveTimelineOccurrenceContext({ occurrenceId: "one", scheduledFor: "2026-09-16T16:00:00Z",
    runningStartedAt: null, estimate: knownEstimate(3600), events, freshness: CURRENT, now: NOW.add({ milliseconds: 25 }) });
  expect(context.overlappingEventIds).toEqual(["busy"]);
  expect(context.activitySignals).toContain("scheduled_now");
});

it("prefers the explicit default without creating tracked-time samples", () => {
  const input = { behaviorId: "walk", occurrences: [], now: Temporal.Instant.from("2026-09-18T12:00:00Z"), timezone: "America/New_York" };
  expect(resolveBehaviorDurationEstimate({ ...input, defaultDurationMinutes: 45 })).toMatchObject({
    kind: "known", seconds: 2700, provenance: "behavior_default", sampleCount: 0,
  });
  expect(resolveBehaviorDurationEstimate({ ...input, defaultDurationMinutes: null })).toMatchObject({ kind: "unknown" });
  expect(() => resolveBehaviorDurationEstimate({ ...input, defaultDurationMinutes: 0 })).toThrow("Default duration");
});

it("treats Outlook and iCloud scheduled events exactly like Google events with distinct namespaced IDs", () => {
  const google = timedEvent("google_calendar/calendar-1/shared", "2026-09-16T16:00:00Z", "2026-09-16T16:45:00Z");
  const outlook = { ...google, id: "outlook_calendar/calendar-1/shared", source: "outlook_calendar" as const, state: "unknown" as const };
  const icloud = { ...google, id: "icloud_calendar/account-1/calendar-1/shared", source: "icloud_calendar" as const };
  const input = { occurrenceId: "one", scheduledFor: "2026-09-16T16:30:00Z", runningStartedAt: null,
    estimate: knownEstimate(600), freshness: CURRENT, now: NOW };
  const merged = resolveTimelineOccurrenceContext({ ...input, events: [google, outlook, icloud].map(projectExternalEventSchedulingEvent) });
  expect(google.duration).toEqual({ kind: "known", seconds: 2_700 });
  expect(merged.overlappingEventIds).toEqual([google.id, outlook.id, icloud.id].sort());
  expect(merged.overlapAssessment).toBe("possible");
  expect(resolveTimelineOccurrenceContext({ ...input, events: [outlook] }).overlappingEventIds).toEqual([outlook.id]);
});

// Ticket 358 (D33): an alongside item's overlap cues skip what alongsideMayOverlap allows.
describe("resolveTimelineOccurrenceContext with an alongside item", () => {
  const known: BehaviorDurationEstimate = { kind: "known", seconds: 1800, durationLabel: "30m", sampleCount: 0, lookbackDays: null, provenance: "behavior_default" };
  const base = {
    occurrenceId: "occurrence-1", scheduledFor: "2026-09-16T16:00:00Z", runningStartedAt: null,
    estimate: known, now: NOW, freshness: CURRENT,
    events: [timedEvent("meeting", "2026-09-16T16:10:00Z", "2026-09-16T17:00:00Z")],
  };

  it("keeps the Calendar overlap for an item that is not alongside", () => {
    const context = resolveTimelineOccurrenceContext({ ...base, alongside: null });
    expect(context.overlappingEventIds).toEqual(["meeting"]);
    expect(context.overlapAssessment).toBe("possible");
  });

  it("drops a Calendar overlap the rule allows, whatever the item's Where", () => {
    for (const where of [undefined, { kind: "home" as const }, { kind: "place" as const, placeKey: "k".repeat(43) }]) {
      const context = resolveTimelineOccurrenceContext({ ...base, alongside: { where } });
      expect(context.overlappingEventIds).toEqual([]);
      expect(context.overlapAssessment).toBe("none");
      expect(context.overlapLabel).not.toContain("Possible overlap");
    }
  });

  it("still cues travel, which an alongside item never overlaps", () => {
    const travel = {
      segments: [{ id: "route:leg-1", kind: "route" as const, startAt: "2026-09-16T16:05:00Z", endAt: "2026-09-16T16:20:00Z", sourceRefs: ["dentist"], legId: "leg-1" }],
      completeTrip: true,
    } as unknown as NonNullable<Parameters<typeof resolveTimelineOccurrenceContext>[0]["travel"]>;
    const context = resolveTimelineOccurrenceContext({ ...base, events: [], travel, alongside: { where: { kind: "home" } } });
    expect(context.overlapAssessment).toBe("possible");
    expect(context.travelOverlapLegIds).toEqual(["leg-1"]);
  });
});
