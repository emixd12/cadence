import { readFile } from "node:fs/promises";

import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";

import {
  projectAdvisorActivityConnector,
  projectAdvisorCalendarConnector,
  projectVersionedAdvisorCalendarConnector,
  validateAdvisorDayContextRequest,
  validateAdvisorDayContext,
  validateVersionedAdvisorDayContext,
  validateVersionedAdvisorDayContextRequest,
} from "../packages/core/src/services/advisor-day-context";
import { validateExternalEventSnapshot } from "../packages/core/src/services/external-event-validation";

const contextFixture = new URL("./fixtures/advisor-day-context.valid.json", import.meta.url);
const calendarFixture = new URL("./fixtures/external-event-snapshot.valid.json", import.meta.url);

describe("advisor day-context contract", () => {
  it("validates only the versioned one-day request shape", () => {
    expect(validateAdvisorDayContextRequest({ version: "1.0", localDate: "2026-11-01", connectors: ["google_calendar"] })).toEqual({ version: "1.0", localDate: "2026-11-01", connectors: ["google_calendar"] });
    expect(() => validateAdvisorDayContextRequest({ version: "1.0", localDate: null, connectors: ["other"] })).toThrow("connectors");
  });

  it("validates the minimized DST-day fixture", async () => {
    const fixture = JSON.parse(await readFile(contextFixture, "utf8"));
    const context = validateAdvisorDayContext(fixture);

    expect(Temporal.Instant.from(context.dayStartAt).until(Temporal.Instant.from(context.dayEndAt)).total({ unit: "hours" })).toBe(25);
    expect(context.cadence.occurrences[0]).not.toHaveProperty("note");
    expect(context.cadence.history).toMatchObject({
      lookbackDays: 90,
      startLocalDate: "2026-08-03",
      endLocalDateExclusive: "2026-11-01",
      completeness: "complete",
    });
    expect(context.connectors[0]).not.toHaveProperty("calendarId");
  });

  it("rejects rich fields, inconsistent bounds, duplicate refs, and incomplete empty-calendar claims", async () => {
    const fixture = JSON.parse(await readFile(contextFixture, "utf8"));
    expect(() => validateAdvisorDayContext({ ...fixture, rawAccountId: "owner" })).toThrow("exactly");
    expect(() => validateAdvisorDayContext({ ...fixture, dayEndAt: "2026-11-02T04:00:00Z" })).toThrow("day bounds");
    expect(() => validateAdvisorDayContext({
      ...fixture,
      cadence: { ...fixture.cadence, occurrences: [...fixture.cadence.occurrences, fixture.cadence.occurrences[0]] },
    })).toThrow("unique");
    expect(() => validateAdvisorDayContext({
      ...fixture,
      status: "partial",
      connectors: [{ ...fixture.connectors[0], state: "incomplete", complete: false, events: [] }],
    })).toThrow("requires a failure");
    expect(() => validateAdvisorDayContext({
      ...fixture,
      connectors: [{ ...fixture.connectors[0], events: [{ ...fixture.connectors[0].events[0], title: "Private" }] }],
    })).toThrow("exactly");
    expect(() => validateAdvisorDayContext({
      ...fixture,
      cadence: {
        ...fixture.cadence,
        history: { ...fixture.cadence.history, completeness: "unknown", reason: "history_limit_exceeded" },
      },
    })).toThrow("must be null");
  });

  it("validates duration candidate provenance and authorized off-day elapsed samples", async () => {
    const fixture = JSON.parse(await readFile(contextFixture, "utf8"));
    const occurrence = fixture.cadence.occurrences[0];
    occurrence.durationCandidates = {
      configuredDefault: occurrence.duration,
      historicalAverage: { kind: "unknown", reason: "insufficient_samples", sampleCount: 1, lookbackDays: 90 },
    };
    fixture.cadence.history.behaviors.push({
      behaviorRef: "behavior_off_day",
      completedCount: 1,
      notCompletedCount: 0,
      unresolvedCount: 0,
    });
    fixture.cadence.recordedElapsedDurations = [{ behaviorRef: "behavior_off_day", localDate: "2026-10-31", seconds: 600 }];
    expect(validateAdvisorDayContext(fixture).cadence.recordedElapsedDurations).toHaveLength(1);

    occurrence.durationCandidates.configuredDefault = {
      kind: "known", seconds: 1200, source: "completed_stopped_occurrence_mean", sampleCount: 3, lookbackDays: 90,
    };
    expect(() => validateAdvisorDayContext(fixture)).toThrow("Configured default duration candidate");
  });

  it("projects opaque scheduling facts while removing provider IDs and rich metadata", async () => {
    const snapshot = validateExternalEventSnapshot(JSON.parse(await readFile(calendarFixture, "utf8")));
    const connector = projectAdvisorCalendarConnector({
      snapshot,
      selectionRevision: 2,
      now: Temporal.Instant.from(snapshot.fetchedAt),
      makeOpaqueRef: (kind, value) => `${kind}:${value.length}`,
    });

    expect(connector.events[0]).not.toHaveProperty("providerEventId");
    expect(connector.events[0]).not.toHaveProperty("title");
    expect(connector.events[0]).not.toHaveProperty("sourceUrl");
    expect(connector).toMatchObject({ complete: true, state: "current", selectionRevision: 2 });
  });

  it("preserves unknown-end, declined, tentative, free, and all-day scheduling facts", async () => {
    const fixture = JSON.parse(await readFile(calendarFixture, "utf8"));
    fixture.events[0] = {
      ...fixture.events[0],
      state: "tentative",
      availability: "busy",
      currentUserResponse: "declined",
      endUnspecified: true,
      duration: { kind: "unknown", reason: "end_unspecified" },
    };
    const connector = projectAdvisorCalendarConnector({
      snapshot: fixture,
      selectionRevision: 2,
      now: Temporal.Instant.from(fixture.fetchedAt),
      makeOpaqueRef: (kind, value) => `${kind}:${value.length}`,
    });
    expect(connector.events[0]).toMatchObject({ state: "tentative", availability: "busy", currentUserResponse: "declined", interval: { duration: { kind: "unknown", reason: "end_unspecified" } } });
    expect(connector.events[1]).toMatchObject({ state: "tentative", availability: "free", interval: { kind: "all_day", duration: { kind: "calendar_days", days: 2 } } });
  });

  it("turns incomplete pagination into an explicit failure with no usable events", async () => {
    const fixture = JSON.parse(await readFile(calendarFixture, "utf8"));
    fixture.completeness = "incomplete";
    fixture.freshness = { state: "incomplete", refreshedAt: fixture.fetchedAt, label: "Calendar data incomplete", canAssertNoOverlap: false };
    fixture.coverage[0].paginationComplete = false;
    fixture.failures = [{ code: "incomplete_pagination", calendarId: "calendar-1", retryable: false, retryAfterSeconds: null, message: "Synthetic partial page" }];
    const connector = projectAdvisorCalendarConnector({
      snapshot: fixture,
      selectionRevision: 2,
      now: Temporal.Instant.from(fixture.fetchedAt),
      makeOpaqueRef: (kind, value) => `${kind}:${value.length}`,
    });
    expect(connector).toMatchObject({ state: "incomplete", complete: false, failure: { code: "incomplete_pagination" }, events: [] });
  });
});

