import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";

import {
  EMPTY_DAY_MESSAGE,
  TIMELINE_DEFAULT_FUTURE_DAYS,
  TIMELINE_MAX_FUTURE_DAYS,
  resolveTimeline,
} from "../lib/resolvers/timeline.resolver";
import type { TimelineOccurrenceInput } from "../lib/types/timeline";
import { DEFAULT_TIMEZONE } from "../lib/types/recurrence";

const NOW_BEFORE_LOCAL_MIDNIGHT = Temporal.Instant.from(
  "2026-06-08T03:30:00Z",
);

function occurrence(
  overrides: Partial<TimelineOccurrenceInput> & Pick<TimelineOccurrenceInput, "id">,
): TimelineOccurrenceInput {
  return {
    behaviorId: `behavior-${overrides.id}`,
    title: `Behavior ${overrides.id}`,
    description: "",
    categoryName: "No category",
    scheduleSummary: "Daily",
    scheduledFor: "2026-06-07T13:00:00Z",
    scheduledTimeLabel: "9:00 AM",
    localDate: "2026-06-07",
    status: "unresolved",
    statusMarkedAt: null,
    note: "",
    timeTracking: { recordedSeconds: 0, runningStartedAt: null },
    canStartTimeTracking: true,
    ...overrides,
  };
}

