import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";

import {
  classifyConnectorTiming,
  resolveActivityMatches,
  selectTimingMatch,
  type ActivityMatchLink,
  type ActivityMatchOccurrence,
  type ActivityMatchRecord,
  type ResolveActivityMatchesInput,
} from "../packages/core/src/resolvers/activity-match.resolver";
import type { RecordedActivityV1_1 } from "../packages/core/src/types/recorded-activity";

const NOW = Temporal.Instant.from("2026-11-10T23:00:00Z");
const TZ = "America/New_York";
const LEGS = "a".repeat(64);
const PUSH = "b".repeat(64);
const MIN = 300;

function activity(ref: string, startAt: string, minutes: number, keys: string[] = [], updatedAt: string | null = null): RecordedActivityV1_1 {
  const start = Temporal.Instant.from(startAt);
  const end = start.add({ minutes });
  return {
    id: `hevy/${ref.padEnd(64, "0")}`,
    kind: "workout",
    startAt: start.toString(),
    endAt: end.toString(),
    duration: { kind: "known", seconds: minutes * 60 },
    localStartDate: start.toZonedDateTimeISO(TZ).toPlainDate().toString(),
    revision: updatedAt === null
      ? { availability: "unavailable", providerUpdatedAt: null }
      : { availability: "available", providerUpdatedAt: updatedAt },
    fieldAvailability: { location: "unsupported", sourceTimezone: "unsupported" },
    selectorKeys: keys,
  };
}

function link(id: string, behaviorId: string, keys: string[] | "any"): ActivityMatchLink {
  return {
    id,
    behaviorId,
    source: "hevy",
    selectorKind: keys === "any" ? "any" : "provider_keys",
    selectorKeys: keys === "any" ? [] : keys,
    accountDigest: "acct",
    enabled: true,
  };
}

function occurrence(id: string, behaviorId: string, localDate: string, scheduledStartAt: string, overrides: Partial<ActivityMatchOccurrence> = {}): ActivityMatchOccurrence {
  return {
    id,
    behaviorId,
    localDate,
    scheduledStartAt,
    scheduledEndAt: null,
    status: "unresolved",
    latestStatusEventId: null,
    ...overrides,
  };
}

function match(overrides: Partial<ActivityMatchRecord> & Pick<ActivityMatchRecord, "id" | "occurrenceId" | "behaviorId" | "activityRef">): ActivityMatchRecord {
  return {
    linkId: "link-legs",
    activityStartAt: "2026-11-10T22:00:00Z",
    activityEndAt: "2026-11-10T22:45:00Z",
    activityRevision: null,
    role: "completion",
    state: "active",
    appliedEventId: "event-1",
    revertedEventId: null,
    ...overrides,
  };
}

function run(overrides: Partial<ResolveActivityMatchesInput>) {
  return resolveActivityMatches({
    source: "hevy",
    accountDigest: "acct",
    now: NOW,
    minimumDurationSeconds: MIN,
    links: [link("link-legs", "legday", [LEGS])],
    behaviors: [{ id: "legday", timezone: TZ }, { id: "gym", timezone: TZ }, { id: "gym2", timezone: TZ }],
    occurrences: [],
    evidence: {
      activities: [],
      complete: true,
      coverageStartAt: "2026-10-11T04:00:00Z",
      coverageEndAt: "2026-11-11T05:00:00Z",
      deletedActivityRefs: [],
    },
    matches: [],
    ...overrides,
  });
}

function evidence(activities: RecordedActivityV1_1[], extra: Partial<ResolveActivityMatchesInput["evidence"]> = {}) {
  return {
    activities,
    complete: true,
    coverageStartAt: "2026-10-11T04:00:00Z",
    coverageEndAt: "2026-11-11T05:00:00Z",
    deletedActivityRefs: [],
    ...extra,
  };
}

