// Current web Row fields, translated for the local SQLite boundary (Ticket 110).
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub trait StoredRow: Serialize + serde::de::DeserializeOwned {
    const TABLE: &'static str;
    const JSON_COLUMNS: &'static [&'static str];
    const BOOL_COLUMNS: &'static [&'static str];
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Profile {
    pub created_at: String,
    pub display_name: Option<String>,
    pub email: String,
    pub id: String,
    pub timezone: String,
    pub updated_at: String,
}
impl StoredRow for Profile {
    const TABLE: &'static str = "profiles";
    const JSON_COLUMNS: &'static [&'static str] = &[];
    const BOOL_COLUMNS: &'static [&'static str] = &[];
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Category {
    #[serde(default)]
    pub description: Option<String>,
    pub created_at: String,
    pub id: String,
    pub name: String,
    pub sort_order: i64,
    pub updated_at: String,
    pub user_id: String,
}
impl StoredRow for Category {
    const TABLE: &'static str = "categories";
    const JSON_COLUMNS: &'static [&'static str] = &[];
    const BOOL_COLUMNS: &'static [&'static str] = &[];
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct BehaviorArchiveNote {
    pub archived_at: String,
    pub id: String,
    pub note: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Behavior {
    pub active: bool,
    #[serde(default)]
    pub archive_notes: Vec<BehaviorArchiveNote>,
    pub archived_at: Option<String>,
    pub auto_archived_at: Option<String>,
    pub browser_reminder_enabled: bool,
    pub category_id: Option<String>,
    pub created_at: String,
    pub current_configuration_event_id: Option<String>,
    pub default_duration_minutes: Option<i64>,
    pub description: Option<String>,
    pub email_reminder_enabled: bool,
    pub end_date: Option<String>,
    pub id: String,
    #[serde(default)]
    pub location_text: Option<String>,
    pub recurrence_rule: Value,
    pub reminder_offset_minutes: i64,
    pub scheduled_time: String,
    pub timezone: String,
    pub title: String,
    pub updated_at: String,
    pub user_id: String,
    #[serde(default)]
    pub where_kind: Option<String>,
}
impl StoredRow for Behavior {
    const TABLE: &'static str = "behaviors";
    const JSON_COLUMNS: &'static [&'static str] = &["archive_notes", "recurrence_rule"];
    const BOOL_COLUMNS: &'static [&'static str] = &[
        "active",
        "browser_reminder_enabled",
        "email_reminder_enabled",
    ];
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct TravelSettings {
    pub arrival_buffer_minutes: Option<i64>,
    pub base_location_text: Option<String>,
    pub created_at: String,
    pub enabled: bool,
    pub habits_updated_at: Option<String>,
    pub leave_feedback: Value,
    pub mode: Option<String>,
    pub navigation_preference: Option<String>,
    pub onboarding_completed_at: Option<String>,
    pub place_modes: Value,
    pub preparation_minutes: Option<i64>,
    pub routing_consent_at: Option<String>,
    pub updated_at: String,
    pub user_id: String,
}
impl StoredRow for TravelSettings {
    const TABLE: &'static str = "travel_settings";
    const JSON_COLUMNS: &'static [&'static str] = &["leave_feedback", "place_modes"];
    const BOOL_COLUMNS: &'static [&'static str] = &["enabled"];
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct BehaviorSchedule {
    pub behavior_id: String,
    pub created_at: String,
    pub id: String,
    pub recurrence_rule: Value,
    pub sort_order: i64,
    pub updated_at: String,
    pub user_id: String,
}
impl StoredRow for BehaviorSchedule {
    const TABLE: &'static str = "behavior_schedules";
    const JSON_COLUMNS: &'static [&'static str] = &["recurrence_rule"];
    const BOOL_COLUMNS: &'static [&'static str] = &[];
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct BehaviorScheduleSlot {
    pub behavior_id: String,
    pub behavior_schedule_id: Option<String>,
    pub created_at: String,
    pub end_time: Option<String>,
    pub id: String,
    pub kind: String,
    pub preset: Option<String>,
    pub sort_order: i64,
    pub start_time: String,
    pub updated_at: String,
    pub user_id: String,
}
impl StoredRow for BehaviorScheduleSlot {
    const TABLE: &'static str = "behavior_schedule_slots";
    const JSON_COLUMNS: &'static [&'static str] = &[];
    const BOOL_COLUMNS: &'static [&'static str] = &[];
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct BehaviorDefinitionEvent {
    pub behavior_id: String,
    pub changed_fields: Vec<String>,
    pub created_at: String,
    pub id: String,
    pub next_description: Option<String>,
    pub next_title: String,
    pub previous_description: Option<String>,
    pub previous_title: Option<String>,
    pub reason: Option<String>,
    pub recorded_at: String,
    pub source: String,
    pub updated_at: String,
    pub user_id: String,
}
impl StoredRow for BehaviorDefinitionEvent {
    const TABLE: &'static str = "behavior_definition_events";
    const JSON_COLUMNS: &'static [&'static str] = &["changed_fields"];
    const BOOL_COLUMNS: &'static [&'static str] = &[];
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct BehaviorConfigurationEvent {
    pub behavior_id: String,
    pub changed_fields: Vec<String>,
    pub created_at: String,
    pub effective_at: String,
    pub effective_local_date: String,
    pub event_kind: String,
    pub id: String,
    pub next_configuration: Value,
    pub previous_configuration: Option<Value>,
    pub reason_code: String,
    pub recorded_at: String,
    pub source: String,
    pub timezone: String,
    pub user_id: String,
}
impl StoredRow for BehaviorConfigurationEvent {
    const TABLE: &'static str = "behavior_configuration_events";
    const JSON_COLUMNS: &'static [&'static str] = &[
        "changed_fields",
        "next_configuration",
        "previous_configuration",
    ];
    const BOOL_COLUMNS: &'static [&'static str] = &[];
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Occurrence {
    pub behavior_configuration_event_id: Option<String>,
    pub behavior_id: String,
    pub behavior_schedule_slot_id: Option<String>,
    pub completed_at: Option<String>,
    pub created_at: String,
    pub id: String,
    pub local_date: String,
    pub note: Option<String>,
    pub schedule_end_time: Option<String>,
    pub schedule_kind: String,
    pub schedule_preset: Option<String>,
    pub schedule_range_identity: Option<i64>,
    pub schedule_start_time: String,
    pub scheduled_for: String,
    pub status: String,
    pub status_marked_at: Option<String>,
    pub updated_at: String,
    pub user_id: String,
}
impl StoredRow for Occurrence {
    const TABLE: &'static str = "occurrences";
    const JSON_COLUMNS: &'static [&'static str] = &[];
    const BOOL_COLUMNS: &'static [&'static str] = &[];
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct NoteShortcutEvidence {
    pub occurrence_id: String,
    pub note_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct NoteShortcut {
    pub key: String,
    pub text: Option<String>,
    pub status: String,
    pub source: String,
    pub evidence: Vec<NoteShortcutEvidence>,
    pub created_at: String,
    pub expires_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct NoteShortcutState {
    pub id: String,
    pub user_id: String,
    pub behavior_id: Option<String>,
    pub enabled: bool,
    pub entries: Vec<NoteShortcut>,
    pub excluded_occurrence_ids: Vec<String>,
    pub revision: i64,
    pub updated_at: String,
}
impl StoredRow for NoteShortcutState {
    const TABLE: &'static str = "note_shortcut_states";
    const JSON_COLUMNS: &'static [&'static str] = &["entries", "excluded_occurrence_ids"];
    const BOOL_COLUMNS: &'static [&'static str] = &["enabled"];
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct OccurrenceStatusEvent {
    pub behavior_id: String,
    pub created_at: String,
    pub effective_at: Option<String>,
    pub id: String,
    pub local_date: String,
    pub occurrence_id: String,
    pub previous_status: Option<String>,
    pub reason_code: Option<String>,
    pub recorded_at: String,
    pub revises_event_id: Option<String>,
    pub source_capture_method: String,
    pub source_confidence: String,
    pub status: String,
    pub status_semantics: String,
    pub timezone: String,
    pub updated_at: String,
    pub user_id: String,
}
impl StoredRow for OccurrenceStatusEvent {
    const TABLE: &'static str = "occurrence_status_events";
    const JSON_COLUMNS: &'static [&'static str] = &[];
    const BOOL_COLUMNS: &'static [&'static str] = &[];
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct OccurrenceTimeSession {
    pub behavior_id: String,
    pub created_at: String,
    pub id: String,
    pub occurrence_id: String,
    pub started_at: String,
    pub stopped_at: Option<String>,
    pub updated_at: String,
    pub user_id: String,
}
impl StoredRow for OccurrenceTimeSession {
    const TABLE: &'static str = "occurrence_time_sessions";
    const JSON_COLUMNS: &'static [&'static str] = &[];
    const BOOL_COLUMNS: &'static [&'static str] = &[];
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct OccurrenceSyncState {
    pub created_at: String,
    pub last_successful_sync_at: Option<String>,
    pub last_sync_behavior_count: i64,
    pub last_sync_created_count: i64,
    pub last_sync_deleted_count: i64,
    pub last_sync_updated_count: i64,
    pub last_synced_local_date: Option<String>,
    pub stale: bool,
    pub stale_reason: Option<String>,
    pub state_version: i64,
    pub synced_through_local_date: Option<String>,
    pub timezone: String,
    pub updated_at: String,
    pub user_id: String,
}
impl StoredRow for OccurrenceSyncState {
    const TABLE: &'static str = "occurrence_sync_state";
    const JSON_COLUMNS: &'static [&'static str] = &[];
    const BOOL_COLUMNS: &'static [&'static str] = &["stale"];
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ReminderDelivery {
    pub channel: String,
    pub created_at: String,
    pub error: Option<String>,
    pub id: String,
    pub import_run_id: Option<String>,
    pub imported_intervention_id: Option<String>,
    pub occurrence_id: String,
    pub processing_started_at: Option<String>,
    pub scheduled_send_at: String,
    pub sent_at: Option<String>,
    pub status: String,
    pub updated_at: String,
    pub user_id: String,
}
impl StoredRow for ReminderDelivery {
    const TABLE: &'static str = "reminder_deliveries";
    const JSON_COLUMNS: &'static [&'static str] = &[];
    const BOOL_COLUMNS: &'static [&'static str] = &[];
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct NativeReminderState {
    pub user_id: String,
    pub id: String,
    pub occurrence_id: String,
    pub request_id: String,
    pub fire_at: String,
    pub title: String,
    pub body: String,
    pub status: String,
    pub error: Option<String>,
    pub verified_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}
