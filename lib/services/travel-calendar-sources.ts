import type { NormalizedExternalEvent } from "@cadence/core/types/day-progress";
import type { CalendarConnectionView } from "@/lib/types/google-calendar";
import { ConnectorError, type ConnectorConnectionView } from "@/lib/types/connectors";
import { getCalendarConnection, getCalendarEvents, type CalendarReadCaller } from "@/lib/services/google-calendar.service";
import { getIcloudCalendarConnection, getIcloudCalendarEvents } from "@/lib/services/icloud-calendar.service";
import { getOutlookCalendarConnection, getOutlookCalendarEvents } from "@/lib/services/outlook-calendar.service";
import { readTravelCalendarRange } from "@/lib/services/travel-calendar-range";
import type { TravelRouteRefreshRequest } from "@/lib/services/travel-route-request";

/**
 * Ticket 283 (decision D4): the Calendars travel reads, Google, Outlook and iCloud, under one
 * rule. A connected Calendar is read for the requested dates, through `readTravelCalendarRange`
 * so a `first_trip` read starts today (Ticket 282). A failed Google read fails the request, as it
 * always did. A failed Outlook or iCloud read leaves that Calendar out of this request, so an
 * outage there routes the other Calendars as before Ticket 283; an invalid request still fails.
 * Outlook and iCloud read event locations only here and in the Timeline's own read. Locations
 * stay in memory for this request; nothing about an event is stored.
 */
export type TravelCalendarConnections = Readonly<{
  google: CalendarConnectionView;
  outlook: ConnectorConnectionView;
  icloud: ConnectorConnectionView;
}>;

export type TravelConnectorName = "outlook" | "icloud";

export type TravelCalendarEvents = Readonly<{
  /** The Google snapshot's events. */
  google: readonly NormalizedExternalEvent[];
  /** Every Calendar's events, Google first. The Daily Brief's signed conclusions name all of them (decision D18). */
  all: readonly NormalizedExternalEvent[];
  /** The Google snapshot's timezone, when Google was read. */
  timezone: string | null;
  /** Connected Outlook or iCloud Calendars whose read failed and were left out. */
  unavailable: readonly TravelConnectorName[];
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

/**
 * Reads every taking-part Calendar. Without `previous`, an Outlook or iCloud provider failure
 * leaves that Calendar out. With `previous` (the final revision check), a Calendar left out then
 * stays out and any other failure fails the request, so both reads cover the same Calendars.
 */
export async function readTravelCalendarEvents(caller: CalendarReadCaller, connections: TravelCalendarConnections,
  request: Pick<TravelRouteRefreshRequest, "scope" | "startLocalDate" | "endLocalDate">, previous?: TravelCalendarEvents): Promise<TravelCalendarEvents> {
  const connector = async (name: TravelConnectorName, read: Parameters<typeof readTravelCalendarRange>[1]) => {
    if (!connectorReadable(connections[name]) || previous?.unavailable.includes(name)) return { name, events: null };
    try {
      return { name, events: (await readTravelCalendarRange(request, read)).events };
    } catch (error) {
      if (previous || !(error instanceof ConnectorError) || error.code === "invalid_request") throw error;
      return { name, events: null, failed: true };
    }
  };
  const [google, outlook, icloud] = await Promise.all([
    connections.google.status === "connected"
      ? readTravelCalendarRange(request, (start, end) => getCalendarEvents(caller, start, end)) : null,
    connector("outlook", (start, end) => getOutlookCalendarEvents(caller, start, end, { includeLocation: true })),
    connector("icloud", (start, end) => getIcloudCalendarEvents(caller, start, end, { includeLocation: true })),
  ]);
  const googleEvents = google?.events ?? [];
  return {
    google: googleEvents,
    all: [...googleEvents, ...(outlook.events ?? []), ...(icloud.events ?? [])],
    timezone: google?.requestedRange.timezone ?? null,
    unavailable: [...(previous?.unavailable ?? []), ...[outlook, icloud].flatMap((entry) => "failed" in entry ? [entry.name] : [])],
  };
}

/**
 * Decision D18: the Calendars a travel plan reads, named as the Daily Brief names its sources.
 * Google takes part while connected; Outlook and iCloud while connected with a calendar selected.
 */
export function travelCalendarSourcesTakingPart(connections: TravelCalendarConnections): Array<"google_calendar" | "outlook_calendar" | "icloud_calendar"> {
  return [
    ...(connections.google.status === "connected" ? ["google_calendar" as const] : []),
    ...(connectorReadable(connections.outlook) ? ["outlook_calendar" as const] : []),
    ...(connectorReadable(connections.icloud) ? ["icloud_calendar" as const] : []),
  ];
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
