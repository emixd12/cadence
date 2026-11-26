import { sha256 } from "../hash";
import { findSubBehaviorGraphViolations } from "./sub-behavior.resolver";

import type {
  BehaviorLogExistingRecords,
  BehaviorLogExistingSchedule,
  BehaviorLogImportBehaviorPlan,
  BehaviorLogImportDefinitionEventPlan,
  BehaviorLogImportInterventionRulePlan,
  BehaviorLogImportInterventionPreviewPlan,
  BehaviorLogImportIssue,
  BehaviorLogImportNotePlan,
  BehaviorLogImportOccurrencePlan,
  BehaviorLogImportRecordType,
  BehaviorLogImportSchedulePlan,
  BehaviorLogImportStatusEventPlan,
  BehaviorLogImportTimeSessionPlan,
} from "../types/behaviorlog-import";
import type {
  BehaviorLogRestoreAction,
  BehaviorLogRestoreActionKind,
  BehaviorLogRestorePreview,
  BehaviorLogRestoreRecordType,
  BehaviorLogRestoreStatusHistoryPolicy,
  ResolveBehaviorLogRestorePreviewInput,
} from "../types/behaviorlog-restore";

const RESTORE_ACTION_KINDS: BehaviorLogRestoreActionKind[] = [
  "create",
  "replace",
  "archive",
  "delete",
  "keep",
  "skip",
];

const NON_RESTORABLE_FIELDS = [
  {
    field: "auth_identity",
    reason: "Google/Supabase auth identity is owned by the account provider, not BehaviorLog.",
  },
  {
    field: "profile_email",
    reason: "Profile email comes from the authenticated account and is not restored from behavior data.",
  },
  {
    field: "browser_permissions",
    reason: "Browser notification permissions are controlled by the browser and origin.",
  },
  {
    field: "push_subscriptions",
    reason: "Push subscriptions include browser/device transport details that BehaviorLog does not restore.",
  },
  {
    field: "provider_accounts",
    reason: "Email, browser notification, and other provider accounts or secrets are external state.",
  },
  {
    field: "external_provider_state",
    reason: "Sent provider messages, delivery queues, secrets, and remote provider records are not account data in BehaviorLog.",
  },
] as const;

type RestoreContext = {
  existing: Required<BehaviorLogExistingRecords>;
  matched: {
    behaviors: Set<string>;
    schedules: Set<string>;
    occurrences: Set<string>;
    statusEvents: Set<string>;
    definitionEvents: Set<string>;
    timeSessions: Set<string>;
    importedNotes: Set<string>;
    importedInterventions: Set<string>;
  };
  mapBehaviorExternalToLocal: Map<string, string>;
  mapScheduleExternalToLocal: Map<string, string>;
  mapOccurrenceExternalToLocal: Map<string, string>;
  mapStatusEventExternalToLocal: Map<string, string>;
  mapDefinitionEventExternalToLocal: Map<string, string>;
  mapTimeSessionExternalToLocal: Map<string, string>;
  restoreWarnings: BehaviorLogImportIssue[];
};

