import { createHash } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import {
  effectiveEndAt,
  effectiveStartInstant,
  fixedClock,
  isMoved,
  localDateAt,
  todayIn,
  zonedInstant,
} from "@cadence/core/resolvers/time.resolver";
import {
  MOVE_ALTERNATIVES_LIMIT,
  MOVE_REFUSAL_MESSAGES,
  findMoveConflicts,
  type MoveCalendarBusy,
  type MovePersonReason,
  type MoveRefusalReason,
} from "@cadence/core/resolvers/move.resolver";
import {
  briefMoveFreeStarts,
  briefMoveItemBlocks,
  briefMoveRoutineMembers,
  collapseBriefMoveRoutines,
  checkBriefMoveSlot,
  travelBlocksFor,
  type BriefMoveBlock,
  type BriefMoveTravelInput,
} from "@cadence/core/resolvers/brief-move.resolver";
import type { BriefMoveLength, BriefMoveLengthSource } from "@cadence/core/types/brief-moves";
import type { AppSupabaseClient, BehaviorWithCategory } from "@/lib/db/behaviors.repo";
import { getBehaviorById } from "@/lib/db/behaviors.repo";
import { getOccurrenceById } from "@/lib/db/occurrences.repo";
import { readBriefMoveDay, type BriefMoveDay } from "@/lib/services/brief-move-day.service";
import { syncReminderDeliveriesForBehavior } from "@/lib/services/reminder.service";
import type { Occurrence } from "@/lib/types/database";
import type { Tables } from "@/lib/db/database.types";
import { noticeText } from "@cadence/core/notices";

/**
 * Per-day moves (advisor plan, Phase 2A): the one path every caller takes to move
 * today's Occurrence or undo its latest move. The web session, the Daily Brief, chat
 * and MCP clients all come through here and then through the database functions
 * `move_occurrence_for_day` / `revert_occurrence_move`, which enforce status,
 * revision, today, range and same-day rules. This service adds what needs durations
 * and the day's other items: the item's length, the free-slot check, alternatives
 * for a refusal, and the reminder resync. Rules: docs/DATETIME_STRATEGY.md, "Moves".
 *
 * Phase 3A1: the free-slot check and the "other times" list are the one rule set the
 * Daily Brief's planner uses (packages/core/src/resolvers/brief-move.resolver.ts): a
 * 10-minute gap, a range item blocks only its own length, every item has a length.
 *
 * Routines (sub-behaviors): with `routine: true`, a move takes every step that follows
 * the routine's time in the same slot to the new start, each with its own length, and
 * checks the slot for their summed length. When a step cannot move, the steps already
 * moved go back, so the routine never ends up split. Undo with `routine: true` puts
 * every moved step of the slot back.
 */

export type OccurrenceMoveRecord = Omit<Tables<"occurrence_moves">, "user_id" | "client_ref" | "idempotency_key" | "request_hash">;

export type OccurrenceMoveCaller = Readonly<{
  supabase: AppSupabaseClient;
  userId: string;
  now: Temporal.Instant;
}>;

export type OccurrenceMoveRequest = Readonly<{
  occurrenceId: string;
  /** The Occurrence's `updated_at` as the caller read it. */
  expectedRevision: string;
  /** New start as a local time (HH:MM) on the Occurrence's date, or as an instant. */
  startTime?: string;
  startAt?: string;
  /** Optional planner reason code (lowercase snake case). */
  reason?: string | null;
  proposalId?: string | null;
  idempotencyKey?: string | null;
  requestHash?: string | null;
  /** Today's calendar events, when the caller holds them. The server keeps no copy. */
  calendarBusy?: readonly MoveCalendarBusy[];
  /**
   * The length a brief line showed, so Yes applies exactly what was offered. Absent:
   * a moved item keeps its length, otherwise the shared length order decides.
   */
  length?: BriefMoveLength | null;
  /** Verified signed travel times for this request only (never stored). */
  travel?: BriefMoveTravelInput | null;
  /** Move the whole routine slot the Occurrence is a step of (a Daily Brief routine line). */
  routine?: boolean;
}>;

