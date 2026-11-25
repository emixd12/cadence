import { noticeText } from "@cadence/core/notices";
import { createHash } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import { effectiveStartInstant } from "@cadence/core/resolvers/time.resolver";
import {
  BRIEF_MOVE_OTHER_TIMES,
  briefMoveFreeStarts,
  briefMoveItemBlocks,
  checkBriefMoveSlot,
  planBriefMoveLinesFromInputs,
  travelBlocksFor,
  type BriefMoveBlock,
  type BriefMoveCalendarBusy,
  type BriefMoveCandidate,
  type BriefMoveInterval,
  type BriefMovePlan,
  type BriefMoveTravelInput,
} from "@cadence/core/resolvers/brief-move.resolver";
import {
  BRIEF_MOVES_VERSION,
  BRIEF_MOVE_NEVER_OFFER_AFTER_DECLINES,
  type BehaviorMovePreference,
  type BriefCalendarBusy,
  type BriefMoveAnswerRequest,
  type BriefMoveAnswerResponse,
  type BriefMoveConflictLine,
  type BriefMoveErrorCode,
  type BriefMoveLengthRequest,
  type BriefMoveLengthResponse,
  type BriefMoveLine,
  type BriefMoveLineResult,
  type BriefMoveProposalStatus,
  type BriefMoveRecheckRequest,
  type BriefMoveRecheckResponse,
  type BriefMoveRefusal,
  type BriefMoveRefusalCause,
  type BriefMoveReplanRequest,
  type BriefMoveSpan,
  type BriefMoveReplanResponse,
  type BriefMoves,
  type BriefPlanningContext,
} from "@cadence/core/types/brief-moves";
import type { AdvisorDayContext } from "@cadence/core/types/advisor-day-context";
import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import type { Json, Tables } from "@/lib/db/database.types";
import { applyOccurrenceStatusTransition } from "@/lib/services/occurrence.service";
import {
  OccurrenceMoveKeyReusedError,
  hasPersonMovedBefore,
  moveOccurrenceForDay,
  revertOccurrenceMove,
  type OccurrenceMoveCaller,
  type OccurrenceMoveResult,
} from "@/lib/services/occurrence-move.service";
import { behaviorEstimateInputHash, readBriefMoveDay, type BriefMoveBehaviorFacts, type BriefMoveDay } from "@/lib/services/brief-move-day.service";
import { briefMoveTravelInput, verifyTravelTimesToken } from "@/lib/services/travel-times-token";
import { readTravelConclusionsSecrets, type TravelConclusionsSecrets } from "@/lib/services/travel-conclusions-token";
import type { DailyBriefGenerator } from "@/lib/services/daily-brief-consumer";
import { DURATION_ESTIMATE_INSTRUCTIONS, DURATION_ESTIMATE_V1_2_INSTRUCTIONS } from "@/lib/services/daily-brief-instructions";
import { parseDescriptionEstimates, type DescriptionEstimateItem } from "@cadence/core/services/description-duration";
import { formatBriefingTime } from "@cadence/core/services/daily-brief-presentation";

/**
 * Advisor Phase 3A1: the Daily Brief's move lines and every answer to them. The planner
 * (packages/core/src/resolvers/brief-move.resolver.ts) decides what to offer; this
 * service reads the day, saves the lines as proposals, reads them back for the screen,
 * and applies each answer:
 *
 *   Yes, Accept all   move_occurrence_for_day through the Daily Brief's own agent
 *                     token (source daily_brief), with the length the line showed
 *   Other time        a move to the chosen time, then status other_time
 *   No                closes the item for the rest of the day
 *   Already did it    recorded first, then the person marks the item Completed
 *   Undo, Undo all    revert_occurrence_move, then status undone (counts as No)
 *   Don't suggest     the Behavior's switch, then the line closes like No
 *
 * Every answer, applied or refused, is one row in move_proposal_answers, written as
 * the person. Calendar events and travel times arrive with each request and are
 * never stored, except a calendar event's title in a line's reason for its own day.
 */

export class BriefMoveError extends Error {
  constructor(readonly code: BriefMoveErrorCode, message?: string, readonly retryAfterSeconds?: number) {
    super(message ?? code);
  }
}

/** The person's own session, and the Daily Brief's agent client for the same person. */
export type BriefMoveCallers = Readonly<{
  person: OccurrenceMoveCaller;
  /** Created on first use: answers that move nothing never mint an agent token. */
  agent: () => Promise<AppSupabaseClient>;
  travelSecrets: TravelConclusionsSecrets;
}>;

type ProposalRow = Tables<"move_proposals">;

// ------------------------------------------------------------------ planning

export type BriefMovePlanningInput = Readonly<{
  /** Calendar events the request carried (Mac calendars, titles for reasons). Never stored. */
  calendarBusy?: readonly BriefCalendarBusy[];
  /** The signed travel times token from the routes response. Verified here, used once. */
  travelTimes?: string | null;
}>;

/**
 * The calendar as the one rule sees it: derived strictly server-side from authorized AI
 * context connectors. Client-supplied `calendarBusy` is ignored (WS-2B Path 4 closure)
 * so Timeline REST calendar data can never leak into AI move planning.
 */
export function briefMoveCalendar(context: AdvisorDayContext | null, _requestBusy?: readonly BriefCalendarBusy[] | undefined)
  : Readonly<{ busy: BriefMoveCalendarBusy[]; state: "current" | "stale" | "none" }> {
  const busy: BriefMoveCalendarBusy[] = [];
  let requested = false, stale = false;
  for (const connector of context?.connectors ?? []) {
    // Calendar connectors carry events; Hevy and not-requested sources do not.
    if (!("events" in connector)) continue;
    requested = true;
    if (connector.state !== "current" || !connector.complete) stale = true;
    for (const event of connector.events) {
      if (event.interval.kind !== "timed" || event.state === "cancelled" || event.availability === "free"
        || event.currentUserResponse === "declined") continue;
      busy.push({ ref: event.ref, start: Temporal.Instant.from(event.interval.startAt), end: Temporal.Instant.from(event.interval.endAt) });
    }
  }
  return { busy, state: stale ? "stale" : requested ? "current" : "none" };
}

/** The verified travel times for this request, or null. Rejects Timeline-REST Google tokens (Path 3). Never throws. */
export function briefMoveTravel(token: string | null | undefined, input: Readonly<{
  secrets: TravelConclusionsSecrets; userId: string; localDate: string; now: Temporal.Instant;
}>): BriefMoveTravelInput | null {
  if (!token) return null;
  const payload = verifyTravelTimesToken(token, input);
  if (!payload || payload.googleSource === "standard") return null;
  return briefMoveTravelInput(payload);
}

/**
 * The lines the brief would offer now. Reads the day (lengths, preferences, earlier
 * answers) as the caller; nothing is written. The brief's prompt gets the result
 * without calendar titles or travel (see 3A2's projection).
 */
