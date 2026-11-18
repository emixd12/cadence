import { readBehaviorMovePreference, setBehaviorMovePreference } from "@/lib/services/brief-moves.service";
import { briefMovePreflight, parseBehaviorIdQuery, parseMovePreference, runBriefMoveRequest } from "@/lib/services/brief-move-request";
export const dynamic = "force-dynamic";
/** Advisor Phase 3A1: the Behavior's "Don't suggest moving this" switch (BRIEF_MOVE_ROUTES.preference). */
export function GET(request: Request) {
  return runBriefMoveRequest(request, async (callers) => readBehaviorMovePreference(callers.person, parseBehaviorIdQuery(request)));
}
export function PUT(request: Request) {
  return runBriefMoveRequest(request, async (callers, _caller, body) => {
    const { behaviorId, neverSuggestMove } = parseMovePreference(await body());
    return setBehaviorMovePreference(callers.person, behaviorId, neverSuggestMove);
  });
}
export const OPTIONS = briefMovePreflight;
