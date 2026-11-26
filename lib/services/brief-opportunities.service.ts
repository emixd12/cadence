import { createHash } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import { noticeText } from "@cadence/core/notices";
import { effectiveStartInstant, localDateAt } from "@cadence/core/resolvers/time.resolver";
import {
  BRIEF_MOVE_OTHER_TIMES,
  briefMoveStartAllowed,
  resolveBriefMoveLength,
  type BriefMoveBlock,
  type BriefMoveCandidate,
  type BriefMoveInterval,
  type BriefMoveTravelInput,
} from "@cadence/core/resolvers/brief-move.resolver";
import {
  briefOpportunityBlocks,
  briefOpportunityStarts,
  checkBriefOpportunitySlot,
  opportunityTravel,
  planBriefOpportunityLinesFromInputs,
  type BriefOpportunityCandidate,
  type BriefOpportunityPlan,
  type BriefOpportunityPoolItem,
} from "@cadence/core/resolvers/brief-opportunity.resolver";
import { BRIEF_MOVE_DEFAULT_LATEST_START_MINUTE, type BriefPlanningContext } from "@cadence/core/types/brief-moves";
import {
  BRIEF_OPPORTUNITIES_VERSION,
  BRIEF_OPPORTUNITY_NEVER_OFFER_AFTER_DECLINES,
  type BehaviorOpportunityPreference,
  type BriefOpportunities,
  type BriefOpportunityAnswerRequest,
  type BriefOpportunityAnswerResponse,
  type BriefOpportunityLine,
  type BriefOpportunityProposalStatus,
  type BriefOpportunityRecheckResponse,
  type BriefOpportunityRefusal,
  type BriefOpportunityReplanRequest,
  type BriefOpportunityReplanResponse,
} from "@cadence/core/types/brief-opportunities";
import type { AdvisorDayContext } from "@cadence/core/types/advisor-day-context";
import { formatBriefingTime } from "@cadence/core/services/daily-brief-presentation";
import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import type { Json, Tables } from "@/lib/db/database.types";
import { readAdvisorOpportunityPool } from "@/lib/services/advisor-day-context.service";
import { readBriefMoveDay, type BriefMoveDay } from "@/lib/services/brief-move-day.service";
import {
  BriefMoveError,
  briefMoveCalendar,
  briefMoveTravel,
  readServerBriefCalendarBusy,
  type BriefMoveCallers,
  type BriefMovePlanningInput,
  type BriefServerCalendarBusyResult,
} from "@/lib/services/brief-moves.service";
import { addOpportunityToToday, removeOpportunityFromToday, type OpportunityCaller } from "@/lib/services/opportunity.service";
import type { TravelConclusionsSecrets } from "@/lib/services/travel-conclusions-token";

/**
 * Behaviors of Opportunity (Task 7): the Daily Brief's "Add for today" lines. The
 * planner (packages/core/src/resolvers/brief-opportunity.resolver.ts) picks the lines;
 * this service reads the pool and the day, saves the lines as proposals through the
 * Daily Brief's agent token, and applies each answer as the person:
 *
 *   Yes, Other time   the one free-slot check, then add_opportunity_occurrence as the
 *                     person with added_by daily_brief (never Completed)
 *   No                closes the Behavior's lines for the rest of the day
 *   Undo              remove_opportunity_occurrence on the added item; counts as No
 *   Don't suggest     the Behavior's never_suggest_add switch, then the line closes
 *
 * Calendar events and travel arrive with each request and are never stored.
 */

type ProposalRow = Tables<"opportunity_proposals">;

const SHOWN_STATUSES: readonly BriefOpportunityProposalStatus[] = ["proposed", "accepted", "declined", "other_time", "undone"];
const STANDING_STATUSES: readonly BriefOpportunityProposalStatus[] = ["accepted", "other_time"];

// ------------------------------------------------------------------ planning

/** The pool as the planner reads it, with each Behavior's length by the move lines' order. */
export async function readBriefOpportunityPool(supabase: AppSupabaseClient, input: Readonly<{
  userId: string; localDate: string; now: Temporal.Instant;
}>): Promise<BriefOpportunityPoolItem[]> {
  const pool = await readAdvisorOpportunityPool(supabase, input);
  return pool.map((item) => ({
    behaviorId: item.behaviorId,
    title: item.title,
    behaviorRevision: item.behaviorRevision,
    length: resolveBriefMoveLength({ behaviorDefaultMinutes: item.defaultDurationMinutes, loggedAverageSeconds: item.loggedAverageSeconds, loggedSampleCount: item.loggedSampleCount ?? 0, estimateMinutes: null }),
    whereKind: item.whereKind,
    daysSinceLastCompleted: item.daysSinceLastCompleted,
    onToday: item.onToday,
  }));
}

