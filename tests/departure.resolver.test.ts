import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  DEPARTURE_LEAVE_NOW_SECONDS,
  DEPARTURE_SOON_SECONDS,
  resolveDepartureModel,
} from "../packages/core/src/resolvers/departure.resolver";
import { resolveTravelAfterDecisions, resolveTravelEvidence, resolveTravelPlan } from "../packages/core/src/resolvers/travel.resolver";
import {
  departureBriefFooterPhrase,
  departureCheckedPhrase,
  departureFreeAgainPhrase,
  departureOverlapPhrase,
  departurePhraseContext,
  departureTimeLabel,
  departureWeatherMarginPhrase,
  eventStateWord,
} from "../packages/core/src/services/departure-phrases";
import { behaviorEndAt, departureStops } from "../packages/core/src/services/departure-stops";
import { TRAVEL_LEG_OUTSIDE_WINDOW, travelEstimateAppearsAt } from "../packages/core/src/services/travel-refresh-policy";
import type { DepartureModelInput, DepartureStop } from "../packages/core/src/types/departure";
import type { TravelEvidenceLeg, TravelLegRole, TravelMode, TravelResolvedLegEvidence, TravelUnknownLeg } from "../packages/core/src/types/travel";

const NY = "America/New_York";
/** 2026-09-16 in New York, UTC-4: "13:15" is 1:15 PM local. */
const local = (time: string, date = "2026-09-16", offset = "-04:00") => {
  const instant = new Date(`${date}T${time.length === 5 ? `${time}:00` : time}${offset}`);
  return instant.toISOString().replace(".000Z", "Z");
};
const DENTIST: DepartureStop = { ref: "dentist", label: "Dentist", startAt: local("14:30"), endAt: local("15:30") };

function leg(role: TravelLegRole, origin: string | null, destination: string | null, overrides: Partial<TravelEvidenceLeg> = {}): TravelEvidenceLeg {
  return { id: `leg-${role}-${origin}-${destination}`, role, journeyRef: "day", originCommitmentRef: origin, destinationCommitmentRef: destination,
    mode: "walking", readyAt: local("08:00"),
    provenance: { originRef: "home", originSource: origin ? "planned_stop" : "saved_base", originRevision: "1", destinationRef: destination ?? "home",
      destinationSource: destination ? "calendar" : "saved_base", destinationRevision: "1", grantRevision: "g" }, ...overrides };
}

function timed(entry: TravelEvidenceLeg, leaveAt: string, arriveAt: string, overrides: Partial<TravelResolvedLegEvidence> = {}, expiresAt = local("23:59")): TravelResolvedLegEvidence {
  return { leg: entry, state: "current", reason: null,
    estimate: { durationSeconds: 1500, departureAt: leaveAt, arrivalAt: arriveAt, warnings: [], fallback: false, attribution: "Google Maps", observedAt: local("08:00"), expiresAt }, ...overrides };
}

const missing = (entry: TravelEvidenceLeg, state: TravelResolvedLegEvidence["state"], reason: string): TravelResolvedLegEvidence => ({ leg: entry, state, estimate: null, reason });
const unknown = (role: TravelLegRole, origin: string | null, destination: string | null, reason: TravelUnknownLeg["reason"]): TravelUnknownLeg =>
  ({ role, originCommitmentRef: origin, destinationCommitmentRef: destination, reason });

function model(now: string, legs: readonly TravelResolvedLegEvidence[], overrides: Partial<DepartureModelInput> & Readonly<{ unknownLegs?: readonly TravelUnknownLeg[] }> = {}) {
  const { unknownLegs, ...rest } = overrides;
  return resolveDepartureModel({ evidence: { legs: [...legs], unknownLegs: unknownLegs ?? [] }, stops: [DENTIST], now, timezone: NY,
    arrivalBufferSeconds: 600, preparationSeconds: 0, pausedUntil: null, ...rest });
}

const OUTBOUND = leg("outbound", null, "dentist");
const HOME = leg("return", "dentist", null, { readyAt: local("15:40") });
const onTime = () => timed(OUTBOUND, local("13:55"), local("14:20"));
const tripHome = () => timed(HOME, local("15:40"), local("16:10"));

describe("the moving clock", () => {
  it("states the right thing at every step from first open until after the event", () => {
    const later = [missing(OUTBOUND, "unavailable", TRAVEL_LEG_OUTSIDE_WINDOW), missing(HOME, "unavailable", TRAVEL_LEG_OUTSIDE_WINDOW)];
    const routed = [onTime(), tripHome()];
    const expiredRoute = [timed(OUTBOUND, local("13:55"), local("14:20"), {}, local("11:35")), tripHome()];
    const steps: readonly [string, readonly TravelResolvedLegEvidence[], string, string][] = [
      ["08:00", later, "appears_later", "The leave time for Dentist appears by 11:20 AM."],
      ["11:30", routed, "upcoming", "Leave by 1:55 PM for Dentist from Home · walking, arrive 2:20 PM."],
      ["12:00", expiredRoute, "upcoming", "Last estimate: leave by 1:55 PM for Dentist · checked 8:00 AM."],
      ["13:24:59", routed, "upcoming", "Leave by 1:55 PM for Dentist from Home · walking, arrive 2:20 PM."],
      ["13:25", routed, "soon", "Leave in 30 minutes, by 1:55 PM for Dentist from Home · walking, arrive 2:20 PM."],
      ["13:54:01", routed, "soon", "Leave in 1 minute, by 1:55 PM for Dentist from Home · walking, arrive 2:20 PM."],
      ["13:55", routed, "leave_now", "Leave now for Dentist from Home · walking, arrive 2:20 PM."],
      ["13:59:59", routed, "leave_now", "Leave now for Dentist from Home · walking, arrive 2:24 PM."],
      ["14:00", routed, "late", "If you haven't left for Dentist yet, you'd arrive about 2:25 PM."],
      ["14:29", routed, "late", "If you haven't left for Dentist yet, you'd arrive about 2:54 PM."],
      ["14:30", routed, "head_home", "Head home 3:40 PM · walking, home by 4:10 PM."],
      ["15:09", routed, "head_home", "Head home 3:40 PM · walking, home by 4:10 PM."],
      ["15:29", routed, "head_home", "Head home in 11 minutes, by 3:40 PM · walking, home by 4:10 PM."],
      ["15:30", routed, "soon", "Head home in 10 minutes, by 3:40 PM · walking, home by 4:10 PM."],
      ["15:40", routed, "leave_now", "Head home now · walking, home by 4:10 PM."],
      ["15:45", routed, "late", "If you haven't left yet, you'd be home about 4:15 PM."],
      ["16:10", routed, "none", ""],
    ];
    for (const [time, legs, state, phrase] of steps) {
      const result = model(local(time), legs);
      expect([time, result.state, result.phrase ?? ""]).toEqual([time, state, phrase]);
    }
  });

  it("names both edges of the thresholds as constants", () => {
    expect(DEPARTURE_SOON_SECONDS).toBe(1800);
    expect(DEPARTURE_LEAVE_NOW_SECONDS).toBe(300);
  });
});