export function resolveBehaviorLogRestorePreview(
  input: ResolveBehaviorLogRestorePreviewInput,
): BehaviorLogRestorePreview {
  const statusHistoryPolicy =
    input.statusHistoryPolicy ?? "preserve_append_only_history";
  const context = buildContext(input.existing);
  const importedNoteByOccurrence = new Map<string, BehaviorLogImportNotePlan>();

  for (const note of input.importPreview.plan.notes) {
    if (
      note.action !== "skip" &&
      note.noteRole !== "ai_generated" &&
      note.attachedToType === "occurrence" &&
      !importedNoteByOccurrence.has(note.attachedToId)
    ) {
      importedNoteByOccurrence.set(note.attachedToId, note);
    }
  }

  const behaviorActions = input.importPreview.plan.behaviors.map((behavior) =>
    actionForBehavior(behavior, context),
  );
  const scheduleActions = input.importPreview.plan.schedules.map((schedule) =>
    actionForSchedule(schedule, context),
  );
  const occurrenceActions = input.importPreview.plan.occurrences.map(
    (occurrence) => actionForOccurrence(occurrence, context),
  );
  const statusEventActions = input.importPreview.plan.statusEvents.map((event) =>
    actionForStatusEvent(event, context, statusHistoryPolicy),
  );
  const definitionEventActions = (
    input.importPreview.plan.definitionEvents ?? []
  ).map((event) => actionForDefinitionEvent(event, context));
  const timeSessionActions = (input.importPreview.plan.timeSessions ?? []).map(
    (session) => actionForTimeSession(session, context),
  );
  const interventionRuleActions = (
    input.importPreview.plan.interventionRules ?? []
  ).map((rule) => actionForInterventionRule(rule, context));
  const inlineOccurrenceNoteActions = [
    ...input.importPreview.plan.notes.map((note) =>
      actionForInlineOccurrenceNote(note, context),
    ),
    ...actionsForDeletedInlineOccurrenceNotes({
      context,
      importedNoteByOccurrence,
    }),
  ];
  const importedNoteActions = [
    ...input.importPreview.plan.notes.map((note) =>
      actionForImportedNote(note, context),
    ),
    ...actionsForDeletedImportedNotes(context),
  ];
  const importedInterventionActions = [
    ...input.importPreview.plan.interventions.map((intervention) =>
      actionForImportedIntervention(intervention, context),
    ),
    ...actionsForDeletedImportedInterventions(context),
  ];

  const actions = {
    behaviors: [
      ...behaviorActions,
      ...actionsForArchivedBehaviors(context),
    ].sort(compareActions),
    schedules: [
      ...scheduleActions,
      ...actionsForDeletedSchedules(context),
    ].sort(compareActions),
    occurrences: [
      ...occurrenceActions,
      ...actionsForDeletedOccurrences(context),
    ].sort(compareActions),
    statusEvents: [
      ...statusEventActions,
      ...actionsForUnmatchedStatusEvents(context, statusHistoryPolicy),
    ].sort(compareActions),
    definitionEvents: definitionEventActions.sort(compareActions),
    timeSessions: timeSessionActions.sort(compareActions),
    interventionRules: interventionRuleActions.sort(compareActions),
    inlineOccurrenceNotes: inlineOccurrenceNoteActions.sort(compareActions),
    importedNotes: importedNoteActions.sort(compareActions),
    importedInterventions: importedInterventionActions.sort(compareActions),
  };
  const linkErrors = restoredSubBehaviorGraphErrors(input.importPreview.plan.behaviors, context);
  const allActions = flattenActions(actions);
  const summary = summarizeActions(allActions, input.importPreview.plan.notes);
  const bundleFingerprint = sha256(
    stableStringify({
      schemaVersion: input.importPreview.summary.schemaVersion,
      plan: input.importPreview.plan,
    }),
  );
  const localDataFingerprint = sha256(stableStringify(context.existing));
  const previewFingerprint = sha256(
    stableStringify({
      bundleFingerprint,
      localDataFingerprint,
      statusHistoryPolicy,
      actions,
      semanticsVersion: 1,
    }),
  );
  const redactedInterventionFieldCount =
    input.importPreview.summary.interventionSensitiveFieldDropCount +
    input.importPreview.summary.interventionRedactedFieldCount;
  const noteSensitivities = Array.from(
    new Set(
      input.importPreview.plan.notes
        .map((note) => note.sensitivity)
        .filter(
          (sensitivity): sensitivity is NonNullable<typeof sensitivity> =>
            Boolean(sensitivity),
        ),
    ),
  ).sort();
  const restoreWarnings = [...context.restoreWarnings];

  if (statusHistoryPolicy === "replace_status_history") {
    restoreWarnings.push({
      severity: "warning",
      code: "status_history_replacement_preview_only",
      message:
        "Replacing status history is previewed as a future policy only; restore apply is not implemented in this ticket.",
    });
  }

  return {
    mode: "restore_preview",
    valid: input.importPreview.valid && summary.unsupportedActionCount === 0 && linkErrors.length === 0,
    previewFingerprint,
    localDataFingerprint,
    bundleFingerprint,
    statusHistoryPolicy: {
      selected: statusHistoryPolicy,
      default: "preserve_append_only_history",
      available: ["preserve_append_only_history", "replace_status_history"],
      applySupportedInThisTicket:
        statusHistoryPolicy === "preserve_append_only_history",
    },
    semantics: {
      jsonlAuthoritative: true,
      csvIgnoredForRestore: true,
      statusEventsAuthoritative: true,
      currentStatusIsSnapshotOnly: true,
      unresolvedIsFailure: false,
      behaviorLogIsNotAccountImage: true,
      providerSideEffects: false,
      reminderDeliverySideEffects: false,
    },
    summary: {
      ...summary,
      redactedInterventionFieldCount,
    },
    nonRestorableFields: NON_RESTORABLE_FIELDS.map((entry) => ({ ...entry })),
    sensitivity: {
      highOrRestrictedNotesPresent: summary.highOrRestrictedNoteCount > 0,
      noteSensitivities,
      redactedInterventionFieldsPresent: redactedInterventionFieldCount > 0,
    },
    errors: [...input.importPreview.errors, ...linkErrors],
    warnings: [...input.importPreview.warnings, ...restoreWarnings],
    actions,
  };
}

function actionForBehavior(
  behavior: BehaviorLogImportBehaviorPlan,
  context: RestoreContext,
): BehaviorLogRestoreAction {
  if (behavior.action === "skip") {
    return skippedAction("behavior", behavior.externalId, behavior.skipReasons);
  }

  const existing = findExisting(
    context.existing.behaviors,
    context.mapBehaviorExternalToLocal.get(behavior.externalId),
    behavior.externalId,
  );

  if (!existing) {
    context.mapBehaviorExternalToLocal.set(behavior.externalId, behavior.externalId);

    return action({
      recordType: "behavior",
      action: "create",
      externalId: behavior.externalId,
      localId: null,
      reasons: ["Behavior exists in the bundle but not in the current account graph."],
      metadata: {
        title: behavior.title,
        description: behavior.description,
        category: behavior.cadenceCategoryName ?? behavior.category,
      },
    });
  }

  context.matched.behaviors.add(existing.id);
  context.mapBehaviorExternalToLocal.set(behavior.externalId, existing.id);

  const importedActive = behavior.archivedAtUtc ? false : true;
  const same =
    normalizeText(existing.title) === normalizeText(behavior.title) &&
    normalizeNullableText(existing.description) ===
      normalizeNullableText(behavior.description) &&
    normalizeNullableText(existing.category) ===
      normalizeNullableText(behavior.cadenceCategoryName ?? behavior.category) &&
    Boolean(existing.active ?? true) === importedActive &&
    sameSubBehaviorLink(behavior, existing, context) &&
    sameAlongside(behavior, existing);

  return action({
    recordType: "behavior",
    action: same ? "keep" : "replace",
    externalId: behavior.externalId,
    localId: existing.id,
    reasons: same
      ? ["Behavior identity and restore-visible fields already match."]
      : ["Behavior is represented in the bundle and local restore-visible fields differ."],
    metadata: {
      title: behavior.title,
      description: behavior.description,
      category: behavior.cadenceCategoryName ?? behavior.category,
    },
  });
}

/**
 * Ticket 364: a different alongside answer makes the Behavior `replace`. A bundle without
 * the key, or local records read without alongside, keeps the stored answer.
 */
function sameAlongside(
  behavior: BehaviorLogImportBehaviorPlan,
  existing: NonNullable<BehaviorLogExistingRecords["behaviors"]>[number],
): boolean {
  if (behavior.cadenceAlongside === undefined || existing.alongside === undefined) return true;
  return behavior.cadenceAlongside === existing.alongside;
}

