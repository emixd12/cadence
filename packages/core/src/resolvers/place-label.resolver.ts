import { Temporal } from "@js-temporal/polyfill";

import { TRAVEL_PLACE_KEY_PATTERN, travelPlaceKey } from "../services/travel-place-key";
import type { BehaviorWhereKind } from "../types/behavior";
import {
  PLACE_LABEL_RETENTIONS,
  type CompletionCapturePlan,
  type CompletionPlaceLabel,
  type PlaceDeviceSample,
  type PlaceLabelBehaviorInput,
  type PlaceLabelRetention,
  type PlaceLabelSettings,
  type PlaceLabelState,
  type PlaceLabelValue,
  type PlaceMarker,
  type PlaceMarkerPosition,
  type PlaceRef,
  type WhereSuggestion,
  type WhereSuggestionDismissal,
  type WhereSuggestionKey,
} from "../types/place-labels";

/**
 * Ticket 216 rule sets. Each set is versioned and frozen: changing any value requires
 * a new version, a database migration that accepts it, and a pinned test.
 */
export type PlaceLabelRuleSet = Readonly<{
  version: string;
  /** A sample within this distance of a marker gets that marker's label. */
  matchRadiusMeters: number;
  /** A sample farther than this from every marker is labeled elsewhere. */
  elsewhereBeyondMeters: number;
  /** Oldest usable sample, for labels and for "I'm here". */
  maxSampleAgeSeconds: number;
  /** Worst usable accuracy radius, for labels and for "I'm here". */
  maxAccuracyMeters: number;
  /** A completion qualifies only while its status mark is this recent. */
  markFreshnessSeconds: number;
  exactBeforeMinutes: number;
  exactAfterMinutes: number;
  rangeBeforeStartMinutes: number;
  rangeAfterEndMinutes: number;
}>;

export type WhereSuggestionRuleSet = Readonly<{
  version: string;
  /** Labels count when their local date is within this many days, today included. */
  periodDays: number;
  minimumLabels: number;
  /** One label at or above this share is suggested. */
  dominantPercent: number;
  /** Two or more labels at or above this share each suggest Anywhere. */
  mixedPercent: number;
  mixedMinimumLabels: number;
  /** A dismissed suggestion returns only after this many newer labels. */
  dismissalNewLabels: number;
}>;

export const PLACE_LABEL_RULES_V1: PlaceLabelRuleSet = Object.freeze({
  version: "place-label-rules@1",
  matchRadiusMeters: 150,
  elsewhereBeyondMeters: 400,
  maxSampleAgeSeconds: 120,
  maxAccuracyMeters: 100,
  markFreshnessSeconds: 120,
  exactBeforeMinutes: 30,
  exactAfterMinutes: 120,
  rangeBeforeStartMinutes: 30,
  rangeAfterEndMinutes: 60,
});

export const WHERE_SUGGESTION_RULES_V1: WhereSuggestionRuleSet = Object.freeze({
  version: "where-suggestion-rules@1",
  periodDays: 60,
  minimumLabels: 6,
  dominantPercent: 80,
  mixedPercent: 25,
  mixedMinimumLabels: 2,
  dismissalNewLabels: 6,
});

export const PLACE_LABEL_RULE_SETS: Readonly<Record<string, PlaceLabelRuleSet>> = Object.freeze({
  [PLACE_LABEL_RULES_V1.version]: PLACE_LABEL_RULES_V1,
});
export const WHERE_SUGGESTION_RULE_SETS: Readonly<Record<string, WhereSuggestionRuleSet>> = Object.freeze({
  [WHERE_SUGGESTION_RULES_V1.version]: WHERE_SUGGESTION_RULES_V1,
});
export const CURRENT_PLACE_LABEL_RULES = PLACE_LABEL_RULES_V1;
export const CURRENT_WHERE_SUGGESTION_RULES = WHERE_SUGGESTION_RULES_V1;

export const DEFAULT_PLACE_LABEL_SETTINGS: PlaceLabelSettings = Object.freeze({
  enabled: false,
  retention: "90_days",
  enabledAt: null,
  markerPromptDismissedAt: null,
  updatedAt: null,
});

