// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import { RefreshProvider } from "@cadence/ui/runtime";
import { resolveTimeline } from "@cadence/core/resolvers/timeline.resolver";
import { firstLocatedStopAhead } from "@cadence/core/services/departure-stops";
import type { NormalizedExternalEvent } from "@cadence/core/types/day-progress";
import type { DepartureTrip } from "@cadence/core/types/departure";
import type { TravelSettings } from "@cadence/core/types/travel";
import { DepartureStatesBench } from "@/app/design-system/DepartureStatesBench";
import { DayProgressTimeline } from "@/components/timeline/DayProgressTimeline";
import { TravelStepText, type TravelStepActions } from "@/components/timeline/TravelNextStep";

/**
 * Ticket 273: every missing estimate says why in one sentence and offers one action. The bench
 * wires the real Timeline, drawer and dialog (Home, Gym 10–11 AM, Dentist 2–3 PM); no provider
 * call runs.
 */

let container: HTMLDivElement;
let root: Root;
const originalDialog = Object.fromEntries(["showModal", "close"].map((name) => [name, Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name)]));
const originalPopover = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "showPopover");

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const section = this.closest("section");
    const isSection = this === section;
    const isTime = this.tagName === "TIME";
    const top = isSection ? 0 : isTime ? 96 : 60;
    const height = isSection ? 260 : isTime ? 20 : 48;
    return { top, bottom: top + height, left: 160, right: 760, width: isTime ? 64 : 600, height, x: 160, y: top, toJSON() {} };
  });
  Object.defineProperty(HTMLElement.prototype, "showPopover", { configurable: true, value() { this.setAttribute("data-test-popover-open", "true"); } });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value(this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value(this: HTMLDialogElement) { this.open = false; } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const [name, descriptor] of Object.entries(originalDialog)) {
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  }
  if (originalPopover) Object.defineProperty(HTMLElement.prototype, "showPopover", originalPopover);
  else delete (HTMLElement.prototype as Partial<HTMLElement>).showPopover;
});

