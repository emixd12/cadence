import { Temporal } from "@js-temporal/polyfill";
import type {
  BriefCalendarBusy,
  BriefMoveAnswerRequest,
  BriefMoveErrorCode,
  BriefMoveLengthRequest,
  BriefMoveRecheckRequest,
  BriefMoveReplanRequest,
  BriefPlanningContext,
} from "@cadence/core/types/brief-moves";
import type { BriefOpportunityAnswerRequest, BriefOpportunityReplanRequest } from "@cadence/core/types/brief-opportunities";
import { agentCallerConfigured, createAgentContext } from "@/lib/integrations/agent-caller";
import { authenticateCalendarRequest, calendarPreflight, calendarResponse, readCalendarRequestBody } from "./google-calendar-request";
import { CalendarConnectionError } from "./google-calendar-oauth";
import type { CalendarCaller } from "./google-calendar.service";
import { BriefMoveError, type BriefMoveCallers } from "./brief-moves.service";
import { readTravelConclusionsSecrets } from "./travel-conclusions-token";

/**
 * Advisor Phase 3A1: the answer routes (/api/advisor/brief/answer, /replan, /length,
 * /move-preference). Web sends its session cookie and the Mac its Bearer token, as for
 * the brief itself. Bodies are checked strictly here; the service and the database
 * check them again. Errors come back as { error: BriefMoveErrorCode }.
 */

export const briefMovePreflight = calendarPreflight;

const BODY_LIMIT_BYTES = 64_000;
const MAX_CALENDAR_EVENTS = 200;
const KEY = /^[A-Za-z0-9._:-]{1,200}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function runBriefMoveRequest(request: Request,
  run: (callers: BriefMoveCallers, caller: CalendarCaller, body: () => Promise<unknown>) => Promise<unknown>) {
  try {
    const caller = await authenticateCalendarRequest(request);
    let agent: Promise<BriefMoveCallers["person"]["supabase"]> | null = null;
    const callers: BriefMoveCallers = {
      person: { supabase: caller.client, userId: caller.user.id, now: Temporal.Now.instant() },
      agent: () => {
        if (!agentCallerConfigured()) throw new BriefMoveError("advisor_unavailable");
        agent ??= createAgentContext(caller.user.id, "daily_brief").then((context) => context.supabase);
        return agent;
      },
      travelSecrets: readTravelConclusionsSecrets(process.env),
    };
    return calendarResponse(request, await run(callers, caller, () => readCalendarRequestBody(request, BODY_LIMIT_BYTES)));
  } catch (error) {
    const code: BriefMoveErrorCode = error instanceof BriefMoveError ? error.code
      : error instanceof CalendarConnectionError ? (error.code === "unauthenticated" ? "unauthenticated" : error.code === "invalid_request" ? "invalid_request" : "advisor_unavailable")
        : "advisor_unavailable";
    if (code === "advisor_unavailable" && !(error instanceof BriefMoveError)) console.error("brief move request failed", errorName(error));
    const retryAfterSeconds = error instanceof BriefMoveError && error.code === "rate_limited" ? error.retryAfterSeconds : undefined;
    return calendarResponse(request, { error: code, ...(retryAfterSeconds ? { retryAfterSeconds } : {}) }, STATUS[code]);
  }
}

const STATUS: Readonly<Record<BriefMoveErrorCode, number>> = {
  unauthenticated: 401,
  invalid_request: 400,
  proposal_not_found: 404,
  proposal_closed: 409,
  idempotency_key_reused: 409,
  revision_changed: 409,
  rate_limited: 429,
  advisor_unavailable: 503,
};

/** Logs the kind of failure only: never a message that could hold a person's data. */
function errorName(error: unknown): string {
  return error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : error instanceof Error ? error.name : "unknown";
}

/** Re-plan and Other time: thirty per account in ten minutes. */
export async function consumeBriefMoveReplanLimit(callers: BriefMoveCallers): Promise<void> {
  const { data, error } = await callers.person.supabase.rpc("consume_launch_rate_limit", { p_action: "brief_move_replan" });
  if (error) throw error;
  const row = (data ?? [])[0];
  if (row && !row.allowed) throw new BriefMoveError("rate_limited", undefined, row.retry_after_seconds);
}

// ------------------------------------------------------------------ parsing

function invalid(): never {
  throw new BriefMoveError("invalid_request");
}

function record(value: unknown, keys: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const item = value as Record<string, unknown>;
  for (const key of Object.keys(item)) if (!keys.includes(key) && !optional.includes(key)) invalid();
  for (const key of keys) if (!(key in item)) invalid();
  return item;
}

function text(value: unknown, pattern: RegExp): string {
  if (typeof value !== "string" || !pattern.test(value)) invalid();
  return value;
}

