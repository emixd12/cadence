import type { Temporal } from "@js-temporal/polyfill";
import type { NoticeId, NoticeParams } from "@cadence/core/notices";
import { formatClockTimeLabel, formatCompactOccurrenceScheduleLabel } from "@cadence/core/services/schedule";
import { TIME_RANGE_PRESETS, type TimeRangePreset } from "@cadence/core/types/schedule";
import type { OpportunityAddedBy } from "@cadence/core/types/database";
import type { OpportunityActionState } from "@cadence/core/types/timeline";

/**
 * Behaviors of Opportunity: the client-safe half of adding and removing an added item.
 * The web service (opportunity.service.ts) and Cadence for Mac
 * (apps/desktop/src/local-opportunity.service.ts) share the form parsing, the placement
 * times, the notice for each result and the refusal for each store message.
 */

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

export function opportunityPlacementTimes(
  placement: OpportunityPlacement,
  today: Temporal.ZonedDateTime,
): { startTime: string; endTime: string | null; preset: TimeRangePreset | null } | null {
  switch (placement.kind) {
    case "done_now":
      return { startTime: opportunityWallTime(today), endTime: null, preset: null };
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

export function opportunityWallTime(value: Temporal.ZonedDateTime): string {
  return `${String(value.hour).padStart(2, "0")}:${String(value.minute).padStart(2, "0")}`;
}

export function opportunityTimeLabel(occurrence: OpportunityTimeFields): string {
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

export const ADD_REFUSAL_NOTICES = {
  not_available: "opportunity.refused.not-available",
  not_running: "opportunity.refused.not-running",
  not_today: "opportunity.refused.not-today",
  invalid_time: "opportunity.refused.time",
} as const satisfies Partial<Record<OpportunityRefusalReason, NoticeId>>;

export const REMOVE_REFUSAL_NOTICES = {
  marked: "opportunity.remove-refused.marked",
  kept: "opportunity.remove-refused.kept",
  not_found: "opportunity.remove-refused.not-found",
} as const satisfies Partial<Record<OpportunityRefusalReason, NoticeId>>;

/**
 * The add refusals, by the store's messages: the hosted function
 * (supabase/migrations/20261121100000) and the Mac store (local_store/opportunity.rs)
 * use the same words.
 */
export function addRefusalReasonForMessage(message: string): keyof typeof ADD_REFUSAL_NOTICES | null {
  switch (message) {
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

export function removeRefusalReasonForMessage(message: string): keyof typeof REMOVE_REFUSAL_NOTICES | null {
  switch (message) {
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

export function refusedOpportunity(reason: OpportunityRefusalReason, id: NoticeId, params: NoticeParams) {
  return { outcome: "refused" as const, reason, notice: { id, params } };
}

/** The fields of an added row that name its time. */
export type OpportunityTimeFields = Readonly<{
  schedule_kind: string;
  schedule_preset: string | null;
  schedule_start_time: string;
  schedule_end_time: string | null;
}>;

/** The add form's state for a parse failure: a bad Behavior or a bad time. */
export function addOpportunityParseRefusal(formData: FormData): OpportunityActionState {
  return UUID_PATTERN.test(String(formData.get("behavior_id") ?? "").trim())
    ? { status: "refused", reason: "invalid_time", noticeId: "opportunity.refused.time", noticeParams: {} }
    : { status: "refused", reason: "not_available", noticeId: "opportunity.refused.not-available", noticeParams: { title: "This Behavior" } };
}

export const REMOVE_OPPORTUNITY_PARSE_REFUSAL: OpportunityActionState = {
  status: "refused", reason: "not_found", noticeId: "opportunity.remove-refused.not-found", noticeParams: {},
};

export const OPPORTUNITY_FAILED: OpportunityActionState = { status: "error", noticeId: "opportunity.failed" };

/** An add or remove result as the basket and row state. */
export function opportunityResultState(
  result: Readonly<{ outcome: "added" | "logged" | "removed"; occurrence: Readonly<{ id: string }>; notice: OpportunityNotice }>
    | Readonly<{ outcome: "refused"; reason: OpportunityRefusalReason; notice: OpportunityNotice }>,
): OpportunityActionState {
  if (result.outcome === "refused") {
    return { status: "refused", reason: result.reason, noticeId: result.notice.id, noticeParams: result.notice.params };
  }
  return { status: result.outcome, occurrenceId: result.occurrence.id, noticeId: result.notice.id, noticeParams: result.notice.params };
}
