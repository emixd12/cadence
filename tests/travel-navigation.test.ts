import { describe, expect, it } from "vitest";
import { buildTravelNavigationLink, travelDestinationResolved, travelDestinationRoute } from "@cadence/core/services/travel-navigation";
import type { TravelResolvedLegEvidence } from "@cadence/core/types/travel";
import { validateForegroundLocation } from "@/lib/ui/foreground-location";
import { Temporal } from "@js-temporal/polyfill";
import { resolvePersistedTimelineOccurrence } from "@cadence/core/services/timeline.service";
import type { OccurrenceRecord } from "@cadence/core/data-store";
import { storedBehavior, USER_ID } from "./helpers/export-row-fixture";

describe("travel navigation and device boundary", () => {
  it("encodes hostile source text as search data, never a destination URL", () => {
    const link = buildTravelNavigationLink({ locationText: "javascript:alert(1)&api=evil" })!;
    const url = new URL(link.href);
    expect(url.origin).toBe("https://www.google.com");
    expect(url.searchParams.get("query")).toBe("javascript:alert(1)&api=evil");
    expect(link.label).toBe("Search in Google Maps");
    expect(buildTravelNavigationLink({ locationText: "\n" })).toBeNull();
  });
  it("maps all supported Google modes and discloses Apple cycling limits", () => {
    for (const mode of ["walking", "cycling", "transit", "driving"] as const) {
      const link = buildTravelNavigationLink({ locationText: "Source address", mode, resolved: true })!;
      expect(new URL(link.href).searchParams.get("travelmode")).toBe(mode === "cycling" ? "bicycling" : mode);
    }
    expect(buildTravelNavigationLink({ locationText: "Source address", preference: "apple_maps", mode: "cycling", resolved: true })?.modeNotice).toContain("Choose cycling");
  });
  it("rejects stale, coarse, invalid and future samples without retaining coordinates", () => {
    const sample = { state: "available", latitude: 10, longitude: 20, accuracyMeters: 20, sampledAt: 1000 };
    expect(validateForegroundLocation(sample, 1000)).toEqual(sample);
    expect(validateForegroundLocation(sample, 61001)).toEqual({ state: "stale" });
    expect(validateForegroundLocation({ ...sample, accuracyMeters: 101 }, 1000)).toEqual({ state: "inaccurate" });
    expect(validateForegroundLocation({ ...sample, latitude: NaN }, 1000)).toEqual({ state: "unavailable" });
    expect(validateForegroundLocation(sample, 999)).toEqual({ state: "unavailable" });
  });
});

