import { calendarPreflight, calendarResponse, readCalendarRequestBody } from "@/lib/services/google-calendar-request";
import { ChatRequestError, openChatSession } from "./chat.service";

/**
 * Advisor plan Phase 5 (5A): shared route handling. Web cookie auth and the Mac's
 * bearer auth, like the brief routes. A failure before a stream starts is JSON
 * `{ alert: ChatAlert }` with an HTTP status; inside a stream it is an `alert` event.
 */
export const chatPreflight = calendarPreflight;

const NATIVE_ORIGINS = new Set(["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"]);

export async function runChatJson(request: Request, work: (session: Awaited<ReturnType<typeof openChatSession>>, body: () => Promise<unknown>) => Promise<unknown>) {
  try {
    const session = await openChatSession(request);
    return calendarResponse(request, await work(session, () => readChatBody(request)));
  } catch (error) {
    return chatErrorResponse(request, error);
  }
}

export async function readChatBody(request: Request): Promise<unknown> {
  try { return await readCalendarRequestBody(request, 32_000); }
  catch { throw new ChatRequestError(400, { code: "invalid_request", text: "Chat could not read that request." }); }
}

export function chatErrorResponse(request: Request, error: unknown) {
  if (error instanceof ChatRequestError) return calendarResponse(request, { alert: error.alert }, error.status);
  return calendarResponse(request, { alert: { code: "failed", text: "Chat could not finish that just now. Try again." } }, 503);
}

export function chatStreamResponse(request: Request, stream: ReadableStream<Uint8Array>) {
  const origin = request.headers.get("origin");
  return new Response(stream, { status: 200, headers: {
    "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff", "X-Accel-Buffering": "no",
    ...(origin && NATIVE_ORIGINS.has(origin) ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
  } });
}
