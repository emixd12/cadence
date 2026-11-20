import type { ExportSummaryCounts } from "@/lib/types/export";
import type { Json } from "@/lib/db/database.types";
import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import { measurePerformanceSpan } from "@/lib/services/performance-timing";
import type {
  Behavior,
  BehaviorScheduleSlot,
  Category,
  Occurrence,
  OccurrenceStatusEvent,
  OccurrenceSyncState,
  ReminderDelivery,
} from "@/lib/types/database";

const ALL_TIME_START_LOCAL_DATE = "0001-01-01";

export type ExportPageProfileRow = {
  timezone: string;
};

export type ExportPageSyncStateRow = Omit<OccurrenceSyncState, "user_id">;

export type ExportPageCategoryRow = Pick<
  Category,
  "id" | "name" | "sort_order" | "created_at" | "updated_at"
>;

export type ExportPageScheduleSlotRow = Omit<
  Pick<
    BehaviorScheduleSlot,
    | "id"
    | "user_id"
    | "behavior_id"
    | "kind"
    | "preset"
    | "start_time"
    | "end_time"
    | "sort_order"
    | "created_at"
    | "updated_at"
  >,
  "user_id"
>;

export type ExportPageBehaviorRow = Pick<
  Behavior,
  | "id"
  | "category_id"
  | "title"
  | "description"
  | "recurrence_rule"
  | "scheduled_time"
  | "timezone"
  | "browser_reminder_enabled"
  | "email_reminder_enabled"
  | "reminder_offset_minutes"
  | "active"
  | "archived_at"
  | "archive_notes"
  | "default_duration_minutes"
  | "end_on"
  | "end_time"
  | "pause_from_on"
  | "pause_from_time"
  | "pause_back_on"
  | "auto_archived_at"
  | "current_configuration_event_id"
  | "created_at"
  | "updated_at"
> & {
  category: Pick<Category, "id" | "name"> | null;
  schedule_slots: ExportPageScheduleSlotRow[];
};

export type ExportPageOccurrenceRow = Pick<
  Occurrence,
  | "id"
  | "behavior_id"
  | "behavior_schedule_slot_id"
  | "behavior_configuration_event_id"
  | "scheduled_for"
  | "local_date"
  | "schedule_kind"
  | "schedule_preset"
  | "schedule_start_time"
  | "schedule_end_time"
  | "status"
  | "completed_at"
  | "status_marked_at"
  | "note"
  | "created_at"
  | "updated_at"
>;

export type ExportPageStatusEventRow = Pick<
  OccurrenceStatusEvent,
  | "id"
  | "occurrence_id"
  | "behavior_id"
  | "previous_status"
  | "status"
  | "status_semantics"
  | "recorded_at"
  | "effective_at"
  | "local_date"
  | "timezone"
  | "source_capture_method"
  | "source_confidence"
  | "revises_event_id"
  | "reason_code"
  | "created_at"
  | "updated_at"
>;

export type ExportPageReminderDeliveryRow = Pick<
  ReminderDelivery,
  | "id"
  | "occurrence_id"
  | "channel"
  | "scheduled_send_at"
  | "sent_at"
  | "status"
  | "error"
  | "processing_started_at"
  | "created_at"
  | "updated_at"
>;

export type ExportPageReadBundle = {
  profile: ExportPageProfileRow | null;
  syncState: ExportPageSyncStateRow | null;
  categories: ExportPageCategoryRow[];
  behaviors: ExportPageBehaviorRow[];
  occurrences: ExportPageOccurrenceRow[];
  statusEvents: ExportPageStatusEventRow[];
  reminderDeliveries: ExportPageReminderDeliveryRow[];
};

export async function readExportPageBundle(
  supabase: AppSupabaseClient,
  input: {
    startLocalDate: string | null;
    endLocalDate: string;
  },
): Promise<ExportPageReadBundle> {
  return measurePerformanceSpan(
    {
      span: "db.get_export_page_read_bundle",
      counts: (bundle) => ({
        profile: bundle.profile ? 1 : 0,
        sync_state: bundle.syncState ? 1 : 0,
        categories: bundle.categories.length,
        behaviors: bundle.behaviors.length,
        schedule_slots: bundle.behaviors.reduce(
          (sum, behavior) => sum + behavior.schedule_slots.length,
          0,
        ),
        occurrences: bundle.occurrences.length,
        status_events: bundle.statusEvents.length,
        reminders: bundle.reminderDeliveries.length,
      }),
    },
    async () => {
      const { data, error } = await supabase.rpc("get_export_page_read_bundle", {
        range_start_local_date:
          input.startLocalDate ?? ALL_TIME_START_LOCAL_DATE,
        range_end_local_date: input.endLocalDate,
      });

      if (error) {
        throw error;
      }

      return normalizeExportPageReadBundle(data);
    },
  );
}

function normalizeExportPageReadBundle(value: Json | null): ExportPageReadBundle {
  if (!isJsonObject(value)) {
    throw new Error("Export page read bundle RPC returned an invalid payload.");
  }

  return {
    profile: (value.profile ?? null) as ExportPageProfileRow | null,
    syncState: (value.sync_state ?? null) as ExportPageSyncStateRow | null,
    categories: jsonArray(value.categories, "categories") as ExportPageCategoryRow[],
    behaviors: jsonArray(value.behaviors, "behaviors") as ExportPageBehaviorRow[],
    occurrences: jsonArray(value.occurrences, "occurrences") as ExportPageOccurrenceRow[],
    statusEvents: jsonArray(
      value.status_events,
      "status_events",
    ) as ExportPageStatusEventRow[],
    reminderDeliveries: jsonArray(
      value.reminder_deliveries,
      "reminder_deliveries",
    ) as ExportPageReminderDeliveryRow[],
  };
}

function jsonArray(value: Json | undefined, label: string): Json[] {
  if (Array.isArray(value)) {
    return value;
  }

  throw new Error(`Export page read bundle is missing ${label}.`);
}

function isJsonObject(value: Json | null): value is { [key: string]: Json | undefined } {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export async function readExportPageSummary(
  supabase: AppSupabaseClient,
  input: { startLocalDate: string | null; endLocalDate: string; includeArchived: boolean; includeTimeTracking: boolean; throughStartedAt: string },
): Promise<ExportSummaryCounts> {
  const { data, error } = await supabase.rpc("get_export_page_summary", {
    range_start_local_date: input.startLocalDate ?? ALL_TIME_START_LOCAL_DATE,
    range_end_local_date: input.endLocalDate,
    include_archived: input.includeArchived,
    include_time_tracking: input.includeTimeTracking,
    through_started_at: input.throughStartedAt,
  });
  if (error) throw error;
  const fields = ["behavior_count", "completed_count", "not_completed_count", "unresolved_count", "time_session_count"];
  if (!isJsonObject(data) || fields.some((key) =>
    typeof data[key] !== "number" || !Number.isSafeInteger(data[key]) || (data[key] as number) < 0)) {
    throw new Error("Export summary returned invalid counts.");
  }
  return data as unknown as ExportSummaryCounts;
}
