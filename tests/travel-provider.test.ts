import { Temporal } from "@js-temporal/polyfill";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TravelRouteRequest } from "@cadence/core/types/travel";
import { computeGoogleRoute, geocodeGoogleAddress, readTravelProviderConfig, travelRouteMicrodollars } from "@/lib/services/travel-provider";
import { TravelRoutingError, routeTravelLegs } from "@/lib/services/travel-routing.service";

const NOW = Temporal.Instant.from("2026-09-22T12:00:00Z");
const REQUEST: TravelRouteRequest = {
  origin: { kind: "coordinates", latitude: 40.7, longitude: -74 },
  destination: { kind: "place_id", placeId: "place-id" },
  mode: "cycling",
  readyAt: "2026-09-22T12:00:00Z",
  timing: { kind: "depart_at", at: "2026-09-22T13:00:00Z" },
};
const APPROVED = { cleared: true, apiKey: "test-key" } as const;

function hostedConfig(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1_000);
  const claims = {
    iss: "https://oidc.vercel.com/emis-projects-4c886aeb",
    aud: "https://vercel.com/emis-projects-4c886aeb",
    sub: "owner:emis-projects-4c886aeb:project:cadence:environment:production",
    owner_id: "team_BxWfRYU1gqrl6Ba6t7Vm3wp1",
    project_id: "prj_9tZKRXZ6IdT56ZLKVSmoJH5AAYhs",
    environment: "production",
    iat: now - 60,
    nbf: now - 60,
    exp: now + 3_600,
    ...overrides,
  };
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return {
    cleared: true,
    apiKey: null,
    authMode: "workload_identity" as const,
    workloadIdentity: {
      projectId: "habit-tracker-498717",
      provider: "//iam.googleapis.com/projects/646154863146/locations/global/workloadIdentityPools/vercel-cadence/providers/cadence-production",
      serviceAccountEmail: "cadence-travel@habit-tracker-498717.iam.gserviceaccount.com",
      subjectToken: `${encode({ alg: "RS256", typ: "JWT" })}.${encode(claims)}.signature`,
      expectedIssuer: "https://oidc.vercel.com/emis-projects-4c886aeb",
      expectedAudience: "https://vercel.com/emis-projects-4c886aeb",
      expectedSubject: "owner:emis-projects-4c886aeb:project:cadence:environment:production",
      expectedOwnerId: "team_BxWfRYU1gqrl6Ba6t7Vm3wp1",
      expectedProjectId: "prj_9tZKRXZ6IdT56ZLKVSmoJH5AAYhs",
      expectedEnvironment: "production",
    },
  } as const;
}

/** Exact hostname of a mocked fetch input; CodeQL rejects substring checks on the whole URL. */
const hostOf = (input: RequestInfo | URL): string => new URL(String(input)).hostname;

function authResponses() {
  return [
    Response.json({ access_token: "federated-token", token_type: "Bearer", expires_in: 3_600 }),
    Response.json({ accessToken: "google-access-token", expireTime: new Date(Date.now() + 900_000).toISOString() }),
  ];
}