/**
 * The opportunity lines the brief would offer now, after its move lines. Reads as the
 * caller; writes nothing. `moveCandidates`: the move lines of the same brief, whose new
 * times block, and which count toward the shared line cap.
 */
export async function planBriefOpportunityDay(input: Readonly<{
  supabase: AppSupabaseClient;
  userId: string;
  localDate: string;
  timezone: string;
  now: Temporal.Instant;
  context: AdvisorDayContext | null;
  planning: BriefMovePlanningInput;
  travelSecrets: TravelConclusionsSecrets;
  day?: BriefMoveDay;
  moveCandidates?: readonly BriefMoveCandidate[];
}>): Promise<BriefOpportunityPlan> {
  const calendar = briefMoveCalendar(input.context, input.planning.calendarBusy);
  if (calendar.state === "stale") return { candidates: [], calendar: "stale" };
  const [day, pool, answers] = await Promise.all([
    input.day ?? readBriefMoveDay(input.supabase, input.userId, input.localDate),
    readBriefOpportunityPool(input.supabase, { userId: input.userId, localDate: input.localDate, now: input.now }),
    readOpportunityDayAnswers(input.supabase, input.userId, input.localDate),
  ]);
  const travel = briefMoveTravel(input.planning.travelTimes, { secrets: input.travelSecrets, userId: input.userId, localDate: input.localDate, now: input.now });
  const moves = input.moveCandidates ?? [];
  return planBriefOpportunityLinesFromInputs({
    localDate: input.localDate, timezone: input.timezone, now: input.now, items: day.items,
    movePositions: new Map(moves.map((line) => [line.occurrenceId, { start: Temporal.Instant.from(line.to.startAt), end: Temporal.Instant.from(line.to.endAt) }])),
    moveLineCount: moves.length,
    calendarBusy: calendar.busy, calendar: calendar.state, travel, pool,
    declinedTodayBehaviorIds: answers.closedToday, neverAddBehaviorIds: answers.neverAdd, offerNeverAddBehaviorIds: answers.offerNeverAdd,
  });
}

async function readOpportunityDayAnswers(supabase: AppSupabaseClient, userId: string, localDate: string) {
  const [today, declines, preferences] = await Promise.all([
    supabase.from("opportunity_proposals").select("behavior_id, status")
      .eq("user_id", userId).eq("local_date", localDate).in("status", ["declined", "undone"]),
    supabase.from("opportunity_proposal_answers").select("behavior_id, local_date")
      .eq("user_id", userId).in("kind", ["no", "undo"]).eq("outcome", "applied")
      .order("created_at", { ascending: false }).limit(1000),
    supabase.from("behavior_move_preferences").select("behavior_id, never_suggest_add").eq("user_id", userId).eq("never_suggest_add", true),
  ]);
  for (const result of [today, declines, preferences]) if (result.error) throw result.error;
  const days = new Map<string, Set<string>>();
  for (const row of declines.data ?? []) days.set(row.behavior_id, (days.get(row.behavior_id) ?? new Set()).add(row.local_date));
  return {
    closedToday: new Set((today.data ?? []).map((row) => row.behavior_id)),
    neverAdd: new Set((preferences.data ?? []).map((row) => row.behavior_id)),
    offerNeverAdd: new Set([...days].filter(([, dates]) => dates.size >= BRIEF_OPPORTUNITY_NEVER_OFFER_AFTER_DECLINES).map(([id]) => id)),
  };
}