describe("activity match resolver: assignment", () => {
  it("picks the Occurrence with the nearest scheduled start on that day", () => {
    const plan = run({
      occurrences: [
        occurrence("am", "legday", "2026-11-10", "2026-11-10T12:00:00Z"),
        occurrence("pm", "legday", "2026-11-10", "2026-11-10T22:00:00Z"),
      ],
      evidence: evidence([activity("w1", "2026-11-10T21:30:00Z", 45, [LEGS])]),
    });
    expect(plan.complete.map((entry) => entry.occurrenceId)).toEqual(["pm"]);
    expect(plan.complete[0]).toMatchObject({ reason: "unresolved_occurrence", expectedLatestEventId: null, linkId: "link-legs" });
  });

  it("breaks a distance tie by the earlier scheduled start", () => {
    const plan = run({
      occurrences: [
        occurrence("late", "legday", "2026-11-10", "2026-11-10T20:00:00Z"),
        occurrence("early", "legday", "2026-11-10", "2026-11-10T16:00:00Z"),
      ],
      evidence: evidence([activity("w1", "2026-11-10T18:00:00Z", 45, [LEGS])]),
    });
    expect(plan.complete[0].occurrenceId).toBe("early");
  });

  it("completes a routine-linked Behavior and the any-workout Behavior from one workout (D28.4)", () => {
    const plan = run({
      links: [link("link-legs", "legday", [LEGS]), link("link-any", "gym", "any")],
      occurrences: [
        occurrence("leg-o", "legday", "2026-11-10", "2026-11-10T22:00:00Z"),
        occurrence("gym-o", "gym", "2026-11-10", "2026-11-10T22:00:00Z"),
      ],
      evidence: evidence([activity("w1", "2026-11-10T22:00:00Z", 45, [LEGS])]),
    });
    expect(plan.complete.map((entry) => [entry.behaviorId, entry.occurrenceId]).sort())
      .toEqual([["gym", "gym-o"], ["legday", "leg-o"]]);
  });

  it("skips both links when two of the same kind accept one activity (D28.7)", () => {
    const anyTwice = run({
      links: [link("a1", "gym", "any"), link("a2", "gym2", "any")],
      occurrences: [
        occurrence("g1", "gym", "2026-11-10", "2026-11-10T22:00:00Z"),
        occurrence("g2", "gym2", "2026-11-10", "2026-11-10T22:00:00Z"),
      ],
      evidence: evidence([activity("w1", "2026-11-10T22:00:00Z", 45)]),
    });
    expect(anyTwice.complete).toEqual([]);
    expect(anyTwice.skip.map((entry) => [entry.behaviorId, entry.reason]).sort())
      .toEqual([["gym", "ambiguous_links"], ["gym2", "ambiguous_links"]]);

    const routineTwice = run({
      links: [link("r1", "legday", [LEGS]), link("r2", "gym", [LEGS, PUSH]), link("a1", "gym2", "any")],
      occurrences: [
        occurrence("l", "legday", "2026-11-10", "2026-11-10T22:00:00Z"),
        occurrence("g", "gym", "2026-11-10", "2026-11-10T22:00:00Z"),
        occurrence("g2", "gym2", "2026-11-10", "2026-11-10T22:00:00Z"),
      ],
      evidence: evidence([activity("w1", "2026-11-10T22:00:00Z", 45, [LEGS])]),
    });
    expect(routineTwice.complete.map((entry) => entry.behaviorId)).toEqual(["gym2"]);
    expect(routineTwice.skip.filter((entry) => entry.reason === "ambiguous_links")).toHaveLength(2);
  });

  it("does not let a routine link accept a workout without its routine", () => {
    const plan = run({
      occurrences: [occurrence("l", "legday", "2026-11-10", "2026-11-10T22:00:00Z")],
      evidence: evidence([activity("w1", "2026-11-10T22:00:00Z", 45, [PUSH]), activity("w2", "2026-11-10T23:00:00Z", 45)]),
      now: NOW.add({ hours: 2 }),
    });
    expect(plan.complete).toEqual([]);
    expect(plan.skip.map((entry) => entry.reason)).toEqual(["no_link", "no_link"]);
  });

  it("assigns a 23:30 profile-time workout by the Behavior's timezone", () => {
    // 23:30 in New York on November 9 is November 10 in Berlin.
    const plan = run({
      behaviors: [{ id: "legday", timezone: "Europe/Berlin" }],
      occurrences: [
        occurrence("nov9", "legday", "2026-11-09", "2026-11-09T17:00:00Z"),
        occurrence("nov10", "legday", "2026-11-10", "2026-11-10T07:00:00Z"),
      ],
      evidence: evidence([activity("w1", "2026-11-10T04:30:00Z", 45, [LEGS])]),
    });
    expect(plan.complete.map((entry) => entry.occurrenceId)).toEqual(["nov10"]);
  });

  it("uses local dates across a DST change", () => {
    // November 1, 2026: New York falls back at 06:00Z.
    const plan = run({
      occurrences: [occurrence("nov1", "legday", "2026-11-01", "2026-11-01T05:30:00Z")],
      evidence: evidence([activity("w1", "2026-11-01T05:30:00Z", 60, [LEGS])]),
    });
    expect(plan.complete.map((entry) => entry.occurrenceId)).toEqual(["nov1"]);
  });

  it("matches a workout 30 days back and skips one 31 days back (D28.6)", () => {
    const plan = run({
      occurrences: [
        occurrence("d30", "legday", "2026-10-11", "2026-10-11T22:00:00Z"),
        occurrence("d31", "legday", "2026-10-10", "2026-10-10T22:00:00Z"),
      ],
      evidence: evidence([
        activity("w30", "2026-10-11T22:00:00Z", 45, [LEGS]),
        activity("w31", "2026-10-10T22:00:00Z", 45, [LEGS]),
      ]),
    });
    expect(plan.complete.map((entry) => entry.occurrenceId)).toEqual(["d30"]);
    expect(plan.skip).toContainEqual({ activityRef: activity("w31", "2026-10-10T22:00:00Z", 45).id, behaviorId: "legday", reason: "outside_window" });
  });

  it("writes nothing for an activity with no Occurrence that day, a fenced link or a disabled link", () => {
    const work = activity("w1", "2026-11-10T22:00:00Z", 45, [LEGS]);
    expect(run({ evidence: evidence([work]) }).skip).toEqual([{ activityRef: work.id, behaviorId: "legday", reason: "no_occurrence" }]);
    const occ = [occurrence("l", "legday", "2026-11-10", "2026-11-10T22:00:00Z")];
    expect(run({ accountDigest: "other", occurrences: occ, evidence: evidence([work]) }).complete).toEqual([]);
    expect(run({ links: [{ ...link("x", "legday", [LEGS]), enabled: false }], occurrences: occ, evidence: evidence([work]) }).complete).toEqual([]);
  });
});

