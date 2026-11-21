import { Temporal } from "@js-temporal/polyfill";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BehaviorGraphRecord } from "@cadence/core/behavior-store";
import type { OccurrenceRecord } from "@cadence/core/data-store";
import { resolvePersistedTimeline } from "@cadence/core/services/timeline.service";

const mocks = vi.hoisted(() => ({
  getBehaviorById: vi.fn(),
  syncReminderDeliveriesForBehavior: vi.fn(),
  reportMonitoringError: vi.fn(),
}));

vi.mock("@/lib/db/behaviors.repo", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getBehaviorById: mocks.getBehaviorById,
}));
vi.mock("@/lib/services/reminder.service", () => ({
  syncReminderDeliveriesForBehavior: mocks.syncReminderDeliveriesForBehavior,
}));
vi.mock("@/lib/monitoring/privacy-safe-events", () => ({
  reportMonitoringError: mocks.reportMonitoringError,
}));

import {
  addOpportunityToToday,
  parseAddOpportunityFormData,
  removeOpportunityFromToday,
} from "../lib/services/opportunity.service";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const BEHAVIOR_ID = "22222222-2222-4222-8222-222222222222";
const OCCURRENCE_ID = "33333333-3333-4333-8333-333333333333";
const TIMEZONE = "America/New_York";
// 14:02 local on 2026-11-21.
const NOW = Temporal.Instant.from("2026-11-21T19:02:30Z");

function behavior(overrides: Partial<BehaviorGraphRecord> = {}): BehaviorGraphRecord {
  return {
    id: BEHAVIOR_ID, user_id: USER_ID, current_configuration_event_id: null,
    created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T00:00:00Z",
    category_id: null, category: null, title: "Stretch", description: null,
    recurrence_rule: null, scheduled_time: null, is_opportunity: true, timezone: TIMEZONE,
    browser_reminder_enabled: true, email_reminder_enabled: false, reminder_offset_minutes: 0,
    active: true, archived_at: null, schedule_slots: [], schedules: [],
    ...overrides,
  };
}

function occurrence(overrides: Partial<OccurrenceRecord> = {}): OccurrenceRecord {
  return {
    id: OCCURRENCE_ID, user_id: USER_ID, behavior_id: BEHAVIOR_ID,
    behavior_configuration_event_id: null, behavior_schedule_slot_id: null,
    scheduled_for: "2026-11-21T20:00:00Z", local_date: "2026-11-21",
    schedule_kind: "exact", schedule_preset: null, schedule_start_time: "15:00:00", schedule_end_time: null,
    schedule_range_identity: null, status: "unresolved", completed_at: null, status_marked_at: null,
    note: null, created_at: "2026-11-21T19:00:00Z", updated_at: "2026-11-21T19:00:00Z",
    origin: "opportunity", added_by: "user",
    ...overrides,
  };
}

function caller(rpc = vi.fn()) {
  return { supabase: { rpc } as never, userId: USER_ID, now: NOW, rpc };
}

function rpcError(message: string) {
  return { data: null, error: { message, code: "P0001" } };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getBehaviorById.mockResolvedValue(behavior());
});

