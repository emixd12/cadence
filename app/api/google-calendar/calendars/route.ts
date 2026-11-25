import { listCalendarCalendars, syncTimelineSelectionToAiCalendar, updateCalendarPreferences } from "@/lib/services/google-calendar.service";
import { CalendarConnectionError } from "@/lib/services/google-calendar-oauth";
import { calendarRequestPurpose, calendarPreflight, readCalendarRequestBody, runCalendarRequest } from "@/lib/services/google-calendar-request";
export const OPTIONS = calendarPreflight;
export function GET(request: Request) {
  return runCalendarRequest(request, (caller) => {
    const purpose = calendarRequestPurpose(request);
    if (purpose === "retired_agent") throw new CalendarConnectionError("not_configured");
    return listCalendarCalendars(caller, purpose);
  });
}
export function PUT(request: Request) {
  return runCalendarRequest(request, async (caller) => {
    const purpose = calendarRequestPurpose(request);
    if (purpose === "retired_agent") throw new CalendarConnectionError("not_configured");
    return updateCalendarPreferences(caller, await readCalendarRequestBody(request), purpose);
  });
}
export function POST(request: Request) {
  return runCalendarRequest(request, async (caller) => {
    const purpose = calendarRequestPurpose(request);
    if (purpose === "retired_agent") throw new CalendarConnectionError("not_configured");
    if (purpose !== "agent") throw new CalendarConnectionError("invalid_request");
    const view = await syncTimelineSelectionToAiCalendar(caller);
    return { view, hiddenCalendarsSkipped: view.hiddenCalendarsSkipped ?? 0 };
  });
}
