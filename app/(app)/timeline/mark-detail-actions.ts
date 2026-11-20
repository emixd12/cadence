"use server";

import { Temporal } from "@js-temporal/polyfill";
import { isNotDoneReason } from "@cadence/core/resolvers/status.resolver";
import { parseOccurrenceId } from "@cadence/core/services/occurrence.service";
import { requireCurrentUserId } from "@/lib/auth/current-user";
import { recordOccurrenceDoneAt, recordOccurrenceNotDoneReason } from "@/lib/services/occurrence.service";
import { createClient } from "@/lib/supabase/server";
import type { MarkDetailState } from "@/components/timeline/OccurrenceMarkDetails";

/**
 * Advisor plan 4G: the web Timeline's "Done at" and "Why?" lines. Both append a
 * same-status event through `apply_occurrence_mark_detail`; a refusal comes back as a
 * plain sentence for the row's "Not changed." line.
 */

export async function recordDoneAtAction(input: Readonly<{ occurrenceId: string; doneAt: string }>): Promise<MarkDetailState> {
  return run(async (supabase, userId) => {
    let doneAt: Temporal.Instant;
    try { doneAt = Temporal.Instant.from(input.doneAt); } catch { throw new Error("Pick a time."); }
    await recordOccurrenceDoneAt(supabase, userId, { occurrenceId: parseOccurrenceId(input.occurrenceId), doneAt, now: Temporal.Now.instant() });
  });
}

export async function recordNotDoneReasonAction(input: Readonly<{ occurrenceId: string; reason: string }>): Promise<MarkDetailState> {
  return run(async (supabase, userId) => {
    if (!isNotDoneReason(input.reason)) throw new Error("Choose one of the listed reasons.");
    await recordOccurrenceNotDoneReason(supabase, userId, { occurrenceId: parseOccurrenceId(input.occurrenceId), reason: input.reason, now: Temporal.Now.instant() });
  });
}

async function run(write: (supabase: Awaited<ReturnType<typeof createClient>>, userId: string) => Promise<void>): Promise<MarkDetailState> {
  try {
    const userId = await requireCurrentUserId("Sign in again to change this item.");
    const supabase = await createClient();
    await write(supabase, userId);
    return { status: "saved" };
  } catch (error) {
    return { status: "refused", message: error instanceof Error ? error.message : "Try again." };
  }
}