export async function planBriefMoveDay(input: Readonly<{
  supabase: AppSupabaseClient;
  userId: string;
  localDate: string;
  timezone: string;
  now: Temporal.Instant;
  context: AdvisorDayContext | null;
  planning: BriefMovePlanningInput;
  travelSecrets: TravelConclusionsSecrets;
  day?: BriefMoveDay;
}>): Promise<BriefMovePlan & Readonly<{ day: BriefMoveDay }>> {
  const day = input.day ?? await readBriefMoveDay(input.supabase, input.userId, input.localDate);
  const calendar = briefMoveCalendar(input.context, input.planning.calendarBusy);
  const travel = briefMoveTravel(input.planning.travelTimes, { secrets: input.travelSecrets, userId: input.userId, localDate: input.localDate, now: input.now });
  const answers = await readDayAnswers(input.supabase, input.userId, input.localDate);
  const plan = planBriefMoveLinesFromInputs({
    localDate: input.localDate, timezone: input.timezone, now: input.now, items: day.items,
    calendarBusy: calendar.busy, calendar: calendar.state, travel,
    placeBehaviorIds: new Set([...day.behaviors.values()].filter((behavior) => behavior.whereKind === "place").map((behavior) => behavior.id)),
    declinedToday: answers.closedToday, neverMoveBehaviorIds: day.neverMoveBehaviorIds,
    offerNeverMoveBehaviorIds: answers.offerNeverMove,
  });
  return { ...plan, day };
}

/**
 * The brief's call (3A2): the day from its context, the request's calendar events and
 * travel times. `now` may be an instant string. Reads as `supabase`'s own person.
 */
export async function planBriefMoveLines(input: Readonly<{
  context: AdvisorDayContext;
  planning: BriefMovePlanningInput;
  now: string | Temporal.Instant;
  supabase: AppSupabaseClient;
  userId?: string;
  travelSecrets?: TravelConclusionsSecrets;
}>): Promise<BriefMovePlan & Readonly<{ day: BriefMoveDay }>> {
  return planBriefMoveDay({
    supabase: input.supabase, userId: input.userId ?? await ownUserId(input.supabase),
    localDate: input.context.localDate, timezone: input.context.timezone,
    now: typeof input.now === "string" ? Temporal.Instant.from(input.now) : input.now,
    context: input.context, planning: input.planning,
    travelSecrets: input.travelSecrets ?? readTravelConclusionsSecrets(process.env),
  });
}

async function readDayAnswers(supabase: AppSupabaseClient, userId: string, localDate: string) {
  const [today, declines] = await Promise.all([
    supabase.from("move_proposals").select("occurrence_id, status")
      .eq("user_id", userId).eq("local_date", localDate).in("status", ["declined", "undone"]),
    supabase.from("move_proposal_answers").select("behavior_id, local_date")
      .eq("user_id", userId).in("kind", ["no", "undo", "undo_all"]).eq("outcome", "applied")
      .order("created_at", { ascending: false }).limit(1000),
  ]);
  if (today.error) throw today.error;
  if (declines.error) throw declines.error;
  const days = new Map<string, Set<string>>();
  for (const row of declines.data ?? []) days.set(row.behavior_id, (days.get(row.behavior_id) ?? new Set()).add(row.local_date));
  return {
    closedToday: new Set((today.data ?? []).map((row) => row.occurrence_id)),
    offerNeverMove: new Set([...days].filter(([, dates]) => dates.size >= BRIEF_MOVE_NEVER_OFFER_AFTER_DECLINES).map(([id]) => id)),
  };
}

const ESTIMATE_BATCH = 40;

/**
 * Asks the model for lengths and "alongside" answers the cache lacks, and stores them.
 * The model sees only each Behavior's title and description (as Ticket 188's estimate
 * step does), under a short local ref, never an id. A failed or partial answer leaves
 * those Behaviors at the next length source (30 minutes when none). No agent client
 * (the agent caller is not configured): nothing is asked or stored.
 */
export async function ensureBehaviorEstimates(
  agent: AppSupabaseClient | null,
  context: Pick<AdvisorDayContext, "localDate">,
  generate: DailyBriefGenerator,
  signal?: AbortSignal,
  options: Readonly<{ userId?: string; model?: string }> = {},
): Promise<void> {
  if (!agent) return;
  const userId = options.userId ?? await ownUserId(agent);
  const day = await readBriefMoveDay(agent, userId, context.localDate);
  await cacheBehaviorEstimates({ agent, userId, localDate: context.localDate, day, model: options.model ?? "daily_brief", estimate: async (behaviors) => {
    const refs = new Map(behaviors.map((behavior, index) => [`b${index + 1}`, behavior.id]));
    const items: DescriptionEstimateItem[] = behaviors.map((behavior, index) => ({
      behaviorRef: `b${index + 1}`, title: behavior.title, description: behavior.description?.trim() ?? "",
    }));
    try {
      const raw = await generate({
        instructions: `${DURATION_ESTIMATE_INSTRUCTIONS}\n${DURATION_ESTIMATE_V1_2_INSTRUCTIONS}`,
        facts: JSON.stringify({ items }), signal: signal ?? new AbortController().signal, estimateVariant: "alongside",
      });
      return parseDescriptionEstimates(raw, items, { alongside: true })
        .map((estimate) => ({ behaviorId: refs.get(estimate.behaviorRef)!, minutes: estimate.minutes, alongside: estimate.alongside === true }));
    } catch (error) {
      if (signal?.aborted) throw error;
      return [];
    }
  } });
}

/** Stores estimates for the day's Behaviors whose cached answer is missing or out of date. Returns the day re-read. */
export async function cacheBehaviorEstimates(input: Readonly<{
  agent: AppSupabaseClient;
  userId: string;
  localDate: string;
  day: BriefMoveDay;
  estimate: (behaviors: readonly BriefMoveBehaviorFacts[]) => Promise<ReadonlyArray<Readonly<{
    behaviorId: string; minutes: number | null; alongside: boolean;
  }>>>;
  model: string;
}>): Promise<BriefMoveDay> {
  const stale = [...input.day.staleEstimateBehaviorIds].map((id) => input.day.behaviors.get(id))
    .filter((item): item is BriefMoveBehaviorFacts => !!item).slice(0, ESTIMATE_BATCH);
  if (!stale.length) return input.day;
  const answers = await input.estimate(stale);
  const byId = new Map(stale.map((behavior) => [behavior.id, behavior]));
  const rows = answers.filter((answer) => byId.has(answer.behaviorId)).map((answer) => ({
    behavior_id: answer.behaviorId,
    input_hash: behaviorEstimateInputHash(byId.get(answer.behaviorId)!),
    duration_minutes: answer.minutes !== null && Number.isInteger(answer.minutes) && answer.minutes >= 1 && answer.minutes <= 1440 ? answer.minutes : null,
    alongside: answer.alongside === true,
    model: input.model,
  }));
  if (!rows.length) return input.day;
  const { error } = await input.agent.rpc("upsert_behavior_advisor_estimates", { p_estimates: rows });
  if (error) throw error;
  return readBriefMoveDay(input.agent, input.userId, input.localDate);
}

/** Saves the planner's lines as the run's proposals. A Refresh closes the day's undecided lines first. */
export async function saveBriefProposals(agent: AppSupabaseClient | null, input: Readonly<{
  runId: string | null; localDate: string; refresh: boolean;
  /** The planner's lines, with the brief's own reason words when it wrote them. `candidates` is the same list. */
  lines?: readonly BriefMoveCandidate[]; candidates?: readonly BriefMoveCandidate[];
  replaces?: ReadonlyMap<string, string>;
  containsGoogleCalendar?: boolean;
  googleCalendarGrantGeneration?: number | null;
}>): Promise<BriefMoveLine[]> {
  const candidates = input.lines ?? input.candidates ?? [];
  // No agent client: no proposals, so no lines the person could answer.
  if (!agent || (!candidates.length && !input.refresh)) return [];
  const { data, error } = await agent.rpc("record_brief_move_proposals", {
    p_agent_run_id: (input.runId || null) as string,
    p_local_date: input.localDate,
    p_supersede: input.refresh,
    p_proposals: candidates.map((candidate) => ({
      occurrence_id: candidate.occurrenceId,
      proposed_start_at: candidate.to.startAt,
      proposed_end_at: candidate.to.endAt,
      reason: candidate.reasonCode,
      expected_revision: candidate.expectedRevision,
      line: storedLine(candidate),
      replaces_proposal_id: input.replaces?.get(candidate.occurrenceId) ?? null,
      ...(input.containsGoogleCalendar ? {
        contains_google_calendar: true,
        google_calendar_grant_generation: input.googleCalendarGrantGeneration ?? null,
      } : {}),
    })) as unknown as Json,
  });
  if (error) throw error;
  return ((data ?? []) as ProposalRow[]).map(lineFromRow).filter((line): line is BriefMoveLine => !!line);
}

