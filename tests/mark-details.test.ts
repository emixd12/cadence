import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";

import type { MarkDetailCommit, OccurrenceRecord } from "@cadence/core/data-store";
import { resolveAccountSync, type AccountSyncEntity } from "@cadence/core/resolvers/account-sync.resolver";
import { resolveDayLoad } from "@cadence/core/resolvers/day-load.resolver";
import {
  isMarkDetailEvent, LATE_MARK_THRESHOLD_MINUTES, MarkDetailRefusal, notDoneReasonOf,
  resolveDoneAtDetail, resolveNotDoneReasonDetail,
} from "@cadence/core/resolvers/status.resolver";
import { recordOccurrenceDoneAt, recordOccurrenceNotDoneReason } from "@cadence/core/services/occurrence.service";
import type { BehaviorDurationEstimate, NormalizedExternalEvent } from "@cadence/core/types/day-progress";
import { lateMarkOffer, localTimeToInstant } from "@/components/timeline/OccurrenceMarkDetails";
import { computeDayLoad, type DayLoadReads } from "@/lib/services/day-load.service";

const TZ = "America/New_York";
const now = Temporal.Instant.from("2026-11-19T18:13:00Z");
const tap = "2026-11-19T18:12:00Z"; // 1:12 PM
const sevenAm = "2026-11-19T12:00:00Z";

function occurrence(status: string, overrides: Partial<OccurrenceRecord> = {}): OccurrenceRecord {
  return {
    id: "o1", user_id: "u", behavior_id: "b1", behavior_configuration_event_id: null, behavior_schedule_slot_id: null,
    scheduled_for: sevenAm, local_date: "2026-11-19", schedule_kind: "exact", schedule_preset: null,
    schedule_start_time: "07:00:00", schedule_end_time: null, schedule_range_identity: null, status,
    completed_at: status === "completed" ? tap : null, status_marked_at: status === "unresolved" ? null : tap,
    note: null, created_at: tap, updated_at: tap, ...overrides,
  };
}

function store(record: OccurrenceRecord) {
  const commits: MarkDetailCommit[] = [];
  return {
    commits,
    store: {
      readStatusContext: async () => ({ occurrence: record, latestStatusEventId: "mark", timezone: TZ }),
      applyMarkDetail: async (commit: MarkDetailCommit) => {
        commits.push(commit);
        return { occurrence: { ...record, completed_at: commit.completedAt }, statusEvent: {} as never };
      },
    },
  };
}

