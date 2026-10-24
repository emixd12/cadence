import { Temporal } from "@js-temporal/polyfill";
import { validateBehaviorPlanningFields } from "./behavior-values";
import type {
  BehaviorDataStore, BehaviorFields, BehaviorGraphRecord, BehaviorInput,
  BehaviorScheduleGraphMutation,
} from "../behavior-store";
import {
  normalizeBehaviorDefinition, planBehaviorDefinitionChangeEvent,
  planInitialBehaviorDefinitionEvent,
} from "../resolvers/behavior-definition.resolver";
import {
  planBehaviorConfigurationChangeEvent, planInitialBehaviorConfigurationEvent,
} from "../resolvers/behavior-configuration.resolver";
import {
  appendArchiveNote, normalizeArchiveNote, parseArchiveNotes, replaceArchiveNote,
  serializeArchiveNotes,
} from "../resolvers/archive-note.resolver";
import type { Json } from "../types/json";
import type { BehaviorScheduleInput } from "../types/schedule";
import { planBehaviorWhere, storedBehaviorWhere } from "./behavior-where";

export async function createBehavior(
  store: BehaviorDataStore,
  input: { values: BehaviorInput; userId: string; timezone: string; recordedAt: string },
): Promise<BehaviorGraphRecord> {
  const values = input.values;
  validateBehaviorPlanningFields(values);
  const behavior: BehaviorFields & { user_id: string } = {
    user_id: input.userId,
    default_duration_minutes: values.defaultDurationMinutes ?? null,
    end_date: values.endDate ?? null,
    auto_archived_at: null,
    category_id: values.categoryId,
    title: values.title,
    description: values.description,
    ...planBehaviorWhere(values),
    recurrence_rule: values.recurrenceRule as Json,
    scheduled_time: values.scheduledTime,
    timezone: input.timezone,
    browser_reminder_enabled: values.browserReminderEnabled,
    email_reminder_enabled: values.emailReminderEnabled,
    reminder_offset_minutes: values.reminderOffsetMinutes,
    active: true,
    archived_at: null,
    archive_notes: [],
  };
  const definitionEventPlan = planInitialBehaviorDefinitionEvent({
    definition: { title: behavior.title, description: behavior.description },
    recordedAt: input.recordedAt,
    source: "manual",
  });
  const schedules = values.schedules.map(toBehaviorScheduleMutation);
  const configurationEventPlan = planInitialBehaviorConfigurationEvent({
    configuration: toBehaviorConfigurationSnapshot(behavior, schedules),
    recordedAt: input.recordedAt,
    effectiveAt: input.recordedAt,
    source: "manual",
    reasonCode: "behavior_created",
  });
  const created = await store.createBehaviorWithAtomicScheduleGraph({
    behavior: {
      ...behavior,
      title: definitionEventPlan.nextTitle,
      description: definitionEventPlan.nextDescription,
    },
    definitionEventPlan,
    configurationEventPlan,
    schedules,
  });
  const confirmed = await store.getBehaviorById(created.id);
  if (!confirmed) throw new Error("Behavior not found after create.");
  return confirmed;
}

export async function updateBehavior(
  store: BehaviorDataStore,
  input: { behaviorId: string; expectedUpdatedAt: string; values: BehaviorInput; recordedAt: string; newArchiveNoteId?: string },
) {
  if (!input.expectedUpdatedAt) throw new Error("Reload this behavior before saving changes.");
  const existing = await requireBehavior(store, input.behaviorId);
  const previousDefinition = normalizeBehaviorDefinition(existing);
  const definitionEventPlan = planBehaviorDefinitionChangeEvent({
    previousDefinition,
    nextDefinition: normalizeBehaviorDefinition(input.values),
    recordedAt: input.recordedAt,
    source: "manual",
  });
  const values = input.values;
  validateBehaviorPlanningFields(values);
  const archiveNotes = parseArchiveNotes(existing.archive_notes);
  if (existing.active && !values.active && !input.newArchiveNoteId) {
    throw new Error("Archive note id is required when archiving a behavior.");
  }
  const endDate = values.endDate === undefined ? existing.end_date ?? null : values.endDate;
  const restoringExpiredDate = !existing.active && values.active && endDate &&
    endDate <= Temporal.Instant.from(input.recordedAt).toZonedDateTimeISO(existing.timezone).toPlainDate().toString();
  const behavior: BehaviorFields = {
    default_duration_minutes: values.defaultDurationMinutes === undefined ? existing.default_duration_minutes ?? null : values.defaultDurationMinutes,
    end_date: restoringExpiredDate ? null : endDate,
    auto_archived_at: values.active ? null : existing.auto_archived_at ?? null,
    category_id: values.categoryId,
    title: definitionEventPlan?.nextTitle ?? existing.title,
    description: definitionEventPlan ? definitionEventPlan.nextDescription : existing.description,
    ...planBehaviorWhere(values, existing),
    recurrence_rule: values.recurrenceRule as Json,
    scheduled_time: values.scheduledTime,
    browser_reminder_enabled: values.browserReminderEnabled,
    email_reminder_enabled: values.emailReminderEnabled,
    reminder_offset_minutes: values.reminderOffsetMinutes,
    active: values.active,
    archived_at: values.active ? null : existing.archived_at ?? input.recordedAt,
    archive_notes: serializeArchiveNotes(existing.active && !values.active
      ? appendArchiveNote(archiveNotes, {
          id: input.newArchiveNoteId!, archivedAt: input.recordedAt,
          note: null, updatedAt: input.recordedAt,
        })
      : archiveNotes),
    timezone: existing.timezone,
  };
  const expectedScheduleGraph = toStoredBehaviorScheduleGraph(existing);
  const schedules = values.schedules.map(toBehaviorScheduleMutation);
  const configurationEventPlan = planBehaviorConfigurationChangeEvent({
    previousConfiguration: toBehaviorConfigurationSnapshot(existing, expectedScheduleGraph),
    nextConfiguration: toBehaviorConfigurationSnapshot(behavior, schedules),
    recordedAt: input.recordedAt,
    effectiveAt: input.recordedAt,
    source: "manual",
    reasonCode: "behavior_edited",
  });
  const updated = await store.updateBehaviorWithAtomicScheduleGraph({
    behaviorId: input.behaviorId,
    behavior,
    expectedDefinition: { title: existing.title, description: existing.description },
    expectedNormalizedDefinition: previousDefinition,
    expectedScheduleGraph,
    expectedUpdatedAt: input.expectedUpdatedAt,
    definitionEventPlan,
    configurationEventPlan,
    schedules,
  });
  if (!updated) throw new Error("Behavior not found.");
  return updated;
}

