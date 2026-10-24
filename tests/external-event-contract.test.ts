import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  projectExternalEventSchedulingFacts,
  projectVersionedExternalEventSchedulingFacts,
} from "../packages/core/src/services/external-event-projection";
import {
  ExternalEventValidationError,
  externalEventNormalizedId,
  externalEventSnapshotMatchesScope,
  externalEventSnapshotScope,
  externalEventSnapshotScopeKey,
  validateExternalEventSnapshot,
  validateVersionedExternalEventSnapshot,
} from "../packages/core/src/services/external-event-validation";
import {
  EXTERNAL_EVENT_ADAPTER_VERSION,
  EXTERNAL_EVENT_SCHEMA_VERSION,
  EXTERNAL_EVENT_SCHEMA_VERSION_1_1,
  EXTERNAL_EVENT_SOURCE_VERSIONS,
  ICLOUD_CALENDAR_ADAPTER_VERSION,
  OUTLOOK_CALENDAR_ADAPTER_VERSION,
} from "../packages/core/src/types/external-event";

const fixtureUrl = new URL("./fixtures/external-event-snapshot.valid.json", import.meta.url);
const schemaUrl = new URL("../packages/core/src/external-event.schema.json", import.meta.url);

describe("external event contract", () => {
  it("validates the versioned fixture and projects only scheduling facts", async () => {
    const fixture = JSON.parse(await readFile(fixtureUrl, "utf8"));
    const snapshot = validateExternalEventSnapshot(fixture);
    const projection = projectExternalEventSchedulingFacts(snapshot);

    expect(snapshot.schemaVersion).toBe(EXTERNAL_EVENT_SCHEMA_VERSION);
    expect(snapshot.adapterVersion).toBe(EXTERNAL_EVENT_ADAPTER_VERSION);
    expect(snapshot.events[0]).toMatchObject({
      duration: { kind: "known", seconds: 3_600 },
      recurrence: {
        seriesId: "series-1",
        originalStart: { kind: "timed", startAt: "2026-11-01T05:00:00Z" },
      },
    });
    expect(snapshot.events[1]).toMatchObject({
      duration: { kind: "calendar_days", days: 2 },
    });
    expect(projection.events[0]).not.toHaveProperty("title");
    expect(projection.events[0]).not.toHaveProperty("description");
    expect(projection.events[0]).not.toHaveProperty("attendees");
    expect(projection).toMatchObject({
      completeness: "complete",
      freshness: { state: "current", canAssertNoOverlap: true },
    });
  });

  it("keeps the JSON Schema version and top-level shape aligned with the runtime contract", async () => {
    const fixture = JSON.parse(await readFile(fixtureUrl, "utf8")) as Record<string, unknown>;
    const schema = JSON.parse(await readFile(schemaUrl, "utf8")) as {
      properties: Record<string, { const?: string }>;
      required: string[];
      $defs: Record<string, {
        required?: string[];
        allOf?: Array<{ required?: string[] }>;
        enum?: string[];
      }>;
    };

    expect(schema.properties.schemaVersion?.const).toBe(EXTERNAL_EVENT_SCHEMA_VERSION);
    expect(schema.properties.adapterVersion?.const).toBe(EXTERNAL_EVENT_ADAPTER_VERSION);
    expect(new Set(schema.required)).toEqual(new Set(Object.keys(fixture)));
    expect(schema.$defs).toHaveProperty("timedEvent");
    expect(schema.$defs).toHaveProperty("allDayEvent");
    expect(schema.$defs).toHaveProperty("tombstone");
    const base = schema.$defs.eventBase?.required ?? [];
    const timed = schema.$defs.timedEvent?.allOf?.flatMap((part) => part.required ?? []) ?? [];
    const allDay = schema.$defs.allDayEvent?.allOf?.flatMap((part) => part.required ?? []) ?? [];
    expect(new Set([...base, ...timed])).toEqual(new Set(Object.keys((fixture.events as object[])[0]!)));
    expect(new Set([...base, ...allDay])).toEqual(new Set(Object.keys((fixture.events as object[])[1]!)));
    expect(schema.$defs.fieldAvailabilityValue?.enum).toEqual([
      "not_provided", "restricted", "provider_omitted", "unsupported", "unknown",
    ]);
    expect(schema.$defs.detailCompletenessValue?.enum).toEqual([
      "complete", "provider_omitted", "client_truncated", "restricted", "unsupported", "unknown",
    ]);
  });

  it("rejects unsupported versions, mismatched durations, reversed spans, and false completeness", async () => {
    const fixture = JSON.parse(await readFile(fixtureUrl, "utf8"));

    expect(() => validateExternalEventSnapshot({ ...fixture, schemaVersion: "2.0.0" }))
      .toThrow(ExternalEventValidationError);
    expect(() => validateExternalEventSnapshot({ ...fixture, unexpected: true }))
      .toThrow("must contain exactly");
    expect(() => validateExternalEventSnapshot({
      ...fixture,
      events: [{ ...fixture.events[0], duration: { kind: "known", seconds: 0 } }],
    })).toThrow("duration.seconds");
    expect(() => validateExternalEventSnapshot({
      ...fixture,
      events: [{
        ...fixture.events[0],
        startAt: fixture.events[0].endAt,
        endAt: fixture.events[0].startAt,
      }],
    })).toThrow("endAt");
    expect(() => validateExternalEventSnapshot({
      ...fixture,
      coverage: [{ ...fixture.coverage[0], paginationComplete: false }],
    })).toThrow("complete snapshots");
    expect(() => validateExternalEventSnapshot({
      ...fixture,
      events: [{
        ...fixture.events[0],
        endUnspecified: true,
        duration: { kind: "known", seconds: 3_600 },
      }],
    })).toThrow("duration");
  });
});