const outlookFixture = new URL("./fixtures/external-event-snapshot.outlook.valid.json", import.meta.url);
const activityFixture = new URL("./fixtures/recorded-activity-snapshot.valid.json", import.meta.url);

async function contextV1_1() {
  const fixture = JSON.parse(await readFile(contextFixture, "utf8"));
  const [google] = fixture.connectors;
  const activitySnapshot = JSON.parse(await readFile(activityFixture, "utf8"));
  activitySnapshot.fetchedAt = "2026-11-01T11:59:30Z";
  const activity = projectAdvisorActivityConnector({
    snapshot: activitySnapshot,
    now: Temporal.Instant.from(fixture.capturedAt),
    makeOpaqueRef: (kind, value) => `${kind}_${value.slice(-8)}`,
  });
  const outlook = {
    ...google,
    source: "outlook_calendar",
    schemaVersion: "1.1.0",
    adapterVersion: "outlook-calendar-v1",
    coverage: [{ ...google.coverage[0], calendarRef: "calendar_outlook" }],
    events: [{ ...google.events[0], ref: "event_outlook", calendarRef: "calendar_outlook", state: "unknown" }],
  };
  return {
    ...fixture,
    version: "1.1",
    connectors: [google, outlook, { source: "icloud_calendar", state: "not_requested" }, activity],
  };
}

