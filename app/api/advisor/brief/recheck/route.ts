import { recheckBriefMoves } from "@/lib/services/brief-moves.service";
import { recheckBriefOpportunities } from "@/lib/services/brief-opportunities.service";
import { briefMovePreflight, parseBriefMoveRecheck, runBriefMoveRequest } from "@/lib/services/brief-move-request";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
/**
 * Advisor Phase 3A1: each time the brief opens, its undecided lines are checked against
 * the day as it is now (BRIEF_MOVE_ROUTES.recheck). No model call; no Re-plan limit.
 * Task 7: a body with `opportunityProposalIds` also re-checks the "Add for today" lines,
 * and only then does the response carry `opportunities`.
 */
export function POST(request: Request) {
  return runBriefMoveRequest(request, async (callers, _caller, body) => {
    const { opportunityProposalIds, ...recheck } = parseBriefMoveRecheck(await body());
    const moves = await recheckBriefMoves(callers, recheck);
    if (!opportunityProposalIds) return moves;
    const opportunities = await recheckBriefOpportunities(callers, { localDate: recheck.localDate, context: recheck.context, proposalIds: opportunityProposalIds });
    return { ...moves, opportunities };
  });
}
export const OPTIONS = briefMovePreflight;
