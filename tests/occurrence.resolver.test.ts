import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_OCCURRENCE_HORIZON_DAYS,
  normalizeOccurrenceScheduleGraph,
  planOccurrenceGeneration,
  planOccurrenceRepair,
  type ExistingOccurrenceForGeneration,
  type OccurrenceGenerationBehavior,
} from "../lib/resolvers/occurrence.resolver";
import { DEFAULT_TIMEZONE } from "../lib/types/recurrence";

const BASE_BEHAVIOR: OccurrenceGenerationBehavior = {
  id: "behavior-1",
  userId: "user-1",
  configurationEventId: "configuration-event-current",
  recurrenceRule: { frequency: "daily", interval: 1 },
  scheduleSlots: [
    {
      id: null,
      kind: "exact",
      preset: null,
      startTime: "09:00",
      endTime: null,
      sortOrder: 0,
    },
  ],
  timezone: DEFAULT_TIMEZONE,
  active: true,
  createdAt: "2026-01-01T14:00:00Z",
};

const NOW = Temporal.Instant.from("2026-01-02T16:00:00Z");

function summarizeCreate(
  plan: ReturnType<typeof planOccurrenceGeneration>,
): Array<{ scheduledFor: string; localDate: string }> {
  return plan.create.map((occurrence) => ({
    scheduledFor: occurrence.scheduledFor,
    localDate: occurrence.localDate,
  }));
}

function deleteIds(
  plan: ReturnType<typeof planOccurrenceGeneration>,
): string[] {
  return plan.deleteUnresolved.map((occurrence) => occurrence.id);
}

function existingOccurrence(
  id: string,
  scheduledFor: string,
  localDate: string,
  status: ExistingOccurrenceForGeneration["status"] = "unresolved",
): ExistingOccurrenceForGeneration {
  return {
    id,
    scheduledFor,
    localDate,
    status,
    scheduleSlotId: null,
    scheduleKind: "exact",
    schedulePreset: null,
    scheduleStartTime: "09:00",
    scheduleEndTime: null,
    note: null,
    hasTimeSessions: false,
    behaviorConfigurationEventId: "configuration-event-current",
  };
}

describe("planOccurrenceGeneration with per-day moves (advisor Phase 2A)", () => {
  const atTen = { ...BASE_BEHAVIOR, scheduleSlots: [{ ...BASE_BEHAVIOR.scheduleSlots[0]!, startTime: "10:00" }] };
  const atFifteen = { ...BASE_BEHAVIOR, scheduleSlots: [{ ...BASE_BEHAVIOR.scheduleSlots[0]!, startTime: "15:00" }] };
  const today = (plan: ReturnType<typeof planOccurrenceGeneration>) =>
    summarizeCreate(plan).filter((occurrence) => occurrence.localDate === "2026-01-02");

  it("keeps a moved Occurrence through a schedule edit and adds no second copy for its day", () => {
    // Planned 09:00 (already past at 11:00), moved for today; the schedule moves to 10:00.
    const moved = { ...existingOccurrence("moved", "2026-01-02T14:00:00Z", "2026-01-02"), moved: true };
    const plan = planOccurrenceGeneration({ behavior: atTen, existingOccurrences: [moved], now: NOW, horizonDays: 1 });
    expect(today(plan)).toEqual([]);
    expect(deleteIds(plan)).toEqual([]);
    expect(summarizeCreate(plan)).toEqual([{ scheduledFor: "2026-01-03T15:00:00Z", localDate: "2026-01-03" }]);
  });

  it("never deletes a moved Occurrence whose planned time is still ahead", () => {
    const unmoved = existingOccurrence("plain", "2026-01-02T19:00:00Z", "2026-01-02");
    unmoved.scheduleStartTime = "14:00";
    const moved = { ...unmoved, id: "moved", moved: true };
    const before = planOccurrenceGeneration({ behavior: atFifteen, existingOccurrences: [unmoved], now: NOW, horizonDays: 1 });
    expect(deleteIds(before)).toEqual(["plain"]);
    expect(today(before)).toEqual([{ scheduledFor: "2026-01-02T20:00:00Z", localDate: "2026-01-02" }]);
    const after = planOccurrenceGeneration({ behavior: atFifteen, existingOccurrences: [moved], now: NOW, horizonDays: 1 });
    expect(deleteIds(after)).toEqual([]);
    expect(today(after)).toEqual([]);
  });

  it("leaves other days and other slots alone", () => {
    const twoSlots = { ...atTen, scheduleSlots: [atTen.scheduleSlots[0]!, { ...atTen.scheduleSlots[0]!, startTime: "18:00", sortOrder: 1 }] };
    const moved = { ...existingOccurrence("moved", "2026-01-02T14:00:00Z", "2026-01-02"), moved: true };
    const plan = planOccurrenceGeneration({ behavior: twoSlots, existingOccurrences: [moved], now: NOW, horizonDays: 1 });
    // Today keeps the moved item in place of 10:00 and still gets 18:00.
    expect(today(plan)).toEqual([{ scheduledFor: "2026-01-02T23:00:00Z", localDate: "2026-01-02" }]);
  });
});

