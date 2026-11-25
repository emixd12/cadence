import { describe, expect, it, vi } from "vitest";

import {
  GEOAPIFY_ATTRIBUTION,
  collectSavedBehaviorPlaces,
  matchSavedPlaces,
  mergePlaceSearchSuggestions,
  normalizePlaceSearchQuery,
  parseGeoapifyAutocompleteResponse,
} from "@cadence/core/services/place-search";
import {
  GeoapifyProviderError,
  autocompleteGeoapifyPlaces,
} from "@/lib/services/geoapify-provider";
import {
  PlaceSearchError,
  consumeInMemoryPlaceSearchRateLimit,
  searchPlaces,
  type PlaceSearchDependencies,
} from "@/lib/services/place-search.service";
import type { CalendarCaller } from "@/lib/services/google-calendar.service";

const CALLER = {
  user: { id: "user-place-search-1" },
  client: {} as CalendarCaller["client"],
  via: "cookie",
} as CalendarCaller;

describe("core place-search helpers", () => {
  it("normalizes whitespace and bounds length", () => {
    expect(normalizePlaceSearchQuery("  YMCA   Greenpoint \n ")).toBe("YMCA Greenpoint");
    expect(normalizePlaceSearchQuery("a".repeat(200)).length).toBe(120);
  });

  it("collects unique saved places from behaviors and matches prefix first", () => {
    const places = collectSavedBehaviorPlaces([
      { whereKind: "place", locationText: "99 Meserole Ave, Brooklyn, NY" },
      { whereKind: "place", locationText: "Greenpoint YMCA, 99 Meserole Ave" },
      { whereKind: "place", locationText: "  99 meserole ave, brooklyn, ny  " },
      { whereKind: "home", locationText: "Ignored Home" },
      { whereKind: "place", locationText: "" },
    ]);
    expect(places).toEqual(["99 Meserole Ave, Brooklyn, NY", "Greenpoint YMCA, 99 Meserole Ave"]);

    const matched = matchSavedPlaces(places, "greenpoint");
    expect(matched).toHaveLength(1);
    expect(matched[0]).toMatchObject({
      source: "saved",
      title: "Greenpoint YMCA, 99 Meserole Ave",
      subtitle: "Saved place",
      formatted: "Greenpoint YMCA, 99 Meserole Ave",
      position: null,
    });
  });

  it("parses Geoapify POI and street results, omitting coordinates for coarse admin areas", () => {
    const suggestions = parseGeoapifyAutocompleteResponse({
      results: [
        {
          place_id: "poi-1",
          name: "Greenpoint YMCA",
          address_line1: "Greenpoint YMCA",
          address_line2: "99 Meserole Avenue, Brooklyn, NY 11222, United States of America",
          formatted: "Greenpoint YMCA, 99 Meserole Avenue, Brooklyn, NY 11222, United States of America",
          lat: 40.7271,
          lon: -73.9542,
          result_type: "amenity",
        },
        {
          place_id: "city-1",
          address_line1: "Brooklyn",
          address_line2: "NY, United States of America",
          formatted: "Brooklyn, NY, United States of America",
          lat: 40.6501,
          lon: -73.9496,
          result_type: "city",
        },
        {
          place_id: "dup-1",
          address_line1: "Greenpoint YMCA",
          address_line2: "99 Meserole Avenue, Brooklyn, NY 11222, United States of America",
          formatted: "Greenpoint YMCA, 99 Meserole Avenue, Brooklyn, NY 11222, United States of America",
          lat: 40.7271,
          lon: -73.9542,
          result_type: "amenity",
        },
      ],
    });

    expect(suggestions).toHaveLength(2);
    expect(suggestions[0]).toEqual({
      id: "geoapify:poi-1",
      source: "geoapify",
      title: "Greenpoint YMCA",
      subtitle: "99 Meserole Avenue, Brooklyn, NY 11222, United States of America",
      formatted: "Greenpoint YMCA, 99 Meserole Avenue, Brooklyn, NY 11222, United States of America",
      position: { latitude: 40.7271, longitude: -73.9542 },
    });
    // Coarse city centroids never carry completion marker coordinates.
    expect(suggestions[1]?.position).toBeNull();
  });

  it("merges local saved places ahead of remote results and deduplicates by place key", () => {
    const local = matchSavedPlaces(["Greenpoint YMCA, 99 Meserole Ave"], "ymca");
    const remote = parseGeoapifyAutocompleteResponse({
      results: [
        {
          place_id: "same",
          address_line1: "Greenpoint YMCA",
          formatted: "Greenpoint YMCA, 99 Meserole Ave",
          lat: 40.7271,
          lon: -73.9542,
          result_type: "amenity",
        },
        {
          place_id: "other",
          address_line1: "Bedford-Stuyvesant YMCA",
          address_line2: "1121 Bedford Ave, Brooklyn, NY",
          formatted: "Bedford-Stuyvesant YMCA, 1121 Bedford Ave, Brooklyn, NY",
          lat: 40.6865,
          lon: -73.9548,
          result_type: "amenity",
        },
      ],
    });
    const merged = mergePlaceSearchSuggestions(local, remote);
    expect(merged.map((item) => item.source)).toEqual(["saved", "geoapify"]);
    expect(merged[1]?.title).toBe("Bedford-Stuyvesant YMCA");
  });
});

