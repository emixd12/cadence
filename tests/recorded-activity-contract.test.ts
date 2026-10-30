import { readFile } from "node:fs/promises";

import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";

import { projectAdvisorActivityConnector } from "../packages/core/src/services/advisor-day-context";
import {
  RecordedActivityValidationError,
  normalizeRecordedWorkout,
  recordedActivityId,
  recordedActivitySnapshotMatchesScope,
  recordedActivitySnapshotScopeKey,
  validateRecordedActivitySnapshot,
} from "../packages/core/src/services/recorded-activity-validation";
import {
  HEVY_WORKOUTS_ADAPTER_VERSION,
  RECORDED_ACTIVITY_SCHEMA_VERSION,
  type RecordedActivitySnapshotScope,
} from "../packages/core/src/types/recorded-activity";

const fixtureUrl = new URL("./fixtures/recorded-activity-snapshot.valid.json", import.meta.url);
const schemaUrl = new URL("../packages/core/src/recorded-activity.schema.json", import.meta.url);
const now = Temporal.Instant.from("2026-11-01T15:00:00Z");
const context = {
  accountId: "account-1",
  requestedRange: { startLocalDate: "2026-10-02", endLocalDate: "2026-11-01", timezone: "America/New_York" },
  fetchedAt: "2026-11-01T15:00:00Z",
};
const opaque = (kind: string, value: string) => `${kind}:${value.length}`;

async function fixture() {
  return JSON.parse(await readFile(fixtureUrl, "utf8"));
}

function workout(startTime: unknown, endTime: unknown, extra: Partial<Record<"providerWorkoutId" | "updatedAt", unknown>> = {}) {
  return normalizeRecordedWorkout({
    providerWorkoutId: "workout-1",
    startTime,
    endTime,
    updatedAt: null,
    ...extra,
  }, context);
}

describe("recorded activity normalization", () => {
  it("derives 2,700 seconds for a 45-minute workout from provider instants", () => {
    const result = workout("2026-10-30T18:00:00-04:00", "2026-10-30T18:45:00-04:00", { updatedAt: "2026-10-30T23:00:00Z" });
    expect(result).toEqual({
      status: "accepted",
      activity: {
        id: recordedActivityId({ accountId: "account-1", providerWorkoutId: "workout-1" }),
        kind: "workout",
        startAt: "2026-10-30T22:00:00Z",
        endAt: "2026-10-30T22:45:00Z",
        duration: { kind: "known", seconds: 2_700 },
        localStartDate: "2026-10-30",
        revision: { availability: "available", providerUpdatedAt: "2026-10-30T23:00:00Z" },
        fieldAvailability: { location: "unsupported", sourceTimezone: "unsupported" },
      },
    });
  });

  it("uses elapsed instants across midnight and both DST transitions", () => {
    const overnight = workout("2026-10-31T03:30:00Z", "2026-10-31T04:30:00Z");
    expect(overnight).toMatchObject({ activity: { duration: { seconds: 3_600 }, localStartDate: "2026-10-30" } });

    const fallBack = workout("2026-11-01T01:30:00-04:00", "2026-11-01T01:30:00-05:00");
    expect(fallBack).toMatchObject({ activity: { duration: { seconds: 3_600 }, localStartDate: "2026-11-01" } });

    const springForward = normalizeRecordedWorkout(
      { providerWorkoutId: "spring", startTime: "2026-03-08T01:30:00-05:00", endTime: "2026-03-08T03:30:00-04:00", updatedAt: null },
      { ...context, requestedRange: { ...context.requestedRange, startLocalDate: "2026-03-01", endLocalDate: "2026-03-31" } },
    );
    expect(springForward).toMatchObject({ activity: { duration: { seconds: 3_600 }, localStartDate: "2026-03-08" } });
  });

  it("quarantines unknown, malformed, reversed, and future intervals instead of claiming workouts", () => {
    expect(workout("2026-10-30T22:00:00Z", null)).toEqual({ status: "quarantined", reason: "end_unknown" });
    expect(workout("2026-10-30T22:00:00Z", undefined)).toEqual({ status: "quarantined", reason: "end_unknown" });
    expect(workout("2026-10-30 22:00", "2026-10-30T22:45:00Z")).toEqual({ status: "quarantined", reason: "malformed_start" });
    expect(workout("2026-10-30T22:00:00", "2026-10-30T22:45:00Z")).toEqual({ status: "quarantined", reason: "malformed_start" });
    expect(workout("2026-10-30T22:00:00Z", 1_700_000_000)).toEqual({ status: "quarantined", reason: "malformed_end" });
    expect(workout("2026-10-30T22:45:00Z", "2026-10-30T22:00:00Z")).toEqual({ status: "quarantined", reason: "reversed_interval" });
    expect(workout("2026-10-30T22:00:00Z", "2026-10-30T22:00:00Z")).toEqual({ status: "quarantined", reason: "reversed_interval" });
    expect(workout("2026-11-01T14:30:00Z", "2026-11-01T15:30:00Z")).toEqual({ status: "quarantined", reason: "future_interval" });
    expect(workout("2026-10-30T22:00:00Z", "2026-10-30T22:45:00Z", { providerWorkoutId: "" }))
      .toEqual({ status: "quarantined", reason: "missing_identity" });
    expect(workout("2026-10-30T22:00:00Z", "2026-10-30T22:45:00Z", { updatedAt: "yesterday" }))
      .toEqual({ status: "quarantined", reason: "malformed_revision" });
    expect(workout("2026-09-01T22:00:00Z", "2026-09-01T22:45:00Z")).toEqual({ status: "outside_range" });
    expect(workout("2026-10-02T03:30:00Z", "2026-10-02T04:30:00Z")).toMatchObject({ status: "accepted" });
  });

  it("derives opaque account-scoped IDs that do not expose the provider ID", () => {
    const id = recordedActivityId({ accountId: "account-1", providerWorkoutId: "workout-1" });
    expect(id).toMatch(/^hevy\/[0-9a-f]{64}$/u);
    expect(id).not.toContain("workout-1");
    expect(recordedActivityId({ accountId: "account-2", providerWorkoutId: "workout-1" })).not.toBe(id);
  });
});

