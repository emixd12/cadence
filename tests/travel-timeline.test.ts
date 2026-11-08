import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";
import { resolveDayProgressLayout } from "@cadence/core/resolvers/day-progress.resolver";
import { resolveTimelineOccurrenceContext } from "@cadence/core/resolvers/timeline-context.resolver";
import { mergeTravelLastEstimates, resolveTravelAfterDecisions, resolveTravelEvidence, resolveTravelPlan, travelUnreliableSegments } from "@cadence/core/resolvers/travel.resolver";
import { resolveDepartureModel } from "@cadence/core/resolvers/departure.resolver";
import type { TravelEvidenceResult, TravelOccupiedSegment } from "@cadence/core/types/travel";
import type { DepartureModel, DepartureTrip } from "@cadence/core/types/departure";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TravelStatusLine } from "@/components/timeline/DayProgressTimeline";
import { DevelopmentBuildProvider } from "@cadence/ui/runtime";
import { TRAVEL_CLEARANCE_MESSAGE, travelSourceKey, travelStopRevisions, travelTomorrowStopKey, type TravelRoutesView, type TravelState } from "@/lib/ui/travel";

const segments: TravelOccupiedSegment[] = [
  { id: "out", kind: "route", startAt: "2026-09-21T13:30:00Z", endAt: "2026-09-21T14:30:00Z", sourceRefs: ["event"], legId: "out" },
  { id: "return", kind: "route", startAt: "2026-09-21T16:30:00Z", endAt: "2026-09-21T18:30:00Z", sourceRefs: ["event"], legId: "return" },
];
const travel: TravelEvidenceResult = { version: "1.0", journeyRef: "day", segments, occupiedSpans: [], legs: [], collisions: [], completeTrip: false, finalAvailabilityAt: null, modelProjection: null };