describe("each state", () => {
  it("upcoming: more than 30 minutes away", () => {
    const { next } = model(local("12:00"), [onTime()]);
    expect(next).toMatchObject({ state: "upcoming", leaveAt: local("13:55"), arriveAt: local("14:20"), minutesUntilLeave: 115, freshness: "current", fromHome: true, mode: "walking", action: null });
    expect(next?.phrase).toBe("Leave by 1:55 PM from Home · walking, arrive 2:20 PM.");
  });

  it("soon: rounds whole minutes up", () => {
    expect(model(local("13:42:30"), [onTime()]).next).toMatchObject({ state: "soon", minutesUntilLeave: 13 });
    expect(model(local("13:42:30"), [onTime()]).next?.phrase).toBe("Leave in 13 minutes, by 1:55 PM from Home · walking, arrive 2:20 PM.");
  });

  it("from Home appears only for a trip that starts at Home", () => {
    const device = leg("outbound", null, "dentist", { provenance: { ...OUTBOUND.provenance, originSource: "device" } });
    expect(model(local("12:00"), [timed(device, local("13:55"), local("14:20"))]).next?.phrase).toBe("Leave by 1:55 PM · walking, arrive 2:20 PM.");
  });

  it("leave now: starts at the leave time and ends at its named length", () => {
    expect(model(local("13:55"), [onTime()]).next?.state).toBe("leave_now");
    expect(model(local("13:59:59"), [onTime()]).next?.state).toBe("leave_now");
    expect(model(local("14:00"), [onTime()]).next?.state).toBe("late");
  });

  it("late: a flagged leg reads late even before its departure, and gives its arrival", () => {
    const late = timed(OUTBOUND, local("14:10"), local("14:40"), { late: true });
    const { next } = model(local("14:00"), [late]);
    expect(next).toMatchObject({ state: "late", leaveAt: local("14:10"), arriveAt: local("14:40"), minutesUntilLeave: 10 });
    expect(next?.phrase).toBe("You may arrive late: leave by 2:10 PM from Home · walking, arrive 2:40 PM.");
  });

  it("late from evidence: a current flag keeps the route's arrival after its departure passes", () => {
    const late = timed(OUTBOUND, local("14:10"), local("14:40"), { late: true });
    for (const time of ["14:15", "14:25"]) {
      const { next } = model(local(time), [late]);
      expect(next).toMatchObject({ state: "late", lateBasis: "evidence", freshness: "current", arriveAt: local("14:40"), minutesUntilLeave: null });
      expect(next?.phrase).toBe("You may arrive late: arrive 2:40 PM.");
    }
    expect(model(local("14:15"), [late]).next?.linePhrase).toBe("You may arrive late at Dentist: arrive 2:40 PM.");
  });

  it("late from the clock: the words hold whether or not the user has left", () => {
    const { next } = model(local("14:05"), [onTime()]);
    expect(next).toMatchObject({ state: "late", lateBasis: "clock", arriveAt: local("14:30") });
    expect(next?.phrase).toBe("If you haven't left yet, you'd arrive about 2:30 PM.");
    expect(next?.linePhrase).toBe("If you haven't left for Dentist yet, you'd arrive about 2:30 PM.");
    expect(next?.phrase).not.toMatch(/late/i);
  });

  it("late from the clock: an expired late flag no longer counts as evidence", () => {
    const entry = timed(OUTBOUND, local("14:10"), local("14:40"), { late: true }, local("14:12"));
    expect(model(local("14:11"), [entry]).next).toMatchObject({ lateBasis: "evidence", freshness: "current", arriveAt: local("14:40") });
    expect(model(local("14:13"), [entry]).next).toMatchObject({ lateBasis: "evidence", freshness: "last_estimate", arriveAt: local("14:40"),
      phrase: "Last estimate: you may arrive late, arrive 2:40 PM · checked 8:00 AM." });
    expect(model(local("14:15"), [entry]).next).toMatchObject({ lateBasis: "clock", freshness: "last_estimate", arriveAt: local("14:45"),
      phrase: "Last estimate: if you haven't left yet, you'd arrive about 2:45 PM · checked 8:00 AM." });
  });

  it("only a late state has a late basis", () => {
    for (const time of ["12:00", "13:40", "13:56", "14:45"]) {
      expect(model(local(time), [onTime(), tripHome()]).next?.lateBasis).toBeNull();
    }
  });

  it("late from the clock: a transit trip stays a rough figure", () => {
    const transit = leg("outbound", null, "dentist", { mode: "transit" });
    expect(model(local("14:05"), [timed(transit, local("13:55"), local("14:20"))]).next?.phrase).toBe("If you haven't left yet, you'd arrive about 2:30 PM.");
  });

  it("an arrival moved by the clock keeps no trip open past the event's start and end", () => {
    const lastOut = timed(OUTBOUND, local("13:55"), local("14:20"));
    const steps: readonly [string, string, string | null][] = [
      ["14:00", "outbound", "late"],
      ["14:29:59", "outbound", "late"],
      ["14:30", "return", "head_home"],
      ["15:00", "return", "head_home"],
      ["15:29:59", "return", "head_home"],
      ["15:30", "return", "soon"],
      ["15:44", "return", "leave_now"],
      ["16:09:59", "return", "late"],
    ];
    for (const [time, role, state] of steps) {
      const { next } = model(local(time), [lastOut, tripHome()]);
      expect([time, next?.role, next?.state]).toEqual([time, role, state]);
    }
    // The clock-moved arrival at 16:09:59 reads 4:39 PM, yet the trip ends at its route arrival.
    expect(model(local("16:09:59"), [lastOut, tripHome()]).next?.arriveAt).toBe(local("16:39:59"));
    expect(model(local("16:10"), [lastOut, tripHome()])).toMatchObject({ state: "none", next: null, trips: [] });
  });

  it("late from evidence: a flagged trip ends at its route arrival, then the next trip takes over", () => {
    const late = timed(OUTBOUND, local("14:20"), local("14:50"), { late: true });
    expect(model(local("14:49:59"), [late, tripHome()]).next).toMatchObject({ role: "outbound", arriveAt: local("14:50") });
    expect(model(local("14:50"), [late, tripHome()]).next).toMatchObject({ role: "return", state: "head_home" });
  });

  it("late: stays the next trip past the event's start until its estimated arrival", () => {
    const late = timed(OUTBOUND, local("14:20"), local("14:50"), { late: true });
    expect(model(local("14:35"), [late, tripHome()]).next?.key).toBe("outbound::dentist");
    expect(model(local("14:50"), [late, tripHome()]).next?.state).toBe("head_home");
  });

  it.each(["walking", "cycling", "transit", "driving"] as TravelMode[])("late: gives an arrival for %s", (mode) => {
    const entry = leg("outbound", null, "dentist", { mode });
    const { next } = model(local("14:15"), [timed(entry, local("14:10"), local("14:40"), { late: true })]);
    expect(next).toMatchObject({ lateBasis: "evidence", arriveAt: local("14:40") });
  });

  it("head home: only while the event is under way and the trip home is next", () => {
    expect(model(local("14:45"), [tripHome()]).next).toMatchObject({ state: "head_home", minutesUntilLeave: 55 });
    expect(model(local("15:15"), [tripHome()]).next?.phrase).toBe("Head home in 25 minutes, by 3:40 PM · walking, home by 4:10 PM.");
    const before = model(local("12:00"), [onTime(), tripHome()]);
    expect(before.trips.map((trip) => trip.state)).toEqual(["upcoming", "upcoming"]);
    expect(before.trips[1]?.phrase).toBe("Head home 3:40 PM · walking, home by 4:10 PM.");
  });

  it("appears later: counts back from the arrival target, not the leave time", () => {
    const { next } = model(local("08:00"), [missing(OUTBOUND, "unavailable", TRAVEL_LEG_OUTSIDE_WINDOW)]);
    expect(next).toMatchObject({ state: "appears_later", appearsAt: local("11:20"), action: null });
    expect(next?.phrase).toBe("Leave time appears by 11:20 AM.");
  });

  it("appears later: the trip home counts back from its departure", () => {
    expect(model(local("08:00"), [missing(HOME, "unavailable", TRAVEL_LEG_OUTSIDE_WINDOW)]).next?.appearsAt).toBe(local("12:40"));
  });

  it("appears later: once the time has passed it offers a refresh", () => {
    const { next } = model(local("11:30"), [missing(OUTBOUND, "unavailable", TRAVEL_LEG_OUTSIDE_WINDOW)]);
    expect(next).toMatchObject({ state: "appears_later", action: "refresh" });
    expect(next?.phrase).toBe("Refresh travel to get the leave time.");
  });

  it("appears later: a stop missing from the input gives no invented time", () => {
    const { next } = model(local("08:00"), [missing(OUTBOUND, "unavailable", TRAVEL_LEG_OUTSIDE_WINDOW)], { stops: [] });
    expect(next).toMatchObject({ appearsAt: null, phrase: "Leave time appears later.", linePhrase: "The leave time for your next stop appears later." });
  });

  it("keeps the window calculation in the refresh policy", () => {
    expect(travelEstimateAppearsAt({ role: "outbound", readyAt: local("08:00"), destinationStartAt: local("14:30"), arrivalBufferSeconds: 600 })).toBe(local("11:20"));
    expect(travelEstimateAppearsAt({ role: "onward", readyAt: local("08:00"), destinationStartAt: null, arrivalBufferSeconds: 600 })).toBeNull();
  });

  it("needs place names the event", () => {
    const place = model(local("08:00"), [], { unknownLegs: [unknown("outbound", null, "dentist", "destination_unknown")] });
    expect(place).toMatchObject({ state: "needs_place", phrase: "Add a place for Dentist to get a leave time." });
  });

  it("needs origin names the event that blocks it", () => {
    const lunch: DepartureStop = { ref: "lunch", label: "Lunch", startAt: local("12:00"), endAt: local("13:00") };
    const result = model(local("08:00"), [], { stops: [DENTIST, lunch], unknownLegs: [
      unknown("outbound", null, "dentist", "origin_unknown"),
      unknown("outbound", null, "lunch", "destination_unknown"),
    ] });
    expect(result.trips.map((trip) => trip.state)).toEqual(["needs_place", "needs_origin"]);
    expect(result.trips[1]).toMatchObject({ blockingRef: "lunch", blockingLabel: "Lunch", phrase: "Fix Lunch's place to get a leave time for Dentist." });
    // Decision D12: the stop past the trip limit gives no time, but it does not block a later trip.
    const limited = model(local("08:00"), [], { stops: [DENTIST, lunch], unknownLegs: [
      unknown("outbound", null, "lunch", "leg_limit"),
      unknown("outbound", null, "dentist", "origin_unknown"),
    ] });
    expect(limited.trips[1]?.blockingRef).toBeNull();
  });

  it("needs origin without a blocker asks for Home", () => {
    const { next } = model(local("08:00"), [], { unknownLegs: [unknown("outbound", null, "dentist", "origin_unknown")] });
    expect(next).toMatchObject({ state: "needs_origin", blockingRef: null, phrase: "Add Home in Settings to get a leave time for Dentist." });
  });

  it("needs origin does not blame a stop that a routed trip already got past", () => {
    const lunch: DepartureStop = { ref: "lunch", label: "Lunch", startAt: local("10:00"), endAt: local("11:00") };
    const coffee: DepartureStop = { ref: "coffee", label: "Coffee", startAt: local("12:00"), endAt: local("13:00") };
    const routed = timed(leg("outbound", null, "coffee"), local("11:30"), local("11:50"));
    const { trips } = model(local("08:00"), [routed], { stops: [DENTIST, lunch, coffee], unknownLegs: [
      unknown("outbound", null, "lunch", "destination_unknown"),
      unknown("outbound", null, "dentist", "origin_unknown"),
    ] });
    expect(trips.at(-1)).toMatchObject({ state: "needs_origin", blockingRef: null });
  });

  it("states why a time cannot be given", () => {
    const home = model(local("14:45"), [], { unknownLegs: [unknown("return", "dentist", null, "return_base_missing")] });
    expect(home).toMatchObject({ state: "time_unknown", phrase: "Add Home in Settings to estimate the return time." });
    expect(home.next?.timeUnknownCause).toBe("home_missing");
    const noEnd = model(local("08:00"), [], { unknownLegs: [unknown("return", "dentist", null, "timing_unknown")] });
    expect(noEnd).toMatchObject({ phrase: "Return time unknown." });
    const limit = model(local("08:00"), [], { unknownLegs: [unknown("onward", "lunch", "dentist", "leg_limit")] });
    expect(limit.next).toMatchObject({ timeUnknownCause: "leg_limit", phrase: "No leave time for this trip.", linePhrase: "No leave time for the trip to Dentist." });
  });

  it("gives one line for each reason an estimate is missing", () => {
    expect(model(local("08:00"), [missing(OUTBOUND, "unavailable", "Route unavailable.")]).next).toMatchObject({ state: "no_route", phrase: "No route found.", action: null });
    expect(model(local("08:00"), [missing(OUTBOUND, "rejected_revision", "Journey or grant revision changed.")]).next).toMatchObject({ state: "trip_changed", phrase: "Trip changed.", action: "refresh" });
    expect(model(local("08:00"), [missing(OUTBOUND, "stale", "Route estimate expired.")]).next).toMatchObject({ state: "estimate_expired", phrase: "Estimate expired.", action: "refresh" });
  });

  it("none: no trips, so nothing is shown", () => {
    for (const result of [model(local("12:00"), []), resolveDepartureModel({ evidence: null, stops: [], now: local("12:00"), timezone: NY, arrivalBufferSeconds: 0, preparationSeconds: 0, pausedUntil: null })]) {
      expect(result).toEqual({ state: "none", next: null, phrase: null, trips: [], resumesAt: null, pausedPhrase: null });
    }
  });

  it("gives the get-ready time for an outbound trip, not before it can start", () => {
    expect(model(local("12:00"), [onTime()], { preparationSeconds: 600 }).next?.getReadyAt).toBe(local("13:45"));
    const tight = timed(leg("outbound", null, "dentist", { readyAt: local("13:50") }), local("13:55"), local("14:20"));
    expect(model(local("12:00"), [tight], { preparationSeconds: 600 }).next?.getReadyAt).toBe(local("13:50"));
    expect(model(local("14:45"), [tripHome()], { preparationSeconds: 600 }).next?.getReadyAt).toBeNull();
  });
});

