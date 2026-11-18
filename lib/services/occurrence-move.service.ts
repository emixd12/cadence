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
  MOVE_REFUSAL_MESSAGES,
  checkMoveSlot,
  findMoveConflicts,
  loggedAverageSeconds,
  moveAlternatives,
  resolveMoveDuration,
  type MoveCalendarBusy,
  type MoveDurationSource,
  type MoveInterval,
  type MoveOccupant,
  type MovePersonReason,
  type MoveRefusalReason,
} from "@cadence/core/resolvers/move.resolver";
import type { AppSupabaseClient, BehaviorWithCategory } from "@/lib/db/behaviors.repo";
import { getBehaviorById } from "@/lib/db/behaviors.repo";
import { getOccurrenceById, listOccurrencesBetweenLocalDates } from "@/lib/db/occurrences.repo";
import { syncReminderDeliveriesForBehavior } from "@/lib/services/reminder.service";
import type { Occurrence } from "@/lib/types/database";
import type { Tables } from "@/lib/db/database.types";

/**
 * Per-day moves (advisor plan, Phase 2A): the one path every caller takes to move
 * today's Occurrence or undo its latest move. The web session, the Daily Brief, chat
 * and MCP clients all come through here and then through the database functions
 * `move_occurrence_for_day` / `revert_occurrence_move`, which enforce status,
 * revision, today, range and same-day rules. This service adds what needs durations
 * and the day's other items: the item's length, the free-slot check, alternatives
 * for a refusal, and the reminder resync. Rules: docs/DATETIME_STRATEGY.md, "Moves".
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
}>;

export type OccurrenceRevertRequest = Readonly<{
  occurrenceId: string;
  expectedRevision: string;
  moveId?: string | null;
  idempotencyKey?: string | null;
  requestHash?: string | null;
}>;

export type OccurrenceMoveResult =
  | Readonly<{
    outcome: "moved" | "undone";
    replayed: boolean;
    occurrence: Occurrence;
    behavior: BehaviorWithCategory;
    move: OccurrenceMoveRecord;
  }>
  | Readonly<{
    outcome: "refused";
    reason: MoveRefusalReason | "occurrence_not_found";
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
const SESSION_SAMPLE = 20;

/** Move today's Occurrence to a new start. Refusals come back as values, not errors. */
export async function moveOccurrenceForDay(caller: OccurrenceMoveCaller, request: OccurrenceMoveRequest): Promise<OccurrenceMoveResult> {
  const loaded = await loadTarget(caller, request.occurrenceId);
  if (!loaded) return refused("occurrence_not_found", null, null);
  const { occurrence, behavior } = loaded;
  const requestedStart = request.startTime
    ? zonedInstant(occurrence.local_date, request.startTime, behavior.timezone)
    : Temporal.Instant.from(request.startAt ?? "");
  const duration = await moveDuration(caller, occurrence, behavior);
  const interval = { start: requestedStart, end: requestedStart.add({ seconds: duration.seconds }) };

  // The database answers the basic refusals (resolved, not today, changed since read,
  // time passed). The slot check runs only on a request that passes those, so its
  // reason never hides a more basic one.
  const day = await dayOccupants(caller, occurrence);
  if (passesBasicRules(caller, occurrence, behavior, request.expectedRevision, requestedStart)) {
    const slot = checkMoveSlot({ occurrenceId: occurrence.id, interval, others: day, calendarBusy: request.calendarBusy });
    if (!slot.ok) {
      return refused(slot.reason, occurrence, behavior,
        alternativesFor(caller, occurrence, behavior, requestedStart, duration.seconds, day, request.calendarBusy));
    }
  }

  const result = await callMoveFunction(caller, request, interval, duration);
  if (result.outcome === "refused") {
    const reason = result.reason as MoveRefusalReason;
    const alternatives = ALTERNATIVE_REASONS.has(reason)
      ? alternativesFor(caller, occurrence, behavior, requestedStart, duration.seconds, day, request.calendarBusy)
      : [];
    return refused(reason, result.occurrence ?? occurrence, behavior, alternatives);
  }
  return finish(caller, result, behavior, "moved");
}