export async function setBehaviorActive(
  store: BehaviorDataStore,
  input: {
    behaviorId: string;
    active: boolean;
    expectedUpdatedAt?: string;
    recordedAt: string;
    newArchiveNoteId?: string;
    archiveNote?: string | null;
    automatic?: boolean;
    effectiveAt?: string;
  },
) {
  const existing = await requireBehavior(store, input.behaviorId);
  if (input.automatic && (input.active || !existing.active || !existing.end_date ||
      existing.end_date > Temporal.Instant.from(input.recordedAt).toZonedDateTimeISO(existing.timezone).toPlainDate().toString())) {
    return existing;
  }
  const schedules = toStoredBehaviorScheduleGraph(existing);
  const expectedDefinition = { title: existing.title, description: existing.description };
  const archiveNotes = parseArchiveNotes(existing.archive_notes);
  if (existing.active && !input.active && !input.newArchiveNoteId) {
    throw new Error("Archive note id is required when archiving a behavior.");
  }
  const behavior: BehaviorFields = {
    default_duration_minutes: existing.default_duration_minutes ?? null,
    end_date: input.active && existing.end_date && existing.end_date <= Temporal.Instant.from(input.recordedAt)
      .toZonedDateTimeISO(existing.timezone).toPlainDate().toString() ? null : existing.end_date ?? null,
    auto_archived_at: input.active ? null : input.automatic ? input.recordedAt : existing.auto_archived_at ?? null,
    category_id: existing.category_id,
    title: existing.title,
    description: existing.description,
    ...storedBehaviorWhere(existing),
    recurrence_rule: existing.recurrence_rule,
    scheduled_time: existing.scheduled_time,
    timezone: existing.timezone,
    browser_reminder_enabled: existing.browser_reminder_enabled,
    email_reminder_enabled: existing.email_reminder_enabled,
    reminder_offset_minutes: existing.reminder_offset_minutes,
    active: input.active,
    archived_at: input.active ? null : existing.archived_at ?? input.recordedAt,
    archive_notes: serializeArchiveNotes(existing.active && !input.active
      ? appendArchiveNote(archiveNotes, {
          id: input.newArchiveNoteId!, archivedAt: input.recordedAt,
          note: normalizeArchiveNote(input.automatic ? "Automatically archived on the end date." : input.archiveNote ?? ""), updatedAt: input.recordedAt,
        })
      : archiveNotes),
  };
  const configurationEventPlan = planBehaviorConfigurationChangeEvent({
    previousConfiguration: toBehaviorConfigurationSnapshot(existing, schedules),
    nextConfiguration: toBehaviorConfigurationSnapshot(behavior, schedules),
    recordedAt: input.recordedAt,
    effectiveAt: input.effectiveAt ?? input.recordedAt,
    source: input.automatic ? "system" : "manual",
    reasonCode: input.automatic ? "behavior_end_date_reached" : input.active ? "behavior_restored" : "behavior_archived",
  });
  const updated = await store.updateBehaviorWithAtomicScheduleGraph({
    behaviorId: existing.id,
    behavior,
    expectedDefinition,
    expectedNormalizedDefinition: normalizeBehaviorDefinition(expectedDefinition),
    expectedScheduleGraph: schedules,
    expectedUpdatedAt: input.expectedUpdatedAt ?? existing.updated_at,
    definitionEventPlan: null,
    configurationEventPlan,
    schedules,
  });
  if (!updated) throw new Error("Behavior not found.");
  return updated;
}

