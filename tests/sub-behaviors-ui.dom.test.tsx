// @vitest-environment jsdom
import { LinkProvider, RefreshProvider } from "@cadence/ui/runtime";
import { Temporal } from "@js-temporal/polyfill";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BehaviorForm } from "../components/behaviors/BehaviorForm";
import { BehaviorList } from "../components/behaviors/BehaviorList";
import { attachCandidates, groupSubBehaviors, parentChoices } from "../components/behaviors/behavior-list-state";
import {
  behaviorViewFormData,
  newSubBehaviorFormData,
  parseBehaviorGroupFormData,
} from "../components/behaviors/sub-behavior-form-data";
import { toBehaviorView } from "@cadence/core/services/behavior-views";
import { resolveAnalytics } from "@cadence/core/resolvers/analytics.resolver";
import { parseBehaviorFormData } from "../lib/services/behavior-form";
import type { AnalyticsParentSummary, AnalyticsView } from "../lib/types/analytics";
import type { BehaviorActionState, BehaviorFormAction, BehaviorView } from "../lib/types/behavior";
import { storedBehavior } from "./helpers/export-row-fixture";

// Sub-behaviors on Behaviors (depth 1): drafting a routine with its steps, the parent
// field and Follow parent schedule, the nested list, reorder, detach and add.
const NOW = Temporal.Instant.from("2026-11-20T14:00:00Z");
const SKIN = "11111111-1111-4111-8111-111111111111";
const CERAVE = "22222222-2222-4222-8222-222222222222";
const FACEWASH = "33333333-3333-4333-8333-333333333333";
const RETINOL = "44444444-4444-4444-8444-444444444444";
const WALK = "55555555-5555-4555-8555-555555555555";
const ARCHIVED = "66666666-6666-4666-8666-666666666666";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW.epochMilliseconds));
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

function view(id: string, title: string, fields: Record<string, unknown> = {}): BehaviorView {
  return toBehaviorView({ ...storedBehavior(), id, title, ...fields } as ReturnType<typeof storedBehavior>, NOW);
}

const skin = view(SKIN, "Skin routine");
const cerave = view(CERAVE, "Cerave", { parent_behavior_id: SKIN, sub_behavior_sort_order: 1, inherit_parent_schedule: true });
const facewash = view(FACEWASH, "Facewash", { parent_behavior_id: SKIN, sub_behavior_sort_order: 0, inherit_parent_schedule: true });
const retinol = view(RETINOL, "Retinol", {
  parent_behavior_id: SKIN, sub_behavior_sort_order: 2, inherit_parent_schedule: false,
  recurrence_rule: { frequency: "weekly", interval: 1, daysOfWeek: ["monday", "wednesday", "friday"] },
});
const walk = view(WALK, "Morning walk");
const archived = view(ARCHIVED, "Old habit", { active: false, archived_at: "2026-10-01T12:00:00Z" });

function setValue(element: HTMLInputElement | HTMLSelectElement, value: string) {
  const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}

function byLabel<T extends HTMLElement>(label: string, scope: ParentNode = container): T {
  const labelled = [...scope.querySelectorAll<HTMLElement>("[aria-label]")].find((node) => node.getAttribute("aria-label") === label);
  if (labelled) return labelled as T;
  const wrapper = [...scope.querySelectorAll("label")].find((node) => node.querySelector("span")?.textContent === label
    || node.textContent?.trim() === label);
  const control = wrapper?.querySelector("input, select, textarea") as T | null;
  expect(control, label).toBeTruthy();
  return control!;
}

function button(label: string, scope: ParentNode = container): HTMLButtonElement {
  const found = [...scope.querySelectorAll("button")].find((node) => (node.getAttribute("aria-label") ?? node.textContent?.trim()) === label);
  expect(found, label).toBeTruthy();
  return found!;
}

async function click(label: string, scope?: ParentNode) {
  await act(async () => { button(label, scope).click(); });
}

