import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";

import {
  TRAVEL_LEG_OUTSIDE_WINDOW,
  normalizeTravelPlaceText,
  partitionTravelLegsByWindow,
  recordTravelRefresh,
  resolveTravelRefreshPlan,
  travelBudgetPausesAutomatic,
  travelDeviceMoved,
  travelEstimateAppearsAt,
  travelPlaceLookupReusable,
  travelRefreshRequestFields,
  travelRefreshTrips,
  travelTripKey,
  travelTripMatches,
  type TravelRefreshPlanInput,
  type TravelRefreshState,
  type TravelRefreshTrip,
} from "@cadence/core/services/travel-refresh-policy";

const now = Temporal.Instant.from("2026-10-17T12:00:00Z");
const leg = (id: string, kind: "depart_at" | "arrive_by", at: string, role: "outbound" | "onward" | "return" = "outbound", readyAt = now.toString()) => ({ id, role, readyAt, request: {
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

  it("routes an onward leg three hours before it can leave, so a long trip is never due unrouted (C3)", () => {
    // Ready at 14:30 after the previous stop; a four-hour trip must arrive by 19:00.
    const long = leg("long", "arrive_by", "2026-10-17T19:00:00Z", "onward", "2026-10-17T14:30:00Z");
    expect(partitionTravelLegsByWindow([long], Temporal.Instant.from("2026-10-17T11:29:59Z")).due).toEqual([]);
    expect(partitionTravelLegsByWindow([long], Temporal.Instant.from("2026-10-17T11:30:00Z")).due).toEqual([long]);
    expect(travelEstimateAppearsAt({ role: "onward", readyAt: "2026-10-17T14:30:00Z", destinationStartAt: "2026-10-17T19:10:00Z", arrivalBufferSeconds: 600 }))
      .toBe("2026-10-17T11:30:00Z");
    // An outbound leg's ready time is only the time of the check, so it keeps the arrival rule.
    expect(travelEstimateAppearsAt({ role: "outbound", readyAt: now.toString(), destinationStartAt: "2026-10-17T19:10:00Z", arrivalBufferSeconds: 600 }))
      .toBe("2026-10-17T16:00:00Z");
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

const NY = "America/New_York";
/** 2026-11-05 in New York, UTC-5. */
const at = (time: string, date = "2026-11-05") => Temporal.PlainDateTime.from(`${date}T${time}`).toZonedDateTime(NY).toInstant().toString();
const HOME_SAMPLE = { latitude: 42.05, longitude: -87.68, accuracyMeters: 20 };
const DENTIST_TRIP = { role: "outbound" as const, originRef: null, destinationRef: "dentist" };
const GYM_TRIP = { role: "onward" as const, originRef: "dentist", destinationRef: "gym" };
const DENTIST = travelTripKey(DENTIST_TRIP);
const GYM = travelTripKey(GYM_TRIP);
const refOf = (key: string) => key === DENTIST ? DENTIST_TRIP : GYM_TRIP;
const known = (key: string, leaveAt: string, checkedAt: string): TravelRefreshTrip => ({ ...refOf(key), key, leaveAt, checkedAt, fallbackAt: null });
const opened = (): TravelRefreshState => ({ localDate: "2026-11-05", sourceKey: "s1", device: HOME_SAMPLE, tripAttempts: {} });
function plan(time: string, overrides: Partial<TravelRefreshPlanInput> = {}) {
  return resolveTravelRefreshPlan({ now: at(time), timezone: NY, timelineFocused: true, sourceKey: "s1", device: HOME_SAMPLE,
    trips: [known(DENTIST, at("13:55"), at("08:00"))], budget: null, last: opened(), ...overrides });
}

describe("trip refresh plan (Ticket 267)", () => {
  it("routes the whole day on the first open of a local date", () => {
    expect(plan("07:00", { last: null, trips: [] }).request).toEqual({ kind: "day", trigger: "first_open" });
    const yesterday = { ...opened(), localDate: "2026-11-04" };
    expect(plan("07:00", { last: yesterday }).request).toEqual({ kind: "day", trigger: "first_open" });
    // Unfocused or not, an open of a new day routes it; the Daily Brief's day request counts too.
    expect(plan("07:00", { last: null, timelineFocused: false }).request?.kind).toBe("day");
  });

  it("requests nothing on an open with a last estimate and no trigger", () => {
    const result = plan("09:00");
    expect(result).toEqual({ request: null, nextDueAt: at("10:55"), automaticPaused: false });
  });

  it("refreshes a trip once within 3 hours of its leave time and once within 30 minutes", () => {
    expect(plan("10:55").request).toEqual({ kind: "trip", trigger: "trip_3h", trips: [DENTIST_TRIP] });
    const afterFirst = recordTravelRefresh(opened(), { kind: "trip", trigger: "trip_3h", trips: [DENTIST_TRIP] }, { now: at("10:55"), timezone: NY, sourceKey: "s1", device: HOME_SAMPLE });
    expect(plan("11:30", { last: afterFirst })).toMatchObject({ request: null, nextDueAt: at("13:25") });
    expect(plan("13:25", { last: afterFirst }).request).toEqual({ kind: "trip", trigger: "trip_30m", trips: [DENTIST_TRIP] });
    const afterFinal = recordTravelRefresh(afterFirst, { kind: "trip", trigger: "trip_30m", trips: [DENTIST_TRIP] }, { now: at("13:25"), timezone: NY, sourceKey: "s1", device: HOME_SAMPLE });
    expect(plan("13:40", { last: afterFinal })).toMatchObject({ request: null, nextDueAt: at("00:00", "2026-11-06") });
    // Once the leave time has passed the plan stops refreshing that trip.
    expect(plan("14:00", { last: afterFirst }).request).toBeNull();
  });

  it("counts a fresh check as the refresh: a first open 2 hours before leaving waits for the 30-minute one", () => {
    const trips = [known(DENTIST, at("13:55"), at("11:55"))];
    expect(plan("12:00", { trips })).toMatchObject({ request: null, nextDueAt: at("13:25") });
  });

  it("waits for focus before a trip refresh", () => {
    expect(plan("10:55", { timelineFocused: false })).toMatchObject({ request: null, nextDueAt: at("13:25") });
  });

  it("shares one request among trips due together", () => {
    const trips = [known(DENTIST, at("13:55"), at("08:00")), known(GYM, at("13:20"), at("08:00"))];
    expect(plan("13:00", { trips }).request).toEqual({ kind: "trip", trigger: "trip_30m", trips: [DENTIST_TRIP, GYM_TRIP] });
  });

  it("keeps today's rule for a trip with no estimate yet, once", () => {
    const trips: TravelRefreshTrip[] = [{ ...DENTIST_TRIP, key: DENTIST, leaveAt: null, checkedAt: null, fallbackAt: at("11:20") }];
    expect(plan("11:00", { trips })).toMatchObject({ request: null, nextDueAt: at("11:20") });
    expect(plan("11:20", { trips }).request).toEqual({ kind: "trip", trigger: "no_estimate", trips: [DENTIST_TRIP] });
    const tried = recordTravelRefresh(opened(), { kind: "trip", trigger: "no_estimate", trips: [DENTIST_TRIP] }, { now: at("11:20"), timezone: NY, sourceKey: "s1", device: HOME_SAMPLE });
    expect(plan("11:30", { trips, last: tried }).request).toBeNull();
  });

  it("routes the whole day after a source change or movement beyond 500 m", () => {
    expect(plan("09:00", { sourceKey: "s2" }).request).toEqual({ kind: "day", trigger: "source_changed" });
    expect(plan("09:00", { device: { ...HOME_SAMPLE, latitude: 42.06 } }).request).toEqual({ kind: "day", trigger: "device_moved" });
    expect(plan("09:00", { device: { ...HOME_SAMPLE, latitude: 42.051 } }).request).toBeNull();
  });

  it("stops automatic requests at 80% of the ceiling until it renews; Refresh travel still routes", () => {
    const budget = { reservedMicrodollars: 4_000_000, ceilingMicrodollars: 5_000_000, resetsAt: at("00:00", "2026-12-01") };
    expect(travelBudgetPausesAutomatic({ ...budget, reservedMicrodollars: 3_999_999 }, Temporal.Instant.from(at("09:00")))).toBe(false);
    expect(plan("10:55", { budget })).toEqual({ request: null, nextDueAt: budget.resetsAt, automaticPaused: true });
    expect(plan("07:00", { budget, last: null }).request).toBeNull();
    expect(plan("09:00", { budget, refreshTravel: true })).toMatchObject({ request: { kind: "day", trigger: "refresh_travel" }, automaticPaused: true });
    // After the reset time the reading is last month's.
    expect(plan("10:55", { budget, now: at("10:55", "2026-12-01"), last: { ...opened(), localDate: "2026-12-01" },
      trips: [known(DENTIST, at("13:55", "2026-12-01"), at("08:00", "2026-12-01"))] }).request?.kind).toBe("trip");
  });

  it("records a whole-day request with its date, sources and device, and resets trip attempts each day", () => {
    const fields = { now: at("07:00", "2026-11-06"), timezone: NY, sourceKey: "s3", device: null };
    const tried = { ...opened(), tripAttempts: { [DENTIST]: at("10:55") } };
    expect(recordTravelRefresh(tried, { kind: "day", trigger: "first_open" }, fields)).toEqual({ localDate: "2026-11-06", sourceKey: "s3", device: null, tripAttempts: {} });
    expect(recordTravelRefresh(tried, { kind: "day", trigger: "source_changed" }, { ...fields, now: at("12:00") }).tripAttempts).toEqual({ [DENTIST]: at("10:55") });
    expect(travelRefreshRequestFields({ kind: "day", trigger: "first_open" })).toEqual({ scope: "day" });
    expect(travelRefreshRequestFields({ kind: "trip", trigger: "trip_3h", trips: [DENTIST_TRIP] })).toEqual({ scope: "day", trips: [DENTIST_TRIP] });
  });

  it("matches a requested trip by its stop, even after an earlier stop has passed", () => {
    const leg = (role: "outbound" | "onward" | "return", originCommitmentRef: string | null, destinationCommitmentRef: string | null) => ({ role, originCommitmentRef, destinationCommitmentRef });
    expect(travelTripMatches(GYM_TRIP, leg("outbound", null, "gym"))).toBe(true);
    expect(travelTripMatches(GYM_TRIP, leg("onward", "dentist", "gym"))).toBe(true);
    expect(travelTripMatches(GYM_TRIP, leg("onward", "gym", "pool"))).toBe(false);
    expect(travelTripMatches({ role: "return", originRef: "gym", destinationRef: null }, leg("return", "gym", null))).toBe(true);
    expect(travelTripMatches({ role: "return", originRef: "gym", destinationRef: null }, leg("onward", "gym", "pool"))).toBe(false);
    expect(travelTripMatches({ role: "return", originRef: "dentist", destinationRef: null }, leg("return", "gym", null))).toBe(false);
  });

  it("derives watched trips from evidence: known times, and only trips left for later without one", () => {
    const evidenceLeg = (role: "outbound" | "return", origin: string | null, destination: string | null, readyAt: string) => ({
      id: `${role}`, role, journeyRef: "day", originCommitmentRef: origin, destinationCommitmentRef: destination, mode: "walking" as const, readyAt,
      provenance: {} as never });
    const trips = travelRefreshTrips({ arrivalBufferSeconds: 600, stops: [{ ref: "dentist", startAt: at("14:30") }], legs: [
      { leg: evidenceLeg("outbound", null, "dentist", at("08:00")), reason: null,
        estimate: { durationSeconds: 1500, departureAt: at("13:55"), arrivalAt: at("14:20"), warnings: [], fallback: false, attribution: "Google Maps", observedAt: at("08:00"), expiresAt: at("08:05") } },
      { leg: evidenceLeg("return", "dentist", null, at("15:40")), reason: TRAVEL_LEG_OUTSIDE_WINDOW, estimate: null },
      { leg: evidenceLeg("return", "gym", null, at("17:00")), reason: "provider_unavailable", estimate: null },
    ] });
    expect(trips).toEqual([
      { ...DENTIST_TRIP, key: DENTIST, leaveAt: at("13:55"), checkedAt: at("08:00"), fallbackAt: null },
      { role: "return", originRef: "dentist", destinationRef: null, key: "return:dentist:", leaveAt: null, checkedAt: null, fallbackAt: at("12:40") },
    ]);
  });
});
