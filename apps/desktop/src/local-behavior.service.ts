import { Temporal } from "@js-temporal/polyfill";
import type { BehaviorDataStore, BehaviorScheduleGraphMutation } from "@cadence/core/behavior-store";
import { normalizeBehaviorDefinition } from "@cadence/core/resolvers/behavior-definition.resolver";
import { normalizeBehaviorConfiguration } from "@cadence/core/resolvers/behavior-configuration.resolver";
import { toBehaviorConfigurationSnapshot, toStoredBehaviorScheduleGraph } from "@cadence/core/services/behavior.service";
import type { BehaviorConfigurationEventPlan } from "@cadence/core/types/behavior-configuration-event";
import type { BehaviorDefinitionEventPlan } from "@cadence/core/types/behavior-definition-event";
import type { BehaviorView } from "@cadence/core/types/behavior";
import { formatReminderOffset } from "@cadence/core/services/behavior-values";
import type { Behavior, BehaviorConfigurationEvent, BehaviorDefinitionEvent } from "../../../lib/types/database";
import { canonicalTime, toLocalBehaviorGraphRecord } from "./local-generation.service";
import { localCommand, localMutation, type LocalBehaviorGraph } from "./local-store";

const CONFLICT = "Behavior schedule graph changed after it was read.";
type RevisionedGraph = LocalBehaviorGraph & { revision: number };

export function withNativeReminderSummary(view: BehaviorView): BehaviorView {
  const summary = view.browserReminderEnabled
    ? `Native notifications, ${formatReminderOffset(view.reminderOffsetMinutes)}` : "Native notifications off";
  return { ...view, reminderSummary: view.emailReminderEnabled ? `${summary}. Email intent preserved; delivery unavailable.` : summary };
}

export function createLocalBehaviorStore(profileId: string, now: Temporal.Instant): BehaviorDataStore {
  const readGraphs = new Map<string, RevisionedGraph>();
  const timestamp = now.toString();
  return {
    async getBehaviorById(behaviorId) {
      const [graphs, categories] = await Promise.all([
        localCommand("readBehaviorGraphs", { profileId }), localCommand("readCategories", { profileId }),
      ]);
      const graph = graphs.find(({ behavior }) => behavior.id === behaviorId);
      if (!graph) { readGraphs.delete(behaviorId); return null; }
      readGraphs.set(behaviorId, graph);
      return toLocalBehaviorGraphRecord(graph, categories);
    },
    async createBehaviorWithAtomicScheduleGraph(input) {
      if (input.behavior.user_id !== profileId) throw new Error("The Behavior belongs to a different profile.");
      const behaviorId = crypto.randomUUID();
      const configurationEvent = configurationRow(input.configurationEventPlan, profileId, behaviorId, timestamp);
      const behavior: Behavior = { ...input.behavior, archive_notes: input.behavior.archive_notes ?? [], id: behaviorId,
        default_duration_minutes: input.behavior.default_duration_minutes ?? null,
        end_date: input.behavior.end_date ?? null, auto_archived_at: input.behavior.auto_archived_at ?? null,
        where_kind: input.behavior.where_kind ?? null, location_text: input.behavior.location_text ?? null,
        current_configuration_event_id: configurationEvent.id,
        scheduled_time: canonicalTime(input.behavior.scheduled_time),
        created_at: input.definitionEventPlan.recordedAt, updated_at: timestamp };
      const graph = projectGraph(behavior, input.schedules, timestamp);
      const result = await localCommand("createBehaviorGraph", {
        ...localMutation(profileId, timestamp), graph, configurationEvent,
        definitionEvent: definitionRow(input.definitionEventPlan, profileId, behaviorId, timestamp),
      });
      return result.behavior;
    },
    async updateBehaviorWithAtomicScheduleGraph(input) {
      const previous = readGraphs.get(input.behaviorId);
      if (!previous) throw new Error("Read the Behavior before changing its graph.");
      const rawDefinition = { title: previous.behavior.title, description: previous.behavior.description };
      const expectedGraph = toStoredBehaviorScheduleGraph(toLocalBehaviorGraphRecord(previous, []));
      if (!sameInstant(previous.behavior.updated_at, input.expectedUpdatedAt)
        || !jsonEqual(rawDefinition, input.expectedDefinition)
        || !jsonEqual(normalizeBehaviorDefinition(rawDefinition), input.expectedNormalizedDefinition)
        || !jsonEqual(expectedGraph, input.expectedScheduleGraph)) throw new Error(CONFLICT);
      const configurationEvent = input.configurationEventPlan
        ? configurationRow(input.configurationEventPlan, profileId, input.behaviorId, timestamp) : null;
      const behavior: Behavior = { ...previous.behavior, ...input.behavior,
        default_duration_minutes: input.behavior.default_duration_minutes === undefined
          ? previous.behavior.default_duration_minutes ?? null : input.behavior.default_duration_minutes,
        end_date: input.behavior.end_date === undefined ? previous.behavior.end_date ?? null : input.behavior.end_date,
        auto_archived_at: input.behavior.auto_archived_at === undefined
          ? previous.behavior.auto_archived_at ?? null : input.behavior.auto_archived_at,
        where_kind: input.behavior.where_kind === undefined ? previous.behavior.where_kind ?? null : input.behavior.where_kind,
        scheduled_time: canonicalTime(input.behavior.scheduled_time),
        current_configuration_event_id: configurationEvent?.id ?? previous.behavior.current_configuration_event_id,
        updated_at: timestamp };
      try {
        const result = await localCommand("updateBehaviorGraph", {
          ...localMutation(profileId, timestamp), expectedRevision: previous.revision,
          expectedNormalizedDefinition: input.expectedNormalizedDefinition,
          graph: projectGraph(behavior, input.schedules, timestamp, previous), configurationEvent,
          definitionEvent: input.definitionEventPlan
            ? definitionRow(input.definitionEventPlan, profileId, input.behaviorId, timestamp) : null,
        });
        readGraphs.set(input.behaviorId, result);
        return result.behavior;
      } catch (error) {
        if (error instanceof Error && error.message === "Behavior changed. Review the latest Behavior and try again.") throw new Error(CONFLICT);
        throw error;
      }
    },
  };
}

