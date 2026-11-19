import { replanBriefMove } from "@/lib/services/brief-moves.service";
import { briefMovePreflight, consumeBriefMoveReplanLimit, parseBriefMoveReplan, runBriefMoveRequest } from "@/lib/services/brief-move-request";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
/** Advisor Phase 3A1: "Re-plan" on one line, by the one free-slot rule (BRIEF_MOVE_ROUTES.replan). */
export function POST(request: Request) {
  return runBriefMoveRequest(request, async (callers, _caller, body) => {
    const replan = parseBriefMoveReplan(await body());
    await consumeBriefMoveReplanLimit(callers);
    return replanBriefMove(callers, replan);
  });
}
export const OPTIONS = briefMovePreflight;
