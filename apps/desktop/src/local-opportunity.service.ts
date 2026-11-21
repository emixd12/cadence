import { Temporal } from "@js-temporal/polyfill";
import type { OccurrenceRecord, OccurrenceStatusEventRecord } from "@cadence/core/data-store";
import { behaviorRunState, isStoppedByRunFields, plannedRangeEnd, runFieldsFromStored } from "@cadence/core/resolvers/behavior-run.resolver";
import {
  ADD_REFUSAL_NOTICES,
  REMOVE_REFUSAL_NOTICES,
  addRefusalReasonForMessage,
  opportunityPlacementTimes,
  opportunityTimeLabel,
  refusedOpportunity,
  removeRefusalReasonForMessage,
  type AddOpportunityInput,
  type OpportunityNotice,
  type OpportunityRefusalReason,
} from "../../../lib/services/opportunity-placement";
import { canonicalTime } from "./local-generation.service";
import { localCommand, localMutation } from "./local-store";

/**
 * Behaviors of Opportunity on the Mac, with or without an account: add an opportunity
 * Behavior to today, Done now, or remove a clean added item. This service plans the row
 * with the shared rules (today in the Behavior timezone, the run check, the instant);
 * the local store refuses a stale or malformed plan with the hosted function's words.
 * A linked Mac sends the change to the account on its next synchronization.
 */

export type LocalAddOpportunityResult =
  | Readonly<{ outcome: "added" | "logged"; created: boolean; occurrence: OccurrenceRecord; notice: OpportunityNotice }>
  | Readonly<{ outcome: "refused"; reason: OpportunityRefusalReason; notice: OpportunityNotice }>;

export type LocalRemoveOpportunityResult =
  | Readonly<{ outcome: "removed"; occurrence: OccurrenceRecord; cancelledReminderCount: number; notice: OpportunityNotice }>
  | Readonly<{ outcome: "refused"; reason: OpportunityRefusalReason; notice: OpportunityNotice }>;

export async function addLocalOpportunity(
  profileId: string,
  input: AddOpportunityInput,
  now: Temporal.Instant = Temporal.Now.instant(),
): Promise<LocalAddOpportunityResult> {
  const graphs = await localCommand("readBehaviorGraphs", { profileId });
  const behavior = graphs.find((graph) => graph.behavior.id === input.behaviorId)?.behavior;
  if (!behavior) return refusedOpportunity("not_available", "opportunity.refused.not-available", { title: "This Behavior" });
  const title = behavior.title;
  const refuse = (reason: keyof typeof ADD_REFUSAL_NOTICES) => refusedOpportunity(reason, ADD_REFUSAL_NOTICES[reason], { title });
  const today = now.toZonedDateTimeISO(behavior.timezone);
  const times = opportunityPlacementTimes(input.placement, today);
  if (!times) return refusedOpportunity("invalid_time", "opportunity.refused.time", {});
  if (behavior.is_opportunity !== true || !behavior.active || behavior.archived_at !== null) return refuse("not_available");

  const localDate = today.toPlainDate().toString();
  const startsAt = Temporal.PlainDate.from(localDate)
    .toZonedDateTime({ timeZone: behavior.timezone, plainTime: Temporal.PlainTime.from(times.startTime) }).toInstant();
  const endsAt = times.endTime ? plannedRangeEnd(localDate, times.startTime, times.endTime, behavior.timezone) : null;
  const run = runFieldsFromStored(behavior);
  if (behaviorRunState(run, now).state !== "running" || isStoppedByRunFields(run, { startsAt, endsAt })) return refuse("not_running");

  const stamp = now.toString();
  const occurrenceId = input.occurrenceId ?? crypto.randomUUID();
  const addedBy = input.addedBy ?? "user";
  const doneNow = input.placement.kind === "done_now";
  const occurrence: OccurrenceRecord = {
    id: occurrenceId, user_id: profileId, behavior_id: behavior.id,
    behavior_configuration_event_id: behavior.current_configuration_event_id, behavior_schedule_slot_id: null,
    scheduled_for: startsAt.toString(), local_date: localDate,
    schedule_kind: times.endTime ? "range" : "exact", schedule_preset: times.preset,
    schedule_start_time: canonicalTime(times.startTime), schedule_end_time: times.endTime ? canonicalTime(times.endTime) : null,
    schedule_range_identity: null,
    status: doneNow ? "completed" : "unresolved", completed_at: doneNow ? stamp : null, status_marked_at: doneNow ? stamp : null,
    note: null, origin: "opportunity", added_by: addedBy, created_at: stamp, updated_at: stamp,
  };
  const statusEvent: OccurrenceStatusEventRecord | null = doneNow ? {
    id: crypto.randomUUID(), user_id: profileId, occurrence_id: occurrenceId, behavior_id: behavior.id,
    local_date: localDate, timezone: behavior.timezone, previous_status: "unresolved", status: "completed",
    status_semantics: "explicit_user_mark", recorded_at: stamp, effective_at: stamp, reason_code: null,
    revises_event_id: null, source_capture_method: addedBy === "user" ? "manual_tap" : "manual_text",
    source_confidence: "high", created_at: stamp, updated_at: stamp,
  } : null;

  let added: { created: boolean; occurrence: OccurrenceRecord };
  try {
    added = await localCommand("addOpportunityOccurrence", { ...localMutation(profileId, stamp), occurrence, statusEvent });
  } catch (error) {
    const reason = addRefusalReasonForMessage(errorMessage(error));
    if (!reason) throw error;
    return refuse(reason);
  }
  const time = opportunityTimeLabel(added.occurrence);
  return {
    outcome: doneNow ? "logged" : "added", created: added.created, occurrence: added.occurrence,
    notice: { id: doneNow ? "opportunity.logged" : "opportunity.added", params: { title, time } },
  };
}

export async function removeLocalOpportunity(
  profileId: string,
  input: Readonly<{ occurrenceId: string; title?: string }>,
  now: Temporal.Instant = Temporal.Now.instant(),
): Promise<LocalRemoveOpportunityResult> {
  const title = input.title?.trim() || "This item";
  try {
    const removed = await localCommand("removeOpportunityOccurrence", {
      ...localMutation(profileId, now.toString()), occurrenceId: input.occurrenceId,
    });
    return { outcome: "removed", occurrence: removed.occurrence, cancelledReminderCount: removed.cancelledReminderCount,
      notice: { id: "opportunity.removed", params: { title } } };
  } catch (error) {
    const reason = removeRefusalReasonForMessage(errorMessage(error));
    if (!reason) throw error;
    return refusedOpportunity(reason, REMOVE_REFUSAL_NOTICES[reason], { title });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === "string" ? error : "";
}