/** What a proposal row keeps so the line can be rebuilt exactly as shown. */
function storedLine(candidate: BriefMoveCandidate) {
  return Object.fromEntries(Object.entries(candidate).filter(([name]) => name !== "key"));
}

function lineFromRow(row: ProposalRow): BriefMoveLine | null {
  const line = row.line as Partial<BriefMoveCandidate> | null;
  if (!line || typeof line !== "object" || !line.occurrenceId) return null;
  return {
    proposalId: row.id,
    occurrenceId: row.occurrence_id,
    behaviorId: row.behavior_id,
    behaviorRevision: line.behaviorRevision ?? "",
    title: line.title ?? "",
    localDate: row.local_date,
    timezone: line.timezone ?? "UTC",
    expectedRevision: line.expectedRevision ?? row.expected_revision,
    from: line.from!,
    to: { startAt: Temporal.Instant.from(row.proposed_start_at).toString(), endAt: Temporal.Instant.from(row.proposed_end_at).toString() },
    length: line.length!,
    reasonCode: line.reasonCode!,
    reason: line.reason ?? "",
    anchor: line.anchor ?? null,
    otherTimes: line.otherTimes ?? [],
    travel: line.travel ?? "not_needed",
    late: line.late ?? false,
    offerNeverMove: line.offerNeverMove ?? false,
    status: row.status as BriefMoveProposalStatus,
    moveId: row.move_id,
    appliedTo: null,
    ...(line.routine ? { routine: line.routine } : {}),
  };
}

/** Lines whose move stands: Yes, Other time or Accept all, not undone. */
const APPLIED_STATUSES: readonly BriefMoveProposalStatus[] = ["accepted", "other_time"];

// ------------------------------------------------------------------ reading

const SHOWN_STATUSES: readonly BriefMoveProposalStatus[] = ["proposed", "accepted", "declined", "already_done", "other_time", "undone"];

/**
 * The day's move lines as the screen shows them: the latest line for each item (a
 * Refresh or Re-plan replaces earlier ones), answered lines included so the screen
 * can show what happened, and open schedule-edit notices.
 */
export async function readBriefMoves(supabase: AppSupabaseClient, input: Readonly<{
  userId?: string; localDate: string; timezone: string; runId?: string | null;
}>): Promise<BriefMoves> {
  const userId = input.userId ?? await ownUserId(supabase);
  const [proposals, conflicts, batches] = await Promise.all([
    supabase.from("move_proposals").select("*").eq("user_id", userId).eq("local_date", input.localDate)
      .eq("source", "daily_brief").in("status", SHOWN_STATUSES as BriefMoveProposalStatus[])
      .order("created_at", { ascending: false }).limit(64),
    supabase.from("move_conflicts").select("id, occurrence_id, conflicting_occurrence_id")
      .eq("user_id", userId).eq("local_date", input.localDate).eq("status", "open").order("detected_at"),
    supabase.from("move_proposal_answers").select("batch_id, proposal_id, created_at")
      .eq("user_id", userId).eq("local_date", input.localDate).eq("kind", "accept_all").eq("outcome", "applied")
      .order("created_at", { ascending: false }).limit(64),
  ]);
  for (const result of [proposals, conflicts, batches]) if (result.error) throw result.error;

  const latest = new Map<string, ProposalRow>();
  for (const row of (proposals.data ?? []) as ProposalRow[]) if (!latest.has(row.occurrence_id)) latest.set(row.occurrence_id, row);
  // A saved brief shows its own run's lines: after a Refresh, lines from the earlier
  // brief (answered or not) belong to that brief, not this one.
  const rows = [...latest.values()].filter((row) => !input.runId || row.agent_run_id === input.runId);
  const applied = await appliedSpans(supabase, userId, rows);
  const lines = rows.map(lineFromRow).filter((line): line is BriefMoveLine => !!line)
    .map((line) => applied.has(line.proposalId) ? { ...line, appliedTo: applied.get(line.proposalId)! } : line)
    .sort((left, right) => left.from.startAt.localeCompare(right.from.startAt) || left.proposalId.localeCompare(right.proposalId));

  const accepted = new Set(lines.filter((line) => line.status === "accepted").map((line) => line.proposalId));
  const lastBatch = (batches.data ?? [])[0]?.batch_id ?? null;
  const undoAllBatchId = lastBatch && (batches.data ?? []).some((row) => row.batch_id === lastBatch && accepted.has(row.proposal_id)) ? lastBatch : null;

  return {
    version: BRIEF_MOVES_VERSION,
    localDate: input.localDate,
    timezone: input.timezone,
    runId: input.runId ?? null,
    lines,
    conflicts: await conflictLines(supabase, userId, input.localDate, conflicts.data ?? []),
    acceptAll: lines.filter((line) => line.status === "proposed").length >= 2,
    undoAllBatchId,
    calendar: "current",
  };
}

/** Proposal id to where its standing move put the item, from the move records. */
async function appliedSpans(supabase: AppSupabaseClient, userId: string, rows: readonly ProposalRow[]): Promise<Map<string, BriefMoveSpan>> {
  const moved = rows.filter((row) => row.move_id && APPLIED_STATUSES.includes(row.status as BriefMoveProposalStatus));
  if (!moved.length) return new Map();
  const { data, error } = await supabase.from("occurrence_moves").select("id, to_start_at, to_end_at")
    .eq("user_id", userId).in("id", moved.map((row) => row.move_id!));
  if (error) throw error;
  const spans = new Map((data ?? []).map((move) => [move.id, spanOf(move.to_start_at, move.to_end_at)]));
  return new Map(moved.flatMap((row) => spans.has(row.move_id!) ? [[row.id, spans.get(row.move_id!)!] as const] : []));
}

function spanOf(startAt: string, endAt: string): BriefMoveSpan {
  return { startAt: Temporal.Instant.from(startAt).toString(), endAt: Temporal.Instant.from(endAt).toString() };
}

/** Today's open schedule-edit conflicts, as the brief shows them (first brief, refresh and reopen alike). */
export async function readOpenBriefConflicts(supabase: AppSupabaseClient, input: Readonly<{ userId?: string; localDate: string }>): Promise<BriefMoveConflictLine[]> {
  const userId = input.userId ?? await ownUserId(supabase);
  const conflicts = await supabase.from("move_conflicts").select("id, occurrence_id, conflicting_occurrence_id")
    .eq("user_id", userId).eq("local_date", input.localDate).eq("status", "open").order("detected_at");
  if (conflicts.error) throw conflicts.error;
  return conflictLines(supabase, userId, input.localDate, conflicts.data ?? []);
}

