// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RefreshProvider } from "@cadence/ui/runtime";
import { DEPARTURE_PHRASE_REVIEW } from "@cadence/core/services/departure-phrases";
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
// Ticket 269: the visible next-departure line and its note, not the screen-reader region.
const statusLine = () => [...surface("Timeline").querySelectorAll("[data-departure-line], [data-travel-note]")].map((line) => line.textContent).join(" ");
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
  // Ticket 267: the trip from Gym to Dentist falls due 3 hours before Gym ends.
  expect(text("Dentist drawer")).toContain("Leave time appears by 8:00 AM.");
  expect(statusLine()).toBe("Leave by 9:35 AM for Gym from Home · walking, arrive 9:55 AM.");
  // Ticket 272: the bubble uses the model's line form, which names the event.
  expect(text("Daily Brief")).toContain("Leave by 9:35 AM for Gym from Home · walking, arrive 9:55 AM.");

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
  // Ticket 272: during the event the trip home is the next trip, so the bubble says when to head home.
  expect(text("Daily Brief")).toContain("Head home 3:00 PM · walking, home by 3:30 PM.");
  expect(text("Daily Brief")).not.toContain("Back around");
  await choose("trip-changed");
  expect(text("Dentist drawer")).toContain("Trip changed.");
  await choose("needs-place");
  expect(container.querySelector("[data-bench-model-line]")?.textContent).toContain("Add a place for Dentist to get a leave time.");
  await choose("needs-attendance");
  expect(container.querySelector("[data-bench-model-line]")?.textContent).toContain("Is Dentist in person or remote?");
  await choose("needs-origin");
  expect(container.querySelector("[data-departure-model-state]")?.textContent).toBe("Needs a start");
  expect(container.querySelector("[data-bench-model-line]")?.textContent).toContain("Fix Gym's place or attendance to get a leave time for Dentist.");
  await choose("paused");
  // The trip to Dentist waits for an estimate, so the pause is the whole line, said once.
  expect(statusLine()).toBe("Travel estimates resume on December 1.");
  for (const label of ["Dentist drawer", "Dentist Calendar details"]) {
    expect(text(label).split("Travel estimates resume on December 1.").length - 1, label).toBe(1);
  }
});

it("shows the bubble's travel block from the model in every state (Ticket 272)", async () => {
  await render();
  const briefLines = () => [...surface("Daily Brief").querySelectorAll("li")].map((line) => line.textContent ?? "");
  const TIMED = new Set(["upcoming", "soon", "leave_now", "late", "head_home"]);
  for (const state of DEPARTURE_BENCH_STATES) {
    await choose(state.id);
    const lines = briefLines();
    if (state.expected === "none") {
      expect(lines, state.id).toEqual([]);
      expect(text("Daily Brief"), state.id).not.toContain("Travel");
      continue;
    }
    // The next trip's line in the bubble is the Timeline's line, without its Refresh travel button.
    if (TIMED.has(state.expected)) expect(lines, state.id).toContain(statusLine().replace(/ Refresh travel$/, ""));
    for (const line of lines) expect(line, state.id).not.toMatch(/\((walking|cycling|transit|driving)\)/);
  }
});

it("shows the drawer, dialog, Behavior row and bubble after the 5-minute expiry", async () => {
  await render("head-home");
  expect(text("Dentist Calendar details")).toContain("Head home 3:00 PM · walking, home by 3:30 PM.");
  await moveClock("14:20");
  expect(statusLine()).toBe("Last estimate: head home 3:00 PM · checked 2:15 PM. Refresh travel");
  for (const label of ["Dentist drawer", "Dentist Calendar details"]) {
    expect(text(label), label).toContain("Last estimate: head home 3:00 PM · checked 2:15 PM.");
    expect(text(label), label).not.toContain("Head home 3:00 PM · walking");
  }
  // Ticket 272: the bubble keeps the trip home, marked, instead of losing the block.
  expect(text("Daily Brief")).toContain("Last estimate: head home 3:00 PM · checked 2:15 PM.");
  expect(container.querySelector("[data-bench-brief-note]")).toBeNull();

  await choose("fresh");
  await moveClock("07:05");
  expect(gymRow()).toContain("Last estimate: leave by 9:35 AM · checked 7:00 AM.");
  expect(text("Daily Brief")).toContain("Last estimate: leave by 9:35 AM for Gym · checked 7:00 AM.");
  expect(text("Daily Brief")).toContain("Calculated by Cadence · Google Maps · 7:00 AM.");
  expect(container.querySelector("[data-bench-checked]")?.textContent).toBe("7:00 AM, expired at 7:05 AM");
});