describe("drafting a routine in the create form", () => {
  it("submits the parent and its sub-behaviors in order, with Retinol on its own schedule", async () => {
    const action = vi.fn<BehaviorFormAction>(async () => ({ status: "idle", message: "" }));
    await act(() => root.render(
      <BehaviorForm mode="create" action={action} categories={[]} parentOptions={[{ id: WALK, title: "Morning walk" }]} allowSubBehaviorDrafts />,
    ));
    const form = container.querySelector("form")!;
    await act(() => setValue(byLabel<HTMLInputElement>("Title"), "Skin routine"));
    expect(byLabel<HTMLSelectElement>("Part of")).toBeTruthy();

    for (let count = 0; count < 3; count += 1) await click("Add sub-behavior");
    // A Behavior with sub-behaviors can't go under another one.
    expect(container.textContent).not.toContain("Part of");

    const drafts = container.querySelectorAll<HTMLLIElement>("[data-sub-behavior-draft]");
    expect(drafts).toHaveLength(3);
    for (const [index, title] of ["Cerave", "Facewash", "Retinol"].entries()) {
      await act(() => setValue(byLabel<HTMLInputElement>("Title", drafts[index]!), title));
    }
    const retinolRow = container.querySelectorAll<HTMLLIElement>("[data-sub-behavior-draft]")[2]!;
    expect(retinolRow.querySelector('[name="sub_behavior_2_time"]')).toBeNull();
    await act(async () => { byLabel<HTMLInputElement>("Follow parent schedule", retinolRow).click(); });
    expect(byLabel<HTMLSelectElement>("Retinol repeats").value).toBe("weekly");

    await click("Move Facewash up");
    const titles = [...container.querySelectorAll<HTMLInputElement>('[name$="_title"]')].map((input) => `${input.name}=${input.value}`);
    expect(titles).toEqual(["sub_behavior_0_title=Facewash", "sub_behavior_1_title=Cerave", "sub_behavior_2_title=Retinol"]);

    await act(async () => { form.requestSubmit(); });
    expect(action).toHaveBeenCalledTimes(1);
    const submitted = action.mock.calls[0]![1];
    expect(submitted.get("sub_behavior_count")).toBe("3");
    expect(submitted.get("parent_behavior_id")).toBeNull();

    const group = parseBehaviorGroupFormData(submitted);
    expect(group.parent.title).toBe("Skin routine");
    expect(group.subBehaviors.map((child) => [child.title, child.inheritParentSchedule, child.subBehaviorSortOrder]))
      .toEqual([["Facewash", true, 0], ["Cerave", true, 1], ["Retinol", false, 2]]);
    expect(group.subBehaviors[2]!.recurrenceRule).toMatchObject({ frequency: "weekly", daysOfWeek: ["monday", "wednesday", "friday"] });
    expect(group.subBehaviors[2]!.scheduledTime).toBe("09:00");
  });

  it("names the drafted sub-behavior when its custom schedule is not valid", () => {
    const form = new FormData();
    form.set("title", "Skin routine");
    form.set("behavior_schedule_count", "1");
    form.set("schedule_0_recurrence_kind", "daily");
    form.set("schedule_0_daily_interval", "1");
    form.set("schedule_0_time_entry_count", "1");
    form.set("schedule_0_time_entry_kind_0", "exact");
    form.set("schedule_0_time_entry_exact_time_0", "21:00");
    form.set("sub_behavior_count", "2");
    form.set("sub_behavior_0_title", "Cerave");
    form.set("sub_behavior_0_inherit", "true");
    form.set("sub_behavior_1_title", "Retinol");
    form.set("sub_behavior_1_inherit", "false");
    form.set("sub_behavior_1_recurrence_kind", "daily");
    form.set("sub_behavior_1_time", "99:99");
    expect(() => parseBehaviorGroupFormData(form)).toThrow(/^Check sub-behavior 2: /u);
  });

  it("hides the drafts once a parent is chosen, and shows Follow parent schedule", async () => {
    await act(() => root.render(
      <BehaviorForm mode="create" action={async (state) => state} categories={[]} parentOptions={[{ id: SKIN, title: "Skin routine" }]} allowSubBehaviorDrafts />,
    ));
    await act(() => setValue(byLabel<HTMLSelectElement>("Part of"), SKIN));
    expect(container.querySelector('[data-sub-behavior-editor="draft"]')).toBeNull();
    expect(container.textContent).toContain("Uses the schedule of Skin routine.");
    expect(container.querySelector<HTMLInputElement>('[name="inherit_parent_schedule"]')!.value).toBe("true");
  });
});

