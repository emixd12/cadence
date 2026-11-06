import { describe, expect, it } from "vitest";

import { parseTravelRouteRefreshRequest } from "@/lib/services/travel-route-request";

describe("travel route request", () => {
  it("bounds raw client input before source reads", () => {
    expect(parseTravelRouteRefreshRequest({ startLocalDate: "2026-09-22", endLocalDate: "2026-09-23", device: null })).toMatchObject({ corrections: [] });
    expect(() => parseTravelRouteRefreshRequest({ startLocalDate: "2026-09-22", endLocalDate: "2026-09-25", device: null })).toThrow("range");
    expect(() => parseTravelRouteRefreshRequest({ startLocalDate: "2026-09-22", endLocalDate: "2026-09-22", device: { latitude: 91, longitude: 0, accuracyMeters: 1, sampledAt: "2026-09-22T00:00:00Z" } })).toThrow("sample");
  });
});


describe("travel route corrections (decision D12)", () => {
  const day = { startLocalDate: "2026-11-05", endLocalDate: "2026-11-05" };
  it("accepts a destination for one event revision and asks no attendance", () => {
    const corrections = [{ eventId: "event-1", revision: "r1", locationText: "12 Harbor Street" }];
    expect(parseTravelRouteRefreshRequest({ ...day, corrections }).corrections).toEqual(corrections);
    expect(parseTravelRouteRefreshRequest({ ...day, corrections: [{ ...corrections[0], attendance: "remote" }] }).corrections).toEqual(corrections);
  });

  it("skips an older Mac build's attendance-only correction, so the refresh still runs", () => {
    const legacy = [
      { eventId: "event-1", revision: "r1", attendance: "physical", locationText: null },
      { eventId: "event-2", revision: "r2", attendance: "remote", locationText: null },
      { eventId: "event-3", revision: "r3", attendance: "physical", locationText: "12 Harbor Street" },
    ];
    expect(parseTravelRouteRefreshRequest({ ...day, corrections: legacy }).corrections).toEqual([
      { eventId: "event-3", revision: "r3", locationText: "12 Harbor Street" },
    ]);
  });

  it("rejects a correction with an empty, missing or oversized destination", () => {
    for (const locationText of ["", undefined, "x".repeat(513)]) {
      expect(() => parseTravelRouteRefreshRequest({ ...day, corrections: [{ eventId: "event-1", revision: "r1", locationText }] })).toThrow("Travel correction");
    }
  });
});

describe("travel route scope", () => {
  const day = { startLocalDate: "2026-10-18", endLocalDate: "2026-10-18" };
  it("defaults older clients to Timeline scope and validates whole-day requests", () => {
    expect(parseTravelRouteRefreshRequest(day).scope).toBe("timeline");
    expect(parseTravelRouteRefreshRequest({ ...day, scope: "day" }).scope).toBe("day");
    expect(() => parseTravelRouteRefreshRequest({ ...day, scope: "unlimited" })).toThrow();
  });
});

describe("tomorrow's first trip scope (Ticket 282)", () => {
  const day = { startLocalDate: "2026-11-07", endLocalDate: "2026-11-07", scope: "first_trip" };
  it("accepts one day and drops any device position", () => {
    const device = { latitude: 40, longitude: -74, accuracyMeters: 10, sampledAt: "2026-11-06T22:00:00Z" };
    expect(parseTravelRouteRefreshRequest({ ...day, device })).toEqual({ ...day, device: null, corrections: [] });
  });

  it("rejects two days, named trips or corrections", () => {
    expect(() => parseTravelRouteRefreshRequest({ ...day, endLocalDate: "2026-11-08" })).toThrow();
    expect(() => parseTravelRouteRefreshRequest({ ...day, trips: [{ role: "outbound", originRef: null, destinationRef: "a" }] })).toThrow();
    expect(() => parseTravelRouteRefreshRequest({ ...day, corrections: [{ eventId: "e", revision: "r", locationText: "1 Main St" }] })).toThrow();
  });
});

describe("travel route trips (Ticket 267)", () => {
  const day = { startLocalDate: "2026-11-05", endLocalDate: "2026-11-05", scope: "day" };
  it("accepts named trips and leaves them out for older clients", () => {
    expect(parseTravelRouteRefreshRequest(day)).not.toHaveProperty("trips");
    const trips = [{ role: "onward", originRef: "a", destinationRef: "b" }, { role: "return", originRef: "b", destinationRef: null }];
    expect(parseTravelRouteRefreshRequest({ ...day, trips }).trips).toEqual(trips);
  });

  it("rejects malformed or unbounded trips", () => {
    for (const trips of [[], "a", [{ role: "outbound", originRef: null, destinationRef: null }], [{ role: "return", originRef: null, destinationRef: null }],
      [{ role: "sideways", originRef: null, destinationRef: "b" }], [{ role: "outbound", originRef: null, destinationRef: "x".repeat(257) }],
      Array.from({ length: 11 }, (_, index) => ({ role: "outbound", originRef: null, destinationRef: `s${index}` }))]) {
      expect(() => parseTravelRouteRefreshRequest({ ...day, trips }), JSON.stringify(trips).slice(0, 60)).toThrow("Travel trip");
    }
  });
});