describe("advisor day-context 1.1 compatibility", () => {
  it("accepts 1.0 requests only for Google and 1.1 requests for unique known kinds", () => {
    expect(validateVersionedAdvisorDayContextRequest({ version: "1.0", localDate: null, connectors: [] }))
      .toEqual({ version: "1.0", localDate: null, connectors: [] });
    expect(() => validateVersionedAdvisorDayContextRequest({ version: "1.0", localDate: null, connectors: ["outlook_calendar"] }))
      .toThrow("connectors");
    const all = { version: "1.1", localDate: "2026-11-01", connectors: ["google_calendar", "outlook_calendar", "icloud_calendar", "hevy"] };
    expect(validateVersionedAdvisorDayContextRequest(all)).toEqual(all);
    expect(() => validateVersionedAdvisorDayContextRequest({ ...all, connectors: ["hevy", "hevy"] })).toThrow("connectors");
    expect(() => validateVersionedAdvisorDayContextRequest({ ...all, connectors: ["strava"] })).toThrow("connectors");
    expect(() => validateVersionedAdvisorDayContextRequest({ ...all, version: "1.2" })).toThrow("version");
    expect(() => validateAdvisorDayContextRequest(all)).toThrow("version");
  });

  it("keeps stored 1.0 contexts readable and the 1.0 validator Google-only", async () => {
    const fixture = JSON.parse(await readFile(contextFixture, "utf8"));
    expect(validateVersionedAdvisorDayContext(fixture)).toBe(fixture);
    expect(validateAdvisorDayContext(fixture)).toBe(fixture);
    const v1_1 = await contextV1_1();
    expect(() => validateAdvisorDayContext(v1_1)).toThrow("version");
    expect(() => validateVersionedAdvisorDayContext({ ...fixture, connectors: [v1_1.connectors[1]] })).toThrow("connector.source");
  });

  it("validates a 1.1 context with calendar, not-requested, and recorded-activity connectors", async () => {
    const context = validateVersionedAdvisorDayContext(await contextV1_1());
    expect(context.version).toBe("1.1");
    const activity = context.connectors[3]!;
    expect(activity).toMatchObject({ source: "hevy", state: "current", complete: true });
    expect("activities" in activity && activity.activities.map((item) => item.duration.seconds)).toEqual([2_700, 3_600, 3_600]);
  });

  it("rejects mismatched versions, duplicate sources, colliding refs, and leaked workout details", async () => {
    const context = await contextV1_1();
    const [google, outlook, icloud, activity] = context.connectors;
    const invalid: Array<[unknown[], string]> = [
      [[google, { ...outlook, schemaVersion: "1.0.0" }], "schemaVersion"],
      [[google, { ...outlook, adapterVersion: "icloud-calendar-v1" }], "adapterVersion"],
      [[{ ...google, schemaVersion: "1.1.0" }], "schemaVersion"],
      [[google, { ...outlook, source: "google_calendar" }], "at most once"],
      [[google, { ...outlook, events: [{ ...outlook.events[0], ref: google.events[0].ref }] }], "Event refs must be unique"],
      [[icloud, { source: "strava", state: "not_requested" }], "connector.source"],
      [[{ ...activity, schemaVersion: "1.1.0" }], "schemaVersion"],
      [[{ ...activity, activities: [{ ...activity.activities[0], title: "Leg day" }] }], "exactly"],
      [[{ ...activity, activities: [{ ...activity.activities[0], location: "Gym" }] }], "location"],
      [[{ ...activity, activities: [{ ...activity.activities[0], duration: { kind: "known", seconds: 2_000 } }] }], "duration"],
      [[{ ...activity, activities: [activity.activities[0], activity.activities[0]] }], "unique"],
      [[{ ...activity, state: "incomplete", complete: false, failure: { code: "timeout", retryable: true, retryAfterSeconds: null } }], "cannot expose activities"],
      [[{ ...activity, state: "incomplete", complete: false, activities: [] }], "requires a failure"],
      [[{ ...activity, coverage: { ...activity.coverage, endLocalDate: "2026-10-31" } }], "context day"],
    ];
    for (const [connectors, message] of invalid) {
      expect(() => validateVersionedAdvisorDayContext({ ...context, connectors })).toThrow(message);
    }
    expect(() => validateVersionedAdvisorDayContext({ ...context, connectors: [] })).toThrow("at most once");
  });

  it("projects Google identically and namespaces Outlook refs by source", async () => {
    const google = JSON.parse(await readFile(calendarFixture, "utf8"));
    const outlook = JSON.parse(await readFile(outlookFixture, "utf8"));
    const makeOpaqueRef = (kind: string, value: string) => `${kind}:${value}`;
    const now = Temporal.Instant.from(google.fetchedAt);
    const legacy = projectAdvisorCalendarConnector({ snapshot: google, selectionRevision: 1, now, makeOpaqueRef });
    expect(projectVersionedAdvisorCalendarConnector({ snapshot: google, selectionRevision: 1, now, makeOpaqueRef })).toEqual(legacy);
    expect(() => projectAdvisorCalendarConnector({ snapshot: outlook, selectionRevision: 1, now, makeOpaqueRef })).toThrow("schemaVersion");

    const projected = projectVersionedAdvisorCalendarConnector({ snapshot: outlook, selectionRevision: 1, now, makeOpaqueRef });
    expect(projected).toMatchObject({ source: "outlook_calendar", schemaVersion: "1.1.0", adapterVersion: "outlook-calendar-v1", complete: true });
    expect(outlook.events[0].providerEventId).toBe(google.events[0].providerEventId);
    expect(projected.events[0]!.ref).not.toBe(legacy.events[0]!.ref);
    expect(projected.coverage[0]!.calendarRef).not.toBe(legacy.coverage[0]!.calendarRef);
    expect(projected.events[0]).not.toHaveProperty("title");
  });
});