function instant(value: unknown): string {
  if (typeof value !== "string" || value.length > 40) invalid();
  try { return Temporal.Instant.from(value).toString(); } catch { invalid(); }
}

/** A revision as the screen read it (an Occurrence's or Behavior's updated_at). */
function revision(value: unknown): string {
  if (typeof value !== "string" || value.length > 40) invalid();
  try { Temporal.Instant.from(value); } catch { invalid(); }
  return value;
}

export function parsePlanningContext(value: unknown): BriefPlanningContext {
  if (value === undefined) return { calendarBusy: [] };
  const item = record(value, [], ["calendarBusy", "travelTimes"]);
  const busy = item.calendarBusy ?? [];
  if (!Array.isArray(busy) || busy.length > MAX_CALENDAR_EVENTS) invalid();
  const calendarBusy: BriefCalendarBusy[] = busy.map((event) => {
    const entry = record(event, ["startAt", "endAt"], ["ref", "title"]);
    if (entry.ref !== undefined && (typeof entry.ref !== "string" || entry.ref.length > 512)) invalid();
    if (entry.title !== undefined && (typeof entry.title !== "string" || entry.title.length > 200)) invalid();
    return { startAt: instant(entry.startAt), endAt: instant(entry.endAt),
      ...(entry.ref !== undefined ? { ref: entry.ref as string } : {}), ...(entry.title !== undefined ? { title: (entry.title as string).trim() } : {}) };
  });
  if (item.travelTimes !== undefined && item.travelTimes !== null && (typeof item.travelTimes !== "string" || item.travelTimes.length > 32_768)) invalid();
  return { calendarBusy, ...(typeof item.travelTimes === "string" ? { travelTimes: item.travelTimes } : {}) };
}

export function parseBriefMoveAnswer(value: unknown): BriefMoveAnswerRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const kind = (value as { kind?: unknown }).kind;
  switch (kind) {
    case "yes": {
      const item = record(value, ["kind", "idempotencyKey", "proposalId", "expectedRevision"], ["context"]);
      return { kind, idempotencyKey: text(item.idempotencyKey, KEY), proposalId: text(item.proposalId, UUID),
        expectedRevision: revision(item.expectedRevision), context: parsePlanningContext(item.context) };
    }
    case "other_time": {
      const item = record(value, ["kind", "idempotencyKey", "proposalId", "expectedRevision", "startAt"], ["context"]);
      return { kind, idempotencyKey: text(item.idempotencyKey, KEY), proposalId: text(item.proposalId, UUID),
        expectedRevision: revision(item.expectedRevision), startAt: instant(item.startAt), context: parsePlanningContext(item.context) };
    }
    case "already_done":
    case "undo": {
      const item = record(value, ["kind", "idempotencyKey", "proposalId", "expectedRevision"]);
      return { kind, idempotencyKey: text(item.idempotencyKey, KEY), proposalId: text(item.proposalId, UUID), expectedRevision: revision(item.expectedRevision) };
    }
    case "no":
    case "never_move": {
      const item = record(value, ["kind", "idempotencyKey", "proposalId"]);
      return { kind, idempotencyKey: text(item.idempotencyKey, KEY), proposalId: text(item.proposalId, UUID) };
    }
    case "accept_all": {
      const item = record(value, ["kind", "idempotencyKey", "lines"], ["context"]);
      if (!Array.isArray(item.lines) || item.lines.length < 1 || item.lines.length > 16) invalid();
      const lines = item.lines.map((line) => {
        const entry = record(line, ["proposalId", "expectedRevision"]);
        return { proposalId: text(entry.proposalId, UUID), expectedRevision: revision(entry.expectedRevision) };
      });
      if (new Set(lines.map((line) => line.proposalId)).size !== lines.length) invalid();
      return { kind, idempotencyKey: text(item.idempotencyKey, KEY), lines, context: parsePlanningContext(item.context) };
    }
    case "undo_all": {
      const item = record(value, ["kind", "idempotencyKey", "batchId"]);
      return { kind, idempotencyKey: text(item.idempotencyKey, KEY), batchId: text(item.batchId, UUID) };
    }
    default:
      invalid();
  }
}

/** Behaviors of Opportunity (Task 7): an answer to an "Add for today" line (`target: "opportunity"`). */
export function parseBriefOpportunityAnswer(value: unknown): BriefOpportunityAnswerRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const kind = (value as { kind?: unknown }).kind;
  const base = ["target", "kind", "idempotencyKey", "proposalId"];
  switch (kind) {
    case "yes": {
      const item = record(value, base, ["context"]);
      return { target: "opportunity", kind, idempotencyKey: text(item.idempotencyKey, KEY), proposalId: text(item.proposalId, UUID), context: parsePlanningContext(item.context) };
    }
    case "other_time": {
      const item = record(value, [...base, "startAt"], ["context"]);
      return { target: "opportunity", kind, idempotencyKey: text(item.idempotencyKey, KEY), proposalId: text(item.proposalId, UUID),
        startAt: instant(item.startAt), context: parsePlanningContext(item.context) };
    }
    case "no":
    case "undo":
    case "never_add": {
      const item = record(value, base);
      return { target: "opportunity", kind, idempotencyKey: text(item.idempotencyKey, KEY), proposalId: text(item.proposalId, UUID) };
    }
    default:
      invalid();
  }
}

