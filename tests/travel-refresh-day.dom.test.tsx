// @vitest-environment jsdom
/**
 * Ticket 268: a whole day of the real travel hook, with every request routed through the real
 * hosted service (`refreshTravelRoutes`). Provider, Supabase and Calendar reads are mocked as in
 * tests/travel-route-refresh.service.test.ts. The counts here are the ones docs/COSTS.md records.
 * Adapted from the Wave 2 verifier's probe.
 */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Temporal } from "@js-temporal/polyfill";

const mocks = vi.hoisted(() => ({
  source: vi.fn(), calendar: vi.fn(), events: vi.fn(), spend: vi.fn(), readPlaces: vi.fn(), writePlaces: vi.fn(),
  occurrences: vi.fn(), behaviors: vi.fn(), timezone: vi.fn(), geocode: vi.fn(), route: vi.fn(),
  historySessions: vi.fn(), weather: vi.fn(), monthSpend: vi.fn(),
  outlook: vi.fn(), outlookEvents: vi.fn(), icloud: vi.fn(), icloudEvents: vi.fn(),
}));
vi.mock("@/lib/services/travel-settings.service", () => ({ readTravelRouteSource: mocks.source }));
vi.mock("@/lib/services/google-calendar.service", () => ({ getCalendarConnection: mocks.calendar, getCalendarEvents: mocks.events }));
// Ticket 283: Outlook and iCloud are disconnected unless a test connects them.
vi.mock("@/lib/services/outlook-calendar.service", () => ({ getOutlookCalendarConnection: mocks.outlook, getOutlookCalendarEvents: mocks.outlookEvents }));
vi.mock("@/lib/services/icloud-calendar.service", () => ({ getIcloudCalendarConnection: mocks.icloud, getIcloudCalendarEvents: mocks.icloudEvents }));
vi.mock("@/lib/db/travelSpend.repo", async (load) => ({ ...(await load<Record<string, unknown>>()), reserveTravelProviderSpend: mocks.spend, readTravelMonthSpend: mocks.monthSpend }));
vi.mock("@/lib/db/travelPlaceCache.repo", () => ({ readTravelPlaceCache: mocks.readPlaces, writeTravelPlaceCache: mocks.writePlaces }));
vi.mock("@/lib/db/occurrences.repo", () => ({ listOccurrencesBetweenLocalDates: mocks.occurrences }));
vi.mock("@/lib/db/timeSessions.repo", () => ({ listTimeSessionHistory: mocks.historySessions }));
vi.mock("@/lib/db/behaviors.repo", () => ({ listUserBehaviors: mocks.behaviors, getProfileTimezone: mocks.timezone }));
vi.mock("@/lib/services/travel-provider", async (load) => ({ ...(await load<Record<string, unknown>>()), geocodeGoogleAddress: mocks.geocode }));
vi.mock("@/lib/services/weather-forecast.service", () => ({ readTravelWeather: mocks.weather }));
vi.mock("@/lib/services/travel-routing.service", async (load) => ({ ...(await load<Record<string, unknown>>()), routeTravelLegs: mocks.route }));

import { refreshTravelRoutes } from "@/lib/services/travel-route-refresh.service";
import { TravelRoutingError } from "@/lib/services/travel-routing.service";
import { resetTravelViewCacheForTest, useTravelContext, TravelClientError, type TravelClient, type TravelState, type TravelRoutesInput } from "@/lib/ui/travel";
import { resolveDepartureModel } from "@cadence/core/resolvers/departure.resolver";

const SECRET = "s".repeat(64);
type Ev = { id: string; start: string; end: string; location: string; etag?: string };
const world = {
  events: [] as Ev[],
  device: null as null | { latitude: number; longitude: number; accuracyMeters: number },
  fail: false,
  quota: false,
  log: [] as { at: string; kind: string; legs: number; roles: string; providerCalls: number }[],
};
const caller = { client: {} as never, user: { id: "owner" } as never };
const config = { cleared: true, apiKey: "key" };
const source = { settings: { enabled: true, mode: "walking" as const, routingConsentAt: "2026-09-20T00:00:00Z", baseLocationText: "1 Base St", navigationPreference: "google_maps" as const },
  settingsRevision: "settings-1", behaviors: [] };
