import { answerBriefMove } from "@/lib/services/brief-moves.service";
import { briefMovePreflight, consumeBriefMoveReplanLimit, parseBriefMoveAnswer, runBriefMoveRequest } from "@/lib/services/brief-move-request";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
/** Advisor Phase 3A1: one answer to the brief's move lines (BRIEF_MOVE_ROUTES.answer). */
export function POST(request: Request) {
  return runBriefMoveRequest(request, async (callers, _caller, body) => {
    const answer = parseBriefMoveAnswer(await body());
    if (answer.kind === "other_time") await consumeBriefMoveReplanLimit(callers);
    return answerBriefMove(callers, answer);
  });
}
export const OPTIONS = briefMovePreflight;
