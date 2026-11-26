"use server";

import {
  markOccurrenceStatusFromFormData,
  markParentSlotStatusFromFormData,
  occurrenceErrorToActionState,
  updateOccurrenceNoteFromFormData,
} from "@/lib/services/occurrence.service";
import {
  resetOccurrenceTimeTracking,
  startOccurrenceTimeTracking,
  stopOccurrenceTimeTracking,
} from "@/lib/services/time-tracking.service";
import { noticeText } from "@cadence/core/notices";
import { revalidatePath } from "next/cache";
import { saveDayNoteFromFormData } from "@/lib/services/day-note.service";
import {
  createPeriodFromFormData,
  deletePeriodFromFormData,
  endPeriodFromFormData,
  periodErrorToActionState,
  updatePeriodFromFormData,
} from "@/lib/services/period.service";
import type { PeriodActionState, PeriodNoticeId } from "@cadence/core/types/period";
import { setBehaviorDefaultDurationForCurrentUser } from "@/lib/services/timeline.service";
import type {
  DefaultDurationActionState,
  OccurrenceActionState,
  TimelineStatus,
  TimeTrackingActionState,
} from "@/lib/types/timeline";

type SubmittedStatus = TimelineStatus;

export async function markOccurrenceStatusAction(
  _previousState: OccurrenceActionState,
  formData: FormData,
): Promise<OccurrenceActionState> {
  try {
    const nextStatus = getSubmittedStatus(formData);

    await markOccurrenceStatusFromFormData(formData);
    // StatusButtons refreshes after completion feedback. Revalidating here can
    // unmount the submitting row before the client-side chime effect runs.

    return {
      status: "success",
      message: "Occurrence updated.",
      ...(nextStatus ? { nextStatus } : {}),
    };
  } catch (error) {
    return occurrenceErrorToActionState(error);
  }
}

/** Sub-behaviors: Completed or Not Completed for every sub-behavior in one routine slot. */
export async function markParentSlotStatusAction(
  _previousState: OccurrenceActionState,
  formData: FormData,
): Promise<OccurrenceActionState> {
  try {
    const nextStatus = getSubmittedStatus(formData);
    await markParentSlotStatusFromFormData(formData);
    return {
      status: "success",
      message: noticeText("sub-behaviors.routine-marked"),
      ...(nextStatus ? { nextStatus } : {}),
    };
  } catch (error) {
    return occurrenceErrorToActionState(error);
  }
}

export async function saveDayNoteAction(
  _previousState: OccurrenceActionState,
  formData: FormData,
): Promise<OccurrenceActionState> {
  try {
    const result = await saveDayNoteFromFormData(formData);
    return {
      status: "success",
      message: result.note === null ? "Day note cleared." : "Day note saved.",
    };
  } catch (error) {
    return occurrenceErrorToActionState(error);
  }
}

/**
 * Ticket 369: adds a Period, or edits one when the form names `period_id`. A Period
 * is annotation only, so nothing else is written. Used by Timeline and Behaviors.
 */
export async function savePeriodAction(
  _previousState: PeriodActionState,
  formData: FormData,
): Promise<PeriodActionState> {
  try {
    if (formData.get("period_id")) await updatePeriodFromFormData(formData);
    else await createPeriodFromFormData(formData);
    return periodSuccess("period.saved");
  } catch (error) {
    return periodErrorToActionState(error, "Unable to save this period.");
  }
}

/** "End today": the last day becomes today in the account's timezone. */
export async function endPeriodAction(
  _previousState: PeriodActionState,
  formData: FormData,
): Promise<PeriodActionState> {
  try {
    await endPeriodFromFormData(formData);
    return periodSuccess("period.ended");
  } catch (error) {
    return periodErrorToActionState(error, "Unable to end this period.");
  }
}

/** Removes a Period for good. The control asks for a second tap first. */
export async function deletePeriodAction(
  _previousState: PeriodActionState,
  formData: FormData,
): Promise<PeriodActionState> {
  try {
    await deletePeriodFromFormData(formData);
    return periodSuccess("period.removed");
  } catch (error) {
    return periodErrorToActionState(error, "Unable to remove this period.");
  }
}

function periodSuccess(noticeId: PeriodNoticeId): PeriodActionState {
  revalidatePath("/timeline");
  revalidatePath("/behaviors");
  return { status: "success", noticeId, message: noticeText(noticeId) };
}