async function conflictLines(supabase: AppSupabaseClient, userId: string, localDate: string,
  rows: ReadonlyArray<{ id: string; occurrence_id: string; conflicting_occurrence_id: string | null }>): Promise<BriefMoveConflictLine[]> {
  if (!rows.length) return [];
  const day = await readBriefMoveDay(supabase, userId, localDate);
  const items = new Map(day.items.map((item) => [item.occurrenceId, item]));
  return rows.flatMap((row) => {
    const item = items.get(row.occurrence_id);
    if (!item) return [];
    return [{
      conflictId: row.id, occurrenceId: item.occurrenceId, behaviorId: item.behaviorId, title: item.title,
      expectedRevision: item.revision, at: { startAt: item.start.toString(), endAt: item.end.toString() },
      conflictingTitle: row.conflicting_occurrence_id ? items.get(row.conflicting_occurrence_id)?.title ?? null : null,
    }];
  });
}

// ------------------------------------------------------------------ answers

/** Applies one answer. Refusals come back as values; a bad request or a closed line throws BriefMoveError. */
export async function answerBriefMove(callers: BriefMoveCallers, request: BriefMoveAnswerRequest): Promise<BriefMoveAnswerResponse> {
  const firstMove = !(await hasPersonMovedBefore(callers.person));
  const finish = (results: BriefMoveLineResult[], replayed: boolean, batchId: string | null = null): BriefMoveAnswerResponse => ({
    kind: request.kind, results, batchId, replayed,
    showFirstMoveLine: firstMove && results.some((result) => result.outcome === "applied" && !!result.moveId
      && (request.kind === "yes" || request.kind === "accept_all" || request.kind === "other_time")),
  });

  if (request.kind === "accept_all") {
    if (!request.lines.length || request.lines.length > 16) throw new BriefMoveError("invalid_request");
    const batchId = batchIdFor(callers.person.userId, request.idempotencyKey);
    const results: BriefMoveLineResult[] = [];
    let replayed = true;
    // Each line is checked on its own against the day as the earlier lines left it.
    for (const line of request.lines) {
      const result = await answerYes(callers, {
        proposalId: line.proposalId, expectedRevision: line.expectedRevision, context: request.context,
        idempotencyKey: `${request.idempotencyKey}:${line.proposalId}`, kind: "accept_all", batchId,
      }, { allowClosed: true });
      replayed &&= result.replayed;
      results.push(result.result);
    }
    return finish(results, replayed, batchId);
  }
  if (request.kind === "undo_all") {
    const { data, error } = await callers.person.supabase.from("move_proposal_answers").select("proposal_id")
      .eq("user_id", callers.person.userId).eq("batch_id", request.batchId).eq("kind", "accept_all").eq("outcome", "applied");
    if (error) throw error;
    if (!data?.length) throw new BriefMoveError("proposal_not_found");
    const results: BriefMoveLineResult[] = [];
    let replayed = true;
    for (const { proposal_id: proposalId } of data) {
      const proposal = await readProposal(callers.person, proposalId);
      const result = await answerUndo(callers, proposal, `${request.idempotencyKey}:${proposalId}`, "undo_all", request.batchId, { allowClosed: true });
      replayed &&= result.replayed;
      results.push(result.result);
    }
    return finish(results, replayed, request.batchId);
  }

  const proposal = await readProposal(callers.person, request.proposalId);
  switch (request.kind) {
    case "yes": {
      const result = await answerYes(callers, { ...request, kind: "yes", batchId: null }, { allowClosed: false });
      return finish([result.result], result.replayed);
    }
    case "other_time": {
      const result = await answerOtherTime(callers, proposal, request);
      return finish([result.result], result.replayed);
    }
    case "undo": {
      const result = await answerUndo(callers, proposal, request.idempotencyKey, "undo", null, { allowClosed: false });
      return finish([result.result], result.replayed);
    }
    case "no":
    case "never_move": {
      const prior = await priorAnswer(callers.person, proposal.id, request.idempotencyKey, request.kind);
      if (prior) return finish([await lineResult(callers.person, prior.proposal, "applied", null, null)], true);
      if (request.kind === "never_move") {
        const { error } = await callers.person.supabase.rpc("set_behavior_move_preference", { p_behavior_id: proposal.behavior_id, p_never_suggest_move: true });
        if (error) throw error;
      }
      const recorded = await recordAnswer(callers.person, { proposal, kind: request.kind, outcome: "applied", key: request.idempotencyKey });
      return finish([await lineResult(callers.person, recorded.proposal, "applied", null, null)], recorded.replayed);
    }
    case "already_done": {
      const prior = await priorAnswer(callers.person, proposal.id, request.idempotencyKey, "already_done");
      if (prior) return finish([await lineResult(callers.person, prior.proposal, "applied", null, null)], true);
      if (proposal.status !== "proposed") throw new BriefMoveError("proposal_closed");
      // Recorded first, so the status trigger finds no open proposal to withdraw.
      const recorded = await recordAnswer(callers.person, { proposal, kind: "already_done", outcome: "applied", key: request.idempotencyKey });
      await applyOccurrenceStatusTransition(callers.person.supabase, callers.person.userId, {
        occurrenceId: proposal.occurrence_id, expectedStatus: "unresolved", nextStatus: "completed", now: callers.person.now,
      });
      return finish([await lineResult(callers.person, recorded.proposal, "applied", null, null)], recorded.replayed);
    }
  }
}

type AnswerOutcome = Readonly<{ result: BriefMoveLineResult; replayed: boolean }>;

async function answerYes(callers: BriefMoveCallers, request: Readonly<{
  proposalId: string; expectedRevision: string; context: BriefPlanningContext; idempotencyKey: string;
  kind: "yes" | "accept_all"; batchId: string | null;
}>, options: Readonly<{ allowClosed: boolean }>): Promise<AnswerOutcome> {
  const proposal = await readProposal(callers.person, request.proposalId);
  const prior = await priorAnswer(callers.person, proposal.id, request.idempotencyKey, request.kind);
  if (prior) return { result: await lineResult(callers.person, prior.proposal, prior.answer.outcome, null, prior.answer.move_id), replayed: true };
  if (proposal.status !== "proposed") {
    if (!options.allowClosed) throw new BriefMoveError("proposal_closed");
    return { result: await lineResult(callers.person, proposal, "refused", closedRefusal(proposal), null), replayed: false };
  }
  const line = lineFromRow(proposal);
  const moved = await moveOccurrenceForDay(await agentCaller(callers), {
    occurrenceId: proposal.occurrence_id,
    expectedRevision: request.expectedRevision,
    startAt: Temporal.Instant.from(proposal.proposed_start_at).toString(),
    reason: proposal.reason,
    proposalId: proposal.id,
    idempotencyKey: request.idempotencyKey,
    calendarBusy: requestBusy(request.context),
    length: line?.length ?? null,
    travel: briefMoveTravel(request.context.travelTimes, travelInput(callers, proposal.local_date)),
    routine: !!line?.routine,
  }).catch(rethrowKeyReused);
  return settleMove(callers, proposal, moved, { kind: request.kind, key: request.idempotencyKey, batchId: request.batchId,
    asked: { startAt: proposal.proposed_start_at, context: request.context } });
}