/** A bundle without link fields keeps the local link, as restore apply does. */
function sameSubBehaviorLink(
  behavior: BehaviorLogImportBehaviorPlan,
  existing: NonNullable<BehaviorLogExistingRecords["behaviors"]>[number],
  context: RestoreContext,
): boolean {
  if (behavior.cadenceParentBehaviorExternalId === undefined) return true;
  const parentId = restoredParentId(behavior, context);
  return parentId === (existing.parentBehaviorId ?? null) &&
    (parentId ? behavior.cadenceSubBehaviorSortOrder ?? 0 : 0) === (existing.parentBehaviorId ? existing.subBehaviorSortOrder ?? 0 : 0) &&
    (parentId ? behavior.cadenceInheritParentSchedule ?? true : false) === (existing.parentBehaviorId ? existing.inheritParentSchedule ?? false : false);
}

function restoredParentId(behavior: BehaviorLogImportBehaviorPlan, context: RestoreContext): string | null {
  const parentExternalId = behavior.cadenceParentBehaviorExternalId;
  return parentExternalId ? context.mapBehaviorExternalToLocal.get(parentExternalId) ?? parentExternalId : null;
}

/**
 * The account after restore must stay one level deep: restored links plus the links of
 * local Behaviors the bundle does not carry (restore archives them and keeps their links).
 */
function restoredSubBehaviorGraphErrors(
  behaviors: readonly BehaviorLogImportBehaviorPlan[],
  context: RestoreContext,
): BehaviorLogImportIssue[] {
  const graph = new Map<string, { id: string; parentBehaviorId: string | null }>();
  for (const existing of context.existing.behaviors) {
    graph.set(existing.id, { id: existing.id, parentBehaviorId: existing.parentBehaviorId ?? null });
  }
  for (const behavior of behaviors) {
    if (behavior.action === "skip") continue;
    const id = context.mapBehaviorExternalToLocal.get(behavior.externalId) ?? behavior.externalId;
    const kept = graph.get(id)?.parentBehaviorId ?? null;
    graph.set(id, {
      id,
      parentBehaviorId: behavior.cadenceParentBehaviorExternalId === undefined ? kept : restoredParentId(behavior, context),
    });
  }
  return findSubBehaviorGraphViolations([...graph.values()])
    .filter((violation) => violation.reason !== "parent_not_found")
    .map((violation) => ({
      severity: "error" as const,
      code: `restore_sub_behavior_${violation.reason}`,
      message: `Restoring would leave Behavior ${violation.behaviorId} ${violation.reason === "self_parent"
        ? "under itself"
        : "under a parent that is itself a sub-behavior"}. Sub-behaviors are one level deep.`,
      path: "extensions.app.cadence.parent_behavior_id",
    }));
}

function actionForSchedule(
  schedule: BehaviorLogImportSchedulePlan,
  context: RestoreContext,
): BehaviorLogRestoreAction {
  if (schedule.action === "skip") {
    if (
      schedule.skipReasons.includes(
        "cadence_historical_schedule_export_only",
      )
    ) {
      return action({
        recordType: "schedule",
        action: "skip",
        externalId: schedule.externalId,
        localId: null,
        reasons: schedule.skipReasons,
        relatedExternalIds: { behavior: schedule.behaviorExternalId },
        metadata: { historicalReferenceOnly: true },
      });
    }

    return skippedAction("schedule", schedule.externalId, schedule.skipReasons);
  }

  const localBehaviorId = context.mapBehaviorExternalToLocal.get(
    schedule.behaviorExternalId,
  );

  if (!localBehaviorId) {
    return skippedAction("schedule", schedule.externalId, [
      "Schedule cannot be restored because its behavior is not safely mapped.",
    ]);
  }

  const existing =
    findExisting(
      context.existing.schedules,
      context.mapScheduleExternalToLocal.get(schedule.externalId),
      schedule.externalId,
    ) ??
    context.existing.schedules.find(
      (candidate) =>
        candidate.behaviorId === localBehaviorId &&
        scheduleShape(candidate) === scheduleShape(schedule),
    );

  if (!existing) {
    context.mapScheduleExternalToLocal.set(schedule.externalId, schedule.externalId);

    return action({
      recordType: "schedule",
      action: "create",
      externalId: schedule.externalId,
      localId: null,
      reasons: ["Schedule exists in the bundle but not in the current account graph."],
      relatedExternalIds: { behavior: schedule.behaviorExternalId },
    });
  }

  context.matched.schedules.add(existing.id);
  context.mapScheduleExternalToLocal.set(schedule.externalId, existing.id);

  const same =
    existing.behaviorId === localBehaviorId &&
    existing.timezone === schedule.timezone &&
    existing.recurrenceProfile === schedule.recurrenceProfile &&
    stableStringify(existing.recurrence) === stableStringify(schedule.recurrence) &&
    scheduleShape(existing) === scheduleShape(schedule);

  return action({
    recordType: "schedule",
    action: same ? "keep" : "replace",
    externalId: schedule.externalId,
    localId: existing.id,
    reasons: same
      ? ["Schedule already matches the bundle."]
      : ["Schedule is represented in the bundle and local recurrence or slot fields differ."],
    relatedExternalIds: { behavior: schedule.behaviorExternalId },
  });
}