impl StoredRow for NativeReminderState {
    const TABLE: &'static str = "native_reminder_state";
    const JSON_COLUMNS: &'static [&'static str] = &[];
    const BOOL_COLUMNS: &'static [&'static str] = &[];
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct NativeReminderCoverage {
    pub user_id: String,
    pub status: String,
    pub target_through: String,
    pub scheduled_through: String,
    pub first_unscheduled_at: Option<String>,
    pub expected_count: i64,
    pub scheduled_count: i64,
    pub missing_ids: Vec<String>,
    pub reason: Option<String>,
    pub verified_at: Option<String>,
    pub updated_at: String,
    pub dataset_revision: i64,
}
impl StoredRow for NativeReminderCoverage {
    const TABLE: &'static str = "native_reminder_coverage";
    const JSON_COLUMNS: &'static [&'static str] = &["missing_ids"];
    const BOOL_COLUMNS: &'static [&'static str] = &[];
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct BehaviorLogImportRun {
    pub accepted_preview_fingerprint: Option<String>,
    pub accepted_preview_run_id: Option<String>,
    pub bundle_fingerprint: Option<String>,
    pub bundle_format: String,
    pub completed_at: Option<String>,
    pub created_at: String,
    pub dry_run_summary: Value,
    pub failure_message: Option<String>,
    pub id: String,
    pub import_mode: String,
    pub manifest_sha256: Option<String>,
    pub privacy_redaction_level: Option<String>,
    pub producer_name: Option<String>,
    pub producer_version: Option<String>,
    pub schema_version: Option<String>,
    pub started_at: String,
    pub status: String,
    pub subject_id_strategy: Option<String>,
    pub updated_at: String,
    pub user_id: String,
}
impl StoredRow for BehaviorLogImportRun {
    const TABLE: &'static str = "behaviorlog_import_runs";
    const JSON_COLUMNS: &'static [&'static str] = &["dry_run_summary"];
    const BOOL_COLUMNS: &'static [&'static str] = &[];
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct BehaviorLogImportRecordMapping {
    pub created_at: String,
    pub external_id: String,
    pub id: String,
    pub import_run_id: String,
    pub local_id: String,
    pub record_type: String,
    pub user_id: String,
}
impl StoredRow for BehaviorLogImportRecordMapping {
    const TABLE: &'static str = "behaviorlog_import_record_mappings";
    const JSON_COLUMNS: &'static [&'static str] = &[];
    const BOOL_COLUMNS: &'static [&'static str] = &[];
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ImportedNote {
    pub body_markdown: String,
    pub created_at: String,
    pub external_id: String,
    pub id: String,
    pub import_run_id: String,
    pub imported_created_at: String,
    pub imported_updated_at: Option<String>,
    pub metadata: Value,
    pub note_role: String,
    pub sensitivity: Option<String>,
    pub source_capture_method: String,
    pub source_confidence: String,
    pub source_original_id: Option<String>,
    pub target_external_id: String,
    pub target_local_id: Option<String>,
    pub target_type: String,
    pub updated_at: String,
    pub user_id: String,
}
impl StoredRow for ImportedNote {
    const TABLE: &'static str = "imported_notes";
    const JSON_COLUMNS: &'static [&'static str] = &["metadata"];
    const BOOL_COLUMNS: &'static [&'static str] = &[];
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ImportedIntervention {
    pub behavior_external_id: String,
    pub behavior_id: Option<String>,
    pub channel: String,
    pub created_at: String,
    pub delivery_status: String,
    pub external_id: String,
    pub failure_reason: Option<String>,
    pub id: String,
    pub import_run_id: String,
    pub intervention_type: Option<String>,
    pub metadata: Value,
    pub occurrence_external_id: String,
    pub occurrence_id: Option<String>,
    pub redacted_sensitivity_indicators: Value,
    pub scheduled_send_at: String,
    pub sent_at: Option<String>,
    pub source_capture_method: String,
    pub source_confidence: String,
    pub source_original_id: Option<String>,
    pub updated_at: String,
    pub user_id: String,
}
impl StoredRow for ImportedIntervention {
    const TABLE: &'static str = "imported_interventions";
    const JSON_COLUMNS: &'static [&'static str] = &["metadata", "redacted_sensitivity_indicators"];
    const BOOL_COLUMNS: &'static [&'static str] = &[];
}
