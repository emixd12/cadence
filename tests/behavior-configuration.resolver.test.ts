import { describe, expect, it } from "vitest";

import {
  normalizeBehaviorConfiguration,
  planBehaviorConfigurationChangeEvent,
  planInitialBehaviorConfigurationEvent,
} from "@/lib/resolvers/behavior-configuration.resolver";
import type { BehaviorConfigurationSnapshot } from "@/lib/types/behavior-configuration-event";

const RECORDED_AT = "2026-08-14T23:30:00Z";

function dailyConfiguration(
  overrides: Partial<BehaviorConfigurationSnapshot> = {},
): BehaviorConfigurationSnapshot {
  return {
    categoryId: "11111111-1111-4111-8111-111111111111",
    locationText: null,
    scheduleGraph: [
      {
        recurrenceRule: { frequency: "daily", interval: 1 },
        sortOrder: 0,
        timeEntries: [
          {
            kind: "exact",
            preset: null,
            startTime: "09:00",
            endTime: null,
            sortOrder: 0,
          },
        ],
      },
    ],
    browserReminderEnabled: true,
    emailReminderEnabled: false,
    reminderOffsetMinutes: 0,
    active: true,
    timezone: "America/New_York",
    ...overrides,
  };
}

describe("planInitialBehaviorConfigurationEvent", () => {
  it("creates a complete baseline with an effective local date", () => {
    expect(
      planInitialBehaviorConfigurationEvent({
        configuration: dailyConfiguration(),
        recordedAt: RECORDED_AT,
        effectiveAt: RECORDED_AT,
        source: "manual",
        reasonCode: "behavior_created",
      }),
    ).toEqual({
      eventKind: "baseline",
      previousConfiguration: null,
      nextConfiguration: dailyConfiguration({
        whereKind: null,
        end: null,
        pause: null,
        isOpportunity: false,
        parentBehaviorId: null,
        inheritParentSchedule: false,
        alongside: null,
        scheduleGraph: [
          {
            recurrenceRule: { frequency: "daily", interval: 1 },
            sortOrder: 0,
            timeEntries: [
              {
                kind: "exact",
                preset: null,
                startTime: "09:00:00",
                endTime: null,
                sortOrder: 0,
              },
            ],
          },
        ],
      }),
      changedFields: [
        "category_id",
        "location_text",
        "where_kind",
        "schedule_graph",
        "browser_reminder_enabled",
        "email_reminder_enabled",
        "reminder_offset_minutes",
        "active",
        "timezone",
        "end",
        "pause",
        "is_opportunity",
        "parent_behavior_id",
        "inherit_parent_schedule",
        "alongside",
      ],
      recordedAt: RECORDED_AT,
      effectiveAt: RECORDED_AT,
      effectiveLocalDate: "2026-08-14",
      timezone: "America/New_York",
      source: "manual",
      reasonCode: "behavior_created",
    });
  });
});

