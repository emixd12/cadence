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
import {
  listSubBehaviors, mirrorParentSchedule, nextSubBehaviorSortOrder, planInheritedScheduleMirrors,
  planSubBehaviorReorder, validateSubBehaviorLink, type MirrorableBehavior,
} from "../resolvers/sub-behavior.resolver";
import type { SubBehaviorLinkFacts } from "../types/sub-behavior";
import { BehaviorValidationError } from "./behavior-values";
import type { BehaviorCreateCommit, BehaviorUpdateCommit } from "../behavior-store";

export async function createBehavior(
  store: BehaviorDataStore,
  input: { values: BehaviorInput; userId: string; timezone: string; recordedAt: string; newId?: () => string },
): Promise<BehaviorGraphRecord> {
  const values = input.values;
  const parentId = values.parentBehaviorId ?? null;
  const behaviors = parentId ? await requireBehaviorList(store) : [];
  let link: CreateLink | null = null;
  if (parentId) {
    // A new Behavior has no id yet and no sub-behaviors, so any id stands in for the check.
    assertSubBehaviorLink({ behaviorId: "", nextParentBehaviorId: parentId, behaviors, nextIsOpportunity: values.isOpportunity === true });
    const parent = behaviors.find((behavior) => behavior.id === parentId)!;
    link = {
      parentBehaviorId: parentId,
      inheritParentSchedule: values.inheritParentSchedule ?? true,
      subBehaviorSortOrder: values.subBehaviorSortOrder
        ?? nextSubBehaviorSortOrder(listSubBehaviors(parentId, behaviors.map(toSubBehaviorLinkFacts), { includeArchived: true })),
      parent: storedMirrorable(parent),
    };
  }
  const id = parentId ? (input.newId ?? randomId)() : undefined;
  const commit = planCreateCommit(values, { ...input, id, link });
  const created = await store.createBehaviorWithAtomicScheduleGraph(commit);
  const confirmed = await store.getBehaviorById(created.id);
  if (!confirmed) throw new Error("Behavior not found after create.");
  return confirmed;
}

/**
 * A parent Behavior and its sub-behaviors in one transaction (depth 1). Sub-behaviors
 * inherit the parent's schedule unless `inheritParentSchedule` is false, and keep the
 * given order.
 */
export async function createBehaviorGroup(
  store: BehaviorDataStore,
  input: {
    parent: BehaviorInput;
    subBehaviors: BehaviorInput[];
    userId: string;
    timezone: string;
    recordedAt: string;
    newId?: () => string;
  },
): Promise<{ parent: BehaviorGraphRecord; subBehaviors: BehaviorGraphRecord[] }> {
  if (!store.createBehaviorGroupWithAtomicScheduleGraphs) throw new Error("Sub-behaviors are not available here.");
  if (input.parent.parentBehaviorId) throw subBehaviorError("A sub-behavior can't have sub-behaviors.");
  if (input.subBehaviors.length < 1 || input.subBehaviors.length > 50) {
    throw subBehaviorError("Add 1 to 50 sub-behaviors.");
  }
  const newId = input.newId ?? randomId;
  const parentCommit = planCreateCommit({ ...input.parent, parentBehaviorId: null }, { ...input, id: newId(), link: null });
  const parentId = parentCommit.behavior.id!;
  const parent: MirrorableBehavior = { fields: parentCommit.behavior, schedules: parentCommit.schedules };
  const commits = [parentCommit, ...input.subBehaviors.map((values, index) => planCreateCommit(values, {
    ...input, id: newId(), link: {
      parentBehaviorId: parentId,
      inheritParentSchedule: values.inheritParentSchedule ?? true,
      subBehaviorSortOrder: values.subBehaviorSortOrder ?? index,
      parent,
    },
  }))];
  const created = await store.createBehaviorGroupWithAtomicScheduleGraphs(commits);
  const confirmed = await Promise.all(created.map(async (row) => {
    const record = await store.getBehaviorById(row.id);
    if (!record) throw new Error("Behavior not found after create.");
    return record;
  }));
  return { parent: confirmed[0]!, subBehaviors: confirmed.slice(1) };
}

type CreateLink = {
  parentBehaviorId: string;
  inheritParentSchedule: boolean;
  subBehaviorSortOrder: number;
  parent: MirrorableBehavior;
};

