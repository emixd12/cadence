import { disconnectCalendar, getCalendarConnection, retiredAgentCalendarConnection, startCalendarConnection } from "@/lib/services/google-calendar.service";
import { CalendarConnectionError } from "@/lib/services/google-calendar-oauth";
import { calendarRequestPurpose, calendarPreflight, readCalendarRequestBody, runCalendarRequest } from "@/lib/services/google-calendar-request";
export const OPTIONS = calendarPreflight;
// Ticket 307: `purpose=agent` names the retired Daily Brief grant, which older desktop builds still read.
export function GET(request: Request) {
  return runCalendarRequest(request, async (caller) => calendarRequestPurpose(request) === "agent" ? retiredAgentCalendarConnection(caller) : getCalendarConnection(caller));
}
export function DELETE(request: Request) { return runCalendarRequest(request, (caller) => disconnectCalendar(caller, calendarRequestPurpose(request))); }
export function POST(request: Request) {
  return runCalendarRequest(request, async (caller) => {
    const body = await readCalendarRequestBody(request);
    if (!body || typeof body !== "object" || !("target" in body) || (body.target !== "web" && body.target !== "desktop")) throw new CalendarConnectionError("invalid_request");
    const state = "clientState" in body && typeof body.clientState === "string" ? body.clientState : "";
    return startCalendarConnection(caller, body.target, state, new URL(request.url).origin, calendarRequestPurpose(request));
  });
}
