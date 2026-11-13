import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";

import { countableSourceWorkouts } from "@cadence/core/services/timeline-source-evidence";
import type { RecordedActivityV1_1 } from "@cadence/core/types/recorded-activity";
import type { SourceLinkRow } from "@/lib/db/sourceLinks.repo";
import { countUnlinkedWorkout, parseCountWorkoutBody, type CountWorkoutDeps } from "@/lib/services/source-count.service";
import type { ConnectorCaller } from "@/lib/services/connector-credentials";

// Ticket 324: count a logged workout that no link accepted.
const NOW = Temporal.Instant.from("2026-11-12T23:30:00Z"); // 6:30 PM in New York
const OCCURRENCE = "00000000-0000-4000-8000-000000000001";
const REF = `hevy/${"1".repeat(64)}`;
const LEGS = "a".repeat(64);
const caller = { user: { id: "user" }, client: {} } as unknown as ConnectorCaller;

function workout(startAt: string, minutes: number, keys: string[] = [], id = REF): RecordedActivityV1_1 {
  const start = Temporal.Instant.from(startAt);
  return {
    id, kind: "workout", startAt: start.toString(), endAt: start.add({ minutes }).toString(),
    duration: { kind: "known", seconds: minutes * 60 }, localStartDate: "2026-11-12",
    revision: { availability: "available", providerUpdatedAt: "2026-11-12T23:10:00Z" },
    fieldAvailability: { location: "unsupported", sourceTimezone: "unsupported" }, selectorKeys: keys,
  };
}

function link(behaviorId: string, kind: "any" | "provider_keys", keys: string[] = []): SourceLinkRow {
  return { id: `link-${behaviorId}`, user_id: "user", behavior_id: behaviorId, source: "hevy", selector_kind: kind, selector_keys: keys,
    account_digest: "acct", enabled: true, created_at: "", updated_at: "" };
}

function deps(overrides: Partial<CountWorkoutDeps> = {}) {
  const calls: string[] = [];
  const value: CountWorkoutDeps = {
    env: { CADENCE_CONNECTOR_COMPLETION: "on" },
    now: () => NOW,
    readOccurrence: async () => ({ id: OCCURRENCE, behaviorId: "walk", status: "unresolved", localDate: "2026-11-12", timezone: "America/New_York" }),
    listLinks: async () => [],
    readDay: async () => ({ connected: true, activities: [workout("2026-11-12T23:05:00Z", 20)], accountDigest: "acct" }),
    markCompleted: async () => { calls.push("mark"); },
    attach: async () => { calls.push("attach"); return { attached: true, reason: "attached" }; },
    ...overrides,
  };
  return { value, calls };
}

const body = { occurrenceId: OCCURRENCE, source: "hevy", activityRef: REF };