describe("planBehaviorConfigurationChangeEvent", () => {
  it("captures a daily-to-weekly schedule revision", () => {
    const previousConfiguration = dailyConfiguration();
    const nextConfiguration = dailyConfiguration({
      scheduleGraph: [
        {
          recurrenceRule: {
            frequency: "weekly",
            interval: 1,
            daysOfWeek: ["monday"],
          },
          sortOrder: 0,
          timeEntries: [
            {
              kind: "exact",
              preset: null,
              startTime: "09:00",
              endTime: null,
              sortOrder: 0,
            },
          ],
        },
      ],
    });

    expect(
      planBehaviorConfigurationChangeEvent({
        previousConfiguration,
        nextConfiguration,
        recordedAt: RECORDED_AT,
        effectiveAt: RECORDED_AT,
        source: "manual",
        reasonCode: "behavior_edited",
      }),
    ).toMatchObject({
      eventKind: "revision",
      changedFields: ["schedule_graph"],
      previousConfiguration: normalizeBehaviorConfiguration(
        previousConfiguration,
      ),
      nextConfiguration: normalizeBehaviorConfiguration(nextConfiguration),
      effectiveLocalDate: "2026-08-14",
    });
  });

  it.each([
    ["category_id", { categoryId: null }],
    ["browser_reminder_enabled", { browserReminderEnabled: false }],
    ["email_reminder_enabled", { emailReminderEnabled: true }],
    ["reminder_offset_minutes", { reminderOffsetMinutes: 1_440 }],
    ["active", { active: false }],
    ["timezone", { timezone: "America/Los_Angeles" }],
    ["where_kind", { whereKind: "anywhere" }],
  ] as const)("identifies a %s revision", (changedField, override) => {
    expect(
      planBehaviorConfigurationChangeEvent({
        previousConfiguration: dailyConfiguration(),
        nextConfiguration: dailyConfiguration(override),
        recordedAt: RECORDED_AT,
        effectiveAt: RECORDED_AT,
        source: "manual",
        reasonCode: "behavior_edited",
      }),
    ).toMatchObject({ changedFields: [changedField] });
  });

  it("records a place as both Where and place text (Ticket 215)", () => {
    expect(
      planBehaviorConfigurationChangeEvent({
        previousConfiguration: dailyConfiguration({ whereKind: "home" }),
        nextConfiguration: dailyConfiguration({ whereKind: "place", locationText: " 1 Example Street " }),
        recordedAt: RECORDED_AT,
        effectiveAt: RECORDED_AT,
        source: "manual",
        reasonCode: "behavior_edited",
      }),
    ).toMatchObject({
      changedFields: ["location_text", "where_kind"],
      nextConfiguration: { whereKind: "place", locationText: "1 Example Street" },
    });
  });

  it("reads a pre-Where snapshot with location text as A place (Ticket 215)", () => {
    const legacy = { ...dailyConfiguration({ locationText: "1 Example Street" }) };
    delete legacy.whereKind;
    expect(normalizeBehaviorConfiguration(legacy)).toMatchObject({ whereKind: "place", locationText: "1 Example Street" });
    expect(
      planBehaviorConfigurationChangeEvent({
        previousConfiguration: legacy,
        nextConfiguration: dailyConfiguration({ whereKind: "place", locationText: "1 Example Street" }),
        recordedAt: RECORDED_AT,
        effectiveAt: RECORDED_AT,
        source: "manual",
        reasonCode: "behavior_edited",
      }),
    ).toBeNull();
    const unlocated = { ...dailyConfiguration() };
    delete unlocated.whereKind;
    expect(normalizeBehaviorConfiguration(unlocated).whereKind).toBeNull();
  });

  it("returns null for a normalized no-op", () => {
    expect(
      planBehaviorConfigurationChangeEvent({
        previousConfiguration: dailyConfiguration(),
        nextConfiguration: dailyConfiguration({
          categoryId: " 11111111-1111-4111-8111-111111111111 ",
          scheduleGraph: [
            {
              id: "22222222-2222-4222-8222-222222222222",
              recurrenceRule: { interval: 1, frequency: "daily" },
              sortOrder: 0,
              timeEntries: [
                {
                  id: "33333333-3333-4333-8333-333333333333",
                  kind: "exact",
                  preset: null,
                  startTime: "09:00:00",
                  endTime: null,
                  sortOrder: 0,
                },
              ],
            },
          ],
        }),
        recordedAt: RECORDED_AT,
        effectiveAt: RECORDED_AT,
        source: "manual",
        reasonCode: "behavior_edited",
      }),
    ).toBeNull();
  });

  it("uses the next timezone to derive the effective local date", () => {
    expect(
      planBehaviorConfigurationChangeEvent({
        previousConfiguration: dailyConfiguration(),
        nextConfiguration: dailyConfiguration({
          timezone: "Pacific/Honolulu",
        }),
        recordedAt: RECORDED_AT,
        effectiveAt: RECORDED_AT,
        source: "system",
        reasonCode: "timezone_changed",
      }),
    ).toMatchObject({
      effectiveLocalDate: "2026-08-14",
      timezone: "Pacific/Honolulu",
    });
  });

  it("preserves stored timezone aliases and records alias normalization", () => {
    expect(
      planBehaviorConfigurationChangeEvent({
        previousConfiguration: dailyConfiguration({ timezone: "US/Eastern" }),
        nextConfiguration: dailyConfiguration({ timezone: "America/New_York" }),
        recordedAt: RECORDED_AT,
        effectiveAt: RECORDED_AT,
        source: "system",
        reasonCode: "timezone_changed",
      }),
    ).toMatchObject({
      changedFields: ["timezone"],
      previousConfiguration: { timezone: "US/Eastern" },
      nextConfiguration: { timezone: "America/New_York" },
    });
  });
});

