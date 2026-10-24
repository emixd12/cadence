import type { BehaviorWhereKind } from "./behavior";
import type { Json } from "./json";

export const BEHAVIOR_CONFIGURATION_CHANGED_FIELDS = [
  "category_id",
  "location_text",
  "where_kind",
  "schedule_graph",
  "browser_reminder_enabled",
  "email_reminder_enabled",
  "reminder_offset_minutes",
  "active",
  "timezone",
] as const;

export type BehaviorConfigurationChangedField =
  (typeof BEHAVIOR_CONFIGURATION_CHANGED_FIELDS)[number];

export type BehaviorConfigurationEventSource = "manual" | "import" | "system";

export type BehaviorConfigurationTimeEntry = {
  id?: string | null;
  kind: string;
  preset: string | null;
  startTime: string;
  endTime: string | null;
  sortOrder: number;
};

export type BehaviorConfigurationSchedule = {
  id?: string | null;
  recurrenceRule: Json;
  sortOrder: number;
  timeEntries: BehaviorConfigurationTimeEntry[];
};

export type BehaviorConfigurationSnapshot = {
  categoryId: string | null;
  locationText?: string | null;
  /** Absent in snapshots written before Ticket 215; normalization derives it. */
  whereKind?: BehaviorWhereKind | null;
  scheduleGraph: BehaviorConfigurationSchedule[];
  browserReminderEnabled: boolean;
  emailReminderEnabled: boolean;
  reminderOffsetMinutes: number;
  active: boolean;
  timezone: string;
};

export type BehaviorConfigurationEventPlan = {
  eventKind: "baseline" | "revision";
  previousConfiguration: BehaviorConfigurationSnapshot | null;
  nextConfiguration: BehaviorConfigurationSnapshot;
  changedFields: BehaviorConfigurationChangedField[];
  recordedAt: string;
  effectiveAt: string;
  effectiveLocalDate: string;
  timezone: string;
  source: BehaviorConfigurationEventSource;
  reasonCode: string;
};
