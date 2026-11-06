import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";

import {
  TRAVEL_LEG_OUTSIDE_WINDOW,
  normalizeTravelPlaceText,
  partitionTravelLegsByWindow,
  recordTravelRefresh,
  resolveTravelRefreshPlan,
  resolveTravelTomorrowPlan,
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
  type TravelTomorrowPlanInput,
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

  it("routes the whole day after a source change", () => {
    expect(plan("09:00", { sourceKey: "s2" }).request).toEqual({ kind: "day", trigger: "source_changed" });
  });

  it("refreshes only the next trip from the device after movement beyond 500 m, at most every 10 minutes (Ticket 268)", () => {
    const moved = { ...HOME_SAMPLE, latitude: 42.06 };
    const trips = [known(DENTIST, at("13:55"), at("08:00")), known(GYM, at("15:00"), at("08:00"))];
    expect(plan("09:00", { device: moved, trips }).request).toEqual({ kind: "trip", trigger: "device_moved", trips: [DENTIST_TRIP] });
    expect(plan("09:00", { device: { ...HOME_SAMPLE, latitude: 42.051 }, trips }).request).toBeNull();
    // Unfocused, or with no trip leaving from the device, movement requests nothing.
    expect(plan("09:00", { device: moved, trips, timelineFocused: false }).request).toBeNull();
    expect(plan("09:00", { device: moved, trips: [known(GYM, at("15:00"), at("08:00"))] }).request).toBeNull();
    // The request moves the baseline and starts the floor.
    const after = recordTravelRefresh(opened(), { kind: "trip", trigger: "device_moved", trips: [DENTIST_TRIP] }, { now: at("09:00"), timezone: NY, sourceKey: "s1", device: moved });
    expect(after).toMatchObject({ device: moved, deviceRoutedAt: at("09:00"), tripAttempts: { [DENTIST]: at("09:00") } });
    const further = { ...HOME_SAMPLE, latitude: 42.07 };
    expect(plan("09:09", { device: further, trips, last: after })).toMatchObject({ request: null, nextDueAt: at("09:10") });
    expect(plan("09:10", { device: further, trips, last: after }).request).toEqual({ kind: "trip", trigger: "device_moved", trips: [DENTIST_TRIP] });
    // A whole-day request also routes from the device, so it restarts the floor.
    const day = recordTravelRefresh(after, { kind: "day", trigger: "source_changed" }, { now: at("09:05"), timezone: NY, sourceKey: "s1", device: further });
    expect(day.deviceRoutedAt).toBe(at("09:05"));
    expect(plan("09:14", { device: { ...HOME_SAMPLE, latitude: 42.09 }, trips, last: day }).request).toBeNull();
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
    expect(recordTravelRefresh(tried, { kind: "day", trigger: "first_open" }, fields)).toEqual({ localDate: "2026-11-06", sourceKey: "s3", device: null, tripAttempts: {}, deviceRoutedAt: fields.now });
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

describe("tomorrow's first trip plan (Ticket 282)", () => {
  /** New York, UTC-4 in October: 12:00Z is 8 AM local. */
  const at = (time: string) => `2026-10-17T${time}:00-04:00`;
  const trip = (leaveAt: string | null): TravelRefreshTrip => ({ role: "outbound", originRef: null, destinationRef: `stop-${leaveAt}`,
    key: `outbound::stop-${leaveAt}`, leaveAt, checkedAt: null, fallbackAt: leaveAt ? null : at("15:00") });
  const input = (time: string, overrides: Partial<TravelTomorrowPlanInput> = {}): TravelTomorrowPlanInput => ({
    now: Temporal.Instant.from(at(time)).toString(), timezone: "America/New_York", localDate: "2026-10-17",
    todayTrips: [trip(at("18:30"))], stopKey: "dentist-r1", last: null, budget: null, ...overrides });

  it("asks from 5 PM even with a trip left today, and waits until then", () => {
    expect(resolveTravelTomorrowPlan(input("16:59"))).toEqual({ dueLocalDate: null, nextDueAt: Temporal.Instant.from(at("17:00")).toString() });
    expect(resolveTravelTomorrowPlan(input("17:00"))).toEqual({ dueLocalDate: "2026-10-18", nextDueAt: null });
  });

  it("asks before 5 PM once today has no trips left, and waits for the last known leave time", () => {
    const morning = { todayTrips: [trip(at("09:00")), trip(at("12:30"))] };
    expect(resolveTravelTomorrowPlan(input("10:00", morning)).nextDueAt).toBe(Temporal.Instant.from(at("12:30")).toString());
    expect(resolveTravelTomorrowPlan(input("12:31", morning)).dueLocalDate).toBe("2026-10-18");
    expect(resolveTravelTomorrowPlan(input("10:00", { todayTrips: [] })).dueLocalDate).toBe("2026-10-18");
    // A trip with no leave time yet is still ahead.
    expect(resolveTravelTomorrowPlan(input("10:00", { todayTrips: [trip(null)] })).dueLocalDate).toBeNull();
  });

  it("asks once per first stop and revision", () => {
    const last = { localDate: "2026-10-18", stopKey: "dentist-r1" };
    expect(resolveTravelTomorrowPlan(input("18:00", { last }))).toEqual({ dueLocalDate: null, nextDueAt: null });
    expect(resolveTravelTomorrowPlan(input("18:00", { last, stopKey: "dentist-r2" })).dueLocalDate).toBe("2026-10-18");
    expect(resolveTravelTomorrowPlan(input("18:00", { last: { ...last, localDate: "2026-10-17" } })).dueLocalDate).toBe("2026-10-18");
  });

  it("tries a failed request once more from its retry time, and then stops", () => {
    const failed = { localDate: "2026-10-18", stopKey: "dentist-r1", retryAt: Temporal.Instant.from(at("18:05")).toString() };
    expect(resolveTravelTomorrowPlan(input("18:01", { last: failed }))).toEqual({ dueLocalDate: null, nextDueAt: failed.retryAt });
    expect(resolveTravelTomorrowPlan(input("18:05", { last: failed }))).toEqual({ dueLocalDate: "2026-10-18", nextDueAt: null });
    // The retry is recorded without a retry time, so nothing more is asked for this stop.
    expect(resolveTravelTomorrowPlan(input("18:30", { last: { ...failed, retryAt: null } }))).toEqual({ dueLocalDate: null, nextDueAt: null });
    // A retry time for another stop does not apply; the new stop is asked now.
    expect(resolveTravelTomorrowPlan(input("18:01", { last: failed, stopKey: "dentist-r2" })).dueLocalDate).toBe("2026-10-18");
    // At 80% of the budget the retry waits like every automatic request.
    const budget = { reservedMicrodollars: 4_000_000, ceilingMicrodollars: 5_000_000, resetsAt: "2026-11-01T04:00:00Z" };
    expect(resolveTravelTomorrowPlan(input("18:05", { last: failed, budget })).dueLocalDate).toBeNull();
  });

  it("asks nothing without a located stop tomorrow, without today's view, after midnight or at 80% of the budget", () => {
    expect(resolveTravelTomorrowPlan(input("18:00", { stopKey: null })).dueLocalDate).toBeNull();
    expect(resolveTravelTomorrowPlan(input("18:00", { todayTrips: null })).dueLocalDate).toBeNull();
    expect(resolveTravelTomorrowPlan(input("18:00", { localDate: "2026-10-16" })).dueLocalDate).toBeNull();
    const budget = { reservedMicrodollars: 4_000_000, ceilingMicrodollars: 5_000_000, resetsAt: "2026-11-01T04:00:00Z" };
    expect(resolveTravelTomorrowPlan(input("18:00", { budget })).dueLocalDate).toBeNull();
    expect(resolveTravelTomorrowPlan(input("18:00", { budget: { ...budget, reservedMicrodollars: 3_999_999 } })).dueLocalDate).toBe("2026-10-18");
  });
});

describe("tomorrow's first trip plan across clock changes (Ticket 282)", () => {
  const plan = (now: string, localDate: string) => resolveTravelTomorrowPlan({ now, timezone: "America/New_York", localDate,
    todayTrips: [{ role: "outbound", originRef: null, destinationRef: "late", key: "outbound::late", leaveAt: "2026-12-31T23:00:00Z", checkedAt: null, fallbackAt: null }],
    stopKey: "dentist-r1", last: null, budget: null });

  it("uses 5 PM local time on the days the clocks change", () => {
    // November 1, 2026: clocks fall back at 2 AM, so 5 PM is 22:00Z (EST), not 21:00Z.
    expect(plan("2026-11-01T21:30:00Z", "2026-11-01")).toEqual({ dueLocalDate: null, nextDueAt: "2026-11-01T22:00:00Z" });
    expect(plan("2026-11-01T22:00:00Z", "2026-11-01").dueLocalDate).toBe("2026-11-02");
    // The evening before, still EDT: 5 PM is 21:00Z and tomorrow is the change day.
    expect(plan("2026-10-31T21:00:00Z", "2026-10-31").dueLocalDate).toBe("2026-11-01");
    // March 8, 2026: clocks spring forward, so 5 PM is 21:00Z (EDT).
    expect(plan("2026-03-08T20:59:00Z", "2026-03-08")).toEqual({ dueLocalDate: null, nextDueAt: "2026-03-08T21:00:00Z" });
    expect(plan("2026-03-08T21:00:00Z", "2026-03-08").dueLocalDate).toBe("2026-03-09");
  });

  it("names tomorrow by the local date late at night, when UTC is already on the next day", () => {
    // 11:30 PM on October 17 in New York is October 18 in UTC.
    expect(plan("2026-10-18T03:30:00Z", "2026-10-17").dueLocalDate).toBe("2026-10-18");
    // After local midnight the old day view asks nothing.
    expect(plan("2026-10-18T04:00:00Z", "2026-10-17").dueLocalDate).toBeNull();
  });
});
