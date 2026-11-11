import { connectorPreflight, runConnectorRequest } from "@/lib/services/connector-request";
import { parseReconcileBody, reconcileConnectorCompletions } from "@/lib/services/connector-completion.service";
import { readCalendarRequestBody } from "@/lib/services/google-calendar-request";
import { ConnectorError } from "@/lib/types/connectors";

// Ticket 316 (D28): one foreground reconcile for one completion source. The body is
// exactly `{ source }`; evidence is read on the server, never accepted from a
// client. Does nothing while `CADENCE_CONNECTOR_COMPLETION` is not `on`.
export const OPTIONS = connectorPreflight;
export function POST(request: Request) {
  return runConnectorRequest(request, async (caller) => {
    let body: unknown;
    try { body = await readCalendarRequestBody(request, 1_024); } catch { throw new ConnectorError("invalid_request"); }
    return reconcileConnectorCompletions(caller, parseReconcileBody(body));
  });
}
