import { calendarPreflight, calendarResponse, authenticateCalendarRequest, readCalendarRequestBody } from "@/lib/services/google-calendar-request";
import { getTravelPlaceLabels, saveTravelHabits, TravelSettingsError } from "@/lib/services/travel-settings.service";
import { CalendarConnectionError } from "@/lib/services/google-calendar-oauth";
import type { CalendarCaller } from "@/lib/services/google-calendar.service";

export const dynamic = "force-dynamic";
export const OPTIONS = calendarPreflight;

/** Ticket 217: names for remembered places (Home and Behavior places only). */
export function GET(request: Request) {
  return run(request, getTravelPlaceLabels);
}

/** Ticket 217: one learned-habit change. The owner comes from the session, never the body. */
export function PUT(request: Request) {
  return run(request, async (caller) => saveTravelHabits(caller, await readCalendarRequestBody(request)));
}

async function run(request: Request, operation: (caller: CalendarCaller) => Promise<unknown>) {
  try { return calendarResponse(request, await operation(await authenticateCalendarRequest(request))); }
  catch (error) {
    const code = error instanceof CalendarConnectionError ? error.code
      : error instanceof TravelSettingsError ? error.code : "unavailable";
    const status = code === "unauthenticated" ? 401
      : code === "invalid_request" ? 400 : code === "conflict" ? 409 : 503;
    return calendarResponse(request, { error: code }, status);
  }
}
