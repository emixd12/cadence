import { describe, expect, it } from "vitest";
import {
  mergeLongitudinalLayers,
  resolveFirstPartyLongitudinalPatterns,
} from "@cadence/core/resolvers/longitudinal-patterns.resolver";

describe("longitudinal-patterns.resolver", () => {
  it("computes proposal outcomes, post-travel-shift completion lift, duration stats, location affinity, and remodel signals", () => {
    const patterns = resolveFirstPartyLongitudinalPatterns({
      now: "2026-11-25T15:00:00Z",
      proposalOutcomes: [
        { behaviorId: "beh-run", localDate: "2026-11-03", outcome: "yes", travelMotivated: true },
        { behaviorId: "beh-run", localDate: "2026-11-10", outcome: "other_time", travelMotivated: true },
        { behaviorId: "beh-run", localDate: "2026-11-17", outcome: "yes", travelMotivated: true },
        { behaviorId: "beh-run", localDate: "2026-11-24", outcome: "no", travelMotivated: false },
        { behaviorId: "beh-read", localDate: "2026-11-20", outcome: "undo", travelMotivated: false },
      ],
      occurrences: [
        // Shifted occurrences (3/4 completed = 0.75) on Tuesdays (2026-11-03, 10, 17, 24)
        {
          behaviorId: "beh-run",
          localDate: "2026-11-03",
          status: "completed",
          travelMotivatedShift: true,
          travelDay: true,
          trackedDurationMinutes: 30,
          locationLabel: "away",
        },
        {
          behaviorId: "beh-run",
          localDate: "2026-11-10",
          status: "completed",
          travelMotivatedShift: true,
          travelDay: true,
          trackedDurationMinutes: 40,
          locationLabel: "away",
        },
        {
          behaviorId: "beh-run",
          localDate: "2026-11-17",
          status: "completed",
          travelMotivatedShift: true,
          travelDay: true,
          trackedDurationMinutes: 35,
          locationLabel: "away",
        },
        {
          behaviorId: "beh-run",
          localDate: "2026-11-24",
          status: "not_completed",
          travelMotivatedShift: true,
          travelDay: true,
          trackedDurationMinutes: null,
          locationLabel: null,
        },
        // Baseline occurrences (1/2 completed = 0.50)
        {
          behaviorId: "beh-run",
          localDate: "2026-11-05",
          status: "completed",
          travelMotivatedShift: false,
          travelDay: false,
          trackedDurationMinutes: 45,
          locationLabel: "home",
        },
        {
          behaviorId: "beh-run",
          localDate: "2026-11-12",
          status: "not_completed",
          travelMotivatedShift: false,
          travelDay: false,
          trackedDurationMinutes: null,
          locationLabel: null,
        },
        // Unresolved is excluded from rates
        {
          behaviorId: "beh-run",
          localDate: "2026-11-25",
          status: "unresolved",
          travelMotivatedShift: false,
          travelDay: false,
        },
      ],
    });

    expect(patterns.provenance).toBe("cadence_first_party");
    expect(patterns.proposalOutcomes).toEqual({
      yes: 2,
      otherTime: 1,
      no: 1,
      undo: 1,
      total: 5,
      acceptanceRate: 0.6,
    });

    expect(patterns.postTravelShiftCompletion).toEqual({
      shiftedCompleted: 3,
      shiftedDecided: 4,
      shiftedRate: 0.75,
      baselineCompleted: 1,
      baselineDecided: 2,
      baselineRate: 0.5,
      lift: 0.25,
    });

    const runStats = patterns.behaviorStats.find((b) => b.behaviorId === "beh-run");
    expect(runStats).toBeDefined();
    expect(runStats?.trackedDurationSampleCount).toBe(4);
    expect(runStats?.trackedDurationMedianMinutes).toBe(37.5);
    expect(runStats?.trackedDurationIqrMinutes).toBe(7.5);
    expect(runStats?.locationAffinity).toBe("away"); // 3 away / 4 total = 75%

    // Detects recurring Tuesday (dayOfWeek = 2) conflict and frequent travel shifts
    const weekdaySuggestion = patterns.remodelSuggestions.find(
      (s) => s.behaviorId === "beh-run" && s.pattern === "recurring_weekday_conflict",
    );
    expect(weekdaySuggestion).toEqual({
      behaviorId: "beh-run",
      pattern: "recurring_weekday_conflict",
      affectedWeekdays: [2],
      suggestedAction: "shift_weekday",
      confidence: "medium",
      evidenceCount: 4,
      requiresConfirmation: true,
    });

    const shiftSuggestion = patterns.remodelSuggestions.find(
      (s) => s.behaviorId === "beh-run" && s.pattern === "frequent_travel_shift",
    );
    expect(shiftSuggestion).toEqual({
      behaviorId: "beh-run",
      pattern: "frequent_travel_shift",
      affectedWeekdays: [2],
      suggestedAction: "mark_flexible",
      confidence: "medium",
      evidenceCount: 3,
      requiresConfirmation: true,
    });
  });

  it("merges Layer 2 with null, <=30d rolling, and >30d ephemeral calendar layers cleanly", () => {
    const firstParty = resolveFirstPartyLongitudinalPatterns({
      now: "2026-11-25T15:00:00Z",
      proposalOutcomes: [],
      occurrences: [],
    });

    const nullMerged = mergeLongitudinalLayers(firstParty, null);
    expect(nullMerged.rollingCalendarWindow).toBeNull();
    expect(nullMerged.firstPartyPatterns).toBe(firstParty);

    const rollingMerged = mergeLongitudinalLayers(firstParty, {
      windowDays: 30,
      heavyDayCount: 6,
      averageBusyMinutes: 215.456,
      busiestWeekdays: [4, 2, 2, 9],
    });
    expect(rollingMerged.rollingCalendarWindow).toEqual({
      provenance: "rolling_calendar_mcp",
      ephemeral: false,
      windowDays: 30,
      heavyDayCount: 6,
      averageBusyMinutes: 215.46,
      busiestWeekdays: [2, 4],
    });

    const ephemeralMerged = mergeLongitudinalLayers(firstParty, {
      windowDays: 90,
      heavyDayCount: 18,
      averageBusyMinutes: 180,
      busiestWeekdays: [1, 3],
    });
    expect(ephemeralMerged.rollingCalendarWindow).toEqual({
      provenance: "ephemeral_calendar_mcp",
      ephemeral: true,
      windowDays: 90,
      heavyDayCount: 18,
      averageBusyMinutes: 180,
      busiestWeekdays: [1, 3],
    });
  });
});