function projectGraph(behavior: Behavior, mutations: BehaviorScheduleGraphMutation[], timestamp: string,
  previous?: LocalBehaviorGraph): LocalBehaviorGraph {
  const graph: LocalBehaviorGraph = { behavior, schedules: [], slots: [] };
  for (const mutation of mutations) {
    const scheduleId = mutation.id ?? crypto.randomUUID();
    const oldSchedule = previous?.schedules.find(({ id }) => id === scheduleId);
    // Normalize each entry independently so sorting cannot attach a retained ID to another entry.
    const entries = mutation.slots.map((slot) => ({ slot, normalized: normalizeBehaviorConfiguration(
      toBehaviorConfigurationSnapshot(behavior, [{ ...mutation, slots: [slot] }]),
    ).scheduleGraph[0]! }));
    if (entries.length === 0) throw new Error("Every schedule requires at least one time entry.");
    graph.schedules.push({ id: scheduleId, user_id: behavior.user_id, behavior_id: behavior.id,
      recurrence_rule: entries[0].normalized.recurrenceRule, sort_order: mutation.sort_order,
      created_at: oldSchedule?.created_at ?? timestamp, updated_at: timestamp });
    for (const { slot, normalized } of entries) {
      const slotId = slot.id ?? crypto.randomUUID();
      const oldSlot = previous?.slots.find(({ id }) => id === slotId);
      const entry = normalized.timeEntries[0]!;
      graph.slots.push({ id: slotId, user_id: behavior.user_id, behavior_id: behavior.id, behavior_schedule_id: scheduleId,
        kind: entry.kind, preset: entry.preset, start_time: entry.startTime, end_time: entry.endTime,
        sort_order: entry.sortOrder, created_at: oldSlot?.created_at ?? timestamp, updated_at: timestamp });
    }
  }
  return graph;
}

function definitionRow(plan: BehaviorDefinitionEventPlan, profileId: string, behaviorId: string, timestamp: string): BehaviorDefinitionEvent {
  return { id: crypto.randomUUID(), user_id: profileId, behavior_id: behaviorId,
    previous_title: plan.previousTitle, next_title: plan.nextTitle,
    previous_description: plan.previousDescription, next_description: plan.nextDescription,
    changed_fields: plan.changedFields, recorded_at: plan.recordedAt, source: plan.source, reason: plan.reason,
    created_at: timestamp, updated_at: timestamp };
}

export function configurationRow(plan: BehaviorConfigurationEventPlan, profileId: string, behaviorId: string, timestamp: string): BehaviorConfigurationEvent {
  return { id: crypto.randomUUID(), user_id: profileId, behavior_id: behaviorId,
    event_kind: plan.eventKind, previous_configuration: plan.previousConfiguration,
    next_configuration: plan.nextConfiguration, changed_fields: plan.changedFields,
    recorded_at: plan.recordedAt, effective_at: plan.effectiveAt, effective_local_date: plan.effectiveLocalDate,
    timezone: plan.timezone, source: plan.source, reason_code: plan.reasonCode, created_at: timestamp };
}

function sameInstant(left: string, right: string) {
  try { return Temporal.Instant.compare(left, right) === 0; } catch { return false; }
}

function jsonEqual(left: unknown, right: unknown) {
  const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable)
    : value !== null && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => [key, stable(nested)])) : value;
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}
