import type { OccurrenceOrigin, OccurrenceStatus, OpportunityAddedBy } from "./database";
import type { BehaviorConfigurationSnapshot } from "./behavior-configuration-event";
import type { Json } from "./json";
import type { ArchiveNote } from "./behavior";

export type BehaviorLogPortabilityData = {
  version: 1;
  categories?: {id: string; name: string; description?: string | null; sort_order: number; created_at?: string; updated_at?: string}[];
  configurationEvents: { [key: string]: Json | undefined }[];
  occurrences: { externalId: string; behaviorExternalId: string; timezone: string;
    scheduledForUtc: string; localDate: string; configurationEventId: string | null }[];
  scheduleIdentities?: { externalId: string; behaviorExternalId: string; fingerprint: string }[];
};

export type BehaviorLogImportRecordType =
  | "behavior"
  | "schedule"
  | "occurrence"
  | "status_event"
  | "behavior_definition_event"
  | "time_session"
  | "note"
  | "intervention";

export type BehaviorLogImportMode =
  | "preview_only"
  | "create_missing_only"
  | "merge_preview"
  | "merge_by_user_approved_plan"
  | "restore_preview"
  | "restore_apply";

export type BehaviorLogImportRunStatus =
  | "previewed"
  | "applied"
  | "failed"
  | "cancelled";

export type BehaviorLogImportFile = {
  path: string;
  content: string;
  mediaType?: string | null;
};

export type BehaviorLogImportSeverity = "error" | "warning";

export type BehaviorLogImportIssue = {
  severity: BehaviorLogImportSeverity;
  code: string;
  message: string;
  file?: string;
  row?: number;
  path?: string;
};

export type BehaviorLogUnsupportedField = {
  file: string;
  row: number;
  recordType: string;
  recordId: string | null;
  fields: string[];
};

export type BehaviorLogImportConflict = {
  code: string;
  message: string;
  importedRecordType: BehaviorLogImportRecordType;
  importedId: string;
  existingId?: string;
  localDate?: string;
  timezone?: string;
};

export type BehaviorLogImportPlanAction = "create" | "skip";

export type BehaviorLogSourceConfidence =
  | "high"
  | "medium"
  | "low"
  | "ambiguous"
  | "unknown";

export type BehaviorLogSourceCaptureMethod =
  | "manual_tap"
  | "manual_text"
  | "system_generated"
  | "imported"
  | "inferred"
  | "derived"
  | "ai_generated"
  | "unknown";

export type BehaviorLogNoteSensitivity =
  | "low"
  | "medium"
  | "high"
  | "restricted";

// Passive history accepts the standard channels, independent of operational cue support.
export const BEHAVIORLOG_INTERVENTION_CHANNELS = ["browser_push", "email", "sms", "mobile_push", "in_app",
  "calendar_notification", "voice_assistant", "webhook", "other", "none"] as const;
export type BehaviorLogInterventionChannel = typeof BEHAVIORLOG_INTERVENTION_CHANNELS[number];
// Canonical `planned` is stored as legacy `pending`; observation states retain their meaning.
export const BEHAVIORLOG_INTERVENTION_DELIVERY_STATUSES = ["pending", "sent", "delivered", "failed", "cancelled",
  "suppressed", "unknown"] as const;
export type BehaviorLogInterventionDeliveryStatus = typeof BEHAVIORLOG_INTERVENTION_DELIVERY_STATUSES[number];

export type BehaviorLogImportInterventionStorageDecision = {
  decision: "store_passive_history";
  storedFields: string[];
  droppedSensitiveFields: string[];
  redactedFields: string[];
  rawMessageBodyStored: false;
  rawEndpointStored: false;
  recipientIdentifiersStored: false;
  reminderDeliverySideEffects: false;
  providerSideEffects: false;
};

export type BehaviorLogStatusSemantics =
  | "explicit_user_mark"
  | "explicit_user_correction"
  | "imported_explicit"
  | "system_rule_declared"
  | "ambiguous_import";

