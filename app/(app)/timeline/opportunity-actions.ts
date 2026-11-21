"use server";

import { revalidatePath } from "next/cache";
import { requireCurrentUserId } from "@/lib/auth/current-user";
import { invalidateBehaviorData } from "@/lib/cache/stable-user-data.cache";
import { systemClock } from "@/lib/services/clock";
import {
  addOpportunityToToday,
  parseAddOpportunityFormData,
  parseRemoveOpportunityFormData,
  removeOpportunityFromToday,
  type AddOpportunityResult,
  type RemoveOpportunityResult,
} from "@/lib/services/opportunity.service";
import { createClient } from "@/lib/supabase/server";
import type { OpportunityActionState } from "@/lib/types/timeline";

/**
 * Behaviors of Opportunity: the Timeline's Opportunity Basket (add at a time or range,
 * Done now) and a row's Remove, from today or Needs decision. Each returns the notice
 * to show; the hosted functions hold the rules.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FAILED: OpportunityActionState = { status: "error", noticeId: "opportunity.failed" };

export async function addOpportunityOccurrenceAction(
  _previousState: OpportunityActionState,
  formData: FormData,
): Promise<OpportunityActionState> {
  const input = parseAddOpportunityFormData(formData);
  if (!input) {
    return UUID.test(String(formData.get("behavior_id") ?? "").trim())
      ? { status: "refused", reason: "invalid_time", noticeId: "opportunity.refused.time", noticeParams: {} }
      : { status: "refused", reason: "not_available", noticeId: "opportunity.refused.not-available", noticeParams: { title: "This Behavior" } };
  }
  try {
    const caller = await personCaller();
    return toState(await addOpportunityToToday(caller, input), caller.userId);
  } catch {
    return FAILED;
  }
}

export async function removeOpportunityOccurrenceAction(
  _previousState: OpportunityActionState,
  formData: FormData,
): Promise<OpportunityActionState> {
  const input = parseRemoveOpportunityFormData(formData);
  if (!input) {
    return { status: "refused", reason: "not_found", noticeId: "opportunity.remove-refused.not-found", noticeParams: {} };
  }
  try {
    const caller = await personCaller();
    return toState(await removeOpportunityFromToday(caller, input), caller.userId);
  } catch {
    return FAILED;
  }
}

async function personCaller() {
  const userId = await requireCurrentUserId("Sign in again to change today's items.");
  return { supabase: await createClient(), userId, now: systemClock.now() };
}

function toState(result: AddOpportunityResult | RemoveOpportunityResult, userId: string): OpportunityActionState {
  if (result.outcome === "refused") {
    return { status: "refused", reason: result.reason, noticeId: result.notice.id, noticeParams: result.notice.params };
  }
  invalidateBehaviorData(userId);
  revalidatePath("/timeline");
  return {
    status: result.outcome,
    occurrenceId: result.occurrence.id,
    noticeId: result.notice.id,
    noticeParams: result.notice.params,
  };
}
