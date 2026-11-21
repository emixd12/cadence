import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";

import {
  ANALYTICS_DEFAULT_RANGE_DAYS,
  normalizeAnalyticsRangeDays,
  resolveAnalytics,
  resolveAnalyticsDateRange,
} from "../lib/resolvers/analytics.resolver";
import { planOccurrenceGeneration } from "../lib/resolvers/occurrence.resolver";
import type { AnalyticsOccurrenceInput } from "../lib/types/analytics";
import { DEFAULT_TIMEZONE } from "../lib/types/recurrence";
import type { TimeSession } from "../lib/types/time-tracking";

const NOW = Temporal.Instant.from("2026-06-08T16:00:00Z");

function occurrence(
  overrides: Partial<AnalyticsOccurrenceInput> &
    Pick<AnalyticsOccurrenceInput, "id">,
): AnalyticsOccurrenceInput {
  return {
    behaviorId: "behavior-a",
    behaviorTitle: "Brush teeth",
    behaviorActive: true,
    behaviorCreatedAt: "2026-06-01T13:00:00Z",
    categoryName: "Grooming",
    scheduledFor: "2026-06-08T13:00:00Z",
    scheduledTimeLabel: "9:00 AM",
    localDate: "2026-06-08",
    status: "completed",
    note: "",
    timezone: DEFAULT_TIMEZONE,
    ...overrides,
  };
}

describe("resolveAnalyticsDateRange", () => {
  it("defaults to the last 30 local days ending today", () => {
    expect(
      resolveAnalyticsDateRange({
        now: NOW,
        timezone: DEFAULT_TIMEZONE,
      }),
    ).toEqual({
      timezone: DEFAULT_TIMEZONE,
      rangeDays: ANALYTICS_DEFAULT_RANGE_DAYS,
      startLocalDate: "2026-05-10",
      endLocalDate: "2026-06-08",
    });
  });

  it("accepts only the documented range options", () => {
    expect(normalizeAnalyticsRangeDays(7)).toBe(7);
    expect(normalizeAnalyticsRangeDays(30)).toBe(30);
    expect(normalizeAnalyticsRangeDays(90)).toBe(90);
    expect(normalizeAnalyticsRangeDays(14)).toBe(30);
    expect(normalizeAnalyticsRangeDays(Number.NaN)).toBe(30);
  });
});