export type BehaviorLogExistingBehavior = {
  id: string;
  rowUpdatedAtUtc?: string | null;
  title: string;
  description?: string | null;
  category?: string | null;
  cadenceCategoryName?: string | null;
  active?: boolean | null;
  archivedAt?: string | null;
  archiveNotes?: ArchiveNote[];
  defaultDurationMinutes?: number | null;
  run?: BehaviorLogImportBehaviorRun;
  autoArchivedAt?: string | null;
  /** Behaviors of Opportunity. Absent means not an opportunity Behavior. */
  isOpportunity?: boolean;
  /** D33 alongside answer (null: unanswered). Present only when the caller reads alongside (Ticket 364). */
  alongside?: boolean | null;
  /** Sub-behavior link (depth 1). Absent reads as standalone. */
  parentBehaviorId?: string | null;
  subBehaviorSortOrder?: number;
  inheritParentSchedule?: boolean;
  sourceOriginalId?: string | null;
  schedules?: BehaviorLogExistingSchedule[];
  configurationSnapshot?: BehaviorConfigurationSnapshot;
};

export type BehaviorLogExistingSchedule = {
  id: string;
  rowUpdatedAtUtc?: string | null;
  behaviorId: string;
  recurrenceProfile: string;
  recurrence: Record<string, unknown>;
  timezone: string;
  localTime: string | null;
  windowStartLocal: string | null;
  windowEndLocal: string | null;
  cadenceScheduleKind?: "exact" | "range" | null;
  cadenceSchedulePreset?: "morning" | "afternoon" | "evening" | "night" | null;
  activeFromLocalDate: string;
  anchorLocalDate?: string | null;
  activeUntilLocalDate: string | null;
  sourceOriginalId?: string | null;
  acceptedSourceIdentities?: string[];
};

export type BehaviorLogExistingOccurrence = {
  id: string;
  rowUpdatedAtUtc?: string | null;
  behaviorId: string;
  scheduleId?: string | null;
  behaviorTitle?: string | null;
  scheduledForUtc: string;
  localDate: string;
  timezone: string;
  status: OccurrenceStatus;
  note?: string | null;
  /** Behaviors of Opportunity. Missing means "scheduled". */
  origin?: OccurrenceOrigin;
  addedBy?: OpportunityAddedBy | null;
  sourceOriginalId?: string | null;
  scheduleSnapshot?: {
    kind: "exact" | "range";
    preset: "morning" | "afternoon" | "evening" | "night" | null;
    startTime: string;
    endTime: string | null;
  };
};

export type BehaviorLogExistingStatusEvent = {
  id: string;
  rowUpdatedAtUtc?: string | null;
  occurrenceId: string;
  behaviorId: string;
  recordedAtUtc: string;
  status: OccurrenceStatus;
  statusSemantics?: BehaviorLogStatusSemantics | null;
  sourceCaptureMethod?: BehaviorLogSourceCaptureMethod | null;
  sourceConfidence?: BehaviorLogSourceConfidence | null;
  revisesEventId?: string | null;
  sourceOriginalId?: string | null;
};

export type BehaviorLogExistingImportedNote = {
  id: string;
  rowUpdatedAtUtc?: string | null;
  importRunId: string;
  externalId: string;
  targetType: "behavior" | "occurrence" | "status_event" | "review";
  targetExternalId: string;
  targetLocalId: string | null;
  bodyMarkdown: string;
  noteRole: "user" | "imported" | "system" | "ai_generated";
  sensitivity: BehaviorLogNoteSensitivity | null;
  sourceOriginalId?: string | null;
  sourceCaptureMethod: BehaviorLogSourceCaptureMethod;
  sourceConfidence: BehaviorLogSourceConfidence;
  createdAtUtc: string;
  updatedAtUtc: string | null;
};

