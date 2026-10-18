import { Temporal } from "@js-temporal/polyfill";
import { OCCURRENCE_STATUS_LABELS, type BehaviorOutput, type OccurrenceOutput } from "@cadence/core/integration";
import { toBehaviorView } from "@cadence/core/services/behavior-views";
import { resolvePersistedTimelineOccurrence } from "@cadence/core/services/timeline.service";
import { normalizeScheduleKind, normalizeSchedulePreset } from "@cadence/core/services/occurrence-generation";
import type { BehaviorWithCategory } from "@/lib/db/behaviors.repo";
import type { Occurrence } from "@/lib/types/database";

export const integrationInstant = (value: string): string => Temporal.Instant.from(value).toString();
const nullableInstant = (value: string | null): string | null => value === null ? null : integrationInstant(value);

// Allowlist every field; database rows also contain private import and ownership metadata.
export function serializeIntegrationBehavior(behavior: BehaviorWithCategory, externalRef: string | null): BehaviorOutput {
  const view = toBehaviorView(behavior);
  return {
    id: behavior.id,
    title: behavior.title,
    description: behavior.description,
    location_text: behavior.location_text ?? null,
    category: behavior.category ? { id: behavior.category.id, name: behavior.category.name } : null,
    state: behavior.active ? "active" : "archived",
    archived_at: nullableInstant(behavior.archived_at),
    auto_archived_at: nullableInstant(behavior.auto_archived_at ?? null),
    end_date: behavior.end_date ?? null,
    default_duration_minutes: behavior.default_duration_minutes ?? null,
    timezone: behavior.timezone,
    schedules: (view.schedules ?? []).map((schedule) => {
      const rule = schedule.recurrenceRule;
      const recurrence = rule.frequency === "interval_days"
        ? { frequency: rule.frequency, interval_days: rule.intervalDays }
        : rule.frequency === "weekly"
          ? { frequency: rule.frequency, interval: rule.interval, days_of_week: rule.daysOfWeek }
          : rule.frequency === "monthly"
            ? { frequency: rule.frequency, interval: rule.interval, day_of_month: rule.dayOfMonth }
            : { frequency: rule.frequency, interval: rule.interval };
      return {
        id: schedule.id, recurrence, recurrence_summary: schedule.recurrenceSummary,
        time_summary: schedule.timeSummary,
        time_entries: schedule.timeEntries.map((entry) => ({
          id: entry.id, kind: entry.kind, preset: entry.preset,
          start_time: entry.startTime, end_time: entry.endTime, label: entry.label,
        })),
      };
    }),
    schedule_summary: view.scheduleSummary,
    reminders: {
      browser_enabled: behavior.browser_reminder_enabled,
      email_enabled: behavior.email_reminder_enabled,
      offset_minutes: behavior.reminder_offset_minutes,
      summary: view.reminderSummary,
    },
    archive_notes: view.archiveNotes.map((note) => ({
      id: note.id, archived_at: integrationInstant(note.archivedAt),
      note: note.note, updated_at: integrationInstant(note.updatedAt),
    })),
    external_ref: externalRef,
    created_at: integrationInstant(behavior.created_at),
    updated_at: integrationInstant(behavior.updated_at),
    revision: integrationInstant(behavior.updated_at),
  };
}

export function serializeIntegrationOccurrence(
  occurrence: Occurrence, behavior: BehaviorWithCategory, now: Temporal.Instant, timezone: string,
): OccurrenceOutput {
  const view = resolvePersistedTimelineOccurrence({ behavior, occurrence, timeSessions: [], now, timezone });
  if (!view) throw new Error("Occurrence has no Behavior.");
  return {
    id: occurrence.id, behavior_id: behavior.id, behavior_title: behavior.title,
    category_name: behavior.category?.name ?? null,
    local_date: occurrence.local_date, timezone: behavior.timezone,
    scheduled_for: integrationInstant(occurrence.scheduled_for),
    schedule: {
      kind: normalizeScheduleKind(occurrence.schedule_kind),
      preset: normalizeSchedulePreset(occurrence.schedule_preset),
      start_time: occurrence.schedule_start_time.slice(0, 5),
      end_time: occurrence.schedule_end_time?.slice(0, 5) ?? null,
      label: view.scheduledTimeLabel,
    },
    status: view.status,
    status_label: OCCURRENCE_STATUS_LABELS[view.status],
    needs_decision: view.visualTone === "needs_decision",
    completed_at: nullableInstant(occurrence.completed_at),
    status_marked_at: nullableInstant(occurrence.status_marked_at),
    note: occurrence.note,
    updated_at: integrationInstant(occurrence.updated_at),
    revision: integrationInstant(occurrence.updated_at),
  };
}
