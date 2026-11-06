import { createHash } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("@/lib/db/travelSpend.repo", async (load) => ({
  ...(await load<typeof import("@/lib/db/travelSpend.repo")>()),
  reserveTravelProviderSpend: mocks.spend, readTravelMonthSpend: mocks.monthSpend,
}));
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
import { ConnectorError } from "@/lib/types/connectors";
import { travelPlaceKey } from "@cadence/core/services/travel-place-key";
import {
  TRAVEL_LEG_READY_AFTER_END,
  recordTravelRefresh,
  resolveTravelRefreshPlan,
  travelRefreshRequestFields,
  travelRefreshTrips,
  travelTripKey,
  type TravelRefreshPlanInput,
} from "@cadence/core/services/travel-refresh-policy";

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
  mocks.timezone.mockResolvedValue("America/New_York");
  mocks.weather.mockResolvedValue(null);
  mocks.monthSpend.mockResolvedValue(0);
  const disconnected = { status: "disconnected", generation: 0, selectionRevision: 0, preferences: { selectedSourceIds: [] } };
  mocks.outlook.mockResolvedValue(disconnected);
  mocks.icloud.mockResolvedValue(disconnected);
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

  it("does not discard paid work when only a Note changes during routing", async () => {
    located();
    let reads = 0;
    mocks.occurrences.mockImplementation(async (_client: unknown, _user: unknown, start: string) => start === day.startLocalDate
      ? [{ ...occurrence("occurrence-1", "behavior-1", "2026-09-22T10:00:00Z"),
        updated_at: `revision-${++reads}`, note: `note-${reads}` }]
      : []);
    await expect(refreshTravelRoutes(caller, day, config, now)).resolves.toMatchObject({ accountId: "owner" });
    expect(mocks.route).toHaveBeenCalledOnce();
  });

  it("rejects a status change after the original unresolved stop was routed", async () => {
    located();
    let completed = false;
    mocks.occurrences.mockImplementation(async (_client: unknown, _user: unknown, start: string) => start === day.startLocalDate
      ? [{ ...occurrence("occurrence-1", "behavior-1", "2026-09-22T10:00:00Z"), status: completed ? "completed" : "unresolved" }]
      : []);
    mocks.route.mockImplementation(async (input) => {
      completed = true;
      return routeAll(input);
    });

    await expect(refreshTravelRoutes(caller, day, config, now)).rejects.toMatchObject({ failure: { code: "context_changed" } });
    expect(mocks.route).toHaveBeenCalledOnce();
  });

  it.each(["connected", "disconnected"] as const)("rejects a timezone change during routing when Calendar is %s", async (status) => {
    located();
    mocks.calendar.mockResolvedValue({ status, generation: 1, selectionRevision: 1 });
    mocks.events.mockResolvedValue({ requestedRange: { timezone: "America/New_York" }, events: [] });
    mocks.route.mockImplementation(async (input) => {
      mocks.timezone.mockResolvedValue("Europe/London");
      return routeAll(input);
    });

    await expect(refreshTravelRoutes(caller, day, config, now)).rejects.toMatchObject({ failure: { code: "context_changed" } });
    expect(mocks.route).toHaveBeenCalledOnce();
    expect(mocks.timezone).toHaveBeenLastCalledWith(caller.client, "owner");
  });

  it("rejects a changed Home value even when the settings revision is unchanged", async () => {
    located();
    let moved = false;
    mocks.source.mockImplementation(async () => moved
      ? { ...source, settings: { ...source.settings, baseLocationText: "4 New Home St" } }
      : source);
    mocks.route.mockImplementation(async (input) => {
      moved = true;
      return routeAll(input);
    });

    await expect(refreshTravelRoutes(caller, day, config, now)).rejects.toMatchObject({ failure: { code: "context_changed" } });
    expect(mocks.route).toHaveBeenCalledOnce();
  });

  it("fences stored inputs after the final Calendar reread finishes", async () => {
    located();
    mocks.calendar.mockResolvedValue({ status: "connected", generation: 1, selectionRevision: 1 });
    const snapshot = { requestedRange: { timezone: "America/New_York" }, events: [] };
    let releaseCalendar = () => {};
    const pendingCalendar = new Promise<typeof snapshot>((resolve) => {
      releaseCalendar = () => resolve(snapshot);
    });
    let calendarStarted = () => {};
    const rereading = new Promise<void>((resolve) => { calendarStarted = resolve; });
    mocks.events.mockResolvedValueOnce(snapshot).mockImplementation(async () => {
      calendarStarted();
      return pendingCalendar;
    });

    const pending = refreshTravelRoutes(caller, day, config, now);
    await rereading;
    mocks.source.mockResolvedValue({ ...source, settings: { ...source.settings, baseLocationText: "4 New Home St" } });
    releaseCalendar();

    await expect(pending).rejects.toMatchObject({ failure: { code: "context_changed" } });
    expect(mocks.events).toHaveBeenCalledTimes(2);
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

describe("refreshTravelRoutes late trips and trips home (Ticket 264)", () => {
  const withEvents = (events: readonly Record<string, unknown>[], settings: Readonly<{ baseLocationText?: string | null }> = {}) => {
    mocks.source.mockResolvedValue({ ...source, behaviors: [], settings: { ...source.settings, ...settings } });
    mocks.calendar.mockResolvedValue({ status: "connected", generation: 1, selectionRevision: 1 });
    mocks.behaviors.mockResolvedValue([]);
    mocks.occurrences.mockResolvedValue([]);
    mocks.events.mockResolvedValue({ requestedRange: { timezone: "America/New_York" }, events });
  };
  const event = (id: string, startAt: string, endAt: string, location = `${id} St`, extra: Record<string, unknown> = {}) => ({
    id, kind: "timed", state: "confirmed", currentUserResponse: "accepted", calendarId: "primary", providerEventId: id, startAt, endAt,
    endUnspecified: false, location, conference: null, revision: { providerEtag: id, providerUpdatedAt: null }, ...extra,
  });
  const ongoing = event("ongoing", "2026-09-22T07:30:00Z", "2026-09-22T08:30:00Z");
  const fromReady = (leg: { id: string; request: { readyAt: string } }) => ({ id: leg.id, failure: null, estimate: { ...estimate,
    departureAt: leg.request.readyAt, arrivalAt: Temporal.Instant.from(leg.request.readyAt).add({ seconds: 600 }).toString(), durationSeconds: 600 } });
  const secret = "s".repeat(64);

  it("scenario D: keeps the trip home for an event under way", async () => {
    withEvents([ongoing]);
    mocks.route.mockImplementation(async ({ routes }: { routes: { id: string; request: { readyAt: string } }[] }) => routes.map(fromReady));
    const result = await refreshTravelRoutes(caller, day, config, now);
    expect(mocks.route.mock.calls[0]![0].routes).toHaveLength(1);
    expect(result.evidence?.legs).toHaveLength(1);
    expect(result.evidence?.legs[0]).toMatchObject({ state: "current", leg: { role: "return", originCommitmentRef: "ongoing", destinationCommitmentRef: null } });
    expect(result.evidence?.unknownLegs).toEqual([]);
  });

  it("scenario D: leaves a started event with no specified end out of the plan", async () => {
    withEvents([event("ongoing", "2026-09-22T07:30:00Z", "2026-09-22T07:30:00Z", "ongoing St", { endUnspecified: true })]);
    const result = await refreshTravelRoutes(caller, day, config, now);
    expect(mocks.route).not.toHaveBeenCalled();
    expect(result.evidence).toMatchObject({ legs: [], unknownLegs: [], segments: [] });
  });

  it("gives a later event a current leg from Home after a started Behavior with no duration", async () => {
    withEvents([event("later", "2026-09-22T10:00:00Z", "2026-09-22T11:00:00Z")]);
    mocks.source.mockResolvedValue(source);
    mocks.behaviors.mockResolvedValue([{ id: "behavior-1", default_duration_minutes: null }]);
    mocks.occurrences.mockImplementation(async (_client: unknown, _userId: unknown, start: string) => start === "2026-09-22"
      ? [occurrence("occurrence-1", "behavior-1", "2026-09-22T07:00:00Z")] : []);
    const result = await refreshTravelRoutes(caller, day, config, now);
    expect(result.evidence?.unknownLegs).toEqual([]);
    expect(result.evidence?.legs[0]).toMatchObject({ state: "current", leg: { role: "outbound", originCommitmentRef: null, destinationCommitmentRef: "later",
      readyAt: now.toString(), provenance: { originRef: "base", originSource: "saved_base" } } });
    expect(result.evidence?.legs.some((entry) => entry.leg.originCommitmentRef === "occurrence-1")).toBe(false);
    expect(result.evidence?.behaviorSources).toEqual([]);
    expect(mocks.geocode.mock.calls.map(([text]) => text)).not.toContain("2 Habit St");
  });

  it("counts an event under way in the nine-commitment limit", async () => {
    const future = Array.from({ length: 9 }, (_, index) => event(`future${index + 1}`, `2026-09-22T${String(10 + index)}:00:00Z`, `2026-09-22T${String(10 + index)}:30:00Z`));
    withEvents([ongoing, ...future]);
    mocks.route.mockImplementation(async ({ routes }: { routes: { id: string; request: { readyAt: string } }[] }) => routes.map(fromReady));
    const result = await refreshTravelRoutes(caller, { ...day, scope: "day" }, config, now);
    // Ongoing, then seven routable stops. The eighth future stop is the unrouted boundary, and the ninth is left out.
    expect(result.evidence?.legs.map((entry) => [entry.leg.originCommitmentRef, entry.leg.destinationCommitmentRef])).toEqual([
      ["ongoing", "future1"], ...Array.from({ length: 6 }, (_, index) => [`future${index + 1}`, `future${index + 2}`]),
    ]);
    expect(result.evidence?.unknownLegs).toEqual([{ role: "onward", originCommitmentRef: "future7", destinationCommitmentRef: "future8", reason: "leg_limit" }]);
    expect(mocks.geocode.mock.calls.map(([text]) => text)).not.toContain("future8 St");
    expect(JSON.stringify(result.evidence)).not.toContain("future9");
  });

  it("leaves ended and unplaced events under way out of the plan", async () => {
    withEvents([
      event("ended", "2026-09-22T06:00:00Z", "2026-09-22T07:00:00Z"),
      event("blank", "2026-09-22T07:30:00Z", "2026-09-22T08:30:00Z", "", { conference: { url: "https://example.test" } }),
    ]);
    const result = await refreshTravelRoutes(caller, day, config, now);
    expect(result.evidence).toMatchObject({ legs: [], unknownLegs: [], segments: [] });
    expect(mocks.geocode.mock.calls.map(([text]) => text)).toEqual([]);
  });

  it("decision D12: a located event with a video link is in person, and an event without a location is not travel", async () => {
    withEvents([
      event("video", "2026-09-22T07:30:00Z", "2026-09-22T08:30:00Z", "video St", { conference: { url: "https://example.test" } }),
      event("call", "2026-09-22T09:00:00Z", "2026-09-22T09:30:00Z", "", { conference: { url: "https://example.test" } }),
      event("hybrid", "2026-09-22T10:00:00Z", "2026-09-22T11:00:00Z", "Hybrid Hall", { conference: { url: "https://example.test" } }),
    ]);
    mocks.route.mockImplementation(async ({ routes }: { routes: { id: string; request: { readyAt: string } }[] }) => routes.map(fromReady));
    const result = await refreshTravelRoutes(caller, { ...day, scope: "day" }, config, now);
    expect(result.evidence?.unknownLegs).toEqual([]);
    expect(result.evidence?.legs.map((entry) => [entry.leg.role, entry.leg.originCommitmentRef, entry.leg.destinationCommitmentRef])).toEqual([
      ["onward", "video", "hybrid"], ["return", "hybrid", null],
    ]);
    expect(JSON.stringify(result.evidence)).not.toContain("call");
  });

  it("decision D12: refreshes an older Mac build's request whose correction has a null destination", async () => {
    // Before D12 an In person or Remote tap sent attendance with locationText null. The server skips it.
    withEvents([event("call", "2026-09-22T09:00:00Z", "2026-09-22T09:30:00Z", ""), event("hall", "2026-09-22T10:00:00Z", "2026-09-22T11:00:00Z", "Hall St")]);
    mocks.route.mockImplementation(async ({ routes }: { routes: { id: string; request: { readyAt: string } }[] }) => routes.map(fromReady));
    const legacy = { ...day, scope: "day", corrections: [
      { eventId: "call", revision: "call", attendance: "physical", locationText: null },
      { eventId: "hall", revision: "hall", attendance: "remote", locationText: null },
    ] };
    const result = await refreshTravelRoutes(caller, legacy, config, now);
    expect(result.evidence?.unknownLegs).toEqual([]);
    expect(result.evidence?.legs.map((entry) => [entry.leg.role, entry.leg.originCommitmentRef, entry.leg.destinationCommitmentRef])).toEqual([
      ["outbound", null, "hall"], ["return", "hall", null],
    ]);
    expect(JSON.stringify(result.evidence)).not.toContain("call");
  });

  describe("Ticket 281: remembered places", () => {
    const written = () => mocks.writePlaces.mock.calls.flatMap(([, , rows]) => rows as { textKey: string; outcome: string; placeId: string | null }[]);
    const routeAllFromReady = () => mocks.route.mockImplementation(async ({ routes }: { routes: { id: string; request: { readyAt: string } }[] }) => routes.map(fromReady));

    it("stores the corrected place ID under the original text's key, and later events with that text use it", async () => {
      withEvents([
        event("first", "2026-09-22T10:00:00Z", "2026-09-22T11:00:00Z", "Main Campus"),
        event("second", "2026-09-22T13:00:00Z", "2026-09-22T14:00:00Z", "main  campus"),
      ]);
      routeAllFromReady();
      const corrected = { ...day, scope: "day", corrections: [{ eventId: "first", revision: "first", locationText: "500 Main St" }] };
      const result = await refreshTravelRoutes(caller, corrected, config, now);
      expect(mocks.geocode.mock.calls.map(([text]) => text).sort()).toEqual(["1 Base St", "500 Main St"]);
      expect(written()).toContainEqual({ textKey: keyOf("Main Campus"), outcome: "resolved", placeId: "place:500 Main St", lookedUpAt: now.toString() });
      // A row holds a key, an outcome, a place ID and a time: no place or event text.
      for (const row of written()) expect(Object.keys(row).sort()).toEqual(["lookedUpAt", "outcome", "placeId", "textKey"]);
      expect(written().map((row) => row.textKey)).not.toContain("Main Campus");
      // Both events are at the corrected place, so nothing travels between them.
      expect(result.evidence?.legs.map((entry) => [entry.leg.originCommitmentRef, entry.leg.destinationCommitmentRef])).toEqual([[null, "first"], ["second", null]]);
      expect(result.evidence?.unknownLegs).toEqual([]);
    });

    it("resolves the original text to the remembered place after a reload, with no lookup", async () => {
      withEvents([event("first", "2026-09-22T10:00:00Z", "2026-09-22T11:00:00Z", "Main Campus")]);
      routeAllFromReady();
      mocks.readPlaces.mockImplementation(async (_client: unknown, _userId: unknown, keys: readonly string[]) => keys.includes(keyOf("Main Campus"))
        ? [{ textKey: keyOf("Main Campus"), outcome: "resolved", placeId: "place:500 Main St", lookedUpAt: now.subtract({ hours: 1 }).toString() }] : []);
      const result = await refreshTravelRoutes(caller, { ...day, scope: "day" }, config, now);
      expect(mocks.geocode.mock.calls.map(([text]) => text)).toEqual(["1 Base St"]);
      expect(JSON.stringify(mocks.route.mock.calls[0]![0].routes)).toContain("place:500 Main St");
      expect(result.evidence?.unknownLegs).toEqual([]);
    });

    it("remembers nothing for an unresolved correction, an unchanged text or an event without a location", async () => {
      withEvents([
        event("vague", "2026-09-22T10:00:00Z", "2026-09-22T11:00:00Z", "Main Campus"),
        event("same", "2026-09-22T12:00:00Z", "2026-09-22T13:00:00Z", "Hall St"),
        event("blank", "2026-09-22T14:00:00Z", "2026-09-22T15:00:00Z", ""),
      ]);
      routeAllFromReady();
      mocks.geocode.mockImplementation(async (text: string) => text === "Somewhere"
        ? { kind: "ambiguous" } : { kind: "resolved", point: { kind: "place_id", placeId: `place:${text}` } });
      await refreshTravelRoutes(caller, { ...day, scope: "day", corrections: [
        { eventId: "vague", revision: "vague", locationText: "Somewhere" },
        { eventId: "same", revision: "same", locationText: " hall  st " },
        { eventId: "blank", revision: "blank", locationText: "9 Added St" },
      ] }, config, now);
      const keys = written().map((row) => row.textKey);
      expect(keys).not.toContain(keyOf("Main Campus"));
      expect(keys).not.toContain(keyOf(""));
      expect(written().filter((row) => row.textKey === keyOf("Hall St"))).toEqual([
        { textKey: keyOf("Hall St"), outcome: "resolved", placeId: "place: hall  st ", lookedUpAt: now.toString() },
      ]);
    });

    it("forgets the remembered place when the user corrects back to the original text", async () => {
      withEvents([event("first", "2026-09-22T10:00:00Z", "2026-09-22T11:00:00Z", "Main Campus")]);
      routeAllFromReady();
      mocks.readPlaces.mockImplementation(async (_client: unknown, _userId: unknown, keys: readonly string[]) => keys.includes(keyOf("Main Campus"))
        ? [{ textKey: keyOf("Main Campus"), outcome: "resolved", placeId: "place:500 Main St", lookedUpAt: now.subtract({ hours: 1 }).toString() }] : []);
      await refreshTravelRoutes(caller, { ...day, scope: "day", corrections: [{ eventId: "first", revision: "first", locationText: "Main Campus" }] }, config, now);
      // The original text is looked up again, and its own place replaces the remembered one.
      expect(mocks.geocode.mock.calls.map(([text]) => text).sort()).toEqual(["1 Base St", "Main Campus"]);
      expect(written().filter((row) => row.textKey === keyOf("Main Campus"))).toEqual([
        { textKey: keyOf("Main Campus"), outcome: "resolved", placeId: "place:Main Campus", lookedUpAt: now.toString() },
      ]);
      const routes = JSON.stringify(mocks.route.mock.calls[0]![0].routes);
      expect(routes).toContain("place:Main Campus");
      expect(routes).not.toContain("place:500 Main St");
    });

    it("keeps the refresh when remembering fails", async () => {
      withEvents([event("first", "2026-09-22T10:00:00Z", "2026-09-22T11:00:00Z", "Main Campus")]);
      routeAllFromReady();
      mocks.writePlaces.mockRejectedValue(new Error("write failed"));
      const result = await refreshTravelRoutes(caller, { ...day, scope: "day", corrections: [{ eventId: "first", revision: "first", locationText: "500 Main St" }] }, config, now);
      expect(result.evidence?.legs.length).toBeGreaterThan(0);
    });
  });

  it("keeps a Behavior under way until its end, and its source for later decisions", async () => {
    located("2026-09-22T07:50:00Z");
    mocks.route.mockImplementation(async ({ routes }: { routes: { id: string; request: { readyAt: string } }[] }) => routes.map(fromReady));
    const result = await refreshTravelRoutes(caller, day, config, now);
    expect(result.evidence?.legs[0]).toMatchObject({ leg: { role: "return", originCommitmentRef: "occurrence-1" } });
    expect(result.evidence?.behaviorSources?.map((item) => item.ref)).toEqual(["occurrence-1"]);
  });

  it("drops a Behavior once it has ended", async () => {
    located("2026-09-22T07:00:00Z");
    const result = await refreshTravelRoutes(caller, day, config, now);
    expect(result.evidence).toMatchObject({ legs: [], unknownLegs: [] });
    expect(result.evidence?.behaviorSources).toEqual([]);
  });

  it("scenarios E and F: returns the reasons, and no place text, to the client", async () => {
    withEvents([
      event("vague", "2026-09-22T10:00:00Z", "2026-09-22T11:00:00Z", "Somewhere vague"),
      event("call", "2026-09-22T12:00:00Z", "2026-09-22T13:00:00Z", "", { conference: { url: "https://example.test" } }),
      event("clear", "2026-09-22T14:00:00Z", "2026-09-22T15:00:00Z", "Clear Hall"),
    ], { baseLocationText: null });
    mocks.geocode.mockImplementation(async (text: string) => text === "Somewhere vague"
      ? { kind: "ambiguous" } : { kind: "resolved", point: { kind: "place_id", placeId: `place:${text}` } });
    const result = await refreshTravelRoutes(caller, day, config, now);
    expect(result.evidence?.legs).toEqual([]);
    expect(result.evidence?.unknownLegs).toEqual([
      { role: "outbound", originCommitmentRef: null, destinationCommitmentRef: "vague", reason: "destination_unknown" },
      { role: "outbound", originCommitmentRef: null, destinationCommitmentRef: "clear", reason: "origin_unknown" },
      { role: "return", originCommitmentRef: "clear", destinationCommitmentRef: null, reason: "return_base_missing" },
    ]);
    expect(JSON.stringify(result.evidence?.unknownLegs)).not.toMatch(/Hall|vague St|Somewhere|place:/);
  });

  it("scenario B through the service: a usable late leg, and late_arrival in the signed conclusions", async () => {
    located("2026-09-22T08:15:00Z");
    mocks.route.mockImplementation(async ({ routes }: { routes: { id: string; request: { timing: { at: string } } }[] }) => routes.map((route, index) => ({ id: route.id, failure: null, estimate: index === 0
      ? { ...estimate, durationSeconds: 1800, departureAt: "2026-09-22T07:40:00Z", arrivalAt: "2026-09-22T08:10:00Z" }
      : { ...estimate, departureAt: route.request.timing.at, arrivalAt: Temporal.Instant.from(route.request.timing.at).add({ seconds: 600 }).toString() } })));
    const result = await refreshTravelRoutes(caller, day, config, now, undefined, secret);
    expect(result.evidence?.legs[0]).toMatchObject({ state: "current", late: true, estimate: { departureAt: now.toString(), arrivalAt: "2026-09-22T08:30:00Z" } });
    const payload = verifyTravelConclusionsToken(result.conclusionsToken!, { secrets: { current: secret, previous: null }, userId: "owner", localDate: day.startLocalDate, now });
    expect(payload?.conclusions.fits).toEqual([{ ref: "occurrence:occurrence-1", conclusion: "does_not_fit", basis: "late_arrival",
      trip: { destinationRef: "occurrence:occurrence-1", role: "outbound" }, position: null }]);
    const body = result.conclusionsToken!.split(".")[0]!;
    const text = Buffer.from(body, "base64url").toString("utf8");
    expect(JSON.parse(text).conclusions).not.toHaveProperty("late");
    for (const leaked of ["08:30", "07:40", "1800", "Habit St", "Base St"]) expect(JSON.stringify(payload?.conclusions)).not.toContain(leaked);
  });

  it("signs the trip home from an event under way, named by its Calendar identity", async () => {
    withEvents([ongoing]);
    mocks.route.mockImplementation(async ({ routes }: { routes: { id: string; request: { readyAt: string } }[] }) => routes.map(fromReady));
    const result = await refreshTravelRoutes(caller, day, config, now, undefined, secret);
    const payload = verifyTravelConclusionsToken(result.conclusionsToken!, { secrets: { current: secret, previous: null }, userId: "owner", localDate: day.startLocalDate, now });
    expect(payload?.conclusions).toMatchObject({ travelDay: "yes", calendarEvents: true,
      trips: [{ destinationRef: null, role: "return", mode: "walking", estimate: "current" }], fits: [] });
    expect(JSON.stringify(payload?.conclusions)).not.toMatch(/08:30|ongoing St/);
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

  it("fences stored inputs after a slower weather request finishes", async () => {
    located();
    let releaseWeather = () => {};
    mocks.weather.mockReturnValue(new Promise<null>((resolve) => {
      releaseWeather = () => resolve(null);
    }));
    let routingFinished = () => {};
    const routed = new Promise<void>((resolve) => { routingFinished = resolve; });
    mocks.route.mockImplementation(async (input) => {
      routingFinished();
      return routeAll(input);
    });

    const pending = refreshTravelRoutes(caller, { ...day, device }, config, now, ready);
    await routed;
    // Drain the completed route work while the weather provider remains pending.
    await new Promise<void>((resolve) => setImmediate(resolve));
    mocks.source.mockResolvedValue({ ...source, settings: { ...source.settings, baseLocationText: "4 New Home St" } });
    releaseWeather();

    await expect(pending).rejects.toMatchObject({ failure: { code: "context_changed" } });
    expect(mocks.route).toHaveBeenCalledOnce();
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

  it("binds past and cancelled Calendar events that do not appear in named conclusions", async () => {
    located();
    const future = {
      id: "event-row-future", calendarId: "primary", providerEventId: "provider-future", kind: "timed", state: "confirmed", currentUserResponse: "accepted",
      startAt: "2026-09-22T11:00:00Z", endAt: "2026-09-22T11:30:00Z", endUnspecified: false, location: "3 Event St", conference: null,
      revision: { providerEtag: "etag-future", providerUpdatedAt: null },
    };
    const events = [future,
      { ...future, id: "event-row-past", providerEventId: "provider-past", startAt: "2026-09-22T07:00:00Z", endAt: "2026-09-22T07:30:00Z",
        revision: { providerEtag: "etag-past", providerUpdatedAt: null } },
      { ...future, id: "event-row-cancelled", providerEventId: "provider-cancelled", state: "cancelled",
        revision: { providerEtag: "etag-cancelled", providerUpdatedAt: null } },
    ];
    mocks.calendar.mockResolvedValue({ status: "connected", generation: 2, selectionRevision: 3 });
    mocks.events.mockResolvedValue({ requestedRange: { timezone: "America/New_York" }, events });

    const result = await refreshTravelRoutes(caller, day, config, now, undefined, secret);
    const payload = verifyTravelConclusionsToken(result.conclusionsToken, { secrets: { current: secret, previous: null }, userId: "owner", localDate: day.startLocalDate, now });

    expect(payload).not.toBeNull();
    expect(payload!.events).toEqual(Object.fromEntries(events.map((event) => [
      `event:${event.calendarId}\0${event.providerEventId}`, JSON.stringify(event.revision),
    ])));
    expect(JSON.stringify(payload!.conclusions)).not.toContain("provider-past");
    expect(JSON.stringify(payload!.conclusions)).not.toContain("provider-cancelled");
  });

  it("keeps route evidence but omits a token when the complete Calendar snapshot is oversized", async () => {
    located();
    mocks.calendar.mockResolvedValue({ status: "connected", generation: 2, selectionRevision: 3 });
    mocks.events.mockResolvedValue({ requestedRange: { timezone: "America/New_York" }, events: Array.from({ length: 500 }, (_, index) => ({
      id: `event-row-${index}`, calendarId: "primary", providerEventId: `provider-${index}`, kind: "timed", state: "confirmed", currentUserResponse: "accepted",
      startAt: "2026-09-22T07:00:00Z", endAt: "2026-09-22T07:30:00Z", endUnspecified: false, location: "3 Event St", conference: null,
      revision: { providerEtag: `etag-${index}`, providerUpdatedAt: null },
    })) });

    const result = await refreshTravelRoutes(caller, day, config, now, undefined, secret);

    expect(mocks.route).toHaveBeenCalledOnce();
    expect(result.evidence?.legs[0]?.state).toBe("current");
    expect(result).not.toHaveProperty("conclusionsToken");
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

describe("trip refresh plan through the service (Ticket 267)", () => {
  const device = { latitude: 40, longitude: -74, accuracyMeters: 10, sampledAt: "2026-09-22T08:00:00Z" };
  const cached = (texts: readonly string[]) => mocks.readPlaces.mockResolvedValue(texts.map((text) =>
    ({ textKey: keyOf(text), outcome: "resolved", placeId: `place:${text}`, lookedUpAt: "2026-09-01T00:00:00Z" })));
  /** Habit 10:00–10:30, then Gym 15:00–16:00, then home: three legs. */
  const twoStops = () => {
    located();
    mocks.source.mockResolvedValue({ ...source, behaviors: [source.behaviors[0]!,
      { id: "behavior-3", whereKind: "place" as const, locationText: "3 Gym St", updatedAt: "2026-09-20T00:00:00Z" }] });
    mocks.behaviors.mockResolvedValue([{ id: "behavior-1", default_duration_minutes: 30 }, { id: "behavior-3", default_duration_minutes: 60 }]);
    mocks.occurrences.mockImplementation(async (_client: unknown, _userId: unknown, start: string) => start === day.startLocalDate
      ? [occurrence("occurrence-1", "behavior-1", "2026-09-22T10:00:00Z"), occurrence("occurrence-3", "behavior-3", "2026-09-22T15:00:00Z")]
      : []);
    cached(["2 Habit St", "3 Gym St", "1 Base St"]);
  };
  const routedLegs = () => mocks.route.mock.calls.reduce((count, [input]) => count + input.routes.length, 0);
  const providerCalls = () => routedLegs() + mocks.geocode.mock.calls.length;

  it("reports the month's budget, and omits it when the read fails", async () => {
    located();
    mocks.monthSpend.mockResolvedValue(4_100_000);
    const result = await refreshTravelRoutes(caller, day, config, now);
    expect(mocks.monthSpend).toHaveBeenCalledWith(caller.client, "owner", "2026-09-01");
    expect(result.budget).toEqual({ reservedMicrodollars: 4_100_000, ceilingMicrodollars: 5_000_000, resetsAt: "2026-10-01T04:00:00Z" });
    located();
    mocks.monthSpend.mockRejectedValue(new Error("unavailable"));
    expect(await refreshTravelRoutes(caller, day, config, now)).not.toHaveProperty("budget");
  });

  it("routes only the named trip's legs and signs no conclusions for it", async () => {
    twoStops();
    const onward = { role: "onward", originRef: "occurrence-1", destinationRef: "occurrence-3" };
    const result = await refreshTravelRoutes(caller, { ...day, scope: "day", device, trips: [onward] }, config, now, undefined, "test-only-conclusions-secret-0123456789");
    expect(mocks.route.mock.calls[0]![0].routes).toHaveLength(1);
    expect(result.evidence?.legs.map((entry) => [entry.leg.role, entry.state, entry.reason])).toEqual([
      ["outbound", "unavailable", "outside_route_window"], ["onward", "current", null], ["return", "unavailable", "outside_route_window"],
    ]);
    expect(result).not.toHaveProperty("conclusionsToken");
  });

  it("serves a released Mac build's request as before, with only the budget added (Ticket 268)", async () => {
    // Released builds send the three-hour timeline scope, never trips, and read only the shipped fields.
    twoStops();
    const released = await refreshTravelRoutes(caller, { ...day, device, scope: "timeline" }, config, now, undefined, "test-only-conclusions-secret-0123456789");
    expect(Object.keys(released).sort()).toEqual(["accountId", "budget", "conclusionsToken", "evidence", "expiresAt", "habitsRevision", "mode", "navigationPreference", "settingsRevision"]);
    // The timeline scope still leaves the trip home, due after the window, for a later refresh.
    expect(released.evidence?.legs.at(-1)).toMatchObject({ leg: { role: "return" }, state: "unavailable", reason: "outside_route_window" });
    expect(released.evidence?.legs[0]).toMatchObject({ leg: { role: "outbound" }, state: "current" });
    expect(Object.keys(released.evidence!).sort()).toEqual(["behaviorSources", "collisions", "completeTrip", "finalAvailabilityAt", "journeyRef", "legs", "occupiedSpans", "segments", "unknownLegs", "version"]);
  });

  it("asserts provider calls for each trigger", async () => {
    // Every place is already stored, so each call below is a route leg. Transit doubles each leg in the provider.
    const counts: Record<string, number> = {};
    const timezone = "America/New_York";
    const at = (time: string) => `2026-09-22T${time}:00Z`;
    const homeSample = { latitude: device.latitude, longitude: device.longitude, accuracyMeters: device.accuracyMeters };
    const base: TravelRefreshPlanInput = { now: at("08:00"), timezone, timelineFocused: true, sourceKey: "s1", device: homeSample, trips: [], budget: null, last: null };
    const run = async (label: string, input: TravelRefreshPlanInput) => {
      twoStops();
      vi.clearAllMocks();
      twoStops();
      mocks.monthSpend.mockResolvedValue(0);
      mocks.spend.mockResolvedValue({ allowed: true, retryAfterSeconds: 0, resetsAt: null });
      mocks.route.mockImplementation(routeAll);
      mocks.historySessions.mockResolvedValue([]);
      mocks.weather.mockResolvedValue(null);
      const plan = resolveTravelRefreshPlan(input);
      if (plan.request) await refreshTravelRoutes(caller, { ...day, device, ...travelRefreshRequestFields(plan.request) }, config, Temporal.Instant.from(input.now));
      counts[label] = providerCalls();
      return plan;
    };

    // First open routes the whole day, and its evidence gives every trip a leave time.
    await run("first open", base);
    const evidence = (await refreshTravelRoutes(caller, { ...day, scope: "day", device }, config, now)).evidence!;
    const stops = [{ ref: "occurrence-1", startAt: at("10:00") }, { ref: "occurrence-3", startAt: at("15:00") }];
    const onwardKey = travelTripKey({ role: "onward", originRef: "occurrence-1", destinationRef: "occurrence-3" });
    const trips = travelRefreshTrips({ legs: evidence.legs, stops, arrivalBufferSeconds: 600 });
    const last = recordTravelRefresh(null, { kind: "day", trigger: "first_open" }, base);
    const onward = { role: "onward" as const, originRef: "occurrence-1", destinationRef: "occurrence-3" };
    // The test's fixed estimate gives the outbound and onward trips leave times; the trip home's fixture is rejected.
    expect(trips.map((trip) => [trip.key, trip.leaveAt])).toEqual([["outbound::occurrence-1", at("09:50")], [onwardKey, at("10:30")]]);
    const onwardOnly = [{ ...onward, key: onwardKey, leaveAt: at("14:20"), checkedAt: at("08:00"), fallbackAt: null }];

    await run("open with a last estimate", { ...base, now: at("09:00"), trips: onwardOnly, last });
    await run("3-hour refresh", { ...base, now: at("11:20"), trips: onwardOnly, last });
    await run("30-minute refresh", { ...base, now: at("13:50"), trips: onwardOnly,
      last: recordTravelRefresh(last, { kind: "trip", trigger: "trip_3h", trips: [onward] }, { ...base, now: at("11:20") }) });
    await run("fallback", { ...base, now: at("11:30"), trips: [{ ...onward, key: onwardKey, leaveAt: null, checkedAt: null, fallbackAt: at("11:30") }], last });
    await run("source change", { ...base, now: at("09:00"), sourceKey: "s2", trips: onwardOnly, last });
    // Ticket 268: movement refreshes only the next trip that leaves from the device.
    const outbound = { role: "outbound" as const, originRef: null, destinationRef: "occurrence-1" };
    await run("movement", { ...base, now: at("09:00"), device: { ...homeSample, latitude: 40.01 },
      trips: [{ ...outbound, key: travelTripKey(outbound), leaveAt: at("09:50"), checkedAt: at("08:00"), fallbackAt: null }, ...onwardOnly], last });
    await run("Refresh travel", { ...base, now: at("09:00"), refreshTravel: true, trips: onwardOnly, last });
    const budget = { reservedMicrodollars: 4_000_000, ceilingMicrodollars: 5_000_000, resetsAt: "2026-10-01T04:00:00Z" };
    await run("budget at 80%, 3-hour refresh", { ...base, now: at("11:20"), trips: onwardOnly, last, budget });
    await run("budget at 80%, first open", { ...base, budget });
    await run("budget at 80%, Refresh travel", { ...base, now: at("09:00"), refreshTravel: true, trips: onwardOnly, last, budget });

    expect(counts).toEqual({
      "first open": 3,
      "open with a last estimate": 0,
      "3-hour refresh": 1,
      "30-minute refresh": 1,
      "fallback": 1,
      "source change": 3,
      "movement": 1,
      "Refresh travel": 3,
      "budget at 80%, 3-hour refresh": 0,
      "budget at 80%, first open": 0,
      "budget at 80%, Refresh travel": 3,
    });
  });

  it("gives a trip longer than three hours its leave time on the first open, before it is due (C3)", async () => {
    twoStops();
    const long = { durationSeconds: 5 * 3600, departureAt: "2026-09-22T09:40:00Z", arrivalAt: "2026-09-22T14:40:00Z", warnings: [], fallback: false,
      attribution: "Google Maps", observedAt: now.toString(), expiresAt: "2026-09-22T08:05:00Z" };
    mocks.route.mockImplementation(async ({ routes }: { routes: { id: string }[] }) => routes.map((route) => ({ id: route.id, estimate: long, failure: null })));
    const result = await refreshTravelRoutes(caller, { ...day, scope: "day", device }, config, now);
    const onward = result.evidence!.legs.find((entry) => entry.leg.role === "onward")!;
    expect(onward.estimate).not.toBeNull();
    expect(Temporal.Instant.compare(now, Temporal.Instant.from(onward.estimate!.departureAt))).toBeLessThan(0);
  });

  it("routes no trip home from a stop at Home, and the day is still complete", async () => {
    located();
    mocks.source.mockResolvedValue({ ...source, behaviors: [{ id: "behavior-1", whereKind: "home", locationText: null, updatedAt: "2026-09-20T00:00:00Z" }] });
    cached(["1 Base St"]);
    const result = await refreshTravelRoutes(caller, { ...day, scope: "day", device }, config, now);
    expect(routedLegs()).toBe(1);
    expect(result.evidence?.legs.map((entry) => entry.leg.role)).toEqual(["outbound"]);
    expect(result.evidence?.completeTrip).toBe(true);
    // Free again when the Home stop ends, as the trip home from Home used to say.
    expect(result.evidence?.finalAvailabilityAt).toBe("2026-09-22T10:30:00Z");

    vi.clearAllMocks();
    located();
    mocks.source.mockResolvedValue({ ...source, behaviors: [{ id: "behavior-1", whereKind: "home", locationText: null, updatedAt: "2026-09-20T00:00:00Z" }] });
    cached(["1 Base St"]);
    mocks.monthSpend.mockResolvedValue(0);
    const atHome = await refreshTravelRoutes(caller, { ...day, scope: "day" }, config, now);
    expect(mocks.route).not.toHaveBeenCalled();
    expect(atHome.evidence).toMatchObject({ legs: [], unknownLegs: [], completeTrip: true, finalAvailabilityAt: "2026-09-22T10:30:00Z" });
  });

  it("routes no leg that could leave only after its destination ends", async () => {
    // Habit 10:00–11:00, then Gym 10:30–10:40: the trip to Gym is ready at 11:00, after Gym ends.
    twoStops();
    mocks.behaviors.mockResolvedValue([{ id: "behavior-1", default_duration_minutes: 60 }, { id: "behavior-3", default_duration_minutes: 10 }]);
    mocks.occurrences.mockImplementation(async (_client: unknown, _userId: unknown, start: string) => start === day.startLocalDate
      ? [occurrence("occurrence-1", "behavior-1", "2026-09-22T10:00:00Z"), occurrence("occurrence-3", "behavior-3", "2026-09-22T10:30:00Z")]
      : []);
    const result = await refreshTravelRoutes(caller, { ...day, scope: "day", device }, config, now);
    expect(routedLegs()).toBe(2);
    expect(mocks.route.mock.calls[0]![0].routes.map((route: { id: string }) => result.evidence!.legs.find((entry) => entry.leg.id === route.id)?.leg.role))
      .toEqual(["outbound", "return"]);
    expect(result.evidence?.legs.find((entry) => entry.leg.role === "onward")).toMatchObject({ state: "unavailable", estimate: null, reason: TRAVEL_LEG_READY_AFTER_END });
  });
});

describe("tomorrow's first trip (Ticket 282)", () => {
  /** 6 PM in New York. Tomorrow: Stretch at Home 7 AM, Dentist 9 AM, Gym 3 PM. */
  const evening = Temporal.Instant.from("2026-09-22T22:00:00Z");
  const tomorrow = { startLocalDate: "2026-09-23", endLocalDate: "2026-09-23", scope: "first_trip" };
  const secret = "s".repeat(64);
  const device = { latitude: 40, longitude: -74, accuracyMeters: 10, sampledAt: "2026-09-22T22:00:00Z" };
  const routedLegs = () => mocks.route.mock.calls.reduce((count, [input]) => count + input.routes.length, 0);
  const tomorrowDay = () => {
    mocks.source.mockResolvedValue({ ...source, behaviors: [source.behaviors[0]!,
      { id: "behavior-home", whereKind: "home" as const, locationText: null, updatedAt: "2026-09-20T00:00:00Z" },
      { id: "behavior-3", whereKind: "place" as const, locationText: "3 Gym St", updatedAt: "2026-09-20T00:00:00Z" }] });
    mocks.calendar.mockResolvedValue({ status: "disconnected", generation: 0, selectionRevision: 0 });
    mocks.behaviors.mockResolvedValue([{ id: "behavior-1", default_duration_minutes: 30 }, { id: "behavior-home", default_duration_minutes: 30 },
      { id: "behavior-3", default_duration_minutes: 60 }]);
    mocks.occurrences.mockImplementation(async (_client: unknown, _userId: unknown, start: string) => start === "2026-09-23" ? [
      { ...occurrence("stretch", "behavior-home", "2026-09-23T11:00:00Z"), local_date: "2026-09-23" },
      { ...occurrence("dentist", "behavior-1", "2026-09-23T13:00:00Z"), local_date: "2026-09-23" },
      { ...occurrence("gym", "behavior-3", "2026-09-23T19:00:00Z"), local_date: "2026-09-23" },
    ] : []);
    mocks.route.mockImplementation(async ({ routes }: { routes: { id: string }[] }) => routes.map((route) => ({ id: route.id, failure: null,
      estimate: { ...estimate, durationSeconds: 2400, departureAt: "2026-09-23T12:10:00Z", arrivalAt: "2026-09-23T12:50:00Z",
        observedAt: evening.toString(), expiresAt: evening.add({ minutes: 5 }).toString() } })));
  };

  it("routes one leg from Home to the first stop away from Home, with at most two lookups", async () => {
    tomorrowDay();
    const result = await refreshTravelRoutes(caller, { ...tomorrow, device }, config, evening, undefined, secret);
    // One route call for one leg. Lookups: Dentist's place and Home, never Gym's.
    expect(mocks.route).toHaveBeenCalledOnce();
    expect(routedLegs()).toBe(1);
    expect(mocks.geocode.mock.calls.map(([text]) => text).sort()).toEqual(["1 Base St", "2 Habit St"]);
    expect(mocks.spend).toHaveBeenCalledOnce();
    expect(mocks.weather).not.toHaveBeenCalled();
    const routed = result.evidence!.legs.find((entry) => entry.estimate)!;
    expect(routed.leg).toMatchObject({ role: "outbound", originCommitmentRef: null, destinationCommitmentRef: "dentist" });
    // From Home, never from the device position.
    expect(routed.leg.provenance.originSource).toBe("saved_base");
    expect(result.evidence!.legs.filter((entry) => !entry.estimate).map((entry) => entry.leg.role)).toEqual(["return"]);
    // Its own request: no signed conclusions, so today's token and the Daily Brief never include it.
    expect(result).not.toHaveProperty("conclusionsToken");
  });

  it("makes no lookup and one route call once the places are stored, and none with nothing to route", async () => {
    tomorrowDay();
    mocks.readPlaces.mockResolvedValue(["1 Base St", "2 Habit St"].map((text) =>
      ({ textKey: keyOf(text), outcome: "resolved", placeId: `place:${text}`, lookedUpAt: "2026-09-01T00:00:00Z" })));
    await refreshTravelRoutes(caller, tomorrow, config, evening);
    expect(mocks.geocode).not.toHaveBeenCalled();
    expect(routedLegs()).toBe(1);

    vi.clearAllMocks();
    tomorrowDay();
    mocks.readPlaces.mockResolvedValue([]);
    mocks.timezone.mockResolvedValue("America/New_York");
    mocks.monthSpend.mockResolvedValue(0);
    mocks.occurrences.mockImplementation(async (_client: unknown, _userId: unknown, start: string) => start === "2026-09-23"
      ? [{ ...occurrence("stretch", "behavior-home", "2026-09-23T11:00:00Z"), local_date: "2026-09-23" }] : []);
    const atHome = await refreshTravelRoutes(caller, tomorrow, config, evening);
    expect(mocks.geocode).not.toHaveBeenCalled();
    expect(mocks.route).not.toHaveBeenCalled();
    expect(atHome.evidence).toMatchObject({ legs: [], unknownLegs: [] });
  });

  it("reads Calendar from today, as every Calendar read must, and keeps only tomorrow's events", async () => {
    tomorrowDay();
    mocks.occurrences.mockResolvedValue([]);
    mocks.calendar.mockResolvedValue({ status: "connected", generation: 1, selectionRevision: 1 });
    const event = (id: string, startAt: string, endAt: string, location: string) => ({ id, calendarId: "primary", providerEventId: id, kind: "timed",
      state: "confirmed", currentUserResponse: "accepted", startAt, endAt, endUnspecified: false, location, conference: null,
      revision: { providerEtag: `etag-${id}`, providerUpdatedAt: null } });
    // 11:30 PM today in New York is already tomorrow in UTC; it is still today's event.
    mocks.events.mockResolvedValue({ requestedRange: { timezone: "America/New_York" }, events: [
      event("late-tonight", "2026-09-23T03:30:00Z", "2026-09-23T04:30:00Z", "9 Tonight St"),
      event("dentist", "2026-09-23T13:00:00Z", "2026-09-23T14:00:00Z", "4 Dentist St"),
    ] });
    const result = await refreshTravelRoutes(caller, tomorrow, config, evening);
    expect(mocks.events.mock.calls.map(([, start, end]) => [start, end])).toEqual([["2026-09-22", "2026-09-23"], ["2026-09-22", "2026-09-23"]]);
    expect(routedLegs()).toBe(1);
    expect(result.evidence!.legs.find((entry) => entry.estimate)!.leg).toMatchObject({ role: "outbound", destinationCommitmentRef: "dentist" });
    expect(mocks.geocode.mock.calls.map(([text]) => text)).not.toContain("9 Tonight St");
  });

  it("refuses a first-trip request for any day but tomorrow, before any provider call", async () => {
    tomorrowDay();
    for (const date of ["2026-09-22", "2026-09-24"]) {
      await expect(refreshTravelRoutes(caller, { ...tomorrow, startLocalDate: date, endLocalDate: date }, config, evening))
        .rejects.toMatchObject({ failure: { code: "context_changed" } });
    }
    expect(mocks.geocode).not.toHaveBeenCalled();
    expect(mocks.route).not.toHaveBeenCalled();
  });

  it("checks tomorrow in the account's timezone late at night, when UTC is already on the next day", async () => {
    // 11:30 PM on September 22 in New York is September 23 in UTC.
    const lateNight = Temporal.Instant.from("2026-09-23T03:30:00Z");
    tomorrowDay();
    await expect(refreshTravelRoutes(caller, { ...tomorrow, startLocalDate: "2026-09-24", endLocalDate: "2026-09-24" }, config, lateNight))
      .rejects.toMatchObject({ failure: { code: "context_changed" } });
    expect(mocks.route).not.toHaveBeenCalled();
    await refreshTravelRoutes(caller, tomorrow, config, lateNight);
    expect(routedLegs()).toBe(1);
  });

  it("leaves today's signed conclusions unchanged", async () => {
    // The same route answers for all three requests.
    tomorrowDay();
    located("2026-09-23T01:00:00Z");
    const before = await refreshTravelRoutes(caller, { ...day, scope: "day" }, config, evening, undefined, secret);
    tomorrowDay();
    await refreshTravelRoutes(caller, tomorrow, config, evening, undefined, secret);
    located("2026-09-23T01:00:00Z");
    const after = await refreshTravelRoutes(caller, { ...day, scope: "day" }, config, evening, undefined, secret);
    expect(before.conclusionsToken).toBeTruthy();
    expect(after.conclusionsToken).toBe(before.conclusionsToken);
  });
});

describe("refreshTravelRoutes with Outlook and iCloud events (Ticket 283)", () => {
  const connected = (generation = 1) => ({ status: "connected", generation, selectionRevision: 1, preferences: { selectedSourceIds: ["cal-1"] } });
  const event = (id: string, startAt: string, endAt: string, location = `${id} St`, extra: Record<string, unknown> = {}) => ({
    id, kind: "timed", state: "unknown", currentUserResponse: null, calendarId: "cal-1", providerEventId: id, startAt, endAt,
    endUnspecified: false, location, conference: null, revision: { providerEtag: id, providerUpdatedAt: null }, ...extra,
  });
  const snapshot = (events: readonly Record<string, unknown>[]) => ({ requestedRange: { timezone: "America/New_York" }, events });
  const fromReady = (leg: { id: string; request: { readyAt: string } }) => ({ id: leg.id, failure: null, estimate: { ...estimate,
    departureAt: leg.request.readyAt, arrivalAt: Temporal.Instant.from(leg.request.readyAt).add({ seconds: 600 }).toString(), durationSeconds: 600 } });
  const google = event("g1", "2026-09-22T10:00:00Z", "2026-09-22T11:00:00Z", "Google St", { state: "confirmed", currentUserResponse: "accepted", calendarId: "primary" });
  const outlook = event("outlook_calendar/o1", "2026-09-22T12:00:00Z", "2026-09-22T13:00:00Z", "Outlook St");
  const icloud = event("icloud_calendar/i1", "2026-09-22T14:00:00Z", "2026-09-22T15:00:00Z", "iCloud St");
  const setUp = (input: Readonly<{ google?: readonly Record<string, unknown>[] | null; outlook?: readonly Record<string, unknown>[]; icloud?: readonly Record<string, unknown>[] }>) => {
    mocks.source.mockResolvedValue({ ...source, behaviors: [] });
    mocks.behaviors.mockResolvedValue([]);
    mocks.occurrences.mockResolvedValue([]);
    mocks.calendar.mockResolvedValue(input.google ? { status: "connected", generation: 1, selectionRevision: 1 } : { status: "disconnected", generation: 0, selectionRevision: 0 });
    mocks.events.mockResolvedValue(snapshot(input.google ?? []));
    if (input.outlook) { mocks.outlook.mockResolvedValue(connected()); mocks.outlookEvents.mockResolvedValue(snapshot(input.outlook)); }
    if (input.icloud) { mocks.icloud.mockResolvedValue(connected()); mocks.icloudEvents.mockResolvedValue(snapshot(input.icloud)); }
    mocks.route.mockImplementation(async ({ routes }: { routes: { id: string; request: { readyAt: string } }[] }) => routes.map(fromReady));
  };
  const legs = (result: Awaited<ReturnType<typeof refreshTravelRoutes>>) =>
    result.evidence?.legs.map((entry) => [entry.leg.role, entry.leg.originCommitmentRef, entry.leg.destinationCommitmentRef]);

  it("routes all three Calendars' located events under the same rules, reading locations for this request only", async () => {
    setUp({ google: [google],
      outlook: [outlook, event("outlook_calendar/declined", "2026-09-22T12:30:00Z", "2026-09-22T12:45:00Z", "Declined St", { currentUserResponse: "declined" }),
        event("outlook_calendar/call", "2026-09-22T13:15:00Z", "2026-09-22T13:30:00Z", "")],
      icloud: [icloud, event("icloud_calendar/past", "2026-09-22T06:00:00Z", "2026-09-22T07:00:00Z", "Past St")] });
    const result = await refreshTravelRoutes(caller, { ...day, scope: "day" }, config, now);
    expect(mocks.outlookEvents).toHaveBeenCalledWith(caller, "2026-09-22", "2026-09-22", { includeLocation: true });
    expect(mocks.icloudEvents).toHaveBeenCalledWith(caller, "2026-09-22", "2026-09-22", { includeLocation: true });
    expect(legs(result)).toEqual([
      ["outbound", null, "g1"], ["onward", "g1", "outlook_calendar/o1"], ["onward", "outlook_calendar/o1", "icloud_calendar/i1"], ["return", "icloud_calendar/i1", null],
    ]);
    expect(mocks.geocode.mock.calls.map(([text]) => text).sort()).toEqual(["1 Base St", "Google St", "Outlook St", "iCloud St"]);
    const serialized = JSON.stringify(result);
    for (const text of ["Outlook St", "iCloud St", "Declined St", "Past St", "outlook_calendar/call"]) expect(serialized).not.toContain(text);
  });

  it("reads Outlook and iCloud only when connected with a calendar selected", async () => {
    setUp({ google: [google] });
    mocks.outlook.mockResolvedValue({ ...connected(), preferences: { selectedSourceIds: [] } });
    mocks.icloud.mockResolvedValue({ ...connected(), status: "reconnect_required" });
    const result = await refreshTravelRoutes(caller, { ...day, scope: "day" }, config, now);
    expect(mocks.outlookEvents).not.toHaveBeenCalled();
    expect(mocks.icloudEvents).not.toHaveBeenCalled();
    expect(legs(result)).toEqual([["outbound", null, "g1"], ["return", "g1", null]]);
  });

  it("routes Outlook events without a Google Calendar connection", async () => {
    setUp({ google: null, outlook: [outlook] });
    const result = await refreshTravelRoutes(caller, { ...day, scope: "day" }, config, now);
    expect(mocks.events).not.toHaveBeenCalled();
    expect(legs(result)).toEqual([["outbound", null, "outlook_calendar/o1"], ["return", "outlook_calendar/o1", null]]);
  });

  it("leaves out an Outlook or iCloud Calendar that cannot be read and routes the others, with no brief token", async () => {
    const secret = "s".repeat(64);
    setUp({ google: [google], icloud: [icloud] });
    mocks.icloudEvents.mockRejectedValue(new ConnectorError("rate_limited"));
    const result = await refreshTravelRoutes(caller, { ...day, scope: "day" }, config, now, undefined, secret);
    expect(legs(result)).toEqual([["outbound", null, "g1"], ["return", "g1", null]]);
    // The final check does not read the left-out Calendar again.
    expect(mocks.icloudEvents).toHaveBeenCalledTimes(1);
    expect(mocks.events).toHaveBeenCalledTimes(2);
    expect(result).not.toHaveProperty("conclusionsToken");
  });

  it("still fails before any spend on an invalid Outlook or iCloud request, a non-connector error, or a Google failure", async () => {
    for (const failure of [new ConnectorError("invalid_request"), new Error("boom")]) {
      setUp({ google: [google], outlook: [outlook] });
      mocks.outlookEvents.mockRejectedValue(failure);
      await expect(refreshTravelRoutes(caller, { ...day, scope: "day" }, config, now)).rejects.toBe(failure);
    }
    setUp({ google: [google], outlook: [outlook] });
    mocks.events.mockRejectedValue(Object.assign(new Error("rate_limited"), { code: "rate_limited" }));
    await expect(refreshTravelRoutes(caller, { ...day, scope: "day" }, config, now)).rejects.toMatchObject({ code: "rate_limited" });
    expect(mocks.spend).not.toHaveBeenCalled();
    expect(mocks.route).not.toHaveBeenCalled();
  });

  it("fails when a Calendar read at the start fails in the final check", async () => {
    setUp({ google: [google], icloud: [icloud] });
    mocks.icloudEvents.mockResolvedValueOnce(snapshot([icloud])).mockRejectedValueOnce(new ConnectorError("timeout"));
    await expect(refreshTravelRoutes(caller, { ...day, scope: "day" }, config, now)).rejects.toMatchObject({ code: "timeout" });
  });

  it("withdraws the refresh when an Outlook connection or an iCloud event changes during it", async () => {
    setUp({ google: [google], outlook: [outlook] });
    let checks = 0;
    mocks.outlook.mockImplementation(async () => connected((checks += 1) < 2 ? 1 : 2));
    await expect(refreshTravelRoutes(caller, { ...day, scope: "day" }, config, now)).rejects.toMatchObject({ failure: { code: "context_changed" } });

    vi.clearAllMocks();
    setUp({ google: [google], icloud: [icloud] });
    mocks.outlook.mockResolvedValue({ status: "disconnected", generation: 0, selectionRevision: 0, preferences: { selectedSourceIds: [] } });
    mocks.timezone.mockResolvedValue("America/New_York");
    mocks.monthSpend.mockResolvedValue(0);
    mocks.readPlaces.mockResolvedValue([]);
    mocks.spend.mockResolvedValue({ allowed: true, retryAfterSeconds: 0, resetsAt: null });
    mocks.geocode.mockImplementation(async (text: string) => ({ kind: "resolved", point: { kind: "place_id", placeId: `place:${text}` } }));
    mocks.historySessions.mockResolvedValue([]);
    mocks.icloudEvents.mockResolvedValueOnce(snapshot([icloud])).mockResolvedValueOnce(snapshot([{ ...icloud, revision: { providerEtag: "moved", providerUpdatedAt: null } }]));
    await expect(refreshTravelRoutes(caller, { ...day, scope: "day" }, config, now)).rejects.toMatchObject({ failure: { code: "context_changed" } });
  });

  it("signs the Daily Brief's conclusions only when every Calendar stop is a Google event", async () => {
    const secret = "s".repeat(64);
    setUp({ google: [google], outlook: [outlook] });
    const mixed = await refreshTravelRoutes(caller, { ...day, scope: "day" }, config, now, undefined, secret);
    expect(mixed).not.toHaveProperty("conclusionsToken");

    vi.clearAllMocks();
    setUp({ google: [google], outlook: [{ ...outlook, location: "" }] });
    mocks.icloud.mockResolvedValue({ status: "disconnected", generation: 0, selectionRevision: 0, preferences: { selectedSourceIds: [] } });
    mocks.timezone.mockResolvedValue("America/New_York");
    mocks.monthSpend.mockResolvedValue(0);
    mocks.readPlaces.mockResolvedValue([]);
    mocks.spend.mockResolvedValue({ allowed: true, retryAfterSeconds: 0, resetsAt: null });
    mocks.geocode.mockImplementation(async (text: string) => ({ kind: "resolved", point: { kind: "place_id", placeId: `place:${text}` } }));
    mocks.historySessions.mockResolvedValue([]);
    const googleOnly = await refreshTravelRoutes(caller, { ...day, scope: "day" }, config, now, undefined, secret);
    const payload = verifyTravelConclusionsToken(googleOnly.conclusionsToken!, { secrets: { current: secret, previous: null }, userId: "owner", localDate: day.startLocalDate, now });
    expect(Object.keys(payload!.events)).toEqual(["event:primary\0g1"]);
  });

  it("reads Outlook from today for tomorrow's first trip and keeps only tomorrow's events (Ticket 282)", async () => {
    const evening = Temporal.Instant.from("2026-09-22T22:00:00Z");
    setUp({ google: null, outlook: [event("outlook_calendar/today", "2026-09-22T23:00:00Z", "2026-09-22T23:30:00Z", "Late St"),
      event("outlook_calendar/dentist", "2026-09-23T13:00:00Z", "2026-09-23T14:00:00Z", "Dentist St")] });
    mocks.route.mockImplementation(async ({ routes }: { routes: { id: string }[] }) => routes.map((route) => ({ id: route.id, failure: null,
      estimate: { ...estimate, departureAt: "2026-09-23T12:40:00Z", arrivalAt: "2026-09-23T12:50:00Z", observedAt: evening.toString(), expiresAt: evening.add({ minutes: 5 }).toString() } })));
    const result = await refreshTravelRoutes(caller, { startLocalDate: "2026-09-23", endLocalDate: "2026-09-23", scope: "first_trip" }, config, evening);
    expect(mocks.outlookEvents).toHaveBeenCalledWith(caller, "2026-09-22", "2026-09-23", { includeLocation: true });
    expect(result.evidence!.legs.find((entry) => entry.estimate)!.leg).toMatchObject({ role: "outbound", destinationCommitmentRef: "outlook_calendar/dentist" });
    expect(mocks.geocode.mock.calls.map(([text]) => text)).not.toContain("Late St");
  });
});