export type BehaviorLogExistingImportedIntervention = {
  id: string;
  rowUpdatedAtUtc?: string | null;
  importRunId: string;
  externalId: string;
  behaviorExternalId: string;
  occurrenceExternalId: string;
  behaviorId: string | null;
  occurrenceId: string | null;
  interventionType: string | null;
  channel: BehaviorLogInterventionChannel;
  deliveryStatus: BehaviorLogInterventionDeliveryStatus;
  scheduledSendAtUtc: string;
  sentAtUtc: string | null;
  failureReason: string | null;
  sourceOriginalId?: string | null;
  sourceCaptureMethod: BehaviorLogSourceCaptureMethod;
  sourceConfidence: BehaviorLogSourceConfidence;
};

export type BehaviorLogExistingImportMapping = {
  recordType: BehaviorLogImportRecordType;
  externalId: string;
  localId: string;
};

export type BehaviorLogExistingDefinitionEvent = {
  id: string;
  behaviorId: string;
  recordedAtUtc: string;
  sourceOriginalId?: string | null;
};

export type BehaviorLogExistingTimeSession = {
  id: string;
  occurrenceId: string;
  behaviorId: string;
  startedAtUtc: string;
  stoppedAtUtc: string | null;
  sourceOriginalId?: string | null;
};

export type BehaviorLogExistingRecords = {
  behaviors?: BehaviorLogExistingBehavior[];
  schedules?: BehaviorLogExistingSchedule[];
  occurrences?: BehaviorLogExistingOccurrence[];
  statusEvents?: BehaviorLogExistingStatusEvent[];
  definitionEvents?: BehaviorLogExistingDefinitionEvent[];
  timeSessions?: BehaviorLogExistingTimeSession[];
  importedNotes?: BehaviorLogExistingImportedNote[];
  importedInterventions?: BehaviorLogExistingImportedIntervention[];
  mappings?: BehaviorLogExistingImportMapping[];
};

export type BehaviorLogImportBehaviorPlan = {
  action: BehaviorLogImportPlanAction;
  skipReasons: string[];
  externalId: string;
  title: string;
  category: string;
  cadenceCategoryName: string | null;
  description: string | null;
  createdAtUtc: string | null;
  archivedAtUtc: string | null;
  cadenceArchiveNotes?: ArchiveNote[];
  expectedDurationMinutes?: number | null;
  /** End and pause from `extensions.app.cadence`. Absent when the bundle carries none. */
  cadenceRun?: BehaviorLogImportBehaviorRun;
  cadenceAutoArchivedAt?: string | null;
  /** Behaviors of Opportunity, from `extensions.app.cadence.is_opportunity`. Absent when the bundle carries none. */
  cadenceIsOpportunity?: boolean;
  /**
   * The person's alongside answer (D33, Ticket 364) from `extensions.app.cadence.alongside`:
   * true, false, or null for unanswered. Absent when the bundle carries none or the
   * caller does not read alongside; restore then keeps the stored answer.
   */
  cadenceAlongside?: boolean | null;
  /**
   * Sub-behaviors (depth 1) from `extensions.app.cadence`: the bundle ID of the parent
   * Behavior, sibling order and schedule inheritance. Absent in bundles without them,
   * which import as standalone Behaviors (null, 0, false).
   */
  cadenceParentBehaviorExternalId?: string | null;
  cadenceSubBehaviorSortOrder?: number;
  cadenceInheritParentSchedule?: boolean;
  active?: boolean;
  cadenceActive: boolean | null;
  cadenceBrowserReminderEnabled: boolean | null;
  cadenceEmailReminderEnabled: boolean | null;
  cadenceReminderOffsetMinutes: number | null;
  sourceOriginalId?: string | null;
  sourceConfidence: BehaviorLogSourceConfidence;
};

