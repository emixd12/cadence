import { storedRunColumns } from "./behavior-run-fields";
import { Temporal } from "@js-temporal/polyfill";
import type { BehaviorLogImportBehaviorPlan, BehaviorLogImportIssue, BehaviorLogImportMergePreviewResult, BehaviorLogImportSchedulePlan } from "../types/behaviorlog-import";
import type { LocalImportWritePlan, PortabilityGraph } from "../types/portability-rows";
import type { OccurrenceStatusEventRecord } from "../data-store";
import { toCadenceRecurrenceRule } from "./behaviorlog-restore-plan";
import { addMapping, canonicalStoredTime, configureGraph, emptyWritePlan, plannedOccurrence, writeOccurrence, type PortabilityPlanContext } from "./behaviorlog-write-plan";
import { withBehaviorLogPortability } from "./behaviorlog-preservation";
import { serializeArchiveNotes } from "../resolvers/archive-note.resolver";

// Row projection of the production Aug27 atomic import and portability wrapper.
// The existing resolver owns matching, conflicts, provenance and supported records.
export function planBehaviorLogImportWrite(context: PortabilityPlanContext & {
  preview: BehaviorLogImportMergePreviewResult;
  mode: "create_missing_only" | "merge_by_user_approved_plan";
  interventionRulesPresent: boolean;
}): LocalImportWritePlan {
  const { preview, mode, snapshot, now } = context;
  if (!preview.valid || preview.errors.length || preview.mergePreview.conflictCount) throw new Error("This import preview cannot be applied.");
  const plan = emptyWritePlan(context, mode);
  plan.applyRun = { ...plan.applyRun, dry_run_summary: withBehaviorLogPortability(plan.applyRun.dry_run_summary, preview.portability) };
  const user_id = snapshot.profile.id;
  const groups = ["behaviors", "schedules", "occurrences", "statusEvents", "notes", "interventions", "definitionEvents", "timeSessions"] as const;
  type Group = typeof groups[number];
  const counts = () => Object.fromEntries(groups.map((group) => [group, 0])) as Record<Group, number>;
  const result = { created: { ...counts(), mappings: 0 }, mapped: counts(), skipped: counts(), warnings: [...preview.warnings] };
  const ids = { behaviors: new Map<string, string>(), schedules: new Map<string, string>(), occurrences: new Map<string, string>(), statusEvents: new Map<string, string>() };
  const action = (group: Group, id: string) => preview.mergePreview.actions[group]?.find((entry) => entry.externalId === id);
  const creates = (group: Group, row: { action: string; externalId: string }) => row.action === "create" && (mode === "create_missing_only" || action(group, row.externalId)?.action === "create_new");
  const mapping = (group: Group, recordType: string, externalId: string, localId: string, kind: "created" | "mapped" | "skipped") => { addMapping(plan, context, recordType, externalId, localId); result.created.mappings++; result[kind][group]++; };
  const graphById = new Map<string, PortabilityGraph>();
  for (const row of preview.plan.behaviors) {
    const merge = action("behaviors", row.externalId);
    if (mode === "merge_by_user_approved_plan" && (merge?.action === "map_to_existing" || merge?.action === "skip_existing")) {
      const found = snapshot.graphs.find(({ behavior }) => behavior.id === merge.localId);
      if (merge.localId && !found) throw new Error("Mapped BehaviorLog behavior no longer exists.");
      if (found) { ids.behaviors.set(row.externalId, found.behavior.id); graphById.set(found.behavior.id, { behavior: { ...found.behavior }, schedules: found.schedules.map((item) => ({ ...item })), slots: found.slots.map((item) => ({ ...item })) }); mapping("behaviors", "behavior", row.externalId, found.behavior.id, "mapped"); }
      else result.skipped.behaviors++;
      continue;
    }
    const schedules = preview.plan.schedules.filter((schedule) => schedule.behaviorExternalId === row.externalId && schedule.action === "create" && schedule.cadenceImportRole !== "historical_reference_only" && scheduleShape(schedule)).sort(byExternal);
    // An opportunity Behavior may have no schedule (Behaviors of Opportunity).
    const unscheduled = !schedules.length && row.cadenceIsOpportunity === true;
    if (!creates("behaviors", row) || (!schedules.length && !unscheduled)) { result.skipped.behaviors++; continue; }
    const behaviorId = context.newId();
    const rules = (preview.plan.interventionRules ?? []).filter((rule) => rule.behaviorExternalId === row.externalId && rule.action === "create" && rule.enabled && rule.interventionType === "reminder");
    const primary = unscheduled ? null : scheduleShape(schedules[0])!;
    const categoryNames = [row.cadenceCategoryName, row.category].filter((name): name is string => name !== null).map(normalizedName);
    const category = [...snapshot.categories].sort((left, right) => categoryNames.indexOf(normalizedName(left.name)) - categoryNames.indexOf(normalizedName(right.name)) || left.id.localeCompare(right.id)).find(({ name }) => categoryNames.includes(normalizedName(name)));
    const graph: PortabilityGraph = { behavior: { id: behaviorId, user_id, category_id: category?.id ?? null, title: row.title, description: row.description,
      recurrence_rule: primary?.recurrence_rule ?? null, scheduled_time: primary?.start_time ?? null,
      timezone: schedules[0]?.timezone ?? preview.plan.occurrences.find((occurrence) => occurrence.behaviorExternalId === row.externalId)?.timezone ?? snapshot.profile.timezone,
      is_opportunity: row.cadenceIsOpportunity === true,
      browser_reminder_enabled: context.interventionRulesPresent ? rules.some((rule) => rule.channel === "browser_push") : row.cadenceBrowserReminderEnabled ?? true,
      email_reminder_enabled: context.interventionRulesPresent ? rules.some((rule) => rule.channel === "email") : row.cadenceEmailReminderEnabled ?? false,
      reminder_offset_minutes: context.interventionRulesPresent ? Math.max(0, -(rules.filter((rule) => ["browser_push", "email"].includes(rule.channel) && rule.offsetMinutes !== null).sort(byExternal)[0]?.offsetMinutes ?? 0)) : row.cadenceReminderOffsetMinutes ?? 0,
      active: row.archivedAtUtc ? false : row.cadenceActive ?? true, archived_at: row.archivedAtUtc,
      archive_notes: serializeArchiveNotes(row.cadenceArchiveNotes ?? []), current_configuration_event_id: null,
      default_duration_minutes: row.expectedDurationMinutes ?? null,
      ...(row.cadenceRun ? storedRunColumns(row.cadenceRun) : {}),
      auto_archived_at: row.cadenceAutoArchivedAt ?? null,
      ...importedSubBehaviorLink(row, ids.behaviors, result.warnings),
      created_at: row.createdAtUtc ?? now, updated_at: row.createdAtUtc ?? now }, schedules: [], slots: [] };
    const parentGroups = new Map<string, BehaviorLogImportSchedulePlan[]>();
    for (const schedule of schedules) { const key = schedule.cadenceBehaviorScheduleId ?? schedule.externalId; parentGroups.set(key, [...(parentGroups.get(key) ?? []), schedule]); }
    for (const sourceGroup of parentGroups.values()) {
      const consistent = new Set(sourceGroup.map((schedule) => JSON.stringify(scheduleShape(schedule)!.recurrence_rule))).size === 1 && new Set(sourceGroup.map((schedule) => scheduleShape(schedule)!.start_time)).size === sourceGroup.length;
      for (const group of consistent ? [sourceGroup] : sourceGroup.map((row) => [row])) {
        const parentId = context.newId(); const shape = scheduleShape(group[0])!;
        graph.schedules.push({ id: parentId, user_id, behavior_id: behaviorId, recurrence_rule: shape.recurrence_rule, sort_order: graph.schedules.length, created_at: now, updated_at: now });
        for (const schedule of group) {
          const slotId = context.newId(); graph.slots.push({ id: slotId, user_id, behavior_id: behaviorId, behavior_schedule_id: parentId, ...slotShape(scheduleShape(schedule)!), sort_order: group.indexOf(schedule), created_at: now, updated_at: now });
          ids.schedules.set(schedule.externalId, slotId); mapping("schedules", "schedule", schedule.externalId, slotId, "created");
        }
      }
    }
    graphById.set(behaviorId, graph); ids.behaviors.set(row.externalId, behaviorId); mapping("behaviors", "behavior", row.externalId, behaviorId, "created");
    const definitionEvents = (preview.plan.definitionEvents ?? []).filter((event) => event.behaviorExternalId === row.externalId && event.action === "create" && event.nextTitle !== null).sort((left, right) => compareInstants(left.recordedAtUtc, right.recordedAtUtc) || byExternal(left, right));
    if (definitionEvents.some((event) => event.eventKind === "baseline")) {
      for (const event of definitionEvents) {
        const changed = [event.previousTitle !== event.nextTitle ? "title" : null, event.previousDescription !== event.nextDescription ? "description" : null].filter((field): field is string => field !== null);
        if (!changed.length) continue;
        const id = context.newId(); plan.definitionEvents.push({ id, user_id, behavior_id: behaviorId, previous_title: event.previousTitle, next_title: event.nextTitle!, previous_description: event.previousDescription, next_description: event.nextDescription, changed_fields: changed, recorded_at: event.recordedAtUtc, source: "import", reason: event.reasonCode, created_at: now, updated_at: now }); mapping("definitionEvents", "behavior_definition_event", event.externalId, id, "created");
      }
    } else plan.definitionEvents.push({ id: context.newId(), user_id, behavior_id: behaviorId, previous_title: null, next_title: row.title, previous_description: null, next_description: row.description, changed_fields: row.description === null ? ["title"] : ["title", "description"], recorded_at: row.createdAtUtc ?? now, source: "import", reason: "behaviorlog_import", created_at: now, updated_at: now });
  }
  for (const row of [...preview.plan.schedules].sort((left, right) => left.behaviorExternalId.localeCompare(right.behaviorExternalId) || byExternal(left, right))) {
    if (ids.schedules.has(row.externalId)) continue;
    const merge = action("schedules", row.externalId);
    const shape = scheduleShape(row);
    if (mode === "merge_by_user_approved_plan" && merge?.action === "create_new" && shape) {
      const behaviorId = ids.behaviors.get(row.behaviorExternalId); const graph = behaviorId ? graphById.get(behaviorId) : undefined;
      if (!graph) throw new Error("Imported schedule parent Behavior is missing.");
      const parentId = context.newId(); const slotId = context.newId();
      graph.schedules.push({ id: parentId, user_id, behavior_id: graph.behavior.id, recurrence_rule: shape.recurrence_rule, sort_order: Math.max(-1, ...graph.schedules.map((row) => row.sort_order)) + 1, created_at: now, updated_at: now });
      graph.slots.push({ id: slotId, user_id, behavior_id: graph.behavior.id, behavior_schedule_id: parentId, ...slotShape(shape), sort_order: 0, created_at: now, updated_at: now });
      ids.schedules.set(row.externalId, slotId); mapping("schedules", "schedule", row.externalId, slotId, "created");
    } else if (mode === "merge_by_user_approved_plan" && merge?.localId) {
      if (!snapshot.graphs.some((graph) => graph.slots.some(({ id }) => id === merge.localId))) throw new Error("Mapped BehaviorLog schedule no longer exists.");
      ids.schedules.set(row.externalId, merge.localId); mapping("schedules", "schedule", row.externalId, merge.localId, merge.action === "map_to_existing" ? "mapped" : "skipped");
    } else result.skipped.schedules++;
  }
  for (const graph of graphById.values()) {
    const previous = snapshot.graphs.find(({ behavior }) => behavior.id === graph.behavior.id);
    if (previous && JSON.stringify({ behavior: previous.behavior, schedules: previous.schedules, slots: previous.slots }) === JSON.stringify(graph)) continue;
    const configurationEvents = configureGraph(context, graph, previous, "behaviorlog_import");
    plan.graphWrites.push({ graph, expectedRevision: previous?.revision ?? null, configurationEvents });
  }
  for (const row of preview.plan.occurrences) {
    const merge = action("occurrences", row.externalId);
    if (mode === "merge_by_user_approved_plan" && merge?.localId) {
      if (!snapshot.occurrences.some(({ id }) => id === merge.localId)) throw new Error("Mapped BehaviorLog occurrence no longer exists.");
      ids.occurrences.set(row.externalId, merge.localId); mapping("occurrences", "occurrence", row.externalId, merge.localId, merge.action === "map_to_existing" ? "mapped" : "skipped"); continue;
    }
    if (!creates("occurrences", row)) { result.skipped.occurrences++; continue; }
    const graph = graphById.get(ids.behaviors.get(row.behaviorExternalId) ?? ""); const schedule = preview.plan.schedules.find((schedule) => schedule.externalId === row.scheduleExternalId); const shape = schedule ? scheduleShape(schedule) : null;
    const slotId = row.importWithDetachedScheduleSnapshot ? null : ids.schedules.get(row.scheduleExternalId) ?? null;
    if (!graph || !shape || (!row.importWithDetachedScheduleSnapshot && !slotId)) throw new Error("Imported occurrence parent is missing.");
    const id = context.newId(); writeOccurrence(plan, context, { id, user_id, behavior_id: graph.behavior.id, behavior_schedule_slot_id: slotId, behavior_configuration_event_id: null,
      scheduled_for: row.scheduledForUtc, local_date: row.localDate, schedule_kind: shape.kind, schedule_preset: shape.preset, schedule_start_time: shape.start_time, schedule_end_time: shape.end_time, schedule_range_identity: null,
      status: "unresolved", completed_at: null, status_marked_at: null, note: null,
      origin: row.cadenceOrigin ?? "scheduled", added_by: row.cadenceOrigin === "opportunity" ? row.cadenceAddedBy ?? null : null,
      created_at: row.generatedAtUtc ?? now, updated_at: row.generatedAtUtc ?? now });
    ids.occurrences.set(row.externalId, id); mapping("occurrences", "occurrence", row.externalId, id, "created");
  }
  for (const row of [...preview.plan.statusEvents].sort((left, right) => compareInstants(left.recordedAtUtc, right.recordedAtUtc) || byExternal(left, right))) {
    const merge = action("statusEvents", row.externalId);
    if (mode === "merge_by_user_approved_plan" && merge?.localId) { ids.statusEvents.set(row.externalId, merge.localId); mapping("statusEvents", "status_event", row.externalId, merge.localId, merge.action === "map_to_existing" ? "mapped" : "skipped"); continue; }
    if (!creates("statusEvents", row)) { result.skipped.statusEvents++; continue; }
    const occurrenceId = ids.occurrences.get(row.occurrenceExternalId), behaviorId = ids.behaviors.get(row.behaviorExternalId);
    if (!occurrenceId || !behaviorId) throw new Error("Imported status event parent is missing.");
    const id = context.newId(); plan.statusEvents.push({ id, user_id, occurrence_id: occurrenceId, behavior_id: behaviorId, previous_status: row.previousStatus, status: row.status, status_semantics: row.statusSemantics, recorded_at: row.recordedAtUtc, effective_at: row.effectiveAtUtc, local_date: row.localDate, timezone: row.timezone, source_capture_method: row.sourceCaptureMethod, source_confidence: row.sourceConfidence, revises_event_id: row.revisesEventId ? ids.statusEvents.get(row.revisesEventId) ?? null : null, reason_code: row.reasonCode, created_at: now, updated_at: now });
    ids.statusEvents.set(row.externalId, id); mapping("statusEvents", "status_event", row.externalId, id, "created");
  }
  const importedEventIds = new Set(ids.statusEvents.values());
  const allEvents = [...snapshot.statusEvents, ...plan.statusEvents];
  for (const occurrenceId of new Set(allEvents.filter(({ id }) => importedEventIds.has(id)).map((event) => event.occurrence_id))) {
    const events = allEvents.filter((event) => event.occurrence_id === occurrenceId).sort(compareStatusEvents);
    const latest = events.at(-1)!;
    const explicitConflict = events.some((event) => !importedEventIds.has(event.id) && ["explicit_user_mark", "explicit_user_correction"].includes(event.status_semantics) && event.source_confidence === "high" && event.status !== latest.status && (latest.status_semantics === "ambiguous_import" || ["medium", "low", "ambiguous", "unknown"].includes(latest.source_confidence)));
    if (!importedEventIds.has(latest.id) || explicitConflict) continue;
    const occurrence = plannedOccurrence(plan, context, occurrenceId); if (!occurrence) throw new Error("Imported status event target is missing.");
    writeOccurrence(plan, context, { ...occurrence, status: latest.status, completed_at: latest.status === "completed" ? latest.effective_at ?? latest.recorded_at : null, status_marked_at: latest.recorded_at, updated_at: now });
  }
  for (const row of preview.plan.notes) {
    const merge = action("notes", row.externalId);
    if (row.action === "skip" || row.noteRole === "ai_generated" || (mode === "merge_by_user_approved_plan" && merge?.action === "skip_existing")) { result.skipped.notes++; continue; }
    const old = mode === "merge_by_user_approved_plan" && merge?.action === "map_to_existing" ? snapshot.importedNotes.find(({ id }) => id === merge.localId)
      : [...snapshot.importedNotes].sort((a, b) => compareInstants(a.created_at, b.created_at) || a.id.localeCompare(b.id)).find((note) => note.external_id === row.externalId && note.target_type === row.attachedToType && note.target_external_id === row.attachedToId);
    if (old) { mapping("notes", "note", row.externalId, old.id, mode === "merge_by_user_approved_plan" ? "mapped" : "skipped"); continue; }
    const body = row.bodyMarkdown.replace(/\r\n/g, "\n").trim(); if (!body) { result.skipped.notes++; continue; }
    const targetId = row.attachedToType === "behavior" ? ids.behaviors.get(row.attachedToId) : row.attachedToType === "occurrence" ? ids.occurrences.get(row.attachedToId) : row.attachedToType === "status_event" ? ids.statusEvents.get(row.attachedToId) : null;
    if (row.attachedToType !== "review" && !targetId) throw new Error("Imported note target is missing.");
    const id = context.newId(); plan.importedNoteWrites.push({ expected: null, next: { id, user_id, import_run_id: context.applyRun.id, external_id: row.externalId, target_type: row.attachedToType, target_external_id: row.attachedToId, target_local_id: targetId ?? null, body_markdown: body, note_role: row.noteRole, sensitivity: row.sensitivity, source_original_id: row.sourceOriginalId ?? null, source_capture_method: row.sourceCaptureMethod, source_confidence: row.sourceConfidence, imported_created_at: row.createdAtUtc, imported_updated_at: row.updatedAtUtc,
      metadata: { noteDecision: String(merge?.metadata?.noteDecision ?? ""), attachment: { type: row.attachedToType, externalId: row.attachedToId, localId: targetId ?? null }, passiveImportedNote: true, analyticsStatusSideEffects: false }, created_at: now, updated_at: now } });
    mapping("notes", "note", row.externalId, id, "created");
    if (row.attachedToType === "occurrence" && ["fill_created_occurrence_note", "fill_empty_occurrence_note"].includes(String(merge?.metadata?.noteDecision))) { const occurrence = plannedOccurrence(plan, context, targetId!); if (occurrence && !occurrence.note?.trim()) writeOccurrence(plan, context, { ...occurrence, note: body, updated_at: now }); }
  }
  for (const row of preview.plan.interventions) {
    const merge = action("interventions", row.externalId);
    if (mode === "merge_by_user_approved_plan" && (merge?.action === "map_to_existing" || merge?.action === "skip_existing")) {
      if (merge.localId) mapping("interventions", "intervention", row.externalId, merge.localId, merge.action === "map_to_existing" ? "mapped" : "skipped"); else result.skipped.interventions++; continue;
    }
    if (!row.scheduledSendAtUtc) { result.skipped.interventions++; continue; }
    const id = context.newId(); plan.importedInterventionWrites.push({ expected: null, next: { id, user_id, import_run_id: context.applyRun.id, external_id: row.externalId, behavior_external_id: row.behaviorExternalId, occurrence_external_id: row.occurrenceExternalId, behavior_id: ids.behaviors.get(row.behaviorExternalId) ?? null, occurrence_id: ids.occurrences.get(row.occurrenceExternalId) ?? null, intervention_type: row.interventionType, channel: row.channel, delivery_status: row.deliveryStatus, scheduled_send_at: row.scheduledSendAtUtc, sent_at: row.sentAtUtc, failure_reason: row.failureReason, source_original_id: row.sourceOriginalId ?? null, source_capture_method: row.sourceCaptureMethod, source_confidence: row.sourceConfidence,
      redacted_sensitivity_indicators: { droppedSensitiveFields: row.storageDecision.droppedSensitiveFields, redactedFields: row.storageDecision.redactedFields, containsSensitiveDeliveryPayload: !!(row.storageDecision.droppedSensitiveFields.length || row.storageDecision.redactedFields.length), rawMessageBodyStored: false, rawEndpointStored: false, recipientIdentifiersStored: false }, metadata: { interventionDecision: String(merge?.metadata?.interventionDecision ?? ""), storageDecision: row.storageDecision, passiveImportedIntervention: true, reminderDeliverySideEffects: false, providerSideEffects: false }, created_at: now, updated_at: now } }); mapping("interventions", "intervention", row.externalId, id, "created");
  }
  for (const row of [...(preview.plan.timeSessions ?? [])].sort((a, b) => compareInstants(a.startedAtUtc, b.startedAtUtc) || byExternal(a, b))) {
    const merge = action("timeSessions", row.externalId);
    if (row.action !== "create" || (mode === "merge_by_user_approved_plan" && !["create_new", "map_to_existing"].includes(merge?.action ?? ""))) { result.skipped.timeSessions++; continue; }
    if (mode === "merge_by_user_approved_plan" && merge?.action === "map_to_existing") { if (snapshot.timeSessions.some(({ id }) => id === merge.localId)) mapping("timeSessions", "time_session", row.externalId, merge.localId!, "mapped"); continue; }
    const occurrenceId = ids.occurrences.get(row.occurrenceExternalId), behaviorId = ids.behaviors.get(row.behaviorExternalId);
    const occurrence = occurrenceId ? plannedOccurrence(plan, context, occurrenceId) : undefined;
    if (!occurrence || occurrence.behavior_id !== behaviorId || (!row.stoppedAtUtc && [...snapshot.timeSessions, ...plan.timeSessionWrites.map(({ next }) => next)].some((session) => session.occurrence_id === occurrenceId && session.stopped_at === null))) {
      result.skipped.timeSessions++; result.warnings.push({ severity: "warning", code: "time_session_replay_skipped", message: `Time session ${row.externalId} was skipped because its mapped parents or running-session invariant were unavailable.`, file: "data/time_sessions.jsonl" }); continue;
    }
    const id = context.newId(); plan.timeSessionWrites.push({ expected: null, next: { id, user_id, occurrence_id: occurrence.id, behavior_id: occurrence.behavior_id, started_at: row.startedAtUtc, stopped_at: row.stoppedAtUtc, created_at: now, updated_at: now } }); mapping("timeSessions", "time_session", row.externalId, id, "created");
  }
  plan.result = result; return plan;
}
function scheduleShape(schedule: BehaviorLogImportSchedulePlan) {
  if (schedule.recurrenceProfile !== "behaviorlog.calendar_simple.v1" || !["daily", "every_n_days", "weekly_on_weekdays", "every_n_weeks_on_weekdays", "monthly_on_day"].includes(String(schedule.recurrence.type))) return null;
  const recurrence_rule = toCadenceRecurrenceRule(schedule);
  if (schedule.windowStartLocal && schedule.windowEndLocal) {
    const start_time = canonicalStoredTime(schedule.windowStartLocal), end_time = canonicalStoredTime(schedule.windowEndLocal);
    const preset = schedule.cadenceSchedulePreset ?? ({ "06:00:00/12:00:00": "morning", "12:00:00/18:00:00": "afternoon", "18:00:00/00:00:00": "evening", "00:00:00/06:00:00": "night" } as Record<string, string>)[`${start_time}/${end_time}`] ?? null;
    return { recurrence_rule, kind: "range", preset, start_time, end_time };
  }
  return schedule.localTime ? { recurrence_rule, kind: "exact", preset: null, start_time: canonicalStoredTime(schedule.localTime), end_time: null } : null;
}
function normalizedName(value: string) { return value.trim().replace(/\s+/g, " ").toLowerCase(); }
function byExternal(left: { externalId: string }, right: { externalId: string }) { return left.externalId.localeCompare(right.externalId); }
function compareInstants(left: string, right: string) { return Temporal.Instant.compare(left, right); }
function compareStatusEvents(left: OccurrenceStatusEventRecord, right: OccurrenceStatusEventRecord) { return compareInstants(left.effective_at ?? left.recorded_at, right.effective_at ?? right.recorded_at) || compareInstants(left.recorded_at, right.recorded_at) || left.id.localeCompare(right.id); }

