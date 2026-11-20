import type { SupabaseClient } from "@supabase/supabase-js";
import { createChatClient, type ChatClient } from "@/lib/ui/chat";
import { readDesktopCalendarBrokerOrigin } from "./calendar/google-calendar";

/**
 * Advisor plan Phase 5C: Chat on Cadence for Mac. The Mac calls the same hosted chat
 * routes as the web page, with this Mac's bearer session instead of a cookie.
 *
 * Chat writes hosted records only. The Mac never applies them locally: after a turn,
 * a Yes or an Undo that changed something, `onAccountWrite` asks account sync to pull
 * them, the same path the brief's move answers take. The Timeline redraws after that
 * sync round.
 */
export function createDesktopChatClient(
  client: SupabaseClient,
  onAccountWrite: () => void,
  origin = readDesktopCalendarBrokerOrigin(),
  fetcher: typeof fetch = (...args) => fetch(...args),
): ChatClient | null {
  if (!origin) return null;
  const accessToken = async () => (await client.auth.getSession()).data.session?.access_token ?? null;
  return withAccountWrites(createChatClient(desktopChatFetch(origin, accessToken, fetcher)), onAccountWrite);
}

type AccessToken = () => Promise<string | null>;

/** Sends a chat route to the hosted origin with the bearer session; never sends cookies or follows redirects. */
export function desktopChatFetch(origin: string, accessToken: AccessToken, fetcher: typeof fetch) {
  return async (path: string, init: RequestInit = {}): Promise<Response> => {
    const token = await accessToken();
    // The chat routes answer 401 with a "sign in again" alert; the page shows it like any failure.
    const headers = new Headers(init.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return fetcher(`${origin}${path}`, { ...init, headers, credentials: "omit", redirect: "error" });
  };
}

/** Calls `onAccountWrite` once after any call that changed hosted records. */
export function withAccountWrites(client: ChatClient, onAccountWrite: () => void): ChatClient {
  return {
    ...client,
    async sendTurn(request, onEvent, signal) {
      let wrote = false;
      try {
        await client.sendTurn(request, (event) => {
          if (event.type === "outcome") wrote = true;
          onEvent(event);
        }, signal);
      } finally {
        // A stopped or dropped turn may still have written before it ended.
        if (wrote) onAccountWrite();
      }
    },
    async confirm(confirmId, answer) {
      const response = await client.confirm(confirmId, answer);
      if (response.outcomes.length > 0) onAccountWrite();
      return response;
    },
    async undo(outcomeId) {
      const response = await client.undo(outcomeId);
      onAccountWrite();
      return response;
    },
  };
}