describe("Directions needs a resolved place, not a current estimate (Ticket 271, correction C2)", () => {
  const estimate = { durationSeconds: 600, departureAt: "2026-11-01T05:10:00Z", arrivalAt: "2026-11-01T05:20:00Z", warnings: [], fallback: false,
    attribution: "Google Maps", observedAt: "2026-11-01T04:00:00Z", expiresAt: "2026-11-01T04:05:00Z" };
  const leg = (state: TravelResolvedLegEvidence["state"], options: Readonly<{ ref?: string; source?: "calendar" | "behavior" | "correction"; estimate?: boolean }> = {}): TravelResolvedLegEvidence => ({
    state, reason: null, estimate: options.estimate === false ? null : estimate,
    leg: { id: "leg", role: "outbound", journeyRef: "day", originCommitmentRef: null, destinationCommitmentRef: options.ref ?? "stop", mode: "walking", readyAt: "2026-11-01T04:00:00Z",
      provenance: { originRef: "base", originSource: "saved_base", originRevision: "1", destinationRef: options.ref ?? "stop", destinationSource: options.source ?? "calendar", destinationRevision: "1", grantRevision: "g" } },
  });
  const resolved = (legs: TravelResolvedLegEvidence[], source: "calendar" | "behavior" = "calendar") => travelDestinationResolved({ legs }, "stop", source);

  it("counts a routed place whose estimate has expired", () => {
    expect(resolved([leg("current")])).toBe(true);
    expect(resolved([leg("stale")])).toBe(true);
  });
  it("does not count a missing, failed or withdrawn route, another stop or another source", () => {
    expect(travelDestinationResolved(null, "stop", "calendar")).toBe(false);
    expect(resolved([leg("unavailable", { estimate: false })])).toBe(false);
    expect(resolved([leg("stale", { estimate: false })])).toBe(false);
    expect(resolved([leg("rejected_revision")])).toBe(false);
    expect(resolved([leg("current", { ref: "other" })])).toBe(false);
    expect(resolved([leg("current", { source: "correction" })])).toBe(false);
    expect(resolved([leg("current")], "behavior")).toBe(false);
    expect(resolved([leg("current", { source: "behavior" })], "behavior")).toBe(true);
  });
  it("Ticket 284 finding: once the stop is under way, the trip home from its place keeps Directions", () => {
    const home = (source: "calendar" | "behavior" | "correction", state: TravelResolvedLegEvidence["state"] = "current", withEstimate = true): TravelResolvedLegEvidence => ({
      state, reason: null, estimate: withEstimate ? estimate : null,
      leg: { id: "home", role: "return", journeyRef: "day", originCommitmentRef: "stop", destinationCommitmentRef: null, mode: "transit", readyAt: "2026-11-01T05:00:00Z",
        provenance: { originRef: "stop", originSource: source, originRevision: "1", destinationRef: "base", destinationSource: "saved_base", destinationRevision: "1", grantRevision: "g" } },
    });
    expect(travelDestinationRoute({ legs: [home("calendar")] }, "stop", "calendar")).toEqual({ mode: "transit" });
    expect(resolved([home("calendar", "stale")])).toBe(true);
    expect(resolved([home("behavior")], "behavior")).toBe(true);
    // A corrected place, another source or a trip with no route does not count.
    expect(resolved([home("correction")])).toBe(false);
    expect(resolved([home("behavior")])).toBe(false);
    expect(resolved([home("calendar", "unavailable", false)])).toBe(false);
    // The trip that reached the place still gives its own mode.
    expect(travelDestinationRoute({ legs: [home("calendar"), leg("current")] }, "stop", "calendar")).toEqual({ mode: "walking" });
  });
  it("gives the mode the place was routed in, which may be remembered for that place", () => {
    const transit = { ...leg("current"), leg: { ...leg("current").leg, mode: "transit" as const } };
    expect(travelDestinationRoute({ legs: [transit] }, "stop", "calendar")).toEqual({ mode: "transit" });
    expect(travelDestinationRoute({ legs: [leg("unavailable", { estimate: false })] }, "stop", "calendar")).toBeNull();
  });
});

describe("a located Behavior row carries only its own place text (Ticket 271)", () => {
  const occurrence = (behaviorId: string): OccurrenceRecord => ({
    id: "33333333-3333-4333-8333-333333333333", user_id: USER_ID, behavior_id: behaviorId, behavior_configuration_event_id: null,
    behavior_schedule_slot_id: null, scheduled_for: "2026-08-30T13:00:00Z", local_date: "2026-08-30", schedule_kind: "exact", schedule_preset: null,
    schedule_start_time: "09:00", schedule_end_time: null, schedule_range_identity: null, status: "unresolved", completed_at: null, status_marked_at: null,
    note: "", created_at: "2026-08-30T12:00:00Z", updated_at: "2026-08-30T12:00:00Z" });
  const placeText = (where: Readonly<{ where_kind?: string | null; location_text?: string | null }>) => {
    const behavior = { ...storedBehavior(), ...where };
    return resolvePersistedTimelineOccurrence({ behavior, occurrence: occurrence(behavior.id), timeSessions: [],
      now: Temporal.Instant.from("2026-08-30T12:00:00Z"), timezone: "America/New_York" })!.placeText;
  };

  it("sets it for A place and leaves it out otherwise", () => {
    expect(placeText({ where_kind: "place", location_text: "  Riverside track " })).toBe("Riverside track");
    expect(placeText({ where_kind: "home", location_text: null })).toBeUndefined();
    expect(placeText({ where_kind: "anywhere", location_text: null })).toBeUndefined();
    expect(placeText({ where_kind: null, location_text: null })).toBeUndefined();
    expect(placeText({ where_kind: "nowhere", location_text: "x" })).toBeUndefined();
  });

  it("carries Home or A place as the row's Where kind, for the travel source key", () => {
    const whereKind = (where: Readonly<{ where_kind?: string | null; location_text?: string | null }>) => {
      const behavior = { ...storedBehavior(), ...where };
      return resolvePersistedTimelineOccurrence({ behavior, occurrence: occurrence(behavior.id), timeSessions: [],
        now: Temporal.Instant.from("2026-08-30T12:00:00Z"), timezone: "America/New_York" })!.whereKind;
    };
    expect(whereKind({ where_kind: "place", location_text: "Riverside track" })).toBe("place");
    expect(whereKind({ where_kind: "home", location_text: null })).toBe("home");
    expect(whereKind({ where_kind: "anywhere", location_text: null })).toBeUndefined();
    expect(whereKind({ where_kind: null, location_text: null })).toBeUndefined();
  });
});