describe("last estimate", () => {
  const expired = (entry: TravelEvidenceLeg, leave: string, arrive: string, overrides: Partial<TravelResolvedLegEvidence> = {}) => timed(entry, leave, arrive, overrides, local("08:05"));

  it("keeps the time with its checked time, in one phrase for every time state", () => {
    const expiredOut = expired(OUTBOUND, local("13:55"), local("14:20"));
    const cases: readonly [string, TravelResolvedLegEvidence, string, string][] = [
      ["12:00", expiredOut, "upcoming", "Last estimate: leave by 1:55 PM · checked 8:00 AM."],
      ["13:40", expiredOut, "soon", "Last estimate: leave by 1:55 PM · checked 8:00 AM."],
      ["13:56", expiredOut, "leave_now", "Last estimate: leave now · checked 8:00 AM."],
      ["14:10", expiredOut, "late", "Last estimate: if you haven't left yet, you'd arrive about 2:35 PM · checked 8:00 AM."],
      ["13:00", expired(OUTBOUND, local("14:10"), local("14:40"), { late: true }), "late", "Last estimate: you may arrive late, leave by 2:10 PM, arrive 2:40 PM · checked 8:00 AM."],
      ["14:45", expired(HOME, local("15:40"), local("16:10")), "head_home", "Last estimate: head home 3:40 PM · checked 8:00 AM."],
      ["15:42", expired(HOME, local("15:40"), local("16:10")), "leave_now", "Last estimate: head home now · checked 8:00 AM."],
      ["15:50", expired(HOME, local("15:40"), local("16:10")), "late", "Last estimate: if you haven't left yet, you'd be home about 4:20 PM · checked 8:00 AM."],
    ];
    for (const [time, entry, state, phrase] of cases) {
      expect(model(local(time), [entry]).next).toMatchObject({ state, phrase, freshness: "last_estimate", checkedAt: local("08:00"), action: "refresh" });
    }
  });

  it("changes exactly at expiry", () => {
    const entry = expired(OUTBOUND, local("13:55"), local("14:20"));
    expect(model(local("08:04:59"), [entry]).next?.freshness).toBe("current");
    expect(model(local("08:05"), [entry]).next?.freshness).toBe("last_estimate");
  });

  it("also reads a stale leg that keeps its estimate, as Ticket 268 will", () => {
    const kept: TravelResolvedLegEvidence = { ...onTime(), state: "stale", reason: "Route estimate expired." };
    expect(model(local("12:00"), [kept]).next).toMatchObject({ state: "upcoming", freshness: "last_estimate", phrase: "Last estimate: leave by 1:55 PM · checked 8:00 AM." });
  });
});