describe("activity match resolver: several activities", () => {
  const occurrences = [occurrence("pm", "legday", "2026-11-10", "2026-11-10T23:00:00Z")];
  const morning = activity("am", "2026-11-10T12:00:00Z", 45, [LEGS]);
  const evening = activity("pm", "2026-11-10T23:00:00Z", 45, [LEGS]);
  const later = NOW.add({ hours: 3 });

  it("completes with the first activity by start and attaches the second", () => {
    const plan = run({ now: later, occurrences, evidence: evidence([evening, morning]) });
    expect(plan.complete.map((entry) => entry.activityRef)).toEqual([morning.id]);
    expect(plan.attach.map((entry) => [entry.activityRef, entry.reason])).toEqual([[evening.id, "completed_occurrence"]]);
  });

  it("gives the same plan and timing in either input order", () => {
    const one = run({ now: later, occurrences, evidence: evidence([morning, evening]) });
    const two = run({ now: later, occurrences, evidence: evidence([evening, morning]) });
    expect(two).toEqual(one);
    const timing = selectTimingMatch([...one.complete, ...one.attach].map((entry) => ({ ...entry, state: "active" as const })));
    expect(timing?.activityRef).toBe(evening.id);
    expect(classifyConnectorTiming(timing!)).toEqual({ offsetMinutes: 0, onTime: true });
  });
});