export type BehaviorLogImportSchedulePlan = {
  action: BehaviorLogImportPlanAction;
  skipReasons: string[];
  externalId: string;
  behaviorExternalId: string;
  recurrenceProfile: string;
  recurrence: Record<string, unknown>;
  timezone: string;
  localTime: string | null;
  windowStartLocal: string | null;
  windowEndLocal: string | null;
  cadenceScheduleKind: "exact" | "range" | null;
  cadenceSchedulePreset: "morning" | "afternoon" | "evening" | "night" | null;
  cadenceBehaviorScheduleId?: string | null;
  cadenceConfigurationEventId?: string | null;
  cadenceImportRole?:
    | "current_configuration"
    | "historical_reference_only"
    | null;
  cadenceHistoricalRecurrence?: "unknown" | null;
  activeFromLocalDate: string;
  anchorLocalDate?: string | null;
  effectiveFromUtc?: string | null;
  effectiveUntilUtc?: string | null;
  activeUntilLocalDate: string | null;
  sourceOriginalId?: string | null;
  sourceConfidence: BehaviorLogSourceConfidence;
};

export type BehaviorLogImportDefinitionEventPlan = {
  action: BehaviorLogImportPlanAction;
  skipReasons: string[];
  externalId: string;
  behaviorExternalId: string;
  eventKind: "baseline" | "revision";
  changedFields: Array<"title" | "description">;
  unsupportedChangedFields: string[];
  previousTitle: string | null;
  nextTitle: string | null;
  previousDescription: string | null;
  nextDescription: string | null;
  recordedAtUtc: string;
  reasonCode: string | null;
  sourceCaptureMethod: BehaviorLogSourceCaptureMethod;
  sourceConfidence: BehaviorLogSourceConfidence;
};

export type BehaviorLogImportTimeSessionPlan = {
  action: BehaviorLogImportPlanAction;
  skipReasons: string[];
  externalId: string;
  occurrenceExternalId: string;
  behaviorExternalId: string;
  startedAtUtc: string;
  stoppedAtUtc: string | null;
  sourceOriginalId?: string | null;
  sourceCaptureMethod: BehaviorLogSourceCaptureMethod;
  sourceConfidence: BehaviorLogSourceConfidence;
};

export type BehaviorLogImportInterventionRulePlan = {
  action: BehaviorLogImportPlanAction;
  skipReasons: string[];
  externalId: string;
  behaviorExternalId: string | null;
  interventionType: string;
  channel: string;
  enabled: boolean;
  offsetMinutes: number | null;
  activeFromLocalDate: string | null;
  activeUntilLocalDate: string | null;
  timezone: string | null;
  sourceOriginalId?: string | null;
  sourceCaptureMethod: BehaviorLogSourceCaptureMethod;
  sourceConfidence: BehaviorLogSourceConfidence;
};

export type BehaviorLogImportOccurrencePlan = {
  action: BehaviorLogImportPlanAction;
  skipReasons: string[];
  importWithDetachedScheduleSnapshot?: boolean;
  externalId: string;
  behaviorExternalId: string;
  scheduleExternalId: string;
  scheduledForUtc: string;
  localDate: string;
  timezone: string;
  localTime: string | null;
  generatedAtUtc: string | null;
  currentStatus: OccurrenceStatus;
  /** Behaviors of Opportunity, from `extensions.app.cadence`. Absent when the bundle carries none. */
  cadenceOrigin?: OccurrenceOrigin;
  cadenceAddedBy?: OpportunityAddedBy | null;
  sourceOriginalId?: string | null;
  sourceConfidence: BehaviorLogSourceConfidence;
};

export type BehaviorLogImportStatusEventPlan = {
  action: BehaviorLogImportPlanAction;
  skipReasons: string[];
  externalId: string;
  occurrenceExternalId: string;
  behaviorExternalId: string;
  previousStatus: OccurrenceStatus | null;
  status: OccurrenceStatus;
  statusSemantics: BehaviorLogStatusSemantics;
  recordedAtUtc: string;
  effectiveAtUtc: string | null;
  localDate: string;
  timezone: string;
  sourceCaptureMethod: BehaviorLogSourceCaptureMethod;
  sourceConfidence: BehaviorLogSourceConfidence;
  revisesEventId: string | null;
  reasonCode: string | null;
  sourceOriginalId?: string | null;
};

