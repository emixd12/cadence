import { createHash } from "node:crypto";

import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";

import {
  CURRENT_PLACE_LABEL_RULES,
  CURRENT_WHERE_SUGGESTION_RULES,
  PLACE_LABEL_RULES_V1,
  PLACE_LABEL_RULE_SETS,
  WHERE_SUGGESTION_RULES_V1,
  WHERE_SUGGESTION_RULE_SETS,
  checkDeviceSample,
  completionLabelSpan,
  currentPlaceMarkers,
  isPlaceRef,
  isWhereSuggestionKey,
  placeDistanceMeters,
  placeLabelRetentionCutoff,
  placeLabelRetentionShortens,
  placeRefForWhere,
  positionFromSample,
  projectPlaceLabelCounts,
  qualifyCompletionForPlaceLabel,
  resolveCompletionPlaceLabel,
  resolvePlaceLabelState,
  resolveWhereGuessSuggestion,
  resolveWhereSuggestion,
  savedPlaceRef,
  shownWhereGuessKey,
  whereSuggestionDismissible,
  WHERE_GUESS_DISMISSAL_KEYS,
  type PlaceLabelOccurrence,
} from "@cadence/core/resolvers/place-label.resolver";
import { normalizeTravelPlaceText } from "@cadence/core/services/travel-refresh-policy";
import { travelPlaceKey } from "@cadence/core/services/travel-place-key";
import type { CompletionPlaceLabel, PlaceLabelSettings, PlaceRef } from "@cadence/core/types/place-labels";

const METERS_PER_MICRODEGREE = 2 * Math.PI * 6_371_000 / 360 / 1_000_000;
const HOME = { latitudeE6: 41_878_100, longitudeE6: -87_629_800 };
const GYM_REF = savedPlaceRef(travelPlaceKey("1 Gym Street"));

function north(meters: number, from = HOME) {
  return { latitudeE6: from.latitudeE6 + Math.round(meters / METERS_PER_MICRODEGREE), longitudeE6: from.longitudeE6 };
}

function sample(meters: number, overrides: Partial<{ accuracyMeters: number; ageMs: number }> = {}) {
  const position = north(meters);
  return {
    latitude: position.latitudeE6 / 1_000_000,
    longitude: position.longitudeE6 / 1_000_000,
    accuracyMeters: overrides.accuracyMeters ?? 20,
    sampledAt: 1_000_000 - (overrides.ageMs ?? 1_000),
  };
}

