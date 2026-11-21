import { Temporal } from "@js-temporal/polyfill";
import { effectiveEndAt, effectiveStartAt, isMoved, plannedStartAt } from "@cadence/core/resolvers/time.resolver";
import {
  OCCURRENCE_STATUS_LABELS, OPPORTUNITY_ADDED_BY_VALUES, type BehaviorOutput, type OccurrenceOutput, type ParentGroupOutput,
  type SubBehaviorSummaryOutput,
} from "@cadence/core/integration";
import { sortSubBehaviors } from "@cadence/core/resolvers/sub-behavior.resolver";
import type { TimelineParentGroupView } from "@cadence/core/types/timeline";
import { toBehaviorView } from "@cadence/core/services/behavior-views";
import { behaviorRunState, runFieldsFromStored } from "@cadence/core/resolvers/behavior-run.resolver";
import { resolvePersistedTimelineOccurrence } from "@cadence/core/services/timeline.service";
import { normalizeScheduleKind, normalizeSchedulePreset } from "@cadence/core/services/occurrence-generation";
import type { BehaviorWithCategory } from "@/lib/db/behaviors.repo";
import type { Occurrence } from "@/lib/types/database";

const ADDED_BY: ReadonlySet<string> = new Set(OPPORTUNITY_ADDED_BY_VALUES);
const addedByOf = (value: string | null | undefined): OccurrenceOutput["added_by"] =>
  value && ADDED_BY.has(value) ? value as OccurrenceOutput["added_by"] : null;

export const integrationInstant = (value: string): string => Temporal.Instant.from(value).toString();
const nullableInstant = (value: string | null): string | null => value === null ? null : integrationInstant(value);

// Allowlist every field; database rows also contain private import and ownership metadata.
/**
 * run_state, end_on, end_time and pause, plus end_date: the deprecated alias, the
 * first day without the Behavior (end_on + 1), kept for one minor version.
 */
function integrationRunFields(behavior: BehaviorWithCategory, now: Temporal.Instant) {
  const fields = runFieldsFromStored(behavior);
  const state = behaviorRunState(fields, now);
  return {
    run_state: state.state,
    end_on: fields.endOn,
    end_time: fields.endTime ? fields.endTime.slice(0, 5) : null,
    pause: fields.pauseFromOn && fields.pauseBackOn && state.backOn
      ? { from_on: fields.pauseFromOn, from_time: fields.pauseFromTime ? fields.pauseFromTime.slice(0, 5) : null, back_on: fields.pauseBackOn }
      : null,
    end_date: fields.endOn ? Temporal.PlainDate.from(fields.endOn).add({ days: 1 }).toString() : null,
  };
}

/** A parent's sub-behaviors in display order, archived ones included (contract 1.7.0). */
export function subBehaviorsOf(
  parentId: string, behaviors: readonly BehaviorWithCategory[],
): BehaviorWithCategory[] {
  const byId = new Map(behaviors.map((row) => [row.id, row]));
  return sortSubBehaviors(behaviors
    .filter((row) => row.parent_behavior_id === parentId && row.id !== parentId)
    .map((row) => ({ id: row.id, title: row.title, subBehaviorSortOrder: row.sub_behavior_sort_order ?? 0 })))
    .map((facts) => byId.get(facts.id)!);
}

function subBehaviorSummary(child: BehaviorWithCategory, now: Temporal.Instant): SubBehaviorSummaryOutput {
  return {
    id: child.id,
    title: child.title,
    sub_behavior_sort_order: child.sub_behavior_sort_order ?? 0,
    inherit_parent_schedule: child.inherit_parent_schedule ?? false,
    active: child.active,
    run_state: behaviorRunState(runFieldsFromStored(child), now).state,
  };
}