describe("recorded activity snapshot contract", () => {
  it("validates the fixture with an injected clock and keeps calendar semantics out", async () => {
    const value = await fixture();
    const snapshot = validateRecordedActivitySnapshot(value, { now });
    expect(snapshot.schemaVersion).toBe(RECORDED_ACTIVITY_SCHEMA_VERSION);
    expect(snapshot.adapterVersion).toBe(HEVY_WORKOUTS_ADAPTER_VERSION);
    expect(snapshot.activities.map((activity) => activity.duration.seconds)).toEqual([2_700, 3_600, 3_600]);
    for (const activity of snapshot.activities) {
      for (const key of ["availability", "state", "status", "currentUserResponse", "title", "location", "providerWorkoutId"]) {
        expect(activity).not.toHaveProperty(key);
      }
    }
    expect(() => validateRecordedActivitySnapshot(value, { now: now.subtract({ seconds: 1 }) }))
      .toThrow("fetchedAt: cannot be in the future");
  });

  it("rejects excluded Hevy fields, inferred location, and raw provider IDs", async () => {
    const value = await fixture();
    const [first] = value.activities;
    for (const extra of [{ title: "Push day" }, { exercises: [] }, { notes: "felt good" }, { routineId: "r1" }]) {
      expect(() => validateRecordedActivitySnapshot({ ...value, activities: [{ ...first, ...extra }] }, { now }))
        .toThrow("must contain exactly");
    }
    expect(() => validateRecordedActivitySnapshot({ ...value, title: "Push day" }, { now })).toThrow("must contain exactly");
    expect(() => validateRecordedActivitySnapshot({
      ...value, activities: [{ ...first, fieldAvailability: { location: "available", sourceTimezone: "unsupported" } }],
    }, { now })).toThrow("fieldAvailability.location");
    expect(() => validateRecordedActivitySnapshot({ ...value, activities: [{ ...first, id: "hevy/workout-45" }] }, { now }))
      .toThrow("opaque");
  });

  it("rejects unknown, wall-clock, reversed, future, and out-of-range intervals", async () => {
    const value = await fixture();
    const [first, overnight, dst] = value.activities;
    const invalid: Array<[unknown, string]> = [
      [{ ...first, duration: { kind: "unknown", reason: "end_unspecified" } }, "duration"],
      [{ ...first, duration: { kind: "known", seconds: 2_699 } }, "duration.seconds"],
      [{ ...dst, duration: { kind: "known", seconds: 0 } }, "duration.seconds"],
      [{ ...first, startAt: first.endAt, endAt: first.startAt, duration: { kind: "known", seconds: 2_700 } }, "endAt"],
      [{ ...first, endAt: "2026-11-01T15:30:00Z", startAt: "2026-11-01T14:45:00Z", localStartDate: "2026-11-01" }, "endAt"],
      [{ ...first, startAt: "2026-09-01T22:00:00Z", endAt: "2026-09-01T22:45:00Z", localStartDate: "2026-09-01" }, "requested local days"],
      [{ ...overnight, localStartDate: "2026-10-31" }, "localStartDate"],
      [{ ...first, startAt: "2026-10-30T18:00:00-04:00" }, "canonical UTC"],
      [{ ...first, revision: { availability: "available", providerUpdatedAt: null } }, "revision.availability"],
    ];
    for (const [activity, message] of invalid) {
      expect(() => validateRecordedActivitySnapshot({ ...value, activities: [activity] }, { now })).toThrow(message);
    }
  });

  it("rejects duplicate IDs and complete claims without unchanged matching counts", async () => {
    const value = await fixture();
    expect(() => validateRecordedActivitySnapshot({
      ...value, activities: [value.activities[0], value.activities[0]],
    }, { now })).toThrow("must be unique");
    const coverage = value.coverage;
    const invalidCoverage: Array<[unknown, string]> = [
      [{ ...coverage, countAfter: 5 }, "unchanged matching counts"],
      [{ ...coverage, countBefore: null }, "unchanged matching counts"],
      [{ ...coverage, itemCount: 3, duplicatesRemoved: 1 }, "unchanged matching counts"],
      [{ ...coverage, pageCount: 2 }, "every provider page"],
      [{ ...coverage, paginationComplete: false }, "complete pagination"],
      [{ ...coverage, itemCount: 11 }, "pages read"],
      [{ ...coverage, pagesRead: 51 }, "pagesRead"],
    ];
    for (const [nextCoverage, message] of invalidCoverage) {
      expect(() => validateRecordedActivitySnapshot({ ...value, coverage: nextCoverage }, { now })).toThrow(message);
    }
    expect(() => validateRecordedActivitySnapshot({
      ...value, coverage: { ...coverage, countBefore: 2, countAfter: 2, itemCount: 2 },
    }, { now })).toThrow("cannot exceed coverage.itemCount");
  });

  it("represents incomplete reads with a stable failure and never projects their activities", async () => {
    const value = await fixture();
    const overLimit = {
      ...value,
      completeness: "incomplete",
      coverage: { pagesRead: 0, pageCount: null, countBefore: 501, countAfter: null, itemCount: 0, duplicatesRemoved: 0, paginationComplete: false },
      failures: [{ code: "incomplete_pagination", retryable: false, retryAfterSeconds: null, message: "More than 500 workouts" }],
      activities: [],
    };
    expect(validateRecordedActivitySnapshot(overLimit, { now }).completeness).toBe("incomplete");
    expect(() => validateRecordedActivitySnapshot({ ...overLimit, failures: [] }, { now })).toThrow("stable failure");
    expect(() => validateRecordedActivitySnapshot({ ...value, failures: overLimit.failures }, { now })).toThrow("cannot contain failures");

    const shifted = {
      ...value,
      completeness: "incomplete",
      coverage: { ...value.coverage, countAfter: 5 },
      failures: [{ code: "incomplete_pagination", retryable: true, retryAfterSeconds: null, message: "Count changed during read" }],
    };
    const connector = projectAdvisorActivityConnector({ snapshot: shifted, now, makeOpaqueRef: opaque });
    expect(connector).toMatchObject({ state: "incomplete", complete: false, failure: { code: "incomplete_pagination" }, activities: [] });
  });

  it("binds version literals and request range to the fetch date", async () => {
    const value = await fixture();
    for (const changed of [
      { ...value, schemaVersion: "1.1.0" },
      { ...value, adapterVersion: "hevy-workouts-v2" },
      { ...value, source: "google_calendar" },
    ]) {
      expect(() => validateRecordedActivitySnapshot(changed, { now })).toThrow(RecordedActivityValidationError);
      try {
        validateRecordedActivitySnapshot(changed, { now });
      } catch (error) {
        expect((error as RecordedActivityValidationError).code).toBe("unsupported_schema_version");
      }
    }
    expect(() => validateRecordedActivitySnapshot({
      ...value, requestedRange: { ...value.requestedRange, startLocalDate: "2026-10-01" },
    }, { now })).toThrow("cannot exceed 31 days");
    expect(() => validateRecordedActivitySnapshot({
      ...value, requestedRange: { ...value.requestedRange, startLocalDate: "2026-10-03", endLocalDate: "2026-11-02" },
    }, { now })).toThrow("local fetch date");
  });

  it("scopes caches by source, account, generation, and range", async () => {
    const snapshot = validateRecordedActivitySnapshot(await fixture(), { now });
    const scope: RecordedActivitySnapshotScope = {
      source: "hevy",
      accountId: "account-1",
      connectionGeneration: 1,
      startLocalDate: "2026-10-02",
      endLocalDate: "2026-11-01",
      timezone: "America/New_York",
    };
    expect(recordedActivitySnapshotMatchesScope(snapshot, scope)).toBe(true);
    for (const changed of [
      { ...scope, accountId: "account-2" },
      { ...scope, connectionGeneration: 2 },
      { ...scope, startLocalDate: "2026-10-03" },
      { ...scope, timezone: "UTC" },
    ]) {
      expect(recordedActivitySnapshotMatchesScope(snapshot, changed)).toBe(false);
      expect(recordedActivitySnapshotScopeKey(changed)).not.toBe(recordedActivitySnapshotScopeKey(scope));
    }
  });

  it("projects only opaque workout timing while fresh, and nothing once stale", async () => {
    const value = await fixture();
    const connector = projectAdvisorActivityConnector({ snapshot: value, now, makeOpaqueRef: opaque });
    expect(connector).toMatchObject({
      source: "hevy",
      state: "current",
      complete: true,
      schemaVersion: "1.0.0",
      adapterVersion: "hevy-workouts-v1",
      coverage: { startLocalDate: "2026-10-02", endLocalDate: "2026-11-01", paginationComplete: true },
      failure: null,
    });
    expect(connector.activities[0]).toEqual({
      ref: `activity:${value.activities[0].id.length}`,
      startAt: "2026-10-30T22:00:00Z",
      endAt: "2026-10-30T22:45:00Z",
      duration: { kind: "known", seconds: 2_700 },
      localStartDate: "2026-10-30",
      location: "unsupported",
    });
    expect(JSON.stringify(connector)).not.toContain(value.activities[0].id);

    const stale = projectAdvisorActivityConnector({ snapshot: value, now: now.add({ minutes: 6 }), makeOpaqueRef: opaque });
    expect(stale).toMatchObject({ state: "stale", complete: false, activities: [] });
  });

  it("keeps the JSON Schema aligned with the runtime contract", async () => {
    const schema = JSON.parse(await readFile(schemaUrl, "utf8"));
    const value = await fixture();
    expect(schema.properties.schemaVersion.const).toBe(RECORDED_ACTIVITY_SCHEMA_VERSION);
    expect(schema.properties.adapterVersion.const).toBe(HEVY_WORKOUTS_ADAPTER_VERSION);
    expect(schema.properties.source.const).toBe("hevy");
    expect(new Set(schema.required)).toEqual(new Set(Object.keys(value)));
    expect(new Set(schema.$defs.activity.required)).toEqual(new Set(Object.keys(value.activities[0])));
    expect(new Set(schema.$defs.coverage.required)).toEqual(new Set(Object.keys(value.coverage)));
    expect(schema.$defs.activity.properties.fieldAvailability.properties).toEqual({
      location: { const: "unsupported" },
      sourceTimezone: { const: "unsupported" },
    });
    expect(Object.keys(schema.$defs.activity.properties)).not.toContain("title");
  });
});
