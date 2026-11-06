import { Temporal } from "@js-temporal/polyfill";

import type { NormalizedExternalEvent } from "@cadence/core/types/day-progress";
import type { TravelRouteRefreshRequest } from "./travel-route-request";

type CalendarRangeSnapshot = Readonly<{
  requestedRange: Readonly<{ timezone: string }>;
  events: readonly NormalizedExternalEvent[];
}>;

/**
 * Ticket 282: Google, Outlook and iCloud reads must start on today's date in the profile
 * timezone. A `first_trip` request names only tomorrow, so this reads today through tomorrow
 * (one adjacent day, within every source's range limit) and keeps only the events that start
 * tomorrow or later. All-day events keep their exclusive end date. Other scopes read their
 * own range unchanged. `read` is the source's own range read, such as `getCalendarEvents`.
 */
export async function readTravelCalendarRange<Snapshot extends CalendarRangeSnapshot>(
  request: Pick<TravelRouteRefreshRequest, "scope" | "startLocalDate" | "endLocalDate">,
  read: (startLocalDate: string, endLocalDate: string) => Promise<Snapshot>,
): Promise<Snapshot> {
  if (request.scope !== "first_trip") return read(request.startLocalDate, request.endLocalDate);
  const first = Temporal.PlainDate.from(request.startLocalDate);
  const snapshot = await read(first.subtract({ days: 1 }).toString(), request.endLocalDate);
  const timezone = snapshot.requestedRange.timezone;
  const events = snapshot.events.filter((event) => event.kind === "timed"
    ? Temporal.PlainDate.compare(Temporal.Instant.from(event.startAt).toZonedDateTimeISO(timezone).toPlainDate(), first) >= 0
    : Temporal.PlainDate.compare(Temporal.PlainDate.from(event.endLocalDate), first) > 0);
  return { ...snapshot, events } as Snapshot;
}