describe("countUnlinkedWorkout", () => {
  it("marks the user's Completed, then attaches the workout", async () => {
    const { value, calls } = deps();
    await expect(countUnlinkedWorkout(caller, body, value)).resolves.toEqual({ counted: true, attached: true, reason: "attached" });
    expect(calls).toEqual(["mark", "attach"]);
  });

  it("refuses while the flag is off", async () => {
    const { value } = deps({ env: {} });
    await expect(countUnlinkedWorkout(caller, body, value)).rejects.toMatchObject({ code: "not_configured" });
  });

  const refusals: Array<[string, Partial<CountWorkoutDeps>, string]> = [
    ["a linked Behavior", { listLinks: async () => [link("walk", "provider_keys", [LEGS])] }, "linked"],
    ["a workout an any-workout link takes", { listLinks: async () => [link("gym", "any")] }, "matched_by_link"],
    ["a workout a routine link takes", {
      listLinks: async () => [link("legs", "provider_keys", [LEGS])],
      readDay: async () => ({ connected: true, activities: [workout("2026-11-12T23:05:00Z", 20, [LEGS])], accountDigest: "acct" }),
    }, "matched_by_link"],
    ["an Occurrence the user already marked", { readOccurrence: async () => ({ id: OCCURRENCE, behaviorId: "walk", status: "not_completed", localDate: "2026-11-12", timezone: "America/New_York" }) }, "not_unresolved"],
    ["an Occurrence on another day", { readOccurrence: async () => ({ id: OCCURRENCE, behaviorId: "walk", status: "unresolved", localDate: "2026-11-11", timezone: "America/New_York" }) }, "not_today"],
    ["a workout Hevy does not list", { readDay: async () => ({ connected: true, activities: [], accountDigest: "acct" }) }, "activity_unavailable"],
    ["a workout under 5 minutes", { readDay: async () => ({ connected: true, activities: [workout("2026-11-12T23:05:00Z", 3)], accountDigest: "acct" }) }, "below_minimum"],
    ["a workout still running", { readDay: async () => ({ connected: true, activities: [workout("2026-11-12T23:20:00Z", 30)], accountDigest: "acct" }) }, "activity_unfinished"],
    ["a disconnected source", { readDay: async () => ({ connected: false, activities: [], accountDigest: null }) }, "not_connected"],
    ["a missing Occurrence", { readOccurrence: async () => null }, "occurrence_unavailable"],
  ];
  it.each(refusals)("refuses %s without writing", async (_name, overrides, reason) => {
    const { value, calls } = deps(overrides);
    await expect(countUnlinkedWorkout(caller, body, value)).resolves.toEqual({ counted: false, reason });
    expect(calls).toEqual([]);
  });

  it("accepts only the exact request shape", () => {
    expect(parseCountWorkoutBody(body)).toEqual(body);
    for (const bad of [null, [], { ...body, extra: 1 }, { ...body, source: "strava" }, { ...body, activityRef: "hevy/abc" },
      { ...body, occurrenceId: "x" }, { ...body, activityRef: `strava/${"1".repeat(64)}` }]) {
      expect(() => parseCountWorkoutBody(bad)).toThrow();
    }
  });
});

describe("countableSourceWorkouts", () => {
  const base = {
    occurrence: { status: "unresolved", localDate: "2026-11-12", sourceCountable: ["hevy"] },
    source: "hevy", todayLocalDate: "2026-11-12", now: NOW, timezone: "America/New_York", minimumDurationSeconds: 300,
    items: [
      { id: REF, startAt: "2026-11-12T23:05:00Z", endAt: "2026-11-12T23:25:00Z", durationSeconds: 1200 },
      { id: `hevy/${"2".repeat(64)}`, startAt: "2026-11-12T22:00:00Z", endAt: "2026-11-12T22:03:00Z", durationSeconds: 180 },
      { id: `hevy/${"3".repeat(64)}`, startAt: "2026-11-12T23:20:00Z", endAt: "2026-11-12T23:50:00Z", durationSeconds: 1800 },
    ],
    matchedStartAts: new Set<string>(),
  };

  it("offers each ended workout of 5 minutes or more", () => {
    expect(countableSourceWorkouts(base)).toEqual([{ activityRef: REF, startAt: "2026-11-12T23:05:00Z", endAt: "2026-11-12T23:25:00Z",
      label: "Count the 6:05 PM Hevy workout" }]);
  });

  it("offers nothing for a workout a row already shows, a marked row, another day or a linked row", () => {
    expect(countableSourceWorkouts({ ...base, matchedStartAts: new Set(["2026-11-12T23:05:00Z"]) })).toEqual([]);
    expect(countableSourceWorkouts({ ...base, occurrence: { ...base.occurrence, status: "completed" } })).toEqual([]);
    expect(countableSourceWorkouts({ ...base, occurrence: { ...base.occurrence, localDate: "2026-11-11" } })).toEqual([]);
    expect(countableSourceWorkouts({ ...base, occurrence: { status: "unresolved", localDate: "2026-11-12" } })).toEqual([]);
  });
});
