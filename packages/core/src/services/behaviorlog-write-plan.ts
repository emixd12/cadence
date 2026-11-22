import { storedRunColumnsFromJson } from "./behavior-run-fields";
import { Temporal } from "@js-temporal/polyfill";
import type { BehaviorGraphRecord } from "../behavior-store";
import type { OccurrenceRecord } from "../data-store";
import type { Json } from "../types/json";
import type { BehaviorLogImportPreview } from "../types/behaviorlog-import";
import type { BehaviorLogRestorePreview } from "../types/behaviorlog-restore";
import type { LocalImportWritePlan, PortabilityConfigurationEventRow, PortabilityGraph, PortabilityImportRunRow, PortabilitySnapshot } from "../types/portability-rows";
import { planBehaviorConfigurationChangeEvent, planInitialBehaviorConfigurationEvent } from "../resolvers/behavior-configuration.resolver";
import { normalizeBehaviorConfiguration } from "../resolvers/behavior-configuration.resolver";
import { toBehaviorConfigurationSnapshot, toStoredBehaviorScheduleGraph } from "./behavior.service";
import { assembleBehaviorLogExistingRecords } from "./behaviorlog-existing";
import { buildRestorePayload } from "./behaviorlog-restore-plan";
import { withBehaviorLogPortability } from "./behaviorlog-preservation";

