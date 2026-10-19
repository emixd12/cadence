import { Temporal } from "@js-temporal/polyfill";
import type {
  RecordedActivityFailure,
  RecordedActivitySnapshotScope,
  RecordedActivitySnapshotV1,
} from "../types/recorded-activity";
import { recordedActivitySnapshotScopeKey } from "./recorded-activity-validation";

// Ticket 238 client-safe recorded-activity rules shared by web, desktop, and the
// Hevy service. This module has no network, storage, credential, or clock access.

export type RecordedActivityRefresh = Readonly<{
  snapshot: RecordedActivitySnapshotV1;
  /** True only when `next` replaced the cached snapshot. */
  replaced: boolean;
  /** Failures of the attempted refresh, kept even when the cached snapshot remains. */
  refreshFailures: RecordedActivityFailure[];
}>;

/** Scope key of a validated snapshot: source, account, generation, range, and timezone. */
export function recordedActivitySnapshotKey(snapshot: RecordedActivitySnapshotV1): string {
  return recordedActivitySnapshotScopeKey({
    source: snapshot.source,
    accountId: snapshot.accountId,
    connectionGeneration: snapshot.connectionGeneration,
    startLocalDate: snapshot.requestedRange.startLocalDate,
    endLocalDate: snapshot.requestedRange.endLocalDate,
    timezone: snapshot.requestedRange.timezone,
  });
}

/**
 * Cache rule from Ticket 236. A complete refresh replaces the cached snapshot
 * for the same scope at once, which is how edits and deletions are proved. An
 * incomplete refresh never erases known records. A response from an older
 * connection generation or an earlier fetch than the cached one is late and
 * ignored. A different account, range, or timezone never reuses the cache.
 */
export function applyRecordedActivityRefresh(
  cached: RecordedActivitySnapshotV1 | null,
  next: RecordedActivitySnapshotV1,
): RecordedActivityRefresh {
  if (!cached || cached.accountId !== next.accountId) return { snapshot: next, replaced: true, refreshFailures: next.failures };
  if (next.connectionGeneration < cached.connectionGeneration) return { snapshot: cached, replaced: false, refreshFailures: next.failures };
  if (recordedActivitySnapshotKey(cached) !== recordedActivitySnapshotKey(next)) return { snapshot: next, replaced: true, refreshFailures: next.failures };
  if (Temporal.Instant.compare(Temporal.Instant.from(next.fetchedAt), Temporal.Instant.from(cached.fetchedAt)) < 0) {
    return { snapshot: cached, replaced: false, refreshFailures: next.failures };
  }
  if (next.completeness === "complete") return { snapshot: next, replaced: true, refreshFailures: next.failures };
  return { snapshot: cached, replaced: false, refreshFailures: next.failures };
}

/**
 * Ticket 238 consumer guard. `next` must belong to the active scope; otherwise
 * it is a late response for another account, generation, range, or timezone and
 * returns null without touching state. Only a cache entry for that same scope
 * is compared, so a response can never overwrite another scope's entry.
 */
export function applyScopedRecordedActivityRefresh(input: Readonly<{
  activeScope: RecordedActivitySnapshotScope;
  cached: RecordedActivitySnapshotV1 | null;
  next: RecordedActivitySnapshotV1;
}>): RecordedActivityRefresh | null {
  const active = recordedActivitySnapshotScopeKey(input.activeScope);
  if (recordedActivitySnapshotKey(input.next) !== active) return null;
  const cached = input.cached && recordedActivitySnapshotKey(input.cached) === active ? input.cached : null;
  return applyRecordedActivityRefresh(cached, input.next);
}

export type RecordedActivityDayItem = Readonly<{
  id: string;
  startAt: string;
  endAt: string;
  durationSeconds: number;
}>;

export type RecordedActivityDayView = Readonly<{
  localDate: string;
  /** `incomplete`: the read detected a change or limit; `stale`: older than the refresh window or the last refresh failed. */
  state: "current" | "stale" | "incomplete";
  fetchedAt: string;
  items: RecordedActivityDayItem[];
}>;

export const RECORDED_ACTIVITY_REFRESH_SECONDS = 15 * 60;

/**
 * Projects recorded workouts that intersect one local day. It carries timing
 * only. It never matches, merges, or completes a Behavior or Occurrence.
 */
export function projectRecordedActivityDay(input: Readonly<{
  snapshot: RecordedActivitySnapshotV1;
  localDate: string;
  now: Temporal.Instant;
  refreshFailed?: boolean;
}>): RecordedActivityDayView {
  const timezone = input.snapshot.requestedRange.timezone;
  const day = Temporal.PlainDate.from(input.localDate);
  const dayStart = day.toZonedDateTime({ timeZone: timezone }).toInstant();
  const dayEnd = day.add({ days: 1 }).toZonedDateTime({ timeZone: timezone }).toInstant();
  const fetchedAt = Temporal.Instant.from(input.snapshot.fetchedAt);
  const ageSeconds = input.now.since(fetchedAt).total({ unit: "seconds" });
  const state = input.snapshot.completeness === "incomplete" ? "incomplete"
    : input.refreshFailed || ageSeconds >= RECORDED_ACTIVITY_REFRESH_SECONDS || ageSeconds < 0 ? "stale" : "current";
  const items = input.snapshot.activities
    .filter((activity) => Temporal.Instant.compare(Temporal.Instant.from(activity.startAt), dayEnd) < 0
      && Temporal.Instant.compare(Temporal.Instant.from(activity.endAt), dayStart) > 0)
    .map((activity) => ({ id: activity.id, startAt: activity.startAt, endAt: activity.endAt, durationSeconds: activity.duration.seconds }))
    .sort((left, right) => Temporal.Instant.compare(Temporal.Instant.from(left.startAt), Temporal.Instant.from(right.startAt)) || left.id.localeCompare(right.id));
  return { localDate: input.localDate, state, fetchedAt: input.snapshot.fetchedAt, items };
}