describe("shared Timeline travel occupancy", () => {
  it("maps separate known spans without filling free gaps", () => {
    const day = resolveDayProgressLayout({ timezone: "UTC", days: [{ localDate: "2026-09-21", top: 0, bottom: 1440, rows: [] }], travelSegments: segments }).days[0]!;
    expect(day.travelSpans.map((span) => [span.startPosition, span.endPosition])).toEqual([[810, 870], [990, 1110]]);
    expect(day.timedEventSpans).toEqual([]);
  });
  it("keeps outbound collisions with no known return, uses half-open boundaries, and never asserts free time", () => {
    const resolve = (scheduledFor: string) => resolveTimelineOccurrenceContext({ occurrenceId: "behavior", scheduledFor,
      runningStartedAt: null, estimate: { kind: "known", seconds: 900, durationLabel: "15 minutes", sampleCount: 0, lookbackDays: 90, provenance: "behavior_default" },
      events: [], freshness: { state: "current", refreshedAt: "2026-09-21T12:00:00Z", label: "Calendar current", canAssertNoOverlap: true },
      now: Temporal.Instant.from("2026-09-21T12:00:00Z"), travel: { ...travel, unknownLegs: [{ role: "return", originCommitmentRef: "event", destinationCommitmentRef: null, reason: "timing_unknown" }] } });
    expect(resolve("2026-09-21T13:45:00Z")).toMatchObject({ overlappingEventIds: ["event"] });
    expect(resolve("2026-09-21T18:30:00Z")).toMatchObject({ overlappingEventIds: [], overlapAssessment: "unknown", overlapLabel: "Return time unknown." });
  });
  it("follows the departure model's trip home, so the row agrees with the drawer (Ticket 266)", () => {
    // Raw legs alone would say the return is unknown: its leg has no estimate yet.
    const legs = [{ leg: { id: "return", role: "return" }, state: "unavailable", estimate: null }] as never;
    const resolve = (trips: { role: "outbound" | "onward" | "return"; state: string }[]) => resolveTimelineOccurrenceContext({ occurrenceId: "behavior",
      scheduledFor: "2026-09-21T18:30:00Z", runningStartedAt: null,
      estimate: { kind: "unknown", reason: "insufficient_samples", sampleCount: 0, requiredSampleCount: 3, lookbackDays: 90 },
      events: [], freshness: { state: "current", refreshedAt: "2026-09-21T12:00:00Z", label: "Calendar current", canAssertNoOverlap: true },
      now: Temporal.Instant.from("2026-09-21T12:00:00Z"), travel: { ...travel, segments: [], legs },
      departure: { trips: trips as never } }).overlapLabel;
    // Waiting for its estimate, including once it is ready to check.
    expect(resolve([{ role: "outbound", state: "upcoming" }, { role: "return", state: "appears_later" }])).not.toBe("Return time unknown.");
    // A known time.
    expect(resolve([{ role: "return", state: "head_home" }])).not.toBe("Return time unknown.");
    expect(resolve([{ role: "return", state: "upcoming" }])).not.toBe("Return time unknown.");
    // The day's trips are over.
    expect(resolve([])).not.toBe("Return time unknown.");
    // No time and none coming.
    expect(resolve([{ role: "return", state: "time_unknown" }])).toBe("Return time unknown.");
    expect(resolve([{ role: "return", state: "needs_origin" }])).toBe("Return time unknown.");
    expect(resolve([{ role: "outbound", state: "needs_place" }])).toBe("Return time unknown.");
  });
  it("says nothing about the trip home on a day with no trips (Ticket 266)", () => {
    const resolve = (extra: Partial<TravelEvidenceResult>) => resolveTimelineOccurrenceContext({ occurrenceId: "behavior", scheduledFor: "2026-09-21T18:30:00Z",
      runningStartedAt: null, estimate: { kind: "unknown", reason: "insufficient_samples", sampleCount: 0, requiredSampleCount: 3, lookbackDays: 90 },
      events: [], freshness: { state: "current", refreshedAt: "2026-09-21T12:00:00Z", label: "Calendar current", canAssertNoOverlap: true },
      now: Temporal.Instant.from("2026-09-21T12:00:00Z"), travel: { ...travel, segments: [], ...extra } }).overlapLabel;
    expect(resolve({ legs: [], unknownLegs: [] })).not.toBe("Return time unknown.");
    expect(resolve({ legs: [] })).not.toBe("Return time unknown.");
    expect(resolve({ legs: [{ leg: { id: "return", role: "return" }, state: "unavailable", estimate: null }] as never })).toBe("Return time unknown.");
    expect(resolve({ legs: [{ leg: { id: "return", role: "return" }, state: "current", estimate: null }] as never })).not.toBe("Return time unknown.");
  });
  it("names the overlapped trip and its span (Ticket 261)", () => {
    const legs = [{ leg: { id: "out", role: "outbound", destinationCommitmentRef: "event" }, state: "current", estimate: null },
      { leg: { id: "return", role: "return", originCommitmentRef: "event", destinationCommitmentRef: null }, state: "current", estimate: null }] as never;
    const resolve = (scheduledFor: string, extra: Partial<Parameters<typeof resolveTimelineOccurrenceContext>[0]> = {}) => resolveTimelineOccurrenceContext({
      occurrenceId: "behavior", scheduledFor, runningStartedAt: null,
      estimate: { kind: "known", seconds: 900, durationLabel: "15 minutes", sampleCount: 0, lookbackDays: 90, provenance: "behavior_default" },
      events: [], freshness: { state: "current", refreshedAt: "2026-09-21T12:00:00Z", label: "Calendar current", canAssertNoOverlap: true },
      now: Temporal.Instant.from("2026-09-21T12:00:00Z"), travel: { ...travel, legs }, travelLabels: new Map([["event", "Dentist"]]), timezone: "UTC", ...extra });
    expect(resolve("2026-09-21T13:45:00Z").overlapLabel).toBe("Overlaps your trip to Dentist (1:30 PM–2:30 PM)");
    expect(resolve("2026-09-21T17:00:00Z").overlapLabel).toBe("Overlaps your trip home (4:30 PM–6:30 PM)");
    // The shown times include a weather margin when the leg has an estimate.
    const estimated = [{ leg: { id: "out", role: "outbound", destinationCommitmentRef: "event" }, state: "current",
      estimate: { departureAt: "2026-09-21T13:30:00Z", arrivalAt: "2026-09-21T14:30:00Z" },
      weather: { departureAt: "2026-09-21T13:15:00Z", arrivalAt: "2026-09-21T14:30:00Z" } }] as never;
    expect(resolve("2026-09-21T13:45:00Z", { travel: { ...travel, legs: estimated }, timezone: "America/New_York" }).overlapLabel)
      .toBe("Overlaps your trip to Dentist (9:15 AM–10:30 AM)");
    // No title for the stop, or no legs at all: the trip still gets a plain name.
    expect(resolve("2026-09-21T13:45:00Z", { travelLabels: undefined }).overlapLabel).toBe("Overlaps your trip to your next stop (1:30 PM–2:30 PM)");
    expect(resolve("2026-09-21T13:45:00Z", { travel }).overlapLabel).toBe("Overlaps your trip to your next stop (1:30 PM–2:30 PM)");
  });
  it("clips overnight travel against actual DST day boundaries", () => {
    const layout = resolveDayProgressLayout({ timezone: "America/New_York", days: [
      { localDate: "2026-10-31", top: 0, bottom: 240, rows: [] },
      { localDate: "2026-11-01", top: 240, bottom: 490, rows: [] },
    ], travelSegments: [{ ...segments[0]!, startAt: "2026-11-01T03:30:00Z", endAt: "2026-11-01T06:30:00Z" }] });
    expect(layout.days[0]!.travelSpans[0]!.endPosition).toBe(240);
    expect(layout.days[1]!.travelSpans[0]).toMatchObject({ startPosition: 240, endPosition: 265 });
  });
});