/** Undo the latest move of today's Occurrence. */
export async function revertOccurrenceMove(caller: OccurrenceMoveCaller, request: OccurrenceRevertRequest): Promise<OccurrenceMoveResult> {
  const loaded = await loadTarget(caller, request.occurrenceId);
  if (!loaded) return refused("occurrence_not_found", null, null);
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
  return finish(caller, result, loaded.behavior, "undone");
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
  request: Readonly<{ occurrenceId: string; calendarBusy?: readonly MoveCalendarBusy[]; limit?: number }>,
): Promise<Temporal.Instant[]> {
  const loaded = await loadTarget(caller, request.occurrenceId);
  if (!loaded) return [];
  const { occurrence, behavior } = loaded;
  if (occurrence.status !== "unresolved" || occurrence.schedule_kind !== "exact"
    || occurrence.local_date !== todayIn(fixedClock(caller.now), behavior.timezone)) return [];
  const current = effectiveStartInstant(occurrence);
  const requestedStart = Temporal.Instant.compare(current, caller.now) > 0 ? current : caller.now;
  const duration = await moveDuration(caller, occurrence, behavior);
  const day = await dayOccupants(caller, occurrence);
  return moveAlternatives({
    localDate: occurrence.local_date, timezone: behavior.timezone, requestedStart, durationSeconds: duration.seconds,
    now: caller.now, blocks: [...day, ...(request.calendarBusy ?? [])], limit: (request.limit ?? 3) + 1,
  }).filter((start) => !start.equals(current)).slice(0, request.limit ?? 3);
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

/** Whether the person has ever moved an item themselves, for the one-time first-move line. */
export async function hasPersonMovedBefore(caller: Pick<OccurrenceMoveCaller, "supabase" | "userId">): Promise<boolean> {
  const { data, error } = await caller.supabase.from("occurrence_moves").select("id")
    .eq("user_id", caller.userId).eq("kind", "move").eq("source", "person").limit(1);
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

/** A move that is not the first keeps the length it already has. */
async function moveDuration(caller: OccurrenceMoveCaller, occurrence: Occurrence, behavior: BehaviorWithCategory)
  : Promise<Readonly<{ seconds: number; source: MoveDurationSource | "kept_length" }>> {
  const end = effectiveEndAt(occurrence);
  if (end) {
    const seconds = effectiveStartInstant(occurrence).until(Temporal.Instant.from(end)).total({ unit: "seconds" });
    if (seconds > 0) return { seconds, source: "kept_length" };
  }
  const { data, error } = await caller.supabase.from("occurrence_time_sessions")
    .select("started_at, stopped_at")
    .eq("user_id", caller.userId).eq("behavior_id", behavior.id).not("stopped_at", "is", null)
    .order("started_at", { ascending: false }).limit(SESSION_SAMPLE);
  if (error) throw error;
  return resolveMoveDuration({
    behaviorDefaultMinutes: behavior.default_duration_minutes ?? null,
    loggedAverageSeconds: loggedAverageSeconds(data ?? []),
    plannedSeconds: null,
  });
}

/**
 * The other Unresolved Occurrences from the day before to the day after, at their
 * effective times. Neighbouring days stay in, so a move near midnight still sees an
 * item that starts just after it or one that runs past midnight; the overlap check
 * decides whether they block. An item with no known length occupies only its start.
 */
async function dayOccupants(caller: OccurrenceMoveCaller, occurrence: Occurrence): Promise<MoveOccupant[]> {
  const rows = await listOccurrencesAround(caller, occurrence.local_date);
  const open = rows.filter((row) => row.id !== occurrence.id && row.status === "unresolved");
  const lengths = await behaviorLengths(caller, open);
  return occupants(open, lengths);
}

type BehaviorLength = Readonly<{ minutes: number | null; timezone: string }>;

function listOccurrencesAround(caller: OccurrenceMoveCaller, localDate: string): Promise<Occurrence[]> {
  const date = Temporal.PlainDate.from(localDate);
  return listOccurrencesBetweenLocalDates(caller.supabase, caller.userId,
    date.subtract({ days: 1 }).toString(), date.add({ days: 1 }).toString());
}

async function behaviorLengths(caller: OccurrenceMoveCaller, rows: readonly Occurrence[]): Promise<Map<string, BehaviorLength>> {
  const behaviorIds = [...new Set(rows.map((row) => row.behavior_id))];
  const lengths = new Map<string, BehaviorLength>();
  if (behaviorIds.length === 0) return lengths;
  const { data, error } = await caller.supabase.from("behaviors").select("id, default_duration_minutes, timezone")
    .eq("user_id", caller.userId).in("id", behaviorIds);
  if (error) throw error;
  for (const row of data ?? []) lengths.set(row.id, { minutes: row.default_duration_minutes, timezone: row.timezone });
  return lengths;
}

function occupants(rows: readonly Occurrence[], lengths: ReadonlyMap<string, BehaviorLength>): MoveOccupant[] {
  return rows.map((row) => {
    const start = effectiveStartInstant(row);
    const info = lengths.get(row.behavior_id);
    const moved = effectiveEndAt(row);
    const end = moved ? Temporal.Instant.from(moved)
      : row.schedule_kind !== "exact" && row.schedule_end_time && info
        ? zonedInstant(row.local_date, row.schedule_end_time.slice(0, 5), info.timezone)
        : info?.minutes ? start.add({ minutes: info.minutes }) : start;
    return { occurrenceId: row.id, start, end: Temporal.Instant.compare(end, start) > 0 ? end : start };
  });
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
    const rows = (await listOccurrencesAround(caller, localDate)).filter((row) => row.local_date === localDate);
    const lengths = await behaviorLengths(caller, rows);
    const intervals = new Map(occupants(rows, lengths).map((item) => [item.occurrenceId, item]));
    const conflicts = findMoveConflicts(rows.map((row) => ({
      id: row.id, status: row.status, moved: isMoved(row), interval: intervals.get(row.id)!,
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
  requestedStart: Temporal.Instant, durationSeconds: number,
  day: readonly MoveOccupant[], calendarBusy: readonly MoveCalendarBusy[] | undefined,
): Temporal.Instant[] {
  const blocks: MoveInterval[] = [...day, ...(calendarBusy ?? [])];
  return moveAlternatives({
    localDate: occurrence.local_date, timezone: behavior.timezone, requestedStart, durationSeconds,
    now: caller.now, blocks,
  });
}

async function callMoveFunction(
  caller: OccurrenceMoveCaller, request: OccurrenceMoveRequest, interval: MoveInterval,
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
  const details = { ...request, idempotencyKey: undefined, requestHash: undefined };
  return {
    p_idempotency_key: request.idempotencyKey,
    p_request_hash: request.requestHash
      ?? createHash("sha256").update(canonicalJson({ operation, request: details })).digest("hex"),
  };
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
  alternatives: readonly Temporal.Instant[] = [],
): OccurrenceMoveResult {
  return { outcome: "refused", reason, message: MOVE_REFUSAL_MESSAGES[reason], alternatives, occurrence, behavior };
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
