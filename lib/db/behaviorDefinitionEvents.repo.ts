import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import type { Json } from "@/lib/db/database.types";
import {
  POSTGREST_PAGE_SIZE,
  USER_SCOPED_READ_ABSOLUTE_CEILING,
} from "@/lib/db/paginated-read";
import { measurePerformanceSpan } from "@/lib/services/performance-timing";
import type {
  BehaviorDefinition,
  BehaviorDefinitionEventPlan,
} from "@/lib/types/behavior-definition-event";
import { toBehaviorConfigurationEventPlanPayload } from "@/lib/db/behaviorConfigurationEvents.repo";
import type { BehaviorConfigurationEventPlan } from "@/lib/types/behavior-configuration-event";
import type {
  Behavior,
  BehaviorUpdate,
  BehaviorDefinitionEvent,
  NewBehavior,
  NewBehaviorDefinitionEvent,
} from "@/lib/types/database";

export type BehaviorScheduleGraphMutation = {
  id?: string | null;
  recurrence_rule: Json;
  sort_order: number;
  slots: Array<{
    id?: string | null;
    kind: string;
    preset: string | null;
    start_time: string;
    end_time: string | null;
    sort_order: number;
  }>;
};

const DEFINITION_HISTORY_HIGH_WATER_ERROR =
  "Behavior definition history pagination ended before the captured high-water event.";

export async function createBehaviorWithAtomicScheduleGraph(
  supabase: AppSupabaseClient,
  input: {
    behavior: NewBehavior;
    definitionEventPlan: BehaviorDefinitionEventPlan;
    configurationEventPlan: BehaviorConfigurationEventPlan;
    schedules: BehaviorScheduleGraphMutation[];
  },
): Promise<Behavior> {
  const { data, error } = await supabase.rpc(
    "create_behavior_with_schedule_graph",
    {
      behavior_payload: toBehaviorPayload(input.behavior),
      definition_event_plan: toDefinitionEventPlanPayload(
        input.definitionEventPlan,
      ),
      configuration_event_plan: toBehaviorConfigurationEventPlanPayload(
        input.configurationEventPlan,
      ),
      schedule_graph: toScheduleGraphPayload(input.schedules),
    },
  );

  if (error) {
    throw error;
  }

  if (!data) {
    throw new Error("Behavior was not created.");
  }

  return data as unknown as Behavior;
}

export async function updateBehaviorWithAtomicScheduleGraph(
  supabase: AppSupabaseClient,
  input: {
    behaviorId: string;
    behavior: BehaviorUpdate;
    expectedDefinition: BehaviorDefinition;
    expectedNormalizedDefinition: BehaviorDefinition;
    expectedScheduleGraph: BehaviorScheduleGraphMutation[];
    expectedUpdatedAt: string;
    definitionEventPlan: BehaviorDefinitionEventPlan | null;
    configurationEventPlan: BehaviorConfigurationEventPlan | null;
    schedules: BehaviorScheduleGraphMutation[];
  },
): Promise<Behavior | null> {
  const { data, error } = await supabase.rpc(
    "update_behavior_with_schedule_graph",
    {
      target_behavior_id: input.behaviorId,
      behavior_payload: toBehaviorPayload(input.behavior),
      expected_definition: {
        stored_title: input.expectedDefinition.title,
        stored_description: input.expectedDefinition.description,
        normalized_title: input.expectedNormalizedDefinition.title,
        normalized_description: input.expectedNormalizedDefinition.description,
      },
      expected_schedule_graph: toScheduleGraphPayload(
        input.expectedScheduleGraph,
      ),
      expected_updated_at: input.expectedUpdatedAt,
      definition_event_plan: input.definitionEventPlan
        ? toDefinitionEventPlanPayload(input.definitionEventPlan)
        : null,
      configuration_event_plan: input.configurationEventPlan
        ? toBehaviorConfigurationEventPlanPayload(input.configurationEventPlan)
        : null,
      schedule_graph: toScheduleGraphPayload(input.schedules),
    },
  );

  if (error) {
    throw error;
  }

  return data ? (data as unknown as Behavior) : null;
}

export async function createBehaviorWithDefinitionEvent(
  supabase: AppSupabaseClient,
  input: {
    behavior: NewBehavior;
    definitionEventPlan: BehaviorDefinitionEventPlan;
  },
): Promise<Behavior> {
  const { data, error } = await supabase.rpc(
    "create_behavior_with_definition_event",
    {
      behavior_payload: toBehaviorPayload(input.behavior),
      definition_event_plan: toDefinitionEventPlanPayload(
        input.definitionEventPlan,
      ),
    },
  );

  if (error) {
    throw error;
  }

  if (!data) {
    throw new Error("Behavior was not created.");
  }

  return data as unknown as Behavior;
}

export async function updateBehaviorWithDefinitionEvent(
  supabase: AppSupabaseClient,
  input: {
    behaviorId: string;
    behavior: BehaviorUpdate;
    expectedDefinition: BehaviorDefinition;
    expectedNormalizedDefinition: BehaviorDefinition;
    definitionEventPlan: BehaviorDefinitionEventPlan | null;
  },
): Promise<Behavior | null> {
  const { data, error } = await supabase.rpc(
    "update_behavior_with_definition_event",
    {
      target_behavior_id: input.behaviorId,
      behavior_payload: toBehaviorPayload(input.behavior),
      expected_definition: {
        stored_title: input.expectedDefinition.title,
        stored_description: input.expectedDefinition.description,
        normalized_title: input.expectedNormalizedDefinition.title,
        normalized_description: input.expectedNormalizedDefinition.description,
      },
      definition_event_plan: input.definitionEventPlan
        ? toDefinitionEventPlanPayload(input.definitionEventPlan)
        : null,
    },
  );

  if (error) {
    throw error;
  }

  return data ? (data as unknown as Behavior) : null;
}

