import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";
import { planningPlaceCatalog } from "@cadence/core/resolvers/alongside.resolver";
import { travelPlaceKey } from "@cadence/core/services/travel-place-key";
import { attachTimelineAlongside } from "@cadence/core/services/timeline-alongside";
import type { NormalizedExternalEvent } from "@cadence/core/types/day-progress";
import type { TimelineView } from "@cadence/core/types/timeline";
import { briefMoveCalendar, busyFromExternalEvents } from "@/lib/services/brief-moves.service";
import { calendarBusyFrom, type ChatCalendarEvent } from "@/lib/services/chat/chat-executor";
import { eventPlacesFromLocations, readPlanningPlaceCatalog } from "@/lib/services/planning-places.service";
import { calendarBusyFromEvents, calendarEventPlacesById } from "@/components/timeline/OccurrenceMoves";

// Ticket 384 (D37): each busy calendar event that reaches the free-slot rule carries one
// coarse place, Home, a saved place's key or unknown, computed where the location text
// already is. With CADENCE_ALONGSIDE off nothing is read and nothing changes.

const HOME_TEXT = "12 Elm Street";
const OFFICE_TEXT = "Acme Office";
const catalog = planningPlaceCatalog({ homeText: HOME_TEXT, placeTexts: [OFFICE_TEXT] });
const OFFICE = { kind: "place" as const, placeKey: travelPlaceKey(OFFICE_TEXT) };
const ON = { CADENCE_ALONGSIDE: "on" };

function externalEvent(id: string, location: string, startAt = "2026-11-25T15:00:00Z", endAt = "2026-11-25T16:00:00Z"): NormalizedExternalEvent {
  return {
    id, providerEventId: id, logicalInstanceId: `logical-${id}`, calendarId: "calendar-1", source: "google_calendar", calendarName: "Work",
    sourceTimezone: "UTC", sourceTimezoneFallback: "request", state: "confirmed", availability: "busy", currentUserResponse: null,
    revision: { availability: "unavailable", providerUpdatedAt: null, providerEtag: null }, title: id, description: "", location,
    sourceUrl: null, fieldAvailability: {}, detailCompleteness: {}, organizer: null, attendees: null, attendeesOmitted: false,
    conference: null, recurrence: null, attachments: null,
    kind: "timed", startAt, endAt, endUnspecified: false, duration: { kind: "known", seconds: 3600 },
  } as NormalizedExternalEvent;
}

/** A Supabase stand-in that answers the two catalog reads and records which tables were read. */
function catalogClient(rows: Readonly<{ home: string | null; places: readonly (string | null)[]; fail?: boolean }>) {
  const tables: string[] = [];
  const client = {
    from(table: string) {
      tables.push(table);
      const result = rows.fail ? { data: null, error: new Error("refused") }
        : table === "travel_settings" ? { data: { base_location_text: rows.home }, error: null }
          : { data: rows.places.map((location_text) => ({ location_text })), error: null };
      const chain = {
        select: () => chain, eq: () => chain,
        maybeSingle: async () => result,
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
      };
      return chain;
    },
  };
  return { client: client as never, tables };
}

describe("readPlanningPlaceCatalog", () => {
  it("reads nothing while CADENCE_ALONGSIDE is off", async () => {
    const { client, tables } = catalogClient({ home: HOME_TEXT, places: [OFFICE_TEXT] });
    expect(await readPlanningPlaceCatalog(client, "user-1", {})).toBeNull();
    expect(tables).toEqual([]);
  });

  it("keys Home and the place-Where Behaviors' texts, keeping no text", async () => {
    const { client, tables } = catalogClient({ home: HOME_TEXT, places: [OFFICE_TEXT, null, OFFICE_TEXT.toUpperCase()] });
    const read = await readPlanningPlaceCatalog(client, "user-1", ON);
    expect(read).toEqual(catalog);
    expect(JSON.stringify(read)).not.toMatch(/Elm|Acme/i);
    expect(tables.sort()).toEqual(["behaviors", "travel_settings"]);
  });

  it("is no catalog when a read fails, so every event stays unknown", async () => {
    expect(await readPlanningPlaceCatalog(catalogClient({ home: null, places: [], fail: true }).client, "user-1", ON)).toBeNull();
    expect(eventPlacesFromLocations(new Map([["e1", HOME_TEXT]]), null).size).toBe(0);
  });
});

