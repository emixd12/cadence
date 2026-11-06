// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RefreshProvider } from "@cadence/ui/runtime";
import type { DepartureModel, DepartureTrip } from "@cadence/core/types/departure";
import { TravelStatusLine } from "@/components/timeline/DayProgressTimeline";
import type { TravelState } from "@/lib/ui/travel";
import { DepartureStatesBench } from "@/app/design-system/DepartureStatesBench";


let container: HTMLDivElement;
let root: Root;
const originalDialog = Object.fromEntries(["showModal", "close"].map((name) => [name, Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name)]));
const originalPopover = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "showPopover");

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
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

/**
 * Ticket 269: the next-departure line through one whole day on the bench (Home, Gym 10–11 AM,
 * Dentist 2–3 PM), on a moving clock. The bench routes with the real plan, window and 5-minute
 * expiry; its Refresh travel re-checks routes at the bench clock. No provider call runs.
 */

async function render(stateId: string) {
  await act(() => root.render(<RefreshProvider onRefresh={() => {}}><DepartureStatesBench initialStateId={stateId} /></RefreshProvider>));
}
async function moveClock(minutes: number) {
  const slider = container.querySelector<HTMLInputElement>("#departure-bench-clock")!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => { setter.call(slider, String(minutes)); slider.dispatchEvent(new Event("input", { bubbles: true })); });
}
const timeline = () => container.querySelector('section[aria-label="Timeline"]')!;
const line = () => timeline().querySelector<HTMLElement>("[data-departure-line]");
const note = () => timeline().querySelector("[data-travel-note]");
const announced = () => container.querySelector('[data-departure-announcement][role="status"][aria-live="polite"]')?.textContent ?? null;
const refreshButtons = () => [...timeline().querySelectorAll<HTMLButtonElement>("[data-travel-status] button")].filter((button) => button.textContent === "Refresh travel");
const clock = (minutes: number) => `${Math.floor(minutes / 60) % 12 || 12}:${String(minutes % 60).padStart(2, "0")} ${minutes < 720 ? "AM" : "PM"}`;

type Button = "none" | "lead" | "end";
type Expected = Readonly<{ text: string | null; button: Button }>;

/** Asserts the whole visible travel text: one line, the button where R1 puts it, and no note. */
function expectLine(expected: Expected, at: string) {
  if (expected.text === null) {
    expect(line(), at).toBeNull();
    expect(note(), at).toBeNull();
    expect(refreshButtons(), at).toHaveLength(0);
    return;
  }
  const shown = line();
  expect(shown, at).not.toBeNull();
  const words = expected.button === "end" ? `${expected.text} Refresh travel` : expected.text;
  expect(shown!.textContent, at).toBe(words);
  expect(shown!.textContent, at).not.toContain("Travel as of");
  expect(note(), at).toBeNull();
  const buttons = refreshButtons();
  expect(buttons, at).toHaveLength(expected.button === "none" ? 0 : 1);
  if (expected.button === "lead") expect(shown!.firstChild, at).toBe(buttons[0]);
  if (expected.button === "end") expect(shown!.lastChild, at).toBe(buttons[0]);
}

const lastEstimate = (text: string, checked: string): Expected => ({ text: `Last estimate: ${text} · checked ${checked}.`, button: "end" });

/** What the line says at a bench minute, before any refresh at that minute. */
function mainWalk(m: number): Expected {
  if (m < 415) return { text: "The leave time for Gym appears by 6:55 AM.", button: "none" };
  if (m === 415) return { text: "Refresh travel to get the leave time for Gym.", button: "lead" };
  if (m <= 550) return lastEstimate("leave by 9:35 AM for Gym", "6:55 AM");
  if (m < 555) return { text: `Leave in ${575 - m} minutes, by 9:35 AM for Gym from Home · walking, arrive 9:55 AM.`, button: "none" };
  if (m < 575) return lastEstimate("leave by 9:35 AM for Gym", "9:10 AM");
  if (m === 575) return lastEstimate("leave now for Gym", "9:10 AM");
  // Late from the clock: the route was on time, but 5 minutes have passed since the leave time.
  if (m <= 585) return lastEstimate(`if you haven't left for Gym yet, you'd arrive about ${clock(m + 20)}`, "9:35 AM");
  if (m <= 600) return lastEstimate(`if you haven't left for Gym yet, you'd arrive about ${clock(m + 20)}`, "9:45 AM");
  if (m < 660) return lastEstimate("leave by 1:20 PM for Dentist", "9:45 AM");
  // Gym was marked Completed at 10:57, after the check, so the trip from Gym no longer holds.
  if (m === 660) return { text: "The trip to Dentist changed.", button: "end" };
  if (m < 800) return lastEstimate("leave by 1:20 PM for Dentist", "11:00 AM");
  if (m === 800) return lastEstimate("leave now for Dentist", "11:00 AM");
  if (m < 840) return lastEstimate(`if you haven't left for Dentist yet, you'd arrive about ${clock(m + 35)}`, "11:00 AM");
  if (m <= 855) return { text: "Refresh travel to get the leave time for the trip home.", button: "lead" };
  if (m < 900) return lastEstimate("head home 3:00 PM", "2:15 PM");
  if (m === 900) return lastEstimate("head home now", "2:15 PM");
  if (m < 930) return lastEstimate(`if you haven't left yet, you'd be home about ${clock(m + 30)}`, "2:15 PM");
  // Home by 3:30 PM: no trips are left, so no travel text.
  return { text: null, button: "none" };
}

