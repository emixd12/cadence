import { Temporal } from "@js-temporal/polyfill";
import type { NoticeId, NoticeParams } from "@cadence/core/notices";
import { formatClockTimeLabel, formatCompactOccurrenceScheduleLabel } from "@cadence/core/services/schedule";
import { TIME_RANGE_PRESETS, type TimeRangePreset } from "@cadence/core/types/schedule";
import type { OpportunityAddedBy } from "@cadence/core/types/database";
import { getBehaviorById, type AppSupabaseClient } from "@/lib/db/behaviors.repo";
import {
  addOpportunityOccurrence,
  OpportunityRpcError,
  removeOpportunityOccurrence,
} from "@/lib/db/opportunity.repo";
import { reportMonitoringError } from "@/lib/monitoring/privacy-safe-events";
import { syncReminderDeliveriesForBehavior } from "@/lib/services/reminder.service";
import type { Occurrence } from "@/lib/types/database";

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

export type OpportunityPlacement =
  | Readonly<{ kind: "exact"; startTime: string }>
  | Readonly<{ kind: "range"; startTime: string; endTime: string }>
  | Readonly<{ kind: "preset"; preset: TimeRangePreset }>
  /** Done now: added at the current minute and marked Completed in the same write. */
  | Readonly<{ kind: "done_now" }>;

export type AddOpportunityInput = Readonly<{
  behaviorId: string;
  placement: OpportunityPlacement;
  addedBy?: OpportunityAddedBy;
  /** A client-made id, so a resent request replays instead of adding twice. */
  occurrenceId?: string | null;
}>;

export type OpportunityNotice = Readonly<{ id: NoticeId; params: NoticeParams }>;

export type OpportunityRefusalReason =
  | "not_available" | "not_running" | "not_today" | "invalid_time"
  | "marked" | "kept" | "not_found";

export type AddOpportunityResult =
  | Readonly<{ outcome: "added" | "logged"; created: boolean; occurrence: Occurrence; notice: OpportunityNotice }>
  | Readonly<{ outcome: "refused"; reason: OpportunityRefusalReason; notice: OpportunityNotice }>;

export type RemoveOpportunityResult =
  | Readonly<{ outcome: "removed"; occurrence: Occurrence; cancelledReminderCount: number; notice: OpportunityNotice }>
  | Readonly<{ outcome: "refused"; reason: OpportunityRefusalReason; notice: OpportunityNotice }>;

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The basket's add form: `behavior_id`, `placement` (exact, range, preset or done_now),
 * `start_time`, `end_time`, `preset` and an optional `client_occurrence_id`. Returns
 * null when the form names no Behavior or no known placement.
 */
export function parseAddOpportunityFormData(formData: FormData): AddOpportunityInput | null {
  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value.trim() : "";
  };
  const behaviorId = text("behavior_id");
  if (!UUID_PATTERN.test(behaviorId)) return null;
  const clientId = text("client_occurrence_id");
  const occurrenceId = UUID_PATTERN.test(clientId) ? clientId : null;
  const kind = text("placement");
  let placement: OpportunityPlacement;
  if (kind === "done_now") placement = { kind: "done_now" };
  else if (kind === "exact") placement = { kind: "exact", startTime: text("start_time") };
  else if (kind === "range") placement = { kind: "range", startTime: text("start_time"), endTime: text("end_time") };
  else if (kind === "preset" && Object.hasOwn(TIME_RANGE_PRESETS, text("preset"))) {
    placement = { kind: "preset", preset: text("preset") as TimeRangePreset };
  } else return null;
  return { behaviorId, placement, addedBy: "user", occurrenceId };
}

/** The row's Remove form: `occurrence_id` and the row's `title` for the notice. */
export function parseRemoveOpportunityFormData(formData: FormData): Readonly<{ occurrenceId: string; title: string }> | null {
  const occurrenceId = formData.get("occurrence_id");
  const title = formData.get("title");
  if (typeof occurrenceId !== "string" || !UUID_PATTERN.test(occurrenceId)) return null;
  return { occurrenceId, title: typeof title === "string" ? title : "" };
}

