-- Account sync contract guard (docs/plans/2026-10-27-sync-compatibility.md, Part B).
-- Synced rows are built with to_jsonb(row), so a new column reaches every client,
-- including older contracts. Each column outside the frozen contract 3 list must be
-- registered in cadence_private.account_sync_contract_additions with a later contract.
-- To add a synced column: register it (field and default), raise ACCOUNT_SYNC_CONTRACT
-- in packages/core/src/resolvers/account-sync.resolver.ts, then extend this file only
-- when the contract number moves.
begin;

do $$
declare
  frozen jsonb := $frozen$
{
    "behavior_source_links": [
        "account_digest",
        "behavior_id",
        "created_at",
        "enabled",
        "id",
        "selector_keys",
        "selector_kind",
        "source",
        "updated_at"
    ],
    "occurrence_source_matches": [
        "activity_end_at",
        "activity_ref",
        "activity_revision",
        "activity_start_at",
        "applied_event_id",
        "behavior_id",
        "created_at",
        "id",
        "link_id",
        "occurrence_id",
        "reverted_event_id",
        "role",
        "scheduled_end_at",
        "scheduled_start_at",
        "source",
        "state",
        "updated_at"
    ],
    "day_notes": [
        "created_at",
        "id",
        "local_date",
        "note",
        "revision",
        "updated_at"
    ],
    "behaviors": [
        "active",
        "archive_notes",
        "archived_at",
        "auto_archived_at",
        "browser_reminder_enabled",
        "category_id",
        "created_at",
        "current_configuration_event_id",
        "default_duration_minutes",
        "description",
        "email_reminder_enabled",
        "end_date",
        "id",
        "location_text",
        "recurrence_rule",
        "reminder_offset_minutes",
        "scheduled_time",
        "timezone",
        "title",
        "updated_at",
        "where_kind"
    ],
    "categories": [
        "created_at",
        "description",
        "id",
        "name",
        "sort_order",
        "updated_at"
    ],
    "occurrences": [
        "behavior_configuration_event_id",
        "behavior_id",
        "behavior_schedule_slot_id",
        "completed_at",
        "created_at",
        "id",
        "local_date",
        "note",
        "schedule_end_time",
        "schedule_kind",
        "schedule_preset",
        "schedule_range_identity",
        "schedule_start_time",
        "scheduled_for",
        "status",
        "status_marked_at",
        "updated_at"
    ],
    "place_markers": [
        "accuracy_meters",
        "id",
        "latitude_e6",
        "longitude_e6",
        "place_key",
        "recorded_at",
        "rule_version"
    ],
    "imported_notes": [
        "body_markdown",
        "created_at",
        "external_id",
        "id",
        "import_run_id",
        "imported_created_at",
        "imported_updated_at",
        "metadata",
        "note_role",
        "sensitivity",
        "source_capture_method",
        "source_confidence",
        "source_original_id",
        "target_external_id",
        "target_local_id",
        "target_type",
        "updated_at"
    ],
    "behavior_schedules": [
        "behavior_id",
        "created_at",
        "id",
        "recurrence_rule",
        "sort_order",
        "updated_at"
    ],
    "reminder_deliveries": [
        "channel",
        "created_at",
        "error",
        "id",
        "import_run_id",
        "imported_intervention_id",
        "occurrence_id",
        "processing_started_at",
        "scheduled_send_at",
        "sent_at",
        "status",
        "updated_at"
    ],
    "note_shortcut_states": [
        "behavior_id",
        "enabled",
        "entries",
        "excluded_occurrence_ids",
        "id",
        "revision",
        "updated_at"
    ],
    "place_label_settings": [
        "enabled",
        "enabled_at",
        "id",
        "marker_prompt_dismissed_at",
        "retention",
        "updated_at"
    ],
    "imported_interventions": [
        "behavior_external_id",
        "behavior_id",
        "channel",
        "created_at",
        "delivery_status",
        "external_id",
        "failure_reason",
        "id",
        "import_run_id",
        "intervention_type",
        "metadata",
        "occurrence_external_id",
        "occurrence_id",
        "redacted_sensitivity_indicators",
        "scheduled_send_at",
        "sent_at",
        "source_capture_method",
        "source_confidence",
        "source_original_id",
        "updated_at"
    ],
    "behavior_schedule_slots": [
        "behavior_id",
        "behavior_schedule_id",
        "created_at",
        "end_time",
        "id",
        "kind",
        "preset",
        "sort_order",
        "start_time",
        "updated_at"
    ],
    "behaviorlog_import_runs": [
        "accepted_preview_fingerprint",
        "accepted_preview_run_id",
        "bundle_fingerprint",
        "bundle_format",
        "completed_at",
        "created_at",
        "dry_run_summary",
        "failure_message",
        "id",
        "import_mode",
        "manifest_sha256",
        "privacy_redaction_level",
        "producer_name",
        "producer_version",
        "schema_version",
        "started_at",
        "status",
        "subject_id_strategy",
        "updated_at"
    ],
    "completion_place_labels": [
        "behavior_id",
        "id",
        "label",
        "local_date",
        "recorded_at",
        "rule_version"
    ],
    "occurrence_status_events": [
        "behavior_id",
        "created_at",
        "effective_at",
        "id",
        "local_date",
        "occurrence_id",
        "previous_status",
        "reason_code",
        "recorded_at",
        "revises_event_id",
        "source_capture_method",
        "source_confidence",
        "status",
        "status_semantics",
        "timezone",
        "updated_at"
    ],
    "occurrence_time_sessions": [
        "behavior_id",
        "created_at",
        "id",
        "occurrence_id",
        "started_at",
        "stopped_at",
        "updated_at"
    ],
    "behavior_definition_events": [
        "behavior_id",
        "changed_fields",
        "created_at",
        "id",
        "next_description",
        "next_title",
        "previous_description",
        "previous_title",
        "reason",
        "recorded_at",
        "source",
        "updated_at"
    ],
    "where_suggestion_dismissals": [
        "dismissed_at",
        "id",
        "rule_version",
        "suggestion"
    ],
    "behavior_configuration_events": [
        "behavior_id",
        "changed_fields",
        "created_at",
        "effective_at",
        "effective_local_date",
        "event_kind",
        "id",
        "next_configuration",
        "previous_configuration",
        "reason_code",
        "recorded_at",
        "source",
        "timezone"
    ],
    "behaviorlog_import_record_mappings": [
        "created_at",
        "external_id",
        "id",
        "import_run_id",
        "local_id",
        "record_type"
    ]
}
$frozen$::jsonb;
  kinds jsonb := '{
    "categories": "category", "behaviors": "behavior", "behavior_schedules": "schedule",
    "behavior_schedule_slots": "schedule_slot", "behavior_definition_events": "definition_event",
    "behavior_configuration_events": "configuration_event", "occurrences": "occurrence",
    "occurrence_status_events": "status_event", "occurrence_time_sessions": "time_session",
    "behaviorlog_import_runs": "import_run", "behaviorlog_import_record_mappings": "mapping",
    "imported_notes": "imported_note", "imported_interventions": "imported_intervention",
    "reminder_deliveries": "reminder_delivery", "note_shortcut_states": "note_shortcut_state",
    "place_label_settings": "place_label_settings", "place_markers": "place_marker",
    "completion_place_labels": "completion_place_label", "where_suggestion_dismissals": "where_suggestion_dismissal",
    "day_notes": "day_note", "behavior_source_links": "behavior_source_link",
    "occurrence_source_matches": "occurrence_source_match"
  }'::jsonb;
  unregistered text;
  missing_default text;
