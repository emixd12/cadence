import { chatErrorResponse, chatPreflight, chatStreamResponse, readChatBody } from "@/lib/services/chat/chat-request";
import { openChatSession, parseChatTurnBody, streamChatTurn } from "@/lib/services/chat/chat.service";
export const dynamic = "force-dynamic";
export const maxDuration = 90;
/** Advisor Phase 5 (5A): one chat question, streamed as NDJSON ChatEvent lines (CHAT_ROUTES.turn). */
export async function POST(request: Request) {
  try {
    const session = await openChatSession(request);
    const body = parseChatTurnBody(await readChatBody(request));
    return chatStreamResponse(request, await streamChatTurn(session, body));
  } catch (error) {
    return chatErrorResponse(request, error);
  }
}
export const OPTIONS = chatPreflight;
