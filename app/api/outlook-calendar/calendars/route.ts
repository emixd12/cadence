import { listOutlookCalendarsForCaller, updateOutlookCalendarPreferences } from "@/lib/services/outlook-calendar.service";
import { connectorPreflight, runConnectorRequest } from "@/lib/services/connector-request";
import { readCalendarRequestBody } from "@/lib/services/google-calendar-request";

// Ticket 237. GET lists readable calendars; PUT saves the selection. Graph
// calendar IDs are long, so the selection body uses the 70 KB calendar limit.
export const OPTIONS = connectorPreflight;
export function GET(request: Request) { return runConnectorRequest(request, (caller) => listOutlookCalendarsForCaller(caller, { signal: request.signal })); }
export function PUT(request: Request) {
  return runConnectorRequest(request, async (caller) => updateOutlookCalendarPreferences(caller, await readCalendarRequestBody(request), { signal: request.signal }));
}