const settings = { enabled: true, mode: "walking" as const, baseLocationText: "1 Base St", navigationPreference: "google_maps" as const,
  routingConsentAt: "2026-09-20T00:00:00Z", onboardingCompletedAt: null, updatedAt: "settings-1" };

function calendarEvents() {
  return world.events.map((e) => ({ id: e.id, kind: "timed", state: "confirmed", currentUserResponse: "accepted", startAt: e.start, endAt: e.end,
    endUnspecified: false, location: e.location, conference: null, revision: { providerEtag: e.etag ?? `etag-${e.id}`, providerUpdatedAt: null } }));
}
let routedThisCall = 0;
beforeEach(() => {
  vi.clearAllMocks();
  world.events = []; world.device = null; world.fail = false; world.quota = false; world.log = [];
  mocks.source.mockResolvedValue(source);
  mocks.calendar.mockResolvedValue({ status: "connected", generation: 1, selectionRevision: 1 });
  const disconnected = { status: "disconnected", generation: 0, selectionRevision: 0, preferences: { selectedSourceIds: [] } };
  mocks.outlook.mockResolvedValue(disconnected);
  mocks.icloud.mockResolvedValue(disconnected);
  mocks.events.mockImplementation(async () => ({ requestedRange: { timezone: "America/New_York" }, events: calendarEvents() }));
  mocks.spend.mockResolvedValue({ allowed: true, retryAfterSeconds: 0, resetsAt: null });
  mocks.readPlaces.mockResolvedValue([]); mocks.writePlaces.mockResolvedValue(undefined);
  mocks.geocode.mockImplementation(async (text: string) => ({ kind: "resolved", point: { kind: "place_id", placeId: `place:${text}` } }));
  mocks.occurrences.mockResolvedValue([]); mocks.behaviors.mockResolvedValue([]); mocks.historySessions.mockResolvedValue([]);
  mocks.timezone.mockResolvedValue("America/New_York"); mocks.weather.mockResolvedValue(null); mocks.monthSpend.mockResolvedValue(100_000);
  mocks.route.mockImplementation(async ({ routes, now }: { routes: { id: string; request: { timing: { kind: string; at: string } } }[]; now: Temporal.Instant }) => {
    routedThisCall += routes.length;
    return routes.map((route) => {
      const dur = 20 * 60;
      const t = route.request.timing;
      const at = Temporal.Instant.from(t.at);
      const departureAt = t.kind === "arrive_by" ? at.subtract({ seconds: dur }) : at;
      const arrivalAt = departureAt.add({ seconds: dur });
      return { id: route.id, estimate: { durationSeconds: dur, departureAt: departureAt.toString(), arrivalAt: arrivalAt.toString(), warnings: ["Provider warning text"],
        fallback: false, attribution: "Google Maps", observedAt: now.toString(), expiresAt: now.add({ minutes: 5 }).toString() }, failure: null };
    });
  });
  resetTravelViewCacheForTest();
  localEvents = null;
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

const routes = vi.fn(async (input: TravelRoutesInput) => {
  if (world.fail) throw new TravelClientError("provider_unavailable");
  if (world.quota) throw new TravelClientError("quota_exceeded", 60, "2026-10-01T04:00:00Z");
  routedThisCall = 0;
  const now = Temporal.Instant.fromEpochMilliseconds(Date.now());
  try {
    const result = await refreshTravelRoutes(caller, JSON.parse(JSON.stringify(input)), config as never, now, undefined, SECRET);
    const legs = result.evidence?.legs.filter((l) => l.estimate && l.estimate.observedAt === now.toString()).length ?? 0;
    world.log.push({ at: new Date().toISOString(), kind: input.trips ? "trip" : "day", legs, providerCalls: routedThisCall,
      roles: input.trips ? input.trips.map((t) => t.role).join("+") : "day" });
    return JSON.parse(JSON.stringify(result));
  } catch (error) {
    if (error instanceof TravelRoutingError) throw new TravelClientError(error.failure.code === "quota_exceeded" ? "quota_exceeded" : error.failure.code === "context_changed" ? "context_changed" : "provider_unavailable", null, error.failure.resetsAt ?? null);
    throw error;
  }
});
const client: TravelClient = {
  settings: { load: async () => settings as never, save: async () => settings as never },
  configured: async () => true,
  readLocation: async () => world.device ? { state: "available" as const, ...world.device, sampledAt: Date.now() } as never : { state: "denied" as const },
  routes: routes as never,
};

const capture = vi.fn<(state: TravelState) => void>();
const current = () => capture.mock.lastCall![0];
function Probe(props: { sourceKey: string; sourceReady?: boolean; accountId?: string }) {
  const state = useTravelContext({ enabled: true, accountId: props.accountId ?? "owner", localDate: "2026-09-21", sourceKey: props.sourceKey, client, timezone: "America/New_York", sourceReady: props.sourceReady,
    stopRevisions: Object.fromEntries((localEvents ?? world.events).map((event) => [event.id, JSON.stringify([event.start, event.end, event.location, event.etag ?? null])])) });
  capture(state);
  return createElement("p", null, "x");
}
/** The Timeline's own Calendar list, when it lags the hosted read. Null: the same events as hosted. */
let localEvents: Ev[] | null = null;
const keyOf = () => JSON.stringify(localEvents ?? world.events);
let focused = true;
async function start(at: string) {
  vi.useFakeTimers({ now: new Date(at), toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  focused = true;
  vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(document, "hidden", { configurable: true, get: () => !focusedVisible });
  routes.mockClear();
  const host = document.createElement("div"); document.body.append(host);
  let root: Root = createRoot(host);
  let props: { sourceKey: string; sourceReady?: boolean } = { sourceKey: keyOf() };
  const render = (p: Partial<typeof props> = {}) => { props = { ...props, sourceKey: keyOf(), ...p }; return act(() => root.render(createElement(Probe, props))); };
  await render(); await advance(400);
  return {
    render,
    reload: async (p: Partial<typeof props> = {}) => { await act(() => root.unmount()); resetTravelViewCacheForTest({ keepSession: true }); root = createRoot(host); await render(p); await advance(400); },
    remount: async () => { await act(() => root.unmount()); root = createRoot(host); await render(); await advance(400); },
    done: async () => { await act(() => root.unmount()); host.remove(); },
  };
}
let focusedVisible = true;
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const advanceTo = async (at: string) => { const ms = Date.parse(at) - Date.now(); if (ms > 0) await advance(ms); };
const focus = async () => { focused = true; focusedVisible = true; await act(async () => { window.dispatchEvent(new Event("focus")); await vi.advanceTimersByTimeAsync(400); }); };
const et = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return new Date(Date.UTC(2026, 8, 21, h! + 4, m!)).toISOString(); };
const summary = () => ({ requests: world.log.length, legs: world.log.reduce((s, l) => s + l.legs, 0), providerCalls: world.log.reduce((s, l) => s + l.providerCalls, 0),
  calls: world.log.map((l) => `${l.at.slice(11, 16)}Z ${l.roles} legs=${l.legs} calls=${l.providerCalls}`) });

/** Measured through the real service; docs/COSTS.md records the same figures. */
const HEAVY = { requests: 10, legs: 14 };
const MOVING = { requests: 5, legs: 7 };
const TYPICAL: Ev[] = [
  { id: "dentist", start: et("9:00"), end: et("10:00"), location: "2 Dentist St" },
  { id: "gym", start: et("13:00"), end: et("14:00"), location: "3 Gym St" },
];
const model = () => resolveDepartureModel({ evidence: current().view?.evidence ?? null,
  stops: world.events.map((e) => ({ ref: e.id, label: e.id, startAt: e.start, endAt: e.end })),
  now: new Date().toISOString(), timezone: "America/New_York", arrivalBufferSeconds: 0, preparationSeconds: 0, pausedUntil: null });

it("typical day: one whole-day pass and one or two refreshes per trip, through the real service", async () => {
  world.events = [...TYPICAL];
  const d = await start(et("7:00"));
  for (let h = 8; h <= 22; h++) {
    await advanceTo(et(`${h}:00`)); await focus();
    if (h === 11) await d.remount();
    if (h === 15) await d.reload();
  }
  const result = summary();
  // 7:00 AM whole day; 8:05 AM dentist (30 min); 9:35 AM gym (3 h); 11:00 AM home (3 h); 12:05 PM gym, now from Home (30 min); 1:30 PM home (30 min).
  expect(world.log.map((entry) => entry.roles)).toEqual(["day", "outbound", "onward", "return", "outbound", "return"]);
  expect({ requests: result.requests, legs: result.legs }).toEqual({ requests: 6, legs: 8 });
  await d.done();
});

it("heavy day: four stops, focus every 15 minutes", async () => {
  world.events = [
    { id: "a", start: et("9:00"), end: et("10:00"), location: "A St" }, { id: "b", start: et("11:00"), end: et("12:00"), location: "B St" },
    { id: "c", start: et("14:00"), end: et("15:00"), location: "C St" }, { id: "e", start: et("17:00"), end: et("18:00"), location: "E St" },
  ];
  const d = await start(et("6:30"));
  for (let m = 6 * 60 + 45; m <= 23 * 60; m += 15) { await advanceTo(et(`${Math.floor(m / 60)}:${m % 60}`)); await focus(); }
  const result = summary();
  expect({ requests: result.requests, legs: result.legs }).toEqual({ requests: HEAVY.requests, legs: HEAVY.legs });
  await d.done();
});

it("another trip's refresh never takes away a known leave time (R1)", async () => {
  // An onward trip becomes outbound once the dentist ends, and an outbound leg is ready at request time.
  world.events = [...TYPICAL];
  const d = await start(et("7:00"));
  for (const at of ["9:55", "10:05", "10:30", "10:59", "11:00", "11:01", "12:00"]) {
    await advanceTo(et(at)); await focus();
    const gym = model().trips.find((trip) => trip.destinationRef === "gym");
    expect(gym?.leaveAt, at).toBe("2026-09-21T16:35:00Z");
  }
  await d.done();
  // A dentist trip before a close gym trip: the trip home's refresh keeps the dentist's time.
  resetTravelViewCacheForTest(); world.log = [];
  world.events = [
    { id: "dentist", start: et("11:30"), end: et("12:20"), location: "2 Dentist St" },
    { id: "gym", start: et("13:20"), end: et("14:00"), location: "3 Gym St" },
  ];
  const e = await start(et("7:00"));
  for (let m = 7 * 60 + 30; m <= 11 * 60; m += 10) {
    await advanceTo(et(`${Math.floor(m / 60)}:${m % 60}`)); await focus();
    const dentist = model().trips.find((trip) => trip.destinationRef === "dentist");
    expect(dentist?.leaveAt, `${m}`).toBe("2026-09-21T15:05:00Z");
  }
  await e.done();
});

it("movement refreshes only the next trip from the device, at most every 10 minutes (R3)", async () => {
  world.events = [...TYPICAL]; world.device = { latitude: 40.7, longitude: -74, accuracyMeters: 20 };
  const d = await start(et("7:00"));
  for (let i = 1; i <= 45; i++) { world.device = { latitude: 40.7 + i * 0.009, longitude: -74, accuracyMeters: 20 }; await advance(60_000); }
  const result = summary();
  expect(result.requests).toBeLessThanOrEqual(5);
  expect({ requests: result.requests, legs: result.legs }).toEqual({ requests: MOVING.requests, legs: MOVING.legs });
  expect(world.log.slice(1).every((entry) => entry.roles === "outbound" && entry.legs === 1)).toBe(true);
  await d.done();
});

it("at 80% of the ceiling, a Calendar change keeps last estimates and Refresh travel (R2)", async () => {
  world.events = [...TYPICAL];
  mocks.monthSpend.mockResolvedValue(4_100_000);
  const d = await start(et("7:00"));
  world.events = [...TYPICAL, { id: "lunch", start: et("12:00"), end: et("12:30"), location: "9 Lunch St" }];
  await d.render(); await advance(400); await focus();
  expect(world.log).toHaveLength(1);
  expect(current().stale).toBe(true);
  expect(current().resumesAt).toBeNull();
  expect(model().trips.filter((trip) => trip.leaveAt).map((trip) => trip.freshness)).toEqual(["last_estimate", "last_estimate", "last_estimate"]);
  await act(async () => { current().refresh(); await vi.advanceTimersByTimeAsync(400); });
  expect(world.log).toHaveLength(2);
  expect(model().trips.some((trip) => trip.destinationRef === "lunch" && trip.leaveAt)).toBe(true);
  await d.done();
});

it("a failed source-change request keeps last estimates, marked", async () => {
  world.events = [...TYPICAL];
  const d = await start(et("7:00"));
  world.fail = true;
  world.events = [TYPICAL[0]!, { ...TYPICAL[1]!, etag: "moved" }];
  await d.render(); await advance(400);
  expect(current().message).toBe("Travel estimates are unavailable right now. Tracking and Calendar still work.");
  // The Gym event's revision changed, so its trips are withdrawn; the dentist trip keeps its last estimate.
  expect(model().trips.map((trip) => [trip.destinationRef, trip.state === "trip_changed" ? "changed" : trip.freshness]))
    .toEqual([["dentist", "last_estimate"], ["gym", "changed"], [null, "changed"]]);
  await d.done();
});

describe("a kept view withdraws trips whose stop changed (R5)", () => {
  const trips = () => model().trips.map((trip) => [trip.role, trip.destinationRef ?? trip.originRef, trip.state === "trip_changed" ? "changed" : trip.freshness]);
  it("an event moved at 80% of the ceiling", async () => {
    world.events = [...TYPICAL];
    mocks.monthSpend.mockResolvedValue(4_100_000);
    const d = await start(et("7:00"));
    world.events = [{ ...TYPICAL[0]!, start: et("11:00"), end: et("12:00") }, TYPICAL[1]!];
    await d.render(); await advance(400); await focus();
    expect(world.log).toHaveLength(1);
    // The dentist trip and the trip from the dentist changed; the trip home keeps its last estimate.
    expect(trips()).toEqual([["outbound", "dentist", "changed"], ["onward", "gym", "changed"], ["return", "gym", "last_estimate"]]);
    expect(model().trips[0]).toMatchObject({ action: "refresh", leaveAt: null });
    expect(current().resumesAt).toBeNull();
    await d.done();
  });
  it("an event moved after a failed request", async () => {
    world.events = [...TYPICAL];
    const d = await start(et("7:00"));
    world.fail = true;
    world.events = [TYPICAL[0]!, { ...TYPICAL[1]!, start: et("15:00"), end: et("16:00") }];
    await d.render(); await advance(400);
    expect(current().message).toBe("Travel estimates are unavailable right now. Tracking and Calendar still work.");
    expect(trips()).toEqual([["outbound", "dentist", "last_estimate"], ["onward", "gym", "changed"], ["return", "gym", "changed"]]);
    await d.done();
  });
  it("a cancelled event, while an unchanged one keeps its last estimate", async () => {
    world.events = [...TYPICAL];
    mocks.monthSpend.mockResolvedValue(4_100_000);
    const d = await start(et("7:00"));
    world.events = [TYPICAL[0]!];
    await d.render(); await advance(400);
    expect(current().view!.evidence!.legs.map((entry) => [entry.leg.role, entry.state, !!entry.estimate]))
      .toEqual([["outbound", "current", true], ["onward", "rejected_revision", false], ["return", "rejected_revision", false]]);
    expect(model().trips[0]).toMatchObject({ destinationRef: "dentist", freshness: "last_estimate", leaveAt: "2026-09-21T12:35:00Z" });
    await d.done();
  });
});

describe("a reload after a source change keeps the kept view (R6)", () => {
  const trips = () => model().trips.map((trip) => [trip.role, trip.state === "trip_changed" ? "changed" : trip.freshness]);
  const moved = () => [TYPICAL[0]!, { ...TYPICAL[1]!, start: et("15:00"), end: et("16:00") }];
  const expectKept = () => {
    // The Gym moved: the trip to it and the trip home from it changed; the dentist trip keeps its last estimate.
    expect(trips()).toEqual([["outbound", "last_estimate"], ["onward", "changed"], ["return", "changed"]]);
    expect(model().trips[0]).toMatchObject({ destinationRef: "dentist", leaveAt: "2026-09-21T12:35:00Z" });
  };
  it("at 80% of the ceiling, with Refresh travel", async () => {
    world.events = [...TYPICAL];
    mocks.monthSpend.mockResolvedValue(4_100_000);
    const d = await start(et("7:00"));
    world.events = moved();
    await d.render(); await advance(400);
    await d.reload();
    expect(world.log).toHaveLength(1);
    expectKept();
    expect(current().resumesAt).toBeNull();
    expect(current().view?.evidence).toBeTruthy();
    // A cancelled stop's trip has no title to name.
    world.events = [TYPICAL[0]!];
    await d.reload();
    expect(model().trips.map((trip) => trip.linePhrase)).toContain("A planned trip changed.");
    await d.done();
  });
  it("after a failed request, with Refresh travel", async () => {
    world.events = [...TYPICAL];
    const d = await start(et("7:00"));
    world.fail = true; world.events = moved();
    await d.render(); await advance(400);
    await d.reload();
    expectKept();
    expect(current().message).toBe("Travel estimates are unavailable right now. Tracking and Calendar still work.");
    expect(current().resumesAt).toBeNull();
    await d.done();
  });
  it("on the quota path", async () => {
    world.events = [...TYPICAL];
    const d = await start(et("7:00"));
    world.quota = true; world.events = moved();
    await d.render(); await advance(400);
    await d.reload();
    expectKept();
    expect(current().resumesAt).toBe("2026-10-01T04:00:00Z");
    await d.done();
  });
});

describe("a Calendar list that catches up with the hosted read (Mac follow-up after 0.1.9)", () => {
  const late: Ev = { id: "late", start: et("18:00"), end: et("18:30"), location: "7 Late St" };
  it("sends no new request when the only new stop is one the last response already routed", async () => {
    // The hosted route read the new event before this device's Calendar list did.
    world.events = [...TYPICAL, late]; localEvents = [...TYPICAL];
    const d = await start(et("7:00"));
    expect(world.log.map((entry) => entry.roles)).toEqual(["day"]);
    const leaveAt = model().trips.find((trip) => trip.destinationRef === "late")?.leaveAt;
    expect(leaveAt).toBeTruthy();
    localEvents = null;
    await d.render(); await advance(400); await focus();
    expect(world.log.map((entry) => entry.roles)).toEqual(["day"]);
    expect(current().stale).toBe(false);
    expect(model().trips.find((trip) => trip.destinationRef === "late")?.leaveAt).toBe(leaveAt);
    // A reload keeps the adopted view too.
    await d.reload();
    expect(world.log.map((entry) => entry.roles)).toEqual(["day"]);
    expect(model().trips.find((trip) => trip.destinationRef === "late")?.leaveAt).toBe(leaveAt);
    await d.done();
  });
  it("still asks again when a new stop is one the last response did not route", async () => {
    world.events = [...TYPICAL];
    const d = await start(et("7:00"));
    world.events = [...TYPICAL, late];
    await d.render(); await advance(400); await focus();
    expect(world.log.map((entry) => entry.roles)).toEqual(["day", "day"]);
    await d.done();
  });
  it("still asks again when a known stop also changed", async () => {
    world.events = [...TYPICAL, late]; localEvents = [...TYPICAL];
    const d = await start(et("7:00"));
    const moved = { ...TYPICAL[1]!, start: et("13:30") };
    world.events = [TYPICAL[0]!, moved, late]; localEvents = null;
    await d.render(); await advance(400); await focus();
    expect(world.log.map((entry) => entry.roles)).toEqual(["day", "day"]);
    await d.done();
  });
});
