import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";

import {
  normalizeTravelPlaceText,
  partitionTravelLegsByWindow,
  travelDeviceMoved,
  travelPlaceLookupReusable,
} from "@cadence/core/services/travel-refresh-policy";

const now = Temporal.Instant.from("2026-10-17T12:00:00Z");
const leg = (id: string, kind: "depart_at" | "arrive_by", at: string) => ({ id, request: {
  origin: { kind: "place_id" as const, placeId: "a" }, destination: { kind: "place_id" as const, placeId: "b" },
  mode: "walking" as const, readyAt: now.toString(), timing: { kind, at },
} });

describe("travel refresh policy", () => {
  it("normalizes case, width and spacing in typed place text", () => {
    expect(normalizeTravelPlaceText("  1999 Campus Dr,\n  EVANSTON ")).toBe("1999 campus dr, evanston");
    expect(normalizeTravelPlaceText("Ｃａｆé  One")).toBe(normalizeTravelPlaceText("café one"));
  });

  it("reuses resolved lookups for a year and other outcomes for 30 days", () => {
    const at = (days: number) => now.subtract({ hours: 24 * days }).toString();
    expect(travelPlaceLookupReusable({ outcome: "resolved", lookedUpAt: at(364) }, now)).toBe(true);
    expect(travelPlaceLookupReusable({ outcome: "resolved", lookedUpAt: at(366) }, now)).toBe(false);
    expect(travelPlaceLookupReusable({ outcome: "unresolved", lookedUpAt: at(29) }, now)).toBe(true);
    expect(travelPlaceLookupReusable({ outcome: "ambiguous", lookedUpAt: at(31) }, now)).toBe(false);
    expect(travelPlaceLookupReusable({ outcome: "resolved", lookedUpAt: now.add({ hours: 1 }).toString() }, now)).toBe(false);
    expect(travelPlaceLookupReusable({ outcome: "resolved", lookedUpAt: "not-an-instant" }, now)).toBe(false);
  });

  it("routes legs that depart, or must arrive, within three hours and leaves the rest", () => {
    const { due, later } = partitionTravelLegsByWindow([
      leg("soon", "arrive_by", "2026-10-17T14:59:00Z"),
      leg("edge", "depart_at", "2026-10-17T15:00:00Z"),
      leg("evening", "arrive_by", "2026-10-17T19:00:00Z"),
    ], now);
    expect(due.map((item) => item.id)).toEqual(["soon", "edge"]);
    expect(later.map((item) => item.id)).toEqual(["evening"]);
  });

  it("treats movement beyond 500 m plus both accuracy radii as a change", () => {
    const sample = (latitude: number, accuracyMeters = 10) => ({ latitude, longitude: -87.68, accuracyMeters });
    expect(travelDeviceMoved(sample(42.05), sample(42.051))).toBe(false);
    expect(travelDeviceMoved(sample(42.05), sample(42.06))).toBe(true);
    expect(travelDeviceMoved(sample(42.05, 300), sample(42.058, 300))).toBe(false);
    expect(travelDeviceMoved(null, sample(42.05))).toBe(true);
    expect(travelDeviceMoved(sample(42.05), null)).toBe(false);
    expect(travelDeviceMoved(null, null)).toBe(false);
  });
});