export type OccurrenceRevertRequest = Readonly<{
  occurrenceId: string;
  expectedRevision: string;
  moveId?: string | null;
  idempotencyKey?: string | null;
  requestHash?: string | null;
  /** Also put back every other moved step of the same routine slot. */
  routine?: boolean;
}>;

export type OccurrenceMoveResult =
  | Readonly<{
    outcome: "moved" | "undone";
    replayed: boolean;
    occurrence: Occurrence;
    behavior: BehaviorWithCategory;
    move: OccurrenceMoveRecord;
    /** A routine move or Undo: the other steps it moved, in step order. */
    steps?: readonly Readonly<{ occurrence: Occurrence; move: OccurrenceMoveRecord }>[];
  }>
  | Readonly<{
    outcome: "refused";
    reason: MoveRefusalReason | "occurrence_not_found";
    /**
     * The one rule's finer reason when it differs from `reason`: `too_close` (the
     * 10-minute gap) and `travel_busy` read as `slot_taken` to MCP clients.
     */
    detail?: "too_close" | "travel_busy";
    message: string;
    alternatives: readonly Temporal.Instant[];
    occurrence: Occurrence | null;
    behavior: BehaviorWithCategory | null;
  }>;

/** Thrown when the same idempotency key arrives with a different request. */
export class OccurrenceMoveKeyReusedError extends Error {
  constructor() { super("occurrence_move_idempotency_key_reused"); }
}

const ALTERNATIVE_REASONS: ReadonlySet<string> = new Set(["time_passed", "start_not_on_day", "slot_taken", "calendar_busy"]);
const DETAIL_MESSAGES = Object.freeze({
  too_close: noticeText("move.refused.too-close"),
  travel_busy: noticeText("move.refused.travel-busy"),
});

