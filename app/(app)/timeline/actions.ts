"use server";

import {
  markOccurrenceStatusFromFormData,
  occurrenceErrorToActionState,
  updateOccurrenceNoteFromFormData,
} from "@/lib/services/occurrence.service";
import {
  resetOccurrenceTimeTracking,
  startOccurrenceTimeTracking,
  stopOccurrenceTimeTracking,
} from "@/lib/services/time-tracking.service";
import { revalidatePath } from "next/cache";
import { saveDayNoteFromFormData } from "@/lib/services/day-note.service";
import type {
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
