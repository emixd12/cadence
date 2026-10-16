import { listCalendarCalendars, updateCalendarPreferences } from "@/lib/services/google-calendar.service";
import { calendarRequestPurpose, calendarPreflight, readCalendarRequestBody, runCalendarRequest } from "@/lib/services/google-calendar-request";
export const OPTIONS = calendarPreflight;
export function GET(request: Request) { return runCalendarRequest(request, (caller) => listCalendarCalendars(caller, calendarRequestPurpose(request))); }
export function PUT(request: Request) { return runCalendarRequest(request, async (caller) => updateCalendarPreferences(caller, await readCalendarRequestBody(request), calendarRequestPurpose(request))); }
