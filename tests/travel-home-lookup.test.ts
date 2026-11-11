import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Ticket 308: Home from the current location. No test makes a real Google call.
const auth = vi.hoisted(() => ({ caller: null as unknown, travelEnabled: true }));
vi.mock("@/lib/services/google-calendar-request", async (original) => ({
  ...(await original<typeof import("@/lib/services/google-calendar-request")>()),
  authenticateCalendarRequest: vi.fn(async () => {
    if (!auth.caller) { const { CalendarConnectionError } = await import("@/lib/services/google-calendar-oauth"); throw new CalendarConnectionError("unauthenticated"); }
    return auth.caller;
  }),
}));
vi.mock("@/lib/services/travel-settings.service", async (original) => ({
  ...(await original<typeof import("@/lib/services/travel-settings.service")>()),
  getTravelSettings: vi.fn(async () => ({ enabled: auth.travelEnabled, routingConsentAt: auth.travelEnabled ? "2026-11-01T00:00:00Z" : null })),
}));

import type { TravelSettings } from "@cadence/core/types/travel";
import { POST, OPTIONS } from "@/app/api/travel/home-lookup/route";
import { consumeTravelHomeLookupRateLimit } from "@/lib/db/launchRateLimits.repo";
import type { CalendarCaller } from "@/lib/services/google-calendar.service";
import { lookupTravelHomeAddress, TravelHomeLookupError, type TravelHomeLookupDependencies } from "@/lib/services/travel-home-lookup.service";
import { reverseGeocodeGooglePosition, TRAVEL_GEOCODE_MICRODOLLARS, TravelProviderError } from "@/lib/services/travel-provider";
import { createHomeLookupClient } from "@/lib/ui/home-lookup";

// Distinctive digits, so any leak into logs, errors or responses is easy to find.
const POSITION = { latitude: 41.8781136, longitude: -87.6297982, accuracyMeters: 18 };
const LEAK_PATTERNS = ["41.8781136", "-87.6297982", "87.6297982"];
const APPROVED = { cleared: true, apiKey: "test-key" } as const;
const caller = { client: {}, user: { id: "user-a" } } as unknown as CalendarCaller;
const travelOn = { enabled: true, routingConsentAt: "2026-11-01T00:00:00Z" } as TravelSettings;

function fakeDependencies(overrides: Partial<TravelHomeLookupDependencies> = {}) {
  const calls: string[] = [];
  const dependencies: TravelHomeLookupDependencies = {
    readSettings: vi.fn(async () => { calls.push("settings"); return travelOn; }),
    consumeRateLimit: vi.fn(async () => { calls.push("rate_limit"); return { allowed: true, limit: 5, remaining: 4, resetAt: "2026-11-10T13:00:00Z", retryAfterSeconds: 3600 }; }),
    reserveSpend: vi.fn(async () => { calls.push("spend"); return { allowed: true, retryAfterSeconds: 0, resetsAt: null }; }),
    reverseGeocode: vi.fn(async () => { calls.push("provider"); return "1 Example Street, Chicago, IL 60601, USA"; }),
    ...overrides,
  };
  return { dependencies, calls };
}

// The same hosted configuration as tests/travel-provider.test.ts.
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

const consoleMethods = ["log", "info", "warn", "error", "debug", "trace"] as const;
function spyOnConsole() {
  return consoleMethods.map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
}
function expectNoPositionIn(text: string) {
  for (const pattern of LEAK_PATTERNS) expect(text).not.toContain(pattern);
}