export async function addOpportunityToToday(
  caller: OpportunityCaller,
  input: AddOpportunityInput,
): Promise<AddOpportunityResult> {
  const behavior = await getBehaviorById(caller.supabase, caller.userId, input.behaviorId);
  if (!behavior) return refused("not_available", "opportunity.refused.not-available", { title: "This Behavior" });
  const title = behavior.title;
  const today = caller.now.toZonedDateTimeISO(behavior.timezone);
  const times = placementTimes(input.placement, today);
  if (!times) return refused("invalid_time", "opportunity.refused.time", {});

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
    return refused(reason, ADD_REFUSAL_NOTICES[reason], { title });
  }

  if (added.occurrence.status === "unresolved") {
    await planReminders(caller, behavior, added.occurrence);
  }
  const time = timeLabel(added.occurrence);
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
    return refused(reason, REMOVE_REFUSAL_NOTICES[reason], { title });
  }
}

function placementTimes(
  placement: OpportunityPlacement,
  today: Temporal.ZonedDateTime,
): { startTime: string; endTime: string | null; preset: TimeRangePreset | null } | null {
  switch (placement.kind) {
    case "done_now":
      return { startTime: wallTime(today), endTime: null, preset: null };
    case "exact":
      return TIME_PATTERN.test(placement.startTime) ? { startTime: placement.startTime, endTime: null, preset: null } : null;
    case "range":
      return TIME_PATTERN.test(placement.startTime) && TIME_PATTERN.test(placement.endTime)
        && placement.startTime !== placement.endTime
        ? { startTime: placement.startTime, endTime: placement.endTime, preset: null }
        : null;
    case "preset": {
      const preset = TIME_RANGE_PRESETS[placement.preset];
      return preset ? { startTime: preset.startTime, endTime: preset.endTime, preset: preset.preset } : null;
    }
  }
}

function wallTime(value: Temporal.ZonedDateTime): string {
  return `${String(value.hour).padStart(2, "0")}:${String(value.minute).padStart(2, "0")}`;
}

function timeLabel(occurrence: Occurrence): string {
  const start = occurrence.schedule_start_time.slice(0, 5);
  if (occurrence.schedule_kind !== "range" || !occurrence.schedule_end_time) return formatClockTimeLabel(start);
  return formatCompactOccurrenceScheduleLabel({
    scheduleKind: "range",
    schedulePreset: isPreset(occurrence.schedule_preset) ? occurrence.schedule_preset : null,
    scheduleStartTime: start,
    scheduleEndTime: occurrence.schedule_end_time.slice(0, 5),
  });
}

function isPreset(value: string | null): value is TimeRangePreset {
  return value !== null && Object.hasOwn(TIME_RANGE_PRESETS, value);
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

const ADD_REFUSAL_NOTICES = {
  not_available: "opportunity.refused.not-available",
  not_running: "opportunity.refused.not-running",
  not_today: "opportunity.refused.not-today",
  invalid_time: "opportunity.refused.time",
} as const satisfies Partial<Record<OpportunityRefusalReason, NoticeId>>;

const REMOVE_REFUSAL_NOTICES = {
  marked: "opportunity.remove-refused.marked",
  kept: "opportunity.remove-refused.kept",
  not_found: "opportunity.remove-refused.not-found",
} as const satisfies Partial<Record<OpportunityRefusalReason, NoticeId>>;

/** The add function's refusals, by its messages (supabase/migrations/20261121100000). */
function addRefusalReason(error: unknown): keyof typeof ADD_REFUSAL_NOTICES | null {
  if (!(error instanceof OpportunityRpcError)) return null;
  switch (error.message) {
    case "Behavior not found.":
    case "This Behavior is not available as an opportunity.":
    case "An archived Behavior cannot be added.":
      return "not_available";
    case "This Behavior is not running at that time.":
      return "not_running";
    case "An opportunity can be added to today only.":
      return "not_today";
    case "Opportunity times must be whole minutes.":
    case "An exact time cannot have a time-of-day preset.":
    case "A time range needs an end that differs from its start.":
      return "invalid_time";
    default:
      return null;
  }
}

function removeRefusalReason(error: unknown): keyof typeof REMOVE_REFUSAL_NOTICES | null {
  if (!(error instanceof OpportunityRpcError)) return null;
  switch (error.message) {
    case "Only an Unresolved opportunity can be removed.":
      return "marked";
    case "An opportunity with a Note cannot be removed.":
    case "An opportunity with tracked time cannot be removed.":
    case "An opportunity with status history cannot be removed.":
    case "An opportunity with a connected activity cannot be removed.":
      return "kept";
    case "Occurrence not found.":
    case "Only an added opportunity can be removed.":
      return "not_found";
    default:
      return null;
  }
}

function refused(reason: OpportunityRefusalReason, id: NoticeId, params: NoticeParams) {
  return { outcome: "refused" as const, reason, notice: { id, params } };
}