describe("paused", () => {
  const pausedUntil = "2026-10-01T04:00:00Z";

  it("says when estimates resume when no time is known", () => {
    expect(model(local("08:00"), [missing(OUTBOUND, "unavailable", TRAVEL_LEG_OUTSIDE_WINDOW)], { pausedUntil })).toMatchObject({
      state: "paused", resumesAt: pausedUntil, phrase: "Travel estimates resume on October 1.", next: { state: "paused", action: null, appearsAt: null } });
    expect(model(local("08:00"), [missing(OUTBOUND, "stale", "Route estimate expired.")], { pausedUntil }).state).toBe("paused");
  });

  it("keeps a known time, withdraws Refresh travel and states the pause beside it", () => {
    const result = model(local("12:00"), [timed(OUTBOUND, local("13:55"), local("14:20"), {}, local("08:05"))], { pausedUntil });
    expect(result).toMatchObject({ state: "upcoming", pausedPhrase: "Travel estimates resume on October 1.", next: { freshness: "last_estimate", action: null } });
  });

  it("says nothing on a day with no trips, even with no evidence", () => {
    const result = resolveDepartureModel({ evidence: null, stops: [], now: local("08:00"), timezone: NY, arrivalBufferSeconds: 0, preparationSeconds: 0, pausedUntil });
    expect(result).toEqual({ state: "none", next: null, phrase: null, trips: [], resumesAt: null, pausedPhrase: null });
  });

  it("keeps a step the user can take", () => {
    expect(model(local("08:00"), [], { pausedUntil, unknownLegs: [unknown("outbound", null, "dentist", "destination_unknown")] }).state).toBe("needs_place");
  });

  it("reads paused without evidence, none with empty evidence, and ends on the resume date", () => {
    const input = { evidence: null, stops: [DENTIST], timezone: NY, arrivalBufferSeconds: 0, preparationSeconds: 0, pausedUntil };
    expect(resolveDepartureModel({ ...input, now: local("08:00") })).toMatchObject({ state: "paused", next: null, phrase: "Travel estimates resume on October 1." });
    expect(resolveDepartureModel({ ...input, now: pausedUntil })).toMatchObject({ state: "none", phrase: null });
    expect(model(local("08:00"), [], { pausedUntil }).state).toBe("none");
  });
});