describe("resolveAnalytics", () => {
  it("averages stopped timing totals once per occurrence and exposes selected-day timing", () => {
    const analytics = resolveAnalytics({
      now: NOW,
      timezone: DEFAULT_TIMEZONE,
      rangeDays: 7,
      selectedBehaviorId: "brush",
      selectedDayLocalDate: "2026-06-08",
      occurrences: [
        occurrence({
          id: "brush-timed-one",
          behaviorId: "brush",
          localDate: "2026-06-08",
          scheduledFor: "2026-06-08T13:00:00Z",
        }),
        occurrence({
          id: "brush-timed-two",
          behaviorId: "brush",
          localDate: "2026-06-07",
          scheduledFor: "2026-06-07T13:00:00Z",
        }),
        occurrence({
          id: "brush-running-only",
          behaviorId: "brush",
          localDate: "2026-06-06",
          scheduledFor: "2026-06-06T13:00:00Z",
        }),
        occurrence({
          id: "brush-outside-range",
          behaviorId: "brush",
          localDate: "2026-06-01",
          scheduledFor: "2026-06-01T13:00:00Z",
        }),
      ],
      timeSessions: [
        timeSession({
          id: "one-a",
          occurrenceId: "brush-timed-one",
          startedAt: "2026-06-08T13:00:00Z",
          stoppedAt: "2026-06-08T13:01:00Z",
        }),
        timeSession({
          id: "one-b",
          occurrenceId: "brush-timed-one",
          startedAt: "2026-06-08T13:02:00Z",
          stoppedAt: "2026-06-08T13:04:00Z",
        }),
        timeSession({
          id: "one-running",
          occurrenceId: "brush-timed-one",
          startedAt: "2026-06-08T13:05:00Z",
          stoppedAt: null,
        }),
        timeSession({
          id: "two-a",
          occurrenceId: "brush-timed-two",
          startedAt: "2026-06-07T13:00:00Z",
          stoppedAt: "2026-06-07T13:02:00Z",
        }),
        timeSession({
          id: "running-only",
          occurrenceId: "brush-running-only",
          startedAt: "2026-06-06T13:00:00Z",
          stoppedAt: null,
        }),
        timeSession({
          id: "outside-range",
          occurrenceId: "brush-outside-range",
          startedAt: "2026-06-01T13:00:00Z",
          stoppedAt: "2026-06-01T14:00:00Z",
        }),
      ],
    });

    expect(
      analytics.behaviorSummaries.find((summary) => summary.behaviorId === "brush")
        ?.averageTrackedTime,
    ).toEqual({
      averageSeconds: 150,
      durationLabel: "2m 30s",
      timedOccurrenceCount: 2,
    });
    expect(analytics.selectedBehaviorDay?.occurrences).toMatchObject([
      {
        id: "brush-timed-one",
        trackedTime: {
          recordedSeconds: 180,
          durationLabel: "3m 0s",
          hasRecordedTime: true,
          isInProgress: true,
        },
      },
    ]);
  });

  it("keeps timing empty when sessions are reset or only running, and rounds display durations deterministically", () => {
    const analytics = resolveAnalytics({
      now: NOW,
      timezone: DEFAULT_TIMEZONE,
      rangeDays: 7,
      selectedBehaviorId: "brush",
      selectedDayLocalDate: "2026-06-08",
      occurrences: [
        occurrence({ id: "reset-empty", behaviorId: "brush" }),
        occurrence({
          id: "running-only",
          behaviorId: "brush",
          localDate: "2026-06-07",
          scheduledFor: "2026-06-07T13:00:00Z",
        }),
        occurrence({
          id: "one-second",
          behaviorId: "brush",
          localDate: "2026-06-06",
          scheduledFor: "2026-06-06T13:00:00Z",
        }),
        occurrence({
          id: "two-seconds",
          behaviorId: "brush",
          localDate: "2026-06-05",
          scheduledFor: "2026-06-05T13:00:00Z",
        }),
      ],
      timeSessions: [
        timeSession({
          occurrenceId: "running-only",
          stoppedAt: null,
        }),
        timeSession({
          id: "one-second-session",
          occurrenceId: "one-second",
          startedAt: "2026-06-06T13:00:00Z",
          stoppedAt: "2026-06-06T13:00:01Z",
        }),
        timeSession({
          id: "two-seconds-session",
          occurrenceId: "two-seconds",
          startedAt: "2026-06-05T13:00:00Z",
          stoppedAt: "2026-06-05T13:00:02Z",
        }),
      ],
    });

    expect(
      analytics.behaviorSummaries.find((summary) => summary.behaviorId === "brush")
        ?.averageTrackedTime,
    ).toEqual({
      averageSeconds: 1.5,
      durationLabel: "2s",
      timedOccurrenceCount: 2,
    });
    expect(analytics.selectedBehaviorDay?.occurrences[0]?.trackedTime).toBeNull();
  });

  it("matches the Timeline Needs decision count in the summary unresolved count", () => {
    const analytics = resolveAnalytics({
      now: NOW,
      timezone: DEFAULT_TIMEZONE,
      rangeDays: 30,
      occurrences: [
        occurrence({ id: "completed-1", status: "completed" }),
        occurrence({
          id: "completed-2",
          status: "completed",
          scheduledFor: "2026-06-08T14:00:00Z",
        }),
        occurrence({
          id: "not-completed-1",
          status: "not_completed",
          scheduledFor: "2026-06-08T15:00:00Z",
        }),
        occurrence({
          id: "current-unresolved",
          status: "unresolved",
          scheduledFor: "2026-06-08T16:00:00Z",
        }),
      ],
      needsDecisionOccurrences: [
        occurrence({
          id: "prior-unresolved",
          status: "unresolved",
          scheduledFor: "2026-05-31T16:00:00Z",
          localDate: "2026-05-31",
        }),
        occurrence({
          id: "archived-prior-unresolved",
          behaviorActive: false,
          status: "unresolved",
          scheduledFor: "2026-05-31T17:00:00Z",
          localDate: "2026-05-31",
        }),
      ],
    });

    expect(analytics.summary).toMatchObject({
      completedCount: 2,
      notCompletedCount: 1,
      unresolvedCount: 1,
      resolvedCount: 3,
      totalCount: 4,
      percentLabel: "66.7%",
      detailLabel: "2 of 3 resolved Completed",
    });
  });

  it("returns behavior and category completion counts", () => {
    const analytics = resolveAnalytics({
      now: NOW,
      timezone: DEFAULT_TIMEZONE,
      rangeDays: 7,
      occurrences: [
        occurrence({
          id: "brush-completed",
          behaviorId: "brush",
          behaviorTitle: "Brush teeth",
          categoryName: "Grooming",
          status: "completed",
        }),
        occurrence({
          id: "brush-not-completed",
          behaviorId: "brush",
          behaviorTitle: "Brush teeth",
          categoryName: "Grooming",
          status: "not_completed",
          scheduledFor: "2026-06-07T13:00:00Z",
          localDate: "2026-06-07",
        }),
        occurrence({
          id: "water-unresolved",
          behaviorId: "water",
          behaviorTitle: "Drink water",
          categoryName: "Food / Drink",
          status: "unresolved",
        }),
      ],
    });

    expect(analytics.behaviorSummaries).toMatchObject([
      {
        behaviorId: "brush",
        title: "Brush teeth",
        categoryName: "Grooming",
        completedCount: 1,
        notCompletedCount: 1,
        unresolvedCount: 0,
        percentLabel: "50%",
      },
      {
        behaviorId: "water",
        title: "Drink water",
        categoryName: "Food / Drink",
        completedCount: 0,
        notCompletedCount: 0,
        unresolvedCount: 1,
        percentLabel: "No resolved occurrences",
      },
    ]);
    expect(analytics.categorySummaries).toMatchObject([
      {
        categoryName: "Food / Drink",
        unresolvedCount: 1,
      },
      {
        categoryName: "Grooming",
        completedCount: 1,
        notCompletedCount: 1,
      },
    ]);
  });

  it("counts deduped overlapping generated occurrences once", () => {
    const overlapNow = Temporal.Instant.from("2026-06-09T16:00:00Z");
    const plan = planOccurrenceGeneration({
      behavior: {
        id: "behavior-overlap",
        userId: "user-1",
        configurationEventId: "configuration-event-overlap",
        recurrenceRule: { frequency: "daily", interval: 1 },
        scheduleSlots: [],
        schedules: [
          {
            id: "schedule-daily",
            recurrenceRule: { frequency: "daily", interval: 1 },
            sortOrder: 0,
            timeEntries: [
              {
                id: "slot-daily",
                scheduleId: "schedule-daily",
                kind: "exact",
                preset: null,
                startTime: "23:00",
                endTime: null,
                sortOrder: 0,
              },
            ],
          },
          {
            id: "schedule-every-two-days",
            recurrenceRule: { frequency: "interval_days", intervalDays: 2 },
            sortOrder: 1,
            timeEntries: [
              {
                id: "slot-every-two-days",
                scheduleId: "schedule-every-two-days",
                kind: "exact",
                preset: null,
                startTime: "23:00",
                endTime: null,
                sortOrder: 0,
              },
            ],
          },
        ],
        timezone: DEFAULT_TIMEZONE,
        active: true,
        createdAt: "2026-06-07T13:00:00Z",
      },
      existingOccurrences: [],
      now: overlapNow,
      horizonDays: 0,
    });
    const analytics = resolveAnalytics({
      now: overlapNow,
      timezone: DEFAULT_TIMEZONE,
      rangeDays: 7,
      occurrences: plan.create.map((generated, index) =>
        occurrence({
          id: `generated-${index}`,
          behaviorId: "behavior-overlap",
          behaviorTitle: "Overlap",
          scheduledFor: generated.scheduledFor,
          scheduledTimeLabel: "11:00 PM",
          localDate: generated.localDate,
          status: "completed",
        }),
      ),
    });

    expect(plan.create).toHaveLength(1);
    expect(analytics.summary).toMatchObject({
      completedCount: 1,
      resolvedCount: 1,
      totalCount: 1,
    });
  });

  it("adds behavior tracking start metadata and marks the start day in the behavior calendar", () => {
    const analytics = resolveAnalytics({
      now: NOW,
      timezone: DEFAULT_TIMEZONE,
      rangeDays: 7,
      occurrences: [
        occurrence({
          id: "start-day",
          behaviorId: "journal",
          behaviorTitle: "Journal",
          behaviorCreatedAt: "2026-06-05T13:00:00Z",
          localDate: "2026-06-05",
          scheduledFor: "2026-06-05T13:00:00Z",
          status: "completed",
        }),
        occurrence({
          id: "later-day",
          behaviorId: "journal",
          behaviorTitle: "Journal",
          behaviorCreatedAt: "2026-06-05T13:00:00Z",
          localDate: "2026-06-06",
          scheduledFor: "2026-06-06T13:00:00Z",
          status: "not_completed",
        }),
      ],
    });

    const behavior = analytics.behaviorSummaries[0];

    expect(behavior).toMatchObject({
      behaviorId: "journal",
      trackingStartLocalDate: "2026-06-05",
      trackingStartLabel: "Friday, June 5",
    });
    expect(
      behavior?.dailyCells.map((cell) => ({
        localDate: cell.localDate,
        isTrackingStart: cell.isTrackingStart,
        ariaLabel: cell.ariaLabel,
      })),
    ).toContainEqual({
      localDate: "2026-06-05",
      isTrackingStart: true,
      ariaLabel:
        "Friday, June 5: Full; 1 Completed, 0 Not Completed, 0 Unresolved; tracking started",
    });
  });

  it("builds a passive overall heatmap with completion intensity", () => {
    const analytics = resolveAnalytics({
      now: NOW,
      timezone: DEFAULT_TIMEZONE,
      rangeDays: 7,
      occurrences: [
        occurrence({
          id: "completed-day",
          localDate: "2026-06-06",
          scheduledFor: "2026-06-06T13:00:00Z",
          status: "completed",
        }),
        occurrence({
          id: "partial-completed-day",
          localDate: "2026-06-07",
          scheduledFor: "2026-06-07T12:00:00Z",
          status: "completed",
        }),
        occurrence({
          id: "partial-not-completed-day",
          localDate: "2026-06-07",
          scheduledFor: "2026-06-07T13:00:00Z",
          status: "not_completed",
        }),
        occurrence({
          id: "unresolved-day",
          localDate: "2026-06-08",
          status: "unresolved",
        }),
      ],
    });

    expect(
      analytics.overallHeatmap.map((cell) => ({
        localDate: cell.localDate,
        state: cell.state,
        stateLabel: cell.stateLabel,
        completionRate: cell.completionRate,
        isSelected: cell.isSelected,
      })),
    ).toEqual([
      {
        localDate: "2026-06-02",
        state: "empty",
        stateLabel: "No occurrences",
        completionRate: null,
        isSelected: false,
      },
      {
        localDate: "2026-06-03",
        state: "empty",
        stateLabel: "No occurrences",
        completionRate: null,
        isSelected: false,
      },
      {
        localDate: "2026-06-04",
        state: "empty",
        stateLabel: "No occurrences",
        completionRate: null,
        isSelected: false,
      },
      {
        localDate: "2026-06-05",
        state: "empty",
        stateLabel: "No occurrences",
        completionRate: null,
        isSelected: false,
      },
      {
        localDate: "2026-06-06",
        state: "completed",
        stateLabel: "Completed",
        completionRate: 1,
        isSelected: false,
      },
      {
        localDate: "2026-06-07",
        state: "partial",
        stateLabel: "50% Completed",
        completionRate: 0.5,
        isSelected: false,
      },
      {
        localDate: "2026-06-08",
        state: "unresolved",
        stateLabel: "Unresolved",
        completionRate: null,
        isSelected: false,
      },
    ]);
  });

  it("represents full, partial, not completed, and unresolved behavior day states", () => {
    const analytics = resolveAnalytics({
      now: NOW,
      timezone: DEFAULT_TIMEZONE,
      rangeDays: 7,
      occurrences: [
        occurrence({
          id: "full-1",
          localDate: "2026-06-05",
          scheduledFor: "2026-06-05T13:00:00Z",
          status: "completed",
        }),
        occurrence({
          id: "full-2",
          localDate: "2026-06-05",
          scheduledFor: "2026-06-05T22:00:00Z",
          status: "completed",
        }),
        occurrence({
          id: "partial-1",
          localDate: "2026-06-06",
          scheduledFor: "2026-06-06T13:00:00Z",
          status: "completed",
        }),
        occurrence({
          id: "partial-2",
          localDate: "2026-06-06",
          scheduledFor: "2026-06-06T22:00:00Z",
          status: "not_completed",
        }),
        occurrence({
          id: "not-completed",
          localDate: "2026-06-07",
          scheduledFor: "2026-06-07T13:00:00Z",
          status: "not_completed",
        }),
        occurrence({
          id: "unresolved",
          localDate: "2026-06-08",
          status: "unresolved",
        }),
      ],
    });

    const behavior = analytics.behaviorSummaries[0];

    expect(
      behavior?.dailyCells
        .filter((cell) => cell.state !== "empty")
        .map((cell) => ({
          localDate: cell.localDate,
          state: cell.state,
          completedCount: cell.counts.completedCount,
          notCompletedCount: cell.counts.notCompletedCount,
          unresolvedCount: cell.counts.unresolvedCount,
        })),
    ).toEqual([
      {
        localDate: "2026-06-05",
        state: "full",
        completedCount: 2,
        notCompletedCount: 0,
        unresolvedCount: 0,
      },
      {
        localDate: "2026-06-06",
        state: "partial",
        completedCount: 1,
        notCompletedCount: 1,
        unresolvedCount: 0,
      },
      {
        localDate: "2026-06-07",
        state: "not_completed",
        completedCount: 0,
        notCompletedCount: 1,
        unresolvedCount: 0,
      },
      {
        localDate: "2026-06-08",
        state: "unresolved",
        completedCount: 0,
        notCompletedCount: 0,
        unresolvedCount: 1,
      },
    ]);
  });

  it("returns the selected behavior day occurrences for review", () => {
    const analytics = resolveAnalytics({
      now: NOW,
      timezone: DEFAULT_TIMEZONE,
      rangeDays: 7,
      selectedBehaviorId: "brush",
      selectedDayLocalDate: "2026-06-07",
      occurrences: [
        occurrence({
          id: "selected-later",
          behaviorId: "workout",
          behaviorTitle: "Workout",
          categoryName: "Fitness",
          localDate: "2026-06-07",
          scheduledFor: "2026-06-07T22:30:00Z",
          scheduledTimeLabel: "6:30 PM",
          status: "not_completed",
          note: "Skipped after travel.",
        }),
        occurrence({
          id: "selected-earlier",
          behaviorId: "brush",
          behaviorTitle: "Brush teeth",
          categoryName: "Grooming",
          localDate: "2026-06-07",
          scheduledFor: "2026-06-07T13:00:00Z",
          status: "not_completed",
        }),
        occurrence({
          id: "selected-brush-evening",
          behaviorId: "brush",
          behaviorTitle: "Brush teeth",
          categoryName: "Grooming",
          localDate: "2026-06-07",
          scheduledFor: "2026-06-07T23:00:00Z",
          scheduledTimeLabel: "7:00 PM",
          status: "completed",
          note: "Before bed.",
        }),
        occurrence({
          id: "selected-completed",
          behaviorId: "journal",
          behaviorTitle: "Journal",
          categoryName: "Reflection",
          localDate: "2026-06-07",
          scheduledFor: "2026-06-07T14:00:00Z",
          scheduledTimeLabel: "10:00 AM",
          status: "completed",
          note: "Done before breakfast.",
        }),
        occurrence({
          id: "selected-unresolved",
          behaviorId: "water",
          behaviorTitle: "Drink water",
          categoryName: "Health",
          localDate: "2026-06-07",
          scheduledFor: "2026-06-07T15:00:00Z",
          scheduledTimeLabel: "11:00 AM",
          status: "unresolved",
        }),
      ],
    });

    expect(analytics.selectedBehaviorDay).toMatchObject({
      behaviorId: "brush",
      behaviorTitle: "Brush teeth",
      localDate: "2026-06-07",
      label: "Sunday, June 7",
      occurrences: [
        {
          id: "selected-earlier",
          title: "Brush teeth",
          categoryName: "Grooming",
          scheduledTimeLabel: "9:00 AM",
          status: "not_completed",
          statusLabel: "Not Completed",
          note: "",
        },
        {
          id: "selected-brush-evening",
          title: "Brush teeth",
          categoryName: "Grooming",
          scheduledTimeLabel: "7:00 PM",
          status: "completed",
          statusLabel: "Completed",
          note: "Before bed.",
        },
      ],
    });
    expect(
      analytics.behaviorSummaries
        .find((behavior) => behavior.behaviorId === "brush")
        ?.dailyCells.find((cell) => cell.localDate === "2026-06-07")
        ?.isSelected,
    ).toBe(true);
    expect(
      analytics.behaviorSummaries
        .find((behavior) => behavior.behaviorId === "journal")
        ?.dailyCells.find((cell) => cell.localDate === "2026-06-07")
        ?.isSelected,
    ).toBe(false);
  });

  it("does not return a behavior day review for missing or invalid selections", () => {
    const noBehavior = resolveAnalytics({
      now: NOW,
      timezone: DEFAULT_TIMEZONE,
      rangeDays: 7,
      selectedDayLocalDate: "2026-06-07",
      occurrences: [occurrence({ id: "selected", localDate: "2026-06-07" })],
    });
    const invalidDay = resolveAnalytics({
      now: NOW,
      timezone: DEFAULT_TIMEZONE,
      rangeDays: 7,
      selectedBehaviorId: "behavior-a",
      selectedDayLocalDate: "not-a-day",
      occurrences: [occurrence({ id: "selected" })],
    });
    const outsideRange = resolveAnalytics({
      now: NOW,
      timezone: DEFAULT_TIMEZONE,
      rangeDays: 7,
      selectedBehaviorId: "behavior-a",
      selectedDayLocalDate: "2026-05-01",
      occurrences: [occurrence({ id: "selected" })],
    });
    const emptyBehaviorDay = resolveAnalytics({
      now: NOW,
      timezone: DEFAULT_TIMEZONE,
      rangeDays: 7,
      selectedBehaviorId: "missing-behavior",
      selectedDayLocalDate: "2026-06-07",
      occurrences: [occurrence({ id: "selected", localDate: "2026-06-07" })],
    });

    expect(noBehavior.selectedBehaviorDay).toBeNull();
    expect(invalidDay.selectedBehaviorDay).toBeNull();
    expect(outsideRange.selectedBehaviorDay).toBeNull();
    expect(emptyBehaviorDay.selectedBehaviorDay).toBeNull();
  });
});

