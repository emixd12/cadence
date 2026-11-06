// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RefreshProvider } from "@cadence/ui/runtime";

import { eventTimeLabel } from "@/components/timeline/ExternalEventDetails";
import { validateExternalEventSnapshot } from "@cadence/core/services/external-event-validation";
import snapshotFixture from "./fixtures/external-event-snapshot.valid.json";
import { DayProgressTimeline } from "@/components/timeline/DayProgressTimeline";
import { travelBenchEvidence } from "@/app/design-system/TravelBench";
import { resolveTravelEvidence, resolveTravelPlan } from "@cadence/core/resolvers/travel.resolver";
import type { TimelineView } from "@/lib/types/timeline";
import { leaveReminderTripDigest } from "@cadence/core/services/leave-reminder-plan";
import { useBriefTravel } from "@/lib/ui/brief-travel";
import type { TravelResolvedLegEvidence } from "@cadence/core/types/travel";

const action = vi.fn(async () => ({ status: "idle" as const, message: "" }));
let container: HTMLDivElement;
let root: Root;
let hidden = false;
let observers: (() => void)[];

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-16T14:00:00Z"));
  observers = [];
  vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { observers.push(callback); } observe() {} disconnect() {} });
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const section = this.closest("section");
    const sectionTop = section ? 0 : 0;
    const isSection = this === section;
    const isTime = this.tagName === "TIME";
    const top = isSection ? sectionTop : isTime ? sectionTop + 96 : sectionTop + 60;
    const height = isSection ? 260 : isTime ? 20 : 48;
    return { top, bottom: top + height, left: 160, right: 760, width: isTime ? 64 : 600, height, x: 160, y: top, toJSON() {} };
  });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value(this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value(this: HTMLDialogElement) { this.open = false; this.dispatchEvent(new Event("close")); } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() => root.render(<RefreshProvider onRefresh={() => {}}><DayProgressTimeline {...props()} /></RefreshProvider>));
  await act(async () => {
    observers.forEach((callback) => callback());
    await Promise.resolve();
  });
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  hidden = false;
});

function button(label: string) {
  const found = [...container.querySelectorAll<HTMLButtonElement>("button")].find((element) =>
    element.getAttribute("aria-label") === label || element.textContent?.trim() === label);
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}

