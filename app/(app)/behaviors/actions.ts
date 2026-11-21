"use server";

import { revalidatePath } from "next/cache";
import { noticeText } from "@cadence/core/notices";
import { toBehaviorView } from "@cadence/core/services/behavior-views";

import type { BehaviorActionState } from "@/lib/types/behavior";
import {
  markOccurrenceStatusFromFormData,
  occurrenceErrorToActionState,
  updateOccurrenceNoteFromFormData,
} from "@/lib/services/occurrence.service";
import {
  applyBehaviorRunActionFromFormData,
  archiveBehaviorFromFormData,
  behaviorErrorToActionState,
  createBehaviorFromFormData,
  createBehaviorGroupForUser,
  reorderSubBehaviorsFromFormData,
  restoreBehaviorFromFormData,
  updateBehaviorArchiveNoteFromFormData,
  updateBehaviorFromFormData,
} from "@/lib/services/behavior.service";
import {
  resetOccurrenceTimeTracking,
  stopOccurrenceTimeTracking,
} from "@/lib/services/time-tracking.service";
import { createClient } from "@/lib/supabase/server";
import { requireCurrentUserId } from "@/lib/auth/current-user";
import { hasDraftSubBehaviors, parseBehaviorGroupFormData } from "@/components/behaviors/sub-behavior-form-data";
import type {
  OccurrenceActionState,
  TimelineStatus,
  TimeTrackingActionState,
} from "@/lib/types/timeline";

type SubmittedStatus = TimelineStatus;

export async function createBehaviorAction(
  _previousState: BehaviorActionState,
  formData: FormData,
): Promise<BehaviorActionState> {
  try {
    if (hasDraftSubBehaviors(formData)) {
      const group = parseBehaviorGroupFormData(formData);
      const supabase = await createClient();
      const userId = await requireCurrentUserId("Sign in again before saving behaviors.");
      const created = await createBehaviorGroupForUser(supabase, userId, group);
      revalidatePath("/behaviors");
      revalidatePath("/timeline");

      return {
        status: "success",
        message: noticeText("sub-behaviors.group-created", {
          title: created.parent.title, count: created.subBehaviors.length,
        }),
        behavior: toBehaviorView(created.parent),
      };
    }

    const behavior = await createBehaviorFromFormData(formData);
    if (behavior.parentBehaviorId) revalidatePath("/behaviors");
    revalidatePath("/timeline");

    return {
      status: "success",
      message: "Behavior created.",
      behavior,
    };
  } catch (error) {
    return behaviorErrorToActionState(error);
  }
}

/** Sibling order under one parent: parent_behavior_id and repeated sub_behavior_id. */
export async function reorderSubBehaviorsAction(
  _previousState: BehaviorActionState,
  formData: FormData,
): Promise<BehaviorActionState> {
  try {
    await reorderSubBehaviorsFromFormData(formData);
    revalidatePath("/behaviors");
    revalidatePath("/timeline");

    return { status: "success", message: noticeText("sub-behaviors.reordered") };
  } catch (error) {
    return behaviorErrorToActionState(error);
  }
}

export async function updateBehaviorAction(
  _previousState: BehaviorActionState,
  formData: FormData,
): Promise<BehaviorActionState> {
  try {
    await updateBehaviorFromFormData(formData);
    revalidatePath("/behaviors");
    revalidatePath("/timeline");

    return {
      status: "success",
      message: "Behavior saved.",
    };
  } catch (error) {
    return behaviorErrorToActionState(error);
  }
}

export async function archiveBehaviorAction(
  _previousState: BehaviorActionState,
  formData: FormData,
): Promise<BehaviorActionState> {
  try {
    await archiveBehaviorFromFormData(formData);
    revalidatePath("/behaviors");
    revalidatePath("/timeline");

    return {
      status: "success",
      message: "Behavior archived.",
    };
  } catch (error) {
    return behaviorErrorToActionState(error);
  }
}