const SAVED_PLACE_PREFIX = "saved_place:";
const EARTH_RADIUS_METERS = 6_371_000;

export function isPlaceLabelRetention(value: unknown): value is PlaceLabelRetention {
  return typeof value === "string" && (PLACE_LABEL_RETENTIONS as readonly string[]).includes(value);
}

export function isPlaceRef(value: unknown): value is PlaceRef {
  return value === "home" || (typeof value === "string" && value.startsWith(SAVED_PLACE_PREFIX)
    && TRAVEL_PLACE_KEY_PATTERN.test(value.slice(SAVED_PLACE_PREFIX.length)));
}

export function isPlaceLabelValue(value: unknown): value is PlaceLabelValue {
  return value === "elsewhere" || isPlaceRef(value);
}

export function isWhereSuggestionKey(value: unknown): value is WhereSuggestionKey {
  return value === "home" || value === "anywhere" || value === "add_place" || (isPlaceRef(value) && value !== "home");
}

export function savedPlaceRef(placeKey: string): PlaceRef {
  if (!TRAVEL_PLACE_KEY_PATTERN.test(placeKey)) throw new Error("The place key is invalid.");
  return `${SAVED_PLACE_PREFIX}${placeKey}`;
}

export function savedPlaceKey(ref: PlaceRef): string | null {
  return ref === "home" ? null : ref.slice(SAVED_PLACE_PREFIX.length);
}

/** The marker a Behavior's Where needs: Home, its saved place, or none. */
export function placeRefForWhere(where: Readonly<{ whereKind: BehaviorWhereKind | null; locationText: string | null }>): PlaceRef | null {
  if (where.whereKind === "home") return "home";
  if (where.whereKind === "place" && where.locationText?.trim()) return savedPlaceRef(travelPlaceKey(where.locationText));
  return null;
}

/** Microdegrees keep stored positions exact on every platform; 0.000001° is about 0.11 m. */
export function positionFromSample(sample: Pick<PlaceDeviceSample, "latitude" | "longitude" | "accuracyMeters">): PlaceMarkerPosition {
  return {
    latitudeE6: Math.round(sample.latitude * 1_000_000),
    longitudeE6: Math.round(sample.longitude * 1_000_000),
    accuracyMeters: Math.ceil(sample.accuracyMeters),
  };
}

export type DeviceSampleCheck =
  | Readonly<{ usable: true }>
  | Readonly<{ usable: false; reason: "invalid" | "stale" | "inaccurate" }>;

/** The device clock measures sample age, so device and sample share one clock. */
export function checkDeviceSample(sample: PlaceDeviceSample, deviceNowMs: number, rules: PlaceLabelRuleSet): DeviceSampleCheck {
  if (![sample.latitude, sample.longitude, sample.accuracyMeters, sample.sampledAt, deviceNowMs].every(Number.isFinite)
    || Math.abs(sample.latitude) > 90 || Math.abs(sample.longitude) > 180 || sample.accuracyMeters < 0) {
    return { usable: false, reason: "invalid" };
  }
  const ageMs = deviceNowMs - sample.sampledAt;
  if (ageMs < -5_000 || ageMs > rules.maxSampleAgeSeconds * 1_000) return { usable: false, reason: "stale" };
  if (sample.accuracyMeters > rules.maxAccuracyMeters) return { usable: false, reason: "inaccurate" };
  return { usable: true };
}

export function validMarkerPosition(position: PlaceMarkerPosition, rules: PlaceLabelRuleSet): boolean {
  return Number.isInteger(position.latitudeE6) && Math.abs(position.latitudeE6) <= 90_000_000
    && Number.isInteger(position.longitudeE6) && Math.abs(position.longitudeE6) <= 180_000_000
    && Number.isInteger(position.accuracyMeters) && position.accuracyMeters >= 0
    && position.accuracyMeters <= rules.maxAccuracyMeters;
}