describe("activity match resolver: user marks", () => {
  const work = activity("w1", "2026-11-10T22:00:00Z", 45, [LEGS]);
  const later = activity("w2", "2026-11-10T22:50:00Z", 5, [LEGS]);

  it("attaches to an Occurrence the user marked Completed", () => {
    const plan = run({
      occurrences: [occurrence("l", "legday", "2026-11-10", "2026-11-10T22:00:00Z", { status: "completed", latestStatusEventId: "user-1" })],
      evidence: evidence([work]),
    });
    expect(plan.complete).toEqual([]);
    expect(plan.attach).toMatchObject([{ occurrenceId: "l", reason: "completed_occurrence", matchId: null }]);
  });

  it("writes nothing on a Not Completed Occurrence", () => {
    const plan = run({
      occurrences: [occurrence("l", "legday", "2026-11-10", "2026-11-10T22:00:00Z", { status: "not_completed", latestStatusEventId: "user-1" })],
      evidence: evidence([work]),
    });
    expect(plan.complete).toEqual([]);
    expect(plan.attach).toEqual([]);
    expect(plan.skip).toEqual([{ activityRef: work.id, behaviorId: "legday", reason: "not_completed" }]);
  });

  it("skips a second activity after the user cleared the connector completion", () => {
    const plan = run({
      occurrences: [occurrence("l", "legday", "2026-11-10", "2026-11-10T22:00:00Z", { latestStatusEventId: "user-clear" })],
      evidence: evidence([work, later]),
      matches: [match({ id: "m1", occurrenceId: "l", behaviorId: "legday", activityRef: work.id })],
    });
    expect(plan.complete).toEqual([]);
    expect(plan.skip).toEqual([
      { activityRef: work.id, behaviorId: "legday", reason: "already_matched" },
      { activityRef: later.id, behaviorId: "legday", reason: "user_cleared_connector_completion" },
    ]);
  });
});

describe("activity match resolver: minimum duration (D28.8)", () => {
  it("skips an activity under the minimum and accepts one at it", () => {
    const occ = [occurrence("l", "legday", "2026-11-10", "2026-11-10T22:00:00Z")];
    const short = activity("short", "2026-11-10T22:00:00Z", 4, [LEGS]);
    expect(run({ occurrences: occ, evidence: evidence([short]) }).skip)
      .toEqual([{ activityRef: short.id, behaviorId: "legday", reason: "below_minimum" }]);
    expect(run({ occurrences: occ, evidence: evidence([activity("five", "2026-11-10T22:00:00Z", 5, [LEGS])]) }).complete)
      .toHaveLength(1);
  });
});

