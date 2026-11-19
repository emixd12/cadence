import { setBriefMoveLength } from "@/lib/services/brief-moves.service";
import { briefMovePreflight, parseBriefMoveLength, runBriefMoveRequest } from "@/lib/services/brief-move-request";
export const dynamic = "force-dynamic";
/** Advisor Phase 3A1: "assumes 30 min · change" sets the Behavior's own length (BRIEF_MOVE_ROUTES.length). */
export function POST(request: Request) {
  return runBriefMoveRequest(request, async (callers, _caller, body) => setBriefMoveLength(callers.person, parseBriefMoveLength(await body())));
}
export const OPTIONS = briefMovePreflight;
