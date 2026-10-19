import { connectIcloudCalendar, disconnectIcloudCalendar, getIcloudCalendarConnection } from "@/lib/services/icloud-calendar.service";
import { connectorPreflight, readConnectorCredentialBody, runConnectorRequest } from "@/lib/services/connector-request";

// Ticket 227. GET status; POST accepts the Apple Account email and app-specific
// password once from a size-capped body, verifies and seals them server-side,
// and returns only connection state; DELETE disconnects.
export const OPTIONS = connectorPreflight;
export function GET(request: Request) { return runConnectorRequest(request, getIcloudCalendarConnection); }
export function POST(request: Request) {
  return runConnectorRequest(request, async (caller) => connectIcloudCalendar(caller, await readConnectorCredentialBody(request), { signal: request.signal }));
}
export function DELETE(request: Request) { return runConnectorRequest(request, disconnectIcloudCalendar); }
