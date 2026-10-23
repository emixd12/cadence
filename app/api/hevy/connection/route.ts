import { connectorPreflight, readConnectorCredentialBody, runConnectorRequest } from "@/lib/services/connector-request";
import { connectHevy, disconnectHevy, getHevyConnection } from "@/lib/services/hevy.service";

// Ticket 236: status, one-time API key intake, and disconnect. The key is read
// from a size-capped body, sealed server-side, and never returned.
export const OPTIONS = connectorPreflight;
export function GET(request: Request) { return runConnectorRequest(request, getHevyConnection); }
export function DELETE(request: Request) { return runConnectorRequest(request, disconnectHevy); }
export function POST(request: Request) {
  return runConnectorRequest(request, async (caller) => connectHevy(caller, await readConnectorCredentialBody(request)));
}