/** Great-circle distance between two microdegree positions. */
export function placeDistanceMeters(left: Pick<PlaceMarkerPosition, "latitudeE6" | "longitudeE6">, right: Pick<PlaceMarkerPosition, "latitudeE6" | "longitudeE6">): number {
  const radians = (microdegrees: number) => microdegrees / 1_000_000 * Math.PI / 180;
  const latitudeDelta = radians(right.latitudeE6 - left.latitudeE6);
  const longitudeDelta = radians(right.longitudeE6 - left.longitudeE6);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(left.latitudeE6)) * Math.cos(radians(right.latitudeE6)) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Markers that apply now. A Home marker stops applying when the Home text changes. */
export function currentPlaceMarkers<T extends Pick<PlaceMarker, "ref" | "placeKey">>(markers: readonly T[], homePlaceKey: string | null): T[] {
  return markers.filter((marker) => marker.ref !== "home" || (homePlaceKey !== null && marker.placeKey === homePlaceKey));
}

export type CompletionPlaceLabelResult =
  | Readonly<{ kind: "label"; label: PlaceLabelValue; ruleVersion: string }>
  | Readonly<{ kind: "none"; reason: "invalid" | "stale" | "inaccurate" | "no_markers" | "between_radii" }>;

/** Compares one completion sample with the current markers. The caller discards the sample. */
export function resolveCompletionPlaceLabel(input: Readonly<{
  sample: PlaceDeviceSample;
  markers: CompletionCapturePlan["markers"];
  deviceNowMs: number;
  rules: PlaceLabelRuleSet;
}>): CompletionPlaceLabelResult {
  const check = checkDeviceSample(input.sample, input.deviceNowMs, input.rules);
  if (!check.usable) return { kind: "none", reason: check.reason };
  if (!input.markers.length) return { kind: "none", reason: "no_markers" };
  const sample = positionFromSample(input.sample);
  const ranked = input.markers
    .map((marker) => ({ ref: marker.ref, distance: placeDistanceMeters(sample, marker) }))
    .sort((left, right) => left.distance - right.distance || (left.ref === "home" ? -1 : right.ref === "home" ? 1 : left.ref < right.ref ? -1 : 1));
  const nearest = ranked[0]!;
  if (nearest.distance <= input.rules.matchRadiusMeters) return { kind: "label", label: nearest.ref, ruleVersion: input.rules.version };
  if (nearest.distance > input.rules.elsewhereBeyondMeters) return { kind: "label", label: "elsewhere", ruleVersion: input.rules.version };
  return { kind: "none", reason: "between_radii" };
}

export type PlaceLabelOccurrence = Readonly<{
  status: string;
  localDate: string;
  timezone: string;
  scheduledFor: string;
  scheduleKind: string;
  scheduleStartTime: string;
  scheduleEndTime: string | null;
}>;

export type PlaceLabelStatusMark = Readonly<{
  status: string;
  previousStatus: string | null;
  sourceCaptureMethod: string;
  recordedAt: string;
}>;

export type CompletionQualification =
  | Readonly<{ qualifies: true }>
  | Readonly<{ qualifies: false; reason: "not_completed" | "not_first_resolution" | "not_a_tap" | "not_fresh" | "other_day" | "outside_hours" | "invalid" }>;

/** The instants between which a completion may be labeled. */
export function completionLabelSpan(occurrence: PlaceLabelOccurrence, rules: PlaceLabelRuleSet): Readonly<{ start: Temporal.Instant; end: Temporal.Instant }> {
  if (occurrence.scheduleKind === "range") {
    const date = Temporal.PlainDate.from(occurrence.localDate);
    const startTime = Temporal.PlainTime.from(occurrence.scheduleStartTime);
    const endTime = Temporal.PlainTime.from(occurrence.scheduleEndTime ?? occurrence.scheduleStartTime);
    const start = date.toZonedDateTime({ timeZone: occurrence.timezone, plainTime: startTime });
    // A range that ends at or before its start ends on the next day (Evening ends at midnight).
    const endDate = Temporal.PlainTime.compare(endTime, startTime) <= 0 ? date.add({ days: 1 }) : date;
    const end = endDate.toZonedDateTime({ timeZone: occurrence.timezone, plainTime: endTime });
    return {
      start: start.toInstant().subtract({ minutes: rules.rangeBeforeStartMinutes }),
      end: end.toInstant().add({ minutes: rules.rangeAfterEndMinutes }),
    };
  }
  const scheduled = Temporal.Instant.from(occurrence.scheduledFor);
  return { start: scheduled.subtract({ minutes: rules.exactBeforeMinutes }), end: scheduled.add({ minutes: rules.exactAfterMinutes }) };
}

