import { createClient } from "@/lib/supabase/server";
import { finishOutlookCalendarCallback } from "@/lib/services/outlook-calendar.service";

// Ticket 237 Microsoft redirect. Provider error text is never echoed.
const HEADERS = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const { data } = await (await createClient()).auth.getUser();
    const location = await finishOutlookCalendarCallback({ state: url.searchParams.get("state") ?? "", code: url.searchParams.get("code"),
      error: url.searchParams.get("error"), errorDescription: url.searchParams.get("error_description"), cookieUser: data.user, requestOrigin: url.origin });
    return new Response(null, { status: 302, headers: { ...HEADERS, Location: location } });
  } catch {
    return new Response("Outlook Calendar connection could not complete. Return to Settings and try again.", { status: 400, headers: { ...HEADERS, "Content-Type": "text/plain" } });
  }
}