describe("mark details (advisor plan 4G)", () => {
  it("stores 7:00 AM as done-at on a late mark and keeps the tap time", async () => {
    const { store: fake, commits } = store(occurrence("completed"));
    const result = await recordOccurrenceDoneAt(fake, { occurrenceId: "o1", doneAt: Temporal.Instant.from(sevenAm), now });
    expect(commits).toEqual([{
      occurrenceId: "o1", expectedLatestEventId: "mark", completedAt: sevenAm,
      event: {
        previousStatus: "completed", status: "completed", statusSemantics: "explicit_user_correction",
        recordedAt: now.toString(), effectiveAt: sevenAm, sourceCaptureMethod: "manual_tap", sourceConfidence: "high", reasonCode: "done_at",
      },
    }]);
    expect(result.occurrence.completed_at).toBe(sevenAm);
    expect(result.occurrence.status_marked_at).toBe(tap);
  });

  it("refuses a done time after the tap, before the item's day, or on an item no longer Completed", () => {
    const base = { status: "completed", statusMarkedAt: tap, localDate: "2026-11-19" };
    expect(() => resolveDoneAtDetail({ occurrence: base, timezone: TZ, doneAt: Temporal.Instant.from("2026-11-19T18:30:00Z"), now }))
      .toThrow(MarkDetailRefusal);
    expect(() => resolveDoneAtDetail({ occurrence: base, timezone: TZ, doneAt: Temporal.Instant.from("2026-11-19T04:59:00Z"), now }))
      .toThrow("before the item's day");
    expect(() => resolveDoneAtDetail({ occurrence: { ...base, status: "not_completed" }, timezone: TZ, doneAt: Temporal.Instant.from(sevenAm), now }))
      .toThrow("no longer Completed");
    // Midnight local is the earliest allowed time.
    expect(resolveDoneAtDetail({ occurrence: base, timezone: TZ, doneAt: Temporal.Instant.from("2026-11-19T05:00:00Z"), now }).completedAt)
      .toBe("2026-11-19T05:00:00Z");
  });

  it("stores a reason on Not Completed without changing the mark", async () => {
    const { store: fake, commits } = store(occurrence("not_completed"));
    await recordOccurrenceNotDoneReason(fake, { occurrenceId: "o1", reason: "low_energy", now });
    expect(commits[0]).toMatchObject({ completedAt: null, event: { previousStatus: "not_completed", status: "not_completed", effectiveAt: tap, reasonCode: "not_done:low_energy" } });
    expect(() => resolveNotDoneReasonDetail({ occurrence: { status: "not_completed", statusMarkedAt: tap }, reason: "lazy", now })).toThrow("listed reasons");
    expect(notDoneReasonOf("not_done:away")).toBe("away");
    expect(notDoneReasonOf("connector:hevy")).toBeNull();
    expect(isMarkDetailEvent({ previousStatus: "not_completed", status: "not_completed", reasonCode: "not_done:forgot" })).toBe(true);
    expect(isMarkDetailEvent({ previousStatus: "unresolved", status: "completed", reasonCode: null })).toBe(false);
  });

  it("offers the line only after the threshold, and a range only past its end", () => {
    const row = { scheduledFor: sevenAm, scheduledTimeLabel: "7:00 AM", scheduleKind: "exact" as const, localDate: "2026-11-19" };
    const justBefore = Temporal.Instant.from(sevenAm).add({ minutes: LATE_MARK_THRESHOLD_MINUTES - 1 }).toString();
    expect(lateMarkOffer(row, justBefore, TZ)).toBeNull();
    expect(lateMarkOffer(row, tap, TZ)).toEqual({ setTime: sevenAm, setTimeLabel: "7:00 AM" });
    const range = { ...row, scheduleKind: "range" as const, scheduledTimeLabel: "Morning", scheduleEndTime: "12:00" };
    expect(lateMarkOffer(range, tap, TZ)).toBeNull(); // 1:12 PM is 72 minutes after noon
    expect(lateMarkOffer(range, "2026-11-19T19:30:00Z", TZ)).toEqual({ setTime: null, setTimeLabel: null });
    expect(localTimeToInstant("2026-11-19", "08:30", TZ)).toBe("2026-11-19T13:30:00Z");
  });

  it("syncs a detail event web to Mac and back as a plain append", () => {
    const user = { user_id: "owner", behavior_id: "b", local_date: "2026-11-19", timezone: TZ, source_capture_method: "manual_tap", source_confidence: "high" };
    const mark: AccountSyncEntity = { kind: "status_event", id: "mark", value: { id: "mark", occurrence_id: "o", revises_event_id: null,
      previous_status: "unresolved", status: "not_completed", status_semantics: "explicit_user_mark", recorded_at: tap, effective_at: tap, reason_code: null, ...user } };
    const reason: AccountSyncEntity = { kind: "status_event", id: "reason", value: { id: "reason", occurrence_id: "o", revises_event_id: "mark",
      previous_status: "not_completed", status: "not_completed", status_semantics: "explicit_user_correction", recorded_at: now.toString(), effective_at: tap,
      reason_code: "not_done:away", ...user } };
    const occ: AccountSyncEntity = { kind: "occurrence", id: "o", value: { id: "o", behavior_id: "b", status: "not_completed", status_marked_at: tap, completed_at: null } };
    const behavior: AccountSyncEntity = { kind: "behavior", id: "b", value: { id: "b", title: "Walk" } };
    const profile: AccountSyncEntity = { kind: "profile", id: "profile", value: { timezone: TZ } };
    const before = { entities: [profile, behavior, occ, mark] };
    const after = { entities: [profile, behavior, occ, mark, reason] };
    const fromMac = resolveAccountSync({ accountLinkId: "link", baseline: before, local: after, hosted: before });
    expect(fromMac.conflicts).toEqual([]);
    expect(fromMac.hostedWrites.map(({ kind, id }) => `${kind}:${id}`)).toEqual(["status_event:reason"]);
    const fromWeb = resolveAccountSync({ accountLinkId: "link", baseline: before, local: before, hosted: after });
    expect(fromWeb.conflicts).toEqual([]);
    expect(fromWeb.localWrites.map(({ kind, id }) => `${kind}:${id}`)).toEqual(["status_event:reason"]);
  });
});