/** The user presses Refresh travel at these minutes; the line then shows a current estimate. */
const REFRESHES: ReadonlyMap<number, Expected> = new Map([
  [415, { text: "Leave by 9:35 AM for Gym from Home · walking, arrive 9:55 AM.", button: "none" }],
  [550, { text: "Leave in 25 minutes, by 9:35 AM for Gym from Home · walking, arrive 9:55 AM.", button: "none" }],
  [575, { text: "Leave now for Gym from Home · walking, arrive 9:55 AM.", button: "none" }],
  // Late from the route itself, checked after the leave time.
  [585, { text: "You may arrive late at Gym: arrive 10:05 AM.", button: "none" }],
  [660, { text: "Leave by 1:20 PM for Dentist from Home · walking, arrive 1:55 PM.", button: "none" }],
  // Dentist is under way: the next trip is the trip home.
  [855, { text: "Head home 3:00 PM · walking, home by 3:30 PM.", button: "none" }],
]);

function walkMinutes(from: number, extra: readonly number[] = []): number[] {
  const steps: number[] = [];
  for (let m = from; m <= 18 * 60; m += 5) steps.push(m);
  return [...steps, ...extra].sort((a, b) => a - b);
}

it("walks one day from first open to after the last event with a correct line at every step", async () => {
  // Gym is marked Completed at 10:57 in this preset. Moving the clock back re-checks routes at first open.
  await render("trip-changed");
  await moveClock(6 * 60);
  const seen = new Set<string>();
  for (const m of walkMinutes(6 * 60, [551, 552, 553, 554])) {
    await moveClock(m);
    const at = clock(m);
    expectLine(mainWalk(m), at);
    seen.add(line()?.getAttribute("data-departure-line") ?? "none");
    const after = REFRESHES.get(m);
    if (after) {
      await act(async () => refreshButtons()[0]!.click());
      expectLine(after, `${at}, after Refresh travel`);
      seen.add(line()!.getAttribute("data-departure-line")!);
    }
    // A trip with a time carries the magenta rule; a step without a time does not.
    const state = line()?.getAttribute("data-departure-line");
    if (state) expect(line()!.hasAttribute("data-departure-timed"), at).toBe(["upcoming", "soon", "leave_now", "late", "head_home"].includes(state));
  }
  expect([...seen].sort()).toEqual(["appears_later", "head_home", "late", "leave_now", "none", "soon", "trip_changed", "upcoming"]);
}, 20_000);

it("keeps the screen-reader region silent on a countdown minute and speaks on a state change", async () => {
  await render("trip-changed");
  await moveClock(6 * 60);
  for (const m of walkMinutes(6 * 60).filter((step) => step <= 545)) {
    await moveClock(m);
    if (m === 415) await act(async () => refreshButtons()[0]!.click());
  }
  // 9:05 AM: the trip to Gym became soon, so the region spoke once.
  expect(announced()).toBe("Last estimate: leave by 9:35 AM for Gym · checked 6:55 AM.");
  await moveClock(550);
  const button = refreshButtons()[0]!;
  button.focus();
  await act(async () => button.click());
  // The refresh replaced the last estimate, so the region speaks the fresh line (verifier R1).
  const fresh = "Leave in 25 minutes, by 9:35 AM for Gym from Home · walking, arrive 9:55 AM.";
  expect(announced()).toBe(fresh);
  // The button is gone; focus moves to the line instead of the page.
  expect(refreshButtons()).toHaveLength(0);
  expect(document.activeElement).toBe(line());
  for (const m of [551, 552, 553, 554]) {
    await moveClock(m);
    expect(line()!.textContent).toContain(`Leave in ${575 - m} minutes`);
    // A countdown minute stays silent.
    expect(announced(), clock(m)).toBe(fresh);
  }
  await moveClock(575);
  expect(announced()).toBe("Last estimate: leave now for Gym · checked 9:10 AM.");
  await moveClock(18 * 60);
  expect(announced()).toBe("");
});