describe("Timeline next-departure line (Ticket 269)", () => {
  const routesView: TravelRoutesView = { accountId: "a", mode: "walking", navigationPreference: "google_maps", settingsRevision: "r", expiresAt: null, evidence: { ...travel, modelProjection: undefined } as never };
  const status = (value: Partial<TravelState>): TravelState => ({ view: null, message: null, stale: false, pending: false, observedAt: null, resumesAt: null, refresh: () => undefined, ...value });
  const none: DepartureModel = { state: "none", next: null, phrase: null, trips: [], resumesAt: null, pausedPhrase: null };
  const model = (linePhrase: string, trip: Partial<DepartureTrip> = {}, paused: string | null = null): DepartureModel => {
    const next = { key: "outbound:base:gym", state: "upcoming", action: null, linePhrase, phrase: linePhrase, ...trip } as DepartureTrip;
    return { state: next.state, next, phrase: linePhrase, trips: [next], resumesAt: paused, pausedPhrase: paused ? "Travel estimates resume on October 1." : null };
  };
  const leaveBy = model("Leave by 9:35 AM for Gym from Home · walking, arrive 9:55 AM.");
  const render = (departure: DepartureModel, value: TravelState | null, extra: { message?: string | null; hasEvidence?: boolean } = {}) =>
    renderToStaticMarkup(createElement(TravelStatusLine, { departure, status: value, hasEvidence: extra.hasEvidence ?? !!value?.view?.evidence, message: extra.message ?? null }));
  const development = (element: ReturnType<typeof createElement>) => renderToStaticMarkup(createElement(DevelopmentBuildProvider, { value: true } as Parameters<typeof DevelopmentBuildProvider>[0], element));
  it("shows the next trip's line in place of Travel as of, with no button while the estimate is current", () => {
    const html = render(leaveBy, status({ view: routesView, observedAt: "2026-09-21T18:52:30Z" }));
    expect(html).toContain("Leave by 9:35 AM for Gym from Home · walking, arrive 9:55 AM.");
    expect(html).not.toContain("Travel as of");
    expect(html).not.toContain("Refresh travel");
    expect(html).toContain('data-departure-timed="true"');
  });
  it("ends the line with Refresh travel when the trip's action is refresh, disabled while pending", () => {
    const last = model("Last estimate: leave by 9:35 AM for Gym · checked 7:00 AM.", { action: "refresh", freshness: "last_estimate" });
    const html = render(last, status({ view: routesView, stale: true }));
    expect(html).toContain("Last estimate: leave by 9:35 AM for Gym · checked 7:00 AM. <button");
    expect(html).toContain(">Refresh travel</button>");
    expect(html).toContain('class="text-link"');
    expect(render(last, status({ view: routesView, stale: true, pending: true }))).toContain("disabled");
  });
  it("makes the words Refresh travel the button when the phrase starts with them (R1)", () => {
    const ready = model("Refresh travel to get the leave time for Dentist.", { state: "appears_later", action: "refresh" });
    const html = render(ready, status({ view: routesView }));
    expect(html).toContain(">Refresh travel</button> to get the leave time for Dentist.");
    expect(html.split("Refresh travel").length - 1).toBe(1);
    expect(html).not.toContain("data-departure-timed");
    // Without a travel status there is nothing to refresh, so the words stay plain.
    expect(render(ready, null, { hasEvidence: true })).not.toContain("<button");
  });
  it("shows a needs step's sentence with no action (Ticket 273 adds them)", () => {
    const html = render(model("Add a place for Dentist to get a leave time.", { state: "needs_place" }), status({ view: routesView }));
    expect(html).toContain("Add a place for Dentist to get a leave time.");
    expect(html).not.toContain("<button");
  });
  it("shows a failure message with the button, and hides the button for provider review", () => {
    const unavailable = render(none, status({ message: "Travel estimates are unavailable right now. Tracking and Calendar still work." }));
    expect(unavailable).toContain("unavailable right now");
    expect(unavailable).toContain("Refresh travel");
    // Ticket 261: the provider-review text is for development builds. Production says estimates are unavailable.
    const review = render(none, status({ message: TRAVEL_CLEARANCE_MESSAGE }));
    expect(review).not.toContain("provider review");
    expect(review).toContain("Travel estimates are unavailable right now. Tracking and Calendar still work.");
    expect(review).not.toContain("Refresh travel");
    const reviewDev = development(createElement(TravelStatusLine, { departure: none, status: status({ message: TRAVEL_CLEARANCE_MESSAGE }), hasEvidence: false }));
    expect(reviewDev).toContain("provider review");
    expect(reviewDev).not.toContain("Refresh travel");
  });
  it("puts a message on a second short line under a kept leave time, never the provider-review text in production", () => {
    const kept = render(leaveBy, status({ view: routesView, stale: true, message: TRAVEL_CLEARANCE_MESSAGE }));
    expect(kept).not.toContain("provider review");
    expect(kept).toMatch(/Leave by 9:35 AM[^<]*<\/p><p[^>]*data-travel-note[^>]*>Travel estimates are unavailable right now\. Tracking and Calendar still work\.<\/p>/);
    const fallback = render(none, null, { message: TRAVEL_CLEARANCE_MESSAGE });
    expect(fallback).not.toContain("provider review");
    expect(fallback).toContain("unavailable right now");
    expect(development(createElement(TravelStatusLine, { departure: leaveBy, status: status({ view: routesView, message: TRAVEL_CLEARANCE_MESSAGE }), hasEvidence: true })))
      .toContain("provider review");
    // One Refresh travel at most: the line's button wins over the note's.
    const both = render(model("Last estimate: leave by 9:35 AM for Gym · checked 7:00 AM.", { action: "refresh" }),
      status({ view: routesView, message: "Travel estimates are unavailable right now. Tracking and Calendar still work." }));
    expect(both.split(">Refresh travel</button>").length - 1).toBe(1);
  });
  it("says nothing on a day with no trips, even while paused or with a message (G9)", () => {
    expect(render(none, status({ view: routesView, observedAt: "2026-09-21T18:52:00Z" }))).not.toContain("<p");
    expect(render(none, status({ view: routesView, stale: true, resumesAt: "2026-10-01T04:00:00Z" }))).not.toContain("<p");
    expect(render(none, status({ view: routesView, message: "Travel estimates are unavailable right now. Tracking and Calendar still work." }))).not.toContain("<p");
  });
  it("shows the paused phrase beside a known time with no button (D11)", () => {
    const paused = render(model("Leave by 9:35 AM for Gym from Home · walking, arrive 9:55 AM.", {}, "2026-10-01T04:00:00Z"),
      status({ view: routesView, stale: true, resumesAt: "2026-10-01T04:00:00Z" }));
    expect(paused).toContain("Leave by 9:35 AM for Gym from Home · walking, arrive 9:55 AM. Travel estimates resume on October 1.");
    expect(paused).not.toContain("Refresh travel");
    const alone = render(model("Travel estimates resume on October 1.", { state: "paused" }, "2026-10-01T04:00:00Z"), status({ resumesAt: "2026-10-01T04:00:00Z" }));
    expect(alone.split("Travel estimates resume on October 1.").length - 1).toBe(1);
  });
  it("adds the weather state as the note only when there is no message", () => {
    const weatherView = { ...routesView, evidence: { ...routesView.evidence!, weather: { state: "no_position" } } } as never;
    expect(render(leaveBy, status({ view: weatherView }))).toContain("No weather margin: device location is unavailable.");
    const failed = render(leaveBy, status({ view: weatherView, message: "Travel estimates are unavailable right now. Tracking and Calendar still work." }));
    expect(failed).not.toContain("No weather margin");
  });
  it("renders no visible text without a trip or message", () => {
    expect(render(none, status({}))).not.toContain("<p");
    expect(render(none, null)).not.toContain("<p");
  });
});

