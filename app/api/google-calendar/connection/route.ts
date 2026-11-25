import { countGoogleCalendarAiChats } from "@/lib/db/google-calendar.repo";
import { disconnectCalendar, getCalendarConnection, retiredAgentCalendarConnection, startCalendarConnection } from "@/lib/services/google-calendar.service";
import { CalendarConnectionError } from "@/lib/services/google-calendar-oauth";
import { calendarRequestPurpose, calendarPreflight, readCalendarRequestBody, runCalendarRequest } from "@/lib/services/google-calendar-request";
export const OPTIONS = calendarPreflight;
// Ticket 307: `purpose=agent` names the retired Daily Brief grant, which older desktop builds still read.
// WS-4A: `purpose=ai_mcp` names the active Google Calendar AI MCP grant.
export function GET(request: Request) {
  return runCalendarRequest(request, async (caller) => {
    const purpose = calendarRequestPurpose(request);
    if (purpose === "retired_agent") return retiredAgentCalendarConnection(caller);
    if (purpose === "agent") {
      const [view, affectedChatCount] = await Promise.all([
        getCalendarConnection(caller, "agent"),
        countGoogleCalendarAiChats(caller.client).catch(() => 0),
      ]);
      return { ...view, affectedChatCount };
    }
    return getCalendarConnection(caller, "standard");
  });
}
export function DELETE(request: Request) {
  return runCalendarRequest(request, (caller) => {
    const purpose = calendarRequestPurpose(request);
    if (purpose === "retired_agent") throw new CalendarConnectionError("not_configured");
    return disconnectCalendar(caller, purpose);
  });
}
export function POST(request: Request) {
  return runCalendarRequest(request, async (caller) => {
    const purpose = calendarRequestPurpose(request);
    if (purpose === "retired_agent") throw new CalendarConnectionError("not_configured");
    const body = await readCalendarRequestBody(request);
    if (!body || typeof body !== "object" || !("target" in body) || (body.target !== "web" && body.target !== "desktop")) throw new CalendarConnectionError("invalid_request");
    const state = "clientState" in body && typeof body.clientState === "string" ? body.clientState : "";
    return startCalendarConnection(caller, body.target, state, new URL(request.url).origin, purpose);
  });
}