describe("choosing the next trip", () => {
  const lunch: DepartureStop = { ref: "lunch", label: "Lunch", startAt: local("12:00"), endAt: local("13:00") };
  const toLunch = () => timed(leg("outbound", null, "lunch"), local("11:30"), local("11:50"));
  const onward = () => timed(leg("onward", "lunch", "dentist", { readyAt: local("13:10") }), local("13:55"), local("14:20"));
  const stops = [lunch, DENTIST];

  it("before an event it is the outbound trip", () => {
    expect(model(local("09:00"), [toLunch(), onward(), tripHome()], { stops }).next?.destinationRef).toBe("lunch");
  });

  it("during an event it is the next departure, which may be onward", () => {
    const result = model(local("12:30"), [toLunch(), onward(), tripHome()], { stops });
    expect(result.next).toMatchObject({ role: "onward", state: "upcoming" });
    expect(result.trips.map((trip) => trip.role)).toEqual(["onward", "return"]);
  });

  it("during the last event it is the trip home, and after that none", () => {
    expect(model(local("15:00"), [toLunch(), onward(), tripHome()], { stops }).next?.role).toBe("return");
    expect(model(local("16:10"), [toLunch(), onward(), tripHome()], { stops })).toMatchObject({ state: "none", trips: [] });
  });

  it("orders unknown trips between routed ones", () => {
    const result = model(local("09:00"), [toLunch(), tripHome()], { stops, unknownLegs: [unknown("onward", "lunch", "dentist", "destination_unknown")] });
    expect(result.trips.map((trip) => trip.state)).toEqual(["upcoming", "needs_place", "upcoming"]);
  });

  it("a trip with no place stops being next when its event starts", () => {
    const unknownLegs = [unknown("outbound", null, "dentist", "destination_unknown")];
    expect(model(local("14:29"), [], { unknownLegs }).state).toBe("needs_place");
    expect(model(local("14:30"), [], { unknownLegs }).state).toBe("none");
  });

  it("with no Home, the return stays next until the event ends", () => {
    const unknownLegs = [unknown("return", "dentist", null, "return_base_missing")];
    expect(model(local("15:29"), [], { unknownLegs }).state).toBe("time_unknown");
    expect(model(local("15:30"), [], { unknownLegs }).state).toBe("none");
  });

  const decided = (legs: readonly TravelResolvedLegEvidence[], unknownLegs: readonly TravelUnknownLeg[], resolved: string) =>
    resolveTravelAfterDecisions({ version: "1.0" as const, journeyRef: "day", legs: [...legs], unknownLegs, segments: [], occupiedSpans: [], collisions: [], completeTrip: true, finalAvailabilityAt: null }, [{ id: resolved, status: "completed" }]);

  it("a resolved Occurrence's own trip leaves, and the next trip does not skip the next stop", () => {
    const after = decided([toLunch(), onward(), tripHome()], [], "lunch");
    const result = resolveDepartureModel({ evidence: after, stops, now: local("09:00"), timezone: NY, arrivalBufferSeconds: 600, preparationSeconds: 0, pausedUntil: null });
    expect(result.trips.some((trip) => trip.destinationRef === "lunch")).toBe(false);
    expect(result.next).toMatchObject({ role: "onward", destinationRef: "dentist", state: "trip_changed", action: "refresh", leaveAt: null, linePhrase: "The trip to Dentist changed." });
    expect(result.trips.map((trip) => trip.role)).toEqual(["onward", "return"]);
    expect(after?.legs.map(({ leg }) => leg.role)).toEqual(["return"]);
    expect(after?.completeTrip).toBe(false);
  });

  it("the withdrawn leg is no leg at all: no estimate, no occupancy, and no field on released evidence", () => {
    const lunchRoute = toLunch();
    const leaving = onward();
    const arrival = { id: `arrival:${leaving.leg.id}`, kind: "arrival_buffer" as const, startAt: local("14:20"), endAt: local("14:30"), sourceRefs: ["dentist"], legId: leaving.leg.id };
    const route = { id: `route:${leaving.leg.id}`, kind: "route" as const, startAt: local("13:55"), endAt: local("14:20"), sourceRefs: ["lunch", "dentist"], legId: leaving.leg.id };
    const base = { version: "1.0" as const, journeyRef: "day", legs: [lunchRoute, leaving], segments: [route, arrival], occupiedSpans: [], collisions: [], completeTrip: true, finalAvailabilityAt: null };
    const after = resolveTravelAfterDecisions(base, [{ id: "lunch", status: "completed" }]);
    expect(after?.legs).toEqual([]);
    expect(after?.segments).toEqual([]);
    expect(after?.unknownLegs).toEqual([{ role: "onward", originCommitmentRef: "lunch", destinationCommitmentRef: "dentist", reason: "origin_unknown", blockerResolved: true }]);
    const nothingWithdrawn = resolveTravelAfterDecisions({ ...base, legs: [lunchRoute] }, [{ id: "lunch", status: "completed" }]);
    expect(nothingWithdrawn).not.toHaveProperty("unknownLegs");
  });

  it("a stop whose blocker was resolved reads trip changed, not Add Home", () => {
    const unknownLegs = [unknown("outbound", null, "lunch", "destination_unknown"), unknown("outbound", null, "dentist", "origin_unknown")];
    const after = decided([], unknownLegs, "lunch");
    const { next } = resolveDepartureModel({ evidence: after, stops, now: local("09:00"), timezone: NY, arrivalBufferSeconds: 600, preparationSeconds: 0, pausedUntil: null });
    expect(next).toMatchObject({ state: "trip_changed", action: "refresh", phrase: "Trip changed.", blockingRef: null });
    expect(next?.phrase).not.toContain("Home");
    expect(decided([], unknownLegs, "other")?.unknownLegs).toEqual(unknownLegs);
  });

  it("an unknown trip onward from a resolved stop stays", () => {
    const after = decided([], [unknown("onward", "lunch", "dentist", "destination_unknown"), unknown("return", "dentist", null, "return_base_missing")], "lunch");
    expect(after?.unknownLegs?.map((item) => item.reason)).toEqual(["destination_unknown", "return_base_missing"]);
  });

  it("does not change its input", () => {
    const legs = Object.freeze([Object.freeze(onTime())]);
    expect(() => model(local("12:00"), legs)).not.toThrow();
  });
});

