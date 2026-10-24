import type { BehaviorWhereKind } from "./types/behavior";
import type { BehaviorConfigurationEventPlan } from "./types/behavior-configuration-event";
import type { BehaviorDefinition, BehaviorDefinitionEventPlan } from "./types/behavior-definition-event";
import type { Json } from "./types/json";
import type { RecurrenceRule } from "./types/recurrence";
import type { BehaviorScheduleInput } from "./types/schedule";

export type BehaviorInput = {
  defaultDurationMinutes?: number | null;
  endDate?: string | null;
  title: string;
  description: string | null;
  /** Omitted by callers that predate Where; the service derives it from `locationText`. */
  whereKind?: BehaviorWhereKind | null;
  locationText?: string | null;
  categoryId: string | null;
  recurrenceRule: RecurrenceRule;
  scheduledTime: string;
  schedules: BehaviorScheduleInput[];
  browserReminderEnabled: boolean;
  emailReminderEnabled: boolean;
  reminderOffsetMinutes: number;
  active: boolean;
};

export type BehaviorFields = {
  default_duration_minutes?: number | null;
  end_date?: string | null;
  auto_archived_at?: string | null;
  category_id: string | null;
  title: string;
  description: string | null;
  where_kind?: string | null;
  location_text?: string | null;
  recurrence_rule: Json;
  scheduled_time: string;
  timezone: string;
  browser_reminder_enabled: boolean;
  email_reminder_enabled: boolean;
  reminder_offset_minutes: number;
  active: boolean;
  archived_at: string | null;
  archive_notes?: Json;
};

export type BehaviorRecord = BehaviorFields & {
  id: string;
  user_id: string;
  current_configuration_event_id: string | null;
  created_at: string;
  updated_at: string;
};

export type BehaviorScheduleSlotRecord = {
  id: string;
  user_id: string;
  behavior_id: string;
  behavior_schedule_id: string | null;
  kind: string;
  preset: string | null;
  start_time: string;
  end_time: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type BehaviorScheduleRecord = {
  id: string;
  user_id: string;
  behavior_id: string;
  recurrence_rule: Json;
  sort_order: number;
  created_at: string;
  updated_at: string;
  schedule_slots: BehaviorScheduleSlotRecord[];
};

export type BehaviorGraphRecord = BehaviorRecord & {
  category: { id: string; name: string } | null;
  schedules?: BehaviorScheduleRecord[];
  schedule_slots: BehaviorScheduleSlotRecord[];
};

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

export type BehaviorCreateCommit = {
  behavior: BehaviorFields & { user_id: string };
  definitionEventPlan: BehaviorDefinitionEventPlan;
  configurationEventPlan: BehaviorConfigurationEventPlan;
  schedules: BehaviorScheduleGraphMutation[];
};

export type BehaviorUpdateCommit = {
  behaviorId: string;
  behavior: BehaviorFields;
  expectedDefinition: BehaviorDefinition;
  expectedNormalizedDefinition: BehaviorDefinition;
  expectedScheduleGraph: BehaviorScheduleGraphMutation[];
  expectedUpdatedAt: string;
  definitionEventPlan: BehaviorDefinitionEventPlan | null;
  configurationEventPlan: BehaviorConfigurationEventPlan | null;
  schedules: BehaviorScheduleGraphMutation[];
};

// Each adapter is scoped to one authorized owner. Graph, history, configuration
// pointer and stale marker commit together after checking every predecessor.
export type BehaviorDataStore = {
  getBehaviorById(behaviorId: string): Promise<BehaviorGraphRecord | null>;
  createBehaviorWithAtomicScheduleGraph(input: BehaviorCreateCommit): Promise<BehaviorRecord>;
  updateBehaviorWithAtomicScheduleGraph(input: BehaviorUpdateCommit): Promise<BehaviorRecord | null>;
};