describe("editing a sub-behavior", () => {
  it("hides the schedule while it follows the parent and shows it when overridden", async () => {
    const options = parentChoices(CERAVE, [skin, cerave, facewash, walk]).options;
    await act(() => root.render(
      <BehaviorForm mode="edit" action={async (state) => state} categories={[]} behavior={cerave} parentOptions={options} />,
    ));
    const rows = () => container.querySelector<HTMLElement>(".divide-y.divide-line")!;
    expect(byLabel<HTMLSelectElement>("Part of").value).toBe(SKIN);
    expect(rows().hidden).toBe(true);
    expect(container.textContent).toContain("Uses the schedule of Skin routine.");

    await act(async () => { byLabel<HTMLInputElement>("Follow parent schedule").click(); });
    expect(rows().hidden).toBe(false);
    expect(container.querySelector<HTMLInputElement>('[name="inherit_parent_schedule"]')!.value).toBe("false");
    expect(container.textContent).not.toContain("Uses the schedule of");
  });

  it("offers no parent field to a Behavior that has sub-behaviors", async () => {
    const choices = parentChoices(SKIN, [skin, cerave, walk]);
    expect(choices).toEqual({ options: [], locked: true });
    await act(() => root.render(
      <BehaviorForm mode="edit" action={async (state) => state} categories={[]} behavior={skin} parentOptions={choices.options} parentLocked={choices.locked} />,
    ));
    expect(container.textContent).not.toContain("Part of");
  });
});

describe("depth-1 choices", () => {
  it("lists only active top-level Behaviors other than itself", () => {
    const all = [skin, cerave, facewash, walk, archived];
    expect(parentChoices(WALK, all).options.map((option) => option.title)).toEqual(["Skin routine"]);
    expect(parentChoices(null, all).options.map((option) => option.title)).toEqual(["Morning walk", "Skin routine"]);
    expect(attachCandidates(SKIN, all).map((option) => option.title)).toEqual(["Morning walk"]);
    expect(attachCandidates(WALK, all)).toEqual([]);
    expect([...groupSubBehaviors(all).get(SKIN)!].map((child) => child.title)).toEqual(["Facewash", "Cerave"]);
  });

  it("rebuilds a saved Behavior's form for a link change without losing its settings", () => {
    const moved = parseBehaviorFormData(behaviorViewFormData(walk, { parentBehaviorId: SKIN }), { mode: "update" });
    expect(moved).toMatchObject({
      behaviorId: WALK, title: "Morning walk", parentBehaviorId: SKIN, inheritParentSchedule: true,
      browserReminderEnabled: true, emailReminderEnabled: false, active: true, scheduledTime: "22:00",
    });
    const detached = parseBehaviorFormData(behaviorViewFormData(retinol, { parentBehaviorId: null }), { mode: "update" });
    expect(detached.parentBehaviorId).toBeNull();
    expect(detached.recurrenceRule).toMatchObject({ frequency: "weekly", daysOfWeek: ["monday", "wednesday", "friday"] });
    const added = parseBehaviorFormData(newSubBehaviorFormData(skin, "Toner"), { mode: "create" });
    expect(added).toMatchObject({ title: "Toner", parentBehaviorId: SKIN, inheritParentSchedule: true, behaviorId: "" });
  });
});

