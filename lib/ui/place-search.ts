import {
  PLACE_SEARCH_MIN_QUERY_LENGTH,
  normalizePlaceSearchQuery,
} from "@cadence/core/services/place-search";
import type { PlaceSearchSuggestion } from "@cadence/core/types/place-search";

export type PlaceSearchClientResult =
  | Readonly<{ kind: "ok"; suggestions: readonly PlaceSearchSuggestion[]; attribution: string | null }>
  | Readonly<{ kind: "rate_limited" | "unavailable" }>;

export type PlaceSearchClient = Readonly<{
  search: (query: string, signal?: AbortSignal) => Promise<PlaceSearchClientResult>;
}>;

const CLIENT_CACHE_TTL_MS = 5 * 60_000;
const CLIENT_CACHE_MAX_ENTRIES = 100;

/**
 * One client for web (same-origin session) and a linked Mac (hosted origin with Bearer token).
 * Caches normalized queries in memory for 5 minutes so backspacing or re-opening costs 0 calls.
 */
export function createPlaceSearchClient(
  input: Readonly<{ origin?: string; accessToken?: () => Promise<string> }> = {},
): PlaceSearchClient {
  const cache = new Map<string, Readonly<{ expiresAt: number; result: Extract<PlaceSearchClientResult, { kind: "ok" }> }>>();

  return {
    search: async (rawQuery, externalSignal) => {
      const query = normalizePlaceSearchQuery(rawQuery);
      if (query.length < PLACE_SEARCH_MIN_QUERY_LENGTH) {
        return { kind: "ok", suggestions: [], attribution: null };
      }
      const cacheKey = query.toLowerCase();
      const now = Date.now();
      const cached = cache.get(cacheKey);
      if (cached && cached.expiresAt > now) {
        return cached.result;
      }
      if (cached) cache.delete(cacheKey);

      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        return { kind: "unavailable" };
      }

      try {
        const token = input.accessToken ? await input.accessToken() : null;
        const timeout = AbortSignal.timeout(8_000);
        const signal = externalSignal ? AbortSignal.any([externalSignal, timeout]) : timeout;
        const response = await fetch(
          `${input.origin ?? ""}/api/travel/place-search?q=${encodeURIComponent(query)}`,
          {
            method: "GET",
            cache: "no-store",
            redirect: "error",
            signal,
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          },
        );
        const body: unknown = await response.json().catch(() => null);
        const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
        if (response.ok && Array.isArray(record.suggestions)) {
          const result: Extract<PlaceSearchClientResult, { kind: "ok" }> = {
            kind: "ok",
            suggestions: record.suggestions as PlaceSearchSuggestion[],
            attribution: typeof record.attribution === "string" ? record.attribution : null,
          };
          if (cache.size >= CLIENT_CACHE_MAX_ENTRIES) {
            const oldestKey = cache.keys().next().value;
            if (oldestKey !== undefined) cache.delete(oldestKey);
          }
          cache.set(cacheKey, { expiresAt: now + CLIENT_CACHE_TTL_MS, result });
          return result;
        }
        if (response.status === 429 || record.error === "rate_limited") {
          return { kind: "rate_limited" };
        }
        return { kind: "unavailable" };
      } catch {
        return { kind: "unavailable" };
      }
    },
  };
}

export const webPlaceSearchClient: PlaceSearchClient = createPlaceSearchClient();
