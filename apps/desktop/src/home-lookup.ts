import type { SupabaseClient } from "@supabase/supabase-js";
import { createHomeLookupClient, type HomeLookupClient } from "@/lib/ui/home-lookup";
import { readDesktopCalendarBrokerOrigin } from "./calendar/google-calendar";

/**
 * Ticket 308: a linked Mac asks the hosted server for a Home address from the Mac's position.
 * Local mode has no client, so Home stays typed only. Nothing is stored in SQLite.
 */
export function createDesktopHomeLookupClient(client: SupabaseClient, origin = readDesktopCalendarBrokerOrigin()): HomeLookupClient | null {
  if (!origin) return null;
  return createHomeLookupClient({ origin, accessToken: async () => {
    const session = (await client.auth.getSession()).data.session;
    if (!session) throw new Error("Home lookup needs a signed-in account.");
    return session.access_token;
  } });
}