async function answerOtherTime(callers: BriefMoveCallers, proposal: ProposalRow,
  request: Extract<BriefMoveAnswerRequest, { kind: "other_time" }>): Promise<AnswerOutcome> {
  const prior = await priorAnswer(callers.person, proposal.id, request.idempotencyKey, "other_time");
  if (prior) return { result: await lineResult(callers.person, prior.proposal, prior.answer.outcome, null, prior.answer.move_id), replayed: true };
  if (proposal.status !== "proposed" && proposal.status !== "superseded") throw new BriefMoveError("proposal_closed");
  let start: Temporal.Instant;
  try { start = Temporal.Instant.from(request.startAt); } catch { throw new BriefMoveError("invalid_request"); }
  const line = lineFromRow(proposal);
  // No proposal id: the move supersedes this line, and the answer then marks it other_time.
  const moved = await moveOccurrenceForDay(await agentCaller(callers), {
    occurrenceId: proposal.occurrence_id,
    expectedRevision: request.expectedRevision,
    startAt: start.toString(),
    reason: proposal.reason,
    idempotencyKey: request.idempotencyKey,
    calendarBusy: requestBusy(request.context),
    length: line?.length ?? null,
    travel: briefMoveTravel(request.context.travelTimes, travelInput(callers, proposal.local_date)),
    routine: !!line?.routine,
  }).catch(rethrowKeyReused);
  return settleMove(callers, proposal, moved, { kind: "other_time", key: request.idempotencyKey, batchId: null,
    asked: { startAt: start.toString(), context: request.context } });
}

async function answerUndo(callers: BriefMoveCallers, proposal: ProposalRow, key: string, kind: "undo" | "undo_all",
  batchId: string | null, options: Readonly<{ allowClosed: boolean }>): Promise<AnswerOutcome> {
  const prior = await priorAnswer(callers.person, proposal.id, key, kind);
  if (prior) return { result: await lineResult(callers.person, prior.proposal, prior.answer.outcome, null, prior.answer.move_id), replayed: true };
  if ((proposal.status !== "accepted" && proposal.status !== "other_time") || !proposal.move_id) {
    if (!options.allowClosed) throw new BriefMoveError("proposal_closed");
    return { result: await lineResult(callers.person, proposal, "refused", closedRefusal(proposal), null), replayed: false };
  }
  const occurrence = await callers.person.supabase.from("occurrences").select("updated_at")
    .eq("user_id", callers.person.userId).eq("id", proposal.occurrence_id).maybeSingle();
  if (occurrence.error) throw occurrence.error;
  if (!occurrence.data) throw new BriefMoveError("proposal_not_found");
  const reverted = await revertOccurrenceMove(await agentCaller(callers), {
    occurrenceId: proposal.occurrence_id, expectedRevision: occurrence.data.updated_at, moveId: proposal.move_id, idempotencyKey: key,
    routine: !!lineFromRow(proposal)?.routine,
  }).catch(rethrowKeyReused);
  return settleMove(callers, proposal, reverted, { kind, key, batchId });
}

/** Records the answer to a move or undo that ran, applied or refused. */
async function settleMove(callers: BriefMoveCallers, proposal: ProposalRow, moved: OccurrenceMoveResult,
  answer: Readonly<{ kind: BriefMoveAnswerRequest["kind"]; key: string; batchId: string | null;
    /** The time a Yes or Other time asked for, so a refusal can name what is there now. */
    asked?: Readonly<{ startAt: string; context: BriefPlanningContext }>;
  }>): Promise<AnswerOutcome> {
  if (moved.outcome === "refused") {
    const reason = moved.detail ?? moved.reason;
    const named = answer.asked ? await refusalCause(callers, proposal, reason, answer.asked, answer.batchId).catch(() => null) : null;
    const refusal: BriefMoveRefusal = {
      reason,
      message: named?.message ?? moved.message,
      alternatives: moved.alternatives.map((instant) => instant.toString()),
      revision: moved.occurrence?.updated_at ?? null,
      ...(named ? { cause: named.cause } : {}),
    };
    const recorded = await recordAnswer(callers.person, { proposal, kind: answer.kind, outcome: "refused", key: answer.key,
      refusalReason: refusal.reason === "occurrence_not_found" ? "occurrence_not_found" : refusal.reason, batchId: answer.batchId });
    return { result: await lineResult(callers.person, recorded.proposal, "refused", refusal, null, moved.occurrence), replayed: recorded.replayed };
  }
  const recorded = await recordAnswer(callers.person, { proposal, kind: answer.kind, outcome: "applied", key: answer.key,
    moveId: moved.move.id, batchId: answer.batchId });
  return { result: await lineResult(callers.person, recorded.proposal, "applied", null, moved.move.id, moved.occurrence), replayed: moved.replayed || recorded.replayed };
}

function closedRefusal(proposal: ProposalRow): BriefMoveRefusal {
  const title = lineFromRow(proposal)?.title;
  return {
    reason: "proposal_closed", message: noticeText("brief-moves.refused.closed"), alternatives: [], revision: null,
    cause: { kind: "answered_elsewhere", ...(title ? { title } : {}), changedAfterBrief: true },
  };
}

// ------------------------------------------------------------------ naming the cause

/** What the one rule sees for one item's move: the day's other items, the calendar, travel. */
function slotView(day: BriefMoveDay, occurrenceId: string, calendarBusy: readonly BriefMoveCalendarBusy[], travel: BriefMoveTravelInput | null,
  positions: ReadonlyMap<string, BriefMoveInterval> = new Map())
  : Readonly<{ blocks: BriefMoveBlock[]; before: number; after: number }> {
  const stop = travel?.stops.get(occurrenceId);
  return {
    blocks: [
      ...briefMoveItemBlocks(day.items, occurrenceId, positions),
      ...calendarBusy.map((event) => ({ kind: "calendar" as const, ref: event.ref, start: event.start, end: event.end, ...(event.title ? { title: event.title } : {}) })),
      ...travelBlocksFor(travel, occurrenceId),
    ],
    before: stop?.beforeSeconds ?? 0,
    after: stop?.afterSeconds ?? 0,
  };
}

type NamedCause = Readonly<{ cause: BriefMoveRefusalCause; message: string }>;

/**
 * Where the brief's undecided lines would put their items. Re-plan and Re-check treat
 * those times as taken, the way the planner does, so a new time never lands on a time
 * another line still offers.
 */
function openLinePositions(latest: Iterable<ProposalRow>): Map<string, BriefMoveInterval> {
  const positions = new Map<string, BriefMoveInterval>();
  for (const row of latest) {
    if (row.status !== "proposed") continue;
    positions.set(row.occurrence_id, { start: Temporal.Instant.from(row.proposed_start_at), end: Temporal.Instant.from(row.proposed_end_at) });
  }
  return positions;
}

async function latestDayLines(person: OccurrenceMoveCaller, localDate: string): Promise<Readonly<{ all: ProposalRow[]; latest: Map<string, ProposalRow> }>> {
  const { data, error } = await person.supabase.from("move_proposals").select("*").eq("user_id", person.userId).eq("local_date", localDate)
    .eq("source", "daily_brief").order("created_at", { ascending: false }).limit(64);
  if (error) throw error;
  const all = (data ?? []) as ProposalRow[];
  const latest = new Map<string, ProposalRow>();
  for (const row of all) if (!latest.has(row.occurrence_id)) latest.set(row.occurrence_id, row);
  return { all, latest };
}

/**
 * The refusal's cause in plain words, from the day as it is now. Null when Cadence
 * cannot name one: the move service's own message then stands.
 */