describe("unreliable chains", () => {
  const PLACE = (ref: string, id: number) => ({ ref, source: "calendar" as const, sourceRevision: `${ref}-1`, point: { kind: "coordinates" as const, latitude: 40 + id / 100, longitude: -74 } });
  const buffers = { arrivalSeconds: 0, exitSeconds: 300, settlingSeconds: 1800 };
  const stop = (ref: string, startAt: string, endAt: string) => ({ ref, revision: `${ref}-1`, kind: "calendar" as const, startAt, endAt, attendance: "physical" as const, endpoint: PLACE(ref, ref.length), mode: "walking" as const });
  const THEN = stop("first", local("14:00"), local("15:00"));
  const SHORT = stop("short", local("14:30"), local("15:10"));

  /** The report's example: stop 14:30-15:10, ready 15:05, 20-minute walk, arrives 15:25. */
  function chain(now: string) {
    const plan = resolveTravelPlan({ journeyRef: "day", journeyRevision: "1", now, grantRevision: "g", defaultMode: "walking",
      base: { ref: "home", source: "saved_base", sourceRevision: "h1", point: { kind: "coordinates", latitude: 41, longitude: -74 } }, device: null, predictedOrigin: null, corrections: [],
      commitments: [THEN, SHORT], buffers });
    const results = plan.legs.map((planned) => ({ legId: planned.id, provenance: planned.provenance, estimate: {
      durationSeconds: 1200, departureAt: planned.readyAt, arrivalAt: new Date(Date.parse(planned.readyAt) + 1_200_000).toISOString().replace(".000Z", "Z"),
      warnings: [], fallback: false, attribution: "Google Maps", observedAt: now, expiresAt: local("23:00") } }));
    return resolveTravelEvidence({ plan, results, collisionCandidates: [], buffers, now, expectedJourneyRevision: "1", expectedGrantRevision: "g", modelProjection: "disabled" });
  }
  const stops: DepartureStop[] = [
    { ref: "first", label: "Standup", startAt: THEN.startAt, endAt: THEN.endAt },
    { ref: "short", label: "Review", startAt: SHORT.startAt, endAt: SHORT.endAt },
  ];

  it("the evidence no longer claims a complete trip or a free-again time", () => {
    const evidence = chain(local("13:00"));
    const home = evidence.legs.at(-1)!;
    expect(home.estimate?.departureAt).toBe(local("15:15"));
    expect(evidence.legs[1]).toMatchObject({ late: true, estimate: { departureAt: local("15:05"), arrivalAt: local("15:25") } });
    expect(evidence.completeTrip).toBe(false);
    expect(evidence.finalAvailabilityAt).toBeNull();
  });

  it("the model states no leave time until the late trip has arrived, then offers one from now", () => {
    const evidence = chain(local("13:00"));
    const run = (time: string) => resolveDepartureModel({ evidence, stops, now: local(time), timezone: NY, arrivalBufferSeconds: 0, preparationSeconds: 0, pausedUntil: null });
    const before = run("14:40");
    expect(before.next).toMatchObject({ role: "onward", state: "late", phrase: "You may arrive late: leave by 3:05 PM · walking, arrive 3:25 PM." });
    expect(before.trips[1]).toMatchObject({ role: "return", state: "time_unknown", timeUnknownCause: "late_arrival", blockingRef: "short", leaveAt: null, arriveAt: null, action: "refresh", phrase: "Return time unknown." });
    // Past the old 15:15 departure, the late trip is still next and the return still has no time.
    expect(run("15:20").trips[1]?.state).toBe("time_unknown");
    const arrived = run("15:25");
    expect(arrived.next).toMatchObject({ role: "return", state: "late", lateBasis: "clock", arriveAt: local("15:45"), phrase: "If you haven't left yet, you'd be home about 3:45 PM." });
    expect(run("15:45")).toMatchObject({ state: "none" });
  });

  it("a late trip held up by an earlier late trip shows the carried arrival, never one already past", () => {
    const stop2 = (ref: string, start: string, end: string): DepartureStop => ({ ref, label: ref, startAt: local(start), endAt: local(end) });
    const first = timed(leg("outbound", null, "a"), local("10:00"), local("11:20"), { late: true });
    const second = timed(leg("onward", "a", "b"), local("11:10"), local("11:30"), { late: true });
    const legs = [first, second];
    const input = { stops: [stop2("a", "10:30", "11:00"), stop2("b", "11:15", "12:00")] };
    expect(model(local("11:10"), legs, input).trips[1]).toMatchObject({ state: "time_unknown", leaveAt: null });
    const { next } = model(local("11:35"), legs, input);
    expect(next).toMatchObject({ destinationRef: "b", lateBasis: "evidence", arriveAt: local("11:40"), phrase: "You may arrive late: arrive 11:40 AM." });
    expect(model(local("11:40"), legs, input).state).toBe("none");
  });

  it("a fractional clock does not crash the evidence or the model", () => {
    const now = "2026-11-02T13:50:12.345Z";
    const at = (seconds: number) => new Date(Date.parse(now) + seconds * 1000).toISOString();
    const base = { ref: "home", source: "saved_base" as const, sourceRevision: "h1", point: { kind: "coordinates" as const, latitude: 41, longitude: -74 } };
    const a = { ...stop("a", at(600), "2026-11-02T14:05:00Z"), endpoint: PLACE("a", 1) };
    const b = { ...stop("b", "2026-11-02T14:20:00Z", "2026-11-02T15:00:00Z"), endpoint: PLACE("b", 2) };
    const plan = resolveTravelPlan({ journeyRef: "day", journeyRevision: "1", now, grantRevision: "g", defaultMode: "walking", base, device: null, predictedOrigin: null, corrections: [], commitments: [a, b], buffers });
    // The first walk lands at a fractional instant, past when the next leg leaves.
    const results = plan.legs.map((planned, index) => {
      const duration = index === 0 ? 3600 : 600;
      const arrivalAt = new Date(Date.parse(planned.readyAt) + duration * 1000).toISOString();
      return { legId: planned.id, provenance: planned.provenance, estimate: { durationSeconds: duration, departureAt: planned.readyAt, arrivalAt, warnings: [], fallback: false, attribution: "Google Maps", observedAt: now, expiresAt: "2026-11-02T23:00:00Z" } };
    });
    const evidence = resolveTravelEvidence({ plan, results, collisionCandidates: [], buffers, now, expectedJourneyRevision: "1", expectedGrantRevision: "g", modelProjection: "disabled" });
    expect(evidence.legs.every((entry) => entry.state === "current")).toBe(true);
    expect(evidence.completeTrip).toBe(false);
    const result = resolveDepartureModel({ evidence, stops: [], now, timezone: NY, arrivalBufferSeconds: 0.5, preparationSeconds: 90.5, pausedUntil: null });
    expect(result.trips.map((trip) => trip.state)).toContain("time_unknown");
    const appears = resolveDepartureModel({ evidence: { legs: [missing(OUTBOUND, "unavailable", TRAVEL_LEG_OUTSIDE_WINDOW)], unknownLegs: [] }, stops: [DENTIST], now: local("08:00"), timezone: NY, arrivalBufferSeconds: 0.5, preparationSeconds: 0, pausedUntil: null });
    expect(appears.next?.state).toBe("appears_later");
  });

  it("a later stop with room absorbs the shortfall", () => {
    const stopRef = (ref: string, start: string, end: string): DepartureStop => ({ ref, label: ref, startAt: local(start), endAt: local(end) });
    const late = timed(leg("outbound", null, "a"), local("10:00"), local("11:20"), { late: true });
    const toB = timed(leg("onward", "a", "b"), local("11:10"), local("11:30"));
    const toC = timed(leg("onward", "b", "c"), local("13:00"), local("13:20"));
    const { trips } = model(local("09:00"), [late, toB, toC], { stops: [stopRef("a", "10:30", "11:00"), stopRef("b", "11:30", "12:00"), stopRef("c", "13:30", "14:00")] });
    expect(trips.map((trip) => trip.state)).toEqual(["late", "time_unknown", "upcoming"]);
    expect(trips[1]?.linePhrase).toBe("No leave time for the trip to b, because you may arrive late at a.");
  });
});

