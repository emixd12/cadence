import { connectorPreflight, runConnectorRequest } from "@/lib/services/connector-request";
import { getHevyActivities } from "@/lib/services/hevy.service";

// Ticket 223: read-only recorded workout timing for inclusive local dates.
export const OPTIONS = connectorPreflight;
export function GET(request: Request) {
  const url = new URL(request.url);
  return runConnectorRequest(request, (caller) => getHevyActivities(caller, url.searchParams.get("start") ?? "", url.searchParams.get("end") ?? ""));
}
