import { createHash } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  source: vi.fn(), calendar: vi.fn(), events: vi.fn(), spend: vi.fn(), readPlaces: vi.fn(), writePlaces: vi.fn(),
  occurrences: vi.fn(), behaviors: vi.fn(), timezone: vi.fn(), geocode: vi.fn(), route: vi.fn(),
  historySessions: vi.fn(), weather: vi.fn(),
}));

vi.mock("@/lib/services/travel-settings.service", () => ({ readTravelRouteSource: mocks.source }));
vi.mock("@/lib/services/google-calendar.service", () => ({ getCalendarConnection: mocks.calendar, getCalendarEvents: mocks.events }));
vi.mock("@/lib/db/travelSpend.repo", () => ({ reserveTravelProviderSpend: mocks.spend }));
vi.mock("@/lib/db/travelPlaceCache.repo", () => ({ readTravelPlaceCache: mocks.readPlaces, writeTravelPlaceCache: mocks.writePlaces }));
vi.mock("@/lib/db/occurrences.repo", () => ({ listOccurrencesBetweenLocalDates: mocks.occurrences }));
vi.mock("@/lib/db/timeSessions.repo", () => ({ listTimeSessionHistory: mocks.historySessions }));
vi.mock("@/lib/db/behaviors.repo", () => ({ listUserBehaviors: mocks.behaviors, getProfileTimezone: mocks.timezone }));
vi.mock("@/lib/services/travel-provider", async (load) => ({
  ...(await load<typeof import("@/lib/services/travel-provider")>()),
  geocodeGoogleAddress: mocks.geocode,
}));
vi.mock("@/lib/services/weather-forecast.service", () => ({ readTravelWeather: mocks.weather }));
vi.mock("@/lib/services/travel-routing.service", async (load) => ({
  ...(await load<typeof import("@/lib/services/travel-routing.service")>()),
  routeTravelLegs: mocks.route,
}));

import { refreshTravelRoutes } from "@/lib/services/travel-route-refresh.service";
import { verifyTravelConclusionsToken } from "@/lib/services/travel-conclusions-token";
import { travelPlaceKey } from "@cadence/core/services/travel-place-key";

const now = Temporal.Instant.from("2026-09-22T08:00:00Z");
const source = {
  settings: { enabled: true, mode: "walking" as const, routingConsentAt: "2026-09-20T00:00:00Z", baseLocationText: "1 Base St", navigationPreference: "google_maps" as const },
  settingsRevision: "settings-1", behaviors: [
    { id: "behavior-1", whereKind: "place" as const, locationText: "2 Habit St", updatedAt: "2026-09-20T00:00:00Z" },
    { id: "behavior-2", whereKind: null, locationText: null, updatedAt: "2026-09-20T00:00:00Z" },
  ],
};
const caller = { client: {} as never, user: { id: "owner" } as never };
const day = { startLocalDate: "2026-09-22", endLocalDate: "2026-09-22" };
const config = { cleared: true, apiKey: "key" };
const keyOf = (text: string) => createHash("sha256").update(text.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase()).digest("base64url");
const estimate = { durationSeconds: 600, departureAt: "2026-09-22T09:50:00Z", arrivalAt: "2026-09-22T10:00:00Z", warnings: [], fallback: false, attribution: "Google Maps", observedAt: now.toString(), expiresAt: "2026-09-22T08:05:00Z" };
const routeAll = async ({ routes }: { routes: { id: string }[] }) => routes.map((route) => ({ id: route.id, estimate, failure: null }));
const occurrence = (id: string, behaviorId: string, scheduledFor: string) => ({
  id, behavior_id: behaviorId, local_date: "2026-09-22", scheduled_for: scheduledFor,
  schedule_kind: "exact", schedule_end_time: null, updated_at: "2026-09-20T00:00:00Z", status: "unresolved",
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.spend.mockResolvedValue({ allowed: true, retryAfterSeconds: 0, resetsAt: null });
  mocks.readPlaces.mockResolvedValue([]);
  mocks.writePlaces.mockResolvedValue(undefined);
  mocks.geocode.mockImplementation(async (text: string) => ({ kind: "resolved", point: { kind: "place_id", placeId: `place:${text}` } }));
  mocks.route.mockImplementation(routeAll);
  mocks.historySessions.mockResolvedValue([]);
  mocks.weather.mockResolvedValue(null);
});

