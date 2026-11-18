import { describe, expect, it } from "vitest";
import { projectAdvisorCadenceSource } from "@cadence/core/services/advisor-day-context";

// Advisor Phase 3A1: the advisor's day context sees a moved item where it sits, who
// moved it, and today's answered brief lines and notices, all by opaque ref.
const ref = (kind: string, value: string) => `${kind}_${value}`;
const duration = { kind: "unknown", reason: "no_history", sampleCount: 0, requiredSampleCount: 3, lookbackDays: 90 } as const;

function project(extra: Partial<Parameters<typeof projectAdvisorCadenceSource>[0]> = {}) {
  return projectAdvisorCadenceSource({
    observedAt: "2026-11-18T15:00:00Z", revision: "r1", historyStartLocalDate: "2026-08-20", historyEndLocalDateExclusive: "2026-11-18",
    historyDays: 90, behaviors: [{ id: "b1" }], historyOccurrences: [], historyComplete: true, makeOpaqueRef: ref as never,
    occurrences: [
      { id: "o1", behaviorId: "b1", title: "Walk", status: "unresolved", localDate: "2026-11-18", startAt: "2026-11-18T21:00:00Z",
        move: { plannedFor: "2026-11-18T19:00:00Z", endAt: "2026-11-18T21:30:00Z", by: "daily_brief" },
        scheduleKind: "exact", scheduleStartTime: "14:00:00", scheduleEndTime: null, duration: duration as never },
      { id: "o2", behaviorId: "b1", title: "Walk", status: "unresolved", localDate: "2026-11-18", startAt: "2026-11-18T23:00:00Z",
        scheduleKind: "exact", scheduleStartTime: "18:00:00", scheduleEndTime: null, duration: duration as never },
    ],
    ...extra,
  });
}

describe("advisor day context with moves", () => {
  it("puts a moved item at its moved time and keeps the plan beside it", () => {
    const cadence = project();
    expect(cadence.occurrences[0]).toMatchObject({ ref: "occurrence_o1", scheduledFor: "2026-11-18T21:00:00Z",
      move: { plannedFor: "2026-11-18T19:00:00Z", endAt: "2026-11-18T21:30:00Z", by: "daily_brief" } });
    expect(cadence.occurrences[1]).not.toHaveProperty("move");
    expect(cadence).not.toHaveProperty("moveDay");
  });

  it("names today's answers and notices by ref, and drops any for items outside the day", () => {
    const cadence = project({ moveDay: {
      answers: [{ occurrenceId: "o1", kind: "yes" }, { occurrenceId: "elsewhere", kind: "no" }],
      conflicts: [{ occurrenceId: "o1", conflictingOccurrenceId: "o2" }, { occurrenceId: "o2", conflictingOccurrenceId: "elsewhere" }],
    } });
    expect(cadence.moveDay).toEqual({
      answers: [{ occurrenceRef: "occurrence_o1", kind: "yes" }],
      conflicts: [{ occurrenceRef: "occurrence_o1", conflictingOccurrenceRef: "occurrence_o2" }, { occurrenceRef: "occurrence_o2", conflictingOccurrenceRef: null }],
    });
  });
});