describe("resolveTimeline", () => {
  it("uses the injected local day boundary for Needs decision", () => {
    const timeline = resolveTimeline({
      now: NOW_BEFORE_LOCAL_MIDNIGHT,
      timezone: DEFAULT_TIMEZONE,
      futureDays: 1,
      occurrences: [
        occurrence({
          id: "prior-unresolved",
          localDate: "2026-06-06",
          scheduledFor: "2026-06-06T14:00:00Z",
          status: "unresolved",
        }),
        occurrence({
          id: "prior-completed",
          localDate: "2026-06-06",
          scheduledFor: "2026-06-06T15:00:00Z",
          status: "completed",
        }),
        occurrence({
          id: "current-unresolved",
          localDate: "2026-06-07",
          scheduledFor: "2026-06-07T13:00:00Z",
          status: "unresolved",
        }),
      ],
    });

    expect(timeline.todayLocalDate).toBe("2026-06-07");
    expect(timeline.needsDecision.occurrenceCount).toBe(1);
    expect(timeline.needsDecision.daySections).toHaveLength(1);
    expect(timeline.needsDecision.daySections[0]?.localDate).toBe("2026-06-06");
    expect(
      timeline.needsDecision.daySections[0]?.unresolvedOccurrenceCount,
    ).toBe(1);
    expect(timeline.needsDecision.daySections[0]?.occurrences[0]).toMatchObject({
      id: "prior-unresolved",
      visualTone: "needs_decision",
      isVisibleInNeedsDecision: true,
      showDecisionActions: true,
      showCollapsedStatusLabel: false,
      canStartTimeTracking: true,
    });
    expect(timeline.daySections[0]?.occurrences[0]).toMatchObject({
      id: "current-unresolved",
      showDecisionActions: true,
      showCollapsedStatusLabel: false,
    });
  });

  it("retains prior-day rows decided on the current local day in Needs decision", () => {
    const timeline = resolveTimeline({
      now: NOW_BEFORE_LOCAL_MIDNIGHT,
      timezone: DEFAULT_TIMEZONE,
      futureDays: 0,
      occurrences: [
        occurrence({
          id: "prior-unresolved",
          localDate: "2026-06-06",
          scheduledFor: "2026-06-06T14:00:00Z",
          status: "unresolved",
        }),
        occurrence({
          id: "retained-completed",
          localDate: "2026-06-06",
          scheduledFor: "2026-06-06T15:00:00Z",
          status: "completed",
          statusMarkedAt: "2026-06-07T20:00:00Z",
        }),
        occurrence({
          id: "retained-not-completed",
          localDate: "2026-06-05",
          scheduledFor: "2026-06-05T15:00:00Z",
          status: "not_completed",
          statusMarkedAt: "2026-06-07T21:00:00Z",
        }),
      ],
    });

    expect(timeline.needsDecision.occurrenceCount).toBe(1);
    expect(timeline.needsDecision.daySections).toHaveLength(2);
    expect(
      timeline.needsDecision.daySections.map(
        (section) => section.unresolvedOccurrenceCount,
      ),
    ).toEqual([1, 0]);
    expect(
      timeline.needsDecision.daySections.flatMap((section) =>
        section.occurrences.map((item) => ({
          id: item.id,
          localDate: item.localDate,
          visualTone: item.visualTone,
          isVisibleInNeedsDecision: item.isVisibleInNeedsDecision,
          showDecisionActions: item.showDecisionActions,
          showCollapsedStatusLabel: item.showCollapsedStatusLabel,
          canStartTimeTracking: item.canStartTimeTracking,
        })),
      ),
    ).toEqual([
      {
        id: "prior-unresolved",
        localDate: "2026-06-06",
        visualTone: "needs_decision",
        isVisibleInNeedsDecision: true,
        showDecisionActions: true,
        showCollapsedStatusLabel: false,
        canStartTimeTracking: true,
      },
      {
        id: "retained-completed",
        localDate: "2026-06-06",
        visualTone: "completed",
        isVisibleInNeedsDecision: true,
        showDecisionActions: false,
        showCollapsedStatusLabel: true,
        canStartTimeTracking: true,
      },
      {
        id: "retained-not-completed",
        localDate: "2026-06-05",
        visualTone: "not_completed",
        isVisibleInNeedsDecision: true,
        showDecisionActions: false,
        showCollapsedStatusLabel: true,
        canStartTimeTracking: true,
      },
    ]);
  });

  it("drops retained Needs decision rows after the next local midnight", () => {
    const timeline = resolveTimeline({
      now: Temporal.Instant.from("2026-06-08T05:30:00Z"),
      timezone: DEFAULT_TIMEZONE,
      futureDays: 0,
      occurrences: [
        occurrence({
          id: "expired-retained",
          localDate: "2026-06-06",
          scheduledFor: "2026-06-06T14:00:00Z",
          status: "completed",
          statusMarkedAt: "2026-06-07T20:00:00Z",
        }),
      ],
    });

    expect(timeline.todayLocalDate).toBe("2026-06-08");
    expect(timeline.needsDecision.occurrenceCount).toBe(0);
    expect(timeline.needsDecision.daySections).toHaveLength(0);
  });

  it("shows the current day plus the next seven days by default", () => {
    const timeline = resolveTimeline({
      now: NOW_BEFORE_LOCAL_MIDNIGHT,
      timezone: DEFAULT_TIMEZONE,
      occurrences: [],
    });

    expect(timeline.visibleFutureDays).toBe(TIMELINE_DEFAULT_FUTURE_DAYS);
    expect(timeline.daySections).toHaveLength(TIMELINE_DEFAULT_FUTURE_DAYS + 1);
    expect(timeline.daySections.map((section) => section.localDate)).toEqual([
      "2026-06-07",
      "2026-06-08",
      "2026-06-09",
      "2026-06-10",
      "2026-06-11",
      "2026-06-12",
      "2026-06-13",
      "2026-06-14",
    ]);
    expect(
      timeline.daySections.every(
        (section) => section.emptyMessage === EMPTY_DAY_MESSAGE,
      ),
    ).toBe(true);
    expect(timeline.nextFutureDays).toBe(14);
  });

  it("orders items within each day by scheduled time", () => {
    const timeline = resolveTimeline({
      now: NOW_BEFORE_LOCAL_MIDNIGHT,
      timezone: DEFAULT_TIMEZONE,
      futureDays: 0,
      occurrences: [
        occurrence({
          id: "later",
          title: "Later",
          scheduledFor: "2026-06-07T22:00:00Z",
          scheduledTimeLabel: "6:00 PM",
        }),
        occurrence({
          id: "earlier",
          title: "Earlier",
          scheduledFor: "2026-06-07T12:00:00Z",
          scheduledTimeLabel: "8:00 AM",
        }),
      ],
    });

    expect(timeline.daySections[0]?.occurrences.map((item) => item.id)).toEqual([
      "earlier",
      "later",
    ]);
  });

  it("groups same-day occurrences from the same behavior into a stack", () => {
    const timeline = resolveTimeline({
      now: NOW_BEFORE_LOCAL_MIDNIGHT,
      timezone: DEFAULT_TIMEZONE,
      futureDays: 0,
      occurrences: [
        occurrence({
          id: "stretch-evening",
          behaviorId: "stretch",
          title: "Stretch",
          scheduledFor: "2026-06-07T22:00:00Z",
          scheduledTimeLabel: "Evening (6:00 PM-Midnight)",
          status: "completed",
        }),
        occurrence({
          id: "walk",
          behaviorId: "walk",
          title: "Walk",
          scheduledFor: "2026-06-07T16:00:00Z",
          scheduledTimeLabel: "12:00 PM",
          status: "unresolved",
        }),
        occurrence({
          id: "stretch-morning",
          behaviorId: "stretch",
          title: "Stretch",
          scheduledFor: "2026-06-07T10:00:00Z",
          scheduledTimeLabel: "Morning (6:00 AM-Noon)",
          status: "not_completed",
        }),
      ],
    });

    expect(
      timeline.daySections[0]?.occurrenceGroups.map((group) => ({
        behaviorId: group.behaviorId,
        isGroupedStack: group.isGroupedStack,
        occurrenceIds: group.occurrences.map((item) => item.id),
        tones: group.occurrences.map((item) => item.visualTone),
      })),
    ).toEqual([
      {
        behaviorId: "stretch",
        isGroupedStack: true,
        occurrenceIds: ["stretch-morning", "stretch-evening"],
        tones: ["not_completed", "completed"],
      },
      {
        behaviorId: "walk",
        isGroupedStack: false,
        occurrenceIds: ["walk"],
        tones: ["default"],
      },
    ]);
  });

  it("keeps resolved current-day occurrences visible with distinct resolved state", () => {
    const timeline = resolveTimeline({
      now: NOW_BEFORE_LOCAL_MIDNIGHT,
      timezone: DEFAULT_TIMEZONE,
      futureDays: 0,
      occurrences: [
        occurrence({
          id: "completed",
          status: "completed",
        }),
        occurrence({
          id: "not-completed",
          status: "not_completed",
          scheduledFor: "2026-06-07T14:00:00Z",
          scheduledTimeLabel: "10:00 AM",
        }),
      ],
    });

    expect(timeline.daySections[0]?.occurrences).toMatchObject([
      {
        id: "completed",
        statusLabel: "Completed",
        statusDetail: "Resolved as Completed",
        visualTone: "completed",
        showDecisionActions: false,
        showCollapsedStatusLabel: true,
      },
      {
        id: "not-completed",
        statusLabel: "Not Completed",
        statusDetail: "Resolved as Not Completed",
        visualTone: "not_completed",
        showDecisionActions: false,
        showCollapsedStatusLabel: true,
      },
    ]);
  });

  it("clamps expanded future-day requests to the generated horizon", () => {
    const timeline = resolveTimeline({
      now: NOW_BEFORE_LOCAL_MIDNIGHT,
      timezone: DEFAULT_TIMEZONE,
      futureDays: 999,
      occurrences: [],
    });

    expect(timeline.visibleFutureDays).toBe(TIMELINE_MAX_FUTURE_DAYS);
    expect(timeline.daySections).toHaveLength(TIMELINE_MAX_FUTURE_DAYS + 1);
    expect(timeline.nextFutureDays).toBeNull();
  });

  it("preserves expanded detail fields without using them for collapsed grouping", () => {
    const timeline = resolveTimeline({
      now: NOW_BEFORE_LOCAL_MIDNIGHT,
      timezone: DEFAULT_TIMEZONE,
      futureDays: 0,
      occurrences: [
        occurrence({
          id: "with-details",
          description: "Add values in the note.",
          categoryName: "Measurements",
          scheduleSummary: "Monthly on day 7",
          note: "Waist 30 in.",
        }),
      ],
    });

    expect(timeline.daySections[0]?.occurrences[0]).toMatchObject({
      description: "Add values in the note.",
      categoryName: "Measurements",
      scheduleSummary: "Monthly on day 7",
      note: "Waist 30 in.",
    });
  });
});

