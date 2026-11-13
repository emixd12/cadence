import { connectorPreflight, runConnectorRequest } from "@/lib/services/connector-request";
import { readCalendarRequestBody } from "@/lib/services/google-calendar-request";
import { countUnlinkedWorkout } from "@/lib/services/source-count.service";
import { ConnectorError } from "@/lib/types/connectors";

// Ticket 324: count one logged workout that no link accepted. The user's own Completed
// mark goes through the manual status path; the workout attaches for timing only.
export const OPTIONS = connectorPreflight;
export function POST(request: Request) {
  return runConnectorRequest(request, async (caller) => {
    let body: unknown;
    try { body = await readCalendarRequestBody(request, 1_024); } catch { throw new ConnectorError("invalid_request"); }
    return countUnlinkedWorkout(caller, body);
  });
}