export type BehaviorLogImportNotePlan = {
  action: BehaviorLogImportPlanAction;
  skipReasons: string[];
  externalId: string;
  attachedToType: "behavior" | "occurrence" | "status_event" | "review";
  attachedToId: string;
  bodyMarkdown: string;
  noteRole: "user" | "imported" | "system" | "ai_generated";
  createdAtUtc: string;
  updatedAtUtc: string | null;
  sensitivity: BehaviorLogNoteSensitivity | null;
  sourceOriginalId?: string | null;
  sourceCaptureMethod: BehaviorLogSourceCaptureMethod;
  sourceConfidence: BehaviorLogSourceConfidence;
};

export type BehaviorLogImportInterventionPreviewPlan = {
  action: "preview_only";
  previewOnly: true;
  externalId: string;
  behaviorExternalId: string;
  occurrenceExternalId: string;
  interventionType: string | null;
  channel: BehaviorLogInterventionChannel;
  deliveryStatus: BehaviorLogInterventionDeliveryStatus;
  scheduledSendAtUtc: string | null;
  sentAtUtc: string | null;
  failureReason: string | null;
  sourceOriginalId?: string | null;
  sourceCaptureMethod: BehaviorLogSourceCaptureMethod;
  sourceConfidence: BehaviorLogSourceConfidence;
  storageDecision: BehaviorLogImportInterventionStorageDecision;
};

export type BehaviorLogImportPlan = {
  behaviors: BehaviorLogImportBehaviorPlan[];
  schedules: BehaviorLogImportSchedulePlan[];
  occurrences: BehaviorLogImportOccurrencePlan[];
  statusEvents: BehaviorLogImportStatusEventPlan[];
  definitionEvents?: BehaviorLogImportDefinitionEventPlan[];
  timeSessions?: BehaviorLogImportTimeSessionPlan[];
  interventionRules?: BehaviorLogImportInterventionRulePlan[];
  notes: BehaviorLogImportNotePlan[];
  interventions: BehaviorLogImportInterventionPreviewPlan[];
};

export type BehaviorLogImportDayGroup = {
  localDate: string;
  timezone: string;
  occurrenceCount: number;
  statusEventCount: number;
  noteCount: number;
  conflictCount: number;
};

export type BehaviorLogImportInterventionCount = {
  value: string;
  count: number;
};

export type BehaviorLogImportInterventionBehaviorCount = {
  behaviorExternalId: string;
  behaviorTitle: string | null;
  count: number;
};

export type BehaviorLogImportInterventionCounts = {
  byChannel: BehaviorLogImportInterventionCount[];
  byDeliveryStatus: BehaviorLogImportInterventionCount[];
  byBehavior: BehaviorLogImportInterventionBehaviorCount[];
};

export type BehaviorLogImportSummary = {
  schemaVersion: string | null;
  fileCount: number;
  behaviorCount: number;
  scheduleCount: number;
  occurrenceCount: number;
  statusEventCount: number;
  noteCount: number;
  interventionCount: number;
  interventionPreviewOnlyCount: number;
  interventionStoredCount: number;
  interventionSensitiveFieldDropCount: number;
  interventionRedactedFieldCount: number;
  definitionEventCount?: number;
  timeSessionCount?: number;
  interventionRuleCount?: number;
  interventionCounts: BehaviorLogImportInterventionCounts;
  createCount: number;
  skipCount: number;
  errorCount: number;
  warningCount: number;
  conflictCount: number;
  unsupportedFieldCount: number;
  dayGroups: BehaviorLogImportDayGroup[];
};

export type BehaviorLogImportPreview = {
  portability?: BehaviorLogPortabilityData;
  valid: boolean;
  summary: BehaviorLogImportSummary;
  errors: BehaviorLogImportIssue[];
  warnings: BehaviorLogImportIssue[];
  conflicts: BehaviorLogImportConflict[];
  unsupportedFields: BehaviorLogUnsupportedField[];
  plan: BehaviorLogImportPlan;
  mergePreview?: BehaviorLogImportMergePreview;
};

