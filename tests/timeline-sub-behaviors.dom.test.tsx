// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Temporal } from "@js-temporal/polyfill";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RefreshProvider } from "@cadence/ui/runtime";

import { DayProgressTimeline } from "@/components/timeline/DayProgressTimeline";
import { TimelineGroup } from "@/components/timeline/TimelineGroup";
import { SEMANTIC_ZOOM_STORAGE_KEY } from "@/components/timeline/use-semantic-zoom";
import { resolveTimeline } from "@cadence/core/resolvers/timeline.resolver";
import type {
  OccurrenceActionState,
  OccurrenceFormAction,
  TimelineOccurrenceInput,
  TimelineStatus,
  TimelineView,
} from "@/lib/types/timeline";

const NOW = "2026-11-20T15:00:00Z";
const idle = vi.fn(async (): Promise<OccurrenceActionState> => ({ status: "idle", message: "" }));
let parentAction: ReturnType<typeof vi.fn<OccurrenceFormAction>>;
let container: HTMLDivElement;
let resizeCallbacks: (() => void)[];
let root: Root;

type Row = readonly [id: string, title: string, at: string, localDate: string, label: string, status?: TimelineStatus, parent?: readonly [string, string, number], schedule?: string];

const SKIN = ["behavior-skin", "Skin routine"] as const;
const STRETCH = ["behavior-stretch", "Lunch stretch"] as const;
const MOBILITY = ["behavior-mobility", "Morning mobility"] as const;

const ROWS: readonly Row[] = [
  ["y-cerave", "Cerave", "2026-11-19T12:00:00Z", "2026-11-19", "7:00 AM", "unresolved", [...SKIN, 0]],
  ["y-facewash", "Facewash", "2026-11-19T12:00:00Z", "2026-11-19", "7:00 AM", "unresolved", [...SKIN, 1]],
  ["y-read", "Read", "2026-11-20T02:30:00Z", "2026-11-19", "9:30 PM"],
  ["t-hips", "Hip circles", "2026-11-20T11:00:00Z", "2026-11-20", "6:00 AM", "completed", [...MOBILITY, 0]],
  ["t-ankles", "Ankle rolls", "2026-11-20T11:00:00Z", "2026-11-20", "6:00 AM", "completed", [...MOBILITY, 1]],
  ["t-retinol", "Retinol", "2026-11-20T12:00:00Z", "2026-11-20", "7:00 AM", "unresolved", [...SKIN, 2], "Mon, Wed and Fri at 7:00 AM"],
  ["t-cerave", "Cerave", "2026-11-20T12:00:00Z", "2026-11-20", "7:00 AM", "completed", [...SKIN, 0]],
  ["t-facewash", "Facewash", "2026-11-20T12:00:00Z", "2026-11-20", "7:00 AM", "completed", [...SKIN, 1]],
  ["t-walk", "Walk outside", "2026-11-20T13:30:00Z", "2026-11-20", "8:30 AM", "completed"],
  ["t-neck", "Neck release", "2026-11-20T17:00:00Z", "2026-11-20", "12:00 PM", "unresolved", [...STRETCH, 0]],
  ["t-hamstrings", "Hamstring stretch", "2026-11-20T17:00:00Z", "2026-11-20", "12:00 PM", "unresolved", [...STRETCH, 1]],
  ["t-gym", "Gym", "2026-11-20T23:30:00Z", "2026-11-20", "6:30 PM"],
  ["n-cerave", "Cerave", "2026-11-21T12:00:00Z", "2026-11-21", "7:00 AM", "unresolved", [...SKIN, 0]],
  ["n-facewash", "Facewash", "2026-11-21T12:00:00Z", "2026-11-21", "7:00 AM", "unresolved", [...SKIN, 1]],
];

function input([id, title, at, localDate, label, status = "unresolved", parent, schedule]: Row): TimelineOccurrenceInput {
  return {
    id, behaviorId: `behavior-${id.slice(2)}`, title, scheduledFor: at, scheduledTimeLabel: label, localDate, status,
    statusMarkedAt: status === "unresolved" ? null : at, description: "", categoryName: "Care",
    scheduleSummary: schedule ?? `Every day at ${label}`, note: "", timeTracking: { recordedSeconds: 0, runningStartedAt: null },
    canStartTimeTracking: true,
    ...(parent ? { parentBehaviorId: parent[0], parentTitle: parent[1], subBehaviorSortOrder: parent[2] } : {}),
  };
}

function timeline(rows: readonly Row[] = ROWS): TimelineView {
  return resolveTimeline({ timezone: "America/New_York", now: Temporal.Instant.from(NOW), futureDays: 1, occurrences: rows.map(input) });
}

