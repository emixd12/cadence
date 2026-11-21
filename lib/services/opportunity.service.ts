import type { Temporal } from "@js-temporal/polyfill";
import { getBehaviorById, type AppSupabaseClient } from "@/lib/db/behaviors.repo";
import {
  addOpportunityOccurrence,
  OpportunityRpcError,
  removeOpportunityOccurrence,
} from "@/lib/db/opportunity.repo";
import { reportMonitoringError } from "@/lib/monitoring/privacy-safe-events";
import { syncReminderDeliveriesForBehavior } from "@/lib/services/reminder.service";
import type { Occurrence } from "@/lib/types/database";
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
} from "@/lib/services/opportunity-placement";

export {
  parseAddOpportunityFormData,
  parseRemoveOpportunityFormData,
  type AddOpportunityInput,
  type OpportunityNotice,
  type OpportunityPlacement,
  type OpportunityRefusalReason,
} from "@/lib/services/opportunity-placement";

/**
 * Behaviors of Opportunity (docs/RECURRENCE_RULES.md, "Behaviors of Opportunity"): add
 * an opportunity Behavior to today, log it Completed now, or remove a clean added item.
 * The hosted functions hold every rule; this service picks the times, plans browser
 * reminders for an added item and names the notice to show.
 */

export type OpportunityCaller = Readonly<{
  supabase: AppSupabaseClient;
  userId: string;
  now: Temporal.Instant;
}>;

export type AddOpportunityResult =
  | Readonly<{ outcome: "added" | "logged"; created: boolean; occurrence: Occurrence; notice: OpportunityNotice }>
  | Readonly<{ outcome: "refused"; reason: OpportunityRefusalReason; notice: OpportunityNotice }>;

export type RemoveOpportunityResult =
  | Readonly<{ outcome: "removed"; occurrence: Occurrence; cancelledReminderCount: number; notice: OpportunityNotice }>
  | Readonly<{ outcome: "refused"; reason: OpportunityRefusalReason; notice: OpportunityNotice }>;

export async function addOpportunityToToday(
  caller: OpportunityCaller,
  input: AddOpportunityInput,
): Promise<AddOpportunityResult> {
  const behavior = await getBehaviorById(caller.supabase, caller.userId, input.behaviorId);
  if (!behavior) return refusedOpportunity("not_available", "opportunity.refused.not-available", { title: "This Behavior" });
  const title = behavior.title;
  const today = caller.now.toZonedDateTimeISO(behavior.timezone);
  const times = opportunityPlacementTimes(input.placement, today);
  if (!times) return refusedOpportunity("invalid_time", "opportunity.refused.time", {});

  let added;
  try {
    added = await addOpportunityOccurrence(caller.supabase, {
      behaviorId: behavior.id,
      localDate: today.toPlainDate().toString(),
      startTime: times.startTime,
      endTime: times.endTime,
      preset: times.preset,
      addedBy: input.addedBy ?? "user",
      markCompleted: input.placement.kind === "done_now",
      occurrenceId: input.occurrenceId ?? null,
    });
  } catch (error) {
    const reason = addRefusalReason(error);
    if (!reason) throw error;
    return refusedOpportunity(reason, ADD_REFUSAL_NOTICES[reason], { title });
  }

  if (added.occurrence.status === "unresolved") {
    await planReminders(caller, behavior, added.occurrence);
  }
  const time = opportunityTimeLabel(added.occurrence);
  return input.placement.kind === "done_now"
    ? { outcome: "logged", created: added.created, occurrence: added.occurrence, notice: { id: "opportunity.logged", params: { title, time } } }
    : { outcome: "added", created: added.created, occurrence: added.occurrence, notice: { id: "opportunity.added", params: { title, time } } };
}

export async function removeOpportunityFromToday(
  caller: OpportunityCaller,
  input: Readonly<{ occurrenceId: string; title?: string }>,
): Promise<RemoveOpportunityResult> {
  const title = input.title?.trim() || "This item";
  try {
    // The function cancels the item's pending reminders before it deletes the row.
    const removed = await removeOpportunityOccurrence(caller.supabase, input.occurrenceId);
    return {
      outcome: "removed",
      occurrence: removed.occurrence,
      cancelledReminderCount: removed.cancelledReminderCount,
      notice: { id: "opportunity.removed", params: { title } },
    };
  } catch (error) {
    const reason = removeRefusalReason(error);
    if (!reason) throw error;
    return refusedOpportunity(reason, REMOVE_REFUSAL_NOTICES[reason], { title });
  }
}

/** Browser reminders for an added Unresolved item, through the reminder service's own rules. */
async function planReminders(
  caller: OpportunityCaller,
  behavior: NonNullable<Awaited<ReturnType<typeof getBehaviorById>>>,
  occurrence: Occurrence,
): Promise<void> {
  try {
    await syncReminderDeliveriesForBehavior(caller.supabase, caller.userId, behavior, {
      scheduledFrom: occurrence.local_date,
      occurrences: [occurrence],
      now: caller.now,
    });
  } catch (error) {
    // The item is saved; the next Timeline sync plans its reminder again.
    reportMonitoringError("opportunity.reminder_planning_failed", error);
  }
}

function addRefusalReason(error: unknown) {
  return error instanceof OpportunityRpcError ? addRefusalReasonForMessage(error.message) : null;
}

function removeRefusalReason(error: unknown) {
  return error instanceof OpportunityRpcError ? removeRefusalReasonForMessage(error.message) : null;
}
