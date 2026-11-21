import { replanBriefMove } from "@/lib/services/brief-moves.service";
import { replanBriefOpportunity } from "@/lib/services/brief-opportunities.service";
import { briefMovePreflight, consumeBriefMoveReplanLimit, isOpportunityReplan, parseBriefMoveReplan, parseBriefOpportunityReplan, runBriefMoveRequest } from "@/lib/services/brief-move-request";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
/** Advisor Phase 3A1: "Re-plan" on one line, by the one free-slot rule (BRIEF_MOVE_ROUTES.replan). Task 7: `opportunityProposalId` re-plans an "Add for today" line. */
export function POST(request: Request) {
  return runBriefMoveRequest(request, async (callers, _caller, body) => {
    const value = await body();
    if (isOpportunityReplan(value)) {
      const replan = parseBriefOpportunityReplan(value);
      await consumeBriefMoveReplanLimit(callers);
      return replanBriefOpportunity(callers, replan);
    }
    const replan = parseBriefMoveReplan(value);
    await consumeBriefMoveReplanLimit(callers);
    return replanBriefMove(callers, replan);
  });
}
export const OPTIONS = briefMovePreflight;