async function refusalCause(callers: BriefMoveCallers, proposal: ProposalRow, reason: string,
  asked: Readonly<{ startAt: string; context: BriefPlanningContext }>, batchId: string | null): Promise<NamedCause | null> {
  const line = lineFromRow(proposal);
  if (!line) return null;
  if (reason === "proposal_closed") return { cause: closedRefusal(proposal).cause!, message: noticeText("brief-moves.refused.closed") };
  if (reason === "occurrence_resolved") {
    return { cause: { kind: "answered_elsewhere", title: line.title, changedAfterBrief: true }, message: noticeText("brief-moves.refused.already-marked", { title: line.title }) };
  }
  if (reason === "revision_changed") {
    return { cause: { kind: "item_changed", title: line.title, changedAfterBrief: true }, message: noticeText("brief-moves.refused.item-changed", { title: line.title }) };
  }
  if (reason !== "slot_taken" && reason !== "calendar_busy" && reason !== "too_close") return null;
  const { person } = callers;
  const day = await readBriefMoveDay(person.supabase, person.userId, proposal.local_date);
  const travel = briefMoveTravel(asked.context.travelTimes, travelInput(callers, proposal.local_date));
  const view = slotView(day, proposal.occurrence_id, requestBusy(asked.context), travel);
  const start = Temporal.Instant.from(asked.startAt);
  const check = checkBriefMoveSlot({
    interval: { start, end: start.add({ minutes: line.length.minutes }) },
    blocks: view.blocks, travelBeforeSeconds: view.before, travelAfterSeconds: view.after,
  });
  if (check.ok) return null;
  return describeBlock(day, proposal, view.blocks.find((block) => block.ref === check.ref) ?? null, check.reason,
    formatBriefingTime(start.toString(), line.timezone), batchId ? await batchMoved(person, batchId) : new Set());
}

/** Items an Accept all has moved so far: those moves are part of the same answer, not news. */
async function batchMoved(person: OccurrenceMoveCaller, batchId: string): Promise<Set<string>> {
  const { data, error } = await person.supabase.from("move_proposal_answers").select("occurrence_id")
    .eq("user_id", person.userId).eq("batch_id", batchId).eq("outcome", "applied");
  if (error) throw error;
  return new Set((data ?? []).map((row) => row.occurrence_id));
}

/** The words for one block in the way of `time`. */
function describeBlock(day: BriefMoveDay, proposal: ProposalRow, block: BriefMoveBlock | null,
  reason: "slot_taken" | "too_close" | "calendar_busy" | "travel_busy", time: string,
  sameBatch: ReadonlySet<string> = new Set()): NamedCause | null {
  if (!block || block.kind === "travel") return null;
  if (block.kind === "calendar") {
    // The line's time was free when it was written, so the event arrived since.
    const cause: BriefMoveRefusalCause = { kind: "calendar_event", ...(block.title ? { title: block.title } : {}), changedAfterBrief: true };
    const event = { time, hasEvent: block.title ? "yes" : "no", event: block.title ?? "" };
    return { cause, message: reason === "too_close"
      ? noticeText("brief-moves.refused.calendar-too-close", event)
      : noticeText("brief-moves.refused.calendar-taken", event) };
  }
  const occurrence = day.occurrences.get(block.ref);
  const item = day.items.find((candidate) => candidate.occurrenceId === block.ref);
  const title = block.title ?? item?.title ?? "another item";
  if (sameBatch.has(block.ref)) {
    // Moved by this same Accept all, a moment ago: nothing changed behind the brief's back.
    const cause: BriefMoveRefusalCause = { kind: "item_there", title, changedAfterBrief: false };
    return { cause, message: reason === "too_close" ? noticeText("brief-moves.refused.batch-too-close", { time, title })
      : noticeText("brief-moves.refused.batch-taken", { time, title }) };
  }
  const changed = !!item && Temporal.Instant.compare(Temporal.Instant.from(item.revision), Temporal.Instant.from(proposal.created_at)) > 0;
  const moved = changed && !!occurrence?.effective_start_at;
  const cause: BriefMoveRefusalCause = { kind: "item_there", title, changedAfterBrief: changed };
  if (reason === "too_close") {
    return { cause, message: moved ? noticeText("brief-moves.refused.too-close-moved", { time, title })
      : changed ? noticeText("brief-moves.refused.too-close-changed", { time, title })
        : noticeText("brief-moves.refused.too-close", { time, title }) };
  }
  return { cause, message: moved ? noticeText("brief-moves.refused.taken-moved", { time, title })
    : changed ? noticeText("brief-moves.refused.taken-changed", { time, title })
      : noticeText("brief-moves.refused.taken", { time, title }) };
}

// ------------------------------------------------------------------ Re-check on open

/**
 * Each time the brief opens: every undecided line is checked against the day as it is
 * now with the same slot check Yes uses. A line whose time is taken or has passed is
 * re-planned by the one rule (no model call; not counted against the Re-plan limit),
 * with a reason that names the cause. Nothing that fits today closes the line. Lines
 * that still fit are left alone, so a second call with nothing changed writes nothing
 * and returns an empty list.
 */
export async function recheckBriefMoves(callers: BriefMoveCallers, request: BriefMoveRecheckRequest): Promise<BriefMoveRecheckResponse> {
  const { person } = callers;
  const [{ all, latest }, day] = await Promise.all([
    latestDayLines(person, request.localDate),
    readBriefMoveDay(person.supabase, person.userId, request.localDate),
  ]);
  /** Updated as lines are re-planned, so two lines never take the same new time. */
  const positions = openLinePositions(latest.values());

  const calendar = requestBusy(request.context);
  const travel = briefMoveTravel(request.context.travelTimes, travelInput(callers, request.localDate));
  /** Occurrence id to the line that now stands for it (null: none). */
  const outcome = new Map<string, Readonly<{ proposalId: string; line: BriefMoveLine | null }>>();

  for (const row of latest.values()) {
    if (row.status !== "proposed") continue;
    const line = lineFromRow(row);
    const item = day.items.find((candidate) => candidate.occurrenceId === row.occurrence_id);
    if (!line || !item || item.status !== "unresolved") continue;
    const view = slotView(day, item.occurrenceId, calendar, travel, positions);
    const start = Temporal.Instant.from(line.to.startAt);
    const passed = Temporal.Instant.compare(start, person.now) < 0;
    const check = checkBriefMoveSlot({
      interval: { start, end: start.add({ minutes: line.length.minutes }) },
      blocks: view.blocks, travelBeforeSeconds: view.before, travelAfterSeconds: view.after,
    });
    const sameItem = item.revision === line.expectedRevision && item.start.toString() === Temporal.Instant.from(line.from.startAt).toString();
    if (check.ok && !passed && sameItem) continue;

    const time = formatBriefingTime(start.toString(), line.timezone);
    let candidate: BriefMoveCandidate | null;
    if (check.ok && !passed) {
      // The time still fits but the item changed (edited, or moved and back): the same
      // move, rebuilt from the item as it is, so Yes is not refused for a stale revision.
      candidate = rebuiltCandidate(row, line, item, start, line.otherTimes.map((value) => Temporal.Instant.from(value)).filter((value) => !value.equals(start)), line.reason);
    } else {
      const starts = briefMoveFreeStarts({
        localDate: row.local_date, timezone: line.timezone, now: person.now, near: start, lengthSeconds: line.length.minutes * 60,
        blocks: view.blocks, travelBeforeSeconds: view.before, travelAfterSeconds: view.after,
        limit: 1 + BRIEF_MOVE_OTHER_TIMES, exclude: [effectiveStartInstant(day.occurrences.get(item.occurrenceId)!), start],
      });
      const [next, ...others] = starts;
      const why = passed ? `${time} has passed` : check.ok ? `${time} is taken now` : causeClause(day, row, view.blocks, check, time, positions);
      candidate = next ? rebuiltCandidate(row, line, item, next, others, `${why}, so ${formatBriefingTime(next.toString(), line.timezone)} instead.`) : null;
    }
    if (!candidate) {
      await withdrawProposal(await callers.agent(), row.id);
      positions.delete(row.occurrence_id);
      outcome.set(row.occurrence_id, { proposalId: row.id, line: null });
      continue;
    }
    positions.set(row.occurrence_id, { start: Temporal.Instant.from(candidate.to.startAt), end: Temporal.Instant.from(candidate.to.endAt) });
    const [saved] = await saveBriefProposals(await callers.agent(), {
      runId: row.agent_run_id, localDate: row.local_date, refresh: false, candidates: [candidate],
      replaces: new Map([[item.occurrenceId, row.id]]),
    });
    outcome.set(row.occurrence_id, { proposalId: row.id, line: saved ?? null });
  }

  const replaced = [...outcome.values()];
  // Lines the screen shows that closed on their own: the item was moved or marked elsewhere,
  // or a newer line replaced them.
  const byId = new Map(all.map((row) => [row.id, row]));
  for (const id of new Set(request.proposalIds ?? [])) {
    const row = byId.get(id);
    if (!row || row.status === "proposed" || replaced.some((entry) => entry.proposalId === id)) continue;
    if (row.status !== "superseded" && row.status !== "withdrawn") continue;
    const standing = outcome.get(row.occurrence_id);
    const newest = latest.get(row.occurrence_id);
    replaced.push({ proposalId: id, line: standing ? standing.line
      : newest && newest.id !== id && newest.status === "proposed" ? lineFromRow(newest) : null });
  }
  return { replaced };
}

