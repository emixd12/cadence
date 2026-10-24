import type { Json } from "./json";

export type PortabilityProfileRow = {
  created_at: string;
  display_name: string | null;
  email: string;
  id: string;
  timezone: string;
  updated_at: string;
};

export type PortabilityCategoryRow = {
  description?: string | null;
  created_at: string;
  id: string;
  name: string;
  sort_order: number;
  updated_at: string;
  user_id: string;
};

export type PortabilityDefinitionEventRow = {
  behavior_id: string;
  changed_fields: string[];
  created_at: string;
  id: string;
  next_description: string | null;
  next_title: string;
  previous_description: string | null;
  previous_title: string | null;
  reason: string | null;
  recorded_at: string;
  source: string;
  updated_at: string;
  user_id: string;
};

export type PortabilityConfigurationEventRow = {
  behavior_id: string;
  changed_fields: string[];
  created_at: string;
  effective_at: string;
  effective_local_date: string;
  event_kind: string;
  id: string;
  next_configuration: Json;
  previous_configuration: Json | null;
  reason_code: string;
  recorded_at: string;
  source: string;
  timezone: string;
  user_id: string;
};

export type PortabilityImportRunRow = {
  accepted_preview_fingerprint: string | null;
  accepted_preview_run_id: string | null;
  bundle_fingerprint: string | null;
  bundle_format: string;
  completed_at: string | null;
  created_at: string;
  dry_run_summary: Json;
  failure_message: string | null;
  id: string;
  import_mode: string;
  manifest_sha256: string | null;
  privacy_redaction_level: string | null;
  producer_name: string | null;
  producer_version: string | null;
  schema_version: string | null;
  started_at: string;
  status: string;
  subject_id_strategy: string | null;
  updated_at: string;
  user_id: string;
};

export type PortabilityMappingRow = {
  created_at: string;
  external_id: string;
  id: string;
  import_run_id: string;
  local_id: string;
  record_type: string;
  user_id: string;
};

export type PortabilityNoteRow = {
  body_markdown: string;
  created_at: string;
  external_id: string;
  id: string;
  import_run_id: string;
  imported_created_at: string;
  imported_updated_at: string | null;
  metadata: Json;
  note_role: string;
  sensitivity: string | null;
  source_capture_method: string;
  source_confidence: string;
  source_original_id: string | null;
  target_external_id: string;
  target_local_id: string | null;
  target_type: string;
  updated_at: string;
  user_id: string;
};

export type PortabilityInterventionRow = {
  behavior_external_id: string;
  behavior_id: string | null;
  channel: string;
  created_at: string;
  delivery_status: string;
  external_id: string;
  failure_reason: string | null;
  id: string;
  import_run_id: string;
  intervention_type: string | null;
  metadata: Json;
  occurrence_external_id: string;
  occurrence_id: string | null;
  redacted_sensitivity_indicators: Json;
  scheduled_send_at: string;
  sent_at: string | null;
  source_capture_method: string;
  source_confidence: string;
  source_original_id: string | null;
  updated_at: string;
  user_id: string;
};

export type PortabilityTimeSessionRow = {
  behavior_id: string;
  created_at: string;
  id: string;
  occurrence_id: string;
  started_at: string;
  stopped_at: string | null;
  updated_at: string;
  user_id: string;
};

export type PortabilityGraph = {
  behavior: import("../behavior-store").BehaviorRecord;
  schedules: Omit<import("../behavior-store").BehaviorScheduleRecord, "schedule_slots">[];
  slots: import("../behavior-store").BehaviorScheduleSlotRecord[];
};
export type PortabilitySnapshot = {
  revision: number;
  profile: PortabilityProfileRow;
  categories: PortabilityCategoryRow[];
  graphs: (PortabilityGraph & { revision: number })[];
  definitionEvents: PortabilityDefinitionEventRow[];
  configurationEvents: PortabilityConfigurationEventRow[];
  occurrences: import("../data-store").OccurrenceRecord[];
  statusEvents: import("../data-store").OccurrenceStatusEventRecord[];
  timeSessions: PortabilityTimeSessionRow[];
  importRuns: PortabilityImportRunRow[];
  mappings: PortabilityMappingRow[];
  importedNotes: PortabilityNoteRow[];
  importedInterventions: PortabilityInterventionRow[];
  reminderDeliveries?: import("./json").Json[];
  travelSettings?: import("./travel").TravelSettings;
  /** Ticket 216 rows, with the local owner column. Older snapshots omit them. */
  placeLabelSettings?: (import("./place-labels").PlaceLabelSettingsRecord & { id: string; user_id: string })[];
  placeMarkers?: (import("./place-labels").PlaceMarkerRecord & { user_id: string })[];
  completionPlaceLabels?: (import("./place-labels").CompletionPlaceLabelRecord & { user_id: string })[];
  whereSuggestionDismissals?: (import("./place-labels").WhereSuggestionDismissalRecord & { user_id: string })[];
};
export type PortabilityRowWrite<T> = { expected: T | null; next: T };
export type LocalImportWritePlan = {
  mode: "create_missing_only" | "merge_by_user_approved_plan" | "restore_apply";
  applyRun: PortabilityImportRunRow;
  categoryCreates: PortabilityCategoryRow[];
  graphWrites: { expectedRevision: number | null; graph: PortabilityGraph; configurationEvents: PortabilityConfigurationEventRow[] }[];
  definitionEvents: PortabilityDefinitionEventRow[];
  statusEvents: import("../data-store").OccurrenceStatusEventRecord[];
  occurrenceWrites: PortabilityRowWrite<import("../data-store").OccurrenceRecord>[];
  occurrenceDeletes: import("../data-store").OccurrenceRecord[];
  timeSessionWrites: PortabilityRowWrite<PortabilityTimeSessionRow>[];
  importedNoteWrites: PortabilityRowWrite<PortabilityNoteRow>[];
  importedNoteDeletes: PortabilityNoteRow[];
  importedInterventionWrites: PortabilityRowWrite<PortabilityInterventionRow>[];
  importedInterventionDeletes: PortabilityInterventionRow[];
  mappings: PortabilityMappingRow[];
  result: Json;
};
