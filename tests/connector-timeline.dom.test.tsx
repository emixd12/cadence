// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RefreshProvider } from "@cadence/ui/runtime";

import { validateVersionedExternalEventSnapshot } from "@cadence/core/services/external-event-validation";
import { DayProgressTimeline } from "@/components/timeline/DayProgressTimeline";
import { reloadWebTimelineConnectors } from "@/lib/ui/timeline-connector-reloads";
import type { TimelineView } from "@/lib/types/timeline";
import outlookFixture from "./fixtures/external-event-snapshot.outlook.valid.json";

// Ticket 238: live web Timeline with Google disconnected, Outlook connected, and
// Hevy failing. Each source fails or succeeds on its own and tracking is untouched.

const action = vi.fn(async () => ({ status: "idle" as const, message: "" }));
let container: HTMLDivElement;
let root: Root;
let observers: (() => void)[];
let routes: Record<string, () => Response>;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const connector = (provider: string, accountId = "account-live") => ({ accountId, provider, status: "connected", generation: 2, selectionRevision: 1,
  preferences: { selectedSourceIds: ["calendar-1"], hiddenSourceIds: [], visible: true, showAllDay: true } });

function outlookToday() {
  const event = outlookFixture.events[0]!;
  const snapshot = { ...outlookFixture, accountId: "account-live", fetchedAt: "2026-09-16T13:55:00Z",
    freshness: { ...outlookFixture.freshness, refreshedAt: "2026-09-16T13:55:00Z" },
    requestedRange: { ...outlookFixture.requestedRange, startLocalDate: "2026-09-16", endLocalDate: "2026-09-16" },
    coverage: [{ ...outlookFixture.coverage[0]!, startLocalDate: "2026-09-16", endLocalDate: "2026-09-16", itemCount: 1 }],
    events: [{ ...event, title: "Planning review", startAt: "2026-09-16T15:00:00Z", endAt: "2026-09-16T16:00:00Z", duration: { kind: "known", seconds: 3600 } }] };
  validateVersionedExternalEventSnapshot(snapshot);
  return snapshot;
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-16T14:00:00Z"));
  observers = [];
  vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { observers.push(callback); } observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const isSection = this === this.closest("section");
    const isTime = this.tagName === "TIME";
    const top = isSection ? 0 : isTime ? 96 : 60;
    const height = isSection ? 260 : isTime ? 20 : 48;
    return { top, bottom: top + height, left: 160, right: 760, width: isTime ? 64 : 600, height, x: 160, y: top, toJSON() {} };
  });
  routes = {
    "/api/google-calendar/connection": () => json({ accountId: "account-live", status: "disconnected", generation: 0, selectionRevision: 0,
      preferences: { selectedCalendarIds: [], hiddenCalendarIds: [], visible: true, showAllDay: true } }),
    "/api/outlook-calendar/connection": () => json(connector("outlook_calendar")),
    "/api/outlook-calendar/events": () => json(outlookToday()),
    "/api/icloud-calendar/connection": () => json({ ...connector("icloud_calendar"), status: "disconnected" }),
    "/api/hevy/connection": () => json(connector("hevy")),
    "/api/hevy/activities": () => json({ error: "timeout" }, 504),
  };
  vi.stubGlobal("fetch", vi.fn(async (input: string) => (routes[input.split("?")[0]!] ?? (() => json({ error: "not_found" }, 404)))()));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function render(view: TimelineView = timeline()) {
  await act(() => root.render(<RefreshProvider onRefresh={() => {}}><DayProgressTimeline timeline={view} liveCalendar
    statusAction={action} noteAction={action} startTimeTrackingAction={action} stopTimeTrackingAction={action} resetTimeTrackingAction={action} /></RefreshProvider>));
  await act(async () => { observers.forEach((callback) => callback()); await Promise.resolve(); });
}