/** The answer route's body: an opportunity answer when `target` is "opportunity", else a move answer. */
export function parseBriefAnswer(value: unknown): Readonly<{ target: "move"; answer: BriefMoveAnswerRequest }> | Readonly<{ target: "opportunity"; answer: BriefOpportunityAnswerRequest }> {
  if (value && typeof value === "object" && !Array.isArray(value) && "target" in value) {
    if ((value as { target?: unknown }).target !== "opportunity") invalid();
    return { target: "opportunity", answer: parseBriefOpportunityAnswer(value) };
  }
  return { target: "move", answer: parseBriefMoveAnswer(value) };
}

export function parseBriefOpportunityReplan(value: unknown): BriefOpportunityReplanRequest {
  const item = record(value, ["opportunityProposalId"], ["context"]);
  return { opportunityProposalId: text(item.opportunityProposalId, UUID), context: parsePlanningContext(item.context) };
}

/** The Re-plan route's body: an opportunity line when it names `opportunityProposalId`. */
export function isOpportunityReplan(value: unknown): boolean {
  return !!value && typeof value === "object" && !Array.isArray(value) && "opportunityProposalId" in value;
}

export function parseBriefMoveReplan(value: unknown): BriefMoveReplanRequest {
  const item = record(value, ["proposalId"], ["context"]);
  return { proposalId: text(item.proposalId, UUID), context: parsePlanningContext(item.context) };
}

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `opportunityProposalIds` (Task 7) asks for the opportunity lines' re-check too. A body
 * without it gets the move re-check only, as before.
 */
export function parseBriefMoveRecheck(value: unknown): BriefMoveRecheckRequest & Readonly<{ opportunityProposalIds?: readonly string[] }> {
  const item = record(value, ["localDate"], ["context", "proposalIds", "opportunityProposalIds"]);
  const localDate = text(item.localDate, LOCAL_DATE);
  try { Temporal.PlainDate.from(localDate); } catch { invalid(); }
  const ids = item.proposalIds ?? [];
  if (!Array.isArray(ids) || ids.length > 64) invalid();
  const opportunityIds = item.opportunityProposalIds;
  if (opportunityIds !== undefined && (!Array.isArray(opportunityIds) || opportunityIds.length > 32)) invalid();
  return {
    localDate, context: parsePlanningContext(item.context), proposalIds: [...new Set(ids.map((id) => text(id, UUID)))],
    ...(Array.isArray(opportunityIds) ? { opportunityProposalIds: [...new Set(opportunityIds.map((id) => text(id, UUID)))] } : {}),
  };
}

export function parseBriefMoveLength(value: unknown): BriefMoveLengthRequest {
  const item = record(value, ["behaviorId", "minutes", "expectedBehaviorRevision"]);
  if (typeof item.minutes !== "number" || !Number.isInteger(item.minutes) || item.minutes < 1 || item.minutes > 1440) invalid();
  return { behaviorId: text(item.behaviorId, UUID), minutes: item.minutes, expectedBehaviorRevision: revision(item.expectedBehaviorRevision) };
}

export function parseMovePreference(value: unknown): Readonly<{ behaviorId: string; neverSuggestMove: boolean }> {
  const item = record(value, ["behaviorId", "neverSuggestMove"]);
  if (typeof item.neverSuggestMove !== "boolean") invalid();
  return { behaviorId: text(item.behaviorId, UUID), neverSuggestMove: item.neverSuggestMove };
}

/** "Don't suggest adding this" (Task 7): `{ behaviorId, neverSuggestAdd }`. */
export function parseOpportunityPreference(value: unknown): Readonly<{ behaviorId: string; neverSuggestAdd: boolean }> | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || !("neverSuggestAdd" in value)) return null;
  const item = record(value, ["behaviorId", "neverSuggestAdd"]);
  if (typeof item.neverSuggestAdd !== "boolean") invalid();
  return { behaviorId: text(item.behaviorId, UUID), neverSuggestAdd: item.neverSuggestAdd };
}

/** GET `?kind=opportunity` reads the "Don't suggest adding this" switch. */
export function isOpportunityPreferenceQuery(request: Request): boolean {
  return new URL(request.url).searchParams.get("kind") === "opportunity";
}

export function parseBehaviorIdQuery(request: Request): string {
  return text(new URL(request.url).searchParams.get("behaviorId"), UUID);
}