/**
 * A completion qualifies only for the tap that just marked it Completed from Unresolved,
 * on the occurrence's local date and within its hours. Needs decision resolutions,
 * imports, MCP marks, synced marks and later corrections never qualify.
 */
export function qualifyCompletionForPlaceLabel(input: Readonly<{
  occurrence: PlaceLabelOccurrence;
  latestMark: PlaceLabelStatusMark | null;
  now: Temporal.Instant;
  rules: PlaceLabelRuleSet;
}>): CompletionQualification {
  const { occurrence, latestMark, rules } = input;
  if (occurrence.status !== "completed" || !latestMark || latestMark.status !== "completed") return { qualifies: false, reason: "not_completed" };
  if (latestMark.previousStatus !== "unresolved") return { qualifies: false, reason: "not_first_resolution" };
  if (latestMark.sourceCaptureMethod !== "manual_tap") return { qualifies: false, reason: "not_a_tap" };
  let marked: Temporal.Instant, span: ReturnType<typeof completionLabelSpan>;
  try {
    marked = Temporal.Instant.from(latestMark.recordedAt);
    span = completionLabelSpan(occurrence, rules);
    if (marked.toZonedDateTimeISO(occurrence.timezone).toPlainDate().toString() !== occurrence.localDate) return { qualifies: false, reason: "other_day" };
  } catch { return { qualifies: false, reason: "invalid" }; }
  const age = input.now.since(marked).total("seconds");
  if (age < -5 || age > rules.markFreshnessSeconds) return { qualifies: false, reason: "not_fresh" };
  if (Temporal.Instant.compare(marked, span.start) < 0 || Temporal.Instant.compare(marked, span.end) > 0) return { qualifies: false, reason: "outside_hours" };
  return { qualifies: true };
}

/** Labels with a local date before the returned date have expired. Null keeps them all. */
export function placeLabelRetentionCutoff(retention: PlaceLabelRetention, today: Temporal.PlainDate): Temporal.PlainDate | null {
  if (retention === "90_days") return today.subtract({ days: 90 });
  if (retention === "1_year") return today.subtract({ years: 1 });
  return null;
}

/** True when switching retention deletes labels. */
export function placeLabelRetentionShortens(from: PlaceLabelRetention, to: PlaceLabelRetention): boolean {
  return PLACE_LABEL_RETENTIONS.indexOf(to) < PLACE_LABEL_RETENTIONS.indexOf(from);
}

type SuggestionLabel = Pick<CompletionPlaceLabel, "label" | "localDate" | "recordedAt">;

