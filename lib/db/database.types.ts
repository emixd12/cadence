export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      account_sync_apply_receipts: {
        Row: {
          baseline_fingerprint: string
          created_at: string
          hosted_fingerprint: string
          idempotency_key: string
          local_fingerprint: string
          request_fingerprint: string
          result_fingerprint: string
          result_json: Json
          user_id: string
        }
        Insert: {
          baseline_fingerprint: string
          created_at?: string
          hosted_fingerprint: string
          idempotency_key: string
          local_fingerprint: string
          request_fingerprint: string
          result_fingerprint: string
          result_json: Json
          user_id: string
        }
        Update: {
          baseline_fingerprint?: string
          created_at?: string
          hosted_fingerprint?: string
          idempotency_key?: string
          local_fingerprint?: string
          request_fingerprint?: string
          result_fingerprint?: string
          result_json?: Json
          user_id?: string
        }
        Relationships: []
      }
      behavior_configuration_events: {
        Row: {
          behavior_id: string
          changed_fields: string[]
          created_at: string
          effective_at: string
          effective_local_date: string
          event_kind: string
          id: string
          next_configuration: Json
          previous_configuration: Json | null
          reason_code: string
          recorded_at: string
          source: string
          timezone: string
          user_id: string
        }
        Insert: {
          behavior_id: string
          changed_fields: string[]
          created_at?: string
          effective_at: string
          effective_local_date: string
          event_kind: string
          id?: string
          next_configuration: Json
          previous_configuration?: Json | null
          reason_code: string
          recorded_at: string
          source: string
          timezone: string
          user_id: string
        }
        Update: {
          behavior_id?: string
          changed_fields?: string[]
          created_at?: string
          effective_at?: string
          effective_local_date?: string
          event_kind?: string
          id?: string
          next_configuration?: Json
          previous_configuration?: Json | null
          reason_code?: string
          recorded_at?: string
          source?: string
          timezone?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "behavior_configuration_events_behavior_owner_fkey"
            columns: ["user_id", "behavior_id"]
            isOneToOne: false
            referencedRelation: "behaviors"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      behavior_definition_events: {
        Row: {
          behavior_id: string
          changed_fields: string[]
          created_at: string
          id: string
          next_description: string | null
          next_title: string
          previous_description: string | null
          previous_title: string | null
          reason: string | null
          recorded_at: string
          source: string
          updated_at: string
          user_id: string
        }
        Insert: {
          behavior_id: string
          changed_fields: string[]
          created_at?: string
          id?: string
          next_description?: string | null
          next_title: string
          previous_description?: string | null
          previous_title?: string | null
          reason?: string | null
          recorded_at: string
          source?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          behavior_id?: string
          changed_fields?: string[]
          created_at?: string
          id?: string
          next_description?: string | null
          next_title?: string
          previous_description?: string | null
          previous_title?: string | null
          reason?: string | null
          recorded_at?: string
          source?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "behavior_definition_events_behavior_owner_fkey"
            columns: ["user_id", "behavior_id"]
            isOneToOne: false
            referencedRelation: "behaviors"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      behavior_schedule_slots: {
        Row: {
          behavior_id: string
          behavior_schedule_id: string | null
          created_at: string
          end_time: string | null
          id: string
          kind: string
          preset: string | null
          sort_order: number
          start_time: string
          updated_at: string
          user_id: string
        }
        Insert: {
          behavior_id: string
          behavior_schedule_id?: string | null
          created_at?: string
          end_time?: string | null
          id?: string
          kind: string
          preset?: string | null
          sort_order?: number
          start_time: string
          updated_at?: string
          user_id: string
        }
        Update: {
          behavior_id?: string
          behavior_schedule_id?: string | null
          created_at?: string
          end_time?: string | null
          id?: string
          kind?: string
          preset?: string | null
          sort_order?: number
          start_time?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "behavior_schedule_slots_behavior_id_fkey"
            columns: ["behavior_id"]
            isOneToOne: false
            referencedRelation: "behaviors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "behavior_schedule_slots_behavior_owner_fkey"
            columns: ["user_id", "behavior_id"]
            isOneToOne: false
            referencedRelation: "behaviors"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "behavior_schedule_slots_schedule_behavior_owner_fkey"
            columns: ["user_id", "behavior_id", "behavior_schedule_id"]
            isOneToOne: false
            referencedRelation: "behavior_schedules"
            referencedColumns: ["user_id", "behavior_id", "id"]
          },
          {
            foreignKeyName: "behavior_schedule_slots_schedule_owner_fkey"
            columns: ["user_id", "behavior_schedule_id"]
            isOneToOne: false
            referencedRelation: "behavior_schedules"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      behavior_schedules: {
        Row: {
          behavior_id: string
          created_at: string
          id: string
          recurrence_rule: Json
          sort_order: number
          updated_at: string
          user_id: string
        }
        Insert: {
          behavior_id: string
          created_at?: string
          id?: string
          recurrence_rule: Json
          sort_order?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          behavior_id?: string
          created_at?: string
          id?: string
          recurrence_rule?: Json
          sort_order?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "behavior_schedules_behavior_id_fkey"
            columns: ["behavior_id"]
            isOneToOne: false
            referencedRelation: "behaviors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "behavior_schedules_behavior_owner_fkey"
            columns: ["user_id", "behavior_id"]
            isOneToOne: false
            referencedRelation: "behaviors"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      behaviorlog_import_record_mappings: {
        Row: {
          created_at: string
          external_id: string
          id: string
          import_run_id: string
          local_id: string
          record_type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          external_id: string
          id?: string
          import_run_id: string
          local_id: string
          record_type: string
          user_id: string
        }
        Update: {
          created_at?: string
          external_id?: string
          id?: string
          import_run_id?: string
          local_id?: string
          record_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "behaviorlog_import_record_mappings_import_run_owner_fkey"
            columns: ["user_id", "import_run_id"]
            isOneToOne: false
            referencedRelation: "behaviorlog_import_runs"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      behaviorlog_import_runs: {
        Row: {
          accepted_preview_fingerprint: string | null
          accepted_preview_run_id: string | null
          bundle_fingerprint: string | null
          bundle_format: string
          completed_at: string | null
          created_at: string
          dry_run_summary: Json
          failure_message: string | null
          id: string
          import_mode: string
          manifest_sha256: string | null
          privacy_redaction_level: string | null
          producer_name: string | null
          producer_version: string | null
          schema_version: string | null
          started_at: string
          status: string
          subject_id_strategy: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          accepted_preview_fingerprint?: string | null
          accepted_preview_run_id?: string | null
          bundle_fingerprint?: string | null
          bundle_format: string
          completed_at?: string | null
          created_at?: string
          dry_run_summary?: Json
          failure_message?: string | null
          id?: string
          import_mode: string
          manifest_sha256?: string | null
          privacy_redaction_level?: string | null
          producer_name?: string | null
          producer_version?: string | null
          schema_version?: string | null
          started_at?: string
          status?: string
          subject_id_strategy?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          accepted_preview_fingerprint?: string | null
          accepted_preview_run_id?: string | null
          bundle_fingerprint?: string | null
          bundle_format?: string
          completed_at?: string | null
          created_at?: string
          dry_run_summary?: Json
          failure_message?: string | null
          id?: string
          import_mode?: string
          manifest_sha256?: string | null
          privacy_redaction_level?: string | null
          producer_name?: string | null
          producer_version?: string | null
          schema_version?: string | null
          started_at?: string
          status?: string
          subject_id_strategy?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "behaviorlog_import_runs_accepted_preview_owner_fkey"
            columns: ["user_id", "accepted_preview_run_id"]
            isOneToOne: false
            referencedRelation: "behaviorlog_import_runs"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      behaviors: {
        Row: {
          active: boolean
          archive_notes: Json
          archived_at: string | null
          auto_archived_at: string | null
          browser_reminder_enabled: boolean
          category_id: string | null
          created_at: string
          current_configuration_event_id: string | null
          default_duration_minutes: number | null
          description: string | null
          email_reminder_enabled: boolean
          end_date: string | null
          id: string
          location_text: string | null
          recurrence_rule: Json
          reminder_offset_minutes: number
          scheduled_time: string
          timezone: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          archive_notes?: Json
          archived_at?: string | null
          auto_archived_at?: string | null
          browser_reminder_enabled?: boolean
          category_id?: string | null
          created_at?: string
          current_configuration_event_id?: string | null
          default_duration_minutes?: number | null
          description?: string | null
          email_reminder_enabled?: boolean
          end_date?: string | null
          id?: string
          location_text?: string | null
          recurrence_rule: Json
          reminder_offset_minutes?: number
          scheduled_time: string
          timezone?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          archive_notes?: Json
          archived_at?: string | null
          auto_archived_at?: string | null
          browser_reminder_enabled?: boolean
          category_id?: string | null
          created_at?: string
          current_configuration_event_id?: string | null
          default_duration_minutes?: number | null
          description?: string | null
          email_reminder_enabled?: boolean
          end_date?: string | null
          id?: string
          location_text?: string | null
          recurrence_rule?: Json
          reminder_offset_minutes?: number
          scheduled_time?: string
          timezone?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "behaviors_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "behaviors_category_owner_fkey"
            columns: ["user_id", "category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "behaviors_current_configuration_event_owner_fkey"
            columns: ["user_id", "id", "current_configuration_event_id"]
            isOneToOne: false
            referencedRelation: "behavior_configuration_events"
            referencedColumns: ["user_id", "behavior_id", "id"]
          },
        ]
      }
      categories: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          sort_order: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          sort_order?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          sort_order?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      google_calendar_connections: {
        Row: {
          attempt_hash: string | null
          generation: number
          google_subject: string
          status: string
          user_id: string
        }
        Insert: {
          attempt_hash?: string | null
          generation?: number
          google_subject: string
          status?: string
          user_id: string
        }
        Update: {
          attempt_hash?: string | null
          generation?: number
          google_subject?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      google_calendar_preferences: {
        Row: {
          hidden_calendar_ids: string[]
          selected_calendar_ids: string[]
          selection_revision: number
          show_all_day: boolean
          user_id: string
          visible: boolean
        }
        Insert: {
          hidden_calendar_ids?: string[]
          selected_calendar_ids?: string[]
          selection_revision?: number
          show_all_day?: boolean
          user_id: string
          visible?: boolean
        }
        Update: {
          hidden_calendar_ids?: string[]
          selected_calendar_ids?: string[]
          selection_revision?: number
          show_all_day?: boolean
          user_id?: string
          visible?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "google_calendar_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "google_calendar_connections"
            referencedColumns: ["user_id"]
          },
        ]
      }
      imported_interventions: {
        Row: {
          behavior_external_id: string
          behavior_id: string | null
          channel: string
          created_at: string
          delivery_status: string
          external_id: string
          failure_reason: string | null
          id: string
          import_run_id: string
          intervention_type: string | null
          metadata: Json
          occurrence_external_id: string
          occurrence_id: string | null
          redacted_sensitivity_indicators: Json
          scheduled_send_at: string
          sent_at: string | null
          source_capture_method: string
          source_confidence: string
          source_original_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          behavior_external_id: string
          behavior_id?: string | null
          channel: string
          created_at?: string
          delivery_status: string
          external_id: string
          failure_reason?: string | null
          id?: string
          import_run_id: string
          intervention_type?: string | null
          metadata?: Json
          occurrence_external_id: string
          occurrence_id?: string | null
          redacted_sensitivity_indicators?: Json
          scheduled_send_at: string
          sent_at?: string | null
          source_capture_method?: string
          source_confidence?: string
          source_original_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          behavior_external_id?: string
          behavior_id?: string | null
          channel?: string
          created_at?: string
          delivery_status?: string
          external_id?: string
          failure_reason?: string | null
          id?: string
          import_run_id?: string
          intervention_type?: string | null
          metadata?: Json
          occurrence_external_id?: string
          occurrence_id?: string | null
          redacted_sensitivity_indicators?: Json
          scheduled_send_at?: string
          sent_at?: string | null
          source_capture_method?: string
          source_confidence?: string
          source_original_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "imported_interventions_behavior_owner_fkey"
            columns: ["user_id", "behavior_id"]
            isOneToOne: false
            referencedRelation: "behaviors"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "imported_interventions_import_run_owner_fkey"
            columns: ["user_id", "import_run_id"]
            isOneToOne: false
            referencedRelation: "behaviorlog_import_runs"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "imported_interventions_occurrence_owner_fkey"
            columns: ["user_id", "occurrence_id"]
            isOneToOne: false
            referencedRelation: "occurrences"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      imported_notes: {
        Row: {
          body_markdown: string
          created_at: string
          external_id: string
          id: string
          import_run_id: string
          imported_created_at: string
          imported_updated_at: string | null
          metadata: Json
          note_role: string
          sensitivity: string | null
          source_capture_method: string
          source_confidence: string
          source_original_id: string | null
          target_external_id: string
          target_local_id: string | null
          target_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          body_markdown: string
          created_at?: string
          external_id: string
          id?: string
          import_run_id: string
          imported_created_at: string
          imported_updated_at?: string | null
          metadata?: Json
          note_role: string
          sensitivity?: string | null
          source_capture_method: string
          source_confidence: string
          source_original_id?: string | null
          target_external_id: string
          target_local_id?: string | null
          target_type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          body_markdown?: string
          created_at?: string
          external_id?: string
          id?: string
          import_run_id?: string
          imported_created_at?: string
          imported_updated_at?: string | null
          metadata?: Json
          note_role?: string
          sensitivity?: string | null
          source_capture_method?: string
          source_confidence?: string
          source_original_id?: string | null
          target_external_id?: string
          target_local_id?: string | null
          target_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "imported_notes_import_run_owner_fkey"
            columns: ["user_id", "import_run_id"]
            isOneToOne: false
            referencedRelation: "behaviorlog_import_runs"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      launch_rate_limits: {
        Row: {
          action: string
          attempt_count: number
          updated_at: string
          user_id: string
          window_started_at: string
        }
        Insert: {
          action: string
          attempt_count: number
          updated_at?: string
          user_id: string
          window_started_at: string
        }
        Update: {
          action?: string
          attempt_count?: number
          updated_at?: string
          user_id?: string
          window_started_at?: string
        }
        Relationships: []
      }
      note_shortcut_states: {
        Row: {
          behavior_id: string | null
          enabled: boolean
          entries: Json
          excluded_occurrence_ids: Json
          id: string
          revision: number
          updated_at: string
          user_id: string
        }
        Insert: {
          behavior_id?: string | null
          enabled?: boolean
          entries?: Json
          excluded_occurrence_ids?: Json
          id: string
          revision?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          behavior_id?: string | null
          enabled?: boolean
          entries?: Json
          excluded_occurrence_ids?: Json
          id?: string
          revision?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "note_shortcut_states_behavior_owner_fkey"
            columns: ["user_id", "behavior_id"]
            isOneToOne: false
            referencedRelation: "behaviors"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      occurrence_status_events: {
        Row: {
          behavior_id: string
          created_at: string
          effective_at: string | null
          id: string
          local_date: string
          occurrence_id: string
          previous_status: string | null
          reason_code: string | null
          recorded_at: string
          revises_event_id: string | null
          source_capture_method: string
          source_confidence: string
          status: string
          status_semantics: string
          timezone: string
          updated_at: string
          user_id: string
        }
        Insert: {
          behavior_id: string
          created_at?: string
          effective_at?: string | null
          id?: string
          local_date: string
          occurrence_id: string
          previous_status?: string | null
          reason_code?: string | null
          recorded_at: string
          revises_event_id?: string | null
          source_capture_method?: string
          source_confidence?: string
          status: string
          status_semantics: string
          timezone?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          behavior_id?: string
          created_at?: string
          effective_at?: string | null
          id?: string
          local_date?: string
          occurrence_id?: string
          previous_status?: string | null
          reason_code?: string | null
          recorded_at?: string
          revises_event_id?: string | null
          source_capture_method?: string
          source_confidence?: string
          status?: string
          status_semantics?: string
          timezone?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "occurrence_status_events_occurrence_owner_fkey"
            columns: ["user_id", "occurrence_id", "behavior_id"]
            isOneToOne: false
            referencedRelation: "occurrences"
            referencedColumns: ["user_id", "id", "behavior_id"]
          },
          {
            foreignKeyName: "occurrence_status_events_revises_event_owner_fkey"
            columns: ["user_id", "revises_event_id"]
            isOneToOne: false
            referencedRelation: "occurrence_status_events"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      occurrence_sync_state: {
        Row: {
          created_at: string
          last_successful_sync_at: string | null
          last_sync_behavior_count: number
          last_sync_created_count: number
          last_sync_deleted_count: number
          last_sync_updated_count: number
          last_synced_local_date: string | null
          stale: boolean
          stale_reason: string | null
          state_version: number
          synced_through_local_date: string | null
          timezone: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          last_successful_sync_at?: string | null
          last_sync_behavior_count?: number
          last_sync_created_count?: number
          last_sync_deleted_count?: number
          last_sync_updated_count?: number
          last_synced_local_date?: string | null
          stale?: boolean
          stale_reason?: string | null
          state_version?: number
          synced_through_local_date?: string | null
          timezone?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          last_successful_sync_at?: string | null
          last_sync_behavior_count?: number
          last_sync_created_count?: number
          last_sync_deleted_count?: number
          last_sync_updated_count?: number
          last_synced_local_date?: string | null
          stale?: boolean
          stale_reason?: string | null
          state_version?: number
          synced_through_local_date?: string | null
          timezone?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      occurrence_time_sessions: {
        Row: {
          behavior_id: string
          created_at: string
          id: string
          occurrence_id: string
          started_at: string
          stopped_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          behavior_id: string
          created_at?: string
          id?: string
          occurrence_id: string
          started_at: string
          stopped_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          behavior_id?: string
          created_at?: string
          id?: string
          occurrence_id?: string
          started_at?: string
          stopped_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "occurrence_time_sessions_occurrence_owner_fkey"
            columns: ["user_id", "occurrence_id", "behavior_id"]
            isOneToOne: false
            referencedRelation: "occurrences"
            referencedColumns: ["user_id", "id", "behavior_id"]
          },
        ]
      }
      occurrences: {
        Row: {
          behavior_configuration_event_id: string | null
          behavior_id: string
          behavior_schedule_slot_id: string | null
          completed_at: string | null
          created_at: string
          id: string
          local_date: string
          note: string | null
          schedule_end_time: string | null
          schedule_kind: string
          schedule_preset: string | null
          schedule_range_identity: number | null
          schedule_start_time: string
          scheduled_for: string
          status: string
          status_marked_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          behavior_configuration_event_id?: string | null
          behavior_id: string
          behavior_schedule_slot_id?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          local_date: string
          note?: string | null
          schedule_end_time?: string | null
          schedule_kind?: string
          schedule_preset?: string | null
          schedule_range_identity?: number | null
          schedule_start_time: string
          scheduled_for: string
          status?: string
          status_marked_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          behavior_configuration_event_id?: string | null
          behavior_id?: string
          behavior_schedule_slot_id?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          local_date?: string
          note?: string | null
          schedule_end_time?: string | null
          schedule_kind?: string
          schedule_preset?: string | null
          schedule_range_identity?: number | null
          schedule_start_time?: string
          scheduled_for?: string
          status?: string
          status_marked_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "occurrences_behavior_id_fkey"
            columns: ["behavior_id"]
            isOneToOne: false
            referencedRelation: "behaviors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "occurrences_behavior_owner_fkey"
            columns: ["user_id", "behavior_id"]
            isOneToOne: false
            referencedRelation: "behaviors"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "occurrences_configuration_event_owner_fkey"
            columns: [
              "user_id",
              "behavior_id",
              "behavior_configuration_event_id",
            ]
            isOneToOne: false
            referencedRelation: "behavior_configuration_events"
            referencedColumns: ["user_id", "behavior_id", "id"]
          },
          {
            foreignKeyName: "occurrences_schedule_slot_owner_fkey"
            columns: ["user_id", "behavior_schedule_slot_id"]
            isOneToOne: false
            referencedRelation: "behavior_schedule_slots"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          email: string
          id: string
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email: string
          id: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string
          id?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          active: boolean
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          updated_at: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          active?: boolean
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          updated_at?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          active?: boolean
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          updated_at?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      reminder_deliveries: {
        Row: {
          channel: string
          created_at: string
          error: string | null
          id: string
          import_run_id: string | null
          imported_intervention_id: string | null
          occurrence_id: string
          processing_started_at: string | null
          scheduled_send_at: string
          sent_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          channel: string
          created_at?: string
          error?: string | null
          id?: string
          import_run_id?: string | null
          imported_intervention_id?: string | null
          occurrence_id: string
          processing_started_at?: string | null
          scheduled_send_at: string
          sent_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          channel?: string
          created_at?: string
          error?: string | null
          id?: string
          import_run_id?: string | null
          imported_intervention_id?: string | null
          occurrence_id?: string
          processing_started_at?: string | null
          scheduled_send_at?: string
          sent_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reminder_deliveries_import_run_owner_fkey"
            columns: ["user_id", "import_run_id"]
            isOneToOne: false
            referencedRelation: "behaviorlog_import_runs"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "reminder_deliveries_imported_intervention_owner_fkey"
            columns: ["user_id", "imported_intervention_id"]
            isOneToOne: false
            referencedRelation: "imported_interventions"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "reminder_deliveries_occurrence_id_fkey"
            columns: ["occurrence_id"]
            isOneToOne: false
            referencedRelation: "occurrences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminder_deliveries_occurrence_owner_fkey"
            columns: ["user_id", "occurrence_id"]
            isOneToOne: false
            referencedRelation: "occurrences"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      travel_route_global_quota: {
        Row: {
          attempt_count: number
          updated_at: string
          utc_date: string
        }
        Insert: {
          attempt_count: number
          updated_at?: string
          utc_date: string
        }
        Update: {
          attempt_count?: number
          updated_at?: string
          utc_date?: string
        }
        Relationships: []
      }
      travel_route_owner_quota: {
        Row: {
          attempt_count: number
          local_date: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempt_count: number
          local_date: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempt_count?: number
          local_date?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      travel_settings: {
        Row: {
          base_location_text: string | null
          created_at: string
          enabled: boolean
          mode: string | null
          navigation_preference: string | null
          onboarding_completed_at: string | null
          routing_consent_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          base_location_text?: string | null
          created_at?: string
          enabled?: boolean
          mode?: string | null
          navigation_preference?: string | null
          onboarding_completed_at?: string | null
          routing_consent_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          base_location_text?: string | null
          created_at?: string
          enabled?: boolean
          mode?: string | null
          navigation_preference?: string | null
          onboarding_completed_at?: string | null
          routing_consent_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "travel_settings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      acquire_advisor_day_context_read: {
        Args: { p_client_id: string }
        Returns: {
          lease_token: string
          retry_after_seconds: number
        }[]
      }
      apply_account_sync_plan: { Args: { sync_payload: Json }; Returns: Json }
      apply_behaviorlog_import: {
        Args: { import_payload: Json }
        Returns: Json
      }
      apply_behaviorlog_restore: {
        Args: { restore_payload: Json }
        Returns: Json
      }
      apply_behaviorlog_restore_product_writes: {
        Args: { restore_payload: Json }
        Returns: Json
      }
      apply_behaviorlog_restore_with_configuration_events: {
        Args: { restore_payload: Json }
        Returns: Json
      }
      apply_occurrence_generation_plan: {
        Args: {
          expected_configuration_event_id: string
          occurrence_deletes: Json
          occurrence_inserts: Json
          occurrence_updates: Json
          plan_now: string
          target_behavior_id: string
          target_user_id: string
        }
        Returns: Json
      }
      apply_occurrence_status_transition: {
        Args: {
          expected_latest_event_id: string
          expected_status: string
          planned_cancel_pending_reminders: boolean
          planned_completed_at: string
          planned_event_effective_at: string
          planned_event_recorded_at: string
          planned_event_semantics: string
          planned_event_source_capture_method: string
          planned_event_source_confidence: string
          planned_status: string
          planned_status_marked_at: string
          target_occurrence_id: string
        }
        Returns: Json
      }
      archive_due_behaviors: {
        Args: { batch_limit?: number; processed_at: string }
        Returns: {
          behavior_id: string
          user_id: string
        }[]
      }
      archive_my_due_behaviors: {
        Args: { batch_limit?: number }
        Returns: {
          behavior_id: string
          user_id: string
        }[]
      }
      begin_daily_brief: {
        Args: {
          p_expected_revision: number
          p_installation_id: string
          p_retry: boolean
        }
        Returns: Json
      }
      bind_behaviorlog_restore_apply_payload: {
        Args: { restore_payload: Json }
        Returns: string
      }
      calendar_begin_attempt: {
        Args: {
          client_nonce: string
          expected_generation: number
          expected_subject: string
          owner_id: string
          return_target: string
          state_digest: string
          verifier_ciphertext: string
        }
        Returns: number
      }
      calendar_consume_attempt: {
        Args: { state_digest: string }
        Returns: Json
      }
      calendar_disconnect: {
        Args: {
          expected_generation: number
          expected_subject: string
          next_status: string
          owner_id: string
        }
        Returns: string
      }
      calendar_install_credential: {
        Args: {
          expected_generation: number
          expected_state_hash: string
          expected_subject: string
          owner_id: string
          token_ciphertext: string
        }
        Returns: boolean
      }
      calendar_read_credential: {
        Args: {
          expected_generation: number
          expected_subject: string
          owner_id: string
        }
        Returns: string
      }
      commit_note_shortcut_state: {
        Args: {
          expected_context: Json
          next_state: Json
          require_enabled: boolean
        }
        Returns: Json
      }
      consume_launch_rate_limit: {
        Args: { p_action: string }
        Returns: {
          allowed: boolean
          limit_count: number
          remaining: number
          reset_at: string
          retry_after_seconds: number
        }[]
      }
      consume_travel_route_quota: {
        Args: never
        Returns: {
          allowed: boolean
          retry_after_seconds: number
        }[]
      }
      create_behavior_with_definition_event: {
        Args: { behavior_payload: Json; definition_event_plan: Json }
        Returns: Json
      }
      create_behavior_with_schedule_graph: {
        Args: {
          behavior_payload: Json
          configuration_event_plan: Json
          definition_event_plan: Json
          schedule_graph: Json
        }
        Returns: Json
      }
      finish_daily_brief: {
        Args: {
          p_expected_revision: number
          p_installation_id: string
          p_lease_token: string
          p_success: boolean
        }
        Returns: boolean
      }
      get_export_page_read_bundle: {
        Args: { range_end_local_date: string; range_start_local_date: string }
        Returns: Json
      }
      get_export_page_summary: {
        Args: {
          include_archived: boolean
          include_time_tracking: boolean
          range_end_local_date: string
          range_start_local_date: string
          through_started_at: string
        }
        Returns: Json
      }
      list_my_occurrence_time_session_history: {
        Args: {
          cursor_session_id: string
          cursor_started_at: string
          include_archived: boolean
          page_size: number
          range_end_local_date: string
          range_start_local_date: string
          through_started_at: string
        }
        Returns: {
          behavior_id: string
          id: string
          occurrence_id: string
          started_at: string
          stopped_at: string
          user_id: string
        }[]
      }
      list_my_occurrence_time_sessions: {
        Args: { occurrence_ids: string[] }
        Returns: {
          behavior_id: string
          id: string
          occurrence_id: string
          started_at: string
          stopped_at: string
          user_id: string
        }[]
      }
      manage_categories: {
        Args: {
          behavior_changes: Json
          expected_categories: Json
          next_categories: Json
        }
        Returns: undefined
      }
      mark_occurrence_sync_fresh_if_configuration_current: {
        Args: {
          expected_behavior_configuration_events: Json
          expected_sync_state_exists: boolean
          expected_sync_state_version: number
          target_behavior_count: number
          target_created_count: number
          target_deleted_count: number
          target_last_successful_sync_at: string
          target_last_synced_local_date: string
          target_synced_through_local_date: string
          target_timezone: string
          target_updated_count: number
          target_user_id: string
        }
        Returns: Json
      }
      read_account_sync_snapshot: { Args: never; Returns: Json }
      read_advisor_analysis_snapshot: {
        Args: {
          history_start_local_date: string
          include_notes: boolean
          include_reminders: boolean
          revision_only: boolean
          selected_behavior_ids: string[]
          target_local_date: string
        }
        Returns: Json
      }
      read_advisor_cadence_revision: {
        Args: {
          history_occurrence_limit: number
          history_session_limit: number
          history_start_local_date: string
          selected_behavior_ids: string[]
          target_local_date: string
        }
        Returns: string
      }
      read_advisor_cadence_snapshot: {
        Args: {
          history_occurrence_limit: number
          history_session_limit: number
          history_start_local_date: string
          selected_behavior_ids: string[]
          target_local_date: string
        }
        Returns: Json
      }
      read_daily_brief_preferences: { Args: never; Returns: Json }
      read_daily_brief_tip_history: { Args: never; Returns: Json }
      read_note_shortcut_context: {
        Args: { target_behavior_id: string }
        Returns: Json
      }
      record_daily_brief_tip: {
        Args: {
          p_expected_revision: number
          p_fingerprint: string
          p_installation_id: string
          p_lease_token: string
        }
        Returns: boolean
      }
      release_advisor_day_context_read: {
        Args: { p_client_id: string; p_lease_token: string }
        Returns: boolean
      }
      save_daily_brief_preferences: {
        Args: {
          p_enabled: boolean
          p_expected_revision: number
          p_include_calendar: boolean
        }
        Returns: Json
      }
      save_daily_brief_preferences_v2: {
        Args: {
          p_enabled: boolean
          p_expected_revision: number
          p_include_calendar: boolean
          p_include_notes: boolean
          p_include_reminder_history: boolean
        }
        Returns: Json
      }
      update_behavior_with_definition_event: {
        Args: {
          behavior_payload: Json
          definition_event_plan: Json
          expected_definition: Json
          target_behavior_id: string
        }
        Returns: Json
      }
      update_behavior_with_schedule_graph: {
        Args: {
          behavior_payload: Json
          configuration_event_plan: Json
          definition_event_plan: Json
          expected_definition: Json
          expected_schedule_graph: Json
          expected_updated_at: string
          schedule_graph: Json
          target_behavior_id: string
        }
        Returns: Json
      }
      update_occurrence_note_with_shortcut: {
        Args: {
          expected_note: string
          next_note: string
          target_occurrence_id: string
          used_shortcut: boolean
        }
        Returns: {
          behavior_configuration_event_id: string | null
          behavior_id: string
          behavior_schedule_slot_id: string | null
          completed_at: string | null
          created_at: string
          id: string
          local_date: string
          note: string | null
          schedule_end_time: string | null
          schedule_kind: string
          schedule_preset: string | null
          schedule_range_identity: number | null
          schedule_start_time: string
          scheduled_for: string
          status: string
          status_marked_at: string | null
          updated_at: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "occurrences"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      update_profile_and_behavior_timezones_with_config_events: {
        Args: {
          behavior_changes: Json
          expected_profile_timezone: string
          target_timezone: string
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