describe("addOpportunityToToday", () => {
  it("adds at an exact time on today's date in the Behavior's timezone and plans reminders", async () => {
    const added = occurrence();
    const call = caller(vi.fn().mockResolvedValue({ data: { created: true, occurrence: added, status_event: null }, error: null }));

    const result = await addOpportunityToToday(call, { behaviorId: BEHAVIOR_ID, placement: { kind: "exact", startTime: "15:00" } });

    expect(call.rpc).toHaveBeenCalledWith("add_opportunity_occurrence", {
      target_behavior_id: BEHAVIOR_ID, planned_local_date: "2026-11-21", planned_start_time: "15:00",
      planned_added_by: "user", mark_completed: false,
    });
    expect(result).toMatchObject({ outcome: "added", created: true, notice: { id: "opportunity.added", params: { title: "Stretch", time: "3:00 PM" } } });
    expect(mocks.syncReminderDeliveriesForBehavior).toHaveBeenCalledWith(call.supabase, USER_ID, expect.objectContaining({ id: BEHAVIOR_ID }),
      { scheduledFrom: "2026-11-21", occurrences: [added], now: NOW });
  });

  it("logs Done now at the current minute, Completed in one write, with no reminder", async () => {
    const call = caller(vi.fn().mockResolvedValue({ data: {
      created: true, occurrence: occurrence({ status: "completed", schedule_start_time: "14:02:00" }), status_event: { id: "e" },
    }, error: null }));

    const result = await addOpportunityToToday(call, { behaviorId: BEHAVIOR_ID, placement: { kind: "done_now" } });

    expect(call.rpc.mock.calls[0]![1]).toMatchObject({ planned_start_time: "14:02", mark_completed: true });
    expect(result).toMatchObject({ outcome: "logged", notice: { id: "opportunity.logged", params: { time: "2:02 PM" } } });
    expect(mocks.syncReminderDeliveriesForBehavior).not.toHaveBeenCalled();
  });

  it("sends a preset window as its range and preset", async () => {
    const call = caller(vi.fn().mockResolvedValue({ data: { created: true, occurrence: occurrence({
      schedule_kind: "range", schedule_preset: "evening", schedule_start_time: "18:00:00", schedule_end_time: "00:00:00",
    }), status_event: null }, error: null }));

    const result = await addOpportunityToToday(call, { behaviorId: BEHAVIOR_ID, placement: { kind: "preset", preset: "evening" } });

    expect(call.rpc.mock.calls[0]![1]).toMatchObject({ planned_start_time: "18:00", planned_end_time: "00:00", planned_preset: "evening" });
    expect(result).toMatchObject({ notice: { params: { time: "Evening" } } });
  });

  it("refuses a range that starts and ends at the same time without calling Cadence", async () => {
    const call = caller();
    const result = await addOpportunityToToday(call, { behaviorId: BEHAVIOR_ID, placement: { kind: "range", startTime: "15:00", endTime: "15:00" } });
    expect(result).toMatchObject({ outcome: "refused", reason: "invalid_time", notice: { id: "opportunity.refused.time" } });
    expect(call.rpc).not.toHaveBeenCalled();
  });

  it("refuses a Behavior that is not in the account", async () => {
    mocks.getBehaviorById.mockResolvedValue(null);
    const result = await addOpportunityToToday(caller(), { behaviorId: BEHAVIOR_ID, placement: { kind: "done_now" } });
    expect(result).toMatchObject({ outcome: "refused", reason: "not_available" });
  });

  it.each([
    ["This Behavior is not available as an opportunity.", "not_available", "opportunity.refused.not-available"],
    ["An archived Behavior cannot be added.", "not_available", "opportunity.refused.not-available"],
    ["This Behavior is not running at that time.", "not_running", "opportunity.refused.not-running"],
    ["An opportunity can be added to today only.", "not_today", "opportunity.refused.not-today"],
    ["A time range needs an end that differs from its start.", "invalid_time", "opportunity.refused.time"],
  ])("maps the refusal %s", async (message, reason, noticeId) => {
    const result = await addOpportunityToToday(caller(vi.fn().mockResolvedValue(rpcError(message))),
      { behaviorId: BEHAVIOR_ID, placement: { kind: "exact", startTime: "15:00" } });
    expect(result).toMatchObject({ outcome: "refused", reason, notice: { id: noticeId, params: { title: "Stretch" } } });
  });

  it("rethrows an error that is not a refusal", async () => {
    await expect(addOpportunityToToday(caller(vi.fn().mockResolvedValue(rpcError("Authentication required."))),
      { behaviorId: BEHAVIOR_ID, placement: { kind: "exact", startTime: "15:00" } })).rejects.toThrow("Authentication required.");
  });

  it("keeps the added item when reminder planning fails", async () => {
    mocks.syncReminderDeliveriesForBehavior.mockRejectedValue(new Error("down"));
    const result = await addOpportunityToToday(
      caller(vi.fn().mockResolvedValue({ data: { created: true, occurrence: occurrence(), status_event: null }, error: null })),
      { behaviorId: BEHAVIOR_ID, placement: { kind: "exact", startTime: "15:00" } });
    expect(result.outcome).toBe("added");
    expect(mocks.reportMonitoringError).toHaveBeenCalledWith("opportunity.reminder_planning_failed", expect.any(Error));
  });
});

describe("removeOpportunityFromToday", () => {
  it("removes a clean added item and names it in the notice", async () => {
    const call = caller(vi.fn().mockResolvedValue({ data: { removed: true, occurrence: occurrence(), cancelled_reminder_count: 1 }, error: null }));
    const result = await removeOpportunityFromToday(call, { occurrenceId: OCCURRENCE_ID, title: "Stretch" });
    expect(call.rpc).toHaveBeenCalledWith("remove_opportunity_occurrence", { target_occurrence_id: OCCURRENCE_ID });
    expect(result).toMatchObject({ outcome: "removed", cancelledReminderCount: 1, notice: { id: "opportunity.removed", params: { title: "Stretch" } } });
  });

  it.each([
    ["Only an Unresolved opportunity can be removed.", "marked"],
    ["An opportunity with a Note cannot be removed.", "kept"],
    ["An opportunity with tracked time cannot be removed.", "kept"],
    ["An opportunity with status history cannot be removed.", "kept"],
    ["An opportunity with a connected activity cannot be removed.", "kept"],
    ["Only an added opportunity can be removed.", "not_found"],
    ["Occurrence not found.", "not_found"],
  ])("maps the refusal %s", async (message, reason) => {
    const result = await removeOpportunityFromToday(caller(vi.fn().mockResolvedValue(rpcError(message))), { occurrenceId: OCCURRENCE_ID });
    expect(result).toMatchObject({ outcome: "refused", reason });
  });
});