function actionForOccurrence(
  occurrence: BehaviorLogImportOccurrencePlan,
  context: RestoreContext,
): BehaviorLogRestoreAction {
  if (occurrence.action === "skip") {
    return skippedAction("occurrence", occurrence.externalId, occurrence.skipReasons);
  }

  const localBehaviorId = context.mapBehaviorExternalToLocal.get(
    occurrence.behaviorExternalId,
  );
  const localScheduleId = context.mapScheduleExternalToLocal.get(
    occurrence.scheduleExternalId,
  );
  const detachedScheduleSnapshot =
    occurrence.importWithDetachedScheduleSnapshot;

  if (!localBehaviorId || (!detachedScheduleSnapshot && !localScheduleId)) {
    return skippedAction("occurrence", occurrence.externalId, [
      "Occurrence cannot be restored because its behavior or schedule is not safely mapped.",
    ]);
  }

  const existing =
    findExisting(
      context.existing.occurrences,
      context.mapOccurrenceExternalToLocal.get(occurrence.externalId),
      occurrence.externalId,
    ) ??
    context.existing.occurrences.find(
      (candidate) =>
        candidate.behaviorId === localBehaviorId &&
        candidate.scheduledForUtc === occurrence.scheduledForUtc,
    );

  if (!existing) {
    context.mapOccurrenceExternalToLocal.set(
      occurrence.externalId,
      occurrence.externalId,
    );

    return action({
      recordType: "occurrence",
      action: "create",
      externalId: occurrence.externalId,
      localId: null,
      reasons: ["Occurrence exists in the bundle but not in the current account graph."],
      relatedExternalIds: {
        behavior: occurrence.behaviorExternalId,
        schedule: occurrence.scheduleExternalId,
      },
    });
  }

  context.matched.occurrences.add(existing.id);
  context.mapOccurrenceExternalToLocal.set(occurrence.externalId, existing.id);

  const same =
    existing.behaviorId === localBehaviorId &&
    existing.scheduleId ===
      (detachedScheduleSnapshot ? null : localScheduleId) &&
    existing.scheduledForUtc === occurrence.scheduledForUtc &&
    existing.localDate === occurrence.localDate &&
    existing.timezone === occurrence.timezone &&
    existing.status === occurrence.currentStatus;

  return action({
    recordType: "occurrence",
    action: same ? "keep" : "replace",
    externalId: occurrence.externalId,
    localId: existing.id,
    reasons: same
      ? ["Occurrence current snapshot already matches the bundle."]
      : [
          "Occurrence is represented in the bundle and local schedule, date, timezone, or current-status snapshot differs.",
        ],
    relatedExternalIds: {
      behavior: occurrence.behaviorExternalId,
      schedule: occurrence.scheduleExternalId,
    },
    metadata: {
      currentStatus: occurrence.currentStatus,
      currentStatusIsSnapshotOnly: true,
    },
  });
}

function actionForStatusEvent(
  event: BehaviorLogImportStatusEventPlan,
  context: RestoreContext,
  policy: BehaviorLogRestoreStatusHistoryPolicy,
): BehaviorLogRestoreAction {
  if (event.action === "skip") {
    return skippedAction("status_event", event.externalId, event.skipReasons);
  }

  const localOccurrenceId = context.mapOccurrenceExternalToLocal.get(
    event.occurrenceExternalId,
  );
  const localBehaviorId = context.mapBehaviorExternalToLocal.get(
    event.behaviorExternalId,
  );

  if (!localOccurrenceId || !localBehaviorId) {
    return skippedAction("status_event", event.externalId, [
      "Status event cannot be restored because its occurrence or behavior is not safely mapped.",
    ]);
  }

  const existing =
    findExisting(
      context.existing.statusEvents,
      context.mapStatusEventExternalToLocal.get(event.externalId),
      event.externalId,
    ) ??
    context.existing.statusEvents.find(
      (candidate) =>
        candidate.occurrenceId === localOccurrenceId &&
        candidate.recordedAtUtc === event.recordedAtUtc &&
        candidate.status === event.status &&
        candidate.statusSemantics === event.statusSemantics,
    );

  if (!existing) {
    context.mapStatusEventExternalToLocal.set(event.externalId, event.externalId);

    return action({
      recordType: "status_event",
      action: "create",
      externalId: event.externalId,
      localId: null,
      reasons: [
        policy === "preserve_append_only_history"
          ? "Imported status event would be appended while preserving existing local history."
          : "Imported status event would be restored as part of a full status-history replacement preview.",
      ],
      relatedExternalIds: {
        behavior: event.behaviorExternalId,
        occurrence: event.occurrenceExternalId,
      },
    });
  }

  context.matched.statusEvents.add(existing.id);
  context.mapStatusEventExternalToLocal.set(event.externalId, existing.id);

  const same =
    existing.occurrenceId === localOccurrenceId &&
    existing.behaviorId === localBehaviorId &&
    existing.recordedAtUtc === event.recordedAtUtc &&
    existing.status === event.status &&
    existing.statusSemantics === event.statusSemantics &&
    existing.sourceCaptureMethod === event.sourceCaptureMethod &&
    existing.sourceConfidence === event.sourceConfidence;

  return action({
    recordType: "status_event",
    action: same || policy === "preserve_append_only_history" ? "keep" : "replace",
    externalId: event.externalId,
    localId: existing.id,
    reasons:
      same || policy === "preserve_append_only_history"
        ? ["Status history is append-only by default; matching or mapped local event is preserved."]
        : ["Status event differs and full replacement policy was selected for preview."],
    relatedExternalIds: {
      behavior: event.behaviorExternalId,
      occurrence: event.occurrenceExternalId,
    },
  });
}