export async function updateBehaviorArchiveNote(
  store: BehaviorDataStore,
  input: {
    behaviorId: string;
    archiveNoteId: string;
    note: string | null;
    expectedUpdatedAt: string;
    recordedAt: string;
  },
) {
  if (!input.expectedUpdatedAt) throw new Error("Reload this behavior before saving changes.");
  const existing = await requireBehavior(store, input.behaviorId);
  if (existing.active) throw new Error("Restore or archive the behavior before editing archive history.");
  const schedules = toStoredBehaviorScheduleGraph(existing);
  const expectedDefinition = { title: existing.title, description: existing.description };
  const behavior: BehaviorFields = {
    default_duration_minutes: existing.default_duration_minutes ?? null,
    end_date: existing.end_date ?? null,
    auto_archived_at: existing.auto_archived_at ?? null,
    category_id: existing.category_id,
    title: existing.title,
    description: existing.description,
    ...storedBehaviorWhere(existing),
    recurrence_rule: existing.recurrence_rule,
    scheduled_time: existing.scheduled_time,
    timezone: existing.timezone,
    browser_reminder_enabled: existing.browser_reminder_enabled,
    email_reminder_enabled: existing.email_reminder_enabled,
    reminder_offset_minutes: existing.reminder_offset_minutes,
    active: existing.active,
    archived_at: existing.archived_at,
    archive_notes: serializeArchiveNotes(replaceArchiveNote(parseArchiveNotes(existing.archive_notes), {
      id: input.archiveNoteId,
      note: normalizeArchiveNote(input.note ?? ""),
      updatedAt: input.recordedAt,
    })),
  };
  const updated = await store.updateBehaviorWithAtomicScheduleGraph({
    behaviorId: existing.id,
    behavior,
    expectedDefinition,
    expectedNormalizedDefinition: normalizeBehaviorDefinition(expectedDefinition),
    expectedScheduleGraph: schedules,
    expectedUpdatedAt: input.expectedUpdatedAt,
    definitionEventPlan: null,
    configurationEventPlan: null,
    schedules,
  });
  if (!updated) throw new Error("Behavior not found.");
  return updated;
}

async function requireBehavior(store: BehaviorDataStore, behaviorId: string) {
  const behavior = await store.getBehaviorById(behaviorId);
  if (!behavior) throw new Error("Behavior not found.");
  return behavior;
}

function toBehaviorScheduleMutation(schedule: BehaviorScheduleInput): BehaviorScheduleGraphMutation {
  return {
    id: schedule.id ?? undefined,
    recurrence_rule: schedule.recurrenceRule as Json,
    sort_order: schedule.sortOrder,
    slots: schedule.timeEntries.map((slot) => ({
      id: slot.id ?? undefined,
      kind: slot.kind,
      preset: slot.preset,
      start_time: slot.startTime,
      end_time: slot.endTime,
      sort_order: slot.sortOrder,
    })),
  };
}

export function toStoredBehaviorScheduleGraph(behavior: BehaviorGraphRecord): BehaviorScheduleGraphMutation[] {
  return (behavior.schedules ?? []).map((schedule) => ({
    id: schedule.id,
    recurrence_rule: schedule.recurrence_rule,
    sort_order: schedule.sort_order,
    slots: schedule.schedule_slots.map((slot) => ({
      id: slot.id,
      kind: slot.kind,
      preset: slot.preset,
      start_time: slot.start_time,
      end_time: slot.end_time,
      sort_order: slot.sort_order,
    })),
  }));
}

export function toBehaviorConfigurationSnapshot(behavior: BehaviorFields, schedules: BehaviorScheduleGraphMutation[]) {
  return {
    categoryId: behavior.category_id,
    ...configurationWhere(behavior),
    scheduleGraph: schedules.map((schedule) => ({
      recurrenceRule: schedule.recurrence_rule,
      sortOrder: schedule.sort_order,
      timeEntries: schedule.slots.map((slot) => ({
        kind: slot.kind, preset: slot.preset, startTime: slot.start_time,
        endTime: slot.end_time, sortOrder: slot.sort_order,
      })),
    })),
    browserReminderEnabled: behavior.browser_reminder_enabled,
    emailReminderEnabled: behavior.email_reminder_enabled,
    reminderOffsetMinutes: behavior.reminder_offset_minutes,
    active: behavior.active,
    timezone: behavior.timezone,
  };
}

function configurationWhere(behavior: BehaviorFields) {
  const where = storedBehaviorWhere(behavior);
  return { whereKind: where.where_kind, locationText: where.location_text };
}