describe("server-read events (Yes, Other time, Accept all, Re-plan, Re-check)", () => {
  const events = [externalEvent("home", HOME_TEXT), externalEvent("office", "acme office"), externalEvent("cafe", "Corner Cafe"), externalEvent("none", "")];

  it("label each event from the read's own location text", () => {
    const busy = busyFromExternalEvents(events, catalog);
    expect(busy.map((event) => event.eventPlace ?? null)).toEqual([{ kind: "home" }, OFFICE, null, null]);
  });

  it("are unchanged without a catalog (flag off)", () => {
    const busy = busyFromExternalEvents(events);
    expect(busy.every((event) => !("eventPlace" in event))).toBe(true);
    expect(busy[0]).toEqual({ ref: "google_calendar:calendar-1:home", start: Temporal.Instant.from("2026-11-25T15:00:00Z"),
      end: Temporal.Instant.from("2026-11-25T16:00:00Z"), title: "home" });
  });
});

describe("the Daily Brief plan's context events", () => {
  const context = {
    connectors: [{ source: "google_calendar", state: "current", complete: true, events: [
      { ref: "event_a", interval: { kind: "timed", startAt: "2026-11-25T15:00:00Z", endAt: "2026-11-25T16:00:00Z" }, state: "confirmed", availability: "busy", currentUserResponse: null },
      { ref: "event_b", interval: { kind: "timed", startAt: "2026-11-25T17:00:00Z", endAt: "2026-11-25T18:00:00Z" }, state: "confirmed", availability: "busy", currentUserResponse: null },
    ] }],
  } as never;

  it("get places from the same read's location sidecar, by event ref", () => {
    const places = eventPlacesFromLocations(new Map([["event_a", "Acme Office"], ["event_b", "Somewhere new"]]), catalog);
    const calendar = briefMoveCalendar(context, undefined, places);
    expect(calendar.busy.map((event) => event.eventPlace ?? null)).toEqual([OFFICE, null]);
  });

  it("are unchanged without one", () => {
    expect(briefMoveCalendar(context).busy.every((event) => !("eventPlace" in event))).toBe(true);
  });
});

describe("Chat's busy times", () => {
  const chatEvent = (location: string | null): ChatCalendarEvent => ({ title: "Team sync", calendar: "Work", source: "outlookCalendar",
    start: "2026-11-25T15:00:00Z", end: "2026-11-25T16:00:00Z", all_day: false, location, busy: true });

  it("label each event from the location the read returned", () => {
    expect(calendarBusyFrom([chatEvent(OFFICE_TEXT), chatEvent(HOME_TEXT), chatEvent(null)], catalog).map((event) => event.eventPlace ?? null))
      .toEqual([OFFICE, { kind: "home" }, null]);
  });

  it("are unchanged without a catalog", () => {
    expect(calendarBusyFrom([chatEvent(OFFICE_TEXT)])).toEqual([{ ref: "chat:0", start: Temporal.Instant.from("2026-11-25T15:00:00Z"),
      end: Temporal.Instant.from("2026-11-25T16:00:00Z") }]);
  });
});

describe("device-sent events (the Timeline's Move for today)", () => {
  const events = [externalEvent("office", OFFICE_TEXT), externalEvent("unknown", "Somewhere new")];

  it("carry a place only while the view has planningPlaces, and never the location text", () => {
    const busy = calendarBusyFromEvents(events, catalog);
    expect(busy).toEqual([
      { start: "2026-11-25T15:00:00Z", end: "2026-11-25T16:00:00Z", ref: "office", eventPlace: OFFICE },
      { start: "2026-11-25T15:00:00Z", end: "2026-11-25T16:00:00Z", ref: "unknown" },
    ]);
    expect(JSON.stringify(busy)).not.toMatch(/Acme|Somewhere/i);
    expect(calendarBusyFromEvents(events)).toEqual([
      { start: "2026-11-25T15:00:00Z", end: "2026-11-25T16:00:00Z", ref: "office" },
      { start: "2026-11-25T15:00:00Z", end: "2026-11-25T16:00:00Z", ref: "unknown" },
    ]);
    expect([...calendarEventPlacesById(events, catalog)]).toEqual([["office", OFFICE]]);
    expect(calendarEventPlacesById(events, null).size).toBe(0);
  });
});

describe("the Timeline view's planningPlaces", () => {
  const view = { timezone: "UTC", todayLocalDate: "2026-11-25", visibleFutureDays: 0, maxFutureDays: 0, nextFutureDays: null,
    needsDecision: { daySections: [] }, daySections: [] } as unknown as TimelineView;

  it("rides along only when a row is alongside", () => {
    expect(attachTimelineAlongside(view, { b1: { source: "person", where: { kind: "home" } } }, new Set(), catalog).planningPlaces).toEqual(catalog);
    expect("planningPlaces" in attachTimelineAlongside(view, {}, new Set(["b1"]), catalog)).toBe(false);
    expect("planningPlaces" in attachTimelineAlongside(view, { b1: { source: "person" } })).toBe(false);
  });
});
