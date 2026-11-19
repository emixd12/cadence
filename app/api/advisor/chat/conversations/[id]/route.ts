import { chatPreflight, runChatJson } from "@/lib/services/chat/chat-request";
import { getConversation } from "@/lib/services/chat/chat.service";
export const dynamic = "force-dynamic";
/** Advisor Phase 5 (5A): one conversation with its messages (CHAT_ROUTES.conversation). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return runChatJson(request, (session) => getConversation(session, id));
}
export const OPTIONS = chatPreflight;
