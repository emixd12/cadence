// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RefreshProvider } from "@cadence/ui/runtime";

import { TravelSettingsPanel } from "@/components/settings/TravelSettingsPanel";
import { DayProgressTimeline } from "@/components/timeline/DayProgressTimeline";
import { travelEventRef, type TravelHabitSaveInput } from "@cadence/core/services/travel-habits";
import { travelPlaceKey } from "@cadence/core/services/travel-place-key";
import type { TravelEvidenceResult, TravelHabits, TravelSettings } from "@cadence/core/types/travel";
import { resetTravelHabitMemoryForTest } from "@/lib/ui/travel-habits";
import type { TravelSettingsClient } from "@/lib/ui/travel-settings";
import type { TimelineView } from "@/lib/types/timeline";

const HOME = travelPlaceKey("10 Home Road");
const CALENDAR_PLACE = travelPlaceKey("Clinic, 5 Elm Street");
const NOW = "2026-10-22T15:00:00.000000Z";
const action = vi.fn(async () => ({ status: "idle" as const, message: "" }));
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  resetTravelHabitMemoryForTest();
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function settings(habits: Partial<TravelHabits> = {}): TravelSettings {
  return { enabled: true, baseLocationText: "10 Home Road", mode: "walking", navigationPreference: "google_maps",
    routingConsentAt: "2026-10-01T00:00:00.000000Z", onboardingCompletedAt: null, updatedAt: "2026-10-01T00:00:00.000000Z",
    habits: { preparationMinutes: null, arrivalBufferMinutes: null, placeModes: [], leaveFeedback: [], updatedAt: null, ...habits } };
}

function client(initial: TravelSettings) {
  let current = initial;
  const saveHabits = vi.fn(async (input: TravelHabitSaveInput) => {
    const { planTravelHabitChange } = await import("@cadence/core/services/travel-habits");
    current = { ...current, habits: planTravelHabitChange(current.habits, input, NOW) };
    return current;
  });
  const value: TravelSettingsClient = { load: async () => current, save: async () => current, saveHabits,
    placeLabels: async () => ({ [HOME]: "Home" }) };
  return { value, saveHabits };
}

function select(label: string): HTMLSelectElement {
  const found = container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)
    ?? [...container.querySelectorAll("label")].find((item) => item.textContent?.startsWith(label))?.querySelector("select");
  if (!found) throw new Error(`Missing select: ${label}`);
  return found;
}

async function choose(element: HTMLSelectElement, value: string) {
  await act(async () => { element.value = value; element.dispatchEvent(new Event("change", { bubbles: true })); });
}

function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.trim() === label);
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}

describe("Travel Settings learned habits (Ticket 217)", () => {
  it("shows learned values as editable sentences and saves each change with the habit revision", async () => {
    const travel = client(settings({ placeModes: [
      { placeKey: HOME, mode: "transit" as const, chosenAt: "2026-10-20T12:00:00.000000Z" },
      { placeKey: CALENDAR_PLACE, mode: "driving" as const, chosenAt: "2026-10-21T12:00:00.000000Z" },
    ].sort((a, b) => a.placeKey < b.placeKey ? -1 : 1), updatedAt: "2026-10-21T12:00:00.000000Z" }));
    const changed = vi.fn();
    window.addEventListener("cadence:travel-changed", changed);
    await act(async () => root.render(<TravelSettingsPanel client={travel.value} readLocation={async () => ({ state: "denied" as const })} />));
    await act(async () => { await Promise.resolve(); });

    expect(container.textContent).toContain("How you travel");
    expect(container.textContent).toContain("You usually need");
    expect(container.textContent).toContain("to get ready.");
    expect(select("Get-ready time").value).toBe("10");
    expect(select("Arrival buffer").value).toBe("5");
    expect(container.querySelector('[aria-label="Travel by place"]')?.textContent).toContain("to Home.");
    expect(container.querySelector('[aria-label="Travel by place"]')?.textContent).toContain("a Calendar event location (chosen Oct 21)");
    expect(container.textContent).not.toContain("Clinic");

    await choose(select("Get-ready time"), "15");
    expect(travel.saveHabits).toHaveBeenLastCalledWith({ expectedUpdatedAt: "2026-10-21T12:00:00.000000Z", change: { kind: "preparation", minutes: 15 } });
    expect(container.textContent).toContain("Travel habits saved.");
    expect(changed).toHaveBeenCalled();
    expect(select("Get-ready time").value).toBe("15");

    await choose(select("Get-ready time"), "10");
    expect(travel.saveHabits).toHaveBeenLastCalledWith({ expectedUpdatedAt: NOW, change: { kind: "preparation", minutes: null } });

    await choose(select("Travel to Home"), "");
    expect(travel.saveHabits).toHaveBeenLastCalledWith({ expectedUpdatedAt: NOW, change: { kind: "place_mode", placeKey: HOME, mode: null } });
    expect(container.querySelector('[aria-label="Travel by place"]')?.textContent).not.toContain("Home");
    window.removeEventListener("cadence:travel-changed", changed);
  });

  it("says when a habit could not save", async () => {
    const travel = client(settings());
    const failing: TravelSettingsClient = { ...travel.value, saveHabits: vi.fn(async () => { throw new Error("conflict"); }) };
    await act(async () => root.render(<TravelSettingsPanel client={failing} readLocation={async () => ({ state: "denied" as const })} />));
    await choose(select("Arrival buffer"), "20");
    expect(container.textContent).toContain("Travel habits could not save.");
    expect(container.textContent).toContain("No place has its own travel yet.");
  });
});