/** Move today's Occurrence to a new start. Refusals come back as values, not errors. */
export async function moveOccurrenceForDay(caller: OccurrenceMoveCaller, request: OccurrenceMoveRequest): Promise<OccurrenceMoveResult> {
  const loaded = await loadTarget(caller, request.occurrenceId);
  if (!loaded) return refused("occurrence_not_found", null, null);
  const { occurrence, behavior } = loaded;
  const requestedStart = request.startTime
    ? zonedInstant(occurrence.local_date, request.startTime, behavior.timezone)
    : Temporal.Instant.from(request.startAt ?? "");
  const day = await readBriefMoveDay(caller.supabase, caller.userId, occurrence.local_date);
  const steps = request.routine ? briefMoveRoutineMembers(day.items, occurrence.id).filter((item) => item.occurrenceId !== occurrence.id) : [];
  // A routine line shows the routine's summed length; each step keeps its own length.
  const duration = moveDuration(occurrence, day, steps.length ? null : request.length ?? null);
  const slotSeconds = steps.length ? request.length ? request.length.minutes * 60 : routineSeconds(day, occurrence.id) : duration.seconds;
  const interval = { start: requestedStart, end: requestedStart.add({ seconds: duration.seconds }) };
  const slotInterval = { start: requestedStart, end: requestedStart.add({ seconds: slotSeconds }) };
  const slot = slotInputs(occurrence.id, day, request.calendarBusy, request.travel ?? null);

  // The database answers the basic refusals (resolved, not today, changed since read,
  // time passed). The slot check runs only on a request that passes those, so its
  // reason never hides a more basic one.
  if (passesBasicRules(caller, occurrence, behavior, request.expectedRevision, requestedStart)) {
    const check = checkBriefMoveSlot({ interval: slotInterval, blocks: slot.blocks, travelBeforeSeconds: slot.before, travelAfterSeconds: slot.after });
    if (!check.ok) {
      const reason = check.reason === "calendar_busy" ? "calendar_busy" : "slot_taken";
      const detail = check.reason === "too_close" || check.reason === "travel_busy" ? check.reason : undefined;
      return refused(reason, occurrence, behavior, alternativesFor(caller, occurrence, behavior, requestedStart, slotSeconds, slot), detail);
    }
  }

  const result = await callMoveFunction(caller, request, interval, duration);
  if (result.outcome === "refused") {
    const reason = result.reason as MoveRefusalReason;
    const alternatives = ALTERNATIVE_REASONS.has(reason)
      ? alternativesFor(caller, occurrence, behavior, requestedStart, slotSeconds, slot)
      : [];
    return refused(reason, result.occurrence ?? occurrence, behavior, alternatives);
  }
  if (!steps.length) return finish(caller, result, behavior, "moved");

  const moved: Array<Readonly<{ result: FunctionResult; behavior: BehaviorWithCategory }>> = [];
  for (const step of steps) {
    const row = day.occurrences.get(step.occurrenceId);
    const stepBehavior = row ? await getBehaviorById(caller.supabase, caller.userId, row.behavior_id) : null;
    if (!row || !stepBehavior) continue;
    const stepDuration = moveDuration(row, day, null);
    const stepResult = await callMoveFunction(caller, {
      ...request, occurrenceId: row.id, expectedRevision: row.updated_at, proposalId: null, length: null, routine: false,
      idempotencyKey: request.idempotencyKey ? `${request.idempotencyKey}:step:${row.id}` : null,
      requestHash: request.idempotencyKey ? stepHash("move_occurrence_for_day", request.idempotencyKey, row.id, requestedStart.toString()) : null,
    }, { start: requestedStart, end: requestedStart.add({ seconds: stepDuration.seconds }) }, stepDuration);
    if (stepResult.outcome === "refused") {
      // One step changed since the day was read: put back what moved, so the routine stays whole.
      await revertMoved(caller, [...moved.map((item) => item.result), result], request.idempotencyKey);
      return refused("revision_changed", occurrence, behavior);
    }
    moved.push({ result: stepResult, behavior: stepBehavior });
  }
  for (const item of moved) await finish(caller, item.result, item.behavior, "moved");
  const lead = await finish(caller, result, behavior, "moved");
  return lead.outcome === "refused" ? lead : { ...lead, steps: moved.map((item) => ({ occurrence: item.result.occurrence!, move: item.result.move! })) };
}

/** A routine slot's summed length in seconds, as the one rule sees it. */
function routineSeconds(day: BriefMoveDay, occurrenceId: string): number {
  const lead = briefMoveRoutineMembers(day.items, occurrenceId)[0];
  const collapsed = collapseBriefMoveRoutines(day.items).find((item) => item.occurrenceId === lead?.occurrenceId);
  return (collapsed?.length.minutes ?? 30) * 60;
}

/** Reverts moves this request just made, newest first. Best effort: a refusal leaves that step where it is. */
async function revertMoved(caller: OccurrenceMoveCaller, results: readonly FunctionResult[], key: string | null | undefined): Promise<void> {
  for (const item of [...results].reverse()) {
    if (!item.occurrence || !item.move) continue;
    const { error } = await caller.supabase.rpc("revert_occurrence_move", {
      p_occurrence_id: item.occurrence.id, p_expected_revision: item.occurrence.updated_at, p_move_id: item.move.id,
      ...keyParams("revert_occurrence_move", { occurrenceId: item.occurrence.id, expectedRevision: item.occurrence.updated_at,
        idempotencyKey: key ? `${key}:rollback:${item.occurrence.id}` : null }),
    });
    if (error) throw mapRpcError(error);
  }
}

