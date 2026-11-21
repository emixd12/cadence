import { answerBriefMove } from "@/lib/services/brief-moves.service";
import { answerBriefOpportunity } from "@/lib/services/brief-opportunities.service";
import { briefMovePreflight, consumeBriefMoveReplanLimit, parseBriefAnswer, runBriefMoveRequest } from "@/lib/services/brief-move-request";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
/** Advisor Phase 3A1: one answer to the brief's move lines, or (Task 7) its "Add for today" lines (BRIEF_MOVE_ROUTES.answer). */
export function POST(request: Request) {
  return runBriefMoveRequest(request, async (callers, _caller, body) => {
    const parsed = parseBriefAnswer(await body());
    if (parsed.answer.kind === "other_time") await consumeBriefMoveReplanLimit(callers);
    return parsed.target === "opportunity" ? answerBriefOpportunity(callers, parsed.answer) : answerBriefMove(callers, parsed.answer);
  });
}
export const OPTIONS = briefMovePreflight;
