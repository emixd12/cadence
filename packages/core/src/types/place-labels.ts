import type { BehaviorWhereKind } from "./behavior";

/** Ticket 216: how long completion place labels are kept. */
export const PLACE_LABEL_RETENTIONS = ["90_days", "1_year", "until_deleted"] as const;
export type PlaceLabelRetention = (typeof PLACE_LABEL_RETENTIONS)[number];

/** A place with a marker: Home or a saved place identified by its place key. */
export type PlaceRef = "home" | `saved_place:${string}`;
/** One stored label per completed occurrence. Never a position. */
export type PlaceLabelValue = PlaceRef | "elsewhere";
/** What a Where suggestion proposes. `add_place` cannot name the place. */
export type WhereSuggestionKind = "home" | "saved_place" | "anywhere" | "add_place";
/** Dismissal key: the suggestion kind, or `saved_place:<place key>`. */
export type WhereSuggestionKey = "home" | "anywhere" | "add_place" | `saved_place:${string}`;

export type PlaceLabelSettings = Readonly<{
  enabled: boolean;
  retention: PlaceLabelRetention;
  enabledAt: string | null;
  markerPromptDismissedAt: string | null;
  updatedAt: string | null;
}>;

/** A device position. Coordinates are integer microdegrees; accuracy is whole meters. */
export type PlaceMarkerPosition = Readonly<{
  latitudeE6: number;
  longitudeE6: number;
  accuracyMeters: number;
}>;

export type PlaceMarker = PlaceMarkerPosition & Readonly<{
  ref: PlaceRef;
  /** For Home, the place key of the Home text when the marker was recorded. */
  placeKey: string;
  ruleVersion: string;
  recordedAt: string;
}>;

export type CompletionPlaceLabel = Readonly<{
  occurrenceId: string;
  behaviorId: string;
  localDate: string;
  label: PlaceLabelValue;
  ruleVersion: string;
  recordedAt: string;
}>;

export type WhereSuggestionDismissal = Readonly<{
  behaviorId: string;
  suggestion: WhereSuggestionKey;
  ruleVersion: string;
  dismissedAt: string;
}>;

/** A device sample as the device reports it. Coordinates here are never stored. */
export type PlaceDeviceSample = Readonly<{
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  /** Device clock milliseconds when the position was measured. */
  sampledAt: number;
}>;

export type WhereSuggestion = Readonly<{
  ruleVersion: string;
  kind: WhereSuggestionKind;
  key: WhereSuggestionKey;
  /** Set only for `saved_place`. */
  placeKey: string | null;
  labelCount: number;
  supportingCount: number;
}>;

export type PlaceLabelBehaviorInput = Readonly<{
  id: string;
  active: boolean;
  whereKind: BehaviorWhereKind | null;
  locationText: string | null;
}>;

/** Everything the UI needs. It holds no coordinates. */
export type PlaceLabelState = Readonly<{
  settings: PlaceLabelSettings;
  homePlaceKey: string | null;
  homeMarker: Readonly<{ recordedAt: string; current: boolean }> | null;
  placeMarkers: readonly Readonly<{ placeKey: string; recordedAt: string }>[];
  labelCount: number;
  behaviors: readonly Readonly<{
    behaviorId: string;
    suggestion: WhereSuggestion | null;
    /** The place whose missing marker this Behavior should prompt for, if any. */
    markerPrompt: PlaceRef | null;
  }>[];
}>;

/** What a device needs to label one completion. */
export type CompletionCapturePlan = Readonly<{
  ruleVersion: string;
  markers: readonly (PlaceMarkerPosition & Readonly<{ ref: PlaceRef }>)[];
}>;
