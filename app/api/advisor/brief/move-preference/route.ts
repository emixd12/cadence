import { readBehaviorMovePreference, setBehaviorMovePreference } from "@/lib/services/brief-moves.service";
import { readBehaviorOpportunityPreference, setBehaviorOpportunityPreference } from "@/lib/services/brief-opportunities.service";
import { briefMovePreflight, isOpportunityPreferenceQuery, parseBehaviorIdQuery, parseMovePreference, parseOpportunityPreference, runBriefMoveRequest } from "@/lib/services/brief-move-request";
export const dynamic = "force-dynamic";
/**
 * Advisor Phase 3A1: the Behavior's "Don't suggest moving this" switch (BRIEF_MOVE_ROUTES.preference).
 * Task 7: `?kind=opportunity` (GET) and `{ behaviorId, neverSuggestAdd }` (PUT) are "Don't suggest adding this".
 */
export function GET(request: Request) {
  return runBriefMoveRequest(request, async (callers) => isOpportunityPreferenceQuery(request)
    ? readBehaviorOpportunityPreference(callers.person, parseBehaviorIdQuery(request))
    : readBehaviorMovePreference(callers.person, parseBehaviorIdQuery(request)));
}
export function PUT(request: Request) {
  return runBriefMoveRequest(request, async (callers, _caller, body) => {
    const value = await body();
    const opportunity = parseOpportunityPreference(value);
    if (opportunity) return setBehaviorOpportunityPreference(callers.person, opportunity.behaviorId, opportunity.neverSuggestAdd);
    const { behaviorId, neverSuggestMove } = parseMovePreference(value);
    return setBehaviorMovePreference(callers.person, behaviorId, neverSuggestMove);
  });
}
export const OPTIONS = briefMovePreflight;