function actionForDefinitionEvent(
  event: BehaviorLogImportDefinitionEventPlan,
  context: RestoreContext,
): BehaviorLogRestoreAction {
  if (event.action === "skip") {
    return skippedAction(
      "behavior_definition_event",
      event.externalId,
      event.skipReasons,
    );
  }

  const localBehaviorId = context.mapBehaviorExternalToLocal.get(
    event.behaviorExternalId,
  );

  if (!localBehaviorId) {
    return skippedAction("behavior_definition_event", event.externalId, [
      "Definition event cannot be restored because its behavior is not safely mapped.",
    ]);
  }

  const existing = findExisting(
    context.existing.definitionEvents,
    context.mapDefinitionEventExternalToLocal.get(event.externalId),
    event.externalId,
  );

  if (!existing) {
    context.mapDefinitionEventExternalToLocal.set(
      event.externalId,
      event.externalId,
    );

    return action({
      recordType: "behavior_definition_event",
      action: "create",
      externalId: event.externalId,
      localId: null,
      reasons: ["Definition event exists in the bundle but not locally."],
      relatedExternalIds: { behavior: event.behaviorExternalId },
      metadata: {
        eventKind: event.eventKind,
        changedFields: event.changedFields,
        recordedAtUtc: event.recordedAtUtc,
      },
    });
  }

  context.matched.definitionEvents.add(existing.id);
  context.mapDefinitionEventExternalToLocal.set(event.externalId, existing.id);
  const same =
    existing.behaviorId === localBehaviorId &&
    existing.recordedAtUtc === event.recordedAtUtc;

  return action({
    recordType: "behavior_definition_event",
    action: same ? "keep" : "replace",
    externalId: event.externalId,
    localId: existing.id,
    reasons: same
      ? ["Definition event already matches its behavior and recorded time."]
      : ["Definition event exists locally but its behavior or recorded time differs."],
    relatedExternalIds: { behavior: event.behaviorExternalId },
  });
}

function actionForTimeSession(
  session: BehaviorLogImportTimeSessionPlan,
  context: RestoreContext,
): BehaviorLogRestoreAction {
  if (session.action === "skip") {
    return skippedAction("time_session", session.externalId, session.skipReasons);
  }

  const localBehaviorId = context.mapBehaviorExternalToLocal.get(
    session.behaviorExternalId,
  );
  const localOccurrenceId = context.mapOccurrenceExternalToLocal.get(
    session.occurrenceExternalId,
  );

  if (!localBehaviorId || !localOccurrenceId) {
    return skippedAction("time_session", session.externalId, [
      "Time session cannot be restored because its behavior or occurrence is not safely mapped.",
    ]);
  }

  const existing = findExisting(
    context.existing.timeSessions,
    context.mapTimeSessionExternalToLocal.get(session.externalId),
    session.externalId,
  );

  if (session.stoppedAtUtc === null) {
    const otherRunningSession = context.existing.timeSessions.find(
      (candidate) =>
        candidate.occurrenceId === localOccurrenceId &&
        candidate.stoppedAtUtc === null &&
        candidate.id !== existing?.id,
    );

    if (otherRunningSession) {
      context.restoreWarnings.push({
        severity: "warning",
        code: "running_time_session_already_exists",
        message: `Time session ${session.externalId} will be skipped because occurrence ${session.occurrenceExternalId} already has running session ${otherRunningSession.id}.`,
      });
      return skippedAction("time_session", session.externalId, [
        "Occurrence already has a different running time session.",
      ]);
    }
  }

  if (!existing) {
    context.mapTimeSessionExternalToLocal.set(
      session.externalId,
      session.externalId,
    );

    return action({
      recordType: "time_session",
      action: "create",
      externalId: session.externalId,
      localId: null,
      reasons: ["Time session exists in the bundle but not locally."],
      relatedExternalIds: {
        behavior: session.behaviorExternalId,
        occurrence: session.occurrenceExternalId,
      },
      metadata: {
        startedAtUtc: session.startedAtUtc,
        stoppedAtUtc: session.stoppedAtUtc,
      },
    });
  }

  context.matched.timeSessions.add(existing.id);
  context.mapTimeSessionExternalToLocal.set(session.externalId, existing.id);
  const same =
    existing.behaviorId === localBehaviorId &&
    existing.occurrenceId === localOccurrenceId &&
    existing.startedAtUtc === session.startedAtUtc &&
    existing.stoppedAtUtc === session.stoppedAtUtc;

  return action({
    recordType: "time_session",
    action: same ? "keep" : "replace",
    externalId: session.externalId,
    localId: existing.id,
    reasons: same
      ? ["Time session already matches the bundle."]
      : ["Time session exists locally but its parents or time bounds differ."],
    relatedExternalIds: {
      behavior: session.behaviorExternalId,
      occurrence: session.occurrenceExternalId,
    },
  });
}

function actionForInterventionRule(
  rule: BehaviorLogImportInterventionRulePlan,
  context: RestoreContext,
): BehaviorLogRestoreAction {
  if (rule.action === "skip") {
    return skippedAction("intervention_rule", rule.externalId, rule.skipReasons);
  }

  if (
    !rule.behaviorExternalId ||
    !context.mapBehaviorExternalToLocal.has(rule.behaviorExternalId)
  ) {
    return skippedAction("intervention_rule", rule.externalId, [
      "Intervention rule cannot be restored because its behavior is not safely mapped.",
    ]);
  }

  return action({
    recordType: "intervention_rule",
    action: "create",
    externalId: rule.externalId,
    localId: null,
    reasons: ["Intervention rule is represented as reminder configuration intent."],
    relatedExternalIds: { behavior: rule.behaviorExternalId },
    metadata: {
      interventionType: rule.interventionType,
      channel: rule.channel,
      enabled: rule.enabled,
      offsetMinutes: rule.offsetMinutes,
      cadenceReminderOffsetMinutes:
        rule.offsetMinutes === null ? 0 : -rule.offsetMinutes,
      activeFromLocalDate: rule.activeFromLocalDate,
      activeUntilLocalDate: rule.activeUntilLocalDate,
      timezone: rule.timezone,
      providerSideEffects: false,
    },
  });
}