export type PortabilityPlanContext = { snapshot: PortabilitySnapshot; applyRun: PortabilityImportRunRow; now: string; newId: () => string };
export function graphRecord(graph: PortabilityGraph, categories: PortabilitySnapshot["categories"]): BehaviorGraphRecord {
  const category = categories.find(({ id }) => id === graph.behavior.category_id) ?? null;
  return { ...graph.behavior, category, schedule_slots: graph.slots, schedules: graph.schedules.map((parent) => ({ ...parent, schedule_slots: graph.slots.filter((slot) => slot.behavior_schedule_id === parent.id) })) };
}
export function existingRecords(snapshot: PortabilitySnapshot) {
  return assembleBehaviorLogExistingRecords({ ...snapshot, behaviors: snapshot.graphs.map((graph) => graphRecord(graph, snapshot.categories)) });
}
export function emptyWritePlan(context: PortabilityPlanContext, mode: LocalImportWritePlan["mode"]): LocalImportWritePlan {
  return { mode, applyRun: context.applyRun, categoryCreates: [], graphWrites: [], definitionEvents: [], statusEvents: [], occurrenceWrites: [], occurrenceDeletes: [], timeSessionWrites: [], importedNoteWrites: [], importedNoteDeletes: [], importedInterventionWrites: [], importedInterventionDeletes: [], mappings: [], result: {} };
}
export function configurationForGraph(graph: PortabilityGraph) {
  return normalizeBehaviorConfiguration(toBehaviorConfigurationSnapshot(graph.behavior, toStoredBehaviorScheduleGraph(graphRecord(graph, []))));
}
export function configureGraph(context: PortabilityPlanContext, graph: PortabilityGraph, previous: PortabilityGraph | undefined, reason: "behaviorlog_import" | "behaviorlog_restore"): PortabilityConfigurationEventRow[] {
  const nextConfiguration = configurationForGraph(graph);
  const shared = { recordedAt: context.now, effectiveAt: context.now, source: "import" as const, reasonCode: reason };
  const event = previous ? planBehaviorConfigurationChangeEvent({ ...shared, previousConfiguration: configurationForGraph(previous), nextConfiguration })
    : planInitialBehaviorConfigurationEvent({ ...shared, configuration: nextConfiguration });
  if (!event) return [];
  const row: PortabilityConfigurationEventRow = { id: context.newId(), user_id: context.snapshot.profile.id, behavior_id: graph.behavior.id, event_kind: event.eventKind,
    previous_configuration: event.previousConfiguration, next_configuration: event.nextConfiguration, changed_fields: event.changedFields,
    recorded_at: event.recordedAt, effective_at: event.effectiveAt, effective_local_date: event.effectiveLocalDate,
    timezone: event.timezone, source: event.source, reason_code: event.reasonCode, created_at: context.now };
  graph.behavior.current_configuration_event_id = row.id;
  return [row];
}
export function canonicalStoredTime(value: string): string { return Temporal.PlainTime.from(value).toString(); }
export function addMapping(plan: LocalImportWritePlan, context: PortabilityPlanContext, recordType: string, externalId: string, localId: string) {
  plan.mappings.push({ id: context.newId(), user_id: context.snapshot.profile.id, import_run_id: context.applyRun.id, record_type: recordType, external_id: externalId, local_id: localId, created_at: context.now });
}
export function writeOccurrence(plan: LocalImportWritePlan, context: PortabilityPlanContext, next: OccurrenceRecord) {
  const planned = plan.occurrenceWrites.find((write) => write.next.id === next.id);
  if (planned) planned.next = next;
  else plan.occurrenceWrites.push({ expected: context.snapshot.occurrences.find(({ id }) => id === next.id) ?? null, next });
}
export function plannedOccurrence(plan: LocalImportWritePlan, context: PortabilityPlanContext, id: string) {
  return plan.occurrenceWrites.find((write) => write.next.id === id)?.next ?? context.snapshot.occurrences.find((row) => row.id === id);
}
export function planBehaviorLogRestoreWrite(context: PortabilityPlanContext & { importPreview: BehaviorLogImportPreview; preview: BehaviorLogRestorePreview }): LocalImportWritePlan {
  if (!context.preview.valid || context.preview.errors.length || context.preview.summary.skippedCount || context.preview.summary.unsupportedActionCount || context.preview.statusHistoryPolicy.selected !== "preserve_append_only_history") throw new Error("This restore preview cannot be applied.");
  const { payload, mappings } = buildRestorePayload({ userId: context.snapshot.profile.id, importRunId: context.applyRun.id, now: context.now, importPreview: context.importPreview, preview: context.preview, existing: existingRecords(context.snapshot) });
  const plan = emptyWritePlan(context, "restore_apply");
  plan.applyRun = { ...plan.applyRun, dry_run_summary: withBehaviorLogPortability(plan.applyRun.dry_run_summary, context.importPreview.portability) };
  const user_id = context.snapshot.profile.id;
  const affected = new Set<string>([...payload.behaviors.map((row) => string(row.id)), ...payload.archive_behavior_ids, ...payload.schedules.map((row) => string(row.behavior_id))]);
  for (const graph of context.snapshot.graphs) if (graph.slots.some(({ id }) => payload.delete_schedule_ids.includes(id))) affected.add(graph.behavior.id);
  for (const behaviorId of affected) {
    const previous = context.snapshot.graphs.find(({ behavior }) => behavior.id === behaviorId);
    const source = payload.behaviors.find((row) => row.id === behaviorId);
    const behaviorAction = context.preview.actions.behaviors.find((action) => action.localId === behaviorId || action.externalId === source?.external_id)?.action;
    const scheduleSources = payload.schedules.filter((row) => row.behavior_id === behaviorId);
    const keepsSchedule = (id: string) => context.preview.actions.schedules.some((action) => action.localId === id && action.action === "keep");
    const deletesSchedule = previous?.slots.some(({ id }) => payload.delete_schedule_ids.includes(id)) ?? false;
    // Keep is a promise about the stored rows, including nullable categories and timestamps.
    // Reconstructing a kept native graph from the portable representation can normalize those away.
    if (previous && behaviorAction === "keep" && !deletesSchedule && scheduleSources.every((row) => keepsSchedule(string(row.id)))) continue;
    const graph: PortabilityGraph = previous ? { behavior: { ...previous.behavior }, schedules: previous.schedules.map((row) => ({ ...row })), slots: previous.slots.map((row) => ({ ...row })) } : { behavior: { id: behaviorId, user_id, category_id: null, title: "", description: null, recurrence_rule: {}, scheduled_time: "00:00:00", timezone: context.snapshot.profile.timezone, browser_reminder_enabled: true, email_reminder_enabled: false, reminder_offset_minutes: 0, default_duration_minutes: null, end_on: null, end_time: null, pause_from_on: null, pause_from_time: null, pause_back_on: null, auto_archived_at: null, parent_behavior_id: null, sub_behavior_sort_order: 0, inherit_parent_schedule: false, active: true, archived_at: null, current_configuration_event_id: null, created_at: context.now, updated_at: context.now }, schedules: [], slots: [] };
    if (source) {
      if (behaviorAction !== "keep") {
      let category = [...context.snapshot.categories, ...plan.categoryCreates].find(({ name }) => name.trim().replace(/\s+/g, " ").toLowerCase() === String(source.category_name ?? "").trim().replace(/\s+/g, " ").toLowerCase());
      if (!category && source.category_name) {
        category = { id: context.newId(), user_id, description: typeof source.category_description === "string" ? source.category_description : null, name: String(source.category_name).trim(), sort_order: Math.max(-1, ...context.snapshot.categories.map((row) => row.sort_order), ...plan.categoryCreates.map((row) => row.sort_order)) + 1, created_at: context.now, updated_at: context.now };
        plan.categoryCreates.push(category);
      }
      graph.behavior = { ...graph.behavior, title: string(source.title), description: nullable(source.description), category_id: category?.id ?? null,
        recurrence_rule: source.recurrence_rule as Json, scheduled_time: canonicalStoredTime(string(source.scheduled_time)), timezone: string(source.timezone),
        browser_reminder_enabled: source.browser_reminder_enabled === true, email_reminder_enabled: source.email_reminder_enabled === true,
        reminder_offset_minutes: Number(source.reminder_offset_minutes), active: source.active === true, archived_at: nullable(source.archived_at),
        ...(source.archive_notes === undefined ? {} : { archive_notes: source.archive_notes as Json }),
        ...(source.default_duration_minutes === undefined ? {} : {
          default_duration_minutes: typeof source.default_duration_minutes === "number"
            ? source.default_duration_minutes : null,
        }),
        ...storedRunColumnsFromJson(source),
        ...(source.auto_archived_at === undefined ? {} : { auto_archived_at: nullable(source.auto_archived_at) }),
        ...(source.parent_behavior_id === undefined ? {} : {
          parent_behavior_id: nullable(source.parent_behavior_id),
          sub_behavior_sort_order: typeof source.sub_behavior_sort_order === "number" ? source.sub_behavior_sort_order : 0,
          inherit_parent_schedule: source.inherit_parent_schedule === true,
        }),
        created_at: previous?.behavior.created_at ?? nullable(source.created_at) ?? context.now, updated_at: context.now };
      }
      if (graph.behavior.active && behaviorAction !== "keep") {
        // A restored end that has passed stays: the Behavior comes back as Ended.
        graph.behavior.auto_archived_at = null;
      }
      graph.schedules = []; graph.slots = [];
      const groups = new Map<string, Record<string, unknown>[]>();
      for (const row of scheduleSources) {
        const key = string(row.parent_group_key ?? row.id); groups.set(key, [...(groups.get(key) ?? []), row]);
      }
      for (const rows of groups.values()) {
        const first = rows[0];
        const retained = previous?.slots.find((slot) => rows.some((row) => row.id === slot.id))?.behavior_schedule_id;
        const parent = previous?.schedules.find(({ id }) => id === retained);
        const parentId = parent?.id ?? context.newId();
        graph.schedules.push(parent && rows.every((row) => keepsSchedule(string(row.id))) ? { ...parent } : { id: parentId, user_id, behavior_id: behaviorId, recurrence_rule: first.recurrence_rule as Json, sort_order: Number(first.configuration_sort_order), created_at: parent?.created_at ?? context.now, updated_at: context.now });
        for (const row of rows) {
          const kept = previous?.slots.find(({ id }) => id === row.id);
          graph.slots.push(kept && keepsSchedule(kept.id) ? { ...kept } : { id: string(row.id), user_id, behavior_id: behaviorId, behavior_schedule_id: parentId, kind: string(row.kind), preset: nullable(row.preset), start_time: canonicalStoredTime(string(row.start_time)), end_time: row.end_time ? canonicalStoredTime(string(row.end_time)) : null, sort_order: Number(row.sort_order), created_at: kept?.created_at ?? context.now, updated_at: context.now });
        }
      }
    } else if (payload.archive_behavior_ids.includes(behaviorId)) {
      graph.behavior = { ...graph.behavior, active: false, archived_at: graph.behavior.archived_at ?? context.now, updated_at: context.now };
    } else {
      graph.slots = graph.slots.filter(({ id }) => !payload.delete_schedule_ids.includes(id));
      graph.schedules = graph.schedules.filter(({ id }) => graph.slots.some((slot) => slot.behavior_schedule_id === id));
      graph.behavior.updated_at = context.now;
    }
    const configurationEvents = configureGraph(context, graph, previous, "behaviorlog_restore");
    plan.graphWrites.push({ graph, expectedRevision: previous?.revision ?? null, configurationEvents });
  }
  for (const row of payload.behavior_definition_events) plan.definitionEvents.push({ id: string(row.id), user_id, behavior_id: string(row.behavior_id), previous_title: nullable(row.previous_title), next_title: string(row.next_title), previous_description: nullable(row.previous_description), next_description: nullable(row.next_description), changed_fields: row.changed_fields as string[], recorded_at: string(row.recorded_at), source: "import", reason: nullable(row.reason), created_at: context.now, updated_at: context.now });
  for (const row of payload.occurrences) {
    const previous = context.snapshot.occurrences.find(({ id }) => id === row.id);
    const keepsOccurrence = previous && context.preview.actions.occurrences.some((action) => action.localId === previous.id && action.action === "keep");
    if (keepsOccurrence) {
      const changesStatus = payload.status_events.some((event) => event.occurrence_id === previous.id);
      const changesNote = context.preview.actions.inlineOccurrenceNotes.some((action) => action.localId === previous.id && ["create", "replace"].includes(action.action));
      if (changesStatus || changesNote) writeOccurrence(plan, context, { ...previous,
        ...(changesStatus ? { status: string(row.status), completed_at: nullable(row.completed_at), status_marked_at: nullable(row.status_marked_at) } : {}),
        ...(changesNote ? { note: nullable(row.note) } : {}), updated_at: context.now });
      continue;
    }
    const behavior = plan.graphWrites.find(({ graph }) => graph.behavior.id === row.behavior_id)?.graph.behavior ?? context.snapshot.graphs.find(({ behavior }) => behavior.id === row.behavior_id)?.behavior;
    if (!behavior) throw new Error("Restored occurrence parent is missing.");
    writeOccurrence(plan, context, { id: string(row.id), user_id, behavior_id: behavior.id, behavior_schedule_slot_id: nullable(row.behavior_schedule_slot_id), behavior_configuration_event_id: null,
      scheduled_for: string(row.scheduled_for), local_date: string(row.local_date), schedule_kind: string(row.schedule_kind), schedule_preset: nullable(row.schedule_preset), schedule_start_time: canonicalStoredTime(string(row.schedule_start_time)), schedule_end_time: row.schedule_end_time ? canonicalStoredTime(string(row.schedule_end_time)) : null, schedule_range_identity: null,
      status: string(row.status), completed_at: nullable(row.completed_at), status_marked_at: nullable(row.status_marked_at), note: nullable(row.note), created_at: previous?.created_at ?? nullable(row.created_at) ?? context.now, updated_at: context.now });
  }
  for (const occurrenceId of payload.clear_occurrence_note_ids) {
    const row = plannedOccurrence(plan, context, occurrenceId); if (!row) throw new Error("Restored note target is missing."); writeOccurrence(plan, context, { ...row, note: null, updated_at: context.now });
  }
  plan.occurrenceDeletes = context.snapshot.occurrences.filter(({ id }) => payload.delete_occurrence_ids.includes(id));
  plan.statusEvents = payload.status_events.map((row) => ({ id: string(row.id), user_id, occurrence_id: string(row.occurrence_id), behavior_id: string(row.behavior_id), previous_status: nullable(row.previous_status), status: string(row.status), status_semantics: string(row.status_semantics), recorded_at: string(row.recorded_at), effective_at: nullable(row.effective_at), local_date: string(row.local_date), timezone: string(row.timezone), source_capture_method: string(row.source_capture_method), source_confidence: string(row.source_confidence), revises_event_id: nullable(row.revises_event_id), reason_code: nullable(row.reason_code), created_at: context.now, updated_at: context.now }));
  plan.timeSessionWrites = payload.time_sessions.map((row) => { const expected = context.snapshot.timeSessions.find(({ id }) => id === row.id) ?? null;
    return { expected, next: { id: string(row.id), user_id, occurrence_id: string(row.occurrence_id), behavior_id: string(row.behavior_id), started_at: string(row.started_at), stopped_at: nullable(row.stopped_at), created_at: expected?.created_at ?? context.now, updated_at: context.now } }; });
  plan.importedNoteWrites = payload.imported_notes.filter((row) => !context.preview.actions.importedNotes.some((action) => action.localId === row.id && action.action === "keep")).map((row) => { const expected = context.snapshot.importedNotes.find(({ id }) => id === row.id) ?? null; return { expected, next: { ...row, user_id, created_at: expected?.created_at ?? context.now, updated_at: context.now } as LocalImportWritePlan["importedNoteWrites"][number]["next"] }; });
  plan.importedInterventionWrites = payload.imported_interventions.filter((row) => !context.preview.actions.importedInterventions.some((action) => action.localId === row.id && action.action === "keep")).map((row) => { const expected = context.snapshot.importedInterventions.find(({ id }) => id === row.id) ?? null; return { expected, next: { ...row, user_id, created_at: expected?.created_at ?? context.now, updated_at: context.now } as LocalImportWritePlan["importedInterventionWrites"][number]["next"] }; });
  plan.importedNoteDeletes = context.snapshot.importedNotes.filter(({ id }) => payload.delete_imported_note_ids.includes(id));
  plan.importedInterventionDeletes = context.snapshot.importedInterventions.filter(({ id }) => payload.delete_imported_intervention_ids.includes(id));
  for (const mapping of mappings) addMapping(plan, context, mapping.recordType, mapping.externalId, mapping.localId);
  plan.result = { behaviors: payload.behaviors.length, archived_behaviors: payload.archive_behavior_ids.length, schedules: payload.schedules.length, deleted_schedules: payload.delete_schedule_ids.length, occurrences: payload.occurrences.length, deleted_occurrences: plan.occurrenceDeletes.length, status_events: plan.statusEvents.length, behavior_definition_events: plan.definitionEvents.length, behavior_configuration_events: plan.graphWrites.reduce((total, write) => total + write.configurationEvents.length, 0), time_sessions: plan.timeSessionWrites.length, imported_notes: plan.importedNoteWrites.length, imported_interventions: plan.importedInterventionWrites.length, provenance_mappings: plan.mappings.length };
  return plan;
}
function string(value: unknown): string { if (typeof value !== "string") throw new Error("A reviewed restore row is missing a required value."); return value; }
function nullable(value: unknown): string | null { return typeof value === "string" ? value : null; }