/** Applies where-suggestion rules to one Behavior's labels. Never changes the Behavior. */
export function resolveWhereSuggestion(input: Readonly<{
  where: Readonly<{ whereKind: BehaviorWhereKind | null; placeRef: PlaceRef | null }>;
  labels: readonly SuggestionLabel[];
  dismissal: Pick<WhereSuggestionDismissal, "dismissedAt"> | null;
  /** Places with a current marker; a suggestion can name only these. */
  markedPlaces: ReadonlySet<PlaceRef>;
  today: Temporal.PlainDate;
  rules: WhereSuggestionRuleSet;
}>): WhereSuggestion | null {
  const { where, rules } = input;
  // Without its own marker, a located Behavior cannot be confirmed; the marker prompt shows instead.
  if (where.placeRef && !input.markedPlaces.has(where.placeRef)) return null;
  const first = input.today.subtract({ days: rules.periodDays - 1 }).toString(), last = input.today.toString();
  const recent = input.labels.filter((label) => label.localDate >= first && label.localDate <= last);
  if (recent.length < rules.minimumLabels) return null;
  if (input.dismissal) {
    const dismissedAt = Temporal.Instant.from(input.dismissal.dismissedAt);
    const newer = input.labels.filter((label) => Temporal.Instant.compare(Temporal.Instant.from(label.recordedAt), dismissedAt) > 0).length;
    if (newer < rules.dismissalNewLabels) return null;
  }
  const counts = new Map<PlaceLabelValue, number>();
  for (const label of recent) counts.set(label.label, (counts.get(label.label) ?? 0) + 1);
  const share = (count: number, percent: number) => count * 100 >= recent.length * percent;
  const ranked = [...counts].sort(([leftLabel, left], [rightLabel, right]) => right - left || (leftLabel < rightLabel ? -1 : 1));
  const [topLabel, topCount] = ranked[0]!;
  let suggestion: WhereSuggestion | null = null;
  if (share(topCount, rules.dominantPercent)) {
    if (topLabel === "elsewhere") suggestion = build("add_place", "add_place", null, topCount);
    else if (topLabel === "home") suggestion = input.markedPlaces.has("home") ? build("home", "home", null, topCount) : null;
    else suggestion = input.markedPlaces.has(topLabel) ? build("saved_place", topLabel, savedPlaceKey(topLabel), topCount) : null;
  } else {
    const mixed = ranked.filter(([, count]) => share(count, rules.mixedPercent));
    if (mixed.length >= rules.mixedMinimumLabels) suggestion = build("anywhere", "anywhere", null, mixed.reduce((sum, [, count]) => sum + count, 0));
  }
  if (!suggestion || agrees(suggestion, where)) return null;
  return suggestion;

  function build(kind: WhereSuggestion["kind"], key: WhereSuggestionKey, placeKey: string | null, supportingCount: number): WhereSuggestion {
    return { ruleVersion: rules.version, kind, key, placeKey, labelCount: recent.length, supportingCount };
  }
}

function agrees(suggestion: WhereSuggestion, where: Readonly<{ whereKind: BehaviorWhereKind | null; placeRef: PlaceRef | null }>): boolean {
  switch (suggestion.kind) {
    case "home": return where.whereKind === "home";
    case "saved_place": return where.whereKind === "place" && where.placeRef === suggestion.key;
    case "anywhere": return where.whereKind === "anywhere";
    // `elsewhere` can be many places, which Anywhere already allows.
    case "add_place": return where.whereKind === "anywhere";
  }
}