describe("Timeline mode choice and leave-time question (Ticket 217)", () => {
  const placeKey = travelPlaceKey("1 Gym Street");
  beforeEach(() => {
    // Day-progress geometry needs measured boxes; jsdom reports none.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const isSection = this === this.closest("section");
      const top = isSection ? 0 : this.tagName === "TIME" ? 96 : 60;
      const height = isSection ? 260 : this.tagName === "TIME" ? 20 : 48;
      return { top, bottom: top + height, left: 160, right: 760, width: this.tagName === "TIME" ? 64 : 600, height, x: 160, y: top, toJSON() {} };
    });
  });
  function evidence(): Omit<TravelEvidenceResult, "modelProjection"> {
    const provenance = { originRef: "device", originSource: "device" as const, originRevision: "r", destinationRef: "occurrence-1",
      destinationSource: "behavior" as const, destinationRevision: "r", grantRevision: "g" };
    return { version: "1.0", journeyRef: "day", completeTrip: false, finalAvailabilityAt: null, collisions: [], occupiedSpans: [],
      segments: [{ id: "commitment:occurrence-1", kind: "commitment", startAt: "2026-09-16T13:00:00Z", endAt: "2026-09-16T13:30:00Z",
        sourceRefs: ["occurrence-1"], legId: null }],
      legs: [{ leg: { id: "leg-1", role: "outbound", journeyRef: "day", originCommitmentRef: null, destinationCommitmentRef: "occurrence-1",
        destinationPlaceKey: placeKey, mode: "walking", readyAt: "2026-09-16T12:00:00Z", provenance }, state: "current", reason: null,
        estimate: { durationSeconds: 900, departureAt: "2026-09-16T12:40:00Z", arrivalAt: "2026-09-16T12:55:00Z", warnings: [], fallback: false,
          attribution: "Google Maps", observedAt: "2026-09-16T12:00:00Z", expiresAt: "2026-09-16T12:05:00Z" } }] };
  }
  async function renderTimeline(travelClient: TravelSettingsClient, now: string) {
    const travel = evidence();
    await act(async () => root.render(<RefreshProvider onRefresh={() => {}}><DayProgressTimeline timeline={timeline()}
      statusAction={action} noteAction={action} startTimeTrackingAction={action} stopTimeTrackingAction={action} resetTimeTrackingAction={action}
      context={{ events: [], now, travel, travelSettingsClient: travelClient, travelMode: "walking",
        freshness: { state: "current", refreshedAt: now, label: "Calendar current", canAssertNoOverlap: true },
        travelStatus: { view: { accountId: "owner", evidence: travel, mode: "walking", navigationPreference: "google_maps", settingsRevision: "r", expiresAt: null },
          message: null, stale: false, pending: false, observedAt: "2026-09-16T12:00:00Z", resumesAt: null, refresh: vi.fn() } }} /></RefreshProvider>));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  }

  it("offers travel for the place in an expanded located Behavior and remembers it", async () => {
    const travel = client(settings());
    await renderTimeline(travel.value, "2026-09-16T12:10:00Z");
    expect(container.querySelector('[aria-label="Leave time question"]')).toBeNull();
    await act(() => container.querySelector<HTMLElement>('article[data-occurrence-id="occurrence-1"] summary')!.click());
    const mode = select("Travel by");
    expect([...mode.options].map((option) => option.textContent)).toEqual(["Usual travel (Walking)", "Walking", "Cycling", "Transit", "Driving"]);
    await choose(mode, "cycling");
    expect(travel.saveHabits).toHaveBeenLastCalledWith({ expectedUpdatedAt: null, change: { kind: "place_mode", placeKey, mode: "cycling" } });
  });

  it("asks once after the journey ends, stores the answer and confirms the new buffer", async () => {
    const travel = client(settings());
    await renderTimeline(travel.value, "2026-09-16T12:10:00Z");
    await renderTimeline(travel.value, "2026-09-16T14:00:00Z");
    const question = container.querySelector('[aria-label="Leave time question"]');
    expect(question?.textContent).toContain("Your leave time for Gym was:");
    await act(async () => button("Too late").click());
    expect(travel.saveHabits).toHaveBeenLastCalledWith({ expectedUpdatedAt: null, change: { kind: "leave_feedback",
      eventRef: travelEventRef("behavior", "occurrence-1"), localDate: "2026-09-16", answer: "too_late" } });
    expect(container.querySelector('[aria-label="Leave time question"]')).toBeNull();
    expect(container.textContent).toContain("Saved. Cadence now plans to arrive 10 minutes early.");
  });

  it("records nothing when dismissed and does not ask again in this visit", async () => {
    const travel = client(settings());
    await renderTimeline(travel.value, "2026-09-16T12:10:00Z");
    await renderTimeline(travel.value, "2026-09-16T14:00:00Z");
    await act(async () => button("Not now").click());
    expect(container.querySelector('[aria-label="Leave time question"]')).toBeNull();
    await renderTimeline(travel.value, "2026-09-16T15:00:00Z");
    expect(container.querySelector('[aria-label="Leave time question"]')).toBeNull();
    expect(travel.saveHabits).not.toHaveBeenCalled();
  });

  it("does not ask when today was already answered", async () => {
    const travel = client(settings({ updatedAt: "2026-09-16T10:00:00.000000Z", leaveFeedback: [{ eventRef: "a".repeat(64),
      localDate: "2026-09-16", answer: "about_right", answeredAt: "2026-09-16T10:00:00.000000Z", rulesVersion: "travel-habit-defaults@1" }] }));
    await renderTimeline(travel.value, "2026-09-16T12:10:00Z");
    await renderTimeline(travel.value, "2026-09-16T14:00:00Z");
    expect(container.querySelector('[aria-label="Leave time question"]')).toBeNull();
  });
});