describe("resolveTimeline with Behaviors of Opportunity", () => {
  const now = Temporal.Instant.from("2026-06-08T16:00:00Z");
  const resolve = (occurrences: TimelineOccurrenceInput[]) =>
    resolveTimeline({ now, timezone: DEFAULT_TIMEZONE, futureDays: 0, occurrences });
  const todayRow = (overrides: Partial<TimelineOccurrenceInput> & Pick<TimelineOccurrenceInput, "id">) =>
    occurrence({ localDate: "2026-06-08", scheduledFor: "2026-06-08T17:00:00Z", ...overrides });

  it("marks rows without an origin as scheduled and not removable", () => {
    const [row] = resolve([todayRow({ id: "scheduled" })]).daySections[0]!.occurrences;
    expect(row).toMatchObject({ origin: "scheduled", addedBy: null, canRemove: false });
  });

  it("offers Remove for a clean added row on Today and in Needs decision", () => {
    const timeline = resolve([
      todayRow({ id: "today", origin: "opportunity", addedBy: "chat", hasStatusHistory: false }),
      occurrence({ id: "prior", localDate: "2026-06-07", origin: "opportunity", addedBy: "user", hasStatusHistory: false }),
    ]);
    expect(timeline.daySections[0]!.occurrences[0]).toMatchObject({ origin: "opportunity", addedBy: "chat", canRemove: true });
    expect(timeline.needsDecision.occurrenceCount).toBe(1);
    expect(timeline.needsDecision.daySections[0]!.occurrences[0]).toMatchObject({ id: "prior", canRemove: true });
  });

  it("hides Remove for an added row with a note, time, mark, match or unknown history", () => {
    const rows = [
      todayRow({ id: "noted", origin: "opportunity", addedBy: "user", hasStatusHistory: false, note: "ok" }),
      todayRow({ id: "timed", origin: "opportunity", addedBy: "user", hasStatusHistory: false, timeTracking: { recordedSeconds: 60, runningStartedAt: null } }),
      todayRow({ id: "running", origin: "opportunity", addedBy: "user", hasStatusHistory: false, timeTracking: { recordedSeconds: 0, runningStartedAt: "2026-06-08T15:00:00Z" } }),
      todayRow({ id: "marked", origin: "opportunity", addedBy: "user", hasStatusHistory: true, status: "completed", statusMarkedAt: "2026-06-08T15:00:00Z" }),
      todayRow({ id: "matched", origin: "opportunity", addedBy: "user", hasStatusHistory: false, hasActiveSourceMatch: true }),
      todayRow({ id: "unknown", origin: "opportunity", addedBy: "user" }),
    ];
    expect(resolve(rows).daySections[0]!.occurrences.map(({ id, canRemove }) => [id, canRemove]).sort())
      .toEqual(rows.map(({ id }) => [id, false]).sort());
  });
});