describe("reverse geocoding provider call", () => {
  it("sends the position to Geocoding v3 once and returns the first street address", async () => {
    const fetch = vi.fn(async () => Response.json({ status: "OK", results: [
      { formatted_address: "Chicago, IL, USA", types: ["locality", "political"] },
      { formatted_address: "1 Example Street, Chicago, IL 60601, USA", types: ["street_address"] },
      { formatted_address: "2 Other Street, Chicago, IL 60601, USA", types: ["premise"] },
    ] }));
    await expect(reverseGeocodeGooglePosition(POSITION, { config: APPROVED, fetch })).resolves.toBe("1 Example Street, Chicago, IL 60601, USA");
    expect(fetch).toHaveBeenCalledTimes(1);
    const url = new URL(String((fetch.mock.calls[0] as unknown[])[0]));
    expect(url.origin + url.pathname).toBe("https://maps.googleapis.com/maps/api/geocode/json");
    expect(url.searchParams.get("latlng")).toBe("41.8781136,-87.6297982");
    expect(url.searchParams.get("result_type")).toBe("street_address|premise|subpremise");
  });

  it("returns null for no result and for results with no street address", async () => {
    const none = vi.fn(async () => Response.json({ status: "ZERO_RESULTS", results: [] }));
    await expect(reverseGeocodeGooglePosition(POSITION, { config: APPROVED, fetch: none })).resolves.toBeNull();
    const coarse = vi.fn(async () => Response.json({ status: "OK", results: [{ formatted_address: "Illinois, USA", types: ["administrative_area_level_1"] }] }));
    await expect(reverseGeocodeGooglePosition(POSITION, { config: APPROVED, fetch: coarse })).resolves.toBeNull();
  });

  it("uses the Geocoding v4 location path with a field mask on hosted OAuth", async () => {
    const config = hostedConfig();
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ access_token: "federated-token", token_type: "Bearer", expires_in: 3_600 }))
      .mockResolvedValueOnce(Response.json({ accessToken: "google-access-token", expireTime: new Date(Date.now() + 900_000).toISOString() }))
      .mockResolvedValueOnce(Response.json({ results: [{ formattedAddress: "1 Example Street, Chicago, IL 60601, USA", types: ["street_address"] }] }));
    await expect(reverseGeocodeGooglePosition(POSITION, { config, fetch })).resolves.toBe("1 Example Street, Chicago, IL 60601, USA");
    const url = new URL(String(fetch.mock.calls[2]![0]));
    expect(url.origin + url.pathname).toBe("https://geocode.googleapis.com/v4/geocode/location/41.8781136,-87.6297982");
    expect(url.searchParams.getAll("types")).toEqual(["street_address", "premise", "subpremise"]);
    expect(url.searchParams.has("key")).toBe(false);
    expect(fetch.mock.calls[2]![1].headers).toMatchObject({ "X-Goog-FieldMask": "results.formattedAddress,results.types" });
  });

  it("refuses before any request without clearance, and reports a failed request by code only", async () => {
    const fetch = vi.fn();
    await expect(reverseGeocodeGooglePosition(POSITION, { config: { cleared: false, apiKey: "test-key" }, fetch })).rejects.toThrow("provider_clearance_required");
    expect(fetch).not.toHaveBeenCalled();
    const denied = vi.fn(async () => Response.json({ status: "REQUEST_DENIED", results: [] }));
    const error = await reverseGeocodeGooglePosition(POSITION, { config: APPROVED, fetch: denied }).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(TravelProviderError);
    expectNoPositionIn(String(error) + JSON.stringify(error));
  });
});