/** Saves the planner's lines as the run's proposals. A Refresh closes the day's undecided lines first. */
export async function saveBriefOpportunityProposals(agent: AppSupabaseClient | null, input: Readonly<{
  runId: string | null; localDate: string; refresh: boolean;
  candidates: readonly BriefOpportunityCandidate[];
  /** Behavior id to the proposal a new line replaces (Re-plan, Re-check). */
  replaces?: ReadonlyMap<string, string>;
  containsGoogleCalendar?: boolean;
  googleCalendarGrantGeneration?: number | null;
}>): Promise<BriefOpportunityLine[]> {
  if (!agent || (!input.candidates.length && !input.refresh)) return [];
  const { data, error } = await agent.rpc("record_brief_opportunity_proposals", {
    p_agent_run_id: (input.runId || null) as string,
    p_local_date: input.localDate,
    p_supersede: input.refresh,
    p_proposals: input.candidates.map((candidate) => ({
      behavior_id: candidate.behaviorId,
      proposed_start_at: candidate.at.startAt,
      proposed_end_at: candidate.at.endAt,
      reason: candidate.reasonCode,
      line: Object.fromEntries(Object.entries(candidate).filter(([name]) => name !== "key")),
      replaces_proposal_id: input.replaces?.get(candidate.behaviorId) ?? null,
      ...(input.containsGoogleCalendar ? {
        contains_google_calendar: true,
        google_calendar_grant_generation: input.googleCalendarGrantGeneration ?? null,
      } : {}),
    })) as unknown as Json,
  });
  if (error) throw error;
  return ((data ?? []) as ProposalRow[]).map((row) => lineFromRow(row)).filter((line): line is BriefOpportunityLine => !!line);
}

function lineFromRow(row: ProposalRow, appliedAt: BriefOpportunityLine["appliedAt"] = null): BriefOpportunityLine | null {
  const line = row.line as Partial<BriefOpportunityCandidate> | null;
  if (!line || typeof line !== "object" || !line.length || !line.title) return null;
  return {
    proposalId: row.id,
    behaviorId: row.behavior_id,
    title: line.title,
    localDate: row.local_date,
    timezone: line.timezone ?? "UTC",
    at: spanOf(row.proposed_start_at, row.proposed_end_at),
    length: line.length,
    whereKind: line.whereKind ?? null,
    reasonCode: "open_window",
    daysSinceLastCompleted: line.daysSinceLastCompleted ?? null,
    otherTimes: line.otherTimes ?? [],
    travel: line.travel ?? opportunityTravel(line.whereKind ?? null),
    offerNeverAdd: line.offerNeverAdd ?? false,
    status: row.status as BriefOpportunityProposalStatus,
    occurrenceId: row.occurrence_id,
    appliedAt,
  };
}

function spanOf(startAt: string, endAt: string) {
  return { startAt: Temporal.Instant.from(startAt).toString(), endAt: Temporal.Instant.from(endAt).toString() };
}

// ------------------------------------------------------------------ reading

/** The day's lines as the screen shows them: the latest line per Behavior of this brief's run. */
export async function readBriefOpportunities(supabase: AppSupabaseClient, input: Readonly<{
  userId: string; localDate: string; timezone: string; runId?: string | null;
}>): Promise<BriefOpportunities> {
  const { data, error } = await supabase.from("opportunity_proposals").select("*").eq("user_id", input.userId)
    .eq("local_date", input.localDate).in("status", SHOWN_STATUSES as BriefOpportunityProposalStatus[])
    .order("created_at", { ascending: false }).limit(32);
  if (error) throw error;
  const latest = new Map<string, ProposalRow>();
  for (const row of (data ?? []) as ProposalRow[]) if (!latest.has(row.behavior_id)) latest.set(row.behavior_id, row);
  const rows = [...latest.values()].filter((row) => !input.runId || row.agent_run_id === input.runId);
  const applied = await appliedSpans(supabase, input.userId, rows);
  const lines = rows.map((row) => lineFromRow(row, applied.get(row.id) ?? null)).filter((line): line is BriefOpportunityLine => !!line)
    .sort((left, right) => left.at.startAt.localeCompare(right.at.startAt) || left.proposalId.localeCompare(right.proposalId));
  return { version: BRIEF_OPPORTUNITIES_VERSION, localDate: input.localDate, timezone: input.timezone, runId: input.runId ?? null, lines, calendar: "current" };
}

export function briefOpportunitiesFor(input: Readonly<{ localDate: string; timezone: string; runId: string | null;
  lines: readonly BriefOpportunityLine[]; calendar: BriefOpportunities["calendar"] }>): BriefOpportunities {
  return { version: BRIEF_OPPORTUNITIES_VERSION, ...input };
}

