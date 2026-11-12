import type { Json } from "../types/json";
import type { BehaviorConfigurationEventPlan } from "../types/behavior-configuration-event";

export function toBehaviorConfigurationEventPlanPayload(
  plan: BehaviorConfigurationEventPlan,
): Json {
  return {
    event_kind: plan.eventKind,
    previous_configuration: plan.previousConfiguration
      ? toBehaviorConfigurationSnapshotPayload(plan.previousConfiguration)
      : null,
    next_configuration: toBehaviorConfigurationSnapshotPayload(
      plan.nextConfiguration,
    ),
    changed_fields: plan.changedFields,
    recorded_at: plan.recordedAt,
    effective_at: plan.effectiveAt,
    effective_local_date: plan.effectiveLocalDate,
    timezone: plan.timezone,
    source: plan.source,
    reason_code: plan.reasonCode,
  };
}

export function toBehaviorConfigurationSnapshotPayload(
  snapshot: BehaviorConfigurationEventPlan["nextConfiguration"],
): Json {
  return {
    category_id: snapshot.categoryId,
    location_text: snapshot.locationText ?? null,
    where_kind: snapshot.whereKind === undefined ? (snapshot.locationText ? "place" : null) : snapshot.whereKind,
    schedule_graph: snapshot.scheduleGraph.map((schedule) => ({
      recurrence_rule: schedule.recurrenceRule,
      sort_order: schedule.sortOrder,
      time_entries: schedule.timeEntries.map((entry) => ({
        kind: entry.kind,
        preset: entry.preset,
        start_time: entry.startTime,
        end_time: entry.endTime,
        sort_order: entry.sortOrder,
      })),
    })),
    browser_reminder_enabled: snapshot.browserReminderEnabled,
    email_reminder_enabled: snapshot.emailReminderEnabled,
    reminder_offset_minutes: snapshot.reminderOffsetMinutes,
    active: snapshot.active,
    timezone: snapshot.timezone,
  };
}

// Cadence for Mac stores configuration snapshots in the camelCase shape of
// BehaviorConfigurationSnapshot. Account sync uploaded them unchanged, so hosted
// history holds both shapes (defect D2). Readers call this to get the hosted
// snake_case shape; snake_case input is returned unchanged.
export function toStoredConfigurationSnapshot(value: Json): Json {
  const snapshot = snapshotObject(value);
  if ("schedule_graph" in snapshot) return value;
  const schedules = snapshot.scheduleGraph;
  if (!Array.isArray(schedules)) throw new Error("Invalid configuration schedule graph.");
  return {
    category_id: snapshot.categoryId ?? null,
    location_text: snapshot.locationText ?? null,
    // Export assembly derives a missing Where from location text (Ticket 215).
    ...(snapshot.whereKind === undefined ? {} : { where_kind: snapshot.whereKind }),
    schedule_graph: schedules.map((item) => {
      const schedule = snapshotObject(item);
      if (!Array.isArray(schedule.timeEntries)) throw new Error("Invalid configuration time entries.");
      return {
        recurrence_rule: schedule.recurrenceRule ?? null,
        sort_order: schedule.sortOrder ?? null,
        time_entries: schedule.timeEntries.map((item) => {
          const entry = snapshotObject(item);
          return { kind: entry.kind ?? null, preset: entry.preset ?? null, start_time: entry.startTime ?? null,
            end_time: entry.endTime ?? null, sort_order: entry.sortOrder ?? null };
        }),
      };
    }),
    browser_reminder_enabled: snapshot.browserReminderEnabled ?? null,
    email_reminder_enabled: snapshot.emailReminderEnabled ?? null,
    reminder_offset_minutes: snapshot.reminderOffsetMinutes ?? null,
    active: snapshot.active ?? null,
    timezone: snapshot.timezone ?? null,
  };
}

function snapshotObject(value: Json | undefined): { [key: string]: Json | undefined } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid configuration snapshot.");
  return value;
}