it("puts the paused phrase beside every known time, and alone once only waiting trips remain (D11)", async () => {
  await render("paused");
  // Routes were checked at 7:00 AM, before the budget ran out.
  await moveClock(7 * 60);
  const paused = "Travel estimates resume on December 1.";
  for (const m of walkMinutes(7 * 60)) {
    await moveClock(m);
    const at = clock(m);
    const expected: Expected = m === 420 ? { text: `Leave by 9:35 AM for Gym from Home · walking, arrive 9:55 AM. ${paused}`, button: "none" }
      : m < 575 ? { text: `Last estimate: leave by 9:35 AM for Gym · checked 7:00 AM. ${paused}`, button: "none" }
        : m < 580 ? { text: `Last estimate: leave now for Gym · checked 7:00 AM. ${paused}`, button: "none" }
          : m < 600 ? { text: `Last estimate: if you haven't left for Gym yet, you'd arrive about ${clock(m + 20)} · checked 7:00 AM. ${paused}`, button: "none" }
            : m < 900 ? { text: paused, button: "none" }
              : { text: null, button: "none" };
    expectLine(expected, at);
  }
}, 20_000);

it("shows no travel text at any step of a day with no trips", async () => {
  await render("no-trips");
  await moveClock(6 * 60);
  for (const m of walkMinutes(6 * 60)) {
    await moveClock(m);
    expectLine({ text: null, button: "none" }, clock(m));
    expect(announced(), clock(m)).toBe("");
  }
}, 20_000);

describe("live region", () => {
  const trip = (state: DepartureTrip["state"], linePhrase: string, key = "outbound:base:gym") => ({ key, state, action: null, linePhrase, phrase: linePhrase }) as unknown as DepartureTrip;
  const model = (next: DepartureTrip): DepartureModel => ({ state: next.state, next, phrase: next.linePhrase, trips: [next], resumesAt: null, pausedPhrase: null });
  const status: TravelState = { view: null, message: null, stale: false, pending: false, observedAt: null, resumesAt: null, refresh: () => undefined };
  const show = (departure: DepartureModel) => act(() => root.render(<TravelStatusLine departure={departure} status={status} hasEvidence />));
  it("announces a new trip or state, never a countdown minute", async () => {
    await show(model(trip("upcoming", "Leave by 9:35 AM for Gym.")));
    expect(announced()).toBe("");
    await show(model(trip("soon", "Leave in 25 minutes, by 9:35 AM for Gym.")));
    expect(announced()).toBe("Leave in 25 minutes, by 9:35 AM for Gym.");
    await show(model(trip("soon", "Leave in 24 minutes, by 9:35 AM for Gym.")));
    expect(container.querySelector("[data-departure-line]")!.textContent).toBe("Leave in 24 minutes, by 9:35 AM for Gym.");
    expect(announced()).toBe("Leave in 25 minutes, by 9:35 AM for Gym.");
    await show(model(trip("soon", "Leave in 20 minutes, by 1:20 PM for Dentist.", "onward:gym:dentist")));
    expect(announced()).toBe("Leave in 20 minutes, by 1:20 PM for Dentist.");
  });
  it("announces when the next trip's action changes within one state (Ticket 270)", async () => {
    const appears = (linePhrase: string, action: DepartureTrip["action"]) => ({ ...trip("appears_later", linePhrase), action }) as DepartureTrip;
    await show(model(appears("Leave time for Dentist appears by 10:55 AM.", null)));
    expect(announced()).toBe("");
    await show(model(appears("Refresh travel to get a leave time for Dentist.", "refresh")));
    expect(announced()).toBe("Refresh travel to get a leave time for Dentist.");
  });
  it("shows tomorrow's first trip only once today has no trip left (Ticket 282)", async () => {
    const tomorrow = "Tomorrow: leave by 8:10 AM for Dentist.";
    const none: DepartureModel = { state: "none", next: null, phrase: null, trips: [], resumesAt: null, pausedPhrase: null };
    await act(() => root.render(<TravelStatusLine departure={model(trip("head_home", "Head home now, home by 6:30 PM."))} status={status} hasEvidence tomorrow={tomorrow} />));
    expect(container.querySelector("[data-departure-line]")!.textContent).toBe("Head home now, home by 6:30 PM.");
    await act(() => root.render(<TravelStatusLine departure={none} status={status} hasEvidence tomorrow={tomorrow} />));
    const line = container.querySelector("[data-departure-line]")!;
    expect(line.textContent).toBe(tomorrow);
    expect(line.getAttribute("data-departure-line")).toBe("tomorrow");
    expect(line.querySelector("button")).toBeNull();
    expect(announced()).toBe(tomorrow);
    await act(() => root.render(<TravelStatusLine departure={none} status={status} hasEvidence tomorrow={null} />));
    expect(container.querySelector("[data-departure-line]")).toBeNull();
  });
});