function actionForInlineOccurrenceNote(
  note: BehaviorLogImportNotePlan,
  context: RestoreContext,
): BehaviorLogRestoreAction {
  if (note.attachedToType !== "occurrence") {
    return skippedAction("inline_occurrence_note", note.externalId, [
      "Only occurrence-attached BehaviorLog notes can restore the inline occurrence Note field.",
    ]);
  }

  if (note.action === "skip" || note.noteRole === "ai_generated") {
    return skippedAction("inline_occurrence_note", note.externalId, [
      ...note.skipReasons,
      note.noteRole === "ai_generated"
        ? "AI-generated notes are not restored into the product Note field."
        : null,
    ].filter((reason): reason is string => Boolean(reason)));
  }

  const localOccurrenceId = context.mapOccurrenceExternalToLocal.get(
    note.attachedToId,
  );
  const occurrence = localOccurrenceId
    ? context.existing.occurrences.find((candidate) => candidate.id === localOccurrenceId)
    : null;

  if (!localOccurrenceId) {
    return skippedAction("inline_occurrence_note", note.externalId, [
      "Inline note cannot be restored because its occurrence is not safely mapped.",
    ]);
  }

  if (!occurrence) {
    return action({
      recordType: "inline_occurrence_note",
      action: "create",
      externalId: note.externalId,
      localId: null,
      reasons: [
        "BehaviorLog note will be attached to the Occurrence created by this restore.",
      ],
      relatedExternalIds: { occurrence: note.attachedToId },
      metadata: { sensitivity: note.sensitivity },
    });
  }

  const localNote = occurrence.note?.trim() ? occurrence.note : null;
  const importedNote = note.bodyMarkdown.trim();
  const nextAction =
    localNote === importedNote ? "keep" : localNote ? "replace" : "create";

  return action({
    recordType: "inline_occurrence_note",
    action: nextAction,
    externalId: note.externalId,
    localId: occurrence.id,
    reasons:
      nextAction === "keep"
        ? ["Inline occurrence Note already matches the BehaviorLog note."]
        : nextAction === "create"
          ? ["BehaviorLog note would fill an empty local occurrence Note field."]
          : ["BehaviorLog note would replace the current local occurrence Note field."],
    relatedExternalIds: { occurrence: note.attachedToId },
    metadata: { sensitivity: note.sensitivity },
  });
}

function actionForImportedNote(
  note: BehaviorLogImportNotePlan,
  context: RestoreContext,
): BehaviorLogRestoreAction {
  if (note.action === "skip" || note.noteRole === "ai_generated") {
    return skippedAction("note", note.externalId, [
      ...note.skipReasons,
      note.noteRole === "ai_generated"
        ? "AI-generated notes are skipped by the v1 restore preview."
        : null,
    ].filter((reason): reason is string => Boolean(reason)));
  }

  const existing = context.existing.importedNotes.find(
    (candidate) =>
      candidate.externalId === note.externalId ||
      candidate.sourceOriginalId === note.externalId,
  );

  if (!existing) {
    return action({
      recordType: "note",
      action: "create",
      externalId: note.externalId,
      localId: null,
      reasons: ["Passive imported note record exists in the bundle but not locally."],
      metadata: { sensitivity: note.sensitivity },
    });
  }

  context.matched.importedNotes.add(existing.id);

  const same =
    existing.targetType === note.attachedToType &&
    existing.targetExternalId === note.attachedToId &&
    existing.bodyMarkdown === note.bodyMarkdown &&
    existing.noteRole === note.noteRole &&
    existing.sensitivity === note.sensitivity;

  return action({
    recordType: "note",
    action: same ? "keep" : "replace",
    externalId: note.externalId,
    localId: existing.id,
    reasons: same
      ? ["Passive imported note already matches the bundle."]
      : ["Passive imported note exists locally but differs from the bundle."],
    metadata: { sensitivity: note.sensitivity },
  });
}

function actionForImportedIntervention(
  intervention: BehaviorLogImportInterventionPreviewPlan,
  context: RestoreContext,
): BehaviorLogRestoreAction {
  const existing = context.existing.importedInterventions.find(
    (candidate) =>
      candidate.externalId === intervention.externalId ||
      candidate.sourceOriginalId === intervention.externalId,
  );

  if (!existing) {
    return action({
      recordType: "intervention",
      action: "create",
      externalId: intervention.externalId,
      localId: null,
      reasons: ["Passive imported intervention history exists in the bundle but not locally."],
      relatedExternalIds: {
        behavior: intervention.behaviorExternalId,
        occurrence: intervention.occurrenceExternalId,
      },
      metadata: {
        droppedSensitiveFields:
          intervention.storageDecision.droppedSensitiveFields,
        redactedFields: intervention.storageDecision.redactedFields,
      },
    });
  }

  context.matched.importedInterventions.add(existing.id);

  const same =
    existing.behaviorExternalId === intervention.behaviorExternalId &&
    existing.occurrenceExternalId === intervention.occurrenceExternalId &&
    existing.channel === intervention.channel &&
    existing.deliveryStatus === intervention.deliveryStatus &&
    existing.scheduledSendAtUtc === intervention.scheduledSendAtUtc &&
    existing.sentAtUtc === intervention.sentAtUtc &&
    existing.failureReason === intervention.failureReason;

  return action({
    recordType: "intervention",
    action: same ? "keep" : "replace",
    externalId: intervention.externalId,
    localId: existing.id,
    reasons: same
      ? ["Passive imported intervention history already matches the bundle."]
      : ["Passive imported intervention history exists locally but differs from the bundle."],
    relatedExternalIds: {
      behavior: intervention.behaviorExternalId,
      occurrence: intervention.occurrenceExternalId,
    },
    metadata: {
      droppedSensitiveFields: intervention.storageDecision.droppedSensitiveFields,
      redactedFields: intervention.storageDecision.redactedFields,
    },
  });
}

function actionsForArchivedBehaviors(
  context: RestoreContext,
): BehaviorLogRestoreAction[] {
  return context.existing.behaviors
    .filter((behavior) => !context.matched.behaviors.has(behavior.id))
    .map((behavior) =>
      action({
        recordType: "behavior",
        action: "archive",
        externalId: null,
        localId: behavior.id,
        reasons: ["Local behavior is not represented in the BehaviorLog bundle."],
        metadata: { title: behavior.title },
      }),
    );
}

