import { chatPreflight, runChatJson } from "@/lib/services/chat/chat-request";
import { parseUndoBody, undoChatOutcome } from "@/lib/services/chat/chat.service";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
/** Advisor Phase 5 (5A): Undo one write chat made (CHAT_ROUTES.undo). No model call. */
export function POST(request: Request) {
  return runChatJson(request, async (session, body) => undoChatOutcome(session, parseUndoBody(await body())));
}
export const OPTIONS = chatPreflight;