const outlookFixtureUrl = new URL("./fixtures/external-event-snapshot.outlook.valid.json", import.meta.url);
const icloudFixtureUrl = new URL("./fixtures/external-event-snapshot.icloud.valid.json", import.meta.url);
const schemaV1_1Url = new URL("../packages/core/src/external-event-1.1.schema.json", import.meta.url);

async function readJson(url: URL) {
  return JSON.parse(await readFile(url, "utf8"));
}

function versionError(run: () => unknown): ExternalEventValidationError {
  try {
    run();
  } catch (error) {
    if (error instanceof ExternalEventValidationError) return error;
    throw error;
  }
  throw new Error("expected validation to fail");
}

describe("external event contract 1.1.0 (Outlook and iCloud)", () => {
  it("keeps the Google 1.0.0 fixture byte-equal and accepted by the older strict validator", async () => {
    const bytes = await readFile(fixtureUrl, "utf8");
    expect(createHash("sha256").update(bytes).digest("hex"))
      .toBe("78b0e13958ae7711175f5ae745dead092cc5ad09a707c7dbc2b017bb7067772e");
    const google = JSON.parse(bytes);
    expect(validateExternalEventSnapshot(google)).toBe(google);
    expect(validateVersionedExternalEventSnapshot(google)).toBe(google);
    expect(projectVersionedExternalEventSchedulingFacts(google))
      .toEqual(projectExternalEventSchedulingFacts(google));
    expect(projectVersionedExternalEventSchedulingFacts(google)).not.toHaveProperty("source");
  });

  it("validates Outlook and iCloud snapshots only through the versioned entry point", async () => {
    for (const url of [outlookFixtureUrl, icloudFixtureUrl]) {
      const fixture = await readJson(url);
      expect(validateVersionedExternalEventSnapshot(fixture)).toBe(fixture);
      const error = versionError(() => validateExternalEventSnapshot(fixture));
      expect(error.code).toBe("unsupported_schema_version");
    }
  });

  it("binds schema version, adapter version, and source together", async () => {
    const google = await readJson(fixtureUrl);
    const outlook = await readJson(outlookFixtureUrl);
    const icloud = await readJson(icloudFixtureUrl);
    const mismatches = [
      { ...google, schemaVersion: "1.1.0" },
      { ...outlook, schemaVersion: "1.0.0" },
      { ...outlook, adapterVersion: ICLOUD_CALENDAR_ADAPTER_VERSION },
      { ...icloud, adapterVersion: OUTLOOK_CALENDAR_ADAPTER_VERSION },
      { ...outlook, adapterVersion: EXTERNAL_EVENT_ADAPTER_VERSION },
      { ...outlook, schemaVersion: "1.2.0" },
      { ...outlook, schemaVersion: "2.0.0" },
      { ...outlook, source: "hevy" },
    ];
    for (const snapshot of mismatches) {
      expect(versionError(() => validateVersionedExternalEventSnapshot(snapshot)).code)
        .toBe("unsupported_schema_version");
    }
    expect(EXTERNAL_EVENT_SOURCE_VERSIONS).toEqual({
      google_calendar: { schemaVersion: "1.0.0", adapterVersion: "google-calendar-v1" },
      outlook_calendar: { schemaVersion: EXTERNAL_EVENT_SCHEMA_VERSION_1_1, adapterVersion: "outlook-calendar-v1" },
      icloud_calendar: { schemaVersion: EXTERNAL_EVENT_SCHEMA_VERSION_1_1, adapterVersion: "icloud-calendar-v1" },
    });
  });

  it("rejects cross-source events, tombstones, and identities without the source namespace", async () => {
    const outlook = await readJson(outlookFixtureUrl);
    const icloud = await readJson(icloudFixtureUrl);
    const [timed] = outlook.events;
    expect(() => validateVersionedExternalEventSnapshot({
      ...outlook, events: [{ ...timed, source: "icloud_calendar" }],
    })).toThrow("events[0].source");
    expect(() => validateVersionedExternalEventSnapshot({
      ...outlook, events: [{ ...timed, source: "google_calendar" }],
    })).toThrow("events[0].source");
    expect(() => validateVersionedExternalEventSnapshot({
      ...outlook, events: [{ ...timed, id: "google_calendar/calendar-1/timed-1" }],
    })).toThrow("namespaced by outlook_calendar/");
    expect(() => validateVersionedExternalEventSnapshot({
      ...outlook, events: [{ ...timed, logicalInstanceId: "timed-1" }],
    })).toThrow("logicalInstanceId");
    expect(() => validateVersionedExternalEventSnapshot({
      ...icloud, tombstones: [{ ...icloud.tombstones[0], source: "outlook_calendar" }],
    })).toThrow("tombstones[0].source");
    expect(() => validateVersionedExternalEventSnapshot({
      ...icloud, tombstones: [{ ...icloud.tombstones[0], id: "uid-1" }],
    })).toThrow("tombstones[0].id");
    expect(() => validateVersionedExternalEventSnapshot({
      ...outlook, events: [{ ...timed, calendarId: "calendar-other" }],
    })).toThrow("selected calendar");
  });

  it("keeps first-slice details out of Outlook and iCloud events", async () => {
    const outlook = await readJson(outlookFixtureUrl);
    const icloud = await readJson(icloudFixtureUrl);
    const [timed] = outlook.events;
    const [instance] = icloud.events;
    const invalid: Array<[Record<string, unknown>, string]> = [
      [{ ...outlook, events: [{ ...timed, description: "Private agenda" }] }, "description"],
      [{ ...outlook, events: [{ ...timed, location: "Room 4" }] }, "location"],
      [{ ...outlook, events: [{ ...timed, attendees: [] }] }, "attendees"],
      [{ ...outlook, events: [{ ...timed, organizer: { displayName: null, email: "a@example.com", self: false } }] }, "organizer"],
      [{ ...outlook, events: [{ ...timed, fieldAvailability: { ...timed.fieldAvailability, location: "not_provided" } }] }, "fieldAvailability.location"],
      [{ ...outlook, events: [{ ...timed, state: "confirmed" }] }, "state"],
      [{ ...icloud, events: [{ ...instance, sourceUrl: "https://www.icloud.com/calendar" }] }, "sourceUrl"],
      [{ ...icloud, events: [{ ...instance, currentUserResponse: "accepted" }] }, "currentUserResponse"],
      [{ ...icloud, events: [{ ...instance, unexpected: true }] }, "exactly"],
    ];
    for (const [snapshot, message] of invalid) {
      expect(() => validateVersionedExternalEventSnapshot(snapshot)).toThrow(message);
    }
  });

  it("preserves overnight DST, 45-minute, all-day, recurrence, cancellation, and unknown-end facts", async () => {
    const outlook = validateVersionedExternalEventSnapshot(await readJson(outlookFixtureUrl));
    const icloud = validateVersionedExternalEventSnapshot(await readJson(icloudFixtureUrl));
    expect(outlook.events[0]).toMatchObject({
      kind: "timed",
      startAt: "2026-11-01T03:00:00Z",
      endAt: "2026-11-01T07:00:00Z",
      duration: { kind: "known", seconds: 14_400 },
      state: "unknown",
    });
    expect(outlook.events[1]).toMatchObject({
      kind: "all_day",
      startLocalDate: "2026-11-02",
      endLocalDate: "2026-11-03",
      sourceTimezone: "America/Los_Angeles",
      duration: { kind: "calendar_days", days: 1 },
    });
    expect(icloud.events[0]).toMatchObject({
      duration: { kind: "known", seconds: 2_700 },
      recurrence: { seriesId: "uid-1", originalStart: { kind: "timed", startAt: "2026-11-02T13:00:00Z" } },
    });
    expect(icloud.events[1]).toMatchObject({ endUnspecified: true, duration: { kind: "unknown", reason: "end_unspecified" } });
    expect(icloud.tombstones[0]).toMatchObject({ source: "icloud_calendar", providerEventId: "uid-1" });

    const raw = await readJson(outlookFixtureUrl);
    expect(() => validateVersionedExternalEventSnapshot({
      ...raw, events: [{ ...raw.events[0], duration: { kind: "known", seconds: 10_800 } }],
    })).toThrow("duration.seconds");

    const projection = projectVersionedExternalEventSchedulingFacts(icloud);
    expect(projection).toMatchObject({ schemaVersion: "1.1.0", source: "icloud_calendar" });
    expect(projection.events[0]).not.toHaveProperty("title");
    expect(projection.events[0]).toMatchObject({ interval: { duration: { kind: "known", seconds: 2_700 } } });
  });

  it("rejects duplicate IDs and complete claims over incomplete coverage", async () => {
    const outlook = await readJson(outlookFixtureUrl);
    expect(() => validateVersionedExternalEventSnapshot({
      ...outlook, events: [outlook.events[0], outlook.events[0]],
    })).toThrow("must be unique");
    expect(() => validateVersionedExternalEventSnapshot({ ...outlook, coverage: [] }))
      .toThrow("complete coverage");
    expect(() => validateVersionedExternalEventSnapshot({
      ...outlook, coverage: [{ ...outlook.coverage[0], paginationComplete: false }],
    })).toThrow("complete pagination");

    const incomplete = {
      ...outlook,
      completeness: "incomplete",
      freshness: { state: "incomplete", refreshedAt: null, label: "Outlook incomplete", canAssertNoOverlap: false },
      coverage: [{ ...outlook.coverage[0], paginationComplete: false }],
      failures: [{ code: "timeout", calendarId: "calendar-1", retryable: true, retryAfterSeconds: null, message: "Deadline reached" }],
    };
    expect(validateVersionedExternalEventSnapshot(incomplete).completeness).toBe("incomplete");
    expect(() => validateVersionedExternalEventSnapshot({
      ...incomplete, freshness: { ...incomplete.freshness, canAssertNoOverlap: true },
    })).toThrow("canAssertNoOverlap");
  });

  it("namespaces identities and cache scopes across sources, accounts, generations, and ranges", async () => {
    const google = validateVersionedExternalEventSnapshot(await readJson(fixtureUrl));
    const outlook = validateVersionedExternalEventSnapshot(await readJson(outlookFixtureUrl));
    expect(google.events[0]!.calendarId).toBe(outlook.events[0]!.calendarId);
    expect(google.events[0]!.providerEventId).toBe(outlook.events[0]!.providerEventId);
    expect(google.events[0]!.id).not.toBe(outlook.events[0]!.id);
    expect(externalEventNormalizedId("icloud_calendar", ["account-1", "/calendars/home/", "uid 1"]))
      .toBe("icloud_calendar/account-1/%2Fcalendars%2Fhome%2F/uid%201");
    expect(() => externalEventNormalizedId("outlook_calendar", ["calendar-1", ""])).toThrow("identity");

    const scope = externalEventSnapshotScope(outlook);
    expect(externalEventSnapshotMatchesScope(outlook, scope)).toBe(true);
    expect(externalEventSnapshotMatchesScope(outlook, { ...scope, selectedCalendarIds: [...scope.selectedCalendarIds].reverse() })).toBe(true);
    expect(externalEventSnapshotMatchesScope(google, { ...externalEventSnapshotScope(google), source: "outlook_calendar" })).toBe(false);
    for (const changed of [
      { ...scope, source: "google_calendar" as const },
      { ...scope, source: "icloud_calendar" as const },
      { ...scope, accountId: "account-2" },
      { ...scope, connectionGeneration: scope.connectionGeneration + 1 },
      { ...scope, endLocalDate: "2026-11-04" },
      { ...scope, timezone: "America/Chicago" },
      { ...scope, selectedCalendarIds: ["calendar-1", "calendar-2"] },
    ]) {
      expect(externalEventSnapshotScopeKey(changed)).not.toBe(externalEventSnapshotScopeKey(scope));
    }
  });

  it("keeps the 1.1.0 JSON Schema aligned with the fixtures and the shared 1.0.0 definitions", async () => {
    const schema = await readJson(schemaV1_1Url);
    const schemaV1 = await readJson(schemaUrl);
    const outlook = await readJson(outlookFixtureUrl);
    expect(schema.properties.schemaVersion.const).toBe(EXTERNAL_EVENT_SCHEMA_VERSION_1_1);
    expect(schema.properties.adapterVersion.enum).toEqual([OUTLOOK_CALENDAR_ADAPTER_VERSION, ICLOUD_CALENDAR_ADAPTER_VERSION]);
    expect(schema.$defs.source.enum).toEqual(["outlook_calendar", "icloud_calendar"]);
    expect(new Set(schema.required)).toEqual(new Set(Object.keys(outlook)));
    expect(schema.$defs.eventBase.required).toEqual(schemaV1.$defs.eventBase.required);
    expect(schemaV1.properties.schemaVersion.const).toBe("1.0.0");
    expect(schemaV1.properties.source.const).toBe("google_calendar");

    const documents: Record<string, unknown> = { [schemaV1.$id]: schemaV1, [schema.$id]: schema };
    const refs: string[] = [];
    JSON.stringify(schema, (key, value) => {
      if (key === "$ref") refs.push(value);
      return value;
    });
    expect(refs.length).toBeGreaterThan(10);
    for (const ref of refs) {
      const [file, pointer] = ref.split("#");
      const documentId = file ? new URL(file, schema.$id).href : schema.$id;
      let target: unknown = documents[documentId];
      for (const part of pointer!.split("/").slice(1)) {
        target = (target as Record<string, unknown> | undefined)?.[part];
      }
      expect(target, ref).toBeTypeOf("object");
    }
  });
});