function rebuiltCandidate(row: ProposalRow, line: BriefMoveLine, item: BriefMoveDay["items"][number], next: Temporal.Instant,
  others: readonly Temporal.Instant[], reason: string): BriefMoveCandidate {
  return {
    ...line, key: item.occurrenceId, expectedRevision: item.revision, behaviorRevision: item.behaviorRevision,
    from: { startAt: item.start.toString(), endAt: item.end.toString() },
    to: { startAt: next.toString(), endAt: next.add({ minutes: line.length.minutes }).toString() },
    otherTimes: others.slice(0, BRIEF_MOVE_OTHER_TIMES).map((value) => value.toString()),
    reason,
    // A re-planned reason names an item, never a calendar title.
    anchor: reason === line.reason ? line.anchor : null,
    calendarDerived: reason === line.reason ? (row.line as { calendarDerived?: boolean } | null)?.calendarDerived ?? false : false,
  };
}

/** "5:30 PM is taken now" / "5:30 PM is too close to Piano practice now", never a calendar title. */
function causeClause(day: BriefMoveDay, row: ProposalRow, blocks: readonly BriefMoveBlock[],
  check: Extract<ReturnType<typeof checkBriefMoveSlot>, { ok: false }>, time: string,
  suggested: ReadonlyMap<string, BriefMoveInterval> = new Map()): string {
  const block = blocks.find((candidate) => candidate.ref === check.ref);
  if (block?.kind === "travel") return `${time} is needed for travel now`;
  if (block?.kind === "item") {
    const title = block.title ?? day.items.find((item) => item.occurrenceId === block.ref)?.title;
    // Another line of this brief offers that time: name it as a suggestion, not a change.
    if (title && suggested.has(block.ref)) return check.reason === "too_close" ? `${time} is too close to the time suggested for ${title}` : `${time} is suggested for ${title}`;
    if (title) return check.reason === "too_close" ? `${time} is too close to ${title} now` : `${time} is taken by ${title} now`;
  }
  if (block?.kind === "calendar") return check.reason === "too_close" ? `${time} is too close to a calendar event now` : `${time} is taken by a calendar event now`;
  return `${time} is taken now`;
}

async function withdrawProposal(agent: AppSupabaseClient, proposalId: string): Promise<void> {
  const { error } = await agent.rpc("withdraw_brief_move_proposal", { p_proposal_id: proposalId });
  if (error) throw error;
}

async function recordAnswer(person: OccurrenceMoveCaller, input: Readonly<{
  proposal: ProposalRow; kind: BriefMoveAnswerRequest["kind"]; outcome: "applied" | "refused"; key: string;
  moveId?: string | null; refusalReason?: string | null; batchId?: string | null;
}>): Promise<Readonly<{ proposal: ProposalRow; replayed: boolean }>> {
  const { data, error } = await person.supabase.rpc("answer_move_proposal", {
    p_proposal_id: input.proposal.id,
    p_kind: input.kind,
    p_outcome: input.outcome,
    p_idempotency_key: input.key,
    ...(input.moveId ? { p_move_id: input.moveId } : {}),
    ...(input.refusalReason ? { p_refusal_reason: input.refusalReason } : {}),
    ...(input.batchId ? { p_batch_id: input.batchId } : {}),
  });
  if (error) throw answerError(error);
  const value = data as { replayed: boolean; proposal: Omit<ProposalRow, "user_id"> };
  return { proposal: { ...value.proposal, user_id: person.userId } as ProposalRow, replayed: value.replayed };
}

async function priorAnswer(person: OccurrenceMoveCaller, proposalId: string, key: string, kind: BriefMoveAnswerRequest["kind"]) {
  const { data, error } = await person.supabase.from("move_proposal_answers").select("kind, outcome, move_id")
    .eq("user_id", person.userId).eq("proposal_id", proposalId).eq("idempotency_key", key).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  if (data.kind !== kind) throw new BriefMoveError("idempotency_key_reused");
  return { answer: data as { kind: string; outcome: "applied" | "refused"; move_id: string | null }, proposal: await readProposal(person, proposalId) };
}

async function readProposal(person: OccurrenceMoveCaller, proposalId: string): Promise<ProposalRow> {
  if (!/^[0-9a-f-]{36}$/i.test(proposalId)) throw new BriefMoveError("proposal_not_found");
  const { data, error } = await person.supabase.from("move_proposals").select("*")
    .eq("user_id", person.userId).eq("id", proposalId).maybeSingle();
  if (error) throw error;
  if (!data || data.source !== "daily_brief") throw new BriefMoveError("proposal_not_found");
  return data as ProposalRow;
}

async function lineResult(person: OccurrenceMoveCaller, proposal: ProposalRow, outcome: "applied" | "refused",
  refusal: BriefMoveLineResult["refusal"], moveId: string | null,
  occurrence?: Readonly<{ id: string; effective_start_at?: string | null; effective_end_at?: string | null; updated_at: string; status: string }> | null,
): Promise<BriefMoveLineResult> {
  let current = occurrence ?? null;
  if (current === undefined || current === null) {
    const { data, error } = await person.supabase.from("occurrences").select("id, effective_start_at, effective_end_at, updated_at, status")
      .eq("user_id", person.userId).eq("id", proposal.occurrence_id).maybeSingle();
    if (error) throw error;
    current = data;
  }
  const line = lineFromRow(proposal);
  const standing = APPLIED_STATUSES.includes(proposal.status as BriefMoveProposalStatus)
    && current?.effective_start_at && current.effective_end_at;
  return {
    proposalId: proposal.id, outcome, refusal,
    line: line && standing ? { ...line, appliedTo: spanOf(current!.effective_start_at!, current!.effective_end_at!) } : line,
    occurrence: current ? { id: current.id, effectiveStartAt: current.effective_start_at ?? null, effectiveEndAt: current.effective_end_at ?? null,
      revision: current.updated_at, status: current.status } : null,
    moveId: moveId ?? (outcome === "applied" ? proposal.move_id : null),
  };
}

// ------------------------------------------------------------------ Re-plan

/**
 * "Re-plan" on one line: the next free time by the one rule, away from the time the
 * line showed. The new line replaces the old one. Null when nothing else fits today.
 */