describe("DayProgressTimeline", () => {
  it("shows travel timing when a located Behavior expands without Calendar events", async () => {
    const input = props();
    await act(() => root.render(<RefreshProvider onRefresh={() => {}}><DayProgressTimeline {...input}
      context={{ ...input.context, events: [], travel: travelBenchEvidence("occurrence-1", true) }} /></RefreshProvider>));
    const toggle = container.querySelector<HTMLElement>('article[data-occurrence-id="occurrence-1"] summary');
    expect(toggle).not.toBeNull();
    await act(() => toggle!.click());
    const timing = container.querySelector('[aria-label="Travel timing"]');
    // Ticket 261: plain lines from the departure model, with no internal terms.
    expect(timing?.textContent).toContain("Leave by Nov 1, 1:30 PM · walking, arrive Nov 1, 2:20 PM.");
    expect(timing?.textContent).toContain("Head home Nov 1, 4:40 PM · walking, home by Nov 1, 6:20 PM.");
    expect(timing?.textContent).toContain("Free again Nov 1, 6:30 PM.");
    expect(timing?.textContent).toContain("Google Maps · checked Nov 1, 8:00 AM.");
    for (const internal of ["Outbound", "Return home", "Origin:", "Available again", "Estimates depend on"]) expect(timing?.textContent).not.toContain(internal);
  });
  it("offers Directions in a located Behavior row, from its own place text, after the estimate expires (Ticket 271)", async () => {
    const input = props();
    const occurrence = input.timeline.daySections[0]!.occurrences[0]!;
    input.timeline.daySections[0]!.occurrences = [{ ...occurrence, placeText: "Riverside track" }];
    const routed = travelBenchEvidence("occurrence-1", true);
    // The fixture's estimates expired at 13:05Z; the clock reads 14:00Z.
    const evidence = { ...routed, legs: routed.legs.map((item) => ({ ...item, leg: { ...item.leg,
      provenance: { ...item.leg.provenance, destinationSource: item.leg.destinationCommitmentRef === "occurrence-1" ? "behavior" as const : item.leg.provenance.destinationSource } } })) };
    await act(() => root.render(<RefreshProvider onRefresh={() => {}}><DayProgressTimeline {...input}
      context={{ ...input.context, events: [], travel: evidence, travelMode: "transit", navigationPreference: "google_maps" }} /></RefreshProvider>));
    await act(() => container.querySelector<HTMLElement>('article[data-occurrence-id="occurrence-1"] summary')!.click());
    const link = container.querySelector<HTMLAnchorElement>('article[data-occurrence-id="occurrence-1"] [data-travel-navigation]')!;
    expect(link.textContent).toBe("Directions in Google Maps");
    expect(new URL(link.href).searchParams.get("destination")).toBe("Riverside track");
    // The place was routed walking although usual travel is transit: Directions follows the route.
    expect(new URL(link.href).searchParams.get("travelmode")).toBe("walking");

    // No place text, no link: the row never builds one from route content.
    input.timeline.daySections[0]!.occurrences = [occurrence];
    await act(() => root.render(<RefreshProvider onRefresh={() => {}}><DayProgressTimeline {...input}
      context={{ ...input.context, events: [], travel: evidence, travelMode: "transit", navigationPreference: "google_maps" }} /></RefreshProvider>));
    expect(container.querySelector('[aria-label="Travel timing"]')).not.toBeNull();
    expect(container.querySelector('article[data-occurrence-id="occurrence-1"] [data-travel-navigation]')).toBeNull();
  });
  it("withdraws omitted-stop guidance and offers manual refresh after clearing a decision", async () => {
    const input = props();
    const evidence = { ...travelBenchEvidence("occurrence-1", true),
      behaviorSources: [{ ref: "occurrence-1", behaviorId: "behavior-1", unresolved: false }] };
    const refresh = vi.fn();
    await act(() => root.render(<RefreshProvider onRefresh={() => {}}><DayProgressTimeline {...input}
      context={{ ...input.context, events: [], travel: evidence, travelStatus: {
        view: { accountId: "owner", evidence, mode: "walking", navigationPreference: "google_maps", settingsRevision: "one", expiresAt: null },
        message: null, stale: false, pending: false, observedAt: "2026-09-16T14:00:00Z", resumesAt: null, refresh,
      } }} /></RefreshProvider>));
    expect(container.textContent).toContain("Travel changed. Refresh travel to update estimates.");
    const toggle = container.querySelector<HTMLElement>('article[data-occurrence-id="occurrence-1"] summary');
    await act(() => toggle!.click());
    expect(container.querySelector('[aria-label="Travel timing"]')).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
    await act(() => button("Refresh travel").click());
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("shows nothing new on the row or drawer after a stop is resolved (Ticket 265)", async () => {
    const input = props();
    const section = input.timeline.daySections[0]!;
    const first = section.occurrences[0]!;
    section.occurrences = [{ ...first, status: "completed", statusLabel: "Completed" }, { ...first, id: "occurrence-2", title: "Lunch", status: "unresolved" }];
    section.occurrenceGroups = section.occurrences.map((occurrence) => ({ key: occurrence.id, behaviorId: occurrence.behaviorId, title: occurrence.title, occurrences: [], isGroupedStack: false }));
    input.context.events[0]!.id = "event-later";
    const point = (latitude: number) => ({ kind: "coordinates" as const, latitude, longitude: 0 });
    const stop = (ref: string, startAt: string, endAt: string, latitude: number) => ({ ref, revision: "1", kind: "calendar" as const, attendance: "physical" as const, startAt, endAt, mode: null,
      endpoint: { ref, point: point(latitude), source: "calendar" as const, sourceRevision: "1" } });
    const buffers = { arrivalSeconds: 600, exitSeconds: 600, settlingSeconds: 600 };
    const now = "2026-09-16T14:00:00Z";
    const plan = resolveTravelPlan({ journeyRef: "day", journeyRevision: "1", grantRevision: "1", now, defaultMode: "walking", predictedOrigin: null, device: null, corrections: [], buffers,
      base: { ref: "home", point: point(1), source: "saved_base", sourceRevision: "1" },
      commitments: [stop("occurrence-1", "2026-09-16T15:00:00Z", "2026-09-16T15:30:00Z", 2), stop("occurrence-2", "2026-09-16T16:30:00Z", "2026-09-16T17:00:00Z", 3), stop("event-later", "2026-09-16T18:30:00Z", "2026-09-16T19:00:00Z", 4)] });
    const evidence = resolveTravelEvidence({ plan, buffers, now, collisionCandidates: [], expectedJourneyRevision: "1", expectedGrantRevision: "1", modelProjection: "disabled",
      results: plan.legs.map((leg) => {
        const departureAt = leg.request.timing.kind === "depart_at" ? leg.request.timing.at : new Date(Date.parse(leg.request.timing.at) - 1_200_000).toISOString().replace(".000Z", "Z");
        return { legId: leg.id, provenance: leg.provenance, estimate: { durationSeconds: 1200, departureAt, arrivalAt: new Date(Date.parse(departureAt) + 1_200_000).toISOString().replace(".000Z", "Z"), warnings: [], fallback: false, attribution: "Google Maps", observedAt: now, expiresAt: "2026-09-16T23:00:00Z" } };
      }) });
    expect(evidence.legs.filter(({ leg }) => leg.originCommitmentRef === "occurrence-1")).toHaveLength(1);
    await act(() => root.render(<RefreshProvider onRefresh={() => {}}><DayProgressTimeline {...input} context={{ ...input.context, travel: evidence }} /></RefreshProvider>));

    const summary = (id: string) => container.querySelector<HTMLElement>(`article[data-occurrence-id="${id}"] summary`)!;
    await act(() => summary("occurrence-1").click());
    expect(container.querySelector('article[data-occurrence-id="occurrence-1"] [aria-label="Travel timing"]')).toBeNull();

    await act(() => summary("occurrence-2").click());
    const later = container.querySelector('article[data-occurrence-id="occurrence-2"] [aria-label="Travel timing"]');
    // The trip leaving this row names where it goes. The fixture's later stop is an all-day event,
    // which is never a stop, so the plain fallback names it.
    expect(later?.textContent).toContain("Leave by 2:00 PM for your next stop · walking, arrive 2:20 PM.");
    expect(later?.textContent).not.toContain("timing unavailable");
    expect(container.textContent).not.toContain("timing unavailable");

    await act(() => button("All day: Design offsite").click());
    await act(() => button("View details: Design offsite").click());
    const drawer = container.querySelector("dialog");
    expect(drawer?.textContent).toContain("Head home");
    expect(drawer?.textContent).not.toContain("timing unavailable");
  });

  it("names untitled events in accessible previews and details", async () => {
    const input = props();
    input.context.events[0]!.title = "";
    await act(() => root.render(<RefreshProvider onRefresh={() => {}}><DayProgressTimeline {...input} /></RefreshProvider>));
    await act(() => button("All day: Untitled event").click());
    await act(() => button("View details: Untitled event").click());
    expect(container.querySelector("#calendar-details-title")?.textContent).toBe("Untitled event");
  });

  it("distinguishes repeated DST clock times and exposes duration context", () => {
    const event = validateExternalEventSnapshot(snapshotFixture).events[0]!;
    expect(eventTimeLabel(event, "America/New_York")).toBe("1:30 AM EDT–1:30 AM EST");
    expect(container.textContent).toContain("Duration unknown.");
  });

  it("accepts a running mutation between display-clock ticks", async () => {
    const input = props();
    input.timeline.daySections[0]!.occurrences[0]!.timeTracking = { recordedSeconds: 0, runningStartedAt: "2026-09-16T14:00:01Z" };
    await act(() => root.render(<RefreshProvider onRefresh={() => {}}><DayProgressTimeline {...input} /></RefreshProvider>));
    expect(container.textContent).toContain("Tracking now");
  });

  it("refreshes at local midnight without status writes", async () => {
    const refresh = vi.fn();
    vi.setSystemTime(new Date("2026-09-17T03:59:59Z"));
    await act(() => root.render(<RefreshProvider onRefresh={refresh}><DayProgressTimeline {...props()} /></RefreshProvider>));
    await act(async () => { window.dispatchEvent(new Event("focus")); await vi.advanceTimersByTimeAsync(61_000); });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(action).not.toHaveBeenCalled();
  });

  it("keeps existing status and Note controls in chronological rows", () => {
    expect(container.querySelector('[data-day-progress-date="2026-09-16"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Calendar current");
    expect(button("Completed")).toBeDefined();
    expect(button("Not Completed")).toBeDefined();
    expect(container.querySelector('textarea[name="note"]')).not.toBeNull();
    expect(action).not.toHaveBeenCalled();
  });

  it("shows the last refresh time when Calendar context is stale", async () => {
    const input = props();
    await act(() => root.render(<RefreshProvider onRefresh={() => {}}><DayProgressTimeline {...input} context={{
      ...input.context,
      freshness: { state: "stale", refreshedAt: "2026-09-16T14:00:00Z", label: "Calendar context may be out of date", canAssertNoOverlap: false },
    }} /></RefreshProvider>));
    expect(container.textContent).toContain("Last refreshed Sep 16");
  });

  it("opens an event's drawer once per request and reports today's departure model to the Mac (Ticket 280)", async () => {
    const input = props();
    const onDeparture = vi.fn();
    const render = (requestKey: number) => root.render(<RefreshProvider onRefresh={() => {}}><DayProgressTimeline {...input} context={{
      ...input.context, onDeparture, openEvent: { eventId: "event-offsite", requestKey } }} /></RefreshProvider>);
    await act(() => render(1));
    expect(container.querySelector("dialog")?.open).toBe(true);
    expect(onDeparture).toHaveBeenLastCalledWith({ localDate: "2026-09-16", preparationSeconds: expect.any(Number), trips: null,
      stops: [{ ref: "occurrence-1", label: "Morning walk", startAt: "2026-09-16T13:00:00Z", endAt: null }] });
    await act(() => button("Close Calendar details").click());
    expect(container.querySelector("dialog")?.open).toBe(false);
    await act(() => render(1));
    expect(container.querySelector("dialog")?.open).toBe(false);
    await act(() => render(2));
    expect(container.querySelector("dialog")?.open).toBe(true);
  });

  it("shows tomorrow's first trip once today has none, and keeps it from the Mac reminders and the Daily Brief (Ticket 282)", async () => {
    // 7 PM on September 16. Today's trips are over; tomorrow's Dentist is at 9 AM.
    vi.setSystemTime(new Date("2026-09-16T23:00:00Z"));
    const input = props();
    const dentist = { ...outlookEvent(), id: "event-dentist", providerEventId: "event-dentist", logicalInstanceId: "event-dentist",
      source: "google_calendar" as const, title: "Dentist", location: "Main St", startAt: "2026-09-17T13:00:00Z", endAt: "2026-09-17T14:00:00Z" };
    const empty = { version: "1.0" as const, journeyRef: "today", legs: [] as TravelResolvedLegEvidence[], segments: [], occupiedSpans: [], collisions: [], completeTrip: false, finalAvailabilityAt: null };
    const routed: TravelResolvedLegEvidence = { state: "current", reason: null,
      leg: { id: "leg-dentist", role: "outbound", journeyRef: "tomorrow", originCommitmentRef: null, destinationCommitmentRef: "event-dentist",
        mode: "walking", readyAt: "2026-09-17T11:00:00Z", provenance: { originRef: "base", originSource: "saved_base", originRevision: "1",
          destinationRef: "event-dentist", destinationSource: "calendar", destinationRevision: "1", grantRevision: "one" } },
      estimate: { durationSeconds: 2400, departureAt: "2026-09-17T12:10:00Z", arrivalAt: "2026-09-17T12:50:00Z", warnings: [], fallback: false,
        attribution: "Google Maps", observedAt: "2026-09-16T23:00:00Z", expiresAt: "2026-09-16T23:05:00Z" } };
    const view = (evidence: typeof empty) => ({ accountId: "owner", evidence, mode: "walking" as const, navigationPreference: "google_maps" as const, settingsRevision: "one", expiresAt: null });
    const onDeparture = vi.fn();
    const brief = vi.fn();
    function BriefProbe() { brief(useBriefTravel()); return null; }
    await act(() => root.render(<RefreshProvider onRefresh={() => {}}><BriefProbe /><DayProgressTimeline {...input} context={{ ...input.context,
      events: [allDayEvent(), dentist], travel: empty, onDeparture, travelStatus: { view: view(empty), message: null, stale: false, pending: false,
        observedAt: "2026-09-16T23:00:00Z", resumesAt: null, refresh: () => undefined,
        tomorrow: { localDate: "2026-09-17", view: view({ ...empty, journeyRef: "tomorrow", legs: [routed] }) } } }} /></RefreshProvider>));
    expect(container.querySelector("[data-departure-line]")?.textContent).toBe("Tomorrow: leave by 8:10 AM for Dentist.");
    // Today's departure model, which feeds Mac reminders and the Daily Brief, has no trip.
    expect(onDeparture).toHaveBeenLastCalledWith(expect.objectContaining({ localDate: "2026-09-16", trips: [] }));
    expect(JSON.stringify(brief.mock.lastCall?.[0] ?? null)).not.toMatch(/event-dentist|12:10|8:10|Dentist/);
    // A view for another day is not tomorrow's.
    await act(() => root.render(<RefreshProvider onRefresh={() => {}}><DayProgressTimeline {...input} context={{ ...input.context,
      events: [allDayEvent(), dentist], travel: empty, travelStatus: { view: view(empty), message: null, stale: false, pending: false,
        observedAt: "2026-09-16T23:00:00Z", resumesAt: null, refresh: () => undefined,
        tomorrow: { localDate: "2026-09-18", view: view({ ...empty, journeyRef: "tomorrow", legs: [routed] }) } } }} /></RefreshProvider>));
    expect(container.querySelector("[data-departure-line]")).toBeNull();
  });

  it("routes an Outlook event like a Google one: the line, the Mac reminders' trips and its stop (Ticket 283)", async () => {
    // 8 AM on September 16; the Outlook event is 11 AM to noon with a location.
    vi.setSystemTime(new Date("2026-09-16T12:00:00Z"));
    const input = props();
    const planning = { ...outlookEvent(), location: "Main St" };
    const routed: TravelResolvedLegEvidence = { state: "current", reason: null,
      leg: { id: "leg-planning", role: "outbound", journeyRef: "today", originCommitmentRef: null, destinationCommitmentRef: planning.id,
        mode: "walking", readyAt: "2026-09-16T12:00:00Z", provenance: { originRef: "base", originSource: "saved_base", originRevision: "1",
          destinationRef: planning.id, destinationSource: "calendar", destinationRevision: "1", grantRevision: "one" } },
      estimate: { durationSeconds: 1200, departureAt: "2026-09-16T14:30:00Z", arrivalAt: "2026-09-16T14:50:00Z", warnings: [], fallback: false,
        attribution: "Google Maps", observedAt: "2026-09-16T12:00:00Z", expiresAt: "2026-09-16T12:05:00Z" } };
    const evidence = { version: "1.0" as const, journeyRef: "today", legs: [routed], segments: [], occupiedSpans: [], collisions: [], completeTrip: false, finalAvailabilityAt: null };
    const onDeparture = vi.fn();
    await act(() => root.render(<RefreshProvider onRefresh={() => {}}><DayProgressTimeline {...input} context={{ ...input.context,
      events: [allDayEvent(), planning], travel: evidence, onDeparture }} /></RefreshProvider>));
    expect(container.querySelector("[data-departure-line]")?.textContent).toContain("Planning review");
    expect(onDeparture).toHaveBeenLastCalledWith(expect.objectContaining({
      trips: [expect.objectContaining({ destinationRef: planning.id })],
      stops: expect.arrayContaining([expect.objectContaining({ ref: planning.id, label: "Planning review" })]),
    }));
  });

  it("opens a web leave reminder's event drawer once from its trip digest (Ticket 278)", async () => {
    const input = props();
    const dentist = { ...outlookEvent(), id: "event-dentist", providerEventId: "event-dentist", logicalInstanceId: "event-dentist",
      source: "google_calendar" as const, title: "Dentist", location: "Main St" };
    const render = (events: readonly (typeof dentist)[], digest: string | null) => root.render(<RefreshProvider onRefresh={() => {}}>
      <DayProgressTimeline {...input} context={{ ...input.context, events: [allDayEvent(), ...events] }} leaveReminderDigest={digest} /></RefreshProvider>);
    const digest = leaveReminderTripDigest("calendar", "event-dentist", dentist.startAt);
    // The event moved: the digest covers the start, so nothing opens.
    await act(() => render([{ ...dentist, startAt: "2026-09-16T15:30:00Z" }], digest));
    expect(container.querySelector("dialog")?.open).not.toBe(true);
    // Once the Calendar read has the event at the same start, its drawer opens.
    await act(() => render([dentist], digest));
    expect(container.querySelector("dialog")?.open).toBe(true);
    expect(container.querySelector("dialog")?.textContent).toContain("Dentist");
    await act(() => button("Close Calendar details").click());
    await act(() => render([dentist], digest));
    expect(container.querySelector("dialog")?.open).toBe(false);
  });

  it("scrolls to a web leave reminder's Occurrence from its trip digest (Ticket 278)", async () => {
    const scrolled = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value(this: HTMLElement) { scrolled(this.dataset.occurrenceId); } });
    const input = props();
    await act(() => root.render(<RefreshProvider onRefresh={() => {}}><DayProgressTimeline {...input}
      leaveReminderDigest={leaveReminderTripDigest("behavior", "occurrence-1", "2026-09-16T13:00:00Z")} /></RefreshProvider>));
    expect(scrolled).toHaveBeenCalledWith("occurrence-1");
    expect(container.querySelector("dialog")?.open).not.toBe(true);
    delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it("opens details from a focus preview and restores the launcher", async () => {
    const launcher = button("All day: Design offsite");
    await act(() => launcher.focus());
    expect(container.querySelector('[data-calendar-drawer="preview"]')).not.toBeNull();
    expect(document.activeElement).toBe(launcher);
    await act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(container.querySelector('[data-calendar-drawer="preview"]')).toBeNull();
    expect(document.activeElement).toBe(launcher);
    await act(() => launcher.click());
    await act(() => button("View details: Design offsite").click());
    expect(container.querySelector("dialog")?.open).toBe(true);
    expect(container.querySelector("[data-drawer-open]" )).toBeNull();
    await act(() => button("Dismiss all-day event: Design offsite").focus());
    await act(() => button("Dismiss all-day event: Design offsite").click());
    expect(container.querySelector('[data-calendar-drawer="preview"]')).toBeNull();
    expect(document.activeElement).toBe(launcher);
    expect(launcher.textContent).toBe("Restore All Day Events");
    expect(container.querySelector("dialog")?.open).toBe(false);
    await act(() => launcher.click());
    expect(launcher.textContent).toBe("All day: Design offsite");
  });

  it("remeasures scheduling changes even when row geometry stays fixed", async () => {
    const marker = () => container.querySelector("[data-current-time-marker]")!.getAttribute("cy");
    const before = marker();
    const input = props();
    input.timeline.daySections[0]!.occurrences[0]!.scheduledFor = "2026-09-16T15:00:00Z";
    await act(() => root.render(<RefreshProvider onRefresh={() => {}}><DayProgressTimeline {...input} /></RefreshProvider>));
    await act(() => { observers.forEach((callback) => callback()); });
    expect(marker()).not.toBe(before);
  });

  it("remeasures later days when only the first day's height changes", async () => {
    const input = props();
    const first = input.timeline.daySections[0]!;
    input.timeline.daySections.push({ ...first, key: "tomorrow", localDate: "2026-09-17", label: "Thursday, September 17", occurrences: [] });
    let firstHeight = 260;
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (this: HTMLElement) {
      const section = this.closest("section");
      const top = section?.getAttribute("aria-labelledby") === "tomorrow-title" ? firstHeight : 0;
      const isSection = this === section;
      const height = isSection ? (top === 0 ? firstHeight : 260) : 20;
      const y = top + (isSection ? 0 : 60);
      return { top: y, bottom: y + height + 0.001, left: 160, right: 760, width: 600, height, x: 160, y, toJSON() {} };
    });
    observers = [];
    await act(() => root.render(<RefreshProvider onRefresh={() => {}}><DayProgressTimeline {...input} /></RefreshProvider>));
    firstHeight = 320;
    // A single observer callback must refresh the entire range, including moved siblings.
    await act(() => observers[0]!());
    expect(container.querySelectorAll("section[aria-labelledby$='-title']")).toHaveLength(2);
    expect(container.querySelector("[data-current-time-marker]")).not.toBeNull();
  });

  it("labels Outlook markers by source and shows recorded workouts apart from Calendar markers (Ticket 238)", async () => {
    const input = props();
    const recordedActivity = { state: "ready" as const, error: null, day: { localDate: "2026-09-16", state: "current" as const, fetchedAt: "2026-09-16T13:55:00Z",
      items: [{ id: "hevy/workout-1", startAt: "2026-09-16T11:00:00Z", endAt: "2026-09-16T11:45:00Z", durationSeconds: 2700 }] } };
    await act(() => root.render(<RefreshProvider onRefresh={() => {}}><DayProgressTimeline {...input}
      context={{ ...input.context, events: [allDayEvent(), outlookEvent()], recordedActivity, sourceMessages: ["Outlook Calendar context is incomplete; some events may be missing."] }} /></RefreshProvider>));
    await act(async () => { observers.forEach((callback) => callback()); await Promise.resolve(); });
    const marker = container.querySelector<HTMLButtonElement>('[data-calendar-node="outlook_calendar/calendar-1/planning"]');
    expect(marker?.getAttribute("aria-label")).toBe("Preview Outlook Calendar event: Planning review");
    expect(marker?.dataset.eventSource).toBe("outlook_calendar");
    expect(marker?.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("Outlook Calendar context is incomplete; some events may be missing.");
    const activity = container.querySelector('[data-recorded-activity="ready"]');
    expect(activity?.closest("section[aria-labelledby='today-2026-09-16-title']")).not.toBeNull();
    expect(activity?.textContent).toContain("Workout");
    expect(activity?.textContent).toContain("7:00 AM–7:45 AM");
    expect(activity?.textContent).toContain("45 min");
    // A workout is never a Calendar marker, overlap cue, or Occurrence change.
    expect(container.querySelectorAll("[data-calendar-node]")).toHaveLength(1);
    expect(container.querySelector('[data-calendar-node^="hevy/"]')).toBeNull();
    expect(container.querySelector('article[data-occurrence-id="occurrence-1"]')?.textContent).not.toContain("Completed ·");
    expect(action).not.toHaveBeenCalled();
    await act(() => marker!.click());
    await act(() => button("View details: Planning review").click());
    expect(container.querySelector('[data-calendar-drawer="details"]')?.textContent).toContain("Outlook Calendar");
  });

  it("stops the current-time work while hidden and restarts it on visibility", async () => {
    expect(container.querySelector("[data-current-time-marker]")).not.toBeNull();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    await act(() => window.dispatchEvent(new Event("blur")));
    expect(vi.getTimerCount()).toBe(0);
    await act(() => window.dispatchEvent(new Event("focus")));
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    hidden = true;
    await act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(vi.getTimerCount()).toBe(0);
    hidden = false;
    await act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(vi.getTimerCount()).toBeGreaterThan(0);
  });
});

function props() {
  return {
    timeline: timeline(),
    context: {
      events: [allDayEvent()],
      freshness: { state: "current" as const, refreshedAt: "2026-09-16T14:00:00Z", label: "Calendar current", canAssertNoOverlap: true },
    },
    statusAction: action,
    noteAction: action,
    startTimeTrackingAction: action,
    stopTimeTrackingAction: action,
    resetTimeTrackingAction: action,
  };
}

function timeline(): TimelineView {
  return {
    timezone: "America/New_York", todayLocalDate: "2026-09-16", visibleFutureDays: 7, maxFutureDays: 30, nextFutureDays: null,
    needsDecision: { title: "Needs decision", emptyMessage: "No prior unresolved occurrences.", occurrenceCount: 0, daySections: [] },
    daySections: [{
      key: "today-2026-09-16", kind: "today", localDate: "2026-09-16", label: "Wednesday, September 16", relativeLabel: "Today", emptyMessage: "No behaviors today.", unresolvedOccurrenceCount: 1,
      occurrences: [{ id: "occurrence-1", behaviorId: "behavior-1", title: "Morning walk", scheduledFor: "2026-09-16T13:00:00Z", scheduledTimeLabel: "9:00 AM", localDate: "2026-09-16", status: "unresolved", statusMarkedAt: null, statusLabel: "Unresolved", statusDetail: "Awaiting decision", expandedStatusActionLabel: "Set status", visualTone: "default", isVisibleInNeedsDecision: false, canShowDecisionActionsWhenUnresolved: true, showDecisionActions: true, showCollapsedStatusLabel: false, description: "Walk outside.", categoryName: "Health", scheduleSummary: "Daily", note: "", timeTracking: { recordedSeconds: 0, runningStartedAt: null }, canStartTimeTracking: true }],
      occurrenceGroups: [{ key: "occurrence-1", behaviorId: "behavior-1", title: "Morning walk", occurrences: [], isGroupedStack: false }],
    }],
  };
}

function outlookEvent() {
  return { ...allDayEvent(), id: "outlook_calendar/calendar-1/planning", providerEventId: "planning", logicalInstanceId: "outlook_calendar/calendar-1/planning",
    source: "outlook_calendar" as const, calendarName: "Work", title: "Planning review", kind: "timed" as const, startAt: "2026-09-16T15:00:00Z", endAt: "2026-09-16T16:00:00Z",
    endUnspecified: false, duration: { kind: "known" as const, seconds: 3600 }, startLocalDate: undefined, endLocalDate: undefined };
}

function allDayEvent() {
  return {
    id: "event-offsite", providerEventId: "event-offsite", logicalInstanceId: "event-offsite", calendarId: "calendar-1", source: "google_calendar" as const, calendarName: "Work", sourceTimezone: "America/New_York", sourceTimezoneFallback: "none" as const, state: "confirmed" as const, availability: "busy" as const, currentUserResponse: null, revision: { availability: "available" as const, providerUpdatedAt: null, providerEtag: null }, title: "Design offsite", description: "Design review.", location: "Studio", sourceUrl: "https://calendar.google.com/", fieldAvailability: {}, detailCompleteness: {}, organizer: null, attendees: null, attendeesOmitted: false, conference: null, recurrence: null, attachments: null, kind: "all_day" as const, startLocalDate: "2026-09-16", endLocalDate: "2026-09-17", duration: { kind: "calendar_days" as const, days: 1 },
  };
}
