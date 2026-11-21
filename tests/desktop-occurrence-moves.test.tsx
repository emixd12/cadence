import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";
import { applyOccurrenceMoves } from "../apps/desktop/src/local-moves.service";
import { planNativeReminderRequests } from "@cadence/core/resolvers/native-reminder.resolver";
import { resolvePersistedTimeline } from "@cadence/core/services/timeline.service";
import type { OccurrenceRecord } from "@cadence/core/data-store";
import type { OccurrenceMoveRecord } from "../apps/desktop/src/local-store";
import { OccurrenceRow } from "../components/timeline/OccurrenceRow";
import { renderToStaticMarkup } from "./helpers/render-with-refresh";
import { storedBehavior, USER_ID } from "./helpers/export-row-fixture";

// Advisor plan, Phase 2B: the Mac shows and reminds at the time a move places an Occurrence.
const NOW = Temporal.Instant.from("2026-08-30T12:00:00Z"); // 8:00 AM in New York
const MOVED_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_ID = "44444444-4444-4444-8444-444444444444";
const behavior = storedBehavior();

function row(overrides: Partial<OccurrenceRecord> = {}): OccurrenceRecord {
  return {
    id: MOVED_ID, user_id: USER_ID, behavior_id: behavior.id, behavior_configuration_event_id: null,
    behavior_schedule_slot_id: null, scheduled_for: "2026-08-30T13:00:00Z", local_date: "2026-08-30",
    schedule_kind: "exact", schedule_preset: null, schedule_start_time: "09:00", schedule_end_time: null,
    schedule_range_identity: null, status: "unresolved", completed_at: null, status_marked_at: null,
    note: null, created_at: NOW.toString(), updated_at: NOW.toString(), ...overrides,
  };
}

function move(overrides: Partial<OccurrenceMoveRecord> = {}): OccurrenceMoveRecord {
  return {
    id: "50000000-0000-4000-8000-000000000001", user_id: USER_ID, occurrence_id: MOVED_ID, behavior_id: behavior.id,
    local_date: "2026-08-30", weekday: 7, timezone: "America/New_York", kind: "move",
    from_start_at: "2026-08-30T13:00:00Z", from_end_at: "2026-08-30T13:30:00Z", from_planned: true,
    to_start_at: "2026-08-30T15:00:00Z", to_end_at: "2026-08-30T15:30:00Z", to_planned: false,
    duration_source: "planned_length", revises_move_id: null, chain_root_id: "50000000-0000-4000-8000-000000000001",
    chain_position: 1, reason: null, source: "person", created_at: NOW.toString(), ...overrides,
  };
}

const undo = move({ id: "50000000-0000-4000-8000-000000000002", kind: "revert", revises_move_id: "50000000-0000-4000-8000-000000000001",
  chain_position: 2, from_start_at: "2026-08-30T15:00:00Z", from_end_at: "2026-08-30T15:30:00Z", from_planned: false,
  to_start_at: "2026-08-30T13:00:00Z", to_end_at: "2026-08-30T13:30:00Z", to_planned: true, duration_source: "restored" });