describe("dates and clocks", () => {
  it("shows a date only for a trip on another local date", () => {
    const tomorrow = timed(OUTBOUND, local("09:00", "2026-09-17"), local("09:30", "2026-09-17"));
    expect(model(local("12:00"), [tomorrow]).next?.phrase).toBe("Leave by Sep 17, 9:00 AM from Home · walking, arrive Sep 17, 9:30 AM.");
    expect(model(local("12:00"), [onTime()]).next?.phrase).not.toContain("Sep");
  });

  it("uses midnight as the day boundary, including for the arrival and the checked time", () => {
    const stops = [{ ...DENTIST, startAt: local("00:30", "2026-09-17"), endAt: local("01:30", "2026-09-17") }];
    const crossing = timed(OUTBOUND, local("23:50"), local("00:20", "2026-09-17"));
    expect(model(local("23:40"), [crossing], { stops }).next?.phrase).toBe("Leave in 10 minutes, by 11:50 PM from Home · walking, arrive Sep 17, 12:20 AM.");
    const after = timed(OUTBOUND, local("00:15", "2026-09-17"), local("00:25", "2026-09-17"), {}, local("00:01", "2026-09-17"));
    expect(model(local("23:59:59"), [after], { stops }).next?.leaveAt).toBe(local("00:15", "2026-09-17"));
    expect(model(local("00:05", "2026-09-17"), [after], { stops }).next?.phrase).toBe("Last estimate: leave by 12:15 AM · checked Sep 16, 8:00 AM.");
  });

  it("counts real minutes across the autumn clock change", () => {
    // November 1, 2026: 2:00 AM EDT falls back to 1:00 AM EST.
    const leave = "2026-11-01T06:30:00Z"; // 1:30 AM EST, the second 1:30.
    const stops = [{ ...DENTIST, startAt: "2026-11-01T08:00:00Z", endAt: "2026-11-01T09:00:00Z" }];
    const entry = timed(OUTBOUND, leave, "2026-11-01T07:00:00Z", {}, "2026-11-01T09:00:00Z");
    const first = model("2026-11-01T05:45:00Z", [entry], { stops }); // 1:45 AM EDT: the wall clock reads later than the leave time, yet 45 minutes remain.
    expect(first.next).toMatchObject({ state: "upcoming", minutesUntilLeave: 45 });
    expect(first.next?.phrase).toBe("Leave by 1:30 AM from Home · walking, arrive 2:00 AM.");
    expect(model("2026-11-01T06:10:00Z", [entry], { stops }).next).toMatchObject({ state: "soon", minutesUntilLeave: 20 });
  });

  it("counts real minutes across the spring clock change", () => {
    // March 8, 2026: 2:00 AM EST jumps to 3:00 AM EDT.
    const stops = [{ ...DENTIST, startAt: "2026-03-08T08:00:00Z", endAt: "2026-03-08T09:00:00Z" }];
    const entry = timed(OUTBOUND, "2026-03-08T07:10:00Z", "2026-03-08T07:40:00Z", {}, "2026-03-08T09:00:00Z");
    const result = model("2026-03-08T06:50:00Z", [entry], { stops }); // 1:50 AM EST.
    expect(result.next).toMatchObject({ state: "soon", minutesUntilLeave: 20 });
    expect(result.next?.phrase).toBe("Leave in 20 minutes, by 3:10 AM from Home · walking, arrive 3:40 AM.");
  });

  it("reads the same instants in other timezones", () => {
    expect(model("2026-09-16T16:00:00Z", [onTime()], { timezone: "Europe/London" }).next?.phrase).toBe("Leave by 6:55 PM from Home · walking, arrive 7:20 PM.");
    // Already September 17 in Tokyo at this moment, so the date drops off.
    expect(model("2026-09-16T16:00:00Z", [onTime()], { timezone: "Asia/Tokyo" }).next?.phrase).toBe("Leave by 2:55 AM from Home · walking, arrive 3:20 AM.");
    expect(model("2026-09-16T12:00:00Z", [onTime()], { timezone: "Asia/Tokyo" }).next?.phrase).toBe("Leave by Sep 17, 2:55 AM from Home · walking, arrive Sep 17, 3:20 AM.");
    expect(model("2026-09-16T16:00:00Z", [onTime()], { timezone: "Asia/Kolkata" }).next?.phrase).toBe("Leave by 11:25 PM from Home · walking, arrive 11:50 PM.");
  });

  it("formats noon and midnight", () => {
    const context = departurePhraseContext(local("12:00"), NY);
    expect(departureTimeLabel(local("12:00"), context)).toBe("12:00 PM");
    expect(departureTimeLabel(local("00:05"), context)).toBe("12:05 AM");
  });
});

describe("the phrase module", () => {
  it("holds Ticket 261's other lines", () => {
    const context = departurePhraseContext(local("12:00"), NY);
    expect(departureFreeAgainPhrase(local("18:45"), context)).toBe("Free again 6:45 PM.");
    expect(departureCheckedPhrase("Google Maps", local("08:00"), context)).toBe("Google Maps · checked 8:00 AM.");
  });

  it("calls the trip home by name in the line form, never your next stop", () => {
    const line = (entry: TravelResolvedLegEvidence, now = "08:00") => model(local(now), [entry]).next?.linePhrase;
    expect(line(missing(HOME, "unavailable", TRAVEL_LEG_OUTSIDE_WINDOW))).toBe("The leave time for the trip home appears by 12:40 PM.");
    expect(line(missing(HOME, "unavailable", TRAVEL_LEG_OUTSIDE_WINDOW), "13:00")).toBe("Refresh travel to get the leave time for the trip home.");
    expect(line(missing(HOME, "unavailable", "Route unavailable."))).toBe("No route found for the trip home.");
    expect(line(missing(HOME, "rejected_revision", "Journey or grant revision changed."))).toBe("The trip home changed.");
    expect(line(missing(HOME, "stale", "Route estimate expired."))).toBe("The estimate for the trip home expired.");
    expect(model(local("08:00"), [missing(HOME, "unavailable", TRAVEL_LEG_OUTSIDE_WINDOW)], { stops: [] }).next?.linePhrase).toBe("The leave time for the trip home appears by 12:40 PM.");
  });

  it("carries no weather advice and no internal terms", () => {
    const weather = { tableVersion: "weather-margin@1" as const, state: "margin" as const, conditions: ["thunderstorm" as const], marginSeconds: 900,
      suggestion: { insteadOf: "walking" as const, use: ["transit" as const, "driving" as const] }, departureAt: local("13:40"), arrivalAt: local("14:20") };
    const text = JSON.stringify(model(local("12:00"), [timed(OUTBOUND, local("13:55"), local("14:20"), { weather } as never)]).next?.phrase);
    expect(text).toContain("Leave by 1:40 PM");
    expect(text).not.toMatch(/consider|instead|thunder|outbound|onward|provider/i);
  });

  it("reads no clock, environment or browser", () => {
    for (const file of ["packages/core/src/resolvers/departure.resolver.ts", "packages/core/src/services/departure-phrases.ts"]) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/new Date|Date\.now|Temporal\.Now|process\.env|window\.|document\.|navigator\./);
    }
  });
});