const located = (scheduledFor = "2026-09-22T10:00:00Z") => {
  mocks.source.mockResolvedValue(source);
  mocks.calendar.mockResolvedValue({ status: "disconnected", generation: 0, selectionRevision: 0 });
  mocks.timezone.mockResolvedValue("America/New_York");
  mocks.behaviors.mockResolvedValue([{ id: "behavior-1", default_duration_minutes: 30 }]);
  mocks.occurrences.mockImplementation(async (_client: unknown, _userId: unknown, start: string) => start === "2026-09-22"
    ? [occurrence("occurrence-1", "behavior-1", scheduledFor)]
    : []);
};

describe("refreshTravelRoutes", () => {
  it("looks up only the bounded commitments and the base, behind one reservation", async () => {
    const behaviors = Array.from({ length: 9 }, (_, index) => ({ id: `b${index}`, whereKind: "place" as const, locationText: `${index} Test St`, updatedAt: "revision" }));
    mocks.source.mockResolvedValue({ ...source, behaviors });
    mocks.calendar.mockResolvedValue({ status: "connected", generation: 1, selectionRevision: 1 });
    mocks.events.mockResolvedValue({ requestedRange: { timezone: "America/New_York" }, events: Array.from({ length: 9 }, (_, index) => ({
      id: `event${index}`, kind: "timed", state: "confirmed", currentUserResponse: "accepted",
      startAt: "2026-09-22T10:00:00Z", endAt: "2026-09-22T10:30:00Z",
      endUnspecified: false, location: `${index} Calendar St`, conference: null,
      revision: { providerEtag: `revision${index}`, providerUpdatedAt: null },
    })) });
    mocks.behaviors.mockResolvedValue(behaviors.map(({ id }) => ({ id, default_duration_minutes: 30 })));
    mocks.occurrences.mockResolvedValue(behaviors.map(({ id }) => ({ ...occurrence(`o${id}`, id, "2026-09-22T11:00:00Z"), updated_at: "revision" })));

    await refreshTravelRoutes(caller, day, config, now);

    // Eight routable Calendar commitments and the base; the ninth commitment is the unrouted boundary.
    expect(mocks.geocode).toHaveBeenCalledTimes(9);
    for (const [, options] of mocks.geocode.mock.calls) expect(options.maxRetries).toBe(0);
    expect(mocks.spend).toHaveBeenCalledOnce();
    expect(mocks.spend).toHaveBeenCalledWith(caller.client, 45_000);
    expect(mocks.spend.mock.invocationCallOrder[0]).toBeLessThan(mocks.geocode.mock.invocationCallOrder[0]!);
    // Sources: initial read, one fence before the first paid call, one before returning.
    expect(mocks.source).toHaveBeenCalledTimes(3);
    expect(mocks.events).toHaveBeenCalledTimes(2);
  });

  it("does not reserve spend or call the provider when nothing is geocodable", async () => {
    located();
    mocks.source.mockResolvedValue({ ...source, settings: { ...source.settings, baseLocationText: null }, behaviors: [{ id: "behavior-1", whereKind: null, locationText: null, updatedAt: "2026-09-20T00:00:00Z" }] });
    const result = await refreshTravelRoutes(caller, day, config, now);
    expect(result.evidence).not.toBeNull();
    expect(mocks.spend).not.toHaveBeenCalled();
    expect(mocks.geocode).not.toHaveBeenCalled();
    expect(mocks.route).not.toHaveBeenCalled();
  });

  it("returns the decision and duration basis even for a resolved stop omitted from routes", async () => {
    located();
    mocks.occurrences.mockImplementation(async (_client: unknown, _userId: unknown, start: string) => start === day.startLocalDate
      ? [{ ...occurrence("resolved", "behavior-1", "2026-09-22T10:00:00Z"), status: "completed" }] : []);
    const result = await refreshTravelRoutes(caller, day, config, now);
    expect(result.evidence?.behaviorSources).toEqual([{ ref: "resolved", behaviorId: "behavior-1", unresolved: false, durationSeconds: 1800 }]);
    expect(mocks.route).not.toHaveBeenCalled();
  });

  it("reserves lookups once and hands the routing service the same reservation", async () => {
    located();
    await refreshTravelRoutes(caller, day, config, now);
    expect(mocks.geocode).toHaveBeenCalledTimes(2);
    expect(mocks.spend).toHaveBeenCalledOnce();
    expect(mocks.spend).toHaveBeenCalledWith(caller.client, 10_000);
    await mocks.route.mock.calls[0]![0].reserve(5_000);
    expect(mocks.spend).toHaveBeenLastCalledWith(caller.client, 5_000);
  });

  it("makes no provider call and returns the reset time when the monthly budget is used up", async () => {
    located();
    mocks.spend.mockResolvedValue({ allowed: false, retryAfterSeconds: 3_600, resetsAt: "2026-10-01T04:00:00Z" });
    await expect(refreshTravelRoutes(caller, day, config, now))
      .rejects.toMatchObject({ failure: { code: "quota_exceeded", retryAfterSeconds: 3_600, resetsAt: "2026-10-01T04:00:00Z" } });
    expect(mocks.geocode).not.toHaveBeenCalled();
    expect(mocks.route).not.toHaveBeenCalled();
  });

  it("reuses stored place lookups without a reservation or lookup", async () => {
    located();
    mocks.readPlaces.mockResolvedValue(["2 Habit St", "1 Base St"].map((text) => ({ textKey: keyOf(text), outcome: "resolved", placeId: `place:${text}`, lookedUpAt: "2026-09-01T00:00:00Z" })));
    const result = await refreshTravelRoutes(caller, day, config, now);
    expect(mocks.geocode).not.toHaveBeenCalled();
    expect(mocks.spend).not.toHaveBeenCalled();
    expect(mocks.writePlaces).not.toHaveBeenCalled();
    expect(result.evidence?.legs[0]?.state).toBe("current");
  });

  it("normalizes typed text so spacing and case changes reuse one stored lookup", async () => {
    located();
    mocks.source.mockResolvedValue({ ...source, behaviors: [{ ...source.behaviors[0]!, locationText: "  2  HABIT st " }] });
    mocks.readPlaces.mockResolvedValue(["2 Habit St", "1 Base St"].map((text) => ({ textKey: keyOf(text), outcome: "resolved", placeId: `place:${text}`, lookedUpAt: "2026-09-01T00:00:00Z" })));
    await refreshTravelRoutes(caller, day, config, now);
    expect(mocks.geocode).not.toHaveBeenCalled();
  });

  it("stores paid outcomes, including unresolved text, and looks up expired rows again", async () => {
    located();
    mocks.readPlaces.mockResolvedValue([
      { textKey: keyOf("1 Base St"), outcome: "resolved", placeId: "old-base", lookedUpAt: "2025-08-01T00:00:00Z" },
    ]);
    mocks.geocode.mockImplementation(async (text: string) => text === "2 Habit St" ? { kind: "unresolved" } : { kind: "resolved", point: { kind: "place_id", placeId: "new-base" } });
    await refreshTravelRoutes(caller, day, config, now);
    expect(mocks.geocode).toHaveBeenCalledTimes(2);
    expect(mocks.writePlaces).toHaveBeenCalledWith(caller.client, "owner", expect.arrayContaining([
      { textKey: keyOf("2 Habit St"), outcome: "unresolved", placeId: null, lookedUpAt: now.toString() },
      { textKey: keyOf("1 Base St"), outcome: "resolved", placeId: "new-base", lookedUpAt: now.toString() },
    ]));
  });

  it("keeps paid lookups when another lookup fails", async () => {
    located();
    mocks.geocode.mockImplementation(async (text: string) => {
      if (text === "1 Base St") throw Object.assign(new Error("provider_unavailable"), { code: "provider_unavailable" });
      return { kind: "resolved", point: { kind: "place_id", placeId: "habit" } };
    });
    await expect(refreshTravelRoutes(caller, day, config, now)).rejects.toThrow("provider_unavailable");
    expect(mocks.writePlaces).toHaveBeenCalledWith(caller.client, "owner", [{ textKey: keyOf("2 Habit St"), outcome: "resolved", placeId: "habit", lookedUpAt: now.toString() }]);
  });

  it("routes only legs inside the three-hour window and marks later legs for a later refresh", async () => {
    located("2026-09-22T15:00:00Z");
    const result = await refreshTravelRoutes(caller, day, config, now);
    expect(mocks.route).not.toHaveBeenCalled();
    expect(result.evidence?.legs.length).toBeGreaterThan(0);
    for (const leg of result.evidence!.legs) expect(leg).toMatchObject({ state: "unavailable", reason: "outside_route_window" });
  });

  it("routes later legs for a whole-day Daily Brief request", async () => {
    located("2026-09-22T15:00:00Z");
    const result = await refreshTravelRoutes(caller, { ...day, scope: "day" }, config, now);
    expect(mocks.route).toHaveBeenCalledOnce();
    expect(mocks.route.mock.calls[0]![0].routes).toHaveLength(2);
    expect(result.evidence?.legs.some((leg) => leg.reason === "outside_route_window")).toBe(false);
    expect(mocks.source).toHaveBeenCalledTimes(3);
  });

  it("keeps inbound travel when a located exact Behavior has no known duration", async () => {
    located();
    mocks.behaviors.mockResolvedValue([{ id: "behavior-1", default_duration_minutes: null }]);
    const result = await refreshTravelRoutes(caller, day, config, now);
    expect(result.evidence?.legs).toHaveLength(1);
    expect(result.evidence?.legs[0]?.leg).toMatchObject({ role: "outbound", destinationCommitmentRef: "occurrence-1" });
    expect(result.evidence?.completeTrip).toBe(false);
    expect(result.evidence?.finalAvailabilityAt).toBeNull();
  });

  it("routes a known-duration Behavior without a Calendar connection and returns its occurrence ref", async () => {
    located();
    mocks.behaviors.mockResolvedValue([{ id: "behavior-1", default_duration_minutes: 30 }, { id: "behavior-2", default_duration_minutes: 30 }]);
    mocks.occurrences.mockResolvedValue([
      occurrence("occurrence-1", "behavior-1", "2026-09-22T10:00:00Z"),
      occurrence("occurrence-2", "behavior-2", "2026-09-22T09:55:00Z"),
    ]);
    const result = await refreshTravelRoutes(caller, { ...day, device: { latitude: 40, longitude: -74, accuracyMeters: 10, sampledAt: "2026-09-22T08:00:00Z" } }, config, now);
    expect(result.accountId).toBe("owner");
    if (!result.evidence) throw new Error("Expected travel evidence.");
    expect(result.evidence.legs[0]?.leg.destinationCommitmentRef).toBe("occurrence-1");
    expect(result.evidence.collisions.some((collision) => collision.candidateRef === "occurrence-2")).toBe(true);
    expect(mocks.geocode).toHaveBeenCalledTimes(2);
    expect(mocks.events).not.toHaveBeenCalled();
  });

  it("routes a Home Behavior to the saved Home with one shared lookup (Ticket 215)", async () => {
    located();
    mocks.source.mockResolvedValue({ ...source, behaviors: [{ id: "behavior-1", whereKind: "home", locationText: null, updatedAt: "2026-09-20T00:00:00Z" }] });
    const result = await refreshTravelRoutes(caller, { ...day, device: { latitude: 40, longitude: -74, accuracyMeters: 10, sampledAt: "2026-09-22T08:00:00Z" } }, config, now);
    if (!result.evidence) throw new Error("Expected travel evidence.");
    expect(mocks.geocode).toHaveBeenCalledOnce();
    expect(mocks.geocode.mock.calls[0]![0]).toBe("1 Base St");
    expect(result.evidence.legs[0]?.leg).toMatchObject({ role: "outbound", destinationCommitmentRef: "occurrence-1" });
    expect(result.evidence.legs[0]?.leg.provenance.destinationSource).toBe("saved_base");
  });

  it.each([
    ["Anywhere", { whereKind: "anywhere" as const, baseLocationText: "1 Base St" }],
    ["Not set", { whereKind: null, baseLocationText: "1 Base St" }],
    ["Home without a saved Home", { whereKind: "home" as const, baseLocationText: null }],
  ])("requests no route for a %s Behavior (Ticket 215)", async (_label, { whereKind, baseLocationText }) => {
    located();
    mocks.source.mockResolvedValue({ ...source, settings: { ...source.settings, baseLocationText },
      behaviors: [{ id: "behavior-1", whereKind, locationText: null, updatedAt: "2026-09-20T00:00:00Z" }] });
    const result = await refreshTravelRoutes(caller, { ...day, device: { latitude: 40, longitude: -74, accuracyMeters: 10, sampledAt: "2026-09-22T08:00:00Z" } }, config, now);
    expect(result.evidence?.legs).toEqual([]);
    expect(mocks.geocode).not.toHaveBeenCalled();
    expect(mocks.spend).not.toHaveBeenCalled();
    expect(mocks.route).not.toHaveBeenCalled();
  });

  it("uses completed stopped-session history when no Behavior default duration exists", async () => {
    located();
    mocks.behaviors.mockResolvedValue([{ id: "behavior-1", default_duration_minutes: null }, { id: "behavior-2", default_duration_minutes: null }]);
    mocks.occurrences.mockImplementation(async (_client: unknown, _userId: unknown, start: string) => start === "2026-06-24"
      ? ["a", "b", "c"].map((id, index) => ({ ...occurrence(id, "behavior-1", `2026-0${7 + index}-01T10:00:00Z`), local_date: `2026-0${7 + index}-01`, updated_at: "2026-09-01T00:00:00Z", status: "completed" }))
      : [occurrence("occurrence-1", "behavior-1", "2026-09-22T10:00:00Z")]);
    mocks.historySessions.mockResolvedValue(["a", "b", "c"].map((occurrenceId, index) => ({ id: `s${index}`, user_id: "owner", occurrence_id: occurrenceId, behavior_id: "behavior-1", started_at: `2026-0${7 + index}-01T10:00:00Z`, stopped_at: `2026-0${7 + index}-01T10:10:00Z` })));
    await refreshTravelRoutes(caller, { ...day, device: { latitude: 40, longitude: -74, accuracyMeters: 10, sampledAt: "2026-09-22T08:00:00Z" } }, config, now);
    expect(mocks.route.mock.calls.at(-1)![0].routes.some((route: { request: { timing: { at: string } } }) => route.request.timing.at === "2026-09-22T10:10:00Z")).toBe(true);
  });

  it("does not discard paid work when a Note or status changes during routing", async () => {
    located();
    let reads = 0;
    mocks.occurrences.mockImplementation(async (_client: unknown, _user: unknown, start: string) => start === day.startLocalDate
      ? [{ ...occurrence("occurrence-1", "behavior-1", "2026-09-22T10:00:00Z"),
        status: ++reads > 1 ? "completed" : "unresolved", updated_at: `revision-${reads}`, note: `note-${reads}` }]
      : []);
    await expect(refreshTravelRoutes(caller, day, config, now)).resolves.toMatchObject({ accountId: "owner" });
    expect(mocks.route).toHaveBeenCalledOnce();
  });

  it("refuses changed duration history before reserving provider spend", async () => {
    located();
    mocks.historySessions.mockResolvedValueOnce([]).mockResolvedValue([{ id: "new-session", started_at: "2026-09-21T10:00:00Z", stopped_at: "2026-09-21T11:00:00Z" }]);
    await expect(refreshTravelRoutes(caller, day, config, now)).rejects.toMatchObject({ failure: { code: "context_changed" } });
    expect(mocks.spend).not.toHaveBeenCalled();
    expect(mocks.geocode).not.toHaveBeenCalled();
    expect(mocks.route).not.toHaveBeenCalled();
  });

  it("rejects the refresh when a source changes before returning", async () => {
    located();
    let reads = 0;
    mocks.source.mockImplementation(async () => (reads += 1) < 3 ? source : { ...source, settingsRevision: "settings-2" });
    await expect(refreshTravelRoutes(caller, day, config, now)).rejects.toMatchObject({ failure: { code: "context_changed" } });
  });

  describe("Ticket 217 learned habits", () => {
    const habits = { preparationMinutes: 15, arrivalBufferMinutes: 10, leaveFeedback: [], updatedAt: "2026-09-21T00:00:00.000000Z",
      placeModes: [{ placeKey: travelPlaceKey("2 Habit St"), mode: "transit" as const, chosenAt: "2026-09-21T00:00:00.000000Z" }] };

    it("uses the place-cache key for remembered places", () => {
      expect(travelPlaceKey(" 2  HABIT st ")).toBe(keyOf("2 Habit St"));
    });

    it("routes with the learned arrival buffer and the remembered mode, and occupies get-ready time", async () => {
      located();
      mocks.source.mockResolvedValue({ ...source, settings: { ...source.settings, habits }, habitsRevision: habits.updatedAt });
      const result = await refreshTravelRoutes(caller, day, config, now);
      const requests = mocks.route.mock.calls[0]![0].routes.map((route: { request: { mode: string; timing: unknown } }) => route.request);
      expect(requests.map((request: { mode: string }) => request.mode)).toEqual(["transit", "transit"]);
      expect(requests[0].timing).toEqual({ kind: "arrive_by", at: "2026-09-22T09:50:00Z" });
      expect(result.habitsRevision).toBe(habits.updatedAt);
      expect(result.evidence?.segments.filter((segment) => segment.kind === "preparation_buffer"))
        .toEqual([expect.objectContaining({ startAt: "2026-09-22T09:35:00Z", endAt: "2026-09-22T09:50:00Z" })]);
      expect(result.evidence?.legs[0]?.leg.destinationPlaceKey).toBe(travelPlaceKey("2 Habit St"));
    });

    it("falls back to usual travel and the confirmed defaults when nothing was learned", async () => {
      located();
      const result = await refreshTravelRoutes(caller, day, config, now);
      const requests = mocks.route.mock.calls[0]![0].routes.map((route: { request: { mode: string; timing: unknown } }) => route.request);
      expect(requests[0]).toMatchObject({ mode: "walking", timing: { kind: "arrive_by", at: "2026-09-22T09:55:00Z" } });
      expect(result.evidence?.segments.filter((segment) => segment.kind === "preparation_buffer"))
        .toEqual([expect.objectContaining({ startAt: "2026-09-22T09:40:00Z", endAt: "2026-09-22T09:50:00Z" })]);
    });

    it("withdraws the refresh when habits change during it", async () => {
      located();
      let reads = 0;
      mocks.source.mockImplementation(async () => (reads += 1) < 3 ? { ...source, habitsRevision: null }
        : { ...source, settings: { ...source.settings, habits }, habitsRevision: habits.updatedAt });
      await expect(refreshTravelRoutes(caller, day, config, now)).rejects.toMatchObject({ failure: { code: "context_changed" } });
    });
  });
});