/** Builds the coordinate-free view every surface shares. */
export function resolvePlaceLabelState(input: Readonly<{
  settings: PlaceLabelSettings;
  homeText: string | null;
  markers: readonly Pick<PlaceMarker, "ref" | "placeKey" | "recordedAt">[];
  labels: readonly CompletionPlaceLabel[];
  dismissals: readonly WhereSuggestionDismissal[];
  /** In display order; the first Behavior per place carries its marker prompt. */
  behaviors: readonly PlaceLabelBehaviorInput[];
  today: Temporal.PlainDate;
  rules?: WhereSuggestionRuleSet;
}>): PlaceLabelState {
  const rules = input.rules ?? CURRENT_WHERE_SUGGESTION_RULES;
  const homePlaceKey = input.homeText?.trim() ? travelPlaceKey(input.homeText) : null;
  if (!input.settings.enabled) {
    return { settings: input.settings, homePlaceKey, homeMarker: null, placeMarkers: [], labelCount: 0,
      behaviors: input.behaviors.map((behavior) => ({ behaviorId: behavior.id, suggestion: null, suggestedPlaceText: null, markerPrompt: null })) };
  }
  const home = input.markers.find((marker) => marker.ref === "home") ?? null;
  const current = currentPlaceMarkers(input.markers, homePlaceKey);
  const markedPlaces = new Set(current.map((marker) => marker.ref));
  const labelsByBehavior = new Map<string, CompletionPlaceLabel[]>();
  for (const label of input.labels) labelsByBehavior.set(label.behaviorId, [...(labelsByBehavior.get(label.behaviorId) ?? []), label]);
  const dismissals = new Map(input.dismissals.map((dismissal) => [dismissal.behaviorId, dismissal]));
  const placeTexts = new Map<PlaceRef, string>();
  for (const behavior of input.behaviors) {
    const ref = behavior.whereKind === "place" ? placeRefForWhere(behavior) : null;
    if (ref && !placeTexts.has(ref)) placeTexts.set(ref, behavior.locationText!.trim());
  }
  const prompted = new Set<PlaceRef>();
  const promptsOn = input.settings.markerPromptDismissedAt === null;
  return {
    settings: input.settings,
    homePlaceKey,
    homeMarker: home ? { recordedAt: home.recordedAt, current: home.placeKey === homePlaceKey } : null,
    placeMarkers: input.markers.flatMap((marker) => marker.ref === "home" ? [] : [{ placeKey: marker.placeKey, recordedAt: marker.recordedAt }]),
    labelCount: input.labels.length,
    behaviors: input.behaviors.map((behavior) => {
      const placeRef = placeRefForWhere(behavior);
      // Home needs its text before a marker can apply to it.
      const needsMarker = behavior.active && placeRef !== null && !markedPlaces.has(placeRef) && (placeRef !== "home" || homePlaceKey !== null);
      const markerPrompt = promptsOn && needsMarker && placeRef && !prompted.has(placeRef) ? placeRef : null;
      if (markerPrompt) prompted.add(markerPrompt);
      const resolved = behavior.active ? resolveWhereSuggestion({
        where: { whereKind: behavior.whereKind, placeRef },
        labels: labelsByBehavior.get(behavior.id) ?? [],
        dismissal: dismissals.get(behavior.id) ?? null,
        markedPlaces,
        today: input.today,
        rules,
      }) : null;
      // A saved place can be suggested only while some Behavior still names it.
      const suggestedPlaceText = resolved?.kind === "saved_place" ? placeTexts.get(resolved.key as PlaceRef) ?? null : null;
      const suggestion = resolved?.kind === "saved_place" && !suggestedPlaceText ? null : resolved;
      return { behaviorId: behavior.id, suggestion, suggestedPlaceText, markerPrompt };
    }),
  };
}

export type PlaceLabelCountProjection = Readonly<{
  behaviorId: string;
  periodDays: number;
  total: number;
  atHome: number;
  /** At the saved place named by the Behavior's own Where. */
  atWherePlace: number;
  atOtherSavedPlace: number;
  elsewhere: number;
}>;

/**
 * Ticket 219 input candidate: counts only, never place keys, positions or text.
 * Ticket 219 stage 2 sends these counts to Daily Brief model input through
 * `advisorPlaceLabelCounts`.
 */
export function projectPlaceLabelCounts(input: Readonly<{
  labels: readonly Pick<CompletionPlaceLabel, "behaviorId" | "label" | "localDate">[];
  behaviors: readonly Pick<PlaceLabelBehaviorInput, "id" | "whereKind" | "locationText">[];
  today: Temporal.PlainDate;
  rules?: WhereSuggestionRuleSet;
}>): PlaceLabelCountProjection[] {
  const rules = input.rules ?? CURRENT_WHERE_SUGGESTION_RULES;
  const first = input.today.subtract({ days: rules.periodDays - 1 }).toString(), last = input.today.toString();
  return input.behaviors.map((behavior) => {
    const own = placeRefForWhere(behavior);
    const labels = input.labels.filter((label) => label.behaviorId === behavior.id && label.localDate >= first && label.localDate <= last);
    const count = (predicate: (label: PlaceLabelValue) => boolean) => labels.filter((label) => predicate(label.label)).length;
    return {
      behaviorId: behavior.id,
      periodDays: rules.periodDays,
      total: labels.length,
      atHome: count((label) => label === "home"),
      atWherePlace: count((label) => label !== "home" && label !== "elsewhere" && label === own),
      atOtherSavedPlace: count((label) => label !== "home" && label !== "elsewhere" && label !== own),
      elsewhere: count((label) => label === "elsewhere"),
    };
  });
}