function timeline(): TimelineView {
  return {
    timezone: "America/New_York", todayLocalDate: "2026-09-16", visibleFutureDays: 7, maxFutureDays: 30, nextFutureDays: null,
    needsDecision: { title: "Needs decision", emptyMessage: "No prior unresolved occurrences.", occurrenceCount: 0, daySections: [] },
    daySections: [{
      key: "today-2026-09-16", kind: "today", localDate: "2026-09-16", label: "Wednesday, September 16", relativeLabel: "Today", emptyMessage: "No behaviors today.", unresolvedOccurrenceCount: 1,
      occurrences: [{ id: "occurrence-1", behaviorId: "behavior-1", title: "Gym", scheduledFor: "2026-09-16T13:00:00Z", scheduledTimeLabel: "9:00 AM", localDate: "2026-09-16", status: "unresolved", statusMarkedAt: null, statusLabel: "Unresolved", statusDetail: "Awaiting decision", expandedStatusActionLabel: "Set status", visualTone: "default", isVisibleInNeedsDecision: false, canShowDecisionActionsWhenUnresolved: true, showDecisionActions: true, showCollapsedStatusLabel: false, description: "", categoryName: "Health", scheduleSummary: "Daily", note: "", timeTracking: { recordedSeconds: 0, runningStartedAt: null }, canStartTimeTracking: true }],
      occurrenceGroups: [{ key: "occurrence-1", behaviorId: "behavior-1", title: "Gym", occurrences: [], isGroupedStack: false }],
    }],
  };
}
