"use server";

import { Temporal } from "@js-temporal/polyfill";
import { revalidatePath } from "next/cache";
import { MOVE_PERSON_REASONS, type MovePersonReason } from "@cadence/core/resolvers/move.resolver";
import { requireCurrentUserId } from "@/lib/auth/current-user";
import { invalidateBehaviorData } from "@/lib/cache/stable-user-data.cache";
import { systemClock } from "@/lib/services/clock";
import {
  OccurrenceMoveKeyReusedError,
  moveOccurrenceForDay,
  recordOccurrenceMoveReason,
  revertOccurrenceMove,
  type OccurrenceMoveResult,
} from "@/lib/services/occurrence-move.service";
import { createClient } from "@/lib/supabase/server";

/**
 * The person's own per-day move, Undo and reason chip (advisor Phase 2A). These go
 * through the same service and database functions as the advisor and MCP clients.
 * The web Timeline (Phase 2C) passes today's calendar events so the free-slot check
 * covers them; the server keeps no calendar copy.
 */

export type MoveActionState =
  | Readonly<{
    status: "moved" | "undone";
    occurrenceId: string;
    moveId: string;
    effectiveStartAt: string | null;
    effectiveEndAt: string | null;
    revision: string;
  }>
  | Readonly<{
    status: "refused";
    occurrenceId: string;
    reason: string;
    message: string;
    alternatives: readonly string[];
    revision: string | null;
  }>
  | Readonly<{ status: "error"; message: string }>;

export type MoveActionInput = Readonly<{
  occurrenceId: string;
  /** The Occurrence's `updated_at` as the Timeline read it. */
  expectedRevision: string;
  /** New start, HH:MM local time on the Occurrence's date. */
  startTime: string;
  /** Today's calendar events, as UTC instants. */
  calendarBusy?: ReadonlyArray<Readonly<{ start: string; end: string; ref?: string }>>;
  /** Set when the move accepts an advisor proposal. */
  proposalId?: string | null;
  idempotencyKey?: string | null;
}>;

export async function moveOccurrenceAction(input: MoveActionInput): Promise<MoveActionState> {
  try {
    const caller = await personCaller();
    const result = await moveOccurrenceForDay(caller, {
      occurrenceId: input.occurrenceId, expectedRevision: input.expectedRevision, startTime: input.startTime,
      proposalId: input.proposalId ?? null, idempotencyKey: input.idempotencyKey ?? null,
      calendarBusy: (input.calendarBusy ?? []).map((event) => ({
        start: Temporal.Instant.from(event.start), end: Temporal.Instant.from(event.end), ref: event.ref,
      })),
    });
    return toState(result, input.occurrenceId);
  } catch (error) {
    return failure(error);
  }
}

export async function revertOccurrenceMoveAction(input: Readonly<{
  occurrenceId: string; expectedRevision: string; idempotencyKey?: string | null;
}>): Promise<MoveActionState> {
  try {
    const caller = await personCaller();
    const result = await revertOccurrenceMove(caller, {
      occurrenceId: input.occurrenceId, expectedRevision: input.expectedRevision, idempotencyKey: input.idempotencyKey ?? null,
    });
    return toState(result, input.occurrenceId);
  } catch (error) {
    return failure(error);
  }
}

/** The optional reason chip after a move. The first tap is kept. */
export async function recordMoveReasonAction(input: Readonly<{ moveId: string; reason: string }>)
  : Promise<Readonly<{ status: "saved"; reason: MovePersonReason } | { status: "error"; message: string }>> {
  try {
    if (!(MOVE_PERSON_REASONS as readonly string[]).includes(input.reason)) {
      return { status: "error", message: "Pick one of the listed reasons." };
    }
    const caller = await personCaller();
    const reason = await recordOccurrenceMoveReason(caller.supabase, input.moveId, input.reason as MovePersonReason);
    return { status: "saved", reason };
  } catch (error) {
    return failure(error) as { status: "error"; message: string };
  }
}

async function personCaller() {
  const userId = await requireCurrentUserId("Sign in again to move items.");
  return { supabase: await createClient(), userId, now: systemClock.now() };
}

function toState(result: OccurrenceMoveResult, occurrenceId: string): MoveActionState {
  if (result.outcome === "refused") {
    return {
      status: "refused", occurrenceId, reason: result.reason, message: result.message,
      alternatives: result.alternatives.map((start) => start.toString()), revision: result.occurrence?.updated_at ?? null,
    };
  }
  const userId = result.occurrence.user_id;
  invalidateBehaviorData(userId);
  revalidatePath("/timeline");
  return {
    status: result.outcome, occurrenceId, moveId: result.move.id,
    effectiveStartAt: result.occurrence.effective_start_at ?? null,
    effectiveEndAt: result.occurrence.effective_end_at ?? null,
    revision: result.occurrence.updated_at,
  };
}

function failure(error: unknown): MoveActionState {
  if (error instanceof OccurrenceMoveKeyReusedError) {
    return { status: "error", message: "This move was already sent with different details. Try again." };
  }
  return { status: "error", message: "Cadence could not move this item. Try again." };
}
