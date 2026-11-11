import { connectorPreflight, runConnectorRequest } from "@/lib/services/connector-request";
import { readCalendarRequestBody } from "@/lib/services/google-calendar-request";
import { getSourceLinkFormState, saveSourceLink } from "@/lib/services/source-links.service";
import { ConnectorError } from "@/lib/types/connectors";

// Ticket 316 (D28.3, D28.4): one Behavior's source link. GET returns the form state,
// including routine titles read live for the picker (never stored). PUT saves the
// link and refuses a routine already linked to another Behavior and a second
// any-workout link for one source.
export const OPTIONS = connectorPreflight;
export function GET(request: Request) {
  const url = new URL(request.url);
  return runConnectorRequest(request, (caller) => getSourceLinkFormState(caller, {
    behaviorId: url.searchParams.get("behaviorId") ?? "",
    source: url.searchParams.get("source") ?? "",
  }));
}
export function PUT(request: Request) {
  return runConnectorRequest(request, async (caller) => {
    let body: unknown;
    try { body = await readCalendarRequestBody(request, 8_192); } catch { throw new ConnectorError("invalid_request"); }
    return saveSourceLink(caller, body);
  });
}