function actionsForDeletedSchedules(
  context: RestoreContext,
): BehaviorLogRestoreAction[] {
  return context.existing.schedules
    .filter((schedule) => !context.matched.schedules.has(schedule.id))
    .map((schedule) =>
      action({
        recordType: "schedule",
        action: "delete",
        externalId: null,
        localId: schedule.id,
        reasons: ["Local schedule slot is not represented in the BehaviorLog bundle."],
      }),
    );
}

function actionsForDeletedOccurrences(
  context: RestoreContext,
): BehaviorLogRestoreAction[] {
  return context.existing.occurrences
    .filter((occurrence) => !context.matched.occurrences.has(occurrence.id))
    .map((occurrence) =>
      action({
        recordType: "occurrence",
        action: "delete",
        externalId: null,
        localId: occurrence.id,
        reasons: ["Local occurrence is not represented in the BehaviorLog bundle."],
        metadata: {
          localDate: occurrence.localDate,
          status: occurrence.status,
        },
      }),
    );
}

function actionsForUnmatchedStatusEvents(
  context: RestoreContext,
  policy: BehaviorLogRestoreStatusHistoryPolicy,
): BehaviorLogRestoreAction[] {
  return context.existing.statusEvents
    .filter((event) => !context.matched.statusEvents.has(event.id))
    .map((event) =>
      action({
        recordType: "status_event",
        action: policy === "replace_status_history" ? "delete" : "keep",
        externalId: null,
        localId: event.id,
        reasons: [
          policy === "replace_status_history"
            ? "Local status event is not represented in the bundle and would be removed by a replacement policy preview."
            : "Append-only status history is preserved by default even when the event is not in the bundle.",
        ],
      }),
    );
}

function actionsForDeletedInlineOccurrenceNotes(input: {
  context: RestoreContext;
  importedNoteByOccurrence: Map<string, BehaviorLogImportNotePlan>;
}): BehaviorLogRestoreAction[] {
  const representedOccurrenceLocalIds = new Set(
    Array.from(input.context.mapOccurrenceExternalToLocal.values()),
  );

  return input.context.existing.occurrences
    .filter(
      (occurrence) =>
        representedOccurrenceLocalIds.has(occurrence.id) &&
        occurrence.note?.trim() &&
        !hasImportedNoteForLocalOccurrence({
          context: input.context,
          importedNoteByOccurrence: input.importedNoteByOccurrence,
          localOccurrenceId: occurrence.id,
        }),
    )
    .map((occurrence) =>
      action({
        recordType: "inline_occurrence_note",
        action: "delete",
        externalId: null,
        localId: occurrence.id,
        reasons: ["Local inline occurrence Note is not represented in the BehaviorLog bundle."],
      }),
    );
}

function hasImportedNoteForLocalOccurrence(input: {
  context: RestoreContext;
  importedNoteByOccurrence: Map<string, BehaviorLogImportNotePlan>;
  localOccurrenceId: string;
}): boolean {
  for (const externalOccurrenceId of input.importedNoteByOccurrence.keys()) {
    if (
      input.context.mapOccurrenceExternalToLocal.get(externalOccurrenceId) ===
      input.localOccurrenceId
    ) {
      return true;
    }
  }

  return false;
}

function actionsForDeletedImportedNotes(
  context: RestoreContext,
): BehaviorLogRestoreAction[] {
  return context.existing.importedNotes
    .filter((note) => !context.matched.importedNotes.has(note.id))
    .map((note) =>
      action({
        recordType: "note",
        action: "delete",
        externalId: note.externalId,
        localId: note.id,
        reasons: ["Local passive imported note is not represented in the BehaviorLog bundle."],
        metadata: { sensitivity: note.sensitivity },
      }),
    );
}

function actionsForDeletedImportedInterventions(
  context: RestoreContext,
): BehaviorLogRestoreAction[] {
  return context.existing.importedInterventions
    .filter((intervention) => !context.matched.importedInterventions.has(intervention.id))
    .map((intervention) =>
      action({
        recordType: "intervention",
        action: "delete",
        externalId: intervention.externalId,
        localId: intervention.id,
        reasons: [
          "Local passive imported intervention history is not represented in the BehaviorLog bundle.",
        ],
      }),
    );
}

function buildContext(
  existing: BehaviorLogExistingRecords | undefined,
): RestoreContext {
  const normalized: Required<BehaviorLogExistingRecords> = {
    behaviors: [...(existing?.behaviors ?? [])].sort(compareById),
    schedules: [...(existing?.schedules ?? [])].sort(compareById),
    occurrences: [...(existing?.occurrences ?? [])].sort(compareById),
    statusEvents: [...(existing?.statusEvents ?? [])].sort(compareById),
    definitionEvents: [...(existing?.definitionEvents ?? [])].sort(compareById),
    timeSessions: [...(existing?.timeSessions ?? [])].sort(compareById),
    importedNotes: [...(existing?.importedNotes ?? [])].sort(compareById),
    importedInterventions: [...(existing?.importedInterventions ?? [])].sort(
      compareById,
    ),
    mappings: [...(existing?.mappings ?? [])].sort((a, b) =>
      `${a.recordType}:${a.externalId}`.localeCompare(
        `${b.recordType}:${b.externalId}`,
      ),
    ),
  };
  const context: RestoreContext = {
    existing: normalized,
    matched: {
      behaviors: new Set(),
      schedules: new Set(),
      occurrences: new Set(),
      statusEvents: new Set(),
      definitionEvents: new Set(),
      timeSessions: new Set(),
      importedNotes: new Set(),
      importedInterventions: new Set(),
    },
    mapBehaviorExternalToLocal: mapExisting("behavior", normalized.mappings),
    mapScheduleExternalToLocal: mapExisting("schedule", normalized.mappings),
    mapOccurrenceExternalToLocal: mapExisting("occurrence", normalized.mappings),
    mapStatusEventExternalToLocal: mapExisting(
      "status_event",
      normalized.mappings,
    ),
    mapDefinitionEventExternalToLocal: mapExisting(
      "behavior_definition_event",
      normalized.mappings,
    ),
    mapTimeSessionExternalToLocal: mapExisting(
      "time_session",
      normalized.mappings,
    ),
    restoreWarnings: [],
  };

  seedIdentityMap(context.mapBehaviorExternalToLocal, normalized.behaviors);
  seedIdentityMap(context.mapScheduleExternalToLocal, normalized.schedules);
  seedIdentityMap(context.mapOccurrenceExternalToLocal, normalized.occurrences);
  seedIdentityMap(context.mapStatusEventExternalToLocal, normalized.statusEvents);
  seedIdentityMap(
    context.mapDefinitionEventExternalToLocal,
    normalized.definitionEvents,
  );
  seedIdentityMap(context.mapTimeSessionExternalToLocal, normalized.timeSessions);

  return context;
}