describe("live connector Timeline", () => {
  it("shows Outlook events while a Hevy failure stays in its own line", async () => {
    await render();
    await vi.waitFor(() => expect(container.querySelector('[data-calendar-node="outlook_calendar/calendar-1/timed-1"]')).not.toBeNull());
    await act(async () => { observers.forEach((callback) => callback()); await Promise.resolve(); });
    await vi.waitFor(() => expect(container.textContent).toContain("Hevy workouts could not refresh: timeout."));
    expect(container.querySelector('[data-calendar-node="outlook_calendar/calendar-1/timed-1"]')?.getAttribute("aria-label")).toBe("Preview Outlook Calendar event: Planning review");
    // Google is unused here, so its "not connected" line does not crowd the Timeline.
    expect(container.textContent).not.toContain("Calendar is not connected.");
    expect(container.querySelector('article[data-occurrence-id="occurrence-1"]')).not.toBeNull();
    expect(action).not.toHaveBeenCalled();
    // One failing source makes the manual reload report not current; the others still reload.
    await expect(reloadWebTimelineConnectors()).resolves.toBe(false);
  });

  it("drops Outlook context and keeps Hevy when Outlook needs reconnection", async () => {
    routes["/api/outlook-calendar/connection"] = () => json({ ...connector("outlook_calendar"), status: "reconnect_required" });
    routes["/api/hevy/activities"] = () => json({ error: "permission_denied" }, 403);
    await render();
    await vi.waitFor(() => expect(container.textContent).toContain("Outlook Calendar needs reconnection in Settings."));
    expect(container.querySelector("[data-calendar-node]")).toBeNull();
    await vi.waitFor(() => expect(container.textContent).toContain("Hevy workouts could not refresh: permission_denied."));
  });
});

const googleConnection = (status: string) => () => json({ accountId: "account-live", status, generation: 1, selectionRevision: 0,
  preferences: { selectedCalendarIds: ["primary"], hiddenCalendarIds: [], visible: true, showAllDay: true } });

describe("Google source state with Outlook ready (Ticket 238 re-review)", () => {
  const withEstimate = (): TimelineView => ({ ...timeline(), durationEstimates: { "behavior-1": { kind: "known", seconds: 1800, durationLabel: "30 minutes", sampleCount: 0, lookbackDays: 90, provenance: "behavior_default" } } });
  it.each([
    ["disconnected", true, googleConnection("disconnected")],
    ["not configured", true, googleConnection("not_configured")],
    ["reconnect required", false, googleConnection("reconnect_required")],
    ["provider unavailable status", false, googleConnection("unavailable")],
    ["failed status read", false, () => json({ error: "provider_unavailable" }, 503)],
  ] as const)("Google %s: no-overlap claim allowed = %s", async (_label, canAssert, google) => {
    routes["/api/google-calendar/connection"] = google;
    await render(withEstimate());
    await vi.waitFor(() => expect(container.querySelector('[data-calendar-node="outlook_calendar/calendar-1/timed-1"]')).not.toBeNull());
    await act(async () => { observers.forEach((callback) => callback()); await Promise.resolve(); });
    if (canAssert) await vi.waitFor(() => expect(container.textContent).toContain("No timed overlap"));
    else {
      await vi.waitFor(() => expect(container.querySelector("[data-calendar-state]")?.getAttribute("data-calendar-state")).toMatch(/disconnected|error/));
      expect(container.textContent).not.toContain("No timed overlap");
    }
  });
});

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


it("renders the same event from iCloud and Outlook separately and withdraws denied iCloud context", async () => {
  const outlook = outlookToday();
  const icloud = { ...outlook, source: "icloud_calendar", adapterVersion: "icloud-calendar-v1",
    events: outlook.events.map(event => ({ ...event, source: "icloud_calendar", id: event.id.replace("outlook_calendar", "icloud_calendar"),
      logicalInstanceId: event.logicalInstanceId.replace("outlook_calendar", "icloud_calendar"), state: "confirmed", sourceUrl: null, currentUserResponse: null, fieldAvailability: { ...event.fieldAvailability, source_url: "unsupported" } })) };
  validateVersionedExternalEventSnapshot(icloud);
  routes["/api/icloud-calendar/connection"] = () => json(connector("icloud_calendar"));
  routes["/api/icloud-calendar/events"] = () => json(icloud);
  await render();
  await vi.waitFor(() => expect(container.querySelector('[data-event-source="mixed"]')).not.toBeNull());
  const grouped = container.querySelector<HTMLButtonElement>('[data-event-source="mixed"]')!;
  expect(grouped.getAttribute("aria-label")).toBe("Preview 2 Calendar events starting at the same time");
  await act(() => grouped.click());
  expect(container.querySelectorAll('[data-calendar-drawer="preview"] article')).toHaveLength(2);
  expect(container.querySelectorAll('[data-calendar-drawer="preview"] h3')[0]?.textContent).toBe("Planning review");
  expect(container.querySelectorAll('[data-calendar-drawer="preview"] h3')[1]?.textContent).toBe("Planning review");
  routes["/api/icloud-calendar/events"] = () => json({ error: "permission_denied" }, 403);
  await act(async () => { await reloadWebTimelineConnectors(); });
  expect(container.querySelector('[data-calendar-node="icloud_calendar/calendar-1/timed-1"]')).toBeNull();
  expect(container.querySelector('[data-calendar-node="outlook_calendar/calendar-1/timed-1"]')).not.toBeNull();
  expect(action).not.toHaveBeenCalled();
});