/** Undo the latest move of today's Occurrence. */
export async function revertOccurrenceMove(caller: OccurrenceMoveCaller, request: OccurrenceRevertRequest): Promise<OccurrenceMoveResult> {
  const loaded = await loadTarget(caller, request.occurrenceId);
  if (!loaded) return refused("occurrence_not_found", null, null);
  const steps = request.routine ? await movedRoutineSteps(caller, loaded.occurrence) : [];
  const { data, error } = await caller.supabase.rpc("revert_occurrence_move", {
    p_occurrence_id: request.occurrenceId,
    p_expected_revision: request.expectedRevision,
    ...(request.moveId ? { p_move_id: request.moveId } : {}),
    ...keyParams("revert_occurrence_move", request),
  });
  if (error) throw mapRpcError(error);
  const result = readFunctionResult(data, caller.userId);
  if (result.outcome === "refused") {
    return refused(result.reason as MoveRefusalReason, result.occurrence ?? loaded.occurrence, loaded.behavior);
  }
  if (!steps.length) return finish(caller, result, loaded.behavior, "undone");
  const undone: Array<Readonly<{ result: FunctionResult; behavior: BehaviorWithCategory }>> = [];
  for (const step of steps) {
    const stepBehavior = await getBehaviorById(caller.supabase, caller.userId, step.behavior_id);
    if (!stepBehavior) continue;
    const reverted = await caller.supabase.rpc("revert_occurrence_move", {
      p_occurrence_id: step.id, p_expected_revision: step.updated_at,
      ...keyParams("revert_occurrence_move", { occurrenceId: step.id, expectedRevision: step.updated_at,
        idempotencyKey: request.idempotencyKey ? `${request.idempotencyKey}:step:${step.id}` : null,
        requestHash: request.idempotencyKey ? stepHash("revert_occurrence_move", request.idempotencyKey, step.id, null) : null }),
    });
    if (reverted.error) throw mapRpcError(reverted.error);
    const stepResult = readFunctionResult(reverted.data, caller.userId);
    // A step someone moved or marked since stays where they put it.
    if (stepResult.outcome !== "refused") undone.push({ result: stepResult, behavior: stepBehavior });
  }
  for (const item of undone) await finish(caller, item.result, item.behavior, "undone");
  const lead = await finish(caller, result, loaded.behavior, "undone");
  return lead.outcome === "refused" ? lead : { ...lead, steps: undone.map((item) => ({ occurrence: item.result.occurrence!, move: item.result.move! })) };
}

/** The other moved steps of `occurrence`'s routine slot, read before its Undo. */
async function movedRoutineSteps(caller: OccurrenceMoveCaller, occurrence: Occurrence): Promise<Occurrence[]> {
  const day = await readBriefMoveDay(caller.supabase, caller.userId, occurrence.local_date);
  return briefMoveRoutineMembers(day.items, occurrence.id)
    .filter((item) => item.occurrenceId !== occurrence.id)
    .flatMap((item) => {
      const row = day.occurrences.get(item.occurrenceId);
      return row && isMoved(row) ? [row] : [];
    });
}

/** Keep the first reason chip a person taps after a move. Returns the stored reason. */
export async function recordOccurrenceMoveReason(
  supabase: AppSupabaseClient, moveId: string, reason: MovePersonReason,
): Promise<MovePersonReason> {
  const { data, error } = await supabase.rpc("record_occurrence_move_reason", { p_move_id: moveId, p_person_reason: reason });
  if (error) throw error;
  return data as MovePersonReason;
}

/**
 * Free start times today for the web's "Move for today" menu (Phase 2C): the same
 * free-slot search a refusal offers, nearest the item's current time (or now, once
 * that has passed). Empty when the item cannot be moved.
 */
export async function suggestOccurrenceMoveTimes(
  caller: OccurrenceMoveCaller,
  request: Readonly<{ occurrenceId: string; calendarBusy?: readonly MoveCalendarBusy[]; travel?: BriefMoveTravelInput | null; limit?: number }>,
): Promise<Temporal.Instant[]> {
  const loaded = await loadTarget(caller, request.occurrenceId);
  if (!loaded) return [];
  const { occurrence, behavior } = loaded;
  if (occurrence.status !== "unresolved" || occurrence.schedule_kind !== "exact"
    || occurrence.local_date !== todayIn(fixedClock(caller.now), behavior.timezone)) return [];
  const current = effectiveStartInstant(occurrence);
  const requestedStart = Temporal.Instant.compare(current, caller.now) > 0 ? current : caller.now;
  const day = await readBriefMoveDay(caller.supabase, caller.userId, occurrence.local_date);
  const duration = moveDuration(occurrence, day, null);
  const slot = slotInputs(occurrence.id, day, request.calendarBusy, request.travel ?? null);
  return briefMoveFreeStarts({
    localDate: occurrence.local_date, timezone: behavior.timezone, now: caller.now, near: requestedStart,
    lengthSeconds: duration.seconds, blocks: slot.blocks, travelBeforeSeconds: slot.before, travelAfterSeconds: slot.after,
    limit: request.limit ?? MOVE_ALTERNATIVES_LIMIT, exclude: [current],
  });
}

