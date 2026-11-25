/** Coordinates for a specific place result that can set a completion place marker. */
export type PlaceSearchCoordinates = Readonly<{
  latitude: number;
  longitude: number;
}>;

/** One place suggestion from local saved places or Geoapify autocomplete. */
export type PlaceSearchSuggestion = Readonly<{
  id: string;
  source: "saved" | "geoapify";
  /** Primary display line: place name or street address. */
  title: string;
  /** Secondary display line: address details, or null when already complete. */
  subtitle: string | null;
  /** Full text written into the Place or Home input when selected. */
  formatted: string;
  /** Specific coordinates eligible for a completion marker, or null for coarse/saved entries. */
  position: PlaceSearchCoordinates | null;
}>;

export type PlaceSearchResponse = Readonly<{
  suggestions: readonly PlaceSearchSuggestion[];
  attribution: string | null;
}>;