describe("activity match resolver: removal", () => {
  const work = activity("w1", "2026-11-10T22:00:00Z", 45, [LEGS]);
  const other = activity("w2", "2026-11-10T20:00:00Z", 45, [LEGS]);
  const completed = occurrence("l", "legday", "2026-11-10", "2026-11-10T22:00:00Z", { status: "completed", latestStatusEventId: "event-1" });
  const completion = match({ id: "m1", occurrenceId: "l", behaviorId: "legday", activityRef: work.id });

  it("plans no removal from an incomplete read", () => {
    const plan = run({ occurrences: [completed], evidence: evidence([], { complete: false }), matches: [completion] });
    expect(plan.remove).toEqual([]);
  });

  it("removes the last match from a complete read and reverts the status", () => {
    const plan = run({ occurrences: [completed], evidence: evidence([]), matches: [completion] });
    expect(plan.remove).toEqual([{ matchId: "m1", occurrenceId: "l", behaviorId: "legday", reason: "absent_from_complete_read", revertsStatus: true }]);
  });

  it("removes one of two matches without a revert", () => {
    const attached = match({ id: "m2", occurrenceId: "l", behaviorId: "legday", activityRef: other.id, role: "attached", appliedEventId: null, activityStartAt: other.startAt, activityEndAt: other.endAt });
    const plan = run({ occurrences: [completed], evidence: evidence([other]), matches: [completion, attached] });
    expect(plan.remove).toEqual([{ matchId: "m1", occurrenceId: "l", behaviorId: "legday", reason: "absent_from_complete_read", revertsStatus: false }]);
    expect(plan.skip).toContainEqual({ activityRef: other.id, behaviorId: "legday", reason: "already_matched" });
  });

  it("removes a match named by a deletion event, even from an incomplete read", () => {
    const plan = run({ occurrences: [completed], evidence: evidence([], { complete: false, deletedActivityRefs: [work.id] }), matches: [completion] });
    expect(plan.remove).toMatchObject([{ matchId: "m1", reason: "deleted_at_source", revertsStatus: true }]);
  });

  it("never removes a workout the user counted by hand (Ticket 324)", () => {
    const counted = match({ id: "m3", occurrenceId: "l", behaviorId: "legday", activityRef: work.id, linkId: "", role: "attached", appliedEventId: null });
    const userMarked = { ...completed, latestStatusEventId: "user-1" };
    expect(run({ occurrences: [userMarked], evidence: evidence([]), matches: [counted] }).remove).toEqual([]);
    expect(run({ occurrences: [userMarked], evidence: evidence([], { complete: false, deletedActivityRefs: [work.id] }), matches: [counted] }).remove).toEqual([]);
    const moved = activity("w1", "2026-11-09T22:00:00Z", 45, [LEGS]);
    expect(run({ occurrences: [userMarked], evidence: evidence([moved]), matches: [counted] }).remove).toEqual([]);
  });

  it("keeps the user's later status when the last match is removed", () => {
    const corrected = { ...completed, latestStatusEventId: "user-2" };
    const plan = run({ occurrences: [corrected], evidence: evidence([]), matches: [completion] });
    expect(plan.remove).toMatchObject([{ matchId: "m1", revertsStatus: false }]);
  });

  it("never removes a match outside the loaded window", () => {
    const plan = run({ occurrences: [], evidence: evidence([], { deletedActivityRefs: [work.id] }), matches: [completion] });
    expect(plan.remove).toEqual([]);
  });

  it("plans a removal only for an edit that moves the activity to another Occurrence", () => {
    const moved = activity("w1", "2026-11-09T22:00:00Z", 45, [LEGS]);
    const plan = run({
      occurrences: [completed, occurrence("y", "legday", "2026-11-09", "2026-11-09T22:00:00Z")],
      evidence: evidence([moved]),
      matches: [completion],
    });
    expect(plan.remove).toEqual([{ matchId: "m1", occurrenceId: "l", behaviorId: "legday", reason: "moved_occurrence", revertsStatus: true }]);
    expect(plan.complete).toEqual([]);
    expect(plan.skip).toContainEqual({ activityRef: moved.id, behaviorId: "legday", reason: "already_matched" });
  });

  it("refreshes timing for an edit that keeps the same Occurrence", () => {
    const edited = activity("w1", "2026-11-10T22:10:00Z", 50, [LEGS], "2026-11-10T23:00:00Z");
    const plan = run({ occurrences: [completed], evidence: evidence([edited]), matches: [completion] });
    expect(plan.remove).toEqual([]);
    expect(plan.attach).toMatchObject([{ reason: "timing_refresh", matchId: "m1", activityStartAt: "2026-11-10T22:10:00Z" }]);
  });

  it("plans no refresh when stored timestamps name the same instants differently", () => {
    const stored = { ...completion, activityStartAt: "2026-11-10T22:00:00+00:00", activityEndAt: "2026-11-10T22:45:00.000000+00:00" };
    const plan = run({ occurrences: [completed], evidence: evidence([work]), matches: [stored] });
    expect(plan.attach).toEqual([]);
    expect(plan.skip).toContainEqual({ activityRef: work.id, behaviorId: "legday", reason: "already_matched" });
  });

  it("does not complete again in the same run after planning a revert", () => {
    const replacement = activity("w3", "2026-11-10T21:00:00Z", 45, [LEGS]);
    const plan = run({ occurrences: [completed], evidence: evidence([replacement]), matches: [completion] });
    expect(plan.remove).toMatchObject([{ revertsStatus: true }]);
    expect(plan.complete).toEqual([]);
    expect(plan.skip).toContainEqual({ activityRef: replacement.id, behaviorId: "legday", reason: "pending_revert" });
  });
});

describe("connector timing classifier", () => {
  it("is on time within 30 minutes of an exact start", () => {
    expect(classifyConnectorTiming({ scheduledStartAt: "2026-11-10T22:00:00Z", scheduledEndAt: null, activityStartAt: "2026-11-10T22:30:00Z" }))
      .toEqual({ offsetMinutes: 30, onTime: true });
    expect(classifyConnectorTiming({ scheduledStartAt: "2026-11-10T22:00:00Z", scheduledEndAt: null, activityStartAt: "2026-11-10T21:29:00Z" }))
      .toEqual({ offsetMinutes: -31, onTime: false });
  });

  it("is on time inside a range", () => {
    const range = { scheduledStartAt: "2026-11-10T22:00:00Z", scheduledEndAt: "2026-11-11T00:00:00Z" };
    expect(classifyConnectorTiming({ ...range, activityStartAt: "2026-11-10T23:40:00Z" })).toEqual({ offsetMinutes: 100, onTime: true });
    expect(classifyConnectorTiming({ ...range, activityStartAt: "2026-11-10T21:50:00Z" }).onTime).toBe(false);
  });
});
