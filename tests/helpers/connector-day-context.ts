import { Temporal } from "@js-temporal/polyfill";
import {
  projectAdvisorActivityConnector,
  projectVersionedAdvisorCalendarConnector,
  validateVersionedAdvisorDayContext,
} from "@cadence/core/services/advisor-day-context";
import type { AdvisorDayContextV1, AdvisorDayContextV1_1 } from "@cadence/core/types/advisor-day-context";
import base from "../fixtures/advisor-day-context.valid.json";
import outlook from "../fixtures/external-event-snapshot.outlook.valid.json";
import icloud from "../fixtures/external-event-snapshot.icloud.valid.json";
import hevy from "../fixtures/recorded-activity-snapshot.valid.json";

// Ticket 239 synthetic fixtures. The `1.0` Daily Brief fixture day is 2026-11-01
// in America/New_York, captured at 12:00Z. Connector reads finish at 11:59:50Z.
export const CONNECTOR_FETCHED_AT = "2026-11-01T11:59:50Z";
/** Fixture snapshots are edited field by field; validators, not types, check them. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FixtureSnapshot = Record<string, any>;
const ref = (kind: string, value: string) => `${kind}_${Buffer.from(value).toString("base64url")}`;

/** One selected Outlook calendar for the fixture day with a busy 17:15–17:45Z event beside the 17:30Z Walk. */
export function outlookDaySnapshot(): FixtureSnapshot {
  const snapshot: FixtureSnapshot = structuredClone(outlook);
  snapshot.requestedRange = { ...snapshot.requestedRange, startLocalDate: "2026-11-01", endLocalDate: "2026-11-01" };
  snapshot.fetchedAt = CONNECTOR_FETCHED_AT;
  snapshot.freshness = { ...snapshot.freshness, refreshedAt: CONNECTOR_FETCHED_AT };
  snapshot.coverage = [{ calendarId: "calendar-1", startLocalDate: "2026-11-01", endLocalDate: "2026-11-01", paginationComplete: true, itemCount: 1 }];
  snapshot.events = [{ ...snapshot.events[0], startAt: "2026-11-01T17:15:00Z", endAt: "2026-11-01T17:45:00Z", duration: { kind: "known", seconds: 1800 }, title: "Private review" }];
  return snapshot;
}

/** Ticket 240: one selected iCloud calendar for the fixture day with a busy 15:00–15:30Z event. */
export function icloudDaySnapshot(): FixtureSnapshot {
  const snapshot: FixtureSnapshot = structuredClone(icloud);
  snapshot.requestedRange = { ...snapshot.requestedRange, startLocalDate: "2026-11-01", endLocalDate: "2026-11-01" };
  snapshot.fetchedAt = CONNECTOR_FETCHED_AT;
  snapshot.freshness = { ...snapshot.freshness, refreshedAt: CONNECTOR_FETCHED_AT };
  snapshot.coverage = [{ calendarId: "calendar-1", startLocalDate: "2026-11-01", endLocalDate: "2026-11-01", paginationComplete: true, itemCount: 1 }];
  snapshot.events = [{ ...snapshot.events[0], recurrence: null, id: "icloud_calendar/account-1/calendar-1/uid-9", logicalInstanceId: "icloud_calendar/account-1/calendar-1/uid-9",
    providerEventId: "uid-9", startAt: "2026-11-01T15:00:00Z", endAt: "2026-11-01T15:30:00Z", duration: { kind: "known", seconds: 1800 }, title: "Private dentist" }];
  snapshot.tombstones = [];
  return snapshot;
}

/** One recorded workout that ended before capture on the fixture day. */
export function hevyDaySnapshot(): FixtureSnapshot {
  const snapshot: FixtureSnapshot = structuredClone(hevy);
  snapshot.requestedRange = { ...snapshot.requestedRange, startLocalDate: "2026-11-01", endLocalDate: "2026-11-01" };
  snapshot.fetchedAt = CONNECTOR_FETCHED_AT;
  snapshot.activities = [{ ...snapshot.activities[2], startAt: "2026-11-01T10:00:00Z", endAt: "2026-11-01T10:45:00Z", duration: { kind: "known", seconds: 2700 }, localStartDate: "2026-11-01" }];
  snapshot.coverage = { ...snapshot.coverage, itemCount: 1, countBefore: 1, countAfter: 1 };
  return snapshot;
}

export function connectorDayContext(options: Readonly<{ outlook?: unknown; hevy?: unknown }> = {}): AdvisorDayContextV1_1 {
  const now = Temporal.Instant.from(base.capturedAt);
  const connectors = [
    ...(base as AdvisorDayContextV1).connectors,
    projectVersionedAdvisorCalendarConnector({ snapshot: options.outlook ?? outlookDaySnapshot(), selectionRevision: 3, now, makeOpaqueRef: ref }),
    projectAdvisorActivityConnector({ snapshot: options.hevy ?? hevyDaySnapshot(), now, makeOpaqueRef: ref }),
  ];
  const status = connectors.every((item) => item.state === "not_requested" || item.complete) ? "complete" : "partial";
  return validateVersionedAdvisorDayContext({ ...base, version: "1.1", status, connectors }) as AdvisorDayContextV1_1;
}