export async function restoreBehaviorAction(
  _previousState: BehaviorActionState,
  formData: FormData,
): Promise<BehaviorActionState> {
  try {
    await restoreBehaviorFromFormData(formData);
    revalidatePath("/behaviors");
    revalidatePath("/timeline");

    return {
      status: "success",
      message: "Behavior restored.",
    };
  } catch (error) {
    return behaviorErrorToActionState(error);
  }
}

/**
 * End now, Start again, Pause and Resume now, from the Behaviors list and the Timeline
 * notices (Ended and Paused plan). Messages are logged in docs/MESSAGING_CHANGES.md.
 */
export async function behaviorRunAction(
  _previousState: BehaviorActionState,
  formData: FormData,
): Promise<BehaviorActionState> {
  try {
    const result = await applyBehaviorRunActionFromFormData(formData);
    revalidatePath("/behaviors");
    revalidatePath("/timeline");
    return { status: "success", message: result.message };
  } catch (error) {
    return behaviorErrorToActionState(error);
  }
}

export async function updateBehaviorArchiveNoteAction(
  _previousState: BehaviorActionState,
  formData: FormData,
): Promise<BehaviorActionState> {
  try {
    await updateBehaviorArchiveNoteFromFormData(formData);
    revalidatePath("/behaviors");
    return { status: "success", message: "Archive note saved." };
  } catch (error) {
    return behaviorErrorToActionState(error);
  }
}

export async function markBehaviorReviewOccurrenceStatusAction(
  _previousState: OccurrenceActionState,
  formData: FormData,
): Promise<OccurrenceActionState> {
  try {
    const nextStatus = getSubmittedStatus(formData);

    await markOccurrenceStatusFromFormData(formData);
    revalidatePath("/behaviors");
    revalidatePath("/timeline");

    return {
      status: "success",
      message: "Occurrence updated.",
      ...(nextStatus ? { nextStatus } : {}),
    };
  } catch (error) {
    return occurrenceErrorToActionState(error);
  }
}

export async function updateBehaviorReviewOccurrenceNoteAction(
  _previousState: OccurrenceActionState,
  formData: FormData,
): Promise<OccurrenceActionState> {
  try {
    await updateOccurrenceNoteFromFormData(formData);
    revalidatePath("/behaviors");

    return {
      status: "success",
      message: "Note saved.",
    };
  } catch (error) {
    return occurrenceErrorToActionState(error);
  }
}

export async function resetBehaviorReviewOccurrenceTimeTrackingAction(
  _previousState: TimeTrackingActionState,
  formData: FormData,
): Promise<TimeTrackingActionState> {
  const occurrenceId = formData.get("occurrence_id");

  if (typeof occurrenceId !== "string" || occurrenceId.length === 0) {
    return {
      status: "error",
      message: "Choose an occurrence before resetting tracked time.",
    };
  }

  try {
    const result = await resetOccurrenceTimeTracking(occurrenceId);
    revalidatePath("/behaviors");
    revalidatePath("/timeline");

    return {
      status: "success",
      message: "Tracked time reset.",
      tracking: {
        recordedSeconds: result.tracking.recordedSeconds,
        runningStartedAt: result.tracking.runningSession?.startedAt ?? null,
      },
    };
  } catch {
    return {
      status: "error",
      message: "Unable to reset tracked time.",
    };
  }
}

export async function stopBehaviorReviewOccurrenceTimeTrackingAction(
  _previousState: TimeTrackingActionState,
  formData: FormData,
): Promise<TimeTrackingActionState> {
  const occurrenceId = formData.get("occurrence_id");

  if (typeof occurrenceId !== "string" || occurrenceId.length === 0) {
    return {
      status: "error",
      message: "Choose an occurrence before stopping tracked time.",
    };
  }

  try {
    const result = await stopOccurrenceTimeTracking(occurrenceId);
    revalidatePath("/behaviors");
    revalidatePath("/timeline");

    return {
      status: "success",
      message: "Time tracking stopped.",
      tracking: {
        recordedSeconds: result.tracking.recordedSeconds,
        runningStartedAt: result.tracking.runningSession?.startedAt ?? null,
      },
    };
  } catch {
    return {
      status: "error",
      message: "Unable to stop time tracking.",
    };
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
