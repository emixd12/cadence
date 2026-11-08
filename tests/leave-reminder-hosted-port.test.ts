import { Temporal } from "@js-temporal/polyfill";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { leaveReminderTripDigest } from "@cadence/core/services/leave-reminder-plan";
import type { LeaveReminderPlannedTrip } from "../lib/services/leave-reminder-job.service";

vi.mock("@/lib/integrations/leave-reminder-caller", () => ({
  createLeaveReminderCaller: vi.fn(() => ({ userId: USER_ID, client: {} })),
  leaveReminderCalendarCaller: vi.fn(async () => ({ client: {} })),
}));
vi.mock("@/lib/services/travel-route-refresh.service", () => ({ refreshTravelRoutes: vi.fn(), refreshTravelRoutesReportingCalendars: vi.fn() }));
vi.mock("@/lib/db/behaviors.repo", () => ({ getProfileTimezone: vi.fn(async () => "America/New_York"), listUserBehaviors: vi.fn() }));
vi.mock("@/lib/db/occurrences.repo", () => ({ listOccurrencesBetweenLocalDates: vi.fn(async () => []) }));
vi.mock("@/lib/services/travel-calendar-sources", () => ({ readTravelCalendarConnections: vi.fn(async () => ({})), readTravelCalendarEvents: vi.fn() }));
vi.mock("@/lib/services/travel-settings.service", () => ({ readTravelRouteSource: vi.fn() }));
vi.mock("@/lib/db/leave-reminders.repo", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/db/leave-reminders.repo")>(),
  createLeaveReminderStore: vi.fn(() => ({})),
  readTravelPreparationChangedAt: vi.fn(),
}));

const USER_ID = "11111111-1111-4111-8111-111111111111";

const { readTravelPreparationChangedAt } = await import("../lib/db/leave-reminders.repo");
const { refreshTravelRoutes, refreshTravelRoutesReportingCalendars } = await import("../lib/services/travel-route-refresh.service");
const { readTravelRouteSource } = await import("../lib/services/travel-settings.service");
const { TravelRoutingError } = await import("../lib/services/travel-routing.service");
const { createHostedLeaveReminderAccountPort } = await import("../lib/services/leave-reminder-job.service");
const { readTravelCalendarEvents } = await import("../lib/services/travel-calendar-sources");

const NOW = Temporal.Instant.from("2026-11-06T17:06:00Z");
const TRIP: LeaveReminderPlannedTrip = {
  digest: "a".repeat(64), destinationRef: "event-1", role: "outbound", originRef: null, startAt: "2026-11-06T18:00:00Z", mode: "walking",
};
const port = () => createHostedLeaveReminderAccountPort(USER_ID, NOW, {} as never);

