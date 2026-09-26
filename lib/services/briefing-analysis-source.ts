import type { AdvisorDayContextV1, AdvisorOpaqueRef } from "@cadence/core/types/advisor-day-context";
import {
  BRIEFING_ANALYSIS_VERSION,
  type BriefingAnalysisConfigurationPeriod,
  type BriefingAnalysisNote,
  type BriefingAnalysisOccurrence,
  type BriefingAnalysisOptionalRecords,
  type BriefingAnalysisReminderDelivery,
  type BriefingAnalysisSource,
  type BriefingAnalysisStatusEvent,
} from "@cadence/core/types/briefing-analysis";
import { ADVISOR_ANALYSIS_LIMITS, type AdvisorAnalysisOptional, type AdvisorAnalysisSnapshot } from "@/lib/db/advisor-analysis.repo";


const STATUSES = new Set(["unresolved", "completed", "not_completed"]);
const SEMANTICS = new Set(["explicit_user_mark", "explicit_user_correction", "imported_explicit", "system_rule_declared", "ambiguous_import"]);
const CHANNELS = new Set(["browser_push", "email"]);
const DELIVERY_STATUSES = new Set(["sent", "failed", "cancelled", "pending"]);
/** Changes that start a new schedule period. Reminder- and category-only revisions do not. */
const SCHEDULE_FIELDS = new Set(["schedule_graph", "timezone", "active"]);

/**
 * Projects owner-scoped analysis records into opaque internal lane inputs.
 * The result never reaches a model or the private inspector directly; the
 * pipeline sends only selected findings.
 */
export function projectBriefingAnalysisSource(
  snapshot: AdvisorAnalysisSnapshot,
  input: Readonly<{ context: AdvisorDayContextV1; makeOpaqueRef: AdvisorOpaqueRef; startLocalDate: string }>,
): BriefingAnalysisSource {
  const ref = input.makeOpaqueRef;
  const capped = snapshot.occurrences.length > ADVISOR_ANALYSIS_LIMITS.occurrences;
  const occurrences: BriefingAnalysisOccurrence[] = capped ? [] : snapshot.occurrences.map((row) => {
    if (!STATUSES.has(row.status) || (row.scheduleKind !== "exact" && row.scheduleKind !== "range")) {
      throw new TypeError("Invalid advisor analysis occurrence.");
    }
    return {
      ref: ref("occurrence", row.id),
      behaviorRef: ref("behavior", row.behaviorId),
      localDate: row.localDate,
      scheduledFor: row.scheduledFor,
      scheduleKind: row.scheduleKind,
      startTime: row.scheduleStartTime.slice(0, 5),
      endTime: row.scheduleEndTime ? row.scheduleEndTime.slice(0, 5) : null,
      status: row.status as BriefingAnalysisOccurrence["status"],
      statusMarkedAt: row.statusMarkedAt,
      configurationRef: row.configurationEventId ? ref("configuration", row.configurationEventId) : null,
    };
  });
  const statusEvents: BriefingAnalysisOptionalRecords<BriefingAnalysisStatusEvent> =
    snapshot.statusEvents.length > ADVISOR_ANALYSIS_LIMITS.statusEvents ? { state: "capped" } : {
      state: "available",
      records: snapshot.statusEvents.map((event) => {
        if (!STATUSES.has(event.status) || (event.previousStatus !== null && !STATUSES.has(event.previousStatus)) || !SEMANTICS.has(event.semantics)) {
          throw new TypeError("Invalid advisor analysis status event.");
        }
        return {
          ref: ref("status_event", event.id),
          occurrenceRef: ref("occurrence", event.occurrenceId),
          previousStatus: event.previousStatus as BriefingAnalysisStatusEvent["previousStatus"],
          status: event.status as BriefingAnalysisStatusEvent["status"],
          semantics: event.semantics as BriefingAnalysisStatusEvent["semantics"],
          recordedAt: event.recordedAt,
          revisesRef: event.revisesEventId ? ref("status_event", event.revisesEventId) : null,
        };
      }),
    };
  const configurationPeriods: BriefingAnalysisOptionalRecords<BriefingAnalysisConfigurationPeriod> =
    snapshot.configurationEvents.length > ADVISOR_ANALYSIS_LIMITS.configurationEvents ? { state: "capped" } : {
      state: "available",
      records: snapshot.configurationEvents.map((event) => ({
        ref: ref("configuration", event.id),
        behaviorRef: ref("behavior", event.behaviorId),
        effectiveAt: event.effectiveAt,
        effectiveLocalDate: event.effectiveLocalDate,
        // A rollout backfill captured an existing configuration; it is not a schedule change.
        startsSchedulePeriod: event.eventKind === "baseline"
          ? !(event.source === "system" && event.reasonCode === "history_capture_started")
          : event.changedFields.some((field) => SCHEDULE_FIELDS.has(field)),
        browserReminderEnabled: event.browserReminderEnabled,
        emailReminderEnabled: event.emailReminderEnabled,
      })),
    };
  const reminders = optional(snapshot.reminders, ADVISOR_ANALYSIS_LIMITS.reminders, (delivery): BriefingAnalysisReminderDelivery => {
    if (!CHANNELS.has(delivery.channel) || !DELIVERY_STATUSES.has(delivery.status)) throw new TypeError("Invalid advisor analysis reminder.");
    return {
      occurrenceRef: ref("occurrence", delivery.occurrenceId),
      channel: delivery.channel as BriefingAnalysisReminderDelivery["channel"],
      status: delivery.status as BriefingAnalysisReminderDelivery["status"],
      scheduledSendAt: delivery.scheduledSendAt,
    };
  });
  const notes = optional(snapshot.notes, ADVISOR_ANALYSIS_LIMITS.notes, (note): BriefingAnalysisNote => ({
    ref: ref("note", note.occurrenceId),
    occurrenceRef: ref("occurrence", note.occurrenceId),
    behaviorRef: ref("behavior", note.behaviorId),
    localDate: note.localDate,
    text: note.text.trim().slice(0, 280),
  }));
  const today = input.context.cadence.occurrences;
  return {
    version: BRIEFING_ANALYSIS_VERSION,
    observedAt: snapshot.observedAt,
    revision: ref("analysis_revision", snapshot.revision),
    timezone: snapshot.timezone,
    localDate: input.context.localDate,
    startLocalDate: input.startLocalDate,
    lookbackDays: 90,
    completeness: capped ? "capped" : "complete",
    occurrences,
    statusEvents,
    configurationPeriods,
    reminders,
    notes,
    today: {
      scheduledCount: today.length,
      scheduledBehaviorRefs: input.context.cadence.occurrences.map((item) => item.behaviorRef),
      unresolved: today.filter((item) => item.status === "unresolved")
        .map((item) => ({ ref: item.ref, behaviorRef: item.behaviorRef, startTime: item.schedule.startTime.slice(0, 5) })),
    },
  };
}

function optional<Row, Out>(value: AdvisorAnalysisOptional<Row>, limit: number, project: (row: Row) => Out): BriefingAnalysisOptionalRecords<Out> {
  if (value === "not_requested" || value === "not_permitted") return { state: value };
  if (value.length > limit) return { state: "capped" };
  return { state: "available", records: value.map(project) };
}
