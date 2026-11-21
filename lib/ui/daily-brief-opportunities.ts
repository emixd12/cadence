import { BRIEF_MOVE_ROUTES, type BriefMoveRecheckResponse, type BriefPlanningContext } from "@cadence/core/types/brief-moves";
import {
  BRIEF_OPPORTUNITY_LINES_FEATURE,
  type BehaviorOpportunityPreference,
  type BriefOpportunityAnswerRequest,
  type BriefOpportunityAnswerResponse,
  type BriefOpportunityRecheckResponse,
  type BriefOpportunityReplanRequest,
  type BriefOpportunityReplanResponse,
} from "@cadence/core/types/brief-opportunities";

/**
 * Behaviors of Opportunity (Task 7): the brief's "Add for today" answers. They reuse the
 * move routes with an opportunity body, so a client without this transport (Cadence for
 * Mac until it ships its own) never sees opportunity lines or fields.
 */
export type BriefOpportunityClient = Readonly<{
  answer: (request: BriefOpportunityAnswerRequest, signal?: AbortSignal) => Promise<BriefOpportunityAnswerResponse>;
  replan: (request: BriefOpportunityReplanRequest, signal?: AbortSignal) => Promise<BriefOpportunityReplanResponse>;
  recheck: (request: Readonly<{ localDate: string; context: BriefPlanningContext; proposalIds: readonly string[] }>, signal?: AbortSignal) => Promise<BriefOpportunityRecheckResponse>;
  preference: (input: Readonly<{ behaviorId: string; neverSuggestAdd: boolean }>, signal?: AbortSignal) => Promise<BehaviorOpportunityPreference>;
}>;

/** The brief request's opt-in for opportunity lines, for clients that render them. */
export const DAILY_BRIEF_OPPORTUNITY_FEATURES = Object.freeze([BRIEF_OPPORTUNITY_LINES_FEATURE] as const);

type Request = <T>(path: string, init: RequestInit, signal?: AbortSignal) => Promise<T>;

const TIMELINE_ANSWERS = new Set<BriefOpportunityAnswerRequest["kind"]>(["yes", "other_time", "undo"]);

export function createBriefOpportunityClient(request: Request, onTimelineChanged: () => void = () => undefined): BriefOpportunityClient {
  return {
    answer: async (body, signal) => {
      const response = await request<BriefOpportunityAnswerResponse>(BRIEF_MOVE_ROUTES.answer, { method: "POST", body: JSON.stringify(body) }, signal);
      if (TIMELINE_ANSWERS.has(body.kind) && response.outcome === "applied") onTimelineChanged();
      return response;
    },
    replan: (body, signal) => request<BriefOpportunityReplanResponse>(BRIEF_MOVE_ROUTES.replan, { method: "POST", body: JSON.stringify(body) }, signal),
    recheck: async (body, signal) => {
      const response = await request<BriefMoveRecheckResponse & Readonly<{ opportunities?: BriefOpportunityRecheckResponse }>>(BRIEF_MOVE_ROUTES.recheck, {
        method: "POST", body: JSON.stringify({ localDate: body.localDate, context: body.context, proposalIds: [], opportunityProposalIds: body.proposalIds }),
      }, signal);
      return response.opportunities ?? { replaced: [] };
    },
    preference: (body, signal) =>
      request<BehaviorOpportunityPreference>(BRIEF_MOVE_ROUTES.preference, { method: "PUT", body: JSON.stringify(body) }, signal),
  };
}