function mapExisting(
  recordType: BehaviorLogImportRecordType,
  mappings: Required<BehaviorLogExistingRecords>["mappings"],
): Map<string, string> {
  return new Map(
    mappings
      .filter((mapping) => mapping.recordType === recordType)
      .map((mapping) => [mapping.externalId, mapping.localId]),
  );
}

function seedIdentityMap<T extends { id: string; sourceOriginalId?: string | null }>(
  map: Map<string, string>,
  records: T[],
): void {
  for (const record of records) {
    map.set(record.id, record.id);

    if (record.sourceOriginalId) {
      map.set(record.sourceOriginalId, record.id);
    }
  }
}

function findExisting<T extends { id: string; sourceOriginalId?: string | null }>(
  records: T[],
  mappedId: string | undefined,
  externalId: string,
): T | null {
  return (
    records.find((record) => record.id === mappedId) ??
    records.find(
      (record) => record.id === externalId || record.sourceOriginalId === externalId,
    ) ??
    null
  );
}

function scheduleShape(
  schedule: BehaviorLogExistingSchedule | BehaviorLogImportSchedulePlan,
): string {
  return stableStringify({
    kind:
      "cadenceScheduleKind" in schedule ? schedule.cadenceScheduleKind : null,
    preset:
      "cadenceSchedulePreset" in schedule
        ? schedule.cadenceSchedulePreset
        : null,
    localTime: schedule.localTime,
    windowStartLocal: schedule.windowStartLocal,
    windowEndLocal: schedule.windowEndLocal,
  });
}

function action(input: {
  recordType: BehaviorLogRestoreRecordType;
  action: BehaviorLogRestoreActionKind;
  externalId: string | null;
  localId: string | null;
  reasons: string[];
  relatedExternalIds?: Record<string, string | null>;
  metadata?: Record<string, unknown>;
}): BehaviorLogRestoreAction {
  return {
    ...input,
    destructive:
      input.action === "replace" ||
      input.action === "archive" ||
      input.action === "delete",
  };
}

function skippedAction(
  recordType: BehaviorLogRestoreRecordType,
  externalId: string | null,
  reasons: string[],
): BehaviorLogRestoreAction {
  return action({
    recordType,
    action: "skip",
    externalId,
    localId: null,
    reasons: reasons.length > 0 ? reasons : ["Record cannot be represented by the restore contract."],
  });
}

function summarizeActions(
  actions: BehaviorLogRestoreAction[],
  notes: BehaviorLogImportNotePlan[],
): Omit<BehaviorLogRestorePreview["summary"], "redactedInterventionFieldCount"> {
  const actionCounts = Object.fromEntries(
    RESTORE_ACTION_KINDS.map((kind) => [kind, 0]),
  ) as Record<BehaviorLogRestoreActionKind, number>;

  for (const actionItem of actions) {
    actionCounts[actionItem.action] += 1;
  }
  const unsupportedActions = actions.filter(
    (actionItem) =>
      actionItem.action === "skip" &&
      actionItem.metadata?.historicalReferenceOnly !== true,
  );

  return {
    actionCounts,
    destructiveActionCount: actions.filter((actionItem) => actionItem.destructive)
      .length,
    createdCount: actionCounts.create,
    replacedCount: actionCounts.replace,
    archivedCount: actionCounts.archive,
    deletedCount: actionCounts.delete,
    keptCount: actionCounts.keep,
    skippedCount: unsupportedActions.length,
    highOrRestrictedNoteCount: notes.filter(
      (note) =>
        note.action !== "skip" &&
        note.noteRole !== "ai_generated" &&
        (note.sensitivity === "high" || note.sensitivity === "restricted"),
    ).length,
    unsupportedActionCount: unsupportedActions.length,
  };
}

function flattenActions(
  actions: BehaviorLogRestorePreview["actions"],
): BehaviorLogRestoreAction[] {
  return [
    ...actions.behaviors,
    ...actions.schedules,
    ...actions.occurrences,
    ...actions.statusEvents,
    ...(actions.definitionEvents ?? []),
    ...(actions.timeSessions ?? []),
    ...(actions.interventionRules ?? []),
    ...actions.inlineOccurrenceNotes,
    ...actions.importedNotes,
    ...actions.importedInterventions,
  ];
}

function compareActions(
  a: BehaviorLogRestoreAction,
  b: BehaviorLogRestoreAction,
): number {
  return `${a.recordType}:${a.externalId ?? ""}:${a.localId ?? ""}:${a.action}`.localeCompare(
    `${b.recordType}:${b.externalId ?? ""}:${b.localId ?? ""}:${b.action}`,
  );
}

function compareById<T extends { id: string }>(a: T, b: T): number {
  return a.id.localeCompare(b.id);
}

function normalizeText(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function normalizeNullableText(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  return normalizeText(value);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortForStableStringify(value));
}

function sortForStableStringify(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortForStableStringify);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, sortForStableStringify(child)]),
    );
  }

  return value;
}
