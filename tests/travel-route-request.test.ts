import { describe, expect, it } from "vitest";

import { parseTravelRouteRefreshRequest } from "@/lib/services/travel-route-request";

describe("travel route request", () => {
  it("bounds raw client input before source reads", () => {
    expect(parseTravelRouteRefreshRequest({ startLocalDate: "2026-09-22", endLocalDate: "2026-09-23", device: null })).toMatchObject({ corrections: [] });
    expect(() => parseTravelRouteRefreshRequest({ startLocalDate: "2026-09-22", endLocalDate: "2026-09-25", device: null })).toThrow("range");
    expect(() => parseTravelRouteRefreshRequest({ startLocalDate: "2026-09-22", endLocalDate: "2026-09-22", device: { latitude: 91, longitude: 0, accuracyMeters: 1, sampledAt: "2026-09-22T00:00:00Z" } })).toThrow("sample");
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