function slotShape(shape: NonNullable<ReturnType<typeof scheduleShape>>) { return { kind: shape.kind, preset: shape.preset, start_time: shape.start_time, end_time: shape.end_time }; }

/**
 * Parents come first in the plan, so a sub-behavior's parent already has its local ID.
 * A parent this import did not create or map leaves the Behavior on its own.
 */
function importedSubBehaviorLink(
  row: BehaviorLogImportBehaviorPlan,
  behaviorIds: ReadonlyMap<string, string>,
  warnings: BehaviorLogImportIssue[],
): { parent_behavior_id: string | null; sub_behavior_sort_order: number; inherit_parent_schedule: boolean } {
  const parentExternalId = row.cadenceParentBehaviorExternalId ?? null;
  const parentId = parentExternalId ? behaviorIds.get(parentExternalId) ?? null : null;
  if (parentExternalId && !parentId) {
    warnings.push({
      severity: "warning",
      code: "sub_behavior_parent_not_imported",
      message: `Behavior ${row.externalId} was imported on its own because its parent Behavior ${parentExternalId} was not imported.`,
    });
  }
  return {
    parent_behavior_id: parentId,
    sub_behavior_sort_order: parentId ? row.cadenceSubBehaviorSortOrder ?? 0 : 0,
    inherit_parent_schedule: parentId ? row.cadenceInheritParentSchedule ?? true : false,
  };
}
