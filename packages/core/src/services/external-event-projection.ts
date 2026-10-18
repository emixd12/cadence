import type { ExternalEventFreshness, NormalizedExternalEvent } from "../types/day-progress";
import type {
  ExternalEventSchedulingFact,
  ExternalEventSchedulingProjection,
  ExternalEventSchedulingProjectionV1_1,
  ExternalEventSnapshotV1,
  VersionedExternalEventSnapshot,
} from "../types/external-event";
import {
  validateExternalEventSnapshot,
  validateVersionedExternalEventSnapshot,
} from "./external-event-validation";

export function projectExternalEventSchedulingFacts(
  value: ExternalEventSnapshotV1 | unknown,
): ExternalEventSchedulingProjection {
  const snapshot = validateExternalEventSnapshot(value);
  const events = snapshot.events.map(projectExternalEventSchedulingEvent);

  return {
    schemaVersion: snapshot.schemaVersion,
    accountId: snapshot.accountId,
    requestedRange: snapshot.requestedRange,
    completeness: snapshot.completeness,
    freshness: snapshot.freshness,
    coverage: snapshot.coverage,
    events,
    tombstones: snapshot.tombstones,
  };
}

/**
 * Same scheduling facts for any calendar source. Google `1.0.0` input returns
 * the unchanged Google projection; Outlook and iCloud `1.1.0` input also names
 * its source so merged consumers cannot confuse namespaced identities.
 */
export function projectVersionedExternalEventSchedulingFacts(
  value: VersionedExternalEventSnapshot | unknown,
): ExternalEventSchedulingProjection | ExternalEventSchedulingProjectionV1_1 {
  const snapshot = validateVersionedExternalEventSnapshot(value);
  if (snapshot.source === "google_calendar") {
    return projectExternalEventSchedulingFacts(snapshot);
  }
  return {
    schemaVersion: snapshot.schemaVersion,
    source: snapshot.source,
    accountId: snapshot.accountId,
    requestedRange: snapshot.requestedRange,
    completeness: snapshot.completeness,
    freshness: snapshot.freshness,
    coverage: snapshot.coverage,
    events: snapshot.events.map(projectExternalEventSchedulingEvent),
    tombstones: snapshot.tombstones,
  };
}

export function projectExternalEventSchedulingEvent(event: NormalizedExternalEvent): ExternalEventSchedulingFact {
  return {
    id: event.id,
    providerEventId: event.providerEventId,
    logicalInstanceId: event.logicalInstanceId,
    calendarId: event.calendarId,
    interval: event.kind === "timed"
      ? {
          kind: "timed",
          startAt: event.startAt,
          endAt: event.endAt,
          duration: event.duration,
        }
      : {
          kind: "all_day",
          startLocalDate: event.startLocalDate,
          endLocalDate: event.endLocalDate,
          duration: event.duration,
        },
    sourceTimezone: event.sourceTimezone,
    sourceTimezoneFallback: event.sourceTimezoneFallback,
    state: event.state,
    availability: event.availability,
    currentUserResponse: event.currentUserResponse,
    recurrence: event.recurrence,
    revision: event.revision,
  };
}

const FRESHNESS_WEAKNESS: Readonly<Record<ExternalEventFreshness["state"], number>> = { current: 0, stale: 1, incomplete: 2, unavailable: 3 };

/**
 * Ticket 225: one freshness for Timeline overlap cues across calendar sources.
 * No-overlap can be asserted only when every active source can assert it; the
 * weakest non-current source otherwise speaks for the merged Timeline. Returns
 * null when no source is active.
 */
export function combineExternalEventFreshness(values: readonly ExternalEventFreshness[]): ExternalEventFreshness | null {
  if (values.length === 0) return null;
  if (values.length === 1) return values[0]!;
  const weakest = [...values].sort((left, right) => FRESHNESS_WEAKNESS[right.state] - FRESHNESS_WEAKNESS[left.state])[0]!;
  if (weakest.state !== "current") return { ...weakest, canAssertNoOverlap: false };
  const refreshed = values.map((value) => value.refreshedAt).filter((value): value is string => value !== null).sort();
  return { state: "current", refreshedAt: refreshed[0] ?? null, label: weakest.label, canAssertNoOverlap: values.every((value) => value.canAssertNoOverlap) };
}
