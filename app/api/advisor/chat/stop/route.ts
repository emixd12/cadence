import { chatPreflight, runChatJson } from "@/lib/services/chat/chat-request";
import { parseStopBody, stopChatTurn } from "@/lib/services/chat/chat.service";
export const dynamic = "force-dynamic";
export const maxDuration = 15;
/** Advisor Phase 5 (5A): Stop a running reply (CHAT_ROUTES.stop). No model call. */
export function POST(request: Request) {
  return runChatJson(request, async (session, body) => stopChatTurn(session, parseStopBody(await body())));
}
export const OPTIONS = chatPreflight;