describe("planOccurrenceGeneration", () => {
  it("plans today plus the next 30 local days by default", () => {
    const plan = planOccurrenceGeneration({
      behavior: BASE_BEHAVIOR,
      existingOccurrences: [],
      now: NOW,
    });

    expect(plan.generationWindow.startLocalDate).toBe("2026-01-02");
    expect(plan.generationWindow.endLocalDate).toBe("2026-02-01");
    expect(plan.create).toHaveLength(DEFAULT_OCCURRENCE_HORIZON_DAYS + 1);
    expect(summarizeCreate(plan).at(0)).toEqual({
      scheduledFor: "2026-01-02T14:00:00Z",
      localDate: "2026-01-02",
    });
    expect(summarizeCreate(plan).at(-1)).toEqual({
      scheduledFor: "2026-02-01T14:00:00Z",
      localDate: "2026-02-01",
    });
  });

  it("does not plan duplicate inserts for already generated occurrences", () => {
    const plan = planOccurrenceGeneration({
      behavior: BASE_BEHAVIOR,
      existingOccurrences: [
        existingOccurrence("existing-1", "2026-01-02T14:00:00+00:00", "2026-01-02"),
        existingOccurrence("existing-2", "2026-01-03T14:00:00+00:00", "2026-01-03"),
      ],
      now: NOW,
      horizonDays: 1,
    });

    expect(plan.create).toEqual([]);
    expect(deleteIds(plan)).toEqual([]);
  });

  it("detects missing occurrences inside the generation window", () => {
    const plan = planOccurrenceGeneration({
      behavior: BASE_BEHAVIOR,
      existingOccurrences: [
        existingOccurrence("existing-1", "2026-01-02T14:00:00Z", "2026-01-02"),
        existingOccurrence("existing-3", "2026-01-04T14:00:00Z", "2026-01-04"),
      ],
      now: NOW,
      horizonDays: 2,
    });

    expect(summarizeCreate(plan)).toEqual([
      {
        scheduledFor: "2026-01-03T14:00:00Z",
        localDate: "2026-01-03",
      },
    ]);
    expect(deleteIds(plan)).toEqual([]);
    expect(plan.create[0]?.behaviorConfigurationEventId).toBe(
      "configuration-event-current",
    );
  });

  it("plans one occurrence per schedule slot on each matching day", () => {
    const plan = planOccurrenceGeneration({
      behavior: {
        ...BASE_BEHAVIOR,
        scheduleSlots: [
          {
            id: "slot-morning",
            kind: "range",
            preset: "morning",
            startTime: "06:00",
            endTime: "12:00",
            sortOrder: 0,
          },
          {
            id: "slot-evening",
            kind: "exact",
            preset: null,
            startTime: "21:30",
            endTime: null,
            sortOrder: 1,
          },
        ],
      },
      existingOccurrences: [],
      now: NOW,
      horizonDays: 0,
    });

    expect(plan.create).toEqual([
      expect.objectContaining({
        scheduledFor: "2026-01-02T11:00:00Z",
        localDate: "2026-01-02",
        scheduleSlotId: "slot-morning",
        scheduleKind: "range",
        schedulePreset: "morning",
        scheduleStartTime: "06:00",
        scheduleEndTime: "12:00",
      }),
      expect.objectContaining({
        scheduledFor: "2026-01-03T02:30:00Z",
        localDate: "2026-01-02",
        scheduleSlotId: "slot-evening",
        scheduleKind: "exact",
        schedulePreset: null,
        scheduleStartTime: "21:30",
        scheduleEndTime: null,
      }),
    ]);
  });

  it("plans nested schedules with independent recurrence rules", () => {
    const plan = planOccurrenceGeneration({
      behavior: {
        ...BASE_BEHAVIOR,
        schedules: [
          {
            id: "schedule-daily",
            recurrenceRule: { frequency: "daily", interval: 1 },
            sortOrder: 0,
            timeEntries: [
              {
                id: "slot-morning",
                scheduleId: "schedule-daily",
                kind: "exact",
                preset: null,
                startTime: "09:00",
                endTime: null,
                sortOrder: 0,
              },
            ],
          },
          {
            id: "schedule-friday",
            recurrenceRule: {
              frequency: "weekly",
              interval: 1,
              daysOfWeek: ["friday"],
            },
            sortOrder: 1,
            timeEntries: [
              {
                id: "slot-friday",
                scheduleId: "schedule-friday",
                kind: "range",
                preset: null,
                startTime: "17:00",
                endTime: "17:30",
                sortOrder: 0,
              },
            ],
          },
        ],
        scheduleSlots: [],
      },
      existingOccurrences: [],
      now: NOW,
      horizonDays: 2,
    });

    expect(
      plan.create.map((occurrence) => ({
        scheduledFor: occurrence.scheduledFor,
        localDate: occurrence.localDate,
        scheduleSlotId: occurrence.scheduleSlotId,
        scheduleKind: occurrence.scheduleKind,
        scheduleStartTime: occurrence.scheduleStartTime,
        scheduleEndTime: occurrence.scheduleEndTime,
      })),
    ).toEqual([
      {
        scheduledFor: "2026-01-02T14:00:00Z",
        localDate: "2026-01-02",
        scheduleSlotId: "slot-morning",
        scheduleKind: "exact",
        scheduleStartTime: "09:00",
        scheduleEndTime: null,
      },
      {
        scheduledFor: "2026-01-02T22:00:00Z",
        localDate: "2026-01-02",
        scheduleSlotId: "slot-friday",
        scheduleKind: "range",
        scheduleStartTime: "17:00",
        scheduleEndTime: "17:30",
      },
      {
        scheduledFor: "2026-01-03T14:00:00Z",
        localDate: "2026-01-03",
        scheduleSlotId: "slot-morning",
        scheduleKind: "exact",
        scheduleStartTime: "09:00",
        scheduleEndTime: null,
      },
      {
        scheduledFor: "2026-01-04T14:00:00Z",
        localDate: "2026-01-04",
        scheduleSlotId: "slot-morning",
        scheduleKind: "exact",
        scheduleStartTime: "09:00",
        scheduleEndTime: null,
      },
    ]);
  });

  it("merges duplicate generated occurrences from overlapping schedules", () => {
    const plan = planOccurrenceGeneration({
      behavior: {
        ...BASE_BEHAVIOR,
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
        scheduleSlots: [],
      },
      existingOccurrences: [],
      now: NOW,
      horizonDays: 2,
    });

    expect(
      plan.create.map((occurrence) => ({
        scheduledFor: occurrence.scheduledFor,
        localDate: occurrence.localDate,
        scheduleSlotId: occurrence.scheduleSlotId,
      })),
    ).toEqual([
      {
        scheduledFor: "2026-01-03T04:00:00Z",
        localDate: "2026-01-02",
        scheduleSlotId: "slot-daily",
      },
      {
        scheduledFor: "2026-01-04T04:00:00Z",
        localDate: "2026-01-03",
        scheduleSlotId: "slot-daily",
      },
      {
        scheduledFor: "2026-01-05T04:00:00Z",
        localDate: "2026-01-04",
        scheduleSlotId: "slot-daily",
      },
    ]);
  });

  it("keeps exact and range occurrences that share one start time", () => {
    const plan = planOccurrenceGeneration({
      behavior: {
        ...BASE_BEHAVIOR,
        schedules: [
          {
            id: "schedule-range",
            recurrenceRule: { frequency: "daily", interval: 1 },
            sortOrder: 1,
            timeEntries: [
              {
                id: "slot-range",
                scheduleId: "schedule-range",
                kind: "range",
                preset: null,
                startTime: "09:00",
                endTime: "10:00",
                sortOrder: 0,
              },
            ],
          },
          {
            id: "schedule-exact",
            recurrenceRule: { frequency: "daily", interval: 1 },
            sortOrder: 0,
            timeEntries: [
              {
                id: "slot-exact",
                scheduleId: "schedule-exact",
                kind: "exact",
                preset: null,
                startTime: "09:00",
                endTime: null,
                sortOrder: 0,
              },
            ],
          },
        ],
        scheduleSlots: [],
      },
      existingOccurrences: [],
      now: NOW,
      horizonDays: 0,
    });

    expect(plan.create).toEqual([
      expect.objectContaining({
        scheduledFor: "2026-01-02T14:00:00Z",
        scheduleSlotId: "slot-exact",
        scheduleKind: "exact",
        scheduleEndTime: null,
      }),
      expect.objectContaining({
        scheduledFor: "2026-01-02T14:00:00Z",
        scheduleSlotId: "slot-range",
        scheduleKind: "range",
        scheduleEndTime: "10:00",
      }),
    ]);

    const repeatedPlan = planOccurrenceGeneration({
      behavior: {
        ...BASE_BEHAVIOR,
        schedules: [
          {
            id: "schedule-range",
            recurrenceRule: { frequency: "daily", interval: 1 },
            sortOrder: 1,
            timeEntries: [
              {
                id: "slot-range",
                scheduleId: "schedule-range",
                kind: "range",
                preset: null,
                startTime: "09:00",
                endTime: "10:00",
                sortOrder: 0,
              },
            ],
          },
          {
            id: "schedule-exact",
            recurrenceRule: { frequency: "daily", interval: 1 },
            sortOrder: 0,
            timeEntries: [
              {
                id: "slot-exact",
                scheduleId: "schedule-exact",
                kind: "exact",
                preset: null,
                startTime: "09:00",
                endTime: null,
                sortOrder: 0,
              },
            ],
          },
        ],
        scheduleSlots: [],
      },
      existingOccurrences: plan.create.map((occurrence, index) => ({
        id: `existing-${index}`,
        scheduledFor: occurrence.scheduledFor,
        localDate: occurrence.localDate,
        status: occurrence.status,
        scheduleSlotId: occurrence.scheduleSlotId,
        scheduleKind: occurrence.scheduleKind,
        schedulePreset: occurrence.schedulePreset,
        scheduleStartTime: occurrence.scheduleStartTime,
        scheduleEndTime: occurrence.scheduleEndTime,
        note: null,
        hasTimeSessions: false,
        behaviorConfigurationEventId:
          occurrence.behaviorConfigurationEventId,
      })),
      now: NOW,
      horizonDays: 0,
    });

    expect(repeatedPlan.create).toEqual([]);
    expect(repeatedPlan.deleteUnresolved).toEqual([]);
  });

  it("uses the behavior creation date as the interval anchor", () => {
    const plan = planOccurrenceGeneration({
      behavior: {
        ...BASE_BEHAVIOR,
        recurrenceRule: { frequency: "interval_days", intervalDays: 2 },
      },
      existingOccurrences: [],
      now: NOW,
      horizonDays: 4,
    });

    expect(summarizeCreate(plan)).toEqual([
      {
        scheduledFor: "2026-01-03T14:00:00Z",
        localDate: "2026-01-03",
      },
      {
        scheduledFor: "2026-01-05T14:00:00Z",
        localDate: "2026-01-05",
      },
    ]);
  });

  it("updates the instant of a same-identity future unresolved occurrence", () => {
    const plan = planOccurrenceGeneration({
      behavior: BASE_BEHAVIOR,
      existingOccurrences: [
        existingOccurrence("past-unresolved", "2026-01-01T15:00:00Z", "2026-01-01"),
        existingOccurrence("future-unresolved", "2026-01-02T18:00:00Z", "2026-01-02"),
        existingOccurrence("future-completed", "2026-01-03T15:00:00Z", "2026-01-03", "completed"),
        existingOccurrence("beyond-window-unresolved", "2026-01-05T15:00:00Z", "2026-01-05"),
      ],
      now: NOW,
      horizonDays: 1,
    });

    expect(deleteIds(plan)).toEqual([]);
    expect(plan.updateUnresolved).toEqual([
      expect.objectContaining({
        id: "future-unresolved",
        previousScheduledFor: "2026-01-02T18:00:00Z",
        scheduledFor: "2026-01-02T14:00:00Z",
      }),
    ]);
  });

  it("preserves a stale unresolved occurrence scheduled earlier today", () => {
    const plan = planOccurrenceGeneration({
      behavior: BASE_BEHAVIOR,
      existingOccurrences: [
        existingOccurrence(
          "earlier-today-unresolved",
          "2026-01-02T13:00:00Z",
          "2026-01-02",
        ),
      ],
      now: NOW,
      horizonDays: 0,
    });

    expect(deleteIds(plan)).toEqual([]);
  });

  it("preserves a stale unresolved occurrence scheduled exactly at now", () => {
    const plan = planOccurrenceGeneration({
      behavior: BASE_BEHAVIOR,
      existingOccurrences: [
        existingOccurrence(
          "current-instant-unresolved",
          NOW.toString(),
          "2026-01-02",
        ),
      ],
      now: NOW,
      horizonDays: 0,
    });

    expect(deleteIds(plan)).toEqual([]);
  });

  it("updates a same-identity unresolved occurrence scheduled later today", () => {
    const plan = planOccurrenceGeneration({
      behavior: BASE_BEHAVIOR,
      existingOccurrences: [
        existingOccurrence(
          "later-today-unresolved",
          "2026-01-02T18:00:00Z",
          "2026-01-02",
        ),
      ],
      now: NOW,
      horizonDays: 0,
    });

    expect(deleteIds(plan)).toEqual([]);
    expect(plan.updateUnresolved).toEqual([
      expect.objectContaining({ id: "later-today-unresolved" }),
    ]);
  });

  it("preserves a stale future unresolved occurrence with a non-empty note", () => {
    const occurrence = existingOccurrence(
      "noted-future-unresolved",
      "2026-01-02T18:00:00Z",
      "2026-01-02",
    );
    occurrence.note = "Taken after breakfast";

    const plan = planOccurrenceGeneration({
      behavior: BASE_BEHAVIOR,
      existingOccurrences: [occurrence],
      now: NOW,
      horizonDays: 0,
    });

    expect(deleteIds(plan)).toEqual([]);
  });

  it("updates a stale future occurrence with a whitespace-only note", () => {
    const occurrence = existingOccurrence(
      "empty-note-future-unresolved",
      "2026-01-02T18:00:00Z",
      "2026-01-02",
    );
    occurrence.note = "  \n  ";

    const plan = planOccurrenceGeneration({
      behavior: BASE_BEHAVIOR,
      existingOccurrences: [occurrence],
      now: NOW,
      horizonDays: 0,
    });

    expect(deleteIds(plan)).toEqual([]);
    expect(plan.updateUnresolved).toEqual([
      expect.objectContaining({ id: "empty-note-future-unresolved" }),
    ]);
  });

  it("preserves a stale future unresolved occurrence with a time session", () => {
    const occurrence = existingOccurrence(
      "timed-future-unresolved",
      "2026-01-02T18:00:00Z",
      "2026-01-02",
    );
    occurrence.hasTimeSessions = true;

    const plan = planOccurrenceGeneration({
      behavior: BASE_BEHAVIOR,
      existingOccurrences: [occurrence],
      now: NOW,
      horizonDays: 0,
    });

    expect(deleteIds(plan)).toEqual([]);
  });

  it("replaces a future row when its range identity changes", () => {
    const plan = planOccurrenceGeneration({
      behavior: {
        ...BASE_BEHAVIOR,
        scheduleSlots: [
          {
            id: "slot-morning",
            kind: "range",
            preset: null,
            startTime: "17:00",
            endTime: "18:00",
            sortOrder: 0,
          },
        ],
      },
      existingOccurrences: [
        {
          ...existingOccurrence(
            "future-unresolved",
            "2026-01-02T22:00:00Z",
            "2026-01-02",
          ),
          scheduleSlotId: null,
          scheduleKind: "exact",
          schedulePreset: null,
          scheduleStartTime: "17:00",
          scheduleEndTime: null,
        },
      ],
      now: NOW,
      horizonDays: 0,
    });

    expect(plan.create).toEqual([
      expect.objectContaining({
        scheduledFor: "2026-01-02T22:00:00Z",
        scheduleSlotId: "slot-morning",
        scheduleKind: "range",
        scheduleEndTime: "18:00",
      }),
    ]);
    expect(deleteIds(plan)).toEqual(["future-unresolved"]);
    expect(plan.updateUnresolved).toEqual([]);
  });

  it("advances linked future same-instant rows to the governing event even when snapshots match", () => {
    const occurrence = existingOccurrence(
      "future-linked",
      "2026-01-03T14:00:00Z",
      "2026-01-03",
    );
    occurrence.behaviorConfigurationEventId = "configuration-event-old";

    const plan = planOccurrenceGeneration({
      behavior: BASE_BEHAVIOR,
      existingOccurrences: [occurrence],
      now: NOW,
      horizonDays: 1,
    });

    expect(plan.updateUnresolved).toEqual([
      expect.objectContaining({
        id: "future-linked",
        behaviorConfigurationEventId: "configuration-event-current",
      }),
    ]);
  });

  it("does not retrofit null lineage on a matching legacy future row", () => {
    const occurrence = existingOccurrence(
      "future-legacy",
      "2026-01-03T14:00:00Z",
      "2026-01-03",
    );
    occurrence.behaviorConfigurationEventId = null;

    const plan = planOccurrenceGeneration({
      behavior: BASE_BEHAVIOR,
      existingOccurrences: [occurrence],
      now: NOW,
      horizonDays: 1,
    });

    expect(plan.updateUnresolved).toEqual([]);
  });

  it("keeps both null lineage and the historical snapshot on a legacy future row", () => {
    const occurrence = existingOccurrence(
      "future-legacy",
      "2026-01-03T14:00:00Z",
      "2026-01-03",
    );
    occurrence.behaviorConfigurationEventId = null;
    occurrence.scheduleKind = "range";
    occurrence.scheduleEndTime = "12:00";

    const plan = planOccurrenceGeneration({
      behavior: BASE_BEHAVIOR,
      existingOccurrences: [occurrence],
      now: NOW,
      horizonDays: 1,
    });

    expect(plan.updateUnresolved).toEqual([]);
  });

  it.each([
    {
      name: "at now",
      scheduledFor: NOW.toString(),
      status: "unresolved" as const,
      note: null,
      hasTimeSessions: false,
    },
    {
      name: "resolved",
      scheduledFor: "2026-01-03T14:00:00Z",
      status: "completed" as const,
      note: null,
      hasTimeSessions: false,
    },
    {
      name: "note-bearing",
      scheduledFor: "2026-01-03T14:00:00Z",
      status: "unresolved" as const,
      note: "Context",
      hasTimeSessions: false,
    },
    {
      name: "time-session-bearing",
      scheduledFor: "2026-01-03T14:00:00Z",
      status: "unresolved" as const,
      note: null,
      hasTimeSessions: true,
    },
  ])(
    "preserves $name row lineage and schedule snapshot",
    ({ scheduledFor, status, note, hasTimeSessions }) => {
      const occurrence = existingOccurrence(
        "protected-row",
        scheduledFor,
        scheduledFor === NOW.toString() ? "2026-01-02" : "2026-01-03",
        status,
      );
      occurrence.behaviorConfigurationEventId = "configuration-event-old";
      occurrence.scheduleKind = "range";
      occurrence.scheduleEndTime = "12:00";
      occurrence.note = note;
      occurrence.hasTimeSessions = hasTimeSessions;

      const plan = planOccurrenceGeneration({
        behavior: BASE_BEHAVIOR,
        existingOccurrences: [occurrence],
        now: NOW,
        horizonDays: 1,
      });

      expect(plan.updateUnresolved).toEqual([]);
    },
  );

  it("does not create occurrences for archived behaviors and removes future unresolved rows", () => {
    const plan = planOccurrenceGeneration({
      behavior: {
        ...BASE_BEHAVIOR,
        active: false,
      },
      existingOccurrences: [
        existingOccurrence("future-unresolved", "2026-01-02T18:00:00Z", "2026-01-02"),
        existingOccurrence("future-completed", "2026-01-03T14:00:00Z", "2026-01-03", "completed"),
      ],
      now: NOW,
      horizonDays: 1,
    });

    expect(plan.create).toEqual([]);
    expect(deleteIds(plan)).toEqual(["future-unresolved"]);
  });

  it("treats end_on as the last local day that runs", () => {
    const plan = planOccurrenceGeneration({
      behavior: { ...BASE_BEHAVIOR, endOn: "2026-01-03" },
      existingOccurrences: [
        existingOccurrence("end-date-row", "2026-01-04T14:00:00Z", "2026-01-04"),
      ],
      now: NOW,
      horizonDays: 4,
    });

    expect(plan.create.map(({ localDate }) => localDate)).toEqual([
      "2026-01-02",
      "2026-01-03",
    ]);
    expect(deleteIds(plan)).toEqual(["end-date-row"]);
  });

  it("an end removes a past-due unmarked row after it, as an end entered offline leaves", () => {
    // NOW is 11 AM in New York; the end is 8:30 AM, after which the 9 AM row is still unmarked.
    const plan = planOccurrenceGeneration({
      behavior: { ...BASE_BEHAVIOR, endOn: "2026-01-02", endTime: "08:30" },
      existingOccurrences: [
        existingOccurrence("after-end-past", "2026-01-02T14:00:00Z", "2026-01-02"),
        { ...existingOccurrence("after-end-done", "2026-01-02T14:00:00Z", "2026-01-02"), status: "completed" },
      ],
      now: NOW,
      horizonDays: 3,
    });
    expect(plan.create).toEqual([]);
    expect(deleteIds(plan)).toEqual(["after-end-past"]);
  });

  it("a pause removes rows inside it, even one moved into it, and resumes on the back-on day", () => {
    // NOW is 11 AM. The pause starts at noon; the 9 AM row was moved to 1 PM today.
    const moved = { ...existingOccurrence("moved-into-pause", "2026-01-02T14:00:00Z", "2026-01-02"),
      moved: true, effectiveStartAt: "2026-01-02T18:00:00Z", effectiveEndAt: "2026-01-02T18:30:00Z" };
    const plan = planOccurrenceGeneration({
      behavior: { ...BASE_BEHAVIOR, pauseFromOn: "2026-01-02", pauseFromTime: "12:00", pauseBackOn: "2026-01-05" },
      existingOccurrences: [moved, existingOccurrence("paused", "2026-01-04T14:00:00Z", "2026-01-04")],
      now: NOW,
      horizonDays: 5,
    });
    expect(plan.create.map(({ localDate }) => localDate)).toEqual(["2026-01-05", "2026-01-06", "2026-01-07"]);
    expect(deleteIds(plan).sort()).toEqual(["moved-into-pause", "paused"]);
  });
});