export type BehaviorLogImportMergeAction =
  | "create_new"
  | "map_to_existing"
  | "skip_existing"
  | "conflict_requires_decision";

export type BehaviorLogImportMergeRecordAction = {
  recordType: BehaviorLogImportRecordType;
  externalId: string;
  action: BehaviorLogImportMergeAction;
  localId: string | null;
  conflictCodes: string[];
  reasons: string[];
  relatedExternalIds?: Record<string, string | null>;
  metadata?: Record<string, unknown>;
};

export type BehaviorLogImportMergeConflict = {
  code: string;
  reason: string;
  importedRecordType: BehaviorLogImportRecordType;
  importedId: string;
  existingId?: string | null;
  localDate?: string;
  timezone?: string;
};

export type BehaviorLogImportPrivacySummary = {
  profiles: string[];
  redactionLevel: string | null;
  subjectIdStrategy: string | null;
  containsNotes: boolean;
  containsInterventions: boolean;
  containsRawLocation: boolean | null;
  containsHealthData: boolean | null;
  containsAiGeneratedContent: boolean | null;
};

export type BehaviorLogImportMergePreview = {
  mode: "merge_preview";
  privacy: BehaviorLogImportPrivacySummary;
  semantics: {
    jsonlAuthoritative: true;
    csvIgnoredForMerge: true;
    statusEventsAuthoritative: true;
    unresolvedIsFailure: false;
    appendOnlyStatusEvents: true;
  };
  actionCounts: Record<BehaviorLogImportMergeAction, number>;
  conflictCodes: string[];
  conflictCount: number;
  conflicts: BehaviorLogImportMergeConflict[];
  actions: {
    behaviors: BehaviorLogImportMergeRecordAction[];
    schedules: BehaviorLogImportMergeRecordAction[];
    occurrences: BehaviorLogImportMergeRecordAction[];
    statusEvents: BehaviorLogImportMergeRecordAction[];
    definitionEvents?: BehaviorLogImportMergeRecordAction[];
    timeSessions?: BehaviorLogImportMergeRecordAction[];
    notes: BehaviorLogImportMergeRecordAction[];
    interventions: BehaviorLogImportMergeRecordAction[];
  };
};

export type BehaviorLogImportPreviewBinding = {
  bundleFingerprint: string;
  localDataFingerprint: string;
  previewFingerprint: string;
};

export type BehaviorLogImportMergePreviewResult = BehaviorLogImportPreview & {
  mergePreview: BehaviorLogImportMergePreview;
} &
  BehaviorLogImportPreviewBinding;

export type BehaviorLogImportRunCreateInput = {
  userId: string;
  bundleFormat: string;
  schemaVersion: string | null;
  manifestSha256: string | null;
  bundleFingerprint: string | null;
  producerName: string | null;
  producerVersion: string | null;
  subjectIdStrategy: string | null;
  privacyRedactionLevel: string | null;
  importMode: BehaviorLogImportMode;
  acceptedPreviewRunId?: string | null;
  acceptedPreviewFingerprint?: string | null;
  dryRunSummary: Record<string, unknown>;
  status?: BehaviorLogImportRunStatus;
  failureMessage?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
};

export type BehaviorLogImportRunStatusUpdateInput = {
  userId: string;
  importRunId: string;
  status: BehaviorLogImportRunStatus;
  failureMessage?: string | null;
  completedAt?: string | null;
};

export type BehaviorLogImportRecordMappingInput = {
  userId: string;
  importRunId: string;
  recordType: BehaviorLogImportRecordType;
  externalId: string;
  localId: string;
};

/** A Behavior's end and pause in stored form (docs/RECURRENCE_RULES.md, "Behavior end and pause"). */
export type BehaviorLogImportBehaviorRun = {
  endOn: string | null;
  endTime: string | null;
  pauseFromOn: string | null;
  pauseFromTime: string | null;
  pauseBackOn: string | null;
};
