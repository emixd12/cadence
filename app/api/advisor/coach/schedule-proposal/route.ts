import { Temporal } from "@js-temporal/polyfill";
import type { ScheduleProposalAnswer, ScheduleProposalErrorCode } from "@cadence/core/types/behavior-change-proposals";

import { authenticateCalendarRequest, calendarPreflight, calendarResponse, readCalendarRequestBody } from "@/lib/services/google-calendar-request";
import { CalendarConnectionError } from "@/lib/services/google-calendar-oauth";
import {
  answerScheduleProposal,
  readScheduleProposal,
  ScheduleProposalError,
  type ScheduleProposalCaller,
} from "@/lib/services/behavior-change-proposals.service";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Advisor Phase 4C: the advisor's schedule proposal ("Try for two weeks").
 * GET returns what to show now (ScheduleProposalView). POST records one answer:
 * { proposalId, answer: "try" | "for_good" | "no" | "keep" | "go_back" }.
 * Web sends its session cookie and the Mac its Bearer token, as for the brief.
 * Errors come back as { error: ScheduleProposalErrorCode }.
 */
export function GET(request: Request) {
  return run(request, (caller) => readScheduleProposal(caller));
}

export function POST(request: Request) {
  return run(request, async (caller) => {
    const body = await readCalendarRequestBody(request, 4_000);
    return answerScheduleProposal(caller, parseAnswer(body));
  });
}

export const OPTIONS = calendarPreflight;

const ANSWERS: readonly ScheduleProposalAnswer[] = ["try", "for_good", "no", "keep", "go_back"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseAnswer(value: unknown): { proposalId: string; answer: ScheduleProposalAnswer } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ScheduleProposalError("invalid_request");
  const item = value as Record<string, unknown>;
  if (Object.keys(item).some((key) => key !== "proposalId" && key !== "answer")) throw new ScheduleProposalError("invalid_request");
  if (typeof item.proposalId !== "string" || !UUID.test(item.proposalId)) throw new ScheduleProposalError("invalid_request");
  if (!ANSWERS.includes(item.answer as ScheduleProposalAnswer)) throw new ScheduleProposalError("invalid_request");
  return { proposalId: item.proposalId, answer: item.answer as ScheduleProposalAnswer };
}

const STATUS: Readonly<Record<ScheduleProposalErrorCode, number>> = {
  unauthenticated: 401,
  invalid_request: 400,
  proposal_not_found: 404,
  proposal_closed: 409,
  held_today: 409,
  schedule_changed: 409,
  revision_changed: 409,
  advisor_unavailable: 503,
};

async function run(request: Request, handler: (caller: ScheduleProposalCaller) => Promise<unknown>) {
  try {
    const authenticated = await authenticateCalendarRequest(request);
    const caller: ScheduleProposalCaller = { supabase: authenticated.client, userId: authenticated.user.id, now: Temporal.Now.instant() };
    return calendarResponse(request, await handler(caller));
  } catch (error) {
    const code: ScheduleProposalErrorCode = error instanceof ScheduleProposalError ? error.code
      : error instanceof CalendarConnectionError
        ? (error.code === "unauthenticated" ? "unauthenticated" : error.code === "invalid_request" ? "invalid_request" : "advisor_unavailable")
        : "advisor_unavailable";
    if (code === "advisor_unavailable") console.error("schedule proposal request failed", error instanceof Error ? error.name : "unknown");
    return calendarResponse(request, { error: code }, STATUS[code]);
  }
}