function planCreateCommit(
  values: BehaviorInput,
  input: { userId: string; timezone: string; recordedAt: string; id?: string; link: CreateLink | null },
): BehaviorCreateCommit {
  validateBehaviorPlanningFields(values, { now: Temporal.Instant.from(input.recordedAt), timezone: input.timezone });
  let behavior: BehaviorFields & { user_id: string; id?: string } = {
    ...(input.id ? { id: input.id } : {}),
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
    ...storedRecurrence(values, values.isOpportunity === true),
    is_opportunity: values.isOpportunity === true,
    timezone: input.timezone,
    browser_reminder_enabled: values.browserReminderEnabled,
    email_reminder_enabled: values.emailReminderEnabled,
    reminder_offset_minutes: values.reminderOffsetMinutes,
    active: true,
    archived_at: null,
    archive_notes: [],
    ...storedLinkFields(input.link ? {
      parent_behavior_id: input.link.parentBehaviorId,
      inherit_parent_schedule: input.link.inheritParentSchedule,
      sub_behavior_sort_order: input.link.subBehaviorSortOrder,
    } : {}),
  };
  let schedules = values.schedules.map(toBehaviorScheduleMutation);
  if (input.link?.inheritParentSchedule) {
    const mirror = mirrorParentSchedule({ parent: input.link.parent });
    behavior = { ...behavior, ...mirror.fields };
    schedules = mirror.schedules;
  }
  const definitionEventPlan = planInitialBehaviorDefinitionEvent({
    definition: { title: behavior.title, description: behavior.description },
    recordedAt: input.recordedAt,
    source: "manual",
  });
  const configurationEventPlan = planInitialBehaviorConfigurationEvent({
    configuration: toBehaviorConfigurationSnapshot(behavior, schedules),
    recordedAt: input.recordedAt,
    effectiveAt: input.recordedAt,
    source: "manual",
    reasonCode: "behavior_created",
  });
  return {
    behavior: {
      ...behavior,
      title: definitionEventPlan.nextTitle,
      description: definitionEventPlan.nextDescription,
    },
    definitionEventPlan,
    configurationEventPlan,
    schedules,
  };
}