begin
  select string_agg(format('%I.%I', c.table_name, c.column_name), ', ' order by c.table_name, c.column_name)
  into unregistered
  from information_schema.columns c
  where c.table_schema = 'public' and c.column_name <> 'user_id' and frozen ? c.table_name
    and not (frozen -> c.table_name) ? c.column_name
    and not exists (
      select 1 from cadence_private.account_sync_contract_additions addition
      where addition.kind = kinds ->> c.table_name and addition.field = c.column_name and addition.contract > 3
    );
  if unregistered is not null then
    raise exception 'Synced columns need an account sync contract entry: %', unregistered;
  end if;

  select string_agg(format('%s.%s', kind, field), ', ') into missing_default
  from cadence_private.account_sync_contract_additions
  where field is not null and default_value is null;
  if missing_default is not null then
    raise exception 'Account sync contract fields need a default: %', missing_default;
  end if;

  -- Contract 4 adds no column or kind; it adds the day-note Note shortcut row (Ticket 292).
  -- Contract 5 adds the read-only connector completion kinds (Ticket 320).
  if cadence_private.account_sync_current_contract() <> 5 then
    raise exception 'Update the frozen list and ACCOUNT_SYNC_CONTRACT for contract %', cadence_private.account_sync_current_contract();
  end if;
  if cadence_private.project_account_sync_snapshot(
    jsonb_build_object('schemaVersion', 1, 'userId', gen_random_uuid(), 'fingerprint', '', 'entities', jsonb_build_array(
      jsonb_build_object('kind', 'profile', 'id', 'profile', 'value', jsonb_build_object('timezone', 'UTC', 'travel_place_modes', '[]'::jsonb)),
      jsonb_build_object('kind', 'place_marker', 'id', 'x', 'value', '{}'::jsonb)
    )), 1) -> 'entities' <> '[{"id": "profile", "kind": "profile", "value": {"timezone": "UTC"}}]'::jsonb then
    raise exception 'Contract 1 projection no longer hides contract 2 fields and kinds.';
  end if;
  if cadence_private.project_account_sync_snapshot(
    jsonb_build_object('schemaVersion', 1, 'userId', gen_random_uuid(), 'fingerprint', '', 'entities', jsonb_build_array(
      jsonb_build_object('kind', 'profile', 'id', 'profile', 'value', jsonb_build_object('timezone', 'UTC')),
      jsonb_build_object('kind', 'day_note', 'id', 'x', 'value', '{}'::jsonb)
    )), 2) -> 'entities' <> '[{"id": "profile", "kind": "profile", "value": {"timezone": "UTC"}}]'::jsonb then
    raise exception 'Contract 2 projection no longer hides the contract 3 day_note kind.';
  end if;
  if cadence_private.project_account_sync_snapshot(
    jsonb_build_object('schemaVersion', 1, 'userId', gen_random_uuid(), 'fingerprint', '', 'entities', jsonb_build_array(
      jsonb_build_object('kind', 'note_shortcut_state', 'id', 'day_notes', 'value', '{}'::jsonb),
      jsonb_build_object('kind', 'note_shortcut_state', 'id', 'global', 'value', '{}'::jsonb)
    )), 3) -> 'entities' <> '[{"id": "global", "kind": "note_shortcut_state", "value": {}}]'::jsonb then
    raise exception 'Contract 3 projection no longer hides the contract 4 day-note shortcut row.';
  end if;
  if jsonb_array_length(cadence_private.project_account_sync_snapshot(
    jsonb_build_object('schemaVersion', 1, 'userId', gen_random_uuid(), 'fingerprint', '', 'entities', jsonb_build_array(
      jsonb_build_object('kind', 'note_shortcut_state', 'id', 'day_notes', 'value', '{}'::jsonb)
    )), 4) -> 'entities') <> 1 then
    raise exception 'Contract 4 projection hides the day-note shortcut row.';
  end if;
end;
$$;

rollback;
