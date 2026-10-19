import { listIcloudCalendarsForCaller, updateIcloudCalendarPreferences } from "@/lib/services/icloud-calendar.service";
import { connectorPreflight, runConnectorRequest } from "@/lib/services/connector-request";
import { readCalendarRequestBody } from "@/lib/services/google-calendar-request";

// Ticket 227. GET lists VEVENT calendars with opaque IDs; PUT saves the selection.
export const OPTIONS = connectorPreflight;
export function GET(request: Request) { return runConnectorRequest(request, (caller) => listIcloudCalendarsForCaller(caller, { signal: request.signal })); }
export function PUT(request: Request) {
  return runConnectorRequest(request, async (caller) => updateIcloudCalendarPreferences(caller, await readCalendarRequestBody(request), { signal: request.signal }));
}