describe("refreshTravelRoutes weather (Ticket 218)", () => {
  const ready = { status: "ready" as const, baseUrl: "https://api.open-meteo.com/v1/forecast", apiKey: null };
  // Synthetic sample near a public landmark; never a real user position.
  const device = { latitude: 40.7484, longitude: -73.9857, accuracyMeters: 20, sampledAt: "2026-09-22T07:59:40Z" };
  const rainy = { state: "forecast" as const, forecast: { provider: "open-meteo" as const, areaKey: "40.7,-74.0",
    hourStart: "2026-09-22T08:00:00Z", fetchedAt: now.toString(), expiresAt: "2026-09-22T09:00:00Z",
    hours: Array.from({ length: 48 }, (_, index) => ({ time: now.add({ hours: index }).toString(), weatherCode: 61, rainMillimeters: 1.2,
      snowfallCentimeters: 0, precipitationProbabilityPercent: 80, apparentTemperatureCelsius: 14, windGustsKilometersPerHour: 20 })) } };

  it("keeps weather off by default", async () => {
    located();
    const result = await refreshTravelRoutes(caller, { ...day, device }, config, now);
    expect(mocks.weather).toHaveBeenCalledWith({ device, config: { status: "off" }, now });
    expect(result.evidence && "weather" in result.evidence).toBe(false);
  });

  it("passes only the request's device sample and applies the fixed margin", async () => {
    located();
    mocks.weather.mockResolvedValue(rainy);
    const result = await refreshTravelRoutes(caller, { ...day, device }, config, now, ready);
    expect(mocks.weather).toHaveBeenCalledOnce();
    expect(mocks.weather).toHaveBeenCalledWith({ device, config: ready, now });
    expect(result.evidence?.weather).toMatchObject({ state: "applied", tableVersion: "weather-margin@1" });
    expect(result.evidence?.legs[0]?.weather).toMatchObject({ conditions: ["rain"], marginSeconds: 600, suggestion: null,
      departureAt: "2026-09-22T09:40:00Z", arrivalAt: "2026-09-22T10:00:00Z" });
    expect(result.evidence?.legs[0]?.estimate?.departureAt).toBe("2026-09-22T09:50:00Z");
  });

  it("says when there is no position and never blocks routes on a weather failure", async () => {
    located();
    mocks.weather.mockResolvedValue({ state: "no_position" });
    const noPosition = await refreshTravelRoutes(caller, day, config, now, ready);
    expect(mocks.weather).toHaveBeenCalledWith({ device: null, config: ready, now });
    expect(noPosition.evidence?.weather?.state).toBe("no_position");
    mocks.weather.mockRejectedValue(new Error("unexpected"));
    const failed = await refreshTravelRoutes(caller, { ...day, device }, config, now, ready);
    expect(failed.evidence?.weather?.state).toBe("unavailable");
    expect(failed.evidence?.legs[0]?.state).toBe("current");
  });

  it("asks for no weather when no leg needs travel", async () => {
    located();
    mocks.source.mockResolvedValue({ ...source, settings: { ...source.settings, baseLocationText: null }, behaviors: [{ id: "behavior-1", whereKind: null, locationText: null, updatedAt: "2026-09-20T00:00:00Z" }] });
    await refreshTravelRoutes(caller, { ...day, device }, config, now, ready);
    expect(mocks.weather).not.toHaveBeenCalled();
  });
});