export async function replanBriefMove(callers: BriefMoveCallers, request: BriefMoveReplanRequest): Promise<BriefMoveReplanResponse> {
  const proposal = await readProposal(callers.person, request.proposalId);
  if (proposal.status !== "proposed") throw new BriefMoveError("proposal_closed");
  const old = lineFromRow(proposal);
  if (!old) throw new BriefMoveError("proposal_not_found");
  const { person } = callers;
  const [day, { latest }] = await Promise.all([
    readBriefMoveDay(person.supabase, person.userId, proposal.local_date),
    latestDayLines(person, proposal.local_date),
  ]);
  const item = day.items.find((candidate) => candidate.occurrenceId === proposal.occurrence_id);
  if (!item || item.status !== "unresolved") throw new BriefMoveError("proposal_closed");
  const calendar = briefMoveCalendar(null, request.context.calendarBusy);
  const travel = briefMoveTravel(request.context.travelTimes, travelInput(callers, proposal.local_date));
  const stop = travel?.stops.get(item.occurrenceId);
  const shown = [old.to.startAt, ...old.otherTimes].map((value) => Temporal.Instant.from(value));
  const starts = briefMoveFreeStarts({
    localDate: proposal.local_date, timezone: old.timezone, now: person.now,
    near: Temporal.Instant.from(old.to.startAt), lengthSeconds: old.length.minutes * 60,
    blocks: [
      ...briefMoveItemBlocks(day.items, item.occurrenceId, openLinePositions(latest.values())),
      ...calendar.busy.map((event) => ({ kind: "calendar" as const, ref: event.ref, start: event.start, end: event.end })),
      ...travelBlocksFor(travel, item.occurrenceId),
    ],
    travelBeforeSeconds: stop?.beforeSeconds, travelAfterSeconds: stop?.afterSeconds,
    limit: 1 + BRIEF_MOVE_OTHER_TIMES, exclude: [effectiveStartInstant(day.occurrences.get(item.occurrenceId)!), shown[0]!],
  });
  if (!starts.length) return { line: null, replacedProposalId: proposal.id };
  const [next, ...others] = starts;
  const candidate: BriefMoveCandidate = {
    ...old, key: item.occurrenceId, expectedRevision: item.revision, behaviorRevision: item.behaviorRevision,
    from: { startAt: item.start.toString(), endAt: item.end.toString() },
    to: { startAt: next!.toString(), endAt: next!.add({ minutes: old.length.minutes }).toString() },
    otherTimes: others.map((start) => start.toString()),
    travel: stop ? "checked" : old.travel === "checked" ? "not_checked" : old.travel,
    calendarDerived: (proposal.line as { calendarDerived?: boolean } | null)?.calendarDerived ?? false,
  };
  const [line] = await saveBriefProposals(await callers.agent(), {
    runId: proposal.agent_run_id, localDate: proposal.local_date, refresh: false, candidates: [candidate],
    replaces: new Map([[item.occurrenceId, proposal.id]]),
  });
  return { line: line ?? null, replacedProposalId: proposal.id };
}

// ------------------------------------------------------------------ length and preference

/** "assumes 30 min · change": the person's own length for the Behavior. */
export async function setBriefMoveLength(person: OccurrenceMoveCaller, request: BriefMoveLengthRequest): Promise<BriefMoveLengthResponse> {
  if (!Number.isInteger(request.minutes) || request.minutes < 1 || request.minutes > 1440) throw new BriefMoveError("invalid_request");
  const { data, error } = await person.supabase.rpc("set_behavior_default_length", {
    p_behavior_id: request.behaviorId, p_minutes: request.minutes, p_expected_revision: request.expectedBehaviorRevision,
  });
  if (error) {
    if (error.message === "behavior_revision_changed") throw new BriefMoveError("revision_changed");
    if (error.code === "P0002" || error.message === "behavior_not_found") throw new BriefMoveError("proposal_not_found");
    throw error;
  }
  const row = data as { id: string; default_duration_minutes: number; updated_at: string };
  return { behaviorId: row.id, minutes: row.default_duration_minutes, revision: row.updated_at };
}

export async function readBehaviorMovePreference(person: OccurrenceMoveCaller, behaviorId: string): Promise<BehaviorMovePreference> {
  const { data, error } = await person.supabase.from("behavior_move_preferences").select("never_suggest_move, updated_at")
    .eq("user_id", person.userId).eq("behavior_id", behaviorId).maybeSingle();
  if (error) throw error;
  return { behaviorId, neverSuggestMove: data?.never_suggest_move ?? false, updatedAt: data?.updated_at ?? null };
}

export async function setBehaviorMovePreference(person: OccurrenceMoveCaller, behaviorId: string, neverSuggestMove: boolean): Promise<BehaviorMovePreference> {
  const { data, error } = await person.supabase.rpc("set_behavior_move_preference", { p_behavior_id: behaviorId, p_never_suggest_move: neverSuggestMove });
  if (error) {
    if (error.code === "P0002" || error.message === "behavior_not_found") throw new BriefMoveError("proposal_not_found");
    throw error;
  }
  const row = data as { never_suggest_move: boolean; updated_at: string };
  return { behaviorId, neverSuggestMove: row.never_suggest_move, updatedAt: row.updated_at };
}

// ------------------------------------------------------------------ maintenance

/**
 * Daily maintenance (service role): a line's calendar-derived reason or anchor title
 * is kept for its own local day only. Each new brief also does this for its person.
 */
export async function purgeEndedBriefMoveText(serviceClient: AppSupabaseClient, signal?: AbortSignal): Promise<number> {
  const request = serviceClient.rpc("purge_ended_brief_move_text");
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if (error) throw error;
  return typeof data === "number" ? data : 0;
}

// ------------------------------------------------------------------ helpers

/** The person a client acts as, read through their own profile row (RLS shows only theirs). */
async function ownUserId(supabase: AppSupabaseClient): Promise<string> {
  const { data, error } = await supabase.from("profiles").select("id").limit(2);
  if (error) throw error;
  if (data?.length !== 1) throw new BriefMoveError("unauthenticated");
  return data[0]!.id;
}

async function agentCaller(callers: BriefMoveCallers): Promise<OccurrenceMoveCaller> {
  return { supabase: await callers.agent(), userId: callers.person.userId, now: callers.person.now };
}

function travelInput(callers: BriefMoveCallers, localDate: string) {
  return { secrets: callers.travelSecrets, userId: callers.person.userId, localDate, now: callers.person.now };
}

function requestBusy(context: BriefPlanningContext) {
  return briefMoveCalendar(null, context.calendarBusy).busy;
}

/** The same Accept all key always gives the same batch. */
function batchIdFor(userId: string, key: string): string {
  const hex = createHash("sha256").update(`cadence.brief-move-batch.v1\0${userId}\0${key}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function rethrowKeyReused(error: unknown): never {
  if (error instanceof OccurrenceMoveKeyReusedError) throw new BriefMoveError("idempotency_key_reused");
  throw error;
}

function answerError(error: { message?: string; code?: string }): Error {
  switch (error.message) {
    case "move_proposal_not_found": return new BriefMoveError("proposal_not_found");
    case "move_proposal_closed": return new BriefMoveError("proposal_closed");
    case "move_answer_idempotency_key_reused": return new BriefMoveError("idempotency_key_reused");
    case "move_answer_invalid_input": return new BriefMoveError("invalid_request");
    default: return Object.assign(new Error(error.message ?? "Answer failed"), error);
  }
}