/** Open schedule-edit collision notices for one local date, oldest first. */
export async function listOpenMoveConflicts(caller: OccurrenceMoveCaller, localDate: string)
  : Promise<ReadonlyArray<Readonly<{ id: string; occurrenceId: string; conflictingOccurrenceId: string | null }>>> {
  const { data, error } = await caller.supabase.from("move_conflicts")
    .select("id, occurrence_id, conflicting_occurrence_id")
    .eq("user_id", caller.userId).eq("local_date", localDate).eq("status", "open")
    .order("detected_at").order("id");
  if (error) throw error;
  return (data ?? []).map((row) => ({ id: row.id, occurrenceId: row.occurrence_id, conflictingOccurrenceId: row.conflicting_occurrence_id }));
}

/** "Yes, keep it here" on a move_conflict notice. */
export async function keepMovedOccurrence(supabase: AppSupabaseClient, conflictId: string): Promise<void> {
  const { error } = await supabase.rpc("keep_moved_occurrence", { p_conflict_id: conflictId });
  if (error) throw error;
}

/**
 * Whether the person has ever moved an item, themselves or by a Yes to the Daily Brief,
 * for the one-time first-move line (Phase 3A1: a brief Yes counts as their move).
 */
export async function hasPersonMovedBefore(caller: Pick<OccurrenceMoveCaller, "supabase" | "userId">): Promise<boolean> {
  const { data, error } = await caller.supabase.from("occurrence_moves").select("id")
    .eq("user_id", caller.userId).eq("kind", "move").in("source", ["person", "daily_brief"]).limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

// ------------------------------------------------------------------ helpers

type FunctionResult = Readonly<{
  outcome: "applied" | "replayed" | "refused";
  reason: string | null;
  occurrence: Occurrence | null;
  move: OccurrenceMoveRecord | null;
}>;

async function loadTarget(caller: OccurrenceMoveCaller, occurrenceId: string) {
  const occurrence = await getOccurrenceById(caller.supabase, caller.userId, occurrenceId);
  if (!occurrence) return null;
  const behavior = await getBehaviorById(caller.supabase, caller.userId, occurrence.behavior_id);
  return behavior ? { occurrence, behavior } : null;
}

/**
 * The length a move applies: the length the brief line showed, else the length a
 * moved item already has, else the shared length order (setting, logged average,
 * cached estimate, 30 minutes).
 */
function moveDuration(occurrence: Occurrence, day: BriefMoveDay, shown: BriefMoveLength | null)
  : Readonly<{ seconds: number; source: BriefMoveLengthSource | "kept_length" }> {
  if (shown) return { seconds: shown.minutes * 60, source: shown.source };
  const end = effectiveEndAt(occurrence);
  if (end) {
    const seconds = effectiveStartInstant(occurrence).until(Temporal.Instant.from(end)).total({ unit: "seconds" });
    if (seconds > 0) return { seconds, source: "kept_length" };
  }
  const item = day.items.find((candidate) => candidate.occurrenceId === occurrence.id);
  const length = item?.length ?? { minutes: 30, source: "fallback" as const };
  return { seconds: length.minutes * 60, source: length.source };
}

type SlotInputs = Readonly<{ blocks: readonly BriefMoveBlock[]; before: number; after: number }>;

/** The other items (neighbouring days included), calendar events and travel spans, and the item's own travel. */
function slotInputs(occurrenceId: string, day: BriefMoveDay, calendarBusy: readonly MoveCalendarBusy[] | undefined,
  travel: BriefMoveTravelInput | null): SlotInputs {
  const stop = travel?.stops.get(occurrenceId);
  return {
    blocks: [
      ...briefMoveItemBlocks(day.items, occurrenceId),
      ...(calendarBusy ?? []).map((event, index) => ({ kind: "calendar" as const, ref: event.ref ?? `calendar:${index}`, start: event.start, end: event.end })),
      ...travelBlocksFor(travel, occurrenceId),
    ],
    before: stop?.beforeSeconds ?? 0,
    after: stop?.afterSeconds ?? 0,
  };
}

/**
 * After a schedule edit: record which of today's moved Occurrences now collide with
 * another Unresolved Occurrence (open a notice), and clear notices that no longer
 * apply. Returns the number of open notices.
 */
export async function syncMoveConflicts(caller: OccurrenceMoveCaller): Promise<number> {
  const { data, error } = await caller.supabase.from("occurrences").select("local_date")
    .eq("user_id", caller.userId).eq("status", "unresolved").not("effective_start_at", "is", null)
    .gte("local_date", localDateAt(caller.now.subtract({ hours: 26 }), "UTC"))
    .lte("local_date", localDateAt(caller.now.add({ hours: 26 }), "UTC"));
  if (error) throw error;
  let open = 0;
  for (const localDate of [...new Set((data ?? []).map((row) => row.local_date))].sort()) {
    const day = await readBriefMoveDay(caller.supabase, caller.userId, localDate);
    const items = day.items.filter((item) => item.localDate === localDate);
    const blocks = new Map(briefMoveItemBlocks(items, null).map((block) => [block.ref, block]));
    const conflicts = findMoveConflicts(items.filter((item) => blocks.has(item.occurrenceId)).map((item) => ({
      id: item.occurrenceId, status: item.status, moved: isMoved(day.occurrences.get(item.occurrenceId)!),
      interval: blocks.get(item.occurrenceId)!,
    })));
    const result = await caller.supabase.rpc("sync_move_conflicts", { p_local_date: localDate, p_conflicts: conflicts });
    if (result.error) throw result.error;
    open += (result.data ?? []).length;
  }
  return open;
}

/** The database's own rules, checked here only to order refusals. */
function passesBasicRules(
  caller: OccurrenceMoveCaller, occurrence: Occurrence, behavior: BehaviorWithCategory,
  expectedRevision: string, requestedStart: Temporal.Instant,
): boolean {
  let sameRevision = false;
  try {
    sameRevision = Temporal.Instant.from(expectedRevision).equals(Temporal.Instant.from(occurrence.updated_at));
  } catch {
    sameRevision = false;
  }
  return occurrence.status === "unresolved"
    && occurrence.schedule_kind === "exact"
    && occurrence.local_date === todayIn(fixedClock(caller.now), behavior.timezone)
    && sameRevision
    && localDateAt(requestedStart, behavior.timezone) === occurrence.local_date
    && Temporal.Instant.compare(requestedStart, caller.now.subtract({ minutes: 1 })) >= 0;
}

function alternativesFor(
  caller: OccurrenceMoveCaller, occurrence: Occurrence, behavior: BehaviorWithCategory,
  requestedStart: Temporal.Instant, durationSeconds: number, slot: SlotInputs,
): Temporal.Instant[] {
  return briefMoveFreeStarts({
    localDate: occurrence.local_date, timezone: behavior.timezone, now: caller.now, near: requestedStart,
    lengthSeconds: durationSeconds, blocks: slot.blocks, travelBeforeSeconds: slot.before, travelAfterSeconds: slot.after,
    limit: MOVE_ALTERNATIVES_LIMIT,
  });
}

async function callMoveFunction(
  caller: OccurrenceMoveCaller, request: OccurrenceMoveRequest, interval: Readonly<{ start: Temporal.Instant; end: Temporal.Instant }>,
  duration: Readonly<{ seconds: number; source: string }>,
): Promise<FunctionResult> {
  const { data, error } = await caller.supabase.rpc("move_occurrence_for_day", {
    p_occurrence_id: request.occurrenceId,
    p_expected_revision: request.expectedRevision,
    p_to_start_at: interval.start.toString(),
    p_to_end_at: interval.end.toString(),
    p_planned_seconds: Math.round(duration.seconds),
    p_duration_source: duration.source,
    ...(request.reason ? { p_reason: request.reason } : {}),
    ...(request.proposalId ? { p_proposal_id: request.proposalId } : {}),
    ...keyParams("move_occurrence_for_day", request),
  });
  if (error) throw mapRpcError(error);
  return readFunctionResult(data, caller.userId);
}

/**
 * The database needs a request hash with every idempotency key. Integration callers
 * pass the hash of their validated input; other callers (the web actions) get a hash
 * of the request itself, so the same key with different details is refused.
 */
function keyParams(operation: string, request: OccurrenceMoveRequest | OccurrenceRevertRequest) {
  if (!request.idempotencyKey) return {};
  // Travel times are a signed, request-only input; they do not make two taps different.
  const details = { ...request, idempotencyKey: undefined, requestHash: undefined, travel: undefined };
  return {
    p_idempotency_key: request.idempotencyKey,
    p_request_hash: request.requestHash
      ?? createHash("sha256").update(canonicalJson({ operation, request: details })).digest("hex"),
  };
}

/**
 * A routine step's request hash. It leaves out the step's revision, which the first
 * run itself changes, so a retried Yes or Undo replays each step instead of refusing.
 */
function stepHash(operation: string, key: string, occurrenceId: string, startAt: string | null): string {
  return createHash("sha256").update(canonicalJson({ operation, key, occurrenceId, startAt })).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value instanceof Temporal.Instant) return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value).filter(([, item]) => item !== undefined && item !== null)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Reminders follow the item's new time; a time already passed gets none. */
