import type { RecurrenceRule } from "./recurrence";
import type { ArchiveNote, BehaviorWhereKind } from "./behavior";
import type { PortabilityNoteRow, PortabilityInterventionRow, PortabilityImportRunRow, PortabilityMappingRow } from "./portability-rows";

export type ExportImportedHistory = {
  importedNotes?: PortabilityNoteRow[];
  importedInterventions?: PortabilityInterventionRow[];
  importRuns?: PortabilityImportRunRow[];
  importMappings?: PortabilityMappingRow[];
};
import type {
  BehaviorDefinitionChangedField,
  BehaviorDefinitionEventSource,
} from "./behavior-definition-event";
import type {
  BehaviorConfigurationChangedField,
  BehaviorConfigurationEventSource,
} from "./behavior-configuration-event";
import type {
  BehaviorScheduleView,
  ScheduleKind,
  ScheduleSlotView,
  TimeRangePreset,
} from "./schedule";

export type ExportOccurrenceStatus =
  | "unresolved"
  | "completed"
  | "not_completed";
export type ExportReminderDeliveryChannel = "browser_push" | "email";
export type ExportReminderDeliveryStatus =
  | "pending"
  | "sent"
  | "failed"
  | "cancelled";

export type ExportNativeReminderInput = {
  id: string;
  occurrenceId: string;
  requestId: string;
  fireAt: string;
  status: "planned" | "scheduled" | "cancelled" | "failed" | "delivered";
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ExportRangeKey = "7" | "30" | "90" | "all";

export type ExportRangeOption = {
  key: ExportRangeKey;
  label: string;
};

export type ExportProfileInput = {
  timezone: string;
  subjectId: string;
  locale?: string;
  producerName?: string;
  producerVersion?: string;
  reminderChannel?: "browser_push" | "other";
};

export type ExportCategoryInput = {
  description?: string | null;
  id: string;
  name: string;
  sortOrder: number;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type ExportBehaviorInput = {
  id: string;
  categoryId: string | null;
  categoryName: string | null;
  title: string;
  description: string | null;
  whereKind?: BehaviorWhereKind | null;
  locationText?: string | null;
  recurrenceRule: RecurrenceRule;
  scheduledTime: string;
  schedules?: BehaviorScheduleView[];
  scheduleSlots: ScheduleSlotView[];
  timezone: string;
  browserReminderEnabled: boolean;
  emailReminderEnabled: boolean;
  reminderOffsetMinutes: number;
  active: boolean;
  archivedAt: string | null;
  archiveNotes?: ArchiveNote[];
  defaultDurationMinutes?: number | null;
  endDate?: string | null;
  autoArchivedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type ExportBehaviorDefinitionEventInput = {
  id: string;
  behaviorId: string;
  previousTitle: string | null;
  nextTitle: string;
  previousDescription: string | null;
  nextDescription: string | null;
  changedFields: BehaviorDefinitionChangedField[];
  recordedAt: string;
  source: BehaviorDefinitionEventSource;
  reason: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type ExportBehaviorConfigurationTimeEntry = {
  kind: ScheduleKind;
  preset: TimeRangePreset | null;
  startTime: string;
  endTime: string | null;
  sortOrder: number;
};

export type ExportBehaviorConfigurationSchedule = {
  recurrenceRule: RecurrenceRule;
  sortOrder: number;
  timeEntries: ExportBehaviorConfigurationTimeEntry[];
};

export type ExportBehaviorConfigurationSnapshot = {
  categoryId: string | null;
  locationText?: string | null;
  whereKind?: BehaviorWhereKind | null;
  scheduleGraph: ExportBehaviorConfigurationSchedule[];
  browserReminderEnabled: boolean;
  emailReminderEnabled: boolean;
  reminderOffsetMinutes: number;
  active: boolean;
  timezone: string;
};

export type ExportBehaviorConfigurationEventInput = {
  id: string;
  behaviorId: string;
  eventKind: "baseline" | "revision";
  previousConfiguration: ExportBehaviorConfigurationSnapshot | null;
  nextConfiguration: ExportBehaviorConfigurationSnapshot;
  changedFields: BehaviorConfigurationChangedField[];
  recordedAt: string;
  effectiveAt: string;
  effectiveLocalDate: string;
  timezone: string;
  source: BehaviorConfigurationEventSource;
  reasonCode: string;
  createdAt?: string | null;
};

export type ExportOccurrenceInput = {
  id: string;
  behaviorId: string;
  behaviorScheduleSlotId: string | null;
  behaviorConfigurationEventId?: string | null;
  timezone?: string;
  scheduledFor: string;
  scheduledTimeLabel: string;
  scheduleKind: ScheduleKind;
  schedulePreset: TimeRangePreset | null;
  scheduleStartTime: string;
  scheduleEndTime: string | null;
  localDate: string;
  status: ExportOccurrenceStatus;
  completedAt: string | null;
  statusMarkedAt: string | null;
  note: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type ExportStatusEventInput = {
  id: string;
  occurrenceId: string;
  behaviorId: string;
  previousStatus: ExportOccurrenceStatus | null;
  status: ExportOccurrenceStatus;
  statusSemantics:
    | "explicit_user_mark"
    | "explicit_user_correction"
    | "imported_explicit"
    | "system_rule_declared"
    | "ambiguous_import";
  recordedAt: string;
  effectiveAt: string | null;
  localDate: string;
  timezone: string;
  sourceCaptureMethod:
    | "manual_tap"
    | "manual_text"
    | "system_generated"
    | "imported"
    | "inferred"
    | "derived"
    | "ai_generated"
    | "unknown";
  sourceConfidence: "high" | "medium" | "low" | "ambiguous" | "unknown";
  revisesEventId: string | null;
  reasonCode: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type ExportReminderDeliveryInput = {
  id: string;
  occurrenceId: string;
  channel: ExportReminderDeliveryChannel;
  scheduledSendAt: string;
  sentAt: string | null;
  status: ExportReminderDeliveryStatus;
  error: string | null;
  processingStartedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type ExportTimeSessionInput = {
  id: string;
  occurrenceId: string;
  behaviorId: string;
  startedAt: string;
  stoppedAt: string | null;
};

export type ExportJsonTimeSession = {
  id: string;
  occurrence_id: string;
  behavior_id: string;
  started_at: string;
  stopped_at: string | null;
  duration_seconds: number | null;
};

export type ExportDateRange = {
  key: ExportRangeKey;
  label: string;
  startLocalDate: string | null;
  endLocalDate: string;
  summaryLabel: string;
};

export type ExportStatusCounts = {
  completedCount: number;
  notCompletedCount: number;
  unresolvedCount: number;
  resolvedCount: number;
  totalCount: number;
};

export type ExportJsonBackup = {
  exported_at: string;
  profile: {
    timezone: string;
  };
  categories: ExportJsonCategory[];
  behaviors: ExportJsonBehavior[];
  occurrences: ExportJsonOccurrence[];
  status_events: ExportJsonStatusEvent[];
  behavior_definition_events: ExportJsonBehaviorDefinitionEvent[];
  behavior_configuration_events: ExportJsonBehaviorConfigurationEvent[];
  time_sessions?: ExportJsonTimeSession[];
};

export type ExportJsonCategory = {
  description?: string | null;
  id: string;
  name: string;
  sort_order: number;
  created_at?: string | null;
  updated_at?: string | null;
};

export type ExportJsonBehavior = {
  id: string;
  category_id: string | null;
  category: string | null;
  title: string;
  description: string | null;
  where_kind: BehaviorWhereKind | null;
  location_text: string | null;
  recurrence_rule: RecurrenceRule;
  scheduled_time: string;
  schedules: BehaviorScheduleView[];
  schedule_slots: ScheduleSlotView[];
  timezone: string;
  browser_reminder_enabled: boolean;
  email_reminder_enabled: boolean;
  reminder_offset_minutes: number;
  active: boolean;
  archived_at: string | null;
  archive_notes?: Array<{
    id: string;
    archived_at: string;
    note: string | null;
    updated_at: string;
  }>;
  default_duration_minutes?: number | null;
  end_date?: string | null;
  auto_archived_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type ExportJsonOccurrence = {
  id: string;
  behavior_id: string;
  behavior_schedule_slot_id: string | null;
  behavior_configuration_event_id: string | null;
  behavior_title: string;
  category: string | null;
  scheduled_for: string;
  schedule: string;
  schedule_kind: ScheduleKind;
  schedule_preset: TimeRangePreset | null;
  schedule_start_time: string;
  schedule_end_time: string | null;
  local_date: string;
  timezone: string;
  status: ExportOccurrenceStatus;
  completed_at: string | null;
  status_marked_at: string | null;
  note: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type ExportJsonStatusEvent = {
  id: string;
  occurrence_id: string;
  behavior_id: string;
  previous_status: ExportOccurrenceStatus | null;
  status: ExportOccurrenceStatus;
  status_semantics: ExportStatusEventInput["statusSemantics"];
  recorded_at: string;
  effective_at: string | null;
  local_date: string;
  timezone: string;
  source_capture_method: ExportStatusEventInput["sourceCaptureMethod"];
  source_confidence: ExportStatusEventInput["sourceConfidence"];
  revises_event_id: string | null;
  reason_code: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type ExportJsonBehaviorDefinitionEvent = {
  id: string;
  behavior_id: string;
  previous_title: string | null;
  next_title: string;
  previous_description: string | null;
  next_description: string | null;
  changed_fields: BehaviorDefinitionChangedField[];
  recorded_at: string;
  source: BehaviorDefinitionEventSource;
  reason: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type ExportJsonBehaviorConfigurationSnapshot = {
  category_id: string | null;
  location_text: string | null;
  where_kind: BehaviorWhereKind | null;
  schedule_graph: Array<{
    recurrence_rule: RecurrenceRule;
    sort_order: number;
    time_entries: Array<{
      kind: ScheduleKind;
      preset: TimeRangePreset | null;
      start_time: string;
      end_time: string | null;
      sort_order: number;
    }>;
  }>;
  browser_reminder_enabled: boolean;
  email_reminder_enabled: boolean;
  reminder_offset_minutes: number;
  active: boolean;
  timezone: string;
};

export type ExportJsonBehaviorConfigurationEvent = {
  id: string;
  behavior_id: string;
  event_kind: "baseline" | "revision";
  previous_configuration: ExportJsonBehaviorConfigurationSnapshot | null;
  next_configuration: ExportJsonBehaviorConfigurationSnapshot;
  changed_fields: BehaviorConfigurationChangedField[];
  recorded_at: string;
  effective_at: string;
  effective_local_date: string;
  timezone: string;
  source: BehaviorConfigurationEventSource;
  reason_code: string;
  created_at?: string | null;
};

export type BehaviorLogFile = {
  path: string;
  mediaType: string;
  content: string;
};

export type BehaviorLogBundle = {
  fileName: string;
  files: BehaviorLogFile[];
};

export type ExportBundle = {
  timezone: string;
  exportedAt: string;
  includeArchived: boolean;
  includeNotes?: boolean;
  includeTimeTracking: boolean;
  range: ExportDateRange;
  rangeOptions: ExportRangeOption[];
  categoryCount: number;
  behaviorCount: number;
  occurrenceCount: number;
  behaviorConfigurationEventCount: number;
  timeSessionCount?: number;
  overallCounts: ExportStatusCounts;
  overallAdherenceLabel: string;
  jsonl: string;
  csv: string;
  jsonBackup: ExportJsonBackup;
  json: string;
  markdownSummary: string;
  fileBaseName: string;
  markdownFileName: string;
  behaviorLog: BehaviorLogBundle;
};

export type ExportPageData = Pick<ExportBundle,
  "timezone" | "includeArchived" | "includeNotes" | "includeTimeTracking" |
  "range" | "rangeOptions" | "behaviorCount" | "occurrenceCount" |
  "timeSessionCount" | "overallAdherenceLabel"
> & Partial<Pick<ExportBundle, "markdownSummary" | "markdownFileName">>;

export type ExportSummaryCounts = {
  behavior_count: number;
  completed_count: number;
  not_completed_count: number;
  unresolved_count: number;
  time_session_count: number;
};