describe("Ticket 261: a trip whose stop is missing from the input", () => {
  it("stays the next trip only until its local day ends", () => {
    const run = (now: string) => model(now, [missing(OUTBOUND, "unavailable", TRAVEL_LEG_OUTSIDE_WINDOW)], { stops: [] });
    expect(run(local("23:59")).next?.state).toBe("appears_later");
    expect(run(local("00:00", "2026-09-17"))).toMatchObject({ state: "none", next: null, trips: [] });
  });

  it("ends a trip the plan could not build with the day of the plan's routed legs", () => {
    const run = (now: string) => model(now, [onTime()], { stops: [], unknownLegs: [unknown("outbound", null, "lunch", "destination_unknown")] });
    expect(run(local("23:59")).next?.state).toBe("needs_place");
    expect(run(local("00:00", "2026-09-17")).next).toBeNull();
    const home = (now: string) => model(now, [onTime()], { stops: [], unknownLegs: [unknown("return", "lunch", null, "return_base_missing")] });
    expect(home(local("23:59")).next?.state).toBe("time_unknown");
    expect(home(local("00:00", "2026-09-17")).next).toBeNull();
  });
});

describe("Ticket 261: a plan with no routed legs", () => {
  it("drops a trip whose stop is missing, before and after midnight and days later", () => {
    const run = (now: string) => model(now, [], { stops: [], unknownLegs: [unknown("outbound", null, "gone", "destination_unknown")] });
    for (const now of [local("20:00"), local("23:59"), local("00:00", "2026-09-17"), local("12:00", "2026-09-17"), local("12:00", "2026-09-20")]) {
      expect(run(now)).toMatchObject({ state: "none", next: null, trips: [] });
    }
  });

  it("keeps a trip whose stop is in the input", () => {
    expect(model(local("12:00"), [], { unknownLegs: [unknown("outbound", null, "dentist", "destination_unknown")] }).next?.state).toBe("needs_place");
  });
});

describe("Ticket 261: departure stops", () => {
  const estimate = { kind: "known", seconds: 1800, durationLabel: "30 minutes", sampleCount: 3, lookbackDays: 90, provenance: "completed_stopped_occurrence_mean" } as const;

  it("ends a range Behavior at its end time, and an exact one after its known duration", () => {
    expect(behaviorEndAt({ localDate: "2026-09-16", scheduledFor: local("09:00"), scheduleKind: "range", scheduleEndTime: "10:15:00" }, undefined, NY)).toBe(local("10:15"));
    expect(behaviorEndAt({ localDate: "2026-09-16", scheduledFor: local("09:00"), scheduleKind: "exact", scheduleEndTime: null }, estimate, NY)).toBe(local("09:30"));
    expect(behaviorEndAt({ localDate: "2026-09-16", scheduledFor: local("09:00"), scheduleKind: "exact" }, undefined, NY)).toBeNull();
    // A range gives its own end, never the duration estimate.
    expect(behaviorEndAt({ localDate: "2026-09-16", scheduledFor: local("09:00"), scheduleKind: "range", scheduleEndTime: null }, estimate, NY)).toBeNull();
    expect(behaviorEndAt({ localDate: "2026-09-16", scheduledFor: local("09:00"), scheduleKind: "range", scheduleEndTime: "not a time" }, undefined, NY)).toBeNull();
  });

  it("is the one rule the hosted route refresh uses", () => {
    const service = readFileSync("lib/services/travel-route-refresh.service.ts", "utf8");
    expect(service).toContain("@cadence/core/services/departure-stops");
    expect(service).not.toMatch(/schedule_kind === "range"/);
  });

  it("builds stops from timed Calendar events and Behavior Occurrences", () => {
    const timedEvent = { id: "event", kind: "timed", title: "", startAt: local("12:00"), endAt: local("13:00"), endUnspecified: false } as never;
    const openEnded = { id: "open", kind: "timed", title: "Call", startAt: local("16:00"), endAt: local("17:00"), endUnspecified: true } as never;
    const allDay = { id: "all-day", kind: "all_day", title: "Offsite", startLocalDate: "2026-09-16", endLocalDate: "2026-09-17" } as never;
    const stops = departureStops({ events: [timedEvent, openEnded, allDay], timezone: NY, durationEstimates: { walk: estimate },
      occurrences: [{ id: "occurrence", behaviorId: "walk", title: "Walk", localDate: "2026-09-16", scheduledFor: local("09:00"), scheduleKind: "exact" }] });
    expect(stops).toEqual([
      { ref: "event", label: "Untitled event", startAt: local("12:00"), endAt: local("13:00") },
      { ref: "open", label: "Call", startAt: local("16:00"), endAt: null },
      { ref: "occurrence", label: "Walk", startAt: local("09:00"), endAt: local("09:30") },
    ]);
  });
});

describe("Ticket 261 phrases", () => {
  const context = departurePhraseContext(local("08:00"), NY);
  it("words the weather margin, the brief footer and the overlap label", () => {
    expect(departureWeatherMarginPhrase(15, ["thunderstorm", "heavy_rain"])).toBe("15 min added for thunderstorms.");
    expect(departureWeatherMarginPhrase(0, ["rain"])).toBe("");
    expect(departureBriefFooterPhrase("Google Maps", local("09:00"), context)).toBe("Calculated by Cadence · Google Maps · 9:00 AM.");
    expect(departureBriefFooterPhrase(null, local("09:00"), context)).toBe("Calculated by Cadence · 9:00 AM.");
    expect(departureOverlapPhrase({ home: false, destinationLabel: "Dentist", startAt: local("13:55"), endAt: local("14:20") }, context))
      .toBe("Overlaps your trip to Dentist (1:55 PM–2:20 PM)");
    expect(departureOverlapPhrase({ home: true, destinationLabel: null, startAt: local("15:40"), endAt: local("16:10") }, context))
      .toBe("Overlaps your trip home (3:40 PM–4:10 PM)");
    expect(eventStateWord("tentative")).toBe("Tentative");
    expect(eventStateWord("cancelled")).toBe("Cancelled");
    expect(eventStateWord("confirmed")).toBeNull();
  });
});
