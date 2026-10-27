import { Temporal } from "@js-temporal/polyfill";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PlaceLabelError,
  buildPlaceLabelState,
  parseCompletionLabelInput,
  parsePlaceMarkerInput,
  parseWhereSuggestionDismissInput,
  placeLabelSettingsFromRecord,
  planCompletionCapture,
  planCompletionLabel,
  planPlaceLabelSettingsSave,
  planPlaceMarker,
  planWhereSuggestionDismissal,
} from "@cadence/core/services/place-labels";
import { savedPlaceRef } from "@cadence/core/resolvers/place-label.resolver";
import { travelPlaceKey } from "@cadence/core/services/travel-place-key";
import type { PlaceLabelSettingsRecord, PlaceMarkerRecord } from "@cadence/core/types/place-labels";

vi.mock("@/lib/supabase/admin", () => ({ createServiceRoleClient: () => ({ rpc: vi.fn(async () => ({ data: 3, error: null })) }) }));

const enabledRecord: PlaceLabelSettingsRecord = { enabled: true, retention: "90_days", enabled_at: "2026-10-01T00:00:00Z",
  marker_prompt_dismissed_at: null, updated_at: "2026-10-01T00:00:00.000000Z" };
const settings = placeLabelSettingsFromRecord(enabledRecord);
const homeMarker: PlaceMarkerRecord = { id: "home", place_key: travelPlaceKey("1 Home Lane"), latitude_e6: 41_878_100,
  longitude_e6: -87_629_800, accuracy_meters: 20, rule_version: "place-label-rules@1", recorded_at: "2026-10-01T00:00:00Z" };
const occurrence = { id: "occurrence-1", behaviorId: "behavior-1", status: "completed", localDate: "2026-10-22", timezone: "America/New_York",
  scheduledFor: "2026-10-22T13:00:00Z", scheduleKind: "exact", scheduleStartTime: "09:00:00", scheduleEndTime: null };
const mark = { status: "completed", previousStatus: "unresolved", sourceCaptureMethod: "manual_tap", recordedAt: "2026-10-22T13:05:00Z" };
const now = Temporal.Instant.from("2026-10-22T13:05:30Z");

afterEach(() => { vi.restoreAllMocks(); });

describe("settings", () => {
  it("defaults to off with the shortest retention", () => {
    expect(placeLabelSettingsFromRecord(null)).toEqual({ enabled: false, retention: "90_days", enabledAt: null, markerPromptDismissedAt: null, updatedAt: null });
  });

  it("returns the retention cutoff for the same save and rejects a stale token", () => {
    const input = { enabled: true, retention: "90_days" as const, markerPromptDismissed: false, expectedUpdatedAt: "2026-10-01T00:00:00Z" };
    expect(planPlaceLabelSettingsSave(settings, input, Temporal.PlainDate.from("2026-10-22"))).toEqual({ retentionCutoff: "2026-07-24" });
    expect(planPlaceLabelSettingsSave(settings, { ...input, retention: "until_deleted" }, Temporal.PlainDate.from("2026-10-22"))).toEqual({ retentionCutoff: null });
    expect(() => planPlaceLabelSettingsSave(settings, { ...input, expectedUpdatedAt: null }, Temporal.PlainDate.from("2026-10-22"))).toThrow(PlaceLabelError);
  });
});

describe("markers", () => {
  const position = { latitudeE6: 41_878_100, longitudeE6: -87_629_800, accuracyMeters: 20 };

  it("records Home with the Home text's place key and a saved place by its own key", () => {
    expect(planPlaceMarker({ settings, homeText: "1 Home Lane", recordedAt: "2026-10-22T13:00:00Z",
      marker: { place: { kind: "home" }, position, sampleAgeSeconds: 3 } }))
      .toEqual({ id: "home", place_key: travelPlaceKey("1 Home Lane"), latitude_e6: 41_878_100, longitude_e6: -87_629_800,
        accuracy_meters: 20, rule_version: "place-label-rules@1", recorded_at: "2026-10-22T13:00:00Z" });
    expect(planPlaceMarker({ settings, homeText: null, recordedAt: "2026-10-22T13:00:00Z",
      marker: { place: { kind: "saved_place", text: " 1 Gym Street " }, position, sampleAgeSeconds: 3 } }).id)
      .toBe(savedPlaceRef(travelPlaceKey("1 Gym Street")));
  });

  it("refuses markers while off, without Home, or from an old or inaccurate sample", () => {
    const marker = { place: { kind: "home" as const }, position, sampleAgeSeconds: 3 };
    expect(() => planPlaceMarker({ settings: placeLabelSettingsFromRecord(null), homeText: "1 Home Lane", recordedAt: "2026-10-22T13:00:00Z", marker })).toThrow(/Turn on/);
    expect(() => planPlaceMarker({ settings, homeText: null, recordedAt: "2026-10-22T13:00:00Z", marker })).toThrow(/Save Home/);
    expect(() => planPlaceMarker({ settings, homeText: "1 Home Lane", recordedAt: "2026-10-22T13:00:00Z", marker: { ...marker, sampleAgeSeconds: 121 } })).toThrow(/too old/);
    expect(() => parsePlaceMarkerInput({ ...marker, position: { ...position, accuracyMeters: 101 } })).toThrow(PlaceLabelError);
    expect(() => parsePlaceMarkerInput({ ...marker, position: { ...position, latitude: 41.8 } })).toThrow(PlaceLabelError);
  });
});