describe("day load (advisor plan 4G)", () => {
  const known = (seconds: number, provenance: "behavior_default" | "completed_stopped_occurrence_mean"): BehaviorDurationEstimate =>
    ({ kind: "known", seconds, durationLabel: "", sampleCount: 3, lookbackDays: 90, provenance });
  const timed = (id: string, start: string, end: string, extra: Partial<Record<string, unknown>> = {}) => ({
    kind: "timed", id, logicalInstanceId: id, source: "google_calendar", startAt: start, endAt: end, endUnspecified: false,
    duration: { kind: "known", seconds: 0 }, state: "confirmed", currentUserResponse: "accepted", ...extra,
  }) as unknown as NormalizedExternalEvent;

  it("matches a hand-checked day and leaves out a Behavior with no length", () => {
    const load = resolveDayLoad({
      localDate: "2026-11-19", timezone: TZ,
      items: [{ behaviorId: "gym" }, { behaviorId: "read" }, { behaviorId: "walk" }, { behaviorId: "gym" }],
      lengths: new Map([
        ["gym", known(45 * 60, "behavior_default")],
        ["read", known(20 * 60, "completed_stopped_occurrence_mean")],
        // A model's guess never counts.
        ["walk", { kind: "known", seconds: 30 * 60, durationLabel: "", sampleCount: 0, lookbackDays: 90, provenance: "description_estimate" } as unknown as BehaviorDurationEstimate],
      ]),
      calendarEvents: [
        timed("a", "2026-11-19T14:00:00Z", "2026-11-19T15:00:00Z"), // 9-10 AM
        timed("b", "2026-11-19T14:30:00Z", "2026-11-19T15:30:00Z"), // overlaps: union 9-10:30
        timed("a", "2026-11-19T14:00:00Z", "2026-11-19T15:00:00Z"), // same event twice
        timed("c", "2026-11-20T04:00:00Z", "2026-11-20T06:00:00Z"), // 11 PM-1 AM: 60 min on this day
        timed("d", "2026-11-19T18:00:00Z", "2026-11-19T19:00:00Z", { currentUserResponse: "declined" }),
        timed("e", "2026-11-19T18:00:00Z", "2026-11-19T19:00:00Z", { endUnspecified: true }),
        { kind: "all_day", id: "f", startLocalDate: "2026-11-19", endLocalDate: "2026-11-20" } as unknown as NormalizedExternalEvent,
      ],
    });
    expect(load).toEqual({ localDate: "2026-11-19", calendarMinutes: 150, calendarEvents: 3, itemMinutes: 110, itemsCounted: 3, itemsNoLength: 1 });
  });

  it("reads no calendar when the source is off and uses a logged average, never the 30-minute default", async () => {
    let calendarRead = false;
    const session = (id: string, occurrenceId: string, minutes: number) => ({ id, user_id: "u", occurrence_id: occurrenceId, behavior_id: "read",
      started_at: "2026-11-10T12:00:00Z", stopped_at: Temporal.Instant.from("2026-11-10T12:00:00Z").add({ minutes }).toString() });
    const reads: DayLoadReads = {
      behaviors: async () => [{ id: "read", default_duration_minutes: null }, { id: "walk", default_duration_minutes: null }],
      occurrences: async (start) => start === "2026-11-19"
        ? [{ id: "t1", behavior_id: "read", local_date: "2026-11-19", status: "unresolved" }, { id: "t2", behavior_id: "walk", local_date: "2026-11-19", status: "unresolved" }]
        : ["h1", "h2", "h3"].map((id) => ({ id, behavior_id: "read", local_date: "2026-11-10", status: "completed" })),
      sessions: async () => [session("s1", "h1", 10), session("s2", "h2", 20), session("s3", "h3", 30)],
      calendarEvents: async () => { calendarRead = true; return []; },
    };
    const load = await computeDayLoad(reads, { localDate: "2026-11-19", timezone: TZ, now, calendarSourceOn: false });
    expect(calendarRead).toBe(false);
    expect(load).toEqual({ localDate: "2026-11-19", calendarMinutes: null, calendarEvents: null, itemMinutes: 20, itemsCounted: 1, itemsNoLength: 1 });
    const failing = await computeDayLoad({ ...reads, calendarEvents: async () => { throw new Error("down"); } },
      { localDate: "2026-11-19", timezone: TZ, now, calendarSourceOn: true });
    expect(failing.calendarMinutes).toBeNull();
  });
});
