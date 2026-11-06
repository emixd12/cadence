import { getOutlookCalendarEvents } from "@/lib/services/outlook-calendar.service";
import { connectorPreflight, runConnectorRequest } from "@/lib/services/connector-request";

// Ticket 237. Schema 1.1.0 snapshot for today through today + 30.
// Ticket 283: `fields=location` adds event locations; clients without it keep the first-slice shape.
export const OPTIONS = connectorPreflight;
export function GET(request: Request) {
  const url = new URL(request.url);
  return runConnectorRequest(request, (caller) => getOutlookCalendarEvents(caller, url.searchParams.get("start") ?? "", url.searchParams.get("end") ?? "",
    { signal: request.signal, includeLocation: url.searchParams.get("fields") === "location" }));
}
