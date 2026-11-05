// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RefreshProvider } from "@cadence/ui/runtime";
import { DEPARTURE_PHRASES_AWAITING_APPROVAL } from "@cadence/core/services/departure-phrases";
import { DEPARTURE_BENCH_STATES, DepartureStatesBench } from "@/app/design-system/DepartureStatesBench";
import { DEPARTURE_WORDING_SAMPLES, departureWordingRows } from "@/app/design-system/DepartureWordingReview";

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

async function render(stateId?: string) {
  await act(() => root.render(<RefreshProvider onRefresh={() => {}}><DepartureStatesBench initialStateId={stateId} /></RefreshProvider>));
}

async function choose(stateId: string) {
  const select = [...container.querySelectorAll("select")].find((element) => element.closest("label")?.textContent?.startsWith("State"))!;
  await act(async () => {
    select.value = stateId;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function moveClock(localTime: string) {
  const [hour, minute] = localTime.split(":").map(Number);
  const slider = container.querySelector<HTMLInputElement>("#departure-bench-clock")!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(slider, String(hour! * 60 + minute!));
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const surface = (label: string) => container.querySelector(`section[aria-label="${label}"]`)!;
const text = (label: string) => surface(label).textContent ?? "";
const statusLine = () => surface("Timeline").querySelector('[role="status"]')?.textContent ?? "";
const gymRow = () => surface("Timeline").querySelector('[data-occurrence-id="bench-gym"]')?.textContent ?? "";

it("walks the state switch through every state and shows the bench clock", async () => {
  await render();
  for (const state of DEPARTURE_BENCH_STATES) {
    await choose(state.id);
    expect(container.querySelector("[data-departure-model-state]")?.getAttribute("data-departure-model-state"), state.id).toBe(state.expected);
    const [hour, minute] = state.clock.split(":").map(Number);
    const label = `${hour! % 12 || 12}:${String(minute).padStart(2, "0")} ${hour! < 12 ? "AM" : "PM"}`;
    expect(container.querySelector("[data-bench-clock]")?.textContent).toBe(label);
    const travelLines = [...container.querySelectorAll("[data-departure-state]")];
    if (state.expected === "none") {
      expect(travelLines).toHaveLength(0);
      expect(statusLine()).toBe("");
      expect(gymRow()).not.toContain("Return time unknown");
    } else {
      expect(container.querySelector("[data-bench-model-line]")?.textContent, state.id).not.toContain("None");
      // Ticket 273 adds the place, attendance and start steps to the drawer and dialog.
      if (!state.expected.startsWith("needs_")) expect(travelLines.length, state.id).toBeGreaterThan(0);
    }
  }
});

it("renders each preset's sentences in the shared surfaces", async () => {
  await render("fresh");
  expect(gymRow()).toContain("Leave by 9:35 AM from Home · walking, arrive 9:55 AM.");
  expect(text("Dentist drawer")).toContain("Leave time appears by 10:55 AM.");
  expect(statusLine()).toContain("Travel as of 7:00 AM");
  expect(text("Daily Brief")).toContain("Leave by 9:35 AM for Gym (walking).");

  await choose("soon");
  expect(gymRow()).toContain("Leave in 25 minutes, by 9:35 AM from Home · walking, arrive 9:55 AM.");
  await choose("leave-now");
  expect(gymRow()).toContain("Leave now from Home · walking, arrive 9:56 AM.");
  await choose("late-evidence");
  expect(gymRow()).toContain("You may arrive late: arrive 10:05 AM.");
  await choose("late-clock");
  expect(gymRow()).toContain("Last estimate: if you haven't left yet, you'd arrive about 10:05 AM · checked 9:00 AM.");
  await choose("head-home");
  expect(text("Dentist drawer")).toContain("Head home 3:00 PM · walking, home by 3:30 PM.");
  expect(text("Daily Brief")).toContain("Back around 3:30 PM.");
  await choose("trip-changed");
  expect(text("Dentist drawer")).toContain("Trip changed.");
  await choose("needs-place");
  expect(container.querySelector("[data-bench-model-line]")?.textContent).toContain("Add a place for Dentist to get a leave time.");
  await choose("needs-attendance");
  expect(container.querySelector("[data-bench-model-line]")?.textContent).toContain("Is Dentist in person or remote?");
  await choose("needs-origin");
  expect(container.querySelector("[data-departure-model-state]")?.textContent).toBe("Needs a start");
  expect(container.querySelector("[data-bench-model-line]")?.textContent).toContain("The leave time for Dentist depends on Gym.");
  await choose("paused");
  expect(statusLine()).toContain("Travel estimates resume on December 1.");
  for (const label of ["Dentist drawer", "Dentist Calendar details"]) {
    expect(text(label).split("Travel estimates resume on December 1.").length - 1, label).toBe(1);
  }
});

it("shows the drawer, dialog, Behavior row and bubble after the 5-minute expiry", async () => {
  await render("head-home");
  expect(text("Dentist Calendar details")).toContain("Head home 3:00 PM · walking, home by 3:30 PM.");
  await moveClock("14:20");
  expect(statusLine()).toContain("Travel estimates from 2:15 PM may be stale.");
  for (const label of ["Dentist drawer", "Dentist Calendar details"]) {
    expect(text(label), label).toContain("Last estimate: head home 3:00 PM · checked 2:15 PM.");
    expect(text(label), label).not.toContain("Head home 3:00 PM · walking");
  }
  expect(text("Daily Brief")).not.toContain("Back around");
  expect(container.querySelector("[data-bench-brief-note]")).not.toBeNull();

  await choose("fresh");
  await moveClock("07:05");
  expect(gymRow()).toContain("Last estimate: leave by 9:35 AM · checked 7:00 AM.");
  expect(container.querySelector("[data-bench-checked]")?.textContent).toBe("7:00 AM, expired at 7:05 AM");
});

it("re-checks routes at the bench clock from Refresh travel", async () => {
  await render("trip-changed");
  const refresh = [...surface("Dentist drawer").querySelectorAll("button")].find((element) => element.textContent === "Refresh travel")!;
  await act(async () => refresh.click());
  expect(container.querySelector("[data-bench-checked]")?.textContent).toContain("10:58 AM");
  // Gym is Completed, so the new check routes Dentist from Home and the change is gone.
  expect(text("Dentist drawer")).not.toContain("Trip changed.");
  expect(text("Dentist drawer")).toContain("Leave by 1:20 PM from Home · walking, arrive 1:55 PM.");
});

it("keeps development-only text to the development build", async () => {
  await render("late-evidence");
  expect(container.querySelector("[data-travel-development-warnings]")).toBeNull();
  const build = [...container.querySelectorAll("select")].find((element) => element.closest("label")?.textContent?.startsWith("Build"))!;
  await act(async () => {
    build.value = "development";
    build.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(container.querySelector("[data-travel-development-warnings]")?.textContent).toContain("Estimated arrival is after the planned arrival time.");
});

it("lists every phrase awaiting approval, rendered by the module to match its pattern", async () => {
  const rows = departureWordingRows();
  expect(rows).toHaveLength(DEPARTURE_PHRASES_AWAITING_APPROVAL.length + 2);
  expect(Object.keys(DEPARTURE_WORDING_SAMPLES).sort()).toEqual(DEPARTURE_PHRASES_AWAITING_APPROVAL.map((entry) => entry.id).sort());
  for (const row of rows) {
    const pattern = new RegExp(`^${row.template.split(/\{[^}]+\}/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".+?")}$`);
    expect(row.sample, row.id).toMatch(pattern);
  }
  await render();
  const review = container.querySelector("[data-departure-wording-review]")!;
  expect(review.querySelectorAll("[data-wording-id]")).toHaveLength(rows.length);
  expect(review.textContent).toContain("Applies to this event until you close the Timeline.");
  expect(review.textContent).toContain("Travel estimates are unavailable right now. Tracking and Calendar still work.");
  expect(review.textContent).toContain("Travel estimates await this deployment’s provider review.");
});

it("keeps fixture notes out of route warnings and shows production timing", async () => {
  await render("fresh");
  expect(container.querySelector("[data-frozen-time-note]")?.textContent).toContain("Estimates expire 5 minutes after they are checked");
  expect(container.textContent).not.toContain("2999");
});
