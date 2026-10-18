import { createHash } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  source: vi.fn(), calendar: vi.fn(), events: vi.fn(), spend: vi.fn(), readPlaces: vi.fn(), writePlaces: vi.fn(),
  occurrences: vi.fn(), behaviors: vi.fn(), timezone: vi.fn(), geocode: vi.fn(), route: vi.fn(),
  historySessions: vi.fn(),
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
vi.mock("@/lib/services/travel-routing.service", async (load) => ({
  ...(await load<typeof import("@/lib/services/travel-routing.service")>()),
  routeTravelLegs: mocks.route,
}));

import { refreshTravelRoutes } from "@/lib/services/travel-route-refresh.service";

const now = Temporal.Instant.from("2026-09-22T08:00:00Z");
const source = {
  settings: { enabled: true, mode: "walking" as const, routingConsentAt: "2026-09-20T00:00:00Z", baseLocationText: "1 Base St", navigationPreference: "google_maps" as const },
  settingsRevision: "settings-1", behaviors: [
    { id: "behavior-1", locationText: "2 Habit St", updatedAt: "2026-09-20T00:00:00Z" },
    { id: "behavior-2", locationText: null, updatedAt: "2026-09-20T00:00:00Z" },
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
    const behaviors = Array.from({ length: 9 }, (_, index) => ({ id: `b${index}`, locationText: `${index} Test St`, updatedAt: "revision" }));
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
    mocks.source.mockResolvedValue({ ...source, settings: { ...source.settings, baseLocationText: null }, behaviors: [{ id: "behavior-1", locationText: null, updatedAt: "2026-09-20T00:00:00Z" }] });
    const result = await refreshTravelRoutes(caller, day, config, now);
    expect(result.evidence).not.toBeNull();
    expect(mocks.spend).not.toHaveBeenCalled();
    expect(mocks.geocode).not.toHaveBeenCalled();
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

  it("rejects the refresh when a source changes before returning", async () => {
    located();
    let reads = 0;
    mocks.source.mockImplementation(async () => (reads += 1) < 3 ? source : { ...source, settingsRevision: "settings-2" });
    await expect(refreshTravelRoutes(caller, day, config, now)).rejects.toMatchObject({ failure: { code: "context_changed" } });
  });
});