function timeSession(overrides: Partial<TimeSession> = {}): TimeSession {
  return {
    id: "time-session-1",
    userId: "user-1",
    occurrenceId: "occurrence-1",
    behaviorId: "brush",
    startedAt: "2026-06-08T13:00:00Z",
    stoppedAt: "2026-06-08T13:01:00Z",
    ...overrides,
  };
}

describe("resolveAnalytics with Behaviors of Opportunity", () => {
  const rows = [
    occurrence({ id: "s-done", status: "completed" }),
    occurrence({ id: "s-not", status: "not_completed", scheduledFor: "2026-06-07T13:00:00Z", localDate: "2026-06-07" }),
    occurrence({ id: "o-done", status: "completed", origin: "opportunity" }),
    occurrence({ id: "o-done-2", status: "completed", origin: "opportunity", scheduledFor: "2026-06-06T13:00:00Z", localDate: "2026-06-06" }),
    occurrence({ id: "o-not", status: "not_completed", origin: "opportunity", scheduledFor: "2026-06-05T13:00:00Z", localDate: "2026-06-05" }),
    occurrence({ id: "o-open", status: "unresolved", origin: "opportunity", scheduledFor: "2026-06-07T13:00:00Z", localDate: "2026-06-07" }),
  ];

  it("keeps overall adherence scheduled-only and counts added completions apart", () => {
    const { summary } = resolveAnalytics({ occurrences: rows, now: NOW, timezone: DEFAULT_TIMEZONE });
    expect(summary).toMatchObject({
      completedCount: 1, notCompletedCount: 1, resolvedCount: 2, rate: 0.5, percentLabel: "50%",
      opportunityCompletedCount: 2, opportunityNotCompletedCount: 1, opportunityDoneLabel: "Done 2 times",
    });
  });

  it("keeps an unresolved prior-day added Occurrence in the Needs decision count", () => {
    const { summary } = resolveAnalytics({ occurrences: rows, now: NOW, timezone: DEFAULT_TIMEZONE });
    expect(summary.unresolvedCount).toBe(1);
  });

  it("shows Done N times without a percentage for an unscheduled Behavior", () => {
    const unscheduled = [
      occurrence({ id: "u1", behaviorId: "walk", behaviorTitle: "Walk", status: "completed", origin: "opportunity" }),
      occurrence({ id: "u2", behaviorId: "walk", behaviorTitle: "Walk", status: "unresolved", origin: "opportunity" }),
    ];
    const [summary] = resolveAnalytics({ occurrences: unscheduled, now: NOW, timezone: DEFAULT_TIMEZONE }).behaviorSummaries;
    expect(summary).toMatchObject({ rate: null, resolvedCount: 0, opportunityCompletedCount: 1, opportunityDoneLabel: "Done 1 time" });
    expect(summary!.dailyCells.find(({ localDate }) => localDate === "2026-06-08")?.counts.completedCount).toBe(1);
  });

  it("leaves the overall heatmap to scheduled Occurrences", () => {
    const { overallHeatmap } = resolveAnalytics({ occurrences: rows, now: NOW, timezone: DEFAULT_TIMEZONE });
    expect(overallHeatmap.find(({ localDate }) => localDate === "2026-06-06")?.state).toBe("empty");
  });
});
