import { answerBriefAlongsideQuestion, parseBriefAlongsideAnswer } from "@/lib/services/brief-alongside.service";
import { briefMovePreflight, runBriefMoveRequest } from "@/lib/services/brief-move-request";
export const dynamic = "force-dynamic";
/** Ticket 360: Yes or No on the brief's alongside question (BRIEF_ALONGSIDE_ROUTE). Refused while CADENCE_ALONGSIDE is off. */
export function POST(request: Request) {
  return runBriefMoveRequest(request, async (callers, _caller, body) => answerBriefAlongsideQuestion(callers.person, parseBriefAlongsideAnswer(await body())));
}
export const OPTIONS = briefMovePreflight;