async function flush() {
  for (let step = 0; step < 4; step++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

describe("on the bench", () => {
  async function render(stateId: string) {
    await act(() => root.render(<RefreshProvider onRefresh={() => {}}><DepartureStatesBench initialStateId={stateId} /></RefreshProvider>));
  }
  const surface = (label: string) => container.querySelector(`section[aria-label="${label}"]`)!;
  const line = () => surface("Timeline").querySelector<HTMLElement>("[data-departure-line]");
  const buttonIn = (scope: Element, text: string) => [...scope.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === text);
  const click = (button: HTMLElement | undefined | null) => act(async () => { button!.click(); });

  it("names the event and makes Add a place its action, opening the trip correction at the destination", async () => {
    await render("needs-place");
    expect(line()?.textContent).toBe("Add a place for Dentist to get a leave time.");
    const action = line()!.querySelector<HTMLButtonElement>("[data-travel-step-action]")!;
    expect(action.textContent).toBe("Add a place for Dentist");
    expect(line()!.querySelectorAll("button, a")).toHaveLength(1);
    await click(action);
    const dialog = surface("Timeline").querySelector<HTMLDialogElement>('dialog[data-calendar-drawer="details"]')!;
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector<HTMLDetailsElement>("[data-travel-correction]")?.open).toBe(true);
    expect(document.activeElement).toBe(dialog.querySelector('input[name="travel_location"]'));
    // The drawer and the dialog beside the bench say the same sentence with the same one action.
    for (const label of ["Dentist drawer", "Dentist Calendar details"]) {
      const step = surface(label).querySelector("[data-travel-step='needs_place']");
      expect(step?.textContent, label).toBe("Add a place for Dentist to get a leave time.");
      expect(step?.querySelectorAll("button, a"), label).toHaveLength(1);
    }
    await click(surface("Dentist Calendar details").querySelector<HTMLButtonElement>("[data-travel-step-action]"));
    expect(surface("Dentist Calendar details").querySelector<HTMLDetailsElement>("[data-travel-correction]")?.open).toBe(true);
  });

  it("asks In person or Remote in one tap, and Remote ends the question", async () => {
    await render("needs-attendance");
    expect(line()?.textContent).toBe("Is Dentist in person or remote? In person · Remote");
    expect([...line()!.querySelectorAll("button")].map((button) => button.textContent)).toEqual(["In person", "Remote"]);
    const step = surface("Dentist Calendar details").querySelector("[data-travel-step='needs_attendance']")!;
    expect([...step.querySelectorAll("button")].map((button) => button.textContent)).toEqual(["In person", "Remote"]);
    const remote = buttonIn(line()!, "Remote")!;
    remote.focus();
    await click(remote);
    expect(container.querySelector("[data-departure-model-state]")?.getAttribute("data-departure-model-state")).not.toBe("needs_attendance");
    for (const label of ["Timeline", "Dentist drawer", "Dentist Calendar details"]) expect(surface(label).textContent, label).not.toContain("Is Dentist in person or remote?");
    // Focus stays in the travel status, not on the page body.
    expect(document.activeElement?.closest("[data-travel-status]")).not.toBeNull();
  });

  it("answers In person from the line, so Dentist is routed for this trip", async () => {
    await render("needs-attendance");
    await click(buttonIn(line()!, "In person"));
    expect(container.querySelector("[data-departure-model-state]")?.getAttribute("data-departure-model-state")).not.toMatch(/^needs_/);
    for (const label of ["Timeline", "Dentist drawer", "Dentist Calendar details"]) expect(surface(label).textContent, label).not.toContain("Is Dentist in person or remote?");
  });

  it("names the blocking event and sends the action there", async () => {
    await render("needs-origin");
    expect(line()?.textContent).toBe("Fix Gym's place or attendance to get a leave time for Dentist.");
    const action = line()!.querySelector<HTMLButtonElement>("[data-travel-step-action]")!;
    expect(action.textContent).toBe("Fix Gym's place or attendance");
    await click(action);
    expect(container.querySelector("[data-bench-step-note]")?.textContent).toBe("Opens Behaviors, where Gym's place is changed.");
  });

  it("offers Travel estimates once, linking to Settings without turning anything on", async () => {
    await render("fresh");
    const offer = surface("Travel estimates off").querySelector("[data-travel-offer]")!;
    expect(offer.textContent).toBe("Turn on Travel estimates in Settings to get a leave time for Dentist. Not now");
    await click(offer.querySelector<HTMLButtonElement>("[data-travel-step-action]"));
    expect(container.querySelector("[data-bench-step-note]")?.textContent).toBe("Opens Travel settings: Home and device location.");
  });
});

describe("step links", () => {
  const trip = (overrides: Partial<DepartureTrip>): DepartureTrip => ({ key: "k", legId: null, role: "outbound", originRef: null, destinationRef: "gym",
    mode: null, fromHome: false, state: "needs_origin", lateBasis: null, freshness: null, checkedAt: null, leaveAt: null, arriveAt: null, getReadyAt: null,
    minutesUntilLeave: null, appearsAt: null, timeUnknownCause: null, blockingRef: null, blockingLabel: null, action: null, phrase: "", linePhrase: "", ...overrides });
  const none: TravelStepActions = { correction: () => null, attendance: () => null, behavior: () => null, settings: null };

  it("links Add Home in Settings to Travel settings, where Home and device location live", async () => {
    await act(() => root.render(<p><TravelStepText trip={trip({})} text="Add Home in Settings to get a leave time for Gym." actions={{ ...none, settings: { href: "/settings#travel" } }} /></p>));
    const link = container.querySelector<HTMLAnchorElement>("a[data-travel-step-action]")!;
    expect(link.getAttribute("href")).toBe("/settings#travel");
    expect(link.textContent).toBe("Add Home in Settings");
    expect(container.textContent).toBe("Add Home in Settings to get a leave time for Gym.");
  });

  it("links a Behavior's place to Behaviors and shows the sentence alone without an action", async () => {
    const text = "Add a place for Gym to get a leave time.";
    await act(() => root.render(<p><TravelStepText trip={trip({ state: "needs_place" })} text={text} actions={{ ...none, behavior: (ref) => ref === "gym" ? { href: "/behaviors?behavior=b1" } : null }} /></p>));
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/behaviors?behavior=b1");
    await act(() => root.render(<p><TravelStepText trip={trip({ state: "needs_place" })} text={text} actions={none} /></p>));
    expect(container.querySelector("a, button")).toBeNull();
    expect(container.textContent).toBe(text);
  });

  it("uses the departure model's blocking stop, not the trip's own origin", async () => {
    const correction = vi.fn();
    await act(() => root.render(<p><TravelStepText trip={trip({ blockingRef: "lunch", blockingLabel: "Lunch" })}
      text="Fix Lunch's place or attendance to get a leave time for Gym." actions={{ ...none, correction: (ref) => ref === "lunch" ? correction : null }} /></p>));
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    expect(correction).toHaveBeenCalledOnce();
  });
});

describe("Travel estimates off on the Timeline", () => {
  const TZ = "America/New_York";
  const DATE = "2026-11-10";
  const at = (time: string) => Temporal.PlainDate.from(DATE).toZonedDateTime({ timeZone: TZ, plainTime: Temporal.PlainTime.from(time) }).toInstant().toString();
  const timeline = resolveTimeline({ timezone: TZ, now: Temporal.Instant.from(at("06:00")), futureDays: 0, occurrences: [] });
  const dentist = (location: string): NormalizedExternalEvent => ({
    kind: "timed", id: "google_calendar/test/dentist", providerEventId: "dentist", logicalInstanceId: "dentist", calendarId: "test", source: "google_calendar",
    calendarName: "Personal", sourceTimezone: TZ, sourceTimezoneFallback: "none", state: "confirmed", availability: "busy", currentUserResponse: "accepted",
    revision: { availability: "available", providerUpdatedAt: "2026-11-09T12:00:00Z", providerEtag: "etag" }, title: "Dentist", description: "",
    location, sourceUrl: null, fieldAvailability: {}, detailCompleteness: {}, organizer: null, attendees: null, attendeesOmitted: false, conference: null,
    recurrence: null, attachments: null, startAt: at("14:00"), endAt: at("15:00"), endUnspecified: false, duration: { kind: "known", seconds: 3600 },
  });
  const settings = (enabled: boolean): TravelSettings => ({ enabled, baseLocationText: null, mode: "walking", navigationPreference: null,
    routingConsentAt: enabled ? "2026-11-01T00:00:00Z" : null, onboardingCompletedAt: null, updatedAt: "2026-11-01T00:00:00Z" });
  const idle = async () => ({ status: "idle" as const, message: "" });

  async function render(options: Readonly<{ enabled: boolean; location?: string; openTravelSettings?: () => void }>) {
    const load = vi.fn(async () => settings(options.enabled));
    const save = vi.fn(async () => settings(true));
    await act(() => root.render(<RefreshProvider onRefresh={() => {}}><DayProgressTimeline timeline={timeline}
      context={{ events: [dentist(options.location ?? "1 Example Street")], now: at("09:00"), travelSettingsClient: { load, save },
        freshness: { state: "current", refreshedAt: at("09:00"), label: "Calendar current", canAssertNoOverlap: true },
        openTravelSettings: options.openTravelSettings }}
      statusAction={idle} noteAction={idle} startTimeTrackingAction={idle} stopTimeTrackingAction={idle} resetTimeTrackingAction={idle} /></RefreshProvider>));
    await flush();
    return { load, save };
  }
  const offer = () => container.querySelector("[data-travel-offer]");

  it("offers one dismissible line that opens Travel settings and never saves consent", async () => {
    const open = vi.fn();
    const { save } = await render({ enabled: false, openTravelSettings: open });
    expect(offer()?.textContent).toBe("Turn on Travel estimates in Settings to get a leave time for Dentist. Not now");
    await act(async () => offer()!.querySelector<HTMLButtonElement>("[data-travel-step-action]")!.click());
    expect(open).toHaveBeenCalledOnce();
    expect(save).not.toHaveBeenCalled();
    await act(async () => [...offer()!.querySelectorAll("button")].find((button) => button.textContent === "Not now")!.click());
    expect(offer()).toBeNull();
    // Dismissed on this device. Only a flag is stored, never the event.
    expect(Object.values({ ...localStorage }).join(" ")).not.toContain("Dentist");
    await act(() => root.unmount());
    root = createRoot(container);
    await render({ enabled: false, openTravelSettings: open });
    expect(offer()).toBeNull();
  });

  it("says nothing while Travel estimates is on, without a located event, or with nowhere to open", async () => {
    await render({ enabled: true, openTravelSettings: vi.fn() });
    expect(offer()).toBeNull();
    const unlocated = await render({ enabled: false, location: "", openTravelSettings: vi.fn() });
    expect(offer()).toBeNull();
    expect(unlocated.load).not.toHaveBeenCalled();
    // The Mac app passes no opener in local mode, where estimates need a linked account.
    const local = await render({ enabled: false });
    expect(offer()).toBeNull();
    expect(local.load).not.toHaveBeenCalled();
  });
});

describe("first located stop ahead", () => {
  it("picks the earliest located Calendar event or Behavior still ahead", () => {
    const base = { kind: "timed", state: "confirmed", currentUserResponse: "accepted", title: "Call", location: "", startAt: "2026-11-10T15:00:00Z" } as const;
    const events = [
      { ...base, id: "call" },
      { ...base, id: "past", location: "Somewhere", startAt: "2026-11-10T13:00:00Z" },
      { ...base, id: "declined", location: "Somewhere", currentUserResponse: "declined", startAt: "2026-11-10T14:10:00Z" },
      { ...base, id: "dentist", title: "Dentist", location: "Office", startAt: "2026-11-10T16:00:00Z" },
      // Tomorrow in New York: the Timeline reads later days, but the offer is for today only.
      { ...base, id: "tomorrow", title: "Tomorrow", location: "Office", startAt: "2026-11-11T06:00:00Z" },
    ] as unknown as NormalizedExternalEvent[];
    const day = { localDate: "2026-11-10", timezone: "America/New_York" };
    const occurrences = [
      { id: "done", title: "Run", scheduledFor: "2026-11-10T14:20:00Z", status: "completed", placeText: "Park" },
      { id: "gym", title: "Gym", scheduledFor: "2026-11-10T15:30:00Z", status: "unresolved", placeText: "Gym" },
    ];
    expect(firstLocatedStopAhead({ events, occurrences, now: "2026-11-10T14:00:00Z", ...day })).toEqual({ ref: "gym", label: "Gym" });
    expect(firstLocatedStopAhead({ events, occurrences: [], now: "2026-11-10T14:00:00Z", ...day })).toEqual({ ref: "dentist", label: "Dentist" });
    expect(firstLocatedStopAhead({ events, occurrences, now: "2026-11-10T17:00:00Z", ...day })).toBeNull();
  });
});