export async function updateBehavior(
  store: BehaviorDataStore,
  input: {
    behaviorId: string; expectedUpdatedAt: string; values: BehaviorInput; recordedAt: string;
    newArchiveNoteId?: string; newId?: () => string;
  },
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
  let behavior: BehaviorFields = {
    default_duration_minutes: values.defaultDurationMinutes === undefined ? existing.default_duration_minutes ?? null : values.defaultDurationMinutes,
    ...storedEnd(end.endOn, end.endTime),
    ...storedPause(pause),
    auto_archived_at: values.active ? null : existing.auto_archived_at ?? null,
    category_id: values.categoryId,
    title: definitionEventPlan?.nextTitle ?? existing.title,
    description: definitionEventPlan ? definitionEventPlan.nextDescription : existing.description,
    ...planBehaviorWhere(values, existing),
    ...storedRecurrence(values, values.isOpportunity ?? existing.is_opportunity === true),
    is_opportunity: values.isOpportunity ?? existing.is_opportunity === true,
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
    ...storedLinkFields(existing),
  };
  const expectedScheduleGraph = toStoredBehaviorScheduleGraph(existing);
  let schedules = values.schedules.map(toBehaviorScheduleMutation);
  // Sub-behaviors (depth 1): a changed link is checked, and an inheriting sub-behavior
  // stores its parent's schedule whatever the form sent.
  const previousParentId = existing.parent_behavior_id ?? null;
  const nextParentId = values.parentBehaviorId === undefined ? previousParentId : values.parentBehaviorId;
  const linkChanged = nextParentId !== previousParentId;
  const behaviors = linkChanged && nextParentId ? await requireBehaviorList(store) : await listBehaviorsIfSupported(store);
  const nextIsOpportunity = values.isOpportunity ?? existing.is_opportunity === true;
  const opportunityTurnedOn = nextIsOpportunity && existing.is_opportunity !== true;
  if ((linkChanged && nextParentId) || opportunityTurnedOn) {
    assertSubBehaviorLink({
      behaviorId: existing.id, nextParentBehaviorId: nextParentId, nextIsOpportunity,
      behaviors: behaviors ?? await requireBehaviorList(store),
    });
  }
  if (nextParentId) {
    behavior = {
      ...behavior,
      ...storedLinkFields({
        parent_behavior_id: nextParentId,
        inherit_parent_schedule: values.inheritParentSchedule
          ?? (linkChanged ? true : existing.inherit_parent_schedule ?? false),
        sub_behavior_sort_order: values.subBehaviorSortOrder ?? (linkChanged
          ? nextSubBehaviorSortOrder(listSubBehaviors(nextParentId, (behaviors ?? []).map(toSubBehaviorLinkFacts), { includeArchived: true }))
          : existing.sub_behavior_sort_order ?? 0),
      }),
    };
    const parent = behaviors?.find((candidate) => candidate.id === nextParentId);
    if (behavior.inherit_parent_schedule && parent) {
      const mirror = mirrorParentSchedule({ parent: storedMirrorable(parent), childSchedules: expectedScheduleGraph });
      behavior = { ...behavior, ...mirror.fields };
      schedules = mirror.schedules;
    }
  } else {
    behavior = { ...behavior, ...storedLinkFields({}) };
  }
  const configurationEventPlan = planBehaviorConfigurationChangeEvent({
    previousConfiguration: toBehaviorConfigurationSnapshot(existing, expectedScheduleGraph),
    nextConfiguration: toBehaviorConfigurationSnapshot(behavior, schedules),
    recordedAt: input.recordedAt,
    effectiveAt: input.recordedAt,
    source: "manual",
    reasonCode: "behavior_edited",
  });
  const commit: BehaviorUpdateCommit = {
    behaviorId: input.behaviorId,
    behavior,
    expectedDefinition: { title: existing.title, description: existing.description },
    expectedNormalizedDefinition: previousDefinition,
    expectedScheduleGraph,
    expectedUpdatedAt: input.expectedUpdatedAt,
    definitionEventPlan,
    configurationEventPlan,
    schedules,
  };
  // A parent edit mirrors onto inheriting sub-behaviors; archiving it archives them too.
  const groupCommits = behaviors ? planSubBehaviorGroupCommits({
    parent: existing, next: behavior, schedules, behaviors, recordedAt: input.recordedAt,
    reasonCode: "behavior_edited", newId: input.newId,
  }) : [];
  return commitBehaviorGroup(store, commit, groupCommits);
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
    newId?: () => string;
  },
) {
  const existing = await requireBehavior(store, input.behaviorId);
  const behaviors = await listBehaviorsIfSupported(store);
  if (input.active && !existing.active && existing.parent_behavior_id && behaviors) {
    const parent = behaviors.find((candidate) => candidate.id === existing.parent_behavior_id);
    if (parent && (parent.archived_at || !parent.active)) throw subBehaviorError("Restore the parent Behavior first.");
  }
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
  const commit: BehaviorUpdateCommit = {
    behaviorId: existing.id,
    behavior,
    expectedDefinition,
    expectedNormalizedDefinition: normalizeBehaviorDefinition(expectedDefinition),
    expectedScheduleGraph: schedules,
    expectedUpdatedAt: input.expectedUpdatedAt ?? existing.updated_at,
    definitionEventPlan: null,
    configurationEventPlan,
    schedules,
  };
  // Archiving a parent archives its active sub-behaviors with it, links kept, so a
  // restore brings back the sub-behaviors archived at the same moment.
  const groupCommits = behaviors ? planSubBehaviorGroupCommits({
    parent: existing, next: behavior, schedules, behaviors, recordedAt: input.recordedAt,
    reasonCode: input.active ? "behavior_restored" : "behavior_archived", newId: input.newId,
  }) : [];
  return commitBehaviorGroup(store, commit, groupCommits);
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
  if (existing.parent_behavior_id && existing.inherit_parent_schedule) {
    throw new BehaviorRunStateError("This sub-behavior follows its parent's schedule. Change the parent, or give it its own schedule.");
  }
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
  const commit: BehaviorUpdateCommit = {
    behaviorId: existing.id,
    behavior: configurationEventPlan ? fields : storedBehaviorFields(existing),
    expectedDefinition,
    expectedNormalizedDefinition: normalizeBehaviorDefinition(expectedDefinition),
    expectedScheduleGraph: schedules,
    expectedUpdatedAt: input.expectedUpdatedAt ?? existing.updated_at,
    definitionEventPlan: null,
    configurationEventPlan,
    schedules,
  };
  // An end or pause on a parent reaches its inheriting sub-behaviors in the same write.
  const behaviors = configurationEventPlan ? await listBehaviorsIfSupported(store) : null;
  const groupCommits = behaviors ? planSubBehaviorGroupCommits({
    parent: existing, next: fields, schedules, behaviors, recordedAt: input.recordedAt,
    reasonCode: BEHAVIOR_RUN_REASON_CODES[action.kind],
  }) : [];
  return commitBehaviorGroup(store, commit, groupCommits);
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

/** An opportunity Behavior with no schedule stores no recurrence (Behaviors of Opportunity). */
function storedRecurrence(values: BehaviorInput, isOpportunity: boolean): Pick<BehaviorFields, "recurrence_rule" | "scheduled_time"> {
  if (isOpportunity && values.schedules.length === 0) return { recurrence_rule: null, scheduled_time: null };
  return { recurrence_rule: values.recurrenceRule as Json, scheduled_time: values.scheduledTime };
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
    isOpportunity: behavior.is_opportunity === true,
    parentBehaviorId: behavior.parent_behavior_id ?? null,
    inheritParentSchedule: behavior.parent_behavior_id ? behavior.inherit_parent_schedule ?? false : false,
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
    is_opportunity: existing.is_opportunity === true,
    timezone: existing.timezone,
    browser_reminder_enabled: existing.browser_reminder_enabled,
    email_reminder_enabled: existing.email_reminder_enabled,
    reminder_offset_minutes: existing.reminder_offset_minutes,
    active: existing.active,
    archived_at: existing.archived_at,
    archive_notes: existing.archive_notes,
    ...storedLinkFields(existing),
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


/** Dense sibling order for one parent's live sub-behaviors. Returns the rows that changed. */
export async function reorderSubBehaviors(
  store: BehaviorDataStore,
  input: { parentBehaviorId: string; orderedBehaviorIds: string[] },
): Promise<number> {
  if (!store.reorderSubBehaviors) throw new Error("Sub-behaviors are not available here.");
  const behaviors = await requireBehaviorList(store);
  const siblings = listSubBehaviors(input.parentBehaviorId, behaviors.map(toSubBehaviorLinkFacts));
  const plan = planSubBehaviorReorder({ siblings, orderedIds: input.orderedBehaviorIds });
  if (plan.length === 0) return 0;
  return store.reorderSubBehaviors(input);
}

/** A rejected sub-behavior link or group write. The message is the whole error. */
export class SubBehaviorLinkError extends BehaviorValidationError {
  constructor(message: string) {
    super(message, {});
    this.name = "SubBehaviorLinkError";
  }
}

function subBehaviorError(message: string): SubBehaviorLinkError {
  return new SubBehaviorLinkError(message);
}

function assertSubBehaviorLink(input: {
  behaviorId: string; nextParentBehaviorId: string | null; behaviors: readonly BehaviorGraphRecord[]; nextIsOpportunity?: boolean;
}): void {
  const result = validateSubBehaviorLink({
    behaviorId: input.behaviorId,
    nextParentBehaviorId: input.nextParentBehaviorId,
    behaviors: input.behaviors.map(toSubBehaviorLinkFacts),
    nextIsOpportunity: input.nextIsOpportunity,
  });
  if (!result.ok) throw subBehaviorError(result.message);
}

export function toSubBehaviorLinkFacts(behavior: BehaviorGraphRecord): SubBehaviorLinkFacts {
  return {
    id: behavior.id,
    title: behavior.title,
    parentBehaviorId: behavior.parent_behavior_id ?? null,
    subBehaviorSortOrder: behavior.sub_behavior_sort_order ?? 0,
    inheritParentSchedule: behavior.inherit_parent_schedule ?? false,
    active: behavior.active,
    archivedAt: behavior.archived_at,
    isOpportunity: behavior.is_opportunity === true,
  };
}

function storedLinkFields(behavior: Pick<BehaviorFields, "parent_behavior_id" | "inherit_parent_schedule" | "sub_behavior_sort_order">) {
  const parentId = behavior.parent_behavior_id ?? null;
  return {
    parent_behavior_id: parentId,
    sub_behavior_sort_order: parentId ? behavior.sub_behavior_sort_order ?? 0 : 0,
    inherit_parent_schedule: parentId ? behavior.inherit_parent_schedule ?? false : false,
  };
}

function storedMirrorable(behavior: BehaviorGraphRecord): MirrorableBehavior {
  return { fields: behavior, schedules: toStoredBehaviorScheduleGraph(behavior) };
}

async function requireBehaviorList(store: BehaviorDataStore): Promise<BehaviorGraphRecord[]> {
  if (!store.listBehaviors) throw subBehaviorError("Sub-behaviors are not available here.");
  return store.listBehaviors();
}

async function listBehaviorsIfSupported(store: BehaviorDataStore): Promise<BehaviorGraphRecord[] | null> {
  return store.listBehaviors ? store.listBehaviors() : null;
}

// Core has no id source of its own: callers pass one for sub-behavior writes.
function randomId(): string {
  throw new Error("Sub-behavior writes need an id source (newId).");
}

/**
 * The sub-behavior writes that go with one parent write: schedule, end and pause mirrors
 * for inheriting sub-behaviors; archive of active ones with an archived parent; restore of
 * the ones archived at the parent's archive moment.
 */
function planSubBehaviorGroupCommits(input: {
  parent: BehaviorGraphRecord;
  next: BehaviorFields;
  schedules: BehaviorScheduleGraphMutation[];
  behaviors: readonly BehaviorGraphRecord[];
  recordedAt: string;
  reasonCode: string;
  newId?: () => string;
}): BehaviorUpdateCommit[] {
  if (input.next.parent_behavior_id) return [];
  const children = input.behaviors.filter((behavior) =>
    behavior.parent_behavior_id === input.parent.id && behavior.id !== input.parent.id);
  if (children.length === 0) return [];
  const archiving = input.parent.active && !input.next.active;
  const restoring = !input.parent.active && input.next.active;
  const mirrors = new Map(planInheritedScheduleMirrors({
    parent: { fields: input.next, schedules: input.schedules },
    children: children
      .filter((child) => !child.archived_at || (restoring && child.archived_at === input.parent.archived_at))
      .map((child) => ({ ...storedMirrorable(child), id: child.id, inheritParentSchedule: child.inherit_parent_schedule ?? false })),
  }).map((mirror) => [mirror.behaviorId, mirror]));
  return children.flatMap((child) => {
    const mirror = mirrors.get(child.id);
    const archive = archiving && child.active && !child.archived_at;
    const restore = restoring && !child.active && !!child.archived_at && child.archived_at === input.parent.archived_at;
    if (!mirror && !archive && !restore) return [];
    const expectedScheduleGraph = toStoredBehaviorScheduleGraph(child);
    const notes = parseArchiveNotes(child.archive_notes);
    const fields: BehaviorFields = {
      ...storedBehaviorFields(child),
      ...(mirror?.fields ?? {}),
      ...(archive ? {
        active: false,
        archived_at: input.next.archived_at ?? input.recordedAt,
        archive_notes: serializeArchiveNotes(appendArchiveNote(notes, {
          id: (input.newId ?? randomId)(), archivedAt: input.recordedAt, note: null, updatedAt: input.recordedAt,
        })),
      } : {}),
      ...(restore ? { active: true, archived_at: null, auto_archived_at: null } : {}),
    };
    const schedules = mirror?.schedules ?? expectedScheduleGraph;
    const configurationEventPlan = planBehaviorConfigurationChangeEvent({
      previousConfiguration: toBehaviorConfigurationSnapshot(child, expectedScheduleGraph),
      nextConfiguration: toBehaviorConfigurationSnapshot(fields, schedules),
      recordedAt: input.recordedAt,
      effectiveAt: input.recordedAt,
      source: "manual",
      reasonCode: archive ? "behavior_archived" : restore ? "behavior_restored" : input.reasonCode,
    });
    if (!configurationEventPlan) return [];
    const expectedDefinition = { title: child.title, description: child.description };
    return [{
      behaviorId: child.id,
      behavior: fields,
      expectedDefinition,
      expectedNormalizedDefinition: normalizeBehaviorDefinition(expectedDefinition),
      expectedScheduleGraph,
      expectedUpdatedAt: child.updated_at,
      definitionEventPlan: null,
      configurationEventPlan,
      schedules,
    }];
  });
}

async function commitBehaviorGroup(
  store: BehaviorDataStore,
  commit: BehaviorUpdateCommit,
  groupCommits: BehaviorUpdateCommit[],
) {
  if (groupCommits.length === 0 || !store.updateBehaviorGroupWithAtomicScheduleGraphs) {
    const updated = await store.updateBehaviorWithAtomicScheduleGraph(commit);
    if (!updated) throw new Error("Behavior not found.");
    return updated;
  }
  const [updated] = await store.updateBehaviorGroupWithAtomicScheduleGraphs([commit, ...groupCommits]);
  if (!updated) throw new Error("Behavior not found.");
  return updated;
}
