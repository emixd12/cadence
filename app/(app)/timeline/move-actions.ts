"use server";

import { Temporal } from "@js-temporal/polyfill";
import { revalidatePath } from "next/cache";
import { MOVE_PERSON_REASONS, type MovePersonReason } from "@cadence/core/resolvers/move.resolver";
import { requireCurrentUserId } from "@/lib/auth/current-user";
import { invalidateBehaviorData } from "@/lib/cache/stable-user-data.cache";
import { effectiveStartAt } from "@cadence/core/resolvers/time.resolver";
import { systemClock } from "@/lib/services/clock";
import {
  OccurrenceMoveKeyReusedError,
  keepMovedOccurrence,
  moveOccurrenceForDay,
  recordOccurrenceMoveReason,
  revertOccurrenceMove,
  suggestOccurrenceMoveTimes,
  type OccurrenceMoveResult,
} from "@/lib/services/occurrence-move.service";
import { createClient } from "@/lib/supabase/server";
import { alongsideEnabled } from "@/lib/services/alongside-flag";
import { parseCalendarEventPlace } from "@cadence/core/resolvers/alongside.resolver";

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
    /** Where the item sits now, so the web can say "was just moved to 10:00 on another device". */
    currentStartAt: string | null;
  }>
  | Readonly<{ status: "error"; message: string }>;

export type MoveActionInput = Readonly<{
  occurrenceId: string;
  /** The Occurrence's `updated_at` as the Timeline read it. */
  expectedRevision: string;
  /** New start, HH:MM local time on the Occurrence's date. */
  startTime: string;
  /**
   * Today's calendar events, as UTC instants. `eventPlace` (Ticket 384) is the event's
   * coarse place the Timeline computed; read only while `CADENCE_ALONGSIDE` is on.
   */
  calendarBusy?: ReadonlyArray<Readonly<{ start: string; end: string; ref?: string; eventPlace?: unknown }>>;
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
      calendarBusy: toBusy(input.calendarBusy),
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

/** Free start times for the row's "Move for today" menu (Phase 2C), as UTC instants. */
export async function suggestMoveTimesAction(input: Readonly<{
  occurrenceId: string;
  calendarBusy?: MoveActionInput["calendarBusy"];
}>): Promise<readonly string[]> {
  try {
    const caller = await personCaller();
    const starts = await suggestOccurrenceMoveTimes(caller, {
      occurrenceId: input.occurrenceId, calendarBusy: toBusy(input.calendarBusy),
    });
    return starts.map((start) => start.toString());
  } catch {
    return [];
  }
}

/** "Yes, keep it here" on a schedule-edit collision notice. */
export async function keepMovedOccurrenceAction(input: Readonly<{ conflictId: string }>)
  : Promise<Readonly<{ status: "kept" } | { status: "error"; message: string }>> {
  try {
    const caller = await personCaller();
    await keepMovedOccurrence(caller.supabase, input.conflictId);
    revalidatePath("/timeline");
    return { status: "kept" };
  } catch {
    return { status: "error", message: "Cadence could not save that answer. Try again." };
  }
}

function toBusy(events: MoveActionInput["calendarBusy"]) {
  const placesOn = alongsideEnabled();
  return (events ?? []).map((event) => {
    // Ticket 384: a malformed place, or any place while the flag is off, is unknown.
    const eventPlace = placesOn ? parseCalendarEventPlace(event.eventPlace) : null;
    return { start: Temporal.Instant.from(event.start), end: Temporal.Instant.from(event.end), ref: event.ref, ...(eventPlace ? { eventPlace } : {}) };
  });
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
      currentStartAt: result.occurrence ? effectiveStartAt(result.occurrence) : null,
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