describe("synced moves on the Mac", () => {
  it("places a moved Occurrence at its moved time and follows the latest record", () => {
    const [moved] = applyOccurrenceMoves([row()], [move()]);
    expect(moved).toMatchObject({ scheduled_for: "2026-08-30T13:00:00Z", effective_start_at: "2026-08-30T15:00:00Z", effective_end_at: "2026-08-30T15:30:00Z" });
    // Undo returns it to the plan, whatever order the records arrive in.
    expect(applyOccurrenceMoves([row()], [undo, move()])[0]).toMatchObject({ effective_start_at: null });
    // A Behavior timezone change appends a supersede record that returns the item to its plan.
    const supersede = move({ id: "50000000-0000-4000-8000-000000000003", kind: "supersede", source: "system", reason: "timezone_change",
      revises_move_id: "50000000-0000-4000-8000-000000000001", chain_position: 2, timezone: "Europe/London", to_planned: true,
      to_start_at: "2026-08-30T13:00:00Z", to_end_at: "2026-08-30T13:00:00Z", duration_source: "restored" });
    expect(applyOccurrenceMoves([row()], [supersede, move()])[0]).toMatchObject({ effective_start_at: null });
    // No moves leaves the row as stored.
    expect(applyOccurrenceMoves([row()], [])[0]).toEqual(row());
  });

  it("shows the moved time on the Timeline with the planned time beside it", () => {
    const [moved] = applyOccurrenceMoves([row()], [move()]);
    const other = row({ id: OTHER_ID, scheduled_for: "2026-08-30T14:00:00Z", schedule_start_time: "10:00" });
    const timeline = resolvePersistedTimeline({ behaviors: [{ ...behavior, category: null, schedule_slots: [] }],
      occurrences: [moved!, other], timeSessions: [], now: NOW, timezone: "America/New_York" });
    const rows = timeline.daySections.flatMap((section) => section.occurrences);
    expect(rows.map(({ id }) => id)).toEqual([OTHER_ID, MOVED_ID]);
    expect(rows[1]).toMatchObject({ scheduledFor: "2026-08-30T15:00:00Z", scheduledTimeLabel: "11:00 AM", movedFromLabel: "9:00 AM" });
    expect(rows[0]!.movedFromLabel).toBeUndefined();
    const action = async () => ({ status: "success" as const, message: "" });
    const html = renderToStaticMarkup(<OccurrenceRow occurrence={rows[1]!} statusAction={action} noteAction={action}
      startTimeTrackingAction={action} stopTimeTrackingAction={action} resetTimeTrackingAction={action} />);
    expect(html).toContain("Moved from 9:00 AM");
    expect(html).toContain("11:00 AM");
  });

  it("keeps a Daily Brief routine move together: synced step moves group at the new time, and Undo groups them back", () => {
    const parent = { ...behavior, id: "60000000-0000-4000-8000-000000000001", title: "Skin routine", parent_behavior_id: null };
    const step = (id: string, title: string, order: number) => ({ ...behavior, id, title, parent_behavior_id: parent.id,
      inherit_parent_schedule: true, sub_behavior_sort_order: order });
    const cerave = step("60000000-0000-4000-8000-000000000002", "CeraVe", 0);
    const retinol = step("60000000-0000-4000-8000-000000000003", "Retinol", 1);
    const rows = [row({ behavior_id: cerave.id }), row({ id: OTHER_ID, behavior_id: retinol.id })];
    const moves = rows.flatMap((occurrence, index) => [move({ id: `5000000${index}-0000-4000-8000-000000000011`, occurrence_id: occurrence.id, behavior_id: occurrence.behavior_id })]);
    const undos = rows.map((occurrence, index) => ({ ...undo, id: `5000000${index}-0000-4000-8000-000000000012`, occurrence_id: occurrence.id, behavior_id: occurrence.behavior_id }));
    const groups = (occurrences: OccurrenceRecord[]) => resolvePersistedTimeline({
      behaviors: [parent, cerave, retinol].map((item) => ({ ...item, category: null, schedule_slots: [] })),
      occurrences, timeSessions: [], now: NOW, timezone: "America/New_York",
    }).daySections.flatMap((section) => section.parentGroups);

    const moved = groups(applyOccurrenceMoves(rows, moves));
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({ title: "Skin routine", scheduledFor: "2026-08-30T15:00:00Z", scheduledTimeLabel: "11:00 AM" });
    expect(moved[0]!.children.map((child) => child.title)).toEqual(["CeraVe", "Retinol"]);

    const back = groups(applyOccurrenceMoves(rows, [...moves, ...undos]));
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ scheduledFor: "2026-08-30T13:00:00Z" });
    expect(back[0]!.children.every((child) => child.movedFromLabel === undefined)).toBe(true);
  });

  it("reminds at the moved time, including after the planned time has passed", () => {
    const plan = (occurrences: OccurrenceRecord[]) => planNativeReminderRequests({ behaviors: [behavior], occurrences,
      now: NOW, targetThrough: NOW.add({ hours: 24 }) });
    const [moved] = applyOccurrenceMoves([row()], [move()]);
    expect(plan([moved!])).toEqual([{ id: `cadence.local.${MOVED_ID}`, title: "Brush teeth",
      body: "Moved for today. Planned for 9:00 AM.", fireAt: "2026-08-30T15:00:00Z" }]);
    // The same request ID replaces the planned reminder, so the old one cannot also fire.
    expect(plan([row()])[0]!.id).toBe(`cadence.local.${MOVED_ID}`);
    // Planned time already passed: a move later today still reminds; an unmoved item gets nothing new.
    const passed = row({ scheduled_for: "2026-08-30T11:00:00Z", schedule_start_time: "07:00" });
    expect(plan([passed])).toEqual([]);
    const [late] = applyOccurrenceMoves([passed], [move({ from_start_at: "2026-08-30T11:00:00Z", from_end_at: "2026-08-30T11:30:00Z" })]);
    expect(plan([late!]).map(({ fireAt }) => fireAt)).toEqual(["2026-08-30T15:00:00Z"]);
  });
});