it("cleans delayed end rows while preserving decisions, notes, and tracked time", () => {
  const row = (id: string) => existingOccurrence(id, "2026-01-04T14:00:00Z", "2026-01-04");
  const plan = planOccurrenceGeneration({
    behavior: { ...BASE_BEHAVIOR, active: false, endOn: "2026-01-03" },
    existingOccurrences: [row("bare"), { ...row("note"), note: "Keep" },
      { ...row("tracked"), hasTimeSessions: true }, { ...row("done"), status: "completed" }],
    now: Temporal.Instant.from("2026-01-08T15:00:00Z"),
  });
  expect(plan.generationWindow.startLocalDate).toBe("2026-01-03");
  expect(plan.create).toEqual([]);
  expect(deleteIds(plan)).toEqual(["bare"]);
});

describe("normalizeOccurrenceScheduleGraph", () => {
  const compatibilitySchedule = {
    id: null,
    recurrenceRule: {
      frequency: "weekly" as const,
      interval: 1,
      daysOfWeek: ["friday" as const],
    },
    timeEntries: [
      {
        id: null,
        scheduleId: null,
        kind: "exact" as const,
        preset: null,
        startTime: "11:30",
        endTime: null,
        sortOrder: 0,
      },
    ],
    sortOrder: 0,
  };

  it("returns a typed repairable result for one legacy-compatible empty schedule", () => {
    const result = normalizeOccurrenceScheduleGraph({
      schedules: [
        {
          ...compatibilitySchedule,
          id: "schedule-empty",
          timeEntries: [],
        },
      ],
      compatibilitySchedule,
    });

    expect(result).toEqual({
      status: "repairable",
      reason: "single_empty_schedule",
      repairedSchedule: {
        ...compatibilitySchedule,
        id: "schedule-empty",
        timeEntries: [
          expect.objectContaining({
            id: null,
            scheduleId: "schedule-empty",
            startTime: "11:30",
          }),
        ],
      },
    });
  });

  it("rejects an ambiguous multi-schedule graph instead of filtering the empty schedule", () => {
    const result = normalizeOccurrenceScheduleGraph({
      schedules: [
        {
          ...compatibilitySchedule,
          id: "schedule-valid",
        },
        {
          ...compatibilitySchedule,
          id: "schedule-empty",
          timeEntries: [],
          sortOrder: 1,
        },
      ],
      compatibilitySchedule,
    });

    expect(result).toEqual({
      status: "invalid",
      reason: "ambiguous_empty_schedule",
    });
  });
});