export async function createBehaviorDefinitionEvent(
  supabase: AppSupabaseClient,
  event: NewBehaviorDefinitionEvent,
): Promise<BehaviorDefinitionEvent> {
  const { data, error } = await supabase
    .from("behavior_definition_events")
    .insert(event)
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function listBehaviorDefinitionEvents(
  supabase: AppSupabaseClient,
  userId: string,
): Promise<BehaviorDefinitionEvent[]> {
  return measurePerformanceSpan(
    {
      span: "db.list_behavior_definition_events",
      counts: (events) => ({
        behavior_definition_events: events.length,
      }),
    },
    async () => {
      const { data: highWaterRows, error: highWaterError } = await supabase
        .from("behavior_definition_events")
        .select("id, recorded_at")
        .eq("user_id", userId)
        .order("recorded_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(1);

      if (highWaterError) {
        throw highWaterError;
      }

      const highWater = highWaterRows?.[0];

      if (!highWater) {
        return [];
      }

      const events: BehaviorDefinitionEvent[] = [];
      const eventIds = new Set<string>();
      let cursor: Pick<BehaviorDefinitionEvent, "id" | "recorded_at"> | null =
        null;

      for (;;) {
        let query = supabase
          .from("behavior_definition_events")
          .select("*")
          .eq("user_id", userId)
          .lte("recorded_at", highWater.recorded_at)
          .order("recorded_at", { ascending: true })
          .order("id", { ascending: true })
          .limit(POSTGREST_PAGE_SIZE);

        if (cursor) {
          query = query.or(
            `recorded_at.gt.${cursor.recorded_at},and(recorded_at.eq.${cursor.recorded_at},id.gt.${cursor.id})`,
          );
        }

        const { data, error } = await query;

        if (error) {
          throw error;
        }

        const page = (data ?? []).filter(
          (event) =>
            event.recorded_at !== highWater.recorded_at ||
            event.id.localeCompare(highWater.id) <= 0,
        );

        let previous = cursor;

        for (const event of page) {
          if (
            eventIds.has(event.id) ||
            (previous !== null && compareHistoryRows(event, previous) <= 0)
          ) {
            throw new Error(
              "Behavior definition history pagination did not advance.",
            );
          }

          eventIds.add(event.id);
          previous = event;
        }

        if (
          events.length + page.length >
          USER_SCOPED_READ_ABSOLUTE_CEILING
        ) {
          throw new Error(
            "Behavior definition history exceeds Cadence's 100,000-event export ceiling.",
          );
        }

        events.push(...page);

        const last = page.at(-1);

        if (!last) {
          throw new Error(DEFINITION_HISTORY_HIGH_WATER_ERROR);
        }

        if (
          last.recorded_at === highWater.recorded_at &&
          last.id === highWater.id
        ) {
          return events;
        }

        if (events.length === USER_SCOPED_READ_ABSOLUTE_CEILING) {
          throw new Error(
            "Behavior definition history exceeds Cadence's 100,000-event export ceiling.",
          );
        }

        cursor = last;
      }
    },
  );
}

function compareHistoryRows(
  left: Pick<BehaviorDefinitionEvent, "id" | "recorded_at">,
  right: Pick<BehaviorDefinitionEvent, "id" | "recorded_at">,
): number {
  if (left.recorded_at < right.recorded_at) {
    return -1;
  }

  if (left.recorded_at > right.recorded_at) {
    return 1;
  }

  return left.id.localeCompare(right.id);
}

function toBehaviorPayload(
  behavior: NewBehavior | BehaviorUpdate,
): Json {
  return {
    category_id: behavior.category_id ?? null,
    title: behavior.title,
    description: behavior.description ?? null,
    location_text: behavior.location_text ?? null,
    where_kind: behavior.where_kind ?? null,
    recurrence_rule: behavior.recurrence_rule,
    scheduled_time: behavior.scheduled_time,
    timezone: "timezone" in behavior ? behavior.timezone : undefined,
    browser_reminder_enabled: behavior.browser_reminder_enabled,
    email_reminder_enabled: behavior.email_reminder_enabled,
    reminder_offset_minutes: behavior.reminder_offset_minutes,
    active: behavior.active,
    archived_at: behavior.archived_at ?? null,
    archive_notes: behavior.archive_notes,
    ...("default_duration_minutes" in behavior
      ? { default_duration_minutes: behavior.default_duration_minutes ?? null }
      : {}),
    ...("end_date" in behavior ? { end_date: behavior.end_date ?? null } : {}),
    ...("auto_archived_at" in behavior
      ? { auto_archived_at: behavior.auto_archived_at ?? null }
      : {}),
    created_at: "created_at" in behavior ? behavior.created_at ?? null : null,
  };
}

function toDefinitionEventPlanPayload(
  plan: BehaviorDefinitionEventPlan,
): Json {
  return {
    previous_title: plan.previousTitle,
    next_title: plan.nextTitle,
    previous_description: plan.previousDescription,
    next_description: plan.nextDescription,
    changed_fields: plan.changedFields,
    recorded_at: plan.recordedAt,
    source: plan.source,
    reason: plan.reason,
  };
}

function toScheduleGraphPayload(
  schedules: BehaviorScheduleGraphMutation[],
): Json {
  return schedules.map((schedule) => ({
    id: schedule.id ?? null,
    recurrence_rule: schedule.recurrence_rule,
    sort_order: schedule.sort_order,
    time_entries: schedule.slots.map((slot) => ({
      id: slot.id ?? null,
      kind: slot.kind,
      preset: slot.preset,
      start_time: slot.start_time,
      end_time: slot.end_time,
      sort_order: slot.sort_order,
    })),
  }));
}