describe("hosted leave reminder port (Wave 4 final check)", () => {
  beforeEach(() => vi.mocked(refreshTravelRoutes).mockReset());

  it("reports a refused spend reservation as budget refused for every trip, with no estimate", async () => {
    vi.mocked(refreshTravelRoutes).mockRejectedValueOnce(new TravelRoutingError({ code: "quota_exceeded", retryable: true, retryAfterSeconds: 60 }));
    const routed = await port().routeTrips("2026-11-06", [TRIP]);
    expect(routed.get(TRIP.digest)).toEqual({ result: { kind: "unavailable", budgetRefused: true }, estimate: null, mode: "walking", originRef: null });
  });

  it("rethrows any other failure, and a retry goes through the shared refresh again, which reserves before each provider call", async () => {
    vi.mocked(refreshTravelRoutes)
      .mockRejectedValueOnce(new TravelRoutingError({ code: "context_changed", retryable: true, retryAfterSeconds: null }))
      .mockResolvedValueOnce({ evidence: { legs: [] } } as never);
    await expect(port().routeTrips("2026-11-06", [TRIP])).rejects.toMatchObject({ failure: { code: "context_changed" } });
    expect((await port().routeTrips("2026-11-06", [TRIP])).size).toBe(0);
    expect(refreshTravelRoutes).toHaveBeenCalledTimes(2);
  });

  it("reads the database's get-ready change time beside the device-written habits revision", async () => {
    vi.mocked(readTravelRouteSource).mockResolvedValueOnce({
      settings: { enabled: true, mode: "walking", routingConsentAt: "2026-10-01T00:00:00Z", habits: null },
      habitsRevision: "2026-11-06T17:00:00.000000Z",
    } as never);
    vi.mocked(readTravelPreparationChangedAt).mockResolvedValueOnce("2026-11-06T17:28:30.000000Z");
    await expect(port().readContext()).resolves.toMatchObject({
      habitsUpdatedAt: "2026-11-06T17:00:00.000000Z",
      preparationChangedAt: "2026-11-06T17:28:30.000000Z",
    });
    expect(readTravelPreparationChangedAt).toHaveBeenCalledWith({}, USER_ID);
  });

  it("lists and names Outlook and iCloud trips like Google ones, reading every Calendar as the user (Ticket 283)", async () => {
    vi.mocked(readTravelRouteSource).mockResolvedValue({ settings: { baseLocationText: null }, behaviors: [] } as never);
    const event = (id: string, startAt: string, location: string, title: string, extra: Record<string, unknown> = {}) =>
      ({ id, kind: "timed", state: "unknown", currentUserResponse: null, startAt, location, title, ...extra });
    const events = [
      event("outlook_calendar/dentist", "2026-11-06T18:00:00Z", "Dentist St", "Dentist"),
      event("icloud_calendar/lunch", "2026-11-06T20:00:00Z", "Cafe St", "Lunch"),
      event("icloud_calendar/call", "2026-11-06T21:00:00Z", "", "Call"),
      event("outlook_calendar/declined", "2026-11-06T22:00:00Z", "Elsewhere", "Declined", { currentUserResponse: "declined" }),
    ];
    vi.mocked(readTravelCalendarEvents).mockResolvedValue({ google: [], all: events, timezone: null, unavailable: [] } as never);
    vi.mocked(refreshTravelRoutesReportingCalendars).mockResolvedValue({ calendarsLeftOut: [], response: { evidence: { legs: [
      { leg: { role: "outbound", originCommitmentRef: null, destinationCommitmentRef: "outlook_calendar/dentist", mode: "walking" } },
      { leg: { role: "onward", originCommitmentRef: "outlook_calendar/dentist", destinationCommitmentRef: "icloud_calendar/lunch", mode: "walking" } },
      { leg: { role: "return", originCommitmentRef: "icloud_calendar/lunch", destinationCommitmentRef: null, mode: "walking" } },
    ] } } } as never);
    const { trips, calendarsLeftOut } = await port().listTrips("2026-11-06");
    expect(calendarsLeftOut).toBe(false);
    expect(trips.map((trip) => [trip.destinationRef, trip.originRef])).toEqual([
      ["outlook_calendar/dentist", null], ["icloud_calendar/lunch", "outlook_calendar/dentist"],
    ]);
    expect(readTravelCalendarEvents).toHaveBeenCalledWith(expect.anything(), expect.anything(), { scope: "day", startLocalDate: "2026-11-06", endLocalDate: "2026-11-06" });
    const calendar = await port().readSendCalendar("2026-11-06");
    expect(calendar.read(trips[1]!, "outlook_calendar/dentist")).toEqual({ kind: "found", details: { title: "Lunch", origin: { kind: "previous_stop", title: "Dentist" } } });
  });

  it("reports a Calendar a failed read left out, from the refresh or the destination read, so the job keeps its trips (Ticket 283)", async () => {
    vi.mocked(readTravelRouteSource).mockResolvedValue({ settings: { baseLocationText: null }, behaviors: [] } as never);
    const google = { id: "google-event", kind: "timed", state: "unknown", currentUserResponse: null, startAt: "2026-11-06T18:00:00Z", location: "Main St", title: "Gym" };
    const legs = { evidence: { legs: [{ leg: { role: "outbound", originCommitmentRef: null, destinationCommitmentRef: "google-event", mode: "walking" } }] } };
    const read = (unavailable: string[]) => ({ google: [google], all: [google], timezone: "America/New_York", unavailable });

    vi.mocked(refreshTravelRoutesReportingCalendars).mockResolvedValueOnce({ calendarsLeftOut: ["outlook"], response: legs } as never);
    vi.mocked(readTravelCalendarEvents).mockResolvedValueOnce(read([]) as never);
    const fromRefresh = await port().listTrips("2026-11-06");
    expect(fromRefresh.trips.map((trip) => trip.destinationRef)).toEqual(["google-event"]);
    expect(fromRefresh.calendarsLeftOut).toBe(true);

    vi.mocked(refreshTravelRoutesReportingCalendars).mockResolvedValueOnce({ calendarsLeftOut: [], response: legs } as never);
    vi.mocked(readTravelCalendarEvents).mockResolvedValueOnce(read(["icloud"]) as never);
    expect((await port().listTrips("2026-11-06")).calendarsLeftOut).toBe(true);

    vi.mocked(refreshTravelRoutesReportingCalendars).mockResolvedValueOnce({ calendarsLeftOut: [], response: legs } as never);
    vi.mocked(readTravelCalendarEvents).mockResolvedValueOnce(read([]) as never);
    expect((await port().listTrips("2026-11-06")).calendarsLeftOut).toBe(false);
  });

  it("marks a stop the send-time read could not see as left out only while a Calendar was left out", async () => {
    vi.mocked(readTravelRouteSource).mockResolvedValue({ settings: { baseLocationText: null }, behaviors: [] } as never);
    const google = { id: "google-event", kind: "timed", state: "unknown", currentUserResponse: null, startAt: "2026-11-06T18:00:00Z", location: "Main St", title: "Gym" };
    const read = (unavailable: string[]) => ({ google: [google], all: [google], timezone: "America/New_York", unavailable });
    const trip = (kind: "calendar" | "behavior", ref: string): LeaveReminderPlannedTrip => ({
      digest: leaveReminderTripDigest(kind, ref, "2026-11-06T18:00:00Z"), destinationRef: ref, role: "outbound", originRef: null, startAt: "2026-11-06T18:00:00Z", mode: "walking",
    });

    vi.mocked(readTravelCalendarEvents).mockResolvedValueOnce(read(["outlook"]) as never);
    const partial = await port().readSendCalendar("2026-11-06");
    expect(partial.read(trip("calendar", "outlook_calendar/dentist"), null)).toEqual({ kind: "left_out" });
    // A Behavior's Occurrence is in no Calendar: missing means gone.
    expect(partial.read(trip("behavior", "occurrence-1"), null)).toEqual({ kind: "gone" });
    expect(partial.read(trip("calendar", "google-event"), null)).toEqual({ kind: "found", details: { title: "Gym", origin: { kind: "home" } } });
    expect(partial.read(trip("calendar", "google-event"), "outlook_calendar/breakfast")).toEqual({ kind: "left_out" });

    vi.mocked(readTravelCalendarEvents).mockResolvedValueOnce(read([]) as never);
    const complete = await port().readSendCalendar("2026-11-06");
    expect(complete.read(trip("calendar", "outlook_calendar/dentist"), null)).toEqual({ kind: "gone" });
    expect(complete.read(trip("calendar", "google-event"), "outlook_calendar/breakfast")).toEqual({ kind: "gone" });
    // The event moved: a new digest, so this trip is gone.
    expect(complete.read({ ...trip("calendar", "google-event"), digest: "b".repeat(64) }, null)).toEqual({ kind: "gone" });
  });

  it("fails the trip list when Google Calendar's read fails, so the visit cancels nothing", async () => {
    vi.mocked(refreshTravelRoutesReportingCalendars).mockRejectedValueOnce(new Error("google_calendar_unavailable"));
    await expect(port().listTrips("2026-11-06")).rejects.toThrow("google_calendar_unavailable");
  });
});