it("keeps Directions after expiry where a route reached the place, and Search where none has (Ticket 271, C2)", async () => {
  await render("expired");
  const kind = (scope: Element | null) => scope?.querySelector("[data-travel-navigation]")?.getAttribute("data-travel-navigation") ?? null;
  // Gym's route was checked at 7:00 and expired at 7:05. Its place is still resolved.
  expect(gymRow()).toContain("Last estimate: leave by 9:35 AM");
  expect(kind(surface("Timeline").querySelector('[data-occurrence-id="bench-gym"]'))).toBe("directions");
  // Dentist's trip waits outside the 3-hour window, so no route has reached it yet.
  expect(kind(surface("Dentist drawer"))).toBe("search");
  expect(kind(surface("Dentist Calendar details"))).toBe("search");
  // Route Dentist at noon, then let that estimate expire.
  await moveClock("12:00");
  const refresh = [...surface("Timeline").querySelectorAll("button")].find((button) => button.textContent === "Refresh travel");
  await act(async () => refresh!.click());
  await moveClock("12:10");
  const drawer = surface("Dentist drawer");
  expect(drawer.querySelector("[data-departure-lead]")?.textContent).toMatch(/^Last estimate: leave by 1:20 PM · checked 12:00 PM\./);
  expect(kind(drawer)).toBe("directions");
  expect(kind(surface("Dentist Calendar details"))).toBe("directions");
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

it("lists every reviewed phrase with its approval, rendered by the module to match its pattern", async () => {
  const rows = departureWordingRows();
  expect(rows).toHaveLength(DEPARTURE_PHRASE_REVIEW.length + 2);
  expect(Object.keys(DEPARTURE_WORDING_SAMPLES).sort()).toEqual(DEPARTURE_PHRASE_REVIEW.map((entry) => entry.id).sort());
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

it("keeps the Gym row and the Dentist drawer in agreement about the trip home through the day", async () => {
  await render("fresh");
  // Every 15 minutes from the 7:00 AM check, plus each boundary: leave times (9:35 AM, 1:20 PM,
  // 3:00 PM) and 5 minutes after, event starts and ends, and 3 hours and 30 minutes before each
  // leave time. 6:35 AM comes before the check, so moving there would re-check routes; it is left out.
  const boundaries = ["09:35", "09:40", "13:20", "13:25", "15:00", "15:05", "10:00", "11:00", "14:00",
    "10:20", "12:00", "09:05", "12:50", "14:30"].map((time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3)));
  const steps = [...new Set([...Array.from({ length: 45 }, (_, index) => 7 * 60 + index * 15), ...boundaries])].sort((a, b) => a - b);
  for (const minutes of steps) {
    const time = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    // The slider re-renders the mounted bench; nothing remounts between steps.
    await moveClock(time);
    const homeLine = /trip home|Head home|home by/.test(text("Dentist drawer"));
    // The trip home is waiting for its estimate, has a time or is over: never "unknown".
    expect(gymRow(), time).not.toContain("Return time unknown");
    if (minutes < 15 * 60) expect(homeLine, time).toBe(true);
  }
  // No trip home and none coming: Dentist has no place, so the row says so.
  await choose("needs-place");
  expect(gymRow()).toContain("Return time unknown.");
  // A known time for the trip home.
  await choose("head-home");
  expect(gymRow()).not.toContain("Return time unknown");
}, 20_000);

it("makes Refresh travel the first words of a line that asks for it, never repeating them (owner change R1)", async () => {
  await render("fresh");
  // At 11:30 AM the trip to Dentist was due at 8:00 AM, and nobody refreshed.
  await moveClock("11:30");
  for (const label of ["Dentist drawer", "Dentist Calendar details"]) {
    const view = text(label);
    expect(view, label).toContain("Refresh travel to get the leave time.");
    expect(view, label).not.toMatch(/Refresh travel\s*Refresh travel/);
    expect([...surface(label).querySelectorAll("button")].filter((button) => button.textContent === "Refresh travel"), label).toHaveLength(1);
  }
  const button = [...surface("Dentist drawer").querySelectorAll("button")].find((element) => element.textContent === "Refresh travel")!;
  expect(button.closest("p")?.textContent).toBe("Refresh travel to get the leave time.");
  for (const line of container.querySelectorAll("p")) expect(line.textContent ?? "").not.toMatch(/Refresh travel\s*Refresh travel/);
});

it("shows the owner's approval on the wording review", async () => {
  await render();
  // Ticket 268 added one phrase; the owner approved it as written on November 5, 2026.
  // Ticket 271 adds the correction control's label, not yet approved (decision D7).
  // Ticket 272 lists the Daily Brief's overlap and return lines, not yet approved.
  // Ticket 270 adds the rail label and the slim row's two forms, not yet approved.
  // Ticket 273 adds In person, Remote, the Travel estimates offer, its Not now and the setup row's Estimates off.
  expect(container.querySelector("[data-wording-approval]")?.textContent).toContain("12 of 75 phrases await the owner's approval.");
  for (const id of ["step-in-person", "step-remote", "travel-off-offer", "travel-off-dismiss", "setup-estimates-off"]) {
    expect(container.querySelector(`[data-wording-id="${id}"] [data-wording-status]`)?.textContent, id).toBe("Not yet approved");
  }
  expect(container.querySelector('[data-wording-id="travel-off-offer"] [data-wording-sample]')?.textContent)
    .toBe("Turn on Travel estimates in Settings to get a leave time for Dentist.");
  expect(container.querySelector('[data-wording-id="marker-rail"] [data-wording-sample]')?.textContent).toBe("Leave 1:20");
  expect(container.querySelector('[data-wording-id="marker-row"] [data-wording-sample]')?.textContent).toBe("Leave 1:20 PM for Dentist");
  expect(container.querySelector('[data-wording-id="marker-row-home"] [data-wording-sample]')?.textContent).toBe("Leave 3:00 PM for home");
  for (const id of ["brief-overlap", "brief-overlap-trip-home", "brief-back", "marker-rail", "marker-row", "marker-row-home"]) {
    expect(container.querySelector(`[data-wording-id="${id}"] [data-wording-status]`)?.textContent, id).toBe("Not yet approved");
  }
  expect(container.querySelector('[data-wording-id="brief-back"] [data-wording-sample]')?.textContent).toBe("Back around 3:30 PM.");
  expect(container.querySelector('[data-wording-id="correction-toggle"] [data-wording-sample]')?.textContent).toBe("Change for this trip");
  expect(container.querySelector('[data-wording-id="correction-toggle"] [data-wording-status]')?.textContent).toBe("Not yet approved");
  expect(container.querySelector('[data-wording-id="line-changed-unnamed"] [data-wording-sample]')?.textContent).toBe("A planned trip changed.");
  expect(container.querySelector('[data-wording-id="line-changed-unnamed"] [data-wording-status]')?.textContent).toBe("Approved November 5, 2026");
  expect(container.querySelector('[data-wording-id="line-changed"] [data-wording-status]')?.textContent).toContain("Approved");
  expect(container.querySelector('[data-wording-id="appears-overdue"] [data-wording-sample]')?.textContent).toBe("Refresh travel to get the leave time.");
  expect(container.querySelector('[data-wording-id="appears-overdue"] [data-wording-status]')?.textContent).toContain("owner change R1");
});

it("gives every line that starts with Refresh travel its own button when two trips are due (owner change R1)", async () => {
  await render("fresh");
  const leading = (root: Element) => [...root.querySelectorAll("p")].filter((line) => line.textContent?.startsWith("Refresh travel "));
  for (const time of ["12:00", "13:30"]) {
    await moveClock(time);
    for (const label of ["Dentist drawer", "Dentist Calendar details"]) {
      const lines = leading(surface(label));
      expect(lines.map((line) => line.textContent), `${time} ${label}`).toEqual(["Refresh travel to get the leave time.", "Refresh travel to get the leave time for the trip home."]);
      for (const line of lines) {
        const buttons = line.querySelectorAll("button");
        expect(buttons, `${time} ${label}`).toHaveLength(1);
        expect(buttons[0]!.textContent).toBe("Refresh travel");
        expect(line.textContent).not.toMatch(/Refresh travel\s*Refresh travel/);
      }
    }
    const summary = surface("Timeline").querySelector<HTMLElement>('[data-occurrence-id="bench-gym"] summary');
    if (summary && !summary.closest("details")?.open) await act(() => summary.click());
    const row = surface("Timeline").querySelector('[data-occurrence-id="bench-gym"]')!;
    for (const line of leading(row)) expect(line.querySelectorAll("button"), `${time} Gym row`).toHaveLength(1);
  }
});

// Ticket 270 (D2, "Next trip only"): the next trip's span and marker, in each bench variant.
async function chooseSelect(attribute: string, value: string) {
  const select = container.querySelector<HTMLSelectElement>(`select[${attribute}]`)!;
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
const timelineSurface = () => surface("Timeline");
const marks = () => ({
  spans: [...timelineSurface().querySelectorAll("[data-next-trip-span]")].map((line) => line.getAttribute("data-next-trip-span")),
  ticks: timelineSurface().querySelectorAll("[data-next-trip-tick]").length,
  labels: [...timelineSurface().querySelectorAll("[data-next-trip-label]")].map((label) => label.textContent),
  rows: [...timelineSurface().querySelectorAll("[data-next-trip-row]")].map((row) => row.textContent),
  hoverSpans: timelineSurface().querySelectorAll("[data-travel-duration], [data-event-duration]").length,
});
const tabStops = () => [...timelineSurface().querySelectorAll<HTMLElement>("button, a[href], input, select, summary, [tabindex]")]
  .filter((element) => element.tabIndex >= 0).length;

it("marks the next trip only, without hovering, in each marker variant (Ticket 270)", async () => {
  await render("fresh");
  const stops: number[] = [];
  for (const marker of ["rail_label", "behavior_row", "axis_tick"]) {
    await chooseSelect("data-bench-marker", marker);
    const shown = marks();
    // One magenta span, for the trip to Gym; the other trips stay inspection-only.
    expect(shown.spans, marker).toEqual(["outbound::bench-gym"]);
    expect(shown.hoverSpans, marker).toBe(0);
    expect(shown.ticks, marker).toBe(marker === "behavior_row" ? 0 : 1);
    expect(shown.labels, marker).toEqual(marker === "rail_label" ? ["Leave 9:35"] : []);
    expect(shown.rows, marker).toEqual(marker === "behavior_row" ? ["Leave 9:35 AM for Gym"] : []);
    stops.push(tabStops());
  }
  // No marker adds a tab stop.
  expect(new Set(stops).size).toBe(1);
  expect(timelineSurface().querySelector("[data-next-trip-label], [data-next-trip-row]")?.closest("button, a")).toBeFalsy();
});

it("keeps the marks for late, leave now, last estimate and head home, and drops them without a time (Ticket 270)", async () => {
  await render("fresh");
  await chooseSelect("data-bench-marker", "behavior_row");
  const cases: ReadonlyArray<readonly [string, string | null]> = [
    ["expired", "Leave 9:35 AM for Gym"], ["leave-now", "Leave 9:35 AM for Gym"], ["late-clock", "Leave 9:35 AM for Gym"],
    ["head-home", "Leave 3:00 PM for home"], ["needs-place", null], ["appears-later", null], ["no-trips", null], ["paused", null],
  ];
  for (const [state, row] of cases) {
    await choose(state);
    expect(marks().rows, state).toEqual(row ? [row] : []);
    expect(marks().spans.length, state).toBe(row ? 1 : 0);
  }
});

it("shows one muted line on a Behavior the next trip crowds, only while collapsed (Ticket 270)", async () => {
  await render("upcoming-dentist");
  const call = () => timelineSurface().querySelector('[data-occurrence-id="bench-call"]')!;
  const line = call().querySelector("summary [data-next-trip-crowded]");
  expect(line?.textContent?.trim()).toMatch(/^Overlaps your trip to Dentist \(\d{1,2}:\d{2} PM–\d{1,2}:\d{2} PM\)$/);
  expect(line?.className).toContain("group-open:hidden");
  expect(call().querySelectorAll("[data-next-trip-crowded]")).toHaveLength(1);
  // Gym is not crowded: it is a stop, not a Behavior the trip passes over.
  expect(timelineSurface().querySelector('[data-occurrence-id="bench-gym"] [data-next-trip-crowded]')).toBeNull();
  // Before Gym ends, the next trip is the trip to Gym, so Call Mom carries no line.
  await moveClock("08:00");
  expect(call().querySelector("[data-next-trip-crowded]")).toBeNull();
});

it("sets the next-departure line's size and keeps it regular weight (Ticket 270)", async () => {
  await render("fresh");
  const line = () => timelineSurface().querySelector<HTMLElement>("[data-departure-line]")!;
  expect(line().getAttribute("data-line-size")).toBe("status");
  await chooseSelect("data-bench-line-size", "title");
  expect(line().getAttribute("data-line-size")).toBe("title");
  expect(line().className).not.toMatch(/font-(bold|semibold|medium)/);
});

it("moves only the marks on a moving clock, never the rows (Ticket 270)", async () => {
  await render("soon");
  await chooseSelect("data-bench-marker", "behavior_row");
  const order = () => [...timelineSurface().querySelectorAll("[data-next-trip-row], [data-occurrence-id]")].map((node) => node.getAttribute("data-occurrence-id") ?? "trip");
  const before = order();
  for (const time of ["09:11", "09:20", "09:34"]) {
    await moveClock(time);
    expect(order(), time).toEqual(before);
  }
});
