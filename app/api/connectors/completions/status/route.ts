import { connectorPreflight, runConnectorRequest } from "@/lib/services/connector-request";
import { getConnectorCompletionStatus } from "@/lib/services/connector-completion.service";

// Ticket 317 (safety rule 6): whether connector completion is available and the last
// successful check time, for the source's Settings panel. Reads only; no provider call.
export const OPTIONS = connectorPreflight;
export function GET(request: Request) {
  const source = new URL(request.url).searchParams.get("source") ?? "";
  return runConnectorRequest(request, (caller) => getConnectorCompletionStatus(caller, source));
}