/** `subBehaviors` are the Behavior's own children; pass them from `subBehaviorsOf`. */
export function serializeIntegrationBehavior(
  behavior: BehaviorWithCategory, externalRef: string | null, now: Temporal.Instant = Temporal.Now.instant(),
  subBehaviors: readonly BehaviorWithCategory[] = [],
): BehaviorOutput {
  const parentId = behavior.parent_behavior_id ?? null;
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
    ...integrationRunFields(behavior, now),
    is_opportunity: behavior.is_opportunity === true,
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
    parent_behavior_id: parentId,
    sub_behavior_sort_order: parentId ? behavior.sub_behavior_sort_order ?? 0 : 0,
    inherit_parent_schedule: parentId ? behavior.inherit_parent_schedule ?? false : false,
    sub_behaviors: parentId ? [] : subBehaviors.map((child) => subBehaviorSummary(child, now)),
    created_at: integrationInstant(behavior.created_at),
    updated_at: integrationInstant(behavior.updated_at),
    revision: integrationInstant(behavior.updated_at),
  };
}

/**
 * `parent` adds `parent_behavior_id` and `parent_title` (contract 1.7.0): the sub-behavior's
 * parent, or null for a top-level Behavior. Leave it out where the parent is unknown.
 */
export function serializeIntegrationOccurrence(
  occurrence: Occurrence, behavior: BehaviorWithCategory, now: Temporal.Instant, timezone: string,
  parent?: { id: string; title: string } | null,
): OccurrenceOutput {
  const view = resolvePersistedTimelineOccurrence({ behavior, occurrence, timeSessions: [], now, timezone });
  if (!view) throw new Error("Occurrence has no Behavior.");
  return {
    id: occurrence.id, behavior_id: behavior.id, behavior_title: behavior.title,
    category_name: behavior.category?.name ?? null,
    local_date: occurrence.local_date, timezone: behavior.timezone,
    scheduled_for: integrationInstant(plannedStartAt(occurrence)),
    effective_start_at: integrationInstant(effectiveStartAt(occurrence)),
    move: isMoved(occurrence) ? {
      planned_start_at: integrationInstant(plannedStartAt(occurrence)),
      start_at: integrationInstant(effectiveStartAt(occurrence)),
      end_at: integrationInstant(effectiveEndAt(occurrence) ?? effectiveStartAt(occurrence)),
    } : null,
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
    origin: occurrence.origin === "opportunity" ? "opportunity" : "scheduled",
    added_by: occurrence.origin === "opportunity" ? addedByOf(occurrence.added_by) : null,
    completed_at: nullableInstant(occurrence.completed_at),
    status_marked_at: nullableInstant(occurrence.status_marked_at),
    note: occurrence.note,
    ...(parent === undefined ? {} : { parent_behavior_id: parent?.id ?? null, parent_title: parent?.title ?? null }),
    updated_at: integrationInstant(occurrence.updated_at),
    revision: integrationInstant(occurrence.updated_at),
  };
}

/** The parent of a sub-behavior's Occurrence, or null; looked up in the account's Behaviors. */
export function occurrenceParent(
  behavior: BehaviorWithCategory, behaviorsById: ReadonlyMap<string, BehaviorWithCategory>,
): { id: string; title: string } | null {
  const parent = behavior.parent_behavior_id ? behaviorsById.get(behavior.parent_behavior_id) : undefined;
  return parent ? { id: parent.id, title: parent.title } : null;
}

export function serializeIntegrationParentGroup(group: TimelineParentGroupView): ParentGroupOutput {
  return {
    parent_behavior_id: group.parentBehaviorId,
    title: group.title,
    local_date: group.localDate,
    slot_key: integrationInstant(group.scheduledFor),
    scheduled_time_label: group.scheduledTimeLabel,
    derived_status: group.rollup.status,
    progress_label: group.rollup.progressLabel,
    completed_count: group.rollup.completedCount,
    not_completed_count: group.rollup.notCompletedCount,
    unresolved_count: group.rollup.unresolvedCount,
    total_count: group.rollup.totalCount,
    needs_decision: group.visualTone === "needs_decision",
    occurrence_ids: group.children.map((child) => child.id),
  };
}
