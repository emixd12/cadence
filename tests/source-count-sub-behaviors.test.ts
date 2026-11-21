import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";

import type { RecordedActivityV1_1 } from "@cadence/core/types/recorded-activity";
import type { SourceLinkRow } from "@/lib/db/sourceLinks.repo";
import { countUnlinkedWorkout, type CountWorkoutDeps } from "@/lib/services/source-count.service";
import type { ConnectorCaller } from "@/lib/services/connector-credentials";

// A link on a routine's parent covers its sub-behaviors: their workouts are not counted by hand.
const NOW = Temporal.Instant.from("2026-11-12T23:30:00Z");
const OCCURRENCE = "00000000-0000-4000-8000-000000000001";
const REF = `hevy/${"1".repeat(64)}`;
const caller = { user: { id: "user" }, client: {} } as unknown as ConnectorCaller;
const start = Temporal.Instant.from("2026-11-12T23:05:00Z");
const workout: RecordedActivityV1_1 = {
  id: REF, kind: "workout", startAt: start.toString(), endAt: start.add({ minutes: 20 }).toString(),
  duration: { kind: "known", seconds: 1200 }, localStartDate: "2026-11-12",
  revision: { availability: "available", providerUpdatedAt: "2026-11-12T23:10:00Z" },
  fieldAvailability: { location: "unsupported", sourceTimezone: "unsupported" }, selectorKeys: ["b".repeat(64)],
};
const routineLink: SourceLinkRow = { id: "link-routine", user_id: "user", behavior_id: "routine", source: "hevy",
  selector_kind: "provider_keys", selector_keys: ["a".repeat(64)], account_digest: "acct", enabled: true, created_at: "", updated_at: "" };

function deps(parentBehaviorId: string | null): { value: CountWorkoutDeps; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    value: {
      env: { CADENCE_CONNECTOR_COMPLETION: "on" },
      now: () => NOW,
      readOccurrence: async () => ({ id: OCCURRENCE, behaviorId: "stretch", parentBehaviorId, status: "unresolved", localDate: "2026-11-12", timezone: "America/New_York" }),
      listLinks: async () => [routineLink],
      readDay: async () => ({ connected: true, activities: [workout], accountDigest: "acct" }),
      markCompleted: async () => { calls.push("mark"); },
      attach: async () => { calls.push("attach"); return { attached: true, reason: "attached" }; },
    },
  };
}

describe("counting a workout on a sub-behavior", () => {
  it("refuses when the parent Behavior has a link", async () => {
    const { value, calls } = deps("routine");
    await expect(countUnlinkedWorkout(caller, { occurrenceId: OCCURRENCE, source: "hevy", activityRef: REF }, value))
      .resolves.toEqual({ counted: false, reason: "linked" });
    expect(calls).toEqual([]);
  });

  it("counts it when another routine's parent has the link", async () => {
    const { value, calls } = deps("other-routine");
    await expect(countUnlinkedWorkout(caller, { occurrenceId: OCCURRENCE, source: "hevy", activityRef: REF }, value))
      .resolves.toMatchObject({ counted: true });
    expect(calls).toEqual(["mark", "attach"]);
  });
});
