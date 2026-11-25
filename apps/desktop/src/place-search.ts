import type { SupabaseClient } from "@supabase/supabase-js";
import { createPlaceSearchClient, type PlaceSearchClient } from "@/lib/ui/place-search";
import { readDesktopCalendarBrokerOrigin } from "./calendar/google-calendar";

/**
 * A linked Mac queries the hosted place-search proxy with its session token.
 * Local mode returns null so Place and Home stay instant-local + free-text only.
 */
export function createDesktopPlaceSearchClient(
  client: SupabaseClient,
  origin = readDesktopCalendarBrokerOrigin(),
): PlaceSearchClient | null {
  if (!origin) return null;
  return createPlaceSearchClient({
    origin,
    accessToken: async () => {
      const session = (await client.auth.getSession()).data.session;
      if (!session) throw new Error("Place search needs a signed-in account.");
      return session.access_token;
    },
  });
}