async function finish(
  caller: OccurrenceMoveCaller, result: FunctionResult, behavior: BehaviorWithCategory, outcome: "moved" | "undone",
): Promise<OccurrenceMoveResult> {
  if (!result.occurrence || !result.move) throw new Error("Invalid move result");
  await syncReminderDeliveriesForBehavior(caller.supabase, caller.userId, behavior, {
    scheduledFrom: caller.now.toString(), occurrences: [result.occurrence], now: caller.now,
  });
  return {
    outcome: result.move.kind === "revert" ? "undone" : outcome,
    replayed: result.outcome === "replayed",
    occurrence: result.occurrence,
    behavior,
    move: result.move,
  };
}

function refused(
  reason: MoveRefusalReason | "occurrence_not_found", occurrence: Occurrence | null, behavior: BehaviorWithCategory | null,
  alternatives: readonly Temporal.Instant[] = [], detail?: "too_close" | "travel_busy",
): OccurrenceMoveResult {
  return {
    outcome: "refused", reason, ...(detail ? { detail } : {}), message: detail ? DETAIL_MESSAGES[detail] : MOVE_REFUSAL_MESSAGES[reason],
    alternatives, occurrence, behavior,
  };
}

function readFunctionResult(data: unknown, userId: string): FunctionResult {
  if (!data || typeof data !== "object" || Array.isArray(data) || !("outcome" in data)) throw new Error("Invalid move result");
  const value = data as { outcome: FunctionResult["outcome"]; reason: string | null; occurrence: Omit<Occurrence, "user_id"> | null; move: OccurrenceMoveRecord | null };
  return {
    outcome: value.outcome,
    reason: value.reason,
    occurrence: value.occurrence ? { ...value.occurrence, user_id: userId } as Occurrence : null,
    move: value.move,
  };
}

function mapRpcError(error: { message?: string }): Error {
  if (error.message === "occurrence_move_idempotency_key_reused") return new OccurrenceMoveKeyReusedError();
  return Object.assign(new Error(error.message ?? "Move failed"), error);
}