describe("travel provider", () => {
  beforeEach(() => { vi.spyOn(Temporal.Now, "instant").mockReturnValue(NOW); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("fails before a location request when clearance is absent", async () => {
    const fetch = vi.fn();
    await expect(geocodeGoogleAddress("One Main St", { config: { cleared: false, apiKey: "key" }, fetch })).rejects.toMatchObject({ code: "provider_clearance_required" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reads the request-scoped Vercel token only for configured workload identity", () => {
    const env = {
      CADENCE_TRAVEL_PROVIDER_CLEARANCE: "approved",
      CADENCE_TRAVEL_GOOGLE_AUTH_MODE: "workload_identity",
      GOOGLE_CLOUD_PROJECT_ID: "habit-tracker-498717",
      GOOGLE_CLOUD_WORKLOAD_IDENTITY_PROVIDER: "//iam.googleapis.com/projects/646154863146/locations/global/workloadIdentityPools/vercel-cadence/providers/cadence-production",
      GOOGLE_CLOUD_TRAVEL_SERVICE_ACCOUNT_EMAIL: "cadence-travel@habit-tracker-498717.iam.gserviceaccount.com",
      CADENCE_TRAVEL_VERCEL_OIDC_ISSUER: "https://oidc.vercel.com/emis-projects-4c886aeb",
      CADENCE_TRAVEL_VERCEL_OIDC_AUDIENCE: "https://vercel.com/emis-projects-4c886aeb",
      CADENCE_TRAVEL_VERCEL_OIDC_SUBJECT: "owner:emis-projects-4c886aeb:project:cadence:environment:production",
      CADENCE_TRAVEL_VERCEL_OIDC_OWNER_ID: "team_BxWfRYU1gqrl6Ba6t7Vm3wp1",
      CADENCE_TRAVEL_VERCEL_OIDC_PROJECT_ID: "prj_9tZKRXZ6IdT56ZLKVSmoJH5AAYhs",
      CADENCE_TRAVEL_VERCEL_OIDC_ENVIRONMENT: "production",
    };
    expect(readTravelProviderConfig(env).workloadIdentity).toBeNull();
    expect(readTravelProviderConfig(env, "request-token").workloadIdentity?.subjectToken).toBe("request-token");
  });

  it("fails closed before auth exchange when immutable Vercel claims differ", async () => {
    const fetch = vi.fn();
    const promise = geocodeGoogleAddress("One Main St", {
      config: hostedConfig({ project_id: "prj_wrong" }), fetch,
    });
    await expect(promise).rejects.toMatchObject({ code: "not_configured", message: "not_configured" });
    await promise.catch((error: unknown) => {
      expect(String(error)).not.toContain("sts.googleapis.com");
      expect(String(error)).not.toContain("iamcredentials.googleapis.com");
      expect(String(error)).not.toContain("signature");
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses bounded OAuth exchange and Geocoding v4 without exposing credentials in the URL", async () => {
    const [sts, iam] = authResponses();
    const fetch = vi.fn()
      .mockResolvedValueOnce(sts)
      .mockResolvedValueOnce(iam)
      .mockResolvedValueOnce(Response.json({ results: [{
        placeId: "exact-place", granularity: "ROOFTOP", types: ["street_address"],
      }] }));
    await expect(geocodeGoogleAddress("One Main St", { config: hostedConfig(), fetch })).resolves.toEqual({
      kind: "resolved", point: { kind: "place_id", placeId: "exact-place" },
    });
    expect(String(fetch.mock.calls[0]![0])).toBe("https://sts.googleapis.com/v1/token");
    expect(String(fetch.mock.calls[1]![0])).toContain("iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/");
    const geocodeUrl = String(fetch.mock.calls[2]![0]);
    expect(geocodeUrl).toContain("https://geocode.googleapis.com/v4/geocode/address/One%20Main%20St");
    expect(geocodeUrl).not.toContain("key=");
    expect(fetch.mock.calls[2]![1].headers).toMatchObject({
      Authorization: "Bearer google-access-token",
      "X-Goog-User-Project": "habit-tracker-498717",
      "X-Goog-FieldMask": "results.placeId,results.granularity,results.types",
    });
  });

  it("rejects multiple or coarse Geocoding v4 candidates", async () => {
    const [sts, iam] = authResponses();
    const fetch = vi.fn()
      .mockResolvedValueOnce(sts)
      .mockResolvedValueOnce(iam)
      .mockResolvedValueOnce(Response.json({ results: [
        { placeId: "first", granularity: "ROOFTOP", types: ["street_address"] },
        { placeId: "second", granularity: "ROOFTOP", types: ["street_address"] },
      ] }));
    await expect(geocodeGoogleAddress("Main St", { config: hostedConfig(), fetch })).resolves.toEqual({ kind: "ambiguous" });

    const [coarseSts, coarseIam] = authResponses();
    const coarse = vi.fn()
      .mockResolvedValueOnce(coarseSts)
      .mockResolvedValueOnce(coarseIam)
      .mockResolvedValueOnce(Response.json({ results: [{ placeId: "city", granularity: "APPROXIMATE", types: ["locality"] }] }));
    await expect(geocodeGoogleAddress("New York", { config: hostedConfig(), fetch: coarse })).resolves.toEqual({ kind: "ambiguous" });
  });

  it("resolves precise venue geocodes and keeps coarse ones ambiguous on the hosted path", async () => {
    const [venueSts, venueIam] = authResponses();
    const venue = vi.fn()
      .mockResolvedValueOnce(venueSts)
      .mockResolvedValueOnce(venueIam)
      .mockResolvedValueOnce(Response.json({ results: [{ placeId: "venue", granularity: "ROOFTOP", types: ["establishment", "point_of_interest"] }] }));
    await expect(geocodeGoogleAddress("Norris University Center, 1999 Campus Dr, Evanston, IL 60208", { config: hostedConfig(), fetch: venue }))
      .resolves.toEqual({ kind: "resolved", point: { kind: "place_id", placeId: "venue" } });

    const [citySts, cityIam] = authResponses();
    const city = vi.fn()
      .mockResolvedValueOnce(citySts)
      .mockResolvedValueOnce(cityIam)
      .mockResolvedValueOnce(Response.json({ results: [{ placeId: "city", granularity: "ROOFTOP", types: ["locality", "political"] }] }));
    await expect(geocodeGoogleAddress("Evanston", { config: hostedConfig(), fetch: city })).resolves.toEqual({ kind: "ambiguous" });

    const [centerSts, centerIam] = authResponses();
    const center = vi.fn()
      .mockResolvedValueOnce(centerSts)
      .mockResolvedValueOnce(centerIam)
      .mockResolvedValueOnce(Response.json({ results: [{ placeId: "center", granularity: "GEOMETRIC_CENTER", types: ["establishment"] }] }));
    await expect(geocodeGoogleAddress("Somewhere", { config: hostedConfig(), fetch: center })).resolves.toEqual({ kind: "ambiguous" });
  });

  it("scans past the first eight types before accepting a hosted geocode", async () => {
    const [sts, iam] = authResponses();
    const fetch = vi.fn()
      .mockResolvedValueOnce(sts)
      .mockResolvedValueOnce(iam)
      .mockResolvedValueOnce(Response.json({ results: [{ placeId: "deep-coarse", granularity: "ROOFTOP",
        types: ["establishment", "point_of_interest", "food", "restaurant", "store", "cafe", "bar", "lodging", "tourist_attraction", "locality"] }] }));
    await expect(geocodeGoogleAddress("Deep Types", { config: hostedConfig(), fetch })).resolves.toEqual({ kind: "ambiguous" });
  });

  it("reuses the short-lived OAuth token for route calls with the same request config", async () => {
    const config = hostedConfig();
    const [sts, iam] = authResponses();
    const fetch = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      void _init;
      const host = hostOf(input);
      if (host === "sts.googleapis.com") return sts;
      if (host === "iamcredentials.googleapis.com") return iam;
      if (host === "geocode.googleapis.com") return Response.json({ results: [{ placeId: "exact", granularity: "ROOFTOP", types: ["street_address"] }] });
      return Response.json({ routes: [{ duration: "600s" }] });
    });
    await geocodeGoogleAddress("One Main St", { config, fetch });
    await computeGoogleRoute(REQUEST, { config, now: NOW, fetch });
    expect(fetch.mock.calls.filter(([input]) => hostOf(input) === "sts.googleapis.com")).toHaveLength(1);
    expect(fetch.mock.calls.filter(([input]) => hostOf(input) === "iamcredentials.googleapis.com")).toHaveLength(1);
    const routeCall = fetch.mock.calls.find(([input]) => hostOf(input) === "routes.googleapis.com");
    expect(routeCall?.[1]?.headers).toMatchObject({
      Authorization: "Bearer google-access-token",
      "X-Goog-User-Project": "habit-tracker-498717",
    });
  });

  it("sends only the selected route mode and narrow field mask", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ routes: [{ duration: "600s", warnings: [] }] }));
    const result = await computeGoogleRoute(REQUEST, { config: APPROVED, now: NOW, fetch });
    const [, init] = fetch.mock.calls[0]!;
    expect(JSON.parse(init.body)).toMatchObject({ travelMode: "BICYCLE", computeAlternativeRoutes: false });
    expect(init.headers["X-Goog-FieldMask"]).toContain("routes.duration");
    expect(init.headers["X-Goog-FieldMask"]).not.toContain("polyline");
    expect(result).toMatchObject({ durationSeconds: 600, departureAt: "2026-09-22T13:00:00Z", arrivalAt: "2026-09-22T13:10:00Z", fallback: false, attribution: "Google Maps" });
  });

  it("uses arrivalTime only for transit", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ routes: [{ duration: "1500s", legs: [{ steps: [
      { travelMode: "WALK", staticDuration: "120s" },
      { travelMode: "TRANSIT", transitDetails: { stopDetails: { departureTime: "2026-09-22T12:05:00Z", arrivalTime: "2026-09-22T12:20:00Z" } } },
      { travelMode: "WALK", staticDuration: "180s" },
    ] }] }] }));
    await expect(computeGoogleRoute({ ...REQUEST, mode: "transit", timing: { kind: "arrive_by", at: "2026-09-22T13:00:00Z" } }, { config: APPROVED, now: NOW, fetch })).resolves.toMatchObject({ durationSeconds: 1200, departureAt: "2026-09-22T12:03:00Z", arrivalAt: "2026-09-22T12:23:00Z" });
    expect(JSON.parse(fetch.mock.calls[0]![1].body)).toMatchObject({ travelMode: "TRANSIT", arrivalTime: "2026-09-22T13:00:00Z" });
    const driving = vi.fn().mockResolvedValue(Response.json({ routes: [{ duration: "600s", warnings: ["traffic"] }] }));
    const drivingResult = await computeGoogleRoute({ ...REQUEST, mode: "driving", timing: { kind: "arrive_by", at: "2026-09-22T13:00:00Z" } }, { config: APPROVED, now: NOW, fetch: driving });
    // One traffic-aware call from the earliest possible start; no refinement call (Ticket 214).
    expect(driving).toHaveBeenCalledOnce();
    expect(JSON.parse(driving.mock.calls[0]![1].body)).toMatchObject({ departureTime: "2026-09-22T12:00:10Z", routingPreference: "TRAFFIC_AWARE_OPTIMAL" });
    expect(JSON.parse(driving.mock.calls[0]![1].body)).not.toHaveProperty("arrivalTime");
    expect(drivingResult).toMatchObject({ departureAt: "2026-09-22T12:50:00Z", arrivalAt: "2026-09-22T13:00:00Z", warnings: ["traffic"] });
  });

  it("uses static Essentials routing for driving legs beyond the traffic window", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ routes: [{ duration: "900s" }] }));
    const later = { ...REQUEST, mode: "driving" as const, timing: { kind: "arrive_by" as const, at: "2026-09-22T18:00:00Z" } };
    await expect(computeGoogleRoute(later, { config: APPROVED, now: NOW, fetch })).resolves.toMatchObject({ departureAt: "2026-09-22T17:45:00Z", arrivalAt: "2026-09-22T18:00:00Z" });
    const body = JSON.parse(fetch.mock.calls[0]![1].body);
    expect(body).toMatchObject({ travelMode: "DRIVE", routingPreference: "TRAFFIC_UNAWARE" });
    expect(body).not.toHaveProperty("departureTime");
    expect(body).not.toHaveProperty("arrivalTime");
    expect(fetch).toHaveBeenCalledOnce();
    expect(travelRouteMicrodollars(later, NOW)).toBe(5_000);
    expect(travelRouteMicrodollars({ ...later, timing: { kind: "arrive_by", at: "2026-09-22T13:00:00Z" } }, NOW)).toBe(10_000);
    expect(travelRouteMicrodollars({ ...REQUEST, mode: "transit" }, NOW)).toBe(10_000);
    expect(travelRouteMicrodollars(REQUEST, NOW)).toBe(5_000);
  });

  it("rejects ambiguous or coarse geocodes", async () => {
    const coarse = vi.fn().mockResolvedValue(Response.json({ status: "OK", results: [{ place_id: "city", types: ["locality"], geometry: { location_type: "GEOMETRIC_CENTER" } }] }));
    await expect(geocodeGoogleAddress("New York", { config: APPROVED, fetch: coarse })).resolves.toEqual({ kind: "ambiguous" });
    const many = vi.fn().mockResolvedValue(Response.json({ status: "OK", results: Array.from({ length: 6 }, (_, index) => ({ place_id: `p${index}`, types: ["street_address"], geometry: { location_type: "ROOFTOP" } })) }));
    await expect(geocodeGoogleAddress("Main", { config: APPROVED, fetch: many })).resolves.toEqual({ kind: "ambiguous" });
  });

  it("resolves precise venue geocodes and keeps coarse ones ambiguous on the api key path", async () => {
    const venue = vi.fn().mockResolvedValue(Response.json({ status: "OK", results: [{ place_id: "venue", types: ["establishment", "point_of_interest"], geometry: { location_type: "ROOFTOP" } }] }));
    await expect(geocodeGoogleAddress("Museum of Contemporary Art Chicago, 220 E Chicago Ave, Chicago, IL 60611", { config: APPROVED, fetch: venue }))
      .resolves.toEqual({ kind: "resolved", point: { kind: "place_id", placeId: "venue" } });
    const city = vi.fn().mockResolvedValue(Response.json({ status: "OK", results: [{ place_id: "city", types: ["locality", "political"], geometry: { location_type: "ROOFTOP" } }] }));
    await expect(geocodeGoogleAddress("Chicago", { config: APPROVED, fetch: city })).resolves.toEqual({ kind: "ambiguous" });
    const center = vi.fn().mockResolvedValue(Response.json({ status: "OK", results: [{ place_id: "center", types: ["establishment"], geometry: { location_type: "GEOMETRIC_CENTER" } }] }));
    await expect(geocodeGoogleAddress("Somewhere", { config: APPROVED, fetch: center })).resolves.toEqual({ kind: "ambiguous" });
  });

  it("reports denied geocoding requests as provider failures", async () => {
    const fetch = vi.fn(async () => Response.json({ status: "REQUEST_DENIED", results: [] }));
    await expect(geocodeGoogleAddress("One Main St", { config: APPROVED, fetch, maxRetries: 0 }))
      .rejects.toMatchObject({ code: "provider_unavailable" });
  });

  it("retries a transient provider failure once", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ routes: [{ duration: "600s" }] }));
    await expect(computeGoogleRoute(REQUEST, { config: APPROVED, now: NOW, fetch, maxRetries: 1 })).resolves.toMatchObject({ durationSeconds: 600 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("makes no provider call when the budget refuses the batch reservation", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ routes: [{ duration: "600s" }] }));
    const reserve = vi.fn(async () => { throw new TravelRoutingError({ code: "quota_exceeded", retryable: true, retryAfterSeconds: 60, resetsAt: "2026-10-01T04:00:00Z" }); });
    await expect(routeTravelLegs({ routes: [{ id: "outbound", request: REQUEST }], provider: APPROVED, reserve, now: NOW, fetch }))
      .rejects.toMatchObject({ failure: { code: "quota_exceeded", resetsAt: "2026-10-01T04:00:00Z" } });
    expect(reserve).toHaveBeenCalledWith(5_000);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("makes one call per driving leg and reserves the single batch retry before it runs", async () => {
    let failed = false;
    const fetch = vi.fn(async () => {
      if (!failed) { failed = true; return new Response(null, { status: 503 }); }
      return Response.json({ routes: [{ duration: "600s" }] });
    });
    const reserve = vi.fn(async () => undefined);
    const results = await routeTravelLegs({
      routes: Array.from({ length: 8 }, (_, index) => ({ id: `leg-${index}`, request: {
        ...REQUEST, mode: "driving", timing: { kind: "arrive_by", at: "2026-09-22T13:00:00Z" },
      } })),
      provider: APPROVED, reserve, now: NOW, fetch,
    });
    expect(fetch).toHaveBeenCalledTimes(9);
    expect(reserve.mock.calls).toEqual([[80_000], [10_000]]);
    expect(results.every((result) => result.estimate)).toBe(true);
  });

  it("evaluates driving departures at the requested time rather than the ready time", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ routes: [{ duration: "600s" }] }));
    await computeGoogleRoute({ ...REQUEST, mode: "driving" }, { config: APPROVED, now: NOW, fetch });
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)).departureTime).toBe(REQUEST.timing.at);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each(["2026-09-22T12:05:00Z", "2026-09-22T12:10:00Z"])("reports an already-late driving trip from a fresh departure: %s", async (at) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ routes: [{ duration: "600s" }] }));
    const result = await computeGoogleRoute({ ...REQUEST, mode: "driving", timing: { kind: "arrive_by", at } }, { config: APPROVED, now: NOW, fetch });
    expect(fetch).toHaveBeenCalledOnce();
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)).departureTime).toBe("2026-09-22T12:00:10Z");
    expect(result).toMatchObject({ departureAt: "2026-09-22T12:00:10Z", arrivalAt: "2026-09-22T12:10:10Z" });
  });

  it("advances stale immediate driving departures without inventing on-time arrival", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ routes: [{ duration: "600s" }] }));
    const result = await computeGoogleRoute({ ...REQUEST, mode: "driving", timing: { kind: "depart_at", at: NOW.toString() } }, { config: APPROVED, now: NOW, fetch });
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)).departureTime).toBe("2026-09-22T12:00:10Z");
    expect(result).toMatchObject({ departureAt: "2026-09-22T12:00:10Z", arrivalAt: "2026-09-22T12:10:10Z" });
    expect(fetch).toHaveBeenCalledOnce();
  });
});
