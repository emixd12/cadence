import { projectExternalEventSchedulingEvent } from "../packages/core/src/services/external-event-projection";
import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";

import {
  DURATION_ESTIMATE_LOOKBACK_DAYS,
  DURATION_ESTIMATE_MIN_SAMPLES,
  resolveBehaviorDurationEstimate,
  resolveBehaviorDurationSources,
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
  it("means positive stopped totals from distinct Completed occurrences in [today-90, today)", () => {
    const estimate = resolveBehaviorDurationEstimate({
      behaviorId: "behavior-1",
      now: NOW,
      timezone: "America/New_York",
      occurrences: [
        history("one", "2026-09-15", [session("one", "a", 60)]),
        history("two", "2026-08-01", [session("two", "b", 20), session("two", "c", 40)]),
        history("three", "2026-06-18", [session("three", "d", 61)]),
        history("today-excluded", "2026-09-16", [session("today-excluded", "e", 1000)]),
        history("old-excluded", "2026-06-17", [session("old-excluded", "f", 1000)]),
      ],
    });

    expect(DURATION_ESTIMATE_MIN_SAMPLES).toBe(3);
    expect(DURATION_ESTIMATE_LOOKBACK_DAYS).toBe(90);
    expect(estimate).toEqual({
      kind: "known",
      seconds: 181 / 3,
      durationLabel: "1m 0s",
      sampleCount: 3,
      lookbackDays: 90,
      provenance: "completed_stopped_occurrence_mean",
    });
  });

  it("excludes running, non-Completed, zero, and future-stopped occurrences", () => {
    const occurrences = [
      history("valid-one", "2026-09-15", [session("valid-one", "a", 60)]),
      history("valid-two", "2026-09-14", [session("valid-two", "b", 60)]),
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
      sampleCount: 2,
      requiredSampleCount: 3,
      lookbackDays: 90,
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
