import type { Tables, TablesInsert, TablesUpdate } from "@/lib/db/database.types";

export type Profile = Tables<"profiles">;
export type Category = Tables<"categories">;
type BehaviorPersistenceField =
  | "default_duration_minutes"
  | "end_date"
  | "auto_archived_at"
  | "location_text"
  | "where_kind";
export type Behavior = Omit<Tables<"behaviors">, BehaviorPersistenceField> &
  Partial<Pick<Tables<"behaviors">, BehaviorPersistenceField>>;
export type BehaviorDefinitionEvent = Tables<"behavior_definition_events">;
export type BehaviorConfigurationEvent =
  Tables<"behavior_configuration_events">;
export type BehaviorSchedule = Tables<"behavior_schedules">;
export type BehaviorScheduleSlot = Tables<"behavior_schedule_slots">;
export type Occurrence = Tables<"occurrences">;
export type OccurrenceSyncState = Tables<"occurrence_sync_state">;
export type OccurrenceTimeSession = Tables<"occurrence_time_sessions">;
export type OccurrenceStatusEvent = Tables<"occurrence_status_events">;
export type BehaviorLogImportRun = Tables<"behaviorlog_import_runs">;
export type BehaviorLogImportRecordMapping =
  Tables<"behaviorlog_import_record_mappings">;
export type ImportedIntervention = Tables<"imported_interventions">;
export type ImportedNote = Tables<"imported_notes">;
export type ReminderDelivery = Tables<"reminder_deliveries">;
export type PushSubscription = Tables<"push_subscriptions">;
export type LaunchRateLimit = Tables<"launch_rate_limits">;
export type TravelSettingsRow = Tables<"travel_settings">;

export type NewCategory = TablesInsert<"categories">;
export type NewBehavior = TablesInsert<"behaviors">;
export type NewBehaviorDefinitionEvent =
  TablesInsert<"behavior_definition_events">;
export type NewBehaviorSchedule = TablesInsert<"behavior_schedules">;
export type NewBehaviorScheduleSlot = TablesInsert<"behavior_schedule_slots">;
export type NewOccurrence = TablesInsert<"occurrences">;
export type NewOccurrenceSyncState = TablesInsert<"occurrence_sync_state">;
export type NewOccurrenceTimeSession =
  TablesInsert<"occurrence_time_sessions">;
export type NewOccurrenceStatusEvent = TablesInsert<"occurrence_status_events">;
export type NewBehaviorLogImportRun =
  TablesInsert<"behaviorlog_import_runs">;
export type NewBehaviorLogImportRecordMapping =
  TablesInsert<"behaviorlog_import_record_mappings">;
export type NewImportedIntervention = TablesInsert<"imported_interventions">;
export type NewImportedNote = TablesInsert<"imported_notes">;
export type NewReminderDelivery = TablesInsert<"reminder_deliveries">;
export type NewPushSubscription = TablesInsert<"push_subscriptions">;

export type CategoryUpdate = TablesUpdate<"categories">;
export type BehaviorUpdate = TablesUpdate<"behaviors">;
export type BehaviorDefinitionEventUpdate =
  TablesUpdate<"behavior_definition_events">;
export type BehaviorScheduleUpdate = TablesUpdate<"behavior_schedules">;
export type BehaviorScheduleSlotUpdate = TablesUpdate<"behavior_schedule_slots">;
export type OccurrenceUpdate = TablesUpdate<"occurrences">;
export type OccurrenceSyncStateUpdate = TablesUpdate<"occurrence_sync_state">;
export type OccurrenceTimeSessionUpdate =
  TablesUpdate<"occurrence_time_sessions">;
export type OccurrenceStatusEventUpdate = TablesUpdate<"occurrence_status_events">;
export type BehaviorLogImportRunUpdate =
  TablesUpdate<"behaviorlog_import_runs">;
export type BehaviorLogImportRecordMappingUpdate =
  TablesUpdate<"behaviorlog_import_record_mappings">;
export type ImportedInterventionUpdate = TablesUpdate<"imported_interventions">;
export type ImportedNoteUpdate = TablesUpdate<"imported_notes">;
export type ReminderDeliveryUpdate = TablesUpdate<"reminder_deliveries">;
export type PushSubscriptionUpdate = TablesUpdate<"push_subscriptions">;

export type { OccurrenceStatus, ReminderChannel, ReminderDeliveryStatus, DefaultCategoryName } from "@cadence/core/types/database";
export { DEFAULT_CATEGORY_NAMES } from "@cadence/core/types/database";
