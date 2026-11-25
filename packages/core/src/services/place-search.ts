import { travelPlaceKey } from "./travel-place-key";
import type { PlaceSearchCoordinates, PlaceSearchSuggestion } from "../types/place-search";

export const PLACE_SEARCH_MIN_QUERY_LENGTH = 3;
export const PLACE_SEARCH_MAX_QUERY_LENGTH = 120;
export const PLACE_SEARCH_MAX_RESULTS = 5;
export const PLACE_SEARCH_MAX_FORMATTED_LENGTH = 500;
/** Nominal accuracy radius for an OSM/Geoapify building or venue coordinate (within 100 m rule). */
export const PLACE_SEARCH_MARKER_ACCURACY_METERS = 25;
export const GEOAPIFY_ATTRIBUTION = "Powered by Geoapify · © OpenStreetMap contributors";

/**
 * Coarse administrative result types must never set a 150 m completion marker:
 * a city, state, county, postcode or country centroid is not a specific place.
 */
const COARSE_GEOAPIFY_RESULT_TYPES = new Set([
  "country",
  "state",
  "county",
  "city",
  "postcode",
  "suburb",
  "district",
]);

export function normalizePlaceSearchQuery(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").slice(0, PLACE_SEARCH_MAX_QUERY_LENGTH);
}

/** Collects unique, non-empty saved place strings from Behaviors, preserving first-seen casing. */
export function collectSavedBehaviorPlaces(
  behaviors: readonly Readonly<{ whereKind?: string | null; locationText?: string | null }>[],
): string[] {
  const seen = new Set<string>();
  const places: string[] = [];
  for (const behavior of behaviors) {
    if (behavior.whereKind !== "place") continue;
    const text = behavior.locationText?.trim() ?? "";
    if (!text) continue;
    const key = travelPlaceKey(text);
    if (seen.has(key)) continue;
    seen.add(key);
    places.push(text);
  }
  return places.sort((left, right) => left.localeCompare(right));
}

/** Instant, zero-cost local matching against places already saved on the user's Behaviors. */
export function matchSavedPlaces(
  savedPlaces: readonly string[],
  rawQuery: string,
  limit = PLACE_SEARCH_MAX_RESULTS,
): PlaceSearchSuggestion[] {
  const query = normalizePlaceSearchQuery(rawQuery).toLowerCase();
  if (!query || limit <= 0) return [];
  const prefixMatches: PlaceSearchSuggestion[] = [];
  const substringMatches: PlaceSearchSuggestion[] = [];
  const seen = new Set<string>();
  for (const rawPlace of savedPlaces) {
    const formatted = rawPlace.trim().slice(0, PLACE_SEARCH_MAX_FORMATTED_LENGTH);
    if (!formatted) continue;
    const key = travelPlaceKey(formatted);
    if (seen.has(key)) continue;
    const lower = formatted.toLowerCase();
    if (!lower.includes(query)) continue;
    seen.add(key);
    const suggestion: PlaceSearchSuggestion = {
      id: `saved:${key}`,
      source: "saved",
      title: formatted,
      subtitle: "Saved place",
      formatted,
      position: null,
    };
    if (lower.startsWith(query)) prefixMatches.push(suggestion);
    else substringMatches.push(suggestion);
  }
  return [...prefixMatches, ...substringMatches].slice(0, limit);
}

/** Parses and validates a Geoapify `/v1/geocode/autocomplete?format=json` response body. */
export function parseGeoapifyAutocompleteResponse(
  body: unknown,
  limit = PLACE_SEARCH_MAX_RESULTS,
): PlaceSearchSuggestion[] {
  if (!isRecord(body) || !Array.isArray(body.results) || limit <= 0) return [];
  const suggestions: PlaceSearchSuggestion[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < body.results.length && suggestions.length < limit; index += 1) {
    const item = body.results[index];
    if (!isRecord(item)) continue;
    const name = cleanString(item.name);
    const line1 = cleanString(item.address_line1);
    const line2 = cleanString(item.address_line2);
    const rawFormatted = cleanString(item.formatted);
    const formatted = (rawFormatted || [line1, line2].filter(Boolean).join(", ")).slice(0, PLACE_SEARCH_MAX_FORMATTED_LENGTH);
    if (!formatted) continue;
    const key = travelPlaceKey(formatted);
    if (seen.has(key)) continue;
    seen.add(key);
    const title = line1 || name || formatted;
    const subtitle = line2 && line2.toLowerCase() !== title.toLowerCase() ? line2 : null;
    const position = extractMarkerPosition(item);
    const placeId = cleanString(item.place_id) || `${key}-${index}`;
    suggestions.push({
      id: `geoapify:${placeId}`,
      source: "geoapify",
      title,
      subtitle,
      formatted,
      position,
    });
  }
  return suggestions;
}

/** Merges instant local saved-place matches ahead of Geoapify suggestions, deduplicated by place key. */
export function mergePlaceSearchSuggestions(
  local: readonly PlaceSearchSuggestion[],
  remote: readonly PlaceSearchSuggestion[],
  limit = PLACE_SEARCH_MAX_RESULTS + 2,
): PlaceSearchSuggestion[] {
  const seen = new Set<string>();
  const merged: PlaceSearchSuggestion[] = [];
  for (const item of [...local, ...remote]) {
    if (merged.length >= limit) break;
    const key = travelPlaceKey(item.formatted);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

function extractMarkerPosition(item: Record<string, unknown>): PlaceSearchCoordinates | null {
  const lat = item.lat;
  const lon = item.lon;
  if (typeof lat !== "number" || typeof lon !== "number" || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const resultType = cleanString(item.result_type).toLowerCase();
  if (resultType && COARSE_GEOAPIFY_RESULT_TYPES.has(resultType)) return null;
  return { latitude: lat, longitude: lon };
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
