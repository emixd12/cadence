import {
  GEOAPIFY_ATTRIBUTION,
  PLACE_SEARCH_MIN_QUERY_LENGTH,
  normalizePlaceSearchQuery,
} from "@cadence/core/services/place-search";
import type { PlaceSearchResponse, PlaceSearchSuggestion } from "@cadence/core/types/place-search";
import {
  GeoapifyProviderError,
  autocompleteGeoapifyPlaces,
  type GeoapifyConfig,
} from "@/lib/services/geoapify-provider";
import type { CalendarCaller } from "@/lib/services/google-calendar.service";

const MINUTE_WINDOW_MS = 60_000;
const HOUR_WINDOW_MS = 3_600_000;
const MAX_REQUESTS_PER_MINUTE = 30;
const MAX_REQUESTS_PER_HOUR = 200;
const CACHE_TTL_MS = 5 * 60_000;
const MAX_CACHE_ENTRIES = 500;

export type PlaceSearchErrorCode =
  | "invalid_request"
  | "rate_limited"
  | "not_configured"
  | "timeout"
  | "provider_unavailable"
  | "malformed_provider_response";

export class PlaceSearchError extends Error {
  constructor(
    public readonly code: PlaceSearchErrorCode,
    public readonly retryAfterSeconds: number | null = null,
  ) {
    super(code);
    this.name = "PlaceSearchError";
  }
}

export type PlaceSearchRateDecision = Readonly<{
  allowed: boolean;
  retryAfterSeconds: number | null;
}>;

export type PlaceSearchDependencies = Readonly<{
  nowMs: () => number;
  consumeRateLimit: (userId: string, nowMs: number) => PlaceSearchRateDecision;
  readCache: (key: string, nowMs: number) => readonly PlaceSearchSuggestion[] | null;
  writeCache: (key: string, suggestions: readonly PlaceSearchSuggestion[], nowMs: number) => void;
  autocomplete: (query: string, config: GeoapifyConfig) => Promise<PlaceSearchSuggestion[]>;
}>;

const rateHistory = new Map<string, number[]>();
const queryCache = new Map<string, Readonly<{ expiresAt: number; suggestions: readonly PlaceSearchSuggestion[] }>>();

export function consumeInMemoryPlaceSearchRateLimit(userId: string, nowMs: number): PlaceSearchRateDecision {
  const existing = rateHistory.get(userId) ?? [];
  const recentHour = existing.filter((timestamp) => nowMs - timestamp < HOUR_WINDOW_MS);
  const recentMinute = recentHour.filter((timestamp) => nowMs - timestamp < MINUTE_WINDOW_MS);
  if (recentMinute.length >= MAX_REQUESTS_PER_MINUTE) {
    const oldest = recentMinute[0]!;
    rateHistory.set(userId, recentHour);
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((oldest + MINUTE_WINDOW_MS - nowMs) / 1_000)) };
  }
  if (recentHour.length >= MAX_REQUESTS_PER_HOUR) {
    const oldest = recentHour[0]!;
    rateHistory.set(userId, recentHour);
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((oldest + HOUR_WINDOW_MS - nowMs) / 1_000)) };
  }
  recentHour.push(nowMs);
  rateHistory.set(userId, recentHour);
  return { allowed: true, retryAfterSeconds: null };
}

function readInMemoryCache(key: string, nowMs: number): readonly PlaceSearchSuggestion[] | null {
  const entry = queryCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= nowMs) {
    queryCache.delete(key);
    return null;
  }
  return entry.suggestions;
}

function writeInMemoryCache(key: string, suggestions: readonly PlaceSearchSuggestion[], nowMs: number): void {
  if (queryCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = queryCache.keys().next().value;
    if (oldestKey !== undefined) queryCache.delete(oldestKey);
  }
  queryCache.set(key, { expiresAt: nowMs + CACHE_TTL_MS, suggestions });
}

const defaultDependencies: PlaceSearchDependencies = {
  nowMs: () => Date.now(),
  consumeRateLimit: consumeInMemoryPlaceSearchRateLimit,
  readCache: readInMemoryCache,
  writeCache: writeInMemoryCache,
  autocomplete: (query, config) => autocompleteGeoapifyPlaces(query, { config }),
};

/**
 * Searches addresses and named places via Geoapify with per-account rate limiting
 * and short-lived normalized-query caching. Queries are never stored or logged.
 */
export async function searchPlaces(
  caller: CalendarCaller,
  rawQuery: unknown,
  config: GeoapifyConfig,
  dependencies: PlaceSearchDependencies = defaultDependencies,
): Promise<PlaceSearchResponse> {
  if (typeof rawQuery !== "string") {
    throw new PlaceSearchError("invalid_request");
  }
  const query = normalizePlaceSearchQuery(rawQuery);
  if (query.length < PLACE_SEARCH_MIN_QUERY_LENGTH) {
    return { suggestions: [], attribution: null };
  }
  if (!config.apiKey) {
    throw new PlaceSearchError("not_configured");
  }
  const nowMs = dependencies.nowMs();
  const limit = dependencies.consumeRateLimit(caller.user.id, nowMs);
  if (!limit.allowed) {
    throw new PlaceSearchError("rate_limited", limit.retryAfterSeconds);
  }
  const cacheKey = query.toLowerCase();
  const cached = dependencies.readCache(cacheKey, nowMs);
  if (cached) {
    return {
      suggestions: cached,
      attribution: cached.length > 0 ? GEOAPIFY_ATTRIBUTION : null,
    };
  }
  try {
    const suggestions = await dependencies.autocomplete(query, config);
    dependencies.writeCache(cacheKey, suggestions, nowMs);
    return {
      suggestions,
      attribution: suggestions.length > 0 ? GEOAPIFY_ATTRIBUTION : null,
    };
  } catch (error) {
    if (error instanceof GeoapifyProviderError) {
      throw new PlaceSearchError(error.code);
    }
    throw new PlaceSearchError("provider_unavailable");
  }
}