describe("travel sourceKey", () => {
  const event = { id: "e", revision: { providerEtag: "1", providerUpdatedAt: null }, location: "1 St", kind: "timed", startAt: "2026-09-21T13:00:00Z", endAt: "2026-09-21T14:00:00Z" };
  const timeline = { daySections: [{ occurrences: [{ id: "o", status: "unresolved", scheduledFor: "2026-09-21T15:00:00Z" }] }], durationEstimates: {} } as never;
  it("is unchanged by a new Calendar fetch with the same events", () => {
    const first = { fetchedAt: "2026-09-21T12:00:00Z", events: [event] };
    const second = { fetchedAt: "2026-09-21T12:05:00Z", events: [{ ...event, calendarId: "c", title: "refetched" }] };
    expect(travelSourceKey(second.events as never, timeline)).toBe(travelSourceKey(first.events as never, timeline));
    expect(travelSourceKey([{ ...event, location: "2 St" }] as never, timeline)).not.toBe(travelSourceKey(first.events as never, timeline));
  });
  it("ignores Calendar metadata but reacts to the response and times", () => {
    const before = travelSourceKey([event] as never, timeline);
    expect(travelSourceKey([{ ...event, revision: { providerEtag: "2" }, title: "new title" }] as never, timeline)).toBe(before);
    expect(travelSourceKey([{ ...event, currentUserResponse: "declined" }] as never, timeline)).not.toBe(before);
    expect(travelSourceKey([{ ...event, startAt: "2026-09-21T14:00:00Z" }] as never, timeline)).not.toBe(before);
  });
  it("is unchanged by a status change so marking a Behavior makes no provider call", () => {
    const resolved = { daySections: [{ occurrences: [{ id: "o", status: "completed", scheduledFor: "2026-09-21T15:00:00Z" }] }], durationEstimates: { b: { kind: "known", seconds: 600 } } } as never;
    expect(travelSourceKey([event] as never, resolved)).toBe(travelSourceKey([event] as never, timeline));
    const moved = { daySections: [{ occurrences: [{ id: "o", status: "unresolved", scheduledFor: "2026-09-21T16:00:00Z" }] }], durationEstimates: {} } as never;
    expect(travelSourceKey([event] as never, moved)).not.toBe(travelSourceKey([event] as never, timeline));
  });
  it("changes when the owning Behavior location changes", () => {
    const withBehavior = { daySections: [{ occurrences: [{ id: "o", behaviorId: "b", status: "unresolved", scheduledFor: "2026-09-21T15:00:00Z" }] }], durationEstimates: {} } as never;
    const before = travelSourceKey([], withBehavior, [{ id: "b", locationText: "1 St", updatedAt: "t1" }]);
    expect(travelSourceKey([], withBehavior, [{ id: "b", locationText: "1 St", updatedAt: "t1" }])).toBe(before);
    expect(travelSourceKey([], withBehavior, [{ id: "b", locationText: "2 St", updatedAt: "t2" }])).not.toBe(before);
  });
  it("changes when the occurrence's own Where changes, with no Behavior list (the web Timeline)", () => {
    // The web Timeline passes no Behavior revisions, so a place edit must reach the key through the row.
    type Where = Readonly<{ whereKind?: "home" | "place"; placeText?: string }>;
    const day = (localDate: string, where: Where) => ({ localDate, occurrences: [{ id: `o-${localDate}`, behaviorId: "b", status: "unresolved",
      scheduledFor: `${localDate}T15:00:00Z`, ...where }] });
    const view = (where: Where) => ({ todayLocalDate: "2026-09-21", timezone: "America/New_York", durationEstimates: {},
      daySections: [day("2026-09-21", where), day("2026-09-22", where)] }) as never;
    const keys = (where: Where) => [travelSourceKey([], view(where)), travelStopRevisions([], view(where))["o-2026-09-21"], travelTomorrowStopKey([], view(where))];
    const bryant = keys({ whereKind: "place", placeText: "Bryant Park, New York, NY 10018" });
    // Nothing changed: the same keys, so no route request.
    expect(keys({ whereKind: "place", placeText: "Bryant Park, New York, NY 10018" })).toEqual(bryant);
    const morgan = keys({ whereKind: "place", placeText: "Morgan Library, New York, NY" });
    const home = keys({ whereKind: "home" });
    const none = keys({});
    for (const [index, before] of bryant.entries()) expect(morgan[index]).not.toBe(before);
    expect(home[0]).not.toBe(bryant[0]); expect(home[1]).not.toBe(bryant[1]);
    // Home to no place withdraws the trip home too.
    expect(none[0]).not.toBe(home[0]); expect(none[1]).not.toBe(home[1]);
  });
});

