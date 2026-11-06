import type { NormalizedExternalEvent } from "@cadence/core/types/day-progress";
import type { CalendarConnectionView } from "@/lib/types/google-calendar";
import type { ConnectorConnectionView } from "@/lib/types/connectors";
import { getCalendarConnection, getCalendarEvents, type CalendarReadCaller } from "@/lib/services/google-calendar.service";
import { getIcloudCalendarConnection, getIcloudCalendarEvents } from "@/lib/services/icloud-calendar.service";
import { getOutlookCalendarConnection, getOutlookCalendarEvents } from "@/lib/services/outlook-calendar.service";
import { readTravelCalendarRange } from "@/lib/services/travel-calendar-range";
import type { TravelRouteRefreshRequest } from "@/lib/services/travel-route-request";

/**
 * Ticket 283 (decision D4): the Calendars travel reads, Google, Outlook and iCloud, under one
 * rule. A connected Calendar is read for the requested dates, through `readTravelCalendarRange`
 * so a `first_trip` read starts today (Ticket 282). A failed read fails the request,
 * as the Google read always did. Outlook and iCloud read event locations only here and in the
 * Timeline's own read. Locations stay in memory for this request; nothing about an event is stored.
 */
export type TravelCalendarConnections = Readonly<{
  google: CalendarConnectionView;
  outlook: ConnectorConnectionView;
  icloud: ConnectorConnectionView;
}>;

export type TravelCalendarEvents = Readonly<{
  /** The Google snapshot's events. The Daily Brief's signed conclusions name only these. */
  google: readonly NormalizedExternalEvent[];
  /** Every Calendar's events, Google first. */
  all: readonly NormalizedExternalEvent[];
  /** The Google snapshot's timezone, when Google was read. */
  timezone: string | null;
}>;

export async function readTravelCalendarConnections(caller: CalendarReadCaller): Promise<TravelCalendarConnections> {
  const [google, outlook, icloud] = await Promise.all([
    getCalendarConnection(caller),
    getOutlookCalendarConnection(caller),
    getIcloudCalendarConnection(caller),
  ]);
  return { google, outlook, icloud };
}

/** Outlook and iCloud take part only when connected with a calendar selected, as their Timeline reads do. */
function connectorReadable(connection: ConnectorConnectionView): boolean {
  return connection.status === "connected" && connection.preferences.selectedSourceIds.length > 0;
}

export async function readTravelCalendarEvents(caller: CalendarReadCaller, connections: TravelCalendarConnections,
  request: Pick<TravelRouteRefreshRequest, "scope" | "startLocalDate" | "endLocalDate">): Promise<TravelCalendarEvents> {
  const [google, outlook, icloud] = await Promise.all([
    connections.google.status === "connected"
      ? readTravelCalendarRange(request, (start, end) => getCalendarEvents(caller, start, end)) : null,
    connectorReadable(connections.outlook)
      ? readTravelCalendarRange(request, (start, end) => getOutlookCalendarEvents(caller, start, end, { includeLocation: true })) : null,
    connectorReadable(connections.icloud)
      ? readTravelCalendarRange(request, (start, end) => getIcloudCalendarEvents(caller, start, end, { includeLocation: true })) : null,
  ]);
  const googleEvents = google?.events ?? [];
  return {
    google: googleEvents,
    all: [...googleEvents, ...(outlook?.events ?? []), ...(icloud?.events ?? [])],
    timezone: google?.requestedRange.timezone ?? null,
  };
}

/** Which Calendars took part, for fences and the journey revision. Unchanged while only Google is connected. */
export function travelConnectorFence(connections: TravelCalendarConnections): string | null {
  const parts = (["outlook", "icloud"] as const).flatMap((name) => {
    const connection = connections[name];
    return connectorReadable(connection) ? [[name, connection.generation, connection.selectionRevision] as const] : [];
  });
  return parts.length ? JSON.stringify(parts) : null;
}

export function sameTravelCalendarConnections(left: TravelCalendarConnections, right: TravelCalendarConnections): boolean {
  return left.google.status === right.google.status && left.google.generation === right.google.generation &&
    left.google.selectionRevision === right.google.selectionRevision && travelConnectorFence(left) === travelConnectorFence(right);
}