describe("planOccurrenceRepair", () => {
  it("repairs missing weekly Fridays from the stable local anchor while preserving existing status", () => {
    const behavior: OccurrenceGenerationBehavior = {
      ...BASE_BEHAVIOR,
      recurrenceRule: {
        frequency: "weekly",
        interval: 1,
        daysOfWeek: ["friday"],
      },
      schedules: [
        {
          id: "schedule-friday",
          recurrenceRule: {
            frequency: "weekly",
            interval: 1,
            daysOfWeek: ["friday"],
          },
          timeEntries: [
            {
              id: "slot-friday",
              scheduleId: "schedule-friday",
              kind: "exact",
              preset: null,
              startTime: "11:30",
              endTime: null,
              sortOrder: 0,
            },
          ],
          sortOrder: 0,
          anchorDate: "2026-06-26",
        },
      ],
      scheduleSlots: [],
      createdAt: "2026-06-26T12:00:00Z",
    };
    const completed = {
      ...existingOccurrence(
        "completed-2026-06-26",
        "2026-06-26T15:30:00Z",
        "2026-06-26",
        "completed",
      ),
      scheduleSlotId: "slot-friday",
      scheduleStartTime: "11:30",
    };

    const plan = planOccurrenceRepair({
      behavior,
      existingOccurrences: [completed],
      now: Temporal.Instant.from("2026-07-17T16:00:00Z"),
      repairStartLocalDate: "2026-06-26",
      horizonDays: 0,
    });

    expect(plan.create.map((occurrence) => occurrence.localDate)).toEqual([
      "2026-07-03",
      "2026-07-10",
      "2026-07-17",
    ]);
    expect(plan.updateUnresolved).toEqual([]);
    expect(deleteIds(plan)).toEqual([]);

    const replay = planOccurrenceRepair({
      behavior,
      existingOccurrences: [
        completed,
        ...plan.create.map((occurrence, index) => ({
          id: `repaired-${index}`,
          scheduledFor: occurrence.scheduledFor,
          localDate: occurrence.localDate,
          status: occurrence.status,
          scheduleSlotId: occurrence.scheduleSlotId,
          scheduleKind: occurrence.scheduleKind,
          schedulePreset: occurrence.schedulePreset,
          scheduleStartTime: occurrence.scheduleStartTime,
          scheduleEndTime: occurrence.scheduleEndTime,
          note: null,
          hasTimeSessions: false,
          behaviorConfigurationEventId:
            occurrence.behaviorConfigurationEventId,
        })),
      ],
      now: Temporal.Instant.from("2026-07-17T16:00:00Z"),
      repairStartLocalDate: "2026-06-26",
      horizonDays: 0,
    });

    expect(replay.create).toEqual([]);
  });
});