export async function updateOccurrenceNoteAction(
  _previousState: OccurrenceActionState,
  formData: FormData,
): Promise<OccurrenceActionState> {
  try {
    await updateOccurrenceNoteFromFormData(formData);

    return {
      status: "success",
      message: "Note saved.",
    };
  } catch (error) {
    return occurrenceErrorToActionState(error);
  }
}

function getSubmittedStatus(formData: FormData): SubmittedStatus | null {
  const value = formData.get("status");

  return value === "unresolved" ||
    value === "completed" ||
    value === "not_completed"
    ? value
    : null;
}

export async function startTimeTrackingAction(
  _previousState: TimeTrackingActionState,
  formData: FormData,
): Promise<TimeTrackingActionState> {
  return runTimeTrackingAction(formData, startOccurrenceTimeTracking, "Time tracking started.");
}

export async function stopTimeTrackingAction(
  _previousState: TimeTrackingActionState,
  formData: FormData,
): Promise<TimeTrackingActionState> {
  return runTimeTrackingAction(formData, stopOccurrenceTimeTracking, "Time tracking stopped.");
}

export async function resetTimeTrackingAction(
  _previousState: TimeTrackingActionState,
  formData: FormData,
): Promise<TimeTrackingActionState> {
  return runTimeTrackingAction(formData, resetOccurrenceTimeTracking, "Tracked time reset.");
}

export async function setBehaviorDefaultDurationAction(
  _previousState: DefaultDurationActionState,
  formData: FormData,
): Promise<DefaultDurationActionState> {
  const behaviorId = formData.get("behavior_id");
  const rawMinutes = formData.get("default_duration_minutes");

  if (typeof behaviorId !== "string" || behaviorId.length === 0) {
    const noticeId = "timeline.duration-choose-behavior" as const;
    return { status: "error", noticeId, message: noticeText(noticeId) };
  }

  const trimmed = typeof rawMinutes === "string" ? rawMinutes.trim() : "";
  const minutes = Number(trimmed);
  if (!trimmed || !Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
    const noticeId = "timeline.duration-invalid-minutes" as const;
    return { status: "error", noticeId, message: noticeText(noticeId) };
  }

  try {
    const result = await setBehaviorDefaultDurationForCurrentUser(behaviorId, minutes);
    if (!result.ok) {
      return {
        status: "error",
        noticeId: result.noticeId,
        message: noticeText(result.noticeId),
      };
    }

    revalidatePath("/timeline");
    revalidatePath("/behaviors");
    const noticeId = "timeline.duration-saved" as const;
    return {
      status: "success",
      noticeId,
      message: noticeText(noticeId),
      minutes: result.minutes,
    };
  } catch {
    const noticeId = "timeline.duration-save-failed" as const;
    return { status: "error", noticeId, message: noticeText(noticeId) };
  }
}

async function runTimeTrackingAction(
  formData: FormData,
  action: (occurrenceId: string) => ReturnType<typeof resetOccurrenceTimeTracking>,
  message: string,
): Promise<TimeTrackingActionState> {
  const occurrenceId = formData.get("occurrence_id");
  const requestId = readTimeTrackingRequestId(formData);

  if (typeof occurrenceId !== "string" || occurrenceId.length === 0) {
    return {
      status: "error",
      message: "Choose an occurrence before tracking time.",
      ...(requestId ? { requestId } : {}),
    };
  }

  try {
    const result = await action(occurrenceId);
    revalidatePath("/timeline");

    return {
      status: "success",
      message,
      tracking: {
        recordedSeconds: result.tracking.recordedSeconds,
        runningStartedAt: result.tracking.runningSession?.startedAt ?? null,
      },
      ...(requestId ? { requestId } : {}),
    };
  } catch (error) {
    return {
      status: "error",
      message: timeTrackingActionErrorMessage(error),
      ...(requestId ? { requestId } : {}),
    };
  }
}

function readTimeTrackingRequestId(formData: FormData): string | null {
  const value = formData.get("client_action_id");

  return typeof value === "string" && /^[a-z0-9-]{1,80}$/i.test(value)
    ? value
    : null;
}

function timeTrackingActionErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Unable to update tracked time.";
  }

  return error.message === "Sign in again before tracking time." ||
    error.message === "This occurrence is no longer available." ||
    error.message ===
      "Time tracking is available for active behaviors on today's Timeline or in Needs decision."
    ? error.message
    : "Unable to update tracked time.";
}