describe("versioned rule sets", () => {
  it("pins place-label-rules@1", () => {
    expect(PLACE_LABEL_RULES_V1).toEqual({
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
    expect(Object.isFrozen(PLACE_LABEL_RULES_V1)).toBe(true);
  });

  it("pins where-suggestion-rules@1", () => {
    expect(WHERE_SUGGESTION_RULES_V1).toEqual({
      version: "where-suggestion-rules@1",
      periodDays: 60,
      minimumLabels: 6,
      dominantPercent: 80,
      mixedPercent: 25,
      mixedMinimumLabels: 2,
      dismissalNewLabels: 6,
    });
    expect(Object.isFrozen(WHERE_SUGGESTION_RULES_V1)).toBe(true);
  });

  it("registers each version once, and a new value needs a new version", () => {
    expect(Object.keys(PLACE_LABEL_RULE_SETS)).toEqual(["place-label-rules@1"]);
    expect(Object.keys(WHERE_SUGGESTION_RULE_SETS)).toEqual(["where-suggestion-rules@1"]);
    for (const [version, rules] of [...Object.entries(PLACE_LABEL_RULE_SETS), ...Object.entries(WHERE_SUGGESTION_RULE_SETS)]) {
      expect(rules.version).toBe(version);
    }
    expect(CURRENT_PLACE_LABEL_RULES).toBe(PLACE_LABEL_RULES_V1);
    expect(CURRENT_WHERE_SUGGESTION_RULES).toBe(WHERE_SUGGESTION_RULES_V1);
  });
});

describe("place identity", () => {
  it("matches the Ticket 214 place-cache key", () => {
    const text = "  1 Gym   STREET ";
    expect(travelPlaceKey(text)).toBe(createHash("sha256").update(normalizeTravelPlaceText(text)).digest("base64url"));
    expect(travelPlaceKey(text)).toBe(travelPlaceKey("1 gym street"));
  });

  it("maps Where to the marker it needs", () => {
    expect(placeRefForWhere({ whereKind: "home", locationText: null })).toBe("home");
    expect(placeRefForWhere({ whereKind: "place", locationText: "1 Gym Street" })).toBe(GYM_REF);
    expect(placeRefForWhere({ whereKind: "anywhere", locationText: null })).toBeNull();
    expect(placeRefForWhere({ whereKind: null, locationText: null })).toBeNull();
    expect(isPlaceRef(GYM_REF)).toBe(true);
    expect(isPlaceRef("saved_place:short")).toBe(false);
    expect(isWhereSuggestionKey("home")).toBe(true);
    expect(isWhereSuggestionKey("elsewhere")).toBe(false);
  });
});

describe("device samples", () => {
  it("stores microdegrees and whole meters", () => {
    expect(positionFromSample({ latitude: 41.8781004, longitude: -87.6297996, accuracyMeters: 12.2 }))
      .toEqual({ latitudeE6: 41_878_100, longitudeE6: -87_629_800, accuracyMeters: 13 });
  });

  it("accepts samples up to two minutes old with accuracy of 100 m or better", () => {
    const rules = PLACE_LABEL_RULES_V1;
    expect(checkDeviceSample(sample(0, { ageMs: 120_000, accuracyMeters: 100 }), 1_000_000, rules)).toEqual({ usable: true });
    expect(checkDeviceSample(sample(0, { ageMs: 120_001 }), 1_000_000, rules)).toEqual({ usable: false, reason: "stale" });
    expect(checkDeviceSample(sample(0, { accuracyMeters: 100.5 }), 1_000_000, rules)).toEqual({ usable: false, reason: "inaccurate" });
    expect(checkDeviceSample({ ...sample(0), latitude: 91 }, 1_000_000, rules)).toEqual({ usable: false, reason: "invalid" });
  });
});

describe("resolveCompletionPlaceLabel", () => {
  const markers = [{ ref: "home" as PlaceRef, ...HOME, accuracyMeters: 10 }, { ref: GYM_REF, ...north(2_000), accuracyMeters: 10 }];
  const label = (meters: number, list = markers) =>
    resolveCompletionPlaceLabel({ sample: sample(meters), markers: list, deviceNowMs: 1_000_000, rules: PLACE_LABEL_RULES_V1 });

  it("labels within 150 m, elsewhere beyond 400 m, and nothing in between", () => {
    expect(label(149)).toEqual({ kind: "label", label: "home", ruleVersion: "place-label-rules@1" });
    expect(label(151)).toEqual({ kind: "none", reason: "between_radii" });
    expect(label(399)).toEqual({ kind: "none", reason: "between_radii" });
    expect(label(401)).toEqual({ kind: "label", label: "elsewhere", ruleVersion: "place-label-rules@1" });
    expect(label(1_950)).toEqual({ kind: "label", label: GYM_REF, ruleVersion: "place-label-rules@1" });
  });

  it("chooses the nearest marker and lets Home win a tie", () => {
    const close = [{ ref: GYM_REF, ...north(100), accuracyMeters: 5 }, { ref: "home" as PlaceRef, ...HOME, accuracyMeters: 5 }];
    expect(label(90, close)).toMatchObject({ label: GYM_REF });
    expect(label(0, [{ ref: GYM_REF, ...HOME, accuracyMeters: 5 }, { ref: "home", ...HOME, accuracyMeters: 5 }])).toMatchObject({ label: "home" });
  });

  it("stores nothing without markers or with an unusable sample", () => {
    expect(label(0, [])).toEqual({ kind: "none", reason: "no_markers" });
    expect(resolveCompletionPlaceLabel({ sample: sample(0, { ageMs: 200_000 }), markers, deviceNowMs: 1_000_000, rules: PLACE_LABEL_RULES_V1 }))
      .toEqual({ kind: "none", reason: "stale" });
  });

  it("measures great-circle distance", () => {
    expect(placeDistanceMeters(HOME, north(150))).toBeCloseTo(150, 0);
  });

  it("ignores a Home marker recorded for different Home text", () => {
    const stored = [{ ref: "home" as PlaceRef, placeKey: travelPlaceKey("Old home") }, { ref: GYM_REF, placeKey: travelPlaceKey("1 Gym Street") }];
    expect(currentPlaceMarkers(stored, travelPlaceKey("New home")).map(({ ref }) => ref)).toEqual([GYM_REF]);
    expect(currentPlaceMarkers(stored, travelPlaceKey("old  HOME")).map(({ ref }) => ref)).toEqual(["home", GYM_REF]);
    expect(currentPlaceMarkers(stored, null).map(({ ref }) => ref)).toEqual([GYM_REF]);
  });
});

describe("qualifyCompletionForPlaceLabel", () => {
  const exact: PlaceLabelOccurrence = {
    status: "completed", localDate: "2026-10-22", timezone: "America/New_York",
    scheduledFor: "2026-10-22T13:00:00Z", scheduleKind: "exact", scheduleStartTime: "09:00:00", scheduleEndTime: null,
  };
  const mark = (recordedAt: string, overrides: Partial<{ previousStatus: string | null; sourceCaptureMethod: string; status: string }> = {}) => ({
    status: "completed", previousStatus: "unresolved", sourceCaptureMethod: "manual_tap", recordedAt, ...overrides,
  });
  const qualify = (occurrence: PlaceLabelOccurrence, recordedAt: string, overrides = {}, now = recordedAt) =>
    qualifyCompletionForPlaceLabel({ occurrence, latestMark: mark(recordedAt, overrides), now: Temporal.Instant.from(now), rules: PLACE_LABEL_RULES_V1 });

  it("accepts exact-time completions from 30 minutes before to two hours after", () => {
    expect(qualify(exact, "2026-10-22T12:30:00Z")).toEqual({ qualifies: true });
    expect(qualify(exact, "2026-10-22T15:00:00Z")).toEqual({ qualifies: true });
    expect(qualify(exact, "2026-10-22T12:29:59Z")).toEqual({ qualifies: false, reason: "outside_hours" });
    expect(qualify(exact, "2026-10-22T15:00:01Z")).toEqual({ qualifies: false, reason: "outside_hours" });
  });

  it("accepts range completions from 30 minutes before the start to one hour after the end", () => {
    const evening: PlaceLabelOccurrence = { ...exact, scheduleKind: "range", scheduleStartTime: "18:00:00", scheduleEndTime: "00:00:00", scheduledFor: "2026-10-22T22:00:00Z" };
    const span = completionLabelSpan(evening, PLACE_LABEL_RULES_V1);
    expect(span.start.toString()).toBe("2026-10-22T21:30:00Z");
    expect(span.end.toString()).toBe("2026-10-23T05:00:00Z");
    expect(qualify(evening, "2026-10-22T21:30:00Z")).toEqual({ qualifies: true });
    // After local midnight the completion belongs to another day.
    expect(qualify(evening, "2026-10-23T04:30:00Z")).toEqual({ qualifies: false, reason: "other_day" });
  });

  it("rejects corrections, Needs decision, imports, MCP marks and stale reads", () => {
    expect(qualify(exact, "2026-10-22T13:00:00Z", { previousStatus: "not_completed" })).toEqual({ qualifies: false, reason: "not_first_resolution" });
    expect(qualify(exact, "2026-10-22T13:00:00Z", { sourceCaptureMethod: "manual_text" })).toEqual({ qualifies: false, reason: "not_a_tap" });
    expect(qualify(exact, "2026-10-22T13:00:00Z", {}, "2026-10-22T13:02:01Z")).toEqual({ qualifies: false, reason: "not_fresh" });
    expect(qualify({ ...exact, localDate: "2026-10-21", scheduledFor: "2026-10-21T13:00:00Z" }, "2026-10-22T13:00:00Z")).toEqual({ qualifies: false, reason: "other_day" });
    expect(qualify({ ...exact, status: "not_completed" }, "2026-10-22T13:00:00Z")).toEqual({ qualifies: false, reason: "not_completed" });
    expect(qualifyCompletionForPlaceLabel({ occurrence: exact, latestMark: null, now: Temporal.Instant.from("2026-10-22T13:00:00Z"), rules: PLACE_LABEL_RULES_V1 }))
      .toEqual({ qualifies: false, reason: "not_completed" });
  });
});

describe("retention", () => {
  it("cuts off at 90 days or one year, or keeps everything", () => {
    const today = Temporal.PlainDate.from("2026-10-22");
    expect(placeLabelRetentionCutoff("90_days", today)?.toString()).toBe("2026-07-24");
    expect(placeLabelRetentionCutoff("1_year", today)?.toString()).toBe("2025-10-22");
    expect(placeLabelRetentionCutoff("until_deleted", today)).toBeNull();
    expect(placeLabelRetentionShortens("until_deleted", "90_days")).toBe(true);
    expect(placeLabelRetentionShortens("90_days", "1_year")).toBe(false);
  });
});

describe("resolveWhereSuggestion", () => {
  const today = Temporal.PlainDate.from("2026-10-22");
  const labels = (values: readonly (CompletionPlaceLabel["label"])[], localDate = "2026-10-20", recordedAt = "2026-10-20T12:00:00Z") =>
    values.map((label) => ({ label, localDate, recordedAt }));
  const marked = new Set<PlaceRef>(["home", GYM_REF]);
  const suggest = (values: readonly CompletionPlaceLabel["label"][], where: { whereKind: "home" | "place" | "anywhere" | null; placeRef: PlaceRef | null } = { whereKind: null, placeRef: null }, extra: Partial<Parameters<typeof resolveWhereSuggestion>[0]> = {}) =>
    resolveWhereSuggestion({ where, labels: labels(values), dismissal: null, markedPlaces: marked, today, rules: WHERE_SUGGESTION_RULES_V1, ...extra });

  it("needs six labels in the last 60 days", () => {
    expect(suggest(["home", "home", "home", "home", "home"])).toBeNull();
    expect(resolveWhereSuggestion({ where: { whereKind: null, placeRef: null }, labels: labels(Array(6).fill("home"), "2026-08-24"), dismissal: null, markedPlaces: marked, today, rules: WHERE_SUGGESTION_RULES_V1 }))
      .toMatchObject({ kind: "home" });
    expect(resolveWhereSuggestion({ where: { whereKind: null, placeRef: null }, labels: labels(Array(6).fill("home"), "2026-08-23"), dismissal: null, markedPlaces: marked, today, rules: WHERE_SUGGESTION_RULES_V1 }))
      .toBeNull();
  });

  it("suggests the place with 80% or more", () => {
    expect(suggest(["home", "home", "home", "home", "elsewhere"].concat(["home"]) as CompletionPlaceLabel["label"][]))
      .toEqual({ ruleVersion: "where-suggestion-rules@1", kind: "home", key: "home", placeKey: null, labelCount: 6, supportingCount: 5 });
    expect(suggest([GYM_REF, GYM_REF, GYM_REF, GYM_REF, GYM_REF]
      .concat([GYM_REF]) as CompletionPlaceLabel["label"][])).toMatchObject({ kind: "saved_place", key: GYM_REF, placeKey: GYM_REF.slice(12) });
    expect(suggest(["elsewhere", "elsewhere", "elsewhere", "elsewhere", "elsewhere", "home"])).toMatchObject({ kind: "add_place", supportingCount: 5 });
  });

  it("suggests Anywhere for two or more labels at 25% each", () => {
    expect(suggest(["home", "home", "home", GYM_REF, GYM_REF, GYM_REF])).toMatchObject({ kind: "anywhere", supportingCount: 6 });
    expect(suggest(["home", "home", "home", "home", "elsewhere", GYM_REF, "elsewhere", "home"])).toMatchObject({ kind: "anywhere" });
    expect(suggest(["home", "home", "home", "home", "home", "home", "home", GYM_REF, "elsewhere", "elsewhere"])).toBeNull();
  });

  it("stays quiet when Where already agrees", () => {
    const homeLabels: CompletionPlaceLabel["label"][] = Array(6).fill("home");
    expect(suggest(homeLabels, { whereKind: "home", placeRef: "home" })).toBeNull();
    expect(suggest(homeLabels, { whereKind: "anywhere", placeRef: null })).toMatchObject({ kind: "home" });
    expect(suggest(Array(6).fill("elsewhere"), { whereKind: "anywhere", placeRef: null })).toBeNull();
    expect(suggest(Array(6).fill(GYM_REF), { whereKind: "place", placeRef: GYM_REF })).toBeNull();
    expect(suggest(Array(6).fill(GYM_REF), { whereKind: "home", placeRef: "home" })).toMatchObject({ kind: "saved_place" });
  });

  it("waits for a marker on the Behavior's own place and never names an unmarked place", () => {
    expect(suggest(Array(6).fill("elsewhere"), { whereKind: "home", placeRef: "home" }, { markedPlaces: new Set([GYM_REF]) })).toBeNull();
    expect(suggest(Array(6).fill(GYM_REF), { whereKind: null, placeRef: null }, { markedPlaces: new Set(["home"]) })).toBeNull();
  });

  it("returns a dismissed suggestion only after six newer labels", () => {
    const dismissal = { dismissedAt: "2026-10-21T00:00:00Z" };
    const old = labels(Array(6).fill("home"), "2026-10-20", "2026-10-20T12:00:00Z");
    const newer = labels(Array(5).fill("home"), "2026-10-21", "2026-10-21T12:00:00Z");
    const base = { where: { whereKind: null, placeRef: null }, dismissal, markedPlaces: marked, today, rules: WHERE_SUGGESTION_RULES_V1 } as const;
    expect(resolveWhereSuggestion({ ...base, labels: [...old, ...newer] })).toBeNull();
    expect(resolveWhereSuggestion({ ...base, labels: [...old, ...newer, ...labels(["home"], "2026-10-22", "2026-10-22T12:00:00Z")] })).toMatchObject({ kind: "home" });
  });
});

describe("resolvePlaceLabelState", () => {
  const settings: PlaceLabelSettings = { enabled: true, retention: "90_days", enabledAt: "2026-10-01T00:00:00Z", markerPromptDismissedAt: null, updatedAt: "2026-10-01T00:00:00Z" };
  const behaviors = [
    { id: "b1", active: true, whereKind: "home" as const, locationText: null },
    { id: "b2", active: true, whereKind: "home" as const, locationText: null },
    { id: "b3", active: true, whereKind: "place" as const, locationText: "1 Gym Street" },
    { id: "b4", active: false, whereKind: "place" as const, locationText: "2 Pool Road" },
  ];
  const today = Temporal.PlainDate.from("2026-10-22");

  it("prompts once per unmarked place and never for archived Behaviors", () => {
    const state = resolvePlaceLabelState({ settings, homeText: "1 Home Lane", markers: [], labels: [], dismissals: [], behaviors, today });
    expect(state.behaviors.map(({ markerPrompt }) => markerPrompt)).toEqual(["home", null, GYM_REF, null]);
    expect(state.homeMarker).toBeNull();
  });

  it("stops prompting after Not now and treats a moved Home as unmarked", () => {
    const markers = [{ ref: "home" as PlaceRef, placeKey: travelPlaceKey("Old home"), recordedAt: "2026-10-01T00:00:00Z" }];
    const state = resolvePlaceLabelState({ settings, homeText: "1 Home Lane", markers, labels: [], dismissals: [], behaviors, today });
    expect(state.homeMarker).toEqual({ recordedAt: "2026-10-01T00:00:00Z", current: false });
    expect(state.behaviors[0]!.markerPrompt).toBe("home");
    const quiet = resolvePlaceLabelState({ settings: { ...settings, markerPromptDismissedAt: "2026-10-02T00:00:00Z" }, homeText: "1 Home Lane", markers, labels: [], dismissals: [], behaviors, today });
    expect(quiet.behaviors.every(({ markerPrompt }) => markerPrompt === null)).toBe(true);
  });

  it("shows nothing while labels are off", () => {
    const state = resolvePlaceLabelState({ settings: { ...settings, enabled: false }, homeText: "1 Home Lane", markers: [], labels: [], dismissals: [], behaviors, today });
    expect(state.behaviors.every(({ suggestion, markerPrompt }) => suggestion === null && markerPrompt === null)).toBe(true);
  });

  it("names suggestions with their rule version", () => {
    const markers = [{ ref: GYM_REF, placeKey: GYM_REF.slice(12), recordedAt: "2026-10-01T00:00:00Z" }];
    const labels = Array.from({ length: 6 }, (_, index) => ({ occurrenceId: `o${index}`, behaviorId: "b1", localDate: "2026-10-20", label: GYM_REF, ruleVersion: "place-label-rules@1", recordedAt: "2026-10-20T12:00:00Z" }));
    const behaviorsWithGym = [{ id: "b1", active: true, whereKind: null, locationText: null }, { id: "b2", active: true, whereKind: "place" as const, locationText: " 1 Gym Street" }];
    const state = resolvePlaceLabelState({ settings, homeText: null, markers, labels, dismissals: [], behaviors: behaviorsWithGym, today });
    expect(state.behaviors[0]!.suggestion).toMatchObject({ kind: "saved_place", ruleVersion: "where-suggestion-rules@1" });
    expect(state.behaviors[0]!.suggestedPlaceText).toBe("1 Gym Street");
    // Without a Behavior that names the place, Cadence cannot suggest it.
    expect(resolvePlaceLabelState({ settings, homeText: null, markers, labels, dismissals: [], behaviors: [behaviorsWithGym[0]!], today }).behaviors[0]!.suggestion).toBeNull();
    expect(state.placeMarkers).toEqual([{ placeKey: GYM_REF.slice(12), recordedAt: "2026-10-01T00:00:00Z" }]);
  });
});

describe("projectPlaceLabelCounts", () => {
  it("returns counts without place keys or positions", () => {
    const labels = [
      { behaviorId: "b1", label: "home" as const, localDate: "2026-10-20" },
      { behaviorId: "b1", label: GYM_REF, localDate: "2026-10-20" },
      { behaviorId: "b1", label: savedPlaceRef(travelPlaceKey("Pool")), localDate: "2026-10-21" },
      { behaviorId: "b1", label: "elsewhere" as const, localDate: "2026-10-21" },
      { behaviorId: "b1", label: "home" as const, localDate: "2026-06-01" },
    ];
    const [projection] = projectPlaceLabelCounts({ labels, behaviors: [{ id: "b1", whereKind: "place", locationText: "1 Gym Street" }], today: Temporal.PlainDate.from("2026-10-22") });
    expect(projection).toEqual({ behaviorId: "b1", periodDays: 60, total: 4, atHome: 1, atWherePlace: 1, atOtherSavedPlace: 1, elsewhere: 1 });
    expect(JSON.stringify(projection)).not.toContain("saved_place");
  });
});

// Ticket 358 (D33): a guessed Where shares the one Where suggestion line.
describe("resolveWhereGuessSuggestion", () => {
  const rules = CURRENT_WHERE_SUGGESTION_RULES;
  it("maps a guess to the suggestion keys the dismissal already stores", () => {
    expect(resolveWhereGuessSuggestion({ whereKind: null, guess: "home", dismissal: null, rules }))
      .toEqual({ ruleVersion: rules.version, kind: "home", key: "home", placeKey: null, labelCount: 0, supportingCount: 0, basis: "guess" });
    expect(resolveWhereGuessSuggestion({ whereKind: null, guess: "anywhere", dismissal: null, rules })?.key).toBe("anywhere");
    expect(resolveWhereGuessSuggestion({ whereKind: null, guess: "elsewhere", dismissal: null, rules })?.key).toBe("add_place");
  });

  it("shows nothing once Where is set, for unknown, or after the same suggestion was dismissed", () => {
    expect(resolveWhereGuessSuggestion({ whereKind: "home", guess: "anywhere", dismissal: null, rules })).toBeNull();
    expect(resolveWhereGuessSuggestion({ whereKind: null, guess: "unknown", dismissal: null, rules })).toBeNull();
    expect(resolveWhereGuessSuggestion({ whereKind: null, guess: null, dismissal: null, rules })).toBeNull();
    expect(resolveWhereGuessSuggestion({ whereKind: null, guess: "home", dismissal: { suggestion: "home" }, rules })).toBeNull();
    expect(resolveWhereGuessSuggestion({ whereKind: null, guess: "home", dismissal: { suggestion: "anywhere" }, rules })?.key).toBe("home");
  });

  it("joins the place label state only when guesses are passed, and a label suggestion comes first", () => {
    const settings: PlaceLabelSettings = { enabled: true, retention: "90_days", enabledAt: "2026-10-01T00:00:00Z", markerPromptDismissedAt: null, updatedAt: "2026-10-01T00:00:00Z" };
    const behaviors = [{ id: "b1", active: true, whereKind: null, locationText: null }, { id: "b2", active: false, whereKind: null, locationText: null }];
    const today = Temporal.PlainDate.from("2026-10-22");
    const input = { settings, homeText: "1 Home Lane", markers: [], labels: [], dismissals: [], behaviors, today };
    expect(resolvePlaceLabelState(input).behaviors.map(({ suggestion }) => suggestion)).toEqual([null, null]);
    const guessed = resolvePlaceLabelState({ ...input, whereGuesses: new Map([["b1", "home"], ["b2", "home"]]) });
    expect(guessed.behaviors.map(({ suggestion }) => suggestion?.basis ?? null)).toEqual(["guess", null]);
  });
});

// Ticket 383 (D37): the guessed Where shows whether or not Completion places is on.
describe("guessed Where without Completion places", () => {
  const rules = CURRENT_WHERE_SUGGESTION_RULES;
  const on: PlaceLabelSettings = { enabled: true, retention: "90_days", enabledAt: "2026-10-01T00:00:00Z", markerPromptDismissedAt: null, updatedAt: "2026-10-01T00:00:00Z" };
  const off: PlaceLabelSettings = { ...on, enabled: false, enabledAt: null };
  const behaviors = [
    { id: "b1", active: true, whereKind: null, locationText: null },
    { id: "b2", active: false, whereKind: null, locationText: null },
    { id: "b3", active: true, whereKind: "home" as const, locationText: null },
    { id: "b4", active: true, whereKind: null, locationText: null },
  ];
  const today = Temporal.PlainDate.from("2026-10-22");
  const markers = [{ ref: "home" as PlaceRef, placeKey: travelPlaceKey("1 Home Lane"), recordedAt: "2026-10-01T00:00:00Z" }];
  const labels = Array.from({ length: 6 }, (_, index) => ({ occurrenceId: `o${index}`, behaviorId: "b4", localDate: "2026-10-20", label: "home" as const, ruleVersion: "place-label-rules@1", recordedAt: "2026-10-20T12:00:00Z" }));
  const guesses = new Map([["b1", "home"], ["b2", "home"], ["b3", "anywhere"], ["b4", "anywhere"]]);
  const input = { homeText: "1 Home Lane", markers, labels, dismissals: [], behaviors, today };

  it("shows only the guess while labels are off, and hides markers, prompts and counts", () => {
    const state = resolvePlaceLabelState({ ...input, settings: off, whereGuesses: guesses });
    expect(state.behaviors.map(({ suggestion }) => suggestion ? `${suggestion.basis}:${suggestion.key}` : null))
      .toEqual(["guess:home", null, null, "guess:anywhere"]);
    expect(state.behaviors.every(({ markerPrompt, suggestedPlaceText }) => markerPrompt === null && suggestedPlaceText === null)).toBe(true);
    expect({ homeMarker: state.homeMarker, placeMarkers: state.placeMarkers, labelCount: state.labelCount })
      .toEqual({ homeMarker: null, placeMarkers: [], labelCount: 0 });
  });

  it("shows the same guess while labels are on, where a counted suggestion still comes first", () => {
    const state = resolvePlaceLabelState({ ...input, settings: on, whereGuesses: guesses });
    expect(state.behaviors[0]!.suggestion).toMatchObject({ basis: "guess", key: "home" });
    expect(state.behaviors[3]!.suggestion).toMatchObject({ kind: "home", supportingCount: 6 });
    expect(state.behaviors[3]!.suggestion?.basis).toBeUndefined();
    expect(state.labelCount).toBe(6);
  });

  it("shows nothing without guesses (CADENCE_ALONGSIDE off), as before", () => {
    const state = resolvePlaceLabelState({ ...input, settings: off });
    expect(state.behaviors.every(({ suggestion, markerPrompt }) => suggestion === null && markerPrompt === null)).toBe(true);
  });

  it("hides a dismissed guess while labels are off", () => {
    const dismissals = [{ behaviorId: "b1", suggestion: "home" as const, ruleVersion: rules.version, dismissedAt: "2026-10-21T00:00:00Z" }];
    const state = resolvePlaceLabelState({ ...input, settings: off, dismissals, whereGuesses: guesses });
    expect(state.behaviors[0]!.suggestion).toBeNull();
    expect(state.behaviors[3]!.suggestion?.key).toBe("anywhere");
  });

  it("lets a dismissal through while off only for the guess the line shows", () => {
    expect(WHERE_GUESS_DISMISSAL_KEYS).toEqual(["home", "anywhere", "add_place"]);
    const state = resolvePlaceLabelState({ ...input, settings: off, whereGuesses: guesses });
    expect(shownWhereGuessKey(state, "b1")).toBe("home");
    expect(shownWhereGuessKey(state, "b3")).toBeNull();
    expect(whereSuggestionDismissible({ settingsEnabled: false, suggestion: "home", shownGuess: "home" })).toBe(true);
    expect(whereSuggestionDismissible({ settingsEnabled: false, suggestion: "anywhere", shownGuess: "home" })).toBe(false);
    expect(whereSuggestionDismissible({ settingsEnabled: false, suggestion: "home", shownGuess: null })).toBe(false);
    expect(whereSuggestionDismissible({ settingsEnabled: false, suggestion: savedPlaceRef(travelPlaceKey("Gym")), shownGuess: savedPlaceRef(travelPlaceKey("Gym")) })).toBe(false);
    expect(whereSuggestionDismissible({ settingsEnabled: true, suggestion: savedPlaceRef(travelPlaceKey("Gym")), shownGuess: null })).toBe(true);
  });
});