/** Proposal id to where its added item sits now. A removed item has none. */
async function appliedSpans(supabase: AppSupabaseClient, userId: string, rows: readonly ProposalRow[]): Promise<Map<string, BriefOpportunityLine["appliedAt"]>> {
  const standing = rows.filter((row) => row.occurrence_id && STANDING_STATUSES.includes(row.status as BriefOpportunityProposalStatus));
  if (!standing.length) return new Map();
  const { data, error } = await supabase.from("occurrences").select("id, scheduled_for, effective_start_at, effective_end_at")
    .eq("user_id", userId).in("id", standing.map((row) => row.occurrence_id!));
  if (error) throw error;
  const byId = new Map((data ?? []).map((row) => [row.id, row]));
  return new Map(standing.flatMap((row) => {
    const occurrence = byId.get(row.occurrence_id!);
    if (!occurrence) return [];
    const minutes = (row.line as { length?: { minutes?: number } } | null)?.length?.minutes ?? 30;
    const start = effectiveStartInstant(occurrence);
    const end = occurrence.effective_end_at ? Temporal.Instant.from(occurrence.effective_end_at) : start.add({ minutes });
    return [[row.id, { startAt: start.toString(), endAt: end.toString() }] as const];
  }));
}

// ------------------------------------------------------------------ answers

/** Applies one answer. Refusals come back as values; a bad request or a closed line throws BriefMoveError. */
export async function answerBriefOpportunity(callers: BriefMoveCallers, request: BriefOpportunityAnswerRequest): Promise<BriefOpportunityAnswerResponse> {
  const { person } = callers;
  const proposal = await readProposal(person, request.proposalId);
  const prior = await priorAnswer(person, proposal.id, request.idempotencyKey, request.kind);
  if (prior) return response(request, await readLine(person, prior.proposal), prior.answer.outcome, null, prior.answer.occurrence_id, true);

  switch (request.kind) {
    case "no":
    case "never_add": {
      if (request.kind === "never_add") {
        const { error } = await person.supabase.rpc("set_behavior_opportunity_preference", { p_behavior_id: proposal.behavior_id, p_never_suggest_add: true });
        if (error) throw error;
      }
      const recorded = await recordAnswer(person, { proposal, kind: request.kind, outcome: "applied", key: request.idempotencyKey });
      return response(request, await readLine(person, recorded.proposal), "applied", null, null, recorded.replayed);
    }
    case "yes":
    case "other_time": {
      const open = request.kind === "yes" ? proposal.status === "proposed" : proposal.status === "proposed" || proposal.status === "superseded";
      if (!open) throw new BriefMoveError("proposal_closed");
      const line = lineFromRow(proposal);
      if (!line) throw new BriefMoveError("proposal_not_found");
      let start: Temporal.Instant;
      try { start = Temporal.Instant.from(request.kind === "yes" ? proposal.proposed_start_at : request.startAt); } catch { throw new BriefMoveError("invalid_request"); }
      const occurrenceId = occurrenceIdFor(person.userId, proposal.id, request.idempotencyKey);
      // A retry after the add saved but the answer write failed: the item already holds
      // this time, so the slot check would refuse it as taken. The add below replays it.
      const refusal = await addedOccurrenceExists(person, occurrenceId, proposal.behavior_id)
        ? null : await slotRefusal(callers, proposal, line, start, request.context);
      if (refusal) {
        const recorded = await recordAnswer(person, { proposal, kind: request.kind, outcome: "refused", key: request.idempotencyKey, refusalReason: refusal.reason });
        return response(request, await readLine(person, recorded.proposal), "refused", refusal, null, recorded.replayed);
      }
      const added = await addOpportunityToToday(person satisfies OpportunityCaller, {
        behaviorId: proposal.behavior_id,
        placement: { kind: "exact", startTime: wallTime(start, line.timezone) },
        addedBy: "daily_brief",
        occurrenceId,
      });
      if (added.outcome === "refused") {
        const refused: BriefOpportunityRefusal = { reason: added.reason, message: noticeText(added.notice.id, added.notice.params), alternatives: [] };
        const recorded = await recordAnswer(person, { proposal, kind: request.kind, outcome: "refused", key: request.idempotencyKey, refusalReason: added.reason });
        return response(request, await readLine(person, recorded.proposal), "refused", refused, null, recorded.replayed);
      }
      const recorded = await recordAnswer(person, { proposal, kind: request.kind, outcome: "applied", key: request.idempotencyKey, occurrenceId: added.occurrence.id });
      return response(request, await readLine(person, recorded.proposal), "applied", null, added.occurrence.id, recorded.replayed);
    }
    case "undo": {
      if (!STANDING_STATUSES.includes(proposal.status as BriefOpportunityProposalStatus) || !proposal.occurrence_id) throw new BriefMoveError("proposal_closed");
      const title = lineFromRow(proposal)?.title;
      const removed = await removeOpportunityFromToday(person, { occurrenceId: proposal.occurrence_id, ...(title ? { title } : {}) });
      // Already gone (removed on the Timeline or another device): the Undo stands.
      if (removed.outcome === "refused" && removed.reason !== "not_found") {
        const refused: BriefOpportunityRefusal = { reason: removed.reason, message: noticeText(removed.notice.id, removed.notice.params), alternatives: [] };
        const recorded = await recordAnswer(person, { proposal, kind: "undo", outcome: "refused", key: request.idempotencyKey, refusalReason: removed.reason, occurrenceId: proposal.occurrence_id });
        return response(request, await readLine(person, recorded.proposal), "refused", refused, null, recorded.replayed);
      }
      const recorded = await recordAnswer(person, { proposal, kind: "undo", outcome: "applied", key: request.idempotencyKey, occurrenceId: proposal.occurrence_id });
      return response(request, await readLine(person, recorded.proposal), "applied", null, proposal.occurrence_id, recorded.replayed);
    }
  }
}

