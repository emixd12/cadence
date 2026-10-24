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
