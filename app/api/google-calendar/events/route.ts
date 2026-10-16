import { getCalendarEvents } from "@/lib/services/google-calendar.service";
import { calendarPreflight, calendarRequestPurpose, runCalendarRequest } from "@/lib/services/google-calendar-request";
import { CalendarConnectionError } from "@/lib/services/google-calendar-oauth";
export const OPTIONS = calendarPreflight;
export function GET(request: Request) {
  const url = new URL(request.url);
  return runCalendarRequest(request, (caller) => {
    if (calendarRequestPurpose(request) !== "standard") throw new CalendarConnectionError("invalid_request");
    return getCalendarEvents(caller, url.searchParams.get("start") ?? "", url.searchParams.get("end") ?? "");
  });
}
