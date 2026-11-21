import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";

import {
  resolveActivityMatches,
  type ActivityMatchLink,
  type ActivityMatchOccurrence,
  type ActivityMatchRecord,
  type ResolveActivityMatchesInput,
} from "../packages/core/src/resolvers/activity-match.resolver";
import type { RecordedActivityV1_1 } from "../packages/core/src/types/recorded-activity";

// Connector completion (D28) on routines: a "Gym routine" parent with Warm-up, Lift and
// Stretch sub-behaviors. Morning slot 12:00Z, evening slot 22:00Z (Stretch only).
const NOW = Temporal.Instant.from("2026-11-10T23:00:00Z");
const TZ = "America/New_York";
const LEGS = "a".repeat(64);
const DAY = "2026-11-10";
const MORNING = "2026-11-10T12:00:00Z";
const EVENING = "2026-11-10T22:00:00Z";

const BEHAVIORS = [
  { id: "routine", timezone: TZ },
  { id: "warmup", timezone: TZ, parentBehaviorId: "routine" },
  { id: "lift", timezone: TZ, parentBehaviorId: "routine" },
  { id: "stretch", timezone: TZ, parentBehaviorId: "routine" },
  { id: "solo", timezone: TZ },
];

function workout(ref: string, startAt: string, minutes = 45, keys: string[] = []): RecordedActivityV1_1 {
  const start = Temporal.Instant.from(startAt);
  return {
    id: `hevy/${ref.padEnd(64, "0")}`,
    kind: "workout",
    startAt: start.toString(),
    endAt: start.add({ minutes }).toString(),
    duration: { kind: "known", seconds: minutes * 60 },
    localStartDate: start.toZonedDateTimeISO(TZ).toPlainDate().toString(),
    revision: { availability: "unavailable", providerUpdatedAt: null },
    fieldAvailability: { location: "unsupported", sourceTimezone: "unsupported" },
    selectorKeys: keys,
  };
}

function link(id: string, behaviorId: string, keys: string[] | "any"): ActivityMatchLink {
  return {
    id, behaviorId, source: "hevy",
    selectorKind: keys === "any" ? "any" : "provider_keys",
    selectorKeys: keys === "any" ? [] : keys,
    accountDigest: "acct", enabled: true,
  };
}

function occurrence(id: string, behaviorId: string, scheduledStartAt: string, overrides: Partial<ActivityMatchOccurrence> = {}): ActivityMatchOccurrence {
  return { id, behaviorId, localDate: DAY, scheduledStartAt, scheduledEndAt: null, status: "unresolved", latestStatusEventId: null, ...overrides };
}

const MORNING_SLOT = [
  occurrence("o-warmup", "warmup", MORNING),
  occurrence("o-lift", "lift", MORNING),
  occurrence("o-stretch-am", "stretch", MORNING),
];
const EVENING_SLOT = [occurrence("o-stretch-pm", "stretch", EVENING)];

function run(overrides: Partial<ResolveActivityMatchesInput>) {
  return resolveActivityMatches({
    source: "hevy", accountDigest: "acct", now: NOW, minimumDurationSeconds: 300,
    links: [link("link-routine", "routine", "any")],
    behaviors: BEHAVIORS,
    occurrences: [...MORNING_SLOT, ...EVENING_SLOT],
    evidence: { activities: [], complete: true, coverageStartAt: "2026-10-11T04:00:00Z", coverageEndAt: "2026-11-11T05:00:00Z", deletedActivityRefs: [] },
    matches: [],
    ...overrides,
  });
}

function evidence(activities: RecordedActivityV1_1[], deletedActivityRefs: string[] = []) {
  return { activities, complete: true, coverageStartAt: "2026-10-11T04:00:00Z", coverageEndAt: "2026-11-11T05:00:00Z", deletedActivityRefs };
}

function completion(id: string, occurrenceId: string, behaviorId: string, activityRef: string, overrides: Partial<ActivityMatchRecord> = {}): ActivityMatchRecord {
  return {
    id, occurrenceId, behaviorId, activityRef, linkId: "link-routine",
    activityStartAt: "2026-11-10T12:10:00Z", activityEndAt: "2026-11-10T12:55:00Z", activityRevision: null,
    role: "completion", state: "active", appliedEventId: `event-${occurrenceId}`, revertedEventId: null,
    ...overrides,
  };
}