function response(request: BriefOpportunityAnswerRequest, line: BriefOpportunityLine | null, outcome: "applied" | "refused",
  refusal: BriefOpportunityRefusal | null, occurrenceId: string | null, replayed: boolean): BriefOpportunityAnswerResponse {
  return { target: "opportunity", kind: request.kind, proposalId: request.proposalId, outcome, line, refusal, occurrenceId, replayed };
}

/** The one rule at tap time: the start is today, not past, not after the latest hour, and free. */
async function slotRefusal(callers: BriefMoveCallers, proposal: ProposalRow, line: BriefOpportunityLine, start: Temporal.Instant,
  context: BriefPlanningContext): Promise<BriefOpportunityRefusal | null> {
  const { person } = callers;
  const time = formatBriefingTime(start.toString(), line.timezone);
  const view = await slotView(callers, proposal.local_date, context, proposal.id);
  const alternatives = () => briefOpportunityStarts({
    localDate: proposal.local_date, timezone: line.timezone, now: person.now, near: start, item: line, blocks: view.blocks, travel: view.travel,
    limit: BRIEF_MOVE_OTHER_TIMES, exclude: [start],
  }).map((value) => value.toString());
  if (Temporal.Instant.compare(start.add({ minutes: 1 }), person.now) < 0) {
    return { reason: "time_passed", message: noticeText("brief-opportunity.refused.passed", { time }), alternatives: alternatives() };
  }
  if (!briefMoveStartAllowed(start, proposal.local_date, line.timezone, BRIEF_MOVE_DEFAULT_LATEST_START_MINUTE)
    || localDateAt(start, line.timezone) !== localDateAt(person.now, line.timezone)) {
    return { reason: "not_today", message: noticeText("brief-opportunity.refused.late", { time }), alternatives: alternatives() };
  }
  const check = checkBriefOpportunitySlot({ start, item: line, blocks: view.blocks, travel: view.travel });
  if (check.ok) return null;
  return { reason: check.reason, message: noticeText("brief-opportunity.refused.taken", { time }), alternatives: alternatives() };
}

/** What blocks an opportunity time now: the day's items, open move lines, other open opportunity lines, calendar and travel. */
async function slotView(callers: BriefMoveCallers, localDate: string, context: BriefPlanningContext, excludeProposalId: string | null)
  : Promise<Readonly<{ blocks: BriefMoveBlock[]; travel: BriefMoveTravelInput | null; day: BriefMoveDay; latest: Map<string, ProposalRow>; serverCalendar: BriefServerCalendarBusyResult }>> {
  const { person } = callers;
  const [day, movePositions, latest, serverCalendar] = await Promise.all([
    readBriefMoveDay(person.supabase, person.userId, localDate),
    openMovePositions(person.supabase, person.userId, localDate),
    latestOpportunityLines(person.supabase, person.userId, localDate),
    context.calendarBusy?.length
      ? Promise.resolve<BriefServerCalendarBusyResult>({ busy: briefMoveCalendar(null, context.calendarBusy).busy, containsGoogleCalendar: false, googleCalendarGrantGeneration: null })
      : readServerBriefCalendarBusy({ supabase: person.supabase, userId: person.userId, localDate, now: person.now, user: person.user }),
  ]);
  const travel = briefMoveTravel(context.travelTimes, { secrets: callers.travelSecrets, userId: person.userId, localDate, now: person.now });
  const blocks = briefOpportunityBlocks({ items: day.items, movePositions, calendarBusy: serverCalendar.busy, travel });
  for (const row of latest.values()) {
    if (row.status !== "proposed" || row.id === excludeProposalId) continue;
    blocks.push({ kind: "item", ref: `opportunity:${row.behavior_id}`, start: Temporal.Instant.from(row.proposed_start_at), end: Temporal.Instant.from(row.proposed_end_at) });
  }
  return { blocks, travel, day, latest, serverCalendar };
}