describe("refreshTravelRoutes signed conclusions (Ticket 219 Option A)", () => {
  const secret = "test-only-conclusions-secret-0123456789";
  const ready = { status: "ready" as const, baseUrl: "https://api.open-meteo.com/v1/forecast", apiKey: null };
  const device = { latitude: 40.7484, longitude: -73.9857, accuracyMeters: 20, sampledAt: "2026-09-22T07:59:40Z" };
  const rainy = { state: "forecast" as const, forecast: { provider: "open-meteo" as const, areaKey: "40.7,-74.0",
    hourStart: "2026-09-22T08:00:00Z", fetchedAt: now.toString(), expiresAt: "2026-09-22T09:00:00Z",
    hours: Array.from({ length: 48 }, (_, index) => ({ time: now.add({ hours: index }).toString(), weatherCode: 61, rainMillimeters: 1.2,
      snowfallCentimeters: 0, precipitationProbabilityPercent: 80, apparentTemperatureCelsius: 14, windGustsKilometersPerHour: 20 })) } };
  const decode = (token: string) => JSON.parse(Buffer.from(token.split(".")[0]!, "base64url").toString("utf8")) as Record<string, unknown>;

  it("signs only Cadence's conclusions and weather rules for a one-day view", async () => {
    located();
    mocks.weather.mockResolvedValue(rainy);
    const result = await refreshTravelRoutes(caller, { ...day, device }, config, now, ready, secret);
    expect(result.conclusionsToken).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
    const payload = verifyTravelConclusionsToken(result.conclusionsToken, { secrets: { current: secret, previous: null }, userId: "owner", localDate: day.startLocalDate, now });
    expect(payload).toMatchObject({ v: 1, sub: "owner", date: "2026-09-22", iat: now.toString(), exp: result.expiresAt,
      conclusions: { version: "2.0", travelDay: "yes", trips: [
        { destinationRef: "occurrence:occurrence-1", role: "outbound", mode: "walking", estimate: "current" },
        { destinationRef: null, role: "return", mode: "walking", estimate: "unknown" },
      ] },
      weather: { state: "applied", trips: [
        { destinationRef: "occurrence:occurrence-1", role: "outbound", state: "margin", conditions: ["rain"], marginMinutes: 10, suggestion: null },
        { destinationRef: null, role: "return", state: "margin", conditions: ["rain"], marginMinutes: 10, suggestion: null },
      ] },
      events: {} });
    // The view itself stays free of model conclusions.
    expect(result.evidence).not.toHaveProperty("modelProjection");
    const body = decode(result.conclusionsToken!);
    const text = JSON.stringify(body);
    for (const leaked of ["durationSeconds", "departureAt", "arrivalAt", "occupiedSpans", "finalAvailabilityAt", "place_id", "placeId",
      "Habit St", "Base St", keyOf("2 Habit St"), keyOf("1 Base St"), "40.7", "-73.9", "Google Maps", "600", "09:50", "09:40"]) {
      expect(text).not.toContain(leaked);
    }
    // The only numbers are the token version and the weather table margins; the only instants are issue and expiry.
    expect(numbers(body)).toEqual([1, 10, 10]);
    expect(strings(body).filter((value) => /^\d{4}-\d{2}-\d{2}T/.test(value)).sort()).toEqual([result.expiresAt, now.toString()].sort());
  });

  it("names Calendar trips by event identity and records their provider revision", async () => {
    located();
    mocks.calendar.mockResolvedValue({ status: "connected", generation: 2, selectionRevision: 3 });
    mocks.events.mockResolvedValue({ requestedRange: { timezone: "America/New_York" }, events: [{
      id: "event-row-1", calendarId: "primary", providerEventId: "provider-1", kind: "timed", state: "confirmed", currentUserResponse: "accepted",
      startAt: "2026-09-22T11:00:00Z", endAt: "2026-09-22T11:30:00Z", endUnspecified: false, location: "3 Event St", conference: null,
      revision: { providerEtag: "etag-1", providerUpdatedAt: null } }] });
    const result = await refreshTravelRoutes(caller, day, config, now, undefined, secret);
    const payload = decode(result.conclusionsToken!);
    expect(JSON.stringify(payload.conclusions)).toContain(JSON.stringify("event:primary\u0000provider-1").slice(1, -1));
    expect(payload.events).toEqual({ "event:primary\u0000provider-1": JSON.stringify({ providerEtag: "etag-1", providerUpdatedAt: null }) });
    expect(JSON.stringify(payload)).not.toContain("3 Event St");
    expect(JSON.stringify(payload)).not.toContain("event-row-1");
  });

  it("issues no token without a secret or for a two-day view", async () => {
    located();
    expect(await refreshTravelRoutes(caller, day, config, now)).not.toHaveProperty("conclusionsToken");
    located();
    expect(await refreshTravelRoutes(caller, { startLocalDate: "2026-09-22", endLocalDate: "2026-09-23" }, config, now, undefined, secret))
      .not.toHaveProperty("conclusionsToken");
  });
});

function numbers(value: unknown): number[] {
  if (typeof value === "number") return [value];
  if (Array.isArray(value)) return value.flatMap(numbers);
  return value && typeof value === "object" ? Object.values(value).flatMap(numbers) : [];
}

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  return value && typeof value === "object" ? [...Object.keys(value), ...Object.values(value).flatMap(strings)] : [];
}
