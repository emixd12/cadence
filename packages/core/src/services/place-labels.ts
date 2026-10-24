import { Temporal } from "@js-temporal/polyfill";

import {
  CURRENT_PLACE_LABEL_RULES,
  DEFAULT_PLACE_LABEL_SETTINGS,
  WHERE_SUGGESTION_RULE_SETS,
  currentPlaceMarkers,
  isPlaceLabelRetention,
  isPlaceLabelValue,
  isPlaceRef,
  isWhereSuggestionKey,
  placeLabelRetentionCutoff,
  qualifyCompletionForPlaceLabel,
  resolvePlaceLabelState,
  savedPlaceRef,
  validMarkerPosition,
  type PlaceLabelOccurrence,
  type PlaceLabelRuleSet,
  type PlaceLabelStatusMark,
} from "../resolvers/place-label.resolver";
import type {
  CompletionCapturePlan,
  CompletionLabelInput,
  CompletionPlaceLabelRecord,
  PlaceLabelBehaviorRecord,
  PlaceLabelSettings,
  PlaceLabelSettingsInput,
  PlaceLabelSettingsRecord,
  PlaceLabelState,
  PlaceMarker,
  PlaceMarkerInput,
  PlaceMarkerRecord,
  WhereSuggestionDismissInput,
  WhereSuggestionDismissalRecord,
} from "../types/place-labels";
import { storedBehaviorWhere } from "./behavior-where";
import { travelPlaceKey } from "./travel-place-key";
import { normalizeUserAuthoredLocation } from "./travel-settings";

export class PlaceLabelError extends Error {
  constructor(readonly code: "invalid_request" | "conflict" | "off" | "not_eligible", message: string) {
    super(message);
    this.name = "PlaceLabelError";
  }
}

export function placeLabelSettingsFromRecord(row: PlaceLabelSettingsRecord | null): PlaceLabelSettings {
  if (!row) return DEFAULT_PLACE_LABEL_SETTINGS;
  return {
    enabled: row.enabled,
    retention: isPlaceLabelRetention(row.retention) ? row.retention : "90_days",
    enabledAt: row.enabled_at ? instant(row.enabled_at) : null,
    markerPromptDismissedAt: row.marker_prompt_dismissed_at ? instant(row.marker_prompt_dismissed_at) : null,
    updatedAt: instant(row.updated_at),
  };
}

export function placeMarkerFromRecord(row: PlaceMarkerRecord): PlaceMarker {
  if (!isPlaceRef(row.id)) throw new Error("The stored place marker is invalid.");
  return { ref: row.id, placeKey: row.place_key, latitudeE6: row.latitude_e6, longitudeE6: row.longitude_e6,
    accuracyMeters: row.accuracy_meters, ruleVersion: row.rule_version, recordedAt: instant(row.recorded_at) };
}

export function parsePlaceLabelSettingsInput(value: unknown): PlaceLabelSettingsInput {
  if (!record(value) || Object.keys(value).length !== 4 || typeof value.enabled !== "boolean"
    || !isPlaceLabelRetention(value.retention) || typeof value.markerPromptDismissed !== "boolean"
    || !(value.expectedUpdatedAt === null || typeof value.expectedUpdatedAt === "string")) {
    throw new PlaceLabelError("invalid_request", "Place label settings are invalid.");
  }
  return value as PlaceLabelSettingsInput;
}

export function parsePlaceMarkerInput(value: unknown): PlaceMarkerInput {
  const place = record(value) ? value.place : null, position = record(value) ? value.position : null;
  if (!record(value) || Object.keys(value).length !== 3 || !record(place) || !record(position)
    || !((place.kind === "home" && Object.keys(place).length === 1)
      || (place.kind === "saved_place" && typeof place.text === "string" && Object.keys(place).length === 2))
    || Object.keys(position).length !== 3
    || typeof value.sampleAgeSeconds !== "number" || !Number.isFinite(value.sampleAgeSeconds)
    || !validMarkerPosition(position as PlaceMarkerInput["position"], CURRENT_PLACE_LABEL_RULES)) {
    throw new PlaceLabelError("invalid_request", "The place marker is invalid.");
  }
  return value as PlaceMarkerInput;
}

