import { describe, expect, it } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import {
  isUnlinkedAccountInactive,
  resolveUnlinkedDailySyncSchedule,
  UNLINKED_SYNC_INACTIVITY_DAYS,
} from "@cadence/core/resolvers/completion-check-schedule.resolver";
import { toUpsertInput } from "@/lib/services/recorded-activity-sync.service";

describe("unlinked Hevy daily sync schedule & inactivity guardrail (Ticket 353)", () => {
  it("schedules next daily sync at 05:30 local (snapped to cron minute) ahead of morning Brief", () => {
    const now = Temporal.Instant.from("2026-11-24T15:00:00Z"); // 10:00 EST
    const result = resolveUnlinkedDailySyncSchedule({
      now,
      timezone: "America/New_York",
      consecutiveFailures: 0,
      lastAttemptAt: null,
      lastUserActivityAt: "2026-11-24T14:00:00Z",
      reconnectRequired: false,
    });
    expect(result.pausedForInactivity).toBe(false);
    // 2026-11-25 05:30 EST = 2026-11-25T10:30:00Z -> next cron minute is :37
    expect(result.nextCheckAt).toBe("2026-11-25T10:37:00Z");
  });

  it("pauses unlinked daily sync after 21 days of no Cadence activity", () => {
    const now = Temporal.Instant.from("2026-11-24T15:00:00Z");
    const inactiveAt = now.subtract({ hours: UNLINKED_SYNC_INACTIVITY_DAYS * 24 + 1 }).toString();
    expect(isUnlinkedAccountInactive(now, inactiveAt)).toBe(true);
    const result = resolveUnlinkedDailySyncSchedule({
      now,
      timezone: "America/New_York",
      consecutiveFailures: 0,
      lastAttemptAt: null,
      lastUserActivityAt: inactiveAt,
      reconnectRequired: false,
    });
    expect(result).toEqual({ nextCheckAt: null, pausedForInactivity: true });
  });

  it("stops scheduling when reconnect is required", () => {
    const result = resolveUnlinkedDailySyncSchedule({
      now: Temporal.Instant.from("2026-11-24T15:00:00Z"),
      timezone: "America/New_York",
      consecutiveFailures: 0,
      lastAttemptAt: null,
      lastUserActivityAt: "2026-11-24T14:00:00Z",
      reconnectRequired: true,
    });
    expect(result).toEqual({ nextCheckAt: null, pausedForInactivity: false });
  });
});

describe("recorded_activities upsert projection (Ticket 352)", () => {
  it("maps RecordedActivityV1_1 to minimized ledger row with no title or raw IDs", () => {
    const digest = "a".repeat(64);
    const selector = "b".repeat(64);
    const row = toUpsertInput(
      "hevy",
      {
        id: `hevy/${"c".repeat(64)}`,
        kind: "workout",
        startAt: "2026-11-24T12:00:00Z",
        endAt: "2026-11-24T12:45:00Z",
        duration: { kind: "known", seconds: 2700 },
        localStartDate: "2026-11-24",
        revision: { availability: "available", providerUpdatedAt: "2026-11-24T12:46:00Z" },
        fieldAvailability: { location: "unsupported", sourceTimezone: "unsupported" },
        selectorKeys: [selector],
      },
      digest,
      3,
      "2026-11-24T13:00:00Z",
    );
    expect(row).toEqual({
      source: "hevy",
      activity_ref: `hevy/${"c".repeat(64)}`,
      kind: "workout",
      start_at: "2026-11-24T12:00:00Z",
      end_at: "2026-11-24T12:45:00Z",
      local_start_date: "2026-11-24",
      duration_seconds: 2700,
      selector_digest: selector,
      provider_updated_at: "2026-11-24T12:46:00Z",
      state: "active",
      account_digest: digest,
      connection_generation: 3,
      synced_at: "2026-11-24T13:00:00Z",
    });
  });
});
