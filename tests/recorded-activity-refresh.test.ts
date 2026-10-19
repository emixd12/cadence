import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";

import { combineExternalEventFreshness } from "@cadence/core/services/external-event-projection";
import {
  applyRecordedActivityRefresh,
  applyScopedRecordedActivityRefresh,
  projectRecordedActivityDay,
  recordedActivitySnapshotKey,
} from "@cadence/core/services/recorded-activity-refresh";
import { validateRecordedActivitySnapshot } from "@cadence/core/services/recorded-activity-validation";
import type { RecordedActivitySnapshotScope, RecordedActivitySnapshotV1 } from "@cadence/core/types/recorded-activity";
import { applyHevyActivityRefresh } from "@/lib/services/hevy.service";
import fixture from "./fixtures/recorded-activity-snapshot.valid.json";

const base = validateRecordedActivitySnapshot(fixture, { now: Temporal.Instant.from("2026-11-01T15:00:00Z") });

function todaySnapshot(overrides: Partial<RecordedActivitySnapshotV1> = {}): RecordedActivitySnapshotV1 {
  return { ...base, requestedRange: { startLocalDate: "2026-11-01", endLocalDate: "2026-11-01", timezone: "America/New_York" },
    activities: base.activities.filter((activity) => activity.localStartDate === "2026-11-01"), ...overrides };
}

const scope: RecordedActivitySnapshotScope = { source: "hevy", accountId: "account-1", connectionGeneration: 1,
  startLocalDate: "2026-11-01", endLocalDate: "2026-11-01", timezone: "America/New_York" };
const incomplete = (snapshot: RecordedActivitySnapshotV1): RecordedActivitySnapshotV1 => ({ ...snapshot, completeness: "incomplete", activities: [],
  fetchedAt: "2026-11-01T15:01:00Z", failures: [{ code: "timeout", retryable: true, retryAfterSeconds: null, message: "Timed out" }] });

describe("recorded activity refresh rule (Ticket 225 extraction)", () => {
  it("keeps the Hevy service export bound to the shared pure rule", () => {
    expect(applyHevyActivityRefresh).toBe(applyRecordedActivityRefresh);
  });

  it("rejects late responses for another account, generation, range, or timezone before touching state", () => {
    const current = todaySnapshot();
    for (const late of [
      { ...current, accountId: "account-2" },
      { ...current, connectionGeneration: 2 },
      { ...current, requestedRange: { ...current.requestedRange, startLocalDate: "2026-10-31" } },
      { ...current, requestedRange: { ...current.requestedRange, timezone: "Europe/Madrid" } },
    ]) {
      expect(applyScopedRecordedActivityRefresh({ activeScope: scope, cached: current, next: late })).toBeNull();
    }
  });

  it("compares a refresh only with the same-scope cache entry", () => {
    const otherRange = { ...todaySnapshot(), requestedRange: { ...todaySnapshot().requestedRange, startLocalDate: "2026-10-31" } };
    const next = incomplete(todaySnapshot());
    // A cache entry from another range is never kept as a fallback for this scope.
    expect(applyScopedRecordedActivityRefresh({ activeScope: scope, cached: otherRange, next })).toEqual({ snapshot: next, replaced: true, refreshFailures: next.failures });
    // The same-scope complete entry survives an incomplete read.
    const cached = todaySnapshot();
    expect(applyScopedRecordedActivityRefresh({ activeScope: scope, cached, next })?.snapshot).toBe(cached);
    // An earlier fetch is late and ignored; a later complete fetch replaces.
    const older = { ...todaySnapshot(), fetchedAt: "2026-11-01T14:00:00Z", activities: [] };
    expect(applyScopedRecordedActivityRefresh({ activeScope: scope, cached, next: older })?.snapshot).toBe(cached);
    const newer = { ...todaySnapshot(), fetchedAt: "2026-11-01T15:02:00Z", activities: [] };
    expect(applyScopedRecordedActivityRefresh({ activeScope: scope, cached, next: newer })?.snapshot).toBe(newer);
    expect(recordedActivitySnapshotKey(newer)).toBe(recordedActivitySnapshotKey(cached));
  });

  it("projects only timing for workouts intersecting the local day and labels freshness", () => {
    const snapshot = { ...todaySnapshot(), activities: [...base.activities].reverse() };
    const now = Temporal.Instant.from("2026-11-01T15:05:00Z");
    const day = projectRecordedActivityDay({ snapshot, localDate: "2026-11-01", now });
    expect(day).toEqual({ localDate: "2026-11-01", state: "current", fetchedAt: "2026-11-01T15:00:00Z", items: [
      { id: base.activities[2]!.id, startAt: "2026-11-01T05:30:00Z", endAt: "2026-11-01T06:30:00Z", durationSeconds: 3600 },
    ] });
    expect(Object.keys(day.items[0]!).sort()).toEqual(["durationSeconds", "endAt", "id", "startAt"]);
    expect(projectRecordedActivityDay({ snapshot, localDate: "2026-11-01", now: now.add({ minutes: 15 }) }).state).toBe("stale");
    expect(projectRecordedActivityDay({ snapshot, localDate: "2026-11-01", now, refreshFailed: true }).state).toBe("stale");
    expect(projectRecordedActivityDay({ snapshot: incomplete(snapshot), localDate: "2026-11-01", now }).state).toBe("incomplete");
    // A workout that starts the evening before and crosses midnight belongs to both days.
    const overnight = { ...snapshot, activities: [{ ...base.activities[2]!, startAt: "2026-11-01T03:30:00Z", localStartDate: "2026-10-31", duration: { kind: "known" as const, seconds: 10800 } }] };
    expect(projectRecordedActivityDay({ snapshot: overnight, localDate: "2026-11-01", now }).items).toHaveLength(1);
    expect(projectRecordedActivityDay({ snapshot: overnight, localDate: "2026-11-02", now }).items).toHaveLength(0);
  });
});

