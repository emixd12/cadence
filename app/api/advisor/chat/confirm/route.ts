import { chatPreflight, runChatJson } from "@/lib/services/chat/chat-request";
import { answerChatConfirm, parseConfirmBody } from "@/lib/services/chat/chat.service";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
/** Advisor Phase 5 (5A): Yes or No on a chat confirm (CHAT_ROUTES.confirm). No model call. */
export function POST(request: Request) {
  return runChatJson(request, async (session, body) => answerChatConfirm(session, parseConfirmBody(await body())));
}
export const OPTIONS = chatPreflight;