async function openMovePositions(supabase: AppSupabaseClient, userId: string, localDate: string): Promise<Map<string, BriefMoveInterval>> {
  const { data, error } = await supabase.from("move_proposals").select("occurrence_id, proposed_start_at, proposed_end_at")
    .eq("user_id", userId).eq("local_date", localDate).eq("source", "daily_brief").eq("status", "proposed");
  if (error) throw error;
  return new Map((data ?? []).map((row) => [row.occurrence_id, { start: Temporal.Instant.from(row.proposed_start_at), end: Temporal.Instant.from(row.proposed_end_at) }]));
}

async function latestOpportunityLines(supabase: AppSupabaseClient, userId: string, localDate: string): Promise<Map<string, ProposalRow>> {
  const { data, error } = await supabase.from("opportunity_proposals").select("*").eq("user_id", userId).eq("local_date", localDate)
    .order("created_at", { ascending: false }).limit(32);
  if (error) throw error;
  const latest = new Map<string, ProposalRow>();
  for (const row of (data ?? []) as ProposalRow[]) if (!latest.has(row.behavior_id)) latest.set(row.behavior_id, row);
  return latest;
}

// ------------------------------------------------------------------ Re-check and Re-plan

/**
 * Each time the brief opens: every undecided line is checked against the day as it is
 * now with the same rule Yes uses. A line whose time is taken or has passed is re-planned
 * (no model call); when nothing fits it closes as withdrawn. Lines that still fit are
 * left alone, so a second call writes nothing.
 */
export async function recheckBriefOpportunities(callers: BriefMoveCallers, request: Readonly<{
  localDate: string; context: BriefPlanningContext; proposalIds: readonly string[];
}>): Promise<BriefOpportunityRecheckResponse> {
  const { person } = callers;
  const view = await slotView(callers, request.localDate, request.context, null);
  const blocks = [...view.blocks];
  const replaced: Array<Readonly<{ proposalId: string; line: BriefOpportunityLine | null }>> = [];
  const listed = new Set(request.proposalIds);

  for (const row of view.latest.values()) {
    if (row.status !== "proposed") continue;
    const line = lineFromRow(row);
    if (!line) continue;
    const own = `opportunity:${row.behavior_id}`;
    const others = blocks.filter((block) => block.ref !== own);
    const start = Temporal.Instant.from(line.at.startAt);
    const passed = Temporal.Instant.compare(start, person.now) < 0;
    if (!passed && checkBriefOpportunitySlot({ start, item: line, blocks: others, travel: view.travel }).ok) continue;
    const [next, ...more] = briefOpportunityStarts({
      localDate: row.local_date, timezone: line.timezone, now: person.now, near: passed ? person.now.subtract({ nanoseconds: 1 }) : start, item: line,
      blocks: others, travel: view.travel, limit: 1 + BRIEF_MOVE_OTHER_TIMES, exclude: [start],
    });
    const at = blocks.findIndex((block) => block.ref === own);
    if (at >= 0) blocks.splice(at, 1);
    if (!next) {
      const { error } = await (await callers.agent()).rpc("withdraw_brief_opportunity_proposal", { p_proposal_id: row.id });
      if (error) throw error;
      replaced.push({ proposalId: row.id, line: null });
      continue;
    }
    const prevGoogle = (row as { contains_google_calendar?: boolean | null }).contains_google_calendar === true;
    const containsGoogleCalendar = view.serverCalendar.containsGoogleCalendar || (prevGoogle && view.serverCalendar.googleCalendarGrantGeneration !== null);
    const googleCalendarGrantGeneration = containsGoogleCalendar ? view.serverCalendar.googleCalendarGrantGeneration : null;
    const [saved] = await saveBriefOpportunityProposals(await callers.agent(), {
      runId: row.agent_run_id, localDate: row.local_date, refresh: false,
      candidates: [rebuilt(line, next, more)], replaces: new Map([[row.behavior_id, row.id]]),
      containsGoogleCalendar,
      googleCalendarGrantGeneration,
    });
    blocks.push({ kind: "item", ref: own, start: next, end: next.add({ minutes: line.length.minutes }) });
    replaced.push({ proposalId: row.id, line: saved ?? null });
  }
  // Lines the screen shows that closed on their own (answered elsewhere or replaced).
  for (const id of listed) {
    if (replaced.some((entry) => entry.proposalId === id)) continue;
    const row = [...view.latest.values()].find((candidate) => candidate.id === id);
    if (row) continue;
    const { data, error } = await person.supabase.from("opportunity_proposals").select("*").eq("user_id", person.userId).eq("id", id).maybeSingle();
    if (error) throw error;
    if (!data) continue;
    const newest = view.latest.get(data.behavior_id);
    replaced.push({ proposalId: id, line: newest && newest.status === "proposed" ? lineFromRow(newest) : null });
  }
  return { replaced };
}