describe("parseAddOpportunityFormData", () => {
  const form = (entries: Array<[string, string]>) => {
    const data = new FormData();
    for (const [key, value] of entries) data.append(key, value);
    return data;
  };

  it("reads a placement and keeps a client id for replay", () => {
    expect(parseAddOpportunityFormData(form([
      ["behavior_id", BEHAVIOR_ID], ["placement", "range"], ["start_time", "15:00"], ["end_time", "15:30"],
      ["client_occurrence_id", OCCURRENCE_ID],
    ]))).toEqual({ behaviorId: BEHAVIOR_ID, placement: { kind: "range", startTime: "15:00", endTime: "15:30" }, addedBy: "user", occurrenceId: OCCURRENCE_ID });
  });

  it("returns null for an unknown placement or preset", () => {
    expect(parseAddOpportunityFormData(form([["behavior_id", BEHAVIOR_ID], ["placement", "anytime"]]))).toBeNull();
    expect(parseAddOpportunityFormData(form([["behavior_id", BEHAVIOR_ID], ["placement", "preset"], ["preset", "noon"]]))).toBeNull();
  });
});

describe("resolvePersistedTimeline with opportunity rows", () => {
  const removalFacts = { statusHistoryOccurrenceIds: new Set<string>(), activeSourceMatchOccurrenceIds: new Set<string>() };

  it("reads an unscheduled opportunity Behavior and offers Remove on a clean added row", () => {
    const view = resolvePersistedTimeline({ behaviors: [behavior()], occurrences: [occurrence()], timeSessions: [], now: NOW, timezone: TIMEZONE, removalFacts });
    const row = view.daySections.flatMap((section) => section.occurrences)[0]!;
    expect(row).toMatchObject({ origin: "opportunity", addedBy: "user", canRemove: true, scheduleSummary: "" });
  });

  it("hides Remove for a zero-length time session, status history or missing facts", () => {
    const session = { id: "s", userId: USER_ID, occurrenceId: OCCURRENCE_ID, behaviorId: BEHAVIOR_ID,
      startedAt: "2026-11-21T19:00:00Z", stoppedAt: "2026-11-21T19:00:00Z" };
    const rowOf = (view: ReturnType<typeof resolvePersistedTimeline>) => view.daySections.flatMap((section) => section.occurrences)[0]!;
    expect(rowOf(resolvePersistedTimeline({ behaviors: [behavior()], occurrences: [occurrence()], timeSessions: [session], now: NOW, timezone: TIMEZONE, removalFacts })).canRemove).toBe(false);
    expect(rowOf(resolvePersistedTimeline({ behaviors: [behavior()], occurrences: [occurrence()], timeSessions: [], now: NOW, timezone: TIMEZONE,
      removalFacts: { ...removalFacts, statusHistoryOccurrenceIds: new Set([OCCURRENCE_ID]) } })).canRemove).toBe(false);
    expect(rowOf(resolvePersistedTimeline({ behaviors: [behavior()], occurrences: [occurrence()], timeSessions: [], now: NOW, timezone: TIMEZONE })).canRemove).toBe(false);
  });

  it("lists running opportunity Behaviors with a default start clear of today's items", () => {
    const view = resolvePersistedTimeline({
      behaviors: [behavior({ default_duration_minutes: 20 }), behavior({ id: "44444444-4444-4444-8444-444444444444", title: "Paused", pause_from_on: "2026-11-20", pause_back_on: "2026-11-30" })],
      // An open item at 14:05 local blocks the rounded-up start.
      occurrences: [occurrence({ scheduled_for: "2026-11-21T19:05:00Z", schedule_start_time: "14:05:00" })],
      timeSessions: [], now: NOW, timezone: TIMEZONE, removalFacts,
    });
    expect(view.opportunityPool).toHaveLength(1);
    expect(view.opportunityPool![0]).toMatchObject({ behaviorId: BEHAVIOR_ID, onToday: true, lengthMinutes: 20, suggestedStart: { source: "free_slot" } });
    expect(view.opportunityPool![0]!.suggestedStart.localTime > "14:05").toBe(true);
  });

});
