import { recheckBriefMoves } from "@/lib/services/brief-moves.service";
import { briefMovePreflight, parseBriefMoveRecheck, runBriefMoveRequest } from "@/lib/services/brief-move-request";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
/**
 * Advisor Phase 3A1: each time the brief opens, its undecided lines are checked against
 * the day as it is now (BRIEF_MOVE_ROUTES.recheck). No model call; no Re-plan limit.
 */
export function POST(request: Request) {
  return runBriefMoveRequest(request, async (callers, _caller, body) => recheckBriefMoves(callers, parseBriefMoveRecheck(await body())));
}
export const OPTIONS = briefMovePreflight;