describe("Behaviors of Opportunity configuration", () => {
  const plan = (previous: Partial<BehaviorConfigurationSnapshot>, next: Partial<BehaviorConfigurationSnapshot>) =>
    planBehaviorConfigurationChangeEvent({
      previousConfiguration: dailyConfiguration(previous),
      nextConfiguration: dailyConfiguration(next),
      recordedAt: RECORDED_AT, effectiveAt: RECORDED_AT, source: "manual", reasonCode: "behavior_updated",
    });

  it("reads a snapshot without the flag as not an opportunity Behavior", () => {
    expect(normalizeBehaviorConfiguration(dailyConfiguration()).isOpportunity).toBe(false);
    expect(plan({}, { isOpportunity: false })).toBeNull();
  });

  it("lists is_opportunity last, after pause, as the hosted snapshot builder does", () => {
    const event = plan({ pause: null }, {
      isOpportunity: true, pause: { fromOn: "2026-08-20", fromTime: null, backOn: "2026-08-25" },
    });
    expect(event?.changedFields).toEqual(["pause", "is_opportunity"]);
    expect(event?.nextConfiguration.isOpportunity).toBe(true);
  });

  it("puts is_opportunity after pause in a baseline", () => {
    const baseline = planInitialBehaviorConfigurationEvent({
      configuration: dailyConfiguration({ isOpportunity: true, scheduleGraph: [] }),
      recordedAt: RECORDED_AT, effectiveAt: RECORDED_AT, source: "manual", reasonCode: "behavior_created",
    });
    // Sub-behavior link fields (Ticket 349) follow is_opportunity; the alongside answer (Ticket 363) comes last.
    expect(baseline.changedFields.slice(-5)).toEqual(["pause", "is_opportunity", "parent_behavior_id", "inherit_parent_schedule", "alongside"]);
    expect(baseline.nextConfiguration).toMatchObject({ isOpportunity: true, scheduleGraph: [] });
  });
});

describe("alongside configuration (Ticket 363)", () => {
  const plan = (previous: Partial<BehaviorConfigurationSnapshot>, next: Partial<BehaviorConfigurationSnapshot>) =>
    planBehaviorConfigurationChangeEvent({
      previousConfiguration: dailyConfiguration(previous),
      nextConfiguration: dailyConfiguration(next),
      recordedAt: RECORDED_AT, effectiveAt: RECORDED_AT, source: "manual", reasonCode: "alongside_answered",
    });

  it("records a changed answer as its own field and reads an older snapshot as unanswered", () => {
    const answered = plan({}, { alongside: true });
    expect(answered?.changedFields).toEqual(["alongside"]);
    expect(answered?.previousConfiguration?.alongside).toBeNull();
    expect(answered?.nextConfiguration.alongside).toBe(true);
    expect(plan({ alongside: true }, { alongside: false })?.changedFields).toEqual(["alongside"]);
    expect(plan({ alongside: false }, { alongside: null })?.changedFields).toEqual(["alongside"]);
    // A snapshot written before the field existed (no key) is unanswered: no change against null.
    expect(plan({}, { alongside: null })).toBeNull();
  });
});