describe("Ticket 268: last estimates, unreliable trips and a trip home that changed", () => {
  const place = (ref: string, latitude: number) => ({ ref, source: "calendar" as const, sourceRevision: `${ref}-1`, point: { kind: "coordinates" as const, latitude, longitude: 0 } });
  const stop = (ref: string, startAt: string, endAt: string, latitude: number) => ({ ref, revision: `${ref}-1`, kind: "calendar" as const, startAt, endAt, attendance: "physical" as const, endpoint: place(ref, latitude), mode: "walking" as const });
  const buffers = { arrivalSeconds: 0, exitSeconds: 300, settlingSeconds: 0 };
  const now = "2026-09-16T12:00:00Z";
  const stops = [{ ref: "standup", label: "Standup", startAt: "2026-09-16T14:00:00Z", endAt: "2026-09-16T15:00:00Z" }];
  /** The Ticket 265 reviewer's chain: every leg walks 20 minutes from its ready time. */
  function chain(reviewEnd: string, revision = "1"): Omit<TravelEvidenceResult, "modelProjection"> {
    const plan = resolveTravelPlan({ journeyRef: "day", journeyRevision: revision, now, grantRevision: "g", defaultMode: "walking", device: null, predictedOrigin: null, corrections: [], buffers,
      base: { ref: "home", source: "saved_base", sourceRevision: "h1", point: { kind: "coordinates", latitude: 1, longitude: 0 } },
      commitments: [stop("standup", "2026-09-16T14:00:00Z", "2026-09-16T15:00:00Z", 2), { ...stop("review", "2026-09-16T14:30:00Z", reviewEnd, 3), revision: `review-${revision}`, endpoint: { ...place("review", 3), sourceRevision: `review-${revision}` } }] });
    const results = plan.legs.map((leg) => ({ legId: leg.id, provenance: leg.provenance, estimate: { durationSeconds: 1200, departureAt: leg.readyAt,
      arrivalAt: Temporal.Instant.from(leg.readyAt).add({ seconds: 1200 }).toString(), warnings: [], fallback: false, attribution: "Google Maps", observedAt: now, expiresAt: "2026-09-16T12:05:00Z" } }));
    const { modelProjection, ...rest } = resolveTravelEvidence({ plan, results, collisionCandidates: [], buffers, now, expectedJourneyRevision: revision, expectedGrantRevision: "g", modelProjection: "disabled" });
    expect(modelProjection).toBeNull();
    return rest;
  }
  const behaviorAt = (scheduledFor: string, value: Omit<TravelEvidenceResult, "modelProjection">) => resolveTimelineOccurrenceContext({
    occurrenceId: "stretch", scheduledFor, runningStartedAt: null,
    estimate: { kind: "known", seconds: 240, durationLabel: "4 minutes", sampleCount: 0, lookbackDays: 90, provenance: "behavior_default" },
    events: [], freshness: { state: "current", refreshedAt: now, label: "Calendar current", canAssertNoOverlap: true },
    now: Temporal.Instant.from(now), travel: value, timezone: "UTC" });

  it("marks a Behavior inside an unreliable trip's window, as the Daily Brief does", () => {
    const late = chain("2026-09-16T15:10:00Z");
    // The trip home's route says 15:15–15:35, but the onward trip arrives only at 15:25.
    expect(travelUnreliableSegments(late).map(({ startAt, endAt }) => [startAt, endAt])).toEqual([["2026-09-16T15:15:00Z", "2026-09-16T15:45:00Z"]]);
    const context = behaviorAt("2026-09-16T15:36:00Z", late);
    expect(context.overlapAssessment).toBe("possible");
    expect(context.overlapLabel).toBe("Overlaps your trip home (3:15 PM–3:45 PM)");
    expect(behaviorAt("2026-09-16T15:46:00Z", late).overlapLabel).not.toMatch(/^Overlaps/);
    // An on-time chain adds no window.
    expect(travelUnreliableSegments(chain("2026-09-16T15:30:00Z"))).toEqual([]);
  });

  it("shows the trip home as changed when resolving the last stop leaves an earlier one", () => {
    const value = chain("2026-09-16T15:30:00Z");
    const after = resolveTravelAfterDecisions(value, [{ id: "standup", status: "unresolved" }, { id: "review", status: "completed" }])!;
    expect(after.legs.map(({ leg }) => leg.role)).toEqual(["outbound"]);
    expect(after.unknownLegs).toContainEqual({ role: "return", originCommitmentRef: "standup", destinationCommitmentRef: null, reason: "origin_unknown", blockerResolved: true });
    const model = resolveDepartureModel({ evidence: after, stops, now, timezone: "UTC", arrivalBufferSeconds: 0, preparationSeconds: 0, pausedUntil: null });
    expect(model.trips.at(-1)).toMatchObject({ role: "return", state: "trip_changed", action: "refresh" });
    // With no stop left, there is no trip home to change.
    const none = resolveTravelAfterDecisions(value, [{ id: "standup", status: "completed" }, { id: "review", status: "completed" }])!;
    expect((none.unknownLegs ?? []).some((leg) => leg.role === "return")).toBe(false);
  });

  it("keeps a trip's last estimate when a later response leaves it unrouted", () => {
    const first = chain("2026-09-16T15:30:00Z");
    const next = chain("2026-09-16T15:30:00Z");
    const unrouted = (value: typeof next, roles: readonly string[]) => ({ ...value,
      legs: value.legs.map((entry) => roles.includes(entry.leg.role) ? { ...entry, leg: { ...entry.leg, id: `${entry.leg.id}-new` }, state: "unavailable" as const, estimate: null, reason: "outside_route_window" } : entry),
      segments: value.segments.filter((segment) => !segment.legId || !value.legs.some((entry) => roles.includes(entry.leg.role) && entry.leg.id === segment.legId)) });
    const merged = mergeTravelLastEstimates(first, unrouted(next, ["onward", "return"]), "2026-09-16T12:10:00Z");
    expect(merged.legs.map((entry) => entry.estimate?.departureAt)).toEqual(first.legs.map((entry) => entry.estimate?.departureAt));
    // The kept estimates sit on the new legs, so their segments carry the new leg IDs.
    expect(merged.legs.map((entry) => entry.leg.id)).toEqual([first.legs[0]!.leg.id, `${first.legs[1]!.leg.id}-new`, `${first.legs[2]!.leg.id}-new`]);
    expect(merged.occupiedSpans.map(({ startAt, endAt }) => [startAt, endAt])).toEqual(first.occupiedSpans.map(({ startAt, endAt }) => [startAt, endAt]));
    expect(merged.segments.filter((segment) => segment.legId).every((segment) => merged.legs.some((entry) => entry.leg.id === segment.legId))).toBe(true);
    expect(merged.completeTrip).toBe(true);
    // No previous view, or nothing to carry: the response is used as it is.
    expect(mergeTravelLastEstimates(null, next, now)).toBe(next);
    expect(mergeTravelLastEstimates(first, next, now)).toBe(next);
  });

  describe("an estimate carries over only from the same origin (PR #191 review)", () => {
    type Display = Omit<TravelEvidenceResult, "modelProjection">;
    type Entry = Display["legs"][number];
    const failed = (entry: Entry, leg: Partial<Entry["leg"]>): Entry => ({ leg: { ...entry.leg, ...leg, id: `${entry.leg.id}-new` },
      state: "unavailable", estimate: null, reason: "provider_unavailable" });
    const respond = (value: Display, legs: Entry[]): Display => ({ ...value, legs, segments: value.segments.filter((segment) => !segment.legId), unknownLegs: [] });
    const stateOf = (merged: Display) => merged.legs.map((entry) => [entry.leg.role, entry.leg.originCommitmentRef, entry.leg.destinationCommitmentRef, entry.state, !!entry.estimate]);

    it("a stop inserted before an unchanged destination, with the new leg failing", () => {
      const first = chain("2026-09-16T15:30:00Z");
      const [outbound, onward, home] = first.legs as [Entry, Entry, Entry];
      // Coffee now sits between standup and review; the trip to review starts at coffee and fails.
      const next = respond(first, [{ ...outbound, leg: { ...outbound.leg, id: "out-new" } }, failed(onward, { originCommitmentRef: "coffee" }), { ...home, leg: { ...home.leg, id: "home-new" } }]);
      const merged = mergeTravelLastEstimates(first, next, now);
      expect(stateOf(merged)[1]).toEqual(["onward", "coffee", "review", "rejected_revision", false]);
      expect(merged.segments.some((segment) => segment.legId === `${onward.leg.id}-new`)).toBe(false);
      const model = resolveDepartureModel({ evidence: merged, stops: [...stops, { ref: "review", label: "Review", startAt: "2026-09-16T14:30:00Z", endAt: "2026-09-16T15:30:00Z" }],
        now, timezone: "UTC", arrivalBufferSeconds: 0, preparationSeconds: 0, pausedUntil: null });
      expect(model.trips.find((trip) => trip.destinationRef === "review")).toMatchObject({ state: "trip_changed", action: "refresh", leaveAt: null });
    });

    it("two stops reordered", () => {
      const first = chain("2026-09-16T15:30:00Z");
      const [outbound, onward, home] = first.legs as [Entry, Entry, Entry];
      // Review now comes first, from Home, and standup follows it. Both routes fail.
      const next = respond(first, [
        failed(onward, { role: "outbound", originCommitmentRef: null }),
        failed(outbound, { role: "onward", originCommitmentRef: "review" }),
        { ...home, leg: { ...home.leg, id: "home-new" } },
      ]);
      const merged = mergeTravelLastEstimates(first, next, now);
      expect(stateOf(merged).slice(0, 2)).toEqual([["outbound", null, "review", "rejected_revision", false], ["onward", "review", "standup", "rejected_revision", false]]);
    });

    it("a deleted stop that has not ended is not a passed stop (R7)", () => {
      const first = chain("2026-09-16T15:30:00Z");
      const [, onward, home] = first.legs as [Entry, Entry, Entry];
      // At 14:10 standup (14:00–15:00) is deleted; the trip to review now leaves from Home and fails.
      const next = respond(first, [failed(onward, { role: "outbound", originCommitmentRef: null }), { ...home, leg: { ...home.leg, id: "home-new" } }]);
      const merged = mergeTravelLastEstimates(first, next, "2026-09-16T14:10:00Z");
      expect(stateOf(merged)[0]).toEqual(["outbound", null, "review", "rejected_revision", false]);
    });

    it("an onward trip whose earlier stop has passed keeps its estimate as an outbound trip", () => {
      const first = chain("2026-09-16T15:30:00Z");
      const [, onward, home] = first.legs as [Entry, Entry, Entry];
      // Standup has ended and left the plan: the trip to review now leaves from Home, and its route failed.
      const next = respond(first, [failed(onward, { role: "outbound", originCommitmentRef: null }), { ...home, leg: { ...home.leg, id: "home-new" } }]);
      // Standup ended at 15:00; the trip to review arrives at 15:25.
      const merged = mergeTravelLastEstimates(first, next, "2026-09-16T15:10:00Z");
      expect(merged.legs[0]).toMatchObject({ state: "current", leg: { id: `${onward.leg.id}-new`, role: "outbound" } });
      expect(merged.legs[0]!.estimate?.departureAt).toBe(onward.estimate!.departureAt);
      expect(merged.segments.filter((segment) => segment.legId === `${onward.leg.id}-new`).length).toBeGreaterThan(0);
    });
  });

  it("withdraws a trip's times when its source changed, its trip has passed, or it cannot leave before its stop ends", () => {
    const first = chain("2026-09-16T15:30:00Z");
    const changed = chain("2026-09-16T15:30:00Z", "2");
    const unrouted = (value: typeof first, reason = "outside_route_window") => ({ ...value,
      legs: value.legs.map((entry) => ({ ...entry, state: "unavailable" as const, estimate: null, reason })), segments: value.segments.filter((segment) => !segment.legId) });
    // The review's revision changed: its two trips are withdrawn, the trip to standup stays.
    expect(mergeTravelLastEstimates(first, unrouted(changed), now).legs.map((entry) => !!entry.estimate)).toEqual([true, false, false]);
    // After the first trip arrived (14:20 local ready + 20 min), only later trips keep times.
    expect(mergeTravelLastEstimates(first, unrouted(first), "2026-09-16T14:00:00Z").legs.map((entry) => !!entry.estimate)).toEqual([false, true, true]);
    expect(mergeTravelLastEstimates(first, unrouted(first, "Route is ready only after its destination ends."), now).legs.every((entry) => !entry.estimate)).toBe(true);
  });
});