export function parseCompletionLabelInput(value: unknown): CompletionLabelInput {
  if (!record(value) || Object.keys(value).length !== 3 || typeof value.occurrenceId !== "string"
    || !isPlaceLabelValue(value.label) || typeof value.ruleVersion !== "string") {
    throw new PlaceLabelError("invalid_request", "The place label is invalid.");
  }
  return value as CompletionLabelInput;
}

export function parseWhereSuggestionDismissInput(value: unknown): WhereSuggestionDismissInput {
  if (!record(value) || Object.keys(value).length !== 3 || typeof value.behaviorId !== "string"
    || !isWhereSuggestionKey(value.suggestion) || typeof value.ruleVersion !== "string"
    || !WHERE_SUGGESTION_RULE_SETS[value.ruleVersion]) {
    throw new PlaceLabelError("invalid_request", "The suggestion dismissal is invalid.");
  }
  return value as WhereSuggestionDismissInput;
}

/** Checks the compare-and-set token and returns the retention cutoff to apply in the same save. */
export function planPlaceLabelSettingsSave(current: PlaceLabelSettings, input: PlaceLabelSettingsInput, today: Temporal.PlainDate): Readonly<{ retentionCutoff: string | null }> {
  if ((current.updatedAt === null) !== (input.expectedUpdatedAt === null)
    || (current.updatedAt !== null && input.expectedUpdatedAt !== null && Temporal.Instant.compare(current.updatedAt, input.expectedUpdatedAt) !== 0)) {
    throw new PlaceLabelError("conflict", "Place label settings changed after they were loaded.");
  }
  return { retentionCutoff: input.enabled ? placeLabelRetentionCutoff(input.retention, today)?.toString() ?? null : null };
}

/** Plans the marker row for "I'm here". The device already checked sample age with its own clock. */
export function planPlaceMarker(input: Readonly<{
  settings: PlaceLabelSettings;
  marker: PlaceMarkerInput;
  homeText: string | null;
  recordedAt: string;
  rules?: PlaceLabelRuleSet;
}>): PlaceMarkerRecord {
  const rules = input.rules ?? CURRENT_PLACE_LABEL_RULES;
  if (!input.settings.enabled) throw new PlaceLabelError("off", "Turn on completion places first.");
  const { place, position, sampleAgeSeconds } = input.marker;
  if (sampleAgeSeconds < -5 || sampleAgeSeconds > rules.maxSampleAgeSeconds || !validMarkerPosition(position, rules)) {
    throw new PlaceLabelError("invalid_request", "The position is too old or too inaccurate.");
  }
  let id: string, placeKey: string;
  if (place.kind === "home") {
    if (!input.homeText?.trim()) throw new PlaceLabelError("invalid_request", "Save Home before recording its marker.");
    placeKey = travelPlaceKey(input.homeText);
    id = "home";
  } else {
    let text: string | null;
    try { text = normalizeUserAuthoredLocation(place.text); } catch { text = null; }
    if (!text) throw new PlaceLabelError("invalid_request", "Enter the place before recording its marker.");
    placeKey = travelPlaceKey(text);
    id = savedPlaceRef(placeKey);
  }
  return { id, place_key: placeKey, latitude_e6: position.latitudeE6, longitude_e6: position.longitudeE6,
    accuracy_meters: position.accuracyMeters, rule_version: rules.version, recorded_at: instant(input.recordedAt) };
}