describe("connector completion on routines", () => {
  it("completes every Unresolved sub-behavior Occurrence in the nearest slot, under the parent's link", () => {
    const plan = run({ evidence: evidence([workout("am", "2026-11-10T12:10:00Z")]) });
    expect(plan.complete.map((entry) => [entry.occurrenceId, entry.behaviorId, entry.linkId])).toEqual([
      ["o-lift", "lift", "link-routine"],
      ["o-stretch-am", "stretch", "link-routine"],
      ["o-warmup", "warmup", "link-routine"],
    ]);
    expect(plan.attach).toEqual([]);
  });

  it("follows D28 per sub-behavior: attach to Completed, never touch Not Completed or a cleared completion", () => {
    const ref = workout("am", "2026-11-10T12:10:00Z");
    const plan = run({
      occurrences: [
        occurrence("o-warmup", "warmup", MORNING, { status: "completed", latestStatusEventId: "user-1" }),
        occurrence("o-lift", "lift", MORNING, { status: "not_completed", latestStatusEventId: "user-2" }),
        occurrence("o-stretch-am", "stretch", MORNING, { latestStatusEventId: "user-3" }),
        ...EVENING_SLOT,
      ],
      evidence: evidence([ref]),
      // The user cleared an earlier connector completion of Stretch; another workout must not redo it.
      matches: [completion("m-old", "o-stretch-am", "stretch", workout("old", "2026-11-10T11:00:00Z").id, { state: "removed" })],
    });
    expect(plan.complete).toEqual([]);
    expect(plan.attach.map((entry) => [entry.occurrenceId, entry.reason])).toEqual([["o-warmup", "completed_occurrence"]]);
    expect(plan.skip).toEqual(expect.arrayContaining([
      { activityRef: ref.id, behaviorId: "lift", reason: "not_completed" },
      { activityRef: ref.id, behaviorId: "stretch", reason: "user_cleared_connector_completion" },
    ]));
  });

  it("picks the evening slot for an evening workout and leaves the morning slot alone", () => {
    const plan = run({ evidence: evidence([workout("pm", "2026-11-10T21:50:00Z")]) });
    expect(plan.complete.map((entry) => entry.occurrenceId)).toEqual(["o-stretch-pm"]);
  });

  it("completes the parent's own Occurrence only on a day no sub-behavior covers", () => {
    const own = occurrence("o-routine", "routine", MORNING);
    expect(run({ occurrences: [own, ...MORNING_SLOT], evidence: evidence([workout("am", "2026-11-10T12:10:00Z")]) })
      .complete.map((entry) => entry.occurrenceId)).not.toContain("o-routine");
    expect(run({ occurrences: [own], evidence: evidence([workout("am", "2026-11-10T12:10:00Z")]) })
      .complete.map((entry) => [entry.occurrenceId, entry.behaviorId])).toEqual([["o-routine", "routine"]]);
  });

  it("a link on one sub-behavior completes only that sub-behavior", () => {
    const plan = run({ links: [link("link-lift", "lift", [LEGS])], evidence: evidence([workout("am", "2026-11-10T12:10:00Z", 45, [LEGS])]) });
    expect(plan.complete.map((entry) => [entry.occurrenceId, entry.linkId])).toEqual([["o-lift", "link-lift"]]);
  });

  it("writes one match per sub-behavior when its own link and the parent's link both accept a workout", () => {
    const plan = run({
      links: [link("link-routine", "routine", "any"), link("link-lift", "lift", [LEGS])],
      evidence: evidence([workout("am", "2026-11-10T12:10:00Z", 45, [LEGS])]),
    });
    expect(plan.complete.map((entry) => [entry.occurrenceId, entry.linkId])).toEqual([
      ["o-lift", "link-lift"],
      ["o-stretch-am", "link-routine"],
      ["o-warmup", "link-routine"],
    ]);
    expect(plan.attach).toEqual([]);
  });

  it("removes and reverts the routine's completions when the workout is deleted at the source", () => {
    const ref = workout("am", "2026-11-10T12:10:00Z").id;
    const plan = run({
      occurrences: MORNING_SLOT.map((row) => ({ ...row, status: "completed" as const, latestStatusEventId: `event-${row.id}` })),
      evidence: evidence([], [ref]),
      matches: MORNING_SLOT.map((row) => completion(`m-${row.id}`, row.id, row.behaviorId, ref)),
    });
    expect(plan.remove.map((entry) => [entry.occurrenceId, entry.reason, entry.revertsStatus])).toEqual([
      ["o-lift", "deleted_at_source", true],
      ["o-stretch-am", "deleted_at_source", true],
      ["o-warmup", "deleted_at_source", true],
    ]);
  });

  it("removes a sub-behavior match when an edit moves the workout to another slot", () => {
    const moved = workout("am", "2026-11-10T21:55:00Z");
    const plan = run({
      occurrences: [
        occurrence("o-stretch-am", "stretch", MORNING, { status: "completed", latestStatusEventId: "event-o-stretch-am" }),
        ...EVENING_SLOT,
      ],
      evidence: evidence([moved]),
      matches: [completion("m-stretch", "o-stretch-am", "stretch", moved.id)],
    });
    expect(plan.remove).toEqual([{ matchId: "m-stretch", occurrenceId: "o-stretch-am", behaviorId: "stretch", reason: "moved_occurrence", revertsStatus: true }]);
    // Rule 7: the moved workout is not matched to that sub-behavior again.
    expect(plan.complete).toEqual([]);
  });
});