/** Re-plan one line: the next free time by the one rule, away from the times the line showed. */
export async function replanBriefOpportunity(callers: BriefMoveCallers, request: BriefOpportunityReplanRequest): Promise<BriefOpportunityReplanResponse> {
  const proposal = await readProposal(callers.person, request.opportunityProposalId);
  if (proposal.status !== "proposed") throw new BriefMoveError("proposal_closed");
  const line = lineFromRow(proposal);
  if (!line) throw new BriefMoveError("proposal_not_found");
  const view = await slotView(callers, proposal.local_date, request.context, proposal.id);
  const shown = [line.at.startAt, ...line.otherTimes].map((value) => Temporal.Instant.from(value));
  const [next, ...more] = briefOpportunityStarts({
    localDate: proposal.local_date, timezone: line.timezone, now: callers.person.now, near: shown[0]!, item: line,
    blocks: view.blocks, travel: view.travel, limit: 1 + BRIEF_MOVE_OTHER_TIMES, exclude: [shown[0]!],
  });
  if (!next) return { line: null, replacedProposalId: proposal.id };
  const prevGoogle = (proposal as { contains_google_calendar?: boolean | null }).contains_google_calendar === true;
  const containsGoogleCalendar = view.serverCalendar.containsGoogleCalendar || (prevGoogle && view.serverCalendar.googleCalendarGrantGeneration !== null);
  const googleCalendarGrantGeneration = containsGoogleCalendar ? view.serverCalendar.googleCalendarGrantGeneration : null;
  const [saved] = await saveBriefOpportunityProposals(await callers.agent(), {
    runId: proposal.agent_run_id, localDate: proposal.local_date, refresh: false,
    candidates: [rebuilt(line, next, more)], replaces: new Map([[proposal.behavior_id, proposal.id]]),
    containsGoogleCalendar,
    googleCalendarGrantGeneration,
  });
  return { line: saved ?? null, replacedProposalId: proposal.id };
}

function rebuilt(line: BriefOpportunityLine, next: Temporal.Instant, others: readonly Temporal.Instant[]): BriefOpportunityCandidate {
  return {
    key: line.behaviorId, behaviorId: line.behaviorId, behaviorRevision: "", title: line.title, localDate: line.localDate, timezone: line.timezone,
    at: { startAt: next.toString(), endAt: next.add({ minutes: line.length.minutes }).toString() },
    length: line.length, whereKind: line.whereKind, reasonCode: line.reasonCode, daysSinceLastCompleted: line.daysSinceLastCompleted,
    otherTimes: others.slice(0, BRIEF_MOVE_OTHER_TIMES).map((value) => value.toString()), travel: line.travel, offerNeverAdd: line.offerNeverAdd,
  };
}

// ------------------------------------------------------------------ preference

export async function readBehaviorOpportunityPreference(person: OpportunityCaller, behaviorId: string): Promise<BehaviorOpportunityPreference> {
  const { data, error } = await person.supabase.from("behavior_move_preferences").select("never_suggest_add, updated_at")
    .eq("user_id", person.userId).eq("behavior_id", behaviorId).maybeSingle();
  if (error) throw error;
  return { behaviorId, neverSuggestAdd: data?.never_suggest_add ?? false, updatedAt: data?.updated_at ?? null };
}

