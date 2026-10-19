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
import type { TimelineView } from "@/lib/types/timeline";

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
    expect(timing?.textContent).toContain("Outbound");
    expect(timing?.textContent).toContain("Return to saved base");
    expect(timing?.textContent).toContain("Available again");
    expect(timing?.textContent).toContain("Google Maps");
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

  it("labels Outlook markers by source and shows recorded workouts apart from Calendar markers (Ticket 225)", async () => {
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