describe("the Behaviors list", () => {
  const parentSummary: AnalyticsParentSummary = {
    parentBehaviorId: SKIN, title: "Skin routine", categoryName: "No category",
    subBehaviorIds: [FACEWASH, CERAVE, RETINOL],
    completedCount: 5, notCompletedCount: 1, unresolvedCount: 0, totalCount: 6, resolvedCount: 6,
    rate: 5 / 6, percentLabel: "83%", detailLabel: "5 of 6",
    slotCounts: { totalSlots: 3, completedSlots: 2, partialSlots: 1, notCompletedSlots: 0, unresolvedSlots: 0 },
    dailyCells: [],
  } as unknown as AnalyticsParentSummary;

  function analytics(): AnalyticsView {
    return { ...resolveAnalytics({ occurrences: [], now: NOW, timezone: "America/New_York" }), parentSummaries: [parentSummary] };
  }

  async function renderList(actions: Partial<Record<"update" | "reorder" | "create", BehaviorFormAction>> = {}) {
    const unchanged = async <T,>(state: T) => state;
    await act(() => root.render(
      <LinkProvider component={(props) => <a {...props} />}>
        <RefreshProvider onRefresh={() => undefined}>
          <BehaviorList
            activeBehaviors={[cerave, walk, retinol, skin, facewash]}
            archivedBehaviors={[]}
            categories={[]}
            analytics={analytics()}
            updateAction={actions.update ?? unchanged} archiveAction={unchanged} restoreAction={unchanged} archiveNoteAction={unchanged}
            statusAction={unchanged} noteAction={unchanged} stopTimeTrackingAction={unchanged} resetTimeTrackingAction={unchanged}
            reorderAction={actions.reorder} createAction={actions.create}
          />
        </RefreshProvider>
      </LinkProvider>,
    ));
  }

  const nestedTitles = () => [...container.querySelectorAll('[data-sub-behavior="true"] h4')].map((node) => node.textContent);
  const managed = () => container.querySelector<HTMLElement>('[data-sub-behavior-editor="manage"]')!;

  async function openParentSettings() {
    const parent = container.querySelector<HTMLElement>(`[data-behavior-id="${SKIN}"]`)!;
    const details = parent.querySelector<HTMLDetailsElement>("details")!;
    await act(async () => { details.open = true; details.dispatchEvent(new Event("toggle")); });
  }

  it("nests sub-behaviors under their parent in sibling order with rolled-up adherence", async () => {
    await renderList();
    const topLevel = [...container.querySelectorAll("h3")].map((node) => node.textContent);
    expect(topLevel).toEqual(expect.arrayContaining(["Skin routine", "Morning walk"]));
    expect(topLevel).not.toContain("Cerave");
    expect(nestedTitles()).toEqual(["Facewash", "Cerave", "Retinol"]);
    const summary = container.querySelector(`[data-parent-summary="${SKIN}"]`)!;
    expect(summary.textContent).toContain("83%");
    expect(summary.textContent).toContain("Full routines2 of 3");
    expect(container.textContent).toContain("Sub-behaviors (3)");
  });

  it("reorders at once, saves the new order, and puts it back when saving fails", async () => {
    let resolveReorder: (state: BehaviorActionState) => void = () => undefined;
    const reorder = vi.fn<BehaviorFormAction>(() => new Promise((resolve) => { resolveReorder = resolve; }));
    await renderList({ reorder });
    await openParentSettings();

    await click("Move Retinol up", managed());
    expect(nestedTitles()).toEqual(["Facewash", "Retinol", "Cerave"]);
    const form = reorder.mock.calls[0]![1];
    expect(form.get("parent_behavior_id")).toBe(SKIN);
    expect(form.getAll("sub_behavior_id")).toEqual([FACEWASH, RETINOL, CERAVE]);
    await act(async () => { resolveReorder({ status: "success", message: "Order saved." }); });
    expect(managed().textContent).toContain("Order saved.");

    reorder.mockImplementationOnce(async () => ({ status: "error", message: "Reload and try again." }));
    await click("Move Facewash down", managed());
    expect(nestedTitles()).toEqual(["Facewash", "Cerave", "Retinol"]);
    expect(managed().querySelector('[role="alert"]')!.textContent).toContain("Reload and try again.");
  });

  it("detaches a sub-behavior and adds existing or new ones through the injected actions", async () => {
    const update = vi.fn<BehaviorFormAction>(async () => ({ status: "success", message: "Behavior saved." }));
    const create = vi.fn<BehaviorFormAction>(async () => ({ status: "success", message: "Behavior created." }));
    await renderList({ update, create, reorder: async (state) => state });
    await openParentSettings();

    await click("Detach Cerave", managed());
    expect(update.mock.calls[0]![1].get("behavior_id")).toBe(CERAVE);
    expect(update.mock.calls[0]![1].get("parent_behavior_id")).toBe("");
    expect(managed().textContent).toContain("Cerave is now its own behavior.");

    await act(() => setValue(byLabel<HTMLSelectElement>("Add an existing behavior", managed()), WALK));
    await click("Add", managed().querySelector("select")!.closest("div")!);
    const attached = update.mock.calls[1]![1];
    expect([attached.get("behavior_id"), attached.get("parent_behavior_id"), attached.get("inherit_parent_schedule")]).toEqual([WALK, SKIN, "true"]);
    expect(managed().textContent).toContain("Morning walk is now part of Skin routine.");

    await act(() => setValue(byLabel<HTMLInputElement>("New sub-behavior", managed()), "Toner"));
    await act(async () => { managed().querySelector("form")!.requestSubmit(); });
    const created = create.mock.calls[0]![1];
    expect([created.get("title"), created.get("parent_behavior_id"), created.has("behavior_id")]).toEqual(["Toner", SKIN, false]);
  });

  it("shows no reorder controls without a reorder action", async () => {
    await renderList();
    await openParentSettings();
    expect(managed().textContent).not.toContain("Up");
    expect(button("Detach Retinol", managed())).toBeTruthy();
  });
});