export async function setBehaviorOpportunityPreference(person: OpportunityCaller, behaviorId: string, neverSuggestAdd: boolean): Promise<BehaviorOpportunityPreference> {
  const { data, error } = await person.supabase.rpc("set_behavior_opportunity_preference", { p_behavior_id: behaviorId, p_never_suggest_add: neverSuggestAdd });
  if (error) {
    if (error.code === "P0002") throw new BriefMoveError("proposal_not_found");
    throw error;
  }
  const row = data as { never_suggest_add: boolean; updated_at: string };
  return { behaviorId, neverSuggestAdd: row.never_suggest_add, updatedAt: row.updated_at };
}

// ------------------------------------------------------------------ helpers

async function readProposal(person: OpportunityCaller, proposalId: string): Promise<ProposalRow> {
  if (!/^[0-9a-f-]{36}$/i.test(proposalId)) throw new BriefMoveError("proposal_not_found");
  const { data, error } = await person.supabase.from("opportunity_proposals").select("*")
    .eq("user_id", person.userId).eq("id", proposalId).maybeSingle();
  if (error) throw error;
  if (!data) throw new BriefMoveError("proposal_not_found");
  return data as ProposalRow;
}

async function readLine(person: OpportunityCaller, proposal: ProposalRow): Promise<BriefOpportunityLine | null> {
  const applied = await appliedSpans(person.supabase, person.userId, [proposal]);
  return lineFromRow(proposal, applied.get(proposal.id) ?? null);
}

async function priorAnswer(person: OpportunityCaller, proposalId: string, key: string, kind: BriefOpportunityAnswerRequest["kind"]) {
  const { data, error } = await person.supabase.from("opportunity_proposal_answers").select("kind, outcome, occurrence_id")
    .eq("user_id", person.userId).eq("proposal_id", proposalId).eq("idempotency_key", key).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  if (data.kind !== kind) throw new BriefMoveError("idempotency_key_reused");
  return { answer: data as { kind: string; outcome: "applied" | "refused"; occurrence_id: string | null }, proposal: await readProposal(person, proposalId) };
}

async function recordAnswer(person: OpportunityCaller, input: Readonly<{
  proposal: ProposalRow; kind: BriefOpportunityAnswerRequest["kind"]; outcome: "applied" | "refused"; key: string;
  occurrenceId?: string | null; refusalReason?: string | null;
}>): Promise<Readonly<{ proposal: ProposalRow; replayed: boolean }>> {
  const { data, error } = await person.supabase.rpc("answer_opportunity_proposal", {
    p_proposal_id: input.proposal.id,
    p_kind: input.kind,
    p_outcome: input.outcome,
    p_idempotency_key: input.key,
    ...(input.occurrenceId ? { p_occurrence_id: input.occurrenceId } : {}),
    ...(input.refusalReason ? { p_refusal_reason: input.refusalReason } : {}),
  });
  if (error) throw answerError(error);
  const value = data as { replayed: boolean; proposal: Omit<ProposalRow, "user_id"> };
  return { proposal: { ...value.proposal, user_id: person.userId } as ProposalRow, replayed: value.replayed };
}

function answerError(error: { message?: string; code?: string }): Error {
  switch (error.message) {
    case "opportunity_proposal_not_found": return new BriefMoveError("proposal_not_found");
    case "opportunity_proposal_closed": return new BriefMoveError("proposal_closed");
    case "opportunity_answer_idempotency_key_reused": return new BriefMoveError("idempotency_key_reused");
    case "opportunity_answer_invalid_input": return new BriefMoveError("invalid_request");
    default: return Object.assign(new Error(error.message ?? "Answer failed"), error);
  }
}

function wallTime(instant: Temporal.Instant, timezone: string): string {
  const value = instant.toZonedDateTimeISO(timezone);
  return `${String(value.hour).padStart(2, "0")}:${String(value.minute).padStart(2, "0")}`;
}

/** The same tap always adds the same Occurrence, so a lost reply replays in the database. */
async function addedOccurrenceExists(person: OpportunityCaller, occurrenceId: string, behaviorId: string): Promise<boolean> {
  const { data, error } = await person.supabase.from("occurrences").select("id")
    .eq("user_id", person.userId).eq("id", occurrenceId).eq("behavior_id", behaviorId).eq("origin", "opportunity").maybeSingle();
  if (error) throw error;
  return data !== null;
}

function occurrenceIdFor(userId: string, proposalId: string, key: string): string {
  const hex = createHash("sha256").update(`cadence.brief-opportunity.v1\0${userId}\0${proposalId}\0${key}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
