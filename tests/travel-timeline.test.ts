import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";
import { resolveDayProgressLayout } from "@cadence/core/resolvers/day-progress.resolver";
import { resolveTimelineOccurrenceContext } from "@cadence/core/resolvers/timeline-context.resolver";
import type { TravelEvidenceResult, TravelOccupiedSegment } from "@cadence/core/types/travel";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TravelStatusLine } from "@/components/timeline/DayProgressTimeline";
import { TRAVEL_CLEARANCE_MESSAGE, travelSourceKey, type TravelRoutesView, type TravelState } from "@/lib/ui/travel";

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
      now: Temporal.Instant.from("2026-09-21T12:00:00Z"), travel });
    expect(resolve("2026-09-21T13:45:00Z")).toMatchObject({ overlappingEventIds: ["event"], overlapLabel: "Possible travel overlap" });
    expect(resolve("2026-09-21T18:30:00Z")).toMatchObject({ overlappingEventIds: [], overlapAssessment: "unknown", overlapLabel: "Travel timing incomplete" });
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

describe("Timeline travel status line", () => {
  const routesView: TravelRoutesView = { accountId: "a", mode: "walking", navigationPreference: "google_maps", settingsRevision: "r", expiresAt: null, evidence: { ...travel, modelProjection: undefined } as never };
  const status = (value: Partial<TravelState>): TravelState => ({ view: null, message: null, stale: false, pending: false, observedAt: null, resumesAt: null, refresh: () => undefined, ...value });
  const render = (value: TravelState | null) => renderToStaticMarkup(createElement(TravelStatusLine, { status: value, timezone: "America/New_York" }));
  it("shows the observation time with a refresh link", () => {
    const html = render(status({ view: routesView, observedAt: "2026-09-21T18:52:30Z" }));
    expect(html).toContain("Travel as of 2:52 PM");
    expect(html).toContain(">Refresh travel</button>");
    expect(html).toContain("class=\"text-link\"");
  });
  it("marks an expired view as stale", () => {
    expect(render(status({ view: routesView, observedAt: "2026-09-21T18:52:00Z", stale: true }))).toContain("Travel estimates from 2:52 PM may be stale.");
  });
  it("disables the link while pending", () => {
    expect(render(status({ view: routesView, observedAt: "2026-09-21T18:52:00Z", pending: true }))).toContain("disabled");
  });
  it("shows a failure message with the link, and hides the link for provider review", () => {
    const unavailable = render(status({ message: "Travel estimates are unavailable right now. Tracking and Calendar still work." }));
    expect(unavailable).toContain("unavailable right now");
    expect(unavailable).toContain("Refresh travel");
    const review = render(status({ message: TRAVEL_CLEARANCE_MESSAGE }));
    expect(review).toContain("provider review");
    expect(review).not.toContain("Refresh travel");
  });
  it("names the renewal date in the user's timezone and hides the link while the budget is used up", () => {
    const resumes = render(status({ resumesAt: "2026-10-01T04:00:00Z" }));
    expect(resumes).toContain("Travel estimates resume on October 1.");
    expect(resumes).not.toContain("Refresh travel");
    const kept = render(status({ view: routesView, observedAt: "2026-09-21T18:52:00Z", stale: true, resumesAt: "2026-10-01T04:00:00Z" }));
    expect(kept).toContain("Travel estimates from 2:52 PM may be stale. Travel estimates resume on October 1.");
    expect(kept).not.toContain("tomorrow");
  });
  it("renders nothing without a view or message", () => {
    expect(render(status({}))).toBe("");
    expect(render(null)).toBe("");
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
  it("ignores Calendar metadata but reacts to attendance and times", () => {
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
});
