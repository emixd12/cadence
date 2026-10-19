import { completeOutlookCalendarDesktopConnection, disconnectOutlookCalendar, getOutlookCalendarConnection, startOutlookCalendarConnection } from "@/lib/services/outlook-calendar.service";
import { connectorPreflight, readConnectorCredentialBody, runConnectorRequest } from "@/lib/services/connector-request";

// Ticket 237. GET status; POST starts consent; PUT completes a desktop attempt
// with the desktop session and Keychain client state; DELETE disconnects.
export const OPTIONS = connectorPreflight;
export function GET(request: Request) { return runConnectorRequest(request, getOutlookCalendarConnection); }
export function POST(request: Request) {
  return runConnectorRequest(request, async (caller) => startOutlookCalendarConnection(caller, await readConnectorCredentialBody(request), new URL(request.url).origin));
}
export function PUT(request: Request) {
  return runConnectorRequest(request, async (caller) => completeOutlookCalendarDesktopConnection(caller, await readConnectorCredentialBody(request)));
}
export function DELETE(request: Request) { return runConnectorRequest(request, disconnectOutlookCalendar); }