describe("Ticket 226 unavailable connector projections", () => {
  it("validates unavailable Outlook, iCloud, and Hevy states only in 1.1 and exposes no records", async () => {
    const { projectUnavailableAdvisorActivity, projectUnavailableVersionedAdvisorCalendar } = await import("../packages/core/src/services/advisor-day-context");
    const fixture = JSON.parse(await readFile(contextFixture, "utf8"));
    const failure = { code: "timeout" as const, retryable: true, retryAfterSeconds: null };
    const outlook = projectUnavailableVersionedAdvisorCalendar({ source: "outlook_calendar", connectionGeneration: 2, selectionRevision: 3, failure });
    const icloud = projectUnavailableVersionedAdvisorCalendar({ source: "icloud_calendar", connectionGeneration: 1, selectionRevision: 1,
      failure: { code: "provider_unavailable", retryable: false, retryAfterSeconds: null } });
    const hevy = projectUnavailableAdvisorActivity({ connectionGeneration: 4, failure });
    const context = { ...fixture, version: "1.1", status: "partial", connectors: [...fixture.connectors, outlook, icloud, hevy] };
    expect(validateVersionedAdvisorDayContext(context).connectors.slice(1)).toEqual([
      expect.objectContaining({ source: "outlook_calendar", state: "unavailable", events: [], coverage: [] }),
      expect.objectContaining({ source: "icloud_calendar", state: "unavailable", events: [] }),
      expect.objectContaining({ source: "hevy", state: "unavailable", activities: [], coverage: null }),
    ]);
    expect(() => validateVersionedAdvisorDayContext({ ...context, status: "complete" })).toThrow("incomplete connector");
    expect(() => validateAdvisorDayContext(context)).toThrow("unsupported");
    expect(() => validateVersionedAdvisorDayContext({ ...context, version: "1.0" })).toThrow();
  });
});