describe("completion capture", () => {
  const context = { settings, homeText: "1 Home Lane", markers: [homeMarker], occurrence, latestMark: mark, now };

  it("returns only the user's markers for a qualifying completion", () => {
    expect(planCompletionCapture(context)).toEqual({ ruleVersion: "place-label-rules@1",
      markers: [{ ref: "home", latitudeE6: 41_878_100, longitudeE6: -87_629_800, accuracyMeters: 20 }] });
    expect(planCompletionCapture({ ...context, latestMark: { ...mark, previousStatus: "not_completed" } })).toBeNull();
    expect(planCompletionCapture({ ...context, homeText: "2 New Home" })).toBeNull();
    expect(planCompletionCapture({ ...context, settings: placeLabelSettingsFromRecord(null) })).toBeNull();
  });

  it("stores a label, never a position, and only for a current marker or elsewhere", () => {
    const label = parseCompletionLabelInput({ occurrenceId: "occurrence-1", label: "home", ruleVersion: "place-label-rules@1" });
    const row = planCompletionLabel({ ...context, label });
    expect(row).toEqual({ id: "occurrence-1", behavior_id: "behavior-1", local_date: "2026-10-22", label: "home",
      rule_version: "place-label-rules@1", recorded_at: "2026-10-22T13:05:30Z" });
    expect(Object.keys(row).some((key) => /lat|lon|accuracy/.test(key))).toBe(false);
    expect(() => planCompletionLabel({ ...context, label: { ...label, label: savedPlaceRef(travelPlaceKey("Gym")) } })).toThrow(/current marker/);
    expect(() => planCompletionLabel({ ...context, label: { ...label, ruleVersion: "place-label-rules@2" } })).toThrow(PlaceLabelError);
    expect(() => planCompletionLabel({ ...context, now: now.add({ minutes: 3 }), label })).toThrow(/cannot be labeled/);
    expect(() => parseCompletionLabelInput({ occurrenceId: "occurrence-1", label: "home", ruleVersion: "place-label-rules@1", latitude: 1 })).toThrow(PlaceLabelError);
  });
});

describe("dismissals and state", () => {
  it("records the rule version that produced a dismissed suggestion", () => {
    const dismissal = parseWhereSuggestionDismissInput({ behaviorId: "behavior-1", suggestion: "anywhere", ruleVersion: "where-suggestion-rules@1" });
    expect(planWhereSuggestionDismissal({ settings, dismissal, dismissedAt: "2026-10-22T13:00:00Z" }))
      .toEqual({ id: "behavior-1", suggestion: "anywhere", rule_version: "where-suggestion-rules@1", dismissed_at: "2026-10-22T13:00:00Z" });
    expect(() => parseWhereSuggestionDismissInput({ behaviorId: "behavior-1", suggestion: "anywhere", ruleVersion: "where-suggestion-rules@9" })).toThrow(PlaceLabelError);
  });

  it("builds coordinate-free state from stored rows", () => {
    const state = buildPlaceLabelState({ settings: enabledRecord, homeText: "1 Home Lane", markers: [homeMarker], labels: [], dismissals: [],
      behaviors: [{ id: "behavior-1", active: true, where_kind: "home", location_text: null }], today: Temporal.PlainDate.from("2026-10-22") });
    expect(state.homeMarker).toEqual({ recordedAt: "2026-10-01T00:00:00Z", current: true });
    expect(JSON.stringify(state)).not.toMatch(/41878100|latitude/);
  });
});

describe("daily maintenance", () => {
  it("purges expired labels through the service role and reports only a count", async () => {
    const monitoring = await import("@/lib/monitoring/privacy-safe-events");
    const report = vi.spyOn(monitoring, "reportMonitoringEvent").mockImplementation(() => undefined);
    const { runPlaceLabelMaintenance } = await import("@/lib/services/place-labels.service");
    await runPlaceLabelMaintenance();
    expect(report).toHaveBeenCalledWith({ name: "place_label_maintenance_completed", context: { labels_deleted: 3 } });
  });
});
