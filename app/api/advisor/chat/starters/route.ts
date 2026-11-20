import { chatPreflight, runChatJson } from "@/lib/services/chat/chat-request";
import { readChatStarters } from "@/lib/services/chat/chat-starters";
export const dynamic = "force-dynamic";
/** Advisor Phase 5B: starter questions for an empty conversation (CHAT_ROUTES.starters). No model call. */
export function GET(request: Request) {
  return runChatJson(request, (session) => readChatStarters(session));
}
export const OPTIONS = chatPreflight;
