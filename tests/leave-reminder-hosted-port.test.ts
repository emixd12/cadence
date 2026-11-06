import { Temporal } from "@js-temporal/polyfill";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LeaveReminderPlannedTrip } from "../lib/services/leave-reminder-job.service";

vi.mock("@/lib/integrations/leave-reminder-caller", () => ({
  createLeaveReminderCaller: vi.fn(() => ({ userId: USER_ID, client: {} })),
  leaveReminderCalendarCaller: vi.fn(async () => ({ client: {} })),
}));
vi.mock("@/lib/services/travel-route-refresh.service", () => ({ refreshTravelRoutes: vi.fn() }));
vi.mock("@/lib/db/behaviors.repo", () => ({ getProfileTimezone: vi.fn(async () => "America/New_York"), listUserBehaviors: vi.fn() }));
vi.mock("@/lib/services/travel-settings.service", () => ({ readTravelRouteSource: vi.fn() }));
vi.mock("@/lib/db/leave-reminders.repo", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/db/leave-reminders.repo")>(),
  createLeaveReminderStore: vi.fn(() => ({})),
  readTravelPreparationChangedAt: vi.fn(),
}));

const USER_ID = "11111111-1111-4111-8111-111111111111";

const { readTravelPreparationChangedAt } = await import("../lib/db/leave-reminders.repo");
const { refreshTravelRoutes } = await import("../lib/services/travel-route-refresh.service");
const { readTravelRouteSource } = await import("../lib/services/travel-settings.service");
const { TravelRoutingError } = await import("../lib/services/travel-routing.service");
const { createHostedLeaveReminderAccountPort } = await import("../lib/services/leave-reminder-job.service");

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
});