export function buildPlaceLabelState(input: Readonly<{
  settings: PlaceLabelSettingsRecord | null;
  homeText: string | null;
  markers: readonly PlaceMarkerRecord[];
  labels: readonly CompletionPlaceLabelRecord[];
  dismissals: readonly WhereSuggestionDismissalRecord[];
  behaviors: readonly PlaceLabelBehaviorRecord[];
  today: Temporal.PlainDate;
}>): PlaceLabelState {
  return resolvePlaceLabelState({
    settings: placeLabelSettingsFromRecord(input.settings),
    homeText: input.homeText,
    markers: input.markers.map(placeMarkerFromRecord),
    labels: input.labels.flatMap((row) => isPlaceLabelValue(row.label) ? [{
      occurrenceId: row.id, behaviorId: row.behavior_id, localDate: row.local_date, label: row.label,
      ruleVersion: row.rule_version, recordedAt: instant(row.recorded_at),
    }] : []),
    dismissals: input.dismissals.flatMap((row) => isWhereSuggestionKey(row.suggestion) ? [{
      behaviorId: row.id, suggestion: row.suggestion, ruleVersion: row.rule_version, dismissedAt: instant(row.dismissed_at),
    }] : []),
    behaviors: input.behaviors.map((row) => {
      const where = storedBehaviorWhere(row);
      return { id: row.id, active: row.active, whereKind: where.where_kind, locationText: where.location_text };
    }),
    today: input.today,
  });
}

type CaptureContext = Readonly<{
  settings: PlaceLabelSettings;
  homeText: string | null;
  markers: readonly PlaceMarkerRecord[];
  occurrence: PlaceLabelOccurrence & Readonly<{ id: string; behaviorId: string }>;
  latestMark: PlaceLabelStatusMark | null;
  now: Temporal.Instant;
  rules?: PlaceLabelRuleSet;
}>;

/** What the device needs to label this completion, or null when it does not qualify. */
export function planCompletionCapture(input: CaptureContext): CompletionCapturePlan | null {
  const rules = input.rules ?? CURRENT_PLACE_LABEL_RULES;
  if (!input.settings.enabled) return null;
  if (!qualifyCompletionForPlaceLabel({ occurrence: input.occurrence, latestMark: input.latestMark, now: input.now, rules }).qualifies) return null;
  const markers = currentMarkers(input);
  if (!markers.length) return null;
  return { ruleVersion: rules.version, markers: markers.map(({ ref, latitudeE6, longitudeE6, accuracyMeters }) => ({ ref, latitudeE6, longitudeE6, accuracyMeters })) };
}

/** Re-checks qualification at write time and accepts only labels a current marker can produce. */
export function planCompletionLabel(input: CaptureContext & Readonly<{ label: CompletionLabelInput }>): CompletionPlaceLabelRecord {
  const rules = input.rules ?? CURRENT_PLACE_LABEL_RULES;
  if (!input.settings.enabled) throw new PlaceLabelError("off", "Completion places are off.");
  if (input.label.ruleVersion !== rules.version || input.label.occurrenceId !== input.occurrence.id) {
    throw new PlaceLabelError("invalid_request", "The place label is invalid.");
  }
  if (!qualifyCompletionForPlaceLabel({ occurrence: input.occurrence, latestMark: input.latestMark, now: input.now, rules }).qualifies) {
    throw new PlaceLabelError("not_eligible", "This completion cannot be labeled.");
  }
  const refs = new Set(currentMarkers(input).map(({ ref }) => ref as string));
  if (!refs.size || (input.label.label !== "elsewhere" && !refs.has(input.label.label))) {
    throw new PlaceLabelError("invalid_request", "The place label does not match a current marker.");
  }
  return { id: input.occurrence.id, behavior_id: input.occurrence.behaviorId, local_date: input.occurrence.localDate,
    label: input.label.label, rule_version: rules.version, recorded_at: input.now.toString() };
}

export function planWhereSuggestionDismissal(input: Readonly<{
  settings: PlaceLabelSettings;
  dismissal: WhereSuggestionDismissInput;
  dismissedAt: string;
}>): WhereSuggestionDismissalRecord {
  if (!input.settings.enabled) throw new PlaceLabelError("off", "Completion places are off.");
  return { id: input.dismissal.behaviorId, suggestion: input.dismissal.suggestion,
    rule_version: input.dismissal.ruleVersion, dismissed_at: instant(input.dismissedAt) };
}

function currentMarkers(input: Pick<CaptureContext, "homeText" | "markers">): PlaceMarker[] {
  const homeKey = input.homeText?.trim() ? travelPlaceKey(input.homeText) : null;
  return currentPlaceMarkers(input.markers.map(placeMarkerFromRecord), homeKey);
}

function instant(value: string): string {
  return Temporal.Instant.from(value).toString();
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