async function renderDay(options: Readonly<{ view?: TimelineView; withParentAction?: boolean }> = {}) {
  const view = options.view ?? timeline();
  await act(() => root.render(<RefreshProvider onRefresh={() => {}}>
    <DayProgressTimeline timeline={view} context={{ now: NOW, events: [] }} statusAction={idle} noteAction={idle}
      startTimeTrackingAction={idle} stopTimeTrackingAction={idle} resetTimeTrackingAction={idle}
      parentSlotStatusAction={options.withParentAction === false ? undefined : parentAction} />
  </RefreshProvider>));
}

function day(localDate: string) {
  return container.querySelector<HTMLElement>(`[data-day-progress-date="${localDate}"]`)!;
}

function routine(localDate: string, title: string) {
  const found = [...day(localDate).querySelectorAll<HTMLElement>("[data-parent-slot-key]")]
    .find((element) => element.querySelector(".timeline-parent-title")?.textContent === title);
  if (!found) throw new Error(`Missing routine ${title}`);
  return found;
}

const header = (row: HTMLElement) => row.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
const childIds = (row: HTMLElement) => [...row.querySelectorAll<HTMLElement>("[data-parent-children] article[data-occurrence-id]")]
  .map((article) => article.dataset.occurrenceId);

function pressToggle(label: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>("[data-semantic-zoom-toggle] button")].find((item) => item.textContent === label);
  if (!button) throw new Error(`Missing toggle ${label}`);
  return act(() => button.click());
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.localStorage.clear();
  parentAction = vi.fn<OccurrenceFormAction>(async () => ({ status: "success", message: "", nextStatus: "completed" }));
  resizeCallbacks = [];
  vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { resizeCallbacks.push(callback); } observe() {} disconnect() {} });
  // Day sections stack 600px apart; times sit 30px apart in document order.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const sections = [...document.querySelectorAll("section")];
    const section = this.closest("section");
    const base = section ? sections.indexOf(section) * 600 : 0;
    const times = section ? [...section.querySelectorAll("time")] : [];
    const top = this === section ? base : this.tagName === "TIME" ? base + 40 + times.indexOf(this as never) * 30 : base + 20;
    const height = this === section ? 580 : this.tagName === "TIME" ? 20 : 48;
    return { top, bottom: top + height, left: 160, right: 760, width: 600, height, x: 160, y: top, toJSON() {} } as DOMRect;
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Timeline sub-behavior rows", () => {
  it("keeps routines and standalone Behaviors in time order on the day axis", async () => {
    await renderDay();
    const items = [...day("2026-11-20").querySelectorAll<HTMLElement>("[data-parent-slot-key], article[data-occurrence-id]")]
      .filter((element) => !element.closest("[data-parent-children]"))
      .map((element) => element.dataset.parentSlotKey ? element.querySelector(".timeline-parent-title")!.textContent : element.querySelector("h3")!.textContent);
    expect(items).toEqual(["Morning mobility", "Skin routine", "Walk outside", "Lunch stretch", "Gym"]);
  });

  it("shows Layer 1 by default: collapsed routines with derived progress and no fourth status", async () => {
    await renderDay();
    const skin = routine("2026-11-20", "Skin routine");
    expect(header(skin).getAttribute("aria-expanded")).toBe("false");
    expect(childIds(skin)).toEqual([]);
    expect(skin.querySelector("[data-parent-progress]")!.textContent).toBe("2/3, 2 of 3 completed");
    expect(skin.dataset.parentStatus).toBe("partial");

    const mobility = routine("2026-11-20", "Morning mobility");
    expect(mobility.querySelector('[data-status-region="label"]')!.textContent).toBe("Completed");
    expect(mobility.querySelector("[data-parent-progress]")).toBeNull();
    expect(mobility.querySelector("[data-parent-status-action]")).toBeNull();

    const stretch = routine("2026-11-20", "Lunch stretch");
    expect(stretch.querySelector("[data-parent-progress]")!.textContent).toContain("0/2");
    expect([...stretch.querySelectorAll("[data-parent-status-action]")].map((button) => button.textContent)).toEqual(["Completed", "Not Completed"]);
  });

  it("shows the Routines / All steps control only when a routine is visible", async () => {
    await renderDay();
    expect(container.querySelector("[data-semantic-zoom-toggle]")).not.toBeNull();
    await renderDay({ view: timeline(ROWS.filter((row) => !row[6])) });
    expect(container.querySelector("[data-semantic-zoom-toggle]")).toBeNull();
  });

  it("opens every routine inline on All steps, children in sibling order", async () => {
    await renderDay();
    await pressToggle("All steps");
    // Opening routines resizes the day; the axis then re-measures rows in screen order.
    await act(async () => { resizeCallbacks.forEach((callback) => callback()); });
    expect(window.localStorage.getItem(SEMANTIC_ZOOM_STORAGE_KEY)).toBe("sub_behaviors");
    const skin = routine("2026-11-20", "Skin routine");
    expect(childIds(skin)).toEqual(["t-cerave", "t-facewash", "t-retinol"]);
    expect(childIds(routine("2026-11-20", "Lunch stretch"))).toEqual(["t-neck", "t-hamstrings"]);
    // Tomorrow's routine has no Retinol: the custom-schedule child is not on Saturday.
    expect(childIds(routine("2026-11-21", "Skin routine"))).toEqual(["n-cerave", "n-facewash"]);
    // A child row keeps its own status controls, Note and schedule.
    const retinol = skin.querySelector<HTMLElement>('article[data-occurrence-id="t-retinol"]')!;
    expect(retinol.querySelector('[data-status-region="actions"]')).not.toBeNull();
    expect(retinol.textContent).toContain("Mon, Wed and Fri at 7:00 AM");
    expect(retinol.querySelector("textarea")).not.toBeNull();
  });

  it("opens or closes one routine on a click, whatever the layer", async () => {
    await renderDay();
    await act(() => header(routine("2026-11-20", "Skin routine")).click());
    expect(childIds(routine("2026-11-20", "Skin routine"))).toHaveLength(3);
    expect(childIds(routine("2026-11-20", "Lunch stretch"))).toEqual([]);

    await pressToggle("All steps");
    await act(() => header(routine("2026-11-20", "Lunch stretch")).click());
    expect(childIds(routine("2026-11-20", "Lunch stretch"))).toEqual([]);
    expect(childIds(routine("2026-11-20", "Skin routine"))).toHaveLength(3);

    // Back to Routines collapses everything, including the routine opened by hand.
    await pressToggle("Routines");
    expect(childIds(routine("2026-11-20", "Skin routine"))).toEqual([]);
  });

  it("marks a whole routine slot with one click through the injected action", async () => {
    await renderDay();
    const stretch = routine("2026-11-20", "Lunch stretch");
    const completed = stretch.querySelector<HTMLButtonElement>('[data-parent-status-action="completed"]')!;
    expect(completed.getAttribute("aria-label")).toBe("Mark Lunch stretch Completed");
    await act(async () => { completed.click(); });
    expect(parentAction).toHaveBeenCalledTimes(1);
    const formData = parentAction.mock.calls[0]![1];
    expect(formData.get("parent_behavior_id")).toBe("behavior-stretch");
    expect(formData.get("status")).toBe("completed");
    expect(formData.getAll("occurrence_id")).toEqual(["t-neck", "t-hamstrings"]);
  });

  it("offers no bulk marking without an action or on a future day", async () => {
    await renderDay();
    expect(routine("2026-11-21", "Skin routine").querySelector("[data-parent-status-action]")).toBeNull();
    await renderDay({ withParentAction: false });
    expect(container.querySelector("[data-parent-status-action]")).toBeNull();
  });

  it("shows a routine in Needs decision beside standalone rows, with bulk marking", async () => {
    const view = timeline();
    const section = view.needsDecision.daySections[0]!;
    await act(() => root.render(<RefreshProvider onRefresh={() => {}}>
      <TimelineGroup section={section} variant="needsDecisionDialog" statusAction={idle} noteAction={idle}
        startTimeTrackingAction={idle} stopTimeTrackingAction={idle} resetTimeTrackingAction={idle} parentSlotStatusAction={parentAction} />
    </RefreshProvider>));
    const skin = container.querySelector<HTMLElement>("[data-parent-slot-key]")!;
    expect(skin.querySelector(".timeline-parent-title")!.textContent).toBe("Skin routine");
    expect(skin.querySelector("[data-parent-progress]")!.textContent).toContain("0/2");
    expect(skin.querySelector("[data-visual-tone]")!.getAttribute("data-visual-tone")).toBe("needs_decision");
    expect(container.querySelector('article[data-occurrence-id="y-read"]')).not.toBeNull();
    expect(childIds(skin)).toEqual([]);
    await act(() => header(skin).click());
    expect(childIds(skin)).toEqual(["y-cerave", "y-facewash"]);
    await act(async () => { skin.querySelector<HTMLButtonElement>('[data-parent-status-action="not_completed"]')!.click(); });
    expect(parentAction.mock.calls[0]![1].get("status")).toBe("not_completed");
  });

  it("opens Needs decision routines when the device is on All steps", async () => {
    window.localStorage.setItem(SEMANTIC_ZOOM_STORAGE_KEY, "sub_behaviors");
    const section = timeline().needsDecision.daySections[0]!;
    await act(() => root.render(<RefreshProvider onRefresh={() => {}}>
      <TimelineGroup section={section} variant="needsDecisionDialog" statusAction={idle} noteAction={idle}
        startTimeTrackingAction={idle} stopTimeTrackingAction={idle} resetTimeTrackingAction={idle} />
    </RefreshProvider>));
    expect(childIds(container.querySelector<HTMLElement>("[data-parent-slot-key]")!)).toEqual(["y-cerave", "y-facewash"]);
  });
});
