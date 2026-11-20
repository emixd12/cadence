import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";

import { resolveDayLoad } from "@cadence/core/resolvers/day-load.resolver";
import type { BehaviorDurationEstimate, NormalizedExternalEvent } from "@cadence/core/types/day-progress";
import { computeDayLoad, type DayLoadReads } from "@/lib/services/day-load.service";

const TZ = "America/New_York";
const now = Temporal.Instant.from("2026-11-19T18:13:00Z");

describe("day load (advisor plan 4G)", () => {
  const known = (seconds: number, provenance: "behavior_default" | "completed_stopped_occurrence_mean"): BehaviorDurationEstimate =>
    ({ kind: "known", seconds, durationLabel: "", sampleCount: 3, lookbackDays: 90, provenance });
  const timed = (id: string, start: string, end: string, extra: Partial<Record<string, unknown>> = {}) => ({
    kind: "timed", id, logicalInstanceId: id, source: "google_calendar", startAt: start, endAt: end, endUnspecified: false,
    duration: { kind: "known", seconds: 0 }, state: "confirmed", currentUserResponse: "accepted", ...extra,
  }) as unknown as NormalizedExternalEvent;

  it("matches a hand-checked day and leaves out a Behavior with no length", () => {
    const load = resolveDayLoad({
      localDate: "2026-11-19", timezone: TZ,
      items: [{ behaviorId: "gym" }, { behaviorId: "read" }, { behaviorId: "walk" }, { behaviorId: "gym" }],
      lengths: new Map([
        ["gym", known(45 * 60, "behavior_default")],
        ["read", known(20 * 60, "completed_stopped_occurrence_mean")],
        // A model's guess never counts.
        ["walk", { kind: "known", seconds: 30 * 60, durationLabel: "", sampleCount: 0, lookbackDays: 90, provenance: "description_estimate" } as unknown as BehaviorDurationEstimate],
      ]),
      calendarEvents: [
        timed("a", "2026-11-19T14:00:00Z", "2026-11-19T15:00:00Z"), // 9-10 AM
        timed("b", "2026-11-19T14:30:00Z", "2026-11-19T15:30:00Z"), // overlaps: union 9-10:30
        timed("a", "2026-11-19T14:00:00Z", "2026-11-19T15:00:00Z"), // same event twice
        timed("c", "2026-11-20T04:00:00Z", "2026-11-20T06:00:00Z"), // 11 PM-1 AM: 60 min on this day
        timed("d", "2026-11-19T18:00:00Z", "2026-11-19T19:00:00Z", { currentUserResponse: "declined" }),
        timed("e", "2026-11-19T18:00:00Z", "2026-11-19T19:00:00Z", { endUnspecified: true }),
        { kind: "all_day", id: "f", startLocalDate: "2026-11-19", endLocalDate: "2026-11-20" } as unknown as NormalizedExternalEvent,
      ],
    });
    expect(load).toEqual({ localDate: "2026-11-19", calendarMinutes: 150, calendarEvents: 3, itemMinutes: 110, itemsCounted: 3, itemsNoLength: 1 });
  });

  it("reads no calendar when the source is off and uses a logged average, never the 30-minute default", async () => {
    let calendarRead = false;
    const session = (id: string, occurrenceId: string, minutes: number) => ({ id, user_id: "u", occurrence_id: occurrenceId, behavior_id: "read",
      started_at: "2026-11-10T12:00:00Z", stopped_at: Temporal.Instant.from("2026-11-10T12:00:00Z").add({ minutes }).toString() });
    const reads: DayLoadReads = {
      behaviors: async () => [{ id: "read", default_duration_minutes: null }, { id: "walk", default_duration_minutes: null }],
      occurrences: async (start) => start === "2026-11-19"
        ? [{ id: "t1", behavior_id: "read", local_date: "2026-11-19", status: "unresolved" }, { id: "t2", behavior_id: "walk", local_date: "2026-11-19", status: "unresolved" }]
        : ["h1", "h2", "h3"].map((id) => ({ id, behavior_id: "read", local_date: "2026-11-10", status: "completed" })),
      sessions: async () => [session("s1", "h1", 10), session("s2", "h2", 20), session("s3", "h3", 30)],
      calendarEvents: async () => { calendarRead = true; return []; },
    };
    const load = await computeDayLoad(reads, { localDate: "2026-11-19", timezone: TZ, now, calendarSourceOn: false });
    expect(calendarRead).toBe(false);
    expect(load).toEqual({ localDate: "2026-11-19", calendarMinutes: null, calendarEvents: null, itemMinutes: 20, itemsCounted: 1, itemsNoLength: 1 });
    const failing = await computeDayLoad({ ...reads, calendarEvents: async () => { throw new Error("down"); } },
      { localDate: "2026-11-19", timezone: TZ, now, calendarSourceOn: true });
    expect(failing.calendarMinutes).toBeNull();
  });
});
