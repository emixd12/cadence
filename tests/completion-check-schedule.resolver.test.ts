import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";

import {
  COMPLETION_CHECK_DAILY_LIMIT,
  firstRunAfter,
  lastRunBefore,
  resolveCompletionCheckSchedule,
  type CompletionCheckScheduleInput,
} from "../packages/core/src/resolvers/completion-check-schedule.resolver";

const TZ = "America/New_York";
// 18:00 New York on November 10, 2026 is 23:00Z.
const START = "2026-11-10T23:00:00Z";

function schedule(overrides: Partial<CompletionCheckScheduleInput> = {}) {
  return resolveCompletionCheckSchedule({
    now: Temporal.Instant.from("2026-11-10T20:00:00Z"),
    timezone: TZ,
    strategy: "cheap",
    occurrences: [],
    checksToday: 0,
    consecutiveFailures: 0,
    lastAttemptAt: null,
    reconnectRequired: false,
    ...overrides,
  });
}

describe("completion check schedule (Ticket 321, D28.5)", () => {
  it("places runs at minutes 7, 22, 37 and 52", () => {
    expect(lastRunBefore(Temporal.Instant.from("2026-11-10T22:45:00Z"))?.toString()).toBe("2026-11-10T22:37:00Z");
    expect(lastRunBefore(Temporal.Instant.from("2026-11-10T22:07:00Z"))?.toString()).toBe("2026-11-10T21:52:00Z");
    expect(firstRunAfter(Temporal.Instant.from("2026-11-11T05:00:00Z")).toString()).toBe("2026-11-11T05:07:00Z");
    expect(firstRunAfter(Temporal.Instant.from("2026-11-11T05:53:00Z")).toString()).toBe("2026-11-11T06:07:00Z");
  });

  it("checks once at the last run before a reminder", () => {
    const result = schedule({ occurrences: [{ scheduledStartAt: START, reminderAt: ["2026-11-10T22:45:00Z"] }] });
    expect(result).toEqual({ nextCheckAt: "2026-11-10T22:37:00Z", reason: "before_reminder" });
  });

  it("checks every 30 minutes for 3 hours after the start, then hourly until local midnight", () => {
    const occurrences = [{ scheduledStartAt: START, reminderAt: [] }];
    const at = (now: string) => schedule({ now: Temporal.Instant.from(now), occurrences }).nextCheckAt;
    expect(at("2026-11-10T23:00:00Z")).toBe("2026-11-10T23:30:00Z");
    expect(at("2026-11-11T01:30:00Z")).toBe("2026-11-11T02:00:00Z");
    expect(at("2026-11-11T02:00:00Z")).toBe("2026-11-11T03:00:00Z");
    expect(at("2026-11-11T03:00:00Z")).toBe("2026-11-11T04:00:00Z");
    // Local midnight is 05:00Z; the hourly 05:00Z check gives way to the nightly run.
    expect(schedule({ now: Temporal.Instant.from("2026-11-11T04:00:00Z"), occurrences }))
      .toEqual({ nextCheckAt: "2026-11-11T05:07:00Z", reason: "nightly" });
  });

  it("schedules nothing for a resolved Occurrence, leaving one nightly check", () => {
    expect(schedule({ occurrences: [] })).toEqual({ nextCheckAt: "2026-11-11T05:07:00Z", reason: "nightly" });
  });

  it("keeps only the reminder and nightly checks under a full scan", () => {
    const occurrences = [{ scheduledStartAt: START, reminderAt: ["2026-11-10T22:45:00Z"] }];
    expect(schedule({ strategy: "full_scan", occurrences, now: Temporal.Instant.from("2026-11-10T22:40:00Z") }))
      .toEqual({ nextCheckAt: "2026-11-11T05:07:00Z", reason: "nightly" });
  });

  it("stops at 24 checks a day until the nightly check", () => {
    const occurrences = [{ scheduledStartAt: START, reminderAt: ["2026-11-10T22:45:00Z"] }];
    expect(schedule({ occurrences, checksToday: COMPLETION_CHECK_DAILY_LIMIT }))
      .toEqual({ nextCheckAt: "2026-11-11T05:07:00Z", reason: "nightly" });
  });

  it("doubles the wait after failed checks, up to 6 hours", () => {
    const occurrences = [{ scheduledStartAt: START, reminderAt: [] }];
    const now = Temporal.Instant.from("2026-11-10T23:01:00Z");
    const lastAttemptAt = "2026-11-10T23:00:00Z";
    expect(schedule({ now, occurrences, consecutiveFailures: 1, lastAttemptAt }).nextCheckAt).toBe("2026-11-10T23:30:00Z");
    expect(schedule({ now, occurrences, consecutiveFailures: 3, lastAttemptAt }).nextCheckAt).toBe("2026-11-11T00:00:00Z");
    expect(schedule({ now, occurrences, consecutiveFailures: 5, lastAttemptAt }).nextCheckAt).toBe("2026-11-11T03:00:00Z");
    // The wait is capped at 6 hours.
    expect(schedule({ now, occurrences, consecutiveFailures: 20, lastAttemptAt }).nextCheckAt).toBe("2026-11-11T05:00:00Z");
    expect(schedule({ now, occurrences: [], consecutiveFailures: 20, lastAttemptAt }).nextCheckAt).toBe("2026-11-11T05:07:00Z");
  });

  it("stops checks while the source needs reconnecting", () => {
    expect(schedule({ reconnectRequired: true })).toEqual({ nextCheckAt: null, reason: null });
  });
});