describe("autocompleteGeoapifyPlaces", () => {
  it("fails closed when unconfigured", async () => {
    await expect(
      autocompleteGeoapifyPlaces("YMCA Greenpoint", { config: { apiKey: null } }),
    ).rejects.toMatchObject({ code: "not_configured" });
  });

  it("calls Geoapify autocomplete and parses results", async () => {
    const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.origin).toBe("https://api.geoapify.com");
      expect(url.pathname).toBe("/v1/geocode/autocomplete");
      expect(url.searchParams.get("text")).toBe("YMCA Greenpoint");
      expect(url.searchParams.get("format")).toBe("json");
      expect(url.searchParams.get("apiKey")).toBe("test-key");
      return new Response(JSON.stringify({
        results: [{
          place_id: "p1",
          address_line1: "Greenpoint YMCA",
          address_line2: "99 Meserole Ave, Brooklyn, NY",
          formatted: "Greenpoint YMCA, 99 Meserole Ave, Brooklyn, NY",
          lat: 40.7271,
          lon: -73.9542,
          result_type: "amenity",
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;

    const results = await autocompleteGeoapifyPlaces("YMCA Greenpoint", {
      config: { apiKey: "test-key" },
      fetch: mockFetch,
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe("Greenpoint YMCA");
    expect(results[0]?.position).toEqual({ latitude: 40.7271, longitude: -73.9542 });
  });

  it("throws provider_unavailable on non-2xx responses", async () => {
    const mockFetch = vi.fn(async () => new Response("rate limit", { status: 429 })) as unknown as typeof fetch;
    await expect(
      autocompleteGeoapifyPlaces("YMCA Greenpoint", { config: { apiKey: "test-key" }, fetch: mockFetch }),
    ).rejects.toBeInstanceOf(GeoapifyProviderError);
  });
});

describe("searchPlaces service", () => {
  it("returns empty results without calling Geoapify for queries under 3 characters", async () => {
    const autocomplete = vi.fn();
    const result = await searchPlaces(CALLER, "ym", { apiKey: "key" }, {
      nowMs: () => 1_000,
      consumeRateLimit: () => ({ allowed: true, retryAfterSeconds: null }),
      readCache: () => null,
      writeCache: () => undefined,
      autocomplete,
    });
    expect(result).toEqual({ suggestions: [], attribution: null });
    expect(autocomplete).not.toHaveBeenCalled();
  });

  it("caches normalized queries and returns Geoapify attribution", async () => {
    const cache = new Map<string, readonly { id: string; source: "geoapify"; title: string; subtitle: string | null; formatted: string; position: { latitude: number; longitude: number } | null }[]>();
    const autocomplete = vi.fn(async () => [{
      id: "geoapify:1",
      source: "geoapify" as const,
      title: "Greenpoint YMCA",
      subtitle: "99 Meserole Ave, Brooklyn, NY",
      formatted: "Greenpoint YMCA, 99 Meserole Ave, Brooklyn, NY",
      position: { latitude: 40.7271, longitude: -73.9542 },
    }]);
    const deps: PlaceSearchDependencies = {
      nowMs: () => 10_000,
      consumeRateLimit: () => ({ allowed: true, retryAfterSeconds: null }),
      readCache: (key) => cache.get(key) ?? null,
      writeCache: (key, value) => { cache.set(key, value as never); },
      autocomplete,
    };

    const first = await searchPlaces(CALLER, "YMCA Greenpoint", { apiKey: "key" }, deps);
    const second = await searchPlaces(CALLER, "  ymca   greenpoint ", { apiKey: "key" }, deps);
    expect(first.attribution).toBe(GEOAPIFY_ATTRIBUTION);
    expect(second.suggestions).toHaveLength(1);
    expect(autocomplete).toHaveBeenCalledTimes(1);
  });

  it("enforces per-account rate limits", async () => {
    const uniqueUser = `rate-limit-user-${Date.now()}`;
    let decision = { allowed: true, retryAfterSeconds: null as number | null };
    for (let i = 0; i < 31; i += 1) {
      decision = consumeInMemoryPlaceSearchRateLimit(uniqueUser, 100_000 + i);
    }
    expect(decision.allowed).toBe(false);
    expect(decision.retryAfterSeconds).toBeGreaterThan(0);

    await expect(searchPlaces(CALLER, "YMCA Greenpoint", { apiKey: "key" }, {
      nowMs: () => 10_000,
      consumeRateLimit: () => ({ allowed: false, retryAfterSeconds: 42 }),
      readCache: () => null,
      writeCache: () => undefined,
      autocomplete: vi.fn(),
    })).rejects.toMatchObject({ code: "rate_limited", retryAfterSeconds: 42 } satisfies Partial<PlaceSearchError>);
  });
});
