import { chatPreflight, runChatJson } from "@/lib/services/chat/chat-request";
import { listConversations } from "@/lib/services/chat/chat.service";
export const dynamic = "force-dynamic";
/** Advisor Phase 5 (5A): past conversations, newest first (CHAT_ROUTES.conversations). */
export function GET(request: Request) {
  return runChatJson(request, (session) => listConversations(session, new URL(request.url)));
}
export const OPTIONS = chatPreflight;
