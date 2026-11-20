import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";

import type { MarkDetailCommit, OccurrenceRecord } from "@cadence/core/data-store";
import { resolveAccountSync, type AccountSyncEntity } from "@cadence/core/resolvers/account-sync.resolver";
import {
  isMarkDetailEvent, LATE_MARK_THRESHOLD_MINUTES, MARK_DETAIL_PROMPTS, MarkDetailRefusal, markDetailPromptPicked, notDoneReasonOf,
  resolveDoneAtDetail, resolveNotDoneReasonDetail,
} from "@cadence/core/resolvers/status.resolver";
import { recordOccurrenceDoneAt, recordOccurrenceNotDoneReason } from "@cadence/core/services/occurrence.service";
import { lateMarkOffer, localTimeToInstant } from "@/components/timeline/OccurrenceMarkDetails";

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

  it("shows the lines as often as the tunable settings say", () => {
    expect(MARK_DETAIL_PROMPTS.doneAt.lateAfterMinutes).toBe(LATE_MARK_THRESHOLD_MINUTES);
    const ids = Array.from({ length: 400 }, (_, index) => `occ-${index}`);
    expect(ids.every((id) => markDetailPromptPicked("done_at", id, "2026-11-19", 1))).toBe(true);
    expect(ids.some((id) => markDetailPromptPicked("not_done_reason", id, "2026-11-19", 0))).toBe(false);
    const shown = ids.filter((id) => markDetailPromptPicked("not_done_reason", id, "2026-11-19", 0.25)).length;
    expect(shown).toBeGreaterThan(60);
    expect(shown).toBeLessThan(140);
    // The same item and day always gets the same answer.
    expect(markDetailPromptPicked("done_at", "occ-7", "2026-11-19", 0.5)).toBe(markDetailPromptPicked("done_at", "occ-7", "2026-11-19", 0.5));
    // A higher late threshold asks less often.
    const occurrence = { scheduledFor: sevenAm, scheduledTimeLabel: "7:00 AM", scheduleKind: "exact" as const, scheduleEndTime: null, localDate: "2026-11-19" };
    const threeHoursLate = Temporal.Instant.from(sevenAm).add({ hours: 3 }).toString();
    expect(lateMarkOffer(occurrence, threeHoursLate, TZ)).not.toBeNull();
    expect(lateMarkOffer(occurrence, threeHoursLate, TZ, 240)).toBeNull();
  });
});
