import { Temporal } from "@js-temporal/polyfill";
import { validateBehaviorPlanningFields } from "./behavior-values";
import {
  behaviorRunState, normalizeRunTime, runFieldsFromStored, type BehaviorPause,
} from "../resolvers/behavior-run.resolver";
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
  validateBehaviorPlanningFields(values, { now: Temporal.Instant.from(input.recordedAt), timezone: input.timezone });
  const behavior: BehaviorFields & { user_id: string } = {
    user_id: input.userId,
    default_duration_minutes: values.defaultDurationMinutes ?? null,
    ...storedEnd(values.endOn ?? null, values.endTime ?? null),
    ...storedPause(values.pause
      ? startPauseNow(values.pause, Temporal.Instant.from(input.recordedAt), input.timezone) : null),
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
  const current = storedRunValues(existing);
  const end = values.endOn === undefined
    ? { endOn: current.end_on, endTime: current.end_time }
    : { endOn: values.endOn, endTime: values.endOn === null ? null : values.endTime ?? null };
  const pause = values.pause === undefined || samePause(values.pause, current)
    ? currentPause(current)
    : values.pause && startPauseNow(values.pause, Temporal.Instant.from(input.recordedAt), existing.timezone);
  // A changed end or pause must lie ahead (rule T5); an unchanged one is left alone.
  validateBehaviorPlanningFields({ ...values, ...end, pause }, {
    now: Temporal.Instant.from(input.recordedAt), timezone: existing.timezone,
    checkEnd: values.active && !sameEnd(end, current), checkPause: values.active && !samePause(pause, current),
  });
  const archiveNotes = parseArchiveNotes(existing.archive_notes);
  if (existing.active && !values.active && !input.newArchiveNoteId) {
    throw new Error("Archive note id is required when archiving a behavior.");
  }
  const behavior: BehaviorFields = {
    default_duration_minutes: values.defaultDurationMinutes === undefined ? existing.default_duration_minutes ?? null : values.defaultDurationMinutes,
    ...storedEnd(end.endOn, end.endTime),
    ...storedPause(pause),
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
    effectiveAt?: string;
  },
) {
  const existing = await requireBehavior(store, input.behaviorId);
  const schedules = toStoredBehaviorScheduleGraph(existing);
  const expectedDefinition = { title: existing.title, description: existing.description };
  const archiveNotes = parseArchiveNotes(existing.archive_notes);
  if (existing.active && !input.active && !input.newArchiveNoteId) {
    throw new Error("Archive note id is required when archiving a behavior.");
  }
  // Restore keeps an end that has passed: the Behavior comes back as Ended, and
  // Start again runs it (docs/RECURRENCE_RULES.md, "Behavior end and pause").
  const behavior: BehaviorFields = {
    ...storedBehaviorFields(existing),
    auto_archived_at: input.active ? null : existing.auto_archived_at ?? null,
    active: input.active,
    archived_at: input.active ? null : existing.archived_at ?? input.recordedAt,
    archive_notes: serializeArchiveNotes(existing.active && !input.active
      ? appendArchiveNote(archiveNotes, {
          id: input.newArchiveNoteId!, archivedAt: input.recordedAt,
          note: normalizeArchiveNote(input.archiveNote ?? ""), updatedAt: input.recordedAt,
        })
      : archiveNotes),
  };
  const configurationEventPlan = planBehaviorConfigurationChangeEvent({
    previousConfiguration: toBehaviorConfigurationSnapshot(existing, schedules),
    nextConfiguration: toBehaviorConfigurationSnapshot(behavior, schedules),
    recordedAt: input.recordedAt,
    effectiveAt: input.effectiveAt ?? input.recordedAt,
    source: "manual",
    reasonCode: input.active ? "behavior_restored" : "behavior_archived",
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

/** The four run actions on a Behavior's menu, in Chat and through MCP. */
export type BehaviorRunAction =
  | { kind: "end_now" }
  | { kind: "start_again" }
  | { kind: "pause"; pause: BehaviorPause }
  | { kind: "resume" };

/** Reason codes on the configuration revision each run action writes. */
export const BEHAVIOR_RUN_REASON_CODES = {
  end_now: "behavior_ended",
  start_again: "behavior_started_again",
  pause: "behavior_paused",
  resume: "behavior_resumed",
} as const;

/**
 * End now, Start again, Pause and Resume now (Ended and Paused plan, answers 2A, 3A,
 * 8A and R1). Each writes one normal configuration revision; nothing is written
 * later when the moment arrives. Generation then removes or restores rows.
 * - End now stops this minute: rows still unmarked later today leave the Timeline.
 * - Start again clears the end. The Behavior runs from now.
 * - Pause replaces any earlier pause (one at a time). A pause that starts today
 *   starts now; a later one starts at the start of its first day.
 * - Resume now clears the pause, ending a current one early or cancelling one ahead.
 */
export async function applyBehaviorRunAction(
  store: BehaviorDataStore,
  input: { behaviorId: string; action: BehaviorRunAction; recordedAt: string; expectedUpdatedAt?: string },
) {
  const existing = await requireBehavior(store, input.behaviorId);
  if (!existing.active) throw new BehaviorRunStateError("Restore this behavior before changing when it runs.");
  const now = Temporal.Instant.from(input.recordedAt);
  const state = behaviorRunState(runFieldsFromStored(existing), now).state;
  const fields = storedBehaviorFields(existing);
  const action = input.action;
  // Repeating an action that already holds changes nothing: no revision is written.
  if (action.kind === "end_now") {
    if (state !== "ended") Object.assign(fields, endNowFields(now, existing.timezone));
  } else if (action.kind === "start_again") {
    Object.assign(fields, storedEnd(null, null));
  } else if (action.kind === "pause") {
    if (state === "ended") throw new BehaviorRunStateError("Start this behavior again before pausing it.");
    const pause = startPauseNow(action.pause, now, existing.timezone);
    validateBehaviorPlanningFields({ pause }, { now, timezone: existing.timezone, checkEnd: false });
    Object.assign(fields, storedPause(pause));
  } else {
    // Resume clears the pause, and an end that has passed, so the Behavior runs from now.
    Object.assign(fields, storedPause(null));
    if (state === "ended") Object.assign(fields, storedEnd(null, null));
  }
  const schedules = toStoredBehaviorScheduleGraph(existing);
  const expectedDefinition = { title: existing.title, description: existing.description };
  const configurationEventPlan = planBehaviorConfigurationChangeEvent({
    previousConfiguration: toBehaviorConfigurationSnapshot(existing, schedules),
    nextConfiguration: toBehaviorConfigurationSnapshot(fields, schedules),
    recordedAt: input.recordedAt,
    effectiveAt: input.recordedAt,
    source: "manual",
    reasonCode: BEHAVIOR_RUN_REASON_CODES[action.kind],
  });
  // The store is called even when nothing changed, so an MCP write still gets its receipt.
  const updated = await store.updateBehaviorWithAtomicScheduleGraph({
    behaviorId: existing.id,
    behavior: configurationEventPlan ? fields : storedBehaviorFields(existing),
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

/** A run action the Behavior's state does not allow (archived, or pausing an ended Behavior). */
export class BehaviorRunStateError extends Error {
  override readonly name = "BehaviorRunStateError";
}

/**
 * End now: the end is this minute, rounded up, so an item at the current minute
 * still counts as earlier today and anything later leaves the Timeline.
 */
export function endNowFields(now: Temporal.Instant, timezone: string) {
  const zoned = now.toZonedDateTimeISO(timezone);
  const minute = zoned.round({ smallestUnit: "minute", roundingMode: "ceil" });
  if (minute.toPlainDate().equals(zoned.toPlainDate())) {
    return storedEnd(minute.toPlainDate().toString(), minute.toPlainTime().toString());
  }
  return storedEnd(zoned.toPlainDate().toString(), null);
}

/** A pause whose first day is today starts now; a later one starts with its day. */
export function startPauseNow(pause: BehaviorPause, now: Temporal.Instant, timezone: string): BehaviorPause {
  const zoned = now.toZonedDateTimeISO(timezone);
  const today = zoned.toPlainDate().toString();
  if (pause.fromOn !== today) return { ...pause, fromTime: pause.fromTime ? normalizeRunTime(pause.fromTime) : null };
  const minute = zoned.round({ smallestUnit: "minute", roundingMode: "floor" });
  const requested = pause.fromTime ? Temporal.PlainTime.from(pause.fromTime) : null;
  const start = requested && Temporal.PlainTime.compare(requested, minute.toPlainTime()) > 0 ? requested : minute.toPlainTime();
  return { ...pause, fromTime: start.equals(Temporal.PlainTime.from("00:00")) ? null : normalizeRunTime(start.toString()) };
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
    ...storedBehaviorFields(existing),
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
    ...configurationRun(behavior),
  };
}

function configurationRun(behavior: BehaviorFields) {
  const run = storedRunValues(behavior);
  return {
    end: run.end_on ? { on: run.end_on, time: run.end_time } : null,
    pause: run.pause_from_on && run.pause_back_on
      ? { fromOn: run.pause_from_on, fromTime: run.pause_from_time, backOn: run.pause_back_on }
      : null,
  };
}

/** Every stored field of a Behavior, unchanged: the base each single-purpose write edits. */
export function storedBehaviorFields(existing: BehaviorGraphRecord): BehaviorFields {
  return {
    default_duration_minutes: existing.default_duration_minutes ?? null,
    ...storedRunValues(existing),
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
    archive_notes: existing.archive_notes,
  };
}

type StoredRunValues = {
  end_on: string | null; end_time: string | null; pause_from_on: string | null;
  pause_from_time: string | null; pause_back_on: string | null;
};

function storedRunValues(behavior: BehaviorFields): StoredRunValues {
  return {
    end_on: behavior.end_on ?? null,
    end_time: behavior.end_time ? normalizeRunTime(behavior.end_time) : null,
    pause_from_on: behavior.pause_from_on ?? null,
    pause_from_time: behavior.pause_from_time ? normalizeRunTime(behavior.pause_from_time) : null,
    pause_back_on: behavior.pause_back_on ?? null,
  };
}

function storedEnd(endOn: string | null, endTime: string | null) {
  return { end_on: endOn, end_time: endOn && endTime ? normalizeRunTime(endTime) : null };
}

function storedPause(pause: BehaviorPause | null) {
  return pause
    ? { pause_from_on: pause.fromOn, pause_from_time: pause.fromTime ? normalizeRunTime(pause.fromTime) : null, pause_back_on: pause.backOn }
    : { pause_from_on: null, pause_from_time: null, pause_back_on: null };
}

function currentPause(run: StoredRunValues): BehaviorPause | null {
  return run.pause_from_on && run.pause_back_on
    ? { fromOn: run.pause_from_on, fromTime: run.pause_from_time, backOn: run.pause_back_on }
    : null;
}

function sameEnd(end: { endOn: string | null; endTime: string | null }, run: StoredRunValues): boolean {
  const next = storedEnd(end.endOn, end.endTime);
  return next.end_on === run.end_on && next.end_time === run.end_time;
}

function samePause(pause: BehaviorPause | null, run: StoredRunValues): boolean {
  const next = storedPause(pause);
  return next.pause_from_on === run.pause_from_on && next.pause_from_time === run.pause_from_time
    && next.pause_back_on === run.pause_back_on;
}

function configurationWhere(behavior: BehaviorFields) {
  const where = storedBehaviorWhere(behavior);
  return { whereKind: where.where_kind, locationText: where.location_text };
}