describe("combined calendar freshness", () => {
  const current = { state: "current" as const, refreshedAt: "2026-11-01T13:00:00Z", label: "Calendar current", canAssertNoOverlap: true };
  it("asserts no overlap only when every active source can", () => {
    expect(combineExternalEventFreshness([])).toBeNull();
    expect(combineExternalEventFreshness([current])).toBe(current);
    expect(combineExternalEventFreshness([current, { ...current, refreshedAt: "2026-11-01T12:00:00Z" }])).toEqual({ ...current, refreshedAt: "2026-11-01T12:00:00Z" });
    expect(combineExternalEventFreshness([current, { ...current, canAssertNoOverlap: false }])?.canAssertNoOverlap).toBe(false);
    const stale = { state: "stale" as const, refreshedAt: null, label: "Stale", canAssertNoOverlap: true };
    const unavailable = { state: "unavailable" as const, refreshedAt: null, label: "Unavailable", canAssertNoOverlap: false };
    expect(combineExternalEventFreshness([current, stale])).toEqual({ ...stale, canAssertNoOverlap: false });
    expect(combineExternalEventFreshness([stale, unavailable, current])).toEqual(unavailable);
  });
});

describe("connector client boundaries", () => {
  const root = process.cwd();
  const clientFiles = [
    "lib/ui/connectors.ts", "lib/ui/timeline-connector-reloads.ts",
    "components/settings/ConnectorLibrary.tsx", "components/settings/HevyPanel.tsx", "components/settings/OutlookCalendarPanel.tsx",
    "components/settings/WebConnectorLibrary.tsx", "components/timeline/RecordedActivityList.tsx",
    "packages/core/src/services/recorded-activity-refresh.ts",
    ...readdirSync(path.join(root, "apps/desktop/src/calendar")).map((file) => `apps/desktop/src/calendar/${file}`),
  ];
  it("never imports server crypto, credential, or provider modules into web or desktop clients", () => {
    for (const file of clientFiles) {
      const source = readFileSync(path.join(root, file), "utf8");
      expect(source, file).not.toMatch(/from ["'](?:node:crypto|crypto|@\/lib\/services\/|@\/lib\/db\/|\.\.?\/.*services\/(?:hevy|outlook|connector))/);
      expect(source, file).not.toMatch(/process\.env/);
    }
  });
  it("never logs Outlook codes, states, client states, or Hevy keys", () => {
    for (const file of clientFiles) {
      expect(readFileSync(path.join(root, file), "utf8"), file).not.toMatch(/console\.(log|info|warn|error|debug)/);
    }
  });
});