describe("Home lookup service", () => {
  let spies: ReturnType<typeof spyOnConsole>;
  beforeEach(() => { spies = spyOnConsole(); });
  afterEach(() => { for (const spy of spies) spy.mockRestore(); });

  it("returns one address after the rate limit and a geocode spend reservation", async () => {
    const { dependencies, calls } = fakeDependencies();
    await expect(lookupTravelHomeAddress(caller, POSITION, APPROVED, dependencies)).resolves.toEqual({ address: "1 Example Street, Chicago, IL 60601, USA" });
    expect(calls).toEqual(["settings", "rate_limit", "spend", "provider"]);
    expect(dependencies.reserveSpend).toHaveBeenCalledWith(caller, TRAVEL_GEOCODE_MICRODOLLARS);
    expect(dependencies.reverseGeocode).toHaveBeenCalledWith({ latitude: POSITION.latitude, longitude: POSITION.longitude }, APPROVED);
  });

  it("returns a null address when Google finds no street address", async () => {
    const { dependencies } = fakeDependencies({ reverseGeocode: vi.fn(async () => null) });
    await expect(lookupTravelHomeAddress(caller, POSITION, APPROVED, dependencies)).resolves.toEqual({ address: null });
  });

  it("stops at the per-account rate limit before spend or a provider call", async () => {
    const { dependencies, calls } = fakeDependencies({
      consumeRateLimit: vi.fn(async () => ({ allowed: false, limit: 5, remaining: 0, resetAt: "2026-11-10T13:00:00Z", retryAfterSeconds: 1800 })),
    });
    const error = await lookupTravelHomeAddress(caller, POSITION, APPROVED, dependencies).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(TravelHomeLookupError);
    expect(error).toMatchObject({ code: "rate_limited", retryAfterSeconds: 1800 });
    expect(dependencies.reserveSpend).not.toHaveBeenCalled();
    expect(dependencies.reverseGeocode).not.toHaveBeenCalled();
    expect(calls).toEqual(["settings"]);
  });

  it("stops at the monthly travel spend ceiling before a provider call", async () => {
    const { dependencies } = fakeDependencies({ reserveSpend: vi.fn(async () => ({ allowed: false, retryAfterSeconds: 99, resetsAt: "2026-12-01T06:00:00Z" })) });
    await expect(lookupTravelHomeAddress(caller, POSITION, APPROVED, dependencies)).rejects.toMatchObject({ code: "quota_exceeded", retryAfterSeconds: 99 });
    expect(dependencies.reverseGeocode).not.toHaveBeenCalled();
  });

  it("needs Travel estimates on with the disclosure accepted", async () => {
    for (const settings of [{ ...travelOn, enabled: false }, { ...travelOn, routingConsentAt: null }]) {
      const { dependencies } = fakeDependencies({ readSettings: vi.fn(async () => settings) });
      await expect(lookupTravelHomeAddress(caller, POSITION, APPROVED, dependencies)).rejects.toMatchObject({ code: "travel_off" });
      expect(dependencies.consumeRateLimit).not.toHaveBeenCalled();
      expect(dependencies.reverseGeocode).not.toHaveBeenCalled();
    }
  });

  it("rejects inaccurate and malformed positions before any read", async () => {
    const { dependencies } = fakeDependencies();
    await expect(lookupTravelHomeAddress(caller, { ...POSITION, accuracyMeters: 450 }, APPROVED, dependencies)).rejects.toMatchObject({ code: "inaccurate_position" });
    for (const body of [null, [], { ...POSITION, userId: "user-b" }, { latitude: 91, longitude: 0, accuracyMeters: 5 }, { latitude: "41", longitude: 0, accuracyMeters: 5 }, { latitude: 0, longitude: 0 }]) {
      await expect(lookupTravelHomeAddress(caller, body, APPROVED, dependencies)).rejects.toMatchObject({ code: "invalid_request" });
    }
    expect(dependencies.readSettings).not.toHaveBeenCalled();
  });

  it("maps provider failures to codes", async () => {
    const { dependencies } = fakeDependencies({ reverseGeocode: vi.fn(async () => { throw new TravelProviderError("timeout", true); }) });
    await expect(lookupTravelHomeAddress(caller, POSITION, APPROVED, dependencies)).rejects.toMatchObject({ code: "timeout" });
    const { dependencies: other } = fakeDependencies({ reverseGeocode: vi.fn(async () => { throw new Error(`fetch failed for ${POSITION.latitude},${POSITION.longitude}`); }) });
    const error = await lookupTravelHomeAddress(caller, POSITION, APPROVED, other).catch((value: unknown) => value);
    expect(error).toMatchObject({ code: "provider_unavailable" });
    expectNoPositionIn(String(error) + JSON.stringify(error) + String((error as Error).stack));
  });

  it("logs nothing, and no position, on any path", async () => {
    const paths: Array<Partial<TravelHomeLookupDependencies>> = [
      {},
      { reverseGeocode: vi.fn(async () => null) },
      { consumeRateLimit: vi.fn(async () => ({ allowed: false, limit: 5, remaining: 0, resetAt: "2026-11-10T13:00:00Z", retryAfterSeconds: 60 })) },
      { reserveSpend: vi.fn(async () => ({ allowed: false, retryAfterSeconds: 60, resetsAt: "2026-12-01T06:00:00Z" })) },
      { reverseGeocode: vi.fn(async () => { throw new TravelProviderError("provider_unavailable", true); }) },
    ];
    const outputs: string[] = [];
    for (const overrides of paths) {
      const { dependencies } = fakeDependencies(overrides);
      try { outputs.push(JSON.stringify(await lookupTravelHomeAddress(caller, POSITION, APPROVED, dependencies))); }
      catch (error) { outputs.push(String(error), JSON.stringify(error)); }
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expectNoPositionIn(outputs.join("\n"));
  });
});

describe("Home lookup endpoint", () => {
  let spies: ReturnType<typeof spyOnConsole>;
  const env = { ...process.env };
  beforeEach(() => {
    spies = spyOnConsole();
    auth.caller = null; auth.travelEnabled = true;
    process.env.CADENCE_TRAVEL_PROVIDER_CLEARANCE = "approved";
    process.env.GOOGLE_MAPS_SERVER_API_KEY = "test-key";
    delete process.env.CADENCE_TRAVEL_GOOGLE_AUTH_MODE;
  });
  afterEach(() => {
    for (const spy of spies) spy.mockRestore();
    process.env = { ...env };
    vi.unstubAllGlobals();
  });
  const post = (body: unknown, origin?: string) => POST(new Request("https://cadence.example/api/travel/home-lookup", {
    method: "POST", body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) } }));
  function rpcClient(rateAllowed = true) {
    const rpc = vi.fn(async (name: string) => name === "consume_launch_rate_limit"
      ? { data: [{ allowed: rateAllowed, limit_count: 5, remaining: rateAllowed ? 4 : 0, reset_at: "2026-11-10T13:00:00Z", retry_after_seconds: 1200 }], error: null }
      : { data: [{ allowed: true, retry_after_seconds: 0, resets_at: null }], error: null });
    return { rpc };
  }

  it("returns 401 without a session and never reads the body", async () => {
    const response = await post(POSITION);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthenticated" });
  });

  it("returns 503 without provider clearance before reading the body", async () => {
    const client = rpcClient();
    auth.caller = { client, user: { id: "user-a" } };
    delete process.env.CADENCE_TRAVEL_PROVIDER_CLEARANCE;
    const response = await post("not json");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "provider_clearance_required" });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("returns the address with no-store and never echoes or logs the position", async () => {
    const client = rpcClient();
    auth.caller = { client, user: { id: "user-a" } };
    const fetch = vi.fn(async () => Response.json({ status: "OK", results: [{ formatted_address: "1 Example Street, Chicago, IL 60601, USA", types: ["street_address"] }] }));
    vi.stubGlobal("fetch", fetch);
    const response = await post(POSITION, "tauri://localhost");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBe("tauri://localhost");
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ address: "1 Example Street, Chicago, IL 60601, USA" });
    expectNoPositionIn(text);
    expect(client.rpc).toHaveBeenCalledWith("consume_launch_rate_limit", { p_action: "travel_home_lookup" });
    expect(client.rpc).toHaveBeenCalledWith("reserve_travel_provider_spend", { requested_microdollars: TRAVEL_GEOCODE_MICRODOLLARS });
    expect(fetch).toHaveBeenCalledTimes(1);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it("returns 429 with Retry-After at the rate limit, and 409 with Travel estimates off", async () => {
    auth.caller = { client: rpcClient(false), user: { id: "user-a" } };
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const limited = await post(POSITION);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("1200");
    expect(await limited.json()).toEqual({ error: "rate_limited", retryAfterSeconds: 1200 });
    auth.travelEnabled = false;
    const off = await post(POSITION);
    expect(off.status).toBe(409);
    expect(fetch).not.toHaveBeenCalled();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it("answers the Mac's preflight only for the native origin", async () => {
    expect(OPTIONS(new Request("https://cadence.example/api/travel/home-lookup", { method: "OPTIONS", headers: { Origin: "tauri://localhost" } })).status).toBe(204);
    expect(OPTIONS(new Request("https://cadence.example/api/travel/home-lookup", { method: "OPTIONS", headers: { Origin: "https://evil.example" } })).status).toBe(403);
  });
});

describe("Home lookup client and rate limit repository", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts the position in the body only and maps answers", async () => {
    const answers = [
      Response.json({ address: " 1 Example Street " }),
      Response.json({ address: null }),
      Response.json({ error: "rate_limited", retryAfterSeconds: 60 }, { status: 429 }),
      Response.json({ error: "quota_exceeded", retryAfterSeconds: 60 }, { status: 429 }),
      Response.json({ error: "travel_off" }, { status: 409 }),
      Response.json({ error: "inaccurate_position" }, { status: 422 }),
      Response.json({ error: "provider_unavailable" }, { status: 503 }),
    ];
    const fetch = vi.fn(async () => answers.shift()!);
    vi.stubGlobal("fetch", fetch);
    const client = createHomeLookupClient({ origin: "https://cadence.example", accessToken: async () => "token" });
    const results = [];
    for (let index = 0; index < 7; index++) results.push(await client.lookup(POSITION));
    expect(results).toEqual([{ kind: "address", address: "1 Example Street" }, { kind: "no_result" }, { kind: "rate_limited" },
      { kind: "rate_limited" }, { kind: "travel_off" }, { kind: "inaccurate" }, { kind: "unavailable" }]);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://cadence.example/api/travel/home-lookup");
    expectNoPositionIn(url);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual(POSITION);
    expect(init.headers).toMatchObject({ Authorization: "Bearer token" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    await expect(client.lookup(POSITION)).resolves.toEqual({ kind: "unavailable" });
  });

  it("consumes the travel_home_lookup action", async () => {
    const rpc = vi.fn(async () => ({ data: [{ allowed: true, limit_count: 5, remaining: 4, reset_at: "2026-11-10T13:00:00Z", retry_after_seconds: 3600 }], error: null }));
    await expect(consumeTravelHomeLookupRateLimit({ rpc } as never)).resolves.toMatchObject({ allowed: true, limit: 5 });
    expect(rpc).toHaveBeenCalledWith("consume_launch_rate_limit", { p_action: "travel_home_lookup" });
  });
});

describe("Home lookup rate limit migration", () => {
  it("widens the launch rate limit to travel_home_lookup at five per hour and keeps the other actions", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("supabase/migrations/20261110160800_travel_home_lookup_rate_limit.sql", "utf8").toLowerCase();
    expect(sql).toContain("check (action in ('export_download', 'push_subscription_registration', 'travel_home_lookup'))");
    expect(sql).toContain("limit_count := 6;");
    expect(sql).toMatch(/if p_action = 'travel_home_lookup' then\s+limit_count := 5;\s+window_seconds := 3600;/);
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain("grant execute on function public.consume_launch_rate_limit(text) to authenticated");
    expect(sql).toContain("revoke all on function public.consume_launch_rate_limit(text) from anon");
    expect(sql.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n")).not.toMatch(/latitude|longitude|address/);
  });
});
